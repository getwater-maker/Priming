'use strict';
/**
 * api-key-check.js — 🔑 API 키 검증(⚙ 설정 → 🔑 API 키 · 2026-10-06 로이)
 *   저장하거나 쓰기 전에 「이 키가 지금 통하는가」를 확인한다. **읽기 전용 · 무료** 호출만 쓴다(요금이 드는 생성·합성 호출 없음):
 *     gemini     GET /v1beta/models/<모델>  (모델을 모르면 목록 1개)   — 나노바나나 · Gemini TTS 공용 키
 *     xai        GET /v1/api-key                                       — Grok API(비디오)
 *     mai        GET https://<지역>.tts.speech.microsoft.com/cognitiveservices/voices/list   — Azure Speech 키 + **지역**
 *     typecast   GET /v2/voices?model=ssfm-v30
 *     elevenlabs GET /v2/voices?page_size=1                            — Voices 읽기 권한이 없으면 「키는 맞지만 권한 부족」
 *   결과 = { ok, level: 'ok'|'warn'|'bad', message } — 사람 말. ⛔ 키 원문을 메시지·로그에 싣지 않는다.
 *   level: ok = 통과 · warn = 키는 유효하지만 확인할 것이 있음(모델명·권한·한도) · bad = 거부됨/연결 실패.
 *   ⚠ 메인 프로세스 전용(전역 fetch) — 렌더러 번들에 넣지 말 것.
 */

const TIMEOUT_MS = 15000;

async function http(url, headers, fetchImpl) {
  const f = fetchImpl || fetch;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await f(url, { method: 'GET', headers, signal: ac.signal });
    let text = ''; try { text = await res.text(); } catch (_) {}
    let json = null; try { json = JSON.parse(text); } catch (_) {}
    return { status: res.status, text, json };
  } finally { clearTimeout(t); }
}

const bad = (message) => ({ ok: false, level: 'bad', message });
const good = (message) => ({ ok: true, level: 'ok', message });
const warn = (message) => ({ ok: true, level: 'warn', message });
const detail = (r) => String((r.json && (r.json.error && (r.json.error.message || r.json.error) || r.json.detail && (r.json.detail.message || r.json.detail.status || r.json.detail) || r.json.message)) || r.text || '').replace(/\s+/g, ' ').slice(0, 120);

/** 공통 상태 해석 — 401/403 = 거부, 429 = 한도, 5xx = 서버 쪽 문제 */
function generic(r, label) {
  if (r.status === 401 || r.status === 403) return bad(`${label} 키가 거부됐습니다(${r.status}) — 키를 다시 확인하세요`);
  if (r.status === 429) return warn(`${label} 키는 인식됐지만 지금 한도·속도 제한에 걸렸습니다(429)`);
  if (r.status >= 500) return warn(`${label} 서버가 지금 응답하지 못합니다(${r.status}) — 잠시 뒤 다시`);
  return bad(`${label} 응답이 이상합니다(${r.status}${detail(r) ? ' · ' + detail(r) : ''})`);
}

async function verify(id, key, o = {}, fetchImpl) {
  const k = String(key || '').trim();
  if (!k) return bad('키가 없습니다 — 먼저 붙여넣으세요');
  try {
    if (id === 'gemini') {
      const model = String(o.model || '').trim();
      const url = model ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` : 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1';
      const r = await http(url, { 'x-goog-api-key': k }, fetchImpl);
      if (r.status === 200) return good(model ? `Gemini 키 통과 · 모델 ${model} 확인` : 'Gemini 키 통과');
      if (r.status === 400 && /API[ _]key not valid|API_KEY_INVALID/i.test(r.text)) return bad('Gemini 키가 틀렸습니다(API key not valid)');
      if (r.status === 404 && model) return warn(`Gemini 키는 맞지만 모델 「${model}」 을 찾지 못했습니다(404) — 모델명을 확인하세요`);
      return generic(r, 'Gemini');
    }
    if (id === 'xai') {
      const r = await http('https://api.x.ai/v1/api-key', { Authorization: 'Bearer ' + k }, fetchImpl);
      if (r.status === 200) {
        const j = r.json || {};
        if (j.api_key_blocked || j.team_blocked || j.disabled) return warn('xAI 키는 맞지만 차단/비활성 상태입니다 — console.x.ai 에서 확인하세요');
        return good('xAI(Grok) 키 통과' + (j.name ? ` · ${j.name}` : ''));
      }
      if (r.status === 400 || r.status === 401 || r.status === 403) return bad(`xAI 키가 거부됐습니다(${r.status}) — 키를 다시 확인하세요`);
      return generic(r, 'xAI');
    }
    if (id === 'mai') {
      const region = String(o.region || 'eastus').trim() || 'eastus';
      if (!/^[a-z0-9]+$/i.test(region)) return bad('지역 이름이 이상합니다');
      const r = await http(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { 'Ocp-Apim-Subscription-Key': k }, fetchImpl);
      if (r.status === 200) return good(`Azure Speech 키 통과 · 지역 ${region}`);
      if (r.status === 401 || r.status === 403) return bad(`Azure Speech 키가 거부됐습니다 — 키가 틀렸거나 지역이 리소스와 다릅니다(지금 지역: ${region})`);
      return generic(r, 'Azure Speech');
    }
    if (id === 'typecast') {
      const r = await http('https://api.typecast.ai/v2/voices?model=ssfm-v30', { 'X-API-KEY': k }, fetchImpl);
      if (r.status === 200) return good('타입캐스트 키 통과');
      return generic(r, '타입캐스트');
    }
    if (id === 'elevenlabs') {
      const r = await http('https://api.elevenlabs.io/v2/voices?page_size=1', { 'xi-api-key': k }, fetchImpl);
      if (r.status === 200) return good('ElevenLabs 키 통과(Voices 읽기 가능)');
      if (r.status === 401 && /missing_permissions|permission/i.test(r.text)) return warn('ElevenLabs 키는 맞지만 Voices 읽기 권한이 없습니다 — 키 권한에 「Voices: Read」를 켜세요');
      return generic(r, 'ElevenLabs');
    }
    return bad('알 수 없는 키 종류: ' + id);
  } catch (e) {
    const m = String((e && e.message) || e);
    return bad(/abort/i.test(m) ? `${TIMEOUT_MS / 1000}초 안에 응답이 없습니다 — 인터넷 연결을 확인하세요` : `연결하지 못했습니다(${m.replace(k, '***').slice(0, 80)}) — 인터넷 연결을 확인하세요`);
  }
}

module.exports = { verify, ids: ['gemini', 'xai', 'mai', 'typecast', 'elevenlabs'] };
