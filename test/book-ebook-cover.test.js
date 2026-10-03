'use strict';
/**
 * node test/book-ebook-cover.test.js — 📘 전자책 표지 = 부크크가 받는 JPG·PDF (PNG 불가 · 로이 2026-10-03)
 *   표지 도구는 이미 `부속/<작품>_제N권_전자책앞표지.jpg` 를 만들어 두는데 앱은 PNG 에서 앞표지를 다시 잘라 썼다.
 *   → 메타 `전자책표지` > 표지 도구 산출물 > (없으면) 인쇄 표지 크롭. PNG 가 지정되면 JPG 로 바꿔 올린다.
 */
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const WF = require('../core/book/work-folder');
const { toUploadJpg } = require('../core/book/cover-jpg');
let pass = 0, fail = 0, skip = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ebc-'));
const W = path.join(T, '작품'); const mk = (...p) => { const d = path.join(W, ...p.slice(0, -1)); fs.mkdirSync(d, { recursive: true }); const f = path.join(W, ...p); return f; };
const script = mk('원고', '제1권.md'); fs.writeFileSync(script, '# t\n');
const png = mk('표지', '출력', '작품_제1권_표지_날개.png'); fs.writeFileSync(png, 'png');
const tool = mk('표지', '출력', '부속', '작품_제1권_전자책앞표지.jpg'); fs.writeFileSync(tool, 'jpg');

console.log('\n[1] 전자책 표지 찾기 우선순위');
let r = WF.resolveEbookCover({ meta: {}, scriptPath: script, coverImagePath: png });
ok(r.path === tool && r.source === 'tool' && !r.needsConvert, '메타가 없으면 표지 도구의 `부속/…_전자책앞표지.jpg`(인쇄 표지 PNG 와 짝) — PNG 에서 다시 자르지 않는다');
const j2 = path.join(W, '원고', 'my.jpg'); fs.writeFileSync(j2, 'x');
r = WF.resolveEbookCover({ meta: { ebookCover: 'my.jpg' }, scriptPath: script, coverImagePath: png });
ok(r.path === j2 && r.source === 'meta' && !r.needsConvert, '메타 `전자책표지`(JPG)가 도구 산출물보다 우선');
const p2 = path.join(W, '원고', 'my.png'); fs.writeFileSync(p2, 'x');
r = WF.resolveEbookCover({ meta: { ebookCover: 'my.png' }, scriptPath: script, coverImagePath: png });
ok(r.path === p2 && r.needsConvert === true, '판별: 메타가 PNG 면 needsConvert(업로드 전 JPG 로 변환)');
const pd = path.join(W, '원고', 'my.pdf'); fs.writeFileSync(pd, 'x');
r = WF.resolveEbookCover({ meta: { ebookCover: 'my.pdf' }, scriptPath: script, coverImagePath: png });
ok(r.path === pd && !r.needsConvert, 'PDF 는 그대로(부크크 업로드 가능)');
r = WF.resolveEbookCover({ meta: { ebookCover: 'none.jpg' }, scriptPath: script, coverImagePath: png });
ok(r.path === null && /전자책표지/.test(r.warn || ''), '메타 파일이 없으면 다른 걸 몰래 쓰지 않고 알린다');
fs.unlinkSync(tool);
r = WF.resolveEbookCover({ meta: {}, scriptPath: script, coverImagePath: png });
ok(r.path === null, '판별: 도구 산출물이 없으면 null(호출 쪽이 인쇄 표지에서 크롭)');
fs.writeFileSync(tool, 'jpg');
r = WF.resolveEbookCover({ meta: {}, scriptPath: script, coverImagePath: path.join(W, '표지', '출력', '작품_제1권_표지_날개_시안.png') });
ok(r.path === tool, '시안 파일을 인쇄 표지로 물려도 같은 권의 전자책앞표지를 찾는다');
r = WF.resolveEbookCover({ meta: {}, scriptPath: script, coverImagePath: path.join(W, '표지', '출력', 'random.png') });
ok(r.path === null, '판별: 이름 규칙(_표지…)이 아니면 짐작하지 않는다');

console.log('\n[2] PNG → 업로드용 JPG');
(async () => {
  const ff = (() => { try { return require('../core/media-utils').getFfmpegPath(); } catch (_) { return null; } })();
  if (!ff) { skip++; console.log('  ⏭ ffmpeg 없음 — 변환 단언 건너뜀'); }
  else {
    // 순수 Node 로 600×400 PNG 생성
    const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const w = 600, h = 400; const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
    const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (x * 7 + y * 3) & 255;
    const pngBuf = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
    const src = path.join(T, 'c.png'); fs.writeFileSync(src, pngBuf);
    const out = path.join(T, 'out', 'c.jpg');
    const got = await toUploadJpg(src, out);
    const head = got ? fs.readFileSync(got).subarray(0, 3) : Buffer.alloc(3);
    ok(got === out && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff, 'PNG → 진짜 JPG(헤더 FFD8FF)로 변환');
    ok(got && fs.statSync(got).size <= 10 * 1024 * 1024, '10MB 이하');
    ok((await toUploadJpg(path.join(T, 'none.png'), path.join(T, 'o2.jpg'))) === null, '판별: 원본이 없으면 null(조용히 틀린 파일을 만들지 않는다)');
  }

  console.log('\n[3] ePub 에 표지 도구의 JPG 가 그대로 들어간다');
  const { buildEpub } = require('../core/book/epub-builder');
  const { parseBookText } = require('../core/parsers/book-parser');
  const bk = parseBookText(['# 삼국지 완역 1 : 천하', '> 저자: 나관중', '', '## 제1회 시작', '본문', ''].join(String.fromCharCode(10)), 'x');
  const marker = Buffer.from('PRIMING-TEST-JPG-COVER-' + 'x'.repeat(2000));
  const jpgBuf = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), marker, Buffer.from([0xff, 0xd9])]);
  const cj = path.join(T, 'tool_cover.jpg'); fs.writeFileSync(cj, jpgBuf);
  const outEpub = path.join(T, 'a.epub');
  const br = await buildEpub(bk, { outPath: outEpub, baseDir: T, tmpDir: path.join(T, 'tmp'), embedFonts: 'none', ebookCoverPath: cj, log: () => {} });
  ok(br && br.success, 'ePub 생성');
  // zip 중앙 디렉터리를 읽어 OEBPS/cover.jpg 를 꺼낸다
  const zb = fs.readFileSync(outEpub); let off = zb.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const cnt = zb.readUInt16LE(off + 10); let cd = zb.readUInt32LE(off + 16); let found = null;
  for (let i = 0; i < cnt; i++) {
    const comp = zb.readUInt16LE(cd + 10), csz = zb.readUInt32LE(cd + 20), nlen = zb.readUInt16LE(cd + 28), elen = zb.readUInt16LE(cd + 30), clen = zb.readUInt16LE(cd + 32), lho = zb.readUInt32LE(cd + 42);
    const name = zb.subarray(cd + 46, cd + 46 + nlen).toString('utf8');
    if (name === 'OEBPS/cover.jpg') { const ln = zb.readUInt16LE(lho + 26), le = zb.readUInt16LE(lho + 28); const data = zb.subarray(lho + 30 + ln + le, lho + 30 + ln + le + csz); found = comp === 8 ? zlib.inflateRawSync(data) : data; }
    cd += 46 + nlen + elen + clen;
  }
  ok(found && Buffer.compare(found, jpgBuf) === 0, 'OEBPS/cover.jpg = 표지 도구가 만든 JPG 바이트 그대로(다시 자르지 않음)');
  const outPdf = path.join(T, 'p.epub'); const cpdf = path.join(T, 'x.pdf'); fs.writeFileSync(cpdf, '%PDF');
  const br2 = await buildEpub(bk, { outPath: outPdf, baseDir: T, tmpDir: path.join(T, 'tmp'), embedFonts: 'none', ebookCoverPath: cpdf, log: () => {} });
  const zb2 = fs.readFileSync(outPdf);
  ok(br2 && br2.success && !zb2.includes(Buffer.from('cover.pdf')), '판별: PDF 표지는 ePub 에 이미지로 넣지 않는다(image/pdf 로 깨지는 것 방지)');

  console.log('\n[4] 배선(소스)');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  ok(/async function resolveEbookCoverFile/.test(main) && /ebookCoverPath,/.test(main) && /await resolveEbookCoverFile\(root, bookFileBase\(\)\)/.test(main), 'main: ePub 만들기·부크크 전자책 등록이 같은 함수(resolveEbookCoverFile)로 표지를 고른다');
  ok(/okCover = \(p\) => \/\\\.\(jpe\?g\|pdf\)\$\/i\.test\(p\)/.test(main), 'main: 등록 업로드는 JPG·PDF 만(PNG 는 거른다)');
  ok(/ebookCoverPath:/.test(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'make-epub.js'), 'utf8')), 'scripts/make-epub.js 도 같은 규칙');

  fs.rmSync(T, { recursive: true, force: true });
  console.log(`\n${fail ? '❌' : '✅'} book-ebook-cover — ${pass} 통과 / ${fail} 실패${skip ? ' / ' + skip + ' 건너뜀' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
