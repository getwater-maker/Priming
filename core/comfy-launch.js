/**
 * 로컬 ComfyUI **서버** 자동 실행 — "켜는 걸 깜빡해서 왜 안 되지" 를 없앤다.
 * ============================================================================
 * 로이 2026-08-22: "PC 가 켜질 때 컴피유아이 데스크탑이 자동으로 켜지게. 이것 켜는 것을
 *   매번 깜빡하는 바람에 왜 안되지 하는 상황이 계속 발생하네."
 *
 * 🔴 **정정(2026-08-22 실측) — v0.3.27 의 「Comfy Desktop.exe 를 띄우면 서버가 뜬다」는
 *    Comfy Desktop v1.0.39 에서 거짓이 됐다.** 부팅 18분 뒤 프로세스 8개가 살아 있는데
 *    **열린 포트가 0개**였고, `last-session.json` = `{"kind":"dashboard"}` 였다. 이제 그 앱은
 *    **대시보드(런처)** 로 뜨고 서버는 사람이 인스턴스를 클릭할 때만 시작된다.
 *    → **우리는 서버를 직접 띄운다**(`comfy/comfy-server.pyw`). UI 가 또 바뀌어도 안 깨진다.
 *
 * 방어선 두 겹 (둘이 **같은 런처**를 쓴다 — 갈라지면 다음 사람이 엉뚱한 쪽을 고친다)
 *   ① **부팅 자동 실행** = `shell:startup` 의 「ComfyUI 서버 (Priming 이미지용).lnk」
 *      → `<install>\ComfyUI\.venv\Scripts\pythonw.exe -s <앱>\comfy\comfy-server.pyw`
 *   ② **그래도 꺼져 있으면 앱이 켠다**(이 파일) — 같은 명령을 spawn 하고 떠오를 때까지 기다린다.
 *
 * 정책
 *   · 로컬 주소(127.0.0.1·localhost)일 때만 손댄다 — 남의 PC·클라우드 서버는 켤 수 없다.
 *   · **동시에 두 번 띄우지 않는다**(single-flight). 이미지 여러 장이 동시에 들어와도 한 번만.
 *     (런처도 자기 쪽에서 포트를 확인해 이중 실행을 막는다 = 두 겹)
 *   · 실행할 것을 못 찾으면 **조용히 실패하지 않고** 무엇을 해야 하는지 알려준다.
 *   · 여기서 예외를 던지지 않는다 — 판단은 호출부가 한다(생성을 건너뛸지, 그냥 시도할지).
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// ── Comfy Desktop 실행파일(폴백 전용) ─────────────────────────────────────────
//  v1.0.39+ 에서는 이걸 띄워도 서버가 안 뜬다. 그래도 **옛 버전 PC** 를 위해 마지막 수단으로 남긴다.
function candidates(extra) {
  const list = [];
  if (extra) list.push(String(extra));
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const la = process.env.LOCALAPPDATA || '';
  list.push(path.join(pf, 'Comfy Desktop', 'Comfy Desktop.exe'));
  if (la) list.push(path.join(la, 'Programs', 'Comfy Desktop', 'Comfy Desktop.exe'));
  return list;
}

function findExe(extra) {
  for (const p of candidates(extra)) {
    try { if (p && fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

/**
 * 어느 ComfyUI 를 띄울지 = Comfy Desktop 의 `installations.json` 이 정본.
 * 경로를 하드코딩하지 않으므로 사용자가 다시 설치하거나 드라이브를 옮겨도 따라간다.
 * @returns {{installPath:string, id:string}|null}
 */
function findInstance(appDataDir) {
  const cd = appDataDir || path.join(process.env.APPDATA || '', 'Comfy Desktop');
  let items;
  try { items = JSON.parse(fs.readFileSync(path.join(cd, 'installations.json'), 'utf8')); } catch (_) { return null; }
  if (!Array.isArray(items)) return null;
  let best = null;
  for (const it of items) {
    if (!it || typeof it !== 'object' || it.sourceId === 'cloud') continue;   // 클라우드는 켤 대상이 아니다
    const p = it.installPath;
    if (!p) continue;
    try { if (!fs.existsSync(path.join(p, 'ComfyUI', 'main.py'))) continue; } catch (_) { continue; }
    const rank = Number(it.lastLaunchedAt) || 0;
    if (!best || rank > best.rank) best = { rank, installPath: p, id: it.id };
  }
  return best ? { installPath: best.installPath, id: best.id } : null;
}

/**
 * 🔑 실행 파이썬은 `ComfyUI\.venv` 다 — `standalone-env` 가 **아니다**.
 * 실측(2026-08-22): standalone-env\pythonw.exe 로는 `No module named 'torch'` 로 즉사한다
 * (그건 기반 인터프리터일 뿐이고 torch 는 uv 가 만든 venv 안에 있다).
 * 런처가 스스로 재실행해 바로잡지만, 처음부터 맞게 부르는 게 낫다.
 */
function instancePython(installPath) {
  const dir = path.join(installPath, 'ComfyUI', '.venv', 'Scripts');
  for (const n of ['pythonw.exe', 'python.exe']) {
    const p = path.join(dir, n);
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  const base = path.join(installPath, 'standalone-env', 'pythonw.exe');   // 런처가 .venv 로 재실행해 준다
  try { if (fs.existsSync(base)) return base; } catch (_) {}
  return null;
}

/** 서버 런처 스크립트(`comfy/comfy-server.pyw`) — 매니페스트 포함이라 아내 PC 에도 내려간다. */
function launcherScript(appDir) {
  const p = path.join(appDir || path.join(__dirname, '..'), 'comfy', 'comfy-server.pyw');
  try { return fs.existsSync(p) ? p : null; } catch (_) { return null; }
}

/**
 * 무엇을 어떻게 실행할지 정한다.
 * @returns {{kind:'server'|'desktop', cmd:string, args:string[], label:string}|null}
 */
function resolveLaunch(opts = {}) {
  const { exePath = null, appDir = null, appDataDir = null } = opts;
  const inst = findInstance(appDataDir);
  const script = launcherScript(appDir);
  if (inst && script) {
    const py = instancePython(inst.installPath);
    if (py) {
      return { kind: 'server', cmd: py, args: ['-s', script], label: `ComfyUI 서버(${inst.installPath})` };
    }
  }
  const exe = findExe(exePath);           // 폴백 — 옛 Comfy Desktop 에서는 이것만으로도 서버가 떴다
  if (exe) return { kind: 'desktop', cmd: exe, args: [], label: `Comfy Desktop(${exe})` };
  return null;
}

/** 이 주소가 '이 PC' 인가 — 아니면 우리가 켤 수 있는 대상이 아니다. */
function isLocalUrl(baseUrl) {
  const s = String(baseUrl || '');
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(s);
}

/** 서버가 응답하는가. **HTTP 응답이 오면 살아 있는 것**(401/404 여도 서버는 떠 있다). */
async function ping(baseUrl, timeoutMs = 2500) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(base + '/system_stats', { signal: ctrl.signal });
    return true;
  } catch (_) {
    return false;
  } finally { clearTimeout(t); }
}

let _pending = null;   // single-flight — 동시에 여러 생성이 들어와도 한 번만 띄운다

/**
 * 로컬 ComfyUI 를 보장한다.
 * @returns {Promise<{ok:boolean, already?:boolean, launched?:boolean, skipped?:string,
 *                    reason?:string, message?:string, waitedSec?:number, exe?:string}>}
 */
async function ensureLocalComfy(opts = {}) {
  // spawnFn 은 테스트에서 갈아끼운다 — 진짜 앱을 띄우지 않고 기다림·단일실행·타임아웃을 검증하기 위해.
  const { baseUrl, log = () => {}, timeoutSec = 150, exePath = null, pollMs = 2000, spawnFn = spawn } = opts;
  if (!isLocalUrl(baseUrl)) return { ok: true, skipped: 'remote' };
  if (await ping(baseUrl)) return { ok: true, already: true };
  if (_pending) return _pending;                       // 이미 누가 띄우는 중 — 그 결과를 함께 쓴다

  _pending = (async () => {
    const plan = resolveLaunch(opts);
    if (!plan) {
      return {
        ok: false, reason: 'not-installed',
        message: `로컬 ComfyUI(${baseUrl})가 꺼져 있고 켤 방법도 못 찾았습니다.`
          + ` Comfy Desktop 에서 인스턴스를 한 번 설치·실행하거나, 헤더 「② 이미지」에서 ☁ 클라우드로 바꾸세요.`
          + ` (찾아본 곳: %APPDATA%\\Comfy Desktop\\installations.json · ${candidates(exePath).join(' · ')})`,
      };
    }
    const exe = plan.cmd;
    log(`🖥 로컬 ComfyUI 가 꺼져 있습니다 — 자동으로 켭니다: ${plan.label}`);
    if (plan.kind === 'desktop') {
      // v1.0.39+ 는 이걸로 서버가 안 뜬다(대시보드만). 왜 실패할지 미리 알려준다.
      log('   ⚠ 서버 런처를 못 찾아 Comfy Desktop 을 띄웁니다 — 최신 버전은 이것만으로 서버가 뜨지 않습니다.');
    }
    try {
      const child = spawnFn(exe, plan.args, { detached: true, stdio: 'ignore', windowsHide: true });
      if (child && typeof child.unref === 'function') child.unref();
    } catch (e) {
      return { ok: false, reason: 'spawn-failed', exe, message: `ComfyUI 실행 실패 — ${(e && e.message) || e}` };
    }
    const t0 = Date.now();
    const deadline = t0 + timeoutSec * 1000;
    let notified = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      if (await ping(baseUrl)) {
        const waitedSec = Math.round((Date.now() - t0) / 1000);
        log(`✅ 로컬 ComfyUI 준비됨 (${waitedSec}초 기다림)`);
        return { ok: true, launched: true, waitedSec, exe, kind: plan.kind };
      }
      if (!notified && Date.now() - t0 > 20000) {
        notified = true;
        log('   ⏳ ComfyUI 가 뜨는 중입니다(모델 폴더 스캔·custom_nodes 로딩에 1분 가까이 걸립니다)…');
      }
    }
    return {
      ok: false, reason: 'timeout', exe, kind: plan.kind, waitedSec: timeoutSec,
      message: `ComfyUI 를 켰지만 ${timeoutSec}초 안에 ${baseUrl} 가 응답하지 않았습니다.`
        + ` 무엇 때문인지는 로그에 남습니다: ${path.join(require('os').homedir(), '.shots-maker', 'logs', 'comfy-server.log')}`,
    };
  })().finally(() => { _pending = null; });

  return _pending;
}

module.exports = {
  ensureLocalComfy, ping, isLocalUrl, findExe, candidates,
  findInstance, instancePython, launcherScript, resolveLaunch,
};
