'use strict';
/**
 * node test/relink-work.smoke.js — 🔗 「다시 연결」 버튼 E2E (v0.9.94 · 로이 2026-10-21 「다시 쓰고 싶다」)
 *   실제 앱: 대본을 연 뒤 출력 폴더 media-1 에 그림(01.png)·영상(02.mp4)을 넣는다 → ① 대본·음성 리본의 🔗 다시 연결이
 *   보이고 실제로 눌린다(elementFromPoint) → 확인창 「예」 → 상태 줄 「🔗 그림 1 · 영상 1」 → 화면에 그 그림 · Ctrl+Z 로 되돌아간다.
 *   1366px 리본 넘침 0 · 1075px 은 되살리기 전(56px)보다 늘지 않고 눌린다(🔊·🔗 위아래 칸).
 *   ⚠ 임시 채널·임시 대본·임시 출력폴더만 쓴다.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const FF = require('../core/media-utils').getFfmpegPath();
const TAG = `__다시연결_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 다시 연결 테스트', '', '## 본편', '',
  '### 하나', '> 🖼️ 이미지: a quiet mountain village at dawn', '첫 문장입니다.', '',
  '### 둘', '> 🖼️ 이미지: a river under the moon', '둘째 문장입니다.', ''].join('\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__다시연결채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relink-e2e-'));
  const media = path.join(outDir, TAG, 'media-1');
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('dialog', (d) => d.accept().catch(() => {}));   // uiConfirm(window.confirm) = 예
    await win.waitForSelector('h1', { timeout: 20000 });
    ok(await win.evaluate(async ({ name, dir }) => { try { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); return true; } catch (_) { return false; } }, { name: chan, dir: outDir }), '임시 채널');
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(600);
    await require('./_menu')(win, 'voice');
    const btn = win.locator('[data-testid="relink-work"]');
    ok(await btn.count() === 1 && await btn.isDisabled(), '대본이 없으면 🔗 다시 연결은 눌리지 않는다(disabled)');
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await require('./_menu')(win, 'home');
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    await win.waitForTimeout(600);
    await require('./_menu')(win, 'voice');
    const html0 = await win.evaluate(() => document.body.innerHTML);
    ok(!/media-1[\\/%2F5Cc]*01\.png/i.test(html0) && !html0.includes('01.png'), '열었을 때는 그림이 비어 있다');

    // 출력 폴더에 파일만 남아 있는 상황
    fs.mkdirSync(media, { recursive: true });
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x6a8fbf:s=1920x1080', '-frames:v', '1', path.join(media, '01.png')]);
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x8f6abf:s=1920x1080', '-f', 'lavfi', '-i', 'anullsrc', '-t', '1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(media, '02.png.tmp.mp4')]);
    fs.renameSync(path.join(media, '02.png.tmp.mp4'), path.join(media, '02.mp4'));

    for (const [w, h] of [[1366, 800], [1075, 760]]) {
      await win.setViewportSize({ width: w, height: h }); await win.waitForTimeout(400);
      const g = await btn.evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); const rb = document.querySelector('[data-testid="ribbon"]'); return { hit: !!t && el.contains(t), vis: r.width > 0 && r.right <= window.innerWidth, over: rb ? rb.scrollWidth - rb.clientWidth : -1, body: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
      ok(g.hit && g.vis && g.body <= 0, `${w}px: 🔗 다시 연결이 보이고 실제로 눌린다(elementFromPoint · 리본 넘침 ${g.over}px · 문서 넘침 ${g.body}px)`);
      // 1366px = 대본·음성 리본 한 줄(되살리기 전 0px) · 1075px = 되살리기 전 56px 보다 늘지 않는다(🔊·🔗 위아래 · 좁으면 아이콘만)
      ok(w === 1366 ? g.over <= 0 : g.over <= 56, `${w}px: 리본 가로 넘침 ${g.over}px (기준 ${w === 1366 ? 0 : 56}px 이하)`);
    }
    await btn.click();
    await win.waitForFunction(() => /🔗 그림 \d+ · 영상 \d+/.test(document.body.innerText), null, { timeout: 15000 });
    const st = await win.evaluate(() => (/🔗 그림 \d+ · 영상 \d+ · 음성 \d+[^\n]*/.exec(document.body.innerText) || [''])[0]);
    ok(/🔗 그림 1 · 영상 1/.test(st), `상태 줄: ${st}`);
    await win.waitForTimeout(600);
    const html1 = await win.evaluate(() => document.body.innerHTML);
    ok(html1.includes('01.png'), '🔑 화면 그룹 1 에 출력 폴더의 그림(01.png)이 다시 붙었다');

    // Ctrl+Z = 되돌리기(undoPush('작업물 다시 연결'))
    await win.locator('h1').first().click().catch(() => {});
    await win.keyboard.press('Control+z'); await win.waitForTimeout(1200);
    const html2 = await win.evaluate(() => document.body.innerHTML);
    ok(!html2.includes('01.png'), 'Ctrl+Z 로 연결 전으로 돌아간다');
    ok(fs.existsSync(path.join(media, '01.png')) && fs.existsSync(path.join(media, '02.mp4')), '되돌려도 출력 폴더의 파일은 그대로');
    ok(errors.length === 0, '화면 오류 0건 ' + errors.join(' / ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외: ' + e.stack); }
  finally {
    try { await win.evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, chan); } catch {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 다시 연결 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
