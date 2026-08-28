'use strict';

/**
 * image-rotation.js — 이미지 생성 "순환(rotation)" 설정 (~/.priming-maker/image-rotation.json)
 *
 * 한 엔진이 한도(Genspark 5시간/일일캡, Flow 계정 한도)에 걸리면 남은 이미지를 다음 엔진이 이어받고,
 * 한도 재설정 시각이 지나면 **같은 대본 도중이라도** 원래 엔진으로 되돌아간다(main.js runRotatingImages 의 라운드 반복).
 *   - 순환 풀: order 순서대로 시도, enabled=false 인 엔진은 제외.
 *   - ComfyUI 는 순환에서 제외(한국사 부적합) — 별도 단독 선택용. 추후 엔진 추가 시 order/enabled 에 넣으면 합류.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const STORE_DIR = path.join(os.homedir(), '.priming-maker');
const CONFIG_PATH = path.join(STORE_DIR, 'image-rotation.json');

const DEFAULTS = {
  order: ['genspark', 'flow'],           // 순환(브라우저 · 각 서비스 구독제)만. 나노바나나(API 사용량 과금)는 순환과 별개 — 시작화면에서 선택.
  enabled: { genspark: true, flow: true },
  // Flow 이미지 생성 모델 — flow-engine.js run()이 opts.model 로 그대로 받아 드롭다운 선택(_selectModel).
  //   'Nano Banana 2 Lite'(2026-06-30 출시, gemini-3.1-flash-lite-image) 추가 — 더 빠르고 저렴한 경량 모델.
  //   ⚠ Flow 웹 UI 드롭다운에 이 라벨이 실제로 존재하는지 실측 필요 — 없으면 _selectModel 이 조용히
  //   무시하고 기존 기본 모델로 진행(안전, 에러 없음).
  flowImageModel: 'Nano Banana 2',
  // Flow 비디오(i2v) 모델 — 'Veo 3.1 - Lite'(기본·가장 쌈) / 'Veo 3.1 - Fast' / 'Veo 3.1 - Quality'.
  //   2026-08-28 Flow UI 실측 라벨 그대로다(글자가 다르면 _selectModel 이 못 찾아 기본 모델로 진행).
  //   ⚠ Veo 는 생성당 크레딧을 쓴다(Lite x1 = 10크레딧) — 화질을 올리면 크레딧도 오른다.
  flowVideoModel: 'Veo 3.1 - Lite',
};

function load() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const j = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      // 순환은 genspark/flow 만. gemini(유료 API)는 순환에서 제외 → 저장된 order 에 있으면 제거.
      let order = (j.order && j.order.length) ? j.order.filter((e) => e === 'genspark' || e === 'flow') : [...DEFAULTS.order];
      for (const e of DEFAULTS.order) if (!order.includes(e)) order.push(e);
      return {
        order,
        enabled: { ...DEFAULTS.enabled, ...(j.enabled || {}) },
        flowImageModel: j.flowImageModel || DEFAULTS.flowImageModel,
        flowVideoModel: j.flowVideoModel || DEFAULTS.flowVideoModel,
      };
    }
  } catch (e) { /* ignore */ }
  return { order: [...DEFAULTS.order], enabled: { ...DEFAULTS.enabled }, flowImageModel: DEFAULTS.flowImageModel, flowVideoModel: DEFAULTS.flowVideoModel };
}

function save(patch) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    const next = { ...load(), ...(patch || {}) };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
    return next;
  } catch (e) { return load(); }
}

// 활성(enabled) 엔진을 order 순서로. startEngine 이 주어지면 그 엔진을 맨 앞으로(사용자 선택 우선).
function activeOrder(startEngine) {
  const c = load();
  let list = (c.order || []).filter((e) => c.enabled && c.enabled[e] !== false);
  if (startEngine && list.includes(startEngine)) list = [startEngine, ...list.filter((e) => e !== startEngine)];
  else if (startEngine && (startEngine === 'genspark' || startEngine === 'flow')) list = [startEngine, ...list.filter((e) => e !== startEngine)];
  return list;
}

module.exports = { load, save, activeOrder, CONFIG_PATH, DEFAULTS };
