/**
 * 🖼 원격 ComfyUI 켜고 끄기 — 메인 PC 음성 서버(:9881)에 맡긴다(v1.0.39 · 로이 2026-11-05 「원격 깨우기로」).
 * ============================================================================
 * 왜: 아내 PC 의 「🖥 로컬 Qwen」은 메인 PC 의 ComfyUI 를 빌려 쓴다. 메인 PC 앱은 그림을 마칠 때마다
 *   ComfyUI 를 끄는데(v0.9.111 RAM 돌려주기) 아내 PC 는 꺼진 서버를 켤 수 없어 「ComfyUI 연결 실패」로 멈췄다.
 *   → 켜고 끄는 판단을 두 PC 가 모두 닿는 메인 PC 음성 서버 한 곳(api.py `/comfy-*`)에 모은다.
 *   · 원격 PC: 꺼져 있으면 `/comfy-wake`(서버가 예약 작업 `Priming_ComfyUI` 로 켠다) → 뜰 때까지 기다린다
 *   · 모든 PC: 로컬 Qwen 작업 동안 1분마다 `/comfy-touch` — 서버가 누가 쓰는 중인지 안다
 *   · 메인 PC: 끄기 전에 `/comfy-recent` — 다른 PC 가 최근 썼으면 끄지 않는다
 *   · 원격 PC: 끝나면 `/comfy-stop` — 서버가 다른 쪽 사용·큐를 보고 판단한다
 * 판정: 서버가 옛 판(404)이거나 안 닿으면 예전처럼(fail-open) — 다만 원격 깨우기 실패는 까닭을 그대로 알린다.
 * 여기서 예외를 던지지 않는다.
 */
'use strict';

const TASK_NAME = 'Priming_ComfyUI';
const TOUCH_MS = 60 * 1000;

function voiceBase() {
  try { return String((require('../tts/tts-config').getProvider('omnivoice') || {}).baseUrl || '').replace(/\/+$/, ''); } catch (_) { return ''; }
}
// 🖼 X-Priming-Proc = 이 프로그램의 표지(v1.0.42 · core/gpu-share.procId) — 같은 PC 의 다른 Priming 이 그리는 동안 서버가 이 프로그램 음성을 막는다
function authHeaders() {
  const h = {};
  try { Object.assign(h, require('./gpu-share').procHeaders()); } catch (_) {}
  try { const s = require('../tts/secret-store').get('omnivoice'); if (s && s.apiKey) h['X-API-Key'] = s.apiKey; } catch (_) {}
  return h;
}

async function call(p, { method = 'POST', base = voiceBase(), fetchFn = fetch, timeoutMs = 20000 } = {}) {
  if (!base) return { status: 0, json: null, error: 'TTS 서버 주소가 없습니다' };
  try {
    const r = await fetchFn(base + p, { method, headers: authHeaders(), signal: AbortSignal.timeout(timeoutMs) });
    let json = null; try { json = await r.json(); } catch (_) {}
    return { status: r.status, json };
  } catch (e) { return { status: 0, json: null, error: (e && e.message) || String(e) }; }
}

/**
 * 원격 ComfyUI 를 보장한다(comfy-launch.ensureLocalComfy 가 원격 주소일 때 부른다).
 * @returns {Promise<{ok:boolean, already?:boolean, launched?:boolean, reason?:string, message?:string, waitedSec?:number}>}
 */
async function wake(opts = {}) {
  const { baseUrl, log = () => {}, timeoutSec = 150, pollMs = 2000, fetchFn = fetch, ping, base = voiceBase() } = opts;
  const pingFn = ping || require('./comfy-launch').ping;
  if (await pingFn(baseUrl)) { call('/comfy-touch', { base, fetchFn, timeoutMs: 5000 }).catch(() => {}); return { ok: true, already: true }; }
  log(`🖥 메인 PC ComfyUI(${baseUrl})가 꺼져 있습니다 — 메인 PC 음성 서버에 켜 달라고 요청합니다`);
  const r = await call('/comfy-wake', { base, fetchFn });
  if (r.status === 404) return { ok: false, reason: 'old-server', message: `메인 PC ComfyUI(${baseUrl})가 꺼져 있습니다 — 메인 PC 음성 서버가 옛 판이라 원격으로 켤 수 없습니다(메인 PC 에서 음성 서버를 다시 시작해야 합니다)` };
  if (!r.status) return { ok: false, reason: 'no-voice-server', message: `메인 PC ComfyUI(${baseUrl})가 꺼져 있고, 켜 달라고 할 음성 서버(${base || '주소 없음'})에도 닿지 않습니다 — ${r.error || ''}` };
  if (!r.json || !r.json.ok) {
    const why = r.json && r.json.reason === 'no-task'
      ? `메인 PC 에 예약 작업 「${TASK_NAME}」이 없습니다(메인 PC 앱을 한 번 켜면 등록됩니다)`
      : ((r.json && (r.json.message || r.json.reason)) || ('HTTP ' + r.status));
    return { ok: false, reason: 'wake-failed', message: `메인 PC ComfyUI(${baseUrl})를 켜지 못했습니다 — ${why}` };
  }
  const t0 = Date.now();
  let notified = false;
  while (Date.now() - t0 < timeoutSec * 1000) {
    await new Promise((res) => setTimeout(res, pollMs));
    if (await pingFn(baseUrl)) {
      const waitedSec = Math.round((Date.now() - t0) / 1000);
      log(`✅ 메인 PC ComfyUI 준비됨 (${waitedSec}초 기다림)`);
      return { ok: true, launched: true, waitedSec };
    }
    if (!notified && Date.now() - t0 > 20000) { notified = true; log('   ⏳ 메인 PC ComfyUI 가 뜨는 중입니다(1분 가까이 걸립니다)…'); }
  }
  return { ok: false, reason: 'timeout', message: `메인 PC ComfyUI 를 켰지만 ${timeoutSec}초 안에 ${baseUrl} 가 응답하지 않았습니다 — 메인 PC 의 ~/.shots-maker/logs/comfy-server.log 를 보세요` };
}

/** 로컬 Qwen 작업 동안 「쓰는 중」을 알린다. 돌려준 함수를 부르면 멈춘다. */
function startTouch(opts = {}) {
  const { fetchFn = fetch, base = voiceBase(), everyMs = TOUCH_MS } = opts;
  if (!base) return () => {};
  const tick = () => { call('/comfy-touch', { base, fetchFn, timeoutMs: 5000 }).catch(() => {}); };
  tick();
  const t = setInterval(tick, everyMs);
  if (t && typeof t.unref === 'function') t.unref();
  return () => clearInterval(t);
}

/** 다른 PC 가 최근 쓴 기록 — {ip: 몇 초 전}. 서버가 없거나 옛 판이면 {} (fail-open = 예전처럼 끈다). */
async function othersRecent(opts = {}) {
  const r = await call('/comfy-recent', { method: 'GET', timeoutMs: 5000, ...opts });
  return (r.status === 200 && r.json && r.json.recent && typeof r.json.recent === 'object') ? r.json.recent : {};
}

/** 원격 PC 가 끝났을 때 — 서버에 끄기를 부탁한다. */
async function stopRemote(opts = {}) {
  const { log = () => {} } = opts;
  const r = await call('/comfy-stop', { timeoutMs: 20000, ...opts });
  const j = r.json || {};
  if (j.stopped) log('  🛑 메인 PC ComfyUI 서버를 껐습니다 — 메인 PC RAM 을 돌려줍니다');
  else if (j.reason === 'other-client') log('  🖥 메인 PC ComfyUI 는 끄지 않습니다 — 다른 PC 가 최근 썼습니다');
  return { stopped: !!j.stopped, reason: j.reason || (r.status === 404 ? 'old-server' : (r.status ? 'http-' + r.status : 'no-voice-server')) };
}

/**
 * 메인 PC(음성 서버 + ComfyUI 가 있는 PC)에서 예약 작업 `Priming_ComfyUI` 를 등록한다 — 앱 시작 때마다 덮어쓴다.
 *   음성 서버(SYSTEM)는 이 작업을 `schtasks /run` 으로 실행만 한다 → ComfyUI 는 로이 사용자 · 화면 세션에서 뜬다.
 *   트리거 없음(부팅 자동 실행은 시작프로그램 바로가기가 따로 한다) · 시간 제한 없음 · 이미 돌면 새로 안 띄움.
 *   관리자 권한이 필요 없다(자기 계정 작업). 비동기 — 메인 프로세스 동기 자식 금지.
 */
function taskXml({ cmd, args, workDir, userId }) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const argStr = (args || []).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Priming — 아내 PC 가 메인 PC 음성 서버를 거쳐 ComfyUI 를 켤 때 쓴다(앱이 시작 때마다 다시 등록)</Description></RegistrationInfo>
  <Triggers />
  <Principals><Principal id="Author"><UserId>${esc(userId)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>${esc(cmd)}</Command><Arguments>${esc(argStr)}</Arguments><WorkingDirectory>${esc(workDir)}</WorkingDirectory></Exec></Actions>
</Task>
`;
}

async function ensureWakeTask(opts = {}) {
  const { log = () => {}, execFileFn = require('child_process').execFile } = opts;
  const path = require('path'), fs = require('fs'), os = require('os');
  if (process.platform !== 'win32') return { ok: false, skipped: 'not-windows' };
  const plan = require('./comfy-launch').resolveLaunch(opts);
  if (!plan || plan.kind !== 'server') return { ok: false, skipped: 'no-comfy' };
  const userId = (process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : '') + (os.userInfo().username || process.env.USERNAME || '');
  const xml = taskXml({ cmd: plan.cmd, args: plan.args, workDir: path.dirname(plan.args[plan.args.length - 1]), userId });
  const tmp = path.join(os.tmpdir(), `priming-comfy-task-${process.pid}.xml`);
  try { fs.writeFileSync(tmp, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')])); } catch (e) { return { ok: false, message: e.message }; }
  const res = await new Promise((resolve) => execFileFn('schtasks.exe', ['/create', '/tn', TASK_NAME, '/xml', tmp, '/f'], { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => resolve({ err, out: String(stderr || stdout || '') })));
  try { fs.unlinkSync(tmp); } catch (_) {}
  if (res.err) { log(`⚠ 예약 작업 「${TASK_NAME}」 등록 실패 — 아내 PC 가 이 PC 의 ComfyUI 를 켤 수 없습니다: ${res.err.message || res.out}`); return { ok: false, message: String(res.err.message || res.out) }; }
  return { ok: true };
}

module.exports = { wake, startTouch, othersRecent, stopRemote, voiceBase, ensureWakeTask, taskXml, TASK_NAME };
