'use strict';
// 📕 종이책 완성본 첫 쪽 = 표지 펼침면 전체(로이 2026-10-14 · v0.9.28) — core/book/pdf-pack.printFullPdf + main.js 종이책 빌드 경로
//   v0.9.13 은 기록만 바뀌고 코드는 앞표지만 잘라 붙인 채로 남아, 앱으로 다시 만든 3권이 A5 첫 쪽으로 나왔다.
const fs = require('fs'); const os = require('os'); const path = require('path');
const { PDFDocument } = require('pdf-lib');
const PK = require('../core/book/pdf-pack');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗ ' + m); } };
const MM = 72 / 25.4;
const mm = (pt) => Math.round(pt / MM * 10) / 10;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printfull-'));
  // 펼침면 표지(재단 3 + 날개 90 + 뒷 148 + 책등 18 + 앞 148 + 날개 90 + 재단 3 ≈ 500 × 216mm)
  const cov = await PDFDocument.create(); cov.addPage([500 * MM, 216 * MM]).drawRectangle({ x: 10, y: 10, width: 100, height: 100 });
  const covPdf = path.join(tmp, 'cover.pdf'); fs.writeFileSync(covPdf, await cov.save());
  const inner = await PDFDocument.create(); for (let i = 0; i < 3; i++) inner.addPage([148 * MM, 210 * MM]);
  const innerPdf = path.join(tmp, 'inner.pdf'); fs.writeFileSync(innerPdf, await inner.save());

  const out = path.join(tmp, 'full.pdf');
  const n = await PK.printFullPdf(covPdf, innerPdf, out);
  const d = await PDFDocument.load(fs.readFileSync(out));
  const s = d.getPages().map((p) => p.getSize());
  ok(n === 4 && d.getPageCount() === 4, `쪽수 = 펼침면 1 + 내지 3 (받은 값 ${n})`);
  ok(mm(s[0].width) === 500 && mm(s[0].height) === 216, `첫 쪽 = 펼침면 전체 500×216mm (받은 값 ${mm(s[0].width)}×${mm(s[0].height)})`);
  ok(s.slice(1).every((x) => mm(x.width) === 148 && mm(x.height) === 210), '나머지는 내지 그대로 A5');

  // 판정력 — 옛 방식(앞표지만 잘라 붙이기)이면 첫 쪽이 A5 폭이라 위 단언이 실패해야 한다
  const spread = { heightMm: 216, parts: [{ name: 'bleed', mm: 3 }, { name: '뒷날개', mm: 90 }, { name: '뒷표지', mm: 148 }, { name: '책등', mm: 18 }, { name: '앞표지', mm: 148 }, { name: '앞날개', mm: 90 }, { name: 'bleed', mm: 3 }] };
  const front = path.join(tmp, 'front.pdf');
  await PK.frontCoverFromSpreadPdf(covPdf, spread, front);
  const old = path.join(tmp, 'old.pdf'); await PK.prependCover(front, innerPdf, old);
  const o = (await PDFDocument.load(fs.readFileSync(old))).getPage(0).getSize();
  ok(mm(o.width) === 148, `판정력: 옛 방식 첫 쪽은 앞표지 폭 148mm (받은 값 ${mm(o.width)})`);

  // main.js 종이책 경로가 printFullPdf 를 쓰고, 앞표지 자르기를 쓰지 않는다
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  const a = src.indexOf("const coverPdf = OL.outPath(outRoot, 'print', 'cover', base);");
  const b = src.indexOf('판권지 존재 확인', a);
  ok(a > 0 && b > a, '종이책 표지 블록을 찾았다');
  const blk = src.slice(a, b);
  ok(/PK\.printFullPdf\(coverPdf, interiorPdf, fullPdf\)/.test(blk), '종이책 완성본 = printFullPdf(펼침면 표지, 내지)');
  ok(!/frontCoverFromSpreadPdf/.test(blk), '종이책 경로에서 앞표지만 잘라 붙이지 않는다');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`book-print-full: ${pass} 통과, ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
