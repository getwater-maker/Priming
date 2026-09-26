'use strict';
/**
 * youtube-upload.js — 🎬 유튜브 MP4 를 **비공개**로 채널에 올린다 (2026-09-24, v0.5.31)
 *
 * 로이 결정: 업로드 전용 구글 클라우드 프로젝트 「Priming Upload」(분석용 AdonaiRoy 와 분리 — YPP 정지 전염 우려 기록).
 *   앱이 하는 일 = 비공개 업로드 + 제목 + 설명 + AI 합성 표시. 공개·예약·썸네일·재생목록은 로이가 Studio 에서.
 *
 * 🔑 미심사(unverified) 프로젝트라 **API 로 올린 영상은 구글이 비공개로 강제한다** — public 을 보내도 소용없다.
 *   그래서 처음부터 private 로 보낸다(요청과 결과가 같아야 로그가 거짓말을 안 한다).
 *
 * 저장(이 PC 에만): ~/.priming-maker/youtube-auth.json
 *   { v, client: <암호화된 {clientId, clientSecret, projectId}>, channels: { <채널ID>: { title, handle, refresh: <암호화>, connectedAt } } }
 *   · 🔒 암호화 = Electron safeStorage(윈도우 DPAPI — 이 윈도우 사용자에 묶인다. 다른 PC 로 복사해도 안 열린다).
 *     못 쓰는 환경이면 **저장을 거부**한다(평문으로 몰래 남기지 않는다 — account-creds.js 와 같은 정책).
 *   · 채널 연결은 **PC·계정별로 독립** — 아내 PC 는 같은 클라이언트 파일 + 아내 계정으로 자기 채널을 연결한다.
 *
 * 🔑 npm 의존성 없이 fetch 로 REST 를 직접 부른다 — deps 가 바뀌면 라이트 업데이트가 막힌다.
 * ⚠ 어떤 공개 함수도 던지지 않는다 — { ok:false, error } 로 돌려준다(렌더 30분을 업로드 실패가 망치지 않게).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');

const SCOPE_UPLOAD = 'https://www.googleapis.com/auth/youtube.upload';
const SCOPE_READ = 'https://www.googleapis.com/auth/youtube.readonly';
const SCOPES = [SCOPE_UPLOAD, SCOPE_READ];

// 테스트가 가짜 서버로 갈아끼운다(_setEndpoints).
const EP = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  api: 'https://www.googleapis.com/youtube/v3',
  upload: 'https://www.googleapis.com/upload/youtube/v3/videos',
};
function _setEndpoints(p) { Object.assign(EP, p || {}); }

function _dir() { return path.join(os.homedir(), '.priming-maker'); }
function authFile() { return path.join(_dir(), 'youtube-auth.json'); }
function uploadsFile() { return path.join(_dir(), 'youtube-uploads.json'); }

// ── 암호화 ───────────────────────────────────────────────────────────────
let _cryptoOverride = null;   // 테스트용 {enc, dec}
function _setCrypto(c) { _cryptoOverride = c; }
function _cipher() {
  if (_cryptoOverride) return _cryptoOverride;
  try {
    const { safeStorage } = require('electron');
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return {
        enc: (s) => safeStorage.encryptString(String(s)).toString('base64'),
        dec: (b) => { try { return safeStorage.decryptString(Buffer.from(String(b), 'base64')); } catch (_) { return ''; } },
      };
    }
  } catch (_) { /* electron 밖 */ }
  return null;
}
function available() { return !!_cipher(); }

function _load() {
  try {
    const j = JSON.parse(fs.readFileSync(authFile(), 'utf8'));
    if (j && typeof j === 'object') return { v: 1, client: j.client || '', channels: j.channels || {} };
  } catch (_) {}
  return { v: 1, client: '', channels: {} };
}
function _save(d) {
  try {
    fs.mkdirSync(_dir(), { recursive: true });
    const tmp = authFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2), 'utf8');
    fs.renameSync(tmp, authFile());
    return true;
  } catch (_) { return false; }
}

// KST(+09:00) 표기 — 전역 지침: 시각은 KST 로
function _kst(ts = Date.now()) {
  const d = new Date(ts + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// ── 클라이언트 파일(구글 클라우드에서 받은 JSON) ──────────────────────────────
/** 받은 파일 내용 → {clientId, clientSecret, projectId}. 데스크톱 앱 유형(installed)만 받는다. */
function parseClientJson(text) {
  let j;
  try { j = JSON.parse(String(text || '')); } catch (_) { return { ok: false, error: 'JSON 파일이 아닙니다 — 구글 클라우드에서 받은 client_secret_….json 파일을 고르세요.' }; }
  if (j && j.web && !j.installed) return { ok: false, error: '「웹 애플리케이션」 유형 파일입니다 — 구글 클라우드에서 「데스크톱 앱」 유형으로 만든 클라이언트 파일을 고르세요.' };
  const c = j && j.installed;
  if (!c || !c.client_id || !c.client_secret) return { ok: false, error: '유튜브 연결 파일이 아닙니다(client_id·client_secret 이 없습니다). 구글 클라우드 → 클라이언트 → JSON 다운로드로 받은 파일을 고르세요.' };
  return { ok: true, clientId: String(c.client_id), clientSecret: String(c.client_secret), projectId: String(c.project_id || '') };
}

/** 📥 파일 가져오기 — 사용자가 폴더에 복사할 필요 없이 앱이 받아 암호화 저장한다. */
function importClient(filePath) {
  const ci = _cipher();
  if (!ci) return { ok: false, error: '이 PC 에서는 OS 암호화(safeStorage)를 쓸 수 없어 저장하지 않았습니다.' };
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch (e) { return { ok: false, error: `파일을 읽지 못했습니다: ${e.message}` }; }
  const p = parseClientJson(text);
  if (!p.ok) return p;
  const d = _load();
  const prev = _getClient(d);
  d.client = ci.enc(JSON.stringify({ clientId: p.clientId, clientSecret: p.clientSecret, projectId: p.projectId }));
  // 🔑 다른 프로젝트의 파일로 바꾸면 기존 채널 연결(갱신 토큰)은 **그 프로젝트 것**이라 못 쓴다 → 비운다(재연결 안내).
  let cleared = 0;
  if (prev && prev.clientId !== p.clientId) { cleared = Object.keys(d.channels).length; d.channels = {}; }
  _tok.clear();
  if (!_save(d)) return { ok: false, error: '설정 파일 저장 실패' };
  return { ok: true, projectId: p.projectId, cleared };
}

function _getClient(d = _load()) {
  const ci = _cipher();
  if (!ci || !d.client) return null;
  try { const c = JSON.parse(ci.dec(d.client) || 'null'); return c && c.clientId && c.clientSecret ? c : null; } catch (_) { return null; }
}

/** UI 용 상태 — 비밀값은 하나도 내보내지 않는다. */
function status() {
  const d = _load();
  const c = _getClient(d);
  const channels = Object.keys(d.channels).map((id) => {
    const x = d.channels[id] || {};
    return { id, title: x.title || id, handle: x.handle || '', connectedAt: x.connectedAt || '', broken: !!x.broken };
  });
  return { available: available(), hasClient: !!c, projectId: c ? c.projectId : '', channels };
}

// ── 채널 연결(OAuth 루프백 + PKCE) ───────────────────────────────────────────
const _b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function _json(res) { try { return await res.json(); } catch (_) { return {}; } }

async function _postForm(url, obj) {
  const body = new URLSearchParams(obj).toString();
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  return { status: res.status, json: await _json(res) };
}

function _page(title, msg) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:'Malgun Gothic',sans-serif;background:#f7f1e8;color:#3b2f25;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="background:#fff;border:1px solid #e3d6c4;border-radius:12px;padding:28px 36px;max-width:460px;text-align:center">
<h2 style="margin:0 0 10px">${title}</h2><p style="line-height:1.6;margin:0">${msg}</p></div></body>`;
}

/**
 * 🔗 채널 연결 — 브라우저에서 구글 로그인 → 채널 선택 → 허용.
 * @param {{openUrl:(url:string)=>void, log?:Function, timeoutMs?:number}} o
 */
async function connectChannel(o = {}) {
  const log = o.log || (() => {});
  const d = _load();
  const client = _getClient(d);
  if (!client) return { ok: false, error: '유튜브 연결 파일을 먼저 가져오세요(⚙ 설정 → ▶ 유튜브 → 📥 파일 가져오기).' };
  const ci = _cipher();
  if (!ci) return { ok: false, error: '이 PC 에서는 OS 암호화(safeStorage)를 쓸 수 없어 연결 정보를 저장할 수 없습니다.' };

  const verifier = _b64url(crypto.randomBytes(48));
  const challenge = _b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = _b64url(crypto.randomBytes(16));

  let server;
  const codeP = new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let u;
      try { u = new URL(req.url, 'http://127.0.0.1'); } catch (_) { res.end(); return; }
      if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }   // favicon 등
      const q = u.searchParams;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (q.get('state') !== state) { res.end(_page('연결 실패', '요청이 맞지 않습니다. 앱에서 다시 「🔗 채널 연결」을 누르세요.')); resolve({ error: 'state 불일치' }); return; }
      if (q.get('error')) {
        res.end(_page('연결하지 않았습니다', '허용하지 않으셨습니다. 이 창을 닫고 앱으로 돌아가세요.'));
        resolve({ error: q.get('error') === 'access_denied' ? '허용하지 않았습니다(연결 취소).' : `구글 오류: ${q.get('error')}` });
        return;
      }
      res.end(_page('✅ 연결 중입니다', '이 창을 닫고 Priming 으로 돌아가세요.'));
      resolve({ code: q.get('code') });
    });
    server.listen(0, '127.0.0.1');
  });
  await new Promise((r) => server.once('listening', r));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const url = `${EP.auth}?` + new URLSearchParams({
    client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline',
    // select_account = 채널(브랜드 계정) 고르는 화면을 매번 띄운다 · consent = 갱신 토큰을 반드시 받는다
    prompt: 'select_account consent',
    state, code_challenge: challenge, code_challenge_method: 'S256',
  }).toString();

  const timeoutMs = o.timeoutMs || 5 * 60 * 1000;
  let timer;
  const timeoutP = new Promise((r) => { timer = setTimeout(() => r({ error: '5분 안에 연결을 마치지 않아 취소했습니다. 다시 「🔗 채널 연결」을 누르세요.' }), timeoutMs); });
  try {
    log('🔗 유튜브 채널 연결 — 브라우저에서 구글 로그인 → 채널 선택 → 허용을 눌러 주세요');
    try { await o.openUrl(url); } catch (e) { return { ok: false, error: `브라우저를 열지 못했습니다: ${e.message}` }; }
    const got = await Promise.race([codeP, timeoutP]);
    if (got.error) return { ok: false, error: got.error };

    const tk = await _postForm(EP.token, {
      code: got.code, client_id: client.clientId, client_secret: client.clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier,
    });
    if (tk.status !== 200 || !tk.json.access_token) return { ok: false, error: `토큰 교환 실패(${tk.status}): ${tk.json.error_description || tk.json.error || ''}` };
    // 🔑 구글은 권한마다 체크박스를 준다 — 업로드를 끄고 허용하면 연결은 되는데 올릴 때 403 이 난다. 여기서 막는다.
    const granted = String(tk.json.scope || '');
    if (!granted.includes(SCOPE_UPLOAD)) return { ok: false, error: '「YouTube 동영상 관리」 권한 체크를 해제하셨습니다 — 다시 연결하면서 모두 허용해 주세요.' };
    if (!tk.json.refresh_token) return { ok: false, error: '구글이 장기 연결 토큰을 주지 않았습니다 — https://myaccount.google.com/permissions 에서 Priming 을 지운 뒤 다시 연결하세요.' };

    const me = await fetch(`${EP.api}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${tk.json.access_token}` } });
    const mj = await _json(me);
    const ch = mj.items && mj.items[0];
    if (!ch) return { ok: false, error: '이 계정에는 유튜브 채널이 없습니다 — 로그인 뒤 「채널 선택」 화면에서 올릴 채널을 고르세요.' };

    const d2 = _load();
    d2.channels[ch.id] = {
      title: (ch.snippet && ch.snippet.title) || ch.id,
      handle: (ch.snippet && ch.snippet.customUrl) || '',
      refresh: ci.enc(tk.json.refresh_token),
      connectedAt: _kst(),
    };
    if (!_save(d2)) return { ok: false, error: '연결 정보 저장 실패' };
    _tok.set(ch.id, { token: tk.json.access_token, exp: Date.now() + (Number(tk.json.expires_in) || 3600) * 1000 });
    log(`✅ 유튜브 채널 연결됨 — ${d2.channels[ch.id].title}`);
    return { ok: true, channel: { id: ch.id, title: d2.channels[ch.id].title, handle: d2.channels[ch.id].handle } };
  } catch (e) {
    return { ok: false, error: `연결 실패: ${e.message}` };
  } finally {
    clearTimeout(timer);
    try { server.close(); } catch (_) {}
  }
}

/** 연결 해제 — 구글 쪽 토큰도 철회를 시도한다(실패해도 로컬은 지운다). */
async function disconnect(channelId) {
  const d = _load();
  const x = d.channels[channelId];
  if (!x) return { ok: true };
  const ci = _cipher();
  const rt = ci ? ci.dec(x.refresh) : '';
  if (rt) { try { await _postForm(EP.revoke, { token: rt }); } catch (_) {} }
  delete d.channels[channelId];
  _tok.delete(channelId);
  return _save(d) ? { ok: true } : { ok: false, error: '설정 파일 저장 실패' };
}

// ── 접근 토큰(1시간짜리) ──────────────────────────────────────────────────────
const _tok = new Map();
async function accessToken(channelId, { force = false } = {}) {
  const c = _tok.get(channelId);
  if (!force && c && c.exp - Date.now() > 60 * 1000) return { ok: true, token: c.token };
  const d = _load();
  const x = d.channels[channelId];
  if (!x) return { ok: false, error: '이 채널은 이 PC 에서 연결되지 않았습니다 — ⚙ 설정 → ▶ 유튜브에서 「🔗 채널 연결」을 하세요.' };
  const client = _getClient(d);
  const ci = _cipher();
  const rt = ci ? ci.dec(x.refresh) : '';
  if (!client || !rt) return { ok: false, error: '연결 정보를 읽지 못했습니다 — 채널을 다시 연결하세요.' };
  let r;
  try { r = await _postForm(EP.token, { client_id: client.clientId, client_secret: client.clientSecret, refresh_token: rt, grant_type: 'refresh_token' }); }
  catch (e) { return { ok: false, error: `구글에 연결하지 못했습니다: ${e.message}`, network: true }; }
  if (r.status !== 200 || !r.json.access_token) {
    if (r.json.error === 'invalid_grant') {
      const d2 = _load(); if (d2.channels[channelId]) { d2.channels[channelId].broken = true; _save(d2); }
      return { ok: false, error: `「${x.title}」 연결이 끊겼습니다(구글에서 권한 해제·비밀번호 변경 등) — ⚙ 설정 → ▶ 유튜브에서 다시 연결하세요.` };
    }
    return { ok: false, error: `토큰 갱신 실패(${r.status}): ${r.json.error_description || r.json.error || ''}` };
  }
  _tok.set(channelId, { token: r.json.access_token, exp: Date.now() + (Number(r.json.expires_in) || 3600) * 1000 });
  return { ok: true, token: r.json.access_token };
}

// ── 메타데이터 정리 (유튜브 규칙) ───────────────────────────────────────────
/** 제목 — 100자 · `<` `>` 불가 · 줄바꿈 불가 */
function cleanTitle(t) {
  const s = String(t || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 100).join('');
}
/** 설명 — 5000 바이트 · `<` `>` 불가 */
function cleanDescription(t) {
  let s = String(t || '').replace(/[<>]/g, '').replace(/\r\n/g, '\n').trim();
  while (Buffer.byteLength(s, 'utf8') > 5000) s = Array.from(s).slice(0, -20).join('');
  return s;
}
/** 태그 — 합계 500자(공백 든 태그는 따옴표 2자 추가로 센다) · 쉼표·꺾쇠 불가 */
function cleanTags(tags) {
  const out = []; let total = 0; const seen = new Set();
  for (const raw of (tags || [])) {
    const t = String(raw || '').replace(/[<>,#]/g, '').replace(/\s+/g, ' ').trim();
    if (!t || seen.has(t)) continue;
    const cost = Array.from(t).length + (/\s/.test(t) ? 2 : 0) + (out.length ? 1 : 0);
    if (total + cost > 500) break;
    out.push(t); seen.add(t); total += cost;
  }
  return out;
}

/** 유튜브 오류 이유 → 사람 말 */
function explainApiError(status, j) {
  const e = (j && j.error) || {};
  const reason = (e.errors && e.errors[0] && e.errors[0].reason) || e.status || '';
  const msg = e.message || '';
  const map = {
    quotaExceeded: '오늘 업로드 할당량(구글 API)을 다 썼습니다 — 한국 시간 오후 4~5시(태평양 자정)에 초기화됩니다. 그 뒤 「⬆ 업로드」를 다시 누르세요.',
    uploadLimitExceeded: '이 채널의 하루 업로드 한도에 도달했습니다 — 내일 다시 올리세요.',
    youtubeSignupRequired: '이 계정에는 유튜브 채널이 없습니다 — 채널을 다시 연결하면서 올릴 채널을 고르세요.',
    insufficientPermissions: '업로드 권한이 없습니다 — 채널을 다시 연결하면서 모든 권한을 허용하세요.',
    forbidden: '구글이 업로드를 거부했습니다(권한). 채널을 다시 연결해 보세요.',
    invalidTitle: '제목이 유튜브 규칙에 맞지 않습니다(빈 제목·100자 초과).',
    invalidDescription: '설명이 유튜브 규칙에 맞지 않습니다(5000바이트 초과·꺾쇠 문자).',
    invalidTags: '태그가 유튜브 규칙에 맞지 않습니다.',
    mediaBodyRequired: '영상 파일이 전송되지 않았습니다.',
  };
  if (map[reason]) return map[reason];
  return `유튜브 오류 ${status}${reason ? ` (${reason})` : ''}${msg ? ` — ${msg}` : ''}`;
}

// ── 업로드 기록(같은 파일을 두 번 올리지 않게) ───────────────────────────────
function _uploads() { try { return JSON.parse(fs.readFileSync(uploadsFile(), 'utf8')) || {}; } catch (_) { return {}; } }
function _fileSig(channelId, file) {
  try { const st = fs.statSync(file); return `${channelId}|${path.basename(file)}|${st.size}|${Math.round(st.mtimeMs)}`; } catch (_) { return ''; }
}
/** 이 채널에 이 파일(이름·크기·수정시각이 같은 것)을 이미 올렸나 → {videoId, at} | null */
function findUploaded(channelId, file) {
  const k = _fileSig(channelId, file);
  return (k && _uploads()[k]) || null;
}
function _recordUpload(channelId, file, rec) {
  const k = _fileSig(channelId, file);
  if (!k) return;
  const all = _uploads(); all[k] = rec;
  try { fs.mkdirSync(_dir(), { recursive: true }); fs.writeFileSync(uploadsFile(), JSON.stringify(all, null, 2), 'utf8'); } catch (_) {}
}

// ── 재개 가능 업로드 ────────────────────────────────────────────────────────
const CHUNK = 8 * 1024 * 1024;               // 8MB — 256KB 의 배수여야 한다(구글 규약)
const BACKOFF = [1, 2, 4, 8, 15, 30, 30, 30]; // 초

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function _readChunk(fd, start, len) {
  const buf = Buffer.alloc(len);
  let got = 0;
  while (got < len) { const n = fs.readSync(fd, buf, got, len - got, start + got); if (!n) break; got += n; }
  return got === len ? buf : buf.subarray(0, got);
}
function _rangeEnd(res) {
  const r = res.headers.get('range');   // "bytes=0-8388607"
  const m = r && /bytes=\d+-(\d+)/.exec(r);
  return m ? Number(m[1]) + 1 : 0;
}

/**
 * ⬆ 비공개 업로드.
 * @param {{channelId:string, file:string, title:string, description?:string, tags?:string[],
 *          synthetic?:boolean, madeForKids?:boolean, log?:Function, onProgress?:Function,
 *          isAborted?:Function, chunkSize?:number, backoff?:number[]}} o
 * @returns {Promise<{ok:boolean, videoId?:string, url?:string, studioUrl?:string, privacy?:string, error?:string, cancelled?:boolean}>}
 */
async function uploadVideo(o = {}) {
  const log = o.log || (() => {});
  const onProgress = o.onProgress || (() => {});
  const isAborted = o.isAborted || (() => false);
  const chunkSize = o.chunkSize || CHUNK;
  const backoff = o.backoff || BACKOFF;
  let size;
  try { size = fs.statSync(o.file).size; } catch (e) { return { ok: false, error: `영상 파일이 없습니다: ${o.file}` }; }
  if (!size) return { ok: false, error: '영상 파일이 비어 있습니다.' };
  const title = cleanTitle(o.title);
  if (!title) return { ok: false, error: '제목이 비어 있습니다.' };
  const meta = {
    snippet: {
      title,
      description: cleanDescription(o.description),
      tags: cleanTags(o.tags),
      // 🌏 영상 언어 — 대본 문장으로 판별한 값(일본어·베트남어 채널). 없으면 ko(예전 그대로).
      defaultLanguage: o.language || 'ko',
      defaultAudioLanguage: o.language || 'ko',
    },
    status: {
      privacyStatus: 'private',                          // 🔑 미심사 프로젝트는 어차피 비공개로 강제된다
      selfDeclaredMadeForKids: !!o.madeForKids,          // 아동용 아님(로이 채널 기본) — Studio 에서 바꿀 수 있다
      containsSyntheticMedia: o.synthetic !== false,     // 🤖 「변경되거나 합성된 콘텐츠」 = 예 (AI 음성·이미지)
    },
  };
  const startedAt = Date.now();
  const tick = (phase, sent, extra = {}) => { try { onProgress({ phase, sent, total: size, startedAt, ...extra }); } catch (_) {} };

  const tok = async (force) => { const t = await accessToken(o.channelId, { force }); if (!t.ok) throw Object.assign(new Error(t.error), { fatal: !t.network }); return t.token; };

  // ① 세션 시작 — 응답 Location 이 이 업로드의 주소다
  const begin = async () => {
    for (let a = 0; ; a++) {
      let res;
      try {
        res = await fetch(`${EP.upload}?uploadType=resumable&part=snippet,status`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await tok(a > 0)}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Length': String(size),
            'X-Upload-Content-Type': 'video/mp4',
          },
          body: JSON.stringify(meta),
        });
      } catch (e) {
        if (e.fatal) throw e;
        if (a >= backoff.length) throw new Error(`구글에 연결하지 못했습니다: ${e.message}`);
        log(`⚠ 업로드 시작 실패(${e.message}) — ${backoff[a]}초 뒤 다시`); await _sleep(backoff[a] * 1000); continue;
      }
      if (res.status === 200 || res.status === 201) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error('업로드 주소를 받지 못했습니다.');
        return loc;
      }
      const j = await _json(res);
      if (res.status === 401 && a === 0) continue;                        // 토큰 만료 → 한 번 갱신
      if (res.status >= 500 && a < backoff.length) { await _sleep(backoff[a] * 1000); continue; }
      throw new Error(explainApiError(res.status, j));
    }
  };

  let fd;
  try {
    tick('prepare', 0);
    let loc = await begin();
    fd = fs.openSync(o.file, 'r');
    let offset = 0, fails = 0, restarted = false;
    tick('upload', 0);
    for (;;) {
      if (isAborted()) { log('⏹ 유튜브 업로드 중단 — 다시 「⬆ 업로드」를 누르면 처음부터 올립니다'); return { ok: false, cancelled: true, error: '중단됨' }; }
      const len = Math.min(chunkSize, size - offset);
      let res;
      try {
        const body = _readChunk(fd, offset, len);
        res = await fetch(loc, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${await tok(false)}`, 'Content-Length': String(body.length), 'Content-Range': `bytes ${offset}-${offset + body.length - 1}/${size}` },
          body,
        });
      } catch (e) {
        if (e.fatal) throw e;
        res = null;
        log(`⚠ 업로드 끊김(${e.message})`);
      }
      if (res && (res.status === 200 || res.status === 201)) {
        const j = await _json(res);
        tick('upload', size);
        const id = j.id;
        if (!id) throw new Error('업로드는 끝났는데 영상 ID 를 받지 못했습니다.');
        const got = (j.snippet && j.snippet.channelId) || '';
        if (got && got !== o.channelId) log(`⚠ 올라간 채널이 다릅니다(${got}) — Studio 에서 확인하세요`);
        const out = {
          ok: true, videoId: id,
          url: `https://youtu.be/${id}`,
          studioUrl: `https://studio.youtube.com/video/${id}/edit`,
          privacy: (j.status && j.status.privacyStatus) || 'private',
          sec: (Date.now() - startedAt) / 1000,
        };
        _recordUpload(o.channelId, o.file, { videoId: id, at: _kst(), title });
        tick('done', size, out);
        return out;
      }
      if (res && res.status === 308) {                                     // 이 조각 받음 — 다음 조각
        offset = _rangeEnd(res); fails = 0;
        tick('upload', offset);
        continue;
      }
      if (res && res.status === 401) { await tok(true); continue; }         // 토큰 만료 → 갱신 후 같은 조각
      if (res && (res.status === 404 || res.status === 410)) {             // 세션 만료 → 처음부터 한 번
        if (restarted) throw new Error('업로드 세션이 두 번 만료됐습니다 — 잠시 뒤 다시 올리세요.');
        restarted = true; log('⚠ 업로드 세션이 만료돼 처음부터 다시 올립니다');
        loc = await begin(); offset = 0; continue;
      }
      if (res && res.status < 500) throw new Error(explainApiError(res.status, await _json(res)));
      // 5xx · 네트워크 → 기다렸다가 「어디까지 받았나」를 물어 그 지점부터 잇는다
      if (fails >= backoff.length) throw new Error(`업로드가 계속 끊깁니다(${fails}회) — 인터넷을 확인한 뒤 다시 올리세요.`);
      const w = backoff[fails++];
      log(`⚠ 업로드 재시도 ${fails}/${backoff.length} — ${w}초 뒤 이어서 올립니다`);
      await _sleep(w * 1000);
      try {
        const q = await fetch(loc, { method: 'PUT', headers: { Authorization: `Bearer ${await tok(false)}`, 'Content-Length': '0', 'Content-Range': `bytes */${size}` } });
        if (q.status === 308) offset = _rangeEnd(q);
        else if (q.status === 200 || q.status === 201) { /* 사실 다 받았다 → 다음 루프가 마지막 조각을 다시 보내 200 을 받는다 */ }
      } catch (_) { /* 다음 루프에서 다시 */ }
    }
  } catch (e) {
    const err = e.message || String(e);
    tick('error', 0, { error: err });
    return { ok: false, error: err };
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

/**
 * ↕ 연결된 채널 순서 바꾸기(⚙ 설정 → ▶ 유튜브에서 끌어서 · v0.5.81) — 저장 파일의 channels 순서가 곧 표시 순서다
 *   (설정 목록 · 채널편집 「업로드채널」 목록 둘 다 status() 순서). 모르는 ID 는 무시, 빠진 채널은 뒤에 원래 순서로 붙인다(잃지 않는다).
 *   채널 ID 는 「UC…」 라 숫자 키 정렬 규칙에 걸리지 않는다. 다시 연결해도 자리는 그대로(기존 키에 덮어쓰기).
 */
function reorderChannels(ids) {
  const d = _load();
  const next = {};
  for (const id of (Array.isArray(ids) ? ids : [])) if (d.channels[id] && !next[id]) next[id] = d.channels[id];
  for (const id of Object.keys(d.channels)) if (!next[id]) next[id] = d.channels[id];
  d.channels = next;
  return _save(d) ? { ok: true, order: Object.keys(next) } : { ok: false, error: '설정 파일 저장 실패' };
}

module.exports = {
  SCOPES, available, status, parseClientJson, importClient, connectChannel, disconnect, accessToken, reorderChannels,
  uploadVideo, findUploaded, cleanTitle, cleanDescription, cleanTags, explainApiError,
  authFile, uploadsFile, _setEndpoints, _setCrypto,
};
