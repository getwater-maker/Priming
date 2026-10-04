/**
 * TTSManager — TTS provider 추상화 (OmniVoice 근간 + Gemini 보조)
 *
 * 지원:
 *   - omnivoice  : GPU 서버 (k2-fsa/OmniVoice, 포트 9881) — 원격 LAN/Tailscale · 근간 엔진
 *   - gemini     : Google Gemini TTS (API 키 필요)
 *   - mai        : Microsoft MAI-Voice (Azure Speech 키)        ┐ 🔊 헤더 「음성 엔진」 팝업에서 고르는
 *   - typecast   : 타입캐스트 TTS (API 키)                      │ 유료 API 엔진(v0.6.67).
 *   - elevenlabs : ElevenLabs TTS (API 키)                       ┘ 키만 있으면 바로 쓴다(서버 없음).
 *
 * OmniVoice 는 항상 원격 모드. GPU 머신에서 작업 스케줄러로 자동 시동된 백엔드에
 * baseUrl 로만 연결한다 (spawn 없음).
 *
 * ⚠ Supertonic(로컬 CPU 9882)은 2026-07-31 제거됨 — OmniVoice 하나로 충분(로이 결정).
 *   매 실행마다 무의미한 연결 시도·로그만 남기고 있었다.
 */

'use strict';

// 키만 있으면 쓰는 API 엔진 — id → provider 클래스(지연 require)
const KEY_PROVIDERS = {
  gemini: () => require('./providers/gemini-provider').GeminiProvider,
  mai: () => require('./providers/mai-provider').MaiProvider,
  typecast: () => require('./providers/typecast-provider').TypecastProvider,
  elevenlabs: () => require('./providers/elevenlabs-provider').ElevenLabsProvider,
};

class TTSManager {
  constructor(opts = {}) {
    this.opts = opts;
    this.providers = new Map();
    this.logger = typeof opts.logger === 'function' ? opts.logger : () => {};
    this._started = false;
    // 디스크 캐시 즉시 로드 — 첫 합성에서도 사전 적용되도록 (이전: 빈 [] 로 시작 →
    // fire-and-forget refresh 가 끝날 때까지 첫 합성은 사전 미적용)
    try {
      this._dictCache = require('./omnivoice-dict-store').loadAll();
    } catch (_) {
      this._dictCache = [];
    }
    this._dictRefreshAt = 0;
    this._DICT_TTL_MS = 60_000;
  }

  /**
   * provider 초기화. 한쪽이 실패해도 다른 쪽은 계속 활성.
   * Idempotent — 여러 번 호출해도 한 번만 실행.
   */
  async start() {
    if (this._started) return;
    this._started = true;

    // ─── 키 기반 API 엔진(gemini · mai · typecast · elevenlabs) ───
    for (const id of Object.keys(KEY_PROVIDERS)) await this._initKeyProvider(id, true);

    // ─── omnivoice (원격 GPU) ───
    this._connectOmniVoice();
  }

  /** OmniVoice 원격 모드 연결 — baseUrl 로 health 체크만 */
  async _connectOmniVoice() {
    const { getProvider: getCfg } = require('./tts-config');
    const cfg = getCfg('omnivoice');
    const baseUrl = cfg.baseUrl;

    if (!baseUrl) {
      this.logger('[TTS] OmniVoice 스킵 — 서버 URL 미설정 (🖧 서버 버튼에서 설정)');
      return;
    }

    const { OmniVoiceProvider } = require('./providers/omnivoice-provider');
    const provider = new OmniVoiceProvider({ baseUrl });
    this.logger(`[TTS] OmniVoice 연결 중... (${baseUrl})`);
    const ok = await provider.init();
    if (ok) {
      this.providers.set('omnivoice', provider);
      this.logger('[TTS] OmniVoice 연결 완료');
    } else {
      this.logger('[TTS] OmniVoice 연결 실패 (서버 미기동 또는 모델 로딩 중)');
    }
  }

  /**
   * 외부에서 secret/baseUrl 변경 후 특정 provider 재초기화
   */
  async refreshProvider(id) {
    const existing = this.providers.get(id);
    if (existing && typeof existing.stop === 'function') {
      try { await existing.stop(); } catch {}
    }
    this.providers.delete(id);

    if (id === 'omnivoice') {
      await this._connectOmniVoice();
      return this.isAvailable(id);
    }

    if (KEY_PROVIDERS[id]) return this._initKeyProvider(id, false);
    return false;
  }

  /** 키 기반 provider 하나 초기화 — 키가 없으면 등록하지 않는다(실패가 아니다). */
  async _initKeyProvider(id, quiet) {
    try {
      const P = KEY_PROVIDERS[id]();
      const p = new P();
      const ok = await p.init();
      if (ok) {
        this.providers.set(id, p);
        if (!quiet || id === 'gemini') this.logger(`[TTS] ${p.label || id} 준비됨${p.model ? ` (model: ${p.model})` : ''}`);
        return true;
      }
      if (!quiet) this.logger(`[TTS] ${id} — API 키가 없습니다 (🔊 음성 엔진에서 넣으세요)`);
      return false;
    } catch (e) {
      this.logger(`[TTS] ${id} 초기화 실패: ${e.message}`);
      return false;
    }
  }

  async stop() {
    for (const p of this.providers.values()) {
      if (typeof p.stop === 'function') {
        try { await p.stop(); } catch {}
      }
    }
    this.providers.clear();
    this._started = false;
  }

  /** provider 가 즉시 사용 가능한지 */
  isAvailable(id) {
    const p = this.providers.get(id);
    return !!(p && p.ready);
  }

  getProvider(id) {
    return this.providers.get(id) || null;
  }

  /** UI 가 보여줄 활성 provider 목록 */
  listAvailable() {
    return Array.from(this.providers.entries())
      .filter(([_, p]) => p.ready)
      .map(([id, p]) => ({ id, label: p.label || id }));
  }

  /**
   * 텍스트 → 오디오 buffer.
   * @param {string} text
   * @param {object} opts - { provider, voice, speed, ... }
   */
  async synthesize(text, opts = {}) {
    // 첫 호출(앱 시작 직후) 은 서버 동기화를 기다림 — 다른 노트북에서 LAN 으로 갱신된 사전 반영.
    // 이후 호출은 fire-and-forget (TTL 60초 안이면 refresh 도 스킵).
    await this.prepareDict();
    // 🔑 가공은 processForTTS 한 곳에서만 — TTS 캐시 키(core/pipeline)도 같은 함수를 탄다.
    //   두 곳에서 각자 가공하면 "캐시가 옛 발음을 되살리는" 사고가 난다.
    const processed = this.processText(text);
    const id = opts.provider || 'omnivoice';
    const p = this.providers.get(id);
    if (!p || !p.ready) {
      throw new Error(`TTS provider '${id}' not available`);
    }
    return await p.synthesize(processed, opts);
  }

  /**
   * TTS 로 실제 보내지는 최종 문자열(발음사전 + 정규화 적용)을 sync 로 반환.
   * synthesize 와 **같은 함수**(text-pronouncer.processForTTS)를 타므로, 이 값을 캐시 키에
   * 쓰면 키와 실제 합성 텍스트가 어긋나지 않는다. (사전을 고쳤는데 옛 음성이 재활용되던 버그)
   */
  processText(text) {
    const { processForTTS } = require('./text-pronouncer');
    return processForTTS(text, this._dictCache);
  }

  /**
   * 발음사전을 서버와 맞춘다. 첫 호출(앱 시작 직후)만 대기하고, 이후는 fire-and-forget
   * (TTL 60초 안이면 refresh 도 스킵). 캐시 키를 계산하기 전에 불러야 첫 문장만 옛 사전으로
   * 키가 계산되는 어긋남이 없다.
   */
  async prepareDict() {
    if (this._dictRefreshAt === 0) {
      await this._maybeRefreshDictAsync();
    } else {
      this._maybeRefreshDictAsync();
    }
  }

  /** 모달 저장 직후 호출 — 메모리 캐시를 즉시 디스크 최신값으로 교체 */
  invalidateDict() {
    this._dictRefreshAt = 0;
    try {
      const OmniDictStore = require('./omnivoice-dict-store');
      this._dictCache = OmniDictStore.loadAll();
    } catch (_) {
      this._dictCache = [];
    }
  }

  async _maybeRefreshDictAsync() {
    const now = Date.now();
    if (now - this._dictRefreshAt < this._DICT_TTL_MS) return;
    this._dictRefreshAt = now;
    try {
      const OmniDictStore = require('./omnivoice-dict-store');
      await OmniDictStore.refresh();
      this._dictCache = OmniDictStore.loadAll();
    } catch (_) {}
  }
}

// 모듈 레벨 싱글톤
let _instance = null;
function getInstance(opts) {
  if (!_instance) {
    _instance = new TTSManager(opts);
  } else if (opts && opts.logger && typeof opts.logger === 'function') {
    _instance.logger = opts.logger;
  }
  return _instance;
}

module.exports = { TTSManager, getInstance, KEY_PROVIDERS };
