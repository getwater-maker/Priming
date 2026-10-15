import React, { useEffect, useState } from 'react';

// 🔐 회원 로그인 관문(v0.9.26 · 로이 2026-10-15 「결제 회원만 사용」 · docs/회원제-설계.md §3)
//   회원 확인을 통과해야 App 을 그린다(App 의 처음 IPC 들이 로그인 전에 돌지 않게 — main 도 LIC_OPEN 밖 IPC 를 거부한다).
//   개발 실행·E2E(enforced=false)는 바로 통과. 토큰은 main 에만 있다 — 여기선 이메일·상태만 본다.
const REASON = {
  bad_login: '이메일 또는 비밀번호가 맞지 않습니다.',
  not_member: '이 계정에는 Priming 이용 기간이 없습니다. primingwave.com 에서 가입·입금 안내를 확인하세요.',
  expired: '이용 기간이 끝났습니다. primingwave.com 에서 기간을 연장하세요.',
  device_limit: '이 계정은 이미 PC 2대에서 쓰고 있습니다. primingwave.com 「내 기기」에서 쓰지 않는 PC 를 해제한 뒤 다시 시도하세요.',
  offline: '인터넷에 연결할 수 없습니다(마지막 확인 뒤 7일이 지났습니다). 연결한 뒤 다시 시도하세요.',
  server: '회원 서버에 잠시 연결할 수 없습니다. 잠시 뒤 다시 시도하세요.',
  error: '회원 확인 중 문제가 생겼습니다. 다시 시도하세요.',
  invalid_device: '이 PC 의 기기 정보가 올바르지 않습니다. 다시 시도하세요.',
};

export default function LicenseGate({ children }) {
  const api = window.api;
  const [st, setSt] = useState(null);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => { try { const s = await api.licenseState(); setSt(s); if (s && s.email) setEmail(s.email); } catch (e) { setSt({ ok: false, enforced: true, reason: 'error' }); } })(); }, []);
  if (!st) return <div className="licgate"><div className="liccard"><b>🎬 Priming</b><p className="licmsg">회원 확인 중…</p></div></div>;
  if (st.ok) return children;

  async function go(fn) { setBusy(true); try { const s = await fn(); setSt(s); } catch (e) { setSt({ ...st, ok: false, reason: 'error' }); } finally { setBusy(false); } }
  const submit = () => { if (!busy && email.trim() && pw) go(() => api.licenseLogin(email.trim(), pw)); };
  const loggedIn = st.reason && st.reason !== 'logged_out' && st.reason !== 'bad_login' && st.email;
  return (
    <div className="licgate" data-testid="license-gate">
      <div className="liccard">
        <h2>🎬 Priming 로그인</h2>
        <p className="licsub">primingwave.com 회원 이메일과 <b>앱 비밀번호</b>로 로그인하세요.</p>
        {st.reason && st.reason !== 'logged_out' && <p className="licerr" data-testid="license-msg">{REASON[st.reason] || st.reason}</p>}
        {st.reason === 'device_limit' && st.devices && st.devices.length > 0 && (
          <ul className="licdev">{st.devices.map((d, i) => <li key={i}>🖥 {d.name || '(이름 없음)'}{d.lastSeen ? ` — 마지막 사용 ${String(d.lastSeen).slice(0, 10)}` : ''}</li>)}</ul>
        )}
        {!loggedIn && (<>
          <input data-testid="license-email" type="email" placeholder="이메일" value={email} autoFocus={!email} onChange={(e) => setEmail(e.target.value)} />
          <input data-testid="license-password" type="password" placeholder="앱 비밀번호" value={pw} autoFocus={!!email}
            onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }} />
          <button data-testid="license-login" disabled={busy || !email.trim() || !pw} onClick={submit}>{busy ? '확인 중…' : '로그인'}</button>
        </>)}
        {loggedIn && (<div className="licrow">
          <button data-testid="license-retry" disabled={busy} onClick={() => go(() => api.licenseRecheck())}>{busy ? '확인 중…' : '다시 확인'}</button>
          <button className="ghost" disabled={busy} onClick={() => go(() => api.licenseLogout())}>다른 계정으로</button>
        </div>)}
        <p className="licfoot">
          처음이거나 구글로 가입하셨다면 사이트의 「🖥 내 기기」에서 앱 비밀번호를 먼저 정하세요.{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); api.licenseOpenSite(); }}>primingwave.com 열기</a>
        </p>
      </div>
    </div>
  );
}
