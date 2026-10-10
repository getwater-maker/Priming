'use strict';
/**
 * node test/find-clips.smoke.js — 🔎 작업 화면 검색: 클립 이동(Enter/↓ 다음 · Shift+Enter/↑ 이전) · 목록만 칠하기 · 다 지워도 포커스 유지(v0.7.54)
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
    const inp = win.locator('#find-input');
    const cnt = async () => (await win.locator('.fcnt').innerText()).trim();
    const curN = () => win.evaluate(() => { const c = document.querySelector('.sent.cur'); return c ? Number(c.getAttribute('data-ln')) : null; });
    await inp.click(); await win.keyboard.type('5번째'); await win.waitForTimeout(900);
    ok(await cnt() === '1/8', `8곳 중 첫 일치 「${await cnt()}」`);
    const n1 = await curN();
    await win.keyboard.press('Enter'); await win.waitForTimeout(500);
    const n2 = await curN();
    ok(await cnt() === '2/8' && n2 > n1, `Enter = 다음 클립 (${n1}→${n2} · ${await cnt()})`);
    await win.keyboard.press('Shift+Enter'); await win.waitForTimeout(500);
    ok((await curN()) === n1 && await cnt() === '1/8', `Shift+Enter = 이전 클립 (${await curN()})`);
    await win.keyboard.press('ArrowUp'); await win.waitForTimeout(500);
    ok(await cnt() === '8/8', `↑ = 이전(처음에서 끝으로 돌아감) 「${await cnt()}」`);
    await win.keyboard.press('ArrowDown'); await win.waitForTimeout(500);
    ok(await cnt() === '1/8', `↓ = 다음 「${await cnt()}」`);
    const hl = await win.evaluate(() => {
      const a = CSS.highlights.get('pm-find'), c = CSS.highlights.get('pm-find-cur');
      const rs = [...(a || []), ...(c || [])];
      return { n: rs.length, inStage: rs.filter((r) => r.startContainer.parentElement && r.startContainer.parentElement.closest('#stageCap')).length, inList: rs.filter((r) => r.startContainer.parentElement && r.startContainer.parentElement.closest('main.pane2')).length, cur: c ? [...c].length : 0 };
    });
    ok(hl.n >= 8 && hl.inStage === 0 && hl.inList === hl.n && hl.cur >= 1, `목록만 칠한다 (${JSON.stringify(hl)})`);
    // ☑ 검색된 클립 모두 선택
    await win.locator('[data-testid=find-selall]').click(); await win.waitForTimeout(400);
    const picked = await win.locator('main.pane2 .sent.clip.picked').count();
    ok(picked === 8, `☑ 모두 → 검색된 8개 클립이 체크된다 (${picked})`);
    if (process.env.FIND_SHOT) { await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 700); }); await win.waitForTimeout(500); await win.screenshot({ path: process.env.FIND_SHOT, clip: { x: 766, y: 0, width: 600, height: 80 } }); await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 820); }); await win.waitForTimeout(300); }
    { const bb = await win.locator('[data-testid=find-selall]').boundingBox(); ok(bb && bb.width < 50 && bb.height < 40, `☑ 단추가 한 칸에 들어간다 (${bb && Math.round(bb.width)}x${bb && Math.round(bb.height)})`); }
    // 🔑 포커스를 (사람이 아닌) 프로그램이 빼앗아도 검색창이 되찾는다 · 사람이 다른 곳을 누르면 그대로 떠난다
    await inp.click(); await win.waitForTimeout(800); await win.evaluate(() => document.activeElement.blur()); await win.waitForTimeout(150);
    ok((await win.evaluate(() => document.activeElement && document.activeElement.id)) === 'find-input', '포커스를 잃어도(프로그램이 가져감) 검색창이 되찾는다');
    await win.mouse.click(5, 400); await win.waitForTimeout(200);
    ok((await win.evaluate(() => document.activeElement && document.activeElement.id)) !== 'find-input', '사람이 다른 곳을 누르면 검색창을 떠난다');
    // v0.7.80 — 바깥(배경)을 누르면 선택이 번호 클릭과 같은 것으로 바뀌어 막대가 꺼진다 → 막대는 체크박스로 다시 켠다
    await win.locator('main.pane2 .sent.clip .clip-chk').first().click(); await win.waitForTimeout(300);
    // 창이 낮아 도구 막대가 아래쪽에 있어도 하위 메뉴(삽입·효과·목소리 수정)가 화면 안에 펼쳐진다
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 460); }); await win.waitForTimeout(600);
    for (const id of ['ctb-voice', 'ctb-ins', 'ctb-fx']) {
      const btn = win.locator('[data-testid=' + id + ']');
      if (!(await btn.count())) { ok(false, id + ' 단추가 없다'); continue; }
      await btn.click(); await win.waitForTimeout(250);
      const r = await win.evaluate((i) => { const m = document.querySelector('[data-testid=' + i + '-menu]'); if (!m) return null; const b = m.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: innerHeight }; }, id);
      ok(r && r.top >= 0 && r.bottom <= r.vh + 1, `${id} 메뉴가 화면 안 (${JSON.stringify(r)})`);
      await btn.click(); await win.waitForTimeout(150);
    }
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 820); }); await win.waitForTimeout(400);
    // 전부 지워도 포커스 유지 → 바로 다시 입력
    await inp.click(); await win.keyboard.press('End'); await win.waitForTimeout(300);
    for (let i = 0; i < 6; i++) { await win.keyboard.press('Backspace'); await win.waitForTimeout(80); }
    await win.waitForTimeout(500);
    ok(await inp.inputValue() === '', '전부 지웠다 (「' + await inp.inputValue() + '」 포커스 ' + await win.evaluate(() => (document.activeElement && (document.activeElement.id || document.activeElement.tagName)))+ ')');
    ok((await win.evaluate(() => document.activeElement && document.activeElement.id)) === 'find-input', '다 지운 뒤에도 포커스가 검색창에');
    await win.keyboard.type('3장'); await win.waitForTimeout(800);
    ok(await inp.inputValue() === '3장' && /^\d+\/10$/.test(await cnt()), `바로 다시 입력된다 (「${await inp.inputValue()}」 ${await cnt()})`);
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
    ok((await win.evaluate(() => CSS.highlights.size)) === 0, 'Esc 로 강조도 지움');
    ok(errors.length === 0, '화면 오류 0건 (' + errors.join(' | ') + ')');
  } finally {
    if (chMade) { try { await (await app.firstWindow()).evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    await app.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); fs.rmSync(SNAP, { force: true }); } catch (_) {}
  }
  const presetsAfter = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS, 'utf8') : null;
  ok(presetsBefore === presetsAfter, '로이 채널 설정(tts-presets.json) 전후 동일');
  console.log(`\n${fail ? '❌' : '✅'} 검색 클립 이동 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
