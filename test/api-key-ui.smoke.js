'use strict';
/**
 * node test/api-key-ui.smoke.js — ⚙ 설정 → 🔑 API 키 탭의 「✔ 검증」(E2E)
 *   · 키마다 검증 단추 + 「🔍 모든 키 검증」
 *   · 나노바나나(Gemini) 칸에 **엉터리 키**를 붙여넣고 ✔ 검증 → ❌ 결과 줄(통과로 나오면 안 된다 — 판별력). 네트워크가 없어도 ❌(연결 실패)라 결과는 같다.
 *   ⚠ 엉터리 키는 저장하지 않는다(입력만 하고 blur 하지 않는다 — 로이의 저장된 키를 덮지 않게).
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.click('button[title^="통합 설정"]');
    await win.click('button:has-text("🔑 API 키")');
    await win.waitForSelector('[data-testid=keychk-all]', { timeout: 10000 });
    for (const id of ['gemini', 'xai', 'gemini-tts', 'mai', 'typecast', 'elevenlabs']) ok(await win.locator('[data-testid=keychk-btn-' + id + ']').count() === 1, `「✔ 검증」 단추: ${id}`);
    // 엉터리 키 → 거부 (저장은 blur 에서만 — 입력 뒤 바로 검증 단추를 눌러 blur 가 저장하지 않게 mousedown 대신 evaluate 클릭)
    const box = win.locator('input[placeholder="🔑 Gemini API 키"]');
    const had = await box.inputValue();
    await box.fill('bogus-key-for-test-0000');
    await win.evaluate(() => document.querySelector('[data-testid=keychk-btn-gemini]').click());
    await win.waitForSelector('[data-testid=keychk-gemini]', { timeout: 30000 });
    const lv = await win.locator('[data-testid=keychk-gemini]').getAttribute('data-level');
    ok(lv === 'bad', '엉터리 키 → ❌ 거부로 표시 — ' + (await win.locator('[data-testid=keychk-gemini]').innerText()));
    await box.fill(had);   // 되돌림(저장 안 됨)
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} api-key-ui — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
