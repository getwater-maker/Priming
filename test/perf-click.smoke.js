'use strict';
/**
 * node test/perf-click.smoke.js — ⏱ 큰 대본(90그룹·약 2000클립)에서 클립 클릭 → 선택/커서 반영·도구 막대 표시까지 걸리는 시간 측정
 *   긴 대본(80 클립) · 막대 90% → 그 클립이 골라지고(picked · 커서) ② 목록 화면 안에 보인다 · 10% → 다시 앞쪽 클립이 보인다.
 * ⚠ 임시 채널·임시 대본 · 끝나면 지운다 · 채널 목록 파일 전후 비교.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'findc-'));
const TAG = `__검색이동테스트_${process.pid}`;
const MD = path.join(TMP, `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const CH = '__테스트채널_삭제해도됨_검색_' + process.pid;
const PRESETS = path.join(os.homedir(), '.flow-app', 'tts-presets.json');
const lines = ['# 막대', '', '## 도입부'];
for (let g = 1; g <= 90; g++) { lines.push(`### 〔장면 ${g}〕`, `> 🖼️ 이미지: scene ${g}`); for (let i = 1; i <= 22; i++) lines.push(`${g}장의 ${i}번째 문장은 조금 길게 써서 한 줄이 넘어갈 수도 있습니다.`); lines.push(''); }
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
    win.on('pageerror', (e) => errors.push(String(e))); win.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 300)); });
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async ({ name, dir }) => { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); }, { name: CH, dir: TMP });
    chMade = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((n) => [...document.querySelectorAll('select option')].some((o) => o.value === n), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent.clip', { timeout: 60000 }); await win.waitForTimeout(600);
    await win.waitForTimeout(1500);
    const total = await win.locator('.sent.clip').count();
    console.log('  클립 수(DOM):', total);
    // 클릭 → .cur 이 그 클립으로 바뀔 때까지(ms)
    const measure = async (n) => win.evaluate(async (n) => {
      const el = document.querySelector('.sent.clip[data-ln="' + n + '"] .clip-no .clip-no-n'); if (!el) return null;
      const t0 = performance.now();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((res) => { const iv = setInterval(() => { const c = document.querySelector('.sent.clip.cur'); if (c && c.getAttribute('data-ln') === String(n)) { clearInterval(iv); res(); } }, 4); setTimeout(() => { clearInterval(iv); res(); }, 5000); });
      const t1 = performance.now();
      await new Promise((res) => { const iv = setInterval(() => { if (document.querySelector('[data-testid=clip-tb]')) { clearInterval(iv); res(); } }, 4); setTimeout(() => { clearInterval(iv); res(); }, 5000); });
      return { cur: Math.round(t1 - t0), bar: Math.round(performance.now() - t0) };
    }, n);
    if (process.env.PERF_PROFILE) {
      const cdp = await win.context().newCDPSession(win);
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
      if (process.env.PERF_KEYS) { for (let i = 0; i < 4; i++) { await win.keyboard.press('Escape'); await win.waitForTimeout(200); await win.keyboard.press('ArrowDown'); await win.waitForTimeout(700); } }
      else for (const n of [400, 900, 1500]) { await win.locator('.sent.clip[data-ln="' + n + '"] .clip-no .clip-no-n').first().click(); await win.waitForTimeout(700); }
      const { profile } = await cdp.send('Profiler.stop');
      const byId = new Map(profile.nodes.map((nd) => [nd.id, nd])); const self = new Map();
      const dt = profile.timeDeltas; for (let i = 0; i < profile.samples.length; i++) { const nd = byId.get(profile.samples[i]); const cf = nd.callFrame; const k = (cf.functionName || '(anon)') + ' ' + cf.url.split('/').pop() + ':' + cf.lineNumber; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); }
      const parent = new Map(); for (const nd of profile.nodes) for (const c of (nd.children || [])) parent.set(c, nd.id);
      const callers = new Map();
      for (let i = 0; i < profile.samples.length; i++) { const nd = byId.get(profile.samples[i]); if (!/^(querySelector|querySelectorAll|getBoundingClientRect|elementsFromPoint)$/.test(nd.callFrame.functionName)) continue; let pid = parent.get(nd.id), chain = []; while (pid && chain.length < 3) { const pn = byId.get(pid); if (pn.callFrame.url) chain.push((pn.callFrame.functionName || '(anon)') + ':' + pn.callFrame.lineNumber + ':' + pn.callFrame.columnNumber); pid = parent.get(pid); } const k = nd.callFrame.functionName + ' <- ' + chain.join(' < '); callers.set(k, (callers.get(k) || 0) + (dt[i] || 0)); }
      console.log('  -- DOM 질의 호출자 --'); for (const [k, v] of [...callers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log('   ', (v / 1000).toFixed(0).padStart(6), 'ms', k);
      const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
      for (const [k, v] of top) console.log('   ', (v / 1000).toFixed(0).padStart(6), 'ms', k);
    }
    // 실제 마우스 클릭 → 도구 막대(검은 바)가 뜨기까지
    console.log('  main 클래스:', await win.evaluate(() => [...document.querySelectorAll('main')].map((m) => m.className + '|' + m.scrollHeight)));
    const barMs = [];
    for (let k = 0; k < 4; k++) {
      await win.evaluate((k) => { const pane = document.querySelector('main.pane2'); if (pane) pane.scrollTop = 4000 + k * 9000; }, k); await win.waitForTimeout(500);
      const pt = await win.evaluate(() => { const pm = document.querySelector('main.pane2'); if (!pm) return { err: [...document.querySelectorAll('main')].length + ':' + document.body.innerText.slice(0, 80) }; const pane = pm.getBoundingClientRect(); const els = [...document.querySelectorAll('main.pane2 .sent.clip .clip-no-n')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.top > pane.top + 120 && r.bottom < pane.bottom - 60; }); const e = els[2]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      if (!pt || pt.err) { console.log('  ! 요소 없음', JSON.stringify(pt), errors.join(' | ').slice(0, 400)); barMs.push(99999); continue; }
      const prevTop = await win.evaluate(() => { const b = document.querySelector('[data-testid=clip-tb]'); return b ? b.style.top + '/' + b.style.left : ''; });
      const t0 = Date.now(); await win.mouse.click(pt.x, pt.y);
      await win.waitForFunction((pv) => { const b = document.querySelector('[data-testid=clip-tb]'); return b && (b.style.top + '/' + b.style.left) !== pv; }, prevTop, { timeout: 5000, polling: 'raf' }).catch(() => {});
      barMs.push(Date.now() - t0); await win.waitForTimeout(300);
    }
    console.log('  실제 클릭 → 검은 도구 막대 (ms):', barMs.join(' / '));
    ok(Math.max(...barMs.slice(1)) < 400 && barMs[0] < 900, `도구 막대가 뜨기까지 ${barMs.join('/')}ms (처음 < 900 · 이후 < 400)`);
    if (process.env.PERF_SHOT) { await win.evaluate(() => { document.querySelector('main.pane2').scrollTop = 6000; }); await win.waitForTimeout(500); const b = await win.evaluate(() => { const r = document.querySelector('.card h2').getBoundingClientRect(); const pt = document.querySelector('main.pane2').getBoundingClientRect().top; return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), gap: Math.round(r.y - pt) }; }); console.log('  h2 틈', b.gap); await win.screenshot({ path: process.env.PERF_SHOT, clip: { x: b.x, y: Math.max(0, b.y - 40), width: Math.min(b.w, 900), height: 120 } }); }
    const rs = [];
    for (const n of [5, 400, 900, 1500, 1900, 40]) { const r = await measure(n); rs.push(r); console.log('  클립', n, JSON.stringify(r)); await win.waitForTimeout(400); }
    const worst = Math.max(...rs.filter(Boolean).map((r) => r.cur));
    ok(rs.every(Boolean), '모든 클립이 클릭됨');
    ok(worst < 400, `클릭 → 커서 반영 최악 ${worst}ms (< 400ms)`);
    await win.evaluate(() => { const pane = document.querySelector('.pane-groups'); window.__sc = []; pane.addEventListener('scroll', () => window.__sc.push(Math.round(pane.scrollTop)), { passive: true }); });
    const grp = await win.evaluate(async () => {
      const el = document.querySelector('[data-testid=group-item][data-g="60"]'); const t0 = performance.now(); el.click();
      await new Promise((res) => { const iv = setInterval(() => { const c = document.querySelector('.sent.clip.cur'); if (c && c.closest('.cut') && c.closest('.cut').getAttribute('data-g') === '60') { clearInterval(iv); res(); } }, 4); setTimeout(() => { clearInterval(iv); res(); }, 5000); });
      return Math.round(performance.now() - t0);
    });
    console.log('  scroll 이력', JSON.stringify(await win.evaluate(() => (window.__sc || []).filter((v, i, a) => i % 6 === 0 || i === a.length - 1))));
    for (const w of [300, 700, 1200]) { await win.waitForTimeout(w); console.log('  center?', w, JSON.stringify(await win.evaluate(() => { const pane = document.querySelector('.pane-groups'); const el = pane && pane.querySelector('.pg-item.cur'); return el ? { top: Math.round(pane.scrollTop), sh: pane.scrollHeight, ch: pane.clientHeight, off: Math.round((el.getBoundingClientRect().top + el.offsetHeight / 2) - (pane.getBoundingClientRect().top + pane.clientHeight / 2)), g: el.getAttribute('data-g') } : null; }))); }
    const cen = await win.evaluate(() => { const pane = document.querySelector('.pane-groups'); const el = pane && pane.querySelector('.pg-item.cur'); if (!el) return null; const pr = pane.getBoundingClientRect(), er = el.getBoundingClientRect(); return { off: Math.round((er.top + er.height / 2) - (pr.top + pr.height / 2)), h: Math.round(pr.height) }; });
    ok(cen && Math.abs(cen.off) < 80, `그룹 칸의 파란 그룹이 칸 가운데 (가운데에서 ${cen && cen.off}px · 칸 높이 ${cen && cen.h})`);
    console.log('  그룹 칸 클릭 → 이동', grp, 'ms');
    ok(grp < 600, `그룹 클릭 → 이동 ${grp}ms (< 600ms)`);
    // 방향키로 클립 이동(키 입력 → 커서 반영)
    const keyMs = await win.evaluate(async () => { const out = []; for (let i = 0; i < 1; i++) { const before = document.querySelector('.sent.clip.cur'); const b = before && before.getAttribute('data-ln'); const t0 = performance.now(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await new Promise((res) => { const iv = setInterval(() => { const c = document.querySelector('.sent.clip.cur'); if (c && c.getAttribute('data-ln') !== b) { clearInterval(iv); res(); } }, 2); setTimeout(() => { clearInterval(iv); res(); }, 3000); }); out.push(Math.round(performance.now() - t0)); await new Promise((r) => setTimeout(r, 150)); } return out; });
    console.log('  ↓ 키 → 커서 이동 (ms):', keyMs.join(' / '));
    ok(Math.max(...keyMs) < 600, `방향키 첫 이동 ${Math.max(...keyMs)}ms (< 600ms)`);
    ok(errors.length === 0, '화면 오류 0건 (' + errors.join(' | ') + ')');
  } finally {
    if (chMade) { try { await (await app.firstWindow()).evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    await app.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); fs.rmSync(SNAP, { force: true }); } catch (_) {}
  }
  const presetsAfter = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS, 'utf8') : null;
  ok(presetsBefore === presetsAfter, '로이 채널 설정(tts-presets.json) 전후 동일');
  console.log(`\n${fail ? '❌' : '✅'} 클릭 반응속도 ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
