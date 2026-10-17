'use strict';
/**
 * node test/claude-uses.test.js — 🎯 Claude 쓰는 곳마다 모델(v0.9.67 · 로이 2026-10-17)
 *   · ask({use}) 가 그 쓰임에 고른 모델로 보낸다 · 고르지 않은 쓰임 = 기본 모델 · 직접 넘긴 model 이 이긴다
 *   · 쓰임 이름이 모든 Claude 입구에 달려 있다(소스 점검) · 설정 화면·IPC 연결
 *   ⛔ 진짜 키·요금 없음 — global.__claudeApiTest 가짜만
 */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
process.env.PM_UI_SMOKE = '1';
const sent = [];
global.__claudeApiTest = {
  cfg: { key: 'TEST', model: 'claude-opus-5-5', uses: { vision: 'claude-sonnet-5-5', spell: 'nope-model' } },
  fetch: async (_url, opt) => { sent.push(JSON.parse(opt.body).model); return { ok: true, status: 200, text: async () => JSON.stringify({ model: JSON.parse(opt.body).model, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }), json: async () => ({ model: JSON.parse(opt.body).model, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }) }; },
};
const CA = require('../core/claude-api');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

(async () => {
  console.log('[1] 쓰임별 모델 고르기');
  ok(Object.keys(CA.USES).length >= 8, `쓰임 ${Object.keys(CA.USES).length}개: ${Object.values(CA.USES).join(' · ')}`);
  ok(CA.modelFor('vision') === 'claude-sonnet-5-5', '그림 검수 = 고른 Sonnet');
  ok(CA.modelFor('prompt') === 'claude-opus-5-5', '고르지 않은 쓰임 = 기본(Opus)');
  ok(CA.modelFor('spell') === 'claude-opus-5-5', '없는 모델 이름이 저장돼 있으면 무시하고 기본');
  ok(CA.modelFor('vision', 'claude-opus-5-5') === 'claude-opus-5-5', '직접 넘긴 model 이 이긴다');
  ok(!Object.keys(CA.MODELS).some((m) => /haiku/i.test(m)), '⛔ haiku 는 목록에 없다(끊어 읽기 규칙)');
  const r1 = await CA.ask({ use: 'vision', text: 'x' }); const r2 = await CA.ask({ use: 'book', text: 'x' });
  ok(r1.ok && sent[0] === 'claude-sonnet-5-5' && r2.ok && sent[1] === 'claude-opus-5-5', `실제로 보낸 모델: ${sent.join(', ')}`);

  console.log('[2] 모든 입구에 쓰임 이름');
  const M = read('main.js');
  for (const [u, re] of [['vision', /CA\.ask\(\{ use: 'vision'/], ['prompt', /CA\.ask\(\{ use: 'prompt'/], ['voice', /ask\(\{ use: 'voice', label: '보이스디자인 설명'/], ['book(소개)', /CA\.ask\(\{ use: 'book', label: '책 소개'/], ['book(교정)', /CA\.ask\(\{ use: 'book', system: SC\.SYSTEM/], ['mail', /ask\(\{ use: 'mail', \.\.\.o, log \}\)/], ['voice(번역)', /label: '목소리 설명 번역', use: 'voice'/]]) ok(re.test(M), `main.js — ${u}`);
  ok(/use: opts\.use \|\| 'prompt'/.test(read('core/prompt-io.js')), 'prompt-io — 프롬프트(기본)');
  ok(/claude\.ask\(\{ use: 'recover'/.test(read('core/image-recovery.js')), 'image-recovery — 그림 프롬프트 고치기');
  ok(/use: o\.use \|\| 'spell'/.test(read('core/spell-check.js')), 'spell-check — 맞춤법(기본)');
  ok(/runClaude\(input, \{ use: 'capmarks'/.test(read('core/cap-marks.js')), 'cap-marks — 끊어 읽기');
  const nAsk = (M.match(/\bCA\.ask\(\{|claude-api'\)\.ask\(\{/g) || []).length;
  const nUse = (M.match(/\bCA\.ask\(\{ use: |claude-api'\)\.ask\(\{ use: /g) || []).length;
  ok(nAsk === nUse, `main.js 의 Claude 입구 ${nAsk}곳 모두 쓰임 이름이 있다(${nUse})`);

  console.log('[3] 설정 화면·IPC');
  ok(/uses: Object\.entries\(CA\.USES\)/.test(M) && /if \(use != null\) \{ const CA = require\('\.\/core\/claude-api'\)/.test(M), 'claude-key-get 이 쓰임 목록을, claude-key-save 가 쓰임별 모델을 다룬다');
  const A = read('renderer/src/App.jsx');
  ok(/data-testid="claude-uses"/.test(A) && /api\.claudeKeySave\(\{ use: u\.id, model: e\.target\.value \}\)/.test(A), '⚙ 설정 → 🔑 API 키 → Claude 카드에 쓰임마다 모델 고르기');
  console.log(`\n${fail ? '❌' : '✅'} claude-uses ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
