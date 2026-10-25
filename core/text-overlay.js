'use strict';
/**
 * text-overlay.js — 🅣 글 삽입(Lab · Vrew 「텍스트 삽입 · 기본 텍스트 · 디자인 텍스트」) 순수 규칙.
 *   글은 **투명 배경 1920×1080 PNG 한 장**으로 그려(렌더러 canvas) 기존 「삽입」(그림 위층 · overlay-op add)에 그대로 넣는다 —
 *   .vrew 빌더·MP4·미리보기·범위·되돌리기를 새로 만들지 않는다(글 전용 트랙 ⛔ — 그림 위층 규칙 한 벌).
 *   렌더러 번들에 들어간다 — require 없음.
 */
const W = 1920, H = 1080;
const PRESETS = {
  basic: { id: 'basic', label: '기본 텍스트', color: '#ffffff', size: 72, bold: false, box: '', shadow: true, pos: 'bottom' },
  design: { id: 'design', label: '디자인 텍스트', color: '#ffd770', size: 96, bold: true, box: 'rgba(20,20,20,0.78)', shadow: false, pos: 'center' },
};
const POS = [{ id: 'top', label: '위' }, { id: 'center', label: '가운데' }, { id: 'bottom', label: '아래' }];
const SIZE = { min: 24, max: 200, step: 4 };
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** 입력 정리 — 모르는 값은 기본으로 */
function norm(o, presetId = 'basic') {
  const p = PRESETS[presetId] || PRESETS.basic; o = o || {};
  const size = Math.max(SIZE.min, Math.min(SIZE.max, Math.round(Number(o.size) || p.size)));
  return {
    text: String(o.text == null ? '' : o.text).replace(/\r/g, '').slice(0, 400),
    size, color: COLOR_RE.test(o.color || '') ? o.color.toLowerCase() : p.color,
    bold: o.bold == null ? p.bold : !!o.bold,
    box: o.box == null ? p.box : (/^rgba?\(/.test(o.box) || COLOR_RE.test(o.box) ? o.box : ''),
    shadow: o.shadow == null ? p.shadow : !!o.shadow,
    pos: POS.some((x) => x.id === o.pos) ? o.pos : p.pos,
  };
}
/** 줄 나누기 — 글자 수가 아니라 **그려진 폭**으로(measure = (줄) => px) · 입력의 줄바꿈은 그대로 지킨다 */
function wrapLines(text, maxW, measure) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!para.length) { out.push(''); continue; }
    let cur = '';
    for (const ch of Array.from(para)) {
      if (cur && measure(cur + ch) > maxW) { out.push(cur); cur = ch.trim() ? ch : ''; } else cur += ch;
    }
    out.push(cur);
  }
  return out;
}
/** 그리기 계획 — 캔버스 위 줄 좌표(가운데 정렬) · 상자 · 실제로 칠할 글이 없으면 null */
function layout(o, measure) {
  if (!String(o.text).trim()) return null;
  const maxW = Math.round(W * 0.84), lh = Math.round(o.size * 1.3);
  const lines = wrapLines(o.text, maxW, measure);
  const widest = Math.max(...lines.map((l) => measure(l)), 1);
  const pad = Math.round(o.size * 0.4);
  const bh = lines.length * lh + pad * 2, bw = Math.min(W - 40, Math.round(widest + pad * 2));
  const y0 = o.pos === 'top' ? Math.round(H * 0.08) : o.pos === 'center' ? Math.round((H - bh) / 2) : Math.round(H * 0.92 - bh);
  const x0 = Math.round((W - bw) / 2);
  return { lines, lh, pad, box: { x: x0, y: y0, w: bw, h: bh }, textX: Math.round(W / 2), textY0: y0 + pad + Math.round(lh / 2) };
}
const fileNameOf = (text) => ('텍스트_' + String(text).replace(/\s+/g, ' ').trim().slice(0, 12).replace(/[\\/:*?"<>|]/g, '')).replace(/_$/, '') || '텍스트';

module.exports = { W, H, PRESETS, POS, SIZE, norm, wrapLines, layout, fileNameOf };
