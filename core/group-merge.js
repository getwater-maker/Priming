/**
 * group-merge.js — 그룹을 앞 그룹에 합친다 = 「여기부터 저기까지 같은 그림」.
 *   (로이 2026-09-24: "어디에서 어디까지 1번 이미지 또는 비디오 … 설정할 수 있으면 좋겠다")
 *
 * 두 경로가 같은 함수를 쓴다(두 벌이면 한쪽만 고쳐져 조용히 갈라진다):
 *   ① 화면 — 그룹의 「⤒ 합치기」 버튼(main IPC 'merge-group')
 *   ② 대본 — H3 아래 `> 🖼️ 이미지: 이어서` (파싱 직후 applyContinueMarkers)
 *
 * 🔑 합치면 **앞 그룹의 그림·영상·프롬프트가 이긴다** — 앞 그림이 「처음부터 끝까지」 이어지는 것이 목적이다.
 *    앞 그룹에 없을 때만 뒤 그룹 것을 가져온다.
 * 🔑 챕터를 잃지 않는다 — 유튜브 타임스탬프는 그룹의 H2(없으면 H3) 제목으로 챕터를 나누는데, 합치면
 *    뒤 그룹의 제목이 사라진다. 그래서 뒤 그룹의 첫 문장에 `chapterMark = {h2, phase}` 를 남긴다
 *    (렌더러 tsChaptersOf 가 그 문장에서 챕터를 가른다). 그룹 인덱스가 아니라 **문장에** 두는 이유:
 *    문장 편집(나누기·합치기)이 그룹 안 위치를 바꿔도 표식이 문장을 따라간다.
 * ⚠ 도입부(isIntro)와 본론 경계는 넘지 않는다 — 도입부는 영상 범위 기본값·도입부 재배치의 기준이다.
 * 이 모듈은 **파일을 만지지 않는다**(미디어 파일 번호 정리는 main 의 renumberMediaFiles 몫).
 */

const { finalizeGroupIds } = require('./project-model');

// `> 🖼️ 이미지: 이어서` — 앞 그룹 그림을 이어 쓴다. 괄호·마침표·영문 표기도 받는다.
const CONTINUE_RE = /^\s*[(（\[]?\s*(이어서|이어짐|계속|앞과\s*같음|앞\s*그림|같은\s*그림|↑|continue|same)\s*[)）\]]?\s*[.。]?\s*$/i;

function isContinueMarker(prompt) {
  return typeof prompt === 'string' && CONTINUE_RE.test(prompt);
}

/**
 * project.groups[idx] 를 [idx-1] 에 합친다.
 * @returns {{ok:boolean, reason?:string, into?:object}}
 */
function mergeIntoPrev(project, idx) {
  if (!project || !Array.isArray(project.groups)) return { ok: false, reason: 'no-project' };
  if (!(idx > 0 && idx < project.groups.length)) return { ok: false, reason: idx === 0 ? 'no-prev' : 'not-found' };
  const cur = project.groups[idx];
  const prev = project.groups[idx - 1];
  if (!!cur.isIntro !== !!prev.isIntro) return { ok: false, reason: 'cross-intro' };

  // 챕터 표식 — 뒤 그룹의 첫 문장에(이미 표식이 있으면 그대로 둔다: 연쇄 합치기)
  const sMap = new Map((project.sentences || []).map((s) => [s.id, s]));
  const first = sMap.get(cur.sentenceIds[0]);
  if (first && !first.chapterMark && (cur.h2Title || cur.phase)) {
    first.chapterMark = { h2: cur.h2Title || null, phase: cur.phase || cur.title || null };
  }

  prev.sentenceIds = [...prev.sentenceIds, ...cur.sentenceIds];
  // 앞 그룹이 이긴다 — 없을 때만 뒤 그룹 것을 가져온다
  if (!prev.imagePrompt && cur.imagePrompt && !isContinueMarker(cur.imagePrompt)) prev.imagePrompt = cur.imagePrompt;
  if (!prev.videoPrompt && cur.videoPrompt) prev.videoPrompt = cur.videoPrompt;
  if (!prev.motionNote && cur.motionNote) prev.motionNote = cur.motionNote;
  if (!prev.imagePath && cur.imagePath) { prev.imagePath = cur.imagePath; prev.imageStatus = cur.imageStatus || prev.imageStatus; if (cur._userImage) prev._userImage = cur._userImage; }
  if (!prev.videoPath && cur.videoPath) { prev.videoPath = cur.videoPath; prev.videoStatus = cur.videoStatus || prev.videoStatus; if (cur._userVideo) prev._userVideo = cur._userVideo; }
  prev.isI2V = !!prev.videoPrompt; prev.mode = prev.isI2V ? 'i2v' : 'motion';

  project.groups.splice(idx, 1);
  project.groups.forEach((g, i) => { g.num = i + 1; });
  finalizeGroupIds(project.groups, project.sentences || []);
  return { ok: true, into: project.groups[idx - 1] };
}

/**
 * 대본의 `> 🖼️ 이미지: 이어서` 를 적용한다 — 그 그룹을 앞 그룹에 합친다.
 * 합칠 수 없는 경우(첫 그룹 · 도입부/본론 경계)엔 표식을 지워 빈 프롬프트로 둔다(✍ 자동 작성 대상).
 * @returns {{merged:number, skipped:Array<{num:number, reason:string}>}}
 */
function applyContinueMarkers(project) {
  const out = { merged: 0, skipped: [] };
  if (!project || !Array.isArray(project.groups)) return out;
  let i = 0;
  while (i < project.groups.length) {
    const g = project.groups[i];
    if (!isContinueMarker(g.imagePrompt)) { i++; continue; }
    const num = g.num;
    g.imagePrompt = null;   // 표식은 프롬프트가 아니다 — 남기면 이미지 엔진이 「이어서」를 그리려 한다
    const r = mergeIntoPrev(project, i);
    if (r.ok) { out.merged++; continue; }   // 같은 i 에 다음 그룹이 당겨져 왔다
    out.skipped.push({ num, reason: r.reason });
    i++;
  }
  return out;
}

/**
 * 🖼 적용 범위 — groups[idx] 의 그림이 **문장 a~b(편 전체 순번, 0부터)** 를 덮게 한다(Vrew 「적용 범위 변경」).
 *   그림의 범위 = 그룹 경계이므로, 범위를 바꾸는 일은 그룹 경계를 다시 긋는 일이다.
 *   · 범위에 들어온 다른 그룹 문장은 이 그룹으로 온다. 그 그룹은 **남은 문장으로 줄어들고 자기 그림을 그대로** 쓴다
 *     (Vrew 에서 이웃 그림의 범위가 줄어드는 것과 같다). 통째로 덮인 그룹은 사라진다(removed 로 돌려준다).
 *   · 이 그룹에서 범위 밖으로 떨어져 나간 문장은 **새 그룹(그림·프롬프트 없음 = 새 이미지 필요)** — 로이 결정 1ⓐ.
 *   · 도입부·본론 경계도 넘는다 — 로이 결정 2ⓐ. 합친 그룹의 도입부 여부는 **범위 주인**을 따른다.
 *   · 챕터: 그룹 첫 문장이 남의 그룹 안으로 들어가면 그 문장에 chapterMark 를 남긴다(mergeIntoPrev 와 같은 규칙).
 * ⚠ 범위는 이 그룹의 원래 문장과 겹쳐야 한다(안 겹치면 다른 그룹의 앞·뒤가 동시에 잘려 둘로 쪼개진다).
 * @returns {{ok:boolean, reason?:string, removed?:object[], orphans?:number, into?:object}}
 */
function _regroupRange(project, idx, a, b) {
  if (!project || !Array.isArray(project.groups)) return { ok: false, reason: 'no-project' };
  const G = project.groups[idx];
  if (!G) return { ok: false, reason: 'not-found' };
  const sMap = new Map((project.sentences || []).map((s) => [s.id, s]));
  // 편 전체 문장 순서 + 각 문장이 속한 「섹션」(챕터 제목) — 경계를 다시 그어도 챕터는 그대로 남아야 한다
  const order = [], pos = new Map(), label = new Map(), secStart = new Set();
  for (const g of project.groups) {
    let cur = { h2: g.h2Title || null, phase: g.phase || g.title || null };
    g.sentenceIds.forEach((id, i) => {
      const s = sMap.get(id);
      if (i === 0) secStart.add(id);
      else if (s && s.chapterMark) { cur = { h2: s.chapterMark.h2 || null, phase: s.chapterMark.phase || null }; secStart.add(id); }
      pos.set(id, order.length); order.push(id); label.set(id, cur);
    });
  }
  const n = order.length;
  a = Math.floor(Number(a)); b = Math.floor(Number(b));
  if (!(a >= 0 && b >= a && b < n)) return { ok: false, reason: 'bad-range' };
  const gs = pos.get(G.sentenceIds[0]);
  const ge = gs + G.sentenceIds.length - 1;
  if (b < gs || a > ge) return { ok: false, reason: 'no-overlap' };
  if (a === gs && b === ge) return { ok: true, removed: [], orphans: 0, into: G, unchanged: true };

  const { Group } = require('./project-model');
  const mkOrphan = (ids, from) => {
    const ng = new Group({ num: 0, sentenceIds: ids });
    ng.isIntro = !!from.isIntro; if (from.isBracket) ng.isBracket = true;
    ng.imagePrompt = null; ng.videoPrompt = null; ng.motionNote = null;
    ng.imagePath = null; ng.videoPath = null; ng.imageStatus = null; ng.videoStatus = null;
    ng.isI2V = false; ng.mode = 'motion'; ng.imageStale = true;   // 화면에 「새 이미지 필요」
    return ng;
  };
  const out = [], removed = [];
  let orphans = 0;
  for (const g of project.groups) {
    if (g === G) {
      const before = G.sentenceIds.filter((id) => pos.get(id) < a);
      const after = G.sentenceIds.filter((id) => pos.get(id) > b);
      if (before.length) { out.push(mkOrphan(before, G)); orphans++; }
      if (!out.includes(G)) out.push(G);
      if (after.length) { out.push(mkOrphan(after, G)); orphans++; }
      continue;
    }
    const keep = g.sentenceIds.filter((id) => { const k = pos.get(id); return k < a || k > b; });
    if (!keep.length) { removed.push(g); continue; }
    // G 뒤의 그룹이 앞부분을 잃었다 → 그 앞에 G 가 와야 한다
    if (pos.get(keep[0]) > b && pos.get(g.sentenceIds[0]) <= b && !out.includes(G)) out.push(G);
    g.sentenceIds = keep;
    out.push(g);
  }
  if (!out.includes(G)) {
    // G 가 통째로 뒤쪽 범위로 밀려 위 루프에서 자리를 못 잡은 경우 — 위치 순으로 끼운다
    const k = out.findIndex((g) => pos.get(g.sentenceIds[0]) > a);
    out.splice(k < 0 ? out.length : k, 0, G);
  }
  G.sentenceIds = order.slice(a, b + 1);
  // 그룹 머리 문장 = 그 섹션 제목을 그룹 제목으로, 그 밖에서 섹션이 시작되는 문장엔 챕터 표식
  for (const g of out) {
    g.sentenceIds.forEach((id, i) => {
      const s = sMap.get(id); if (!s) return;
      const lb = label.get(id) || { h2: null, phase: null };
      if (i === 0) {
        g.h2Title = lb.h2; g.phase = lb.phase; g.title = lb.phase;
        s.chapterMark = undefined;
      } else if (secStart.has(id)) {
        s.chapterMark = { h2: lb.h2, phase: lb.phase };
      } else if (s.chapterMark) s.chapterMark = undefined;
    });
  }
  out.sort((x, y) => pos.get(x.sentenceIds[0]) - pos.get(y.sentenceIds[0]));
  project.groups.splice(0, project.groups.length, ...out);
  project.groups.forEach((g, i) => { g.num = i + 1; });
  finalizeGroupIds(project.groups, project.sentences || []);
  return { ok: true, removed, orphans, into: G };
}

/**
 * 🖼 적용 범위 — v0.5.47 부터 **늘리면 겹쳐 깐다**(로이: "앞 그룹은 하위층, 다음 그룹은 상위층으로 — 지우지 않고").
 *   · 자기 그룹 밖으로 늘린 쪽 = g.visSpan(core/visual-span) — 그 문장들 동안 이 그림이 **아래층**으로 계속 보인다.
 *     그 사이 그룹들은 그대로 남고 자기 그림이 있으면 그 위에, 없으면 이 그림이 보인다. 아무것도 지우지 않는다.
 *   · 자기 그룹 안으로 줄인 쪽 = 예전처럼 떨어진 문장이 새 그룹(새 이미지 필요 — 결정 1ⓐ).
 * @returns {{ok, reason?, removed:[], orphans, into, unchanged?}}
 */
function setVisualRange(project, idx, a, b) {
  if (!project || !Array.isArray(project.groups)) return { ok: false, reason: 'no-project' };
  const G = project.groups[idx];
  if (!G) return { ok: false, reason: 'not-found' };
  const order = []; for (const g of project.groups) for (const id of g.sentenceIds) order.push(id);
  const n = order.length;
  a = Math.floor(Number(a)); b = Math.floor(Number(b));
  if (!(a >= 0 && b >= a && b < n)) return { ok: false, reason: 'bad-range' };
  const gs = order.indexOf(G.sentenceIds[0]), ge = gs + G.sentenceIds.length - 1;
  if (b < gs || a > ge) return { ok: false, reason: 'no-overlap' };
  const before = JSON.stringify(G.visSpan || null);
  let r = { ok: true, removed: [], orphans: 0, into: G, unchanged: true };
  const oa = Math.max(a, gs), ob = Math.min(b, ge);
  if (oa !== gs || ob !== ge) { r = _regroupRange(project, project.groups.indexOf(G), oa - 0, ob); if (!r.ok) return r; }
  const sp = { startId: a < gs ? order[a] : null, endId: b > ge ? order[b] : null };
  G.visSpan = (sp.startId || sp.endId) ? sp : undefined;
  const changed = !r.unchanged || before !== JSON.stringify(G.visSpan || null);
  return { ok: true, removed: [], orphans: r.orphans || 0, into: G, unchanged: !changed };
}

module.exports = { mergeIntoPrev, applyContinueMarkers, isContinueMarker, CONTINUE_RE, setVisualRange };
