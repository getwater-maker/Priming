'use strict';
/**
 * node test/book-flaps.test.js — 🪽 표지 날개(삼국지 요청 R11 · 로이 2026-10-01 「원고에 날개 여부를 쓰면 프라이밍이 반영」)
 *   날개 기능 자체(메타 `날개` · [앞날개]/[뒷날개] · coverSpread)는 이미 있었다. 이 테스트는 R11 의 세 빈틈을 지킨다:
 *   ① 등록 도우미 — 자체 제작 표지는 날개 가능(A4 만 불가) ② 자동 입력이 원고 `날개` 를 따름 ③ 표지 치수 검증이 날개 설정을 따르고 「날개 설정을 확인하세요」.
 */
const fs = require('fs'), path = require('path');
const SC = require('../core/book/spine-calc');
const RG = require('../core/book/register-guide');
const RF = require('../core/book/register-fill');
const { parseBookText } = require('../core/parsers/book-parser');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const by = (l, id) => [...l.required, ...l.optional].find((i) => i.id === id);

console.log('\n[1] 스프레드 기대치 — 책등 14.3mm: 끔 316.3mm · 켬 516.3mm (삼국지 시안 기준)');
const off = SC.coverSpread({ platformId: 'bookk', trimId: 'A5', totalPages: 232, spineOverrideMm: 14.3, flaps: false });
const on = SC.coverSpread({ platformId: 'bookk', trimId: 'A5', totalPages: 232, spineOverrideMm: 14.3, flaps: true });
ok(off.widthMm === 316.3 && off.heightMm === 216, `날개 끔 ${off.widthMm}×${off.heightMm}mm`);
ok(on.widthMm === 516.3 && on.heightMm === 216, `날개 켬 ${on.widthMm}×${on.heightMm}mm`);
ok(on.parts.map((p) => p.name).join() === 'bleed,뒷날개,뒤표지,책등,앞표지,앞날개,bleed', '구획: 재단·뒷날개·뒤표지·책등·앞표지·앞날개·재단');
const m = parseBookText('# t\n> 날개: 있음\n> 책등두께: 14.3\n', 'x').meta;
ok(m.flaps === '있음' && m.spineMm === '14.3', '원고 메타 `날개`·`책등두께` 를 읽는다(문법은 그대로)');

console.log('\n[2] 표지 이미지 치수 검증 — 날개 설정을 따르고, 반대 설정에 맞으면 힌트');
const px = (spread) => ({ imgW: spread.widthPx, imgH: spread.heightPx });
let v = SC.validateCoverImage({ ...px(off), spread: off, altSpread: on });
ok(v.ok && !v.flapHint, '날개 끈 원고 + 316.3mm 파일 → 통과');
v = SC.validateCoverImage({ ...px(on), spread: on, altSpread: off });
ok(v.ok && !v.flapHint, '날개 켠 원고 + 516.3mm 파일 → 통과');
v = SC.validateCoverImage({ ...px(on), spread: off, altSpread: on });
ok(!v.ok && v.flapHint === 'file-has-flaps' && v.expected.widthMm === 316.3, '날개 끈 원고에 날개 폭(516.3mm) 파일 → 불일치 + 「이 파일은 날개 포함」 힌트');
v = SC.validateCoverImage({ ...px(off), spread: on, altSpread: off });
ok(!v.ok && v.flapHint === 'file-has-no-flaps' && v.expected.widthMm === 516.3, '날개 켠 원고에 날개 없는 폭(316.3mm) 파일 → 불일치 + 「이 파일은 날개 없는」 힌트');
v = SC.validateCoverImage({ imgW: 1000, imgH: 1000, spread: off, altSpread: on });
ok(!v.ok && !v.flapHint, '판정력: 어느 쪽에도 안 맞는 파일은 날개 힌트를 주지 않는다');
v = SC.validateCoverImage({ ...px(off), spread: off });
ok(v.ok, '(하위 호환) altSpread 없이도 동작');

console.log('\n[3] 등록 도우미 점검표 — 자체 제작 표지는 날개 가능, A4 만 불가');
const base = { meta: { title: 'T', author: 'A' }, pages: 232, trimId: 'A5', spineMm: 14.3, flaps: false, outputs: [], excluded: [], presentKeys: [] };
let it = by(RG.checklist('bookk', base), 'flaps');
ok(it.state === 'ok' && /나중에 날개를 추가할 수 없/.test(it.hint), '날개 끔 → ok + 「나중에 추가 불가」 안내');
it = by(RG.checklist('bookk', { ...base, flaps: true }), 'flaps');
ok(it.state === 'ok' && /\+200mm/.test(it.hint) && /무료 표지는 날개가 없/.test(it.hint) && /나중에 날개를 추가할 수 없/.test(it.hint), 'A5 + 날개 켬 → ok(예전엔 todo「끄세요」) + 가로 +200mm · 무료 표지 불가 · 추가 불가 안내');
it = by(RG.checklist('bookk', { ...base, flaps: true, trimId: 'A4' }), 'flaps');
ok(it.state === 'todo' && /A4/.test(it.hint), 'A4 + 날개 켬 → todo(불가)');
it = by(RG.checklist('bookk', { ...base, flaps: true, coverImagePath: 'a.png', coverCheck: { ok: false, flapHint: 'file-has-no-flaps' } }), 'cover');
ok(it.state === 'todo' && /날개 설정을 확인하세요/.test(it.hint) && /날개 없는/.test(it.hint), '표지 항목: 날개 힌트가 「날개 설정을 확인하세요」로 안내');
ok(!/끄세요/.test(R('core/book/register-guide.js').split('function flapsItem')[1].split('function bookkChecklist')[0].replace('날개를 끄세요', '')), '옛 「끄세요」 문구는 A4 불가 안내에만 남는다');

console.log('\n[4] 자동 입력 — 원고 `날개` 를 따른다');
const plan = (md, trimId) => RF.bookkPlan(parseBookText(md, 'x'), { trimId: trimId || 'A5', pages: 232, interiorPdf: 'a.pdf' });
ok(plan('# t\n').step1.wings === false, '날개 메타 없음 → 없음');
ok(plan('# t\n> 날개: 있음\n').step1.wings === true, '날개: 있음 → wings=true');
ok(plan('# t\n> 날개: 없음\n').step1.wings === false && plan('# t\n> 날개: no\n').step1.wings === false, '날개: 없음·no → false');
const a4 = plan('# t\n> 날개: 있음\n', 'A4');
ok(a4.step1.wings === false && a4.manual.some((s) => /A4 는 날개 불가/.test(s)), 'A4 + 날개 → 누르지 않고 「직접」 목록에 이유');
const br = R('core/book/register-browser.js');
ok(/s1\.wings \? '날개 있음' : '날개 없음'/.test(br) && /s1\.wings \? \/\^날개 있음\$\/ : \/\^날개 없음\$\//.test(br), '브라우저: 날개 있음/없음을 s1.wings 로 고른다(무조건 「없음」 클릭 제거)');
ok(!/await step\('날개 없음'/.test(br), '옛 무조건 클릭 줄 없음');
ok(/날개\\s\*\(있음\|없음\)\\s\*두께/.test(br) && /failed\.push\('날개 /.test(br), '요약의 「날개 있음/없음」이 원하는 값과 다르면 failed 로 남긴다(추측 클릭 없음)');
const clicks = br.split('\n').filter((l) => /\.click\(/.test(l));
ok(!clicks.some((l) => /저장|제출|유통\s*신청|최종|승인|Step3|Step4|Step5|삭제|결제|로그아웃/.test(l)), '금지 버튼 클릭은 여전히 없다');

console.log('\n[5] 화면·main 배선');
const M = R('main.js'), BV = R('renderer/src/BookView.jsx');
ok(/function coverCheckFor\(parsed, imgW, imgH, pages\)/.test(M) && /altSpread: alt/.test(M), 'main: coverCheckFor — 지금 설정과 반대 설정의 스프레드를 함께 넘긴다');
ok(/coverCheck: \(parsed\._coverCheck && parsed\._coverCheck\.imgW\) \? coverCheckFor\(/.test(M), 'bookDTO: 표지 판정을 그때그때 다시 잰다(날개·쪽수를 바꾸면 낡은 판정이 남지 않는다)');
ok((M.match(/coverCheckFor\(S\.parsed/g) || []).length >= 2, '첨부·빌드 두 곳도 같은 함수');
ok(/날개 설정을 확인하세요/.test(BV) && /flapHint/.test(BV), '표지 탭: 「날개 설정을 확인하세요」 경고');

console.log(`\n${fail ? '❌' : '✅'} book-flaps — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
