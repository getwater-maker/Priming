'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const M = require('./resubmit-mail');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function install({ ipcMain, dialog, shell, win, context, setMeta, build, client, ask, log = () => {} }) {
  let busy = false;
  const book = () => { const c = context(); if (!c || !c.scriptPath) throw Error('출판 원고를 먼저 여세요'); return c; };
  const same = c => { const n = book(); if (n.scriptPath !== c.scriptPath || n.base !== c.base) throw Error('원고가 변경되었습니다. 해당 책을 다시 열고 진행하세요'); return n; };
  const key = (c, edition) => hash(c.scriptPath + '\n' + edition);
  const guard = fn => async (_e, a = {}) => { try { return await fn(a); } catch (e) { return { error: e.message }; } };
  const route = (n, fn) => ipcMain.handle('book-mail-' + n, guard(async a => { if (a.scriptPath && a.scriptPath !== book().scriptPath) throw Error('화면의 원고가 변경되었습니다'); return fn(a); }));
  const mutate = fn => async a => { if (busy) throw Error('메일 작업이 진행 중입니다'); busy = true; try { return await fn(a); } finally { busy = false; } };
  const editionOf = a => a.edition === 'ebook' ? 'ebook' : 'print';
  function jobFor(c, ed) { const j = (client.load().jobs || {})[key(c, ed)]; return j && j.email === client.status().email ? j : null; }
  function saveJob(c, ed, j) { const db = client.load(); db.jobs = db.jobs || {}; db.jobs[key(c, ed)] = j; client.save(db); }
  const deliveryKey = (j, ed) => hash(j.email + '\n' + j.original.id + '\n' + ed);
  function delivery(j, ed, state) { const db = client.load(); db.deliveries = db.deliveries || {}; if (state) { db.deliveries[deliveryKey(j, ed)] = state; client.save(db); } return db.deliveries[deliveryKey(j, ed)]; }
  function publicJob(j) { return j ? { original: j.original, values: j.values, state: j.state, draftId: j.draftId, to: j.to, body: j.body, files: (j.files || []).map(f => ({ name: f.name, bytes: f.bytes })), sentAt: j.sentAt, note: j.note } : null; }
  function assertValues(c, ed, j) {
    const meta = same(c).meta;
    if (String(meta[ed === 'ebook' ? 'ebookIsbn' : 'isbn'] || '').replace(/[\s-]/g, '') !== j.values.isbn || String(meta[ed === 'ebook' ? 'ebookIssueDate' : 'issueDate'] || '') !== j.values.issueDate) throw Error('ISBN·발행일이 초안 생성 이후 변경되었습니다. 초안을 다시 만드세요');
    if (j.sourceHash && same(c).sourceHash !== j.sourceHash) throw Error('원고가 초안 생성 이후 변경되었습니다. 초안을 다시 만드세요');
  }
  // ⚙ 설정 → 계정 탭은 원고 없이 부른다 — 원고가 없으면 연결 상태만
  route('status', a => { const c = context(); return { ...client.status(), job: c && c.scriptPath ? publicJob(jobFor(c, editionOf(a))) : null }; });
  route('import', mutate(async () => {
    const r = await dialog.showOpenDialog(win(), { title: '출판 메일용 Google 데스크톱 OAuth JSON', properties: ['openFile'], filters: [{ name: 'Google OAuth JSON', extensions: ['json'] }] });
    if (r.canceled) return { canceled: true };
    return client.importClient(fs.readFileSync(r.filePaths[0], 'utf8'));
  }));
  route('connect', mutate(async a => {
    const email = M.address(a.email); return client.connect(email);
  }));
  route('disconnect', mutate(() => client.disconnect()));
  route('search', async a => {
    const c = book();
    const query = String(a.query || c.base).replace(/[\r\n]/g, ' ').slice(0, 200).trim();
    if (!query) throw Error('책 제목이나 업체 메일 주소를 검색하세요');
    const r = await client.api('messages?' + new URLSearchParams({ q: query + ' -in:sent -in:drafts', maxResults: '15' }));
    const messages = await Promise.all((r.messages || []).map(async m => M.message(await client.api('messages/' + encodeURIComponent(m.id) + '?format=full'))));
    same(c); return { messages };
  });
  route('link', mutate(a => doLink(a)));
  async function doLink(a) {
    const c = book(), ed = editionOf(a), old = jobFor(c, ed);
    if (old && ['sending', 'unknown'].includes(old.state)) throw Error('이전 발송 결과를 먼저 확인하세요');
    const original = M.message(await client.api('messages/' + encodeURIComponent(String(a.id)) + '?format=full'));
    same(c);
    if (M.address(original.from) === client.status().email.toLowerCase()) throw Error('업체에서 받은 메일을 선택하세요');
    const j = { email: client.status().email, original, values: M.extract(original.text), state: 'linked' };
    if (delivery(j, ed)) throw Error('이 메일은 이미 발송했거나 결과 확인이 필요합니다. 기존 기록에서 보낸편지함을 대조하세요');
    if (old && old.original.id === original.id && old.state === 'draft') return { job: publicJob(old) };
    saveJob(c, ed, j); return { job: publicJob(j) };
  }
  route('poll', async a => {
    const c = book(), ed = editionOf(a), j = jobFor(c, ed);
    if (!j) return { changed: false };
    const r = await client.api('threads/' + encodeURIComponent(j.original.threadId) + '?format=full');
    const msgs = (r.messages || []).filter(m => !(m.labelIds || []).some(l => ['SENT', 'DRAFT'].includes(l)) && m.id !== j.original.id);
    const latest = msgs.sort((x, y) => Number(y.internalDate) - Number(x.internalDate))[0];
    return { changed: !!latest && Number(latest.internalDate) > (j.original.at || Date.parse(j.original.date) || 0), message: latest ? M.message(latest) : null };
  });
  route('prepare', mutate(a => doPrepare(a)));
  async function doPrepare(a) {
    const c = book(), ed = editionOf(a), j = jobFor(c, ed);
    if (!j) throw Error('심사 메일을 먼저 연결하세요');
    if (['sending', 'unknown', 'sent'].includes(j.state)) throw Error('이미 발송했거나 발송 결과 확인이 필요한 메일입니다');
    const values = M.validate(a.isbn, a.issueDate);
    const kinds = [...new Set(a.kinds || [])];
    const allowed = ed === 'ebook' ? ['ebookPdf', 'ebookBodyPdf', 'ebookCoverPdf'] : ['interiorPdf', 'coverPdf', 'fullPdf'];
    if (!kinds.length || kinds.some(k => !allowed.includes(k))) throw Error('업체가 요청한 첨부 종류를 선택하세요');
    if (!a.reviewed) throw Error('메일의 책·권·판 및 추가 수정 요청을 확인하세요');
    await setMeta({ key: ed === 'ebook' ? 'ebookIsbn' : 'isbn', value: values.isbn }); same(c);
    await setMeta({ key: ed === 'ebook' ? 'ebookIssueDate' : 'issueDate', value: values.issueDate }); same(c);
    j.values = values; j.state = 'building'; saveJob(c, ed, j);
    j.sourceHash = same(c).sourceHash;
    const result = await build({ edition: ed, layout: a.layout, noOpen: true });
    assertValues(c, ed, j);
    if (!result || result.error) throw Error(result && result.error || 'PDF 생성에 실패했습니다');
    const files = kinds.map(k => {
      const p = result[k]; if (!p || !fs.existsSync(p)) throw Error('요청한 파일을 만들지 못했습니다: ' + k);
      if (fs.statSync(p).size > 18 * 1024 * 1024) throw Error('첨부파일이 18MB를 넘습니다. Gmail에서 직접 첨부하세요');
      const buffer = fs.readFileSync(p); return { path: p, name: path.basename(p), bytes: buffer.length, hash: hash(buffer), buffer };
    });
    if (files.reduce((n, f) => n + f.bytes, 0) > 18 * 1024 * 1024) throw Error('첨부 합계가 18MB를 넘습니다. 파일 종류를 줄이거나 Gmail에서 직접 첨부하세요');
    // 다른 권의 파일이 섞이지 않도록 빌더가 이번 호출에서 반환한 경로만 사용한다.
    const id = crypto.randomUUID();
    const body = String(a.body || '').trim() || `안녕하세요.\n\n${c.base} ${ed === 'ebook' ? '전자책' : '종이책'} 수정 파일을 보내드립니다.\nISBN: ${values.isbn}\n발행일: ${values.issueDate}\n\n요청하신 수정 사항을 반영했습니다. 확인 부탁드립니다.\n감사합니다.`;
    const raw = M.mime({ email: j.email, original: j.original, body, files, id });
    const draft = j.draftId
      ? await client.api('drafts/' + encodeURIComponent(j.draftId), { id: j.draftId, message: { threadId: j.original.threadId, raw } }, 'PUT')
      : await client.api('drafts', { message: { threadId: j.original.threadId, raw } });
    const check = await client.api('drafts/' + encodeURIComponent(draft.id) + '?format=raw');
    same(c);
    Object.assign(j, { state: 'draft', draftId: draft.id, rawHash: hash(check.message.raw), mailId: id, to: M.address(j.original.replyTo), body, files: files.map(({ buffer, ...f }) => f), preparedAt: Date.now() });
    saveJob(c, ed, j); return { job: publicJob(j), dto: context().dto };
  }
  route('send', mutate(a => doSend(a)));
  async function doSend(a) {
    const c = book(), ed = editionOf(a), j = jobFor(c, ed);
    if (!j || j.state !== 'draft' || a.draftId !== j.draftId) throw Error('발송 가능한 초안이 없습니다. 발송 결과가 불확실한 메일은 재발송하지 않습니다');
    if (delivery(j, ed)) throw Error('이미 처리한 메일입니다. 보낸편지함을 대조하세요');
    assertValues(c, ed, j);
    for (const f of j.files) if (!fs.existsSync(f.path) || hash(fs.readFileSync(f.path)) !== f.hash) throw Error('첨부 원본이 변경되었습니다. 초안을 다시 만드세요');
    const draft = await client.api('drafts/' + encodeURIComponent(j.draftId) + '?format=raw');
    assertValues(c, ed, j);
    if (hash(draft.message.raw) !== j.rawHash) throw Error('Gmail에서 초안이 변경되었습니다. Gmail에서 직접 확인하거나 초안을 다시 만드세요');
    j.state = 'sending'; saveJob(c, ed, j); delivery(j, ed, 'sending');
    try {
      const sent = await client.api('drafts/send', { id: j.draftId });
      j.state = 'sent'; j.sentAt = new Date().toISOString(); j.sentId = sent.id;
    } catch (_) { j.state = 'unknown'; j.note = '통신 중 발송 결과를 확인하지 못했습니다. 보낸편지함 확인 전에는 다시 발송하지 않습니다.'; }
    saveJob(c, ed, j); delivery(j, ed, j.state); return { job: publicJob(j) };
  }
  route('reconcile', mutate(async a => {
    const c = book(), ed = editionOf(a), j = jobFor(c, ed);
    if (!j || !j.mailId) throw Error('발송 기록이 없습니다');
    const r = await client.api('messages?' + new URLSearchParams({ q: `in:sent rfc822msgid:${j.mailId}@priming.local` }));
    if ((r.messages || []).length) { j.state = 'sent'; j.sentAt = j.sentAt || new Date().toISOString(); j.note = '보낸편지함에서 발송을 확인했습니다'; saveJob(c, ed, j); }
    return { job: publicJob(j) };
  }));
  // 📬 자동 처리(로이 2026-10-16 「너무 복잡하다 — 메일 찾기·ISBN/발행일 입력·첨부 회신을 자동으로」):
  //   이 책의 부크크 「판권지수정요청」 메일을 판마다 찾아 → 값 추출(정규식 + Claude 대조) → 원고 메타 → PDF → 회신 초안 →
  //   발송까지 버튼 하나(로이 2026-10-16 「버튼 하나만 눌러서 … 메일 발송」 — 확인창 없음). 대신 책·판이 제목과 맞지 않거나, 추가 요청이 있거나,
  //   정규식과 Claude 값이 어긋나거나, 이미 회신한 메일이면 그 판은 보내지 않고 이유를 알린다.
  const AUTO_KINDS = { print: ['interiorPdf'], ebook: ['ebookPdf'] };
  const AUTO_BODY = '안녕하세요.\n\n판권지 정보 수정하여 원고파일 전달합니다.\n\n감사합니다.';
  async function review(msg, title, x) {
    const plain = M.plainRequest(msg.text);
    if (!ask) return plain.ok ? { ok: true, by: '정형 문구' } : { ok: false, why: '정형 문구 밖의 요청이 있습니다: ' + plain.odd.slice(0, 2).join(' / ') };
    const r = await ask({ system: M.REVIEW_SYSTEM, text: M.reviewPrompt(msg, title), maxTokens: 1500, timeoutMs: 120000, label: '부크크 메일 확인' });
    if (!r || !r.ok) {
      if (r && r.noKey) return plain.ok ? { ok: true, by: '정형 문구' } : { ok: false, why: '정형 문구 밖의 요청이 있습니다: ' + plain.odd.slice(0, 2).join(' / ') };
      return { ok: false, why: 'Claude 확인 실패 — ' + ((r && r.error) || '응답 없음') };
    }
    const j = parseJson(r.text);
    if (!j) return { ok: false, why: 'Claude 답을 읽지 못했습니다' };
    const extra = (Array.isArray(j.extraRequests) ? j.extraRequests : []).map(String).filter(s => s.trim());
    if (extra.length) return { ok: false, why: '추가 요청이 있습니다: ' + extra.join(' / ') };
    let cx; try { cx = M.validate(j.isbn, j.issueDate); } catch (_) { return { ok: false, why: 'Claude 가 ISBN·발행일을 읽지 못했습니다' }; }
    if (cx.isbn !== x.isbn || cx.issueDate !== x.issueDate) return { ok: false, why: `값이 서로 다릅니다(정규식 ${x.isbn}·${x.issueDate} / Claude ${cx.isbn}·${cx.issueDate})` };
    return { ok: true, by: 'Claude 대조' };
  }
  function parseJson(t) { const m = String(t || '').match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch (_) { return null; } }
  route('auto', mutate(async a => {
    const c = book(), title = M.shortTitle(c.meta.title || c.base);
    if (!client.status().connected) throw Error('Gmail 을 먼저 연결하세요');
    const r = await client.api('messages?' + new URLSearchParams({ q: 'from:bookk.co.kr 판권지수정요청 newer_than:60d -in:sent -in:drafts', maxResults: '30' }));
    const all = await Promise.all((r.messages || []).map(async m => M.message(await client.api('messages/' + encodeURIComponent(m.id) + '?format=full'))));
    same(c);
    const results = [], ready = [];
    for (const ed of ['print', 'ebook']) {
      const label = ed === 'ebook' ? '전자책' : '종이책';
      const msg = all.filter(m => { const q = M.requestOf(m.subject, title); return q && q.edition === ed; }).sort((x, y) => y.at - x.at)[0];
      if (!msg) { results.push({ edition: ed, label, state: 'none', note: `「${title}」 ${label} 판권지 수정 요청 메일이 없습니다` }); continue; }
      const th = await client.api('threads/' + encodeURIComponent(msg.threadId) + '?format=minimal');
      if ((th.messages || []).some(m => (m.labelIds || []).includes('SENT') && Number(m.internalDate) > msg.at)) { results.push({ edition: ed, label, state: 'done', subject: msg.subject, note: '이미 회신한 메일입니다' }); continue; }
      const x = M.extract(msg.text);
      if (!x.isbn || !x.issueDate || x.ambiguous) { results.push({ edition: ed, label, state: 'stop', subject: msg.subject, note: 'ISBN·발행일을 메일에서 하나로 읽지 못했습니다 — Gmail에서 직접 회신하세요' }); continue; }
      const v = await review(msg, title, x);
      if (!v.ok) { results.push({ edition: ed, label, state: 'stop', subject: msg.subject, isbn: x.isbn, issueDate: x.issueDate, note: v.why + ' — Gmail에서 직접 회신하세요' }); continue; }
      log(`📬 ${title} ${label} — ${msg.subject} · ISBN ${x.isbn} · ${x.issueDate} (${v.by})`);
      const res = { edition: ed, label, state: 'ready', subject: msg.subject, isbn: x.isbn, issueDate: x.issueDate, note: '' };
      ready.push({ ed, msg, x, res }); results.push(res);
    }
    // 🔑 두 판의 판권 값을 원고에 먼저 다 쓴다 — 종이책 초안 뒤에 전자책 값을 쓰면 원고가 바뀌어 종이책 발송이 「원고 변경」으로 막힌다.
    for (const { ed, x } of ready) {
      await setMeta({ key: ed === 'ebook' ? 'ebookIsbn' : 'isbn', value: x.isbn }); same(c);
      await setMeta({ key: ed === 'ebook' ? 'ebookIssueDate' : 'issueDate', value: x.issueDate }); same(c);
    }
    for (const { ed, msg, x, res } of ready) {
      try {
        const old = jobFor(c, ed);
        if (!(old && old.original.id === msg.id && old.state === 'draft')) await doLink({ ...a, edition: ed, id: msg.id });
        const p = await doPrepare({ ...a, edition: ed, isbn: x.isbn, issueDate: x.issueDate, kinds: AUTO_KINDS[ed], reviewed: true, body: AUTO_BODY });
        const sn = await doSend({ ...a, edition: ed, draftId: p.job.draftId });
        res.state = sn.job.state;
        res.note = sn.job.state === 'sent' ? `발송 완료 → ${sn.job.to} (${sn.job.files.map(f => f.name).join(', ')})` : (sn.job.note || '발송 결과 확인 필요');
      } catch (e) { res.state = 'stop'; res.note = '보내지 못했습니다 — ' + e.message; }
    }
    for (const res of results) log(`📬 ${res.label}: ${res.note}`);
    return { results, dto: context().dto };
  }));
  route('open', () => shell.openExternal('https://mail.google.com/mail/?authuser=' + encodeURIComponent(client.status().email) + '#drafts'));
  route('setup', () => shell.openExternal('https://console.cloud.google.com/apis/library/gmail.googleapis.com'));
}
module.exports = { install };
