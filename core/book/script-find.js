'use strict';
// 📬 원고 찾기 — 부크크 메일 제목의 책 이름으로 원고(.md)를 고르기 위해, 원고 폴더 아래 .md 의 첫 `# 제목` 줄만 읽는다(읽기 전용).
//   `_`·`.` 로 시작하는 폴더(_삭제대기·_공통·.priming-*)와 node_modules 는 보지 않는다.
const fs = require('fs'), path = require('path');
const SKIP = n => /^[_.]/.test(n) || n === 'node_modules';
async function findBookScripts(root, { maxDepth = 5, maxFiles = 3000 } = {}) {
  if (!root || !fs.existsSync(root)) throw Error('헤더 채널의 원고 폴더가 없습니다 — 출판 채널 설정에서 원고 폴더를 지정하세요');
  const out = [], files = [];
  async function walk(dir, depth) {
    let ents; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (files.length >= maxFiles) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < maxDepth && !SKIP(e.name)) await walk(p, depth + 1); }
      else if (/\.md$/i.test(e.name)) files.push(p);
    }
  }
  await walk(root, 0);
  for (const p of files) {
    let head = '';
    try { const fh = await fs.promises.open(p, 'r'); try { const b = Buffer.alloc(4096); const { bytesRead } = await fh.read(b, 0, 4096, 0); head = b.slice(0, bytesRead).toString('utf8'); } finally { await fh.close(); } } catch (_) { continue; }
    const m = head.replace(/^﻿/, '').match(/^#\s+(.+?)\s*$/m);
    if (m) out.push({ path: p, title: m[1] });
  }
  return out;
}
module.exports = { findBookScripts };
