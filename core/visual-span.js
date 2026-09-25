'use strict';
/**
 * visual-span.js — 🖼 그림을 **다음 그룹들 아래로 이어 깔기**(레이어 · 2026-09-25 로이: "범위를 늘리면 앞 그룹은 하위층,
 *   다음 그룹은 그 위층으로 — 그러면 비디오·이미지를 지우지 않고 만들 수 있다", 샘플.vrew = Vrew 의 한 자산이 여러 클립에 걸리고 zIndex 로 쌓임).
 *
 *   g.visSpan = { startId, endId } — 그림이 자기 그룹 문장 **밖으로** 이어지는 끝(문장 id). 없는 쪽 = 자기 그룹 경계.
 *   · 쌓는 순서 = 그룹 순서(앞 그룹이 아래 · 뒤 그룹이 위) — vrew-builder 의 zIndex = 그룹 순번과 같다.
 *   · 그림이 없는 그룹이 누군가의 이어진 그림 아래에 있으면 = 그 그림이 보인다 → 따로 그림을 만들지 않는다(covered).
 *   · 그룹·문장·챕터는 건드리지 않는다(예전 v0.5.45 는 덮인 그룹을 합치거나 지웠다).
 *   ⚠ 렌더러 번들에 들어갈 수 있다 — CJS 런타임 참조 금지.
 */

/**
 * ➕ 클립(자막 줄) 단위 범위(v0.5.65) — 문장 순번 a~b + 첫 문장 안 글자 sc(그 글자가 든 줄부터) + 끝 문장 안 글자 ec(그 글자가 든 줄까지).
 *   sc 가 없거나 0 이면 첫 문장 처음부터 · ec 가 없으면 끝 문장 끝까지. 글자 위치로 저장하므로 자막 글자수를 바꿔 줄이 다시 나뉘어도 그 글자를 따라간다.
 *   k = 이 줄의 문장 순번(a·b 와 같은 기준) · lf~lt = 이 줄의 문장 안 글자 범위.
 */
function clipIn(a, sc, b, ec, k, lf, lt) {
  if (k < a || k > b) return false;
  if (k === a && sc > 0 && lt <= sc) return false;
  if (k === b && ec != null && ec >= 0 && lf > ec) return false;
  return true;
}
function orderOf(project) {
  const order = [], pos = new Map(), owner = new Map();
  (project.groups || []).forEach((g, gi) => {
    for (const id of g.sentenceIds || []) { pos.set(id, order.length); owner.set(id, gi); order.push(id); }
  });
  return { order, pos, owner };
}
/** 그룹 gi 그림의 실제 범위(편 문장 순번 0부터, 끝 포함) */
function effRange(project, gi, ctx) {
  const c = ctx || orderOf(project);
  const g = project.groups[gi];
  const ids = (g && g.sentenceIds) || [];
  if (!ids.length) return null;
  let a = c.pos.get(ids[0]), b = c.pos.get(ids[ids.length - 1]);
  const sp = g.visSpan || {};
  if (sp.startId && c.pos.has(sp.startId)) a = Math.min(a, c.pos.get(sp.startId));
  if (sp.endId && c.pos.has(sp.endId)) b = Math.max(b, c.pos.get(sp.endId));
  return { a, b };
}
/**
 * 🖼 쌓는 순서(v0.5.62 · 로이) — **범위를 늘려 다른 그룹 문장 위로 끌어온 그림이 그 그룹 그림을 덮는다**.
 *   (예: G9 그림을 G10 의 클립 79 까지 끌면 77~79 에서는 G9 가 위). 🔴 v0.5.47 의 「앞 그룹 = 아래층」을 뒤집었다 —
 *   그 규칙에선 그림이 있는 그룹 위로 늘려도 화면이 바뀌지 않았다.
 *   규칙: A 의 범위가 B 의 자기 문장에 걸치면 A 가 B 보다 위. 그 밖엔 그룹 순서. 서로 걸치면(순환) 그룹 순서로 끊는다.
 * @param ranges [{own:{a,b}, eff:{a,b}} | null] — 그룹 순서대로(그림 없는 그룹은 null)
 * @returns rank[] — 그룹 순번 → 쌓는 순위(클수록 위)
 */
function stackRanks(ranges) {
  const n = ranges.length;
  const below = ranges.map((A, i) => {
    const s = [];
    if (!A) return s;
    ranges.forEach((B, j) => { if (j !== i && B && A.eff.a <= B.own.b && A.eff.b >= B.own.a) s.push(j); });
    return s;
  });
  const rank = new Array(n).fill(-1); let r = 0;
  while (r < n) {
    let pick = -1;
    for (let i = 0; i < n && pick < 0; i++) if (rank[i] < 0 && below[i].every((j) => rank[j] >= 0)) pick = i;
    if (pick < 0) for (let i = 0; i < n && pick < 0; i++) if (rank[i] < 0) pick = i;   // 순환 — 그룹 순서로
    rank[pick] = r++;
  }
  return rank;
}
function groupRanks(project, hasVisual, ctx) {
  const c = ctx || orderOf(project);
  const ranges = (project.groups || []).map((g, gi) => {
    if (!hasVisual(g)) return null;
    const ids = g.sentenceIds || []; if (!ids.length) return null;
    const own = { a: c.pos.get(ids[0]), b: c.pos.get(ids[ids.length - 1]) };
    return { own, eff: effRange(project, gi, c) || own };
  });
  return stackRanks(ranges);
}
/**
 * 문장마다 그 문장을 덮는 그림 그룹(아래 → 위 순서 — stackRanks).
 * @param hasVisual (g) => boolean — 그림·영상이 실제로 있는지(파일 확인은 부르는 쪽이)
 * @returns Map(sentenceId → [groupIndex...])
 */
function layersBySentence(project, hasVisual) {
  const c = orderOf(project);
  const m = new Map(c.order.map((id) => [id, []]));
  (project.groups || []).forEach((g, gi) => {
    if (!hasVisual(g)) return;
    const r = effRange(project, gi, c); if (!r) return;
    for (let k = r.a; k <= r.b; k++) m.get(c.order[k]).push(gi);
  });
  const rk = groupRanks(project, hasVisual, c);
  for (const v of m.values()) v.sort((x, y) => rk[x] - rk[y]);
  return m;
}
/** 그림이 없는데 모든 문장이 다른 그룹의 이어진 그림 아래에 있는 그룹 → g._covered = 그 그룹 번호(표시·생성 제외용). 반환 = 덮인 그룹 수 */
function markCovered(project, hasVisual) {
  const L = layersBySentence(project, hasVisual);
  let n = 0;
  (project.groups || []).forEach((g, gi) => {
    g._covered = 0;
    if (hasVisual(g) || !(g.sentenceIds || []).length) return;
    const under = g.sentenceIds.map((id) => (L.get(id) || []).filter((x) => x !== gi));
    if (under.every((u) => u.length)) { g._covered = project.groups[under[0][under[0].length - 1]].num; n++; }
  });
  return n;
}
/** 문장 id 가 바뀌면(문장 고치기·합치기) 그림 범위 끝을 따라 옮긴다. map = Map(옛 id → 새 id) */
function remapSpanIds(project, map) {
  for (const g of (project.groups || [])) {
    const sp = g.visSpan; if (!sp) continue;
    if (sp.startId && map.has(sp.startId)) sp.startId = map.get(sp.startId);
    if (sp.endId && map.has(sp.endId)) sp.endId = map.get(sp.endId);
  }
}
/** 작업본 저장 — 문장 id 는 다시 열면 새로 매겨지므로 **순번**으로 적는다 */
function spanToOrd(project, g) {
  const sp = g && g.visSpan; if (!sp) return null;
  const c = orderOf(project);
  const o = { from: sp.startId && c.pos.has(sp.startId) ? c.pos.get(sp.startId) : null, to: sp.endId && c.pos.has(sp.endId) ? c.pos.get(sp.endId) : null };
  return (o.from == null && o.to == null) ? null : o;
}
function spanFromOrd(project, g, o) {
  if (!o) return;
  const c = orderOf(project);
  const s = { startId: o.from != null ? c.order[o.from] || null : null, endId: o.to != null ? c.order[o.to] || null : null };
  if (s.startId || s.endId) g.visSpan = s;
}

module.exports = { clipIn, orderOf, effRange, stackRanks, groupRanks, layersBySentence, markCovered, remapSpanIds, spanToOrd, spanFromOrd };
