'use strict';
/**
 * node test/book-editions.test.js — 📕 종이책 / 📱 전자책 PDF 구분 + 삼국지 요청 R1·R6·R7 (v0.5.96)
 *   R1 홀수쪽 러닝헤드 「제N회」만(chapterNo) · R6 원고 메타 `> 특별섹션:` · R7 부크크 용지·책등 공식
 *   전자책 판: 백면 없음(recto → page) · 안/바깥 여백 같음 · 앞표지 1쪽 · 링크 살림 · 판권 전자책 ISBN·정가 없음
 *   ePub: 역사 노트 상자 · 전자책 ISBN
 */
const path = require('path');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildBookHtml, specialKeywordsOf, splitSpecialBlocks } = require('../core/book/html-builder');
const PP = require('../core/book/platform-presets');
const SC = require('../core/book/spine-calc');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const MD = [
  '# 삼국지연의', '> 저자: 나관중', '> 출판사: 고전서재', '> ISBN: 9791100000001', '> 전자책ISBN: 9791100000002',
  '> 정가: 15,000원', '> 전자책: 8,000원', '> 특별섹션: 역사 노트', '> 책등두께: 14.5', '',
  '## [판권]', '', '## 제1회 도원에서 의형제를 맺고, 황건적을 무찔러 처음 공을 세우다', '',
  '본문 첫 문단입니다. 자세한 내용은 [누리집](https://example.com/a) 과 [내부](../a.md) 참고.', '',
  '### 역사 노트', '', '노트 안의 문단.', '', '### 다음 절', '', '노트 밖의 문단.', '',
].join('\n');
const book = parseBookText(MD, '삼국지');

console.log('\n[1] R7 — 부크크 용지·책등 공식');
ok(SC.spineWidthMm(232, null, 'bookk') === 14.36, `232쪽 = 14.36mm (실제 ${SC.spineWidthMm(232, null, 'bookk')})`);
ok(SC.spineWidthMm(399, null, 'bookk') === 23.55 && SC.spineWidthMm(400, null, 'bookk') === 19.6, `399쪽 23.55 → 400쪽 19.6 (경계에서 공식이 바뀐다 — 부크크 화면 그대로)`);
ok(PP.bookkPaper(399) === '미색모조 100g' && PP.bookkPaper(400) === '미색모조 80g', '내지 용지: 399쪽 미색모조 100g · 400쪽 미색모조 80g');
ok(PP.getPlatform('bookk').defaultPaper === '미색모조 100g', '부크크 기본 용지 = 미색모조 100g');
ok(PP.effectivePaper('bookk', '백색모조 150g', 232) === '미색모조 100g', '부크크는 메타 용지가 무엇이든 쪽수가 정한다(잠금)');
ok(PP.effectivePaper('kyobo', '백색모조 150g', 232) === '백색모조 150g', '교보는 메타 용지를 그대로');
ok(SC.spineWidthMm(232, '백색모조 100g', 'kyobo') === 13.3, '교보 232쪽 백색모조 100g = 13.3mm(옛 식 그대로 — 다른 플랫폼 불변)');
const spM = SC.coverSpread({ platformId: 'bookk', trimId: 'A5', totalPages: 232, spineOverrideMm: 14.5 });
ok(spM.spineMm === 14.5 && spM.spineManual, '손으로 적은 책등 두께가 계산을 이긴다');
ok(SC.coverSpread({ platformId: 'bookk', trimId: 'A5', totalPages: 232 }).widthMm === 316.36, '232쪽 A5 스프레드 폭 = 6+148+14.36+148 = 316.36mm');
ok(book.meta.spineMm === '14.5' && book.meta.ebookIsbn === '9791100000002' && book.meta.specialSections === '역사 노트', '파서: 책등두께·전자책ISBN·특별섹션 메타를 읽는다');

console.log('\n[2] R1 — 홀수쪽 러닝헤드 「제N회」만');
const hNo = buildBookHtml(book, { headerOdd: 'chapterNo' }).html;
const hFull = buildBookHtml(book, {}).html;
ok(/string\(chapter-no, first-except\)/.test(hNo), 'chapterNo → 러닝헤드가 chapter-no 문자열');
ok(!/string\(chapter-no/.test(hFull) && /string\(chapter-title, first-except\)/.test(hFull), '기본값은 그대로(전체 회목)');
ok(/<span class="ch-rh-no"[^>]*>제1회<\/span>/.test(hNo), '숨김 앵커에 「제1회」만 들어간다');
const bookPlain = parseBookText('# 책\n\n## 서론 장\n\n본문.\n', 'x');
ok(/<span class="ch-rh-no"[^>]*>서론 장<\/span>/.test(buildBookHtml(bookPlain, { headerOdd: 'chapterNo' }).html), '「제N회」 형식이 아닌 장은 전체 제목으로(빈 머리글 방지)');

console.log('\n[3] R6 — 특별 섹션 원고 메타');
ok(specialKeywordsOf({ specialSections: '역사 노트, 지도' }, { specialKeyword: '역사 노트' }).join('|') === '역사 노트|지도', '설정 + 메타 합집합(중복 제거)');
ok(/<div class="special-sec">/.test(hFull), '설정이 비어도 원고 메타만으로 역사 노트 상자');
ok((hFull.match(/<div class="special-sec">/g) || []).length === 1 && /노트 안의 문단[\s\S]*?<\/div>[\s\S]*다음 절/.test(hFull), '노트는 다음 소제목 앞에서 끝난다');
const sp = splitSpecialBlocks(book.parts[0].chapters[0].blocks, ['역사 노트']);
ok(sp.some((p) => p.special) && sp.some((p) => !p.special), 'splitSpecialBlocks: 내지·ePub 공용 분할');

console.log('\n[4] 📱 전자책 판');
const eb = buildBookHtml(book, { edition: 'ebook', ebookCoverPath: path.join(__dirname, '..', 'assets', 'icon.png') });
const pr = buildBookHtml(book, {});
ok(eb.options.edition === 'ebook' && pr.options.edition === 'print', 'options.edition');
ok(/── 📱 전자책 판 ──/.test(eb.html) && !/── 📱 전자책 판 ──/.test(pr.html), '전자책 CSS 는 전자책 판에만');
ok(/break-before: page !important/.test(eb.html), '백면 없음: recto → page 로 덮는다');
ok(eb.options.marginsMm.inner === eb.options.marginsMm.outer && pr.options.marginsMm.inner !== pr.options.marginsMm.outer, '전자책은 안/바깥 여백 같음 · 종이책은 다름');
ok(/class="ebook-cover"/.test(eb.html) && !/class="ebook-cover"/.test(pr.html), '전자책 1쪽 = 앞표지');
ok(!/class="ebook-cover"/.test(buildBookHtml(book, { edition: 'ebook' }).html), '표지 이미지가 없으면 표지 쪽을 만들지 않는다');
ok(/<a href="https:\/\/example\.com\/a">누리집<\/a>/.test(eb.html), '전자책: 바깥 주소는 누를 수 있는 링크');
ok(!/<a href="https:\/\/example\.com/.test(pr.html) && /누리집 \(https:\/\/example\.com\/a\)/.test(pr.html), '종이책: 링크는 글자 + 괄호 주소(기존 그대로)');
ok(!/<a href="\.\.\/a\.md"/.test(eb.html), '전자책도 로컬 경로 링크는 살리지 않는다');
// 판권
const cbook = parseBookText(MD.replace('## [판권]\n', '## [판권]\n\n* 무단 복제를 금합니다.\n'), 'c');
const ce = buildBookHtml(cbook, { edition: 'ebook' }).html;
const cp = buildBookHtml(cbook, {}).html;
const colE = ce.slice(ce.indexOf('class="colophon'));
const colP = cp.slice(cp.indexOf('class="colophon'));
ok(colE.includes('9791100000002') && !colE.includes('9791100000001'), '전자책 판권: 전자책 ISBN');
ok(!/15,000원/.test(colE) && /8,000원/.test(colE), '전자책 판권: 종이책 정가 없음 · 전자책 가격 있음');
ok(colP.includes('9791100000001') && /15,000원/.test(colP), '종이책 판권: 종이책 ISBN·정가(불변)');
// 짝수 검증 — 종이책 옵션은 전자책이 바꾸지 못한다
ok(pr.options.chapterStart === 'recto' && eb.options.chapterStart === 'page', '종이책 장 시작은 홀수쪽(recto) 그대로');

console.log('\n[5] ePub');
const EP = require('fs').readFileSync(path.join(__dirname, '..', 'core', 'book', 'epub-builder.js'), 'utf8');
ok(/div\.special-sec/.test(EP) && /specialKeywordsOf\(meta/.test(EP), 'ePub: 역사 노트 상자(설정+메타)');
ok(/meta\.ebookIsbn \|\| meta\.isbn/.test(EP), 'ePub: 식별자는 전자책 ISBN 우선');
ok(!/execFileSync/.test(EP), 'ePub: 동기 자식 프로세스 없음(메인 프로세스 규칙)');

console.log(`\n${fail ? '❌' : '✅'} 종이책/전자책·삼국지 요청 ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
