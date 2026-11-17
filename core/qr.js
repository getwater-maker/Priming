'use strict';
// 🔳 QR 코드 만들기(v1.0.53 · 핸드폰에서 받기) — npm 의존성 없이(라이트 업데이트 · CLAUDE.md §2).
//   바이트 모드 · 오류 정정 M · 버전 1~10(바이트 213자까지) — 주소 한 줄이면 충분하다.
//   알고리즘은 Nayuki 「QR Code generator」(MIT)의 공개 설명을 따라 다시 썼다. 마스크는 단순 벌점(N1·N2·N4)으로 고른다
//   (어느 마스크든 표준에 맞는 QR 이다 — 형식 비트에 마스크 번호가 실린다).
//   ⚠ 렌더러 번들에도 들어갈 수 있으니 CJS 런타임 참조(require.main 등)를 쓰지 않는다.

// 오류 정정 M — [버전] = 블록마다 정정 코드워드 수 / 블록 수 (0번은 쓰지 않음)
const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const FORMAT_BITS_M = 0;
const MAX_VER = 10;

function rawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const na = Math.floor(ver / 7) + 2; r -= (25 * na - 10) * na - 55; if (ver >= 7) r -= 36; }
  return r;
}
function dataCodewords(ver) { return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * BLOCKS_M[ver]; }

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z & 0xff;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0); r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, div) {
  const r = new Array(div.length).fill(0);
  for (const b of data) {
    const f = b ^ r.shift(); r.push(0);
    div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

function utf8Bytes(text) {
  const out = [];
  const s = unescape(encodeURIComponent(String(text)));
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return out;
}

function encodeData(bytes) {
  let ver = 0;
  for (let v = 1; v <= MAX_VER; v++) {
    const ccBits = v <= 9 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= dataCodewords(v) * 8) { ver = v; break; }
  }
  if (!ver) throw new Error('QR 에 담기에 너무 깁니다(' + bytes.length + '바이트)');
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0x4, 4); put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; cw.push(b); }
  return { ver, cw };
}

function addEcc(ver, data) {
  const nb = BLOCKS_M[ver], eccLen = ECC_PER_BLOCK_M[ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1)); k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < nShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) out.push(b[i]); });
  return out;
}

function alignPositions(ver, size) {
  if (ver === 1) return [];
  const na = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + na * 3 + 5) / (na * 4 - 4)) * 2;
  const r = [6];
  for (let pos = size - 7; r.length < na; pos -= step) r.splice(1, 0, pos);
  return r;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

function build(ver, cw, forceMask) {
  const size = ver * 4 + 17;
  const mods = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setF = (x, y, d) => { mods[y][x] = d; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const ap = alignPositions(ver, size), last = ap.length - 1;
  for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const format = (mask) => {
    const data = (FORMAT_BITS_M << 3) | mask;
    let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const b = (i) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setF(8, i, b(i));
    setF(8, 7, b(6)); setF(8, 8, b(7)); setF(7, 8, b(8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, b(i));
    setF(8, size - 8, true);
  };
  format(0);
  if (ver >= 7) {
    let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const d = ((bits >>> i) & 1) !== 0, a = size - 11 + (i % 3), b = Math.floor(i / 3); setF(a, b, d); setF(b, a, d); }
  }
  // 데이터 놓기(오른쪽 아래부터 두 칸씩 지그재그)
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
      if (!fn[y][x] && i < cw.length * 8) { mods[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
    }
  }
  // 마스크 고르기 — 단순 벌점(N1 같은 색 5칸+ · N2 2×2 · N4 검은 비율)
  const penalty = (m) => {
    let p = 0;
    for (let y = 0; y < size; y++) for (const horiz of [true, false]) {
      let run = 1;
      for (let k = 1; k < size; k++) {
        const a = horiz ? m[y][k] : m[k][y], b = horiz ? m[y][k - 1] : m[k - 1][y];
        if (a === b) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
      }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
    // N3 찾기 무늬 닮은 꼴(1011101 + 한쪽 밝은 4칸) — 읽는 쪽이 가짜 찾기 무늬에 속지 않게(표준 벌점 · 검증은 zbar 로 210개 모두 해독 — OpenCV 는 표준 QR 도 약 3% 못 읽는다)
    const at = (fixed, mv, horiz) => (mv >= 0 && mv < size ? (horiz ? m[fixed][mv] : m[mv][fixed]) : false);   // 판 밖 = 밝음
    const PAT = [true, false, true, true, true, false, true];
    for (let y = 0; y < size; y++) for (const horiz of [true, false]) for (let x = -4; x < size; x++) {
      let hit = true; for (let k = 0; k < 7; k++) if (at(y, x + k, horiz) !== PAT[k]) { hit = false; break; }
      if (!hit) continue;
      let before = true, after = true;
      for (let k = 1; k <= 4; k++) { if (at(y, x - k, horiz)) before = false; if (at(y, x + 6 + k, horiz)) after = false; }
      if (before || after) p += 40;
    }
    let dark = 0; for (const row of m) for (const c of row) if (c) dark++;
    const total = size * size;
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  };
  let best = null;
  for (let mk = 0; mk < 8; mk++) {
    if (forceMask != null && mk !== forceMask) continue;
    format(mk);
    const m = mods.map((row, y) => row.map((c, x) => (fn[y][x] ? c : (MASKS[mk](x, y) ? !c : c))));
    const sc = penalty(m);
    if (!best || sc < best.sc) best = { sc, m, mk };
  }
  return { size, mods: best.m, mask: best.mk, version: ver };
}

/** text → { size, mods:[y][x] bool, version, mask } · opts.mask = 마스크 고정(시험용) */
function qrMatrix(text, opts = {}) {
  const { ver, cw } = encodeData(utf8Bytes(text));
  return build(ver, addEcc(ver, cw), opts.mask);
}

/** text → SVG 문자열(검은 칸 = 하나의 path · 둘레 margin 칸 흰 바탕) */
function qrSvg(text, opts = {}) {
  const q = qrMatrix(text); const mg = opts.margin == null ? 4 : opts.margin; const n = q.size + mg * 2;
  let d = '';
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.mods[y][x]) d += `M${x + mg},${y + mg}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

module.exports = { qrMatrix, qrSvg, _t: { dataCodewords, rsDivisor, rsRemainder, gfMul } };
