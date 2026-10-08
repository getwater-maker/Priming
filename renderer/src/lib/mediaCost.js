// 렌더러용 이미지·비디오 예상 비용 — ★ 자체 구현을 두지 않는다. core/media-cost.js 를 그대로 쓴다(videoSelect.js 와 같은 방식).
import core from '../../../core/media-cost.js';

export const mcImageUnit = core.imageUnit;
export const mcVideoUnit = core.videoUnit;
export const mcCostText = core.costText;
