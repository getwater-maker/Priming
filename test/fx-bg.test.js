'use strict';
/**
 * node test/fx-bg.test.js — 🎨 효과 ② 클립 배경색(Lab · 굽기 방식 · docs/VrewLab/효과_규칙_설계.md §3-3)
 *   [1] 순수 규칙 · [2] 소스 배선 · [3] 🔑 실제 왕복: 진짜 빌더(.vrew 에 사본이 들어간다) → 진짜 렌더러(MP4) → 화소
 *   원본 그림은 한 바이트도 안 바뀐다 · 같은 입력은 다시 굽지 않는다 · 박스를 직접 정한 그림에는 쓰지 않는다
 */
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const CE = require('../core/clip-effects');
const VL = require('../core/visual-look');
const BK = require('../core/clip-effects-bake');

console.log('\n[1] 순수 규칙');
ok(CE.normBg('#ABC') === '#aabbcc' && CE.normBg('abc') === '#aabbcc' && CE.normBg('#00FF00') === '#00ff00' && CE.normBg(' #123456 ') === '#123456', '색 정규화(3자리·대문자·# 없음)');
ok(CE.normBg('') === '' && CE.normBg(null) === '' && CE.normBg('zzz') === '' && CE.normBg('#12345') === '' && CE.normBg('red') === '', '못 읽으면 빈 값(= 필드 없음)');
ok(CE.bgActive({ bg: '#00ff00' }) && !CE.bgActive({ bg: '#00ff00', box: { x: 0, y: 0, w: 0.5, h: 0.5 } }) && !CE.bgActive({}) && !CE.bgActive(null), '쓰이는가 = 색이 있고 직접 옮긴 자리(box)가 없을 때');
ok(CE.cssBg({ bg: '#00FF00' }) === '#00ff00' && CE.cssBg({ bg: '#00ff00', box: { x: 0, y: 0, w: 1, h: 1 } }) === '', '미리보기 색 = 쓰일 때만');
ok(VL.normLook({ bg: '#F00' }).bg === '#ff0000' && !('bg' in VL.normLook({ bg: 'x' })) && VL.isDefault({ bg: '' }) && !VL.isDefault({ bg: '#000000' }), 'look 정규화 · 기본이면 필드 없음');
ok(VL.normLook({ bg: '#fff', box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }).bg === '#ffffff', '박스가 있어도 저장은 한다(쓰이지 않을 뿐 — 자리를 되돌리면 다시 쓰인다)');
ok(/배경색 #00ff00/.test(VL.describe({ bg: '#0f0' })), '로그용 설명');
const k1 = BK.bakeKey({ src: __filename, bg: '#00ff00', W: 1920, H: 1080, box: { x: 0.1, y: 0, w: 0.8, h: 1 } });
const k2 = BK.bakeKey({ src: __filename, bg: '#00ff00', W: 1920, H: 1080, box: { x: 0.1, y: 0, w: 0.8, h: 1 } });
const k3 = BK.bakeKey({ src: __filename, bg: '#ff0000', W: 1920, H: 1080, box: { x: 0.1, y: 0, w: 0.8, h: 1 } });
ok(k1 === k2 && k1 !== k3 && /^[0-9a-f]{16}$/.test(k1), '사본 지문: 같은 입력 = 같은 이름 · 색이 다르면 다른 이름(판정력)');
ok(!/require\(/.test(read('core/clip-effects.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), '🔑 clip-effects 는 렌더러 번들에 들어간다 — require 없음(굽기는 Node 전용 clip-effects-bake)');

console.log('\n[2] 소스 배선');
const VB = read('vrew/vrew-builder.js'), APP = read('renderer/src/App.jsx');
ok(/CE\.bgActive\(g\.look\)/.test(VB) && /clip-effects-bake'\)\.bakeBackground/.test(VB) && (VB.match(/_imgPath/g) || []).length >= 6, '빌더: 배경색이 쓰이면 사본을 굽고 그 사본을 쓴다');
ok(/CEff\.cssBg\(lk\)/.test(APP) && /background-color:\$\{bgC\}/.test(APP), '미리보기: 그림 요소에 같은 색');
ok(/data-testid="bg-panel"/.test(APP) && /tid="cx-fx-bg"/.test(APP) && !/label="클립 배경색" soon/.test(APP) && !/soon\('🎨'/.test(APP), '메뉴: 우클릭 효과 · 막대 · 효과 탭 · 패널 — 준비 중 표시 없음');

console.log('\n[3] 실제 왕복 — 빌더로 .vrew → 렌더러로 MP4 → 화소');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const VBm = require('../vrew/vrew-builder');
const FF = require('../core/media-utils').getFfmpegPath();
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxbg-'));
  try {
    const r = P.parseScriptText('# t\n## 장\n### 장면\n가나다라마바사입니다. 둘째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0];
    const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
    // 4:3 빨강|파랑(1200×900) — 16:9 캔버스에서 맞추기 = 양옆 띠
    const img43 = path.join(tmp, 'g43.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=600x900', '-f', 'lavfi', '-i', 'color=c=blue:s=600x900', '-filter_complex', 'hstack', '-frames:v', '1', img43]);
    // 16:9 인데 왼쪽 절반이 투명한 PNG(띠가 없다 · 투명 바닥만 있다)
    const imgAlpha = path.join(tmp, 'ga.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=960x1080,format=rgba', '-f', 'lavfi', '-i', 'color=c=blue:s=960x1080,format=rgba', '-filter_complex', 'hstack', '-frames:v', '1', imgAlpha]);
    P.fillSilent(pr, path.join(tmp, 'tts'));
    const hash43 = sha(img43), hashA = sha(imgAlpha);
    const imgTrackOf = (vrew) => { const z = new AdmZip(vrew); const pj = JSON.parse(z.readAsText('project.json')); const t = Object.values(pj.props.tracks).find((x) => x.type === 'image'); const f = pj.files.find((x) => x.mediaId === t.mediaId); return { t, zip: z, file: f }; };
    async function build(name, imagePath, look) {
      pr.groups[0].imagePath = imagePath;
      pr.groups[0].look = look || undefined;
      const vrew = path.join(tmp, name + '.vrew');
      await P.buildProjectVrew(pr, vrew, {}, () => {}, 20, 1);
      return vrew;
    }
    async function frame(vrew, name) {
      const mp4 = path.join(tmp, name + '.mp4');
      const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
      if (!res || !res.ok) throw new Error('렌더 실패: ' + (res && res.error));
      return execFileSync(FF, ['-loglevel', 'error', '-ss', '0.5', '-i', mp4, '-frames:v', '1', '-vf', 'scale=96:54', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
    }
    const px = (raw, x, y) => { const i = (y * 96 + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
    const isRed = (p) => p[0] > 150 && p[1] < 90 && p[2] < 90, isBlue = (p) => p[2] > 150 && p[0] < 90 && p[1] < 90, isBlack = (p) => p[0] < 30 && p[1] < 30 && p[2] < 30;
    const isGreen = (p) => p[1] > 150 && p[0] < 90 && p[2] < 90, isYellow = (p) => p[0] > 150 && p[1] > 150 && p[2] < 90;

    // (a) 기본 — 띠는 검정, .vrew 의 그림은 원본 크기
    const v0 = await build('base', img43, null);
    const a0 = imgTrackOf(v0);
    ok(a0.t.width < 1 && a0.file.fileSize === fs.statSync(img43).size, '기본 .vrew: 맞추기 박스 · 그림 = 원본 파일');
    const f0 = await frame(v0, 'base');
    ok(isBlack(px(f0, 4, 27)) && isRed(px(f0, 30, 27)) && isBlue(px(f0, 66, 27)), '기본 MP4: 양옆 검은 띠 · 빨강 · 파랑');

    // (b) 초록 배경 — 띠가 초록
    const cacheBefore = fs.existsSync(BK.CACHE_DIR) ? fs.readdirSync(BK.CACHE_DIR).length : 0;
    const v1 = await build('bg', img43, { bg: '#00ff00' });
    const a1 = imgTrackOf(v1);
    const mediaBytes = a1.zip.readFile('media/' + a1.file.name);
    const baked = path.join(tmp, 'baked-probe.png'); fs.writeFileSync(baked, mediaBytes);
    const sz = VBm.readImageSize(baked);
    ok(sz && sz.w === 1920 && sz.h === 1080, `🔑 .vrew 에 들어간 그림 = 캔버스 크기 사본(${sz && sz.w}×${sz && sz.h}) — Vrew 가 아는 그림 파일일 뿐이다`);
    ok(a1.file.fileSize !== fs.statSync(img43).size && sha(img43) === hash43, '원본 그림은 한 바이트도 안 바뀌었다');
    const f1 = await frame(v1, 'bg');
    ok(isGreen(px(f1, 4, 27)) && isGreen(px(f1, 92, 27)), '🔑 배경색 MP4: 양옆 띠가 초록');
    ok(isRed(px(f1, 30, 27)) && isBlue(px(f1, 66, 27)), '배경색 MP4: 그림(빨강·파랑)은 그대로 가운데');
    const cacheAfter = fs.readdirSync(BK.CACHE_DIR).length;
    ok(cacheAfter === cacheBefore + 1, `사본이 캐시에 한 개 생겼다(${cacheBefore} → ${cacheAfter})`);
    await build('bg2', img43, { bg: '#00ff00' });
    ok(fs.readdirSync(BK.CACHE_DIR).length === cacheAfter, '같은 입력으로 다시 만들면 다시 굽지 않는다(캐시 적중)');
    await build('bg3', img43, { bg: '#ff00ff' });
    ok(fs.readdirSync(BK.CACHE_DIR).length === cacheAfter + 1, '색을 바꾸면 새 사본(옛 사본은 그대로 — Ctrl+Z 가 옛 모양으로 돌아간다)');

    // (c) 박스를 직접 정한 그림 — 배경색은 쓰이지 않는다(원본 그대로 · 띠는 검정)
    const v2 = await build('boxed', img43, { bg: '#00ff00', box: { x: 0.3, y: 0.2, w: 0.4, h: 0.6 } });
    const a2 = imgTrackOf(v2);
    ok(a2.file.fileSize === fs.statSync(img43).size && near(a2.t.width, 0.4), '박스가 있으면 사본을 굽지 않는다(원본 그림 · 그 박스)');
    const f2 = await frame(v2, 'boxed');
    ok(isBlack(px(f2, 4, 27)) && !isGreen(px(f2, 4, 27)), '박스 그림 MP4: 바깥은 검정(배경색 안 쓰임)');

    // (d) 투명 PNG(띠 없음) — 투명 바닥에 칠한다
    const v3 = await build('alpha0', imgAlpha, null);
    const f3 = await frame(v3, 'alpha0');
    ok(isBlack(px(f3, 10, 27)) && isBlue(px(f3, 80, 27)), '투명 PNG 기본: 투명한 왼쪽은 검정 · 오른쪽 파랑');
    const v4 = await build('alpha1', imgAlpha, { bg: '#ffff00' });
    const f4 = await frame(v4, 'alpha1');
    ok(isYellow(px(f4, 10, 27)) && isBlue(px(f4, 80, 27)), '🔑 투명 PNG + 노랑 배경: 투명한 왼쪽이 노랑 · 오른쪽 파랑');
    ok(sha(imgAlpha) === hashA, '투명 PNG 원본도 그대로');

    // (e) 끄면(색 없음) 처음과 같다
    const v5 = await build('off', img43, { bg: '' });
    const a5 = imgTrackOf(v5);
    ok(a5.file.fileSize === fs.statSync(img43).size && near(a5.t.width, a0.t.width), '배경색을 지우면 .vrew 가 처음과 같다(원본 그림 · 같은 박스)');
  } catch (e) { ok(false, '왕복 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} fx-bg ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
function near(a, b, e = 0.01) { return Math.abs(a - b) < e; }
