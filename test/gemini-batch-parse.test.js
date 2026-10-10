// 나노바나나 배치 회수 응답 파싱 — 2026-10-07 실측 구조(response.inlinedResponses.inlinedResponses[])를 고정한다.
// (옛 코드는 한 겹 덜 들어가 SUCCEEDED 인데 0장 저장이 됐다.)
'use strict';
const GI = require('../core/gemini-image');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const png = Buffer.from('iVBORw0KGgo=', 'base64').toString('base64');
const item = (k, mime) => ({ response: { candidates: [{ content: { parts: [{ inlineData: { mimeType: mime, data: png } }] } }] }, metadata: { key: k } });
async function run(json) {
  const real = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });
  try { return await GI.checkBatch({ batchName: 'batches/x', key: 'k' }); } finally { global.fetch = real; }
}
(async () => {
  let c = await run({ done: true, metadata: { state: 'BATCH_STATE_SUCCEEDED' }, response: { inlinedResponses: { inlinedResponses: [item('t1', 'image/jpeg'), item('t2', 'image/png')] } } });
  ok(c.ok && c.done && c.results.length === 2 && c.results[0].key === 't1' && c.results[0].ext === 'jpg' && c.results[1].ext === 'png', '한 겹 감싼 응답(실측 구조)에서 2장');
  c = await run({ done: true, metadata: { state: 'BATCH_STATE_SUCCEEDED' }, response: { inlinedResponses: [item('a', 'image/png')] } });
  ok(c.results.length === 1, '배열 그대로인 응답도 읽는다');
  c = await run({ done: true, metadata: { state: 'BATCH_STATE_SUCCEEDED', output: { inlinedResponses: { inlinedResponses: [item('m', 'image/png')] } } } });
  ok(c.results.length === 1, 'metadata.output 사본만 있어도 읽는다');
  c = await run({ done: false, metadata: { state: 'BATCH_STATE_RUNNING' } });
  ok(c.ok && !c.done && c.results.length === 0, '진행 중이면 done=false');
  // ── 🔴 v0.7.89 — 완료된 배치는 569MB(그림 두 벌): 상태는 아주 작게, 결과는 한 벌만, 길게·재시도 (아내 PC 2026-10-10) ──
  async function runSeq(handler) {
    const real = global.fetch, calls = [];
    global.fetch = async (url) => { calls.push(String(url)); return handler(String(url), calls.length); };
    try { const r = await GI.checkBatch({ batchName: 'batches/x', key: 'k' }); return { r, calls }; } finally { global.fetch = real; }
  }
  const jr = (o, st = 200) => ({ ok: st < 400, status: st, text: async () => JSON.stringify(o) });
  const isStatus = (u) => /fields=name%2Cdone%2Cerror/.test(u);
  GI._tuning.retryMs = 1;
  let q = await runSeq((u) => (isStatus(u) ? jr({ name: 'b', done: true }) : jr({ response: { inlinedResponses: { inlinedResponses: [item('a', 'image/png'), item('b', 'image/png')] } } })));
  ok(q.calls.length === 2 && isStatus(q.calls[0]) && /fields=response/.test(q.calls[1]), '끝났으면 ① 상태(name,done,error) → ② 결과만(response) 두 번만 부른다');
  ok(q.r.ok && q.r.done && q.r.results.length === 2, '결과 2장을 읽는다');
  q = await runSeq(() => jr({ name: 'b' }));
  ok(q.calls.length === 1 && q.r.ok && !q.r.done, '진행 중이면 작은 상태 한 번만 — 큰 결과를 받지 않는다');
  q = await runSeq(() => jr({ name: 'b', done: true, error: { message: 'boom' } }));
  ok(q.calls.length === 1 && q.r.done && q.r.error === 'boom' && !/SUCCEEDED/.test(q.r.state), '실패한 배치는 결과를 받지 않고 실패로 돌려준다');
  let n = 0;
  q = await runSeq((u) => { if (isStatus(u)) return jr({ done: true }); n++; return n < 3 ? jr({ error: { message: 'x' } }, 503) : jr({ response: { inlinedResponses: { inlinedResponses: [item('z', 'image/png')] } } }); });
  ok(q.r.ok && q.r.results.length === 1 && n === 3, '결과 받기가 두 번 실패해도 세 번째에 받는다(재시도)');
  q = await runSeq((u) => (isStatus(u) ? jr({ done: true }) : jr({ error: { message: 'down' } }, 503)));
  ok(!q.r.ok && /결과 받기 실패/.test(q.r.error), '끝내 못 받으면 ok=false + 사람 말 오류(앱이 「다시 누르면 이어서」로 안내)');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'core', 'gemini-image.js'), 'utf8');
  ok(/BATCH_STATUS_TIMEOUT_MS = 60000/.test(src) && /BATCH_RESULT_TIMEOUT_MS = 20 \* 60000/.test(src), '시간 제한: 상태 60초 · 결과 20분(옛 180초 일괄 — 569MB 를 못 받았다)');
  const mainSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
  ok(/GEMINI_BATCH_CHUNK = 40/.test(mainSrc) && /chunks\.push\(targets\.slice\(i, i \+ GEMINI_BATCH_CHUNK\)\)/.test(mainSrc), '큰 배치는 40장씩 나눠 제출한다(응답 크기 · V8 문자열 한도)');
  ok(/못 받았습니다\(배치/.test(mainSrc) && /못 받은 배치 \$\{_bLeft\}개가 남았습니다/.test(mainSrc), '못 받은 배치가 남으면 「완료」가 아니라 다시 누르라고 알린다');
  // 받는 동안 조용하면 멈춘 줄 안다(아내 PC) — 결과 받기 직전에만 알림 콜백이 불린다
  let told = 0;
  const real2 = global.fetch;
  global.fetch = async (u) => (isStatus(String(u)) ? jr({ done: true }) : jr({ response: { inlinedResponses: { inlinedResponses: [item('t', 'image/png')] } } }));
  await GI.checkBatch({ batchName: 'batches/x', key: 'k', onResultStart: () => { told++; } });
  global.fetch = async () => jr({ name: 'b' });
  await GI.checkBatch({ batchName: 'batches/x', key: 'k', onResultStart: () => { told += 10; } });
  global.fetch = real2;
  ok(told === 1, '결과를 받기 직전에만 안내 콜백이 불린다(진행 중 상태 확인에는 안 불림)');
  ok(/onResultStart: \(\) => \{ if \(!_told\)/.test(mainSrc) && /그림을 받는 중입니다/.test(mainSrc), 'main 이 받는 중 안내 줄을 남긴다');
  console.log(`\n${fail ? '❌' : '✅'} gemini-batch-parse — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
