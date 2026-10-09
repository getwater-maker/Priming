'use strict';
/**
 * node test/clip-move.smoke.js — ↕ 클립 끌어 옮기기 E2E(v0.7.69 · 로이 2026-10-09)
 *   실제 앱: 번호 칸을 잡고 끌어 다른 클립의 위/아래 절반에 놓는다(HTML5 끌어 놓기).
 *   [1] 체크 없이 클립 하나 → 다른 그룹 맨 앞 — 대본(.md)·그룹 소속(= 그 그룹 그림)·음성 유지
 *   [2] 체크한 여러 클립 → 다른 그룹 끝 · [3] Ctrl+Z 한 번에 되돌리기 · [4] 같은 자리·끄는 클립 위엔 놓이지 않음
 *   음성은 무음(dry) 만들기로 채운다(TTS 서버·GPU 안 씀). ⚠ 임시 채널·임시 대본·임시 출력폴더만 쓴다.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TAG = `__클립옮기기_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 클립 옮기기 테스트', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room',
  '첫째 문장입니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a gate', '셋째 문장입니다. 넷째 문장입니다. 다섯째 문장입니다.', ''].join('\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const md = () => fs.readFileSync(MD, 'utf8');
const body = () => md().split('\n').filter((l) => /문장입니다/.test(l));   // [G1 문단, G2 문단]

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__클립옮기기채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipmove-e2e-'));
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win, lsDetail = null;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });
    ok(await win.evaluate(async ({ name, dir }) => { try { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); return true; } catch (_) { return false; } }, { name: chan, dir: outDir }), '임시 채널');
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(400);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    lsDetail = await win.evaluate(() => { try { return localStorage.getItem('pm.clipDetail'); } catch (_) { return null; } });
    const made = await win.evaluate(async (name) => { try { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 20, aiNotice: false, openVrew: false }); return 'ok'; } catch (e) { return e.message; } }, chan);
    ok(made === 'ok', '무음 만들기로 음성 채우기 ' + made);
    await win.waitForTimeout(600);
    const row = (n) => win.locator(`.sent.clip[data-ln="${n}"]`).first();
    const handle = (n) => win.locator(`.sent.clip[data-ln="${n}"] .clip-no`).first();
    // 끌기 — 손으로 하듯 단계별로(Playwright dragTo 는 놓을 자리로 화면을 굴리는 사이 잡은 클립이 바뀐다 · 끄는 중 굴림은 앱의 가장자리 자동 굴림과 같다)
    const drag = async (from, to, before) => {
      await handle(from).scrollIntoViewIfNeeded();
      const a = await handle(from).boundingBox();
      await win.mouse.move(a.x + a.width / 2, a.y + 12); await win.mouse.down();
      await win.mouse.move(a.x + a.width / 2, a.y + 22, { steps: 4 });
      await row(to).evaluate((el) => el.scrollIntoView({ block: 'center' })); await win.waitForTimeout(150);
      const t = await row(to).boundingBox();
      await win.mouse.move(t.x + 120, before ? t.y + 5 : t.y + t.height - 5, { steps: 8 });
      await win.mouse.up();
      await win.waitForTimeout(1200);
    };
    // 화면: 클립 글 → 그룹 번호 · 그 그룹의 이미지 프롬프트(= 그 그룹 그림)
    const where = () => win.evaluate(() => [...document.querySelectorAll('.cut')].map((c) => [...c.querySelectorAll('.sent.clip .clip-cap')].map((x) => x.innerText.trim()).join(' / ')));
    ok(await handle(4).getAttribute('draggable') === 'true', '번호 칸을 잡고 끌 수 있다(draggable)');

    console.log('\n[1] 체크 없이 클립 하나(넷째 · G2) → G1 맨 앞(첫째 위)');
    await drag(4, 1, true);
    let b = body();
    ok(b[0] === '넷째 문장입니다. 첫째 문장입니다. 둘째 문장입니다.' && b[1] === '셋째 문장입니다. 다섯째 문장입니다.', '🔑 대본: G1 맨 앞으로 옮겨졌고 G2 에선 빠졌다 ' + JSON.stringify(b));
    let w = await where();
    ok(/^넷째/.test(w[0] || '') && !/넷째/.test(w[1] || ''), '🔑 화면: 넷째 클립이 G1 안에 있다 — G1 그림·영상을 쓴다 ' + JSON.stringify(w));
    ok(await win.locator('.sent.clip.drop-before, .sent.clip.drop-after, .sent.clip.drag-src').count() === 0, '놓은 뒤 표시(파란 선·흐림)가 남지 않는다');

    console.log('\n[2] Ctrl+Z 한 번에 되돌리기');
    await win.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await win.keyboard.press('Control+z'); await win.waitForTimeout(1000);
    b = body();
    ok(b[0] === '첫째 문장입니다. 둘째 문장입니다.' && b[1] === '셋째 문장입니다. 넷째 문장입니다. 다섯째 문장입니다.', '되돌리기 한 번에 원래대로 ' + JSON.stringify(b));

    console.log('\n[3] 체크한 클립 둘(첫째·둘째 · G1 전부) → G2 끝(다섯째 아래)');
    await win.locator('.sent.clip[data-ln="1"] .clip-chk').first().check(); await win.waitForTimeout(200);
    await win.locator('.sent.clip[data-ln="2"] .clip-chk').first().check(); await win.waitForTimeout(200);
    await drag(1, 5, false);
    b = body();
    ok(b.length === 1 && b[0] === '셋째 문장입니다. 넷째 문장입니다. 다섯째 문장입니다. 첫째 문장입니다. 둘째 문장입니다.', '🔑 체크한 두 클립이 함께 G2 끝으로(빈 G1 은 사라짐) ' + JSON.stringify(b));
    w = await where();
    ok(w.length === 1 && /다섯째.*첫째.*둘째/.test(w[0]), '화면: 그룹 하나에 순서대로 ' + JSON.stringify(w));
    const aud = await win.evaluate(() => [...document.querySelectorAll('.sent.clip .clip-time')].map((x) => x.innerText.trim()));
    ok(aud.length === 5 && aud.every((t) => t && !/^-/.test(t)), '옮긴 클립의 음성(시각·길이)이 그대로 있다 ' + JSON.stringify(aud));
    await win.keyboard.press('Control+z'); await win.waitForTimeout(1000);
    ok(body().length === 2 && body()[0] === '첫째 문장입니다. 둘째 문장입니다.', '되돌리기로 G1 이 돌아왔다');

    console.log('\n[4] 같은 자리 · 끄는 클립 위');
    const before = md();
    await drag(3, 4, true);   // 셋째를 넷째 위 = 제자리
    ok(md() === before, '같은 자리에 놓으면 대본이 그대로');
    ok(/같은 자리/.test(await win.locator('body').innerText()), '「같은 자리」 안내');
    await win.locator('.sent.clip[data-ln="3"] .clip-chk').first().check(); await win.waitForTimeout(150);
    await win.locator('.sent.clip[data-ln="4"] .clip-chk').first().check(); await win.waitForTimeout(150);
    await drag(3, 4, false);   // 끄는 클립(넷째) 위 — 놓이지 않는다
    ok(md() === before, '끄는 클립 위에는 놓이지 않는다');

    console.log('\n[5] 같은 그룹 안 — 다섯째를 셋째 위로');
    await win.locator('.sent.clip[data-ln="3"] .clip-chk').first().uncheck(); await win.locator('.sent.clip[data-ln="4"] .clip-chk').first().uncheck(); await win.waitForTimeout(200);
    await drag(5, 3, true);
    b = body();
    ok(b[0] === '첫째 문장입니다. 둘째 문장입니다.' && b[1] === '다섯째 문장입니다. 셋째 문장입니다. 넷째 문장입니다.', '그룹 안에서 순서만 바뀐다 ' + JSON.stringify(b));

    console.log('\n[6] 체크박스로 고르고 키보드 Ctrl+X → Ctrl+V(고른 클립 아래) · Ctrl+C → Ctrl+V');
    await win.keyboard.press('Control+z'); await win.waitForTimeout(1000);   // [5] 되돌림 — 원래 순서
    const chk = async (n, on = true) => { const c = win.locator(`.sent.clip[data-ln="${n}"] .clip-chk`).first(); if (on) await c.check(); else await c.uncheck(); await win.waitForTimeout(200); };
    await chk(1);
    ok(await win.evaluate(() => document.activeElement && document.activeElement.classList.contains('clip-chk')), '초점이 체크박스에 있다(예전엔 이때 키가 먹지 않았다)');
    await win.keyboard.press('Control+x'); await win.waitForTimeout(1300);
    b = body();
    ok(b[0] === '둘째 문장입니다.', '🔑 Ctrl+X: 체크한 클립(첫째)이 잘렸다 ' + JSON.stringify(b));
    await chk(3);   // 지금 3번 = 넷째(첫째가 빠져 번호가 당겨짐)
    await win.keyboard.press('Control+v'); await win.waitForTimeout(1200);
    b = body();
    ok(b[1] === '셋째 문장입니다. 넷째 문장입니다. 첫째 문장입니다. 다섯째 문장입니다.', '🔑 Ctrl+V: 고른 클립(넷째) 바로 아래에 붙었다 ' + JSON.stringify(b));
    await chk(1);   // 둘째
    await win.keyboard.press('Control+c'); await win.waitForTimeout(900);
    ok(body()[0] === '둘째 문장입니다.', 'Ctrl+C: 복사만 — 대본 그대로');
    await chk(1, false); await chk(5);   // 다섯째(맨 끝)
    await win.keyboard.press('Control+v'); await win.waitForTimeout(1200);
    b = body();
    ok(/다섯째 문장입니다\. 둘째 문장입니다\.$/.test(b[1] || '') && b[0] === '둘째 문장입니다.', '🔑 Ctrl+C → Ctrl+V: 복사본이 고른 클립 아래에(원본도 남음) ' + JSON.stringify(b));

    ok(errors.length === 0, `화면 오류 0건 ${errors.length ? '— ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    try { await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, chan); } catch (_) {}
    try { await win.evaluate((v) => { try { if (v == null) localStorage.removeItem('pm.clipDetail'); else localStorage.setItem('pm.clipDetail', v); } catch (_) {} }, lsDetail); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 클립 옮기기 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 오류:', e); process.exit(1); });
