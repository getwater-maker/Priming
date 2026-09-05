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
 * ⚠ 결과물은 **무음**이다(5단계 오디오·자막 mux 전). 로그·반환값에 그 사실을 남긴다.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DEPS = {
  WB: () => require('./whiteboard-render'),
  ANN: () => require('./whiteboard-annotation'),
  SC: () => require('./whiteboard-scenes'),
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
  lines.push('ⓘ 결과 MP4 는 아직 무음입니다(오디오·자막 얹기는 5단계). 3단계 전이라 그림은 기존 화풍 그대로 씁니다.');
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
    if (ann && !annotationStale(ann, scene)) {
      const chk = WB.checkCanvas(imagePath, annPath);
      if (!chk.ok) return { ok: false, error: chk.error };
      return { ok: true, path: annPath, kept: true };
    }
    if (ann && Array.isArray(ann.elements) && ann.elements.length && ann.canvas) {
      const drafted = { canvas: ann.canvas, regions: ann.elements.map((e) => ({ region: e.region, direction: e.reveal && e.reveal.direction })) };
      const next = ANN.buildAnnotation(scene, drafted);
      try { fs.writeFileSync(annPath, JSON.stringify(next, null, 2), 'utf8'); }
      catch (e) { return { ok: false, error: `주석을 쓰지 못했습니다: ${e.message}` }; }
      const chk = WB.checkCanvas(imagePath, annPath);
      if (!chk.ok) return { ok: false, error: chk.error };
      log(`  ♻ 장면 ${PAD(scene.num)} 주석 타이밍 갱신 (문장·길이가 바뀜 — 영역은 그대로)`);
      return { ok: true, path: annPath, refreshed: true };
    }
    // 깨진 주석 → 새로 만든다(아래로)
    log(`  ⚠ 장면 ${PAD(scene.num)} 주석이 깨져 있어 새로 만듭니다 (${path.basename(annPath)})`);
    try { fs.unlinkSync(annPath); } catch (_) {}
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
    if (a.created) created++; else if (a.refreshed) refreshed++; else kept++;
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
  log(`✅ 화이트보드 MP4 — ${path.basename(output)} (장면 ${jobs.length}개 · ${fmtDur(plan.totalSec)}) ⚠ 무음입니다(5단계 전)`);
  return { ok: true, output, wbDir, sceneCount: jobs.length, rendered, skipped, totalSec: plan.totalSec };
}

module.exports = { planWhiteboard, runWhiteboard, imageForScene, estimateRenderSec, annotationStale, prepareAnnotation, fmtDur };
