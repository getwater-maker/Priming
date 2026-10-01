'use strict';
/**
 * footnote-check.js — 각주 점검(순수). 삼국지 제1권 조립 중 「회마다 [^1] 이 다시 시작해 번호가 충돌」(2026-10-01)한 사고를 조판 전에 알린다.
 *   · dups          : 같은 번호를 두 번 정의 — 뒤의 정의가 앞을 **조용히 덮는다**(본문 단어와 각주 설명이 어긋남)
 *   · undefinedRefs : 본문에 `[^id]` 가 있는데 정의가 없음 — 각주가 글자 그대로 남는다
 *   · unused        : 정의는 있는데 본문에서 쓰지 않음
 *   · reused        : 한 정의를 본문 여러 곳에서 씀(번호는 등장 순서로 새로 매겨지니 문제는 아니지만 의도인지 확인)
 * 번호(라벨)는 키일 뿐이다 — 화면 번호는 조판기가 등장 순서로 다시 매긴다(작업노트 2026-10 R20).
 */
function strings(node, out) {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const n of node) strings(n, out); return out; }
  if (typeof node === 'object') { for (const k of Object.keys(node)) { if (k === 'lineStart' || k === 'lineEnd') continue; strings(node[k], out); } }
  return out;
}
function footnoteIssues(book) {
  const defs = book.footnotes || {};
  const bodies = [];
  for (const s of (book.front || [])) strings(s.blocks, bodies);
  for (const p of (book.parts || [])) for (const c of (p.chapters || [])) strings(c.blocks, bodies);
  for (const s of (book.back || [])) strings(s.blocks, bodies);
  const refs = new Map();
  for (const t of bodies) for (const m of t.matchAll(/\[\^([^\]]+)\]/g)) refs.set(m[1], (refs.get(m[1]) || 0) + 1);
  const dups = [...new Set(book.footnoteDups || [])];
  const undefinedRefs = [...refs.keys()].filter((id) => !(id in defs));
  const unused = Object.keys(defs).filter((id) => !refs.has(id));
  const reused = [...refs.entries()].filter(([id, n]) => n > 1 && id in defs).map(([id]) => id);
  return { dups, undefinedRefs, unused, reused, refCount: [...refs.values()].reduce((a, b) => a + b, 0), defCount: Object.keys(defs).length };
}
/** 로그·점검표용 문장들(없으면 []) */
function warnings(fx) {
  const out = [];
  const list = (a) => a.slice(0, 6).join(' ') + (a.length > 6 ? ` 외 ${a.length - 6}개` : '');
  if (fx.dups.length) out.push(`⚠ 각주 번호 중복 정의 ${fx.dups.length}개(${list(fx.dups)}) — 뒤의 정의가 앞을 덮어 본문 단어와 각주 설명이 어긋납니다. 번호를 권 전체에서 겹치지 않게 하세요`);
  if (fx.undefinedRefs.length) out.push(`⚠ 정의 없는 각주 참조 ${fx.undefinedRefs.length}개(${list(fx.undefinedRefs)}) — 본문에 [^번호] 가 글자 그대로 남습니다`);
  if (fx.unused.length) out.push(`ℹ 본문에서 쓰이지 않는 각주 정의 ${fx.unused.length}개(${list(fx.unused)})`);
  return out;
}
module.exports = { footnoteIssues, warnings };
