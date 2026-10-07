'use strict';
/**
 * node test/channel-queue.smoke.js — 🔀 채널을 바꾸면 롱폼 대본 큐가 비워진다(v0.7.26 · 로이) · 실제 앱 E2E
 *   임시 대본 하나를 열고 → 같은 채널 다시 고르기(안 비움) → 다른 채널 고르기(비움 · ♻ 지난 큐로 되살릴 수 있음)
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
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `[역사_9997] ${TAG}.smproj.json`);
const PRESETS = path.join(os.homedir(), '.flow-app', 'tts-presets.json');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const qLen = (win) => win.evaluate(async () => { const r = await window.api.listQueue(); return ((r.queue && r.queue.longform && r.queue.longform.items) || []).length; });

(async () => {
  fs.writeFileSync(MD, ['# 채널 큐 테스트', '', '## 1장', '', '> 🖼️ 이미지: a quiet room.', '첫 문장입니다. 둘째 문장입니다.', ''].join('\n'), 'utf8');
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
    const other = opts.find((v) => v !== cur);
    ok(!!other && opts.length >= 2, `채널이 둘 이상 있다 (${opts.length}개 · 지금 「${cur}」)`);
    ok(await qLen(win) === 1, '대본 하나를 열어 큐에 1개');

    console.log('[1] 같은 채널을 다시 고르면 큐는 그대로');
    await sel.selectOption(cur); await win.waitForTimeout(800);
    ok(await qLen(win) === 1, '같은 채널 → 큐 1개 그대로');

    console.log('[2] 다른 채널로 바꾸면 큐가 비워진다');
    await sel.selectOption(other); await win.waitForTimeout(1500);
    ok(await qLen(win) === 0, `「${other}」 로 바꾸면 큐 0개`);
    ok((await win.locator('.sblk').count()) === 0, '화면의 대본도 비워진다');
    ok(/채널 변경 — 대본 큐 1개를 비웠습니다/.test(await win.locator('body').innerText()), '상태줄에 안내');
    ok(await win.locator('[data-testid="last-queue"]').isVisible(), '♻ 지난 큐 다시 열기가 나타난다');

    console.log('[3] 지난 큐로 되살린다(작업본은 그대로)');
    await win.locator('[data-testid="last-queue"] button').click(); await win.waitForTimeout(2500);
    ok(await qLen(win) === 1, '♻ 지난 큐 다시 열기 → 큐 1개');
    ok(errs.length === 0, `화면 오류 0건 (${errs.join(' | ')})`);
  } finally { await app.close().catch(() => {}); }

  const after = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS) : null;
  ok((!before && !after) || (before && after && Buffer.compare(before, after) === 0), '로이 채널 설정 파일(tts-presets.json) 불변');
  try { fs.rmSync(SNAP, { force: true }); } catch (_) {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

  // 소스 배선 — 작업 중이면 비우지 않는다 · 헤더 select 만 부른다
  const M = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const h = M.slice(M.indexOf("ipcMain.handle('clear-longform-queue'"), M.indexOf("ipcMain.handle('clear-longform-queue'") + 1200);
  ok(/_awake\.n > 0/.test(h) && h.indexOf('_awake.n > 0') < h.indexOf('q.items = []'), '작업(절전 차단) 중이면 비우기 전에 돌아간다');
  const A = fs.readFileSync(path.join(ROOT, 'renderer/src/App.jsx'), 'utf8');
  ok((A.match(/api\.clearLongformQueue\(/g) || []).length === 1 && /name !== presetName && !queueBusy/.test(A), '채널이 실제로 바뀔 때만 · 큐 순차 제작 중이 아닐 때만 부른다(한 곳)');
  console.log(fail ? `\n❌ 채널 변경 큐 비우기 E2E ${pass}/${pass + fail}` : `\n✅ 채널 변경 큐 비우기 E2E ${pass}/${pass}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
