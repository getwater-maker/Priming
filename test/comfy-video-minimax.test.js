'use strict';
// node test/comfy-video-minimax.test.js — MiniMax H3 (로컬 i2v) 배선 검증.
//
// 배경(2026-08-28): 로이가 로컬 비디오 항목을 요청 — "클라우드는 비용이 너무 비싸다".
//   MiniMax H3 는 LTX 처럼 **i2v(start_image 고정)가 아니라 「레퍼런스 참조 생성」**이라 규약이 다르다.
//   RTX 3060 실측(A/B 9회): turbo 4step + <Picture 1> 태그 + ref_image_size=match 가 최적.
//     0.2MP 89초 · 0.98MP 563초 · 2.0MP 2063초(VRAM 한계로 지수 1.22→1.79 악화 → 0.98MP 채택)
//
// 지키는 것:
//   ① 번들 워크플로가 실재하고 API 포맷이며 실측 최적값(turbo4·steps4·0.98MP·match)을 갖는다
//   ② _buildGraph 가 이미지를 ReferenceImageLoader.image_paths 로 넣는다(LoadImage 아님)
//   ③ 프롬프트에 <Picture 1> 접두사가 붙는다 — 없으면 원본 구도·화풍이 통째로 바뀐다(실측)
//   ④ 🔴 LTX 경로 회귀 — MiniMax 분기가 기존 i2v 배선·프롬프트를 건드리지 않는다
//   ⑤ 대본은 손대지 않는다 — 접두사는 엔진이 붙이고 워크플로/대본에는 태그가 없다

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const V = require('../core/comfy-video.js');
const SRC = fs.readFileSync(path.join(ROOT, 'core', 'comfy-video.js'), 'utf8');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, m + `  (기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)})`);

const MM_FILE = 'video_minimax_h3_turbo4_i2v.json';
const MM_PATH = path.join(ROOT, 'comfy', MM_FILE);

// ── ① 번들 파일 실재 + API 포맷 + 실측 최적값 ──
ok(fs.existsSync(MM_PATH), '번들 워크플로가 실재한다: ' + MM_FILE);
let wf = null;
try { wf = JSON.parse(fs.readFileSync(MM_PATH, 'utf8')); } catch (_) {}
ok(wf && typeof wf === 'object' && !Array.isArray(wf), 'JSON 객체다');
ok(wf && !wf.nodes, 'API 포맷이다 (UI 포맷이면 앱이 못 읽는다)');
const byClass = (g, re) => Object.values(g || {}).find((x) => re.test(x.class_type || ''));
if (wf) {
  const lora = byClass(wf, /LoraLoaderModelOnly/);
  const sch  = byClass(wf, /BasicScheduler/);
  const res  = byClass(wf, /DenoResolutionSetup/);
  const r2v  = byClass(wf, /MiniMaxH3ReferenceToVideo/);
  const ref  = byClass(wf, /MiniMaxH3ReferenceImageLoader/);
  ok(!!lora && /turbo_4step/i.test(lora.inputs.lora_name || ''), 'turbo 4step LoRA 를 쓴다');
  // ⚠ AccLoader 로 붙이면 pdd_num_steps 메타가 없어 실패한다(실측) → 표준 LoRA 로더여야 한다
  ok(!byClass(wf, /MiniMaxH3AccLoader/), 'AccLoader 를 쓰지 않는다 (pdd 메타 없어 실패)');
  eq(sch && sch.inputs.steps, 4, 'steps = 4');
  eq(res && res.inputs.megapixels, 0.98, '해상도 0.98MP (2.0MP 는 VRAM 한계로 비효율)');
  eq(res && res.inputs.mode, 'Preset Ratio', 'Preset Ratio 모드 (w/h 주입이 자동 무시됨)');
  eq(r2v && r2v.inputs.ref_image_size, 'match', "ref_image_size=match (max 는 원본에서 이탈 — 실측)");
  eq(ref && ref.inputs.image_paths, '', '이미지 경로는 비어 있다 (엔진이 주입)');
  eq(byClass(wf, /DenoPromptText/).inputs.text, '', '프롬프트는 비어 있다 (엔진이 주입)');
  // ⑤ 워크플로에 태그를 박아두지 않는다 — 접두사는 엔진이 붙인다(대본·워크플로 이중 관리 금지)
  ok(!JSON.stringify(wf).includes('<Picture 1>'), '워크플로에 <Picture 1> 이 박혀 있지 않다');
  ok(!byClass(wf, /PathchSageAttention/), 'sage 노드 없음 (효과 0 — 실측 121→122초)');
}

// ── ② 번들 등록 ──
const cfg = V.loadConfig();
const mmEntry = (cfg.workflows || []).find((w) => path.basename(w.path).toLowerCase() === MM_FILE);
ok(!!mmEntry, '드롭다운 목록에 등록돼 있다');
ok(mmEntry && /로컬/.test(mmEntry.name), '이름에 (로컬) 표시 — 클라우드엔 minimax 모델이 없다');
ok(path.basename(String(cfg.workflowPath || '')) !== MM_FILE, '기본 활성은 MiniMax 가 아니다 (로이: 여유 있을 때 사용)');

// ── ③ _buildGraph 원문 실행 ──
const mk = (wfPath) => new V.ComfyVideo(
  { ...cfg, workflowPath: wfPath, cloud: false, baseUrl: 'http://127.0.0.1:8188' }, () => {});
const SCRIPT = 'The king turns his head. Keep the king, bow and field unchanged.';
if (mmEntry) {
  const g = mk(mmEntry.path)._buildGraph('grp07.png', SCRIPT, '16:9', 7);
  const ref = byClass(g, /MiniMaxH3ReferenceImageLoader/);
  const pt  = byClass(g, /DenoPromptText/);
  const res = byClass(g, /DenoResolutionSetup/);
  const sec = Object.values(g).find((x) => /Primitive(Float|Int)/i.test(x.class_type || '') && /second/i.test(((x._meta || {}).title || '')));
  eq(ref && ref.inputs.image_paths, 'grp07.png', '이미지가 image_paths 로 주입된다');
  ok(!byClass(g, /^LoadImage$/), 'LoadImage 노드를 만들지 않는다 (레퍼런스 방식)');
  ok(pt && pt.inputs.text.startsWith('<Picture 1>'), '프롬프트에 <Picture 1> 접두사가 붙는다');
  ok(pt && pt.inputs.text.endsWith(SCRIPT), '대본 원문이 접두사 뒤에 그대로 온다');
  eq(sec && sec.inputs.value, 7, '길이(초)가 주입된다');
  // 해상도: Preset Ratio 라 주입된 w/h 는 무시되고 0.98MP 가 이긴다 → 34분(2.0MP) 사고 방지
  eq(res && res.inputs.megapixels, 0.98, '해상도 주입이 megapixels 를 덮지 않는다');
  eq(res && res.inputs.mode, 'Preset Ratio', 'mode 가 유지된다');
  const seeds = Object.values(g).filter((x) => typeof (x.inputs || {}).noise_seed === 'number');
  ok(seeds.length > 0 && seeds.every((x) => x.inputs.noise_seed !== 260827201), 'seed 가 랜덤화된다');
}

// ── ④ 🔴 LTX2.5 회귀 — MiniMax 분기가 기존 경로를 건드리지 않는다 ──
const ltx = (cfg.workflows || []).find((w) => /ltx2_5/i.test(w.path));
ok(!!ltx, 'LTX2.5 도 여전히 등록돼 있다');
if (ltx && fs.existsSync(ltx.path)) {
  const g = mk(ltx.path)._buildGraph('grp01.png', SCRIPT, '16:9', 6);
  const li = Object.values(g).filter((x) => x.class_type === 'LoadImage');
  ok(li.length > 0, 'LTX 은 여전히 LoadImage 로 이미지를 받는다');
  ok(li.some((x) => x.inputs.image === 'grp01.png'), 'LTX LoadImage 에 업로드명이 들어간다');
  const all = JSON.stringify(g);
  ok(!all.includes('<Picture 1>'), '🔴 LTX 프롬프트에는 접두사가 붙지 않는다');
  ok(all.includes(SCRIPT), 'LTX 프롬프트에 대본 원문이 들어간다');
}

// ── ⑤ 타임아웃 하한 — 0.98MP 563초라 기본 600초로는 실제로 타임아웃 났다(E2E 실측) ──
ok(/const MM_MIN_TIMEOUT_SEC\s*=\s*(\d+)/.test(SRC), 'MM_MIN_TIMEOUT_SEC 상수가 있다');
{
  const m = SRC.match(/const MM_MIN_TIMEOUT_SEC\s*=\s*(\d+)/);
  ok(m && Number(m[1]) >= 900, '타임아웃 하한이 실측 563초보다 넉넉하다 (>=900)');
}
ok(/_mmSlow && this\.timeoutSec < MM_MIN_TIMEOUT_SEC/.test(SRC), 'MiniMax 일 때만 타임아웃을 올린다');
ok(/finally \{ this\.timeoutSec = _savedTimeout; \}/.test(SRC), '끝나면 원래 타임아웃으로 되돌린다 (인스턴스 재사용 누수 방지)');

// ── ⑥ 소스 위생 ──
ok(/const MM_REF_PREFIX\s*=/.test(SRC), 'MM_REF_PREFIX 상수가 정의돼 있다');
ok(/DenoPromptText/.test(SRC), '프롬프트 탐지에 DenoPromptText 가 포함된다');
ok(/MiniMaxH3ReferenceImageLoader/.test(SRC), '이미지 주입에 ReferenceImageLoader 분기가 있다');
// 접두사는 mmRefId 일 때만 — 무조건 붙이면 LTX 프롬프트가 오염된다

ok(!/\r\n/.test(SRC), 'comfy-video.js LF 유지 (CRLF 면 원문 대조 테스트가 깨진다)');

// ══════════════════════════════════════════════════════════════════════════════
// ☁ 클라우드 판 (2026-08-30) — comfy.org 에 minimax_h3 모델이 올라왔다.
//   ⚠ 옛 기록("클라우드엔 minimax 모델이 없다")은 **더는 사실이 아니다**. /object_info 실측:
//     unet minimax_h3_ref2va_pruned_int8_convrot · clip qwen3vl_32b_minimax_h3_nvfp4_awq ·
//     vae minimax_h3_{video,audio}_vae · lora minimax_h3_turbo_v4_step600_ema_pruned_comfyui.
//   로컬은 Deno 커스텀 노드, 클라우드는 **ComfyUI 네이티브 MiniMaxH3ReferenceToVideo** 를 쓴다
//   (공식 템플릿 video_minimax_h3_r2v 를 scripts/comfy-ui2api.js 로 API 포맷 변환).
//
//   🔑 클라우드 실측(5초·같은 소스 이미지·1344x768)으로 정한 값:
//     · steps 20(템플릿 기본) = 3.4분 · 3건 중 2건이 장면을 **다시 상상**(구도 붕괴)
//     · turbo LoRA 4step      = 57초  · 원본 구도·화풍 유지  ⇒ 더 빠르고 더 충실하다
//     · 해상도 1920x1088(2.09MP) = 208초 + 이탈 심함 → 공식 0.98MP 격자로 상한
const CL_FILE = 'video_minimax_h3_ref2v_cloud.json';
const CL_PATH = path.join(ROOT, 'comfy', CL_FILE);
ok(fs.existsSync(CL_PATH), '클라우드 번들 워크플로가 실재한다: ' + CL_FILE);
let cw = null;
try { cw = JSON.parse(fs.readFileSync(CL_PATH, 'utf8')); } catch (_) {}
ok(cw && typeof cw === 'object' && !Array.isArray(cw), '클라우드 워크플로가 JSON 객체다');
ok(cw && !cw.nodes, '클라우드 워크플로가 API 포맷이다');
if (cw) {
  const r2v = byClass(cw, /^MiniMaxH3ReferenceToVideo$/);
  ok(!!r2v, '네이티브 MiniMaxH3ReferenceToVideo 를 쓴다 (클라우드엔 Deno 노드가 없다)');
  ok(!Object.values(cw).some((x) => /^Deno/.test(x.class_type || '')), 'Deno 커스텀 노드를 쓰지 않는다');
  eq(r2v && r2v.inputs.ref_image_size, 'match', 'ref_image_size=match (max 는 원본에서 이탈 — 실측)');
  // 모델 이름 — 클라우드 실측 목록과 달라지면 value_not_in_list 로 그 자리에서 실패한다
  eq(byClass(cw, /^UNETLoader$/).inputs.unet_name, 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', 'unet 이 클라우드 실측 이름과 같다');
  eq(byClass(cw, /^CLIPLoader$/).inputs.clip_name, 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', 'clip 이 클라우드 실측 이름과 같다');
  const vaes = Object.values(cw).filter((x) => x.class_type === 'VAELoader').map((x) => x.inputs.vae_name).sort();
  eq(vaes.join(','), 'minimax_h3_audio_vae_fp32.safetensors,minimax_h3_video_vae_fp16.safetensors', 'video/audio VAE 둘 다 있다 (오디오도 함께 생성)');
  const cl = byClass(cw, /^LoraLoaderModelOnly$/);
  eq(cl && cl.inputs.lora_name, 'minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors', 'turbo LoRA 는 클라우드에 실재하는 것만 쓴다');
  // ⚠ 로컬판의 minimax_h3_ref2v_turbo_4step_* 는 클라우드에 **없다** — 그대로 두면 검증 단계에서 실패한다
  ok(!JSON.stringify(cw).includes('ref2v_turbo_4step'), '클라우드에 없는 로컬 LoRA 를 참조하지 않는다');
  const csch = byClass(cw, /^BasicScheduler$/);
  eq(csch && csch.inputs.steps, 4, 'steps = 4 (20 은 장면을 다시 상상한다 — 실측 3건 중 2건 붕괴)');
  eq(byClass(cw, /^KSamplerSelect$/).inputs.sampler_name, 'euler', 'sampler = euler (로컬 검증판과 동일)');
  // 🔑 LoadImage 가 2개면(공식 템플릿 원본) 엔진이 **둘 다** 같은 이미지로 덮어 레퍼런스가 중복된다
  eq(Object.values(cw).filter((x) => x.class_type === 'LoadImage').length, 1, '레퍼런스 LoadImage 는 정확히 1개다');
  ok(!('ref_images.ref_image_1' in (r2v.inputs || {})), '두 번째 레퍼런스 슬롯이 남아 있지 않다');
  // 스위치 분기(공식 템플릿의 Lightning LoRA on/off)는 제거 — 안 쓰는 가지의 모델도 검증 대상이라 실패를 부른다
  ok(!byClass(cw, /ComfySwitchNode/), '쓰지 않는 스위치 분기가 남아 있지 않다');
  eq(byClass(cw, /PrimitiveStringMultiline/).inputs.value, '', '프롬프트는 비어 있다 (엔진이 주입)');
  ok(!JSON.stringify(cw).includes('<Picture 1>'), '워크플로에 <Picture 1> 이 박혀 있지 않다');
}

// 등록 — 이름으로 어느 쪽인지 드러나야 한다(드롭다운은 ☁/🖥 두 그룹에 같은 목록을 다 보여준다)
const clEntry = (cfg.workflows || []).find((w) => path.basename(w.path).toLowerCase() === CL_FILE);
ok(!!clEntry, '드롭다운 목록에 클라우드 판이 등록돼 있다');
ok(clEntry && /클라우드/.test(clEntry.name), '이름에 (클라우드) 표시 — 로컬엔 그 모델이 없다');
ok(path.basename(String(cfg.workflowPath || '')) !== CL_FILE, '기본 활성은 여전히 MiniMax 가 아니다');

// _buildGraph 원문 실행 — 클라우드 판
if (clEntry) {
  const g = new V.ComfyVideo({ ...cfg, workflowPath: clEntry.path, cloud: true, baseUrl: 'https://cloud.comfy.org' }, () => {})
    ._buildGraph('grp03.jpg', SCRIPT, '16:9', 7);
  const li = Object.values(g).filter((x) => x.class_type === 'LoadImage');
  eq(li.length, 1, '클라우드 판은 LoadImage 1개로 유지된다');
  eq(li[0] && li[0].inputs.image, 'grp03.jpg', '업로드명이 LoadImage 에 주입된다');
  const pv = byClass(g, /PrimitiveStringMultiline/);
  // 🔑 이번 수정의 핵심 — 옛 판정은 Deno 노드 이름만 봐서 클라우드 판엔 접두사가 **조용히 안 붙었다**
  ok(pv && pv.inputs.value.startsWith('<Picture 1>'), '🔑 클라우드 판에도 <Picture 1> 접두사가 붙는다');
  ok(pv && pv.inputs.value.endsWith(SCRIPT), '대본 원문이 접두사 뒤에 그대로 온다');
  const r2v = byClass(g, /MiniMaxH3ReferenceToVideo/);
  eq(r2v && r2v.inputs.width, 1344, '16:9 해상도가 공식 0.98MP 격자로 주입된다 (1920 은 3.6배 느리고 이탈도 심함)');
  eq(r2v && r2v.inputs.height, 768, '높이도 격자에 맞는다');
  const dur = Object.values(g).find((x) => /PrimitiveFloat/i.test(x.class_type || '') && /duration/i.test(((x._meta || {}).title || '')));
  eq(dur && dur.inputs.value, 7, '길이(초)가 주입된다');
  ok(!byClass(g, /MiniMaxH3ReferenceImageLoader/), '클라우드 판은 image_paths 경로를 타지 않는다');
  const seeds = Object.values(g).filter((x) => typeof (x.inputs || {}).noise_seed === 'number');
  ok(seeds.length > 0 && seeds.every((x) => x.inputs.noise_seed !== 261662374822964), 'seed 가 랜덤화된다');
}

// 해상도 격자 — MiniMax 에만 적용되고 LTX 는 1920x1088 그대로여야 한다
{
  const mk2 = (wfPath, aspect) => new V.ComfyVideo({ ...cfg, workflowPath: wfPath, cloud: true }, () => {})._buildGraph('x.jpg', SCRIPT, aspect, 6);
  if (clEntry) {
    const v = mk2(clEntry.path, '9:16');
    const r = byClass(v, /MiniMaxH3ReferenceToVideo/);
    eq(r.inputs.width + 'x' + r.inputs.height, '768x1344', '9:16 도 격자에 맞는다');
    const sq = byClass(mk2(clEntry.path, '1:1'), /MiniMaxH3ReferenceToVideo/);
    eq(sq.inputs.width + 'x' + sq.inputs.height, '992x992', '1:1 도 격자에 맞는다 (32 의 배수)');
  }
  const ltx2 = (cfg.workflows || []).find((w) => /ltx2_5/i.test(w.path));
  if (ltx2 && fs.existsSync(ltx2.path)) {
    const g2 = mk2(ltx2.path, '16:9');
    const wNode = Object.values(g2).find((x) => /Primitive/i.test(x.class_type || '') && /width/i.test(((x._meta || {}).title || '')));
    eq(wNode && wNode.inputs.value, 1920, '🔴 LTX2.5 는 여전히 1920 (MiniMax 격자가 새지 않는다)');
  }
}

// 소스 위생 — 이미지 주입과 접두사 판정을 **분리**해야 한다
ok(/const mmLoaderId\s*=/.test(SRC), '이미지 주입용 mmLoaderId(Deno 전용) 가 따로 있다');
ok(/const mmRef\s*=\s*!!mmLoaderId \|\| ids\.some/.test(SRC), '접두사 판정 mmRef 는 로컬·클라우드 둘 다 본다');
ok(/if \(mmRef\) prompt = MM_REF_PREFIX/.test(SRC), '접두사는 레퍼런스 워크플로일 때만 붙인다');
// ⚠ 이미지 주입까지 mmRef 로 하면 클라우드 판에 없는 image_paths 를 만들려다 LoadImage 를 놓친다
ok(/if \(mmLoaderId\) \{/.test(SRC), '이미지 주입 분기는 mmLoaderId 로만 탄다');
ok(/_mmDims\(aspect\) : this\._videoDims\(aspect\)/.test(SRC), '해상도 격자는 레퍼런스 워크플로일 때만 적용된다');

console.log(`\n[comfy-video-minimax] ${n - bad}/${n} 통과`);
process.exit(bad ? 1 : 0);
