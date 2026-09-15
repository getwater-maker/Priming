/**
 * script-edit.js — 화면에서 문장을 바로 고치면 **원본 .md 의 그 자리만** 바꾼다.
 *
 * 왜 이 모듈이 필요한가
 *   옛 「✏ 대본 수정」은 .md 전문을 textarea 로 열어 통째로 다시 쓰는 방식이라,
 *   ① 한 문장을 고치려고 15,000자를 뒤져야 하고 ② 적용하면 **재파싱이라 TTS·이미지가 전부 초기화**됐다.
 *   인라인 편집은 그 반대다 — .md 에서 **그 문장이 차지한 문자 범위만** 바꾸고,
 *   파싱본(S.parsed)은 재파싱하지 않고 제자리에서 고친다(그룹 구조·프롬프트·자산이 그대로 산다).
 *
 * 🔑 어려운 부분은 하나뿐이다: **문장 텍스트 ↔ 원문 위치**.
 *   파서는 원문을 그대로 쓰지 않는다 — 따옴표·이모지를 지우고, 여러 줄을 공백으로 합치고,
 *   종결부호(. ! ? 。)로 자른다. 그래서 문장 텍스트로 .md 를 단순 검색하면 못 찾거나 엉뚱한 데를 찾는다.
 *   ⚠ 게다가 이 저장소의 대본은 **한 줄에 문장이 여러 개**이고(`A. B. C.`),
 *      머리말 블록쿼트에 본문과 거의 같은 문장이 들어 있다(실측: 「관계를 깨는 것은 거절이 아니라…」).
 *
 *   ⇒ 해법 = **마스킹 + 전방 커서 매칭**
 *      ① 문장이 될 수 없는 영역(헤더 줄 · '>' 줄 · [섹션] 줄 · HTML 주석)을 통째로 가린다.
 *         이게 없으면 머리말의 유사 문장에 먼저 걸려 **엉뚱한 줄을 고친다**(테스트가 이걸 단언).
 *      ② 남은 글자에서 파서가 버리는 문자(공백·따옴표·이모지)를 뺀 「지문(sig)」을 만들고,
 *         문장을 **순서대로 앞으로만** 찾는다(merge-assets 의 전방 커서와 같은 발상 — 같은 문장이
 *         여러 번 나와도 순서로 구분된다).
 *
 *   못 찾으면 **조용히 넘어가지 않고 거부**한다. 틀린 자리를 고치는 것이 안 고치는 것보다 훨씬 나쁘다.
 */

const { splitIntoSentences, MATCH_PATTERNS } = require('./sentence-splitter');

// 파서가 버리는 문자 = 매칭에서 양쪽 다 무시할 문자.
//   공백류 + 따옴표류 + 이모지/기호. (정규식 원본은 sentence-splitter 가 정본 — 여기서 복제하지 않는다)
const IGNORE_RE = new RegExp(
  '[\\s]|' + MATCH_PATTERNS.quote.source + '|' + MATCH_PATTERNS.special.source,
  'u'
);

/** 이 문자는 매칭에서 무시하는가 (파서가 지우거나 정규화하는 문자) */
function isIgnorable(ch) { return IGNORE_RE.test(ch); }

/** 비교용 지문 — 무시 문자를 뺀 문자열 */
function sigOf(text) {
  let out = '';
  for (const ch of String(text == null ? '' : text)) if (!isIgnorable(ch)) out += ch;
  return out;
}

/**
 * 문장이 될 수 없는 영역을 1 로 칠한 마스크.
 *   - HTML 주석 `<!-- … -->` (여러 줄 가능)
 *   - '>' 로 시작하는 줄 (지침 주석 · 🖼️/🎬 프롬프트)
 *   - 마크다운 헤더 줄
 *   - 줄 전체가 [섹션] 인 줄
 * ⚠ 파서(splitHybrid)가 제외하는 것과 **같은 규칙**이어야 한다. 규칙이 갈리면 위치가 어긋난다.
 */
function buildMask(raw) {
  const s = String(raw == null ? '' : raw);
  const mask = new Uint8Array(s.length);
  const cm = new RegExp(MATCH_PATTERNS.htmlComment.source, 'g');
  for (const m of s.matchAll(cm)) mask.fill(1, m.index, m.index + m[0].length);
  let pos = 0;
  for (const line of s.split('\n')) {
    const skip = MATCH_PATTERNS.blockquote.test(line)
      || MATCH_PATTERNS.headerLine.test(line)
      || MATCH_PATTERNS.bracketLine.test(line);
    if (skip) mask.fill(1, pos, pos + line.length);
    pos += line.length + 1;
  }
  return mask;
}

/**
 * 원문 → { sig, idx }
 *   sig    : 마스킹·무시문자를 뺀 지문 문자열
 *   idx[k] : sig 의 k 번째 글자가 원문에서 몇 번째 문자인지
 */
function buildIndex(raw) {
  const s = String(raw == null ? '' : raw);
  const mask = buildMask(s);
  let sig = '';
  const idx = [];
  for (let i = 0; i < s.length; i++) {
    if (mask[i]) continue;
    const ch = s[i];
    if (isIgnorable(ch)) continue;
    sig += ch;
    idx.push(i);
  }
  return { sig, idx };
}

/**
 * 문장 텍스트 배열의 원문 내 위치를 순서대로 찾는다.
 * @returns {Array<{start:number,end:number}|null>} 못 찾은 문장은 null
 * ⚠ 실패해도 커서를 움직이지 않는다 — 한 문장의 실패가 뒤 문장 전부를 밀어내지 않게(merge-assets 와 같은 규칙).
 */
function locateSentences(raw, texts) {
  const { sig, idx } = buildIndex(raw);
  const out = [];
  let cur = 0;
  for (const t of (texts || [])) {
    const ts = sigOf(t);
    if (!ts) { out.push(null); continue; }
    const k = sig.indexOf(ts, cur);
    if (k < 0) { out.push(null); continue; }
    out.push({ start: idx[k], end: idx[k + ts.length - 1] + 1 });
    cur = k + ts.length;
  }
  return out;
}

/**
 * 사용자가 편집칸에 쓴 글을 **대본 한 줄에 넣어도 안전한 형태**로 다듬는다.
 *   - 줄바꿈 → 공백 (여러 줄로 쓰면 단락이 갈려 그룹 구조가 흔들린다)
 *   - 줄머리 '>' · '#' 제거 (대본에서 그 줄은 통째로 주석·헤더가 되어 문장이 사라진다)
 *   - 앞뒤 공백 정리
 */
function normalizeEditText(text) {
  return String(text == null ? '' : text)
    .replace(/[\r\n]+/g, ' ')
    .replace(/^[ \t]*[>#]+[ \t]*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 편집 한 건을 계획한다 — 원문을 실제로 바꾼 결과와, 그 결과가 만들어 낼 문장 배열을 돌려준다.
 *
 * @param {object} o
 * @param {string} o.raw       현재 .md 전문
 * @param {string[]} o.texts   현재 파싱본의 전체 문장 텍스트(순서대로)
 * @param {number} o.from      바꿀 첫 문장의 인덱스(0-based, texts 기준)
 * @param {number} o.count     바꿀 문장 개수 (병합이면 2 이상)
 * @param {string} o.newText   새 텍스트 ('' 이면 삭제)
 * @returns {{ok:true, raw:string, newTexts:string[], span:{start,end}} | {ok:false, error:string}}
 */
function planEdit(o = {}) {
  const raw = String(o.raw == null ? '' : o.raw);
  const texts = o.texts || [];
  const from = Number(o.from);
  const count = Math.max(1, Number(o.count) || 1);
  if (!(from >= 0) || from + count > texts.length) return { ok: false, error: '문장 번호가 범위를 벗어납니다.' };

  const locs = locateSentences(raw, texts);
  for (let i = from; i < from + count; i++) {
    if (!locs[i]) {
      return {
        ok: false,
        error: `대본에서 이 문장의 자리를 찾지 못했습니다 — 「${String(texts[i]).slice(0, 24)}…」\n`
          + '대본(.md)이 앱 밖에서 수정됐을 수 있습니다. 대본을 다시 열고(🔄) 시도하세요.',
      };
    }
  }
  const span = { start: locs[from].start, end: locs[from + count - 1].end };
  // 🔴 문장이 **마스킹 영역을 가로지르면** 편집할 수 없다.
  //   실측 예: `…너희가 당하라` / `> 【낭독 끝】` / `손을 씻는 몸짓은…` — 종결부호가 없어 파서가 '>' 줄을
  //   건너뛰고 앞뒤를 한 문장으로 잇는다. 이 범위를 그대로 치환하면 **그 주석 줄이 함께 지워진다.**
  //   전 대본 실측 128,462 문장 중 1건뿐이라 거부가 맞다(잘못 지우는 것보다 안 고치는 것이 낫다).
  const mask = buildMask(raw);
  for (let i = span.start; i < span.end; i++) {
    if (mask[i]) {
      return {
        ok: false,
        error: '이 문장은 대본에서 지침 줄(> …)이나 헤더를 사이에 두고 이어져 있어 화면에서 고칠 수 없습니다.\n'
          + '대본(.md)에서 직접 수정하세요.',
      };
    }
  }
  const body = normalizeEditText(o.newText);
  const newRaw = raw.slice(0, span.start) + body + raw.slice(span.end);
  // 새 텍스트가 파서를 거치면 문장 몇 개가 되는가 — 마침표를 넣었으면 2개 이상(= 분할).
  const newTexts = body ? splitIntoSentences(body) : [];
  return { ok: true, raw: newRaw, newTexts, span };
}

/**
 * 편집 뒤 **기대되는 전체 문장 시퀀스** — 검증 재파싱과 대조할 정답지.
 */
function expectedTexts(texts, from, count, newTexts) {
  const out = (texts || []).slice(0, from);
  for (const t of (newTexts || [])) out.push(t);
  return out.concat((texts || []).slice(from + count));
}

/** 두 문장 시퀀스가 같은가 (공백 차이는 무시 — 파서 정규화 기준) */
function sameSequence(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (sigOf(a[i]) !== sigOf(b[i])) return false;
  return true;
}

module.exports = {
  sigOf, isIgnorable, buildMask, buildIndex, locateSentences,
  normalizeEditText, planEdit, expectedTexts, sameSequence,
};
