'use strict';

/**
 * 타입캐스트(Typecast) TTS — POST https://api.typecast.ai/v1/text-to-speech  (헤더 X-API-KEY)
 *   본문: { voice_id:'tc_…', text, model:'ssfm-v30', language:'kor', prompt:{…}, output:{ audio_format:'wav' } }
 *   목소리 목록: GET https://api.typecast.ai/v2/voices?model=ssfm-v30
 *   근거: typecast.ai/docs/api-reference/text-to-speech (2026-10)
 * 키: secret-store 'typecast'.key
 */

const SecretStore = require('../secret-store');
const { wavResult, fetchWithTimeout, httpError } = require('./audio-util');

const PROVIDER_ID = 'typecast';
const LABEL = '타입캐스트';
const BASE = 'https://api.typecast.ai';
// 앱 언어(ISO 639-1) → 타입캐스트(ISO 639-3)
const LANG3 = { ko: 'kor', ja: 'jpn', vi: 'vie', en: 'eng', zh: 'zho', es: 'spa', fr: 'fra', de: 'deu' };

function buildBody(text, opts = {}) {
  const model = opts.model || 'ssfm-v30';
  const body = { voice_id: String(opts.voice || ''), text: String(text), model, output: { audio_format: 'wav' } };
  const L = LANG3[String(opts.language || 'ko').slice(0, 2)];
  if (L) body.language = L;
  const emo = opts.emotion || 'normal';
  body.prompt = model === 'ssfm-v30'
    ? { emotion_type: 'preset', emotion_preset: emo, emotion_intensity: 1 }
    : { emotion_preset: emo, emotion_intensity: 1 };
  return body;
}

class TypecastProvider {
  constructor() { this.id = PROVIDER_ID; this.label = '타입캐스트 TTS'; this.ready = false; this.key = ''; this.timeout = 90000; }
  async init() {
    const s = SecretStore.get(PROVIDER_ID);
    this.key = (s && s.key) || '';
    this.ready = !!this.key;
    return this.ready;
  }
  async synthesize(text, opts = {}) {
    if (!this.ready) throw new Error('타입캐스트 — API 키가 없습니다 (🔊 음성 엔진에서 넣으세요)');
    if (!opts.voice) throw new Error('타입캐스트 — 목소리(tc_…)를 고르지 않았습니다 (🔊 음성 엔진 → 목소리 불러오기)');
    const res = await fetchWithTimeout(`${BASE}/v1/text-to-speech`, {
      method: 'POST',
      headers: { 'X-API-KEY': this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(text, opts)),
    }, this.timeout, LABEL);
    if (!res.ok) throw await httpError(res, LABEL);
    return wavResult(Buffer.from(await res.arrayBuffer()), PROVIDER_ID, LABEL);
  }
  async stop() { this.ready = false; }
}

/** 목소리 목록 → [{id, name}] */
async function listVoices(key, model = 'ssfm-v30') {
  const res = await fetchWithTimeout(`${BASE}/v2/voices?model=${encodeURIComponent(model)}`, { headers: { 'X-API-KEY': key } }, 30000, LABEL);
  if (!res.ok) throw await httpError(res, LABEL);
  const j = await res.json();
  const arr = Array.isArray(j) ? j : (j.voices || j.result || j.data || []);
  const AGE = { child: '어린이', teenager: '10대', young_adult: '청년', middle_age: '중년', elder: '노년' };
  return arr.map((v) => {
    const nm = v.voice_name && typeof v.voice_name === 'object' ? (v.voice_name.kor || v.voice_name.eng) : v.voice_name;
    const uses = Array.isArray(v.use_cases) ? v.use_cases.slice(0, 3).join(' · ') : '';
    return { id: v.voice_id, name: nm || v.voice_id, gender: String(v.gender || '').toLowerCase(), lang: AGE[v.age] || v.age || '', desc: uses, preview: v.preview_url || '' };
  }).filter((v) => v.id);
}

module.exports = { TypecastProvider, buildBody, listVoices };
