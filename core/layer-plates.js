'use strict';
/**
 * layer-plates.js — 🎞 ㊸ 판 따로(인물판 · 배경판을 처음부터 두 장 · 2.0 덧붙임4 ⓒ · v1.0.33)
 *
 *   장면(`###`)에 `> 🎞 판: 따로` + `> 🖼️ 배경: …` + `> 🖼️ 인물: …` (core/scene-directives 가 g.layered · g.layerPrompts 로 얹는다)
 *   → main `_orderLayerPlates` 가 배경판(16:9 · 사람 없는 장면)과 인물판(세로 · 단색 바탕)을 그리고 여기서
 *     ① 인물판의 단색 바탕을 **색으로 뺀다**(크로마키 · 분리 모델 없음 = ⑩ 라이선스 문제 없음)
 *     ② 점검한다(바탕이 단색인가 · 인물이 잘렸나 · 가장자리 · 남은 바탕색 · 크기 · 빛 세기) — 어긋나면 그 장면은 한 장으로 되돌린다(까닭은 결과서)
 *     ③ 발밑 그림자를 구워 넣은 투명 PNG 를 만든다 → 그룹 그림 = 배경판(느린 층 움직임) · 삽입 그림(overlay · kb 'layerFig') = 인물판
 *   층 움직임 값은 core/ken-burns LAYER_KB 한 곳(기준 = 2.0 시연 render_demo.py seg3).
 *   🔒 순수 계산(키 · 점검 · 그림자 · 박스)은 RGBA 버퍼만 다룬다 — 파일 읽기·쓰기는 아래 decode/encode(ffmpeg) 만.
 *   ⚠ 렌더러 번들에서 import 하지 않는다(main 전용).
 */
const DIR = '_판';

// 판 그리는 법이 바뀌면 올린다 — 기록(Gnn.json)의 값과 다르면 지시문이 같아도 다시 그린다
const RECIPE = 3;
/** 배경판 · 인물판 지시문 — 2.0 지시문 뒤에 꼬리만 붙인다(지시문을 바꾸지 않는다) */
const POS_X = { left: 0.3, right: 0.7 };   // 인물판 가로 가운데(화면 비율) · 없으면 0.5
const POS_WORD = { left: 'on the left side', right: 'on the right side' };
function bgPrompt(p, pos) {
  return `${String(p || '').trim().replace(/[.。]\s*$/, '')}. An empty place with nobody in it, deserted and unoccupied, wide establishing view with open space ${POS_WORD[pos] || 'in the middle'}.`;
}
/** 🎨 코덱스 인물판(transparent_background) — 초록 바탕 대신 투명 배경 */
function figPromptT(p) {
  return `${String(p || '').trim().replace(/[.。]\s*$/, '')}. One single full-body figure standing, the whole body visible from head to feet with empty space above the head and beside the body, centered, on a fully transparent background with nothing else in the picture.`;
}
/** 그림체 문구를 마디(쉼표 · 괄호 안은 한 마디)로 나눈다 */
function splitClauses(s) {
  const out = []; let cur = '', depth = 0;
  for (const ch of String(s || '')) {
    if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && !depth) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/**
 * 판마다 그림체 문구 다듬기 — 그림체(화풍 · 색 · 붓질)는 두고, 판과 부딪는 마디만 뺀다.
 *   배경판 = 사람을 부르는 마디(「attractive characters (beautiful women and handsome men)」 등 · PERSON_RE)를 뺀다 — 실물 11-05: 이 마디 때문에 배경판에 사람 다섯이 그려졌다.
 *   인물판 = 배경을 부르는 마디(「detailed background」 등)를 뺀다 — 바탕은 단색이어야 한다.
 */
const BG_WORD_RE = /\b(?:background|backgrounds|scenery|landscape|environment|setting|backdrop)\b/i;
function styleFor(stylePrompt, part, personRe) {
  const cl = splitClauses(stylePrompt);
  return (part === 'bg' ? cl.filter((c) => !(personRe && personRe.test(c))) : cl.filter((c) => !BG_WORD_RE.test(c))).join(', ');
}
/** 배경판 최종 지시문 = 다듬은 그림체 + 지시문 + 꼬리(사람·옷차림 문구를 더하는 공용 조립은 쓰지 않는다 — 사람을 부른다) */
function bgFull(stylePrompt, p, personRe, pos) { const st = styleFor(stylePrompt, 'bg', personRe); return (st ? st + ', ' : '') + bgPrompt(p, pos); }
function figPrompt(p) {
  return `${String(p || '').trim().replace(/[.。]\s*$/, '')}. One single full-body figure standing, the whole body visible from head to feet with empty space above the head and beside the body, centered, `
    + 'isolated on a flat uniform pure green chroma key studio backdrop (#00FF00), evenly lit plain green background with nothing else on it, clothing and props in colors other than green.';
}

// ── 색 공간(YCbCr · BT.601 전대역) ──
const yOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const cbOf = (r, g, b) => -0.168736 * r - 0.331264 * g + 0.5 * b;   // 0 중심
const crOf = (r, g, b) => 0.5 * r - 0.418688 * g - 0.081312 * b;
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
function median(arr) { const a = Float64Array.from(arr).sort(); return a.length ? a[a.length >> 1] : 0; }

/** 테두리(4px)의 가운데 값 = 바탕색 · 테두리가 그 색에 얼마나 고른지 */
function borderKey(img, hiK) {
  const { w, h, data } = img, B = Math.max(2, Math.min(4, Math.floor(Math.min(w, h) / 20)));
  const rs = [], gs = [], bs = [], idx = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= B && x < w - B && y >= B && y < h - B) continue;
    const i = (y * w + x) * 4; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); idx.push(i);
  }
  const K = { r: median(rs), g: median(gs), b: median(bs) };
  const kcb = cbOf(K.r, K.g, K.b), kcr = crOf(K.r, K.g, K.b), ky = yOf(K.r, K.g, K.b);
  const key = { K, kcb, kcr, ky, chroma: Math.hypot(kcb, kcr) };
  // 고른가 = 테두리 픽셀이 바탕으로 빠지는 비율(그늘·조명 차이는 바탕으로 친다 — 색 방향으로 판정)
  const kf = keynessFn(key); let near = 0;
  for (const i of idx) { const r = data[i], g = data[i + 1], b = data[i + 2]; if (kf(cbOf(r, g, b), crOf(r, g, b)).k >= (hiK || 40)) near++; }
  key.uniform = idx.length ? near / idx.length : 0;
  return key;
}

/** 픽셀이 바탕색 쪽인 정도 — 바탕색 방향 성분 − 1.5 × 옆 성분(어두운 그늘 바탕도 잡고 · 살색·회색·검정은 음수) */
function keynessFn(key) {
  const ux = key.kcb / (key.chroma || 1), uy = key.kcr / (key.chroma || 1);
  return (cb, cr) => { const proj = cb * ux + cr * uy; const px = cb - proj * ux, py = cr - proj * uy; return { proj, k: proj - 1.5 * Math.hypot(px, py), ux, uy }; };
}

/**
 * 인물판 색 빼기 + 점검 — img = { w, h, data: RGBA Uint8 } → { ok, why, img(투명 · 자르기 전), bbox, stats }
 *   opts.lo/hi = 바탕 정도 문턱(이하 = 불투명 · 이상 = 투명)
 */
function keyFigure(img, opts = {}) {
  const LO = opts.lo != null ? opts.lo : 15, HI = opts.hi != null ? opts.hi : 40;
  const { w, h, data } = img, N = w * h;
  const key = borderKey(img, HI);
  const stats = { key: [key.K.r, key.K.g, key.K.b].map(Math.round), keyChroma: Math.round(key.chroma), borderUniform: Math.round(key.uniform * 1000) / 1000 };
  if (key.chroma < 40) return { ok: false, why: `인물판 바탕이 뚜렷한 단색이 아닙니다(바탕 색 진하기 ${Math.round(key.chroma)} < 40)`, stats };
  if (key.uniform < 0.7) return { ok: false, why: `인물판 바탕이 고른 단색이 아닙니다(테두리 ${Math.round(key.uniform * 100)}% 만 바탕색)`, stats };
  const kf = keynessFn(key);
  const out = Buffer.alloc(N * 4);
  const alpha = new Float32Array(N), keyLeft = new Uint8Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const Y = yOf(r, g, b), cb = cbOf(r, g, b), cr = crOf(r, g, b);
    const { proj, k, ux, uy } = kf(cb, cr);
    const a = k <= LO ? 1 : k >= HI ? 0 : 1 - (k - LO) / (HI - LO);
    alpha[p] = a;
    if (a > 0.5 && k > LO) keyLeft[p] = 1;   // 불투명으로 남았지만 바탕 쪽으로 기운 픽셀
    // 바탕색 번짐 빼기(despill) — 바탕색 방향 성분만 덜어 낸다(밝기는 그대로)
    const s = proj > 0 ? proj : 0, cb2 = cb - s * ux, cr2 = cr - s * uy;
    out[i] = clamp8(Y + 1.402 * cr2); out[i + 1] = clamp8(Y - 0.344136 * cb2 - 0.714136 * cr2); out[i + 2] = clamp8(Y + 1.772 * cb2);
    out[i + 3] = clamp8(a * 255);
  }
  return _finishFigure(w, h, alpha, out, keyLeft, stats);
}
/**
 * 🎨 처음부터 투명한 인물판(코덱스 transparent_background · ㊳) — 색 빼기 없이 알파를 그대로 쓰고 같은 점검을 한다
 *   알파가 없거나(불투명 95% 넘음) 인물이 잘렸으면 되돌림.
 */
function alphaFigure(img) {
  const { w, h, data } = img, N = w * h;
  const alpha = new Float32Array(N), out = Buffer.from(data), keyLeft = new Uint8Array(N);
  let op = 0; for (let p = 0; p < N; p++) { alpha[p] = data[p * 4 + 3] / 255; if (alpha[p] > 0.5) op++; }
  const stats = { key: null, transparentSource: true };
  if (op / N > 0.95) return { ok: false, why: `인물판이 투명 배경으로 오지 않았습니다(불투명 ${Math.round(op / N * 100)}%)`, stats };
  return _finishFigure(w, h, alpha, out, keyLeft, stats);
}
function _finishFigure(w, h, alpha, out, keyLeft, stats) {
  const N = w * h;
  // 떨어진 작은 조각(바탕의 얼룩 · 먼지) 지우기 — 가장 큰 덩어리와 그 10% 이상만 남긴다
  const lab = new Int32Array(N).fill(-1), sizes = [];
  const stack = new Int32Array(N);
  for (let p = 0; p < N; p++) {
    if (lab[p] !== -1 || alpha[p] <= 0.5) continue;
    const id = sizes.length; let n = 0, sp = 0; stack[sp++] = p; lab[p] = id;
    while (sp) {
      const q = stack[--sp]; n++;
      const x = q % w, y = (q / w) | 0;
      if (x > 0 && lab[q - 1] === -1 && alpha[q - 1] > 0.5) { lab[q - 1] = id; stack[sp++] = q - 1; }
      if (x < w - 1 && lab[q + 1] === -1 && alpha[q + 1] > 0.5) { lab[q + 1] = id; stack[sp++] = q + 1; }
      if (y > 0 && lab[q - w] === -1 && alpha[q - w] > 0.5) { lab[q - w] = id; stack[sp++] = q - w; }
      if (y < h - 1 && lab[q + w] === -1 && alpha[q + w] > 0.5) { lab[q + w] = id; stack[sp++] = q + w; }
    }
    sizes.push(n);
  }
  const big = sizes.length ? Math.max(...sizes) : 0;
  const keep = sizes.map((n) => n >= big * 0.1);
  // 남긴 덩어리 근처(2px)의 반투명만 두고, 나머지 반투명 먼지는 지운다
  const near = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (lab[p] >= 0 && keep[lab[p]]) near[p] = 1;
  for (let pass = 0; pass < 2; pass++) {
    const nb = Uint8Array.from(near);
    for (let p = 0; p < N; p++) if (!near[p]) { const x = p % w; if ((x > 0 && near[p - 1]) || (x < w - 1 && near[p + 1]) || (p >= w && near[p - w]) || (p < N - w && near[p + w])) nb[p] = 1; }
    near.set(nb);
  }
  let opaque = 0, partial = 0, left = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let p = 0; p < N; p++) {
    if (!near[p] || (lab[p] >= 0 && !keep[lab[p]])) { alpha[p] = 0; out[p * 4 + 3] = 0; continue; }
    const a = alpha[p];
    if (a > 0.5) {
      opaque++; if (keyLeft[p]) left++;
      const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    } else if (a > 0.05) partial++;
  }
  Object.assign(stats, { opaqueFrac: r3(opaque / N), edgeFrac: opaque ? r3(partial / opaque) : null, keyLeftFrac: opaque ? r3(left / opaque) : null, pieces: sizes.length, kept: keep.filter(Boolean).length });
  const res = { ok: false, img: { w, h, data: out }, stats };
  if (opaque / N < 0.04) return { ...res, why: `인물판에 인물이 거의 없습니다(불투명 ${Math.round(opaque / N * 100)}%)` };
  if (opaque / N > 0.8) return { ...res, why: `인물판 바탕이 빠지지 않았습니다(불투명 ${Math.round(opaque / N * 100)}%)` };
  const bbox = { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  Object.assign(res, { bbox }); stats.bbox = bbox; stats.figHeightFrac = r3(bbox.h / h);
  const edge = Math.max(2, Math.round(Math.min(w, h) * 0.004));
  if (y0 <= edge) return { ...res, why: '인물 머리가 그림 위 끝에 닿았습니다(잘렸을 수 있음)' };
  if (x0 <= edge || x1 >= w - 1 - edge) return { ...res, why: '인물이 그림 옆 끝에 닿았습니다(잘렸을 수 있음)' };
  if (bbox.h < h * 0.45) return { ...res, why: `인물이 너무 작게 그려졌습니다(그림 높이의 ${Math.round(bbox.h / h * 100)}%)` };
  if (partial / opaque > 0.12) return { ...res, why: `인물 가장자리가 지저분합니다(반투명 ${Math.round(partial / opaque * 100)}%)` };
  if (left / opaque > 0.03) return { ...res, why: `인물 안에 바탕색이 남았습니다(${Math.round(left / opaque * 100)}%)` };
  // 인물이 크게 둘 이상으로 갈림 = 옷·물건이 바탕색과 같아 빠져 버렸을 수 있다
  const ks = sizes.filter((n) => n >= big * 0.1).sort((a, b) => b - a);
  if (ks.length > 1 && ks[1] >= ks[0] * 0.25) return { ...res, why: `인물이 여러 조각으로 갈렸습니다(${ks.length}조각 — 바탕색과 같은 색이 인물 안에 있을 수 있음)` };
  // 바깥과 이어지지 않은 투명 구멍(인물 안이 빠짐) — 팔·지팡이와 몸 사이 같은 틈은 넘긴다(15% — 실물 11-05 목동 소년 7% 가 정상 틈이었다)
  const seen = new Uint8Array(N); let sp2 = 0, holes = 0, transparent = 0;
  for (let p = 0; p < N; p++) { const x = p % w, y = (p / w) | 0; if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && alpha[p] <= 0.5) { seen[p] = 1; stack[sp2++] = p; } }
  while (sp2) { const q = stack[--sp2]; const x = q % w; for (const nb of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) if (nb >= 0 && nb < N && !seen[nb] && alpha[nb] <= 0.5) { seen[nb] = 1; stack[sp2++] = nb; } }
  for (let p = 0; p < N; p++) if (alpha[p] <= 0.5) { transparent++; if (!seen[p]) holes++; }
  stats.holeFrac = r3(holes / opaque);
  if (holes / opaque > 0.15) return { ...res, why: `인물 안이 투명하게 빠졌습니다(${Math.round(holes / opaque * 100)}% — 바탕색과 같은 색이 인물 안에 있을 수 있음)` };
  return { ...res, ok: true, why: '' };
}
const r3 = (x) => Math.round(x * 1000) / 1000;

/** 밝기 90번째 백분위(0..1) — mask(알파) 가 있으면 불투명 픽셀만 */
function lumaP90(img, useAlpha) {
  const { w, h, data } = img, hist = new Uint32Array(256); let n = 0;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    if (useAlpha && data[i + 3] < 128) continue;
    hist[clamp8(yOf(data[i], data[i + 1], data[i + 2]))]++; n++;
  }
  if (!n) return null;
  let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.9) return r3(v / 255); }
  return 1;
}
/** 빛 세기 맞음 — 인물·배경의 밝은 쪽(90%) 차이가 0.4 넘으면 어긋남(밤 배경 + 낮 인물 같은 것) */
function lightCheck(figImg, bgImg) {
  const f = lumaP90(figImg, true), b = lumaP90(bgImg, false);
  if (f == null || b == null) return { ok: true, fig: f, bg: b };
  return { ok: Math.abs(f - b) <= 0.4, fig: f, bg: b, why: Math.abs(f - b) > 0.4 ? `인물판과 배경판의 빛 세기가 맞지 않습니다(밝은 쪽 ${f} 대 ${b})` : '' };
}

/**
 * 자르기 + 여백 + 발밑 그림자 → 투명 PNG 버퍼 { w, h, data, meta }
 *   여백: 옆 14% · 위 12% · 아래 4%(그림자) — 층 움직임(최대 7% 확대)이 인물을 자르지 않게.
 *   그림자 = 시연 seg3 의 타원(어두운 밤색 · 불투명 0.55 · 흐림) — 발 가운데 아래.
 */
function composeFigure(keyed, bbox) {
  const src = keyed.img;
  const bw = bbox.w, bh = bbox.h;
  const pl = Math.round(bw * 0.14), pt = Math.round(bh * 0.12), pb = Math.round(bh * 0.04);
  const W = bw + pl * 2, H = bh + pt + pb;
  const out = Buffer.alloc(W * H * 4);
  // 발 가운데 = 인물 맨 아래 3% 줄의 불투명 픽셀 가로 평균
  let sx = 0, sn = 0;
  for (let y = Math.max(bbox.y0, bbox.y1 - Math.round(bh * 0.03)); y <= bbox.y1; y++) for (let x = bbox.x0; x <= bbox.x1; x++) if (src.data[(y * src.w + x) * 4 + 3] > 128) { sx += x; sn++; }
  const feetX = pl + (sn ? sx / sn - bbox.x0 : bw / 2), feetY = pt + bh - bh * 0.01;
  const rx = Math.max(12, bw * 0.42), ry = Math.max(5, bh * 0.032);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const dx = (x - feetX) / rx, dy = (y - feetY) / ry;
    const sa = 0.55 * Math.exp(-2.2 * (dx * dx + dy * dy));   // 그림자 알파
    let fr = 0, fg = 0, fb = 0, fa = 0;
    const sxp = x - pl + bbox.x0, syp = y - pt + bbox.y0;
    if (sxp >= bbox.x0 && sxp <= bbox.x1 && syp >= bbox.y0 && syp <= bbox.y1) {
      const i = (syp * src.w + sxp) * 4; fr = src.data[i]; fg = src.data[i + 1]; fb = src.data[i + 2]; fa = src.data[i + 3] / 255;
    }
    const a = fa + sa * (1 - fa);
    if (a <= 0) continue;
    out[o] = clamp8((fr * fa + 13 * sa * (1 - fa)) / a); out[o + 1] = clamp8((fg * fa + 8 * sa * (1 - fa)) / a); out[o + 2] = clamp8((fb * fa + 0 * sa * (1 - fa)) / a);
    out[o + 3] = clamp8(a * 255);
  }
  return { w: W, h: H, data: out, meta: { pl, pt, pb, bw, bh, feetY: pt + bh } };
}

/**
 * 인물판 삽입 박스(캔버스 0..1) — 인물 몸 높이 = 화면 높이의 FIG_H · 발 = 화면 아래 끝 · 가로 가운데
 *   meta = composeFigure().meta · cW×cH = 캔버스(16:9 = 1920×1080)
 */
const FIG_H = 0.86;
function boxFor(plate, cW = 1920, cH = 1080, pos = null) {
  const s = (FIG_H * cH) / plate.meta.bh;
  const bw = (plate.w * s) / cW, bh = (plate.h * s) / cH;
  const y = 1 - (plate.meta.feetY * s) / cH;
  const cx = Math.min(1 - bw / 2, Math.max(bw / 2, POS_X[pos] || 0.5));   // 왼쪽 · 오른쪽 자리(화면 밖으로 나가지 않게)
  return { x: r4(cx - bw / 2), y: r4(y), w: r4(bw), h: r4(bh) };
}
const r4 = (x) => Math.round(x * 10000) / 10000;

// ── 파일(ffmpeg) — main 에서만 ──
function _ff() { return require('./media-utils').getFfmpegPath(); }
async function decodeRgba(file) {
  const z = require('../vrew/vrew-builder').readImageSize(file);
  if (!z || !(z.w > 0)) throw new Error('그림 크기를 읽지 못했습니다 — ' + file);
  const data = await new Promise((res, rej) => {
    const cp = require('child_process').spawn(_ff(), ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { windowsHide: true });
    const bufs = []; let err = '';
    cp.stdout.on('data', (b) => bufs.push(b)); cp.stderr.on('data', (b) => { err += b; });
    cp.on('error', rej); cp.on('close', (c) => (c === 0 ? res(Buffer.concat(bufs)) : rej(new Error('ffmpeg 읽기 실패 — ' + err.slice(0, 200)))));
  });
  if (data.length !== z.w * z.h * 4) throw new Error(`그림 픽셀 수가 맞지 않습니다(${data.length} ≠ ${z.w}×${z.h}×4)`);
  return { w: z.w, h: z.h, data };
}
async function encodePng(img, outPath) {
  const tmp = outPath + '.tmp.png';
  await new Promise((res, rej) => {
    const cp = require('child_process').spawn(_ff(), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${img.w}x${img.h}`, '-i', '-', '-frames:v', '1', '-pix_fmt', 'rgba', tmp], { windowsHide: true });
    let err = ''; cp.stderr.on('data', (b) => { err += b; });
    cp.on('error', rej); cp.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg 쓰기 실패 — ' + err.slice(0, 200)))));
    cp.stdin.on('error', () => {}); cp.stdin.end(img.data);
  });
  require('fs').renameSync(tmp, outPath);
  return outPath;
}

/** 파일 이름 — <편>/_판/G03_배경.png · G03_인물_원본.png · G03_인물.png(투명 + 그림자) · G03.json(기록) */
function pathsOf(outRoot, num) {
  const path = require('path'); const b = path.join(outRoot, DIR, 'G' + String(num).padStart(2, '0'));
  return { dir: path.join(outRoot, DIR), bg: b + '_배경.png', figRaw: b + '_인물_원본.png', fig: b + '_인물.png', json: b + '.json' };
}

module.exports = { DIR, FIG_H, RECIPE, bgPrompt, figPrompt, figPromptT, splitClauses, styleFor, bgFull, borderKey, keyFigure, alphaFigure, lumaP90, lightCheck, composeFigure, boxFor, decodeRgba, encodePng, pathsOf };
