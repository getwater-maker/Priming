'use strict';
/**
 * node test/fx-bg-ui.smoke.js — 🎨 효과 ② 클립 배경색 실제 화면 E2E
 *   우클릭 ▸ 효과 ▸ 클립 배경색 → 패널(색 고르기·견본·없음) → 그룹 look.bg → ① 미리보기 그림 요소 background-color
 *   (.vrew·MP4 가 같은 색을 굽는지는 test/fx-bg.test.js 의 실제 왕복이 잰다) · 직접 옮긴 자리가 있으면 안내 + 미리보기에서도 안 칠한다 · Ctrl+Z
 *   ⚠ 임시 채널 아님(대본만 연다) · 생성 서버를 부르지 않는다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const TAG = `배경색시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 배경색 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fxbg-ui-'));
  const img = path.join(outDir, 'src.png');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1200x900:d=1', '-frames:v', '1', img]);   // 4:3 — 16:9 에서 맞추기 = 띠
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
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, img);
    await win.evaluate(async () => window.api.attachAsset({ shortsNum: 1, groupNum: 1 }));
    await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }); await win.waitForTimeout(600);
    const look = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts[0].look || null; });
    const imgBg = () => win.evaluate(() => { const e = document.querySelector('.vlayer img'); return e ? getComputedStyle(e).backgroundColor : null; });
    const select1 = async () => { await win.keyboard.press('Escape'); await win.locator('.sent[data-ln="1"] .clip-chk').first().click(); await win.waitForTimeout(250); };

    console.log('\n[1] 열기 — 우클릭 효과');
    await select1();
    await win.locator('.sent[data-ln="1"] .clip-r1').first().click({ button: 'right', position: { x: 4, y: 4 } });
    await win.waitForSelector('[data-testid="clip-ctx"]');
    await win.hover('[data-testid="cx-fx"]'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="cx-fx-bg"].soon').count() === 0 && await win.locator('[data-testid="cx-fx-bg"]').count() === 1, '효과 ▸ 클립 배경색은 준비 중이 아니다');
    const sb = await win.locator('[data-testid="cx-fx"]').boundingBox(); const sub = await win.locator('[data-testid="cx-sub-fx"]').boundingBox();
    await win.mouse.move(sub.x + 8, sb.y + sb.height / 2); await win.waitForTimeout(100);
    await win.click('[data-testid="cx-fx-bg"]');
    await win.waitForSelector('[data-testid="bg-panel"]', { timeout: 3000 });
    ok(/G1/.test(await win.locator('[data-testid="bg-panel"]').innerText()) && await win.locator('[data-testid="bg-color-v"]').innerText() === '없음', '패널이 열린다(대상 G1 · 처음엔 없음)');
    ok(await win.locator('[data-testid="bg-note-box"]').count() === 0, '직접 옮긴 자리가 없으면 경고 없음');

    console.log('\n[2] 색 고르기 → 그룹 look · ① 미리보기');
    ok((await imgBg()) === 'rgba(0, 0, 0, 0)', '처음 미리보기 그림 요소엔 배경 없음');
    await win.fill('[data-testid="bg-color"]', '#00ff00'); await win.waitForTimeout(1200);
    const l1 = await look();
    ok(l1 && l1.bg === '#00ff00', `그룹 look.bg 저장 ${JSON.stringify(l1)}`);
    ok((await imgBg()) === 'rgb(0, 255, 0)', '🔑 ① 미리보기 그림 요소 background-color = 초록 — .vrew·MP4 의 띠와 같은 색');
    await win.locator('[data-testid="bg-sw"]').nth(1).click(); await win.waitForTimeout(1200);
    ok((await look()).bg === '#ffffff' && (await imgBg()) === 'rgb(255, 255, 255)', '견본(흰색) 누르기');

    console.log('\n[3] 없음 · Ctrl+Z');
    await win.click('[data-testid="bg-clear"]'); await win.waitForTimeout(1200);
    const l2 = await look();
    ok(!l2 || !l2.bg, '없음 → 그룹 look 에서 사라짐');
    ok((await imgBg()) === 'rgba(0, 0, 0, 0)', '미리보기 배경 사라짐');
    await win.click('[data-testid="bg-close"]'); await win.keyboard.press('Control+z'); await win.waitForTimeout(1000);
    ok((await look() || {}).bg === '#ffffff', 'Ctrl+Z → 없음 직전(흰색)으로');

    console.log('\n[4] 직접 옮긴 자리가 있으면 쓰이지 않는다');
    await win.evaluate(async () => window.api.setGroupLook({ shortsNum: 1, groupNum: 1, patch: { box: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } } }));
    await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }); await win.waitForTimeout(600);
    ok((await look()).bg === '#ffffff' && !!(await look()).box, '배경색(흰색)과 박스가 함께 저장돼 있다');
    ok((await imgBg()) === 'rgba(0, 0, 0, 0)', '🔑 미리보기에서도 칠하지 않는다(.vrew·MP4 처럼 박스가 이긴다)');
    await select1();
    await win.click('.menus button[data-menu="effect"]'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="rb-bg"]').count() === 1 && !(await win.locator('[data-testid="rb-bg"]').isDisabled()), '효과 탭에 「배경색」 단추');
    await win.click('[data-testid="rb-bg"]'); await win.waitForSelector('[data-testid="bg-panel"]');
    ok(await win.locator('[data-testid="bg-note-box"]').count() === 1, '패널에 「자리를 옮긴 그림은 안 쓰입니다」 안내');
    await win.click('[data-testid="bg-close"]');

    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally {
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(fail ? `\n❌ fx-bg-ui ${pass}/${pass + fail}` : `\n✅ fx-bg-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
