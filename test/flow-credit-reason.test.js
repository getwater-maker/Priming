/**
 * v0.4.5 — ① Flow 크레딧 소진 reason 이 run() 반환까지 살아오는가 ② Grok tos-gate 진단
 *
 * 🔴 실사고(2026-09-14): 엔진은 'credit-exhausted' 를 정확히 감지해 이벤트로 보냈는데
 *    run() 반환의 reason 이 'rate-limit' 로 **하드코딩**돼 있어, main 의 6시간 휴식 분기가
 *    영원히 false 였다 → 크레딧 없는 계정이 30분마다 되살아나 헛돌이.
 *    로그에 그 모순이 그대로 찍혔다:
 *      💳 프로필 ... Flow 크레딧 소진 → ⚠ Flow 계정 "Flow 5" 한도/차단 — 30분 쿨다운
 *
 * 🔑 이 테스트는 **원문을 그대로 실행한다**(로직을 복사해 두면 앱과 갈라져도 통과한다).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const norm = (s) => s.replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} (기대 ${JSON.stringify(expected)} / 실제 ${JSON.stringify(actual)})`);
}

// ── 원문에서 run() 반환의 reason 표현식을 뽑아 실행 가능한 함수로 ──────────────
function extractReasonExpr(src) {
  const s = norm(src);
  const m = s.match(/reason:\s*(this\._proactiveSwitchTriggered[\s\S]*?'completed'\)),/);
  if (!m) throw new Error('flow-engine.js 에서 run() 반환의 reason 표현식을 못 찾음');
  return m[1];
}
function makeReasonFn(expr) {
  // eslint-disable-next-line no-new-func
  return new Function(`return (${expr});`);
}

console.log('\n[1] explainNoChipBar — 원문 실행 (Grok 칩바를 못 찾은 진짜 이유)');
{
  const { explainNoChipBar } = require('../grok-engine.js');

  // 🔴 실사고 로그에 그대로 찍힌 덤프
  const real = { noForm: true, url: 'https://grok.com/tos-gate' };
  const whyReal = explainNoChipBar(real);
  ok(/약관/.test(whyReal), '실사고 덤프(tos-gate) → 약관 동의 화면이라고 말한다');
  ok(!/UI 가 또 바뀐/.test(whyReal), '실사고 덤프 → "UI 가 또 바뀐" 이라고 오도하지 않는다');
  ok(/UI 변경이 아닙니다/.test(whyReal), '실사고 덤프 → UI 변경이 아님을 못박는다');

  ok(/로그인/.test(explainNoChipBar({ noForm: true, url: 'https://accounts.x.ai/sign-in?x=1' })),
    '로그인 화면 → 로그인 안내');
  ok(/폼이 없는/.test(explainNoChipBar({ noForm: true, url: 'https://grok.com/maintenance' })),
    '낯선 noForm 화면 → 폼 없음 + 주소를 알려준다');

  // ⚠ 모르는 것을 아는 척하지 않는다 — 폼이 멀쩡한데 칩만 없으면 옛 진단(UI 변경)이 맞다
  const normal = { url: 'https://grok.com/imagine', groups: [{ aria: '생성 모드', opts: [] }], buttons: [] };
  ok(/UI 가 또 바뀐/.test(explainNoChipBar(normal)), '폼이 정상이면 옛 진단(UI 변경) 유지');
  ok(/UI 가 또 바뀐/.test(explainNoChipBar(null)), '덤프 실패(null)면 옛 진단 유지');

  // 배선: 호출부가 이 함수를 실제로 쓰는가
  const g = norm(read('grok-engine.js'));
  ok(/const dump = await this\._dumpChipBar\(\);/.test(g), '_dumpChipBar 반환값을 받는다');
  ok(/const why = explainNoChipBar\(dump\);/.test(g), '칩 못 찾음 경로가 explainNoChipBar 를 부른다');
  ok(/return d;/.test(g), '_dumpChipBar 가 덤프를 반환한다');
}

console.log('\n[2] flow-engine send() — reason 자동 기록 (원문 실행)');
{
  const { FlowAutomator } = require('../flow-engine.js');
  const inst = Object.create(FlowAutomator.prototype);
  inst.win = null;                 // 🔑 창이 없어도 기록돼야 한다(기록이 win 체크보다 앞)
  inst._exhaustReason = '';

  inst.send('flow-rate-exhausted', { reason: 'credit-exhausted' });
  eq(inst._exhaustReason, 'credit-exhausted', 'win 없이도 credit-exhausted 를 기록한다');

  inst.send('log', { reason: 'daily-limit' });
  eq(inst._exhaustReason, 'credit-exhausted', '다른 채널은 기록하지 않는다');

  inst.send('flow-rate-exhausted', { completedNums: [] });
  eq(inst._exhaustReason, 'credit-exhausted', 'reason 없는 payload 는 덮어쓰지 않는다');

  inst.send('flow-rate-exhausted', { reason: 'daily-limit' });
  eq(inst._exhaustReason, 'daily-limit', '나중 reason 이 이긴다');

  inst.send('flow-rate-exhausted', null);
  eq(inst._exhaustReason, 'daily-limit', 'null payload 에도 던지지 않는다');
}

console.log('\n[3] run() 반환 reason — 원문 표현식 실행');
{
  const expr = extractReasonExpr(read('flow-engine.js'));
  const fn = makeReasonFn(expr);

  const run = (ctx) => fn.call(ctx);
  eq(run({ _proactiveSwitchTriggered: false, _rateExhaustedFlag: true, _exhaustReason: 'credit-exhausted' }),
    'credit-exhausted', '🔴 크레딧 소진이 그대로 나온다(실사고의 핵심)');
  eq(run({ _proactiveSwitchTriggered: false, _rateExhaustedFlag: true, _exhaustReason: 'daily-limit' }),
    'daily-limit', '하루 한도도 그대로');
  eq(run({ _proactiveSwitchTriggered: false, _rateExhaustedFlag: true, _exhaustReason: 'suspicious-activity' }),
    'suspicious-activity', '비정상 활동도 그대로');
  eq(run({ _proactiveSwitchTriggered: false, _rateExhaustedFlag: true, _exhaustReason: '' }),
    'rate-limit', '이유를 모르면 rate-limit 로 폴백(기존 동작 보존)');
  eq(run({ _proactiveSwitchTriggered: false, _rateExhaustedFlag: false, _exhaustReason: '' }),
    'completed', '정상 완료는 completed');
  eq(run({ _proactiveSwitchTriggered: true, _rateExhaustedFlag: true, _exhaustReason: 'credit-exhausted' }),
    'proactive-switch', '적극적 전환이 최우선(기존 동작 보존)');
}

console.log('\n[4] 소스 위생 — 옛 하드코딩이 되살아나지 않았는가');
{
  const f = norm(read('flow-engine.js'));
  ok(!/_rateExhaustedFlag \? 'rate-limit' : 'completed'/.test(f),
    "옛 하드코딩 `_rateExhaustedFlag ? 'rate-limit' : 'completed'` 잔존 0");
  ok(/this\._exhaustReason \|\| 'rate-limit'/.test(f), '반환이 _exhaustReason 을 쓴다');
  ok(/channel === 'flow-rate-exhausted' && data && data\.reason/.test(f), 'send() 기록 배선 존재');

  // 🔑 run() 이 시작할 때 초기화되지 않으면 **앞 실행의 이유가 다음 실행에 새어 나온다**
  ok(/this\._rateExhaustedFlag = false;\n    this\._exhaustReason = '';/.test(f),
    'run() 시작 시 _exhaustReason 초기화');
  ok(/this\._exhaustReason = '';\s+\/\/ 'credit-exhausted'/.test(f), '생성자에도 필드 선언');

  // 폴백 헤더가 크레딧일 때 'rate-limit 도달' 이라고 거짓말하지 않는가
  ok(/isCredit \? '💳' : '🛑'/.test(f), '크레딧이면 헤더 이모지 💳');
  ok(/isCredit \? '크레딧 소진' : 'rate-limit 도달'/.test(f), '크레딧이면 헤더 문구도 크레딧 소진');
}

console.log('\n[5] main 배선 — 살아난 reason 을 받는 쪽이 그대로인가');
{
  const m = norm(read('main.js'));
  const credit = m.match(/res\.reason === 'credit-exhausted'/g) || [];
  eq(credit.length, 2, "credit-exhausted 분기가 2곳(이미지·비디오)");
  ok(/const FLOW_CREDIT_REST_MIN = 6 \* 60;/.test(m), '크레딧 휴식 6시간 상수 유지');
  const rest = m.match(/FlowAccounts\.cooldown\(acc\.id, FLOW_CREDIT_REST_MIN\)/g) || [];
  eq(rest.length, 2, '두 경로 모두 6시간 쿨다운을 건다');

  ok(!/Grok 한도·오류 확인/.test(m), 'flow 로 만들고 "Grok" 이라 말하던 오도 문구 제거');
  ok(/\$\{engine\} 한도·오류/.test(m), '실제 엔진 이름을 쓴다');
}

console.log('\n[6] 실사고 재현 — 감지부터 쿨다운 선택까지 (A/B 역검증 포함)');
{
  const { FlowAutomator } = require('../flow-engine.js');
  const src = read('flow-engine.js');

  // 실사고 그대로: 엔진이 크레딧 소진을 감지해 이벤트를 보낸다
  const inst = Object.create(FlowAutomator.prototype);
  inst.win = null;
  inst._exhaustReason = '';
  inst._proactiveSwitchTriggered = false;
  inst.send('flow-rate-exhausted', {
    profileId: 'flow-mqunvoyv', remainingNums: [1, 2, 3, 4, 5, 6], reason: 'credit-exhausted',
  });
  inst._rateExhaustedFlag = true;

  const nowReason = makeReasonFn(extractReasonExpr(src)).call(inst);
  eq(nowReason, 'credit-exhausted', '수정본: main 이 크레딧 소진을 알아본다 → 6시간 휴식');

  // A/B — 옛 하드코딩으로 되돌리면 같은 시나리오가 'rate-limit'(30분 헛돌이)로 떨어진다
  const oldExpr = "this._proactiveSwitchTriggered ? 'proactive-switch' : (this._rateExhaustedFlag ? 'rate-limit' : 'completed')";
  const oldReason = makeReasonFn(oldExpr).call(inst);
  eq(oldReason, 'rate-limit', 'A/B: 옛 코드는 rate-limit — 실사고(30분 쿨다운)가 재현된다');
  ok(nowReason !== oldReason, 'A/B: 수정 전후가 실제로 다르다(헛단언 아님)');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} flow-credit-reason: ${pass}/${pass + fail}\n`);
process.exit(fail === 0 ? 0 : 1);
