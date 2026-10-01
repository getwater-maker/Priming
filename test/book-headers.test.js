'use strict';
/**
 * node test/book-headers.test.js — 삼국지 R12(머리글 메타) · R14(목차 글자/행간 메타) 배선 (순수 · 빠름)
 *   실조판 검증은 test/book-toc.smoke.js. 여기서는 값 해석 · 파서 키 · main 라벨 · 화면 잠금 배선을 본다.
 */
const fs = require('fs'), path = require('path');
const { headerKindOf, KEYS } = require('../core/book/header-kind');
const { parseBookText } = require('../core/parsers/book-parser');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

console.log('\n[1] 머리글 값 해석');
ok(KEYS.every((k) => headerKindOf(k) === k), '앱 옵션 이름 6개는 그대로: ' + KEYS.join(' '));
ok(headerKindOf('제N회') === 'chapterNo' && headerKindOf(' 「제 N 회」 ') === 'chapterNo' && headerKindOf('CHAPTERNO') === 'chapterNo', '제N회 · 공백·따옴표·대소문자 무시');
ok(headerKindOf('책제목') === 'title' && headerKindOf('부제') === 'subtitle' && headerKindOf('회목') === 'chapter' && headerKindOf('장제목') === 'chapter' && headerKindOf('소제목') === 'section' && headerKindOf('없음') === 'none', '한글 값(책제목·부제·회목·장제목·소제목·없음)');
ok(headerKindOf('아무거나') === null && headerKindOf('') === null && headerKindOf(undefined) === null, '모르는 값·빈 값 = null(무시 — 엉뚱한 머리글이 되지 않는다)');

console.log('\n[2] 원고 메타 키');
const m = parseBookText('# t\n> 머리글홀수: 제N회\n> 머리글짝수: 책제목\n> 목차글자: 9.5\n> 목차행간: 1.45\n', 'x').meta;
ok(m.headerOdd === '제N회' && m.headerEven === '책제목' && m.tocSize === '9.5' && m.tocLine === '1.45', '파서: 머리글홀수·머리글짝수·목차글자·목차행간');
const M = R('main.js');
ok(/headerEven: '머리글짝수', headerOdd: '머리글홀수', tocSize: '목차글자', tocLine: '목차행간'/.test(M), 'main BOOK_META_LABELS(앱에서 메타를 쓸 때 같은 라벨)');
ok(/tocSizePt: l\.tocSizePt, tocLineHeight: l\.tocLineHeight/.test(M), 'main bookLayoutOpts 가 목차 옵션을 넘긴다');

console.log('\n[3] 조판 규칙·화면');
const HB = R('core/book/html-builder.js');
ok(/headerKindOf\(meta\.headerEven\) \|\| opts\.headerEven/.test(HB) && /headerKindOf\(meta\.headerOdd\) \|\| opts\.headerOdd/.test(HB), 'html-builder: 메타가 UI 옵션을 이긴다(기본값은 그대로 title/chapter)');
ok(/white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/.test(HB), '머리글 한 줄 안전망(nowrap · 말줄임)');
ok(/align-items: last baseline/.test(HB) && /break-inside: avoid/.test(HB) && /word-break: keep-all/.test(HB) && /text-align: left/.test(HB), '목차: last baseline · break-inside:avoid · keep-all · 왼쪽 정렬');
ok(/class="no">\$\{esc\(mT\[1\]\)\}/.test(HB), '목차: 「제N회」 라벨 칸(.no) + 회목 칸(.tt)');
const BV = R('renderer/src/BookView.jsx');
ok(/hdrOddMeta/.test(BV) && /disabled=\{!!hdrOddMeta\}/.test(BV) && /disabled=\{!!hdrEvenMeta\}/.test(BV), '화면: 원고 메타가 정한 머리글은 선택 상자를 잠근다(🔒)');
ok(/목차 글자\(pt\)/.test(BV) && /tocSizePt: 0, tocLineHeight: 0/.test(BV), '화면: 목차 글자·행간 입력(0 = 본문과 같음) + 기본값');

console.log(`\n${fail ? '❌' : '✅'} book-headers — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
