'use strict';
/**
 * pdf-pack.js — 📄 완성 PDF 묶기(로이 2026-10-12 「전자책·종이책 모두 표지 · 본문 · 표지+본문 PDF」).
 *   - 앞표지 PDF 한 쪽: ① 전자책 표지 파일(JPG·PNG·PDF) ② 종이책 표지 PDF(펼침면)의 앞표지 부분을 벡터 그대로 잘라 냄
 *   - 표지+본문 = 앞표지 1쪽 + 본문 PDF 의 모든 쪽
 *   부크크 전자책은 앞표지 1쪽짜리 PDF 를 표지로 쓴다(`앞표지 (1).pdf` 실물 — 판형 비율 한 쪽).
 *   pdf-lib 은 이미 앱에 있다(대본 A4 모아 찍기 · @vivliostyle/cli 의존) — ⛔ 새 npm 의존성 아님.
 */
const fs = require('fs');
const path = require('path');

const PT_PER_MM = 72 / 25.4;

function lib() { return require('pdf-lib'); }

/**
 * 종이책 표지 펼침면(spread)에서 앞표지 자리(재단선 안쪽) — 오른쪽 끝에서 잰 mm.
 *   책등 폭이 바뀌어도(쪽수 변화) 앞표지는 오른쪽 끝(재단 여백 + 앞날개) 기준이라 흔들리지 않는다.
 * @returns {{ rightMm, widthMm, bleedMm, heightMm } | null}
 */
function frontPanelOf(spread) {
  const parts = (spread && spread.parts) || [];
  const i = parts.findIndex((p) => p.name === '앞표지');
  if (i < 0) return null;
  const rightMm = parts.slice(i + 1).reduce((a, p) => a + (Number(p.mm) || 0), 0);
  const bleedMm = Number((parts[0] && parts[0].name === 'bleed' && parts[0].mm) || 0);
  return { rightMm, widthMm: Number(parts[i].mm), bleedMm, heightMm: Number(spread.heightMm) - bleedMm * 2 };
}

/** 펼침면 표지 PDF → 앞표지 한 쪽 PDF(벡터 그대로 · 글자·바코드 포함). 실패 = null */
async function frontCoverFromSpreadPdf(spreadPdf, spread, outPdf) {
  const fp = frontPanelOf(spread);
  if (!fp || !fs.existsSync(spreadPdf)) return null;
  const { PDFDocument } = lib();
  const src = await PDFDocument.load(fs.readFileSync(spreadPdf));
  const pg = src.getPage(0);
  const { width: W, height: H } = pg.getSize();
  const right = W - fp.rightMm * PT_PER_MM;
  const left = right - fp.widthMm * PT_PER_MM;
  const bottom = fp.bleedMm * PT_PER_MM;
  const top = H - fp.bleedMm * PT_PER_MM;
  if (!(left >= -0.5 && right <= W + 0.5 && top > bottom)) return null;
  const doc = await PDFDocument.create();
  const emb = await doc.embedPage(pg, { left, bottom, right, top });
  const page = doc.addPage([right - left, top - bottom]);
  page.drawPage(emb, { x: 0, y: 0, width: right - left, height: top - bottom });
  fs.writeFileSync(outPdf, await doc.save());
  return outPdf;
}

/**
 * 표지 그림(JPG·PNG) 또는 PDF → 앞표지 한 쪽 PDF. 쪽 폭 = 판형 폭(mm), 높이 = 그림 비율 그대로(늘리지 않는다).
 *   PDF 를 주면 첫 쪽만 옮긴다(부크크 로고가 얹힌 전자책 앞표지 PDF 등).
 */
async function coverFileToPdf(file, outPdf, widthMm) {
  if (!file || !fs.existsSync(file)) return null;
  const { PDFDocument } = lib();
  const ext = path.extname(file).toLowerCase();
  const doc = await PDFDocument.create();
  if (ext === '.pdf') {
    const src = await PDFDocument.load(fs.readFileSync(file));
    const [p] = await doc.copyPages(src, [0]);
    doc.addPage(p);
  } else if (/^\.(jpe?g|png)$/.test(ext)) {
    const bytes = fs.readFileSync(file);
    const img = ext === '.png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const w = (Number(widthMm) > 0 ? Number(widthMm) : 148) * PT_PER_MM;
    const h = w * img.height / img.width;
    doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  } else return null;
  fs.writeFileSync(outPdf, await doc.save());
  return outPdf;
}

/**
 * 표지+본문 = 본문 PDF 맨 앞에 앞표지 한 쪽을 끼운다. 반환 = 쪽수.
 *   🔑 새 문서에 쪽을 복사해 잇지 않고 **본문 문서에 끼워 넣는다** — 그래야 Vivliostyle 이 만든 책갈피(목차 outline)·링크가 그대로 산다
 *   (copyPages 로 새 문서를 만들면 책갈피가 사라진다).
 */
async function prependCover(coverPdf, bodyPdf, outPdf) {
  const { PDFDocument } = lib();
  const body = await PDFDocument.load(fs.readFileSync(bodyPdf));
  const cov = await PDFDocument.load(fs.readFileSync(coverPdf));
  const cp = cov.getPage(0);
  const { width, height } = cp.getSize();
  const emb = await body.embedPage(cp);
  const page = body.insertPage(0, [width, height]);
  page.drawPage(emb, { x: 0, y: 0, width, height });
  fs.writeFileSync(outPdf, await body.save());
  return body.getPageCount();
}

/**
 * 📕 종이책 완성본 = 표지 펼침면 PDF 첫 쪽 **전체**(뒷표지·책등·앞표지·날개) + 내지 전체(로이 2026-10-14).
 *   ⛔ 앞표지만 잘라 붙이지 않는다 — 그건 전자책 완성본(`coverFileToPdf` → `prependCover`). 쪽 크기가 달라도 된다.
 */
async function printFullPdf(spreadCoverPdf, interiorPdf, outPdf) {
  return prependCover(spreadCoverPdf, interiorPdf, outPdf);
}

async function pageCount(file) {
  const { PDFDocument } = lib();
  return (await PDFDocument.load(fs.readFileSync(file))).getPageCount();
}

module.exports = { PT_PER_MM, frontPanelOf, frontCoverFromSpreadPdf, coverFileToPdf, prependCover, printFullPdf, pageCount };
