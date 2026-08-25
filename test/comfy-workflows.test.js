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
ok(/name: 'Krea2 int4 Turbo'/.test(IMG_SRC), '드롭다운 이름이 지정돼 있다');
const cfg = require('../core/comfy-image').loadConfig();   // 읽기 전용(파일 재기록 없음)
const names = (cfg.workflows || []).map((w) => path.basename(String(w.path)).toLowerCase());
ok(names.includes('image_krea2_int4_turbo.json'), 'loadConfig() 결과의 워크플로 목록에 실제로 등록된다');
ok(names.includes('image_krea2_turbo_t2i (2).json'), '기존 Krea2 도 그대로 남아 있다');

console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 번들 워크플로 ' + n + '/' + n + ' 통과');
process.exit(bad ? 1 : 0);
