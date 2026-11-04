'use strict';
/**
 * core/link-opener.js — 🌐 Priming 이 바깥 링크(유튜브 연결 · 키 발급 · 충전 · 메일 …)를 여는 **한 곳** (v1.0.21 · 로이 2026-11-04)
 *   「링크를 열 브라우저」 = 시스템 기본 · Chrome · Edge · ego lite(설치돼 있을 때만) · 열지 않고 주소만 넘기기.
 *   Chromium 계열은 프로필도 고른다(`--profile-directory` · 채널마다 구글 계정이 다르다) — 프로필 목록은 그 브라우저의
 *   `User Data\Local State` 의 profile.info_cache 를 **읽기만** 한다.
 *   설정 파일 `~/.priming-maker/link-browser.json` {browser, profile} · 없으면 시스템 기본(예전 그대로).
 *   ⛔ main 에서 shell.openExternal 을 직접 부르지 않는다 — main `openLink` → 여기 `open` (test:linkopen 이 센다).
 *   Electron·fs 를 직접 잡지 않는다(주입) — 시험이 가짜 파일·가짜 실행으로 돈다.
 */
const path = require('path');
const os = require('os');

const CHOICES = ['system', 'chrome', 'edge', 'ego', 'none'];
const LABEL = { system: '시스템 기본 브라우저', chrome: 'Chrome', edge: 'Microsoft Edge', ego: 'ego lite', none: '열지 않고 주소만 넘기기' };

/** 설치 후보 — 실행 파일 자리(앞에서부터) · 사용자 데이터 폴더 */
function candidates(env = process.env) {
  const pf = env.ProgramFiles || 'C:\\Program Files';
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const la = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const j = path.win32.join;
  return {
    chrome: { exes: [j(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), j(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'), j(la, 'Google', 'Chrome', 'Application', 'chrome.exe')], userData: j(la, 'Google', 'Chrome', 'User Data') },
    edge: { exes: [j(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), j(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')], userData: j(la, 'Microsoft', 'Edge', 'User Data') },
    ego: { exes: [j(pf, 'Citro Labs', 'ego lite', 'Application', 'ego.exe'), j(la, 'Citro Labs', 'ego lite', 'Application', 'ego.exe'), j(la, 'Programs', 'ego lite', 'Application', 'ego.exe')], userData: j(la, 'Citro Labs', 'ego lite', 'User Data') },
  };
}

const _profOrder = (d) => { const m = /^Profile (\d+)$/.exec(d); return d === 'Default' ? -1 : m ? Number(m[1]) : 1e6; };
/** 프로필 목록 [{dir, name}] — Local State 를 못 읽으면 [] (프로필 없이 연다) */
function readProfiles(userData, { readFile }) {
  let j;
  try { j = JSON.parse(readFile(path.win32.join(userData, 'Local State'))); } catch (_) { return []; }
  const c = (j && j.profile && j.profile.info_cache) || {};
  return Object.keys(c).filter((d) => /^(Default|Profile \d+)$/.test(d))
    .map((d) => ({ dir: d, name: String((c[d] && c[d].name) || d) }))
    .sort((a, b) => _profOrder(a.dir) - _profOrder(b.dir) || a.dir.localeCompare(b.dir));
}

/** 이 PC 에 깔린 브라우저 [{id, label, exe, profiles}] — 윈도가 아니면 [](시스템 기본만) */
function detect({ env = process.env, platform = process.platform, exists, readFile } = {}) {
  if (platform !== 'win32') return [];
  const fs = require('fs');
  const ex = exists || ((p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } });
  const rd = readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const out = [];
  for (const [id, c] of Object.entries(candidates(env))) {
    const exe = c.exes.find((p) => ex(p));
    if (exe) out.push({ id, label: LABEL[id], exe, profiles: readProfiles(c.userData, { readFile: rd }) });
  }
  return out;
}

/** 화면 목록 — 시스템 기본 · (깔린 것만) · 주소만 넘기기 */
function listChoices(detected = []) {
  return [{ id: 'system', label: LABEL.system, profiles: [] }, ...detected.map(({ id, label, profiles }) => ({ id, label, profiles })), { id: 'none', label: LABEL.none, profiles: [] }];
}

function normSetting(s) {
  const browser = CHOICES.includes(s && s.browser) ? s.browser : 'system';
  const profile = browser !== 'system' && browser !== 'none' && typeof (s && s.profile) === 'string' && /^(Default|Profile \d+)$/.test(s.profile) ? s.profile : '';
  return { browser, profile };
}
function settingFile(home = os.homedir()) { return path.join(home, '.priming-maker', 'link-browser.json'); }
function loadSetting({ file = settingFile(), readFile } = {}) {
  const rd = readFile || ((p) => require('fs').readFileSync(p, 'utf8'));
  try { return normSetting(JSON.parse(rd(file))); } catch (_) { return normSetting(null); }
}
function saveSetting(s, { file = settingFile() } = {}) {
  const fs = require('fs');
  const v = normSetting(s);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(v, null, 2));
  return v;
}

/** 열어도 되는 주소만(http·https·mailto) — 그 밖은 null */
function safeUrl(u) {
  try { const x = new URL(String(u || '')); return ['http:', 'https:', 'mailto:'].includes(x.protocol) ? x.href : null; } catch (_) { return null; }
}

/** 어떻게 열지 — {kind:'shell'|'spawn'|'hand', exe?, args?, url, note?} (순수) */
function plan(url, setting, detected = []) {
  const s = normSetting(setting);
  if (s.browser === 'none') return { kind: 'hand', url };
  if (s.browser === 'system') return { kind: 'shell', url };
  const b = detected.find((d) => d.id === s.browser);
  if (!b) return { kind: 'shell', url, note: `${LABEL[s.browser]} 이(가) 이 PC 에 없어 시스템 기본 브라우저로 엽니다` };
  const prof = s.profile && b.profiles.find((p) => p.dir === s.profile);
  const note = s.profile && !prof ? `${b.label} 프로필(${s.profile})이 없어 프로필 없이 엽니다` : '';
  return { kind: 'spawn', exe: b.exe, args: [...(prof ? [`--profile-directory=${prof.dir}`] : []), url], url, ...(note ? { note } : {}), label: b.label + (prof ? ` · ${prof.name}` : '') };
}

/** 연다 → {ok, kind, label?} · 주소가 이상하면 {ok:false} · 실행 실패면 시스템 기본으로 한 번 더 */
async function open(url, { setting, detected = [], shellOpen, spawnFn, onHand, log = () => {} } = {}) {
  const u = safeUrl(url);
  if (!u) { log('⚠ 열 수 없는 주소라 열지 않았습니다'); return { ok: false, error: 'bad-url' }; }
  const p = plan(u, setting, detected);
  if (p.note) log('🌐 ' + p.note);
  if (p.kind === 'hand') { await onHand(u); return { ok: true, kind: 'hand' }; }
  if (p.kind === 'spawn') {
    try {
      const cp = spawnFn(p.exe, p.args, { detached: true, stdio: 'ignore', windowsHide: false });
      await new Promise((res, rej) => { let done = false; cp.once('error', (e) => { if (!done) { done = true; rej(e); } }); setTimeout(() => { if (!done) { done = true; res(); } }, 300); });
      try { cp.unref(); } catch (_) {}
      return { ok: true, kind: 'spawn', label: p.label };
    } catch (e) { log(`🌐 ${p.label} 을(를) 열지 못해 시스템 기본 브라우저로 엽니다 (${e.message})`); }
  }
  await shellOpen(u);
  return { ok: true, kind: 'shell' };
}

module.exports = { CHOICES, LABEL, candidates, readProfiles, detect, listChoices, normSetting, settingFile, loadSetting, saveSetting, safeUrl, plan, open };
