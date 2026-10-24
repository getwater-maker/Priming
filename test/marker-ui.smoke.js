'use strict';
/**
 * node test/marker-ui.smoke.js — ⚑ 마커(Lab) 실제 화면 E2E
 *   우클릭 ▸ 마커(달기) → ⚑ 표시 · DTO mk · 작업본(.smproj)에 저장 → 다시 누르면 지움(toggle) → 일부만 달려 있으면 모두 닮
 *   편집 탭 마커 단추 · 마커 모아 보기 목록(개수·글·누르면 닫힘) · Ctrl+Z 되돌리기 · 마커만 달아서는 대본(.md)이 안 바뀐다
 *   ⚠ 임시 채널·임시 출력 폴더 — 생성 서버를 부르지 않는다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const TAG = `마커시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 마커 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    await win.waitForTimeout(600);
    const mks = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts.flatMap((c) => c.sentences.map((s) => s.mk ? 1 : 0)); });
    const rightClick = async (n) => { await win.keyboard.press('Escape'); await win.locator(`.sent[data-ln="${n}"] .clip-r1`).first().click({ button: 'right', position: { x: 4, y: 4 } }); await win.waitForSelector('[data-testid="clip-ctx"]', { timeout: 4000 }); };
    const md0 = fs.readFileSync(MD, 'utf8');

    console.log('\n[1] 달기 · 지우기(우클릭 ▸ 마커)');
    ok(JSON.stringify(await mks()) === '[0,0,0]' && await win.locator('[data-testid="clip-marker"]').count() === 0, '처음엔 마커 없음');
    await rightClick(1);
    ok(await win.locator('[data-testid="cx-marker"].soon').count() === 0, '마커는 더 이상 준비 중이 아니다');
    await win.click('[data-testid="cx-marker"]'); await win.waitForTimeout(700);
    ok(JSON.stringify(await mks()) === '[1,0,0]', 'DTO: 첫 문장에만 mk');
    ok(await win.locator('[data-testid="clip-marker"]').count() === 1, '클립에 ⚑ 표시 1개');
    await win.waitForTimeout(800);
    ok(fs.existsSync(SNAP) && /"mk":\s*1/.test(fs.readFileSync(SNAP, 'utf8')), '작업본(.smproj)에 mk 저장 — 다시 열어도 남는다');
    ok(fs.readFileSync(MD, 'utf8') === md0, '마커만으로는 대본(.md)이 바뀌지 않는다');
    await rightClick(1);
    ok(/✓/.test(await win.locator('[data-testid="cx-marker"]').innerText()), '달려 있으면 메뉴에 ✓');
    await win.click('[data-testid="cx-marker"]'); await win.waitForTimeout(700);
    ok(JSON.stringify(await mks()) === '[0,0,0]' && await win.locator('[data-testid="clip-marker"]').count() === 0, '다시 누르면 지움(toggle)');

    console.log('\n[2] 여러 클립 — 일부만 달려 있으면 모두 닮');
    await rightClick(1); await win.click('[data-testid="cx-marker"]'); await win.waitForTimeout(600);   // 1번만 달림
    await win.keyboard.press('Escape');
    await win.locator('.sent[data-ln="1"] .clip-chk').first().click(); await win.waitForTimeout(150);
    await win.locator('.sent[data-ln="2"] .clip-chk').first().click({ modifiers: ['Control'] }).catch(() => {}); await win.waitForTimeout(200);
    await win.locator('.sent[data-ln="2"] .clip-r1').first().click({ button: 'right', position: { x: 4, y: 4 } }); await win.waitForSelector('[data-testid="clip-ctx"]');
    await win.click('[data-testid="cx-marker"]'); await win.waitForTimeout(700);
    const m2 = await mks();
    ok(m2[0] === 1 && m2[1] === 1, `1·2번 모두 마커 ${JSON.stringify(m2)} (일부만 달려 있었으니 다는 쪽)`);

    console.log('\n[3] 편집 탭 · 마커 모아 보기');
    await win.click('.menus button[data-menu="edit"]'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="rb-marker"].soon').count() === 0, '편집 탭의 마커 단추도 준비 중이 아니다');
    const lb = await win.locator('[data-testid="rb-marker-list"]').innerText();
    ok(/마커 목록 \(2\)/.test(lb.replace(/\s+/g, ' ')), '마커 목록 단추에 개수 (2) — ' + lb.replace(/\s+/g, ' '));
    await win.click('[data-testid="rb-marker-list"]'); await win.waitForSelector('[data-testid="marker-list"]', { timeout: 3000 });
    const items = await win.locator('[data-testid="marker-item"]').allInnerTexts();
    ok(items.length === 2 && /첫 문장은/.test(items[0]) && /둘째 문장/.test(items[1]), '목록 = 달린 2개(화면 순서 · 글 일부) ' + items.map((x) => x.replace(/\s+/g, ' ')).join(' | '));
    await win.locator('[data-testid="marker-item"]').nth(1).click(); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="marker-list"]').count() === 0, '항목을 누르면 목록이 닫힌다(그 클립으로 이동)');

    console.log('\n[4] Ctrl+Z');
    await win.keyboard.press('Control+z'); await win.waitForTimeout(900);
    const m3 = await mks();
    ok(m3[0] === 1 && m3[1] === 0, `되돌리기 → 마지막 마커 달기 취소 ${JSON.stringify(m3)}`);

    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally {
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  }
  console.log(fail ? `\n❌ marker-ui ${pass}/${pass + fail}` : `\n✅ marker-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
