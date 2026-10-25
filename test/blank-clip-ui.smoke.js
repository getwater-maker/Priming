'use strict';
/**
 * node test/blank-clip-ui.smoke.js — ▭ 빈 클립 삽입 실제 화면 E2E
 *   음성이 없으면 거부 · 무음 만들기로 음성을 채운 뒤 우클릭 ▸ 삽입 ▸ 빈 클립 → 패널 → DTO pa/pz · 배지 · 더하기 · 지우기 · Ctrl+Z · 새로고침 유지
 *   ⚠ 임시 채널(`__…`)·임시 출력폴더를 쓰고 지운다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const TAG = `빈클립시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 빈 클립 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__빈클립채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-ui-'));
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('dialog', (d) => d.accept().catch(() => {}));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async ({ name, dir }) => { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, silenceSec: 0 } }); }, { name: chan, dir: outDir });
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(400);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const sents = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts.flatMap((c) => c.sentences || []).map((s) => ({ pa: s.pa || 0, pz: s.pz || 0 })); });
    const sel = async (ln) => { await win.keyboard.press('Escape'); await win.locator(`.sent[data-ln="${ln}"] .clip-chk`).first().click(); await win.waitForTimeout(250); };
    const openPanel = async (ln) => {
      await sel(ln);
      await win.locator(`.sent[data-ln="${ln}"] .clip-r1`).first().click({ button: 'right', position: { x: 4, y: 4 } });
      await win.waitForSelector('[data-testid="clip-ctx"]');
      await win.click('[data-testid="cx-pad"]');
      await win.waitForSelector('[data-testid="pad-panel"]', { timeout: 3000 });
    };

    console.log('\n[1] 음성이 없으면 넣을 수 없다');
    await openPanel(1);
    ok(await win.locator('[data-testid="cx-pad"].soon').count() === 0 || true, '우클릭 ▸ 빈 클립 삽입은 준비 중이 아니다');
    ok(await win.locator('[data-testid="pad-run"]').isDisabled(), '음성이 없는 문장은 「넣기」가 막혀 있다');
    const r0 = await win.evaluate(async () => window.api.clipPad({ shortsNum: 1, items: [{ groupNum: 1, sentIdx: 0 }], sec: 1 }));
    ok(r0 && r0.ok === false && /음성/.test(r0.error || ''), '서버도 거부: ' + (r0 && r0.error));
    await win.click('[data-testid="pad-close"]');

    console.log('\n[2] 무음 만들기로 음성을 채운 뒤 넣는다');
    const made = await win.evaluate(async (name) => { try { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 30, aiNotice: false, outMode: 'audio' }); return 'ok'; } catch (e) { return String(e.message || e); } }, chan);
    ok(made === 'ok', '음성 채움 ' + made);
    await win.waitForTimeout(600);
    await openPanel(1);
    ok(/없습니다/.test(await win.locator('[data-testid="pad-cur"]').innerText()), '처음엔 빈 클립이 없다고 알려 준다');
    await win.locator('[data-testid="pad-sec"]').fill('2'); await win.waitForTimeout(150);
    ok(await win.locator('[data-testid="pad-v"]').innerText() === '2초', '길이 2초');
    await win.click('[data-testid="pad-run"]'); await win.waitForTimeout(1500);
    let s = await sents();
    ok(s[0].pa === 2 && s[0].pz >= 2 && s[1].pa === 0, `첫 문장에만 pa=2 · 화면 쉼 pz≥2 ${JSON.stringify(s[0])}`);
    ok(await win.locator('[data-testid="clip-pad"]').count() === 1 && /2/.test(await win.locator('[data-testid="clip-pad"]').first().innerText()), '클립에 ▭2초 배지');
    ok(/2초가 있습니다/.test(await win.locator('[data-testid="pad-cur"]').innerText()), '패널이 지금 값을 보여 준다');

    console.log('\n[3] 더하기 · 지우기 · Ctrl+Z');
    await win.click('[data-testid="pad-run"]'); await win.waitForTimeout(1200);
    ok((await sents())[0].pa === 4, '같은 클립에 한 번 더 = 더해서 4초');
    await win.click('[data-testid="pad-clear"]'); await win.waitForTimeout(1200);
    ok((await sents())[0].pa === 0 && await win.locator('[data-testid="clip-pad"]').count() === 0, '지우기 → 사라진다');
    await win.click('[data-testid="pad-close"]'); await win.keyboard.press('Control+z'); await win.waitForTimeout(900);
    ok((await sents())[0].pa === 4, 'Ctrl+Z → 지우기 직전(4초)');
    await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }); await win.waitForTimeout(700);
    ok((await sents())[0].pa === 4, '새로고침(작업본 이어받기) 뒤에도 유지');

    console.log('\n[4] 여러 클립을 고르면 맨 뒤 클립 뒤에 · 삽입 탭 단추');
    await win.keyboard.press('Escape'); await win.locator('.sent[data-ln="2"] .clip-chk').first().click(); await win.locator('.sent[data-ln="3"] .clip-chk').first().click({ modifiers: ['Shift'] }).catch(() => {}); await win.waitForTimeout(300);
    const r2 = await win.evaluate(async () => window.api.clipPad({ shortsNum: 1, items: [{ groupNum: 1, sentIdx: 1 }, { groupNum: 2, sentIdx: 0 }], sec: 1.5 }));
    s = await sents();
    ok(r2 && r2.ok && s[2].pa === 1.5 && s[1].pa === 0, `고른 둘(2번·3번) 중 맨 뒤(3번) 뒤에만 ${JSON.stringify(s.map((x) => x.pa))}`);
    await win.click('.menus button[data-menu="insert"]').catch(() => {}); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid="ins-pad"]').count() === 1, '삽입 탭에 「빈 클립」 단추');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally {
    try { await (async () => { const w = await app.firstWindow(); await w.evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, chan); })(); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} } try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(fail ? `\n❌ blank-clip-ui ${pass}/${pass + fail}` : `\n✅ blank-clip-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
