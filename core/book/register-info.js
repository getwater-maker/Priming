'use strict';
/**
 * register-info.js — 📋 부크크 등록 입력값 파일(`기준/등록/<권>.등록정보.md`) 읽기(순수 파싱 + 파일 찾기).
 *   원고에는 넣지 않는다(내지·표지에 글이 얹히거나 저자 소개 쪽이 생겨 쪽수가 바뀌는 것을 피한다 — 삼국지 R24 · 출판 세션).
 *   구조: `## [2단계 도서정보]`·`## [5단계 최종확인]` = `- 키: 값` 목록 / `## [도서소개]`·`## [도서목차]`·`## [저자경력소개]` = 본문 그대로.
 *   🔑 이 파일의 값이 원고 메타보다 **우선**한다(원고 제목 「삼국지 완역 1 : 천하대란」을 cleanTitle 이 「삼국지」·부제 「1-15」로 만든 사고).
 *   위치: 원고 메타 `> 등록정보: ../기준/등록/제1권.등록정보.md`(원고 파일 기준 상대경로) > `<작품>/기준/등록/<원고이름>.등록정보.md`(원고가 `원고\` 안일 때) > 원고 옆 `<원고이름>.등록정보.md`.
 */
const fs = require('fs');
const path = require('path');

const TEXT_SECTIONS = { '도서소개': 'intro', '도서목차': 'toc', '저자경력소개': 'bio', '저자경력·소개': 'bio', '저자경력 소개': 'bio' };
const KV_SECTIONS = ['2단계 도서정보', '5단계 최종확인'];

function parseRegisterInfo(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const secs = []; let cur = null;
  for (const ln of lines) {
    const m = /^##\s*\[([^\]]+)\]\s*$/.exec(ln);
    if (m) { cur = { name: m[1].trim(), lines: [] }; secs.push(cur); continue; }
    if (cur) cur.lines.push(ln);
  }
  const out = { kv: {}, intro: '', toc: '', bio: '', sections: secs.map((s) => s.name) };
  const clean = (arr) => arr.join('\n').replace(/<!--[\s\S]*?-->/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  for (const s of secs) {
    if (TEXT_SECTIONS[s.name]) { out[TEXT_SECTIONS[s.name]] = clean(s.lines); continue; }
    if (KV_SECTIONS.includes(s.name)) {
      for (const ln of s.lines) {
        const m = /^\s*[-*]\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/.exec(ln);
        if (m) out.kv[m[1].replace(/\s+/g, ' ')] = m[2];
      }
    }
  }
  const kv = (k) => { const key = Object.keys(out.kv).find((x) => x.replace(/\s/g, '') === k.replace(/\s/g, '')); return key ? out.kv[key] : ''; };
  out.title = kv('도서명'); out.subtitle = kv('부제'); out.author = kv('저자');
  out.purposeText = kv('도서 제작 목적'); out.isbnText = kv('ISBN'); out.genre = kv('대표 장르');
  out.ai = kv('AI 활용 여부 및 기여정도'); out.rights = kv('초상/저작권 보유여부');
  return out;
}

/** 원고 → 등록정보 파일 경로(없으면 ''). meta.registerInfo 는 원고 기준 상대경로 */
function findRegisterInfoFile(scriptPath, meta) {
  if (!scriptPath) return '';
  const dir = path.dirname(path.resolve(scriptPath));
  const base = path.basename(scriptPath).replace(/\.md$/i, '');
  const m = meta && meta.registerInfo ? String(meta.registerInfo).trim() : '';
  if (m) { const p = path.isAbsolute(m) ? m : path.resolve(dir, m); return fs.existsSync(p) ? p : ''; }
  const cands = [];
  if (path.basename(dir) === '원고') cands.push(path.join(path.dirname(dir), '기준', '등록', base + '.등록정보.md'));
  cands.push(path.join(dir, base + '.등록정보.md'));
  return cands.find((p) => fs.existsSync(p)) || '';
}
function loadRegisterInfo(scriptPath, meta) {
  const p = findRegisterInfoFile(scriptPath, meta);
  if (!p) return null;
  const info = parseRegisterInfo(fs.readFileSync(p, 'utf8'));
  info.file = p;
  return info;
}
module.exports = { parseRegisterInfo, findRegisterInfoFile, loadRegisterInfo };
