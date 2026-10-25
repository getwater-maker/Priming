'use strict';
/**
 * node test/denoise-ui.smoke.js — 🔇 기본 노이즈 줄이기 실제 화면 E2E
 *   우클릭 ▸ 효과 ▸ 노이즈 줄이기 → 패널(없음·약·중·강) → 문장 dn(DTO) · 배지 · Ctrl+Z · 새로고침 유지 · 효과 탭 단추
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const TAG = `노이즈시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 노이즈 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');
(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow(); win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const dns = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts.flatMap((c) => c.sentences || []).map((s) => s.dn || 0); });
    const select1 = async () => { await win.keyboard.press('Escape'); await win.locator('.sent[data-ln="1"] .clip-chk').first().click(); await win.waitForTimeout(250); };
    await select1();
    await win.locator('.sent[data-ln="1"] .clip-r1').first().click({ button: 'right', position: { x: 4, y: 4 } });
    await win.waitForSelector('[data-testid="clip-ctx"]');
    await win.hover('[data-testid="cx-fx"]'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="cx-fx-denoise"].soon').count() === 0 && await win.locator('[data-testid="cx-fx-denoise"]').count() === 1, '효과 ▸ 노이즈 줄이기는 준비 중이 아니다');
    const sb = await win.locator('[data-testid="cx-fx"]').boundingBox(); const sub = await win.locator('[data-testid="cx-sub-fx"]').boundingBox();
    await win.mouse.move(sub.x + 8, sb.y + sb.height / 2); await win.waitForTimeout(100);
    await win.click('[data-testid="cx-fx-denoise"]'); await win.waitForSelector('[data-testid="dn-panel"]', { timeout: 3000 });
    ok((await dns()).every((v) => v === 0), '처음엔 노이즈 줄이기가 없다');
    await win.click('[data-testid="dn-2"]'); await win.waitForTimeout(1000);
    let d = await dns();
    ok(d[0] === 2 && d[1] === 0 && d[2] === 0, `고른 문장(1번)만 중(2) ${JSON.stringify(d)}`);
    ok(await win.locator('[data-testid="clip-dn"]').count() === 1 && /중/.test(await win.locator('[data-testid="clip-dn"]').first().innerText()), '클립에 🔇중 배지');
    await win.click('[data-testid="dn-3"]'); await win.waitForTimeout(900);
    ok((await dns())[0] === 3, '강(3)으로 바꾸면 반영');
    await win.click('[data-testid="dn-0"]'); await win.waitForTimeout(900);
    ok((await dns()).every((v) => v === 0) && await win.locator('[data-testid="clip-dn"]').count() === 0, '없음 → 필드·배지 사라짐');
    await win.click('[data-testid="dn-close"]'); await win.keyboard.press('Control+z'); await win.waitForTimeout(900);
    ok((await dns())[0] === 3, 'Ctrl+Z → 없음 직전(강)으로');
    await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }); await win.waitForTimeout(700);
    ok((await dns())[0] === 3, '새로고침(작업본 이어받기) 뒤에도 유지');
    await select1();
    await win.click('.menus button[data-menu="effect"]'); await win.waitForTimeout(250);
    ok(await win.locator('[data-testid="rb-denoise"]').count() === 1 && !(await win.locator('[data-testid="rb-denoise"]').isDisabled()), '효과 탭에 「노이즈」 단추');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally { await app.close().catch(() => {}); for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} } }
  console.log(fail ? `\n❌ denoise-ui ${pass}/${pass + fail}` : `\n✅ denoise-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
