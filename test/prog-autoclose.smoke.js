'use strict';
// node test/prog-autoclose.smoke.js — 🗂 진행 팝업 자동 닫기가 **여러 팝업이 함께 떠 있을 때도** 도는지(v0.6.49).
//   🔴 사고(로이 2026-10-03): 셋을 한 효과에 묶어, 만들기 팝업이 1초마다 갱신될 때마다 끝난 MP4·업로드 팝업의
//     타이머가 지워졌다 → 큐가 도는 동안 영영 안 닫혔다. 팝업 하나만 띄운 test:makeall 은 이걸 못 잡았다.
//   여기선 main 에서 직접 소식을 보낸다: 만들기 = 0.5초마다 「진행 중」, MP4·업로드 = 「완료」 한 번.
//   판정력: 옛 코드(한 효과)면 MP4·업로드가 8초 안에 닫히지 않아 실패한다.
//   상태를 바꾸지 않는다(소식 표시만) — 큐·채널·설정 파일을 건드리지 않는다.
const path = require('path');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };
const gone = (win, id, ms) => win.waitForSelector(`[data-testid="${id}"]`, { state: 'detached', timeout: ms }).then(() => true, () => false);

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errs = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push(e.message));
    await win.waitForSelector('h1', { timeout: 20000 });

    // 만들기 팝업 — 0.5초마다 새 「진행 중」 소식(실제 main 은 1초마다)
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const t0 = Date.now();
      const st = (s) => ({ state: s, note: '' });
      global.__mkTick = setInterval(() => {
        w.webContents.send('make-progress', {
          title: '팝업 닫기 점검', queue: { idx: 1, total: 2 }, phase: 'running', startedAt: t0, now: Date.now(),
          stages: { tts: st('run'), image: st('wait'), video: st('wait'), out: st('wait') },
          sent: { done: 1, total: 5, cur: { num: 2, text: '둘째' } }, image: { done: 0, total: 2, active: [] }, video: { done: 0, total: 1, active: [] },
        });
      }, 500);
    });
    await win.waitForSelector('[data-testid="make-progress"]', { timeout: 5000 });
    ok(true, '만들기 팝업이 떠 있다(0.5초마다 갱신 중)');

    // MP4·업로드 — 「완료」 한 번
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const now = Date.now();
      w.webContents.send('mp4-progress', { phase: 'done', title: '점검', startedAt: now - 5000, endedAt: now, video: { done: 1, total: 1, framesDone: 1, framesTotal: 1, active: [] }, audio: 'done', outPath: 'x.mp4' });
      w.webContents.send('yt-progress', { phase: 'done', title: '점검', startedAt: now - 3000, endedAt: now, sent: 1, total: 1 });
    });
    await win.waitForSelector('[data-testid="mp4-progress"]', { timeout: 3000 });
    ok(await win.locator('text=유튜브 업로드 완료').count() >= 1, 'MP4·업로드 완료 팝업이 떴다');

    ok(await gone(win, 'mp4-progress', 8000), '🔴 만들기 팝업이 갱신되는 중에도 끝난 MP4 팝업은 닫힌다');
    ok(await win.locator('text=유튜브 업로드 완료').count() === 0, '🔴 끝난 업로드 팝업도 닫힌다');
    ok(await win.locator('[data-testid="make-progress"]').count() === 1, '진행 중인 만들기 팝업은 남아 있다');

    // 만들기도 끝나면 닫힌다
    await app.evaluate(({ BrowserWindow }) => {
      clearInterval(global.__mkTick);
      const w = BrowserWindow.getAllWindows()[0];
      const st = (s) => ({ state: s, note: '' });
      w.webContents.send('make-progress', { title: '팝업 닫기 점검', phase: 'error', error: '점검용 실패', startedAt: Date.now() - 9000, endedAt: Date.now(), now: Date.now(),
        stages: { tts: st('done'), image: st('done'), video: st('skip'), out: st('run') }, sent: { done: 5, total: 5 }, image: { done: 2, total: 2, active: [] }, video: { done: 0, total: 1, active: [] } });
    });
    ok(await gone(win, 'make-progress', 8000), '실패로 끝난 만들기 팝업도 닫힌다');
    ok(errs.length === 0, '화면 오류 0건' + (errs[0] ? ': ' + errs[0] : ''));
  } catch (e) {
    ok(false, '예외: ' + e.message);
  } finally {
    try { await app.evaluate(() => clearInterval(global.__mkTick)); } catch (_) {}
    await app.close();
  }
  console.log(bad ? `\n❌ ${bad}/${n} 실패` : `\n✅ 진행 팝업 자동 닫기 E2E ${n}/${n} 통과`);
  process.exit(bad ? 1 : 0);
})();
