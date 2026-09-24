'use strict';
/**
 * yt-packaging.js — ⬆ 유튜브 업로드에 넣을 **제목 · 설명 · 태그**를 정한다 (2026-09-24, v0.5.31)
 *
 * 🔑 정본은 아도나이로이의 **패키징 파일**이다 — `<채널>/패키징/<월>/<대본과 같은 이름>.md`.
 *   거기 `## 제목` · `## 설명글`(``` 블록) · `## 태그`(``` 블록)가 Codex·Claude 검수를 거쳐 확정돼 있다(실측 269편).
 *   앱이 제목을 새로 짓지 않는다 — 두 곳에서 지으면 어긋난다.
 * 설명 끝에 ⏱ 챕터(core/yt-chapters.js — 앱 「⏱ 타임스탬프」 창과 같은 계산)를 붙인다. 해시태그 줄은 맨 끝에 남긴다.
 * 패키징이 없으면 대본 H1 을 제목으로, 설명은 챕터만 — 그 사실을 로그로 알린다(조용히 대충 올리지 않는다).
 */

const fs = require('fs');
const path = require('path');
const CH = require('./yt-chapters');

const PACK = '패키징';
const SCRIPT = '대본';

/** 대본 경로 → 패키징 파일 경로(없으면 null) */
function findPackagingFile(scriptPath) {
  if (!scriptPath) return null;
  const abs = path.resolve(scriptPath);
  const base = path.basename(abs);
  const parts = abs.split(path.sep);
  // ① 경로의 「대본」 칸을 「패키징」으로 — 월 폴더 구조가 같다(대본/2026_09 ↔ 패키징/2026_09)
  const i = parts.lastIndexOf(SCRIPT);
  if (i >= 0) {
    const cand = [...parts.slice(0, i), PACK, ...parts.slice(i + 1)].join(path.sep);
    if (_isFile(cand)) return cand;
  }
  // ② 위로 4칸까지 올라가며 「패키징」 폴더를 찾아 같은 이름(없으면 같은 [코드]) 파일을 찾는다
  const code = (/^\[[^\]]+\]/.exec(base) || [''])[0];
  let dir = path.dirname(abs);
  for (let up = 0; up < 4; up++) {
    const pd = path.join(dir, PACK);
    if (_isDir(pd)) {
      const hit = _walk(pd, 3).find((f) => path.basename(f) === base)
        || (code ? _walk(pd, 3).find((f) => path.basename(f).startsWith(code) && /\.md$/i.test(f)) : null);
      if (hit) return hit;
    }
    const nd = path.dirname(dir); if (nd === dir) break; dir = nd;
  }
  return null;
}
function _isFile(p) { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }
function _isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } }
function _walk(d, depth) {
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    const p = path.join(d, e.name);
    if (e.isFile()) out.push(p);
    else if (e.isDirectory() && depth > 0) out.push(..._walk(p, depth - 1));
  }
  return out;
}

/** 패키징 .md → {title, description, tags[]} (없는 항목은 빈 값) */
function parsePackaging(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const sec = {};
  let cur = null;
  for (const l of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(l);
    if (m) { cur = m[1]; if (!(cur in sec)) sec[cur] = []; continue; }
    if (/^#\s/.test(l)) { cur = null; continue; }
    if (cur) sec[cur].push(l);
  }
  const fence = (arr) => {   // 첫 ``` 블록 안 — 없으면 bullet(- …)·구분선 전까지의 본문
    if (!arr) return '';
    const a = arr.findIndex((l) => /^\s*```/.test(l));
    if (a >= 0) {
      const b = arr.findIndex((l, k) => k > a && /^\s*```/.test(l));
      return arr.slice(a + 1, b > a ? b : arr.length).join('\n').trim();
    }
    const stop = arr.findIndex((l) => /^\s*(-\s|\*\s|---)/.test(l));
    return arr.slice(0, stop >= 0 ? stop : arr.length).join('\n').trim();
  };
  const key = (name) => Object.keys(sec).find((k) => k === name) || Object.keys(sec).find((k) => k.startsWith(name + ' ') && !/근거/.test(k));
  const t = sec[key('제목')] || [];
  const title = (fence(t).split('\n').find((l) => l.trim()) || '').replace(/^\*\*|\*\*$/g, '').trim();
  const description = fence(sec[key('설명글')]);
  const tags = fence(sec[key('태그')]).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  return { title, description, tags };
}

/** 설명글에 챕터를 끼운다 — 맨 끝 해시태그 줄은 그대로 맨 끝에 둔다. */
function insertChapters(desc, chaptersText) {
  const d = String(desc || '').trim();
  const c = String(chaptersText || '').trim();
  if (!c) return d;
  if (!d) return c;
  const ls = d.split('\n');
  let k = ls.length;
  while (k > 0 && /^\s*(#\S+\s*)+$/.test(ls[k - 1])) k--;
  while (k > 0 && !ls[k - 1].trim() && k < ls.length) k--;   // 해시태그 앞 빈 줄
  if (k === ls.length) return `${d}\n\n${c}`;
  const head = ls.slice(0, k).join('\n').trimEnd();
  const tail = ls.slice(k).join('\n').trim();
  return `${head}\n\n${c}\n\n${tail}`;
}

/**
 * 한 편의 업로드 메타.
 * @param {{scriptPath:string, dtoProject:object, fallbackTitle?:string}} a
 * @returns {{title, description, tags, source:'packaging'|'script', packagingPath:string|null, chapters:number, notes:string[]}}
 */
function buildUploadMeta(a = {}) {
  const notes = [];
  const pf = findPackagingFile(a.scriptPath);
  let pk = { title: '', description: '', tags: [] };
  if (pf) { try { pk = parsePackaging(fs.readFileSync(pf, 'utf8')); } catch (e) { notes.push(`패키징 파일을 읽지 못했습니다: ${e.message}`); } }
  else notes.push('패키징 파일(<채널>/패키징/<월>/<대본 이름>.md)이 없어 대본 제목으로 올립니다 — 설명·태그는 비어 있으니 Studio 에서 채우세요.');
  if (pf && !pk.title) notes.push('패키징 파일에 「## 제목」이 없어 대본 제목으로 올립니다.');

  // ⏱ 챕터 — 앱 「⏱ 타임스탬프」와 같은 계산. 유튜브 규칙(3개 이상 · 각 10초 이상)에 안 맞으면 넣지 않는다.
  let chText = '', chN = 0;
  const pr = a.dtoProject;
  if (pr) {
    const r = CH.tsBuild({ projects: [pr] });
    const chs = CH.tsChaptersOf(pr);
    const bad = chs.length < 3 || chs.some((c) => c.dur < 10);
    if (!bad) { chText = r.text; chN = chs.length; }
    else notes.push(`챕터가 유튜브 규칙(3개 이상 · 각 10초 이상)에 안 맞아 설명에 넣지 않았습니다(${chs.length}개).`);
  }
  const strip = (s) => String(s || '').replace(/^\s*\[[^\]]+\]\s*/, '').trim();   // "[고전_0930] …" → "…"
  const title = pk.title || strip(pr && pr.title) || strip(a.fallbackTitle) || strip(path.basename(String(a.scriptPath || ''), '.md'));
  return {
    title,
    description: insertChapters(pk.description, chText),
    tags: pk.tags,
    source: pk.title ? 'packaging' : 'script',
    packagingPath: pf,
    chapters: chN,
    notes,
  };
}

module.exports = { findPackagingFile, parsePackaging, insertChapters, buildUploadMeta };
