// 🛫 큐 사전 점검 — 만들기를 누르면 모든 대본을 먼저 훑어 막힐 대본을 미리 알린다 (로이 2026-10-19, v0.9.75)
//   main.js 원문에서 함수·구간을 뽑아 검사한다(복사본 금지). 앱을 띄우지 않는다.
const fs = require('fs'), path = require('path');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

console.log('[1] _batchPreflight — 막힐 대본 찾기');
const st = MAIN.indexOf('function _batchPreflight(');
const en = MAIN.indexOf('\n}\n', st);
ok(st > 0 && en > st, '_batchPreflight 이 main.js 에 있다');
const pf = new Function(MAIN.slice(st, en + 2) + '\nreturn _batchPreflight;')();
const plan = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
const P = (n) => ({ fileTitle: 'T' + n, n });
const items = [
  { id: 'a', status: 'pending', parsed: P(0) },
  { id: 'b', status: 'pending', parsed: P(2) },                                  // 막힘
  { id: 'c', status: 'done', run: { completed: true }, parsed: P(5) },           // 이미 완료 → 점검 안 함
  { id: 'd', status: 'failed', parsed: P(1) },                                   // 막힘(실패했던 것도 다시 만들 대상)
  { id: 'e', status: 'pending', parsed: null },                                  // 대본 없음 → 건너뜀
];
const info = (p) => ({ open: p.n, lostOpen: 0 });
const r = pf(plan, items, info);
ok(r.length === 2, '막힌 대본 2편 (' + r.length + ')');
ok(r[0].id === 'b' && r[0].idx === 2 && /2곳/.test(r[0].reason), '둘째 대본이 첫 번째로 · 번호 2 · 2곳');
ok(r[1].id === 'd' && r[1].idx === 4, '넷째 대본 · 번호 4');
ok(pf(plan, items.map((x) => ({ ...x, parsed: x.parsed && P(0) })), info).length === 0, '모두 확인되면 빈 목록(판정력)');

console.log('[2] run-batch 가 시작 전에 점검한다');
const rb = MAIN.indexOf("ipcMain.handle('run-batch'");
const loop = MAIN.indexOf('for (let i = 0; i < plan.length; i++)', rb);
const call = MAIN.indexOf('_batchPreflight(plan', rb);
ok(rb > 0 && call > rb && call < loop, '점검 호출이 대본 루프보다 앞에 있다');
const abortReset = MAIN.indexOf('S.abort = false;', rb);
ok(call < abortReset || call < loop, '점검이 제작 시작 전에 끝난다');

console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
