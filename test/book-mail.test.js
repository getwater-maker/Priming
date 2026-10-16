'use strict';
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const M = require('../core/book/resubmit-mail');
const { install } = require('../core/book/resubmit-ipc');
const { createClient, SCOPES } = require('../core/book/gmail-client');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'priming-mail-'));
const ISBN = '9791112312402';
const inbound = { id: 'in1', threadId: 'th1', internalDate: '1792100000000', payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: '삼국지 제1권 판권 수정' }, { name: 'From', value: '담당자 <editor@bookk.co.kr>' }, { name: 'Message-ID', value: '<in1@bookk.co.kr>' }], body: { data: Buffer.from('ISBN: 979-11-12-31240-2\n발행일: 2026-10-16').toString('base64url') } } };
(async () => {
  try {
    assert.equal(M.message(inbound).text.includes('2026-10-16'), true);
    const x = M.extract(M.message(inbound).text); assert.equal(x.isbn, ISBN); assert.equal(x.issueDate, '2026년 10월 16일');
    assert.equal(M.extract('발행일 2026-02-30').issueDate, '');
    assert.equal(M.extract('발행일은 ISBN을 받은 날입니다.').issueDate, '');
    assert.equal(M.extract('ISBN 979-11-12-31240-3').isbn, '');
    assert.equal(M.extract('발행일 2026-10-16\n발행일 2026-10-17').ambiguous, true);
    assert.equal(M.extract('ISBN 979-11-12-31240-2\n> 발행일 2001-01-01').issueDate, '');
    assert.throws(() => M.address('x@site.test\r\nBcc: victim@site.test'));
    assert.throws(() => M.validate(ISBN, '아직 미정'));
    const wire = Buffer.from(M.mime({ email: 'getwater@gmail.com', original: M.message(inbound), body: '회신', files: [{ name: '제1권_내지.pdf', buffer: Buffer.from('%PDF-test') }], id: 'proof' }), 'base64url').toString();
    assert.match(wire, /In-Reply-To: <in1@bookk.co.kr>/); assert.match(wire, /filename\*=UTF-8''/); assert.match(wire, /To: editor@bookk.co.kr/);
    console.log('✓ ISBN·명시된 날짜·인용문·회신 MIME 검증');

    // 실제 loopback OAuth + PKCE/state, 암호화 저장, 토큰 갱신을 가짜 Google 응답으로 검증한다.
    let refreshes = 0, authUrl;
    const cipher = { enc: s => Buffer.from(s).map(b => b ^ 42), dec: b => Buffer.from(b).map(v => v ^ 42).toString() };
    const gmail = createClient({ dir: tmp, cipher,
      openExternal: async u => { authUrl = new URL(u); const cb = new URL(authUrl.searchParams.get('redirect_uri')); cb.searchParams.set('state', authUrl.searchParams.get('state')); cb.searchParams.set('code', 'test-code'); await fetch(cb); },
      fetcher: async (u, o) => {
        let data;
        if (u.includes('/token')) { refreshes++; const p = o.body; assert.equal(p.get('code_verifier').length >= 43, true); data = { access_token: 'ACCESS_SECRET', refresh_token: 'REFRESH_SECRET', scope: SCOPES.join(' '), expires_in: 3600 }; }
        else data = { emailAddress: 'getwater@gmail.com' };
        return { ok: true, json: async () => data };
      }
    });
    gmail.importClient(JSON.stringify({ installed: { client_id: 'c', client_secret: 's' } }));
    assert.throws(() => gmail.importClient(JSON.stringify({ web: {} })));
    await gmail.connect('getwater@gmail.com');
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(gmail.status().email, 'getwater@gmail.com');
    assert.equal(fs.readFileSync(path.join(tmp, 'publication-mail.enc')).includes(Buffer.from('REFRESH_SECRET')), false);
    assert.equal(JSON.stringify(gmail.status()).includes('SECRET'), false);
    assert.equal(refreshes, 1); gmail.disconnect(); assert.equal(gmail.status().connected, false);
    console.log('✓ OAuth loopback·PKCE·계정 확인·OS 암호화 저장 경로');

    const handlers = {}, db = { jobs: {} }; let sends = 0, drafts = 0, failSend = false, draftRaw = 'raw';
    let c = { scriptPath: 'book1.md', base: '삼국지_제1권', meta: {}, sourceHash: 'source-v1' };
    const pdf = path.join(tmp, '제1권_내지.pdf');
    const fake = { status: () => ({ connected: true, email: 'getwater@gmail.com' }), load: () => structuredClone(db), save: d => Object.assign(db, structuredClone(d)), api: async (route, body) => {
      if (route.startsWith('messages/in')) return { ...inbound, id: route.includes('in2') ? 'in2' : 'in1' };
      if (route === 'drafts' || route === 'drafts/draft1') { drafts++; return { id: 'draft1' }; }
      if (route === 'drafts/draft1?format=raw') return { message: { raw: draftRaw } };
      if (route === 'drafts/send') { sends++; if (failSend) throw Error('network timeout'); return { id: 'sent1' }; }
      if (route.startsWith('messages?')) return { messages: [{ id: 'sent1' }] };
      throw Error('Unexpected route: ' + route);
    } };
    install({ ipcMain: { handle: (n, fn) => { handlers[n] = fn; } }, dialog: {}, shell: {}, win: () => null, context: () => c,
      setMeta: async a => { c.meta[a.key] = a.value; }, build: async () => { fs.writeFileSync(pdf, '%PDF-test'); return { interiorPdf: pdf }; }, client: fake });
    const call = (name, a = {}) => handlers['book-mail-' + name](null, { edition: 'print', ...a });
    assert.match((await call('prepare')).error, /먼저 연결/);
    await call('link', { id: 'in1' });
    const values = { isbn: ISBN, issueDate: '2026-10-16', kinds: ['interiorPdf'], reviewed: true };
    assert.match((await call('prepare', { ...values, reviewed: false })).error, /확인/);
    assert.match((await call('prepare', { ...values, kinds: ['ebookPdf'] })).error, /첨부 종류/);
    let r = await call('prepare', values); assert.equal(r.job.state, 'draft'); assert.equal(drafts, 1); assert.equal(sends, 0);
    assert.equal(c.meta.issueDate, '2026년 10월 16일');
    fs.writeFileSync(pdf, '%PDF-changed'); assert.match((await call('send', { draftId: 'draft1' })).error, /첨부 원본/);
    await call('prepare', values); c.sourceHash = 'changed'; assert.match((await call('send', { draftId: 'draft1' })).error, /원고가/); c.sourceHash = 'source-v1';
    draftRaw = 'edited-in-gmail'; assert.match((await call('send', { draftId: 'draft1' })).error, /Gmail에서 초안/); draftRaw = 'raw';
    r = await call('send', { draftId: 'draft1' }); assert.equal(r.job.state, 'sent');
    assert.ok((await call('send', { draftId: 'draft1' })).error); assert.equal(sends, 1);
    assert.match((await call('status', { scriptPath: 'wrong-book.md' })).error, /원고가 변경/);
    assert.ok((await call('link', { id: 'in1' })).error);
    await call('link', { id: 'in2' }); await call('prepare', values); failSend = true;
    r = await call('send', { draftId: 'draft1' }); assert.equal(r.job.state, 'unknown');
    assert.ok((await call('send', { draftId: 'draft1' })).error); assert.equal(sends, 2);
    r = await call('reconcile'); assert.equal(r.job.state, 'sent');
    console.log('✓ 책·판 분리, 요청 파일만 첨부, 원고/파일/초안 변경 차단, 중복 발송 및 통신 불확실성 처리');
    console.log('✅ 출판 메일 검증 완료 (실제 메일 발송 없음)');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
