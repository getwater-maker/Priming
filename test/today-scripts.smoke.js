'use strict';
/**
 * node test/today-scripts.smoke.js — 📅 오늘 대본 버튼(v0.9.85) E2E.
 *   ① 대본 메뉴에 📅 버튼이 보이고 눌린다 → 고르기 창이 뜬다(목록 또는 「없습니다」) → 취소로 닫힌다.
 *   ⚠ 찾기(today-scripts-scan)는 채널 대본 폴더를 **읽기만** 한다 · 「작업큐에 넣기」는 누르지 않는다(로이 출력 폴더에 쓰지 않게).
 */
const path = require('path');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 1366, height: 768 }).catch(() => {});
    await win.waitForSelector('[data-testid="ribbon"]', { timeout: 30000 });
    await win.click('button[data-menu="home"]'); await win.waitForTimeout(250);
    const b = await win.locator('[data-testid="today-scripts"]').boundingBox();
    ok(!!b && await win.evaluate(({ x, y }) => !!(document.elementFromPoint(x, y) || {}).closest?.('[data-testid="today-scripts"]'), { x: b.x + b.width / 2, y: b.y + b.height / 2 }), '📅 오늘 대본 버튼이 보이고 눌리는 자리');
    await win.click('[data-testid="today-scripts"]');
    await win.waitForSelector('[data-testid="today-pick"]', { timeout: 5000 });
    await win.waitForFunction(() => !/찾는 중/.test((document.querySelector('[data-testid="today-pick"]') || {}).textContent || ''), null, { timeout: 15000 });
    const txt = await win.locator('[data-testid="today-pick"]').textContent();
    const rows = await win.locator('[data-testid="today-pick"] input[type="checkbox"]').count();
    console.log(`  (대본 ${rows}편)`);
    ok(/오늘 작업할 대본\s*\d{4}-\d{2}-\d{2}/.test(txt), '창 제목에 오늘 날짜(KST)');
    ok(rows > 0 || /아직 안 만든 대본이 없습니다/.test(txt), '목록 또는 「없습니다」');
    // 📦 패키징 미완 줄(v1.0.55)은 체크 칸이 꺼져 있고 선택돼 있지 않다
    const unpk = await win.evaluate(() => [...document.querySelectorAll('[data-testid="today-pick"] .today-row[data-pack="missing"] input')].map((i) => ({ d: i.disabled, c: i.checked })));
    console.log(`  (패키징 미완 ${unpk.length}편)`);
    ok(unpk.every((x) => x.d && !x.c), '패키징 미완 줄은 고를 수 없다');
    if (process.env.SHOT) await win.locator('[data-testid="today-pick"]').screenshot({ path: process.env.SHOT });
    const addOn = !(await win.locator('[data-testid="today-add"]').isDisabled());
    ok(rows > 0 ? addOn : !addOn, '고른 대본이 있을 때만 「작업큐에 넣기」가 눌린다');
    await win.click('[data-testid="today-pick"] button:has-text("취소")');
    await win.waitForTimeout(200);
    ok(!(await win.locator('[data-testid="today-pick"]').count()), '취소로 닫힌다');

    // ② 📦 패키징 미완이 섞인 목록(찾기 결과만 바꿔 끼움 · 큐에 넣지는 않는다)
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('today-scripts-scan');
      ipcMain.handle('today-scripts-scan', () => ({ today: '2026-11-17', empty: [], items: [
        { channel: '가채널', path: 'C:\\x\\[가_1117] 완료.md', name: '[가_1117] 완료', date: '2026-11-17', waiting: 0, pack: { ok: true, missing: [] } },
        { channel: '나채널', path: 'C:\\x\\[나_1117] 미완.md', name: '[나_1117] 미완', date: '2026-11-17', waiting: 0, pack: { ok: false, missing: ['설명글', '썸네일 그림 B'] } },
      ] }));
    });
    await win.click('[data-testid="today-scripts"]');
    await win.waitForSelector('[data-testid="today-pick"] .today-row', { timeout: 5000 });
    const st = await win.evaluate(() => [...document.querySelectorAll('[data-testid="today-pick"] .today-row')].map((r) => { const i = r.querySelector('input'); return { pk: r.dataset.pack, d: i.disabled, c: i.checked, t: r.textContent }; }));
    ok(st.length === 2 && st[0].pk === 'ok' && st[0].c && !st[0].d, '완료 대본은 처음부터 선택됨');
    ok(st[1].pk === 'missing' && st[1].d && !st[1].c && /패키징 미완/.test(st[1].t) && /설명글·썸네일 그림 B/.test(st[1].t), '미완 대본은 꺼진 칸 + 빠진 것 표시 — ' + (st[1] && st[1].t));
    await win.click('[data-testid="today-pick"] .today-all');   // 모두 해제
    await win.click('[data-testid="today-pick"] .today-all');   // 모두 선택 — 미완은 그대로 꺼짐
    ok(await win.evaluate(() => { const i = [...document.querySelectorAll('[data-testid="today-pick"] .today-row input')]; return i[0].checked && !i[1].checked; }), '「모두 선택」도 미완은 고르지 않는다');
    if (process.env.SHOT) await win.locator('[data-testid="today-pick"]').screenshot({ path: process.env.SHOT.replace(/\.png$/, '_2.png') });
    await win.click('[data-testid="today-pick"] button:has-text("취소")');
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} 오늘 대본 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
