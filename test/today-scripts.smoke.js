'use strict';
/**
 * node test/today-scripts.smoke.js — 📅 오늘 대본 버튼(v0.9.85) E2E.
 *   ① 대본 메뉴에 📅 버튼이 보이고 눌린다 → 고르기 창이 뜬다(목록 또는 「없습니다」) → 취소로 닫힌다.
 *   ⚠ 찾기(today-scripts-scan)는 채널 대본 폴더를 **읽기만** 한다 · 「작업큐에 넣기」는 누르지 않는다(로이 출력 폴더에 쓰지 않게).
 */
const path = require('path');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 1366, height: 768 }).catch(() => {});
    await win.waitForSelector('[data-testid="ribbon"]', { timeout: 30000 });
    await win.click('button[data-menu="home"]'); await win.waitForTimeout(250);
    const b = await win.locator('[data-testid="today-scripts"]').boundingBox();
    ok(!!b && await win.evaluate(({ x, y }) => !!(document.elementFromPoint(x, y) || {}).closest?.('[data-testid="today-scripts"]'), { x: b.x + b.width / 2, y: b.y + b.height / 2 }), '📅 오늘 대본 버튼이 보이고 눌리는 자리');
    await win.click('[data-testid="today-scripts"]');
    await win.waitForSelector('[data-testid="today-pick"]', { timeout: 5000 });
    await win.waitForFunction(() => !/찾는 중/.test((document.querySelector('[data-testid="today-pick"]') || {}).textContent || ''), null, { timeout: 15000 });
    const txt = await win.locator('[data-testid="today-pick"]').textContent();
    const rows = await win.locator('[data-testid="today-pick"] input[type="checkbox"]').count();
    console.log(`  (대본 ${rows}편)`);
    ok(/오늘 작업할 대본\s*\d{4}-\d{2}-\d{2}/.test(txt), '창 제목에 오늘 날짜(KST)');
    ok(rows > 0 || /아직 안 만든 대본이 없습니다/.test(txt), '목록 또는 「없습니다」');
    if (process.env.SHOT) await win.locator('[data-testid="today-pick"]').screenshot({ path: process.env.SHOT });
    const addOn = !(await win.locator('[data-testid="today-add"]').isDisabled());
    ok(rows > 0 ? addOn : !addOn, '고른 대본이 있을 때만 「작업큐에 넣기」가 눌린다');
    await win.click('[data-testid="today-pick"] button:has-text("취소")');
    await win.waitForTimeout(200);
    ok(!(await win.locator('[data-testid="today-pick"]').count()), '취소로 닫힌다');
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} 오늘 대본 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
