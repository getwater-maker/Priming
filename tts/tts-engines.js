'use strict';

/**
 * tts-engines.js — 🔊 음성 엔진 고르기 (헤더 「🔊 음성 엔진」 팝업 · v0.6.67)
 *
 * 무엇을 하나:
 *   - 어느 TTS 엔진으로 문장을 읽을지 **한 곳**에서 정한다(헤더 공통 — 이미지·비디오 도구와 같은 「헤더 우선」).
 *   - OmniVoice = 지금까지처럼 **채널 설정**(참조음성·시드)을 그대로 쓴다.
 *   - 유료 API(Gemini · MAI-Voice · Typecast · ElevenLabs) = 이 팝업에서 고른 모델·목소리로 읽는다.
 *     채널의 참조음성·화자 목소리는 OmniVoice 전용이라 쓰지 않는다(로그로 알린다).
 *
 * 저장:
 *   - 설정(엔진·모델·목소리)  ~/.priming-maker/tts-engines.json
 *   - API 키                  tts/secret-store (gemini 키는 이미지·프롬프트와 **같은 키**를 쓴다)
 *   🔑 렌더러로 키 원문을 돌려주지 않는다(끝 4자리만).
 *
 * 🔑 엔진 해석은 `resolveEngine` · 합성 인자는 `synthExtra` **한 곳** — 파이프라인·로그·시험 재생이 같은 값을 탄다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CFG_PATH = path.join(os.homedir(), '.priming-maker', 'tts-engines.json');

// 엔진 목록 — 화면(팝업)과 main 이 같은 표를 쓴다.
//   keyId = secret-store 칸 · keyLabel = 키 입력칸 이름 · models = 고를 수 있는 모델(첫 항목 = 기본)
const ENGINES = [
  {
    id: 'omnivoice', label: 'OmniVoice', sub: '내 GPU 서버 · 무료 · 채널 참조음성 그대로', paid: false,
    note: '채널 편집(🎙 음성)의 참조음성·시드로 읽습니다. 서버 주소는 ⚙ 설정 → 🖧 TTS 서버.',
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
    note: '이미지(나노바나나)·프롬프트 작성과 같은 Gemini 키를 씁니다. 「말투」는 3.8 모델에만 적용됩니다.',
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
    // 공식 목록(learn.microsoft.com · 2026-09-30 판)에서 한국어·베트남어만 싣는다(일본어는 목록에 없음). 그 밖은 직접 입력.
    voices: [
      { id: 'ko-KR-Junho', name: '♂ 준호 (감정 표현)' },
      { id: 'ko-KR-Grant', name: '♂ Grant (낭독·교육)' },
      { id: 'ko-KR-Haena', name: '♀ 해나 (감정 표현)' },
      { id: 'ko-KR-Harper', name: '♀ Harper (낭독·교육)' },
      { id: 'vi-VN-Grant', name: '♂ Grant (베트남어)' },
      { id: 'vi-VN-Harper', name: '♀ Harper (베트남어)' },
    ],
    styles: ['', 'narrator', 'audiobook', 'educational', 'neutral', 'softvoice', 'happy', 'sad', 'excited', 'hopeful'],
    note: 'Azure 포털에서 Speech(Foundry) 리소스를 만들고 키·지역을 넣으세요. 목소리 이름은 「ko-KR-Junho」처럼 씁니다.',
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
    note: '「목소리 불러오기」로 내 계정에서 쓸 수 있는 목소리(tc_…)를 가져옵니다.',
  },
  {
    id: 'elevenlabs', label: 'ElevenLabs TTS', sub: 'elevenlabs.io API 키', paid: true,
    keyId: 'elevenlabs', keyLabel: 'API 키', keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    models: [
      { id: 'eleven_v3', name: 'Eleven v3 (최신 · 표현력)' },
      { id: 'eleven_multilingual_v2', name: 'Multilingual v2 (안정적)' },
      { id: 'eleven_flash_v2_5', name: 'Flash v2.5 (빠르고 쌈)' },
    ],
    listVoices: true,
    note: '「목소리 불러오기」로 내 보이스 라이브러리를 가져옵니다(복제한 내 목소리 포함). 채널 시드를 그대로 넘깁니다.',
  },
];
const ENGINE_IDS = ENGINES.map((e) => e.id);
const byId = (id) => ENGINES.find((e) => e.id === id) || null;

function load() {
  try { const j = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); if (j && typeof j === 'object') return j; } catch {}
  return { active: 'omnivoice' };
}
function save(cfg) {
  const clean = { active: ENGINE_IDS.includes(cfg && cfg.active) ? cfg.active : 'omnivoice' };
  for (const e of ENGINES) if (e.paid && cfg && cfg[e.id] && typeof cfg[e.id] === 'object') clean[e.id] = { ...cfg[e.id] };
  fs.mkdirSync(path.dirname(CFG_PATH), { recursive: true });
  fs.writeFileSync(CFG_PATH, JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}
function active(cfg) { const a = (cfg || load()).active; return ENGINE_IDS.includes(a) ? a : 'omnivoice'; }

/** 엔진별 설정값(빈 값은 기본값으로 채움) */
function engineCfg(id, cfg) {
  const e = byId(id); const c = ((cfg || load())[id]) || {};
  if (!e || !e.paid) return {};
  const out = { ...c };
  if (!out.model || !(e.models || []).some((m) => m.id === out.model)) out.model = e.models[0].id;
  if (!out.voice && e.defaultVoice) out.voice = e.defaultVoice;
  if (e.regions && !out.region) out.region = e.defaultRegion;
  return out;
}

/**
 * 실제로 쓸 엔진 id. 헤더에서 유료 엔진을 골랐으면 그것, OmniVoice 면 채널 엔진(옛 gemini 채널 포함) 그대로.
 * 🔑 makeTtsManager·fillTtsList·voiceLabel 이 모두 이 함수를 탄다.
 */
function resolveEngine(presetEngine, cfg) {
  const a = active(cfg);
  if (a !== 'omnivoice') return a;
  return presetEngine || 'omnivoice';
}

/**
 * 유료 엔진의 합성 인자 — synthesize(opts) 에 얹는다. OmniVoice 면 null(= 채널 설정 그대로).
 * `engineSig` 는 TTS 캐시 키에 들어간다(목소리·모델을 바꾸면 옛 음성이 되살아나지 않게).
 */
function synthExtra(id, cfg) {
  const e = byId(id);
  if (!e || !e.paid) return null;
  const c = engineCfg(id, cfg);
  const x = { model: c.model, voice: c.voice || '' };
  if (id === 'gemini' && c.style) x.style = String(c.style);
  if (id === 'mai') { x.region = c.region; if (c.style) x.style = c.style; }
  if (id === 'typecast') { x.emotion = c.emotion || 'normal'; }
  if (id === 'elevenlabs') {
    if (c.stability != null && c.stability !== '') x.stability = Number(c.stability);
    if (c.similarity != null && c.similarity !== '') x.similarity = Number(c.similarity);
  }
  x.engineSig = JSON.stringify({ id, ...x });
  return x;
}

/** 로그 한 줄 — 「어느 엔진·목소리로 읽었나」 */
function label(id, cfg) {
  const e = byId(id); if (!e) return String(id || '');
  if (!e.paid) return e.label;
  const c = engineCfg(id, cfg);
  return `${e.label} · ${c.model} · 목소리 ${c.voice || '⚠ 없음'}`;
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

module.exports = { ENGINES, ENGINE_IDS, CFG_PATH, byId, load, save, active, engineCfg, resolveEngine, synthExtra, label, keyInfo };
