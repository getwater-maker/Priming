'use strict';
/**
 * node test/visual-range.smoke.js — 실제 앱(Vrew 식 3칸 화면)에서 누르고 끌어 보는 E2E (2026-09-25).
 *   🖼 그림 적용 범위(손잡이 끌기 · 썸네일 메뉴 · 직접 입력 · 떨어진 문장 = 새 이미지 필요) ·
 *   ↶ Ctrl+Z / ↷ Ctrl+Y(범위 · 클립 합치기 — 대본 .md 까지 원래대로) ·
 *   🧩 그룹 경계를 넘는 클립 합치기(마지막 문장 끝 Del) · ⤢ 자막 서식 전체에 적용 ·
 *   📏 리본 높이가 메뉴마다 같다 · 서식 막대에 ✕ 없음 · 화면 오류 0.
 * ⚠ 사용자 대본은 건드리지 않는다 — 임시 .md 를 열고 끝나면 대본·스냅샷을 지운다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TAG = `__그림범위테스트_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = [
  '# 그림 범위 테스트 대본',
  '',
  '## 1장',
  '### 첫 장면',
  '> 🖼️ 이미지: a quiet room',
  '첫째 문장입니다. 둘째 문장입니다.',
  '',
  '### 둘째 장면',
  '> 🖼️ 이미지: a river',
  '셋째 문장입니다. 넷째 문장입니다.',
  '',
  '## 2장',
  '### 셋째 장면',
  '> 🖼️ 이미지: a mountain',
  '다섯째 문장입니다. 여섯째 문장입니다.',
  '',
].join('\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const cleanup = () => { for (const f of [MD, SNAP, path.join(os.tmpdir(), `${TAG}_g.png`)]) { try { if (fs.existsSync(f)) fs.rmSync(f, { force: true }); } catch (_) {} } };

(async () => {
  cleanup();
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('dialog', (d) => d.accept());
    await win.waitForSelector('h1', { timeout: 20000 });
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1600, 950); });
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.ribbon button:has-text("열기")');
    await win.waitForSelector('.sblk[data-ord]', { timeout: 20000 });
    const groups = async () => win.evaluate(() => [...document.querySelectorAll('.cut')].map((c) => [...c.querySelectorAll('.sblk[data-ord]')].map((b) => Number(b.dataset.ord))));
    const waitG = (want) => win.waitForFunction((w) => JSON.stringify([...document.querySelectorAll('.cut')].map((c) => [...c.querySelectorAll('.sblk[data-ord]')].map((b) => Number(b.dataset.ord)))) === w, JSON.stringify(want), { timeout: 8000 }).then(() => true, () => false);
    const key = async (k) => { await win.click('[data-testid=clipbar]', { position: { x: 5, y: 5 } }); await win.keyboard.press(k); };
    const G3 = [[1, 2], [3, 4], [5, 6]];

    // [0] 리본 높이 · 서식 막대 ✕
    const hs = [];
    for (const t of ['대본·음성', '이미지', '비디오', '완성', '서식']) {
      await win.locator(`.menubar button:text-is("${t}")`).first().click();
      await win.waitForTimeout(150);
      hs.push(await win.evaluate(() => Math.round(document.querySelector('#body').getBoundingClientRect().top)));
    }
    ok(new Set(hs).size === 1, `📏 메뉴를 바꿔도 아래 화면 위치가 같다 (${hs.join('/')})`);
    await win.locator('.cut .cf-lineno').first().click();
    await win.waitForSelector('.cf-bar:not(.idle)', { timeout: 5000 });
    ok(!(await win.locator('.cf-bar').innerText()).includes('✕'), '서식 막대에 ✕(선택 해제) 없음');
    await win.keyboard.press('Escape'); await win.keyboard.press('Escape');
    await win.locator('.menubar button:text-is("대본·음성")').first().click();

    ok(JSON.stringify(await groups()) === JSON.stringify(G3), '처음 = 그룹 3개 · 문장 2개씩');

    // [1] G1 끝 손잡이를 문장 4 위로 끌기
    const hb = await win.locator('.cut').nth(0).locator('.vr-h.bot').boundingBox();
    const tgt = await win.locator('.sblk[data-ord="4"]').boundingBox();
    await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await win.mouse.down();
    await win.mouse.move(tgt.x + 60, tgt.y + tgt.height / 2, { steps: 8 });
    ok(await win.locator('.vr-tip').count() === 1 && (await win.locator('.vr-tip').innerText()).includes('1~4'), '끄는 동안 안내 「문장 1~4」');
    ok(await win.locator('.sblk.vr-hit').count() === 4, '끄는 동안 덮일 문장 4개 표시(다른 그룹까지)');
    await win.mouse.up();
    // 🖼 v0.5.47 — 늘리면 겹쳐 깐다: 그룹은 그대로 · G1 에 「그림 범위 문장 1~4」
    const spanOf = async (i) => { const e = win.locator('.cut').nth(i).locator('[data-testid=vr-span]'); return (await e.count()) ? (await e.innerText()) : ''; };
    const waitSpan = (i, want) => win.waitForFunction(([k, w]) => { const e = document.querySelectorAll('.cut')[k]; const t = e && e.querySelector('[data-testid=vr-span]'); return (t ? t.textContent : '').includes(w); }, [i, want], { timeout: 8000 }).then(() => true, () => false);
    const waitNoSpan = (i) => win.waitForFunction((k) => { const e = document.querySelectorAll('.cut')[k]; return !(e && e.querySelector('[data-testid=vr-span]')); }, i, { timeout: 8000 }).then(() => true, () => false);
    ok(await waitSpan(0, '1~4') && JSON.stringify(await groups()) === JSON.stringify(G3), '🔑 놓으면 G1 그림이 문장 4까지 아래층으로 — 그룹 3개 그대로(지우지 않는다)');

    // [2] ↶ ↷
    await key('Control+z');
    ok(await waitNoSpan(0), '↶ Ctrl+Z — 이어 깔기가 풀린다');
    await key('Control+y');
    ok(await waitSpan(0, '1~4'), '↷ Ctrl+Y — 다시 이어 깔린다');
    await key('Control+z');
    ok(await waitNoSpan(0), '↶ 다시 되돌리기');

    // [3] 메뉴 → 전체 클립으로 → 직접 입력으로 줄이기
    await win.locator('.cut').nth(0).locator('.thumb').first().click();
    await win.waitForSelector('[data-testid=vr-menu]', { timeout: 3000 });
    const items = await win.locator('[data-testid=vr-menu] button').allInnerTexts();
    ok(items.some((t) => t.includes('AI로 이미지')) && items.some((t) => t.includes('AI로 비디오')) && items.some((t) => t.includes('적용 범위')), `썸네일 메뉴 (${items.join(' / ')})`);
    await win.click('[data-testid=vr-menu] button:has-text("적용 범위")');
    await win.click('[data-testid=vr-menu] button:has-text("전체 클립으로")');
    ok(await waitSpan(0, '1~6') && JSON.stringify(await groups()) === JSON.stringify(G3), '「전체 클립으로」 = G1 그림이 끝까지 아래층 · 그룹은 그대로');
    await win.locator('.cut').nth(0).locator('.thumb').first().click();
    await win.click('[data-testid=vr-menu] button:has-text("적용 범위")');
    await win.click('[data-testid=vr-menu] button:has-text("직접 입력")');
    await win.waitForSelector('.name-ask-layer input', { timeout: 3000 });
    await win.fill('.name-ask-layer input', '2-3');
    await win.click('.name-ask-layer button:has-text("확인")');
    ok(await waitG([[1], [2], [3, 4], [5, 6]]), '직접 입력 2-3 → 앞 문장(1)은 떨어져 새 그룹 · 3 까지 아래층');
    ok((await win.locator('.cut').nth(0).innerText()).includes('새 이미지 필요'), '🔑 떨어져 나간 그룹 = 「새 이미지 필요」(결정 1ⓐ)');
    await key('Control+z'); await waitSpan(0, '1~6');
    await key('Control+z');
    ok(await waitNoSpan(0) && JSON.stringify(await groups()) === JSON.stringify(G3), '↶ 두 번 — 처음 모양으로');

    // [3b] ✂ 한 문장 안 자막 줄 나누기·합치기 — 문장 1 「첫째 문장입니다.」 를 「첫째」 / 「문장입니다.」 로
    const lines1 = async () => win.evaluate(() => [...document.querySelectorAll('.sblk[data-ord="1"] .sent')].length);
    const c1 = win.locator('.sent[data-ln="1"] .clip-cap');
    if (await c1.count()) await c1.click(); else await win.locator('.sblk[data-ord="1"] .sblk-lines').click();
    await win.locator('textarea:focus').waitFor({ timeout: 5000 });
    await win.keyboard.press('Home'); for (let k = 0; k < 2; k++) await win.keyboard.press('ArrowRight');
    await win.keyboard.press('Enter');
    await win.waitForFunction(() => document.querySelectorAll('.sblk[data-ord="1"] .sent').length === 2, null, { timeout: 5000 }).catch(() => {});
    ok(await lines1() === 2, '✂ Enter — 한 문장이 자막 두 줄(클립 두 개)로');
    ok(fs.readFileSync(MD, 'utf8') === SCRIPT, '대본(.md)은 그대로 · 음성도 그대로(문장이 안 바뀐다)');
    const c2 = win.locator('.sent[data-ln="2"] .clip-cap');
    if (await c2.count()) await c2.click(); else await win.locator('.sblk[data-ord="1"] .sblk-lines').click();
    await win.locator('textarea:focus').waitFor({ timeout: 5000 });
    await win.keyboard.press('Home');
    await win.keyboard.press('Backspace');
    await win.waitForFunction(() => document.querySelectorAll('.sblk[data-ord="1"] .sent').length === 1, null, { timeout: 5000 }).catch(() => {});
    ok(await lines1() === 1, '✂ 둘째 줄 맨 앞 Backspace — 다시 한 줄로');
    await key('Control+z');
    await win.waitForFunction(() => document.querySelectorAll('.sblk[data-ord="1"] .sent').length === 2, null, { timeout: 5000 }).catch(() => {});
    ok(await lines1() === 2, '↶ 줄 합치기 되돌리기');
    await key('Control+z');
    await win.waitForFunction(() => document.querySelectorAll('.sblk[data-ord="1"] .sent').length === 1, null, { timeout: 5000 }).catch(() => {});

    // [4] 🧩 그룹 경계 넘기 — G1 마지막 문장(2) 끝에서 Del
    const cap = win.locator('.sent[data-ln="2"] .clip-cap');
    if (await cap.count()) await cap.click(); else await win.locator('.sblk[data-ord="2"] .sblk-lines').click();
    const ta = win.locator('textarea:focus');
    await ta.waitFor({ timeout: 5000 });
    await win.keyboard.press('End');
    await win.keyboard.press('Delete');
    ok(await waitG([[1, 2], [3], [4, 5]]), '🧩 끝에서 Del — 다음 그룹 첫 문장을 당겨 와 한 클립(문장 6 → 5)');
    const md1 = fs.readFileSync(MD, 'utf8');
    ok(md1.includes('둘째 문장입니다 셋째 문장입니다.') && md1.includes('### 둘째 장면'), '대본(.md) — 한 문장으로 합쳐지고 사이 제목 줄은 그대로');
    await key('Control+z');
    ok(await waitG(G3), '↶ 클립 합치기 되돌리기');
    ok(fs.readFileSync(MD, 'utf8') === SCRIPT, '🔑 대본(.md)도 글자 하나 다르지 않게 원래대로');

    // [4b] 🧩 반대 방향 — G2 첫 문장(3) 맨 앞에서 Backspace = 앞 그룹 끝에 붙는다
    const cap3 = win.locator('.sent[data-ln="3"] .clip-cap');
    if (await cap3.count()) await cap3.click(); else await win.locator('.sblk[data-ord="3"] .sblk-lines').click();
    await win.locator('textarea:focus').waitFor({ timeout: 5000 });
    await win.keyboard.press('Home');
    await win.keyboard.press('Backspace');
    ok(await waitG([[1, 2], [3], [4, 5]]), '🧩 맨 앞 Backspace — 앞 그룹 마지막 문장과 한 클립');
    await key('Control+z');
    ok(await waitG(G3) && fs.readFileSync(MD, 'utf8') === SCRIPT, '↶ 되돌리기 — 모양·대본 원래대로');

    // [4c] 🖼 그림 모양 — 그림이 있어야 메뉴에 나온다: 임시 그림을 G1 에 첨부
    const png = path.join(os.tmpdir(), TAG + '_g.png');
    fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAWAAH+0mZlpgAAAABJRU5ErkJggg==', 'base64'));
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, png);
    await win.locator('.cut').nth(0).locator('.thumb').first().click();
    await win.click('[data-testid=vr-menu] button:has-text("첨부")');
    await win.waitForSelector('.cut img.thumb', { timeout: 5000 });
    await win.locator('.cut').nth(0).locator('img.thumb').click();
    const items2 = await win.locator('[data-testid=vr-menu] button').allInnerTexts();
    ok(items2.some((t) => t.includes('채우기')) && items2.some((t) => t.includes('반전')) && items2.some((t) => t.includes('움직임')), '그림 메뉴에 채우기 · 반전 · 움직임');
    await win.click('[data-testid=vr-menu] button:has-text("반전")');
    await win.click('[data-testid=vr-menu] button:has-text("좌우 반전")');
    await win.waitForTimeout(500);
    await win.locator('.sblk[data-ord="1"] .sblk-lines, .sent[data-ln="1"] .clip-cap').first().click({ position: { x: 3, y: 3 } }).catch(() => {});
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);
    const tf = await win.evaluate(() => { const e = document.querySelector('#stageVisual .vlook'); return e ? e.style.transform : ''; });
    ok(/scale\(-1, ?1\)/.test(tf), `① 미리보기에 좌우 반전이 보인다 (${tf})`);
    await win.locator('.cut').nth(0).locator('img.thumb').click();
    await win.click('[data-testid=vr-menu] button:has-text("움직임")');
    await win.click('[data-testid=vr-menu] button:has-text("없음")');
    await win.waitForTimeout(400);
    ok(await win.evaluate(() => !!document.querySelector('#stageVisual img.kbnone')), '움직임 없음 → 미리보기 켄번스 멈춤');
    await key('Control+z');
    await win.waitForTimeout(400);
    ok(await win.evaluate(() => !document.querySelector('#stageVisual img.kbnone')), '↶ 움직임 되돌리기');

    // [4c2] 📐 ① 칸에서 그림 옮기기·크기 — 누르면 선택 틀 · 끌면 옮김 · 가운데에 붙으며 안내선 · 모서리 = 크기
    { const cc = win.locator('.sent[data-ln="1"] .clip-cap'); if (await cc.count()) await cc.click(); else await win.locator('.sblk[data-ord="1"] .sblk-lines').click(); await win.keyboard.press('Escape'); }
    await win.waitForSelector('#stageVisual .vlayer[data-num="1"]', { timeout: 5000 });
    const sv = await win.locator('#stageVisual').boundingBox();
    const cx = sv.x + sv.width / 2, cy = sv.y + sv.height / 2;
    await win.mouse.move(cx, cy); await win.mouse.down();
    await win.waitForSelector('[data-testid=stage-sel]', { timeout: 3000 });
    ok(true, '📐 ① 칸 그림을 누르면 선택 틀(모서리 손잡이 4개)');
    await win.mouse.move(cx + sv.width * 0.2, cy + sv.height * 0.15, { steps: 6 });
    const gAway = await win.locator('[data-testid=guide-v]').count();
    await win.mouse.move(cx + 2, cy + 1, { steps: 6 });
    const gNear = await win.locator('[data-testid=guide-v]').count() + await win.locator('[data-testid=guide-h]').count();
    ok(gAway === 0 && gNear === 2, `🔑 가운데에 가까우면 붙고 빨간 안내선(세로·가로) — 멀면 없음 (${gAway} → ${gNear})`);
    await win.mouse.move(cx + sv.width * 0.2, cy, { steps: 6 });
    await win.mouse.up();
    await win.waitForTimeout(600);
    const lf = await win.evaluate(() => { const e = document.querySelector('#stageVisual .vlayer[data-num="1"]'); return e ? parseFloat(e.style.left) : NaN; });
    ok(lf > 10, `놓으면 옮긴 자리가 저장된다(왼쪽 ${lf.toFixed(1)}%)`);
    const tl = await win.locator('[data-testid=stage-sel] .ssel-h.tl').boundingBox();   // 옮긴 뒤 오른쪽 모서리는 화면 밖이다
    await win.mouse.move(tl.x + 5, tl.y + 5); await win.mouse.down();
    await win.mouse.move(tl.x + sv.width * 0.3, tl.y + sv.height * 0.3, { steps: 6 }); await win.mouse.up();
    await win.waitForTimeout(600);
    const wd = await win.evaluate(() => { const e = document.querySelector('#stageVisual .vlayer[data-num="1"]'); return e ? parseFloat(e.style.width) : NaN; });
    ok(wd > 5 && wd < 90, `모서리를 끌면 크기가 바뀐다(너비 ${wd.toFixed(1)}%)`);
    await win.locator('.cut').nth(0).locator('img.thumb').click();
    ok(await win.locator('[data-testid=vr-menu] button:has-text("자리·크기 원래대로")').count() === 1, '그림 메뉴에 「자리·크기 원래대로」');
    await win.click('[data-testid=vr-menu] button:has-text("자리·크기 원래대로")');
    await win.waitForTimeout(500);
    ok(await win.evaluate(() => { const e = document.querySelector('#stageVisual .vlayer[data-num="1"]'); return e && e.style.left === '0px' || (e && parseFloat(e.style.left) === 0); }), '원래대로 — 다시 화면 가득');
    await win.keyboard.press('Escape');

    // [4d] 🏷 AI 고지 범위 — 꼬리표 → 이 클립부터 끝까지
    const aiOn = await win.evaluate(() => !!document.querySelector('[data-testid=ai-tag]'));
    if (!aiOn) { await win.locator('.menubar button:text-is("완성")').first().click(); await win.locator('label.chk:has-text("AI 고지") input').check(); await win.locator('.menubar button:text-is("대본·음성")').first().click(); }
    await win.waitForSelector('[data-testid=ai-tag]', { timeout: 5000 });
    ok((await win.locator('[data-testid=ai-tag]').innerText()).includes('기본'), '🏷 AI 고지 꼬리표(첫 문장 위 · 기본 5초 뒤 5초)');
    await win.click('[data-testid=ai-tag]');
    await win.click('[data-testid=vr-menu] button:has-text("직접 입력")');
    await win.fill('.name-ask-layer input', '2-3');
    await win.click('.name-ask-layer button:has-text("확인")');
    await win.waitForFunction(() => document.querySelectorAll('.sblk.ai-in').length === 2, null, { timeout: 5000 }).catch(() => {});
    ok(await win.locator('.sblk.ai-in').count() === 2 && (await win.locator('[data-testid=ai-tag]').innerText()).includes('2~3'), 'AI 고지 → 문장 2~3 (그 두 문장에 표시)');
    await key('Control+z');
    await win.waitForTimeout(400);
    ok(await win.locator('.sblk.ai-in').count() === 0, '↶ AI 고지 범위 되돌리기');
    await key('Control+z');   // 좌우 반전도 되돌린다

    // [5] ⤢ 자막 서식 전체에 적용
    await win.locator('.cut .cf-lineno').first().click();
    await win.waitForSelector('.cf-bar:not(.idle)', { timeout: 5000 });
    ok(await win.locator('.cf-bar button:has-text("전체에 적용")').count() === 1, '서식 막대에 「⤢ 전체에 적용」');
    await win.click('.cf-bar button[title="굵게"]');
    await win.waitForFunction(() => document.querySelectorAll('.cut .capfmt').length > 0, null, { timeout: 5000 });
    await win.click('.cf-bar button:has-text("전체에 적용")');
    await win.waitForTimeout(800);
    const lines = await win.locator('.cut .sent').count();
    const bold = await win.evaluate(() => [...document.querySelectorAll('.cut .sent')].filter((s) => [...s.querySelectorAll('.capfmt')].some((e) => Number(getComputedStyle(e).fontWeight) >= 700)).length);
    ok(lines > 0 && bold === lines, `⤢ 전체에 적용 — 자막 ${lines}줄 전부 굵게 (${bold}/${lines})`);
    await win.keyboard.press('Escape'); await win.keyboard.press('Escape');
    await key('Control+z');
    await win.waitForTimeout(600);
    const bold2 = await win.evaluate(() => [...document.querySelectorAll('.cut .sent')].filter((s) => [...s.querySelectorAll('.capfmt')].some((e) => Number(getComputedStyle(e).fontWeight) >= 700)).length);
    ok(bold2 === 1, `↶ 전체 적용 되돌리기 — 처음 굵게 한 한 줄만 남는다 (${bold2})`);

    // ⏳ 그림이 있는 채로 다시 열기 — 초기화 → 같은 대본 열기(작업본 이어받기로 그림이 되살아난다)
    await win.click('button.reset-btn');
    await win.waitForFunction(() => !document.querySelector('.sblk[data-ord]'), null, { timeout: 5000 }).catch(() => {});
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.locator('.menubar button:text-is("대본·음성")').first().click();
    await win.click('.ribbon button:has-text("열기")');
    await win.waitForSelector('.cut img.thumb', { timeout: 10000 }).catch(() => {});
    await win.waitForTimeout(2500);
    const logTxt = fs.readFileSync(path.join(os.homedir(), '.shots-maker', 'logs', new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) + '.log'), 'utf8');
    ok(/⏳ 그림·영상 불러오기 \d+\/\d+개 — [\d.]+초/.test(logTxt), '⏳ 그림·영상 불러오기 시간이 로그에 남는다');
    ok(errors.length === 0, `화면 오류 0 ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
  } catch (e) {
    fail++; console.log('  ✗ 예외: ' + e.message);
  } finally {
    await app.close().catch(() => {});
    cleanup();
  }
  console.log(`\n${fail ? '❌' : '✅'} visual-range E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
