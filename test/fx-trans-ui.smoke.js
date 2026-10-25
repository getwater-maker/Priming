'use strict';
/**
 * node test/fx-trans-ui.smoke.js — 🎬 효과 ⑥ 화면 전환 실제 화면 E2E
 *   우클릭 ▸ 효과 ▸ 화면 전환 → 패널(종류·길이) → 그룹 look.trans · 없음 · Ctrl+Z · 효과 탭 단추
 *   (MP4 에 들어가는 모양은 test/fx-trans.test.js 의 실제 왕복이 잰다) · ⚠ 생성 서버를 부르지 않는다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const TAG = `전환시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 전환 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');
(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const looks = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts.map((c) => c.look || null); });
    const sel = async (ln) => { await win.keyboard.press('Escape'); await win.locator(`.sent[data-ln="${ln}"] .clip-chk`).first().click(); await win.waitForTimeout(250); };
    console.log('\n[1] 열기 — 우클릭 효과');
    await sel(3);
    await win.locator('.sent[data-ln="3"] .clip-r1').first().click({ button: 'right', position: { x: 4, y: 4 } });
    await win.waitForSelector('[data-testid="clip-ctx"]');
    await win.hover('[data-testid="cx-fx"]'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="cx-fx-trans"].soon').count() === 0 && await win.locator('[data-testid="cx-fx-trans"]').count() === 1, '효과 ▸ 화면 전환은 준비 중이 아니다');
    const sb = await win.locator('[data-testid="cx-fx"]').boundingBox(); const sub = await win.locator('[data-testid="cx-sub-fx"]').boundingBox();
    await win.mouse.move(sub.x + 8, sb.y + sb.height / 2); await win.waitForTimeout(100);
    await win.click('[data-testid="cx-fx-trans"]');
    await win.waitForSelector('[data-testid="tr-panel"]', { timeout: 3000 });
    ok(/G2/.test(await win.locator('[data-testid="tr-panel"]').innerText()) && await win.locator('[data-testid="tr-type"]').inputValue() === '', '패널이 열린다(대상 G2 · 처음엔 없음)');
    ok(await win.locator('[data-testid="tr-sec"]').isDisabled(), '종류가 없으면 길이는 못 만진다');
    console.log('\n[2] 종류·길이 → 그룹 look.trans');
    await win.selectOption('[data-testid="tr-type"]', 'wipeleft'); await win.waitForTimeout(1000);
    let l = await looks();
    ok(l[1] && l[1].trans && l[1].trans.type === 'wipeleft' && l[1].trans.sec === 1 && !l[0], `G2 look.trans = 닦아내기 1초 ${JSON.stringify(l[1])}`);
    await win.locator('[data-testid="tr-sec"]').fill('2.5'); await win.waitForTimeout(1000);
    l = await looks();
    ok(l[1].trans.sec === 2.5 && await win.locator('[data-testid="tr-v"]').innerText() === '2.5초', '길이 2.5초');
    console.log('\n[3] 없음 · Ctrl+Z');
    await win.selectOption('[data-testid="tr-type"]', ''); await win.waitForTimeout(1000);
    l = await looks();
    ok(!l[1] || !l[1].trans, '없음 → 그룹 look 에서 사라짐');
    await win.click('[data-testid="tr-close"]'); await win.keyboard.press('Control+z'); await win.waitForTimeout(1000);
    l = await looks();
    ok(l[1] && l[1].trans && l[1].trans.type === 'wipeleft', 'Ctrl+Z → 없음 직전(닦아내기)으로');
    console.log('\n[4] 효과 탭 단추 · 유지');
    await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }); await win.waitForTimeout(600);
    ok((await looks())[1].trans.type === 'wipeleft', '새로고침 뒤에도 유지');
    await sel(3);
    await win.click('.menus button[data-menu="effect"]'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="rb-trans"]').count() === 1 && !(await win.locator('[data-testid="rb-trans"]').isDisabled()), '효과 탭에 「전환」 단추');
    await win.click('[data-testid="rb-trans"]'); await win.waitForSelector('[data-testid="tr-panel"]');
    ok(await win.locator('[data-testid="tr-type"]').inputValue() === 'wipeleft', '패널이 현재 값으로 열린다');
    await win.click('[data-testid="tr-close"]');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally { await app.close().catch(() => {}); for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} } }
  console.log(fail ? `\n❌ fx-trans-ui ${pass}/${pass + fail}` : `\n✅ fx-trans-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
