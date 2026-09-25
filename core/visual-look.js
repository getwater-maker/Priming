'use strict';
/**
 * visual-look.js — 🖼 그룹 그림 「모양」(Vrew 그림 메뉴의 채우기 · 반전 · 애니메이션) + 🏷 AI 고지 문장 범위 (2026-09-25).
 *   · g.look = { fill, flipH, flipV, motion } — 기본값이면 필드를 두지 않는다(옛 작업본·옛 동작 그대로).
 *   · .vrew 는 vrew-builder 가 트랙 박스·editInfo.flip·kenburnsAnimationInfo 로 적고, 🎬 유튜브 MP4 는 그 .vrew 를 읽는다(core/vrew-render placeFilters).
 *   ⚠ ✏ 화이트보드 MP4 는 이 설정을 쓰지 않는다 — 그림 위에 그린 영역 좌표(주석)가 원본 그림 기준이라 뒤집으면 어긋난다. 켄번스도 없다.
 *   ⚠ 렌더러 번들에도 들어간다 — CJS 런타임 참조 금지(v0.3.40 백지 화면 사고).
 */

const FILLS = [
  { id: 'auto', label: '자동', hint: '그림 비율이 화면과 같으면 꽉 채우고, 다르면 맞춥니다(지금까지의 동작)' },
  { id: 'cover', label: '꽉 채우기', hint: '화면을 빈틈없이 채웁니다 — 비율이 다르면 넘치는 쪽이 잘립니다' },
  { id: 'contain', label: '맞추기', hint: '그림 전체가 보이게 — 비율이 다르면 위아래(또는 좌우)에 검은 띠' },
];
const MOTIONS = [
  { id: 'auto', label: '자동(그룹마다 다르게)' },
  { id: 'none', label: '없음(멈춘 그림)' },
  { id: 'in', label: '천천히 다가가기(줌 인)' },
  { id: 'out', label: '천천히 멀어지기(줌 아웃)' },
  { id: 'lr', label: '왼쪽 → 오른쪽' },
  { id: 'rl', label: '오른쪽 → 왼쪽' },
  { id: 'bt', label: '아래 → 위' },
  { id: 'tb', label: '위 → 아래' },
];
const FILL_IDS = new Set(FILLS.map((x) => x.id));
const MOTION_IDS = new Set(MOTIONS.map((x) => x.id));

/** 📐 ① 칸에서 옮기고 줄인 자리(캔버스 0..1 · 넘쳐도 된다) — 이상하면 null */
function normBox(b) {
  if (!b || typeof b !== 'object') return null;
  const r = (v) => Math.round(Number(v) * 10000) / 10000;
  const o = { x: r(b.x), y: r(b.y), w: r(b.w), h: r(b.h) };
  return [o.x, o.y, o.w, o.h].every((v) => isFinite(v)) && o.w > 0.02 && o.h > 0.02 && o.w < 10 && o.h < 10 && Math.abs(o.x) < 10 && Math.abs(o.y) < 10 ? o : null;
}
function normLook(l) {
  const o = l || {};
  const out = {
    fill: FILL_IDS.has(o.fill) ? o.fill : 'auto',
    flipH: !!o.flipH,
    flipV: !!o.flipV,
    motion: MOTION_IDS.has(o.motion) ? o.motion : 'auto',
  };
  const bx = normBox(o.box);
  if (bx) out.box = bx;
  return out;
}
function isDefault(l) {
  const n = normLook(l);
  return n.fill === 'auto' && !n.flipH && !n.flipV && n.motion === 'auto' && !n.box;
}
function describe(l) {
  const n = normLook(l);
  const f = FILLS.find((x) => x.id === n.fill).label;
  const m = MOTIONS.find((x) => x.id === n.motion).label;
  const fl = [n.flipH ? '좌우 반전' : '', n.flipV ? '상하 반전' : ''].filter(Boolean).join('·') || '반전 없음';
  return `채우기 ${f} · ${fl} · 움직임 ${m}` + (n.box ? ` · 자리 직접(${Math.round(n.box.w * 100)}% 크기)` : '');
}

/**
 * 🏷 AI 고지 — 편에 문장 범위(project.aiNoticeRange = {from, to}, 1부터)가 있으면 그 문장 동안만 보이게 한다.
 *   .vrew 타임라인 = 문장 음성을 빈틈 없이 이은 것이므로 시작 = 앞 문장들의 음성 길이 합, 길이 = 범위 문장들의 합.
 *   빌더의 기존 「시작 N초 · M초 동안」(startMode seconds) 형식으로 옮긴다 → .vrew·MP4 가 같은 코드를 탄다.
 *   범위가 없으면 받은 설정 그대로(채널 기본 = 5초 뒤 5초).
 */
function aiNoticeForRange(aiNotice, project, logger) {
  const r = project && project.aiNoticeRange;
  if (!aiNotice || !r || !(r.from >= 1)) return aiNotice;
  const sMap = new Map(((project && project.sentences) || []).map((s) => [s.id, s]));
  const order = [];
  for (const g of (project.groups || [])) for (const id of g.sentenceIds) { const s = sMap.get(id); if (s) order.push(s); }
  if (!order.length) return aiNotice;
  const a = Math.max(1, Math.min(order.length, Math.floor(r.from)));
  const b = Math.max(a, Math.min(order.length, Math.floor(r.to || a)));
  let start = 0, dur = 0, missing = 0;
  order.forEach((s, i) => {
    const d = Number(s.ttsDurationSec) || 0;
    if (!(d > 0) && i < b) missing++;
    if (i < a - 1) start += d; else if (i < b) dur += d;
  });
  if (missing && logger) logger(`⚠ AI 고지 범위 — 음성이 없는 문장 ${missing}개가 있어 시각이 실제와 다를 수 있습니다`);
  return { ...aiNotice, startMode: 'seconds', startSeconds: Math.round(start * 1000) / 1000, durationSeconds: Math.max(0.1, Math.round(dur * 1000) / 1000) };
}

module.exports = { FILLS, MOTIONS, normBox, normLook, isDefault, describe, aiNoticeForRange };
