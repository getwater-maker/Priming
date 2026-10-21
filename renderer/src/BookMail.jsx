import React, { useEffect, useRef, useState } from 'react';
import api from './lib/ipc.js';

// 📬 부크크 메일 회신 — 버튼 하나(로이 2026-10-16 「심사 메일 찾아 클릭하고 내용 적고 보내면 Gmail 과 차이가 없다」):
//   판권지수정요청 메일 찾기 → ISBN·발행일 판권 입력 → PDF → 첨부 회신 발송까지 main `book-mail-auto` 가 한 번에 한다.
//   Gmail 연결(계정·JSON·로그인)은 ⚙ 설정 → 계정 탭의 <BookMailConnect>(로이 「좁은 곳에 너무 많은 입력」).
export default function BookMail({ dto, layout, setDto, setStatus, setBuilding }) {
  const [status, setMailStatus] = useState({}), [busy, setBusy] = useState(false), [error, setError] = useState(''), [auto, setAuto] = useState(null);
  const currentPath = useRef(dto.scriptPath); currentPath.current = dto.scriptPath;
  useEffect(() => {
    let live = true; setAuto(null); setError('');
    api.bookMail('status', {}).then(r => { if (live && r && !r.error) setMailStatus(r); });
    return () => { live = false; };
  }, [dto.scriptPath]);
  async function send(resend) {
    const path = dto.scriptPath;
    setBusy(true); setError(''); setAuto(null); setBuilding(true);
    try {
      const r = await api.bookMail('auto', { layout, scriptPath: path, resend: !!resend });
      if (r?.error) throw Error(r.error);
      if (currentPath.current !== path) return;
      setAuto(r.results || []); if (r.dto) setDto(r.dto);
      setStatus('📬 부크크 회신 — ' + (r.results || []).map(x => `${x.label} ${x.note}`).join(' · '));
    } catch (e) { setError(e.message); setStatus('⚠ ' + e.message); }
    finally { setBusy(false); setBuilding(false); }
  }
  const icon = s => s === 'sent' ? '✅' : s === 'stop' ? '⚠' : '·';
  return <div className="bkmail" data-testid="bk-mail">
    <button data-testid="bk-mail-auto" disabled={busy || !status.connected} onClick={() => send(false)}
      title="부크크 「판권지수정요청」 메일을 종이책·전자책마다 찾아 ISBN·발행일을 판권에 넣고 PDF를 만들어 회신합니다(종이책 = 내지 PDF · 전자책 = 표지+본문 PDF).">
      {busy ? '⏳ 메일 찾기 → 판권 입력 → PDF → 발송 중…' : '📬 판권 수정해서 부크크에 회신'}</button>
    {!status.connected && <div className="meta">⚙ 설정 → 계정 탭에서 Gmail을 먼저 연결하세요.</div>}
    {auto && <div className="bkmail-review" data-testid="bk-mail-auto-result">{auto.map(x => <div key={x.edition}>{icon(x.state)} <b>{x.label}</b> {x.isbn ? `ISBN ${x.isbn} · ${x.issueDate} — ` : ''}{x.note}</div>)}
      {auto.some(x => x.state === 'done') && <button className="ghost" data-testid="bk-mail-resend" disabled={busy} onClick={() => send(true)}
        title="이미 회신한 부크크 메일에, 지금 판권으로 PDF를 다시 만들어 「바로잡아 다시 보내드립니다」 답장을 한 번 더 보냅니다">🔁 고친 판권으로 다시 보내기</button>}</div>}
    {error && <div className="bkwarn" role="alert">{error}</div>}
  </div>;
}

// ⚙ 설정 → 계정 탭 「✉ 출판 메일(Gmail)」 — 한 번만 하는 연결
export function BookMailConnect() {
  const [status, setMailStatus] = useState({}), [email, setEmail] = useState(''), [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  useEffect(() => { api.bookMail('status', {}).then(r => { if (r && !r.error) { setMailStatus(r); if (r.email) setEmail(r.email); } }); }, []);
  async function run(action, args) {
    setBusy(true); setMsg('');
    try { const r = await api.bookMail(action, args || {}); if (r?.error) throw Error(r.error); if (!r.canceled) setMailStatus(r); }
    catch (e) { setMsg('⚠ ' + e.message); } finally { setBusy(false); }
  }
  return <div data-testid="bk-mail-connect">
    <div className="frow"><label>출판 메일</label>
      {status.connected
        ? <><span style={{ flex: 1 }}><b>{status.email}</b> · Gmail 연결됨</span><button className="ghost" style={{ flex: '0 0 auto' }} disabled={busy} onClick={() => run('disconnect')}>연결 해제</button></>
        : <><input style={{ flex: 1 }} aria-label="출판 메일 계정" type="email" placeholder="Gmail 주소" value={email} disabled={busy} onChange={e => setEmail(e.target.value)} />
          <button className="ghost" style={{ flex: '0 0 auto' }} disabled={busy} onClick={() => run('import')}>연결 JSON 가져오기</button>
          <button style={{ flex: '0 0 auto' }} disabled={busy || !status.configured} onClick={() => run('connect', { email })}>Google 로그인</button></>}
    </div>
    <div className="meta">📖 출판 「📬 판권 수정해서 부크크에 회신」이 이 Gmail로 부크크 메일을 읽고 답장합니다. 처음 한 번: Google Cloud에서 Gmail API를 켜고, 테스트 사용자·gmail.readonly·gmail.compose를 넣은 데스크톱 OAuth JSON을 받아 가져오세요. <button className="ghost" onClick={() => api.bookMail('setup', {})}>Google Cloud 열기</button></div>
    {msg && <div className="bkwarn" role="alert">{msg}</div>}
  </div>;
}
