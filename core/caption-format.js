'use strict';

/**
 * caption-format.js — 자막 서식 모델 (2026-09-25, 로이: 「브루의 자막 서식 창과 같은 기능을」)
 *
 * 🔑 서식은 두 층이다.
 *   ① 채널 기본 서식 — 채널 capLong 에 저장(모든 자막에 적용).
 *   ② 줄별·글자별 덮어쓰기 — 문장마다 `s.capSpans = [{from, to, fmt}]`(문장 글자 위치 기준).
 *      자막 **줄**은 글자수 설정에 따라 다시 계산되는 파생물이라 줄 번호로 저장하면 설정을 바꾸는 순간 어긋난다 →
 *      문장 글자 위치로 저장하고, 줄을 만들 때 그 줄 범위로 잘라 쓴다. 「줄 전체」 서식 = 그 줄 글자 범위를 덮는 조각.
 *
 * 🔑 이 모듈 하나를 .vrew(vrew-builder) · 유튜브 MP4(vrew-render) · 화이트보드(whiteboard-subtitle) · 화면(App.jsx) 이
 *   함께 쓴다. 두 벌로 두면 반드시 어긋난다.
 *   ⚠ 렌더러 번들에도 들어가므로 **CJS 런타임 참조(모듈 로더) 금지** — 맨 끝 `module.exports` 한 줄만(v0.3.40 백지 사고).
 *
 * Vrew 필드 이름은 2026-09-25 로이의 샘플.vrew + Vrew 설치본(resources/static/assets/scene-*.js)에서 확인했다:
 *   bold·italic·strike·underline = "true" · font = "<가족>-Vrew_<굵기>" · size · color
 *   outline-on/-color/-width · secondary-outline-on/-color/-width(이중 테두리)
 *   background-on + background(+background-alpha · -radius · -padding-side/-top/-bottom) = 형광펜(글자 뒤 칠)
 *   shadow-on · shadow-color · shadow-color-alpha · shadow-blur-radius · shadow-position-x/-y
 *   letter-spacing(em) · line-height(배수, 줄바꿈 op 에 붙는다)
 *   배경 상자 = 캡션 style 의 customAttributes `--textbox-color`(줄 단위) · 효과 = 캡션 style 의 assetEffectInfo {type, duration, startDelay}
 */

// ── 채널 기본값 (= 지금까지의 모양 — 안 건드린 채널은 결과가 그대로) ──────────
const FMT_DEFAULT = {
  font: 'Pretendard-Vrew_700',
  fontColor: '#ffffff',
  bold: false, italic: false, underline: false, strike: false,
  letterSpacing: 0, lineHeight: 1,
  outlineOn: true, outlineColor: '#000000', outlineWidth: 6,
  outline2On: false, outline2Color: '#ffffff', outline2Width: 4,
  boxOn: false, boxColor: '#000000', boxOpacity: 60,
  hlOn: false, hlColor: '#fcc800', hlOpacity: 100,
  shadowOn: false, shadowColor: '#000000', shadowOpacity: 50, shadowBlur: 4, shadowX: 0, shadowY: 0,
  anim: null,   // { type, duration(ms), delay(ms) } — 줄 단위
};

// 줄 단위(조각이 줄 일부만 덮어도 줄 전체에 적용) — 캡션 style 쪽에 들어가는 것들
const LINE_KEYS = ['boxOn', 'boxColor', 'boxOpacity', 'anim', 'lineHeight', 'posH', 'posV', 'posX', 'posY'];

// 📐 줄별 위치·정렬(2026-09-25 v0.5.41) — Vrew 툴바의 가로 정렬(왼/가운데/오른쪽 + 가로 미세)과 세로 정렬(위/가운데/아래 + 세로 미세).
//   ⚠ FMT_DEFAULT 에는 넣지 않는다 — 없으면(undefined) = **채널 위치를 따른다**. 채널 위치는 capLong 의 align·yAlign·yOffset 이
//     따로 가진다(이름이 겹치지 않게 pos* 로 지었다 — capToStyle 이 ...capLookOf 를 뒤에 펼치므로 같은 이름이면 덮인다).
//   posH = --textbox-align(start|center|end) · posV = yAlign(top|middle|bottom) · posX = xOffset · posY = yOffset(Vrew 단위 — 1 = 화면 절반, + = 오른쪽/아래)
const POS_KEYS = ['posH', 'posV', 'posX', 'posY'];
// 세로 정렬을 바꿀 때의 기본 세로 위치 — 아래/위는 서로 거울(하단 여백 173px ↔ 상단 여백 173px), 가운데는 0
const POS_Y_DEFAULT = { bottom: -0.125, top: 0.125, middle: 0 };
const POS_H = ['start', 'center', 'end'];
const POS_V = ['top', 'middle', 'bottom'];

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function num(v, d, lo, hi) {
  if (v === '' || v == null) return d;
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, lo, hi) : d;
}
const hex = (v, d) => (HEX.test(String(v || '')) ? String(v).toLowerCase() : d);

// 키별 정리 규칙 — 조각(부분 서식)에도 같은 규칙을 쓴다(없는 키는 그대로 없음).
const RULES = {
  font: (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d),
  size: (v, d) => num(v, d, 20, 400),
  fontColor: hex, outlineColor: hex, outline2Color: hex, boxColor: hex, hlColor: hex, shadowColor: hex,
  bold: (v) => !!v, italic: (v) => !!v, underline: (v) => !!v, strike: (v) => !!v,
  outlineOn: (v) => v !== false, outline2On: (v) => !!v, boxOn: (v) => !!v, hlOn: (v) => !!v, shadowOn: (v) => !!v,
  letterSpacing: (v, d) => num(v, d, -0.2, 0.8),
  lineHeight: (v, d) => num(v, d, 0.5, 2),
  outlineWidth: (v, d) => num(v, d, 0, 20),
  outline2Width: (v, d) => num(v, d, 0, 20),
  boxOpacity: (v, d) => num(v, d, 0, 100),
  hlOpacity: (v, d) => num(v, d, 0, 100),
  shadowOpacity: (v, d) => num(v, d, 0, 100),
  shadowBlur: (v, d) => num(v, d, 0, 60),
  shadowX: (v, d) => num(v, d, -30, 30),
  shadowY: (v, d) => num(v, d, -30, 30),
  anim: (v) => normAnim(v),
  posH: (v) => (POS_H.includes(v) ? v : undefined),
  posV: (v) => (POS_V.includes(v) ? v : undefined),
  posX: (v) => { const n = num(v, undefined, -1, 1); return n === undefined ? undefined : Math.round(n * 10000) / 10000; },
  posY: (v) => { const n = num(v, undefined, -1, 1); return n === undefined ? undefined : Math.round(n * 10000) / 10000; },
};

/** 효과 {type, duration, delay} 정리 — 모르는 효과 이름·빈 값이면 null(효과 없음). */
function normAnim(v) {
  if (!v || typeof v !== 'object') return null;
  const type = String(v.type || '').trim();
  if (!type || !ANIM_TYPES.has(type)) return null;
  return { type, duration: Math.round(num(v.duration, 900, 100, 10000)), delay: Math.round(num(v.delay, 0, 0, 10000)) };
}

/** 채널 기본 서식 정리 — 빠진 키는 기본값. 옛 capLong(자막 모양 v0.5.28)도 키 이름이 같아 그대로 읽힌다. */
function normFmt(c) {
  const o = { ...FMT_DEFAULT };
  if (!c || typeof c !== 'object') return o;
  for (const k of Object.keys(FMT_DEFAULT)) {
    if (!(k in c)) continue;
    o[k] = RULES[k] ? RULES[k](c[k], FMT_DEFAULT[k]) : c[k];
  }
  if (c.size != null) { const s = RULES.size(c.size, null); if (s != null) o.size = s; }
  return o;
}

/** 조각 서식(부분) 정리 — 들어 있는 키만 남긴다. `null` 은 「덮어쓰기 해제」 표시로 쓰지 않는다(키를 지운다). */
function normPatch(p) {
  const o = {};
  if (!p || typeof p !== 'object') return o;
  for (const k of Object.keys(p)) {
    if (!(k in RULES)) continue;
    if (p[k] === undefined) continue;
    if (k === 'anim') { o.anim = normAnim(p.anim); continue; }   // null = 효과 없음(채널 기본 효과를 끈다)
    const v = RULES[k](p[k], undefined);
    if (v !== undefined) o[k] = v;
  }
  return o;
}

// ── 조각(span) 다루기 ──────────────────────────────────────────────────────
function cleanSpans(spans, textLen) {
  const out = [];
  for (const s of (Array.isArray(spans) ? spans : [])) {
    if (!s || typeof s !== 'object') continue;
    let from = Math.floor(Number(s.from)), to = Math.floor(Number(s.to));
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (textLen != null) { from = clamp(from, 0, textLen); to = clamp(to, 0, textLen); }
    if (!(to > from)) continue;
    const fmt = normPatch(s.fmt);
    if (!Object.keys(fmt).length) continue;
    out.push({ from, to, fmt });
  }
  return out;
}

/** 글자 i 의 덮어쓰기 서식(겹치면 나중 조각이 이긴다). */
function fmtAt(spans, i) {
  let o = null;
  for (const s of spans) if (i >= s.from && i < s.to) o = Object.assign(o || {}, s.fmt);
  return o || {};
}

const sameFmt = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(o) { const r = {}; for (const k of Object.keys(o || {}).sort()) r[k] = o[k]; return r; }

/**
 * 조각 목록을 **겹치지 않는 구간**으로 다시 만든다(글자마다 최종 서식 → 같은 서식끼리 묶기).
 * 쌓이기만 하면 편집할수록 조각이 늘어나므로, 바꿀 때마다 한 번 접는다.
 */
function flattenSpans(spans, textLen) {
  const sp = cleanSpans(spans, textLen);
  if (!sp.length) return [];
  const cuts = new Set([0, textLen]);
  for (const s of sp) { cuts.add(s.from); cuts.add(s.to); }
  const pts = [...cuts].filter((x) => x >= 0 && x <= textLen).sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1];
    if (!(b > a)) continue;
    const f = fmtAt(sp, a);
    if (!Object.keys(f).length) continue;
    const last = out[out.length - 1];
    if (last && last.to === a && sameFmt(last.fmt, f)) last.to = b;
    else out.push({ from: a, to: b, fmt: f });
  }
  return out;
}

/** [from,to) 에 서식 patch 를 얹는다. */
function applySpan(spans, textLen, from, to, patch) {
  const p = normPatch(patch);
  if (!Object.keys(p).length) return flattenSpans(spans, textLen);
  return flattenSpans([...(spans || []), { from, to, fmt: p }], textLen);
}

/** [from,to) 의 덮어쓰기를 지운다. keys 를 주면 그 키만(없으면 전부 = 채널 기본으로 되돌리기). */
function clearSpan(spans, textLen, from, to, keys) {
  const out = [];
  for (const s of cleanSpans(spans, textLen)) {
    const pieces = [];
    if (s.from < from) pieces.push({ from: s.from, to: Math.min(s.to, from), fmt: s.fmt });
    if (s.to > to) pieces.push({ from: Math.max(s.from, to), to: s.to, fmt: s.fmt });
    const ia = Math.max(s.from, from), ib = Math.min(s.to, to);
    if (ib > ia && keys && keys.length) {
      const f = { ...s.fmt };
      for (const k of keys) delete f[k];
      if (Object.keys(f).length) pieces.push({ from: ia, to: ib, fmt: f });
    }
    out.push(...pieces);
  }
  return flattenSpans(out, textLen);
}

/**
 * 글이 바뀌었을 때 조각을 옮긴다 — 앞뒤 공통 부분은 그대로 두고 바뀐 가운데만 늘이고 줄인다.
 * (문장 편집에서 오타 하나를 고쳐도 그 문장의 서식이 사라지지 않게)
 */
function remapSpans(oldText, newText, spans) {
  const a = String(oldText || ''), b = String(newText || '');
  const sp = cleanSpans(spans, a.length);
  if (!sp.length) return [];
  if (a === b) return flattenSpans(sp, b.length);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  const aEnd = a.length - q, bEnd = b.length - q, d = b.length - a.length;
  const mapPos = (x, isEnd) => {
    if (x <= p) return x;
    if (x >= aEnd) return x + d;
    // 바뀐 구간 안 — 시작은 바뀐 구간 앞으로, 끝은 새 구간 끝으로(서식이 새 글자를 덮도록)
    return isEnd ? bEnd : p;
  };
  const out = sp.map((s) => ({ from: mapPos(s.from, false), to: mapPos(s.to, true), fmt: s.fmt }));
  return flattenSpans(out, b.length);
}

/**
 * 여러 문장 → 여러 문장(병합·나누기). 옛 문장들을 공백 하나로 이은 글 위의 조각을 새 문장들을 이은 글로 옮긴 뒤 자른다.
 * @returns 새 문장마다의 조각 배열
 */
function remapSpansMulti(oldTexts, oldSpansList, newTexts) {
  const joinA = (oldTexts || []).join(' ');
  const all = [];
  let off = 0;
  (oldTexts || []).forEach((t, i) => {
    for (const s of cleanSpans((oldSpansList || [])[i], String(t).length)) all.push({ from: s.from + off, to: s.to + off, fmt: s.fmt });
    off += String(t).length + 1;
  });
  const joinB = (newTexts || []).join(' ');
  const moved = remapSpans(joinA, joinB, all);
  const res = [];
  let o = 0;
  for (const t of (newTexts || [])) {
    const L = String(t).length;
    const mine = [];
    for (const s of moved) {
      const a = Math.max(s.from, o), b = Math.min(s.to, o + L);
      if (b > a) mine.push({ from: a - o, to: b - o, fmt: s.fmt });
    }
    res.push(flattenSpans(mine, L));
    o += L + 1;
  }
  return res;
}

// ── 줄 ─────────────────────────────────────────────────────────────────────
/**
 * 자막 줄(caption-splitter 결과)이 문장의 어느 글자 범위인지. 줄은 원문의 부분 문자열이지만
 * 공백이 다를 수 있으므로 **공백이 아닌 글자를 차례로 맞춰** 찾는다(indexOf 가 실패해도 어긋나지 않게).
 * @returns [{from, to}] — 줄마다
 */
function lineRanges(text, lines) {
  const t = String(text || '');
  const out = [];
  let c = 0;
  for (const line of (lines || [])) {
    const l = String(line || '');
    const direct = t.indexOf(l, c);
    if (l && direct >= 0 && direct - c <= 2) { out.push({ from: direct, to: direct + l.length }); c = direct + l.length; continue; }
    // 공백 무시 맞추기
    const need = l.replace(/\s+/g, '');
    let i = c; while (i < t.length && /\s/.test(t[i])) i++;
    const from = i;
    let k = 0;
    while (i < t.length && k < need.length) { if (!/\s/.test(t[i])) k++; i++; }
    out.push({ from, to: i });
    c = i;
  }
  return out;
}

/**
 * 한 줄을 서식 구간(run)으로 나눈다.
 * @returns [{text, fmt}] — fmt 는 **채널 기본 + 덮어쓰기**가 합쳐진 완성 서식
 */
function lineRuns(text, spans, range, base) {
  const t = String(text || '');
  const sp = cleanSpans(spans, t.length);
  const b = normFmt(base);
  if (base && base.size != null) b.size = base.size;
  const from = range ? range.from : 0, to = range ? range.to : t.length;
  const cuts = new Set([from, to]);
  for (const s of sp) { if (s.from > from && s.from < to) cuts.add(s.from); if (s.to > from && s.to < to) cuts.add(s.to); }
  const pts = [...cuts].sort((x, y) => x - y);
  const runs = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], e = pts[k + 1];
    if (!(e > a)) continue;
    const f = { ...b, ...fmtAt(sp, a) };
    const prev = runs[runs.length - 1];
    if (prev && sameFmt(prev.fmt, f)) prev.text += t.slice(a, e);
    else runs.push({ text: t.slice(a, e), fmt: f });
  }
  if (!runs.length) runs.push({ text: t.slice(from, to), fmt: b });
  return runs;
}

/** 줄 단위 속성(배경 상자·효과·줄 간격) — 줄의 첫 글자를 덮는 조각이 정한다(없으면 채널 기본). */
function lineProps(spans, range, base, textLen) {
  const b = normFmt(base);
  const sp = cleanSpans(spans, textLen);
  const o = {};
  for (const k of LINE_KEYS) o[k] = b[k];
  // 줄 안 어디든 효과가 걸린 조각이 있으면 그 효과를 쓴다(줄 일부만 골라 효과를 줘도 먹게)
  for (const s of sp) {
    if (!(s.to > range.from && s.from < range.to)) continue;
    for (const k of LINE_KEYS) if (k in s.fmt) o[k] = s.fmt[k];
  }
  return o;
}

// ── Vrew 속성 변환 ─────────────────────────────────────────────────────────
const alpha01 = (pct) => String(+(clamp(Number(pct), 0, 100) / 100).toFixed(2));

/** 완성 서식 → Vrew 글자 속성(Quill insert.attributes). */
function fmtToVrewAttrs(f, size) {
  const a = {
    font: f.font || FMT_DEFAULT.font,
    size: String(Math.round(Number(f.size != null ? f.size : size) || 100)),
    color: f.fontColor || '#ffffff',
    'outline-on': f.outlineOn === false ? 'false' : 'true',
    'outline-color': f.outlineColor || '#000000',
    'outline-width': String(Math.round(Number(f.outlineWidth != null ? f.outlineWidth : 6))),
  };
  if (f.bold) a.bold = 'true';
  if (f.italic) a.italic = 'true';
  if (f.underline) a.underline = 'true';
  if (f.strike) a.strike = 'true';
  if (f.outline2On) {
    a['secondary-outline-on'] = 'true';
    a['secondary-outline-color'] = f.outline2Color || '#ffffff';
    a['secondary-outline-width'] = String(Math.round(Number(f.outline2Width) || 4));
  }
  if (f.hlOn) {
    a['background-on'] = 'true';
    a.background = f.hlColor || '#fcc800';
    if (Number(f.hlOpacity) < 100) a['background-alpha'] = alpha01(f.hlOpacity);
  }
  if (f.shadowOn) {
    a['shadow-on'] = 'true';
    a['shadow-color'] = f.shadowColor || '#000000';
    a['shadow-color-alpha'] = alpha01(f.shadowOpacity != null ? f.shadowOpacity : 50);
    a['shadow-blur-radius'] = String(Math.round(Number(f.shadowBlur) || 0));
    if (Number(f.shadowX)) a['shadow-position-x'] = String(Math.round(Number(f.shadowX)));
    if (Number(f.shadowY)) a['shadow-position-y'] = String(Math.round(Number(f.shadowY)));
  }
  if (Number(f.letterSpacing)) a['letter-spacing'] = String(+Number(f.letterSpacing).toFixed(2));
  return a;
}

/** Vrew 글자 속성 → 서식(MP4 렌더러가 .vrew 를 읽을 때). 없는 값은 채널 기본(=Vrew 기본)으로. */
function vrewAttrsToFmt(a) {
  a = a || {};
  const t = (k) => String(a[k]) === 'true';
  const f = normFmt({});
  if (a.font) f.font = String(a.font);
  if (a.size != null) f.size = Number(a.size) || 100;
  if (a.color) f.fontColor = String(a.color);
  f.bold = t('bold'); f.italic = t('italic'); f.underline = t('underline'); f.strike = t('strike');
  f.outlineOn = String(a['outline-on'] ?? 'true') !== 'false';
  if (a['outline-color']) f.outlineColor = String(a['outline-color']);
  if (a['outline-width'] != null) f.outlineWidth = Number(a['outline-width']) || 0;
  f.outline2On = t('secondary-outline-on');
  if (a['secondary-outline-color']) f.outline2Color = String(a['secondary-outline-color']);
  if (a['secondary-outline-width'] != null) f.outline2Width = Number(a['secondary-outline-width']) || 0;
  f.hlOn = t('background-on');
  if (a.background) f.hlColor = String(a.background);
  f.hlOpacity = a['background-alpha'] != null ? Math.round(Number(a['background-alpha']) * 100) : 100;
  f.shadowOn = t('shadow-on');
  if (a['shadow-color']) f.shadowColor = String(a['shadow-color']);
  f.shadowOpacity = a['shadow-color-alpha'] != null ? Math.round(Number(a['shadow-color-alpha']) * 100) : 50;
  f.shadowBlur = a['shadow-blur-radius'] != null ? Number(a['shadow-blur-radius']) || 0 : 4;
  f.shadowX = Number(a['shadow-position-x']) || 0;
  f.shadowY = Number(a['shadow-position-y']) || 0;
  f.letterSpacing = Number(a['letter-spacing']) || 0;
  if (a['line-height'] != null) f.lineHeight = Number(a['line-height']) || 1;
  return f;
}

/** 줄 단위 속성 → 배경 상자 색(`--textbox-color` 값). 없으면 투명. */
function boxColorValue(lp) {
  if (!lp || !lp.boxOn) return 'rgba(0, 0, 0, 0)';
  const h = hex(lp.boxColor, '#000000');
  return `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${+(num(lp.boxOpacity, 60, 0, 100) / 100).toFixed(2)})`;
}

/** `--textbox-color` 값(rgba·#hex) → 줄 단위 배경 상자 { boxOn, boxColor, boxOpacity }. 투명이면 boxOn=false. */
function boxFromValue(v) {
  const s = String(v || '').trim();
  let r, g, b, a = 1, m;
  if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s))) {
    r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4, 6), 16);
    if (m[2]) a = parseInt(m[2], 16) / 255;
  } else if ((m = /^rgba?\(([^)]+)\)$/i.exec(s))) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    [r, g, b] = p; if (p.length > 3 && isFinite(p[3])) a = p[3];
  } else return { boxOn: false, boxColor: '#000000', boxOpacity: 0 };
  const h2 = (n) => clamp(Math.round(n || 0), 0, 255).toString(16).padStart(2, '0');
  return { boxOn: a > 0.001, boxColor: '#' + h2(r) + h2(g) + h2(b), boxOpacity: Math.round(a * 100) };
}

/** 효과 → Vrew assetEffectInfo(없으면 null). */
function animToVrew(anim) {
  const a = normAnim(anim);
  return a ? { type: a.type, duration: a.duration, startDelay: a.delay } : null;
}
function animFromVrew(e) {
  if (!e || typeof e !== 'object') return null;
  return normAnim({ type: e.type, duration: e.duration, delay: e.startDelay });
}

/**
 * 한 줄 → Vrew 캡션 text(Quill delta). 구간마다 insert 하나, 끝에 줄바꿈(줄 간격은 여기에 붙는다 — Vrew 저장 형식).
 */
function lineToVrewDelta(runs, lineHeight) {
  const ops = runs.map((r) => ({ insert: r.text, attributes: fmtToVrewAttrs(r.fmt) }));
  const nl = { insert: '\n' };
  if (Number(lineHeight) && Number(lineHeight) !== 1) nl.attributes = { 'line-height': String(+Number(lineHeight).toFixed(2)) };
  ops.push(nl);
  return ops;
}

/** Vrew 캡션 text(delta) → 구간 + 줄 간격 (MP4 렌더러). */
function vrewDeltaToRuns(ops) {
  const runs = [];
  let lineHeight = 1;
  for (const op of (Array.isArray(ops) ? ops : [])) {
    const s = String(op && op.insert != null ? op.insert : '');
    const at = (op && op.attributes) || {};
    if (at['line-height'] != null) lineHeight = Number(at['line-height']) || 1;
    const txt = s.replace(/\r?\n/g, '');
    if (!txt) continue;
    const f = vrewAttrsToFmt(at);
    const prev = runs[runs.length - 1];
    if (prev && sameFmt(prev.fmt, f)) prev.text += txt;
    else runs.push({ text: txt, fmt: f });
  }
  // 앞뒤 공백 정리(렌더에서 여백이 튀지 않게)
  if (runs.length) { runs[0].text = runs[0].text.replace(/^\s+/, ''); runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, ''); }
  return { runs: runs.filter((r) => r.text), lineHeight };
}

// ── 글꼴 이름 ──────────────────────────────────────────────────────────────
/** Vrew 글꼴 표기 = 「가족 이름 + -Vrew_ + 굵기」(글꼴 파일의 이름표에서 실측 — 교보 손글씨 2025 · Pretendard 700). */
function vrewFontName(family, weight) { return `${String(family).trim()}-Vrew_${Math.round(Number(weight) || 400)}`; }
function parseVrewFont(name) {
  const m = /^(.*)-Vrew_(\d{3})$/.exec(String(name || '').trim());
  return m ? { family: m[1], weight: +m[2] } : { family: String(name || '').trim(), weight: 400 };
}

// ── 효과 목록 (Vrew 설치본에서 뽑은 전체 목록 — 이름·분류·방향·타이밍) ─────────
// preset 별로 묶는다. timing: IN 등장 · OUT 퇴장 · INOUT 전체 · LOOP 강조(반복) · ONCE 강조(한 번)
const ANIM_LIST = [
  { preset: 'typing', label: '타이핑', types: [['typing', 'IN', 'NONE']] },
  { preset: 'fade', label: '페이드', types: [['fade-in', 'IN', 'NONE'], ['fade-in-up', 'IN', 'UP'], ['fade-in-down', 'IN', 'DOWN'], ['fade-in-right', 'IN', 'RIGHT'], ['fade-in-left', 'IN', 'LEFT'], ['fade-out', 'OUT', 'NONE'], ['fade-out-up', 'OUT', 'UP'], ['fade-out-down', 'OUT', 'DOWN'], ['fade-out-right', 'OUT', 'RIGHT'], ['fade-out-left', 'OUT', 'LEFT'], ['fade-in-out', 'INOUT', 'NONE']] },
  { preset: 'roll', label: '굴러오기', types: [['roll-in', 'IN', 'NONE'], ['roll-out', 'OUT', 'NONE']] },
  { preset: 'focus', label: '다가오기', types: [['focus-in', 'IN', 'NONE'], ['focus-in-up', 'IN', 'UP'], ['focus-in-down', 'IN', 'DOWN'], ['focus-in-right', 'IN', 'RIGHT'], ['focus-in-left', 'IN', 'LEFT'], ['focus-out', 'OUT', 'NONE'], ['focus-out-up', 'OUT', 'UP'], ['focus-out-down', 'OUT', 'DOWN'], ['focus-out-right', 'OUT', 'RIGHT'], ['focus-out-left', 'OUT', 'LEFT']] },
  { preset: 'flip', label: '뒤집기', types: [['flip-in-x', 'IN', 'UP'], ['flip-in-y', 'IN', 'RIGHT'], ['flip-out-x', 'OUT', 'UP'], ['flip-out-y', 'OUT', 'RIGHT']] },
  { preset: 'rotate', label: '돌아오기', types: [['rotate-in', 'IN', 'NONE'], ['rotate-in-down-right', 'IN', 'RIGHT'], ['rotate-in-down-left', 'IN', 'LEFT'], ['rotate-out', 'OUT', 'NONE'], ['rotate-out-down-right', 'OUT', 'RIGHT'], ['rotate-out-down-left', 'OUT', 'LEFT']] },
  { preset: 'fly', label: '날아오기', types: [['slide-in-right', 'IN', 'RIGHT'], ['slide-in-left', 'IN', 'LEFT'], ['slide-out-right', 'OUT', 'RIGHT'], ['slide-out-left', 'OUT', 'LEFT']] },
  { preset: 'pop', label: '팝', types: [['popping-in', 'IN', 'NONE'], ['popping-in-up', 'IN', 'UP'], ['popping-in-down', 'IN', 'DOWN'], ['popping-in-right', 'IN', 'RIGHT'], ['popping-in-left', 'IN', 'LEFT'], ['popping-out', 'OUT', 'NONE'], ['popping-out-up', 'OUT', 'UP'], ['popping-out-down', 'OUT', 'DOWN'], ['popping-out-right', 'OUT', 'RIGHT'], ['popping-out-left', 'OUT', 'LEFT']] },
  { preset: 'moving', label: '이동하기', types: [['moving-in-up', 'IN', 'UP'], ['moving-in-down', 'IN', 'DOWN'], ['moving-in-left', 'IN', 'LEFT'], ['moving-in-right', 'IN', 'RIGHT'], ['moving-out-up', 'OUT', 'UP'], ['moving-out-down', 'OUT', 'DOWN'], ['moving-out-left', 'OUT', 'LEFT'], ['moving-out-right', 'OUT', 'RIGHT']] },
  // 강조 — "-once" 는 한 번, 없으면 줄이 떠 있는 동안 반복
  { preset: 'tada', label: '짜잔', highlight: true, types: [['tada-once', 'ONCE', 'NONE'], ['tada', 'LOOP', 'NONE']] },
  { preset: 'shake', label: '흔들기', highlight: true, types: [['shake-x-once', 'ONCE', 'RIGHT'], ['shake-x', 'LOOP', 'RIGHT'], ['shake-y-once', 'ONCE', 'UP'], ['shake-y', 'LOOP', 'UP']] },
  { preset: 'swing', label: '스윙', highlight: true, types: [['swing-once', 'ONCE', 'NONE'], ['swing', 'LOOP', 'NONE']] },
  { preset: 'rubber-band', label: '고무줄', highlight: true, types: [['rubber-band-once', 'ONCE', 'NONE'], ['rubber-band', 'LOOP', 'NONE']] },
  { preset: 'heart-beat', label: '두근두근', highlight: true, types: [['heart-beat-once', 'ONCE', 'NONE'], ['heart-beat', 'LOOP', 'NONE']] },
  { preset: 'flip-highlight', label: '회전', highlight: true, types: [['flip-once', 'ONCE', 'NONE'], ['flip', 'LOOP', 'NONE']] },
  { preset: 'blink', label: '깜빡이기', highlight: true, types: [['blink-once', 'ONCE', 'NONE'], ['blink', 'LOOP', 'NONE']] },
  { preset: 'pop-highlight', label: '톡톡', highlight: true, types: [['popping-once', 'ONCE', 'NONE'], ['popping', 'LOOP', 'NONE']] },
];
const ANIM_INFO = {};
for (const g of ANIM_LIST) for (const [type, timing, dir] of g.types) ANIM_INFO[type] = { type, timing, dir, preset: g.preset, label: g.label, highlight: !!g.highlight };
const ANIM_TYPES = new Set(Object.keys(ANIM_INFO));

/** 같은 효과 묶음(preset) 안에서 타이밍·방향으로 효과 이름 찾기(없으면 그 묶음의 첫 효과). */
function animTypeFor(preset, timing, dir) {
  const g = ANIM_LIST.find((x) => x.preset === preset);
  if (!g) return null;
  const hit = g.types.find(([, t, d]) => t === timing && d === dir)
    || g.types.find(([, t]) => t === timing)
    || g.types[0];
  return hit[0];
}

/**
 * 📐 줄 위치 = 채널 위치(chan: {align, yAlign, yOffset, xOffset}) + 줄 덮어쓰기(lp.posH/posV/posX/posY).
 *   세로 정렬만 바꾸고 세로 위치를 안 줬으면 그 정렬의 기본 세로 위치(채널이 같은 정렬이면 채널 값)를 쓴다.
 * @returns {{align, yAlign, yOffset, xOffset, overridden}}
 */
function linePos(chan, lp) {
  const c = chan || {};
  const l = lp || {};
  const align = POS_H.includes(l.posH) ? l.posH : (POS_H.includes(c.align) ? c.align : 'center');
  const cy = POS_V.includes(c.yAlign) ? c.yAlign : 'middle';
  const yAlign = POS_V.includes(l.posV) ? l.posV : cy;
  const cyOff = Number.isFinite(+c.yOffset) ? +c.yOffset : 0;
  let yOffset;
  if (Number.isFinite(+l.posY) && l.posY != null) yOffset = +l.posY;
  else if (yAlign === cy) yOffset = cyOff;
  else yOffset = POS_Y_DEFAULT[yAlign];
  const xOffset = (Number.isFinite(+l.posX) && l.posX != null) ? +l.posX : (Number.isFinite(+c.xOffset) ? +c.xOffset : 0);
  const overridden = POS_KEYS.some((k) => l[k] != null);
  return { align, yAlign, yOffset, xOffset, overridden };
}

module.exports = {
  FMT_DEFAULT, LINE_KEYS, POS_KEYS, POS_Y_DEFAULT, linePos, normFmt, normPatch, normAnim,
  cleanSpans, flattenSpans, applySpan, clearSpan, remapSpans, remapSpansMulti, fmtAt,
  lineRanges, lineRuns, lineProps,
  fmtToVrewAttrs, vrewAttrsToFmt, boxColorValue, boxFromValue, animToVrew, animFromVrew, lineToVrewDelta, vrewDeltaToRuns,
  vrewFontName, parseVrewFont,
  ANIM_LIST, ANIM_INFO, ANIM_TYPES, animTypeFor,
};
