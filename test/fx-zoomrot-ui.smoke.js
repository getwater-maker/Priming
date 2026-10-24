'use strict';
/**
 * node test/fx-zoomrot-ui.smoke.js — 🎛 효과 ① 확대 및 회전 실제 화면 E2E
 *   우클릭 ▸ 효과 ▸ 확대 및 회전 · 편집/효과 탭 단추 → 패널(확대·회전 슬라이더) → 그룹 look 에 저장 → ① 미리보기 transform
 *   (.vrew·MP4 가 같은 값을 읽는지는 test/fx-zoomrot.test.js 의 실제 왕복이 잰다) · 초기화 · Ctrl+Z
 *   ⚠ 임시 채널·임시 출력 폴더 — 생성 서버를 부르지 않는다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const TAG = `확대회전시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 확대회전 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fxzr-ui-'));
  const img = path.join(outDir, 'src.png');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:d=1', '-frames:v', '1', img]);
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
    const layerT = () => win.evaluate(() => { const e = document.querySelector('.vlayer'); return e ? e.getAttribute('style') : null; });
    const select1 = async () => { await win.keyboard.press('Escape'); await win.locator('.sent[data-ln="1"] .clip-chk').first().click(); await win.waitForTimeout(250); };

    console.log('\n[1] 열기 — 우클릭 효과 · 효과 탭');
    await select1();
    await win.locator('.sent[data-ln="1"] .clip-r1').first().click({ button: 'right', position: { x: 4, y: 4 } });
    await win.waitForSelector('[data-testid="clip-ctx"]');
    await win.hover('[data-testid="cx-fx"]'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="cx-fx-zoomrot"].soon').count() === 0 && await win.locator('[data-testid="cx-fx-zoomrot"]').count() === 1, '효과 ▸ 확대 및 회전은 준비 중이 아니다');
    const sb = await win.locator('[data-testid="cx-fx"]').boundingBox(); const sub = await win.locator('[data-testid="cx-sub-fx"]').boundingBox();
    await win.mouse.move(sub.x + 8, sb.y + sb.height / 2); await win.waitForTimeout(100);
    await win.click('[data-testid="cx-fx-zoomrot"]');
    await win.waitForSelector('[data-testid="zr-panel"]', { timeout: 3000 });
    ok(/G1/.test(await win.locator('[data-testid="zr-panel"]').innerText()), '패널이 열린다(대상 G1)');
    ok(await win.locator('[data-testid="zr-zoom-v"]').innerText() === '100%' && await win.locator('[data-testid="zr-rot-v"]').innerText() === '0°', '처음 값 100% · 0°');

    console.log('\n[2] 바꾸기 → 그룹 look · ① 미리보기');
    await win.fill('[data-testid="zr-zoom"]', '150'); await win.fill('[data-testid="zr-rot"]', '30');
    await win.waitForTimeout(1200);
    const l1 = await look();
    ok(l1 && l1.zoom === 150 && l1.rot === 30, `그룹 look 에 저장 ${JSON.stringify(l1)}`);
    ok(await win.locator('[data-testid="zr-zoom-v"]').innerText() === '150%' && await win.locator('[data-testid="zr-rot-v"]').innerText() === '30°', '패널 표시값');
    const st = await layerT();
    ok(st && /rotate\(30deg\) scale\(1\.5000\)/.test(st) && /transform-origin:\s*center/.test(st), '🔑 ① 미리보기 그림 칸 transform = rotate(30deg) scale(1.5) — 빌더·렌더러와 같은 값 ' + st);
    ok(await win.locator('.vlayer img.kbnone').count() === 1, '회전하면 미리보기 켄번스도 꺼진다(.vrew·MP4 와 같다)');

    console.log('\n[3] 초기화 · Ctrl+Z');
    await win.click('[data-testid="zr-reset"]'); await win.waitForTimeout(1200);
    const l2 = await look();
    ok(!l2 || (!l2.zoom && !l2.rot), '초기화 → 효과 필드 없음(그룹 look 이 기본이면 아예 없다)');
    ok(!(await layerT() || '').includes('transform:'), '미리보기 transform 사라짐');
    await win.click('[data-testid="zr-close"]'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="zr-panel"]').count() === 0, '닫기');
    await win.keyboard.press('Control+z'); await win.waitForTimeout(1000);
    const l3 = await look();
    ok(l3 && l3.zoom === 150 && l3.rot === 30, 'Ctrl+Z → 초기화 직전(150%·30°)으로');

    console.log('\n[4] 편집·효과 탭 단추');
    await select1();
    await win.click('.menus button[data-menu="effect"]'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="rb-zoomrot"]').count() === 1 && !(await win.locator('[data-testid="rb-zoomrot"]').isDisabled()), '효과 탭에 「확대·회전」 단추(클립을 고르면 켜짐)');
    await win.click('[data-testid="rb-zoomrot"]'); await win.waitForSelector('[data-testid="zr-panel"]');
    ok(await win.locator('[data-testid="zr-zoom-v"]').innerText() === '150%', '그룹의 지금 값(150%)으로 열린다');
    await win.click('[data-testid="zr-close"]');

    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally {
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(fail ? `\n❌ fx-zoomrot-ui ${pass}/${pass + fail}` : `\n✅ fx-zoomrot-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
