'use strict';

/**
 * whiteboard-subtitle.js — 화이트보드 MP4 에 **자막을 얹는다** (5단계의 나머지 절반, 2026-09-16).
 *
 * 🔑 **왜 구워 넣나(하드번)** — 화이트보드 MP4 는 Vrew 를 거치지 않는 **최종 결과물**이다.
 *   소프트 자막(mov_text)으로 넣으면 플레이어가 켜야 보이고 유튜브도 따로 올려야 한다 →
 *   「자막이 안 보인다」가 된다. 그래서 화면에 굽고, **`.srt` 파일도 옆에 함께 남긴다**
 *   (유튜브에 올릴 때는 그쪽이 검색·번역에 유리하다).
 *   ⚠ 대가: 굽는 순간 **영상을 다시 인코딩**한다(음성 얹기는 `-c:v copy` 였다). 1920 22분이면 수 분.
 *     그래서 ⚙ 에서 끌 수 있고, 꺼도 `.srt` 는 그대로 나온다.
 *
 * 🔑 **시각의 기준은 「장면 영상의 실측 길이」다.** 장면 안에서는 문장 TTS 길이를 누적하지만,
 *   장면의 시작점은 실측 누적으로 잡는다 — 렌더러가 길이를 프레임 단위로 반올림해 장면마다
 *   몇 ms 씩 어긋나는데(whiteboard-audio 의 그 이유), 명목 길이로 쌓으면 50장면에서 누적된다.
 *   음성은 그 실측에 맞춰 얹히므로, 자막도 같은 기준을 써야 **소리와 글자가 함께** 간다.
 *
 * 🔑 자막 줄 나누기는 **core/caption-splitter 하나만 쓴다**(.vrew·SRT·프리미어와 같은 규칙).
 *   여기서 다시 구현하면 화이트보드만 다른 데서 끊긴다.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const MU = require('./media-utils');
const { splitCaptionLines, meaningfulLen, fmtSrtTime } = require('./caption-splitter');

// 글자 크기·아래 여백은 **영상 높이 비례**다(640 시험본과 1920 최종본이 같아 보이도록).
const FONT_RATIO = 0.052;   // 1080 → 56px
const MARGIN_RATIO = 0.075; // 1080 → 81px
// 🔑 화이트보드 종이는 **미색(#F5EBD7)** 이다 — 흰 글자는 안 보인다. 그래서 진한 글자 + 흰 테두리.
//   ASS 색은 BGR 순서(&HAABBGGRR)다. 검정 글자 · 흰 외곽 · 그림자 없음.
const STYLE = { PrimaryColour: '&H00202020', OutlineColour: '&H00FFFFFF', BorderStyle: 1, Shadow: 0, Bold: 1 };
const FONT_CANDIDATES = ['Malgun Gothic', 'Noto Sans KR', 'NanumGothic', 'Gulim'];

function _ff(args, { abortSignal = null, cwd = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const exe = MU.getFfmpegPath();
    if (!exe) return reject(new Error('ffmpeg 를 찾을 수 없습니다'));
    const cp = spawn(exe, args, { windowsHide: true, cwd });
    let err = '';
    cp.stderr.on('data', (b) => { err += b.toString(); if (err.length > 8000) err = err.slice(-8000); });
    const onAbort = () => { try { cp.kill('SIGKILL'); } catch (_) {} };
    if (abortSignal) { if (abortSignal.aborted) onAbort(); else abortSignal.addEventListener('abort', onAbort, { once: true }); }
    cp.on('error', (e) => reject(e));
    cp.on('close', (code) => {
      if (abortSignal) { try { abortSignal.removeEventListener('abort', onAbort); } catch (_) {} }
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 종료 ${code}: ${err.split('\n').filter(Boolean).slice(-3).join(' / ')}`));
    });
  });
}

/**
 * 장면 목록 → SRT 문자열.
 * @param scenes [{ sentences: [{ text, dur }] }]  — 장면 순서대로
 * @param opts.sceneDurations  장면별 **실측** 길이(초) 배열. 없으면 문장 길이 합을 쓴다.
 * @param opts.maxChars        자막 한 줄 글자수(앱 설정과 같은 값)
 */
function buildSrt(scenes, opts = {}) {
  const maxChars = opts.maxChars || 7;
  const meas = opts.sceneDurations || [];
  let base = 0, idx = 1, out = '';
  (scenes || []).forEach((sc, si) => {
    const sents = (sc && sc.sentences) || [];
    const nominal = sents.reduce((a, s) => a + (Number(s && s.dur) || 0), 0);
    let t = base;
    for (const s of sents) {
      const dur = Number(s && s.dur) || 0;
      const text = String((s && s.text) || '').trim();
      if (!text || dur <= 0) { t += dur; continue; }
      const clips = splitCaptionLines(text, maxChars);
      const totW = clips.reduce((a, c) => a + Math.max(1, meaningfulLen(c)), 0) || 1;
      let acc = t;
      clips.forEach((c, i) => {
        const cd = dur * (Math.max(1, meaningfulLen(c)) / totW);
        const start = acc;
        const end = (i === clips.length - 1) ? t + dur : acc + cd;
        out += `${idx++}\n${fmtSrtTime(start)} --> ${fmtSrtTime(end)}\n${c}\n\n`;
        acc = end;
      });
      t += dur;
    }
    // 🔑 다음 장면은 **실측 길이**만큼 뒤에서 시작한다(명목 합이 아니라) — 드리프트 방지.
    const real = Number(meas[si]);
    base += (Number.isFinite(real) && real > 0) ? real : nominal;
  });
  return out;
}

/** 프로젝트 + 장면 계획 → buildSrt 가 먹는 모양. 문장 텍스트·TTS 길이는 **지금 값**을 읽는다. */
function scenesForSubtitle(project, scenes) {
  const byNum = new Map();
  for (const g of (project.groups || [])) {
    const ss = project.getSentencesOfGroup ? project.getSentencesOfGroup(g) : [];
    for (const s of ss) if (s) byNum.set(s.num, s);
  }
  return (scenes || []).map((sc) => ({
    sentences: (sc.sentenceNums || []).map((n) => {
      const s = byNum.get(n);
      return s ? { text: s.text || '', dur: Number(s.ttsDurationSec) || 0 } : null;
    }).filter(Boolean),
  }));
}

/** ffmpeg 필터 인자 안의 `force_style` 값 — 콤마·등호가 옵션 구분자로 읽히지 않게 작은따옴표로 감싼다. */
function styleArg(height) {
  const px = Math.max(12, Math.round((height || 1080) * FONT_RATIO));
  const mv = Math.max(8, Math.round((height || 1080) * MARGIN_RATIO));
  // ⚠ 외곽선도 글자 크기 비례 — 고정값(3)으로 두면 640 시험본에서 글자가 테두리에 먹힌다.
  const kv = [`FontName=${FONT_CANDIDATES[0]}`, `FontSize=${px}`, `MarginV=${mv}`, `Outline=${Math.max(1, Math.round(px * 0.06))}`];
  for (const [k, v] of Object.entries(STYLE)) kv.push(`${k}=${v}`);
  return kv.join(',');
}

/**
 * 자막을 **영상에 굽는다**. 어떤 경우에도 던지지 않는다.
 * @param opts.videoPath  최종 MP4(제자리 교체)
 * @param opts.srtText    SRT 문자열
 * @param opts.tmpDir     중간 파일 폴더
 * @param opts.height     영상 세로 픽셀(글자 크기 기준)
 * @returns {{ok:true, output}} | {{ok:false, error}}
 */
async function burnSubtitle({ videoPath, srtText, tmpDir, height = 1080, log = () => {}, abortSignal = null } = {}) {
  if (!videoPath || !fs.existsSync(videoPath)) return { ok: false, error: '영상 파일이 없습니다' };
  if (!srtText || !srtText.trim()) return { ok: false, error: '자막 내용이 없습니다' };
  // 🔑 필터 문자열에 **경로를 넣지 않는다** — 윈도우의 드라이브 콜론(`D:`)과 한글 폴더명이
  //   ffmpeg 필터 문법과 충돌한다. 임시 폴더를 cwd 로 두고 **ASCII 파일명 하나**만 가리킨다.
  const subName = '_wb_sub.srt';
  const subPath = path.join(tmpDir, subName);
  const outPath = path.join(tmpDir, '_wb_subbed.mp4');
  try {
    fs.writeFileSync(subPath, srtText, 'utf8');
    const t0 = Date.now();
    await _ff(['-y', '-i', videoPath,
      '-vf', `subtitles=${subName}:force_style='${styleArg(height)}'`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy', '-movflags', '+faststart', outPath], { abortSignal, cwd: tmpDir });
    if (!fs.existsSync(outPath)) return { ok: false, error: '자막을 구운 결과가 없습니다' };
    fs.rmSync(videoPath, { force: true });
    fs.renameSync(outPath, videoPath);
    log(`💬 자막 굽기 완료 — ${((Date.now() - t0) / 1000).toFixed(1)}초 (영상을 다시 인코딩했습니다)`);
    return { ok: true, output: videoPath };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    for (const f of [subPath, outPath]) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
  }
}

module.exports = { buildSrt, scenesForSubtitle, burnSubtitle, styleArg, FONT_RATIO, MARGIN_RATIO, FONT_CANDIDATES };
