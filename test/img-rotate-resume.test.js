'use strict';
// node test/img-rotate-resume.test.js — 「한도가 풀리면 원래 엔진으로 되돌아간다」 검증.
//
// 배경(2026-08-27): 로이 — "젠스파크로 이미지 생성을 더 이상 못하면 … Flow로 변경되어서 이미지를
//   만들던데, 제한시간이 지난 다음에는 다시 젠스파크로 돌아가 이미지 생성을 할수 있도록 해줘.
//   지금은 대본 1편을 기준으로 진행되는것 같은데, 같은 대본에서라도 진행되면 좋겠어."
//
// 옛 구조: runRotatingImages 가 `for (const engineId of order)` **단일 패스**였다 →
//   Genspark 한도 → Flow 로 넘어가면 그 호출 안에서는 **두 번 다시 Genspark 를 보지 않는다.**
//   Flow 가 30장을 만드는 20분 사이에 Genspark 쿨다운이 풀려도 남은 이미지는 전부 Flow 가 만들고,
//   Genspark 복귀는 **다음 대본(다음 호출)** 에서나 일어났다 = 로이가 본 "대본 1편 기준".
//
// 지키는 것:
//   ① imgEngineReady — 「지금 쓸 수 있나 · 아니면 언제 풀리나」를 갈라 준다(캡 소진 ≠ 쿨다운)
//   ② 라운드 반복 — 한 바퀴 뒤 남은 게 있고 그 사이 쿨다운이 풀렸으면 **같은 호출 안에서** 그 엔진으로 복귀
//   ③ 후보는 **시도 직후** 기록 — 라운드 끝에 한꺼번에 재면 이미 풀린 엔진이 후보에서 빠져 영영 복귀 못 한다
//   ④ 아직 안 풀렸으면 **기다리지 않는다**(무한루프·앱 멈춤 방지) — 언제 다시 누르면 되는지 로그로 알린다
//   ⑤ 진전이 없으면 멈춘다(헛돌기 방지) · 전부 만들면 1라운드로 끝(기존 동작 보존)
//
//   🔑 로직을 복사하지 않는다 — main.js 원문에서 함수를 뽑아 실행한다.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, m + '  (기대 ' + JSON.stringify(b) + ' / 실제 ' + JSON.stringify(a) + ')');

// ── main.js 원문에서 함수 통째로 뽑기 (async 함수 포함) ──
function extractFn(src, name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' 를 찾을 수 없습니다(원문에 없음)');
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

// ── 실행 환경(스텁) ──
// 가짜 시계 clock.now 를 쓴다 — "Flow 가 이미지를 만드는 동안 시간이 흐른다" 를 재현하기 위해.
// 계정 스토어를 스텁하므로 실제 ~/.priming-maker/*.json 은 건드리지 않는다.
function makeEnv(cfg) {
  const clock = { now: 1700000000000 };
  const logs = [];
  const groups = [];
  for (let i = 1; i <= (cfg.groups || 5); i++) groups.push({ num: i, imagePrompt: 'p' + i, imagePath: null, videoPath: null });
  const project = { groups };
  const gs = { cool: 0, used: 0, calls: 0 };
  const fl = { cool: 0, calls: 0 };

  const GsAcc = {
    activeAccounts() { return (gs.cool > clock.now) ? [] : [{ id: 'gs1', label: '기본 계정' }]; },
    list() { return { accounts: [{ id: 'gs1', label: '기본 계정' }] }; },
    cooldownUntil() { return (gs.cool > clock.now) ? gs.cool : 0; },
    setCooldown(id, t) { gs.cool = t; },
    markUsed(id, k) { gs.used += k; },
  };
  const FlowAcc = {
    list() {
      const cooling = fl.cool > clock.now;
      return { accounts: [{ id: 'f1', label: '계정 1', available: !cooling, cooling, coolUntil: cooling ? fl.cool : 0 }] };
    },
  };
  const fakeRequire = (m) => {
    if (m === './core/image-rotation') return { activeOrder: (start) => (start === 'flow' ? ['flow', 'genspark'] : ['genspark', 'flow']) };
    if (m === './core/style-store') return { getPrompt: () => 'STYLE' };
    if (m === './core/genspark-accounts') return GsAcc;
    if (m === './core/flow-accounts') return FlowAcc;
    throw new Error('예상 못한 require: ' + m);
  };

  const S = { abort: false };
  const P = {
    generateImagesGenspark: async (proj, dir, logger, isAbort, style, ns) => { gs.calls++; return cfg.genspark(proj, ns, { gs, fl }, clock); },
  };
  const env = {
    S, P, clock, logs, project, gs, fl,
    require: fakeRequire,
    imgDone: (g) => !!g.imagePath,
    noTargetMsg: () => '⏭ 이미지 생성 대상 없음',
    fmtClock: (ts) => 'T+' + Math.round((ts - 1700000000000) / 60000) + '분',
    parseLimitResetTime: () => clock.now + 20 * 60 * 1000, // 메시지에서 읽은 재설정 시각(20분 뒤)
    pushDtoUpdate: () => {},
    collectForLora: () => {},
    isComfyVal: () => false,
    comfyWfOf: () => null,
    runGeminiImages: async () => {},
    // Genspark 이미지는 비디오와 **같은 크롬**이라 gensparkBrowser 레인을 잡는다(v0.3.95) — 여기선 그냥 실행.
    _runOnLanes: (_lanes, _label, fn) => fn(),
    runComfyImages: async () => {},
    runFlowImages: async (proj, dir, logger, styleId, nums) => { fl.calls++; return cfg.flow(proj, nums, { gs, fl }, clock); },
  };
  return env;
}

// 원문 함수를 스텁 환경에서 실행. src 를 넘기면 그 소스(=옛 버전)로 실행한다(A/B 역검증용).
function run(env, src) {
  const source = src || MAIN;
  const body = [
    src ? '' : extractFn(source, 'imgEngineReady'),
    extractFn(source, 'runRotatingImages'),
  ].join('\n');
  const names = Object.keys(env).filter((k) => ['clock', 'logs', 'project', 'gs', 'fl'].indexOf(k) < 0);
  const fn = new Function(...names, body + '\nreturn runRotatingImages;')(...names.map((k) => env[k]));
  const logger = (m) => env.logs.push(String(m));
  return fn(env.project, 'D:/out', logger, 'st1', 'genspark', null, 0, false);
}
const made = (env) => env.project.groups.filter((g) => g.imagePath).length;
const hasLog = (env, re) => env.logs.some((l) => re.test(l));

// ── [1] imgEngineReady — 「지금 되나 · 언제 풀리나」 ──
console.log('\n[1] imgEngineReady — 쿨다운과 캡 소진을 가른다');
{
  const M = new Function('require', extractFn(MAIN, 'imgEngineReady') + '\nreturn imgEngineReady;');
  const mk = (gsAcc, flAcc) => M((m) => {
    if (m === './core/genspark-accounts') return gsAcc;
    if (m === './core/flow-accounts') return flAcc;
    throw new Error('no');
  });
  const future = Date.now() + 600000;
  let f = mk({ activeAccounts: () => [{ id: 'a' }], list: () => ({ accounts: [] }), cooldownUntil: () => 0 }, null);
  eq(f('genspark').ok, true, '활성 계정이 있으면 지금 쓸 수 있다');
  f = mk({ activeAccounts: () => [], list: () => ({ accounts: [{ id: 'a' }] }), cooldownUntil: () => future }, null);
  eq(f('genspark').ok, false, '전 계정 쿨다운이면 못 쓴다');
  eq(f('genspark').until, future, '🔑 언제 풀리는지(재설정 시각)를 돌려준다 → 라운드 재시도 후보');
  f = mk({ activeAccounts: () => [], list: () => ({ accounts: [{ id: 'a' }] }), cooldownUntil: () => 0 }, null);
  eq(f('genspark').until, 0, '쿨다운이 아닌 이유(일일 캡 소진)면 until 0 = 기다려도 안 풀린다');
  f = mk(null, { list: () => ({ accounts: [{ id: 'f', available: false, coolUntil: future }] }) });
  eq(f('flow').ok, false, 'Flow 도 계정 쿨다운을 본다');
  eq(f('flow').until, future, 'Flow 쿨다운 해제 시각도 돌려준다');
  f = mk(null, { list: () => ({ accounts: [{ id: 'f', available: true, coolUntil: 0 }] }) });
  eq(f('flow').ok, true, 'Flow 계정이 살아 있으면 쓸 수 있다');
  f = mk({ activeAccounts: () => { throw new Error('파일 깨짐'); } }, null);
  eq(f('genspark').ok, true, '⚠ 조회 실패는 fail-open — 판정 때문에 생성이 막히지 않는다');
  eq(f('comfy').ok, true, '순환 밖 엔진은 항상 ok');
}

// ── [2] 실사고 재현 — Genspark 한도 → Flow → 그 사이 풀림 → **같은 대본에서 Genspark 복귀** ──
console.log('[2] 실사고 재현 — Flow 가 도는 동안 Genspark 한도가 풀리면 되돌아온다');
const scenario = {
  groups: 5,
  // Genspark: 1라운드엔 1장 만들고 한도. 복귀(2라운드) 때는 남은 걸 전부 만든다.
  genspark: (proj, ns, st, clock) => {
    if (st.gs.calls === 1) {
      proj.groups.find((g) => g.num === ns[0]).imagePath = 'gs.png';
      return { ok: 1, limitReached: '무료 사용량을 초과했습니다. 오후 3:39에 재설정됩니다.' };
    }
    let k = 0;
    for (const num of ns) { proj.groups.find((g) => g.num === num).imagePath = 'gs.png'; k++; }
    return { ok: k };
  },
  // Flow: 2장 만들고 자기도 계정 한도(30분 쿨다운). 그 작업에 25분이 걸린다 → Genspark 쿨다운(20분)이 그 사이 풀린다.
  flow: (proj, nums, st, clock) => {
    let k = 0;
    for (const num of nums) { if (k >= 2) break; proj.groups.find((g) => g.num === num).imagePath = 'flow.png'; k++; }
    clock.now += 25 * 60 * 1000;
    st.fl.cool = clock.now + 30 * 60 * 1000;
  },
};

(async () => {
  const env = makeEnv(scenario);
  await run(env);
  eq(made(env), 5, '🔑 5장 전부 생성됐다 (Genspark 1 + Flow 2 + 복귀한 Genspark 2)');
  eq(env.gs.calls, 2, 'Genspark 를 두 번 호출했다 = 같은 호출 안에서 복귀했다');
  ok(hasLog(env, /🔁 genspark 한도 재설정 시각이 지났습니다/), '복귀를 로그로 알린다: ' + (env.logs.find((l) => /🔁/.test(l)) || '(없음)'));
  ok(hasLog(env, /✅ 순환 이미지 생성 완료/), '완료로 끝난다(미생성 경고 없음)');
  ok(!hasLog(env, /모두 소진/), '「모두 소진」이 찍히지 않는다');
  const iGs2 = env.logs.findIndex((l) => /🔁/.test(l));
  const iFlow = env.logs.findIndex((l) => /\[flow\]/.test(l));
  ok(iFlow >= 0 && iGs2 > iFlow, '순서가 맞다 — Flow 를 먼저 쓰고 그 뒤에 Genspark 로 복귀');

  // ── [3] A/B 역검증 — 옛 코드(단일 패스)로 같은 시나리오를 돌리면 복귀하지 않는다 ──
  console.log('[3] A/B 역검증 — 직전 커밋의 옛 함수로 같은 시나리오');
  let OLD = null;
  try { OLD = execSync('git show HEAD:main.js', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8'); } catch (e) {}
  if (!OLD) {
    console.log('  (건너뜀) git 원문을 읽을 수 없습니다');
  } else if (OLD.indexOf('MAX_ROUNDS') >= 0) {
    console.log('  (건너뜀) HEAD 에 이미 새 코드가 들어 있습니다(재발행 시 정상)');
  } else {
    const envOld = makeEnv(scenario);
    await run(envOld, OLD);
    eq(envOld.gs.calls, 1, '🔑 옛 코드는 Genspark 를 한 번만 호출한다(복귀 없음) = 로이가 본 그 증상');
    ok(made(envOld) < 5, '옛 코드는 남은 장을 못 만든다 — 실제 ' + made(envOld) + '/5장');
  }

  // ── [4] 아직 안 풀렸으면 기다리지 않는다 ──
  console.log('[4] 쿨다운이 안 풀렸으면 대기하지 않고 끝낸다 (무한루프·앱 멈춤 방지)');
  {
    const env2 = makeEnv({
      groups: 4,
      genspark: () => ({ ok: 0, limitReached: '한도. 오후 3:39에 재설정됩니다.' }), // 쿨다운 +20분
      flow: (proj, nums, st, clock) => { clock.now += 60 * 1000; st.fl.cool = clock.now + 40 * 60 * 1000; }, // 1분만 흐름 → 아직 안 풀림
    });
    const t0 = Date.now();
    await run(env2);
    const spent = Date.now() - t0;
    eq(made(env2), 0, '한 장도 못 만든 채 끝난다(엔진이 둘 다 한도)');
    eq(env2.gs.calls, 1, 'Genspark 재시도 없음 — 아직 재설정 시각 전이다');
    ok(spent < 3000, '실제로 기다리지 않는다(' + spent + 'ms) — 5시간 쿨다운을 붙잡고 있으면 앱이 멎는다');
    ok(hasLog(env2, /이후에 「🖼 이미지」를 다시 누르면/), '언제 다시 누르면 되는지 알려준다: ' + (env2.logs.find((l) => /모두 소진/.test(l)) || '(없음)'));
    ok(hasLog(env2, /모두 소진 — 4장 미생성/), '미생성 장수를 정확히 보고한다');
  }

  // ── [5] 진전이 없으면 멈춘다(헛돌기 방지) ──
  console.log('[5] 복귀했는데 한 장도 못 만들면 그 자리에서 멈춘다');
  {
    const env3 = makeEnv({
      groups: 3,
      genspark: (proj, ns, st) => {
        if (st.gs.calls === 1) return { ok: 0, limitReached: '한도. 재설정됩니다.' };
        return { ok: 0 }; // 복귀했지만 0장(차단 등)
      },
      flow: (proj, nums, st, clock) => { clock.now += 25 * 60 * 1000; st.fl.cool = clock.now + 30 * 60 * 1000; },
    });
    await run(env3);
    eq(env3.gs.calls, 2, '복귀는 한 번 시도한다');
    ok(env3.gs.calls <= 2, '진전 0 이면 더 돌지 않는다(무한 반복 없음)');
    eq(made(env3), 0, '만들어진 건 없다');
  }

  // ── [6] 평상시 — 한도 없이 전부 만들면 1라운드로 끝난다(기존 동작 보존) ──
  console.log('[6] 한도가 없으면 기존과 똑같이 1라운드로 끝난다');
  {
    const env4 = makeEnv({
      groups: 4,
      genspark: (proj, ns) => { let k = 0; for (const num of ns) { proj.groups.find((g) => g.num === num).imagePath = 'gs.png'; k++; } return { ok: k }; },
      flow: () => { throw new Error('Flow 를 부르면 안 된다'); },
    });
    await run(env4);
    eq(made(env4), 4, '4장 전부 Genspark 가 만들었다');
    eq(env4.gs.calls, 1, 'Genspark 1회');
    eq(env4.fl.calls, 0, 'Flow 는 부르지 않는다');
    ok(!hasLog(env4, /🔁/), '복귀 로그가 없다(라운드 1회로 끝)');
  }

  // ── [7] 중단(⏹) 시 라운드에 진입하지 않는다 ──
  console.log('[7] 중단하면 라운드를 더 돌지 않는다');
  {
    let env5 = null;
    env5 = makeEnv({
      groups: 4,
      genspark: () => { env5.S.abort = true; return { ok: 0, limitReached: '한도. 재설정됩니다.' }; },
      flow: () => { throw new Error('중단 후 Flow 를 부르면 안 된다'); },
    });
    await run(env5);
    eq(env5.fl.calls, 0, '중단 후 다음 엔진으로 넘어가지 않는다');
    ok(hasLog(env5, /⏹ 중단됨/), '중단을 로그로 남긴다');
  }

  // ── [8] 소스 위생 — 대기 금지 · 상한 존재 · 후보를 시도 직후 기록 ──
  console.log('[8] 소스 대조 — 대기하지 않고, 상한이 있고, 후보를 시도 직후 기록한다');
  {
    const fnSrc = extractFn(MAIN, 'runRotatingImages');
    ok(/MAX_ROUNDS/.test(fnSrc), '라운드 상한(MAX_ROUNDS)이 있다 = 무한루프 방지');
    ok(!/setTimeout|sleep\(|await new Promise\(/.test(fnSrc), '⛔ 쿨다운을 기다리는 대기 코드가 없다(TTS·GPU 레인을 쥔 채 멎지 않게)');
    ok(/cooledOut\.add\(engineId\)/.test(fnSrc), '후보를 엔진 단위로 기록한다');
    // 🔑 기록이 엔진 루프 **안**(시도 직후)이어야 한다 — 라운드 끝에 재면 이미 풀린 엔진이 빠진다.
    const iAdd = fnSrc.indexOf('cooledOut.add(engineId)');
    const iRoundTail = fnSrc.indexOf('need().length === before');
    ok(iAdd > 0 && iRoundTail > iAdd, '🔑 후보 기록이 라운드 꼬리 판정보다 앞이다(= 엔진 루프 안, 시도 직후)');
    ok(/imgEngineReady\(engineId\)/.test(fnSrc), '엔진별로 지금 상태를 확인한다');
  }

  console.log(`\n${bad ? '❌' : '✅'} img-rotate-resume: ${n - bad}/${n} 통과`);
  process.exit(bad ? 1 : 0);
})();
