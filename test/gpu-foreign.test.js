'use strict';
// node test/gpu-foreign.test.js — 「남의 PC 가 이 PC GPU 로 이미지 만드는 중이면 TTS 를 기다린다」 검증.
//
// 배경(2026-08-26, v0.3.46): 로컬 ComfyUI 를 --listen 0.0.0.0 으로 열어 아내 PC·외부 노트북도 쓰게 했다.
//   그런데 앱의 GPU 레인(_runOnLanes)은 **같은 프로세스 안에서만** 작동한다 — 남의 PC 요청은 레인 밖이라
//   이 PC 의 TTS 와 3060 을 동시에 다툰다. 실측: TTS RTF 0.70→1.26(1.8배), 심하면 60초 타임아웃 3회 →
//   음성 40개/누락 898개인 **반쪽 .vrew**(v0.3.22).
//   해법: ComfyUI 는 큐 서버라 /queue 가 **누가 보냈든** 진실을 말해 준다 → TTS 시작 전에 그게 빌 때까지 기다린다.
//
// 지키는 것:
//   ① 큐가 바쁘면 기다리고, 비면 진행한다
//   ② **절대 막지 않는다** — 클라우드·서버꺼짐·HTTP오류·상한초과는 전부 그냥 진행(fail-open)
//   ③ TTS 경로에만 배선한다 — 이미지 경로에 넣으면 자기 자신을 기다려 교착된다
//
//   🔑 로직을 복사하지 않는다 — main.js 원문에서 함수를 뽑아 실행한다.

const fs = require('fs');
const path = require('path');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, m + '  (기대 ' + JSON.stringify(b) + ' / 실제 ' + JSON.stringify(a) + ')');

// ── main.js 원문에서 async 함수 통째로 뽑기 ──
function extractAsync(src, name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error(name + ' 를 찾을 수 없습니다(원문에 없음)');
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
const BODY = extractAsync(MAIN, 'awaitForeignComfyIdle');

// 의존성을 주입해 실행 가능한 함수로 만든다 (대기시간·상한은 테스트용으로 축소)
function build({ cfg, queues, cap = 200, throwOn = null, status = 200 }) {
  const logs = [];
  const calls = [];
  let idx = 0;
  const fakeRequire = () => ({ loadConfig: () => cfg });
  const fakeFetch = async (url) => {
    calls.push(url);
    if (throwOn === 'net') throw new Error('connect ECONNREFUSED');
    if (status !== 200) return { ok: false, status };
    const q = queues[Math.min(idx++, queues.length - 1)];
    return { ok: true, json: async () => q };
  };
  const fastTimeout = (fn) => { setTimeout(fn, 1); return 0; };
  const fn = new Function(
    'require', 'fetch', 'log', 'FOREIGN_GPU_WAIT_MS', 'setTimeout', 'AbortSignal',
    BODY + '\nreturn awaitForeignComfyIdle;'
  )(fakeRequire, fakeFetch, (m) => logs.push(m), cap, fastTimeout, { timeout: () => undefined });
  return { fn, logs, calls };
}

const LOCAL = { cloud: false, baseUrl: 'http://127.0.0.1:8188' };
const EMPTY = { queue_running: [], queue_pending: [] };
const BUSY = { queue_running: [{ id: 1 }], queue_pending: [] };

(async () => {
  // ① 큐가 비어 있으면 즉시 진행, 대기 로그 없음
  {
    const t = build({ cfg: LOCAL, queues: [EMPTY] });
    await t.fn('전체 TTS 변환');
    eq(t.calls.length, 1, '큐를 한 번만 확인한다');
    eq(t.calls[0], 'http://127.0.0.1:8188/queue', '/queue 로 정확히 요청한다');
    eq(t.logs.length, 0, '비어 있으면 로그를 남기지 않는다(평소에 조용하다)');
  }

  // ② 바쁘다가 비면 — 기다렸다 진행 + 로그 2줄
  {
    const t = build({ cfg: LOCAL, queues: [BUSY, BUSY, EMPTY] });
    await t.fn('전체 TTS 변환');
    ok(t.calls.length >= 3, '빌 때까지 폴링한다');
    ok(t.logs.some((m) => m.indexOf('다른 PC 가') >= 0), '대기 이유를 사람 말로 알린다');
    ok(t.logs.some((m) => m.indexOf('건).') >= 0 || m.indexOf('건)') >= 0), '몇 건이 도는지 알린다');
    ok(t.logs.some((m) => m.indexOf('비었습니다') >= 0), '시작할 때 알린다');
    eq(t.logs.filter((m) => m.indexOf('다른 PC 가') >= 0).length, 1, '대기 로그는 한 번만(폴링마다 도배하지 않는다)');
  }

  // ③ fail-open — 막지 않는다
  {
    const t = build({ cfg: { cloud: true, baseUrl: 'https://cloud.comfy.org' }, queues: [BUSY] });
    await t.fn('x');
    eq(t.calls.length, 0, '클라우드면 큐를 확인조차 하지 않는다(이 PC GPU 와 무관)');
  }
  {
    const t = build({ cfg: LOCAL, queues: [BUSY], throwOn: 'net' });
    await t.fn('x');
    eq(t.calls.length, 1, '서버에 못 닿으면 한 번만 시도하고 진행한다');
    eq(t.logs.length, 0, '못 닿는 것은 조용히 넘어간다');
  }
  {
    const t = build({ cfg: LOCAL, queues: [BUSY], status: 500 });
    await t.fn('x');
    eq(t.calls.length, 1, 'HTTP 오류면 그냥 진행한다');
  }
  {
    const t = build({ cfg: { cloud: false, baseUrl: '' }, queues: [BUSY] });
    await t.fn('x');
    eq(t.calls.length, 0, '주소가 비면 아무것도 하지 않는다');
  }

  // ④ 계속 바쁘면 상한에서 포기하고 진행 (무한 대기 금지)
  {
    const t = build({ cfg: LOCAL, queues: [BUSY], cap: 120 });
    const t0 = Date.now();
    await t.fn('전체 TTS 변환');
    const el = Date.now() - t0;
    ok(el < 3000, '상한을 넘으면 빠져나온다 (' + el + 'ms)');
    ok(t.logs.some((m) => m.indexOf('더 기다리지 않고 시작') >= 0), '포기했음을 경고로 남긴다');
  }

  // ⑤ 꼬리 슬래시 정리
  {
    const t = build({ cfg: { cloud: false, baseUrl: 'http://desktop-cbqlolj:8188///' }, queues: [EMPTY] });
    await t.fn('x');
    eq(t.calls[0], 'http://desktop-cbqlolj:8188/queue', '주소 꼬리 슬래시를 정리한다');
  }

  // ⑥ 배선 — TTS 경로에만. 이미지 경로에 넣으면 자기 자신을 기다려 교착된다.
  ok(MAIN.indexOf('await awaitForeignComfyIdle(label);') >= 0, 'TTS 잡에서 실제로 호출한다');
  const ttsFn = MAIN.slice(MAIN.indexOf('function enqueueTtsJob('), MAIN.indexOf('function enqueueTtsJob(') + 320);
  ok(ttsFn.indexOf('awaitForeignComfyIdle') >= 0, 'enqueueTtsJob 안에 있다');
  const imgFn = MAIN.slice(MAIN.indexOf('function enqueueImageJob('), MAIN.indexOf('function enqueueImageJob(') + 320);
  eq(imgFn.indexOf('awaitForeignComfyIdle') >= 0, false, 'enqueueImageJob 에는 없다(교착 방지)');
  ok(MAIN.indexOf('const FOREIGN_GPU_WAIT_MS') >= 0, '대기 상한 상수가 있다');
  ok(BODY.indexOf('/queue') >= 0, 'ComfyUI 큐를 진실로 삼는다');

  console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 남의 PC GPU 대기 ' + n + '/' + n + ' 통과');
  process.exit(bad ? 1 : 0);
})();
