'use strict';
/**
 * node test/fx-video.test.js — 🎞 효과 ⑤ 영상 그룹의 필터·배경색(Lab · 재인코딩 굽기)
 *   [1] 소스 배선 · [2] 🔑 실제 왕복: 진짜 빌더(.vrew 에 재인코딩 사본) → 진짜 렌더러(MP4) → 화소
 */
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const BK = require('../core/clip-effects-bake');

console.log('\n[1] 소스 배선');
const VB = read('vrew/vrew-builder.js'), APP = read('renderer/src/App.jsx');
ok(typeof BK.bakeVideo === 'function', 'bakeVideo 가 있다');
ok(/bakeVideo\(\{ src: _vsrc/.test(VB) && /_vBgBaked/.test(VB), '빌더: 영상 그룹도 필터·배경색 사본을 가리킨다');
ok(/if \(_vBgBaked\) \{ _vx = 0; _vy = 0; _vw = 1; _vh = 1; \}/.test(VB), '배경색 사본은 이미 캔버스 크기 — 박스를 캔버스 전체로');
ok(!/영상 그룹에는 아직 적용되지/.test(APP) && /const fltC = CEff\.cssFilter\(lk\) \|\| '';/.test(APP) && /const bgC = CEff\.cssBg\(lk\) \|\| '';/.test(APP), '화면: 「영상엔 아직」 안내를 걷고 미리보기도 영상에 같은 식');
const bakeSrc = read('core/clip-effects-bake.js');
ok(/'-c:a', 'copy'/.test(bakeSrc) && /libx264/.test(bakeSrc), '재인코딩은 영상만 · 오디오 그대로');

console.log('\n[2] 실제 왕복 — 빌더로 .vrew → 렌더러로 MP4 → 화소');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const FF = require('../core/media-utils').getFfmpegPath();
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxvid-'));
  try {
    const r = P.parseScriptText('# t\n## 장\n### 장면\n가나다라마바사입니다. 둘째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0];
    P.fillSilent(pr, path.join(tmp, 'tts'));
    const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
    // 4:3 영상(빨강 | 파랑) → 16:9 캔버스에서 맞추기 = 양옆 띠
    const vid = path.join(tmp, 'v43.mp4');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=600x900:r=24:d=4', '-f', 'lavfi', '-i', 'color=c=blue:s=600x900:r=24:d=4', '-filter_complex', 'hstack,format=yuv420p', '-c:v', 'libx264', vid]);
    const h0 = sha(vid);
    async function build(name, look) {
      pr.groups[0].videoPath = vid; pr.groups[0].imagePath = undefined; pr.groups[0].look = look || undefined;
      const vrew = path.join(tmp, name + '.vrew'); await P.buildProjectVrew(pr, vrew, {}, () => {}, 20, 1); return vrew;
    }
    async function frame(vrew, name) {
      const mp4 = path.join(tmp, name + '.mp4');
      const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
      if (!res || !res.ok) throw new Error('렌더 실패: ' + (res && res.error));
      return execFileSync(FF, ['-loglevel', 'error', '-ss', '0.5', '-i', mp4, '-frames:v', '1', '-vf', 'scale=96:54', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
    }
    const px = (raw, x, y) => { const i = (y * 96 + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
    const isRed = (p) => p[0] > 150 && p[1] < 90 && p[2] < 90, isBlue = (p) => p[2] > 150 && p[0] < 90 && p[1] < 90, isBlack = (p) => p[0] < 30 && p[1] < 30 && p[2] < 30;
    const isGray = (p) => Math.max(...p) - Math.min(...p) < 18;
    const vidOf = (vrew) => { const z = new AdmZip(vrew); const pj = JSON.parse(z.readAsText('project.json')); const t = Object.values(pj.props.tracks).find((x) => x.type === 'video'); const f = pj.files.find((x) => x.mediaId === t.mediaId); return { t, f, zip: z }; };

    const v0 = await build('base', null);
    const a0 = vidOf(v0);
    const f0 = await frame(v0, 'base');
    ok(isRed(px(f0, 30, 27)) && isBlue(px(f0, 66, 27)) && isBlack(px(f0, 4, 27)), '기준 MP4: 빨강 · 파랑 · 검은 띠');

    const v1 = await build('bw', { filter: 'bw' });
    const a1 = vidOf(v1);
    ok(a1.f.fileSize !== a0.f.fileSize && sha(vid) === h0, '🔑 .vrew 의 영상 = 필터를 입힌 사본(재인코딩) · 원본은 한 바이트도 안 바뀌었다');
    const f1 = await frame(v1, 'bw');
    ok(isGray(px(f1, 30, 27)) && isGray(px(f1, 66, 27)) && !isRed(px(f1, 30, 27)), '🔑 흑백 MP4: 영상이 회색이 됐다');
    ok(isBlack(px(f1, 4, 27)), '흑백 MP4: 양옆 띠는 그대로 검정');

    const v2 = await build('bg', { bg: '#00ff00' });
    const a2 = vidOf(v2);
    const f2 = await frame(v2, 'bg');
    const bar = px(f2, 4, 27);
    ok(bar[1] > 180 && bar[0] < 90 && bar[2] < 90, `🔑 배경색(초록) MP4: 띠가 초록(${bar})`);
    ok(isRed(px(f2, 36, 27)) || isRed(px(f2, 34, 27)), '배경색 MP4: 영상 자리는 그대로');
    ok(a2.t.width === 1 && a2.t.height === 1 && a2.f.videoAudioMetaInfo.videoInfo.size.width === 1920, '사본은 캔버스 크기(1920) · 트랙 박스는 캔버스 전체');

    const v3 = await build('bgbw', { bg: '#00ff00', filter: 'bw' });
    const f3 = await frame(v3, 'bgbw');
    const bar3 = px(f3, 4, 27);
    ok(isGray(bar3) && bar3[1] > 150 && bar3[1] < 215, `배경색 + 흑백: 띠도 회색(${bar3})`);

    // 직접 옮긴 자리가 있으면 배경색은 안 쓰인다(그림과 같은 규칙)
    const v4 = await build('box', { bg: '#00ff00', box: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } });
    const a4 = vidOf(v4);
    ok(a4.f.fileSize === a0.f.fileSize, '직접 옮긴 자리(box)가 있으면 배경색 사본을 만들지 않는다');

    // 끄면 처음과 같다
    const v5 = await build('off', { filter: '' });
    ok(vidOf(v5).f.fileSize === a0.f.fileSize, '효과를 끄면 .vrew 가 처음과 같다(원본 영상)');
  } catch (e) { ok(false, '왕복 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} fx-video ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
