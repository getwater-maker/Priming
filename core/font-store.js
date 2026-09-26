'use strict';

/**
 * font-store.js — 자막 글꼴 찾기·변환 (2026-09-25, 로이: 자막 서식 = Vrew 와 같은 글꼴을 MP4·화이트보드에도).
 *
 * 🔑 Vrew 의 글꼴 표기는 「글꼴 파일 이름표의 가족 이름 + `-Vrew_` + 굵기」다(실측 — 교보 손글씨 2025 = typographic family
 *   "Kyobo Handwriting 2025" · OS/2 weight 400 → `Kyobo Handwriting 2025-Vrew_400`). 그래서 **파일을 열어 이름표를 읽으면**
 *   Vrew 이름을 되짚을 수 있다.
 *
 * 글꼴을 찾는 곳(앞이 우선):
 *   ① 앱에 든 글꼴(assets/fonts, book 제외 — Pretendard Bold)
 *   ② 사용자가 추가한 글꼴(~/.priming-maker/fonts)
 *   ③ Vrew 설치본의 글꼴(resources/static/assets/*.woff2 — Pretendard 4종 등)
 *   ④ Vrew 가 한 번 내려받은 글꼴(%APPDATA%/vrew/Cache/Cache_Data/f_* — woff2 원본이 그대로 들어 있다)
 *   → Vrew 에서 한 번 쓴 글꼴은 이 PC 에서 MP4 에도 같은 글꼴로 구워진다.
 *
 * 🔴 ffmpeg(libass)는 **woff2 를 못 연다**(실측: "Error opening memory font"). → ttf/otf 로 바꿔 쓴다.
 *   · CFF 계열(OTTO — 교보 손글씨·검은고딕)은 테이블을 풀어 다시 잇기만 하면 된다.
 *   · TrueType 계열(Pretendard·나눔스퀘어 네오)은 glyf/loca 가 **변환 저장**돼 있어 WOFF2 규격(§5)대로 되살린다.
 *   ⛔ 파이썬(fonttools)을 쓰지 않는다 — 아내 PC 에 없다. Node 의 brotli 만으로 한다(npm 의존성 0 → 라이트 업데이트 유지).
 * 🔑 변환하면서 **이름표를 고유한 이름(PRM …)으로 바꾼다** — 시스템에 같은 이름 글꼴이 있어도 우리 파일이 뽑히고,
 *   ASS 에서 그 이름 하나로 정확히 가리킬 수 있다.
 *
 * 어떤 경우에도 던지지 않는다(글꼴 하나가 깨졌다고 렌더가 멈추면 안 된다) — 못 찾으면 기본 글꼴로 넘어가고 이유를 돌려준다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const CF = require('./caption-format');

const HOME = os.homedir();
const USER_DIR = path.join(HOME, '.priming-maker', 'fonts');
const CONV_DIR = path.join(USER_DIR, '_converted');
const INDEX_FILE = path.join(USER_DIR, '_index.v2.json');
const APP_FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FALLBACK_VREW = 'Pretendard-Vrew_700';

function vrewDirs() {
  const la = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
  const ra = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
  return {
    install: path.join(la, 'Programs', 'vrew', 'resources', 'static', 'assets'),
    cache: path.join(ra, 'vrew', 'Cache', 'Cache_Data'),
  };
}

// ── sfnt / woff2 읽기 ──────────────────────────────────────────────────────
const KNOWN_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

function readB128(buf, st) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[st.p++];
    if (i === 0 && b === 0x80) throw new Error('UIntBase128 앞자리 0');
    v = (v * 128) + (b & 0x7f);
    if (!(b & 0x80)) return v;
  }
  throw new Error('UIntBase128 너무 김');
}

function kindOf(buf) {
  if (!buf || buf.length < 12) return null;
  const sig = buf.toString('latin1', 0, 4);
  if (sig === 'wOF2') return 'woff2';
  if (sig === 'OTTO' || sig === 'true' || buf.readUInt32BE(0) === 0x00010000) return 'sfnt';
  return null;
}

/** 글꼴 파일 → { flavor, tables: {tag: Buffer}, transformed: {glyf, loca, hmtx} } */
function readTables(buf) {
  const kind = kindOf(buf);
  if (kind === 'sfnt') {
    const n = buf.readUInt16BE(4);
    const tables = {};
    for (let i = 0; i < n; i++) {
      const r = 12 + i * 16;
      const tag = buf.toString('latin1', r, r + 4);
      const off = buf.readUInt32BE(r + 8), len = buf.readUInt32BE(r + 12);
      tables[tag] = buf.slice(off, off + len);
    }
    return { flavor: buf.readUInt32BE(0), tables, transformed: {} };
  }
  if (kind !== 'woff2') throw new Error('글꼴 파일이 아닙니다');
  const flavor = buf.readUInt32BE(4);
  if (flavor === 0x74746366) throw new Error('글꼴 모음(ttc)은 지원하지 않습니다');
  const n = buf.readUInt16BE(12);
  const compLen = buf.readUInt32BE(20);
  const st = { p: 48 };
  const dir = [];
  for (let i = 0; i < n; i++) {
    const f = buf[st.p++];
    const tag = (f & 63) === 63 ? buf.toString('latin1', st.p, (st.p += 4)) : KNOWN_TAGS[f & 63];
    const tv = (f >> 6) & 3;
    const orig = readB128(buf, st);
    let len = orig;
    const isGL = tag === 'glyf' || tag === 'loca';
    const transformed = isGL ? tv === 0 : tv !== 0;
    if (transformed) len = readB128(buf, st);
    dir.push({ tag, orig, len, transformed });
  }
  const data = zlib.brotliDecompressSync(buf.slice(st.p, st.p + compLen));
  const tables = {}, transformed = {};
  let off = 0;
  for (const d of dir) {
    const b = data.slice(off, off + d.len);
    off += d.len;
    if (d.transformed) transformed[d.tag] = b; else tables[d.tag] = b;
  }
  return { flavor, tables, transformed };
}

function readNames(nt) {
  const r = {};
  if (!nt || nt.length < 6) return r;
  const cnt = nt.readUInt16BE(2), so = nt.readUInt16BE(4);
  for (let i = 0; i < cnt; i++) {
    const b = 6 + i * 12;
    if (b + 12 > nt.length) break;
    const pid = nt.readUInt16BE(b), lid = nt.readUInt16BE(b + 4), nid = nt.readUInt16BE(b + 6);
    const len = nt.readUInt16BE(b + 8), o = nt.readUInt16BE(b + 10);
    const s = nt.slice(so + o, so + o + len);
    let t;
    if (pid === 3 || pid === 0) { t = ''; for (let k = 0; k + 1 < s.length; k += 2) t += String.fromCharCode(s.readUInt16BE(k)); }
    else if (pid === 1 && lid === 0) t = s.toString('latin1');
    else continue;
    (r[nid] = r[nid] || {})[pid + ':' + lid] = t;
  }
  return r;
}

/** 글꼴에 글자 cp 가 있는지(cmap 형식 4·12). 자막용 목록에서 한글 없는 글꼴을 빼는 데 쓴다. */
function hasCodepoint(cmap, cp) {
  if (!cmap || cmap.length < 4) return false;
  const n = cmap.readUInt16BE(2);
  for (let i = 0; i < n; i++) {
    const r = 4 + i * 8;
    if (r + 8 > cmap.length) break;
    const pid = cmap.readUInt16BE(r), eid = cmap.readUInt16BE(r + 2), off = cmap.readUInt32BE(r + 4);
    if (!(pid === 3 && (eid === 1 || eid === 10)) && pid !== 0) continue;
    if (off + 4 > cmap.length) continue;
    const fmt = cmap.readUInt16BE(off);
    if (fmt === 4) {
      const segX2 = cmap.readUInt16BE(off + 6);
      const ends = off + 14, starts = ends + segX2 + 2;
      for (let s = 0; s < segX2; s += 2) {
        const end = cmap.readUInt16BE(ends + s), start = cmap.readUInt16BE(starts + s);
        if (cp >= start && cp <= end) return true;
      }
    } else if (fmt === 12) {
      const cnt = cmap.readUInt32BE(off + 12);
      for (let g = 0; g < cnt; g++) {
        const b = off + 16 + g * 12;
        if (cp >= cmap.readUInt32BE(b) && cp <= cmap.readUInt32BE(b + 4)) return true;
      }
    }
  }
  return false;
}

/** 이름표 → { family(Vrew 기준 가족 이름), label(한국어 이름이 있으면 그것), weight } */
function fontIdentity(tables) {
  const N = readNames(tables.name);
  const pick = (nid, prefer) => {
    const e = N[nid] || {};
    for (const k of prefer) if (e[k]) return e[k].trim();
    return null;
  };
  const family = pick(16, ['3:1033', '0:0', '1:0']) || pick(1, ['1:0', '3:1033', '0:0']) || null;
  const label = pick(16, ['3:1042']) || pick(1, ['3:1042']) || family;
  const os2 = tables['OS/2'];
  const weight = os2 && os2.length >= 6 ? os2.readUInt16BE(4) : 400;
  return { family, label, weight };
}

// ── WOFF2 glyf/loca/hmtx 되살리기 (규격 §5) ─────────────────────────────────
function read255(b, st) {
  const code = b[st.p++];
  if (code === 253) { const v = b.readUInt16BE(st.p); st.p += 2; return v; }
  if (code === 255) return 253 + b[st.p++];
  if (code === 254) return 253 * 2 + b[st.p++];
  return code;
}
const withSign = (flag, v) => ((flag & 1) ? v : -v);

function decodeTriplets(flags, fOff, n, glyphStream, gst) {
  const pts = new Array(n);
  let x = 0, y = 0;
  const g = glyphStream;
  for (let i = 0; i < n; i++) {
    let flag = flags[fOff + i];
    const on = !(flag >> 7);
    flag &= 0x7f;
    const p = gst.p;
    let dx, dy, nb;
    if (flag < 10) { dx = 0; dy = withSign(flag, ((flag & 14) << 7) + g[p]); nb = 1; }
    else if (flag < 20) { dx = withSign(flag, (((flag - 10) & 14) << 7) + g[p]); dy = 0; nb = 1; }
    else if (flag < 84) { const b0 = flag - 20, b1 = g[p]; dx = withSign(flag, 1 + (b0 & 0x30) + (b1 >> 4)); dy = withSign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f)); nb = 1; }
    else if (flag < 120) { const b0 = flag - 84; dx = withSign(flag, 1 + ((Math.floor(b0 / 12)) << 8) + g[p]); dy = withSign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + g[p + 1]); nb = 2; }
    else if (flag < 124) { const b2 = g[p + 1]; dx = withSign(flag, (g[p] << 4) + (b2 >> 4)); dy = withSign(flag >> 1, ((b2 & 0x0f) << 8) + g[p + 2]); nb = 3; }
    else { dx = withSign(flag, (g[p] << 8) + g[p + 1]); dy = withSign(flag >> 1, (g[p + 2] << 8) + g[p + 3]); nb = 4; }
    gst.p += nb;
    x += dx; y += dy;
    pts[i] = { x, y, on };
  }
  return pts;
}

/** 단순 글리프 → glyf 바이트(압축 없는 평범한 인코딩 — 크기보다 정확성). */
function encodeSimple(endPts, pts, instr, bbox, overlap) {
  const parts = [];
  const hdr = Buffer.alloc(10);
  hdr.writeInt16BE(endPts.length, 0);
  hdr.writeInt16BE(bbox[0], 2); hdr.writeInt16BE(bbox[1], 4); hdr.writeInt16BE(bbox[2], 6); hdr.writeInt16BE(bbox[3], 8);
  parts.push(hdr);
  const ep = Buffer.alloc(endPts.length * 2 + 2);
  endPts.forEach((v, i) => ep.writeUInt16BE(v, i * 2));
  ep.writeUInt16BE(instr.length, endPts.length * 2);
  parts.push(ep, instr);
  const fl = [], xs = [], ys = [];
  let px = 0, py = 0;
  pts.forEach((pt, i) => {
    let f = pt.on ? 1 : 0;
    if (i === 0 && overlap) f |= 0x40;
    const dx = pt.x - px, dy = pt.y - py;
    if (dx === 0) f |= 0x10;
    else if (dx >= -255 && dx <= 255) { f |= 0x02; if (dx > 0) f |= 0x10; xs.push(Math.abs(dx) & 0xff); }
    else { xs.push((dx >> 8) & 0xff, dx & 0xff); }
    if (dy === 0) f |= 0x20;
    else if (dy >= -255 && dy <= 255) { f |= 0x04; if (dy > 0) f |= 0x20; ys.push(Math.abs(dy) & 0xff); }
    else { ys.push((dy >> 8) & 0xff, dy & 0xff); }
    fl.push(f);
    px = pt.x; py = pt.y;
  });
  parts.push(Buffer.from(fl), Buffer.from(xs), Buffer.from(ys));
  return Buffer.concat(parts);
}

function reconstructGlyf(tg, headTable) {
  let p = 0;
  const u16 = () => { const v = tg.readUInt16BE(p); p += 2; return v; };
  const u32 = () => { const v = tg.readUInt32BE(p); p += 4; return v; };
  u16(); // reserved
  const optionFlags = u16();
  const numGlyphs = u16();
  const indexFormat = u16();
  const sizes = [u32(), u32(), u32(), u32(), u32(), u32(), u32()];
  const streams = [];
  for (const s of sizes) { streams.push(tg.slice(p, p + s)); p += s; }
  const [nContourS, nPointsS, flagS, glyphS, compositeS, bboxS, instrS] = streams;
  let overlapBits = null;
  if (optionFlags & 1) overlapBits = tg.slice(p, p + (((numGlyphs + 7) >> 3)));
  const bitmapLen = ((numGlyphs + 31) >> 5) << 2;
  const bboxBitmap = bboxS.slice(0, bitmapLen);
  const bst = { p: bitmapLen };
  const nst = { p: 0 }, pst = { p: 0 }, fst = { p: 0 }, gst = { p: 0 }, cst = { p: 0 }, ist = { p: 0 };
  const hasBBox = (i) => (bboxBitmap[i >> 3] >> (7 - (i & 7))) & 1;
  const readBBox = () => { const v = [bboxS.readInt16BE(bst.p), bboxS.readInt16BE(bst.p + 2), bboxS.readInt16BE(bst.p + 4), bboxS.readInt16BE(bst.p + 6)]; bst.p += 8; return v; };
  const glyphs = new Array(numGlyphs);
  const xMins = new Array(numGlyphs).fill(0);
  for (let i = 0; i < numGlyphs; i++) {
    const nContours = nContourS.readInt16BE(nst.p); nst.p += 2;
    if (nContours === 0) { glyphs[i] = Buffer.alloc(0); continue; }
    if (nContours === -1) {
      // 복합 글리프
      const start = cst.p;
      let haveInstr = false, more = true;
      while (more) {
        const flags = compositeS.readUInt16BE(cst.p); cst.p += 4; // flags + glyphIndex
        cst.p += (flags & 0x0001) ? 4 : 2;
        if (flags & 0x0008) cst.p += 2; else if (flags & 0x0040) cst.p += 4; else if (flags & 0x0080) cst.p += 8;
        if (flags & 0x0100) haveInstr = true;
        more = !!(flags & 0x0020);
      }
      const comp = compositeS.slice(start, cst.p);
      const bbox = readBBox();
      const hdr = Buffer.alloc(10);
      hdr.writeInt16BE(-1, 0); bbox.forEach((v, k) => hdr.writeInt16BE(v, 2 + k * 2));
      const parts = [hdr, comp];
      if (haveInstr) {
        const il = read255(glyphS, gst);
        const lb = Buffer.alloc(2); lb.writeUInt16BE(il, 0);
        parts.push(lb, instrS.slice(ist.p, ist.p + il)); ist.p += il;
      }
      glyphs[i] = Buffer.concat(parts);
      xMins[i] = bbox[0];
      continue;
    }
    // 단순 글리프
    const endPts = [];
    let total = 0;
    for (let c = 0; c < nContours; c++) { total += read255(nPointsS, pst); endPts.push(total - 1); }
    const pts = decodeTriplets(flagS, fst.p, total, glyphS, gst);
    fst.p += total;
    const il = read255(glyphS, gst);
    const instr = instrS.slice(ist.p, ist.p + il); ist.p += il;
    let bbox;
    if (hasBBox(i)) bbox = readBBox();
    else {
      let a = Infinity, b = Infinity, c2 = -Infinity, d = -Infinity;
      for (const pt of pts) { if (pt.x < a) a = pt.x; if (pt.y < b) b = pt.y; if (pt.x > c2) c2 = pt.x; if (pt.y > d) d = pt.y; }
      bbox = pts.length ? [a, b, c2, d] : [0, 0, 0, 0];
    }
    const overlap = overlapBits ? ((overlapBits[i >> 3] >> (7 - (i & 7))) & 1) : 0;
    glyphs[i] = encodeSimple(endPts, pts, instr, bbox, overlap);
    xMins[i] = bbox[0];
  }
  // 이어 붙이기 + loca
  const parts = [];
  const offsets = [0];
  let cur = 0;
  for (const g of glyphs) {
    const pad = (4 - (g.length % 4)) % 4;
    parts.push(g); if (pad) parts.push(Buffer.alloc(pad));
    cur += g.length + pad;
    offsets.push(cur);
  }
  const glyf = Buffer.concat(parts);
  let loca;
  if (indexFormat === 0) { loca = Buffer.alloc(offsets.length * 2); offsets.forEach((o, i) => loca.writeUInt16BE(o >> 1, i * 2)); }
  else { loca = Buffer.alloc(offsets.length * 4); offsets.forEach((o, i) => loca.writeUInt32BE(o, i * 4)); }
  let head = headTable;
  if (head && head.length >= 52) { head = Buffer.from(head); head.writeInt16BE(indexFormat, 50); }
  return { glyf, loca, head, xMins, numGlyphs };
}

function reconstructHmtx(th, numGlyphs, numHMetrics, xMins) {
  let p = 0;
  const flags = th[p++];
  const adv = [];
  for (let i = 0; i < numHMetrics; i++) { adv.push(th.readUInt16BE(p)); p += 2; }
  const lsb = [];
  for (let i = 0; i < numHMetrics; i++) { if (flags & 1) lsb.push(xMins[i]); else { lsb.push(th.readInt16BE(p)); p += 2; } }
  for (let i = numHMetrics; i < numGlyphs; i++) { if (flags & 2) lsb.push(xMins[i]); else { lsb.push(th.readInt16BE(p)); p += 2; } }
  const out = Buffer.alloc(numHMetrics * 4 + (numGlyphs - numHMetrics) * 2);
  let o = 0;
  for (let i = 0; i < numHMetrics; i++) { out.writeUInt16BE(adv[i], o); out.writeInt16BE(lsb[i], o + 2); o += 4; }
  for (let i = numHMetrics; i < numGlyphs; i++) { out.writeInt16BE(lsb[i], o); o += 2; }
  return out;
}

// ── 이름표 새로 쓰기 · sfnt 쓰기 ────────────────────────────────────────────
function buildNameTable(family) {
  const ps = family.replace(/[^A-Za-z0-9-]/g, '').slice(0, 60) || 'PRMFont';
  const recs = [[1, family], [2, 'Regular'], [4, family], [6, ps], [16, family], [17, 'Regular']];
  const strs = recs.map(([, s]) => { const b = Buffer.alloc(s.length * 2); for (let i = 0; i < s.length; i++) b.writeUInt16BE(s.charCodeAt(i), i * 2); return b; });
  const hdr = Buffer.alloc(6 + recs.length * 12);
  hdr.writeUInt16BE(0, 0); hdr.writeUInt16BE(recs.length, 2); hdr.writeUInt16BE(6 + recs.length * 12, 4);
  let off = 0;
  recs.forEach(([nid], i) => {
    const b = 6 + i * 12;
    hdr.writeUInt16BE(3, b); hdr.writeUInt16BE(1, b + 2); hdr.writeUInt16BE(0x409, b + 4); hdr.writeUInt16BE(nid, b + 6);
    hdr.writeUInt16BE(strs[i].length, b + 8); hdr.writeUInt16BE(off, b + 10);
    off += strs[i].length;
  });
  return Buffer.concat([hdr, ...strs]);
}

function checksum(b) {
  let s = 0;
  const n = b.length;
  for (let i = 0; i < n; i += 4) {
    const v = ((b[i] || 0) << 24 >>> 0) + ((b[i + 1] || 0) << 16) + ((b[i + 2] || 0) << 8) + (b[i + 3] || 0);
    s = (s + v) >>> 0;
  }
  return s;
}

function writeSfnt(flavor, tables) {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  let es = 0; while ((1 << (es + 1)) <= n) es++;
  const sr = (1 << es) * 16;
  const hdr = Buffer.alloc(12 + n * 16);
  hdr.writeUInt32BE(flavor >>> 0, 0); hdr.writeUInt16BE(n, 4); hdr.writeUInt16BE(sr, 6); hdr.writeUInt16BE(es, 8); hdr.writeUInt16BE(n * 16 - sr, 10);
  const body = [];
  let off = hdr.length;
  tags.forEach((tag, i) => {
    const t = tables[tag];
    const r = 12 + i * 16;
    hdr.write(tag.padEnd(4, ' ').slice(0, 4), r, 'latin1');
    hdr.writeUInt32BE(checksum(t), r + 4); hdr.writeUInt32BE(off, r + 8); hdr.writeUInt32BE(t.length, r + 12);
    const pad = (4 - (t.length % 4)) % 4;
    body.push(t); if (pad) body.push(Buffer.alloc(pad));
    off += t.length + pad;
  });
  return Buffer.concat([hdr, ...body]);
}

/**
 * 글꼴 파일(woff2/ttf/otf) → 이름표를 `newFamily` 로 바꾼 ttf/otf 버퍼.
 */
function convertFont(buf, newFamily) {
  const { flavor, tables, transformed } = readTables(buf);
  const out = { ...tables };
  if (transformed.glyf) {
    const r = reconstructGlyf(transformed.glyf, tables.head);
    out.glyf = r.glyf; out.loca = r.loca; if (r.head) out.head = r.head;
    if (transformed.hmtx) {
      const numHM = tables.hhea ? tables.hhea.readUInt16BE(34) : r.numGlyphs;
      out.hmtx = reconstructHmtx(transformed.hmtx, r.numGlyphs, numHM, r.xMins);
    }
  } else if (transformed.hmtx) {
    throw new Error('hmtx 변환만 있는 글꼴은 지원하지 않습니다');
  }
  delete out.DSIG;   // 서명은 새 파일에서 틀리므로 뺀다
  if (newFamily) out.name = buildNameTable(newFamily);
  if (out.head && out.head.length >= 12) { out.head = Buffer.from(out.head); out.head.writeUInt32BE(0, 8); }
  const sf = writeSfnt(flavor, out);
  // checkSumAdjustment
  if (out.head && out.head.length >= 12) {
    const adj = (0xB1B0AFBA - checksum(sf)) >>> 0;
    const n = sf.readUInt16BE(4);
    for (let i = 0; i < n; i++) {
      const r = 12 + i * 16;
      if (sf.toString('latin1', r, r + 4) === 'head') { sf.writeUInt32BE(adj, sf.readUInt32BE(r + 8) + 8); break; }
    }
  }
  return sf;
}

// ── 찾기(인덱스) ───────────────────────────────────────────────────────────
function listCandidates() {
  const out = [];
  const add = (file, src) => { try { const st = fs.statSync(file); if (st.isFile() && st.size > 4000) out.push({ file, src, size: st.size, mtime: st.mtimeMs }); } catch (_) {} };
  const scan = (dir, src, re) => { try { for (const n of fs.readdirSync(dir)) if (re.test(n)) add(path.join(dir, n), src); } catch (_) {} };
  scan(APP_FONT_DIR, 'app', /\.(ttf|otf|woff2)$/i);
  scan(USER_DIR, 'user', /\.(ttf|otf|woff2)$/i);
  const v = vrewDirs();
  scan(v.install, 'vrew', /\.woff2$/i);
  scan(v.cache, 'vrew-cache', /^f_[0-9a-f]+$/i);
  return out;
}

let _mem = null;
function loadIndex() {
  if (_mem) return _mem;
  try { _mem = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch (_) { _mem = {}; }
  if (!_mem || typeof _mem !== 'object') _mem = {};
  return _mem;
}
function saveIndex() {
  try { fs.mkdirSync(USER_DIR, { recursive: true }); fs.writeFileSync(INDEX_FILE, JSON.stringify(_mem), 'utf8'); } catch (_) {}
}

/**
 * 찾을 수 있는 글꼴 목록 — [{vrewName, family, label, weight, file, src}]. 같은 Vrew 이름이면 앞 순위(앱 → 사용자 → Vrew)가 이긴다.
 * 이름표를 읽은 결과는 파일(경로·크기·수정시각)별로 기억한다(woff2 는 풀어야 읽히므로 매번 하면 느리다).
 */
function listFonts() {
  const idx = loadIndex();
  let dirty = false;
  const seen = new Map();
  for (const c of listCandidates()) {
    const key = `${c.file}|${c.size}|${Math.round(c.mtime)}`;
    let rec = idx[key];
    // 🌏 가나 여부(kana)를 모르는 옛 기록(한글 없음으로만 적힌 것)은 다시 읽는다(2026-09-26 일본어 지원).
    if (rec && !rec.bad && rec.hangul === false && rec.kana === undefined) rec = null;
    if (!rec) {
      rec = { bad: true };
      try {
        const buf = fs.readFileSync(c.file);
        if (kindOf(buf)) {
          const { tables } = readTables(buf);
          const id = fontIdentity(tables);
          if (id.family) rec = { family: id.family, label: id.label, weight: id.weight, hangul: hasCodepoint(tables.cmap, 0xAC00) && hasCodepoint(tables.cmap, 0xD7A3), kana: hasCodepoint(tables.cmap, 0x3042) && hasCodepoint(tables.cmap, 0x30A2) };
        }
      } catch (_) {}
      idx[key] = rec; dirty = true;
    }
    // 한글도 가나도 없는 글꼴(중국어 Noto 등)은 뺀다. 🌏 가나만 있는 글꼴(Noto Sans JP)은 일본어 자막용으로 남긴다 — `jaOnly` 표시.
    if (rec.bad || (rec.hangul === false && !rec.kana)) continue;
    const vrewName = CF.vrewFontName(rec.family, rec.weight);
    const jaOnly = rec.hangul === false && !!rec.kana;
    if (!seen.has(vrewName)) seen.set(vrewName, { vrewName, family: rec.family, label: (rec.label || rec.family) + (jaOnly ? ' (日本語 · 한글 없음)' : ''), weight: rec.weight, file: c.file, src: c.src, jaOnly });
  }
  // 없어진 파일의 기록은 정리
  const live = new Set(listCandidates().map((c) => `${c.file}|${c.size}|${Math.round(c.mtime)}`));
  for (const k of Object.keys(idx)) if (!live.has(k)) { delete idx[k]; dirty = true; }
  if (dirty) saveIndex();
  return [...seen.values()].sort((a, b) => (a.vrewName === FALLBACK_VREW ? -1 : b.vrewName === FALLBACK_VREW ? 1 : a.label.localeCompare(b.label, 'ko') || a.weight - b.weight));
}

/** ASS 에서 쓸 고유 가족 이름 — Vrew 이름으로 정해진다(같은 글꼴이면 늘 같은 이름). */
function assFamilyFor(vrewName) {
  return 'PRM ' + String(vrewName).replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 50) + ' ' + crypto.createHash('sha1').update(String(vrewName)).digest('hex').slice(0, 6);
}

/** Vrew 이름의 글꼴을 변환해 둔 파일(없으면 만든다). 못 찾으면 null. */
function convertedFile(vrewName, fonts) {
  const list = fonts || listFonts();
  const f = list.find((x) => x.vrewName === vrewName);
  if (!f) return null;
  const fam = assFamilyFor(vrewName);
  const st = fs.statSync(f.file);
  const h = crypto.createHash('sha1').update(`${f.file}|${st.size}|${Math.round(st.mtimeMs)}|${fam}|v1`).digest('hex').slice(0, 16);
  const out = path.join(CONV_DIR, h + '.ttf');
  if (!fs.existsSync(out)) {
    const buf = convertFont(fs.readFileSync(f.file), fam);
    fs.mkdirSync(CONV_DIR, { recursive: true });
    const tmp = out + '.tmp' + process.pid;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, out);
  }
  return { file: out, family: fam, label: f.label };
}

/**
 * 렌더용 — 쓰인 Vrew 글꼴들을 destDir 에 복사하고 { vrewName: ASS 가족 이름 } 을 돌려준다.
 * 못 찾거나 변환이 깨진 글꼴은 기본 글꼴(Pretendard 700)로 넘기고 missing 에 적는다.
 */
function prepareFontsDir(vrewNames, destDir) {
  const map = {}, missing = [], errors = [];
  let fonts = [];
  try { fonts = listFonts(); } catch (e) { errors.push(e.message); }
  try { fs.mkdirSync(destDir, { recursive: true }); } catch (_) {}
  const want = [...new Set([FALLBACK_VREW, ...(vrewNames || []).filter(Boolean)])];
  let fallback = null;
  for (const name of want) {
    try {
      const c = convertedFile(name, fonts);
      if (!c) { if (name !== FALLBACK_VREW) missing.push(name); continue; }
      fs.copyFileSync(c.file, path.join(destDir, path.basename(c.file)));
      map[name] = c.family;
      if (name === FALLBACK_VREW) fallback = c.family;
    } catch (e) { errors.push(`${name}: ${e.message}`); if (name !== FALLBACK_VREW) missing.push(name); }
  }
  if (!fallback) fallback = 'Malgun Gothic';
  for (const name of want) if (!map[name]) map[name] = fallback;
  return { map, fallback, missing, errors };
}

/** 사용자가 고른 글꼴 파일을 사용자 폴더로 복사한다. @returns 목록에 들어간 항목 */
function addUserFont(srcFile) {
  const buf = fs.readFileSync(srcFile);
  if (!kindOf(buf)) throw new Error('ttf·otf·woff2 글꼴 파일만 추가할 수 있습니다');
  const { tables } = readTables(buf);
  const id = fontIdentity(tables);
  if (!id.family) throw new Error('글꼴 이름을 읽지 못했습니다');
  fs.mkdirSync(USER_DIR, { recursive: true });
  const dest = path.join(USER_DIR, path.basename(srcFile));
  fs.copyFileSync(srcFile, dest);
  return { vrewName: CF.vrewFontName(id.family, id.weight), family: id.family, label: id.label, weight: id.weight, file: dest, src: 'user' };
}

module.exports = {
  listFonts, prepareFontsDir, convertedFile, addUserFont, assFamilyFor, convertFont, readTables, fontIdentity, kindOf,
  FALLBACK_VREW, USER_DIR,
};
