'use strict';
/**
 * node test/lab-switch.test.js — Priming Lab(복제본, PM_LAB=1)이 원본 데이터·배포를 건드리지 않게 한 배선이 있는지.
 *   · 업데이터(시작·⟳ 단추)는 Lab 에서 무조건 건너뛴다(원본 저장소 파일로 Lab 코드를 덮지 않게)
 *   · 시작 4초 뒤 서버 동기화(참조음성·스타일·얼굴·태그)를 Lab 에서 건너뛴다
 *   · 창 제목·헤더에 Lab 표시
 *   · lab-start.ps1 이 USERPROFILE·PRIMING_REF_DIR·PM_ROY_* 를 Lab 데이터 폴더로 돌리고 PM_LAB 을 켠다
 */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const M = R('main.js'), LU = R('light-updater.js'), P = R('preload.js'), A = R('renderer/src/App.jsx');

const apply = LU.slice(LU.indexOf('async function applyUpdates'));
ok(/if \(process\.env\.PM_LAB\) \{[^}]*return \{ updated: 0, failed: 0, reason: 'lab' \}/.test(apply.slice(0, 600)), 'applyUpdates: Lab 이면 맨 앞에서 건너뜀');
const btn = M.slice(M.indexOf("ipcMain.handle('app-update-apply'"));
ok(btn.indexOf('process.env.PM_LAB') > 0 && btn.indexOf('process.env.PM_LAB') < btn.indexOf('LU.applyUpdates'), '⟳ 단추: Lab 판정이 applyUpdates 보다 먼저');
const sync = M.slice(M.indexOf('setTimeout(() => {\n    (async () => {'));
ok(sync.indexOf('process.env.PM_LAB') > 0 && sync.indexOf('process.env.PM_LAB') < sync.indexOf('syncRefAudioToServer'), '시작 동기화: Lab 판정이 참조음성 업로드보다 먼저');
ok(/title: process\.env\.PM_LAB \? 'Priming Lab' : 'Priming'/.test(M), '창 제목 Lab 표시');
ok(/isLab: !!\(.*process\.env\.PM_LAB\)/.test(P) && /api\.isLab \? '🧪' : '🎬'/.test(A), '헤더 Lab 아이콘(글자 폭 그대로 — 1366px 한 줄)');

const S = R('lab-start.ps1');
ok(/\$env:PM_LAB\s*=\s*'1'/.test(S), 'lab-start: PM_LAB 켬');
for (const k of ['USERPROFILE', 'PRIMING_REF_DIR', 'PM_ROY_HOME', 'PM_ROY_BANK_DIR']) {
  ok(new RegExp('\\$env:' + k + '\\s*=\\s*.*\\$DataRoot').test(S), `lab-start: ${k} → Lab 데이터 폴더`);
}
ok(!/npm run (dist|update:publish)/.test(S), 'lab-start: 설치본·발행 명령 없음');

console.log(`\n${fail ? '❌' : '✅'} lab-switch — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
