'use strict';
/**
 * node test/caption-geom.test.js — 📐 자막 자리·크기 한 곳(core/caption-geom · Lab 차이표 #12)
 *   · MP4(vrew-render.captionAssStyle) = caption-geom.boxPx 를 정수로 반올림한 값(288가지 위치·정렬·폭·크기)
 *   · 수치 상수(0.72 · 24.6 · 105.5)가 vrew-render·Workspace 에 따로 남아 있지 않다(두 벌 금지)
 *   · ① 미리보기 stageCapGeom 이 boxPx 를 거친다 · 빌더 기본 폭 = DEFAULT_WIDTH
 */
const fs = require('fs'), path = require('path');
const CG = require('../core/caption-geom');
const R = require('../core/vrew-render');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const Rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

console.log('[1] MP4 값 = boxPx 반올림');
let n = 0, bad = 0;
for (const yAlign of ['top', 'middle', 'bottom']) for (const al of ['start', 'center', 'end']) for (const yOffset of [-0.3, -0.125, 0, 0.2]) for (const xOffset of [0, 0.1]) for (const width of [0.96, 0.7]) for (const size of [100, 75]) {
  const a = R.captionAssStyle({ style: { yAlign, yOffset, xOffset, width, customAttributes: [{ attributeName: '--textbox-align', value: al }] }, attrs: { size } }, 'F');
  const g = CG.boxPx({ hAlign: al, yAlign, yOffset, xOffset, width }, size);
  n++;
  if (a.size !== Math.max(8, Math.round(g.sizePx)) || a.marginL !== Math.max(0, Math.round(g.marginL)) || a.marginR !== Math.max(0, Math.round(g.marginR))
    || a.marginV !== (yAlign === 'middle' ? 0 : Math.round(g.marginV)) || a.offsetY !== Math.round(g.offsetY)) bad++;
}
ok(n === 288 && bad === 0, `288가지 조합 모두 같다 (어긋남 ${bad})`);
const cal = CG.boxPx({ hAlign: 'start', yAlign: 'bottom', yOffset: -0.125, width: 0.96 }, 100);
ok(Math.round(cal.marginV) === 173 && Math.round(cal.marginL) === 63 && Math.round(cal.sizePx) === 72, `실측 기준(아래·왼쪽·yOffset −0.125) = MarginV 173 · 왼쪽 63 · 글자 72px (${Math.round(cal.marginV)} · ${Math.round(cal.marginL)} · ${Math.round(cal.sizePx)})`);

console.log('[2] 두 벌 금지');
const VR = Rd('core/vrew-render.js'), WS = Rd('renderer/src/Workspace.jsx'), VB = Rd('vrew/vrew-builder.js');
ok(!/=\s*0\.72\s*;/.test(VR) && !/=\s*24\.6\s*;/.test(VR) && !/=\s*105\.5\s*;/.test(VR), 'vrew-render 에 자막 수치 상수가 따로 없다');
ok(!/0\.72|24\.6|105\.5/.test(WS.slice(WS.indexOf('export function stageCapGeom'), WS.indexOf('export function applyStageGeom'))) && /CG\.boxPx\(/.test(WS), '① 미리보기 stageCapGeom 이 boxPx 를 거친다(수치 없음)');
ok(/import CG from '\.\.\/\.\.\/core\/caption-geom\.js'/.test(WS), 'Workspace 가 core/caption-geom 을 가져온다');
ok(/width: 0\.96,/.test(VB) && CG.DEFAULT_WIDTH === 0.96, `빌더 기본 자막 폭 0.96 = DEFAULT_WIDTH (${CG.DEFAULT_WIDTH})`);

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
