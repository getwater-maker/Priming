// 💲 KDP·D2D 가격·인쇄비·인세 계산기(R28 · 참고용) — 값은 core/book/price-calc.RATES 한 곳(확인 날짜·출처 표시). 공식 계산기와 꼭 대조.
import React, { useState } from 'react';
import api from './lib/ipc.js';
import PC from '../../core/book/price-calc.js';

const num = (v) => (v === '' || v == null ? 0 : Number(v));
const usd = (n) => (n < 0 ? '−$' + Math.abs(n).toFixed(2) : '$' + Number(n).toFixed(2));

export default function PriceCalc({ plan }) {
  const c = plan.calc || {};
  const isKdp = plan.platformId === 'kdp';
  const [list, setList] = useState('');
  const [pages, setPages] = useState(c.pages || '');
  const [trimW, setTrimW] = useState(c.trimWIn || 6);
  const [trimH, setTrimH] = useState(c.trimHIn || 9);
  const [channel, setChannel] = useState('amazon');
  const [mb, setMb] = useState(c.fileMB || 1);
  const [ebList, setEbList] = useState('');
  const [d2dCost, setD2dCost] = useState('');
  const [official, setOfficial] = useState('');
  const open = (u) => { if (api.bookOpenPlatform) api.bookOpenPlatform(u); };
  const pb = isKdp ? PC.kdpPaperback({ listUsd: num(list), pages: num(pages), trimWIn: num(trimW), trimHIn: num(trimH), channel }) : null;
  const cmp = isKdp && pb ? PC.compareOfficial(pb.cost, official) : { given: false };
  const eb = isKdp ? PC.kdpEbook({ listUsd: num(ebList), fileMB: num(mb), publicDomain: plan.publicDomain }) : null;
  const dp = !isKdp ? PC.d2dPrint({ listUsd: num(list), printCostUsd: num(d2dCost) }) : null;
  const row = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0' };
  const inp = (w) => ({ width: w, padding: '3px 5px' });
  return (
    <details open data-testid="price-calc" style={{ marginTop: 10, borderTop: '1px solid var(--line, #ddd)', paddingTop: 6 }}>
      <summary><b>💲 가격 · 인쇄비 · 인세 계산기</b> <span className="meta">(참고용 · 값 확인일 {PC.RATES.asOf})</span></summary>
      <div className="meta">값은 바뀝니다 — 등록 전에 공식 계산기와 대조하세요. <button className="ghost" onClick={() => open(isKdp ? 'https://kdp.amazon.com/en_US/royalty-calculator' : PC.RATES.d2d.calcUrl)}>🌐 공식 계산기 열기</button></div>
      {isKdp ? (<>
        <div className="bkchk" style={{ fontWeight: 700, marginTop: 6 }}>📕 종이책 (Amazon.com · 흑백)</div>
        <div style={row}>
          <label>정가 USD <input data-testid="pc-list" type="number" step="0.01" min="0" style={inp(80)} value={list} onChange={(e) => setList(e.target.value)} /></label>
          <label>쪽수 <input data-testid="pc-pages" type="number" step="2" min="0" style={inp(70)} value={pages} onChange={(e) => setPages(e.target.value)} /></label>
          <label>판형(인치) <input type="number" step="0.01" style={inp(60)} value={trimW} onChange={(e) => setTrimW(e.target.value)} />×<input type="number" step="0.01" style={inp(60)} value={trimH} onChange={(e) => setTrimH(e.target.value)} /></label>
          <label>유통 <select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="amazon">Amazon 마켓</option><option value="expanded">Expanded Distribution (40%)</option></select></label>
        </div>
        <div data-testid="pc-kdp-result">
          {pb.error ? <div className="bkwarn">⚠ {pb.error}</div> : (<>
            <div>인쇄비 <b data-testid="pc-cost">{usd(pb.cost)}</b> <span className="meta">({pb.pages}쪽 · {pb.large ? '대형' : '일반'} 판형 · 고정 ${pb.fixed}{pb.perPage ? ` + 쪽당 $${pb.perPage}` : ''}{pb.ambiguous ? ' · 110쪽은 두 구간에 적혀 높은 쪽 기준' : ''})</span></div>
            <div>인세율 <b>{Math.round(pb.rate * 100)}%</b> → 권당 인세 <b data-testid="pc-royalty" style={{ color: pb.royalty < 0 ? '#b00020' : undefined }}>{usd(pb.royalty)}</b> <span className="meta">= ({pb.rate}×정가) − 인쇄비</span></div>
            <div>최소 정가 <b data-testid="pc-min">{usd(pb.minList)}</b> <span className="meta">(인세가 0 이상이 되는 가장 낮은 가격)</span>{pb.belowMin ? <b style={{ color: '#b00020' }}> ⚠ 지금 정가로는 인쇄비를 못 덮습니다</b> : null}</div>
            <div style={row}><label>공식 계산기 인쇄비 USD <input data-testid="pc-official" type="number" step="0.01" style={inp(80)} value={official} onChange={(e) => setOfficial(e.target.value)} /></label>
              {cmp.given && <span data-testid="pc-compare" style={{ color: cmp.ok ? '#15803d' : '#b00020' }}>{cmp.ok ? '✅ 앱 계산과 같습니다' : `⚠ 앱 ${usd(cmp.app)} ≠ 공식 ${usd(cmp.official)} (차이 ${usd(cmp.diff)}) — 값이 바뀌었을 수 있습니다`}</span>}</div>
          </>)}
        </div>
        <div className="bkchk" style={{ fontWeight: 700, marginTop: 8 }}>📱 Kindle 전자책</div>
        <div style={row}>
          <label>정가 USD <input data-testid="pc-eblist" type="number" step="0.01" min="0" style={inp(80)} value={ebList} onChange={(e) => setEbList(e.target.value)} /></label>
          <label>ePub 크기 MB <input type="number" step="0.1" min="0" style={inp(70)} value={mb} onChange={(e) => setMb(e.target.value)} /></label>
          {plan.publicDomain && <span className="meta">퍼블릭 도메인 — 70% 옵션 불가</span>}
        </div>
        <div data-testid="pc-kdp-ebook">
          <div>35% 옵션: {eb.r35.ok ? <b>{usd(eb.r35.royalty)}</b> : <b style={{ color: '#b45309' }}>가격 범위 밖(${eb.r35.min}~${eb.r35.max})</b>}</div>
          <div>70% 옵션: {eb.r70.publicDomainBlocked ? <b style={{ color: '#b45309' }}>퍼블릭 도메인은 불가</b> : eb.r70.ok ? <b>{usd(eb.r70.royalty)} <span className="meta">(전송비 {usd(eb.r70.delivery)})</span></b> : <b style={{ color: '#b45309' }}>정가 ${eb.r70.band[0]}~${eb.r70.band[1]} 밖(35% 적용)</b>}</div>
        </div>
      </>) : (<>
        <div className="bkchk" style={{ fontWeight: 700, marginTop: 6 }}>📕 D2D Print</div>
        <div style={row}>
          <label>정가 USD <input data-testid="pc-list" type="number" step="0.01" min="0" style={inp(80)} value={list} onChange={(e) => setList(e.target.value)} /></label>
          <label>인쇄비 USD(공식 계산기 값) <input data-testid="pc-d2dcost" type="number" step="0.01" min="0" style={inp(80)} value={d2dCost} onChange={(e) => setD2dCost(e.target.value)} /></label>
        </div>
        <div data-testid="pc-d2d-result">
          {dp.needCost ? <div className="meta">D2D 는 인쇄비 식을 공개하지 않습니다 — 공식 「Print Price Calculator」 에서 쪽수·판형으로 인쇄비를 구해 위 칸에 넣으세요.</div>
            : <div>권당 인세 약 <b data-testid="pc-d2d-royalty">{usd(dp.low)} ~ {usd(dp.high)}</b> <span className="meta">(FAQ 「정가의 약 45% − 인쇄비」 — 문장이 모호해 두 해석을 범위로 표시 ⚠️)</span></div>}
          {dp.free && <div className="meta">⚠ 인쇄판은 무료 가격을 설정할 수 없습니다</div>}
        </div>
        <div className="meta">전자책은 D2D 수수료가 소매가의 약 10% 입니다(서점별 몫은 별도).</div>
      </>)}
    </details>
  );
}
