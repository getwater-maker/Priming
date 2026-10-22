'use strict';
/**
 * license-oauth.js — 🔐 구글로 한 번에 로그인(v0.9.100 · 로이 2026-10-23)
 * 앱은 구글 창을 직접 띄우지 못하므로 ① 기본 브라우저로 Supabase 의 구글 로그인을 열고 ② 이 PC 의 127.0.0.1 임시 서버로 돌아오는 코드를 받아
 * ③ PKCE 로 세션과 맞바꾼다(비밀 값 없음 · 코드는 verifier 없이는 쓸모없다). 서버 약속 = docs/요청서_wise-priming-구글로그인·교차노출.md
 * 순수 함수 + 임시 서버만 — Electron 에 의존하지 않는다(시험 가능).
 */
const crypto = require('crypto');
const http = require('http');

const PORTS = Array.from({ length: 10 }, (_, i) => 53682 + i);   // Supabase Redirect URLs 에 http://127.0.0.1:<포트>/cb 로 올려 둔다
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makePkce() {
  const verifier = b64u(crypto.randomBytes(48));   // 64자
  return { verifier, challenge: b64u(crypto.createHash('sha256').update(verifier).digest()) };
}
const authorizeUrl = (base, port, challenge) =>
  `${base}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(`http://127.0.0.1:${port}/cb`)}&code_challenge=${challenge}&code_challenge_method=s256`;

const PAGE = (ok) => `<!doctype html><meta charset="utf-8"><title>Priming</title><body style="font-family:'Malgun Gothic',sans-serif;background:#faf6f0;color:#3a342e;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:42px">${ok ? '✅' : '⚠️'}</div><h2>${ok ? '로그인이 끝났습니다' : '로그인하지 못했습니다'}</h2><p>${ok ? '이 창을 닫고 Priming 앱으로 돌아가세요.' : '앱으로 돌아가 다시 시도하세요.'}</p></div>`;

/** 빈 포트에 임시 서버를 열고 돌아온 code 를 기다린다. cancel() 로 중단. → { port, wait: Promise<{code}|{error}>, cancel } */
async function listen(timeoutMs = 3 * 60 * 1000, ports = PORTS) {
  let resolve; const wait = new Promise((r) => { resolve = r; });
  let server = null, timer = null;
  const done = (v) => { if (timer) clearTimeout(timer); timer = null; const s = server; server = null; if (s) setTimeout(() => { try { s.close(); } catch (_) {} }, 400); resolve(v); };
  const handler = (req, res) => {
    let u; try { u = new URL(req.url, 'http://127.0.0.1'); } catch (_) { res.writeHead(400); res.end(); return; }
    if (u.pathname !== '/cb') { res.writeHead(404); res.end(); return; }
    const code = u.searchParams.get('code'), err = u.searchParams.get('error') || u.searchParams.get('error_code');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(PAGE(!!code && !err));
    if (code && !err) done({ code }); else done({ error: err || 'no_code' });
  };
  let port = 0;
  for (const p of ports) {
    const s = http.createServer(handler);
    const okListen = await new Promise((r) => { s.once('error', () => r(false)); s.listen(p, '127.0.0.1', () => r(true)); });
    if (okListen) { server = s; port = p; break; }
  }
  if (!server) return { port: 0, wait: Promise.resolve({ error: 'busy' }), cancel() {} };
  timer = setTimeout(() => done({ error: 'timeout' }), timeoutMs);
  return { port, wait, cancel: () => done({ error: 'cancelled' }) };
}

module.exports = { PORTS, makePkce, authorizeUrl, listen };
