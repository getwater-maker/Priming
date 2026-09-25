'use strict';
/**
 * node test/overlay-ui.smoke.js — ➕ 삽입 메뉴(그림·영상·오디오 · 적용 범위) · 🏷 로고 위치 — 실제 앱 E2E (v0.5.54)
 *   임시 채널(출력 = 임시 폴더 · 로고 켜기)과 임시 대본을 쓴다 — 사용자 작업물은 건드리지 않는다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const FF = require('../core/media-utils').getFfmpegPath();

const ROOT = path.join(__dirname, '..');
const TAG = `__삽입테스트_${process.pid}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ovui-'));
const MD = path.join(TMP, `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const CH = '__테스트채널_삭제해도됨_위층_' + process.pid;
const SCRIPT = ['# 삽입 테스트', '', '## 1장', '### 하나', '> 🖼️ 이미지: a', '첫째 문장입니다.', '', '### 둘', '> 🖼️ 이미지: b', '둘째 문장입니다.', '', '### 셋', '> 🖼️ 이미지: c', '셋째 문장입니다.', ''].join('\n');
const img = (n, c, s = '1920x1080') => { const f = path.join(TMP, n + '.png'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=${s}`, '-frames:v', '1', f]); return f; };

let pass = 0, fail = 0, chMade = false;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

(async () => {
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const LOGO = img('logo', 'green', '300x150');
  const BLUE = img('blue', 'blue');
  const TONE = path.join(TMP, 'tone.wav');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=1', TONE]);
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const stub = (p) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, p);
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
      await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, logoOn: true, logoPath: logo, logoSize: 15 } });
    }, { name: CH, dir: TMP, logo: LOGO });
    chMade = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((n) => [...document.querySelectorAll('select option')].some((o) => o.value === n), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await win.waitForTimeout(800);
    await stub(MD);
    await win.click('.ribbon button:has-text("열기")');
    await win.waitForSelector('.sblk[data-ord]', { timeout: 20000 });
    const key = async (k) => { await win.click('[data-testid=clipbar]', { position: { x: 5, y: 5 } }); await win.keyboard.press(k); };
    const menu = async (t) => win.locator(`.menubar button:text-is("${t}")`).first().click();

    console.log('[1] 메뉴 — 「삽입」이 서식 옆에 · 이미지 메뉴에는 없다');
    const menus = await win.locator('.menubar button').allInnerTexts();
    const fi = menus.findIndex((t) => t.trim() === '서식');
    ok(fi >= 0 && menus[fi + 1] && menus[fi + 1].trim() === '삽입', `메뉴 순서: …서식 · 삽입 (${menus.map((t) => t.trim()).join(' / ')})`);
    await menu('이미지');
    ok(!(await win.locator('.ribbon').innerText()).includes('위층'), '이미지 메뉴 리본에 위층 버튼이 없다');
    await win.locator('.cut').nth(0).locator('.thumb').first().click();
    ok(!(await win.locator('[data-testid=vr-menu]').innerText()).includes('위층'), '썸네일 메뉴에도 없다');
    await win.keyboard.press('Escape'); await win.mouse.click(5, 900);

    console.log('\n[2] 🏷 로고 — 채널 로고가 기본 오른쪽 위 · 삽입 메뉴에서 이 대본만 왼쪽으로');
    const logoPos = () => win.evaluate(() => { const l = document.querySelector('[data-testid=stage-logo]'); const st = document.querySelector('#stage'); if (!l || !st) return null; const a = l.getBoundingClientRect(), b = st.getBoundingClientRect(); return { x: (a.left - b.left) / b.width, w: a.width / b.width }; });
    await win.waitForSelector('[data-testid=stage-logo]', { timeout: 5000 }).catch(() => {});
    let lg = await logoPos();
    ok(lg && Math.abs(lg.x + lg.w - 0.975) < 0.01 && Math.abs(lg.w - 0.15) < 0.01, `기본 = 오른쪽 위 · 너비 15% (x ${lg && lg.x.toFixed(3)})`);
    await menu('삽입');
    ok(await win.locator('[data-testid=ins-ribbon]').count() === 1, '삽입 리본');
    ok((await win.locator('[data-testid=logo-side]').inputValue()) === 'right', '로고 위치 선택칸 기본 = 오른쪽 위');
    await win.selectOption('[data-testid=logo-side]', 'left');
    await win.waitForFunction(() => { const l = document.querySelector('[data-testid=stage-logo]'); const st = document.querySelector('#stage'); return l && st && (l.getBoundingClientRect().left - st.getBoundingClientRect().left) / st.getBoundingClientRect().width < 0.05; }, null, { timeout: 5000 }).catch(() => {});
    lg = await logoPos();
    ok(lg && Math.abs(lg.x - 0.025) < 0.01, `왼쪽 위로 (x ${lg && lg.x.toFixed(3)})`);
    await key('Control+z');
    await win.waitForTimeout(500);
    ok((await win.locator('[data-testid=logo-side]').inputValue()) === 'right', '↶ 되돌리면 오른쪽 위');

    console.log('\n[3] ➕ 이미지 삽입 → 적용 범위 메뉴(Vrew 식)');
    await key('Home'); await win.waitForTimeout(200);
    await key('ArrowDown'); await win.waitForTimeout(200);   // 현재 클립 = 2
    await menu('삽입');
    await stub(BLUE);
    await win.click('[data-testid=ins-image]');
    await win.waitForSelector('[data-testid=ins-menu]', { timeout: 5000 }).catch(() => {});
    const mt = await win.locator('[data-testid=ins-menu]').innerText().catch(() => '');
    ok(['전체 클립으로', '처음부터 현재 클립까지', '현재 클립부터 끝까지', '직접 입력'].every((t) => mt.includes(t)), '넣자마자 적용 범위 메뉴(전체 · 처음부터 현재 · 현재부터 끝 · 직접 입력)');
    ok(mt.includes('지금: 전체') && mt.includes('현재 클립 2'), '기본 = 전체 · 현재 클립 = 2');
    await win.click('[data-testid=ins-menu] button:has-text("처음부터 현재 클립까지")');
    await win.waitForFunction(() => (document.querySelector('[data-testid=ov-range]') || {}).innerText.includes('1~2'), null, { timeout: 5000 }).catch(() => {});
    const chip = async (i = 0) => (await win.locator('[data-testid=ovchip]').count()) > i ? win.locator('[data-testid=ovchip]').nth(i).innerText() : '';
    ok((await chip()).includes('blue.png') && (await chip()).includes('클립 1~2'), `목록: blue.png · 클립 1~2 — 「${(await chip()).replace(/\n/g, ' ')}」`);
    const ovOnStage = () => win.evaluate(() => !!document.querySelector('#stageVisual .vlayer[data-num^="O"]'));
    await key('Home'); await win.waitForTimeout(300);
    ok(await ovOnStage(), '클립 1: ① 칸 맨 위에 그림');
    await key('End'); await win.waitForTimeout(300);
    ok(!(await ovOnStage()), '클립 3: 없다');
    // 현재 클립부터 끝까지
    await win.locator('[data-testid=ov-range]').first().click();
    await win.click('[data-testid=ins-menu] button:has-text("현재 클립부터 끝까지")');
    await win.waitForFunction(() => (document.querySelector('[data-testid=ov-range]') || {}).innerText.includes('3~3'), null, { timeout: 5000 }).catch(() => {});
    ok((await chip()).includes('클립 3~3'), '현재 클립(3)부터 끝까지 → 클립 3~3');
    // 직접 입력
    await win.locator('[data-testid=ov-range]').first().click();
    await win.click('[data-testid=ins-menu] button:has-text("직접 입력")');
    await win.waitForSelector('.name-ask-layer input', { timeout: 3000 });
    await win.fill('.name-ask-layer input', '2-3');
    await win.click('.name-ask-layer button:has-text("확인")');
    await win.waitForFunction(() => (document.querySelector('[data-testid=ov-range]') || {}).innerText.includes('2~3'), null, { timeout: 5000 }).catch(() => {});
    ok((await chip()).includes('클립 2~3'), '직접 입력 2-3');
    // 전체
    await win.locator('[data-testid=ov-range]').first().click();
    await win.click('[data-testid=ins-menu] button:has-text("전체 클립으로")');
    await win.waitForFunction(() => (document.querySelector('[data-testid=ov-range]') || {}).innerText.includes('전체'), null, { timeout: 5000 }).catch(() => {});
    ok((await chip()).includes('전체'), '전체 클립으로');

    console.log('\n[4] ① 칸에서 크기 · ↶');
    await key('Home'); await win.waitForTimeout(300);
    const R = await win.locator('#stageVisual').boundingBox();
    await win.mouse.click(R.x + R.width * 0.5, R.y + R.height * 0.5);
    await win.waitForSelector('[data-testid=stage-sel]', { timeout: 3000 }).catch(() => {});
    ok((await win.locator('[data-testid=stage-sel] .ssel-tag').innerText().catch(() => '')).includes('삽입'), '누르면 삽입 그림이 선택된다(맨 위부터)');
    const br = await win.locator('[data-testid=stage-sel] .ssel-h.br').boundingBox();
    await win.mouse.move(br.x + br.width / 2, br.y + br.height / 2); await win.mouse.down();
    await win.mouse.move(R.x + R.width * 0.6, R.y + R.height * 0.6, { steps: 8 }); await win.mouse.up();
    const wOf = () => win.evaluate(() => { const v = document.querySelector('#stageVisual .vlayer[data-num^="O"]'); return v ? v.getBoundingClientRect().width / document.querySelector('#stageVisual').getBoundingClientRect().width : 0; });
    await win.waitForTimeout(600);
    const w1 = await wOf();
    ok(w1 > 0.5 && w1 < 0.7, `모서리로 줄인 크기 저장(너비 ${(w1 * 100).toFixed(0)}%)`);
    await key('Control+z'); await win.waitForTimeout(600);
    ok((await wOf()) > 0.98, '↶ 화면 가득으로');

    console.log('\n[5] 🎵 오디오 삽입 · 음량');
    await menu('삽입');
    await stub(TONE);
    await win.click('[data-testid=ins-audio]');
    await win.waitForSelector('[data-testid=ins-menu]', { timeout: 5000 }).catch(() => {});
    await win.click('[data-testid=ins-menu] button:has-text("전체 클립으로")');
    await win.waitForFunction(() => document.querySelectorAll('[data-testid=ovchip]').length === 2, null, { timeout: 5000 }).catch(() => {});
    ok((await chip(1)).includes('tone.wav') && (await win.locator('[data-testid=ov-vol]').count()) === 1, '오디오가 목록에 · 음량 칸');
    ok((await win.locator('[data-testid=ov-vol]').inputValue()) === '30', '음량 기본 30%');
    await win.fill('[data-testid=ov-vol]', '60');
    await win.waitForTimeout(600);
    ok((await win.locator('[data-testid=ov-vol]').inputValue()) === '60', '음량 60%');
    ok(await win.evaluate(() => !document.querySelector('#stageVisual .vlayer[data-num^="O"] audio')), '① 칸에는 오디오가 그림으로 나오지 않는다');
    // ② 칸 표시 — 삽입이 시작하는 클립(1)에 그림 썸네일 + 🎵
    await menu('대본·음성');
    const marks = await win.evaluate(() => [...document.querySelectorAll('.sent[data-ln="1"] [data-testid=ins-mark]')].map((b) => b.dataset.kind));
    ok(marks.includes('image') && marks.includes('audio'), `② 칸 클립 1 에 삽입 표시 (${marks.join(', ')})`);
    ok(await win.evaluate(() => !document.querySelector('.sent[data-ln="2"] [data-testid=ins-mark]')), '다른 클립에는 없다(시작 클립에만)');
    ok(await win.evaluate(() => !!document.querySelector('.sent[data-ln="1"] img') && [...document.querySelectorAll('.sent[data-ln="1"] [data-testid=ins-mark]')].some((b) => b.title.includes('tone.wav'))), '그림은 썸네일 · 오디오는 이름이 툴팁에');
    // 표시를 누르면 메뉴 → 🗑 삭제
    await win.locator('.sent[data-ln="1"] [data-testid=ins-mark][data-kind=audio]').click();
    await win.waitForSelector('[data-testid=ins-menu]', { timeout: 3000 }).catch(() => {});
    ok((await win.locator('[data-testid=ins-menu]').innerText()).includes('tone.wav'), '표시를 누르면 그 삽입의 메뉴');
    await win.click('[data-testid=ins-del]');
    await win.waitForFunction(() => document.querySelectorAll('[data-testid=ovchip]').length === 1, null, { timeout: 5000 }).catch(() => {});
    ok(await win.locator('[data-testid=ovchip]').count() === 1, '🗑 삭제 — 목록에서 사라진다');
    ok(await win.evaluate(() => ![...document.querySelectorAll('[data-testid=ins-mark]')].some((b) => b.dataset.kind === 'audio')), '② 칸 표시도 사라진다');
    await key('Control+z');
    await win.waitForFunction(() => document.querySelectorAll('[data-testid=ovchip]').length === 2, null, { timeout: 5000 }).catch(() => {});
    ok(await win.locator('[data-testid=ovchip]').count() === 2, '↶ 되돌아온다');
    // 목록의 🗑
    await win.locator('[data-testid=ovchip]').nth(1).locator('[data-testid=ov-del]').click();
    await win.waitForFunction(() => document.querySelectorAll('[data-testid=ovchip]').length === 1, null, { timeout: 5000 }).catch(() => {});
    ok(await win.locator('[data-testid=ovchip]').count() === 1, '목록의 🗑 도 삭제');

    console.log('\n[5b] 🎵 채널 배경음악 — 삽입 메뉴');
    await menu('삽입');
    await stub(TONE);
    await win.click('[data-testid=bgm-file]');
    await win.waitForFunction(() => (document.querySelector('[data-testid=bgm-file]') || {}).innerText === 'tone.wav', null, { timeout: 5000 }).catch(() => {});
    ok(await win.locator('[data-testid=bgm-on]').isChecked() && (await win.locator('[data-testid=bgm-file]').innerText()) === 'tone.wav', '파일을 고르면 켜진다');
    await win.fill('[data-testid=bgm-vol]', '25');
    await win.waitForTimeout(800);
    const pd = await win.evaluate(async (n) => { const p = await window.api.getPresetDetail(n); return { on: p.bgmOn, path: p.bgmPath, vol: p.bgmVolume }; }, CH);
    ok(pd.on === true && /tone\.wav$/.test(pd.path) && Number(pd.vol) === 25, `채널에 저장 (${JSON.stringify(pd)})`);
    const rh = async () => (await win.locator('.ribbon').boundingBox()).height;
    const hIns = await rh();
    const ovf = await win.evaluate(() => { const r = document.querySelector('.ribbon'); return r.scrollWidth - r.clientWidth; });
    await menu('서식'); const hFmt = await rh();
    ok(Math.abs(hIns - hFmt) < 1 && ovf <= 1, `삽입 리본 높이 = 서식 리본 (${hIns} / ${hFmt}) · 넘침 ${ovf}px`);
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1366, 900); });
    await win.waitForTimeout(500); await menu('삽입');
    const ovf2 = await win.evaluate(() => { const r = document.querySelector('.ribbon'); return { o: r.scrollWidth - r.clientWidth, h: r.getBoundingClientRect().height }; });
    ok(ovf2.o <= 1 && Math.abs(ovf2.h - hFmt) < 1, `1366px 에서도 넘치지 않는다 (${JSON.stringify(ovf2)})`);
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1600, 950); });
    await win.waitForTimeout(400);

    console.log('\n[6] 채널편집 — 🏷 채널 로고(켜기·파일·크기)는 그대로');
    await win.click('button[title^="채널(프리셋)"]');
    await win.waitForSelector('.modal-card.tabbed', { timeout: 8000 });
    await win.locator('.modal-card.tabbed button:has-text("📁 폴더")').first().click();
    const row = win.locator('[data-testid=logo-row]');
    ok(await row.count() === 1 && (await row.locator('input.nbox').inputValue()) === '15', '📁 폴더 탭에 「🏷 채널 로고」 · 크기 15%');
    ok(await row.locator('select').count() === 0, '위치는 채널편집이 아니라 삽입 메뉴에서');
    ok(!(await win.locator('.modal-card.tabbed').innerText()).includes('🎵 배경음악'), '🎵 배경음악은 채널편집에서 빠졌다(삽입 메뉴로)');
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
  console.log(`\n${fail ? '❌' : '✅'} 삽입·로고 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
