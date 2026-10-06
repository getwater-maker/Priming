'use strict';
/**
 * node test/book-epub-colophon.test.js — R20·R21 ePub 판권(부크크 「판권지 수정 요청」 2026-10-06)
 *   · 판권 = PDF 전자책판과 같은 내용: 제목 · 발행일 · 라벨|값 행 · 전자책 ISBN · [판권] 노트(별표 줄은 글머리표 없이 문단) · ⓒ + 재사용 문구
 *   · 종이책 정가는 싣지 않는다 · 발행일 = `> 전자책발행일:` 우선(없으면 발행일)
 *   · `> 판권위치: 앞` 이면 표지 바로 다음(spine 2번째) · 아니면 마지막
 *   · 표지 로그 「🖼 전자책 표지: <파일> (원고 메타|표지 도구|인쇄 표지 크롭)」
 */
const fs = require('fs'), path = require('path'), os = require('os');
const AdmZip = require('adm-zip');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildEpub } = require('../core/book/epub-builder');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'epcol-'));
// 아주 작은 JPG(1x1) — 표지 자리
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
fs.writeFileSync(path.join(T, 'c.jpg'), JPG);

const md = (extraMeta) => `# 삼국지 1
> 부제: 천하대란
> 저자: 나관중
> 옮긴이: 로이
> 발행인: 한건희
> 출판사: 주식회사 부크크
> 출판등록: 2014.07.15.(제2014-16호)
> 주소: 서울특별시 금천구 가산디지털1로 119
> 전화: 1670-8316
> 이메일: info@bookk.co.kr
> 발행일: 발행일 2026-10-02
> ISBN: 979-11-0000-000-0
> 전자책ISBN: 979-11-12-31221-1
> 정가: 18,700원
> 전자책표지: c.jpg
${extraMeta || ''}
## 제1회 시작

본문 문단입니다.

## [판권]

* 번역·기획: 고전서재의 로이
* 저본: 나관중 원문
* 이 책의 번역 과정에서 AI를 보조 도구로 활용했습니다.
`;
async function build(name, extra) {
  const book = parseBookText(md(extra), name);
  const out = path.join(T, name + '.epub'); const logs = [];
  const r = await buildEpub(book, { outPath: out, baseDir: T, tmpDir: T, embedFonts: 'none', log: (m) => logs.push(m) });
  const z = new AdmZip(out);
  const txt = (n) => { const e = z.getEntry('OEBPS/' + n); return e ? e.getData().toString('utf8') : ''; };
  const opf = txt('content.opf');
  const spine = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1]);
  return { r, logs, spine, col: txt('colophon.xhtml') };
}
const plain = (h) => h.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

(async () => {
  const A = await build('a', '');
  ok(A.r.success, 'ePub 생성');
  const t = plain(A.col);
  ok(/979-11-12-31221-1/.test(t), 'ISBN = 전자책 ISBN');
  ok(!/979-11-0000-000-0/.test(t), '종이책 ISBN 은 싣지 않는다');
  ok(!/18,700/.test(t), '종이책 정가는 싣지 않는다');
  ok(/발행일\s+2026년 10월 02일/.test(t), '발행일(전자책발행일 없음 → 발행일)');
  for (const k of ['지은이 | 나관중', '옮긴이 | 로이', '발행인 | 한건희', '발행처 | 주식회사 부크크', '등록 | 2014.07.15.', '주소 | 서울특별시', '전화 | 1670-8316', '대표메일 | info@bookk.co.kr']) ok(t.includes(k), '판권 행: ' + k);
  ok(/\* 번역·기획: 고전서재의 로이/.test(t) && /\* 저본: 나관중/.test(t) && /\* 이 책의 번역 과정에서 AI/.test(t), '별표 세 줄(노트)');
  ok(!/<ul|<li[ >]/.test(A.col), '별표 줄은 글머리표(목록)가 아니다');
  ok(/ⓒ 로이 2026\. All rights reserved\./.test(t) && /서면 동의/.test(t), 'ⓒ + 재사용 문구');
  ok(A.spine[A.spine.length - 1] === 'colophon', '판권위치 기본 = 마지막 쪽');
  ok(A.logs.some((l) => /🖼 전자책 표지: c\.jpg \(원고 메타\)/.test(l)), '표지 로그(원고 메타)');

  const B = await build('b', '> 전자책발행일: 발행일 2026-10-06\n> 판권위치: 앞');
  const tb = plain(B.col);
  ok(/발행일\s+2026년 10월 06일/.test(tb) && !/2026년 10월 02일/.test(tb), "R21 전자책발행일 이 전자책 판권에 쓰인다(년월일)");
  ok(/ⓒ 로이 2026\./.test(tb), '연도는 전자책발행일 기준');
  ok(B.spine[0] === 'cover' && B.spine[1] === 'colophon', '판권위치: 앞 → 표지 바로 다음(2쪽)');
  ok(B.spine.filter((x) => x === 'colophon').length === 1, '판권 문서는 한 번만');

  // 종이책 판권(PDF)은 발행일을 바꾸지 않는다 — 전자책 PDF 판에서만 전자책발행일
  const H = require('../core/book/html-builder');
  const book = parseBookText(md('> 전자책발행일: 발행일 2026-10-06'), 'x');
  const mk = (edition) => H.buildBookHtml(book, { edition, imageUrl: (p) => p, fontCss: '' }).html;
  const paper = plain(mk('paper')), ebook = plain(mk('ebook'));
  ok(/2026년 10월 02일/.test(paper) && !/2026년 10월 06일/.test(paper), "종이책 PDF 판권 = 발행일(년월일)");
  ok(/2026년 10월 06일/.test(ebook) && !/2026년 10월 02일/.test(ebook), "전자책 PDF 판권 = 전자책발행일(년월일)");

  fs.rmSync(T, { recursive: true, force: true });
  console.log(`\n${fail ? '❌' : '✅'} book-epub-colophon — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
