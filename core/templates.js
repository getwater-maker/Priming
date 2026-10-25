'use strict';
/**
 * templates.js — 📋 효과 템플릿(Lab · 남은 기능 ⑨ · Vrew 「템플릿」의 Priming 꼴)
 *   Vrew 의 \`.vrt\`(프레임·글 틀)는 Vrew 만의 형식이라 만들지 않고, **Priming 이 가진 효과 묶음**을 이름 붙여 저장해 두었다가 다른 클립에 한 번에 입힌다:
 *     · 그림 그룹 효과(look): 채우기·반전·움직임·확대·회전·배경색·필터·불투명도·자르기·화면 전환
 *     · 문장 소리 효과: 볼륨·노이즈 줄이기
 *   ⛔ 자리(box)·순서(layer)·켄번스 구간·오버레이 모션은 **대본마다 다른 값**이라 담지 않는다(입혀도 건드리지 않는다).
 *   순수 — 저장은 main(\`~/.priming-maker/templates.json\`).
 */
const VL = require('./visual-look');
const CE = require('./clip-effects');

const LOOK_KEYS = ['fill', 'flipH', 'flipV', 'motion', 'zoom', 'rot', 'bg', 'filter', 'opacity', 'crop', 'trans'];   // 템플릿이 담는 그림 효과
const KEEP_KEYS = ['box', 'layer', 'kbSeg', 'fx'];                                                                 // 입혀도 그대로 두는 것

/** 템플릿으로 저장할 그림 효과만 추려 정규화(기본값은 필드 없음) */
function pickLook(look) {
  const n = VL.normLook(look || {}); const o = {};
  for (const k of LOOK_KEYS) if (n[k] != null && n[k] !== false) o[k] = n[k];
  if (o.fill === 'auto') delete o.fill;
  if (o.motion === 'auto') delete o.motion;
  return o;
}
/** 템플릿을 그룹 look 에 입힌다 — 효과 필드는 템플릿 것으로 **바꾸고**(템플릿에 없는 효과는 끈다) · 자리·순서·켄번스 구간은 그대로. 결과가 기본이면 undefined */
function applyLook(oldLook, tplLook) {
  const old = VL.normLook(oldLook || {}); const keep = {};
  for (const k of KEEP_KEYS) if (old[k] != null) keep[k] = old[k];
  const next = VL.normLook({ ...keep, ...pickLook(tplLook) });
  return VL.isDefault(next) ? undefined : next;
}
/** 템플릿 한 건 만들기 — { name, look, vol?, denoise? } (이름은 앞뒤 공백 제거 · 40자) */
function make(name, look, sent) {
  const nm = String(name || '').trim().slice(0, 40);
  if (!nm) return null;
  const t = { name: nm, look: pickLook(look) };
  const v = CE.normVol(sent && sent.vol); if (v != null) t.vol = v;
  const d = CE.normDenoise(sent && sent.denoise); if (d) t.denoise = d;
  return t;
}
const isEmpty = (t) => !t || (!Object.keys(t.look || {}).length && t.vol == null && !t.denoise);
/** 화면에 보일 한 줄 설명 */
function describe(t) {
  const L = t.look || {};
  const p = [];
  if (L.zoom) p.push(`확대 ${L.zoom}%`); if (L.rot) p.push(`회전 ${L.rot}°`); if (L.bg) p.push('배경색'); if (L.filter) p.push('필터'); if (L.opacity != null) p.push(`불투명 ${L.opacity}%`);
  if (L.crop) p.push('자르기'); if (L.trans) p.push('전환'); if (L.flipH || L.flipV) p.push('반전'); if (L.fill === 'cover') p.push('꽉 채움'); if (L.motion && L.motion !== 'auto') p.push('움직임');
  if (t.vol != null) p.push(`볼륨 ${Math.round(t.vol * 100)}%`); if (t.denoise) p.push(`노이즈 ${CE.DENOISE[t.denoise].label}`);
  return p.join(' · ') || '(효과 없음)';
}

module.exports = { LOOK_KEYS, KEEP_KEYS, pickLook, applyLook, make, isEmpty, describe };
