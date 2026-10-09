'use strict';
/**
 * node test/group-ops.smoke.js — ✂ 그룹 나누기 · ➕ 그룹 추가 · 그룹 칸 단추 · 📍 채널 로고 자리 E2E(v0.7.71 · 로이 2026-10-09)
 *   [1] 그룹 칸 단추 = 이모지 첫 줄 · 글자 다음 줄 · 스톡 단추 없음(이미지·비디오 탭 단추가 대신)
 *   [2] 클립을 누르면 그 아래 「✂ 그룹 나누기」 — 문장 경계(그룹 하나가 둘로) · 문장 한가운데(문장도 줄에서 나뉨 · 대본 .md 갱신 · 음성 유지) · 그룹 마지막 클립 아래엔 없음 · Ctrl+Z 한 번
 *   [3] ➕ 그룹추가 = 누른 그룹 바로 아래 새 그룹(대본 .md 에 자리표시 문장) · Ctrl+Z
 *   [4] 채널 로고 기본 자리(logoX·logoY) → 빌더 입력 pos · 대본 자리가 이긴다 · ↖ 는 채널 자리를 안 쓴다
 *   음성은 무음(dry) 만들기로 채운다. ⚠ 임시 채널·임시 대본·임시 출력폴더만 쓴다.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TAG = `__그룹작업_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const LONG = '가나다라마바사 아자차카타파하 거너더러머버서 어저처커터퍼허 고노도로모보소 오조초코토포호.';
const SCRIPT = ['# 그룹 작업 테스트', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room',
  '첫째 문장입니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a gate', '셋째 문장입니다. ' + LONG + ' 다섯째 문장입니다.', ''].join('\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const md = () => fs.readFileSync(MD, 'utf8');

(async () => {
  // [4] 순수 함수(앱 없이)
  console.log('[4] 채널 로고 기본 자리 규칙');
  const OL = require('../core/overlay-layers');
  const lo = OL.logoOptsOf({ logoOn: true, logoPath: 'x.png', logoSize: 10, logoX: 5, logoY: 7.5 }, () => true);
  ok(lo.pos && lo.pos.x === 0.05 && lo.pos.y === 0.075, 'logoX·logoY(%) → pos 0..1 ' + JSON.stringify(lo.pos));
  ok(OL.logoOptsOf({ logoOn: true, logoPath: 'x.png', logoX: '', logoY: 7 }, () => true).pos === null, '한 칸만 있으면 채널 자리 없음(기본 오른쪽 위)');
  ok(OL.logoOptsOf({ logoOn: true, logoPath: 'x.png', logoX: 120, logoY: 7 }, () => true).pos === null, '범위 밖(0~100 아님)은 무시');
  ok(OL.posOfLogo(lo, {}).x === 0.05, '대본에 자리 없음 → 채널 기본 자리');
  ok(OL.posOfLogo(lo, { logoPos: { x: 0.3, y: 0.4 } }).x === 0.3, '대본이 끌어 옮긴 자리가 이긴다');
  ok(OL.posOfLogo(lo, { logoSide: 'left' }) === null, '대본이 ↖ 를 고르면 채널 자리를 안 쓴다');
  ok(OL.posOfLogo({ pos: null }, {}) === null, '채널 자리도 없으면 null(기본 오른쪽 위)');
  const ov = OL.effLogo(lo, { logoOver: { on: true } });
  ok(ov.enabled && ov.pos && ov.pos.x === 0.05, '대본 「로고 넣기」(logoOver)도 채널 자리를 이어받는다');
  const box = OL.logoBox({ size: 0.1, imgRatio: 1, pos: lo.pos });
  ok(Math.abs(box.x - 0.05) < 1e-9 && Math.abs(box.y - 0.075) < 1e-9, 'logoBox 가 그 자리에 놓는다');

  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__그룹작업채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupops-e2e-'));
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win, lsDetail = null;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });
    const logoPng = path.join(outDir, 'logo.png'); fs.writeFileSync(logoPng, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
    ok(await win.evaluate(async ({ name, dir, logo }) => { try { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, logoOn: true, logoPath: logo, logoSize: 12 } }); return true; } catch (_) { return false; } }, { name: chan, dir: outDir, logo: logoPng }), '임시 채널(로고 켬)');
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(400);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    lsDetail = await win.evaluate(() => { try { return localStorage.getItem('pm.clipDetail'); } catch (_) { return null; } });
    const made = await win.evaluate(async (name) => { try { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 20, aiNotice: false, openVrew: false }); return 'ok'; } catch (e) { return e.message; } }, chan);
    ok(made === 'ok', '무음 만들기로 음성 채우기 ' + made);
    await win.waitForTimeout(4200);   // 만들기 진행 팝업(끝나면 3초 뒤 닫힘)이 단추를 가리지 않게
    const body = () => md().split('\n').filter((l) => /문장입니다|새 그룹/.test(l));
    const groups = () => win.evaluate(() => [...document.querySelectorAll('.cut')].map((c) => [...c.querySelectorAll('.sent.clip .clip-cap')].map((x) => x.innerText.trim()).join(' / ')));
    const pick = async (n) => { await win.locator(`.sent.clip[data-ln="${n}"] .clip-no`).first().click(); await win.waitForTimeout(300); };

    console.log('\n[1] 그룹 칸 단추');
    const btn = await win.evaluate(() => [...document.querySelectorAll('.pg-tools .pg-act')].map((b) => {
      const ic = b.querySelector('.pg-ic'), tx = b.querySelector('.pg-tx');
      return { id: b.dataset.testid, ic: ic && ic.innerText, tx: tx && tx.innerText, stack: ic && tx ? Math.round(tx.getBoundingClientRect().top - ic.getBoundingClientRect().top) : 0, w: Math.round(b.getBoundingClientRect().width), sw: b.scrollWidth, cw: b.clientWidth };
    }));
    ok(btn.map((b) => b.id).join() === 'group-del,group-add,group-merge', '단추 = 삭제 · 그룹추가 · 합치기 (스톡 단추 없음) ' + JSON.stringify(btn.map((b) => b.id)));
    ok(btn.every((b) => b.ic && b.tx && b.stack > 8), '이모지 첫 줄 · 글자 다음 줄(위아래로 쌓임) ' + JSON.stringify(btn.map((b) => b.stack)));
    ok(btn.every((b) => b.sw <= b.cw + 1), '글자가 잘리거나 넘치지 않는다 ' + JSON.stringify(btn.map((b) => [b.sw, b.cw])));
    ok(await win.locator('[data-testid="group-stock"]').count() === 0, '그룹 칸에 스톡 단추 없음');

    await win.locator('.menubar button:text-is("이미지")').first().click(); await win.waitForTimeout(250);
    ok(await win.locator('[data-testid="rb-tts-image"]').isVisible() && /TTS\+이미지/.test(await win.locator('[data-testid="rb-tts-image"]').innerText()), '이미지 탭에 「TTS+이미지」 단추(큐 전체를 TTS → 이미지 순서로)');
    const sz0 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1366, 850)); await win.waitForTimeout(500);
    const rib = await win.evaluate(() => { const r = document.querySelector('.ribbon'); return { over: r.scrollWidth - r.clientWidth, vw: innerWidth }; });
    ok(rib.over <= 1, '1366px 에서도 리본이 넘치지 않는다 ' + JSON.stringify(rib));
    await app.evaluate(({ BrowserWindow }, sz) => BrowserWindow.getAllWindows()[0].setSize(sz[0], sz[1]), sz0); await win.waitForTimeout(400);
    console.log('\n[2] 클립 사이 막대 — 마우스를 가져가면 「＋ 클립 추가」 · 화살표(그룹 나누기)');
    const clips = () => win.evaluate(() => [...document.querySelectorAll('.sent.clip[data-ln]')].map((x) => ({ n: Number(x.dataset.ln), t: (x.querySelector('.clip-cap') || {}).innerText || '' })));
    const hoverGap = async (n) => { const el = win.locator(`.sent.clip[data-ln="${n}"]`).first(); await el.scrollIntoViewIfNeeded(); const bx = await el.boundingBox(); await win.mouse.move(bx.x + bx.width / 2, bx.y + bx.height - 30); await win.mouse.move(bx.x + bx.width / 2, bx.y + bx.height + 6, { steps: 3 }); await win.waitForTimeout(250); };
    const gapShown = (n) => win.evaluate((k) => { const b = document.querySelector(`.sent.clip[data-ln="${k}"] .cg-bar`); return !!(b && getComputedStyle(b).display !== 'none'); }, n);
    let cl = await clips();
    const nOf = (re) => (cl.find((x) => re.test(x.t)) || {}).n;
    const n3 = nOf(/^셋째/);
    ok(!(await gapShown(n3)), '마우스가 없으면 막대는 숨어 있다');
    await hoverGap(n3);
    ok(await gapShown(n3), '클립 아래 틈에 마우스를 가져가면 막대가 나온다');
    ok(await win.locator(`.sent.clip[data-ln="${n3}"] [data-testid="clip-add"]`).isVisible() && await win.locator(`.sent.clip[data-ln="${n3}"] [data-testid="clip-split"]`).isVisible(), '「＋ 클립 추가」 와 화살표 단추가 보인다');
    const w0 = await win.locator(`.sent.clip[data-ln="${n3}"] [data-testid="clip-split"]`).evaluate((e) => e.getBoundingClientRect().width);
    await win.locator(`.sent.clip[data-ln="${n3}"] [data-testid="clip-split"]`).hover(); await win.waitForTimeout(200);
    const w1 = await win.locator(`.sent.clip[data-ln="${n3}"] [data-testid="clip-split"]`).evaluate((e) => e.getBoundingClientRect().width);
    ok(w1 > w0 + 30, `화살표에 마우스를 올리면 「그룹 나누기」 로 펼쳐진다(${Math.round(w0)}px → ${Math.round(w1)}px)`);
    const md0 = md();
    await win.locator(`.sent.clip[data-ln="${n3}"] [data-testid="clip-split"]`).click(); await win.waitForTimeout(1200);
    let g = await groups();
    ok(g.length === 3 && g[1] === '셋째 문장입니다.' && /^가나다라/.test(g[2]), '🔑 문장 경계에서 나누면 G2 가 둘로(셋째 / 긴 문장·다섯째) ' + JSON.stringify(g));
    ok(md() === md0, '문장 경계 나누기는 대본(.md)을 안 바꾼다');
    const titles = await win.evaluate(() => [...document.querySelectorAll('.pg-row .pg-title')].map((x) => (x.classList.contains('none') ? '' : x.innerText.trim())));
    ok(titles.length === 3 && titles[2] === '', '🔑 새로 나뉜 그룹의 이름은 빈칸 ' + JSON.stringify(titles));
    await win.keyboard.press('Control+z'); await win.waitForTimeout(900);
    ok((await groups()).length === 2, 'Ctrl+Z 한 번에 두 그룹으로');

    cl = await clips();
    const lastN = cl[cl.length - 1].n;
    await hoverGap(lastN);
    ok(await win.locator(`.sent.clip[data-ln="${lastN}"] [data-testid="clip-add"]`).count() === 1 && await win.locator(`.sent.clip[data-ln="${lastN}"] [data-testid="clip-split"]`).count() === 0, '그룹의 마지막 클립 아래에는 「클립 추가」만(그룹 나누기는 없다)');

    console.log('\n[2b] 그룹 나누기 — 문장 한가운데(긴 문장의 줄 경계)');
    cl = await clips();
    const longLines = cl.filter((x) => /[가-힣]{3}/.test(x.t) && !/문장입니다/.test(x.t));
    ok(longLines.length >= 2, '긴 문장이 여러 클립(줄)으로 보인다 — ' + longLines.length + '줄');
    const cut = longLines[0];   // 긴 문장의 첫 줄 뒤에서 나눈다
    const timesBefore = await win.evaluate(() => [...document.querySelectorAll('.sent.clip .clip-time')].map((x) => x.innerText.trim()));
    await hoverGap(cut.n);
    await win.locator(`.sent.clip[data-ln="${cut.n}"] [data-testid="clip-split"]`).click(); await win.waitForTimeout(1500);
    g = await groups();
    ok(g.length === 3 && g[1].includes('셋째 문장입니다.') && g[1].includes(cut.t.trim().split(' ')[0]) && !/다섯째/.test(g[1]), '🔑 긴 문장이 그 줄 뒤에서 갈려 그룹이 셋이 됐다 ' + JSON.stringify(g));
    const b2 = md().split('\n').find((l) => /셋째 문장입니다/.test(l)) || '';
    ok(b2.split(/(?<=\.)\s+/).length === 4, '대본(.md) 도 그 줄에서 문장 둘로 나뉘었다(셋째·앞조각·뒷조각·다섯째) — ' + b2);
    const timesAfter = await win.evaluate(() => [...document.querySelectorAll('.sent.clip .clip-time')].map((x) => x.innerText.trim()));
    ok(timesAfter.length === timesBefore.length && timesAfter.every((t) => t && !/^-/.test(t)), '음성(시각·길이)이 모든 클립에 그대로 있다 ' + timesAfter.length + '개');
    await win.keyboard.press('Control+z'); await win.waitForTimeout(1000);
    ok((await groups()).length === 2 && md() === md0, 'Ctrl+Z 한 번에 그룹도 대본(.md)도 원래대로');

    console.log('\n[2c] ＋ 클립 추가 팝업');
    cl = await clips();
    const n1 = nOf(/^첫째/);
    await hoverGap(n1);
    await win.locator(`.sent.clip[data-ln="${n1}"] [data-testid="clip-add"]`).click(); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="clip-add-pop"]').isVisible(), '「＋ 클립 추가」 를 누르면 팝업');
    const lab = await win.locator('[data-testid="clip-add-pop"] button').allInnerTexts();
    ok(lab.map((t) => t.trim().replace(/^\S+\s*/, '')).join('|') === 'AI 목소리 클립|빈 클립|이미지 클립|비디오 클립', '네 가지 — ' + lab.map((t) => t.replace(/\s+/g, ' ')).join(' / '));
    await win.locator('[data-testid="clip-add-voice"]').click(); await win.waitForTimeout(1500);
    ok(/첫째 문장입니다\. 새 클립입니다\. 둘째 문장입니다\./.test(md()), '🔑 AI 목소리 클립 = 그 클립 뒤에 새 문장(대본 .md 에도) — ' + md().split('\n').find((l) => /첫째/.test(l)));
    ok(await win.locator('textarea').count() >= 1, '새 클립의 글 편집칸이 바로 열린다');
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
    g = await groups();
    ok(g.length === 2 && /^첫째.*새 클립입니다.*둘째/.test(g[0]), '같은 그룹 안에 들어갔다 ' + JSON.stringify(g[0]));
    await win.keyboard.press('Control+z'); await win.waitForTimeout(1000);
    ok(md() === md0 && (await groups()).length === 2, 'Ctrl+Z 한 번에 원래대로');
    await hoverGap(n1);
    await win.locator(`.sent.clip[data-ln="${n1}"] [data-testid="clip-add"]`).click(); await win.waitForTimeout(300);
    await win.locator('[data-testid="clip-add-empty"]').click(); await win.waitForTimeout(300);
    ok(md() === md0, '준비 중인 항목은 대본을 바꾸지 않는다');
    await win.keyboard.press('Escape'); await win.mouse.click(5, 5); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="clip-add-pop"]').count() === 0, '바깥을 누르면 팝업이 닫힌다');

    console.log('\n[3] 그룹추가');
    await win.locator('[data-testid="group-item"][data-g="1"]').click(); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="group-add"]').isEnabled(), '그룹을 누르면 그룹추가가 켜진다');
    await win.locator('[data-testid="group-add"]').click(); await win.waitForTimeout(1500);
    ok(await win.locator('textarea').count() >= 1, '새 문장을 바로 고칠 수 있게 편집칸이 열렸다');
    await win.keyboard.press('Escape'); await win.waitForTimeout(400);
    g = await groups();
    ok(g.length === 3 && g[1] === '새 그룹의 문장입니다.' && /^셋째/.test(g[2]), '🔑 누른 그룹(G1) 바로 아래에 새 그룹 G2 ' + JSON.stringify(g));
    ok(/둘째 문장입니다\. 새 그룹의 문장입니다\./.test(md()), '대본(.md)에 자리표시 문장이 들어갔다');
    await win.keyboard.press('Control+z'); await win.waitForTimeout(1000);
    ok((await groups()).length === 2 && md() === md0, 'Ctrl+Z 한 번에 새 그룹도 대본(.md)도 원래대로');

    console.log('\n[5] 채널 로고 기본 자리 — 삽입 메뉴 「채널 기본으로」 · 채널편집 X·Y');
    const detail = () => win.evaluate(async (n) => { const d = await window.api.getPresetDetail(n); return { x: d.logoX, y: d.logoY }; }, chan);
    await win.locator('.menubar button:text-is("삽입")').first().click(); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="logo-pos-chan"]').isDisabled(), '끌어 옮긴 자리도 채널 기본 자리도 없으면 📌 꺼져 있다');
    await win.evaluate(async () => { const r = await window.api.listQueue(); await window.api.setLogoPos({ shortsNum: r.dto.projects[0].shortsNum, pos: { x: 0.3, y: 0.4 } }); });
    await win.waitForTimeout(500);
    ok(await win.locator('[data-testid="logo-pos-chan"]').isEnabled() && /채널 기본으로/.test(await win.locator('[data-testid="logo-pos-chan"]').getAttribute('title')) && (await win.locator('[data-testid="logo-pos-chan"]').innerText()) === '📌', '대본 로고를 끌어 옮기면 「📌 채널 기본으로」가 켜진다');
    await win.locator('[data-testid="logo-pos-chan"]').click(); await win.waitForTimeout(700);
    let dt = await detail();
    ok(dt.x === 30 && dt.y === 40, '채널에 기본 자리가 저장됐다(왼쪽 30% · 위 40%) ' + JSON.stringify(dt));
    await win.evaluate(async () => { const r = await window.api.listQueue(); await window.api.setLogoSide({ shortsNum: r.dto.projects[0].shortsNum, side: 'right' }); });
    await win.waitForTimeout(500);
    const lp = await win.evaluate(() => { const l = document.querySelector('[data-testid=stage-logo]'); const st = document.querySelector('#stage'); if (!l || !st) return null; const a = l.getBoundingClientRect(), b = st.getBoundingClientRect(); return { x: (a.left - b.left) / b.width, y: (a.top - b.top) / b.height }; });
    ok(lp && Math.abs(lp.x - 0.3) < 0.02 && Math.abs(lp.y - 0.4) < 0.02, '🔑 ① 칸 로고가 채널 기본 자리에 놓인다 ' + JSON.stringify(lp));
    ok(/기본 자리 해제/.test(await win.locator('[data-testid="logo-pos-chan"]').getAttribute('title')), '대본 자리를 풀면 단추가 「채널 기본 해제」로');
    await win.click('button[title^="채널(프리셋)"]'); await win.waitForSelector('.modal-card.tabbed', { timeout: 8000 });
    await win.locator('.modal-card.tabbed button:has-text("📁 폴더")').first().click(); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="logo-x"]').inputValue() === '30' && await win.locator('[data-testid="logo-y"]').inputValue() === '40', '채널편집 📍 로고 자리에 30 · 40 이 보인다');
    await win.locator('[data-testid="logo-x"]').fill('12.5'); await win.locator('[data-testid="logo-y"]').fill('8');
    await win.locator('.modal-card.tabbed button:has-text("저장")').first().click(); await win.waitForTimeout(800);
    dt = await detail();
    ok(dt.x === 12.5 && dt.y === 8, '채널편집에서 X·Y 를 고쳐 저장했다 ' + JSON.stringify(dt));
    await win.click('button[title^="채널(프리셋)"]'); await win.waitForSelector('.modal-card.tabbed', { timeout: 8000 });
    await win.locator('.modal-card.tabbed button:has-text("📁 폴더")').first().click(); await win.waitForTimeout(200);
    await win.locator('[data-testid="logo-pos-clear"]').click();
    await win.locator('.modal-card.tabbed button:has-text("저장")').first().click(); await win.waitForTimeout(800);
    dt = await detail();
    ok(dt.x === '' && dt.y === '', '✕ 로 비우고 저장하면 기본(오른쪽 위)으로 돌아간다 ' + JSON.stringify(dt));

    ok(errors.length === 0, `화면 오류 0건 ${errors.length ? '— ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    try { await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, chan); } catch (_) {}
    try { await win.evaluate((v) => { try { if (v == null) localStorage.removeItem('pm.clipDetail'); else localStorage.setItem('pm.clipDetail', v); } catch (_) {} }, lsDetail); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 그룹 작업 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 오류:', e); process.exit(1); });
