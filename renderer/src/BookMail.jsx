import React, { useEffect, useRef, useState } from 'react';
import api from './lib/ipc.js';

// 📬 부크크 메일 회신 — 버튼 하나(로이 2026-10-16 「심사 메일 찾아 클릭하고 내용 적고 보내면 Gmail 과 차이가 없다」):
//   판권지수정요청 메일 찾기 → ISBN·발행일 판권 입력 → PDF → 첨부 회신 발송까지 main `book-mail-auto` 가 한 번에 한다.
//   Gmail 연결(계정·JSON·로그인)은 ⚙ 설정 → 계정 탭의 <BookMailConnect>(로이 「좁은 곳에 너무 많은 입력」).
//   inbox = 원고를 열기 전 출판 첫 화면(로이 2026-11-02) — 메일을 먼저 찾고, 그 메일의 책 원고를 원고 폴더에서 찾아 열어 같은 처리를 한다(main `book-mail-inbox`).
//   열린 뒤엔 화면이 그 원고로 바뀌므로 결과는 onInboxDone 으로 넘겨 등록·유통 탭의 BookMail 이 initial 로 이어 보여 준다.
//   📮 자동으로 못 보낸 메일(첨부가 Gmail 한도를 넘음 · 추가 요청 등)은 팝업으로 알린다 — 로이가 Gmail 에서 직접 보낸다(로이 2026-11-03).
const manualOf = res => (res || []).filter(x => x.state === 'stop' && x.manual);
export default function BookMail({ dto, layout, setDto, setStatus, setBuilding, inbox, setQueue, onInboxDone, initial, presetName, popInitial, onPopShown }) {
  const [status, setMailStatus] = useState({}), [busy, setBusy] = useState(false), [error, setError] = useState(''), [auto, setAuto] = useState(initial || null);
  const [pop, setPop] = useState(() => (popInitial && manualOf(initial).length ? manualOf(initial) : null));
  useEffect(() => { if (pop && onPopShown) onPopShown(); }, []);   // 같은 결과로 탭을 다시 열 때 또 띄우지 않게
  const showPop = res => { const m = manualOf(res); if (m.length) setPop(m); };
  const scriptPath = dto ? dto.scriptPath : '';
  const currentPath = useRef(scriptPath); currentPath.current = scriptPath;
  const firstRef = useRef(true);
  useEffect(() => {
    let live = true; if (!firstRef.current || !initial) setAuto(null); firstRef.current = false; setError('');
    api.bookMail('status', {}).then(r => { if (live && r && !r.error) setMailStatus(r); });
    return () => { live = false; };
  }, [scriptPath]);
  const refreshStatus = () => api.bookMail('status', {}).then(r => { if (r && !r.error) setMailStatus(r); }).catch(() => {});
  async function sendInbox() {
    setBusy(true); setError(''); setAuto(null); setBuilding(true);
    try {
      const r = await api.bookMail('inbox', { presetName: presetName || null });   // 헤더 채널(원고 폴더)
      if (r?.error) throw Error(r.error);
      const res = r.results || [];
      setAuto(res);
      setStatus('📬 부크크 회신 — ' + res.map(x => `${x.label} ${x.note}`.trim()).join(' · '));
      if (r.queue && setQueue) setQueue(r.queue);
      if (r.dto) { if (onInboxDone) onInboxDone(res, r.dto.scriptPath); setDto(r.dto); }   // 원고가 열리면 이 칸은 사라진다 — 팝업은 등록·유통 탭의 칸이 initial 로 띄운다
      else showPop(res);
    } catch (e) { setError(e.message); setStatus('⚠ ' + e.message); refreshStatus(); }   // 만료면 main 이 연결을 끊었다 — 단추·안내를 바로 바꾼다
    finally { setBusy(false); setBuilding(false); }
  }
  async function send(resend) {
    const path = dto.scriptPath;
    setBusy(true); setError(''); setAuto(null); setBuilding(true);
    try {
      const r = await api.bookMail('auto', { layout, scriptPath: path, resend: !!resend });
      if (r?.error) throw Error(r.error);
      if (currentPath.current !== path) return;
      setAuto(r.results || []); showPop(r.results); if (r.dto) setDto(r.dto);
      setStatus('📬 부크크 회신 — ' + (r.results || []).map(x => `${x.label} ${x.note}`).join(' · '));
    } catch (e) { setError(e.message); setStatus('⚠ ' + e.message); refreshStatus(); }   // 만료면 main 이 연결을 끊었다 — 단추·안내를 바로 바꾼다
    finally { setBusy(false); setBuilding(false); }
  }
  const icon = s => s === 'sent' ? '✅' : s === 'stop' ? '⚠' : '·';
  return <div className="bkmail" data-testid="bk-mail">
    {inbox
      ? <button data-testid="bk-mail-inbox" disabled={busy || !status.connected} onClick={sendInbox}
        title="부크크 「판권지수정요청」 메일을 먼저 찾고, 메일 제목의 책 원고를 헤더 채널의 원고 폴더에서 찾아 엽니다 → ISBN·발행일을 판권에 넣고 PDF를 만들어 회신합니다(종이책 = 내지 PDF · 전자책 = 표지+본문 PDF). 답하지 않은 메일이 있는 책만 엽니다.">
        {busy ? '⏳ 메일 찾기 → 원고 열기 → 판권 입력 → PDF → 발송 중…' : '📬 부크크 메일 확인해서 판권 고쳐 회신'}</button>
      : <button data-testid="bk-mail-auto" disabled={busy || !status.connected} onClick={() => send(false)}
        title="부크크 「판권지수정요청」 메일을 종이책·전자책마다 찾아 ISBN·발행일을 판권에 넣고 PDF를 만들어 회신합니다(종이책 = 내지 PDF · 전자책 = 표지+본문 PDF).">
        {busy ? '⏳ 메일 찾기 → 판권 입력 → PDF → 발송 중…' : '📬 판권 수정해서 부크크에 회신'}</button>}
    {!status.connected && <div className="meta" data-testid="bk-mail-need">{status.expired ? '⚠ Gmail 연결이 만료됐습니다 — ⚙ 설정 → 👤 계정 탭에서 「Google 로그인」으로 다시 연결하세요.' : '⚙ 설정 → 계정 탭에서 Gmail을 먼저 연결하세요.'}</div>}
    {auto && <div className="bkmail-review" data-testid="bk-mail-auto-result">{auto.map((x, i) => <div key={i}>{icon(x.state)} <b>{x.label}</b> {x.isbn ? `ISBN ${x.isbn} · ${x.issueDate} — ` : ''}{x.note}</div>)}
      {!inbox && auto.some(x => x.state === 'done' && (!x.scriptPath || x.scriptPath === scriptPath)) && <button className="ghost" data-testid="bk-mail-resend" disabled={busy} onClick={() => send(true)}
        title="이미 회신한 부크크 메일에, 지금 판권으로 PDF를 다시 만들어 「바로잡아 다시 보내드립니다」 답장을 한 번 더 보냅니다">🔁 고친 판권으로 다시 보내기</button>}</div>}
    {error && <div className="bkwarn" role="alert">{error}</div>}
    {pop && <div className="modal-bg show" style={{ zIndex: 92 }} data-testid="bk-mail-manual">
      <div className="modal-card" style={{ width: 'min(560px, 92vw)' }}>
        <h3 style={{ marginTop: 0 }}>📮 직접 보내야 하는 메일 {pop.length}통</h3>
        <div className="meta" style={{ marginBottom: 10 }}>자동으로 보내지 못했습니다. Gmail 에서 그 메일에 답장하고 파일을 첨부해 주세요(큰 파일은 Gmail 이 Drive 링크로 바꿔 보냅니다).</div>
        {pop.map((x, i) => <div key={i} className="bkcard" style={{ marginBottom: 8 }}>
          <div><b>{x.label}</b> — {x.note}</div>
          {x.manual.file && <div className="meta">📎 {x.manual.name} ({x.manual.mb}MB)</div>}
          <div className="bkrow2" style={{ marginTop: 6 }}>
            <button className="ghost" onClick={() => api.bookMail('thread', { threadId: x.manual.threadId })}>✉ Gmail 에서 그 메일 열기</button>
            {x.manual.file && <button className="ghost" onClick={() => api.bookMail('reveal', { file: x.manual.file })}>📂 파일 위치 보기</button>}
          </div>
        </div>)}
        <div style={{ textAlign: 'right' }}><button onClick={() => setPop(null)}>확인</button></div>
      </div>
    </div>}
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
    {status.expired && <div className="bkwarn" data-testid="bk-mail-expired">⚠ 연결이 만료됐습니다 — 「Google 로그인」으로 다시 연결하세요. Google Cloud 의 OAuth 동의 화면이 「테스트」면 7일마다 끊깁니다(「프로덕션으로 게시」하면 끊기지 않습니다).</div>}
    <div className="frow"><label>출판 메일</label>
      {status.connected
        ? <><span style={{ flex: 1 }}><b>{status.email}</b> · Gmail 연결됨</span><button className="ghost" style={{ flex: '0 0 auto' }} disabled={busy} onClick={() => run('disconnect')}>연결 해제</button></>
        : <><input style={{ flex: 1 }} aria-label="출판 메일 계정" type="email" placeholder="Gmail 주소" value={email} disabled={busy} onChange={e => setEmail(e.target.value)} />
          <button className="ghost" style={{ flex: '0 0 auto' }} disabled={busy} onClick={() => run('import')}>연결 JSON 가져오기</button>
          <button style={{ flex: '0 0 auto' }} disabled={busy || !status.configured} onClick={() => run('connect', { email })}>Google 로그인</button></>}
    </div>
    <div className="meta">📖 출판 「📬 판권 수정해서 부크크에 회신」이 이 Gmail로 부크크 메일을 읽고 답장합니다. 처음 한 번: Google Cloud에서 Gmail API를 켜고, gmail.readonly·gmail.compose 범위의 데스크톱 OAuth JSON을 받아 가져오세요. OAuth 동의 화면은 「프로덕션으로 게시」로 두세요(「테스트」면 7일마다 다시 연결해야 합니다). <button className="ghost" onClick={() => api.bookMail('setup', {})}>Google Cloud 열기</button></div>
    {msg && <div className="bkwarn" role="alert">{msg}</div>}
  </div>;
}
