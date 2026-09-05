'use strict';

/**
 * whiteboard-pipeline.test.js — 화이트보드 4단계 배관 검증 (2026-09-05).
 *   실행: npm run test:whiteboard (렌더 48 · 장면 62 뒤에 이어서 돈다)
 *
 * 렌더러(파이썬)는 **스텁**으로 갈아끼운다(`opts.deps`) — 이 테스트가 보는 것은 흐름·게이트·이어받기·배선이다.
 *   실제 파이썬 렌더는 whiteboard-render.test.js 가 왕복으로 본다.
 * 🔑 A/B 역검증(수동으로 실제 돌려 확인): ⓐ planScenes 의 noSplit 을 무시하게 하면 [1] 「분할 0」이 실패
 *   ⓑ main.js 4단계의 `if (wbGo)` 분기를 지우면 [8] 배선 단언이 실패.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WP = require('../core/whiteboard-pipeline');
const ANNreal = require('../core/whiteboard-annotation');
const WBreal = require('../core/whiteboard-render');
const WCfg = require('../core/whiteboard-config');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ❌ ' + m); } };
const head = (t) => console.log('\n' + t);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wbpipe-'));
const mkPng = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from('89504e470d0a1a0a', 'hex')); return p; };
const touchOld = (p, secAgo) => { const t = new Date(Date.now() - secAgo * 1000); fs.utimesSync(p, t, t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 픽스처 — 그룹 3개(100초·28초·3초). 100초는 「분할」 대상(45초 초과), 3초는 「병합」 대상(앞 28초와 합쳐 31 ≤ 35). ──
function mkProject(outRoot, opts = {}) {
  const media = path.join(outRoot, 'media-1');
  const mk = (num, d) => ({ num, text: `문장${num}`, ttsDurationSec: d, ttsAudioPath: path.join(outRoot, 'tts-1', `${num}.wav`) });
  const groups = [
    { num: 1, title: '도입', _s: [mk(1, 40), mk(2, 30), mk(3, 30)], imagePath: mkPng(path.join(media, '01.png')), imagePrompt: 'a' },
    { num: 2, title: '본론', _s: [mk(4, 7), mk(5, 7), mk(6, 7), mk(7, 7)], imagePath: mkPng(path.join(media, '02.png')), imagePrompt: 'b' },
    { num: 3, title: '짧은', _s: [mk(8, 3)], imagePath: opts.noImage3 ? null : mkPng(path.join(media, '03.png')), imagePrompt: 'c' },
  ];
  return { title: '테스트편', shortsNum: 1, groups, sentences: groups.flatMap((g) => g._s), getSentencesOfGroup: (g) => g._s };
}

// ── 스텁 deps — 파이썬 없이 흐름을 돈다. 호출 기록을 남긴다. ──
function mkDeps(calls, { failScene = null } = {}) {
  const WB = {
    hasEnv: () => true,
    ensureEnv: async () => { calls.ensureEnv++; return { ok: true, python: 'stub' }; },
    checkCanvas: () => ({ ok: true, w: 1344, h: 768, elements: 4 }),
    checkUniform: WBreal.checkUniform,
    renderScene: async ({ outputPath, imagePath, annotationPath }) => {
      calls.render.push(path.basename(outputPath));
      if (failScene && outputPath.includes(failScene)) return { ok: false, error: '스텁 실패' };
      fs.writeFileSync(outputPath, 'mp4');
      return { ok: true, output: outputPath, width: 1920, height: 1080, fps: 60 };
    },
    renderPreview: async ({ outputPath }) => { calls.preview.push(path.basename(outputPath)); fs.writeFileSync(outputPath, 'png'); return { ok: true, output: outputPath }; },
    mergeScenes: async ({ inputs, outputPath }) => { calls.merge.push(inputs.map((i) => path.basename(i))); fs.writeFileSync(outputPath, 'merged'); return { ok: true, output: outputPath }; },
  };
  const drafted = (count) => ({ canvas: { width: 1344, height: 768 },
    regions: Array.from({ length: count }, (_, i) => ({ region: { x: 100 * i, y: 50, width: 300, height: 400 }, direction: 'left_to_right' })) });
  const ANN = {
    annotationPathFor: ANNreal.annotationPathFor,
    buildAnnotation: ANNreal.buildAnnotation,
    writeAnnotation: async (scene, imagePath, { force }) => {
      const out = ANNreal.annotationPathFor(imagePath);
      if (fs.existsSync(out) && !force) return { ok: true, path: out, skipped: true };
      calls.draft++;
      fs.writeFileSync(out, JSON.stringify(ANNreal.buildAnnotation(scene, drafted(scene.elements.length)), null, 2));
      return { ok: true, path: out, skipped: false };
    },
  };
  return { WB: () => WB, ANN: () => ANN };
}
const freshCalls = () => ({ ensureEnv: 0, draft: 0, render: [], preview: [], merge: [] });

(async () => {
  // ── [1] 계획 — 장면 = 그룹(분할 0 · 짧은 것은 병합) · 예상 시간 · 무음 안내 ──
  head('[1] planWhiteboard');
  {
    const root = fs.mkdtempSync(path.join(TMP, 'p1-'));
    const pr = mkProject(root);
    const plan = WP.planWhiteboard(pr, { capLongEdge: 1920, concurrency: 1 });
    ok(plan.ok, '이미지가 다 있으면 ok');
    ok(plan.summary.split === 0, `🔴 100초 그룹도 분할하지 않는다(그룹 이미지 1장 = 장면 1개) — 분할 ${plan.summary.split}`);
    ok(plan.summary.merged === 1, `3초 그룹은 앞 장면에 병합된다 — 병합 ${plan.summary.merged}`);
    ok(plan.scenes.length === 2, `장면 2개(G1 · G2+G3) — 실제 ${plan.scenes.length}`);
    ok(plan.scenes[1].groupNums.join('+') === '2+3', '병합 장면의 groupNums 는 G2+G3');
    ok(WP.imageForScene(pr, plan.scenes[1]) === pr.groups[1].imagePath, '병합 장면은 첫 그룹의 이미지를 쓴다');
    ok(Math.abs(plan.totalSec - 131) < 0.01, `총 길이 = TTS 합 131초 (실제 ${plan.totalSec})`);
    ok(plan.lines.some((l) => /무음/.test(l)), '무음(5단계 전) 안내가 들어 있다');
    ok(plan.lines.some((l) => /렌더 약/.test(l)), '예상 렌더 시간 줄이 있다');
    ok(plan.lines.some((l) => /분할하지 않았습니다/.test(l)), '45초 초과 장면에 대해 「분할하지 않았다」고 알린다(noSplit 문구)');
    const e1920 = WP.estimateRenderSec(131, 1920, 1), e1080 = WP.estimateRenderSec(131, 1080, 1), e4 = WP.estimateRenderSec(131, 1920, 4);
    ok(e1080 < e1920 && e4 * 4 === e1920 || Math.abs(e4 * 4 - e1920) <= 4, `추정: 1080 < 1920 (${e1080} < ${e1920}) · 4병렬 ≈ 1/4 (${e4})`);
    // 이미지 누락
    const pr2 = mkProject(fs.mkdtempSync(path.join(TMP, 'p1b-')), { noImage3: true });
    const plan2 = WP.planWhiteboard(pr2, {});
    ok(plan2.ok, 'G3 는 G2 에 병합되므로 G2 이미지로 대체 — 누락 아님');
    fs.unlinkSync(pr2.groups[1].imagePath);
    const plan3 = WP.planWhiteboard(pr2, {});
    ok(!plan3.ok && plan3.missing.length === 1 && plan3.missing[0].groupNums.join('+') === '2+3', '이미지가 하나도 없는 장면은 missing 에 그룹 번호로 잡힌다');
  }

  // ── [2] 전 과정 — 관문 A → B → 렌더 → 병합 ──
  head('[2] runWhiteboard 전 과정');
  const root2 = fs.mkdtempSync(path.join(TMP, 'p2-'));
  const pr2 = mkProject(root2);
  {
    const calls = freshCalls(); const logs = [];
    let gateAPlan = null, gateBArg = null;
    const r = await WP.runWhiteboard(pr2, root2, {
      deps: mkDeps(calls), log: (l) => logs.push(l), baseName: '테스트편', capLongEdge: 1080, concurrency: 2,
      gateA: async (p) => { gateAPlan = p; return true; }, gateB: async (b) => { gateBArg = b; return true; },
    });
    ok(r.ok, `성공 — ${r.error || ''}`);
    ok(gateAPlan && gateAPlan.scenes.length === 2, '관문 A 에 계획이 넘어온다');
    ok(gateBArg && gateBArg.files.length === 2 && calls.preview.length === 2, '관문 B 전에 확인 그림을 장면 수만큼 만든다');
    ok(calls.ensureEnv === 1, '가상환경 준비 1회');
    ok(calls.draft === 2, '주석 2개 새로 만든다');
    ok(calls.render.length === 2 && calls.render.every((f) => /^scene-0[12]\.1080\.mp4$/.test(f)), `장면 파일명에 긴변이 들어간다(1080·1920 혼합 방지) — ${calls.render.join(',')}`);
    ok(calls.merge.length === 1 && calls.merge[0].join(',') === 'scene-01.1080.mp4,scene-02.1080.mp4', '순서대로 이어붙인다');
    ok(fs.existsSync(path.join(root2, '테스트편_whiteboard.mp4')), '결과 mp4 가 outRoot 에 생긴다');
    ok(r.rendered === 2 && r.skipped === 0, '새로 2 · 건너뜀 0');
    ok(fs.existsSync(path.join(root2, 'media-1', '01.annotation.json')), '주석은 그림 옆(media-1)에 같은 이름으로');
    ok(logs.some((l) => /무음/.test(l)), '완료 로그에도 무음이라고 적는다');
  }

  // ── [3] 이어받기 — 두 번째 실행은 렌더 0 · 주석 유지 ──
  head('[3] 이어받기');
  {
    const calls = freshCalls();
    const r = await WP.runWhiteboard(pr2, root2, { deps: mkDeps(calls), log: () => {}, baseName: '테스트편', capLongEdge: 1080, concurrency: 2 });
    ok(r.ok && r.rendered === 0 && r.skipped === 2, `이미 있는 장면은 건너뛴다(새로 ${r.rendered} · 건너뜀 ${r.skipped})`);
    ok(calls.draft === 0, '주석도 다시 만들지 않는다');
    ok(calls.merge.length === 1, '그래도 병합은 한다(결과물을 다시 낸다)');
    ok(calls.preview.length === 0, '관문 B 가 없으면(큐) 확인 그림을 만들지 않는다');
    // 긴변을 바꾸면 다른 파일이라 다시 렌더한다
    const calls2 = freshCalls();
    const r2 = await WP.runWhiteboard(pr2, root2, { deps: mkDeps(calls2), log: () => {}, baseName: '테스트편', capLongEdge: 1920, concurrency: 1 });
    ok(r2.ok && r2.rendered === 2, '긴변이 다르면(1920) 새 파일이라 다시 렌더한다');
    // force
    const calls3 = freshCalls();
    const r3 = await WP.runWhiteboard(pr2, root2, { deps: mkDeps(calls3), log: () => {}, baseName: '테스트편', capLongEdge: 1920, concurrency: 1, force: true });
    ok(r3.ok && r3.rendered === 2 && calls3.render.length === 2, 'force 면 있어도 다시 렌더한다');
  }

  // ── [4] 주석 타이밍 갱신 — TTS 가 바뀌면 영역은 두고 시간만 ──
  head('[4] 주석 타이밍 갱신(영역 보존)');
  {
    const annPath = path.join(root2, 'media-1', '01.annotation.json');
    const before = JSON.parse(fs.readFileSync(annPath, 'utf8'));
    before.elements[0].region.x = 777;   // 사람이 고친 영역을 흉내
    fs.writeFileSync(annPath, JSON.stringify(before, null, 2));
    pr2.groups[0]._s[0].ttsDurationSec = 44;   // TTS 재합성으로 길이가 바뀜(100→104초)
    await sleep(30);
    const calls = freshCalls(); const logs = [];
    const r = await WP.runWhiteboard(pr2, root2, { deps: mkDeps(calls), log: (l) => logs.push(l), baseName: '테스트편', capLongEdge: 1920, concurrency: 1 });
    const after = JSON.parse(fs.readFileSync(annPath, 'utf8'));
    ok(r.ok, '성공');
    ok(after.sceneDurationMs === 104000, `장면 길이가 새 TTS 합(104초)으로 갱신 — ${after.sceneDurationMs}`);
    ok(after.elements[0].region.x === 777, '🔴 사람이 고친 영역은 그대로 남는다');
    ok(calls.draft === 0, '영역 초안을 다시 뽑지 않는다');
    ok(logs.some((l) => /타이밍 갱신/.test(l)), '갱신했다고 로그에 남긴다');
    ok(calls.render.includes('scene-01.1920.mp4') && !calls.render.includes('scene-02.1920.mp4'), `주석이 바뀐 장면만 다시 렌더한다 — ${calls.render.join(',')}`);
    ok(WP.annotationStale({ _priming: { sentenceNums: [1, 2] }, sceneDurationMs: 1000 }, { sentenceNums: [1, 2], durationMs: 1030 }) === false, '50ms 안 차이는 낡은 것이 아니다');
    ok(WP.annotationStale({ _priming: { sentenceNums: [1, 2] }, sceneDurationMs: 1000 }, { sentenceNums: [1, 2, 3], durationMs: 1000 }) === true, '문장 구성이 다르면 낡은 것');
  }

  // ── [5] 관문에서 취소 · 중단 · 누락 · 렌더 실패 ──
  head('[5] 취소·중단·실패');
  {
    const root = fs.mkdtempSync(path.join(TMP, 'p5-'));
    const pr = mkProject(root);
    let calls = freshCalls();
    let r = await WP.runWhiteboard(pr, root, { deps: mkDeps(calls), log: () => {}, gateA: async () => false });
    ok(!r.ok && r.cancelled && r.at === 'A' && calls.ensureEnv === 0 && calls.render.length === 0, '관문 A 취소 — 아무것도 안 만든다(가상환경도 안 부른다)');
    calls = freshCalls();
    r = await WP.runWhiteboard(pr, root, { deps: mkDeps(calls), log: () => {}, gateA: async () => true, gateB: async () => false });
    ok(!r.ok && r.cancelled && r.at === 'B' && calls.render.length === 0 && calls.preview.length === 2, '관문 B 취소 — 확인 그림은 만들었지만 렌더는 0');
    // 중단 — 첫 장면 뒤 멈춤
    calls = freshCalls(); let aborted = false;
    const deps = mkDeps(calls); const WBs = deps.WB();
    const origRender = WBs.renderScene;
    WBs.renderScene = async (o) => { const x = await origRender(o); aborted = true; return x; };
    r = await WP.runWhiteboard(pr, root, { deps, log: () => {}, isAborted: () => aborted, concurrency: 1 });
    ok(!r.ok && r.cancelled && r.at === 'render' && calls.render.length === 1 && calls.merge.length === 0, `중단 — 다음 장면을 시작하지 않고 병합도 안 한다(렌더 ${calls.render.length})`);
    // 이미지 누락
    const prm = mkProject(fs.mkdtempSync(path.join(TMP, 'p5m-')), { noImage3: true });
    fs.unlinkSync(prm.groups[1].imagePath);
    calls = freshCalls();
    r = await WP.runWhiteboard(prm, path.dirname(prm.groups[0].imagePath), { deps: mkDeps(calls), log: () => {} });
    ok(!r.ok && r.missing && /G2\+3/.test(r.error) && calls.ensureEnv === 0, '이미지 없는 장면이 있으면 시작하지 않고 그룹 번호를 알린다');
    // 렌더 실패
    const rootf = fs.mkdtempSync(path.join(TMP, 'p5f-'));
    const prf = mkProject(rootf);
    calls = freshCalls();
    r = await WP.runWhiteboard(prf, rootf, { deps: mkDeps(calls, { failScene: 'scene-02' }), log: () => {}, concurrency: 1 });
    ok(!r.ok && /장면 1개 렌더 실패 \(02\)/.test(r.error) && calls.merge.length === 0, `실패한 장면 번호를 알리고 병합하지 않는다 — ${r.error}`);
    ok(!fs.existsSync(path.join(rootf, '테스트편_whiteboard.mp4')), '실패 시 결과 mp4 를 남기지 않는다');
  }

  // ── [6] 설정 저장소 ──
  head('[6] whiteboard-config');
  {
    ok(WCfg.DEFAULTS.capLongEdge === 1920 && WCfg.CAP_CHOICES.includes(640), '기본 1920 · 선택지에 640(시험)');
    ok(WCfg.effectiveConcurrency({ concurrency: 0 }) >= 1 && WCfg.effectiveConcurrency({ concurrency: 0 }) <= 4, '자동 동시 개수는 1~4');
    ok(WCfg.effectiveConcurrency({ concurrency: 3 }) === 3, '지정하면 그 값');
    // 격리 HOME 에서 save/load 왕복
    const saveHome = process.env.USERPROFILE, saveH = process.env.HOME;
    const home = fs.mkdtempSync(path.join(TMP, 'home-'));
    process.env.USERPROFILE = home; process.env.HOME = home;
    delete require.cache[require.resolve('../core/whiteboard-config')];
    const C2 = require('../core/whiteboard-config');
    ok(C2.CONFIG_PATH.startsWith(home), '격리 HOME 을 쓴다(실제 설정 무변경)');
    ok(C2.load().capLongEdge === 1920, '파일이 없으면 기본값');
    ok(C2.save({ capLongEdge: 1080 }).capLongEdge === 1080 && C2.load().capLongEdge === 1080, '저장·재로드');
    ok(C2.save({ capLongEdge: 999 }).capLongEdge === 1080, '허용 안 되는 긴변은 무시(기존 값 유지)');
    ok(C2.save({ concurrency: 3 }).concurrency === 3 && C2.load().capLongEdge === 1080, '병합 저장(다른 키 유지)');
    process.env.USERPROFILE = saveHome; process.env.HOME = saveH;
    delete require.cache[require.resolve('../core/whiteboard-config')];
  }

  // ── [7] whiteboard-scenes 의 noSplit ──
  head('[7] planScenes noSplit');
  {
    const SC = require('../core/whiteboard-scenes');
    const g = { num: 1, _s: [{ num: 1, text: 'a', ttsDurationSec: 60 }, { num: 2, text: 'b', ttsDurationSec: 60 }] };
    const pr = { groups: [g], getSentencesOfGroup: (x) => x._s };
    ok(SC.planScenes(pr, {}).scenes.length > 1, '기본은 120초 그룹을 쪼갠다(2단계 동작 유지)');
    ok(SC.planScenes(pr, { noSplit: true }).scenes.length === 1, 'noSplit 이면 쪼개지 않는다');
  }

  // ── [8] 배선 — main · preload · App · 번들 ──
  head('[8] 배선');
  {
    const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8').replace(/\r\n/g, '\n');
    const PRE = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
    const APP = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'App.jsx'), 'utf8');
    ok(/whiteboard: Promise\.resolve\(\) \}/.test(MAIN) && /whiteboard: 0 \}/.test(MAIN), '🔴 whiteboard 레인이 정의돼 있다');
    ok(/_runOnLanes\(\['whiteboard'\]/.test(MAIN), '렌더는 whiteboard 레인을 잡는다');
    ok(!/_runOnLanes\(\['whiteboard', 'localGpu'\]/.test(MAIN) && !/_runOnLanes\(\['localGpu', 'whiteboard'\]/.test(MAIN), '🔴 localGpu 레인은 잡지 않는다(CPU 작업 · make-all 이 그 레인을 쥔 채 부르면 교착)');
    ok(/async function runWhiteboardFor\(/.test(MAIN), 'runWhiteboardFor 헬퍼');
    ok(/function normOutTarget\(/.test(MAIN) && /const outTarget = normOutTarget\(opts\.outTarget\)/.test(MAIN), 'runMakeAllCore 가 outTarget 을 받는다');
    ok(/if \(wbGo\) \{[\s\S]{0,400}runWhiteboardFor\(pr, outRoot, \{ interactive: false \}\)/.test(MAIN), '🔴 4단계에서 화이트보드로 갈라진다(큐 = 관문 없이)');
    // 게이트 뒤에 분기가 온다 — 게이트(음성·이미지 누락)를 .vrew 와 똑같이 지나야 한다
    const i4 = MAIN.indexOf('📦 4단계'), iGate = MAIN.indexOf('const mtts4 = gateTts(outMode)', i4), iWb = MAIN.indexOf('if (wbGo) {', i4);
    ok(i4 > 0 && iGate > 0 && iWb > iGate, '화이트보드 분기는 음성·이미지 게이트 **뒤**에 있다');
    ok(/outTarget: \(common\.outTarget != null \? common\.outTarget : \(s\.outTarget \|\| 'vrew'\)\)/.test(MAIN), 'run-batch 는 헤더(공통) 우선');
    for (const h of ['whiteboard-plan', 'whiteboard-build', 'get-whiteboard-config', 'set-whiteboard-config']) ok(MAIN.includes(`ipcMain.handle('${h}'`), `IPC ${h}`);
    ok(/missingVisualGroups\(pr\)[\s\S]{0,300}missingTtsNums\(pr\)[\s\S]{0,600}runWhiteboardFor\(pr, S\.outRoot, \{ interactive: true/.test(MAIN), '✏ 렌더 버튼 경로도 두 게이트를 지난 뒤 대화형으로 부른다');
    ok(/interactive \? _wbGateA : null/.test(MAIN) && /interactive \? _wbGateB : null/.test(MAIN), '관문 A/B 는 대화형일 때만');
    for (const a of ['whiteboardPlan', 'whiteboardBuild', 'getWhiteboardConfig', 'setWhiteboardConfig']) ok(PRE.includes(a + ':'), `preload ${a}`);
    const optCnt = (APP.match(/<option value="whiteboard">✏ 화이트보드 MP4<\/option>/g) || []).length;
    ok(optCnt === 2, `🔴 출력 select 가 **두 곳**(헤더 + 채널편집) — 실제 ${optCnt} (v0.3.76 교훈)`);
    ok(APP.includes('<span className="glabel">④ 출력</span>') && APP.includes('<span className="glabel">⑤ 완성</span>') && !APP.includes('④ 완성'), '헤더 번호 — ④ 출력 · ⑤ 완성');
    ok(/aiNotice, outMode, outTarget \}/.test(APP), 'currentSettings 에 outTarget');
    ok(/if \(s\.outTarget != null\) setOutTarget/.test(APP), 'applySettings 가 outTarget 을 복원');
    ok(/outTarget, \/\/ \.vrew \/ ✏ 화이트보드 MP4/.test(APP), 'makeAll 인자에 outTarget');
    ok(/outTarget, aiNotice, outMode \}, openEach: openEachVrew/.test(APP), 'runBatch common 에 outTarget(순서는 vrew-audio 의 `aiNotice, outMode }` 단언을 지킨다)');
    ok(/if \(p\.outTarget != null\) setOutTarget/.test(APP), '채널 기본값 → 헤더');
    ok(/outTarget: p\.outTarget === 'whiteboard'/.test(APP) && /outTarget: ch\.outTarget === 'whiteboard'/.test(APP), '채널편집 열기·저장에 outTarget(저장 시 빈 값으로 덮이지 않게)');
    ok(/api\.getWhiteboardConfig\(\)\.then/.test(APP), '부팅 때 설정을 읽는다');
    ok(!/setBusy|\bbusy\b/.test(APP.slice(APP.indexOf('async function runWhiteboardBuild'), APP.indexOf('async function runWhiteboardBuild') + 600)), '존재하지 않는 busy 상태를 참조하지 않는다(미정의 식별자)');
    // 미정의 식별자 — 이 저장소 단골
    for (const id of ['runWhiteboardFor', 'normOutTarget', '_wbGateA', '_wbGateB', 'vrewBaseName', 'missingVisualGroups', 'missingTtsNums', 'warnIncompleteVisuals', 'warnMissingTts', 'pushDtoUpdate']) {
      ok(new RegExp('(function|const|let)\\s+' + id + '\\b').test(MAIN), `main.js 에 ${id} 정의`);
    }
    try {
      const dist = path.join(ROOT, 'renderer', 'dist', 'assets');
      const js = fs.readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dist, f), 'utf8')).join('');
      ok(/화이트보드 MP4/.test(js) && /장면 계획/.test(js), '번들에 헤더 ④ 출력 UI 가 들어 있다(vite build 를 돌렸다)');
    } catch (_) { ok(false, '번들을 읽을 수 없다'); }
    for (const f of ['core/whiteboard-pipeline.js', 'core/whiteboard-config.js', 'main.js', 'renderer/src/App.jsx']) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      ok(s.indexOf(String.fromCharCode(0)) < 0 && !/[\x01-\x08\x0b\x0c\x0e-\x1f]/.test(s), f + ' 제어문자 없음');
    }
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log(`\nwhiteboard-pipeline: ${n - bad}/${n} 통과`);
  if (bad) process.exit(1);
})().catch((e) => { console.error('💥', e); process.exit(1); });
