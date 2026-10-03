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

/**
 * 📘 전자책 표지 파일 찾기 — 부크크 업로드 형식은 **JPG·PDF 뿐**(PNG 불가 · 로이 2026-10-03). 순서:
 *   1) 원고 메타 `> 전자책표지:`(원고 기준 상대·절대경로) — jpg/pdf 는 그대로, png/webp 는 `needsConvert`(호출 쪽이 JPG 로 바꾼다)
 *   2) 표지 도구(`표지만들기.py`)가 인쇄 표지 옆에 만들어 둔 **`부속/<작품>_제N권_전자책앞표지.jpg`**(또는 같은 폴더) — 인쇄 표지 파일 이름의 `_표지(_날개)` 를 `_전자책앞표지` 로 바꾼 짝
 *   3) 없으면 null(호출 쪽이 인쇄 표지에서 앞표지를 잘라 쓴다)
 * @returns {{ path:string|null, source:'meta'|'tool'|null, needsConvert?:boolean, warn?:string }}
 */
function resolveEbookCover({ meta, scriptPath, coverImagePath }) {
  const m = (meta && meta.ebookCover) ? String(meta.ebookCover).trim() : '';
  const base = scriptPath ? path.dirname(path.resolve(scriptPath)) : '';
  if (m) {
    const p = path.isAbsolute(m) ? m : path.resolve(base || '.', m);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return { path: p, source: 'meta', needsConvert: !/\.(jpe?g|pdf)$/i.test(p) };
    return { path: null, source: null, warn: `⚠ 원고 메타 「전자책표지」를 찾을 수 없습니다: ${m}` };
  }
  if (coverImagePath) {
    const dir = path.dirname(coverImagePath);
    const stem = path.basename(coverImagePath).replace(/\.[^.]+$/, '').replace(/_시안$/, '').replace(/_표지(_날개)?$/, '');
    if (stem && stem !== path.basename(coverImagePath).replace(/\.[^.]+$/, '')) {
      for (const d of [path.join(dir, '부속'), dir]) {
        const p = path.join(d, `${stem}_전자책앞표지.jpg`);
        if (fs.existsSync(p)) return { path: p, source: 'tool' };
      }
    }
  }
  return { path: null, source: null };
}

/**
 * 완성 파일 이름의 바탕 — 원고가 `<작품>\원고\<이름>.md` 이면 「<작품>_<이름>」(예: 삼국지_제1권), 아니면 null(호출자가 책 제목으로).
 *   앞에 [종이책]/[전자책] 표기(로이 2026-10-02)와 뒤에 _내지.pdf·_표지.pdf·.epub 이 붙는다.
 */
function fileBaseFor(scriptPath) {
  if (!scriptPath) return null;
  const dir = path.dirname(path.resolve(scriptPath));
  if (path.basename(dir) !== WORK_DIR_NAME) return null;
  const work = path.basename(path.dirname(dir));
  const name = path.basename(scriptPath).replace(/\.md$/i, '');
  if (!work || !name) return null;
  // 원고 이름에 작품 이름이 이미 들어 있으면(빨간머리앤\원고\빨간머리앤.md · 단권 책) 「빨간머리앤_빨간머리앤」 처럼 겹치지 않게 원고 이름만 쓴다(로이 2026-10-03). 삼국지\원고\제1권.md → 삼국지_제1권 은 그대로.
  const raw = name.includes(work) ? name : `${work}_${name}`;
  return raw.replace(/[\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}
/**
 * 임시물(조판 작업 폴더·미리보기·전자책 표지 조각·등록 캡처) 위치 — 출력 폴더가 `완성` 이면 업로드 파일과 섞이지 않게 `완성\_작업\<새이름>`,
 * 아니면 예전 위치(`<출력>\<옛이름>`)를 그대로 쓴다(기존 작업물·테스트 호환). 옛이름이 ''면 출력 폴더 자체.
 */
function tmpDir(outRoot, legacyName, newName) {
  if (path.basename(path.resolve(outRoot)) === '완성') return path.join(outRoot, '_작업', newName);
  return legacyName ? path.join(outRoot, legacyName) : outRoot;
}

module.exports = { resolveEbookCover, finishedDirFor, resolveCoverFile, fileBaseFor, tmpDir, IMG_RE };
