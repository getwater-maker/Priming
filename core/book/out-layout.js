'use strict';
/**
 * out-layout.js — 📁 완성 폴더의 하위 구조(로이 2026-10-14) — 종이책·전자책을 폴더로 나눠 한눈에 보이게.
 *
 *   완성/종이책/01_완성본 · 02_표지 · 03_내지
 *   완성/전자책/01_완성본 · 02_표지 · 03_내지(본문) · 04_epub
 *
 *   파일 이름 = 기존 원칙([종이책]/[전자책] <작품>_<권> + 꼬리) 그대로, 완성본 꼬리만 「표지+본문/표지+내지」→「_완성」(PDF · epub 모두).
 *   부크크 심사는 두 번 — ① 발행일·ISBN 없이 등록 ② 심사 중 받은 발행일·ISBN 을 원고에 넣고 다시 만들어 최종 제출.
 *   같은 이름 파일을 덮어쓰므로 ②를 만들면 ①의 파일은 사라지고 발행일·ISBN 이 든 파일만 남는다 — 옛 평면 이름(루트에 있던 것)도 함께 지운다(removeLegacy).
 *
 *   출력 폴더 이름이 `완성` 이 아니면(옛 위치·테스트) 예전 평면 구조·옛 이름을 그대로 쓴다.
 * 순수 함수(fs 만).
 */
const fs = require('fs');
const path = require('path');

const PREFIX = { print: '[종이책] ', ebook: '[전자책] ' };
const EDITION_DIR = { print: '종이책', ebook: '전자책' };
const SLOT_DIR = { full: '01_완성본', cover: '02_표지', body: '03_내지', interior: '03_내지', epub: '04_epub' };
// kind → [새 꼬리, 옛 꼬리]
const TAIL = {
  print: { full: ['_완성.pdf', '_표지+내지.pdf'], cover: ['_표지.pdf', '_표지.pdf'], interior: ['_내지.pdf', '_내지.pdf'] },
  ebook: { full: ['_완성.pdf', '_표지+본문.pdf'], cover: ['_표지.pdf', '_표지.pdf'], body: ['_본문.pdf', '_본문.pdf'], epub: ['_완성.epub', '.epub'] },
};

function isLayout(outRoot) { return !!outRoot && path.basename(path.resolve(outRoot)) === '완성'; }

/** 만들 파일의 경로(폴더는 만들어 둔다). 평면 구조면 옛 이름. */
function outPath(outRoot, edition, kind, base, { mkdir = true } = {}) {
  const t = (TAIL[edition] || {})[kind];
  if (!t) throw new Error(`알 수 없는 출력 종류: ${edition}/${kind}`);
  if (!isLayout(outRoot)) return path.join(outRoot, `${PREFIX[edition]}${base}${t[1]}`);
  const dir = path.join(outRoot, EDITION_DIR[edition], SLOT_DIR[kind]);
  if (mkdir) { try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {} }
  return path.join(dir, `${PREFIX[edition]}${base}${t[0]}`);
}

/** 이 권의 기존 파일(새 위치 > 옛 이름 평면) — 없으면 '' */
function findOwn(outRoot, edition, kind, base) {
  const t = (TAIL[edition] || {})[kind];
  if (!t) return '';
  const c = [];
  if (isLayout(outRoot)) c.push(path.join(outRoot, EDITION_DIR[edition], SLOT_DIR[kind], `${PREFIX[edition]}${base}${t[0]}`));
  c.push(path.join(outRoot, `${PREFIX[edition]}${base}${t[1]}`));
  if (edition === 'print') c.push(path.join(outRoot, `${base}${t[1]}`));   // 접두 없던 더 옛 이름
  return c.find((p) => fs.existsSync(p)) || '';
}

/** 출력 폴더 안의 모든 완성 파일 경로(새 하위 폴더 + 평면) */
function listAll(outRoot) {
  const out = [];
  const take = (dir) => { try { for (const d of fs.readdirSync(dir, { withFileTypes: true })) if (d.isFile()) out.push(path.join(dir, d.name)); } catch (_) {} };
  take(outRoot);
  if (isLayout(outRoot)) for (const ed of Object.values(EDITION_DIR)) for (const s of new Set(Object.values(SLOT_DIR))) take(path.join(outRoot, ed, s));
  return out;
}

/** 새 구조로 만든 뒤, 같은 권의 평면(옛 위치·옛 이름) 파일을 지운다 — 한 권의 파일이 두 곳에 남지 않게. kinds = 방금 만든 종류만. 지운 경로 배열 */
function removeLegacy(outRoot, edition, base, kinds) {
  const gone = [];
  if (!isLayout(outRoot)) return gone;
  for (const kind of (kinds || Object.keys(TAIL[edition]))) {
    const t = TAIL[edition][kind];
    const names = [`${PREFIX[edition]}${base}${t[1]}`, `${PREFIX[edition]}${base}${t[0]}`];
    if (edition === 'print') names.push(`${base}${t[1]}`);
    if (edition === 'ebook' && kind === 'full') names.push(`${PREFIX.ebook}${base}_전자책.pdf`);
    for (const n of names) {
      const p = path.join(outRoot, n);
      try { if (fs.existsSync(p) && fs.statSync(p).isFile()) { fs.unlinkSync(p); gone.push(p); } } catch (_) {}
    }
  }
  return gone;
}

module.exports = { isLayout, outPath, findOwn, listAll, removeLegacy, PREFIX, EDITION_DIR, SLOT_DIR };
