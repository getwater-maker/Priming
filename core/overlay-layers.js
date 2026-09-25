'use strict';
/**
 * overlay-layers.js — 🔝 위층 그림·영상(특정 그룹 ~ 특정 그룹 동안 모든 그림 위에 올리는 것) + 🏷 채널 로고 배치 (v0.5.52)
 *
 *   pr.overlays = [{ id, file, kind:'image'|'video'|'audio', startId, endId, sc?, ec?, box?, once? }]  — once = 소리를 1회만(반복 안 함 · v0.5.59)
 *   · sc·ec = 클립(자막 줄) 단위 범위(v0.5.65) — 첫 문장 안 글자 sc 가 든 줄부터 · 끝 문장 안 글자 ec 가 든 줄까지(visual-span.clipIn). 없으면 문장 통째.
 *   · 범위는 **문장 id** 로 잡는다(그룹 번호는 나누기·합치기로 바뀐다) — 사람은 그룹으로 고르지만 저장은 그 그룹의 첫·끝 문장.
 *   · 작업본에는 순번으로(문장 id 는 다시 열면 새로 매겨진다) — visual-span 과 같은 방식.
 *   · 쌓는 순서 = 목록 순서(뒤에 넣은 것이 위) — 그룹 그림보다 늘 위(vrew-builder zIndex 900+).
 *   · box 없음 = 화면 가득(비율이 다르면 가운데 맞추기).
 *   ⚠ 렌더러가 import 하지 않는다(렌더러는 DTO 의 from/to 만 쓴다).
 */
const VS = require('./visual-span');

const IMG_EXT = /\.(png|jpe?g|webp)$/i, VID_EXT = /\.(mp4|mov|webm|m4v)$/i, AUD_EXT = /\.(mp3|wav|m4a|aac|flac|ogg)$/i;
function kindOf(file) { return VID_EXT.test(file || '') ? 'video' : (IMG_EXT.test(file || '') ? 'image' : (AUD_EXT.test(file || '') ? 'audio' : null)); }
/** 🎵 오디오 삽입 음량(%) — 기본 30 */
function normVol(v) { const n = Number(v); return (v != null && v !== '' && isFinite(n)) ? Math.max(0, Math.min(200, Math.round(n))) : 30; }
/** 🎬 삽입 영상의 소리 음량(%) — 기본 100(영상 소리 그대로 · 0 = 소리 끔) */
function volOfVideo(v) { const n = Number(v); return (v != null && v !== '' && isFinite(n)) ? Math.max(0, Math.min(200, Math.round(n))) : 100; }
/** 편 전체 문장 번호(1부터) 범위 → 문장 id */
/** 클립 단위 글자 위치 정리 — sc 는 0 보다 클 때만, ec 는 0 이상 숫자일 때만(없음 = 끝 문장 끝까지) */
function clipChars(sc, ec) {
  const o = {};
  const a = Math.floor(Number(sc)), b = Math.floor(Number(ec));
  if (sc != null && sc !== '' && isFinite(a) && a > 0) o.sc = a;
  if (ec != null && ec !== '' && isFinite(b) && b >= 0) o.ec = b;
  return o;
}
function idsFromOrds(pr, from, to, sc, ec) {
  const c = VS.orderOf(pr); const n = c.order.length; if (!n) return null;
  let a = Math.floor(Number(from)), b = Math.floor(Number(to));
  if (!isFinite(a)) a = 1;
  if (!isFinite(b)) b = n;
  a = Math.max(1, Math.min(n, a)); b = Math.max(1, Math.min(n, b));
  if (a > b) { const t = a; a = b; b = t; sc = null; ec = null; }
  const cc = clipChars(sc, ec);
  if (a === b && cc.sc != null && cc.ec != null && cc.ec < cc.sc) { const t = cc.sc; cc.sc = cc.ec; cc.ec = t; if (!cc.sc) delete cc.sc; }
  return { startId: c.order[a - 1], endId: c.order[b - 1], sc: cc.sc, ec: cc.ec };
}

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
/** 이 자막 줄(문장 순번 k · 글자 lf~lt)을 오버레이가 덮는가 — r = rangeOf 결과 */
function coversLine(ov, r, k, lf, lt) { return !!r && VS.clipIn(r.a, ov.sc, r.b, ov.ec, k, lf, lt); }
/** 범위를 바꿀 때 — startId·endId·sc·ec 를 한꺼번에(없는 글자 위치는 지운다) */
function applyIds(ov, ids) {
  ov.startId = ids.startId; ov.endId = ids.endId;
  if (ids.sc != null) ov.sc = ids.sc; else delete ov.sc;
  if (ids.ec != null) ov.ec = ids.ec; else delete ov.ec;
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
    return { id: ov.id, file: ov.file, name: ov.name || null, kind: ov.kind, box: ov.box || null, volume: ov.kind === 'audio' ? normVol(ov.volume) : (ov.kind === 'video' ? volOfVideo(ov.volume) : null), total: c.order.length,
      fromGroup: r ? groupNumOf(pr, c.order[r.a]) : null, toGroup: r ? groupNumOf(pr, c.order[r.b]) : null,
      from: r ? r.a + 1 : null, to: r ? r.b + 1 : null, sc: ov.sc > 0 ? ov.sc : 0, ec: ov.ec != null ? ov.ec : null, broken: !r, once: !!ov.once };
  });
}
/** 작업본 저장·복원 — 순번으로 */
function toSnap(pr) {
  const c = VS.orderOf(pr);
  return (pr.overlays || []).map((ov) => { const r = rangeOf(pr, ov, c); return r ? { id: ov.id, file: ov.file, name: ov.name || null, kind: ov.kind, box: ov.box || null, volume: ov.kind === 'audio' ? normVol(ov.volume) : (ov.kind === 'video' ? volOfVideo(ov.volume) : undefined), ...(ov.once ? { once: true } : {}), ...clipChars(ov.sc, ov.ec), from: r.a, to: r.b } : null; }).filter(Boolean);
}
function fromSnap(pr, list) {
  if (!Array.isArray(list) || !list.length) return;
  const c = VS.orderOf(pr); const n = c.order.length; if (!n) return;
  const out = [];
  for (const o of list) {
    if (!o || !o.file) continue;
    const a = Math.max(0, Math.min(n - 1, o.from | 0)), b = Math.max(a, Math.min(n - 1, o.to | 0));
    out.push({ id: o.id || ('ov' + Math.random().toString(36).slice(2, 8)), file: o.file, name: o.name || null, ...(o.kind === 'audio' ? { volume: normVol(o.volume) } : (o.kind === 'video' ? { volume: volOfVideo(o.volume) } : {})), kind: o.kind || kindOf(o.file) || 'image', box: normBox(o.box), ...(o.once ? { once: true } : {}), ...clipChars(o.sc, o.ec), startId: c.order[a], endId: c.order[b] });
  }
  if (out.length) pr.overlays = out;
}
/** 문장 id 가 바뀌면(문장 고치기·합치기) 범위 끝을 따라 옮긴다 */
function remapIds(pr, map) {
  for (const ov of (pr.overlays || [])) {
    // 문장이 바뀌면 그 안 글자 위치는 믿을 수 없다 → 그 끝은 문장 통째로(클립 단위를 푼다)
    if (map.has(ov.startId)) { if (map.get(ov.startId) !== ov.startId) delete ov.sc; ov.startId = map.get(ov.startId); }
    if (map.has(ov.endId)) { if (map.get(ov.endId) !== ov.endId) delete ov.ec; ov.endId = map.get(ov.endId); }
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
  return { enabled: true, path: p.logoPath, side: 'right', size: pct / 100 };   // 자리는 대본마다(pipeline 이 project.logoSide 로 바꾼다)
}

module.exports = { clipChars, coversLine, applyIds, volOfVideo, normVol, idsFromOrds, AUD_EXT, kindOf, rangeOf, bySentence, idsFromGroups, groupNumOf, toDTO, toSnap, fromSnap, remapIds, normBox, logoBox, logoOptsOf, IMG_EXT, VID_EXT };
