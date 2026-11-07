'use strict';
// 🩹 화면(렌더러) 프로세스 지킴이 (v1.0.47 · 2026-11-07 로이 「또 백지」)
//   제작 도중 화면 프로세스만 죽으면 본체(main)는 일을 계속하는데 창은 빈 크림색으로 남았다
//   (기록도 다시 띄우기도 없었다 — 같은 날 08:09 시작 → 16:2x 백지 · 렌더러 프로세스 자체가 없었음).
//   판정만 여기 두고(순수 함수 · 시험 가능), 창에 거는 일은 main createWindow 가 한다.

const WINDOW_MS = 3 * 60 * 1000;   // 이 시간 안에
const MAX_RELOADS = 3;             // 이만큼 넘게 죽으면 다시 띄우기를 멈춘다(죽고 띄우고를 끝없이 돌지 않게)

// times = 지난 다시 띄우기 시각 목록(ms) · 돌려줌 { reload, times }
function decide(times, now, reason) {
  if (reason === 'clean-exit') return { reload: false, times: times || [] };   // 창을 닫을 때 = 정상
  const recent = (times || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_RELOADS) return { reload: false, times: recent, gaveUp: true };
  return { reload: true, times: recent.concat(now) };
}

// app.getAppMetrics() → 화면(렌더러) 프로세스 메모리(MB) · 못 찾으면 null
//   Windows 의 memory 값은 KB. privateBytes 가 있으면 그것(실제로 쥔 양), 없으면 workingSetSize.
function rendererMemMB(metrics, pid) {
  const list = Array.isArray(metrics) ? metrics : [];
  const m = list.find((x) => x && (pid ? x.pid === pid : (x.type === 'Tab' || x.type === 'renderer')));
  if (!m || !m.memory) return null;
  const kb = m.memory.privateBytes || m.memory.workingSetSize;
  return kb ? Math.round(kb / 1024) : null;
}

const REASON_KO = {
  'oom': '메모리 부족',
  'crashed': '오류로 종료',
  'killed': '밖에서 강제 종료',
  'abnormal-exit': '비정상 종료',
  'launch-failed': '시작 실패',
  'integrity-failure': '코드 무결성 검사 실패',
  'memory-eviction': '메모리 회수',
};
const reasonKo = (r) => REASON_KO[r] || String(r || '알 수 없음');

module.exports = { decide, rendererMemMB, reasonKo, WINDOW_MS, MAX_RELOADS };
