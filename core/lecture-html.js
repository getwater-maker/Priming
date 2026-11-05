'use strict';
/**
 * core/lecture-html.js — 🎓 강의 화면표(TSV) → HTML 한 장(HyperFrames 구성) · 순수 함수(파일·프로세스 없음)
 *   (v1.0.34 · 2.0 덧붙임4 ㊿ · 관리자·개발 PC 전용 · core/edition FEATURES.lecture)
 *
 * 화면표 한 줄 = 화면 한 장:  `파일명[+파일명…]<탭>틀<탭>내용`
 *   - 파일명 = 리모션 음성 TSV 의 파일명(그 mp3 들의 길이가 그 화면의 길이) · `+` 로 여러 낭독을 한 화면에
 *   - 틀 = 제목 · 글머리 · 도식 · 코드 · 인용(TEMPLATES 한 곳)
 *   - 내용 = 칸을 ` | ` 로 나눈다 · 코드 줄바꿈은 글자 그대로 `\n`
 *   - `#` 주석 · 빈 줄 · 첫 줄 머리(`파일명<탭>틀…`)는 건너뛴다
 *
 * 🔴 애니메이션은 CSS @keyframes 만 쓴다 — ⛔ GSAP 금지(Webflow 무료 라이선스 · 회신 4 ㊻).
 *   HyperFrames 실행기는 document.getAnimations() 로 CSS 애니메이션을 프레임마다 맞춰 굽는다(2026-11-05 실측 —
 *   0.4·1.5·2.6초 위치가 계산값과 같음). 시각은 모두 「영상 처음부터 초」(animation-delay 절대값)로 박는다.
 * 🔴 글자는 escape 한 뒤에만 HTML 에 넣는다(화면표는 사람이 쓴 글이다).
 */

const W = 1920, H = 1080;
const TEMPLATES = ['제목', '글머리', '도식', '코드', '인용'];
const TPL_ALIAS = { title: '제목', bullets: '글머리', bullet: '글머리', diagram: '도식', code: '코드', quote: '인용' };
const PAD_SEC = 0.6;        // 화면마다 낭독 뒤 숨 쉬는 틈(초)
const FADE = 0.35;          // 화면이 들어올 때 페이드(초)

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const r3 = (x) => Math.round(x * 1000) / 1000;

/** 화면표 읽기 → { slides: [{line, files[], tpl, cells[]}], errors: [{line, message}] } */
function parseScreenTsv(text) {
  const slides = [], errors = [];
  const lines = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim() || raw.trim().startsWith('#')) return;
    const cols = raw.split('\t');
    if (slides.length === 0 && errors.length === 0 && /^파일명$/.test(cols[0].trim()) && /^틀$/.test(String(cols[1] || '').trim())) return;
    if (cols.length < 3) { errors.push({ line, message: '칸이 셋이어야 합니다(파일명<탭>틀<탭>내용)' }); return; }
    const files = cols[0].split('+').map((s) => s.trim()).filter(Boolean);
    let tpl = cols[1].trim();
    tpl = TPL_ALIAS[tpl.toLowerCase()] || tpl;
    const content = cols.slice(2).join('\t').trim();
    if (!files.length) { errors.push({ line, message: '파일명이 비었습니다' }); return; }
    const bad = files.find((f) => /[\\/:*?"<>|]/.test(f));
    if (bad) { errors.push({ line, message: '파일명에 쓸 수 없는 글자 — ' + bad }); return; }
    if (!TEMPLATES.includes(tpl)) { errors.push({ line, message: '모르는 틀 「' + tpl + '」 — ' + TEMPLATES.join(' · ') + ' 중 하나' }); return; }
    const cells = content.split(/\s*\|\s*/).map((s) => s.trim());
    if (!cells[0]) { errors.push({ line, message: '내용이 비었습니다' }); return; }
    if (tpl === '도식' && diagramNodes(cells).length < 2) { errors.push({ line, message: '도식은 상자가 둘 이상이어야 합니다(제목 | 가 → 나 → 다)' }); return; }
    slides.push({ line, files, tpl, cells, raw: content });
  });
  return { slides, errors };
}

function diagramNodes(cells) {
  const rest = cells.slice(1).filter(Boolean);
  if (rest.length === 1 && /→|->/.test(rest[0])) return rest[0].split(/\s*(?:→|->)\s*/).filter(Boolean);
  return rest;
}

/**
 * 시간표 — 화면 길이 = 그 화면 낭독 길이 합 + PAD · steps = 화면 안 낭독마다 시작 시각(절대 초)
 * @param slides parseScreenTsv 의 slides
 * @param durOf (파일명) → 초
 */
function planTimeline(slides, durOf, opts = {}) {
  const pad = opts.pad != null ? Number(opts.pad) : PAD_SEC;
  let t = 0;
  const out = slides.map((s, idx) => {
    const start = t, steps = [];
    let a = start;
    for (const f of s.files) { steps.push(r3(a)); a += Number(durOf(f)) || 0; }
    const speech = a - start;
    const dur = r3(speech + pad);
    t = r3(start + dur);
    return { ...s, idx, start: r3(start), dur, speech: r3(speech), steps };
  });
  return { slides: out, total: r3(t) };
}

/** 화면 안 i 번째 조각(n 개)이 나타날 시각 — 낭독 수와 같으면 그 낭독 시작, 아니면 말하는 동안 고르게 */
function revealAt(sl, i, n) {
  if (sl.steps.length === n) return sl.steps[i] + (i === 0 ? 0.25 : 0);
  const span = Math.max(0.5, sl.speech * 0.75);
  return r3(sl.start + 0.25 + (n <= 1 ? 0 : span * i / n));
}

const anim = (name, dur, at, ease = 'ease-out') => `animation:${name} ${dur}s ${ease} ${r3(at)}s both`;

function slideBody(sl) {
  const c = sl.cells, s0 = sl.start;
  switch (sl.tpl) {
    case '제목': {
      const sub = c[1] ? `<div class="sub" style="${anim('rise', 0.6, s0 + 0.7)}">${esc(c[1])}</div>` : '';
      return `<div class="t-title"><div class="bar" style="${anim('grow', 0.7, s0 + 0.15)}"></div>`
        + `<h1 style="${anim('rise', 0.7, s0 + 0.25)}">${esc(c[0])}</h1>${sub}</div>`;
    }
    case '글머리': {
      const items = c.slice(1).filter(Boolean);
      return `<div class="t-bul"><h2 style="${anim('rise', 0.5, s0 + 0.1)}">${esc(c[0])}</h2><ul>`
        + items.map((it, i) => `<li style="${anim('slidein', 0.5, revealAt(sl, i, items.length))}"><span class="dot"></span>${esc(it)}</li>`).join('')
        + '</ul></div>';
    }
    case '도식': {
      const nodes = diagramNodes(c), n = nodes.length;
      const parts = [];
      nodes.forEach((nd, i) => {
        const at = revealAt(sl, i, n);
        if (i > 0) parts.push(`<div class="arr" style="${anim('grow', 0.35, at - 0.2)}"></div>`);
        parts.push(`<div class="node" style="${anim('pop', 0.45, at)}">${esc(nd)}</div>`);
      });
      return `<div class="t-dia"><h2 style="${anim('rise', 0.5, s0 + 0.1)}">${esc(c[0])}</h2><div class="row n${Math.min(n, 6)}">${parts.join('')}</div></div>`;
    }
    case '코드': {
      // 코드 안의 | (||·파이프)는 칸 나누기가 아니다 — 첫 | 뒤 원문 그대로
      const raw = String(sl.raw || ''), k = raw.indexOf('|');
      const code = (k >= 0 ? raw.slice(k + 1).replace(/^ /, '') : '').split(/\\n/);
      const lines = code.map((ln, i) => `<div class="ln" style="${anim('typein', 0.3, revealAt(sl, i, code.length))}"><span class="no">${i + 1}</span>${esc(ln) || '&nbsp;'}</div>`).join('');
      return `<div class="t-code"><h2 style="${anim('rise', 0.5, s0 + 0.1)}">${esc(c[0])}</h2><div class="box">${lines}</div></div>`;
    }
    case '인용': {
      const chars = [...c[0]];
      const span = Math.min(chars.length * 0.05, Math.max(0.6, sl.speech * 0.6));
      const per = chars.length > 1 ? span / (chars.length - 1) : 0;
      const q = chars.map((ch, i) => `<span style="${anim('fade', 0.15, s0 + 0.4 + per * i, 'linear')}">${ch === ' ' ? ' ' : esc(ch)}</span>`).join('');
      const who = c[1] ? `<div class="who" style="${anim('fade', 0.5, s0 + 0.5 + span)}">— ${esc(c[1])}</div>` : '';
      return `<div class="t-quote"><div class="mark" style="${anim('fade', 0.4, s0 + 0.1)}">“</div><div class="q">${q}</div>${who}</div>`;
    }
    default: return '';
  }
}

const CSS = `@font-face{font-family:Pre;src:url(Pretendard-Bold.ttf)}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#14161c}
#root{position:relative;width:100%;height:100%;font-family:Pre,'Malgun Gothic',sans-serif;color:#f2f2f0}
.slide{position:absolute;inset:0;background:radial-gradient(ellipse at 30% 20%,#232734 0%,#14161c 70%)}
h2{position:absolute;left:150px;top:110px;font-size:68px;letter-spacing:-1px}
.t-title{position:absolute;left:180px;top:360px;right:180px}
.t-title .bar{width:160px;height:10px;background:#f2b84b;border-radius:5px;transform-origin:left center;margin-bottom:40px}
.t-title h1{font-size:110px;line-height:1.15;letter-spacing:-2px}
.t-title .sub{margin-top:34px;font-size:50px;color:#b9bdc9}
.t-bul ul{position:absolute;left:170px;top:270px;right:150px;list-style:none}
.t-bul li{font-size:54px;line-height:1.35;margin-bottom:34px;display:flex;align-items:flex-start;gap:30px}
.t-bul .dot{flex:none;width:22px;height:22px;margin-top:24px;border-radius:50%;background:#f2b84b}
.t-dia .row{position:absolute;left:120px;right:120px;top:380px;height:320px;display:flex;align-items:center;justify-content:center;gap:0}
.t-dia .node{flex:1 1 0;min-width:0;max-width:440px;padding:46px 28px;border:4px solid #f2b84b;border-radius:26px;background:#1e222d;font-size:46px;line-height:1.25;text-align:center;word-break:keep-all}
.t-dia .n5 .node,.t-dia .n6 .node{font-size:36px;padding:36px 16px}
.t-dia .arr{flex:none;width:90px;height:8px;background:#f2b84b;transform-origin:left center;position:relative;margin:0 14px}
.t-dia .arr::after{content:'';position:absolute;right:-16px;top:-12px;border-left:24px solid #f2b84b;border-top:16px solid transparent;border-bottom:16px solid transparent}
.t-code .box{position:absolute;left:150px;right:150px;top:250px;bottom:110px;background:#0c0e13;border:2px solid #2c3140;border-radius:22px;padding:44px 50px;font-family:Consolas,'D2Coding',monospace,Pre;font-size:42px;line-height:1.5;white-space:pre;overflow:hidden;color:#d7e3f4}
.t-code .no{display:inline-block;width:70px;color:#59607a}
.t-quote{position:absolute;left:220px;right:220px;top:300px}
.t-quote .mark{font-size:220px;line-height:1;color:#f2b84b;height:120px}
.t-quote .q{font-size:72px;line-height:1.4;letter-spacing:-1px;word-break:keep-all}
.t-quote .who{margin-top:44px;font-size:44px;color:#b9bdc9}
@keyframes rise{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:none}}
@keyframes slidein{from{opacity:0;transform:translateX(-50px)}to{opacity:1;transform:none}}
@keyframes pop{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:none}}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes hide{to{visibility:hidden}}
@keyframes typein{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}`;

/**
 * 시간표 → HyperFrames 구성 HTML(index.html 한 장) · 화면마다 절대 시각 CSS 애니메이션으로 보이고 숨는다.
 * data-no-timeline = GSAP 시간표를 기다리지 않는다(없으면 45초 기다림 · 실측).
 * 🔴 HyperFrames clip(class="clip" data-start)을 쓰지 않는다 — clip 이 나타난 순간부터 CSS 지연을 다시 세어
 *   두 번째 화면부터 늦게 나오거나 비었다(v1.0.34 실측).
 */
function buildHtml(plan) {
  const last = plan.slides.length - 1;
  const slides = plan.slides.map((sl) => {
    const show = anim('fade', FADE, sl.start, 'linear');
    const hide = sl.idx === last ? '' : `,hide 0.001s step-end ${r3(sl.start + sl.dur)}s forwards`;
    return `<div class="slide" id="s${sl.idx}" style="${show}${hide}">${slideBody(sl)}</div>`;
  }).join('\n');
  return `<!doctype html>
<html lang="ko"><head><meta charset="UTF-8" /><meta name="viewport" content="width=${W}, height=${H}" />
<style>
${CSS}
</style></head><body>
<div id="root" data-composition-id="main" data-no-timeline data-start="0" data-duration="${plan.total}" data-width="${W}" data-height="${H}">
${slides}
</div></body></html>
`;
}

module.exports = { W, H, TEMPLATES, PAD_SEC, parseScreenTsv, planTimeline, buildHtml, revealAt, diagramNodes, esc };
