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
 *   · 조용히 줄이지 않는다 — 문장을 못 찾음 · 둘 이상 맞음 · 앞부분이 짧음 · 종류 모름 · 음성 없음 → 경고 줄을 돌려주고 **그 카드만** 건너뛴다.
 * 마커가 하나도 없으면 아무것도 안 한다(기본값 = 예전 출력과 한 글자도 다르지 않다).
 *
 * main·렌더 전용이 아니다 — 순수 함수라 테스트가 그대로 부른다(core/*.js 는 렌더러 번들에 들어갈 수 있으니 fs·require.main 을 쓰지 않는다).
 */
const KINDS = { '병기': 'pair', '막간': 'interlude' };
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

/**
 * 카드 계획 — 마커 + 프로젝트(문장·그룹·음성 길이) → 카드 목록 + 경고.
 *   시간은 .vrew 타임라인과 같은 규칙(fx-overlay.planOf): 그룹 순서대로, 각 그룹의 문장 중 음성(ttsDurationSec)이 있는 것을 이어 붙인다.
 * @returns {{cards: Array<{kind, t0, t1, orig: string[], trans: string[], line:number}>, warnings: string[]}}
 */
function plan(project, markers) {
  const warnings = [], cards = [];
  const list = (markers || []);
  if (!list.length || !project) return { cards, warnings };
  const byId = new Map((project.sentences || []).map((s) => [s.id, s]));
  // 문장 목록(대본 순서) + 그룹 이름 + 시각
  const sents = []; let t = 0;
  for (const g of (project.groups || [])) {
    for (const id of (g.sentenceIds || [])) {
      const s = byId.get(id); if (!s) continue;
      const d = (s.ttsAudioPath && s.ttsDurationSec > 0) ? s.ttsDurationSec : 0;
      sents.push({ s, text: String(s.text || ''), key: norm(s.text), phase: norm(g.phase || g.title || ''), t0: t, t1: t + d, sound: d > 0 });
      t += d;
    }
  }
  const find = (m, a, label) => {
    const k = norm(a.text);
    if (k.length < MIN_KEY) return { err: `${label} 앞부분이 너무 짧습니다(공백·문장부호 빼고 ${MIN_KEY}글자 이상) — 「${a.text}」` };
    const hd = norm(m.heading);
    const all = sents.map((x, i) => (x.key.startsWith(k) ? i : -1)).filter((i) => i >= 0);
    const scoped = hd ? all.filter((i) => sents[i].phase === hd) : [];
    const use = scoped.length ? scoped : all;   // 그룹 이름이 안 맞으면(분할 방식에 따라 다름) 대본 전체에서 찾는다
    if (!use.length) return { err: `${label} 문장을 찾지 못했습니다 — 「${a.text}」 로 시작하는 낭독 문장이 없습니다` };
    if (use.length > 1) return { err: `${label} 문장이 ${use.length}개 맞습니다 — 앞부분을 더 길게 써 주세요(「${a.text}」)` };
    return { i: use[0] };
  };
  const take = (i, extra, label) => {
    const out = [];
    for (let k = i; k <= i + extra; k++) { if (!sents[k]) return { err: `${label} 뒤로 ${extra}문장을 이을 수 없습니다(대본이 끝남)` }; out.push(sents[k]); }
    return { rows: out };
  };
  for (const m of list) {
    const tag = `📜 화면카드 ${m.line}줄`;
    const bad = (why) => warnings.push(`${tag} — ${why} → 이 카드만 건너뜁니다`);
    if (!m.kind) { bad(`종류 「${m.kindName}」 를 모릅니다(병기 · 막간)`); continue; }
    // 🅱 `때=` 꼴 — 글자는 적은 그대로 · 낭독 문장은 시간만
    if (m.f['때']) {
      const lines = (a) => String(a.raw).split(/\s+\/\/\s+/).map((x) => x.trim()).filter(Boolean);
      const r = find(m, m.f['때'], '때'); if (r.err) { bad(r.err); continue; }
      const tk = take(r.i, m.f['때'].extra, '때'); if (tk.err) { bad(tk.err); continue; }
      if (tk.rows.some((x) => !x.sound)) { bad('때 로 가리킨 문장 중 음성이 없는 문장이 있습니다(TTS 를 먼저)'); continue; }
      const t0 = tk.rows[0].t0, t1 = tk.rows[tk.rows.length - 1].t1;
      if (!(t1 - t0 >= MIN_SPAN)) { bad(`카드가 뜨는 시간이 너무 짧습니다(${(t1 - t0).toFixed(1)}초)`); continue; }
      const own = tk.rows.map((x) => x.text);
      let card;
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
      const clash = cards.find((c) => card.t0 < c.t1 - 1e-6 && card.t1 > c.t0 + 1e-6);
      if (clash) warnings.push(`${tag} — ${clash.line}줄 카드와 시간이 겹칩니다(둘 다 그립니다)`);
      cards.push(card);
      continue;
    }
    if (m.f['제목'] && !m.f['문장']) { bad('제목= 은 때= 와 함께 써야 합니다(때=<낭독 문장 앞부분>)'); continue; }
    const need = m.kind === 'pair' ? ['원문', '번역'] : ['문장'];
    const miss = need.filter((k) => !m.f[k]);
    if (miss.length) { bad(`${miss.join('·')}= 칸이 없습니다`); continue; }
    const groupsOf = {};
    let failed = false;
    for (const k of need) {
      const r = find(m, m.f[k], k); if (r.err) { bad(r.err); failed = true; break; }
      const tk = take(r.i, m.f[k].extra, k); if (tk.err) { bad(tk.err); failed = true; break; }
      groupsOf[k] = tk.rows;
    }
    if (failed) continue;
    const all = need.flatMap((k) => groupsOf[k]);
    if (all.some((x) => !x.sound)) { bad('가리킨 문장 중 음성이 없는 문장이 있습니다(TTS 를 먼저)'); continue; }
    const t0 = Math.min(...all.map((x) => x.t0)), t1 = Math.max(...all.map((x) => x.t1));
    if (!(t1 - t0 >= MIN_SPAN)) { bad(`카드가 뜨는 시간이 너무 짧습니다(${(t1 - t0).toFixed(1)}초)`); continue; }
    const card = m.kind === 'pair'
      ? { kind: 'pair', t0, t1, orig: groupsOf['원문'].map((x) => x.text), trans: groupsOf['번역'].map((x) => x.text), line: m.line }
      : { kind: 'interlude', t0, t1, orig: [], trans: groupsOf['문장'].map((x) => x.text), line: m.line };
    const clash = cards.find((c) => card.t0 < c.t1 - 1e-6 && card.t1 > c.t0 + 1e-6);
    if (clash) warnings.push(`${tag} — ${clash.line}줄 카드와 시간이 겹칩니다(둘 다 그립니다)`);
    cards.push(card);
  }
  cards.sort((a, b) => a.t0 - b.t0);
  return { cards, warnings };
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

module.exports = { KINDS, MIN_KEY, norm, anchorOf, markersOf, signatureOf, plan, fadeOf, opacityAt };
