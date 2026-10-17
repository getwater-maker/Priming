'use strict';
// core/kie-api.js — 🧩 kie.ai 이미지·비디오 생성(v0.9.66 · 로이 2026-10-17 「장기적으로 kie 하나로 운영」)
//   인증: Authorization: Bearer <키> (secret-store 'kie' · ⚙ 설정 → 🔑 API 키) · 전역 fetch(⛔ npm SDK — 라이트 업데이트)
//   흐름: (비디오면 그림 올리기) → POST /api/v1/jobs/createTask {model, input} → taskId
//         → GET /api/v1/jobs/recordInfo?taskId= 를 물어 state 가 success 면 resultJson.resultUrls[0] 을 받아 파일로.
//   ⚠ /api/v1/* 는 오류도 HTTP 200 으로 온다 — 몸의 code 를 본다(200 = 성공 · 401 키 · 402 크레딧 부족 · 429 속도 제한).
//   실패한 작업은 과금되지 않는다(kie 정책). 결과 주소는 오래 살지 않으므로 받자마자 내려받는다.
//   ⚠ 메인 프로세스 전용(fs·fetch) — 렌더러는 core/kie-models 만 읽는다. ⛔ 키 원문을 로그·메시지에 싣지 않는다.
const fs = require('fs');
const path = require('path');

const API = 'https://api.kie.ai';
const UPLOAD = 'https://kieai.redpandaai.co';

function kieKey() {
  if (process.env.PM_UI_SMOKE && global.__kieTest) return global.__kieTest.key || '';   // 🧪 E2E 는 진짜 키를 안 쓴다
  try { return String((require('../tts/secret-store').get('kie') || {}).key || '').trim(); } catch { return ''; }
}
const hasKey = () => !!kieKey();
const _fetch = () => (global.__kieTest && global.__kieTest.fetch) || fetch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scrub = (s, key) => String(s || '').split(key || '\u0000').join('***').replace(/\s+/g, ' ').slice(0, 200);

// 몸의 code → 사람 말 · fatal = 다음 그룹도 똑같이 실패할 이유(키·크레딧) → 남은 것을 멈춘다
function explain(code, msg) {
  const m = String(msg || '');
  if (code === 401) return { error: `kie 키가 거부됐습니다(401) — ⚙ 설정 → 🔑 API 키에서 확인하세요`, fatal: 'kie 키 오류' };
  if (code === 402) return { error: `kie 크레딧이 부족합니다(402) — kie.ai 에서 충전하세요`, fatal: 'kie 크레딧 부족' };
  if (code === 429) return { error: `kie 요청 속도 제한(429)${m ? ' · ' + m : ''}`, retry: true };
  if (code === 455 || code === 500 || code === 501 || code === 503) return { error: `kie 서버 문제(${code})${m ? ' · ' + m : ''}`, retry: true };
  return { error: `kie 오류(${code})${m ? ' · ' + m : ''}` };
}

async function call(method, url, body, { key, timeoutMs = 60000 } = {}) {
  key = key || kieKey();
  const res = await _fetch()(url, {
    method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text(); let j = null; try { j = JSON.parse(text); } catch {}
  if (!j) return { code: res.status || 0, msg: scrub(text, key) };
  return { code: Number(j.code != null ? j.code : res.status), msg: scrub(j.msg || j.message || '', key), data: j.data };
}

/** 남은 크레딧 — 키 검증(무료 조회)에도 쓴다. { ok, credits } | { ok:false, code, error } */
async function credits(key) {
  try {
    const r = await call('GET', `${API}/api/v1/chat/credit`, null, { key, timeoutMs: 15000 });
    if (r.code === 200) return { ok: true, credits: Number(r.data) };
    return { ok: false, code: r.code, ...explain(r.code, r.msg) };
  } catch (e) { return { ok: false, code: 0, error: '연결 실패: ' + scrub(e && e.message, key) }; }
}

/** 로컬 그림을 kie 파일 저장소에 올린다(이미지→영상 입력) → 공개 주소. 올린 파일은 kie 가 며칠 뒤 지운다. */
async function uploadFile(localPath, key) {
  key = key || kieKey();
  const buf = fs.readFileSync(localPath);
  const ext = path.extname(localPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const fd = new FormData();
  const name = `priming_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext || '.png'}`;   // ASCII 이름(한글 경로를 밖으로 보내지 않는다)
  fd.append('file', new Blob([buf], { type: mime }), name);
  fd.append('uploadPath', 'priming');
  fd.append('fileName', name);
  const res = await _fetch()(`${UPLOAD}/api/file-stream-upload`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(120000) });
  const text = await res.text(); let j = null; try { j = JSON.parse(text); } catch {}
  const code = j ? Number(j.code != null ? j.code : res.status) : res.status;
  const url = j && j.data && (j.data.downloadUrl || j.data.fileUrl || j.data.url);
  if ((code === 200 || j && j.success) && url) return { ok: true, url };
  return { ok: false, code, ...explain(code, j ? (j.msg || '') : scrub(text, key)), error: `그림 올리기 실패 — ${explain(code, j ? (j.msg || '') : '').error}` };
}

async function createTask(model, input, key) {
  for (let tries = 0; ; tries++) {
    const r = await call('POST', `${API}/api/v1/jobs/createTask`, { model, input }, { key });
    if (r.code === 200 && r.data && r.data.taskId) return { ok: true, taskId: r.data.taskId };
    const x = explain(r.code, r.msg);
    if (x.retry && tries < 3) { await sleep(5000 * (tries + 1)); continue; }
    return { ok: false, code: r.code, ...x };
  }
}

function _resultUrls(d) {
  let rj = d && d.resultJson;
  if (typeof rj === 'string') { try { rj = JSON.parse(rj); } catch { rj = null; } }
  // 일반 꼴 {resultUrls:[]} · Veo 1080p 이상 {data:{result_urls}} (문서가 두 꼴을 함께 적는다) · 성공 때 같이 오는 response 객체
  const urls = (rj && (rj.resultUrls || rj.result_urls || (rj.data && (rj.data.result_urls || rj.data.resultUrls)) || rj.urls))
    || (d && d.response && (d.response.resultUrls || d.response.result_urls)) || (d && d.resultUrls) || [];
  return (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
}

/** 작업이 끝날 때까지 묻는다 → { ok, urls } | { ok:false, error } */
async function waitTask(taskId, { key, abortSignal, timeoutMs = 15 * 60 * 1000, everyMs = 4000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let miss = 0;
  while (Date.now() < deadline) {
    if (abortSignal && abortSignal()) return { ok: false, error: '중단됨' };
    await sleep(everyMs);
    let r; try { r = await call('GET', `${API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, null, { key, timeoutMs: 30000 }); }
    catch (e) { if (++miss > 10) return { ok: false, error: '상태 조회 실패: ' + scrub(e && e.message) }; continue; }
    if (r.code !== 200) { const x = explain(r.code, r.msg); if (x.fatal) return { ok: false, ...x }; if (++miss > 10) return { ok: false, ...x }; continue; }
    miss = 0;
    const d = r.data || {};
    const st = String(d.state || d.status || '').toLowerCase();
    if (st === 'success') {
      const urls = _resultUrls(d);
      return urls.length ? { ok: true, urls } : { ok: false, error: '결과 주소가 없습니다' };
    }
    if (st === 'fail' || st === 'failed' || st === 'error') return { ok: false, error: `생성 실패${d.failCode ? ` (${d.failCode})` : ''}${d.failMsg ? ' · ' + scrub(d.failMsg) : ''}` };
  }
  return { ok: false, error: `시간 초과(${Math.round(timeoutMs / 60000)}분)` };
}

async function download(url, outPath) {
  const res = await _fetch()(url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`결과 받기 실패(${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`받은 파일이 너무 작습니다(${buf.length}바이트)`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return outPath;
}

// 그림 확장자는 받은 주소에서(없으면 .png)
function _imgExt(url) { const m = /\.(png|jpe?g|webp)(?:\?|$)/i.exec(String(url || '')); return m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '.png'; }

/** 글 → 그림 파일 { ok, path } | { ok:false, error, fatal? } */
async function generateImageToFile({ model, prompt, aspect, outPathNoExt, abortSignal }) {
  const KM = require('./kie-models');
  const key = kieKey(); if (!key) return { ok: false, error: 'kie.ai API 키 없음', fatal: 'kie 키 없음' };
  try {
    const input = KM.buildImageInput(model, { prompt, aspect });
    const c = await createTask(model.model, input, key);
    if (!c.ok) return c;
    const w = await waitTask(c.taskId, { key, abortSignal, timeoutMs: 6 * 60 * 1000, everyMs: 3000 });
    if (!w.ok) return w;
    const out = outPathNoExt + _imgExt(w.urls[0]);
    await download(w.urls[0], out);
    return { ok: true, path: out, taskId: c.taskId };
  } catch (e) { return { ok: false, error: scrub(e && e.message, key) }; }
}

/** 그림 → 영상 파일 { ok, path } | { ok:false, error, fatal? } */
async function generateVideoToFile({ model, imagePath, prompt, aspect, durationSec, outputPath, abortSignal, logger }) {
  const KM = require('./kie-models');
  const key = kieKey(); if (!key) return { ok: false, error: 'kie.ai API 키 없음', fatal: 'kie 키 없음' };
  try {
    const up = await uploadFile(imagePath, key);
    if (!up.ok) return up;
    const input = KM.buildVideoInput(model, { prompt, aspect, durationSec, imageUrl: up.url });
    const c = await createTask(model.model, input, key);
    if (!c.ok) return c;
    const w = await waitTask(c.taskId, { key, abortSignal, timeoutMs: 20 * 60 * 1000, everyMs: 6000 });
    if (!w.ok) return w;
    await download(w.urls[0], outputPath);
    return { ok: true, path: outputPath, taskId: c.taskId };
  } catch (e) { return { ok: false, error: scrub(e && e.message, key) }; }
}

module.exports = { kieKey, hasKey, credits, uploadFile, createTask, waitTask, download, generateImageToFile, generateVideoToFile, explain, _resultUrls };
