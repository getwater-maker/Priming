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
const WSreal = require('../core/whiteboard-subtitle');

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
  const mk = (num, d) => {
    const w = path.join(outRoot, 'tts-1', `${num}.wav`);
    if (!opts.noTts) { fs.mkdirSync(path.dirname(w), { recursive: true }); fs.writeFileSync(w, 'wav'); }
    return { num, text: `문장${num}`, ttsDurationSec: d, ttsAudioPath: w };
  };
  const groups = [
    { num: 1, title: '도입', _s: [mk(1, 40), mk(2, 30), mk(3, 30)], imagePath: mkPng(path.join(media, '01.png')), imagePrompt: 'a' },
    { num: 2, title: '본론', _s: [mk(4, 7), mk(5, 7), mk(6, 7), mk(7, 7)], imagePath: mkPng(path.join(media, '02.png')), imagePrompt: 'b' },
    { num: 3, title: '짧은', _s: [mk(8, 3)], imagePath: opts.noImage3 ? null : mkPng(path.join(media, '03.png')), imagePrompt: 'c' },
  ];
  return { title: '테스트편', shortsNum: 1, groups, sentences: groups.flatMap((g) => g._s), getSentencesOfGroup: (g) => g._s };
}

// ── 스텁 deps — 파이썬 없이 흐름을 돈다. 호출 기록을 남긴다. ──
function mkDeps(calls, { failScene = null, failAudio = false, failBurn = false } = {}) {
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
    imageSig: ANNreal.imageSig,
    findStarved: ANNreal.findStarved,   // ⚠ 스텁에 안 실으면 파이프라인의 자동 보정이 통째로 건너뛴다
    writeAnnotation: async (scene, imagePath, { force }) => {
      const out = ANNreal.annotationPathFor(imagePath);
      if (fs.existsSync(out) && !force) return { ok: true, path: out, skipped: true };
      calls.draft++;
      // ⚠ 실제 모듈처럼 **그림 지문**을 함께 적는다 — 안 적으면 다음 실행이 매번 「그림이 바뀌었다」로 본다.
      fs.writeFileSync(out, JSON.stringify(ANNreal.buildAnnotation(scene, drafted(scene.elements.length), { imageSig: ANNreal.imageSig(imagePath) }), null, 2));
      return { ok: true, path: out, skipped: false };
    },
  };
  // 🔊 음성 얹기(5단계) 스텁 — 실제 ffmpeg 는 별도 테스트(whiteboard-audio.test.js)가 돌린다.
  const WA = {
    attachAudio: async ({ videoPath, scenes }) => {
      calls.audio.push(scenes.map((sc) => sc.audios.map((a) => path.basename(a)).join('+')));
      if (failAudio) return { ok: false, error: '스텁 음성 실패' };
      fs.writeFileSync(videoPath, 'merged+audio');
      return { ok: true, output: videoPath, durationSec: 131 };
    },
  };
  // 💬 자막(5단계 나머지 절반) 스텁 — buildSrt·scenesForSubtitle 은 **실제 모듈을 그대로 쓰고**
  //   굽기(ffmpeg)만 기록으로 대신한다. 스텁을 안 넣으면 이 테스트가 진짜 ffmpeg 를 돌린다.
  const WS = {
    buildCues: WSreal.buildCues,
    srtFromCues: WSreal.srtFromCues,
    scenesForSubtitle: WSreal.scenesForSubtitle,
    burnSubtitle: async ({ videoPath, cues, height, width, style }) => {
      calls.subtitle.push({ video: path.basename(videoPath), lines: (cues || []).length, height, width, style });
      if (failBurn) return { ok: false, error: '스텁 굽기 실패' };
      fs.writeFileSync(videoPath, 'merged+audio+sub');
      return { ok: true, output: videoPath };
    },
  };
  return { WB: () => WB, ANN: () => ANN, WA: () => WA, WS: () => WS };
}
const freshCalls = () => ({ ensureEnv: 0, draft: 0, render: [], preview: [], merge: [], audio: [], subtitle: [] });

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
    ok(plan.lines.some((l) => /음성·자막이 얹힙니다/.test(l)), '음성·자막이 얹힌다는 안내가 들어 있다(5단계 완료)');
    ok(!plan.lines.some((l) => /무음/.test(l)), '옛 「무음」 안내가 남아 있지 않다');
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
    ok(logs.some((l) => /🔊 음성 포함/.test(l)), '완료 로그에 「음성 포함」이라고 적는다');
    ok(r.hasAudio === true, '반환값 hasAudio=true');
    // 🔑 장면 → 문장 매핑: G1(문장1·2·3) · G2+G3(문장4~8)
    ok(calls.audio.length === 1 && calls.audio[0].length === 2, `음성 얹기 1회 · 장면 2개 — ${JSON.stringify(calls.audio)}`);
    ok(calls.audio[0][0] === '1.wav+2.wav+3.wav', `장면1 음성 = 그 장면 문장들 순서대로 — ${calls.audio[0][0]}`);
    ok(calls.audio[0][1] === '4.wav+5.wav+6.wav+7.wav+8.wav', `병합 장면 음성도 문장 순서대로 — ${calls.audio[0][1]}`);
    // 💬 자막도 같은 실행에서 함께 나간다
    ok(fs.existsSync(path.join(root2, '테스트편_whiteboard_유튜브자막.srt')), '🔑 .srt 는 **영상과 다른 이름**으로 남는다 — 같은 이름이면 플레이어가 자동으로 띄워 자막이 두 줄로 겹친다');
    ok(calls.subtitle.length === 1 && r.hasSubtitle === true, '자막을 굽는다(기본 켬)');
    ok(logs.some((l) => /💬 자막 포함/.test(l)), '완료 로그 꼬리에 「자막 포함」');
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
    ok(/if \(wbGo\) \{[\s\S]{0,500}runWhiteboardFor\(pr, outRoot, \{ preset, captionMaxChars \}\)/.test(MAIN), '🔴 4단계에서 화이트보드로 갈라진다(채널 설정·자막 글자수를 함께 넘긴다)');
    // 게이트 뒤에 분기가 온다 — 게이트(음성·이미지 누락)를 .vrew 와 똑같이 지나야 한다
    const i4 = MAIN.indexOf('📦 4단계'), iGate = MAIN.indexOf('const mtts4 = gateTts(outMode)', i4), iWb = MAIN.indexOf('if (wbGo) {', i4);
    ok(i4 > 0 && iGate > 0 && iWb > iGate, '화이트보드 분기는 음성·이미지 게이트 **뒤**에 있다');
    ok(/outTarget: \(common\.outTarget != null \? common\.outTarget : \(s\.outTarget \|\| 'vrew'\)\)/.test(MAIN), 'run-batch 는 헤더(공통) 우선');
    for (const h of ['whiteboard-plan', 'whiteboard-build', 'get-whiteboard-config', 'set-whiteboard-config']) ok(MAIN.includes(`ipcMain.handle('${h}'`), `IPC ${h}`);
    // 🔑 ✏ 렌더는 **runMakeAllCore 에 위임**한다(2026-09-16) — 음성 → 이미지 → 렌더 전 과정.
    //   예전엔 렌더만 해서 자산이 없으면 「이미지 미생성」 팝업만 뜨고 아무것도 안 만들어졌다(로이 신고).
    //   ⚠ 1~3단계를 여기에 복제하지 않는다 — 순서·게이트·이상 이미지 재생성·절전 차단이 이미 거기 있다.
    ok(/ipcMain\.handle\('whiteboard-build'[\s\S]{0,400}runMakeAllCore\(\{ \.\.\.args, outTarget: 'whiteboard', outMode: 'full'/.test(MAIN),
      '🔴 ✏ 렌더는 runMakeAllCore 에 위임한다(음성·이미지까지 만든다)');
    ok(/ipcMain\.handle\('whiteboard-build'[\s\S]{0,120}enqueueTtsJob\(/.test(MAIN),
      '🔴 TTS 를 돌리므로 직렬 큐(enqueueTtsJob)를 탄다 — 동시에 돌면 provider 가 깨진다(v0.2.57 사고)');
    ok(!/wbInteractive/.test(MAIN), '🔑 관문(확인 팝업)은 폐기 — wbInteractive 잔재가 없다(로이 2026-09-16)');
    ok(/const _wbTarget = \(outTarget === 'whiteboard'\)/.test(MAIN) && /videoPipeline = _pipeBase && !_wbTarget/.test(MAIN),
      '🔑 화이트보드는 그룹 이미지만 쓰므로 비디오 단계를 건너뛴다(시간·크레딧 절약)');
    ok(!/_wbGateA|_wbGateB/.test(MAIN), '관문 A/B 함수도 없다 — 누르면 바로 만든다');
    for (const a of ['whiteboardPlan', 'whiteboardBuild', 'getWhiteboardConfig', 'setWhiteboardConfig']) ok(PRE.includes(a + ':'), `preload ${a}`);
    const optCnt = (APP.match(/<option value="whiteboard">✏ 화이트보드 MP4<\/option>/g) || []).length;
    ok(optCnt === 2, `🔴 출력 select 가 **두 곳**(헤더 + 채널편집) — 실제 ${optCnt} (v0.3.76 교훈)`);
    // ⚠ v0.5.7 에서 「④ 출력」과 「⑤ 완성」을 **한 그룹으로 합쳤다**(출력 select 다음에 .hdiv).
    //   그 뒤 이 단언을 안 고쳐 v0.5.7~v0.5.9 내내 깨져 있었다 — 라벨을 바꾸면 그 라벨로 찾는 테스트를 함께 본다.
    ok(APP.includes('<span className="glabel">④ 완성</span>') && !APP.includes('<span className="glabel">⑤'), '헤더 번호 — ④ 완성 하나(출력+완성 통합)');
    ok(/aiNotice, outMode, outTarget \}/.test(APP), 'currentSettings 에 outTarget');
    ok(/if \(s\.outTarget != null\) setOutTarget/.test(APP), 'applySettings 가 outTarget 을 복원');
    ok(/outTarget, \/\/ \.vrew \/ ✏ 화이트보드 MP4/.test(APP), 'makeAll 인자에 outTarget');
    ok(/outTarget, aiNotice, outMode: effOutMode\(\) \}, openEach: openEachVrew/.test(APP), 'runBatch common 에 outTarget');
    ok(!/runWhiteboardBuild|✏ 렌더<\/button>/.test(APP), '✏ 렌더 버튼 없음 — ⚡ 만들기로 통일(2026-09-24)');
    ok(/const outMode = outTarget === 'whiteboard' \? 'full' : normOutMode\(opts\.outMode\)/.test(MAIN), '🔑 화이트보드는 서버에서도 늘 전체(옛 ✏ 렌더의 강제를 옮김)');
    ok(/function needVideoPrompts\(\) \{ return \(outTarget === 'whiteboard'/.test(APP), '화이트보드는 비디오 프롬프트를 요구하지 않는다');
    ok(/if \(p\.outTarget != null\) setOutTarget/.test(APP), '채널 기본값 → 헤더');
    ok(/outTarget: normOutTargetUi\(p\.outTarget\)/.test(APP) && /outTarget: normOutTargetUi\(ch\.outTarget\)/.test(APP), '채널편집 열기·저장에 outTarget(저장 시 빈 값으로 덮이지 않게 · 🎬 mp4 도 보존)');
    ok(/api\.getWhiteboardConfig\(\)\.then/.test(APP), '부팅 때 설정을 읽는다');
    // 미정의 식별자 — 이 저장소 단골
    for (const id of ['runWhiteboardFor', 'normOutTarget', 'vrewBaseName', 'missingVisualGroups', 'missingTtsNums', 'warnIncompleteVisuals', 'warnMissingTts', 'pushDtoUpdate']) {
      ok(new RegExp('(function|const|let)\\s+' + id + '\\b').test(MAIN), `main.js 에 ${id} 정의`);
    }
    try {
      const dist = path.join(ROOT, 'renderer', 'dist', 'assets');
      const js = fs.readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dist, f), 'utf8')).join('');
      ok(/화이트보드 MP4/.test(js) && /장면 계획/.test(js), '번들에 헤더 ④ 출력 UI 가 들어 있다(vite build 를 돌렸다)');
    } catch (_) { ok(false, '번들을 읽을 수 없다'); }
    for (const f of ['core/whiteboard-pipeline.js', 'core/whiteboard-audio.js', 'core/whiteboard-config.js', 'main.js', 'renderer/src/App.jsx']) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      ok(s.indexOf(String.fromCharCode(0)) < 0 && !/[\x01-\x08\x0b\x0c\x0e-\x1f]/.test(s), f + ' 제어문자 없음');
    }
  }

  // ── [🔊] 음성 얹기 — 실패해도 렌더 결과를 버리지 않는다 ──
  head('[🔊] 음성 얹기(5단계)');
  {
    // ⓐ attachAudio 가 실패 → 경고만 하고 무음 MP4 는 남는다
    const rootA = fs.mkdtempSync(path.join(TMP, 'au-'));
    const prA = mkProject(rootA);
    const callsA = freshCalls(); const logsA = [];
    const rA = await WP.runWhiteboard(prA, rootA, { deps: mkDeps(callsA, { failAudio: true }), log: (l) => logsA.push(l), baseName: '음성실패', concurrency: 1 });
    ok(rA.ok, '음성 얹기가 실패해도 전체는 성공으로 끝난다(30분 렌더를 버리지 않는다)');
    ok(rA.hasAudio === false && /스텁 음성 실패/.test(rA.audioError || ''), '반환값에 실패 사유가 남는다');
    ok(fs.existsSync(path.join(rootA, '음성실패_whiteboard.mp4')), '무음 MP4 는 그대로 남는다');
    ok(logsA.some((l) => /음성 얹기 실패/.test(l)) && logsA.some((l) => /⚠ 무음/.test(l)), '로그가 무음이라고 알린다');

    // ⓑ TTS 파일이 아예 없으면 ffmpeg 를 부르지 않고 안내한다
    const rootB = fs.mkdtempSync(path.join(TMP, 'au2-'));
    const prB = mkProject(rootB, { noTts: true });
    const callsB = freshCalls(); const logsB = [];
    const rB = await WP.runWhiteboard(prB, rootB, { deps: mkDeps(callsB), log: (l) => logsB.push(l), baseName: '음성없음', concurrency: 1 });
    ok(rB.ok && rB.hasAudio === false, '음성 파일이 없어도 렌더는 완료된다');
    ok(callsB.audio.length === 0, '음성 파일이 없으면 얹기를 시도조차 하지 않는다(헛 ffmpeg 호출 0)');
    ok(logsB.some((l) => /🎤 TTS/.test(l)), '무엇을 하면 되는지(🎤 TTS) 알려 준다');

    // ⓒ withAudio:false 면 건너뛴다
    const rootC = fs.mkdtempSync(path.join(TMP, 'au3-'));
    const prC = mkProject(rootC);
    const callsC = freshCalls();
    const rC = await WP.runWhiteboard(prC, rootC, { deps: mkDeps(callsC), log: () => {}, baseName: '음성끔', concurrency: 1, withAudio: false });
    ok(rC.ok && callsC.audio.length === 0, 'withAudio:false 면 음성을 얹지 않는다');

    // ⓓ sentenceAudioMap — 파일이 실제로 있는 것만
    const m = WP.sentenceAudioMap(prA);
    ok(m.size === 8, `문장 8개의 음성 경로를 찾는다 — ${m.size}`);
    fs.unlinkSync(prA.groups[0]._s[0].ttsAudioPath);
    ok(WP.sentenceAudioMap(prA).size === 7, '파일이 사라지면 그 문장은 빠진다(경로만 있고 없는 것은 안 센다)');
  }

  // ── [💬] 자막 — .srt 는 언제나 · 굽기는 스위치 · 실패해도 영상은 남는다 ──
  head('[💬] 자막(5단계 나머지 절반)');
  {
    // ⓐ 굽기를 끄면 .srt 만 남는다
    const rootA = fs.mkdtempSync(path.join(TMP, 'sub-'));
    const prA = mkProject(rootA);
    const callsA = freshCalls(); const logsA = [];
    const rA = await WP.runWhiteboard(prA, rootA, { deps: mkDeps(callsA), log: (l) => logsA.push(l), baseName: '굽기끔', concurrency: 1, burnSubtitle: false });
    ok(rA.ok && callsA.subtitle.length === 0, '굽기를 끄면 ffmpeg 를 부르지 않는다');
    ok(fs.existsSync(path.join(rootA, '굽기끔_whiteboard.srt')), '그래도 .srt 는 남는다(유튜브 업로드용)');
    ok(rA.srtPath && rA.hasSubtitle === false, '반환값 — srtPath 는 있고 hasSubtitle 은 false');
    ok(logsA.some((l) => /📄 \.srt 별도/.test(l)) || logsA.some((l) => /📄 자막 파일/.test(l)), '로그가 .srt 를 알린다');

    // ⓑ 굽기가 실패해도 영상은 그대로 남는다
    const rootB = fs.mkdtempSync(path.join(TMP, 'sub2-'));
    const prB = mkProject(rootB);
    const callsB = freshCalls(); const logsB = [];
    const rB = await WP.runWhiteboard(prB, rootB, { deps: mkDeps(callsB, { failBurn: true }), log: (l) => logsB.push(l), baseName: '굽기실패', concurrency: 1 });
    ok(rB.ok, '자막 굽기가 실패해도 전체는 성공(렌더 결과를 버리지 않는다)');
    ok(rB.hasSubtitle === false && /스텁 굽기 실패/.test(rB.subtitleError || ''), '실패 사유가 반환값에 남는다');
    ok(fs.existsSync(path.join(rootB, '굽기실패_whiteboard.mp4')) && fs.existsSync(path.join(rootB, '굽기실패_whiteboard_유튜브자막.srt')), '영상과 .srt 는 둘 다 남는다');
    ok(logsB.some((l) => /자막 굽기 실패/.test(l)), '무슨 일이 있었는지 로그로 알린다');

    // ⓒ withSubtitle:false 면 .srt 조차 만들지 않는다
    const rootC = fs.mkdtempSync(path.join(TMP, 'sub3-'));
    const prC = mkProject(rootC);
    const callsC = freshCalls();
    const rC = await WP.runWhiteboard(prC, rootC, { deps: mkDeps(callsC), log: () => {}, baseName: '자막끔', concurrency: 1, withSubtitle: false });
    ok(rC.ok && callsC.subtitle.length === 0 && !rC.srtPath, 'withSubtitle:false 면 자막 단계를 통째로 건너뛴다');
    ok(!fs.existsSync(path.join(rootC, '자막끔_whiteboard.srt')), '.srt 도 안 만든다');

    // ⓓ 자막 글자수 설정이 실제로 전달된다
    //   ⚠ 픽스처 문장은 「문장1」처럼 짧아 어떤 글자수로도 한 줄이다 — 긴 문장을 하나 넣어야 갈린다.
    const LONG = '관계를 깨는 것은 거절이 아니라 지나친 다정입니다.';
    const cnt = async (maxChars) => {
      const root = fs.mkdtempSync(path.join(TMP, 'sub4-'));
      const pr = mkProject(root);
      pr.groups[0]._s[0].text = LONG;
      const calls = freshCalls();
      await WP.runWhiteboard(pr, root, { deps: mkDeps(calls), log: () => {}, baseName: '글자수', concurrency: 1, captionMaxChars: maxChars });
      return calls.subtitle[0].lines;
    };
    const wide = await cnt(20), narrow = await cnt(3);
    ok(narrow > wide, `글자수를 좁히면 자막 조각이 늘어난다(설정이 실제로 전달된다) — 20자 ${wide} · 3자 ${narrow}`);
  }


  head('[📁] 완성물 폴더 — MP4·자막만 옮기고 중간 파일은 작업 폴더에 남긴다');
  {
    // ⓐ finalDir 을 주면 완성물이 그리로 간다(장면·주석은 작업 폴더에 그대로 — 이어받기의 근거다).
    const root = fs.mkdtempSync(path.join(TMP, 'fin-'));
    const dest = fs.mkdtempSync(path.join(TMP, 'dest-'));
    const pr = mkProject(root);
    const calls = freshCalls();
    const r = await WP.runWhiteboard(pr, root, { deps: mkDeps(calls), log: () => {}, baseName: '완성', concurrency: 1, finalDir: dest });
    ok(r.ok, '만들었다 — ' + (r.error || ''));
    ok(fs.existsSync(path.join(dest, '완성_whiteboard.mp4')), '🔑 MP4 가 지정 폴더에 있다');
    ok(fs.existsSync(path.join(dest, '완성_whiteboard_유튜브자막.srt')), '자막도 함께 간다');
    ok(!fs.existsSync(path.join(root, '완성_whiteboard.mp4')), '작업 폴더에는 남기지 않는다(복사가 아니라 이동)');
    ok(path.resolve(r.output) === path.resolve(path.join(dest, '완성_whiteboard.mp4')), '반환 경로도 옮긴 자리를 가리킨다');
    ok(fs.existsSync(path.join(root, 'whiteboard-1', 'scene-01.1920.mp4')), '🔑 장면 파일은 작업 폴더에 그대로 — 다음에 이어받는다');

    // ⓑ finalDir 이 없으면 예전처럼 작업 폴더에 둔다
    const root2 = fs.mkdtempSync(path.join(TMP, 'fin2-'));
    const r2 = await WP.runWhiteboard(mkProject(root2), root2, { deps: mkDeps(freshCalls()), log: () => {}, baseName: '그대로', concurrency: 1 });
    ok(r2.ok && fs.existsSync(path.join(root2, '그대로_whiteboard.mp4')), 'finalDir 없으면 작업 폴더');

    // ⓒ 같은 폴더를 주면 헛수고하지 않는다
    const root3 = fs.mkdtempSync(path.join(TMP, 'fin3-'));
    const r3 = await WP.runWhiteboard(mkProject(root3), root3, { deps: mkDeps(freshCalls()), log: () => {}, baseName: '같은곳', concurrency: 1, finalDir: root3 });
    ok(r3.ok && fs.existsSync(path.join(root3, '같은곳_whiteboard.mp4')), 'finalDir == outRoot 면 그대로');

    // ⓓ 옮기기 실패는 **작업을 막지 않는다** — 파일은 작업 폴더에 멀쩡히 남는다.
    const root4 = fs.mkdtempSync(path.join(TMP, 'fin4-'));
    const blocked = path.join(TMP, 'blocked-as-file');
    fs.writeFileSync(blocked, 'x');                       // 폴더로 못 만드는 자리
    const logs = [];
    const r4 = await WP.runWhiteboard(mkProject(root4), root4, { deps: mkDeps(freshCalls()), log: (m) => logs.push(m), baseName: '막힘', concurrency: 1, finalDir: blocked });
    ok(r4.ok, '옮기기에 실패해도 전체는 성공이다');
    ok(fs.existsSync(path.join(root4, '막힘_whiteboard.mp4')), '작업 폴더에 그대로 있다');
    ok(logs.some((m) => m.indexOf('작업 폴더에 둡니다') > -1), '이유를 로그로 알린다');

    // ⓔ moveFinals 단독 — 크로스 드라이브(EXDEV) 폴백이 있는지 원문으로 확인
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'core', 'whiteboard-pipeline.js'), 'utf8');
    ok(/EXDEV/.test(SRC) && /copyFileSync/.test(SRC),
      '🔑 드라이브가 다르면 renameSync 가 실패한다(G: → C:\\Downloads) → 복사 폴백이 있다');
    const a = fs.mkdtempSync(path.join(TMP, 'mv-a-')), b = fs.mkdtempSync(path.join(TMP, 'mv-b-'));
    const f1 = path.join(a, 'x.mp4'); fs.writeFileSync(f1, 'v');
    const mv = WP.moveFinals([f1, path.join(a, '없다.srt')], b, () => {});
    ok(mv.ok && fs.existsSync(path.join(b, 'x.mp4')) && !fs.existsSync(f1), 'moveFinals 가 실제로 옮긴다');
    ok(mv.map.size === 1, '없는 파일은 조용히 건너뛴다(던지지 않는다)');
  }

  head('[💬2] 자막 모양 — 채널 설정이 굽기까지 전달된다');
  {
    // 굽기를 켜면 .srt 이름이 바뀌고(플레이어 자동 로드 방지), 끄면 원래 이름으로 남는다.
    const rootA = fs.mkdtempSync(path.join(TMP, 'sty-'));
    const callsA = freshCalls();
    const style = { font: 'NanumGothic', sizePct: 4, pos: 'top', marginPct: 3, bold: false };
    const rA = await WP.runWhiteboard(mkProject(rootA), rootA, { deps: mkDeps(callsA), log: () => {}, baseName: '모양', concurrency: 1, subtitleStyle: style });
    ok(rA.ok && callsA.subtitle.length === 1, '구웠다');
    ok(JSON.stringify(callsA.subtitle[0].style) === JSON.stringify(style), '🔑 채널이 정한 자막 모양이 그대로 굽기로 간다');
    ok(callsA.subtitle[0].height === 1080 && callsA.subtitle[0].width === 1920,
      `🔑 **영상 실측 크기**를 함께 넘긴다(ASS PlayRes 의 근거) — ${callsA.subtitle[0].width}x${callsA.subtitle[0].height}`);

    const rootB = fs.mkdtempSync(path.join(TMP, 'sty2-'));
    const rB = await WP.runWhiteboard(mkProject(rootB), rootB, { deps: mkDeps(freshCalls()), log: () => {}, baseName: '안굽기', concurrency: 1, burnSubtitle: false });
    ok(rB.ok && fs.existsSync(path.join(rootB, '안굽기_whiteboard.srt')),
      '굽지 않으면 **영상과 같은 이름**으로 남긴다 — 플레이어가 자동으로 띄워 주는 편이 낫다');
    ok(!fs.existsSync(path.join(rootB, '안굽기_whiteboard_유튜브자막.srt')), '그때는 별도 이름을 만들지 않는다');

    // 옛 이름(영상과 같은 이름)이 남아 있으면 굽는 실행에서 치운다 — 그게 「자막 두 줄」의 원인이다.
    const rootC = fs.mkdtempSync(path.join(TMP, 'sty3-'));
    const prC = mkProject(rootC);
    fs.writeFileSync(path.join(rootC, '치움_whiteboard.srt'), '옛 자막');
    const rC = await WP.runWhiteboard(prC, rootC, { deps: mkDeps(freshCalls()), log: () => {}, baseName: '치움', concurrency: 1 });
    ok(rC.ok && !fs.existsSync(path.join(rootC, '치움_whiteboard.srt')), '🔑 옛 이름의 .srt 를 치운다(안 치우면 겹쳐 보인다)');
  }


  head('[🖼] 그림을 다시 만들면 영역·장면도 다시 만든다 — 2026-09-16 실사고 회귀');
  {
    // 🔴 실사고: 앱 썸네일은 새 선그림인데 결과 MP4 는 옛 수채화였다.
    //   원인 = 이어받기 판정이 「장면 mtime ≥ 주석 mtime」뿐이라 **그림이 바뀐 걸 아무도 안 봤다**
    //   (실측 01.png 13:17 · 주석 12:10 · scene-01.mp4 12:12 → 건너뜀).
    const root = fs.mkdtempSync(path.join(TMP, 'img-'));
    const pr = mkProject(root);
    const c1 = freshCalls();
    const r1 = await WP.runWhiteboard(pr, root, { deps: mkDeps(c1), log: () => {}, baseName: '그림', concurrency: 1 });
    ok(r1.ok && c1.render.length === 2, `처음엔 장면 2개를 렌더한다 (${c1.render.length})`);

    // ⓐ 그림이 그대로면 건너뛴다 — 기존 이어받기는 그대로여야 한다(30분짜리 렌더다).
    const c2 = freshCalls();
    await WP.runWhiteboard(pr, root, { deps: mkDeps(c2), log: () => {}, baseName: '그림', concurrency: 1 });
    ok(c2.render.length === 0 && c2.draft === 0, `그림이 그대로면 렌더·영역 뽑기 둘 다 건너뛴다 (렌더 ${c2.render.length})`);

    // ⓑ 그림을 **내용까지** 바꾸면 그 장면만 다시 만든다
    fs.writeFileSync(pr.groups[0].imagePath, Buffer.from('89504e470d0a1a0affee', 'hex'));
    const c3 = freshCalls(); const logs3 = [];
    await WP.runWhiteboard(pr, root, { deps: mkDeps(c3), log: (m) => logs3.push(m), baseName: '그림', concurrency: 1 });
    ok(c3.draft === 1, `🔑 그림이 바뀐 장면의 영역을 새로 뽑는다 (${c3.draft}회)`);
    ok(c3.render.length === 1 && c3.render[0].indexOf('scene-01') === 0,
      `🔑 그 장면을 **다시 렌더한다** — 옛 영상을 그대로 내보내지 않는다 (${JSON.stringify(c3.render)})`);
    ok(logs3.some((m) => m.indexOf('그림이 바뀌었습니다') > -1), '이유를 로그로 알린다');
    ok(!logs3.some((m) => m.indexOf('깨져 있어') > -1), '「주석이 깨졌다」고 거짓말하지 않는다');

    // ⓒ 🔑 내용은 같은데 mtime 만 새로워진 경우(미디어 캐시가 같은 그림을 복사) → **다시 렌더하지 않는다**
    //   mtime 으로 판정했다면 여기서 30분짜리 렌더가 헛돈다. 지문(내용 해시)을 쓰는 이유다.
    const t = Date.now() / 1000 + 600;
    fs.utimesSync(pr.groups[0].imagePath, t, t);
    const c4 = freshCalls();
    await WP.runWhiteboard(pr, root, { deps: mkDeps(c4), log: () => {}, baseName: '그림', concurrency: 1 });
    ok(c4.render.length === 0 && c4.draft === 0,
      `🔑 내용이 같으면 mtime 이 새로워도 그대로 둔다 (렌더 ${c4.render.length} · 영역 ${c4.draft})`);

    // ⓓ **실사고 그대로** — 지문이 없는 옛 주석 + 그보다 새로운 그림
    const rootB = fs.mkdtempSync(path.join(TMP, 'img2-'));
    const prB = mkProject(rootB);
    await WP.runWhiteboard(prB, rootB, { deps: mkDeps(freshCalls()), log: () => {}, baseName: '옛주석', concurrency: 1 });
    const annB = ANNreal.annotationPathFor(prB.groups[0].imagePath);
    const j = JSON.parse(fs.readFileSync(annB, 'utf8'));
    ok(j._priming && j._priming.imageSig, '새 주석에는 그림 지문이 적힌다');
    delete j._priming.imageSig;                                   // 옛 주석처럼 지문을 지운다
    fs.writeFileSync(annB, JSON.stringify(j, null, 2));
    const past = Date.now() / 1000 - 3600;                        // 주석을 1시간 전으로(= 실사고의 12:10)
    fs.utimesSync(annB, past, past);
    const cB = freshCalls(); const logsB = [];
    await WP.runWhiteboard(prB, rootB, { deps: mkDeps(cB), log: (m) => logsB.push(m), baseName: '옛주석', concurrency: 1 });
    ok(cB.draft === 1 && cB.render.length === 1,
      `🔑 지문이 없는 옛 주석은 **mtime 으로** 가른다 — 그림이 더 새로우면 다시 만든다 (영역 ${cB.draft} · 렌더 ${cB.render.length})`);

    // ⓔ imageChanged 단독 — 판정 자체를 원문으로 확인
    const p1 = path.join(rootB, 'media-1', '02.png');
    const sigNow = ANNreal.imageSig(p1);
    ok(WP.imageChanged({ _priming: { imageSig: 'deadbeef:1' } }, p1, annB, ANNreal) === true, '지문이 다르면 바뀐 것');
    ok(WP.imageChanged({ _priming: { imageSig: sigNow } }, p1, annB, ANNreal) === false, '지문이 같으면 안 바뀐 것');
    ok(ANNreal.imageSig(path.join(rootB, '없는파일.png')) === null, '못 읽으면 null(판정 불가)');
  }


  head('[🕳] 굶는 영역 — 뒤 영역에 덮여 **그릴 게 없어 화면이 멈추던** 것 (2026-09-16 실사고)');
  {
    // 🔴 렌더러는 자기 영역에서 **뒤에 오는 모든 영역**을 뺀 자리만 그린다(_allowed_mask).
    //   그래서 앞 영역이 뒤 영역들에 통째로 덮이면 그 시간 내내 아무 일도 일어나지 않는다.
    //   로이 실측: 0.5~9초 구간 **변한 화소 0** → "10초 동안 멈춰있다가 움직이기 시작".
    const REAL = [                                    // 로이의 실제 주석(01.annotation.json) 영역 그대로
      { x: 762, y: 0, width: 582, height: 397 },      // seq1 — 10.2초
      { x: 858, y: 0, width: 486, height: 323 },      // seq2 — seq1 안에 포함
      { x: 0, y: 0, width: 858, height: 768 },        // seq3 — 왼쪽 전부
      { x: 858, y: 0, width: 486, height: 768 },      // seq4 — 오른쪽 전부
      { x: 626, y: 437, width: 111, height: 80 },     // seq5
    ];
    const mkEls = (rs, sec = 4) => rs.map((r, i) => ({ sequence: i + 1, region: r, reveal: { durationMs: sec * 1000, protectedRegions: [] } }));

    // ⓐ areaMinus — 넓이 계산 자체
    ok(ANNreal.areaMinus({ x: 0, y: 0, width: 10, height: 10 }, []) === 100, '아무것도 안 빼면 제 넓이');
    ok(ANNreal.areaMinus({ x: 0, y: 0, width: 10, height: 10 }, [{ x: 0, y: 0, width: 10, height: 10 }]) === 0, '같은 상자를 빼면 0');
    ok(ANNreal.areaMinus({ x: 0, y: 0, width: 10, height: 10 }, [{ x: 5, y: 0, width: 5, height: 10 }]) === 50, '절반을 빼면 절반');
    ok(ANNreal.areaMinus({ x: 0, y: 0, width: 10, height: 10 }, [{ x: 20, y: 20, width: 5, height: 5 }]) === 100, '안 겹치면 그대로');
    ok(ANNreal.areaMinus({ x: 0, y: 0, width: 10, height: 10 },
      [{ x: 0, y: 0, width: 6, height: 10 }, { x: 4, y: 0, width: 6, height: 10 }]) === 0, '둘이 합쳐 덮으면 0(겹쳐도 이중으로 안 센다)');

    // ⓑ 실사고 재현 — 그 순서 그대로면 seq1·seq2 가 굶는다
    const bad = ANNreal.findStarved(mkEls(REAL));
    ok(bad.length === 2 && bad[0].seq === 1 && bad[0].ratio === 0,
      `🔑 실사고 재현 — seq1 이 **남는 자리 0%** 로 굶는다 (${JSON.stringify(bad.map((b) => b.seq))})`);

    // ⓒ 넓이 내림차순으로 배정하면 전부 살아난다
    const ordered = ANNreal.orderRegionsForReveal(REAL.map((region) => ({ region })));
    ok(ANNreal.findStarved(mkEls(ordered.map((o) => o.region))).length === 0,
      '🔑 **넓은 영역부터** 배정하면 굶는 영역이 사라진다(렌더러가 뒤 영역을 빼기 때문)');
    const areas = ordered.map((o) => o.region.width * o.region.height);
    ok(areas.every((a, i) => i === 0 || areas[i - 1] >= a), `넓이 내림차순 (${areas.join(' > ')})`);
    const same = ANNreal.orderRegionsForReveal([{ region: { x: 0, y: 0, width: 10, height: 10 }, direction: 'a' }, { region: { x: 50, y: 0, width: 10, height: 10 }, direction: 'b' }]);
    ok(same[0].direction === 'a', '넓이가 같으면 원래 순서를 지킨다(초안의 흐름을 헛되이 흔들지 않는다)');

    // ⓓ buildAnnotation 이 그 순서로 배정한다
    const scene = { num: 1, durationMs: 20000, groupNums: [1], sentenceNums: [1],
      elements: REAL.map((_, i) => ({ seq: i + 1, startMs: i * 4000, durationMs: 4000, subtitle: 's' + i })) };
    const built = ANNreal.buildAnnotation(scene, { canvas: { width: 1344, height: 768 }, regions: REAL.map((region) => ({ region })) });
    ok(ANNreal.findStarved(built.elements).length === 0, 'buildAnnotation 결과에 굶는 영역이 없다');
    ok(built.elements[0].region.width * built.elements[0].region.height === Math.max(...REAL.map((r) => r.width * r.height)),
      '가장 넓은 영역이 첫 차례다');
    ok(built.elements.every((e, i) => e.reveal.startMs === i * 4000), '타이밍(문장 순서)은 그대로 — 영역만 재배치한다');

    // ⓓ-2 🔴 **무조건 넓이순으로 바꾸면 안 된다** — 로이 대본 장면 3 은 원래 순서가 옳았다(굶음 0).
    //   넓이순으로 강제하면 오히려 1개가 굶는다. 그래서 두 배정을 **재 보고 적은 쪽**을 고른다.
    const SC3 = [                                    // 로이의 03.annotation.json 영역 그대로
      { x: 391, y: 358, width: 185, height: 261 }, { x: 576, y: 358, width: 93, height: 261 },
      { x: 669, y: 358, width: 95, height: 261 }, { x: 764, y: 358, width: 171, height: 261 },
      { x: 509, y: 407, width: 304, height: 159 },
    ];
    const scene3 = { num: 3, durationMs: 20000, groupNums: [3], sentenceNums: [3],
      elements: SC3.map((_, i) => ({ seq: i + 1, startMs: i * 4000, durationMs: 4000, subtitle: 't' + i })) };
    ok(ANNreal.findStarved(mkEls(SC3)).length === 0, '(전제) 장면3 은 원래 순서로 굶는 영역이 없다');
    const forced = ANNreal.assignElements(scene3, ANNreal.orderRegionsForReveal(SC3.map((region) => ({ region }))));
    ok(ANNreal.findStarved(forced).length > 0, '(전제) 그런데 넓이순으로 강제하면 굶는 영역이 생긴다');
    const picked = ANNreal.buildAnnotation(scene3, { canvas: { width: 1344, height: 768 }, regions: SC3.map((region) => ({ region })) });
    ok(ANNreal.findStarved(picked.elements).length === 0,
      '🔑 더 나은 쪽을 고른다 — 규칙 하나를 강요하지 않는다');
    ok(JSON.stringify(picked.elements.map((e) => e.region)) === JSON.stringify(SC3),
      '동률(둘 다 0)이 아니라 원래가 더 나으므로 **원래 순서를 지킨다**');

    // ⓔ 🔑 파이프라인이 **옛 주석을 자동으로 고친다** — 좌표는 그대로 두고 순서만 다시 잡는다
    const root = fs.mkdtempSync(path.join(TMP, 'starve-'));
    const pr = mkProject(root);
    await WP.runWhiteboard(pr, root, { deps: mkDeps(freshCalls()), log: () => {}, baseName: '굶음', concurrency: 1 });
    const annP = ANNreal.annotationPathFor(pr.groups[0].imagePath);
    const j = JSON.parse(fs.readFileSync(annP, 'utf8'));
    const n0 = j.elements.length;
    // 굶는 배치로 바꿔 심는다 — seq1(오른쪽 위)을 seq3(왼쪽 전부)·seq4(오른쪽 전부)가 뒤에서 통째로 덮는 조합.
    const BAD = [REAL[0], REAL[2], REAL[3]];
    j.elements = j.elements.map((e, i) => ({ ...e, region: BAD[i % BAD.length] }));
    fs.writeFileSync(annP, JSON.stringify(j, null, 2));
    ok(ANNreal.findStarved(j.elements).length > 0, '(준비) 굶는 주석을 심었다');
    const c = freshCalls(); const logs = [];
    await WP.runWhiteboard(pr, root, { deps: mkDeps(c), log: (m) => logs.push(m), baseName: '굶음', concurrency: 1 });
    const after = JSON.parse(fs.readFileSync(annP, 'utf8'));
    ok(after.elements.length === n0, '영역 개수는 그대로');
    ok(ANNreal.findStarved(after.elements).length === 0, '🔑 굶는 영역이 사라졌다(순서를 다시 잡았다)');
    ok(logs.some((m) => m.indexOf('영역 순서를 다시 잡았습니다') > -1), '이유를 로그로 알린다');
    ok(c.render.some((f) => f.indexOf('scene-01') === 0), '🔑 그 장면을 다시 렌더한다 — 멈춰 있던 영상을 그대로 두지 않는다');
    ok(c.draft === 0, '영역을 새로 뽑지는 않는다(사람이 고친 좌표를 보존한다)');
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log(`\nwhiteboard-pipeline: ${n - bad}/${n} 통과`);
  if (bad) process.exit(1);
})().catch((e) => { console.error('💥', e); process.exit(1); });
