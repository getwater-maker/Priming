'use strict';
// node test/comfy-models.test.js — 모델 파일명 자동 보정(core/comfy-models.js) 단위검증.
//   지키려는 것: ① 같은 모델의 다른 정밀도 판으로만 바꾼다 ② 다른 모델로는 절대 안 바꾼다(조용한 오작동 방지)
//               ③ 실제 서버 오류 응답에서 목록을 뽑아낸다 ④ 엔진이 이 보정을 실제로 거친다.
const path = require('path');
const fs = require('fs');
const M = require('../core/comfy-models');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' — 실제 ' + JSON.stringify(a));

// ── ① baseKey — 정밀도 토큰만 떼고 모델 정체성은 남긴다 ──
eq(M.baseKey('krea2_turbo_fp8_scaled.safetensors'), 'krea2 turbo', 'fp8_scaled 제거');
eq(M.baseKey('krea2_turbo_int8_convrot.safetensors'), 'krea2 turbo', 'int8_convrot 제거 → 같은 키');
eq(M.baseKey('krea2_turbo_nvfp4.safetensors'), 'krea2 turbo', 'nvfp4 제거');
eq(M.baseKey('z_image_turbo_bf16.safetensors'), 'z image turbo', 'turbo 는 남는다(모델 정체성)');
eq(M.baseKey('z_image_bf16.safetensors'), 'z image', 'turbo 아닌 판은 다른 키');
eq(M.baseKey('ltx-2.5-22b-distilled-transformer-bf16.safetensors'), 'ltx 2 5 22b distilled transformer', 'distilled 는 남는다');
eq(M.baseKey('ltx-2.5-22b-dev-transformer-bf16.safetensors'), 'ltx 2 5 22b dev transformer', 'dev 는 남는다');

// ── ② pickSubstitute — 같은 모델만, 아니면 null ──
const LOCAL = ['krea2_turbo_int8_convrot.safetensors', 'z_image_turbo_bf16.safetensors'];
eq(M.pickSubstitute('krea2_turbo_fp8_scaled.safetensors', LOCAL), 'krea2_turbo_int8_convrot.safetensors', '로컬의 int8 판으로 대체');
eq(M.pickSubstitute('z_image_turbo_bf16.safetensors', LOCAL), null, '이미 있는 파일은 건드리지 않는다');
eq(M.pickSubstitute('z_image_turbo_bf16.safetensors', ['z_image_bf16.safetensors', 'pixel_space']), null,
   '🔴 turbo → 비-turbo 로는 바꾸지 않는다(다른 모델)');
eq(M.pickSubstitute('krea2_turbo_fp8_scaled.safetensors', ['z_image_turbo_bf16.safetensors']), null, '전혀 다른 모델이면 null');
eq(M.pickSubstitute('krea2_turbo_fp8_scaled.safetensors', []), null, '빈 목록이면 null');
eq(M.pickSubstitute('', LOCAL), null, '빈 이름이면 null');
eq(M.pickSubstitute('ltx-2.5-22b-distilled-transformer-bf16.safetensors',
   ['ltx-2.5-22b-dev-transformer-bf16.safetensors', 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors']),
   'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors', 'distilled 는 distilled 로만(dev 로 안 감)');
// 후보가 여럿이면 원래 정밀도와 겹치는 것 우선
eq(M.pickSubstitute('krea2_turbo_fp8_scaled.safetensors', ['krea2_turbo_bf16.safetensors', 'krea2_turbo_fp8_e4m3fn.safetensors']),
   'krea2_turbo_fp8_e4m3fn.safetensors', '같은 fp8 계열을 먼저 고른다');

// ── ③ 실제 서버 오류(2026-08-20 로그 원문)에서 목록 뽑기 ──
const REAL = { '30:10': { errors: [{
  type: 'value_not_in_list', message: 'Value not in list',
  details: "unet_name: 'krea2_turbo_fp8_scaled.safetensors' not in ['krea2_turbo_int8_convrot.safetensors', 'z_image_turbo_bf16.safetensors']",
  extra_info: { input_name: 'unet_name' },
}] } };
const fixes = M.collectFixes(REAL);
eq(fixes.length, 1, 'details 문자열만으로도 1건 추출');
eq(fixes[0].current, 'krea2_turbo_fp8_scaled.safetensors', '요구한 파일 파싱');
eq(fixes[0].allowed, LOCAL, '서버가 가진 목록 파싱');
// extra_info.input_config 가 있는 정석 형태도
const CFGFORM = { '9': { errors: [{
  type: 'value_not_in_list', details: "vae_name: 'x.safetensors'",
  extra_info: { input_name: 'vae_name', received_value: 'x.safetensors', input_config: [['a.safetensors', 'b.safetensors']] },
}] } };
eq(M.collectFixes(CFGFORM)[0].allowed, ['a.safetensors', 'b.safetensors'], 'input_config 형태도 파싱');
eq(M.collectFixes({ '1': { errors: [{ type: 'required_input_missing' }] } }), [], '모델과 무관한 오류는 무시');
eq(M.collectFixes(null), [], 'null 이어도 안 죽는다');

// ── ④ applyModelFixes — 그래프가 실제로 바뀐다 ──
const graph = {
  '30:10': { class_type: 'UNETLoader', inputs: { unet_name: 'krea2_turbo_fp8_scaled.safetensors' } },
  '30:11': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_4b_fp8_scaled.safetensors' } },
};
const r = M.applyModelFixes(graph, REAL);
eq(r.changes.length, 1, '1개 대체');
eq(graph['30:10'].inputs.unet_name, 'krea2_turbo_int8_convrot.safetensors', 'UNET 이 바뀌었다');
eq(graph['30:11'].inputs.clip_name, 'qwen3vl_4b_fp8_scaled.safetensors', '오류 없던 노드는 그대로');
// 대체본이 없으면 아무것도 바꾸지 않고 unresolved 로 보고
const g2 = { '1': { class_type: 'UNETLoader', inputs: { unet_name: 'unknown_model_bf16.safetensors' } } };
const E2 = { '1': { errors: [{
  type: 'value_not_in_list',
  details: "unet_name: 'unknown_model_bf16.safetensors' not in ['other_thing_bf16.safetensors']",
  extra_info: { input_name: 'unet_name' },
}] } };
const r2 = M.applyModelFixes(g2, E2);
eq(r2.changes.length, 0, '같은 모델이 없으면 대체 안 함');
eq(r2.unresolved.length, 1, '못 고친 것으로 보고');
eq(g2['1'].inputs.unet_name, 'unknown_model_bf16.safetensors', '그래프는 그대로(조용한 오작동 방지)');

// ── ⑤ applyRemembered — 두 번째 장부터 헛왕복 없이 미리 적용 ──
const g3 = { '30:10': { inputs: { unet_name: 'krea2_turbo_fp8_scaled.safetensors' } } };
eq(M.applyRemembered(g3, { '30:10|unet_name': 'krea2_turbo_int8_convrot.safetensors' }), 1, '기억한 대체 1건 적용');
eq(g3['30:10'].inputs.unet_name, 'krea2_turbo_int8_convrot.safetensors', '미리 적용됨');
eq(M.applyRemembered(g3, { '없는노드|x': 'y' }), 0, '없는 노드는 건너뜀');

// ── ⑥ explain — 사람이 읽을 수 있는 안내 ──
const why = M.explain(REAL, false, 'image');
ok(why.includes('로컬 ComfyUI') && why.includes('krea2_turbo_fp8_scaled') && why.includes('krea2_turbo_int8_convrot')
   && why.includes('② 이미지'), '안내에 어디·무엇·있는것·할일이 다 들어간다');
ok(M.explain(REAL, true, 'video').includes('클라우드'), '클라우드일 때 문구가 바뀐다');
eq(M.explain({}, false, 'image'), '', '오류가 없으면 빈 문자열');

// ── ⑦ 엔진이 실제로 이 보정을 거치는지 (원문 대조 — 배선이 끊기면 위 전부가 무의미) ──
for (const f of ['core/comfy-image.js', 'core/comfy-video.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  ok(src.includes('await this._queueFixing(graph)'), f + ' 가 _queueFixing 으로 제출');
  ok(src.includes('err.nodeErrors = j.node_errors'), f + ' 가 node_errors 를 오류에 실어 보낸다');
  ok(src.includes("require('./comfy-models')"), f + ' 가 comfy-models 를 쓴다');
  ok(!/const promptId = await this[.]_queue[(]graph[)]/.test(src), f + ' 에 보정을 건너뛰는 옛 제출 경로가 없다');
}

console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 모델 자동 보정 ' + n + '/' + n + ' 통과');
process.exit(bad ? 1 : 0);
