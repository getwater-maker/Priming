'use strict';
/**
 * node test/card-mark.smoke.js — 📜 ② 클립 칸 카드 자리 표시 E2E (v0.9.25 · 채널사업부 요청 2026-10-15)
 *   실제 앱: 카드 줄이 있는 대본을 연다 → 문장 행 왼쪽 열에 📜 종류 · 이어짐 📜… · 막간 끝 문장 ⏸(채널 막간 쉼) · 마우스 글 ·
 *   못 찾은 카드 줄 ⚠ · 채널 막간 쉼을 0 으로 바꾸면 ⏸ 가 사라진다.
 *   ⚠ 임시 채널·임시 대본·임시 출력폴더만 쓴다. PM_SHOT_DIR 이 있으면 화면을 저장한다.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TAG = `__카드표시_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 카드 표시 테스트', '', '## 本編', '### 一', '> 🖼️ 이미지: a starry night town',
  '> 📜 화면카드: 막간 | 때=第一章午后 +1 | 제목=一、午后の授業',
  '[室主] 第一章、午后の授業。', '', '[朗読] 「ではみなさんは。」と先生が云いました。', '',
  '> 📜 화면카드: 해설 | 때=活版所というのは | 제목=活版所 // 印刷する所 | 자리=왼쪽위',
  '[室主] 活版所というのは、印刷する所のことです。', '', '[朗読] ジョバンニはまっ赤になってうなずきました。', '',
  '> 📜 화면카드: 낱말 | 때=どこにもない文です | 원문=x | 번역=y', ''].join('\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__카드표시채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardmark-e2e-'));
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });
    ok(await win.evaluate(async ({ name, dir }) => { try { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, interludePauseSec: 5 } }); return true; } catch (_) { return false; } }, { name: chan, dir: outDir }), '임시 채널(막간 쉼 5초)');
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(600);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    await win.waitForTimeout(600);

    const marks = await win.evaluate(() => [...document.querySelectorAll('[data-testid="card-mark"]')].map((el) => {
      const row = el.closest('.sent'); const b = el.getBoundingClientRect(), rb = row.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { ln: row.getAttribute('data-ln'), role: el.getAttribute('data-role'), text: el.textContent, title: el.getAttribute('title') || '', left: b.right <= rb.left + 1, hit: !!hit && el.contains(hit) };
    }));
    console.log('   ', JSON.stringify(marks.map((m) => [m.ln, m.role, m.text])));
    ok(marks.length === 3, `카드가 뜨는 문장 3개에 표시(막간 시작 · 막간 이어짐 · 해설) — ${marks.length}개`);
    const [m1, m2, m3] = marks;
    ok(m1 && m1.role === 'start' && /📜/.test(m1.text) && /막간/.test(m1.text) && !/⏸/.test(m1.text), '때= 문장: 「📜 막간」(쉼은 끝 문장에만)');
    ok(m2 && m2.role === 'cont' && /📜…/.test(m2.text) && /⏸5초/.test(m2.text), '+1 이어지는 끝 문장: 옅은 「📜…」 + ⏸5초(채널 막간 쉼)');
    ok(m3 && /해설/.test(m3.text) && !/⏸/.test(m3.text) && /活版所 \/ 印刷する所/.test(m3.title), '해설: 쉼 없음 · 마우스 글에 제목=');
    ok(marks.every((m) => m.left && m.hit), '모두 문장 행 왼쪽 바깥 열 · 실제로 마우스가 닿는다(elementFromPoint)');
    const bad = await win.locator('[data-testid="card-bad"]').first();
    ok(await bad.count() === 1 && /1줄/.test(await bad.innerText()) && /どこにもない文です/.test(await bad.getAttribute('title')), '못 찾은 카드 줄 = 편 머리 ⚠(마우스 = 이유)');
    // ① 미리보기(v1.0.7) — 카드가 뜨는 문장을 고르면 ① 칸에 카드가 보인다: 막간(자리 없음) = 전체 화면 · 해설(자리=왼쪽위) = 한쪽 판
    await win.locator('.sent[data-ln="' + m1.ln + '"]').first().click(); await win.waitForTimeout(1200);
    const fullN = await win.locator('[data-testid="card-full"]').count();
    ok(fullN === 1, '① 칸: 막간 문장 → 전체 화면 카드 1장 (' + fullN + ')');
    await win.locator('.sent[data-ln="' + m3.ln + '"]').first().click(); await win.waitForTimeout(1200);
    const sideInfo = await win.evaluate(() => { const el = document.querySelector('[data-testid="card-side"]'); if (!el) return null; const st = document.querySelector('.stage-card').getBoundingClientRect(); const pl = el.querySelector('[data-testid="card-plate"]').getBoundingClientRect(); return { place: el.getAttribute('data-place'), label: el.getAttribute('data-label'), w: pl.width / st.width, h: pl.height / st.height, left: (pl.left - st.left) / st.width, top: (pl.top - st.top) / st.height, text: el.querySelector('[data-testid="card-text"]').textContent }; });
    ok(sideInfo && sideInfo.place === '왼쪽위' && sideInfo.label === '해설' && sideInfo.w < 0.4 && sideInfo.h < 0.4 && sideInfo.left < 0.06 && sideInfo.top < 0.1 && /活版所/.test(sideInfo.text), '① 칸: 해설(자리=왼쪽위) → 왼쪽 위 작은 판 ' + JSON.stringify(sideInfo));
    ok(await win.locator('[data-testid="card-full"]').count() === 0, '한쪽 카드 문장에선 전체 화면 카드가 없다');
    await win.locator('.sent[data-ln="' + marks[0].ln + '"]').first().click(); await win.waitForTimeout(200);
    if (process.env.PM_SHOT_DIR) { fs.mkdirSync(process.env.PM_SHOT_DIR, { recursive: true }); await win.screenshot({ path: path.join(process.env.PM_SHOT_DIR, 'card-mark.png') }); }

    // 채널 막간 쉼 0 → ⏸ 사라짐(채널편집 저장과 같은 길: savePreset → presetRev)
    await win.evaluate(async (n) => { await window.api.savePreset({ name: n, patch: { interludePauseSec: 0 } }); }, chan);
    await win.selectOption('select[title^="채널(프리셋)"]', { index: 0 }).catch(() => {}); await win.waitForTimeout(300);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(800);
    // 채널을 바꾸면 롱폼 큐를 비운다(v0.7.37 규칙) — 대본을 다시 연다
    if (!(await win.locator('.sent[data-ln]').count())) { await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")'); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }); await win.waitForTimeout(600); }
    const t2 = await win.evaluate(() => [...document.querySelectorAll('[data-testid="card-mark"]')].map((el) => el.textContent).join('|'));
    ok(t2 && !/⏸/.test(t2), `채널 막간 쉼 0 → ⏸ 표시 없음 (${t2})`);
    ok(errors.length === 0, '화면 오류 0건 ' + errors.join(' / ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외: ' + e.stack); }
  finally {
    try { await win.evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, chan); } catch {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 카드 자리 표시 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
