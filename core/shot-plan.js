'use strict';
/**
 * shot-plan.js — 🎞 한 그림에서 여러 샷 · 속도 상한 · 부드러운 시작/끝(2.0 덧붙임2 ⑱ · ㉕ · 덧붙임5 52 · v1.0.36)
 *   2.0 주문 칸 `shots` 가 있을 때만 MP4 렌더러(core/vrew-render)가 부른다 — .vrew 는 바꾸지 않는다(전환·대사 카드처럼 MP4 전용).
 *   · 샷 = 한 움직임이 이어지는 한 컷. 그림 한 장이 maxSec 초보다 오래 보이면 **같은 그림 안에서** 다른 움직임 · 다른 틀(전체 · 왼쪽 · 오른쪽 · 가까이)로 나눈다(그림을 더 그리지 않음 · GPU 0).
 *   · 같은 움직임 연달아 금지(그림 사이 경계도) · 속도 상한(확대 초당 zoomPerSec 배 · 이동 초당 화면 가로 panPerSec) — 넘으면 **움직이는 폭을 줄인다**(가운데를 두고).
 *   · 시작 · 끝은 천천히(smoothstep — 가운데 속도가 평균의 1.5 배라 상한은 그 꼭대기 속도로 잰다).
 *   · 나누는 대상 = 화면 가운데 꽉 찬 그림 한 장(겹친 그림 · 판 따로 층 · 영상 · 아래층으로 이어진 그림은 건드리지 않는다 · 움직임 「없음」 그림도 그대로 두고 정지 목록에 적는다).
 *   ⚠ 렌더러 번들에 넣지 않는다(Node · 순수 계산 — 시험이 그대로 부른다).
 */
const KB = require('./ken-burns');

const DEF = { maxSec: 20, transSec: 0.7, zoomPerSec: 0.008, panPerSec: 0.01 };
const LIMIT = { maxSec: [4, 20], transSec: [0, 1], zoomPerSec: [0.001, 0.05], panPerSec: [0.001, 0.05] };
const STILL_SEC = 8;   // ㉕ 정지 화면 상한
const PEAK = 1.5;      // smoothstep 꼭대기 속도 / 평균 속도
const W = 1920, H = 1080;
// 틀(Vrew 좌표 — scale = 보이는 영역 비율 · 작을수록 가까이). 가장 가까운 틀도 1.25배(지금 패턴의 1.22배와 비슷 — 그림이 흐려지지 않게)
const FRAMES = {
  wide: { scale: 0.94, centerX: 0.5, centerY: 0.5 },
  left: { scale: 0.82, centerX: 0.41, centerY: 0.5 },
  right: { scale: 0.82, centerX: 0.59, centerY: 0.5 },
  close: { scale: 0.8, centerX: 0.5, centerY: 0.47 },
};
const FRAME_NAME = { wide: '전체', left: '왼쪽', right: '오른쪽', close: '가까이' };
const KIND_NAME = { in: '줌인', out: '줌아웃', lr: '좌→우 팬', rl: '우→좌 팬', bt: '하→상 팬', tb: '상→하 팬', none: '없음' };
// 샷 차례(틀 · 움직임) — 그림마다 시작 자리를 돌려 같은 차례가 되풀이되지 않게
const TEMPLATES = [
  { frame: 'left', kind: 'lr' }, { frame: 'close', kind: 'in' }, { frame: 'right', kind: 'rl' }, { frame: 'wide', kind: 'out' },
  { frame: 'close', kind: 'bt' }, { frame: 'left', kind: 'in' }, { frame: 'right', kind: 'out' }, { frame: 'wide', kind: 'tb' },
];

/** 주문서 칸 → { shots, error } (칸 없음 = null) — 모르는 칸 · 범위 밖은 거절 */
function parseShots(v) {
  if (v == null) return { shots: null, error: '' };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { shots: null, error: `샷 나누기(shots)는 { maxSec, transSec, zoomPerSec, panPerSec } 객체여야 합니다 — ${JSON.stringify(v)}` };
  const extra = Object.keys(v).filter((k) => !(k in DEF));
  if (extra.length) return { shots: null, error: `샷 나누기(shots)에 모르는 칸 — ${extra.join(', ')}(쓸 수 있는 칸: ${Object.keys(DEF).join(', ')})` };
  const out = {};
  for (const k of Object.keys(DEF)) {
    const x = v[k] == null || v[k] === '' ? DEF[k] : Number(v[k]);
    if (!(Number.isFinite(x) && x >= LIMIT[k][0] && x <= LIMIT[k][1])) return { shots: null, error: `shots.${k} 는 ${LIMIT[k][0]}~${LIMIT[k][1]} 입니다 — ${JSON.stringify(v[k])}` };
    out[k] = x;
  }
  return { shots: out, error: '' };
}

const fr = (f) => KB._clampKbFrame(f);
/** 움직임 종류 — 확대/축소 · 가로 · 세로 중 가장 큰 쪽(화면 비율로 잰다) */
function kindOf(kb) {
  if (!kb || !kb.from) return 'none';
  const a = fr(kb.from), b = fr(kb.to || kb.from);
  const s = (a.scale + b.scale) / 2;
  const z = Math.abs(1 / b.scale - 1 / a.scale), x = Math.abs(b.centerX - a.centerX) / s, y = Math.abs(b.centerY - a.centerY) * (H / W) / s;
  if (Math.max(z, x, y) < 1e-4) return 'none';
  if (z >= x && z >= y) return b.scale < a.scale ? 'in' : 'out';
  if (x >= y) return b.centerX < a.centerX ? 'lr' : 'rl';   // ken-burns 패턴 2(좌→우 팬) = centerX 0.55 → 0.45
  return b.centerY > a.centerY ? 'bt' : 'tb';               // 패턴 4(하→상 팬) = centerY 0.45 → 0.55
}
/** 틀 + 움직임 → { from, to } (폭은 아래 capKb 가 속도 상한에 맞춰 줄인다) */
function makeKb(frameName, kind) {
  const f = FRAMES[frameName] || FRAMES.wide;
  const d = 0.05;
  const at = (ds, dx, dy) => fr({ scale: f.scale + ds, centerX: f.centerX + dx, centerY: f.centerY + dy });
  switch (kind) {
    case 'in': return { from: at(0, 0, 0), to: at(-0.08, 0, 0) };
    case 'out': return { from: at(-0.08, 0, 0), to: at(0, 0, 0) };
    case 'lr': return { from: at(0, d, 0), to: at(0, -d, 0) };
    case 'rl': return { from: at(0, -d, 0), to: at(0, d, 0) };
    case 'bt': return { from: at(0, 0, -d), to: at(0, 0, d) };
    case 'tb': return { from: at(0, 0, d), to: at(0, 0, -d) };
    default: return { from: at(0, 0, 0), to: at(0, 0, 0) };
  }
}
/** 꼭대기 속도 { zoom: 배/초, pan: 화면 가로/초 } */
function speedOf(kb, sec) {
  if (!kb || !kb.from || !(sec > 0)) return { zoom: 0, pan: 0 };
  const a = fr(kb.from), b = fr(kb.to || kb.from), s = (a.scale + b.scale) / 2;
  return {
    zoom: Math.abs(1 / b.scale - 1 / a.scale) / sec * PEAK,
    pan: Math.hypot((b.centerX - a.centerX) / s, (b.centerY - a.centerY) * (H / W) / s) / sec * PEAK,
  };
}
/** 속도 상한 — 넘으면 가운데를 두고 폭을 줄인다 → { kb:{from,to,ease:true}, k(줄인 비율 · 1 = 그대로) } */
function capKb(kb, sec, opt) {
  const a = fr(kb.from), b = fr(kb.to || kb.from);
  const sp = speedOf({ from: a, to: b }, sec);
  let k = 1;
  if (sp.zoom > opt.zoomPerSec) k = Math.min(k, opt.zoomPerSec / sp.zoom);
  if (sp.pan > opt.panPerSec) k = Math.min(k, opt.panPerSec / sp.pan);
  k = Math.max(0, Math.min(1, k * 0.995));   // 반올림 여유
  const mid = (p, q) => (p + q) / 2;
  const sh = (p, q) => mid(p, q) + (p - mid(p, q)) * k;
  const from = fr({ scale: sh(a.scale, b.scale), centerX: sh(a.centerX, b.centerX), centerY: sh(a.centerY, b.centerY) });
  const to = fr({ scale: sh(b.scale, a.scale), centerX: sh(b.centerX, a.centerX), centerY: sh(b.centerY, a.centerY) });
  return { kb: { from, to, ease: true }, k };
}

/**
 * 렌더 구간 → 샷으로 나눈 구간.
 * @param segments  vrew-render buildTimeline 의 segments
 * @param opt       parseShots 의 값
 * @param eligible  (seg) => bool — 렌더러가 「한 장 · 표준 박스」를 판정해 넘긴다(박스 규칙을 두 벌로 두지 않게)
 * @returns { segments, shots:[{ start, end, seg, k, n, kind, frame, cap, split }], still:[{ start, end, sec, what }] }
 */
function planShots(segments, opt, eligible) {
  const o = { ...DEF, ...(opt || {}) };
  const out = [], shots = [], still = [];
  let prevKind = null, si = 0;
  const firstKindOf = (seg) => (seg && eligible(seg) ? kindOf(seg.track && seg.track.kenburnsAnimationInfo) : null);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i], dur = seg.end - seg.start;
    if (!eligible(seg) || !(dur > 0)) {
      out.push(seg);
      if (dur > STILL_SEC && (seg.type === 'none' || (seg.type === 'image' && !(seg.layers || []).some((l) => l.track && l.track.kenburnsAnimationInfo)))) still.push({ start: seg.start, end: seg.end, sec: dur, what: seg.type === 'none' ? '검은 화면' : '움직임 없는 그림(겹친 그림)' });
      prevKind = null; continue;
    }
    const tr = seg.track || {};
    const kb0 = tr.kenburnsAnimationInfo;
    if (!kb0 || !kb0.from) {   // 움직임 「없음」 — 사람이 고른 값이라 그대로(정지 목록에만)
      out.push(seg); prevKind = 'none';
      if (dur > STILL_SEC) still.push({ start: seg.start, end: seg.end, sec: dur, what: '움직임 없음으로 고른 그림' });
      continue;
    }
    const n = Math.max(1, Math.ceil(dur / o.maxSec - 1e-6));
    const nextFirst = firstKindOf(segments[i + 1]);
    const plan = [];
    // 첫 샷 = 그 그림의 움직임(지시 줄 · 번호 공식) — 바로 앞 샷과 같으면 차례표에서 고른다
    const k0 = kindOf(kb0);
    if (k0 !== prevKind) plan.push({ kind: k0, frame: null, kb: kb0 });
    let t = (si * 3) % TEMPLATES.length;
    while (plan.length < n) {
      const last = plan.length ? plan[plan.length - 1] : { kind: prevKind, frame: null };
      const isLast = plan.length === n - 1;
      let pick = null;
      for (let j = 0; j < TEMPLATES.length; j++) {
        const c = TEMPLATES[(t + j) % TEMPLATES.length];
        if (c.kind === last.kind || (last.frame && c.frame === last.frame) || (isLast && c.kind === nextFirst)) continue;
        pick = c; t = (t + j + 1) % TEMPLATES.length; break;
      }
      if (!pick) pick = TEMPLATES[t++ % TEMPLATES.length];
      plan.push({ kind: pick.kind, frame: pick.frame, kb: makeKb(pick.frame, pick.kind) });
    }
    // 시각 — 프레임 경계로 고르게
    for (let k = 0; k < n; k++) {
      const a = seg.start + (dur * k) / n, b = k === n - 1 ? seg.end : seg.start + (dur * (k + 1)) / n;
      const cap = capKb(plan[k].kb, b - a, o);
      const track = { ...tr, kenburnsAnimationInfo: cap.kb, ...(k ? { trackId: `${tr.trackId}#s${k}` } : {}) };
      const layers = (seg.layers || []).map((l) => (l.file ? { ...l, track, t0: a, tAll: b - a } : l));
      out.push({ ...seg, start: a, end: b, track, layers, shotIdx: k, shotCut: k > 0, kbTotalSec: undefined });
      shots.push({ start: a, end: b, seg: i, k, n, kind: plan[k].kind, frame: plan[k].frame, cap: Math.round(cap.k * 1000) / 1000, split: n > 1 });
    }
    prevKind = plan[n - 1].kind; si++;
  }
  return { segments: out, shots, still };
}

module.exports = { DEF, LIMIT, STILL_SEC, PEAK, FRAMES, FRAME_NAME, KIND_NAME, TEMPLATES, parseShots, kindOf, makeKb, speedOf, capKb, planShots };
