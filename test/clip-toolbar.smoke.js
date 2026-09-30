'use strict';
/**
 * node test/clip-toolbar.smoke.js — 🧩 클립 도구 막대 E2E(v0.5.94 · 로이 2026-09-30)
 *   실제 앱: 클립 번호를 눌러 고른다 → 막대가 그 클립 바로 위에 뜬다(✂ ⧉ 📋 🗑 · 2개면 ⊟) → 메뉴(삽입·효과·목소리) →
 *   Del 로 삭제 · ⧉→📋 붙여넣기 · ⊟ 합치기 · Ctrl+Z 되돌리기. 음성은 무음(dry) 만들기로 채운다(TTS 서버·GPU 안 씀).
 *   ⚠ 임시 채널·임시 대본·임시 출력폴더만 쓴다(사용자 것 무변경).
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TAG = `__클립막대_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 클립 막대 테스트', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room',
  '첫째 문장입니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a gate', '셋째 문장입니다. 넷째 문장입니다. 다섯째 문장입니다.', ''].join('\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const md = () => fs.readFileSync(MD, 'utf8');

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__클립막대채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliptb-e2e-'));
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
    const pick = async (n, mod) => { await win.locator(`.sent[data-ln="${n}"] .cf-lineno`).first().click(mod ? { modifiers: [mod] } : undefined); await win.waitForTimeout(250); };

    console.log('\n[1] 하나 고르면 막대가 그 클립 위에');
    await pick(3);
    await win.waitForSelector('[data-testid="clip-tb"]', { timeout: 5000 });
    const geo = await win.evaluate(() => {
      const tb = document.querySelector('[data-testid="clip-tb"]').getBoundingClientRect();
      const row = [...document.querySelectorAll('.sent[data-ln="3"]')].find((x) => x.offsetParent !== null).getBoundingClientRect();
      const b = document.querySelector('[data-testid="ctb-cut"]').getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { dy: Math.round(row.top - tb.bottom), hit: !!(hit && hit.closest('[data-testid="ctb-cut"]')) };
    });
    ok(geo.dy >= -4 && geo.dy <= 14, `막대가 고른 클립 바로 위 (간격 ${geo.dy}px)`);
    ok(geo.hit, '✂ 버튼이 실제로 눌리는 자리(elementFromPoint)');
    for (const id of ['ctb-cut', 'ctb-copy', 'ctb-paste', 'ctb-del', 'ctb-ins', 'ctb-fx', 'ctb-play', 'ctb-voice']) ok(await win.locator(`[data-testid="${id}"]`).count() === 1, `버튼 ${id}`);
    ok(await win.locator('[data-testid="ctb-merge"]').count() === 0, '하나만 고르면 「클립 합치기」 없음');
    ok(await win.locator('[data-testid="ctb-paste"]').isDisabled(), '복사 전엔 📋 흐림');

    console.log('\n[2] 메뉴 — 삽입 · 효과 · 목소리');
    await win.click('[data-testid="ctb-ins"]');
    ok(await win.locator('[data-testid="ctb-ins-menu"] button').count() === 8 && await win.locator('[data-testid="ctb-ins-menu"] button.soon').count() === 5, '삽입 메뉴 8개(PC에서 불러오기 · AI 이미지 · AI 비디오는 동작 · 나머지 5개 준비 중)');
    await win.click('[data-testid="ctb-fx"]');
    ok(await win.locator('[data-testid="ctb-ins-menu"]').count() === 0 && await win.locator('[data-testid="ctb-fx-menu"] button').count() === 8 && await win.locator('[data-testid="ctb-fx-menu"] button.soon').count() === 6, '효과 메뉴 8개(맞춤·채움 동작 · 6개 준비 중) · 삽입 메뉴는 닫힘');
    await win.click('[data-testid="ctb-fx-cover"]'); await win.waitForTimeout(400);
    ok(/G2 그림 모양을 바꿨습니다/.test(await win.locator('body').innerText()), '■ 채움: 이 클립이 든 그룹(G2)의 그림 모양을 바꿨다');
    await win.keyboard.press('Control+z'); await win.waitForTimeout(500);
    await pick(3); await pick(3);   // 되돌리기로 선택이 풀렸으면 다시 고른다(두 번 = 해제 뒤 선택)
    if (!(await win.locator('[data-testid="clip-tb"]').count())) await pick(3);
    await win.click('[data-testid="ctb-voice"]');
    ok(await win.locator('[data-testid="ctb-voice-redo"]').count() === 1 && await win.locator('[data-testid="ctb-voice-roll"]').count() === 1, '목소리 수정: 🎤 다시 만들기 · 🎲 다른 톤으로 새로 뽑기');
    await win.locator('.vr-menu-bg').first().dispatchEvent('mousedown'); await win.waitForTimeout(150);
    ok(await win.locator('.clip-tb-menu').count() === 0, '바깥을 누르면 메뉴가 닫힌다');

    console.log('\n[3] 두 개 고르면 「클립 합치기」');
    await pick(4, 'Control');
    ok(await win.locator('[data-testid="ctb-merge"]').count() === 1, 'Ctrl+클릭으로 2개 → ⊟ 클립 합치기가 보인다');
    if (process.env.CLIP_SHOT) {
      const r = await win.evaluate(() => { const b = document.querySelector('[data-testid="clip-tb"]').getBoundingClientRect(); return { x: Math.max(0, b.left - 60), y: Math.max(0, b.top - 10), width: 760, height: 260 }; });
      await win.click('[data-testid="ctb-ins"]'); await win.waitForTimeout(200);
      await win.screenshot({ path: process.env.CLIP_SHOT, clip: r });
      await win.locator('.vr-menu-bg').first().dispatchEvent('mousedown'); await win.waitForTimeout(150);
    }
    await win.click('[data-testid="ctb-merge"]'); await win.waitForTimeout(900);
    ok(/셋째 문장입니다 넷째 문장입니다\./.test(md()), '⊟ 합치기: 대본에서 두 문장이 한 문장으로');
    await win.keyboard.press('Control+z'); await win.waitForTimeout(900);
    ok(/셋째 문장입니다\. 넷째 문장입니다\./.test(md()), 'Ctrl+Z 로 되돌렸다');

    console.log('\n[4] 선택 + Del = 삭제');
    await pick(5);
    await win.keyboard.press('Delete'); await win.waitForTimeout(900);
    ok(!/다섯째 문장입니다/.test(md()) && /넷째 문장입니다/.test(md()), '🔑 Del: 고른 클립(다섯째)만 대본에서 빠졌다');
    ok(await win.locator('[data-testid="clip-tb"]').count() === 0, '지운 뒤 선택·막대가 사라진다');
    await win.keyboard.press('Control+z'); await win.waitForTimeout(900);
    ok(/다섯째 문장입니다/.test(md()), 'Ctrl+Z 로 되살렸다');

    console.log('\n[5] ⧉ 복사 → 📋 붙여넣기 · 🗑 버튼');
    await pick(1);
    await win.click('[data-testid="ctb-copy"]'); await win.waitForTimeout(700);
    ok(!(await win.locator('[data-testid="ctb-paste"]').isDisabled()), '복사하면 📋 가 켜진다');
    await pick(4);
    await win.click('[data-testid="ctb-paste"]'); await win.waitForTimeout(900);
    ok(/넷째 문장입니다\. 첫째 문장입니다\. 다섯째 문장입니다\./.test(md()), '🔑 📋: 고른 클립(넷째) 뒤에 복사한 클립이 들어갔다');
    await pick(5);
    await win.click('[data-testid="ctb-del"]'); await win.waitForTimeout(900);
    if (!/넷째 문장입니다\. 다섯째 문장입니다\./.test(md())) console.log('   [md]', JSON.stringify(md().split('\n').slice(5)), await win.evaluate(() => [...document.querySelectorAll('.sent[data-ln]')].filter((x) => x.offsetParent).map((x) => x.dataset.ln + ':' + x.innerText.slice(0, 18).replace(/\s+/g, ' ')).join(' | ')), await win.locator('#status, .status').first().innerText().catch(() => ''));
    ok(/넷째 문장입니다\. 다섯째 문장입니다\./.test(md()), '🗑 버튼: 붙인 클립을 지웠다');
    await pick(2);
    await win.keyboard.press('Control+x'); await win.waitForTimeout(1200);
    ok(!/둘째 문장입니다/.test(md()), 'Ctrl+X 잘라내기: 대본에서 빠졌다');
    await pick(4);
    await win.keyboard.press('Control+v'); await win.waitForTimeout(900);
    ok(/둘째 문장입니다/.test(md()), 'Ctrl+V: 잘라낸 클립을 다른 자리에 붙였다');

    ok(errors.length === 0, `화면 오류 0건 ${errors.length ? '— ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    try { await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, chan); } catch (_) {}
    try { await win.evaluate((v) => { try { if (v == null) localStorage.removeItem('pm.clipDetail'); else localStorage.setItem('pm.clipDetail', v); } catch (_) {} }, lsDetail); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 클립 도구 막대 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 오류:', e); process.exit(1); });
