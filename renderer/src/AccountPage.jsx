import React, { useEffect, useState } from 'react';
import api from './lib/ipc.js';

/**
 * 👤 계정·크레딧 화면(Lab · Vrew 계정 화면의 틀 — 메뉴 줄 5단계)
 *   계정 카드(이름·이메일·설정·로그아웃) → 내 요금제 → 내 크레딧(반원 게이지 · 새로고침) → 크레딧 사용 내역
 *   ⛔ Vrew 의 계정·요금은 따라 하지 않는다 — 값은 전부 우리 회원제(license-state · points)에서 온다.
 *   ⛔ 회원 화면에 kie 이름을 넣지 않는다(관리자만 「🧩 kie 크레딧」 칸이 있다).
 */
const f = (v) => (v == null ? '-' : Number(v).toLocaleString());

// 반원 게이지 — pct 0..1. 길이는 stroke-dasharray 로 정한다.
export function Gauge({ pct, label, sub }) {
  const R = 100, C = Math.PI * R;
  const p = Math.max(0, Math.min(1, Number(pct) || 0));
  return (
    <div className="acct-gauge" data-testid="acct-gauge" data-pct={p.toFixed(3)}>
      <svg viewBox="0 0 220 125" role="img" aria-label={`크레딧 ${Math.round(p * 100)}%`}>
        <path d="M10 112 A100 100 0 0 1 210 112" fill="none" stroke="var(--line-2)" strokeWidth="18" strokeLinecap="round" />
        <path d="M10 112 A100 100 0 0 1 210 112" fill="none" stroke="var(--sky)" strokeWidth="18" strokeLinecap="round" strokeDasharray={`${(C * p).toFixed(1)} ${C.toFixed(1)}`} />
      </svg>
      <div className="acct-gauge-n"><b data-testid="acct-gauge-n">{label}</b><span>{sub}</span></div>
    </div>
  );
}

export default function AccountPage({ points, licKind, refreshPoints, onClose, onSettings, onLogout }) {
  const [lic, setLic] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; (async () => { try { const s = await api.licenseState(); if (live) setLic(s); } catch (_) {} })(); return () => { live = false; }; }, []);
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const reload = async () => { setBusy(true); try { await refreshPoints(false); setLic(await api.licenseState()); } finally { setBusy(false); } };
  const enforced = !!(lic && lic.enforced);
  const admin = !!(lic && lic.admin);
  const email = (lic && lic.email) || '';
  const name = email ? email.split('@')[0] : (enforced ? '(로그인 안 됨)' : '개발 실행');
  const granted = points && points.granted != null ? Number(points.granted) : 0;
  const remaining = points && points.remaining != null ? Number(points.remaining) : 0;
  const pct = granted > 0 ? remaining / granted : 0;
  const exp = admin ? '제한 없음(관리자)' : (lic && lic.expiresAt ? String(lic.expiresAt).slice(0, 10) + ' 까지' : '기한 없음');
  return (
    <div className="acct-page" data-testid="acct-page">
      <div className="acct-col">
        <div className="acct-top"><button className="ghost" data-testid="acct-close" onClick={onClose}>✕ 닫기</button></div>
        <section className="acct-card" data-testid="acct-card">
          <div className="acct-avatar" aria-hidden="true">{(name || '?').slice(0, 1).toUpperCase()}</div>
          <div className="acct-who"><b data-testid="acct-name">{name}</b><span className="meta" data-testid="acct-email">{email || (enforced ? '' : '회원 확인을 하지 않는 실행입니다')}</span></div>
          <button className="ghost" data-testid="acct-settings" onClick={onSettings} title="통합 설정 — 계정 · API 키 · 폴더">⚙ 설정</button>
          {enforced && <button className="ghost" data-testid="acct-logout" onClick={onLogout}>로그아웃</button>}
        </section>

        <h3 className="acct-h">내 요금제</h3>
        <section className="acct-card acct-plan" data-testid="acct-plan">
          <div><b>{admin ? '관리자' : (enforced ? '회원' : '개발')}</b><span className="meta" data-testid="acct-expiry">{exp}</span></div>
          {enforced && <button className="ghost" data-testid="acct-devices" onClick={() => api.licenseOpenSite()} title="primingwave.com 「🖥 내 기기」">내 기기 관리</button>}
        </section>

        <div className="acct-hrow"><h3 className="acct-h">내 크레딧</h3><button className="ghost" data-testid="acct-refresh" disabled={busy} onClick={reload}>{busy ? '⏳' : '⟳'} 새로고침</button></div>
        <section className="acct-card acct-credit" data-testid="acct-credit">
          <div className="acct-credit-h">잔여 크레딧</div>
          <Gauge pct={pct} label={f(remaining)} sub="잔여" />
          <div className="acct-scale"><span>0</span><span data-testid="acct-granted">{f(granted)}</span></div>
          <div className="meta acct-note">🖥 내 PC(로컬)와 내 API 키로 만드는 것은 크레딧 없이 쓸 수 있습니다.</div>
          {admin && licKind && <div className="acct-admin" data-testid="acct-kie">🧩 kie 크레딧 남은 <b>{licKind.kie == null ? (licKind.kieNoKey ? '키 없음' : '-') : f(licKind.kie)}</b><span className="meta"> — 관리자 화면에만 보입니다</span></div>}
        </section>

        <h3 className="acct-h">크레딧 사용 내역</h3>
        <section className="acct-card acct-usage" data-testid="acct-usage">
          <div className="meta">사용 내역은 서버 대행이 연결되면 여기에 날짜별로 나옵니다(지금은 준비 중). 지급·차감 기준은 회원제 설계 문서를 따릅니다.</div>
        </section>
      </div>
    </div>
  );
}
