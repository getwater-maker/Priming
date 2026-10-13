'use strict';
/**
 * price-calc.js — 💲 KDP·D2D 가격·인쇄비·인세 계산(참고용) — 2026-10-14 v0.9.5 (해외 플랫폼 R28)
 *   🔴 값은 바뀐다 — 이 한 곳(`RATES`)에만 두고 확인한 날짜·출처를 달았다. 등록 전에 공식 계산기와 꼭 대조(KDP `kdp.amazon.com/en_US/royalty-calculator` · D2D `draft2digital.com/podcalc`).
 *   확인(2026-10-14 · 공식 도움말 직접 읽음):
 *   · KDP 종이책 인쇄비 G201834340(Amazon.com · 흑백 · 백색/미색): 24~110쪽 = 고정 2.30(대형 2.84) · 110~828쪽 = 고정 1.00 + 쪽당 0.012(대형 0.017) · 대형 = 폭 6.12″ 초과 또는 높이 9″ 초과 · 110쪽은 두 구간에 다 적혀 있어 높은 쪽을 쓴다(보수적)
 *   · KDP 종이책 인세 G201834330: (인세율 × 정가) − 인쇄비 · Amazon 마켓 = 50% 또는 60%(Amazon.com: 9.98 USD 이하 50% · 9.99 이상 60%) · Expanded Distribution 40% · 최소 정가 = 인쇄비로 인세가 0 이상이 되는 값
 *   · KDP 전자책 G200644210/G200634560/G200634500: 35% = 정가 × 35% (0.99~200 — 파일 3MB 미만 · 3~10MB 1.99 · 10MB 이상 2.99부터) · 70% = 정가 × 70% − 전송비(Amazon.com $0.15/MB · 최소 0.01 · KB 올림) · 70% 정가대 2.99~12.99(2026-07-07부터 · 이전 9.99) · 퍼블릭 도메인은 70% 불가
 *   · D2D Print FAQ: 「정가의 약 45% − 인쇄비」(문장이 모호해 두 해석을 범위로 보인다 ⚠️) · 인쇄비는 D2D 공식 계산기 값을 입력 · 무료 가격 불가 · 전자책 수수료 약 10%
 *   순수 함수 — 렌더러 번들에 들어간다.
 */
const RATES = {
  asOf: '2026-10-14',
  kdp: {
    source: 'https://kdp.amazon.com/en_US/help/topic/G201834340',
    printUS: { regular: { low: { fixed: 2.30, perPage: 0 }, high: { fixed: 1.00, perPage: 0.012 } }, large: { low: { fixed: 2.84, perPage: 0 }, high: { fixed: 1.00, perPage: 0.017 } }, largeW: 6.12, largeH: 9, boundary: 110, maxPages: 828 },
    royalty: { amazonLow: 0.5, amazonHigh: 0.6, amazonThreshold: 9.99, expanded: 0.4, source: 'https://kdp.amazon.com/en_US/help/topic/G201834330' },
    ebook: { r35: 0.35, r70: 0.70, band70: [2.99, 12.99], min35: [[3, 0.99], [10, 1.99], [Infinity, 2.99]], max35: 200, deliveryPerMB: 0.15, minDelivery: 0.01, source: 'https://kdp.amazon.com/en_US/help/topic/G200634560' },
  },
  d2d: { printShare: 0.45, ebookCommission: 0.10, calcUrl: 'https://draft2digital.com/podcalc', source: 'https://draft2digital.com/faq/' },
};
const r2 = (n) => Math.round(n * 100) / 100;
const ceil2 = (n) => Math.ceil(n * 100 - 1e-9) / 100;

// ── KDP 종이책 ───────────────────────────────────────────────────────────────
/** 인쇄비(USD) — 쪽수는 짝수로 올림 · 대형 판형 구분 */
function kdpPrintCost(pages, trimWIn, trimHIn) {
  const P = RATES.kdp.printUS;
  let n = Math.max(0, Math.floor(Number(pages) || 0)); if (n % 2) n += 1;
  if (!n) return { cost: 0, pages: 0, large: false, error: '쪽수를 모릅니다(조판 뒤 쪽수가 정해집니다)' };
  if (n < 24) n = 24;
  const large = Number(trimWIn) > P.largeW + 1e-9 || Number(trimHIn) > P.largeH + 1e-9;
  const t = large ? P.large : P.regular;
  const lo = t.low.fixed + n * t.low.perPage, hi = t.high.fixed + n * t.high.perPage;
  let cost, tier, ambiguous = false;
  if (n < P.boundary) { cost = lo; tier = 'low'; } else if (n > P.boundary) { cost = hi; tier = 'high'; } else { cost = Math.max(lo, hi); tier = 'boundary'; ambiguous = true; }
  const err = n > P.maxPages ? `${n}쪽 — 흑백 최대 ${P.maxPages}쪽을 넘습니다` : '';
  return { cost: r2(cost), pages: n, large, tier, ambiguous, fixed: tier === 'low' ? t.low.fixed : t.high.fixed, perPage: tier === 'low' ? t.low.perPage : t.high.perPage, ...(err ? { error: err } : {}) };
}
function kdpRate(listUsd, channel) {
  const R = RATES.kdp.royalty;
  if (channel === 'expanded') return R.expanded;
  return Number(listUsd) >= R.amazonThreshold - 1e-9 ? R.amazonHigh : R.amazonLow;
}
/** 최소 정가 — 인세가 0 이상이 되는 가장 낮은 값(센트 올림) */
function kdpMinList(cost, channel) {
  const R = RATES.kdp.royalty;
  if (channel === 'expanded') return ceil2(cost / R.expanded);
  const p50 = ceil2(cost / R.amazonLow);
  if (p50 < R.amazonThreshold) return p50;                       // 9.98 이하에서 50% 로 충당
  return Math.max(R.amazonThreshold, ceil2(cost / R.amazonHigh));   // 9.99 이상 60%
}
/** 종이책 인세 — {listUsd, pages, trimWIn, trimHIn, channel:'amazon'|'expanded'} */
function kdpPaperback(x) {
  const pc = kdpPrintCost(x.pages, x.trimWIn, x.trimHIn);
  const list = Number(x.listUsd) || 0, rate = kdpRate(list, x.channel);
  const royalty = r2(rate * list - pc.cost);
  return { ...pc, listUsd: list, channel: x.channel === 'expanded' ? 'expanded' : 'amazon', rate, royalty, minList: pc.cost ? kdpMinList(pc.cost, x.channel) : 0, belowMin: pc.cost > 0 && royalty < 0 };
}

// ── KDP 전자책 ───────────────────────────────────────────────────────────────
function kdpEbook(x) {
  const E = RATES.kdp.ebook, list = Number(x.listUsd) || 0, mb = Number(x.fileMB) || 0;
  const min35 = E.min35.find(([lim]) => mb < lim)[1];
  const ok35 = list >= min35 - 1e-9 && list <= E.max35 + 1e-9;
  const delivery = Math.max(RATES.kdp.ebook.minDelivery, Math.ceil(mb * 1024) / 1024 * E.deliveryPerMB);
  const ok70 = !x.publicDomain && list >= E.band70[0] - 1e-9 && list <= E.band70[1] + 1e-9;
  return {
    listUsd: list, fileMB: mb,
    r35: { ok: ok35, royalty: r2(E.r35 * list), min: min35, max: E.max35 },
    r70: { ok: ok70, royalty: r2(E.r70 * list - delivery), delivery: r2(delivery), band: E.band70, publicDomainBlocked: !!x.publicDomain },
  };
}

// ── D2D ─────────────────────────────────────────────────────────────────────
/** D2D Print — 인쇄비는 D2D 공식 계산기 값을 입력한다. FAQ 문장(「정가의 약 45% − 인쇄비」)이 모호해 두 해석을 범위로 보인다 */
function d2dPrint(x) {
  const D = RATES.d2d, list = Number(x.listUsd) || 0, pc = Number(x.printCostUsd) || 0;
  const a = D.printShare * list - pc;            // 45% × 정가 − 인쇄비(FAQ 문장 그대로)
  const b = D.printShare * Math.max(0, list - pc);   // 45% × (정가 − 인쇄비)(요청서 가이드 해석)
  return { listUsd: list, printCostUsd: pc, low: r2(Math.min(a, b)), high: r2(Math.max(a, b)), free: list <= 0, needCost: !(pc > 0) };
}
function d2dEbook(x) { const list = Number(x.listUsd) || 0; return { listUsd: list, afterCommission: r2(list * (1 - RATES.d2d.ebookCommission)) }; }

/** 공식 계산기 값과 앱 값 대조 — 어긋나면 diff(USD). tol 기본 0.05 */
function compareOfficial(appUsd, officialUsd, tol = 0.05) {
  const o = Number(officialUsd); if (!(o > 0)) return { given: false };
  const d = r2(Math.abs(Number(appUsd) - o));
  return { given: true, ok: d <= tol, diff: d, app: r2(appUsd), official: r2(o) };
}

module.exports = { RATES, kdpPrintCost, kdpRate, kdpMinList, kdpPaperback, kdpEbook, d2dPrint, d2dEbook, compareOfficial };
