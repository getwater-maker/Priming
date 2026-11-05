'use strict';
/**
 * 가짜 코덱스(test/codex-image.test.js · 무인 주문 E2E) — `node fake-codex.js exec --json … -` 꼴로 불린다. 진짜 코덱스·할당량을 쓰지 않는다.
 *   PM_CODEX_HOME 아래에 generated_images/<id>/x.png · sessions/2026/11/05/rollout-…-<id>.jsonl 을 쓴다(진짜 코덱스와 같은 자리).
 *   환경: FAKE_CODEX_PNG(복사할 그림) · FAKE_CODEX_PNG_T(투명 배경 요청일 때) · FAKE_USED(주간 %) · FAKE_CREDITS=1 · FAKE_FAIL_AFTER=n(n 장 뒤부터 실패) · FAKE_SLEEP_MS
 *   FAKE_LOG = 부를 때마다 { args, stdin, envKey } 를 한 줄씩 적는 파일(시험이 읽는다)
 */
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('codex-cli 0.0.1-fake\n'); process.exit(0); }
let input = '';
process.stdin.on('data', (b) => { input += b; });
process.stdin.on('end', async () => {
  const home = process.env.PM_CODEX_HOME;
  const cntFile = path.join(home, 'fake-count.txt');
  let n = 0; try { n = +fs.readFileSync(cntFile, 'utf8') || 0; } catch (_) {}
  n++; fs.writeFileSync(cntFile, String(n));
  if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, stdin: input, envKey: !!(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY), n }) + '\n');
  if (+process.env.FAKE_SLEEP_MS) await new Promise((r) => setTimeout(r, +process.env.FAKE_SLEEP_MS));
  const tid = 'fake' + Date.now().toString(36) + n + Math.random().toString(36).slice(2, 6);
  process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: tid }) + '\n');
  const failAfter = process.env.FAKE_FAIL_AFTER != null && process.env.FAKE_FAIL_AFTER !== '' ? +process.env.FAKE_FAIL_AFTER : Infinity;
  const used = +(process.env.FAKE_USED || 10) + n * 0.05;
  const sd = path.join(home, 'sessions', '2026', '11', '05'); fs.mkdirSync(sd, { recursive: true });
  const rl = { limit_id: 'codex', primary: { used_percent: Math.round(used * 100) / 100, window_minutes: 10080, resets_at: 1794420405 }, secondary: null, credits: { has_credits: process.env.FAKE_CREDITS === '1', unlimited: false, balance: null }, plan_type: process.env.FAKE_PLAN || 'team' };
  fs.writeFileSync(path.join(sd, `rollout-2026-11-05T10-00-00-${tid}.jsonl`), [
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'custom_tool_call_output', output: [{ type: 'input_text', text: 'Wall time 1.5 seconds' }] } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 38000 } }, rate_limits: rl } }),
  ].join('\n') + '\n');
  if (n > failAfter) { process.stderr.write('fake failure\n'); process.exit(1); }
  const transparent = /"transparent_background":true/.test(input);
  const src = transparent && process.env.FAKE_CODEX_PNG_T ? process.env.FAKE_CODEX_PNG_T : process.env.FAKE_CODEX_PNG;
  const gd = path.join(home, 'generated_images', tid); fs.mkdirSync(gd, { recursive: true });
  fs.copyFileSync(src, path.join(gd, 'ig_' + n + '.png'));
  process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\n');
  process.exit(0);
});
