'use strict';
/**
 * node test/voice-facets.test.js — 🔊 목소리 성별·연령대 판별(core/voice-facets) — 엔진별 실제 입력 모양으로
 */
const { genderOf, ageOf, facetCounts, matchFacets } = require('../core/voice-facets');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} → ${a === '' ? '(없음)' : a}${a === b ? '' : ' ≠ ' + b}`);

// 성별
eq(genderOf({ gender: 'female' }), 'female', '칸 값 female');
eq(genderOf({ gender: 'Male' }), 'male', '칸 값 Male(대소문자)');
eq(genderOf({ name: 'JA_남성_중년' }), 'male', 'OmniVoice 이름 「남성」');
eq(genderOf({ name: 'VI_여성_청년' }), 'female', 'OmniVoice 이름 「여성」');
eq(genderOf({ name: '1nd_고전_여성' }), 'female', '이름 끝 「여성」');
eq(genderOf({ desc: 'A female narrator' }), 'female', 'female 이 male 보다 먼저(female ⊃ male)');
eq(genderOf({ name: '득수' }), '', '단서 없음 → 지어내지 않는다');
eq(genderOf({ gender: 'female', name: '남성_이름' }), 'female', '칸 값이 이름보다 우선');
// 연령대
eq(ageOf({ age: 'young_adult' }), 'young', '타입캐스트 young_adult');
eq(ageOf({ age: 'middle_age' }), 'middle', '타입캐스트 middle_age');
eq(ageOf({ age: 'elder' }), 'old', '타입캐스트 elder');
eq(ageOf({ age: 'teenager' }), 'child', '타입캐스트 teenager');
eq(ageOf({ age: 'child' }), 'child', '타입캐스트 child');
eq(ageOf({ desc: 'middle_aged · narration' }), 'middle', 'ElevenLabs middle_aged(aged 로 노년이 되지 않는다)');
eq(ageOf({ desc: 'young · calm' }), 'young', 'ElevenLabs young');
eq(ageOf({ desc: 'old · raspy' }), 'old', 'ElevenLabs old');
eq(ageOf({ desc: '청년 · 내레이션' }), 'young', '한국어 설명 「청년」');
eq(ageOf({ name: 'JA_남성_중년' }), 'middle', 'OmniVoice 이름 「중년」');
eq(ageOf({ name: 'VI_여성_청년' }), 'young', 'OmniVoice 이름 「청년」');
eq(ageOf({ desc: '젊은 (Youthful)' }), 'young', 'Gemini Youthful/젊은');
eq(ageOf({ desc: '성숙한 (Mature)' }), 'middle', 'Gemini Mature/성숙한');
eq(ageOf({ name: 'Gold', desc: 'Bold voice' }), '', 'Gold·Bold 는 old 가 아니다(낱말 경계)');
eq(ageOf({ name: '득수' }), '', '단서 없음 → 표시 없음');
// 개수 · 거르기
const L = [{ gender: 'male', age: 'young_adult' }, { gender: 'female', desc: 'old' }, { gender: 'female' }, { name: 'x' }];
const c = facetCounts(L);
ok(c.gender.male === 1 && c.gender.female === 2 && c.gender.none === 1, '성별 개수 ' + JSON.stringify(c.gender));
ok(c.age.young === 1 && c.age.old === 1 && c.age.none === 2, '연령 개수 ' + JSON.stringify(c.age));
ok(L.filter((v) => matchFacets(v, 'female', '')).length === 2, '거르기: 여성 2');
ok(L.filter((v) => matchFacets(v, 'female', 'old')).length === 1, '거르기: 여성 ∩ 노년 1(판정력 — 둘이 서로 좁힌다)');
ok(L.filter((v) => matchFacets(v, '', 'none')).length === 2, '거르기: 연령 미표시 2');
ok(L.filter((v) => matchFacets(v, 'none', '')).length === 1, '거르기: 성별 미표시 1');
ok(L.filter((v) => matchFacets(v, '', '')).length === 4, '거르기 없음 = 전부');
console.log(`\n${fail ? '❌' : '✅'} voice-facets — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
