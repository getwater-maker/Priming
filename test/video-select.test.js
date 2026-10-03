// 🎬 영상 대상 방식(core/video-select) — 홀수·짝수·도입부+… 모두 1번 그룹 포함(v0.6.60).
const fs = require('fs'), path = require('path');
const VS = require('../core/video-select');
const MP = require('../core/make-progress');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const APP = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8').replace(/\r\n/g, '\n');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('  ✓ ' + m); else { bad++; console.log('  ✗ ' + m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const G = (len, intro) => Array.from({ length: len }, (_, i) => ({ num: i + 1, isIntro: i + 1 <= intro }));

console.log('[1] 방식별 대상');
const g10 = G(10, 3);
ok(eq(VS.pick(g10, 'odd'), [1, 3, 5, 7, 9]), '홀수 = 1·3·5·7·9');
ok(eq(VS.pick(g10, 'even'), [1, 2, 4, 6, 8, 10]), '짝수 = 1번 + 2·4·6·8·10 (1번 강제 포함)');
ok(eq(VS.pick(g10, 'intro'), [1, 2, 3]), '도입부만');
ok(eq(VS.pick(g10, 'intro_odd'), [1, 2, 3, 5, 7, 9]), '도입부 + 본론 홀수');
ok(eq(VS.pick(g10, 'intro_even'), [1, 2, 3, 4, 6, 8, 10]), '도입부 + 본론 짝수');
ok(eq(VS.pick(g10, 'every3'), [1, 4, 7, 10]), '3개마다 = 1·4·7·10');
ok(eq(VS.pick(g10, 'every4'), [1, 5, 9]), '4개마다 = 1·5·9');
ok(eq(VS.pick(G(6, 0), 'intro'), [1]), '도입부가 없으면 1번만(전체 아님)');
for (const m of VS.MODES) ok(VS.pick(g10, m.id)[0] === 1, `${m.id}: 1번 그룹 항상 포함`);

console.log('[2] 범위·잘못된 값');
ok(VS.pick(g10, '') === null && VS.pick(g10, 'range') === null && VS.pick(g10, 'zzz') === null, '빈 값·모르는 값 = null(범위 지정으로 — 다른 방식으로 둔갑 금지)');
ok(VS.normSel('odd') === 'odd' && VS.normSel('bogus') === '' && VS.normSel(undefined) === '', 'normSel');
const m1 = VS.matcher(g10, '', 3, 5);
ok(m1(3) && m1(5) && !m1(2) && !m1(6), '방식 없으면 N~M 범위 그대로');
const m2 = VS.matcher(g10, 'odd', 3, 5);
ok(m2(7) && !m2(4), '방식이 있으면 범위보다 우선');
ok(VS.matcher(g10, '', null, null)(9), '둘 다 없으면 전체(호출자가 막는다)');

console.log('[3] 진행 팝업 셈');
const pr = { sentences: [], groups: G(10, 3).map((g) => ({ ...g, imagePrompt: 'x', videoPath: '' })) };
ok(MP.count([pr], { sel: 'odd' }).video.total === 5, '진행 팝업 영상 수 = 홀수 5개');
ok(MP.count([pr], { fromNum: 1, toNum: 3 }).video.total === 3, '범위 지정은 기존과 같다');

console.log('[4] 배선(main·화면)');
ok(/rangeNums\(pr, fromNum, toNum, vidSel\)/.test(MAIN) && (MAIN.match(/rangeNums\(pr, fromNum, toNum, vidSel\)/g) || []).length >= 3, 'rangeNums 호출 3곳 모두 vidSel 전달');
ok(/vidSel: _rg\.sel/.test(MAIN), 'run-batch 가 대본의 방식을 runMakeAllCore 에 넘긴다');
ok(/vidSel = _rg\.sel/.test(MAIN), 'video-build(perItem)가 방식을 쓴다');
ok(/vidSel: vsel/.test(MAIN), '모두 적용이 방식도 넣는다');
ok(/vidSel, flowVideoModel|vidFrom, vidTo, vidSel/.test(APP), '헤더 설정 묶음에 vidSel');
ok((APP.match(/vidSel: normVidSel\((?:p|ch)\.vidSel\)/g) || []).length === 2, '채널 편집 읽기·저장 두 곳 모두 vidSel');
ok(/data-testid="vid-sel"/.test(APP) && /data-testid="ch-vid-sel"/.test(APP), '헤더·채널 편집에 선택 상자');

console.log(bad ? `\n❌ ${bad}/${n} 실패` : `\n✅ video-select ${n}/${n} 통과`);
process.exit(bad ? 1 : 0);
