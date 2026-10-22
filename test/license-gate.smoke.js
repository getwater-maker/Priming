'use strict';
// node test/license-gate.smoke.js — 🔐 회원 로그인 관문 E2E(v0.9.26) — 이 PC 안의 가짜 회원 서버(127.0.0.1)로만. 진짜 Supabase·계정은 쓰지 않는다.
//   ① 로그인 전엔 관문만 보이고 main 이 제작 IPC 를 거부 ② 틀린 비밀번호 ③ 맞으면 앱이 열린다 ④ 회원 아님·PC 초과 안내
//   ⑤ 다시 켜면 저장된 로그인으로 바로(토큰은 암호화 저장) ⑥ 서버가 꺼져도 7일 여유 ⑦ 오류 줄 → 지운 로그가 서버로 ⑧ 👤 계정 탭 · 로그아웃
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const LDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-gate-'));
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 가짜 Supabase — 계정: good@test(회원) · nomember@test · full@test(PC 초과) · 비밀번호 'pw-test-1'
const SRV = { logs: [], licenseCalls: 0, down: false };
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (SRV.down) { req.socket.destroy(); return; }
    if (!req.headers.apikey) return send(401, { msg: 'no apikey' });
    const j = body ? JSON.parse(body) : {};
    if (req.url.endsWith('/auth/v1/signup')) { SRV.signups = (SRV.signups || 0) + 1; return send(200, { access_token: 'A:' + j.email, refresh_token: 'R:' + j.email, expires_in: 3600, user: { email: j.email } }); }
    if (req.url.includes('grant_type=password')) {
      if (j.password !== 'pw-test-1') return send(400, { error: 'invalid_grant' });
      return send(200, { access_token: 'A:' + j.email, refresh_token: 'R:' + j.email, expires_in: 3600, user: { email: j.email } });
    }
    if (req.url.includes('grant_type=refresh_token')) { const e = String(j.refresh_token).slice(2); return send(200, { access_token: 'A:' + e, refresh_token: 'R:' + e, expires_in: 3600, user: { email: e } }); }
    const who = String(req.headers.authorization || '').replace('Bearer A:', '');
    if (req.url.endsWith('/rpc/priming_license')) {
      SRV.licenseCalls++;
      if (who === 'nomember@test') return send(200, { ok: false, member: false, reason: 'not_member', devices: [] });
      if (who === 'full@test') return send(200, { ok: false, member: true, reason: 'device_limit', device_limit: 2, devices: [{ device_id: 'aaaaaaaa1', name: '집PC' }, { device_id: 'bbbbbbbb2', name: '회사PC' }] });
      if (who === 'admin@test') return send(200, { ok: true, member: true, admin: true, expires_at: null, device_limit: null, devices: [] });
      if (who === 'newbie@test.kr') return SRV.redeemed ? send(200, { ok: true, member: true, admin: false, expires_at: '2099-01-01T00:00:00Z', device_limit: 2, devices: [] }) : send(200, { ok: false, member: false, reason: 'not_member', devices: [] });
      if (who === 'good@test') return send(200, { ok: true, member: true, admin: false, expires_at: '2099-12-31T00:00:00Z', device_limit: 2, devices: [{ device_id: j.p_device_id, name: j.p_device_name, last_seen: '2026-10-15T00:00:00Z' }] });
      return send(401, { msg: 'jwt' });
    }
    if (req.url.endsWith('/rpc/accept_consents')) { SRV.consents = (SRV.consents || 0) + 1; return send(204, {}); }
    if (req.url.endsWith('/rpc/priming_redeem_code')) { if (j.p_code === 'CODE-30') { SRV.redeemed = true; return send(200, { ok: true, days: 30, expires_at: '2099-01-01T00:00:00Z' }); } return send(200, { ok: false, reason: 'invalid_code' }); }
    if (req.url.endsWith('/rpc/priming_log')) { SRV.logs.push(j); return send(200, { ok: true, id: SRV.logs.length }); }
    send(404, {});
  });
});

async function launch() {
  const port = server.address().port;
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1', PM_LICENSE_FORCE: '1', PM_LICENSE_API: `http://127.0.0.1:${port}`, PM_LICENSE_DIR: LDIR, PM_ERRREP_DELAY_MS: '1500' } });
  const win = await app.firstWindow();
  return { app, win };
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  let A = null;
  const errs = [];
  try {
    A = await launch();
    A.win.on('pageerror', (e) => errs.push(e.message));
    await A.win.waitForSelector('[data-testid="license-gate"]', { timeout: 20000 });
    ok(!(await A.win.$('[data-testid="app-title"]')), '① 로그인 전: 관문만 보이고 앱 화면은 없다');
    const blocked = await A.win.evaluate(async () => { try { await window.api.listThumbs(); return 'passed'; } catch (e) { return e.message; } });
    ok(/로그인이 필요/.test(blocked), '① main 이 로그인 전 IPC 를 거부: ' + blocked.slice(-40));

    const login = async (email, pw) => {
      await A.win.fill('[data-testid="license-email"]', email);
      await A.win.fill('[data-testid="license-password"]', pw);
      await A.win.click('[data-testid="license-login"]');
      await sleep(800);
    };
    await login('good@test', 'wrong');
    ok(/맞지 않습니다/.test(await A.win.textContent('[data-testid="license-msg"]')), '② 틀린 비밀번호 안내');
    await login('nomember@test', 'pw-test-1');
    ok(/이용 기간이 없습니다/.test(await A.win.textContent('[data-testid="license-msg"]')), '④ 회원 아님 안내');
    await A.win.click('text=다른 계정으로'); await sleep(400);
    await login('full@test', 'pw-test-1');
    const full = await A.win.textContent('[data-testid="license-gate"]');
    ok(/PC 2대/.test(full) && /집PC/.test(full) && /회사PC/.test(full), '④ PC 초과 안내 + 쓰는 PC 목록');
    await A.win.click('text=다른 계정으로'); await sleep(400);
    await login('good@test', 'pw-test-1');
    await A.win.waitForSelector('[data-testid="app-title"]', { timeout: 15000 });
    ok(true, '③ 맞는 회원 → 앱 화면이 열린다');
    const after = await A.win.evaluate(async () => { try { await window.api.listThumbs(); return 'ok'; } catch (e) { return e.message; } });
    ok(after === 'ok', '③ 로그인 뒤 IPC 가 열린다');
    const sess = fs.readFileSync(path.join(LDIR, 'session.bin'));
    ok(!sess.toString('latin1').includes('A:good@test') && !sess.toString('latin1').includes('R:good@test'), '🔐 토큰은 암호화 저장(파일에 평문 없음)');
    const st = await A.win.evaluate(() => window.api.licenseState());
    ok(st.email === 'good@test' && !('access' in st) && !JSON.stringify(st).includes('A:good'), '화면으로 오는 상태에 토큰이 없다');
    // 👑 로이 전용(v0.9.27) — 일반 회원은 owner=false · 관리자는 true · GPU 온도 기록·팝업은 isOwner() 뒤에서만
    ok(st.owner === false, '👑 일반 회원 = owner false(로이 전용 기능·안내 숨김)');
    { const M = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
      ok(/_awake\.n === 1 && isOwner\(\)\) \{ try \{ require\('\.\/core\/gpu-temp'\)\.startSampling/.test(M) && /if \(!isOwner\(\)\) throw 0;[^\n]*\n\s*const GT = require\('\.\/core\/gpu-temp'\)/.test(M), '👑 GPU 온도 기록·요약 팝업은 로이 PC 에서만(소스)');
      const APP = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'App.jsx'), 'utf8');
      ok(!/100\.112\.\d+\.\d+|192\.168\.219\.\d+/.test(APP) && /\{owner && <Hint>☁ 이 채널의 화풍은/.test(APP), '👑 화면에 로이 PC 주소가 없고 아도나이로이 안내는 owner 일 때만(소스)'); }

    // ⑦ 오류 자동 전송 — 지운 뒤 보낸다
    await A.win.evaluate(() => window.api.appendLog('✗ 시험 오류 — 키 sk-ant-AbCdEfGhIjKlMnOpQrSt 메일 roy@example.com 폴더 C:\\Users\\홍길동\\x'));
    for (let i = 0; i < 20 && !SRV.logs.length; i++) await sleep(300);
    const L0 = SRV.logs[0] || {};
    ok(SRV.logs.length === 1 && L0.p_kind === 'auto' && /시험 오류/.test(L0.p_summary || ''), '⑦ 오류 줄 → 서버에 자동 전송 1건: ' + (L0.p_summary || '').slice(0, 60));
    const all = JSON.stringify(L0);
    ok(!/sk-ant-AbCd|roy@example\.com|홍길동/.test(all), '⑦ 🔐 키·이메일·사용자 폴더는 지운 뒤 보냈다');
    await A.win.evaluate(() => window.api.appendLog('✗ 시험 오류 — 키 sk-ant-AbCdEfGhIjKlMnOpQrSt 메일 roy@example.com 폴더 C:\\Users\\홍길동\\x'));
    await sleep(2500);
    ok(SRV.logs.length === 1, '⑦ 같은 오류는 다시 안 보낸다');

    // ⑧ 👤 계정 탭
    const acc = await A.win.evaluate(async () => { const s = await window.api.licenseSetAutoLog(false); return s.autoLog; });
    ok(acc === false, '⑧ 오류 자동 전송 끄기');
    await A.win.evaluate(() => window.api.appendLog('✗ 다른 시험 오류'));
    await sleep(2500);
    ok(SRV.logs.length === 1, '⑧ 끄면 보내지 않는다');
    await A.win.evaluate(() => window.api.licenseSetAutoLog(true));
    await A.app.close(); A = null;

    // ⑤ 다시 켜면 저장된 로그인으로 바로
    A = await launch();
    await A.win.waitForSelector('[data-testid="app-title"]', { timeout: 20000 });
    ok(true, '⑤ 다시 켜면 저장된 로그인으로 바로 앱');
    await A.app.close(); A = null;

    // ⑥ 서버가 꺼져도 7일 여유
    SRV.down = true;
    A = await launch();
    await A.win.waitForSelector('[data-testid="app-title"]', { timeout: 30000 });
    const off = await A.win.evaluate(() => window.api.licenseState());
    ok(off.ok && off.offline && off.graceUntil > Date.now(), '⑥ 서버 연결 실패 → 여유 기간으로 열린다');
    SRV.down = false;

    // ⑧ 로그아웃 → 관문
    await A.win.evaluate(() => window.api.licenseLogout());
    await A.win.reload();
    await A.win.waitForSelector('[data-testid="license-gate"]', { timeout: 15000 });
    ok(!fs.existsSync(path.join(LDIR, 'session.bin')), '⑧ 로그아웃 → 관문 · 세션 파일 삭제');
    // ⑨ 🆕 앱 안 회원가입 + 가입 코드(v0.9.98)
    await A.win.click('[data-testid="license-tab-signup"]');
    const su = A.win.locator('[data-testid="license-signup"]');
    await A.win.fill('[data-testid="license-email"]', 'newbie@test.kr');
    await A.win.fill('[data-testid="license-password"]', 'abcdef');
    await A.win.fill('[data-testid="license-password2"]', 'abcdeX');
    ok(await su.isDisabled(), '⑨ 비밀번호 확인이 다르면 가입 버튼이 잠긴다');
    await A.win.fill('[data-testid="license-password2"]', 'abcdef');
    ok(await su.isDisabled(), '⑨ 약관에 동의해야 가입 버튼이 열린다');
    await A.win.check('[data-testid="license-agree"]');
    ok(!(await su.isDisabled()), '⑨ 입력·동의가 끝나면 가입 버튼이 열린다');
    await su.click(); await sleep(900);
    ok(SRV.signups === 1 && /이용 기간이 없습니다/.test(await A.win.textContent('[data-testid="license-msg"]')), '⑨ 코드 없이 가입 → 계정만 생기고 이용 기간 없음 안내');
    await A.win.fill('[data-testid="license-code"]', 'WRONG');
    await A.win.click('[data-testid="license-redeem"]'); await sleep(700);
    ok(/맞지 않습니다/.test(await A.win.textContent('[data-testid="license-code-msg"]')), '⑨ 틀린 코드 안내');
    await A.win.fill('[data-testid="license-code"]', 'CODE-30');
    await A.win.click('[data-testid="license-redeem"]');
    await A.win.waitForSelector('[data-testid="app-title"]', { timeout: 15000 });
    ok(true, '⑨ 맞는 코드 → 이용 기간 시작 · 앱이 열린다');
    ok(SRV.consents === 1, '⑨ 가입 때 체크한 약관 동의가 서버에 한 번 남는다');
    await A.win.evaluate(() => window.api.licenseLogout());
    await A.win.reload();
    await A.win.waitForSelector('[data-testid="license-gate"]', { timeout: 15000 });
    // 👑 관리자 계정 = owner true
    await A.win.fill('[data-testid="license-email"]', 'admin@test');
    await A.win.fill('[data-testid="license-password"]', 'pw-test-1');
    await A.win.click('[data-testid="license-login"]');
    await A.win.waitForSelector('[data-testid="app-title"]', { timeout: 15000 });
    const ad = await A.win.evaluate(() => window.api.licenseState());
    ok(ad.owner === true && ad.admin === true, '👑 관리자 = owner true');
    ok(errs.length === 0, '화면 오류 0건' + (errs.length ? ': ' + errs[0] : ''));
  } finally {
    try { if (A) await A.app.close(); } catch (_) {}
    server.close();
    try { fs.rmSync(LDIR, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 회원 관문 E2E ' + n + '/' + n + ' 통과');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('❌ 실패:', e.message); try { server.close(); } catch (_) {} try { fs.rmSync(LDIR, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
