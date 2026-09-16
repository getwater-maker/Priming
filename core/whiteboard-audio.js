'use strict';

/**
 * whiteboard-audio.js — 화이트보드 MP4 에 **TTS 음성을 얹는다** (5단계, 2026-09-16).
 *
 * 🔑 **타임라인은 이미 맞아떨어진다** — 장면 길이(`sceneDurationMs`)를 「그 장면 문장들의 TTS 합」으로
 *   잡아 뒀기 때문이다(v0.3.91 에서 SKILL.md 관례 대신 이 정의를 택한 이유가 바로 A/V 싱크였다).
 *   그래서 문장 음성을 장면 순서대로 이어붙이면 영상과 길이가 같다.
 *
 * ⚠ **그래도 장면마다 맞춘다**(전체를 한 번에 이어붙이지 않는다) — 렌더러가 길이를 프레임 단위로
 *   반올림하므로 장면당 최대 1프레임(60fps = 16ms)이 어긋나고, 50장면이면 0.8초가 **누적**된다.
 *   장면별로 무음을 덧대거나(apad) 잘라(-t) **실제 장면 영상 길이**에 맞추면 그 드리프트가 사라진다.
 *
 * ⚠ `tts-N` 폴더의 파일은 **.wav 와 .mp3 가 섞일 수 있다** — 캐시 적중은 캐시의 확장자를 그대로 쓰고
 *   (`hit.ext`), 배속이 걸리면 mp3, ffmpeg 실패 폴백은 wav 다(core/pipeline.js fillTtsList).
 *   그래서 **concat 데무서를 쓰지 않는다**(같은 코덱·표본율을 요구하는데, 어긋나도 조용히 이상한 소리를
 *   낸다). 대신 **concat 필터 + 입력마다 aresample** 로 규격을 맞춰 붙인다.
 *
 * ⚠ 명령줄 길이 한계(윈도우 32767자) 때문에 한 번에 붙이는 입력을 CHUNK 개로 끊고 재귀로 합친다.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const MU = require('./media-utils');

const RATE = '48000';     // 최종 트랙 표본율 — 입력이 24kHz TTS 라도 여기로 맞춘다
const CHUNK = 40;         // 한 ffmpeg 호출에 넣는 최대 입력 수

function _ff(args, abortSignal) {
  return new Promise((resolve, reject) => {
    const exe = MU.getFfmpegPath();
    if (!exe) return reject(new Error('ffmpeg 를 찾을 수 없습니다'));
    const cp = spawn(exe, args, { windowsHide: true });
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

/** 입력 N개를 한 번에 이어붙여 균일 WAV 로 — 입력 포맷이 제각각이어도 된다(입력마다 aresample). */
async function _concatOnce(inputs, outPath, abortSignal) {
  const args = ['-y'];
  for (const f of inputs) args.push('-i', f);
  const norm = inputs.map((_, i) => `[${i}:a]aresample=${RATE},aformat=sample_fmts=s16:channel_layouts=mono[a${i}]`).join(';');
  const chain = inputs.map((_, i) => `[a${i}]`).join('');
  args.push('-filter_complex', `${norm};${chain}concat=n=${inputs.length}:v=0:a=1[out]`,
    '-map', '[out]', '-ar', RATE, '-ac', '1', '-c:a', 'pcm_s16le', outPath);
  await _ff(args, abortSignal);
}

/** CHUNK 를 넘으면 나눠 붙이고 그 결과를 다시 붙인다(명령줄 길이 한계 회피). */
async function _concatToWav(inputs, outPath, tmpDir, abortSignal, depth = 0) {
  if (inputs.length <= CHUNK) return _concatOnce(inputs, outPath, abortSignal);
  const chunks = [];
  try {
    for (let i = 0; i < inputs.length; i += CHUNK) {
      const t = path.join(tmpDir, `_wa_${depth}_${i}.wav`);
      await _concatOnce(inputs.slice(i, i + CHUNK), t, abortSignal);
      chunks.push(t);
    }
    await _concatToWav(chunks, outPath, tmpDir, abortSignal, depth + 1);
  } finally {
    for (const c of chunks) { try { fs.rmSync(c, { force: true }); } catch (_) {} }
  }
}

/**
 * 장면 하나의 음성 트랙 — 문장 음성을 순서대로 붙이고 **그 장면 영상 길이에 정확히** 맞춘다.
 * 모자라면 무음(apad), 넘치면 자른다(-t).
 */
async function buildSceneAudio({ inputs, durationSec, outPath, tmpDir, abortSignal } = {}) {
  if (!inputs || !inputs.length) throw new Error('이어붙일 음성이 없습니다');
  const raw = path.join(tmpDir, `_wa_raw_${path.basename(outPath)}`);
  try {
    await _concatToWav(inputs, raw, tmpDir, abortSignal);
    await _ff(['-y', '-i', raw, '-af', 'apad', '-t', Number(durationSec).toFixed(3),
      '-ar', RATE, '-ac', '1', '-c:a', 'pcm_s16le', outPath], abortSignal);
  } finally { try { fs.rmSync(raw, { force: true }); } catch (_) {} }
  return outPath;
}

/**
 * 무음 MP4 에 음성을 얹는다.
 * @param opts.videoPath  이어붙인 무음 영상
 * @param opts.scenes     [{ video, audios: string[] }] — 장면 순서대로
 * @param opts.tmpDir     중간 파일 폴더(whiteboard-N)
 * @param opts.log        로거
 * @returns {{ok:true, output}} | {{ok:false, error}}
 */
async function attachAudio({ videoPath, scenes, tmpDir, log = () => {}, abortSignal = null } = {}) {
  if (!videoPath || !fs.existsSync(videoPath)) return { ok: false, error: '영상 파일이 없습니다' };
  if (!scenes || !scenes.length) return { ok: false, error: '장면이 없습니다' };
  const tmps = [];
  try {
    const parts = [];
    const durations = [];   // 🔑 장면 **실측** 길이 — 자막(whiteboard-subtitle)이 같은 기준을 써야 글자가 소리와 함께 간다.
    for (let i = 0; i < scenes.length; i++) {
      if (abortSignal && abortSignal.aborted) return { ok: false, cancelled: true, error: '중단됨' };
      const sc = scenes[i];
      const have = (sc.audios || []).filter((f) => f && fs.existsSync(f));
      if (!have.length) return { ok: false, error: `장면 ${i + 1} 의 음성 파일을 찾을 수 없습니다 — 「🎤 TTS」를 먼저 만드세요` };
      // 🔑 길이는 **그 장면 영상에서 실측**한다(계획값이 아니라) — 프레임 반올림까지 흡수해 드리프트를 없앤다.
      let dur = 0;
      try { dur = (await MU.getMediaDuration(sc.video)) || 0; } catch (_) { dur = 0; }
      if (!dur) return { ok: false, error: `장면 ${i + 1} 영상 길이를 잴 수 없습니다 (${path.basename(sc.video || '')})` };
      durations.push(dur);
      const out = path.join(tmpDir, `_wa_scene_${String(i + 1).padStart(2, '0')}.wav`);
      await buildSceneAudio({ inputs: have, durationSec: dur, outPath: out, tmpDir, abortSignal });
      tmps.push(out); parts.push(out);
    }
    // 장면 트랙은 이제 규격이 같다 → concat 데무서 + 무손실 복사
    const listPath = path.join(tmpDir, '_wa_list.txt');
    const line = (p) => "file '" + String(p).split("\\").join("/").split("'").join("'\\''") + "'";
    fs.writeFileSync(listPath, parts.map(line).join('\n'), 'utf8');
    tmps.push(listPath);
    const full = path.join(tmpDir, '_wa_full.wav');
    await _ff(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', full], abortSignal);
    tmps.push(full);

    // mux — 영상은 **복사**(재인코딩 없음), 음성만 AAC.
    const muxed = path.join(tmpDir, '_wa_muxed.mp4');
    await _ff(['-y', '-i', videoPath, '-i', full, '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', muxed], abortSignal);
    if (!fs.existsSync(muxed)) return { ok: false, error: '음성을 얹은 결과가 없습니다' };
    fs.rmSync(videoPath, { force: true });
    fs.renameSync(muxed, videoPath);
    let outDur = 0;
    try { outDur = (await MU.getMediaDuration(videoPath)) || 0; } catch (_) {}
    log(`🔊 음성 얹기 완료 — 장면 ${scenes.length}개 · ${outDur ? outDur.toFixed(1) + '초' : '길이 미상'}`);
    return { ok: true, output: videoPath, durationSec: outDur, durations };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    for (const t of tmps) { try { fs.rmSync(t, { force: true }); } catch (_) {} }
  }
}

module.exports = { attachAudio, buildSceneAudio, RATE, CHUNK };
