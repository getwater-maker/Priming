'use strict';
/**
 * node test/overlay-ui.smoke.js — 🏷 채널 로고 · 🔝 위층 그림·영상 — 실제 앱 E2E (v0.5.52)
 *   임시 채널(출력 = 임시 폴더 · 로고 켜기)과 임시 대본을 쓴다 — 사용자 작업물은 건드리지 않는다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const FF = require('../core/media-utils').getFfmpegPath();

const ROOT = path.join(__dirname, '..');
const TAG = `__위층테스트_${process.pid}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ovui-'));
const MD = path.join(TMP, `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const CH = '__테스트채널_삭제해도됨_위층_' + process.pid;
const SCRIPT = ['# 위층 테스트', '', '## 1장', '### 하나', '> 🖼️ 이미지: a', '첫째 문장입니다.', '', '### 둘', '> 🖼️ 이미지: b', '둘째 문장입니다.', '', '### 셋', '> 🖼️ 이미지: c', '셋째 문장입니다.', ''].join('\n');
const img = (n, c, s = '1920x1080') => { const f = path.join(TMP, n + '.png'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=${s}`, '-frames:v', '1', f]); return f; };

let pass = 0, fail = 0, chMade = false;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

(async () => {
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const LOGO = img('logo', 'green', '300x150');
  const BLUE = img('blue', 'blue');
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1600, 950); });
    await win.evaluate(async ({ name, dir, logo }) => {
      const ps = (await window.api.listPresets()) || [];
      for (const p of ps) if (p.name.indexOf('__테스트채널_삭제해도됨_위층_') === 0) { try { await window.api.removePreset({ name: p.name }); } catch (_) {} }
      await window.api.addPreset({ name });
      await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, logoOn: true, logoPath: logo, logoSide: 'left', logoSize: 15 } });
    }, { name: CH, dir: TMP, logo: LOGO });
    chMade = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((n) => [...document.querySelectorAll('select option')].some((o) => o.value === n), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await win.waitForTimeout(800);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.ribbon button:has-text("열기")');
    await win.waitForSelector('.sblk[data-ord]', { timeout: 20000 });
    const key = async (k) => { await win.click('[data-testid=clipbar]', { position: { x: 5, y: 5 } }); await win.keyboard.press(k); };

    console.log('[1] 🏷 채널 로고 — ① 칸 미리보기');
    await win.waitForSelector('[data-testid=stage-logo]', { timeout: 5000 }).catch(() => {});
    const lg = await win.evaluate(() => { const l = document.querySelector('[data-testid=stage-logo]'); const st = document.querySelector('#stage'); if (!l || !st) return null; const a = l.getBoundingClientRect(), b = st.getBoundingClientRect(); return { x: (a.left - b.left) / b.width, w: a.width / b.width, y: (a.top - b.top) / b.height, h: a.height, nat: l.naturalWidth }; });
    ok(lg && lg.nat > 0, '로고가 ① 칸에 보인다');
    ok(lg && Math.abs(lg.x - 0.025) < 0.01 && Math.abs(lg.w - 0.15) < 0.01, `왼쪽 위 · 너비 15% (x ${lg && lg.x.toFixed(3)} · w ${lg && lg.w.toFixed(3)})`);

    console.log('\n[2] 🔝 위층 — 그림 메뉴에서 올리기');
    await win.locator('.cut').nth(0).locator('.thumb').first().click();
    const items = await win.locator('[data-testid=vr-menu] button').allInnerTexts();
    ok(items.some((t) => t.includes('위층에 그림·영상 올리기')), '그림 메뉴에 「🔝 위층에 그림·영상 올리기」');
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, BLUE);
    await win.click('[data-testid=vr-menu] button:has-text("위층에")');
    await win.waitForSelector('.name-ask-layer input', { timeout: 3000 });
    await win.fill('.name-ask-layer input', '1-2');
    await win.click('.name-ask-layer button:has-text("확인")');
    await win.waitForSelector('[data-testid=ovchip]', { timeout: 5000 }).catch(() => {});
    const chip = async () => (await win.locator('[data-testid=ovchip]').count()) ? win.locator('[data-testid=ovchip]').first().innerText() : '';
    ok((await chip()).includes('G1~G2'), `위층 목록에 G1~G2 — 「${(await chip()).replace(/\n/g, ' ')}」`);
    const copied = fs.existsSync(path.join(TMP, TAG, 'media-1', 'overlays')) && fs.readdirSync(path.join(TMP, TAG, 'media-1', 'overlays')).length === 1;
    ok(copied, '파일은 작업 폴더(media-1/overlays)로 복사');

    const ovOnStage = () => win.evaluate(() => !!document.querySelector('#stageVisual .vlayer[data-num^="O"]'));
    await key('Home'); await win.waitForTimeout(300);
    ok(await ovOnStage(), 'G1 에서 ① 칸에 위층이 보인다');
    ok(await win.evaluate(() => { const v = [...document.querySelectorAll('#stageVisual .vlayer')]; return v.length && v[v.length - 1].dataset.num[0] === 'O'; }), '위층이 맨 위(마지막 레이어)');
    await key('End'); await win.waitForTimeout(300);
    ok(!(await ovOnStage()), 'G3 에는 위층이 없다');

    console.log('\n[3] ① 칸에서 옮기기 · ↶');
    await key('Home'); await win.waitForTimeout(300);
    const R = await win.locator('#stageVisual').boundingBox();
    // 모서리를 끌어 줄인다(오른쪽 아래 손잡이) — 먼저 눌러 고른다
    await win.mouse.click(R.x + R.width * 0.5, R.y + R.height * 0.5);
    await win.waitForSelector('[data-testid=stage-sel]', { timeout: 3000 }).catch(() => {});
    ok((await win.locator('[data-testid=stage-sel] .ssel-tag').innerText().catch(() => '')).includes('위층'), '누르면 위층이 선택된다(맨 위부터)');
    const br = await win.locator('[data-testid=stage-sel] .ssel-h.br').boundingBox();
    await win.mouse.move(br.x + br.width / 2, br.y + br.height / 2); await win.mouse.down();
    await win.mouse.move(R.x + R.width * 0.6, R.y + R.height * 0.6, { steps: 8 }); await win.mouse.up();
    await win.waitForFunction(() => [...document.querySelectorAll('[data-testid=ovchip] button')].some((b) => b.title.includes('화면 가득')), null, { timeout: 5000 }).catch(() => {});
    const w1 = await win.evaluate(() => { const v = document.querySelector('#stageVisual .vlayer[data-num^="O"]'); return v ? v.getBoundingClientRect().width / document.querySelector('#stageVisual').getBoundingClientRect().width : 0; });
    ok(w1 > 0.5 && w1 < 0.7, `크기를 줄이면 저장된다(너비 ${(w1 * 100).toFixed(0)}%)`);
    await key('Control+z');
    await win.waitForFunction(() => ![...document.querySelectorAll('[data-testid=ovchip] button')].some((b) => b.title.includes('화면 가득')), null, { timeout: 5000 }).catch(() => {});
    const w2 = await win.evaluate(() => { const v = document.querySelector('#stageVisual .vlayer[data-num^="O"]'); return v ? v.getBoundingClientRect().width / document.querySelector('#stageVisual').getBoundingClientRect().width : 0; });
    ok(w2 > 0.98, `↶ 되돌리면 화면 가득 (${(w2 * 100).toFixed(0)}%)`);

    console.log('\n[4] 범위 · 지우기 · ↶');
    await win.locator('[data-testid=ovchip] button:has-text("범위")').click();
    await win.waitForSelector('.name-ask-layer input', { timeout: 3000 });
    await win.fill('.name-ask-layer input', '2-3');
    await win.click('.name-ask-layer button:has-text("확인")');
    await win.waitForFunction(() => (document.querySelector('[data-testid=ovchip]') || {}).innerText.includes('G2~G3'), null, { timeout: 5000 }).catch(() => {});
    ok((await chip()).includes('G2~G3'), '범위 → G2~G3');
    await key('Home'); await win.waitForTimeout(300);
    ok(!(await ovOnStage()), 'G1 에는 이제 없다');
    await win.locator('[data-testid=ovchip] button[title^="위층 지우기"]').click();
    await win.waitForFunction(() => !document.querySelector('[data-testid=ovchip]'), null, { timeout: 5000 }).catch(() => {});
    ok(await win.locator('[data-testid=ovchip]').count() === 0, '✕ 지우기');
    await key('Control+z');
    await win.waitForSelector('[data-testid=ovchip]', { timeout: 5000 }).catch(() => {});
    ok((await chip()).includes('G2~G3'), '↶ 지운 위층이 돌아온다');

    console.log('\n[4b] 리본 「이미지」 메뉴의 🔝 위층 버튼');
    await key('End'); await win.waitForTimeout(300);
    await win.locator('.menubar button:text-is("이미지")').first().click();
    ok(await win.locator('[data-testid=ov-add]').count() === 1, '이미지 메뉴 리본에 「🔝 위층」');
    await win.locator('[data-testid=ov-add]').click();
    await win.waitForSelector('.name-ask-layer input', { timeout: 3000 });
    ok((await win.inputValue('.name-ask-layer input')) === '3-3', `커서가 있는 그룹(G3)부터 — 기본값 ${await win.inputValue('.name-ask-layer input')}`);
    await win.keyboard.press('Escape');
    await win.waitForFunction(() => !document.querySelector('.name-ask-layer input'), null, { timeout: 3000 }).catch(() => {});
    await win.locator('.menubar button:text-is("비디오")').first().click();
    ok(await win.locator('[data-testid=ov-add-v]').count() === 1, '비디오 메뉴 리본에도');
    await win.locator('.menubar button:text-is("대본·음성")').first().click();

    console.log('\n[5] 채널편집 — 🏷 채널 로고 칸');
    await win.click('button[title^="채널(프리셋)"]');
    await win.waitForSelector('.modal-card.tabbed', { timeout: 8000 });
    await win.locator('.modal-card.tabbed button:has-text("📁 폴더")').first().click();
    const row = win.locator('[data-testid=logo-row]');
    ok(await row.count() === 1, '📁 폴더 탭에 「🏷 채널 로고」');
    ok(await row.locator('select').inputValue() === 'left' && (await row.locator('input.nbox').inputValue()) === '15', '저장된 값(왼쪽 · 15%)이 채워진다');
    await win.keyboard.press('Escape');
    ok(errors.length === 0, `화면 오류 0 ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
  } catch (e) {
    fail++; console.log('  ✗ 예외: ' + e.message);
  } finally {
    if (chMade) { try { await (await app.firstWindow()).evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    await app.close().catch(() => {});
    for (const f of [SNAP]) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 위층·로고 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
