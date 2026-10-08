'use strict';
// node test/dict-case.test.js — 발음사전: 영문이 든 항목은 대소문자 구분 없이 적용, 한글만인 항목은 예전 그대로.
const P = require('../tts/text-pronouncer');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const D = [{ source: 'ai', pron: '에이아이' }, { source: 'C++', pron: '씨플플' }, { source: '(x)', pron: '엑스' }, { source: '정약용', pron: '정냐굥' }, { source: 'OFF', pron: '오프', enabled: false }];
ok(P.applyOmniVoiceDict('AI와 ai와 Ai', D) === '에이아이와 에이아이와 에이아이', '대소문자 달라도 적용');
ok(P.applyOmniVoiceDict('C++ c++', D) === '씨플플 씨플플', '정규식 기호(+)는 글자 그대로');
ok(P.applyOmniVoiceDict('a (x) b', D) === 'a 엑스 b', '괄호도 글자 그대로');
ok(P.applyOmniVoiceDict('정약용 off', D) === '정냐굥 off', '한글 항목 그대로 · 꺼진 항목은 안 쓴다');
ok(P.applyOmniVoiceDict('x', [{ source: 'x', pron: '$&' }]) === '$&', '발음 표기의 $ 기호도 글자 그대로');
console.log(`\n${fail ? '❌' : '✅'} dict-case ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
