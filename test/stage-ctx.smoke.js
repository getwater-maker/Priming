'use strict';
/**
 * node test/stage-ctx.smoke.js — ① 칸 그림(스테이지) 세로 도구 막대 + 오른쪽 클릭 메뉴 + 그림 복사 E2E (v0.7.81)
 *   🧰 그림을 누르면 세로 막대(채우기 · 순서 · 투명도 · 자르기 · 좌우 반전 · 교체)
 *   🖱 오른쪽 클릭 = 잘라내기 · 그림 복사 · 그림+자막 복사 · 붙여넣기(준비 중) · 삭제 · 비디오 생성 ▸ · 채우기 ▸ · 순서 ▸
 *   📋 클립보드는 가짜(navigator.clipboard.write 를 가로챈다) — 진짜 클립보드를 건드리지 않는다.
 * ⚠ 사용자 대본은 건드리지 않는다 — 임시 .md 를 열고 끝나면 대본·스냅샷을 지운다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TAG = `__스테이지메뉴테스트_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const PNG = path.join(os.tmpdir(), `${TAG}_g.png`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = [
  '# 스테이지 메뉴 테스트 대본', '', '## 1장', '### 첫 장면', '> 🖼️ 이미지: a quiet room', '첫째 문장입니다. 둘째 문장입니다.', '',
  '### 둘째 장면', '> 🖼️ 이미지: a river', '셋째 문장입니다. 넷째 문장입니다.', '',
].join('\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const cleanup = () => { for (const f of [MD, PNG, SNAP]) { try { if (fs.existsSync(f)) fs.rmSync(f, { force: true }); } catch (_) {} } };

(async () => {
  cleanup();
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  fs.writeFileSync(PNG, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAWAAH+0mZlpgAAAABJRU5ErkJggg==', 'base64'));
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('dialog', (d) => d.accept());
    await win.waitForSelector('h1', { timeout: 20000 });
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1600, 950); });
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.ribbon button:has-text("열기")');
    await win.waitForSelector('.sblk[data-ord]', { timeout: 20000 });
    // 가짜 클립보드 + 캔버스 글자 기록
    await win.evaluate(() => {
      window.__cb = []; window.__fill = [];
      try { Object.defineProperty(navigator, 'clipboard', { value: { write: async (items) => { window.__cb.push(items.map((i) => i.types.join(','))); }, writeText: async () => {} }, configurable: true }); } catch (_) {}
      const f = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { window.__fill.push(String(t)); return f.call(this, t, ...a); };
    });
    // 임시 그림을 G1 에 첨부
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, PNG);
    await win.locator('.cut').nth(0).locator('.thumb').first().click();
    await win.click('[data-testid=vr-menu] button:has-text("첨부")');
    await win.waitForSelector('.cut img.thumb', { timeout: 5000 });
    { const cc = win.locator('.sent[data-ln="1"] .clip-cap'); if (await cc.count()) await cc.click(); else await win.locator('.sblk[data-ord="1"] .sblk-lines').click(); await win.keyboard.press('Escape'); }
    await win.waitForSelector('#stageVisual .vlayer[data-num="1"]', { timeout: 5000 });
    const sv = await win.locator('#stageVisual').boundingBox();
    const cx = sv.x + sv.width / 2, cy = sv.y + sv.height / 2;

    console.log('\n[1] 그림을 누르면 세로 도구 막대');
    ok(await win.locator('[data-testid=stage-vtb]').count() === 0, '누르기 전엔 막대 없음');
    await win.mouse.click(cx, cy);
    await win.waitForSelector('[data-testid=stage-vtb]', { timeout: 3000 });
    ok(await win.locator('[data-testid=stage-vtb] .vtb-b').count() === 6, '세로 막대 버튼 6개(채우기 · 순서 · 투명도 · 자르기 · 좌우 반전 · 교체)');
    ok(await win.locator('[data-testid=stage-vtb] .vtb-b.soon').count() === 3, '준비 중 3개(순서 · 투명도 · 자르기)');
    const box = await win.evaluate(() => { const b = document.querySelector('[data-testid=stage-vtb]').getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect(); return { inside: b.left >= s.left && b.right <= s.right + 1 && b.top >= s.top && b.bottom <= s.bottom }; });
    ok(box.inside, '막대가 스테이지 안(오른쪽 가장자리)');
    await win.locator('[data-testid=vtb-flip]').click(); await win.waitForTimeout(500);
    ok(/scale\(-1, ?1\)/.test(await win.evaluate(() => { const e = document.querySelector('#stageVisual .vlook'); return e ? e.style.transform : ''; })), '⇋ 좌우 반전이 그림에 적용');
    await win.locator('[data-testid=vtb-flip]').click(); await win.waitForTimeout(400);
    await win.locator('[data-testid=vtb-fill]').click();
    ok(await win.locator('[data-testid=sx-sub-fill]').count() === 1 && await win.locator('[data-testid=stage-ctx]').count() === 0, '⛶ 채우기 → 맞추기·꽉 채우기 목록만(메뉴 본체는 없음)');
    await win.keyboard.press('Escape'); await win.waitForTimeout(150);
    ok(await win.locator('[data-testid=sx-sub-fill]').count() === 0, 'Esc 로 닫힘');

    console.log('\n[2] 오른쪽 클릭 메뉴');
    await win.mouse.click(cx, cy, { button: 'right' }); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid=stage-ctx]').count() === 1, '🖱 그림 오른쪽 클릭 → 메뉴');
    for (const id of ['sx-cut', 'sx-copy-img', 'sx-copy-cap', 'sx-del', 'sx-vid', 'sx-fill', 'sx-ord']) ok(await win.locator(`[data-testid=${id}]`).count() === 1, `항목 ${id}`);
    ok((await win.locator('[data-testid=stage-ctx]').innerText()).includes('붙여넣기'), '붙여넣기(준비 중) 항목');
    ok(await win.locator('[data-testid=clip-tb]').isVisible().catch(() => false) === false, '메뉴가 떠 있는 동안 클립 막대 없음');

    console.log('\n[3] 그림 복사 · 그림+자막 복사');
    await win.click('[data-testid=sx-copy-img]'); await win.waitForTimeout(500);
    let st = await win.evaluate(() => ({ cb: window.__cb.slice(), fill: window.__fill.slice() }));
    ok(st.cb.length === 1 && st.cb[0][0] === 'image/png', `📋 그림 복사 → 클립보드에 image/png (${JSON.stringify(st.cb)})`);
    ok(st.fill.length === 0, '🔑 그림만 복사는 자막을 그리지 않는다');
    ok(await win.locator('[data-testid=stage-ctx]').count() === 0, '고르면 메뉴가 닫힌다');
    await win.mouse.click(cx, cy, { button: 'right' }); await win.waitForTimeout(300);
    const capOn = !(await win.locator('[data-testid=sx-copy-cap]').isDisabled());
    ok(capOn, '지금 보이는 자막이 있으면 「그림 + 자막 복사」가 켜진다');
    if (capOn) {
      await win.click('[data-testid=sx-copy-cap]'); await win.waitForTimeout(500);
      st = await win.evaluate(() => ({ cb: window.__cb.slice(), fill: window.__fill.join('') }));
      ok(st.cb.length === 2 && st.cb[1][0] === 'image/png' && /첫째|문장/.test(st.fill), `🔑 그림 + 자막 복사 → 자막 글자를 얹어 복사 (${st.fill.slice(0, 20)})`);
    } else await win.keyboard.press('Escape');
    // Ctrl+C = 그림 복사
    await win.mouse.click(cx, cy); await win.waitForTimeout(200);
    await win.keyboard.press('Control+c'); await win.waitForTimeout(500);
    ok((await win.evaluate(() => window.__cb.length)) === (capOn ? 3 : 2), '⌨ ① 칸 그림을 고른 채 Ctrl+C = 그림 복사');

    console.log('\n[4] 채우기 ▸ · 삭제');
    await win.mouse.click(cx, cy, { button: 'right' }); await win.waitForTimeout(300);
    await win.locator('[data-testid=sx-fill]').hover(); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid=sx-sub-fill] button').count() === 3, '채우기 ▸ 자동 · 꽉 채우기 · 맞추기');
    await win.click('[data-testid=sx-fill-cover]'); await win.waitForTimeout(600);
    ok(await win.evaluate(() => { const i = document.querySelector('#stageVisual .vlayer img'); return !!i && getComputedStyle(i).objectFit === 'cover'; }), '꽉 채우기가 그림에 적용');
    await win.mouse.click(cx, cy, { button: 'right' }); await win.waitForTimeout(300);
    await win.locator('[data-testid=sx-ord]').hover(); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid=sx-sub-ord] .soon').count() === 4, '순서 ▸ 4개 모두 준비 중');
    await win.keyboard.press('Escape'); await win.waitForTimeout(150);
    await win.mouse.click(cx, cy, { button: 'right' }); await win.waitForTimeout(300);
    await win.click('[data-testid=sx-del]'); await win.waitForTimeout(800);
    ok(await win.locator('.cut').nth(0).locator('img.thumb').count() === 0, '🗑 삭제 → G1 그림이 지워진다');

    ok(errors.length === 0, `화면 오류 0건 ${errors.length ? '— ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await app.close().catch(() => {});
    cleanup();
  }
  console.log(`\n${fail ? '❌' : '✅'} 스테이지 메뉴 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 오류:', e); cleanup(); process.exit(1); });
