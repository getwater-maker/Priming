'use strict';
/**
 * node test/seek-scroll.smoke.js — 🎚 ① 칸 재생 막대를 누르면 ② 목록도 그 클립으로(v0.6.92 · 로이 2026-10-05)
 *   긴 대본(80 클립) · 막대 90% → 그 클립이 골라지고(picked · 커서) ② 목록 화면 안에 보인다 · 10% → 다시 앞쪽 클립이 보인다.
 * ⚠ 임시 채널·임시 대본 · 끝나면 지운다 · 채널 목록 파일 전후 비교.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seek-'));
const TAG = `__막대이동테스트_${process.pid}`;
const MD = path.join(TMP, `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const CH = '__테스트채널_삭제해도됨_막대_' + process.pid;
const PRESETS = path.join(os.homedir(), '.flow-app', 'tts-presets.json');
const lines = ['# 막대', '', '## 도입부'];
for (let g = 1; g <= 8; g++) { lines.push(`### 〔장면 ${g}〕`, `> 🖼️ 이미지: scene ${g}`); for (let i = 1; i <= 10; i++) lines.push(`${g}장의 ${i}번째 문장입니다.`); lines.push(''); }
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

(async () => {
  fs.writeFileSync(MD, lines.join('\n'), 'utf8');
  const presetsBefore = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS, 'utf8') : null;
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false;
  try {
    const win = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 820); });
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async ({ name, dir }) => { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); }, { name: CH, dir: TMP });
    chMade = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((n) => [...document.querySelectorAll('select option')].some((o) => o.value === n), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent.clip', { timeout: 20000 }); await win.waitForTimeout(600);
    const seek = win.locator('[data-testid=stage-seek]');
    const atPct = async (p) => { const b = await seek.boundingBox(); await win.mouse.click(b.x + 8 + (b.width - 16) * p, b.y + b.height / 2); await win.waitForTimeout(800); };
    const state = () => win.evaluate(() => {
      const cur = document.querySelector('.sent.cur'); const pane = document.querySelector('main.pane2');
      if (!cur || !pane) return null;
      const r = cur.getBoundingClientRect(), p = pane.getBoundingClientRect();
      return { n: Number(cur.getAttribute('data-ln')), picked: cur.classList.contains('picked'), inView: r.top >= p.top - 1 && r.bottom <= p.bottom + 1, scrollTop: Math.round(pane.scrollTop) };
    });
    const s0 = await state();
    await atPct(0.9);   // 80 문장 × 2.5 = 200초 → 180초 = 73번째 문장
    const s1 = await state();
    ok(s1 && s1.n === 73 && s1.picked && s1.inView && s1.scrollTop > s0.scrollTop + 500, `🔑 막대 90% → 클립 73 이 골라지고 ② 목록이 그리로 스크롤 (${JSON.stringify([s0, s1])})`);
    await atPct(0.1);   // 20초 → 9번째 문장
    const s2 = await state();
    ok(s2 && s2.n === 9 && s2.picked && s2.inView && s2.scrollTop < s1.scrollTop, `막대 10% → 클립 9 · 다시 앞쪽으로 (${JSON.stringify(s2)})`);
    ok(await win.locator('[data-testid=stage-edit]').count() === 0 && await win.locator('.sent.clip.editing').count() === 0, '편집칸은 열지 않는다(고르기만)');
    ok(errors.length === 0, `화면 오류 0건 (${errors.join(' | ')})`);
  } catch (e) { fail++; console.log('  ✗ 예외: ' + String((e && e.message) || e).split('\n')[0]); } finally {
    if (chMade) { try { await (await app.firstWindow()).evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    try { await app.close(); } catch (_) {}
    try { fs.rmSync(SNAP, { force: true }); } catch (_) {}
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    const after = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS, 'utf8') : null;
    ok(after === presetsBefore, '로이 채널 설정(tts-presets.json) 전후 동일');
    console.log(`\n${fail ? '❌' : '✅'} 막대 → 목록 클립 E2E ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
