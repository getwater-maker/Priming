'use strict';
/**
 * node test/book-register-fill.test.js — 등록 도우미 자동 입력 계획(작가와·부크크) + 「제출 버튼을 누르지 않는다」 소스 검사
 */
const fs = require('fs');
const path = require('path');
const RF = require('../core/book/register-fill');
const { parseBookText } = require('../core/parsers/book-parser');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const MD = ['# 삼국지연의, 제1권!', '> 부제: 『천하대란』', '> 저자: 나관중', '> 출판사: 고전서재', '> 발행일: 2026-10-01', '> 전자책: 8,000원', '> 정가: 15,000원',
  '> 카테고리: 소설', '> 키워드: 삼국지, 고전', '> AI사용: 있음', '> 표지재질: 아르떼 210g 무광코팅', '',
  '## [저자소개]', '', '나관중은 [원말명초]의 작가다.', '', '## [뒷표지]', '', '난세의 영웅들.', '',
  '## 제1회 도원결의', '', '본문', '', '## 제2회 장비', '', '본문'].join('\n');
const book = parseBookText(MD, '삼국지');

console.log('\n[1] 작가와 계획');
const jp = RF.jakkawaPlan(book, { fileType: 'EPUB', now: new Date('2026-09-30T00:00:00Z') });
const F = (n) => jp.fields.find((f) => f.name === n);
ok(F('G-a94bbc87').value === '삼국지연의 제1권', '도서명: 쉼표·! 제거 → ' + F('G-a94bbc87').value);
ok(F('G-9e6b8f43').value === '천하대란', '부제: 『 』 제거');
ok(F('G-dfb377a7').value === '2026.10.01', '출판예정일: 발행일 정규화');
ok(RF.jakkawaPlan(book, { now: new Date('2026-09-30T00:00:00Z') }) && RF.kstDatePlus(3, new Date('2026-09-30T20:00:00Z')) === '2026.10.04', 'KST 기준 +3일(UTC 20시 = KST 다음 날 5시)');
ok(F('G-04409f96').value === '소설' && F('G-04409f96').kind === 'select', '카테고리: 작가와 목록의 「소설」');
ok(F('G-eb7ac081').value === '나관중, AI', 'AI 사용 → 저자명에 AI 표기');
ok(F('G-de7cf940').value === '8000', '가격: 숫자만');
ok(F('G-b76769d1').value === '' && F('G-bb792321').value === '', 'ISBN 없으면 ISBN·출판사 비움(작가와가 발급)');
ok(/^본 도서는 AI를 활용했으니/.test(F('G-7a571d59').value) && /난세의 영웅들/.test(F('G-7a571d59').value), '책 소개: 첫 줄 AI 안내 + 뒷표지 글');
ok(F('G-2ff02152').value === '나관중은 원말명초의 작가다.', '저자소개: [ ] 제거');
ok(F('G-cd280027').value === '제1회 도원결의\n제2회 장비', '목차: 장 제목 줄바꿈');
ok(F('G-c5e7c7b5').value === 'EPUB' && F('G-0bf9a6df').value === '제한없음' && F('G-9abd07fd').value === '개인 저자', '고정 선택값');
const jNo = RF.jakkawaPlan(parseBookText('# t\n\n## 1장 a\n\n본문', 'x'), {});
ok(jNo.manual.includes('저자명(필명)(필수)') && jNo.manual.includes('도서 카테고리'), '비어 있는 필수 칸은 「직접」 목록으로');
ok(RF.jakkawaPlan(parseBookText('# t\n> 카테고리: 고전문학\n', 'x'), {}).fields.find((f) => f.name === 'G-06715b3d').value === '고전문학', '목록에 없는 카테고리는 세부 카테고리 칸으로');
ok(RF.pickOption('고전 문학', ['소설 - 소설 일반', '소설 - 고전 문학']) === '소설 - 고전 문학', '부크크 계층형 장르: 끝 일치');
ok(RF.pickOption('없는장르', ['소설 - 소설 일반']) === '', '없는 장르는 빈 값(조용히 다른 걸 고르지 않는다)');

console.log('\n[2] 부크크 계획');
const bp = RF.bookkPlan(book, { trimId: 'A5', pages: 232, interiorPdf: 'D:/x/a_내지.pdf' });
ok(bp.step1.color === '흑백' && bp.step1.trim === 'A5' && bp.step1.material === '아르떼(감성적인)' && bp.step1.pages === 232 && bp.step1.wings === false, '1단계: 흑백·A5·아르떼·날개 없음·232쪽');
ok(RF.bookkPlan(parseBookText('# t\n', 'x'), { trimId: 'A5' }).step1.material === '스노우(대중적인)', '표지재질 기본 = 스노우 250g 무광');
ok(bp.step2.purpose === 'external' && bp.step2.isbnMode === 'bookk' && bp.step2.adult === 'all', '2단계: ISBN 출판 판매용 · 부크크 무료 ISBN · 전연령');
ok(RF.bookkPlan(parseBookText('# t\n> ISBN: 979-11-000-0000-0\n', 'x'), {}).step2.isbnMode === 'other', 'ISBN 보유 → 이미 보유한 ISBN');
ok(bp.step2.title === '삼국지연의 제1권' && bp.step2.author === '나관중' && bp.step2.pdf.endsWith('_내지.pdf'), '2단계: 도서명·저자·PDF');
ok(RF.bookkPlan(book, { pages: 0 }).manual.some((s) => /쪽수/.test(s)) && bp.manual.some((s) => /3단계 표지/.test(s)) && bp.manual.some((s) => /도서제출/.test(s)), '못 하는 것(쪽수 없음·표지 PDF·도서제출)은 「직접」 목록');

console.log('\n[3] 🔴 제출/저장 버튼을 누르지 않는다(소스 검사)');
const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'book', 'register-browser.js'), 'utf8');
const clicks = src.split('\n').filter((l) => /\.click\(/.test(l));
ok(clicks.length >= 5, `click 호출 ${clicks.length}곳 확인`);
ok(!clicks.some((l) => /저장|제출|유통\s*신청|최종(?!확인)|승인|삭제|결제|로그아웃/.test(l)), '금지 버튼(저장·도서제출·유통신청·최종 입점·승인·삭제·결제·로그아웃) 클릭 없음 — 이동 버튼 Step5 최종확인 은 허용');
ok(!/\.(fill|type|press)\([^)]*(password|비밀번호)/i.test(src) && !/input\[type=password\]/.test(src), '비밀번호 입력 코드 없음');
const allowed = clicks.map((l) => l.trim()).join('\n');
ok(/Step2 원고등록/.test(allowed) && /Step3 표지디자인/.test(allowed) && /Step4 가격정책/.test(allowed) && /Step5 최종확인/.test(allowed), '허용된 이동 버튼은 Step2~Step5(로이 2026-10-02 「스텝5까지 자동화」)');
ok(!/도서\s*제출/.test(clicks.join('\n')) && !/hasText:[^)]*도서\s*제출/.test(src), '🔴 5단계 「도서제출」은 어떤 클릭·선택자에도 없다(로이가 직접)');

// ── 부크크 2단계 대표 장르 기본값(로이 2026-10-02) ──
{
  const RFx = require('../core/book/register-fill');
  const BKx = require('../core/parsers/book-parser');
  const p1 = RFx.bookkPlan(BKx.parseBookText('# t\n> 저자: a\n', 'x'), { trimId: 'A5', pages: 100, interiorPdf: 'a.pdf' });
  ok(p1.step2.genre === '소설 - 고전 문학' && !p1.manual.some((s) => /대표 장르/.test(s)), '카테고리가 없으면 대표 장르 = 「소설 - 고전 문학」 (직접 해야 할 목록에서도 뺐다)');
  const p2 = RFx.bookkPlan(BKx.parseBookText('# t\n> 저자: a\n> 카테고리: 에세이\n', 'x'), { trimId: 'A5', pages: 100, interiorPdf: 'a.pdf' });
  ok(p2.step2.genre === '에세이' && p2.step2.genreFallback === '소설 - 고전 문학', '판별: 원고 카테고리가 있으면 그것을 먼저, 안 맞을 때만 기본값');
  const opts = ['선택', '소설 - 현대 문학', '소설 - 고전 문학', '에세이'];
  ok(RFx.pickOption('소설 - 고전 문학', opts) === '소설 - 고전 문학', 'pickOption: 정확 일치');
  const bsrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'core', 'book', 'register-browser.js'), 'utf8');
  ok(/pickOption\(s2\.genre, texts\) \|\| RF\.pickOption\(s2\.genreFallback/.test(bsrc), '브라우저: 원고 카테고리가 목록에 없으면 기본 장르로 폴백');
}


console.log(`\n${fail ? '❌' : '✅'} book-register-fill — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
