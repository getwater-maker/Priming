'use strict';
/**
 * node test/book-register.test.js — 📤 등록 도우미(작가와·부크크 점검표) + 표지 안내 페이지 제거 + 새 메타 키
 */
const RG = require('../core/book/register-guide');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildBookHtml } = require('../core/book/html-builder');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const by = (l, id) => [...l.required, ...l.optional].find((i) => i.id === id);

console.log('\n[1] 새 메타 키 — 파서');
const md = ['# 책', '> 저자: 나', '> 카테고리: 소설', '> 키워드: 삼국지, 고전', '> 한줄소개: 천하대란', '> 표지재질: 아르떼 210g 무광코팅',
  '> 내지색: 컬러', '> AI사용: 없음', '', '## 1장. 시작', '', '본문'].join('\n');
const m = parseBookText(md, 'x').meta;
ok(m.category === '소설' && m.keywords === '삼국지, 고전' && m.tagline === '천하대란', '카테고리·키워드·한줄소개');
ok(m.coverMaterial === '아르떼 210g 무광코팅' && m.printColor === '컬러' && m.aiDisclosure === '없음', '표지재질·내지색·AI사용');

console.log('\n[2] 표지 안내 페이지가 미리보기에서 사라졌다');
const html = buildBookHtml(parseBookText(md, 'x'), { sourceMap: true }).html;
ok(!/cover-info|표지 스프레드 안내/.test(html), '조판 HTML 에 표지 안내 없음');

console.log('\n[3] 부크크 점검표');
const base = { meta: { title: '삼국지', author: '나관중' }, pages: 232, trimId: 'A5', spineMm: 14.36, flaps: false, outputs: [], excluded: [], presentKeys: [] };
let l = RG.checklist('bookk', base);
ok(by(l, 'trim').state === 'ok' && by(l, 'pages').state === 'ok', 'A5 · 232쪽 통과');
ok(by(l, 'price').state === 'todo' && by(l, 'cover').state === 'todo' && by(l, 'interior').state === 'todo', '정가·표지·내지 PDF 미완');
ok(by(RG.checklist('bookk', { ...base, trimId: '신국판' }), 'trim').state === 'todo', '신국판은 부크크 4종 밖 → todo');
ok(by(RG.checklist('bookk', { ...base, pages: 30 }), 'pages').state === 'todo', '50쪽 미만 → todo');
ok(by(RG.checklist('bookk', { ...base, flaps: true }), 'flaps').state === 'todo', '날개 켜면 todo');
l = RG.checklist('bookk', { ...base, meta: { ...base.meta, price: '15,000원' }, coverImagePath: 'a.png', coverCheck: { ok: true, lowDpi: false },
  outputs: [{ kind: 'interior', name: 'a_내지.pdf', bytes: 1e6 }] });
ok(by(l, 'price').state === 'ok' && by(l, 'cover').state === 'ok' && by(l, 'interior').state === 'ok', '입력하면 ok');
ok(by(RG.checklist('bookk', { ...base, coverImagePath: 'a.png', coverCheck: { ok: true, lowDpi: true, effectiveDpi: 150 } }), 'cover').state === 'todo', '저해상도 표지 → todo');
ok(by(l, 'account').state === 'manual' && by(RG.checklist('bookk', { ...base, confirmed: { account: true } }), 'account').state === 'ok', '수동 확인 항목은 체크하면 ok');
ok(by(l, 'isbn').state === 'info', 'ISBN 은 선택(info)');

console.log('\n[4] 작가와 점검표');
const eb = { ...base, meta: { title: '삼국지', author: '나관중' }, presentKeys: ['toc', 'colophon'] };
l = RG.checklist('jakkawa', eb);
ok(by(l, 'toc').state === 'ok' && by(l, 'biblio').state === 'ok', '목차·서지정보(판권) 있음');
ok(by(RG.checklist('jakkawa', { ...eb, excluded: ['toc'] }), 'toc').state === 'todo', '목차 제외 → todo');
ok(by(RG.checklist('jakkawa', { ...eb, presentKeys: ['toc'] }), 'biblio').state === 'todo', '판권 없음 → 서지정보 todo');
ok(by(l, 'ebookPrice').state === 'todo' && by(l, 'issueDate').state === 'todo', '판매가·출판일 미입력 → todo');
ok(by(l, 'size').state === 'todo', '파일 없으면 50MB 항목 todo');
ok(by(RG.checklist('jakkawa', { ...eb, outputs: [{ kind: 'epub', name: 'a.epub', bytes: 3e6 }] }), 'size').state === 'ok', '3MB epub → 통과');
ok(by(RG.checklist('jakkawa', { ...eb, outputs: [{ kind: 'ebookPdf', name: 'a.pdf', bytes: 60 * 1024 * 1024 }] }), 'size').state === 'todo', '60MB → 50MB 초과');
ok(by(l, 'aiDisclosure').state === 'todo' && by(RG.checklist('jakkawa', { ...eb, meta: { ...eb.meta, aiDisclosure: '없음' } }), 'aiDisclosure').state === 'ok', 'AI 표기 선택 여부');
ok(RG.remaining(l) === l.required.filter((i) => i.state !== 'ok').length && RG.remaining(l) > 0, '남은 필수 개수');

console.log('\n[5] 서지정보 양식·요약');
const bib = RG.ebookBiblio({ issueDate: '2026.10.01', author: '나관중', publisher: '고전서재', ebookPrice: '8,000원', ebookIsbn: '979-11-000-0001-0' });
ok(/출판일 \| 2026\.10\.01/.test(bib) && /판매가 \| 8,000 원/.test(bib) && /서면 동의/.test(bib), '작가와 공식 양식');
ok(/출판사 \| 작가와/.test(RG.ebookBiblio({})), '출판사 없으면 작가와');
const sum = RG.summary('bookk', { ...base, meta: { title: 'T' }, paperId: '미색모조 100g', spread: { spineMm: 14.36, widthMm: 316.36, heightMm: 216, widthPx: 3737, heightPx: 2551 } });
ok(sum.find(([k]) => k === '표지 재질')[1] === RG.DEFAULT_COVER_MATERIAL, '표지 재질 기본값');
ok(/316\.36/.test(sum.find(([k]) => k === '표지 스프레드')[1]), '표지 스프레드 mm/px');
ok(RG.AUTO_UPLOAD.api === false && RG.LINKS.bookk.every(([, u]) => /^https:\/\/(www\.)?bookk\.co\.kr\//.test(u)) && RG.LINKS.jakkawa.every(([, u]) => /^https:\/\/www\.jakkawa\.com\//.test(u)), '링크는 공식 도메인만 · 자동업로드 API 없음 기록');

console.log(`\n${fail ? '❌' : '✅'} book-register — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
