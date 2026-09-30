'use strict';
/**
 * node test/edit-speed.smoke.js — ⚡ 합치기가 바로바로 · ⌨ 키보드로 오가면 늘 자막 칸에 커서(v0.5.95 · 로이 2026-09-30)
 *   ① Del 합치기 한 번에 **뒤 그룹은 다시 그리지 않는다**(MemoCut · __pmCutRenders 로 센다) — 번호만 당겨진 그룹은 DOM 번호만 고친다
 *   ② 그래도 번호(data-ln · 줄 번호 글자)는 1..N 으로 맞다 · 뒤 그룹 클립을 눌러도 **새 번호**로 고른다(옛 처리기가 옛 번호를 쓰지 않는다)
 *   ③ ↓ 로 옮기면 자막 칸이 열리고 · Del 합친 뒤 그 클립 칸이 다시 열리며 커서는 이어 붙인 자리
 *   ⚠ 임시 채널·임시 대본만 쓴다.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TAG = `__편집속도_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const groups = [];
for (let g = 1; g <= 8; g++) groups.push(`### 〔장면 ${g}〕`, `> 🖼️ 이미지: scene ${g}`, [1, 2, 3].map((k) => `${g}번 장면의 ${k}번째 문장입니다.`).join(' '), '');
const SCRIPT = ['# 편집 속도 테스트', '', '## 장', ...groups].join('\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__편집속도채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'editspeed-'));
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win, lsDetail = null;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async ({ name, dir }) => { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); }, { name: chan, dir: outDir });
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(300);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    lsDetail = await win.evaluate(() => { try { return localStorage.getItem('pm.clipDetail'); } catch (_) { return null; } });
    if (await win.locator('.clipbar button[data-detail="1"]').count()) await win.click('.clipbar button[data-detail="1"]');
    await win.evaluate(async (name) => { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 40, aiNotice: false, openVrew: false }); }, chan);
    await win.waitForTimeout(800);
    const nLines = await win.evaluate(() => document.querySelectorAll('.sent[data-ln]').length);
    ok(nLines === 24, `클립 24개(8그룹 × 3) — ${nLines}`);

    console.log('\n[1] ⌨ ↓ 로 옮기면 자막 칸이 열린다');
    await win.locator('.sent[data-ln="1"] .cf-lineno').first().click(); await win.waitForTimeout(200);
    await win.keyboard.press('Escape'); await win.waitForTimeout(150);
    await win.locator('.clipbar').click();
    await win.keyboard.press('ArrowDown'); await win.waitForTimeout(400);
    ok(await win.evaluate(() => { const t = document.activeElement; return !!(t && t.tagName === 'TEXTAREA' && t.closest('.sent[data-ln="2"]')); }), '↓ → 2번 클립 자막 칸에 커서');
    await win.keyboard.press('ArrowDown'); await win.waitForTimeout(400);
    ok(await win.evaluate(() => { const t = document.activeElement; return !!(t && t.tagName === 'TEXTAREA' && t.closest('.sent[data-ln="3"]')); }), '칸 안에서 ↓ → 3번 클립 칸(계속 칸 안)');

    console.log('\n[2] ⚡ Del 합치기 — 뒤 그룹은 다시 그리지 않는다 · 번호는 맞다');
    // 3번(1그룹 끝) 칸에서 끝으로 → Del = 4번(2그룹 첫 클립)을 끌어올린다
    const before = await win.evaluate(() => { window.__pmCutRenders = 0; return document.querySelector('textarea').value; });
    await win.keyboard.press('End');
    const t0 = Date.now();
    await win.keyboard.press('Delete');
    await win.waitForFunction(() => document.querySelectorAll('.sent[data-ln]').length === 23, null, { timeout: 8000 });
    const ms = Date.now() - t0;
    await win.waitForTimeout(500);
    const renders = await win.evaluate(() => window.__pmCutRenders || 0);
    ok(renders <= 6, `🔑 다시 그린 그룹 ${renders}번(8그룹 중 · 예전엔 매번 전부) · 화면 반영 ${ms}ms`);
    const nums = await win.evaluate(() => [...document.querySelectorAll('.sent[data-ln]')].map((x) => [Number(x.getAttribute('data-ln')), (x.querySelector('.cf-lineno') || {}).textContent]));
    ok(nums.length === 23 && nums.every(([n, t], i) => n === i + 1 && String(t).trim() === String(i + 1)), '🔑 번호가 1..23 으로 맞다(data-ln · 보이는 번호 둘 다)');
    const ords = await win.evaluate(() => [...document.querySelectorAll('.sblk[data-ord]')].map((x) => Number(x.getAttribute('data-ord'))));
    ok(ords.every((o, i) => o === i + 1), `문장 순번(data-ord)도 1..${ords.length}`);
    // ③ 합친 뒤 그 클립 칸이 다시 열리고 커서는 이어 붙인 자리
    const st = await win.evaluate(() => { const t = document.activeElement; return t && t.tagName === 'TEXTAREA' ? { v: t.value, c: t.selectionStart, ln: (t.closest('[data-ln]') || {}).getAttribute && t.closest('[data-ln]').getAttribute('data-ln') } : null; });
    const core = before.replace(/[.!?。]+\s*$/, '').trimEnd();
    ok(st && st.ln === '3' && st.v.startsWith(core) && st.c === core.length, `⌨ 합친 클립(3번) 칸이 다시 열리고 커서는 이은 자리 (${st && st.c}/${core.length})`);
    await win.keyboard.press('Escape'); await win.waitForTimeout(200);

    console.log('\n[3] 다시 그리지 않은 뒤 그룹 — 누르면 **새 번호**로');
    await win.evaluate(() => { window.__pmCutRenders = 0; });
    await win.locator('.sent[data-ln="20"] .cf-lineno').first().click(); await win.waitForTimeout(300);
    const tb = await win.evaluate(() => ({ picked: [...document.querySelectorAll('.sent.picked')].map((x) => x.getAttribute('data-ln')) }));
    ok(tb.picked.length === 1 && tb.picked[0] === '20', `🔑 20번을 누르면 20번이 골라진다(옛 번호 21 이 아니라) — ${JSON.stringify(tb.picked)}`);
    const txt20 = await win.locator('.sent[data-ln="20"] .clip-cap').first().innerText();
    await win.keyboard.press('Escape'); await win.waitForTimeout(150);
    await win.locator('.sent[data-ln="20"] .clip-cap').first().click(); await win.waitForTimeout(300);
    const edv = await win.evaluate(() => { const t = document.activeElement; return t && t.tagName === 'TEXTAREA' ? t.value : null; });
    ok(edv === txt20, `20번 글자를 누르면 그 줄 칸이 열린다(「${edv}」)`);
    await win.keyboard.press('Escape');

    ok(errors.length === 0, `화면 오류 0건 ${errors.length ? '— ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    try { await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, chan); } catch (_) {}
    try { await win.evaluate((v) => { try { if (v == null) localStorage.removeItem('pm.clipDetail'); else localStorage.setItem('pm.clipDetail', v); } catch (_) {} }, lsDetail); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 편집 속도·키보드 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 오류:', e); process.exit(1); });
