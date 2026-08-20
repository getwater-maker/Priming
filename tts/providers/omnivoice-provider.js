/**
 * OmniVoice Provider (원격 GPU 서버 — LAN/Tailscale)
 * 백엔드: tts/omnivoice-backend/api.py  포트 9881
 *
 * 참조음성 흐름 (로컬 파일):
 *   1. synthesize() 가 refAudioPath 를 받으면 파일 hash 계산
 *   2. 캐시 hit → 기존 token 재사용
 *   3. miss → /upload-ref-audio POST → token 저장
 *   4. /tts 에 ref_token + ref_text 전달
 *
 * 추가 모드:
 *   - speed 네이티브 지원 (WAV header 조작 불필요)
 *   - cfgValue → guidance_scale, inferenceTimesteps → num_step
 *   - instruct 모드 (Voice Design): ref_audio 없이 텍스트 설명으로 음색 지정
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { quietGet } = require('../quiet-http');

const PROVIDER_ID = 'omnivoice';
const DEFAULT_BASE_URL = 'http://127.0.0.1:9881';

/** secret-store 의 omnivoice.apiKey 가 있으면 X-API-Key 헤더 반환 */
function _authHeaders() {
  try {
    const SecretStore = require('../secret-store');
    const s = SecretStore.get('omnivoice');
    if (s && s.apiKey) return { 'X-API-Key': s.apiKey };
  } catch {}
  return {};
}

class OmniVoiceProvider {
  constructor(opts = {}) {
    this.id = PROVIDER_ID;
    this.label = 'OmniVoice (Voice Clone)';
    this.ready = false;
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    // v1.13.34: 120초 → 60초 — 한 sentence 합성 정상 시 5~30초. 60초면 서버 hang 빠르게 감지.
    this.timeout = opts.timeout || 60000;
    this._tokenCache = new Map(); // {fileHash: token}
  }

  async init() {
    const res = await quietGet(this.baseUrl + '/health', { timeoutMs: 5000 });
    if (res.status === 200) {
      this.ready = true;
      return true;
    }
    // 503 = 로딩 중, 0 = 연결 실패
    this.ready = false;
    return false;
  }

  /**
   * @param {string} text
   * @param {object} opts
   *   refAudioPath        {string}  로컬 참조음성 파일 경로 (Voice Clone)
   *   refText             {string}  참조음성 대본
   *   instruct            {string}  Voice Design 설명 (refAudio 없을 때)
   *   cfgValue            {number}  guidance_scale (1~4, 기본 2)
   *   inferenceTimesteps  {number}  num_step (8~64, 기본 32) — 품질↔속도
   *   speed               {number}  속도 배율 (네이티브 지원)
   *   language            {string}  'ko' | 'en' | ...
   *   tShift              {number}  t_shift (0.0~0.3, 기본 0.1)
   *   classTemperature    {number}  class_temperature (0=결정적, 기본 0.0)
   *   positionTemperature {number}  position_temperature (0=결정적, 기본 5.0)
   *   denoise             {boolean} 노이즈 제거 토큰 (기본 true)
   *   duration            {number}  목표 길이(초). null/0/undefined = 자동
   *   seed                {number}  시드 (지정 시 결정적 합성)
   */
  async synthesize(text, opts = {}) {
    if (!this.ready) throw new Error('OmniVoice 백엔드 미준비');

    const payload = {
      text: String(text),
      guidance_scale: opts.cfgValue != null ? Number(opts.cfgValue) : 2.0,
      num_step: opts.inferenceTimesteps != null ? Number(opts.inferenceTimesteps) : 32,
      speed: opts.speed != null ? parseFloat(opts.speed) : 1.0,
    };

    if (opts.language) payload.language = opts.language;
    if (opts.tShift != null) payload.t_shift = parseFloat(opts.tShift);
    if (opts.classTemperature != null) payload.class_temperature = parseFloat(opts.classTemperature);
    if (opts.positionTemperature != null) payload.position_temperature = parseFloat(opts.positionTemperature);
    if (opts.denoise != null) payload.denoise = !!opts.denoise;
    if (opts.duration != null && opts.duration !== '' && Number(opts.duration) > 0) {
      payload.duration = parseFloat(opts.duration);
    }
    if (opts.seed != null && opts.seed !== '') payload.seed = parseInt(opts.seed, 10);

    // Voice Clone — 서버 공용 라이브러리의 목소리(이름만 보냄, 업로드 불필요).
    //   서버가 wav 와 참조텍스트(.txt)를 모두 갖고 있으므로 **이 PC 에 파일이 없어도 된다.**
    //   → 아내 PC 처럼 원격만 쓰는 PC 가 참조음성 파일을 들고 있을 필요가 사라진다.
    //   ⚠ 서버에 그 이름이 없으면 400 으로 실패한다(조용히 다른 목소리로 나가지 않게 — 의도된 동작).
    if (opts.refName) {
      payload.ref_name = String(opts.refName);
      if (opts.refText) payload.ref_text = opts.refText;   // 있으면 우선, 없으면 서버 .txt 사용
    }
    // Voice Clone(기존) — 로컬 파일을 합성 직전 서버에 업로드 후 토큰화
    else if (opts.refAudioPath && opts.refText) {
      payload.ref_token = await this._ensureToken(opts.refAudioPath);
      payload.ref_text = opts.refText;
    }
    // Voice Design 모드 (참조음성 없을 때)
    else if (opts.instruct) {
      payload.instruct = opts.instruct;
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeout);

    let response;
    try {
      response = await fetch(this.baseUrl + '/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._authHeaders() },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } catch (e) {
      // ⚠ AbortError 의 기본 메시지는 "This operation was aborted" 뿐이라 원인을 알 수 없다(2026-08-20 로그).
      //   실제 사고 원인은 **로컬 GPU 경합**이었다 — 같은 3060 에서 ComfyUI 이미지가 돌아 OmniVoice 가
      //   60초 안에 답하지 못했다. 무엇을 봐야 하는지 메시지에 적어 둔다.
      if (e && (e.name === 'AbortError' || /aborted/i.test(String(e.message || '')))) {
        throw new Error(`OmniVoice 가 ${Math.round(this.timeout / 1000)}초 안에 응답하지 않았습니다 — 서버가 바쁘거나(같은 GPU 에서 이미지 생성 중) 멈춰 있습니다 (${this.baseUrl})`);
      }
      throw e;
    } finally {
      clearTimeout(t);
    }

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`OmniVoice 실패 (${response.status}): ${err.substring(0, 200)}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const wavBuffer = Buffer.from(arrayBuffer);

    // OmniVoice는 24kHz 16-bit mono WAV 반환
    const dataSize = Math.max(0, wavBuffer.length - 44);
    const sr = wavBuffer.length >= 28 ? wavBuffer.readUInt32LE(24) : 24000;
    const durationSec = Math.max(0.5, dataSize / (sr * 2));

    return {
      mp3Buffer: wavBuffer,
      durationSec,
      providerUsed: PROVIDER_ID,
      format: 'wav',
    };
  }

  /** 로컬 파일 → 서버 token (캐시 우선) */
  async _ensureToken(filePath) {
    const hash = this._fileHash(filePath);
    if (this._tokenCache.has(hash)) {
      return this._tokenCache.get(hash);
    }

    const fileContent = fs.readFileSync(filePath);
    const filename = path.basename(filePath);

    const { FormData, Blob } = globalThis;
    if (typeof FormData === 'undefined') {
      throw new Error('FormData 사용 불가 — Node 18+ 필요');
    }
    const form = new FormData();
    form.append('file', new Blob([fileContent]), filename);

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try {
      res = await fetch(this.baseUrl + '/upload-ref-audio', {
        method: 'POST',
        body: form,
        headers: { ..._authHeaders() },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`참조음성 업로드 실패 (${res.status}): ${err.substring(0, 200)}`);
    }

    const { token } = await res.json();
    this._tokenCache.set(hash, token);
    return token;
  }

  _fileHash(filePath) {
    try {
      const buf = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    } catch {
      return filePath;
    }
  }

  async stop() {
    this.ready = false;
    this._tokenCache.clear();
  }

  static getVoices() {
    // 순서 = 기본값. clone 을 첫 번째로 둬서 새 프리셋 OmniVoice 선택 시 Voice Clone 이 기본.
    // Voice Design 은 "참조음성 만드는 도구" 로 의도된 보조 모드.
    return [
      { id: 'clone',   name: 'Voice Clone',  gender: null },
      { id: 'default', name: 'Voice Design', gender: null },
    ];
  }
}

module.exports = { OmniVoiceProvider };
