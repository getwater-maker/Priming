'use strict';

/**
 * platform-presets.js — POD 플랫폼(부크크/교보문고POD/작가와)별 입고 규격.
 *
 * 수치 출처(2026-07 조사):
 *  - 부크크: 공식 규격체크 도구(bookk.co.kr/auto-size-preview.html) JS 소스 실측 —
 *    판형 4종, bleed 3mm, 날개 100mm 고정, 오차 ±1mm, 안전여백 5mm, 300dpi, 최소 50p.
 *    내지 PDF 는 재단여백 없이 판형 치수 그대로.
 *  - 교보 POD(퍼플): 판형 6종. 표지 스프레드 동일 원리(책등은 시스템 제시).
 *  - 작가와: 2025-11 POD 베타 — 규격 미공개. 부크크 규격 준용(정식 오픈 시 갱신).
 *
 * 책등폭: (총페이지 ÷ 2) × 낱장두께(mm). 용지별 낱장두께는 PAPERS 참조.
 *   예외 — 부크크는 화면 실측 공식(spineFormula 'bookk', 2026-09-30 고전서재가 공개 계산기 15개 쪽수에서 일치 확인):
 *     내지 = 미색모조 100g 고정(400쪽부터 미색모조 80g 자동) · 두께 = 399쪽 이하 1.6 + 0.055×쪽수 · 400쪽 이상 1.6 + 0.045×쪽수 (1.6 = 표지·면지)
 *     232쪽 → 14.36mm (옛 (쪽수÷2)×0.115 = 13.3mm 는 약 1mm 모자랐다).
 */

// 판형(트림) 사이즈 — mm
const TRIM_SIZES = {
  '46판':   { width: 127, height: 188, label: '46판 (127×188)' },
  'A5':     { width: 148, height: 210, label: 'A5 국판 (148×210)' },
  '신국판': { width: 152, height: 225, label: '신국판 (152×225)' },
  '크라운판': { width: 176, height: 248, label: '크라운판 (176×248)' },
  'B5':     { width: 182, height: 257, label: 'B5 (182×257)' },
  '46배판': { width: 188, height: 254, label: '46배판 (188×254)' },
  'A4':     { width: 210, height: 297, label: 'A4 (210×297)' },
  'A6':     { width: 105, height: 148, label: 'A6 국반판 (105×148)' },
};

// 내지 용지 — 낱장두께(mm/장). 책등 = (페이지÷2) × 두께.
//   모조지 80g ≈ 0.1mm/장(디지프린트 가이드), 100g ≈ 0.115, 150g ≈ 0.17, 이라이트 80g ≈ 0.106(벌키).
const PAPERS = {
  '백색모조 80g':  { sheetMm: 0.100, label: '백색모조 80g' },
  '백색모조 100g': { sheetMm: 0.115, label: '백색모조 100g' },
  '백색모조 150g': { sheetMm: 0.170, label: '백색모조 150g' },
  '미색모조 80g':  { sheetMm: 0.100, label: '미색모조 80g' },
  '미색모조 100g': { sheetMm: 0.115, label: '미색모조 100g (부크크 기본)' },
  '이라이트 80g':  { sheetMm: 0.106, label: '이라이트 80g (가볍고 두꺼움)' },
  '스노우 100g':   { sheetMm: 0.090, label: '스노우지 100g' },
};

const PLATFORMS = {
  bookk: {
    label: '부크크',
    trims: ['46판', 'A5', 'B5', 'A4'],
    defaultTrim: 'A5',
    coverBleedMm: 3,        // 표지 재단여백(사방)
    coverFlapMm: 100,       // 날개 폭(고정)
    coverSafeMm: 5,         // 안전여백(글자·중요 요소)
    interiorBleedMm: 0,     // 내지는 재단여백 없이 판형 치수 그대로
    minPages: 50,
    dpi: 300,
    toleranceMm: 1,
    defaultPaper: '미색모조 100g',
    papers: ['미색모조 100g', '미색모조 80g'],   // 부크크 흑백 내지는 이 둘뿐 — 쪽수로 자동(400쪽부터 80g)
    spineFormula: 'bookk',
    note: '내지 PDF=판형 치수 그대로(재단여백 없음) · 최소 50쪽 · 일반 PDF(폰트 임베딩·300dpi) · 내지 미색모조 100g(400쪽부터 80g) · 책등 = 1.6 + 0.055×쪽수(400쪽부터 0.045)',
  },
  kyobo: {
    label: '교보문고 POD',
    trims: ['A5', '신국판', '크라운판', '46배판', 'A4', 'A6'],
    defaultTrim: '신국판',
    coverBleedMm: 3,
    coverFlapMm: 100,
    coverSafeMm: 5,
    interiorBleedMm: 0,
    minPages: 50,
    dpi: 300,
    toleranceMm: 1,
    defaultPaper: '백색모조 100g',
    note: '판형 6종 · 책등폭은 등록 시 시스템이 제시(아래 계산과 대조 확인) · 첫 페이지=표지, 쪽번호 일치 필수',
  },
  jakkawa: {
    label: '작가와 (베타)',
    trims: ['46판', 'A5', 'B5', 'A4'],
    defaultTrim: 'A5',
    coverBleedMm: 3,
    coverFlapMm: 100,
    coverSafeMm: 5,
    interiorBleedMm: 0,
    minPages: 50,
    dpi: 300,
    toleranceMm: 1,
    defaultPaper: '백색모조 100g',
    note: 'POD 베타(2025-11) — 공식 규격 미공개, 부크크 규격 준용. 정식 오픈 시 갱신 필요',
  },
};

function getPlatform(id) { return PLATFORMS[id] || PLATFORMS.bookk; }
function getTrim(id) { return TRIM_SIZES[id] || TRIM_SIZES['A5']; }
function getPaper(id) { return PAPERS[id] || PAPERS['백색모조 100g']; }

// 부크크 — 쪽수가 정하는 내지 용지와 책등 두께(화면 실측 공식). 쪽수를 모르면(0) 책등 0.
function bookkPaper(pages) { return (Number(pages) || 0) >= 400 ? '미색모조 80g' : '미색모조 100g'; }
function bookkSpineMm(pages) {
  const p = Number(pages) || 0;
  if (p <= 0) return 0;
  return Math.round((1.6 + (p >= 400 ? 0.045 : 0.055) * p) * 100) / 100;
}
// 플랫폼이 용지를 정하면(부크크) 그 용지 · 아니면 원고 메타 용지(목록에 없으면 플랫폼 기본).
function effectivePaper(platformId, paperId, pages) {
  const pf = getPlatform(platformId);
  if (pf.spineFormula === 'bookk') return bookkPaper(pages);
  return paperId && PAPERS[paperId] ? paperId : pf.defaultPaper;
}

module.exports = { PLATFORMS, TRIM_SIZES, PAPERS, getPlatform, getTrim, getPaper, bookkPaper, bookkSpineMm, effectivePaper };
