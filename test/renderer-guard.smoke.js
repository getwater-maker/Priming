'use strict';
/**
 * node test/renderer-guard.smoke.js — 🩹 화면(렌더러) 프로세스가 죽으면 기록하고 다시 띄운다 (v1.0.47)
 *   [1] 판정(core/renderer-guard) — clean-exit 무시 · 3분 안 3번까지만 · 메모리 MB 계산
 *   [2] 실제 앱 E2E — forcefullyCrashRenderer() 로 화면을 죽이면 로그 줄 + 화면(h1)이 다시 뜬다
 *       A/B: main 의 _guardRenderer 호출을 빼면 [2] 가 실패한다(화면이 돌아오지 않음)
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RG = require(path.join(ROOT, 'core', 'renderer-guard'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

console.log('\n[1] 판정');
{
  const t0 = 1_000_000;
  ok(RG.decide([], t0, 'clean-exit').reload === false, 'clean-exit(창 닫기) = 다시 띄우지 않음');
  let r = RG.decide([], t0, 'oom'); ok(r.reload && r.times.length === 1, '첫 사고 = 다시 띄움');
  r = RG.decide(r.times, t0 + 1000, 'crashed'); r = RG.decide(r.times, t0 + 2000, 'crashed');
  ok(r.reload && r.times.length === 3, '3번째까지 다시 띄움');
  const r4 = RG.decide(r.times, t0 + 3000, 'crashed');
  ok(!r4.reload && r4.gaveUp, '3분 안 4번째 = 멈춤(끝없이 돌지 않게)');
  ok(RG.decide(r.times, t0 + RG.WINDOW_MS + 5000, 'crashed').reload, '3분 지나면 다시 셈');
  ok(RG.rendererMemMB([{ pid: 7, type: 'Tab', memory: { privateBytes: 2048 * 1024 } }], 7) === 2048, 'privateBytes KB → MB');
  ok(RG.rendererMemMB([{ pid: 7, type: 'Tab', memory: { workingSetSize: 1024 } }], 8) === null, '다른 pid = null(판정력)');
  ok(RG.reasonKo('oom') === '메모리 부족', '이유 한국어');
}

(async () => {
  console.log('\n[2] 실제 앱 — 화면을 강제로 죽인다');
  const { _electron: electron } = require('playwright');
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    await app.evaluate(({ BrowserWindow }) => {
      global.__logs = [];
      // log() 는 화면에도 보내므로 webContents.send('log', …) 를 엿본다
      const w = BrowserWindow.getAllWindows()[0];
      const orig = w.webContents.send.bind(w.webContents);
      w.webContents.send = (ch, ...a) => { if (ch === 'log') global.__logs.push(String(a[0] && (a[0].line || a[0].text || a[0]))); return orig(ch, ...a); };
      global.__pid0 = w.webContents.getOSProcessId();
      setTimeout(() => w.webContents.forcefullyCrashRenderer(), 100);
    });
    let back = false, pid1 = 0;
    for (let i = 0; i < 40 && !back; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const st = await app.evaluate(({ BrowserWindow }) => {
          const w = BrowserWindow.getAllWindows()[0];
          const s = { pid: w.webContents.getOSProcessId(), crashed: w.webContents.isCrashed(), loading: w.webContents.isLoading(), pid0: global.__pid0 };
          if (s.crashed || s.loading || !s.pid || s.pid === s.pid0) return s;
          // ⚠ Playwright 의 페이지 객체는 한 번 죽으면 「Target crashed」로 굳는다 — 본체가 직접 새 화면을 들여다본다
          return w.webContents.executeJavaScript('!!document.querySelector("h1")').then((h1) => ({ ...s, h1 }));
        });
        if (process.env.DBG) console.log('    ', JSON.stringify(st));
        if (st.h1) { back = true; pid1 = st.pid; }
      } catch (_) {}
    }
    ok(back, `화면이 새 프로세스(pid ${pid1})로 다시 떴다 — h1 보임`);
    const logs = await app.evaluate(() => global.__logs);
    ok(logs.some((l) => /화면 프로세스가 멈췄습니다/.test(l)), '「화면 프로세스가 멈췄습니다」 로그(이유·코드)');
    ok(logs.some((l) => /화면을 다시 띄웠습니다/.test(l)), '「화면을 다시 띄웠습니다」 로그');
  } catch (e) { fail++; console.log('  ✗ 예외: ' + (e && e.stack || e)); }
  finally { await app.close().catch(() => {}); }
  console.log(`\n${fail ? '❌' : '✅'} renderer-guard: ${pass} 통과 · ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
