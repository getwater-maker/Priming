'use strict';
// node test/delete-media.test.js — 🗑 이미지·비디오 일괄 삭제의 '어느 파일을 지울지' 판정 단위검증.
//   🔑 로직을 복사해 두면 앱과 갈라져도 통과한다 → **main.js 원문에서 함수를 뽑아 실행**한다.
//   지키려는 것 2개:
//     ① 출력폴더(media-N) **안**의 파일만 지운다 — 일괄첨부한 사용자 원본(폴더 밖)은 절대 지우지 않는다.
//     ② 확장자 sweep 이 BGM(bgm_*.wav/mp3)·자막(.srt) 같은 남의 파일을 지우지 않는다.
const fs = require('fs');
const path = require('path');
const os = require('os');

const B = String.fromCharCode(92);
const SRC = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
// main.js 원문에서 함수 하나를 중괄호 균형으로 잘라낸다.
function extract(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('main.js 에서 ' + name + ' 를 찾을 수 없습니다 (이름이 바뀌었나?)');
  let d = 0, started = false, j = i;
  for (; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return SRC.slice(i, j);
}
const { _inDir, _wipeByExt } = new Function('fs', 'path',
  extract('_inDir') + String.fromCharCode(10) + extract('_wipeByExt') +
  String.fromCharCode(10) + 'return { _inDir, _wipeByExt };')(fs, path);

let n = 0, bad = 0;
function ok(cond, msg) { n++; if (!cond) { bad++; console.log('  ✗ ' + msg); } }

// ── ① 확장자 정규식이 main.js 의 것과 같은지 (다르면 이 테스트가 아무것도 못 지킨다) ──
const IMG_SRC = B + '.(png|jpe?g|webp|bmp|gif)$';
const VID_SRC = B + '.(mp4|webm|mov|mkv|avi|m4v)$';
ok(SRC.includes('_wipeByExt(mediaDir, /' + IMG_SRC + '/i)'), '이미지 sweep 정규식이 main.js 와 일치');
ok(SRC.includes('_wipeByExt(mediaDir, /' + VID_SRC + '/i)'), '비디오 sweep 정규식이 main.js 와 일치');
const IMG_RE = new RegExp(IMG_SRC, 'i');
const VID_RE = new RegExp(VID_SRC, 'i');

// ── ② _inDir — 출력폴더 안/밖 판정 ──
const media = path.join('D:', 'out', '대본', 'media-1');
ok(_inDir(path.join(media, '01.png'), media) === true, '폴더 안 파일 = 삭제 대상');
ok(_inDir(path.join(media, '01_1080.mp4'), media) === true, '업스케일본도 삭제 대상');
ok(_inDir(path.join('D:', 'out', '대본', 'media-2', '01.png'), media) === false, '다른 편 폴더는 대상 아님');
ok(_inDir(path.join('D:', '내영상', '원본.mp4'), media) === false, '일괄첨부 원본(폴더 밖)은 대상 아님');
ok(_inDir(media, media) === false, '폴더 자기 자신은 대상 아님');
ok(_inDir(path.join('D:', 'out', '대본', 'media-1x', '01.png'), media) === false, '앞부분만 같은 폴더(media-1x)는 대상 아님');
ok(_inDir(media.toUpperCase() + path.sep + '01.PNG', media) === true, '윈도우 대소문자 무시');
ok(_inDir('', media) === false, '빈 경로는 안전하게 false');

// ── ③ _wipeByExt — 실제 임시 폴더에서 확장자만 지우는지 ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'delmedia-'));
for (const f of ['01.png', '02.jpg', '03.webp', '01.mp4', '02_1080.mp4', '03.webm',
                 'bgm_대본.wav', 'bgm_대본.mp3', '01.srt', 'note.txt']) fs.writeFileSync(path.join(tmp, f), 'x');
const nImg = _wipeByExt(tmp, IMG_RE);
let left = fs.readdirSync(tmp).sort();
ok(nImg === 3, '이미지 3개 삭제 (실제 ' + nImg + ')');
ok(!left.some((f) => IMG_RE.test(f)), '이미지가 남지 않았다');
ok(left.includes('01.mp4') && left.includes('02_1080.mp4'), '이미지 삭제가 영상을 건드리지 않았다');
ok(left.includes('bgm_대본.wav') && left.includes('bgm_대본.mp3'), '🎵 BGM 은 지우지 않았다');
ok(left.includes('01.srt') && left.includes('note.txt'), '자막·기타 파일은 지우지 않았다');
const nVid = _wipeByExt(tmp, VID_RE);
left = fs.readdirSync(tmp).sort();
ok(nVid === 3, '영상 3개 삭제 (실제 ' + nVid + ')');
ok(left.sort().join(',') === ['bgm_대본.wav', 'bgm_대본.mp3', '01.srt', 'note.txt'].sort().join(','),
   '남은 것은 BGM·자막·기타뿐: ' + left.join(','));
ok(_wipeByExt(path.join(tmp, '없는폴더'), IMG_RE) === 0, '없는 폴더는 0개(예외 안 남)');
fs.rmSync(tmp, { recursive: true, force: true });

// ── ④ 핸들러가 지켜야 할 계약이 main.js 에 실제로 있는지(회귀 방지) ──
const iI = SRC.indexOf("ipcMain.handle('delete-images'");
const iV = SRC.indexOf("ipcMain.handle('delete-videos'");
ok(iI > 0 && iV > iI, '두 핸들러가 main.js 에 있다');
const H = SRC.slice(iI, iV);                       // delete-images 본문
const V = SRC.slice(iV, iV + 2600);                // delete-videos 본문
ok(H.includes('_inDir(g.imagePath'), '이미지 삭제가 _inDir 로 폴더 밖 파일을 보호한다');
ok(H.includes('imageCleared = true'), '이미지 삭제가 imageCleared 를 세운다(캐시 부활 방지)');
ok(H.includes('MC.del'), '이미지 삭제가 재활용 캐시 항목까지 지운다');
ok(!H.includes('g.videoPath = null'), '이미지 삭제는 비디오를 건드리지 않는다');
ok(V.includes('_inDir(g.videoPath'), '비디오 삭제가 _inDir 로 사용자 원본을 보호한다');
ok(V.includes('MC.videoKey'), '비디오 삭제가 영상 캐시 키를 지운다');
ok(V.includes("videoStatus = 'idle'"), '비디오 삭제가 상태 배지를 초기화한다');
ok(!V.includes('g.imagePath = null'), '비디오 삭제는 이미지를 건드리지 않는다');

console.log(bad ? String.fromCharCode(10) + '❌ ' + bad + '/' + n + ' 실패'
                : String.fromCharCode(10) + '✅ 미디어 삭제 판정 ' + n + '/' + n + ' 통과');
process.exit(bad ? 1 : 0);
