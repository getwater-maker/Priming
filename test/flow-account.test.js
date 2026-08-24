'use strict';
/**
 * test/flow-account.test.js — Flow 멀티계정·진단 회귀 테스트 (2026-08-24)
 *
 * 🔴 실사고: 사용자가 "1번 계정이 한도를 다 써서" 2번 계정을 추가했는데 생성이 안 됐다. 실측하니
 *   ① 1번 계정은 한도(3/45)가 아니라 **쿨다운** 중이었는데 로그가 그 사실을 말해 주지 않았다
 *   ② 2번 계정은 **Google AI 구독이 없어** 같은 주소에서 앱이 아니라 **소개(마케팅) 페이지**가 열렸다
 *      → 「새 프로젝트」가 없어 홈에 머물고, 프롬프트 입력칸을 10초 기다린 뒤
 *        `locator.waitFor: Timeout 10000ms exceeded` 로만 실패했다(원인을 알 수 없는 메시지)
 *   ③ 로그가 `오늘 undefined/45` 를 찍고 있었다(pickNext 가 used 를 안 붙였다)
 *
 * 🔑 앱 원문을 그대로 돌린다 — page 만 가짜로 주입해 실제 메서드를 실행한다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

let n = 0, fails = 0;
function ok(label, fn) {
  n++;
  try { fn(); console.log('  ✓ [' + n + '] ' + label); }
  catch (e) { fails++; console.log('  ✗ [' + n + '] ' + label + '\n      ' + e.message); }
}
async function okAsync(label, fn) {
  n++;
  try { await fn(); console.log('  ✓ [' + n + '] ' + label); }
  catch (e) { fails++; console.log('  ✗ [' + n + '] ' + label + '\n      ' + e.message); }
}

// ── 실측 화면 텍스트(2026-08-24) ──
// 구독 없는 계정: labs.google/fx/ko/tools/flow 가 소개 페이지로 열린다
const LANDING = 'Overview Models Capabilities Tools Flow Sessions Pricing more_vert Your AI creative studio '
  + 'built with Google\'s advanced generative models. Create with Google Flow Google AI 구독을 살펴보세요. '
  + 'FAQ를 참고하세요. Features may vary by Google AI subscription tier, platform (web vs. mobile), and region. '
  + '18+. Try in Google Flow Learn More';
// 정상 계정: 프로젝트 목록 + 새 프로젝트 버튼
const HOME = 'Google Flow Flow Music tv Flow TV help_outlined Flow 고객센터 more_vert PRO 일일 보너스: '
  + '8월 31일까지 추가 크레딧 50개를 드립니다. 8월 24일 오전 08:29 edit 프로젝트 수정 delete 프로젝트 삭제 add_2 새 프로젝트';
const LOGIN = 'Google 계정으로 로그인 이메일 또는 휴대전화 계정을 선택하세요';

(async () => {

console.log('\n[1] 계정 스토어 — 로그가 거짓 정보를 주지 않는지');
// 임시 홈으로 격리 — 실제 ~/.priming-maker/flow-accounts.json 을 건드리면 안 된다.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'flowacct_'));
const realHome = process.env.USERPROFILE;
process.env.USERPROFILE = tmpHome;
for (const k of Object.keys(require.cache)) if (/flow-accounts/.test(k)) delete require.cache[k];
const FA = require('../core/flow-accounts');

const a1 = FA.add('계정 A');
const a2 = FA.add('계정 B');
ok('계정 2개 등록', () => assert.strictEqual(FA.list().accounts.length, 2));
ok('🔴 pickNext 가 used 를 함께 준다 (로그의 "오늘 undefined/45" 버그)', () => {
  const p = FA.pickNext([]);
  assert.ok(p, 'pickNext 가 null');
  assert.strictEqual(typeof p.used, 'number', 'used 가 숫자가 아니면 로그에 undefined 가 찍힌다');
  assert.strictEqual(p.used, 0);
});
ok('markUsed 후 used 가 반영된다', () => {
  FA.markUsed(a1.id, 3);
  const acc = FA.list().accounts.find((x) => x.id === a1.id);
  assert.strictEqual(acc.used, 3);
});
ok('🔴 쿨다운 중이면 available=false 이고 coolUntil 이 미래다', () => {
  FA.cooldown(a1.id, 30);
  const acc = FA.list().accounts.find((x) => x.id === a1.id);
  assert.strictEqual(acc.available, false);
  assert.strictEqual(acc.cooling, true);
  assert.ok(acc.coolUntil > Date.now(), 'coolUntil 이 있어야 "언제 풀리는지" 를 로그에 쓸 수 있다');
});
ok('쿨다운 계정은 한도를 안 썼어도(3/45) 건너뛴다 — 실사고 재현', () => {
  const acc = FA.list().accounts.find((x) => x.id === a1.id);
  assert.strictEqual(acc.used, 3, '한도(45)에는 한참 못 미친다');
  assert.strictEqual(acc.available, false, '그런데도 못 쓴다 = 쿨다운이 이유다');
  const p = FA.pickNext([]);
  assert.strictEqual(p.id, a2.id, '다음 계정으로 넘어가야 한다');
});
ok('쿨다운 아닌 계정은 coolUntil 이 0', () => {
  const acc = FA.list().accounts.find((x) => x.id === a2.id);
  assert.strictEqual(acc.coolUntil, 0);
});
ok('모두 소진되면 pickNext = null', () => {
  FA.cooldown(a2.id, 30);
  assert.strictEqual(FA.pickNext([]), null);
});

console.log('\n[1-b] 일일 한도 0 = 무제한 (UI 라벨이 거짓이던 것)');
// 🔴 실사고: UI 에 「0=무제한」이라 적혀 있는데 Flow 만 0 을 못 받았다.
//   setCap: `Math.max(1, parseInt(n,10) || 45)` → parseInt('0')||45 = 45, 통과해도 Math.max(1,0)=1.
const a3 = FA.add('무제한 테스트');
ok('🔴 setCap(0) 이 0 으로 저장된다 (예전엔 45 로 되돌아갔다)', () => {
  FA.setCap(0);
  assert.strictEqual(FA.list().dailyCap, 0, '0 이 아니면 UI 의 「0=무제한」이 거짓말이 된다');
});
ok('🔴 무제한이면 아무리 써도 계정을 계속 쓴다', () => {
  FA.markUsed(a3.id, 999);
  const acc = FA.list().accounts.find((x) => x.id === a3.id);
  assert.strictEqual(acc.used, 999);
  assert.strictEqual(acc.available, true, 'dailyCap 0 을 그냥 비교하면 전부 차단된다(무제한의 반대)');
});
ok('무제한이어도 쿨다운은 존중한다', () => {
  FA.cooldown(a3.id, 30);
  const acc = FA.list().accounts.find((x) => x.id === a3.id);
  assert.strictEqual(acc.available, false, '엔진이 실제 한도를 본 뒤의 쿨다운은 무제한과 무관하게 지켜야 한다');
});
ok('문자열 "0" 도 무제한으로 받는다(UI 는 문자열을 보낸다)', () => {
  FA.setCap(45); FA.setCap('0');
  assert.strictEqual(FA.list().dailyCap, 0);
});
ok('음수·빈값·문자는 기본값(45)으로 — 무제한으로 오해하지 않는다', () => {
  FA.setCap(-5); assert.strictEqual(FA.list().dailyCap, 45, '음수');
  FA.setCap('abc'); assert.strictEqual(FA.list().dailyCap, 45, '문자');
  FA.setCap(''); assert.strictEqual(FA.list().dailyCap, 45, '빈값');
});
ok('정상 숫자는 그대로', () => { FA.setCap(45); assert.strictEqual(FA.list().dailyCap, 45); });

console.log('\n[1-c] 세 서비스의 한도 정책이 같은가 (UI 는 같은 라벨을 쓴다)');
for (const k of Object.keys(require.cache)) if (/accounts/.test(k)) delete require.cache[k];
const SVC = {
  flow: require('../core/flow-accounts'),
  genspark: require('../core/genspark-accounts'),
  grok: require('../core/grok-accounts'),
};
for (const [name, S] of Object.entries(SVC)) {
  ok(`${name}: setCap(0) → 0 (무제한)`, () => {
    S.add('t_' + name);
    S.setCap(0);
    assert.strictEqual(S.list().dailyCap, 0);
  });
  ok(`${name}: 무제한이면 999회 써도 계정이 살아 있다`, () => {
    const id = S.list().accounts[0].id;
    S.markUsed(id, 999);
    const avail = typeof S.activeAccounts === 'function'
      ? S.activeAccounts().length > 0
      : S.list().accounts.some((x) => x.available);
    assert.strictEqual(avail, true);
  });
}
process.env.USERPROFILE = realHome;
try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
ok('실제 홈의 계정 파일은 건드리지 않았다', () => {
  const real = path.join(realHome || os.homedir(), '.priming-maker', 'flow-accounts.json');
  if (!fs.existsSync(real)) return;                       // 없으면 검사할 것도 없다
  const j = JSON.parse(fs.readFileSync(real, 'utf8'));
  assert.ok(!(j.accounts || []).some((x) => /계정 A|계정 B/.test(x.label)), '테스트 계정이 실제 파일에 새어 들어갔다');
});

console.log('\n[2] 「새 프로젝트」가 없는 이유를 갈라내는가 (flow-engine 원문 실행)');
for (const k of Object.keys(require.cache)) if (/flow-engine/.test(k)) delete require.cache[k];
const { FlowAutomator } = require('../flow-engine');
// 인스턴스를 만들지 않고 프로토타입 메서드만 실제로 돌린다(브라우저 없이).
const mkEng = (bodyText, url, btnFound) => {
  const eng = Object.create(FlowAutomator.prototype);
  eng.logs = [];
  eng.log = (m) => eng.logs.push(String(m));
  eng.debug = () => {};
  eng._dismissBanners = async () => {};
  eng.page = {
    url: () => url,
    // page.evaluate(fn) → 가짜 document/location 을 심고 원문 콜백을 그대로 실행
    evaluate: async (fn) => {
      global.document = { body: { innerText: bodyText } };
      global.location = { href: url };
      try { return await fn(); } finally { delete global.document; delete global.location; }
    },
    $: async () => (btnFound
      ? { isVisible: async () => true, click: async () => { eng._clicked = true; } }
      : null),
    waitForTimeout: async () => {},
  };
  return eng;
};

await okAsync('🔴 구독 없는 계정(소개 페이지) → flowNoAccess 로 즉시 실패', async () => {
  const eng = mkEng(LANDING, 'https://labs.google/fx/ko/tools/flow', false);
  let err = null;
  try { await eng._createNewProject(); } catch (e) { err = e; }
  assert.ok(err, '조용히 넘어가면 안 된다 — 그게 10초 타임아웃의 원인이었다');
  assert.strictEqual(err.flowNoAccess, true, 'main 이 이 계정을 쉬게 하려면 이 플래그가 필요하다');
  assert.ok(/구독/.test(err.message), '사람 말로 이유를 알려야 한다: ' + err.message);
  assert.ok(/ComfyUI|Genspark/.test(err.message), '무엇을 하면 되는지도 알려야 한다');
});
await okAsync('로그인이 풀린 경우는 구독 문제로 오진하지 않는다', async () => {
  const eng = mkEng(LOGIN, 'https://accounts.google.com/signin', false);
  let err = null;
  try { await eng._createNewProject(); } catch (e) { err = e; }
  assert.ok(err);
  assert.ok(!err.flowNoAccess, '로그인 문제를 구독 문제로 말하면 엉뚱한 곳을 고치게 된다');
  assert.ok(/로그인/.test(err.message), err.message);
});
await okAsync('낯선 화면이면 UI 변경 가능성 + URL·화면을 함께 남긴다', async () => {
  const eng = mkEng('무언가 알 수 없는 화면입니다', 'https://labs.google/fx/ko/tools/flow', false);
  let err = null;
  try { await eng._createNewProject(); } catch (e) { err = e; }
  assert.ok(err);
  assert.ok(!err.flowNoAccess);
  assert.ok(/UI 변경/.test(err.message) && /labs\.google/.test(err.message), err.message);
});
await okAsync('버튼이 있으면 클릭하고 예외를 던지지 않는다(정상 경로)', async () => {
  const eng = mkEng(HOME, 'https://labs.google/fx/ko/tools/flow', true);
  // 클릭 뒤 프로젝트로 이동한 것으로 흉내
  let moved = false;
  eng.page.url = () => (moved ? 'https://labs.google/fx/ko/tools/flow/project/abc' : 'https://labs.google/fx/ko/tools/flow');
  eng.page.$ = async () => ({ isVisible: async () => true, click: async () => { moved = true; eng._clicked = true; } });
  await eng._createNewProject();
  assert.strictEqual(eng._clicked, true, '클릭했어야 한다');
  assert.strictEqual(eng.logs.filter((l) => /넘어가지 않았습니다/.test(l)).length, 0, '정상인데 경고를 내면 안 된다');
});
await okAsync('클릭했는데 프로젝트로 안 넘어가면 경고를 남긴다(막지는 않는다)', async () => {
  const eng = mkEng(HOME, 'https://labs.google/fx/ko/tools/flow', true);
  await eng._createNewProject();     // url 이 계속 홈
  assert.ok(eng.logs.some((l) => /넘어가지 않았습니다/.test(l)), '조용히 지나가면 다음 실패의 원인을 모른다');
});

console.log('\n[2-b] 계정당 하루 한도는 ⚙ 설정 값을 따른다 (하드코딩 45 가 아니라)');
// 🔴 실사고: UI 에서 「0=무제한」으로 바꿔도 flow-engine 의 PER_PROFILE_DAILY_CAP=45 가 막았다.
//   한도 칸이 하나인데 판정이 두 곳이면 반드시 어긋난다.
const mkCapEng = (dailyLimit) => {
  const eng = Object.create(FlowAutomator.prototype);
  eng.antiDetect = dailyLimit === undefined ? null : { dailyLimit };
  return eng;
};
ok('UI 한도 20 → 20 을 쓴다', () => assert.strictEqual(mkCapEng(20)._perProfileCap(), 20));
ok('🔴 UI 한도 0(무제한) → 0 을 그대로 돌려준다', () =>
  assert.strictEqual(mkCapEng(0)._perProfileCap(), 0, '0 이 아니면 무제한이 또 막힌다'));
ok('UI 값이 없으면 하드코딩 폴백(45)', () => assert.strictEqual(mkCapEng(undefined)._perProfileCap(), 45));
ok('UI 값이 숫자가 아니면 폴백', () => assert.strictEqual(mkCapEng('많이')._perProfileCap(), 45));
ok('큰 값도 그대로(사용자 선택 존중)', () => assert.strictEqual(mkCapEng(500)._perProfileCap(), 500));

console.log('\n[3] 앱 배선 원문 대조');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const ENG = fs.readFileSync(path.join(__dirname, '..', 'flow-engine.js'), 'utf8');
ok('main 이 flowNoAccess 를 구분해 잡는다', () =>
  assert.ok(/if \(e && e\.flowNoAccess\)/.test(MAIN)));
ok('구독 없는 계정은 길게 쉬게 한다(12시간)', () =>
  assert.ok(/FlowAccounts\.cooldown\(acc\.id, 12 \* 60\)/.test(MAIN)));
ok('계정이 다 소진되면 각 계정의 이유를 로그로 남긴다', () =>
  assert.ok(/쉬는 중 — .*이후 재사용/.test(MAIN) && /오늘 한도 도달/.test(MAIN)));
ok('🔴 계정 라벨과 used 를 함께 찍는다(undefined 재발 방지)', () =>
  assert.ok(/Flow 계정: \$\{acc\.label\}/.test(MAIN) && /오늘 \$\{acc\.used\}\//.test(MAIN),
    '라벨과 used 가 로그에 있어야 한다(캡 표기는 capTxt — 아래 항목에서 따로 검사)'));
ok('flow-engine 의 _createNewProject 가 조용히 넘어가지 않는다', () => {
  const body = ENG.slice(ENG.indexOf('async _createNewProject()'), ENG.indexOf('async _ensureAgentOff'));
  assert.ok(/throw err;/.test(body), '버튼을 못 찾으면 던져야 한다');
  assert.ok(/_diagnoseNoProjectButton/.test(body));
});
ok('진단이 소개 페이지 신호를 실측 문구로 본다', () =>
  assert.ok(/Try in Google Flow\|Create with Google Flow\|구독을 살펴보/.test(ENG)));
ok('🔴 로그가 한도 0 을 "3/0" 이라 적지 않는다', () =>
  assert.ok(/const capTxt = cap > 0 \? String\(cap\) : '무제한'/.test(MAIN)
    && /오늘 \$\{acc\.used\}\/\$\{capTxt\}/.test(MAIN), 'capTxt 로 표시해야 한다'));
ok('소진 요약이 무제한을 "한도 도달" 로 오판하지 않는다', () =>
  assert.ok(/\(cap > 0 && a\.used >= cap\)/.test(MAIN), 'cap=0 이면 used >= 0 이 항상 참이다'));
ok('flow 의 _available 이 무제한을 캡 없이 처리한다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'flow-accounts.js'), 'utf8');
  assert.ok(/if \(!\(c\.dailyCap > 0\)\) return true;/.test(src));
});
ok('🔴 main 이 UI 의 일일 한도를 엔진에 넘긴다', () =>
  assert.ok(/antiDetect: \{ enabled: true, preset: '기본', dailyLimit: cap \}/.test(MAIN),
    '안 넘기면 엔진이 하드코딩 45 를 쓴다'));
ok('🔴 매핑 수를 누적으로 센다 (폴링이 복사한 것도 포함)', () => {
  assert.ok(/let copiedTotal = 0;/.test(MAIN), 'copiedTotal 선언');
  assert.ok(/n\+\+; copiedTotal\+\+;/.test(MAIN), '복사할 때마다 누적');
  assert.ok(/const made = copiedTotal;/.test(MAIN), 'markUsed 는 누적값을 써야 한다');
  assert.ok(!/FlowAccounts\.markUsed\(acc\.id, mapOnce\(true\)\)/.test(MAIN));
});
ok('하루 한도 도달을 "UI 문제" 로 말하지 않는다', () => {
  assert.ok(/res\.reason === 'daily-limit'/.test(MAIN), 'daily-limit 을 따로 잡아야 한다');
  assert.ok(/계정당 하루 한도\(\$\{_cp\}장\) 도달/.test(MAIN));
  assert.ok(/자정에 초기화/.test(MAIN), '언제 풀리는지 알려줘야 한다');
});
ok('🔴 엔진이 하루 한도 도달 시 객체를 반환한다(res=undefined 였던 것)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'flow-engine.js'), 'utf8');
  const i = src.indexOf('계정당 하루 한도(${_cap}장) 도달');
  assert.ok(i > 0, '진입 판정 로그를 못 찾음');
  const blk = src.slice(i, i + 900);
  assert.ok(/reason: 'daily-limit'/.test(blk), 'reason 을 실어야 main 이 구분한다');
  assert.ok(/profileCount: _pc/.test(blk) && /dailyCap: _cap/.test(blk));
  assert.ok(!/\n\s*return;\s*\n/.test(blk), '빈 return 이 남아 있으면 res 가 undefined 가 된다');
});
ok('엔진의 두 판정 모두 헬퍼를 쓴다(상수를 직접 비교하지 않는다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'flow-engine.js'), 'utf8');
  // 진입·중간 두 곳이 헬퍼를 쓴다
  assert.ok(/const _cap = this\._perProfileCap\(\);/.test(src), '진입 판정');
  assert.ok(/const _midCap = this\._perProfileCap\(\);/.test(src), '작업 중간 판정');
  // 상수는 **폴백 한 곳**에서만 값으로 쓰인다 — 판정에 직접 등장하면 UI 값이 무시된다.
  assert.ok(/Number\.isFinite\(v\) \? v : PER_PROFILE_DAILY_CAP;/.test(src), '폴백');
  assert.ok(!/PER_PROFILE_DAILY_CAP\s*>\s*0/.test(src), '상수를 판정에 직접 쓰면 안 된다');
  assert.ok(!/>=\s*PER_PROFILE_DAILY_CAP/.test(src), '상수와 직접 비교하면 안 된다');
});
ok('flow-engine 은 CRLF 로 저장돼 있다(원래 규약)', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'flow-engine.js'), 'latin1');
  const crlf = (raw.match(/\r\n/g) || []).length, lf = (raw.match(/\n/g) || []).length;
  assert.strictEqual(crlf, lf, 'LF 로 저장하면 diff 가 4천 줄로 부푼다');
});
ok('main.js 는 LF 로 저장돼 있다', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'latin1');
  assert.strictEqual((raw.match(/\r\n/g) || []).length, 0);
});

console.log('\n' + (fails ? '❌' : '✅') + ' flow-account: ' + (n - fails) + '/' + n + ' 통과' + (fails ? ' · 실패 ' + fails : ''));
process.exit(fails ? 1 : 0);

})().catch((e) => { console.error('테스트 실행 실패:', e); process.exit(1); });
