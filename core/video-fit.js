'use strict';
/**
 * video-fit.js — 🎞 그룹 영상이 음성보다 짧을 때 **그룹 길이에 맞춘 영상 파일**을 만든다 (2026-09-24, v0.5.33)
 *
 * 로이: "생성된 비디오보다 TTS 가 긴 경우에는 같은 비디오를 반복 재생" → 추천안(로이 확정):
 *   · 차이가 작으면(목표 ≤ 원본 × SLOW_MAX) **느리게 재생**해 맞춘다 — 반복이 안 보여 가장 자연스럽다.
 *   · 차이가 크면 **반복 + 이음새 크로스페이드**(xfade 0.5초) — 첫 장면으로 「툭」 튀지 않게.
 * 🔴 전에는 🎬 MP4 가 남은 시간 동안 **마지막 프레임에서 멈췄고**(tpad clone), .vrew 는 sourceOut 만 늘려
 *   Vrew 에 맡겼다(두 출력의 결과가 달랐다). 이제 .vrew 에 **맞춘 파일**을 넣으므로 🎬 MP4(.vrew 를 읽는다)도 똑같다.
 * 🔑 원본(g.videoPath)은 건드리지 않는다 — 결과는 캐시(~/.priming-maker/video-fit-cache)에 둔다(원본·목표 길이로 키).
 * 🔑 무음 오디오 트랙(aac 48k 스테레오)을 넣는다 — vrew-builder 가 영상 오디오(videoAudio 트랙, 음량 0)를 선언하므로 컨테이너를 맞춘다.
 * ⚠ 어떤 경우에도 던지지 않는다 — 실패하면 원본을 그대로 돌려준다(예전 동작 = 마지막 프레임 정지).
 * ⚠ ffmpeg 는 **비동기**(spawn)로 부른다 — 메인 프로세스를 막지 않는다(v0.3.18 프리징 교훈).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SLOW_MAX = 1.3;   // 이 배율까지는 느리게 — 넘으면 굼떠 보인다
const XFADE = 0.5;      // 반복 이음새 크로스페이드(초)
const MAX_LOOPS = 24;   // 이보다 많이 반복해야 하면 크로스페이드 없이 반복(필터가 너무 길어진다)
const FPS = 30;         // 🎬 MP4 렌더러와 같은 프레임률
const EPS = 0.1;        // 이 정도 차이는 맞추지 않는다(프레임 반올림 수준)

function _ffmpeg() {
  try { const p = require('./media-utils').getFfmpegPath(); if (p && fs.existsSync(p)) return p; } catch (_) {}
  return 'ffmpeg';
}
function cacheDir() { return path.join(os.homedir(), '.priming-maker', 'video-fit-cache'); }

function _run(bin, args) {
  return new Promise((resolve) => {
    let err = '';
    let child;
    try { child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }); }
    catch (e) { resolve({ ok: false, error: e.message }); return; }
    child.stderr.on('data', (c) => { err += c.toString(); if (err.length > 12000) err = err.slice(-12000); });
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: `ffmpeg ${code}: ${err.split('\n').slice(-4).join(' ').trim()}` }));
  });
}

/** 어떤 방식으로 맞출지 — 순수 계산(테스트가 직접 부른다) */
function plan(srcSec, targetSec) {
  const s = Number(srcSec) || 0, t = Number(targetSec) || 0;
  if (!(s > 0) || !(t > s + EPS)) return { mode: 'none' };
  const ratio = t / s;
  if (ratio <= SLOW_MAX) return { mode: 'slow', ratio };
  const x = Math.min(XFADE, s * 0.25);
  const n = Math.ceil((t - x) / (s - x));   // n 번 이으면 길이 = n·s − (n−1)·x ≥ t
  if (n > MAX_LOOPS) return { mode: 'loop', n: Math.ceil(t / s), xfade: 0 };
  return { mode: 'loop', n, xfade: x };
}

/** 계획 → ffmpeg 인자(순수 — 테스트가 직접 본다) */
function buildArgs(src, srcSec, targetSec, out, p) {
  const T = Number(targetSec).toFixed(3);
  const tail = ['-map', '[v]', '-map', 'a:0', '-t', T, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-y', out];
  const silence = ['-f', 'lavfi', '-t', T, '-i', 'anullsrc=r=48000:cl=stereo'];
  if (p.mode === 'slow') {
    return ['-hide_banner', '-loglevel', 'error', '-i', src, ...silence,
      '-filter_complex', `[0:v]setpts=${p.ratio.toFixed(5)}*PTS,fps=${FPS},format=yuv420p[v]`,
      ...tail.map((a) => (a === 'a:0' ? '1:a' : a))];
  }
  if (!p.xfade) {   // 반복이 너무 많으면 크로스페이드 없이
    return ['-hide_banner', '-loglevel', 'error', '-stream_loop', String(p.n), '-i', src, ...silence,
      '-filter_complex', `[0:v]fps=${FPS},format=yuv420p[v]`,
      ...tail.map((a) => (a === 'a:0' ? '1:a' : a))];
  }
  const ins = [];
  for (let i = 0; i < p.n; i++) ins.push('-i', src);
  const s = Number(srcSec);
  const parts = [];
  for (let i = 0; i < p.n; i++) parts.push(`[${i}:v]fps=${FPS},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[s${i}]`);
  let prev = 's0';
  for (let k = 1; k < p.n; k++) {
    const off = (k * (s - p.xfade)).toFixed(3);
    const outL = k === p.n - 1 ? 'v' : `x${k}`;
    parts.push(`[${prev}][s${k}]xfade=transition=fade:duration=${p.xfade.toFixed(3)}:offset=${off}[${outL}]`);
    prev = outL;
  }
  return ['-hide_banner', '-loglevel', 'error', ...ins, ...silence,
    '-filter_complex', parts.join(';'),
    ...tail.map((a) => (a === 'a:0' ? `${p.n}:a` : a))];
}

/**
 * 원본 영상을 targetSec 에 맞춘 파일 경로를 돌려준다(맞출 필요가 없거나 실패하면 원본 그대로).
 * @returns {Promise<{path:string, mode:'none'|'slow'|'loop'|'fail', cached?:boolean, error?:string}>}
 */
async function fitVideo(src, srcSec, targetSec, { log = () => {}, dir = cacheDir(), label = '' } = {}) {
  const p = plan(srcSec, targetSec);
  if (p.mode === 'none') return { path: src, mode: 'none' };
  let st;
  try { st = fs.statSync(src); } catch (_) { return { path: src, mode: 'fail', error: '원본 영상이 없습니다' }; }
  const key = crypto.createHash('sha1').update([path.resolve(src), st.size, Math.round(st.mtimeMs), Number(targetSec).toFixed(2), p.mode, p.n || 0, SLOW_MAX, XFADE].join('|')).digest('hex').slice(0, 20);
  const out = path.join(dir, `${key}.mp4`);
  const how = p.mode === 'slow' ? `느리게 ×${p.ratio.toFixed(2)}` : `반복 ${p.n}번${p.xfade ? ' · 이음새 크로스페이드' : ''}`;
  try { if (fs.statSync(out).size > 1000) { try { const n = new Date(); fs.utimesSync(out, n, n); } catch (_) {} log(`🎞 ${label}영상 ${Number(srcSec).toFixed(1)}초 → ${Number(targetSec).toFixed(1)}초 (${how} · 캐시)`); return { path: out, mode: p.mode, cached: true }; } } catch (_) {}
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const tmp = out.replace(/\.mp4$/, `.part-${process.pid}.mp4`);
  const t0 = Date.now();
  const r = await _run(_ffmpeg(), buildArgs(src, srcSec, targetSec, tmp, p));
  if (!r.ok) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) {}
    log(`⚠ ${label}영상 길이 맞추기 실패 — 원본을 그대로 씁니다(남는 시간은 마지막 장면에서 멈춥니다): ${r.error}`);
    return { path: src, mode: 'fail', error: r.error };
  }
  try { fs.renameSync(tmp, out); } catch (e) { return { path: src, mode: 'fail', error: e.message }; }
  log(`🎞 ${label}영상 ${Number(srcSec).toFixed(1)}초 → ${Number(targetSec).toFixed(1)}초 (${how} · ${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  return { path: out, mode: p.mode };
}

/** 오래된 캐시 정리(기본 14일) — 앱 시작 때 부른다. */
function pruneCache(days = 14, dir = cacheDir()) {
  let n = 0;
  try {
    const lim = Date.now() - days * 86400000;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { if (fs.statSync(p).mtimeMs < lim) { fs.rmSync(p, { force: true }); n++; } } catch (_) {}
    }
  } catch (_) {}
  return n;
}

module.exports = { SLOW_MAX, XFADE, FPS, plan, buildArgs, fitVideo, pruneCache, cacheDir };
