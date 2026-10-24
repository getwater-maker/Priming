'use strict';
/**
 * node test/account-page.smoke.js — 👤 계정·크레딧 화면(Lab 메뉴 줄 5단계 · Vrew 계정 화면의 틀) 실제 앱 E2E
 *   개발 실행(회원 확인 없음) · 회원(크레딧 40/100 · 만료일 · ⛔ kie 이름 없음) · 관리자(🧩 kie 크레딧만 보임)
 *   열기·닫기(✕·Esc·메뉴 탭 누르기) · 본문(#body) 숨김/복귀 · 새로고침 = license-recheck
 *   ⚠ license-state/recheck 를 시험용 응답으로 바꿔 끼운다(진짜 회원 서버를 부르지 않는다)
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const setLic = (app, m) => app.evaluate(({ ipcMain }, mm) => {
  global.__recheck = 0;
  ipcMain.removeHandler('license-state'); ipcMain.handle('license-state', () => mm);
  ipcMain.removeHandler('license-recheck'); ipcMain.handle('license-recheck', () => { global.__recheck++; return mm; });
}, m);

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errors = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});

    console.log('\n[1] 개발 실행(회원 확인 없음)');
    ok(await win.locator('[data-testid="acct-open"]').count() === 1, '메뉴 줄에 👤 계정 단추');
    await win.click('[data-testid="acct-open"]');
    await win.waitForSelector('[data-testid="acct-page"]', { timeout: 5000 });
    ok(/개발/.test(await win.locator('[data-testid="acct-name"]').innerText()), '이름 = 개발 실행');
    ok(await win.locator('[data-testid="acct-logout"]').count() === 0, '회원 확인을 안 하면 로그아웃 단추 없음');
    ok(await win.locator('#body').isHidden(), '계정 화면이 열리면 본문(#body)은 숨는다');
    ok(await win.locator('.menubar').isVisible(), '메뉴 줄은 그대로 보인다');
    await win.click('[data-testid="acct-close"]');
    ok(await win.locator('[data-testid="acct-page"]').count() === 0 && await win.locator('#body').isVisible(), '✕ 닫기 → 본문 복귀');

    console.log('\n[2] 회원 — 크레딧 40 / 100');
    await setLic(app, { ok: true, enforced: true, owner: false, admin: false, email: 'member@example.com', expiresAt: '2026-12-31T00:00:00Z', points: { granted: 100, remaining: 40 }, devices: [] });
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.click('[data-testid="acct-open"]');
    await win.waitForSelector('[data-testid="acct-page"]', { timeout: 5000 });
    await win.waitForSelector('[data-testid="acct-email"]:has-text("member@example.com")', { timeout: 5000 });
    ok(await win.locator('[data-testid="acct-name"]').innerText() === 'member', '이름 = 이메일 앞부분');
    ok(await win.locator('[data-testid="acct-gauge-n"]').innerText() === '40' && await win.locator('[data-testid="acct-granted"]').innerText() === '100', '게이지 숫자 = 잔여 40 · 눈금 끝 = 지급 100');
    ok(Math.abs(Number(await win.locator('[data-testid="acct-gauge"]').getAttribute('data-pct')) - 0.4) < 0.001, '게이지 비율 0.4(판정력 — 40/100)');
    ok(/회원/.test(await win.locator('[data-testid="acct-plan"]').innerText()) && /2026-12-31/.test(await win.locator('[data-testid="acct-expiry"]').innerText()), '요금제 = 회원 · 만료일');
    ok(await win.locator('[data-testid="acct-logout"]').count() === 1 && await win.locator('[data-testid="acct-devices"]').count() === 1, '로그아웃 · 내 기기 관리');
    ok(!/kie/i.test(await win.locator('[data-testid="acct-page"]').innerText()) && await win.locator('[data-testid="acct-kie"]').count() === 0, '⛔ 회원 화면에 kie 이름이 없다');
    const before = await app.evaluate(() => global.__recheck);
    await win.click('[data-testid="acct-refresh"]'); await win.waitForTimeout(500);
    ok((await app.evaluate(() => global.__recheck)) > before, '새로고침 = license-recheck 호출');
    await win.keyboard.press('Escape'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="acct-page"]').count() === 0, 'Esc 로 닫힘');
    await win.click('[data-testid="acct-open"]'); await win.waitForSelector('[data-testid="acct-page"]');
    await win.click('.menus button[data-menu="file"]'); await win.waitForTimeout(250);
    ok(await win.locator('[data-testid="acct-page"]').count() === 0 && await win.locator('.ribbon[data-menu-on="file"]').count() === 1, '메뉴 탭을 누르면 계정 화면이 닫히고 그 탭이 열린다');

    console.log('\n[3] 관리자 — kie 크레딧 칸은 관리자에게만');
    await setLic(app, { ok: true, enforced: true, owner: true, admin: true, email: 'admin@example.com', points: null, kie: 786, devices: [] });
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.click('[data-testid="acct-open"]'); await win.waitForSelector('[data-testid="acct-page"]');
    await win.waitForSelector('[data-testid="acct-kie"]', { timeout: 8000 });
    ok(/786/.test(await win.locator('[data-testid="acct-kie"]').innerText()), '관리자 = 🧩 kie 크레딧 786');
    ok(/관리자/.test(await win.locator('[data-testid="acct-plan"]').innerText()) && /제한 없음/.test(await win.locator('[data-testid="acct-expiry"]').innerText()), '요금제 = 관리자 · 제한 없음');

    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally { await app.close().catch(() => {}); }
  console.log(`\n${fail ? '❌' : '✅'} account-page ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
