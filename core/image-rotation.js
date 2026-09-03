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
  // 🎬 Genspark 비디오 — 로이 요청(2026-09-03): "성능과 비용을 아직 몰라서 설정에서 고르고 싶다".
  //   기본은 로이 지정 'Gemini Omni Flash'(3~10초·720p). 모델마다 길이·해상도가 달라
  //   엔진이 페이지에서 범위를 읽어 맞춘다(genspark-engine 의 GENSPARK_VIDEO_MODELS 참조).
  // ⚠ 기본값을 MiniMax H3 Max 로 둔다 — 로이가 처음 지정한 Gemini Omni Flash 는 **참조 이미지를
  //   받지 않아** 화풍이 통째로 바뀐다(2026-09-03 실측: 웹툰 일러스트 → 실사).
  gensparkVideoModel: 'MiniMax H3 Max',
  gensparkVideoTier: 'Standard',
  // 소스 이미지를 붙이는 방식 (2026-08-28 Flow UI 실측 — 설정 팝업의 서브탭이 곧 방식이다):
  //   'frame' = [시작]⇄[종료] 프레임 지정 → **첫 프레임이 그 이미지로 고정**되는 엄격한 i2v (기본).
  //   'asset' = 프롬프트 바 [+] 로 붙이는 **참조 이미지** → Veo 가 참고만 하므로 구도·인물이 달라질 수 있다.
  //   🔑 대본 그림을 그대로 움직이게 하려면 frame, 캐릭터·분위기만 참고시키려면 asset.
  flowVideoAttach: 'frame',
  // 완성된 동영상을 어느 해상도로 **다운로드** 할지 (2026-08-28 실측 — Flow 카드 메뉴의 다운로드 항목):
  //   '1080p' = 업스케일본(기본) · '720p' = 원본 크기 · 'off' = 다운로드 메뉴를 쓰지 않고 재생 소스 사용.
  //   🔑 재생 소스(video src)는 **720p 원본**이다. 1080p 로 받으면 우리 쪽 로컬 GPU 업스케일
  //     (Real-ESRGAN · 장당 수 분)이 통째로 생략된다 — maybeUpscale 이 해상도를 보고 스스로 건너뛴다.
  flowVideoDownload: '1080p',
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
        flowVideoAttach: (j.flowVideoAttach === 'asset') ? 'asset' : DEFAULTS.flowVideoAttach,
        flowVideoDownload: ['1080p', '720p', 'off'].includes(j.flowVideoDownload) ? j.flowVideoDownload : DEFAULTS.flowVideoDownload,
        gensparkVideoModel: j.gensparkVideoModel || DEFAULTS.gensparkVideoModel,
        gensparkVideoTier: (j.gensparkVideoTier === 'Ultra') ? 'Ultra' : DEFAULTS.gensparkVideoTier,
      };
    }
  } catch (e) { /* ignore */ }
  return { order: [...DEFAULTS.order], enabled: { ...DEFAULTS.enabled }, flowImageModel: DEFAULTS.flowImageModel, flowVideoModel: DEFAULTS.flowVideoModel, flowVideoAttach: DEFAULTS.flowVideoAttach, flowVideoDownload: DEFAULTS.flowVideoDownload, gensparkVideoModel: DEFAULTS.gensparkVideoModel, gensparkVideoTier: DEFAULTS.gensparkVideoTier };
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
