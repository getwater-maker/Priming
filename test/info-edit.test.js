'use strict';
/**
 * node test/info-edit.test.js — 📇 정보 카드 표시 줄 고치기(core/info-edit) — 자리 꼬리표 · 글 고치기 · 검증 재파싱 · 줄바꿈 보존
 */
const IE = require('../core/info-edit');
const IC = require('../core/info-cards');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const SRC = [
  '# 제목', '', '## 도입부', '### 〔첫 장면〕', '> 🖼️ 이미지: a room', '> 🔤 카드: 지역가입자 | 임의계속가입', '첫째 문장입니다. 둘째 문장입니다.', '',
  '## 1장 — 구간', '### 〔둘째 장면〕', '> 🖼️ 이미지: b room', '> 📊 표: 퇴직 뒤 내 자리', '> | 구분 | 보험료 |', '> | --- | --- |', '> | 기준 | 소득 + 재산 |', '> 📊 출처: 국민건강보험공단',
  '셋째 문장입니다.', '', '> ✅ 확인: 내 자리 확인 @오른쪽위', '넷째 문장입니다.', '',
].join('\n');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('[1] 위치 찾기');
{
  const sc = IE.scan(SRC);
  ok(sc.marks.length === 3 && sc.marks.map((m) => m.kind).join() === 'words,table,check', '표시 3개를 순서대로 찾는다(words · table · check)');
  ok(sc.marks[1].end - sc.marks[1].line === 4 && sc.marks[1].sep === true && sc.marks[1].mark.rows.length === 2 && sc.marks[1].mark.source === '국민건강보험공단', '표 = 제목 줄 + 행 + 구분선 + 출처 줄 한 덩어리');
  const fr = IC.fromRaw(SRC); ok(fr.marks.length === sc.marks.length && fr.marks.every((m, i) => m.kind === sc.marks[i].kind), '파서(fromRaw)가 읽는 표시와 같은 순서·종류');
}

console.log('\n[2] 자리 꼬리표');
{
  const r = IE.setPos(SRC, 0, 'lt');
  ok(r.ok && /> 🔤 카드: 지역가입자 \| 임의계속가입 @왼쪽위\n/.test(r.raw) && IC.fromRaw(r.raw).marks[0].pos === 'lt', '꼬리표가 없던 🔤 줄 끝에 @왼쪽위 가 붙는다');
  const lines0 = SRC.split('\n'), lines1 = r.raw.split('\n');
  ok(lines0.length === lines1.length && lines0.every((l, i) => i === 5 || l === lines1[i]), '그 줄 말고는 한 글자도 안 바뀐다(낭독·🖼️·표 줄 그대로)');
  const r2 = IE.setPos(SRC, 2, 'rc'); ok(r2.ok && /> ✅ 확인: 내 자리 확인 @오른쪽가운데/.test(r2.raw) && !/@오른쪽위/.test(r2.raw), '있던 꼬리표는 새 값으로 바뀐다(둘이 되지 않는다)');
  const r3 = IE.setPos(SRC, 2, null); ok(r3.ok && /> ✅ 확인: 내 자리 확인\n/.test(r3.raw) && IC.fromRaw(r3.raw).marks[2].pos == null, 'null 이면 꼬리표를 지운다(자동으로)');
  ok(IE.setPos(SRC, 2, 'rt').same === true, '같은 값이면 바뀐 게 없다(same)');
  ok(IE.setPos(SRC, 1, 'lt').ok === false && IE.setPos(SRC, 9, 'lt').ok === false && IE.setPos(SRC, 0, 'xx').ok === false, '표·없는 번호·모르는 자리는 거절');
}

console.log('\n[3] 글 고치기');
{
  const w = IE.setText(SRC, 0, { words: ['지역가입자', '피부양자', '임의계속가입'] });
  ok(w.ok && IC.fromRaw(w.raw).marks[0].words.join('|') === '지역가입자|피부양자|임의계속가입' && w.numChanged === false, '🔤 낱말 고치기');
  const c = IE.setText(SRC, 2, { text: '고지서 금액 읽기' });
  ok(c.ok && /> ✅ 확인: 고지서 금액 읽기 @오른쪽위/.test(c.raw), '✅ 문구 고치기 — 자리 꼬리표는 그대로 남는다');
  const t = IE.setText(SRC, 1, { title: '새 제목', rows: [['구분', '보험료'], ['기준', '소득']], source: '' });
  const tm = IC.fromRaw(t.raw).marks[1];
  ok(t.ok && tm.title === '새 제목' && tm.rows.length === 2 && tm.rows[1].join() === '기준,소득' && !tm.source && /--- \| ---/.test(t.raw), '📊 표 고치기(제목·행·출처 없애기 · 구분선은 유지)');
  const a = IE.scan(SRC).lines, b = IE.scan(t.raw).lines;
  ok(a[0] === b[0] && a[a.length - 2] === b[b.length - 2] && a.filter((l) => /첫째|셋째|넷째/.test(l)).join() === b.filter((l) => /첫째|셋째|넷째/.test(l)).join(), '표를 고쳐도 낭독 문단은 그대로');
  // 숫자 변경 경고
  const n1 = IE.setText(SRC, 1, { title: '퇴직 뒤 내 자리', rows: [['구분', '보험료'], ['기준', '소득 + 재산 7%']], source: '국민건강보험공단' });
  ok(n1.ok && n1.numChanged === true, '숫자가 바뀌면 numChanged(팩트시트 대조 경고용)');
  ok(IE.setText(SRC, 0, { words: ['가1', '나'] }).numChanged === true && IE.setText(SRC, 0, { words: ['가', '나'] }).numChanged === false, '숫자가 새로 생겨도 · 없어도 판정');
  // 거절
  ok(!IE.setText(SRC, 0, { words: [] }).ok && !IE.setText(SRC, 0, { words: ['a@b'] }).ok && !IE.setText(SRC, 0, { words: ['a|b'] }).ok, '낱말 비었음·@·| 는 거절');
  ok(!IE.setText(SRC, 2, { text: '' }).ok && !IE.setText(SRC, 2, { text: '문구@' }).ok, '확인 문구 비었음·@ 는 거절');
  ok(!IE.setText(SRC, 1, { title: 'x', rows: [] }).ok && !IE.setText(SRC, 1, { title: 'x', rows: [['a|b']] }).ok, '표 줄 없음·칸의 | 는 거절');
  // 줄바꿈 공백 정리
  ok(IC.fromRaw(IE.setText(SRC, 2, { text: '  내   자리\n확인 ' }).raw).marks[2].text === '내 자리 확인', '공백·줄바꿈은 한 칸으로 정리');
}

console.log('\n[4] 줄바꿈 CRLF 보존 · 검증 재파싱');
{
  const crlf = SRC.replace(/\n/g, '\r\n');
  const r = IE.setPos(crlf, 0, 'rt');
  ok(r.ok && !/[^\r]\n/.test(r.raw) && /@오른쪽위\r\n/.test(r.raw), 'CRLF 대본은 CRLF 로 돌려준다');
  const r2 = IE.setText(crlf, 2, { text: '새 문구' }); ok(r2.ok && !/[^\r]\n/.test(r2.raw), '글 고치기도 CRLF 유지');
  // verify — 낭독이 바뀐 가짜 결과는 막는다
  ok(IE.verify(SRC, SRC.replace('첫째 문장입니다.', '바뀐 문장입니다.'), 0, {}) !== null, '검증: 낭독 문장이 바뀌면 거절');
  ok(IE.verify(SRC, SRC.replace('> ✅ 확인: 내 자리 확인 @오른쪽위\n', ''), 0, {}) !== null, '검증: 표시 개수가 달라지면 거절');
  const rm = IE.readMark(SRC, 1); ok(rm.ok && rm.kind === 'table' && rm.title === '퇴직 뒤 내 자리' && rm.rows.length === 2 && rm.source === '국민건강보험공단', '고치기 창이 읽는 현재 값(readMark)');
}
console.log(`\n${fail ? '❌' : '✅'} info-edit ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
