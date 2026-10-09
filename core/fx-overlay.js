'use strict';
/**
 * fx-overlay.js — 🌫 화면 오버레이 모션(삼국지 R1 · v0.7.77) — 정지 이미지 위에 **코드로 만든** 안개 · 먼지 · 반딧불 · 불빛 깜박임을 얹는다.
 *   · 외부 영상 소스 없음(전부 ffmpeg lavfi 로 한 번 만든 작은 질감 PNG + 시각 t 로 천천히 움직이는 필터) · 느리고 약하게(취침용) · 강도 1~3단계.
 *   · 🎬 MP4 렌더러(core/vrew-render)가 조각마다 불러 쓴다 — 시각은 **영상 전체 시각**(조각 시작 + t)이라 조각 이음새에서 패턴이 끊기지 않는다.
 *   · 기본(전부 0)이면 아무것도 하지 않는다 → 예전 MP4 와 한 글자도 다르지 않다.
 *   · 합성은 **밝기(Y)에만** — screen 블렌드로 더하고 색(크로마)은 건드리지 않는다(빠르고 색이 변하지 않는다). 그래서 먼지·반딧불은 색조 없는 밝은 점이다.
 *   ⚠ 렌더러 번들에 들어가지 않는다(main 쪽 전용) — fs 사용 OK.
 */
const path = require('path');

const W = 1920, H = 1080;
const KINDS = ['fog', 'dust', 'firefly', 'flicker'];
const KIND_LABEL = { fog: '안개', dust: '먼지', firefly: '반딧불', flicker: '불빛 깜박임' };

/** 값 정리 — { fog, dust, firefly, flicker } 각 0(끔)~3. 이상한 값은 0. */
function normFx(v) {
  const o = {};
  for (const k of KINDS) { const n = Math.round(Number(v && v[k])); o[k] = n >= 1 && n <= 3 ? n : 0; }
  return o;
}
const fxIsOff = (f) => !f || KINDS.every((k) => !f[k]);

/** 강도별 파라미터(느리고 약하게). level 1~3 */
const P = {
  fog: { opacity: [0.05, 0.08, 0.12], speed: [4, 5, 7], speed2: [3, 4, 5] },     // opacity = 밝기에 더하는 비율(screen) · speed = 초당 픽셀
  dust: { op: [0.35, 0.5, 0.7], rise: [5, 7, 9], sway: [16, 20, 24] },         // 위로 천천히 · 좌우로 살랑
  firefly: { op: [0.45, 0.65, 0.9], rise: [3, 4, 5], sway: [34, 42, 50] },
  flicker: { amp: [0.004, 0.007, 0.011] },                                         // 밝기 흔들림(0~1 기준 ±)
};
const clampLv = (l) => Math.max(1, Math.min(3, l | 0)) - 1;

// ── 질감(JS · 결정적) ───────────────────────────────────────────────────────
//   🔴 ffmpeg 의 geq random() 으로 만들면 스레드·조각마다 난수 상태가 겹쳐 **세로 줄무늬·격자 무늬**가 생긴다(실측 — 점이 일정 간격으로 늘어섰다).
//   그래서 질감은 JS(mulberry32 시드)로 직접 그려 PNG 로 쓴다. 한 번만 만들고(수백 ms) 같은 시드면 늘 같은 모양이다.
const zlib = require('zlib');
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function pngChunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
/** 8비트 회색 PNG */
function grayPng(w, h, pix) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; pix.copy(raw, y * (w + 1) + 1, y * w, (y + 1) * w); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })), pngChunk('IEND', Buffer.alloc(0))]);
}
/** 가로로 이어지는 값 잡음(여러 옥타브 · 부드러운 보간) → 0~1. w×h */
function fogField(w, h, seed) {
  const rnd = mulberry32(seed), out = new Float32Array(w * h);
  const oct = [[w / 4, 1.0], [w / 8, 0.55], [w / 16, 0.3], [w / 32, 0.14]];   // [셀 크기(px), 가중]
  let wsum = 0;
  for (const [cell, wt] of oct) {
    const cx = Math.round(w / cell), cy = Math.ceil(h / cell) + 1;
    const g = new Float32Array(cx * cy); for (let i = 0; i < g.length; i++) g[i] = rnd();
    const sm = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < h; y++) {
      const fy = y / cell, y0 = Math.floor(fy), ty = sm(fy - y0);
      for (let x = 0; x < w; x++) {
        const fx = x / cell, x0 = Math.floor(fx), tx = sm(fx - x0);
        const a = g[y0 * cx + (x0 % cx)], b = g[y0 * cx + ((x0 + 1) % cx)], c = g[(y0 + 1) * cx + (x0 % cx)], d = g[(y0 + 1) * cx + ((x0 + 1) % cx)];
        out[y * w + x] += wt * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty);
      }
    }
    wsum += wt;
  }
  for (let i = 0; i < out.length; i++) out[i] /= wsum;
  return out;
}
/** 안개 질감 3840x1080(같은 것을 두 번 이어 붙임) — 구름 덩어리만 남기고 나머지는 거의 투명(평균 ≈ 0.25) */
function fogPng() {
  const w = 1920, h = 1080, f = fogField(w, h, 11);
  let lo = 1, hi = 0; for (const v of f) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const pix = Buffer.alloc(w * 2 * h);
  const ss = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = (f[y * w + x] - lo) / (hi - lo);
    const b = Math.round(255 * 0.9 * ss(0.38, 0.92, v));
    pix[y * w * 2 + x] = b; pix[y * w * 2 + w + x] = b;
  }
  return grayPng(w * 2, h, pix);
}
/** 점 질감 3840x2160(2x2 타일 · 가장자리 이어짐) — 부드러운 가우시안 점. dots = [{n, sigma:[최소,최대], peak:[최소,최대]}] */
function dotsPng(seed, dots) {
  const w = 1920, h = 1080, rnd = mulberry32(seed), acc = new Float32Array(w * h);
  for (const d of dots) {
    for (let k = 0; k < d.n; k++) {
      const cx = rnd() * w, cy = rnd() * h, sg = d.sigma[0] + rnd() * (d.sigma[1] - d.sigma[0]), pk = d.peak[0] + rnd() * (d.peak[1] - d.peak[0]);
      const r = Math.ceil(sg * 3), x0 = Math.floor(cx), y0 = Math.floor(cy), inv = 1 / (2 * sg * sg);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const px = x0 + dx, py = y0 + dy, ddx = px + 0.5 - cx, ddy = py + 0.5 - cy;
        const v = pk * Math.exp(-(ddx * ddx + ddy * ddy) * inv);
        const xx = ((px % w) + w) % w, yy = ((py % h) + h) % h;
        acc[yy * w + xx] += v;
      }
    }
  }
  const pix = Buffer.alloc(w * 2 * h * 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const b = Math.max(0, Math.min(255, Math.round(acc[y * w + x])));
    for (const oy of [0, h]) for (const ox of [0, w]) pix[(y + oy) * w * 2 + x + ox] = b;
  }
  return grayPng(w * 2, h * 2, pix);
}
/**
 * 질감 PNG 를 한 번 만든다(렌더 시작 때). ff 는 안 쓴다(JS 로 직접). 반환 = { fog, dust, firefly } 파일 이름(tmpDir 안).
 */
async function prepareTextures(ff, tmpDir, fx) {
  const need = {};
  const fs = require('fs');
  if (fx.fog) { fs.writeFileSync(path.join(tmpDir, 'fx_fog.png'), fogPng()); need.fog = 'fx_fog.png'; }
  if (fx.dust) {
    // 먼지 — 작고 흐릿한 점 많이 + 아주 드문 조금 큰 점
    fs.writeFileSync(path.join(tmpDir, 'fx_dust.png'), dotsPng(3, [{ n: 900, sigma: [0.7, 1.3], peak: [90, 200] }, { n: 80, sigma: [1.6, 2.4], peak: [60, 120] }]));
    need.dust = 'fx_dust.png';
  }
  if (fx.firefly) {
    // 반딧불 — 드문(타일에 24개) 크고 부드러운 빛 번짐 + 밝은 심지
    fs.writeFileSync(path.join(tmpDir, 'fx_firefly.png'), dotsPng(4, [{ n: 24, sigma: [2.6, 4.6], peak: [150, 255] }, { n: 24, sigma: [0.9, 1.4], peak: [200, 255] }]));
    need.firefly = 'fx_firefly.png';
  }
  return need;
}

/**
 * 한 조각에 얹을 필터. base = 입력 스트림 라벨(예: '[vb]'), idx0 = 다음 -i 입력 번호, t0 = 조각 시작 시각(초 · 영상 전체 기준).
 *   반환 { ins:[ffmpeg 입력 인자], parts:[필터 문장], out:'[라벨]' } — out 은 base 에 효과를 얹은 스트림. fx 가 전부 0 이면 null.
 */
function fxGraph({ base, idx0, t0, dur, fx, tex, fps = 30, id = 'x', lp = 'x' }) {   // lp = 라벨·이름 접두(한 그래프에 둘을 넣을 때 겹치지 않게)
  if (fxIsOff(fx)) return null;
  const ins = [], parts = [], cmds = [];
  let cur = base, i = idx0, n = 0;
  const T = (e) => e.replace(/\bTT\b/g, `(t+${(+t0).toFixed(3)})`);
  const still = (file) => { ins.push('-i', file); return `[${i++}:v]`; };   // 🔴 `-loop 1` 은 매 프레임 PNG 를 다시 디코딩한다(3840x2160 이면 프레임당 수십 ms · 메모리도 쌓인다 — 실측 렌더 3.8배 · +5GB). 한 장만 읽고 loop 필터가 되풀이한다
  const scr = (lbl, op, out, name) => { parts.push(`${cur}${lbl}blend${name ? '@' + name : ''}=c0_mode=screen:c0_opacity=${op}:c1_opacity=0:c2_opacity=0:shortest=1[${out}]`); cur = `[${out}]`; };
  // 시간에 따라 변하는 불투명도 — 조각 안 0.1초마다 값을 보낸다(blend 불투명도는 실수라 눈금이 없다 · eq 밝기는 3단계씩 뛰었다)
  const animate = (name, fn) => { const steps = Math.ceil(dur * 10); for (let k = 0; k <= steps; k++) { const tl = k / 10; cmds.push(`${tl.toFixed(2)} blend@${name} all_opacity ${Math.max(0, fn(t0 + tl)).toFixed(5)};`); } };
  // 🌫 안개 — 흐린 구름 질감 한 겹이 천천히 흘러 밝기에 screen 으로 아주 약하게(두 겹이면 프레임당 +1.2ms — 3~4시간 영상에서 렌더가 눈에 띄게 늘어 한 겹으로 줄였다).
  if (fx.fog && tex.fog) {
    const k = clampLv(fx.fog), sp = P.fog.speed[k], op = P.fog.opacity[k];
    const a = still(tex.fog);
    parts.push(`${a}format=gray,setparams=range=tv,format=yuv420p,loop=loop=-1:size=1:start=0,setpts=N/${fps}/TB,crop=${W}:${H}:x='mod(${T(`TT*${sp}`)},${W})':y=0[${lp}fg${n}]`);
    scr(`[${lp}fg${n}]`, op, `${lp}fo${n}`); n++;
  }
  // ✨ 먼지 · 반딧불 — 점 질감을 위로 천천히 흘리며 좌우로 살랑(정수 픽셀 crop). 반딧불은 층이 서로 다른 주기로 숨 쉬듯 밝아졌다 어두워진다.
  const motes = (kind, file, layers) => {
    const par = P[kind], k = clampLv(fx[kind]);
    layers.forEach((L, li) => {
      const s = still(file), lid = `${lp}${kind[0]}${li}`;
      const rise = (par.rise[k] * L.sp).toFixed(3), sw = (par.sway[k] * L.sw).toFixed(2);
      const x = `${W}/2+${sw}*sin(${T(`TT*${L.fx}`)}*2*PI)`, y = `mod(${T(`TT*${rise}`)},${H})`;
      parts.push(`${s}format=gray,setparams=range=tv,format=yuv420p,loop=loop=-1:size=1:start=0,setpts=N/${fps}/TB,crop=${W}:${H}:x='trunc(${x})':y='trunc(${y})'[${lid}]`);
      const op = par.op[k] * L.al;
      scr(`[${lid}]`, op.toFixed(3), `${lp}mo${lid}`, L.pulse ? lid : null);
      if (L.pulse) animate(lid, (tt) => op * (0.08 + 0.92 * (0.5 + 0.5 * Math.sin((2 * Math.PI * tt) / L.pulse.period + L.pulse.phase))));
    });
    n++;
  };
  if (fx.dust && tex.dust) motes('dust', tex.dust, [
    { sp: 1.0, sw: 1.0, fx: 0.071, al: 1.0 },
  ]);
  if (fx.firefly && tex.firefly) motes('firefly', tex.firefly, [
    { sp: 1.0, sw: 1.0, fx: 0.031, al: 1.0, pulse: { period: 5.0, phase: 0.0 } },
    { sp: 0.8, sw: 1.2, fx: 0.047, al: 0.9, pulse: { period: 7.3, phase: 2.1 } },
  ]);
  // 🕯 불빛 깜박임 — 화면 전체 밝기를 아주 약하게, 서로 어긋난 느린 사인 셋(주기 3~11초)으로 불규칙하게. 흰 판을 addition 으로 더하는 불투명도를 0.1초마다(0 ~ 2×진폭)
  if (fx.flicker) {
    const a = P.flicker.amp[clampLv(fx.flicker)];   // 0~1 기준 평균 밝기 상승(= 진폭) — 불투명도는 0 ~ 2a
    ins.push('-f', 'lavfi', '-i', `color=c=white:s=${W}x${H}:r=${fps}`); const w = `[${i++}:v]`;
    parts.push(`${w}format=yuv420p[${lp}fw${n}]`);
    parts.push(`${cur}[${lp}fw${n}]blend@${lp}fl=all_mode=addition:all_opacity=${a}:c1_opacity=0:c2_opacity=0:shortest=1[${lp}fl${n}]`);
    cur = `[${lp}fl${n}]`;
    animate(`${lp}fl`, (tt) => a * (1 + 0.55 * Math.sin((2 * Math.PI * tt) / 3.1) + 0.3 * Math.sin((2 * Math.PI * tt) / 5.3 + 1.7) + 0.15 * Math.sin((2 * Math.PI * tt) / 10.9 + 0.6)));
    n++;
  }
  // sendcmd 는 base 바로 뒤에 한 번 — 위 blend 들의 불투명도를 시각에 맞춰 바꾼다
  let files = [];
  if (cmds.length) {
    const name = `fxcmd_${id}_${lp}.txt`;
    files = [{ name, content: cmds.join('\n') + '\n' }];
    parts.unshift(`${base}sendcmd=f=${name}[${lp}fxb]`);
    // 위 parts 는 base 를 직접 가리킨다 → 첫 사용처를 [${lp}fxb] 로
    for (let q = 1; q < parts.length; q++) { if (parts[q].startsWith(base)) { parts[q] = `[${lp}fxb]` + parts[q].slice(base.length); break; } }
  }
  return { ins, parts, out: cur, files };
}

/** 그룹 값 — 없음(채널 설정대로) | 'off' | 1~3 (채널에서 켠 종류를 이 강도로). 이상한 값은 없음 */
function normGroupFx(v) { if (v === 'off') return 'off'; const n = Math.round(Number(v)); return n >= 1 && n <= 3 ? n : 0; }
/** 한 그룹에 적용되는 fx — 채널 설정 + 그룹 값 */
function effFx(chan, groupVal) {
  const c = normFx(chan), g = normGroupFx(groupVal);
  if (g === 'off') return normFx({});
  if (!g) return c;
  const o = {}; for (const k of KINDS) o[k] = c[k] ? g : 0;
  return o;
}
/**
 * 🎬 MP4 렌더러에 줄 구간표 — 그룹마다 자기 문장 구간(영상 전체 시각)에 적용될 fx. 인접한 같은 값은 합친다.
 *   .vrew 타임라인 = 문장 음성(ttsAudioPath 가 있는 문장)을 순서대로 이은 것(빌더와 같은 규칙).
 *   채널 fx 가 전부 0 이면 빈 배열(= 아무것도 안 한다).
 */
function planOf(project, chanFx) {
  const ch = normFx(chanFx);
  if (fxIsOff(ch)) return [];
  const byId = new Map((project.sentences || []).map((s) => [s.id, s]));
  const out = []; let t = 0;
  for (const g of (project.groups || [])) {
    const fx = effFx(ch, g.look && g.look.fx);
    let d = 0; for (const id of (g.sentenceIds || [])) { const s = byId.get(id); if (s && s.ttsAudioPath && s.ttsDurationSec) d += s.ttsDurationSec; }
    if (!(d > 0)) continue;
    const last = out[out.length - 1];
    if (last && JSON.stringify(last.fx) === JSON.stringify(fx) && Math.abs(last.t1 - t) < 1e-6) last.t1 = t + d; else out.push({ t0: t, t1: t + d, fx });
    t += d;
  }
  return out.filter((r) => !fxIsOff(r.fx));
}
/** 구간표에서 시각 t 의 fx(없으면 전부 0) */
function fxAt(ranges, t) { for (const r of (ranges || [])) if (t >= r.t0 - 1e-6 && t < r.t1 - 1e-6) return r.fx; return null; }

module.exports = { KINDS, KIND_LABEL, normFx, fxIsOff, normGroupFx, effFx, planOf, fxAt, prepareTextures, fxGraph, P };
