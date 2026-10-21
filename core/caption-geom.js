// 📐 자막 자리·크기 한 곳(Lab · 차이표 #12) — Vrew 자막 상자(.vrew caption style) → 1920×1080 화면 픽셀.
//   🎬 MP4(core/vrew-render captionAssStyle — ASS 여백·정렬)와 ① 미리보기(renderer/src/Workspace stageCapGeom — CSS)가 같은 수치를 쓴다.
//   실측 근거(vrew-render 머리 주석): 글자 = Vrew size × 0.72 · 상자 안쪽 가로 여백 24.6px · 아래 자막 yOffset −0.125 에서 MarginV 173
//   (yOffset 1 = 화면 높이의 절반 540px → yOffset 0 의 아래 여백 105.5).
//   ⚠ 렌더러 번들에 들어간다 — require 없이 순수 계산만. 반올림은 쓰는 쪽(MP4 = 정수 픽셀 · 미리보기 = 소수 그대로)이 한다.
const SIZE_K = 0.72;            // Vrew 글자 크기 → 1080p 픽셀
const BOX_PAD_X = 24.6;         // 자막 상자 안쪽 가로 여백
const CAP_BOTTOM_BASE = 105.5;  // yOffset 0 일 때 아래(위) 여백
const DEFAULT_WIDTH = 0.96;     // 빌더가 쓰는 자막 상자 폭(화면 폭 비율)
const W = 1920, H = 1080, HALF_H = H / 2;

/**
 * @param b { hAlign:'start'|'center'|'end', yAlign:'top'|'middle'|'bottom', yOffset, xOffset, width }
 * @param sizeAttr Vrew 글자 크기(없으면 100)
 * @returns { sizePx, marginL, marginR, marginV, offsetY, hAlign, yAlign } — 1920×1080 기준 · 반올림 안 함
 *   bottom/top: marginV = 그 가장자리에서 글자 줄까지 · middle: marginV 0 · offsetY = 가운데 기준 아래로(+)
 */
function boxPx(b, sizeAttr) {
  const o = b || {};
  const hAlign = ['start', 'center', 'end'].includes(o.hAlign) ? o.hAlign : 'center';
  const yAlign = ['top', 'middle', 'bottom'].includes(o.yAlign) ? o.yAlign : 'bottom';
  const yOff = isFinite(+o.yOffset) ? +o.yOffset : 0;
  const width = isFinite(+o.width) && +o.width > 0 ? +o.width : DEFAULT_WIDTH;
  const xOff = isFinite(+o.xOffset) ? +o.xOffset : 0;
  const boxLeft = (1 - width) / 2 * W + xOff * (W / 2);
  const marginL = boxLeft + BOX_PAD_X;
  const marginR = W - (boxLeft + width * W) + BOX_PAD_X;
  let marginV = 0;
  if (yAlign === 'bottom') marginV = CAP_BOTTOM_BASE + (-yOff) * HALF_H;
  else if (yAlign === 'top') marginV = CAP_BOTTOM_BASE + yOff * HALF_H;
  const offsetY = yAlign === 'middle' ? yOff * HALF_H : 0;
  return { sizePx: (+sizeAttr || 100) * SIZE_K, marginL, marginR, marginV, offsetY, hAlign, yAlign, width, xOff, yOff };
}

module.exports = { SIZE_K, BOX_PAD_X, CAP_BOTTOM_BASE, DEFAULT_WIDTH, W, H, HALF_H, boxPx };
