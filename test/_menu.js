'use strict';
/**
 * test/_menu.js — 🧭 v0.5.42 메뉴(리본) 열기 도우미. 헤더가 Vrew 처럼 **메뉴 줄 + 리본**이 되어
 *   고른 메뉴의 버튼만 화면에 있다 → 다른 메뉴의 버튼을 누르기 전에 그 메뉴를 먼저 연다.
 *   id = script(대본·음성 · 기본) | image | video | finish(완성) | format(서식)
 */
module.exports = async function menu(win, id) {
  await win.click(`.menus button[data-menu="${id}"]`);
  await win.waitForSelector(`.ribbon[data-menu-on="${id}"]`, { timeout: 5000 });
};
