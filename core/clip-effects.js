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

/**
 * 🎞 필터 — **CSS 와 ffmpeg 가 같은 뜻을 갖는 연산만**(밝기·대비·채도·색조·흑백·세피아 = CSS filter 함수 명세의 행렬/식).
 *   한 표(params)에서 CSS 문자열(미리보기)과 ffmpeg 식(굽기)을 **둘 다 만든다** → 식이 두 벌로 갈라지지 않는다.
 *   순서(CSS 와 같다): 흑백 → 세피아 → 채도 → 색조 → 밝기 → 대비. 밝기는 행렬에 곱해 넣고, 대비는 lutrgb(곱+더하기)로 한다.
 *   ⚠ ffmpeg 의 colorchannelmixer 는 8비트 sRGB 값에 곱하므로 CSS filter(sRGB)와 같다. 일치는 test/fx-filter.smoke.js 가 단색으로 잰다.
 */
const FILTER_DEF = { gray: 0, sepia: 0, sat: 1, hue: 0, bright: 1, contrast: 1 };
const FILTERS = [
  { id: 'bw', label: '흑백', params: { gray: 1 } },
  { id: 'sepia', label: '세피아', params: { sepia: 0.8 } },
  { id: 'warm', label: '따뜻하게', params: { sepia: 0.3, sat: 1.15 } },
  { id: 'cool', label: '차갑게', params: { hue: -18, sat: 1.05 } },
  { id: 'vivid', label: '선명하게', params: { contrast: 1.15, sat: 1.3 } },
  { id: 'dark', label: '어둡게', params: { bright: 0.75 } },
  { id: 'bright', label: '밝게', params: { bright: 1.25 } },
  { id: 'vintage', label: '빈티지', params: { sepia: 0.4, contrast: 0.9, sat: 0.85, bright: 1.05 } },
  { id: 'fade', label: '바랜 필름', params: { contrast: 0.8, sat: 0.7, bright: 1.1 } },
];
const FILTER_IDS = new Set(FILTERS.map((f) => f.id));
const normFilter = (v) => (FILTER_IDS.has(String(v)) ? String(v) : '');
const filterParams = (id) => { const f = FILTERS.find((x) => x.id === id); return f ? { ...FILTER_DEF, ...f.params } : null; };
const filterActive = (look) => !!(look && normFilter(look.filter));
/** 👁 CSS `filter` 값(미리보기 · 일치 시험의 캔버스) — 없으면 '' */
function cssFilter(idOrLook) {
  const id = normFilter(idOrLook && typeof idOrLook === 'object' ? idOrLook.filter : idOrLook);
  const p = filterParams(id); if (!p) return '';
  const parts = [];
  if (p.gray) parts.push(`grayscale(${p.gray})`);
  if (p.sepia) parts.push(`sepia(${p.sepia})`);
  if (p.sat !== 1) parts.push(`saturate(${p.sat})`);
  if (p.hue) parts.push(`hue-rotate(${p.hue}deg)`);
  if (p.bright !== 1) parts.push(`brightness(${p.bright})`);
  if (p.contrast !== 1) parts.push(`contrast(${p.contrast})`);
  return parts.join(' ');
}
// CSS filter 명세의 3×3 행렬(행 우선 9개) — 같은 식을 ffmpeg 쪽이 쓴다
const mGray = (a) => { const m = 1 - Math.max(0, Math.min(1, a)); return [0.2126 + 0.7874 * m, 0.7152 - 0.7152 * m, 0.0722 - 0.0722 * m, 0.2126 - 0.2126 * m, 0.7152 + 0.2848 * m, 0.0722 - 0.0722 * m, 0.2126 - 0.2126 * m, 0.7152 - 0.7152 * m, 0.0722 + 0.9278 * m]; };
const mSepia = (a) => { const m = 1 - Math.max(0, Math.min(1, a)); return [0.393 + 0.607 * m, 0.769 - 0.769 * m, 0.189 - 0.189 * m, 0.349 - 0.349 * m, 0.686 + 0.314 * m, 0.168 - 0.168 * m, 0.272 - 0.272 * m, 0.534 - 0.534 * m, 0.131 + 0.869 * m]; };
const mSat = (s) => [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
const mHue = (deg) => { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072]; };
/**
 * 필터 → 단계 목록 [{m:[9]}…] + contrast. **CSS 처럼 단계마다 0~255 로 자른다**(합성 행렬 하나로 곱하면 중간 클램프가 빠져 색이 어긋났다 —
 *   차갑게 × 순수 파랑에서 248 ↔ 238 · test/fx-filter.smoke.js 가 잡았다). 그래서 ffmpeg 도 단계마다 colorchannelmixer 한 번씩.
 */
function filterStages(id) {
  const p = filterParams(normFilter(id)); if (!p) return null;
  const stages = [];
  if (p.gray) stages.push(mGray(p.gray));
  if (p.sepia) stages.push(mSepia(p.sepia));
  if (p.sat !== 1) stages.push(mSat(p.sat));
  if (p.hue) stages.push(mHue(p.hue));
  if (p.bright !== 1) stages.push([p.bright, 0, 0, 0, p.bright, 0, 0, 0, p.bright]);
  return { stages, contrast: p.contrast };
}
/** 🔥 굽기(ffmpeg) `-vf` 식 — 단계마다 colorchannelmixer + 마지막에 lutrgb(대비). 없으면 '' */
function ffmpegFilter(id) {
  const fs_ = filterStages(id); if (!fs_) return '';
  const n = (v) => (Math.round(v * 1e5) / 1e5).toString();
  let s = 'format=rgba';
  for (const m of fs_.stages) {
    s += `,colorchannelmixer=rr=${n(m[0])}:rg=${n(m[1])}:rb=${n(m[2])}:gr=${n(m[3])}:gg=${n(m[4])}:gb=${n(m[5])}:br=${n(m[6])}:bg=${n(m[7])}:bb=${n(m[8])}`;
  }
  if (fs_.contrast !== 1) {
    const off = Math.round((0.5 - 0.5 * fs_.contrast) * 255 * 1e3) / 1e3;
    const e = `'clip(val*${n(fs_.contrast)}+${off},0,maxval)'`;
    s += `,lutrgb=r=${e}:g=${e}:b=${e}`;
  }
  return s;
}
/**
 * 🔉 볼륨 조절(문장 = 클립의 음성) — s.vol 0~2(선형 배율 · 1 = 기본 = 필드 없음 · 0 = 무음). 굽기: 문장 음성을 MP3 로 바꿀 때 volume= 을 얹는다.
 *   ⛔ TTS 「리미터·압축 금지」 — 1 초과는 **피크 여유(−1 dBFS 까지)만큼만** 키운다(넘으면 깎고 알린다 · 압축·리미터는 쓰지 않는다).
 */
const VOL = { min: 0, max: 2, step: 0.05, ceilDb: -1 };
/** 볼륨 → 0~2(소수 둘째 자리) · 기본(1)이거나 못 읽으면 null(= 필드 없음). 0(무음)은 유효하다 */
function normVol(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  const c = Math.round(Math.max(VOL.min, Math.min(VOL.max, n)) * 100) / 100;
  return Math.abs(c - 1) < 0.005 ? null : c;
}
/** 실제로 얹을 배율 — vol ≤ 1 은 그대로 · vol > 1 은 피크 여유 안에서만(peakDb = 원음 최대 음량 dB · 못 재면 키우지 않는다) */
function volGain(vol, peakDb) {
  const v = normVol(vol);
  if (v == null) return { gain: 1, capped: false };
  if (v <= 1) return { gain: v, capped: false };
  if (!isFinite(peakDb)) return { gain: 1, capped: true };
  const allowed = Math.pow(10, (VOL.ceilDb - peakDb) / 20);
  const gain = Math.min(v, Math.max(1, allowed));
  return { gain, capped: gain < v - 1e-6 };
}
const hasEffects = (look) => !!(look && (normZoom(look.zoom) || normRot(look.rot) || normBg(look.bg) || normFilter(look.filter)));

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
  const fl = FILTERS.find((x) => x.id === normFilter(look && look.filter));
  return (z ? ` · 확대 ${z}%` : '') + (r ? ` · 회전 ${r}°` : '') + (bg ? ` · 배경색 ${bg}` : '') + (fl ? ` · 필터 ${fl.label}` : '');
}

module.exports = { VOL, normVol, volGain, ZOOM, ROT, normZoom, normRot, normBg, bgActive, cssBg, FILTERS, normFilter, filterParams, filterActive, cssFilter, filterStages, ffmpegFilter, hasEffects, scaleBox, applyToTrack, cssTransform, describeFx };
