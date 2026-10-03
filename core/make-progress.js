'use strict';
// 📊 롱폼 「⚡ 만들기」 진행 팝업 — 지금 만드는 대본의 문장·그림·영상 개수를 센다(v0.6.44 · 로이 2026-10-02).
//   main 의 runMakeAllCore 가 1초마다 snapshot() 을 불러 'make-progress' 로 보낸다. 화면(MakeProgress.jsx)은 표시만 한다.
//   🔑 **메모리의 경로 필드만 본다(fs 를 건드리지 않는다)** — 1초마다 수백 개를 existsSync 하면 G: 스트리밍 드라이브에서
//     메인 프로세스가 굳는다(CLAUDE.md §6 「동기 호출 금지」). 표시용이라 파일 실재는 4단계 게이트가 따로 확인한다.
//   ⚠ 이 파일은 렌더러 번들에 들어가지 않지만 core/ 규칙(CJS 런타임 자기검사 금지)을 그대로 지킨다.

const VS = require('./video-select');
const STAGES = ['tts', 'image', 'video', 'out'];

// 문장 하나가 음성을 가졌는가 — 합성이 끝나면 경로와 길이가 함께 채워진다.
function sentDone(s) { return !!(s && s.ttsAudioPath && s.ttsDurationSec != null); }

// 그림이 필요한 그룹 — missingVisualGroups 와 같은 기준(프롬프트가 있거나, 범위를 줄여 떨어져 나온 그룹).
function needsVisual(g) { return !!((g.imagePrompt && String(g.imagePrompt).trim()) || g.imageStale); }
function visualDone(g) { return !!((g.imagePath && !g.imageStale) || g.videoPath); }

function clip(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; }

// 셈 — projects 는 runMakeAllCore 가 고정해 둔 이 대본의 편들(S.parsed 아님 — 큐에서 다른 대본을 봐도 섞이지 않게).
function count(projects, { fromNum = null, toNum = null, sel = '' } = {}) {
  const sent = { done: 0, total: 0, cur: null };
  const image = { done: 0, total: 0, active: [] };
  const video = { done: 0, total: 0, active: [] };
  for (const pr of projects || []) {
    const inVid = VS.matcher(pr.groups || [], sel, fromNum, toNum);   // 🎬 범위 또는 방식
    for (const s of pr.sentences || []) {
      sent.total++;
      if (sentDone(s)) sent.done++;
      else if (!sent.cur) sent.cur = { num: s.num, text: clip(s.text, 40) };   // 음성은 순서대로 만든다 → 첫 빈 문장 = 지금 만드는 문장
    }
    for (const g of pr.groups || []) {
      if (needsVisual(g)) {
        image.total++;
        if (visualDone(g)) image.done++;
        else if (g.imageStatus === 'generating') image.active.push(g.num);
      }
      if (inVid(g.num)) {
        video.total++;
        if (g.videoPath) video.done++;
        else if (g.videoStatus === 'generating' || g.videoStatus === 'upscaling') video.active.push(g.num);
      }
    }
  }
  return { sent, image, video };
}

// 진행 상태 하나(main 이 들고 있다)를 만들고 단계마다 고친다.
function create({ title = '', queue = null, skip = {} } = {}) {
  const now = Date.now();
  const stages = {};
  for (const k of STAGES) stages[k] = { state: skip[k] ? 'skip' : 'wait', note: skip[k] || '', startedAt: null, endedAt: null, doneAtStart: 0 };
  return { title, queue, phase: 'running', startedAt: now, endedAt: null, stages, outNote: '' };
}

// 단계 시작·끝 — 시작 때의 완료 수를 적어 둬야 「이번에 만든 속도」로 남은 시간을 셀 수 있다(이어받은 것은 빼고).
function begin(st, key, doneNow = 0) {
  const x = st && st.stages[key]; if (!x || x.state === 'skip') return;
  x.state = 'run'; x.startedAt = Date.now(); x.doneAtStart = doneNow;
}
function end(st, key) {
  const x = st && st.stages[key]; if (!x || x.state === 'skip') return;
  if (x.state === 'run' || x.state === 'wait') { x.state = 'done'; x.endedAt = Date.now(); }
}
function skipStage(st, key, note) {
  const x = st && st.stages[key]; if (!x) return;
  x.state = 'skip'; x.note = note || x.note || '';
}

// 남은 시간 — 이번 단계에서 새로 만든 개수의 속도로. 2개 이상 만들기 전에는 내지 않는다(첫 개는 준비 시간이 섞인다).
function eta(stage, c, now) {
  if (!stage || stage.state !== 'run' || !stage.startedAt) return 0;
  const made = c.done - (stage.doneAtStart || 0);
  const left = c.total - c.done;
  if (made < 2 || left <= 0) return 0;
  return ((now - stage.startedAt) / made) * left;
}

function snapshot(st, projects, range) {
  const now = Date.now();
  const c = count(projects, range);
  return {
    title: st.title, queue: st.queue, phase: st.phase,
    startedAt: st.startedAt, endedAt: st.endedAt, now,
    stages: JSON.parse(JSON.stringify(st.stages)),
    outNote: st.outNote || '',
    sent: { ...c.sent, eta: eta(st.stages.tts, c.sent, now) },
    image: { ...c.image, eta: eta(st.stages.image, c.image, now) },
    video: { ...c.video, eta: eta(st.stages.video, c.video, now) },
  };
}

module.exports = { STAGES, count, create, begin, end, skipStage, snapshot, eta, sentDone, visualDone, needsVisual };
