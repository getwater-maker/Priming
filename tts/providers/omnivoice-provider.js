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

// 이보다 짧으면 '소리가 없다'고 본다. 실제 가장 짧은 문장이 0.58초였으므로 0.05초는 충분히 보수적이다.
const MIN_AUDIO_SEC = 0.05;

/**
 * WAV 버퍼의 실제 길이(초)를 잰다.
 * 🔑 **헤더 44바이트 고정을 가정하지 않고 data 청크를 찾는다** — LIST/fact 청크가 붙으면
 *   `length - 44` 는 과대 추정이 된다. 전송이 끊겨 헤더가 적은 크기보다 파일이 짧으면 실제 바이트로 자른다.
 *   WAV 가 아니거나 data 가 없으면 0 을 돌려준다(= 호출부가 실패로 처리).
 */
function measureWav(buf) {
  const fail = { durationSec: 0, sampleRate: 24000, dataSize: 0 };
  if (!buf || buf.length < 44) return fail;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return fail;
  let sampleRate = 24000, channels = 1, bits = 16, dataSize = 0, seen = false;
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const body = p + 8;
    if (id === 'fmt ' && body + 16 <= buf.length) {
      channels = buf.readUInt16LE(body + 2) || 1;
      sampleRate = buf.readUInt32LE(body + 4) || 24000;
      bits = buf.readUInt16LE(body + 14) || 16;
    } else if (id === 'data') {
      dataSize = Math.min(size, Math.max(0, buf.length - body));
      seen = true;
      break;
    }
    p = body + size + (size % 2);
  }
  if (!seen) dataSize = Math.max(0, buf.length - 44);
  const bytesPerSec = sampleRate * channels * Math.max(1, Math.floor(bits / 8));
  return { durationSec: bytesPerSec > 0 ? dataSize / bytesPerSec : 0, sampleRate, dataSize };
}

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
      await this.wake();   // 💤 내려놓은 모델이면 미리 올린다(첫 문장이 60초 제한에 걸리지 않게)
      this.ready = true;
      return true;
    }
    // 503 = 로딩 중, 0 = 연결 실패
    this.ready = false;
    return false;
  }

  // 💤 모델 내려놓기·깨우기(2026-10-17 · 서버 api.py 의 /release·/wake) — 음성 단계가 끝나면 서버가 RAM·VRAM 을 비워
  //   이미지(ComfyUI)가 느려지지 않게 한다. 다른 PC 가 쓰는 중이면 서버가 거절한다. 옛 서버(404)·오류는 조용히 넘어간다(fail-open).
  async wake() {
    try {
      const b = await fetch(this.baseUrl + '/busy', { headers: _authHeaders(), signal: AbortSignal.timeout(4000) });
      if (!b.ok) return null;
      const j = await b.json();
      if (!j || !j.released) return null;
      const r = await fetch(this.baseUrl + '/wake', { method: 'POST', headers: _authHeaders(), signal: AbortSignal.timeout(240000) });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }

  async release() {
    try {
      const r = await fetch(this.baseUrl + '/release', { method: 'POST', headers: _authHeaders(), signal: AbortSignal.timeout(15000) });
      if (!r.ok) return { released: false, reason: 'http-' + r.status };
      return await r.json();
    } catch (e) { return { released: false, reason: e.message }; }
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
        // ⏱ X-Client-Timeout = 이 앱이 기다리는 초(v0.9.113) — 서버는 그 안에 차례(GPU)가 안 오면 합성하지 않고 버린다.
        //   예전엔 시간초과로 앱이 포기한 요청도 서버가 끝까지 만들어 재시도마다 쌓였다(2026-10-23 중단 뒤에도 「4건 처리 중」).
        headers: { 'Content-Type': 'application/json', 'X-Client-Timeout': String(Math.round(this.timeout / 1000)), ..._authHeaders() },
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
    let wavBuffer = Buffer.from(arrayBuffer);

    // OmniVoice는 24kHz 16-bit mono WAV 반환.
    // 🔴 **빈 WAV 를 정상으로 넘기지 않는다** — 서버가 HTTP 200 으로 헤더만(샘플 0개) 돌려주는 일이
    //   실제로 있었다(2026-09-06 [서재_0920] 비밀의 화원 11부 컷857 = 44바이트 wav).
    //   옛 코드의 `Math.max(0.5, …)` 바닥값이 그걸 **0.50초짜리 정상 음성으로 위장**시켜
    //   캐시·.vrew 까지 흘려보냈고, Vrew 렌더링이 1339번 클립에서 `C166/E01`(오디오 디코딩 실패)로 멈췄다.
    //   여기서 던지면 fillTts 의 3회 재시도가 받는다(대개 다음 시도에 정상 음성이 온다).
    const { durationSec } = measureWav(wavBuffer);
    if (!(durationSec >= MIN_AUDIO_SEC)) {
      const err = new Error(`OmniVoice 가 빈 음성을 돌려줬습니다 (${wavBuffer.length}바이트 · ${durationSec.toFixed(3)}초) — 그 문장을 합성하지 못했습니다`);
      err.emptyAudio = true;   // 🔑 호출부가 '시드를 바꿔 재시도'로 갈라내는 표식
      throw err;
    }

    // 😮‍💨 문장 맨 앞 들숨 지우기(2026-10-15 · 희동) — 첫 낱말 앞 정적보다 앞에 있는 소리만 0 으로 눕힌다(길이 불변).
    //   🔑 캐시 키 `lb`(tts-cache.keyFor · tsv-tts.cacheKey)와 짝이다 — 숨 있는 옛 캐시가 되살아나지 않게.
    let leadBreathSec = 0;
    try {
      const lb = require('../../core/audio-normalize').muteLeadBreath(wavBuffer);
      if (lb) { wavBuffer = lb.buf; leadBreathSec = lb.mutedSec; }
    } catch (_) { /* 판단 실패면 원본 그대로 — 음성 생성을 막지 않는다 */ }

    return {
      mp3Buffer: wavBuffer,
      durationSec,
      leadBreathSec,
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

module.exports = { OmniVoiceProvider, measureWav, MIN_AUDIO_SEC };
