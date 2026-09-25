'use strict';
/**
 * node test/vrew-render-ui.smoke.js — 실제 앱을 띄워 🎬 유튜브 MP4 선택지·버튼·폴더 칸을 확인하는 E2E.
 * 🔑 버튼을 실제로 눌러 화면을 바꾼다(JSX 핸들러 안의 미정의 식별자는 빌드가 못 잡는다).
 * ⚠ 렌더는 하지 않는다 — 선택지를 바꿨다가 원래 값으로 되돌리고, 채널편집은 저장 없이 닫는다.
 */
const path = require('path');
const { _electron: electron } = require('playwright');
const menu = require('./_menu');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errs = [];
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    win.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    console.log('· 부팅 OK');

    // [1] ④ 완성 드롭다운에 🎬 유튜브 MP4
    await menu(win, 'finish');
    const grp = win.locator('.hgroup:has(.glabel:has-text("④ 완성"))');
    const sel = grp.locator('select').first();
    const values = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value));
    ok(values.join(',') === 'vrew,whiteboard,mp4', `선택지 3개 (${values.join(', ')})`);
    const orig = await sel.inputValue();

    // [2] 버튼 통일(2026-09-24) — 🎬 MP4 굽기·✏ 렌더·💾 .vrew 는 없고 ⚡ 만들기 하나가 선택대로 낸다
    await sel.selectOption('mp4');
    await win.waitForTimeout(300);
    ok(await sel.inputValue() === 'mp4', 'mp4 가 선택된 채로 남는다(정규화가 vrew 로 되돌리지 않는다)');
    for (const t of ['🎬 MP4 굽기', '✏ 렌더', '💾 .vrew']) {
      ok(await win.locator(`button:has-text("${t}")`).count() === 0, `「${t}」 버튼이 없다(⚡ 만들기로 통일)`);
    }
    ok(await win.locator('.menubar button:has-text("⚡ 만들기")').count() === 1, '「⚡ 만들기」 하나(메뉴 줄 오른쪽 — 늘 보임)');
    await sel.selectOption('whiteboard');
    await win.waitForTimeout(300);
    ok(await win.locator('button:has-text("✏ 렌더")').count() === 0, '화이트보드를 골라도 ✏ 렌더 없음');
    ok(await grp.locator('button:has-text("📋 장면 계획")').count() === 1, '화이트보드면 「📋 장면 계획」(미리보기)은 남는다');
    await sel.selectOption(orig);

    // [3] 채널편집 — 📁 폴더 「유튜브 업로드」 칸(기본값 = 다운로드) · 🖼 제작 도구 「출력」 선택지
    await win.click('button[title^="채널(프리셋)"]');
    await win.waitForTimeout(700);
    const card = win.locator('.modal-card').filter({ hasText: '폴더' }).first();
    await card.locator('button:has-text("📁")').first().click();
    await win.waitForTimeout(300);
    const row = card.locator('.frow:has(label:has-text("유튜브 업로드"))');
    ok(await row.count() === 1, '📁 폴더 탭에 「유튜브 업로드」 칸');
    const v = await row.locator('input').inputValue().catch(() => '');
    ok(/Downloads|다운로드/i.test(v) || v.length > 3, `기본값이 채워져 있다 (${v})`);
    ok(await row.locator('button:has-text("찾기")').count() === 1, '「찾기」 버튼');
    await card.locator('button:has-text("🖼")').first().click();
    await win.waitForTimeout(300);
    const outSel = card.locator('.crow:has(.l:has-text("출력")) select');
    const ov = await outSel.locator('option').evaluateAll((os) => os.map((o) => o.value)).catch(() => []);
    ok(ov.includes('mp4'), `제작 도구 「출력」에도 mp4 (${ov.join(', ')})`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    // 📊 진행 패널 — main 이 보내는 mp4-progress 를 흉내 내 숫자·단계·닫기를 확인한다(실제 렌더 없이)
    const sendP = (p) => app.evaluate(({ BrowserWindow }, p) => { BrowserWindow.getAllWindows()[0].webContents.send('mp4-progress', p); }, p);
    const base = { title: '[고전_0902] 시험', startedAt: Date.now() - 40000, outPath: 'C:\tmp\a.mp4', durationSec: 1196, encoder: 'nvenc', par: 6 };
    await sendP({ ...base, phase: 'video', audio: 'run',
      video: { done: 30, total: 77, framesDone: 14000, framesTotal: 35880, startedAt: Date.now() - 30000,
        active: [{ i: 31, start: 600, end: 620, type: 'image' }, { i: 32, start: 620, end: 640, type: 'image' }] } });
    await win.waitForSelector('[data-testid="mp4-progress"]', { timeout: 5000 }).catch(() => {});
    const pnl = win.locator('[data-testid="mp4-progress"]');
    ok(await pnl.count() === 1, '📊 MP4 진행 패널이 나타난다');
    const t1 = await pnl.innerText();
    ok(/조각 30\/77/.test(t1) && /39%/.test(t1), '화면 굽기 조각 30/77 · 39%');
    ok(/남은 시간 약/.test(t1) && /10:00~10:20/.test(t1) && /화면과 동시에/.test(t1), '남은 시간 · 지금 굽는 구간 · 음성 동시 진행');
    ok(await pnl.locator('button:has-text("⏹ 중단")').count() === 1, '진행 중에는 ⏹ 중단');
    await sendP({ ...base, phase: 'done', audio: 'done', endedAt: Date.now(), speed: 10.7,
      video: { done: 77, total: 77, framesDone: 35880, framesTotal: 35880, startedAt: 0, active: [] } });
    await win.waitForTimeout(400);
    const t2 = await pnl.innerText();
    ok(/완료/.test(t2) && /100%/.test(t2) && /저장: /.test(t2) && /10\.7배속/.test(t2), '끝나면 100% · 저장 경로 · 배속');
    await pnl.locator('button:has-text("닫기")').click();
    await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="mp4-progress"]').count() === 0, '닫기로 사라진다');

    ok(errs.length === 0, `화면 오류 0건 (실제 ${errs.length}${errs.length ? ' — ' + errs.slice(0, 3).join(' / ') : ''})`);
  } finally {
    await app.close();
  }
  console.log(`\n${fail ? '❌' : '✅'} 🎬 유튜브 MP4 화면 E2E ${pass}/${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 실패:', e); process.exit(1); });
