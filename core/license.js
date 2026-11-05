'use strict';
/**
 * license.js — 🔐 Priming 회원 확인(v0.9.26 · 설계·계약서 docs/회원제-설계.md §1·§3·§4·§6 · 서버 = wise-priming SQL 029 + Worker priming-updates).
 *   · 로그인 = Supabase 이메일·비밀번호(REST — ⛔ npm SDK 금지: 라이트 업데이트가 막힌다)
 *   · 토큰(access/refresh)은 OS 암호화(encrypt/decrypt = Electron safeStorage)로만 저장 · ⛔ 렌더러로 돌려주지 않는다
 *   · 회원 확인 = RPC priming_license(기기 id, 기기 이름) — 기기 2대(관리자 무제한)
 *   · 인터넷이 안 되면 **마지막 성공 뒤 7일**까지 그대로(만료일이 지났으면 안 된다)
 *   · 오류 로그 = RPC priming_log (본문은 부르는 쪽이 core/log-scrub 으로 지운 뒤)
 *   주소·공개 키는 사이트(primingwave.com)에 이미 공개된 값이다(publishable = 예전 anon). ⛔ secret 키를 여기 두지 않는다.
 *   시험용: PM_LICENSE_DIR(저장 폴더) · PM_LICENSE_API(Supabase 주소 대신) · PM_UPDATE_BASE(Worker 주소 대신).
 * 테스트: test/license.test.js(가짜 fetch) · test/license-gate.smoke.js(가짜 서버 + 실제 앱)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SUPABASE_URL = 'https://tvvcwhxullrwpsitmyep.supabase.co';
const SUPABASE_KEY = 'sb_publishable_feodjOad34xOpdoIcRp8IQ_TgcI2k80';
const UPDATE_BASE = 'https://updates.primingwave.com';
const SITE_DEVICES = 'https://www.primingwave.com/member/devices';
const SITE_CHARGE = 'https://www.primingwave.com/member/credits';   // 💳 회원 크레딧 충전 페이지(wise-priming 에 요청 — 2026-10-23 · 주소가 다르게 정해지면 여기 한 곳만 고친다)
const SITE_ADMIN = 'https://www.primingwave.com/admin/priming';   // 👑 관리자 화면(회원·기기·포인트 지급·오류) — wise-priming src/app/admin/priming · 로그인은 사이트 관리자 계정
// 📜 약관 동의 버전 — 사이트 consent.ts(TERMS_VERSION·PRIVACY_VERSION)와 같아야 사이트 ConsentGate 가 다시 묻지 않는다(개정되면 여기 한 곳만 고친다 · wise-priming 약속 2026-10-23)
const CONSENT = { terms: '2026-10-06', privacy: '2026-10-08' };
const GRACE_MS = 7 * 24 * 3600 * 1000;

// 앱이 열어 주는 사이트 주소는 우리 도메인(https)만 — 서버 값에 낯선 주소가 섞여도 열지 않는다
const isSiteUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' && /^(www\.)?primingwave\.com$/.test(x.hostname); } catch (_) { return false; } };
const apiBase = () => process.env.PM_LICENSE_API || SUPABASE_URL;
const updateBase = () => process.env.PM_UPDATE_BASE || UPDATE_BASE;
const defaultDir = () => process.env.PM_LICENSE_DIR || path.join(os.homedir(), '.priming-maker', 'license');

// 🪙 포인트 — 서버(priming_license)가 points_granted(지급) · points_remaining(남음)을 주면 그대로, 없으면 null(화면에 안 보인다 · v0.9.72)
function pointsOf(j) {
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const granted = n(j && j.points_granted), remaining = n(j && j.points_remaining);
  return granted == null && remaining == null ? null : { granted, remaining };
}

// 🪙 kie 보유 크레딧(관리자에게만) — 서버가 priming_license 에 kie_credits 를 주면 그 숫자, 없으면 null(v0.9.82)
function kieOf(j) { const v = j && j.kie_credits; return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v); }

// 🗓 가입 기간 선택지(로이 2026-11-05) — 개월 수만 앱에 있다. 금액·크레딧은 서버 app_plans 에서만(관리자 화면이 고친다)
const PLAN_MONTHS = [1, 3, 6, 12];
function planOf(p) {
  const m = Number(p && p.months), won = Number(p && p.price_krw);
  if (!PLAN_MONTHS.includes(m) || !Number.isFinite(won) || won < 0) return null;
  return { months: m, priceKrw: Math.round(won), onSale: p.on_sale !== false };
}
const APP_STATUS = new Set(['pending', 'approved', 'rejected', 'canceled']);
function appOf(a) {
  if (!a || typeof a !== 'object' || !APP_STATUS.has(a.status)) return null;
  const won = Number(a.price_krw);
  return { id: a.id == null ? null : String(a.id), months: Number(a.months) || null, priceKrw: Number.isFinite(won) ? Math.round(won) : null, status: a.status,
    depositor: a.depositor ? String(a.depositor) : '', createdAt: a.created_at || null, decidedAt: a.decided_at || null, note: a.admin_note ? String(a.admin_note) : '' };
}

function createLicense(opts = {}) {
  const dir = opts.dir || defaultDir();
  const doFetch = opts.fetch || ((...a) => fetch(...a));
  const now = opts.now || (() => Date.now());
  const enc = opts.encrypt || null;   // (string) => Buffer
  const dec = opts.decrypt || null;   // (Buffer) => string
  const hostName = opts.hostname || (() => { try { return os.hostname(); } catch (_) { return 'PC'; } });
  const F = { device: path.join(dir, 'device.json'), session: path.join(dir, 'session.bin'), state: path.join(dir, 'state.json') };
  const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
  const wr = (f, o) => { fs.mkdirSync(dir, { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 2), 'utf8'); fs.renameSync(t, f); };

  function deviceId() {
    const d = rd(F.device);
    if (d && typeof d.id === 'string' && /^[A-Za-z0-9._:-]{8,64}$/.test(d.id)) return d.id;
    const id = crypto.randomUUID();
    wr(F.device, { id, createdAt: new Date(now()).toISOString() });
    return id;
  }
  function loadSession() {
    if (!dec) return null;
    try { return JSON.parse(dec(fs.readFileSync(F.session))); } catch (_) { return null; }
  }
  function saveSession(s) {
    if (!enc) throw new Error('이 PC 에서 암호화 저장을 쓸 수 없어 로그인 정보를 저장하지 못했습니다.');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(F.session, enc(JSON.stringify(s)));
  }
  function clearSession() { try { fs.unlinkSync(F.session); } catch (_) {} }
  const readState = () => rd(F.state) || {};
  const writeState = (patch) => { const s = { ...readState(), ...patch }; wr(F.state, s); return s; };

  const H = (token) => ({ apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
  const sessFrom = (j) => ({ access: j.access_token, refresh: j.refresh_token, exp: now() + (Number(j.expires_in) || 3600) * 1000, email: (j.user && j.user.email) || '' });

  async function login(email, password) {
    let r;
    try {
      r = await doFetch(`${apiBase()}/auth/v1/token?grant_type=password`, { method: 'POST', headers: H(), body: JSON.stringify({ email: String(email || '').trim(), password: String(password || '') }) });
    } catch (_) { return { ok: false, reason: 'offline' }; }
    let j = {}; try { j = await r.json(); } catch (_) {}
    if (!r.ok || !j.access_token) return { ok: false, reason: r.status === 400 || r.status === 401 ? 'bad_login' : 'server' };
    saveSession(sessFrom(j));
    return check();
  }
  // 🆕 앱 안 회원가입(v0.9.98 · 로이 2026-10-23 「앱 비밀번호 따로 정하기 불편」) — 이메일·비밀번호로 바로 가입. 이메일 확인이 켜져 있으면 세션이 오지 않는다(confirm_mail).
  async function signup(email, password, opts = {}) {
    const em = String(email || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(em)) return { ok: false, reason: 'bad_email' };
    if (String(password || '').length < 6) return { ok: false, reason: 'weak_password' };
    let r;
    try { r = await doFetch(`${apiBase()}/auth/v1/signup`, { method: 'POST', headers: H(), body: JSON.stringify({ email: em, password: String(password) }) }); }
    catch (_) { return { ok: false, reason: 'offline' }; }
    let j = {}; try { j = await r.json(); } catch (_) {}
    const msg = String((j && (j.msg || j.message || j.error_description || j.error_code)) || '');
    if (!r.ok) {
      if (/already|registered|exists/i.test(msg)) return { ok: false, reason: 'already_registered' };
      if (/weak|short|at least|password/i.test(msg)) return { ok: false, reason: 'weak_password' };
      if (r.status === 429 || /rate|too many/i.test(msg)) return { ok: false, reason: 'rate_limited' };
      return { ok: false, reason: 'server' };
    }
    if (opts.consent) writeState({ consentPending: em.toLowerCase() });
    if (PLAN_MONTHS.includes(Number(opts.months))) writeState({ applyPending: { email: em.toLowerCase(), months: Number(opts.months) } });   // 고른 기간 — 세션이 생긴 뒤 applicationMine 이 신청(바로 세션이면 부르는 쪽이 곧 apply)   // 동의는 세션이 생긴 첫 로그인 직후 서버에 남긴다(확인 메일을 거치면 그때)
    if (!j.access_token) {   // 이메일 확인 대기 — 이미 가입된 주소도 같은 응답(계정 존재 노출 방지)
      return { ok: false, reason: 'confirm_mail', email: em };
    }
    saveSession(sessFrom(j));
    return { ok: true, signedUp: true };
  }
  // 🆕 가입 코드 사용 — 서버 RPC priming_redeem_code(p_code): 코드에 정해진 일수만큼 priming-app 이용 기간을 만든다(이미 회원이면 연장). 약속 = docs/요청서_wise-priming-앱가입.md
  async function redeem(code) {
    const c = String(code || '').trim();
    if (!c) return { ok: false, reason: 'no_code' };
    const tok = await accessToken();
    if (!tok) return { ok: false, reason: 'logged_out' };
    let r, j;
    try { r = await doFetch(`${apiBase()}/rest/v1/rpc/priming_redeem_code`, { method: 'POST', headers: H(tok), body: JSON.stringify({ p_code: c }) }); j = await r.json().catch(() => ({})); }
    catch (_) { return { ok: false, reason: 'offline' }; }
    if (r.status === 404) return { ok: false, reason: 'redeem_unavailable' };
    if (r.status === 401) return { ok: false, reason: 'logged_out' };
    if (!r.ok || !j || typeof j !== 'object') return { ok: false, reason: 'server' };
    return j.ok ? { ok: true, days: j.days == null ? null : Number(j.days), expiresAt: j.expires_at || null } : { ok: false, reason: String(j.reason || 'invalid_code') };
  }
  // 🗓 기간 골라 가입(v1.0.32 · 로이 2026-11-05 「가입할 때 기간 선택 → 입금 → 관리자 승인 한 번」 · 약속 = docs/요청서_wise-priming-기간선택가입.md)
  //   금액·계좌·입금자명 규칙은 전부 서버 값(⛔ 앱에 적지 않는다) · 서버에 RPC 가 아직 없으면(404) unavailable → 화면은 예전 「가입 코드」 흐름
  async function rpc(name, body, needTok) {
    const tok = await accessToken();
    if (needTok && !tok) return { reason: 'logged_out' };
    let r, j;
    try { r = await doFetch(`${apiBase()}/rest/v1/rpc/${name}`, { method: 'POST', headers: H(tok), body: JSON.stringify(body || {}) }); j = await r.json().catch(() => null); }
    catch (_) { return { reason: 'offline' }; }
    if (r.status === 404) return { reason: 'unavailable' };
    if (r.status === 401) return { reason: needTok ? 'logged_out' : 'server' };
    if (!r.ok || !j || typeof j !== 'object' || Array.isArray(j)) return { reason: 'server' };
    return { j };
  }
  async function plans() {   // 가입 전에도 부른다(공개 키만 · 토큰이 있으면 같이)
    const x = await rpc('priming_plans', {}, false);
    if (!x.j) return { ok: false, reason: x.reason };
    if (x.j.ok === false) return { ok: false, reason: String(x.j.reason || 'server') };
    const list = (Array.isArray(x.j.plans) ? x.j.plans : []).map(planOf).filter((p) => p && p.onSale);
    return list.length ? { ok: true, plans: list.sort((a, b) => a.months - b.months) } : { ok: false, reason: 'no_plans' };
  }
  async function apply(months) {
    const m = Number(months);
    if (!PLAN_MONTHS.includes(m)) return { ok: false, reason: 'bad_months' };
    const x = await rpc('priming_apply', { p_months: m }, true);
    if (!x.j) return { ok: false, reason: x.reason };
    if (!x.j.ok) return { ok: false, reason: String(x.j.reason || 'server') };
    const st = readState(); if (st.applyPending) writeState({ applyPending: null });
    return { ok: true, application: appOf(x.j.application) };
  }
  // 내 가장 최근 신청 + (입금 대기일 때만) 계좌 — 이메일 확인을 거쳐 가입 때 고른 기간이 아직 신청되지 않았으면 여기서 한 번 신청한다
  async function applicationMine() {
    let x = await rpc('priming_application_mine', {}, true);
    if (!x.j) return { ok: false, reason: x.reason };
    if (x.j.ok === false) return { ok: false, reason: String(x.j.reason || 'server') };
    const st = readState(), s = loadSession();
    if (!x.j.application && st.applyPending && s && String(s.email || '').toLowerCase() === st.applyPending.email) {
      const a = await apply(st.applyPending.months);
      if (a.ok) { x = await rpc('priming_application_mine', {}, true); if (!x.j) return { ok: false, reason: x.reason }; }
    }
    const a = appOf(x.j.application);
    const b = x.j.bank && a && a.status === 'pending' ? x.j.bank : null;
    return { ok: true, application: a, bank: b ? { bankName: String(b.bank_name || ''), accountNo: String(b.account_no || ''), holder: String(b.holder || '') } : null, depositorRule: x.j.depositor_rule ? String(x.j.depositor_rule) : '' };
  }
  // 🆕 구글 로그인(PKCE) — 돌아온 code 를 세션으로 맞바꾼다(core/license-oauth 가 code 를 받아 온다) · 구글로 들어온 사람도 앱에서 약관 동의를 한 번 남긴다
  async function exchangeCode(code, verifier) {
    let r;
    try { r = await doFetch(`${apiBase()}/auth/v1/token?grant_type=pkce`, { method: 'POST', headers: H(), body: JSON.stringify({ auth_code: String(code || ''), code_verifier: String(verifier || '') }) }); }
    catch (_) { return { ok: false, reason: 'offline' }; }
    let j = {}; try { j = await r.json(); } catch (_) {}
    if (!r.ok || !j.access_token) return { ok: false, reason: 'google_failed' };
    const sess = sessFrom(j);
    saveSession(sess);
    if (sess.email) writeState({ consentPending: String(sess.email).toLowerCase() });
    return { ok: true };
  }
  // 🛍 이 회원이 가진 상품 + 판매 중 강의(앱 안 업셀 안내) — RPC priming_products · 서버에 없으면(404) null = 안내를 숨긴다
  async function products() {
    const tok = await accessToken();
    if (!tok) return null;
    try {
      const r = await doFetch(`${apiBase()}/rest/v1/rpc/priming_products`, { method: 'POST', headers: H(tok), body: '{}' });
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      if (!j || j.ok === false) return null;
      const courses = (Array.isArray(j.courses) ? j.courses : []).filter((c) => c && c.title && isSiteUrl(c.url)).map((c) => ({ slug: String(c.slug || ''), title: String(c.title), owned: !!c.owned, url: String(c.url), summary: c.summary ? String(c.summary) : '' }));
      return { priming: { owned: !!(j.priming && j.priming.owned), expiresAt: (j.priming && j.priming.expires_at) || null }, courses };
    } catch (_) { return null; }
  }
  // 유효한 access token(1분 안에 끝나면 refresh) — 없거나 갱신 실패면 null
  async function accessToken() {
    const s = loadSession();
    if (!s || !s.access) return null;
    if (s.exp && s.exp - now() > 60000) return s.access;
    if (!s.refresh) return null;
    try {
      const r = await doFetch(`${apiBase()}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: H(), body: JSON.stringify({ refresh_token: s.refresh }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) { if (r.status === 400 || r.status === 401) clearSession(); return null; }
      saveSession({ ...sessFrom(j), email: (j.user && j.user.email) || s.email });
      return j.access_token;
    } catch (_) { return s.exp && s.exp > now() ? s.access : null; }
  }
  // 📜 앱에서 가입하며 체크한 동의를 서버에 남긴다 — 먼저 get_my_consent() 로 읽어, 행이 없거나 버전이 다를 때만 accept_consents(실패하면 다음 확인 때 다시).
  //   accept_consents 는 user_consents 를 덮어쓰므로(마케팅 포함) 이미 사이트에서 동의한 회원의 마케팅 값은 그대로 넘긴다(wise-priming 약속 2026-10-23).
  async function recordConsent(tok, email) {
    const st = readState();
    if (!st.consentPending || String(email || '').toLowerCase() !== st.consentPending) return;
    try {
      const g = await doFetch(`${apiBase()}/rest/v1/rpc/get_my_consent`, { method: 'POST', headers: H(tok), body: '{}' });
      if (!g.ok) return;   // 읽지 못하면 덮어쓰지 않는다 — 다음 확인 때 다시
      let row = await g.json().catch(() => null);
      if (Array.isArray(row)) row = row[0] || null;
      const f = (o, k) => (o ? (o[k] != null ? o[k] : o['p_' + k]) : undefined);
      const cur = row && typeof row === 'object' ? { terms: f(row, 'terms_version'), privacy: f(row, 'privacy_version'), marketing: !!f(row, 'marketing') } : null;
      if (cur && cur.terms === CONSENT.terms && cur.privacy === CONSENT.privacy) { writeState({ consentPending: null }); return; }
      const r = await doFetch(`${apiBase()}/rest/v1/rpc/accept_consents`, { method: 'POST', headers: H(tok), body: JSON.stringify({ p_terms_version: CONSENT.terms, p_privacy_version: CONSENT.privacy, p_marketing: cur ? cur.marketing : false }) });
      if (r.ok) writeState({ consentPending: null });
    } catch (_) {}
  }
  // 회원 확인 — 결과는 state.json 에(인터넷이 끊겼을 때의 여유 판단 근거)
  async function check() {
    const s = loadSession();
    if (!s) return { ok: false, reason: 'logged_out' };
    const offlineState = () => {
      const st = readState();
      const exp = st.expiresAt ? Date.parse(st.expiresAt) : null;
      if (st.lastOkAt && now() - st.lastOkAt < GRACE_MS && !(exp && exp < now())) {
        return { ok: true, offline: true, admin: !!st.admin, email: s.email, expiresAt: st.expiresAt || null, graceUntil: st.lastOkAt + GRACE_MS, points: st.points || null, kie: st.kie == null ? null : st.kie };
      }
      return { ok: false, offline: true, reason: 'offline', email: s.email };
    };
    let tok;
    try { tok = await accessToken(); } catch (_) { tok = null; }
    if (!tok) { if (!loadSession()) return { ok: false, reason: 'logged_out' }; return offlineState(); }
    let r, j;
    try {
      r = await doFetch(`${apiBase()}/rest/v1/rpc/priming_license`, { method: 'POST', headers: H(tok), body: JSON.stringify({ p_device_id: deviceId(), p_device_name: hostName() }) });
      j = await r.json();
    } catch (_) { return offlineState(); }
    if (r.status === 401) { clearSession(); return { ok: false, reason: 'logged_out' }; }
    if (!r.ok || !j || typeof j !== 'object') return offlineState();
    if (j.ok || j.member) await recordConsent(tok, s.email);
    const out = { ok: !!j.ok, admin: !!j.admin, email: s.email, expiresAt: j.expires_at || null, reason: j.reason || null, deviceLimit: j.device_limit == null ? null : j.device_limit, devices: Array.isArray(j.devices) ? j.devices : [], points: pointsOf(j), kie: kieOf(j) };
    if (out.ok) writeState({ lastOkAt: now(), admin: out.admin, expiresAt: out.expiresAt, email: s.email, points: out.points, kie: out.kie });
    else writeState({ lastOkAt: 0 });
    return out;
  }
  function logout() { clearSession(); writeState({ lastOkAt: 0 }); }

  async function sendLog({ kind = 'auto', summary = '', body = '', appVersion = '' } = {}) {
    const tok = await accessToken();
    if (!tok) return { ok: false, reason: 'logged_out' };
    try {
      const r = await doFetch(`${apiBase()}/rest/v1/rpc/priming_log`, { method: 'POST', headers: H(tok), body: JSON.stringify({ p_device_id: deviceId(), p_app_version: appVersion, p_kind: kind, p_summary: summary, p_body: body }) });
      const j = await r.json().catch(() => ({}));
      return r.ok ? j : { ok: false, reason: 'server' };
    } catch (_) { return { ok: false, reason: 'offline' }; }
  }

  // 업데이트 받을 곳 — 로그인돼 있으면 회원 확인 Worker, 아니면 null(부르는 쪽이 옛 경로)
  //   🏠🛒 edition(v1.0.38 · 저장소 분리) = 이 설치본의 판 — 매니페스트·파일 주소 **둘 다**에 싣는다(Worker 가 판으로 저장소를 고른다:
  //   member → Priming-Member · studio → Priming). 파일 주소에 빠지면 관리자로 로그인한 판매판이 매니페스트는 판매판, 파일은 로이판을 받는다.
  function sourceWith(headers, edition) {
    const base = updateBase();
    const ed = edition ? `edition=${encodeURIComponent(edition)}` : '';
    const q = (...p) => { const s = p.filter(Boolean).join('&'); return s ? '?' + s : ''; };
    return {
      headers,
      manifestUrl: (t) => `${base}/manifest${q(`t=${t}`, ed)}`,
      fileUrl: (rel, t) => `${base}/file/${String(rel).split('/').map(encodeURIComponent).join('/')}${q(t ? `t=${t}` : '', ed)}`,
    };
  }
  async function updateSource(edition) {
    const tok = await accessToken();
    if (!tok) return null;
    return sourceWith({ Authorization: `Bearer ${tok}` }, edition);
  }
  // 🛒 토큰 없이 묻는 Worker 경로(v1.0.35) — 판매판(edition=member)은 로그인 전에도 받는다 · 판매판 설치본의 로그인 전 업데이트만 쓴다(light-updater)
  function anonUpdateSource(edition) { return sourceWith({}, edition); }

  return { deviceId, login, signup, redeem, plans, apply, applicationMine, exchangeCode, products, apiBase, logout, check, accessToken, sendLog, updateSource, anonUpdateSource, readState, writeState, loadSession, dir };
}

/** Electron 앱에서 쓰는 기본 묶음 — safeStorage 는 app ready 뒤에만 쓸 수 있다(부르는 쪽이 whenReady 를 기다린다) */
function forApp() {
  const { safeStorage } = require('electron');
  const ok = () => { try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; } };
  return createLicense({
    encrypt: (s) => { if (!ok()) throw new Error('암호화 저장을 쓸 수 없습니다'); return safeStorage.encryptString(s); },
    decrypt: (b) => (ok() ? safeStorage.decryptString(b) : ''),
  });
}

module.exports = { isSiteUrl, CONSENT, createLicense, forApp, pointsOf, kieOf, PLAN_MONTHS, planOf, appOf, SITE_DEVICES, SITE_ADMIN, SITE_CHARGE, GRACE_MS };
