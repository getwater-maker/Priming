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
  '## 1장 — 첫 구간', '### 〔둘째 장면〕', '> 🖼️ 이미지: a blue room', '> 🔤 카드: 지역가입자 | 바뀐 세대만 달라진다 @왼쪽위', '셋째 문장입니다. 넷째 문장입니다.', '',
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
    ok(/지역가입자/.test(txt) && /바뀐 세대만 달라진다/.test(txt) && !/@/.test(txt), '판 안의 글자 = 낱말들(꼬리표 「@」 는 글에 안 나온다)');
    // 다섯째 문장 — 표
    await goto(5);
    const p5 = await settle((p) => p.includes('table'));
    ok(p5.includes('table'), `표가 ⑤번째 문장에서 보인다(${p5.join(',')})`);
    ok(await capHidden(), '표가 뜨는 동안 ① 자막은 가려진다');
    // [v0.8.8] 끌어 옮기기 → 대본(.md) 줄 끝에 @자리 · 글자 고치기 → 그 줄만 바뀐다 · 숫자가 바뀌면 경고
    win.on('dialog', (d) => { global.__dlgMsg = d.message(); d.accept().catch(() => {}); });
    await goto(4); await settle((p) => p.includes('words'));
    const before = fs.readFileSync(MD, 'utf8');
    {
      const hit = win.locator('[data-testid="info-hit"]').first();
      const hb = await hit.boundingBox();
      const st = await win.locator('#stage').boundingBox();
      ok(!!hb && hb.width > 20, '판 위에 끌 수 있는 자리(info-hit)가 있다');
      await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await win.mouse.down();
      await win.mouse.move(st.x + st.width * 0.75, st.y + st.height * 0.55, { steps: 8 });
      const dragging = await win.evaluate(() => !!document.querySelector('.stage-info-panel.dragging'));
      // 놓을 자리(판 왼쪽 위 모서리 %) — 끈 거리만큼 원래 자리에서 옮긴 곳(앱과 같은 셈)
      const want = { x: Math.round(((hb.x - st.x) / st.width + (st.width * 0.75 - (hb.x + hb.width / 2 - st.x)) / st.width) * 100), y: Math.round(((hb.y - st.y) / st.height + (st.height * 0.55 - (hb.y + hb.height / 2 - st.y)) / st.height) * 100) };
      await win.mouse.up();
      ok(dragging, '끄는 동안 판이 마우스를 따라 움직인다');
      await win.waitForTimeout(900);
      const after = fs.readFileSync(MD, 'utf8');
      const bl = before.split('\n'), al = after.split('\n');
      const diff = bl.map((l, i) => (l === al[i] ? -1 : i)).filter((i) => i >= 0);
      const tag = diff.length === 1 ? /@(\d+),(\d+)$/.exec(al[diff[0]]) : null;
      // [v0.8.13] 놓은 자리 그대로(예전: 네 자리로만 붙었다 — 로이 「위치 이동이 안 된다」)
      ok(bl.length === al.length && tag && Math.abs(+tag[1] - want.x) <= 1 && Math.abs(+tag[2] - want.y) <= 1 && /🔤 카드: 지역가입자 \| 바뀐 세대만 달라진다 @\d+,\d+$/.test(al[diff[0]]), `놓은 자리 그대로 → 대본 🔤 줄 끝 @가로,세로 (적힌 @${tag && tag[1]},${tag && tag[2]} · 놓은 곳 ${want.x},${want.y} · 다른 줄 그대로)`);
      await settle((p) => p.includes('words'));
      await win.waitForTimeout(800);
      const nb = await win.evaluate(() => { const st = document.getElementById('stage').getBoundingClientRect(); const r = document.querySelector('[data-type="words"] [data-testid="info-hit"]'); if (!r) return null; const b = r.getBoundingClientRect(); return { x: (b.left - st.left) / st.width * 100, y: (b.top - st.top) / st.height * 100 }; });
      ok(nb && tag && Math.abs(nb.x - +tag[1]) < 1.5 && Math.abs(nb.y - +tag[2]) < 1.5, `미리보기 판이 놓은 자리에 다시 그려진다(왼쪽 위 ${nb && nb.x.toFixed(1)}%,${nb && nb.y.toFixed(1)}%)`);
      // 🔤 글자가 판 안에 든다 — 판 크기를 잰 글꼴(Pretendard Bold)로 그린다(로이 화면: 「바뀐 세대만 달라진다」가 판 밖으로)
      const fit = await win.evaluate(() => { const pan = document.querySelector('[data-type="words"]'); const kids = [...pan.children]; const bg = kids.filter((d) => d.style.background).map((d) => d.getBoundingClientRect()).sort((a, b) => b.width - a.width)[0];
        const tx = kids.filter((d) => d.style.whiteSpace === 'pre'); return { right: Math.round(bg.right), texts: tx.map((d) => Math.round(d.getBoundingClientRect().right)), ff: tx[0] ? getComputedStyle(tx[0]).fontFamily : '' }; });
      ok(/PrimingInfoPretendard/.test(fit.ff) && fit.texts.every((r) => r <= fit.right), `글자가 판 안에(판 오른쪽 ${fit.right} · 글자 오른쪽 ${fit.texts.join(',')} · 글꼴 ${fit.ff.slice(0, 30)})`);
      // 📋 그림 + 자막 + 정보 카드 복사(v0.8.13) — 오른쪽 클릭 메뉴 · 클립보드 그림에 판이 들어 있다(그림 + 자막 복사와 다르다)
      const clip0 = await app.evaluate(({ clipboard }) => clipboard.readImage().toDataURL());   // 로이 클립보드는 되돌려 둔다
      const box = await win.locator('[data-type="words"] [data-testid="info-hit"]').boundingBox();
      const px = await (async () => {
        const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await win.mouse.click(st.x + st.width * 0.2, st.y + st.height * 0.6, { button: 'right' });
        await win.waitForSelector('[data-testid="sx-copy-info"]', { timeout: 3000 });
        const enabled = !(await win.locator('[data-testid="sx-copy-info"]').isDisabled());
        await win.click('[data-testid="sx-copy-info"]'); await win.waitForTimeout(900);
        const withInfo = await app.evaluate(({ clipboard }, p) => { const im = clipboard.readImage(); const s = im.getSize(); const b = im.toBitmap(); const i = (Math.round(p.y * s.height) * s.width + Math.round(p.x * s.width)) * 4; return { w: s.width, h: s.height, bgra: [b[i], b[i + 1], b[i + 2]] }; }, { x: (at.x - st.x) / st.width, y: (at.y - st.y) / st.height });
        await win.mouse.click(st.x + st.width * 0.2, st.y + st.height * 0.6, { button: 'right' });
        await win.waitForSelector('[data-testid="sx-copy-cap"]', { timeout: 3000 });
        await win.click('[data-testid="sx-copy-cap"]'); await win.waitForTimeout(900);
        const plain = await app.evaluate(({ clipboard }, p) => { const im = clipboard.readImage(); const s = im.getSize(); const b = im.toBitmap(); const i = (Math.round(p.y * s.height) * s.width + Math.round(p.x * s.width)) * 4; return { bgra: [b[i], b[i + 1], b[i + 2]] }; }, { x: (at.x - st.x) / st.width, y: (at.y - st.y) / st.height });
        return { enabled, withInfo, plain };
      })();
      await app.evaluate(({ clipboard, nativeImage }, u) => { if (u && u.length > 30) clipboard.writeImage(nativeImage.createFromDataURL(u)); }, clip0);
      const dif = px.withInfo.bgra.reduce((a, v, i) => a + Math.abs(v - px.plain.bgra[i]), 0);
      ok(px.enabled && px.withInfo.w >= 1900 && dif > 60, `📇 그림 + 자막 + 정보 카드 복사 — 판 자리의 색이 그림만 복사와 다르다(차이 ${dif} · ${px.withInfo.w}x${px.withInfo.h})`);
    }
    {
      await win.locator('[data-testid="info-hit"]').first().dblclick();
      await win.waitForSelector('[data-testid="info-edit-dlg"]', { timeout: 4000 });
      ok((await win.inputValue('[data-testid="info-edit-words"]')) === '지역가입자 | 바뀐 세대만 달라진다', '두 번 누르면 글자 고치기 창 — 현재 낱말이 들어 있다');
      await win.fill('[data-testid="info-edit-words"]', '가입자 | 피부양자');
      await win.click('[data-testid="info-edit-save"]');
      await win.waitForSelector('[data-testid="info-edit-dlg"]', { state: 'detached', timeout: 4000 });
      await win.waitForTimeout(700);
      const t = fs.readFileSync(MD, 'utf8');
      ok(/> 🔤 카드: 가입자 \| 피부양자 @\d+,\d+$/m.test(t) &&!/지역가입자 \| 바뀐 세대만 달라진다/.test(t) && t.includes('셋째 문장입니다. 넷째 문장입니다.') && t.includes('> 📊 표: 표 제목'), '저장하면 그 표시 줄의 글만 바뀐다(꼬리표 유지 · 낭독·표 줄 그대로)');
      const txt2 = await settle((p) => p.includes('words')); void txt2;
      const shown = await win.evaluate(() => (document.querySelector('[data-type="words"]') || {}).innerText || '');
      ok(/가입자/.test(shown) && /피부양자/.test(shown) && !/바뀐 세대만 달라진다/.test(shown), '미리보기 글도 바로 바뀐다');
      // 숫자 변경 경고
      global.__dlgMsg = '';
      await win.locator('[data-testid="info-hit"]').first().dblclick();
      await win.waitForSelector('[data-testid="info-edit-dlg"]', { timeout: 4000 });
      await win.fill('[data-testid="info-edit-words"]', '가입자 | 3개월');
      await win.click('[data-testid="info-edit-save"]');
      await win.waitForSelector('[data-testid="info-edit-dlg"]', { state: 'detached', timeout: 4000 });
      await win.waitForTimeout(500);
      ok(/팩트시트 대조 필요/.test(global.__dlgMsg || ''), '숫자가 바뀌면 「팩트시트 대조 필요」 경고가 뜬다');
      // 잘못된 글은 거절(@)
      await win.locator('[data-testid="info-hit"]').first().dblclick();
      await win.waitForSelector('[data-testid="info-edit-dlg"]', { timeout: 4000 });
      await win.fill('[data-testid="info-edit-words"]', '가@나');
      await win.click('[data-testid="info-edit-save"]');
      await win.waitForSelector('[data-testid="info-edit-err"]', { timeout: 3000 });
      ok(/@/.test(await win.locator('[data-testid="info-edit-err"]').innerText()), '「@」 가 든 글은 저장하지 않고 이유를 보여 준다');
      await win.click('.modal-card button:has-text("취소")');
    }
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
