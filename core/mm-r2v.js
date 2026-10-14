'use strict';
/**
 * core/mm-r2v.js — 🎬 MiniMax H3 **공식 R2V(Ref2VA) 꼴** 대본 프롬프트 → 엔진 입력 (2026-10-12, v0.8.12)
 *
 * 채널사업부 계약(요청서_프라이밍_H3_R2V_20261012 · 로이 「R2V 를 쓴다 · 가이드는 MiniMax H3 공식을 따른다」):
 *   ① 🎬 본문이 `subject_definitions:` 로 **시작**하면 새 꼴 — 엔진은 `<Picture 1>` 접두사(MM_REF_PREFIX)를 붙이지 않는다.
 *      그 밖(옛 꼴 · 렌더 전 재고 수백 편)은 예전 그대로.
 *   ② 여섯 절(공식 순서·이름)을 대본은 한 줄에 쓴다 → 여기서 공식 요청 예시 꼴(`<절>:\n본문\n\n<다음 절>:`)로 편다.
 *   ③ `<Picture 1>` = 그 장면의 🖼️ 그림(첫 프레임 · ref_image_0). 대본은 `<Picture 2>` 이상을 쓰지 않는다.
 *   ④ `<Subject N> [카드이름]` → 인물 카드의 시트를 찾아 `<Picture k+1>`(ref_image_k)로 붙이고, 그 Subject 정의 문장 끝에
 *      「Its face and build follow the reference sheet <Picture k+1>.」를 덧붙인다. `[이름]` 토막은 성공·실패와 무관하게 지운다.
 *   ⑤ 시트가 하나도 안 붙으면 summary 머리 `[keyframe completion + reference generation]` → `[keyframe completion]`.
 * 순수 함수(파일 찾기는 findSheet 콜백) — 엔진·main 이 같은 규칙을 쓴다.
 */

const SECTIONS = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music'];
// 공식 README 의 Ref2VA 한도 = 이미지 ≤ 9장 · 노드(ComfyUI MiniMaxH3ReferenceToVideo)도 ref_image_0~8(max=9). 장면 그림 1 + 시트 ≤ 8.
const MAX_IMAGES = 9;

/** 새 꼴인가 — 🎬 본문이 `subject_definitions:` 로 시작 */
function isR2V(prompt) { return /^\s*subject_definitions\s*[:：]/i.test(String(prompt || '')); }

/** 한 줄 여섯 절 → 공식 꼴(절 이름 뒤 줄바꿈 · 절 사이 빈 줄). 순서대로 찾는다(본문에 같은 낱말이 있어도 앞 절 뒤에서만). */
function expandSections(prompt) {
  const s = String(prompt || '').trim();
  const pos = [];
  let from = 0;
  for (const name of SECTIONS) {
    const re = new RegExp('(^|\\s)' + name + '\\s*[:：]\\s*', 'ig');
    re.lastIndex = from;
    const m = re.exec(s);
    if (!m) { pos.push(null); continue; }
    const at = m.index + m[1].length;
    pos.push({ name, at, body: at + m[0].length - m[1].length });
    from = at + m[0].length - m[1].length;
  }
  const found = pos.filter(Boolean);
  const missing = SECTIONS.filter((_, i) => !pos[i]);
  if (!found.length) return { text: s, missing };
  const parts = found.map((p, i) => {
    const end = i + 1 < found.length ? found[i + 1].at : s.length;
    return `${p.name}:\n${s.slice(p.body, end).trim()}`;
  });
  const head = s.slice(0, found[0].at).trim();
  return { text: (head ? head + '\n\n' : '') + parts.join('\n\n'), missing };
}

/**
 * 새 꼴 프롬프트 → { prompt, refImages, attached:[{name, picture, path}], missing:[이름], sectionsMissing:[절] }
 * @param {string} prompt 대본 🎬 본문(새 꼴)
 * @param {{cards?:object[], findSheet?:(card)=>string|null}} o  cards = char-refs.parseCards 결과
 */
function buildR2V(prompt, { cards = [], findSheet = () => null } = {}) {
  let s = String(prompt || '').trim();
  const byName = new Map();
  for (const c of (cards || [])) { if (c && c.name) byName.set(String(c.name).trim(), c); }
  // `<Subject N> [이름]` — 같은 Subject 가 여러 번 나와도 시트는 하나. 이름은 카드 이름과 **정확히** 같아야 한다(유사도 매칭 금지).
  const TAG = /<Subject\s*(\d+)>\s*\[([^\]\n]{1,30})\]/g;
  const want = [];   // [{n, name}] 처음 나온 순서
  for (const m of s.matchAll(TAG)) { if (!want.some((w) => w.n === m[1])) want.push({ n: m[1], name: m[2].trim() }); }
  s = s.replace(TAG, (_, n) => `<Subject ${n}>`);   // `[이름]` 토막은 늘 지운다
  const attached = [], missing = [];
  const usedPath = new Map();   // 같은 시트(같은 인물을 두 Subject 로 쓴 경우)는 한 장만
  for (const w of want) {
    const card = byName.get(w.name);
    const p = card ? findSheet(card) : null;
    if (!p) { missing.push(w.name); continue; }
    let picture = usedPath.get(p);
    if (!picture) {
      if (attached.length + 1 >= MAX_IMAGES) { missing.push(w.name); continue; }
      picture = attached.length + 2;   // <Picture 1> = 장면 그림
      usedPath.set(p, picture);
      attached.push({ name: w.name, picture, path: p });
    }
    s = appendToSubjectDef(s, w.n, `Its face and build follow the reference sheet <Picture ${picture}>.`);
  }
  if (!attached.length) s = s.replace(/\[\s*keyframe completion\s*\+\s*reference generation\s*\]/i, '[keyframe completion]');
  const ex = expandSections(s);
  return { prompt: ex.text, refImages: attached.map((a) => a.path), attached, missing, sectionsMissing: ex.missing };
}

/** subject_definitions 절 안에서 `<Subject N>` 정의 문장(처음 나온 곳부터 첫 마침표까지) 끝에 문장을 덧붙인다 */
function appendToSubjectDef(s, n, sentence) {
  const defStart = s.search(/subject_definitions\s*[:：]/i);
  const defEnd = (() => { const m = /\ssummary\s*[:：]/i.exec(s.slice(Math.max(0, defStart))); return m ? Math.max(0, defStart) + m.index : s.length; })();
  const re = new RegExp('<Subject\\s*' + n + '>', 'g');
  re.lastIndex = Math.max(0, defStart);
  const m = re.exec(s);
  if (!m || m.index >= defEnd) return s;
  const rest = s.slice(m.index, defEnd);
  const dot = /\.(?=\s|$)/.exec(rest);
  const at = dot ? m.index + dot.index + 1 : defEnd;
  return s.slice(0, at) + ' ' + sentence + s.slice(at);
}

/** 🎬 가 부르는 인물 이름들(`<Subject N> [이름]` · 처음 나온 순서 · 중복 없음) — 영상 단계가 시트를 미리 만들 때 쓴다(v0.9.19) */
function subjectNames(prompt) {
  const out = [];
  if (!isR2V(prompt)) return out;
  for (const m of String(prompt).matchAll(/<Subject\s*(\d+)>\s*\[([^\]\n]{1,30})\]/g)) { const n = m[2].trim(); if (n && !out.includes(n)) out.push(n); }
  return out;
}

/** 옛 엔진(LTX 등 비 MiniMax)에 새 꼴이 들어갈 때 — `[이름]` 토막만 지운다(라벨 뜻은 흐려지지만 돈다) */
function stripNames(prompt) { return String(prompt || '').replace(/<Subject\s*(\d+)>\s*\[([^\]\n]{1,30})\]/g, (_, n) => `<Subject ${n}>`); }

module.exports = { SECTIONS, MAX_IMAGES, isR2V, expandSections, buildR2V, appendToSubjectDef, stripNames, subjectNames };
