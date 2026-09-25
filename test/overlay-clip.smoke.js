'use strict';
/**
 * node test/overlay-clip.smoke.js — ➕ 삽입 범위 = 클립(자막 줄) 단위 · 🏷 로고 ✕ 지우기 — 실제 앱 E2E (v0.5.65)
 *   문장이 자막 두 줄이 되게 길게 쓴 임시 대본 · 임시 채널(자막 글자수 12) — 사용자 작업물은 건드리지 않는다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const FF = require('../core/media-utils').getFfmpegPath();

const ROOT = path.join(__dirname, '..');
const TAG = `__클립삽입테스트_${process.pid}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ovclipui-'));
const MD = path.join(TMP, `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const CH = '__테스트채널_삭제해도됨_클립삽입_' + process.pid;
const SCRIPT = ['# 클립 삽입 테스트', '', '## 1장',
  '### 하나', '> 🖼️ 이미지: a', '오늘은 아주 오래된 마을 이야기를 들려드리겠습니다.', '',
  '### 둘', '> 🖼️ 이미지: b', '그 마을에는 늙은 느티나무 한 그루가 서 있었습니다.', '',
  '### 셋', '> 🖼️ 이미지: c', '셋째 문장입니다.', ''].join('\n');
const img = (n, c, s = '1920x1080') => { const f = path.join(TMP, n + '.png'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=${s}`, '-frames:v', '1', f]); return f; };

let pass = 0, fail = 0, chMade = false;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

(async () => {
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const LOGO = img('logo', 'green', '300x150');
  const BLUE = img('blue', 'blue');
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
      for (const p of ps) if (p.name.indexOf('__테스트채널_삭제해도됨_클립삽입_') === 0) { try { await window.api.removePreset({ name: p.name }); } catch (_) {} }
      await window.api.addPreset({ name });
      await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, logoOn: true, logoPath: logo, logoSize: 15,
        split: { introSentenceSize: 3, mainSentenceSize: 10, shortLen: 10, longLen: 12, splitMode: 'h3' } } });
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

    console.log('[1] 준비 — 문장마다 자막 두 줄(클립 번호 ≠ 문장 번호)');
    const lay = await win.evaluate(() => [...document.querySelectorAll('.sblk[data-ord]')].map((b) => b.querySelectorAll('.sent.clip').length));
    ok(lay[0] >= 2 && lay[1] >= 2, `문장별 클립 수 ${JSON.stringify(lay)}`);
    const nClip = lay.reduce((a, b) => a + b, 0);
    const c1 = lay[0], c2 = lay[0] + lay[1];   // 문장1 끝 클립 · 문장2 끝 클립

    console.log('\n[2] ➕ 그림 삽입 → 직접 입력「2-(문장2 첫 클립)」 — 문장 한가운데에서 시작·끝');
    await key('Home'); await win.waitForTimeout(200);
    await menu('삽입'); await stub(BLUE);
    await win.click('[data-testid=ins-image]');
    await win.waitForSelector('[data-testid=ins-menu]', { timeout: 5000 });
    const mt = await win.locator('[data-testid=ins-menu]').innerText();
    ok(mt.includes('지금: 전체'), '기본 = 전체');
    await win.click('[data-testid=ins-menu] button:has-text("직접 입력")');
    await win.waitForSelector('.name-ask-layer input', { timeout: 3000 });
    ok((await win.locator('.name-ask-layer h3').innerText()).includes(`1~${nClip}`), `직접 입력 범위 안내 = 클립 1~${nClip}`);
    const want = `2-${c1 + 1}`;
    await win.fill('.name-ask-layer input', want);
    await win.click('.name-ask-layer button:has-text("확인")');
    await win.waitForFunction((w) => (document.querySelector('[data-testid=ov-range]') || {}).innerText.includes(w), `클립 2~${c1 + 1}`, { timeout: 5000 }).catch(() => {});
    const chip = await win.locator('[data-testid=ovchip]').first().innerText();
    ok(chip.includes(`클립 2~${c1 + 1}`), `목록 = 클립 2~${c1 + 1} — 「${chip.replace(/\n/g, ' ')}」`);

    console.log('\n[3] ① 칸 — 클립마다 맞는 그림');
    const ovOnStage = () => win.evaluate(() => !!document.querySelector('#stageVisual .vlayer[data-num^="O"]'));
    const at = async (n) => { await key('Home'); for (let i = 1; i < n; i++) await key('ArrowDown'); await win.waitForTimeout(250); return ovOnStage(); };
    ok(!(await at(1)), '클립 1(문장1 첫 줄): 없음');
    ok(await at(2), '🔑 클립 2(문장1 둘째 줄): 있음 — 문장 한가운데에서 시작');
    ok(await at(c1 + 1), `클립 ${c1 + 1}(문장2 첫 줄): 있음`);
    ok(!(await at(c1 + 2)), `🔑 클립 ${c1 + 2}(문장2 둘째 줄): 없음 — 문장 한가운데에서 끝`);

    console.log('\n[4] ② 칸 — 오른쪽 작은 그림 · 삽입 막대');
    const thumbs = await win.evaluate(() => [...document.querySelectorAll('[data-testid=cthumb]')].map((t) => !!t.querySelector('[class*=o], img') && t.innerHTML.includes('blue')));
    ok(thumbs.length === nClip, `작은 그림 칸 ${thumbs.length}개`);
    const ln = await win.evaluate(() => { const l = document.querySelector('[data-testid=ins-lane]'); return l ? { f: l.dataset.from, t: l.dataset.to } : null; });
    ok(ln && ln.f === '2' && ln.t === String(c1 + 1), `막대 data = 클립 ${ln && ln.f}~${ln && ln.t}`);
    const geo = await win.evaluate((n) => {
      const l = document.querySelector('[data-testid=ins-lane]'); const a = document.querySelector('.sent.clip[data-ln="2"]'), b = document.querySelector(`.sent.clip[data-ln="${n}"]`);
      if (!l || !a || !b) return null; const L = l.getBoundingClientRect();
      return { top: Math.round(L.top - a.getBoundingClientRect().top), bot: Math.round(L.bottom - b.getBoundingClientRect().bottom) };
    }, c1 + 1);
    ok(geo && Math.abs(geo.top) <= 2 && Math.abs(geo.bot) <= 2, `🔑 막대 = 클립 2 윗변 ~ 클립 ${c1 + 1} 아랫변 ${JSON.stringify(geo)}`);

    console.log('\n[5] 끝점 끌기 — 문장2 둘째 줄까지(클립 단위로 멈춘다)');
    await win.evaluate(() => { const p = document.querySelector('main.pane2'); if (p) p.scrollTop = 0; });
    await win.waitForTimeout(300);
    const capE = await win.locator('[data-testid=ins-lane]').first().locator('[data-testid=lane-cap-e]').boundingBox();
    const tgt = await win.locator(`.sent.clip[data-ln="${c2}"]`).boundingBox();
    if (capE && tgt) {
      await win.mouse.move(capE.x + capE.width / 2, capE.y + capE.height / 2);
      await win.mouse.down();
      await win.mouse.move(capE.x + capE.width / 2, tgt.y + tgt.height / 2, { steps: 8 });
      await win.waitForTimeout(200);
      await win.mouse.up();
    }
    await win.waitForFunction((w) => (document.querySelector('[data-testid=ov-range]') || {}).innerText.includes(w), `클립 2~${c2}`, { timeout: 5000 }).catch(() => {});
    ok((await win.locator('[data-testid=ovchip]').first().innerText()).includes(`클립 2~${c2}`), `끌어서 클립 2~${c2}`);
    ok(await at(c1 + 2), `클립 ${c1 + 2}: 이제 있음`);
    await key('Control+z'); await win.waitForTimeout(500);
    ok((await win.locator('[data-testid=ovchip]').first().innerText()).includes(`클립 2~${c1 + 1}`), '↶ 되돌리면 옛 범위');

    console.log('\n[6] 🏷 채널편집 — 로고 ✕ 지우기');
    ok(await win.locator('[data-testid=stage-logo]').count() === 1, '지우기 전 ① 칸에 로고');
    await win.click('button[title^="채널(프리셋)"]');
    await win.waitForSelector('.modal-card.tabbed', { timeout: 8000 });
    await win.locator('.modal-card.tabbed button:has-text("📁 폴더")').first().click();
    const row = win.locator('[data-testid=logo-row]');
    ok(await row.locator('[data-testid=logo-clear]').count() === 1, '로고 칸에 ✕');
    await row.locator('[data-testid=logo-clear]').click();
    ok((await row.locator('input[readonly]').inputValue()) === '' && !(await row.locator('input[type=checkbox]').isChecked()), '✕ → 경로 비움 · 끔');
    ok(await row.locator('[data-testid=logo-clear]').count() === 0, '비우면 ✕ 사라짐');
    await win.locator('.modal-card.tabbed button:text-is("저장")').first().click();
    await win.waitForTimeout(900);
    const pd = await win.evaluate(async (n) => { const p = await window.api.getPresetDetail(n); return { on: !!p.logoOn, path: p.logoPath || '' }; }, CH);
    ok(!pd.on && pd.path === '', `🔑 채널에 저장 — ${JSON.stringify(pd)}`);
    await win.waitForFunction(() => !document.querySelector('[data-testid=stage-logo]'), null, { timeout: 4000 }).catch(() => {});
    ok(await win.locator('[data-testid=stage-logo]').count() === 0, '🔑 ① 칸 로고도 곧바로 사라짐');
    ok(fs.existsSync(LOGO), '그림 파일은 그대로');
    ok(errors.length === 0, `화면 오류 0 ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
  } catch (e) {
    fail++; console.log('  ✗ 예외: ' + e.message);
  } finally {
    if (chMade) { try { await (await app.firstWindow()).evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    await app.close().catch(() => {});
    for (const f of [SNAP]) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 클립 삽입·로고 지우기 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
