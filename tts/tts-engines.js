'use strict';

/**
 * tts-engines.js — 🔊 음성 엔진 · 목소리 (헤더 「🔊 음성 엔진」 팝업 · v0.6.67~69)
 *
 * 🔑 v0.6.69 — **채널마다 엔진·목소리를 따로** 정한다(로이 2026-10-05: 채널마다 개성 있는 목소리).
 *   - 채널 설정(tts-presets.json)의 `voiceEngine` = { id, model, voice, style, emotion, stability, similarity }
 *     · id 가 없거나 'omnivoice' 면 지금까지처럼 채널의 참조음성(voiceCloneRefAudio)·시드로 읽는다.
 *     · ⚠ 채널의 `engine` 필드는 건드리지 않는다(preset-store 가 omnivoice/gemini 밖의 값을 지운다).
 *   - 전역(~/.priming-maker/tts-engines.json)에는 **계정 공통값만**: MAI 지역 · 환율.
 *   - API 키 = tts/secret-store (gemini 키는 이미지·프롬프트와 **같은 키**) · 렌더러엔 끝 4자리만.
 *   - 유료 엔진이면 채널의 참조음성·instruct·cfg·화자별 목소리는 쓰지 않는다(로그로 알린다).
 *
 * 🔑 엔진 해석 `resolveEngine(preset)` · 합성 인자 `synthExtra(id, preset)` · 요금 `estimateUsd` **한 곳**.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CFG_PATH = path.join(os.homedir(), '.priming-maker', 'tts-engines.json');

// 엔진 목록 — 화면(팝업)과 main 이 같은 표를 쓴다.
//   keyId = secret-store 칸 · keyLabel = 키 입력칸 이름 · models = 고를 수 있는 모델(첫 항목 = 기본)
const ENGINES = [
  {
    id: 'omnivoice', label: 'OmniVoice', sub: '내 GPU 서버 · 무료', paid: false,
    note: '서버 공용 목소리 하나를 고르면 이 채널의 참조음성이 됩니다(⚙ 채널편집 🎙 의 참조음성과 같은 값). 시드·화자 목소리는 채널편집에서. 서버 주소는 ⚙ 설정 → 🖧 TTS 서버.',
  },
  {
    id: 'gemini', label: 'Google Gemini TTS', sub: 'Google AI Studio API 키', paid: true,
    keyId: 'gemini', keyLabel: 'API 키', keyUrl: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-3.8-flash-tts', name: 'Gemini 3.8 Flash TTS (최신 · 고품질)' },
      { id: 'gemini-3.8-flash-lite-tts', name: 'Gemini 3.8 Flash-Lite TTS (빠르고 쌈)' },
      { id: 'gemini-3.1-flash-tts-preview', name: 'Gemini 3.1 Flash TTS (구판)' },
      { id: 'gemini-2.5-pro-preview-tts', name: 'Gemini 2.5 Pro TTS (구판)' },
    ],
    defaultVoice: 'Kore', hasStyle: true,
    listVoices: true,
    note: '기본 목소리 30개 + 「확장 라이브러리 불러오기」(수백 개 · 3.8 모델용). 이미지(나노바나나)·프롬프트 작성과 같은 Gemini 키를 씁니다. 「말투 지시」는 3.8 모델에만 적용됩니다.',
  },
  {
    id: 'mai', label: 'Microsoft MAI-Voice', sub: 'Azure Speech(Foundry) 키 + 지역', paid: true,
    keyId: 'mai', keyLabel: 'Speech 키', keyUrl: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesAIFoundry',
    models: [
      { id: 'MAI-Voice-2.1', name: 'MAI-Voice-2.1 (최신 · 장편 낭독용)' },
      { id: 'MAI-Voice-2.1-Flash', name: 'MAI-Voice-2.1-Flash (빠름)' },
    ],
    regions: ['eastasia', 'southeastasia', 'japaneast', 'eastus', 'eastus2', 'westus', 'westus2', 'westus3', 'canadacentral', 'francecentral', 'westeurope', 'northeurope', 'swedencentral', 'centralindia'],
    defaultRegion: 'eastasia', defaultVoice: 'ko-KR-Junho',
    // 목소리 97개 = voice-catalogs.MAI(공식 표 전체 · 말투는 목소리마다 다르다)
    note: 'Azure 포털에서 Speech(Foundry) 리소스를 만들고 키·지역을 넣으세요(지역은 모든 채널 공통).',
  },
  {
    id: 'typecast', label: '타입캐스트 TTS', sub: 'typecast.ai API 키', paid: true,
    keyId: 'typecast', keyLabel: 'API 키', keyUrl: 'https://typecast.ai/developers/api',
    models: [
      { id: 'ssfm-v30', name: 'ssfm-v30 (최신)' },
      { id: 'ssfm-v21', name: 'ssfm-v21 (구판)' },
    ],
    emotions: ['normal', 'happy', 'sad', 'angry', 'whisper', 'toneup', 'tonedown'],
    listVoices: true,
    note: '내 계정에서 쓸 수 있는 목소리(tc_…) 전체를 API 로 불러옵니다(처음 열 때 자동 · 「↻ 다시 불러오기」).',
  },
  {
    id: 'elevenlabs', label: 'ElevenLabs TTS', sub: 'elevenlabs.io API 키', paid: true,
    keyId: 'elevenlabs', keyLabel: 'API 키', keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    models: [
      { id: 'eleven_v4', name: 'Eleven v4 (최신 · 가장 풍부한 감정)' },
      { id: 'eleven_v4_turbo', name: 'Eleven v4 Turbo (빠름)' },
      { id: 'eleven_v3', name: 'Eleven v3' },
      { id: 'eleven_multilingual_v2', name: 'Multilingual v2 (안정적)' },
      { id: 'eleven_flash_v2_5', name: 'Flash v2.5 (빠르고 쌈)' },
    ],
    listVoices: true,
    note: '내 보이스 라이브러리 전체(기본 목소리 + 복제한 내 목소리)를 API 로 불러옵니다. 채널 시드를 그대로 넘깁니다.',
  },
];
const ENGINE_IDS = ENGINES.map((e) => e.id);
const byId = (id) => ENGINES.find((e) => e.id === id) || null;

// ── 💲 요금 (USD · 공식 요금표 2026-10-05 확인 — 바뀌면 여기 한 곳만) ─────────────────────────
//   kind 'char' = 글자당 · 'sec' = 음성 1초당(Gemini: 음성 토큰 25개/초 × 1백만 토큰당 단가 · 입력 글자 값은 미미해 뺀다)
//   근거: ai.google.dev/gemini-api/docs/pricing · MAI(1백만 글자 $22 / Flash $15 · 2026년 말까지 도입가)
//         typecast.ai/developers/api(1글자 = 1크레딧 · Lite $0.075/1천 크레딧) · elevenlabs.io/pricing/api(1천 글자당)
const PRICING = {
  'gemini-3.8-flash-tts': { kind: 'sec', usd: 25 * 9 / 1e6, free: '무료 등급 있음(호출 수 제한)', note: '2026년 말까지 · 2027-01부터 2배' },
  'gemini-3.8-flash-lite-tts': { kind: 'sec', usd: 25 * 6 / 1e6, free: '무료 등급 있음(호출 수 제한)', note: '2026년 말까지 · 2027-01부터 2배' },
  'gemini-3.1-flash-tts-preview': { kind: 'sec', usd: 25 * 20 / 1e6, free: '무료 등급 있음(호출 수 제한)' },
  'gemini-2.5-pro-preview-tts': { kind: 'sec', usd: 25 * 20 / 1e6, free: '무료 등급 없음' },
  'MAI-Voice-2.1': { kind: 'char', usd: 22 / 1e6, note: '도입가(2026년 말까지)' },
  'MAI-Voice-2.1-Flash': { kind: 'char', usd: 15 / 1e6, note: '도입가(2026년 말까지)' },
  'ssfm-v30': { kind: 'char', usd: 0.075 / 1e3, free: '무료 월 1만5천 자(⚠ 상업 이용 불가)', note: 'Lite 요금제 기준 · 초과분 1천 자 $0.09' },
  'ssfm-v21': { kind: 'char', usd: 0.075 / 1e3, free: '무료 월 1만5천 자(⚠ 상업 이용 불가)', note: 'Lite 요금제 기준' },
  'eleven_v4': { kind: 'char', usd: 0.08 / 1e3, note: '종량제 · 10/12까지 할인가 1천 자 $0.022' },
  'eleven_v4_turbo': { kind: 'char', usd: 0.04 / 1e3, note: '종량제(Turbo 단가)' },
  'eleven_v3': { kind: 'char', usd: 0.08 / 1e3, note: '종량제' },
  'eleven_multilingual_v2': { kind: 'char', usd: 0.08 / 1e3, note: '종량제' },
  'eleven_flash_v2_5': { kind: 'char', usd: 0.04 / 1e3, note: '종량제' },
};
const KO_CHARS_PER_SEC = 7;   // 한국어 낭독 ≈ 초당 7글자(정속) — 초 단위 요금 추정용(실측 길이가 있으면 그걸 쓴다)
const DEFAULT_KRW = 1400;     // 1달러 = 원 — 환율을 못 받았을 때만 쓰는 값(평소엔 main 이 공개 환율을 받는다)
const DEFAULT_CARD_FEE = 1.3; // 💳 카드 해외결제 수수료 기본값(%) — 대략값 · 팝업에서 카드에 맞게 고친다

/** 글자 수(·초) → 예상 USD. 모르는 모델은 null. OmniVoice = 0 */
function estimateUsd(engineId, model, chars, sec) {
  if (engineId === 'omnivoice') return 0;
  const p = PRICING[model]; if (!p) return null;
  const n = Math.max(0, Number(chars) || 0);
  if (p.kind === 'char') return n * p.usd;
  const s = Number(sec) > 0 ? Number(sec) : n / KO_CHARS_PER_SEC;
  return s * p.usd;
}
/** 요금 한 줄(사람 말) */
function priceLine(engineId, model) {
  if (engineId === 'omnivoice') return '무료 (내 GPU 서버 · 전기료만)';
  const p = PRICING[model]; if (!p) return '요금 정보 없음';
  const per = p.kind === 'char'
    ? `1만 자당 약 $${(p.usd * 1e4).toFixed(2)}`
    : `음성 1분당 약 $${(p.usd * 60).toFixed(3)} (한국어 1만 자 ≈ $${(p.usd * 1e4 / KO_CHARS_PER_SEC).toFixed(2)})`;
  return [per, p.free, p.note].filter(Boolean).join(' · ');
}

function load() {
  try { const j = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); if (j && typeof j === 'object') return j; } catch {}
  return {};
}
/** 전역 = 계정 공통값만(MAI 지역 · 환율). 채널 목소리는 preset-store 에 */
function save(cfg) {
  const prev = load();
  const c = cfg || {};
  const clean = {
    mai: { region: String((c.mai && c.mai.region) || (prev.mai && prev.mai.region) || 'eastasia') },
    krw: Number(c.krw) > 0 ? Number(c.krw) : (Number(prev.krw) || DEFAULT_KRW),
    // 💳 카드 해외결제 수수료(%) — 시장 환율에 더해 카드 청구 예상액을 낸다(브랜드 약 1~1.1% + 카드사 약 0.2% · 카드마다 다름)
    cardFee: (c.cardFee != null && c.cardFee !== '' && Number(c.cardFee) >= 0 && Number(c.cardFee) < 10) ? Number(c.cardFee) : (prev.cardFee != null ? Number(prev.cardFee) : DEFAULT_CARD_FEE),
  };
  fs.mkdirSync(path.dirname(CFG_PATH), { recursive: true });
  fs.writeFileSync(CFG_PATH, JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}
const region = (cfg) => String((((cfg || load()).mai) || {}).region || 'eastasia');
const krw = (cfg) => Number((cfg || load()).krw) || DEFAULT_KRW;
const cardFee = (cfg) => { const v = (cfg || load()).cardFee; return v != null && isFinite(Number(v)) ? Number(v) : DEFAULT_CARD_FEE; };

/** 채널의 목소리 설정(빈 값은 기본값) — { id, model, voice, … } */
function channelVoice(preset) {
  const ve = (preset && preset.voiceEngine && typeof preset.voiceEngine === 'object') ? preset.voiceEngine : {};
  const id = ENGINE_IDS.includes(ve.id) ? ve.id : 'omnivoice';
  const e = byId(id);
  const out = { ...ve, id };
  if (e.paid) {
    if (!out.model || !(e.models || []).some((m) => m.id === out.model)) out.model = e.models[0].id;
    if (!out.voice && e.defaultVoice) out.voice = e.defaultVoice;
  }
  return out;
}

/**
 * 실제로 쓸 엔진 id — 채널(preset)의 voiceEngine 이 유료면 그것, 아니면 채널 engine(옛 gemini 채널 포함).
 * 문자열(엔진 id)을 받으면 그대로(리모션 등 엔진을 직접 정한 곳).
 * 🔑 makeTtsManager·fillTtsList·voiceLabel 이 모두 이 함수를 탄다.
 */
function resolveEngine(presetOrId) {
  if (presetOrId == null) return 'omnivoice';
  if (typeof presetOrId === 'string') return presetOrId || 'omnivoice';
  const cv = channelVoice(presetOrId);
  if (cv.id !== 'omnivoice') return cv.id;
  return presetOrId.engine || 'omnivoice';
}

/**
 * 유료 엔진의 합성 인자 — synthesize(opts) 에 얹는다. OmniVoice(·옛 gemini 채널)면 null(= 채널 설정 그대로).
 * `engineSig` 는 TTS 캐시 키에 들어간다(목소리·모델을 바꾸면 옛 음성이 되살아나지 않게).
 */
function synthExtra(id, preset, cfg) {
  const e = byId(id);
  if (!e || !e.paid) return null;
  const cv = channelVoice(preset);
  if (cv.id !== id) return null;
  const x = { model: cv.model, voice: cv.voice || '' };
  if (id === 'gemini' && cv.style) x.style = String(cv.style);
  if (id === 'mai') {
    x.region = region(cfg);
    // 말투는 목소리마다 다르다 — 고른 목소리가 못 하는 말투는 보내지 않는다(400 대신 기본 말투)
    const v = require('./voice-catalogs').MAI.find((m) => m.id === cv.voice);
    if (cv.style && (!v || v.styles.includes(cv.style))) x.style = cv.style;
  }
  if (id === 'typecast') { x.emotion = cv.emotion || 'normal'; }
  if (id === 'elevenlabs') {
    if (cv.stability != null && cv.stability !== '') x.stability = Number(cv.stability);
    if (cv.similarity != null && cv.similarity !== '') x.similarity = Number(cv.similarity);
  }
  x.engineSig = JSON.stringify({ id, ...x });
  return x;
}

/** 로그 한 줄 — 「어느 엔진·목소리로 읽었나」 */
function label(id, preset) {
  const e = byId(id); if (!e) return String(id || '');
  if (!e.paid) return e.label;
  const cv = channelVoice(preset);
  return `${e.label} · ${cv.model} · 목소리 ${cv.voice || '⚠ 없음'}`;
}

/** 키 보유 여부(원문은 내보내지 않는다) */
function keyInfo(SecretStore) {
  const out = {};
  for (const e of ENGINES) {
    if (!e.keyId) continue;
    let s = null; try { s = SecretStore.get(e.keyId); } catch {}
    const k = String((s && s.key) || '');
    out[e.id] = { has: !!k, tail: k ? k.slice(-4) : '' };
  }
  return out;
}

module.exports = { ENGINES, ENGINE_IDS, CFG_PATH, PRICING, KO_CHARS_PER_SEC, DEFAULT_KRW, DEFAULT_CARD_FEE, byId, load, save, region, krw, cardFee, channelVoice, resolveEngine, synthExtra, label, keyInfo, estimateUsd, priceLine };
