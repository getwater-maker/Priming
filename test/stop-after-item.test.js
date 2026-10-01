// ⏸ 「이번 편까지만」 — 큐 순차 제작을 지금 만드는 대본까지만 하고 멈춘다 (로이 2026-10-01, v0.5.107)
//   ■ 중단(S.abort)은 만들던 대본도 바로 멈춘다. 이건 **별개 플래그**로, 지금 대본은 끝까지 마치고 다음 대본부터 시작하지 않는다.
//   main.js·App.jsx 원문에서 함수·구간을 뽑아 검사한다(복사본을 두면 앱과 갈라져도 통과한다).
//   ⚠ E2E(실제 앱)는 로이 큐가 도는 동안 돌리지 않는다 — 이 파일은 앱을 띄우지 않는다.
const fs = require('fs'), path = require('path');
const R = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const MAIN = R('main.js'), APP = R('renderer', 'src', 'App.jsx'), PRE = R('preload.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

console.log('[1] _batchRemaining — 남은 편수');
const st = MAIN.indexOf('function _batchRemaining(');
const en = MAIN.indexOf('\n}\n', st);
ok(st > 0 && en > st, '_batchRemaining 이 main.js 에 있다');
const _batchRemaining = new Function(MAIN.slice(st, en + 2) + '\nreturn _batchRemaining;')();
const plan = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const mk = (...s) => ['a', 'b', 'c', 'd'].map((id, i) => ({ id, status: s[i] }));
ok(_batchRemaining(plan, 1, mk('done', 'running', 'pending', 'pending')) === 3, 'b 부터 세면 b·c·d = 3편');
ok(_batchRemaining(plan, 2, mk('done', 'done', 'pending', 'pending')) === 2, 'c 부터 c·d = 2편');
ok(_batchRemaining(plan, 2, mk('done', 'done', 'pending', 'done')) === 1, '이미 완료(done)된 항목은 남은 편수에 안 센다');
ok(_batchRemaining(plan, 4, mk('done', 'done', 'done', 'done')) === 0, '끝 지점이면 0');
ok(_batchRemaining(plan, 0, [{ id: 'a', status: 'pending' }]) === 1, '큐에서 사라진 항목은 세지 않는다');
ok(_batchRemaining(plan, 0, null) === 0 && _batchRemaining([], 0, []) === 0, 'items 가 null·plan 이 비어도 안 던진다');
ok(_batchRemaining(plan, 0, mk('pending', 'pending', 'pending', 'pending')) !== _batchRemaining(plan, 3, mk('pending', 'pending', 'pending', 'pending')), '판정력: 시작 지점이 다르면 값이 다르다');

console.log('[2] run-batch 루프 — 검사 위치');
const rb0 = MAIN.indexOf("ipcMain.handle('run-batch'");
const rb1 = MAIN.indexOf("ipcMain.handle('abort'", rb0) > 0 ? MAIN.indexOf('// 미리보기 오디오', rb0) : -1;
const RB = MAIN.slice(rb0, rb1 > rb0 ? rb1 : rb0 + 12000);
const iAbort = RB.indexOf('if (S.abort) {');
const iStop = RB.indexOf('if (_stopAfterItem)');
const iStore = RB.indexOf('storeActive();');
const iRun = RB.indexOf('await runMakeAllCore(');
ok(iAbort > 0 && iStop > iAbort, '■ 중단 검사 다음에 이번 편까지만 검사');
ok(iStore > iStop && iRun > iStop, '다음 대본을 시작(storeActive·runMakeAllCore)하기 **전에** 검사한다 — 만들던 대본은 끝까지');
ok(/_stopAfterItem = false;\s*\/\/[^\n]*\n\s*log\(`⚡⚡ 큐 순차 제작 시작/.test(RB), '큐 시작 때 지난 예약을 푼다');
ok(/_stopAfterItem = false;\n\s*log\(`⚡⚡ 큐 제작 종료/.test(RB), '큐가 끝나면 예약을 푼다');
ok(/stoppedEarly: stoppedLeft > 0, remaining: stoppedLeft/.test(RB), '화면에 stoppedEarly·remaining 을 돌려준다');
ok(/let _stopAfterItem = false;/.test(MAIN), '모듈 수준 플래그가 있다');

console.log('[3] S.abort 와 분리');
const h0 = MAIN.indexOf("ipcMain.handle('stop-after-item'");
const h1 = MAIN.indexOf('\n});', h0);
const H = MAIN.slice(h0, h1);
ok(h0 > 0, "IPC 'stop-after-item' 핸들러가 있다");
ok(!/S\.abort/.test(H) && !/flowEng/.test(H) && !/clearGeneratingStatus/.test(H), '핸들러가 S.abort·엔진 정지·스피너 해제를 건드리지 않는다(만들던 건 끝까지)');
ok(/_stopAfterItem = on !== false/.test(H), 'on=false 로 취소할 수 있다');
const a0 = MAIN.indexOf("ipcMain.handle('abort'");
const A = MAIN.slice(a0, MAIN.indexOf('\n});', a0));
ok(!/_stopAfterItem/.test(A), '■ 중단 핸들러는 이 플래그와 무관(중단은 어디서든 즉시)');

console.log('[4] 화면·preload 배선');
ok(/stopAfterItem: \(on\) => ipcRenderer\.invoke\('stop-after-item', on\)/.test(PRE), 'preload 에 stopAfterItem');
ok(/data-testid="stop-after-btn"/.test(APP) && /onClick=\{toggleStopAfter\}/.test(APP), '헤더에 ⏸ 버튼 → toggleStopAfter');
ok(/\{queueBusy && \(\s*<button className=\{'ghost stop-after'/.test(APP), '버튼은 큐 작업 중(queueBusy)에만 보인다(평소 헤더 폭 불변)');
ok(/stopAfter \? '⏸ 예약됨 · 취소' : '⏸ 이번 편까지만'/.test(APP), '예약되면 라벨이 바뀌어 취소임을 보인다');
const tg = APP.slice(APP.indexOf('async function toggleStopAfter'), APP.indexOf('async function toggleStopAfter') + 700);
ok(/queueStopAfterRef\.current = on/.test(tg) && /api\.stopAfterItem\(on\)/.test(tg), '토글이 ref(화면 큐 루프)와 main(run-batch) 둘 다에 알린다');
const ab = APP.slice(APP.indexOf('function abort()'), APP.indexOf('function abort()') + 260);
ok(/queueStopAfterRef\.current = false/.test(ab) && /api\.abort\(\)/.test(ab), '■ 중단을 누르면 예약도 함께 지운다');
const rbAll = APP.slice(APP.indexOf('async function runBatchAll'), APP.indexOf('async function runImportVrewAudio'));
ok(/setQueueBusy\(true\)/.test(rbAll) && /finally \{[^}]*setQueueBusy\(false\)/.test(rbAll), 'runBatchAll: 시작에 busy, finally 에서 해제(오류여도 버튼이 남지 않음)');
ok(/r\.stoppedEarly/.test(rbAll) && /r\.remaining/.test(rbAll), 'runBatchAll: 멈춘 경우 남은 편수를 상태줄에 보인다');
const sq = APP.slice(APP.indexOf('async function runStageQueue'), APP.indexOf('// 대본 위 통합 버튼'));
const jq = sq.indexOf('if (queueAbortRef.current) { logline'), jt = sq.indexOf('if (queueStopAfterRef.current)'), jr = sq.indexOf('await api.selectQueueItem(it.id');
ok(jq > 0 && jt > jq && jr > jt, 'runStageQueue: 항목을 시작하기 전에 예약을 본다(■ 검사 다음)');
ok(/stoppedAfter \|\| queueAbortRef|queueAbortRef\.current \|\| stoppedAfter/.test(sq), 'runStageQueue: 두 단계(이미지→비디오)도 한 번에 빠져나간다');
ok(/setQueueBusy\(false\)/.test(sq), 'runStageQueue: 끝나면 busy 해제');

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
