'use strict';
/**
 * account-creds.js — 브라우저 자동화 계정(Genspark · Flow · Grok)의 아이디/비밀번호 저장소.
 *
 * 위치: ~/.flow-app/account-creds.json
 *
 * 🔴 **왜 secret-store 를 쓰지 않는가**: `tts/secret-store.js` 는 **평문 JSON** 이다(주석에도
 *    "1차: 평문 저장" 이라고 적혀 있다). API 키는 그렇다 쳐도 **구글·X 계정 비밀번호**는 성격이
 *    다르다 — 구글 비번 하나가 새면 지메일·드라이브(출력폴더 G:)·유튜브 채널이 함께 넘어간다.
 *    그래서 이 파일은 **Electron `safeStorage`**(윈도우에서는 DPAPI = 이 윈도우 사용자 계정에
 *    묶인 암호화)로 암호화해 저장한다. 다른 PC/다른 사용자로 파일을 옮겨도 복호화되지 않는다.
 *
 * 🔑 **설계 원칙 — 비밀번호는 렌더러로 되돌려 주지 않는다.**
 *    UI 는 비밀번호를 **쓰기만** 하고, 읽을 때는 `hasPassword: true/false` 만 받는다.
 *    복호화된 값은 **메인 프로세스 안에서 로그인 자동입력에만** 쓰인다(로그에도 남기지 않는다).
 *
 * ⚠ safeStorage 를 못 쓰는 환경이면 **저장을 거부한다**(평문으로 몰래 떨어뜨리지 않는다).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.homedir(), '.flow-app');
const FILE = path.join(DIR, 'account-creds.json');

function _safeStorage() {
  try {
    const { safeStorage } = require('electron');
    if (safeStorage && safeStorage.isEncryptionAvailable()) return safeStorage;
  } catch (_) { /* electron 밖(테스트·CLI) */ }
  return null;
}

/** 이 환경에서 자격증명 저장이 가능한가 (UI 가 안내 문구를 바꾸는 데 쓴다) */
function available() { return !!_safeStorage(); }

function _key(service, accId) {
  return `${String(service || '').trim()}:${String(accId || 'default').trim()}`;
}

function _loadAll() {
  try {
    if (fs.existsSync(FILE)) {
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (j && typeof j === 'object' && j.items) return j;
    }
  } catch (e) { /* 깨진 파일은 빈 것으로 취급 — 비밀번호는 다시 입력하면 된다 */ }
  return { v: 1, items: {} };
}

function _saveAll(data) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
    // 이 사용자만 읽도록 (윈도우에서는 큰 의미가 없지만 유닉스 호환 PC 를 위해)
    try { fs.chmodSync(FILE, 0o600); } catch (_) {}
    return true;
  } catch (e) { return false; }
}

function _enc(ss, plain) { return ss.encryptString(String(plain)).toString('base64'); }
function _dec(ss, b64) {
  try { return ss.decryptString(Buffer.from(String(b64), 'base64')); } catch (_) { return ''; }
}

/**
 * 저장. password 를 빈 문자열/undefined 로 주면 **기존 비밀번호를 유지**한다
 * (UI 가 아이디만 고칠 때 비번을 지워버리지 않도록).
 * password 를 null 로 주면 비밀번호만 삭제.
 */
function set(service, accId, { username, password } = {}) {
  const ss = _safeStorage();
  if (!ss) return { ok: false, error: '이 PC 에서는 OS 암호화(safeStorage)를 쓸 수 없어 저장하지 않았습니다.' };
  const data = _loadAll();
  const k = _key(service, accId);
  const cur = data.items[k] || {};
  const next = { ...cur };
  if (username !== undefined) next.u = String(username || '') ? _enc(ss, username) : '';
  if (password === null) delete next.p;
  else if (password) next.p = _enc(ss, password);
  data.items[k] = next;
  if (!next.u && !next.p) delete data.items[k];      // 둘 다 비면 항목 제거
  return _saveAll(data) ? { ok: true } : { ok: false, error: '파일 저장 실패' };
}

/** 🔒 메인 프로세스 전용 — 복호화된 값을 반환한다. **렌더러로 보내지 말 것.** */
function getSecret(service, accId) {
  const ss = _safeStorage();
  const data = _loadAll();
  const it = data.items[_key(service, accId)];
  if (!it || !ss) return { username: '', password: '' };
  return { username: it.u ? _dec(ss, it.u) : '', password: it.p ? _dec(ss, it.p) : '' };
}

/** UI 용 — 아이디는 보여주고 **비밀번호는 있는지만** 알려준다. */
function getPublic(service, accId) {
  const s = getSecret(service, accId);
  return { username: s.username, hasPassword: !!s.password, available: available() };
}

/** 서비스의 계정별 저장 여부 맵 — { accId: {hasUsername, hasPassword} } */
function flags(service) {
  const data = _loadAll();
  const out = {};
  const pre = `${String(service || '').trim()}:`;
  for (const k of Object.keys(data.items || {})) {
    if (k.indexOf(pre) !== 0) continue;
    const it = data.items[k] || {};
    out[k.slice(pre.length)] = { hasUsername: !!it.u, hasPassword: !!it.p };
  }
  return out;
}

function clear(service, accId) {
  const data = _loadAll();
  delete data.items[_key(service, accId)];
  return _saveAll(data) ? { ok: true } : { ok: false, error: '파일 저장 실패' };
}

module.exports = { available, set, getSecret, getPublic, flags, clear, FILE };
