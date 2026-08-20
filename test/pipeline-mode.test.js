'use strict';
// node test/pipeline-mode.test.js — 「⚡ 만들기」의 단계 병렬/순차 판정 단위검증.
//   지키려는 것(2026-08-20 로이 조합: 이미지=🖥 로컬 · 비디오=☁ 클라우드):
//     ① 이미지가 **로컬 ComfyUI** 면 TTS 와 **동시에 돌리지 않는다**(같은 3060 을 다투면 TTS 가 크게 느려진다).
//        예전엔 `noLocalGpuImg = true` 하드코딩이라 로컬 이미지도 병렬로 돌았다.
//     ② 그렇더라도 **비디오가 클라우드면 비디오 파이프라인은 살린다**(TTS→이미지 순차 ∥ 클라우드 비디오).
//     ③ 비디오가 **로컬** comfy 면 파이프라인에서 빼고 순차로(로컬 GPU 충돌).
//   🔑 판정식을 여기 복사하지 않는다 — **main.js 원문에서 그 줄을 읽어** 같은 식으로 계산한다.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };

// ── 원문 대조 — 판정이 '엔진·설정을 실제로 보는' 형태로 남아 있는지 ──
ok(!/const noLocalGpuImg = true/.test(SRC), '옛 하드코딩(noLocalGpuImg = true)이 사라졌다');
ok(/const _imgLocalGpu = isComfyVal\(engine\)/.test(SRC), '이미지 로컬 GPU 여부를 엔진+설정으로 판정');
// 🔴 runMakeAllCore 안에서 **이미지 엔진 변수명은 `engine`** 이다(비디오는 videoEngine). `imgEngine` 을 쓰면
//   런타임 ReferenceError 로 큐 전체가 죽는다 — 2026-08-20 실사고: 대본 7개가 전부
//   "imgEngine is not defined" 로 실패. 빌드도 E2E 도 못 잡았으므로 **스코프를 대조해 고정**한다.
{
  const i = SRC.indexOf('async function runMakeAllCore(');
  // ⚠ 인자 기본값에 `opts = {}` 가 있어 그냥 첫 `{` 부터 세면 **시그니처만** 잘린다 → `) {` 뒤부터 센다.
  const start = SRC.indexOf(') {', i) + 2;
  let d = 0, started = false, j = start;
  for (; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  const body = SRC.slice(i, j);
  ok(body.length > 3000, 'runMakeAllCore 본문을 제대로 잘라냈다 (' + body.length + '자)');
  const code = body.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'); // 주석 줄 제외
  ok(!/\bimgEngine\b/.test(code), 'runMakeAllCore 안에 스코프 밖 변수 imgEngine 이 없다');
  ok(/\bengine = 'genspark'/.test(code), 'runMakeAllCore 의 이미지 엔진 인자 이름은 engine');
}
ok(/comfy-image'\)\.loadConfig\(\)\.cloud/.test(SRC), '이미지 설정의 cloud 를 실제로 읽는다');
ok(/comfy-video'\)\.loadConfig\(\)\.cloud/.test(SRC), '비디오 설정의 cloud 를 실제로 읽는다');
ok(/const canParallel = !dry && !_imgLocalGpu/.test(SRC), 'canParallel 이 로컬 이미지를 배제한다');
ok(/videoPipeline = _pipeBase && \(\(canParallel && grokVideoPipeline\) \|\| comfyVideoPipeline\)/.test(SRC),
   '클라우드 비디오는 canParallel 과 무관하게 파이프라인 유지');
ok(/if \(videoPipeline && !canParallel && _imgLocalGpu\) \{/.test(SRC), '(TTS→이미지 순차) ∥ 비디오 분기 존재');
ok(/await Promise\.all\(\[\(async \(\) => \{ await ttsStage\(\); if \(!S\.abort\) await imageStage\(\); \}\)\(\), videoStage\(\)\]\)/.test(SRC),
   '그 분기가 TTS→이미지를 순차로 묶고 비디오만 병렬로 돌린다');

// ── 판정식 재현 — main.js 의 식을 그대로 옮겨 조합별로 계산 ──
//   (원문에서 뽑은 위 정규식이 통과했으므로, 아래 식은 그 형태와 일치한다)
function decide({ imgEngine, imgCloud, videoEngine, vidCloud, dry = false, regroup = false }) {
  const isComfy = (v) => v === 'comfy' || String(v || '').indexOf('comfy::') === 0;
  const _imgLocalGpu = isComfy(imgEngine) && !imgCloud;
  const canParallel = !dry && !_imgLocalGpu && !regroup;
  const grokVideoPipeline = videoEngine === 'grok' || videoEngine === 'grok10';
  const comfyVideoPipeline = isComfy(videoEngine) && !!vidCloud;
  const _pipeBase = !dry && !regroup;
  const videoPipeline = _pipeBase && ((canParallel && grokVideoPipeline) || comfyVideoPipeline);
  const branch = (videoPipeline && !canParallel && _imgLocalGpu) ? 'tts→img ∥ video'
    : videoPipeline ? 'tts ∥ img ∥ video'
    : canParallel ? 'tts ∥ img' : 'tts → img';
  return { canParallel, videoPipeline, branch };
}
const eq = (a, b, m) => ok(a === b, m + ' — 실제 ' + a);

// 🔴 로이의 조합: 이미지 로컬 + 비디오 클라우드
let d = decide({ imgEngine: 'comfy::krea2', imgCloud: false, videoEngine: 'comfy::ltx', vidCloud: true });
eq(d.branch, 'tts→img ∥ video', '이미지 로컬 + 비디오 클라우드 → TTS·이미지 순차, 비디오만 병렬');
eq(d.videoPipeline, true, '  비디오 파이프라인은 살아 있다(클라우드 이득 유지)');
eq(d.canParallel, false, '  이미지는 TTS 와 병렬로 안 돈다');

// 둘 다 클라우드 = 예전과 동일(전면 병렬)
d = decide({ imgEngine: 'comfy::krea2', imgCloud: true, videoEngine: 'comfy::ltx', vidCloud: true });
eq(d.branch, 'tts ∥ img ∥ video', '둘 다 클라우드 → 전면 병렬(기존 동작 유지)');

// 순환(브라우저) 이미지 + 클라우드 비디오 = 전면 병렬
d = decide({ imgEngine: 'rotate', videoEngine: 'comfy::ltx', vidCloud: true });
eq(d.branch, 'tts ∥ img ∥ video', '순환 이미지 → 로컬 GPU 안 쓰므로 전면 병렬');

// 나노바나나(API) 이미지 + Grok 비디오 = 전면 병렬(기존)
d = decide({ imgEngine: 'gemini', videoEngine: 'grok' });
eq(d.branch, 'tts ∥ img ∥ video', 'API 이미지 + Grok → 전면 병렬(기존 동작)');

// 이미지 로컬 + Grok 비디오 → Grok 은 canParallel 에 묶여 파이프라인 제외 → 완전 순차
d = decide({ imgEngine: 'comfy::krea2', imgCloud: false, videoEngine: 'grok' });
eq(d.branch, 'tts → img', '이미지 로컬 + Grok → 완전 순차(브라우저·GPU 충돌 회피)');

// 비디오가 로컬 comfy = 파이프라인 제외(로컬 GPU 충돌)
d = decide({ imgEngine: 'rotate', videoEngine: 'comfy::ltx', vidCloud: false });
eq(d.branch, 'tts ∥ img', '비디오 로컬 → 비디오는 순차 3단계로');

// 비디오 없음
d = decide({ imgEngine: 'comfy::krea2', imgCloud: false, videoEngine: 'none' });
eq(d.branch, 'tts → img', '이미지 로컬 + 비디오 없음 → 순차');
d = decide({ imgEngine: 'rotate', videoEngine: 'none' });
eq(d.branch, 'tts ∥ img', '순환 이미지 + 비디오 없음 → TTS∥이미지');

// 무음(dry)·그룹 재구성(쇼츠 cut/prose)은 언제나 순차 — 기존 규칙 유지
d = decide({ imgEngine: 'rotate', videoEngine: 'comfy::ltx', vidCloud: true, dry: true });
eq(d.branch, 'tts → img', 'dry(무음)는 순차');
d = decide({ imgEngine: 'rotate', videoEngine: 'comfy::ltx', vidCloud: true, regroup: true });
eq(d.branch, 'tts → img', 'TTS 후 그룹 재구성이 있으면 순차(이미지가 그룹에 의존)');

console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 파이프라인 판정 ' + n + '/' + n + ' 통과');
process.exit(bad ? 1 : 0);
