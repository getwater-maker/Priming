'use strict';
/**
 * screen-cards.js — 📜 화면 카드(역자 노트 원문-번역 병기 · 장 막간) — 삼국지 R4 (2026-10-12 · v0.7.98 · 고전서재 요청서 「화면카드」)
 *
 * 왜: 「사람이 옮기고 해설한 영상」이라는 증거를 화면에도 보이게 한다(YouTube 비진정성 콘텐츠 대응). 낭독이 읽는 **그 문장들**을
 *     어두운 판 위에 천천히 나타났다 사라지게 보인다. 장면(그림·그룹 수)은 하나도 안 바뀐다 — MP4 자막 층(ASS)에 얹는다(MP4 전용 · .vrew 에는 안 나옴).
 *
 * 대본 표기(한 줄 · 그 `##`/`###` 안 어디든 위치 무관 · 앱 파서가 `>` 일반 주석으로 무시하므로 옛 앱에서도 대본이 안 깨진다):
 *     > 📜 화면카드: 병기 | 원문=<원문 문장 앞부분> +1 | 번역=<번역 문장 앞부분> +1
 *     > 📜 화면카드: 막간 | 문장=<장 제목을 읽는 문장 앞부분>
 *   · 앞부분 = 낭독 문장의 **첫 4글자 이상**(공백·문장부호 무시 · 그 그룹 안에서 한 문장만 맞아야 한다) · `+N` = 그 문장 뒤로 이어지는 N 문장도 포함(생략 = 그 문장 하나).
 *   · 🔑 **카드 글자는 그 문장들의 현재 자막 글 그대로**(표기에 적은 글은 문장을 가리키는 열쇠일 뿐 — 카드 글자와 낭독 글이 어긋날 수 없다).
 *   · 카드는 가리킨 문장들이 **읽히는 시간에만** 뜬다(첫 문장 시작 ~ 끝 문장 끝). 낭독 문단 사이에는 안 뜬다.
 * 🅱 **글자를 직접 적는 꼴**(v0.7.99 · 고전서재 요청 — 한문 원문은 낭독 문장이 아니라 열쇠로 못 가리킨다): `때=` 가 있으면 그 줄의 원문·번역·제목은 **적은 글 그대로** 카드 글자가 되고, 낭독 문장은 **언제 뜨는지**(시간 앵커)만 정한다:
 *     > 📜 화면카드: 병기 | 때=<낭독 문장 앞부분> +N | 원문=<한문 글자 그대로> | 번역=<한국어 글자 그대로>
 *     > 📜 화면카드: 막간 | 때=<낭독 문장 앞부분> | 제목=<장 제목 글자 그대로>
 *     `때=` 의 +N = 그 문장부터 N 문장 뒤 끝까지 뜬다 · `번역=`(막간은 `제목=`)을 빼면 때 문장들의 자막 글을 쓴다(일치 보장) · 글 안의 ` // ` 는 줄바꿈 · 글자가 낭독과 맞는지는 **적는 쪽 책임**(앱은 검사하지 않는다).
 *   · 🙈 줄 끝에 `| 자막=숨김` 을 쓰면 그 카드가 뜨는 동안 아래 자막을 가린다(카드마다 · 기본 안 가림).
 *   · 조용히 줄이지 않는다 — 문장을 못 찾음 · 둘 이상 맞음 · 앞부분이 짧음 · 종류 모름 · 음성 없음 → 경고 줄을 돌려주고 **그 카드만** 건너뛴다.
 * 마커가 하나도 없으면 아무것도 안 한다(기본값 = 예전 출력과 한 글자도 다르지 않다).
 *
 * main·렌더 전용이 아니다 — 순수 함수라 테스트가 그대로 부른다(core/*.js 는 렌더러 번들에 들어갈 수 있으니 fs·require.main 을 쓰지 않는다).
 */
// 🇯🇵 해설·낱말(v0.9.7 · 일본 채널 요청 7) = 그리는 모양은 막간·병기와 같고 이름만 다르다 — 채널 게이트가 종류를 이름으로 가른다.
const KINDS = { '병기': 'pair', '막간': 'interlude', '해설': 'interlude', '낱말': 'pair' };
// 🇯🇵 카드가 가리킨 낭독 문장에 가나가 있으면 일본어 카드 — 렌더가 일본어 글꼴(Noto Sans JP)로 그린다(한국 명조·한자 부분집합엔 県·沢·가나가 없다).
const JA_RE = /[぀-ヿ]/;
const langOf = (rows) => (rows.some((x) => JA_RE.test(x.text)) ? 'ja' : undefined);
const MARK_RE = /^[ \t]*>[ \t]*📜[ \t]*화면카드[ \t]*[:：][ \t]*(.*?)[ \t]*$/u;
const HEAD_RE = /^(#{1,6})\s+(.+?)\s*$/;
const MIN_KEY = 4;           // 앞부분 최소 글자(공백·문장부호 뺀 글자 수)
const MIN_SPAN = 1.0;        // 카드가 뜨는 최소 길이(초) — 이보다 짧으면 건너뛴다
const MAX_FADE = 1.5;        // 서서히 나타남·사라짐 최대(초) — 구간이 짧으면 구간의 1/4

/** 비교용 정규화 — 공백·문장부호·기호를 빼고 NFC */
function norm(t) { return String(t == null ? '' : t).normalize('NFC').replace(/[\s\p{P}\p{S}]/gu, ''); }

/** `앞부분 +N` → { key, extra } (key 는 원문 그대로 — 정규화는 맞출 때) */
function anchorOf(v) {
  const m = /^(.*?)\s*[+＋]\s*(\d+)\s*$/u.exec(String(v || '').trim());
  return m ? { text: m[1].trim(), extra: Math.min(20, Number(m[2])), raw: String(v || '').trim() } : { text: String(v || '').trim(), extra: 0, raw: String(v || '').trim() };
}

/**
 * 대본 글에서 카드 줄을 모은다 → [{ line, raw, heading, kind, f: { 원문?, 번역?, 문장? }, error? }]
 *   ``` 코드 울타리 안 · HTML 주석 안은 건너뛴다. heading = 그 줄 위의 가장 가까운 `#` 제목 글.
 */
function markersOf(rawText) {
  const text = String(rawText == null ? '' : rawText).replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));   // 주석은 줄 수만 남긴다
  const out = []; let heading = '', fence = false;
  text.split('\n').forEach((ln, i) => {
    if (/^\s*```/.test(ln)) { fence = !fence; return; }
    if (fence) return;
    const h = HEAD_RE.exec(ln);
    if (h) { heading = h[2]; return; }
    const m = MARK_RE.exec(ln); if (!m) return;
    const parts = m[1].split('|').map((x) => x.trim()).filter((x, k) => k === 0 || x);
    const kindName = parts[0] || '';
    const f = {};
    for (const p of parts.slice(1)) {
      const kv = /^([^=＝]+?)\s*[=＝]\s*(.*)$/u.exec(p);
      if (kv) f[kv[1].trim()] = anchorOf(kv[2]);
    }
    out.push({ line: i + 1, raw: ln.trim(), heading, kindName, kind: KINDS[kindName] || null, f });
  });
  return out;
}
/** 지문·작업본용 — 마커 줄 글만(바뀌면 MP4 를 다시 굽는다) */
const signatureOf = (markers) => (markers || []).map((m) => m.raw);

// ⏸ 막간 쉼(v0.9.25 · 채널사업부 요청 2026-10-15 — 「장이 시작할 때 잠깐 쉬는 틈」):
//   채널 「막간 쉼(초)」(preset.interludePauseSec · 기본 0 = 꺼짐) → **막간** 카드의 끝 문장(`때=`·`문장=` 의 +N 마지막) 소리가 끝난 뒤 N초 무음.
//   카드는 무음 동안에도 떠 있고(t1 이 무음 끝) 그동안 아래 자막은 가린다(MP4). 해설·낱말·병기에는 채널 값을 붙이지 않는다(진행자 말이 이어지는 자리).
//   카드 줄 칸 `쉼=<초>` = 그 카드만 덮어쓰기(어느 종류든 · 0 = 끄기). 대본은 바꾸지 않는다 — 무음은 .vrew 를 만들 때 그 문장 음성 뒤에 덧댄다(pipeline.buildProjectVrew).
//   🔑 시각을 쓰는 곳(화면 카드 · 정보 카드 · 유튜브 챕터)은 모두 withPauses 로 같은 무음을 넣은 시각을 본다 — 빠뜨리면 막간마다 N초씩 밀린다.
const PAUSE_MAX = 15;        // 쉼 상한(초)
const PAUSE_KIND = '막간';    // 채널 값이 붙는 종류(이름)

/** 대본 순서 문장 목록(시각 없이) — 열쇠 맞추기용 */
/**
 * 🕳 빈 클립(Lab) — 문장 `s.padAfter`(초 · 0.2~10) = 그 문장 음성 **뒤 무음**(화면은 이어지고 자막은 없다). 음성이 있는 문장만.
 *   막간 카드의 쉼(pausesOf)과 **합쳐** 한 계획이 된다 — 합치는 곳은 pipeline.pausePlanOf 한 곳.
 */
const PAD = { min: 0.2, max: 30, step: 0.1, def: 5 };   // Vrew: 빈 클립 = 1초 빈 워드 5개(5초)
function normPad(v) { const n = Number(v); if (!isFinite(n) || n <= 0) return 0; return Math.round(Math.max(PAD.min, Math.min(PAD.max, n)) * 10) / 10; }
function padOf(s) { return (s && s.ttsAudioPath && s.ttsDurationSec > 0) ? normPad(s.padAfter) : 0; }
function sentsOf(project) {
  const byId = new Map((project.sentences || []).map((s) => [s.id, s]));
  const out = [];
  for (const g of (project.groups || [])) {
    for (const id of (g.sentenceIds || [])) {
      const s = byId.get(id); if (!s) continue;
      const d = (s.ttsAudioPath && s.ttsDurationSec > 0) ? s.ttsDurationSec : 0;
      out.push({ s, text: String(s.text || ''), key: norm(s.text), phase: norm(g.phase || g.title || ''), d, sound: d > 0 });
    }
  }
  return out;
}
function findIn(sents, m, a, label) {
  const k = norm(a.text);
  if (k.length < MIN_KEY) return { err: `${label} 앞부분이 너무 짧습니다(공백·문장부호 빼고 ${MIN_KEY}글자 이상) — 「${a.text}」` };
  const hd = norm(m.heading);
  const all = sents.map((x, i) => (x.key.startsWith(k) ? i : -1)).filter((i) => i >= 0);
  const scoped = hd ? all.filter((i) => sents[i].phase === hd) : [];
  const use = scoped.length ? scoped : all;   // 그룹 이름이 안 맞으면(분할 방식에 따라 다름) 대본 전체에서 찾는다
  if (!use.length) return { err: `${label} 문장을 찾지 못했습니다 — 「${a.text}」 로 시작하는 낭독 문장이 없습니다` };
  if (use.length > 1) return { err: `${label} 문장이 ${use.length}개 맞습니다 — 앞부분을 더 길게 써 주세요(「${a.text}」)` };
  return { i: use[0] };
}
function takeIn(sents, i, extra, label) {
  const out = [];
  for (let k = i; k <= i + extra; k++) { if (!sents[k]) return { err: `${label} 뒤로 ${extra}문장을 이을 수 없습니다(대본이 끝남)` }; out.push(k); }
  return { idx: out };
}
/** 마커 하나 → 가리킨 문장 번호(sents 의 index) · 칸별 묶음. 소리 검사는 하지 않는다(대본 보기도 쓴다). */
function resolveMarker(sents, m) {
  if (!m.kind) return { err: `종류 「${m.kindName}」 를 모릅니다(${Object.keys(KINDS).join(' · ')})` };
  if (m.f['때']) {
    const r = findIn(sents, m, m.f['때'], '때'); if (r.err) return r;
    const tk = takeIn(sents, r.i, m.f['때'].extra, '때'); if (tk.err) return tk;
    return { idx: tk.idx, by: { '때': tk.idx }, literal: true };
  }
  if (m.f['제목'] && !m.f['문장']) return { err: '제목= 은 때= 와 함께 써야 합니다(때=<낭독 문장 앞부분>)' };
  const need = m.kind === 'pair' ? ['원문', '번역'] : ['문장'];
  const miss = need.filter((k) => !m.f[k]);
  if (miss.length) return { err: `${miss.join('·')}= 칸이 없습니다` };
  const by = {};
  for (const k of need) {
    const r = findIn(sents, m, m.f[k], k); if (r.err) return r;
    const tk = takeIn(sents, r.i, m.f[k].extra, k); if (tk.err) return tk;
    by[k] = tk.idx;
  }
  return { idx: need.flatMap((k) => by[k]), by, need };
}
/** 카드 끝 문장(시간상 마지막) — 쉼이 붙는 자리 */
const lastOf = (idx) => Math.max(...idx);
/** 그 카드의 쉼(초) — 칸 `쉼=` 이 이기고, 없으면 막간만 채널 값. → { sec, err? } */
function pauseFor(m, defSec) {
  if (m.f['쉼']) {
    const raw = String(m.f['쉼'].raw).replace(/\s*초$/, '');
    const v = Number(raw);
    if (!(raw !== '' && isFinite(v) && v >= 0)) return { sec: 0, err: `쉼= 값은 0 이상 숫자(초)만 쓸 수 있습니다(「${m.f['쉼'].raw}」) → 쉬지 않습니다` };
    return { sec: Math.min(PAUSE_MAX, v), explicit: true };
  }
  const d = Number(defSec);
  return { sec: (m.kindName === PAUSE_KIND && isFinite(d) && d > 0) ? Math.min(PAUSE_MAX, d) : 0 };
}

/**
 * ⏸ 막간 쉼 — 어느 문장 뒤에 몇 초를 넣나. 카드가 그려지는 조건(문장을 찾음 · 음성 있음)과 같은 조건에서만 넣는다.
 * @returns {{ map: Map<string, number>, list: Array<{id, sec, line}>, total: number, warnings: string[] }}
 */
function pausesOf(project, markers, defSec) {
  const map = new Map(), list = [], warnings = [];
  if (!project || !(markers || []).length) return { map, list, total: 0, warnings };
  const sents = sentsOf(project);
  for (const m of markers) {
    const p = pauseFor(m, defSec);
    if (p.err) warnings.push(`📜 화면카드 ${m.line}줄 — ${p.err}`);
    if (!(p.sec > 0)) continue;
    const r = resolveMarker(sents, m); if (r.err) continue;            // 카드가 안 그려지면 쉼도 없다(경고는 plan 이 낸다)
    if (r.idx.some((i) => !sents[i].sound)) continue;
    const id = sents[lastOf(r.idx)].s.id;
    if (map.has(id)) { if (p.sec > map.get(id)) { map.set(id, p.sec); list.find((x) => x.id === id).sec = p.sec; } continue; }   // 같은 문장에 두 카드 — 긴 쪽 하나
    map.set(id, p.sec); list.push({ id, sec: p.sec, line: m.line });
  }
  return { map, list, total: list.reduce((a, x) => a + x.sec, 0), warnings };
}
/** 쉼을 넣은 시각으로 본 프로젝트 사본(문장 객체만 새로 · 원본 불변) — 시각을 계산하는 곳(정보 카드·챕터)에 넘긴다 */
function withPauses(project, map) {
  if (!project || !map || !map.size) return project;
  const sentences = (project.sentences || []).map((s) => (map.has(s.id) && s.ttsAudioPath && s.ttsDurationSec > 0 ? { ...s, ttsDurationSec: s.ttsDurationSec + map.get(s.id) } : s));
  return { ...project, sentences };
}

/**
 * 카드 계획 — 마커 + 프로젝트(문장·그룹·음성 길이) → 카드 목록 + 경고.
 *   시간은 .vrew 타임라인과 같은 규칙(fx-overlay.planOf): 그룹 순서대로, 각 그룹의 문장 중 음성(ttsDurationSec)이 있는 것을 이어 붙인다.
 *   opts.pauseSec = 채널 「막간 쉼(초)」 — 쉼이 붙은 카드는 무음 끝까지 뜨고(t1) pauseSec 를 단다(렌더가 그 구간 자막을 가린다).
 * @returns {{cards: Array<{kind, t0, t1, orig: string[], trans: string[], line:number, pauseSec?:number}>, warnings: string[], pauses: object}}
 */
function plan(project, markers, opts = {}) {
  const warnings = [], cards = [];
  const list = (markers || []);
  if (!list.length || !project) return { cards, warnings, pauses: { map: new Map(), list: [], total: 0, warnings: [] } };
  const pz = pausesOf(project, list, opts.pauseSec);
  warnings.push(...pz.warnings);
  // 문장 목록(대본 순서) + 그룹 이름 + 시각(쉼 포함)
  const sents = sentsOf(project); let t = 0;
  for (const x of sents) { const p = x.sound ? (pz.map.get(x.s.id) || 0) : 0; const u = padOf(x.s); x.t0 = t; x.t1 = t + x.d + p; x.pause = p; t = x.t1 + u; }   // 🕳 빈 클립은 카드 시각을 뒤로 민다(카드 자체는 안 늘린다)
  for (const m of list) {
    const tag = `📜 화면카드 ${m.line}줄`;
    const bad = (why) => warnings.push(`${tag} — ${why} → 이 카드만 건너뜁니다`);
    // 🙈 `자막=숨김` — 이 카드가 뜨는 동안만 아래 자막(낭독 글)을 가린다(카드 글과 겹쳐 보이지 않게 · 기본 = 안 가림). 다른 값은 경고하고 자막은 그대로 둔다.
    let hide = false;
    if (m.kind && m.f['자막']) { if (/^(숨김|숨기기|끔|off)$/i.test(m.f['자막'].raw)) hide = true; else warnings.push(`${tag} — 자막= 값은 「숨김」만 쓸 수 있습니다(「${m.f['자막'].raw}」) → 자막은 그대로 보입니다`); }
    const r = resolveMarker(sents, m);
    if (r.err) { bad(r.err); continue; }
    const rows = r.idx.map((i) => sents[i]);
    let card;
    // 🅱 `때=` 꼴 — 글자는 적은 그대로 · 낭독 문장은 시간만
    if (r.literal) {
      const lines = (a) => String(a.raw).split(/\s+\/\/\s+/).map((x) => x.trim()).filter(Boolean);
      if (rows.some((x) => !x.sound)) { bad('때 로 가리킨 문장 중 음성이 없는 문장이 있습니다(TTS 를 먼저)'); continue; }
      const t0 = rows[0].t0, t1 = rows[rows.length - 1].t1;
      if (!(t1 - t0 >= MIN_SPAN)) { bad(`카드가 뜨는 시간이 너무 짧습니다(${(t1 - t0).toFixed(1)}초)`); continue; }
      const own = rows.map((x) => x.text);
      if (m.kind === 'pair') {
        const orig = m.f['원문'] ? lines(m.f['원문']) : [], trans = m.f['번역'] ? lines(m.f['번역']) : own;
        if (m.f['원문'] && !orig.length) { bad('원문= 칸이 비어 있습니다'); continue; }
        if (m.f['번역'] && !trans.length) { bad('번역= 칸이 비어 있습니다'); continue; }
        card = { kind: 'pair', t0, t1, orig, trans, line: m.line, literal: true };
      } else {
        const title = m.f['제목'] ? lines(m.f['제목']) : own;
        if (m.f['제목'] && !title.length) { bad('제목= 칸이 비어 있습니다'); continue; }
        card = { kind: 'interlude', t0, t1, orig: [], trans: title, line: m.line, literal: true };
      }
      if (card.orig.length > 3 || card.trans.length > 3) warnings.push(`${tag} — 카드 글이 3줄을 넘습니다(화면에 넘칠 수 있음)`);
    } else {
      if (rows.some((x) => !x.sound)) { bad('가리킨 문장 중 음성이 없는 문장이 있습니다(TTS 를 먼저)'); continue; }
      const t0 = Math.min(...rows.map((x) => x.t0)), t1 = Math.max(...rows.map((x) => x.t1));
      if (!(t1 - t0 >= MIN_SPAN)) { bad(`카드가 뜨는 시간이 너무 짧습니다(${(t1 - t0).toFixed(1)}초)`); continue; }
      card = m.kind === 'pair'
        ? { kind: 'pair', t0, t1, orig: r.by['원문'].map((i) => sents[i].text), trans: r.by['번역'].map((i) => sents[i].text), line: m.line }
        : { kind: 'interlude', t0, t1, orig: [], trans: r.by['문장'].map((i) => sents[i].text), line: m.line };
    }
    { const endRow = sents[lastOf(r.idx)]; if (endRow.pause > 0 && Math.abs(endRow.t1 - card.t1) < 1e-6) card.pauseSec = endRow.pause; }   // ⏸ 카드 끝에 쉼이 붙었다 — 렌더가 [t1-쉼, t1] 자막을 가린다
    if (hide) card.hideCaptions = true;
    card.label = m.kindName; { const L = langOf(rows); if (L) card.lang = L; }
    const clash = cards.find((c) => card.t0 < c.t1 - 1e-6 && card.t1 > c.t0 + 1e-6);
    if (clash) warnings.push(`${tag} — ${clash.line}줄 카드와 시간이 겹칩니다(둘 다 그립니다)`);
    cards.push(card);
  }
  cards.sort((a, b) => a.t0 - b.t0);
  return { cards, warnings, pauses: pz };
}

/**
 * 🗂 대본 보기(② 클립 칸)용 — 문장마다 카드 자리. 소리 없이도 맞춘다(TTS 전에도 보인다).
 * @returns {{ bySid: Map<string, {label, role:'start'|'cont', last:boolean, line:number, tip:string, pause:number|null, interlude:boolean}>, bad: string[] }}
 *   pause = 칸 `쉼=` 값(없으면 null — 화면이 채널 「막간 쉼」을 막간에만 더한다)
 */
function marksBySentence(project, markers) {
  const bySid = new Map(), bad = [];
  if (!project || !(markers || []).length) return { bySid, bad };
  const sents = sentsOf(project);
  for (const m of markers) {
    const r = resolveMarker(sents, m);
    if (r.err) { bad.push(`📜 화면카드 ${m.line}줄 — ${r.err}`); continue; }
    const p = m.f['쉼'] ? pauseFor(m, 0) : null;
    const tipLines = [`📜 ${m.kindName} · 대본 ${m.line}줄`];
    for (const k of ['제목', '원문', '번역']) if (m.f[k]) tipLines.push(`${k}: ${String(m.f[k].raw).split(/\s+\/\/\s+/).join(' / ')}`);
    if (!r.literal || !(m.f['제목'] || m.f['번역'])) tipLines.push('글: 가리킨 문장 그대로');
    if (m.f['자막'] && /^(숨김|숨기기|끔|off)$/i.test(m.f['자막'].raw)) tipLines.push('🙈 뜨는 동안 자막 숨김');
    const order = [...new Set(r.idx)].sort((a, b) => a - b), last = lastOf(r.idx);
    order.forEach((i, k) => {
      const id = sents[i].s.id; if (bySid.has(id) && bySid.get(id).role === 'start') return;   // 먼저 시작한 카드 표시를 지킨다
      bySid.set(id, { label: m.kindName, role: k === 0 ? 'start' : 'cont', last: i === last, line: m.line, tip: tipLines.join('\n'),
        pause: p ? (p.err ? 0 : p.sec) : null, interlude: m.kindName === PAUSE_KIND });
    });
  }
  return { bySid, bad };
}

/** 카드의 보임 정도 0~1 (시각 t · 초) — 서서히 나타남 · 유지 · 서서히 사라짐 */
function fadeOf(c) { return Math.max(0.3, Math.min(MAX_FADE, (c.t1 - c.t0) / 4)); }
function opacityAt(c, t) {
  const f = fadeOf(c);
  if (t <= c.t0) return 0; if (t >= c.t1) return 0;
  if (t < c.t0 + f) return (t - c.t0) / f;
  if (t > c.t1 - f) return (c.t1 - t) / f;
  return 1;
}

module.exports = { PAD, normPad, padOf, KINDS, MIN_KEY, PAUSE_MAX, norm, anchorOf, markersOf, signatureOf, plan, pausesOf, withPauses, marksBySentence, fadeOf, opacityAt };
