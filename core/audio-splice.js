'use strict';
/**
 * core/audio-splice.js — 🔗 문장 음성 **이어 붙이기 · 나누기**(2026-09-29 로이 기준, v0.5.87)
 *
 *   로이: "5번과 6번 클립을 합치기 할 경우 … TTS 는 그대로 둘 다 유지하며 순차적으로 재생하도록 하면 되겠고,
 *          7번을 2개 이상의 클립으로 나누었을 때는 … TTS 로 물론이고. … 빈 공간이 발생하지 않도록 하자."
 *   · 합치기 = 두 문장 음성을 **순서대로 이어** 한 파일로(각자 끝의 「문장 뒤 무음」까지 그대로 → 쉼이 산다).
 *   · 나누기 = 한 문장 음성을 **나뉜 글자 비율에 가장 가까운 쉼(무음)** 에서 자른다 — 낱말 한가운데를 베지 않게.
 *     쉼을 못 찾으면 그 근처에서 가장 조용한 순간.
 *   결과는 무손실 WAV(PCM 을 그대로 잇고 자른다 · 재인코딩은 mp3 를 읽을 때 한 번뿐).
 *   🔴 main 프로세스를 멈추지 않게 ffmpeg 는 **비동기**로만 부른다(동기 자식 프로세스 금지 — CLAUDE.md §6).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseWav, envelope } = require('./wav-slice');

function _ffmpeg() { try { return require('./media-utils').getFfmpegPath(); } catch { return null; } }

/** 파일 → PCM16 WAV Buffer. rate/ch 를 주면 그 형식으로 맞춘다(이어 붙일 때 첫 파일에 맞춤). */
function decodeWav(file, rate, ch) {
  return new Promise((resolve, reject) => {
    try {
      if (!rate && /\.wav$/i.test(file)) {
        const b = fs.readFileSync(file);
        const i = parseWav(b);
        if (i.audioFormat === 1 && i.bitsPerSample === 16) return resolve(b);
      }
    } catch (_) { /* ffmpeg 로 */ }
    const ff = _ffmpeg();
    if (!ff) return reject(new Error('ffmpeg 가 없습니다'));
    const args = ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-acodec', 'pcm_s16le'];
    if (rate) args.push('-ar', String(rate));
    if (ch) args.push('-ac', String(ch));
    args.push('-f', 'wav', 'pipe:1');
    const p = spawn(ff, args, { windowsHide: true });
    const out = []; let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('음성 읽기 실패: ' + (err.trim().split('\n')[0] || code)));
      const b = Buffer.concat(out);
      // 파이프 출력은 RIFF/data 크기를 모른 채 쓴다 → parseWav 가 파일 끝으로 보정한다. 헤더를 바로 잡아 둔다.
      try { const i = parseWav(b); resolve(makeWav(i, b.subarray(i.dataOffset, i.dataOffset + i.frames * i.frameBytes))); }
      catch (e) { reject(e); }
    });
  });
}

/** fmt 정보 + PCM 본문 → WAV Buffer(PCM16 헤더) */
function makeWav(info, body) {
  const out = Buffer.alloc(44 + body.length);
  out.write('RIFF', 0, 'ascii'); out.writeUInt32LE(36 + body.length, 4); out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii'); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(info.channels, 22);
  out.writeUInt32LE(info.sampleRate, 24); out.writeUInt32LE(info.sampleRate * info.frameBytes, 28);
  out.writeUInt16LE(info.frameBytes, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii'); out.writeUInt32LE(body.length, 40);
  body.copy(out, 44);
  return out;
}

/** 여러 음성을 순서대로 이어 outPath(.wav)에. → { durationSec } */
async function concatAudio(files, outPath) {
  if (!files.length) throw new Error('이을 음성이 없습니다');
  const first = await decodeWav(files[0]);
  const fi = parseWav(first);
  const bodies = [first.subarray(fi.dataOffset, fi.dataOffset + fi.frames * fi.frameBytes)];
  for (const f of files.slice(1)) {
    let b = await decodeWav(f);
    let i = parseWav(b);
    if (i.sampleRate !== fi.sampleRate || i.channels !== fi.channels) { b = await decodeWav(f, fi.sampleRate, fi.channels); i = parseWav(b); }
    bodies.push(b.subarray(i.dataOffset, i.dataOffset + i.frames * i.frameBytes));
  }
  const body = Buffer.concat(bodies);
  fs.writeFileSync(outPath, makeWav(fi, body));
  return { durationSec: body.length / fi.frameBytes / fi.sampleRate };
}

/** 글자 무게 — 공백·문장부호는 소리가 없다 */
function textWeight(t) { return Math.max(1, String(t || '').replace(/[\s.,!?;:…·'"“”‘’()\[\]{}<>「」『』《》〈〉\-—~]/g, '').length); }

/**
 * 자를 자리(초) 고르기 — 순수 함수(테스트용).
 * @param env  envelope(buf) 결과 { rms, hop, peak }
 * @param totalSec 전체 길이
 * @param weights  조각별 글자 무게(n개) → n-1 개 자리
 * @returns number[] 자를 시각(초, 오름차순)
 */
function pickCuts(env, totalSec, weights, { quiet = 0.08, minPause = 0.08 } = {}) {
  const { rms, hop, peak } = env;
  const n = weights.length;
  if (n < 2) return [];
  // 말 구간(앞 고정 패딩·끝 「문장 뒤 무음」 제외) — 비율은 말에 대해 잡는다
  const th = peak * quiet;
  let a = rms.findIndex((v) => v >= th), b = -1;
  for (let i = rms.length - 1; i >= 0; i--) if (rms[i] >= th) { b = i; break; }
  if (a < 0 || b < 0 || !(peak > 0)) { a = 0; b = Math.max(0, rms.length - 1); }
  const sA = a * hop, sB = (b + 1) * hop, speech = Math.max(0.01, sB - sA);
  // 쉼 목록(말 구간 안)
  const need = Math.max(1, Math.round(minPause / hop));
  const pauses = [];
  for (let i = a; i <= b; i++) {
    if (rms[i] >= th) continue;
    let j = i; while (j <= b && rms[j] < th) j++;
    if (j - i >= need) pauses.push({ s: i * hop, e: j * hop, len: (j - i) * hop });
    i = j;
  }
  const W = weights.reduce((x, y) => x + y, 0);
  const cuts = [];
  let acc = 0, lo = sA + 0.05;
  for (let k = 0; k < n - 1; k++) {
    acc += weights[k];
    const target = sA + speech * (acc / W);
    const hi = sB - 0.05 * (n - 1 - k);
    const win = speech * 0.3;
    let best = null, bestD = Infinity;
    for (const p of pauses) {
      const c = (p.s + p.e) / 2;
      if (c <= lo || c >= hi) continue;
      const d = Math.abs(c - target) - Math.min(p.len, 0.4) * 0.25;   // 긴 쉼을 조금 더 선호
      if (Math.abs(c - target) <= win && d < bestD) { bestD = d; best = c; }
    }
    if (best == null) {
      // 쉼이 없다 → 목표 ±15% 안에서 가장 조용한 순간
      const w2 = speech * 0.15;
      let mi = -1, mv = Infinity;
      for (let i = Math.max(0, Math.floor((target - w2) / hop)); i <= Math.min(rms.length - 1, Math.ceil((target + w2) / hop)); i++) {
        const t = (i + 0.5) * hop; if (t <= lo || t >= hi) continue;
        if (rms[i] < mv) { mv = rms[i]; mi = i; }
      }
      best = mi >= 0 ? (mi + 0.5) * hop : Math.min(Math.max(target, lo + 0.01), hi - 0.01);
    }
    best = Math.max(lo + 0.01, Math.min(best, Math.min(totalSec, hi) - 0.01));
    cuts.push(Math.round(best * 1000) / 1000);
    lo = best;
  }
  return cuts;
}

/**
 * 한 음성을 texts 조각 수만큼 나눠 outPaths(.wav)에. → [{ path, durationSec }]
 */
async function splitAudio(file, texts, outPaths) { return splitAudioWeights(file, texts.map(textWeight), outPaths); }
/** 글자 무게(조각별 숫자)로 나누기 — 문장 재구성(클립 끌어올리기)에서 조각 글자 수를 그대로 준다 */
async function splitAudioWeights(file, weights, outPaths) {
  const texts = weights;
  const buf = await decodeWav(file);
  const info = parseWav(buf);
  const env = envelope(buf, 0.01);
  const cuts = pickCuts(env, info.durationSec, weights);
  const bounds = [0, ...cuts, info.durationSec];
  const res = [];
  for (let k = 0; k < texts.length; k++) {
    const f0 = Math.round(bounds[k] * info.sampleRate), f1 = Math.round(bounds[k + 1] * info.sampleRate);
    const body = buf.subarray(info.dataOffset + f0 * info.frameBytes, info.dataOffset + Math.min(info.frames, f1) * info.frameBytes);
    fs.mkdirSync(path.dirname(outPaths[k]), { recursive: true });
    fs.writeFileSync(outPaths[k], makeWav(info, body));
    res.push({ path: outPaths[k], durationSec: body.length / info.frameBytes / info.sampleRate });
  }
  return res;
}

module.exports = { decodeWav, makeWav, concatAudio, splitAudio, splitAudioWeights, pickCuts, textWeight };
