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

module.exports = { mergeIntoPrev, applyContinueMarkers, isContinueMarker, CONTINUE_RE };
