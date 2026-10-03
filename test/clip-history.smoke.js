'use strict';
/**
 * node test/clip-history.smoke.js — 🕘 클립 수정 이력 E2E(2026-10-03 로이)
 *   실제 앱: 한 클립을 3번 고친다 → 「가」 윗줄의 ↶ 버튼에 3 → 팝업에 원본+3 → 어느 때로든 돌아간다(대본 .md 도 같이) → 다시 앞으로도.
 *   ⚠ 임시 채널·임시 대본·임시 출력폴더만 쓴다. 이력 파일은 PM_UI_SMOKE 로 임시 폴더.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TAG = `__클립이력_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 클립 이력 테스트', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room',
  '첫째 문장입니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a gate', '셋째 문장입니다. 넷째 문장입니다.', ''].join('\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const md = () => fs.readFileSync(MD, 'utf8');

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__클립이력채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliphist-e2e-'));
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win, lsDetail = null;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });
    ok(await win.evaluate(async ({ name, dir }) => { try { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); return true; } catch (_) { return false; } }, { name: chan, dir: outDir }), '임시 채널');
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(400);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    lsDetail = await win.evaluate(() => { try { return localStorage.getItem('pm.clipDetail'); } catch (_) { return null; } });

    const edit = (text) => win.evaluate(async (t) => { const r = await window.api.editSentences({ shortsNum: 1, groupNum: 1, sentIdx: 1, count: 1, text: t }); return !!(r && r.ok); }, text);
    console.log('\n[1] 둘째 문장(클립 2)을 3번 고친다');
    const T = ['첫 수정본입니다.', '두 번째 수정본입니다.', '세 번째 수정본입니다.'];
    for (const t of T) ok(await edit(t), `수정: ${t}`);
    await win.waitForTimeout(500);
    ok(md().includes(T[2]), '대본 .md 에 마지막 수정이 있다');
    const btn = win.locator('.sent[data-ln="2"] [data-testid="clip-hist-btn"]').first();
    ok(await win.locator('.sent[data-ln="1"] [data-testid="clip-hist-btn"]').first().innerText().then((t) => !/\d/.test(t)), '안 고친 클립 1 에는 횟수 없음');
    const geo = await win.evaluate(() => {
      const row = document.querySelector('.sent[data-ln="2"]');
      const h = row.querySelector('.clip-r1 [data-testid="clip-hist-btn"]'), f = row.querySelector('.clip-r2 .clip-fmt');
      if (!h || !f) return { above: false, label: '' };
      const hb = h.getBoundingClientRect(), fb = f.getBoundingClientRect();
      return { above: hb.bottom <= fb.top + 1 && Math.abs((hb.left + hb.right) / 2 - (fb.left + fb.right) / 2) < 30, label: f.textContent };
    });
    ok(geo.above && geo.label === '가', '이력 버튼이 윗줄(1행) 오른쪽 끝 — 「가」 바로 위');

    console.log('\n[2] 팝업 — 원본 + 3');
    await btn.click();
    await win.waitForSelector('[data-testid="clip-hist"]', { timeout: 5000 });
    const rows = await win.locator('[data-testid="clip-hist-row"]').allInnerTexts();
    ok(rows.length === 4, `4개 (${rows.length})`);
    ok(rows[0].includes('둘째 문장입니다') && rows[3].includes(T[2]) && rows[3].includes('지금'), '원본 · 지금 = 마지막');

    console.log('\n[3] 어디로든 — 원본 → 수정 2 → 수정 1');
    const go = async (i) => {
      await win.locator('[data-testid="clip-hist-row"]').nth(i).locator('button').click();
      await win.waitForSelector('[data-testid="clip-hist"]', { state: 'detached', timeout: 10000 });
      await win.waitForTimeout(300);
    };
    await go(0);
    ok(md().includes('둘째 문장입니다') && !md().includes(T[2]), '원본으로 — 대본 .md 도 돌아갔다');
    await win.locator('.sent[data-ln="2"] [data-testid="clip-hist-btn"]').first().click();
    await win.waitForSelector('[data-testid="clip-hist"]');
    ok((await win.locator('[data-testid="clip-hist-row"]').count()) === 4, '되돌려도 기록 4개 그대로');
    ok((await win.locator('[data-testid="clip-hist-row"].cur').innerText()).includes('원본'), '지금 = 원본');
    await go(2);
    ok(md().includes(T[1]), '수정 2 로 앞으로');
    await win.locator('.sent[data-ln="2"] [data-testid="clip-hist-btn"]').first().click();
    await win.waitForSelector('[data-testid="clip-hist"]');
    await go(1);
    ok(md().includes(T[0]) && !md().includes(T[1]), '수정 1 로');
    await win.waitForTimeout(300);
    const bt = await win.locator('.sent[data-ln="2"] [data-testid="clip-hist-btn"]').first().innerText();
    ok(bt.includes('3'), '↶ 버튼에 고친 횟수 3 (되돌려도 기록 유지) ' + JSON.stringify(bt));
    ok(errors.length === 0, '화면 오류 0건 ' + errors.join(' / ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외: ' + e.stack); }
  finally {
    try { if (lsDetail == null) await win.evaluate(() => localStorage.removeItem('pm.clipDetail')); } catch {}
    try { await win.evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, chan); } catch {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 클립 수정 이력 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
