'use strict';
/**
 * scene-directives.js — 🎞 장면 지시 줄(2.0 덧붙임4 ㊷ · v1.0.31) — 제작본 장면(`###`) 아래 인용 줄로 그 장면의 화면을 정한다.
 *     > 🎞 움직임: 줌인          (그 장면 그림의 움직임 — 이름은 MOTION_WORDS)
 *     > 🎞 판: 따로              (㊸ 인물판 · 배경판을 따로 — 다음 묶음에서 그린다 · 지금은 읽고 세기만)
 *     > 💬 대사카드: 말한 사람 | 대사   (㊹ — core/screen-cards 가 읽는다)
 *   🔒 줄이 없으면 아무것도 바꾸지 않는다(test:nodirective). 장면 → 그룹은 **그 장면 첫 낭독 문장**이 든 그룹(도입부처럼 여러 `###` 이 한 그룹이면 앞 장면이 이긴다 + 경고).
 *   🔑 「같은 움직임 연달아 금지」(덧붙임2 ⑱ 의 한 줄 · 덧붙임4 ㊷ ②) — 지정 움직임이 바로 앞 그룹의 움직임과 같으면 반대 방향으로 바꾸고 기록한다(motionChanged).
 *     ⑱ 의 속도 상한 · 샷 나누기는 아직 없다 — 지금은 「한 그림 = 한 움직임」.
 *   순수(fs 없음 · sentence-splitter 만) — 파서(longform-parser)와 작업본 이어받기(main projectsFromSnapshot)가 같은 apply 를 부른다.
 */
const HEAD_RE = /^(#{1,6})\s+(.+?)\s*$/;
const DIR_RE = /^[ \t]*>[ \t]*🎞[ \t]*([^:：]+?)[ \t]*[:：][ \t]*(.*?)[ \t]*$/u;
// 움직임 이름 → core/ken-burns 의 look.motion 값(① 칸 「움직임」 메뉴와 같은 여섯 + 없음)
const MOTION_WORDS = {
  in: ['줌인', '다가가기', '천천히다가가기', '밀어들어가기', 'zoomin', 'in'],
  out: ['줌아웃', '멀어지기', '천천히멀어지기', 'zoomout', 'out'],
  lr: ['좌→우팬', '좌→우', '왼쪽→오른쪽', '좌우팬', 'lr'],
  rl: ['우→좌팬', '우→좌', '오른쪽→왼쪽', '우좌팬', 'rl'],
  bt: ['하→상팬', '하→상', '아래→위', 'bt'],
  tb: ['상→하팬', '상→하', '위→아래', 'tb'],
  none: ['없음', '멈춤', '정지', 'none'],
};
const MOTION_LABEL = { in: '줌인', out: '줌아웃', lr: '좌→우 팬', rl: '우→좌 팬', bt: '하→상 팬', tb: '상→하 팬', none: '없음' };
const OPPOSITE = { in: 'out', out: 'in', lr: 'rl', rl: 'lr', bt: 'tb', tb: 'bt' };
const PATTERN_OF = { in: 0, out: 1, lr: 2, rl: 3, bt: 4, tb: 5 };
const LAYER_WORDS = { '따로': true, '나눔': true, '층': true, '한장': false, '하나': false };

function motionId(word) {
  const k = String(word || '').normalize('NFC').replace(/\s+/g, '').replace(/->|＞|>/g, '→').toLowerCase();
  for (const [id, ws] of Object.entries(MOTION_WORDS)) if (ws.includes(k)) return id;
  return null;
}
const norm = (t) => String(t == null ? '' : t).normalize('NFC').replace(/[\s\p{P}\p{S}]/gu, '');

/**
 * 대본 글 → 장면 지시 목록 [{ line, heading, kind:'motion'|'layer', value, raw, first:{ text, ord } | null, error? }]
 *   first = 그 장면 첫 낭독 문장(글 + 대본 순번) — 앱과 같은 문장 나누기(splitHybrid)로 센다.
 */
function parse(rawText) {
  const text = String(rawText == null ? '' : rawText).replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));
  const lines = text.split('\n');
  const out = []; let heading = '', headLine = -1, fence = false;
  lines.forEach((ln, i) => {
    if (/^\s*```/.test(ln)) { fence = !fence; return; }
    if (fence) return;
    const h = HEAD_RE.exec(ln); if (h) { heading = h[2]; headLine = i; return; }
    const m = DIR_RE.exec(ln); if (!m) return;
    const key = m[1].replace(/\s+/g, ''), val = m[2];
    const d = { line: i + 1, heading, headLine, raw: ln.trim() };
    if (key === '움직임') { const id = motionId(val); if (id) Object.assign(d, { kind: 'motion', value: id }); else Object.assign(d, { kind: 'motion', value: null, error: `움직임 이름을 모릅니다(「${val}」 · ${Object.values(MOTION_LABEL).join(' · ')})` }); }
    else if (key === '판') { const v = LAYER_WORDS[String(val).replace(/\s+/g, '')]; if (v == null) Object.assign(d, { kind: 'layer', value: null, error: `판 값은 「따로」 또는 「한장」(「${val}」)` }); else Object.assign(d, { kind: 'layer', value: v }); }
    else return;   // 🎞 로 시작하는 다른 줄(앞으로의 지시)은 모르는 채로 둔다 — 경고도 없다
    out.push(d);
  });
  if (!out.length) return out;
  const SS = require('./sentence-splitter');
  const cache = new Map();
  const itemsUpTo = (k) => { if (!cache.has(k)) { let it = []; try { it = SS.splitHybrid(lines.slice(0, k).join('\n')).items || []; } catch (_) {} cache.set(k, it); } return cache.get(k); };
  for (const d of out) {
    let end = lines.length; for (let k = Math.max(0, d.headLine + 1); k < lines.length; k++) if (HEAD_RE.test(lines[k])) { end = k; break; }
    const before = d.headLine >= 0 ? itemsUpTo(d.headLine).length : 0;
    const upto = itemsUpTo(end);
    d.first = upto.length > before ? { text: String(upto[before].text || ''), ord: before } : null;
  }
  return out;
}

/** 지시 → 그룹(그 장면 첫 낭독 문장이 든 그룹) · 못 찾으면 null */
function groupOf(project, d) {
  if (!d.first || !d.first.text) return null;
  const order = [];
  for (const g of (project.groups || [])) for (const id of (g.sentenceIds || [])) order.push({ id, g });
  const byId = new Map((project.sentences || []).map((s) => [s.id, s]));
  const k = norm(d.first.text);
  const hit = order.map((x, i) => (norm((byId.get(x.id) || {}).text) === k ? i : -1)).filter((i) => i >= 0);
  if (!hit.length) return null;
  const i = hit.reduce((a, b) => (Math.abs(b - d.first.ord) < Math.abs(a - d.first.ord) ? b : a));
  return order[i].g;
}

/**
 * 프로젝트에 지시를 얹는다(움직임 = g.look.motion · 판 = g.layered) → 결과 { motionOrdered, motionChanged:[{g, from, to, why}], layerScenes, warnings }
 *   줄이 없으면 아무것도 바꾸지 않고 null.
 */
function apply(project, rawText) {
  const list = parse(rawText);
  if (!list.length || !project) return null;
  const KB = require('./ken-burns');
  const res = { motionOrdered: 0, motionChanged: [], layerScenes: 0, warnings: [], list: [] };
  const taken = new Map();   // 그룹 → 이미 지시를 받은 장면 줄
  for (const d of list) {
    const tag = `🎞 ${d.line}줄`;
    if (d.error) { res.warnings.push(`${tag} — ${d.error} → 이 줄만 건너뜁니다`); continue; }
    const g = groupOf(project, d);
    if (!g) { res.warnings.push(`${tag} — 이 장면(「${d.heading}」)의 낭독 문장을 찾지 못했습니다 → 이 줄만 건너뜁니다`); continue; }
    const key = g.num + ':' + d.kind;
    if (taken.has(key) && taken.get(key) !== d.headLine) { res.warnings.push(`${tag} — G${g.num} 은 앞 장면 지시를 이미 받았습니다(한 그룹에 장면 여럿 · 앞 장면이 이깁니다)`); continue; }
    taken.set(key, d.headLine);
    if (d.kind === 'motion') { g.look = { ...(g.look || {}), motion: d.value }; res.motionOrdered++; res.list.push({ g: g.num, kind: 'motion', value: d.value }); }
    else if (d.kind === 'layer') { if (d.value) { g.layered = true; res.layerScenes++; } else delete g.layered; res.list.push({ g: g.num, kind: 'layer', value: d.value }); }
  }
  // 같은 움직임 연달아 금지 — 지정한 그룹만 고친다(지정 없는 그룹은 예전 규칙 그대로)
  const gs = project.groups || [];
  for (let i = 1; i < gs.length; i++) {
    const g = gs[i], m = g.look && g.look.motion;
    if (!list.some((d) => d.kind === 'motion' && !d.error && groupOf(project, d) === g)) continue;
    if (!OPPOSITE[m]) continue;
    const prev = KB.patternIndexOf(gs[i - 1]);
    if (prev === PATTERN_OF[m]) {
      const to = OPPOSITE[m];
      g.look = { ...g.look, motion: to };
      res.motionChanged.push({ g: g.num, from: MOTION_LABEL[m], to: MOTION_LABEL[to], why: `바로 앞 G${gs[i - 1].num} 과 같은 움직임(연달아 금지)` });
    }
  }
  return res;
}

module.exports = { MOTION_WORDS, MOTION_LABEL, motionId, parse, groupOf, apply };
