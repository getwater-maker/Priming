'use strict';
/**
 * node test/voice-design-vi.smoke.js — 🎨 보이스디자인 창에서 **베트남어 목소리를 실제로 만든다**(2026-09-26).
 *   채널편집 → 🎙 음성 → 🎨 디자인 → 언어 Tiếng Việt → 성별·나이·음높이 → 생성 → 받아쓰기 확인 % 표시.
 *   ⚠ OmniVoice 서버를 실제로 쓴다(문장 1개 · 수 초). 서버가 바쁘면(/busy) 생성은 건너뛴다(로이 작업 GPU 를 뺏지 않는다).
 *   ⚠ 저장하지 않는다 — 참조음성 라이브러리 무변경.
 */
const path = require('path');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

async function serverBusy() {
  try {
    const url = require(path.join(ROOT, 'tts', 'tts-config')).getProvider('omnivoice').baseUrl.replace(/\/+$/, '');
    const key = require(path.join(ROOT, 'tts', 'secret-store')).get('omnivoice');
    const r = await fetch(url + '/busy', { headers: key && key.apiKey ? { 'X-API-Key': key.apiKey } : {} });
    const j = await r.json();
    return !!j.busy;
  } catch (_) { return true; }
}

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
    await card.locator('button:has-text("🎙")').first().click();
    await win.waitForTimeout(300);
    await card.locator('button:has-text("🎨 디자인")').first().click();
    await win.waitForTimeout(800);
    const lang = win.locator('[data-testid=vd-lang]');
    ok(await lang.count() === 1, '보이스디자인 창에 「언어」 선택');
    const optTexts = await lang.locator('option').allTextContents();
    ok(optTexts.some((t) => /Tiếng Việt/.test(t)) && optTexts.some((t) => /日本語/.test(t)), `언어 선택지 — ${optTexts.join(' · ')}`);
    await lang.selectOption('vi');
    await win.waitForTimeout(300);
    ok(await win.locator('[data-testid=vd-gender]').count() === 1 && await win.locator('[data-testid=vd-age]').count() === 1 && await win.locator('[data-testid=vd-pitch]').count() === 1,
      '베트남어 = 성별·나이·음높이 고르기 칸(자유 글 설명 대신)');
    const txt = await win.locator('textarea').last().inputValue();
    ok(/Ngày xửa ngày xưa/.test(txt), '예문이 베트남어로 바뀐다');
    const btn = win.locator('[data-testid=vd-generate]');
    ok(await btn.isEnabled(), '보이스디자인 서버 준비를 기다리지 않고 누를 수 있다(OmniVoice 로 만든다)');
    if (await serverBusy()) {
      console.log('  (OmniVoice 서버가 바쁘거나 닿지 않아 실제 생성은 건너뜀)');
    } else {
      await btn.click();
      const status = win.locator('text=/받아쓰기 확인: \\d+% 일치/');
      await status.first().waitFor({ timeout: 180000 });
      const s = await status.first().textContent();
      const pct = Number((s.match(/(\d+)% 일치/) || [])[1]);
      console.log('   ' + s.trim().slice(0, 80));
      ok(pct >= 90, `만든 베트남어 목소리가 받아쓰기와 ${pct}% 일치(90% 이상)`);
      ok(await win.locator('audio').count() >= 1, '미리듣기 음성이 붙는다');
    }
    await win.keyboard.press('Escape'); await win.waitForTimeout(200);
    await win.keyboard.press('Escape');
    ok(errs.length === 0, `화면 오류 0건 (${errs.slice(0, 2).join(' / ')})`);
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} 베트남어 보이스디자인 E2E ${pass}/${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 실패:', e); process.exit(1); });
