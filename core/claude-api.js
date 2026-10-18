'use strict';
/**
 * claude-api.js — 🤖 Claude API 한 곳(2026-10-11, v0.7.94 · 로이 「API 를 쓸 수 있는 곳은 우선 Claude API 로」)
 *   키·모델 = secret-store 'claude' {key, model}(⚙ 설정 → 🔑 API 키) · 쓴 만큼 충전금에서 빠진다(유료).
 *   부르는 곳: 자막 끊어 읽기·맞춤법(spell-check.runClaude — 키가 있으면 여기, 없으면 claude CLI) · 이미지/영상 프롬프트 작성 ·
 *              그림 검수(그림을 직접 봄) · 출판 소개글·교정 · 목소리 설명 번역 · 보이스디자인 설명 만들기.
 *   ⛔ npm 의존성을 늘리지 않으려고 SDK 대신 전역 fetch(라이트 업데이트 — CLAUDE.md §2).
 *   ⛔ E2E(PM_UI_SMOKE)는 `global.__claudeApiTest = { cfg:{key,model}, fetch }` 가짜 없이는 부르지 않는다(로이 충전금).
 *   ⛔ 키 원문을 로그·오류 글에 싣지 않는다.
 *   main 전용(전역 fetch·fs) — 렌더러 번들에 넣지 말 것.
 */
const fs = require('fs');

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-opus-5-5';
// 고를 수 있는 모델 · 가격($/100만 토큰) — 비용 로그용. ⛔ haiku 는 넣지 않는다(끊어 읽기가 관형절을 가른다 — 실측)
const MODELS = {
  'claude-opus-5-5': { label: 'Opus 5.5 (기본 · 가장 똑똑함)', in: 4, out: 20 },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5 (절반 가격)', in: 2, out: 10 },
};

// 🎯 쓰는 곳마다 모델(v0.9.67 · 로이 2026-10-17 「사용하는 곳마다 어떤 모델을 쓸지 선택」) — 부르는 쪽이 ask({use}) 로 이름을 댄다.
//   고르지 않은 곳(=「기본」)은 위 기본 모델(cfg().model)을 쓴다 · 저장 = secret-store 'claude'.uses {쓰임: 모델}.
const USES = {
  prompt: '✍ 그림·영상 프롬프트 쓰기·다시 쓰기',
  recover: '🩹 실패한 그림 프롬프트 고치기',
  vision: '🔍 그림 검수',
  capmarks: '✂ 자막 끊어 읽기',
  spell: '📝 맞춤법 검사',
  voice: '🎙 목소리 설명 번역·보이스디자인',
  book: '📖 책 소개·교정',
  mail: '📬 출판 메일 확인',
  helper: '💬 프로그램에 묻기 (안 고르면 Sonnet)',
};
const _cleanUses = (u) => { const o = {}; for (const k of Object.keys(USES)) if (u && MODELS[u[k]]) o[k] = u[k]; return o; };

function _ss() { return require('../tts/secret-store'); }
function cfg() {
  if (process.env.PM_UI_SMOKE) { const t = global.__claudeApiTest; return t && t.cfg ? { key: String(t.cfg.key || ''), model: MODELS[t.cfg.model] ? t.cfg.model : DEFAULT_MODEL, uses: _cleanUses(t.cfg.uses) } : { key: '', model: DEFAULT_MODEL, uses: {} }; }
  let s = {}; try { s = _ss().get('claude') || {}; } catch (_) {}
  return { key: String(s.key || '').trim(), model: MODELS[s.model] ? s.model : DEFAULT_MODEL, uses: _cleanUses(s.uses) };
}
// 이 쓰임이 실제로 쓸 모델 — 직접 넘긴 model > 그 쓰임에 고른 모델 > 기본 모델
function modelFor(use, model, c = cfg()) { return MODELS[model] ? model : (use && c.uses[use]) || c.model; }
const available = () => !!cfg().key;
const costOf = (model, usage) => {
  const p = MODELS[model] || MODELS[DEFAULT_MODEL]; const u = usage || {};
  const inTok = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) * 1.25 + (Number(u.cache_read_input_tokens) || 0) * 0.1;
  return (inTok * p.in + (Number(u.output_tokens) || 0) * p.out) / 1e6;
};
let _spent = 0;   // 이번 실행에서 쓴 금액(추정) — 로그용

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function errText(status, j, raw) {
  const m = String((j && j.error && j.error.message) || raw || '').replace(/\s+/g, ' ').slice(0, 160);
  if (status === 401) return 'Claude API 키가 틀렸습니다(401) — ⚙ 설정 → 🔑 API 키에서 확인하세요';
  if (status === 403) return 'Claude API 키에 권한이 없습니다(403)';
  if (status === 400 && /credit|balance/i.test(m)) return 'Claude 충전금이 부족합니다 — 콘솔(platform.claude.com)에서 충전하세요';
  if (status === 429) return 'Claude API 속도·한도 제한(429) — 잠시 뒤 다시';
  if (status === 529 || status >= 500) return `Claude 서버가 붐빕니다(${status}) — 잠시 뒤 다시`;
  return `Claude API 오류(${status}) ${m}`.trim();
}

/**
 * 한 번 묻기.
 * @param {{system?:string, text?:string, content?:Array, model?:string, maxTokens?:number, timeoutMs?:number, effort?:string, label?:string, log?:Function}} o
 *   content = 사용자 메시지 블록 배열(그림 넣을 때) · 없으면 text 하나
 * @returns {Promise<{ok:true, text, usage, costUsd, model, ms} | {ok:false, error, ms}>}
 */
async function ask(o = {}) {
  const t0 = Date.now();
  const c = cfg();
  if (!c.key) return { ok: false, error: 'Claude API 키가 없습니다 — ⚙ 설정 → 🔑 API 키에 넣으세요', noKey: true, ms: 0 };
  const model = modelFor(o.use, o.model, c);
  const body = {
    model, max_tokens: o.maxTokens || 16000,
    messages: [{ role: 'user', content: o.content || String(o.text || '') }],
    fallbacks: 'default',   // 안전 거절이면 서버가 대체 모델로 다시(server-side fallback)
  };
  if (o.system) body.system = o.system;
  if (o.effort) body.output_config = { effort: o.effort };
  const headers = { 'content-type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' };
  const f = (process.env.PM_UI_SMOKE && global.__claudeApiTest && global.__claudeApiTest.fetch) || fetch;
  const timeoutMs = o.timeoutMs || 600000;
  for (let att = 1; ; att++) {
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), timeoutMs);
    let status = 0, raw = '', j = null, retryAfter = 0;
    try {
      const res = await f(API_URL, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
      status = res.status; raw = await res.text(); try { j = JSON.parse(raw); } catch (_) {}
      try { retryAfter = Number(res.headers && res.headers.get && res.headers.get('retry-after')) || 0; } catch (_) {}
    } catch (e) {
      clearTimeout(tm);
      const m = String((e && e.message) || e).split(c.key).join('***');
      if (att < 3 && !/abort/i.test(m)) { await sleep(3000 * att); continue; }
      return { ok: false, error: /abort/i.test(m) ? `Claude 가 ${Math.round(timeoutMs / 1000)}초 안에 답하지 않았습니다` : 'Claude API 에 연결하지 못했습니다 — ' + m.slice(0, 80), ms: Date.now() - t0 };
    }
    clearTimeout(tm);
    if ((status === 429 || status === 529 || status >= 500) && att < 4) { await sleep(Math.min(60, retryAfter || 5 * att) * 1000); continue; }
    if (status !== 200) return { ok: false, error: errText(status, j, raw), status, ms: Date.now() - t0 };
    if (j && j.stop_reason === 'refusal') return { ok: false, error: 'Claude 가 이 요청을 거절했습니다' + (j.stop_details && j.stop_details.category ? `(${j.stop_details.category})` : ''), ms: Date.now() - t0 };
    const text = ((j && j.content) || []).filter((b) => b && b.type === 'text').map((b) => b.text || '').join('');
    const usage = (j && j.usage) || null;
    const costUsd = costOf((j && j.model) || model, usage);
    _spent += costUsd;
    if (o.log) { try { o.log(`💳 Claude ${o.label ? o.label + ' ' : ''}— 입력 ${(usage && usage.input_tokens) || 0} · 출력 ${(usage && usage.output_tokens) || 0} 토큰 ≈ $${costUsd.toFixed(4)} (이번 실행 누적 ≈ $${_spent.toFixed(3)})`); } catch (_) {} }
    if (!text.trim()) return { ok: false, error: j && j.stop_reason === 'max_tokens' ? 'Claude 답이 너무 길어 잘렸습니다' : 'Claude 답에 글이 없습니다', ms: Date.now() - t0 };
    return { ok: true, text, usage, costUsd, model: (j && j.model) || model, ms: Date.now() - t0 };
  }
}

/** 그림 파일 → 이미지 블록. 크면(>3.5MB) 호출하는 쪽이 줄여서 넘긴다(API 한 장 5MB 한도) */
function imageBlock(file) {
  const ext = String(file).toLowerCase().split('.').pop();
  const media = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: media, data: fs.readFileSync(file).toString('base64') } };
}

/** 답에서 JSON 하나(객체·배열) 꺼내기 — ```json 펜스 허용 · 실패 = null */
function parseJson(text) {
  let r = String(text || '').trim();
  const fence = r.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) r = fence[1].trim();
  const a = Math.min(...['{', '['].map((ch) => { const i = r.indexOf(ch); return i < 0 ? Infinity : i; }));
  if (!Number.isFinite(a)) return null;
  const close = r[a] === '{' ? '}' : ']'; const b = r.lastIndexOf(close);
  if (b < a) return null;
  try { return JSON.parse(r.slice(a, b + 1)); } catch { return null; }
}

module.exports = { ask, available, cfg, modelFor, imageBlock, parseJson, costOf, MODELS, USES, DEFAULT_MODEL, spent: () => _spent };
