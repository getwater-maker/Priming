'use strict';
/**
 * node test/book-editions.smoke.js — 📕 종이책 / 📱 전자책 PDF 실제 조판 검증 (v0.5.96)
 *   같은 원고를 실제 PDF 로 굽고 **mupdf 로 쪽마다 글자를 읽어** 확인한다(CSS 문자열 검사만으로는 백면·머리글을 못 본다).
 *   ① 전자책: 1쪽 = 표지(글자 없는 그림 쪽 · 판형 그대로) · 그 뒤로 빈 쪽 0 · 종이책은 홀수쪽 맞춤 빈 쪽이 있다
 *   ② R1: 홀수쪽 머리글 chapterNo — 긴 회목 조각이 머리글에 나오지 않는다(판별력: 기본 모드로 A/B, 조각이 더 많이 나와야 한다)
 *   ③ 전자책 판권에 전자책 ISBN(글자) · 종이책 정가 없음
 * mupdf 는 @vivliostyle/cli 의 하위 의존성(dev 검증 전용 — package.json 에 더하지 않는다).
 * 임시 폴더만 쓴다(output/_book-editions).
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildBookHtml } = require('../core/book/html-builder');
const { buildInteriorPdf, prepareWorkAssets } = require('../core/book/pdf-builder');

const OUT = path.join(__dirname, '..', 'output', '_book-editions');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const para = '조식은 붓을 들어 이렇게 적었다. 천하의 일은 합쳐지면 나뉘고 나뉘면 다시 합쳐진다는 말이 있다. 도원의 복사꽃 아래에서 세 사람은 하늘에 맹세하였다. '.repeat(7);
const FRAG = '의형제를 맺고';   // 긴 회목의 한가운데 조각 — 머리글에 전체 회목이 실리면 여기서 잡힌다
const LONG = `도원에서 ${FRAG} 황건적을 무찔러 처음 공을 세우다 그리고 다시 길게 이어지는 회목`;
const chapters = [];
for (let i = 1; i <= 4; i++) chapters.push(`## 제${i}회 ${LONG}\n${(para + '\n\n').repeat(9)}\n### 역사 노트\n${para}\n`);
const MD = `# 삼국지연의
> 저자: 나관중
> 출판사: 고전서재
> 발행일: 2026-10-01
> ISBN: 9791100000001
> 전자책ISBN: 9791100000002
> 정가: 15,000원
> 전자책: 8,000원
> 판형: A5
> 특별섹션: 역사 노트

## [서문]
서문입니다. ${para}

## [목차]

## 1부. 도원결의

${chapters.join('\n')}

## [판권]
`;

async function pagesText(pdfPath) {
  const mupdf = await import(pathToFileURL(path.join(__dirname, '..', 'node_modules', 'mupdf', 'dist', 'mupdf.js')).href);
  const doc = mupdf.Document.openDocument(fs.readFileSync(pdfPath), 'application/pdf');
  const out = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const p = doc.loadPage(i); const b = p.getBounds();
    out.push({ n: i + 1, wMm: (b[2] - b[0]) / 72 * 25.4, hMm: (b[3] - b[1]) / 72 * 25.4, text: p.toStructuredText('preserve-whitespace').asText().replace(/\s+/g, ' ').trim() });
  }
  return out;
}

async function build(book, name, opts) {
  const workDir = path.join(OUT, '_work_' + name);
  const assets = prepareWorkAssets(workDir);
  const { html } = buildBookHtml(book, { ...opts, imageUrl: assets.imageUrl, fontCss: assets.fontCss, sourceMap: false });
  const outPdf = path.join(OUT, name + '.pdf');
  const r = await buildInteriorPdf({ html, outPdf, workDir, log: () => {} });
  ok(r.success && fs.existsSync(outPdf), `${name} PDF 생성 (${r.pages}쪽)${r.success ? '' : ' — ' + r.error}`);
  return { ...r, outPdf, html, pages_: r.success ? await pagesText(outPdf) : [] };
}

(async () => {
  const book = parseBookText(MD, '삼국지');
  const cover = path.join(__dirname, '..', 'assets', 'icon-source.png');
  const P = await build(book, 'print', { edition: 'print', headerOdd: 'chapterNo' });
  const Pfull = await build(book, 'print-fullheader', { edition: 'print', headerOdd: 'chapter' });   // A/B — 기본 모드
  const E = await build(book, 'ebook', { edition: 'ebook', headerOdd: 'chapterNo', ebookCoverPath: cover });
  if (!(P.success && Pfull.success && E.success)) { console.log('❌ 생성 실패'); process.exit(1); }

  console.log('\n[1] 📱 전자책 — 표지 1쪽 · 백면 없음');
  const e1 = E.pages_[0];
  ok(e1.text === '' && Math.abs(e1.wMm - 148) < 1 && Math.abs(e1.hMm - 210) < 1, `1쪽 = 글자 없는 표지 쪽, 판형 그대로 A5 (${e1.wMm.toFixed(1)}×${e1.hMm.toFixed(1)}mm)`);
  const blankE = E.pages_.slice(1).filter((p) => p.text === '').length;
  const blankP = P.pages_.filter((p) => p.text === '').length;
  ok(blankE === 0, `전자책 본문에 빈 쪽 ${blankE}개 (종이책은 홀수쪽 맞춤으로 ${blankP}개)`);
  ok(blankP > 0, '판별력: 종이책에는 실제로 빈 쪽이 있다(그래서 위 0 이 의미가 있다)');
  ok(E.pages < P.pages, `전자책 ${E.pages}쪽 < 종이책 ${P.pages}쪽`);
  const noCover = await build(book, 'ebook-nocover', { edition: 'ebook' });
  ok(noCover.pages_.length && noCover.pages_[0].text !== '', '표지 이미지가 없으면 표지 쪽 없이 본문부터');

  console.log('\n[2] R1 — 홀수쪽 머리글 「제N회」만');
  const count = (R) => R.pages_.filter((p) => p.text.includes(FRAG)).length;
  const withFrag = count(P), withFragFull = count(Pfull);
  ok(withFragFull > 4, `기본 모드: 긴 회목이 머리글에도 실린다 (회목 조각이 ${withFragFull}쪽 — 장 표제 4 + 머리글)`);
  // 회목 조각이 있는 쪽 = 장 표제 4 + 목차 1(목차엔 전체 회목이 원래 실린다) — 머리글에는 없어야 한다
  ok(withFrag <= 5, `chapterNo: 회목 조각은 장 표제 4쪽 + 목차 1쪽에만 (${withFrag}쪽 ≤ 5)`);
  // 머리글은 쪽 글자의 맨 뒤(쪽번호 앞)에 잡힌다: 「… 제1회 13」 — 홀수쪽만
  const hdr = (R) => R.pages_.filter((p) => /제\d+회 \d+$/.test(p.text) && !p.text.includes(FRAG));
  const hp = hdr(P);
  ok(hp.length >= 8 && hp.every((p) => p.n % 2 === 1), `chapterNo: 「제N회」 머리글 ${hp.length}쪽, 전부 홀수쪽 (${hp.map((p) => p.n).join(',')})`);
  ok(hdr(Pfull).length === 0, '판별력: 기본 모드에는 「제N회」만 있는 머리글쪽이 없다(전체 회목이 실림)');

  console.log('\n[3] 전자책 판권');
  const colE = E.pages_.map((p) => p.text).filter((t) => /9791100000002|9791100000001/.test(t)).join(' ');
  ok(colE.includes('9791100000002') && !colE.includes('9791100000001'), '전자책 판권: 전자책 ISBN 만');
  ok(!/15,000원/.test(colE) && /8,000원/.test(colE), '전자책 판권: 종이책 정가 없음 · 전자책 가격 있음');
  const colP = P.pages_.map((p) => p.text).filter((t) => /9791100000001/.test(t)).join(' ');
  ok(colP.includes('9791100000001') && /15,000원/.test(colP), '종이책 판권: 종이책 ISBN·정가');

  console.log(`\n${fail ? '❌' : '✅'} 종이책/전자책 PDF 실조판 ${pass}/${pass + fail} → ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('오류:', e); process.exit(1); });
