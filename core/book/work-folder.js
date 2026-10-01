'use strict';
/**
 * work-folder.js — 📁 작품 단위 폴더(출판 세션 2026-10-01): D:\## 출판\<작품>\{원고,표지,기준,완성}\
 *   · 완성 폴더 : 원고가 `<작품>\원고\` 안에 있으면 산출물은 `<작품>\완성\`(채널 outputFolder 설정을 쓰지 않는다). 그 밖의 원고는 기존 규칙.
 *   · 표지 파일 : 원고 메타 `> 표지파일: ../표지/…png`(원고 파일 기준 상대경로 · 절대경로도 허용) > 메타가 없을 때 `../표지/` 안 `표지*.png|jpg|jpeg`
 *                 가 **정확히 하나**(「시안」이 든 파일은 후보에서 제외) — 둘 이상이면 고르지 않고 알린다. 수동 첨부(settings.book.coverImage)는 메타가 없을 때만 이긴다.
 * 순수 함수(fs 만) — 일렉트론 없이 테스트한다(test/book-workfolder.test.js).
 */
const fs = require('fs');
const path = require('path');

const IMG_RE = /\.(png|jpe?g)$/i;
const WORK_DIR_NAME = '원고';

/** 원고 파일이 `<작품>\원고\` 안이면 `<작품>\완성`, 아니면 null */
function finishedDirFor(scriptPath) {
  if (!scriptPath) return null;
  const dir = path.dirname(path.resolve(scriptPath));
  if (path.basename(dir) !== WORK_DIR_NAME) return null;
  const work = path.dirname(dir);
  if (!work || work === dir) return null;
  return path.join(work, '완성');
}

/**
 * @returns {{ path:string|null, source:'meta'|'manual'|'auto'|null, note?:string, warn?:string }}
 *   note = 로그에 남길 한 줄(선택) · warn = 못 쓴 이유(메타 파일 없음·후보 여럿)
 */
function resolveCoverFile({ meta, scriptPath, manual }) {
  const m = (meta && meta.coverFile) ? String(meta.coverFile).trim() : '';
  const base = scriptPath ? path.dirname(path.resolve(scriptPath)) : '';
  if (m) {
    const p = path.isAbsolute(m) ? m : path.resolve(base, m);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return { path: p, source: 'meta' };
    // 메타 파일이 없으면 다른 걸 몰래 쓰지 않는다(엉뚱한 표지가 인쇄되지 않게) — 수동 첨부가 있으면 그건 살린다
    const w = `⚠ 원고 메타 「표지파일」을 찾을 수 없습니다: ${m} (원고 파일 기준 ${p})`;
    if (manual && fs.existsSync(manual)) return { path: manual, source: 'manual', warn: w };
    return { path: null, source: null, warn: w };
  }
  if (manual && fs.existsSync(manual)) return { path: manual, source: 'manual' };
  if (!base || path.basename(base) !== WORK_DIR_NAME) return { path: null, source: null };
  const dir = path.join(path.dirname(base), '표지');
  let files = [];
  try { files = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name); } catch (_) { return { path: null, source: null }; }
  const cands = files.filter((f) => /^표지/.test(f) && IMG_RE.test(f) && !/시안/.test(f));
  if (cands.length === 1) return { path: path.join(dir, cands[0]), source: 'auto', note: `표지 폴더의 ${cands[0]} 를 자동 후보로 썼습니다` };
  if (cands.length > 1) return { path: null, source: null, warn: `ℹ 표지 폴더에 후보가 ${cands.length}개(${cands.slice(0, 4).join(', ')}) — 자동으로 고르지 않습니다. 원고 메타 \`> 표지파일:\` 로 정하세요` };
  return { path: null, source: null };
}

module.exports = { finishedDirFor, resolveCoverFile, IMG_RE };
