'use strict';
/**
 * node test/ai-notice-ui.smoke.js — ⚙ 채널편집 🏠 기본 탭의 🏷 AI 고지 문구·시간(v0.5.87)을 실제로 눌러 본다.
 * ⚠ 저장하지 않는다(ESC 로 닫는다) — 사용자 채널 무변경. 스크린샷은 AI_SHOT 경로로(있을 때만).
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
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.click('button[title^="채널(프리셋)"]');
    await win.waitForTimeout(700);
    const card = win.locator('.modal-card.tabbed').first();
    await card.locator('button:has-text("🏠")').first().click();
    await win.waitForTimeout(300);
    ok(await card.locator('[data-testid=ai-text]').count() === 1, '고지 문구 칸');
    await card.locator('[data-testid=ai-text]').fill('이 영상은 AI 로 만들었습니다');
    ok(await card.locator('[data-testid=ai-text]').inputValue() === '이 영상은 AI 로 만들었습니다', '문구를 고칠 수 있다');
    ok(await card.locator('text=초부터').count() === 1, '기본 단위 = 시간(초)');
    await card.locator('[data-testid=ai-unit]').selectOption('clip');
    await win.waitForTimeout(200);
    ok(await card.locator('text=번 클립부터').count() === 1 && await card.locator('text=번 클립까지').count() === 1, '클립 단위로 바꾸면 클립 번호 칸');
    // 칸이 실제로 눌리는가(다른 요소에 가리지 않는가)
    const hit = await card.locator('[data-testid=ai-to]').evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t === el; });
    ok(hit, '끝 칸이 실제로 눌린다(elementFromPoint)');
    const h = await card.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    const vh = await win.evaluate(() => window.innerHeight);
    ok(h <= vh, `팝업이 화면 안(${h} / ${vh})`);
    if (process.env.AI_SHOT) await card.screenshot({ path: process.env.AI_SHOT });
    await win.keyboard.press('Escape');
    ok(errs.length === 0, `화면 오류 0건 (${errs.slice(0, 2).join(' / ')})`);
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} AI 고지 화면 E2E ${pass}/${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 실패:', e); process.exit(1); });
