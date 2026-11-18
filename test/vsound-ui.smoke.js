'use strict';
/**
 * node test/vsound-ui.smoke.js — 🔊 그룹 영상 소리(볼륨) · ⬆ 그룹 업스케일 실제 화면 E2E(v1.0.61)
 *   ② 그룹 메뉴 「🔊 볼륨」 → 채널 기본값 / 내레이션만 / 영상 소리만 / 섞기 + 두 음량 → 그룹 look.vsound · Ctrl+Z
 *   ② 그룹 메뉴 「⬆ 업스케일」 → 그림이 2배 사본(NN_up.png)으로 · 원본은 그대로 · Ctrl+Z
 *   채널 편집 ▸ 제작 도구 「🔊 영상 소리」 칸(저장하지 않고 닫는다)
 *   (구워지는 소리 실측은 test/vsound.test.js) · ⚠ 생성 서버를 부르지 않는다 · Real-ESRGAN 이 없으면 업스케일 칸은 건너뛴다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const TAG = `소리시험_${process.pid}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vsui-'));
const MD = path.join(TMP, `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 소리 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장입니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');
const FF = require('../core/media-utils').getFfmpegPath();
const PNG = path.join(TMP, 'small.png');

(async () => {
  try { fs.rmSync(SNAP, { force: true }); } catch {}
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90', '-frames:v', '1', PNG]);
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win, outRoot = null;   // 🧹 이 시험 대본의 출력 폴더(채널 출력 폴더 아래 <TAG>) — 업스케일 사본이 생기므로 끝에 지운다(이름이 TAG 일 때만)
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const g1 = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts[0]; });
    const menu = async () => { await win.keyboard.press('Escape'); await win.locator('.cut').nth(0).locator('.thumb').first().click(); await win.waitForSelector('[data-testid=vr-menu]', { timeout: 3000 }); };

    console.log('\n[1] 그림 첨부 → ② 그룹 메뉴에 🔊 볼륨 · ⬆ 업스케일');
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, PNG);
    await win.locator('.cut').nth(0).locator('.thumb').first().click();
    await win.click('[data-testid=vr-menu] button:has-text("첨부")');
    await win.waitForSelector('.cut img.thumb', { timeout: 5000 });
    await menu();
    ok(await win.locator('[data-testid=mn-vsnd]').count() === 1 && /내레이션만 \(채널\)|\(채널\)/.test(await win.locator('[data-testid=mn-vsnd]').innerText()), `🔊 볼륨 항목(지금: ${await win.locator('[data-testid=mn-vsnd]').innerText()})`);
    ok(await win.locator('[data-testid=mn-upscale]').count() === 1 && /그림/.test(await win.locator('[data-testid=mn-upscale]').innerText()), '⬆ 업스케일 항목(그림)');

    console.log('\n[2] 볼륨 → 영상 소리만 · 섞기 + 음량 · 채널 기본값');
    await win.click('[data-testid=mn-vsnd]');
    await win.waitForSelector('[data-testid=mn-vsnd-video]', { timeout: 2000 });
    ok(await win.locator('[data-testid=mn-vsnd-vol]').count() === 0, '처음엔 음량 막대가 없다(내레이션만)');
    await win.click('[data-testid=mn-vsnd-video]'); await win.waitForTimeout(700);
    let lk = (await g1()).look || {};
    ok(lk.vsound && lk.vsound.mode === 'video' && lk.vsound.vol === 100, `영상 소리만 → look.vsound ${JSON.stringify(lk.vsound)}`);
    ok(await win.locator('[data-testid=mn-vsnd-vol]').count() === 1 && await win.locator('[data-testid=mn-vsnd-nar]').count() === 0, '메뉴는 열린 채 영상 음량 막대가 나온다(내레이션 막대 없음)');
    await win.click('[data-testid=mn-vsnd-mix]'); await win.waitForTimeout(700);
    lk = (await g1()).look || {};
    ok(lk.vsound && lk.vsound.mode === 'mix' && lk.vsound.vol === 100 && lk.vsound.nar === 50, `섞기 → 영상 100% · 내레이션 50% ${JSON.stringify(lk.vsound)}`);
    const nar = win.locator('[data-testid=mn-vsnd-nar]');
    await nar.focus(); await nar.evaluate((el) => { el.value = '30'; }); await win.keyboard.press('ArrowLeft'); await win.waitForTimeout(700);   // ArrowLeft 로 25 · keyup 에 저장
    lk = (await g1()).look || {};
    ok(lk.vsound && lk.vsound.nar === 25 && lk.vsound.vol === 100, `내레이션 막대 → nar 25 ${JSON.stringify(lk.vsound)}`);
    await win.keyboard.press('Escape');
    await menu();
    ok(/내레이션 25% \+ 영상 100%/.test(await win.locator('[data-testid=mn-vsnd]').innerText()) && !/\(채널\)/.test(await win.locator('[data-testid=mn-vsnd]').innerText()), `메뉴 값 표시 (${await win.locator('[data-testid=mn-vsnd]').innerText()})`);
    await win.click('[data-testid=mn-vsnd]');
    await win.click('[data-testid=mn-vsnd-chan]'); await win.waitForTimeout(700);
    ok(!((await g1()).look || {}).vsound, '채널 기본값 따르기 → 그룹 값 없음');
    await win.keyboard.press('Escape');
    await win.locator('.sent[data-ln="1"] .clip-cap').first().click({ position: { x: 3, y: 3 } }).catch(() => {});
    await win.keyboard.press('Escape');
    await win.keyboard.press('Control+z'); await win.waitForTimeout(800);
    lk = (await g1()).look || {};
    ok(lk.vsound && lk.vsound.mode === 'mix', `Ctrl+Z → 직전 섞기로 ${JSON.stringify(lk.vsound)}`);

    console.log('\n[3] ⬆ 업스케일(그림)');
    const before = (await g1()).imagePath;
    if (!require('../core/upscaler').realesrganExe()) console.log('  · Real-ESRGAN 없음 — 건너뜀');
    else {
      await menu();
      await win.click('[data-testid=mn-upscale]');
      let after = before;
      for (let i = 0; i < 60 && after === before; i++) { await win.waitForTimeout(500); after = (await g1()).imagePath; }
      const dim = require('../vrew/vrew-builder').readImageSize(after);
      ok(after !== before && /_up\.png$/i.test(after) && dim && dim.w === 320 && dim.h === 180, `그림이 2배 사본으로 (${path.basename(after || '')} ${dim ? dim.w + 'x' + dim.h : '?'})`);
      ok(fs.existsSync(before), '원본 그림은 그대로 남는다');
      await win.keyboard.press('Escape');
      await win.keyboard.press('Control+z'); await win.waitForTimeout(800);
      ok((await g1()).imagePath === before, 'Ctrl+Z → 원본 그림으로');
    }

    console.log('\n[4] 채널 편집 ▸ 제작 도구 「🔊 영상 소리」(저장 없이 닫는다)');
    await win.keyboard.press('Escape');
    await win.click('button[title^="채널(프리셋)"]');
    await win.waitForTimeout(700);
    const card = win.locator('.modal-card').filter({ hasText: '폴더' }).first();
    await card.locator('button:has-text("제작 도구")').first().click();
    await win.waitForTimeout(300);
    const sel = card.locator('[data-testid=ch-vsnd]');
    ok(await sel.count() === 1, '「🔊 영상 소리」 선택 상자');
    const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value));
    ok(JSON.stringify(opts) === '["tts","video","mix"]', `선택지 ${opts.join(',')}`);
    const orig = await sel.inputValue();
    await sel.selectOption('mix'); await win.waitForTimeout(200);
    ok(await card.locator('[data-testid=ch-vsnd-vol]').inputValue() === '100' && await card.locator('[data-testid=ch-vsnd-nar]').inputValue() === '50', '섞기 → 영상 100 · 내레이션 50 칸');
    await sel.selectOption('video'); await win.waitForTimeout(200);
    ok(await card.locator('[data-testid=ch-vsnd-nar]').count() === 0 && await card.locator('[data-testid=ch-vsnd-vol]').count() === 1, '영상 소리만 → 내레이션 칸 없음');
    const body = await card.evaluate((el) => { const b = el.querySelector('.modal-body, .tabbody, .ch-body'); return b ? { sh: b.scrollHeight, ch: b.clientHeight } : null; });
    if (body) ok(body.sh <= body.ch + 2, `탭 본문이 스크롤 없이 들어간다 (${body.sh}/${body.ch})`);
    await sel.selectOption(orig);
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);

    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally {
    await app.close().catch(() => {});
    for (const f of [SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
    // 🧹 대본을 열면 채널 출력 폴더 아래 <TAG> 폴더가 생긴다(업스케일 사본도 그 안 media-1) — 채널 출력 폴더들에서 이름이 TAG 인 것만 지운다
    const roots = new Set(); try { for (const p of require('../tts/preset-store').loadAll()) { const o = p.outLong || p.outputFolder; if (o) roots.add(o); } } catch {}
    for (const r of roots) { const d = path.join(r, TAG); if (fs.existsSync(d)) { outRoot = d; try { fs.rmSync(d, { recursive: true, force: true }); } catch {} if (fs.existsSync(d)) { fail++; console.log('  ✗ 시험 출력 폴더를 지우지 못했다: ' + d); } } }
  }
  console.log(fail ? `\n❌ vsound-ui ${pass}/${pass + fail}` : `\n✅ vsound-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
