'use strict';
/**
 * node test/workspace.smoke.js — 🧭 Vrew 식 작업 화면(v0.5.42) 실제 앱 E2E.
 *
 * 메뉴 줄 + 리본 · 가로 3칸(① 영상·이미지 ② 자막 클립 ③ 설정) · 커서(마우스·키보드) → ① 이 그 줄 그림·자막으로 바뀜 ·
 * Enter 고치기 · Space 재생 · 줄 번호 → 서식 메뉴 · ⚙ 고급 → ③ 칸 · 보기 전환(클립/카드) · 로그 위치 ·
 * 🔑 ① 자막 크기·위치가 유튜브 MP4 와 같은 비율인가(실측 기준: 아래·왼쪽·-0.125 → 글자 x 65/1920 · 아래끝 897/1080).
 * ⚠ 사용자 작업물 보호 — 임시 채널(출력 폴더 = 임시 폴더) + 임시 대본. 끝나면 채널·폴더·스냅샷을 지운다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const menu = require('./_menu');

const ROOT = path.join(__dirname, '..');
const TAG = `__작업화면테스트_${process.pid}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
const MD = path.join(TMP, `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const CH = '__테스트채널_삭제해도됨_화면_' + process.pid;
const SCRIPT = [
  '# 작업 화면 테스트',
  '',
  '## 도입부',
  '### 〔첫 장면〕',
  '> 🖼️ 이미지: a red room',
  '첫째 그룹 첫 문장입니다. 첫째 그룹 둘째 문장입니다.',
  '',
  '### 〔둘째 장면〕',
  '> 🖼️ 이미지: a blue room',
  '둘째 그룹 문장입니다. 둘째 그룹 마지막 문장입니다.',
  '',
].join('\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

(async () => {
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const FF = require('../core/media-utils').getFfmpegPath();
  const imgR = path.join(TMP, 'red.png'), imgB = path.join(TMP, 'blue.png');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xaa2020:s=1920x1080', '-frames:v', '1', imgR]);
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x2040aa:s=1920x1080', '-frames:v', '1', imgB]);
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false, lsSaved = null;
  try {
    const win = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 820); });
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    // 🔑 로이 앱과 같은 사용자 폴더(localStorage) — 보기 설정을 적어 두고 끝날 때 되돌린다
    lsSaved = await win.evaluate(() => { const o = {}; for (const k of ['pm.view', 'pm.pane1R', 'pm.clipDetail']) { try { o[k] = localStorage.getItem(k); localStorage.removeItem(k); } catch (_) {} } return o; });
    await win.evaluate(async ({ name, dir }) => {
      const ps = (await window.api.listPresets()) || [];
      for (const p of ps) if (p.name.indexOf('__테스트채널_삭제해도됨_화면_') === 0) { try { await window.api.removePreset({ name: p.name }); } catch (_) {} }
      await window.api.addPreset({ name });
      await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, capLong: { size: '100', align: 'start', yAlign: 'bottom', yOffset: -0.125 } } });
    }, { name: CH, dir: TMP });
    chMade = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((n) => [...document.querySelectorAll('select option')].some((o) => o.value === n), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await win.waitForTimeout(800);

    // [1] 메뉴 줄 + 리본
    const menus = await win.locator('.menus button[data-menu]').allInnerTexts();
    ok(menus.join(',') === '대본·음성,이미지,비디오,완성,서식', `메뉴 5개 (${menus.join(' · ')})`);
    ok(await win.locator('.ribbon[data-menu-on="script"]').count() === 1, '켤 때 메뉴 = 대본·음성');
    const mb = await win.locator('.menubar').boundingBox();
    ok(mb && mb.height < 56, `1366px 에서 메뉴 줄이 한 줄 (${mb && Math.round(mb.height)}px)`);
    for (const [id, want] of [['image', '② 이미지'], ['video', '③ 비디오'], ['finish', '④ 완성']]) {
      await menu(win, id);
      ok(await win.locator(`.ribbon .glabel:has-text("${want}")`).count() === 1 && await win.locator('.ribbon .glabel').count() === 1, `「${id}」 메뉴 = 리본에 ${want} 한 묶음만`);
    }
    ok(await win.locator('.menubar button:has-text("⚡ 만들기")').count() === 1 && await win.locator('.menubar button:has-text("중단")').count() === 1, '⚡ 만들기 · ■ 중단은 메뉴 줄에 늘 보인다');
    await menu(win, 'script');

    // 대본 열기 + 그룹 그림 첨부(빨강·파랑)
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sblk', { timeout: 20000 });
    for (const [g, img] of [[1, imgR], [2, imgB]]) {
      // 화면의 ＋ 칸을 눌러 첨부한다(API 를 직접 부르면 화면 상태가 안 바뀐다)
      await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, img);
      await win.locator('.cut .thumb.none').first().click();
      // 🖼 v0.5.45 — 썸네일을 누르면 메뉴(Vrew 방식) → 「첨부」
      await win.click('[data-testid=vr-menu] button:has-text("첨부")');
      await win.waitForFunction((n) => document.querySelectorAll('.cut img.thumb').length >= n, g, { timeout: 5000 });
    }
    await win.waitForFunction(() => document.querySelectorAll('.cut img.thumb').length >= 2, null, { timeout: 8000 }).catch(() => {});
    const hb = await win.locator('.topsticky').boundingBox();
    ok(hb && hb.height < 140, `헤더(메뉴+리본) 높이 ${hb && Math.round(hb.height)}px — 예전 약 400px`);

    // [2] 3칸
    const p1 = await win.locator('[data-testid=pane1]').boundingBox();
    const p2 = await win.locator('main.pane2').boundingBox();
    ok(p1 && p2 && p1.x < p2.x && p1.width > 300, `① 왼쪽(${p1 && Math.round(p1.width)}px) · ② 가운데`);
    ok(await win.locator('[data-testid=cf-side]').count() === 0, '③ 은 처음엔 닫혀 있다');
    ok(await win.locator('[data-testid=pane1] #logwrap').count() === 1, '로그창은 ① 아래');
    ok(await win.locator('.cuts-grid.clips').count() === 1, '② = 한 열 클립 목록');

    const stageImg = () => win.evaluate(() => { const i = document.querySelector('#stageVisual img'); return i ? decodeURIComponent(i.getAttribute('src') || '') : ''; });
    const stageCap = () => win.locator('#stageCap').innerText();
    await win.waitForSelector('.sent.cur', { timeout: 5000 });
    ok((await win.locator('.sent.cur').getAttribute('data-ln')) === '1', '대본을 열면 커서 = 01');
    ok(/첫째 그룹 첫 문장/.test(await stageCap()) && /red\.png/.test(await stageImg()), `① = 01 줄 자막 + 그 그룹 그림(${(await stageImg()).split(/[\\/]/).pop()})`);

    // [3] 키보드 — ↓ 로 줄 이동 · 그룹이 바뀌면 그림도
    await win.locator('.clipbar').click();   // 입력칸이 아닌 곳에 포커스
    await win.keyboard.press('ArrowDown');
    await win.waitForFunction(() => (document.querySelector('.sent.cur') || {}).getAttribute && document.querySelector('.sent.cur').getAttribute('data-ln') === '2', null, { timeout: 3000 });
    ok(/첫째 그룹 둘째 문장/.test(await stageCap()), '↓ → 커서 02 · ① 자막이 02 줄로 바뀐다');
    await win.keyboard.press('ArrowDown');
    await win.waitForTimeout(300);
    ok(/둘째 그룹 문장/.test(await stageCap()) && /blue\.png/.test(await stageImg()), '🔑 다음 그룹으로 넘어가면 ① 그림도 그 그룹 것(파랑)');
    await win.keyboard.press('ArrowUp');
    await win.waitForTimeout(200);
    ok(/red\.png/.test(await stageImg()), '↑ 로 돌아가면 다시 빨강');
    await win.keyboard.press('End');
    await win.waitForTimeout(200);
    ok(/마지막 문장/.test(await stageCap()), 'End = 마지막 줄');
    await win.keyboard.press('Home');
    await win.waitForTimeout(200);
    ok((await win.locator('.sent.cur').getAttribute('data-ln')) === '1', 'Home = 첫 줄');

    // [4] Enter 고치기 · Esc
    await win.keyboard.press('Enter');
    await win.waitForSelector('.sent.clip.editing .clip-edit', { timeout: 3000 });
    ok(true, 'Enter = 커서 줄 고치기(상세 = 그 줄 글자만)');
    await win.keyboard.press('Escape');
    await win.waitForSelector('.sent.clip.editing', { state: 'detached', timeout: 3000 });

    // [5] 마우스 — 글자 클릭 = 커서 이동 + 바로 고치기
    await win.locator('.sent[data-ln="4"] .clip-cap').click();   // 상세 보기 — 자막 줄(🗨 칸)을 누르면 그 줄 고치기
    await win.waitForSelector('.sent.clip.editing .clip-edit', { timeout: 3000 });
    await win.keyboard.press('Escape');
    await win.waitForSelector('.sent.clip.editing', { state: 'detached', timeout: 3000 });
    ok((await win.locator('.sent.cur').getAttribute('data-ln')) === '4' && /마지막 문장/.test(await stageCap()), '글자 클릭 = 커서 04 로 이동 + 편집칸(로이 확정) · ① 도 04');

    // [6] 줄 번호 → 서식 메뉴 · ⚙ 고급 → ③ 칸
    await win.locator('.sent[data-ln="3"] .cf-lineno').click();
    await win.waitForSelector('.ribbon[data-menu-on="format"] [data-testid=cf-bar]:not(.idle)', { timeout: 3000 });
    ok((await win.locator('.cf-bar .cf-sel').innerText()).includes('자막 03'), '줄 번호 → 서식 메뉴가 열리고 03 선택');
    const w2a = (await win.locator('main.pane2').boundingBox()).width;
    await win.click('.cf-bar button:has-text("⚙ 고급")');
    await win.waitForSelector('[data-testid=cf-side].pane3', { timeout: 3000 });
    const p3 = await win.locator('[data-testid=cf-side]').boundingBox();
    const w2b = (await win.locator('main.pane2').boundingBox()).width;
    ok(p3 && p3.x > p2.x && w2b < w2a - 200, `③ 칸이 오른쪽에 열리고 ② 가 그만큼 좁아진다(겹쳐 덮지 않는다) — ② ${Math.round(w2a)}→${Math.round(w2b)}px`);
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-testid=cf-side]', { state: 'detached', timeout: 3000 });
    ok(true, 'Esc = ③ 닫힘');
    await win.keyboard.press('Escape');

    // [7] 🔑 ① 자막 배치 = MP4 공식(아래·왼쪽·-0.125 → 글자 왼쪽 65/1920 · 아래끝 897/1080 — test/caption-format [11] 실측)
    await win.locator('.clipbar').click();
    await win.keyboard.press('Home');
    await win.waitForTimeout(300);
    const geo = await win.evaluate(() => {
      const st = document.getElementById('stage').getBoundingClientRect();
      const ln = document.querySelector('#stageCap .cf-stageline');
      const r = ln ? ln.getBoundingClientRect() : null;
      const fs_ = ln ? parseFloat(getComputedStyle(document.getElementById('stageCap')).fontSize) : 0;
      return r ? { x: (r.left - st.left) / st.width, bottom: (r.bottom - st.top) / st.height, font: fs_ / st.width * 1920 } : null;
    });
    ok(geo && Math.abs(geo.x - 65 / 1920) < 0.012, `① 자막 왼쪽 = ${geo && (geo.x * 1920).toFixed(0)}/1920 (MP4 65)`);
    ok(geo && Math.abs(geo.bottom - 897 / 1080) < 0.02, `① 자막 아래끝 = ${geo && (geo.bottom * 1080).toFixed(0)}/1080 (MP4 897)`);
    ok(geo && Math.abs(geo.font - 72) < 1, `① 글자 크기 = ${geo && geo.font.toFixed(1)}px@1920 (MP4 = size 100 × 0.72 = 72)`);

    // [8] Space 재생 · 멈춤
    await win.keyboard.press(' ');
    await win.waitForFunction(() => /멈춤/.test((document.querySelector('[data-testid=play-btn]') || {}).textContent || ''), null, { timeout: 3000 });
    ok(true, 'Space = 커서 줄부터 재생');
    await win.keyboard.press(' ');
    await win.waitForFunction(() => /재생/.test((document.querySelector('[data-testid=play-btn]') || {}).textContent || ''), null, { timeout: 3000 });
    await win.waitForTimeout(300);
    ok(/첫째 그룹 첫 문장/.test(await stageCap()), 'Space 한 번 더 = 멈춤 · ① 은 커서 자리 정지 화면으로');

    // [9] 보기 전환 — 카드
    await win.click('.clipbar button[data-view="cards"]');
    await win.waitForTimeout(300);
    ok(await win.locator('[data-testid=pane1]').count() === 0 && await win.locator('.cuts-grid.clips').count() === 0, '카드 보기 = 옛 3열 그리드(① 없음)');
    ok(await win.locator('#logwrap').count() === 1 && !(await win.locator('#logwrap').getAttribute('class') || '').includes('docked'), '카드 보기의 로그 = 예전의 떠 있는 창');
    await win.click('.cut .gprev[title="이 그룹 미리듣기"]');
    await win.waitForSelector('#player.show #stageCap .cf-stageline', { timeout: 5000 });
    ok(true, '카드 보기의 ▶ = 화면을 덮는 재생 창(같은 스테이지)');
    await win.keyboard.press('Escape');
    await win.click('.clipbar button[data-view="clips"]');
    await win.waitForSelector('[data-testid=pane1] #stage', { timeout: 3000 });
    ok(true, '클립 보기로 되돌아온다');

    // [10] 🧩 2단계 — 상세(클립 머리줄 · 어절 칩) · 개요 전환 · 시각 · 리본 큰 버튼
    ok(await win.locator('.cuts-grid.detail .sent.clip').count() === 4, `상세 보기가 기본 — 클립 4개(${await win.locator('.sent.clip').count()})`);
    ok((await win.locator('.sent[data-ln="1"] .clip-spk').innerText()).includes('내레이션'), '클립마다 화자 표시(화자 없으면 「내레이션」)');
    const chips = win.locator('.sent[data-ln="1"] .clip-chips .chip');
    ok((await chips.allInnerTexts()).join('|') === '첫째|그룹|첫|문장입니다.', `어절 칩 = 공백으로 나눈 단어 (${(await chips.allInnerTexts()).join('|')})`);
    await chips.nth(1).click();
    await win.waitForSelector('.ribbon[data-menu-on="format"] .cf-bar:not(.idle)', { timeout: 3000 });
    ok((await win.locator('.cf-bar .cf-sel').innerText()).includes('글자 2자') && await win.locator('.sent[data-ln="1"] .chip.on').count() === 1, '🔑 칩을 누르면 그 단어만 서식 선택(「글자 2자」) + 서식 메뉴');
    ok(await win.locator('.sblk.editing').count() === 0, '칩을 눌러도 편집칸은 열리지 않는다');
    await chips.nth(3).click({ modifiers: ['Shift'] });
    await win.waitForTimeout(300);
    ok((await win.locator('.cf-bar .cf-sel').innerText()).includes('글자 11자') && await win.locator('.sent[data-ln="1"] .chip.on').count() === 3, 'Shift+칩 = 같은 문장 안에서 범위(그룹 첫 문장입니다. = 11자)');
    await win.click('.cf-bar button[title="굵게"]');
    await win.waitForFunction(() => [...document.querySelectorAll('.sent[data-ln="1"] .capfmt')].some((e) => Number(getComputedStyle(e).fontWeight) >= 700), null, { timeout: 5000 });
    ok(true, '칩으로 고른 단어에 굵게가 먹는다');
    await win.keyboard.press('Escape');
    await win.click('.clipbar button[data-detail="0"]');
    await win.waitForTimeout(200);
    ok(await win.locator('.sent.clip').count() === 0 && await win.locator('.sent[data-ln="1"] .cf-lineno').count() === 1, '개요 = 줄만 촘촘히(칩·머리줄 없음)');
    await win.click('.clipbar button[data-detail="1"]');
    // 시각 — 무음(dry)으로 음성 길이를 채운다(TTS 서버·GPU 안 씀 · 임시 채널 출력 = 임시 폴더)
    const made = await win.evaluate(async (name) => {
      try { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 20, aiNotice: false, openVrew: false }); return 'ok'; }
      catch (e) { return String(e && e.message || e); }
    }, CH);
    await win.waitForFunction(() => document.querySelectorAll('.sent.clip .clip-time').length === 4, null, { timeout: 30000 }).catch(() => {});
    const times = await win.locator('.sent.clip .clip-time').allInnerTexts();
    const t0 = times.map((x) => { const m = /^(\d\d):(\d\d) \+ (\d+\.\d\d)초$/.exec(x); return m ? { s: +m[1] * 60 + +m[2], d: +m[3] } : null; });
    ok(made === 'ok' && times.length === 4 && t0.every(Boolean), `🕒 클립 시각 「00:00 + 1.23초」 모양 (${times.join(' / ')})`);
    ok(t0.every(Boolean) && t0[0].s === 0 && t0[3].s >= t0[1].s && t0.every((x) => x.d > 0), '시각은 앞 줄 길이만큼 누적된다(첫 줄 00:00)');
    // 리본 큰 버튼 — 아이콘 위 · 글자 아래
    await menu(win, 'script');
    const ob = await win.evaluate(() => {
      const b = [...document.querySelectorAll('.ribbon .hgroup button')].find((x) => /열기/.test(x.textContent));
      const ic = b && b.querySelector('.rb-ic'), t = b && b.querySelector('.rb-t');
      return ic && t ? { up: ic.getBoundingClientRect().bottom <= t.getBoundingClientRect().top + 1, h: b.getBoundingClientRect().height } : null;
    });
    ok(ob && ob.up && ob.h >= 44, `리본 큰 버튼 — 아이콘이 글자 위(버튼 높이 ${ob && Math.round(ob.h)}px)`);

    // [11] 🧩 v0.5.44 — 클립 모양(번호 칸) · 줄 편집(모양 그대로) · ↑↓ 로 편집 채 이동 · Ctrl+A · ① 칸 팝업
    await win.keyboard.press('Escape'); await win.keyboard.press('Escape');
    ok(await win.locator('.sent.clip .clip-no').count() === 4 && await win.locator('.sent.clip .clip-r1').count() === 4 && await win.locator('.sent.clip .clip-r2 .clip-fmt').count() === 4,
      '클립 = 왼쪽 번호 칸 | 1행(화자·시각·칩) / 2행(🗨 자막 + 가)');
    const h0 = (await win.locator('.sent[data-ln="2"]').boundingBox()).height;
    await win.locator('.sent[data-ln="2"] .clip-cap').click();
    await win.waitForSelector('.sent.clip.editing[data-ln="2"] .clip-edit', { timeout: 3000 });
    ok(await win.locator('.clip-edit').inputValue() === '첫째 그룹 둘째 문장입니다.', '편집칸에는 그 줄 글자만');
    const h1 = (await win.locator('.sent[data-ln="2"]').boundingBox()).height;
    ok(Math.abs(h1 - h0) <= 4 && await win.locator('.sent.clip.editing .clip-r1 .chip').count() > 0, `🔑 고치는 동안에도 클립 모양 그대로(높이 ${Math.round(h0)}→${Math.round(h1)}px · 칩 그대로)`);
    await win.keyboard.press('ArrowDown');
    await win.waitForSelector('.sent.clip.editing[data-ln="3"] .clip-edit', { timeout: 5000 });
    ok(true, '🔑 고치는 중 ↓ = 다음 클립으로(고치는 채로)');
    await win.fill('.clip-edit', '둘째 그룹 문장이에요.');
    await win.keyboard.press('ArrowDown');
    await win.waitForSelector('.sent.clip.editing[data-ln="4"] .clip-edit', { timeout: 10000 });
    const md3 = fs.readFileSync(MD, 'utf8');
    ok(/둘째 그룹 문장이에요\./.test(md3) && /첫째 그룹 둘째 문장입니다\./.test(md3), '고친 줄은 저장되고(.md) 다른 문장은 그대로');
    await win.keyboard.press('ArrowUp');
    await win.waitForSelector('.sent.clip.editing[data-ln="3"] .clip-edit', { timeout: 5000 });
    ok(true, '↑ = 윗 클립으로');
    await win.keyboard.press('Escape');
    await win.waitForSelector('.sent.clip.editing', { state: 'detached', timeout: 3000 });
    // 번호 칸 = 원하는 클립만 골라 선택
    await win.locator('.sent[data-ln="2"] .clip-no').click();
    await win.locator('.sent[data-ln="4"] .clip-no').click({ modifiers: ['Control'] });
    await win.waitForTimeout(200);
    ok(await win.locator('.sent.clip.picked').count() === 2 && (await win.locator('.cf-bar .cf-sel').innerText()).includes('2줄'), '번호 칸 클릭 + Ctrl = 원하는 클립만(2·4)');
    await win.locator('.clipbar').click();
    await win.keyboard.press('Control+a');
    await win.waitForTimeout(200);
    ok(await win.locator('.sent.clip.picked').count() === 4 && (await win.locator('.cf-bar .cf-sel').innerText()).includes('4줄'), '🔑 Ctrl+A = 모든 클립 선택');
    await win.keyboard.press('Escape');
    // ① 칸 팝업
    await win.locator('.clipbar').click();
    await win.keyboard.press('Home');
    await win.waitForTimeout(300);
    await win.click('#stageCap .cf-stageline');
    await win.waitForSelector('[data-testid=stage-ta]', { timeout: 3000 });
    ok(await win.locator('[data-testid=cf-mini]').count() === 1 && await win.locator('[data-testid=stage-ta]').inputValue() === '첫째 그룹 첫 문장입니다.', '🔑 ① 자막을 누르면 팝업(작은 서식 막대 + 그 자리 글자칸)');
    const tb = await win.locator('[data-testid=stage-ta]').boundingBox(), sb = await win.locator('#stage').boundingBox();
    ok(tb && sb && tb.y > sb.y + sb.height * 0.6, `글자칸이 자막 자리(아래쪽)에 뜬다 (y ${Math.round((tb.y - sb.y) / sb.height * 100)}%)`);
    await win.click('[data-testid=cf-mini] button[title="굵게"]');
    await win.waitForFunction(() => [...document.querySelectorAll('.sent[data-ln="1"] .capfmt')].some((e) => Number(getComputedStyle(e).fontWeight) >= 700), null, { timeout: 5000 });
    ok(await win.locator('[data-testid=stage-ta]').count() === 1, '팝업의 굵게 → ② 목록 01 에 반영 · 팝업은 그대로(글자칸 초점 유지)');
    await win.fill('[data-testid=stage-ta]', '첫째 그룹 첫 문장을 고쳤습니다.');
    await win.keyboard.press('Enter');
    await win.waitForSelector('[data-testid=stage-ta]', { state: 'detached', timeout: 10000 });
    await win.waitForFunction(() => /첫 문장을 고쳤습니다/.test((document.querySelector('.sent[data-ln="1"]') || {}).textContent || ''), null, { timeout: 10000 });
    ok(/첫째 그룹 첫 문장을 고쳤습니다\./.test(fs.readFileSync(MD, 'utf8')), 'Enter = 저장 · .md 와 ② 목록에 반영');
    ok(/첫 문장을 고쳤습니다/.test(await stageCap()), '① 자막도 새 글');

    ok(errors.length === 0, `화면 오류 0건 (${errors.slice(0, 3).join(' | ')})`);
  } catch (e) {
    ok(false, 'E2E 예외: ' + (e && e.stack || e));
  } finally {
    if (chMade) { try { await (await app.firstWindow()).evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    if (lsSaved) { try { await (await app.firstWindow()).evaluate((o) => { for (const k of Object.keys(o)) { try { if (o[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, o[k]); } catch (_) {} } }, lsSaved); } catch (_) {} }
    try { await app.close(); } catch (_) {}
    for (const f of [SNAP]) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    console.log(`\n${fail ? '❌' : '✅'} 작업 화면 E2E ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
