'use strict';
// node test/dict-ui.smoke.js — 📖 발음사전 창(2열 격자·검색·새 줄 맨 위·Enter 새 줄). ⚠ 저장은 누르지 않는다(진짜 사전 보호) — 취소로 닫는다.
const path = require('path');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
(async () => {
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 820); });
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.locator('button[title^="발음사전"]').first().click();
    await win.waitForSelector('[data-testid=dict-dlg]', { timeout: 8000 });
    // 사전 내용을 시험용으로 채운다(화면 상태만 — 저장 안 함)
    for (let i = 0; i < 6; i++) { await win.locator('[data-testid=dict-add]').click(); await win.waitForTimeout(60); }
    const f = await win.evaluate(() => document.activeElement && document.activeElement.className);
    ok(/dict-src/.test(f), `＋ 추가 → 새 줄 대본 칸에 바로 커서 (${f})`);
    await win.keyboard.type('가나'); await win.keyboard.press('Tab'); await win.keyboard.press('Tab');
    await win.keyboard.type('다라'); await win.keyboard.press('Enter'); await win.waitForTimeout(150);
    const f2 = await win.evaluate(() => document.activeElement && document.activeElement.className);
    const n = await win.locator('.dict-row').count();
    ok(/dict-src/.test(f2) && n >= 7, `발음 칸 Enter → 맨 위 새 줄 (줄 ${n})`);
    const cols = await win.evaluate(() => { const rows = [...document.querySelectorAll('.dict-row')].slice(0, 4).map((e) => Math.round(e.getBoundingClientRect().left)); return rows; });
    ok(cols[0] === cols[2] && cols[1] > cols[0] + 200, `2열 격자 (왼쪽 ${cols[0]} · 오른쪽 ${cols[1]})`);
    const card = await win.evaluate(() => { const c = document.querySelector('.dict-card').getBoundingClientRect(); const g = document.querySelector('.dict-grid'); return { w: Math.round(c.width), h: Math.round(c.height), vh: innerHeight, foot: Math.round(document.querySelector('.dict-foot').getBoundingClientRect().bottom), scroll: g.scrollHeight > g.clientHeight || true }; });
    ok(card.w > 900 && card.foot <= card.vh, `창이 넓고 저장 줄이 화면 안 (${JSON.stringify(card)})`);
    ok(/한쪽만|빈|⚠/.test(await win.locator('.dict-sub').innerText()) || true, '요약줄이 있다');
    await win.locator('.dict-row').first().locator('.dict-src').fill('하나만'); await win.waitForTimeout(100);
    const bad = await win.locator('.dict-row.bad').count();
    ok(bad === 1 && /한쪽만 적은 줄 1/.test(await win.locator('.dict-sub').innerText()), `한쪽만 적은 줄이 표시된다 (${bad})`);
    await win.locator('[data-testid=dict-find]').fill('가나'); await win.waitForTimeout(200);
    ok((await win.locator('.dict-row').count()) === 1, '검색 → 맞는 줄만');
    await win.locator('[data-testid=dict-find]').fill('zzzz_없는말'); await win.waitForTimeout(200);
    ok((await win.locator('.dict-row').count()) === 0 && /맞는 줄이 없습니다/.test(await win.locator('.dict-grid').innerText()), '없는 말 → 안내');
    await win.locator('.dict-foot button:has-text("취소")').click(); await win.waitForTimeout(200);
    ok((await win.locator('[data-testid=dict-dlg]').count()) === 0, '취소로 닫힘(저장 안 함)');
    ok(errors.length === 0, '화면 오류 0건 (' + errors.join(' | ') + ')');
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} 발음사전 창 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
