'use strict';
/**
 * node test/perf-clipops.smoke.js — 클립 추가 · 그룹 나누기 · 클립 삭제의 걸리는 시간(큰 대본) — 로이 2026-10-09 「클릭하면 딜레이가 발생한다」
 *   대본: 그룹 60개 × 문장 8개(= 클립 480+). 서버(main) 응답 시간 + 화면이 다시 그려질 때까지의 시간을 잰다.
 *   ⚠ 임시 채널·임시 대본·임시 출력폴더만. 한도(MAX_MS)를 넘으면 실패 — 느려지는 회귀를 잡는다.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TAG = `__속도_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const G = Number(process.env.PERF_G || 60), S_PER = 8;
const MAX_MS = Number(process.env.PERF_MAX_MS || 2500);
const parts = ['# 속도 테스트', '', '## 장'];
let k = 0;
for (let g = 1; g <= G; g++) {
  parts.push(`### 장면 ${g}`, `> 🖼️ 이미지: scene ${g}`);
  const ss = []; for (let s = 0; s < S_PER; s++) ss.push(`${++k}번째 문장은 속도를 재기 위한 조금 긴 문장입니다.`);
  parts.push(ss.join(' '), '');
}
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, parts.join('\n'), 'utf8');
  const chan = `__속도채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-e2e-'));
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win, lsDetail = null;
  try {
    win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async ({ name, dir }) => { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); }, { name: chan, dir: outDir });
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(400);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 60000 });
    lsDetail = await win.evaluate(() => { try { return localStorage.getItem('pm.clipDetail'); } catch (_) { return null; } });
    await win.waitForTimeout(1500);
    const nClips = await win.locator('.sent.clip').count();
    console.log('   클립 수(화면)', nClips);

    // 화면이 다시 그려진 시각까지 — 클릭부터 새 DOM 이 안정될 때까지(2프레임 연속 같은 클립 수)
    const timed = async (label, fn, expectDelta) => {
      const before = await win.locator('.sent.clip').count();
      const t0 = Date.now();
      const apiMs = await fn();
      await win.waitForFunction(({ b, d }) => document.querySelectorAll('.sent.clip').length === b + d, { b: before, d: expectDelta }, { timeout: 30000 }).catch(() => {});
      await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const total = Date.now() - t0;
      console.log(`   ⏱ ${label}: API ${apiMs}ms · 화면까지 ${total}ms`);
      return { apiMs, total };
    };
    // 중간 클립 번호
    const mid = await win.evaluate(() => { const rows = [...document.querySelectorAll('.sent.clip[data-ln]')]; return Number(rows[Math.floor(rows.length / 2)].dataset.ln); });

    // API 왕복만(화면에 안 올림) — DTO 전달 비용
    const raw = await win.evaluate(async () => {
      const q = await window.api.listQueue(); const pr = q.dto.projects[0];
      const cut = pr.cuts[Math.floor(pr.cuts.length / 2)]; const si = Math.floor(cut.sentences.length / 2); const T = String(cut.sentences[si].text);
      const t0 = performance.now();
      const r = await window.api.splitGroupAt({ shortsNum: pr.shortsNum, at: { groupNum: cut.num, sentIdx: si, lines: [{ from: 0, to: T.length }], after: 0 } });
      const t1 = performance.now();
      const js = JSON.stringify(r.dto).length;
      await window.api.undo?.();
      return { ms: Math.round(t1 - t0), dtoKB: Math.round(js / 1024) };
    });
    console.log('   API 왕복만(화면 반영 없음):', JSON.stringify(raw));
    // 화면 경로 그대로 — 단추를 눌러 잰다
    const hover = async (n) => { const el = win.locator(`.sent.clip[data-ln="${n}"]`).first(); await el.scrollIntoViewIfNeeded(); const bx = await el.boundingBox(); await win.mouse.move(bx.x + bx.width / 2, bx.y + bx.height - 30); await win.mouse.move(bx.x + bx.width / 2, bx.y + bx.height + 6, { steps: 3 }); await win.waitForTimeout(200); };
    const midN = mid;
    if (process.env.PERF_TRACE) {
      const cdp = await win.context().newCDPSession(win); const evs = [];
      cdp.on('Tracing.dataCollected', (d) => evs.push(...d.value));
      await hover(midN);
      await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
      await win.locator(`.sent.clip[data-ln="${midN}"] [data-testid="clip-split"]`).click(); await win.waitForTimeout(1200);
      const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r)); await cdp.send('Tracing.end'); await done;
      const sum = new Map(); for (const e of evs) if (e.ph === 'X' && e.dur) sum.set(e.name, (sum.get(e.name) || 0) + e.dur);
      [...sum.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, v]) => console.log('   ◆', Math.round(v / 1000) + 'ms', k));
      const lay = evs.filter((e) => e.name === 'Layout' && e.ph === 'X').map((e) => ({ ms: Math.round(e.dur / 1000), n: e.args && e.args.beginData ? e.args.beginData.dirtyObjects + '/' + e.args.beginData.totalObjects : '' })).sort((a, b) => b.ms - a.ms).slice(0, 5);
      console.log('   ◆ Layout 상위', JSON.stringify(lay));
      await win.keyboard.press('Control+z'); await win.waitForTimeout(1500);
    }
    if (process.env.PERF_PROF) {
      const cdp = await win.context().newCDPSession(win);
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
      await hover(midN);
      await win.locator(`.sent.clip[data-ln="${midN}"] [data-testid="clip-split"]`).click(); await win.waitForTimeout(1500);
      const { profile } = await cdp.send('Profiler.stop');
      const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const dt = profile.timeDeltas; const total = dt.reduce((a, b) => a + b, 0);
      profile.samples.forEach((id, i) => { const n = byId.get(id); const key = (n.callFrame.functionName || '(anon)') + ' ' + n.callFrame.url.split('/').pop() + ':' + n.callFrame.lineNumber; self.set(key, (self.get(key) || 0) + (dt[i] || 0)); });
      console.log('   프로필 합계', Math.round(total / 1000), 'ms');
      const parent = new Map(); profile.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n.id)));
      const chain = (id) => { const o = []; let cur = parent.get(id); while (cur && o.length < 4) { const n = byId.get(cur); o.push((n.callFrame.functionName || '(anon)') + ':' + n.callFrame.lineNumber); cur = parent.get(cur); } return o.join(' < '); };
      const gbr = new Map(); profile.samples.forEach((id, i) => { const n = byId.get(id); if (/getBoundingClientRect|querySelectorAll|offsetParent|elementsFromPoint/.test(n.callFrame.functionName)) { const k = n.callFrame.functionName + ' <- ' + chain(id); gbr.set(k, (gbr.get(k) || 0) + (dt[i] || 0)); } });
      [...gbr.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, v]) => console.log('   ▸', Math.round(v / 1000) + 'ms', k));
      [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22).forEach(([k, v]) => console.log('   ', Math.round(v / 1000) + 'ms', k));
      await win.keyboard.press('Control+z'); await win.waitForTimeout(1500);
    }
    if (process.env.NO_RAIL) await win.evaluate(() => { window.__noRail = true; });
    for (const off of [0, 1, 2]) {   // 기준선 — 클립 번호만 눌러 선택(데이터는 안 바뀐다)
      const el = win.locator(`.sent.clip[data-ln="${midN + off}"] .clip-no`).first(); await el.scrollIntoViewIfNeeded();
      const t0 = Date.now(); await el.click(); await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      console.log(`   ⏱ 기준선: 클립 선택 한 번 ${Date.now() - t0}ms`);
    }
    // [1] 그룹 나누기
    await hover(midN);
    const r1 = await timed('그룹 나누기(화면 클릭)', async () => { const t0 = Date.now(); await win.locator(`.sent.clip[data-ln="${midN}"] [data-testid="clip-split"]`).click(); await win.waitForFunction(() => /그룹을 .*나눴습니다|나눴습니다/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {}); return Date.now() - t0; }, 0);
    ok(r1.total < MAX_MS, `그룹 나누기 화면 반영 ${r1.total}ms < ${MAX_MS}ms`);
    await win.keyboard.press('Control+z'); await win.waitForTimeout(1500);
    // [2] 클립 추가(AI 목소리)
    await hover(midN);
    await win.locator(`.sent.clip[data-ln="${midN}"] [data-testid="clip-add"]`).click(); await win.waitForTimeout(200);
    const r2 = await timed('클립 추가(화면 클릭)', async () => { const t0 = Date.now(); await win.locator('[data-testid="clip-add-voice"]').click(); await win.waitForFunction(() => /새 클립을 만들었습니다/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {}); return Date.now() - t0; }, 1);
    ok(r2.total < MAX_MS, `클립 추가 화면 반영 ${r2.total}ms < ${MAX_MS}ms`);
    const logTail = await win.evaluate(() => (document.querySelector('#log') || document.body).innerText.split('\n').filter((l) => /⏱/.test(l)).slice(-6).join('\n'));
    console.log(logTail || '(⏱ 로그 없음)');
  } finally {
    try { await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, chan); } catch (_) {}
    try { await win.evaluate((v) => { try { if (v == null) localStorage.removeItem('pm.clipDetail'); else localStorage.setItem('pm.clipDetail', v); } catch (_) {} }, lsDetail); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 클립 작업 속도 ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 오류:', e); process.exit(1); });
