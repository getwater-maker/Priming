'use strict';

/**
 * spine-calc.js — 책등폭·표지 스프레드 치수 계산.
 *
 * 책등폭(무선제본·양면 인쇄) = (총페이지 ÷ 2) × 낱장두께(mm)
 *   예: 백색모조 100g(0.115mm/장) 300쪽 → 150장 × 0.115 = 17.3mm
 *
 * 표지 스프레드(부크크 규격체크 도구 실측 공식):
 *   전체폭 = bleed + [날개] + 뒤표지(판형폭) + 책등 + 앞표지(판형폭) + [날개] + bleed
 *   전체높이 = 판형높이 + bleed×2
 */

const { getPlatform, getTrim, getPaper, bookkSpineMm } = require('./platform-presets');

// mm → px (dpi 기준, 300dpi: 1mm = 11.811px)
function mmToPx(mm, dpi = 300) { return Math.round((mm / 25.4) * dpi); }

// 책등폭(mm) — 소수 1자리 반올림. 부크크(spineFormula)는 화면 실측 공식(소수 2자리 — 부크크 화면 표기와 같게).
function spineWidthMm(totalPages, paperId, platformId) {
  if (platformId && getPlatform(platformId).spineFormula === 'bookk') return bookkSpineMm(totalPages);
  if (platformId && getPlatform(platformId).spineFormula === 'perPage') return perPageSpineMm(totalPages, paperId, platformId);
  const paper = getPaper(paperId);
  const sheets = Math.ceil((Number(totalPages) || 0) / 2);
  return Math.round(sheets * paper.sheetMm * 10) / 10;
}

// 해외 플랫폼(KDP·D2D) 쪽수 — 홀수는 짝수로 올림 · KDP 최소 24쪽(쪽수를 모르면 0)
function evenPagesOf(totalPages, platformId) {
  const pf = getPlatform(platformId); let n = Math.max(0, Math.floor(Number(totalPages) || 0));
  if (!n) return 0;
  if (pf.minPages && n < pf.minPages) n = pf.minPages;
  return pf.evenPages && n % 2 ? n + 1 : n;
}
// 책등 = 쪽수 × 쪽당 계수(인치) → mm, 소수 2자리(KDP 공식: 백색지 0.002252″ · 미색지 0.0025″)
function perPageSpineMm(totalPages, paperId, platformId) {
  const pf = getPlatform(platformId);
  const paper = getPaper(paperId || pf.defaultPaper);
  const n = evenPagesOf(totalPages, platformId);
  if (!n || !paper.perPageIn) return 0;
  return Math.round(n * paper.perPageIn * 25.4 * 100) / 100;
}
/** KDP 공식 표지 계산기 값(인치)과 앱 계산(mm) 대조 — 어긋나면 diffs. tolIn = 허용(기본 0.01″) */
function kdpTemplateDiff(spread, tpl, tolIn = 0.01) {
  const out = []; const IN = 25.4;
  const chk = (name, mm, inch) => { const v = Number(inch); if (!(v > 0)) return; const d = Math.abs(mm / IN - v); if (d > tolIn) out.push({ name, appIn: Math.round(mm / IN * 1000) / 1000, kdpIn: v, diffIn: Math.round(d * 1000) / 1000 }); };
  chk('폭', spread.widthMm, tpl && tpl.widthIn); chk('높이', spread.heightMm, tpl && tpl.heightIn); chk('책등', spread.spineMm, tpl && tpl.spineIn);
  return { ok: out.length === 0, diffs: out, given: !!(tpl && (Number(tpl.widthIn) > 0 || Number(tpl.heightIn) > 0 || Number(tpl.spineIn) > 0)) };
}

/**
 * 표지 스프레드 치수 계산.
 * @returns {{ spineMm, widthMm, heightMm, widthPx, heightPx, dpi, parts }}
 *   parts = 왼쪽부터 각 구간 폭(mm) — 가이드 렌더링용.
 */
//   spineOverrideMm > 0 = 사람이 적은 책등 두께(원고 `> 책등두께:` — 부크크 화면 값)가 계산을 이긴다.
function coverSpread({ platformId = 'bookk', trimId = 'A5', paperId, totalPages = 0, flaps = false, spineOverrideMm = 0 }) {
  const pf = getPlatform(platformId);
  const trim = getTrim(trimId);
  const bleed = pf.coverBleedMm;
  const flap = flaps ? pf.coverFlapMm : 0;
  const manual = Number(spineOverrideMm) > 0 ? Math.round(Number(spineOverrideMm) * 100) / 100 : 0;
  const spine = manual || spineWidthMm(totalPages, paperId || pf.defaultPaper, platformId);

  const widthMm = Math.round((bleed + flap + trim.width + spine + trim.width + flap + bleed) * 100) / 100;
  const heightMm = trim.height + bleed * 2;
  const parts = [];
  parts.push({ name: 'bleed', mm: bleed });
  if (flaps) parts.push({ name: '뒷날개', mm: flap });
  parts.push({ name: '뒤표지', mm: trim.width });
  parts.push({ name: '책등', mm: spine });
  parts.push({ name: '앞표지', mm: trim.width });
  if (flaps) parts.push({ name: '앞날개', mm: flap });
  parts.push({ name: 'bleed', mm: bleed });

  // 🇺🇸 KDP — 뒤표지 오른쪽 아래 바코드 자리(KDP 가 ISBN 바코드를 넣는다 · 스프레드 좌표 mm) · 책등 글자는 79쪽 초과만
  let barcodeKeepout = null, spineTextOk = true;
  if (pf.barcodeKeepout) {
    const k = pf.barcodeKeepout, w = k.widthIn * 25.4, h = k.heightIn * 25.4, m = k.marginIn * 25.4;
    const backRight = bleed + flap + trim.width;   // 뒤표지의 오른쪽 끝 = 책등 접힘선
    barcodeKeepout = { x: Math.round((backRight - m - w) * 100) / 100, y: Math.round((heightMm - bleed - m - h) * 100) / 100, w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100 };
  }
  if (pf.spineTextMinPages) spineTextOk = evenPagesOf(totalPages, platformId) > pf.spineTextMinPages;
  return {
    spineMm: spine, spineManual: !!manual,
    barcodeKeepout, spineTextOk, spineSafeMm: pf.spineSafeMm || 0, pagesUsed: pf.evenPages ? evenPagesOf(totalPages, platformId) : (Number(totalPages) || 0),
    unit: pf.unit || 'mm',
    widthMm, heightMm,
    widthPx: mmToPx(widthMm, pf.dpi), heightPx: mmToPx(heightMm, pf.dpi),
    dpi: pf.dpi, safeMm: pf.coverSafeMm, toleranceMm: pf.toleranceMm,
    parts,
  };
}

// 첨부한 표지 이미지 치수 검증 — px 를 mm 로 환산해 스프레드 기대치와 비교(±tolerance).
//   dpi 를 모르는 이미지가 많으므로 "가로/세로 비율" + "300dpi 가정 mm" 둘 다 검사해 관대하게 판단.
//   altSpread = 날개 설정을 **반대로** 했을 때의 스프레드(있으면) — 틀렸지만 반대 설정에는 맞는 파일이면 flapHint 로 「날개 설정을 확인하세요」를 알린다
//   (날개 켬 516.3mm ↔ 끔 316.3mm: 날개 파일을 날개 없는 설정에 올리거나 그 반대일 때).
function validateCoverImage({ imgW, imgH, spread, altSpread }) {
  const expW = spread.widthMm, expH = spread.heightMm;
  const mmW = (imgW / spread.dpi) * 25.4;
  const mmH = (imgH / spread.dpi) * 25.4;
  const dW = Math.abs(mmW - expW), dH = Math.abs(mmH - expH);
  const tol = Math.max(spread.toleranceMm, 1);
  const exact = dW <= tol && dH <= tol;
  // 비율 검사(±1%) — dpi 가 달라도 비율이 맞으면 스케일 인쇄 가능.
  const ratioOk = Math.abs((imgW / imgH) - (expW / expH)) / (expW / expH) <= 0.01;
  const dpiEff = (imgW / expW) * 25.4; // 폭 기준 실효 dpi
  let flapHint = null;
  if (!(exact || ratioOk) && altSpread) {
    const tolA = Math.max(altSpread.toleranceMm || 1, 1);
    const aW = Math.abs(mmW - altSpread.widthMm), aH = Math.abs(mmH - altSpread.heightMm);
    const aRatio = Math.abs((imgW / imgH) - (altSpread.widthMm / altSpread.heightMm)) / (altSpread.widthMm / altSpread.heightMm) <= 0.01;
    // 반대 설정에 맞는 파일이면, 그 파일은 「지금 설정과 반대」 — 지금 날개가 켜져 있으면 날개 없는 파일이다
    if ((aW <= tolA && aH <= tolA) || aRatio) flapHint = spread.parts.some((p) => p.name === '앞날개') ? 'file-has-no-flaps' : 'file-has-flaps';
  }
  return {
    ok: exact || ratioOk, flapHint,
    exact, ratioOk,
    mmW: Math.round(mmW * 10) / 10, mmH: Math.round(mmH * 10) / 10,
    effectiveDpi: Math.round(dpiEff),
    lowDpi: dpiEff < 280, // 300dpi 에 크게 못 미치면 경고
    expected: { widthMm: expW, heightMm: expH, widthPx: spread.widthPx, heightPx: spread.heightPx },
  };
}

module.exports = { mmToPx, spineWidthMm, coverSpread, validateCoverImage, evenPagesOf, perPageSpineMm, kdpTemplateDiff };
