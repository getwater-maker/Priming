'use strict';
// node test/gpu-lanes.test.js — 「내 PC GPU 를 쓰는 작업은 겹치지 않는다」 장치 검증.
//   배경(2026-08-20 로이): 이미지를 🖥 로컬 ComfyUI 로 만들면 OmniVoice TTS 와 **같은 3060** 을 쓴다 →
//   OOM·감속을 막으려면 둘 중 하나가 끝난 뒤 다음이 돌아야 한다. 예전엔 TTS 큐와 이미지 큐가 **별개**라
//   「🎤 TTS」 누른 뒤 「🖼 이미지」를 누르면 그대로 동시에 돌았다.
//   🔑 로직을 복사하지 않는다 — **main.js 원문에서 `_runOnLanes` 를 뽑아 실행**한다(앱과 갈라지면 실패).
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };

// ── 원문 대조 — 레인 배선이 그대로 있는지(끊기면 아래 시뮬레이션이 무의미) ──
ok(/const _LANES = \{ tts: Promise\.resolve\(\), image: Promise\.resolve\(\), localGpu: Promise\.resolve\(\) \}/.test(SRC),
   '레인 3개(tts·image·localGpu) 정의');
ok(SRC.includes("_runOnLanes(['tts', 'localGpu'], label,"), 'TTS 작업은 tts+localGpu 레인을 잡는다');
ok(/_imgUsesLocalGpu\(engine\) \? \['image', 'localGpu'\] : \['image'\]/.test(SRC),
   '이미지 작업은 로컬 ComfyUI 일 때만 localGpu 레인을 잡는다');
ok(/}, engine\);/.test(SRC), 'image-build·regen-group 이 engine 을 넘긴다(안 넘기면 레인을 안 잡는다)');
ok((SRC.match(/}, engine\);/g) || []).length >= 2, '두 진입점(전체 생성·단건 재생성) 모두 전달');
ok(/function _imgUsesLocalGpu\(engine\) \{[\s\S]{0,200}loadConfig\(\)\.cloud/.test(SRC), '설정의 cloud 를 실제로 읽는다');

// ── main.js 원문에서 _runOnLanes 를 뽑아 실행 ──
function extract(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' 를 main.js 에서 찾을 수 없습니다');
  let d = 0, started = false, j = i;
  for (; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return SRC.slice(i, j);
}
const logs = [];
const _runOnLanes = new Function('log', 'withAwake', '_LANES', '_lanePending',
  extract('_runOnLanes') + '\nreturn _runOnLanes;')(
  (m) => logs.push(m),
  (label, fn) => fn(),                       // 절전차단 래퍼는 그대로 통과
  { tts: Promise.resolve(), image: Promise.resolve(), localGpu: Promise.resolve() },
  { tts: 0, image: 0, localGpu: 0 },
);

// 동시에 몇 개가 돌았는지 기록하는 가짜 작업
let live = 0, maxLive = 0;
const order = [];
const job = (name, ms) => async () => {
  live++; maxLive = Math.max(maxLive, live);
  order.push('+' + name);
  await new Promise((r) => setTimeout(r, ms));
  order.push('-' + name);
  live--;
  return name;
};
const ttsJob = (name, ms) => _runOnLanes(['tts', 'localGpu'], name, job(name, ms));
const imgLocal = (name, ms) => _runOnLanes(['image', 'localGpu'], name, job(name, ms));
const imgCloud = (name, ms) => _runOnLanes(['image'], name, job(name, ms));

(async () => {
  // ① TTS + 로컬 이미지를 동시에 요청 → 절대 겹치지 않아야 한다(이번 요청의 핵심)
  live = 0; maxLive = 0; order.length = 0;
  await Promise.all([ttsJob('TTS', 60), imgLocal('로컬이미지', 40)]);
  ok(maxLive === 1, '🔴 TTS ∥ 로컬 이미지 → 동시 실행 0 (실제 최대 ' + maxLive + ')');
  ok(order.join(' ') === '+TTS -TTS +로컬이미지 -로컬이미지', '들어온 순서대로 하나씩: ' + order.join(' '));

  // ② TTS + 클라우드 이미지 → 병렬 유지(예전 이득을 잃지 않는다)
  live = 0; maxLive = 0; order.length = 0;
  await Promise.all([ttsJob('TTS', 50), imgCloud('클라우드이미지', 50)]);
  ok(maxLive === 2, 'TTS ∥ 클라우드 이미지 → 병렬 유지 (실제 최대 ' + maxLive + ')');

  // ③ 로컬 이미지 2건 → 서로도 겹치지 않는다(브라우저·GPU 양쪽 이유)
  live = 0; maxLive = 0;
  await Promise.all([imgLocal('A', 30), imgLocal('B', 30)]);
  ok(maxLive === 1, '로컬 이미지끼리도 순차');

  // ④ 앞 작업이 실패해도 다음 작업은 실행된다(손실 방지)
  const done = [];
  const boom = _runOnLanes(['tts', 'localGpu'], '실패작업', async () => { throw new Error('boom'); }).catch(() => done.push('실패처리'));
  const after = _runOnLanes(['tts', 'localGpu'], '다음작업', async () => { done.push('다음실행'); });
  await Promise.all([boom, after]);
  ok(done.includes('다음실행'), '앞 작업이 실패해도 다음 작업이 실행된다');

  // ⑤ 대기할 때 사용자에게 알린다
  logs.length = 0;
  await Promise.all([ttsJob('T1', 30), imgLocal('I1', 10)]);
  ok(logs.some((l) => l.includes('내 PC GPU') && l.includes('끝난 뒤')), '대기 로그에 이유가 남는다: ' + (logs[0] || '(없음)'));

  // ⑥ 섞어 돌린 뒤에도 레인이 막히지 않는다(카운터 누수 없음)
  live = 0; maxLive = 0;
  await Promise.all([ttsJob('x', 10), imgCloud('y', 10), imgLocal('z', 10)]);
  ok(maxLive === 2, '클라우드 이미지만 TTS 와 겹친다 (실제 최대 ' + maxLive + ')');
  const last = await ttsJob('마지막', 5);
  ok(last === '마지막', '이후 작업도 정상 실행(레인 누수 없음)');

  console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ GPU 레인 ' + n + '/' + n + ' 통과');
  process.exit(bad ? 1 : 0);
})();
