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
ok(/if \(mmRefId\) prompt = MM_REF_PREFIX/.test(SRC), '접두사는 MiniMax 워크플로일 때만 붙인다');
ok(!/\r\n/.test(SRC), 'comfy-video.js LF 유지 (CRLF 면 원문 대조 테스트가 깨진다)');

console.log(`\n[comfy-video-minimax] ${n - bad}/${n} 통과`);
process.exit(bad ? 1 : 0);
