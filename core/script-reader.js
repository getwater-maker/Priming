'use strict';
/**
 * script-reader.js — 📄 대본 읽기(점검·수정용) 내용 만들기 — **단일 구현** (2026-09-24, v0.5.33)
 *
 * 로이: "대본을 읽기 편하게 볼 수 있는 화면 … 대본의 내용만 깔끔하게 … A4 기준 출력 · 한 장에 몇 쪽".
 *   화면(ScriptReader.jsx)과 A4 PDF(main 'script-reader-pdf')가 **같은 블록**을 쓴다 — 두 벌이면 화면에서 본 것과 인쇄가 갈린다.
 *   ⚠ 렌더러 번들에도 들어간다 — 정적 require('./yt-chapters') 외의 CJS 런타임 참조(typeof require 등)를 두지 말 것(v0.3.40 백지 화면 사고).
 *
 * 입력 = DTO 한 편(pr.title · cuts[].h2/phase/num/sentences[].text/speaker/mark). 이미지·영상 프롬프트·메타는 넣지 않는다.
 * 블록: {t:'h1'|'h2'|'h3', text} · {t:'p', groupNum, sents:[{i, text, speaker}]}
 *   i = 그 그룹 안 문장 번호(0부터) — 화면에서 고칠 때 edit-sentences 가 쓰는 주소와 같다.
 */

// 제작 표기 꼬리 제거는 ⏱ 챕터와 **같은 함수**(두 규칙이면 목차와 챕터 제목이 갈린다)
const { tsCleanTitle: cleanHead } = require('./yt-chapters');
// 비교 지문은 파서가 지우는 문자(따옴표·이모지)를 뺀다 — 정규식 정본은 sentence-splitter(복제하지 않는다)
const { MATCH_PATTERNS } = require('./sentence-splitter');

/** 한 편(DTO) → 읽기 블록 */
function readerBlocks(pr, { headings = true } = {}) {
  const out = [];
  if (!pr) return out;
  if (pr.title) out.push({ t: 'h1', text: String(pr.title).trim() });
  let lastH2 = '', lastH3 = '';
  // `##`(H2 = 장 제목)은 언제나 보인다. headings 는 **섹션 제목(### = H3)** 만 켜고 끈다(로이 2026-09-25 — 기본 끔).
  const head = (h2raw, phraw) => {
    const h2 = cleanHead(h2raw), h3 = cleanHead(phraw);
    if (h2 && h2 !== lastH2) { out.push({ t: 'h2', text: h2 }); lastH2 = h2; lastH3 = ''; }
    if (headings && h3 && h3 !== lastH3 && h3 !== lastH2) { out.push({ t: 'h3', text: h3 }); lastH3 = h3; }
  };
  for (const c of (pr.cuts || [])) {
    const ss = c.sentences || [];
    head(c.h2, c.phase);
    let p = { t: 'p', groupNum: c.num, sents: [] };
    ss.forEach((s, i) => {
      // 합친 그룹(⤒ · 「이미지: 이어서」) 안의 챕터 경계 — 거기서 제목을 다시 단다
      if (s.mark && i > 0) {
        if (p.sents.length) out.push(p);
        head(s.mark.h2, s.mark.phase);
        p = { t: 'p', groupNum: c.num, sents: [] };
      }
      const text = String(s.text || '').trim();
      if (text) p.sents.push({ i, text, speaker: s.speaker || null });
    });
    if (p.sents.length) out.push(p);
  }
  return out;
}

/** 통계 — 글자 수(공백 제외) · 문장 수 · 음성 길이 합 */
function readerStats(pr) {
  let chars = 0, sents = 0, dur = 0;
  for (const c of ((pr && pr.cuts) || [])) for (const s of (c.sentences || [])) {
    const t = String(s.text || '');
    chars += t.replace(/\s/g, '').length; sents++; dur += Number(s.dur) || 0;
  }
  return { chars, sents, dur };
}

// ── ✏ 문단 편집 — 워드처럼 문단을 이어서 고치고 **바뀐 문장만** 대본에 보낸다 (2026-09-24, v0.5.34) ──
//   화면 문단 = 그 문단 문장들을 공백 하나로 이은 글. 사용자가 고친 글과 **글자 단위로 비교**(Myers)해서
//   고친 글자가 닿은 문장만 묶어(hunk) edit-sentences 로 보낸다. 안 닿은 문장은 .md 의 그 자리(줄바꿈·따옴표 포함)를 건드리지 않는다.
//   🔑 문장 사이 공백(구분자)을 지우거나 바꾸면 **앞뒤 두 문장**이 함께 hunk 가 된다(두 문장이 합쳐지는 편집이므로).
//   🔑 문장 앞에 끼운 글은 그 문장에, 문장 끝(구분자 앞)에 붙인 글은 그 문장에 붙는다.
//   🔑 공백·따옴표·이모지만 달라진 hunk 는 보내지 않는다(파서가 어차피 지운다 → 보내면 저장이 헛돈다).
const SIG_IGNORE = new RegExp('\\s|' + MATCH_PATTERNS.quote.source + '|' + MATCH_PATTERNS.special.source, 'gu');
const sigOf = (t) => String(t == null ? '' : t).replace(SIG_IGNORE, '');
const joinParagraph = (texts) => texts.map((t) => String(t || '').trim()).join(' ');
const MYERS_MAX_D = 1500;   // 이보다 많이 바뀌면 가운데를 통째로 바뀐 것으로 본다(메모리 보호)
const END_PUNCT = /[.!?。]["'”’」』)\]]*$/;

// a[aS..aE) ↔ b[bS..bE) 의 글자 대응 — match(i, j) 로 알린다. 너무 많이 다르면 false(=통째로 다름).
function myersMatch(a, aS, aE, b, bS, bE, match) {
  const n = aE - aS, m = bE - bS, max = n + m;
  if (!max) return true;
  const off = max, v = new Int32Array(2 * max + 2), trace = [];
  for (let d = 0; d <= Math.min(max, MYERS_MAX_D); d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[aS + x] === b[bS + y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) {
        let cx = n, cy = m;
        for (let dd = d; dd > 0; dd--) {
          const vv = trace[dd], kk = cx - cy;
          const pk = (kk === -dd || (kk !== dd && vv[off + kk - 1] < vv[off + kk + 1])) ? kk + 1 : kk - 1;
          const px = vv[off + pk], py = px - pk;
          while (cx > px && cy > py) { cx--; cy--; match(aS + cx, bS + cy); }
          cx = px; cy = py;
        }
        while (cx > 0 && cy > 0) { cx--; cy--; match(aS + cx, bS + cy); }
        return true;
      }
    }
  }
  return false;
}

/**
 * 문단 편집 → 보낼 hunk 목록.
 * @param {string[]} oldTexts 그 문단의 지금 문장들(순서대로)
 * @param {string} newText 사용자가 고친 문단 글
 * @returns {{from:number, count:number, text:string}[]} from·count = 문단 안 문장 번호(0부터). text '' = 삭제.
 */
function paragraphEdits(oldTexts, newText) {
  const O = (oldTexts || []).map((t) => String(t || '').trim());
  const n = O.length;
  if (!n) return [];
  const J = O.join(' ');
  const N = String(newText == null ? '' : newText).replace(/\s*\r?\n\s*/g, ' ');
  if (N === J) return [];
  const nJ = J.length, nN = N.length;
  const mapJ = new Int32Array(nJ).fill(-1);
  let p = 0; while (p < nJ && p < nN && J[p] === N[p]) { mapJ[p] = p; p++; }
  let q = 0; while (q < nJ - p && q < nN - p && J[nJ - 1 - q] === N[nN - 1 - q]) { mapJ[nJ - 1 - q] = nN - 1 - q; q++; }
  myersMatch(J, p, nJ - q, N, p, nN - q, (i, j) => { mapJ[i] = j; });   // false 면 가운데는 -1(바뀜) 그대로
  // N 의 끼워 넣은 글자 → J 위치(그 앞 대응 글자 다음)
  const used = new Uint8Array(nN);
  for (let i = 0; i < nJ; i++) if (mapJ[i] >= 0) used[mapJ[i]] = 1;
  const insAt = new Uint8Array(nJ + 1);
  { let last = -1; const back = new Int32Array(nN).fill(-1);
    for (let i = 0; i < nJ; i++) if (mapJ[i] >= 0) back[mapJ[i]] = i;
    for (let j = 0; j < nN; j++) { if (back[j] >= 0) last = back[j]; else insAt[last + 1] = 1; }
  }
  const starts = [], ends = [];
  { let c = 0; for (const t of O) { starts.push(c); ends.push(c + t.length); c += t.length + 1; } }
  const touched = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const next = k + 1 < n ? starts[k + 1] : nJ + 1;
    for (let i = starts[k]; i < ends[k]; i++) if (mapJ[i] < 0) { touched[k] = 1; break; }
    for (let x = starts[k]; x < next && x <= nJ; x++) if (insAt[x]) { touched[k] = 1; break; }
    if (k + 1 < n && mapJ[ends[k]] < 0) { touched[k] = 1; touched[k + 1] = 1; }   // 구분자를 지웠다 = 두 문장을 잇는 편집
  }
  const out = [];
  for (let a = 0; a < n; a++) {
    if (!touched[a]) continue;
    let b = a; while (b + 1 < n && touched[b + 1]) b++;
    const ns = a === 0 ? 0 : mapJ[starts[a] - 1] + 1;
    const ne = b === n - 1 ? nN : mapJ[ends[b]];
    let text = N.slice(ns, ne).trim(), from = a, to = b;
    // 가장자리 문장이 글자 그대로 남아 있으면 hunk 에서 뺀다(문장 삭제가 다음 문장까지 다시 쓰지 않게)
    while (to > from && (text === O[to] || text.endsWith(' ' + O[to]))) { text = text.slice(0, text.length - O[to].length).trim(); to--; }
    while (to > from && (text === O[from] || text.startsWith(O[from] + ' '))) { text = text.slice(O[from].length).trim(); from++; }
    // 끝 마침표를 지웠으면 다음 문장과 한 문장이 된다 — 다음 문장까지 함께 보내야 검증 재파싱이 맞는다
    //   (원래부터 마침표 없던 문장은 늘리지 않는다 — 문단 끝 줄을 다음 줄과 합쳐 버리면 대본 구조가 바뀐다)
    while (to + 1 < n && text && END_PUNCT.test(O[to]) && !END_PUNCT.test(text)) { text = text + ' ' + O[to + 1]; to++; }
    if (sigOf(O.slice(from, to + 1).join('')) !== sigOf(text)) out.push({ from, count: to - from + 1, text });
    a = b;
  }
  return out;
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A4 인쇄용 HTML(한 쪽 = A4 한 장 기준). 여러 쪽 모아 찍기는 main 이 PDF 단계에서 한다.
 * @param {object[]} blocks readerBlocks 결과(여러 편이면 이어 붙인 것)
 * @param {{fontPt?:number, groupNums?:boolean}} o
 */
function readerHtml(blocks, { fontPt = 11, groupNums = false } = {}) {
  const body = blocks.map((b) => {
    if (b.t === 'h1') return `<h1>${esc(b.text)}</h1>`;
    if (b.t === 'h2') return `<h2>${esc(b.text)}</h2>`;
    if (b.t === 'h3') return `<h3>${esc(b.text)}</h3>`;
    const inner = b.sents.map((s) => (s.speaker ? `<b class="spk">${esc(s.speaker)}</b> ` : '') + esc(s.text)).join(' ');
    return `<p>${groupNums ? `<span class="gn">G${b.groupNum}</span>` : ''}${inner}</p>`;
  }).join('\n');
  const f = Math.max(7, Math.min(20, Number(fontPt) || 11));
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>대본</title><style>
@page { size: A4; margin: 18mm 17mm 20mm 17mm; }
html, body { margin: 0; padding: 0; background: #fff; color: #1d1a16; }
body { font-family: 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif; font-size: ${f}pt; line-height: 1.75; word-break: keep-all; overflow-wrap: anywhere; }
h1 { font-size: ${(f * 1.6).toFixed(1)}pt; line-height: 1.35; margin: 0 0 ${(f * 1.2).toFixed(1)}pt; padding-bottom: ${(f * 0.5).toFixed(1)}pt; border-bottom: 1.2pt solid #333; }
h2 { font-size: ${(f * 1.25).toFixed(1)}pt; margin: ${(f * 1.6).toFixed(1)}pt 0 ${(f * 0.5).toFixed(1)}pt; break-after: avoid; }
h3 { font-size: ${(f * 1.02).toFixed(1)}pt; color: #6b5a47; margin: ${(f * 1.0).toFixed(1)}pt 0 ${(f * 0.3).toFixed(1)}pt; break-after: avoid; }
p { margin: 0 0 ${(f * 0.75).toFixed(1)}pt; text-align: left; orphans: 2; widows: 2; }
.spk { color: #8a4b1f; }
.gn { display: inline-block; min-width: 2.6em; color: #a89682; font-size: 0.78em; font-weight: 700; }
</style></head><body>
${body}
</body></html>`;
}

/** 한 장에 N 쪽 — 용지 방향과 격자(가로 칸 × 세로 칸). Chrome 인쇄 대화상자의 「용지당 페이지 수」와 같은 배치. */
function nUpLayout(n) {
  switch (Number(n)) {
    case 2: return { landscape: true, cols: 2, rows: 1 };
    case 4: return { landscape: false, cols: 2, rows: 2 };
    case 6: return { landscape: true, cols: 3, rows: 2 };
    case 9: return { landscape: false, cols: 3, rows: 3 };
    default: return { landscape: false, cols: 1, rows: 1 };
  }
}
const PER_SHEET = [1, 2, 4, 6, 9];

module.exports = { readerBlocks, readerStats, readerHtml, nUpLayout, PER_SHEET, cleanHead, paragraphEdits, joinParagraph, sigOf };
