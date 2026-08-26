'use strict';
// node test/img-regen.test.js — 「영상이 있는 그룹의 🔄 이미지 재생성」 검증.
//
// 배경(2026-08-26): 로이 — "왜 이미지 생성이 안되는거지? 직전 이미지 생성은 잘 되었는데."
//   로그 실측으로 갈렸다. 같은 시각 두 번의 🔄 가 갈린 이유는 한도가 아니라 **영상 유무**였다:
//     [23:36:00] [다산_0829] G1 (media-1 에 01.jpg 만) → 브라우저 띄우고 30초 걸려 ✓ 성공
//     [23:36:38] [다산_0827] G1 (media-1 에 01.jpg + **01.mp4**) → **1초** 만에 ✗ 실패
//   실패 쪽 로그엔 「[Genspark] 브라우저 시작」 이 **한 줄도 없다** — 대상이 0개라 그냥 빠져나온 것이다.
//
// 원인: 대상 필터가 !hasVisual(g) 인데 hasVisual 은 **videoPath 까지** 본다. 반면 재생성 경로는
//   g.imagePath = null 만 지운다 → 영상이 있는 그룹은 「이미 자산 있음」으로 판정 → 0장 생성 후
//   "✅ 순환 이미지 생성 완료" → 호출부는 이미지가 없으니 "✗ 실패 (엔진 한도·오류·결제 확인)".
//   로그가 원인을 **한도로 오도**하기까지 했다.
//
// 지키는 것:
//   ① force 면 **이미지 유무만** 본다 → 영상이 있어도 이미지를 다시 만든다
//   ② force 가 아니면 기존 그대로 — 만들기 2단계는 영상 있는 그룹에 이미지를 만들지 않는다
//   ③ 대상이 0개면 **조용히 넘어가지 않는다**(그래서 이 사고가 로그에 안 보였다)
//   ④ 🔄 가 실패해도 **원래 있던 이미지 참조를 잃지 않는다**
//
//   🔑 로직을 복사하지 않는다 — main.js 원문에서 함수를 뽑아 실행한다.

const fs = require('fs');
const os = require('os');
const path = require('path');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, m + '  (기대 ' + JSON.stringify(b) + ' / 실제 ' + JSON.stringify(a) + ')');

// ── main.js 원문에서 함수 통째로 뽑기 ──
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' 를 찾을 수 없습니다(원문에 없음)');
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

const SRC = [extractFn(MAIN, 'hasVisual'), extractFn(MAIN, 'imgDone'), extractFn(MAIN, 'noTargetMsg')].join('\n');
const M = new Function('fs', SRC + '\nreturn { hasVisual, imgDone, noTargetMsg };')(fs);

// ── 실제 파일로 시험한다(경로만 있고 파일이 없는 경우까지 재현) ──
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'imgregen-'));
const IMG = path.join(TMP, '01.jpg');
const VID = path.join(TMP, '01.mp4');
fs.writeFileSync(IMG, 'jpg');
fs.writeFileSync(VID, 'mp4');
const GHOST = path.join(TMP, 'nope.jpg');

console.log('\n[1] imgDone — force 가 판정을 가른다');
eq(M.imgDone({ imagePath: null, videoPath: VID }, false), true, '평소: 영상만 있어도 「있음」(만들기 2단계는 안 만든다)');
eq(M.imgDone({ imagePath: null, videoPath: VID }, true), false, '🔑 force: 영상이 있어도 이미지가 없으면 「대상」 ← 실사고');
eq(M.imgDone({ imagePath: IMG, videoPath: VID }, true), true, 'force: 이미지가 있으면 대상 아님');
eq(M.imgDone({ imagePath: IMG, videoPath: null }, false), true, '평소: 이미지 있음');
eq(M.imgDone({ imagePath: null, videoPath: null }, false), false, '평소: 아무것도 없으면 대상');
eq(M.imgDone({ imagePath: null, videoPath: null }, true), false, 'force: 아무것도 없으면 대상');
eq(M.imgDone({ imagePath: GHOST, videoPath: null }, true), false, '경로만 있고 파일이 없으면 대상(실존 확인)');
eq(M.imgDone({ imagePath: null, videoPath: GHOST }, false), false, '영상 경로만 있고 파일이 없으면 대상');

console.log('[2] 실사고 재현 — [다산_0827] G1 (01.jpg + 01.mp4, 🔄 로 imagePath 만 비움)');
const groups = [
  { num: 1, imagePrompt: 'an old man looks at a silent phone', imagePath: null, videoPath: VID }, // 🔄 직후
  { num: 2, imagePrompt: 'a quiet room', imagePath: IMG, videoPath: null },
];
const onlyNums = [1];
const pick = (force) => groups.filter((g) => g.imagePrompt && g.imagePrompt.trim() && !M.imgDone(g, force) && (!onlyNums || onlyNums.includes(g.num)));
eq(pick(false).length, 0, '고치기 전 판정(force 없음) = 대상 0개 → 1초 만에 "실패" 하던 그 상태');
eq(pick(true).length, 1, '🔑 force = 대상 1개(G1) → 실제로 생성 시도한다');
eq((pick(true)[0] || {}).num, 1, '대상이 G1 이다');

console.log('[3] noTargetMsg — 0개면 조용히 넘어가지 않는다');
ok(M.noTargetMsg([1]).indexOf('그룹 1') >= 0, '어느 그룹인지 적는다');
ok(M.noTargetMsg([1, 3]).indexOf('그룹 1,3') >= 0, '여러 그룹도 적는다');
ok(M.noTargetMsg(null).indexOf('대상 없음') >= 0, '범위가 없어도 이유를 남긴다');
ok(M.noTargetMsg(null).indexOf('그룹') < 0, '범위가 없으면 그룹 표기를 붙이지 않는다');

console.log('[4] 배선 대조 — 네 엔진이 모두 같은 판정을 쓴다');
const sigs = [
  ['runRotatingImages', 'async function runRotatingImages(project, imagesDir, logger, styleId, startEngine, onlyNums, retryLevel = 0, force = false) {'],
  ['runComfyImages', 'async function runComfyImages(project, imagesDir, logger, styleId, onlyNums, workflowPath, baseRetryLevel = 0, force = false) {'],
  ['runFlowImages', 'async function runFlowImages(project, imagesDir, logger, styleId, onlyNums, force = false) {'],
  ['runGeminiImages', 'async function runGeminiImages(project, imagesDir, logger, styleId, onlyNums, force = false) {'],
];
sigs.forEach(([name, sig]) => ok(MAIN.indexOf(sig) >= 0, name + ' 가 force 를 받는다'));
eq((MAIN.match(/!imgDone\(g, force\)/g) || []).length, 4, '대상 필터 4곳이 전부 imgDone(g, force)');
ok(MAIN.indexOf('!hasVisual(g) && (!onlyNums') < 0, '옛 필터(!hasVisual(g) && onlyNums)가 남아 있지 않다');
ok(MAIN.indexOf('runGeminiImages(project, imagesDir, logger, styleId, onlyNums, force)') >= 0, '순환→Gemini 위임에 force 전파');
ok(MAIN.indexOf('comfyWfOf(startEngine), retryLevel, force)') >= 0, '순환→Comfy 위임에 force 전파');
ok(MAIN.indexOf('runFlowImages(project, imagesDir, logger, styleId, nums, force)') >= 0, '순환 안 Flow 호출에 force 전파');
ok(MAIN.indexOf('runGeminiImages(project, imagesDir, logger, styleId, nums, force)') >= 0, '순환 안 Gemini 호출에 force 전파');
eq((MAIN.match(/noTargetMsg\(onlyNums\)/g) || []).length, 4, '대상 0개 로그가 순환·Comfy·Flow·Gemini 4곳에');

console.log('[5] 배선 대조 — force 를 켜는 곳(명시적 재생성 4곳)');
const forced = [
  ['🔄 단건 이미지 재생성', 'runRotatingImages(pr, mediaDir, log, styleId, engine, [groupNum], _lv, true)'],
  ['영상 단건 재생성 전 이미지', 'runRotatingImages(pr, videoDir, log, styleId, imgEngine, [groupNum], 0, true)'],
  ['검정·노이즈 복구(만들기)', 'runRotatingImages(pr, dirs0.media, log, styleId, engine, bad, 0, true)'],
  ['검정·노이즈 복구(.vrew)', "runRotatingImages(pr, dirsB.media, log, styleId, engine || 'rotate', bad, 0, true)"],
];
forced.forEach(([label, code]) => ok(MAIN.indexOf(code) >= 0, label + ' 이 force=true'));
// ⚠ 평소 경로는 force 를 켜지 않는다 — 켜면 영상 있는 그룹에 쓸데없이 이미지를 만든다.
ok(MAIN.indexOf('runRotatingImages(pr, mediaDir, log, styleId, engine); // Flow+Genspark 순환(한도 시 자동 이어감)') >= 0, '만들기 2단계(수동 🖼)는 force 없음');
ok(MAIN.indexOf('runRotatingImages(pr, dirs.media, log, styleId, engine); // Flow+Genspark 순환') >= 0, '만들기 파이프라인 2단계는 force 없음');
ok(MAIN.indexOf('runRotatingImages(pr, videoDir, log, styleId, imgEngine, onlyNums);') >= 0, '영상 범위 생성 전 선행 이미지는 force 없음(영상 있는 그룹은 어차피 건너뛴다)');

console.log('[6] 🔄 실패해도 원래 이미지를 잃지 않는다');
ok(MAIN.indexOf('const _prevImg = g.imagePath, _prevEng = g.imageEngine;') >= 0, '재생성 전 기존 경로를 기억한다');
ok(MAIN.indexOf('if (_prevImg && fs.existsSync(_prevImg)) { g.imagePath = _prevImg;') >= 0, '실패 시 기존 이미지 참조 복원');
ok(MAIN.indexOf('기존 이미지를 그대로 둡니다') >= 0, '복원했음을 로그로 알린다');

console.log('[7] 회귀 — Genspark 는 원래부터 이미지 유무만 봤다(나머지를 그쪽에 맞춘 것)');
const PIPE = fs.readFileSync(path.join(__dirname, '..', 'core', 'pipeline.js'), 'utf8');
ok(PIPE.indexOf('!(groups[i].imagePath && fs.existsSync(groups[i].imagePath))') >= 0,
  'generateImagesGenspark 는 videoPath 를 보지 않는다');
ok(PIPE.indexOf('hasVisual') < 0, 'pipeline 에 hasVisual 판정이 새로 끼어들지 않았다');

console.log('[8] 소스 위생');
eq((MAIN.match(/\r\n/g) || []).length, 0, 'main.js 는 LF 유지(CRLF 0)');
ok(MAIN.indexOf(String.fromCharCode(0)) < 0, 'main.js 에 NUL 바이트 없음');

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
console.log('\n' + (bad ? '❌ ' + bad + '/' + n + ' 실패' : '✅ ' + n + '/' + n + ' 통과'));
process.exit(bad ? 1 : 0);
