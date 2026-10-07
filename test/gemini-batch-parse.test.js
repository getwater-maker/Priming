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
  console.log(`\n${fail ? '❌' : '✅'} gemini-batch-parse — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
