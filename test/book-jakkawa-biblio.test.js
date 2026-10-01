'use strict';
/**
 * node test/book-jakkawa-biblio.test.js — 작가와 서지정보 페이지 공식 양식(jakkawa.com/book-info-guide, 2026-10-01)
 *   전자책 판권(PDF·ePub)이 양식을 따르고, 종이책 판권·부크크 전자책은 그대로인지.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildBookHtml } = require('../core/book/html-builder');
const JB = require('../core/book/jakkawa-biblio');
const RG = require('../core/book/register-guide');
const RF = require('../core/book/register-fill');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

console.log('\n[1] 순수 함수');
ok(JB.normDate('2026년 10월 1일') === '2026.10.01' && JB.normDate('2026-10-01') === '2026.10.01' && JB.normDate('초판 1쇄') === '', '출판일 → YYYY.MM.DD (못 읽으면 빈 값)');
ok(JB.fmtPrice('8000') === '8,000 원' && JB.fmtPrice('8,000원') === '8,000 원' && JB.fmtPrice('') === '', '판매가 → 「0,000 원」');
ok(JB.isJakkawaMeta({ publisher: '작가와' }) && JB.isJakkawaMeta({ platform: '작가와' }) && !JB.isJakkawaMeta({ publisher: '부크크', platform: '부크크' }), '작가와 전자책 판별');
const b = JB.biblio({ issueDate: '2026-10-15', author: '나관중', translator: '한득수', publisher: '부크크', ebookPrice: '9000' });
ok(b.rows.map((r) => r[0]).join() === '출판일,저자명,옮긴이,출판사,ISBN,판매가', '행 순서 = 출판일·저자명·(옮긴이)·출판사·ISBN·판매가');
ok(b.rows.find((r) => r[0] === '출판사')[1] === '작가와', '종이책 원고의 출판사(부크크)는 작가와로');
ok(b.rows.find((r) => r[0] === 'ISBN')[1] === '', 'ISBN 없음 = 빈칸 행(작가와가 발급)');
ok(JB.biblio({ author: 'A', editor: 'E', extra: { 디자인: 'D' } }).rows.some((r) => r[0] === '편집' && r[1] === 'E') && JB.biblio({ extra: { 디자인: 'D' } }).rows.some((r) => r[0] === '디자인'), '상세 서지정보: 편집·디자인(선택)');
ok(!JB.biblio({ author: 'A' }).rows.some((r) => r[0] === '편집' || r[0] === '디자인'), '선택 행은 값이 없으면 나오지 않는다');

console.log('\n[2] 복사용 양식(등록 도우미)');
const t = RG.ebookBiblio({});
ok(/출판일 \| 0000\.00\.00/.test(t) && /저자명 \| OOO/.test(t) && /출판사 \| 작가와/.test(t) && /판매가 \| 0,000 원/.test(t) && /서면 동의를 받아야 합니다\.$/.test(t), '자리표시 양식');

console.log('\n[3] 전자책 판권 (PDF)');
const MD = (pub, extra) => ['# 삼국지연의', '> 저자: 나관중', '> 옮긴이: 한득수', `> 출판사: ${pub}`, '> 발행일: 2026-10-15', '> ISBN: 9791100000001',
  '> 정가: 15,000원', '> 전자책: 8,000원', ...(extra || []), '', '## [판권]', '', '* 번역·기획: 고전서재', '* 이 책의 번역 과정에서 AI를 보조 도구로 활용했습니다.', '',
  '## 제1회 도원에서', '', '본문.', ''].join('\n');
const jw = parseBookText(MD('작가와'), 'j');
const colE = (() => { const h = buildBookHtml(jw, { edition: 'ebook' }).html; return h.slice(h.indexOf('class="colophon')); })();
ok(/출판일<\/span>|출판일/.test(colE) && colE.includes('2026.10.15') && colE.includes('나관중') && colE.includes('8,000 원'), '출판일·저자명·판매가');
ok(colE.includes('이 책 내용의 전부 또는 일부를 재사용하려면 반드시 저작권자의 서면 동의를 받아야 합니다.'), '공식 재사용 문구 그대로');
ok(!colE.includes('15,000') && !colE.includes('9791100000001'), '종이책 정가·ISBN 없음(전자책 ISBN 없으니 빈칸)');
ok(!colE.includes('이 책의 내용 중 전부 또는 일부를'), '옛 문구와 겹치지 않는다(한 번만)');
ok(colE.includes('번역·기획: 고전서재') && colE.includes('AI를 보조 도구'), '[판권] 고지문은 보존');
const bk = parseBookText(MD('부크크'), 'b');
const colB = (() => { const h = buildBookHtml(bk, { edition: 'ebook' }).html; return h.slice(h.indexOf('class="colophon')); })();
ok(colB.includes('8,000원') && !colB.includes('출판일'), '부크크 원고의 전자책 판은 기존 판권 그대로');
const colP = (() => { const h = buildBookHtml(jw, {}).html; return h.slice(h.indexOf('class="colophon')); })();
ok(colP.includes('15,000원') && !colP.includes('출판일'), '종이책 판권은 불변');

console.log('\n[4] ePub');
(async () => {
  const { buildEpub } = require('../core/book/epub-builder');
  const AdmZip = require('adm-zip');
  const out = path.join(os.tmpdir(), `jw-biblio-${Date.now()}.epub`);
  await buildEpub(jw, { outPath: out, epubVersion: '3' });
  const z = new AdmZip(out);
  const x = z.readAsText('OEBPS/colophon.xhtml');
  ok(x.includes('<p>출판일 | 2026.10.15</p>') && x.includes('<p>저자명 | 나관중</p>') && x.includes('<p>출판사 | 작가와</p>') && x.includes('<p>ISBN | </p>') && x.includes('<p>판매가 | 8,000 원</p>'), 'ePub 판권 = 서지정보 양식');
  ok(x.includes('서면 동의를 받아야 합니다.') && x.includes('번역·기획: 고전서재'), 'ePub: 재사용 문구 + 고지문');
  ok((z.readAsText('OEBPS/nav.xhtml').match(/colophon\.xhtml/g) || []).length === 1, '서지정보는 책에 한 곳만');
  const out2 = path.join(os.tmpdir(), `jw-biblio-b-${Date.now()}.epub`);
  await buildEpub(bk, { outPath: out2, epubVersion: '3' });
  ok(!new AdmZip(out2).readAsText('OEBPS/colophon.xhtml').includes('출판일'), 'ePub: 부크크 원고는 기존 판권');
  try { fs.unlinkSync(out); fs.unlinkSync(out2); } catch (_) { /* 임시 파일 */ }

  console.log('\n[5] 작가와 목차 입력 규칙');
  const tb = parseBookText('# 책\n\n## 제1회  도원에서 [맺다]\n\n본문.\n\n## 제2회 <두 번째>\n\n본문.\n', 't');
  ok(RF.tocText(tb) === '제1회 도원에서 맺다\n제2회 두 번째', '더블 스페이스·대괄호·꺾쇠 제거');

  console.log(`\n${fail ? '❌' : '✅'} book-jakkawa-biblio — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
