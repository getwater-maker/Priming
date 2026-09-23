'use strict';
/**
 * node test/vrew-render-ui.smoke.js — 실제 앱을 띄워 🎬 유튜브 MP4 선택지·버튼·폴더 칸을 확인하는 E2E.
 * 🔑 버튼을 실제로 눌러 화면을 바꾼다(JSX 핸들러 안의 미정의 식별자는 빌드가 못 잡는다).
 * ⚠ 렌더는 하지 않는다 — 선택지를 바꿨다가 원래 값으로 되돌리고, 채널편집은 저장 없이 닫는다.
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
    win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    win.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    console.log('· 부팅 OK');

    // [1] ④ 완성 드롭다운에 🎬 유튜브 MP4
    const grp = win.locator('.hgroup:has(.glabel:has-text("④ 완성"))');
    const sel = grp.locator('select').first();
    const values = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value));
    ok(values.join(',') === 'vrew,whiteboard,mp4', `선택지 3개 (${values.join(', ')})`);
    const orig = await sel.inputValue();

    // [2] 고르면 「🎬 MP4 굽기」 버튼이 나타난다
    await sel.selectOption('mp4');
    await win.waitForTimeout(300);
    ok(await sel.inputValue() === 'mp4', 'mp4 가 선택된 채로 남는다(정규화가 vrew 로 되돌리지 않는다)');
    ok(await grp.locator('button:has-text("🎬 MP4 굽기")').count() === 1, '「🎬 MP4 굽기」 버튼이 나타난다');
    await sel.selectOption('vrew');
    await win.waitForTimeout(300);
    ok(await grp.locator('button:has-text("🎬 MP4 굽기")').count() === 0, '.vrew 로 돌리면 버튼이 사라진다');
    await sel.selectOption(orig);

    // [3] 채널편집 — 📁 폴더 「유튜브 업로드」 칸(기본값 = 다운로드) · 🖼 제작 도구 「출력」 선택지
    await win.click('button[title^="채널(프리셋)"]');
    await win.waitForTimeout(700);
    const card = win.locator('.modal-card').filter({ hasText: '폴더' }).first();
    await card.locator('button:has-text("📁")').first().click();
    await win.waitForTimeout(300);
    const row = card.locator('.frow:has(label:has-text("유튜브 업로드"))');
    ok(await row.count() === 1, '📁 폴더 탭에 「유튜브 업로드」 칸');
    const v = await row.locator('input').inputValue().catch(() => '');
    ok(/Downloads|다운로드/i.test(v) || v.length > 3, `기본값이 채워져 있다 (${v})`);
    ok(await row.locator('button:has-text("찾기")').count() === 1, '「찾기」 버튼');
    await card.locator('button:has-text("🖼")').first().click();
    await win.waitForTimeout(300);
    const outSel = card.locator('.crow:has(.l:has-text("출력")) select');
    const ov = await outSel.locator('option').evaluateAll((os) => os.map((o) => o.value)).catch(() => []);
    ok(ov.includes('mp4'), `제작 도구 「출력」에도 mp4 (${ov.join(', ')})`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    ok(errs.length === 0, `화면 오류 0건 (실제 ${errs.length}${errs.length ? ' — ' + errs.slice(0, 3).join(' / ') : ''})`);
  } finally {
    await app.close();
  }
  console.log(`\n${fail ? '❌' : '✅'} 🎬 유튜브 MP4 화면 E2E ${pass}/${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 실패:', e); process.exit(1); });
