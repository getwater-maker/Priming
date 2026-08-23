'use strict';
/**
 * test/comfy-perf.test.js — 이미지 생성이 갑자기 느려지던 원인들에 대한 회귀 테스트 (2026-08-24)
 *
 *   ① ComfyUI 두 벌(포트 밀림) → RAM 고갈 → 장당 28초가 498초 · 300초 타임아웃 실패
 *   ② 로컬에 fp8 파일이 생기자 자동 대체가 멈춰 에뮬레이션 fp8 로 떨어짐(3060 실측 44.0s vs 25.4s)
 *   ③ 프롬프트를 앱이 직접 넣는데도 LLM 확장 가지가 살아 있어 첫 장 14초 낭비
 *
 * 🔑 앱 원문을 그대로 require 한다 — 로직을 복사해 두면 앱과 갈라져도 통과해 아무것도 못 지킨다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const CM = require('../core/comfy-models');
const CP = require('../core/comfy-perf');
const { pruneToImageOutputs } = require('../core/comfy-image');

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

const WF = path.join(__dirname, '..', 'comfy', 'image_krea2_turbo_t2i (2).json');
const FP8 = 'krea2_turbo_fp8_scaled.safetensors';
const INT8 = 'krea2_turbo_int8_convrot.safetensors';
// 로컬 실측 목록(2026-08-24)
const LOCAL_UNETS = [FP8, INT8, 'z_image_turbo_bf16.safetensors'];
const loadWf = () => JSON.parse(fs.readFileSync(WF, 'utf8'));
const clipIdOf = (g) => Object.keys(g).find((id) => /CLIPTextEncode/i.test(g[id].class_type || ''));
const hasClass = (g, re) => Object.values(g).some((x) => new RegExp(re, 'i').test(x.class_type || ''));

(async () => {

console.log('\n[1] GPU 가 fp8 을 하드웨어로 돌리는가');
ok('RTX 3060 = false(에뮬레이션)', () => assert.strictEqual(CM.isFp8NativeGpu('NVIDIA GeForce RTX 3060'), false));
ok('ComfyUI 가 주는 실제 문자열도 false', () =>
  assert.strictEqual(CM.isFp8NativeGpu('cuda:0 NVIDIA GeForce RTX 3060 : cudaMallocAsync'), false));
ok('RTX 4090 = true', () => assert.strictEqual(CM.isFp8NativeGpu('NVIDIA GeForce RTX 4090'), true));
ok('RTX 5080 = true', () => assert.strictEqual(CM.isFp8NativeGpu('NVIDIA GeForce RTX 5080'), true));
ok('H100 = true', () => assert.strictEqual(CM.isFp8NativeGpu('NVIDIA H100 PCIe'), true));
ok('A100 = false', () => assert.strictEqual(CM.isFp8NativeGpu('NVIDIA A100-SXM4-40GB'), false));
ok('RTX 2080 Ti = false', () => assert.strictEqual(CM.isFp8NativeGpu('NVIDIA GeForce RTX 2080 Ti'), false));
ok('빈 값 = null(판단 보류)', () => assert.strictEqual(CM.isFp8NativeGpu(''), null));
ok('낯선 이름 = null — 모르면 손대지 않는다', () => assert.strictEqual(CM.isFp8NativeGpu('Some Future GPU X1'), null));

console.log('\n[2] 같은 모델의 더 빠른 판 고르기');
ok('3060 + fp8 요구 + int8 있음 → int8_convrot', () =>
  assert.strictEqual(CM.pickFasterQuant(FP8, LOCAL_UNETS, 'NVIDIA GeForce RTX 3060'), INT8));
ok('4090 이면 바꾸지 않는다(fp8 이 더 빠름)', () =>
  assert.strictEqual(CM.pickFasterQuant(FP8, LOCAL_UNETS, 'NVIDIA GeForce RTX 4090'), null));
ok('GPU 를 모르면 바꾸지 않는다', () =>
  assert.strictEqual(CM.pickFasterQuant(FP8, LOCAL_UNETS, 'Unknown GPU'), null));
ok('이미 int8 이면 바꾸지 않는다', () =>
  assert.strictEqual(CM.pickFasterQuant(INT8, LOCAL_UNETS, 'NVIDIA GeForce RTX 3060'), null));
ok('fp8 판이 아니면(bf16) 손대지 않는다', () =>
  assert.strictEqual(CM.pickFasterQuant('z_image_turbo_bf16.safetensors', LOCAL_UNETS, 'NVIDIA GeForce RTX 3060'), null));
ok('같은 모델의 int8 판이 없으면 null', () =>
  assert.strictEqual(CM.pickFasterQuant(FP8, [FP8, 'z_image_turbo_bf16.safetensors'], 'NVIDIA GeForce RTX 3060'), null));
ok('🔴 다른 모델로 넘어가지 않는다 — turbo 는 정체성 토큰', () => {
  const got = CM.pickFasterQuant('z_image_turbo_fp8.safetensors', ['z_image_int8.safetensors'], 'NVIDIA GeForce RTX 3060');
  assert.strictEqual(got, null, 'z_image_turbo → z_image 로 바꾸면 엉뚱한 모델로 조용히 그린다');
});
ok('convrot 판을 우선한다(실측 가장 빠름)', () =>
  assert.strictEqual(CM.pickFasterQuant(FP8, ['krea2_turbo_int8.safetensors', INT8], 'NVIDIA GeForce RTX 3060'), INT8));
ok('모델 파일이 아닌 문자열은 건드리지 않는다', () =>
  assert.strictEqual(CM.pickFasterQuant('fp8 라는 말이 든 평범한 프롬프트', LOCAL_UNETS, 'NVIDIA GeForce RTX 3060'), null));

console.log('\n[3] 그래프 전체에 적용 (applyFasterQuant)');
ok('실제 워크플로의 UNET 이 int8 로 바뀐다', () => {
  const g = loadWf();
  const r = CM.applyFasterQuant(g, { unet_name: LOCAL_UNETS }, 'NVIDIA GeForce RTX 3060');
  assert.strictEqual(r.changes.length, 1, '바뀐 것이 정확히 1개(UNET)여야 한다');
  assert.strictEqual(r.changes[0].from, FP8);
  assert.strictEqual(r.changes[0].to, INT8);
  const unet = Object.values(g).find((x) => /UNETLoader/i.test(x.class_type || ''));
  assert.strictEqual(unet.inputs.unet_name, INT8, '그래프에 실제로 반영돼야 한다');
});
ok('CLIP 은 대체본이 없어 그대로다', () => {
  const g = loadWf();
  CM.applyFasterQuant(g, { unet_name: LOCAL_UNETS, clip_name: ['qwen3vl_4b_fp8_scaled.safetensors'] }, 'NVIDIA GeForce RTX 3060');
  const clip = Object.values(g).find((x) => /CLIPLoader/i.test(x.class_type || ''));
  assert.strictEqual(clip.inputs.clip_name, 'qwen3vl_4b_fp8_scaled.safetensors');
});
ok('목록을 못 받았으면 아무것도 바꾸지 않는다', () => {
  const g = loadWf();
  assert.strictEqual(CM.applyFasterQuant(g, {}, 'NVIDIA GeForce RTX 3060').changes.length, 0);
});
ok('fp8 네이티브 GPU 면 그래프가 그대로다', () => {
  const g = loadWf();
  const before = JSON.stringify(g);
  CM.applyFasterQuant(g, { unet_name: LOCAL_UNETS }, 'NVIDIA GeForce RTX 4090');
  assert.strictEqual(JSON.stringify(g), before);
});

console.log('\n[4] 이미지에 안 쓰이는 가지 걷어내기 (pruneToImageOutputs)');
ok('LLM 프롬프트 확장 체인이 사라진다', () => {
  const g = loadWf();
  g[clipIdOf(g)].inputs.text = 'OUR PROMPT';   // 앱과 같이 프롬프트를 리터럴로 덮어쓴다
  const r = pruneToImageOutputs(g);
  assert.ok(r.removed.length >= 8, '제거 수가 너무 적다: ' + r.removed.length);
  assert.ok(!hasClass(g, 'TextGenerate'), 'TextGenerate 가 남아 있다');
  assert.ok(!hasClass(g, 'PreviewAny'), 'PreviewAny 가 남아 있다');
});
ok('이미지 생성 경로는 온전히 남는다', () => {
  const g = loadWf();
  const pid = clipIdOf(g);
  g[pid].inputs.text = 'OUR PROMPT';
  pruneToImageOutputs(g);
  for (const need of ['SaveImage', 'KSampler', 'VAEDecode', 'UNETLoader', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'EmptyLatentImage']) {
    assert.ok(hasClass(g, need), need + ' 가 사라졌다');
  }
  assert.strictEqual(g[pid].inputs.text, 'OUR PROMPT', '우리 프롬프트가 유지돼야 한다');
});
ok('LoRA 도 남는다(화풍이 걸려 있다)', () => {
  const g = loadWf();
  g[clipIdOf(g)].inputs.text = 'X';
  pruneToImageOutputs(g);
  assert.ok(hasClass(g, 'Lora'), 'LoRA 가 사라지면 화풍이 바뀐다');
});
ok('🔑 이미지 출력 노드가 없으면 아무것도 안 한다(fail-open)', () => {
  const g = { 1: { class_type: 'TextGenerate', inputs: {} }, 2: { class_type: 'SaveAudio', inputs: { a: ['1', 0] } } };
  const r = pruneToImageOutputs(g);
  assert.strictEqual(r.skipped, 'no-image-output');
  assert.strictEqual(Object.keys(g).length, 2, '낯선 워크플로를 건드리면 안 된다');
});
ok('링크로 이어진 노드는 절대 지우지 않는다', () => {
  const g = {
    1: { class_type: 'SaveImage', inputs: { images: ['2', 0] } },
    2: { class_type: 'VAEDecode', inputs: { samples: ['3', 0] } },
    3: { class_type: 'KSampler', inputs: { model: ['4', 0] } },
    4: { class_type: 'UNETLoader', inputs: { unet_name: 'x.safetensors' } },
    9: { class_type: 'PreviewAny', inputs: { source: ['10', 0] } },
    10: { class_type: 'TextGenerate', inputs: {} },
  };
  const r = pruneToImageOutputs(g);
  assert.deepStrictEqual(r.removed.slice().sort(), ['10', '9']);
  assert.deepStrictEqual(Object.keys(g).sort(), ['1', '2', '3', '4']);
});
ok('PreviewImage 도 이미지 출력이라 살린다', () => {
  const g = {
    1: { class_type: 'PreviewImage', inputs: { images: ['2', 0] } },
    2: { class_type: 'VAEDecode', inputs: {} },
    9: { class_type: 'PreviewAny', inputs: { source: ['10', 0] } },
    10: { class_type: 'TextGenerate', inputs: {} },
  };
  pruneToImageOutputs(g);
  assert.deepStrictEqual(Object.keys(g).sort(), ['1', '2']);
});

console.log('\n[5] 중복 ComfyUI 서버 감지 (scanRivals)');
const mkFetch = (map) => async (url) => {
  const m = String(url).match(/:(\d+)\//);
  const port = m ? Number(m[1]) : 0;
  if (!(port in map)) throw new Error('ECONNREFUSED');
  return { ok: true, json: async () => map[port] };
};
const COMFY_BODY = (vramFreeMB, ramFreeGB) => ({
  system: { comfyui_version: '0.33.3', ram_free: ramFreeGB * 1073741824 },
  devices: [{ name: 'NVIDIA GeForce RTX 3060', vram_free: vramFreeMB * 1048576, vram_total: 12287 * 1048576 }],
});
await okAsync('8189 에 뜬 두 번째 서버를 찾는다', async () => {
  const r = await CP.scanRivals({ baseUrl: 'http://127.0.0.1:8188', fetchFn: mkFetch({ 8189: COMFY_BODY(5009, 2.3) }) });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].port, 8189);
  assert.strictEqual(r[0].version, '0.33.3');
  assert.strictEqual(r[0].vramFreeMB, 5009);
});
await okAsync('아무것도 안 떠 있으면 빈 배열', async () => {
  assert.deepStrictEqual(await CP.scanRivals({ baseUrl: 'http://127.0.0.1:8188', fetchFn: mkFetch({}) }), []);
});
await okAsync('ComfyUI 가 아닌 서버는 무시한다', async () => {
  assert.deepStrictEqual(await CP.scanRivals({ baseUrl: 'http://127.0.0.1:8188', fetchFn: mkFetch({ 8190: { hello: 'world' } }) }), []);
});
await okAsync('우리 포트는 스캔하지 않는다(자기 자신을 신고하면 안 된다)', async () => {
  assert.deepStrictEqual(await CP.scanRivals({ baseUrl: 'http://127.0.0.1:8188', fetchFn: mkFetch({ 8188: COMFY_BODY(1, 1) }) }), []);
});
await okAsync('우리 포트가 8189 면 8190 부터 본다', async () => {
  const r = await CP.scanRivals({ baseUrl: 'http://localhost:8189', fetchFn: mkFetch({ 8188: COMFY_BODY(1, 1), 8190: COMFY_BODY(1, 1) }) });
  assert.deepStrictEqual(r.map((x) => x.port), [8190]);
});

console.log('\n[6] 진단 문구 (diagnoseLocal)');
await okAsync('🔴 실사고 재현 — 중복 서버 + RAM 2.2GB → 경고 2건', async () => {
  const d = await CP.diagnoseLocal({
    baseUrl: 'http://127.0.0.1:8188',
    fetchFn: mkFetch({ 8189: COMFY_BODY(5009, 2.3) }),
    freeFn: () => 2.2 * 1073741824,
  });
  assert.strictEqual(d.warnings.length, 2, '두 벌 + RAM 부족 = 2건');
  assert.ok(/두 벌/.test(d.warnings[0]), '무엇이 문제인지 한국어로 말해야 한다');
  assert.ok(/8189/.test(d.warnings[0]), '어느 포트인지 알려줘야 한다');
  assert.ok(/닫으세요/.test(d.warnings[0]), '무엇을 해야 하는지 알려줘야 한다');
  assert.strictEqual(d.ramFreeGB, 2.2);
});
await okAsync('정상(서버 하나 · RAM 16.8GB) → 경고 없음', async () => {
  const d = await CP.diagnoseLocal({ baseUrl: 'http://127.0.0.1:8188', fetchFn: mkFetch({}), freeFn: () => 16.8 * 1073741824 });
  assert.deepStrictEqual(d.warnings, []);
});
await okAsync('RAM 만 부족해도 알린다', async () => {
  const d = await CP.diagnoseLocal({ baseUrl: 'http://127.0.0.1:8188', fetchFn: mkFetch({}), freeFn: () => 4 * 1073741824 });
  assert.strictEqual(d.warnings.length, 1);
  assert.ok(/RAM/.test(d.warnings[0]));
});
await okAsync('진단이 예외를 던지지 않는다(작업을 막으면 본말전도)', async () => {
  const d = await CP.diagnoseLocal({
    baseUrl: 'http://127.0.0.1:8188',
    fetchFn: async () => { throw new Error('boom'); },
    freeFn: () => 32 * 1073741824,
  });
  assert.deepStrictEqual(d.warnings, []);
});

console.log('\n[7] 앱 배선 원문 대조 (복사본이 아니라 실제로 호출되는지)');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const IMG = fs.readFileSync(path.join(__dirname, '..', 'core', 'comfy-image.js'), 'utf8');
ok('main.js 가 이미지·비디오 두 경로에서 진단을 부른다', () =>
  assert.strictEqual((MAIN.match(/comfy-perf'\)\.diagnoseLocal/g) || []).length, 2));
ok('comfy-image 가 생성 직전 _preferFastQuant 를 부른다', () =>
  assert.ok(/await this\._preferFastQuant\(graph\);\s*\n\s*const promptId = await this\._queueFixing\(graph\)/.test(IMG),
    '그래프를 만든 뒤 큐에 넣기 전에 불려야 한다'));
ok('_buildWorkflow 가 프롬프트를 덮어썼을 때만 프루닝한다', () =>
  assert.ok(/if \(promptFixed\) \{\s*\n\s*const pr = pruneToImageOutputs\(graph\)/.test(IMG)));
ok('클라우드에서는 판 교체를 하지 않는다', () =>
  assert.ok(/if \(this\.cloud \|\| this\.preferFastQuant === false\) return;/.test(IMG)));
ok('판 교체 판단은 세션당 1회(두 번째 장부터 왕복 0)', () =>
  assert.ok(/if \(this\._fastQuantMemo\) \{/.test(IMG), '기억해 둔 값을 재사용해야 한다'));
ok('main.js 는 LF 로 저장돼 있다', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'latin1');
  assert.strictEqual((raw.match(/\r\n/g) || []).length, 0, 'CRLF 면 원문 대조 테스트들이 거짓 실패한다');
});

console.log('\n' + (fails ? '❌' : '✅') + ' comfy-perf: ' + (n - fails) + '/' + n + ' 통과' + (fails ? ' · 실패 ' + fails : ''));
process.exit(fails ? 1 : 0);

})().catch((e) => { console.error('테스트 실행 실패:', e); process.exit(1); });
