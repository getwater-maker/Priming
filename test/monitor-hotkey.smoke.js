'use strict';
// node test/monitor-hotkey.smoke.js — 🌙 모니터 끄기 전역 단축키(ScrollLock) 등록 확인. 실제로 누르진 않는다(진짜 모니터가 꺼진다).
const path = require('path');
const { _electron: electron } = require('playwright');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };
(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '..')], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForTimeout(1500);
    const reg = await app.evaluate(({ globalShortcut }) => ({ sl: globalShortcut.isRegistered('Scrolllock') }));
    ok(reg.sl, 'ScrollLock 전역 단축키 등록됨');
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    ok(/function monitorOff\(\)/.test(src) && /ipcMain\.handle\('monitor-off', \(\) => monitorOff\(\)\)/.test(src), '버튼(IPC)과 단축키가 같은 monitorOff() 한 곳을 쓴다');
    ok(/globalShortcut\.unregisterAll\(\)/.test(src), '종료 때 단축키 해제');
  } finally { await app.close(); }
  console.log(`\n${bad ? '❌' : '✅'} monitor-hotkey — ${n - bad}/${n} 통과`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
