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
    ok(menus.join(',') === '대본·음성,이미지,비디오,완성,서식,삽입', `메뉴 6개 — 서식 옆에 ➕ 삽입 (${menus.join(' · ')})`);
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
    // 🔴 대본을 연 뒤(큐 1개 · ⚡ 만들기 활성)에도 메뉴 줄이 한 줄 — v0.5.79 「완성 후 열기」를 헤더에 두어 ■ 중단이 둘째 줄로 밀렸는데
    //    위 [1] 은 대본을 열기 전에 재서 못 잡았다(v0.5.81). 새 헤더 버튼을 넣으면 여기가 먼저 깨진다.
    {
      const mb2 = await win.locator('.menubar').boundingBox();
      ok(mb2 && mb2.height < 56, `대본을 연 뒤에도 1366px 메뉴 줄이 한 줄 (${mb2 && Math.round(mb2.height)}px)`);
      await win.locator('.menus button[data-menu]', { hasText: '완성' }).first().click(); await win.waitForTimeout(250);
      ok(await win.locator('[data-testid="open-after-make"]').isVisible(), '④ 완성 메뉴에 「완성 후 열기」 체크');
      const mo = await win.locator('[data-testid="monitor-off"]').boundingBox();
      ok(!!mo && await win.evaluate(({ x, y }) => !!(document.elementFromPoint(x, y) || {}).closest?.('[data-testid="monitor-off"]'), { x: mo.x + mo.width / 2, y: mo.y + mo.height / 2 }), '🌙 모니터 끄기 버튼이 보이고 눌리는 자리(누르지는 않는다)');
      await win.locator('.menus button[data-menu]', { hasText: '대본·음성' }).first().click(); await win.waitForTimeout(250);
    }
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
    // 🔑 v0.5.59 — 그룹 가운데 클립에서 Space = **그 클립부터**(예전엔 그룹 처음부터 틀었다)
    {
      const n2 = await win.evaluate(() => { const e = [...document.querySelectorAll('.sent[data-ln]')].find((x) => x.innerText.includes('첫째 그룹 둘째')); return e ? Number(e.dataset.ln) : 0; });
      await win.locator('.clipbar').click(); await win.keyboard.press('Home');
      for (let i = 1; i < n2; i++) await win.keyboard.press('ArrowDown');
      await win.waitForTimeout(200);
      await win.keyboard.press(' ');
      await win.waitForTimeout(350);
      const c = await stageCap();
      ok(n2 > 1 && /첫째 그룹 둘째/.test(c) && !/첫 문장/.test(c), `🔑 그룹 둘째 클립(${n2})에서 Space → 그 클립부터 「${c}」`);
      await win.keyboard.press(' '); await win.waitForTimeout(300);
    }
    // ⏸ v0.5.62 — ① 칸은 평소 **정지 장면**, 재생할 때만 움직인다(그림 켄번스 · 영상)
    {
      await win.locator('.clipbar').click(); await win.keyboard.press('Home'); await win.waitForTimeout(300);
      const kbState = () => win.evaluate(() => { const i = document.querySelector('#stageVisual img.kb'); return i ? getComputedStyle(i).animationPlayState : null; });
      ok(await kbState() === 'paused', `평소 = 그림 켄번스 멈춤 (${await kbState()})`);
      // 영상 삽입(전체) — 평소엔 멈춘 채 그 클립 장면
      const VID = path.join(TMP, 'mov.mp4');
      execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', VID]);
      await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, VID);
      await menu(win, 'insert');
      await win.click('[data-testid=ins-video]');
      await win.waitForSelector('[data-testid=ins-menu]', { timeout: 5000 });
      await win.click('[data-testid=ins-menu] button:has-text("전체 클립으로")');
      await win.waitForTimeout(800);
      await win.locator('.clipbar').click(); await win.keyboard.press('Home'); await win.waitForTimeout(800);
      const vs = () => win.evaluate(() => { const v = document.querySelector('#stageVisual .vlayer[data-num^="O"] video'); return v ? { paused: v.paused, t: +v.currentTime.toFixed(2), auto: v.autoplay } : null; });
      const v1 = await vs();
      await win.waitForTimeout(700);
      const v1b = await vs();
      ok(v1 && v1.paused && !v1.auto && v1b && v1b.t === v1.t, `🔑 평소 = 영상 멈춤(자동재생 없음 · 시간이 흐르지 않는다) — ${JSON.stringify([v1, v1b])}`);
      await win.keyboard.press('ArrowDown'); await win.keyboard.press('ArrowDown'); await win.waitForTimeout(800);
      const v2 = await vs();
      ok(v2 && v2.paused && v2.t > v1.t + 0.5, `🔑 클립을 옮기면 그 클립 장면으로(${v1 && v1.t}초 → ${v2 && v2.t}초 · 여전히 멈춤)`);
      await win.keyboard.press(' '); await win.waitForTimeout(900);
      const v3 = await vs();
      ok(v3 && !v3.paused, '재생하면 영상이 움직인다');
      await win.keyboard.press(' '); await win.waitForTimeout(600);
      const v4 = await vs();
      ok(v4 && v4.paused, '멈추면 다시 정지 장면');
      // 정리 — 삽입 지우기
      await win.locator('[data-testid=ov-range]').first().click();
      await win.click('[data-testid=ins-del]'); await win.waitForTimeout(500);
    }
    // 🧭 v0.5.62 — 재생 중 클립을 고르고 Space = 멈추고 **고른 클립부터** 다시 · 안 골랐으면 Space = 멈춤
    {
      const btn = () => win.locator('[data-testid=play-btn]').innerText();
      await win.locator('.clipbar').click(); await win.keyboard.press('Home'); await win.waitForTimeout(300);
      await win.keyboard.press(' '); await win.waitForTimeout(400);
      ok((await btn()).includes('■'), '재생 시작');
      const nLast = await win.evaluate(() => { const e = [...document.querySelectorAll('.sent[data-ln]')].find((x) => x.innerText.includes('둘째 그룹 마지막')); return e ? Number(e.dataset.ln) : 0; });
      await win.locator('.sent.clip[data-ln="' + nLast + '"] .clip-no').click();
      await win.keyboard.press(' '); await win.waitForTimeout(400);
      const c1 = await stageCap();
      ok((await btn()).includes('■') && /둘째 그룹 마지막/.test(c1), `🔑 재생 중 클립(${nLast})을 고르고 Space → 멈추지 않고 그 클립부터 「${c1}」`);
      await win.keyboard.press(' '); await win.waitForTimeout(400);
      ok((await btn()).includes('▶'), '🔑 고르지 않고 Space → 멈춤');
    }
    // 🖼 v0.5.68 — 범위 선은 평소엔 안 보이고, 그림 아이콘에 마우스를 올리면 보인다 · 누르면 다음 클릭까지 보이고 메뉴는 선 오른쪽(로이)
    {
      const railSt = () => win.evaluate(() => {
        const r = document.querySelector('[data-testid=rail][data-g="1"]'); if (!r) return null;
        const seg = r.querySelector('.rseg'), he = r.querySelector('[data-testid=rail-h-e]');
        return { line: getComputedStyle(seg).opacity, h: getComputedStyle(he).opacity, pin: r.classList.contains('pin'), join: [...document.querySelectorAll('[data-testid=rail-join]')].filter((x) => x.offsetParent).length };
      });
      let st = await railSt();
      ok(st && st.line === '0' && st.h === '0' && st.join === 0, `🔑 평소엔 선·손잡이·이음선이 안 보인다 ${JSON.stringify(st)}`);
      const pos = await win.evaluate(() => {
        const r = document.querySelector('[data-testid=rail][data-g="1"]'); const cut = document.querySelector('.cut[data-g="1"]');
        const cl = cut ? [...cut.querySelectorAll('.sent.clip')] : [];
        if (!r || !cl.length) return null;
        const hs = r.querySelector('[data-testid=rail-h-s]').getBoundingClientRect(), he = r.querySelector('[data-testid=rail-h-e]').getBoundingClientRect();
        return { s: Math.round(hs.top + hs.height / 2 - cl[0].getBoundingClientRect().top), e: Math.round(he.top + he.height / 2 - cl[cl.length - 1].getBoundingClientRect().bottom) };
      });
      ok(pos && Math.abs(pos.s) <= 2 && Math.abs(pos.e) <= 2, `🔑 시작 표식 = 그룹 첫 클립 윗변 · 끝 표식 = 끝 클립 아랫변 ${JSON.stringify(pos)}`);
      await win.locator('[data-testid=gicon]').first().hover();
      await win.waitForTimeout(300);
      st = await railSt();
      ok(st.line === '1' && st.h === '1', '🔑 그림 아이콘에 마우스를 올리면 선 + 손잡이가 보인다');
      ok(await win.locator('[data-testid=rail-peek] img').count() === 1, '큰 그림이 뜬다');
      await win.mouse.move(5, 5); await win.waitForTimeout(250);
      st = await railSt();
      ok(st.line === '0' && await win.locator('[data-testid=rail-peek]').count() === 0, '마우스를 치우면 다시 안 보인다');
      // 누르면 — 메뉴 + 다음 클릭까지 보인다
      await win.locator('[data-testid=gicon]').first().locator('.thumb').first().click();
      await win.waitForSelector('[data-testid=vr-menu]', { timeout: 3000 });
      await win.mouse.move(5, 5); await win.waitForTimeout(250);
      st = await railSt();
      ok(st.pin && st.line === '1' && st.h === '1', `🔑 아이콘을 누르면 마우스를 치워도 선·손잡이가 보인다 ${JSON.stringify(st)}`);
      ok(await win.locator('[data-testid=rail-peek]').count() === 0, '메뉴를 연 동안은 큰 그림을 띄우지 않는다(메뉴를 가리지 않게)');
      const mg = await win.evaluate(() => {
        const m = document.querySelector('[data-testid=vr-menu]'), r = document.querySelector('[data-testid=rail][data-g="1"]');
        const he = r.querySelector('[data-testid=rail-h-e]').getBoundingClientRect(), hs = r.querySelector('[data-testid=rail-h-s]').getBoundingClientRect();
        const hit = (b) => { const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!(e && e.closest && e.closest('[data-testid=rail]')); };
        const t = m.querySelector('.vr-grp-h .t'), d = m.querySelector('.vr-grp-h .d');
        const btns = [...m.querySelectorAll(':scope > button')].map((b) => b.scrollWidth);
        return { mLeft: Math.round(m.getBoundingClientRect().left), railRight: Math.round(r.getBoundingClientRect().right), hitS: hit(hs), hitE: hit(he),
          w: Math.round(m.getBoundingClientRect().width), maxBtn: Math.max(...btns), ell: t ? getComputedStyle(t).textOverflow : null, fits: t ? m.querySelector('.vr-grp-h').getBoundingClientRect().right <= m.getBoundingClientRect().right + 1 : null, time: d ? d.innerText : '' };
      });
      ok(mg.mLeft >= mg.railRight && mg.hitS && mg.hitE, `🔑 메뉴가 선 오른쪽 — 시작·끝 손잡이가 가려지지 않는다 ${JSON.stringify({ l: mg.mLeft, r: mg.railRight, s: mg.hitS, e: mg.hitE })}`);
      ok(mg.w <= mg.maxBtn + 40, `🔑 메뉴 폭 = 메뉴 항목 기준 (${mg.w}px · 가장 긴 항목 ${mg.maxBtn}px)`);
      ok(mg.ell === 'ellipsis' && mg.fits, `제목은 메뉴 폭을 늘리지 않고 길면 「…」 (${mg.ell} · 안에 들어감 ${mg.fits})`);
      // 손잡이를 잡아도 메뉴·선은 그대로(끌어 고칠 수 있게)
      const hb = await win.locator('[data-testid=rail][data-g="1"] [data-testid=rail-h-e]').boundingBox();
      await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await win.mouse.down(); await win.mouse.up(); await win.waitForTimeout(250);
      ok(await win.locator('[data-testid=vr-menu]').count() === 1 && (await railSt()).line === '1', '손잡이를 잡아도 메뉴·선은 그대로');
      await win.mouse.click(700, 5); await win.waitForTimeout(300);
      st = await railSt();
      ok(await win.locator('[data-testid=vr-menu]').count() === 0 && !st.pin && st.line === '0', '🔑 다음 클릭이면 메뉴가 닫히고 선도 다시 안 보인다');
    }
    // 🖼 v0.5.62 — G1 그림 끝점을 G2 의 첫 클립까지 끌면, 그 클립에서는 **G1 이 위**(① 칸 · 오른쪽 작은 그림 · 재생 모두)
    {
      const n3 = await win.evaluate(() => { const e = [...document.querySelectorAll('.sent[data-ln]')].find((x) => x.innerText.includes('둘째 그룹 문장')); return e ? Number(e.dataset.ln) : 0; });
      const ord3 = await win.evaluate((n) => { const e = document.querySelector('.sent[data-ln="' + n + '"]'); const b = e && e.closest('.sblk'); return b ? Number(b.dataset.ord) : 0; }, n3);
      await win.evaluate((o) => { const e = document.querySelector('.sblk[data-ord="' + o + '"]'); if (e) e.scrollIntoView({ block: 'end' }); }, ord3);
      await win.waitForTimeout(200);
      const he = await win.locator('[data-testid=rail][data-g="1"] [data-testid=rail-h-e]').boundingBox();
      const tb = await win.locator('.sblk[data-ord="' + ord3 + '"]').boundingBox();
      await win.mouse.move(he.x + he.width / 2, he.y + he.height / 2); await win.mouse.down();
      await win.mouse.move(he.x + he.width / 2, tb.y + Math.min(18, tb.height / 2), { steps: 10 }); await win.mouse.up();
      await win.waitForFunction(() => { const r = document.querySelector('[data-testid=rail][data-g="1"]'); return r && r.querySelector('[data-testid=rail-ext]'); }, null, { timeout: 6000 }).catch(() => {});
      await win.waitForTimeout(600);
      await win.locator('.clipbar').click(); await win.keyboard.press('Home');
      for (let i = 1; i < n3; i++) await win.keyboard.press('ArrowDown');
      await win.waitForTimeout(500);
      const top = await win.evaluate(() => { const L = [...document.querySelectorAll('#stageVisual .vlayer')]; return L.map((x) => x.dataset.num); });
      ok(top.length === 2 && top[top.length - 1] === '1', `🔑 G2 첫 클립(${n3}) — ① 칸 맨 위 = 늘려 끌어온 G1 (아래→위 ${top.join(' → ')})`);
      await win.keyboard.press(' '); await win.waitForTimeout(500);
      const topP = await win.evaluate(() => [...document.querySelectorAll('#stageVisual .vlayer')].map((x) => x.dataset.num));
      ok(topP[topP.length - 1] === '1', `재생 중에도 G1 이 위 (${topP.join(' → ')})`);
      await win.keyboard.press(' '); await win.waitForTimeout(300);
      await win.locator('.clipbar').click(); await win.keyboard.press('Control+z'); await win.waitForTimeout(600);
    }

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
    // 🖼 v0.5.68 — 음성이 생기면 그림 메뉴 머리줄에 길이 · 제목이 줄어도 시간은 다 보인다
    {
      await win.locator('[data-testid=gicon]').first().locator('.thumb').first().click();
      await win.waitForSelector('[data-testid=vr-menu] .vr-grp-h', { timeout: 3000 }).catch(() => {});
      const hd = await win.evaluate(() => { const d = document.querySelector('[data-testid=vr-menu] .vr-grp-h .d'); return d ? { txt: d.innerText, full: d.scrollWidth <= d.clientWidth + 1 } : null; });
      ok(hd && /· \d+\.\d초/.test(hd.txt) && hd.full, `그림 메뉴 머리줄 끝의 시간은 줄지 않는다 ${JSON.stringify(hd)}`);
      await win.keyboard.press('Escape'); await win.waitForTimeout(200);
    }
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
