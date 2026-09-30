'use strict';
/**
 * node test/clip-toolbar-scroll.smoke.js — 고른 클립이 화면 밖으로 스크롤돼도 클립 도구 막대가 사라지지 않는다 (v0.5.99 · 로이 2026-09-30 「또 사라졌네」)
 *   60그룹·360클립 대본에서 클립을 고르고 목록을 스크롤로 멀리 보낸다 → 막대는 화면 가장자리에 남고, 눌러서 동작한다(🗑).
 *   ⚠ 임시 채널·임시 대본만 쓴다.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TAG = `__막대스크롤_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const groups = [];
for (let g = 1; g <= 60; g++) groups.push(`### 〔장면 ${g}〕`, `> 🖼️ 이미지: scene ${g}`, [1, 2, 3].map((k) => `${g}번 장면의 ${k}번째 문장입니다. 조금 더 길게 써서 줄이 나뉘도록 합니다.`).join(' '), '');
fs.writeFileSync(MD, ['# 큰 대본', '', '## 장', ...groups].join('\n'), 'utf8');

(async () => {
  const chan = `__막대스크롤채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctbscroll-'));
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(String(e)));
  try {
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async ({ name, dir }) => { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); }, { name: chan, dir: outDir });
    await win.reload(); await win.waitForSelector('h1'); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(300);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    await win.waitForTimeout(800);
    const total = await win.evaluate(() => document.querySelectorAll('.sent[data-ln]').length);
    ok(total >= 300, `긴 대본: 클립 ${total}개`);

    const el = win.locator('.sent[data-ln="5"] .cf-lineno').first();
    await el.scrollIntoViewIfNeeded(); await el.click(); await win.waitForTimeout(500);
    const near = await win.evaluate(() => ({ tb: !!document.querySelector('[data-testid="clip-tb"]') }));
    ok(near.tb, '고르면 막대가 뜬다');

    // 목록을 멀리 스크롤 — 스크롤되는 칸을 모두 맨 아래로
    await win.evaluate(() => { document.querySelectorAll('*').forEach((e) => { if (e.scrollHeight > e.clientHeight + 200 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) e.scrollTop = e.scrollHeight; }); });
    await win.waitForTimeout(600);
    const far = await win.evaluate(() => {
      const row = [...document.querySelectorAll('.sent[data-ln="5"]')].find((x) => x.offsetParent !== null);
      const rr = row && row.getBoundingClientRect();
      const t = document.querySelector('[data-testid="clip-tb"]'); const r = t && t.getBoundingClientRect();
      const b = document.querySelector('[data-testid="ctb-del"]'); const br = b && b.getBoundingClientRect();
      const hit = br && document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
      return { dbg: { picked: [...document.querySelectorAll('.sent.picked')].length, rowExists: !!row, tbAny: !!document.querySelector('.clip-tb'), all5: document.querySelectorAll('.sent[data-ln="5"]').length }, rowOut: !!(rr && (rr.bottom < 0 || rr.top > innerHeight)), tb: !!t, inView: !!(r && r.top >= 0 && r.bottom <= innerHeight), clickable: !!(hit && hit.closest('[data-testid="ctb-del"]')) };
    });
    ok(far.rowOut, '판별력: 고른 5번 클립이 실제로 화면 밖으로 밀려났다');
    ok(far.tb && far.inView, '🔑 그래도 막대가 남아 있고 화면 안에 있다');
    ok(far.clickable, '🔑 남은 막대의 🗑 는 실제로 눌리는 자리(elementFromPoint)');
    ok(errs.length === 0, `화면 오류 0건 ${errs.slice(0, 2).join(' | ')}`);
  } finally {
    try { await win.evaluate(async (n) => { await window.api.removePreset({ name: n }); }, chan); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 클립 막대 스크롤 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 오류:', e); process.exit(1); });
