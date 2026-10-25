'use strict';
/**
 * skin-region.js — 살색(얼굴·손) 덩어리 판정(v0.9.102 · core/info-theme 에서 옮김 — 정보 카드 자리 고르기와 🖼 썸네일 편집기가 같은 식을 쓴다)
 * f = 64x36 격자(30px 칸)의 rgb24 버퍼 · 좌표는 1920x1080 기준 화소(info-theme)·1280x720 기준은 호출하는 쪽이 환산한다.
 * 순수 함수 — Electron·child_process 에 의존하지 않는다(렌더러 번들에 들어간다).
 */
const GW = 64, GH = 36;
function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx === 0 ? 0 : d / mx, mx];
}
/** 살색(얼굴·손) 화소인가 — 색조 5~30° · 채도 0.34~0.7 · 밝기 85~205. 🔴 색만으로는 얼굴을 못 가린다(베이지 벽·흙·지붕도 비슷하다) — 그래서 채도를 높게 잡고 아래에서 덩어리로 본다 */
function isSkin(r, g, b) {
  const [h, sat] = rgb2hsv(r, g, b), y = 0.299 * r + 0.587 * g + 0.114 * b;
  return h >= 5 && h <= 30 && sat >= 0.34 && sat <= 0.7 && y >= 85 && y <= 205;
}
/** 구역 안 「살색 덩어리」 칸 수 — 살색 칸 중 가로·세로로 이웃한 살색 칸이 모두 있는 칸(문틀 같은 세로선·흩어진 점은 뺀다) */
function regionSkin(f, x0, y0, w, h) {
  const gx0 = Math.max(0, Math.floor(x0 / 30)), gy0 = Math.max(0, Math.floor(y0 / 30)), gx1 = Math.min(GW - 1, Math.ceil((x0 + w) / 30)), gy1 = Math.min(GH - 1, Math.ceil((y0 + h) / 30));
  const sk = (x, y) => { if (x < 0 || y < 0 || x >= GW || y >= GH) return false; const i = (y * GW + x) * 3; return isSkin(f[i], f[i + 1], f[i + 2]); };
  let n = 0, blob = 0;
  for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) { n++; if (sk(x, y) && (sk(x - 1, y) || sk(x + 1, y)) && (sk(x, y - 1) || sk(x, y + 1))) blob++; }
  return { cells: blob, frac: n ? blob / n : 0 };
}
const FACE_VETO = (r) => r.cells >= 4;   // 판이 덮는 곳에 살색 덩어리 칸이 4개 이상이면 그 자리는 점수 비교 전에 탈락(썸네일 규약 「얼굴 가림」)

module.exports = { GW, GH, rgb2hsv, isSkin, regionSkin, FACE_VETO };
