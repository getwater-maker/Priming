'use strict';
/**
 * node test/queue-media-count.test.js — 💰 작업큐 남은 그림·영상 셈이 main 을 얼리지 않는가(v1.0.68)
 *   2026-11-21: 옛 `queue-media-cost` 가 큐 28편을 동기 existsSync 로 세느라 5초마다 3초씩 멈췄고 「응답 없음」으로 창이 닫혔다.
 *   ① 값 = 옛 동기 규칙과 같다(참조 구현과 비교) ② 경로마다 stat 한 번 ③ 세는 동안 이벤트 루프가 돈다(타이머가 끼어든다)
 *   ④ `_covered` 를 남기지 않는다 ⑤ 소스: 셈 모듈·main 핸들러에 동기 fs 없음
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const QM = require('../core/queue-media-count');
const VS = require('../core/visual-span');
const VSel = require('../core/video-select');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qmedia-'));

// 가짜 대본: 그룹 n개 · 3그룹마다 그림 있음 · 5그룹마다 영상 있음 · 일부는 soft 범위로 아래 그룹까지 늘림
function mkItem(idx, n) {
  const groups = [];
  for (let k = 1; k <= n; k++) {
    const sid = `s${idx}_${k}`;
    const g = { num: k, sentenceIds: [sid], imagePrompt: k % 7 === 0 ? '' : `scene ${k}` };
    if (k % 3 === 0) { g.imagePath = path.join(TMP, `${idx}_${k}.png`); fs.writeFileSync(g.imagePath, 'x'); }
    else if (k % 4 === 0) g.imagePath = path.join(TMP, `${idx}_${k}_gone.png`);   // 기록만 있고 파일 없음
    if (k % 5 === 0) { g.videoPath = path.join(TMP, `${idx}_${k}.mp4`); fs.writeFileSync(g.videoPath, 'x'); }
    if (k % 3 === 0 && k + 1 <= n) g.visSpan = { endId: `s${idx}_${k + 1}`, soft: k % 2 === 0 };
    groups.push(g);
  }
  return { id: 'it' + idx, scriptPath: `D:\\x\\[테스트_${idx}] 대본.md`, settings: { vidSel: idx % 2 ? 'odd' : '' }, parsed: { projects: [{ groups }] } };
}

// 옛 핸들러 규칙(동기) — 값 비교용 참조
function oldCount(items, wantVid) {
  const hasVisual = (g) => !!((g.imagePath && fs.existsSync(g.imagePath)) || (g.videoPath && fs.existsSync(g.videoPath)));
  const out = [];
  for (const it of items) {
    const name = path.basename(it.scriptPath || '').replace(/\.md$/i, '');
    if (!it.parsed || !it.parsed.projects) { out.push({ id: it.id, name, img: null, vid: null }); continue; }
    let img = 0, vid = 0;
    for (const pr of it.parsed.projects) {
      VS.markCovered(pr, hasVisual);
      for (const g of pr.groups) if (g.imagePrompt && g.imagePrompt.trim() && !hasVisual(g) && !g._covered) img++;
      if (wantVid) {
        const hit = VSel.matcher(pr.groups, VSel.normSel((it.settings || {}).vidSel) || 'intro', null, null);
        for (const g of pr.groups) if (hit(g.num) && !(g.videoPath && fs.existsSync(g.videoPath))) vid++;
      }
      for (const g of pr.groups) delete g._covered;
    }
    out.push({ id: it.id, name, img, vid });
  }
  return { items: out };
}

const opts = (extra) => ({ markCovered: VS.markCovered, matcher: VSel.matcher, normSel: VSel.normSel, basename: (s) => path.win32.basename(s), ...extra });

(async () => {
  const items = Array.from({ length: 28 }, (_, i) => mkItem(i + 1, 60));
  items.push({ id: 'none', scriptPath: 'D:\\x\\안읽힘.md', parsed: null });

  // ① 값 비교(영상 셈 켬·끔)
  for (const wantVid of [false, true]) {
    const want = oldCount(items, wantVid);
    want.items.forEach((x) => { x.name = path.win32.basename(items.find((i) => i.id === x.id).scriptPath).replace(/\.md$/i, ''); });
    const got = await QM.countQueueMedia(items, opts({ wantVid }));
    ok(JSON.stringify(got) === JSON.stringify(want), `값이 옛 규칙과 같다 (영상 ${wantVid ? '켬' : '끔'}) · 첫 항목 ${JSON.stringify(got.items[0])}`);
  }
  // 판정력: 그림 하나를 지우면 그 대본의 남은 그림 수가 바뀐다
  {
    const before = (await QM.countQueueMedia([items[0]], opts())).items[0].img;
    const g = items[0].parsed.projects[0].groups.find((x) => x.imagePath && fs.existsSync(x.imagePath) && !x.videoPath && x.imagePrompt);
    fs.unlinkSync(g.imagePath);
    const after = (await QM.countQueueMedia([items[0]], opts())).items[0].img;
    ok(after > before, `그림 하나를 지우면 남은 그림이 는다 (${before} → ${after} · 그 그림이 덮던 아래 그룹까지)`);
  }

  // ② 경로마다 stat 한 번
  {
    const seen = new Map();
    const statFn = (p) => { seen.set(p, (seen.get(p) || 0) + 1); return fs.promises.stat(p); };
    await QM.countQueueMedia(items, opts({ wantVid: true, statFn }));
    const uniq = new Set(); for (const it of items) for (const pr of (it.parsed && it.parsed.projects) || []) for (const g of pr.groups) { if (g.imagePath) uniq.add(g.imagePath); if (g.videoPath) uniq.add(g.videoPath); }
    ok(seen.size === uniq.size && [...seen.values()].every((v) => v === 1), `경로 ${uniq.size}개를 한 번씩만 확인 (호출 ${[...seen.values()].reduce((a, b) => a + b, 0)})`);
  }

  // ③ 세는 동안 이벤트 루프가 돈다 — 느린 stat(경로마다 1ms)으로 세는 사이 타이머가 여러 번 불려야 한다
  {
    let ticks = 0; const iv = setInterval(() => { ticks++; }, 2);
    const slow = (p) => new Promise((res, rej) => setTimeout(() => fs.promises.stat(p).then(res, rej), 1));
    await QM.countQueueMedia(items, opts({ wantVid: true, statFn: slow }));
    clearInterval(iv);
    ok(ticks >= 5, `세는 동안 타이머가 ${ticks}번 불렸다(얼지 않음)`);
  }

  // ④ _covered 를 남기지 않는다
  {
    const g0 = items[1].parsed.projects[0].groups;
    g0[0]._covered = 77;
    await QM.countQueueMedia([items[1]], opts());
    ok(g0[0]._covered === 77 && g0.slice(1).every((g) => !('_covered' in g)), '셈 뒤 _covered 가 원래대로');
  }

  // ⑤ 소스 — 동기 fs 없음
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'queue-media-count.js'), 'utf8').replace(/\/\/.*$/gm, '');
    ok(!/Sync\(/.test(src), '셈 모듈에 동기 fs 호출 없음');
    const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const a = main.indexOf("ipcMain.handle('queue-media-cost'"); const b = main.indexOf('ipcMain.handle(', a + 10);
    const blk = main.slice(a, b);
    ok(a > 0 && !/existsSync|hasVisual\(/.test(blk) && /queue-media-count/.test(blk), 'main 핸들러가 셈 모듈을 쓰고 동기 확인을 하지 않는다');
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${pass} 통과 · ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
