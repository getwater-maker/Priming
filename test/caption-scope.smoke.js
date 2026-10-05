'use strict';
/**
 * node test/caption-scope.smoke.js — 🎨 자막 서식 적용 범위 · ① 칸 자막 끌기 · 고급 위치 · 🏷 큐 일괄 로고 (v0.6.86 · 로이 2026-10-05)
 *   ① 기본 = 🌐 모든 자막(고른 줄을 바꾸면 이 대본 모든 자막) ② 🎯 이 클립만 = 고른 클립만
 *   ③ ① 칸 자막을 끌면 자리(posX)가 바뀐다 ④ ⚙ 고급에 「📐 위치(화면 기준)」 ⑤ 고급을 열어도 ② 목록 폭 유지
 *   ⑥ 목록 자막 글자 = 굵게 ⑦ 🏷 「열린 대본 모두」 로고 넣기·빼기(큐 2개 · 채널 설정 불변)
 * ⚠ 임시 채널·임시 대본 · 끝나면 지운다 · 채널 목록 파일 전후 비교.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'capscope-'));
const TAG = `__자막범위테스트_${process.pid}`;
const MD1 = path.join(TMP, `${TAG}_가.md`), MD2 = path.join(TMP, `${TAG}_나.md`);
const SNAPS = [MD1, MD2].map((m) => path.join(os.homedir(), '.priming-maker', 'projects', path.basename(m).replace(/\.md$/, '') + '.smproj.json'));
const CH = '__테스트채널_삭제해도됨_자막범위_' + process.pid;
const PRESETS = path.join(os.homedir(), '.flow-app', 'tts-presets.json');
const SCRIPT = (t) => ['# ' + t, '', '## 도입부', '### 〔첫 장면〕', '> 🖼️ 이미지: a red room', '첫째 문장입니다. 둘째 문장입니다.', '', '### 〔둘째〕', '> 🖼️ 이미지: x', '셋째 문장입니다.', ''].join('\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

(async () => {
  fs.writeFileSync(MD1, SCRIPT('가'), 'utf8'); fs.writeFileSync(MD2, SCRIPT('나'), 'utf8');
  const LOGO = path.join(TMP, 'logo.png');
  execFileSync(require('../core/media-utils').getFfmpegPath(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=200x100', '-frames:v', '1', LOGO]);
  const presetsBefore = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS, 'utf8') : null;
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false;
  try {
    const win = await app.firstWindow();
    win.on('dialog', (d) => d.accept().catch(() => {}));   // uiConfirm(window.confirm) = 예
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 820); });
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(() => { try { localStorage.removeItem('pm.capScope'); localStorage.removeItem('pm.view'); localStorage.removeItem('pm.pane1R'); } catch (_) {} });
    await win.evaluate(async ({ name, dir }) => { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, logoOn: false, logoPath: '' } }); }, { name: CH, dir: TMP });
    chMade = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((n) => [...document.querySelectorAll('select option')].some((o) => o.value === n), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await win.waitForTimeout(500);
    for (const md of [MD1, MD2]) {
      await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, md);
      await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
      await win.waitForFunction((t) => document.body.innerText.includes(t), path.basename(md).replace(/\.md$/, ''), { timeout: 20000 });
      await win.waitForSelector('.sent.clip', { timeout: 20000 });
      await win.waitForTimeout(400);
    }
    const dto = () => win.evaluate(async () => (await window.api.listQueue()).dto);
    const spansOf = (d) => d.projects[0].cuts.flatMap((c) => c.sentences.map((s) => s.spans || null));
    const clipNo = (n) => win.locator(`.sent[data-ln="${n}"] .clip-no`);

    console.log('\n[1] 🌐 기본 = 모든 자막');
    await clipNo(1).click(); await win.waitForTimeout(400);
    ok(/모든 자막/.test(await win.locator('[data-testid=cf-bar] [data-testid=cf-scope]').innerText()), '툴바 범위 버튼 기본 = 「🌐 모든 자막」');
    await win.locator('[data-testid=cf-bar] button[title="굵게"]').click(); await win.waitForTimeout(700);
    { const sp = spansOf(await dto()); ok(sp.length === 3 && sp.every((x) => x && x.some((r) => r.fmt && r.fmt.bold === true)), `🔑 클립 1에서 굵게 → 이 대본 모든 자막 3문장 (${JSON.stringify(sp.map((x) => !!x))})`); }

    console.log('\n[1b] 🌐 새로 쓴 문장도 「모든 자막」 서식(v0.6.87)');
    {
      let snap0 = null;   // 자동저장은 1.5초쯤 늦다 — 기다린다
      for (let i = 0; i < 40 && !(snap0 && snap0.capAll); i++) { try { snap0 = JSON.parse(fs.readFileSync(SNAPS[1], 'utf8')).projects[0]; } catch (_) {} if (!(snap0 && snap0.capAll)) await win.waitForTimeout(250); }
      ok(snap0.capAll && snap0.capAll.bold === true && snap0.groups.every((g) => g.sentences.every((s) => !s.capSpans)), `작업본 = 대본 서식(capAll) 한 벌 · 문장마다 써 넣지 않는다 (${JSON.stringify(snap0.capAll)})`);
      fs.writeFileSync(MD2, SCRIPT('나').replace('셋째 문장입니다.', '셋째 문장입니다. 새로 쓴 넷째 문장입니다.'), 'utf8');   // 밖에서 대본에 새 문장
      await win.waitForSelector('.sent.clip:has-text("새로 쓴")', { timeout: 15000 });   // 밖에서 바뀐 대본을 다시 읽을 때까지
      const d = await dto(); const ns = d.projects[0].cuts.flatMap((c) => c.sentences).find((s) => /새로 쓴/.test(s.text));
      ok(ns && (ns.spans || []).some((r) => r.fmt && r.fmt.bold === true && r.from === 0 && r.to === ns.text.length), `🔑 새로 쓴 문장도 굵게(모든 자막 서식이 저절로) (${JSON.stringify(ns)})`);
      await win.waitForSelector('.sent.clip:has-text("새로 쓴")', { timeout: 8000 });
      ok(await win.locator('.sent.clip:has-text("새로 쓴") .clip-cap .capfmt').count() >= 1, '② 목록에도 새 문장이 그 서식으로 보인다');
    }

    console.log('\n[2] 🎯 이 클립만');
    await win.locator('[data-testid=cf-bar] [data-testid=cf-scope]').click(); await win.waitForTimeout(200);
    ok(/이 클립만/.test(await win.locator('[data-testid=cf-bar] [data-testid=cf-scope]').innerText()), '누르면 「🎯 이 클립만」');
    await win.locator('[data-testid=cf-bar] button[title="기울임"]').click(); await win.waitForTimeout(700);
    { const sp = spansOf(await dto()); const it = sp.map((x) => !!(x && x.some((r) => r.fmt && r.fmt.italic === true))); ok(it[0] && !it[2], `🔑 기울임 = 고른 클립(문장 1)만 (${JSON.stringify(it)})`); }
    ok(await win.evaluate(() => localStorage.getItem('pm.capScope')) === 'clip', '범위는 기억된다');
    await win.locator('[data-testid=cf-bar] [data-testid=cf-scope]').click(); await win.waitForTimeout(200);   // 다시 모든 자막

    console.log('\n[3] ① 칸 자막 끌기 → 자리(posX)');
    await win.keyboard.press('Escape'); await win.waitForTimeout(200);
    const capLine = win.locator('#stageCap .cf-stageline').first();
    await capLine.waitFor({ timeout: 5000 });
    const b0 = await capLine.boundingBox(); const sb = await win.locator('#stage').boundingBox();
    ok(await win.locator('#stageCap.capdrag').count() === 1, '① 칸 자막 = 끌 수 있다(capdrag)');
    await win.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2); await win.mouse.down();
    await win.mouse.move(b0.x + b0.width / 2 + sb.width * 0.1, b0.y + b0.height / 2 - sb.height * 0.1, { steps: 6 }); await win.mouse.up();
    await win.waitForTimeout(900);
    { const sp = spansOf(await dto()); const xs = sp.map((x) => { const r = (x || []).find((q) => q.fmt && q.fmt.posX != null); return r ? r.fmt.posX : null; });
      ok(xs.every((v) => v != null && Math.abs(v - 0.2) < 0.03), `🔑 화면 폭 10% 오른쪽 = posX ≈ +0.2(화면 절반 = 1) · 모든 자막 (${JSON.stringify(xs)})`); }
    { const b1 = await win.locator('#stageCap .cf-stageline').first().boundingBox();
      ok(b1 && b1.x - b0.x > sb.width * 0.07, `① 칸 자막이 실제로 오른쪽으로 갔다 (${Math.round(b1.x - b0.x)}px)`); }
    ok(await win.locator('[data-testid=stage-edit]').count() === 0, '끌기는 편집칸을 열지 않는다');

    console.log('\n[4] ⚙ 고급 — 📐 위치 · ② 목록 폭 · 굵은 자막');
    await clipNo(2).click(); await win.waitForTimeout(300);   // 1 은 끌기로 이미 골라져 있다(한 번 더 누르면 해제)
    await win.locator('[data-testid=cf-bar] button:has-text("고급")').click(); await win.waitForTimeout(600);
    ok(await win.locator('[data-testid=cf-panel-pos]').count() === 1, '고급 패널에 「📐 위치(화면 기준)」');
    await win.locator('[data-testid=cf-panel-pos] button[title="화면 오른쪽"]').click(); await win.waitForTimeout(700);
    { const sp = spansOf(await dto()); ok(sp.every((x) => (x || []).some((r) => r.fmt && r.fmt.posH === 'end')), '고급의 「화면 오른쪽」 → 모든 자막 posH=end'); }
    { const w = await win.evaluate(() => { const m = document.querySelector('main.pane2'); return { w: m.getBoundingClientRect().width, sw: m.scrollWidth, cw: m.clientWidth, seg: Math.round(document.querySelector('.seg button').getBoundingClientRect().height) }; });
      ok(w.w >= 630 && w.sw <= w.cw + 1 && w.seg < 34, `🔑 고급을 열어도 ② 목록 폭 ${Math.round(w.w)}px · 가로 넘침 없음 · 「개요」 한 줄(${w.seg}px)`); }
    ok(await win.locator('.clip-r2 .clip-cap').first().evaluate((el) => Number(getComputedStyle(el).fontWeight) >= 700), '② 목록 자막 글자 = 굵게');
    await win.locator('[data-testid=cf-side] .cf-x').click(); await win.waitForTimeout(200);

    console.log('\n[5] 🏷 열린 대본 모두 — 로고 넣기·빼기(큐 2개 · 채널 불변)');
    await win.click('.menubar button:text-is("삽입")'); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid=logo-queue]').inputValue() === 'chan' && await win.locator('[data-testid=stage-logo]').count() === 0, '처음 = 채널 설정대로(채널 로고 꺼짐 → 없음)');
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, LOGO);
    await win.selectOption('[data-testid=logo-queue]', 'on'); await win.waitForTimeout(1200);
    ok(await win.locator('[data-testid=stage-logo]').count() === 1, '🔑 로고 넣기 → ① 칸에 로고(채널에 그림이 없어 그림을 골랐다)');
    { const s = SNAPS.map((f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).projects[0].logoOver; } catch (_) { return null; } });
      ok(s.every((o) => o && o.on === true && o.path === LOGO), `🔑 큐의 두 대본 작업본 모두 logoOver (${JSON.stringify(s)})`); }
    { const p = await win.evaluate(async (n) => window.api.getPresetDetail(n), CH); ok(!p.logoOn && !p.logoPath, '채널 설정은 그대로(로고 꺼짐 · 그림 없음)'); }
    await win.selectOption('[data-testid=logo-queue]', 'off'); await win.waitForTimeout(900);
    ok(await win.locator('[data-testid=stage-logo]').count() === 0 && /이 대본 로고 뺌/.test(await win.locator('[data-testid=logo-off]').innerText()), '로고 빼기 → ① 칸 로고 없음');
    await win.selectOption('[data-testid=logo-queue]', 'chan'); await win.waitForTimeout(900);
    { const s = SNAPS.map((f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).projects[0].logoOver; } catch (_) { return 'x'; } });
      ok(s.every((o) => o == null), '채널 설정대로 → 덮어쓰기 지움(두 대본)'); }
    ok(errors.length === 0, `화면 오류 0건 (${errors.join(' | ')})`);
  } catch (e) { fail++; console.log('  ✗ 예외: ' + String((e && e.message) || e).split('\n')[0]); } finally {
    if (chMade) { try { await (await app.firstWindow()).evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    try { await app.close(); } catch (_) {}
    for (const f of SNAPS) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    const after = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS, 'utf8') : null;
    ok(after === presetsBefore, '로이 채널 설정(tts-presets.json) 전후 동일');
    console.log(`\n${fail ? '❌' : '✅'} 자막 범위·끌기·큐 로고 E2E ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
