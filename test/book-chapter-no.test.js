'use strict';
/**
 * node test/book-chapter-no.test.js — 📖 회목 번호 인식(제N회·제N장·제N화) 한 곳 + 완성 파일 이름 중복 방지(로이 2026-10-03)
 *   빨간머리앤(「제N장」)에서 ① `> 회목최대: 20` 이 「제16장 」 번호까지 세어 오탐(24자)·짧은제목 무시 ② 머리글 `제N장 짧은제목`·목차 번호 칸이 안 나옴
 *   ③ 완성 파일 이름이 「빨간머리앤_빨간머리앤_내지.pdf」 로 겹침. 삼국지(「제N회」)는 결과가 한 글자도 달라지면 안 된다.
 */
const fs = require('fs'), path = require('path');
const { CH_RE } = require('../core/book/chapter-no');
const { parseBookText } = require('../core/parsers/book-parser');
const HB = require('../core/book/html-builder');
const TF = require('../core/book/title-fit');
const WF = require('../core/book/work-folder');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const FD = path.join(__dirname, '..', 'assets', 'fonts', 'book');
const NL = String.fromCharCode(10);

console.log('\n[1] 회목 번호 정규식');
const m = (t) => CH_RE.exec(t);
ok(m('제16장 다이애나의 다과회')[1] === '제16장' && m('제16장 다이애나의 다과회')[2] === '다이애나의 다과회', '「제16장 …」 → 번호 제16장 · 이름');
ok(m('제109회 천하통일')[1] === '제109회' && m('제3화 시작')[1] === '제3화', '「제109회」·「제3화」도 그대로');
ok(m('제 12 장. 이름')[1] === '제 12 장' && m('제 12 장. 이름')[2] === '이름', '공백·마침표 변형');
ok(m('서문') === null && m('제목 제3장') === null && m('제4절 이름') === null, '판별: 번호가 아닌 제목·「제N절」 은 인식하지 않는다');

console.log('\n[2] 제목 길이 기준(회목최대) — 「장」 책');
const mdJang = (short) => ['# 책', '> 저자: a', '> 회목최대: 20', '> 머리글홀수: 제N장 짧은제목', '', '## 제16장 다이애나의 다과회, 비극으로 끝나다', short ? '> 짧은제목: 다이애나의 다과회, 비극으로 끝나다' : '', '', '본문', ''].join(NL);
const run = (md, opts) => { const b = parseBookText(md, 't'); const { o } = HB.resolveBookOptions(b, opts || {}); return { b, fit: TF.analyze(b, o, FD, { chapterExcluded: HB.chapterExcluded }) }; };
let r = run(mdJang(true));
ok(r.fit.items[0].chars === 19 && !r.fit.items[0].flags.includes('max') && r.fit.count.max === 0, `짧은제목(19자)로 잰다 — 「제16장 」 번호를 세지 않는다(옛: 24자 오탐) chars=${r.fit.items[0].chars}`);
r = run(mdJang(false));
ok(r.fit.items[0].chars === 19 && r.fit.count.max === 0, '짧은제목이 없어도 번호를 뺀 이름(19자)으로 잰다');
const long = ['# 책', '> 저자: a', '> 회목최대: 10', '', '## 제1장 이 제목은 열 글자를 훨씬 넘는 긴 제목입니다', '', '본문', ''].join(NL);
r = run(long);
ok(r.fit.count.max === 1 && r.fit.items[0].flags.includes('max'), '판별: 진짜로 기준을 넘으면 여전히 표시한다(경고가 꺼진 게 아니다)');

console.log('\n[3] 머리글·목차 — 「장」 책');
const html = HB.buildBookHtml(parseBookText(mdJang(true), 't'), { baseDir: __dirname, headerOdd: 'chapterShort' }).html;
ok(/<span class="ch-rh-short"[^>]*>제16장 다이애나의 다과회, 비극으로 끝나다<\/span>/.test(html), '머리글 `제N장 짧은제목` = 「제16장 + 짧은제목」');
ok(/<span class="ch-rh-no"[^>]*>제16장<\/span>/.test(html), '머리글 번호만(chapterNo) = 「제16장」');
ok(/<li class="toc-chapter"><a [^>]*><span class="no">제16장<\/span><span class="tt">다이애나의 다과회, 비극으로 끝나다<\/span>/.test(html), '목차 = 번호 칸(제16장) + 짧은 제목 칸');

console.log('\n[4] 판별 — 「회」 책(삼국지)은 한 글자도 안 바뀐다');
const mdHoe = ['# 삼국지 완역 1 : 천하대란', '> 저자: 나관중', '> 회목최대: 20', '', '## 제1회 도원결의', '> 짧은제목: 도원결의', '', '본문', '', '## 제2회 장비, 독우를 매질하다', '', '본문', ''].join(NL);
const h2 = HB.buildBookHtml(parseBookText(mdHoe, 't'), { baseDir: __dirname, headerOdd: 'chapterShort' }).html;
ok(/<span class="no">제1회<\/span><span class="tt">도원결의<\/span>/.test(h2) && /<span class="ch-rh-short"[^>]*>제1회 도원결의<\/span>/.test(h2) && /<span class="ch-rh-short"[^>]*>제2회<\/span>/.test(h2), '「제N회」: 목차 번호 칸·머리글(짧은제목 있으면 제N회+짧은제목 · 없으면 제N회만) 그대로');
// 실제 삼국지 원고가 있으면 옛 코드(git HEAD~)와 HTML 이 같은지는 개발 중 A/B 로 확인했다(제1·10권 동일). 여기서는 구조만.

console.log('\n[5] 완성 파일 이름 — 작품 이름이 겹치지 않게');
ok(WF.fileBaseFor('D:/## 출판/빨간머리앤/원고/빨간머리앤.md') === '빨간머리앤', '단권(작품 이름 = 원고 이름): 「빨간머리앤」(옛: 빨간머리앤_빨간머리앤)');
ok(WF.fileBaseFor('D:/## 출판/삼국지/원고/제1권.md') === '삼국지_제1권', '판별: 권 이름이 작품 이름을 안 품으면 「삼국지_제1권」 그대로');
ok(WF.fileBaseFor('D:/## 출판/삼국지/원고/삼국지 제2권.md') === '삼국지 제2권', '원고 이름에 작품 이름이 들어 있으면 원고 이름만');
ok(WF.fileBaseFor('D:/x/원고2/제1권.md') === null, '작품 폴더가 아니면 null(기존 규칙)');

console.log(`\n${fail ? '❌' : '✅'} book-chapter-no — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
