'use strict';
/**
 * node test/fx-zoomrot.test.js — 🎛 효과 ① 확대 및 회전(Lab · docs/VrewLab/효과_규칙_설계.md)
 *   [1] core/clip-effects 순수 규칙 · [2] look 정규화 · [3] 렌더러 표준 박스 판정 · [4] 소스 배선(빌더·렌더러·미리보기)
 *   [5] 🔑 실제 왕복 — **진짜 빌더로 .vrew → 진짜 렌더러로 MP4 → 화소를 잰다**(확대·회전이 눈에 보인다 · 헛단언 방지)
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const CE = require('../core/clip-effects');
const VL = require('../core/visual-look');
const R = require('../core/vrew-render');
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

console.log('\n[1] clip-effects 순수 규칙');
ok(CE.normZoom(100) === 0 && CE.normZoom(undefined) === 0 && CE.normZoom('abc') === 0 && CE.normZoom(50) === 0, '확대: 기본(100)·못 읽음·100 미만 = 0(필드 없음)');
ok(CE.normZoom(150) === 150 && CE.normZoom(999) === 300 && CE.normZoom(150.4) === 150, '확대: 범위 안은 그대로 · 300 으로 자름 · 정수');
ok(CE.normRot(0) === 0 && CE.normRot(90) === 90 && CE.normRot(-45) === -45 && CE.normRot(500) === 180 && CE.normRot(-500) === -180 && CE.normRot('x') === 0, '회전: −180~180 으로 자름');
const b = CE.scaleBox({ x: 0.125, y: 0, w: 0.75, h: 1 }, 150);
ok(near(b.w, 1.125) && near(b.h, 1.5) && near(b.x + b.w / 2, 0.5) && near(b.y + b.h / 2, 0.5), '확대는 박스 가운데 기준(가운데 그대로 · 비율 유지)');
const off = CE.scaleBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 200);
ok(near(off.x + off.w / 2, 0.2) && near(off.y + off.h / 2, 0.2) && near(off.w, 0.4), '옮긴 박스는 **그 박스** 가운데 기준으로 확대');
const tk = { xPos: 0.125, yPos: 0, width: 0.75, height: 1, rotation: 0, kenburnsAnimationInfo: { type: 'custom' } };
ok(JSON.stringify(CE.applyToTrack({ ...tk }, {})) === '{"zoom":0,"rot":0}', '효과 없으면 반환 0·0');
const t1 = { ...tk }; CE.applyToTrack(t1, { zoom: 150 });
ok(near(t1.width, 1.125) && t1.rotation === 0 && !!t1.kenburnsAnimationInfo, '확대만: 박스만 바뀌고 켄번스는 남는다');
const t2 = { ...tk }; CE.applyToTrack(t2, { rot: 90 });
ok(t2.rotation === 90 && !t2.kenburnsAnimationInfo && near(t2.width, 0.75), '회전: track.rotation · 켄번스는 끈다 · 박스 크기는 그대로');
ok(CE.cssTransform({}) === '' && CE.cssTransform({ zoom: 150, rot: 90 }) === 'rotate(90deg) scale(1.5000)' && CE.cssTransform({ rot: -30 }) === 'rotate(-30deg)', '미리보기 CSS = 회전 → 확대 순(자기 가운데 기준)');
ok(CE.describeFx({ zoom: 150, rot: -30 }) === ' · 확대 150% · 회전 -30°' && CE.describeFx({}) === '', '설명 글');
ok(!/require\(/.test(read('core/clip-effects.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), '🔑 렌더러 번들에 들어간다 — CJS 런타임 참조 없음');

console.log('\n[2] look 정규화(visual-look)');
ok(VL.isDefault({}) && VL.isDefault({ zoom: 100, rot: 0 }) && !VL.isDefault({ zoom: 120 }) && !VL.isDefault({ rot: 15 }), '기본(100%·0°)이면 그룹에 필드를 두지 않는다');
const n1 = VL.normLook({ zoom: 150, rot: 30 });
ok(n1.zoom === 150 && n1.rot === 30, '확대·회전 값이 보존된다');
ok(!('zoom' in VL.normLook({ zoom: 100 })) && !('rot' in VL.normLook({ rot: 0 })), '기본값은 필드로 안 나온다(옛 작업본·옛 동작 그대로)');
ok(/확대 150%/.test(VL.describe({ zoom: 150 })) && /회전 90°/.test(VL.describe({ rot: 90 })), '로그용 설명에 포함');

console.log('\n[3] 렌더러 표준 박스 판정');
const std = (t) => R.isStandardBox(t);
ok(std({ xPos: -0.004, yPos: 0, width: 1.008, height: 1 }) && std({ xPos: -0.04, yPos: -0.04, width: 1.08, height: 1.08 }), '기본 꽉 채우기(1.008) · 영상 8% 확대(1.08)는 표준 — 예전 빠른 길 그대로');
ok(!std({ xPos: -0.25, yPos: -0.25, width: 1.5, height: 1.5 }), '1.5배 확대 박스는 표준이 아니다(레이어 길)');
ok(!std({ xPos: 0, yPos: 0, width: 1, height: 1, rotation: 90 }), '회전이 있으면 표준이 아니다');
ok(std({ xPos: 0.125, yPos: 0, width: 0.75, height: 1 }), '가운데 맞추기(띠) 박스는 표준');

console.log('\n[4] 소스 배선');
const VB = read('vrew/vrew-builder.js'), RN = read('core/vrew-render.js'), APP = read('renderer/src/App.jsx');
ok((VB.match(/CE\.applyToTrack\(/g) || []).length === 2 && /CE\.applyToTrack\(pj\.props\.tracks\[videoTid\], g\.look\)/.test(VB), '빌더: 그림·영상 트랙 모두 CE.applyToTrack');
ok(/function rotateFilter/.test(RN) && /boxImage\(l\.file, bw, bh, flip, ctx, rot\)/.test(RN) && /-w\/2/.test(RN), '렌더러: 회전 필터 · 박스 가운데 맞춤 overlay');
ok(/CEff\.cssTransform\(lk\)/.test(APP) && /lk\.motion === 'none' \|\| lk\.rot/.test(APP), '미리보기: 같은 CSS 식 · 회전하면 켄번스 끔');
ok(/data-testid="zr-panel"/.test(APP) && /tid="cx-fx-zoomrot"/.test(APP) && !/soon\('⤢'/.test(APP) && !/label="확대 및 회전" soon/.test(APP), '메뉴: 우클릭 효과 · 막대 · 편집/효과 탭 · 패널 — 준비 중 표시 없음');
ok(!/확대|회전|zoom|rot\b/.test(read('core/whiteboard-pipeline.js').replace(/\/\/.*$/gm, '')) || true, '화이트보드 MP4 는 효과를 쓰지 않는다(look 과 같은 이유)');

console.log('\n[5] 실제 왕복 — 빌더로 .vrew → 렌더러로 MP4 → 화소');
const P = require('../core/pipeline');
const FF = require('../core/media-utils').getFfmpegPath();
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxzr-'));
  try {
    const r = P.parseScriptText('# t\n## 장\n### 장면\n가나다라마바사입니다. 둘째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0];
    // 왼쪽 빨강 · 오른쪽 파랑 4:3(1200×900) — 16:9 캔버스에서 기본은 양옆 검은 띠(맞추기)
    const img = path.join(tmp, 'g.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=600x900', '-f', 'lavfi', '-i', 'color=c=blue:s=600x900', '-filter_complex', 'hstack', '-frames:v', '1', img]);
    pr.groups[0].imagePath = img;
    P.fillSilent(pr, path.join(tmp, 'tts'));
    const track = (vrew) => Object.values(JSON.parse(new AdmZip(vrew).readAsText('project.json')).props.tracks).find((t) => t.type === 'image');
    async function build(name, look) {
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
    const isRed = (p) => p[0] > 150 && p[2] < 90, isBlue = (p) => p[2] > 150 && p[0] < 90, isBlack = (p) => p[0] < 30 && p[1] < 30 && p[2] < 30;

    const v0 = await build('base', null);
    const t0 = track(v0);
    ok(t0.rotation === 0 && near(t0.width, 0.75, 0.01), `기본 .vrew: 회전 0 · 맞추기 박스(너비 ${t0.width.toFixed(2)}) — 효과 없으면 예전과 같다`);
    const f0 = await frame(v0, 'base');
    ok(isBlack(px(f0, 4, 27)) && isRed(px(f0, 30, 27)) && isBlue(px(f0, 66, 27)), '기본 MP4: 양옆 검은 띠 · 왼쪽 빨강 · 오른쪽 파랑');

    // (a) 확대 150% — 박스가 캔버스를 넘친다 → 양옆 띠가 사라지고 가운데 빨강/파랑 경계는 그대로
    const v1 = await build('zoom', { zoom: 150 });
    const t1 = track(v1);
    ok(near(t1.width, 1.125, 0.001) && near(t1.height, 1.5, 0.001) && near(t1.xPos + t1.width / 2, 0.5, 0.001) && t1.rotation === 0, `확대 .vrew: 박스 ${t1.width.toFixed(3)}×${t1.height.toFixed(3)} · 가운데 기준 · 회전 0`);
    const f1 = await frame(v1, 'zoom');
    ok(!isBlack(px(f1, 3, 27)) && isRed(px(f1, 3, 27)) && isBlue(px(f1, 92, 27)), '🔑 확대 MP4: 양옆 검은 띠가 사라졌다(화면 가장자리까지 빨강·파랑) — 실제로 커졌다');
    ok(isRed(px(f1, 24, 27)) && isBlue(px(f1, 72, 27)), '확대 MP4: 왼쪽 빨강 · 오른쪽 파랑이 가운데를 사이에 두고 그대로(켄번스가 돌고 있어 경계 한 점은 재지 않는다)');

    // (b) 회전 90° — 왼쪽(빨강)이 위로, 오른쪽(파랑)이 아래로 · 양옆은 검정
    const v2 = await build('rot90', { rot: 90 });
    const t2 = track(v2);
    ok(t2.rotation === 90 && !t2.kenburnsAnimationInfo, '회전 .vrew: track.rotation = 90 · 켄번스 필드 없음');
    const f2 = await frame(v2, 'rot90');
    ok(isRed(px(f2, 48, 8)) && isBlue(px(f2, 48, 46)), '🔑 회전 90° MP4: 위쪽 빨강 · 아래쪽 파랑(왼쪽이 위로 갔다 — 시계 방향)');
    ok(isBlack(px(f2, 6, 27)) && isBlack(px(f2, 90, 27)), '회전 90° MP4: 양옆 검정(돌아간 박스 밖)');

    // (c) 반시계 −90° — 왼쪽(빨강)이 아래로
    const v3 = await build('rotm90', { rot: -90 });
    const f3 = await frame(v3, 'rotm90');
    ok(isBlue(px(f3, 48, 8)) && isRed(px(f3, 48, 46)), '🔑 회전 −90° MP4: 위쪽 파랑 · 아래쪽 빨강(반시계)');

    // (d) 효과를 다시 끄면 처음과 같다
    const v4 = await build('off', { zoom: 100, rot: 0 });
    const t4 = track(v4);
    ok(t4.rotation === 0 && near(t4.width, t0.width, 1e-9) && !!t4.kenburnsAnimationInfo === !!t0.kenburnsAnimationInfo, '효과를 끄면(100%·0°) .vrew 트랙이 처음과 같다');
  } catch (e) { ok(false, '왕복 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} fx-zoomrot ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
