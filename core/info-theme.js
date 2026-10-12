'use strict';
/**
 * info-theme.js — 📇 정보 카드의 「편마다·장면마다 달라지는 색과 자리」 — 2026-10-12 v0.8.5
 *   로이: 항상 같은 위치·같은 디자인이면 공장형 콘텐츠로 보인다 → 무작위가 아니라 **그림을 따르는 변주**.
 *   ① 색 = 그 편 그림들의 주된 색조에서 판 색(아주 어두운 톤)·강조색(채도 높은 보조 톤)을 뽑는다. 글자는 거의 흰색.
 *      🔴 대비는 코드가 지킨다 — 글자/판 명도 대비 4.5:1 미만이면 판을 더 어둡게(가독성이 색보다 먼저).
 *   ② 자리 = 낱말·확인표 판을 그 장면 그림의 **가장 빈 곳**(무늬·가장자리·살색이 적은 쪽)에. 한 `###` 장면 안에서는 자리를 바꾸지 않는다
 *      (장면이 바뀔 때만 · 큰 차이가 없으면 앞 장면 자리를 유지 — 판이 뛰어다니지 않게). 왼쪽 자리는 자막(왼쪽 아래)과 세로로 겹치지 않을 때만.
 *   ③ 모양 = 편마다 하나(막대·꼬리표·밑줄·테두리). 고르는 씨앗 = 편 고유값(대본 이름) — 다시 렌더해도 같은 결과.
 *   main(렌더) 전용 — ffmpeg 로 그림 한 장을 64x36 으로 줄여 읽는다. 실패하면 그 판은 예전 모양(오른쪽 가운데·고정 색)으로 둔다(fail-open).
 */
const { spawn } = require('child_process');
const IA = require('./info-ass');

const SHAPES = ['bar', 'tag', 'underline', 'frame'];
const GW = 64, GH = 36;
const TEXT_HEX = 'F4F1EA';

function hash32(str) { let h = 2166136261 >>> 0; for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;   // 끝섞기 — 비슷한 이름(정보_1015 · 정보_1110)이 같은 모양으로 몰리지 않게
  return h >>> 0; }

// ── 색 계산 ──────────────────────────────────────────────────────────────────
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const rgbOf = (hex) => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lumOf = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => { const la = lumOf(a), lb = lumOf(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
/** 불투명도 op 로 아래(가장 밝은 그림 = 흰색 최악)에 깔린 판의 실제 색 */
const under = (hex, op) => rgbOf(hex).map((v) => v * op + 255 * (1 - op));

/** 팔레트 → {bg, panel, accent, dim} · 글자 대비 4.5:1 이상을 보장(최악 = 흰 그림 위) */
function makePalette(h1, h2, sat) {
  const text = rgbOf(TEXT_HEX);
  let lp = 0.11, lb = 0.07;
  const sp = Math.max(0.25, Math.min(0.5, 0.2 + sat * 0.4));
  let panel = hslToHex(h1, sp, lp), bg = hslToHex(h1, Math.min(0.4, sp), lb);
  for (let i = 0; i < 20 && (ratio(text, under(panel, 0.84)) < 4.5 || ratio(text, under(bg, 0.92)) < 4.5); i++) {
    lp = Math.max(0.02, lp - 0.015); lb = Math.max(0.02, lb - 0.015);
    panel = hslToHex(h1, sp, lp); bg = hslToHex(h1, Math.min(0.4, sp), lb);
  }
  let la = 0.64, accent = hslToHex(h2, 0.82, la);
  for (let i = 0; i < 20 && ratio(rgbOf(accent), under(bg, 0.92)) < 4.5; i++) { la = Math.min(0.9, la + 0.02); accent = hslToHex(h2, 0.82, la); }
  let ld = 0.62, dim = hslToHex(h1, 0.12, ld);
  for (let i = 0; i < 20 && ratio(rgbOf(dim), under(panel, 0.84)) < 4.5; i++) { ld = Math.min(0.9, ld + 0.02); dim = hslToHex(h1, 0.12, ld); }
  return { bg, panel, accent, dim };
}

// ── 그림 읽기(64x36) ─────────────────────────────────────────────────────────
function grabFrame(ffmpeg, file, rel) {
  return new Promise((resolve) => {
    const args = ['-v', 'error', ...(rel > 0 ? ['-ss', String(rel)] : []), '-i', file, '-frames:v', '1', '-vf', `scale=${GW}:${GH}:flags=area`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'];
    let done = false; const chunks = [];
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    let ps; try { ps = spawn(ffmpeg, args, { windowsHide: true }); } catch (_) { return fin(null); }
    const to = setTimeout(() => { try { ps.kill(); } catch (_) {} fin(null); }, 15000);
    ps.stdout.on('data', (d) => chunks.push(d));
    ps.on('error', () => { clearTimeout(to); fin(null); });
    ps.on('close', () => { clearTimeout(to); const b = Buffer.concat(chunks); fin(b.length >= GW * GH * 3 ? b.subarray(0, GW * GH * 3) : null); });
  });
}
function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx === 0 ? 0 : d / mx, mx];
}
/** 그림들 → 주된 색조 {h1, h2, sat} (색이 거의 없으면 null) */
function dominantHues(frames) {
  const bins = new Array(36).fill(0); let wSum = 0, sSum = 0;
  for (const f of frames) for (let i = 0; i < GW * GH; i++) {
    const [h, s, v] = rgb2hsv(f[i * 3], f[i * 3 + 1], f[i * 3 + 2]);
    const w = s * v * (v > 0.12 ? 1 : 0); if (w <= 0) continue;
    bins[Math.min(35, Math.floor(h / 10))] += w; wSum += w; sSum += s * w;
  }
  if (!(wSum > frames.length * GW * GH * 0.02)) return null;   // 거의 무채색 — 고정 색으로
  const sm = bins.map((_, i) => bins[(i + 35) % 36] * 0.5 + bins[i] + bins[(i + 1) % 36] * 0.5);   // 이웃 칸을 섞어 부드럽게
  const i1 = sm.indexOf(Math.max(...sm));
  const h1 = i1 * 10 + 5;
  let i2 = -1, best = 0;
  for (let i = 0; i < 36; i++) { const dd = Math.min(Math.abs(i - i1), 36 - Math.abs(i - i1)); if (dd >= 4 && sm[i] > best) { best = sm[i]; i2 = i; } }
  const h2 = i2 >= 0 && best >= sm[i1] * 0.35 ? i2 * 10 + 5 : h1 + 28;
  return { h1, h2, sat: sSum / wSum };
}
/** 살색(얼굴·손) 화소인가 — 색조 5~30° · 채도 0.34~0.7 · 밝기 85~205. 🔴 색만으로는 얼굴을 못 가린다(베이지 벽·흙·지붕도 비슷하다) — 그래서 채도를 높게 잡고 아래에서 덩어리로 본다 */
function isSkin(r, g, b) {
  const [h, sat] = rgb2hsv(r, g, b), y = 0.299 * r + 0.587 * g + 0.114 * b;
  return h >= 5 && h <= 30 && sat >= 0.34 && sat <= 0.7 && y >= 85 && y <= 205;
}
/** 구역 안 「살색 덩어리」 칸 수 — 살색 칸 중 가로·세로로 이웃한 살색 칸이 모두 있는 칸(문틀 같은 세로선·흩어진 점은 뺀다) */
function regionSkin(f, x0, y0, w, h) {
  const gx0 = Math.max(0, Math.floor(x0 / 30)), gy0 = Math.max(0, Math.floor(y0 / 30)), gx1 = Math.min(GW - 1, Math.ceil((x0 + w) / 30)), gy1 = Math.min(GH - 1, Math.ceil((y0 + h) / 30));
  const sk = (x, y) => { if (x < 0 || y < 0 || x >= GW || y >= GH) return false; const i = (y * GW + x) * 3; return isSkin(f[i], f[i + 1], f[i + 2]); };
  let n = 0, blob = 0;
  for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) { n++; if (sk(x, y) && (sk(x - 1, y) || sk(x + 1, y)) && (sk(x, y - 1) || sk(x, y + 1))) blob++; }
  return { cells: blob, frac: n ? blob / n : 0 };
}
const FACE_VETO = (r) => r.cells >= 4;   // 판이 덮는 곳에 살색 덩어리 칸이 4개 이상이면 그 자리는 점수 비교 전에 탈락(썸네일 규약 「얼굴 가림」)
/** 빈 자리 점수(작을수록 비어 있음) — 가장자리(그림 기울기) + 밝기 흩어짐 + 살색 비율(작은 가중) */
function regionScore(f, x0, y0, w, h) {
  const gx0 = Math.max(0, Math.floor(x0 / 30)), gy0 = Math.max(0, Math.floor(y0 / 30)), gx1 = Math.min(GW - 1, Math.ceil((x0 + w) / 30)), gy1 = Math.min(GH - 1, Math.ceil((y0 + h) / 30));
  const Y = (x, y) => { const i = (y * GW + x) * 3; return 0.299 * f[i] + 0.587 * f[i + 1] + 0.114 * f[i + 2]; };
  let n = 0, grad = 0, sum = 0, sum2 = 0;
  for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) {
    const l = Y(x, y); n++; sum += l; sum2 += l * l;
    if (x < GW - 1) grad += Math.abs(Y(x + 1, y) - l); if (y < GH - 1) grad += Math.abs(Y(x, y + 1) - l);
  }
  if (!n) return 9;
  const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return (grad / n / 255) * 4 + sd / 128 + regionSkin(f, x0, y0, w, h).frac * 2;
}

/**
 * 판마다 p.theme = {colors, shape, pos} 를 단다.
 * @param opts.seed      편 고유값(대본 이름) — 모양·같은 점수일 때의 순서를 정한다
 * @param opts.segAt     (t) => {file, rel} | null — 그 시각 화면의 그림(.vrew 타임라인)
 * @param opts.total     영상 길이(초) — 팔레트용 표본을 고르게 뽑는다
 * @param opts.capBottom 자막이 아래쪽인가(아니면 왼쪽 자리를 쓰지 않는다)
 * @returns {summary} 로그용 요약 · 실패해도 던지지 않는다(그 판은 예전 모양)
 */
async function assign(panels, opts = {}) {
  const { seed = '', segAt, total = 0, capBottom = true, ffmpeg, log = () => {} } = opts;
  const sh = hash32(seed);
  const shape = SHAPES[sh % SHAPES.length];
  const cache = new Map();
  const frameAt = async (t) => {
    const s = segAt && segAt(t); if (!s || !s.file) return null;
    const k = s.file + '|' + Math.round(s.rel || 0);
    if (!cache.has(k)) cache.set(k, await grabFrame(ffmpeg, s.file, s.rel || 0));
    return cache.get(k);
  };
  // ① 팔레트 — 영상 전체에서 고르게 뽑은 그림들
  const frames = [];
  const N = Math.max(1, Math.min(18, Math.round(total / 20)));
  for (let i = 0; i < N; i++) { const f = await frameAt(((i + 0.5) / N) * total); if (f) frames.push(f); }
  const hues = frames.length ? dominantHues(frames) : null;
  const colors = hues ? makePalette(hues.h1, hues.h2, hues.sat) : null;
  // ② 자리 — 장면(### 그룹)마다 한 번 · 앞 장면과 큰 차이가 없으면 유지
  const order = IA.POS.map((p, i) => ({ p, i })).sort((a, b) => ((a.i + sh) % 4) - ((b.i + sh) % 4)).map((x) => x.p);
  const scenePos = new Map(); let prev = null; const sceneLog = [];
  const sideOk = (pos, size) => !(pos === 'lc' || pos === 'lt') || (capBottom && placeBottom(pos, size) <= 800);
  const placeBottom = (pos, size) => { const b = IA.placeBox(pos, size.w, size.h); return b.y0 + size.h; };
  const items = panels.filter((q) => q.type === 'words' || q.type === 'check').sort((a, b) => a.t0 - b.t0);
  const warnScenes = [];
  for (const q of items) {
    const key = q.scene != null ? q.scene : 'p' + Math.round(q.t0);
    if (scenePos.has(key)) continue;
    if (q.posTag) { scenePos.set(key, q.posTag); prev = q.posTag; sceneLog.push(`${key}:${q.posTag}(대본)`); continue; }   // 대본 꼬리표(@왼쪽위)가 이긴다
    const size = IA.sizeOf(q, shape); let pos = 'rc';
    try {
      const f = size ? await frameAt(q.t0 + 0.3) : null;
      if (f && size) {
        const all = order.filter((p) => sideOk(p, size)).map((p, i) => {
          const b = IA.placeBox(p, size.w, size.h), sk = regionSkin(f, b.x0, b.y0, size.w, size.h);
          return { p, i, skin: sk, veto: FACE_VETO(sk), s: regionScore(f, b.x0 - 20, b.y0 - 20, size.w + 40, size.h + 40) + i * 0.002 };
        });
        let cands = all.filter((c) => !c.veto);   // 🔴 얼굴 가림 = 거부권(점수 비교 전에 탈락)
        if (!cands.length) {
          cands = [...all].sort((a, b) => a.skin.frac - b.skin.frac).slice(0, 1);
          warnScenes.push(`G${typeof key === 'number' ? key + 1 : key}`);
          log(`   ⚠ 정보 카드 — 장면 G${typeof key === 'number' ? key + 1 : key}: 네 자리 모두 사람 얼굴·손을 덮을 수 있어 가장 덜 덮는 자리(${cands[0].p})로 둡니다(대본에 @왼쪽위 같은 꼬리표로 직접 정할 수 있습니다)`);
        }
        // 💡 대본 🖼️ 프롬프트의 「인물 left/right of centre」 → 반대쪽 판을 1순위 후보로
        if (q.hint) { const side = cands.filter((c) => (q.hint === 'left' ? /^l/ : /^r/).test(c.p)); if (side.length) cands = side; }
        cands.sort((a, b) => a.s - b.s);
        const keep = prev && cands.find((c) => c.p === prev);
        pos = keep && !(cands[0].s < keep.s * 0.75) ? prev : cands[0].p;
        sceneLog.push(`${key}:${pos}`);
      } else pos = prev || 'rc';
    } catch (_) { pos = prev || 'rc'; }
    scenePos.set(key, pos); prev = pos;
  }
  for (const q of panels) {
    const key = q.scene != null ? q.scene : 'p' + Math.round(q.t0);
    let pos = scenePos.get(key) || 'rc';
    if (q.type === 'words' || q.type === 'check') { const size = IA.sizeOf(q, shape); if (size && !sideOk(pos, size)) pos = 'rc'; }
    q.theme = { shape, pos, ...(colors ? { colors } : {}) };
    q._prims = null;   // 배치 다시
  }
  const summary = `shape=${shape} · 색 ${colors ? `판 #${colors.panel} 강조 #${colors.accent}` : '고정(그림에 색이 거의 없음)'} · 자리 ${sceneLog.join(' ') || '(낱말·확인표 없음)'}`;
  log(`   🎨 정보 카드 변주 — ${summary}`);
  return { shape, colors, scenePos: Object.fromEntries(scenePos), summary };
}

module.exports = { assign, makePalette, dominantHues, regionScore, regionSkin, isSkin, FACE_VETO, hash32, ratio, under, hslToHex, SHAPES, TEXT_HEX };
