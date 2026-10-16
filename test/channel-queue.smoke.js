'use strict';
/**
 * node test/channel-queue.smoke.js — 🔀 작업 순서에 여러 채널 대본 섞기(v0.9.42 · 로이 2026-10-16) · 실제 앱 E2E
 *   대본 A 를 열고 → 다른 채널로 바꿔도 작업 순서는 그대로(옛 v0.7.26 「비운다」 폐기) → 대본 B 를 열면 새 채널로 들어간다
 *   → A 는 자기 채널·설정 그대로(헤더의 다른 채널 값이 A 에 쓰이지 않는다).
 * ⚠ 채널 목록은 로이 PC 의 실제 채널을 읽기만 한다(고르기만 · 저장하지 않는다) · 큐 파일·Electron 저장 공간은 TEMP(PM_UI_SMOKE).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TAG = `__채널큐테스트_${process.pid}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chq-e2e-'));
const MD = path.join(TMP, `[역사_9997] ${TAG}.md`);
const MD2 = path.join(TMP, `[역사_9996] ${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `[역사_9997] ${TAG}.smproj.json`);
const SNAP2 = path.join(os.homedir(), '.priming-maker', 'projects', `[역사_9996] ${TAG}.smproj.json`);
const PRESETS = path.join(os.homedir(), '.flow-app', 'tts-presets.json');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const qItems = (win) => win.evaluate(async () => { const r = await window.api.listQueue(); return ((r.queue && r.queue.longform && r.queue.longform.items) || []).map((x) => ({ title: x.title, ch: x.settings && x.settings.presetName, settings: x.settings })); });
const qLen = (win) => win.evaluate(async () => { const r = await window.api.listQueue(); return ((r.queue && r.queue.longform && r.queue.longform.items) || []).length; });

(async () => {
  fs.writeFileSync(MD, ['# 채널 큐 테스트', '', '## 1장', '', '> 🖼️ 이미지: a quiet room.', '첫 문장입니다. 둘째 문장입니다.', ''].join('\n'), 'utf8');
  fs.writeFileSync(MD2, ['# 채널 큐 테스트 둘', '', '## 1장', '', '> 🖼️ 이미지: a quiet hill.', '다른 채널 첫 문장입니다.', ''].join('\n'), 'utf8');
  const before = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS) : null;
  const errs = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sblk', { timeout: 20000 });
    const sel = win.locator('select[title^="채널(프리셋)"]');
    const opts = await sel.locator('option:not([disabled])').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    const cur = await sel.inputValue();
    // 롱폼으로 시작하는 채널만(리모션·출판 채널을 고르면 화면 모드가 바뀌어 다른 큐로 간다)
    const lf = await win.evaluate(async (names) => { const out = []; for (const n of names) { const p = await window.api.getPresetDetail(n); const sm = p && p.startMode; if (sm !== 'book' && sm !== 'remotion') out.push(n); } return out; }, opts);
    const other = lf.find((v) => v !== cur);
    ok(!!other && opts.length >= 2, `채널이 둘 이상 있다 (${opts.length}개 · 지금 「${cur}」)`);
    ok(await qLen(win) === 1, '대본 하나를 열어 큐에 1개');

    console.log('[1] 같은 채널을 다시 고르면 큐는 그대로');
    await sel.selectOption(cur); await win.waitForTimeout(800);
    ok(await qLen(win) === 1, '같은 채널 → 큐 1개 그대로');

    console.log('[2] 다른 채널로 바꿔도 작업 순서는 그대로');
    const a0 = (await qItems(win))[0];
    await sel.selectOption(other); await win.waitForTimeout(1500);
    ok(await qLen(win) === 1, `「${other}」 로 바꿔도 작업 순서 1개 그대로`);
    ok((await win.locator('.sblk').count()) > 0, '화면의 대본도 그대로');

    console.log('[3] 새 대본은 새 채널로 · 먼저 든 대본은 자기 채널·설정 그대로');
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD2);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForTimeout(2500);
    const its = await qItems(win);
    ok(its.length === 2, `작업 순서 2개 (${its.map((x) => x.ch).join(' · ')})`);
    ok(its[0].ch === cur && its[1].ch === other, `대본마다 자기 채널 — A=「${its[0].ch}」 B=「${its[1].ch}」`);
    await win.waitForTimeout(800);
    const a1 = (await qItems(win))[0];
    ok(JSON.stringify(a1.settings) === JSON.stringify(a0.settings), '헤더를 다른 채널로 바꾼 동안 A 의 설정(배속·스타일 등)이 바뀌지 않는다');
    const chips = await win.locator('[data-testid="q-row"]').evaluateAll((els) => els.map((e) => e.textContent));
    ok(chips.length === 2 && chips.some((t) => t.includes(cur.replace(/^\d+_/, ''))) && chips.some((t) => t.includes(other.replace(/^\d+_/, ''))), '작업 순서 줄에 채널 이름이 보인다: ' + chips.map((t) => t.replace(/s+/g, ' ')).join(' / '));

    console.log('[4] A 를 누르면 헤더가 A 채널로');
    await win.locator('[data-testid="q-row"]').first().click(); await win.waitForTimeout(1500);
    ok(await sel.inputValue() === cur, `헤더 채널 = 「${cur}」`);
    ok(await qLen(win) === 2, '작업 순서 2개 그대로');
    ok(errs.length === 0, `화면 오류 0건 (${errs.join(' | ')})`);
  } finally { await app.close().catch(() => {}); }

  const after = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS) : null;
  ok((!before && !after) || (before && after && Buffer.compare(before, after) === 0), '로이 채널 설정 파일(tts-presets.json) 불변');
  try { fs.rmSync(SNAP, { force: true }); fs.rmSync(SNAP2, { force: true }); } catch (_) {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

  // 소스 배선 — 작업 중이면 비우지 않는다 · 헤더 select 만 부른다
  const M = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const h = M.slice(M.indexOf("ipcMain.handle('clear-longform-queue'"), M.indexOf("ipcMain.handle('clear-longform-queue'") + 1200);
  ok(/_awake\.n > 0/.test(h) && h.indexOf('_awake.n > 0') < h.indexOf('q.items = []'), '작업(절전 차단) 중이면 비우기 전에 돌아간다');
  const A = fs.readFileSync(path.join(ROOT, 'renderer/src/App.jsx'), 'utf8');
  ok((A.match(/api\.clearLongformQueue\(/g) || []).length === 0, '채널을 바꿔도 작업 순서를 비우지 않는다(clearLongformQueue 를 부르는 곳 0)');
  ok(/if \(ns\.presetName && ns\.presetName !== it\.settings\.presetName\) return true;/.test(M), 'set-queue-settings: 다른 채널 헤더 값은 그 대본에 쓰지 않는다');
  console.log(fail ? `\n❌ 채널 섞기 E2E ${pass}/${pass + fail}` : `\n✅ 채널 섞기 E2E ${pass}/${pass}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
