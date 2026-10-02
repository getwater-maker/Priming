'use strict';
/** node test/book-register-info.test.js — 📋 부크크 등록정보 파일(기준/등록/<권>.등록정보.md): 파싱 · 위치 찾기 · 원고 메타보다 우선 · 입력 되짚기(R24) */
const fs = require('fs'), path = require('path'), os = require('os');
const RI = require('../core/book/register-info');
const RF = require('../core/book/register-fill');
const RB = require('../core/book/register-browser');
const { parseBookText } = require('../core/parsers/book-parser');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const NL = String.fromCharCode(10);
const FILE = ['# 삼국지 완역 1 — 부크크 등록 입력값', '', '> 설명 줄(무시)', '', '## [2단계 도서정보]', '', '- 도서명: 삼국지 완역 1', '- 부제: 천하대란', '- 저자: 나관중 지음 · 한득수 옮김',
  '- 도서 제작 목적: ISBN 출판 판매용', '- ISBN: 부크크에서 무료등록', '- 대표 장르: 소설 - 고전 문학', '', '## [5단계 최종확인]', '', '- AI 활용 여부 및 기여정도: 표지 및 본문 일부 작성에 사용',
  '- 초상/저작권 보유여부: 모든 콘텐츠 초상/저작권 보유중', '', '## [도서소개]', '', '첫 문단입니다.', '', '둘째 문단입니다.', '', '## [도서목차]', '', '제1회 도원결의', '제2회 장비, 독우를 매질하다', '', '## [저자경력소개]', '', '나관중: 소개.', ''].join(NL);
console.log('\n[1] 파싱');
const i = RI.parseRegisterInfo(FILE);
ok(i.title === '삼국지 완역 1' && i.subtitle === '천하대란' && i.author === '나관중 지음 · 한득수 옮김', '도서명·부제·저자');
ok(i.genre === '소설 - 고전 문학' && i.ai === '표지 및 본문 일부 작성에 사용' && /보유중/.test(i.rights) && /무료/.test(i.isbnText), '장르·AI·저작권·ISBN');
ok(i.intro === '첫 문단입니다.' + NL + NL + '둘째 문단입니다.' && i.toc === '제1회 도원결의' + NL + '제2회 장비, 독우를 매질하다' && i.bio === '나관중: 소개.', '소개(문단 사이 빈 줄 유지)·목차(줄 그대로 — 쉼표도 그대로)·저자경력');
console.log('\n[2] 파일 위치');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-'));
const W = path.join(T, '작품'); for (const d of ['원고', '기준/등록']) fs.mkdirSync(path.join(W, d), { recursive: true });
const ms = path.join(W, '원고', '제1권.md'); fs.writeFileSync(ms, '# t');
ok(RI.findRegisterInfoFile(ms, {}) === '', '파일이 없으면 빈 값');
const f1 = path.join(W, '기준', '등록', '제1권.등록정보.md'); fs.writeFileSync(f1, FILE);
ok(RI.findRegisterInfoFile(ms, {}) === f1, '<작품>/기준/등록/<원고이름>.등록정보.md 를 자동으로 찾는다');
const f2 = path.join(W, '기준', '등록', '다른.md'); fs.writeFileSync(f2, FILE.replace('천하대란', '다른부제'));
ok(RI.findRegisterInfoFile(ms, { registerInfo: '../기준/등록/다른.md' }) === f2 && RI.loadRegisterInfo(ms, { registerInfo: '../기준/등록/다른.md' }).subtitle === '다른부제', '원고 메타 `> 등록정보:`(원고 기준 상대경로)가 자동 찾기보다 우선');
ok(RI.findRegisterInfoFile(ms, { registerInfo: '../기준/등록/없는파일.md' }) === '', '메타가 가리키는 파일이 없으면 다른 걸 몰래 쓰지 않는다');
ok(parseBookText('# t\n> 등록정보: ../기준/등록/제1권.등록정보.md\n', 'x').meta.registerInfo === '../기준/등록/제1권.등록정보.md', '원고 메타 키 「등록정보」');
console.log('\n[3] 원고 메타보다 우선(2·5단계)');
const book = parseBookText('# 삼국지 완역 1 : 천하대란\n> 저자: 나관중\n> 부제: 제1~13회\n> 카테고리: 에세이\n', 'x');
const p0 = RF.bookkPlan(book, { trimId: 'A5', pages: 271, interiorPdf: 'a' });
const p1 = RF.bookkPlan(book, { trimId: 'A5', pages: 271, interiorPdf: 'a', registerInfo: { ...i, file: f1 }, shotDir: path.join(T, 'shots') });
ok(p0.step2.title === '삼국지 완역 1 : 천하대란' && p0.step2.genre === '에세이', '판별: 파일이 없으면 원고 메타 값(제목·카테고리)');
ok(p1.step2.title === '삼국지 완역 1' && p1.step2.subtitle === '천하대란' && p1.step2.author === '나관중 지음 · 한득수 옮김' && p1.step2.genre === '소설 - 고전 문학', '파일이 있으면 도서명·부제·저자·장르가 이긴다(제목 정리 없음)');
ok(p1.step2.isbnMode === 'bookk' && p1.step2.purpose === 'external' && p1.step5.intro.startsWith('첫 문단') && p1.step5.toc.split(NL).length === 2 && p1.step5.bio === '나관중: 소개.', '5단계: 소개·목차(줄 그대로)·저자경력 + ISBN 부크크 무료');
ok(p1.step5.ai === '표지 및 본문 일부 작성에 사용' && p1.step5.rights === '모든 콘텐츠 초상/저작권 보유중' && p1.registerInfoFile === f1 && p1.shotDir.endsWith('shots'), 'AI·저작권 선택 + 파일 경로·캡처 폴더');
ok(!p1.manual.some((s) => /도서소개|저자경력/.test(s)), '소개·저자경력이 파일에서 오면 「직접 해야 할 것」에서 빠진다');
const pI = RF.bookkPlan(book, { trimId: 'A5', registerInfo: { ...i, isbnText: '979-11-000-0000-0' } });
ok(pI.step2.isbnMode === 'other' && pI.step2.isbn === '979-11-000-0000-0', 'ISBN 이 숫자면 「보유 ISBN」');
console.log('\n[4] 입력 되짚기 · 캡처 (가짜 페이지)');
const page = (vals, sels) => ({ locator: (sel) => ({ first() { return this; }, async inputValue() { return vals[sel]; }, async evaluate() { return sels[sel]; } }),
  async screenshot({ path: f }) { fs.writeFileSync(f, 'x'); } });
let logs = [], failed = [];
await_(async () => {
  await RB.verifyInput(page({ a: '삼국지 완역 1' }), 'a', '삼국지 완역 1', '도서명', (m) => logs.push(m), failed);
  ok(failed.length === 0 && logs.some((l) => /✓ 도서명: 삼국지 완역 1/.test(l)), '같으면 ✓ 확인 로그');
  await RB.verifyInput(page({ a: '삼국지' }), 'a', '삼국지 완역 1', '도서명', (m) => logs.push(m), failed);
  ok(failed.includes('도서명 확인') && logs.some((l) => /값이 다릅니다/.test(l)), '판별: 다르면 ⚠ 값이 다릅니다 + failed');
  const sh = await RB.shot(page({}, {}), { shotDir: path.join(T, 'shots') }, (m) => logs.push(m), '2단계');
  ok(sh.endsWith('2단계.png') && fs.existsSync(sh) && logs.some((l) => /📸 2단계 캡처/.test(l)), '캡처 파일 저장 + 경로 로그');
  ok((await RB.shot(page({}, {}), {}, () => {}, 'x')) === '', 'shotDir 가 없으면 캡처하지 않는다');
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'book', 'register-browser.js'), 'utf8');
  ok(/_verifyInput\(page, 'textarea\[placeholder\*="도서의 설명"\]'/.test(src) && /_shot\(page, plan, log, '5단계'\)/.test(src) && /_shot\(page, plan, log, '2단계'\)/.test(src), '2단계·5단계에 되짚기와 캡처가 연결돼 있다');
  fs.rmSync(T, { recursive: true, force: true });
  console.log(`\n${fail ? '❌' : '✅'} book-register-info — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
});
function await_(fn) { fn().catch((e) => { console.error(e); process.exit(1); }); }
