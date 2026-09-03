/**
 * OmniVoice /asr-upload 클라이언트.
 * 음성 파일을 multipart 로 업로드해 Whisper STT 텍스트를 받는다.
 *
 * 메모리 정책: OmniVoice 가 PrimingFlow 의 근간 엔진. 백엔드 다운 시 다른 엔진
 * 자동 fallback 추가 금지 — 사용자가 OmniVoice 를 살리도록 명시 안내.
 */

const fs = require('fs');
const path = require('path');
const { getProvider } = require('./tts-config');

function _baseUrl() {
  const p = getProvider('omnivoice');
  return (p && p.baseUrl) ? p.baseUrl.replace(/\/+$/, '') : '';
}

/** secret-store 의 omnivoice.apiKey 가 있으면 X-API-Key 헤더 반환 — provider 와 동일 패턴 */
function _authHeaders() {
  try {
    const SecretStore = require('./secret-store');
    const s = SecretStore.get('omnivoice');
    if (s && s.apiKey) return { 'X-API-Key': s.apiKey };
  } catch (_) {}
  return {};
}

/**
 * 🔴 서버 soundfile(libsndfile)이 **직접 읽는** 오디오 포맷.
 *   그 밖의 것(m4a·aac·ogg·wma·모든 영상)을 그대로 올리면 /asr-upload 가 HTTP 500 을 낸다:
 *     "Soundfile is either not in the correct format or is malformed …"
 *   실측(2026-09-03): 같은 큐에서 **m4a 14건 전부 실패 · mp3 7건 전부 성공**.
 *   ⚠ 확증 없이 이 목록을 넓히지 말 것 — 사용자에게는 원인을 알 수 없는 500 으로 되돌아온다.
 *     대신 ffmpeg 로 mp3 로 바꿔 올린다.
 */
const ASR_DIRECT_EXT = new Set(['.mp3', '.wav', '.flac']);

/** 그대로 올릴 수 있나? false 면 ffmpeg 로 mp3 변환이 필요하다. */
function needsAudioConvert(p) {
  return !ASR_DIRECT_EXT.has(path.extname(String(p || '')).toLowerCase());
}

/**
 * /ref-voices — 서버 공용 참조음성 목록.
 *   보이스디자인으로 만든 목소리는 서버(메인 PC)의 라이브러리에 모인다. 이걸 쓰면
 *   **이 PC 에 wav 파일이 없어도** 이름만으로 합성할 수 있다(아내 PC 처럼 원격만 쓰는 PC 용).
 *
 * 🔴 반환 규약(2026-08-22 변경): 성공 = 배열(비어 있을 수 있음) / **실패 = null**.
 *   예전엔 타임아웃·HTTP 오류·네트워크 실패를 전부 빈 배열로 돌려줘 "서버에 목소리가 없음"과
 *   구분이 안 됐고, 그 순간 자동 동기화가 **로컬 전 목소리를 재업로드해 _2/_3 사본 24개**를
 *   만들었다(실측 — 2026-08-14 23개 + 2026-08-20 1개). 호출부는 null 이면 동기화를 건너뛴다.
 */
async function listServerVoices() {
  const base = _baseUrl();
  if (!base) return null;                       // 주소 미설정 = 조회 불가(빈 라이브러리 아님)
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    let res;
    try { res = await fetch(base + '/ref-voices', { headers: { ..._authHeaders() }, signal: ctrl.signal }); }
    finally { clearTimeout(t); }
    if (!res.ok) return null;                   // 404(구버전)·401 등 — 목록을 믿을 수 없다
    const j = await res.json();
    return Array.isArray(j.voices) ? j.voices : null;
  } catch (_) { return null; }                  // 타임아웃·네트워크 — 목록을 믿을 수 없다
}

/**
 * /asr/status — Whisper 로드 여부 + 백엔드 도달 가능성. 실패해도 transcribe 는 시도 가능.
 */
async function checkAsrStatus() {
  const base = _baseUrl();
  if (!base) return { loaded: false, reachable: false };
  try {
    const res = await fetch(base + '/asr/status', { method: 'GET', headers: { ..._authHeaders() } });
    if (!res.ok) return { loaded: false, reachable: true };
    const j = await res.json();
    return { loaded: !!j.loaded, reachable: true };
  } catch (_) {
    return { loaded: false, reachable: false };
  }
}

/**
 * 음성 파일 → 텍스트.
 * @param {string} audioPath - 로컬 음성 파일 절대경로 (wav/mp3/m4a/flac)
 * @param {{ timeoutMs?: number }} [opts] - 기본 600초 (Whisper 첫 로드 시 5분+ 소요)
 * @returns {Promise<string>}
 */
async function transcribe(audioPath, opts = {}) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error('오디오 파일이 없습니다: ' + audioPath);
  }
  const base = _baseUrl();
  if (!base) {
    throw new Error('OmniVoice baseUrl 미설정 — 서버 설정에서 URL 을 지정하세요.');
  }
  const url = base + '/asr-upload';
  const timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) ? opts.timeoutMs : 600000;

  const buf = fs.readFileSync(audioPath);
  const filename = path.basename(audioPath);
  const blob = new Blob([buf]);
  const form = new FormData();
  form.append('file', blob, filename);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', body: form, headers: { ..._authHeaders() }, signal: controller.signal });
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (_) {}
      throw new Error(`OmniVoice /asr-upload HTTP ${res.status} — ${detail.slice(0, 300) || res.statusText}`);
    }
    const j = await res.json();
    return String(j.text || '');
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error('STT 타임아웃 — OmniVoice 응답이 늦습니다. Whisper 첫 호출 시 5분+ 걸릴 수 있어요.');
    }
    throw new Error(`STT 실패: ${e.message}\n→ OmniVoice 백엔드(${base})가 켜져있고 /asr-upload 가 가능한지 확인하세요.`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 긴 오디오 전사 — ffmpeg 로 청크 분할 후 순차 전사하여 합침.
 * 통째 업로드(메모리 1GB+) · 단일 10분 타임아웃 · 연결 끊김 시 전부 손실 문제를 회피.
 *   - 청크 길이 이하(여유 20%)면 분할 없이 단일 전사 (단 타임아웃은 넉넉히).
 *   - 청크별로 transcribe() 호출 → 실패는 그 청크만 영향. 진행률 콜백 제공.
 * @param {string} audioPath
 * @param {{ chunkSec?: number, timeoutMsPerChunk?: number,
 *           onProgress?: (p:{done:number,total:number,durationSec:number})=>void,
 *           abortSignal?: ()=>boolean }} [opts]
 * @returns {Promise<string>}
 */
async function transcribeLong(audioPath, opts = {}) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error('오디오 파일이 없습니다: ' + audioPath);
  }
  // 🔴 서버가 읽지 못하는 포맷은 **여기서** mp3 로 바꾼다. 이 함수가 /asr-upload 로 나가는
  //   유일한 문이라, 호출부가 늘어도 같은 500 을 다시 밟지 않는다(2026-09-03 m4a 사고).
  //   호출부(main.js)가 이미 변환해 넘기면 판정을 통과하므로 이중 변환은 없다.
  if (!needsAudioConvert(audioPath)) return _transcribeLongDirect(audioPath, opts);
  const media0 = require('../core/media-utils');
  const tmpConv = path.join(require('os').tmpdir(), `pf-asr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
  await media0.extractAudioMp3(audioPath, tmpConv);
  try { return await _transcribeLongDirect(tmpConv, opts); }
  finally { try { fs.rmSync(tmpConv, { force: true }); } catch (_) {} }
}

/** transcribeLong 의 본체 — 여기 오는 파일은 **서버가 직접 읽는 포맷**임이 보장된다. */
async function _transcribeLongDirect(audioPath, opts = {}) {
  const os = require('os');
  const media = require('../core/media-utils');
  const chunkSec = (opts.chunkSec > 0) ? opts.chunkSec : 900;                       // 기본 15분
  const perChunkTimeoutMs = (opts.timeoutMsPerChunk > 0) ? opts.timeoutMsPerChunk : 1800000; // 기본 30분/청크
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const aborted = () => (typeof opts.abortSignal === 'function' && opts.abortSignal());

  let dur = 0;
  try { dur = (await media.getMediaDuration(audioPath)) || 0; } catch (_) {}

  // 짧으면(청크 길이의 1.2배 이하) 분할 오버헤드 없이 단일 전사 — 단 타임아웃은 넉넉히.
  if (dur > 0 && dur <= chunkSec * 1.2) {
    onProgress({ done: 0, total: 1, durationSec: dur });
    const t = await transcribe(audioPath, { timeoutMs: perChunkTimeoutMs });
    onProgress({ done: 1, total: 1, durationSec: dur });
    return t;
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-stt-'));
  try {
    const chunks = await media.segmentAudio(audioPath, workDir, chunkSec);
    const total = chunks.length;
    const parts = [];
    for (let i = 0; i < total; i++) {
      if (aborted()) throw new Error('사용자 중단');
      onProgress({ done: i, total, durationSec: dur });
      const text = await transcribe(chunks[i], { timeoutMs: perChunkTimeoutMs });
      parts.push((text || '').trim());
    }
    onProgress({ done: total, total, durationSec: dur });
    return parts.filter(Boolean).join('\n');
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
  }
}

/**
 * /save-ref-voice — 공용 참조음성 라이브러리에 목소리 저장.
 *   🔑 **업로드도 OmniVoice(9881) 로 한다** — 보이스디자인 서버(9893)는 필요할 때만 켜지는 온디맨드라
 *     대부분 꺼져 있어 다른 PC 에서 업로드가 timeout 났다. OmniVoice 는 상시 실행이고 REF_LIB 의 주인이다.
 *   구버전 서버면 404 → { ok:false, error:'unsupported' } (호출부가 9893 으로 폴백).
 */
async function saveServerVoice({ name, text = '', instruct = '', wavBuffer }) {
  const base = _baseUrl();
  if (!base) return { ok: false, error: 'OmniVoice 서버 주소가 없습니다' };
  if (!wavBuffer || wavBuffer.length < 44) return { ok: false, error: 'wav 데이터가 없습니다' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
    let res;
    try {
      res = await fetch(base + '/save-ref-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._authHeaders() },
        body: JSON.stringify({ name: String(name || '').trim(), text: String(text || ''), instruct: String(instruct || ''), wav_b64: Buffer.from(wavBuffer).toString('base64') }),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(t); }
    if (res.status === 404) return { ok: false, error: 'unsupported' };
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) return { ok: true, name: j.name, path: j.path };
    return { ok: false, error: `${j.error || 'HTTP ' + res.status} (${base})` };
  } catch (e) { return { ok: false, error: _netErr(e, base) }; }
}

/**
 * 🎨 /styles — 여러 PC 가 함께 쓰는 이미지 스타일 목록.
 *   왜 여기에 있나: 이 파일이 곧 **OmniVoice 서버 클라이언트**다(참조음성 라이브러리도 여기 있다).
 *   주소·X-API-Key·네트워크 오류 문구를 만드는 코드가 한 곳에만 있어야 서로 어긋나지 않는다.
 *   구버전 서버면 404 → { ok:false, error:'unsupported' } (호출부는 로컬 스타일만 쓰면 된다).
 */
async function getSharedStyles({ timeoutMs = 5000 } = {}) {
  const base = _baseUrl();
  if (!base) return { ok: false, error: 'OmniVoice 서버 주소가 없습니다' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try { res = await fetch(base + '/styles', { headers: { ..._authHeaders() }, signal: ctrl.signal }); }
    finally { clearTimeout(t); }
    if (res.status === 404) return { ok: false, error: 'unsupported' };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} (${base})` };
    const j = await res.json().catch(() => ({}));
    return {
      ok: true,
      styles: Array.isArray(j.styles) ? j.styles : [],
      order: Array.isArray(j.order) ? j.order : [],
      rev: Number(j.rev) || 0,
      updatedAt: j.updatedAt || '',
    };
  } catch (e) { return { ok: false, error: _netErr(e, base) }; }
}

/** /styles 저장. baseRev 를 함께 보내 **그 사이 다른 PC 가 저장했으면 409**(+현재 문서)를 받는다.
 *  baseRev 를 생략하면 -1(검사 없이 덮어쓰기) — 첫 씨딩·복구 전용. */
async function putSharedStyles({ styles = [], order = [], baseRev = -1, timeoutMs = 8000 } = {}) {
  const base = _baseUrl();
  if (!base) return { ok: false, error: 'OmniVoice 서버 주소가 없습니다' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(base + '/styles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ..._authHeaders() },
        body: JSON.stringify({ styles, order, baseRev: Number.isFinite(baseRev) ? baseRev : -1 }),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(t); }
    if (res.status === 404) return { ok: false, error: 'unsupported' };
    const j = await res.json().catch(() => ({}));
    if (res.status === 409) {
      return {
        ok: false, conflict: true, error: 'conflict',
        styles: Array.isArray(j.styles) ? j.styles : [],
        order: Array.isArray(j.order) ? j.order : [],
        rev: Number(j.rev) || 0,
      };
    }
    if (!res.ok) return { ok: false, error: `${j.error || 'HTTP ' + res.status} (${base})` };
    return { ok: true, styles: j.styles || [], order: j.order || [], rev: Number(j.rev) || 0 };
  } catch (e) { return { ok: false, error: _netErr(e, base) }; }
}

/** undici 의 "fetch failed" 는 원인을 cause 에 숨긴다 — 실제 코드와 주소를 함께 보여준다. */
function _netErr(e, base) {
  const code = (e && e.cause && (e.cause.code || e.cause.message)) || '';
  const why = { ECONNREFUSED: '서버가 그 주소에서 응답하지 않습니다', EHOSTUNREACH: '그 주소에 닿을 수 없습니다',
    ENOTFOUND: '주소(호스트 이름)를 찾을 수 없습니다', ETIMEDOUT: '응답 시간 초과', ECONNRESET: '연결이 끊겼습니다',
    // 대부분 **메인 PC 의 IP 가 바뀌었거나 꺼져 있는 경우** — 실제로 겪은 원인이라 문구로 못박아 둔다.
    UND_ERR_CONNECT_TIMEOUT: '그 주소에 아무도 없습니다 — 메인 PC 의 IP 가 바뀌었는지 확인하세요',
    UND_ERR_HEADERS_TIMEOUT: '서버가 응답을 시작하지 않습니다' }[code] || '';
  return `${(e && e.message) || e}${code ? ` [${code}]` : ''}${why ? ` — ${why}` : ''} (${base})`;
}

module.exports = { transcribe, transcribeLong, needsAudioConvert, ASR_DIRECT_EXT, checkAsrStatus, listServerVoices, saveServerVoice, getSharedStyles, putSharedStyles };
