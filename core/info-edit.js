'use strict';
/**
 * info-edit.js — 📇 정보 카드 표시 줄 고치기(① 미리보기에서 끌어 옮기기 · 글자 고치기) — 2026-10-12 v0.8.8
 *   대본(.md)의 **표시 줄 그 줄만** 바꾼다(앞뒤 낭독 문단·🖼️·🎬 줄은 한 글자도 안 건드린다 · 줄바꿈 CRLF/LF 유지).
 *   🔴 쓰기 전에 **검증 재파싱**: 낭독 문장이 그대로이고 · 표시 줄 개수가 그대로이고 · 고친 표시가 의도한 값일 때만 돌려준다(아니면 {ok:false}).
 *   순수 함수 — fs 없음(파일 읽기·쓰기는 main).
 */
const IC = require('./info-cards');

const BQ = /^[ \t]*>/;
const eolOf = (raw) => (raw.includes('\r\n') ? '\r\n' : '\n');

/** 대본 글 → 표시 줄 위치 목록 [{line, end, kind, mark, sep}] — splitHybrid 가 표시 줄을 읽는 규칙(표는 `>` 줄이 끊기면 닫힘)과 같다 */
function scan(raw) {
  const lines = String(raw).split(/\r?\n/);
  const marks = []; let open = null;
  lines.forEach((line, i) => {
    const ik = IC.lineKind(line, open);
    if (ik) {
      if (ik.mark) { const m = { line: i, end: i, kind: ik.mark.kind, mark: ik.mark, sep: false }; marks.push(m); open = ik.opensTable ? m : null; }
      else if (ik.sourceText != null) { if (open) { open.end = i; open.mark.source = ik.sourceText; } open = null; }
      else if (ik.rowText !== undefined) { if (open) { open.end = i; if (ik.rowText === null) open.sep = true; else open.mark.rows.push(ik.rowText); } }
      return;
    }
    if (open && !BQ.test(line) && line.trim() !== '') open = null;
  });
  return { lines, marks, eol: eolOf(raw) };
}

const numSig = (s) => (String(s || '').match(/\d+(?:[.,]\d+)*/g) || []).join('|');
const tagStr = (pos) => (pos ? ' @' + IC.posName(pos) : '');
const indentOf = (line) => (/^[ \t]*/.exec(line) || [''])[0];

/** 표시(mi번째)가 가진 글(숫자 비교용) */
function contentOf(m) {
  if (!m) return '';
  if (m.kind === 'words') return (m.words || []).join(' | ');
  if (m.kind === 'check') return m.text || '';
  if (m.kind === 'table') return [m.title, ...(m.rows || []).map((r) => r.join(' | ')), m.source || ''].join('\n');
  return '';
}

/** 검증 재파싱 — 낭독 문장 그대로 · 표시 개수 그대로 · 고친 표시 mi 가 의도한 값 */
function verify(oldRaw, newRaw, mi, expect) {
  let a, b;
  try { a = IC.fromRaw(oldRaw); b = IC.fromRaw(newRaw); } catch (e) { return `다시 읽기 실패: ${e.message}`; }
  if (JSON.stringify(a.texts) !== JSON.stringify(b.texts)) return '낭독 문장이 달라져 저장하지 않았습니다(표시 줄 밖이 바뀜)';
  if (a.marks.length !== b.marks.length) return '표시 줄 개수가 달라져 저장하지 않았습니다';
  for (let i = 0; i < a.marks.length; i++) {
    if (i === mi) continue;
    if (JSON.stringify(a.marks[i]) !== JSON.stringify(b.marks[i])) return `다른 표시(${i + 1}번)가 바뀌어 저장하지 않았습니다`;
  }
  const m = b.marks[mi]; if (!m) return '고친 표시를 다시 읽지 못했습니다';
  for (const [k, v] of Object.entries(expect || {})) if (JSON.stringify(m[k] == null ? null : m[k]) !== JSON.stringify(v == null ? null : v)) return `고친 값(${k})이 다시 읽은 값과 달라 저장하지 않았습니다`;
  return null;
}

function pick(raw, mi, kinds) {
  const sc = scan(raw), m = sc.marks[mi];
  if (!m) return { error: `${mi + 1}번째 표시 줄을 대본에서 찾지 못했습니다` };
  if (kinds && !kinds.includes(m.kind)) return { error: `이 표시(${m.kind})는 고칠 수 없는 종류입니다` };
  return { sc, m };
}

/** 자리 꼬리표 쓰기/지우기 — 🔤·✅ 줄 끝 `@왼쪽위` (pos = 'rc'|'lc'|'rt'|'lt'|null) */
function setPos(raw, mi, pos) {
  if (pos != null && !IC.POS_NAMES[pos]) { const f = IC.freePos(pos); if (!f) return { ok: false, error: '모르는 자리입니다' }; pos = f; }   // 🖱 자유 자리 "62,8"(v0.8.13)
  const f = pick(raw, mi, ['words', 'check']); if (f.error) return { ok: false, error: f.error };
  const { sc, m } = f;
  const line = sc.lines[m.line];
  const stripped = line.replace(/[ \t]*@[^\s@|]+[ \t]*$/u, '');
  const next = stripped.replace(/[ \t]+$/, '') + tagStr(pos);
  if (next === line) return { ok: true, raw, same: true, numChanged: false };
  const lines = sc.lines.slice(); lines[m.line] = next;
  const raw2 = lines.join(sc.eol);
  const bad = verify(raw, raw2, mi, { pos: pos || null });
  if (bad) return { ok: false, error: bad };
  return { ok: true, raw: raw2, numChanged: false };
}

/**
 * 글 고치기 — words: {words:[...]} · check: {text} · table: {title, rows:[[..]], source}
 *   자리 꼬리표(@…)는 그대로 둔다 · 글에 `@`·`|`(낱말·확인)·줄바꿈이 있으면 거절
 */
function setText(raw, mi, payload) {
  const f = pick(raw, mi, ['words', 'check', 'table']); if (f.error) return { ok: false, error: f.error };
  const { sc, m } = f; const mk = m.mark;
  const ind = indentOf(sc.lines[m.line]);
  const clean = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
  let newLines, expect;
  if (m.kind === 'words') {
    const words = (payload && payload.words || []).map(clean).filter(Boolean);
    if (!words.length) return { ok: false, error: '낱말이 비었습니다' };
    if (words.some((w) => /[@|]/.test(w))) return { ok: false, error: '낱말에는 「@」·「|」 를 쓸 수 없습니다(꼬리표·구분 기호)' };
    newLines = [`${ind}> 🔤 카드: ${words.join(' | ')}${tagStr(mk.pos)}`]; expect = { words };
  } else if (m.kind === 'check') {
    const text = clean(payload && payload.text);
    if (!text) return { ok: false, error: '확인 문구가 비었습니다' };
    if (/@/.test(text)) return { ok: false, error: '확인 문구에는 「@」 를 쓸 수 없습니다(자리 꼬리표 기호)' };
    newLines = [`${ind}> ✅ 확인: ${text}${tagStr(mk.pos)}`]; expect = { text };
  } else {
    const title = clean(payload && payload.title);
    const rows = (payload && payload.rows || []).map((r) => (r || []).map(clean));
    if (!rows.length || rows.some((r) => !r.length)) return { ok: false, error: '표에 줄이 없습니다' };
    if (rows.some((r) => r.some((c) => /\|/.test(c)))) return { ok: false, error: '표 칸에는 「|」 를 쓸 수 없습니다' };
    const source = clean(payload && payload.source);
    newLines = [`${ind}> 📊 표: ${title}`, `${ind}> | ${rows[0].join(' | ')} |`];
    if (m.sep) newLines.push(`${ind}> | ${rows[0].map(() => '---').join(' | ')} |`);
    for (const r of rows.slice(1)) newLines.push(`${ind}> | ${r.join(' | ')} |`);
    if (source) newLines.push(`${ind}> 📊 출처: ${source}`);
    expect = { title, rows, source };
  }
  const lines = sc.lines.slice(); lines.splice(m.line, m.end - m.line + 1, ...newLines);
  const raw2 = lines.join(sc.eol);
  if (raw2 === raw) return { ok: true, raw, same: true, numChanged: false };
  const bad = verify(raw, raw2, mi, expect);
  if (bad) return { ok: false, error: bad };
  const after = IC.fromRaw(raw2).marks[mi];
  return { ok: true, raw: raw2, numChanged: numSig(contentOf(mk)) !== numSig(contentOf(after)), before: contentOf(mk), after: contentOf(after) };
}

/** 고치기 창이 읽을 현재 글 */
function readMark(raw, mi) {
  const f = pick(raw, mi, ['words', 'check', 'table']); if (f.error) return { ok: false, error: f.error };
  const mk = f.m.mark;
  return { ok: true, kind: f.m.kind, words: mk.words || null, text: mk.text || '', title: mk.title || '', rows: mk.rows || null, source: mk.source || '', pos: mk.pos || null };
}

module.exports = { scan, setPos, setText, readMark, numSig, contentOf, verify };
