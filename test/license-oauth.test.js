'use strict';
// node test/license-oauth.test.js — 🔐 구글 로그인(PKCE · 로컬 복귀) 순수 부분(core/license-oauth) + 세션 교환·상품 조회(core/license)
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const OA = require('../core/license-oauth');
const { createLicense, isSiteUrl } = require('../core/license');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const get = (url) => new Promise((res, rej) => http.get(url, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej));

(async () => {
  console.log('[1] PKCE · 주소');
  const a = OA.makePkce(), b = OA.makePkce();
  const expect = crypto.createHash('sha256').update(a.verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  ok(a.challenge === expect && /^[A-Za-z0-9_-]{43,128}$/.test(a.verifier) && a.verifier !== b.verifier, 'challenge = base64url(sha256(verifier)) · verifier 는 매번 다르다');
  const u = new URL(OA.authorizeUrl('https://x.supabase.co', 53682, a.challenge));
  ok(u.pathname === '/auth/v1/authorize' && u.searchParams.get('provider') === 'google' && u.searchParams.get('redirect_to') === 'http://127.0.0.1:53682/cb' && u.searchParams.get('code_challenge_method') === 's256', '인증 주소: 구글 · 127.0.0.1 복귀 · s256');
  ok(OA.PORTS.length === 10 && OA.PORTS[0] === 53682 && OA.PORTS[9] === 53691, '복귀 포트 53682~53691(Supabase 등록 목록과 같다)');

  console.log('[2] 로컬 복귀 서버');
  { const l = await OA.listen(5000);
    ok(l.port >= 53682 && l.port <= 53691, '빈 포트에 열린다: ' + l.port);
    const bad = await get(`http://127.0.0.1:${l.port}/other`);
    ok(bad.status === 404, '/cb 가 아닌 주소는 무시(404)');
    const r = await get(`http://127.0.0.1:${l.port}/cb?code=ABC123`);
    ok(r.status === 200 && /로그인이 끝났습니다/.test(r.body), '코드가 오면 완료 안내 페이지');
    ok((await l.wait).code === 'ABC123', 'code 를 돌려준다'); }
  { const l1 = await OA.listen(5000), l2 = await OA.listen(5000);
    ok(l1.port !== l2.port && l2.port > 0, '포트가 쓰이는 중이면 다음 포트로');
    l1.cancel(); l2.cancel();
    ok((await l1.wait).error === 'cancelled', '취소'); }
  { const l = await OA.listen(5000); await get(`http://127.0.0.1:${l.port}/cb?error=access_denied`);
    ok((await l.wait).error === 'access_denied', '구글에서 거절하면 error'); }
  { const l = await OA.listen(150); ok((await l.wait).error === 'timeout', '시간 안에 안 오면 timeout'); }
  { const hold = []; for (const p of OA.PORTS) hold.push(await new Promise((r) => { const s = http.createServer(); s.once('error', () => r(null)); s.listen(p, '127.0.0.1', () => r(s)); }));
    const l = await OA.listen(1000); ok(l.port === 0 && (await l.wait).error === 'busy', '포트가 모두 막히면 busy');
    hold.forEach((s) => s && s.close()); }

  console.log('[3] 세션 교환 · 상품 조회');
  const calls = []; let prod = { ok: true, priming: { owned: false }, courses: [] };
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const f = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('grant_type=pkce')) { const b = JSON.parse(init.body); return b.auth_code === 'GOOD' && b.code_verifier ? res(200, { access_token: 'acc1', refresh_token: 'ref1', expires_in: 3600, user: { email: 'G@x.kr' } }) : res(400, {}); }
    if (url.endsWith('/rpc/priming_products')) return prod === 404 ? res(404, {}) : res(200, prod);
    return res(404, {});
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-oa-'));
  const L = createLicense({ dir, fetch: f, encrypt: (s) => Buffer.from('E' + Buffer.from(s).toString('base64')), decrypt: (b) => Buffer.from(b.toString().slice(1), 'base64').toString() });
  ok((await L.exchangeCode('BAD', 'v')).reason === 'google_failed', '틀린 code → google_failed');
  const x = await L.exchangeCode('GOOD', 'verifier-1');
  ok(x.ok && L.loadSession().email === 'G@x.kr' && calls.at(-1).body.code_verifier === 'verifier-1', 'code + verifier → 세션 저장');
  ok(L.readState().consentPending === 'g@x.kr', '구글로 들어온 사람도 약관 동의 기록 대기(소문자 이메일)');
  ok(await L.products() && (await L.products()).courses.length === 0, '강의 없음 → 빈 목록');
  prod = { ok: true, priming: { owned: true, expires_at: '2099-01-01' }, courses: [
    { slug: 'a', title: '강의 A', owned: false, url: 'https://www.primingwave.com/courses/a', summary: '요약' },
    { slug: 'b', title: '강의 B', owned: true, url: 'https://primingwave.com/courses/b' },
    { slug: 'c', title: '낯선 주소', owned: false, url: 'https://evil.example.com/x' },
    { slug: 'd', title: 'http 주소', owned: false, url: 'http://www.primingwave.com/x' } ] };
  const p = await L.products();
  ok(p.priming.owned && p.courses.map((c) => c.slug).join() === 'a,b', '우리 도메인(https) 강의만 통과 · 낯선·http 주소는 버림');
  ok(!isSiteUrl('https://primingwave.com.evil.com/') && !isSiteUrl('javascript:alert(1)') && isSiteUrl('https://www.primingwave.com/x'), '주소 판정(비슷한 도메인·스킴 거부)');
  prod = 404; ok((await L.products()) === null, '서버에 RPC 가 없으면 null(안내 숨김)');
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\n${fail ? '❌' : '✅'} license-oauth — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
