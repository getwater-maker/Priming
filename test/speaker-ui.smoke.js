'use strict';
/**
 * node test/speaker-ui.smoke.js — 채널편집 🎙 음성 탭의 「🎭 화자별 목소리」를 실제로 눌러 본다.
 * ⚠ 저장하지 않는다(ESC 로 닫는다) — 사용자 채널 무변경.
 */
const path = require('path');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errs = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.click('button[title^="채널(프리셋)"]');
    await win.waitForTimeout(700);
    const card = win.locator('.modal-card.tabbed').first();
    const heights = {};
    for (const t of ['🏠', '🎙', '📝', '🖼', '📁']) {
      await card.locator(`button:has-text("${t}")`).first().click();
      await win.waitForTimeout(250);
      heights[t] = await card.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    }
    await card.locator('button:has-text("🎙")').first().click();
    await win.waitForTimeout(300);
    ok(await card.locator('text=🎭 화자별 목소리').count() === 1, '🎙 음성 탭에 「🎭 화자별 목소리」');
    const add = card.locator('button:has-text("＋ 화자 추가")');
    ok(await add.count() === 1, '「＋ 화자 추가」 버튼');
    const before = await card.locator('input[placeholder="이름"]').count();
    await add.click(); await win.waitForTimeout(200);
    await add.click(); await win.waitForTimeout(200);
    const rows = card.locator('input[placeholder="이름"]');
    ok(await rows.count() === before + 2, `누르면 줄이 생긴다 (${before} → ${await rows.count()})`);
    await rows.nth(before).fill('엄마');
    const sel = card.locator('select').filter({ has: win.locator('option:has-text("— 목소리 선택 —")') }).first();
    const opts = await sel.locator('option').count();
    ok(opts > 1, `목소리 목록이 채널 참조음성 목록과 같다 (${opts - 1}개)`);
    await card.locator('button[title="이 화자 지우기"]').last().click(); await win.waitForTimeout(200);
    ok(await rows.count() === before + 1, '✕ 로 지운다');
    const h = await card.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    const vh = await win.evaluate(() => window.innerHeight);
    console.log('   탭 높이', JSON.stringify(heights), '· 화자 2줄 뒤', h, '/ 창', vh);
    const vals = Object.values(heights);
    ok(Math.max(...vals) - Math.min(...vals) <= 4, '탭을 바꿔도 창 높이가 그대로(±4px)');
    ok(h <= vh, '화자 줄을 넣어도 팝업이 화면 안');
    await win.keyboard.press('Escape');
    ok(errs.length === 0, `화면 오류 0건 (${errs.slice(0, 2).join(' / ')})`);
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} 화자 목소리 화면 E2E ${pass}/${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 실패:', e); process.exit(1); });
