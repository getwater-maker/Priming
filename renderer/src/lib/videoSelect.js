// 렌더러용 영상 대상 방식 — ★ 자체 구현을 두지 않는다. core/video-select.js 를 그대로 쓴다(captions.js 와 같은 방식).
import core from '../../../core/video-select.js';

export const VID_MODES = core.MODES;
export const normVidSel = core.normSel;
export const vidSelLabel = core.labelOf;
export const vidMatcher = core.matcher;
