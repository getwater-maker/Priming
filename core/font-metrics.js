'use strict';
/**
 * font-metrics.js — TTF/OTF 글자 폭 측정(순수 JS · 의존성 없음 · 2026-10-12 v0.8.2 정보 카드)
 *   ASS 는 글자 폭을 알려 주지 않는다 → 표 칸 너비·줄바꿈·판 폭을 정하려면 **미리 재야** 한다. 글꼴 파일의 cmap(글자→글리프) + hmtx(글리프 폭)만 읽는다.
 *   · cmap 형식 4(BMP) · 12(전체) · 글꼴에 없는 글자는 평균 폭(한글·한자 = 1em · 그 밖 0.6em)으로 어림.
 *   · 자간(\\fsp)·굵게 합성은 호출하는 쪽이 더한다. 커닝은 안 읽는다(한글 고정폭에 가까워 영향이 작다).
 *   main 전용(fs) — 렌더러 번들에 넣지 말 것.
 */
const fs = require('fs');
const cache = new Map();

function readFont(file) {
  if (cache.has(file)) return cache.get(file);
  let f = null;
  try {
    const b = fs.readFileSync(file);
    const tag = b.toString('ascii', 0, 4);
    let base = 0;
    if (tag === 'ttcf') base = b.readUInt32BE(12);   // TrueType Collection — 첫 글꼴
    const n = b.readUInt16BE(base + 4);
    const tb = {};
    for (let i = 0; i < n; i++) { const o = base + 12 + i * 16; tb[b.toString('ascii', o, o + 4)] = { off: b.readUInt32BE(o + 8), len: b.readUInt32BE(o + 12) }; }
    const upem = b.readUInt16BE(tb.head.off + 18) || 1000;
    const nh = b.readUInt16BE(tb.hhea.off + 34);
    const hm = tb.hmtx.off;
    const adv = (gid) => b.readUInt16BE(hm + 4 * Math.min(gid, nh - 1));
    // cmap — 형식 12 > 4 (Windows 유니코드)
    const cm = tb.cmap.off, nt = b.readUInt16BE(cm + 2);
    let best = null;
    for (let i = 0; i < nt; i++) {
      const pid = b.readUInt16BE(cm + 4 + i * 8), eid = b.readUInt16BE(cm + 6 + i * 8), off = cm + b.readUInt32BE(cm + 8 + i * 8);
      const fmt = b.readUInt16BE(off);
      const score = (pid === 3 && eid === 10 && fmt === 12) ? 4 : (pid === 0 && fmt === 12) ? 3 : (pid === 3 && eid === 1 && fmt === 4) ? 2 : (pid === 0 && fmt === 4) ? 1 : 0;
      if (score && (!best || score > best.score)) best = { score, off, fmt };
    }
    const gidOf = (cp) => {
      if (!best) return 0;
      const o = best.off;
      if (best.fmt === 12) {
        const ng = b.readUInt32BE(o + 12);
        let lo = 0, hi = ng - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1, g = o + 16 + mid * 12;
          const s = b.readUInt32BE(g), e = b.readUInt32BE(g + 4);
          if (cp < s) hi = mid - 1; else if (cp > e) lo = mid + 1; else return b.readUInt32BE(g + 8) + (cp - s);
        }
        return 0;
      }
      if (cp > 0xFFFF) return 0;
      const segX2 = b.readUInt16BE(o + 6), seg = segX2 / 2;
      const endO = o + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
      for (let s = 0; s < seg; s++) {
        const end = b.readUInt16BE(endO + s * 2);
        if (cp > end) continue;
        const start = b.readUInt16BE(startO + s * 2);
        if (cp < start) return 0;
        const delta = b.readInt16BE(deltaO + s * 2), ro = b.readUInt16BE(rangeO + s * 2);
        if (ro === 0) return (cp + delta) & 0xFFFF;
        const g = b.readUInt16BE(rangeO + s * 2 + ro + (cp - start) * 2);
        return g === 0 ? 0 : (g + delta) & 0xFFFF;
      }
      return 0;
    };
    f = { upem, adv, gidOf, memo: new Map() };
  } catch (_) { f = null; }
  cache.set(file, f);
  return f;
}

/** 글자 하나의 폭(em 단위 · 글꼴에 없으면 어림) */
function emOf(font, ch) {
  const cp = ch.codePointAt(0);
  if (font.memo.has(cp)) return font.memo.get(cp);
  let w;
  const gid = font.gidOf(cp);
  if (gid) w = font.adv(gid) / font.upem;
  else if (cp === 0x20) w = 0.3;
  else w = (cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0x2E80 && cp <= 0xD7FF) || (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0xFF00 && cp <= 0xFFEF) ? 1 : 0.6;
  font.memo.set(cp, w);
  return w;
}

/**
 * 글 폭(px). opts = { spacing(px · 자간), bold(합성 굵게 — 폭 +2%) }.
 * @returns {number} 글꼴을 못 읽으면 어림(글자 수 × size × 0.8)
 */
function measure(file, text, size, opts = {}) {
  const font = readFont(file);
  const s = String(text == null ? '' : text);
  if (!font) return Math.ceil([...s].length * size * 0.8);
  let w = 0, n = 0;
  for (const ch of s) { w += emOf(font, ch) * size; n++; }
  w += (opts.spacing || 0) * n;
  return Math.ceil(w * (opts.bold ? 1.02 : 1));
}

/**
 * 폭 maxW 안에 들어가게 줄바꿈 — 공백에서 끊고, 한 낱말이 넘치면 글자 단위로. 반환 = 줄 배열.
 *   maxLines 를 넘으면 { lines, overflow:true } 가 아니라 그냥 줄을 돌려준다(호출하는 쪽이 판단 · 조용히 자르지 않는다).
 */
function wrap(file, text, size, maxW, opts = {}) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  const fits = (t) => measure(file, t, size, opts) <= maxW;
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (fits(t)) { cur = t; continue; }
    if (cur) { lines.push(cur); cur = ''; }
    if (fits(w)) { cur = w; continue; }
    // 한 낱말이 한 줄보다 길다 — 글자 단위
    let piece = '';
    for (const ch of w) { if (fits(piece + ch)) piece += ch; else { if (piece) lines.push(piece); piece = ch; } }
    cur = piece;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

module.exports = { readFont, measure, wrap };
