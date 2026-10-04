'use strict';

/**
 * ElevenLabs TTS — POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=pcm_24000  (헤더 xi-api-key)
 *   본문: { text, model_id, language_code?, seed?, voice_settings? }
 *   목소리 목록: GET https://api.elevenlabs.io/v2/voices
 *   🔑 pcm_24000(헤더 없는 PCM)으로 받아 WAV 로 감싼다 — wav_* 출력은 요금제에 따라 막힌다.
 *   근거: elevenlabs.io/docs/api-reference/text-to-speech/convert (2026-10)
 * 키: secret-store 'elevenlabs'.key
 */

const SecretStore = require('../secret-store');
const { pcmToWav, isWav, wavResult, fetchWithTimeout, httpError } = require('./audio-util');

const PROVIDER_ID = 'elevenlabs';
const LABEL = 'ElevenLabs';
const BASE = 'https://api.elevenlabs.io';
// language_code 를 받는 모델만(다른 모델에 보내면 400)
const LANG_CODE_MODELS = /^(eleven_v4|eleven_v4_turbo|eleven_v3|eleven_flash_v2_5|eleven_turbo_v2_5)$/;

function buildBody(text, opts = {}) {
  const model = opts.model || 'eleven_v4';
  const body = { text: String(text), model_id: model };
  if (LANG_CODE_MODELS.test(model) && opts.language) body.language_code = String(opts.language).slice(0, 2);
  const sd = Number(opts.seed);
  if (opts.seed != null && opts.seed !== '' && isFinite(sd) && sd >= 0) body.seed = Math.floor(sd) % 4294967296;
  const vs = {};
  if (isFinite(opts.stability)) vs.stability = Math.max(0, Math.min(1, opts.stability));
  if (isFinite(opts.similarity)) vs.similarity_boost = Math.max(0, Math.min(1, opts.similarity));
  if (Object.keys(vs).length) body.voice_settings = vs;
  return body;
}

class ElevenLabsProvider {
  constructor() { this.id = PROVIDER_ID; this.label = 'ElevenLabs TTS'; this.ready = false; this.key = ''; this.timeout = 90000; }
  async init() {
    const s = SecretStore.get(PROVIDER_ID);
    this.key = (s && s.key) || '';
    this.ready = !!this.key;
    return this.ready;
  }
  async synthesize(text, opts = {}) {
    if (!this.ready) throw new Error('ElevenLabs — API 키가 없습니다 (🔊 음성 엔진에서 넣으세요)');
    if (!opts.voice) throw new Error('ElevenLabs — 목소리를 고르지 않았습니다 (🔊 음성 엔진 → 목소리 불러오기)');
    const res = await fetchWithTimeout(`${BASE}/v1/text-to-speech/${encodeURIComponent(opts.voice)}?output_format=pcm_24000`, {
      method: 'POST',
      headers: { 'xi-api-key': this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(text, opts)),
    }, this.timeout, LABEL);
    if (!res.ok) throw await httpError(res, LABEL);
    const buf = Buffer.from(await res.arrayBuffer());
    return wavResult(isWav(buf) ? buf : pcmToWav(buf, 24000), PROVIDER_ID, LABEL);
  }
  async stop() { this.ready = false; }
}

/** 목소리 목록 → [{id, name, gender, lang, desc, preview}] — 내 라이브러리 전체(페이지 넘김) */
async function listVoices(key) {
  const out = []; let tok = '';
  for (let page = 0; page < 30; page++) {
    const res = await fetchWithTimeout(`${BASE}/v2/voices?page_size=100${tok ? '&next_page_token=' + encodeURIComponent(tok) : ''}`, { headers: { 'xi-api-key': key } }, 30000, LABEL);
    if (!res.ok) throw await httpError(res, LABEL);
    const j = await res.json();
    for (const v of j.voices || []) {
      if (!v.voice_id) continue;
      const L = v.labels || {};
      const cat = v.category === 'cloned' ? '내 복제' : v.category === 'generated' ? '내가 만든' : v.category === 'professional' ? '전문 복제' : '';
      out.push({ id: v.voice_id, name: v.name, gender: String(L.gender || '').toLowerCase(), lang: [L.language, L.accent].filter(Boolean).join(' · '), desc: [L.age, L.description || L.descriptive, L.use_case].filter(Boolean).join(' · '), badge: cat, preview: v.preview_url || '', image: (v.sharing && v.sharing.image_url) || '' });   // 🇰🇷 설명은 영어만(번역 대상) · 한글 표시는 badge 로
    }
    if (!j.has_more || !j.next_page_token) break;
    tok = j.next_page_token;
  }
  return out;
}

/**
 * 📚 보이스 라이브러리(남이 공유한 목소리) — GET /v1/shared-voices?language=ko (page_size 최대 100 · page 0~)
 *   기본 목소리(내 목록)는 영어 원어민이 대부분이라 한국어 원어민 목소리는 여기서 찾는다.
 *   카드 = { id, ownerId, name, gender, lang, desc, preview } — 쓰려면 먼저 내 목록에 추가(addShared).
 */
async function listShared(key, { language = 'ko', pages = 5, gender = '' } = {}) {
  const out = [];
  for (let page = 0; page < pages; page++) {
    const q = new URLSearchParams({ page_size: '100', page: String(page), language });
    if (gender) q.set('gender', gender);
    const res = await fetchWithTimeout(`${BASE}/v1/shared-voices?${q}`, { headers: { 'xi-api-key': key } }, 30000, LABEL);
    if (!res.ok) throw await httpError(res, LABEL + ' 보이스 라이브러리');
    const j = await res.json();
    for (const v of j.voices || []) {
      if (!v.voice_id || !v.public_owner_id) continue;
      out.push({
        id: v.voice_id, ownerId: v.public_owner_id, name: v.name, gender: String(v.gender || '').toLowerCase(),
        lang: [v.language, v.accent].filter(Boolean).join(' · '),
        desc: [v.description ? String(v.description).slice(0, 80) : '', v.age, v.descriptive, v.use_case].filter(Boolean).join(' · '),
        badge: v.cloned_by_count ? `복제 ${v.cloned_by_count}회` : '',   // 🇰🇷 설명(영어 · 번역 대상)과 따로
        preview: v.preview_url || '', image: v.image_url || '', shared: true,
      });
    }
    if (!j.has_more) break;
  }
  return out;
}
/** 라이브러리 목소리를 내 목록에 추가 — POST /v1/voices/add/{public_user_id}/{voice_id} → 새 voice_id */
async function addShared(key, ownerId, voiceId, name) {
  const res = await fetchWithTimeout(`${BASE}/v1/voices/add/${encodeURIComponent(ownerId)}/${encodeURIComponent(voiceId)}`, {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_name: String(name || voiceId).slice(0, 80) }),
  }, 30000, LABEL);
  if (!res.ok) {
    const err = await httpError(res, LABEL + ' 목소리 추가');
    if (res.status === 401 || res.status === 403) err.message += ' — API 키 권한에 「Voices – Write(쓰기)」가 필요합니다';
    throw err;
  }
  const j = await res.json();
  return j.voice_id;
}

module.exports = { ElevenLabsProvider, buildBody, listVoices, listShared, addShared };
