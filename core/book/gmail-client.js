'use strict';
// 출판 Gmail 전용 연결. YouTube OAuth 프로젝트·토큰과 분리하며 OS 암호화만 사용한다.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), http = require('http');
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'];
function createClient({ dir = path.join(os.homedir(), '.priming-maker'), cipher, fetcher = fetch, openExternal } = {}) {
  const file = path.join(dir, 'publication-mail.enc');
  let access = null, connecting = false;
  const crypt = () => {
    if (cipher) return cipher;
    const { safeStorage } = require('electron');
    if (!safeStorage.isEncryptionAvailable()) throw Error('Windows 암호화를 사용할 수 없어 메일 연결 정보를 저장하지 않았습니다');
    return { enc: s => safeStorage.encryptString(s), dec: b => safeStorage.decryptString(b) };
  };
  function load() { if (!fs.existsSync(file)) return { jobs: {} }; return JSON.parse(crypt().dec(fs.readFileSync(file))); }
  function save(db) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.tmp', crypt().enc(JSON.stringify(db))); fs.renameSync(file + '.tmp', file); }
  async function request(url, options = {}) {
    const r = await fetcher(url, { ...options, signal: AbortSignal.timeout(45000) });
    const data = await r.json();
    if (!r.ok) {
      const code = data.error && (data.error.status || data.error) || r.status;
      throw Error(`Gmail 연결 오류 (${typeof code === 'string' ? code : r.status}) — Gmail API 활성화·권한·계정 연결을 확인하세요`);
    }
    return data;
  }
  const tokenPost = body => request('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams(body) });
  async function token() {
    if (access && access.until > Date.now() + 60000) return access.value;
    const db = load();
    if (!db.refresh || !db.client) throw Error('먼저 Gmail을 연결하세요');
    const t = await tokenPost({ client_id: db.client.client_id, client_secret: db.client.client_secret, refresh_token: db.refresh, grant_type: 'refresh_token' });
    access = { value: t.access_token, until: Date.now() + t.expires_in * 1000 };
    return access.value;
  }
  async function api(route, body, method) {
    return request('https://gmail.googleapis.com/gmail/v1/users/me/' + route, { method: method || (body ? 'POST' : 'GET'), headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  function status() { const d = load(); return { configured: !!d.client, connected: !!d.refresh, email: d.email || '', connecting }; }
  function importClient(text) {
    const c = JSON.parse(text).installed;
    if (!c || !c.client_id || !c.client_secret) throw Error('Google Cloud에서 받은 데스크톱 앱 OAuth JSON을 선택하세요');
    const db = load();
    if (db.client && db.client.client_id !== c.client_id) { delete db.refresh; delete db.email; access = null; }
    db.client = { client_id: String(c.client_id), client_secret: String(c.client_secret) }; save(db); return status();
  }
  async function connect(email) {
    if (connecting) throw Error('Google 로그인이 진행 중입니다');
    const db = load(); if (!db.client) throw Error('먼저 출판 메일용 OAuth JSON을 가져오세요');
    connecting = true;
    const state = crypto.randomBytes(24).toString('hex'), verifier = crypto.randomBytes(32).toString('base64url');
    let server, timer;
    try {
      let resolveCode, rejectCode;
      const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
      // 시작 실패 시에도 미처리 rejection을 남기지 않는다.
      codePromise.catch(() => {});
      server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/oauth' || u.searchParams.get('state') !== state) { res.writeHead(400); res.end('Invalid callback'); return; }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('Priming으로 돌아가 연결 결과를 확인하세요.');
        if (u.searchParams.get('error')) rejectCode(Error('Google 연결을 취소했습니다'));
        else if (u.searchParams.get('code')) resolveCode(u.searchParams.get('code'));
        else rejectCode(Error('Google 인증 코드가 없습니다'));
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const redirect = `http://127.0.0.1:${server.address().port}/oauth`;
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: db.client.client_id, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', login_hint: email, state, code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') });
      timer = setTimeout(() => rejectCode(Error('Google 로그인 시간이 지났습니다. 다시 연결하세요')), 180000);
      await openExternal(url.toString());
      const code = await codePromise;
      const t = await tokenPost({ client_id: db.client.client_id, client_secret: db.client.client_secret, code, redirect_uri: redirect, code_verifier: verifier, grant_type: 'authorization_code' });
      if (!t.refresh_token || !SCOPES.every(s => String(t.scope || '').split(' ').includes(s))) throw Error('메일 읽기·초안 및 발송 권한을 모두 허용해야 합니다');
      const profile = await request('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: 'Bearer ' + t.access_token } });
      if (String(profile.emailAddress).toLowerCase() !== email.toLowerCase()) throw Error('선택한 Google 계정이 입력한 메일 주소와 다릅니다');
      db.refresh = t.refresh_token; db.email = profile.emailAddress; save(db);
      access = { value: t.access_token, until: Date.now() + t.expires_in * 1000 };
      return status();
    } finally { connecting = false; clearTimeout(timer); if (server) server.close(); }
  }
  function disconnect() { const db = load(); delete db.refresh; delete db.email; save(db); access = null; return status(); }
  return { api, load, save, status, importClient, connect, disconnect };
}
module.exports = { createClient, SCOPES };
