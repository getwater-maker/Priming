// 🎭 대본 보기에서 `[이름] 대사` 로 고치면 화자가 바뀐다 — .md 에서 그 문장이 자기 줄 `[이름] 대사` 가 되고 파서가 화자로 읽는다
const assert = require('assert');
const SE = require('../core/script-edit');
const SS = require('../core/sentence-splitter');

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

ok(SE.splitSpeakerPrefix('[할머니] 허허, 그랬구나.').name === '할머니', '접두 인식');
ok(SE.splitSpeakerPrefix('[할머니] 허허, 그랬구나.').body === '허허, 그랬구나.', '본문');
ok(SE.splitSpeakerPrefix('그냥 글') === null, '접두 없음');
ok(SE.splitSpeakerPrefix('[할머니]붙여씀') === null, '공백 없으면 화자 아님(파서와 같은 규칙)');

function speakersOf(raw) { return SS.splitIntoParagraphItems ? null : null; }

// 문단 가운데 문장 → 화자 줄로 분리, 앞뒤 문장은 그대로·화자 없음
{
  const raw = '# 제목\n\n그가 왔다. 허허, 그랬구나. 그는 갔다.\n\n끝.\n';
  const i = raw.indexOf('허허'), e = raw.indexOf('그랬구나.') + 5;
  const out = SE.withSpeakerLine(raw, { start: i, end: e }, '허허, 그랬구나.', '할머니');
  ok(out === '# 제목\n\n그가 왔다.\n[할머니] 허허, 그랬구나.\n그는 갔다.\n\n끝.\n', '문단 가운데 분리: ' + JSON.stringify(out));
}
// 이미 화자 줄 안의 문장 → 앞뒤 조각은 원래 화자 유지
{
  const raw = '[노인] 하나다. 둘이다. 셋이다.\n';
  const a = raw.indexOf('둘'), b = raw.indexOf('둘이다.') + 4;
  const out = SE.withSpeakerLine(raw, { start: a, end: b }, '둘이다.', '할머니');
  ok(out === '[노인] 하나다.\n[할머니] 둘이다.\n[노인] 셋이다.\n', '화자 줄 안 분리: ' + JSON.stringify(out));
}
// 줄 전체가 그 문장 + CRLF
{
  const raw = '앞.\r\n뒤다.\r\n끝.\r\n';
  const a = raw.indexOf('뒤다.'), b = a + 3;
  const out = SE.withSpeakerLine(raw, { start: a, end: b }, '뒤다.', '할머니');
  ok(out === '앞.\r\n[할머니] 뒤다.\r\n끝.\r\n', 'CRLF 유지: ' + JSON.stringify(out));
}

// 파서가 실제로 화자로 읽는가(왕복)
{
  const P = require('../core/pipeline');
  const raw = '# 제목\n\n그가 왔다. 허허, 그랬구나. 그는 갔다.\n\n끝이다.\n';
  const before = P.parseScriptText(raw, 'longform', {}).projects[0];
  const texts = before.sentences.map((s) => s.text);
  const from = texts.findIndex((t) => t.includes('그랬구나'));
  const plan = SE.planEdit({ raw, texts, from, count: 1, newText: '허허, 그랬구나.' });
  ok(plan.ok, 'planEdit');
  const newRaw = SE.withSpeakerLine(raw, plan.span, SE.normalizeEditText('허허, 그랬구나.'), '할머니');
  const after = P.parseScriptText(newRaw, 'longform', {}).projects[0];
  ok(SE.sameSequence(texts, after.sentences.map((s) => s.text)), '문장 시퀀스 불변');
  const spk = after.sentences.map((s) => s.speaker || null);
  ok(spk[from] === '할머니', '그 문장만 화자: ' + JSON.stringify(spk));
  ok(spk.filter(Boolean).length === 1, '다른 문장 화자 없음');
}
console.log('script-edit-speaker: ' + n + ' passed');
