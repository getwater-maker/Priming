'use strict';
/**
 * cap-marks.js — 🤖 자막 끊어 읽기 자리(Claude) · 결과 기억 (2026-10-07, v0.7.23 · 로이 「대본을 불러오면 바로 Claude 가 배치」)
 *
 * 왜: 규칙 DP(caption-splitter)는 낱말 생김새만 봐서 「등에 | 진 빈 지게가」·「커다란 | 돌도」처럼 꾸밈 관계를 가른다.
 *     대본 1007 앞 100문장에서 Claude 와 60문장이 달랐고, 다른 곳 대부분이 DP 오류였다(작업노트 2026-10 실측).
 *
 * 방식(③ · 로이 확정): Claude 는 「숨 쉬어도 되는 자리(의미 덩어리 경계)」만 표시한다 — **길이는 신경 쓰지 않게** 한다.
 *   줄 길이(채널 자막 글자 수)는 코드(caption-splitter.wrapWords)가 그 자리에서만 이어 붙여 맞춘다.
 *   → 생각 토큰이 1/3(글자 세기를 안 한다) · 글자 수 설정을 바꿔도 Claude 를 다시 부르지 않는다.
 *   실측: 100문장 ≈ 19k 토큰 · 66초 · 검증 100/100 · 줄 나누기 결과가 「Claude 가 줄까지 정한 안」과 70/100 똑같다.
 *
 * 결과 = { t: 문장 글, w: [새 덩어리가 시작하는 어절 번호…] } — s.capMarks 에 붙는다. 글이 바뀌면 caption-splitter 가 무시한다.
 * 기억 = 문장 글의 해시 → w (~/.priming-maker/cap-marks.json) — 같은 문장은 두 번 묻지 않는다(다시 열기 = 0 토큰).
 * main 전용(자식 프로세스·fs) — 렌더러 번들에 넣지 않는다.
 * ⛔ haiku 금지(관형절을 가른다 — 실측) · ⛔ E2E 는 PM_CLAUDE_EXE 가짜 없이 부르지 않는다(로이 구독 사용량).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const SC = require('./spell-check');
const { meaningfulLen } = require('./caption-splitter');
const { detectLang } = require('./lang');

const PROMPT_VER = 'b1';   // 지시문을 바꾸면 올린다 — 옛 기억을 쓰지 않게(해시에 들어간다)
const SYSTEM = '너는 한국어 낭독 편집자다. 각 문장을 소리 내어 읽을 때 숨을 쉬어도 되는 끊어 읽기 자리마다 " / " 를 넣는다. 의미 덩어리(꾸밈말+꾸밈받는 말, 목적어·부사어+동사, 관형절+명사, 보조용언)는 가르지 않는다. 길이는 신경 쓰지 않는다. 글자·띄어쓰기·문장부호는 바꾸지 않는다. 입력과 같은 번호로 한 줄에 한 문장씩만 답한다.';
const BATCH = 80;            // 한 번에 보낼 문장 수 — 100문장 ≈ 66초 실측 · 실패해도 잃는 양이 적게
const CONCURRENCY = 2;       // 동시에 띄울 claude 수(구독 사용량·PC 부하)
const TIMEOUT_MS = 300000;   // 묶음 하나 5분

// 🛡 E2E(PM_UI_SMOKE)는 로이의 기억 파일을 쓰지 않는다 — 임시 폴더로
const cacheFile = () => process.env.PM_CAPMARKS_FILE || (process.env.PM_UI_SMOKE ? path.join(os.tmpdir(), 'priming-smoke-cap-marks.json') : path.join(os.homedir(), '.priming-maker', 'cap-marks.json'));
let _cache = null;   // { key: w[] }
function load() {
  if (_cache) return _cache;
  try { const j = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); _cache = (j && j.items && typeof j.items === 'object') ? j.items : {}; }
  catch { _cache = {}; }
  return _cache;
}
function save() {
  try {
    const f = cacheFile(); fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ v: 1, items: _cache || {} }), 'utf8'); fs.renameSync(tmp, f);
  } catch (_) {}
}
const norm = (text) => String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean).join(' ');
const keyOf = (text) => crypto.createHash('sha1').update(PROMPT_VER + '\n' + norm(text)).digest('hex').slice(0, 24);

/** 기억된 끊어 읽기 자리 — { t, w } | null */
function lookup(text) {
  const w = load()[keyOf(text)];
  return Array.isArray(w) ? { t: String(text).trim(), w: w.slice() } : null;
}
/** 문장들에 기억된 자리를 붙인다(없으면 낡은 것을 뗀다) — 붙인 수 */
function attach(sentences) {
  let n = 0;
  for (const s of sentences || []) {
    if (!s || typeof s.text !== 'string') continue;
    const m = lookup(s.text);
    if (m) { s.capMarks = m; n++; }
    else if (s.capMarks) delete s.capMarks;
  }
  return n;
}
/** Claude 에 물어야 할 문장 글(중복 없이) — 한국어 · 한 줄 기준보다 긺 · 아직 기억 없음 · 사람이 ✂ 로 나눈 줄 없음 */
function needs(sentences, minChars = 20) {
  const out = [], seen = new Set();
  const c = load();
  for (const s of sentences || []) {
    if (!s || typeof s.text !== 'string') continue;
    if (Array.isArray(s.capBreaks) && s.capBreaks.length) continue;
    const t = norm(s.text);
    if (!t || seen.has(t)) continue;
    if (meaningfulLen(t.replace(/\s/g, '')) <= minChars) continue;
    if (detectLang(t) !== 'ko') continue;
    if (Array.isArray(c[keyOf(t)])) continue;
    seen.add(t); out.push(t);
  }
  return out;
}

/** 답 → Map(번호 → w[]) — 글자를 바꾼 줄·빠진 줄은 버린다(그 문장은 규칙대로) */
function parseReply(result, batch) {
  const got = new Map();
  for (const line of String(result || '').split(/\r?\n/)) {
    const m = /^\s*(\d+)\s*[\t.:)]?\s*(.+)$/.exec(line);
    if (!m) continue;
    const i = Number(m[1]) - 1;
    if (!(i >= 0 && i < batch.length) || got.has(i)) continue;
    const words = batch[i].split(' ');
    const chunks = m[2].split(/\s*\/\s*/).map((x) => norm(x)).filter(Boolean);
    if (chunks.join(' ') !== batch[i]) continue;   // 🔒 글자·띄어쓰기를 바꿨으면 쓰지 않는다
    const w = []; let at = 0;
    for (let k = 0; k < chunks.length; k++) { if (k > 0) w.push(at); at += chunks[k].split(' ').length; }
    if (at !== words.length) continue;
    got.set(i, w);
  }
  return got;
}

/**
 * 문장 글 목록을 Claude 에 물어 기억에 넣는다.
 * @param {string[]} texts  needs() 결과
 * @param {{log?:Function, onBatch?:Function, isAborted?:Function, exe?:string}} o
 * @returns {Promise<{done:number, failed:number, error:string|null, ms:number}>}
 */
async function run(texts, o = {}) {
  const t0 = Date.now();

  const batches = [];
  for (let i = 0; i < texts.length; i += BATCH) batches.push(texts.slice(i, i + BATCH));
  let done = 0, failed = 0, error = null, next = 0, stop = false;
  const worker = async () => {
    while (!stop && next < batches.length) {
      if (o.isAborted && o.isAborted()) { stop = true; break; }
      const batch = batches[next++];
      const input = batch.map((t, i) => `${i + 1}\t${t}`).join('\n');
      const r = await SC.runClaude(input, { system: SYSTEM, timeoutMs: TIMEOUT_MS, tmpPrefix: 'priming-capmarks-', exe: o.exe });
      if (!r.ok) {
        failed += batch.length; error = r.error;
        if (/claude 가 없습니다|로그인/.test(r.error || '')) stop = true;   // 이 PC 에서 더 해도 소용없다
        continue;
      }
      const got = parseReply(r.result, batch);
      const c = load();
      for (const [i, w] of got) c[keyOf(batch[i])] = w;
      save();
      done += got.size; failed += batch.length - got.size;
      try { if (o.onBatch) o.onBatch({ done, failed, total: texts.length }); } catch (_) {}
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  const ms = Date.now() - t0;
  if (failed && !error) error = `${failed}문장은 답이 맞지 않아 규칙대로 둡니다`;
  return { done, failed, error, ms };
}

module.exports = { lookup, attach, needs, run, parseReply, keyOf, norm, SYSTEM, PROMPT_VER, BATCH, CONCURRENCY, _reset: () => { _cache = null; } };
