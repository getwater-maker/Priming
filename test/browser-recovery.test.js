'use strict';
// node test/browser-recovery.test.js — 브라우저 자동화 실패 복구(core/chrome-profile · 2026-08-26 아내 PC 로그에서 나온 것).
//   Chrome 이 시작하자마자 닫힘 → 프로필 정리 후 1회 재시도, 그래도 안 되면 사람 말 오류.
//   🔑 락만 지우면 부족하다 — Preferences.exit_type='Crashed' 가 남으면 복원 안내가 뜬다.
//   (옛 브라우저 이미지·영상 엔진의 배선 검사는 v1.0.49 에 엔진과 함께 지웠다 — 지금은 출판 자동 입력 등 공용 브라우저 코드가 쓴다)

const fs = require('fs');
const path = require('path');
const os = require('os');
const CP = require('../core/chrome-profile');

const R = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, m + '  (기대 ' + JSON.stringify(b) + ' / 실제 ' + JSON.stringify(a) + ')');

// ── ① cleanProfile — 실제 폴더로 동작 확인 ──
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cprof-'));
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) fs.writeFileSync(path.join(dir, f), 'x');
  fs.writeFileSync(path.join(dir, 'Default', 'Preferences'),
    JSON.stringify({ profile: { exit_type: 'Crashed', exited_cleanly: false }, keep: 1 }));
  CP.cleanProfile(dir);
  ok(!fs.existsSync(path.join(dir, 'SingletonLock')), 'Singleton 락을 지운다');
  ok(!fs.existsSync(path.join(dir, 'SingletonSocket')), 'Singleton 소켓도 지운다');
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8'));
  eq(j.profile.exit_type, 'Normal', '크래시 표시를 Normal 로 되돌린다');
  eq(j.profile.exited_cleanly, true, 'exited_cleanly 를 true 로');
  eq(j.keep, 1, '다른 설정은 건드리지 않는다');
  CP.cleanProfile(path.join(dir, '없는폴더'));   // 던지지 않아야 한다
  CP.cleanProfile(null);
  ok(true, '없는 경로·null 이어도 던지지 않는다(정리는 best-effort)');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ── ① 사람 말 오류 ──
{
  const m1 = CP.explainLaunchError(new Error("launchPersistentContext: Executable doesn't exist at C:/x/chrome.exe"), '부크크');
  ok(m1.indexOf('브라우저가 없습니다') >= 0, '번들 Chromium 미설치를 사람 말로');
  ok(m1.indexOf('playwright install chromium') >= 0, '무엇을 해야 하는지가 들어 있다');
  const m2 = CP.explainLaunchError(new Error('launchPersistentContext: Target page, context or browser has been closed'), '부크크');
  ok(m2.indexOf('시작하자마자 닫혔습니다') >= 0, '시작 직후 닫힘을 사람 말로');
  ok(m2.indexOf('크롬 창을 모두 닫고') >= 0, '조치가 들어 있다');
  ok(CP.explainLaunchError(new Error('spawn ENOENT'), '부크크').indexOf('실행 파일을 찾지 못했습니다') >= 0, 'ENOENT 도 사람 말로');
  ok(CP.explainLaunchError(new Error('무슨 일'), '부크크').indexOf('부크크') === 0, '모르는 오류는 원문을 붙여 그대로');
}

ok(CP.installBundledChromium.length >= 0 && typeof CP.installBundledChromium === 'function', '앱이 브라우저를 직접 설치할 수 있다');
{
  const MAIN = R('main.js');
  ok(MAIN.indexOf("ipcMain.handle('install-browser'") >= 0, 'install-browser IPC 가 있다');
  const APP = R('renderer', 'src', 'App.jsx');
  ok(APP.indexOf('브라우저 설치') >= 0, '설정 화면에 설치 버튼이 있다');
  ok(APP.indexOf('installBrowser') >= 0, '버튼이 IPC 를 부른다');
}

console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 브라우저 복구 ' + n + '/' + n + ' 통과');
process.exit(bad ? 1 : 0);
