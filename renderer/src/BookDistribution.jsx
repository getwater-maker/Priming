// 📊 유통 현황 — 어디에 등록됐고 어디는 시도했으나 못 됐는지 + 내 책 링크(로이 2026-10-14).
//   부크크 = 외부유통(bookRetail) 화면을 크롬으로 읽어 온다(읽기만) · 아마존 KDP·D2D = 수동 기록(자동 조회 없음). core/book/retail-status.
import React, { useCallback, useEffect, useState } from 'react';
import api from './lib/ipc.js';

const KIND = { done: ['✅', '등록됨'], progress: ['⏳', '진행 중'], rejected: ['❌', '반려'], canceled: ['⛔', '취소'] };
const SITE = { kdp: ['Amazon KDP', 'https://kdp.amazon.com/'], d2d: ['Draft2Digital', 'https://draft2digital.com/'] };
const kst = (iso) => { try { return iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' (KST)' : ''; } catch (_) { return ''; } };

function ManualRow({ id, v, states, onSave }) {
  const [link, setLink] = useState(v.link || ''); const [note, setNote] = useState(v.note || '');
  useEffect(() => { setLink(v.link || ''); setNote(v.note || ''); }, [v.link, v.note]);
  const [label, url] = SITE[id];
  const st = v.state || 'none';
  const icon = st === 'done' ? '✅' : st === 'failed' ? '❌' : st === 'trying' ? '⏳' : '⬜';
  return (
    <div className="bkdist-row" data-testid={'dist-' + id}>
      <b>{icon} {label}</b>
      <select value={st} data-testid={'dist-state-' + id} onChange={(e) => onSave(id, { state: e.target.value })}>
        {states.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
      </select>
      <input className="grow" placeholder="내 책 링크(등록된 뒤 주소를 붙여 넣기)" value={link} data-testid={'dist-link-' + id}
        onChange={(e) => setLink(e.target.value)} onBlur={() => link !== (v.link || '') && onSave(id, { link })} />
      <input className="grow" placeholder="메모(시도 날짜·반려 사유 등)" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (v.note || '') && onSave(id, { note })} />
      {v.link ? <button className="ghost" onClick={() => api.bookOpenPlatform && /kdp\.amazon|draft2digital|bookk/.test(v.link) ? api.bookOpenPlatform(v.link) : window.open(v.link, '_blank')} title="내 책 링크 열기">🔗</button> : null}
      <button className="ghost" onClick={() => api.bookOpenPlatform && api.bookOpenPlatform(url)} title={label + ' 사이트를 브라우저로 엽니다(로그인·제출은 직접)'}>사이트 열기</button>
    </div>
  );
}

export default function BookDistribution({ dto, setStatus, busy }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { try { const r = await api.bookDistribution(); setD(r); } catch (e) { setD({ ok: false, error: e.message }); } }, []);
  useEffect(() => { load(); }, [load, dto && dto.scriptPath]);
  const refresh = async () => {
    setLoading(true); setStatus && setStatus('📊 부크크 유통 현황 읽는 중 — 크롬 창에서 로그인이 필요하면 직접 하세요');
    try {
      const r = await api.bookDistributionRefresh();
      setD(r); setStatus && setStatus(r && r.ok ? `📊 유통 현황 ${r.read}건 읽음` : '⚠ 유통 현황: ' + ((r && r.error) || ''));
    } catch (e) { setStatus && setStatus('⚠ 유통 현황: ' + e.message); }
    setLoading(false);
  };
  const saveManual = async (channel, patch) => { const r = await api.bookDistributionManual({ channel, ...patch }); if (r && r.ok) setD(r); else setStatus && setStatus('⚠ ' + ((r && r.error) || '저장 실패')); };
  if (!d) return <div className="bkform"><div className="meta">⏳ 읽는 중…</div></div>;
  if (!d.ok) return <div className="bkform"><div className="bkwarn">⚠ {d.error}</div></div>;
  const mine = d.items.filter((i) => i.mine); const others = d.items.filter((i) => !i.mine);
  const man = d.manual || {};
  const bookkLink = (man.bookk && man.bookk.link) || '';
  return (
    <div className="bkform bkdist" data-testid="dist-panel">
      <div className="bkrow" style={{ alignItems: 'center', gap: 8 }}>
        <b>📊 유통 현황</b><span className="grow" />
        <button className="ghost" data-testid="dist-refresh" disabled={loading || busy} onClick={refresh} title="크롬을 열어 부크크 「외부유통 판매시작」 화면을 읽어 옵니다 — 읽기만 하고 아무것도 누르지 않습니다(로그인은 직접)">{loading ? '⏳ 읽는 중…' : '🔄 부크크 현황 읽어오기'}</button>
        <button className="ghost" onClick={() => api.bookOpenPlatform && api.bookOpenPlatform(d.url)} title="부크크 외부유통 화면을 브라우저로 엽니다">부크크 유통 화면 열기</button>
      </div>
      <div className="meta" data-testid="dist-when">{d.fetchedAt ? `마지막으로 읽음: ${kst(d.fetchedAt)} · 이 책 ${mine.length}건 — ✅ ${d.summary.done} · ⏳ ${d.summary.progress} · ❌ ${d.summary.rejected}` : '아직 읽지 않았습니다 — 「부크크 현황 읽어오기」를 누르세요'}</div>
      <div className="bkzone">📚 부크크 외부유통 (이 책)</div>
      {mine.length === 0 && <div className="meta">{d.items.length ? `이 책(「${(d.titles[0] || '').slice(0, 30)}」)의 유통신청이 목록에 없습니다 — 도서명이 다르면 아래 「다른 책」에서 찾아 보세요` : '읽어 온 항목이 없습니다'}</div>}
      {mine.map((i, n) => {
        const [ic, nm] = KIND[i.kind] || ['•', i.status || '?'];
        return (
          <div key={n} className={'bkdist-item ' + (i.kind || '')} data-testid="dist-item">
            <span className="bkdist-st">{ic} {i.status || nm}</span>
            <b>{i.retailer || '(유통처 미확인)'}</b>
            <span className="meta">{i.type}{i.category ? ' · ' + i.category : ''} · 도서번호 {i.no} · 신청 {i.applied}{i.final && i.final !== i.applied ? ' · 최종 ' + i.final : ''}</span>
            {i.links && i.links[0] ? <button className="ghost" onClick={() => api.bookOpenPlatform && api.bookOpenPlatform(i.links[0].href)} title={i.links[0].href}>🔗</button> : null}
            {i.message ? <div className="meta" style={{ flexBasis: '100%' }}>{i.message}</div> : null}
          </div>
        );
      })}
      <div className="bkdist-row">
        <b>🔗 부크크 내 책 링크</b>
        <input className="grow" placeholder="부크크 서점의 내 책 주소를 붙여 넣기" defaultValue={bookkLink} key={bookkLink} data-testid="dist-link-bookk" onBlur={(e) => e.target.value !== bookkLink && saveManual('bookk', { link: e.target.value })} />
        {bookkLink ? <button className="ghost" onClick={() => api.bookOpenPlatform && api.bookOpenPlatform(bookkLink)}>열기</button> : null}
      </div>
      <div className="bkzone">🇺🇸 아마존 KDP · D2D (수동 기록 — 자동 조회 없음)</div>
      {['kdp', 'd2d'].map((id) => <ManualRow key={id} id={id} v={man[id] || {}} states={d.states} onSave={saveManual} />)}
      {others.length > 0 && (
        <details>
          <summary>다른 책의 유통신청 {others.length}건</summary>
          {others.map((i, n) => { const [ic] = KIND[i.kind] || ['•']; return <div key={n} className="meta">{ic} {i.status} · {i.title} ({i.type}) — {i.retailer} · 신청 {i.applied}</div>; })}
        </details>
      )}
    </div>
  );
}
