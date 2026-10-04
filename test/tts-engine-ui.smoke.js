'use strict';
/**
 * tts-engine-ui.smoke.js — 🔊 음성 엔진 버튼·팝업(v0.6.67) 실제 앱 E2E
 *   헤더 「음성」 메뉴의 옛 「출력」·「Vrew 음성」·「다시 연결」 자리에 🔊 버튼이 있고, 실제로 눌리며,
 *   팝업에 엔진 5개(OmniVoice·Gemini·MAI·타입캐스트·ElevenLabs)가 뜨고, 유료 엔진의 칸(키·모델·목소리)이 열린다.
 *   🔑 저장은 누르지 않는다(로이 설정을 바꾸지 않는다) — 키 없는 유료 엔진을 골라 저장하면 막히는지만 본다.
 *   ⚠ renderer/dist 를 읽는다 — 화면을 고쳤으면 `npm run build:renderer` 뒤에 돌릴 것.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');

let pass = 0; const fails = [];
const ok = (c, n) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fails.push(n); console.log('  ❌ ' + n); } };

(async () => {
  const cfgPath = path.join(os.homedir(), '.priming-maker', 'tts-engines.json');
  const before = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null;
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errs = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push(String(e.message || e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    const btn = win.locator('[data-testid="tts-engine-btn"]');
    await btn.waitFor({ timeout: 10000 });
    ok(await btn.isVisible(), '🔊 음성 엔진 버튼이 보인다');
    ok((await win.locator('.rb-t', { hasText: 'Vrew 음성' }).count()) === 0, '「Vrew 음성」 버튼 없음');
    ok((await win.locator('.rb-t', { hasText: '다시 연결' }).count()) === 0, '「다시 연결」 버튼 없음');
    ok((await win.locator('option[value="visual"]').count()) === 0, '「출력 — 화면만」 고르기 없음');
    const hit = await btn.evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && el.contains(t); });
    ok(hit, '버튼이 실제로 눌리는 자리(elementFromPoint)');
    await btn.click();
    const dlg = win.locator('[data-testid="tts-engine-dlg"]');
    await dlg.waitFor({ timeout: 5000 });
    for (const id of ['omnivoice', 'gemini', 'mai', 'typecast', 'elevenlabs']) ok((await win.locator(`[data-testid="tts-eng-${id}"]`).count()) === 1, `엔진 칸 ${id}`);
    // MAI 를 골라 칸이 열리는지(지역·모델·목소리)
    await win.locator('[data-testid="tts-eng-mai"] input[type="radio"]').check();
    const mai = await win.locator('[data-testid="tts-eng-mai"]').innerText();
    ok(/지역/.test(mai) && /모델/.test(mai) && /목소리/.test(mai), 'MAI 를 고르면 지역·모델·목소리 칸이 열린다');
    ok(await win.locator('[data-testid="tts-eng-mai"] select option[value="MAI-Voice-2.1-Flash"]').count() === 1, 'MAI 모델에 2.1-Flash 도 있다');
    // 키가 없는 엔진을 고르고 저장 → 막힌다(설정 파일 불변)
    const hasMaiKey = /키 있음/.test(mai);
    if (!hasMaiKey) {
      await win.locator('[data-testid="tts-eng-save"]').click();
      await win.waitForTimeout(400);
      const msg = await win.locator('[data-testid="tts-eng-msg"]').innerText().catch(() => '');
      ok(/API 키를 넣어야/.test(msg), '키 없는 유료 엔진은 저장을 막고 알린다');
      ok(await dlg.isVisible(), '막히면 창이 그대로');
    }
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    ok((await dlg.count()) === 0, 'Esc 로 닫힌다');
    ok(errs.length === 0, `화면 오류 0건 (${errs.join(' | ')})`);
  } finally {
    await app.close().catch(() => {});
    const after = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null;
    ok(after === before, '로이 음성 엔진 설정 파일 불변');
  }
  console.log(`\n${fails.length ? '❌' : '✅'} 음성 엔진 화면 E2E ${pass}/${pass + fails.length}`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
