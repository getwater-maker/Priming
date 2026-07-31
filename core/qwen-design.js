// core/qwen-design.js
// ─────────────────────────────────────────────────────────────────────────────
// Qwen3-TTS 보이스디자인 서버(qwen-design/qwen_design_server.py, 포트 9893)의
// "온디맨드 생명주기"를 앱(메인 프로세스)에서 관리한다.
//   start()  → venv 파이썬으로 서버 spawn → /health 가 loaded 될 때까지 대기(첫 실행은
//              모델 4.5GB 다운로드라 오래 걸림). 이미 떠 있으면 재사용.
//   generate() → POST /design (instruct/text/language) → wav Buffer 반환.
//   stop()   → POST /shutdown 후 프로세스 종료(= GPU VRAM 반납).
// 앱은 보이스디자인 모달을 열 때 start, 닫을 때 stop 하고, 그 사이엔 OmniVoice TTS 합성을
// 막는다(뮤텍스, main.js). → OmniVoice(유휴 ~3.3GB)+Qwen(~6GB) 동시 무거운 사용을 차단.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const PORT = 9893;
const HOST = '127.0.0.1';

const S = { child: null, dir: null, started: false };

// 설정 파일(선택) — qwen-design 폴더 위치(dir) + **원격 서버 주소(baseUrl)**.
//   baseUrl 이 있고 로컬(127.0.0.1/localhost)이 아니면 **원격 모드**: spawn 하지 않고 그 서버에 붙는다.
//   (TTS OmniVoice 와 같은 정책 — GPU 없는 PC 는 메인 PC 서버를 가리키게 한다)
function _cfgPath() { return path.join(os.homedir(), '.shots-maker', 'qwen-design-config.json'); }
function _readCfg() {
  try { return JSON.parse(fs.readFileSync(_cfgPath(), 'utf8')) || {}; } catch { return {}; }
}
function _readCfgDir() { const c = _readCfg(); return c.dir || null; }
// 원격 주소 파싱 — 'host:9893' / 'http://host' / 'http://host:9893' 모두 허용. 반환 {host, port} 또는 null.
function remoteTarget() {
  const raw = String(_readCfg().baseUrl || '').trim();
  if (!raw) return null;
  const m = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '').match(/^([^:/]+)(?::(\d+))?$/);
  if (!m) return null;
  const host = m[1];
  if (/^(127\.0\.0\.1|localhost|::1)$/i.test(host)) return null; // 로컬을 가리키면 로컬 모드와 동일
  return { host, port: m[2] ? parseInt(m[2], 10) : PORT };
}
function isRemote() { return !!remoteTarget(); }
// 실제 통신 대상 — 원격 모드면 그 주소, 아니면 로컬.
function _target() { return remoteTarget() || { host: HOST, port: PORT }; }
function saveConfig(patch) {
  try {
    const next = { ..._readCfg(), ...(patch || {}) };
    fs.mkdirSync(path.dirname(_cfgPath()), { recursive: true });
    fs.writeFileSync(_cfgPath(), JSON.stringify(next, null, 2), 'utf8');
    return next;
  } catch { return _readCfg(); }
}
function loadConfig() { const c = _readCfg(); return { dir: c.dir || '', baseUrl: c.baseUrl || '', remote: isRemote(), port: PORT }; }

// qwen-design 폴더 탐색: 설정 → 앱 옆(__dirname/../qwen-design) → D:\Priming\qwen-design.
// venv\Scripts\python.exe 가 있는 곳을 정본으로 본다(= 최초설치.bat 로 만든 곳).
function resolveDir() {
  if (S.dir && _hasVenv(S.dir)) return S.dir;
  const cands = [
    _readCfgDir(),
    path.join(__dirname, '..', 'qwen-design'),
    path.join('D:', '\\', 'Priming', 'qwen-design'),
    'D:\\Priming\\qwen-design',
  ].filter(Boolean);
  for (const d of cands) { if (_hasVenv(d)) { S.dir = d; return d; } }
  // venv 없이 폴더만 있으면 그거라도(설치 전 안내용)
  for (const d of cands) { try { if (fs.existsSync(path.join(d, 'qwen_design_server.py'))) { S.dir = d; return d; } } catch {} }
  return null;
}
function _hasVenv(dir) {
  try { return !!dir && fs.existsSync(path.join(dir, 'venv', 'Scripts', 'python.exe')); } catch { return false; }
}
function pythonExe(dir) { return path.join(dir, 'venv', 'Scripts', 'python.exe'); }

function isInstalled() { const d = resolveDir(); return !!(d && _hasVenv(d)); }

// ── HTTP 유틸 — 원격 모드면 그 주소로, 아니면 로컬(127.0.0.1) ──────────────
function _get(pathname, timeoutMs = 4000) {
  const t = _target();
  return new Promise((resolve, reject) => {
    const req = http.get({ host: t.host, port: t.port, path: pathname, timeout: timeoutMs }, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(buf || '{}') }); } catch { resolve({ status: res.statusCode, json: {} }); } });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}
function _postJson(pathname, body, timeoutMs = 120000, binary = false) {
  const t = _target();
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({ host: t.host, port: t.port, path: pathname, method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        if (binary && res.statusCode === 200) return resolve({ status: res.statusCode, buffer: raw });
        let json = {}; try { json = JSON.parse(raw.toString('utf8') || '{}'); } catch {}
        resolve({ status: res.statusCode, json, buffer: raw });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(data); req.end();
  });
}

async function health() { try { const r = await _get('/health', 3000); return r.json || {}; } catch { return null; } }

// ── 생명주기 ────────────────────────────────────────────────────────────────
// start: 서버가 이미 loaded 면 즉시 반환. 아니면 spawn 후 loaded 될 때까지 폴링.
//   firstRun 은 모델 다운로드로 매우 오래 걸릴 수 있어 timeoutMs 를 크게(기본 20분).
async function start(logger = () => {}, { timeoutMs = 20 * 60 * 1000 } = {}) {
  const rt = remoteTarget();
  const h0 = await health();
  if (h0 && h0.loaded) { S.started = true; return { ok: true, reused: true }; }

  // ── 원격 모드 ── 다른 PC(메인 GPU PC)의 서버를 쓰므로 **spawn 하지 않는다**. 떠 있으면 쓰고, 없으면 안내만.
  if (rt) {
    // 지연 로딩 서버: 떠 있어도 모델은 안 올라가 있으므로 /prepare 로 로드를 요청한다(구버전 서버는 404 → 무해).
    if (h0 && !h0.loaded && !h0.loading) { try { await _postJson('/prepare', {}, 5000); } catch {} }
    if (h0 && (h0.loading || h0.lazy)) {
      logger(`🎨 원격 보이스디자인(${rt.host}:${rt.port}) 모델 준비 중 — 대기…`);
    } else if (!h0) {
      return { ok: false, error: `메인 PC 의 보이스디자인 서버(${rt.host}:${rt.port})에 연결할 수 없습니다.\n메인 PC 에서 qwen-design 폴더의 "2_서버_수동테스트.bat" 을 실행해 서버를 켜 두고 다시 시도하세요.` };
    }
    const t0r = Date.now();
    while (Date.now() - t0r < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2000));
      const h = await health();
      if (h && h.error) return { ok: false, error: h.error };
      if (h && h.loaded) { S.started = true; logger('🎨 원격 보이스디자인 준비 완료'); return { ok: true, remote: true }; }
      if (!h) return { ok: false, error: `원격 서버(${rt.host}:${rt.port}) 연결이 끊겼습니다.` };
    }
    return { ok: false, error: '원격 보이스디자인 서버 준비 시간 초과' };
  }

  const dir = resolveDir();
  if (!dir) return { ok: false, error: 'qwen-design 폴더를 찾을 수 없음(최초설치.bat 실행 필요)' };
  if (!_hasVenv(dir)) return { ok: false, error: `설치 안 됨 — ${path.join(dir, '1_최초설치.bat')} 를 먼저 실행하세요` };

  // 이미 다른 프로세스(수동 실행 등)가 떠 있고 로딩 중이면 그걸 기다림
  if (!(h0 && (h0.loaded || h0.loading))) {
    logger('🎨 보이스디자인 서버 기동…');
    const py = pythonExe(dir);
    // --host 0.0.0.0 : 다른 PC(아내 PC)가 LAN/Tailscale 로 이 서버에 붙을 수 있게 한다.
    //   ⚠ 방화벽에서 9893 인바운드 허용이 별도로 필요(코드로 바꾸지 않음).
    const child = spawn(py, ['qwen_design_server.py', '--host', '0.0.0.0', '--port', String(PORT)], {
      cwd: dir, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    S.child = child;
    child.stdout.on('data', (d) => String(d).split(/\r?\n/).forEach((l) => l.trim() && logger('  [qwen] ' + l.trim())));
    child.stderr.on('data', (d) => String(d).split(/\r?\n/).forEach((l) => l.trim() && logger('  [qwen] ' + l.trim())));
    child.on('exit', (code) => { logger(`🎨 보이스디자인 서버 종료(code ${code})`); if (S.child === child) S.child = null; });
  } else {
    logger('🎨 보이스디자인 서버 이미 로딩 중 — 대기…');
  }

  // /health 폴링(loaded 대기). 지연 로딩 서버는 /prepare 로 로드를 요청해야 올라간다.
  const t0 = Date.now();
  let announced = false, prepared = false;
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const h = await health();
    if (h && h.error) return { ok: false, error: h.error };
    if (h && h.loaded) { S.started = true; logger('🎨 보이스디자인 준비 완료'); return { ok: true }; }
    // 서버는 떴는데 로드 중도 아니면(=지연 로딩 대기 상태) 로드를 요청한다. 한 번만.
    if (h && !h.loaded && !h.loading && !prepared) { prepared = true; try { await _postJson('/prepare', {}, 5000); } catch {} }
    if (h && h.loading && !announced) { announced = true; logger('🎨 모델 로딩 중… (첫 실행은 4.5GB 다운로드로 수 분 소요)'); }
  }
  return { ok: false, error: '보이스디자인 서버 준비 시간 초과' };
}

// generate: 목소리 1개 생성 → { ok, buffer(wav) } 또는 { ok:false, error }
async function generate({ instruct, text, language = 'Korean' }, logger = () => {}) {
  const h = await health();
  // 사용자에게 그대로 보이는 문구 — 개발자용("start() 필요")이 아니라 무엇을 해야 하는지 알려준다.
  if (!h) {
    const rt = remoteTarget();
    return { ok: false, error: rt
      ? `메인 PC 의 보이스디자인 서버(${rt.host}:${rt.port})에 연결할 수 없습니다 — 메인 PC 에서 서버를 켜 두고 「🔄 서버 다시 준비」를 눌러 주세요.`
      : '디자인 서버가 떠 있지 않습니다 — 「🔄 서버 다시 준비」를 누르거나 창을 닫고 다시 열어 주세요. (다른 PC 라면 ⚙ 설정 → TTS 서버 에서 보이스디자인 주소를 메인 PC 로 지정하세요)' };
  }
  if (!h.loaded) return { ok: false, error: '모델 로딩 중입니다 — 준비 완료 메시지가 뜬 뒤 다시 눌러 주세요(첫 실행은 수 분 소요).' };
  try {
    const r = await _postJson('/design', { instruct, text, language }, 180000, true);
    if (r.status === 200 && r.buffer && r.buffer.length > 44) return { ok: true, buffer: r.buffer };
    let msg = 'unknown'; try { msg = JSON.parse(r.buffer.toString('utf8')).error || msg; } catch {}
    return { ok: false, error: `생성 실패(${r.status}): ${msg}` };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

async function stop(logger = () => {}) {
  S.started = false;
  // ⚠ **우리가 띄운 서버가 아니면 죽이지 않는다** — 원격 서버, 또는 이 PC 에서 상시 실행(작업 스케줄러/배치)
  //    중인 서버를 앱이 내려버리면 다른 PC 가 못 쓴다. 대신 `/release` 로 **모델만 내려 VRAM 을 반납**한다.
  if (isRemote() || !S.child) {
    try { await _postJson('/release', {}, 5000).catch(() => {}); } catch {}
    logger(isRemote() ? '🎨 원격 서버 유지 — 모델만 해제 요청(VRAM 반납)' : '🎨 상시 실행 서버 유지 — 모델만 해제(VRAM 반납)');
    return { ok: true, released: true };
  }
  // 우리가 spawn 한 서버면 완전히 종료(옛 동작).
  try { await _postJson('/shutdown', {}, 3000).catch(() => {}); } catch {}
  await new Promise((r) => setTimeout(r, 600));
  if (S.child) { try { S.child.kill(); } catch {} S.child = null; }
  logger('🎨 보이스디자인 서버 정지(VRAM 반납)');
  return { ok: true };
}

async function status() {
  const h = await health();
  const rt = remoteTarget();
  return {
    // 원격 모드면 로컬 설치가 필요 없으므로 installed=true 로 본다(UI 가 '설치 안 됨' 으로 막지 않게).
    installed: rt ? true : isInstalled(),
    remote: !!rt, target: rt ? `${rt.host}:${rt.port}` : `${HOST}:${PORT}`,
    running: !!h, loaded: !!(h && h.loaded), loading: !!(h && h.loading),
    error: (h && h.error) || null, dir: rt ? '' : resolveDir(),
  };
}

module.exports = { start, generate, stop, status, health, isInstalled, resolveDir, isRemote, remoteTarget, loadConfig, saveConfig, PORT };
