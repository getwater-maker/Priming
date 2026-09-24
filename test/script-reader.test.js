'use strict';
/**
 * node test/script-reader.test.js — 📄 대본 보기 문단 편집 → 「바뀐 문장만」 계산(paragraphEdits) 단위 테스트 (2026-09-24, v0.5.34)
 *   core 원문을 그대로 require 해 실행한다(복사본을 두면 앱과 갈라져도 통과한다).
 */
const path = require('path');
const fs = require('fs');
const R = require('../core/script-reader');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const O = ['첫째 문장입니다.', '둘째 문장입니다.', '셋째 문장입니다.'];
const J = R.joinParagraph(O);
const E = (t, o = O) => R.paragraphEdits(o, t);

console.log('[1] 안 바뀌면 보내지 않는다');
ok(eq(E(J), []), '그대로 = 0건');
ok(eq(E('  ' + J + '  '), []), '앞뒤 공백만 = 0건');
ok(eq(E(J.replace('둘째', '"둘째"')), []), '따옴표만 = 0건(파서가 지운다 → 보내면 헛돈다)');
ok(eq(E(J.replace('입니다. 둘째', '입니다.  둘째')), []), '문장 사이 공백 두 칸 = 0건');
ok(eq(E(J.replace(/\s/, '\n')), []), '줄바꿈 = 공백');

console.log('[2] 바뀐 문장만');
ok(eq(E(J.replace('둘째', '두 번째')), [{ from: 1, count: 1, text: '두 번째 문장입니다.' }]), '가운데 한 문장 → 그 문장만');
ok(eq(E(J.replace('첫째', '처음')), [{ from: 0, count: 1, text: '처음 문장입니다.' }]), '첫 문장');
ok(eq(E(J.replace('셋째 문장입니다.', '셋째 문장이에요!')), [{ from: 2, count: 1, text: '셋째 문장이에요!' }]), '끝 문장');
const two = E('처음 문장입니다. 둘째 문장입니다. 셋째 문장이에요.');
ok(eq(two, [{ from: 0, count: 1, text: '처음 문장입니다.' }, { from: 2, count: 1, text: '셋째 문장이에요.' }]), '떨어진 두 곳 = hunk 2개(가운데는 안 건드림)');

console.log('[3] 나누기 · 넣기 · 지우기');
ok(eq(E(J.replace('둘째 문장입니다.', '둘째 문장. 하나 더입니다.')), [{ from: 1, count: 1, text: '둘째 문장. 하나 더입니다.' }]), '마침표를 넣어 나누기 = 그 문장 자리에 두 문장');
ok(eq(E('앞말 ' + J), [{ from: 0, count: 1, text: '앞말 첫째 문장입니다.' }]), '맨 앞에 끼운 글 = 첫 문장에');
ok(eq(E(J + ' 새 문장입니다.'), [{ from: 2, count: 1, text: '셋째 문장입니다. 새 문장입니다.' }]), '맨 끝에 덧붙인 글 = 끝 문장에');
ok(eq(E('첫째 문장입니다. 셋째 문장입니다.'), [{ from: 1, count: 1, text: '' }]), '가운데 문장 삭제 = 그 문장만(다음 문장을 다시 쓰지 않는다)');
ok(eq(E('둘째 문장입니다. 셋째 문장입니다.'), [{ from: 0, count: 1, text: '' }]), '첫 문장 삭제');
ok(eq(E('첫째 문장입니다. 둘째 문장입니다.'), [{ from: 2, count: 1, text: '' }]), '끝 문장 삭제');
ok(eq(E(''), [{ from: 0, count: 3, text: '' }]), '전부 지움 = 전부(main 이 그룹 마지막 문장 삭제를 거부한다)');

console.log('[4] 문장이 합쳐지는 편집');
ok(eq(E('첫째 문장입니다 둘째 문장입니다. 셋째 문장입니다.'), [{ from: 0, count: 2, text: '첫째 문장입니다 둘째 문장입니다.' }]),
  '끝 마침표를 지우면 다음 문장까지 함께(한 문장이 되므로 — 안 그러면 검증 재파싱이 거부)');
const O2 = ['마침표 없는 줄', '다음 문장입니다.'];
ok(eq(E('마침표 없는 문장 다음 문장입니다.', O2), [{ from: 0, count: 1, text: '마침표 없는 문장' }]), '원래 마침표 없던 문장은 늘리지 않는다(대본 줄 구조 보존)');
ok(eq(E('첫째 문장입니다.둘째 문장입니다. 셋째 문장입니다.'), []), '구분 공백만 지움 = 0건(파서가 어차피 나눈다)');

console.log('[5] 크기·특수');
const big = Array.from({ length: 200 }, (_, i) => `긴 문장 ${i}번째 입니다.`);
const bigNew = big.slice(); bigNew[37] = '고친 문장입니다.'; bigNew[150] = '또 고쳤습니다.';
const t0 = Date.now();
const bh = R.paragraphEdits(big, R.joinParagraph(bigNew));
ok(eq(bh.map((h) => [h.from, h.count]), [[37, 1], [150, 1]]) && Date.now() - t0 < 500, `200문장 문단에서 떨어진 두 곳만 (${Date.now() - t0}ms)`);
const rewrite = R.paragraphEdits(big, 'x'.repeat(8000));
ok(rewrite.length === 1 && rewrite[0].from === 0 && rewrite[0].count === 200, '통째로 다시 쓰면 = hunk 하나(메모리 상한 폴백)');
ok(eq(E('첫째 문장입니다. 둘째 문장입니다 🎉. 셋째 문장입니다.'), []), '이모지만 = 0건');
ok(R.sigOf('a s "b" ★c') === 'asbc', "지문은 공백·따옴표·기호만 뺀다('s' 글자는 남긴다 — 옛 '[\\s]' 문자열 함정)");

console.log('[6] 배선(원문 대조)');
const jsx = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'ScriptReader.jsx'), 'utf8');
ok(/sr\.paragraphEdits\(/.test(jsx), '화면이 paragraphEdits 로 바뀐 문장만 보낸다');
ok(/composing\) return/.test(jsx) && /onCompositionStart/.test(jsx) && /onCompositionEnd/.test(jsx), '🔑 한글 조합 중에는 저장하지 않는다(조합 끝에 다시 센다)');
ok(/if \(S\.composing\) return;/.test(jsx), '조합 중에는 Enter·blur 로도 저장이 돌지 않는다(flushAll 첫 줄)');
ok(/addEventListener\('beforeinput'/.test(jsx) && /insertParagraph/.test(jsx) && /getTargetRanges/.test(jsx), '🔒 잠금은 beforeinput(입력 종류 + 대상 범위) 한 곳에서');
ok(/root\.querySelectorAll\('\[data-ne\]'\)\.length !== neCountRef\.current/.test(jsx), '그래도 구조가 깨지면 저장본 기준으로 되돌린다(scan)');
ok(/hunks\.slice\(\)\.reverse\(\)/.test(jsx), '뒤 hunk 부터 보낸다(앞 문장 번호가 안 흔들리게)');
ok(/presetName: presetName \|\| null/.test(jsx), 'A4 PDF 에 채널 이름을 싣는다(저장 폴더)');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
ok(/function readerPdfDir\(preset\)[\s\S]{0,200}outReader[\s\S]{0,80}defaultDownloadDir\(\)/.test(main), 'PDF 폴더 = 채널 outReader → 다운로드 폴더');
ok(/readerPdfDir\(resolvePreset\(args\.presetName\)\)/.test(main), 'script-reader-pdf 가 그 폴더를 쓴다');
ok(/outReader: p\.outReader \|\| defaultDownloadDir\(\)/.test(main), '채널편집에 기본값(다운로드)을 채워 보낸다');
const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8');
ok(/outReader: p\.outReader \|\| ''/.test(app) && /outReader: \(ch\.outReader \|\| ''\)\.trim\(\)/.test(app), '🔑 채널편집이 outReader 를 싣고 저장한다(안 실으면 덮인다)');
ok(/<label>대본 PDF<\/label>/.test(app) && /pickOutReader/.test(app), '📁 폴더 탭에 「대본 PDF」 칸 + 찾기');

console.log(`\n${fail ? '❌' : '✅'} 대본 보기 문단 편집 ${pass}/${pass + fail}\n`);
process.exit(fail ? 1 : 0);
