// 🔤 단어 시각 정렬 (Lab · Vrew 차이표 #10) — 문장 글과 그 음성(PCM)으로 어절 경계 시각을 구한다. 서버·받아쓰기를 쓰지 않는다.
//   왜 서버(Whisper 단어 시각)가 아닌가 — 실측(2026-10-24 · 실제 TTS 음성 5개 · 경계 81개 · 별도 프로세스 CPU):
//     · Whisper 단어 시각 그대로 = 글자 수 비례보다 오히려 「깨끗한 컷」이 적다(10dB 이상 낙차 37% 대 56%) · 첫 단어 시작은 늘 0.0초(실제 소리 시작 ≈0.2초)
//     · 어느 쪽이든 소리가 가장 작은 자리에 붙이면 84~90% 가 깨끗한 컷(말 한복판 9% → 0~1%) · 이동량 평균 50ms·최대 83ms
//   그래서 소리를 직접 본다: ① 말이 있는 구간(앞뒤 여백·문장무음 제외)만 글자 수 비례 ② 쉼표·마침표 뒤는 실제 쉼의 가운데 ③ 그 밖은 가까운 에너지 골짜기.
//   ⚠ 정확한 「단어 경계」는 보장하지 않는다 — 깨끗하게 자를 수 있는 자리까지다(독립 추정끼리 같은 골짜기를 고른 비율은 40ms 이내 36%).
//   🔑 한국어 문장만(ko) — 가나·한자·베트남어는 글자 수가 말소리 길이와 거리가 멀다(건드리지 않는다 = 예전 글자 비례 그대로).
//   ⚠ 렌더러 번들에 들어갈 수 있다 — 이 파일은 require·fs 없이 순수 계산만(파일 읽기는 core/word-align-pass).
const VER = 1;                 // 판정을 바꾸면 올린다(옛 결과를 다시 계산한다)
const FR = 0.005;              // 5ms 프레임
const SPEECH_DROP_DB = 30;     // 말 = 대표음량 −30dB 보다 큰 소리
const MIN_PAUSE = 0.09;        // 이보다 긴 정적 = 쉼
const LONG_PAUSE = 0.15;       // 부호가 없어도 이만큼 길면 낱말 경계로 본다
const PAUSE_TOL = 0.30;        // 부호 뒤 경계가 쉼을 찾는 거리
const LONG_PAUSE_TOL = 0.15;
const SNAP_WIN = 0.08;         // 골짜기 찾는 거리
const MIN_WORD = 0.04;         // 어절 최소 길이
const MIN_SPEECH = 0.3;        // 말이 이보다 짧으면 판단하지 않는다

function charWeight(ch) {
  if (/\s/.test(ch)) return 0;
  if (/[\p{P}\p{S}]/u.test(ch)) return 0;   // 문장부호·기호는 소리가 없다
  if (/\d/.test(ch)) return 1.5;            // 숫자는 한글보다 길게 읽힌다(1989 → 천구백팔십구)
  if (/[A-Za-z]/.test(ch)) return 0.8;
  return 1;                                 // 한글 한 글자 = 한 음절
}
// 문장 → 어절(공백으로 가른 덩어리) · 글 위치와 소리 무게 · 쉼표·마침표로 끝나는지
function tokenize(text) {
  const out = [];
  const re = /\S+/g; let m;
  const s = String(text || '');
  while ((m = re.exec(s))) {
    let w = 0; for (const ch of m[0]) w += charWeight(ch);
    const core = m[0].replace(/["'”’)\]」』]+$/u, '');
    out.push({ from: m.index, to: m.index + m[0].length, rw: w, w: Math.max(w, 0.3), pause: /[,.;:!?…、。，；：！？—]$/u.test(core) });
  }
  return out;
}
function textKey(text) { let h = 0; const s = String(text || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

function dbFrames(pcm, rate) {
  const n = Math.max(1, Math.round(rate * FR));
  const out = new Float32Array(Math.floor(pcm.length / n));
  for (let k = 0; k < out.length; k++) {
    let s = 0; const a = k * n;
    for (let i = a; i < a + n; i++) s += pcm[i] * pcm[i];
    const rms = Math.sqrt(s / n);
    out[k] = rms > 0 ? 20 * Math.log10(rms / 32768) : -120;
  }
  return out;
}

// 소리 분석 → { db, thr, on, off, runs:[{a,b}] (프레임 번호 [a,b) · 쉼), cum(말 누적 프레임 수) } | null
function analyze(pcm, rate) {
  if (!pcm || pcm.length < rate * MIN_SPEECH) return null;
  const db = dbFrames(pcm, rate);
  // 대표음량 = 말 프레임(가장 큰 소리 −40dB 보다 큰 것)의 90% 지점 — 낮은 잡음·문장무음 프레임 수에 흔들리지 않게(2026-10-24 평가: 무음이 붙어도 경계가 안 밀려야 한다)
  let mx = -120; for (let i = 0; i < db.length; i++) if (db[i] > mx) mx = db[i];
  if (mx < -60) return null;   // 가장 큰 소리가 −60dB 보다 작으면 거의 무음 — 판단하지 않는다
  const loud = Array.from(db).filter((d) => d > mx - 40).sort((a, b) => a - b);
  if (loud.length < 20) return null;
  const ref = loud[Math.floor(loud.length * 0.9)];
  const thr = ref - SPEECH_DROP_DB;
  let on = -1, off = -1;
  for (let i = 0; i < db.length; i++) if (db[i] > thr) { on = i; break; }
  for (let i = db.length - 1; i >= 0; i--) if (db[i] > thr) { off = i + 1; break; }
  if (on < 0 || (off - on) * FR < MIN_SPEECH) return null;
  const minRun = Math.round(MIN_PAUSE / FR);
  const runs = [];
  for (let i = on; i < off;) {
    if (db[i] > thr) { i++; continue; }
    let j = i; while (j < off && db[j] <= thr) j++;
    if (j - i >= minRun) runs.push({ a: i, b: j });
    i = j;
  }
  // 말 누적(쉼 제외) — cum[i] = i 프레임 앞까지의 말 프레임 수
  const cum = new Float32Array(off + 1);
  let ri = 0, acc = 0;
  for (let i = 0; i < off; i++) {
    while (ri < runs.length && i >= runs[ri].b) ri++;
    const inRun = ri < runs.length && i >= runs[ri].a && i < runs[ri].b;
    if (i >= on && !inRun) acc++;
    cum[i + 1] = acc;
  }
  return { db, thr, on, off, runs, cum, total: acc };
}
function invCum(cum, target) {   // cum[i] >= target 인 첫 프레임
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] >= target) hi = mid; else lo = mid + 1; }
  return lo;
}
function localMin(db, f, win) {
  const i0 = Math.max(0, f - win), i1 = Math.min(db.length - 1, f + win);
  let best = f, bv = Infinity;
  for (let i = i0; i <= i1; i++) { const v = db[i] + Math.abs(i - f) * 0.02; if (v < bv) { bv = v; best = i; } }   // 같은 깊이면 가까운 쪽
  return best;
}

/**
 * 어절 경계 시각 — 길이 n+1 배열 b: b[0]=0 · b[n]=durSec(파일 끝) · 사이는 소리로 맞춘 자리(초). 못 구하면 null.
 *   tokens = tokenize(text)(어절 n 개)
 */
function alignBounds(pcm, rate, tokens, durSec) {
  const n = tokens.length;
  if (n < 1) return null;
  const A = analyze(pcm, rate);
  if (!A) return null;
  const dur = durSec > 0 ? durSec : pcm.length / rate;
  const b = new Array(n + 1).fill(0);
  b[n] = dur;
  if (n === 1) return b;
  const totalW = tokens.reduce((s, t) => s + t.w, 0) || 1;
  let cw = 0, lastRun = -1;
  for (let k = 1; k < n; k++) {
    cw += tokens[k - 1].w;
    const tgt = A.total * (cw / totalW);
    const f0 = Math.min(A.off, invCum(A.cum, tgt));     // 글자 비례가 가리키는 프레임(말 구간 기준)
    let f = -1;
    // 쉼 — 부호 뒤는 멀리까지 · 부호가 없어도 긴 쉼이 가까이 있으면
    const strong = tokens[k - 1].pause;
    const tol = Math.round((strong ? PAUSE_TOL : LONG_PAUSE_TOL) / FR);
    let bestRun = -1, bestD = Infinity;
    for (let r = lastRun + 1; r < A.runs.length; r++) {
      const run = A.runs[r];
      if (!strong && (run.b - run.a) * FR < LONG_PAUSE) continue;
      const c = (run.a + run.b) >> 1, d = Math.abs(c - f0);
      if (c > f0 + tol) break;
      if (d <= tol && d < bestD) { bestD = d; bestRun = r; }
    }
    if (bestRun >= 0) { f = (A.runs[bestRun].a + A.runs[bestRun].b) >> 1; lastRun = bestRun; }
    else f = localMin(A.db, f0, Math.round(SNAP_WIN / FR));
    b[k] = (f + 0.5) * FR;
  }
  // 순서·최소 길이 보장
  for (let k = 1; k < n; k++) b[k] = Math.max(b[k], b[k - 1] + MIN_WORD);
  for (let k = n - 1; k >= 1; k--) b[k] = Math.min(b[k], b[k + 1] - MIN_WORD);
  for (let k = 1; k < n; k++) if (!(b[k] > b[k - 1])) return null;
  return b;
}

// 글자 위치 → 시각 — 어절 경계는 정렬 값 · 어절 안은 글자 무게 비례 · 어절 사이 공백은 다음 어절 시작
function timeMapper(text, bounds) {
  const toks = tokenize(text);
  if (!bounds || bounds.length !== toks.length + 1) return null;
  // 어절 안 위치 = 그 어절 앞부터 idx 까지 글자 무게 / 어절 전체 무게(무게 0 인 부호뿐인 어절은 가운데)
  const frac = (tk, idx) => { if (!(tk.rw > 0)) return 0.5; let w = 0; for (const ch of String(text).slice(tk.from, idx)) w += charWeight(ch); return Math.min(1, w / tk.rw); };
  return (idx) => {
    if (idx <= 0) return bounds[0];
    for (let j = 0; j < toks.length; j++) {
      const tk = toks[j];
      if (idx <= tk.from) return bounds[j];              // 어절 앞(공백 포함) = 그 어절 시작
      if (idx < tk.to) return bounds[j] + (bounds[j + 1] - bounds[j]) * frac(tk, idx);
    }
    return bounds[bounds.length - 1];
  };
}

// ── 문장에 붙은 정렬(s.wt = { k, b })을 쓰는 쪽(.vrew 빌더 · SRT · 화면 DTO)이 공유하는 규칙 ─────────────────────────────
//   열쇠 k = 버전 · 음성 경로 · 음성 길이 · 글 — 음성을 다시 만들거나 쉼 줄이기·배속으로 바뀌거나 글을 고치면 어긋나 **쓰지 않는다**(= 예전 글자 비례로 돌아간다).
function keyOf(s) { return `${VER}|${s.ttsAudioPath || ''}|${(+s.ttsDurationSec || 0).toFixed(4)}|${textKey(s.text)}`; }
// 유효한 어절 경계(길이 n+1) | null · 막간 쉼으로 음성이 덧대진 복제본은 경로가 달라 열쇠가 안 맞으므로 원본에서 미리 뽑은 `_wtB` 를 먼저 본다
function validBounds(s) {
  if (!s) return null;
  if (Array.isArray(s._wtB)) return s._wtB;
  const w = s.wt;
  if (!w || !Array.isArray(w.b) || w.k !== keyOf(s)) return null;
  return w.b.length === tokenize(s.text).length + 1 ? w.b : null;
}
// 파일 끝 시각을 지금 음성 길이(막간 쉼 덧댐 포함)로 바꾼 글자→시각 함수 | null
function mapperFor(s, dur) {
  const b = validBounds(s); if (!b) return null;
  const bb = b.slice(); bb[bb.length - 1] = dur;
  return timeMapper(s.text, bb);
}
// 줄 시작 시각 — 길이 줄 수+1: [0, 줄2 시작, …, dur] (문장 음성 시작 기준 초) · 정렬이 없거나 어긋나면 null(호출부가 예전 글자 비례)
//   ranges = core/caption-format.lineRanges(text, lines) 의 {from,to}
//   🔑 줄 구분은 **쓰는 쪽이 정한다**(.vrew = 채널 captionMaxChars · ② 화면 = 설정 줄 글자 수 · DTO 프로필 값이 서로 다를 수 있다) — 그래서 어절 경계(bounds)만 나눠 갖고 줄 경계는 각자 같은 이 함수로 계산한다.
function offsetsFor(text, bounds, ranges, dur) {
  if (!ranges || !ranges.length || !(dur > 0) || !Array.isArray(bounds)) return null;
  const bb = bounds.slice(); bb[bb.length - 1] = dur;
  const T = timeMapper(text, bb); if (!T) return null;
  const out = [0];
  for (let i = 1; i < ranges.length; i++) out.push(T(ranges[i].from));
  out.push(dur);
  for (let i = 1; i < out.length; i++) if (!(out[i] >= out[i - 1])) return null;
  return out;
}
function lineOffsets(s, ranges, dur) { const b = validBounds(s); return b ? offsetsFor(s.text, b, ranges, dur) : null; }

module.exports = { VER, FR, charWeight, tokenize, textKey, analyze, alignBounds, timeMapper, keyOf, validBounds, mapperFor, offsetsFor, lineOffsets };
