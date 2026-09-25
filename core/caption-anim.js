'use strict';

/**
 * caption-anim.js — 자막 효과(등장·퇴장·강조)의 **시간 → 모양** 계산 (2026-09-25).
 *
 * 🔑 키프레임 데이터(caption-anim-data.js)는 Vrew 설치본의 CSS @keyframes 를 그대로 옮긴 것이다.
 *   이 모듈 하나를 MP4·화이트보드(ASS 프레임 이벤트)와 화면 미리보기(JS 로 transform)가 함께 쓴다 →
 *   세 곳이 **같은 움직임**을 낸다. 두 벌로 두면 반드시 어긋난다.
 *   ⚠ 렌더러 번들에도 들어간다 — CJS 런타임 참조 금지(맨 끝 module.exports 한 줄만).
 *
 * CSS 규칙을 그대로 따른다:
 *   · `transform` 은 한 속성이다 — 어떤 키프레임이 transform 을 정의하면 빠진 성분은 **항등값**(회전 0·배율 1·이동 0)
 *   · 어떤 키프레임에도 없는 끝(0%·100%)은 원래 모양(불투명 1·항등 transform)
 *   · 구간마다 CSS 기본 타이밍 `ease`
 */

const { KF } = require('./caption-anim-data');
const { ANIM_INFO, normAnim } = require('./caption-format');

// 효과 이름 → 키프레임 이름(한 번 버전은 반복 버전과 같은 움직임)
const KF_ALIAS = {
  'tada-once': 'tada', 'shake-x-once': 'shake-x', 'shake-y-once': 'shake-y', 'swing-once': 'swing',
  'rubber-band-once': 'rubber-band', 'heart-beat-once': 'heart-beat', 'flip-once': 'flip', 'blink-once': 'blink',
  'popping-once': 'popping',
};
const T_KEYS = ['tx', 'ty', 'sx', 'sy', 'rz', 'rx', 'ry', 'skx'];
const IDENT = { tx: { v: 0, u: 'px' }, ty: { v: 0, u: 'px' }, sx: 1, sy: 1, rz: 0, rx: 0, ry: 0, skx: 0 };

// CSS `ease` = cubic-bezier(0.25, 0.1, 0.25, 1)
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dsx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = sx(t) - x; const d = dsx(t); if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break; t -= e / d; }
    t = Math.max(0, Math.min(1, t));
    return sy(t);
  };
}
const EASE = cubicBezier(0.25, 0.1, 0.25, 1);

function lerpLen(a, b, k) {
  // 0 은 단위가 없다 — CSS 도 `translate3d(0,0,0)` 과 `100vw` 사이를 그대로 보간한다(단위를 상대 쪽에 맞춘다)
  if (a.u !== b.u) {
    if (a.v === 0) a = { v: 0, u: b.u };
    else if (b.v === 0) b = { v: 0, u: a.u };
    else return k < 0.5 ? a : b;   // 둘 다 0 이 아니고 단위가 다르면(키프레임에 없음) 끝 단위
  }
  return { v: a.v + (b.v - a.v) * k, u: a.u };
}

/** 키프레임 목록에서 속성 하나의 (p, 값) 점들을 모은다 — 끝이 비면 원래 값으로 채운다. */
function trackOf(frames, key) {
  const pts = [];
  for (const f of frames) {
    if (key === 'op') { if (f.op != null) pts.push({ p: f.p, v: f.op }); continue; }
    // transform 성분: 그 프레임이 transform 을 정의했으면(없는 성분 = 항등값), 아니면 건너뛴다.
    //   (typing-down/up 의 top 은 transform 이 아니지만 ty 로 옮겨 두었다 — 따로 있는 값만 쓴다)
    if (f.t) pts.push({ p: f.p, v: f[key] != null ? f[key] : IDENT[key] });
    else if (f[key] != null) pts.push({ p: f.p, v: f[key] });
  }
  const base = key === 'op' ? 1 : IDENT[key];
  if (!pts.length) return null;
  if (pts[0].p > 0) pts.unshift({ p: 0, v: base });
  if (pts[pts.length - 1].p < 100) pts.push({ p: 100, v: base });
  return pts;
}

const _cache = new Map();
function tracksFor(kfName) {
  if (_cache.has(kfName)) return _cache.get(kfName);
  const frames = KF[kfName];
  let tr = null;
  if (frames) {
    tr = {};
    for (const k of ['op', ...T_KEYS]) { const t = trackOf(frames, k); if (t) tr[k] = t; }
  }
  _cache.set(kfName, tr);
  return tr;
}

function sampleTrack(pts, p) {
  if (p <= pts[0].p) return pts[0].v;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (p <= b.p) {
      const k = b.p > a.p ? EASE((p - a.p) / (b.p - a.p)) : 1;
      return typeof a.v === 'object' ? lerpLen(a.v, b.v, k) : a.v + (b.v - a.v) * k;
    }
  }
  return pts[pts.length - 1].v;
}

/**
 * 효과 type 의 진행률 p(0~1) 에서의 모양.
 * @returns {op, tx, ty, sx, sy, rz, rx, ry, skx} — tx/ty 는 {v, u}(px|%|vw|vh)
 */
function sampleState(type, p) {
  const name = KF_ALIAS[type] || type;
  const tr = tracksFor(name);
  const st = { op: 1, ...IDENT };
  if (!tr) return st;
  const pp = Math.max(0, Math.min(1, p)) * 100;
  for (const k of Object.keys(tr)) st[k] = sampleTrack(tr[k], pp);
  return st;
}

/**
 * 한 줄(start~end, 초)에서 효과가 도는 구간들.
 * @returns [{t0, t1, type, from, to}] — from/to 는 그 구간에서 키프레임 진행률(0~1)의 시작·끝
 *          + hiddenUntil: 등장 효과의 지연 동안은 첫 프레임 모양(대개 안 보임)으로 둔다.
 */
function animWindows(anim, start, end) {
  const a = normAnim(anim);
  if (!a || !(end > start)) return { windows: [], hiddenUntil: start, info: null };
  const info = ANIM_INFO[a.type] || null;
  const dur = a.duration / 1000, delay = a.delay / 1000;
  const len = end - start;
  const W = [];
  let hiddenUntil = start;
  const timing = info ? info.timing : 'IN';
  if (timing === 'IN') {
    const t0 = Math.min(end, start + delay), t1 = Math.min(end, t0 + dur);
    if (t1 > t0) W.push({ t0, t1, type: a.type, from: 0, to: (t1 - t0) / dur });
    hiddenUntil = t0;
  } else if (timing === 'OUT') {
    const t1 = end, t0 = Math.max(start, end - dur);
    if (t1 > t0) W.push({ t0, t1, type: a.type, from: 1 - (t1 - t0) / dur, to: 1 });
  } else if (timing === 'INOUT') {
    // 전체(페이드 인·아웃) — 앞 절반에 나타나고 끝 절반에 사라진다(Vrew 는 길이를 반씩 쓴다)
    const h = Math.min(dur / 2, len / 2);
    W.push({ t0: start, t1: start + h, type: 'fade-in', from: 0, to: 1 });
    W.push({ t0: end - h, t1: end, type: 'fade-out', from: 0, to: 1 });
  } else if (timing === 'ONCE') {
    const t0 = Math.min(end, start + delay), t1 = Math.min(end, t0 + dur);
    if (t1 > t0) W.push({ t0, t1, type: a.type, from: 0, to: (t1 - t0) / dur });
  } else if (timing === 'LOOP') {
    for (let t0 = start + delay; t0 < end - 1e-6; t0 += dur) {
      const t1 = Math.min(end, t0 + dur);
      W.push({ t0, t1, type: a.type, from: 0, to: (t1 - t0) / dur });
      if (W.length > 2000) break;
    }
  }
  return { windows: W, hiddenUntil, info };
}

/** 효과가 단순 불투명도 페이드(이동·크기 없음)인지 — ASS 에서 \fad 로 싸게 처리한다. */
function isPureFade(type) {
  return type === 'fade-in' || type === 'fade-out' || type === 'fade-in-out';
}

/** 타이핑 — 진행률 p 에서 보이는 글자 수(공백은 세지 않는다). */
function typingVisible(p, total) {
  return Math.max(0, Math.min(total, Math.ceil(p * total - 1e-9)));
}

/**
 * {v,u} → 픽셀. % 는 **요소 자신**의 크기(CSS translate 규칙), vw/vh 는 화면, px 는 Vrew 픽셀 × pxK.
 */
function lenPx(l, axis, box, frame, pxK) {
  if (!l) return 0;
  if (typeof l === 'number') return l * pxK;
  if (l.u === '%') return l.v / 100 * (axis === 'x' ? box.w : box.h);
  if (l.u === 'vw') return l.v / 100 * frame.w;
  if (l.u === 'vh') return l.v / 100 * frame.h;
  return l.v * pxK;
}

module.exports = { sampleState, animWindows, isPureFade, typingVisible, lenPx, EASE, KF_ALIAS };
