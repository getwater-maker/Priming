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
  bad_email: '이메일 주소를 확인하세요.',
  weak_password: '비밀번호는 6자 이상으로 정하세요.',
  already_registered: '이미 가입된 이메일입니다. 「로그인」으로 들어가세요. (구글로 가입하셨다면 사이트 「내 기기」에서 앱 비밀번호를 정하세요.)',
  confirm_mail: '가입 확인 메일을 보냈습니다. 메일의 확인 링크를 누른 뒤 「로그인」으로 들어오세요. 이미 가입한 주소라면 메일이 오지 않으니 「로그인」을 눌러 보세요.',
  rate_limited: '시도가 너무 많습니다. 잠시 뒤 다시 시도하세요.',
};
const CODE_REASON = {
  invalid_code: '가입 코드가 맞지 않습니다. 받은 코드를 다시 확인하세요.',
  already_used: '이미 사용한 코드입니다.',
  code_expired: '사용 기간이 지난 코드입니다. 새 코드를 받으세요.',
  rate_limited: '코드를 너무 많이 틀렸습니다. 잠시 뒤 다시 시도하세요.',
  redeem_unavailable: '가입 코드 기능이 아직 서버에 준비되지 않았습니다. 사이트에서 이용 기간을 받으세요.',
  no_code: '가입 코드를 입력하세요.',
  logged_out: '로그인이 풀렸습니다. 다시 로그인하세요.',
  offline: '인터넷에 연결할 수 없습니다.',
  server: '서버에 잠시 연결할 수 없습니다. 다시 시도하세요.',
};
const FORM_REASONS = new Set(['bad_email', 'weak_password', 'already_registered', 'confirm_mail', 'rate_limited']);

export default function LicenseGate({ children }) {
  const api = window.api;
  const [st, setSt] = useState(null);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('login');   // 'login' | 'signup'
  const [pw2, setPw2] = useState('');
  const [code, setCode] = useState('');
  const [agree, setAgree] = useState(false);
  useEffect(() => { (async () => { try { const s = await api.licenseState(); setSt(s); if (s && s.email) setEmail(s.email); } catch (e) { setSt({ ok: false, enforced: true, reason: 'error' }); } })(); }, []);
  if (!st) return <div className="licgate"><div className="liccard"><b>🎬 Priming</b><p className="licmsg">회원 확인 중…</p></div></div>;
  if (st.ok) return children;

  async function go(fn) { setBusy(true); try { const s = await fn(); setSt(s); } catch (e) { setSt({ ...st, ok: false, reason: 'error' }); } finally { setBusy(false); } }
  const submit = () => { if (!busy && email.trim() && pw) go(() => api.licenseLogin(email.trim(), pw)); };
  const loggedIn = st.reason && st.reason !== 'logged_out' && st.reason !== 'bad_login' && !FORM_REASONS.has(st.reason) && st.email;
  const canSignup = !busy && email.trim() && pw.length >= 6 && pw === pw2 && agree;
  const signup = () => { if (canSignup) go(() => api.licenseSignup(email.trim(), pw, code.trim())); };
  const redeem = () => { if (!busy && code.trim()) go(() => api.licenseRedeem(code.trim())); };
  const needCode = loggedIn && (st.reason === 'not_member' || st.reason === 'expired');
  const sw = (m) => { setMode(m); setPw(''); setPw2(''); };
  return (
    <div className="licgate" data-testid="license-gate">
      <div className="liccard">
        <h2>🎬 Priming {mode === 'signup' && !loggedIn ? '회원가입' : '로그인'}</h2>
        {!loggedIn && <div className="lictabs">
          <button className={mode === 'login' ? 'on' : ''} data-testid="license-tab-login" onClick={() => sw('login')}>로그인</button>
          <button className={mode === 'signup' ? 'on' : ''} data-testid="license-tab-signup" onClick={() => sw('signup')}>회원가입</button>
        </div>}
        {mode === 'signup' && !loggedIn
          ? <p className="licsub">이메일과 비밀번호만 정하면 바로 가입됩니다. 입금 확인 뒤 받은 <b>가입 코드</b>를 넣으면 이용 기간이 자동으로 시작됩니다.</p>
          : <p className="licsub">가입한 이메일과 <b>비밀번호</b>로 로그인하세요.</p>}
        {st.reason && st.reason !== 'logged_out' && <p className="licerr" data-testid="license-msg">{REASON[st.reason] || st.reason}</p>}
        {st.redeemReason && <p className="licerr" data-testid="license-code-msg">{CODE_REASON[st.redeemReason] || st.redeemReason}</p>}
        {st.redeemDays != null && <p className="licok">가입 코드 적용 — {st.redeemDays}일 이용 기간이 시작됩니다.</p>}
        {st.reason === 'device_limit' && st.devices && st.devices.length > 0 && (
          <ul className="licdev">{st.devices.map((d, i) => <li key={i}>🖥 {d.name || '(이름 없음)'}{d.lastSeen ? ` — 마지막 사용 ${String(d.lastSeen).slice(0, 10)}` : ''}</li>)}</ul>
        )}
        {!loggedIn && mode === 'signup' && (<>
          <input data-testid="license-email" type="email" placeholder="이메일" value={email} autoFocus onChange={(e) => setEmail(e.target.value)} />
          <input data-testid="license-password" type="password" placeholder="비밀번호 (6자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} />
          <input data-testid="license-password2" type="password" placeholder="비밀번호 확인" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          {pw2 && pw !== pw2 && <p className="licwarn">비밀번호가 서로 다릅니다.</p>}
          <input data-testid="license-code" placeholder="가입 코드 (입금 확인 뒤 받은 코드)" value={code} onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) signup(); }} />
          <label className="licagree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="license-agree" /> 이용약관·개인정보 처리방침(오류 로그 자동 전송 포함)에 동의합니다. <a href="#" onClick={(e) => { e.preventDefault(); api.licenseOpenSite(); }}>보기</a></label>
          <button data-testid="license-signup" disabled={!canSignup} onClick={signup}>{busy ? '가입 중…' : '회원가입'}</button>
        </>)}
        {!loggedIn && mode === 'login' && (<>
          <input data-testid="license-email" type="email" placeholder="이메일" value={email} autoFocus={!email} onChange={(e) => setEmail(e.target.value)} />
          <input data-testid="license-password" type="password" placeholder="앱 비밀번호" value={pw} autoFocus={!!email}
            onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }} />
          <button data-testid="license-login" disabled={busy || !email.trim() || !pw} onClick={submit}>{busy ? '확인 중…' : '로그인'}</button>
        </>)}
        {needCode && (<>
          <input data-testid="license-code" placeholder="가입 코드 (입금 확인 뒤 받은 코드)" value={code} onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) redeem(); }} />
          <button data-testid="license-redeem" disabled={busy || !code.trim()} onClick={redeem}>{busy ? '확인 중…' : '가입 코드로 이용 시작'}</button>
        </>)}
        {loggedIn && (<div className="licrow">
          <button data-testid="license-retry" disabled={busy} onClick={() => go(() => api.licenseRecheck())}>{busy ? '확인 중…' : '다시 확인'}</button>
          <button className="ghost" disabled={busy} onClick={() => go(() => api.licenseLogout())}>다른 계정으로</button>
        </div>)}
        <p className="licfoot">
          구글로 가입하셨다면 사이트의 「🖥 내 기기」에서 앱 비밀번호를 먼저 정하세요.{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); api.licenseOpenSite(); }}>primingwave.com 열기</a>
        </p>
      </div>
    </div>
  );
}
