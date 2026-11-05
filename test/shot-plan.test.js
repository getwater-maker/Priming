'use strict';
/**
 * node test/shot-plan.test.js — 🎞 ⑱ 샷 나누기 · 속도 상한 · 겹침 전환 + ㉕ 정지 8초(2.0 덧붙임5 52 · core/shot-plan)
 *   [1] 계획(순수) — 30초 그림 = 샷 4개 이상 · 같은 움직임 연달아 0 · 속도 상한 · 칸 없음 = 구간 그대로
 *   [2] 실물 렌더 — 낭독 30초 장면 하나 → MP4 · 샷 ≥ 4 · 겹침 전환 · freezedetect 정지 0 · 검수 판 칸 = 샷마다
 *   [3] 칸 없는 렌더 = 예전 그대로(샷 계획 없음 · 결과에 shots 칸 없음) — 바이트 비교는 test:nodirective
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const SP = require('../core/shot-plan');
const KB = require('../core/ken-burns');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const RS = require('../core/review-sheet');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

console.log('[1] 계획');
{
  ok(SP.parseShots(null).shots === null, '칸 없음 = null');
  const d = SP.parseShots({}).shots;
  ok(d && d.maxSec === 20 && d.transSec === 0.7 && d.zoomPerSec === 0.008 && d.panPerSec === 0.01, '빈 객체 = 기본값(샷 최장 20 · 전환 0.7 · 확대 0.008 · 이동 1%)');
  ok(SP.parseShots({ maxSec: 8 }).shots.maxSec === 8, '샷 최장 8초를 받는다(㉕)');
  ok(/maxSec/.test(SP.parseShots({ maxSec: 30 }).error) && /모르는 칸/.test(SP.parseShots({ max: 8 }).error), '범위 밖 · 모르는 칸 거절');
  const seg = (start, end, kbIdx, file) => { const tr = { trackId: 't' + start, kenburnsAnimationInfo: kbIdx == null ? undefined : KB.KEN_BURNS_PATTERNS[kbIdx] }; return { start, end, type: 'image', file, track: tr, layers: [{ file, track: tr, t0: start, tAll: end - start, type: 'image' }] }; };
  const segs = [seg(0, 30, 0, 'a.png'), seg(30, 36, 0, 'b.png'), seg(36, 50, null, 'c.png')];
  const o = SP.parseShots({ maxSec: 8 }).shots;
  const pl = SP.planShots(segs, o, () => true);
  const s0 = pl.shots.filter((x) => x.seg === 0);
  ok(s0.length >= 4, `30초 그림 → 샷 ${s0.length}개`);
  let same = 0; for (let i = 1; i < pl.shots.length; i++) if (pl.shots[i].kind === pl.shots[i - 1].kind && pl.shots[i].kind !== 'none') same++;
  ok(same === 0, `같은 움직임 연달아 0 (${pl.shots.map((x) => x.kind).join(' → ')})`);
  const two = SP.planShots([seg(0, 6, 0, 'a.png'), seg(6, 12, 0, 'b.png')], o, () => true);
  ok(two.shots.length === 2 && two.shots[0].kind === 'in' && two.shots[1].kind !== 'in', `나누지 않는 두 그림이 둘 다 줌인이면 뒤 그림을 바꾼다(${two.shots.map((x) => x.kind).join(' → ')})`);
  ok(pl.shots.every((x) => x.end - x.start <= 8 + 1e-6), '샷 최장 ≤ 8초');
  const over = pl.segments.filter((x) => x.track && x.track.kenburnsAnimationInfo && x.track.kenburnsAnimationInfo.ease).map((x) => SP.speedOf(x.track.kenburnsAnimationInfo, x.end - x.start)).filter((v) => v.zoom > o.zoomPerSec + 1e-6 || v.pan > o.panPerSec + 1e-6);
  ok(!over.length, '모든 샷이 속도 상한 안(꼭대기 속도 = 평균 × 1.5 로 잼)');
  ok(pl.segments.every((x) => !x.track || !x.track.kenburnsAnimationInfo || x.track.kenburnsAnimationInfo.ease), '샷은 천천히 붙고 멎는다(ease)');
  ok(pl.still.length === 1 && pl.still[0].sec === 14 && /없음/.test(pl.still[0].what), '움직임 「없음」 그림은 나누지 않고 8초 넘으면 정지 목록에(14초)');
  const nd = SP.planShots(segs, o, () => false);
  ok(nd.shots.length === 0 && nd.segments.length === 3 && nd.segments[0] === segs[0], '나눌 수 없는 구간(겹친 그림 등)은 그대로');
  const f = R.kenBurnsFilter({ ...KB.KEN_BURNS_PATTERNS[0] }, 30);
  const fe = R.kenBurnsFilter({ ...KB.KEN_BURNS_PATTERNS[0], ease: true }, 30);
  ok(!/3-2\*/.test(f) && /3-2\*/.test(fe), 'ease 없는 .vrew 트랙은 예전 선형 필터 그대로 · ease 만 smoothstep');
  const pd = R.planDissolves(R.planChunks(pl.segments.slice(0, 4)), 0.7, null);
  ok(pd.dissolves >= 3, `같은 그림 안 샷 경계에도 겹침 전환(${pd.dissolves}곳)`);
}

(async () => {
  console.log('[2] 실물 렌더 — 낭독 30초 장면 하나');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  try {
    const raw = '# 시험\n\n## 도입부\n\n### 긴 장면\n\n> 🖼️ 이미지: test\n\n' + Array.from({ length: 6 }, (_, i) => `긴 장면의 ${i + 1}번째 문장입니다.`).join('\n\n') + '\n\n### 짧은 장면\n\n> 🖼️ 이미지: test2\n\n짧은 문장입니다.\n';
    const pr = P.parseScriptText(raw, 'longform', {}).projects[0];
    pr.groups.forEach((g, i) => { const img = path.join(tmp, `g${i}.png`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `mandelbrot=s=1344x768:start_scale=${i ? 1.5 : 3}`, '-frames:v', '1', img]); g.imagePath = img; });
    pr.sentences.forEach((s, i) => { const mp3 = path.join(tmp, `s${i}.mp3`); const dd = i < 6 ? 5 : 3; execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=f=${300 + 30 * i}:d=${dd}`, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', mp3]); s.ttsAudioPath = mp3; s.ttsDurationSec = dd; });
    ok(pr.groups.length === 2 && pr.getSentencesOfGroup(pr.groups[0]).length === 6, '장면 둘(30초 · 3초)');
    const vrew = path.join(tmp, 't.vrew');
    await P.buildProjectVrew(pr, vrew, {}, () => {}, 20, 1);
    const mp4 = path.join(tmp, 't.mp4');
    const logs = [];
    const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: (m) => logs.push(m), par: 3, dissolveSec: 0.7, shots: SP.parseShots({ maxSec: 8 }).shots, fx: null });
    ok(res.ok, '렌더 성공' + (res.ok ? '' : ' — ' + res.error));
    const long = (res.shots || []).filter((x) => x.seg === 0);
    ok(long.length >= 4, `30초 장면 → 샷 ${long.length}개(≥ 4)`);
    ok(res.transitions >= long.length, `겹침 전환 ${res.transitions}곳(샷 경계 ${long.length - 1} + 그림 경계 1)`);
    ok((res.still || []).length === 0, '렌더 계획의 8초 넘는 정지 0');
    const st = await RS.stillSpans(mp4);
    ok(st.length === 0, `프레임 차이로 잰 정지(2초 이상) ${st.length}곳${st.length ? ' — ' + st.map((x) => x.t0.toFixed(1) + '초 ' + x.sec + '초').join(', ') : ''}`);
    const spans = RS.sceneSpans(pr, new Map(), res.durationSec);
    const cells = RS.cellsOf(pr, spans, [], () => '', res.shots);
    ok(cells.filter((c) => c.kind === 'shot').length === res.shots.length && cells.every((c) => c.kind === 'shot'), `검수 판 칸 = 샷마다 하나(${cells.length}칸)`);
    ok(/G1 샷1\/\d/.test(cells[0].label), '칸 글 줄에 장면 · 샷 번호 · 움직임 · 틀(' + cells[0].label + ')');
    console.log('[3] 칸 없는 렌더');
    const mp4b = path.join(tmp, 'u.mp4');
    const rb = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4b, log: () => {}, par: 3, dissolveSec: 0, fx: null });
    ok(rb.ok && !('shots' in rb) && !('still' in rb) && rb.transitions === 0, '샷 계획 없음 · 전환 0(예전 그대로)');
    const stb = await RS.stillSpans(mp4b);
    ok(stb.length === 0 || stb.every((x) => x.sec < 8), `(참고) 칸 없는 렌더의 정지 ${stb.length}곳`);
  } catch (e) { ok(false, '실행 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
  console.log(`\n${fail ? '❌' : '✅'} shot-plan ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
