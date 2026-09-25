'use strict';

/**
 * caption-ass.js — 서식·효과가 든 자막 줄 → ASS 이벤트 (2026-09-25).
 *
 * 🔑 유튜브 MP4(core/vrew-render)와 화이트보드(core/whiteboard-subtitle)가 **이 한 곳**을 쓴다.
 *   두 벌로 두면 한쪽만 고쳐져 두 결과물의 자막이 달라진다.
 *
 * 층 — 같은 층의 동시 이벤트는 libass 가 **위아래로 밀어 버리므로**(v0.5.28 실측) 종류마다 층을 나눈다:
 *   0 배경 상자(BorderStyle 4 · 줄 전체에 하나 — 3 은 글꼴이 바뀌는 곳마다 쪼개져 이음매가 생긴다, 실측) · 1 형광펜(BorderStyle 3 · 글자 구간마다 — 칠할 구간만 상자 알파를 연다, 실측 확인)
 *   2 그림자(글자 모양을 그림자 색으로, 위치를 옮기고 흐리게) · 3 이중 테두리(바깥 테두리) · 4 글자
 *
 * 효과 — 효과가 도는 동안만 **프레임마다 이벤트**를 만든다(30fps). 그 밖은 멈춘 이벤트 하나.
 *   키프레임은 core/caption-anim(= Vrew 의 CSS @keyframes) 그대로라 화면 미리보기와 같은 움직임이다.
 *   🔑 위치는 언제나 `\pos` 로 박는다 — 크기·회전·이동을 계산하려면 기준점이 필요하다. 멈춘 줄의 기준점은
 *     여백(MarginL/R/V)에서 **정확히** 나오므로(글자 폭 추정 없음) 효과가 없는 줄은 예전과 같은 자리에 선다.
 *     글자 폭 추정은 효과(크기 중심·% 이동)에만 쓴다.
 *   ⚠ `\alpha` 한 번에 쓰지 않는다 — 층마다 알파가 다르다(투명 상자·투명 글자). 성분별(\1a \3a)로 곱해 쓴다.
 */

const CF = require('./caption-format');
const CA = require('./caption-anim');

// ── 색·시간 ────────────────────────────────────────────────────────────────
const hx2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
/** '#rrggbb' → '&HBBGGRR&' */
function bgr(hex) {
  const h = /^#([0-9a-f]{6})$/i.test(String(hex || '')) ? String(hex).slice(1) : 'ffffff';
  return ('&H' + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2)).toUpperCase() + '&';
}
/** 불투명도(0~1) → ASS 알파 '&HAA&'(00=불투명) */
const alpha = (op) => `&H${hx2(255 * (1 - Math.max(0, Math.min(1, op))))}&`;
function fmtTime(sec) {
  const cs = Math.max(0, Math.round((+sec || 0) * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}
const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, ' ');

// ── 글자 폭 추정(효과 계산용) ──────────────────────────────────────────────
function charW(ch) {
  const c = ch.codePointAt(0);
  if ((c >= 0xAC00 && c <= 0xD7AF) || (c >= 0x1100 && c <= 0x11FF) || (c >= 0x3000 && c <= 0x9FFF) || (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFF00 && c <= 0xFFEF)) return 1.0;
  if (ch === ' ') return 0.28;
  if (/[0-9]/.test(ch)) return 0.58;
  if (/[A-Z]/.test(ch)) return 0.66;
  if (/[a-z]/.test(ch)) return 0.54;
  if (/[.,!?:;'"`·]/.test(ch)) return 0.3;
  return 0.6;
}

/**
 * 배치 — 캔버스·정렬·여백·글자 크기 환산.
 * @param o.W o.H  영상 크기 · o.hAlign 'start'|'center'|'end' · o.yAlign 'bottom'|'middle'|'top'
 * @param o.marginL/R/V  픽셀 · o.sizeK  Vrew size → 픽셀 · o.pxK  Vrew CSS px → 픽셀(테두리 두께·그림자·효과 이동)
 * @param o.fontMap  { Vrew 글꼴 이름: ASS 가족 이름 } · o.fallbackFamily
 */
function makeLayout(o) {
  const W = o.W || 1920, H = o.H || 1080;
  const hAlign = ['start', 'center', 'end'].includes(o.hAlign) ? o.hAlign : 'center';
  const yAlign = ['top', 'middle', 'bottom'].includes(o.yAlign) ? o.yAlign : 'bottom';
  const an = { bottom: { start: 1, center: 2, end: 3 }, middle: { start: 4, center: 5, end: 6 }, top: { start: 7, center: 8, end: 9 } }[yAlign][hAlign];
  const mL = Math.round(o.marginL || 0), mR = Math.round(o.marginR || 0), mV = Math.round(o.marginV || 0);
  // o.dx/o.dy — 기준점 이동(가운데 정렬의 세로 위치 · 화이트보드의 줄별 미세 위치). 여백으로 표현할 수 없는 이동만 여기로.
  const ax = (hAlign === 'start' ? mL : hAlign === 'end' ? W - mR : Math.round((mL + (W - mR)) / 2)) + Math.round(Number(o.dx) || 0);
  const ay = (yAlign === 'bottom' ? H - mV : yAlign === 'top' ? mV : Math.round(H / 2)) + Math.round(Number(o.dy) || 0);
  return {
    W, H, hAlign, yAlign, an, marginL: mL, marginR: mR, marginV: mV, ax, ay,
    sizeK: o.sizeK || (0.72 * H / 1080), pxK: o.pxK || (H / 1080),
    fontMap: o.fontMap || {}, fallbackFamily: o.fallbackFamily || 'Malgun Gothic',
    fps: o.fps || 30, baseSize: o.baseSize || 100,
    fixedFamily: o.fixedFamily || null,   // 화이트보드처럼 글꼴을 따로 정한 경우(서식의 글꼴보다 우선)
  };
}

/** [V4+ Styles] 줄들 — 글꼴은 이벤트에서 \fn 으로 덮어쓰므로 기본값일 뿐이다. */
function assStyles(L) {
  const f = L.fallbackFamily;
  return [
    `Style: C,${f},72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,${L.an},${L.marginL},${L.marginR},${L.marginV},1`,
    `Style: B,${f},72,&HFF000000,&HFF000000,&H00000000,&HFF000000,0,0,0,0,100,100,0,0,3,0,0,${L.an},${L.marginL},${L.marginR},${L.marginV},1`,
    // 줄 상자 — BorderStyle 4 = 줄 전체에 상자 하나(색 = BackColour, 이벤트에서 4c·4a 태그로 덮어쓴다). 구간마다 글꼴·크기가 달라도 이음매가 없다(BorderStyle 3 은 구간마다 쪼개진다 — 실측).
    `Style: X,${f},72,&HFF000000,&HFF000000,&HFF000000,&HFF000000,0,0,0,0,100,100,0,0,4,0,0,${L.an},${L.marginL},${L.marginR},${L.marginV},1`,
  ];
}

const pxOf = (f, L) => Math.max(8, Math.round((Number(f.size) || L.baseSize) * L.sizeK));
const famOf = (f, L) => L.fixedFamily || L.fontMap[f.font] || L.fontMap[CF.FMT_DEFAULT.font] || L.fallbackFamily;

/** 줄 크기(추정) — 효과의 중심·% 이동에만 쓴다. */
function measure(runs, L) {
  let w = 0, h = 0;
  for (const r of runs) {
    const px = pxOf(r.fmt, L);
    const sp = (Number(r.fmt.letterSpacing) || 0) * px;
    for (const ch of r.text) w += charW(ch) * px + sp;
    h = Math.max(h, px * 1.25);
  }
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

// 글자 공통 태그(글꼴·크기·굵게·기울임·밑줄·취소선·자간)
function glyphTags(f, L) {
  const px = pxOf(f, L);
  const sp = Math.round((Number(f.letterSpacing) || 0) * px * 10) / 10;
  return `\\fn${famOf(f, L)}\\fs${px}\\b${f.bold ? 1 : 0}\\i${f.italic ? 1 : 0}\\u${f.underline ? 1 : 0}\\s${f.strike ? 1 : 0}\\fsp${sp}`;
}
const outlineW = (f, L) => (f.outlineOn === false ? 0 : Math.max(0, Number(f.outlineWidth) || 0) * L.pxK);
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * 한 층의 본문 — 구간마다 태그 + 글자. op = 효과 불투명도, hide = 숨길 글자 수(타이핑 — 뒤에서부터 센 글자).
 * @returns string | null (그 층에 그릴 것이 없으면 null)
 */
function layerText(kind, runs, L, op, visibleCount) {
  let any = false;
  let seen = 0;
  const parts = [];
  for (const r of runs) {
    const f = r.fmt;
    const g = glyphTags(f, L);
    const ow = outlineW(f, L);
    const o2 = f.outline2On ? Math.max(0, Number(f.outline2Width) || 0) * L.pxK : 0;
    let tag;
    if (kind === 'main') {
      tag = `\\1c${bgr(f.fontColor)}\\1a${alpha(op)}\\3c${bgr(f.outlineColor)}\\3a${alpha(ow > 0 ? op : 0)}\\bord${r1(ow)}\\shad0\\blur0`;
      any = true;
    } else if (kind === 'outline2') {
      if (f.outline2On && o2 > 0) { tag = `\\1c${bgr(f.outline2Color)}\\1a${alpha(op)}\\3c${bgr(f.outline2Color)}\\3a${alpha(op)}\\bord${r1(ow + o2)}\\shad0\\blur0`; any = true; }
      else tag = `\\1a&HFF&\\3a&HFF&\\bord${r1(ow + o2)}\\shad0`;
    } else if (kind === 'shadow') {
      if (f.shadowOn) {
        const sa = op * (Number(f.shadowOpacity != null ? f.shadowOpacity : 50) / 100);
        const bw = ow + o2;
        tag = `\\1c${bgr(f.shadowColor)}\\1a${alpha(sa)}\\3c${bgr(f.shadowColor)}\\3a${alpha(bw > 0 ? sa : 0)}\\bord${r1(bw)}\\shad0\\blur${r1((Number(f.shadowBlur) || 0) * L.pxK / 2)}`;
        any = true;
      } else tag = `\\1a&HFF&\\3a&HFF&\\bord0\\shad0\\blur0`;
    } else if (kind === 'hl') {
      const pad = r1(Math.max(2, pxOf(f, L) * 0.14));
      if (f.hlOn) { tag = `\\1a&HFF&\\3c${bgr(f.hlColor)}\\3a${alpha(op * (Number(f.hlOpacity != null ? f.hlOpacity : 100) / 100))}\\bord${pad}\\shad0\\blur0`; any = true; }
      else tag = `\\1a&HFF&\\3a&HFF&\\bord${pad}\\shad0`;
    }
    // 타이핑 — 보이는 글자까지만(공백은 세지 않는다)
    if (visibleCount == null) { parts.push(`{${g}${tag}}${esc(r.text)}`); continue; }
    let vis = '', hid = '';
    for (const ch of r.text) {
      const counts = !/\s/.test(ch);
      if (hid || (counts && seen >= visibleCount)) hid += ch;
      else { vis += ch; if (counts) seen++; }
    }
    if (vis) parts.push(`{${g}${tag}}${esc(vis)}`);
    if (hid) parts.push(`{${g}\\1a&HFF&\\3a&HFF&\\4a&HFF&}${esc(hid)}`);
  }
  return any ? parts.join('') : null;
}

/** 배경 상자 층(줄 전체). */
function boxText(runs, L, line, op) {
  if (!line || !line.boxOn) return null;
  const pxMax = Math.max(...runs.map((r) => pxOf(r.fmt, L)));
  const pad = r1(Math.max(2, pxMax * 0.14));
  const a = op * (Number(line.boxOpacity != null ? line.boxOpacity : 60) / 100);
  return runs.map((r) => `{${glyphTags(r.fmt, L)}\\1a&HFF&\\3a&HFF&\\4c${bgr(line.boxColor)}\\4a${alpha(a)}\\bord${pad}\\shad0}${esc(r.text)}`).join('');
}

/**
 * 모양(효과 상태) → 위치·크기·회전 태그. st 가 없으면 멈춘 줄(기준점 그대로).
 */
function transformTags(L, box, st, extraDx, extraDy) {
  let x = L.ax + (extraDx || 0), y = L.ay + (extraDy || 0);
  if (!st) return `\\an${L.an}\\pos(${r1(x)},${r1(y)})`;
  // 글자 상자의 가운데(추정) — CSS transform-origin 기본값
  const cx = L.ax + (L.hAlign === 'start' ? box.w / 2 : L.hAlign === 'end' ? -box.w / 2 : 0);
  const cy = L.ay + (L.yAlign === 'bottom' ? -box.h / 2 : L.yAlign === 'top' ? box.h / 2 : 0);
  const dx = CA.lenPx(st.tx, 'x', box, { w: L.W, h: L.H }, L.pxK);
  const dy = CA.lenPx(st.ty, 'y', box, { w: L.W, h: L.H }, L.pxK);
  const sx = Number(st.sx), sy = Number(st.sy);
  // libass 의 \fscx 는 **정렬 기준점**을 중심으로 커진다 → 가운데 기준으로 커지게 기준점을 옮긴다
  x = cx + (L.ax - cx) * sx + dx + (extraDx || 0);
  y = cy + (L.ay - cy) * sy + dy + (extraDy || 0);
  const ocx = cx + dx + (extraDx || 0), ocy = cy + dy + (extraDy || 0);
  let t = `\\an${L.an}\\pos(${r1(x)},${r1(y)})\\org(${r1(ocx)},${r1(ocy)})\\fscx${r1(sx * 100)}\\fscy${r1(sy * 100)}`;
  if (st.rz) t += `\\frz${r1(-st.rz)}`;          // CSS 시계 방향(+) ↔ ASS 반시계(+)
  if (st.rx) t += `\\frx${r1(st.rx)}`;
  if (st.ry) t += `\\fry${r1(-st.ry)}`;
  if (st.skx) t += `\\fax${r1(-Math.tan(st.skx * Math.PI / 180))}`;
  return t;
}

/** 한 순간(멈춤 또는 효과 한 프레임)의 모든 층 이벤트. */
function frameEvents(cue, L, box, t0, t1, st, visibleCount) {
  const op = st ? Math.max(0, Math.min(1, Number(st.op))) : 1;
  if (op <= 0.003) return [];
  const out = [];
  const tr = transformTags(L, box, st);
  const push = (layer, style, body, trTags) => { if (body) out.push({ layer, start: t0, end: t1, style, text: `{${trTags || tr}}${body}` }); };
  push(0, 'X', boxText(cue.runs, L, cue.line, op));
  push(1, 'B', layerText('hl', cue.runs, L, op, visibleCount));
  // 그림자 — 위치를 옮긴다(첫 그림자 구간의 방향을 줄 전체에 쓴다)
  const shRun = cue.runs.find((r) => r.fmt.shadowOn);
  if (shRun) {
    const sdx = (Number(shRun.fmt.shadowX) || 0) * L.pxK, sdy = (Number(shRun.fmt.shadowY) || 0) * L.pxK;
    push(2, 'C', layerText('shadow', cue.runs, L, op, visibleCount), transformTags(L, box, st, sdx, sdy));
  }
  push(3, 'C', layerText('outline2', cue.runs, L, op, visibleCount));
  push(4, 'C', layerText('main', cue.runs, L, op, visibleCount));
  return out;
}

/**
 * 자막 줄 하나 → 절대 시각 이벤트 [{layer, start, end, style, text}].
 * @param cue { start, end, runs:[{text, fmt}], line:{boxOn, boxColor, boxOpacity, anim} }
 */
function cueEvents(cue, L) {
  if (!cue || !(cue.end > cue.start) || !cue.runs || !cue.runs.length) return [];
  const runs = cue.runs.filter((r) => r.text);
  if (!runs.length) return [];
  const c = { ...cue, runs };
  const box = measure(runs, L);
  const anim = cue.line && cue.line.anim;
  if (!anim) return frameEvents(c, L, box, cue.start, cue.end, null);
  const { windows, hiddenUntil } = CA.animWindows(anim, cue.start, cue.end);
  if (!windows.length) return frameEvents(c, L, box, cue.start, cue.end, null);
  const out = [];
  const totalChars = runs.reduce((a, r) => a + [...r.text].filter((ch) => !/\s/.test(ch)).length, 0);
  let cur = Math.max(cue.start, hiddenUntil);
  const fps = L.fps;
  for (const w of windows) {
    if (w.t0 > cur + 1e-6) out.push(...frameEvents(c, L, box, cur, w.t0, null));
    const len = w.t1 - w.t0;
    const n = Math.max(1, Math.round(len * fps));
    for (let k = 0; k < n; k++) {
      const a = w.t0 + len * k / n, b = w.t0 + len * (k + 1) / n;
      const p = w.from + (w.to - w.from) * ((k + 0.5) / n);
      if (w.type === 'typing') {
        out.push(...frameEvents(c, L, box, a, b, null, CA.typingVisible(p, totalChars)));
      } else {
        out.push(...frameEvents(c, L, box, a, b, CA.sampleState(w.type, p)));
      }
    }
    cur = w.t1;
  }
  if (cue.end > cur + 1e-6) out.push(...frameEvents(c, L, box, cur, cue.end, null));
  return out;
}

/**
 * 절대 시각 이벤트 → 'Dialogue:' 줄. shift 만큼 당기고 [0, dur) 밖은 버린다(렌더 조각).
 * 🔑 시각을 1/100초로 반올림하면 프레임 이벤트가 겹치거나 비므로, 이어진 이벤트는 앞 끝 = 뒤 시작으로 맞춘다.
 */
function formatEvents(evs, shift = 0, dur = Infinity) {
  const out = [];
  for (const e of evs) {
    const a = Math.max(0, e.start - shift), b = Math.min(dur, e.end - shift);
    if (!(b > a)) continue;
    const ta = fmtTime(a), tb = fmtTime(b);
    if (ta === tb) continue;
    out.push(`Dialogue: ${e.layer},${ta},${tb},${e.style},,0,0,0,,${e.text}`);
  }
  return out;
}

/** 쓰인 글꼴(Vrew 이름) 목록 — 렌더 전에 글꼴 파일을 준비하려고. */
function fontsUsed(cues) {
  const s = new Set();
  for (const c of (cues || [])) for (const r of (c.runs || [])) if (r.fmt && r.fmt.font) s.add(r.fmt.font);
  return [...s];
}

/**
 * 문장(text + 조각) + 채널 서식 → 자막 줄 큐 목록(시각 없이 줄·구간만). 화이트보드·검사에서 쓴다.
 * @returns [{text, runs, line}]
 */
function sentenceLines(text, spans, base, lines) {
  const t = String(text || '');
  const ranges = CF.lineRanges(t, lines);
  return ranges.map((rg, i) => ({
    text: lines[i],
    runs: CF.lineRuns(t, spans, rg, base),
    line: CF.lineProps(spans, rg, base, t.length),
  }));
}

module.exports = { makeLayout, assStyles, cueEvents, formatEvents, fontsUsed, sentenceLines, measure, bgr, alpha, fmtTime };
