'use strict';
// node test/range-all.smoke.js — 🎬 영상 범위 「모두 적용」(v0.6.48) E2E.
//   대본 둘을 큐에 열고 → 헤더 범위를 G1~G2 로 → 「모두 적용」 → 두 대본 모두 vidFrom/vidTo = 1/2.
//   판정력: 누르기 전엔 먼저 연 대본이 자기 범위(헤더를 바꾸면 활성 대본만 바뀐다)라 1/2 가 아니어야 한다.
//   안전: 임시 채널·임시 폴더 · 큐 파일(workspace*.json) 전후 백업·복원 · 비디오 엔진 원래 값으로 되돌림.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const menu = require('./_menu');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'range-all-'));
const CH = '__테스트채널_삭제해도됨_' + process.pid;
const WS = path.join(os.homedir(), '.priming-maker');
const WSF = ['workspace.json', 'workspace.last.json'];
const bak = {};
for (const f of WSF) { try { bak[f] = fs.readFileSync(path.join(WS, f)); } catch (_) {} }
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };

const script = (t) => [`# ${t}`, '', '## 마당', '', '### 도입부', '> 🖼️ 이미지: a quiet room at dawn', '', '첫 문장입니다.', '',
  '### 본론', '> 🖼️ 이미지: a desk with a lamp', '', '둘째 문장입니다.', '', '### 셋째', '> 🖼️ 이미지: a window with rain', '', '셋째 문장입니다.', ''].join('\n');
const A = path.join(TMP, '[테스트_0001] 범위 가.md');
const B = path.join(TMP, '[테스트_0002] 범위 나.md');
fs.writeFileSync(A, script('범위 가'), 'utf8');
fs.writeFileSync(B, script('범위 나'), 'utf8');

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errs = [];
  let chMade = false, veBefore = null;
  const win = await app.firstWindow();
  try {
    win.on('pageerror', (e) => errs.push(e.message));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async ({ name, dir }) => {
      await window.api.addPreset({ name });
      await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } });
    }, { name: CH, dir: TMP });
    chMade = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((nm) => [...document.querySelectorAll('select option')].some((o) => o.value === nm), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await win.waitForTimeout(500);

    // 대본 둘 열기(화면 버튼과 같은 api — 파일 대화상자 스텁)
    for (const p of [A, B]) {
      await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, p);
      await win.locator('.ribbon').waitFor();
      await menu(win, 'script');
      const btn = win.locator('.ribbon button', { hasText: '열기' }).first();
      await btn.click();
      await win.waitForFunction((t) => document.body.textContent.includes(t), path.basename(p).replace(/\.md$/, '').slice(0, 12), { timeout: 10000 });
      await win.waitForTimeout(600);
    }
    const q0 = await win.evaluate(async () => (await window.api.listQueue()).queue.longform.items.map((x) => ({ t: x.title, s: x.settings })));
    ok(q0.length === 2, '큐에 대본 2개: ' + q0.map((x) => x.t).join(' · '));

    // ③ 비디오 메뉴 — 엔진이 「없음」이면 범위 칸이 안 보이므로 Grok 으로(끝나면 되돌린다)
    await menu(win, 'video');
    const veSel = win.locator('select[title^="i2v 비디오 엔진"]');
    veBefore = await veSel.inputValue();
    if (veBefore === 'none') { await veSel.selectOption('grok'); await win.waitForTimeout(300); }
    const allBtn = win.locator('[data-testid="range-all"]');
    ok(await allBtn.count() === 1, '「모두 적용」 버튼이 범위 옆에 있다');
    ok(await allBtn.isEnabled(), '대본이 2개 이상이면 눌린다');

    const inputs = win.locator('span[title^="영상으로 만들 그룹 범위"] input');
    await inputs.nth(0).fill('1'); await inputs.nth(1).fill('2');
    await win.waitForTimeout(800);   // 활성 대본 자동저장(300ms 디바운스)
    const q1 = await win.evaluate(async () => (await window.api.listQueue()).queue.longform.items.map((x) => x.settings || {}));
    const isRange = (s) => Number(s.vidFrom) === 1 && Number(s.vidTo) === 2;
    ok(q1.filter(isRange).length === 1, '누르기 전 = 활성 대본 하나만 G1~G2 (판정력 — 헤더는 활성 대본만 바꾼다)');

    // 버튼 누르기 — 확인창은 「예」로
    await win.evaluate(() => { window.confirm = () => true; });
    const box = await allBtn.boundingBox();
    const hit = await win.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return !!(el && el.closest('[data-testid="range-all"]')); }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    ok(hit, '버튼이 실제로 눌리는 자리에 있다(elementFromPoint)');
    const vb = await win.locator('[data-testid="ribbon"] button', { hasText: '비디오' }).first().boundingBox();
    ok(vb && Math.abs((vb.y + vb.height / 2) - (box.y + box.height / 2)) < 20, `「모두 적용」이 🎬 비디오 버튼과 같은 줄 (y ${Math.round(box.y)} / ${vb && Math.round(vb.y)})`);
    await allBtn.click();
    await win.waitForTimeout(500);
    const q2 = await win.evaluate(async () => (await window.api.listQueue()).queue.longform.items.map((x) => x.settings || {}));
    ok(q2.length === 2 && q2.every(isRange), '누른 뒤 = 두 대본 모두 G1~G2: ' + JSON.stringify(q2.map((s) => [s.vidFrom, s.vidTo])));
    ok(q2.every((s) => s.presetName === CH), '채널 같은 다른 설정은 그대로');
    const logText = await win.evaluate(() => (document.querySelector('#log') || {}).textContent || '');
    ok(/영상 범위 G1~G2 를 롱폼 큐의 대본 2개 모두에 넣었습니다/.test(logText), '로그에 몇 개에 넣었는지 남는다');

    // 취소하면 바꾸지 않는다
    await inputs.nth(0).fill('3'); await inputs.nth(1).fill('3'); await win.waitForTimeout(800);
    await win.evaluate(() => { window.confirm = () => false; });
    await allBtn.click(); await win.waitForTimeout(400);
    const q3 = await win.evaluate(async () => (await window.api.listQueue()).queue.longform.items.map((x) => x.settings || {}));
    ok(q3.filter(isRange).length === 1, '확인창에서 취소 = 다른 대본은 그대로(활성 대본만 헤더값)');
    ok(errs.length === 0, '화면 오류 0건' + (errs[0] ? ': ' + errs[0] : ''));
  } catch (e) {
    ok(false, '예외: ' + e.message);
  } finally {
    try {
      if (veBefore === 'none') { await menu(win, 'video'); await win.locator('select[title^="i2v 비디오 엔진"]').selectOption('none'); await win.waitForTimeout(300); }
      if (chMade) await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, CH);
    } catch (_) {}
    await app.close();
    for (const f of WSF) { if (bak[f]) fs.writeFileSync(path.join(WS, f), bak[f]); }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(bad ? `\n❌ ${bad}/${n} 실패` : `\n✅ 범위 모두 적용 E2E ${n}/${n} 통과`);
  process.exit(bad ? 1 : 0);
})();
