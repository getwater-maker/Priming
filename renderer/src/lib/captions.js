// 렌더러용 자막 분할 — ★ 자체 구현을 두지 않는다. core/caption-splitter.js 를 그대로 쓴다.
//
// ⚠ 2026-08-24 이전엔 여기에 같은 알고리즘의 복사본이 있었다. 그러면 core 만 고쳤을 때
//   「앱 화면에서 본 자막 줄」과 「실제 .vrew 에 들어간 줄」이 조용히 갈라진다.
//   (vite.config.mjs 의 server.fs.allow 가 root 밖 core/ 를 dev 서버에서도 읽게 해 준다.)
import core from '../../../core/caption-splitter.js';

export const CONNECTIVES = core.CONNECTIVES;
export const mLen = core.meaningfulLen;
export const splitLines = core.splitCaptionLines;
export const auditLines = core.auditCaptionLines;
