'use strict';
/**
 * node test/layer-plates.test.js — 🎞 ㊸ 판 따로(인물판 · 배경판 · 2.0 덧붙임4 ⓒ · v1.0.33)
 *   [1] 지시 줄(🖼️ 배경 · 🖼️ 인물) 읽기 · 그림 지시문으로 잡히지 않음 · 판 없이 쓰면 경고
 *   [2] 색 빼기(바탕 = 테두리 가운데 값 · 그늘진 바탕 · 먼지 · 번짐 빼기) · [3] 되돌림 판정(바탕 · 잘림 · 크기 · 빛)
 *   [4] 그림자 · 박스(발 = 화면 아래 끝) · [5] 층 움직임(ken-burns 한 곳 · 지시 없으면 그대로) · [6] .vrew 트랙 · 삽입 필드 저장
 *   [7] MP4 에 실제로 층이 그려진다(투명 인물판 바깥 = 배경판 · 안 = 인물 · 움직임 끝에 인물이 커짐) · [8] 배선
 */
const fs = require('fs'), os = require('os'), path = require('path');
const AdmZip = require('adm-zip');
const { execFileSync } = require('child_process');
const LP = require('../core/layer-plates');
const SD = require('../core/scene-directives');
const P = require('../core/pipeline');
const KB = require('../core/ken-burns');
const OL = require('../core/overlay-layers');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

/** 합성 인물판: 바탕색 bg · 사람 = 살색 몸통 + 어두운 아래 · 가장자리 2px 섞임 */
function figImg({ w = 300, h = 420, bg = [0, 255, 0], top = 60, bottom = 400, left = 110, right = 190, shade = false, speck = false, greenShirt = false } = {}) {
  const d = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let c = bg.slice();
    if (shade && x < 40) c = [0, 120, 0];   // 그늘진 바탕
    const inF = x >= left && x <= right && y >= top && y <= bottom;
    if (inF) { c = y > 260 ? [40, 40, 60] : [205, 155, 125]; if (greenShirt && y > 150 && y < 250) c = [30, 200, 40]; }
    const edge = inF && (x - left < 2 || right - x < 2);
    if (edge) c = c.map((v, k) => Math.round((v + bg[k]) / 2));   // 바탕과 반쯤 섞인 가장자리
    if (speck && x === 20 && y === 20) c = [255, 0, 0];
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  return { w, h, data: d };
}
const px = (img, x, y) => { const i = (y * img.w + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]; };

(async () => {
  console.log('[1] 지시 줄');
  const md = '# t\n## 장\n### 가\n> 🖼️ 이미지: one image.\n> 🎞 판: 따로\n> 🖼️ 배경: empty temple court.\n> 🖼️ 인물: an old widow.\n첫 문장입니다.\n### 나\n> 🖼️ 이미지: two image.\n> 🖼️ 배경: lonely hill.\n둘째 문장입니다.\n### 다\n> 🖼️ 이미지: three.\n> 🎞 판: 따로\n> 🖼️ 인물:\n셋째 문장입니다.\n';
  const L = SD.parse(md);
  ok(L.filter((d) => d.kind === 'plate').length === 4 && L.find((d) => d.part === 'fig' && d.error), '배경·인물 줄 4개(빈 지시문 = 오류 글)');
  const pr = P.parseScriptText(md, 'longform', {}).projects[0];
  ok(pr.groups.map((g) => g.imagePrompt).join('|') === 'one image.|two image.|three.', '🖼️ 배경·인물 줄은 그림 지시문(🖼️ 이미지:)으로 잡히지 않는다');
  ok(pr.groups[0].layered && pr.groups[0].layerPrompts && pr.groups[0].layerPrompts.bg === 'empty temple court.' && pr.groups[0].layerPrompts.fig === 'an old widow.', 'G1 = 판 따로 + 지시문 둘');
  ok(!pr.groups[1].layerPrompts && pr.sceneDirectives.warnings.some((w) => /G2 .*판: 따로」 없이/.test(w)), 'G2 = 판 없이 배경 줄만 → 지우고 경고');
  ok(pr.groups[2].layered && !(pr.groups[2].layerPrompts && pr.groups[2].layerPrompts.fig) && pr.sceneDirectives.warnings.some((w) => /지시문이 비었습니다/.test(w)), 'G3 = 빈 인물 지시문 → 경고(그리기 단계가 되돌린다)');
  const pp = P.parseScriptText('# t\n## 장\n### 가\n> 🖼️ 이미지: x.\n> 🎞 판: 따로\n> 🖼️ 배경: court.\n> 🖼️ 인물: 오른쪽 | a widow.\n첫 문장입니다.\n### 나\n> 🖼️ 이미지: y.\n> 🎞 판: 따로\n> 🖼️ 배경: hill.\n> 🖼️ 인물: 가운데 | a boy.\n둘째 문장입니다.\n', 'longform', {}).projects[0];
  ok(pp.groups[0].layerPrompts.fig === 'a widow.' && pp.groups[0].layerPrompts.figPos === 'right' && pp.groups[1].layerPrompts.fig === 'a boy.' && !pp.groups[1].layerPrompts.figPos, '인물 자리 `오른쪽 | 지시문`(가운데 = 자리 칸 없음)');
  ok(/open space on the right side\.$/.test(LP.bgPrompt('court', 'right')) && /open space in the middle\.$/.test(LP.bgPrompt('court')), '배경판 꼬리 = 인물이 설 자리를 비워 둔다');
  const STY = 'webtoon illustration style, vivid colors, detailed background, attractive good-looking characters (beautiful women, and handsome men) with pleasant faces, bright imagery';
  ok(LP.splitClauses(STY).length === 5, '그림체 마디 나누기(괄호 안 쉼표는 한 마디)');
  ok(LP.styleFor(STY, 'bg', P.PERSON_RE) === 'webtoon illustration style, vivid colors, detailed background, bright imagery', '배경판 그림체 = 사람 부르는 마디를 뺀다(실물 11-05: 이 마디로 배경판에 사람 다섯)');
  ok(LP.styleFor(STY, 'fig') === 'webtoon illustration style, vivid colors, attractive good-looking characters (beautiful women, and handsome men) with pleasant faces, bright imagery', '인물판 그림체 = 배경 부르는 마디를 뺀다');
  ok(!/women|everyone fully clothed/.test(LP.bgFull(STY, 'a court.', P.PERSON_RE)) && /^webtoon .*a court\. An empty place/.test(LP.bgFull(STY, 'a court.', P.PERSON_RE)), '배경판 최종 지시문에 사람·옷차림 문구가 없다');
  ok(/deserted and unoccupied/.test(LP.bgPrompt('a court.')) && LP.bgPrompt('a court.').startsWith('a court. ') && /#00FF00/.test(LP.figPrompt('a widow')) && LP.figPrompt('a widow').startsWith('a widow. '), '지시문은 앞을 그대로 두고 꼬리만 붙인다');

  console.log('[2] 색 빼기');
  const k1 = LP.keyFigure(figImg({ shade: true, speck: true }));
  ok(k1.ok && k1.stats.key.join() === '0,255,0', '바탕 = 테두리 가운데 값(초록) · 통과 ' + (k1.why || ''));
  ok(px(k1.img, 30, 200)[3] === 0, '그늘진 바탕도 투명');
  ok(px(k1.img, 20, 20)[3] === 0 && k1.stats.pieces >= 2 && k1.stats.kept === 1, '떨어진 먼지(빨강 점)는 지운다');
  ok(px(k1.img, 150, 100)[3] === 255 && px(k1.img, 150, 300)[3] === 255, '인물(살색 · 어두운 옷)은 불투명');
  const e = px(k1.img, 110, 100);
  ok(e[3] > 0 && e[1] <= Math.max(e[0], e[2]) + 2, '반쯤 섞인 가장자리 = 초록 번짐을 뺐다(G ≤ max(R,B)) ' + e.join());
  ok(k1.bbox.y0 === 60 && k1.bbox.y1 === 400, '인물 테두리 상자');
  const kb = LP.keyFigure(figImg({ bg: [0, 0, 255] }));
  ok(kb.ok && px(kb.img, 5, 5)[3] === 0, '파랑 바탕도 같은 식(바탕 색을 박지 않는다)');

  console.log('[3] 되돌림 판정');
  const noisy = figImg(); for (let i = 0; i < noisy.data.length; i += 4 * 3) { noisy.data[i] = 200; noisy.data[i + 1] = 60; noisy.data[i + 2] = 60; }
  ok(!LP.keyFigure(noisy).ok, '바탕이 단색이 아님 → 되돌림 · ' + LP.keyFigure(noisy).why);
  ok(/위 끝/.test(LP.keyFigure(figImg({ top: 0 })).why), '머리가 위 끝에 닿음 → 되돌림');
  ok(/옆 끝/.test(LP.keyFigure(figImg({ left: 0 })).why), '옆 끝에 닿음 → 되돌림');
  ok(/너무 작게/.test(LP.keyFigure(figImg({ top: 250, bottom: 380 })).why), '인물이 너무 작음 → 되돌림');
  ok(/바탕색이 남았|가장자리|거의 없/.test(LP.keyFigure(figImg({ greenShirt: true })).why || '') || !LP.keyFigure(figImg({ greenShirt: true })).ok, '초록 옷(바탕색과 같은 색) → 되돌림 · ' + LP.keyFigure(figImg({ greenShirt: true })).why);
  ok(/거의 없/.test(LP.keyFigure(figImg({ top: 200, bottom: 202, left: 150, right: 152 })).why), '인물이 거의 없음 → 되돌림');
  const gray = (v) => ({ w: 10, h: 10, data: Buffer.alloc(400, v) });
  const night = gray(30), day = { ...k1.img };
  const lc = LP.lightCheck(day, night);
  ok(!lc.ok && /빛 세기/.test(lc.why), '밤 배경 + 밝은 인물 → 빛이 안 맞음 ' + JSON.stringify(lc));
  ok(LP.lightCheck(day, gray(200)).ok, '밝기가 비슷하면 통과');

  console.log('[4] 그림자 · 박스');
  const plate = LP.composeFigure(k1, k1.bbox);
  ok(plate.w === k1.bbox.w + 2 * plate.meta.pl && plate.h === k1.bbox.h + plate.meta.pt + plate.meta.pb, '여백(옆 14% · 위 12% · 아래 4%)');
  const sh = px(plate, Math.round(plate.w / 2), plate.meta.feetY + 2);
  ok(sh[3] > 40 && sh[0] < 40, '발 바로 아래 = 어두운 반투명 그림자 ' + sh.join());
  ok(px(plate, 2, 2)[3] === 0, '여백 구석은 투명');
  const bx = LP.boxFor(plate);
  const s = (LP.FIG_H * 1080) / plate.meta.bh;
  ok(Math.abs(bx.y + (plate.meta.feetY * s) / 1080 - 1) < 0.001, '발 = 화면 아래 끝');
  ok(Math.abs(bx.x + bx.w / 2 - 0.5) < 0.001 && Math.abs((plate.meta.bh * s) / 1080 - LP.FIG_H) < 0.001, '가로 가운데 · 인물 키 = 화면 높이의 ' + LP.FIG_H);
  const bR = LP.boxFor(plate, 1920, 1080, 'right'), bL = LP.boxFor(plate, 1920, 1080, 'left');
  ok(Math.abs(bR.x + bR.w / 2 - 0.7) < 0.001 && Math.abs(bL.x + bL.w / 2 - 0.3) < 0.001 && bR.y === bx.y, '오른쪽 = 0.7 · 왼쪽 = 0.3(높이·발 자리는 같다)');

  console.log('[5] 층 움직임');
  const g0 = { num: 3, look: { motion: 'lr' } };
  ok(JSON.stringify(KB._kenBurnsForLook(g0)) === JSON.stringify(KB._kenBurnsForLook({ num: 3, look: { motion: 'lr' } })) && KB._kenBurnsForLook(g0).from.centerX === KB._clampKbFrame(KB.KEN_BURNS_PATTERNS[2].from).centerX, 'layerOk 없으면 예전 그대로');
  ok(JSON.stringify(KB._kenBurnsForLook({ ...g0, layered: true })) === JSON.stringify(KB._kenBurnsForLook(g0)), '판 따로 지시만 있고 그리지 못했으면(layerOk 없음) 예전 그대로 = 되돌림');
  const lb = KB._kenBurnsForLook({ ...g0, layerOk: true }), lf = KB.layerKb('fig');
  ok(lb.from.scale > lb.to.scale && Math.abs(1 / lb.to.scale - 1.07) < 0.002 && Math.abs(1 / lb.from.scale - 1.04) < 0.002, '배경판 = 1.04 → 1.07(느린 확대)');
  ok(lf.from.scale === 1 && Math.abs(1 / lf.to.scale - 1.07) < 0.002 && Math.abs(lf.to.centerY + lf.to.scale / 2 - 1) < 1e-6, '인물판 = 1.00 → 1.07 · 아래 끝(발) 고정');
  ok((1 / lf.to.scale) / (1 / lf.from.scale) > (1 / lb.to.scale) / (1 / lb.from.scale), '인물이 배경보다 더 빨리 커진다(깊이)');

  console.log('[6] .vrew 트랙 · 삽입 필드');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-'));
  try {
    const md2 = '# t\n## 장\n### 가\n> 🖼️ 이미지: x.\n> 🎞 판: 따로\n> 🖼️ 배경: b.\n> 🖼️ 인물: f.\n첫 문장입니다.\n### 나\n> 🖼️ 이미지: y.\n둘째 문장입니다.\n';
    const p2 = P.parseScriptText(md2, 'longform', {}).projects[0];
    const bgPng = path.join(tmp, 'bg.png'), g2 = path.join(tmp, 'g2.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x2060c0:s=1344x768', '-frames:v', '1', bgPng]);
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x808080:s=1344x768', '-frames:v', '1', g2]);
    const figPng = path.join(tmp, 'G01_인물.png');
    await LP.encodePng(plate, figPng);
    const back = await LP.decodeRgba(figPng);
    ok(back.w === plate.w && back.data.equals(plate.data), 'PNG 쓰기 → 읽기 = 같은 픽셀(알파 포함)');
    p2.groups[0].imagePath = bgPng; p2.groups[0].layerOk = true; p2.groups[1].imagePath = g2;
    p2.overlays = [{ id: 'lay1', file: figPng, name: 'G01_인물.png', kind: 'image', box: LP.boxFor(plate), kb: 'layerFig', dim: { w: plate.w, h: plate.h } }];
    OL.applyIds(p2.overlays[0], OL.idsFromGroups(p2, 1, 1));
    p2.sentences.forEach((se, i) => { const mp3 = path.join(tmp, `s${i}.mp3`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=d=3', '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', mp3]); se.ttsAudioPath = mp3; se.ttsDurationSec = 3; });
    const v = path.join(tmp, 't.vrew'); await P.buildProjectVrew(p2, v, {}, () => {}, 20, 1);
    const pj = JSON.parse(new AdmZip(v).readAsText('project.json'));
    const tr = Object.values(pj.props.tracks).filter((t) => t.type === 'image');
    const ovT = tr.find((t) => t.zIndex >= 900), g1T = tr.filter((t) => t.zIndex < 900)[0];
    const same = (a, b) => Math.abs(a.scale - b.scale) < 1e-4 && Math.abs(a.centerX - b.centerX) < 1e-4 && Math.abs(a.centerY - b.centerY) < 1e-4;
    ok(ovT && same(ovT.kenburnsAnimationInfo.from, lf.from) && same(ovT.kenburnsAnimationInfo.to, lf.to), '.vrew 인물판 트랙 = 층 움직임(fig)');
    ok(ovT && Math.abs(ovT.yPos - LP.boxFor(plate).y) < 1e-4 && Math.abs(ovT.height - LP.boxFor(plate).h) < 1e-4, '.vrew 인물판 박스 = boxFor');
    ok(g1T && same(g1T.kenburnsAnimationInfo.from, lb.from), '.vrew G1(배경판) 트랙 = 층 움직임(bg)');
    const snap = OL.toSnap(p2); const p3 = { ...p2, overlays: [] }; OL.fromSnap(p3, snap);
    ok(snap[0].kb === 'layerFig' && p3.overlays[0].kb === 'layerFig' && OL.toDTO(p2)[0].kb === 'layerFig', '삽입 필드 kb 가 작업본·DTO 를 건너간다');
    ok(!('kb' in OL.toSnap({ ...p2, overlays: [{ ...p2.overlays[0], kb: 'zzz' }] })[0]), '모르는 kb 값은 버린다');

    console.log('[7] MP4 에 층이 그려진다');
    const R = require('../core/vrew-render');
    const mp4 = path.join(tmp, 't.mp4');
    const res = await R.renderVrewToMp4({ vrewPath: v, outPath: mp4, log: () => {}, par: 2 });
    ok(res && res.ok, 'MP4 렌더 ' + (res && res.error ? res.error : ''));
    const frame = (t) => { const raw = execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=192:108', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 }); return (x, y) => [raw[(y * 192 + x) * 3], raw[(y * 192 + x) * 3 + 1], raw[(y * 192 + x) * 3 + 2]]; };
    const f0 = frame(0.3), f1 = frame(2.8);
    const isBg = (c) => c[2] > 150 && c[0] < 80;   // 0x2060c0
    const isSkin = (c) => c[0] > 150 && c[1] > 100 && c[2] < 160 && c[0] > c[2];
    ok(isBg(f0(10, 50)) && isBg(f0(180, 20)), '인물판 바깥 = 배경판(투명이 살아 있다) ' + f0(10, 50).join());
    // 인물 몸통 높이(살색 줄 수)를 처음 · 끝 프레임에서 센다
    const skinRows = (f) => { let n = 0; for (let y = 0; y < 108; y++) if (isSkin(f(96, y))) n++; return n; };
    const n0 = skinRows(f0), n1 = skinRows(f1);
    ok(n0 > 10, '가운데에 인물(살색)이 보인다 ' + n0 + '줄');
    ok(n1 > n0, '움직임 끝에 인물이 커졌다(' + n0 + ' → ' + n1 + '줄)');
    const dark = (c) => c[0] < 60 && c[2] < 120 && !isBg(c);
    ok(dark(f0(96, 106)) || dark(f0(96, 105)), '화면 아래 가운데 = 인물 아래쪽(어두운 옷 · 그림자)');
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }

  console.log('[8] 배선');
  const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  ok(/async function _orderLayerPlates\(/.test(M) && /_orderLayerPlates\(it, order, redoNums, L, cx\)/.test(M) && /_orderLayerPlates\(it, order, \[\], L, null\)/.test(M), '무인 주문이 판 그리기를 부른다(코덱스 편 · 되돌린 편은 로컬 Qwen)');
  ok(/const hasLayer = \(\) => it\.parsed\.projects\[0\]\.groups\.some\(\(g\) => g\.layered\)/.test(M) && (M.match(/if \(hasLayer\(\)\)/g) || []).length === 2, '판 따로 장면이 없으면 부르지 않는다');
  ok(/draw\(rec\.fullPrompts\.fig, \{ w: 768, h: 1344 \}, F\.figRaw, true\)/.test(M) && /if \(!chroma && await looksBadImage/.test(M), '초록 바탕 인물판은 형광 색깨짐 검사를 건너뛴다(실물 11-05 G1)');
  ok(/layerPlates:/.test(M) && /layerMethod:/.test(M) && /layerReverted: pr\.groups\.filter\(\(g\) => g\.layered && !g\.layerOk\)/.test(M), '결과서 칸(layerPlates · layerMethod · 되돌린 수 = 그리지 못한 장면)');
  ok(!/separat|rembg|birefnet|segment/i.test(fs.readFileSync(path.join(__dirname, '..', 'core', 'layer-plates.js'), 'utf8').replace(/분리 모델/g, '')), '분리 모델을 부르지 않는다(색 빼기만)');
  console.log(`\n${fail ? '❌' : '✅'} layer-plates ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
