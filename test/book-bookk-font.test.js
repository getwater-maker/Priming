'use strict';
/**
 * node test/book-bookk-font.test.js — 부크크 글꼴(이 PC 에서 읽기 · 배포 동봉 금지)
 *   · 없는 폴더 → 면 0개·선택지 「없음」 / 있는 폴더 → 4면
 *   · 글꼴 선택지(FONT_OPTIONS) 와 FONT_STACKS 가 짝 · 없으면 KoPub 로 폴백하는 스택
 *   · assets/fonts/book 에 부크크 글꼴을 복사해 두지 않았다(라이트 업데이트로 배포되므로)
 *   · 글꼴이 있는 PC 에서는 실제 조판 PDF 에 부크크 글꼴이 박힌다
 */
const fs = require('fs'), os = require('os'), path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const P = require('../core/book/pdf-builder');
const H = require('../core/book/html-builder');

const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bookk-'));
ok(P.externalFaces(empty).length === 0, '빈 폴더 → 외부 글꼴 면 0개');
ok(!P.externalFontAvailable(empty).myungjo && !P.externalFontAvailable(empty).gothic, '빈 폴더 → 선택지 「없음」');
// 한 가족의 Light 만 있으면 「없음」(둘 다 있어야 있음)
fs.mkdirSync(path.join(empty, '부크크명조'), { recursive: true });
fs.writeFileSync(path.join(empty, '부크크명조', 'BookkMyungjo_Light.ttf'), Buffer.alloc(5000));
ok(!P.externalFontAvailable(empty).myungjo, 'Light 만 있으면 「없음」');
fs.writeFileSync(path.join(empty, '부크크명조', 'BookkMyungjo_Bold.ttf'), Buffer.alloc(5000));
ok(P.externalFontAvailable(empty).myungjo && !P.externalFontAvailable(empty).gothic, 'Light+Bold → 명조만 있음');
fs.rmSync(empty, { recursive: true, force: true });

ok(H.FONT_OPTIONS.filter((o) => o.ext).length === 2 && H.FONT_OPTIONS.every((o) => H.FONT_STACKS[o.id]), '선택지 ↔ 글꼴 스택 짝');
ok(/KoPubWorld Batang/.test(H.FONT_STACKS['bookk-myungjo']) && /KoPubWorld Dotum/.test(H.FONT_STACKS['bookk-gothic']), '없는 PC 는 KoPub 로 폴백');
ok(!fs.readdirSync(path.join(__dirname, '..', 'assets', 'fonts', 'book')).some((f) => /bookk/i.test(f)), 'assets/fonts/book 에 부크크 글꼴을 동봉하지 않았다');
ok(!P.BUNDLED_FACES.some(([fam]) => /bookk/i.test(fam)), 'BUNDLED_FACES(동봉 표)에 없다');

(async () => {
  if (P.externalFontAvailable().myungjo) {
    const { parseBookText } = require('../core/parsers/book-parser');
    const { buildInteriorPdf, prepareWorkAssets } = P;
    const OUT = path.join(__dirname, '..', 'output', '_book-bookk'); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
    const book = parseBookText('# 글꼴 시험\n> 저자: 갑\n> 출판사: 을\n> 판형: A5\n\n## 제1회 시작\n조선의 밤은 길고 깊었다. 등불 하나에 의지해 역사를 기록하던 사람들이 있었다.\n', 'f');
    const workDir = path.join(OUT, 'w'); const assets = prepareWorkAssets(workDir);
    ok(fs.existsSync(path.join(workDir, 'fonts', 'BookkMyungjo_Light.ttf')), '작업 폴더로 복사된다(CLI 가 file:// 를 막으므로)');
    const { html } = H.buildBookHtml(book, { imageUrl: assets.imageUrl, fontCss: assets.fontCss, fontKey: 'bookk-myungjo' });
    const pdf = path.join(OUT, 'a.pdf');
    const r = await buildInteriorPdf({ html, outPdf: pdf, workDir, log: () => {} });
    const mu = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'node_modules', 'mupdf', 'dist', 'mupdf.js')).href);
    const doc = mu.Document.openDocument(fs.readFileSync(pdf), 'application/pdf'); const names = new Set();
    for (let i = 0; i < doc.countPages(); i++) doc.loadPage(i).toStructuredText().walk({ onChar(c, o, f) { names.add(f.getName()); } });
    ok(r.success && [...names].some((n) => /BookkMyungjo/.test(n)), '조판 PDF 에 부크크 명조가 박힌다 (' + [...names].join(', ') + ')');
  } else console.log('  (이 PC 에 부크크 글꼴 없음 — 실조판 단언은 건너뜀)');
  console.log(`\n${fail ? '❌' : '✅'} book-bookk-font — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
