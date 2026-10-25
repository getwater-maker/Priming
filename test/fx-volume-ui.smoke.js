'use strict';
/**
 * node test/fx-volume-ui.smoke.js — 🔉 효과 ④ 볼륨 조절 실제 화면 E2E
 *   우클릭 ▸ 효과 ▸ 볼륨 조절 → 패널(슬라이더) → 문장 s.vol(DTO vl) · 클립 배지 · 100% 로 · Ctrl+Z
 *   (구워지는 소리 실측은 test/fx-volume.test.js) · ⚠ 임시 채널 아님 · 생성 서버를 부르지 않는다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const TAG = `볼륨시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 볼륨 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');

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
    const vls = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts.flatMap((c) => c.sentences || []).map((s) => (s.vl == null ? null : s.vl)); });
    const select1 = async () => { await win.keyboard.press('Escape'); await win.locator('.sent[data-ln="1"] .clip-chk').first().click(); await win.waitForTimeout(250); };

    console.log('\n[1] 열기 — 우클릭 효과');
    await select1();
    await win.locator('.sent[data-ln="1"] .clip-r1').first().click({ button: 'right', position: { x: 4, y: 4 } });
    await win.waitForSelector('[data-testid="clip-ctx"]');
    await win.hover('[data-testid="cx-fx"]'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="cx-fx-volume"].soon').count() === 0 && await win.locator('[data-testid="cx-fx-volume"]').count() === 1, '효과 ▸ 볼륨 조절은 준비 중이 아니다');
    const sb = await win.locator('[data-testid="cx-fx"]').boundingBox(); const sub = await win.locator('[data-testid="cx-sub-fx"]').boundingBox();
    await win.mouse.move(sub.x + 8, sb.y + sb.height / 2); await win.waitForTimeout(100);
    await win.click('[data-testid="cx-fx-volume"]');
    await win.waitForSelector('[data-testid="vol-panel"]', { timeout: 3000 });
    ok(await win.locator('[data-testid="vol-v"]').innerText() === '100%', '패널이 열린다(처음 100%)');

    console.log('\n[2] 슬라이더 → 문장 vl · 배지');
    ok((await vls()).every((v) => v === null), '처음엔 볼륨 필드가 없다');
    await win.locator('[data-testid="vol-range"]').fill('50'); await win.waitForTimeout(1200);
    const v1 = await vls();
    ok(v1[0] === 0.5 && v1.slice(1).every((v) => v === null), `고른 문장(1번)만 vl=0.5 ${JSON.stringify(v1)}`);
    ok(await win.locator('[data-testid="clip-vol"]').count() === 1 && /50%/.test(await win.locator('[data-testid="clip-vol"]').first().innerText()), '클립에 🔉50% 배지');
    await win.locator('[data-testid="vol-range"]').fill('150'); await win.waitForTimeout(1200);
    ok((await vls())[0] === 1.5, '150% 로 바꾸면 vl=1.5');

    console.log('\n[3] 100% 로 · Ctrl+Z');
    await win.click('[data-testid="vol-reset"]'); await win.waitForTimeout(1200);
    ok((await vls()).every((v) => v === null) && await win.locator('[data-testid="clip-vol"]').count() === 0, '100% 로 → 필드 사라짐 · 배지 사라짐');
    await win.click('[data-testid="vol-close"]'); await win.keyboard.press('Control+z'); await win.waitForTimeout(1000);
    ok((await vls())[0] === 1.5, 'Ctrl+Z → 100% 직전(150%)으로');

    console.log('\n[4] 효과 탭 단추 · 새로 열어도 유지');
    await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }); await win.waitForTimeout(600);
    ok((await vls())[0] === 1.5, '새로고침(작업본 이어받기) 뒤에도 vl=1.5');
    await select1();
    await win.click('.menus button[data-menu="effect"]'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="rb-volume"]').count() === 1 && !(await win.locator('[data-testid="rb-volume"]').isDisabled()), '효과 탭에 「볼륨」 단추');
    await win.click('[data-testid="rb-volume"]'); await win.waitForSelector('[data-testid="vol-panel"]');
    ok(await win.locator('[data-testid="vol-v"]').innerText() === '150%', '패널이 현재 값(150%)으로 열린다');
    await win.click('[data-testid="vol-close"]');

    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally {
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  }
  console.log(fail ? `\n❌ fx-volume-ui ${pass}/${pass + fail}` : `\n✅ fx-volume-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
