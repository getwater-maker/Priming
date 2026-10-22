'use strict';
// node test/license.test.js — 🔐 회원 확인 모듈(core/license · v0.9.26) — 가짜 fetch · 임시 폴더 · 가짜 암호화
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLicense, GRACE_MS, CONSENT } = require('../core/license');
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
    if (url.endsWith('/auth/v1/signup')) {
      if (body.email === 'dup@x.kr') return res(422, { error_code: 'user_already_exists', msg: 'User already registered' });
      if (S.confirm) return res(200, { id: 'u1', email: body.email });
      S.accessN++; return res(200, { access_token: 'acc' + S.accessN, refresh_token: 'ref' + S.accessN, expires_in: 3600, user: { email: body.email } });
    }
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
    if (url.endsWith('/rpc/get_my_consent')) { if (S.getFail) return res(500, {}); return res(200, S.consentRow === undefined ? null : S.consentRow); }
    if (url.endsWith('/rpc/accept_consents')) { S.consents = (S.consents || []).concat([body]); return res(S.consentFail ? 500 : 204, {}); }
    if (url.endsWith('/rpc/priming_redeem_code')) {
      if (S.noRedeem) return res(404, {});
      if (body.p_code === 'GOOD-30') return res(200, { ok: true, days: 30, expires_at: '2026-11-22T00:00:00Z' });
      if (body.p_code === 'USED') return res(200, { ok: false, reason: 'already_used' });
      return res(200, { ok: false, reason: 'invalid_code' });
    }
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

  console.log('[8] 앱 안 가입 · 가입 코드');
  { const clock = { t: 1e12 }; const S = fakeServer(); const { L, dir } = mk(S, clock);
    ok((await L.signup('not-an-email', 'abcdef')).reason === 'bad_email', '이메일 모양이 틀리면 서버에 묻지 않고 bad_email');
    ok((await L.signup('a@x.kr', '123')).reason === 'weak_password' && !S.calls.some((c) => c.url.endsWith('/signup')), '비밀번호 6자 미만 = weak_password(서버 호출 없음)');
    ok((await L.signup('dup@x.kr', 'abcdef')).reason === 'already_registered', '이미 가입된 이메일');
    S.confirm = true;
    ok((await L.signup('a@x.kr', 'abcdef')).reason === 'confirm_mail' && !L.loadSession(), '이메일 확인이 켜져 있으면 세션 없이 confirm_mail');
    S.confirm = false;
    const r = await L.signup('a@x.kr', 'abcdef');
    ok(r.ok && L.loadSession() && L.loadSession().access === 'acc1', '가입 → 세션 저장(토큰은 main 안에만)');
    ok(!JSON.stringify(S.calls.filter((c) => c.url.endsWith('/signup')).map((c) => c.init.headers)).includes('Authorization'), '가입 요청에 토큰 헤더 없음');
    ok((await L.redeem('')).reason === 'no_code', '빈 코드');
    ok((await L.redeem('NOPE')).reason === 'invalid_code', '틀린 코드 → invalid_code');
    ok((await L.redeem('USED')).reason === 'already_used', '쓴 코드 → already_used');
    const g = await L.redeem('GOOD-30');
    ok(g.ok && g.days === 30 && g.expiresAt === '2026-11-22T00:00:00Z', '맞는 코드 → 일수·만료일');
    S.noRedeem = true;
    ok((await L.redeem('GOOD-30')).reason === 'redeem_unavailable', '서버에 RPC 가 아직 없으면 redeem_unavailable(404)');
    L.logout(); ok((await L.redeem('GOOD-30')).reason === 'logged_out', '로그아웃 상태 = logged_out');
    // 📜 동의 기록 — 가입 때 체크했으면 세션이 생긴 첫 확인 직후 accept_consents 1회
    { const S2 = fakeServer(); const m2 = mk(S2, clock); S2.confirm = true;
      await m2.L.signup('c@x.kr', 'abcdef', { consent: true });
      ok(!S2.consents, '확인 메일 대기 중엔 동의를 보내지 않는다(세션 없음)');
      ok((await m2.L.login('c@x.kr', 'right')).ok && S2.consents && S2.consents.length === 1, '첫 로그인 직후 accept_consents 호출');
      const c0 = S2.consents[0];
      ok(c0.p_terms_version === CONSENT.terms && c0.p_privacy_version === CONSENT.privacy && c0.p_marketing === false, '약관·개인정보 버전은 설정값 · 마케팅 수신 false');
      await m2.L.check(); ok(S2.consents.length === 1, '한 번 남기면 다시 보내지 않는다');
      const S3 = fakeServer(); S3.consentFail = true; const m3 = mk(S3, clock);
      await m3.L.signup('d@x.kr', 'abcdef', { consent: true }); await m3.L.check(); await m3.L.check();
      ok(S3.consents.length === 2, '서버가 실패하면 다음 확인 때 다시 시도');
      const S5 = fakeServer(); S5.consentRow = { terms_version: CONSENT.terms, privacy_version: CONSENT.privacy, marketing: true }; const m5 = mk(S5, clock);
      await m5.L.signup('e@x.kr', 'abcdef', { consent: true }); await m5.L.check();
      ok(!S5.consents && !m5.L.readState().consentPending, '사이트에서 이미 같은 버전으로 동의했으면 덮어쓰지 않는다(대기도 해제)');
      const S6 = fakeServer(); S6.consentRow = { terms_version: '2025-01-01', privacy_version: CONSENT.privacy, marketing: true }; const m6 = mk(S6, clock);
      await m6.L.signup('f@x.kr', 'abcdef', { consent: true }); await m6.L.check();
      ok(S6.consents.length === 1 && S6.consents[0].p_marketing === true, '버전이 다르면 갱신하되 마케팅 동의 값은 그대로 넘긴다');
      const S7 = fakeServer(); S7.getFail = true; const m7 = mk(S7, clock);
      await m7.L.signup('g@x.kr', 'abcdef', { consent: true }); await m7.L.check();
      ok(!S7.consents && m7.L.readState().consentPending, '현재 동의를 읽지 못하면 덮어쓰지 않고 다음에 다시');
      const S4 = fakeServer(); const m4 = mk(S4, clock); await m4.L.login('roy@x.kr', 'right'); ok(!S4.consents, '가입으로 동의하지 않은 로그인은 동의를 보내지 않는다'); }
    fs.rmSync(dir, { recursive: true, force: true }); }

  console.log('[7] 소스 검사');
  { const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'license.js'), 'utf8');
    ok(/sb_publishable_[A-Za-z0-9_-]{20,}/.test(src) && !/sb_secret_/.test(src) && !/service_role/.test(src.replace(/\/\/.*|\*.*$/gm, '')), '공개 키만 들어 있다(secret·service_role 없음)');
    ok(GRACE_MS === 7 * 24 * 3600 * 1000, '여유 = 7일'); }

  console.log(`\n${fail ? '❌' : '✅'} license — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
