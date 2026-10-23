'use strict';
// node test/engine-migrate.test.js — 🔁 ComfyUI·Genspark 를 쓰지 않게 된 뒤(로이 2026-10-21 · v0.9.92)
//   옛 이미지·비디오 도구 값 → AI 이미지·AI 영상(core/engine-migrate 한 곳) · 채널 저장소가 바꿔 저장 · 화면·제작 입구가 같은 모듈을 쓰는지
const assert = require('assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const EM = require('../core/engine-migrate');
const KM = require('../core/kie-models');
let n = 0; const ok = (m) => { n++; console.log('✓ ' + m); };

// [1] 바꿀 모델이 AI 표에 실제로 있다(id 가 어긋나면 「(옛 설정)」 빈 값이 된다)
assert.ok(KM.byVal(EM.IMG_DEFAULT, 'image'), 'IMG_DEFAULT 가 AI 이미지 표에 없다');
assert.ok(KM.byVal(EM.VID_DEFAULT, 'video'), 'VID_DEFAULT 가 AI 영상 표에 없다');
ok('기본 AI 모델이 표에 있다');

// [2] 이미지
for (const v of ['comfy', 'comfy::C:/wf/image_qwen21_turbo.json', 'comfy::local::x.json', 'genspark', 'rotate', '', null, undefined]) {
  const m = EM.migrateImage(v); assert.equal(m.v, EM.IMG_DEFAULT, String(v)); assert.ok(m.from, String(v));
}
for (const v of ['kie:z-image', 'kie:gpt-image-2', 'gemini', 'gemini-batch', 'flow']) {
  const m = EM.migrateImage(v); assert.equal(m.v, v); assert.equal(m.from, '');
}
ok('이미지: ComfyUI·Genspark·빈 값만 바꾸고 AI·나노바나나·Flow 는 그대로');

// [3] 비디오 — 빈 값·「없음」은 그대로(조용히 유료 영상을 켜지 않는다)
for (const v of ['comfy', 'comfy::C:/wf/video_minimax_h3_ref2v_cloud.json', 'genspark']) {
  const m = EM.migrateVideo(v); assert.equal(m.v, EM.VID_DEFAULT, v); assert.ok(m.from);
}
for (const v of ['none', '', 'kie:kling-3', 'grok', 'flow']) {
  const m = EM.migrateVideo(v); assert.equal(m.v, v); assert.equal(m.from, '');
}
ok('비디오: ComfyUI·Genspark 만 바꾸고 없음·빈 값·AI 는 그대로');

// [4] 채널 저장소 — 임시 홈에서 옛 값이 든 채널 파일을 읽으면 바꿔 저장하고, 두 번째 읽기엔 바꿀 것이 없다
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'engmig-'));
fs.mkdirSync(path.join(HOME, '.flow-app'));
const store = path.join(HOME, '.flow-app', 'tts-presets.json');
fs.writeFileSync(store, JSON.stringify([
  { id: 'a', name: '가', engine: 'omnivoice', isDefault: true, imgEngine: 'comfy::x/image_qwen21_turbo.json', videoEngine: 'comfy::x/video_minimax_h3_ref2v_cloud.json' },
  { id: 'b', name: '나', engine: 'omnivoice', imgEngine: 'kie:z-image', videoEngine: 'none' },
  { id: 'c', name: '다', engine: 'omnivoice', imgEngine: 'genspark', videoEngine: 'genspark' },
  { id: 'd', name: '라', engine: 'omnivoice' },
]));
const kid = `const PS=require(${JSON.stringify(path.join(ROOT, 'tts/preset-store'))});PS.loadAll();const a=PS.takeEngineMigrations();PS.loadAll();const b=PS.takeEngineMigrations();console.log(JSON.stringify({a,b}));`;
const out = JSON.parse(cp.execFileSync(process.execPath, ['-e', kid], { env: { ...process.env, USERPROFILE: HOME, HOME }, encoding: 'utf8' }).trim().split('\n').pop());
assert.equal(out.a.length, 4, '바꾼 내역 4건(가 이미지·비디오, 다 이미지·비디오)');
assert.ok(out.a.every((c) => c.name === '가' || c.name === '다'));
assert.equal(out.b.length, 0, '두 번째 읽기에 또 바꿨다(저장이 안 됐다)');
const saved = JSON.parse(fs.readFileSync(store, 'utf8'));
assert.deepEqual(saved.map((p) => [p.imgEngine, p.videoEngine]), [[EM.IMG_DEFAULT, EM.VID_DEFAULT], ['kie:z-image', 'none'], [EM.IMG_DEFAULT, EM.VID_DEFAULT], [undefined, undefined]]);
fs.rmSync(HOME, { recursive: true, force: true });
ok('채널 저장소가 옛 값을 바꿔 저장(값 없는 채널은 건드리지 않음)');

// [5] 입구가 모두 같은 모듈을 거친다(소스 검사)
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
assert.match(main, /async function runRotatingImages\([^)]*\) \{\n  startEngine = _migImg\(startEngine, logger\);/, '이미지 입구');
assert.match(main, /async function _genGroupVideosCore\([^)]*\) \{\n  videoEngine = _migVid\(videoEngine\);/, '비디오 입구');
assert.match(main, /const engine = _migImg\(_engineArg\), videoEngine = _migVid\(_videoArg\);/, '⚡ 만들기 입구');
assert.match(main, /_logEngineMigrations\(PS\.takeEngineMigrations\(\)\)/, '시작 때 채널 바꾼 내역 로그');
const app = fs.readFileSync(path.join(ROOT, 'renderer/src/App.jsx'), 'utf8');
assert.doesNotMatch(app, /\|\| 'comfy'/, "화면에 옛 기본값 || 'comfy' 가 남았다");
assert.doesNotMatch(app, /'🎛 ComfyUI'|'🌐 브라우저'|settingsTab === 'comfy'|settingsTab === 'flow'/, 'ComfyUI·브라우저 탭이 남았다');
assert.doesNotMatch(app, /'🖥 Qwen-Image 2\.1 Turbo \(로컬\)'|'☁ MiniMax H3 레퍼런스 \(R2V\)'/, '목록에 ComfyUI 항목이 남았다');
assert.match(app, /const normImgEngine = \(v\) => EM\.migrateImage\(v\)\.v;/);
assert.match(app, /const normVideoEngine = \(v\) => EM\.migrateVideo\(/);
ok('main·화면 입구가 core/engine-migrate 를 거친다');

// [6] 👑 관리자 전용 🖥 로컬 Qwen-Image 2.1(v0.9.109) — 이전 규칙이 되돌리지 않고 · 화면은 관리자에게만 · main 은 회원이면 AI 이미지로
{
  const m = EM.migrateImage(EM.LOCAL_QWEN); assert.equal(m.v, EM.LOCAL_QWEN); assert.equal(m.from, '');
  const p = { imgEngine: EM.LOCAL_QWEN }; assert.equal(EM.migratePreset(p).length, 0); assert.equal(p.imgEngine, EM.LOCAL_QWEN);
  assert.ok(!EM.isComfy(EM.LOCAL_QWEN), 'comfy 꼴이면 위 이전 규칙에 걸린다');
  assert.match(app, /const localQwen = !isVid && owner;/, '화면 항목이 관리자 조건 뒤에 있지 않다');
  assert.equal((app.match(/<EngineOptions kind="image" owner=\{owner\}/g) || []).length, 2, '헤더·채널 편집 두 곳 모두 owner 를 넘겨야 한다');
  assert.match(main, /isLocalQwen\(startEngine\)\) \{\n    if \(isOwner\(\)\) \{/, '이미지 입구가 관리자인지 보지 않는다');
  assert.match(main, /return runComfyImages\([^\n]*, retryLevel, force, true\);/, '로컬 강제(forceLocal) 없이 부른다 — 설정 파일이 클라우드면 클라우드로 간다');
  assert.match(main, /function _imgUsesLocalGpu\(engine\) \{\n  if \(require\('\.\/core\/engine-migrate'\)\.isLocalQwen\(engine\)\) return isOwner\(\);/, 'GPU 레인 판정에 로컬 Qwen 이 없다(TTS 와 겹친다)');
  assert.match(main, /const _imgLocalGpu = _imgUsesLocalGpu\(engine\);/, '⚡ 만들기의 GPU 판정이 한 곳을 거치지 않는다');
}
ok('👑 로컬 Qwen-Image 2.1 = 관리자 전용 · 이전 규칙 예외 · 이 PC GPU 레인');

console.log(`\n${n}/6 통과`);
