'use strict';
/**
 * thumb-edit.js — 🖼 썸네일 편집기 순수 부분(v0.9.102 · 로이 2026-10-23 · 설계 docs/썸네일-편집기-설계.md · 채널사업부 회신 반영)
 *   · 문구 읽기: 패키징 .md 의 `## 썸네일 문구 A/B/C` — 서식 4종(표 · 줄표기 표 · 코드펜스 · 맨줄)을 채널사업부 `문구뽑기`(썸네일이력.py)와 같은 규칙으로 읽는다. 색 칸(흰색/노랑)도 읽는다.
 *   · 자리: 9칸 중 왼쪽·가운데 열 6칸만(오른쪽 금지 — 디자인원칙) · 한 썸네일의 모든 줄은 같은 글자 크기(강조는 색으로만).
 *   · 규격: PNG · 1280×720 · 2MB 이하 · 파일명에 ? 금지 · 얼굴 가림 경고(살색 덩어리 — core/skin-region 한 곳).
 *   · 저장: 기존 완성본을 `_캔바원본\` 으로 옮겨 보존한 뒤(같은 이름이 있으면 _2) 원래 이름으로 임시 파일 → rename(채널사업부 하류가 이름 하나만 본다).
 *   · 사이드카 `[약칭_MMDD] 썸네일_문구.json` — 편집기 값(+ 로이가 문구를 바꾸면 "로이수정": true — 패키징은 프라이밍이 고치지 않는다).
 * ⛔ 쓰는 곳은 완성본 폴더(99_썸네일\<채널폴더>\) 안뿐 — 바탕·패키징·_미확정 은 읽기만. Electron 에 의존하지 않는다(렌더러 번들에도 들어간다).
 */
const fs = require('fs');
const path = require('path');
const SK = require('./skin-region');

const W = 1280, H = 720, MAX_BYTES = 2 * 1024 * 1024;
const AN = ['A', 'B', 'C'];
const YELLOW = '#ffd600', WHITE = '#ffffff';
const COLS = ['왼쪽', '가운데', '오른쪽'], ROWS = ['위', '가운데', '아래'];
const CELLS = []; for (const c of COLS) for (const r of ROWS) CELLS.push(`${c}-${r}`);
const ALLOWED = CELLS.filter((n) => !n.startsWith('오른쪽'));   // 오른쪽 열 금지(디자인원칙)

// ───────── 문구 읽기 ─────────
const colorOf = (t) => (/노랑|노란|yellow|ffd600|강조/i.test(String(t || '')) ? 'yellow' : 'white');
const clean = (s) => String(s || '').replace(/\*\*|__|`/g, '').trim();

/** 한 절(## 썸네일 문구 X)의 본문 → [{text, color}] — 표 / 줄표기 표 / 코드펜스 / 맨줄 */
function parseBlock(body) {
  const lines = String(body || '').split(/\r?\n/);
  const out = [];
  // ① 표: | 줄 | 문구 | 색 |  (머리·구분선 건너뜀)
  const rows = lines.filter((l) => /^\s*\|/.test(l));
  if (rows.length) {
    for (const l of rows) {
      const cells = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.length < 2) continue;
      if (/^[-:\s]+$/.test(cells.join(''))) continue;                         // 구분선
      if ((/^줄$/.test(cells[0]) && /문구|글/.test(cells[1] || '')) || (/^(문구|글)$/.test(cells[0]) && /^색/.test(cells[1] || ''))) continue;    // 머리
      // `| 1 | 문구 | 색 |`(번호 칸 있음) · `| 문구 | 색 |`(번호 칸 없음)
      const hasNum = /^\d+$/.test(cells[0]) || /^줄\s*\d+$/.test(cells[0]);
      const text = clean(hasNum ? cells[1] : cells[0]), col = hasNum ? cells[2] : cells[1];
      if (text) out.push({ text, color: colorOf(col) });
    }
    if (out.length) return out;
  }
  // ② 코드펜스 / ③ 줄표기(`1줄: 문구 (노랑)`) / ④ 맨줄
  const inFence = []; let f = false;
  for (const l of lines) { if (/^\s*```/.test(l)) { f = !f; continue; } if (f) inFence.push(l); }
  const src = (inFence.length ? inFence : lines).map((l) => l.trim()).filter((l) => l && !/^#/.test(l) && !/^>/.test(l));
  for (const l0 of src) {
    let l = l0.replace(/^[-*]\s+/, '');
    const m = /^(?:\d+\s*줄?|줄\s*\d+)\s*[:：.)\]-]\s*(.+)$/.exec(l); if (m) l = m[1];
    let color = 'white';
    const cm = /[(（\[]\s*(노랑|노란색?|흰색?|하양|yellow|white)\s*[)）\]]\s*$/i.exec(l);
    if (cm) { color = colorOf(cm[1]); l = l.slice(0, cm.index).trim(); }
    l = clean(l); if (l) out.push({ text: l, color });
  }
  return out;
}

/** 패키징 .md 전체 → { A:[{text,color}], B:[…], C:[…] } (없는 안은 빠진다) */
function parseThumbText(md) {
  const res = {};
  const re = /^##\s*썸네일\s*문구\s*([ABC])\b[^\n]*\n([\s\S]*?)(?=^##\s|\s*$(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(String(md || '').replace(/\r\n/g, '\n')))) { const lines = parseBlock(m[2]); if (lines.length) res[m[1]] = lines; }
  return res;
}

// ───────── 배치 ─────────
/** 칸 이름 → 글상자 왼쪽 위(x,y)와 최대 폭 · 높이(1280×720). 왼쪽 정렬로 칸 왼쪽 여백에서 시작해 이웃 칸까지 쓸 수 있다. */
function cellBox(name, w = W, h = H) {
  const ci = COLS.findIndex((c) => String(name).startsWith(c)), ri = ROWS.findIndex((r) => String(name).endsWith(r));
  const c = ci < 0 ? 0 : ci, r = ri < 0 ? 1 : ri, m = Math.round(w * 0.04);
  return { x: Math.round((w / 3) * c) + m, y: Math.round((h / 3) * r) + Math.round(h * 0.02), maxW: c === 0 ? Math.round(w * 0.62) : Math.round(w * 0.58) - m, maxH: Math.round(h / 3) * 1.02 };
}
/** 모든 줄이 같은 크기 — 가장 넓은 줄이 maxW 안에 들고 전체 높이가 maxH(여러 칸을 쓰면 더 큼) 안에 드는 가장 큰 글자 크기. measure(text, size) → 가로 화소. */
function fitSize(lines, measure, maxW, maxH, { min = 40, max = 200, gap = 1.12 } = {}) {
  const ls = (lines || []).map((l) => l.text).filter(Boolean);
  if (!ls.length) return min;
  const ok = (s) => Math.max(...ls.map((t) => measure(t, s))) <= maxW && ls.length * s * gap <= maxH;
  let lo = min, hi = max;
  if (!ok(lo)) return lo;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ok(mid)) lo = mid; else hi = mid; }
  return lo;
}
/** 글상자(줄 수 · 크기)가 차지하는 영역 */
function textRect(x, y, lines, size, measure, gap = 1.12) {
  const w = Math.max(0, ...(lines || []).map((l) => measure(l.text, size)));
  return { x, y, w, h: Math.round((lines || []).length * size * gap) };
}
/** 글상자가 어느 칸들을 덮는지(칸 이름) — 오른쪽 열을 덮으면 디자인원칙 위반 경고용 */
function cellsCovered(rect, w = W, h = H) {
  const out = [];
  COLS.forEach((c, ci) => ROWS.forEach((r, ri) => {
    const x0 = (w / 3) * ci, x1 = (w / 3) * (ci + 1), y0 = (h / 3) * ri, y1 = (h / 3) * (ri + 1);
    const ox = Math.min(rect.x + rect.w, x1) - Math.max(rect.x, x0), oy = Math.min(rect.y + rect.h, y1) - Math.max(rect.y, y0);
    if (ox > (x1 - x0) * 0.12 && oy > (y1 - y0) * 0.12) out.push(`${c}-${r}`);
  }));
  return out;
}
/** 얼굴 가림 — 배경을 64×36 으로 줄인 rgb24 버퍼(f)와 글상자(1280×720 화소)로 살색 덩어리 칸 수. info-theme 과 같은 식(core/skin-region). */
function faceCover(f, rect, w = W, h = H) {
  const k = 1920 / w;   // regionSkin 은 1920 기준 좌표
  const r = SK.regionSkin(f, rect.x * k, rect.y * k, rect.w * k, rect.h * k);
  return { cells: r.cells, veto: SK.FACE_VETO(r) };
}
/** 6개 허용 칸 중 얼굴을 덜 가리는 칸을 점수순으로 — [{cell, cells, veto}] */
function suggestCells(f, lines, size, measure, w = W, h = H) {
  return ALLOWED.map((name, i) => {
    const b = cellBox(name, w, h), rect = textRect(b.x, b.y, lines, size, measure);
    const c = faceCover(f, rect, w, h);
    return { cell: name, cells: c.cells, veto: c.veto, i };
  }).sort((a, b) => (a.veto - b.veto) || (a.cells - b.cells) || (a.i - b.i)).map(({ i, ...x }) => x);
}

// ───────── 규격 ─────────
function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
/** 내보내기 전 검사 — { ok, errors[] } */
function checkSpec(buf, fileName) {
  const errors = [];
  const sz = pngSize(buf);
  if (!sz) errors.push('PNG 가 아닙니다');
  else if (sz.w !== W || sz.h !== H) errors.push(`크기가 ${sz.w}×${sz.h} 입니다(1280×720 이어야 합니다)`);
  if (buf && buf.length > MAX_BYTES) errors.push(`파일이 ${(buf.length / 1048576).toFixed(2)}MB 입니다(2MB 이하여야 합니다)`);
  if (/[?<>:"|*]/.test(String(fileName || ''))) errors.push('파일 이름에 쓸 수 없는 글자(? 등)가 있습니다');
  return { ok: !errors.length, errors };
}

// ───────── 찾기(읽기만) ─────────
const SKIP_DIR = /^(_미확정|_폐기|_캔바원본|_배경)$/;
const IMG = /\.(png|jpe?g|webp)$/i;
function _ls(d) { try { return fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return []; } }
function _walk(d, depth, out = []) {
  for (const e of _ls(d)) {
    const p = path.join(d, e.name);
    if (e.isFile()) out.push(p);
    else if (e.isDirectory() && depth > 0 && !SKIP_DIR.test(e.name)) _walk(p, depth - 1, out);
  }
  return out;
}
/** 대본 파일명 앞 `[약칭_MMDD]` */
const keyOf = (scriptPath) => (/^\[[^\]\r\n]+\]/.exec(path.basename(String(scriptPath || ''))) || [''])[0];

/**
 * Codex 바탕(글자 없는 그림) 찾기 — `<본사>\<카테고리>\<채널>\썸네일\**\[key] *.png`.
 * 안마다 따로인 채널(역사 `_A.png` · 아랫목 `-A.png`)은 안 접미사로 고르고, 한 장이면 모든 안이 같은 것을 쓴다. 못 찾으면 {}.
 */
function findCodexBases(hqRoot, key) {
  if (!hqRoot || !key) return {};
  const hits = [];
  for (const cat of _ls(hqRoot)) {
    if (!cat.isDirectory() || !/^\d{2}_/.test(cat.name) || /^99_/.test(cat.name)) continue;
    for (const ch of _ls(path.join(hqRoot, cat.name))) {
      if (!ch.isDirectory()) continue;
      const td = path.join(hqRoot, cat.name, ch.name, '썸네일');
      for (const f of _walk(td, 3)) if (IMG.test(f) && path.basename(f).startsWith(key)) hits.push(f);
    }
  }
  if (!hits.length) return {};
  const per = {};
  for (const a of AN) { const m = hits.find((f) => new RegExp(`[_-]${a}\\.[A-Za-z]+$`).test(f)); if (m) per[a] = m; }
  if (Object.keys(per).length) return per;
  if (hits.length === 1) return { A: hits[0], B: hits[0], C: hits[0] };
  return {};   // 한 장이 아니면 고르지 않는다(채널사업부 `바탕찾기` 와 같은 원칙 — 틀린 그림에 글자를 얹지 않는다)
}

/** 완성본 폴더 쪽 자산 — { dir, finals:{A,B,C}, bgs:{A,B,C}(_배경), sidecar } */
function findFinalAssets(thumbRoot, key) {
  const res = { dir: '', finals: {}, bgs: {}, sidecar: '' };
  if (!thumbRoot || !key) return res;
  const dirs = [thumbRoot, ..._ls(thumbRoot).filter((e) => e.isDirectory() && !SKIP_DIR.test(e.name)).map((e) => path.join(thumbRoot, e.name))];
  for (const d of dirs) {
    const files = _ls(d).filter((e) => e.isFile()).map((e) => e.name);
    const got = {};
    for (const a of AN) { const n = files.find((x) => IMG.test(x) && x.startsWith(key) && new RegExp(`썸네일[_-]?${a}\\.[A-Za-z]+$`).test(x)); if (n) got[a] = path.join(d, n); }
    if (!Object.keys(got).length) continue;
    res.dir = d; res.finals = got;
    for (const a of AN) { const n = _ls(path.join(d, '_배경')).filter((e) => e.isFile()).map((e) => e.name).find((x) => IMG.test(x) && x.startsWith(key) && new RegExp(`썸네일[_-]?${a}[_-]배경\\.[A-Za-z]+$`).test(x)); if (n) res.bgs[a] = path.join(d, '_배경', n); }
    const sc = path.join(d, `${key} 썸네일_문구.json`); if (fs.existsSync(sc)) res.sidecar = sc;
    break;
  }
  return res;
}

// ───────── 사이드카 ─────────
function readSidecar(file) { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : null; } catch (_) { return null; } }
const sidecarPath = (dir, key) => path.join(dir, `${key} 썸네일_문구.json`);
/** 안 하나의 편집 값 → 사이드카 한 칸 { 줄:[{글,색}], 크기, 자리, 글꼴, 로이수정? } (색은 #rrggbb) */
function sidecarEntry({ lines, size, cell, font, edited }) {
  const e = { 줄: (lines || []).map((l) => ({ 글: l.text, 색: l.color === 'yellow' ? YELLOW : WHITE })), 크기: size, 자리: cell, 글꼴: font || '' };
  if (edited) e.로이수정 = true;
  return e;
}
/** 사이드카 → 편집기 줄 [{text,color}] */
function linesFromSidecar(entry) {
  return Array.isArray(entry && entry.줄) ? entry.줄.map((l) => ({ text: String(l.글 || ''), color: /^#?ffd600$|^#?f[b-f][a-f0-9]{4}$/i.test(String(l.색 || '').replace('#', '')) && String(l.색 || '').toLowerCase() !== '#ffffff' ? 'yellow' : 'white' })).filter((l) => l.text) : [];
}
/** 편집기 줄이 패키징 줄과 글자까지 같은가(공백 포함 완전 일치 — 채널사업부 오탈자 대조와 같은 기준) */
const sameLines = (a, b) => (a || []).length === (b || []).length && (a || []).every((l, i) => l.text === (b[i] || {}).text);

// ───────── 저장 ─────────
function _uniq(dir, base, ext) {
  let p = path.join(dir, base + ext), n = 2;
  while (fs.existsSync(p)) { p = path.join(dir, `${base}_${n}${ext}`); n++; }
  return p;
}
function _writeAtomic(file, buf) {
  const tmp = file + '.priming-tmp';
  fs.writeFileSync(tmp, buf);
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
}
/**
 * 완성본 저장 — 같은 이름이 있으면 `_캔바원본\` 으로 옮겨 보존(덮어쓰지 않는다) → 원래 이름으로 저장.
 * 쓰는 곳은 destDir 안뿐이다. → { saved, preserved(옮긴 곳|'') }
 */
function saveFinal(destDir, fileName, buf) {
  const sp = checkSpec(buf, fileName);
  if (!sp.ok) throw new Error('규격: ' + sp.errors.join(' · '));
  const target = path.join(destDir, fileName);
  if (path.dirname(path.resolve(target)) !== path.resolve(destDir)) throw new Error('저장 위치가 올바르지 않습니다');
  let preserved = '';
  if (fs.existsSync(target)) {
    const od = path.join(destDir, '_캔바원본');
    fs.mkdirSync(od, { recursive: true });
    const ext = path.extname(fileName);
    preserved = _uniq(od, path.basename(fileName, ext), ext);
    fs.renameSync(target, preserved);
  }
  try { _writeAtomic(target, buf); }
  catch (e) { if (preserved) { try { fs.renameSync(preserved, target); } catch (_) {} } throw e; }   // 실패하면 원본을 제자리로
  return { saved: target, preserved };
}

module.exports = { W, H, MAX_BYTES, AN, YELLOW, WHITE, CELLS, ALLOWED, parseBlock, parseThumbText, cellBox, fitSize, textRect, cellsCovered, faceCover, suggestCells, pngSize, checkSpec, keyOf, findCodexBases, findFinalAssets, readSidecar, sidecarPath, sidecarEntry, linesFromSidecar, sameLines, saveFinal };
