'use strict';
/**
 * video-strip.js — ✂ 「비디오 시작점 변경」 창의 필름 띠 + 소리 파형(v1.0.63 · 로이 2026-11-18 · Vrew 동일화)
 *   · 필름 띠 = 영상 전체를 고르게 N 장 뽑아 가로로 붙인 JPG 한 장(ffmpeg fps + tile · 한 번의 실행)
 *   · 파형 = 소리를 모노 4kHz 로 풀어 칸마다 최대 크기(0..1) — 소리 트랙이 없으면 빈 배열
 *   결과는 임시 폴더 캐시(원본 경로·크기·수정 시각이 열쇠) · 원본은 읽기만 한다 · main 전용(fs·spawn) — 렌더러 번들에 넣지 않는다.
 *   ⚠ ffmpeg 는 비동기(spawn) — 메인 프로세스를 막지 않는다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const FRAMES = 16;      // 필름 띠 장 수
const FRAME_H = 72;     // 한 장 높이(px)
const PEAKS = 400;      // 파형 칸 수
const AR = 4000;        // 파형용 표본율(Hz)

function _ffmpeg() {
  try { const p = require('./media-utils').getFfmpegPath(); if (p && fs.existsSync(p)) return p; } catch (_) {}
  return 'ffmpeg';
}
function cacheDir() { return path.join(os.tmpdir(), 'priming-vstrip'); }

/** 필름 띠 인자(순수) — 영상 길이 dur 동안 n 장을 고르게 */
function stripArgs(src, dur, n, h, out) {
  const rate = Math.max(0.01, n / Math.max(0.1, Number(dur) || 1));
  return ['-hide_banner', '-loglevel', 'error', '-i', src, '-an',
    '-vf', `fps=${rate.toFixed(5)},scale=-2:${h},tile=${n}x1`, '-frames:v', '1', '-q:v', '4', '-y', out];
}
/** s16le 모노 소리 → n 칸 최대 크기(0..1 · 가장 큰 칸 = 1 로 맞춘다) — 순수 */
function peaksOf(buf, n) {
  const samples = Math.floor(buf.length / 2);
  if (!samples || !(n > 0)) return [];
  const out = new Array(n).fill(0);
  for (let i = 0; i < samples; i++) {
    const k = Math.min(n - 1, Math.floor(i * n / samples));
    const v = Math.abs(buf.readInt16LE(i * 2)) / 32768;
    if (v > out[k]) out[k] = v;
  }
  const mx = Math.max(...out);
  return mx > 0.001 ? out.map((v) => Math.round((v / mx) * 1000) / 1000) : out.map(() => 0);
}

function _run(args, wantStdout) {
  return new Promise((resolve) => {
    let err = ''; const chunks = []; let size = 0;
    let child;
    try { child = spawn(_ffmpeg(), args, { stdio: ['ignore', wantStdout ? 'pipe' : 'ignore', 'pipe'], windowsHide: true }); }
    catch (e) { resolve({ ok: false, error: e.message }); return; }
    if (wantStdout) child.stdout.on('data', (c) => { if (size < 64 * 1048576) { chunks.push(c); size += c.length; } });
    child.stderr.on('data', (c) => { err += c.toString(); if (err.length > 8000) err = err.slice(-8000); });
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('close', (code) => resolve(code === 0 ? { ok: true, out: wantStdout ? Buffer.concat(chunks) : null } : { ok: false, error: `ffmpeg ${code}: ${err.trim().split('\n').slice(-3).join(' ')}` }));
  });
}

/**
 * @returns {Promise<{ok:boolean, dur:number, strip:string|null, frames:number, hasAudio:boolean, peaks:number[], error?:string}>}
 */
async function makeStrip(src, { frames = FRAMES, h = FRAME_H, peaks = PEAKS, dir = cacheDir() } = {}) {
  let st; try { st = fs.statSync(src); } catch (_) { return { ok: false, error: '영상 파일을 찾을 수 없습니다' }; }
  const MU = require('./media-utils');
  const dur = Number(await MU.getMediaDuration(src)) || 0;
  if (!(dur > 0)) return { ok: false, error: '영상 길이를 읽지 못했습니다' };
  let hasAudio = false; try { hasAudio = await MU.hasAudioStream(src); } catch (_) { hasAudio = false; }
  const key = crypto.createHash('sha1').update([path.resolve(src), st.size, Math.round(st.mtimeMs), frames, h].join('|')).digest('hex').slice(0, 20);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const jpg = path.join(dir, key + '.jpg');
  let strip = null;
  try { if (fs.statSync(jpg).size > 500) strip = jpg; } catch (_) {}
  if (!strip) {
    const tmp = path.join(dir, `${key}.part-${process.pid}.jpg`);
    const r = await _run(stripArgs(src, dur, frames, h, tmp), false);
    if (r.ok) { try { fs.renameSync(tmp, jpg); strip = jpg; } catch (_) {} } else { try { fs.rmSync(tmp, { force: true }); } catch (_) {} }
  }
  let pk = [];
  if (hasAudio) {
    const pj = path.join(dir, key + `.peaks${peaks}.json`);
    try { pk = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch (_) { pk = []; }
    if (!Array.isArray(pk) || pk.length !== peaks) {
      const r = await _run(['-hide_banner', '-loglevel', 'error', '-i', src, '-vn', '-ac', '1', '-ar', String(AR), '-f', 's16le', 'pipe:1'], true);
      pk = r.ok && r.out ? peaksOf(r.out, peaks) : [];
      if (pk.length) { try { fs.writeFileSync(pj, JSON.stringify(pk)); } catch (_) {} }
    }
  }
  return { ok: true, dur, strip, frames, hasAudio, peaks: pk };
}

module.exports = { FRAMES, FRAME_H, PEAKS, stripArgs, peaksOf, makeStrip, cacheDir };
