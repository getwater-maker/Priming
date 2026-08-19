'use strict';
/**
 * test/prompt-guard.test.js — 이미지 프롬프트 노이즈 회피 회귀 테스트
 *
 * 배경(2026-08-19 실측): comfy.org 의 Krea2 CLIP(qwen3vl_4b, type=krea2)은 **어떤 토큰 경계**에서
 *   조건(conditioning)이 깨져 **순수 노이즈 이미지**를 내놓는다. cfg=1 + ConditioningZeroOut 이라
 *   붙잡아 줄 것이 없어 디노이즈가 사실상 0 이 된다.
 *   같은 프롬프트(989자) — 985자 정상 · **989자 노이즈 4회 연속** · **989자 + 마침표 → 정상**.
 *   길이 문제가 아니다(내용이 다른 1300자 프롬프트는 정상). 그래서 방어가 두 겹이다:
 *     ① buildImagePrompt 가 항상 마침표로 끝낸다(토큰 경계를 민다)
 *     ② 노이즈가 나오면 nudgePromptForRetry 로 **프롬프트를 바꿔** 재시도한다
 *        (씨앗만 바꾸면 같은 글자 → 같은 노이즈. 로이: "노이즈 이미지를 계속 만들고 있는데")
 *
 * 실행: node test/prompt-guard.test.js
 */
const P = require('../core/pipeline');

let pass = 0, fail = 0;
const check = (name, ok, got) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${got !== undefined ? ` — 실제: ${JSON.stringify(got)}` : ''}`); }
};

console.log('▸ buildImagePrompt — 항상 종결부호로 끝난다');
const p1 = P.buildImagePrompt('Warm painterly illustration', 'A quiet courtyard at dawn');
check('마침표로 끝남', /[.!?]$/.test(p1), p1.slice(-30));
check('스타일이 맨 앞', p1.startsWith('Warm painterly illustration,'), p1.slice(0, 40));
const p2 = P.buildImagePrompt('', 'A hall.');
check('이미 종결부호면 덧붙이지 않음', !/\.\.$/.test(p2) && /[.!?]$/.test(p2), p2.slice(-20));

console.log('▸ nudgePromptForRetry — 프롬프트가 실제로 달라진다');
const base = 'A, B, no text, no watermark';
const n1 = P.nudgePromptForRetry(base, 1);
const n2 = P.nudgePromptForRetry(base, 2);
check('1단계 = 맨 끝 부정 절 하나 제거', n1 === 'A, B, no text.', n1);
check('2단계 = 부정 절 전부 제거', n2 === 'A, B.', n2);
check('1단계와 2단계가 서로 다름', n1 !== n2);
check('원본과 반드시 다름(1)', n1 !== base);
check('원본과 반드시 다름(2)', n2 !== base);
// 부정 절이 없으면 버릴 게 없다 — 그래도 토큰 경계는 밀어야 한다(안 그러면 같은 노이즈 반복).
const n3 = P.nudgePromptForRetry('A, B', 1);
check('부정 절 없어도 글자가 달라짐', n3 !== 'A, B' && n3.startsWith('A, B'), n3);
// ⚠ \b 없이 /^no/ 로 쓰면 'northern' 을 부정으로 오인해 멀쩡한 묘사를 지운다(실제로 한 번 그렇게 깨졌다).
const n4 = P.nudgePromptForRetry('A, northern light, no text', 1);
check('northern 을 부정으로 오인하지 않음', n4.includes('northern light'), n4);
check('전부 부정 절이면 원본 유지', P.nudgePromptForRetry('no text, no watermark', 2).includes('no text'));

console.log('▸ 실제로 노이즈를 만들던 그 프롬프트(989자)');
const real = P.buildImagePrompt(
  'Warm painterly illustration, soft painterly brushwork, golden hour light, gentle and reflective',
  'A close view of a single bamboo slip lying alone on dark wood, lit warm from one side, painterly realistic period style, no text, no watermark');
check('빌드 결과가 마침표로 끝남', /[.!?]$/.test(real), real.slice(-25));
check('재시도본이 원본과 다름', P.nudgePromptForRetry(real, 1) !== real);

console.log(`\n${pass}/${pass + fail} 통과`);
process.exit(fail ? 1 : 0);
