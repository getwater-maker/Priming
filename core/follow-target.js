'use strict';
/**
 * follow-target.js — 📍 제작 화면 따라가기: 진행 정보 → ① 미리보기·② 클립이 보여 줄 곳(v0.9.43 · 로이 2026-10-16)
 *   로이: 「2번째 대본을 만드는데 화면은 1번째를 보여 준다 · TTS·이미지·비디오가 겹치면 무엇을 기준으로 보여 줄지 세워라」.
 *
 *   기준(한 곳):
 *   - ② 클립 = **지금 음성을 만드는 문장**(sent.cur). TTS 가 끝났으면 그림(없으면 영상)을 만드는 그룹의 첫 문장.
 *       클립 칸은 문장(글·음성)을 보는 곳이다.
 *   - ① 미리보기 = **방금 완성된 그림·영상의 그룹**(영상 > 그림). 아직 완성된 것이 없으면 지금 만드는 그룹.
 *       그림·영상 단계가 없으면(음성만) ② 와 같은 곳. 미리보기는 결과 그림을 확인하는 곳이다.
 *   예) TTS 100번 문장 · 이미지 G2 진행 · G1 완성 → ② = 100번 문장 · ① = G1.
 *
 *   「방금 완성」은 이전 스냅샷과 비교해 만든다(active 에서 빠진 그룹) — 메모리만.
 *   ⚠ core/*.js 는 렌더러 번들에 들어간다 — CJS 런타임 자기검사 금지(CLAUDE.md §7 자막).
 * 테스트: test/follow-target.test.js
 */

/** 이전 상태(prev) + 스냅샷(prog) → 새 상태(다음 호출의 prev) */
function step(prev, prog) {
  const p = prev && prev.itemId === (prog && prog.itemId) ? prev : { itemId: prog && prog.itemId, img: [], vid: [], lastImg: null, lastVid: null };
  const img = ((prog && prog.image && prog.image.active) || []).slice();
  const vid = ((prog && prog.video && prog.video.active) || []).slice();
  const imgSn = prog && prog.image && prog.image.sn != null ? prog.image.sn : null;
  const vidSn = prog && prog.video && prog.video.sn != null ? prog.video.sn : null;
  const doneImg = p.img.filter((g) => !img.includes(g.num)).pop();
  const doneVid = p.vid.filter((g) => !vid.includes(g.num)).pop();
  return {
    itemId: p.itemId,
    img: img.map((num) => ({ num, sn: imgSn })),
    vid: vid.map((num) => ({ num, sn: vidSn })),
    lastImg: doneImg ? { sn: doneImg.sn, group: doneImg.num } : p.lastImg,
    lastVid: doneVid ? { sn: doneVid.sn, group: doneVid.num } : p.lastVid,
  };
}

const running = (st) => !!(st && st.state === 'run');

/** 새 상태(state) + 스냅샷(prog) → { clip, preview } — clip = {sn, ord}|{sn, group}|null · preview = {sn, group}|{sn, ord}|null */
function targets(state, prog) {
  if (!prog) return { clip: null, preview: null };
  const S = prog.stages || {};
  const sent = prog.sent || {};
  const img = (state && state.img) || [], vid = (state && state.vid) || [];
  let clip = null;
  if (running(S.tts) && sent.cur && sent.cur.ord != null) clip = { sn: sent.cur.sn != null ? sent.cur.sn : null, ord: sent.cur.ord };
  else if (img.length) clip = { sn: img[0].sn, group: img[0].num };
  else if (vid.length) clip = { sn: vid[0].sn, group: vid[0].num };
  let preview = (state && (state.lastVid || state.lastImg)) || null;
  if (!preview && img.length) preview = { sn: img[0].sn, group: img[0].num };
  if (!preview && vid.length) preview = { sn: vid[0].sn, group: vid[0].num };
  const visualStage = ['image', 'video'].some((k) => S[k] && S[k].state !== 'skip');
  if (!preview && !visualStage) preview = clip;   // 🎤 음성만 — 미리보기도 지금 문장
  if (!clip && prog.focus) clip = prog.focus;
  if (!preview && prog.focus) preview = prog.focus;
  return { clip, preview };
}

module.exports = { step, targets };
