/**
 * 로컬 ComfyUI(데스크탑 앱) 자동 실행 — "켜는 걸 깜빡해서 왜 안 되지" 를 없앤다.
 * ============================================================================
 * 로이 2026-08-22: "PC 가 켜질 때 컴피유아이 데스크탑이 자동으로 켜지게. 이것 켜는 것을
 *   매번 깜빡하는 바람에 왜 안되지 하는 상황이 계속 발생하네."
 *
 * 방어선 두 겹
 *   ① **부팅 자동 실행** = 시작프로그램 바로가기(`shell:startup` 의 「ComfyUI (Priming 이미지용).lnk」).
 *      앱 코드가 아니라 윈도우가 켜 준다 — 앱을 안 켜는 날에도 서버가 떠 있다.
 *   ② **그래도 꺼져 있으면 앱이 켠다**(이 파일). 바로가기를 지웠거나, 창을 닫았거나,
 *      부팅 직후 아직 안 올라온 경우를 덮는다. 켜고 **떠오를 때까지 기다린다**.
 *
 * 정책
 *   · 로컬 주소(127.0.0.1·localhost)일 때만 손댄다 — 남의 PC·클라우드 서버는 켤 수 없다.
 *   · **동시에 두 번 띄우지 않는다**(single-flight). 이미지 여러 장이 동시에 들어와도 한 번만.
 *   · 실행파일을 못 찾으면 **조용히 실패하지 않고** 무엇을 해야 하는지 알려준다.
 *   · 여기서 예외를 던지지 않는다 — 판단은 호출부가 한다(생성을 건너뛸지, 그냥 시도할지).
 */

const path = require('path');
const { spawn } = require('child_process');

// 설치 위치 두 곳 — 전역 설치(Program Files)와 사용자 설치(LOCALAPPDATA) 모두 실측으로 확인됨.
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
  const fs = require('fs');
  for (const p of candidates(extra)) {
    try { if (p && fs.existsSync(p)) return p; } catch (_) {}
  }
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
    const exe = findExe(exePath);
    if (!exe) {
      return {
        ok: false, reason: 'not-installed',
        message: `로컬 ComfyUI(${baseUrl})가 꺼져 있고 「Comfy Desktop」 실행파일도 못 찾았습니다.`
          + ` 직접 켜거나, 헤더 「② 이미지」에서 ☁ 클라우드로 바꾸세요.`
          + ` (찾아본 곳: ${candidates(exePath).join(' · ')})`,
      };
    }
    log(`🖥 로컬 ComfyUI 가 꺼져 있습니다 — 자동으로 켭니다: ${exe}`);
    try {
      const child = spawnFn(exe, [], { detached: true, stdio: 'ignore' });
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
        return { ok: true, launched: true, waitedSec, exe };
      }
      if (!notified && Date.now() - t0 > 20000) {
        notified = true;
        log('   ⏳ ComfyUI 가 뜨는 중입니다(모델 폴더 스캔·업데이트 확인에 시간이 걸립니다)…');
      }
    }
    return {
      ok: false, reason: 'timeout', exe, waitedSec: timeoutSec,
      message: `ComfyUI 를 켰지만 ${timeoutSec}초 안에 ${baseUrl} 가 응답하지 않았습니다.`
        + ` 그 창에서 오류(업데이트 대기·설치 마법사)가 떠 있는지 확인하세요.`,
    };
  })().finally(() => { _pending = null; });

  return _pending;
}

module.exports = { ensureLocalComfy, ping, isLocalUrl, findExe, candidates };
