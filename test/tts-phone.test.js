/**
 * 📞 전화번호 읽기(2026-10-12 로이 — 「1577-1000」을 엉뚱하게 읽었다 · 읽는 법 「일오칠칠에 일공공공」은 로이 지정)
 *   자막은 숫자 그대로, TTS 문자열(processForTTS)만 한 자리씩. 연도 범위처럼 보이면 그대로 + 경고.
 *   🔑 원문 함수를 그대로 실행한다.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TP = require(path.join(ROOT, 'tts/text-pronouncer'));

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)})`);
const P = (t) => TP.processForTTS(t, []);

console.log('[1] 바꾸는 것 — 확실한 전화번호');
eq(P('번호는 1577-1000.'), '번호는 일오칠칠에 일공공공.', '🔴 대표번호(실사고)');
eq(P('1588-1234로 전화하세요.'), '일오팔팔에 일이삼사로 전화하세요.', '대표번호 + 조사');
eq(P('1644-0000번'), '일육사사에 공공공공번', '16xx · 0 = 공');
eq(P('1800-1234'), '일팔공공에 일이삼사', '18xx 이고 뒤가 작다 → 번호');
eq(P('휴대폰 010-1234-5678 입니다.'), '휴대폰 공일공 일이삼사에 오육칠팔 입니다.', '휴대폰');
eq(P('02-123-4567'), '공이 일이삼에 사오육칠', '서울 지역번호');
eq(P('031-1234-5678'), '공삼일 일이삼사에 오육칠팔', '경기 지역번호');

console.log('[2] 바꾸지 않는 것');
eq(P('1592-1598년 전쟁'), '1592-1598년 전쟁', '연도 범위(15xx)는 그대로');
eq(P('1600-1700년대'), '1600-1700년대', '연도 범위(16xx)는 그대로');
eq(P('1592~1598년'), '1592에서 1598년', '물결표 범위는 예전 규칙 그대로');
eq(P('2024-2025년'), '2024-2025년', '20xx 범위(대표번호 앞자리 아님)');
eq(P('보험료율은 7.19%입니다.'), '보험료율은 7.19%입니다.', '소수는 그대로');
eq(P('1577-10000'), '1577-10000', '자리가 더 길면(번호 아님) 그대로');
eq(P('91577-1000'), '91577-1000', '앞에 숫자가 붙으면 그대로');
eq(P('1577-1000-1'), '1577-1000-1', '뒤에 하이픈이 이어지면 그대로');
eq(P('3-4-5 법칙'), '3-4-5 법칙', '짧은 숫자 묶음은 그대로');
eq(P('1577-1000'.replace('-', '')), '15771000', '하이픈 없는 숫자는 그대로');
eq(TP.processForTTS('상담은 1577-1000', [{ source: '1577-1000', pron: '일오칠칠 다시 일천', enabled: true }]), '상담은 일오칠칠 다시 일천',
  '📖 발음사전이 이긴다(사전 먼저)');
eq(P('電話は1577-1000です。'), '電話は1577-1000です。', '🇯🇵 일본어 문장은 건드리지 않는다');

console.log('[3] 경고 — 연도 범위처럼 보여 그대로 읽는 것');
eq(TP.phoneLikeWarnings('1592-1598년과 1577-1000'), [], '전화 낱말이 없으면 경고도 없다(생몰년·자료 연도 21곳 실측 = 전부 연도)');
eq(TP.phoneLikeWarnings('전화가 처음 놓인 1885-1900년 무렵'), ['1885-1900'], '전화 낱말 + 뒤에 「년」 = 애매 → 그대로 읽고 경고');
eq(P('전화가 처음 놓인 1885-1900년 무렵'), '전화가 처음 놓인 1885-1900년 무렵', '애매한 것은 바꾸지 않는다');
eq(P('상담 번호는 1588-1600입니다.'), '상담 번호는 일오팔팔에 일육공공입니다.', '연도처럼 보여도 전화 낱말이 있고 「년」이 없으면 번호');
eq(P('도스토옙스키(1821-1881)는'), '도스토옙스키(1821-1881)는', '생몰년은 그대로');
eq(TP.phoneLikeWarnings('그냥 문장'), [], '없으면 빈 목록');
const PL = fs.readFileSync(path.join(ROOT, 'core/pipeline.js'), 'utf8');
ok(/phoneLikeWarnings\(s && \(s\.ttsText \|\| s\.text\)\)/.test(PL), 'fillTtsList 가 만들기 전에 경고를 로그로 낸다');

console.log('[4] 한 곳 — 자막은 그대로');
const VB = fs.readFileSync(path.join(ROOT, 'vrew/vrew-builder.js'), 'utf8');
ok(!/readPhoneNumbers|processForTTS/.test(VB), '.vrew(자막)는 TTS 가공을 쓰지 않는다');
ok((PL.match(/readPhoneNumbers/g) || []).length === 0, '파이프라인에 번호 읽기 두 벌 없음(text-pronouncer 한 곳)');

console.log(`\n${fail ? '❌' : '✅'} tts-phone: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
