'use strict';
/**
 * node test/record.smoke.js — 🎤 녹음해서 덮어쓰기(Lab · 남은 기능 ⑦) 실제 앱 E2E
 *   가짜 마이크(PM_UI_SMOKE 가 Chromium 스위치로 켠다) → 녹음 시작·정지 → 미리듣기 → 덮어쓰기: 문장 ow · 음성 길이 ≈ 녹음 길이 · 되돌리기
 *   ⚠ 진짜 마이크·허용 창을 쓰지 않는다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const TAG = `녹음시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 녹음 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');
(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  console.log('\n[1] 소스 배선');
  const M = read('main.js'), PL = read('preload.js'), APP = read('renderer/src/App.jsx'), BS = read('bootstrap.js');
  ok(/ipcMain\.handle\('rec-save'/.test(M) && /recSave: \(args\)/.test(PL) && /data-testid="rec-panel"/.test(APP) && /tid="cx-rec"/.test(APP) && /data-testid="rb-record"/.test(APP), 'IPC · preload · 패널 · 우클릭 · 홈 탭 단추');
  ok(/use-fake-device-for-media-stream/.test(BS) && /if \(process\.env\.PM_UI_SMOKE\)/.test(BS.slice(BS.indexOf('use-fake-device') - 200, BS.indexOf('use-fake-device'))), '가짜 마이크 스위치는 E2E(PM_UI_SMOKE)일 때만');
  console.log('\n[2] 실제 앱');
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow(); win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const ow = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts.flatMap((c) => c.sentences || []).map((s) => ({ ow: s.ow ? 1 : 0, dur: s.dur || null })); });
    const ctx = async (ln) => { await win.locator(`.sent[data-ln="${ln}"] .clip-r1`).first().click({ button: 'right', position: { x: 4, y: 4 } }); await win.waitForSelector('[data-testid="clip-ctx"]'); };
    // 여러 클립을 고르면 거절
    await win.keyboard.press('Escape'); await win.locator('.sent[data-ln="1"] .clip-chk').first().click(); await win.locator('.sent[data-ln="2"] .clip-chk').first().click(); await win.waitForTimeout(250);
    await ctx(1); await win.click('[data-testid="cx-rec"]'); await win.waitForTimeout(400);
    ok(await win.locator('[data-testid="rec-panel"]').count() === 0, '클립을 둘 이상 고르면 패널이 열리지 않는다(녹음 하나 = 문장 하나)');
    // 하나만
    await win.keyboard.press('Escape'); await win.locator('.sent[data-ln="1"] .clip-chk').first().click(); await win.waitForTimeout(250);
    await ctx(1); ok(await win.locator('[data-testid="cx-rec"].soon').count() === 0, '우클릭 ▸ 녹음해서 덮어쓰기는 준비 중이 아니다');
    await win.click('[data-testid="cx-rec"]'); await win.waitForSelector('[data-testid="rec-panel"]', { timeout: 3000 });
    ok(await win.locator('[data-testid="rec-apply"]').isDisabled(), '녹음 전에는 「덮어쓰기」가 막혀 있다');
    await win.click('[data-testid="rec-start"]'); await win.waitForSelector('[data-testid="rec-live"]', { timeout: 8000 });
    ok(await win.locator('[data-testid="rec-stop"]').count() === 1, '녹음 중 표시 · 정지 단추');
    await win.waitForTimeout(2600);
    await win.click('[data-testid="rec-stop"]'); await win.waitForSelector('[data-testid="rec-audio"]', { timeout: 8000 });
    ok(await win.locator('[data-testid="rec-apply"]').isEnabled() && await win.locator('[data-testid="rec-audio"]').count() === 1, '정지 → 미리듣기 · 덮어쓰기 열림');
    await win.click('[data-testid="rec-apply"]'); await win.waitForTimeout(3500);
    const s = await ow();
    ok(s[0].ow === 1 && s[1].ow === 0 && s[2].ow === 0, `고른 문장(1번)만 내 녹음으로 덮어씀 ${JSON.stringify(s.map((x) => x.ow))}`);
    ok(s[0].dur > 2 && s[0].dur < 5, `음성 길이 ≈ 녹음 길이(${s[0].dur && s[0].dur.toFixed(2)}초 · 약 2.6초 녹음)`);
    ok(await win.locator('[data-testid="rec-panel"]').count() === 0 && await win.locator('[data-testid="clip-own"]').count() === 1, '패널이 닫히고 🎙 배지');
    await win.evaluate(async () => window.api.undo({})); await win.waitForTimeout(700);
    ok((await ow())[0].ow === 0, '되돌리기 → 덮어쓰기 전');
    // 저장 IPC 의 방어
    const bad1 = await win.evaluate(async () => window.api.recSave({ bytes: new Uint8Array(10) }));
    const bad2 = await win.evaluate(async () => window.api.recSave({ bytes: new Uint8Array(500).fill(7) }));
    ok(bad1.ok === false && bad2.ok === false && /소리/.test(bad2.error), '너무 짧거나 소리가 아닌 데이터는 거부: ' + bad2.error);
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally { await app.close().catch(() => {}); for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} } }
  console.log(fail ? `\n❌ record ${pass}/${pass + fail}` : `\n✅ record ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
