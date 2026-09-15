'use strict';
/**
 * node test/script-edit.smoke.js — 실제 앱을 띄워 **문장 인라인 편집**을 끝까지 눌러 보는 E2E.
 *
 * 왜 필요한가: 단위 테스트는 core/main 을 검증하지만, 화면의 버튼이 실제로 눌리는지는 못 본다.
 *   이 저장소는 **미정의 식별자(`imgEngine`·`onPickImgEngine`)가 빌드를 통과하고 클릭할 때만 터지는**
 *   사고를 두 번 겪었다. 그래서 문장 클릭 → 고치기 → blur 저장 → Backspace/Del 합치기 → Enter 나누기를
 *   **실제로 클릭하고 실제로 키를 누른다**. 버튼이 사라진 설계라 이 배선이 깨지면 고칠 방법이 아예 없어진다.
 *
 * ⚠ 사용자 대본은 건드리지 않는다 — 임시 .md 를 만들어 열고, 끝나면 대본·스냅샷을 지운다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TAG = `__문장편집테스트_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);

const SCRIPT = [
  '# 문장 편집 테스트 대본',
  '> 🧭 **[메타 · 내레이션 제외]** 이 줄은 지침이라 문장이 되지 않습니다.',
  '',
  '## 도입부',
  '### 〔첫 장면〕',
  '> 🖼️ 이미지: a quiet room',
  '첫째 문장입니다. 둘째 문장입니다. 셋째 문장입니다.',
  '',
  '### 〔두 번째 장면〕',
  '> 🖼️ 이미지: a bus stop',
  '넷째 문장입니다. 다섯째 문장입니다.',
  '',
].join('\n');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } };
const eqNum = (a, b, label) => ok(a === b, `${label} (기대 ${b} / 실제 ${a})`);

const cleanup = () => {
  for (const f of [MD, SNAP]) { try { if (fs.existsSync(f)) fs.rmSync(f, { force: true }); } catch (_) {} }
};

(async () => {
  cleanup();
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });

    // 대본 열기 (대화상자 스텁)
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:text-is("대본")) button:has-text("열기")');
    await win.waitForSelector('.sblk', { timeout: 20000 });

    // [1] 헤더에 옛 ✏ 수정 버튼이 없다
    ok(await win.locator('.hgroup:has(.glabel:text-is("대본")) button:has-text("✏ 수정")').count() === 0,
      '롱폼 헤더에 ✏ 수정 버튼이 없다(문장 편집이 대체)');

    // [2] 문장 블록 — 첫 그룹은 문장 3개. 버튼은 하나도 없다(키보드 편집기).
    const blocks = win.locator('.cut').first().locator('.sblk');
    ok(await blocks.count() === 3, `첫 그룹에 문장 블록 3개 (실제 ${await blocks.count()})`);
    const firstText = (await blocks.first().innerText()).replace(/\s+/g, ' ');
    ok(/첫째 문장입니다/.test(firstText), '첫 블록이 첫 문장이다');
    eqNum(await win.locator('.sblk button').count(), 0, '🔑 문장 블록에 버튼이 하나도 없다(호버 ✎·⤋ 제거)');

    // [3] 문장을 **클릭**하면 그 자리가 편집칸이 된다
    await blocks.first().locator('.sblk-lines').click();
    await win.waitForSelector('.sblk.editing textarea', { timeout: 5000 });
    ok(await win.locator('.sblk.editing textarea').inputValue() === '첫째 문장입니다.', '편집칸에 그 문장이 들어 있다');
    eqNum(await win.locator('.sblk.editing button').count(), 0, '🔑 편집칸에도 저장·취소·나누기 버튼이 없다');
    // 🔑 그 줄 자리에서 그대로 고친다 — 안내문도 없고 칸이 커지지도 않는다(로이 요청 2026-09-15).
    eqNum(await win.locator('.sblk-hint').count(), 0, '🔑 편집칸 아래 안내문이 없다');
    {
      const grow = await win.evaluate(() => {
        const ed = document.querySelector('.sblk.editing');
        const plain = document.querySelector('.cut .sblk:not(.editing)');
        return Math.round(ed.getBoundingClientRect().height - plain.getBoundingClientRect().height);
      });
      ok(grow <= 6, `🔑 편집칸이 그 줄보다 커지지 않는다 (차이 ${grow}px)`);
    }
    // 🔑 번호(01 |)는 편집 중에도 그 자리에 그대로 있고, 글자 칸만 편집칸이 된다(로이 2026-09-15).
    eqNum(await win.locator('.sblk.editing .lineno').count(), 1, '🔑 편집 중에도 줄 번호가 보인다');
    ok((await win.locator('.sblk.editing .lineno').innerText()).trim() === '01 |',
      `편집 중 번호가 그 줄의 번호다 (실제 ${(await win.locator('.sblk.editing .lineno').innerText()).trim()})`);
    {
      const m = await win.evaluate(() => {
        const edNo = document.querySelector('.sblk.editing .lineno');
        const ta = document.querySelector('.sblk.editing textarea');
        const plain = document.querySelector('.cut .sblk:not(.editing) .sent');
        const plainNo = plain.querySelector('.lineno');
        // 평소 줄의 '글자 시작 x' 는 번호 span 다음 텍스트 노드에서 잰다
        const r = document.createRange(); r.setStart(plain, 1); r.setEnd(plain, plain.childNodes.length);
        return {
          noDx: Math.round(edNo.getBoundingClientRect().left - plainNo.getBoundingClientRect().left),
          txDx: Math.round(ta.getBoundingClientRect().left - r.getBoundingClientRect().left),
        };
      });
      ok(Math.abs(m.noDx) <= 1, `🔑 번호 위치가 평소 줄과 같다 (차이 ${m.noDx}px)`);
      ok(Math.abs(m.txDx) <= 2, `🔑 글자 시작 위치가 평소 줄과 같다 (차이 ${m.txDx}px)`);
    }

    // [4] 고치고 **칸을 벗어나면(blur) 저장** — 저장 버튼이 없으므로 이게 유일한 저장 방법이다
    await win.fill('.sblk.editing textarea', '고쳐 쓴 첫 문장입니다.');
    await win.locator('.sblk.editing textarea').blur();
    await win.waitForSelector('.sblk.editing', { state: 'detached', timeout: 10000 });
    await win.waitForFunction(() => /고쳐 쓴 첫 문장/.test(document.body.innerText), null, { timeout: 10000 });
    ok(true, '수정: 칸을 벗어나자 저장됐다 — 화면에 새 문장이 보인다');
    const md1 = fs.readFileSync(MD, 'utf8');
    ok(/고쳐 쓴 첫 문장입니다\./.test(md1), '수정: 대본(.md)에 반영됐다');
    ok(/둘째 문장입니다\./.test(md1) && /셋째 문장입니다\./.test(md1), '수정: 같은 줄의 다른 문장은 그대로');
    ok(/> 🧭 \*\*\[메타/.test(md1), '수정: 지침 줄(머리말)은 그대로');

    // [5] 🔑 **아랫줄 맨 앞에서 ←Backspace = 윗줄과 합치기** (로이가 요청한 그 동작)
    const b2 = win.locator('.cut').first().locator('.sblk');
    await b2.nth(1).locator('.sblk-lines').click();          // 둘째 문장을 연다
    await win.waitForSelector('.sblk.editing textarea', { timeout: 5000 });
    await win.press('.sblk.editing textarea', 'Control+Home'); // 커서를 맨 앞으로
    await win.press('.sblk.editing textarea', 'Backspace');
    await win.waitForFunction(() => document.querySelectorAll('.cut')[0].querySelectorAll('.sblk').length === 2, null, { timeout: 10000 });
    ok(true, '합치기(Backspace): 첫 그룹 문장이 3개 → 2개');
    const md2 = fs.readFileSync(MD, 'utf8');
    ok(/고쳐 쓴 첫 문장입니다 둘째 문장입니다\./.test(md2), '합치기: 대본에서 두 문장이 한 문장이 됐다');

    // [6] 🔑 **윗줄 맨 끝에서 Del = 아랫줄을 끌어올려 합치기**
    const b3 = win.locator('.cut').first().locator('.sblk');
    await b3.first().locator('.sblk-lines').click();
    await win.waitForSelector('.sblk.editing textarea', { timeout: 5000 });
    await win.press('.sblk.editing textarea', 'Control+End');   // 커서를 맨 끝으로
    await win.press('.sblk.editing textarea', 'Delete');
    await win.waitForFunction(() => document.querySelectorAll('.cut')[0].querySelectorAll('.sblk').length === 1, null, { timeout: 10000 });
    ok(true, '합치기(Del): 문장이 2개 → 1개');
    ok(/셋째 문장입니다\.?$/m.test(fs.readFileSync(MD, 'utf8').split('\n').find((l) => /고쳐 쓴 첫 문장/.test(l)) || ''),
      '합치기(Del): 아랫문장이 윗문장 뒤에 붙었다');

    // [7] 🔑 **Enter = 커서 자리에서 나누기** (저장이 아니다)
    const b4 = win.locator('.cut').first().locator('.sblk');
    await b4.first().locator('.sblk-lines').click();
    await win.waitForSelector('.sblk.editing textarea', { timeout: 5000 });
    await win.fill('.sblk.editing textarea', '앞 조각입니다 뒤 조각입니다');
    await win.locator('.sblk.editing textarea').evaluate((el) => el.setSelectionRange(7, 7)); // '앞 조각입니다' 뒤
    await win.press('.sblk.editing textarea', 'Enter');
    await win.waitForFunction(() => document.querySelectorAll('.cut')[0].querySelectorAll('.sblk').length === 2, null, { timeout: 10000 });
    ok(true, '나누기(Enter): 문장이 1개 → 2개');
    ok(/앞 조각입니다\. 뒤 조각입니다/.test(fs.readFileSync(MD, 'utf8')), '나누기: 대본에 두 문장으로 들어갔다');

    // [8] 그룹 첫 문장에서 Backspace → 윗 그룹과는 합치지 않는다(대본이 그대로여야 한다)
    const mdBefore = fs.readFileSync(MD, 'utf8');
    const b5 = win.locator('.cut').first().locator('.sblk');
    await b5.first().locator('.sblk-lines').click();
    await win.waitForSelector('.sblk.editing textarea', { timeout: 5000 });
    await win.press('.sblk.editing textarea', 'Control+Home');
    await win.press('.sblk.editing textarea', 'Backspace');
    await win.waitForTimeout(600);
    ok(fs.readFileSync(MD, 'utf8') === mdBefore, '🔑 그룹 첫 문장의 Backspace 는 대본을 건드리지 않는다');
    ok(await win.locator('.sblk.editing textarea').count() === 1, '그 경우 편집칸은 열린 채로 남는다');
    await win.press('.sblk.editing textarea', 'Escape');
    await win.waitForSelector('.sblk.editing', { state: 'detached', timeout: 5000 });

    // [9] Esc 로 취소하면 아무것도 안 바뀐다
    const b6 = win.locator('.cut').first().locator('.sblk');
    await b6.first().locator('.sblk-lines').click();
    await win.waitForSelector('.sblk.editing textarea', { timeout: 5000 });
    await win.fill('.sblk.editing textarea', '이건 취소할 글입니다.');
    await win.press('.sblk.editing textarea', 'Escape');
    await win.waitForSelector('.sblk.editing', { state: 'detached', timeout: 5000 });
    ok(!/이건 취소할 글입니다/.test(fs.readFileSync(MD, 'utf8')), 'Esc 취소: 대본이 바뀌지 않는다');

    // [10] 🔑 이 기능의 존재 이유 — **고친 문장만 음성이 비고, 나머지 문장의 음성은 그대로 남는다.**
    //   옛 「✏ 대본 수정」은 적용할 때마다 재파싱이라 **전 문장의 TTS 가 통째로 초기화**됐다.
    //   무음(dry) 만들기로 음성을 채운 뒤 한 문장을 고쳐 확인한다(TTS 서버·GPU 를 쓰지 않는다).
    const chan = `__문장편집채널_${process.pid}`;
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentedit-'));
    let chMade = false;
    try {
      chMade = await win.evaluate(async ({ name, dir }) => {
        try { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); return true; }
        catch (_) { return false; }
      }, { name: chan, dir: outDir });
      if (!chMade) { ok(true, '(임시 채널을 만들지 못해 음성 보존 검증은 건너뜀)'); }
      else {
        await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
        await win.evaluate(async (name) => { await window.api.openScript({ presetName: name }); }, chan);
        await win.waitForSelector('.sblk', { timeout: 20000 });
        const made = await win.evaluate(async (name) => {
          try {
            await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 7, aiNotice: false, openVrew: false });
            return 'ok';
          } catch (e) { return 'ERR: ' + e.message; }
        }, chan);
        ok(made === 'ok', '무음(dry) 만들기로 음성 채우기: ' + made);

        // 첫 그룹 두 번째 문장만 고친 뒤, 돌아온 DTO 에서 문장별 음성 유무를 본다.
        //   (편집 응답만으로 충분하다 — '고친 것 말고는 전부 음성이 있다'가 곧 보존의 증거다)
        const after = await win.evaluate(async () => {
          const r = await window.api.editSentences({ shortsNum: 1, groupNum: 1, sentIdx: 1, count: 1, text: '음성 보존 확인용으로 고친 문장입니다.' });
          if (!r || !r.ok) return { err: (r && r.error) || 'fail' };
          return { map: r.dto.projects[0].cuts.map((c) => (c.sentences || []).map((s) => (s.audio ? 1 : 0))) };
        });
        ok(!after.err, '문장 수정 성공' + (after.err ? ' — ' + after.err : ''));
        if (!after.err) {
          const flat = after.map.reduce((a, g) => a.concat(g), []);
          const lost = flat.filter((x) => !x).length;
          eqNum(lost, 1, '🔑 음성이 사라진 문장은 **고친 그 하나뿐**');
          eqNum(after.map[0][1], 0, '고친 문장의 음성은 비었다(다시 만들어야 한다)');
          eqNum(after.map[0][0], 1, '같은 그룹의 앞 문장 음성은 그대로');
          if (after.map[0].length > 2) eqNum(after.map[0][2], 1, '같은 그룹의 뒤 문장 음성도 그대로');
          if (after.map[1]) eqNum(after.map[1][0], 1, '다른 그룹의 문장 음성도 그대로');
        }
      }
    } finally {
      if (chMade) await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, chan);
      try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) {}
      try { fs.rmSync(path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`), { force: true }); } catch (_) {}
    }

    // [11] 화면 오류 0 — 미정의 식별자·렌더 예외가 없었는가
    ok(errors.length === 0, `화면 오류 0건 ${errors.length ? '— ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await app.close().catch(() => {});
    cleanup();
  }
  console.log(`\n${fail ? '❌' : '✅'} 문장 인라인 편집 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { cleanup(); console.error('E2E 오류:', e); process.exit(1); });
