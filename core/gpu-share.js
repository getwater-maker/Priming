'use strict';
// 🚦 GPU 함께 쓰기 — 원격(아내분) 우선(v1.0.15 · 로이 2026-11-04 「아내분 → 로이 → 자동 렌더」)
//   차례 정하기의 본체는 음성 서버(api.py GpuGate)다. 앱 쪽은 여기 한 곳에서:
//   ① isLocalBaseUrl — 주소가 이 PC 를 가리키나(원격 PC 의 앱인지 가른다)
//   ② remoteActive   — 서버 /gpu-status 로 「원격이 쓰는 중·기다리는 중·방금 끝남」인가
//   ③ waitRemoteIdle — 이 PC 의 로컬 그림(ComfyUI)이 장마다 원격에 양보한다(상한 없음 · 중단이면 멈춤 · 서버 이상은 그냥 진행)
//   ⛔ core/*.js 는 렌더러 번들에 들어갈 수 있다 — os 는 함수 안에서만 읽는다.

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function _hostOf(url) {
  try { return new URL(String(url || '')).hostname.toLowerCase(); } catch (_) { return ''; }
}

function _selfInfo() {
  try {
    const os = require('os');
    const addrs = [];
    for (const list of Object.values(os.networkInterfaces() || {})) for (const a of list || []) if (a && a.address) addrs.push(a.address);
    return { hostname: os.hostname(), addrs };
  } catch (_) { return { hostname: '', addrs: [] }; }
}

/** 주소가 이 PC 를 가리키나 — 루프백 · 이 PC 이름 · 이 PC 의 주소(Tailscale 100.x 포함). self 는 시험용. */
function isLocalBaseUrl(url, self) {
  const h = _hostOf(url);
  if (!h) return false;
  if (LOOPBACK.has(h)) return true;
  const me = self || _selfInfo();
  const name = String(me.hostname || '').toLowerCase();
  if (name && (h === name || h.split('.')[0] === name)) return true;
  return (me.addrs || []).some((a) => String(a).toLowerCase() === h.replace(/^\[|\]$/g, ''));
}

/** 서버 /gpu-status 가 원격 활동을 말하나(쥠 · 기다림 · 15초 안에 끝남). */
function remoteActive(st) {
  if (!st) return false;
  if (st.remote_active === true) return true;
  return st.holder === 'remote' || (st.wait_remote || 0) > 0 || (st.last_remote_ago != null && st.last_remote_ago < 15);
}

/** 원격이 GPU 를 쓰는 동안 기다린다. 돌려줌 {waited, aborted, sec}. 서버가 꺼졌거나 옛 서버(404)면 바로 돌아온다. */
async function waitRemoteIdle({ baseUrl, headers = {}, label = '', log = () => {}, aborted = () => false, pollMs = 3000, fetchImpl } = {}) {
  const f = fetchImpl || fetch;
  let base = String(baseUrl || '').trim();
  while (base.endsWith('/')) base = base.slice(0, -1);
  const t0 = Date.now();
  let waited = false;
  if (!base) return { waited, aborted: false, sec: 0 };
  for (;;) {
    if (aborted()) return { waited, aborted: true, sec: (Date.now() - t0) / 1000 };
    let st = null;
    try {
      const r = await f(base + '/gpu-status', { headers, signal: AbortSignal.timeout(4000) });
      if (!r.ok) break;                     // 옛 서버(404)·인증 실패 → 그냥 진행
      st = await r.json();
    } catch (_) { break; }                  // 꺼져 있거나 못 닿으면 그냥 진행
    if (!remoteActive(st)) break;
    if (!waited) {
      waited = true;
      log(`  🚦 ${label} — ${st.remote_name || '원격'} PC 가 GPU 를 쓰는 중입니다. 끝나면 이어 갑니다(원격 우선)`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const sec = (Date.now() - t0) / 1000;
  if (waited) { addYield(sec, 'image'); log(`  ▶ ${label} — 원격이 끝났습니다. 이어 갑니다 (${Math.round(sec)}초 대기)`); }
  return { waited, aborted: false, sec };
}

// 🖼 이 프로그램의 표지(v1.0.42) — 같은 PC 에 Priming 이 둘 돌 때(화면 앱 + 무인 제작) 음성 서버가 누구의 그림·음성인지 가른다.
//   `/comfy-touch`·`/tts` 에 함께 싣는다(서버 api.py img-owner — 남의 그림이 도는 동안 이 프로그램 음성은 들어가지 않는다).
let _proc = '';
function procId() {
  if (!_proc) {
    const pid = (typeof process !== 'undefined' && process && process.pid) || 0;
    _proc = 'p' + pid + '-' + Math.random().toString(36).slice(2, 8);
  }
  return _proc;
}
function procHeaders() { return { 'X-Priming-Proc': procId() }; }

/**
 * 🎙 이 GPU 의 음성이 「정말 끝났나」 — 서버 /busy 가 **연이어 조용할 때만** 끝난 것으로 본다(v1.0.42).
 *   왜: 문장과 문장 사이에 바쁨 수가 0.2초쯤 0 이 된다. 한 번 0 을 보고 그림을 시작했다가(2026-11-05 무인 제작 썸네일)
 *       화면 앱의 음성과 겹쳐 VRAM 이 넘치고 합성 하나가 멈춰 그 뒤 음성이 모두 408 이 됐다.
 *   규칙: 음성을 한 번이라도 봤으면 quietMs(15초) · 처음부터 조용했으면 firstQuietMs(3초) 동안 계속 0 이어야 한다.
 *   돌려줌 {result:'free'|'quiet'|'timeout'|'aborted'|'open', waited, sec, n} — 'open' = 옛 서버·못 닿음(그냥 진행 · fail-open).
 */
async function waitTtsQuiet({ baseUrl, headers = {}, quietMs = 15000, firstQuietMs = 3000, pollMs = 1000, maxMs = 0, aborted = () => false, onBusy = () => {}, fetchImpl, now = Date.now, sleep } = {}) {
  const f = fetchImpl || fetch;
  const nap = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let base = String(baseUrl || '').trim();
  while (base.endsWith('/')) base = base.slice(0, -1);
  const t0 = now();
  let waited = false, quietSince = null, lastN = 0;
  const done = (result) => ({ result, waited, sec: (now() - t0) / 1000, n: lastN });
  if (!base) return done('open');
  for (;;) {
    if (aborted()) return done('aborted');
    let n = 0;
    try {
      const r = await f(base + '/busy', { headers, signal: AbortSignal.timeout(4000) });
      if (!r.ok) return done('open');
      const j = await r.json();
      if (!j || typeof j.busy === 'undefined') return done('open');
      n = j.busy ? (j.n || 1) : 0;
    } catch (_) { return done('open'); }
    const t = now();
    if (n) {
      lastN = n; quietSince = null;
      onBusy(n, (t - t0) / 1000, !waited);
      waited = true;
    } else {
      if (quietSince == null) quietSince = t;
      if (t - quietSince >= (waited ? quietMs : firstQuietMs)) return done(waited ? 'quiet' : 'free');
    }
    if (maxMs && t - t0 >= maxMs) return done('timeout');
    await nap(pollMs);
  }
}

// ⏱ 양보로 기다린 시간(v1.0.18 · 2.0 무인 제작 ⑥ 「양보로 잃은 분」) — 이 프로세스가 원격에 비켜 선 초를 쌓는다(그림 = 위 waitRemoteIdle · 음성 = omnivoice-provider 의 미룸 답)
const _yield = { image: 0, tts: 0 };
function addYield(sec, kind = 'tts') { const v = Number(sec) || 0; if (v > 0) _yield[kind === 'image' ? 'image' : 'tts'] += v; }
function yieldStats() { return { image: _yield.image, tts: _yield.tts, total: _yield.image + _yield.tts }; }
function resetYield() { _yield.image = 0; _yield.tts = 0; }

module.exports = { isLocalBaseUrl, remoteActive, waitRemoteIdle, waitTtsQuiet, procId, procHeaders, addYield, yieldStats, resetYield };
