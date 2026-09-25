'use strict';
/**
 * overlay-layers.js — 🔝 위층 그림·영상(특정 그룹 ~ 특정 그룹 동안 모든 그림 위에 올리는 것) + 🏷 채널 로고 배치 (v0.5.52)
 *
 *   pr.overlays = [{ id, file, kind:'image'|'video', startId, endId, box? }]
 *   · 범위는 **문장 id** 로 잡는다(그룹 번호는 나누기·합치기로 바뀐다) — 사람은 그룹으로 고르지만 저장은 그 그룹의 첫·끝 문장.
 *   · 작업본에는 순번으로(문장 id 는 다시 열면 새로 매겨진다) — visual-span 과 같은 방식.
 *   · 쌓는 순서 = 목록 순서(뒤에 넣은 것이 위) — 그룹 그림보다 늘 위(vrew-builder zIndex 900+).
 *   · box 없음 = 화면 가득(비율이 다르면 가운데 맞추기).
 *   ⚠ 렌더러가 import 하지 않는다(렌더러는 DTO 의 from/to 만 쓴다).
 */
const VS = require('./visual-span');

const IMG_EXT = /\.(png|jpe?g|webp)$/i, VID_EXT = /\.(mp4|mov|webm|m4v)$/i;
function kindOf(file) { return VID_EXT.test(file || '') ? 'video' : (IMG_EXT.test(file || '') ? 'image' : null); }

/** 오버레이가 덮는 문장 순번 범위(0부터, 끝 포함). 끝 문장이 사라졌으면 null */
function rangeOf(pr, ov, ctx) {
  const c = ctx || VS.orderOf(pr);
  if (!ov || !c.pos.has(ov.startId) || !c.pos.has(ov.endId)) return null;
  const a = c.pos.get(ov.startId), b = c.pos.get(ov.endId);
  return { a: Math.min(a, b), b: Math.max(a, b) };
}
/** Map(sentenceId → [overlay index...]) — 아래 → 위 */
function bySentence(pr) {
  const c = VS.orderOf(pr);
  const m = new Map();
  (pr.overlays || []).forEach((ov, i) => {
    const r = rangeOf(pr, ov, c); if (!r) return;
    for (let k = r.a; k <= r.b; k++) { const id = c.order[k]; if (!m.has(id)) m.set(id, []); m.get(id).push(i); }
  });
  return m;
}
/** 그룹 번호 범위 → 문장 id(첫 그룹의 첫 문장 · 끝 그룹의 끝 문장) */
function idsFromGroups(pr, fromNum, toNum) {
  const a = Math.min(fromNum, toNum), b = Math.max(fromNum, toNum);
  const gs = pr.groups.filter((g) => g.num >= a && g.num <= b && (g.sentenceIds || []).length);
  if (!gs.length) return null;
  return { startId: gs[0].sentenceIds[0], endId: gs[gs.length - 1].sentenceIds[gs[gs.length - 1].sentenceIds.length - 1] };
}
/** 문장 id → 그 문장이 든 그룹 번호 */
function groupNumOf(pr, sid) { const g = pr.groups.find((x) => (x.sentenceIds || []).includes(sid)); return g ? g.num : null; }
/** DTO — 화면용(그룹 번호 · 편 문장 번호 1부터) */
function toDTO(pr) {
  const c = VS.orderOf(pr);
  return (pr.overlays || []).map((ov) => {
    const r = rangeOf(pr, ov, c);
    return { id: ov.id, file: ov.file, name: ov.name || null, kind: ov.kind, box: ov.box || null,
      fromGroup: r ? groupNumOf(pr, c.order[r.a]) : null, toGroup: r ? groupNumOf(pr, c.order[r.b]) : null,
      from: r ? r.a + 1 : null, to: r ? r.b + 1 : null, broken: !r };
  });
}
/** 작업본 저장·복원 — 순번으로 */
function toSnap(pr) {
  const c = VS.orderOf(pr);
  return (pr.overlays || []).map((ov) => { const r = rangeOf(pr, ov, c); return r ? { id: ov.id, file: ov.file, name: ov.name || null, kind: ov.kind, box: ov.box || null, from: r.a, to: r.b } : null; }).filter(Boolean);
}
function fromSnap(pr, list) {
  if (!Array.isArray(list) || !list.length) return;
  const c = VS.orderOf(pr); const n = c.order.length; if (!n) return;
  const out = [];
  for (const o of list) {
    if (!o || !o.file) continue;
    const a = Math.max(0, Math.min(n - 1, o.from | 0)), b = Math.max(a, Math.min(n - 1, o.to | 0));
    out.push({ id: o.id || ('ov' + Math.random().toString(36).slice(2, 8)), file: o.file, name: o.name || null, kind: o.kind || kindOf(o.file) || 'image', box: normBox(o.box), startId: c.order[a], endId: c.order[b] });
  }
  if (out.length) pr.overlays = out;
}
/** 문장 id 가 바뀌면(문장 고치기·합치기) 범위 끝을 따라 옮긴다 */
function remapIds(pr, map) {
  for (const ov of (pr.overlays || [])) {
    if (map.has(ov.startId)) ov.startId = map.get(ov.startId);
    if (map.has(ov.endId)) ov.endId = map.get(ov.endId);
  }
}
function normBox(b) {
  if (!b) return null;
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : NaN);
  const o = { x: n(b.x), y: n(b.y), w: n(b.w), h: n(b.h) };
  return (o.w > 0.02 && o.h > 0.02 && o.w < 10 && o.h < 10 && Math.abs(o.x) < 10 && Math.abs(o.y) < 10) ? o : null;
}

/**
 * 🏷 채널 로고 자리(캔버스 0..1) — 위쪽 왼쪽/오른쪽. size = 캔버스 너비 대비 로고 너비(0.04~0.4) · 가장자리 여백 = 너비의 2.5%
 *   세로 여백은 화면 비율을 보정해 가로 여백과 같은 **픽셀**이 되게 한다.
 */
function logoBox({ side = 'right', size = 0.12, imgRatio = 1, canvasW = 1920, canvasH = 1080 } = {}) {
  const w = Math.max(0.04, Math.min(0.4, +size || 0.12));
  const r = imgRatio > 0 ? imgRatio : 1;
  const h = (w * canvasW) / r / canvasH;
  const mx = 0.025, my = (mx * canvasW) / canvasH;
  return { x: side === 'left' ? mx : 1 - w - mx, y: my, w, h };
}
/** 채널 설정 → 빌더 옵션(파일이 없으면 끔) */
function logoOptsOf(preset, exists) {
  const p = preset || {};
  if (!p.logoOn || !p.logoPath) return { enabled: false };
  if (exists && !exists(p.logoPath)) return { enabled: false, missing: p.logoPath };
  const pct = Math.max(4, Math.min(40, isFinite(+p.logoSize) ? +p.logoSize : 12));
  return { enabled: true, path: p.logoPath, side: p.logoSide === 'left' ? 'left' : 'right', size: pct / 100 };
}

module.exports = { kindOf, rangeOf, bySentence, idsFromGroups, groupNumOf, toDTO, toSnap, fromSnap, remapIds, normBox, logoBox, logoOptsOf, IMG_EXT, VID_EXT };
