'use strict';
// 💰 작업큐(롱폼) 전체의 **남은** 이미지·영상 수 세기 — main `queue-media-cost` 가 부른다(v1.0.68).
//   옛 방식은 큐의 모든 대본·모든 그룹을 `fs.existsSync` 로 하나씩, 그것도 markCovered·effRange 안에서
//   같은 그룹을 여러 번 확인했다. 큐 28편에서 한 번에 약 3초 동안 main 이 멈췄고, 화면이 음성 컷마다(≈5초)
//   다시 불러 5초에 3초씩 얼다가 2026-11-21 13:10 「응답 없음」으로 창이 닫혔다(작업노트 2026-11).
//   ⇒ ① 확인할 파일 경로를 먼저 모아 **비동기 stat 으로 한 번씩만** 확인 → ② 같은 판정 규칙을 메모리 집합으로 돌린다
//      ③ 대본 사이마다 이벤트 루프에 양보한다 · ④ 이미 도는 셈이 있으면 그 결과를 같이 받는다(main 쪽).
//   ⛔ 이 파일에서 동기 fs 를 쓰지 않는다(test:qmedia 가 소스를 센다).

const fsp = require('fs').promises;

const yieldLoop = () => new Promise((r) => setImmediate(r));

/** 경로 목록 → 있는 파일 집합(비동기 · 동시 limit 개) */
async function existingSet(paths, { limit = 16, statFn } = {}) {
  const st = statFn || ((p) => fsp.stat(p));
  const list = [...new Set(paths.filter(Boolean))];
  const ok = new Set();
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const p = list[i++];
      try { await st(p); ok.add(p); } catch {}
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return ok;
}

/**
 * items: 큐 항목들({id, scriptPath, parsed, settings})
 * opts: { wantVid, markCovered(project, hasVisual), matcher(groups, sel), normSel, basename, statFn }
 * 반환 { items: [{id, name, img, vid}] } — 옛 핸들러와 같은 값
 */
async function countQueueMedia(items, opts = {}) {
  const { wantVid = false, markCovered, matcher, normSel, basename } = opts;
  const paths = [];
  for (const it of items || []) {
    const ps = it && it.parsed && it.parsed.projects; if (!ps) continue;
    for (const pr of ps) for (const g of pr.groups || []) { if (g.imagePath) paths.push(g.imagePath); if (g.videoPath) paths.push(g.videoPath); }
  }
  const ok = await existingSet(paths, { statFn: opts.statFn });
  const has = (p) => !!p && ok.has(p);
  const hasVisual = (g) => has(g.imagePath) || has(g.videoPath);
  const out = [];
  for (const it of items || []) {
    const name = basename(it.scriptPath || '').replace(/\.md$/i, '');
    if (!it.parsed || !it.parsed.projects) { out.push({ id: it.id, name, img: null, vid: null }); continue; }
    let img = 0, vid = 0;
    for (const pr of it.parsed.projects) {
      // 🔒 `_covered` 는 그림 만들기가 읽는 표시다 — 조금 전 파일 상태로 센 값을 남기지 않게, 세고 나서 같은 틱 안에 되돌린다
      const saved = pr.groups.map((g) => g._covered);
      try { markCovered(pr, hasVisual); } catch {}
      for (const g of pr.groups) if (g.imagePrompt && g.imagePrompt.trim() && !hasVisual(g) && !g._covered) img++;
      pr.groups.forEach((g, i) => { if (saved[i] === undefined) delete g._covered; else g._covered = saved[i]; });
      if (wantVid) {
        const hit = matcher(pr.groups, normSel((it.settings || {}).vidSel) || 'intro', null, null);
        for (const g of pr.groups) if (hit(g.num) && !has(g.videoPath)) vid++;
      }
    }
    out.push({ id: it.id, name, img, vid });
    await yieldLoop();   // 대본 하나 셀 때마다 다른 요청·창 메시지를 받게
  }
  return { items: out };
}

module.exports = { countQueueMedia, existingSet };
