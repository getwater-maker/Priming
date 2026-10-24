'use strict';
/**
 * test/_menu.js — 🧭 메뉴(리본) 열기 도우미. 헤더가 Vrew 처럼 **메뉴 줄 + 리본**이라
 *   고른 메뉴의 버튼만 화면에 있다 → 다른 메뉴의 버튼을 누르기 전에 그 메뉴를 먼저 연다.
 *   새 id(Lab 메뉴 줄 1단계) = file | home | edit | caption | format | insert | voice | template | effect | make | help
 *   옛 id 도 받는다: script→home · image→제작▸이미지 · video→제작▸비디오 · finish→file (대조표 docs/VrewLab/리본_선택자_대조표.md)
 */
const ALIAS = { script: 'home', finish: 'file', image: 'make', video: 'make' };
module.exports = async function menu(win, id) {
  const to = ALIAS[id] || id;
  await win.click(`.menus button[data-menu="${to}"]`);
  await win.waitForSelector(`.ribbon[data-menu-on="${to}"]`, { timeout: 5000 });
  if (id === 'image' || id === 'video') await win.click(`[data-testid="make-sub-${id}"]`);
};
module.exports.ALIAS = ALIAS;
// 옛 한글 메뉴 이름으로 누르기(시험이 `.menubar button:text-is("이미지")` 를 쓰던 자리) — 새 탭 이름으로 바꿔 누른다
const TEXT = { '대본·음성': '홈', 완성: '파일' };
module.exports.byText = async function byText(win, label) {
  if (label === '이미지' || label === '비디오') {
    await win.locator('.menubar button[data-menu="make"]').first().click();
    await win.click(`[data-testid="make-sub-${label === '이미지' ? 'image' : 'video'}"]`);
    return;
  }
  await win.locator(`.menubar button:text-is("${TEXT[label] || label}")`).first().click();
};
