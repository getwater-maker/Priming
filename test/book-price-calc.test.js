'use strict';
/**
 * node test/book-price-calc.test.js — 해외 플랫폼 R28: KDP·D2D 가격·인쇄비·인세 계산(참고용 · 값은 price-calc.RATES 한 곳 · 확인일 표시)
 *   · KDP 공식 도움말의 예시를 그대로 재현(300쪽 = $4.60 · 전자책 $2.99 2MB → 인세 $1.79 · (0.60×15)−5.00)
 */
const fs = require('fs'), path = require('path');
const PC = require('../core/book/price-calc');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const near = (a, b, t = 0.005) => Math.abs(a - b) <= t;

console.log('[1] KDP 종이책 인쇄비(공식 표)');
{
  ok(near(PC.kdpPrintCost(300, 6, 9).cost, 4.60) && PC.kdpPrintCost(300, 6, 9).large === false, '300쪽 6×9″ = 1.00 + 300×0.012 = $4.60 (공식 예시)');
  ok(near(PC.kdpPrintCost(100, 6, 9).cost, 2.30) && near(PC.kdpPrintCost(24, 5, 8).cost, 2.30), '24~110쪽 = 고정 $2.30(쪽당 없음)');
  ok(near(PC.kdpPrintCost(100, 7, 10).cost, 2.84) && PC.kdpPrintCost(100, 7, 10).large === true, '대형(폭 6.12″ 초과 · 높이 9″ 초과) 저쪽수 = $2.84');
  ok(near(PC.kdpPrintCost(300, 7, 10).cost, 1.00 + 300 * 0.017), '대형 300쪽 = 1.00 + 300×0.017');
  ok(PC.kdpPrintCost(300, 6.12, 9).large === false && PC.kdpPrintCost(300, 6.13, 9).large === true && PC.kdpPrintCost(300, 6, 9.01).large === true, '대형 경계: 6.12″·9″ 는 일반 · 넘으면 대형');
  ok(PC.kdpPrintCost(301, 6, 9).pages === 302 && near(PC.kdpPrintCost(301, 6, 9).cost, 1 + 302 * 0.012), '홀수 쪽수는 짝수로 올려 계산(301 → 302)');
  const b = PC.kdpPrintCost(110, 6, 9);
  ok(b.ambiguous && near(b.cost, Math.max(2.30, 1 + 110 * 0.012)), '110쪽은 두 구간에 적혀 있어 높은 쪽(보수적) · ambiguous 표시');
  ok(PC.kdpPrintCost(10, 6, 9).pages === 24 && PC.kdpPrintCost(900, 6, 9).error && PC.kdpPrintCost(0, 6, 9).error, '24쪽 미만은 24 · 828쪽 초과 오류 · 쪽수 모르면 오류');
}

console.log('\n[2] KDP 종이책 인세');
{
  ok(PC.kdpRate(9.98, 'amazon') === 0.5 && PC.kdpRate(9.99, 'amazon') === 0.6 && PC.kdpRate(20, 'expanded') === 0.4, '인세율: Amazon.com 9.98 이하 50% · 9.99 이상 60% · Expanded 40% (공식)');
  const r = PC.kdpPaperback({ listUsd: 15, pages: 300, trimWIn: 6, trimHIn: 9, channel: 'amazon' });
  ok(near(r.royalty, 0.6 * 15 - 4.60) && r.rate === 0.6, '(0.60×15) − 4.60 = $4.40 (공식식 (인세율×정가) − 인쇄비)');
  ok(near(PC.kdpPaperback({ listUsd: 15, pages: 300, trimWIn: 6, trimHIn: 9, channel: 'expanded' }).royalty, 0.4 * 15 - 4.60), 'Expanded Distribution: (0.40×15) − 4.60 = $1.40');
  ok(near(r.minList, 9.20), '최소 정가: 인쇄비 4.60 → 50% 구간(9.98 이하)에서 9.20 · 인세 0');
  const m = PC.kdpPaperback({ listUsd: 5, pages: 300, trimWIn: 6, trimHIn: 9, channel: 'amazon' });
  ok(m.belowMin === true && m.royalty < 0 && near(m.minList, 9.20), '정가가 너무 낮으면 belowMin · 최소 정가 $9.20(= 4.60/0.5)');
  const big = PC.kdpPaperback({ listUsd: 5, pages: 800, trimWIn: 7, trimHIn: 10, channel: 'amazon' });
  ok(near(big.minList, Math.max(9.99, Math.ceil(big.cost / 0.6 * 100) / 100)), '인쇄비가 커서 50% 로 9.98 이내에 못 맞추면 60% 구간 최소 정가(' + big.minList + ')');
  ok(PC.kdpMinList(4.6, 'expanded') === 11.5, 'Expanded 최소 정가 = 4.60/0.40 = 11.50');
}

console.log('\n[3] KDP 전자책');
{
  const e = PC.kdpEbook({ listUsd: 2.99, fileMB: 2 });
  ok(near(e.r70.delivery, 0.30) && near(e.r70.royalty, 1.79) && e.r70.ok && near(e.r35.royalty, 1.05), '$2.99 · 2MB: 전송비 $0.30 · 70% 인세 $1.79 (공식 예시) · 35% $1.05');
  ok(PC.kdpEbook({ listUsd: 12.99, fileMB: 1 }).r70.ok && !PC.kdpEbook({ listUsd: 13, fileMB: 1 }).r70.ok && !PC.kdpEbook({ listUsd: 2.98, fileMB: 1 }).r70.ok, '70% 정가대 2.99~12.99 (2026-07-07 확대 · 이전 9.99)');
  ok(PC.kdpEbook({ listUsd: 5, fileMB: 1, publicDomain: true }).r70.publicDomainBlocked && !PC.kdpEbook({ listUsd: 5, fileMB: 1, publicDomain: true }).r70.ok, '퍼블릭 도메인은 70% 불가(공식)');
  ok(PC.kdpEbook({ listUsd: 0.99, fileMB: 1 }).r35.ok && !PC.kdpEbook({ listUsd: 0.99, fileMB: 5 }).r35.ok && PC.kdpEbook({ listUsd: 1.99, fileMB: 5 }).r35.ok && !PC.kdpEbook({ listUsd: 1.99, fileMB: 12 }).r35.ok, '35% 최저 정가: 3MB 미만 0.99 · 3~10MB 1.99 · 10MB↑ 2.99');
  ok(near(PC.kdpEbook({ listUsd: 5, fileMB: 0 }).r70.delivery, 0.01), '전송비 최소 $0.01');
}

console.log('\n[4] D2D');
{
  const d = PC.d2dPrint({ listUsd: 15, printCostUsd: 5 });
  ok(near(d.low, 0.45 * 15 - 5) && near(d.high, 0.45 * 10) && d.low < d.high, '인세 범위: 정가의 45% − 인쇄비(1.75) ~ (정가−인쇄비)의 45%(4.50) — FAQ 문장이 모호해 범위로');
  ok(PC.d2dPrint({ listUsd: 15 }).needCost === true && PC.d2dPrint({ listUsd: 0, printCostUsd: 3 }).free === true, '인쇄비 입력이 없으면 안내 · 무료 가격은 불가');
  ok(near(PC.d2dEbook({ listUsd: 10 }).afterCommission, 9), '전자책: 수수료 약 10% 뗀 값');
}

console.log('\n[5] 공식 계산기 대조 · 값 관리');
{
  ok(PC.compareOfficial(4.6, 4.6).ok && !PC.compareOfficial(4.6, 4.3).ok && PC.compareOfficial(4.6, 4.3).diff === 0.3 && !PC.compareOfficial(4.6, '').given, '공식 계산기 값과 대조(±0.05)');
  ok(/^2026-\d\d-\d\d$/.test(PC.RATES.asOf) && /kdp\.amazon\.com/.test(PC.RATES.kdp.source) && /draft2digital\.com/.test(PC.RATES.d2d.calcUrl), '값 확인 날짜·출처 URL 이 상수에 있다');
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'book', 'price-calc.js'), 'utf8');
  ok(!/require\('fs'\)|require\("fs"\)/.test(src), '순수 함수(fs 없음 — 렌더러 번들에 들어간다)');
}
console.log(`\n${fail ? '❌' : '✅'} book-price-calc ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
