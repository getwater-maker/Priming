'use strict';
// node test/stt-progress.smoke.js — 🎧 STT 진행 패널(stt-progress) 화면 E2E.
//   main 이 보내는 상태를 흉내 내(webContents.send) 단계 표시·청크·경과·중단/닫기를 본다. ⚠ 실제 Whisper 서버는 부르지 않는다.
const path = require('path');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
(async () => {
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 820); });
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    const send = (prog) => app.evaluate(({ BrowserWindow }, p) => { BrowserWindow.getAllWindows()[0].webContents.send('stt-progress', p); }, prog);
    const now = Date.now();
    const base = { phase: 'running', startedAt: now - 65000, total: 2, done: 0, fail: 0, modelLoaded: false, fails: [] };

    await send({ ...base, cur: { idx: 1, name: '통화 양주시청.m4a', stage: 'convert', startedAt: now - 5000, stageAt: now - 5000, chunk: 0, chunks: 0 } });
    await win.waitForSelector('[data-testid=stt-progress]', { timeout: 5000 });
    ok(/변환/.test(await win.locator('.stt-steps .cur').innerText()) && /mp3 로 바꾸는 중/.test(await win.locator('[data-testid=stt-progress]').innerText()), '① 변환 단계가 강조된다');

    await send({ ...base, cur: { idx: 1, name: '통화 양주시청.m4a', stage: 'queue', startedAt: now - 9000, stageAt: now - 3000, chunk: 0, chunks: 0 } });
    await win.waitForTimeout(200);
    ok(/차례/.test(await win.locator('.stt-steps .cur').innerText()) && (await win.locator('.stt-steps .done').count()) === 1, '② 차례(GPU 대기) 단계 · 앞 단계는 완료 표시');

    await send({ ...base, cur: { idx: 1, name: '통화 양주시청.m4a', stage: 'transcribe', startedAt: now - 20000, stageAt: now - 10000, chunkAt: now - 10000, chunk: 0, chunks: 3, durationSec: 2400 } });
    await win.waitForTimeout(200);
    const t1 = await win.locator('[data-testid=stt-progress]').innerText();
    ok(/청크 1\/3 전사 중/.test(t1) && /음성 40분 분량/.test(t1) && /Whisper 모델을 불러오는 중/.test(t1), `③ 전사 — 청크 1/3 · 음성 길이 · 모델 로딩 안내`);
    ok((await win.locator('.stt-run').count()) === 1, '지금 덩어리가 돌고 있다는 움직이는 띠');

    await send({ ...base, modelLoaded: true, cur: { idx: 1, name: '통화 양주시청.m4a', stage: 'transcribe', startedAt: now - 620000, stageAt: now - 600000, chunkAt: now - 30000, chunk: 1, chunks: 3, durationSec: 2400 } });
    await win.waitForTimeout(200);
    const t2 = await win.locator('[data-testid=stt-progress]').innerText();
    ok(/청크 2\/3/.test(t2) && /남은 시간 약/.test(t2) && !/모델을 불러오는 중/.test(t2), '청크 1개 끝난 뒤 — 청크 2/3 · 남은 시간 어림');
    const w = await win.evaluate(() => parseFloat(document.querySelector('.stt-bar.big > i').style.width));
    ok(Math.abs(w - 33.3) < 1, `끝난 덩어리 만큼 막대가 찬다 (${w.toFixed(1)}%)`);

    // 중단 → main 의 dl-abort 로 간다(상태만 확인)
    await win.locator('[data-testid=stt-progress] button:has-text("중단")').click(); await win.waitForTimeout(300);
    ok(/중단 중/.test(await win.locator('[data-testid=stt-progress]').innerText()), '⏹ 중단 → 「중단 중」 표시');

    await send({ ...base, phase: 'done', done: 1, fail: 1, okN: 1, endedAt: now, cur: null, fails: [{ name: 'b.m4a', error: '서버 응답 없음' }] });
    await win.waitForTimeout(300);
    const t3 = await win.locator('[data-testid=stt-progress]').innerText();
    ok(/전사 끝/.test(t3) && /성공 1 \/ 2/.test(t3) && /실패 1건/.test(t3), '끝 — 성공/실패 요약');
    await win.locator('[data-testid=stt-progress] button:has-text("닫기")').click(); await win.waitForTimeout(200);
    ok((await win.locator('[data-testid=stt-progress]').count()) === 0, '닫기');
    ok(errors.length === 0, '화면 오류 0건 (' + errors.join(' | ') + ')');
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} STT 진행 패널 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
