'use strict';
/**
 * node test/youtube-ui.smoke.js — ⬆ 유튜브 업로드 화면 E2E (2026-09-24)
 *   ⚙ 설정 → ▶ 유튜브 탭 · 채널편집 📁 폴더 → ⬆ 자동 업로드 줄을 실제로 연다.
 *   ⚠ 아무것도 저장·연결하지 않는다(ESC 로 닫는다) — 사용자 설정 무변경. 구글에 닿지 않는다.
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

    const st = await win.evaluate(() => window.api.ytStatus());
    ok(st && typeof st.hasClient === 'boolean' && Array.isArray(st.channels), `yt-status 응답 (연결 파일 ${st.hasClient ? '있음' : '없음'} · 채널 ${st.channels.length})`);
    ok(st.available === true, 'Electron 안에서 OS 암호화(safeStorage) 사용 가능');
    ok(!JSON.stringify(st).match(/secret|refresh/i), '상태에 비밀값 없음');

    // ⚙ 설정 → ▶ 유튜브
    await win.locator('button:has-text("⚙ 설정")').first().click();
    await win.waitForTimeout(500);
    await win.locator('.modal-card.wide button:has-text("▶ 유튜브")').first().click();
    await win.waitForTimeout(500);
    ok(await win.locator('[data-testid="yt-client"] button:has-text("📥 파일 가져오기")').count() === 1, '① 「📥 파일 가져오기」 버튼');
    const conn = win.locator('[data-testid="yt-channels"] button:has-text("🔗 채널 연결")');
    ok(await conn.count() === 1, '② 「🔗 채널 연결」 버튼');
    ok((await conn.isDisabled()) === !st.hasClient, '연결 파일이 없으면 채널 연결 버튼이 잠긴다');
    ok(await win.locator('text=비공개').count() > 0 && await win.locator('text=AI 합성 콘텐츠 표시').count() === 1, '안내: 비공개 · AI 합성 표시');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    // 채널편집 📁 폴더 → ⬆ 자동 업로드
    await win.click('button[title^="채널(프리셋)"]');
    await win.waitForTimeout(700);
    const card = win.locator('.modal-card.tabbed').first();
    const heights = {};
    for (const t of ['🏠', '🎙', '📝', '🖼', '📁']) {
      await card.locator(`button:has-text("${t}")`).first().click();
      await win.waitForTimeout(250);
      heights[t] = await card.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    }
    const row = card.locator('.frow:has(label:has-text("⬆ 자동 업로드"))');
    ok(await row.count() === 1, '📁 폴더 탭에 「⬆ 자동 업로드」 줄');
    const sel = row.locator('select');
    const firstOpt = await sel.locator('option').first().textContent();
    ok(st.channels.length ? /올릴 유튜브 채널/.test(firstOpt) : /연결된 채널 없음/.test(firstOpt), `채널 목록 첫 줄: 「${firstOpt}」`);
    ok(await sel.locator('option').count() >= 1 + st.channels.length, '연결된 채널이 목록에 나온다');
    const vals = Object.values(heights);
    console.log('   탭 높이', JSON.stringify(heights));
    ok(Math.max(...vals) - Math.min(...vals) <= 4, '탭을 바꿔도 창 높이가 그대로(±4px)');
    const vh = await win.evaluate(() => window.innerHeight);
    ok(heights['📁'] <= vh, '📁 탭이 화면 안');
    await win.keyboard.press('Escape');
    ok(errs.length === 0, `화면 오류 0건 (${errs.slice(0, 2).join(' / ')})`);
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} 유튜브 업로드 화면 E2E ${pass}/${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 실패:', e); process.exit(1); });
