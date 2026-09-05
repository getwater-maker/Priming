'use strict';

/**
 * whiteboard-config.js — 화이트보드 렌더 설정(PC 별 · `~/.priming-maker/whiteboard-config.json`).
 *
 * 값이 둘뿐이다:
 *   · capLongEdge — 출력 긴 변(px). 1920 이 최종본. **렌더 시간은 픽셀 수에 비례**한다(실측: 16초 예제가
 *     1920 에서 83초 = 프레임당 0.173초 → 22분 편이면 4병렬로 29분). 1080 은 약 1/3, 640 은 시험용.
 *     ⚠ 튜닝·확인 중에는 반드시 낮춰서 돌린다 — 안 그러면 한 번 고칠 때마다 29분을 태운다.
 *   · concurrency — 장면을 동시에 몇 개 렌더할지(파이썬 자식 프로세스 수). 0 = 자동(CPU 코어 - 2, 1~4).
 *     ⚠ 화이트보드 렌더는 **CPU 작업**이라 GPU 레인(TTS·로컬 ComfyUI)과 무관하다 — `whiteboard` 레인만 잡는다.
 *
 * `image-rotation.js` 와 같은 꼴(load 는 절대 던지지 않고 기본값으로 폴백, save 는 병합).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const STORE_DIR = path.join(os.homedir(), '.priming-maker');
const CONFIG_PATH = path.join(STORE_DIR, 'whiteboard-config.json');

const CAP_CHOICES = [1920, 1080, 640];

const DEFAULTS = {
  capLongEdge: 1920,
  concurrency: 0,          // 0 = 자동
};

function autoConcurrency() {
  let n = 2;
  try { n = (os.cpus() || []).length - 2; } catch (_) {}
  return Math.max(1, Math.min(4, n));
}

/** 값 정리 — 허용 안 되는 값은 (저장 시엔 기존 값, 로드 시엔 기본값)으로 되돌린다. */
function _norm(j, fallback = DEFAULTS) {
  const cap = parseInt(j && j.capLongEdge, 10);
  const con = parseInt(j && j.concurrency, 10);
  return {
    capLongEdge: CAP_CHOICES.includes(cap) ? cap : fallback.capLongEdge,
    concurrency: (Number.isFinite(con) && con >= 0 && con <= 8) ? con : fallback.concurrency,
  };
}

function load() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return _norm(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch (_) { /* 깨진 파일은 기본값 */ }
  return { ...DEFAULTS };
}

function save(patch) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    const cur = load();
    const next = _norm({ ...cur, ...(patch || {}) }, cur);   // 잘못된 값은 기존 값으로(기본값으로 튀지 않게)
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
    return next;
  } catch (_) { return load(); }
}

/** 실제로 쓸 동시 개수 — 0(자동)을 숫자로 푼다. */
function effectiveConcurrency(cfg) {
  const c = cfg && cfg.concurrency;
  return (c > 0) ? c : autoConcurrency();
}

module.exports = { CONFIG_PATH, DEFAULTS, CAP_CHOICES, load, save, autoConcurrency, effectiveConcurrency };
