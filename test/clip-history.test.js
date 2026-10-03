/**
 * 🕘 클립 수정 이력(core/clip-history) — 3번 고치면 원본 + 3 = 4개 안 어디로든 갈 수 있다.
 * 원문 모듈을 그대로 require 한다. 저장 파일은 PM_UI_SMOKE 로 임시 폴더.
 */
process.env.PM_UI_SMOKE = '1';
const assert = require('assert');
const CH = require('../core/clip-history');
CH._resetForTest();

let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
const S = (id, text) => ({ id, text });

// [1] 한 문장을 3번 고친다 → 원본 + 3
const s0 = S('a', '처음 글입니다.'), s1 = S('b', '한 번 고친 글입니다.'), s2 = S('c', '두 번 고친 글입니다.'), s3 = S('d', '세 번 고친 글입니다.');
ok(CH.countOf(s0) === 0, '이력 없는 문장 = 0');
CH.record(s0, s1); CH.record(s1, s2); CH.record(s2, s3);
ok(CH.countOf(s3) === 3, '3번 고침 = 3');
let h = CH.listOf(s3);
ok(h.versions.length === 4 && h.idx === 3, '원본+3 = 4개, 지금은 끝');
ok(h.versions.map((v) => v.text).join('|') === [s0, s1, s2, s3].map((x) => x.text).join('|'), '순서 보존');

// [2] 어디로든 — 1번째로 돌아가면 idx 만 옮기고 이력은 그대로
const r1 = S('e', s1.text);
CH.record(s3, r1, 1);
h = CH.listOf(r1);
ok(h.versions.length === 4 && h.idx === 1, '되돌려도 4개 유지 · idx=1');
// 다시 원본(0) → 그리고 마지막(3)으로 앞으로도 갈 수 있다
const r0 = S('f', s0.text); CH.record(r1, r0, 0);
ok(CH.listOf(r0).idx === 0 && CH.listOf(r0).versions.length === 4, '원본으로');
const r3 = S('g', s3.text); CH.record(r0, r3, 3);
ok(CH.listOf(r3).idx === 3, '다시 앞으로(마지막 수정본)');

// [3] 되돌린 뒤 새로 고치면 끝에 이어 붙인다(옛 것을 버리지 않는다)
const r1b = S('h', s1.text); CH.record(r3, r1b, 1);
const n = S('i', '되돌린 뒤 새로 고친 글입니다.'); CH.record(r1b, n);
h = CH.listOf(n);
ok(h.versions.length === 5 && h.idx === 4 && h.versions[2].text === s2.text, '새 수정은 끝에 · 중간 기록 보존');

// [4] 검증 — 밖에서 글이 바뀌어 이력에 없는 글이면 이력을 쓰지 않는다(엉뚱한 글로 덮지 않게)
ok(CH.countOf(S('i', '밖에서 고친 전혀 다른 글.')) === 0, '이력과 안 맞는 글 = 이력 없음');
// [5] 전체 되돌리기(↶)로 옛 id 가 돌아와도 이어진다
ok(CH.countOf(S('b', s1.text)) === 4, '옛 id 로도 이력을 찾는다(글이 이력 안에 있을 때)');
// [6] 글이 안 바뀌면(공백만) 새 이력을 쌓지 않는다
const w = S('j', n.text + '  '); CH.record(n, w);
ok(CH.listOf(w).versions.length === 5, '공백만 달라도 새 버전 없음');

// [7] 다른 대본(범위)에서는 같은 id·글이어도 이력이 안 섞인다
let scope = 'A.md'; CH.setScopeFn(() => scope);
const x0 = S('z', '범위 글.'), x1 = S('y', '범위 글 수정.');
CH.record(x0, x1); ok(CH.countOf(x1) === 1, 'A 대본에서 1번');
scope = 'B.md'; ok(CH.countOf(x1) === 0 && CH.countOf(x0) === 0, 'B 대본에선 이력 없음');
scope = 'A.md'; ok(CH.countOf(x1) === 1, 'A 로 돌아오면 이력 그대로');

console.log('clip-history: ' + pass + ' 통과');
