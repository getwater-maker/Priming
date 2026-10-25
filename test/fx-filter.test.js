'use strict';
/**
 * node test/fx-filter.test.js — ✳ 효과 ③ 필터(Lab · 굽기 방식)
 *   [1] 순수 규칙 · [2] 소스 배선 · [3] 🔑 실제 왕복: 진짜 빌더(.vrew 에 필터 입힌 사본) → 진짜 렌더러(MP4) → 화소
 *   (CSS ↔ ffmpeg 가 같은 색을 내는지는 test/fx-filter.smoke.js 가 Chromium 으로 잰다)
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
ok(CE.normFilter('bw') === 'bw' && CE.normFilter('nope') === '' && CE.normFilter(null) === '' && CE.normFilter('') === '', '필터 id 정규화(모르면 빈 값)');
ok(CE.filterActive({ filter: 'sepia' }) && !CE.filterActive({}) && !CE.filterActive({ filter: 'x' }), '쓰이는가');
ok(CE.cssFilter('bw') === 'grayscale(1)' && CE.cssFilter({ filter: 'dark' }) === 'brightness(0.75)' && CE.cssFilter('') === '', 'CSS 식(id · look 둘 다 받는다)');
ok(/^format=rgba,colorchannelmixer=rr=0\.2126/.test(CE.ffmpegFilter('bw')) && CE.ffmpegFilter('') === '', 'ffmpeg 식(흑백 = 휘도 행렬)');
ok(CE.filterStages('cool').stages.length === 2 && CE.filterStages('vintage').stages.length === 3 && CE.filterStages('vivid').contrast === 1.15, '단계 목록(CSS 처럼 단계마다 자른다 · 대비는 마지막)');
ok((CE.ffmpegFilter('vintage').match(/colorchannelmixer/g) || []).length === 3 && /lutrgb/.test(CE.ffmpegFilter('vintage')), '단계 수만큼 colorchannelmixer · 대비가 있으면 lutrgb');
ok(!/lutrgb/.test(CE.ffmpegFilter('bw')), '대비가 없으면 lutrgb 를 안 쓴다');
ok(VL.normLook({ filter: 'bw' }).filter === 'bw' && !('filter' in VL.normLook({ filter: 'zz' })) && VL.isDefault({ filter: '' }) && !VL.isDefault({ filter: 'bw' }), 'look 정규화 · 기본이면 필드 없음');
ok(/필터 흑백/.test(VL.describe({ filter: 'bw' })), '로그용 설명');
ok(!/require\(/.test(read('core/clip-effects.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), '🔑 clip-effects 는 렌더러 번들에 들어간다 — require 없음');

console.log('\n[2] 소스 배선');
const VB = read('vrew/vrew-builder.js'), APP = read('renderer/src/App.jsx');
ok(/CE\.filterActive\(g\.look\)/.test(VB) && /bakeFilter\(\{ src: _fsrc/.test(VB), '빌더: 필터가 있으면 (배경색 사본까지 입힌 화면에) 사본을 굽는다');
ok(VB.indexOf('CE.bgActive(g.look)') < VB.indexOf('CE.filterActive(g.look)'), '순서: 배경색 먼저 → 필터(띠도 함께 필터 = 미리보기 img 요소의 filter 와 같은 범위)');
ok(/CEff\.cssFilter\(lk\)/.test(APP) && /filter:\$\{fltC\}/.test(APP), '미리보기: 그림 요소에 같은 CSS 식');
ok(/data-testid="fl-panel"/.test(APP) && /tid="cx-fx-filter"/.test(APP) && !/label="필터" soon/.test(APP) && !/soon\('✳'/.test(APP), '메뉴: 우클릭 효과 · 막대 · 효과 탭 · 패널 — 준비 중 표시 없음');

console.log('\n[3] 실제 왕복 — 빌더로 .vrew → 렌더러로 MP4 → 화소');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const VBm = require('../vrew/vrew-builder');
const FF = require('../core/media-utils').getFfmpegPath();
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxflt-'));
  try {
    const r = P.parseScriptText('# t\n## 장\n### 장면\n가나다라마바사입니다. 둘째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0];
    const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
    const img = path.join(tmp, 'g43.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=600x900', '-f', 'lavfi', '-i', 'color=c=blue:s=600x900', '-filter_complex', 'hstack', '-frames:v', '1', img]);
    P.fillSilent(pr, path.join(tmp, 'tts'));
    const hash0 = sha(img);
    const imgTrackOf = (vrew) => { const z = new AdmZip(vrew); const pj = JSON.parse(z.readAsText('project.json')); const t = Object.values(pj.props.tracks).find((x) => x.type === 'image'); return { t, zip: z, file: pj.files.find((x) => x.mediaId === t.mediaId) }; };
    async function build(name, look) { pr.groups[0].imagePath = img; pr.groups[0].look = look || undefined; const vrew = path.join(tmp, name + '.vrew'); await P.buildProjectVrew(pr, vrew, {}, () => {}, 20, 1); return vrew; }
    async function frame(vrew, name) {
      const mp4 = path.join(tmp, name + '.mp4');
      const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
      if (!res || !res.ok) throw new Error('렌더 실패: ' + (res && res.error));
      return execFileSync(FF, ['-loglevel', 'error', '-ss', '0.5', '-i', mp4, '-frames:v', '1', '-vf', 'scale=96:54', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
    }
    const px = (raw, x, y) => { const i = (y * 96 + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
    const isRed = (p) => p[0] > 150 && p[1] < 90 && p[2] < 90, isBlue = (p) => p[2] > 150 && p[0] < 90 && p[1] < 90, isBlack = (p) => p[0] < 30 && p[1] < 30 && p[2] < 30;
    const isGray = (p) => Math.max(...p) - Math.min(...p) < 16;

    const v0 = await build('base', null);
    const a0 = imgTrackOf(v0);
    const f0 = await frame(v0, 'base');
    ok(isRed(px(f0, 30, 27)) && isBlue(px(f0, 66, 27)) && isBlack(px(f0, 4, 27)), '기본 MP4: 빨강 · 파랑 · 검은 띠');

    const cache0 = fs.existsSync(BK.CACHE_DIR) ? fs.readdirSync(BK.CACHE_DIR).length : 0;
    const v1 = await build('bw', { filter: 'bw' });
    const a1 = imgTrackOf(v1);
    ok(a1.file.fileSize !== fs.statSync(img).size && sha(img) === hash0, '🔑 .vrew 의 그림 = 필터를 입힌 사본 · 원본은 한 바이트도 안 바뀌었다');
    const bak = path.join(tmp, 'probe.png'); fs.writeFileSync(bak, a1.zip.readFile('media/' + a1.file.name));
    const sz = VBm.readImageSize(bak);
    ok(sz && sz.w === 1200 && sz.h === 900, `사본 크기 = 원본 그대로(${sz && sz.w}×${sz && sz.h}) — 박스·켄번스가 그대로 맞는다`);
    ok(Math.abs(a1.t.width - a0.t.width) < 1e-6, '박스는 필터 없는 때와 같다(맞추기 띠 그대로)');
    const f1 = await frame(v1, 'bw');
    ok(isGray(px(f1, 30, 27)) && isGray(px(f1, 66, 27)) && !isRed(px(f1, 30, 27)) && !isBlue(px(f1, 66, 27)), '🔑 흑백 MP4: 빨강·파랑이 회색이 됐다');
    ok(px(f1, 30, 27)[0] > px(f1, 66, 27)[0] + 15, '흑백 MP4: 빨강(밝기 0.21)이 파랑(0.07)보다 밝다 — 휘도 식 그대로');
    ok(isBlack(px(f1, 4, 27)), '흑백 MP4: 양옆 띠는 그대로 검정(배경색 없음 · 검정은 필터를 거쳐도 검정)');
    const c1 = fs.readdirSync(BK.CACHE_DIR).length;
    ok(c1 === cache0 + 1, `사본이 캐시에 한 개 생겼다(${cache0} → ${c1})`);
    await build('bw2', { filter: 'bw' });
    ok(fs.readdirSync(BK.CACHE_DIR).length === c1, '같은 입력은 다시 굽지 않는다');
    await build('sep', { filter: 'sepia' });
    ok(fs.readdirSync(BK.CACHE_DIR).length === c1 + 1, '필터를 바꾸면 새 사본(옛 사본 그대로 — Ctrl+Z)');

    // 배경색 + 필터 — 띠(배경색)도 함께 필터된다(미리보기 img 요소의 filter 와 같은 범위)
    const v2 = await build('bgbw', { bg: '#00ff00', filter: 'bw' });
    const f2 = await frame(v2, 'bgbw');
    const bar = px(f2, 4, 27);
    ok(isGray(bar) && bar[1] > 150 && bar[1] < 210, `🔑 배경색(초록) + 흑백: 띠도 회색이 됐다(${bar}) — 초록의 휘도 0.72 ≈ 182`);
    ok(isGray(px(f2, 30, 27)) && isGray(px(f2, 66, 27)), '배경색 + 흑백: 그림도 회색');

    // 필터를 끄면 처음과 같다
    const v3 = await build('off', { filter: '' });
    const a3 = imgTrackOf(v3);
    ok(a3.file.fileSize === fs.statSync(img).size && Math.abs(a3.t.width - a0.t.width) < 1e-9, '필터를 끄면 .vrew 가 처음과 같다(원본 그림 · 같은 박스)');
  } catch (e) { ok(false, '왕복 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} fx-filter ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
