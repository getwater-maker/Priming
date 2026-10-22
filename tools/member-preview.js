'use strict';
// node tools/member-preview.js — 👀 회원 화면 미리보기(v0.9.97). 이 PC 안의 가짜 회원 서버(127.0.0.1)로 앱을 켠다 — 진짜 Supabase·계정·크레딧은 쓰지 않는다.
//   로그인 관문에서:  회원 member@test / 관리자 admin@test · 비밀번호 둘 다 pw-test-1
//   🆕 회원가입 탭: 아무 이메일·6자 이상 비밀번호로 가입 → 가입 코드 TRIAL-30(30일) · 1회용 코드 ONCE-7(7일). 코드 없이 가입하면 이용 기간 없음(not_member).
//   앱 저장 공간·큐·로그인 기록은 임시 폴더(PM_UI_SMOKE) — 켜 둔 진짜 앱·설정과 섞이지 않는다. 창을 닫으면 서버도 끝난다.
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const LDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'member-preview-'));
const accounts = {};   // 가입한 계정 { email: { pw, until } }
const usedCodes = new Set();
const CODES = { 'TRIAL-30': 30, 'ONCE-7': 7 };
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const j = body ? JSON.parse(body) : {};
    if (req.url.endsWith('/auth/v1/signup')) {
      if (accounts[j.email] || /^(member|admin)@test$/.test(j.email)) return send(422, { error_code: 'user_already_exists', msg: 'User already registered' });
      accounts[j.email] = { pw: j.password, until: 0 };
      return send(200, { access_token: 'A:' + j.email, refresh_token: 'R:' + j.email, expires_in: 3600, user: { email: j.email } });
    }
    if (req.url.includes('grant_type=password')) {
      if (!((j.password === 'pw-test-1' && /^(member|admin)@test$/.test(j.email)) || (accounts[j.email] && accounts[j.email].pw === j.password))) return send(400, { error: 'invalid_grant' });
      return send(200, { access_token: 'A:' + j.email, refresh_token: 'R:' + j.email, expires_in: 3600, user: { email: j.email } });
    }
    if (req.url.includes('grant_type=refresh_token')) { const e = String(j.refresh_token).slice(2); return send(200, { access_token: 'A:' + e, refresh_token: 'R:' + e, expires_in: 3600, user: { email: e } }); }
    const who = String(req.headers.authorization || '').replace('Bearer A:', '');
    if (req.url.endsWith('/rpc/priming_redeem_code')) {
      const a = accounts[who]; const code = String(j.p_code || '').trim().toUpperCase();
      if (!a) return send(401, { msg: 'jwt' });
      if (!CODES[code]) return send(200, { ok: false, reason: 'invalid_code' });
      if (code.startsWith('ONCE') && usedCodes.has(code)) return send(200, { ok: false, reason: 'already_used' });
      usedCodes.add(code); a.until = Math.max(a.until, Date.now()) + CODES[code] * 86400000;
      return send(200, { ok: true, days: CODES[code], expires_at: new Date(a.until).toISOString() });
    }
    if (req.url.endsWith('/rpc/priming_license')) {
      if (accounts[who]) { const a = accounts[who]; if (!a.until) return send(200, { ok: false, member: false, reason: 'not_member', devices: [] }); if (a.until < Date.now()) return send(200, { ok: false, member: true, reason: 'expired', devices: [] }); return send(200, { ok: true, member: true, admin: false, expires_at: new Date(a.until).toISOString(), device_limit: 2, devices: [{ device_id: j.p_device_id, name: j.p_device_name, last_seen: new Date().toISOString() }] }); }
      if (who === 'admin@test') return send(200, { ok: true, member: true, admin: true, expires_at: null, device_limit: null, devices: [] });
      if (who === 'member@test') return send(200, { ok: true, member: true, admin: false, expires_at: '2099-12-31T00:00:00Z', device_limit: 2, points_granted: 3000, points_remaining: 1250, devices: [{ device_id: j.p_device_id, name: j.p_device_name, last_seen: new Date().toISOString() }] });
      return send(401, { msg: 'jwt' });
    }
    if (req.url.endsWith('/rpc/priming_log')) return send(200, { ok: true, id: 1 });
    send(404, {});
  });
});
server.listen(0, '127.0.0.1', () => {
  const env = { ...process.env, PM_UI_SMOKE: '1', PM_LICENSE_FORCE: '1', PM_LICENSE_API: `http://127.0.0.1:${server.address().port}`, PM_LICENSE_DIR: LDIR, PM_ERRREP_DELAY_MS: '99999999' };
  console.log('회원 member@test / 관리자 admin@test · 비밀번호 pw-test-1');
  const ex = require('electron');
  spawn(ex, [ROOT], { env, stdio: 'inherit' }).on('exit', () => { server.close(); process.exit(0); });
});
