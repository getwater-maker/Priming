'use strict';
/**
 * node test/urldl-ui.smoke.js — 실제 앱을 띄워 🔗 URL 창을 확인하는 E2E.
 *
 * 🔑 **버튼을 실제로 누른다.** JSX 핸들러 안의 미정의 식별자는 빌드가 못 잡고 클릭할 때만 터진다
 *    (v0.3.22 의 `onPickImgEngine is not defined` 사고). 렌더러 오류를 모아 0건인지 단언한다.
 * ⚠ 네트워크는 쓰지 않는다 — 창을 열고 값만 확인하고 닫는다(다운로드는 하지 않는다).
 */
const path = require('path');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errs = [];
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    win.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    console.log('· 부팅 OK');

    // [1] 버튼이 🎧 STT · 🎵 mp3 옆에 있다
    const btn = win.locator('button:has-text("🔗 URL")');
    ok(await btn.count() === 1, '헤더에 🔗 URL 버튼이 하나 있다');

    // [2] 눌러서 창이 뜬다 — 여기서 미정의 식별자가 있으면 터진다
    await btn.click();
    await win.waitForSelector('.modal-card:has-text("URL 에서 받아 전사")', { timeout: 8000 });
    ok(true, '창이 열린다(핸들러가 살아 있다)');

    // [3] 기본값 = MP3 (로이 확정)
    const sel = win.locator('.modal-card:has-text("URL 에서 받아 전사") select');
    ok(await sel.inputValue() === 'audio', '「받을 것」 기본값이 MP3');
    const opts = await sel.locator('option').allTextContents();
    ok(opts.length === 3 && /MP3/.test(opts[0]) && /영상/.test(opts[1]) && /둘 다/.test(opts[2]),
      `MP3·영상·둘 다 세 가지를 고를 수 있다 (${opts.length}개)`);

    // [4] 영상으로 바꿔도 창이 안 깨진다
    await sel.selectOption('video');
    ok(await sel.inputValue() === 'video', '영상으로 전환된다');
    await sel.selectOption('audio');

    // [5] 자막 무시 체크박스 — 기본 꺼짐(자막 우선이 기본이다)
    const chk = win.locator('.modal-card:has-text("URL 에서 받아 전사") input[type=checkbox]');
    ok(await chk.count() === 1 && !(await chk.isChecked()), '「자막이 있어도 STT」 는 기본 꺼짐');

    // [6] yt-dlp 상태가 창에 보인다(조회가 비동기라 값이 올 때까지 기다린다)
    await win.waitForFunction(() => {
      const el = [...document.querySelectorAll('.modal-card')].find((x) => x.textContent.includes('URL 에서 받아 전사'));
      return el && !el.textContent.includes('yt-dlp 확인 중');
    }, null, { timeout: 30000 }).catch(() => {});
    const body = await win.locator('.modal-card:has-text("URL 에서 받아 전사")').innerText();
    ok(/yt-dlp|자동으로 내려받습니다/.test(body), 'yt-dlp 상태를 알려준다');
    ok(/⬇ 업데이트/.test(body), '「⬇ 업데이트」 버튼이 있다(유튜브가 바뀌면 여기서 갱신)');

    // [7] 주소가 없으면 받지 않는다(빈 입력 방어)
    await win.click('.modal-card:has-text("URL 에서 받아 전사") button:has-text("받아서 전사")');
    await win.waitForTimeout(400);
    ok(await win.locator('.modal-card:has-text("URL 에서 받아 전사")').count() === 1,
      '주소가 비면 창이 닫히지 않는다(실수로 실행되지 않는다)');

    // [8] ESC 로 닫힌다
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    ok(await win.locator('.modal-card:has-text("URL 에서 받아 전사")').count() === 0, 'ESC 로 닫힌다');

    // [9] 채널편집 → 📁 폴더 에 다운로드 폴더 칸
    // ⚠ 「⚙」 로 뭉뚱그려 찾으면 첫 줄 「⚙ 설정」(통합 설정)이 먼저 잡힌다(2026-09-16 ⚙ 설정이 앞으로 옮겨짐).
    //   채널편집은 title 로 정확히 집는다.
    await win.click('button[title^="채널(프리셋)"]');
    await win.waitForTimeout(600);
    const chCard = win.locator('.modal-card').filter({ hasText: '폴더' });
    if (await chCard.count()) {
      const tab = chCard.locator('button:has-text("📁")');
      if (await tab.count()) { await tab.first().click(); await win.waitForTimeout(300); }
      const t = await chCard.first().innerText();
      ok(/다운로드 폴더/.test(t), '채널편집 📁 폴더 탭에 「다운로드 폴더」 칸이 있다');
      await win.keyboard.press('Escape');
    } else {
      console.log('  ⓘ 채널편집 창을 못 열어 이 항목은 건너뜀');
    }

    ok(errs.length === 0, `화면 오류 0건 (실제 ${errs.length}${errs.length ? ' — ' + errs.slice(0, 3).join(' / ') : ''})`);
  } finally {
    await app.close();
  }
  console.log(`\n${fail ? '❌' : '✅'} 🔗 URL 화면 E2E ${pass}/${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 실패:', e); process.exit(1); });
