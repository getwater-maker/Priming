'use strict';
// 🤖 Claude API 한 곳(core/claude-api · v0.7.94) — 가짜 fetch 로만(로이 충전금 · 진짜 API 금지)
//   ① 요청 모양(키 헤더·버전·fallbacks·모델) ② 답 읽기(thinking 건너뛰기·거절·오류 글에 키 없음) ③ 끊어 읽기·맞춤법이 API 를 탄다
//   ④ 이미지/영상 프롬프트 「한쪽만 다시 쓰기」 요청서·적용 ⑤ Ollama·Gemini 글 생성이 코드에서 빠졌다
process.env.PM_UI_SMOKE = '1';
delete process.env.PM_CLAUDE_EXE;
const fs = require('fs');
const path = require('path');
const os = require('os');
process.env.PM_CAPMARKS_FILE = path.join(os.tmpdir(), `claude-api-test-capmarks-${process.pid}.json`);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const KEY = 'sk-ant-test-0123456789abcdef';
const calls = [];
let reply = null;   // (body) => {status, json}
const fakeFetch = async (url, opt) => {
  const body = JSON.parse(opt.body); calls.push({ url, opt, body });
  const r = reply(body);
  return { status: r.status, text: async () => JSON.stringify(r.json), headers: { get: () => null } };
};
const msg = (text, extra = {}) => ({ status: 200, json: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }], usage: { input_tokens: 1000, output_tokens: 500 }, ...extra } });

(async () => {
  const CA = require('../core/claude-api');
  global.__claudeApiTest = { cfg: { key: '' }, fetch: fakeFetch };
  let r = await CA.ask({ text: 'hi' });
  ok(!r.ok && r.noKey && calls.length === 0, '키가 없으면 부르지 않는다');
  global.__claudeApiTest.cfg = { key: KEY };
  reply = () => msg('안녕');
  r = await CA.ask({ system: 'S', text: 'hi' });
  const c = calls[calls.length - 1];
  ok(r.ok && r.text === '안녕', 'thinking 블록은 건너뛰고 text 만');
  ok(c.url === 'https://api.anthropic.com/v1/messages' && c.opt.headers['x-api-key'] === KEY && c.opt.headers['anthropic-version'] === '2023-06-01', '요청: 주소 · x-api-key · anthropic-version');
  ok(c.body.model === 'claude-opus-5-5' && c.body.fallbacks === 'default' && /server-side-fallback-2026-07-01/.test(c.opt.headers['anthropic-beta']) && c.body.system === 'S', '요청: 기본 모델 Opus 5.5 · 거절 대체(fallbacks) · system');
  ok(Math.abs(r.costUsd - (1000 * 4 + 500 * 20) / 1e6) < 1e-9, '비용 추정 = Opus 5.5 단가($4/$20)');
  global.__claudeApiTest.cfg = { key: KEY, model: 'claude-sonnet-5-5' };
  r = await CA.ask({ text: 'hi' });
  ok(calls[calls.length - 1].body.model === 'claude-sonnet-5-5', '설정한 모델(Sonnet 5.5)로 보낸다');
  global.__claudeApiTest.cfg = { key: KEY, model: 'claude-haiku-5-5' };
  await CA.ask({ text: 'hi' });
  ok(calls[calls.length - 1].body.model === 'claude-opus-5-5', '목록에 없는 모델(haiku)은 기본으로 — 끊어 읽기에 haiku 금지');
  global.__claudeApiTest.cfg = { key: KEY };
  reply = () => ({ status: 200, json: { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] } });
  r = await CA.ask({ text: 'x' });
  ok(!r.ok && /거절/.test(r.error), '거절(refusal)은 사람 말 오류');
  reply = () => ({ status: 401, json: { error: { message: 'invalid x-api-key ' + KEY } } });
  r = await CA.ask({ text: 'x' });
  ok(!r.ok && /키가 틀렸습니다/.test(r.error) && !r.error.includes(KEY), '401 → 키 틀림 · 오류 글에 키 원문 없음');
  reply = () => ({ status: 400, json: { error: { message: 'Your credit balance is too low' } } });
  r = await CA.ask({ text: 'x' });
  ok(!r.ok && /충전금이 부족/.test(r.error), '충전금 부족 → 알아듣는 말');
  ok(JSON.stringify(CA.parseJson('```json\n{"ok":false,"issues":["글자"]}\n```')) === '{"ok":false,"issues":["글자"]}' && CA.parseJson('[1,2]').length === 2 && CA.parseJson('없음') === null, 'parseJson — 펜스·배열·실패');

  // ③ 맞춤법 · 끊어 읽기 = runClaude → API(가짜 claude CLI 가 없을 때)
  const SC = require('../core/spell-check');
  reply = (b) => msg(b.system === SC.SYSTEM ? '[{"틀림":"느겼습니다","바름":"느꼈습니다"}]' : '1\t등에 진 / 빈 지게가');
  r = await SC.check('나는 그렇게 느겼습니다.');
  ok(r.ok && r.items.length === 1 && r.items[0]['바름'] === '느꼈습니다' && r.via === 'api', '맞춤법 검사가 API 로(같은 파서)');
  const CM = require('../core/cap-marks');
  const cm = await CM.run(['등에 진 빈 지게가']);
  ok(cm.done === 1 && calls[calls.length - 1].body.system === CM.SYSTEM, '끊어 읽기가 API 로(같은 지시문)');
  try { fs.unlinkSync(process.env.PM_CAPMARKS_FILE); } catch (_) {}
  // API 가 실패하면 CLI 로 한 번 더(진짜 claude CLI 를 부르게 되므로 실행하지 않고 소스로 확인)
  const SCsrc = fs.readFileSync(path.join(__dirname, '..', 'core', 'spell-check.js'), 'utf8');
  ok(/if \(a\.ok\) \{[\s\S]{0,400}const c = await runCli\(input, o\);/.test(SCsrc) && /if \(!o\.exe && !process\.env\.PM_CLAUDE_EXE && CA\.available\(\)\)/.test(SCsrc), 'API 실패 → CLI 재시도 · 가짜 claude(테스트)를 주면 API 를 건너뛴다');

  // ④ 프롬프트 한쪽만 다시 쓰기
  const PIO = require('../core/prompt-io');
  const g1 = { num: 1, imagePrompt: 'old img 1', videoPrompt: 'old vid 1', isI2V: true };
  const g2 = { num: 2, imagePrompt: 'old img 2', videoPrompt: '', isI2V: false };
  const pr = { shortsNum: 1, aspect: '16:9', groups: [g1, g2], getSentencesOfGroup: (g) => [{ text: '대본 ' + g.num }] };
  const reqI = PIO.buildPromptRequestText([pr], { only: 'image' });
  ok(/지금 프롬프트: old img 1/.test(reqI) && !/^영상:/m.test(reqI), '이미지만: 지금 프롬프트를 보여 주고 영상 줄은 묻지 않는다');
  const reqV = PIO.buildPromptRequestText([pr], { only: 'video', onlyKeys: new Set(['1-2']) });
  ok(/이미지 프롬프트: old img 2/.test(reqV) && /\(영상\)/.test(reqV) && !/^이미지:/m.test(reqV), '영상만: 그림 프롬프트를 근거로 · 고른 그룹은 영상 그룹으로 · 이미지 줄 없음');
  const ans = '## [1-1]\n이미지: new img 1\n영상: new vid 1\n## [1-2]\n이미지: new img 2\n영상: new vid 2\n';
  PIO.applyPromptsToProjects([pr], ans, { only: 'image' });
  ok(g1.imagePrompt === 'new img 1' && g1.videoPrompt === 'old vid 1' && g2.videoPrompt === '', '이미지만 적용 — 영상 프롬프트는 그대로');
  PIO.applyPromptsToProjects([pr], ans, { only: 'video' });
  ok(g2.videoPrompt === 'new vid 2' && g2.isI2V && g2.imagePrompt === 'new img 2', '영상만 적용 — 이미지 프롬프트는 그대로');
  reply = () => msg('ok');
  ok(await PIO.callLlmTextApi('ollama', '', 'q') === 'ok' && calls[calls.length - 1].url.includes('anthropic'), 'callLlmTextApi 는 무엇을 넘겨도 Claude 로');

  // ⑤ Ollama·Gemini 글 생성 제거 · 연결
  const root = path.join(__dirname, '..');
  const M = fs.readFileSync(path.join(root, 'main.js'), 'utf8'), A = fs.readFileSync(path.join(root, 'renderer/src/App.jsx'), 'utf8'), PL = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  ok(!/ollamaTags|ollama-config|callLlmTextApi\('gemini'/.test(M) && !/getOllamaConfig|openOllama|ollamaOpen/.test(A + PL) && !fs.existsSync(path.join(root, 'core/ollama-config.js')), 'Ollama·Gemini 글 생성 코드가 없다(main · 화면 · preload)');
  ok(/runRewritePrompts\('image'\)/.test(A) && /runRewritePrompts\('video'\)/.test(A) && /data-testid="vision-check"/.test(A) && /data-testid="vd-wish-btn"/.test(A) && /data-testid="claude-model"/.test(A), '화면: 🔁 이미지·영상 프롬프트 · 🔍 검수 · 🎨 설명 만들기 · 모델 고르기');
  for (const ch of ['claude-vision-check', 'claude-vision-mark', 'claude-voice-instruct', 'book-claude-blurb', 'book-claude-proofread']) ok(new RegExp(`ipcMain\\.handle\\('${ch}'`).test(M) && PL.includes(`'${ch}'`), 'IPC 연결: ' + ch);
  ok(/mode === 'image'/.test(M) && /undoPush\(what\)/.test(M), '다시 쓰기는 되돌리기(Ctrl+Z) 기록을 남긴다');
  ok(/claude-vision-mark[\s\S]{0,400}_userAttached\(g, 'image'\)/.test(M), '검수 「다시 그리기」는 사람이 첨부한 그림을 건너뛴다');
  console.log(`\n${fail ? '❌' : '✅'} claude-api — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
