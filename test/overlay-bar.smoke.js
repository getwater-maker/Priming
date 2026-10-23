'use strict';
/**
 * node test/overlay-bar.smoke.js — ➕ 삽입 그림을 ① 칸에서 누르면 뜨는 세로 도구 막대(채우기·애니메이션·순서·불투명도·자르기·반전·교체) — 실제 앱 E2E (v0.9.104)
 *   임시 채널·임시 대본을 쓴다 — 사용자 작업물은 건드리지 않는다. (npm run build:renderer 뒤에 돌린다)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const FF = require('../core/media-utils').getFfmpegPath();

const ROOT = path.join(__dirname, '..');
const TAG = `__삽입막대_${process.pid}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ovbar-'));
const MD = path.join(TMP, `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const CH = '__테스트채널_삭제해도됨_막대_' + process.pid;
const SCRIPT = ['# 삽입 막대', '', '## 1장', '### 하나', '> 🖼️ 이미지: a', '첫째 문장입니다.', '', '### 둘', '> 🖼️ 이미지: b', '둘째 문장입니다.', '', '### 셋', '> 🖼️ 이미지: c', '셋째 문장입니다.', ''].join('\n');
const img = (n, c, s = '1920x1080') => { const f = path.join(TMP, n + '.png'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=${s}`, '-frames:v', '1', f]); return f; };

let pass = 0, fail = 0, chMade = false;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

(async () => {
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const BLUE = img('blue', 'blue', '1200x600');
  const GREEN = img('green', 'green', '600x600');
  const RED = img('red', 'red', '1920x1080');
  const TONE = path.join(TMP, 'tone.wav');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=8', TONE]);
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const stub = (p) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, p);
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1600, 950); });
    await win.evaluate(async ({ name, dir, tone }) => {
      const ps = (await window.api.listPresets()) || [];
      for (const p of ps) if (p.name.indexOf('__테스트채널_삭제해도됨_막대_') === 0) { try { await window.api.removePreset({ name: p.name }); } catch (_) {} }
      await window.api.addPreset({ name });
      await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, voiceCloneRefAudio: tone } });
    }, { name: CH, dir: TMP, tone: TONE });
    chMade = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((n) => [...document.querySelectorAll('select option')].some((o) => o.value === n), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await win.waitForTimeout(800);
    await stub(MD);
    await win.click('.ribbon button:has-text("열기")');
    await win.waitForSelector('.sblk[data-ord]', { timeout: 20000 });

    const ovs = () => win.evaluate(async () => { const r = await window.api.listQueue(); return (r && r.dto && r.dto.projects[0].overlays) || []; });
    const op = (a) => win.evaluate(async (a) => window.api.overlayOp({ shortsNum: 1, ...a }), a);
    const menu = async (t) => win.locator(`.menubar button:text-is("${t}")`).first().click();

    console.log('[1] 삽입 두 개 넣고(파랑 2:1 · 초록 1:1) ① 칸에서 위의 것을 누른다');
    await menu('삽입');
    await stub(BLUE); await win.click('[data-testid=ins-image]');
    await win.waitForSelector('[data-testid=ins-menu]', { timeout: 5000 }); await win.keyboard.press('Escape'); await win.mouse.click(5, 900);
    await stub(GREEN); await win.click('[data-testid=ins-image]');
    await win.waitForSelector('[data-testid=ins-menu]', { timeout: 5000 }); await win.keyboard.press('Escape'); await win.mouse.click(5, 900);
    let L = await ovs();
    ok(L.length === 2 && L.every((o) => o.dim && o.dim.w > 0), `삽입 2개 · 원본 크기(dim) 기록 (${JSON.stringify(L.map((o) => o.dim))})`);
    await win.waitForSelector('#stageVisual .vlayer[data-num^="O"]', { timeout: 5000 });
    const sv = await win.locator('#stageVisual').boundingBox();
    await win.mouse.click(sv.x + sv.width / 2, sv.y + sv.height / 2);
    await win.waitForSelector('[data-testid=stage-vtb]', { timeout: 3000 });
    const n = await win.locator('[data-testid=stage-vtb] .vtb-b').count();
    ok(n === 7, `삽입용 세로 막대 7개(채우기·애니메이션·순서·불투명도·자르기·반전·교체) — ${n}`);
    const tids = await win.locator('[data-testid=stage-vtb] .vtb-b').evaluateAll((els) => els.map((e) => e.dataset.testid));
    ok(['vtb-fill', 'vtb-motion', 'vtb-ord', 'vtb-opac', 'vtb-crop', 'vtb-flip', 'vtb-replace'].every((t) => tids.includes(t)), '버튼 이름표');
    const topId = (await win.evaluate(() => document.querySelector('#stage .ssel-tag') && document.querySelector('#stage .ssel-tag').textContent));
    ok(/삽입/.test(topId || ''), '선택 표시 = ➕ 삽입');

    console.log('\n[2] 반전 · 불투명도 · 자르기 · 채우기');
    const selId = () => win.evaluate(() => { const l = [...document.querySelectorAll('#stageVisual .vlayer[data-num^="O"]')].pop(); return l ? l.dataset.num.slice(1) : null; });
    const id = await selId();
    const cur = async () => (await ovs()).find((o) => o.id === id);
    await win.click('[data-testid=vtb-flip]'); await win.click('[data-testid=sx-flip-h]');
    await win.waitForTimeout(500);
    ok((await cur()).flipH === true, 'DTO flipH');
    ok(/scale\(-1, ?1\)/.test(await win.evaluate((i) => { const e = document.querySelector(`#stageVisual .vlayer[data-num="O${i}"] .vlook`); return e ? e.style.transform : ''; }, id)), '① 칸에 좌우 반전이 보인다');
    await win.waitForSelector('[data-testid=stage-vtb]', { timeout: 3000 });
    const slide = async (tid, v) => win.evaluate(({ tid, v }) => { const el = document.querySelector(`[data-testid=${tid}]`); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); }, { tid, v });
    await win.click('[data-testid=vtb-opac]');
    await win.waitForSelector('[data-testid=sx-opac]', { timeout: 3000 });
    await slide('sx-opac', 40); await win.waitForTimeout(500);
    ok((await cur()).opacity === 40, 'DTO opacity 40');
    ok(await win.evaluate((i) => { const e = document.querySelector(`#stageVisual .vlayer[data-num="O${i}"]`); return e && Math.abs(parseFloat(e.style.opacity) - 0.4) < 0.01; }, id), '① 칸 불투명도 0.4');
    await win.click('[data-testid=sx-opac-reset]'); await win.waitForTimeout(500);
    ok((await cur()).opacity == null, '100% 로 되돌리면 필드가 없다');
    await win.click('[data-testid=vtb-crop]');
    await win.waitForSelector('[data-testid=sx-crop-l]', { timeout: 3000 });
    await slide('sx-crop-l', 25); await win.waitForTimeout(500);
    const cc = (await cur()).crop;
    ok(cc && Math.abs(cc.l - 0.25) < 0.001, `DTO crop.l 0.25 (${JSON.stringify(cc)})`);
    ok(await win.evaluate((i) => !!document.querySelector(`#stageVisual .vlayer[data-num="O${i}"] .vcrop img`), id), '① 칸 — 잘린 그림(.vcrop)');
    await win.click('[data-testid=sx-crop-reset]'); await win.waitForTimeout(500);
    ok(!(await cur()).crop, '자르기 없애기');
    await win.waitForSelector('[data-testid=stage-vtb]', { timeout: 3000 });
    await win.click('[data-testid=vtb-fill]'); await win.waitForTimeout(500);
    ok((await cur()).fill === 'cover', '채우기 → fill cover');
    ok(await win.evaluate((i) => { const e = document.querySelector(`#stageVisual .vlayer[data-num="O${i}"]`); return e && (parseFloat(e.style.width) >= 99.9 && parseFloat(e.style.height) >= 99.9); }, id), '① 칸 — 화면 전체를 덮는다(빈 곳 없음)');
    await win.click('[data-testid=vtb-fill]'); await win.waitForTimeout(400);
    ok((await cur()).fill == null, '한 번 더 누르면 맞추기로');

    console.log('\n[3] 애니메이션(그룹 그림과 같은 8종 중 삽입은 줌·팬 6종) · 순서');
    await win.waitForSelector('[data-testid=stage-vtb]', { timeout: 3000 });
    await win.click('[data-testid=vtb-motion]');
    ok(await win.locator('[data-testid^=sx-motion-]').count() === 7, '없음 + 6종');
    await win.click('[data-testid=sx-motion-lr]'); await win.waitForTimeout(500);
    ok((await cur()).motion === 'lr', 'DTO motion lr');
    ok(await win.evaluate((i) => !!document.querySelector(`#stageVisual .vlayer[data-num="O${i}"] img.kb2`), id), '① 칸 — 좌→우 움직임(kb2)');
    await win.waitForSelector('[data-testid=stage-vtb]', { timeout: 3000 });
    await win.click('[data-testid=vtb-ord]'); await win.click('[data-testid=sx-ord-back]'); await win.waitForTimeout(500);
    L = await ovs();
    ok(L[0].id === id, '맨 뒤로 → 목록 맨 앞(= 가장 아래)');
    await win.waitForSelector('[data-testid=stage-vtb]', { timeout: 3000 });
    await win.click('[data-testid=vtb-ord]'); await win.click('[data-testid=sx-ord-front]'); await win.waitForTimeout(500);
    L = await ovs();
    ok(L[L.length - 1].id === id, '맨 앞으로 → 목록 맨 끝(= 가장 위)');
    await win.waitForSelector('[data-testid=stage-vtb]', { timeout: 3000 });
    await win.click('[data-testid=vtb-ord]'); await win.click('[data-testid=sx-ord-down]'); await win.waitForTimeout(500);
    L = await ovs();
    ok(L[0].id === id, '뒤로 → 한 층 아래');

    console.log('\n[4] 교체 — 범위·모양은 그대로 파일만');
    const before = await cur();
    await stub(RED);
    await win.waitForSelector('[data-testid=stage-vtb]', { timeout: 3000 }).catch(() => {});
    if (!(await win.locator('[data-testid=stage-vtb]').count())) { const b = await win.locator('#stageVisual').boundingBox(); await win.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await win.waitForSelector('[data-testid=stage-vtb]', { timeout: 3000 }); }
    await win.click('[data-testid=vtb-replace]'); await win.waitForTimeout(800);
    const after = await cur();
    ok(after && after.file !== before.file && /\.png$/.test(after.file), '파일이 바뀌었다');
    ok(after.from === before.from && after.to === before.to && after.motion === before.motion && after.flipH === before.flipH, '범위·움직임·반전은 그대로');
    ok(after.dim && after.dim.w === 1920, '원본 크기(dim)도 새 파일 것으로');
    ok(fs.existsSync(before.file), '옛 파일은 남아 있다(↶ 되돌리기)');
    await win.keyboard.press('Escape');
    await win.mouse.click(5, 900);
    await win.keyboard.press('Control+z'); await win.waitForTimeout(600);
    const undone = await cur();
    ok(undone && undone.file === before.file, '↶ Ctrl+Z — 교체가 되돌려진다');
    ok(errors.length === 0, `화면 오류 0 ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
  } catch (e) {
    fail++; console.log('  ✗ 예외: ' + e.message);
  } finally {
    if (chMade) { try { await (await app.firstWindow()).evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    await app.close().catch(() => {});
    for (const f of [SNAP]) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 삽입 도구 막대 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
