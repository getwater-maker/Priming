// ✂ 쉼 줄이기 (Lab · Vrew 차이표 #9 「무음 구간 줄이기」) — 문장 음성 안의 긴 쉼을 정한 길이로 줄인다.
//   채널 설정: quietMaxSec(문장 안 쉼 최대 · 0 = 끔) · quietEdge(문장 앞뒤 모델 여백도 줄임).
//
//   🔑 음성 파일을 고치지 않는다 — 줄인 **사본**(`<번호>_q.wav`)을 만들고 문장이 그쪽을 가리키게 한다.
//      s.quiet = { key, src, srcDur, out } 에 원본을 기억한다 → 설정을 끄면 원본으로 돌아가고,
//      Ctrl+Z 는 문장 객체(경로·길이·quiet)를 통째로 되돌리므로 한 번에 원래 음성이 된다.
//   🔑 길이는 사본 실측(샘플 수)으로 ttsDurationSec 에 쓴다 — 타임라인·챕터·SRT·.vrew 가 모두 이 값 하나를 본다(TTS.md 26줄).
//   🔑 판정 = 말 대표음량 −40dB 이하가 이어지는 곳(들숨 지우기 muteLeadBreath 의 정적 기준과 같다).
//      줄일 때는 쉼의 **가운데**를 들어내고 양쪽을 10ms 로 이어 붙인다(말 끝·말 시작은 한 샘플도 안 건드린다).
//   🔑 문장 뒤 「문장무음」(apad)은 줄이지 않는다 — 끝 여백을 줄일 때도 edge + 문장무음 만큼은 남긴다.
//   ⛔ 리미터·압축 아님(파형 자체는 그대로 · 지우기만) · ⛔ 원본 음성 파일을 지우거나 덮지 않는다.
const fs = require('fs');
const path = require('path');

const FRAME_MS = 10;
const GAP_DROP_DB = 40;       // 정적 = 말 대표음량 − 40dB 이하
const ABS_FLOOR_DB = -60;     // 대표음량이 이보다 작으면(거의 무음) 판단하지 않는다
const MIN_INNER_KEEP = 0.12;  // 문장 안 쉼은 이보다 짧게 줄이지 않는다
const EDGE_KEEP = 0.05;       // 앞뒤 여백을 줄일 때 남기는 길이
const XFADE_MS = 10;
const VER = 1;                // 판정을 바꾸면 올린다(옛 사본을 다시 만든다)

function keyOf(preset) {
  const m = Number(preset && preset.quietMaxSec);
  if (!(isFinite(m) && m > 0)) return '';
  const max = Math.max(MIN_INNER_KEEP, Math.min(3, m));
  const pad = Number(preset && preset.silenceSec) > 0 ? Math.min(5, Number(preset.silenceSec)) : 0;
  return `v${VER}m${max.toFixed(2)}e${preset.quietEdge ? 1 : 0}p${pad.toFixed(2)}`;
}
function parseKey(key) {
  const m = /^v\d+m([\d.]+)e([01])p([\d.]+)$/.exec(String(key || ''));
  return m ? { maxGap: +m[1], edge: m[2] === '1', pad: +m[3] } : null;
}

function _db(rms) { return rms > 0 ? 20 * Math.log10(rms / 32768) : -120; }
function frameDbs(pcm, rate) {
  const n = Math.max(1, Math.round(rate * FRAME_MS / 1000));
  const out = [];
  for (let i = 0; i < pcm.length; i += n) {
    let s = 0; const e = Math.min(pcm.length, i + n);
    for (let k = i; k < e; k++) s += pcm[k] * pcm[k];
    out.push(_db(Math.sqrt(s / Math.max(1, e - i))));
  }
  return { dbs: out, n };
}

// 모노 PCM16 → { pcm, cuts, removedSec } | null(줄일 것 없음·판단 불가)
function compactPcm(pcm, rate, { maxGap, edge, pad = 0 }) {
  if (!pcm || pcm.length < rate * 0.2) return null;
  const { dbs, n } = frameDbs(pcm, rate);
  const loud = dbs.filter((d) => d > -90).sort((a, b) => a - b);
  if (loud.length < 5) return null;
  const speech = loud[Math.floor(loud.length * 0.9)];    // 대표음량 = 상위 10% 지점
  if (speech < ABS_FLOOR_DB) return null;                     // 말소리가 너무 작다 = 판단하지 않는다
  const silent = dbs.map((d) => d <= speech - GAP_DROP_DB);
  // 정적 구간(프레임 단위 · [a, b) )
  const runs = [];
  for (let i = 0; i < silent.length;) {
    if (!silent[i]) { i++; continue; }
    let j = i; while (j < silent.length && silent[j]) j++;
    runs.push([i, j]); i = j;
  }
  if (!runs.length) return null;
  const total = pcm.length;
  const keepFrames = (sec) => Math.round(sec * 1000 / FRAME_MS);
  const cuts = [];   // [startSample, endSample) 들어낼 곳
  for (const [a, b] of runs) {
    const len = b - a;
    const isLead = a === 0, isTail = b >= silent.length;
    if (isLead && isTail) return null;   // 전부 정적 = 판단하지 않는다
    if (isLead) {
      if (!edge) continue;
      const k = keepFrames(EDGE_KEEP);
      if (len > k + 2) cuts.push([0, (len - k) * n]);
    } else if (isTail) {
      if (!edge) continue;
      const k = keepFrames(EDGE_KEEP + pad);
      if (len > k + 2) cuts.push([(a + k) * n, total]);
    } else {
      const k = keepFrames(Math.max(MIN_INNER_KEEP, maxGap));
      if (len > k + 2) { const half = Math.floor(k / 2); cuts.push([(a + half) * n, (b - (k - half)) * n]); }
    }
  }
  if (!cuts.length) return null;
  const xf = Math.round(rate * XFADE_MS / 1000);
  const parts = []; let at = 0;
  for (const [s, e] of cuts) { if (s > at) parts.push([at, s]); at = Math.min(total, e); }
  if (at < total) parts.push([at, total]);
  const outLen = parts.reduce((m, [s, e]) => m + (e - s), 0);
  const out = new Int16Array(outLen);
  let w = 0;
  parts.forEach(([s, e], pi) => {
    for (let k = s; k < e; k++) {
      let v = pcm[k];
      if (pi > 0 && k - s < xf) v = Math.round(v * ((k - s) / xf));             // 이은 자리 들어오기
      if (pi < parts.length - 1 && e - k <= xf) v = Math.round(v * ((e - k) / xf)); // 이은 자리 나가기
      out[w++] = v;
    }
  });
  return { pcm: out, cuts: cuts.length, removedSec: (total - outLen) / rate };
}

function wavOf(pcm, rate) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// 아무 음성 파일(wav·mp3) → 모노 24kHz PCM16 (ffmpeg · 비동기 — main 을 멈추지 않는다)
function decodePcm(file, ffmpegPath, rate = 24000) {
  return new Promise((resolve) => {
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return resolve(null);
    const p = require('child_process').spawn(ffmpegPath, ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(rate), '-'], { windowsHide: true });
    const bufs = [];
    p.stdout.on('data', (d) => bufs.push(d));
    p.on('error', () => resolve(null));
    p.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const b = Buffer.concat(bufs);
      const ab = new ArrayBuffer(b.length - (b.length % 2)); const v = new Uint8Array(ab); v.set(b.subarray(0, ab.byteLength));
      resolve(new Int16Array(ab));
    });
  });
}

// ⏩ 클립 배속(Lab · 차이표 #13) — 문장마다 s.clipSpeed(0.5~2 · 1 = 없음). 같은 사본 체인의 마지막 단계:
//   원본 → (쉼 줄이기) → (배속) → `<번호>_q.wav`. 🔑 문장 뒤 문장무음(apad — 끝의 정확한 0 샘플)은 빠르게 하지 않는다(클립 간격은 채널 값 그대로).
const SPEEDS = [0.5, 0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.5, 2];
function normSpeed(v) { const n = Number(v); return (isFinite(n) && n >= 0.5 && n <= 2) ? Math.round(n * 100) / 100 : 1; }
// 문장 하나의 사본 열쇠 — '' = 원본 그대로
function sentKey(preset, s) {
  const q = keyOf(preset), sp = normSpeed(s && s.clipSpeed);
  return q + (sp !== 1 ? `|s${sp.toFixed(2)}` : '');
}
function trailingZeros(pcm) { let z = 0; for (let i = pcm.length - 1; i >= 0 && pcm[i] === 0; i--) z++; return z; }
// PCM 에 atempo(ffmpeg · 비동기) — 끝의 정확한 0(문장무음)은 떼어 두었다가 그대로 붙인다
function tempoPcm(pcm, speed, ffmpegPath, rate = 24000) {
  return new Promise((resolve) => {
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return resolve(null);
    const z = Math.min(trailingZeros(pcm), Math.max(0, pcm.length - rate * 0.1));
    const head = pcm.subarray(0, pcm.length - z);
    const p = require('child_process').spawn(ffmpegPath, ['-v', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', '-', '-af', `atempo=${speed}`, '-f', 's16le', '-ar', String(rate), '-ac', '1', '-'], { windowsHide: true });
    const bufs = [];
    p.stdout.on('data', (d) => bufs.push(d));
    p.on('error', () => resolve(null));
    p.stdin.on('error', () => {});
    p.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const b = Buffer.concat(bufs); const n = Math.floor(b.length / 2);
      const out = new Int16Array(n + z);
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(i * 2);
      resolve(out);   // 뒤 z 개는 0(문장무음 그대로)
    });
    p.stdin.end(Buffer.from(head.buffer, head.byteOffset, head.byteLength));
  });
}

/**
 * 문장들에 지금 설정(쉼 줄이기 · 클립 배속)을 맞춘다 → { changed, cut, restored, removedSec, sped, failed }
 *   opts: { ffmpegPath, claimPath(want, own), onLine, abortSignal }
 */
async function ensureSentences(sentences, preset, ttsDir, opts = {}) {
  const K = parseKey(keyOf(preset));
  const r = { changed: 0, cut: 0, restored: 0, removedSec: 0, sped: 0, failed: 0 };
  for (const s of sentences || []) {
    if (opts.abortSignal && opts.abortSignal()) break;
    if (!s || !s.ttsAudioPath) continue;
    const key = sentKey(preset, s);
    const q = s.quiet;
    const derived = !!(q && q.out && s.ttsAudioPath === q.out && q.src && fs.existsSync(q.src));
    if (derived && q.key === key) continue;                       // 이미 이 설정
    const raw = derived ? q.src : s.ttsAudioPath;
    const rawDur = derived ? q.srcDur : s.ttsDurationSec;
    if (!key) {                                                    // 끔 → 원본으로
      if (derived) { s.ttsAudioPath = raw; s.ttsDurationSec = rawDur; r.restored++; r.changed++; }
      delete s.quiet;
      continue;
    }
    if (!fs.existsSync(raw)) continue;
    let pcm = await decodePcm(raw, opts.ffmpegPath);
    if (!pcm) { r.failed++; delete s.quiet; continue; }
    let touched = false, cuts = 0;
    if (K) { const c = compactPcm(pcm, 24000, K); if (c) { pcm = c.pcm; touched = true; cuts = c.cuts; } }
    const sp = normSpeed(s.clipSpeed);
    if (sp !== 1) {
      const t = await tempoPcm(pcm, sp, opts.ffmpegPath);
      if (!t) { r.failed++; if (opts.onLine) opts.onLine(`⚠ 컷${s.num} 배속 ${sp}× 실패 — 원래 빠르기 그대로`); }
      else { pcm = t; touched = true; r.sped++; }
    }
    if (!touched) {                                                // 바꿀 것 없음 — 원본 그대로 이 설정으로 표시
      s.quiet = { key, src: raw, srcDur: rawDur, out: raw };
      if (derived) { s.ttsAudioPath = raw; s.ttsDurationSec = rawDur; r.changed++; }
      continue;
    }
    try {
      // 🔑 이름에 「설정 + 원본 신원」 지문 — 설정을 바꿔도 옛 사본을 덮지 않는다(Ctrl+Z 가 옛 경로로 돌아가면 옛 내용이 그대로 있어야 한다)
      let rid = raw; try { const st = fs.statSync(raw); rid += '|' + st.size + '|' + Math.round(st.mtimeMs); } catch {}
      const tag = require('crypto').createHash('sha1').update(key + '|' + rid).digest('hex').slice(0, 8);
      const want = path.join(ttsDir, `${s.num}_q${tag}.wav`);
      const out = opts.claimPath ? opts.claimPath(want, fs.existsSync(want) ? want : null) : want;
      const tmp = out + '.tmp';
      fs.writeFileSync(tmp, wavOf(pcm, 24000));
      fs.renameSync(tmp, out);
      s.quiet = { key, src: raw, srcDur: rawDur, out };
      s.ttsAudioPath = out;
      s.ttsDurationSec = pcm.length / 24000;
      r.changed++; r.cut += cuts; r.removedSec += (rawDur || 0) - s.ttsDurationSec;
    } catch (e) { r.failed++; if (opts.onLine) opts.onLine(`⚠ 컷${s.num} 음성 사본 쓰기 실패: ${e.message}`); }
  }
  return r;
}

module.exports = { keyOf, parseKey, sentKey, normSpeed, SPEEDS, tempoPcm, compactPcm, wavOf, decodePcm, ensureSentences, VER };
