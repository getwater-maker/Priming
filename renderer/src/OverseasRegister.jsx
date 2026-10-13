// 🇺🇸 KDP·D2D 등록 복사 도우미(R27) — 항목별 값 + 복사 버튼 + 사이트 칸 이름 + 체크리스트. 자동 입력·제출은 없다(계정·세금·ISBN·가격·제출은 로이).
import React, { useCallback, useEffect, useState } from 'react';
import api from './lib/ipc.js';
import PriceCalc from './PriceCalc.jsx';

const SITE_URL = { kdp: 'https://kdp.amazon.com/', d2d: 'https://draft2digital.com/' };
const ICON = { ok: '✅', warn: '⚠', error: '❌', info: 'ℹ', manual: '🔏' };

function copy(text) { try { return navigator.clipboard.writeText(String(text == null ? '' : text)); } catch (_) { return Promise.resolve(); } }

export default function OverseasRegister({ dto, setStatus }) {
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [tick, setTick] = useState(0);
  const key = (id) => 'pm.ovrConfirm.' + ((dto && dto.scriptPath) || '') + '.' + id;
  const confirmed = (id) => { try { return localStorage.getItem(key(id)) === '1'; } catch (_) { return false; } };
  const load = useCallback(async () => {
    setBusy(true);
    try { const r = await api.bookOverseasRegister({}); setPlan(r && !r.error ? r : { error: (r && r.error) || '응답 없음' }); } catch (e) { setPlan({ error: e.message }); }
    setBusy(false);
  }, []);
  useEffect(() => { load(); }, [load, dto && dto.scriptPath, dto && dto.platformId]);
  const doCopy = async (id, text) => { await copy(text); setCopied(id); setTimeout(() => setCopied((c) => (c === id ? '' : c)), 1200); if (setStatus) setStatus('📋 복사했습니다 — 사이트의 해당 칸에 붙여 넣으세요'); };
  if (!plan) return <div className="bkform"><div className="meta">{busy ? '⏳ 읽는 중…' : ''}</div></div>;
  if (plan.error) return <div className="bkform"><div className="bkwarn">⚠ {plan.error}</div><button className="ghost" onClick={load}>🔄 다시 읽기</button></div>;
  const label = plan.platformId === 'kdp' ? 'Amazon KDP' : 'Draft2Digital';
  const bad = plan.checklist.filter((c) => (c.state === 'manual' ? !confirmed(c.id) : c.state === 'warn' || c.state === 'error'));
  return (
    <div className="bkform" data-testid="ovr-panel">
      <div className="bkrow" style={{ alignItems: 'center', gap: 8 }}>
        <b>🇺🇸 {label} 등록 복사 도우미</b>
        <span className="grow" />
        <button className="ghost" data-testid="ovr-open" onClick={() => api.bookOpenPlatform && api.bookOpenPlatform(SITE_URL[plan.platformId])} title="공식 사이트를 브라우저로 엽니다(로그인·제출은 직접)">🌐 사이트 열기</button>
        <button className="ghost" disabled={busy} onClick={load} title="등록정보 파일을 다시 읽습니다">🔄</button>
      </div>
      <div className="meta">앱은 값을 보여 주고 <b>복사</b>만 합니다 — 계정 생성·세금 인터뷰·ISBN·가격 입력·<b>제출은 직접</b> 하세요. 사이트 칸 이름은 공식 도움말 기준(⚠️ 로그인 화면 확인 전)입니다.</div>
      <div className="meta" data-testid="ovr-file">{plan.file ? `📄 등록정보 파일: ${plan.file}` : '⚠ 등록정보 파일이 없어 원고 메타로 채웠습니다 — 기준\\등록\\<작품>.' + (plan.platformId === 'kdp' ? 'KDP' : 'D2D') + '등록정보.md'}</div>
      <details open data-testid="ovr-checklist">
        <summary>{bad.length ? `⚠ 체크리스트 — 확인할 것 ${bad.length}개` : '✅ 체크리스트 — 모두 확인'}</summary>
        {plan.checklist.map((c) => {
          const man = c.state === 'manual';
          const st = man ? (confirmed(c.id) ? 'ok' : 'manual') : c.state;
          return (
            <div key={c.id} className={'bkchk ' + st} data-testid={'ovr-chk-' + c.id} data-state={st} style={{ padding: '3px 0' }}>
              {ICON[st] || '•'} <b>{c.label}</b> <span className="meta">{c.detail}</span>
              {man && <label style={{ marginLeft: 8 }}><input type="checkbox" checked={confirmed(c.id)} data-testid={'ovr-confirm-' + c.id} onChange={(e) => { try { localStorage.setItem(key(c.id), e.target.checked ? '1' : '0'); } catch (_) {} setTick((v) => v + 1); }} /> 확인했습니다</label>}
            </div>
          );
        })}
      </details>
      <PriceCalc plan={plan} />
      <div style={{ marginTop: 8 }}>
        <b>항목별 값</b> <span className="meta">(사이트 화면 순서)</span>
        {plan.fields.map((f) => (
          <div key={f.key} className="bkfield" data-testid={'ovr-field-' + f.key} style={{ borderTop: '1px solid var(--line, #ddd)', padding: '6px 0' }}>
            <div className="bkrow" style={{ alignItems: 'center', gap: 6 }}>
              <b>{f.label}</b>
              <span className="meta" title={f.step}>→ {f.site}</span>
              <span className="grow" />
              {f.from === 'meta' && <span className="meta" title="등록정보 파일에 없어 원고 메타에서 가져왔습니다">(원고 메타)</span>}
              {f.value && <button className="ghost" data-testid={'ovr-copy-' + f.key} onClick={() => doCopy(f.key, f.value)}>{copied === f.key ? '✓ 복사됨' : '📋 복사'}</button>}
            </div>
            {f.hint && <div className="meta">{f.hint}</div>}
            {f.list && f.list.length > 0
              ? f.list.map((v, i) => (<div key={i} className="bkrow" style={{ gap: 6 }}><span style={{ flex: 1, wordBreak: 'break-word' }}>{i + 1}. {v}</span><button className="ghost" onClick={() => doCopy(f.key + i, v)}>{copied === f.key + i ? '✓' : '📋'}</button></div>))
              : (f.value ? <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{f.value}</div> : <div className="meta" style={{ color: '#b45309' }}>(비어 있음 — 등록정보 파일에 적어 주세요)</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}
