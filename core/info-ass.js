'use strict';
/**
 * info-ass.js — 📇 정보 카드 판 그리기(ASS) — 2026-10-12 v0.8.2
 *   core/info-cards.plan 이 준 판 [{type:'cover'|'words'|'table'|'check', t0, t1, …}] → 자막 층 Dialogue 줄.
 *   · 글자 폭은 core/font-metrics 로 **미리 재서** 판 크기·표 칸 너비·줄바꿈을 정한다(ASS 는 폭을 모른다).
 *   · 시니어 가독성: 글자 ≥ 66px(화면 높이 6.1%) · 판 위치 고정(오른쪽) · 페이드만(0.5초) · 명암 대비 높음 · 강조색 하나.
 *   · 층: 전체 화면 바탕(구간 표지·표) = 0(자막 아래) · 오른쪽 판 바탕 = 5 · 글자 = 8.
 *   main(렌더) 전용 — fs 를 쓰는 font-metrics 에 기댄다. 렌더러 번들에 넣지 말 것.
 */
const path = require('path');
const FM = require('./font-metrics');

const W = 1920, H = 1080;
const FONT_FILE = path.join(__dirname, '..', 'assets', 'fonts', 'Pretendard-Bold.ttf');
const C = { bg: '0F131C', panel: '121826', text: 'F4F1EA', dim: '8E96A3', accent: 'FFD166', line: 'FFFFFF' };
const FS = 66;                 // 기본 글자 크기(화면 높이 6.1%)
const FADE = 0.5;

const bgr = (hex) => `${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`;
const fmtT = (sec) => { const cs = Math.max(0, Math.round((+sec || 0) * 100)); return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, '0')}:${String(Math.floor((cs % 6000) / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, ' ');
const alphaHex = (op, max) => Math.max(0, Math.min(255, Math.round(255 * (1 - Math.max(0, Math.min(1, op)) * max)))).toString(16).padStart(2, '0').toUpperCase();
const mw = (t, fs, spacing = 0) => FM.measure(FONT_FILE, t, fs, { bold: true, spacing });

/** 제목·낱말 카드·표 칸 줄바꿈 — 한 줄에 들어가면 그대로 · 아니면 두 줄: 쉼표·물음표 뒤(의미 경계)를 먼저, 그다음 두 줄 길이 균형. 낱말 중간에서 끊지 않는다. 두 줄로도 안 되면 font-metrics 줄바꿈. */
function balancedWrap(t, fs, maxW, opts = {}) {
  const text = String(t || '').trim();
  if (!text) return [''];
  if (mw(text, fs, opts.spacing || 0) <= maxW) return [text];
  const cands = [];
  for (let i = 1; i < text.length; i++) {
    if (text[i] !== ' ') continue;
    const a = text.slice(0, i).trim(), b = text.slice(i + 1).trim();
    if (!a || !b) continue;
    const wa = mw(a, fs, opts.spacing || 0), wb = mw(b, fs, opts.spacing || 0);
    if (Math.max(wa, wb) > maxW) continue;
    if (/(^|\s)[+＋·→~～×÷=＝\-–—/]$/.test(a)) continue;   // 이음 기호(+ · → ~ ×)는 줄 끝에 홀로 두지 않는다 — 다음 줄 머리로
    cands.push({ a, b, bal: Math.abs(wa - wb), punct: /[,，、?？!！:：]$/.test(a) });
  }
  if (cands.length) {
    const pool = cands.some((c) => c.punct) ? cands.filter((c) => c.punct) : cands;
    pool.sort((x, y) => x.bal - y.bal);
    return [pool[0].a, pool[0].b];
  }
  return FM.wrap(FONT_FILE, text, fs, maxW, { bold: true, spacing: opts.spacing || 0 });
}

/** 둥근 사각형 ASS 벡터(원점 = 왼쪽 위) */
function rrPath(w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return `m 0 0 l ${w} 0 ${w} ${h} 0 ${h}`;
  return `m ${r} 0 l ${w - r} 0 b ${w} 0 ${w} 0 ${w} ${r} l ${w} ${h - r} b ${w} ${h} ${w} ${h} ${w - r} ${h} l ${r} ${h} b 0 ${h} 0 ${h} 0 ${h - r} l 0 ${r} b 0 0 0 0 ${r} 0`;
}

// ── 판 배치(프리미티브) ──────────────────────────────────────────────────────
const rect = (x, y, w, h, color, op, layer, r = 0) => ({ k: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), color, op, layer, r });
const text = (x, y, an, lines, fs, color, op, extra = {}) => ({ k: 'text', x: Math.round(x), y: Math.round(y), an, lines, fs, color, op, layer: 8, ...extra });
const check = (x, y, size, color, op) => ({ k: 'check', x: Math.round(x), y: Math.round(y), size, color, op, layer: 8 });

// 🎨 편마다 달라지는 색·모양·자리(core/info-theme 가 p.theme 로 준다) — 없으면 예전 그대로(오른쪽 가운데 · 막대형 · 고정 색)
const colorsOf = (p) => ({ ...C, ...((p && p.theme && p.theme.colors) || {}) });
const shapeOf = (p) => ((p && p.theme && p.theme.shape) || 'bar');
const POS = ['rc', 'lc', 'rt', 'lt'];
/** 판 크기 (w,h) 와 자리 → 왼쪽 위 좌표 */
function placeBox(pos, w, h) {
  // 🖱 자유 자리 "62,8"(대본 @62,8 · v0.8.13) — 판 왼쪽 위 모서리 = 화면 %. 판 전체가 화면 안(가장자리 20px)에 들도록 붙인다
  const fm = /^(\d{1,3}),(\d{1,3})$/.exec(String(pos || ''));
  if (fm) return { x0: Math.round(Math.max(20, Math.min(W - 20 - w, (+fm[1] / 100) * W))), y0: Math.round(Math.max(20, Math.min(H - 20 - h, (+fm[2] / 100) * H))) };
  const left = pos === 'lc' || pos === 'lt', top = pos === 'rt' || pos === 'lt';
  return { x0: left ? 40 : W - 40 - w, y0: top ? 110 : Math.round(H / 2 - h / 2) };
}
/** 판 장식(바탕 + 강조) — 모양 4가지. 글자가 들어가는 안쪽 여백(inL·inT·extraH)도 돌려준다 */
function decor(shape, x0, y0, w, h, c, op) {
  const out = [rect(x0, y0, w, h, c.panel, op, 5, 18)];
  if (shape === 'tag') { out.push(rect(x0, y0, w, 12, c.accent, 1, 6, 6)); return { out, inL: 0, inT: 12, extraH: 12 }; }
  if (shape === 'underline') { out.push(rect(x0 + 34, y0 + h - 16, w - 68, 7, c.accent, 1, 6, 3)); return { out, inL: 0, inT: 0, extraH: 14 }; }
  if (shape === 'frame') {
    out.push(rect(x0, y0, w, 5, c.accent, 1, 6, 0), rect(x0, y0 + h - 5, w, 5, c.accent, 1, 6, 0), rect(x0, y0, 5, h, c.accent, 1, 6, 0), rect(x0 + w - 5, y0, 5, h, c.accent, 1, 6, 0));
    return { out, inL: 5, inT: 5, extraH: 10 };
  }
  out.push(rect(x0, y0, 12, h, c.accent, 1, 6, 6));
  return { out, inL: 12, inT: 0, extraH: 0 };
}
/** 낱말·확인표 판의 크기 — 자리를 고를 때(info-theme) 미리 잰다 */
function sizeOf(p, shape = 'bar') {
  const pr = layoutOf({ ...p, _prims: null, theme: { ...(p.theme || {}), shape, pos: 'rc' } }, () => {});
  const r = pr.find((q) => q.k === 'rect');
  return r ? { w: r.w, h: r.h } : null;
}

/** 낱말 카드 */
function layoutWords(p, warn) {
  const c = colorsOf(p), shape = shapeOf(p);
  const fs = FS, lh = Math.round(fs * 1.3), padX = 40, padY = 34, innerMax = 700, gap = 18;
  const blocks = p.words.map((w) => balancedWrap(w, fs, innerMax).slice(0, 2));
  const maxLine = Math.max(...blocks.flat().map((l) => mw(l, fs)));
  const nLines = blocks.reduce((a, b) => a + b.length, 0);
  const d0 = decor(shape, 0, 0, 10, 10, c, 1);   // 안쪽 여백만 본다
  const panelW = Math.max(560, Math.min(900, maxLine + padX * 2 + d0.inL));
  const panelH = padY * 2 + nLines * lh + (blocks.length - 1) * gap + d0.extraH;
  const { x0, y0 } = placeBox((p.theme && p.theme.pos) || 'rc', panelW, panelH);
  const d = decor(shape, x0, y0, panelW, panelH, c, 0.84);
  const out = [...d.out];
  let y = y0 + d.inT + padY;
  blocks.forEach((b) => { b.forEach((l) => { out.push(text(x0 + d.inL + padX, y + lh / 2, 4, [l], fs, c.text, 1, {})); y += lh; }); y += gap; });
  void warn;
  return out;
}

/** 확인표 — 영상 전체에서 쌓이는 목록(최근 5줄 · 방금 것만 진하게) */
function layoutCheck(p, warn) {
  const c = colorsOf(p), shape = shapeOf(p);
  const fs = FS, lh = Math.round(fs * 1.5), padX = 38, padY = 30, boxS = 44, gapBox = 24;
  const list = p.list;
  const d0 = decor(shape, 0, 0, 10, 10, c, 1);
  const widest = Math.max(...list.map((t) => mw(t, fs)));
  const innerW = boxS + gapBox + widest;
  const panelW = Math.max(620, Math.min(1000, innerW + padX * 2 + d0.inL));
  if (innerW + padX * 2 + d0.inL > 1000) list.forEach((t) => { if (mw(t, fs) + boxS + gapBox + padX * 2 + d0.inL > 1000) warn(`✅ 「${t}」 는 판 폭을 넘어 오른쪽이 잘릴 수 있습니다(${t.length}자 · 문구를 줄여 주세요)`); });
  const panelH = padY * 2 + list.length * lh + d0.extraH;
  const { x0, y0 } = placeBox((p.theme && p.theme.pos) || 'rc', panelW, panelH);
  const d = decor(shape, x0, y0, panelW, panelH, c, 0.86);
  const out = [...d.out];
  list.forEach((t, i) => {
    const cur = i === list.length - 1;
    const yc = y0 + d.inT + padY + i * lh + lh / 2;
    if (cur) out.push(rect(x0 + d.inL + 10, yc - lh / 2 + 4, panelW - d.inL * 2 - 20, lh - 8, c.accent, 0.16, 7, 10));
    const bx = x0 + d.inL + padX, by = yc - boxS / 2;
    out.push(rect(bx, by, boxS, boxS, cur ? c.accent : c.dim, cur ? 1 : 0.55, 7, 9));
    out.push(check(bx, by, boxS, c.bg, 1));
    out.push(text(bx + boxS + gapBox, yc, 4, [t], fs, cur ? c.text : c.dim, cur ? 1 : 0.85, {}));
  });
  return out;
}

/** 구간 표지 — 전체 화면 어두운 판 · 「N / M」 · 이름 · 진행 막대 */
function layoutCover(p) {
  const th = colorsOf(p);
  const out = [rect(0, 0, W, H, th.bg, 0.92, 0, 0)];
  const barW = 960, barX = (W - barW) / 2, barY = 790, barH = 18;
  const k = p.closing ? 1 : Math.max(0, Math.min(1, p.m ? p.n / p.m : 1));
  if (p.closing) {
    out.push(text(W / 2, 470, 5, [p.title || '마무리'], 150, th.accent, 1, { sp: 4 }));
  } else {
    out.push(text(W / 2, 360, 5, [`${p.n} / ${p.m}`], 150, th.accent, 1, { sp: 6 }));
    const lines = balancedWrap(p.title, 84, 1500).slice(0, 2);
    out.push(text(W / 2, 580 + (lines.length - 1) * 0, 5, lines, 84, C.text, 1, {}));
  }
  out.push(rect(barX, barY, barW, barH, C.line, 0.22, 8, 9));
  out.push(rect(barX, barY, Math.max(barH, barW * k), barH, th.accent, 1, 9, 9));
  return out;
}

/** 표 — 전체 화면 · 제목 · 칸 너비/줄바꿈을 글자 폭으로 계산 · 아래 출처 한 줄 */
function layoutTable(p, warn) {
  const th = colorsOf(p);
  const marginX = 110, availW = W - marginX * 2, padX = 28, padY = 16;
  const rows = p.rows.map((r) => r.slice());
  const ncol = Math.max(...rows.map((r) => r.length), 1);
  rows.forEach((r) => { while (r.length < ncol) r.push(''); });
  const titleY = 118, tableTop = 200, tableBottom = p.source ? H - 150 : H - 90, availH = tableBottom - tableTop;
  let best = null;
  for (const fs of [66, 62, 58, 54]) {
    const lh = Math.round(fs * 1.28);
    const nat = Array.from({ length: ncol }, (_, c) => Math.max(...rows.map((r) => mw(r[c], fs))) + padX * 2);
    const sum = nat.reduce((a, b) => a + b, 0);
    // 가장 긴 낱말(공백 사이)이 한 줄에 들어가는 최소 폭 — 낱말 한가운데서 끊기지 않게. 남는 폭은 필요한 만큼 나눠 준다
    const minW = Array.from({ length: ncol }, (_, c) => Math.max(...rows.map((r) => Math.max(...String(r[c]).split(/\s+/).map((t) => mw(t, fs)), 0))) + padX * 2);
    const sumMin = minW.reduce((a, b) => a + b, 0);
    if (sumMin > availW && fs > 54) continue;   // 더 작은 글자로 다시
    const need = nat.map((n, c) => Math.max(0, n - minW[c])), sumNeed = need.reduce((a, b) => a + b, 0), remain = Math.max(0, availW - sumMin);
    // 짧은 칸(구분 등)은 내용 폭 그대로(한 줄) — 모자란 폭은 긴 칸끼리 나눠 진다(물 채우기). 남으면 칸마다 똑같이 나눠 준다.
    const extra = need.map(() => 0);
    { let left = remain; const order = need.map((n, c) => c).sort((x, y) => need[x] - need[y]);
      order.forEach((c, i) => { const share = left / (order.length - i); const give = Math.min(need[c], share); extra[c] = give; left -= give; });
      if (left > 1e-6) for (let c = 0; c < ncol; c++) extra[c] += left / ncol; }
    let widths = minW.map((m, c) => m + extra[c]);
    void sum; void sumNeed;
    const sc = availW / widths.reduce((a, b) => a + b, 0); widths = widths.map((w) => w * sc);
    const wrapped = rows.map((r) => r.map((cell, c) => balancedWrap(cell, fs, widths[c] - padX * 2)));
    const heights = wrapped.map((r) => Math.max(...r.map((l) => l.length)) * lh + padY * 2);
    const total = heights.reduce((a, b) => a + b, 0);
    best = { fs, lh, widths, wrapped, heights, total };
    if (total <= availH) break;
  }
  if (best.total > availH) warn(`📊 표 「${(p.title || '').slice(0, 16)}」 가 한 화면에 안 들어가 글자를 ${best.fs}px 까지 줄였습니다(행 ${rows.length} · 열 ${ncol} — 줄이거나 나눠 주세요)`);
  if (best.fs < 66) warn(`📊 표 「${(p.title || '').slice(0, 16)}」 글자 ${best.fs}px — 시니어 가독성 기준(66px)보다 작습니다(행·열을 줄이면 커집니다)`);
  const out = [rect(0, 0, W, H, th.bg, 0.97, 0, 0)];
  const tl = balancedWrap(p.title || '', 72, availW).slice(0, 2);
  out.push(text(marginX, titleY, 4, tl, 72, th.accent, 1, {}));
  const topY = tableTop + Math.max(0, Math.round((availH - best.total) / 2));   // 표를 제목·출처 사이 세로 가운데로
  let y = topY;
  out.push(rect(marginX - 12, topY - 8, availW + 24, best.total + 16, 'FFFFFF', 0.06, 5, 16));   // 층: 자막 층(1~4)과 겹치지 않게 5 이상
  rows.forEach((r, ri) => {
    const rh = best.heights[ri];
    if (ri === 0) out.push(rect(marginX, y, availW, rh, th.accent, 0.2, 5, 10));
    let x = marginX;
    r.forEach((cell, c) => {
      const lines = best.wrapped[ri][c];
      out.push(text(x + padX, y + rh / 2, 4, lines, best.fs, ri === 0 ? th.accent : C.text, 1, {}));
      x += best.widths[c];
    });
    if (ri < rows.length - 1) out.push(rect(marginX, y + rh - 1, availW, 2, C.line, 0.2, 5, 0));
    y += rh;
  });
  if (p.source) out.push(text(marginX, H - 80, 4, [`출처: ${p.source}`], 50, th.dim, 1, {}));
  return out;
}

const LAYOUT = { words: layoutWords, check: layoutCheck, cover: layoutCover, table: layoutTable };
/** 판 → 프리미티브(캐시) · warn(msg) 로 경고를 모은다 */
function layoutOf(p, warn = () => {}) {
  if (!p._prims) { try { p._prims = LAYOUT[p.type](p, warn); } catch (e) { warn(`📇 판 배치 실패(${p.type}) — ${e.message}`); p._prims = []; } }
  return p._prims;
}

// ── ASS 이벤트 ──────────────────────────────────────────────────────────────
const fadeOf = (p) => Math.max(0.2, Math.min(FADE, (p.t1 - p.t0) / 4));
function opacityAt(p, t) {
  const f = fadeOf(p);
  if (t <= p.t0 || t >= p.t1) return 0;
  if (t < p.t0 + f) return (t - p.t0) / f;
  if (t > p.t1 - f) return (p.t1 - t) / f;
  return 1;
}

/**
 * 이 창 [w0, w1](초 · 영상 전체 시각)에 걸친 판 → Dialogue 줄. family = ASS 글꼴 이름(Pretendard 대체본).
 *   곡선은 절대 시각으로 계산해 창 안의 구간만 \1a + \t 램프로 옮긴다(조각 경계에서 번쩍이지 않음 — 화면 카드와 같은 방식).
 */
function events(panels, w0, w1, family, warn = () => {}) {
  const out = [];
  for (const p of (panels || [])) {
    const a = Math.max(p.t0, w0), b = Math.min(p.t1, w1);
    if (!(b - a > 0.005)) continue;
    const f = fadeOf(p);
    const knots = [a, ...[p.t0 + f, p.t1 - f].filter((x) => x > a + 1e-6 && x < b - 1e-6), b];
    const rel = (t) => Math.round((t - a) * 1000);
    const ramp = (max) => {
      let tag = `\\1a&H${alphaHex(opacityAt(p, a + 0.001), max)}&`;
      for (let k = 0; k + 1 < knots.length; k++) {
        const o0 = k === 0 ? opacityAt(p, knots[0] + 0.001) : opacityAt(p, knots[k]);
        const o1 = k + 2 === knots.length ? opacityAt(p, knots[k + 1] - 0.001) : opacityAt(p, knots[k + 1]);
        if (Math.abs(o1 - o0) > 1e-4) tag += `\\t(${rel(knots[k])},${rel(knots[k + 1])},\\1a&H${alphaHex(o1, max)}&)`;
      }
      return tag;
    };
    const st = fmtT(a - w0), en = fmtT(b - w0);
    for (const q of layoutOf(p, warn)) {
      if (q.k === 'rect') {
        out.push(`Dialogue: ${q.layer},${st},${en},N,,0,0,0,,{\\an7\\pos(${q.x},${q.y})\\bord0\\shad0\\1c&H${bgr(q.color)}&${ramp(q.op)}\\p1}${rrPath(q.w, q.h, q.r)}{\\p0}`);
      } else if (q.k === 'check') {
        // 체크 표시(✓) — 굵은 꺾은선 모양의 채운 다각형(왼쪽 짧은 획 + 오른쪽 긴 획)
        const s = q.size, poly = [[0.20, 0.54], [0.31, 0.43], [0.44, 0.56], [0.71, 0.25], [0.82, 0.36], [0.44, 0.78]].map(([x, y]) => `${Math.round(x * s)} ${Math.round(y * s)}`);
        out.push(`Dialogue: ${q.layer},${st},${en},N,,0,0,0,,{\\an7\\pos(${q.x},${q.y})\\bord0\\shad0\\1c&H${bgr(q.color)}&${ramp(q.op)}\\p1}m ${poly[0]} l ${poly.slice(1).join(' ')}{\\p0}`);
      } else {
        const body = q.lines.map(esc).join('\\N');
        out.push(`Dialogue: ${q.layer},${st},${en},N,,0,0,0,,{\\an${q.an}\\pos(${q.x},${q.y})\\fn${family}\\fs${q.fs}\\b1\\i0\\bord0\\shad0\\q2\\fsp${q.sp || 0}\\1c&H${bgr(q.color)}&${ramp(q.op)}}${body}`);
      }
    }
  }
  return out;
}

/** 오른쪽 판(낱말·확인표)의 왼쪽 가장자리 x — 자막이 이 안쪽에서 끝나게 하려고. 판이 아니면 null */
function panelLeft(p, warn) {
  if (!p || (p.type !== 'words' && p.type !== 'check')) return null;
  const r = layoutOf(p, warn).find((q) => q.k === 'rect');
  if (!r) return null;
  return r.x + r.w / 2 > W / 2 ? r.x : null;   // 왼쪽 판은 자막(왼쪽 아래)과 세로로 겹치지 않는 자리에만 둔다(info-theme) — 폭을 줄일 일이 없다
}

module.exports = { W, H, FONT_FILE, C, POS, events, layoutOf, opacityAt, fadeOf, rrPath, balancedWrap, panelLeft, sizeOf, placeBox };
