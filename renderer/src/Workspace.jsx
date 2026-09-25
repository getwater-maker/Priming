/**
 * Workspace.jsx — Vrew 식 작업 화면(2026-09-25 v0.5.42, 로이: 「Vrew 화면구조처럼」).
 *
 *   메뉴 줄 + 리본 · 가로 3칸 = ① 영상·이미지 미리보기 ② 자막(클립) 목록 ③ 자세한 설정(필요할 때만).
 *   ② 의 커서(자막 줄)가 움직이면 ① 이 그 줄의 그림/영상과 **그 줄 자막**으로 바뀐다.
 *
 * 여기에는 **상태가 없는 도우미**만 둔다(화면 상태는 App.jsx 가 가진다):
 *   · buildProjLines — 편의 자막 줄 목록(번호·그룹·문장·글자 범위). ①·②·키보드가 **같은 번호**를 쓴다(두 벌 금지).
 *   · stageCapGeom   — 미리보기 자막 크기·위치 = **유튜브 MP4 와 같은 공식**(core/vrew-render captionAssStyle).
 */
import { splitLines, mLen } from './lib/captions.js';
import CF from '../../core/caption-format.js';

// 메뉴(리본) — [id, 라벨]. 라벨은 Vrew 메뉴처럼 짧게.
export const MENUS = [
  ['script', '대본·음성'],
  ['image', '이미지'],
  ['video', '비디오'],
  ['finish', '완성'],
  ['format', '서식'],
];

// localStorage — 사생활 창·차단 환경에서 던질 수 있어 늘 감싼다(없어도 화면은 정상).
export function lsGet(k, d) { try { const v = window.localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } }
export function lsSet(k, v) { try { window.localStorage.setItem(k, String(v)); } catch (_) {} }

/**
 * 편의 자막 줄 — Cards 가 화면에 매기는 번호와 **같은 규칙**(문장마다 splitLines → 편 전체로 이어지는 번호).
 * @returns {{ list: Array<{n, groupNum, sentIdx, from, to, t, ci}>, bySent: Map<string, Array> }}
 */
export function buildProjLines(pr, capChars) {
  const list = [];
  const bySent = new Map();
  let n = 0;
  let t0 = 0;   // 🕒 편 시작부터의 누적 시각(초) — 문장 음성 길이의 합. 줄은 문장 안에서 **글자수 비례**(.vrew 빌더·미리보기 재생과 같은 규칙)
  (pr && pr.cuts ? pr.cuts : []).forEach((c, ci) => {
    (c.sentences || []).forEach((s, si) => {
      const lt = splitLines(s.text, capChars, s.breaks);
      const rg = CF.lineRanges(s.text || '', lt);
      const dur = Number(s.dur) > 0 ? Number(s.dur) : 0;
      const tot = lt.reduce((a, t) => a + Math.max(1, mLen(t)), 0) || 1;
      let acc = 0;
      const lines = lt.map((t, li) => {
        const w = Math.max(1, mLen(t));
        const o = { n: ++n, t, range: rg[li], groupNum: c.num, sentIdx: si, from: rg[li].from, to: rg[li].to, ci,
          start: dur ? t0 + dur * acc / tot : null, dur: dur ? dur * w / tot : null, speaker: s.speaker || null };
        acc += w;
        return o;
      });
      t0 += dur;
      bySent.set(c.num + ':' + si, lines);
      for (const l of lines) list.push(l);
    });
  });
  return { list, bySent };
}

// ── 미리보기 자막 배치 — core/vrew-render.js 의 captionAssStyle 과 같은 수치(1920×1080 기준) ──
const SIZE_K = 0.72;          // Vrew size → 픽셀
const BOX_PAD_X = 24.6;       // 텍스트박스 안쪽 가로 여백
const CAP_BOTTOM_BASE = 105.5; // yOffset 0 일 때의 아래(위) 여백
const HALF_H = 540;

/**
 * @param pos   { align, yAlign, yOffset, xOffset } (core/caption-format linePos 결과)
 * @param size  Vrew 글자 크기
 * @param stageW 미리보기 폭(px)
 * @returns CSS 값 묶음 + s(미리보기 px / 1080 화면 px — 테두리·그림자 환산에 쓴다)
 */
export function stageCapGeom(pos, size, stageW) {
  const s = stageW > 0 ? stageW / 1920 : 0.28;
  const x = Number(pos && pos.xOffset) || 0;
  const y = Number(pos && pos.yOffset) || 0;
  const boxLeft = (1 - 0.96) / 2 * 1920 + x * 960;
  const mL = boxLeft + BOX_PAD_X;
  const mR = 1920 - (boxLeft + 0.96 * 1920) + BOX_PAD_X;
  const align = pos && pos.align === 'end' ? 'right' : pos && pos.align === 'center' ? 'center' : 'left';
  const out = { s, left: mL * s, right: mR * s, textAlign: align, fontSize: (Number(size) || 100) * SIZE_K * s };
  const va = pos && pos.yAlign;
  if (va === 'top') { out.top = (CAP_BOTTOM_BASE + y * HALF_H) * s; out.bottom = null; out.transform = 'none'; }
  else if (va === 'middle') { out.top = (HALF_H + y * HALF_H) * s; out.bottom = null; out.transform = 'translateY(-50%)'; }
  else { out.bottom = (CAP_BOTTOM_BASE + (-y) * HALF_H) * s; out.top = null; out.transform = 'none'; }
  return out;
}

/** 위 결과를 #stageCap 에 입힌다. */
export function applyStageGeom(el, g) {
  if (!el || !g) return;
  el.style.left = g.left + 'px'; el.style.right = g.right + 'px';
  el.style.padding = '0';
  el.style.textAlign = g.textAlign;
  el.style.fontSize = g.fontSize + 'px';
  el.style.top = g.top == null ? 'auto' : g.top + 'px';
  el.style.bottom = g.bottom == null ? 'auto' : g.bottom + 'px';
  el.style.transform = g.transform;
}

/** 🕒 클립 시각 표시 — Vrew 처럼 「00:11 + 1.70초」(시작 mm:ss · 길이 소수 둘째). 음성이 없으면 빈 문자열. */
export function fmtClipTime(start, dur) {
  if (start == null || !(dur > 0)) return '';
  const s = Math.floor(start);
  const mm = Math.floor(s / 60), ss = s % 60;
  const hh = Math.floor(mm / 60);
  const head = hh ? `${hh}:${String(mm % 60).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${head} + ${dur.toFixed(2)}초`;
}

/** 🧩 어절 칩 — 줄 글자를 공백으로 나눠 문장 안 글자 위치(from·to)를 붙인다. 누르면 그 단어만 서식 선택. */
export function lineWords(text, range) {
  const t = String(text || '');
  const out = [];
  const re = /\S+/g;
  const seg = t.slice(range.from, range.to);
  let m;
  while ((m = re.exec(seg))) out.push({ w: m[0], from: range.from + m.index, to: range.from + m.index + m[0].length });
  return out;
}
