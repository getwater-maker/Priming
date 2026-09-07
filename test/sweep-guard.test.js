'use strict';
/**
 * test/sweep-guard.test.js — 「직접 첨부한 자산」 보호 + 삭제 가드 + 중단 리셋 회귀 테스트
 *
 * 사고(로이 2026-09-07): 직접 만든 인포그래픽 2장을 G1·G2 에 첨부하고 💾 .vrew 를 눌렀더니
 *   ① 판정이 그 그림을 「검정·노이즈」로 오판해 비우고
 *   ② 첨부는 원본 경로를 그대로 가리키므로 **사용자 원본 파일이 삭제**되고
 *   ③ 앞서 누른 ⏹ 중단이 남아 재생성이 즉시 멈춰 **막다른 길**(같은 팝업 4연속)이 됐다.
 *
 * 🔑 판정·가드 함수를 **main.js 원문에서 그대로 뽑아** 실행한다 — 여기에 로직을 복사해 두면
 *    앱과 갈라져도 통과해 버려 아무것도 지켜 주지 못한다.
 *
 * 실행: node test/sweep-guard.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// A/B 역검증용 훅 — 되돌린 main.js 사본을 지정해 '이 테스트가 정말 그 사고를 잡는지' 확인한다.
const ROOT = process.env.SWEEP_TEST_ROOT || path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + ' — 결과 ' + JSON.stringify(got) + ', 기대 ' + JSON.stringify(want)); }
};
const ok = (name, cond) => check(name, !!cond, true);

// ── main.js 원문에서 필요한 블록만 뽑는다 ──
//   각 함수는 본문이 들여쓰기돼 있어 열 0 의 '}' 는 그 함수의 끝뿐이다.
function grab(startMarker, endAfter) {
  const a = src.indexOf(startMarker);
  if (a < 0) { console.error('❌ main.js 에서 못 찾음: ' + startMarker); process.exit(1); }
  const from = endAfter ? src.indexOf(endAfter, a) : a;
  if (from < 0) { console.error('❌ main.js 에서 못 찾음: ' + endAfter); process.exit(1); }
  const b = src.indexOf('\n}\n', from);
  if (b < 0) { console.error('❌ 끝을 못 찾음: ' + startMarker); process.exit(1); }
  return src.slice(a, b + 3);
}

const blocks = [
  grab('function _inDir(file, dir) {'),
  grab('const _visMemo = new Map();', 'function _visRemember'),
  grab('async function _mapLimit(items, limit, fn) {'),
  grab('function _userAttached(g, kind) {'),
  grab('async function sweepBadVisuals(project, logger = log, mediaDir = null) {'),
];
// _visKey 는 한 줄짜리라 따로 집는다.
const visKeyLine = src.split('\n').find((l) => l.indexOf('function _visKey(file)') >= 0);
if (!visKeyLine) { console.error('❌ _visKey 를 못 찾음'); process.exit(1); }

// 판정은 스텁 — 여기서 검증하는 것은 **가드**다(실제 검정·노이즈 판정은 visual-defect.test.js 담당).
//   호출 횟수를 세서 「사람이 첨부한 것은 재지도 않는다」를 단언한다.
const sandbox = `
let JUDGED = [];
const BAD = new Set();
async function looksBadImage(f) { JUDGED.push(f); return BAD.has(f); }
async function looksBadVideo(f) { JUDGED.push(f); return BAD.has(f); }
let LOGS = [];
const log = (m) => LOGS.push(String(m));
${visKeyLine}
${blocks.join('\n')}
module.exports = { sweepBadVisuals, _userAttached, _inDir, _visKey,
  BAD, reset: () => { JUDGED = []; LOGS = []; BAD.clear(); _visMemo.clear(); },
  judged: () => JUDGED, logs: () => LOGS };
`;
const mod = { exports: {} };
new Function('fs', 'path', 'require', 'module', sandbox)(
  fs, path, (m) => (m === './core/media-cache' ? { del() {} } : require(m)), mod);
const A = mod.exports;

// ── 임시 작업 폴더 ──
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweepguard-'));
const media = path.join(root, 'media-1');
const mine = path.join(root, '내가만든그림');   // 출력폴더 '밖' — 첨부 원본이 사는 자리
fs.mkdirSync(media, { recursive: true });
fs.mkdirSync(mine, { recursive: true });
const put = (dir, name, size = 5000) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.alloc(size, 7));
  return p;
};
const G = (num, extra) => Object.assign({ num, imagePrompt: 'p', imageStatus: 'done' }, extra);

(async () => {
console.log('▸ [1] _userAttached 원문 실행');
{
  const f = put(mine, 'u1.png');
  const key = A._visKey(f);
  check('기록과 같은 파일 → 보호', A._userAttached({ imagePath: f, _userImage: key }, 'image'), true);
  // 같은 경로에 새로 생성되면(내용·수정시각 변경) 보호가 자동으로 풀려야 한다 —
  //   안 그러면 생성된 불량 이미지가 사람 첨부로 위장돼 판정을 영구히 빠져나간다.
  fs.writeFileSync(f, Buffer.alloc(9000, 3));
  check('같은 경로에 새로 생성 → 보호 해제', A._userAttached({ imagePath: f, _userImage: key }, 'image'), false);
  check('경로가 다름 → 보호 없음', A._userAttached({ imagePath: put(media, 'x.png'), _userImage: key }, 'image'), false);
  check('기록 없음 → 보호 없음', A._userAttached({ imagePath: f }, 'image'), false);
  check('경로 null → 보호 없음', A._userAttached({ imagePath: null, _userImage: key }, 'image'), false);
  const v = put(mine, 'u1.mp4');
  check('영상도 같은 규칙', A._userAttached({ videoPath: v, _userVideo: A._visKey(v) }, 'video'), true);
}

console.log('▸ [2] 생성된 이상 이미지 = 지운다 (회귀)');
{
  A.reset();
  const f = put(media, '01.png');
  A.BAD.add(f);
  const pr = { groups: [G(1, { imagePath: f })] };
  const cleared = await A.sweepBadVisuals(pr, A.logs().push ? (m) => A.logs().push(m) : () => {}, media);
  check('반환 = [1]', cleared, [1]);
  check('파일 삭제됨', fs.existsSync(f), false);
  check('imagePath 비워짐', pr.groups[0].imagePath, null);
}

console.log('▸ [3] 사람이 직접 만들어 첨부한 것 = 재지도 지우지도 않는다');
{
  A.reset();
  const f = put(mine, '01.png');
  A.BAD.add(f);   // 판정이 부르면 '이상' 이라고 답한다 — 그런데 부르지 않아야 한다
  const pr = { groups: [G(1, { imagePath: f, _userImage: A._visKey(f) })] };
  const cleared = await A.sweepBadVisuals(pr, () => {}, media);
  check('반환 = [] (폐기 없음)', cleared, []);
  check('파일 보존', fs.existsSync(f), true);
  check('imagePath 유지', pr.groups[0].imagePath, f);
  check('ffmpeg 판정 호출 0회', A.judged().length, 0);
}

console.log('▸ [4] 기록이 없는 출력폴더 밖 파일 = 폐기하되 파일은 남긴다');
{
  // 옛 스냅샷·다른 경로로 들어온 첨부 — 보호 기록이 없어 판정은 되지만,
  //   출력폴더 밖이므로 **삭제는 하지 않는다**(_inDir 가드). 이게 사용자 원본을 지키는 두 번째 겹이다.
  A.reset();
  const f = put(mine, '02.png');
  A.BAD.add(f);
  const logs = [];
  const pr = { groups: [G(2, { imagePath: f })] };
  const cleared = await A.sweepBadVisuals(pr, (m) => logs.push(String(m)), media);
  check('반환 = [2]', cleared, [2]);
  check('파일 보존(참조만 해제)', fs.existsSync(f), true);
  check('imagePath 비워짐', pr.groups[0].imagePath, null);
  ok('로그가 「파일은 남깁니다」를 알린다', logs.some((m) => m.indexOf('파일은 남깁니다') >= 0));
}

console.log('▸ [5] mediaDir 미지정 → 아무것도 지우지 않는다');
{
  A.reset();
  const f = put(media, '03.png');
  A.BAD.add(f);
  const pr = { groups: [G(3, { imagePath: f })] };
  await A.sweepBadVisuals(pr, () => {});     // 3번째 인자 없음
  check('파일 보존(fail-safe)', fs.existsSync(f), true);
}

console.log('▸ [6] 영상도 같은 가드');
{
  A.reset();
  const gen = put(media, '01.mp4');
  const usr = put(mine, '02.mp4');
  A.BAD.add(gen); A.BAD.add(usr);
  const pr = { groups: [G(1, { videoPath: gen }), G(2, { videoPath: usr, _userVideo: A._visKey(usr) })] };
  const cleared = await A.sweepBadVisuals(pr, () => {}, media);
  check('생성 영상만 폐기', cleared, [1]);
  check('생성 영상 삭제됨', fs.existsSync(gen), false);
  check('사람 영상 보존', fs.existsSync(usr), true);
}

console.log('▸ [7] 제외 사실을 로그로 알린다');
{
  A.reset();
  const f1 = put(mine, '11.png'), f2 = put(mine, '12.png');
  const logs = [];
  const pr = { groups: [G(1, { imagePath: f1, _userImage: A._visKey(f1) }), G(2, { imagePath: f2, _userImage: A._visKey(f2) })] };
  await A.sweepBadVisuals(pr, (m) => logs.push(String(m)), media);
  ok('「직접 첨부한 자산 2개(G1, G2)」 로그', logs.some((m) => m.indexOf('직접 첨부한 자산 2개(G1, G2)') >= 0));
  check('정상이면 로그만 남기고 폐기 0', (await A.sweepBadVisuals(pr, () => {}, media)).length, 0);
}

console.log('▸ [8] main.js 배선 원문 대조');
{
  // ③ 중단 리셋 — export-vrew 핸들러 본문에 있어야 한다.
  const ev = src.indexOf("ipcMain.handle('export-vrew'");
  const evEnd = src.indexOf("\n});\n", ev);
  const evBody = src.slice(ev, evEnd);
  ok('export-vrew 가 S.abort 를 리셋한다', /S\.abort\s*=\s*false/.test(evBody));
  // 리셋이 sweep 보다 **먼저** 와야 의미가 있다(뒤에 오면 그 실행의 재생성은 여전히 멈춘다).
  ok('리셋이 sweep 호출보다 앞', evBody.indexOf('S.abort = false') < evBody.indexOf('sweepBadVisuals('));

  // sweep 호출은 전부 mediaDir(3번째 인자)를 넘겨야 한다 — 안 넘기면 삭제가 통째로 멈춘다(무해하지만 청소가 안 됨).
  const calls = src.match(/await sweepBadVisuals\([^)]*\)/g) || [];
  check('sweep 호출 4곳', calls.length, 4);
  // ⚠ 인자 '이름'을 못박지 말 것 — 변수명이 바뀌면 코드가 옳은데도 깨진다(이번에 실제로 그랬다).
  //   인자 개수 + 3번째가 미디어 폴더를 가리키는지로 본다.
  check('모든 호출이 mediaDir 전달', calls.filter((c) => c.split(',').length >= 3 && /media/i.test(c.split(',')[2])).length, 4);

  // ① 첨부 두 경로가 '사람이 넣은 것' 을 기록해야 한다 — 하나만 고치면 그 경로로 들어온 그림이 또 지워진다.
  const aa = src.slice(src.indexOf("ipcMain.handle('attach-asset'"), src.indexOf("ipcMain.handle('clear-asset'"));
  ok('attach-asset — 이미지 기록', /_userImage = _visKey\(fp\)/.test(aa));
  ok('attach-asset — 영상 기록', /_userVideo = _visKey\(fp\)/.test(aa));
  const ba = src.slice(src.indexOf("ipcMain.handle('bulk-attach'"));
  ok('bulk-attach — 이미지 기록', /_userImage = _visKey\(img\)/.test(ba.slice(0, 3000)));
  ok('bulk-attach — 영상 기록', /_userVideo = _visKey\(vid\)/.test(ba.slice(0, 3000)));

  // 스냅샷 왕복 — 없으면 앱을 껐다 켠 뒤 sweep 이 사용자 그림을 판정해 버린다.
  const bs = src.slice(src.indexOf('function buildSnapshot()'), src.indexOf('function writeSnapshotSync()'));
  ok('buildSnapshot 에 userImage/userVideo', /userImage: g\._userImage/.test(bs) && /userVideo: g\._userVideo/.test(bs));
  ok('복원부에 userImage/userVideo', /if \(gs\.userImage\) g\._userImage = gs\.userImage;/.test(src) && /if \(gs\.userVideo\) g\._userVideo = gs\.userVideo;/.test(src));

  // sweep 이 무조건 rmSync 하던 옛 코드가 남아 있지 않은지.
  const sw = src.slice(src.indexOf('async function sweepBadVisuals('), src.indexOf('function warnIncompleteVisuals('));
  check('가드 없는 rmSync 잔존 0', (sw.match(/^\s*try \{ fs\.rmSync/gm) || []).length, 0);
  ok('삭제가 _inDir 가드 아래에만', /const del = !!\(mediaDir && _inDir\(/.test(sw));
}

// 정리
try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
console.log('\n' + (fail ? '❌' : '✅') + ' 통과 ' + pass + ' / 실패 ' + fail);
process.exit(fail ? 1 : 0);
})();
