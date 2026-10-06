'use strict';
/**
 * node test/update-ui.smoke.js — 헤더 앱 이름 클릭 → tube.primingwave.com / 🔄 업데이트 단추(E2E)
 *   · 앱 이름을 누르면 외부 브라우저로 그 주소(스텁으로 가로채 확인 — 실제로 열지 않는다)
 *   · ⟳ 단추를 누르면 서버 버전을 확인해 상태줄에 결과(최신/새 버전/오프라인 중 하나)
 *   · 개발 실행에서는 「적용」이 막힌다(앱이 꺼지거나 파일이 바뀌지 않는다)
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
    await win.waitForSelector('[data-testid=app-title]', { timeout: 20000 });
    await app.evaluate(({ shell }) => { globalThis.__opened = []; shell.openExternal = async (u) => { globalThis.__opened.push(String(u)); }; });
    await win.click('[data-testid=app-title]');
    await win.waitForTimeout(300);
    const opened = await app.evaluate(() => globalThis.__opened);
    ok(opened.length === 1 && opened[0] === 'https://tube.primingwave.com/', '앱 이름 클릭 → https://tube.primingwave.com/ — ' + JSON.stringify(opened));
    ok(await win.locator('[data-testid=app-update]').count() === 1, '헤더에 업데이트 단추');
    const vis = await win.locator('[data-testid=app-update]').evaluate((el) => { const r = el.getBoundingClientRect(); return r.width > 10 && r.height > 10 && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el; });
    ok(vis, '단추가 실제로 눌린다(elementFromPoint)');
    // 확인 — 서버 버전과 비교한 결과가 상태줄에 나온다(개발 실행 = 이 저장소 버전 vs GitHub)
    const r = await win.evaluate(() => window.api.appUpdateCheck());
    ok(r && ['same', 'newer', 'older', 'deps', 'none'].includes(r.state) && r.packaged === false, '확인 결과 상태 — ' + (r && r.state) + ' · ' + (r && r.message));
    // 적용은 개발 실행에서 막힌다
    const a = await win.evaluate(() => window.api.appUpdateApply());
    ok(a && a.ok === false && a.reason === 'dev', '개발 실행에서는 적용하지 않는다 — ' + (a && a.reason));
    ok(await win.locator('[data-testid=app-title]').count() === 1, '적용 시도 뒤에도 앱이 그대로 켜져 있다');
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} update-ui — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
