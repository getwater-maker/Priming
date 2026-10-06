'use strict';
/**
 * roy-marks.js — 🟥 경험 · 🟨 해석 표시 읽기 (2026-10-06, v0.7.3 · 채널사업부 요청 「화자는 실제 로이」)
 *
 * 대본의 「나」 = 실제 로이. Claude 가 초안을 쓰고 로이가 고칠 자리를 표시한다 → 대본 보기가 색을 칠하고,
 * 로이가 고치거나 「사실 확인」을 누르면 「Claude 원문 → 로이 수정」 쌍을 은행에 모은다(core/roy-bank.js).
 *
 * 🔑 표시 문법(Priming 이 정함 — 채널사업부 화자 규약 §3 이 이걸 따른다):
 *     > 📝 🟥 경험·가안          ← 바로 아래 문단 전체가 🟥 (상태: 은행 · 가안 · 확인 / 빠지면 가안)
 *     손주 돌잔치 날, 사진을 찍던 …
 *
 *     > 📝 🟨 해석               ← 바로 아래 문단 전체가 🟨 (상태 없음)
 *     저는 이 대목에서 …
 *   - 글자가 아니라 **자리**로 가리킨다 → 로이가 문장 첫머리를 고쳐도 표시가 떨어지지 않는다.
 *   - `> 📝` 줄은 원래 낭독·그룹·자막·이미지·책 출력에서 빠진다(새는 곳이 없다). 장 메모 칸에서는 이 줄을 거른다(isMarkLine).
 *   - 표시 줄과 문단 사이의 빈 줄·다른 `>` 줄(🖼️ 이미지 등)은 건너뛴다. 제목(#)이 먼저 나오면 「못 찾음」.
 * 🔙 옛 임시 형식(화자 규약 §3-1)도 읽는다: `> 📝 - 🟥 경험·가안: 「첫 낱말」로 시작하는 문장|문단` — 그 장(H2) 안에서
 *     첫 낱말로 시작하는 문장을 찾는다(문장 = 그 문장만 · 문단 = 그 문장부터 문단 끝까지). 첫머리를 고치면 떨어진다 — 새 형식을 권한다.
 *
 * 문장 맞추기: 표시한 글(문단)의 지문(sigOf — 공백·따옴표·이모지·* 제거)을 파싱된 문장 지문을 이은 줄에서 앞으로만 찾는다.
 *   splitter(문장 규칙 정본)는 건드리지 않는다 — 문장에 줄 번호가 없어서 글로 맞춘다.
 * ⚠ 렌더러 번들에 들어갈 수 있다 — fs·CJS 런타임 참조 금지(순수 함수만).
 */
const { SPEAKER_LINE_RE, HEADER_LINE_CAPTURE, BRACKET_SECTION_RE } = require('./sentence-splitter');
const { sigOf: _sig } = require('./script-reader');

const sig = (t) => _sig(t).replace(/[*_~`]/g, '');
const KIND = { '🟥': 'exp', '🟨': 'int' };
const STATES = ['은행', '가안', '확인'];
// 새 형식 — 한 줄에 표시만
const POS_RE = /^(\s*>\s*📝\s*)(🟥|🟨)\s*(경험|해석)(?:\s*[·・]\s*(은행|가안|확인))?\s*$/u;
// 옛 임시 형식 — 「첫 낱말」로 시작하는 문장/문단
const ANCHOR_RE = /^(\s*>\s*📝\s*(?:[-•]\s*)?)(🟥|🟨)\s*(경험|해석)(?:\s*[·・]\s*(은행|가안|확인))?\s*[:：]\s*[「『“"']\s*(.+?)\s*[」』”"']\s*(?:로|으로)?\s*시작하는\s*(문장|문단)/u;
const FENCE_RE = /^\s*```/;
const BQ_RE = /^[ \t]*>/;

/** 표시 줄인가(장 메모 칸에서 거른다) */
function isMarkLine(line) { return POS_RE.test(line) || ANCHOR_RE.test(line); }

function _parseLine(line) {
  let m = line.match(POS_RE);
  if (m) {
    const k = KIND[m[2]];
    if ((k === 'exp') !== (m[3] === '경험')) return null;   // 🟥 해석 · 🟨 경험 은 틀린 짝
    return { form: 'pos', k, st: k === 'exp' ? (m[4] || '가안') : null };
  }
  m = line.match(ANCHOR_RE);
  if (m) {
    const k = KIND[m[2]];
    if ((k === 'exp') !== (m[3] === '경험')) return null;
    return { form: 'anchor', k, st: k === 'exp' ? (m[4] || '가안') : null, anchor: m[5], unit: m[6] };
  }
  return null;
}

/** 대본 원문 → 표시 목록 [{line, form, k, st, text, h2, anchor?, unit?}] (text = 가리키는 문단 글 · 못 찾으면 '') */
function scanMarks(raw) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let fence = false, h2 = 0;
  const narr = (s) => { const sp = s.match(SPEAKER_LINE_RE); return sp ? sp[2] : s; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const hm = line.match(HEADER_LINE_CAPTURE);
    if (hm) { if (hm[1].length <= 2) h2++; continue; }
    const p = _parseLine(line);
    if (!p) continue;
    const mk = { line: i, h2, ...p, text: '' };
    if (p.form === 'pos') {
      let j = i + 1;
      while (j < lines.length && (!lines[j].trim() || BQ_RE.test(lines[j]))) j++;   // 빈 줄·다른 > 줄은 건너뛴다
      const buf = [];
      while (j < lines.length && lines[j].trim() && !BQ_RE.test(lines[j]) && !HEADER_LINE_CAPTURE.test(lines[j]) && !BRACKET_SECTION_RE.test(lines[j]) && !FENCE_RE.test(lines[j])) {
        buf.push(narr(lines[j])); j++;
      }
      mk.text = buf.join(' ').trim();
    }
    out.push(mk);
  }
  return out;
}

/**
 * 표시 → 파싱된 문장에 붙이기.
 * @param {string} raw 대본 원문
 * @param {{id:string, text:string}[]} sentences 편의 문장들(순서대로)
 * @returns {{marks: {mid, line, form, k, st, sids:string[], text, found:boolean}[], bySid: Object<string,{mid,k,st,first:boolean}>}}
 *   mid = 표시 순번 기반 이름(`exp1`·`int2` — 대본 안에서 표시를 더하거나 빼지 않는 한 그대로) · text = 맞춘 문장들을 이은 글(은행 「수정」)
 */
function attachMarks(raw, sentences) {
  const ss = (sentences || []).map((s) => ({ id: s.id, sg: sig(s.text) }));
  // 문장 지문을 이은 줄과 각 문장의 시작 위치
  const starts = []; let stream = '';
  for (const s of ss) { starts.push(stream.length); stream += s.sg; }
  const idxAt = (pos) => { let lo = 0, hi = starts.length - 1, r = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= pos) { r = mid; lo = mid + 1; } else hi = mid - 1; } return r; };
  // 커서는 앞으로만 간다(같은 글이 두 번 나와도 표시 순서대로 짝짓는다) — 옛 형식은 메모 줄이 장 머리에 있어 그 장의 첫 일치를 잡는다
  const scanned = scanMarks(raw);
  const marks = []; const bySid = {};
  let cursor = 0, h2Base = 0, lastH2 = -1; const seq = { exp: 0, int: 0 };
  for (const m of scanned) {
    if (m.h2 !== lastH2) { lastH2 = m.h2; h2Base = cursor; }   // 옛 형식은 그 장 안에서 순서와 무관하게 찾는다
    const mid = m.k + (++seq[m.k]);
    let sids = [];
    if (m.form === 'pos' && m.text) {
      const T = sig(m.text);
      let at = T ? stream.indexOf(T, cursor) : -1;
      while (at >= 0 && starts[idxAt(at)] !== at) at = stream.indexOf(T, at + 1);   // 문장 시작에서만
      if (at >= 0) {
        const a = idxAt(at), b = idxAt(at + T.length - 1);
        for (let k = a; k <= b; k++) sids.push(ss[k].id);
        cursor = at + T.length;
      }
    } else if (m.form === 'anchor') {
      const A = sig(m.anchor);
      let at = A ? stream.indexOf(A, h2Base) : -1;
      while (at >= 0 && starts[idxAt(at)] !== at) at = stream.indexOf(A, at + 1);
      if (at >= 0) {
        const a = idxAt(at);
        let b = a;
        if (m.unit === '문단') {   // 문단 끝 = 그 문장이 든 원문 문단의 끝
          const P = sig(_paraOfSentence(raw, sentences[a].text));
          const pAt = P ? stream.lastIndexOf(P, at) : -1;
          if (pAt >= 0 && pAt + P.length > at) b = idxAt(pAt + P.length - 1);
        }
        for (let k = a; k <= b; k++) sids.push(ss[k].id);
        cursor = Math.max(cursor, starts[b] + ss[b].sg.length);
      }
    }
    const found = sids.length > 0;
    const text = found ? sids.map((id) => (sentences.find((s) => s.id === id) || {}).text || '').join(' ').trim() : '';
    marks.push({ mid, line: m.line, form: m.form, k: m.k, st: m.st, sids, text, found });
    sids.forEach((id, i) => { bySid[id] = { mid, k: m.k, st: m.st, first: i === 0 }; });
  }
  return { marks, bySid };
}

// 한 문장이 든 원문 문단(빈 줄로 나뉜 본문 줄 묶음) — 옛 형식 「…로 시작하는 문단」의 끝을 정할 때만
function _paraOfSentence(raw, text) {
  const T = sig(text); if (!T) return '';
  for (const para of String(raw || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const body = para.split('\n').filter((l) => l.trim() && !BQ_RE.test(l) && !HEADER_LINE_CAPTURE.test(l)).map((l) => { const sp = l.match(SPEAKER_LINE_RE); return sp ? sp[2] : l; }).join(' ');
    if (sig(body).includes(T)) return body;
  }
  return '';
}

/** 표시 줄의 상태를 바꾼 원문(🟥 만 · 그 줄만 고친다). 줄이 표시 줄이 아니면 null. */
function setMarkState(raw, lineIdx, st) {
  if (!STATES.includes(st)) return null;
  const nl = /\r\n/.test(String(raw)) ? '\r\n' : '\n';
  const lines = String(raw || '').split(/\r?\n/);
  const line = lines[lineIdx];
  if (line == null) return null;
  let m = line.match(POS_RE);
  if (m && m[2] === '🟥') { lines[lineIdx] = `${m[1]}🟥 경험·${st}`; return lines.join(nl); }
  m = line.match(ANCHOR_RE);
  if (m && m[2] === '🟥') { lines[lineIdx] = line.replace(/(🟥\s*경험)(?:\s*[·・]\s*(?:은행|가안|확인))?/u, `$1·${st}`); return lines.join(nl); }
  return null;
}

/**
 * 개수 — 화면 머리 「🟥 미확인 n · 🟨 n」 · 렌더 경고.
 * 🔴 문단을 못 찾은 🟥(표시가 떨어짐) 중 `확인` 이 아닌 것도 **미확인으로 센다**(lostOpen) — 안 세면 떨어진 가안이 렌더 관문을 그냥 지난다
 *   (v0.7.13 · 다른 세션의 장면 나누기가 표시 줄과 문단 사이에 ### 를 끼워 야담 1007 🟨 가 떨어진 일로 찾은 구멍).
 */
function countMarks(marks) {
  const c = { exp: 0, expOpen: 0, int: 0, lost: 0, lostOpen: 0 };
  for (const m of marks || []) {
    if (!m.found) { c.lost++; if (m.k === 'exp' && m.st !== '확인') { c.expOpen++; c.lostOpen++; } continue; }
    if (m.k === 'exp') { c.exp++; if (m.st !== '확인') c.expOpen++; } else c.int++;
  }
  return c;
}

module.exports = { scanMarks, attachMarks, setMarkState, countMarks, isMarkLine, sig, STATES };
