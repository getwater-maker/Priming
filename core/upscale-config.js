'use strict';

/**
 * upscale-config.js — 영상 업스케일 동작 설정 (~/.priming-maker/upscale-config.json)
 *
 * 🔴 배경(2026-08-26, 아내 PC 실사고): Grok 영상은 1280x704 라 업스케일이 필요한데, 그 PC 엔
 *   **NVIDIA GPU 가 없다**(로그: `🌡 GPU 온도 기록 불가(nvidia-smi 응답 없음)`).
 *   Real-ESRGAN(ncnn-vulkan)은 15초 영상 = 361프레임을 한 장씩 AI 확대하므로, 내장 그래픽에서는
 *   수십 분이 걸린다. "장시간 업스케일 중" 의 정체가 이것이었다.
 *   ⚠ 내 PC 는 ☁ LTX2.5 가 1920x1088 로 뽑아 **업스케일 자체가 생략**된다 — 그래서 증상이 안 보였다.
 *
 * mode:
 *   'auto' (기본) — AI(Real-ESRGAN)로 하되, **한 영상이 slowLimitSec 를 넘으면** 그 뒤로는
 *                   ffmpeg 고속 업스케일로 자동 전환한다(그 실행 동안만). 느린 PC 가 스스로 빠져나온다.
 *   'ai'          — 항상 Real-ESRGAN (화질 우선)
 *   'fast'        — 항상 ffmpeg lanczos+unsharp (몇 초, 화질은 낮음)
 *   'off'         — 업스케일하지 않음 (원본 해상도 그대로 .vrew 에 들어간다)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.homedir(), '.priming-maker');
const CFG_PATH = path.join(DIR, 'upscale-config.json');
const MODES = ['auto', 'ai', 'fast', 'off'];
const DEFAULTS = { mode: 'auto', slowLimitSec: 300 };

function load() {
  let j = {};
  try { if (fs.existsSync(CFG_PATH)) j = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) || {}; } catch (_) { j = {}; }
  const mode = MODES.includes(j.mode) ? j.mode : DEFAULTS.mode;
  let slow = parseInt(j.slowLimitSec, 10);
  if (!Number.isFinite(slow) || slow < 30) slow = DEFAULTS.slowLimitSec;
  return { mode, slowLimitSec: slow };
}

function save(patch) {
  const next = { ...load(), ...(patch || {}) };
  if (!MODES.includes(next.mode)) next.mode = DEFAULTS.mode;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(CFG_PATH, JSON.stringify(next, null, 2), 'utf8');
  } catch (_) { /* 설정 저장 실패가 작업을 막지 않는다 */ }
  return load();
}

module.exports = { load, save, MODES, DEFAULTS, CFG_PATH };
