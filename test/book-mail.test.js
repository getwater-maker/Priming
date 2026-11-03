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
    // 🔑 연결 만료(2026-11-03 실물 — 「테스트」 OAuth 앱은 7일마다 invalid_grant) → 사람 말 안내 · 연결 끊김으로 표시 · 메일 주소는 남김 · 다시 연결하면 풀림
    {
      const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'priming-mail-exp-')); let expired = true, apiCalls = 0;
      const g2 = createClient({ dir: dir2, cipher,
        openExternal: async u => { const a = new URL(u); const cb = new URL(a.searchParams.get('redirect_uri')); cb.searchParams.set('state', a.searchParams.get('state')); cb.searchParams.set('code', 'c2'); await fetch(cb); },
        fetcher: async (u, o) => {
          if (u.includes('/token')) {
            if (o.body.get('grant_type') === 'refresh_token' && expired) return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }) };
            return { ok: true, json: async () => ({ access_token: 'A2', refresh_token: 'R2', scope: SCOPES.join(' '), expires_in: -1 }) };
          }
          if (u.includes('/profile')) return { ok: true, json: async () => ({ emailAddress: 'getwater@gmail.com' }) };
          apiCalls++; return { ok: true, json: async () => ({ messages: [] }) };
        } });
      g2.importClient(JSON.stringify({ installed: { client_id: 'c', client_secret: 's' } }));
      // 접속 토큰이 바로 낡게(expires_in -1) — 다음 호출은 갱신을 거친다
      await g2.connect('getwater@gmail.com');
      const db0 = g2.load(); db0.refresh = 'R2'; g2.save(db0);
      await assert.rejects(g2.api('messages?q=x'), /만료됐습니다.*다시 연결/);
      assert.deepEqual([g2.status().connected, g2.status().expired, g2.status().email], [false, true, 'getwater@gmail.com']);
      assert.equal(apiCalls, 0);
      await assert.rejects(g2.api('messages?q=x'), /먼저 Gmail을 연결/);   // 죽은 토큰으로 다시 묻지 않는다
      // 다른 오류(권한 없음 등)는 연결을 끊지 않는다
      expired = false; await g2.connect('getwater@gmail.com');
      assert.deepEqual([g2.status().connected, g2.status().expired], [true, false]);
      fs.rmSync(dir2, { recursive: true, force: true });
    }
    console.log('✓ 연결 만료(invalid_grant) → 만료 안내 · 연결 끊김 표시 · 다시 연결하면 풀림');

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
    // 📬 자동 처리 — 부크크 실제 문구(「발행->」), 제목으로 책·판 판별, 추가 요청이면 멈춤, 확인창 「보내기」 뒤에만 발송
    const bk = (id, subject, text, at) => ({ id, threadId: 't' + id, internalDate: String(at), payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: subject }, { name: 'From', value: '부크크 <info@bookk.co.kr>' }, { name: 'Message-ID', value: `<${id}@bookk.co.kr>` }], body: { data: Buffer.from(text).toString('base64url') } } });
    const T = (isbn, d) => `안녕하세요. 부크크입니다.\n\n판권지의 정보 아래와 같이 수정하여 저희 메일로 전체 원고파일만 전달바랍니다.\n\n발행->${d}\nisbn->${isbn}\n\n감사합니다. 부크크 원고검수팀.`;
    assert.equal(M.extract(T('979-11-12-32516-7', '2026년 10월 16일')).issueDate, '2026년 10월 16일');
    assert.equal(M.extract('발행인: 한건희 2026년 1월 1일').issueDate, '');
    assert.deepEqual(M.requestOf('[판권지수정요청]안녕하세요. 부크크입니다.[삼국지 4_전자책] ', '삼국지 4 : 적벽대전'), { edition: 'ebook' });
    assert.deepEqual(M.requestOf('[판권지수정요청]안녕하세요. 부크크입니다.[삼국지 3]', '삼국지 3 : 관도'), { edition: 'print' });
    assert.equal(M.requestOf('[판권지수정요청]안녕하세요. 부크크입니다.[삼국지 3]', '삼국지 4 : 적벽대전'), null);
    assert.equal(M.requestOf('[판권지수정요청]…[삼국지 40_종이책]', '삼국지 4'), null);
    assert.equal(M.requestOf('Re: [판권지수정요청]…[삼국지 4_종이책]', '삼국지 4'), null);
    // 부제까지 붙인 꼬리표(실물 2026-11-02) — 원고 제목 「빨간 머리 앤 : 초록 지붕 집의 앤」
    assert.deepEqual(M.requestOf('[판권지수정요청]안녕하세요. 부크크입니다.[빨간 머리 앤 초록 지붕 집의 앤_전자책]', '빨간 머리 앤 : 초록 지붕 집의 앤'), { edition: 'ebook' });
    assert.equal(M.requestOf('[판권지수정요청]…[빨간 머리 앤 초록 지붕_전자책]', '빨간 머리 앤 : 초록 지붕 집의 앤'), null);
    assert.equal(M.plainRequest(T('979-11-12-32516-7', '2026년 10월 16일')).ok, true);
    assert.equal(M.plainRequest('안녕하세요. 부크크입니다.\n제출하신 앞표지에 로고 작업하여 전달드립니다.\n' + T('979-11-12-32516-7', '2026년 10월 16일')).ok, false);
    const P_ISBN = '9791112325167', E_ISBN = '9791112325181';
    const mails = [bk('p4', '[판권지수정요청]안녕하세요. 부크크입니다.[삼국지 4_종이책]', T('979-11-12-32516-7', '2026년 10월 16일'), 1792151859000),
      bk('e4', '[판권지수정요청]안녕하세요. 부크크입니다.[삼국지 4_전자책] ', T('979-11-12-32518-1', '2026년 10월 16일'), 1792152017000),
      bk('p3', '[판권지수정요청]안녕하세요. 부크크입니다.[삼국지 3]', T('979-11-12-32317-0', '2026년 10월 15일'), 1792048616000)];
    async function runAuto({ askFn, replied = [], resend = false, twice = false, inbox = false, scripts = [{ path: 'D:/출판/004/원고/vol4.md', title: '삼국지 4 : 적벽대전' }], mailList = mails, big = false } = {}) {
      const shellLog = { reveal: [], open: [] };
      const h = {}, d = { jobs: {} }, sent = [], built = [], raws = {}, opens = []; let metaWrites = 0, isOpen = !inbox;
      const cc = { scriptPath: inbox ? scripts[0].path : 'vol4.md', base: '삼국지_제4권', meta: { title: scripts[0].title }, sourceHash: 's4' };
      const f4 = { interiorPdf: path.join(tmp, '4_내지.pdf'), ebookPdf: path.join(tmp, '[전자책] 4_표지+본문.pdf'), coverPdf: path.join(tmp, '4_표지.pdf') };
      let nd = 0;
      const api = async (route, body) => {
        if (route.startsWith('messages?')) { assert.match(decodeURIComponent(route), /from:bookk.co.kr/); return { messages: mailList.map(m => ({ id: m.id })) }; }
        if (route.startsWith('messages/')) return mailList.find(m => route.startsWith('messages/' + m.id + '?'));
        if (route.startsWith('threads/')) { const id = route.slice(8, route.indexOf('?')).slice(1); return { messages: replied.includes(id) ? [{ labelIds: ['SENT'], internalDate: '1792200000000' }] : [] }; }
        if (route === 'drafts') { const id = 'd' + (nd++); raws[id] = Buffer.from(body.message.raw, 'base64url').toString(); return { id }; }
        if (/^drafts\/d\d\?format=raw$/.test(route)) return { message: { raw: 'raw' } };
        if (route === 'drafts/send') { sent.push(raws[body.id]); return { id: 'sent-' + body.id }; }
        throw Error('Unexpected route: ' + route);
      };
      install({ ipcMain: { handle: (n, fn) => { h[n] = fn; } }, win: () => null, shell: { showItemInFolder: f => shellLog.reveal.push(f), openExternal: u => shellLog.open.push(u) }, dialog: {}, context: () => (isOpen ? cc : null),
        findScripts: async () => scripts, openBook: async p => { opens.push(p); isOpen = true; return { queue: 'Q' }; },
        // 실제처럼 판권 값을 쓰면 원고 해시가 바뀐다(종이책 초안 뒤에 전자책 값을 쓰면 종이책 발송이 막히던 순서 문제를 잡는다)
        setMeta: async a => { metaWrites++; cc.meta[a.key] = a.value; cc.sourceHash = JSON.stringify(cc.meta); },
        // 실제 빌더처럼 판마다 자기 파일만 쓴다(전자책 빌드는 종이책 내지를 건드리지 않는다)
        build: async a => { built.push(a.edition); const own = a.edition === 'ebook' ? { ebookPdf: f4.ebookPdf } : { interiorPdf: f4.interiorPdf, coverPdf: f4.coverPdf }; for (const p of Object.values(own)) fs.writeFileSync(p, big && p === f4.interiorPdf ? Buffer.alloc(19 * 1024 * 1024, 32) : '%PDF-' + a.edition); return own; },
        ask: askFn, client: { status: () => ({ connected: true, email: 'getwater@gmail.com' }), load: () => structuredClone(d), save: x => Object.assign(d, structuredClone(x)), api } });
      if (inbox) return { r: await h['book-mail-inbox'](null, {}), cc, sent, built, metaWrites, opens };
      let r = await h['book-mail-auto'](null, {});
      if (twice) r = await h['book-mail-auto'](null, { resend });
      return { r, cc, sent, built, metaWrites, h, shellLog };
    }
    const att = raw => [...raw.matchAll(/filename\*=UTF-8''([^\r\n]+)/g)].map(m => decodeURIComponent(m[1]));
    let A = await runAuto();
    assert.equal(A.r.error, undefined, A.r.error);
    assert.deepEqual(A.built, ['print', 'ebook']);
    // 판권에는 메일 꼴 그대로(하이픈 유지) — 숫자만 넣어 하이픈 빠진 PDF 를 보낸 사고
    assert.equal(A.cc.meta.isbn, '979-11-12-32516-7'); assert.equal(A.cc.meta.ebookIsbn, '979-11-12-32518-1'); assert.equal(A.cc.meta.issueDate, '2026년 10월 16일'); assert.equal(A.cc.meta.ebookIssueDate, '2026년 10월 16일');
    assert.equal(A.metaWrites, 4);   // 같은 값을 다시 쓰지 않는다(원고 수정 시각이 바뀌면 방금 만든 PDF 가 「원고보다 오래됨」)
    assert.equal(A.r.results[0].isbn, '979-11-12-32516-7');
    assert.deepEqual(A.r.results.map(x => x.state), ['sent', 'sent'], JSON.stringify(A.r.results));
    assert.equal(A.sent.length, 2);
    assert.deepEqual(att(A.sent[0]), ['4_내지.pdf']); assert.deepEqual(att(A.sent[1]), ['[전자책] 4_표지+본문.pdf']);   // 요청한 파일만
    assert.match(A.sent[0], /To: info@bookk.co.kr/); assert.match(A.sent[0], /In-Reply-To: <p4@bookk.co.kr>/); assert.match(A.sent[1], /In-Reply-To: <e4@bookk.co.kr>/);
    A = await runAuto({ replied: ['p4'] });
    assert.equal(A.r.results[0].state, 'done'); assert.deepEqual(A.built, ['ebook']); assert.equal(A.sent.length, 1);
    // 🔁 다시 보내기 — 이미 회신한 두 메일에 고친 파일을 한 번 더(새 회차) · 본문은 「바로잡아 다시 보내드립니다」
    A = await runAuto({ replied: ['p4', 'e4'], resend: true, twice: true });
    assert.deepEqual(A.r.results.map(x => x.state), ['sent', 'sent'], JSON.stringify(A.r.results)); assert.equal(A.sent.length, 2);
    const bodyOf = raw => { const m = raw.match(/charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/); return m ? Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString() : ''; };
    assert.ok(A.sent.every(raw => bodyOf(raw).includes('바로잡아 다시')), '다시 보내기 본문');
    A = await runAuto({ replied: ['p4', 'e4'], twice: true });
    assert.deepEqual(A.r.results.map(x => x.state), ['done', 'done']); assert.equal(A.sent.length, 0);   // 누르지 않으면 다시 보내지 않는다
    A = await runAuto({ askFn: async () => ({ ok: true, text: JSON.stringify({ edition: 'print', isbn: P_ISBN, issueDate: '2026-10-16', extraRequests: ['앞표지에 로고 추가'] }) }) });
    assert.deepEqual(A.r.results.map(x => x.state), ['stop', 'stop']); assert.match(A.r.results[0].note, /로고/); assert.deepEqual(A.built, []); assert.equal(A.sent.length, 0);
    A = await runAuto({ askFn: async o => ({ ok: true, text: JSON.stringify({ isbn: o.text.includes('전자책') ? E_ISBN : '9791112323170', issueDate: '2026-10-16', extraRequests: [] }) }) });
    assert.deepEqual(A.r.results.map(x => x.state), ['stop', 'sent']); assert.match(A.r.results[0].note, /서로 다릅니다/); assert.equal(A.cc.meta.isbn, undefined);
    A = await runAuto({ askFn: async () => ({ ok: false, noKey: true }) });
    assert.deepEqual(A.r.results.map(x => x.state), ['sent', 'sent']);
    console.log('✓ 📬 자동 처리: 「발행->」 추출·책/판 판별·추가 요청·값 불일치 멈춤·이미 회신 건너뜀·두 판 판권 먼저 쓰고 판마다 PDF→발송');
    // 📬 원고 없이(출판 첫 화면) — 메일 먼저 → 제목의 책 원고를 찾아 열고 같은 처리 · 원고 없는 메일은 멈춤 · 다 회신했으면 열지 않음
    A = await runAuto({ inbox: true });
    assert.equal(A.r.error, undefined, A.r.error);
    assert.deepEqual(A.opens, ['D:/출판/004/원고/vol4.md']); assert.equal(A.r.queue, 'Q');
    assert.equal(A.sent.length, 2); assert.equal(A.cc.meta.isbn, '979-11-12-32516-7');
    assert.ok(A.r.results.some(x => x.state === 'stop' && /삼국지 3/.test(x.note) && /찾지 못했/.test(x.note)), JSON.stringify(A.r.results));
    assert.deepEqual(A.r.results.filter(x => x.state === 'sent').map(x => x.label), ['삼국지 4 종이책', '삼국지 4 전자책']);
    A = await runAuto({ inbox: true, replied: ['p4', 'e4'] });
    assert.deepEqual(A.opens, []); assert.equal(A.sent.length, 0); assert.ok(A.r.results.some(x => x.state === 'info' && /1권/.test(x.note)));
    A = await runAuto({ inbox: true, scripts: [{ path: 'a/vol4.md', title: '삼국지 4 : 적벽대전' }, { path: 'b/조판시험.md', title: '삼국지 4' }] });
    assert.deepEqual(A.opens, []); assert.equal(A.sent.length, 0); assert.ok(A.r.results.some(x => x.state === 'stop' && /2개/.test(x.note)));
    A = await runAuto({ inbox: true, scripts: [{ path: 'x/원고/vol4.md', title: '삼국지 4 : 적벽대전' }, { path: 'x/기준/조판시험.md', title: '삼국지 4' }] });
    assert.deepEqual(A.opens, ['x/원고/vol4.md']);   // 같은 이름이 여럿이면 「원고」 폴더 것만
    console.log('✓ 📬 원고 없이 회신: 메일 → 원고 찾기·열기 → 같은 처리 · 원고 없음·여럿이면 멈춤 · 다 회신한 책은 열지 않음');
    // 📬 실물(2026-11-02) — 화살표 「→」 + ⓒ 줄 + 부제 붙은 꼬리표. ⓒ 는 판권지 정보(추가 요청 아님) → 판권 ⓒ 줄에 넣고 보낸다
    const T2 = '안녕하세요. 부크크입니다.\n\n판권지의 정보 아래와 같이 수정하여 저희 메일로 전체 원고파일만 전달바랍니다.\n\n발행 → 2026년 11월 2일\nISBN → 979-11-12-34199-0\nⓒ → 루시 모드 몽고메리 2026\n\n감사합니다. 부크크 원고검수팀.';
    const x2 = M.extract(T2);
    assert.deepEqual([x2.isbnText, x2.issueDate, x2.copyright, x2.ambiguous], ['979-11-12-34199-0', '2026년 11월 02일', '루시 모드 몽고메리 2026', false]);
    assert.equal(M.plainRequest(T2).ok, true, JSON.stringify(M.plainRequest(T2).odd));
    assert.equal(M.extract(T2 + '\nⓒ → 로이 2026').ambiguous, true);
    const anne = [bk('a1', '[판권지수정요청]안녕하세요. 부크크입니다.[빨간 머리 앤 초록 지붕 집의 앤_전자책]', T2, 1792300000000)];
    const annePath = 'D:/출판/002/원고/빨간머리앤.md';
    A = await runAuto({ inbox: true, mailList: anne, scripts: [{ path: annePath, title: '빨간 머리 앤 : 초록 지붕 집의 앤' }] });
    assert.equal(A.r.error, undefined, A.r.error);
    assert.deepEqual(A.opens, [annePath]); assert.equal(A.sent.length, 1, JSON.stringify(A.r.results));
    assert.equal(A.cc.meta.ebookIsbn, '979-11-12-34199-0'); assert.equal(A.cc.meta.copyright, 'ⓒ 루시 모드 몽고메리 2026. All rights reserved.');
    // Claude 대조 — ⓒ 를 정식 값으로 읽으면 통과, 다르게 읽으면 멈춤
    const cl = cp => async () => ({ ok: true, text: JSON.stringify({ isbn: '9791112341990', issueDate: '2026-11-02', copyright: cp, extraRequests: [] }) });
    A = await runAuto({ inbox: true, mailList: anne, scripts: [{ path: annePath, title: '빨간 머리 앤 : 초록 지붕 집의 앤' }], askFn: cl('루시 모드 몽고메리 2026') });
    assert.equal(A.sent.length, 1, JSON.stringify(A.r.results));
    A = await runAuto({ inbox: true, mailList: anne, scripts: [{ path: annePath, title: '빨간 머리 앤 : 초록 지붕 집의 앤' }], askFn: cl('로이 2026') });
    assert.equal(A.sent.length, 0); assert.ok(A.r.results.some(x => /ⓒ 값이 서로/.test(x.note)));
    // 📮 첨부가 Gmail 한도를 넘으면(2026-11-03 빨간 머리 앤 내지 19.5MB) — 보내지 않고, 화면 팝업용 메일·파일 정보를 싣는다 · 팝업 단추는 알려 준 것만 연다
    A = await runAuto({ big: true });
    assert.equal(A.r.results[0].state, 'stop'); assert.match(A.r.results[0].note, /18MB/);
    assert.equal(A.r.results[0].manual.file, path.join(tmp, '4_내지.pdf')); assert.equal(A.r.results[0].manual.mb, 19); assert.equal(A.r.results[0].manual.threadId, 'tp4');
    assert.equal(A.r.results[1].state, 'sent'); assert.equal(A.r.results[1].manual, undefined);   // 보낸 판은 팝업에 넣지 않는다
    assert.equal(A.sent.length, 1);
    await A.h['book-mail-reveal'](null, { file: A.r.results[0].manual.file }); assert.deepEqual(A.shellLog.reveal, [path.join(tmp, '4_내지.pdf')]);
    assert.match((await A.h['book-mail-reveal'](null, { file: 'C:/Windows/notepad.exe' })).error, /열 수 없는/); assert.equal(A.shellLog.reveal.length, 1);
    await A.h['book-mail-thread'](null, { threadId: 'tp4' }); assert.ok(A.shellLog.open[0].endsWith('#all/tp4'), A.shellLog.open[0]);
    assert.match((await A.h['book-mail-thread'](null, { threadId: 'other' })).error, /열 수 없는/);
    fs.writeFileSync(path.join(tmp, '4_내지.pdf'), '%PDF-small');
    A = await runAuto({ askFn: async () => ({ ok: true, text: JSON.stringify({ isbn: P_ISBN, issueDate: '2026-10-16', extraRequests: ['앞표지 로고'] }) }) });
    assert.ok(A.r.results.every(x => x.state === 'stop' && x.manual && !x.manual.file));   // 추가 요청 = 팝업(메일만 · 파일 없음)
    console.log('✓ 📮 직접 보내기: 첨부 한도 초과·추가 요청 → 메일·파일 정보 · 팝업 단추는 알려 준 메일·파일만');
    console.log('✓ 📬 실물 메일: 「→」·ⓒ 줄 = 판권지 정보 → 판권 ⓒ 줄에 넣고 발송 · 부제 붙은 꼬리표 · Claude ⓒ 대조');
    console.log('✅ 출판 메일 검증 완료 (실제 메일 발송 없음)');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
