'use strict';

/**
 * whiteboard-pipeline.js — 롱폼 프로젝트 → **화이트보드 MP4** (4단계 배관, 2026-09-05).
 *
 * 흐름:  장면 계획(2단계) → 관문 A(계획 텍스트) → 가상환경 → 주석(있으면 유지·타이밍만 갱신)
 *        → 관문 B(확인 그림) → 장면 렌더(동시 N개 · 이어받기) → 규격 검사 → 이어붙이기.
 *
 * 🔑 **이 파일은 Electron 을 모른다.** 대화상자·레인·로그창은 main.js 가 콜백(`gateA`·`gateB`·`log`)으로
 *   넘긴다. 그래서 테스트가 렌더러(파이썬)를 스텁으로 갈아끼워 흐름 전체를 돌릴 수 있다(`opts.deps`).
 *
 * 🔑 **3단계(장면별 화이트보드 화풍 이미지) 전까지의 정책 = 그룹 이미지 1장이 장면 1개.**
 *   그래서 장면 계획은 **분할하지 않는다**(`noSplit`). 분할하면 같은 그림을 두 번 그려야 하는데,
 *   그건 펜이 느린 것보다 나쁘다(같은 장면이 되감기는 것처럼 보인다). 짧은 그룹 병합은 그대로 —
 *   병합된 장면은 **첫 그룹의 이미지**를 쓴다. 3단계가 들어오면 이 정책만 바꾸면 된다.
 *
 * 🔊 **5단계(2026-09-16) — 음성을 얹는다.** 장면 길이 = 그 장면 문장들의 TTS 합이라 타임라인이 이미
 *   맞아떨어진다(v0.3.91). `core/whiteboard-audio` 가 장면마다 문장 음성을 이어붙여 **그 장면 영상
 *   길이에 정확히** 맞춘 뒤(프레임 반올림 드리프트 제거) 한 번에 mux 한다.
 *   ⚠ 음성 얹기가 실패해도 **무음 MP4 는 그대로 남긴다** — 30분 렌더 결과를 버리지 않는다.
 *
 * 💬 **자막(2026-09-16)** — `core/whiteboard-subtitle` 이 `.srt` 를 내고, 스위치가 켜져 있으면 **영상에 굽는다**.
 *   Vrew 를 거치지 않는 최종물이라 소프트 자막은 「안 보인다」가 되기 때문이다. 굽기는 재인코딩이라
 *   비싸므로 ⚙ 에서 끌 수 있고, 꺼도 `.srt` 는 그대로 나온다(유튜브 업로드용).
 *   ⚠ **구웠으면 `.srt` 이름을 바꿔 둔다**(`…_유튜브자막.srt`) — 영상과 **같은 이름**의 자막 파일이 옆에 있으면
 *     동영상 플레이어가 그걸 **자동으로 켜서** 구운 자막과 **두 줄로 겹쳐 보인다**(로이 2026-09-16 신고).
 *
 * 📁 **완성물 위치(2026-09-16)** — 장면·중간 파일은 작업 폴더(`outRoot/whiteboard-N`)에 두고,
 *   **완성된 MP4·자막만** `opts.finalDir`(채널의 「화이트보드 출력」 폴더)로 옮긴다.
 *   🔑 중간 산출물을 그 폴더에 직접 만들지 않는 이유: ① 반쯤 만들어진 파일이 보이지 않게
 *   ② `renameSync` 는 **드라이브가 다르면 실패**한다(G: → C:\Downloads) — 마지막 한 번만 복사로 넘긴다.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DEPS = {
  WB: () => require('./whiteboard-render'),
  ANN: () => require('./whiteboard-annotation'),
  SC: () => require('./whiteboard-scenes'),
  WA: () => require('./whiteboard-audio'),
  WS: () => require('./whiteboard-subtitle'),
};

// 실측(v0.3.90): 1920 긴변 · 60fps 렌더가 프레임당 0.173초. 22분 = 39,960프레임(≈30.3프레임/초 기준).
const SEC_PER_FRAME_1920 = 0.173;
const FRAMES_PER_SEC = 30.3;
const PAD = (n) => String(n).padStart(2, '0');

/** 장면이 쓸 그림 — 첫 그룹의 이미지. 없으면 그 장면의 다른 그룹을 순서대로 본다(병합 장면). */
function imageForScene(project, scene) {
  const byNum = new Map((project.groups || []).map((g) => [g.num, g]));
  for (const gn of scene.groupNums) {
    const g = byNum.get(gn);
    if (g && g.imagePath && fs.existsSync(g.imagePath)) return g.imagePath;
  }
  return null;
}

/**
 * 문장 번호 → TTS 음성 파일 경로.
 * 🔑 장면은 `sentenceNums` 만 들고 있어(경로를 복사해 두면 TTS 를 다시 만들었을 때 낡는다)
 *   얹는 시점에 project 에서 지금 경로를 다시 읽는다.
 */
function sentenceAudioMap(project) {
  const m = new Map();
  for (const g of (project.groups || [])) {
    const ss = project.getSentencesOfGroup ? project.getSentencesOfGroup(g) : [];
    for (const s of ss) {
      if (s && s.ttsAudioPath && fs.existsSync(s.ttsAudioPath)) m.set(s.num, s.ttsAudioPath);
    }
  }
  return m;
}

/** 렌더 시간 추정(초) — 관문 A 에 「이 계획이면 몇 분」을 보여 주려는 것이지 정확한 예보가 아니다. */
function estimateRenderSec(totalSec, capLongEdge, concurrency) {
  const scale = Math.pow((capLongEdge || 1920) / 1920, 2);
  const frames = totalSec * FRAMES_PER_SEC;
  return Math.round(frames * SEC_PER_FRAME_1920 * scale / Math.max(1, concurrency || 1));
}

/**
 * 계획만 — 파이썬을 부르지 않는다(관문 A · 「📋 장면 계획」 버튼이 쓴다).
 * @returns {{ ok:boolean, scenes, summary, missing:Array<{scene:number, groupNums:number[]}>, totalSec:number, estimateSec:number, lines:string[] }}
 */
function planWhiteboard(project, opts = {}) {
  const deps = { ...DEFAULT_DEPS, ...(opts.deps || {}) };
  const SC = deps.SC();
  const cap = opts.capLongEdge || 1920;
  const conc = opts.concurrency || 1;

  const plan = SC.planScenes(project, { noSplit: true });
  const missing = [];
  for (const s of plan.scenes) {
    if (!imageForScene(project, s)) missing.push({ scene: s.num, groupNums: s.groupNums.slice() });
  }
  const totalSec = plan.scenes.reduce((a, s) => a + (s.durationSec || 0), 0);
  const estimateSec = estimateRenderSec(totalSec, cap, conc);
  const lines = plan.summary.lines.slice();
  lines.push(`⏱ 총 ${fmtDur(totalSec)} · 출력 긴변 ${cap}px · 동시 ${conc}개 → 렌더 약 ${fmtDur(estimateSec)} 예상 (실측 기준 추정)`);
  if (missing.length) {
    lines.push(`⛔ 이미지가 없는 장면 ${missing.length}개 (G${missing.map((m) => m.groupNums.join('+')).join(', G')}) — 이미지를 먼저 만들어야 렌더할 수 있습니다`);
  }
  lines.push('ⓘ 음성·자막이 얹힙니다. 다만 3단계 전이라 그림은 기존 화풍 그대로 씁니다.');
  return { ok: missing.length === 0, scenes: plan.scenes, summary: plan.summary, missing, totalSec, estimateSec, lines };
}

function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m}분 ${s}초` : `${m}분`;
}

/** 기존 주석이 지금 장면 계획과 맞나 — 문장 구성·길이가 다르면 타이밍이 낡은 것이다. */
function annotationStale(ann, scene) {
  if (!ann || !ann._priming) return true;
  const a = (ann._priming.sentenceNums || []).join(',');
  const b = (scene.sentenceNums || []).join(',');
  if (a !== b) return true;
  return Math.abs((ann.sceneDurationMs || 0) - (scene.durationMs || 0)) > 50;
}

/**
 * 🔴 **그림이 바뀌었나** — 주석의 영역 좌표는 **그 그림에서 뽑은 것**이다. 그림을 다시 만들었는데
 *   주석을 그대로 두면 ① 펜이 엉뚱한 자리를 지나가고 ② 주석 mtime 이 그대로라 **장면 렌더가
 *   「이미 있음」으로 건너뛰어 옛 그림 영상이 그대로 나간다**(2026-09-16 실사고: 앱 썸네일은 새 선그림인데
 *   결과 MP4 는 옛 수채화. 실측 01.png 13:17 · 주석 12:10 · scene-01.mp4 12:12).
 * 판정은 **내용 지문**이 정본이고, 지문이 없는 옛 주석만 mtime 으로 가른다.
 */
function imageChanged(ann, imagePath, annPath, ANN) {
  const rec = ann && ann._priming && ann._priming.imageSig;
  const now = ANN.imageSig ? ANN.imageSig(imagePath) : null;
  if (rec && now) return rec !== now;
  try { return fs.statSync(imagePath).mtimeMs > fs.statSync(annPath).mtimeMs + 1000; } catch (_) { return false; }
}

/**
 * 주석을 준비한다 — 없으면 초안, 있으면 **영역은 그대로 두고 타이밍만** 장면 계획에 맞춘다.
 *   🔑 TTS 를 다시 만들면 문장 길이가 바뀌어 주석의 startMs·durationMs 가 낡는다. 그렇다고 주석을
 *   통째로 다시 만들면 로이가 preview.html 로 고친 영역이 사라진다(v0.3.86 계열). 그래서 **영역은 보존**하고
 *   타이밍만 다시 계산한다 — 사람이 정한 것과 기계가 정하는 것을 가른다.
 */
async function prepareAnnotation(scene, imagePath, { ANN, WB, force, log, abortSignal }) {
  const annPath = ANN.annotationPathFor(imagePath);
  if (fs.existsSync(annPath) && !force) {
    let ann = null;
    try { ann = JSON.parse(fs.readFileSync(annPath, 'utf8')); } catch (_) { ann = null; }
    // 🔴 그림이 바뀌었으면 **영역부터 다시** 뽑는다 — 옛 그림 기준 영역은 새 그림에서 의미가 없다.
    //   ⚠ 사람이 preview.html 로 고친 영역도 함께 사라진다. 그래도 이게 맞다 — 그 영역 역시 옛 그림 것이다.
    if (ann && imageChanged(ann, imagePath, annPath, ANN)) {
      log(`  🖼 장면 ${PAD(scene.num)} 그림이 바뀌었습니다 — 영역을 새로 뽑고 장면도 다시 렌더합니다`);
      try { fs.unlinkSync(annPath); } catch (_) {}
      ann = null;
    }
    // 🔴 굶는 영역(뒤 영역에 통째로 덮여 그릴 게 없는 것)이 있으면 **순서만** 다시 잡는다.
    //   영역 좌표는 그대로 두므로 사람이 고친 영역도 살아남는다 — 바뀌는 것은 그리는 차례뿐이다.
    if (ann && Array.isArray(ann.elements) && ann.elements.length && ann.canvas && ANN.findStarved) {
      const starved = ANN.findStarved(ann.elements);
      if (starved.length) {
        const lost = starved.reduce((a, x) => a + x.sec, 0);
        const drafted = { canvas: ann.canvas, regions: ann.elements.map((e) => ({ region: e.region, direction: e.reveal && e.reveal.direction })) };
        const next = ANN.buildAnnotation(scene, drafted, { imageSig: ANN.imageSig ? ANN.imageSig(imagePath) : null });
        const still = ANN.findStarved(next.elements);
        if (still.length < starved.length) {
          try { fs.writeFileSync(annPath, JSON.stringify(next, null, 2), 'utf8'); }
          catch (e) { return { ok: false, error: `주석을 쓰지 못했습니다: ${e.message}` }; }
          const chk0 = WB.checkCanvas(imagePath, annPath);
          if (!chk0.ok) return { ok: false, error: chk0.error };
          log(`  🔧 장면 ${PAD(scene.num)} 영역 순서를 다시 잡았습니다 — 뒤 영역에 덮여 `
            + `${lost.toFixed(1)}초 동안 아무것도 안 그리던 영역 ${starved.length}개를 살렸습니다`);
          return { ok: true, path: annPath, reordered: true };
        }
      }
    }
    if (ann && !annotationStale(ann, scene)) {
      const chk = WB.checkCanvas(imagePath, annPath);
      if (!chk.ok) return { ok: false, error: chk.error };
      return { ok: true, path: annPath, kept: true };
    }
    if (ann && Array.isArray(ann.elements) && ann.elements.length && ann.canvas) {
      const drafted = { canvas: ann.canvas, regions: ann.elements.map((e) => ({ region: e.region, direction: e.reveal && e.reveal.direction })) };
      const next = ANN.buildAnnotation(scene, drafted, { imageSig: ANN.imageSig ? ANN.imageSig(imagePath) : null });
      try { fs.writeFileSync(annPath, JSON.stringify(next, null, 2), 'utf8'); }
      catch (e) { return { ok: false, error: `주석을 쓰지 못했습니다: ${e.message}` }; }
      const chk = WB.checkCanvas(imagePath, annPath);
      if (!chk.ok) return { ok: false, error: chk.error };
      log(`  ♻ 장면 ${PAD(scene.num)} 주석 타이밍 갱신 (문장·길이가 바뀜 — 영역은 그대로)`);
      return { ok: true, path: annPath, refreshed: true };
    }
    // 깨진 주석 → 새로 만든다(아래로). ⚠ 그림이 바뀌어 위에서 비운 경우는 이미 알렸으니 또 말하지 않는다.
    if (fs.existsSync(annPath)) {
      log(`  ⚠ 장면 ${PAD(scene.num)} 주석이 깨져 있어 새로 만듭니다 (${path.basename(annPath)})`);
      try { fs.unlinkSync(annPath); } catch (_) {}
    }
  }
  const w = await ANN.writeAnnotation(scene, imagePath, { force: !!force, log, abortSignal });
  if (!w.ok) return { ok: false, error: w.error };
  return { ok: true, path: annPath, created: !w.skipped };
}

/** 중단 폴링을 AbortSignal 로 바꿔 자식 파이썬을 죽일 수 있게 한다. */
async function withAbort(isAborted, fn) {
  const ctl = new AbortController();
  const t = setInterval(() => { try { if (isAborted && isAborted()) ctl.abort(); } catch (_) {} }, 500);
  try { return await fn(ctl.signal); } finally { clearInterval(t); }
}

/**
 * 전 과정. 어떤 경우에도 던지지 않고 `{ok:false, error}` 로 돌려준다.
 * @param opts.gateA  async (plan) => boolean   — 관문 A(계획 텍스트). 없으면 통과. false 면 취소.
 * @param opts.gateB  async ({dir, files}) => boolean — 관문 B(확인 그림). **주면** 확인 그림을 만들어 묻는다. 없으면 건너뜀(큐).
 * @param opts.isAborted () => boolean
 * @param opts.onProgress ({done,total,scene}) => void
 */
async function runWhiteboard(project, outRoot, opts = {}) {
  const deps = { ...DEFAULT_DEPS, ...(opts.deps || {}) };
  const WB = deps.WB(), ANN = deps.ANN();
  const log = opts.log || (() => {});
  const isAborted = opts.isAborted || (() => false);
  const cap = opts.capLongEdge || 1920;
  const conc = Math.max(1, opts.concurrency || 1);
  const baseName = opts.baseName || String(project.title || 'whiteboard');
  const shortsNum = project.shortsNum || 1;

  // 1) 계획 + 관문 A
  const plan = planWhiteboard(project, { deps, capLongEdge: cap, concurrency: conc });
  for (const l of plan.lines) log(l);
  if (!plan.scenes.length) return { ok: false, error: '장면이 없습니다 — 음성(TTS)이 있는 그룹이 없습니다' };
  if (plan.missing.length) {
    return { ok: false, error: `이미지가 없는 장면 ${plan.missing.length}개 (G${plan.missing.map((m) => m.groupNums.join('+')).join(', G')})`, missing: plan.missing };
  }
  if (opts.gateA) {
    let go = false;
    try { go = await opts.gateA(plan); } catch (_) { go = false; }
    if (!go) { log('⏹ 화이트보드 — 장면 계획 단계에서 취소했습니다'); return { ok: false, cancelled: true, at: 'A' }; }
  }
  if (isAborted()) return { ok: false, cancelled: true, at: 'A' };

  // 2) 가상환경
  const env = await withAbort(isAborted, (sig) => WB.ensureEnv({ log, abortSignal: sig }));
  if (!env.ok) return { ok: false, error: env.error };

  // 3) 주석 — 있으면 유지(타이밍만 갱신), 없으면 초안
  const wbDir = path.join(outRoot, `whiteboard-${shortsNum}`);
  try { fs.mkdirSync(wbDir, { recursive: true }); } catch (e) { return { ok: false, error: `출력 폴더를 만들 수 없습니다: ${e.message}` }; }
  const jobs = [];
  let created = 0, kept = 0, refreshed = 0;
  for (const s of plan.scenes) {
    if (isAborted()) return { ok: false, cancelled: true, at: 'annotation' };
    const img = imageForScene(project, s);
    const a = await withAbort(isAborted, (sig) => prepareAnnotation(s, img, { ANN, WB, force: !!opts.forceAnnotation, log, abortSignal: sig }));
    if (!a.ok) return { ok: false, error: `장면 ${PAD(s.num)} 주석 실패 — ${a.error}` };
    if (a.created) created++; else if (a.refreshed || a.reordered) refreshed++; else kept++;
    jobs.push({ scene: s, image: img, ann: a.path, out: path.join(wbDir, `scene-${PAD(s.num)}.${cap}.mp4`) });
  }
  log(`📝 주석 ${jobs.length}개 — 새로 ${created} · 유지 ${kept} · 타이밍 갱신 ${refreshed}`);

  // 4) 관문 B — 확인 그림(영역 번호가 그려진 PNG). 대화형일 때만.
  if (opts.gateB) {
    const files = [];
    for (const j of jobs) {
      if (isAborted()) return { ok: false, cancelled: true, at: 'B' };
      const pv = path.join(wbDir, `preview-${PAD(j.scene.num)}.png`);
      const r = await withAbort(isAborted, (sig) => WB.renderPreview({ imagePath: j.image, annotationPath: j.ann, outputPath: pv, abortSignal: sig }));
      if (r.ok) files.push(r.output); else log(`  ⚠ 장면 ${PAD(j.scene.num)} 확인 그림 실패 — ${r.error}`);
    }
    log(`🖼 확인 그림 ${files.length}/${jobs.length}장 → ${wbDir}`);
    let go = false;
    try { go = await opts.gateB({ dir: wbDir, files, plan }); } catch (_) { go = false; }
    if (!go) { log('⏹ 화이트보드 — 확인 그림 단계에서 취소했습니다'); return { ok: false, cancelled: true, at: 'B' }; }
  }

  // 5) 장면 렌더 — 동시 N개 · 이어받기(주석보다 새 결과물이 있으면 건너뜀)
  const results = new Array(jobs.length).fill(null);
  let done = 0, rendered = 0, skipped = 0, failed = 0;
  const t0 = Date.now();
  const queue = jobs.map((j, i) => ({ j, i }));
  const worker = async () => {
    while (queue.length) {
      if (isAborted()) return;
      const { j, i } = queue.shift();
      const num = PAD(j.scene.num);
      let fresh = false;
      try {
        fresh = !opts.force && fs.existsSync(j.out) && fs.statSync(j.out).mtimeMs >= fs.statSync(j.ann).mtimeMs;
      } catch (_) { fresh = false; }
      if (fresh) {
        results[i] = { ok: true, output: j.out, width: 0, height: 0, fps: 0, skipped: true };
        skipped++; done++;
        log(`  ⏭ 장면 ${num} 이미 있음 — 건너뜀 (${path.basename(j.out)})`);
        if (opts.onProgress) { try { opts.onProgress({ done, total: jobs.length, scene: j.scene.num, skipped: true }); } catch (_) {} }
        continue;
      }
      log(`  ▶ 장면 ${num} 렌더 시작 (영역 ${j.scene.elements.length}개 · ${j.scene.durationSec.toFixed(1)}초)`);
      const st = Date.now();
      const r = await withAbort(isAborted, (sig) => WB.renderScene({
        imagePath: j.image, annotationPath: j.ann, outputPath: j.out, capLongEdge: cap,
        elementCount: j.scene.elements.length, log, abortSignal: sig,
      }));
      done++;
      if (r.ok) { rendered++; results[i] = r; log(`  ✓ 장면 ${num} 완료 (${fmtDur((Date.now() - st) / 1000)}) · ${done}/${jobs.length}`); }
      else { failed++; results[i] = r; log(`  ✗ 장면 ${num} 실패 — ${r.error}`); }
      if (opts.onProgress) { try { opts.onProgress({ done, total: jobs.length, scene: j.scene.num, ok: r.ok }); } catch (_) {} }
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, jobs.length) }, worker));
  if (isAborted()) { log(`⏹ 화이트보드 렌더 중단 — 완료 ${rendered} · 건너뜀 ${skipped} (다시 누르면 이어서 만듭니다)`); return { ok: false, cancelled: true, at: 'render', rendered, skipped }; }
  if (failed) {
    const bad = results.map((r, i) => (!r || !r.ok) ? PAD(jobs[i].scene.num) : null).filter(Boolean);
    return { ok: false, error: `장면 ${failed}개 렌더 실패 (${bad.join(', ')}) — 위 로그의 사유를 보고 다시 누르면 실패한 장면만 다시 만듭니다`, rendered, skipped };
  }
  log(`🎞 장면 렌더 완료 — 새로 ${rendered} · 건너뜀 ${skipped} · ${fmtDur((Date.now() - t0) / 1000)}`);

  // 6) 규격 검사 → 이어붙이기
  const uni = WB.checkUniform(results.filter((r) => r && r.width));
  if (!uni.ok) return { ok: false, error: uni.error };
  const output = path.join(outRoot, `${baseName}_whiteboard.mp4`);
  const m = await withAbort(isAborted, (sig) => WB.mergeScenes({ inputs: results.map((r) => r.output), outputPath: output, abortSignal: sig }));
  if (!m.ok) return { ok: false, error: `이어붙이기 실패 — ${m.error}` };

  // 7) 🔊 음성 얹기(5단계)
  //   ⚠ 여기서 실패해도 **던지지 않는다** — 무음 MP4 라도 남기는 편이 30분 렌더를 버리는 것보다 낫다.
  let audio = { ok: false, error: '건너뜀' };
  if (opts.withAudio !== false) {
    const byNum = sentenceAudioMap(project);
    const scenesForAudio = jobs.map((j) => ({
      video: j.out,
      audios: (j.scene.sentenceNums || []).map((n) => byNum.get(n)).filter(Boolean),
    }));
    const missing = scenesForAudio.filter((sc) => !sc.audios.length).length;
    if (missing) {
      audio = { ok: false, error: `음성이 없는 장면 ${missing}개` };
      log(`⚠ 음성을 얹지 못했습니다 — ${audio.error}. 「🎤 TTS」를 만든 뒤 다시 누르면 얹힙니다(장면 렌더는 건너뜁니다).`);
    } else {
      audio = await withAbort(isAborted, (sig) => deps.WA().attachAudio({
        videoPath: output, scenes: scenesForAudio, tmpDir: wbDir, log, abortSignal: sig,
      }));
      if (!audio.ok) log(`⚠ 음성 얹기 실패 — ${audio.error} (무음 MP4 는 그대로 남깁니다)`);
    }
  }

  // 8) 💬 자막 — `.srt` 는 **언제나** 옆에 남기고, 스위치가 켜져 있으면 영상에도 굽는다.
  //   ⚠ 굽기는 재인코딩이라 비싸다(1920 22분 = 수 분). 실패해도 영상은 그대로 둔다.
  //   🔑 **구웠으면 `.srt` 이름을 바꾼다** — 영상과 같은 이름이면 플레이어가 자동으로 켜서 **자막이 두 줄로 겹친다**.
  const WS = deps.WS();
  let srtPath = null, subtitle = { ok: false, error: '건너뜀' };
  if (opts.withSubtitle !== false) {
    const scForSub = WS.scenesForSubtitle(project, plan.scenes);
    const cues = WS.buildCues(scForSub, { maxChars: opts.captionMaxChars || 7, sceneDurations: (audio && audio.durations) || [] });
    if (cues.length) {
      const burn = opts.burnSubtitle !== false;
      // 굽는 경우엔 플레이어가 자동으로 물지 않는 이름으로(영상 basename 과 달라야 한다).
      srtPath = path.join(outRoot, `${baseName}_whiteboard${burn ? '_유튜브자막' : ''}.srt`);
      const srt = WS.srtFromCues(cues);
      try { fs.writeFileSync(srtPath, srt, 'utf8'); log(`📄 자막 파일 — ${path.basename(srtPath)}`); }
      catch (e) { srtPath = null; log(`⚠ 자막 파일을 쓰지 못했습니다 — ${e.message}`); }
      // 예전 이름(영상과 같은 basename)이 남아 있으면 치운다 — 그게 「자막 두 줄」의 원인이다.
      if (burn) {
        const legacy = path.join(outRoot, `${baseName}_whiteboard.srt`);
        try { if (fs.existsSync(legacy) && legacy !== srtPath) { fs.rmSync(legacy, { force: true }); log('🧹 옛 자막 파일을 치웠습니다(영상과 같은 이름이면 플레이어가 자동으로 띄워 자막이 겹칩니다)'); } } catch (_) {}
      }
      if (burn) {
        const rr = results.find((r) => r && r.height) || {};
        log('💬 자막을 영상에 굽는 중… (영상을 다시 인코딩합니다 — 길이에 비례해 몇 분 걸릴 수 있습니다)');
        subtitle = await withAbort(isAborted, (sig) => WS.burnSubtitle({
          videoPath: output, cues, tmpDir: wbDir, width: rr.width || 0, height: rr.height || cap,
          style: opts.subtitleStyle || null, log, abortSignal: sig,
        }));
        if (!subtitle.ok) log(`⚠ 자막 굽기 실패 — ${subtitle.error} (영상은 그대로 두었습니다 · .srt 는 남아 있습니다)`);
      } else { subtitle = { ok: false, error: '굽기 꺼짐(.srt 만)' }; }
    } else { log('⚠ 자막으로 만들 문장이 없습니다'); }
  }

  // 9) 📁 완성물만 최종 폴더로 옮긴다(채널의 「화이트보드 출력」). 못 옮기면 작업 폴더에 그대로 둔다.
  let finalOut = output, finalSrt = srtPath;
  if (opts.finalDir && path.resolve(opts.finalDir) !== path.resolve(outRoot)) {
    const moved = moveFinals([output, srtPath].filter(Boolean), opts.finalDir, log);
    if (moved.ok) {
      finalOut = moved.map.get(output) || output;
      if (srtPath) finalSrt = moved.map.get(srtPath) || srtPath;
      log(`📁 완성물을 옮겼습니다 → ${opts.finalDir}`);
    }
  }

  const tail = (audio.ok ? '🔊 음성 포함' : '⚠ 무음') + (subtitle.ok ? ' · 💬 자막 포함' : (finalSrt ? ' · 📄 .srt 별도' : ''));
  log(`✅ 화이트보드 MP4 — ${path.basename(finalOut)} (장면 ${jobs.length}개 · ${fmtDur(plan.totalSec)}) ${tail}`);
  return { ok: true, output: finalOut, dir: path.dirname(finalOut), wbDir, sceneCount: jobs.length, rendered, skipped, totalSec: plan.totalSec,
    hasAudio: !!audio.ok, audioError: audio.ok ? null : audio.error,
    srtPath: finalSrt, hasSubtitle: !!subtitle.ok, subtitleError: subtitle.ok ? null : subtitle.error };
}

/**
 * 완성 파일들을 다른 폴더로 **옮긴다**(복사가 아니라 이동 — 같은 결과물을 두 곳에 두면 디스크만 먹는다).
 * ⚠ `renameSync` 는 드라이브가 다르면 `EXDEV` 로 실패한다(G: → C:\Downloads) → 그때만 복사 후 지운다.
 * 어떤 경우에도 던지지 않는다 — 옮기기에 실패해도 파일은 작업 폴더에 멀쩡히 있다.
 */
function moveFinals(files, dir, log = () => {}) {
  const map = new Map();
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch (e) { log(`⚠ 화이트보드 출력 폴더를 만들 수 없어 작업 폴더에 둡니다 — ${e.message}`); return { ok: false, map }; }
  for (const src of files) {
    const dst = path.join(dir, path.basename(src));
    try {
      try { fs.renameSync(src, dst); }
      catch (e) {
        if (e.code !== 'EXDEV') throw e;
        fs.copyFileSync(src, dst);
        fs.rmSync(src, { force: true });
      }
      map.set(src, dst);
    } catch (e) { log(`⚠ ${path.basename(src)} 를 옮기지 못했습니다 — ${e.message} (작업 폴더에 그대로 있습니다)`); }
  }
  return { ok: map.size > 0, map };
}

module.exports = { planWhiteboard, runWhiteboard, moveFinals, imageChanged, imageForScene, sentenceAudioMap, estimateRenderSec, annotationStale, prepareAnnotation, fmtDur };
