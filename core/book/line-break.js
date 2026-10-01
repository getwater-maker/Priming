'use strict';
/**
 * line-break.js — 📐 R18 양쪽 정렬 줄이 벌어지는 문제(삼국지 2권 292쪽 「제가 철기 3,000을 거느리고 가서…」 줄).
 *   본문은 text-align:justify + word-break:keep-all(어절 단위) 이라, 다음 어절이 안 들어가면 그 줄의 띄어쓰기만 넓어진다.
 *   줄바꿈 방식(원고 메타 `> 줄바꿈: 어절|글자|절충` · 조판 탭) —
 *     · 어절(기본) : 지금 방식 그대로(이 모듈은 아무것도 안 한다).
 *     · 글자       : word-break:normal(어절 중간에서도 끊음 — 줄 간격은 고르다). 마지막 줄에 한 글자만 남지 않게 끝 두 글자를 묶는다.
 *     · 절충       : 어절 단위를 지키되, 띄어쓰기가 평소의 `RATIO` 배를 넘게 벌어질 줄만 **다음 어절을 글자 단위로 넘긴다**.
 *                    글꼴 실제 글자 폭(title-fit.metricsOf)으로 줄을 미리 계산해, 그런 줄의 다음 어절 안에 `<wbr>` 끊을 자리를 한 곳만 둔다
 *                    (엔진이 그 줄에서 그 자리까지 채움). 끊을 때는 앞 2자 이상·뒤 2자 이상 · 숫자/영문 중간 · 닫는 부호 앞은 피한다.
 *   순수 계산(문단 HTML → 문단 HTML) — 일렉트론·브라우저 없이 돈다(test/book-linebreak.test.js · 실조판 대조는 book-linebreak.smoke.js).
 */
const path = require('path');
const TF = require('./title-fit');

const PT_PER_MM = 72 / 25.4;
const RATIO = 1.8;                     // 띄어쓰기 늘어남 한도(평소의 몇 배) — 이 배수를 넘는 줄만 손댄다
const MODES = ['word', 'char', 'smart'];
const LABEL = { 어절: 'word', 글자: 'char', 절충: 'smart', word: 'word', char: 'char', smart: 'smart', auto: 'smart' };

/** 메타/설정 값 → 'word'|'char'|'smart'|'' (모르는 값은 '' — 호출 쪽이 다음 후보·기본으로) */
function modeOf(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return LABEL[s] || '';
}

const CLOSE_RE = /[.,!?;:)\]}”’」』》〉…·、。，！？）%]/;   // 줄 머리에 오면 안 되는 부호
const NUM_RE = /[0-9,.]/, LAT_RE = /[A-Za-z]/;
const isPunct = (c) => c === '' || CLOSE_RE.test(c) || /[“‘(\[{「『《〈"'\-—~]/.test(c);

// 문단 HTML → 단위(태그 | 글자). 각주(<span class="footnote">…</span>)는 쪽 아래로 뜨므로 폭 0, <sup>은 0.6배.
const UNIT_RE = /<[^>]+>|&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);|[\s\S]/gu;
function decodeEnt(s) {
  if (s[0] !== '&') return s;
  const m = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }[s];
  if (m) return m;
  const n = /^&#x([0-9a-f]+);$/i.exec(s) || /^&#(\d+);$/.exec(s);
  if (n) { try { return String.fromCodePoint(parseInt(n[1], /x/i.test(s) ? 16 : 10)); } catch (_) { /* fallthrough */ } }
  return '□';
}
function units(html) {
  const out = []; let skip = 0, sup = 0;
  for (const raw of String(html).match(UNIT_RE) || []) {
    if (raw[0] === '<' && raw.length > 1) {
      if (skip) { if (/^<span\b/i.test(raw)) skip++; else if (/^<\/span/i.test(raw)) skip--; }
      else if (/^<span\b[^>]*class="[^"]*\bfootnote\b/i.test(raw)) {
        skip = 1;
        // 각주 호출 번호(::footnote-call, 0.65em 위첨자)는 글줄 안에 폭을 차지한다 — 앞 글자에 붙는 폭만 있는 단위로 둔다
        const n = /data-n="(\d+)"/.exec(raw);
        if (n) out.push({ raw: '', ch: '', mark: n[1].length, tag: false, zero: false, scale: 1 });
      }
      else if (/^<sup\b/i.test(raw)) sup++;
      else if (/^<\/sup/i.test(raw)) sup = Math.max(0, sup - 1);
      out.push({ raw, tag: true });
      continue;
    }
    out.push({ raw, ch: decodeEnt(raw), tag: false, zero: skip > 0, scale: sup > 0 ? 0.6 : 1 });
  }
  return out;
}

/** 글꼴 모음(본문) — title-fit.analyze 와 같은 파일·같은 순서. 하나도 못 읽으면 null(호출 쪽이 어절로 되돌린다) */
function bodyFontsFor(fontKey, fontDir) {
  const f = (n) => TF.metricsOf(path.join(fontDir, n));
  const batang = f('KoPubWorld-Batang-Light.ttf'), noto = f('NotoSerifKR-Light.ttf'), hanja = f('HanjaSerif-Light.ttf');
  const nanum = f('NanumMyeongjo-Regular.ttf');
  const list = fontKey === 'nanum-myeongjo' ? [nanum, batang, noto, hanja] : [batang, noto, hanja];
  return (list[0] || list.find(Boolean)) ? list : null;
}

/**
 * 문단 HTML 한 개를 줄바꿈 방식에 맞게 고친다.
 * @param {string} html  <p> 안쪽 HTML(renderInline 결과)
 * @param {{mode:string, fonts:Array, sizePt:number, letterSpacingPt:number, widthPt:number, indentPt:number}} c
 * @returns {string}
 */
function fitParagraph(html, c) {
  if (!c || (c.mode !== 'smart' && c.mode !== 'char')) return html;
  const us = units(html);
  const vis = us.map((u, i) => i).filter((i) => !us[i].tag && !us[i].zero);
  if (vis.length < 3) return html;
  const ins = new Map();   // 단위 인덱스 앞에 넣을 문자열
  if (c.mode === 'smart') smartBreaks(us, vis, c, ins);
  tailGlue(us, vis, ins);
  let out = '';
  us.forEach((u, i) => { if (ins.has(i)) out += ins.get(i).join(''); out += u.raw; });
  if (ins.has(us.length)) out += ins.get(us.length).join('');
  return out;
}
const put = (ins, i, s) => { if (!ins.has(i)) ins.set(i, []); ins.get(i).push(s); };

/** 마지막 줄 고아 방지 — 끝 두 글자(+뒤 닫는 부호)를 한 덩어리로(nowrap). 태그가 엇갈리면 건너뛴다 */
function tailGlue(us, vis, ins) {
  // 뒤에서부터 부호가 아닌 글자 2개를 센다
  let n = 0, k = vis.length - 1;
  for (; k >= 0 && n < 2; k--) { if (!isPunct(us[vis[k]].ch) && !/\s/.test(us[vis[k]].ch)) n++; }
  if (n < 2) return;
  const startU = vis[k + 1];
  // 중간에 공백이 있으면(두 글자가 서로 다른 어절) 묶지 않는다 — 어절 사이에서 끊기는 건 정상
  for (let j = k + 1; j < vis.length; j++) if (/\s/.test(us[vis[j]].ch)) return;
  const endU = vis[vis.length - 1] + 1;
  // startU..endU 사이 태그가 서로 짝이 맞아야 한다
  const st = [];
  for (let j = startU; j < endU; j++) {
    const u = us[j]; if (!u.tag) continue;
    const m = /^<(\/?)([a-zA-Z0-9]+)/.exec(u.raw); if (!m) continue;
    if (/\/>$/.test(u.raw) || /^(br|wbr|img|hr)$/i.test(m[2])) continue;
    if (!m[1]) st.push(m[2].toLowerCase());
    else if (st.pop() !== m[2].toLowerCase()) return;
  }
  if (st.length) return;
  put(ins, startU, '<span class="nw">');
  put(ins, endU, '</span>');
}

function smartBreaks(us, vis, c, ins) {
  const W = c.widthPt;
  const adv = (i) => {
    const u = us[i]; if (u.zero) return 0;
    if (u.mark) return u.mark * (digitEm * 0.65 * c.sizePt + c.letterSpacingPt);
    const cp = u.ch.codePointAt(0); let a = null;
    for (const f of c.fonts) { if (!f) continue; a = f.adv(cp); if (a != null) break; }
    return ((a != null ? a : 1) * c.sizePt + c.letterSpacingPt) * u.scale;
  };
  const sp = adv0(' ', c);
  const digitEm = (adv0('5', c) - c.letterSpacingPt) / c.sizePt;
  // 어절 = 연속한 비공백 가시 글자
  const words = [];
  let cur = null;
  for (const i of vis) {
    if (/\s/.test(us[i].ch)) { cur = null; continue; }
    if (!cur) { cur = { idx: [], w: 0 }; words.push(cur); }
    cur.idx.push(i); cur.w += adv(i);
  }
  let lineW = W - (c.indentPt || 0), used = 0, nsp = 0, wi = 0, startK = 0;   // startK = 이 어절에서 이미 앞 줄로 보낸 글자 수
  while (wi < words.length) {
    const wd = words[wi];
    const rest = wd.idx.slice(startK);
    const ww = rest.reduce((s, i) => s + adv(i), 0);
    if (used === 0) {
      if (ww <= lineW) { used = ww; wi++; startK = 0; continue; }
      // 어절이 한 줄보다 길다 — 엔진이 글자 단위로 자른다(overflow-wrap). 채운 만큼 넘기고 다음 줄
      let w = 0, j = 0; while (j < rest.length && w + adv(rest[j]) <= lineW) { w += adv(rest[j]); j++; }
      startK += Math.max(1, j); lineW = W; used = 0; nsp = 0; continue;
    }
    if (used + sp + ww <= lineW) { used += sp + ww; nsp++; wi++; startK = 0; continue; }
    // 이 어절은 다음 줄로 — 현재 줄의 여유가 너무 크면 이 어절을 글자 단위로 쪼개 앞 줄을 채운다
    const slack = lineW - used;
    if (nsp >= 1 && startK === 0 && slack / nsp > sp * (RATIO - 1)) {
      // 1차: 앞 2자·뒤 2자 이상 / 없으면 2차: 앞 한 글자까지 허용(뒤는 항상 2자 이상 — 문단 끝 고아 방지)
      let k = pickBreak(rest, us, adv, lineW - used - sp, 2, 2);
      if (!k) k = pickBreak(rest, us, adv, lineW - used - sp, 1, 2);
      if (k > 0) {
        put(ins, rest[k], '<wbr>');
        startK = k; lineW = W; used = 0; nsp = 0; continue;   // 나머지는 다음 줄 맨 앞
      }
    }
    lineW = W; used = 0; nsp = 0;   // 줄바꿈(어절은 그대로 다음 줄에서 다시 시도)
  }
}
function adv0(ch, c) {
  const cp = ch.codePointAt(0); let a = null;
  for (const f of c.fonts) { if (!f) continue; a = f.adv(cp); if (a != null) break; }
  return (a != null ? a : 0.3) * c.sizePt + c.letterSpacingPt;
}

/** 어절(rest: 단위 인덱스 배열)을 앞에서 몇 글자까지 `room`(pt) 안에 넣을 수 있나 — 끊을 수 있는 가장 큰 k(앞 ≥2자 · 뒤 ≥2자). 없으면 0 */
function pickBreak(rest, us, adv, room, minFront, minBack) {
  let w = 0, best = 0;
  const real = (i) => !isPunct(us[i].ch);
  for (let k = 1; k < rest.length; k++) {
    w += adv(rest[k - 1]);
    if (w > room) break;
    const a = us[rest[k - 1]].ch, b = us[rest[k]].ch;
    if (CLOSE_RE.test(b) || b === '') continue;                      // 닫는 부호·각주 번호는 앞 글자에 붙는다
    if (a === '' || /[“‘(\[{「『《〈]/.test(a)) continue;                       // 여는 부호 뒤에서 끊지 않는다
    if (NUM_RE.test(a) && NUM_RE.test(b)) continue;                  // 숫자 한가운데
    if (LAT_RE.test(a) && LAT_RE.test(b)) continue;                  // 영문 한가운데
    const front = rest.slice(0, k).filter(real).length;
    const back = rest.slice(k).filter(real).length;
    if (front >= minFront && back >= minBack) best = k;
  }
  return best;
}

/**
 * 줄바꿈 설정 해석 — html-builder 의 o 에서 한 번 만든다. 어절이면 null(아무것도 안 함).
 * @param {object} o  resolveBookOptions 의 o
 * @param {string} fontDir assets/fonts/book
 */
function contextFor(o, fontDir) {
  if (!o || (o.lineBreak !== 'smart' && o.lineBreak !== 'char')) return null;
  const fonts = bodyFontsFor(o.fontKey, fontDir);
  if (o.lineBreak === 'smart' && !fonts) return null;   // 글꼴 폭을 못 재면 조용히 어절로
  const m = o.marginsMm;
  return {
    mode: o.lineBreak, fonts: fonts || [],
    sizePt: o.fontSizePt, letterSpacingPt: o.letterSpacingPt || 0,
    widthPt: (o.trimW - m.inner - m.outer) * PT_PER_MM,
    indentPt: o.indentPt || 0,
  };
}

module.exports = { MODES, RATIO, modeOf, fitParagraph, contextFor, bodyFontsFor, units };
