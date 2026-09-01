'use strict';

/**
 * whiteboard-render.test.js — 화이트보드 렌더 배관 검증.
 *   ⚠ 로직을 복사하지 않고 **원문 모듈을 require 해서 돌린다**(복사본을 두면 앱과 갈라져도 통과한다).
 *   실행: npm run test:whiteboard
 *
 * 🔑 A/B 역검증(수동): `checkCanvas` 를 `return { ok: true }` 로 무력화하면 [2] 2건이 실패하고,
 *   `RE_ELEM` 을 지우면 [3] 2건이 실패한다. 둘 다 실제로 돌려 확인했다.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const W = require('../core/whiteboard-render');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log(`  ❌ ${msg}`); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — 기대 ${JSON.stringify(b)} 실제 ${JSON.stringify(a)}`);
const head = (t) => console.log(`\n${t}`);

const ROOT = path.join(__dirname, '..');
const WB = path.join(ROOT, 'whiteboard');
const EX_ANN = path.join(WB, 'examples', 'scene-01-agent-flow.annotation.json');
const UPSTREAM = 'D:\\화이트보드';
const EX_PNG = path.join(UPSTREAM, 'examples', 'scene-01-agent-flow.png');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wbtest-'));

// ── [1] 벤더링 구조 ─────────────────────────────────────────────────────────
head('[1] 벤더링 구조');
const PY_FILES = ['merge_scenes.py', 'parse_srt.py', 'prepare_env.py',
  'render_annotation_preview.py', 'render_stream_whiteboard.py', 'stream_render.py'];
for (const f of PY_FILES) ok(fs.existsSync(path.join(WB, 'py', f)), `py/${f} 존재`);
ok(fs.existsSync(path.join(WB, 'assets', 'drawing-hand.png')), 'assets/drawing-hand.png 존재');
ok(fs.existsSync(path.join(WB, 'assets', 'preview.html')), 'assets/preview.html 존재');
ok(fs.existsSync(path.join(WB, 'LICENSE')), 'LICENSE 존재 (MIT 고지 유지 의무)');
ok(fs.existsSync(EX_ANN), 'examples 주석 존재');

// 🔴 파이썬 폴더를 'scripts' 로 두면 매니페스트가 **이름만 보고** 통째로 걸러 다른 PC 에 안 내려간다.
ok(!fs.existsSync(path.join(WB, 'scripts')), "whiteboard/scripts 가 없어야 한다(매니페스트가 'scripts' 를 제외한다)");
// ⚠ 파이썬이 `Path(__file__).parent.parent` 를 스킬 루트로 본다 → py/ 와 assets/ 는 형제여야 한다.
ok(fs.existsSync(path.join(WB, 'py')) && fs.existsSync(path.join(WB, 'assets')), 'py/ 와 assets/ 가 형제');

// 🔴 .venv(263MB)가 매니페스트에 섞이면 GitHub 로 올라가 **모든 PC 가 받는다**.
const genManifest = fs.readFileSync(path.join(ROOT, 'scripts', 'gen-manifest.js'), 'utf8');
const dirLine = genManifest.split('\n').find((l) => l.includes('EXCLUDE_DIR_NAMES = new Set'));
ok(!!dirLine && dirLine.includes("'.venv'"), 'gen-manifest 가 .venv 를 제외한다');

// 소스 위생 — NUL 바이트(Write 도구가 넣은 적이 있다)
const src = fs.readFileSync(path.join(ROOT, 'core', 'whiteboard-render.js'));
ok(!src.includes(0x00), 'whiteboard-render.js 에 NUL 바이트 없음');

// ── [2] 주석 ↔ 그림 크기 검사 (fail-closed) ─────────────────────────────────
head('[2] canvas 검사 — fail-closed');
if (fs.existsSync(EX_PNG)) {
  const good = W.checkCanvas(EX_PNG, EX_ANN);
  ok(good.ok, 'GOOD: 예제는 크기가 맞는다');
  eq(good.w, 1672, 'GOOD: 폭'); eq(good.h, 941, 'GOOD: 높이'); eq(good.elements, 4, 'GOOD: element 수');

  const bad = path.join(TMP, 'bad.annotation.json');
  const j = JSON.parse(fs.readFileSync(EX_ANN, 'utf8'));
  j.canvas = { width: 999, height: 888 };
  fs.writeFileSync(bad, JSON.stringify(j));
  const r = W.checkCanvas(EX_PNG, bad);
  ok(r.ok === false, 'BAD: 크기가 다르면 막는다');
  ok(/999x888/.test(r.error || '') && /1672x941/.test(r.error || ''), 'BAD: 오류에 양쪽 크기가 다 나온다');

  const noCanvas = path.join(TMP, 'nocanvas.json');
  fs.writeFileSync(noCanvas, JSON.stringify({ elements: [] }));
  ok(W.checkCanvas(EX_PNG, noCanvas).ok === false, 'canvas 필드가 없으면 막는다');
  ok(W.checkCanvas(EX_PNG, path.join(TMP, '없는파일.json')).ok === false, '주석이 없으면 막는다');
} else {
  console.log('  ⏭ 상류 예제 PNG 가 없어 건너뜀 (다른 PC)');
}
ok(W.checkCanvas(path.join(TMP, '없는그림.png'), EX_ANN).ok === false, '그림이 없으면 막는다');

// ── [3] 진행률 파싱 ─────────────────────────────────────────────────────────
head('[3] 진행률');
{
  const seen = [];
  const t = W.makeProgressTracker(4, (p) => seen.push(p));
  ['  영역 진행: 1/4', '무관한 줄', '  영역 진행: 2/4', '  영역 진행: 4/4'].forEach(t);
  // 「영역 k 시작」이므로 완료분은 k-1. 무관한 줄에는 콜백을 부르지 않는다.
  eq(JSON.stringify(seen), JSON.stringify([0, 25, 75]), '영역 기반 진행률');

  const s2 = [];
  const t2 = W.makeProgressTracker(0, (p) => s2.push(p));
  t2('  영역 진행: 3/10');                       // 개수를 안 넘겨도 줄에서 총량을 읽는다
  eq(s2[0], 20, '총량을 줄에서 읽는다');

  const s3 = [];
  const t3 = W.makeProgressTracker(2, (p) => s3.push(p));
  t3('  선 긋기 진행: 45%');                     // 다른 진입점 폴백
  eq(s3[0], 45, '단계 기반 폴백');

  const s4 = [];
  W.makeProgressTracker(4, (p) => s4.push(p))('OUTPUT=C:\\x.mp4');
  eq(s4.length, 0, '100% 를 임의로 만들지 않는다(OUTPUT 은 호출부가 판정)');
}

// ── [4] 장면 규격 일치 (merge 전) ───────────────────────────────────────────
head('[4] 장면 규격 일치');
{
  const a = { output: 'a.mp4', width: 1920, height: 1080, fps: 30 };
  const b = { output: 'b.mp4', width: 1920, height: 1080, fps: 30 };
  const c = { output: 'c.mp4', width: 640, height: 360, fps: 30 };
  ok(W.checkUniform([a, b]).ok, '같은 규격이면 통과');
  const r = W.checkUniform([a, c]);
  ok(r.ok === false, '해상도가 섞이면 막는다(-c copy 무손실 병합이 깨진다)');
  ok(/c\.mp4/.test(r.error || ''), '어느 장면이 다른지 알려준다');
  ok(W.checkUniform([a, { ...b, fps: 60 }]).ok === false, 'fps 가 다르면 막는다');
  ok(W.checkUniform([]).ok, '빈 목록은 통과(막을 게 없다)');
}

// ── [5] 벤더링본 == 상류 ────────────────────────────────────────────────────
head('[5] 벤더링본이 상류와 같은가');
if (fs.existsSync(UPSTREAM)) {
  const sha = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
  for (const f of PY_FILES) {
    eq(sha(path.join(WB, 'py', f)), sha(path.join(UPSTREAM, 'scripts', f)), `${f} 가 상류와 동일`);
  }
} else {
  console.log('  ⏭ 상류 폴더가 없어 건너뜀 (다른 PC — 벤더링본만 있으면 동작한다)');
}

// ── [6] 폰트 패치가 살아 있는가 (한글 라벨) ─────────────────────────────────
head('[6] 확인 그림 폰트');
{
  const s = fs.readFileSync(path.join(WB, 'py', 'render_annotation_preview.py'), 'utf8');
  ok(s.includes('_FONT_CANDIDATES'), '폰트 후보 순회가 있다');
  ok(s.includes('malgun.ttf'), '맑은 고딕이 후보에 있다(한글 커버)');
  ok(!/font_file\s*=\s*"C:\/Windows\/Fonts\/msyh\.ttc"/.test(s), '중국어 폰트 하드코딩이 사라졌다');
  ok(s.includes('load_default'), '어느 폰트도 없으면 기본 폰트로라도 그린다(fail-open)');
}

// ── [7] 실제 렌더 (venv 가 있을 때만) ───────────────────────────────────────
head('[7] 실제 렌더 왕복');
(async () => {
  if (!W.hasEnv()) { console.log('  ⏭ .venv 가 없어 건너뜀 (ensureEnv 로 만든다)'); return done(); }
  if (!fs.existsSync(EX_PNG)) { console.log('  ⏭ 예제 PNG 가 없어 건너뜀'); return done(); }
  const out = path.join(TMP, 'scene.mp4');
  const seen = [];
  const r = await W.renderScene({
    imagePath: EX_PNG, annotationPath: EX_ANN, outputPath: out,
    capLongEdge: 640, onProgress: (p) => seen.push(p),
  });
  ok(r.ok, `렌더 성공 (${r.error || ''})`);
  if (r.ok) {
    ok(fs.existsSync(r.output), '결과 파일이 실제로 존재한다');
    eq(r.width, 640, '출력 폭'); eq(r.height, 360, '출력 높이');
    ok(seen.length >= 3, `진행률이 실제로 올라온다 (${seen.length}회)`);
  }
  // 실패 경로 — 없는 그림이면 렌더까지 가지 않고 canvas 검사에서 막힌다
  const bad = await W.renderScene({ imagePath: path.join(TMP, 'x.png'), annotationPath: EX_ANN, outputPath: out });
  ok(bad.ok === false, '없는 그림이면 실패로 돌려준다');
  done();
})();

function done() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${fail ? '❌' : '✅'} whiteboard-render: ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
}
