'use strict';

/**
 * whiteboard-scenes.test.js — 장면 계획 + 주석 생성 검증 (2단계).
 *   ⚠ 원문 모듈을 require 해서 돌린다. 실행: npm run test:whiteboard
 *
 * 🔑 A/B 역검증(수동, 실제로 돌려 확인): `enforceMinDuration` 을 항등함수로 바꾸면 [2] 2건,
 *   `sceneDurationMs` 를 `lastEnd + 500` 으로 되돌리면 [4] 2건이 실패한다.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const S = require('../core/whiteboard-scenes');
const A = require('../core/whiteboard-annotation');
const W = require('../core/whiteboard-render');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log(`  ❌ ${m}`); } };
const eq = (a, b, m) => ok(a === b, `${m} — 기대 ${JSON.stringify(b)} 실제 ${JSON.stringify(a)}`);
const head = (t) => console.log(`\n${t}`);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wbsc-'));
const EX_PNG = 'D:\\화이트보드\\examples\\scene-01-agent-flow.png';

const mk = (n, d, t) => ({ num: n, text: t || `문장${n}`, ttsDurationSec: d });
const grp = (num, ds, extra) => ({ num, title: null, h2Title: null, _s: ds.map((d, i) => mk(num * 100 + i + 1, d)), ...(extra || {}) });
const proj = (groups) => ({ groups, getSentencesOfGroup: (g) => g._s });
const secs = (b) => b.reduce((a, s) => a + s.ttsDurationSec, 0);

// ── [1] element 예산 ────────────────────────────────────────────────────────
head('[1] element 예산 — 문장 수가 아니라 시간으로');
eq(S.elementBudget(31.6), 5, '중앙값 31.6초 → 5');
eq(S.elementBudget(6), 1, '6초 → 1');
eq(S.elementBudget(103), 5, '103초도 목표 상한 5 를 넘지 않는다');
eq(S.elementBudget(1), 1, '아주 짧아도 최소 1');
ok(S.ELEM_TARGET_MAX <= S.ELEM_MAX, '목표 상한 ≤ 절대 상한(6은 상한이지 목표가 아니다)');

// ── [2] 묶기 — 최소 시간이 개수보다 우선 ────────────────────────────────────
head('[2] 문장 묶기');
{
  const eight = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => mk(n, 4));
  const b = S.bucketSentences(eight, 4);
  eq(b.length, 4, '8문장 → 4묶음');
  ok(b.every((x) => secs(x) === 8), '고르게 나뉜다');
  eq(b.flat().length, 8, '문장이 사라지지 않는다');
  ok(b.flat().every((s, i) => s.num === i + 1), '순서가 유지된다');

  eq(S.bucketSentences([mk(1, 4), mk(2, 4), mk(3, 4)], 5).length, 3, '문장보다 많이 나눌 수는 없다');

  // 🔴 길이가 들쭉날쭉하면 1초짜리 묶음이 생긴다 → 최소 시간으로 흡수해야 한다
  const lop = [mk(1, 1), mk(2, 1), mk(3, 10), mk(4, 1), mk(5, 1)];
  const raw = S.bucketSentences(lop, 3);
  ok(raw.some((x) => secs(x) < S.ELEM_MIN_SEC), '(전제) 그리디만으로는 최소 시간을 못 지킨다');
  const fixed = S.enforceMinDuration(raw);
  ok(fixed.every((x) => secs(x) >= S.ELEM_MIN_SEC), '흡수 후에는 전부 최소 시간 이상');
  eq(fixed.flat().map((s) => s.num).join(','), '1,2,3,4,5', '흡수해도 문장·순서 보존');
}

// ── [3] 장면 계획 — 결정론 ──────────────────────────────────────────────────
head('[3] 장면 계획');
{
  const p1 = proj([grp(1, [8, 7, 9, 6])]);
  const r = S.planScenes(p1);
  eq(r.scenes.length, 1, '30초 그룹은 그대로 한 장면');
  eq(r.scenes[0].groupNums.join(','), '1', '그룹 번호 보존');

  // 긴 그룹 분할
  const long = S.planScenes(proj([grp(1, Array(10).fill(10))]));   // 100초
  ok(long.scenes.length >= 3, `100초 그룹은 쪼개진다 (${long.scenes.length}장면)`);
  ok(long.scenes.every((s) => s.durationSec <= S.SPLIT_OVER_SEC), '쪼갠 뒤 전부 45초 이하');
  ok(long.scenes.every((s) => s.groupNums.join(',') === '1'), '쪼개도 원본 그룹 번호를 잃지 않는다');
  eq(long.summary.split, long.scenes.length - 1, '분할 횟수가 요약에 잡힌다');

  // 짧은 조각 병합
  const shortP = S.planScenes(proj([grp(1, [20]), grp(2, [2])]));
  eq(shortP.scenes.length, 1, '2초 그룹은 앞에 붙는다');
  eq(shortP.scenes[0].groupNums.join('+'), '1+2', '병합된 그룹 번호가 함께 남는다');
  eq(shortP.summary.merged, 1, '병합 횟수가 요약에 잡힌다');

  // 첫 장면이 짧으면 붙일 앞이 없다 — 그대로 둔다(막지 않는다)
  eq(S.planScenes(proj([grp(1, [2]), grp(2, [20])])).scenes.length, 2, '첫 조각은 붙일 앞이 없어 유지');

  // 🔑 결정론 — 같은 입력이면 항상 같은 결과(캐시가 사는 조건)
  const a = JSON.stringify(S.planScenes(proj([grp(1, [8, 7, 9, 6]), grp(2, Array(8).fill(9))])).scenes);
  const b = JSON.stringify(S.planScenes(proj([grp(1, [8, 7, 9, 6]), grp(2, Array(8).fill(9))])).scenes);
  eq(a, b, '두 번 돌려도 같은 장면 계획');

  // 문장 없는 그룹은 장면이 아니다
  eq(S.planScenes(proj([{ num: 1, _s: [] }, grp(2, [10])])).scenes.length, 1, '빈 그룹은 건너뛴다');
}

// ── [4] 타이밍 — 낭독 구간 = 드로잉 구간 ────────────────────────────────────
head('[4] 타이밍 · A/V 싱크');
{
  const sc = S.planScenes(proj([grp(1, [3.2, 4.8, 3.0, 4.5])])).scenes[0];
  eq(sc.elements.length, 4, '4개 영역');
  eq(sc.elements[0].startMs, 0, '첫 영역은 0ms 에서 시작(음성도 0에서 시작)');
  const gaps = sc.elements.slice(1).map((e, i) => e.startMs - (sc.elements[i].startMs + sc.elements[i].durationMs));
  ok(gaps.every((g) => g === S.GAP_MS), `영역 사이 간격이 전부 ${S.GAP_MS}ms — ${gaps}`);

  const fake = { canvas: { width: 100, height: 100 }, regions: sc.elements.map(() => ({ region: { x: 0, y: 0, width: 60, height: 40 }, direction: 'left_to_right' })) };
  const ann = A.buildAnnotation(sc, fake);
  const tts = Math.round(sc.durationSec * 1000);
  // 🔴 SKILL.md 관례(마지막 종료 + 0.5초)를 쓰면 장면마다 길어져 50장면에 10초가 밀린다
  eq(ann.sceneDurationMs, tts, '장면 길이 = TTS 합 (A/V 싱크)');
  const lastEnd = Math.max(...ann.elements.map((e) => e.reveal.startMs + e.reveal.durationMs));
  ok(ann.sceneDurationMs - lastEnd === S.GAP_MS, '여운은 마지막 영역이 일찍 끝나며 자연히 생긴다');
  ok(ann.elements.every((e) => e.reveal.startMs + e.reveal.durationMs <= ann.sceneDurationMs), '어떤 영역도 장면을 넘지 않는다');

  // 자막은 문장 묶음 — 렌더러가 안 쓰므로 길이 규칙이 없다
  ok(ann.elements.every((e) => typeof e.subtitle === 'string'), '자막이 문자열로 들어간다');
  eq(ann.elements[0].id, 'e1', 'element id');
  ok(Array.isArray(ann.elements[0].reveal.protectedRegions), 'protectedRegions 자리는 비워 둔다');
  eq(ann._priming.groupNums.join(','), '1', '어느 그룹에서 왔는지 남긴다(추적용)');
}

// ── [5] 관문 A — 계획 요약·경고 ─────────────────────────────────────────────
head('[5] 관문 A 요약');
{
  const r = S.planScenes(proj([grp(1, [3]), grp(2, [8, 7, 9, 6]), grp(3, [60])]));
  ok(/장면 계획/.test(r.summary.lines[0]), '첫 줄이 계획 요약');
  ok(r.summary.lines.length >= 4, '장면마다 한 줄');
  ok(r.summary.warnings.some((w) => /1개뿐/.test(w)), '영역 1개짜리를 경고한다');
  ok(r.summary.warnings.some((w) => /20초를 넘는/.test(w)), '너무 느린 영역을 경고한다');
  ok(r.summary.warnings.some((w) => /45초를 넘는 장면/.test(w)), '더 못 쪼갠 장면을 경고한다');
}

// ── [6] 겹치는 영역 감지 ────────────────────────────────────────────────────
head('[6] 삼켜진 영역');
{
  const e = (seq, x, y, w, h) => ({ sequence: seq, region: { x, y, width: w, height: h } });
  eq(JSON.stringify(A.findSwallowed([e(1, 0, 0, 100, 100), e(2, 200, 0, 100, 100), e(3, 10, 10, 50, 50)])),
    JSON.stringify([{ seq: 3, insideOf: 1 }]), '앞 영역에 들어간 것을 찾는다');
  eq(A.findSwallowed([e(1, 0, 0, 100, 100), e(2, 200, 0, 100, 100)]).length, 0, '안 겹치면 조용하다');
  eq(A.findSwallowed([e(1, 0, 0, 100, 100)]).length, 0, '하나뿐이면 비교 대상이 없다');
}

// ── [7] 주석 경로·삭제 ──────────────────────────────────────────────────────
head('[7] 주석 파일 규약');
{
  const p = A.annotationPathFor(path.join('media-1', '01.png'));
  eq(path.basename(p), '01.annotation.json', '같은 이름 짝 (엔진·preview.html 규약)');
  eq(path.dirname(p), 'media-1', '그림 옆에 둔다');
  eq(path.basename(A.annotationPathFor('x/07.JPG')), '07.annotation.json', '대문자 확장자도 처리');
}

// ── [8] 실제 왕복 (venv + 예제 그림이 있을 때만) ────────────────────────────
head('[8] 영역 초안 · 주석 왕복');
(async () => {
  if (!W.hasEnv() || !fs.existsSync(EX_PNG)) { console.log('  ⏭ .venv 또는 예제 PNG 가 없어 건너뜀'); return done(); }
  const img = path.join(TMP, '01.png');
  fs.copyFileSync(EX_PNG, img);

  const d = await A.draftRegions(img, 4);
  ok(d.ok, `영역 초안 (${d.error || ''})`);
  if (d.ok) {
    eq(d.regions.length, 4, '요청한 개수만큼 낸다(큰 덩어리를 갈라서라도)');
    eq(d.canvas.width, 1672, 'canvas 폭이 원본 픽셀');
    ok(d.regions.every((r) => r.inkPixels > 0), '모든 영역에 먹선이 있다(빈 영역은 그릴 게 없다)');
    ok(d.regions.every((r) => r.region.x >= 0 && r.region.y >= 0
      && r.region.x + r.region.width <= d.canvas.width
      && r.region.y + r.region.height <= d.canvas.height), '영역이 캔버스 안에 있다');
    // 결정론 — 같은 그림이면 같은 영역
    const d2 = await A.draftRegions(img, 4);
    eq(JSON.stringify(d2.regions), JSON.stringify(d.regions), '두 번 돌려도 같은 영역');
  }

  const sc = S.planScenes(proj([grp(1, [3.2, 4.8, 3.0, 4.5])])).scenes[0];
  const logs = [];
  const w1 = await A.writeAnnotation(sc, img, { log: (m) => logs.push(m) });
  ok(w1.ok && !w1.skipped, `주석 생성 (${w1.error || ''})`);
  ok(fs.existsSync(w1.path), '파일이 실제로 있다');
  ok(W.checkCanvas(img, w1.path).ok, '생성 직후 canvas 검사를 통과한다');

  // 🔑 있으면 건너뛴다 — 사람이 고친 것을 덮지 않는다
  const before = fs.readFileSync(w1.path, 'utf8');
  fs.writeFileSync(w1.path, before.replace('"x": ', '"x":'));      // 사람이 고친 것처럼 바꿔 둔다
  const marked = fs.readFileSync(w1.path, 'utf8');
  const w2 = await A.writeAnnotation(sc, img);
  ok(w2.skipped === true, '두 번째 호출은 건너뛴다');
  eq(fs.readFileSync(w1.path, 'utf8'), marked, '손댄 내용이 그대로 남는다');

  // force 면 다시 만들고 **경고**를 남긴다
  const logs2 = [];
  const w3 = await A.writeAnnotation(sc, img, { force: true, log: (m) => logs2.push(m) });
  ok(w3.ok && !w3.skipped, 'force 면 다시 만든다');
  ok(logs2.some((m) => /사라집니다/.test(m)), '덮어쓸 때 경고한다');

  // 「🗑 이미지 삭제」와 함께 주석도 지운다
  ok(A.removeAnnotation(img) === true, '주석 삭제');
  ok(!fs.existsSync(w1.path), '실제로 지워졌다');
  ok(A.removeAnnotation(img) === false, '없으면 false (던지지 않는다)');
  done();
})();

function done() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${fail ? '❌' : '✅'} whiteboard-scenes: ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
}
