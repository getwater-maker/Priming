'use strict';
/**
 * node test/omni-tags.test.js — 🏷 OmniVoice 참조음성 분류(tts/voice-tags) — 임시 파일로(로이의 분류 파일은 건드리지 않는다)
 */
const fs = require('fs'), os = require('os'), path = require('path');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'vtags-'));
process.env.PRIMING_VOICE_TAGS_FILE = path.join(T, 'tags.json');
const VT = require('../tts/voice-tags');
const VF = require('../core/voice-facets');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const js = (x) => JSON.stringify(x);

ok(js(VT.load()) === '{}', '파일이 없으면 빈 분류');
VT.set('득수', { gender: 'male', age: 'middle', lang: 'ko' });
ok(js(VT.load()['득수']) === js({ gender: 'male', age: 'middle', lang: 'ko' }), '한 목소리 분류 저장');
VT.set('득수', { age: 'old' });
ok(VT.load()['득수'].age === 'old' && VT.load()['득수'].gender === 'male', '일부 칸만 바꾸면 나머지는 유지');
VT.set('득수', { gender: '' });
ok(!('gender' in VT.load()['득수']) && VT.load()['득수'].age === 'old', '빈 값 = 그 칸만 지움(→ 이름 추정으로 돌아감)');
VT.set('득수', { gender: 'robot', age: 'ancient', lang: 'klingon' });
ok(js(VT.load()['득수']) === js({ age: 'old', lang: 'ko' }), '모르는 값은 무시(기존 값 유지)');
VT.set('득수', null);
ok(!('득수' in VT.load()), 'null = 분류 전체 지움');
VT.set('득수', { gender: '', age: '', lang: '' });
ok(!('득수' in VT.load()), '전부 빈 칸이면 항목 자체를 남기지 않는다');
let threw = false; try { VT.set('', { gender: 'male' }); } catch (_) { threw = true; }
ok(threw, '이름이 없으면 거부');

// 여러 목소리 한꺼번에 — 빈 칸은 건드리지 않는다
VT.set('A', { gender: 'female', age: 'old' });
VT.setMany(['A', 'B', 'C'], { age: 'young', lang: 'ja', gender: '' });
const all = VT.load();
ok(all.A.gender === 'female' && all.A.age === 'young' && all.A.lang === 'ja', '한꺼번에: 지정한 칸만 바뀌고 빈 칸(성별)은 그대로');
ok(js(all.B) === js({ age: 'young', lang: 'ja' }) && js(all.C) === js({ age: 'young', lang: 'ja' }), '한꺼번에: 분류 없던 목소리에도 적용');
VT.setMany(['D'], { gender: '', age: '', lang: '' });
ok(!('D' in VT.load()), '한꺼번에: 지정한 칸이 하나도 없으면 아무것도 안 한다');

// 서버 카드에 얹기 + 거르기가 분류를 따른다(이름 추정보다 앞선다)
const cards = [{ name: 'A', id: 'srv:A', lang: 'ko' }, { name: 'JA_남성_중년', id: 'srv:JA_남성_중년', lang: 'ja' }, { name: '득수', id: 'srv:득수', lang: 'ko' }];
VT.set('JA_남성_중년', { gender: 'female', age: 'young' });   // 이름과 반대로 분류 → 분류가 이긴다
const merged = cards.map((c) => VT.apply(c, VT.load()));
ok(VF.genderOf(merged[1]) === 'female' && VF.ageOf(merged[1]) === 'young', '분류가 이름 추정(남성·중년)보다 앞선다 — 판정력');
ok(VF.genderOf(merged[2]) === '' && VF.ageOf(merged[2]) === '' && !merged[2].tags, '분류 없는 목소리는 그대로(추정도 못 하면 미표시)');
ok(merged[0].lang === 'ja' && merged[0].tags.lang === 'ja', '분류의 언어가 카드 언어를 바꾼다(거르기용)');
ok(VF.matchFacets(merged[0], 'female', 'young') && !VF.matchFacets(merged[2], 'female', ''), '성별·연령대 거르기가 분류를 쓴다');
ok(VF.ageOf({ age: 'middle' }) === 'middle' && VF.ageOf({ age: 'old' }) === 'old', '분류값(child|young|middle|old)은 그대로 읽는다');
fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${fail ? '❌' : '✅'} omni-tags — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
