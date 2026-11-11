'use strict';
/**
 * kmong-build.js — 🛒 크몽판 PDF 만들기(2026-11-11 · 설계 §A-3 ①). main 의 `book-build-kmong` 과 시험(book-kmong.smoke)이 같은 함수를 쓴다.
 *
 *   한 문서로 조판한다: 1쪽 표지(그림) → 저작권 안내 → 반표제지·속표지 → 목차(쪽 번호) → 본문 → 크몽판 판권 → 맨 끝 저작권 안내.
 *   표지를 PDF 로 따로 붙이지 않는 까닭: 목차의 쪽 번호가 PDF 뷰어의 쪽 번호와 같아야 한다(따로 붙이면 한 쪽씩 밀린다).
 *   표지가 PDF(종이책 표지 앞면 등)뿐이면 mupdf 로 그림으로 바꿔 넣는다.
 *   만든 뒤: 점검(kmong-check) → 🔴 막히면 잠그지 않는다 → 통과하면 qpdf 로 편집 잠금(있으면).
 */
const fs = require('fs');
const path = require('path');
const { buildBookHtml } = require('./html-builder');
const PB = require('./pdf-builder');
const KC = require('./kmong-check');

/** PDF 첫 쪽 → PNG(mupdf). 반환 = png 경로 또는 '' */
async function pdfFirstPageToPng(pdfPath, pngPath, dpi = 200) {
  try {
    const M = await KC.mupdf();
    const doc = M.Document.openDocument(fs.readFileSync(pdfPath), 'application/pdf');
    const page = doc.loadPage(0);
    const s = dpi / 72;
    const pix = page.toPixmap(M.Matrix.scale(s, s), M.ColorSpace.DeviceRGB, false, true);
    fs.mkdirSync(path.dirname(pngPath), { recursive: true });
    fs.writeFileSync(pngPath, Buffer.from(pix.asPNG()));
    return pngPath;
  } catch (_) { return ''; }
}

/**
 * opts: { book, layoutOpts, coverPath(그림 또는 PDF · 없으면 표지 없이), outPdf, workDir, baseDir, kmongDate, log, lock(true) , home }
 * 반환 { success, error, pages, outPdf, html, check, lock, hasCover, watermark }
 */
async function buildKmongPdf(opts) {
  const log = opts.log || (() => {});
  const workDir = opts.workDir;
  fs.mkdirSync(workDir, { recursive: true });
  const assets = PB.prepareWorkAssets(workDir);
  let cover = opts.coverPath && fs.existsSync(opts.coverPath) ? opts.coverPath : '';
  if (cover && /\.pdf$/i.test(cover)) {
    const png = await pdfFirstPageToPng(cover, path.join(workDir, '_kmong-cover.png'));
    if (!png) log(`⚠ 크몽판 표지 PDF(${path.basename(cover)})를 그림으로 바꾸지 못해 표지 없이 만듭니다`);
    cover = png;
  }
  const built = buildBookHtml(opts.book, {
    ...(opts.layoutOpts || {}),
    baseDir: opts.baseDir, imageUrl: assets.imageUrl, fontCss: assets.fontCss, sourceMap: false,
    edition: 'kmong', kmongCoverPath: cover || null, kmongDate: opts.kmongDate || '',
  });
  const r = await PB.buildInteriorPdf({ html: built.html, outPdf: opts.outPdf, workDir, log });
  if (r.cancelled) return { success: false, cancelled: true, error: '취소됨' };
  if (!r.success) return { success: false, error: r.error };
  const watermark = built.options.kmongWatermark;
  // 점검 먼저(잠그기 전 · 막히면 잠그지 않는다 — 고쳐서 다시 만들 파일)
  let check = await KC.checkKmongPdf(opts.outPdf, { hasCover: !!cover, watermark });
  let lock = null;
  if (check.ok && opts.lock !== false) {
    lock = await KC.lockEdit(opts.outPdf, { home: opts.home });
    if (lock.status === 'locked' || lock.status === 'error') check = await KC.checkKmongPdf(opts.outPdf, { hasCover: !!cover, watermark, lock });
    else check = { ...check, items: check.items.map((i) => i.id === 'lock' ? { ...i, detail: lock.detail } : i) };
  }
  return { success: true, pages: r.pages, outPdf: opts.outPdf, html: built.html, check, lock, hasCover: !!cover, watermark };
}

module.exports = { buildKmongPdf, pdfFirstPageToPng };
