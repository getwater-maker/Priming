import React, { useEffect, useRef, useState } from 'react';
import api from './lib/ipc.js';

export default function BookMail({ dto, layout, setDto, setStatus, setBuilding }) {
  const [status, setMailStatus] = useState({}), [edition, setEdition] = useState('print');
  const [email, setEmail] = useState('getwater@gmail.com'), [query, setQuery] = useState('부크크');
  const [messages, setMessages] = useState([]), [job, setJob] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [isbn, setIsbn] = useState(''), [date, setDate] = useState(''), [reviewed, setReviewed] = useState(false), [body, setBody] = useState('');
  const [kinds, setKinds] = useState(['interiorPdf']), [incoming, setIncoming] = useState(null);
  const currentPath = useRef(dto.scriptPath); currentPath.current = dto.scriptPath;
  const selection = useRef(0);
  function useJob(j) { setJob(j); setIsbn(j?.values?.isbn || ''); setDate(j?.values?.issueDate || ''); setBody(j?.body || ''); setReviewed(false); }
  async function call(action, args = {}) {
    const r = await api.bookMail(action, { ...args, edition, scriptPath: dto.scriptPath });
    if (r?.error) throw Error(r.error);
    return r || {};
  }
  async function run(fn) {
    const path = dto.scriptPath, rev = selection.current;
    setBusy(true); setError('');
    try { await fn(() => currentPath.current === path && selection.current === rev); }
    catch (e) { setError(e.message); setStatus('⚠ ' + e.message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const rev = ++selection.current; let live = true;
    setMessages([]); useJob(null); setIncoming(null); setError(''); setKinds(edition === 'ebook' ? ['ebookPdf'] : ['interiorPdf']);
    call('status').then(r => { if (live && selection.current === rev) { setMailStatus(r); useJob(r.job); if (r.email) setEmail(r.email); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [dto.scriptPath, edition]);
  useEffect(() => {
    if (!status.connected || !job?.original || busy) return;
    let live = true, pending = false;
    const t = setInterval(async () => {
      if (pending) return; pending = true;
      try { const r = await call('poll'); if (live && r.changed) setIncoming(r.message); }
      catch (e) { if (live) setError(e.message); } finally { pending = false; }
    }, 60000);
    return () => { live = false; clearInterval(t); };
  }, [status.connected, job?.original?.id, busy, dto.scriptPath, edition]);
  const loadJob = r => { if (r.job) useJob(r.job); if (r.dto) setDto(r.dto); };
  const fileKinds = edition === 'ebook' ? [['ebookPdf', '표지+본문 PDF'], ['ebookBodyPdf', '본문 PDF'], ['ebookCoverPdf', '표지 PDF']] : [['interiorPdf', '내지 PDF'], ['coverPdf', '표지 PDF'], ['fullPdf', '표지+내지 PDF']];
  return <details className="bkmail" data-testid="bk-mail">
    <summary>✉ 메일로 재제출 {job?.state === 'sent' ? '· 발송 완료' : job ? '· 연결됨' : ''}</summary>
    <div className="meta">기존 Gmail을 사용합니다. 연결한 심사 메일의 새 답장은 이 패널이 열린 동안 1분마다 확인합니다.</div>
    <div className="bkactions">
      <input aria-label="출판 메일 계정" type="email" value={email} disabled={busy || status.connected} onChange={e => setEmail(e.target.value)} />
      <button className="ghost" disabled={busy} onClick={() => run(async valid => { const r = await call('import'); if (valid() && !r.canceled) setMailStatus(r); })}>연결 JSON 가져오기</button>
      <button disabled={busy || !status.configured} onClick={() => run(async valid => { const r = await call('connect', { email }); if (valid()) setMailStatus(r); })}>{status.connected ? '다시 연결' : 'Google 로그인'}</button>
      {status.connected && <button className="ghost" disabled={busy} onClick={() => run(async () => { setMailStatus(await call('disconnect')); useJob(null); setMessages([]); })}>연결 해제</button>}
    </div>
    {!status.connected && <details className="meta"><summary>처음 한 번: 무료 Google 연결 설정</summary>
      <p>Google Cloud에서 출판 메일용 프로젝트를 만들고 Gmail API를 사용 설정합니다. Google Auth Platform에서 대상은 외부, 테스트 사용자는 연결할 Gmail 주소로 지정하고, 데이터 액세스에 gmail.readonly·gmail.compose를 추가합니다. 데스크톱 앱 OAuth 클라이언트를 만든 뒤 JSON을 내려받아 위에서 가져오세요.</p>
      <p>읽기 권한은 Gmail 전체에 적용됩니다. Priming은 검색한 메일과 직접 연결한 대화만 처리하며, 본문에 적힌 명령이나 링크를 실행하지 않습니다. 연결 정보와 처리 기록은 이 Windows 사용자 계정으로 암호화합니다. 테스트 상태의 Google 연결은 만료되면 재로그인이 필요할 수 있습니다.</p>
      <button className="ghost" onClick={() => run(() => call('setup'))}>Google Cloud 연결 설정 열기</button>
    </details>}
    {status.connected && <>
      <div className="meta">연결 계정: {status.email}</div>
      <div className="bkactions">
        <select aria-label="재제출 판" value={edition} disabled={busy} onChange={e => setEdition(e.target.value)}><option value="print">종이책</option><option value="ebook">전자책</option></select>
        <input aria-label="심사 메일 검색" value={query} disabled={busy} onChange={e => setQuery(e.target.value)} placeholder="책 제목 또는 from:업체주소" />
        <button disabled={busy} onClick={() => run(async valid => { const r = await call('search', { query }); if (valid()) setMessages(r.messages || []); })}>심사 메일 찾기</button>
      </div>
      <div className="bkmail-results">{messages.map(m => <button className="ghost" key={m.id} disabled={busy} onClick={() => run(async valid => { const r = await call('link', { id: m.id }); if (valid()) { loadJob(r); setIncoming(null); } })}><b>{m.subject}</b><small>{m.from} · {m.date}</small></button>)}</div>
      {incoming && <div className="bkwarn">새 답장이 도착했습니다: {incoming.subject}<button disabled={busy} onClick={() => run(async valid => { const r = await call('link', { id: incoming.id }); if (valid()) { loadJob(r); setIncoming(null); } })}>새 답장 연결</button></div>}
      {job && <>
        <b>{job.original.subject}</b><div className="meta">{job.original.from}</div>
        <details><summary>업체 요청 원문 확인</summary><pre className="bkmail-original">{job.original.text}</pre></details>
        <div className="meta">{job.values?.note}</div>
        <label>ISBN<input aria-label="재제출 ISBN" value={isbn} disabled={busy} onChange={e => setIsbn(e.target.value)} /></label>
        <label>발행일<input aria-label="재제출 발행일" value={date} disabled={busy} onChange={e => setDate(e.target.value)} placeholder="메일에 명시된 발행일" /></label>
        <div className="bkactions">{fileKinds.map(([k, label]) => <label key={k}><input type="checkbox" checked={kinds.includes(k)} disabled={busy} onChange={e => setKinds(e.target.checked ? [...kinds, k] : kinds.filter(x => x !== k))} />{label}</label>)}</div>
        <label>회신 문구<textarea aria-label="재제출 회신 문구" rows={4} value={body} disabled={busy} onChange={e => setBody(e.target.value)} placeholder="비워 두면 책·판·ISBN·발행일을 넣은 답장을 만듭니다" /></label>
        <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={e => setReviewed(e.target.checked)} />이 메일의 책·권·종이책/전자책과 추가 수정 요청을 확인했습니다.</label>
        <button data-testid="bk-mail-prepare" disabled={busy || !reviewed || !kinds.length || ['sent', 'unknown', 'sending'].includes(job.state)} onClick={() => run(async valid => {
          setBuilding(true);
          try { const r = await call('prepare', { isbn, issueDate: date, kinds, reviewed, body, layout }); if (valid()) { loadJob(r); setStatus('✉ 수정 PDF 생성 및 Gmail 회신 초안 준비 완료'); } }
          finally { setBuilding(false); }
        })}>{busy ? '진행 중…' : '수정 반영 → PDF 생성 → 회신 초안 만들기'}</button>
        {job.draftId && <div className="bkmail-review" data-testid="bk-mail-review">
          <b>발송 전 확인 · {job.state === 'sent' ? '발송 완료' : job.state === 'unknown' || job.state === 'sending' ? '발송 결과 확인 필요' : '초안 준비됨'}</b>
          <div>받는 사람: {job.to}</div><div>{edition === 'ebook' ? '전자책' : '종이책'} · ISBN {job.values.isbn} · {job.values.issueDate}</div>
          {job.files?.map(f => <div key={f.name}>📎 {f.name} ({(f.bytes / 1048576).toFixed(1)}MB)</div>)}
          <pre className="bkmail-original">{job.body}</pre>
          <div className="bkactions"><button data-testid="bk-mail-send" disabled={busy || job.state !== 'draft'} onClick={() => run(async valid => { const r = await call('send', { draftId: job.draftId }); if (valid()) loadJob(r); })}>확인한 초안 발송</button>
          <button className="ghost" disabled={busy} onClick={() => run(() => call('open'))}>Gmail 초안 열기</button>
          <button className="ghost" disabled={busy} onClick={() => run(async valid => { const r = await call('reconcile'); if (valid()) loadJob(r); })}>보낸편지함 대조</button></div>
          {job.note && <div className="bkwarn">{job.note}</div>}
        </div>}
      </>}
    </>}
    {error && <div className="bkwarn" role="alert">{error}</div>}
  </details>;
}
