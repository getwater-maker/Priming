/**
 * follow-target.test.js — 📍 제작 화면 따라가기 기준(v0.9.43 · core/follow-target 원문 실행)
 *   ② 클립 = 지금 음성을 만드는 문장 · ① 미리보기 = 방금 완성된 그림·영상(영상 > 그림) · 없으면 만드는 그룹 · 음성만이면 ② 와 같은 곳
 */
const path = require('path');
const F = require(path.join(__dirname, '..', 'core', 'follow-target.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const run = { state: 'run' }, done = { state: 'done' }, skip = { state: 'skip' }, wait = { state: 'wait' };
const snap = (o) => ({ itemId: 'A', stages: { tts: run, image: run, video: wait, out: wait }, sent: { cur: { ord: 100, sn: 1 } }, image: { active: [], sn: 1 }, video: { active: [], sn: 1 }, ...o });

console.log('[1] 로이 예시 — TTS 100번 문장 · 이미지 G2 진행 · G1 은 방금 완성');
let st = F.step(null, snap({ image: { active: [1, 2], sn: 1 } }));
st = F.step(st, snap({ image: { active: [2], sn: 1 } }));   // G1 이 active 에서 빠짐 = 완성
let t = F.targets(st, snap({ image: { active: [2], sn: 1 } }));
ok(t.clip && t.clip.ord === 100 && t.clip.sn === 1, '② 클립 = 지금 음성을 만드는 100번 문장');
ok(t.preview && t.preview.group === 1, '① 미리보기 = 방금 완성된 G1');

console.log('[2] 아직 완성된 것이 없으면 ① = 만드는 그룹');
st = F.step(null, snap({ image: { active: [3], sn: 1 } }));
t = F.targets(st, snap({ image: { active: [3], sn: 1 } }));
ok(t.preview && t.preview.group === 3, '① = 지금 그리는 G3');

console.log('[3] 영상이 완성되면 그림보다 영상이 먼저');
st = F.step(null, snap({ image: { active: [5], sn: 1 }, video: { active: [2], sn: 1 } }));
st = F.step(st, snap({ image: { active: [], sn: 1 }, video: { active: [], sn: 1 } }));
t = F.targets(st, snap({ image: { active: [], sn: 1 }, video: { active: [], sn: 1 } }));
ok(t.preview && t.preview.group === 2, '① = 방금 완성된 영상 G2(그림 G5 보다 먼저)');

console.log('[4] TTS 가 끝났으면 ② = 그림을 만드는 그룹');
st = F.step(null, snap({ stages: { tts: done, image: run, video: wait, out: wait }, sent: { cur: null }, image: { active: [7], sn: 1 } }));
t = F.targets(st, snap({ stages: { tts: done, image: run, video: wait, out: wait }, sent: { cur: null }, image: { active: [7], sn: 1 } }));
ok(t.clip && t.clip.group === 7 && t.clip.ord == null, '② = G7 첫 문장(그룹 기준)');

console.log('[5] 음성만(그림·영상 단계 없음) → ① 도 지금 문장');
const audioOnly = snap({ stages: { tts: run, image: skip, video: skip, out: wait } });
st = F.step(null, audioOnly);
t = F.targets(st, audioOnly);
ok(t.preview && t.preview.ord === 100, '① = ② 와 같은 100번 문장');

console.log('[6] 대본이 바뀌면 「방금 완성」을 이어받지 않는다');
st = F.step(null, snap({ image: { active: [1], sn: 1 } }));
st = F.step(st, snap({ image: { active: [], sn: 1 } }));
const st2 = F.step(st, snap({ itemId: 'B', image: { active: [4], sn: 1 } }));
ok(st2.lastImg === null && F.targets(st2, snap({ itemId: 'B', image: { active: [4], sn: 1 } })).preview.group === 4, 'B 대본은 A 의 G1 이 아니라 B 의 G4');
ok(F.targets(null, null).clip === null, '진행 정보가 없으면 아무 데도 안 간다');

console.log(`\n${fail ? '❌' : '✅'} follow-target — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
