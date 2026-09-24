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

/** 한 편(DTO) → 읽기 블록 */
function readerBlocks(pr, { headings = true } = {}) {
  const out = [];
  if (!pr) return out;
  if (pr.title) out.push({ t: 'h1', text: String(pr.title).trim() });
  let lastH2 = '', lastH3 = '';
  const head = (h2raw, phraw) => {
    if (!headings) return;
    const h2 = cleanHead(h2raw), h3 = cleanHead(phraw);
    if (h2 && h2 !== lastH2) { out.push({ t: 'h2', text: h2 }); lastH2 = h2; lastH3 = ''; }
    if (h3 && h3 !== lastH3 && h3 !== lastH2) { out.push({ t: 'h3', text: h3 }); lastH3 = h3; }
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

module.exports = { readerBlocks, readerStats, readerHtml, nUpLayout, PER_SHEET, cleanHead };
