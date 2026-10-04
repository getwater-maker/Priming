'use strict';

/**
 * Microsoft MAI-Voice (MAI-Voice-2.1 · 2.1-Flash) — Azure Speech REST(SSML).
 *   POST https://<region>.tts.speech.microsoft.com/cognitiveservices/v1
 *   목소리 = `<voice name="ko-KR-Junho:MAI-Voice-2.1">` (목소리 id + ':' + 모델)
 *   근거: learn.microsoft.com/azure/ai-services/speech-service/mai-voices (2026-09-30 판)
 * 키: secret-store 'mai'.key · 지역은 tts-engines 설정.
 */

const SecretStore = require('../secret-store');
const { wavResult, fetchWithTimeout, httpError } = require('./audio-util');

const PROVIDER_ID = 'mai';
const LABEL = 'MAI-Voice';

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** 목소리 id 앞부분(ko-KR) = xml:lang */
function localeOf(voice) { const m = /^([a-z]{2,3}-[A-Z]{2})-/.exec(String(voice || '')); return m ? m[1] : 'ko-KR'; }

function buildSsml(text, { voice, model, style }) {
  const loc = localeOf(voice);
  const body = style
    ? `<mstts:express-as style="${xmlEsc(style)}">${xmlEsc(text)}</mstts:express-as>`
    : xmlEsc(text);
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${loc}">`
    + `<voice name="${xmlEsc(voice)}:${xmlEsc(model)}">${body}</voice></speak>`;
}

class MaiProvider {
  constructor() { this.id = PROVIDER_ID; this.label = 'Microsoft MAI-Voice'; this.ready = false; this.key = ''; this.timeout = 60000; }
  async init() {
    const s = SecretStore.get(PROVIDER_ID);
    this.key = (s && s.key) || '';
    this.ready = !!this.key;
    return this.ready;
  }
  async synthesize(text, opts = {}) {
    if (!this.ready) throw new Error('MAI-Voice — Speech 키가 없습니다 (🔊 음성 엔진에서 넣으세요)');
    const region = String(opts.region || 'eastasia').trim();
    const voice = String(opts.voice || 'ko-KR-Junho').trim();
    const model = String(opts.model || 'MAI-Voice-2.1').trim();
    const res = await fetchWithTimeout(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',   // WAV 로 받는다(파이프라인 전제)
        'User-Agent': 'Priming',
      },
      body: buildSsml(text, { voice, model, style: opts.style }),
    }, this.timeout, LABEL);
    if (!res.ok) throw await httpError(res, LABEL);
    return wavResult(Buffer.from(await res.arrayBuffer()), PROVIDER_ID, LABEL);
  }
  async stop() { this.ready = false; }
}

module.exports = { MaiProvider, buildSsml, localeOf };
