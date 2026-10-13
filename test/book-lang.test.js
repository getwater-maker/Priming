'use strict';
/**
 * node test/book-lang.test.js — 해외 플랫폼(KDP·D2D) R23-0·R23: 책 언어(en) · 영어 조판 문구 · 인치 판형 · 플랫폼×언어 검사
 *   · 한국어 원고는 예전과 한 글자도 다르지 않다(lang="ko" · 지음 · 목차)
 *   · 영어 원고: lang="en" · 하이픈 CSS · Contents · by / Translated by · © · Published October 6, 2026 · 영어 재사용 문구 · 영어 예약 섹션([Dedication]) · Part II
 *   · ePub: dc:language en · xml:lang en · 영어 nav · 영어 판권
 */
const fs = require('fs'), path = require('path'), os = require('os');
const AdmZip = require('adm-zip');
const BL = require('../core/book/book-lang');
const PP = require('../core/book/platform-presets');
const PF = require('../core/book/preflight');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildBookHtml, metaPlatformId, resolveBookOptions } = require('../core/book/html-builder');
const { buildEpub } = require('../core/book/epub-builder');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'blang-'));

const EN = `# Alice Notes
> Title: Alice's Adventures (Annotated)
> 저자: Lewis Carroll
> 옮긴이: Roy Han
> 출판사: Classic Desk
> 발행일: 2026-10-06
> ISBN: 979-8-0000-0000-0
> 언어: en
> 플랫폼: KDP
> 판형: 6×9

## [Dedication]

For my daughter.

## Part II. Wonderland

## Chapter 1: Down the Rabbit-Hole

Alice was beginning to get very tired of sitting by her sister on the bank.[^1]

[^1]: A note.

## [Epilogue]

The end.

## [Copyright]

* Annotated by Roy Han.
`;
const KO = `# 삼국지
> 저자: 나관중
> 옮긴이: 로이
> 출판사: 주식회사 부크크
> 발행일: 2026-10-06
> 플랫폼: 부크크

## 제1회 시작

본문 문단입니다.
`;

console.log('[1] 순수 함수');
ok(BL.langOf({ lang: 'en' }) === 'en' && BL.langOf({ lang: 'English' }) === 'en' && BL.langOf({ lang: '영어' }) === 'en' && BL.langOf({}) === 'ko' && BL.langOf({ lang: 'ko' }) === 'ko' && BL.langOf(null) === 'ko', '언어 메타: en/English/영어 → en · 없으면 ko');
ok(BL.normInchTrim('6×9') === '6x9' && BL.normInchTrim('6 x 9') === '6x9' && BL.normInchTrim('6"x9"') === '6x9' && BL.normInchTrim('5.5 x 8.5 in') === '5.5x8.5' && BL.normInchTrim('A5') === null && BL.normInchTrim('신국판') === null, '인치 판형 글 → 키(한국 판형 이름은 건드리지 않는다)');
ok(BL.formatEn('2026-10-06') === 'October 6, 2026' && BL.formatEn('2026년 10월 6일') === 'October 6, 2026' && BL.formatEn('Autumn 2026') === 'Autumn 2026', '영어 날짜');
ok(BL.byLine('en', 'Jane') === 'by Jane' && BL.byLine('ko', '제인') === '제인 지음' && BL.translatorLine('en', 'Roy') === 'Translated by Roy' && BL.translatorLine('ko', '로이') === '로이 옮김' && BL.translatorLine('ko', '로이', '편역이') === '로이 편역', '표제지 줄(ko/en)');
const kdpKo = BL.platformLangIssues('kdp', 'ko'), d2dKo = BL.platformLangIssues('d2d', 'ko');
ok(kdpKo.length === 1 && kdpKo[0].state === 'error' && /한국어/.test(kdpKo[0].text) && BL.platformLangIssues('kdp', 'en').length === 0, 'KDP + 한국어 = 오류 · KDP + 영어 = 통과');
ok(d2dKo.length === 1 && d2dKo[0].state === 'warn' && BL.platformLangIssues('d2d', 'en').length === 0 && BL.platformLangIssues('bookk', 'ko').length === 0, 'D2D + 한국어 = 경고(미확인) · 부크크는 해당 없음');

console.log('\n[2] 플랫폼·판형');
ok(metaPlatformId({ platform: 'KDP' }) === 'kdp' && metaPlatformId({ platform: 'Amazon KDP' }) === 'kdp' && metaPlatformId({ platform: 'D2D' }) === 'd2d' && metaPlatformId({ platform: 'Draft2Digital' }) === 'd2d' && metaPlatformId({ platform: '부크크' }) === 'bookk' && metaPlatformId({ platform: '작가와' }) === 'jakkawa' && metaPlatformId({}) === 'bookk', '플랫폼 인식(kdp·d2d 추가 · 나머지는 예전 그대로)');
const t69 = PP.TRIM_SIZES['6x9'];
ok(t69 && Math.abs(t69.width - 152.4) < 0.01 && Math.abs(t69.height - 228.6) < 0.01 && t69.unit === 'in', '6x9 = 152.4×228.6mm (KDP 표준 판형 ✅)');
const kdp = PP.getPlatform('kdp');
ok(kdp.minPages === 24 && Math.abs(kdp.coverBleedMm - 3.175) < 1e-6 && Math.abs(kdp.coverSafeMm - 3.175) < 1e-6 && kdp.langs.join() === 'en' && kdp.trims.includes('5x8') && kdp.trims.includes('A5'), 'KDP 프리셋: 24쪽 · 블리드 0.125″ · 글자 안전 0.125″(공식) · 영어');
ok(Math.abs(PP.PAPERS['KDP 백색지'].perPageIn - 0.002252) < 1e-9 && Math.abs(PP.PAPERS['KDP 미색지'].perPageIn - 0.0025) < 1e-9, '책등 계수: 백색 0.002252″ · 미색 0.0025″ ✅');
ok(PP.getPlatform('bookk').minPages === 50 && PP.getPlatform('bookk').langs == null, '부크크 프리셋은 그대로');

console.log('\n[3] 파서');
const bk = parseBookText(EN, 'alice');
ok(bk.meta.lang === 'en' && bk.meta.platform === 'KDP' && bk.meta.trim === '6x9', '메타: 언어 en · 플랫폼 KDP · 판형 「6×9」 → 6x9');
ok(bk.front.some((x) => x.key === 'dedication') && bk.back.some((x) => x.key === 'epilogue'), '영어 예약 섹션 [Dedication]·[Epilogue] 를 알아본다');
ok(bk.parts.some((p) => p.num === 2 && p.title === 'Wonderland'), 'Part II. Wonderland → 부 번호 2');
ok(parseBookText('# t\n> 언어: ko\n\n## 제1회 가\n\n글.\n', 'x').meta.lang === 'ko', '한국어 메타');

console.log('\n[4] 조판 HTML');
const hk = buildBookHtml(parseBookText(KO, 'k'), {}).html;
ok(/<html lang="ko">/.test(hk) && /지음/.test(hk) && /옮김/.test(hk) && /목차/.test(hk) && !/hyphens: auto/.test(hk), '한국어 원고는 예전과 같다(lang=ko · 지음 · 옮김 · 목차 · 하이픈 없음)');
const he = buildBookHtml(bk, {}), H = he.html;
ok(/<html lang="en">/.test(H) && /hyphens: auto/.test(H) && /html\[lang="en"\] body/.test(H), '영어 원고: lang=en + 하이픈 CSS');
ok(/by Lewis Carroll/.test(H) && /Translated by Roy Han/.test(H) && !/지음|옮김/.test(H.replace(/<style>[\s\S]*?<\/style>/, '')), '표제지: by Lewis Carroll · Translated by Roy Han (한국어 없음)');
ok(/Contents/.test(H) && !/>목차</.test(H) && !/>판권</.test(H), '목차 제목 = Contents');
ok(/October 6, 2026/.test(H) && /Published/.test(H) && /©\s*2026 Roy Han\. All rights reserved\./.test(H) && /No part of this book may be reproduced/.test(H) && !/서면 동의/.test(H), '판권: Published October 6, 2026 · © 2026 Roy Han · 영어 재사용 문구');
ok(/Author/.test(H) && /Translator/.test(H) && !/지은이|옮긴이/.test(H.replace(/<style>[\s\S]*?<\/style>/, '')), '판권 라벨: Author · Translator');
ok(he.options.lang === 'en' && he.options.lineBreak === 'word', '옵션: lang en · 줄바꿈 어절(한국어 전용 설정 끔)');
ok(he.platform && he.trimId === '6x9' && Math.abs(he.trim.width - 152.4) < 0.01, '판형 6x9 · 플랫폼 KDP 로 조판');

console.log('\n[4b] 영어 기본 타이포(Crimson Text · 고전 세리프)');
{
  const o = resolveBookOptions(bk, {}).o, oUi = resolveBookOptions(bk, { fontKey: 'kopub', fontSizePt: 10, lineHeight: 1.8, fontWeight: 300, letterSpacingPt: -0.4, paragraphSpacingPt: 5, h2Gothic: true }).o;
  ok(o.fontKey === 'crimson' && oUi.fontKey === 'crimson' && o.fontSizePt === 11.5 && oUi.fontSizePt === 11.5 && o.lineHeight === 1.4 && oUi.lineHeight === 1.4 && o.letterSpacingPt === 0 && oUi.letterSpacingPt === 0 && o.paragraphSpacingPt === 0 && oUi.paragraphSpacingPt === 0 && o.h2Gothic === false, '영어: Crimson Text 11.5pt · 행간 1.4 · 자간 0 · 문단 간격 0(UI 가 한국 기본값을 보내도 영어 기본)');
  const custom = resolveBookOptions(bk, { fontKey: 'nanum-myeongjo', fontSizePt: 12, lineHeight: 1.5, paragraphSpacingPt: 3 }).o;
  ok(custom.fontKey === 'nanum-myeongjo' && custom.fontSizePt === 12 && custom.lineHeight === 1.5 && custom.paragraphSpacingPt === 3, '사람이 고른 글꼴·크기·행간·문단 간격은 그대로 이긴다');
  const ko = resolveBookOptions(parseBookText(KO, 'k2'), {}).o;
  ok(ko.fontKey === 'kopub' && ko.fontSizePt === 10 && ko.lineHeight === 1.8 && ko.letterSpacingPt === -0.4 && ko.paragraphSpacingPt === 5 && ko.h2Gothic === true, '한국어는 예전 기본 그대로(KoPub 10pt · 1.8 · -0.4 · 5pt)');
  const css = he.css;
  ok(/'Crimson Text'/.test(css) && /section\.colophon \{ font-family: 'Crimson Text'/.test(css), '영어 CSS: 본문·머리글·판권이 Crimson Text 스택(고딕 아님)');
  const ff = require('../core/book/pdf-builder').bundledFontCss();
  ok(/font-family: 'Crimson Text'; src: url\('[^']*CrimsonText-Italic\.ttf'\); font-weight: 400; font-style: italic;/.test(ff) && /CrimsonText-BoldItalic\.ttf/.test(ff), '@font-face: Crimson Text 정체·기울임·굵게·굵은 기울임');
}

console.log('\n[5] ePub');
async function epub(md, name) {
  const book = parseBookText(md, name); const out = path.join(T, name + '.epub');
  await buildEpub(book, { outPath: out, baseDir: T, tmpDir: T, embedFonts: 'none', epubVersion: 3, log: () => {} });
  const z = new AdmZip(out); const g = (n) => (z.getEntry(n) ? z.readAsText(n) : '');
  return { opf: g('OEBPS/content.opf'), nav: g('OEBPS/nav.xhtml') + g('OEBPS/toc.ncx'), title: g('OEBPS/titlepage.xhtml'), col: g('OEBPS/colophon.xhtml'), z };
}
(async () => {
  const e = await epub(EN, 'en'), k = await epub(KO, 'ko');
  ok(/<dc:language>en<\/dc:language>/.test(e.opf) && /<dc:language>ko<\/dc:language>/.test(k.opf), 'dc:language en / ko');
  ok(/xml:lang="en"/.test(e.title) && /xml:lang="ko"/.test(k.title), '문서 xml:lang');
  ok(/Contents/.test(e.nav) && !/목차/.test(e.nav) && /목차/.test(k.nav), '목차(ncx/nav) 제목');
  ok(/Copyright/.test(e.col) && /October 6, 2026/.test(e.col) && /Author/.test(e.col) && /©/.test(e.col) && /No part of this book/.test(e.col) && /판권/.test(k.col) && /지은이/.test(k.col), '판권: 영어 / 한국어');
  ok(/by Lewis Carroll/.test(e.title) && /Translated by Roy Han/.test(e.title), '표제지: by · Translated by');

  console.log('\n[6] 점검 패널');
  const base = { pages: 120, spineMm: 7, outputs: [] };
  const items = (meta, pid) => PF.preflight({ ...base, meta, platformId: pid, platformLabel: PP.getPlatform(pid).label, minPages: PP.getPlatform(pid).minPages });
  const a = items({ title: 't', author: 'a', publisher: 'p', issueDate: '2026-10-06', lang: 'ko' }, 'kdp').items.find((x) => x.id === 'lang');
  ok(a && a.state === 'error' && /한국어/.test(a.detail), 'KDP + 한국어 → 점검 오류');
  const b = items({ title: 't', author: 'a', publisher: 'p', issueDate: '2026-10-06', lang: 'en' }, 'kdp').items.find((x) => x.id === 'lang');
  ok(b && b.state === 'ok', 'KDP + 영어 → 통과');
  const c = items({ title: 't', author: 'a', publisher: 'p', issueDate: '2026-10-06', lang: 'ko' }, 'd2d').items.find((x) => x.id === 'lang');
  ok(c && c.state === 'warn', 'D2D + 한국어 → 경고');
  ok(!items({ title: 't', author: 'a', publisher: 'p', issueDate: '2026-10-06' }, 'bookk').items.some((x) => x.id === 'lang'), '부크크는 언어 항목이 없다(예전과 같다)');
  const p20 = PF.preflight({ ...base, pages: 20, meta: { title: 't', author: 'a', publisher: 'p', issueDate: '2026-10-06', lang: 'en' }, platformId: 'kdp', platformLabel: 'KDP', minPages: 24 }).items.find((x) => x.id === 'pages');
  const p30 = PF.preflight({ ...base, pages: 30, meta: { title: 't', author: 'a', publisher: 'p', issueDate: '2026-10-06', lang: 'en' }, platformId: 'kdp', platformLabel: 'KDP', minPages: 24 }).items.find((x) => x.id === 'pages');
  ok(p20.state === 'error' && /24쪽/.test(p20.detail) && p30.state === 'ok', '최소 쪽수는 플랫폼 값(KDP 24쪽 · 부크크 50쪽)');

  try { fs.rmSync(T, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${fail ? '❌' : '✅'} book-lang ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error('테스트 오류:', err); process.exit(1); });
