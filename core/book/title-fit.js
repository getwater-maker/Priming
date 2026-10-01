'use strict';
/**
 * title-fit.js — 📏 제목 길이 기준(로이 2026-10-01 「제목을 몇 자 이상 안 만든다와 같은 기준을 만들어야지 않겠어? 제목이 너무 길어서 모두 표시가 안되는데」)
 *   머리글은 한 줄만 쓸 수 있고(넘치면 말줄임) 목차는 2~3줄까지가 보기 좋다. 그래서 **글꼴의 실제 글자 폭**(hmtx)으로 각 회목이 들어가는지 재서
 *   「이 설정에서 한 줄에 최대 몇 자」라는 기준을 보여 주고, 넘치는 제목을 조판 때·구조 탭에서 미리 알린다(말줄임으로 조용히 잘리지 않게).
 *   - 머리글 : 전체 회목을 머리글에 쓰는 설정(`chapter` · 책제목/부제 포함)일 때만 한 줄 용량을 넘는지 본다 — `chapterNo`(「제N회」만)면 길이와 무관.
 *   - 목차   : 「제N회」 라벨 칸 + 회목 칸이 몇 줄이 되는지(권장 2줄 · 3줄까지 허용 · 4줄 이상 경고).
 *   - 원고 메타 `> 회목최대: 40` 이 있으면 그 글자 수(회목 = 「제N회」 뒤 글)를 넘는 제목도 알린다(번역·출판 쪽이 같은 기준으로 쓰게).
 *   순수 계산 — 일렉트론·브라우저 없이 돈다(test/title-fit.test.js · 실조판 대조는 test/book-toc.smoke.js).
 */
const fs = require('fs');
const path = require('path');
const G = require('./glyph-check');

const PT_PER_MM = 72 / 25.4;
const HEADER_PT = 8.5;   // 머리글 글자 크기 — html-builder 의 머리글 CSS 와 같은 값(R17 에서 9 → 8.5). 한 곳(여기)에서 정한다
const _met = new Map();
/** 글꼴 → { upm, adv(cp) → em | null } (hmtx + cmap) */
function metricsOf(file) {
  let st; try { st = fs.statSync(file); } catch (_) { return null; }
  const key = file + '|' + st.size + '|' + Math.round(st.mtimeMs);
  if (_met.has(key)) return _met.get(key);
  let m = null;
  try {
    const buf = fs.readFileSync(file);
    let base = 0;
    if (buf.toString('latin1', 0, 4) === 'ttcf') base = buf.readUInt32BE(12);
    const n = buf.readUInt16BE(base + 4);
    const tab = {};
    for (let i = 0; i < n; i++) { const e = base + 12 + i * 16; tab[buf.toString('latin1', e, e + 4)] = buf.readUInt32BE(e + 8); }
    const upm = buf.readUInt16BE(tab.head + 18);
    const nh = buf.readUInt16BE(tab.hhea + 34);
    const hm = tab.hmtx;
    const cm = G.cmapMapOf(file);
    if (cm && nh > 0) {
      m = {
        upm,
        adv: (cp) => {
          const gid = cm.get(cp); if (gid == null) return null;
          const i = gid < nh ? gid : nh - 1;
          return buf.readUInt16BE(hm + i * 4) / upm;
        },
      };
    }
  } catch (_) { m = null; }
  _met.set(key, m);
  return m;
}
/** 글꼴 목록(앞에서부터 그 글자를 가진 첫 글꼴)으로 글줄 폭(pt) — 글꼴에 없는 글자는 1em(한자·한글 전각) 가정 */
function widthPt(text, fonts, sizePt, letterSpacingPt = 0) {
  let w = 0;
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    let a = null;
    for (const f of fonts) { if (!f) continue; a = f.adv(cp); if (a != null) break; }
    w += (a != null ? a : 1) * sizePt + letterSpacingPt;
  }
  return w;
}
/** 어절(공백) 단위 줄바꿈 — word-break: keep-all. 한 어절이 한 줄보다 길면 글자 단위로 자른다. 줄 수만 센다 */
function countLines(text, fonts, sizePt, lineWidthPt, letterSpacingPt = 0) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const sp = widthPt(' ', fonts, sizePt, letterSpacingPt);
  let lines = 1, cur = 0;
  for (const wd of words) {
    const ww = widthPt(wd, fonts, sizePt, letterSpacingPt);
    if (ww > lineWidthPt) {   // 너무 긴 어절 — 글자 단위
      let c = cur ? cur + sp : 0;
      for (const ch of wd) {
        const cw = widthPt(ch, fonts, sizePt, letterSpacingPt);
        if (c + cw > lineWidthPt && c > 0) { lines++; c = 0; }
        c += cw;
      }
      cur = c; continue;
    }
    if (cur === 0) cur = ww;
    else if (cur + sp + ww <= lineWidthPt) cur += sp + ww;
    else { lines++; cur = ww; }
  }
  return lines;
}

const TOC_LABEL_EM = 3.7;              // .no 칸(html-builder 의 nav.toc a .no flex-basis)
const TOC_RESERVE_EM = 1.5 + 1.1 + 1.8; // 점선 최소폭 + 좌우 여백(0.55em×2) + 쪽번호(0.95em 고딕 3자)
const CH_RE = /^(제\s*\d+\s*회)[.,]?\s*(.+)$/;

/**
 * @param {object} book  parseBookText 결과(parts·meta)
 * @param {object} o     html-builder.resolveBookOptions 의 o (trimW · marginsMm · headerEven/Odd · tocSizePt · fontSizePt · letterSpacingPt)
 * @param {string} fontDir assets/fonts/book
 * @param {{excluded?:string[], chapterExcluded?:Function}} [x]
 */
function analyze(book, o, fontDir, x = {}) {
  const meta = book.meta || {};
  const dotum = metricsOf(path.join(fontDir, 'KoPubWorld-Dotum-Light.ttf'));
  const batang = metricsOf(path.join(fontDir, 'KoPubWorld-Batang-Light.ttf'));
  const noto = metricsOf(path.join(fontDir, 'NotoSerifKR-Light.ttf'));
  const hanja = metricsOf(path.join(fontDir, 'HanjaSerif-Light.ttf'));
  const headFonts = [dotum, noto, hanja];            // 머리글 = 고딕 8.5pt(한자는 폴백 명조)
  const bodyFonts = [batang, noto, hanja];           // 목차 = 본문 명조
  const bodyWpt = (o.trimW - o.marginsMm.inner - o.marginsMm.outer) * PT_PER_MM;
  const headPt = HEADER_PT;
  const headCap = bodyWpt - 1;                       // 머리글 상자 폭(판면 폭)
  const tocSize = o.tocSizePt || o.fontSizePt || 10;
  const tocLS = o.letterSpacingPt || 0;
  const tocWidth = bodyWpt - (TOC_LABEL_EM + TOC_RESERVE_EM) * tocSize;
  const emH = (dotum && dotum.adv(0xAC00)) || 1, emB = (batang && batang.adv(0xAC00)) || 1;
  const usesFull = (k) => k === 'chapter';
  const limitChars = Number(String(meta.titleMax || '').replace(/[^0-9]/g, '')) || 0;
  const items = [];
  const excluded = x.excluded || [];
  for (const p of (book.parts || [])) {
    for (const c of (p.chapters || [])) {
      if (!c.title) continue;
      if (x.chapterExcluded && x.chapterExcluded(c.title, excluded)) continue;
      const mc = CH_RE.exec(c.title);
      const name = mc ? mc[2] : c.title;
      const hw = widthPt(c.title, headFonts, headPt);           // 머리글에 전체 회목이 실릴 때의 폭
      const tocLines = countLines(name, bodyFonts, tocSize, tocWidth, tocLS);
      const flags = [];
      const headerUses = usesFull(o.headerEven) || usesFull(o.headerOdd);
      if (headerUses && hw > headCap) flags.push('header');
      if (tocLines > 3) flags.push('toc3'); else if (tocLines > 2) flags.push('toc2');
      if (limitChars && Array.from(name).length > limitChars) flags.push('max');
      items.push({ num: c.num, title: c.title, name, chars: Array.from(name).length, headerPt: Math.round(hw * 10) / 10, tocLines, flags });
    }
  }
  // 책 제목 머리글(title/subtitle)이 한 줄에 드는지
  let bookTitleOver = null;
  for (const [side, kind] of [['짝수', o.headerEven], ['홀수', o.headerOdd]]) {
    if (kind !== 'title' && kind !== 'subtitle') continue;
    const t = kind === 'subtitle' ? (meta.subtitle || '') : ((meta.title || book.fileTitle || '') + (o.hasSubtitle ? ' / ' + meta.subtitle : ''));
    const w = widthPt(t, headFonts, headPt);
    if (w > headCap) bookTitleOver = { side, kind, text: t, widthPt: Math.round(w), capacityPt: Math.round(headCap) };
  }
  return {
    ok: !!(dotum && batang),
    header: { even: o.headerEven, odd: o.headerOdd, usesFullTitle: usesFull(o.headerEven) || usesFull(o.headerOdd), capacityPt: Math.round(headCap), charsApprox: Math.floor(headCap / (headPt * emH)) },
    toc: { sizePt: tocSize, widthPt: Math.round(tocWidth), recommendLines: 2, maxLines: 3, chars2Approx: Math.floor(2 * tocWidth / (tocSize * emB)), chars3Approx: Math.floor(3 * tocWidth / (tocSize * emB)) },
    limitChars: limitChars || null,
    bookTitleOver,
    items,
    count: { header: items.filter((i) => i.flags.includes('header')).length, toc2: items.filter((i) => i.flags.includes('toc2')).length, toc3: items.filter((i) => i.flags.includes('toc3')).length, max: items.filter((i) => i.flags.includes('max')).length },
  };
}

/** 로그용 경고 문장들(없으면 []) */
function warnings(fit) {
  const out = [];
  if (!fit || !fit.ok) return out;
  const names = (arr) => arr.slice(0, 4).map((i) => `${(CH_RE.exec(i.title) || [, i.title])[1].replace(/\s+/g, '')}(${i.chars}자)`).join(' ') + (arr.length > 4 ? ` 외 ${arr.length - 4}개` : '');
  const hdr = fit.items.filter((i) => i.flags.includes('header'));
  if (hdr.length) out.push(`⚠ 제목이 길어 머리글에서 잘립니다(…으로 줄임) — 전체 회목을 머리글에 쓰면 한 줄에 약 ${fit.header.charsApprox}자까지입니다. ${hdr.length}개: ${names(hdr)} → 머리글을 「제N회」(chapterNo · 원고 \`> 머리글홀수: 제N회\`)로 하거나 회목을 줄이세요`);
  if (fit.bookTitleOver) out.push(`⚠ 책 제목 머리글(${fit.bookTitleOver.side}쪽)이 한 줄에 다 안 들어가 잘립니다(${fit.bookTitleOver.widthPt}pt > ${fit.bookTitleOver.capacityPt}pt) — 머리글에 쓸 짧은 책 제목으로 줄이거나 머리글을 바꾸세요`);
  const t3 = fit.items.filter((i) => i.flags.includes('toc3'));
  if (t3.length) out.push(`⚠ 목차에서 4줄 이상이 되는 회목 ${t3.length}개(목차 한 칸에 3줄 약 ${fit.toc.chars3Approx}자까지): ${names(t3)} → 회목을 줄이세요`);
  const mx = fit.items.filter((i) => i.flags.includes('max'));
  if (mx.length) out.push(`⚠ 원고 기준 \`> 회목최대: ${fit.limitChars}\`자를 넘는 회목 ${mx.length}개: ${names(mx)}`);
  return out;
}
module.exports = { HEADER_PT, analyze, warnings, metricsOf, widthPt, countLines, CH_RE };
