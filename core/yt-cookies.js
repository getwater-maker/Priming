'use strict';
/**
 * yt-cookies.js — 유튜브 로그인 쿠키 저장소(관리자 전용 · v1.0.23 · 로이 2026-11-04).
 *
 * 왜: 로그인 없이 받으면 유튜브가 이 PC 를 「로봇 확인」으로 막는다(4K Video Downloader+ 는 구글 로그인 쿠키로 받아 안 막힌다 — 앱 로그 실측).
 * 어떻게: 앱 안 로그인 창(main `yt-login-open`)이 쿠키를 읽어 여기에 **OS 암호화(safeStorage)로** 저장 → yt-dlp 를 부를 때마다
 *   임시 cookies.txt 로 풀어 `--cookies` 로 넘기고, 끝나면 지운다(갱신된 쿠키는 다시 암호화해 저장).
 *
 * ⛔ 쿠키·토큰을 렌더러로 돌려주지 않는다(상태만) · 로그에 값을 싣지 않는다 · 암호화를 못 쓰면 저장을 거부한다(평문 금지).
 * ⛔ 채널·애드센스와 관계없는 **전용 계정**으로만 쓴다(그룹 헌법 — 한 계정의 정책 위반이 전체 위험).
 * 순수 함수 + 주입(enc/dec) 으로 짜서 Electron 없이 시험한다(`test:ytcookies`).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const FILE = () => path.join(process.env.PRIMING_YTCOOKIE_DIR || path.join(os.homedir(), '.priming-maker'), 'yt-cookies.enc');
const KEEP_RE = /(^|\.)(youtube\.com|google\.com|googlevideo\.com|youtube-nocookie\.com)$/i;
const LOGIN_NAMES = ['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID', 'LOGIN_INFO'];

const domainOf = (c) => String(c.domain || '').replace(/^\./, '');

/** 유튜브·구글 도메인 쿠키만 남긴다(다른 사이트 쿠키는 저장하지 않는다) */
function filterCookies(list) {
  return (Array.isArray(list) ? list : []).filter((c) => c && c.name && KEEP_RE.test(domainOf(c)));
}

/** 로그인 쿠키(SAPISID 류)가 들어 있나 */
function isLoggedIn(list) {
  const now = Date.now() / 1000;
  return filterCookies(list).some((c) => LOGIN_NAMES.includes(c.name) && (!c.expirationDate || c.expirationDate > now));
}

/** Electron 쿠키 배열 → yt-dlp(Netscape) cookies.txt */
function toNetscape(list) {
  const out = ['# Netscape HTTP Cookie File', ''];
  for (const c of filterCookies(list)) {
    const host = String(c.domain || '');
    const dotted = host.startsWith('.') ? host : (c.hostOnly ? host : '.' + host);
    const exp = c.expirationDate ? Math.floor(c.expirationDate) : 0;   // 0 = 세션 쿠키
    const line = [
      c.httpOnly ? `#HttpOnly_${dotted}` : dotted,
      dotted.startsWith('.') || dotted.startsWith('#HttpOnly_.') ? 'TRUE' : 'FALSE',
      c.path || '/',
      c.secure ? 'TRUE' : 'FALSE',
      String(exp),
      String(c.name),
      String(c.value == null ? '' : c.value).replace(/[\r\n\t]/g, ''),
    ].join('\t');
    out.push(line);
  }
  return out.join('\n') + '\n';
}

/** cookies.txt → Electron 모양 배열(저장용) */
function fromNetscape(text) {
  const list = [];
  for (let raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let httpOnly = false;
    if (raw.startsWith('#HttpOnly_')) { httpOnly = true; raw = raw.slice('#HttpOnly_'.length); }
    else if (raw.startsWith('#')) continue;
    const p = raw.split('\t');
    if (p.length < 7) continue;
    const exp = Number(p[4]) || 0;
    list.push({ domain: p[0], path: p[2], secure: p[3] === 'TRUE', httpOnly, expirationDate: exp || undefined, name: p[5], value: p.slice(6).join('\t') });
  }
  return list;
}

/** 저장소 — enc/dec 는 주입(Electron safeStorage 또는 시험용) */
function save(list, enc) {
  const keep = filterCookies(list);
  if (!isLoggedIn(keep)) return { ok: false, error: '로그인 쿠키가 없습니다 — 로그인이 끝나지 않았습니다' };
  if (!enc) return { ok: false, error: '이 PC 에서는 OS 암호화(safeStorage)를 쓸 수 없어 저장하지 않았습니다.' };
  try {
    const f = FILE();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, enc(JSON.stringify({ v: 1, savedAt: Date.now(), cookies: keep })), 'utf8');
    return { ok: true, count: keep.length };
  } catch (e) { return { ok: false, error: '저장 실패: ' + e.message }; }
}

function load(dec) {
  try {
    const f = FILE();
    if (!dec || !fs.existsSync(f)) return null;
    const j = JSON.parse(dec(fs.readFileSync(f, 'utf8')));
    return j && Array.isArray(j.cookies) ? j : null;
  } catch (_) { return null; }
}

function clear() { try { fs.rmSync(FILE(), { force: true }); } catch (_) {} }

/** UI 용 상태 — 값은 담지 않는다 */
function status(dec) {
  const j = load(dec);
  if (!j) return { connected: false };
  const now = Date.now() / 1000;
  const exps = filterCookies(j.cookies).filter((c) => LOGIN_NAMES.includes(c.name) && c.expirationDate).map((c) => c.expirationDate);
  const expired = !isLoggedIn(j.cookies);
  return { connected: !expired, expired, savedAt: j.savedAt || 0, expiresAt: exps.length ? Math.min(...exps) * 1000 : 0, now: Math.floor(now) };
}

/**
 * yt-dlp 한 번 돌릴 동안의 임시 cookies.txt. 로그인이 없으면 null.
 * release() 가 갱신된 쿠키를 다시 저장하고 임시 파일을 지운다.
 */
function acquire(enc, dec) {
  const j = load(dec);
  if (!j || !isLoggedIn(j.cookies)) return null;
  const tmp = path.join(os.tmpdir(), `priming-ytck-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.txt`);
  try { fs.writeFileSync(tmp, toNetscape(j.cookies), { encoding: 'utf8', mode: 0o600 }); } catch (_) { return null; }
  return {
    file: tmp,
    release() {
      try {
        const back = fromNetscape(fs.readFileSync(tmp, 'utf8'));
        // yt-dlp 가 갱신한 쿠키(SIDTS 등)를 받아 둔다 — 로그인 쿠키가 남아 있을 때만(비면 옛 값 유지)
        if (isLoggedIn(back)) save(back, enc);
      } catch (_) { /* 읽기 실패 = 옛 값 유지 */ }
      try { fs.rmSync(tmp, { force: true }); } catch (_) {}
    },
  };
}

module.exports = { filterCookies, isLoggedIn, toNetscape, fromNetscape, save, load, clear, status, acquire, FILE, LOGIN_NAMES };
