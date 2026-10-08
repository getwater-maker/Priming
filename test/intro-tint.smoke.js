'use strict';
/**
 * node test/intro-tint.smoke.js — 🎬 도입부(영상이 들어가는 그룹) 클립 배경색 실제 앱 E2E (v0.7.27 · 로이 2026-10-07).
 *
 * ② 클립 칸에서 도입부 그룹의 클립은 노랑(#fff1b8)으로 칠하고 본문 그룹은 그대로(흰색) — 어디까지가 도입부인지 한눈에.
 * 선택(.picked)한 클립은 도입부여도 제 색(흰 바탕 + 주황 번호 칸)을 지킨다 — 상태가 도입부 색에 묻히지 않게.
 * ⚠ 사용자 작업물 보호 — 임시 채널(출력 폴더 = 임시 폴더) + 임시 대본. 끝나면 채널·폴더·스냅샷을 지운다.
 * 스크린샷: INTRO_TINT_SHOT=<파일.png> 를 주면 그 자리에 저장한다(눈으로 확인용).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TAG = `__도입부색테스트_${process.pid}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-'));
const MD = path.join(TMP, `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const CH = '__테스트채널_삭제해도됨_도입부색_' + process.pid;
const SCRIPT = [
  '# 도입부 색 테스트',
  '',
  '## 도입부',
  '### 〔첫 장면〕',
  '> 🖼️ 이미지: a red room',
  '첫째 그룹 첫 문장입니다. 첫째 그룹 둘째 문장입니다.',
  '',
  '### 〔둘째 장면〕',
  '> 🖼️ 이미지: a blue room',
  '둘째 그룹 문장입니다. 둘째 그룹 마지막 문장입니다.',
  '',
  '## 본문',
  '### 〔셋째 장면〕',
  '> 🖼️ 이미지: a green room',
  '본문 그룹 첫 문장입니다. 본문 그룹 둘째 문장입니다.',
  '',
].join('\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

(async () => {
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false, lsSaved = null;
  try {
    const win = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 820); });
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    lsSaved = await win.evaluate(() => { const o = {}; for (const k of ['pm.view', 'pm.pane1R', 'pm.clipDetail']) { try { o[k] = localStorage.getItem(k); localStorage.removeItem(k); } catch (_) {} } return o; });
    await win.evaluate(async ({ name, dir }) => {
      const ps = (await window.api.listPresets()) || [];
      for (const p of ps) if (p.name.indexOf('__테스트채널_삭제해도됨_도입부색_') === 0) { try { await window.api.removePreset({ name: p.name }); } catch (_) {} }
      await window.api.addPreset({ name });
      await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } });
    }, { name: CH, dir: TMP });
    chMade = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((n) => [...document.querySelectorAll('select option')].some((o) => o.value === n), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await win.waitForTimeout(800);

    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent.clip', { timeout: 20000 });
    await win.waitForTimeout(500);

    const bg = (sel) => win.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).backgroundColor : null; }, sel);
    const nIntro = await win.locator('.cut.intro').count(), nMain = await win.locator('.cut:not(.intro)').count();
    ok(nIntro === 2 && nMain === 1, `도입부 그룹 2개 · 본문 그룹 1개가 구분된다 (intro ${nIntro} · 본문 ${nMain})`);

    const introBg = await bg('.cut.intro .sent.clip'), mainBg = await bg('.cut:not(.intro) .sent.clip');
    ok(introBg === 'rgb(255, 241, 184)', `도입부 클립 배경 = 노랑 (${introBg})`);
    ok(mainBg === 'rgb(255, 255, 255)', `본문 클립 배경 = 흰색 그대로 (${mainBg})`);
    ok(introBg !== mainBg, '도입부와 본문 클립 색이 다르다(판정력)');
    const noIntro = await win.locator('.cut.intro .sent.clip').count(), noMain = await win.locator('.cut:not(.intro) .sent.clip').count();
    ok(noIntro === 4 && noMain === 2, `칠해진 클립 = 도입부 4개 · 본문 2개는 칠하지 않음 (${noIntro}/${noMain})`);

    // 선택한 도입부 클립은 제 색 — 노랑에 묻히지 않는다
    await win.locator('.cut.intro .sent.clip .clip-no .clip-no-n').first().click();
    await win.waitForTimeout(250);
    const pickedBg = await bg('.cut.intro .sent.clip.picked');
    const pickedNoBg = await win.evaluate(() => { const e = document.querySelector('.cut.intro .sent.clip.picked .clip-no'); return e ? getComputedStyle(e).backgroundColor : null; });
    ok(pickedBg === 'rgb(255, 255, 255)', `선택한 도입부 클립 = 제 색(흰 바탕) (${pickedBg})`);
    ok(pickedNoBg && pickedNoBg !== 'rgb(255, 215, 112)', `선택한 클립의 번호 칸은 도입부 노랑이 아니다 (${pickedNoBg})`);

    // 🎞 그룹 칸 — 도입부 그룹은 같은 노랑 · 맨 위 「도입부 N개」 줄(고정)
    const gc = await win.evaluate(() => {
      const head = document.querySelector('[data-testid=group-intro-cnt]'); const rows = document.querySelectorAll('.pane-groups .pg-row.intro');
      const t = document.querySelector('.pane-groups .pg-row.intro .pg-item:not(.cur) .pg-title');
      const h = document.querySelector('.pane-groups .pg-head.sticky');
      return { cnt: head ? head.textContent : null, rows: rows.length, title: t ? getComputedStyle(t).backgroundColor : null, sticky: h ? getComputedStyle(h).position : null };
    });
    ok(gc.rows > 0 && gc.cnt && gc.cnt.includes(`${gc.rows}개`), `그룹 칸 「${gc.cnt}」 = 노랑 그룹 ${gc.rows}개`);
    ok(gc.title === 'rgb(255, 215, 112)' && gc.sticky === 'sticky', `그룹 칸 도입부 제목 노랑 · 머리줄 고정 (${gc.title} · ${gc.sticky})`);

    // 🎞 그룹 칸에서 도입부(둘째) 그룹을 누르면 ② 칸이 그 그룹의 노랑 클립으로 이동한다
    await win.locator('[data-testid=group-item][data-g="2"]').click(); await win.waitForTimeout(700);
    const mv = await win.evaluate(() => {
      const cur = document.querySelector('main.pane2 .sent.clip.cur'); const pane = document.querySelector('main.pane2');
      if (!cur || !pane) return null;
      const cut = cur.closest('.cut'); const r = cur.getBoundingClientRect(), pr = pane.getBoundingClientRect();
      return { g: cut ? cut.getAttribute('data-g') : null, intro: !!(cut && cut.classList.contains('intro')), inView: r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1, notPlaying: !document.querySelector('.sent.clip.reading') };
    });
    ok(mv && mv.g === '2' && mv.intro && mv.inView && mv.notPlaying, `그룹 칸 2번(도입부) 클릭 → ② 칸 커서가 노랑 그룹 G2 클립으로 · 화면 안 (${JSON.stringify(mv)})`);
    const otherYellow = await win.evaluate(() => { const e = document.querySelector('main.pane2 .cut.intro[data-g="1"] .sent.clip:not(.picked):not(.cur)'); return e ? getComputedStyle(e).backgroundColor : null; });
    ok(otherYellow === 'rgb(255, 241, 184)', `다른 도입부 클립은 노랑 그대로 (${otherYellow})`);
    // ▶ 재생 중 읽는 클립은 하늘색(.reading)
    await win.locator('[data-testid=group-item][data-g="1"]').click(); await win.waitForTimeout(400);
    await win.locator('[data-testid=play-btn]').click(); await win.waitForTimeout(1500);
    const rd = await win.evaluate(() => { const e = document.querySelector('.sent.clip.reading'); return e ? { bg: getComputedStyle(e).backgroundColor, no: getComputedStyle(e.querySelector('.clip-no')).backgroundColor, n: document.querySelectorAll('.sent.clip.reading').length } : null; });
    ok(rd && rd.n === 1 && rd.bg === 'rgb(217, 241, 251)' && rd.no === 'rgb(25, 168, 214)', `재생 중 읽는 클립만 하늘색 (${JSON.stringify(rd)})`);
    await win.locator('[data-testid=play-btn]').click().catch(() => {}); await win.waitForTimeout(700);
    ok((await win.locator('.sent.clip.reading').count()) === 0, '멈추면 하늘색이 사라진다');

    if (process.env.INTRO_TINT_SHOT) {   // 경계(도입부 → 본문)가 보이게 본문 첫 그룹을 화면 가운데로
      await win.locator('.cut:not(.intro) .scene-h').first().scrollIntoViewIfNeeded();
      await win.evaluate(() => { const e = document.querySelector('.cut:not(.intro)'); if (e) e.scrollIntoView({ block: 'center' }); });
      await win.waitForTimeout(300); await win.screenshot({ path: process.env.INTRO_TINT_SHOT });
    }
    ok(errors.length === 0, `화면 오류 0건 (${errors.slice(0, 3).join(' | ')})`);
  } catch (e) {
    ok(false, 'E2E 예외: ' + (e && e.stack || e));
  } finally {
    if (chMade) { try { await (await app.firstWindow()).evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    if (lsSaved) { try { await (await app.firstWindow()).evaluate((o) => { for (const k of Object.keys(o)) { try { if (o[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, o[k]); } catch (_) {} } }, lsSaved); } catch (_) {} }
    try { await app.close(); } catch (_) {}
    for (const f of [SNAP]) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    console.log(`\n${fail ? '❌' : '✅'} 도입부 클립 색 E2E ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
