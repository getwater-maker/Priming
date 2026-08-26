'use strict';
// node test/browser-recovery.test.js — 브라우저 자동화 실패 복구 3종 (2026-08-26 아내 PC 로그에서 나온 것들).
//
//   ① Chrome 이 시작하자마자 닫힘 → 프로필 정리 후 1회 재시도, 그래도 안 되면 사람 말 오류
//      (그 PC 로그: `Target page, context or browser has been closed` → 번들 Chromium 폴백도
//       `Executable doesn't exist at ...chromium-1223` 로 죽어 G2 영상이 통째로 실패했다)
//      🔑 락만 지우면 부족하다 — Preferences.exit_type='Crashed' 가 남으면 복원 안내가 뜬다.
//         Flow 경로만 그걸 고치고 있었고 Grok·Genspark 는 Singleton 락만 지웠다.
//   ② Genspark 설정 팝오버가 안 열려 비율 '확인' 만 실패 → 이미 맞춘 세션이면 그대로 진행
//      (그 PC 로그: `종횡비 '16:9' 못 찾음` 3회 → 배치 포기 → G8·G9 실패. 앞서 16:9 적용은 성공했었다)
//   ③ 모더레이션 순화가 헛수고면 그 실행에서는 건너뛰고 다음 엔진에 넘긴다
//      (그 PC 로그: G5·G6·G7 이 순화로도 막혔고 결국 Flow 가 전부 만들었다 — 컷당 약 25초씩 낭비)

const fs = require('fs');
const path = require('path');
const os = require('os');
const CP = require('../core/chrome-profile');

const R = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GROK = R('grok-engine.js');
const GS = R('genspark-engine.js');
const PIPE = R('core', 'pipeline.js');

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
  const m1 = CP.explainLaunchError(new Error("launchPersistentContext: Executable doesn't exist at C:/x/chrome.exe"), 'Grok');
  ok(m1.indexOf('브라우저가 없습니다') >= 0, '번들 Chromium 미설치를 사람 말로');
  ok(m1.indexOf('playwright install chromium') >= 0, '무엇을 해야 하는지가 들어 있다');
  const m2 = CP.explainLaunchError(new Error('launchPersistentContext: Target page, context or browser has been closed'), 'Grok');
  ok(m2.indexOf('시작하자마자 닫혔습니다') >= 0, '시작 직후 닫힘을 사람 말로');
  ok(m2.indexOf('크롬 창을 모두 닫고') >= 0, '조치가 들어 있다');
  ok(CP.explainLaunchError(new Error('spawn ENOENT'), 'Genspark').indexOf('실행 파일을 찾지 못했습니다') >= 0, 'ENOENT 도 사람 말로');
  ok(CP.explainLaunchError(new Error('무슨 일'), 'Flow').indexOf('Flow') === 0, '모르는 오류는 원문을 붙여 그대로');
}

// ── ① 배선 — 두 엔진 모두 정리·재시도·사람 말 ──
for (const [src, who] of [[GROK, 'Grok'], [GS, 'Genspark']]) {
  ok(src.indexOf("require('./core/chrome-profile').cleanProfile(this.profileDir)") >= 0, who + ': 시작 전 프로필 정리');
  ok(src.indexOf('프로필 정리 후 1회 재시도') >= 0, who + ': Chrome 실패 시 1회 재시도');
  ok(src.indexOf('_CP.cleanProfile(this.profileDir)') >= 0, who + ': 재시도 전에 다시 정리');
  ok(src.indexOf("_CP.explainLaunchError(e3, '" + who + "')") >= 0, who + ': 최종 실패는 사람 말로 던진다');
  ok(src.indexOf('SingletonLock') < 0, who + ': 옛 락-only 정리 코드가 사라졌다');
}
ok(CP.installBundledChromium.length >= 0 && typeof CP.installBundledChromium === 'function', '앱이 브라우저를 직접 설치할 수 있다');
{
  const MAIN = R('main.js');
  ok(MAIN.indexOf("ipcMain.handle('install-browser'") >= 0, 'install-browser IPC 가 있다');
  const APP = R('renderer', 'src', 'App.jsx');
  ok(APP.indexOf('브라우저 설치') >= 0, '설정 화면에 설치 버튼이 있다');
  ok(APP.indexOf('installBrowser') >= 0, '버튼이 IPC 를 부른다');
}

// ── ② Genspark 비율 확인 완화 ──
ok(GS.indexOf('if (_ratioOk) this._ratioConfirmed = _ratio;') >= 0, '실제로 맞춘 비율을 기억한다');
ok(GS.indexOf('const _ratioKept') >= 0, '확인 실패와 설정 오류를 가른다');
ok(GS.indexOf('이 세션에서 이미') >= 0, '그대로 진행하는 이유를 로그로 남긴다');
ok(GS.indexOf('_verified.sizeOk && !_verified.ratioOk') >= 0, '크기는 맞고 비율만 확인 실패일 때로 좁힌다');

// ── ③ 순화 헛수고면 건너뛴다 ──
ok(PIPE.indexOf('let softenFutile = 0; const SOFTEN_GIVEUP = 2;') >= 0, '헛수고 카운터·상한이 선언돼 있다');
ok(PIPE.indexOf('softenFutile >= SOFTEN_GIVEUP') >= 0, '상한을 넘으면 건너뛴다');
ok(PIPE.indexOf('if (didSoften) softenFutile++;') >= 0, '실제로 순화를 해본 경우에만 집계한다');
ok(PIPE.indexOf('다음 엔진이 이어 만듭니다') >= 0, '건너뛴 이유를 사람 말로 남긴다');
// 🔴 미정의 식별자 방지 — 이 저장소 단골 사고(imgEngine·onPickImgEngine·label)
for (const id of ['softenFutile', 'SOFTEN_GIVEUP', 'didSoften']) {
  ok(PIPE.indexOf('let ' + id) >= 0 || PIPE.indexOf('const ' + id) >= 0, id + ' 가 선언돼 있다');
}

console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 브라우저 복구 ' + n + '/' + n + ' 통과');
process.exit(bad ? 1 : 0);
