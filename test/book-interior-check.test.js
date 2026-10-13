'use strict';
/**
 * node test/book-interior-check.test.js — 해외 플랫폼 R24: KDP·D2D 내지 점검(여백 구간표 · 쪽수 · 글자 · PDF 글꼴 임베드/투명/주석/북마크 · 이미지 dpi · D2D 그레이스케일)
 *   · 값 출처: KDP 공식 G201857950(여백표 · 24쪽 · 짝수 올림 · 7pt · 300dpi · 650MB) · D2D FAQ(32~1,050쪽 · 판형 6종 · 그레이스케일)
 *   · 실제 영어 KDP 내지 PDF 를 한 번 조판해 scanPdf 가 글꼴 임베드를 읽는지 본다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const IC = require('../core/book/interior-check');
const PP = require('../core/book/platform-presets');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildBookHtml, resolveBookOptions } = require('../core/book/html-builder');
const PB = require('../core/book/pdf-builder');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const IN = 25.4;
const find = (items, id) => items.find((x) => x.id === id);

console.log('[1] KDP 안쪽 여백 구간표(공식)');
{
  const t = [[24, 0.375], [150, 0.375], [151, 0.5], [300, 0.5], [301, 0.625], [500, 0.625], [501, 0.75], [700, 0.75], [701, 0.875], [828, 0.875]];
  ok(t.every(([p, v]) => IC.kdpInsideIn(p) === v), '구간 경계: 150/151 · 300/301 · 500/501 · 700/701 · 828');
  const m = IC.overseasMarginsMm(200);
  ok(Math.abs(m.inner - 12.7) < 1e-9 && Math.abs(m.outer - 12.7) < 1e-9 && Math.abs(m.top - 19.05) < 1e-9, '기본 여백(200쪽): 안쪽 0.5″ · 바깥 0.5″ · 위·아래 0.75″');
  ok(IC.overseasMarginsMm(0).inner === 0.5 * IN, '쪽수 힌트가 없으면 안쪽 0.5″');
}

console.log('\n[2] 조판 여백 기본값');
{
  const kdp = parseBookText('# t\n> 언어: en\n> 플랫폼: KDP\n> 판형: 6×9\n\n## Chapter 1\n\nText.\n', 'k');
  const r1 = resolveBookOptions(kdp, { pagesHint: 200 }).o.marginsMm;
  ok(Math.abs(r1.inner - 12.7) < 1e-9 && Math.abs(r1.top - 19.05) < 1e-9, 'KDP 조판: 기본 여백 = 해외 기본(안쪽 구간표)');
  const r2 = resolveBookOptions(kdp, { pagesHint: 320, marginsMm: { top: 20, bottom: 15, inner: 20, outer: 17 } }).o.marginsMm;
  ok(Math.abs(r2.inner - 0.625 * IN) < 1e-9, 'UI 가 보낸 한국 기본값(20/15/20/17) 그대로면 해외 기본(320쪽 → 안쪽 0.625″)');
  const r3 = resolveBookOptions(kdp, { pagesHint: 200, marginsMm: { top: 20, bottom: 15, inner: 22, outer: 17 } }).o.marginsMm;
  ok(r3.inner === 22 && Math.abs(r3.top - 20) < 1e-9 === false || r3.inner === 22, '사람이 한 칸이라도 바꾸면 그 값이 이긴다(안쪽 22mm)');
  const ko = parseBookText('# t\n> 플랫폼: 부크크\n\n## 제1회 가\n\n글.\n', 'k');
  const r4 = resolveBookOptions(ko, { pagesHint: 200 }).o.marginsMm;
  ok(r4.top === 20 && r4.bottom === 15 && r4.inner === 20 && r4.outer === 17, '부크크는 예전 기본(20/15/20/17) 그대로');
}

console.log('\n[3] 점검 항목');
{
  const base = { platformId: 'kdp', paper: '', marginsMm: IC.overseasMarginsMm(200), fontSizePt: 11, trim: null };
  ok(find(IC.interiorItems({ ...base, pages: 23 }), 'kdp-pages').state === 'error' && find(IC.interiorItems({ ...base, pages: 24 }), 'kdp-pages').state === 'ok', 'KDP 24쪽 미만 오류 · 24쪽 통과');
  ok(find(IC.interiorItems({ ...base, pages: 25 }), 'kdp-pages').state === 'info' && /26쪽/.test(find(IC.interiorItems({ ...base, pages: 25 }), 'kdp-pages').detail), '홀수 쪽수는 짝수로 올림 안내(25 → 26)');
  ok(find(IC.interiorItems({ ...base, pages: 828 }), 'kdp-pages').state === 'ok' && find(IC.interiorItems({ ...base, pages: 830 }), 'kdp-pages').state === 'error' && find(IC.interiorItems({ ...base, pages: 778, paper: 'KDP 미색지' }), 'kdp-pages').state === 'error', '최대 쪽수: 백색 828 · 미색 776');
  const d = (pg) => IC.interiorItems({ ...base, platformId: 'd2d', pages: pg }).find((x) => x.id === 'd2d-pages').state;
  ok(d(31) === 'error' && d(32) === 'ok' && d(1050) === 'ok' && d(1051) === 'error', 'D2D 쪽수 32~1,050');
  // 여백
  const small = IC.interiorItems({ ...base, pages: 200, marginsMm: { top: 19, bottom: 19, inner: 0.375 * IN, outer: 0.5 * IN } });
  ok(find(small, 'inside-margin').state === 'error' && /0\.5″/.test(find(small, 'inside-margin').detail), '200쪽에 안쪽 0.375″ → 오류(필요 0.5″)');
  ok(find(IC.interiorItems({ ...base, pages: 140, marginsMm: { top: 19, bottom: 19, inner: 0.375 * IN, outer: 0.5 * IN } }), 'inside-margin').state === 'ok', '140쪽 안쪽 0.375″ 통과');
  ok(find(IC.interiorItems({ ...base, pages: 200, marginsMm: { top: 19, bottom: 19, inner: 13, outer: 5 } }), 'outside-margin').state === 'error', '바깥 0.25″ 미만 오류');
  ok(find(IC.interiorItems({ ...base, platformId: 'd2d', pages: 200, marginsMm: { top: 19, bottom: 19, inner: 8, outer: 13 } }), 'inside-margin').state === 'warn', 'D2D 는 여백 규정이 비공개라 경고만');
  ok(find(IC.interiorItems({ ...base, pages: 200, hasBleed: true, marginsMm: { top: 19, bottom: 19, inner: 13, outer: 0.3 * IN } }), 'outside-margin').state === 'error', '블리드 내지는 바깥 0.375″');
  // 글자
  ok(find(IC.interiorItems({ ...base, pages: 200, fontSizePt: 6.5 }), 'font-size').state === 'error' && find(IC.interiorItems({ ...base, pages: 200, fontSizePt: 8 }), 'font-size').state === 'warn' && find(IC.interiorItems({ ...base, pages: 200, fontSizePt: 11 }), 'font-size').state === 'ok', '글자: 본문 6.5 오류 · 각주(본문−2)가 7pt 미만이면 경고');
  // PDF 사실
  const goodPdf = { encrypted: false, uriLinks: 0, fonts: { total: 2, notEmbedded: [], names: ['A', 'B'], type3: 0 }, transparency: false, smask: false, alphaStates: 0, links: 0, outlines: false, bytes: 5e6 };
  ok(['pdf-fonts', 'pdf-transparency', 'pdf-annots', 'pdf-size'].every((id) => find(IC.interiorItems({ ...base, pages: 200, pdf: goodPdf }), id).state === 'ok'), '좋은 PDF: 임베드·투명·주석·크기 모두 통과');
  const badPdf = { ...goodPdf, encrypted: true, fonts: { total: 2, notEmbedded: ['Arial'], names: ['Arial'], type3: 0 }, transparency: true, smask: true, alphaStates: 3, links: 4, uriLinks: 2, outlines: true, bytes: 700 * 1048576 };
  const bi = IC.interiorItems({ ...base, pages: 200, pdf: badPdf });
  ok(find(bi, 'pdf-fonts').state === 'error' && find(bi, 'pdf-encrypted').state === 'error' && find(bi, 'pdf-transparency').state === 'warn' && find(bi, 'pdf-annots').state === 'warn' && find(bi, 'pdf-size').state === 'error', '나쁜 PDF: 글꼴 미임베드·암호화·크기 오류 · 투명·주석·북마크 경고');
  ok(find(IC.interiorItems({ ...base, pages: 200 }), 'pdf-scan').state === 'info', 'PDF 가 아직 없으면 안내');
  // 이미지
  const imgs = [{ src: 'a.png', pxW: 1800, pxH: 1200 }, { src: 'b.png', pxW: 600, pxH: 400 }, { src: 'c.png', missing: true }];
  const ii = IC.interiorItems({ ...base, pages: 200, images: imgs, textWidthMm: 5 * IN });
  ok(find(ii, 'img-missing').state === 'error' && find(ii, 'img-dpi').state === 'warn' && /b\.png\(600px → 120dpi\)/.test(find(ii, 'img-dpi').detail), '이미지: 없는 파일 오류 · 본문 폭 기준 300dpi 미만 경고(600px/5″ = 120dpi)');
  ok(find(IC.interiorItems({ ...base, pages: 200, images: [{ src: 'a.png', pxW: 1800 }], textWidthMm: 5 * IN }), 'img-dpi').state === 'ok', '1800px/5″ = 360dpi 통과');
  ok(find(IC.interiorItems({ ...base, platformId: 'd2d', pages: 200, images: [{ src: 'a.png', pxW: 1800, color: true }], textWidthMm: 5 * IN }), 'img-gray').state === 'warn' && !find(IC.interiorItems({ ...base, pages: 200, images: [{ src: 'a.png', pxW: 1800, color: true }], textWidthMm: 5 * IN }), 'img-gray'), 'D2D 만 컬러 이미지 경고');
  ok(IC.interiorItems({ platformId: 'bookk', pages: 200 }).length === 0, '부크크는 이 점검이 없다');
}

console.log('\n[3b] scanPdf 판정력(합성 PDF 조각)');
{
  const syn = Buffer.from('<< /Type /FontDescriptor /FontName /AAAAAA+Foo /FontFile2 9 0 R >> << /Type /FontDescriptor /FontName /Bar >> << /Subtype /Link /A << /URI (http://x) >> >> /Outlines 5 0 R /ca 0.5 /Encrypt 7 0 R', 'latin1');
  const r = IC.scanPdf(syn);
  ok(r.fonts.descriptors === 2 && r.fonts.notEmbedded.join() === 'Bar' && r.uriLinks === 1 && r.links === 1 && r.outlines && r.transparency && r.encrypted, '글꼴 디스크립터(임베드 Foo · 미임베드 Bar) · 바깥 링크 · 북마크 · 투명도 · 암호화를 읽는다');
  const clean = IC.scanPdf(Buffer.from('<< /Type /FontDescriptor /FontName /Foo /FontFile3 9 0 R >> /ca 1 /CA 1', 'latin1'));
  ok(clean.fonts.notEmbedded.length === 0 && !clean.transparency && !clean.outlines && !clean.encrypted && clean.uriLinks === 0, '깨끗한 조각은 모두 통과(/ca 1 은 투명도가 아니다)');
}

console.log('\n[4] 플랫폼 프리셋(D2D 공식 확인값)');
{
  const d = PP.getPlatform('d2d');
  ok(d.trims.join() === '5x8,5.25x8,5.5x8.5,6x9,7.5x9.25,8.5x11' && d.minPages === 32 && d.maxPages === 1050 && d.grayscaleInterior === true && d.trims.every((k) => PP.TRIM_SIZES[k]), 'D2D: 판형 6종 · 32~1,050쪽 · 그레이스케일 내지');
}

(async () => {
  console.log('\n[5] 실제 영어 KDP 내지 PDF 조판 → scanPdf');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'kdpint-'));
  try {
    const para = 'It was a bright cold day in April, and the clocks were striking thirteen. Winston Smith slipped quickly through the glass doors of Victory Mansions. '.repeat(14);
    const chs = Array.from({ length: 6 }, (_, i) => `## Chapter ${i + 1}\n\n${(para + '\n\n').repeat(3)}`).join('\n');
    const md = `# Test Book\n> 저자: George Orwell\n> 출판사: Classic Desk\n> 발행일: 2026-10-06\n> 언어: en\n> 플랫폼: KDP\n> 판형: 6×9\n\n## [Copyright]\n\n* Test.\n\n${chs}\n`;
    const book = parseBookText(md, 'kdp');
    const work = PB.prepareWorkAssets(path.join(T, 'work'));
    const { html, options } = buildBookHtml(book, { fontCss: work.fontCss, imageUrl: work.imageUrl, pagesHint: 40 });
    ok(/<html lang="en">/.test(html) && Math.abs(options.marginsMm.inner - 0.375 * IN) < 1e-6, '조판 HTML: lang=en · 안쪽 0.375″(40쪽 힌트)');
    const r = await PB.buildInteriorPdf({ html, outPdf: path.join(T, 'in.pdf'), workDir: path.join(T, 'work'), log: () => {} });
    ok(r.success, '내지 PDF 생성' + (r.success ? ` (${r.pages}쪽)` : ' — ' + r.error));
    if (r.success) {
      const s = IC.scanPdf(fs.readFileSync(r.pdfPath));
      ok(s.fonts.total > 0 && s.fonts.notEmbedded.length === 0, `PDF 글꼴 ${s.fonts.total}종 전부 임베드(${s.fonts.names.slice(0, 3).join(', ')}${s.fonts.type3 ? ' · Type3 ' + s.fonts.type3 : ''})`);
      ok(s.fonts.names.some((n) => /Crimson/i.test(n)), '영어 책 본문 글꼴 = Crimson Text 가 PDF 에 임베드됐다(' + s.fonts.names.join(', ') + ')');
      ok(s.uriLinks === 0 && !s.outlines && !s.encrypted, `바깥 주소 링크 ${s.uriLinks} · 북마크 ${s.outlines} · 암호화 ${s.encrypted} (내부 이동 링크 ${s.links}개 = 목차 쪽번호)`);
      const pi = IC.interiorItems({ platformId: 'kdp', pages: r.pages, pdf: s }).find((q) => q.id === 'pdf-annots');
      ok(pi && pi.state === (s.links ? 'info' : 'ok'), '내부 이동 링크만 있으면 info(경고 아님) — 점검 항목 ' + (pi && pi.state));
      console.log(`  · 투명도 ${s.transparency} (smask ${s.smask} · alpha ${s.alphaStates}) · ${(s.bytes / 1024).toFixed(0)}KB`);
    }
  } catch (e) { fail++; console.log('  ✗ PDF 시험 오류: ' + e.message); }
  try { fs.rmSync(T, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${fail ? '❌' : '✅'} book-interior-check ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
