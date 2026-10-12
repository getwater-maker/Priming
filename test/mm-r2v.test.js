'use strict';
// node test/mm-r2v.test.js — 🎬 MiniMax H3 공식 R2V(Ref2VA) 꼴 (v0.8.12 · 채널사업부 요청서_프라이밍_H3_R2V_20261012)
//   ① 새 꼴 판별 · 여섯 절 펴기 ② `<Subject N> [카드]` → 시트 <Picture k+1> · 정의 문장 덧붙임 · [이름] 늘 지움
//   ③ 시트 0장이면 [keyframe completion] ④ 그래프: 클라우드 네이티브 = 슬롯마다 다른 LoadImage · 로컬 Deno = image_paths 줄 목록
//   ⑤ 새 꼴엔 <Picture 1> 접두사 없음 · 옛 꼴은 예전 그대로 ⑥ main 배선(부정 절 정리 안 함 · refImages 전달)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = require('../core/mm-r2v');
const V = require('../core/comfy-video');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('  ✓ ' + m); else { bad++; console.log('  ✗ ' + m); } };

const P_NEW = 'subject_definitions: <Subject 1> [덕순] is the small thin Korean woman of about sixty three in <Picture 1>, with a weathered kind face. <Subject 2> [만복] is the tall man behind her. <Picture 1> is the first frame of [Shot 1], showing the mill door. summary: [keyframe completion + reference generation] The target video begins from <Picture 1>, no camera shake. retention_analysis: <Picture 1> ([Shot 1] first frame): fully_preserved - all. <Subject 1> (appears in [Shot 1]): fully_preserved - face. detailed_description: The target video keeps the art style, palette and line quality of <Picture 1>. [Shot 1] The shot begins from <Picture 1>. <Subject 1> [덕순] pushes the door. overall_soundscape: creak of wood. non_diegetic_music: N/A';
const cards = [{ name: '덕순', desc: 'a small thin Korean woman' }, { name: '만복', desc: 'a tall man' }];

console.log('[1] 판별 · 절 펴기');
ok(R.isR2V(P_NEW) && R.isR2V('  subject_definitions：x') && !R.isR2V('slow push-in, <Subject 1> subject_definitions: x'), '`subject_definitions:` 로 시작할 때만 새 꼴');
const ex = R.expandSections(P_NEW);
ok(ex.missing.length === 0, '여섯 절을 모두 찾는다');
ok(/^subject_definitions:\n<Subject 1>/.test(ex.text) && /\n\nsummary:\n\[keyframe/.test(ex.text) && /\n\nnon_diegetic_music:\nN\/A$/.test(ex.text), '공식 꼴 — 절 이름 뒤 줄바꿈 · 절 사이 빈 줄');
ok(R.SECTIONS.every((s, i, a) => i === 0 || ex.text.indexOf(a[i - 1] + ':') < ex.text.indexOf(s + ':')), '절 순서 그대로');
ok(R.expandSections('subject_definitions: a summary: b').missing.length === 4, '빠진 절을 알린다');

console.log('[2] 인물 시트');
const sheets = { 덕순: 'C:/out/characters/덕순.png', 만복: null };
const b = R.buildR2V(P_NEW, { cards, findSheet: (c) => sheets[c.name] });
ok(b.refImages.length === 1 && b.refImages[0] === sheets.덕순 && b.attached[0].picture === 2, '덕순 시트 = <Picture 2>(ref_image_1)');
ok(!/\[덕순\]|\[만복\]/.test(b.prompt), '`[이름]` 토막은 시트가 있든 없든 지운다');
ok(/\[Shot 1\]/.test(b.prompt), '[Shot 1] 같은 다른 대괄호는 그대로');
ok(/with a weathered kind face\. Its face and build follow the reference sheet <Picture 2>\. <Subject 2> is the tall man/.test(b.prompt), 'Subject 1 정의 문장 끝에 시트 문장을 덧붙인다(정의 절 안)');
ok((b.prompt.match(/<Picture 2>/g) || []).length === 1, '시트 문장은 한 번만(detailed_description 의 같은 Subject 에는 안 붙인다)');
ok(b.missing.join() === '만복', '시트 없는 인물을 알린다');
ok(/\[keyframe completion \+ reference generation\]/.test(b.prompt), '시트가 붙었으면 summary 머리 그대로');
const b0 = R.buildR2V(P_NEW, { cards, findSheet: () => null });
ok(b0.refImages.length === 0 && /\[keyframe completion\] The target/.test(b0.prompt) && !/<Picture 2>/.test(b0.prompt), '시트 0장 → [keyframe completion] · 장면 그림 1장(fail-open)');
const bx = R.buildR2V(P_NEW.replace('[만복]', '[만 복]'), { cards, findSheet: (c) => 'x/' + c.name + '.png' });
ok(bx.attached.length === 1 && bx.missing.includes('만 복'), '카드 이름과 정확히 같아야 한다(비슷한 이름은 안 맞춘다)');
const same = R.buildR2V(P_NEW.replace('[만복]', '[덕순]'), { cards, findSheet: (c) => 'x/' + c.name + '.png' });
ok(same.refImages.length === 1 && (same.prompt.match(/<Picture 2>/g) || []).length === 2, '같은 인물을 두 Subject 로 쓰면 시트는 한 장, 둘 다 <Picture 2>');
const many = 'subject_definitions: ' + Array.from({ length: 10 }, (_, i) => `<Subject ${i + 1}> [p${i}] is person ${i}.`).join(' ') + ' summary: [keyframe completion + reference generation] x';
const bm = R.buildR2V(many, { cards: Array.from({ length: 10 }, (_, i) => ({ name: 'p' + i })), findSheet: (c) => c.name + '.png' });
ok(bm.refImages.length === 8 && bm.missing.length === 2, '레퍼런스 그림은 장면 그림 포함 9장까지(공식·노드 한도)');
ok(R.stripNames(P_NEW).indexOf('[덕순]') < 0, '옛 엔진용 — [이름] 만 지운다');

console.log('[3] 그래프 — 클라우드 네이티브 · 로컬 Deno');
const cfg = V.loadConfig();
const wfOf = (f) => path.join(ROOT, 'comfy', f);
const mk = (f, cloud) => new V.ComfyVideo({ ...cfg, workflowPath: wfOf(f), cloud, apiKey: 'k', baseUrl: cloud ? 'https://cloud.comfy.org' : 'http://127.0.0.1:8188' }, () => {});
const cloud = mk('video_minimax_h3_ref2v_cloud.json', true);
ok(cloud.isMiniMaxRef() && mk('video_minimax_h3_turbo4_i2v.json', false).isMiniMaxRef() && !mk('video_ltx2_5_i2v.json', true).isMiniMaxRef(), 'isMiniMaxRef — MiniMax 두 판만');
const g = cloud._buildGraph('scene.png', b.prompt, '16:9', 7, ['sheet_a.png', 'sheet_b.png']);
const mm = Object.values(g).find((x) => x.class_type === 'MiniMaxH3ReferenceToVideo');
const slot = (k) => { const l = mm.inputs['ref_images.ref_image_' + k]; return l && g[l[0]] && g[l[0]].inputs.image; };
ok(slot(0) === 'scene.png' && slot(1) === 'sheet_a.png' && slot(2) === 'sheet_b.png' && !mm.inputs['ref_images.ref_image_3'], 'ref_image_0 = 장면 · _1·_2 = 시트(슬롯마다 다른 LoadImage)');
const prm = Object.values(g).find((x) => x.class_type === 'PrimitiveStringMultiline').inputs.value;
ok(prm === b.prompt && !prm.startsWith('<Picture 1> is the exact scene'), '새 꼴엔 <Picture 1> 접두사를 붙이지 않는다');
const g1 = cloud._buildGraph('scene.png', 'slow push-in toward the gate', '16:9', 7);
const mm1 = Object.values(g1).find((x) => x.class_type === 'MiniMaxH3ReferenceToVideo');
ok(Object.keys(mm1.inputs).filter((k) => k.startsWith('ref_images.')).length === 1 && g1[mm1.inputs['ref_images.ref_image_0'][0]].inputs.image === 'scene.png', '옛 꼴 = 예전처럼 1장');
ok(Object.values(g1).find((x) => x.class_type === 'PrimitiveStringMultiline').inputs.value.startsWith('<Picture 1> is the exact scene'), '옛 꼴 = 예전처럼 접두사');
const loc = mk('video_minimax_h3_turbo4_i2v.json', false)._buildGraph('scene.png', b.prompt, '16:9', 7, ['sheet_a.png']);
ok(Object.values(loc).find((x) => /ReferenceImageLoader/.test(x.class_type)).inputs.image_paths === 'scene.png\nsheet_a.png', '로컬 Deno — image_paths 줄 목록(순서 = <Picture n>)');
const ltx = mk('video_ltx2_5_i2v.json', true)._buildGraph('scene.png', 'x', '16:9', 7, ['sheet_a.png']);
ok(Object.values(ltx).filter((x) => x.class_type === 'LoadImage').every((x) => x.inputs.image === 'scene.png'), 'LTX 는 시트를 무시한다(예전 그대로)');

console.log('[4] main 배선');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
ok(/if \(R2V\.isR2V\(raw\)\)[\s\S]{0,1200}\} else prompt = P\.normalizePromptNegations\(raw\);/.test(main), '새 꼴은 부정 절 정리를 하지 않는다(옛 꼴만)');
ok(/eng\.imageToVideo\(\{[^}]*refImages \}\)/.test(main), 'imageToVideo 에 시트(refImages)를 넘긴다');
ok(/findSheet: \(c\) => CR\.findSheet\(r2vRoot, c\) \|\| CR\.findFaceSheet\(r2vRoot, c\)/.test(main), '시트 = 그림 단계가 만든 <출력>/characters (전신 → 얼굴)');
console.log('[5] 이름 · 미리 알림(v0.8.14)');
const names = cfg.workflows.map((w) => w.name);
ok(names.includes('MiniMax H3 레퍼런스 (R2V) (클라우드)') && names.includes('MiniMax H3 turbo4 (R2V) (로컬)'), '드롭다운 이름에 (R2V) — 끝의 (클라우드)/(로컬) 은 그대로(그룹 가르는 표시)');
const app = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'App.jsx'), 'utf8');
ok(/const suffix = kind === 'video' \? ' 비디오'/.test(app), '그룹 이름 「ComfyUI 클라우드 비디오」(i2v 아님)');
ok(/const r2vBad = r2vN > 0 && !isMmVideoVal\(/.test(app) && /data-r2v-bad=\{r2vBad/.test(app), '③ 비디오 드롭다운 — R2V 대본 + MiniMax 아님 = 노란 테두리');
ok(/function _warnR2vEngine[\s\S]{0,900}isMiniMaxRef\(\)/.test(main) && /async function _genGroupVideosCore\([^)]*\) \{\n  _warnR2vEngine\(/.test(main), '만들기 시작 때(모든 엔진 공통 입구) 로그 ⚠');
// 판정이 같다 — 화면 정규식과 core isR2V
const RE = /^\s*subject_definitions\s*[:：]/i;
ok(['subject_definitions: a', '  subject_definitions：b', 'slow push-in', 'x subject_definitions: c'].every((t) => RE.test(t) === R.isR2V(t)), '화면 판정(R2V_HEAD_RE) = core isR2V');
// 부정 절 정리가 실제로 새 꼴을 망가뜨린다(판정력) — 그래서 건너뛴다
const P = require('../core/pipeline');
ok(!P.normalizePromptNegations(P_NEW).endsWith('non_diegetic_music: N/A'), '(판정력) 옛 정리를 새 꼴에 쓰면 절 구조가 깨진다');

console.log(`\n${bad ? '❌' : '✅'} mm-r2v ${n - bad}/${n}\n`);
process.exit(bad ? 1 : 0);
