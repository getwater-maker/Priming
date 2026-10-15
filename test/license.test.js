'use strict';
// node test/license.test.js — 🔐 회원 확인 모듈(core/license · v0.9.26) — 가짜 fetch · 임시 폴더 · 가짜 암호화
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLicense, GRACE_MS } = require('../core/license');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

// 가짜 Supabase — 계정 1개(pw = 'right'), 회원 상태는 바꿀 수 있다
function fakeServer() {
  const S = { member: { ok: true, admin: false, expires_at: '2099-01-01T00:00:00Z', device_limit: 2, devices: [] }, calls: [], down: false, accessN: 0, logs: [] };
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  S.fetch = async (url, init = {}) => {
    S.calls.push({ url, init });
    if (S.down) throw new Error('ECONNREFUSED');
    const body = init.body ? JSON.parse(init.body) : {};
    if (!init.headers || !init.headers.apikey) return res(401, { error: 'no apikey' });
    if (url.includes('grant_type=password')) {
      if (body.password !== 'right') return res(400, { error: 'invalid_grant' });
      S.accessN++; return res(200, { access_token: 'acc' + S.accessN, refresh_token: 'ref' + S.accessN, expires_in: 3600, user: { email: body.email } });
    }
    if (url.includes('grant_type=refresh_token')) {
      if (!/^ref\d+$/.test(body.refresh_token)) return res(400, { error: 'bad refresh' });
      S.accessN++; return res(200, { access_token: 'acc' + S.accessN, refresh_token: 'ref' + S.accessN, expires_in: 3600, user: { email: 'roy@x.kr' } });
    }
    const auth = (init.headers.Authorization || '').replace('Bearer ', '');
    if (!/^acc\d+$/.test(auth)) return res(401, { message: 'JWT' });
    if (url.endsWith('/rpc/priming_license')) { S.lastDevice = body.p_device_id; return res(200, S.member); }
    if (url.endsWith('/rpc/priming_log')) { S.logs.push(body); return res(200, { ok: true, id: S.logs.length }); }
    return res(404, {});
  };
  return S;
}
const mk = (S, clock) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-'));
  const L = createLicense({ dir, fetch: S.fetch, now: () => clock.t, encrypt: (s) => Buffer.from('ENC:' + Buffer.from(s).toString('base64')), decrypt: (b) => { const t = b.toString(); if (!t.startsWith('ENC:')) throw new Error('bad'); return Buffer.from(t.slice(4), 'base64').toString(); }, hostname: () => '테스트PC' });
  return { L, dir };
};

(async () => {
  console.log('[1] 로그인');
  { const S = fakeServer(); const clock = { t: 1e12 }; const { L, dir } = mk(S, clock);
    ok((await L.check()).reason === 'logged_out', '로그인 전 = logged_out');
    const bad = await L.login('roy@x.kr', 'wrong');
    ok(!bad.ok && bad.reason === 'bad_login', '틀린 비밀번호 = bad_login');
    const g = await L.login('roy@x.kr', 'right');
    ok(g.ok && g.email === 'roy@x.kr' && g.expiresAt === '2099-01-01T00:00:00Z', '맞는 비밀번호 → 회원 확인 통과');
    const raw = fs.readFileSync(path.join(dir, 'session.bin'), 'utf8');
    ok(raw.startsWith('ENC:') && !raw.includes('acc1') && !raw.includes('ref1'), '토큰은 암호화해서만 저장(평문 없음)');
    ok(/^[A-Za-z0-9._:-]{8,64}$/.test(S.lastDevice) && S.lastDevice === L.deviceId(), '기기 id 는 서버 규칙 모양 · 다시 불러도 같다');
    ok(S.calls.every((c) => c.init.headers.apikey), '모든 요청에 공개 키(apikey)');
    fs.rmSync(dir, { recursive: true, force: true }); }

  console.log('[2] 토큰 갱신');
  { const S = fakeServer(); const clock = { t: 1e12 }; const { L, dir } = mk(S, clock);
    await L.login('roy@x.kr', 'right');
    ok(await L.accessToken() === 'acc1', '유효하면 그대로');
    clock.t += 3600 * 1000;   // 만료
    ok(await L.accessToken() === 'acc2', '만료되면 refresh 로 새 토큰');
    ok((await L.check()).ok, '새 토큰으로 회원 확인');
    fs.rmSync(dir, { recursive: true, force: true }); }

  console.log('[3] 회원 아님 · 만료 · 기기 한도');
  { const S = fakeServer(); const clock = { t: 1e12 }; const { L, dir } = mk(S, clock);
    S.member = { ok: false, member: false, reason: 'not_member', devices: [] };
    const a = await L.login('x@x.kr', 'right');
    ok(!a.ok && a.reason === 'not_member', 'not_member');
    S.member = { ok: false, member: true, reason: 'device_limit', device_limit: 2, devices: [{ device_id: 'a', name: 'PC1' }, { device_id: 'b', name: 'PC2' }] };
    const b = await L.check();
    ok(!b.ok && b.reason === 'device_limit' && b.devices.length === 2, 'device_limit · 기기 목록이 온다');
    S.down = true;
    const c = await L.check();
    ok(!c.ok, '🔴 회원이 아닌 채로 인터넷이 끊겨도 여유 기간이 생기지 않는다(마지막 성공 없음)');
    fs.rmSync(dir, { recursive: true, force: true }); }

  console.log('[4] 인터넷이 끊겼을 때 7일 여유');
  { const S = fakeServer(); const clock = { t: 1e12 }; const { L, dir } = mk(S, clock);
    await L.login('roy@x.kr', 'right');
    S.down = true;
    clock.t += 3 * 24 * 3600 * 1000;
    const a = await L.check();
    ok(a.ok && a.offline, '3일 뒤 오프라인 = 통과(여유)');
    clock.t += 5 * 24 * 3600 * 1000;
    const b = await L.check();
    ok(!b.ok && b.reason === 'offline', '8일 뒤 오프라인 = 막힘');
    fs.rmSync(dir, { recursive: true, force: true }); }
  { const S = fakeServer(); const clock = { t: Date.parse('2026-10-15T00:00:00Z') }; const { L, dir } = mk(S, clock);
    S.member = { ok: true, admin: false, expires_at: '2026-10-17T00:00:00Z', devices: [] };
    await L.login('roy@x.kr', 'right');
    S.down = true; clock.t += 3 * 24 * 3600 * 1000;
    ok(!(await L.check()).ok, '여유 기간 안이어도 회원 만료일이 지났으면 막힘');
    fs.rmSync(dir, { recursive: true, force: true }); }

  console.log('[5] 로그아웃 · 서버가 토큰을 거부');
  { const S = fakeServer(); const clock = { t: 1e12 }; const { L, dir } = mk(S, clock);
    await L.login('roy@x.kr', 'right');
    L.logout();
    ok((await L.check()).reason === 'logged_out' && !fs.existsSync(path.join(dir, 'session.bin')), '로그아웃 = 세션 파일 삭제');
    await L.login('roy@x.kr', 'right');
    S.down = true; L.logout(); S.down = false;
    ok((await L.check()).reason === 'logged_out', '로그아웃 뒤엔 여유 기간도 없다');
    fs.rmSync(dir, { recursive: true, force: true }); }

  console.log('[6] 오류 로그 · 업데이트 경로');
  { const S = fakeServer(); const clock = { t: 1e12 }; const { L, dir } = mk(S, clock);
    ok((await L.sendLog({ summary: 'x' })).reason === 'logged_out', '로그인 전엔 보내지 않는다');
    ok(await L.updateSource() === null, '로그인 전 업데이트 경로 = null(옛 경로)');
    await L.login('roy@x.kr', 'right');
    const r = await L.sendLog({ kind: 'auto', summary: '✗ 실패', body: 'b', appVersion: '0.9.25' });
    ok(r.ok && S.logs[0].p_kind === 'auto' && S.logs[0].p_app_version === '0.9.25' && S.logs[0].p_device_id === L.deviceId(), 'priming_log 인자(기기·버전·종류)');
    const src = await L.updateSource();
    ok(src && src.headers.Authorization === 'Bearer acc1', 'Worker 경로 + Bearer 토큰');
    ok(src.fileUrl('renderer/dist/assets/a b.js', 5) === 'https://updates.primingwave.com/file/renderer/dist/assets/a%20b.js?t=5', '파일 주소: 조각별 인코딩 · ?t=');
    ok(src.manifestUrl(7) === 'https://updates.primingwave.com/manifest?t=7', '매니페스트 주소');
    fs.rmSync(dir, { recursive: true, force: true }); }

  console.log('[7] 소스 검사');
  { const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'license.js'), 'utf8');
    ok(/sb_publishable_[A-Za-z0-9_-]{20,}/.test(src) && !/sb_secret_/.test(src) && !/service_role/.test(src.replace(/\/\/.*|\*.*$/gm, '')), '공개 키만 들어 있다(secret·service_role 없음)');
    ok(GRACE_MS === 7 * 24 * 3600 * 1000, '여유 = 7일'); }

  console.log(`\n${fail ? '❌' : '✅'} license — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
