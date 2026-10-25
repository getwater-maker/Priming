'use strict';
/**
 * node test/fx-bg-ui.smoke.js — ✳ 효과 ③ 필터 실제 화면 E2E
 *   우클릭 ▸ 효과 ▸ 필터 → 패널(프리셋 9종·없음) → 그룹 look.filter → ① 미리보기 그림 요소 CSS filter
 *   (.vrew·MP4 가 같은 색을 굽는지는 test/fx-filter.test.js · CSS↔ffmpeg 일치는 test/fx-filter.smoke.js) · 없음 · Ctrl+Z
 *   ⚠ 임시 채널 아님(대본만 연다) · 생성 서버를 부르지 않는다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const TAG = `필터시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 필터 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fxflt-ui-'));
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
    const imgFilter = () => win.evaluate(() => { const e = document.querySelector('.vlayer img'); return e ? getComputedStyle(e).filter : null; });
    const select1 = async () => { await win.keyboard.press('Escape'); await win.locator('.sent[data-ln="1"] .clip-chk').first().click(); await win.waitForTimeout(250); };

    console.log('\n[1] 열기 — 우클릭 효과');
    await select1();
    await win.locator('.sent[data-ln="1"] .clip-r1').first().click({ button: 'right', position: { x: 4, y: 4 } });
    await win.waitForSelector('[data-testid="clip-ctx"]');
    await win.hover('[data-testid="cx-fx"]'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="cx-fx-filter"].soon').count() === 0 && await win.locator('[data-testid="cx-fx-filter"]').count() === 1, '효과 ▸ 필터는 준비 중이 아니다');
    const sb = await win.locator('[data-testid="cx-fx"]').boundingBox(); const sub = await win.locator('[data-testid="cx-sub-fx"]').boundingBox();
    await win.mouse.move(sub.x + 8, sb.y + sb.height / 2); await win.waitForTimeout(100);
    await win.click('[data-testid="cx-fx-filter"]');
    await win.waitForSelector('[data-testid="fl-panel"]', { timeout: 3000 });
    ok(/G1/.test(await win.locator('[data-testid="fl-panel"]').innerText()) && await win.locator('.fl-item').count() === 10, '패널이 열린다(대상 G1 · 없음 + 9종)');
    ok(await win.locator('[data-testid="fl-none"].on').count() === 1, '처음엔 「없음」이 켜져 있다');
    ok((await imgFilter()) === 'none', '처음 미리보기 그림 요소엔 필터 없음');

    console.log('\n[2] 프리셋 → 그룹 look · ① 미리보기');
    await win.click('[data-testid="fl-bw"]'); await win.waitForTimeout(1200);
    ok(((await look()) || {}).filter === 'bw', '그룹 look.filter = bw');
    ok((await imgFilter()) === 'grayscale(1)', '🔑 ① 미리보기 그림 요소 filter = grayscale(1) — 빌더가 굽는 식과 같은 표');
    ok(await win.locator('[data-testid="fl-bw"].on').count() === 1, '고른 프리셋 표시');
    await win.click('[data-testid="fl-vintage"]'); await win.waitForTimeout(1200);
    ok(((await look()) || {}).filter === 'vintage' && (await imgFilter()) === 'sepia(0.4) saturate(0.85) brightness(1.05) contrast(0.9)', '빈티지 = 여러 함수가 CSS 와 같은 순서로');

    console.log('\n[3] 없음 · Ctrl+Z');
    await win.click('[data-testid="fl-none"]'); await win.waitForTimeout(1200);
    const l2 = await look();
    ok(!l2 || !l2.filter, '없음 → 그룹 look 에서 사라짐');
    ok((await imgFilter()) === 'none', '미리보기 필터 사라짐');
    await win.click('[data-testid="fl-close"]'); await win.keyboard.press('Control+z'); await win.waitForTimeout(1000);
    ok(((await look()) || {}).filter === 'vintage', 'Ctrl+Z → 없음 직전(빈티지)으로');

    console.log('\n[4] 효과 탭 · 배경색과 함께');
    await select1();
    await win.click('.menus button[data-menu="effect"]'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="rb-filter"]').count() === 1 && !(await win.locator('[data-testid="rb-filter"]').isDisabled()), '효과 탭에 「필터」 단추');
    await win.evaluate(async () => window.api.setGroupLook({ shortsNum: 1, groupNum: 1, patch: { bg: '#00ff00', filter: 'bw' } }));
    await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }); await win.waitForTimeout(600);
    const both = await win.evaluate(() => { const e = document.querySelector('.vlayer img'); const c = getComputedStyle(e); return { f: c.filter, b: c.backgroundColor }; });
    ok(both.f === 'grayscale(1)' && both.b === 'rgb(0, 255, 0)', '🔑 배경색 + 필터가 같은 그림 요소에 — 띠(배경)도 함께 필터(빌더의 굽기 순서와 같다) ' + JSON.stringify(both));

    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally {
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(fail ? `\n❌ fx-filter-ui ${pass}/${pass + fail}` : `\n✅ fx-filter-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
