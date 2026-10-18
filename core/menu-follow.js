'use strict';
// 🧭 리본 메뉴(대본·음성 / 이미지 / 비디오 / 완성) 따라가기 — 지금 돌아가는 작업에 맞는 메뉴 id 를 고른다(v0.9.72 · 로이 2026-10-18).
//   순수 함수 — 화면(App.jsx)이 진행 정보를 넘기고 메뉴를 바꾸는 것만 한다.
//   🔑 기준(동시에 여러 작업이 돌 때): 완성(MP4 굽기·업로드·4단계) > 비디오 > 이미지 > 대본·음성.
//     · 뒤 단계가 돌고 있다 = 앞 단계는 이미 끝났거나 뒤로 밀린 상태 → 사람이 지금 기다리는 것은 뒤 단계다.
//     · 완성(MP4·업로드)은 큐의 다음 대본 음성·이미지와 겹쳐 돌 수 있는데, 그때도 완성이 가장 오래·비싸게 걸려 우선이다.
//     · 같은 단계 안에서 대본이 여럿 돌아도 메뉴는 하나라 문제없다.
//   입력: make = main 의 make-progress(stages.{tts,image,video,out}.state) · stage = 단계 버튼 {phase} ·
//         mp4 / yt = 진행 팝업 정보({phase}) — 끝난 phase(done·aborted·error)면 안 돌고 있는 것.

const RANK = ['script', 'image', 'video', 'finish'];   // 클수록 우선
const ENDED = ['done', 'aborted', 'error'];
const STAGE_MENU = { tts: 'script', image: 'image', video: 'video', out: 'finish' };

function liveMenus({ make = null, stage = null, mp4 = null, yt = null } = {}) {
  const on = new Set();
  if (make && make.phase === 'running' && make.stages) {
    for (const k of Object.keys(STAGE_MENU)) if (make.stages[k] && make.stages[k].state === 'run') on.add(STAGE_MENU[k]);
  }
  if (stage && STAGE_MENU[stage.phase]) on.add(STAGE_MENU[stage.phase]);
  if (mp4 && !ENDED.includes(mp4.phase)) on.add('finish');
  if (yt && !ENDED.includes(yt.phase)) on.add('finish');
  return on;
}

// 지금 따라갈 메뉴 id — 돌아가는 작업이 없으면 null(= 메뉴를 건드리지 않는다)
function pick(inp) {
  const on = liveMenus(inp);
  let best = null;
  for (const m of RANK) if (on.has(m)) best = m;
  return best;
}

module.exports = { pick, liveMenus, RANK };
