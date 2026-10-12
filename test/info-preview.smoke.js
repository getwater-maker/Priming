'use strict';
/**
 * node test/info-preview.smoke.js — 📇 정보 카드 ① 미리보기(v0.8.7) 실제 앱 E2E.
 *
 * 채널 옵션 「📇 정보 카드」가 켜진 채널 + 표시 줄이 든 대본을 열면 ① 칸이 그 문장에서 보이는 판(구간 표지 · 낱말 카드 · 표)을 그린다.
 *   · 판이 없는 문장엔 아무것도 없다 · 표·구간 표지는 자막을 가린다 · 꼬리표 `@왼쪽위` 는 왼쪽에 놓인다 · 채널 옵션이 꺼지면 판이 없다
 * ⚠ 사용자 작업물 보호 — 임시 채널(출력 폴더 = 임시 폴더) + 임시 대본. 끝나면 채널·폴더·스냅샷을 지운다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TAG = `__정보미리보기테스트_${process.pid}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ipv-'));
const MD = path.join(TMP, `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const CH = '__테스트채널_삭제해도됨_정보_' + process.pid;
const SCRIPT = [
  '# 정보 미리보기 테스트', '',
  '## 도입부', '### 〔첫 장면〕', '> 🖼️ 이미지: a red room', '첫째 문장입니다. 둘째 문장입니다.', '',
  '## 1장 — 첫 구간', '### 〔둘째 장면〕', '> 🖼️ 이미지: a blue room', '> 🔤 카드: 지역가입자 | 임의계속가입 @왼쪽위', '셋째 문장입니다. 넷째 문장입니다.', '',
  '### 〔셋째 장면〕', '> 🖼️ 이미지: a red room', '> 📊 표: 표 제목', '> | 구분 | 값 |', '> | 기준 | 소득 |', '다섯째 문장입니다.', '',
].join('\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

(async () => {
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const FF = require('../core/media-utils').getFfmpegPath();
  const imgR = path.join(TMP, 'red.png'), imgB = path.join(TMP, 'blue.png');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xaa2020:s=1920x1080', '-frames:v', '1', imgR]);
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x2040aa:s=1920x1080', '-frames:v', '1', imgB]);
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false;
  try {
    const win = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 820); });
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async ({ name, dir }) => {
      const ps = (await window.api.listPresets()) || [];
      for (const p of ps) if (p.name.indexOf('__테스트채널_삭제해도됨_정보_') === 0) { try { await window.api.removePreset({ name: p.name }); } catch (_) {} }
      await window.api.addPreset({ name });
      await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, infoCards: true, capLong: { size: '100', align: 'start', yAlign: 'bottom', yOffset: -0.125 } } });
    }, { name: CH, dir: TMP });
    chMade = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((n) => [...document.querySelectorAll('select option')].some((o) => o.value === n), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await win.waitForTimeout(600);

    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sblk', { timeout: 20000 });
    for (const [i, img] of [[1, imgR], [2, imgB], [3, imgR]]) {
      await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, img);
      await win.locator('.cut .thumb.none').first().click();
      await win.click('[data-testid=vr-menu] button:has-text("첨부")');
      await win.waitForFunction((n) => document.querySelectorAll('.cut img.thumb').length >= n, i, { timeout: 5000 });
    }
    const goto = async (ln) => { await win.locator(`.sent[data-ln="${ln}"]`).first().click(); await win.waitForTimeout(250); };
    const panels = () => win.evaluate(() => [...document.querySelectorAll('[data-testid="stage-info"] .stage-info-panel')].map((e) => e.getAttribute('data-type')));
    const settle = async (want, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const p = await panels(); if (want(p)) return p; await win.waitForTimeout(300); } return panels(); };
    const capHidden = () => win.evaluate(() => getComputedStyle(document.getElementById('stageCap')).visibility === 'hidden');

    // 첫 문장 — 판 없음(도입부 · 구간 표지 없음)
    await goto(1); await win.waitForTimeout(1800);
    ok((await panels()).length === 0, '표시 줄이 닿지 않은 문장(도입부)에는 판이 없다');
    // 셋째 문장 — 구간 표지(자막을 가림)
    await goto(3);
    let p3 = await settle((p) => p.includes('cover'));
    ok(p3.includes('cover'), `구간 표지 「1 / 1」 이 ③번째 문장에서 보인다(${p3.join(',')})`);
    ok(await capHidden(), '구간 표지가 뜨는 동안 ① 자막은 가려진다');
    // 넷째 문장 — 낱말 카드(@왼쪽위 → 왼쪽)
    await goto(4);
    const p4 = await settle((p) => p.includes('words'));
    ok(p4.includes('words') && !p4.includes('cover'), `낱말 카드가 ④번째 문장에서 보인다(${p4.join(',')})`);
    ok(!(await capHidden()), '낱말 카드는 자막을 가리지 않는다');
    const box = await win.evaluate(() => { const st = document.getElementById('stage').getBoundingClientRect(); const r = [...document.querySelectorAll('[data-type="words"] div')].map((d) => d.getBoundingClientRect()).filter((b) => b.width > st.width * 0.2)[0]; return r ? { l: (r.left - st.left) / st.width, t: (r.top - st.top) / st.height, w: r.width / st.width } : null; });
    ok(box && box.l < 0.05 && box.t < 0.2 && box.w > 0.2 && box.w < 0.6, `꼬리표 @왼쪽위 → 판이 왼쪽 위에(왼쪽 ${box && box.l.toFixed(3)} · 위 ${box && box.t.toFixed(3)} · 폭 ${box && box.w.toFixed(3)})`);
    const txt = await win.evaluate(() => (document.querySelector('[data-type="words"]') || {}).innerText || '');
    ok(/지역가입자/.test(txt) && /임의계속가입/.test(txt) && !/@/.test(txt), '판 안의 글자 = 낱말들(꼬리표 「@」 는 글에 안 나온다)');
    // 다섯째 문장 — 표
    await goto(5);
    const p5 = await settle((p) => p.includes('table'));
    ok(p5.includes('table'), `표가 ⑤번째 문장에서 보인다(${p5.join(',')})`);
    ok(await capHidden(), '표가 뜨는 동안 ① 자막은 가려진다');
    // 채널 옵션을 끄면 판이 없다
    await win.evaluate(async (name) => { await window.api.savePreset({ name, patch: { infoCards: false } }); }, CH);
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((n) => [...document.querySelectorAll('select option')].some((o) => o.value === n), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await win.waitForTimeout(600);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sblk', { timeout: 20000 });
    await goto(4); await win.waitForTimeout(2200);
    ok((await panels()).length === 0, '채널 옵션 「📇 정보 카드」 를 끄면 미리보기에도 판이 없다');
  } catch (e) { fail++; console.log('  ✗ E2E 오류: ' + (e && e.message || e)); }
  finally {
    if (chMade) { try { await (await app.firstWindow()).evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    try { await app.close(); } catch (_) {}
    for (const f of [SNAP]) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    console.log(`\n${fail ? '❌' : '✅'} 정보 카드 미리보기 E2E ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
