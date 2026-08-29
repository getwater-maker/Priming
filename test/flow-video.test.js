'use strict';
// node test/flow-video.test.js — 「Flow(Google Flow · Veo) 비디오 엔진」 검증 (2026-08-28, v0.3.71)
//
// 배경: v0.1.71 에서 Flow 영상 엔진을 통째로 제거했었다(runFlowVideos 삭제). 로이 요청으로 되살리면서
//   Flow 웹 UI 를 다시 실측했고(2026-08-28, 로그인된 Chrome), 그 과정에서 **옛 코드의 거짓 가정 2개**를 찾았다:
//     ① _selectModel 이 'Nano Banana' 텍스트 버튼만 찾아 **동영상 모드에서 항상 실패**했다(로그도 없었다).
//        실제 라벨은 "Veo 3.1 - Lite"(기본)·"Veo 3.1 - Fast"·"Veo 3.1 - Quality"·"Omni 1.1 Flash".
//     ② _configureSettings 가 defaultModel 을 'Veo 3.1 - Fast' 로 알고 있었다 — 실제 기본은 **Lite**.
//        그래서 Fast/Quality 를 골라도 조용히 Lite 로 만들어졌다.
//
// 실측으로 확인한 Flow UI (2026-08-28):
//   설정 팝업 = role="tab" — [이미지|동영상] [프레임|애셋] [9:16|16:9] [x1..x4] + 모델 드롭다운 버튼
//   '프레임' 탭을 누르면 프롬프트 위에 [시작] ⇄ [종료] 버튼이 나타난다(= i2v 진입점)
//   '시작' → 미디어 선택창 · input[type=file] accept="image/*" (hidden) **1개** → setInputFiles 가능
//   최종 제출 버튼 = "arrow_forward 만들기" · 생성 비용 표시 = "10크레딧"(Veo 3.1 Lite · x1)
//
// 지키는 것:
//   ① 모델 선택이 동영상 모드에서도 동작한다(옛 단일 셀렉터·하드코딩 기본값이 없다)
//   ② 시작 프레임 첨부에 실패하면 **그 컷을 만들지 않는다** — 엉뚱한 영상에 크레딧을 쓰지 않는다
//   ③ 'flow' 가 정규화로 grok 에 되돌려지지 않는다(v0.3.50 계열 사고)
//   ④ Flow 비디오는 이미지와 같은 브라우저라 **파이프라인 병렬에 들어가지 않는다**
//
//   🔑 로직을 복사하지 않는다 — main.js·flow-engine.js 원문에서 뽑아 실행한다.

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const ENG = fs.readFileSync(path.join(ROOT, 'flow-engine.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'App.jsx'), 'utf8');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, m + '  (기대 ' + JSON.stringify(b) + ' / 실제 ' + JSON.stringify(a) + ')');

// ── 원문에서 async 함수 통째로 뽑기 (gpu-foreign.test.js 와 같은 방식) ──
function extractAsync(src, name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error(name + ' 를 찾을 수 없습니다(원문에 없음)');
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[1] flow-engine — 모델 선택이 동영상 모드에서도 동작하는가 (원문 대조)');

ok(/button:has-text\("Veo"\)/.test(ENG), '_selectModel 이 "Veo" 라벨 버튼을 찾는다 (동영상 모델 드롭다운)');
ok(/button:has-text\("Omni"\)/.test(ENG), '_selectModel 이 "Omni" 라벨도 찾는다 (Omni 1.1 Flash)');
ok(/button:has-text\("Nano Banana"\)/.test(ENG), '_selectModel 이 이미지 모델("Nano Banana")도 계속 찾는다 (회귀)');
ok(!/const dropdown = await this\.page\.\$\('button:has-text\("Nano Banana"\)'\);/.test(ENG),
  '⛔ 옛 단일 셀렉터(Nano Banana 전용)가 사라졌다 — 이게 동영상 모드 실패의 원인이었다');
ok(/getByRole\('menuitem'\)\.filter\(\{ hasText: model \}\)/.test(ENG),
  '열린 메뉴의 role=menuitem 에서 고른다 (트리거 버튼과 글자가 같아 exact text 만으론 그쪽을 집는다)');
ok(/if \(cur\.includes\(model\)\)/.test(ENG),
  '현재 라벨을 읽어 같으면 건너뛴다 — 하드코딩된 기본 모델 가정을 쓰지 않는다');
ok(!/const defaultModel = opts\.mediaType === 'video' \? 'Veo 3\.1 - Fast'/.test(ENG),
  "⛔ defaultModel='Veo 3.1 - Fast' 하드코딩이 사라졌다 (실제 기본은 Lite — 그 가정이 틀렸다)");
ok(/모델 드롭다운 못 찾음/.test(ENG), '모델 드롭다운을 못 찾으면 로그로 알린다 (예전엔 조용히 실패했다)');

console.log('[2] flow-engine — 시작 프레임 첨부 실패 시 그 컷을 만들지 않는가');
ok(/const frameOk = /.test(ENG) && ENG.indexOf(': await this._attachFrameImage(opts.frameImages[i], num)') >= 0,
  '첨부 함수의 반환값을 받는다 (예전엔 버리고 그대로 생성했다)');
ok(/if \(!frameOk && opts\.requireFrame !== false\)/.test(ENG),
  '첨부 실패면 그 컷을 건너뛴다 — 원본과 무관한 영상에 크레딧(10)을 쓰지 않는다');
ok(!/\bfailCount\b/.test(ENG),
  '⛔ 미정의 식별자 failCount 가 없다 (이 저장소 단골 사고 — 기존 카운터는 consecutiveFails·_failedNums)');
ok(/consecutiveFails\+\+;\r?\n\s*continue;/.test(ENG),
  '건너뛸 때 기존 실패 카운터(consecutiveFails)를 올린다');
ok(ENG.indexOf("const tabName = wantAsset ? '애셋' : '프레임';") >= 0 && /_clickTab\(tabName\)/.test(ENG),
  "서브탭을 누른다 — 기본은 '프레임'(2026-08-28 실측: 이게 있어야 [시작] 프레임 UI 가 뜬다)");

console.log('[3] flow-engine — CRLF 규약 유지');
{
  const raw = fs.readFileSync(path.join(ROOT, 'flow-engine.js'), 'latin1');
  const crlf = (raw.match(/\r\n/g) || []).length;
  const lone = (raw.match(/(?<!\r)\n/g) || []).length;
  ok(crlf > 4000 && lone === 0, 'flow-engine.js 는 전부 CRLF 다 (원래 규약 · lone LF ' + lone + '개)');
  ok(raw.indexOf(String.fromCharCode(0)) < 0, 'NUL 바이트가 없다');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[4] main.js — 배선 (원문 대조)');
ok(/async function runFlowVideos\(pr, mediaDir, onlyNums\)/.test(MAIN), 'runFlowVideos 가 존재한다');
ok(/if \(videoEngine === 'flow'\) \{ await runFlowVideos\(pr, mediaDir, onlyNums\); return \{\}; \}/.test(MAIN),
  "_genGroupVideosCore 가 videoEngine==='flow' 를 runFlowVideos 로 보낸다");
ok(!/\['flow', 'wan', 'grok10'\]\.includes/.test(MAIN),
  "⛔ run-batch 정규화가 'flow' 를 grok 으로 되돌리지 않는다 (v0.3.50 계열 — 넣으면 선택이 조용히 무시된다)");
ok(/\['wan', 'grok10'\]\.includes\(rawVe\)/.test(MAIN), "제거된 엔진(wan·grok10)은 여전히 grok 으로 보정한다");
{
  const gp = /const grokVideoPipeline = ([^;]+);/.exec(MAIN);
  ok(!!gp && !/flow/.test(gp[1]),
    'grokVideoPipeline 에 flow 가 없다 — Flow 비디오는 이미지와 같은 브라우저라 순차 3단계로 가야 한다');
}
ok(/mediaType: 'video', model, count: 'x1'/.test(MAIN),
  "매수는 x1 고정 (그룹당 1개만 쓴다 — x2~x4 는 크레딧 배수)");
ok(/frameImages,/.test(MAIN), 'frameImages(그룹 이미지)를 시작 프레임으로 넘긴다 — t2v 가 아니라 i2v');
ok(/flowVideoModel/.test(MAIN), '모델을 image-rotation 설정에서 읽는다');
ok(/normalizePromptNegations\(/.test(MAIN.slice(MAIN.indexOf('async function runFlowVideos'), MAIN.indexOf('async function runFlowVideos') + 6000)),
  '부정 절을 끝으로 모은다 (이미지·ComfyUI 와 같은 정책)');

console.log('[5] main.js — Flow 는 로컬 GPU 레인을 잡지 않는다 (브라우저라 그 레인과 무관)');
{
  const BODY = extractAsync.call(null, MAIN.replace('function _vidUsesLocalGpu', 'async function _vidUsesLocalGpu'), '_vidUsesLocalGpu');
  const fn = new Function('isComfyVal', 'require', BODY + '\nreturn _vidUsesLocalGpu;')(
    (v) => v === 'comfy' || String(v || '').indexOf('comfy::') === 0,
    () => ({ loadConfig: () => ({ cloud: false }) }));
  fn('flow').then((r) => eq(r, false, "_vidUsesLocalGpu('flow') = false"));
  fn('comfy').then((r) => eq(r, true, "_vidUsesLocalGpu('comfy') = true (회귀 — 로컬 comfy 는 잡는다)"));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[6] runFlowVideos 원문 실행 — 대상 선정·출력 매핑·계정 순환');

const BODY_RFV = extractAsync(MAIN, 'runFlowVideos');

function mkProject(groups) {
  return {
    shortsNum: 1, aspect: '16:9', groups,
    getSentencesOfGroup: (g) => [{ text: 'G' + g.num + ' 문장' }],
  };
}

// eng.run 을 흉내: workDir/images 에 `NN_본문.mp4` 를 만든다(= flow-engine 의 실제 저장 규약)
function makeHarness({ groups, produce, accounts, aspect = '16:9', attach = 'frame', dl = '1080p' }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvid-test-'));
  const mediaDir = path.join(tmp, 'media-1');
  const pr = mkProject(groups); pr.aspect = aspect;
  const logs = [];
  const runCalls = [];
  const marked = [];
  const cooled = [];
  let accIdx = 0;
  const accList = accounts || [{ id: 'a1', label: '계정 1', used: 0 }];
  const FakeAccounts = {
    load: () => ({ dailyCap: 45 }),
    list: () => ({ accounts: accList }),
    pickNext: (tried) => accList.find((a) => !tried.has(a.id)) || null,
    markUsed: (id, k) => marked.push([id, k]),
    cooldown: (id, min) => cooled.push([id, min]),
  };
  const fakeRequire = (m) => {
    if (/flow-accounts/.test(m)) return FakeAccounts;
    if (/image-rotation/.test(m)) return { load: () => ({ flowVideoModel: 'Veo 3.1 - Fast', flowVideoAttach: attach, flowVideoDownload: dl }) };
    throw new Error('unexpected require: ' + m);
  };
  const engLogs = [];
  const eng = {
    log: (m) => engLogs.push(String(m)),
    run: async (opts) => {
      runCalls.push(opts);
      const imgDir = path.join(opts.outputDir, 'images');
      const made = produce ? produce(opts) : opts.paragraphs.map((_, i) => i);
      made.forEach((i) => {
        fs.writeFileSync(path.join(imgDir, String(i + 1).padStart(2, '0') + '_본문.mp4'), 'MP4' + i);
      });
      return {};
    },
  };
  const fn = new Function(
    'fs', 'path', 'os', 'S', 'log', 'pushDtoUpdate', 'getFlowEng', 'flowProfileDir', 'prLabel', 'P',
    'require', 'setInterval', 'clearInterval',
    BODY_RFV + '\nreturn runFlowVideos;'
  )(fs, path, os, { abort: false }, (m) => logs.push(String(m)), () => {}, () => eng,
    (id) => path.join(tmp, 'prof', id), () => '[테스트]',
    { normalizePromptNegations: (p) => p },
    fakeRequire, () => 0, () => {});
  return { fn, pr, mediaDir, tmp, logs, runCalls, marked, cooled, engLogs, eng };
}

function img(dir, num) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, String(num).padStart(2, '0') + '.png');
  fs.writeFileSync(p, 'PNG');
  return p;
}

(async () => {
  // ── 6-1 이미지가 있는 그룹만 대상, 출력이 NN.mp4 로 매핑된다 ──
  {
    const tmpImg = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvid-img-'));
    const groups = [
      { num: 1, imagePath: img(tmpImg, 1), videoPrompt: 'slow pan' },
      { num: 2, imagePath: null, videoPrompt: 'zoom' },              // 이미지 없음 → 제외
      { num: 3, imagePath: img(tmpImg, 3), motionNote: 'drift' },
    ];
    const h = makeHarness({ groups });
    await h.fn(h.pr, h.mediaDir, null);
    eq(h.runCalls.length, 1, '엔진을 1회 호출한다');
    eq(h.runCalls[0].paragraphs.length, 2, '이미지 있는 그룹(G1·G3)만 대상이다 — G2 는 제외');
    eq(h.runCalls[0].mediaType, 'video', "mediaType='video'");
    eq(h.runCalls[0].count, 'x1', "매수 x1 고정");
    eq(h.runCalls[0].model, 'Veo 3.1 - Fast', '설정의 flowVideoModel 을 그대로 넘긴다');
    eq(h.runCalls[0].ratio, '16:9', '프로젝트 비율을 넘긴다');
    eq(h.runCalls[0].frameImages.length, 2, '시작 프레임으로 그룹 이미지를 넘긴다');
    eq(h.runCalls[0].attachMode, 'frame', "기본 첨부 방식은 'frame'(첫 프레임 고정 i2v)");
    eq(h.runCalls[0].videoDownload, '1080p', "기본 다운로드는 1080p(업스케일본) — 로컬 GPU 업스케일이 생략된다");
    ok(h.runCalls[0].frameImages[0].endsWith('01.png'), '첫 프레임 = G1 이미지');
    eq(h.runCalls[0].customPrompts[0], 'slow pan', '대본의 영상 프롬프트를 쓴다');
    eq(h.runCalls[0].customPrompts[1], 'drift', '영상 프롬프트가 없으면 모션 노트를 쓴다');
    eq(groups[0].videoPath, path.join(h.mediaDir, '01.mp4'), 'G1 → media/01.mp4 로 매핑');
    eq(groups[2].videoPath, path.join(h.mediaDir, '03.mp4'), 'G3 → media/03.mp4 (그룹 번호 기준 — 제출 순서 아님)');
    eq(groups[1].videoPath, undefined, '대상이 아니던 G2 는 건드리지 않는다');
    eq(groups[0].videoStatus, 'done', '성공 그룹은 done');
    eq(h.marked[0][1], 2, '실제 만든 개수(2)로 계정 사용량을 기록한다');
    fs.rmSync(h.tmp, { recursive: true, force: true });
    fs.rmSync(tmpImg, { recursive: true, force: true });
  }

  // ── 6-2 이미 영상이 있으면 건너뛴다(이어받기) ──
  {
    const tmpImg = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvid-img2-'));
    const have = path.join(tmpImg, 'old.mp4'); fs.writeFileSync(have, 'MP4');
    const groups = [
      { num: 1, imagePath: img(tmpImg, 1), videoPath: have },
      { num: 2, imagePath: img(tmpImg, 2), videoPrompt: 'x' },
    ];
    const h = makeHarness({ groups });
    await h.fn(h.pr, h.mediaDir, null);
    eq(h.runCalls[0].paragraphs.length, 1, '이미 영상이 있는 G1 은 건너뛴다 (이어받기)');
    eq(groups[0].videoPath, have, 'G1 의 기존 영상 경로는 그대로 둔다');
    fs.rmSync(h.tmp, { recursive: true, force: true });
    fs.rmSync(tmpImg, { recursive: true, force: true });
  }

  // ── 6-3 onlyNums 범위 ──
  {
    const tmpImg = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvid-img3-'));
    const groups = [1, 2, 3].map((k) => ({ num: k, imagePath: img(tmpImg, k), videoPrompt: 'p' + k }));
    const h = makeHarness({ groups });
    await h.fn(h.pr, h.mediaDir, [2]);
    eq(h.runCalls[0].paragraphs.length, 1, 'onlyNums=[2] 면 G2 만 만든다 (영상 범위)');
    eq(groups[1].videoPath, path.join(h.mediaDir, '02.mp4'), 'G2 만 매핑된다');
    fs.rmSync(h.tmp, { recursive: true, force: true });
    fs.rmSync(tmpImg, { recursive: true, force: true });
  }

  // ── 6-4 일부만 만들어져도 나머지가 'generating' 에 고착되지 않는다 (v0.2.62 계열) ──
  {
    const tmpImg = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvid-img4-'));
    const groups = [1, 2].map((k) => ({ num: k, imagePath: img(tmpImg, k), videoPrompt: 'p' }));
    const h = makeHarness({ groups, produce: () => [0] });   // 첫 컷만 성공
    await h.fn(h.pr, h.mediaDir, null);
    eq(groups[0].videoStatus, 'done', '만들어진 G1 = done');
    eq(groups[1].videoStatus, 'fail', "못 만든 G2 = fail (스피너가 영원히 도는 'generating' 고착 없음)");
    fs.rmSync(h.tmp, { recursive: true, force: true });
    fs.rmSync(tmpImg, { recursive: true, force: true });
  }

  // ── 6-5 한 계정이 0개면 다음 계정으로 순환한다 ──
  {
    const tmpImg = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvid-img5-'));
    const groups = [{ num: 1, imagePath: img(tmpImg, 1), videoPrompt: 'p' }];
    let call = 0;
    const h = makeHarness({
      groups,
      accounts: [{ id: 'a1', label: '계정 1', used: 0 }, { id: 'a2', label: '계정 2', used: 0 }],
      produce: () => (++call === 1 ? [] : [0]),   // 1번 계정 0개 → 2번 계정 성공
    });
    await h.fn(h.pr, h.mediaDir, null);
    eq(h.runCalls.length, 2, '0개면 다음 계정으로 순환한다');
    ok(!!groups[0].videoPath, '두 번째 계정이 만들어 낸다');
    ok(h.logs.some((l) => /영상 0개/.test(l)), '0개였다는 사실을 로그로 남긴다');
    fs.rmSync(h.tmp, { recursive: true, force: true });
    fs.rmSync(tmpImg, { recursive: true, force: true });
  }

  // ── 6-6 대상이 없으면 브라우저를 띄우지 않는다 ──
  {
    const groups = [{ num: 1, imagePath: null }];
    const h = makeHarness({ groups });
    await h.fn(h.pr, h.mediaDir, null);
    eq(h.runCalls.length, 0, '이미지가 없으면 엔진을 호출하지 않는다 (헛 브라우저 기동 방지)');
    ok(h.logs.some((l) => /영상화할/.test(l)), '이유를 로그로 남긴다');
    fs.rmSync(h.tmp, { recursive: true, force: true });
  }

  // ── 6-7 설정이 'asset' 이면 그대로 엔진에 전달된다 ──
  {
    const tmpImg = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvid-img7-'));
    const groups = [{ num: 1, imagePath: img(tmpImg, 1), videoPrompt: 'p' }];
    const h = makeHarness({ groups, attach: 'asset' });
    await h.fn(h.pr, h.mediaDir, null);
    eq(h.runCalls[0].attachMode, 'asset', "설정이 asset 이면 attachMode='asset' 으로 넘어간다");
    ok(h.logs.some((l) => l.indexOf('애셋(참조)') >= 0), '로그에 어느 방식으로 붙였는지 남는다');
    fs.rmSync(h.tmp, { recursive: true, force: true });
    fs.rmSync(tmpImg, { recursive: true, force: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[9] 애셋 모드 — 프레임과 붙이는 자리가 다르다 (원문 대조)');
  ok(ENG.indexOf('async _attachAssetImage(imagePath, num)') >= 0, '_attachAssetImage 가 존재한다');
  ok(ENG.indexOf('aria-haspopup=\"dialog\"]:has-text(\"add_2\")') >= 0,
    "프롬프트 바의 [+] 를 add_2 + aria-haspopup=dialog 로 찾는다 (상단 툴바의 'add 미디어 추가' 와 구분)");
  ok(ENG.indexOf("_uploadAndAddToPrompt(imagePath, num, '애셋')") >= 0,
    '업로드→「프롬프트에 추가」 는 프레임과 같은 다이얼로그를 쓴다(공통 헬퍼)');
  ok(ENG.indexOf("const wantAsset = opts.attachMode === 'asset'") >= 0,
    "설정 팝업에서 '애셋'/'프레임' 서브탭을 갈라 누른다");
  ok(ENG.indexOf("? await this._attachAssetImage") >= 0, 'run() 이 방식에 따라 애셋/프레임 함수를 분기한다');
  ok(ENG.indexOf('frameImages, attachMode, requireFrame,') >= 0,
    '⛔ attachMode 가 _runSequentialMode 까지 전달된다 — 안 넘기면 골라도 늘 frame 으로 동작한다');
  ok(ENG.indexOf("attachMode = 'frame',") >= 0, "run() 기본값은 'frame'(원본을 그대로 움직이는 쪽이 안전)");
  ok(APP.indexOf('flowVideoAttach: e.target.value') >= 0, 'App.jsx 에서 첨부 방식을 저장한다');
  ok(APP.indexOf('프레임 — 첫 프레임 고정 (권장)') >= 0, '설정에 첨부 방식 선택지가 있다');
  ok(MAIN.indexOf('attachMode,') >= 0, 'runFlowVideos 가 attachMode 를 엔진에 넘긴다');
  ok(MAIN.indexOf("_rot.flowVideoAttach === 'asset' ? 'asset' : 'frame'") >= 0,
    '설정값이 asset 일 때만 asset — 그 외에는 안전한 frame 으로 떨어진다');

  // ── 6-8 다운로드 해상도가 설정대로 전달된다 ──
  {
    const tmpImg = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvid-img8-'));
    const groups = [{ num: 1, imagePath: img(tmpImg, 1), videoPrompt: 'p' }];
    const h = makeHarness({ groups, dl: '720p' });
    await h.fn(h.pr, h.mediaDir, null);
    eq(h.runCalls[0].videoDownload, '720p', '설정한 해상도가 그대로 넘어간다');
    fs.rmSync(h.tmp, { recursive: true, force: true });
    fs.rmSync(tmpImg, { recursive: true, force: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[10] 1080p 다운로드 — 재생 소스는 720p 원본이다 (원문 대조)');
  ok(ENG.indexOf('async _downloadVideoFromCard(card, num, want = ' + String.fromCharCode(39) + '1080p' + String.fromCharCode(39) + ')') >= 0,
    '_downloadVideoFromCard 가 존재한다 (기본 1080p)');
  ok(ENG.indexOf('await dl.hover();') >= 0,
    "「다운로드」는 **hover** 로 서브메뉴가 열린다 — 클릭이 아니다(2026-08-28 실측)");
  ok(ENG.indexOf("getByRole('menuitem').filter({ hasText: '다운로드' })") >= 0,
    '메뉴에서 다운로드 항목을 텍스트로 찾는다 (접근성 이름이 비어 있어 role 이름 매칭은 안 된다)');
  ok(ENG.indexOf("waitForEvent('download'") >= 0, '브라우저 다운로드 이벤트를 받아 저장한다');
  ok(ENG.indexOf('async _mediaIds()') >= 0 && ENG.indexOf('async _newMediaCard(beforeIds') >= 0,
    '⛔ 제출 전후 카드 id 를 비교해 **방금 만든 것**만 집는다 (갤러리의 옛 영상을 받아가던 v0.3.20 계열 사고 방지)');
  ok(ENG.indexOf('const beforeIds = ') >= 0 && ENG.indexOf('await this._clickFinalCreateV2()') > ENG.indexOf('const beforeIds = '),
    '스냅샷은 **제출보다 먼저** 찍는다 (뒤에 찍으면 새 카드가 이미 포함돼 구분이 안 된다)');
  ok(ENG.indexOf('frameImages, attachMode, requireFrame, videoDownload,') >= 0,
    '⛔ videoDownload 가 _runSequentialMode 까지 전달된다 — 안 넘기면 설정이 조용히 무시된다');
  ok(ENG.indexOf("videoDownload = '1080p',") >= 0, 'run() 기본값이 1080p 다');
  ok(ENG.indexOf('재생 소스(720p 원본) 사용') >= 0, '다운로드가 안 되면 재생 소스로 폴백하고 그 사실을 로그로 남긴다');
  ok(MAIN.indexOf('videoDownload,') >= 0, 'runFlowVideos 가 videoDownload 를 엔진에 넘긴다');
  ok(APP.indexOf('flowVideoDownload: e.target.value') >= 0, 'App.jsx 에서 다운로드 해상도를 저장한다');
  ok(APP.indexOf('1080p — 업스케일본 (권장)') >= 0, '설정에 다운로드 해상도 선택지가 있다');

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[11] 업로드 대기 — 「프롬프트에 추가」는 처리(약 9초)가 끝나야 활성화된다');
  ok(ENG.indexOf('waitForTimeout(3500)') < 0,
    '⛔ 고정 3.5초 대기가 없다 — 실측 약 9초라 그 시점엔 버튼이 disabled 여서 클릭이 타임아웃됐다(2026-08-28 실사고)');
  ok(ENG.indexOf('waitForFunction') >= 0 && ENG.indexOf('!b.disabled') >= 0,
    '버튼이 **enabled 될 때까지** 기다린다 (고정 대기는 네트워크 상태에 따라 또 실패한다)');
  ok(ENG.indexOf('.filter({ visible: true }).first()') >= 0,
    '보이는 버튼만 집는다 (.first() 가 숨은 쪽을 집으면 클릭이 타임아웃난다)');
  ok(ENG.indexOf('for (let k = 0; k < 2 && !clicked; k++)') >= 0,
    '⛔ 클릭을 **매번 다시 찾아** 재시도한다 — 두 번째 컷에서 locator.click 5초 타임아웃을 실측했다(2026-08-29)');
  ok(ENG.indexOf('locator 클릭이 막혀 DOM 클릭으로 확정') >= 0,
    '그래도 안 되면 DOM 클릭으로 확정한다 (여기서 실패하면 그 컷이 통째로 버려진다)');
  ok(ENG.indexOf("await this._uploadAndAddToPrompt(imagePath, num, 'i2v')") >= 0,
    '⛔ 프레임 경로도 **같은 공통 헬퍼**를 쓴다 — 두 벌로 두면 한쪽만 고쳐져 어긋난다');
  {
    // 업로드→추가 로직이 정말 한 곳에만 있는가 (setInputFiles 호출 지점 = 1곳)
    const cnt = (ENG.match(/setInputFiles\(imagePath\)/g) || []).length;
    ok(cnt === 1, '업로드(setInputFiles) 구현이 한 곳뿐이다  (실제 ' + cnt + '곳)');
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[12] 실물 검증 결과 고정 (2026-08-28 · 실제로 1개 만들어 확인)');
  // 실측: 1920x1080 · h264 · 24fps · 8.00초 · aac · 6.7MB (네트워크 캡처 720p 는 2.6MB 였다)
  //   → maybeUpscale 이 'width >= 1920 && height >= 1080' 이라 **로컬 GPU 업스케일을 건너뛴다**.
  ok(MAIN.indexOf('if (info.width >= W && info.height >= H) {') >= 0,
    '업스케일 생략 판정이 그대로다 — Flow 1080p(1920x1080)면 로컬 업스케일을 건너뛴다');
  ok(MAIN.indexOf('⬆ 업스케일 생략') >= 0, '생략했다는 사실을 로그로 남긴다');

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[13] 「멈춘 것 같다」 방지 — 조용한 구간에 진행을 남긴다');
  ok(ENG.indexOf('const _dlTick = setInterval(') >= 0,
    '1080p 업스케일·다운로드 대기 중 20초마다 경과를 남긴다 (실측 1~3분 동안 화면이 조용하다)');
  ok(ENG.indexOf('업스케일본을 만드는 중입니다') >= 0, '대기 시작을 알린다 — 무엇을 기다리는지 적는다');
  ok(ENG.indexOf('clearInterval(_dlTick)') >= 0, '끝나면 타이머를 반드시 정리한다(누수 방지)');
  ok(ENG.indexOf("waitForEvent('download', { timeout: 300000 })") >= 0,
    '다운로드 대기를 300초로 — 실사용에서 2분 넘게 걸린 적이 있다(로이 23:47~23:51)');
  ok(MAIN.indexOf('eng._appLogHooked = true;') >= 0 && MAIN.indexOf("logToFile('[Flow] ' + msg)") >= 0,
    '⛔ 엔진 로그를 앱 **로그 파일**에도 남긴다 — 예전엔 화면(send)에만 가서 나중에 되짚을 기록이 없었다');
  ok(MAIN.indexOf("if (!eng._appLogHooked && typeof eng.log === 'function')") >= 0,
    'eng 는 재사용 인스턴스라 **한 번만** 감싼다 (중복 기록 방지)');

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[14] 브라우저 수명주기가 로그로 보인다 (창이 왜 새로 뜨는지)');
  ok(MAIN.indexOf('♻ Flow 브라우저 재사용') >= 0,
    '같은 계정이면 재사용한다는 사실을 남긴다 — 대본 하나는 창 하나로 끝난다');
  ok(MAIN.indexOf('🔀 Flow 계정이 바뀌어 기존 브라우저를 닫습니다') >= 0,
    '계정 교체로 창을 새로 열 때 이유를 남긴다 (예전엔 조용해서 원인을 알 수 없었다)');
  ok(MAIN.indexOf('🧹 Flow 브라우저를 닫습니다') >= 0,
    '작업이 끝나 창을 닫을 때도 남긴다 — 다음 클릭이 새 창인 이유가 드러난다');
  ok(ENG.indexOf('[Flow] 기존 브라우저 재사용') >= 0,
    '엔진 쪽 재사용 로그는 원래 있었다 (v0.3.75 부터 파일에도 남는다)');

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[15] 재시도가 화풍을 잃지 않는다 — 소스 이미지 재첨부 (2026-08-29 실사고)');
  ok(ENG.indexOf('async _reattachSource(opts, i, num)') >= 0, '_reattachSource 가 존재한다');
  {
    // 재시도 경로는 **두 곳**(일반 5회 · rate-limit 1회) — 한쪽만 고치면 그쪽에서 t2v 가 된다.
    const cnt = (ENG.match(/this\._reattachSource\(opts, i, num\)/g) || []).length;
    ok(cnt === 2, '두 재시도 경로가 모두 재첨부한다  (실제 ' + cnt + '곳)');
  }
  ok(ENG.indexOf('if (!(await this._reattachSource(opts, i, num))) continue;') >= 0,
    '⛔ 재첨부에 실패하면 그 재시도를 건너뛴다 — 엉뚱한 화풍으로 크레딧을 쓰지 않는다');
  ok(ENG.indexOf("opts.attachMode === 'asset'") >= 0 && ENG.indexOf('? await this._attachAssetImage(opts.frameImages[i], num)') >= 0,
    '재첨부도 설정한 방식(프레임/애셋)을 따른다');
  {
    // 🔴 저장 지점이 다시 흩어지지 않게 — _saveImage 직접 호출은 이미지 전용 1곳뿐이어야 한다
    const cnt = (ENG.match(/await this\._saveResult\(/g) || []).length;
    ok(cnt === 3, '저장은 _saveResult 로만 한다 — 첫 시도 + 재시도 2곳  (실제 ' + cnt + '곳)');
  }
  ok(ENG.indexOf('⚠ 생성 실패 감지:') >= 0,
    '생성 실패 사유가 **파일에 남는 로그**로 나온다 (debug 는 파일에 안 남는다)');

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[7] App.jsx — 드롭다운·정규화·설정 UI');
  {
    // 🔑 비디오 엔진을 고르는 곳은 **두 군데**다 — 헤더 「③ 비디오」와 ⚙ 채널 편집.
    //   한쪽만 고치면 채널에 Flow 를 지정할 수 없다(2026-08-29 로이 지적: 채널 편집에 VEO 가 없었다).
    const cnt = (APP.match(/<option value="flow">Flow · Veo \(구독\)<\/option>/g) || []).length;
    ok(cnt === 2, '「Flow · Veo (구독)」 항목이 **헤더와 채널 편집 양쪽**에 있다  (실제 ' + cnt + '곳)');
  }
  ok(APP.indexOf('<option value="flow">Flow (구독)</option>') >= 0,
    '이미지 쪽 Flow 항목은 그대로다 (회귀)');
  ok(!/\['flow', 'wan', 'grok10'\]\.includes/.test(APP),
    "⛔ 'flow' 를 grok 으로 되돌리는 정규화가 없다 — 있으면 골라도 다음에 열 때 Grok 으로 돌아간다");
  eq((APP.match(/\['wan', 'grok10'\]\.includes/g) || []).length, 2,
    '옛 엔진(wan·grok10) 보정은 2곳 그대로 유지된다');
  ok(/videoEngine === 'flow' && <button/.test(APP), "Flow 선택 시 설정 버튼(⚙ Veo)이 나온다");
  ok(/flowVideoModel: e\.target\.value/.test(APP), '설정에서 Flow 비디오 모델을 저장한다');
  ok(/Veo 3\.1 - Quality/.test(APP), '모델 3종(Lite·Fast·Quality)이 선택지에 있다');
  ok(/브라우저 이미지·비디오/.test(APP), '설정 탭 이름이 비디오까지 포함하도록 바뀌었다');
  ok(/10크레딧/.test(APP), '크레딧 비용을 UI 에 알린다 (실측: Veo 3.1 Lite x1 = 10크레딧)');

  // 번들에도 실제로 들어갔는가 — 소스만 고치고 빌드를 안 하면 화면은 옛것이다
  {
    const dist = path.join(ROOT, 'renderer', 'dist', 'assets');
    let js = '';
    try {
      for (const f of fs.readdirSync(dist)) if (/\.js$/.test(f)) js += fs.readFileSync(path.join(dist, f), 'utf8');
    } catch (_) {}
    ok(js.length > 0, '렌더러 번들이 있다');
    ok(js.indexOf('Flow · Veo (구독)') >= 0, '번들에도 Flow 항목이 들어갔다 (빌드 반영 확인)');
  }

  console.log('\n[8] image-rotation — flowVideoModel 저장·로드 (실제 홈 파일은 건드리지 않는다)');
  {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvid-home-'));
    const saveHome = process.env.USERPROFILE, saveH2 = process.env.HOME;
    process.env.USERPROFILE = home; process.env.HOME = home;
    for (const k of Object.keys(require.cache)) if (/image-rotation/.test(k)) delete require.cache[k];
    const R = require(path.join(ROOT, 'core', 'image-rotation.js'));
    eq(R.load().flowVideoModel, 'Veo 3.1 - Lite', '기본값은 Veo 3.1 - Lite (실측 Flow 기본과 같다)');
    R.save({ flowVideoModel: 'Veo 3.1 - Quality' });
    for (const k of Object.keys(require.cache)) if (/image-rotation/.test(k)) delete require.cache[k];
    const R2 = require(path.join(ROOT, 'core', 'image-rotation.js'));
    eq(R2.load().flowVideoModel, 'Veo 3.1 - Quality', '저장한 값이 다시 로드된다');
    eq(R2.load().flowImageModel, 'Nano Banana 2', '이미지 모델 설정은 그대로다 (회귀)');
    process.env.USERPROFILE = saveHome; process.env.HOME = saveH2;
    for (const k of Object.keys(require.cache)) if (/image-rotation/.test(k)) delete require.cache[k];
    fs.rmSync(home, { recursive: true, force: true });
  }

  console.log('\n' + (bad === 0 ? '✅ ' : '❌ ') + (n - bad) + '/' + n + ' 통과');
  process.exit(bad === 0 ? 0 : 1);
})();
