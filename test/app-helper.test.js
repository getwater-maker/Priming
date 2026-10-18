'use strict';
/**
 * node test/app-helper.test.js — 💬 프로그램에 묻기(v0.9.77)
 *   · 프롬프트에 큐 상태·로그 끝·질문이 들어가고, 로그는 가려진다(키·이메일·유튜브 이름)
 *   · 긴 로그는 끝만(줄 중간에서 시작하지 않음) · 앞선 대화는 3쌍까지
 *   · 실제로 보내는 모델 = Sonnet(안 골랐을 때) / 고른 모델이 이긴다 · 화면·IPC 연결(소스 점검)
 *   ⛔ 진짜 키·요금 없음 — global.__claudeApiTest 가짜만
 */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const ROOT = path.join(__dirname, '..'); const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const AH = require('../core/app-helper');

console.log('[1] 프롬프트 조립');
const qdto = { longform: { items: [
  { title: '[다산_1026] 전화', status: 'done', upload: { state: 'done' }, active: false },
  { title: '[다산_1028] 칭찬', status: 'idle', active: true },
  { title: '[다산_1102] 모임', status: 'interrupted', active: false },
] } };
const log = '[19:53:35] ⏹ 중단 요청 — 현재 단계 마치는 대로 멈춥니다\n[19:56:32] ✗ G28 실패: 생성 크레딧이 부족합니다(402)\nsk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV 와 hanlsori@getwater.kr\n';
const P = AH.buildPrompt({ question: '1028 은 왜 진행을 안 했어?', logText: log, queue: qdto, version: '0.9.77', now: '2026-10-18 20:00:00' });
ok(P.text.includes('[다산_1028] 칭찬 — 대기') && P.text.includes('[다산_1026] 전화 — 완료') && /1102\] 모임 — 중단됨/.test(P.text), '큐 상태가 상태 이름과 함께 들어간다');
ok(P.text.includes('⏹ 중단 요청') && P.text.includes('402'), '로그 줄이 들어간다');
ok(P.text.endsWith('1028 은 왜 진행을 안 했어?'), '질문이 맨 끝');
ok(!/sk-ant-api03|hanlsori@/.test(P.text), '🔐 키·이메일은 가려진다(log-scrub)');
ok(/읽기 전용/.test(P.system) && /KST/.test(P.system), '시스템 글: 읽기 전용·KST');

console.log('[2] 길이·이력 한도');
const big = Array.from({ length: 4000 }, (_, i) => `[10:00:00] 줄 ${i} 가나다라마바사아자차카타파하`).join('\n');
const P2 = AH.buildPrompt({ question: 'q', logText: big, queue: null, version: '1' });
ok(P2.text.length < AH.LOG_CHARS + 3000, `로그는 끝 ${AH.LOG_CHARS}자만 (프롬프트 ${P2.text.length}자)`);
ok(P2.text.includes('줄 3999') && !P2.text.includes('줄 0 '), '끝부분이 남고 앞부분이 잘린다');
ok(/\n\[10:00:00\] 줄 \d+/.test(P2.text) && !/\[오늘 로그[^\n]*\n[^\[]/.test(P2.text.replace(/\[오늘 로그[^\n]*\n\n/, '[오늘 로그 —]\n[')), '로그가 줄 중간에서 시작하지 않는다');
const hist = Array.from({ length: 6 }, (_, i) => ({ q: 'Q' + i, a: 'A' + i }));
const P3 = AH.buildPrompt({ question: 'q', logText: '', queue: null, version: '1', history: hist });
ok(P3.text.includes('Q5') && P3.text.includes('Q3') && !P3.text.includes('Q2'), '앞선 대화는 마지막 3쌍');
ok(AH.buildPrompt({ question: 'x'.repeat(5000), logText: '', queue: null }).question.length === AH.MAX_Q, '질문은 상한');
ok(AH.queueSummary({ longform: { items: [] } }).includes('비어'), '빈 큐 문구');

console.log('[3] 실제로 보내는 모델');
process.env.PM_UI_SMOKE = '1';
const sent = [];
const mk = (uses) => ({ cfg: { key: 'TEST', model: 'claude-opus-5-5', uses }, fetch: async (_u, opt) => { const b = JSON.parse(opt.body); sent.push(b.model); const body = { model: b.model, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }; return { ok: true, status: 200, text: async () => JSON.stringify(body) }; } });
const CA = require('../core/claude-api');
(async () => {
  ok(!!CA.USES.helper, 'CA.USES 에 helper 쓰임이 있다');
  global.__claudeApiTest = mk({});
  let c = CA.cfg();
  await CA.ask({ use: 'helper', model: c.uses.helper || AH.HELPER_MODEL, text: 'x' });
  ok(sent[0] === 'claude-sonnet-5-5', `안 골랐을 때 = Sonnet (${sent[0]}) — 기본 Opus 로 떨어지지 않는다`);
  global.__claudeApiTest = mk({ helper: 'claude-opus-5-5' });
  c = CA.cfg();
  await CA.ask({ use: 'helper', model: c.uses.helper || AH.HELPER_MODEL, text: 'x' });
  ok(sent[1] === 'claude-opus-5-5', `설정에서 고른 모델이 이긴다 (${sent[1]})`);
  ok(!/haiku/i.test(AH.HELPER_MODEL) && !Object.keys(CA.MODELS).some((m) => /haiku/i.test(m)), '⛔ haiku 아님');

  console.log('[4] 연결(소스 점검)');
  const M = read('main.js'), A = read('renderer/src/App.jsx'), PL = read('preload.js');
  ok(/ipcMain\.handle\('app-ask'/.test(M) && /CA\.ask\(\{ use: 'helper', model: c\.uses\.helper \|\| AH\.HELPER_MODEL/.test(M), "main — app-ask 가 CA.ask({use:'helper'}) 한 입구");
  ok(/buildPrompt\(\{ question: q, logText, queue: queueDTO\(\)/.test(M), 'main — 큐는 queueDTO 에서 직접(렌더러 값을 믿지 않는다)');
  ok(/appAsk: \(a\) => ipcRenderer\.invoke\('app-ask', a\)/.test(PL), 'preload — appAsk');
  ok(/data-testid="logtab-ask"/.test(A) && /api\.appAsk\(/.test(A), '화면 — 로그 상자 💬 질문 탭');
  ok(!/app-ask/.test(M.match(/const LIC_OPEN = [^\n]+/)[0]), '로그인 전에는 열리지 않는다(LIC_OPEN 밖)');
  console.log(`\n${fail ? '❌' : '✅'} app-helper ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
