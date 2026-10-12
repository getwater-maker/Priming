'use strict';
/**
 * info-cards.js — 📇 정보 카드(정보튜브 · 시니어 생활정보 — 2026-10-12 v0.8.2) — 대본 표시 줄 읽기 + 판 계획(순수 함수)
 *
 * 화면 4종(글자는 AI 그림 안에 넣지 않고 **위에 얹는다** · 그림을 글자 화면으로 바꾸지 않는다):
 *   ① 낱말 카드  `> 🔤 카드: A | B | C`        — 오른쪽 판에 낱말 1~3개 · 다음 낭독 문단 첫 문장부터 다음 🔤·`###`·`##` 전까지 · 끄기 `> 🔤 카드: -`
 *   ② 구간 표지  `##` 제목(자동 · 채널 옵션)    — 3.5초 · 「N / M」 · 이름 · 진행 막대 · 도입부 없음 · 「마무리」는 번호 없이 이름만(막대 꽉 참)
 *   ③ 표         `> 📊 표: 제목` + `> | … |` 줄들(첫 줄 = 머리) + `> 📊 출처: …` — 다음 문단 하나 동안(최소 6초) 전체 화면
 *   ④ 확인표     `> ✅ 확인: 문구`              — 오른쪽 판 · 다음 문단 하나 동안 · **영상 전체에서 쌓인다**(최근 5줄 · 방금 것만 진하게)
 * 겹침 순서: 표 > 구간 표지 > 확인표 > 낱말 카드(위가 이기면 아래는 그동안 숨었다 끝나면 돌아온다).
 *
 * 🔑 이 줄들은 **낭독·자막·그림·영상 프롬프트로 읽히지 않는다** — sentence-splitter 가 프롬프트 판정(「이미지:」「영상:」 낱말)보다 먼저 가로챈다.
 *    위치 = 「바로 다음 낭독 문단」 → 문장 순번으로 붙이고, 작업본 문장과 안 맞으면 ⚠ 로그 후 그 판만 건너뛴다(조용히 줄이지 않는다).
 * 순수 함수 — fs·require.main 없음(core/*.js 는 렌더러 번들에 들어갈 수 있다). 파일 읽기는 호출하는 쪽(main).
 */
const MAX_WORDS = 3, MAX_CHECK_LINES = 5, CHECK_WARN_CHARS = 14, COVER_SEC = 3.5, TABLE_MIN_SEC = 6, MIN_SEG = 0.8, FADE_SEC = 0.5;

// ── 줄 읽기 ──────────────────────────────────────────────────────────────────
const RE_WORDS = /^[ \t]*>[ \t]*🔤[ \t]*카드[ \t]*[:：][ \t]*(.*?)[ \t]*$/u;
const RE_TABLE = /^[ \t]*>[ \t]*📊[ \t]*표[ \t]*[:：][ \t]*(.*?)[ \t]*$/u;
const RE_SOURCE = /^[ \t]*>[ \t]*📊[ \t]*출처[ \t]*[:：][ \t]*(.*?)[ \t]*$/u;
const RE_CHECK = /^[ \t]*>[ \t]*✅[ \t]*확인[ \t]*[:：][ \t]*(.*?)[ \t]*$/u;
const RE_ROW = /^[ \t]*>[ \t]*\|(.*?)\|?[ \t]*$/u;

/**
 * 한 줄이 정보 표시 줄인가. openTable = 지금 열려 있는 표(있으면 `> |` 줄이 그 표의 행).
 * @returns {null | {mark?: object, rowOf?: object, consumed: true}} mark = 낭독 사이에 끼울 표식 · rowOf = 이미 열린 표에 붙었음
 */
const POS_TAGS = { '오른쪽가운데': 'rc', '왼쪽가운데': 'lc', '오른쪽위': 'rt', '왼쪽위': 'lt' };
const POS_NAMES = { rc: '오른쪽가운데', lc: '왼쪽가운데', rt: '오른쪽위', lt: '왼쪽위' };
/** 줄 끝 꼬리표 `@왼쪽위` 떼기 — 카드 문구에 안 나오는 기호라 문구와 섞이지 않는다(로이 2026-10-12 · 채널사업부 규약). 모르는 값은 bad 로 돌려 ⚠ */
function splitPosTag(raw) {
  const m = /^(.*?)[ 	]*@([^\s@|]+)[ 	]*$/u.exec(raw);
  if (!m) return { text: raw, pos: null, bad: null };
  const key = m[2].replace(/\s+/g, '');
  return POS_TAGS[key] ? { text: m[1].trim(), pos: POS_TAGS[key], bad: null } : { text: m[1].trim(), pos: null, bad: m[2] };
}
function lineKind(line, openTable) {
  let m;
  if ((m = RE_WORDS.exec(line))) {
    const t = splitPosTag(m[1].trim()), raw = t.text;
    if (raw === '' || raw === '-' || raw === '끄기') return { mark: { kind: 'words', words: [], clear: true, line: raw } };
    const words = raw.split('|').map((x) => x.trim()).filter(Boolean);
    return { mark: { kind: 'words', words, clear: false, line: raw, ...(t.pos ? { pos: t.pos } : {}), ...(t.bad ? { badPos: t.bad } : {}) } };
  }
  if ((m = RE_TABLE.exec(line))) return { mark: { kind: 'table', title: m[1].trim(), rows: [], source: '', line: m[1].trim() }, opensTable: true };
  if ((m = RE_SOURCE.exec(line))) return { sourceText: m[1].trim() };
  if ((m = RE_CHECK.exec(line))) { const t = splitPosTag(m[1].trim()); return { mark: { kind: 'check', text: t.text, line: t.text, ...(t.pos ? { pos: t.pos } : {}), ...(t.bad ? { badPos: t.bad } : {}) } }; }
  if (openTable && (m = RE_ROW.exec(line))) {
    const cells = m[1].split('|').map((x) => x.trim());
    // 구분선(`---`)은 건너뛴다
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) return { rowText: null };
    return { rowText: cells };
  }
  return null;
}
const isInfoLine = (line) => !!(RE_WORDS.test(line) || RE_TABLE.test(line) || RE_SOURCE.test(line) || RE_CHECK.test(line));

// ── 대본 → 표식·문단·구간 ────────────────────────────────────────────────────
/**
 * splitHybrid 의 items(표식 · 문단 번호 포함)에서 정보 카드 재료를 모은다.
 *   marks  = [{ sent(문장 순번 0~), kind, … }]
 *   para   = 문장 순번 → 문단 번호
 *   block  = 문장 순번 → 블록 번호(`###`·`##` 마다 바뀜 — 낱말 카드가 거기서 끝난다)
 *   sections = [{ key, title, first(첫 문장 순번), intro }] — `##` 구간(도입부 포함)
 */
function collect(items, orphan) {
  const marks = [], para = [], block = [], texts = [], secKey = [];
  const sections = []; const seen = new Set(); let blk = -1, lastTitle = Symbol('x'), lastKey = null;
  (items || []).forEach((it, i) => {
    texts.push(String(it.text || ''));
    para.push(it.para == null ? -1 : it.para);
    const t = it.sectionTitle || '', k = it.h2Key;
    if (t !== lastTitle || k !== lastKey) { blk++; lastTitle = t; lastKey = k; }
    block.push(blk); secKey.push(k);
    if (!seen.has(k)) { seen.add(k); sections.push({ key: k, title: String(it.h2Title || '').trim(), first: i, intro: !!it.isIntro }); }
    for (const m of (it.marks || [])) marks.push({ sent: i, ...m });
  });
  return { marks, para, block, texts, secKey, sections, orphan: (orphan || []).length };
}

/** 대본 글 → 재료. splitHybrid 를 부르는 쪽이 items 를 넘긴다 */
function fromItems(split) { return collect(split && split.items, split && split.orphanMarks); }

/** 대본 글(.md) → 재료 — 파서가 쓰는 것과 같은 splitHybrid 로(문장 순번이 같다). 책 전용 섹션은 파서와 같이 뺀다 */
function fromRaw(raw) {
  let r = String(raw == null ? '' : raw);
  try { r = require('./parsers/book-parser').stripBookSections(r); } catch (_) {}
  return fromItems(require('./sentence-splitter').splitHybrid(r));
}

/** 지문·작업본용 — 표시 줄 글(바뀌면 MP4 를 다시 굽는다) */
function signatureOf(parsed) {
  return (parsed && parsed.marks || []).map((m) => (m.kind === 'table' ? `표:${m.title}|${m.rows.map((r) => r.join('¦')).join('¶')}|${m.source}` : `${m.kind}:${m.kind === 'words' ? (m.clear ? '-' : m.words.join('|')) : m.text}${m.pos ? '@' + m.pos : ''}`) + '@' + m.sent);
}

// ── 판 계획 ──────────────────────────────────────────────────────────────────
const normText = (t) => String(t == null ? '' : t).normalize('NFC').replace(/[\s\p{P}\p{S}]/gu, '');
const stripNum = (t) => String(t || '').replace(/^\s*\d+\s*(?:장|회|부|강|편)?\s*[—–\-:·.]\s*/, '').trim();
const CLOSING_RE = /마무리|맺음|맺는/;

/**
 * 판 계획 — 재료 + 프로젝트(문장 시각) → { panels, warnings }.
 *   panel = { type:'cover'|'words'|'table'|'check', t0, t1, hideCaptions?, ... 종류별 자료 }
 * @param {object} project 문장(id·text·ttsAudioPath·ttsDurationSec)·그룹(sentenceIds)
 * @param {object} parsed fromItems 결과
 * @param {{sections?: boolean}} opts sections = 구간 표지 자동
 */
function plan(project, parsed, opts = {}) {
  const warnings = [], panels = [];
  if (!project || !parsed) return { panels, warnings };
  const sents = project.sentences || [];
  const wantSections = !!opts.sections;
  if (!parsed.marks.length && !wantSections) return { panels, warnings };
  // 문장 시각(.vrew 타임라인과 같은 규칙: 그룹 순서 · 음성이 있는 문장을 이어 붙임)
  const byId = new Map(sents.map((s, i) => [s.id, i]));
  const T = new Array(sents.length).fill(null), GI = new Array(sents.length).fill(null); let t = 0, gi = -1;   // GI = 문장이 든 그룹(### 장면) 번호 — 판의 자리를 장면 안에서 고정하는 열쇠
  for (const g of (project.groups || [])) { gi++; for (const id of (g.sentenceIds || [])) {
    const i = byId.get(id); if (i == null) continue; GI[i] = gi;
    const s = sents[i], d = (s.ttsAudioPath && s.ttsDurationSec > 0) ? s.ttsDurationSec : (opts.estimate ? 2.5 : 0);   // estimate = ① 미리보기 — 음성이 없으면 문장당 2.5초로 어림(목록 시각과 같은 어림)
    T[i] = d > 0 ? [t, t + d] : null; t += d;
  } }
  const total = t;
  const spans = []; { let gi2 = -1; for (const g of (project.groups || [])) { gi2++; let a = null, b = null; for (const id of (g.sentenceIds || [])) { const i = byId.get(id); if (i == null || !T[i]) continue; if (a == null) a = T[i][0]; b = T[i][1]; } if (a != null) spans.push({ gi: gi2, t0: a, t1: b }); } }
  // 대본(.md)과 작업본의 문장이 같은 순서·같은 글인가 — 아니면 위치를 믿을 수 없다(조용히 틀리지 않는다)
  if (parsed.texts.length !== sents.length) {
    warnings.push(`📇 정보 카드 — 대본 문장 ${parsed.texts.length}개 ≠ 작업본 문장 ${sents.length}개(대본을 다시 읽거나 문장을 고친 뒤 파일 저장이 안 된 듯) → 정보 카드를 모두 건너뜁니다`);
    return { panels, warnings };
  }
  const ok = parsed.texts.map((x, i) => normText(x) === normText(sents[i].text));
  const bad = ok.filter((x) => !x).length;
  if (bad) warnings.push(`📇 정보 카드 — 대본과 작업본 문장 글이 다른 곳 ${bad}개(그 자리의 표시는 건너뜁니다)`);
  const timeOf = (i) => (i >= 0 && i < sents.length && ok[i] ? T[i] : null);
  const paraEnd = (i) => { const p = parsed.para[i]; let e = i; while (e + 1 < parsed.para.length && parsed.para[e + 1] === p && p >= 0) e++; return e; };
  const blockEnd = (i) => { const b = parsed.block[i]; let e = i; while (e + 1 < parsed.block.length && parsed.block[e + 1] === b) e++; return e; };

  // ② 구간 표지
  if (wantSections) {
    const secs = parsed.sections.filter((s) => !s.intro);
    const numbered = secs.filter((s) => !CLOSING_RE.test(s.title));
    secs.forEach((s) => {
      const tm = timeOf(s.first); if (!tm) return;
      let endIdx = s.first; while (endIdx + 1 < parsed.texts.length && parsed.secKey[endIdx + 1] === s.key) endIdx++;
      const endT = (T[endIdx] || tm)[1];
      const isClose = CLOSING_RE.test(s.title);
      const n = isClose ? 0 : numbered.indexOf(s) + 1;
      panels.push({ type: 'cover', scene: GI[s.first], t0: tm[0], t1: Math.min(tm[0] + COVER_SEC, Math.max(tm[0] + 1.5, endT)), n, m: numbered.length, title: stripNum(s.title) || s.title, closing: isClose, hideCaptions: true });   // 표지가 뜬 3.5초 동안은 아래 자막을 가린다(큰 글자와 겹치지 않게)
    });
  }
  // ①③④ 표시 줄
  const wordMarks = parsed.marks.filter((m) => m.kind === 'words');
  const checkTexts = [];   // 지금까지 나온 ✅ (영상 전체에서 쌓임)
  for (const [mi, m] of parsed.marks.entries()) {
    const tm = timeOf(m.sent);
    if (!tm) { warnings.push(`📇 정보 카드 — 「${(m.line || m.kind).slice(0, 30)}」 표시를 붙일 문장을 못 찾았습니다 → 건너뜁니다`); if (m.kind === 'check') checkTexts.push(m.text); continue; }
    if (m.kind === 'words') {
      if (m.clear) continue;   // 끄기 — 아래 끝 계산에서 쓴다
      let words = m.words;
      if (!words.length) { warnings.push('📇 정보 카드 — 🔤 카드 낱말이 비었습니다 → 건너뜁니다'); continue; }
      if (words.length > MAX_WORDS) { warnings.push(`📇 정보 카드 — 🔤 카드 낱말 ${words.length}개(최대 ${MAX_WORDS}) → 앞 ${MAX_WORDS}개만: ${m.line.slice(0, 40)}`); words = words.slice(0, MAX_WORDS); }
      const next = wordMarks.find((x) => x.sent > m.sent);
      const bEnd = blockEnd(m.sent);
      const endIdx = Math.min(bEnd, next ? next.sent - 1 : bEnd);
      const endTm = (T[endIdx] || tm);
      panels.push({ type: 'words', mi, scene: GI[m.sent], ...(m.pos ? { pos: m.pos } : {}), t0: tm[0], t1: Math.max(endTm[1], tm[0] + 2), words });
    } else if (m.kind === 'table') {
      const hasHead = m.rows.length >= 1;
      if (!hasHead) { warnings.push(`📇 정보 카드 — 📊 표 「${m.title.slice(0, 20)}」 에 표 줄(> | … |)이 없습니다 → 건너뜁니다`); continue; }
      const eIdx = paraEnd(m.sent), endTm = T[eIdx] || tm;
      panels.push({ type: 'table', mi, scene: GI[m.sent], t0: tm[0], t1: Math.min(total, Math.max(endTm[1], tm[0] + TABLE_MIN_SEC)), title: m.title, rows: m.rows, source: m.source || '', hideCaptions: true });
    } else if (m.kind === 'check') {
      if (m.text.length > CHECK_WARN_CHARS) warnings.push(`📇 정보 카드 — ✅ 문구가 ${m.text.length}자(권장 ${CHECK_WARN_CHARS}자 이하): 「${m.text}」 — 판 폭을 넘으면 그대로 그립니다`);
      checkTexts.push(m.text);
      const eIdx = paraEnd(m.sent), endTm = T[eIdx] || tm;
      panels.push({ type: 'check', mi, scene: GI[m.sent], ...(m.pos ? { pos: m.pos } : {}), t0: tm[0], t1: Math.min(total, Math.max(endTm[1], tm[0] + 2)), list: checkTexts.slice(-MAX_CHECK_LINES), done: Math.min(checkTexts.length, MAX_CHECK_LINES), all: checkTexts.length });
    }
  }
  // 📍 자리 꼬리표(`@왼쪽위`) — 「그 줄이 시작한 장면」 단위 · 한 장면에 서로 다른 꼬리표가 있으면 첫 것만 쓰고 ⚠(한 장면 안에서 판이 뛰지 않는다)
  for (const m of parsed.marks) if (m.badPos) warnings.push(`📇 정보 카드 — 자리 꼬리표 「@${m.badPos}」 를 모릅니다(오른쪽가운데·왼쪽가운데·오른쪽위·왼쪽위) → 자동 자리로 둡니다`);
  {
    const sceneTag = new Map();
    for (const m of parsed.marks) { if ((m.kind !== 'words' && m.kind !== 'check') || !m.pos) continue; const sc = GI[m.sent]; if (sc == null) continue;
      if (!sceneTag.has(sc)) sceneTag.set(sc, m.pos);
      else if (sceneTag.get(sc) !== m.pos) warnings.push(`📇 정보 카드 — 한 장면(G${sc + 1}) 안에 자리 꼬리표가 둘(@${POS_NAMES[sceneTag.get(sc)]} · @${POS_NAMES[m.pos]}) → 첫 것만 씁니다`); }
    for (const p of panels) if ((p.type === 'words' || p.type === 'check') && p.scene != null && sceneTag.has(p.scene)) p.posTag = sceneTag.get(p.scene);
    // 💡 그 장면 🖼️ 프롬프트의 「인물 left/right of centre」 → 판은 반대쪽(자동 자리의 1순위 힌트)
    for (const p of panels) if ((p.type === 'words' || p.type === 'check') && p.scene != null) {
      const g = (project.groups || [])[p.scene], mm = g && /(left|right)\s+of\s+cent(?:re|er)/i.exec(String(g.imagePrompt || ''));
      if (mm) p.hint = /left/i.test(mm[1]) ? 'right' : 'left';
    }
  }
  // 겹침 순서 — 표 > 구간 표지 > 확인표 > 낱말 카드 (아래 것은 위 것이 뜬 동안 숨는다)
  const RANK = { table: 4, cover: 3, check: 2, words: 1 };
  const out = [];
  for (const p of panels) {
    let segs = [[p.t0, p.t1]];
    for (const q of panels) {
      if (q === p || RANK[q.type] <= RANK[p.type]) continue;
      const nx = [];
      for (const [a, b] of segs) {
        if (q.t1 <= a || q.t0 >= b) { nx.push([a, b]); continue; }
        if (q.t0 > a) nx.push([a, q.t0]);
        if (q.t1 < b) nx.push([q.t1, b]);
      }
      segs = nx;
    }
    for (const [a, b] of segs) if (b - a >= MIN_SEG) out.push({ ...p, t0: a, t1: b });
  }
  out.sort((a, b) => a.t0 - b.t0 || RANK[b.type] - RANK[a.type]);
  // 문장 범위(s0~s1 · 그룹 순서 번호 = ① 칸 목록의 순번과 같다) — 미리보기가 「이 문장에서 보이는 판」을 찾는 열쇠
  for (const p of out) {
    // 문장을 절반 넘게 덮는 문장만 센다(구간 표지가 다음 문장 첫 1초에 걸쳤다고 그 문장 전체에 보이게 하지 않는다) — 하나도 없으면 가장 많이 겹치는 문장
    let s0 = -1, s1 = -1, best = -1, bi = -1;
    for (let i = 0; i < T.length; i++) {
      if (!T[i]) continue;
      const ov = Math.min(T[i][1], p.t1) - Math.max(T[i][0], p.t0), len = T[i][1] - T[i][0];
      if (ov > best) { best = ov; bi = i; }
      if (ov > 0 && ov >= len * 0.5 - 1e-6) { if (s0 < 0) s0 = i; s1 = i; }
    }
    if (s0 < 0) { s0 = s1 = bi; }
    p.s0 = s0; p.s1 = s1;
  }
  return { panels: out, warnings, spans, total };
}

module.exports = { POS_TAGS, POS_NAMES, splitPosTag, fromRaw, MAX_WORDS, MAX_CHECK_LINES, CHECK_WARN_CHARS, COVER_SEC, TABLE_MIN_SEC, FADE_SEC, lineKind, isInfoLine, collect, fromItems, signatureOf, plan, normText, stripNum };
