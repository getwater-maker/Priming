'use strict';

/**
 * whiteboard-render.js — 화이트보드 손그림 애니메이션 렌더러(파이썬)를 자식 프로세스로 부른다.
 *
 * 엔진 자체는 `whiteboard/py/` 에 벤더링돼 있다(출처·구조는 `whiteboard/UPSTREAM.md`).
 * 이 파일은 **Node ↔ 파이썬 경계만** 담당한다: 가상환경 준비 · spawn · 진행률 파싱 · 성공 판정.
 *
 * ⚠ 엔진은 그림을 만들지 않는다. 완성된 선화를 받아 종이색으로 덮고 펜이 지나간 자리만 걷어낸다.
 *   즉 **넣는 그림이 결과물의 천장**이다. 이미지 생성은 core/comfy-image.js 가 한다.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', 'whiteboard');
const PY_DIR = path.join(ROOT, 'py');
const VENV_DIR = path.join(ROOT, '.venv');
const IS_WIN = process.platform === 'win32';

// ── 가상환경 ────────────────────────────────────────────────────────────────
//  격리 venv 를 쓰는 이유: 로이 PC 의 D:\miniconda3 는 pkgs 쓰기 권한(옛 SID ACL) 문제와
//  setuptools 빌드 격리(pkg_resources) 함정이 실측으로 확인돼 있다. venv 가 둘 다 피한다.
function venvPython() {
  return IS_WIN ? path.join(VENV_DIR, 'Scripts', 'python.exe') : path.join(VENV_DIR, 'bin', 'python');
}
function hasEnv() {
  try { return fs.existsSync(venvPython()); } catch (_) { return false; }
}

// 부트스트랩용 시스템 파이썬 — venv 를 만들 때 **한 번만** 쓴다.
//   ⚠ pythonw 를 쓰지 않는다. 콘솔이 없으면 print 가 터져 조용히 죽는다(v0.2.95·v0.3.30 실사고).
function systemPythonCandidates(extra) {
  const list = [];
  if (extra) list.push(String(extra));
  if (process.env.PRIMING_PYTHON) list.push(process.env.PRIMING_PYTHON);
  if (IS_WIN) {
    for (const d of ['D:\\miniconda3', 'C:\\miniconda3', process.env.CONDA_PREFIX || '']) {
      if (d) list.push(path.join(d, 'python.exe'));
    }
    const la = process.env.LOCALAPPDATA || '';
    if (la) list.push(path.join(la, 'Programs', 'Python', 'Python313', 'python.exe'));
    list.push('python.exe', 'python');   // PATH 에 맡김
  } else {
    list.push('python3', 'python');
  }
  return list;
}
function findSystemPython(extra) {
  for (const p of systemPythonCandidates(extra)) {
    if (!p) continue;
    if (p.includes(path.sep) || p.includes('/')) {           // 절대경로면 실재 확인
      try { if (fs.existsSync(p)) return p; } catch (_) {}
    } else {
      return p;                                              // PATH 이름은 spawn 이 판단
    }
  }
  return null;
}

/** 파이썬 자식 공통 환경 — 한글 출력 + **버퍼링 해제**(진행률이 덩어리로 늦게 오는 것 방지). */
function pyEnv() {
  return { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' };
}

/**
 * 자식 파이썬 실행 — 줄 단위로 잘라 onLine 에 넘긴다.
 * @returns {Promise<{code:number, lines:string[]}>}  ⚠ 0이 아니어도 reject 하지 않는다(호출부가 판정).
 */
function runPy(exe, args, { cwd, onLine, abortSignal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      // -u : 버퍼링 해제(환경변수와 이중으로). 벤더링본에 flush=True 가 없어 둘 다 필요하다.
      child = spawn(exe, ['-u', ...args], { cwd: cwd || PY_DIR, windowsHide: true, env: pyEnv() });
    } catch (e) { return reject(new Error(`파이썬 실행 실패: ${e.message}`)); }

    const lines = [];
    let buf = '';
    const feed = (chunk) => {
      buf += String(chunk);
      const parts = buf.split(/\r?\n/);
      buf = parts.pop();
      for (const l of parts) { lines.push(l); if (onLine) { try { onLine(l); } catch (_) {} } }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);

    let aborted = false;
    const onAbort = () => { aborted = true; try { child.kill(); } catch (_) {} };
    if (abortSignal) {
      if (abortSignal.aborted) onAbort();
      else abortSignal.addEventListener('abort', onAbort, { once: true });
    }
    child.on('error', (e) => reject(new Error(`파이썬 실행 실패: ${e.message}`)));
    child.on('close', (code) => {
      if (buf.trim()) { lines.push(buf); if (onLine) { try { onLine(buf); } catch (_) {} } }
      if (abortSignal) { try { abortSignal.removeEventListener('abort', onAbort); } catch (_) {} }
      if (aborted) return reject(new Error('중단됨'));
      resolve({ code, lines });
    });
  });
}

/**
 * 가상환경 준비 — 없으면 만들고 의존성(opencv-python·numpy·av·Pillow)을 깐다.
 * 이미 있으면 즉시 반환(재확인 비용 0).
 */
async function ensureEnv({ log = () => {}, pythonPath = null, abortSignal = null } = {}) {
  if (hasEnv()) return { ok: true, python: venvPython(), created: false };
  if (!fs.existsSync(PY_DIR)) {
    return { ok: false, error: `화이트보드 엔진이 없습니다 — ${PY_DIR} (설치본이 오래됐으면 앱을 재시작해 업데이트를 받으세요)` };
  }
  const sys = findSystemPython(pythonPath);
  if (!sys) return { ok: false, error: '파이썬을 찾지 못했습니다 — 파이썬 3.10+ 을 설치하거나 PRIMING_PYTHON 환경변수로 경로를 지정하세요' };

  log('🐍 화이트보드 가상환경 준비… (처음 한 번만, 수 분 걸립니다)');
  try {
    const r = await runPy(sys, [path.join(PY_DIR, 'prepare_env.py')], {
      onLine: (l) => { if (l.trim()) log('  ' + l.trim()); }, abortSignal,
    });
    if (!hasEnv()) return { ok: false, error: `가상환경 생성 실패(code ${r.code}) — 위 로그를 확인하세요` };
  } catch (e) { return { ok: false, error: e.message }; }
  log('✅ 화이트보드 가상환경 준비 완료');
  return { ok: true, python: venvPython(), created: true };
}

// ── 주석 ↔ 그림 크기 검사 (fail-closed) ──────────────────────────────────────
/**
 * `annotation.canvas` 는 **원본 PNG 픽셀 크기**여야 한다(렌더러가 출력 크기로 환산한다).
 * 어긋나면 영역 좌표가 엉뚱한 자리를 가리켜 **29분을 태우고 틀린 영상**이 나온다 —
 * 그건 사람이 눈으로 봐야만 알 수 있으므로 **여기서 막는다(fail-closed)**.
 *
 * 삭제 규칙(그림을 지우면 주석도 지운다)만으로는 새는 경로가 있다:
 *   손으로 그림 교체 · 워크플로 변경으로 해상도 변화 · 남의 주석 복사 · 후처리가 크기를 바꿈.
 */
function checkCanvas(imagePath, annotationPath) {
  let dim = null;
  try {
    const { readImageSize } = require('../vrew/vrew-builder');
    dim = readImageSize(imagePath);          // ⚠ {w, h} 를 반환한다 — width/height 아님(v0.2.6 사고).
  } catch (_) { /* 못 읽으면 아래에서 실패 처리 */ }
  if (!dim || !dim.w || !dim.h) return { ok: false, error: `그림 크기를 읽을 수 없습니다: ${imagePath}` };

  let ann = null;
  try { ann = JSON.parse(fs.readFileSync(annotationPath, 'utf8')); }
  catch (e) { return { ok: false, error: `주석을 읽을 수 없습니다: ${e.message}` }; }
  const c = ann && ann.canvas;
  if (!c || !c.width || !c.height) return { ok: false, error: `주석에 canvas 크기가 없습니다: ${path.basename(annotationPath)}` };

  if (c.width !== dim.w || c.height !== dim.h) {
    return {
      ok: false,
      error: `주석과 그림의 크기가 다릅니다 — 주석 ${c.width}x${c.height} · 그림 ${dim.w}x${dim.h} `
        + `(${path.basename(imagePath)}). 그림이 바뀌었으면 주석을 다시 만드세요 — 그대로 렌더하면 엉뚱한 자리를 그립니다.`,
    };
  }
  return { ok: true, w: dim.w, h: dim.h, elements: Array.isArray(ann.elements) ? ann.elements.length : 0 };
}

// ── 진행률 파싱 ─────────────────────────────────────────────────────────────
//  🔴 주석 기반 진입점(`render_stream_whiteboard.py`)은 **원본에 진행 표시가 없었다.**
//     `stream_render.py` 의 `선 긋기 진행: 45%` 는 **그 파일의 자체 진입점** 렌더러 것이라 여기선 안 나온다
//     (두 진입점이 서로 다른 렌더 루프를 쓴다 — 헷갈리기 쉬운 자리라 적어 둔다).
//     그래서 상류(`D:\화이트보드`)에 `영역 진행: k/N` 한 줄을 넣었다(PATCHES.md 7번).
//  ⚠ 영역 k 를 **시작**했다는 뜻이므로 완료분은 k-1 이다. 100% 는 OUTPUT= 을 받은 뒤에만 준다.
const RE_ELEM = /^\s*영역 진행:\s*(\d+)\s*\/\s*(\d+)/;
const RE_STAGE = /^\s+(선 긋기|채색)[^:]*:\s*(\d+)%/;          // 다른 진입점용 폴백
const RE_SIZE = /출력 크기:\s*(\d+)x(\d+),\s*프레임레이트:\s*(\d+)/;
const RE_OUTPUT = /^OUTPUT=(.+)$/;
const RE_ERR = /^\[err\]\s*(.*)$/;

function makeProgressTracker(elementCount, onProgress) {
  let total = Math.max(1, elementCount || 1);
  let pct = 0;
  return (line) => {
    let m;
    if ((m = line.match(RE_ELEM))) {
      total = Math.max(1, parseInt(m[2], 10) || total);
      pct = Math.round(((parseInt(m[1], 10) || 1) - 1) / total * 100);
    } else if ((m = line.match(RE_STAGE))) {
      pct = Math.max(pct, Math.min(99, parseInt(m[2], 10) || 0));
    } else return;                                   // 무관한 줄에는 콜백을 부르지 않는다
    if (onProgress) { try { onProgress(Math.max(0, Math.min(99, pct))); } catch (_) {} }
  };
}

// ── 장면 1개 렌더 ───────────────────────────────────────────────────────────
/**
 * @returns {Promise<{ok:boolean, output?:string, width?:number, height?:number, fps?:number, error?:string}>}
 *
 * ⚠ **exit code 를 믿지 않는다.** 마지막 줄의 `OUTPUT=<경로>` 가 성공 계약이고,
 *   `[err]` 접두 줄이 실패 사유다. 파일이 실제로 존재하는지까지 확인한다
 *   ("조용한 성공"에 여러 번 당했다 — v0.3.61 은 0장 만들고 완료를 반환했다).
 */
async function renderScene(opts = {}) {
  const { imagePath, annotationPath, outputPath, capLongEdge = null, inkPath = null, colorFill = null,
    totalMs = null, elementCount = 0, log = () => {}, onProgress = null, abortSignal = null } = opts;

  if (!hasEnv()) return { ok: false, error: '화이트보드 가상환경이 없습니다 — ensureEnv() 를 먼저 부르세요' };

  // ⚠ 자식은 cwd 가 py/ 라 **상대경로를 절대로 그대로 넘기면 안 된다** — py/ 기준으로 풀려 파일을 못 찾는다.
  const img = path.resolve(imagePath), ann = path.resolve(annotationPath), out = path.resolve(outputPath);

  const chk = checkCanvas(img, ann);
  if (!chk.ok) return { ok: false, error: chk.error };

  const args = [path.join(PY_DIR, 'render_stream_whiteboard.py'), img, ann, out];
  if (capLongEdge) args.push('--cap-long-edge', String(capLongEdge));
  if (inkPath) args.push('--ink-path', String(inkPath));
  if (colorFill) args.push('--color-fill', String(colorFill));
  if (totalMs) args.push('--total-ms', String(Math.round(totalMs)));

  const tick = makeProgressTracker(elementCount || chk.elements, onProgress);
  let output = null, width = 0, height = 0, fps = 0;
  const errs = [];

  let r;
  try {
    r = await runPy(venvPython(), args, {
      abortSignal,
      onLine: (line) => {
        tick(line);
        let m;
        if ((m = line.match(RE_OUTPUT))) output = m[1].trim();
        else if ((m = line.match(RE_ERR))) { errs.push(m[1].trim()); log(`  ⚠ ${m[1].trim()}`); }
        else if ((m = line.match(RE_SIZE))) { width = +m[1]; height = +m[2]; fps = +m[3]; }
      },
    });
  } catch (e) { return { ok: false, error: e.message }; }

  if (!output) {
    return { ok: false, error: errs.length ? errs.join(' · ') : `렌더가 결과 경로를 알리지 않았습니다(code ${r.code})` };
  }
  if (!fs.existsSync(output)) return { ok: false, error: `렌더는 성공했다는데 파일이 없습니다: ${output}` };
  return { ok: true, output, width, height, fps };
}

// ── 영역 번호 확인 그림 (관문 B) ────────────────────────────────────────────
async function renderPreview({ imagePath, annotationPath, outputPath, abortSignal = null } = {}) {
  if (!hasEnv()) return { ok: false, error: '화이트보드 가상환경이 없습니다' };
  try {
    const out = path.resolve(outputPath);   // ⚠ 자식 cwd 가 py/ 다 — 절대경로로 넘긴다
    const r = await runPy(venvPython(), [path.join(PY_DIR, 'render_annotation_preview.py'),
      path.resolve(imagePath), path.resolve(annotationPath), out], { abortSignal });
    if (!fs.existsSync(out)) return { ok: false, error: `확인 그림이 만들어지지 않았습니다(code ${r.code})` };
    return { ok: true, output: out };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── 장면 이어붙이기 ─────────────────────────────────────────────────────────
/**
 * ⚠ `merge_scenes.py` 는 `-c copy` 무손실 병합을 먼저 시도한다 →
 *   **장면끼리 코덱·해상도·fps 가 같아야 한다.** 렌더 결과의 헤더값으로 미리 대조해 걸러낸다
 *   (튜닝본 1080 과 최종본 1920 이 한 폴더에 섞이는 사고가 실제로 있을 만하다).
 */
function checkUniform(scenes) {
  const bad = [];
  const first = scenes.find((s) => s && s.width);
  if (!first) return { ok: true };
  for (const s of scenes) {
    if (!s || !s.width) continue;
    if (s.width !== first.width || s.height !== first.height || s.fps !== first.fps) {
      bad.push(`${path.basename(s.output)} ${s.width}x${s.height}@${s.fps}`);
    }
  }
  if (bad.length) {
    return { ok: false, error: `장면끼리 규격이 다릅니다(기준 ${first.width}x${first.height}@${first.fps}) — ${bad.join(' · ')}. `
      + `해상도를 통일해 다시 렌더하세요(무손실 이어붙이기가 깨집니다).` };
  }
  return { ok: true };
}

async function mergeScenes({ inputs, outputPath, abortSignal = null } = {}) {
  if (!hasEnv()) return { ok: false, error: '화이트보드 가상환경이 없습니다' };
  if (!inputs || !inputs.length) return { ok: false, error: '이어붙일 장면이 없습니다' };
  const out = path.resolve(outputPath);      // ⚠ 자식 cwd 가 py/ 다 — 절대경로로 넘긴다
  const args = [path.join(PY_DIR, 'merge_scenes.py'), '--inputs', ...inputs.map((i) => path.resolve(i)), '--output', out];
  try {
    const r = await runPy(venvPython(), args, { abortSignal });
    if (!fs.existsSync(out)) return { ok: false, error: `병합 결과가 없습니다(code ${r.code})` };
    return { ok: true, output: out };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = {
  ROOT, PY_DIR, VENV_DIR,
  venvPython, hasEnv, findSystemPython, ensureEnv, runPy,
  checkCanvas, checkUniform, makeProgressTracker,
  renderScene, renderPreview, mergeScenes,
};
