'use strict';

/**
 * chrome-profile.js — 자동화용 크롬 프로필 정리 + 실행 오류를 사람 말로.
 *
 * 🔴 배경(2026-08-26, 아내 PC 로그): Grok 이 정식 Chrome 실행에 실패하고
 *   (`Target page, context or browser has been closed`) 번들 Chromium 폴백도
 *   `Executable doesn't exist at ...chromium-1223` 로 죽어 **G2 영상이 통째로 실패**했다.
 *   화면엔 영어 스택트레이스만 나와 무엇을 해야 하는지 알 수 없었다.
 *
 * 🔑 원인 두 겹:
 *   ① 크롬이 비정상 종료하면 프로필의 `Preferences.exit_type = "Crashed"` 가 남아 다음 실행 때
 *      복원 안내가 뜨고 자동화 컨텍스트가 그대로 닫힌다. **Flow 경로만** 이걸 고치고 있었고
 *      (main.cleanChromeProfile) Grok·Genspark 는 Singleton 락만 지웠다.
 *   ② 폴백용 Playwright 번들 Chromium 이 그 PC 에 안 깔려 있었다(설치는 사용자가 해야 한다).
 */

const fs = require('fs');
const path = require('path');

/** Singleton 락 제거 + 크래시 표시 정상화. 실패해도 던지지 않는다(정리는 best-effort). */
function cleanProfile(profileDir) {
  if (!profileDir) return;
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.rmSync(path.join(profileDir, f), { force: true }); } catch (_) {}
  }
  for (const sub of ['Default', '']) {
    try {
      const pref = path.join(profileDir, sub, 'Preferences');
      if (!fs.existsSync(pref)) continue;
      const j = JSON.parse(fs.readFileSync(pref, 'utf8'));
      j.profile = j.profile || {};
      j.profile.exit_type = 'Normal';
      j.profile.exited_cleanly = true;
      fs.writeFileSync(pref, JSON.stringify(j));
    } catch (_) {}
  }
}

/**
 * 브라우저 실행 오류를 무엇을 해야 하는지가 보이는 한 줄로.
 * @param {Error} e
 * @param {string} who  'Grok' | 'Genspark' | 'Flow'
 */
function explainLaunchError(e, who) {
  const raw = String((e && e.message) || e || '');
  const first = raw.split('\n')[0].slice(0, 160);
  if (/Executable doesn't exist|playwright install/i.test(raw)) {
    return `${who}: 브라우저가 없습니다 — 이 PC 에 Chrome 이 없거나 실행에 실패했고, 대체용 Chromium 도 설치돼 있지 않습니다. `
      + `① Chrome 설치(https://www.google.com/chrome) 를 권합니다. `
      + `② 또는 앱 설치 폴더에서 "npx playwright install chromium" 을 한 번 실행하세요.`;
  }
  if (/Target page, context or browser has been closed|browser has disconnected/i.test(raw)) {
    return `${who}: 크롬이 시작하자마자 닫혔습니다 — 같은 프로필을 쓰는 크롬 창이 열려 있거나 이전에 비정상 종료한 흔적입니다. `
      + `열려 있는 크롬 창을 모두 닫고 다시 시도하세요(앱이 프로필을 정리하고 한 번 더 시도합니다). 원문: ${first}`;
  }
  if (/ENOENT|spawn/i.test(raw)) {
    return `${who}: 브라우저 실행 파일을 찾지 못했습니다 — Chrome 설치를 확인하세요. 원문: ${first}`;
  }
  return `${who}: 브라우저 실행 실패 — ${first}`;
}

/**
 * 번들 Chromium(폴백 브라우저)을 **앱이 직접** 내려받는다.
 *   🔴 사용자가 터미널에서 `npx playwright install chromium` 을 돌리면 **엉뚱한 버전**이 깔린다 —
 *     npx 가 최신 playwright(예 1.62.1)를 임시로 받아 그쪽 revision(chromium-1234)을 설치하는데,
 *     앱이 쓰는 playwright 는 1.60.0 이라 **chromium-1223** 을 찾는다(2026-08-26 아내 PC 실측).
 *     → 앱에 들어 있는 playwright CLI 로 돌려야 버전이 맞는다.
 *   🔑 Electron 에서 node 스크립트를 돌리는 방법: process.execPath + ELECTRON_RUN_AS_NODE=1
 *     (출판 PDF 의 vivliostyle CLI 와 같은 패턴).
 * @returns {Promise<{ok:boolean, message:string}>}
 */
function installBundledChromium(logger) {
  const log = typeof logger === 'function' ? logger : () => {};
  return new Promise((resolve) => {
    // ⚠ require.resolve('playwright/cli.js') 는 package.json 의 exports 제한에 막힌다 —
    //   파일 경로로 직접 찾는다(개발 저장소·설치본 둘 다 app 루트 옆에 node_modules 가 있다).
    const APP_ROOT = path.join(__dirname, '..');
    let cli = '';
    for (const m of [['playwright', 'cli.js'], ['playwright-core', 'cli.js']]) {
      const p = path.join(APP_ROOT, 'node_modules', m[0], m[1]);
      if (fs.existsSync(p)) { cli = p; break; }
    }
    if (!cli) { resolve({ ok: false, message: '앱 안에서 playwright CLI 를 찾지 못했습니다 — 앱을 다시 설치해 주세요.' }); return; }
    let ver = '?';
    try { ver = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'node_modules', 'playwright', 'package.json'), 'utf8')).version; } catch (_) {}
    log('⬇ 브라우저(Chromium) 설치 시작 — 앱의 playwright ' + ver + ' 에 맞는 판을 받습니다. 수백 MB 라 몇 분 걸립니다.');
    const { spawn } = require('child_process');
    let child;
    try {
      child = spawn(process.execPath, [cli, 'install', 'chromium'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) { resolve({ ok: false, message: '설치를 시작하지 못했습니다: ' + String((e && e.message) || e) }); return; }
    let tail = '';
    const onData = (d) => {
      const s = String(d);
      tail = (tail + s).slice(-2000);
      // 진행률 줄은 너무 잦아 요약만 남긴다
      for (const line of s.split(String.fromCharCode(10))) {
        const L = line.trim();
        if (!L) continue;
        if (/Downloading|downloaded to|Removing unused|Failed|Error/i.test(L)) log('  ' + L.slice(0, 160));
      }
    };
    if (child.stdout) child.stdout.on('data', onData);
    if (child.stderr) child.stderr.on('data', onData);
    child.on('error', (e) => resolve({ ok: false, message: '설치 실행 오류: ' + String((e && e.message) || e) }));
    child.on('close', (code) => {
      if (code === 0) { log('✅ 브라우저 설치 완료 — 다시 시도하세요.'); resolve({ ok: true, message: '브라우저(Chromium) 설치 완료' }); }
      else resolve({ ok: false, message: '브라우저 설치 실패 (종료코드 ' + code + '). 마지막 출력: ' + tail.slice(-300) });
    });
  });
}

module.exports = { cleanProfile, explainLaunchError, installBundledChromium };
