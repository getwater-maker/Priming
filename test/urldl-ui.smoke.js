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
const menu = require('./_menu');

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

    // [1] 📥 다운로드 버튼(v0.9.17 · 옛 대본다운 + 🎧 STT + 🎵 mp3) — 리본 오른쪽 끝(상시) 「📄 대본 보기」 바로 앞
    ok(await win.locator('button:has-text("🔗 URL")').count() === 0, '옛 🔗 URL 버튼이 없다');
    const btn = win.locator('[data-testid="urldl-open"]');
    ok(await btn.count() === 1 && /다운로드/.test(await btn.innerText()), '📥 다운로드 버튼이 하나 있다');
    const order = await win.locator('.rb-reader button').evaluateAll((bs) => bs.map((b) => b.dataset.testid || ''));
    ok(order.indexOf('urldl-open') >= 0 && order.indexOf('urldl-open') + 1 === order.indexOf('reader-open'), `다운로드가 대본 보기 바로 앞 (${order.join(', ')})`);
    for (const m of ['image', 'finish']) {
      await menu(win, m);
      ok(await btn.isVisible(), `${m} 메뉴에서도 보인다(상시)`);
    }
    await menu(win, 'script');
    ok(await win.locator('.ribbon .rb-t', { hasText: /^STT$/ }).count() === 0 && await win.locator('.ribbon .rb-t', { hasText: /^mp3$/ }).count() === 0,
      '리본에 옛 🎧 STT · 🎵 mp3 버튼이 없다(📂 내 파일 탭으로 합침)');

    // [2] 눌러서 창이 뜬다 — 여기서 미정의 식별자가 있으면 터진다
    await btn.click();
    await win.waitForSelector('[data-testid="dl-modal"]', { timeout: 8000 });
    const card = win.locator('[data-testid="dl-modal"]');
    ok(/다운로드 · STT/.test(await card.locator('h3').innerText()), '창이 열린다 — 제목 「📥 다운로드 · STT」');
    ok(await card.locator('[data-testid="dl-tab-link"]').count() === 1 && await card.locator('[data-testid="dl-tab-file"]').count() === 1, '탭 두 개(🔗 링크 · 📂 내 파일)');

    // [3] 링크 줄 = 📋 링크 붙여넣기 · 다운로드(오디오/영상) · STT 전사 — 화질 칸 없음
    const bar = card.locator('[data-testid="dl-linkbar"]');
    ok(await bar.locator('button:has-text("📋 링크 붙여넣기")').count() === 1, '링크 줄에 「📋 링크 붙여넣기」');
    const sel = card.locator('[data-testid="dl-mode"]');
    ok(await sel.inputValue() === 'audio', '「다운로드」 기본값 = 오디오(로이 확정)');
    const opts = await sel.locator('option').allTextContents();
    ok(opts.length === 3 && /오디오/.test(opts[0]) && /영상/.test(opts[1]) && /자막/.test(opts[2]), `오디오·영상·자막 (${opts.join(' | ')})`);
    ok(await bar.locator('select').count() === 1 && !/화질/.test(await bar.innerText()), '화질 칸이 없다(늘 최고)');
    const on = async (l) => (await l.getAttribute('aria-pressed')) === 'true';   // ✓ 켜고 끄는 버튼(v0.9.18 — 체크박스 아님)
    const hints = async () => (await card.locator('.hint-src').allTextContents()).join(' ');   // 설명은 숨김 → 마우스 팝업
    const sttChk = card.locator('[data-testid="dl-stt"]');
    ok(await on(sttChk), '「STT 전사」 기본 켜짐(옛 대본다운과 같은 동작)');
    await sel.selectOption('video');
    ok(await sel.inputValue() === 'video', '영상으로 전환된다');
    await card.locator('[data-testid="dl-quality"]').selectOption('1080');
    ok(await card.locator('[data-testid="dl-quality"]').inputValue() === '1080', '최대 해상도를 선택한다');
    await sel.selectOption('subtitles');
    ok(await sttChk.isDisabled(), '자막만 받기는 STT를 실행하지 않는다');
    await card.locator('[data-testid="dl-sub-format"]').selectOption('txt');
    await card.locator('[data-testid="dl-sub-lang"]').selectOption('en');
    await card.locator('[data-testid="dl-sub-track"]').selectOption('auto');
    ok(await card.locator('[data-testid="dl-sub-format"]').inputValue() === 'txt', '자막 형식·언어·트랙 선택');
    await sel.selectOption('audio');
    await card.locator('[data-testid="dl-audio-format"]').selectOption('m4a');
    ok(await card.locator('[data-testid="dl-audio-format"]').inputValue() === 'm4a', 'M4A 음원을 선택한다');
    const runBtn = card.locator('[data-testid="dl-run"]');
    ok(/받아서 전사/.test(await runBtn.innerText()), 'STT 켜짐 → 「받아서 전사」');
    await sttChk.click();
    ok(/^받기$/.test((await runBtn.innerText()).trim()), 'STT 끔 → 「받기」');
    ok(await card.locator('[data-testid="dl-force"]').count() === 0, 'STT 를 끄면 「자막이 있어도 Whisper」 칸도 숨는다');
    ok(/STT 전사는 끄고 파일/.test(await hints()), 'STT와 자막 파일 저장을 구분해 안내한다');
    ok(await card.locator('.hint-i').count() === 0 && !/파일만 받습니다/.test(await card.innerText()), '설명글은 화면에 늘어놓지 않는다(ⓘ 도 없음)');
    ok(await card.locator('[data-testid="dl-sites"] .dl-site').count() >= 8, '주소 칸 위에 사이트 로고가 늘어서 있다');
    await sttChk.click();

    // [5] 채널 전체·자막 무시 체크박스 — 둘 다 명시적으로 켜야 한다
    const channelChk = card.locator('[data-testid="dl-channel"]');
    const forceChk = card.locator('[data-testid="dl-force"]');
    ok(await channelChk.count() === 1 && !(await on(channelChk)), '「채널 전체」는 기본 꺼짐(단일 URL 안전 유지)');
    ok(await forceChk.count() === 1 && !(await on(forceChk)), '「자막이 있어도 STT」는 기본 꺼짐');
    await channelChk.click();
    ok(/채널 전체 받아서 전사/.test(await runBtn.innerText()), '채널 모드에서는 실행 버튼 문구가 분명히 바뀐다');
    await channelChk.click();

    // [6] yt-dlp 상태가 창에 보인다(조회가 비동기라 값이 올 때까지 기다린다)
    await win.waitForFunction(() => {
      const el = document.querySelector('[data-testid="dl-modal"]');
      return el && !el.textContent.includes('yt-dlp 확인 중');
    }, null, { timeout: 30000 }).catch(() => {});
    const body = await card.innerText();
    ok(/yt-dlp|자동으로 내려받습니다/.test(body), 'yt-dlp 상태를 알려준다');
    ok(/⬇ 업데이트/.test(body), '「⬇ 업데이트」 버튼이 있다(유튜브가 바뀌면 여기서 갱신)');
    ok(/최대 해상도/.test(await hints()), '최고 화질 기본값과 해상도 선택을 안내한다');

    // [7] 주소가 없으면 받지 않는다(빈 입력 방어)
    await runBtn.click();
    await win.waitForTimeout(400);
    ok(await win.locator('[data-testid="dl-modal"]').count() === 1, '주소가 비면 창이 닫히지 않는다(실수로 실행되지 않는다)');

    // [7-b] 📋 링크 붙여넣기 — 클립보드에 주소가 없으면 받지 않고 창을 그대로 둔다(네트워크 안 씀)
    await app.evaluate(({ clipboard }) => clipboard.writeText('주소가 아닌 그냥 글'));
    await bar.locator('button:has-text("📋 링크 붙여넣기")').click();
    await win.waitForTimeout(400);
    ok(await win.locator('[data-testid="dl-modal"]').count() === 1, '클립보드에 주소가 없으면 받지 않는다(창 유지)');
    ok((await card.locator('textarea').inputValue()) === '', '엉뚱한 글을 칸에 넣지 않는다');
    try { await card.screenshot({ path: process.env.PM_SHOT_LINK || require('path').join(require('os').tmpdir(), 'dl-link.png') }); } catch {}

    // [7-c] 📂 내 파일 탭 — mp3 추출 · STT 전사 체크 + 파일 고르기(둘 다 끄면 못 누른다)
    const linkBox = await card.boundingBox();
    await card.locator('[data-testid="dl-tab-file"]').click();
    { const fb = await card.boundingBox(); ok(Math.abs(fb.width - linkBox.width) < 2 && Math.abs(fb.height - linkBox.height) < 2, `두 탭 창 크기가 같다 (${Math.round(linkBox.width)}×${Math.round(linkBox.height)} / ${Math.round(fb.width)}×${Math.round(fb.height)})`); }
    const mp3Chk = card.locator('[data-testid="dl-file-mp3"]'), fSttChk = card.locator('[data-testid="dl-file-stt"]');
    ok(await mp3Chk.count() === 1 && !(await on(mp3Chk)), '📂 mp3 추출 칸(기본 꺼짐)');
    ok(await fSttChk.count() === 1 && await on(fSttChk), '📂 STT 전사 칸(기본 켜짐)');
    const fileRun = card.locator('[data-testid="dl-file-run"]');
    ok(await fileRun.isEnabled(), '「📂 파일 고르기」 누를 수 있다');
    await fSttChk.click();
    ok(await fileRun.isDisabled(), '둘 다 끄면 「파일 고르기」를 못 누른다');
    await mp3Chk.click();
    ok(await fileRun.isEnabled(), 'mp3 만 켜도 누를 수 있다');
    // 파일 고르기 → 취소(빈 목록)면 아무 일도 하지 않고 창도 그대로
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await fileRun.click();
    await win.waitForTimeout(400);
    ok(await win.locator('[data-testid="dl-modal"]').count() === 1, '파일을 안 고르면 창이 그대로다');
    try { await card.screenshot({ path: process.env.PM_SHOT_FILE || require('path').join(require('os').tmpdir(), 'dl-file.png') }); } catch {}
    await card.locator('[data-testid="dl-tab-link"]').click();

    // [8] ESC 로 닫힌다
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="dl-modal"]').count() === 0, 'ESC 로 닫힌다');

    // [10] 📊 진행 패널 — main 이 보내는 urldl-progress 를 그대로 그린다(실제 다운로드 없이 이벤트만 흉내)
    const sendProg = (p) => app.evaluate(({ BrowserWindow }, p) => {
      BrowserWindow.getAllWindows()[0].webContents.send('urldl-progress', p);
    }, p);
    const base = { total: 40, startedAt: Date.now() - 65000, outDir: 'C:\\tmp\\채널', sub: 3, skip: 2, fail: 1,
      fails: [{ idx: 7, title: '실패한 영상', error: '비공개 영상입니다' }] };
    await sendProg({ ...base, phase: 'running',
      dl: { done: 12, idx: 13, title: '열세 번째 영상', pct: 47.3, stage: 'download' },
      stt: { done: 6, pending: 2, cur: { idx: 10, title: '열 번째 영상', chunk: 1, chunks: 3, startedAt: Date.now() - 20000 } } });
    await win.waitForSelector('[data-testid="urldl-progress"]', { timeout: 5000 }).catch(() => {});
    const pnl = win.locator('[data-testid="urldl-progress"]');
    ok(await pnl.count() === 1, '진행 패널이 나타난다');
    const pt = await pnl.innerText();
    ok(/받기\s*12\s*\/\s*40/.test(pt), `받기 12 / 40 을 보여 준다`);
    ok(/\[13\] 열세 번째 영상/.test(pt) && /받는 중 47%/.test(pt), '지금 받는 영상과 퍼센트를 보여 준다');
    ok(/전사\s*6\s*\/\s*9/.test(pt) && /대기 2건/.test(pt), '전사 6 / 9 · 대기 2건(완료+대기+진행)을 보여 준다');
    ok(/\[10\] 열 번째 영상/.test(pt) && /청크 1\/3/.test(pt), '지금 전사 중인 영상과 청크를 보여 준다');
    ok(/\.txt 완료\s*11/.test(pt) && /실패 1/.test(pt), '.txt 완료(전사+자막+이미완료) · 실패 수');
    ok(/받기 남은 시간 약/.test(pt), '받기 남은 시간을 어림한다');
    ok(await pnl.locator('button:has-text("⏹ 중단")').count() === 1, '진행 중에는 ⏹ 중단 버튼');
    await sendProg({ ...base, phase: 'done', okN: 39, endedAt: Date.now(),
      dl: { done: 40, idx: 0, title: '', pct: 0, stage: '' }, stt: { done: 34, pending: 0, cur: null } });
    await win.waitForTimeout(400);
    const pt2 = await pnl.innerText();
    ok(/✅ 끝/.test(pt2) && /저장: /.test(pt2), '끝나면 「끝」과 저장 폴더를 보여 준다');
    await pnl.locator('button:has-text("닫기")').click();
    await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="urldl-progress"]').count() === 0, '닫기로 패널이 사라진다');

    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      ipcMain.removeHandler('stt-from-url');
      ipcMain.handle('stt-from-url', (_e, args) => {
        if (args.mode !== 'subtitles' || args.subtitleFormat !== 'txt' || args.subtitleLanguage !== 'en' || args.subtitleTrack !== 'auto') throw new Error('자막 설정 IPC 누락');
        BrowserWindow.getAllWindows()[0].webContents.send('urldl-progress', {
          phase: 'done', total: 1, startedAt: Date.now(), endedAt: Date.now(), doStt: false, okN: 1,
          savedSubs: 1, sub: 0, skip: 0, fail: 0, fails: [], outDir: 'C:\\test',
          dl: { done: 1, idx: 0, pct: 100, stage: 'done' }, stt: { done: 0, pending: 0, cur: null },
        });
        return { ok: true, results: [{ ok: true, subtitles: ['sample.en.txt'] }] };
      });
    });
    await btn.click();
    await win.waitForSelector('[data-testid="dl-modal"]');
    await win.locator('[data-testid="dl-mode"]').selectOption('subtitles');
    await win.locator('[data-testid="dl-modal"] textarea').fill('https://www.youtube.com/watch?v=oKRJ0kiHHLw');
    await win.locator('[data-testid="dl-run"]').click();
    await win.waitForSelector('[data-testid="dl-modal"] [data-testid="urldl-progress"]');
    ok(await win.locator('[data-testid="dl-modal"]').count() === 1, '다운로드 실행 후에도 팝업을 유지한다');
    const embedded = await win.locator('[data-testid="dl-modal"] [data-testid="urldl-progress"]').innerText();
    ok(/자막 저장 1개/.test(embedded) && !/전사할 영상을/.test(embedded), '자막 저장 결과를 팝업 안에서 표시한다');

    ok(errs.length === 0, `화면 오류 0건 (실제 ${errs.length}${errs.length ? ' — ' + errs.slice(0, 3).join(' / ') : ''})`);
  } finally {
    await app.close();
  }
  console.log(`\n${fail ? '❌' : '✅'} 🔗 URL 화면 E2E ${pass}/${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 실패:', e); process.exit(1); });
