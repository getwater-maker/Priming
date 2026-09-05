'use strict';
// node test/genspark-video.test.js — 「비디오 엔진에 Genspark 추가」 검증.
//   로이 요청(2026-09-03): "비디오 생성기능에서 젠스파크를 추가해줘. 이미지 생성과 같은 개념"
//     + "비디오생성 도구는 사용자가 선택할수 있도록 설정창에서 … 아직 어느것이 성능과 비용이 좋은지 알수가 없어서"
//   지키려는 것:
//     ① 드롭다운은 **두 곳**(헤더 + 채널편집)에 다 있어야 한다 — 한쪽만 고치면 채널 기본값으로 못 쓴다(v0.3.76)
//     ② 모델 목록이 **엔진과 렌더러에서 어긋나지 않는다**(렌더러는 require 를 못 써서 두 벌이 된다)
//     ③ 길이는 **모델이 받아 주는 범위로 맞춘다** — 모델마다 다르다(하드코딩하면 조용히 틀린 길이가 나간다)
//     ④ 이미지 첨부 실패 시 **그 컷을 만들지 않는다** — 원본과 무관한 영상 + 크레딧 낭비 방지(Flow v0.3.80)
//     ⑤ 이미지 순환과 **같은 크롬**이라 동시에 돌지 않는다(gensparkBrowser 레인)
//   🔑 실측 근거(라이브 DOM 2026-09-03)를 단언으로 박는다 — UI 가 바뀌면 여기서 먼저 깨진다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'App.jsx'), 'utf8');
const ENGSRC = fs.readFileSync(path.join(ROOT, 'genspark-engine.js'), 'utf8');
const ENG = require(path.join(ROOT, 'genspark-engine'));
const ROT = require(path.join(ROOT, 'core', 'image-rotation'));

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };

// ── [1] 실측 셀렉터가 그대로 박혀 있는지 ──
const S = ENG.GENSPARK_VIDEO_SELECTORS;
ok(ENG.GENSPARK_VIDEO_URL === 'https://www.genspark.ai/agents?type=video_generation_agent', '비디오 페이지 URL(로이가 준 주소)');
ok(S.promptInput.includes('textarea.search-input'), '프롬프트 입력 = textarea.search-input (이미지와 동일)');
ok(S.sendButton.includes('enter-icon'), '전송 = .enter-icon (이미지와 동일)');
ok(S.ratioOption === 'div.ratio-grid div.ratio-option', '종횡비 = .ratio-grid .ratio-option (실측)');
ok(S.durationInput === 'input.duration-input', '재생 시간 = input.duration-input (실측 — 숫자 입력이 있다)');
ok(S.autoPromptToggle.includes('reflection-toggle'), '자동 프롬프트 = .reflection-toggle (이미지와 동일)');
ok(S.addEntryBtn === 'div.add-entry-btn', '이미지 첨부 = .add-entry-btn (+ 버튼, 실측)');
ok(/로컬 파일 찾기/.test(S.localFileItem), '첨부 메뉴 항목 = 「로컬 파일 찾기」 (실측)');
ok(/에셋.*동영상|동영상.*에셋/.test(ENGSRC), '⚠ 「에셋」은 동영상 업로드용이라는 실측을 기록했다');

// ── [2] 모델 목록 — 엔진 ↔ 렌더러가 어긋나지 않는지 ──
const M = ENG.GENSPARK_VIDEO_MODELS;
ok(Array.isArray(M) && M.length >= 18, `모델 목록 ${M.length}개 (실측 23개 중 용도에 맞는 것)`);
ok(M.some((x) => x.name === 'Gemini Omni Flash'), '로이 지정 기본 모델이 목록에 있다');
ok(M.some((x) => x.name === 'Seedance 2.5'), 'Seedance 2.5 (1080p)');
ok(M.some((x) => x.name === '모델 자동 선택'), '「모델 자동 선택」 도 고를 수 있다');
// ⛔ 우리 용도가 아닌 것은 넣지 않았다
for (const bad2 of ['Fal Lipsync V3', 'ByteDance Video Upscaler', 'Kling V3 Motion Control']) {
  ok(!M.some((x) => x.name === bad2), `⛔ ${bad2} 는 목록에 없다(우리 파이프라인과 무관)`);
}
// 🔴 렌더러 목록과 이름이 같은지 — 두 벌이라 반드시 대조한다
{
  const m = APP.match(/const GS_VIDEO_MODELS = \[([\s\S]*?)\n\];/);
  ok(!!m, '렌더러에 GS_VIDEO_MODELS 가 있다');
  if (m) {
    const names = [...m[1].matchAll(/name: '([^']+)'/g)].map((x) => x[1]);
    ok(names.length === M.length, `렌더러 목록 개수 일치 (엔진 ${M.length} · 렌더러 ${names.length})`);
    const engNames = M.map((x) => x.name);
    const diff = names.filter((x) => !engNames.includes(x)).concat(engNames.filter((x) => !names.includes(x)));
    ok(diff.length === 0, '🔴 엔진 ↔ 렌더러 모델 이름이 완전히 같다 — 다른 것: ' + diff.join(', '));
  }
}
ok(Array.isArray(ENG.GENSPARK_VIDEO_TIERS) && ENG.GENSPARK_VIDEO_TIERS.join(',') === 'Standard,Ultra', '등급 = Standard/Ultra (실측)');

// ── [3] 길이 — 모델이 받아 주는 범위로 맞추는지(하드코딩 금지) ──
ok(/getAttribute\('min'\)/.test(ENGSRC) && /getAttribute\('max'\)/.test(ENGSRC), '🔴 길이 범위를 **페이지에서 읽는다**(모델마다 다르다)');
ok(/이 모델의 범위/.test(ENGSRC), '범위를 넘어 clamp 하면 로그로 알린다');
ok(ENG.GS_VIDEO_MIN_SEC === 3 && ENG.GS_VIDEO_MAX_SEC === 10, '폴백 범위는 Omni Flash 실측값(3~10초)');
ok(/모델마다 다르다/.test(ENGSRC), '「모델마다 다르다」는 사실을 주석으로 남겼다');

// ── [4] 첨부 실패 시 그 컷을 만들지 않는지 ──
ok(/requireImage/.test(ENGSRC), 'requireImage 옵션이 있다');
// 🔑 메시지만 보면 안 된다 — 분기를 `if (false)` 로 바꿔도 문구는 남는다(A/B 에서 실제로 놓쳤다).
//   **판정식 자체**를 단언한다.
ok(/if \(!ok && requireImage\) \{/.test(ENGSRC), '🔴 첨부 실패(!ok) + requireImage 면 그 컷을 만들지 않는 **분기가 살아 있다**');
ok(/if \(!ok && requireImage\) \{[\s\S]{0,200}return \{ success: false/.test(ENGSRC), '그 분기가 실제로 실패를 반환한다(계속 진행하지 않는다)');
ok(/시작 이미지 첨부 실패[\s\S]{0,120}만들지 않았습니다/.test(ENGSRC), '첨부 실패를 사람 말로 알린다');
ok(/waitForEvent\('filechooser'/.test(ENGSRC), 'filechooser 로 첨부한다(실측으로 동작 확인)');
ok(/waitForEvent\('filechooser'[\s\S]{0,300}await plus\.click/.test(ENGSRC), '🔴 filechooser 를 **클릭 전에** 걸어 둔다(뒤에 걸면 놓친다)');

// ── [4-b] 🔴 한도 오탐 — 비디오 페이지의 **상시 안내 배너**를 한도로 보지 않는지 ──
//   2026-09-03 실사고: 이미지용 판정을 그대로 써서 「기획에는 무료 할당량을 사용합니다. 영상 및 오디오는
//   크레딧을 소모합니다」 배너에 걸려 **6초 만에 창이 닫히고** 계정에 1시간 쿨다운까지 잘못 걸렸다.
{
  const REAL_BANNER = '기획에는 무료 할당량을 사용합니다. 영상 및 오디오는 크레딧을 소모합니다.사용량 보기 ›  ×';
  const hard = (m) => ENG.GS_HARD_LIMIT_RE.test(m);
  ok(!hard(REAL_BANNER), '🔴 실사고 배너를 한도로 보지 않는다');
  ok(ENG.GS_BENIGN_NOTICE_RE.test(REAL_BANNER), '그 배너는 「평범한 안내」로 분류된다');
  // 진짜 못 만드는 상태는 잡는다
  ok(hard('AI Image 5시간 제한에 도달했습니다. 9월 3일 16:59에 재설정됩니다'), '시간 제한(이미지형)은 잡는다');
  ok(hard('크레딧이 소진되었습니다'), '포인트 소진을 잡는다');
  ok(hard('포인트가 부족합니다'), '포인트 부족을 잡는다');
  ok(hard('You are out of credits'), '영문 소진을 잡는다');
  ok(hard('영상 및 오디오는 크레딧을 소모합니다. 크레딧이 소진되었습니다'), '🔴 안내 배너와 섞여 있어도 소진을 잡는다');
  // 포인트 소진 ↔ 시간 한도 구분 — 로이: "이미지는 시간한도, 비디오는 포인트 차감"
  ok(ENG.GensparkEngine.isPointExhausted('크레딧이 소진되었습니다'), '포인트 소진으로 분류');
  ok(!ENG.GensparkEngine.isPointExhausted('5시간 제한에 도달했습니다. 재설정됩니다'), '시간 제한은 포인트 소진이 아니다');
  // 판정 함수가 비디오 전용을 쓰는지(이미지 판정을 그대로 쓰면 안 된다)
  ok(/_detectVideoLimit/.test(ENGSRC), '_detectVideoLimit 이 있다');
  ok(!/const lim0 = await this\._detectLimitMessage\(\)/.test(ENGSRC), '🔴 비디오 경로가 이미지 판정을 그대로 쓰지 않는다');
  ok((ENGSRC.match(/await this\._detectVideoLimit\(\)/g) || []).length === 2, '비디오 한도 검사 2곳(제출 전 · 폴링 중) 모두 전용 판정');
  ok(/한도로 보지 않습니다/.test(ENGSRC), '흘려보낸 경고는 로그로 남긴다(실제 소진 문구 확정 근거)');
  // main 이 포인트 소진을 시간 쿨다운과 다르게 다루는지
  ok(/isPointExhausted\(limitReached\)/.test(MAIN), 'main 이 포인트 소진을 구분한다');
  ok(/6 \* 60 \* 60 \* 1000/.test(MAIN), '포인트 소진이면 6시간 쉰다(기다려도 안 충전되므로)');
  ok(/기다려도 충전되지 않습니다/.test(MAIN), '무엇을 해야 하는지 알린다');
  ok(/LTX2\.5/.test(MAIN), '대안 엔진을 알려준다');
}

// ── [4-c] 🔴 참조 이미지를 안 받는 모델 — 만들지 않는다 ──
//   2026-09-03 실사고(로이): Gemini Omni Flash 로 만들었더니 원본이 웹툰 일러스트인데 **실사**가 나왔다.
//   첨부는 정상이었다(실측: data:image 0→1, 썸네일 붙음) — **그 모델이 참조 이미지를 받지 않는다.**
{
  ok(typeof ENG.gsVideoModelTakesImage === 'function', 'gsVideoModelTakesImage 를 export 한다');
  ok(ENG.gsVideoModelTakesImage('Gemini Omni Flash') === false, '🔴 Gemini Omni Flash = 참조 이미지 안 받음(실사고 모델)');
  ok(ENG.gsVideoModelTakesImage('MiniMax H3 Max') === true, 'MiniMax H3 Max = 받음');
  ok(ENG.gsVideoModelTakesImage('Seedance 2.5') === true, 'Seedance 2.5 = 받음');
  ok(ENG.gsVideoModelTakesImage('모델 자동 선택') === null, '자동 선택 = 알 수 없음');
  ok(ENG.gsVideoModelTakesImage('없는모델') === null, '목록에 없으면 알 수 없음');
  // 모든 항목이 imgRef 를 갖는가(빠뜨리면 조용히 통과한다)
  ok(M.every((x) => x.imgRef === true || x.imgRef === false || x.imgRef === null), '모든 모델에 imgRef 가 있다');
  ok(M.filter((x) => x.imgRef === true).length >= 12, '참조 가능 모델이 충분히 있다 (' + M.filter((x) => x.imgRef === true).length + '개)');
  // 엔진이 그 모델을 막는지 — **분기 자체**를 단언한다
  ok(ENGSRC.includes('if (takes === false) {'), '🔴 imgRef=false 면 만들지 않는 분기가 있다');
  ok(/modelNoImage: true/.test(ENGSRC), '호출부가 구분할 수 있게 표시한다');
  ok(/참조 이미지를 받지 않는 모델입니다/.test(ENGSRC), '사람 말로 알린다');
  ok(/설정 → 🌐 브라우저 이미지·비디오 에서/.test(ENGSRC), '무엇으로 바꾸면 되는지 알려준다');
  ok(ENGSRC.includes('if (takes === null)'), '알 수 없는 모델은 경고만 하고 진행한다');
  // 🔑 판정이 **첨부보다 먼저** 와야 한다(무의미한 첨부로 시간을 버리지 않게)
  const iChk = ENGSRC.indexOf('takes === false');
  const iAtt = ENGSRC.indexOf('await this._attachVideoSourceImage(imagePath)');
  ok(iChk > 0 && iAtt > 0 && iChk < iAtt, '🔴 모델 판정이 첨부보다 먼저다');
  // 기본값이 참조 가능한 모델인가
  ok(ROT.DEFAULTS.gensparkVideoModel === 'MiniMax H3 Max', '기본 모델을 참조 가능한 것으로 바꿨다');
  ok(ENG.gsVideoModelTakesImage(ROT.DEFAULTS.gensparkVideoModel) === true, '🔴 기본 모델은 참조 이미지를 받는다');
  // UI 경고
  ok(/참조 이미지를 받지 않습니다/.test(APP), '설정 UI 가 미지원 모델을 경고한다');
  ok(/imgRef: false/.test(APP), '렌더러 목록에 imgRef 가 있다');
  // 🔴 엔진 ↔ 렌더러의 imgRef 까지 같은지
  const rm = APP.match(/const GS_VIDEO_MODELS = \[([\s\S]*?)\n\];/);
  ok(!!rm, '렌더러 목록을 찾았다');
  if (rm) {
    const pairs = [...rm[1].matchAll(/name: '([^']+)'[^}]*imgRef: (true|false|null)/g)].map((x) => [x[1], x[2]]);
    ok(pairs.length === M.length, '렌더러도 imgRef 를 다 갖는다 (' + pairs.length + '/' + M.length + ')');
    const mismatch = pairs.filter((p) => {
      const eng = M.find((x) => x.name === p[0]);
      return eng && String(eng.imgRef) !== p[1];
    });
    ok(mismatch.length === 0, '🔴 엔진 ↔ 렌더러 imgRef 가 같다 — 다른 것: ' + mismatch.map((x) => x[0]).join(', '));
  }
}

// ── [5] 모델·등급 선택이 조용히 실패하지 않는지 ──
ok(/선택을 확인하지 못했습니다/.test(ENGSRC), '🔴 모델 선택 실패를 로그로 알린다(Flow v0.3.71 사고 재발 방지)');
ok(/txt\(el\) === name/.test(ENGSRC), '🔴 모델명을 **정확히 일치**로 찾는다 (MiniMax H3 ⊂ MiniMax H3 Max 오선택 방지)');
ok(/_selectVideoTier/.test(ENGSRC), '등급 선택 함수가 있다');

// ── [6] main.js 배선 ──
ok(/async function runGensparkVideos/.test(MAIN), 'runGensparkVideos 존재');
ok(/videoEngine === 'genspark'/.test(MAIN), '디스패치에 genspark 분기');
ok(/_runOnLanes\(\['gensparkBrowser'\], 'Genspark 비디오'/.test(MAIN), '🔴 비디오가 gensparkBrowser 레인을 잡는다');
ok(/_runOnLanes\(\['gensparkBrowser'\], 'Genspark 이미지'/.test(MAIN), '🔴 이미지도 같은 레인을 잡는다(같은 크롬이라 동시 조작 금지)');
ok(/gensparkBrowser: Promise\.resolve\(\)/.test(MAIN) && /gensparkBrowser: 0/.test(MAIN), '레인이 정의돼 있다');
ok(/imagePath && fs\.existsSync\(g\.imagePath\)/.test(MAIN), '이미지가 있는 그룹만 대상(i2v)');
ok(/videoPath && fs\.existsSync\(g\.videoPath\)\) return false/.test(MAIN), '이미 영상이 있으면 건너뛴다(이어받기)');
ok(/대상 그룹 없음/.test(MAIN), '대상이 0개면 조용히 넘어가지 않는다(v0.3.61 교훈)');
ok(/videoStatus === 'generating'\) g\.videoStatus = g\.videoPath \? 'done' : 'fail'/.test(MAIN), '스피너 고착 방지(v0.2.62 계열)');
ok(/GsAcc\.setCooldown/.test(MAIN) && /parseLimitResetTime/.test(MAIN), '한도 감지 시 계정 쿨다운을 기록한다');
ok(/cfg\.gensparkVideoModel \|\| Rot\.DEFAULTS\.gensparkVideoModel/.test(MAIN), '설정 저장소에서 모델을 읽는다(폴백 = DEFAULTS · 두 진실 금지)');
ok(!/gensparkVideoModel \|\| 'Gemini Omni Flash'/.test(MAIN), '옛 하드코딩 폴백(Omni Flash = 참조 이미지 안 받음)이 사라졌다');
ok(/gensparkVideoTier \|\| 'Standard'/.test(MAIN), '설정에서 등급을 읽는다');
// 파이프라인 — genspark 는 병렬에 넣지 않는다(브라우저 공유)
ok(!/grokVideoPipeline = [^\n]*genspark/.test(MAIN), 'genspark 는 Grok 파이프라인에 들어가지 않는다');
ok(!/comfyVideoPipeline[^\n]*genspark/.test(MAIN), 'genspark 는 Comfy 파이프라인에 들어가지 않는다');

// ── [7] 설정 저장소 ──
{
  // ⚠ `load()` 는 **사용자가 고른 값**을 준다(로이가 설정에서 바꾸면 그 값이다 — 그게 정상 동작이다).
  //   기본값 단언은 **DEFAULTS** 로 한다.
  // ⚠ 로이가 처음 지정한 Gemini Omni Flash 는 **참조 이미지를 받지 않아** 기본에서 뺐다(2026-09-03 실측).
  ok(ROT.DEFAULTS.gensparkVideoModel === 'MiniMax H3 Max', '기본 모델 = 참조 이미지를 받는 모델');
  ok(ROT.DEFAULTS.gensparkVideoTier === 'Standard', '기본 등급 = Standard');
  const c = ROT.load();
  ok(typeof c.gensparkVideoModel === 'string' && c.gensparkVideoModel, `설정에서 모델을 읽는다 (현재 ${c.gensparkVideoModel})`);
  ok(M.some((x) => x.name === c.gensparkVideoModel), '현재 설정된 모델이 목록에 있는 이름이다');
  ok(['Standard', 'Ultra'].includes(c.gensparkVideoTier), `등급이 유효하다 (현재 ${c.gensparkVideoTier})`);
}

// ── [8] UI — 드롭다운 2곳 + 설정 select ──
{
  // ⚠ 이미지 엔진 드롭다운에도 같은 문자열의 Genspark 항목이 **이미 2곳** 있다(v0.3.50).
  //   그래서 그냥 세면 4곳이 나온다 → **Flow·Veo 바로 뒤에 오는 것**(=비디오 드롭다운)만 센다.
  const cnt = (APP.match(/<option value="flow">Flow · Veo \(구독\)<\/option>\s*\n\s*<option value="genspark">Genspark \(구독\)<\/option>/g) || []).length;
  ok(cnt === 2, `🔴 비디오 드롭다운이 **두 곳**(헤더 + 채널편집)에 있다 — 실제 ${cnt}곳 (v0.3.76 교훈)`);
  const allGs = (APP.match(/<option value="genspark">Genspark \(구독\)<\/option>/g) || []).length;
  ok(allGs === 4, `이미지 2곳 + 비디오 2곳 = 4곳 (실제 ${allGs})`);
  ok(/gensparkVideoModel: e\.target\.value/.test(APP), '설정 select 가 gensparkVideoModel 을 저장한다');
  ok(/gensparkVideoTier: e\.target\.value/.test(APP), '설정 select 가 gensparkVideoTier 를 저장한다');
  ok(/GS_VIDEO_MODELS\.map/.test(APP), '모델 select 를 목록으로 렌더한다');
  ok(/720p 모델/.test(APP), '⚠ 720p 모델은 업스케일이 붙는다고 알린다');
  ok(/이미지 순환과 같은 크롬/.test(APP), '동시에 돌지 않는다는 것을 알린다');
}
// 정규화가 선택을 되돌리지 않는지 — v0.3.50 계열 사고
ok(!/\['wan', 'grok10', 'genspark'\]/.test(MAIN) && !/genspark'\]\.includes\(rawVe\)/.test(MAIN), '🔴 run-batch 정규화가 genspark 를 되돌리지 않는다');
ok(!/\['wan', 'grok10', 'genspark'\]/.test(APP), '🔴 렌더러 정규화도 genspark 를 되돌리지 않는다');

// ── [9] 소스 위생 ──
for (const pair of [['genspark-engine.js', ENGSRC], ['main.js', MAIN], ['App.jsx', APP]]) {
  ok((pair[1].match(/\r\n/g) || []).length === 0, pair[0] + ' 줄끝 LF');
  ok(pair[1].indexOf(String.fromCharCode(0)) < 0, pair[0] + ' NUL 없음');
}
// 미정의 식별자 — 이 저장소 단골 사고(imgEngine·onPickImgEngine)
for (const id of ['runGensparkVideos', '_dur', 'fmtClock', 'parseLimitResetTime', 'imgEngineReady']) {
  ok(new RegExp('(function|const|let)\\s+' + id + '\\b').test(MAIN), `main.js 에 ${id} 가 정의돼 있다`);
}
// 번들 반영 — 소스만 고치고 빌드를 잊으면 화면은 옛것이다
try {
  const dist = path.join(ROOT, 'renderer', 'dist', 'assets');
  const js = fs.readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dist, f), 'utf8')).join('');
  ok(/Genspark 비디오 모델/.test(js), '빌드된 번들에 새 설정 UI 가 들어있다(vite build 를 돌렸다)');
  ok(/Seedance 2\.5/.test(js), '번들에 모델 목록이 들어있다');
} catch (_) { ok(false, '번들을 읽을 수 없다'); }

// ── [10] 헤더 「③ 비디오」 옆 모델 select + 칩 판정 교정 (2026-09-05 · 아내 PC "설정한 모델로 안 만들어짐") ──
{
  // (a) 칩 판정 — 순수 함수 원문 실행. 옛 앞글자 비교의 오판 사례가 전부 false 여야 한다.
  ok(typeof ENG.gsModelChipMatches === 'function', '엔진이 gsModelChipMatches 를 export 한다');
  const M2 = ENG.gsModelChipMatches;
  ok(M2('MiniMax H3', 'MiniMax H3 Max') === false, '🔴 칩 「MiniMax H3」 ≠ 「MiniMax H3 Max」 (옛 slice(0,10) 은 같다고 봤다)');
  ok(M2('Seedance v2', 'Seedance 2.5') === false, '🔴 「Seedance v2」 ≠ 「Seedance 2.5」 (옛 slice(0,8) 은 같다고 봤다)');
  ok(M2('PixVerse C1', 'PixVerse V6') === false, '🔴 「PixVerse C1」 ≠ 「PixVerse V6」');
  ok(M2('MiniMax H3 Max', 'MiniMax H3 Max') === true, '정확 일치는 true');
  ok(M2('minimax  h3 max', 'MiniMax H3 Max') === true, '대소문자·연속 공백은 무시');
  ok(M2('MiniMax H3 M...', 'MiniMax H3 Max') === true, '말줄임으로 잘린 라벨은 접두 비교');
  ok(M2('MiniMax H3 M…', 'MiniMax H3 Max') === true, '유니코드 말줄임(…)도 잘린 라벨로 본다');
  ok(M2('Min...', 'MiniMax H3 Max') === false, '잘린 앞부분이 4자 미만이면 믿지 않는다');
  ok(M2('', 'MiniMax H3 Max') === false, '칩이 비면 false(모른다 → 다시 고른다)');
  // (b) _selectVideoModel 이 그 함수를 쓰고, 옛 앞글자 비교가 남아 있지 않다
  const sel = ENGSRC.slice(ENGSRC.indexOf('async _selectVideoModel('), ENGSRC.indexOf('async _selectVideoTier('));
  ok((sel.match(/gsModelChipMatches\(/g) || []).length >= 2, '「이미 선택됨」·「확인」 두 판정이 모두 gsModelChipMatches 를 쓴다');
  ok(!/slice\(0, 10\)/.test(sel) && !/slice\(0, 8\)/.test(sel), '🔴 옛 앞글자(slice) 비교가 사라졌다');
  ok(/이미 선택됨 · 칩 「/.test(sel), '「이미 선택됨」 로그에 실제 칩 라벨을 남긴다(다음 진단 근거)');
  // (c) main — 헤더 값이 저장소에 박히고, 4개 경로가 그 값을 받는다
  ok(/function applyHeaderGsVideoModel\(/.test(MAIN), 'applyHeaderGsVideoModel 헬퍼가 있다');
  ok(/Rot\.save\(\{ gensparkVideoModel: v \}\)/.test(MAIN), '헬퍼가 저장소에 박는다(헤더 = 저장값 = 만드는 값)');
  ok((MAIN.match(/applyHeaderGsVideoModel\(gensparkVideoModel\)/g) || []).length === 3, '🔴 video-build · video-group · runMakeAllCore 세 경로가 헤더 값을 적용한다');
  ok(/gensparkVideoModel: common\.gensparkVideoModel \|\| s\.gensparkVideoModel \|\| null/.test(MAIN), 'run-batch 는 헤더(공통) 우선 → 항목 폴백');
  for (const h of ['video-build', 'video-group']) {
    const i = MAIN.indexOf("ipcMain.handle('" + h + "'");
    ok(i > 0 && /gensparkVideoModel = null \} = args/.test(MAIN.slice(i, i + 800)), h + ' 이 인자로 gensparkVideoModel 을 받는다');
  }
  // (d) 렌더러 — 헤더 select · 부팅 로드 · IPC 전달
  const hdr = APP.slice(APP.indexOf('<span className="glabel">③ 비디오</span>'), APP.indexOf('<span className="glabel">③ 비디오</span>') + 4000);
  ok(/videoEngine === 'genspark' && \(\s*<select[^]*?gensparkVideoModel: e\.target\.value/.test(hdr), '🔴 헤더에 genspark 를 골랐을 때만 모델 select 가 뜨고 gensparkVideoModel 을 저장한다');
  ok(/GS_VIDEO_MODELS\.map\(\(m\) => <option key=\{m\.name\} value=\{m\.name\} title=\{m\.note\}/.test(hdr), '헤더 select 가 엔진과 같은 목록으로 렌더된다');
  ok(/const gsVideoModel = \(imgRot && imgRot\.gensparkVideoModel\) \|\| 'MiniMax H3 Max'/.test(APP), '헤더·설정이 같은 저장값(imgRot.gensparkVideoModel)을 쓴다');
  ok((APP.match(/api\.getImageRotation\(\)/g) || []).length >= 2, '🔴 부팅 때도 설정을 읽는다(예전엔 ⚙ 설정을 열 때만 읽어 헤더가 값을 몰랐다)');
  ok((APP.match(/gensparkVideoModel: gsVideoModel/g) || []).length === 6, '🔴 videoBuild×3 · videoGroup · makeAll · runBatch 여섯 곳이 헤더 모델을 실어 보낸다');
  ok(/fromNum: parseInt\(vidFrom, 10\) \|\| 1, toNum: parseInt\(vidTo, 10\) \|\| 1, engine: videoEngine, flowVideoModel, flowCount, gensparkVideoModel: gsVideoModel/.test(APP), 'videoBuild 호출에 모델이 들어간다');
  // (e) 번들 반영
  try {
    const dist = path.join(ROOT, 'renderer', 'dist', 'assets');
    const js = fs.readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dist, f), 'utf8')).join('');
    ok(/이 모델로 비디오를 만듭니다/.test(js), '빌드된 번들에 헤더 모델 select 가 들어있다');
  } catch (_) { ok(false, '번들을 읽을 수 없다'); }
}

console.log('\ngenspark-video: ' + (n - bad) + '/' + n + ' 통과');
if (bad) process.exit(1);
