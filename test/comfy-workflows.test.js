'use strict';
// node test/comfy-workflows.test.js — 번들 이미지 워크플로 정합 검증.
//
// 배경(2026-08-26): 로이가 `krea2Int4Convrot_v10Turbo.safetensors` 를 받아 "새 LoRA" 로 알고 있었는데
//   실제로는 **본체 확산 모델(UNET)** 이었다(`models/diffusion_models/`, 6.9GB · 로컬 /object_info 의
//   UNETLoader 목록에 잡힘). 그래서 LoRA 노드가 아니라 UNETLoader 를 바꾼 워크플로를 하나 더 등록했다.
//   RTX 3060 실측(같은 프롬프트·같은 seed·같은 LoRA): warm **13.5s vs int8 20.3s = 1.50배 빠름**.
//
// 지키는 것:
//   ① 번들 워크플로 파일이 실재하고 **API 포맷**이다(UI 포맷이면 앱이 못 읽는다)
//   ② int4 판은 **UNETLoader 하나만** 다르다 — CLIP·VAE·LoRA 가 함께 바뀌면 그림이 통째로 달라진다
//   ③ 모델 자동 대체(v0.3.22/v0.3.35)가 int4 를 **조용히 다른 모델로 바꾸지 않는다**
//   ④ 기존 Krea2(fp8 요청)의 int8 자동 교체는 그대로 살아 있다

const fs = require('fs');
const path = require('path');
const CM = require('../core/comfy-models');

const ROOT = path.join(__dirname, '..');
const R = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IMG_SRC = R('core', 'comfy-image.js');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, m + `  (기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)})`);

const KREA2 = 'comfy/image_krea2_turbo_t2i (2).json';
const INT4  = 'comfy/image_krea2_int4_turbo.json';
const INT4_MODEL = 'krea2Int4Convrot_v10Turbo.safetensors';

// ── ① 번들 파일 실재 + API 포맷 ──
const BUNDLED_FILES = ['comfy/image_z_image_turbo.json', KREA2, INT4];
for (const f of BUNDLED_FILES) {
  const abs = path.join(ROOT, f);
  ok(fs.existsSync(abs), '번들 워크플로가 실재한다: ' + f);
  if (!fs.existsSync(abs)) continue;
  let g = null;
  try { g = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) {}
  ok(g && typeof g === 'object' && !Array.isArray(g), 'JSON 객체다: ' + f);
  // API 포맷은 { "<id>": { class_type, inputs } } — UI 포맷은 최상위에 nodes[] 배열을 갖는다
  ok(g && !g.nodes, 'UI 포맷이 아니다(최상위 nodes[] 없음): ' + f);
  ok(g && Object.values(g).every((v) => v && typeof v.class_type === 'string'),
     '모든 노드가 class_type 을 갖는다(API 포맷): ' + f);
}

// ── ② int4 판은 UNETLoader 하나만 다르다 ──
const a = JSON.parse(R(KREA2));
const b = JSON.parse(R(INT4));
eq(Object.keys(b).length, Object.keys(a).length, 'int4 판의 노드 수가 원본과 같다');
const diff = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
eq(diff.length, 1, 'int4 판은 노드 1개만 다르다');
const changed = diff[0] && b[diff[0]];
ok(changed && changed.class_type === 'UNETLoader', '다른 노드가 UNETLoader 다(본체 모델만 교체)');
eq(changed && changed.inputs.unet_name, INT4_MODEL, 'int4 판의 unet_name 이 새 모델이다');

const loraOf = (g) => Object.values(g).find((x) => /Lora/i.test(x.class_type || ''));
eq(JSON.stringify(loraOf(b) && loraOf(b).inputs), JSON.stringify(loraOf(a) && loraOf(a).inputs),
   'LoRA(krea2_darkbrush · strength)가 원본과 동일하다');
const oneOf = (g, cls) => Object.values(g).filter((x) => x.class_type === cls);
eq(oneOf(b, 'UNETLoader').length, 1, 'UNETLoader 는 정확히 1개');
eq(JSON.stringify(oneOf(b, 'CLIPLoader')[0].inputs), JSON.stringify(oneOf(a, 'CLIPLoader')[0].inputs), 'CLIP 은 그대로');
eq(JSON.stringify(oneOf(b, 'VAELoader')[0].inputs), JSON.stringify(oneOf(a, 'VAELoader')[0].inputs), 'VAE 는 그대로');

// ── ③ 자동 대체가 int4 를 조용히 바꾸지 않는다 ──
//   로컬 서버가 실제로 갖고 있는 목록(2026-08-26 실측)
const AVAIL = [
  'krea2Int4Convrot_v10Turbo.safetensors',
  'krea2_turbo_fp8_scaled.safetensors',
  'krea2_turbo_int8_convrot.safetensors',
  'z_image_turbo_bf16.safetensors',
];
const GPU_3060 = 'cuda:0 NVIDIA GeForce RTX 3060 : cudaMallocAsync';
eq(CM.isFp8NativeGpu(GPU_3060), false, 'RTX 3060 은 fp8 비네이티브로 판정된다');
eq(CM.pickFasterQuant(INT4_MODEL, AVAIL, GPU_3060), null, 'int4 는 "더 빠른 판" 교체 대상이 아니다(그대로 쓴다)');
eq(CM.pickSubstitute(INT4_MODEL, AVAIL), null, 'int4 가 목록에 있으면 대체하지 않는다');
ok(CM.baseKey(INT4_MODEL) !== CM.baseKey('krea2_turbo_int8_convrot.safetensors'),
   'int4 는 krea2_turbo 계열과 다른 모델로 취급된다(정체성이 바뀌는 대체 금지)');
// 파일명을 계열 규칙에 맞게 바꿔도 fp8 판이 아니므로 교체 대상이 아니다
eq(CM.pickFasterQuant('krea2_turbo_int4_convrot.safetensors', AVAIL, GPU_3060), null,
   '이름을 krea2_turbo_int4_convrot 로 바꿔도 자동 교체되지 않는다');

// ── ④ 기존 Krea2(fp8 요청)의 int8 자동 교체는 살아 있다 ──
eq(CM.pickFasterQuant('krea2_turbo_fp8_scaled.safetensors', AVAIL, GPU_3060),
   'krea2_turbo_int8_convrot.safetensors', '3060 에서 fp8 → int8_convrot 자동 교체(기존 동작 보존)');
eq(oneOf(a, 'UNETLoader')[0].inputs.unet_name, 'krea2_turbo_fp8_scaled.safetensors',
   '원본 Krea2 워크플로는 건드리지 않았다');

// ── ⑤ 앱에 등록됐는지 (원문 + 실제 loadConfig 대조) ──
ok(/image_krea2_int4_turbo\.json/.test(IMG_SRC), 'comfy-image.js BUNDLED 에 int4 워크플로가 있다');
ok(IMG_SRC.includes("name: 'Krea2 int4 Turbo (로컬)'"), '드롭다운 이름에 「로컬」 표시가 있다(클라우드엔 이 모델이 없다)');
const cfg = require('../core/comfy-image').loadConfig();   // 읽기 전용(파일 재기록 없음)
const names = (cfg.workflows || []).map((w) => path.basename(String(w.path)).toLowerCase());
ok(names.includes('image_krea2_int4_turbo.json'), 'loadConfig() 결과의 워크플로 목록에 실제로 등록된다');
ok(names.includes('image_krea2_turbo_t2i (2).json'), '기존 Krea2 도 그대로 남아 있다');

// ── ⑥ Qwen-Image 2.1 Turbo (v0.7.80) ──
const QWEN = 'comfy/image_qwen21_turbo.json';
ok(fs.existsSync(path.join(ROOT, QWEN)), '번들 워크플로가 실재한다: ' + QWEN);
const q = JSON.parse(R(QWEN));
ok(!q.nodes && Object.values(q).every((v) => v && typeof v.class_type === 'string'), 'Qwen 워크플로는 API 포맷이다');
ok(IMG_SRC.includes("name: 'Qwen-Image 2.1 Turbo (로컬)'"), 'Qwen 드롭다운 이름에 「로컬」 표시가 있다(클라우드 보유 미확인 → 반대쪽 그룹에서 감춘다)');
ok(names.includes('image_qwen21_turbo.json'), 'loadConfig() 결과의 워크플로 목록에 Qwen Turbo 가 등록된다');
{
  const { ComfyImage } = require('../core/comfy-image');
  const eng = new ComfyImage({ baseUrl: 'http://127.0.0.1:8188', workflowPath: path.join(ROOT, QWEN) });
  const g = eng._buildWorkflow('A TEST PROMPT.', '16:9', { seed: 4242 });
  const enc = Object.values(g).find((x) => x.class_type === 'TextEncodeQwenImage21');
  eq(enc && enc.inputs.prompt, 'A TEST PROMPT.', '프롬프트가 TextEncodeQwenImage21.prompt 에 들어간다(CLIPTextEncode 가 아니어도)');
  const lat = Object.values(g).find((x) => 'width' in x.inputs);
  eq(lat && lat.inputs.width + 'x' + lat.inputs.height, '1344x768', '16:9 는 1344x768(앱 기본 크기)로 주입된다');
  const ks = Object.values(g).find((x) => x.class_type === 'KSampler');
  eq(ks && ks.inputs.seed, 4242, '고정 시드가 KSampler 에 들어간다');
  eq(ks && ks.inputs.steps + '/' + ks.inputs.cfg, '8/1', 'Turbo 설정 8스텝 · cfg 1');
  eq(Object.keys(g).length, Object.keys(q).length, '이미지 출력에 쓰이는 노드는 걷어내지 않는다');
  const g2 = eng._buildWorkflow('', '16:9', {});
  eq(Object.values(g2).find((x) => x.class_type === 'TextEncodeQwenImage21').inputs.prompt, '', '프롬프트가 비면 건드리지 않는다');
  // 판정력: 옛 코드(CLIPTextEncode·text 만 찾음)였다면 prompt 가 그대로 비어 있었을 것이다
  ok(!Object.values(q).some((x) => /CLIPTextEncode/i.test(x.class_type)), 'Qwen 워크플로엔 CLIPTextEncode 가 없다(→ 새 분기가 실제로 쓰인다)');
}

// ── ⑦ Qwen-Image 2512 Lightning (v0.7.91 · 🔴 Apache 2.0 — 2.1 의 연구용 라이선스 문제를 피하는 상업 안전 선택지) ──
{
  const F = 'comfy/image_qwen_image_2512_lightning.json';
  ok(fs.existsSync(path.join(ROOT, F)), '번들 워크플로가 실재한다: ' + F);
  const w = JSON.parse(R(F));
  ok(!w.nodes && Object.values(w).every((v) => v && typeof v.class_type === 'string'), '2512 워크플로는 API 포맷이다');
  ok(IMG_SRC.includes("name: 'Qwen-Image 2512 Lightning (로컬)'") && IMG_SRC.includes('Apache 2.0'), '이름에 「로컬」 + 라이선스 근거(Apache 2.0)를 주석으로 남겼다');
  ok(names.includes('image_qwen_image_2512_lightning.json'), 'loadConfig() 목록에 2512 가 등록된다');
  ok(!Object.values(w).some((x) => x.class_type === 'TextEncodeQwenImage21'), '2.1 전용 노드를 쓰지 않는다(그래서 2.1 연구용 라이선스 대상이 아니다 — 2512 는 일반 CLIPTextEncode)');
  const unet = Object.values(w).find((x) => x.class_type === 'UNETLoader').inputs.unet_name;
  ok(/2512/.test(unet) && !/2\.1/.test(unet), 'UNET 은 2512(2.1 이 아니다): ' + unet);
  const lora = Object.values(w).find((x) => x.class_type === 'LoraLoaderModelOnly').inputs.lora_name;
  ok(/2512-Lightning-4steps/.test(lora), 'Lightning 4스텝 LoRA(8스텝은 1.7배 느리고 개선이 눈에 띄지 않았다)');
  ok(Object.values(w).find((x) => x.class_type === 'KSampler').inputs.steps === 4 && Object.values(w).find((x) => x.class_type === 'KSampler').inputs.cfg === 1, '4스텝 · cfg 1');
  const { ComfyImage } = require('../core/comfy-image');
  const e2 = new ComfyImage({ baseUrl: 'http://127.0.0.1:8188', workflowPath: path.join(ROOT, F) });
  const g2 = e2._buildWorkflow('HELLO.', '16:9', { seed: 99 });
  ok(g2['5'].inputs.text === 'HELLO.' && g2['6'].inputs.text === '', '프롬프트는 긍정 칸(5)에만 · 부정 칸(6)은 비어 있다(키 순서로 5 가 먼저 잡힌다)');
  ok(g2['7'].inputs.width + 'x' + g2['7'].inputs.height === '1344x768' && g2['8'].inputs.seed === 99, '해상도·시드 주입');
  const CIM = require('../core/comfy-image');
  ok(!CIM.supportsRefs(w), '2512 는 인물 참조·그림 고치기(2.1 전용)를 쓰지 않는다 — supportsRefs 거짓');
}

console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 번들 워크플로 ' + n + '/' + n + ' 통과');
process.exit(bad ? 1 : 0);
