// 「만들기」가 이미 만든 영상을 다시 만들지 않는지 (v0.5.49 · 아내 PC 실사고)
//   main.js 원문에서 autoRelinkVideos·hasVideoFile 을 뽑아 실제 임시 파일로 실행한다.
const fs = require('fs'), path = require('path'), os = require('os');
const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const a = src.indexOf('function autoRelinkVideos(');
const b = src.indexOf('function rangeNums(', a);
if (a < 0 || b < 0) { console.log('❌ main.js 에서 헬퍼를 못 찾음'); process.exit(1); }
const mod = new Function('fs', 'path', src.slice(a, b) + '\nreturn { autoRelinkVideos, hasVideoFile };')(fs, path);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vskip-'));
const w = (n, t = 'x') => { const f = path.join(dir, n); fs.writeFileSync(f, t); return f; };
const img1 = w('01.png'), img2 = w('02.png'), img3 = w('03.png'), img4 = w('04.png');
w('01_1080.mp4'); w('01.mp4'); w('03.mp4'); w('04.mp4'); w('05.mp4');
const groups = [
  { num: 1, imagePath: img1, videoPath: null },                        // 참조가 풀렸다 → _1080 우선으로 다시 잇기
  { num: 2, imagePath: img2, videoPath: null },                        // 폴더에 영상 없음 → 그대로(새로 만들 대상)
  { num: 3, imagePath: img3, videoPath: path.join(dir, 'gone.mp4') },  // 옛 경로가 없어짐 → 03.mp4 로
  { num: 4, imagePath: img4, videoPath: null, videoCleared: true },    // ✕ 로 지움 → 되살리지 않는다
  { num: 5, imagePath: null, videoPath: null },                        // 그림 없음 → 건드리지 않는다
];
const n = mod.autoRelinkVideos({ groups }, dir);
ok(n === 2, `다시 연결 2개 (${n})`);
ok(groups[0].videoPath === path.join(dir, '01_1080.mp4'), 'G1 = 업스케일본 우선');
ok(groups[1].videoPath === null, 'G2 = 파일 없음 → 그대로');
ok(groups[2].videoPath === path.join(dir, '03.mp4'), 'G3 = 없어진 옛 경로 대신 03.mp4');
ok(groups[3].videoPath === null, 'G4 = ✕ 로 지운 영상은 되살리지 않음');
ok(groups[4].videoPath === null, 'G5 = 그림 없는 그룹은 손대지 않음');
ok(mod.hasVideoFile(groups[0]) && !mod.hasVideoFile(groups[1]), 'hasVideoFile 판정');

// 배선 — 파이프라인·순차 둘 다 이미 있는 영상을 대상에서 뺀다
const vs = src.slice(src.indexOf('const videoStage = async'), src.indexOf("if (skipTts) {"));
ok(/autoRelinkVideos\(/.test(vs), '파이프라인 videoStage 가 먼저 다시 연결');
ok(/if \(hasVideoFile\(g\)\) \{ done\.add\(g\); continue; \}/.test(vs), '파이프라인: 이미 영상 있는 그룹은 대상 제외');
const st3 = src.slice(src.indexOf("🎬 3단계 — 비디오 일괄 생성"), src.indexOf('── 4단계'));
ok(/autoRelinkVideos\(pr, dirs\.media\)/.test(st3) && /hasVideoFile\(g\)/.test(st3), '순차 3단계도 같은 처리');
ok(/g\.videoCleared = true;/.test(src) && /videoCleared: !!g\.videoCleared/.test(src) && /if \(gs\.videoCleared\) g\.videoCleared = true;/.test(src), '✕ 삭제 표시 저장·복원');

fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? `❌ video-skip ${pass}/${pass + fail}` : `✅ video-skip ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
