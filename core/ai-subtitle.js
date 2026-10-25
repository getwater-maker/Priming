'use strict';
/**
 * ai-subtitle.js — 🌐 AI 자막 교정·번역(Lab · Vrew 「AI 자막 교정/번역」) 순수 규칙: 프롬프트 · 답 해석 · 안전 검사.
 *   · 부르는 곳은 main 의 `ai-proof`·`ai-translate`(core/claude-api `ask({use})` 한 곳으로) — 여기서는 네트워크를 쓰지 않는다(렌더러 번들에도 들어가므로 require 없음).
 *   · 교정은 **제안만**(대본을 몰래 고치지 않는다) · 번역은 **SRT 파일만**(나레이션·대본·음성 불변).
 */
const LANGS = [
  { id: 'en', label: 'English', maxChars: 42 },
  { id: 'ja', label: '日本語', maxChars: 16 },
  { id: 'zh', label: '中文(简体)', maxChars: 16 },
  { id: 'vi', label: 'Tiếng Việt', maxChars: 42 },
  { id: 'es', label: 'Español', maxChars: 42 },
];
const langOf = (id) => LANGS.find((x) => x.id === id) || null;

const CHUNK = 60;   // 한 번에 보내는 문장 수(답이 잘리지 않게)
const chunks = (list, n = CHUNK) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const numbered = (list) => list.map((x) => `${x.n}\t${String(x.text).replace(/\s*\n\s*/g, ' ')}`).join('\n');

function proofRequest(list) {
  return {
    system: '너는 한국어 자막 교정자다. 오탈자·띄어쓰기·맞춤법·명백한 문장부호 오류만 고친다. 뜻·말투·어휘·문장 길이를 바꾸지 않는다. 확실하지 않으면 건드리지 않는다. 고칠 곳이 있는 줄만 JSON 배열로 답한다: [{"n":번호,"after":"고친 문장 전체","why":"이유 한마디"}]. 고칠 곳이 없으면 []. JSON 외의 글은 쓰지 않는다.',
    text: '번호와 문장(탭으로 구분):\n' + numbered(list),
  };
}
/** 답 → 제안 목록. 안전 검사: 번호가 목록에 있고 · 고친 글이 있고 · 원문과 다르고 · 길이가 크게 변하지 않을 때만(그 밖은 버린다) */
function parseProof(reply, list) {
  const arr = Array.isArray(reply) ? reply : [];
  const by = new Map(list.map((x) => [x.n, x]));
  const seen = new Set(); const out = []; let dropped = 0;
  for (const r of arr) {
    const n = Number(r && r.n); const src = by.get(n);
    const after = r && typeof r.after === 'string' ? r.after.trim() : '';
    if (!src || seen.has(n) || !after || after === String(src.text).trim()) { dropped++; continue; }
    const a = String(src.text).length, b = after.length;
    if (b > a * 1.5 + 4 || b < a * 0.5 - 4) { dropped++; continue; }
    seen.add(n);
    out.push({ n, before: src.text, after, why: String((r && r.why) || '').slice(0, 80), ref: src.ref });
  }
  return { proposals: out, dropped };
}

function translateRequest(list, langId) {
  const L = langOf(langId); const name = L ? L.label : langId;
  return {
    system: `너는 영상 자막 번역가다. 한국어 문장을 ${name} 로 자연스럽고 간결하게 번역한다. 문장마다 하나씩, 번호를 그대로 지킨다. 뜻을 더하거나 빼지 않는다. JSON 배열로만 답한다: [{"n":번호,"t":"번역"}]. JSON 외의 글은 쓰지 않는다.`,
    text: '번호와 문장(탭으로 구분):\n' + numbered(list),
  };
}
/** 답 → Map<n, 번역>. 번역이 빠진 번호는 null 로 두어 부르는 쪽이 알린다 */
function parseTranslate(reply, list) {
  const arr = Array.isArray(reply) ? reply : [];
  const m = new Map();
  for (const r of arr) { const n = Number(r && r.n); const t = r && typeof r.t === 'string' ? r.t.trim() : ''; if (t && !m.has(n)) m.set(n, t); }
  const missing = list.filter((x) => !m.has(x.n)).map((x) => x.n);
  return { map: m, missing };
}

module.exports = { LANGS, langOf, CHUNK, chunks, numbered, proofRequest, parseProof, translateRequest, parseTranslate };
