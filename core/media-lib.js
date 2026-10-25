'use strict';
/**
 * media-lib.js — 🗂 내 미디어 보관함 · 🔊 효과음 패널(Lab · 남은 기능 ③④)
 *   로이가 정한 **폴더**(⚙ 설정 → 📁 폴더 「내 미디어」「효과음」)를 훑어 파일 이름·폴더 이름 키워드로 찾는다 — 새 자료형·서버 없음.
 *   찾은 파일은 기존 「삽입」(overlay-op add · 그림·영상·오디오 위층)으로 넣는다. 이 파일은 읽기만 한다(폴더를 만들거나 지우지 않는다).
 *   main 전용(fs) — 렌더러 번들에 넣지 않는다.
 */
const fs = require('fs');
const path = require('path');

const EXTS = {
  media: { image: ['.png', '.jpg', '.jpeg', '.webp', '.gif'], video: ['.mp4', '.mov', '.webm', '.m4v'] },
  sfx: { audio: ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'] },
};
const LIMITS = { depth: 4, files: 5000 };
const SKIP_DIR = /^(\.|_받기$|node_modules$|\$RECYCLE\.BIN$|System Volume Information$)/;

function kindOfExt(ext, lib) {
  const e = String(ext || '').toLowerCase();
  const g = EXTS[lib] || {};
  for (const k of Object.keys(g)) if (g[k].includes(e)) return k;
  return null;
}
const norm = (s) => String(s || '').normalize('NFC').toLowerCase();

/** 폴더를 훑는다 → { items:[{path,name,rel,kind,size}], truncated, error? } — 깊이 4 · 5,000개까지 */
function scan(root, lib, opts = {}) {
  const depthMax = opts.depth || LIMITS.depth, filesMax = opts.files || LIMITS.files;
  const out = { items: [], truncated: false };
  if (!root || !fs.existsSync(root)) return { items: [], truncated: false, error: '폴더를 찾을 수 없습니다' };
  let st; try { st = fs.statSync(root); } catch (e) { return { items: [], truncated: false, error: e.message }; }
  if (!st.isDirectory()) return { items: [], truncated: false, error: '폴더가 아닙니다' };
  const walk = (dir, depth) => {
    if (out.truncated) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    ents.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    for (const e of ents) {
      if (out.items.length >= filesMax) { out.truncated = true; return; }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < depthMax && !SKIP_DIR.test(e.name)) walk(full, depth + 1); continue; }
      const kind = kindOfExt(path.extname(e.name), lib); if (!kind) continue;
      let size = 0; try { size = fs.statSync(full).size; } catch (_) {}
      out.items.push({ path: full, name: e.name, rel: path.relative(root, full), kind, size });
    }
  };
  walk(root, 0);
  return out;
}

/** 키워드로 거르기 — 공백으로 나눈 낱말이 **모두** 폴더 이름·파일 이름(상대 경로)에 들어 있어야 한다(대소문자 무시) · 빈 검색 = 전부 */
function filter(items, query) {
  const toks = norm(query).split(/\s+/).filter(Boolean);
  if (!toks.length) return items;
  return items.filter((it) => { const hay = norm(it.rel); return toks.every((t) => hay.includes(t)); });
}

/** 보여 줄 만큼만(쪽 나누기) */
function page(items, offset = 0, limit = 200) { return items.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit)); }

module.exports = { EXTS, LIMITS, kindOfExt, scan, filter, page };
