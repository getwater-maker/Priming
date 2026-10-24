// 🔤 단어 시각 정렬 패스 (Lab · 차이표 #10) — 문장들의 음성을 읽어 어절 경계(s.wt)를 맞춘다. main 전용(파일·ffmpeg).
//   계산은 core/word-align(순수) · 여기는 음성 읽기와 문장에 적용하는 일.
//   채널 `wordAlign` 이 켜졌을 때만 · 한국어 문장만 · 끄면 s.wt 를 지운다(= 예전 글자 비례로 돌아간다).
//   부르는 곳: P.quietPass(음성이 바뀌는 모든 자리 — fillTtsList 끝 · 4단계 · export-vrew · 클립 배속) — 쉼 줄이기·배속 **뒤**에(최종 음성 파일 기준).
const fs = require('fs');
const WA = require('./word-align');

// WAV(PCM16) 를 직접 읽는다(TTS 출력은 24kHz 모노 WAV — ffmpeg 를 띄우지 않는다). 다른 꼴이면 null.
function readWavPcm(file) {
  let b; try { b = fs.readFileSync(file); } catch { return null; }
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null;
  let o = 12, rate = 0, ch = 1, bits = 16, fmt = 1, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { fmt = b.readUInt16LE(o + 8); ch = b.readUInt16LE(o + 10); rate = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22); }
    if (id === 'data') { data = b.subarray(o + 8, o + 8 + Math.min(sz, b.length - o - 8)); break; }
    o += 8 + sz + (sz & 1);
  }
  if (!data || fmt !== 1 || bits !== 16 || !(ch >= 1) || !(rate > 0)) return null;
  const n = Math.floor(data.length / 2 / ch), pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = data.readInt16LE(i * 2 * ch);
  return { pcm, rate };
}

/**
 * 문장들의 정렬을 지금 설정·음성에 맞춘다 → { aligned, cleared, skipped, failed }
 *   opts: { ffmpegPath(wav 가 아닐 때 읽기), onLine, abortSignal }
 */
async function ensureSentences(sentences, preset, opts = {}) {
  const r = { aligned: 0, cleared: 0, skipped: 0, failed: 0 };
  const on = !!(preset && preset.wordAlign);
  const Lang = require('./lang');
  for (const s of sentences || []) {
    if (opts.abortSignal && opts.abortSignal()) break;
    if (!s) continue;
    if (!on) { if (s.wt) { delete s.wt; r.cleared++; } continue; }
    if (!s.ttsAudioPath || !(s.ttsDurationSec > 0) || Lang.detectLang(s.text) !== 'ko') { if (s.wt) { delete s.wt; r.cleared++; } r.skipped++; continue; }
    const toks = WA.tokenize(s.text);
    if (toks.length < 2) { if (s.wt) { delete s.wt; r.cleared++; } r.skipped++; continue; }   // 어절 하나 = 맞출 안쪽 경계가 없다
    const k = WA.keyOf(s);
    if (s.wt && s.wt.k === k && (s.wt.f || (Array.isArray(s.wt.b) && s.wt.b.length === toks.length + 1))) continue;   // 이미 이 음성에 맞춰 둠(또는 해 봤는데 안 되는 소리 — f:1)
    let a = /\.wav$/i.test(s.ttsAudioPath) ? readWavPcm(s.ttsAudioPath) : null;
    if (!a && opts.ffmpegPath) { const pcm = await require('./quiet-trim').decodePcm(s.ttsAudioPath, opts.ffmpegPath); if (pcm) a = { pcm, rate: 24000 }; }
    if (!a) { r.failed++; s.wt = { k, f: 1 }; continue; }   // f:1 = 해 봤는데 안 됨 — 같은 음성을 다시 읽지 않는다(음성·글이 바뀌면 열쇠가 달라져 다시 한다)
    const b = WA.alignBounds(a.pcm, a.rate, toks, s.ttsDurationSec);
    if (!b) { r.failed++; s.wt = { k, f: 1 }; continue; }   // 소리가 너무 짧거나 거의 없다 — 예전 글자 비례
    s.wt = { k, b: b.map((x) => Math.round(x * 1000) / 1000) };
    r.aligned++;
  }
  return r;
}

// 지금 맞출 필요가 있는가(자동 재정렬 판정 — 파일을 읽지 않는다): 음성 있음 · 한국어 · 어절 2개 이상 · 이 음성·글에 맞춘 결과(또는 f:1)가 없음
function needs(s) {
  if (!s || !s.ttsAudioPath || !(s.ttsDurationSec > 0)) return false;
  if (s.wt && s.wt.k === WA.keyOf(s)) return false;
  if (require('./lang').detectLang(s.text) !== 'ko') return false;
  return WA.tokenize(s.text).length >= 2;
}

/**
 * 단어 지우기(#11) — 음성 파일에서 어절 j0..j1-1 의 소리를 들어내 **새 파일**로 쓴다(원본은 그대로 — Ctrl+Z 가 옛 소리로 돌아간다).
 *   → { ok, dur, removedSec, cut:[t0,t1] } | { ok:false, error }
 *   opts: { src, bounds(s.wt.b), j0, j1, outPath, ffmpegPath }
 */
async function deleteWordsAudio(opts) {
  const { src, bounds, j0, j1, outPath, ffmpegPath } = opts || {};
  let a = /\.wav$/i.test(src || '') ? readWavPcm(src) : null;
  if (!a && ffmpegPath) { const pcm = await require('./quiet-trim').decodePcm(src, ffmpegPath); if (pcm) a = { pcm, rate: 24000 }; }
  if (!a) return { ok: false, error: '음성 파일을 읽지 못했습니다' };
  const c = WA.cutWords(a.pcm, a.rate, bounds, j0, j1);
  if (!c) return { ok: false, error: '지울 소리를 찾지 못했습니다(너무 짧거나 문장 전체입니다)' };
  const QT = require('./quiet-trim');
  try {
    const tmp = outPath + '.tmp';
    fs.writeFileSync(tmp, QT.wavOf(c.pcm, a.rate));
    fs.renameSync(tmp, outPath);
  } catch (e) { return { ok: false, error: '음성을 저장하지 못했습니다: ' + e.message }; }
  return { ok: true, dur: c.pcm.length / a.rate, removedSec: c.removedSec, cut: c.cut };
}

module.exports = { readWavPcm, ensureSentences, needs, deleteWordsAudio };
