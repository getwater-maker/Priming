'use strict';
/**
 * preview-pages.js — 📖 출판 미리보기 쪽수 보고 판정(순수 · 렌더러 BookView 가 쓴다 · test/book-preview-pages.test.js).
 *
 * 🔴 사고(v0.9.88에서 원인 확정): 조판 도중 원고·조판 설정이 바뀌어 미리보기를 새로 만들면(iframe 문서를 다시 씀),
 *   **옛 vivliostyle 뷰어가 버려진 문서에서 계속 돌다가** 'complete' 를 내고 자기 쪽수(중간 숫자)를 보고했다 —
 *   삼국지 5권 실측: 새 뷰어가 105쪽째일 때 옛 뷰어가 「259쪽」을 보고(실제 281쪽). 예전 31·71·177쪽도 같은 뿌리로 본다.
 * 그래서 두 가지를 모두 통과해야 보고한다:
 *   ① 지금 화면의 뷰어인가(isCurrent — 새 미리보기가 시작되면 옛 뷰어는 아니다)
 *   ② 뷰어가 센 쪽수 = 지금 iframe 문서에 실제로 그려진 쪽 수(domPages) — 버려진 문서의 쪽은 지금 문서에 없다
 * known = main 이 이미 아는 쪽수(같으면 보고 안 함 — 재렌더 회피).
 */
function pageReport({ isCurrent, total, domPages, known }) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (!isCurrent) return { report: false, show: false, reason: 'stale-viewer' };
  if (!(n > 0)) return { report: false, show: false, reason: 'no-pages' };
  if (Number(domPages) !== n) return { report: false, show: false, reason: 'dom-mismatch' };
  return { report: n !== (Number(known) || 0), show: true, reason: 'ok' };
}
module.exports = { pageReport };
