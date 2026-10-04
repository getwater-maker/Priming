'use strict';
/**
 * tts-engine-ui.smoke.js — 🔊 음성 엔진 버튼·팝업 실제 앱 E2E (v0.6.68 탭·카드)
 *   ① 헤더: 옛 「출력」·「Vrew 음성」·「다시 연결」 없음 · 🔊 버튼이 실제로 눌림
 *   ② 팝업 크기 고정 — 탭 5개를 돌아도 창의 폭·높이가 같다
 *   ③ 탭 = 엔진: MAI 97개 카드(언어 전체) · 한국어 거르기 4개 · Gemini 30개 · 카드 누르면 선택 · 말투는 그 목소리 것만
 *   ④ 키 없는 유료 엔진을 「이 엔진으로 만들기」 후 저장 → 막힘
 *   🔑 저장되는 동작은 하지 않는다(로이 설정 불변 — 끝에 파일 비교).
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
    const card = win.locator('[data-testid="tts-eng-card"]');
    await card.waitFor({ timeout: 8000 });

    // ② 크기 고정
    const sizes = [];
    for (const id of ['omnivoice', 'gemini', 'mai', 'typecast', 'elevenlabs']) {
      const tab = win.locator(`[data-testid="tts-tab-${id}"]`);
      ok((await tab.count()) === 1, `탭 ${id}`);
      await tab.click(); await win.waitForTimeout(250);
      const b = await card.boundingBox();
      sizes.push(`${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    ok(new Set(sizes).size === 1, `탭마다 창 크기가 같다 (${sizes.join(' · ')})`);

    // ③ MAI 카드
    await win.locator('[data-testid="tts-tab-mai"]').click(); await win.waitForTimeout(200);
    const cards = win.locator('[data-testid="tts-voice-card"]');
    ok((await cards.count()) === 4, `MAI 기본 = 한국어 카드 4개 (${await cards.count()})`);
    await win.locator('[data-testid="tts-voice-lang"]').selectOption('');
    await win.waitForTimeout(200);
    ok((await cards.count()) === 97, `MAI 언어 전체 = 97개 (${await cards.count()})`);
    await win.locator('[data-testid="tts-voice-q"]').fill('Grant');
    await win.waitForTimeout(150);
    const nGrant = await cards.count();
    ok(nGrant > 10 && nGrant < 97, `검색 「Grant」 거르기 (${nGrant}개)`);
    await win.locator('[data-testid="tts-voice-q"]').fill('');
    await win.locator('[data-testid="tts-voice-card"][data-voice="ko-KR-Haena"]').click();
    await win.waitForTimeout(150);
    const haena = await win.locator('[data-testid="tts-voice-card"][data-voice="ko-KR-Haena"]').innerText();
    ok(/✔/.test(haena), '카드를 누르면 선택 표시(✔)');
    const styleOpts = await win.locator('[data-testid="tts-eng-mai"] select').evaluateAll((ss) => ss.map((s) => [...s.options].map((o) => o.value)));
    ok(styleOpts.some((o) => o.includes('softvoice') && !o.includes('narrator')), '말투 = 고른 목소리(해나)가 되는 것만');
    const gridScroll = await win.locator('[data-testid="tts-voice-grid"]').evaluate((el) => el.scrollHeight > el.clientHeight);
    ok(gridScroll, '목록이 길면 카드 칸 안에서만 스크롤');

    // Gemini 30
    await win.locator('[data-testid="tts-tab-gemini"]').click(); await win.waitForTimeout(200);
    ok((await cards.count()) >= 30, `Gemini 카드 30개 이상 (${await cards.count()})`);

    // ④ 키 없는 유료 엔진 → 저장 막힘
    const typecastKey = await win.locator('[data-testid="tts-tab-typecast"]').innerText();
    await win.locator('[data-testid="tts-tab-typecast"]').click(); await win.waitForTimeout(200);
    if (!/🔑/.test(typecastKey)) {
      await win.locator('[data-testid="tts-use"]').click();
      await win.locator('[data-testid="tts-eng-save"]').click();
      await win.waitForTimeout(400);
      ok(/API 키를 넣어야/.test(await win.locator('[data-testid="tts-eng-msg"]').innerText()), '키 없는 유료 엔진은 저장을 막고 알린다');
      ok(await card.isVisible(), '막히면 창이 그대로');
    }
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    ok((await card.count()) === 0, 'Esc 로 닫힌다');
    ok(errs.length === 0, `화면 오류 0건 (${errs.join(' | ')})`);
  } finally {
    await app.close().catch(() => {});
    const after = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null;
    ok(after === before, '로이 음성 엔진 설정 파일 불변');
  }
  console.log(`\n${fails.length ? '❌' : '✅'} 음성 엔진 화면 E2E ${pass}/${pass + fails.length}`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
