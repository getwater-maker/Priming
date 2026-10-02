'use strict';
/**
 * node test/book-titlelines.test.js — 📖 표제지류 도서명 줄 나누기 규칙(title-lines.js · 로이 2026-10-02)
 *   「삼국지 완역 10 : 천하, 하나로 돌아가다」 가 「…하나로 / 돌아가다」 로 끊기던 것 → ` : ` 에서 두 줄(첫 줄 작품명·권 / 둘째 줄 부제목, 콜론은 지움).
 *   실제 PDF 모양은 제10권으로 눈으로 확인했다(내지 PDF 3쪽 속표지·1쪽 반표제지). 여기서는 규칙·HTML·ePub 구조를 단언한다.
 */
const fs = require('fs'), path = require('path');
const { titleLines } = require('../core/book/title-lines');
const { parseBookText } = require('../core/parsers/book-parser');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const J = (a) => JSON.stringify(a);

console.log('\n[1] 줄 나누기 규칙');
ok(J(titleLines({ title: '삼국지 완역 10 : 천하, 하나로 돌아가다' })) === J(['삼국지 완역 10', '천하, 하나로 돌아가다']), '삼국지 완역 10 : 천하, 하나로 돌아가다 → 두 줄(콜론 없음)');
ok(J(titleLines({ title: '삼국지 완역 1 : 천하대란' })) === J(['삼국지 완역 1', '천하대란']), '제1권도 같은 규칙');
ok(J(titleLines({ title: '삼국지' })) === J(['삼국지']), '판별: 콜론이 없으면 한 줄 그대로');
ok(J(titleLines({ title: '시간:공간' })) === J(['시간:공간']), '판별: 공백 없는 콜론(시:분 같은 것)은 나누지 않는다');
ok(J(titleLines({ title: 'A: B 와 C : D' })) === J(['A: B 와 C', 'D']), '첫 번째 「 : 」 에서만 나눈다');
ok(J(titleLines({ title: '시간：공간' })) === J(['시간', '공간']), '전각 「：」 는 공백이 없어도 나눈다');
ok(J(titleLines({ title: 'x', titleBreak: '삼국지 완역 10 / 천하, 하나로 / 돌아가다' })) === J(['삼국지 완역 10', '천하, 하나로', '돌아가다']), '메타 `제목줄바꿈` 이 이긴다(최대 3줄)');
ok(J(titleLines({ title: '콜론 없는 제목', titleBreak: '콜론 없는 / 제목' })) === J(['콜론 없는', '제목']), '콜론 없는 제목도 `제목줄바꿈` 으로 나눈다');
ok(J(titleLines({ title: '삼국지 : 천하', titleBreak: '한 줄만' })) === J(['삼국지', '천하']), '판별: `제목줄바꿈` 이 한 줄뿐이면 무시하고 콜론 규칙');
ok(J(titleLines({}, '파일 제목 : 부제')) === J(['파일 제목', '부제']), '메타 제목이 없으면 파일 제목 폴백에도 같은 규칙');

console.log('\n[2] 원고 메타 `> 제목줄바꿈:` 파싱');
const md = (extra) => ['# 삼국지 완역 10 : 천하, 하나로 돌아가다', '> 저자: 나관중', '> 옮긴이: 로이', extra, '', '## 제109회 시작', '본문', ''].filter((x) => x != null).join(String.fromCharCode(10));
const b0 = parseBookText(md(''), 'x');
ok(b0.meta.title === '삼국지 완역 10 : 천하, 하나로 돌아가다', '책 이름(meta.title)은 그대로 — 콜론 포함(부크크 등록 도서명·머리글·목차에 쓰는 값)');
const b1 = parseBookText(md('> 제목줄바꿈: 삼국지 완역 10 / 천하'), 'x');
ok(b1.meta.titleBreak === '삼국지 완역 10 / 천하', '`> 제목줄바꿈:` 이 meta.titleBreak 로 읽힌다');

console.log('\n[3] 속표지·반표제지 HTML');
const HB = require('../core/book/html-builder');
const html = HB.buildBookHtml ? HB.buildBookHtml(b0, { baseDir: __dirname }).html : '';
ok(/<h1 class="tp-title"><span class="tp-t1">삼국지 완역 10<\/span> <span class="tp-t2">천하, 하나로 돌아가다<\/span><\/h1>/.test(html), '속표지 h1 = 두 줄(tp-t1 / tp-t2) · 콜론 없음');
ok(/<div class="ht-title"><span class="ht-l1">삼국지 완역 10<\/span> <span class="ht-l2">천하, 하나로 돌아가다<\/span><\/div>/.test(html), '반표제지도 두 줄(ht-l1 / ht-l2)');
const html2 = HB.buildBookHtml(parseBookText(['# 삼국지', '> 저자: a', '', '## 제1회 시작', '본문', ''].join(String.fromCharCode(10)), 'x'), { baseDir: __dirname }).html;
const tpSec = (html2.match(/<section class="titlepage">[\s\S]*?<\/section>/) || [''])[0];
ok(/<h1 class="tp-title">삼국지<\/h1>/.test(tpSec) && !/tp-t2/.test(tpSec), '판별: 콜론 없는 제목은 한 줄 그대로(span 없음)');
const css = fs.readFileSync(path.join(__dirname, '..', 'core', 'book', 'book-theme.css'), 'utf8');
ok(/\.tp-t2[^}]*font-size: 0\.72em/.test(css) && /\.ht-l2[^}]*font-size: 0\.78em/.test(css) && /word-break: keep-all/.test(css), 'CSS: 둘째 줄은 한 단계 작게 · 한글은 어절 단위로만 끊는다(keep-all)');

console.log('\n[4] ePub 속표지');
const eb = fs.readFileSync(path.join(__dirname, '..', 'core', 'book', 'epub-builder.js'), 'utf8');
ok(/titleLines\(meta, book\.fileTitle\)/.test(eb) && /class="t2"/.test(eb) && /\.titlepage \.t2/.test(eb), 'ePub 표제지도 같은 규칙(첫 줄 p.t · 둘째 줄부터 p.t2)');

console.log(`\n${fail ? '❌' : '✅'} book-titlelines — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
