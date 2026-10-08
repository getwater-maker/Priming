// core/gemini-image.js
// ─────────────────────────────────────────────────────────────────────────────
// Nano Banana 2 Lite (Gemini 이미지 API)로 이미지 생성 — 브라우저 없이 API 로.
//   즉시 모드: generateContent(responseModalities:['IMAGE']) → 인라인 base64 이미지.
//   배치 모드: (예정) Gemini Batch API — 50% 저렴, 비동기 제출→회수.
// 모델명은 설정 가능(gemini-image-config). 기본 'gemini-nano-banana-2.1'(2026-10-06 GA · 1K 단가 2 Lite 와 같고 품질↑ · 로이 확정 2026-10-07).
// 나노바나나 2.1(2026-10-06 GA)은 모델 칸에 `gemini-nano-banana-2.1` 을 넣으면 같은 경로로 쓴다(generateContent·배치 동일).
// 키는 secret-store 'gemini'(음성 Gemini·프롬프트 API 와 공용).
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const os = require('os');

const CFG_PATH = path.join(os.homedir(), '.shots-maker', 'gemini-image-config.json');
const DEFAULTS = {
  model: 'gemini-nano-banana-2.1',         // Nano Banana 2.1 (1K $0.0336 · 배치 $0.0168 — 2 Lite 와 같은 값). ⚙에서 변경 가능.
  sendAspect: true,                        // generationConfig.imageConfig.aspectRatio 전송(미지원 모델이면 끄기)
  charRefs: true,                          // 👤 대본 인물 카드 → 인물 시트 → 장면마다 참조 첨부(core/char-refs)
};
function loadConfig() {
  try { const j = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); return { ...DEFAULTS, ...(j || {}) }; } catch { return { ...DEFAULTS }; }
}
function saveConfig(patch) {
  const cur = loadConfig(); const next = { ...cur, ...(patch || {}) };
  try { fs.mkdirSync(path.dirname(CFG_PATH), { recursive: true }); fs.writeFileSync(CFG_PATH, JSON.stringify(next, null, 2)); } catch {}
  return next;
}
function geminiKey() {
  try { return (require('../tts/secret-store').get('gemini') || {}).key || ''; } catch { return ''; }
}

// ── 429(한도) 분류와 사람 말 안내 ───────────────────────────────────────────────
//   구글 429 본문: error.message · error.details[] 의 QuotaFailure(violations[].quotaId/quotaMetric) · RetryInfo(retryDelay "10s").
//   종류: minute(분당 — 기다렸다 재시도) · daily(하루 — 태평양 자정에 풀림) · free(무료 등급 = 결제 미연결, 한도 0) · billing(충전·지출 한도) · unknown.
//   ⚠ 하루·무료·충전 한도는 **재시도해도 소용없다** — 호출하는 쪽이 멈춰야 한다(남은 그룹마다 같은 오류를 100번 받지 않게).
function _retrySec(json, headerVal) {
  const grab = (s) => {
    const m = String(s || '').match(/(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?/);
    if (!m || (!m[1] && !m[2] && !m[3])) return null;
    return Math.round((Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0));
  };
  try {
    for (const d of ((json && json.error && json.error.details) || [])) if (d && d.retryDelay) { const v = grab(d.retryDelay); if (v != null) return v; }
    const mm = String((json && json.error && json.error.message) || '').match(/retry in\s+([0-9hms.]+)/i);
    if (mm) { const v = grab(mm[1].replace(/\.$/, '')); if (v != null) return v; }
    if (headerVal) { const n = Number(headerVal); if (Number.isFinite(n)) return Math.round(n); }
  } catch {}
  return null;
}
function classify429(json, headerVal) {
  const err = (json && json.error) || {};
  const msg = String(err.message || '');
  let ids = '';
  for (const d of (err.details || [])) for (const v of ((d && d.violations) || [])) ids += ' ' + (v.quotaId || '') + ' ' + (v.quotaMetric || '');
  const all = ids + ' ' + msg;
  let kind = 'unknown';
  if (/free.?tier/i.test(all) && /limit:\s*0|FreeTier/i.test(all)) kind = 'free';
  else if (/PerDay|per day|daily|requests_per_day/i.test(all)) kind = 'daily';
  else if (/PerMinute|per minute|requests_per_minute/i.test(all)) kind = 'minute';
  else if (/prepay|credit|billing|spend|budget|exhausted.*quota.*project/i.test(all) && !/RESOURCE_EXHAUSTED.*rate/i.test(all)) kind = 'billing';
  return { kind, retryAfterSec: _retrySec(json, headerVal), raw: msg.slice(0, 160) };
}
// 다음 「미국 태평양 시간 자정」(일일 한도가 풀리는 때)을 한국 시간으로 → 'M월 D일 오전/오후 H시'
function dailyResetKst(nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(now)).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
  const sec = (Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second);
  const at = new Date(now + (86400 - sec) * 1000);
  const k = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(at).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
  const h = Number(k.hour) % 24, mi = Number(k.minute);
  return `${Number(k.month)}월 ${Number(k.day)}일 ${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}시${mi ? ` ${mi}분` : ''}`;
}
// 사람 말 안내(여러 줄) — 로그창에 그대로 싣는다
function explain429(q, nowMs) {
  const k = (q && q.kind) || 'unknown';
  if (k === 'daily') return [
    '⛔ 나노바나나 「하루 요청 한도」에 도달했습니다(Tier 1 기준 하루 약 1,000회 · 인물 시트·재시도도 요청 1회로 셉니다).',
    `   한도는 미국 태평양 시간 자정에 풀립니다 → 한국 시간 ${dailyResetKst(nowMs)} 이후에 「이미지」를 다시 누르면 이어서 만듭니다.`,
    '   급하면 이미지 도구를 Flow·Genspark·ComfyUI 로 바꿔 남은 그림만 만들 수 있습니다(이미 만든 그림은 건너뜁니다).',
  ];
  if (k === 'free') return [
    '⛔ 이 API 키의 프로젝트가 무료 등급이라 이미지 생성이 막혀 있습니다(요청 한도 0).',
    '   AI Studio → 결제에서 「결제 계정 연결」과 충전 상태를 확인하세요. 키가 결제 연결된 프로젝트의 것인지도 봅니다.',
  ];
  if (k === 'billing') return [
    '⛔ 결제 잔액(충전금·크레딧) 또는 결제 계정 지출 한도가 소진됐습니다.',
    '   AI Studio → 결제에서 충전하거나 지출 한도를 확인한 뒤 「이미지」를 다시 누르면 이어서 만듭니다.',
  ];
  if (k === 'minute') return [`⏳ 분당 요청 한도에 걸렸습니다${q && q.retryAfterSec ? ` — ${q.retryAfterSec}초 뒤 다시 시도합니다` : ''}.`];
  return [
    '⛔ 구글이 요청을 제한했습니다(429)' + (q && q.raw ? ' — ' + q.raw : '') + '.',
    '   잠시 뒤 「이미지」를 다시 누르면 이어서 만듭니다. 계속되면 AI Studio 「비율 제한」 화면에서 이 모델의 한도를 확인하세요.',
  ];
}

// 즉시 이미지 생성 1장 → { ok, buffer, ext } | { ok:false, error }
//   refParts: 프롬프트 앞에 붙는 Gemini parts(👤 인물 참조 — 「이름 글 → inlineData 그림」 쌍, core/char-refs.refParts)
async function generateImage({ prompt, aspect, key, model, sendAspect, refParts, timeoutMs = 120000 }) {
  key = key || geminiKey();
  if (!key) return { ok: false, error: 'Gemini API 키 없음 (⚙에서 설정)' };
  const cfg = loadConfig();
  model = model || cfg.model;
  const useAspect = sendAspect != null ? sendAspect : cfg.sendAspect;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const genCfg = { responseModalities: ['IMAGE'] };
  if (useAspect && aspect) genCfg.imageConfig = { aspectRatio: aspect };   // 예: '16:9' | '9:16' | '1:1'
  const body = { contents: [{ parts: [...(refParts || []), { text: String(prompt || '') }] }], generationConfig: genCfg };
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    const txt = await res.text();
    let json = {}; try { json = JSON.parse(txt); } catch {}
    if (!res.ok) return { ok: false, status: res.status, quota: res.status === 429 ? classify429(json, res.headers.get('retry-after')) : undefined, error: `Gemini ${res.status}: ${(json.error && json.error.message) || txt.slice(0, 200)}` };
    const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
    const img = parts.find((p) => p.inlineData && p.inlineData.data);
    if (!img) return { ok: false, error: '이미지 응답 없음: ' + txt.slice(0, 200) };
    const mime = img.inlineData.mimeType || 'image/png';
    const ext = /jpe?g/i.test(mime) ? 'jpg' : (/webp/i.test(mime) ? 'webp' : 'png');
    return { ok: true, buffer: Buffer.from(img.inlineData.data, 'base64'), ext };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// 즉시 이미지 생성 → 파일로 저장. { ok, path } | { ok:false, error }
async function generateImageToFile({ prompt, aspect, outPathNoExt, key, model, refParts }) {
  const r = await generateImage({ prompt, aspect, key, model, refParts });
  if (!r.ok) return r;
  const outPath = outPathNoExt + '.' + r.ext;
  try { fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, r.buffer); }
  catch (e) { return { ok: false, error: '저장 실패: ' + String((e && e.message) || e) }; }
  return { ok: true, path: outPath };
}

function hasKey() { return !!geminiKey(); }

// ── 배치 모드 (Gemini Batch API, 인라인 요청) — 50% 저렴, 최대 24h(보통 2~4h). 제출→회수 분리 ──
//   requests: [{ key, prompt, aspect }]. 입력(프롬프트)은 작아 인라인으로 충분(<20MB).
async function submitBatch({ requests, model, key, sendAspect, displayName, timeoutMs = 180000 }) {
  key = key || geminiKey();
  if (!key) return { ok: false, error: 'Gemini API 키 없음 (⚙에서 설정)' };
  if (!requests || !requests.length) return { ok: false, error: '요청이 비어있음' };
  const cfg = loadConfig();
  model = model || cfg.model;
  const useAspect = sendAspect != null ? sendAspect : cfg.sendAspect;
  const inline = requests.map((r) => {
    const genCfg = { responseModalities: ['IMAGE'] };
    if (useAspect && r.aspect) genCfg.imageConfig = { aspectRatio: r.aspect };
    return { request: { contents: [{ parts: [{ text: String(r.prompt || '') }] }], generationConfig: genCfg }, metadata: { key: String(r.key) } };
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchGenerateContent?key=${encodeURIComponent(key)}`;
  const body = { batch: { display_name: (displayName || 'priming-batch').slice(0, 120), input_config: { requests: { requests: inline } } } };
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const txt = await res.text(); let j = {}; try { j = JSON.parse(txt); } catch {}
    if (!res.ok) return { ok: false, status: res.status, quota: res.status === 429 ? classify429(j, res.headers.get('retry-after')) : undefined, error: `Gemini batch ${res.status}: ${(j.error && j.error.message) || txt.slice(0, 200)}` };
    const name = j.name || (j.metadata && j.metadata.name);
    if (!name) return { ok: false, error: '배치 name 없음: ' + txt.slice(0, 200) };
    return { ok: true, batchName: name, model, count: inline.length };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// 배치 상태 조회 + (완료 시) 결과 이미지 추출. { ok, state, done, results:[{key, ok, buffer, ext}|{key, ok:false, error}] }
async function checkBatch({ batchName, key, timeoutMs = 180000 }) {
  key = key || geminiKey();
  if (!key) return { ok: false, error: 'Gemini API 키 없음' };
  const url = `https://generativelanguage.googleapis.com/v1beta/${batchName}?key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    const txt = await res.text(); let j = {}; try { j = JSON.parse(txt); } catch {}
    if (!res.ok) return { ok: false, error: `Gemini batch status ${res.status}: ${(j.error && j.error.message) || txt.slice(0, 200)}` };
    const state = (j.metadata && j.metadata.state) || j.state || (j.done ? 'JOB_STATE_SUCCEEDED' : 'JOB_STATE_RUNNING');
    const done = /SUCCEEDED|FAILED|CANCELLED|EXPIRED/i.test(state);
    const results = [];
    // 실측(2.1 배치, 2026-10-07): 결과는 response.inlinedResponses.inlinedResponses[] (한 겹 더 감싼 객체) — metadata.output 에도 같은 사본이 있다.
    let inlined = (j.response && (j.response.inlinedResponses || j.response.inlineResponses)) || (j.metadata && j.metadata.output && j.metadata.output.inlinedResponses) || [];
    if (!Array.isArray(inlined)) inlined = inlined.inlinedResponses || inlined.inlineResponses || [];
    for (let i = 0; i < inlined.length; i++) {
      const item = inlined[i] || {};
      const k = (item.metadata && item.metadata.key) || item.key || String(i);
      if (item.error) { results.push({ key: k, ok: false, error: item.error.message || 'error' }); continue; }
      const parts = ((((item.response || {}).candidates || [])[0] || {}).content || {}).parts || [];
      const img = parts.find((p) => p.inlineData && p.inlineData.data);
      if (!img) { results.push({ key: k, ok: false, error: '이미지 응답 없음' }); continue; }
      const mime = img.inlineData.mimeType || 'image/png';
      const ext = /jpe?g/i.test(mime) ? 'jpg' : (/webp/i.test(mime) ? 'webp' : 'png');
      results.push({ key: k, ok: true, buffer: Buffer.from(img.inlineData.data, 'base64'), ext });
    }
    return { ok: true, state, done, results };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

module.exports = { classify429, explain429, dailyResetKst, generateImage, generateImageToFile, submitBatch, checkBatch, loadConfig, saveConfig, hasKey, CFG_PATH, DEFAULTS };
