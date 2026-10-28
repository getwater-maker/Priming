/**
 * Gemini TTS — 🧩 v1.0.4 부터 **생성 서비스(kie.ai) 키 + 크레딧**으로 읽는다(로이 2026-10-29 · Google 키는 더 쓰지 않는다).
 * 모델은 Gemini 3.8 Flash · 3.8 Flash-Lite 둘뿐. 요청·결과 받기는 core/kie-api.speechToBuffer 한 곳.
 *
 * 인증: secret-store 'kie' 의 키(⚙ 설정 → 🔑 API 키) · 비용: 만들 때마다 크레딧 차감(실패한 작업은 차감 없음)
 * 출력: WAV 24kHz 16bit mono (호출자는 확장자만 wav 로)
 *
 * ⛔ provider id 는 'gemini' 를 유지한다 — 채널 voiceEngine·TTS 캐시 키(engineSig)가 이 id 를 가리킨다.
 */

const SecretStore = require('../secret-store');
const Usage = require('../gemini-usage-store');

const PROVIDER_ID = 'gemini';
const KEY_ID = 'kie';

// 화면 모델 id → kie 모델 문자열(이 표에 없는 옛 모델 id 는 기본(Flash)으로)
const KIE_MODELS = {
  'gemini-3.8-flash-tts': 'google/gemini-3-8-flash-tts',
  'gemini-3.8-flash-lite-tts': 'google/gemini-3-8-flash-lite-tts',
};
const DEFAULT_MODEL = 'gemini-3.8-flash-tts';

class GeminiProvider {
  constructor(opts = {}) {
    this.id = PROVIDER_ID;
    this.label = 'Gemini TTS';
    this.ready = false;
    this.voice = opts.voice || 'Kore';
    this.model = KIE_MODELS[opts.model] ? opts.model : DEFAULT_MODEL;
  }

  _hasKey() {
    try { return !!String((SecretStore.get(KEY_ID) || {}).key || '').trim(); } catch { return false; }
  }

  async init() {
    this.ready = this._hasKey();
    return this.ready;
  }

  /**
   * @param {string} text
   * @param {object} opts - { voice, model, style }
   * @returns {Promise<{ mp3Buffer: Buffer, durationSec: number, providerUsed: 'gemini', format: 'wav' }>}
   */
  async synthesize(text, opts = {}) {
    // ⚙ 설정에서 키를 넣거나 바꿨으면 앱을 다시 켜지 않아도 바로 쓴다(키는 매번 secret-store 에서 읽는다).
    if (!this._hasKey()) throw new Error('Gemini TTS — 생성 서비스 키가 없습니다(⚙ 설정 → 🔑 API 키)');
    const KA = require('../../core/kie-api');
    const voice = opts.voice || this.voice;
    const modelId = KIE_MODELS[opts.model] ? opts.model : DEFAULT_MODEL;
    const r = await KA.speechToBuffer({ model: KIE_MODELS[modelId], voice, style: opts.style, text });
    if (!r.ok) {
      Usage.bump(/429|속도 제한/.test(String(r.error)) ? 'tts_429' : 'tts_fail');
      const err = new Error(`Gemini TTS 실패: ${r.error}`);
      if (r.fatal) err.fatal = r.fatal;
      throw err;
    }
    Usage.bump('tts_ok');
    const { isWav, wavResult, pcmToWav } = require('./audio-util');
    const wav = isWav(r.buffer) ? r.buffer : pcmToWav(r.buffer, 24000);
    // 🔑 빈 음성은 던진다(바닥값으로 정상 음성인 척하지 않는다 — OmniVoice 사고).
    return wavResult(wav, 'gemini', 'Gemini');
  }

  async stop() {
    this.ready = false;
  }

  static getVoices() {
    return require('../voice-catalogs').GEMINI.map((v) => ({ ...v }));
  }
}

module.exports = { GeminiProvider, KIE_MODELS };
