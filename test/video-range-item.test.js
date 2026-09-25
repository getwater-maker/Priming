// 큐 작업에서 영상 범위 = 대본마다 자기 범위 (v0.5.73)
//   ① 저장된 범위 ② 없으면 그 대본의 도입부 끝까지 ③ 도입부도 없으면 G1. 헤더 범위로 모든 대본을 덮지 않는다.
//   main.js 원문에서 _itemRange 를 뽑아 실행한다(복사본을 두면 앱과 갈라져도 통과한다).
const fs = require('fs'), path = require('path');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const APP = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const st = MAIN.indexOf('function _itemRange(');
const en = MAIN.indexOf('\n}\n', st);
ok(st > 0 && en > st, '_itemRange 가 main.js 에 있다');
const _itemRange = new Function(MAIN.slice(st, en + 2) + '\nreturn _itemRange;')();
const P = (introNums, n = 12) => ({ projects: [{ groups: Array.from({ length: n }, (_, i) => ({ num: i + 1, isIntro: introNums.includes(i + 1) })) }] });

console.log('[1] 범위 결정');
const pick = (r) => ({ f: r.fromNum, t: r.toNum });
ok(eq(pick(_itemRange({ vidFrom: 2, vidTo: 4 }, P([1, 2, 3, 4, 5, 6, 7]))), { f: 2, t: 4 }), '저장된 범위가 도입부보다 우선');
ok(eq(pick(_itemRange({ vidFrom: '1', vidTo: '3' }, P([1, 2, 3, 4, 5]))), { f: 1, t: 3 }), '문자열 저장값도 읽는다');
ok(eq(pick(_itemRange({ vidFrom: 5, vidTo: 2 }, P([]))), { f: 2, t: 5 }), '거꾸로 적은 범위는 바로잡는다');
ok(eq(pick(_itemRange({}, P([1, 2, 3]))), { f: 1, t: 3 }), '저장값 없으면 그 대본의 도입부 끝(G3)');
ok(eq(pick(_itemRange({}, P([1, 2, 3, 4, 5, 6, 7]))), { f: 1, t: 7 }), '도입부가 긴 대본은 G7');
ok(eq(pick(_itemRange({ vidFrom: 1 }, P([1, 2]))), { f: 1, t: 2 }), '반쪽만 저장돼 있으면 도입부 기본');
ok(eq(pick(_itemRange({}, P([]))), { f: 1, t: 1 }), '도입부 없으면 G1 만 (전체 아님)');
ok(eq(pick(_itemRange({}, null)), { f: 1, t: 1 }), '대본 없어도 G1 (안 던짐)');
ok(/도입부/.test(_itemRange({}, P([1])).src), '출처 문구가 붙는다');

console.log('[2] 배선');
ok(!/_batchRange/.test(MAIN), '헤더 우선 _batchRange 가 사라졌다');
ok(/const _rg = _itemRange\(s, S\.parsed\)/.test(MAIN) && /fromNum: _rg\.fromNum, toNum: _rg\.toNum/.test(MAIN), '⚡ 만들기(run-batch)가 대본마다 _itemRange');
ok(/if \(args\.perItem\) \{[\s\S]{0,200}_itemRange\(\(_it && _it\.settings\) \|\| \{\}, S\.parsed\)/.test(MAIN), 'video-build perItem = 활성 대본 설정으로');
ok(/videoBuild\(\{ shortsNum: null, perItem: true/.test(APP), '상단 🎬(큐 전체)가 perItem 으로 부른다');
ok(!/common: \{[^}]*vidFrom/.test(APP), 'runBatch common 에 헤더 범위를 싣지 않는다');
const rb = APP.slice(APP.indexOf('async function runBatchAll'), APP.indexOf('api.runBatch('));
ok(/setQueueSettings\(currentSettings\(\), true\)/.test(rb), '만들기 전에 지금 대본의 헤더 범위를 먼저 저장');

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
