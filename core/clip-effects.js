'use strict';
/**
 * clip-effects.js — 🎛 클립 효과 규칙 한 곳(Lab · docs/VrewLab/효과_규칙_설계.md).
 *   1단계 = **확대 및 회전**: 그룹 look 의 zoom(%)·rot(°) → .vrew 트랙 박스(xPos·yPos·width·height)·rotation.
 *   빌더(.vrew)·렌더러(MP4)·미리보기(CSS)가 같은 값을 읽도록 **식은 여기에만** 둔다(켄번스·자막 위치 때처럼 여러 벌이 되지 않게).
 *   ⛔ 화면·렌더러·빌더에 확대·회전 규칙(범위·중심·켄번스 처리)을 따로 쓰지 말 것 · 다음 단계(배경색·필터·볼륨·전환)도 여기에 더한다.
 *   ⚠ 렌더러 번들에도 들어간다 — CJS 런타임 참조(require.main 류) 금지.
 */

const ZOOM = { min: 100, max: 300, step: 5 };   // % — 100 = 기본(필드 없음)
const ROT = { min: -180, max: 180, step: 5 };   // ° — 시계 방향이 +, 0 = 기본(필드 없음)

/** 확대 % — 기본(100)이거나 못 읽으면 0(= 필드를 두지 않는다) */
function normZoom(v) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return 0;
  const c = Math.max(ZOOM.min, Math.min(ZOOM.max, n));
  return c > ZOOM.min ? c : 0;
}
/** 회전 ° — 기본(0)이거나 못 읽으면 0 */
function normRot(v) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return 0;
  return Math.max(ROT.min, Math.min(ROT.max, n));
}
/** 🎨 클립 배경색 — '#rrggbb'(소문자) · 못 읽으면 ''(= 기본 · 필드 없음) */
function normBg(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (!m) return '';
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return '#' + h;
}
/** 배경색이 **실제로 쓰이는가** — 사람이 그림을 직접 옮기고 줄인 자리(look.box)가 있으면 쓰지 않는다(그 자리 밖은 캔버스 검정 그대로 · 설계 §3-3) */
function bgActive(look) { return !!(look && normBg(look.bg) && !look.box); }
/** 👁 미리보기 — 그림 요소(img)에 칠하는 배경색(빈 곳도 그림 요소 안이라 켄번스와 함께 움직인다 = 굽기 사본과 같다). 없으면 '' */
function cssBg(look) { return bgActive(look) ? normBg(look.bg) : ''; }
const hasEffects = (look) => !!(look && (normZoom(look.zoom) || normRot(look.rot) || normBg(look.bg)));

/**
 * 박스(캔버스 0..1)를 **자기 가운데** 기준으로 키운다 — 비율 유지. 사람이 옮긴 박스(look.box)면 그 박스 가운데.
 * @returns {{x,y,w,h}}
 */
function scaleBox(box, zoomPct) {
  const z = normZoom(zoomPct);
  const b = { x: +box.x, y: +box.y, w: +box.w, h: +box.h };
  if (!z) return b;
  const k = z / 100, cx = b.x + b.w / 2, cy = b.y + b.h / 2, w = b.w * k, h = b.h * k;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * 🎬 .vrew 트랙에 확대·회전을 적는다(빌더 전용 · 박스를 이미 정한 뒤에 부른다).
 *   · 확대 = 트랙 박스를 가운데 기준으로 키운다 → 렌더러는 **박스가 정본**이라 따로 알 필요가 없다.
 *   · 회전 = track.rotation(Vrew 가 아는 필드). 회전하면 켄번스는 끈다(렌더러가 회전한 그림 위에서 켄번스를 돌리지 않는다 · 미리보기도 같다).
 * @returns {{zoom:number, rot:number}} 실제로 적용한 값
 */
function applyToTrack(track, look) {
  const out = { zoom: 0, rot: 0 };
  if (!track || !look) return out;
  const z = normZoom(look.zoom), r = normRot(look.rot);
  if (z) {
    const b = scaleBox({ x: track.xPos || 0, y: track.yPos || 0, w: typeof track.width === 'number' ? track.width : 1, h: typeof track.height === 'number' ? track.height : 1 }, z);
    track.xPos = b.x; track.yPos = b.y; track.width = b.w; track.height = b.h;
    out.zoom = z;
  }
  if (r) { track.rotation = r; delete track.kenburnsAnimationInfo; out.rot = r; }
  return out;
}

/** 👁 ① 미리보기 — 그림 칸(.vlayer, 박스 자리)에 얹는 CSS transform. 회전·확대 모두 자기 가운데 기준(transform-origin:center). 없으면 ''. */
function cssTransform(look) {
  const z = normZoom(look && look.zoom), r = normRot(look && look.rot);
  const parts = [];
  if (r) parts.push(`rotate(${r}deg)`);
  if (z) parts.push(`scale(${(z / 100).toFixed(4)})`);
  return parts.join(' ');
}

/** 설명 글(그림 모양 로그·툴팁) */
function describeFx(look) {
  const z = normZoom(look && look.zoom), r = normRot(look && look.rot);
  const bg = normBg(look && look.bg);
  return (z ? ` · 확대 ${z}%` : '') + (r ? ` · 회전 ${r}°` : '') + (bg ? ` · 배경색 ${bg}` : '');
}

module.exports = { ZOOM, ROT, normZoom, normRot, normBg, bgActive, cssBg, hasEffects, scaleBox, applyToTrack, cssTransform, describeFx };
