'use strict';
/**
 * node test/app-folders.smoke.js — ⚙ 설정 → 📁 폴더 탭(E2E · v0.9.16)
 *   · 대본 PDF · URL 받기 = 모든 채널 공통 폴더 칸 두 개 + 찾기
 *   · IPC get-app-folders 가 기본값(윈도우 다운로드)을 함께 돌려준다
 *   ⚠ 저장은 하지 않는다(blur 안 함) — ~/.priming-maker/app-folders.json 은 로이 앱과 같이 쓴다.
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.click('button[title^="통합 설정"]');
    await win.click('button:has-text("📁 폴더")');
    await win.waitForSelector('[data-testid=app-folders]', { timeout: 10000 });
    ok(await win.locator('[data-testid=app-folder-reader]').count() === 1, '「대본 PDF」 칸');
    ok(await win.locator('[data-testid=app-folder-download]').count() === 1, '「URL 받기」 칸');
    ok(await win.locator('[data-testid=app-folders] button:has-text("찾기")').count() === 2, '찾기 단추 두 개');
    const r = await win.evaluate(() => window.api.getAppFolders());
    ok(r && typeof r.reader === 'string' && typeof r.download === 'string' && typeof r.def === 'string', 'get-app-folders 응답 모양 — ' + JSON.stringify(r));
    const hint = (await win.locator('[data-testid=app-folders] .hint-src').allTextContents()).join(' ');   // 설명은 마우스 팝업(v0.9.18)
    ok(/모든 채널 공통/.test(hint), '「모든 채널 공통」 안내');
    try { await win.locator('.settings-card').screenshot({ path: process.env.PM_SHOT || path.join(os.tmpdir(), 'app-folders.png') }); } catch {}
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} app-folders — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
