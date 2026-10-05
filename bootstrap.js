/**
 * bootstrap.js — Electron 엔트리 (package.json main).
 * 캐시 디렉토리 분리 후 main.js 로딩.
 */
const path = require('path');
const os = require('os');
const { app, protocol } = require('electron');

// media:// 커스텀 프로토콜 권한 등록 — 반드시 app 'ready' 이전에 호출해야 한다.
//   아래 라이트 업데이터를 await 하는 동안 app 이 ready 가 되어버리므로, main.js 가 아니라 여기서
//   (await 보다 먼저, 동기로) 등록한다. main.js 는 ready 가 아닐 때만 보조로 다시 시도한다.
try {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
  ]);
} catch (err) {
  process.stderr.write(`[bootstrap] registerSchemesAsPrivileged 실패: ${err && err.message}\n`);
}

// 기존 앱(~/.flow-app, ~/.shots-maker)과 캐시/세션 충돌 방지 — 통합 앱 전용 디렉토리
try {
  const dataDir = path.join(os.homedir(), '.priming-maker');
  // 🧪 E2E(PM_UI_SMOKE=1)는 **자기 전용 Electron 저장 공간**(임시 폴더)을 쓴다(v0.6.81 · 로이 2026-10-05) —
  //   로이 앱과 같은 userData(localStorage·세션)를 쓰면 켜 둔 채로 테스트할 때 서로 꺼지거나 보기 설정을 덮었다
  //   (2026-10-05 01:34 실측: 로이가 앱을 켜는 순간 테스트 앱이 꺼짐). ⚠ ~/.flow-app·~/.priming-maker 설정 파일은 여전히 같이 쓴다.
  const electronDir = process.env.PM_UI_SMOKE ? path.join(os.tmpdir(), 'priming-smoke-electron') : path.join(dataDir, 'electron');
  app.setPath('userData', electronDir);
  // 디스크/GPU 캐시 경로 고정 — "Unable to move the cache" 권한 경고 회피.
  app.commandLine.appendSwitch('disk-cache-dir', path.join(electronDir, 'cache'));
} catch (_) {}

// 라이트 자동 업데이트 — main.js 를 로드하기 "전에" 변경된 파일만 받아 교체.
//   → 이번 실행이 곧바로 최신 코드로 동작 (팝업·NSIS 인스톨·재시작 단계 없음).
//   오프라인/실패면 조용히 현재 버전으로 진행. dev(npm start)에선 자동 건너뜀.
(async () => {
  try {
    await require('./light-updater').applyUpdates();
  } catch (err) {
    process.stderr.write(`[updater] setup failed: ${err && err.stack ? err.stack : err}\n`);
  }
  require('./main.js');
})();
