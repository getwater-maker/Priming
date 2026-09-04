'use strict';
/**
 * test/flow-connect.test.js — Flow 접속 대기 회귀 (2026-09-04)
 *
 * 🔴 실사고: 헤더에서 Flow 를 골라 이미지를 만들었는데 Flow 창이 뜨고 아무것도 안 만든 뒤 Genspark 로 넘어갔다.
 *   로그: `[Flow] 계정 1 실행 오류: page.goto: Timeout 30000ms exceeded. … waiting until "networkidle"`.
 *   Flow SPA 는 백그라운드 통신이 끊이지 않아 networkidle(0.5초 무통신)에 30초 안에 못 닿는 날이 있다
 *   (정상일 때도 11~14초 — 09-03 로그). Genspark 전환은 순환의 설계된 이어받기이지 버그가 아니다.
 *
 * 🔑 앱 원문을 그대로 돌린다 — page 만 가짜로 주입해 _gotoFlow/_waitFlowReady 를 실행한다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0, fails = 0;
function ok(label, fn) { n++; try { fn(); console.log('  ✓ [' + n + '] ' + label); } catch (e) { fails++; console.log('  ✗ [' + n + '] ' + label + '\n      ' + e.message); } }
async function okAsync(label, fn) { n++; try { await fn(); console.log('  ✓ [' + n + '] ' + label); } catch (e) { fails++; console.log('  ✗ [' + n + '] ' + label + '\n      ' + e.message); } }

const ROOT = path.join(__dirname, '..');
const ENGINE = fs.readFileSync(path.join(ROOT, 'flow-engine.js'), 'utf8').replace(/\r\n/g, '\n');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const { FlowAutomator } = require(path.join(ROOT, 'flow-engine.js'));

/** 가짜 page — goto 가 어떻게 불리는지 기록하고, evaluate 는 준비 신호를 흉내낸다. */
function fakePage({ url = 'https://labs.google/fx/ko/tools/flow', readyAfter = 0, gotoFail = false } = {}) {
  let evalCount = 0;
  return {
    calls: [],
    url: () => url,
    async goto(u, opts) { this.calls.push({ u, opts }); if (gotoFail) throw new Error('page.goto: Timeout 60000ms exceeded.'); },
    async waitForTimeout() {},
    async evaluate(fn) { evalCount++; return evalCount > readyAfter ? '홈(새 프로젝트)' : null; },
  };
}
function mk(page) { const eng = Object.create(FlowAutomator.prototype); eng.page = page; eng.logs = []; eng.log = (m) => eng.logs.push(String(m)); return eng; }

console.log('\n[1] 접속 대기 방식 — 원문 대조');
ok('goto(FLOW_URL) 에 networkidle 이 남아 있지 않다 (실사고 원인)', () => {
  assert.ok(!/this.page.goto\(FLOW_URL,\s*\{\s*waitUntil:\s*'networkidle'/.test(ENGINE), 'networkidle goto 잔존');
});
ok('reload 도 networkidle 을 쓰지 않는다', () => { assert.ok(!/reload\(\{\s*waitUntil:\s*'networkidle'/.test(ENGINE)); });
ok('FLOW_URL 로 가는 곳은 전부 _gotoFlow 를 거친다 (직접 goto 0곳)', () => {
  assert.strictEqual((ENGINE.match(/this\.page\.goto\(FLOW_URL/g) || []).length, 1, '_gotoFlow 안의 1곳만 허용');
  assert.ok((ENGINE.match(/await this\._gotoFlow\(/g) || []).length >= 4, '호출 4곳(로그인·접속·403·메인복귀)');
});
ok('_gotoFlow 는 load 까지만 기다리고 상한을 60초로 둔다', () => {
  assert.ok(/goto\(FLOW_URL, \{ waitUntil: 'load', timeout: 60000 \}\)/.test(ENGINE));
});

console.log('\n[2] _gotoFlow / _waitFlowReady 원문 실행');
await0();
async function await0() {
  await okAsync('정상 접속: load 로 goto 하고 준비 신호를 보면 로그에 남는다', async () => {
    const eng = mk(fakePage());
    await eng._gotoFlow('접속');
    assert.strictEqual(eng.page.calls.length, 1);
    assert.strictEqual(eng.page.calls[0].opts.waitUntil, 'load');
    assert.ok(eng.logs.some((l) => l.includes('접속 완료(접속)') && l.includes('홈(새 프로젝트)')), eng.logs.join(' | '));
  });
  await okAsync('준비 신호가 늦게 와도(폴링 3회 뒤) 잡는다', async () => {
    const eng = mk(fakePage({ readyAfter: 3 }));
    const sig = await eng._waitFlowReady(5000);
    assert.strictEqual(sig, '홈(새 프로젝트)');
  });
  await okAsync('로그인 화면(accounts.google)도 준비 신호로 본다 — evaluate 없이', async () => {
    const eng = mk(fakePage({ url: 'https://accounts.google.com/signin' }));
    eng.page.evaluate = async () => { throw new Error('evaluate 를 부르면 안 된다'); };
    assert.strictEqual(await eng._waitFlowReady(2000), '로그인 화면');
  });
  await okAsync('🔴 goto 가 타임아웃으로 던져도 _gotoFlow 는 던지지 않는다 (옛 코드는 여기서 계정 전체가 죽었다)', async () => {
    const eng = mk(fakePage({ gotoFail: true }));
    await eng._gotoFlow('접속');
    assert.ok(eng.logs.some((l) => l.includes('페이지 로드가 늦습니다')), eng.logs.join(' | '));
    assert.ok(eng.logs.some((l) => l.includes('접속 완료')), '화면이 떠 있으면 그대로 진행한다');
  });
  await okAsync('준비 신호를 끝내 못 봐도 던지지 않고 경고만 남긴다 (fail-open)', async () => {
    const eng = mk(fakePage({ readyAfter: 1e9 }));
    eng._waitFlowReady = FlowAutomator.prototype._waitFlowReady;
    const sig = await eng._waitFlowReady(300);
    assert.strictEqual(sig, null);
  });
  await okAsync('evaluate 가 예외를 내도(페이지 전환 중) 판정은 계속된다', async () => {
    const eng = mk(fakePage());
    let k = 0; eng.page.evaluate = async () => { k++; if (k < 3) throw new Error('Execution context was destroyed'); return '프롬프트 입력칸'; };
    assert.strictEqual(await eng._waitFlowReady(5000), '프롬프트 입력칸');
  });

  console.log('\n[3] main.js — 엔진 로그가 이미지 경로에서도 파일에 남는다');
  ok('hookFlowEngLog 헬퍼가 있고 이미지·비디오 두 경로가 모두 부른다', () => {
    assert.ok(/function hookFlowEngLog\(eng\)/.test(MAIN));
    assert.ok((MAIN.match(/hookFlowEngLog\(eng\)/g) || []).length >= 2, '호출 2곳 이상');
  });
  ok('runFlowImages 본문 안에서 후킹한다 (09-04 사고 때 접속 단계 로그가 파일에 없었다)', () => {
    const i = MAIN.indexOf('async function runFlowImages(');
    const j = MAIN.indexOf('\nasync function ', i + 10);
    const body = MAIN.slice(i, j > 0 ? j : undefined);
    assert.ok(body.includes('hookFlowEngLog(eng)'), 'runFlowImages 에 후킹 없음');
  });
  ok('후킹은 한 번만 (재사용 인스턴스 중복 기록 방지)', () => { assert.ok(/eng\._appLogHooked\)/.test(MAIN) || /eng\._appLogHooked \|\|/.test(MAIN)); });

  console.log(`\n${fails ? '❌' : '✅'} flow-connect: ${n - fails}/${n}`);
  process.exit(fails ? 1 : 0);
}
