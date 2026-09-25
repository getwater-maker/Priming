'use strict';
/**
 * node test/caption-format.smoke.js — 실제 앱을 띄워 **자막 서식(Vrew 자막 서식 창과 같은 기능)** 을 끝까지 눌러 보는 E2E (2026-09-25).
 *
 * 줄 번호 클릭 → 서식 툴바 → 굵게 → Shift 범위 → ⚙ 고급(그림자) → ✨ 효과(팝) → 글자 드래그 → 형광펜 → Esc →
 * 채널 편집 📝 자막 → 🎨 서식 창 → 글꼴 목록 → 미리보기 재생. 화면 오류 0.
 * ⚠ 사용자 대본은 건드리지 않는다 — 임시 .md 를 만들어 열고, 끝나면 대본·스냅샷을 지운다(채널 설정은 저장하지 않는다).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const menu = require('./_menu');

const ROOT = path.join(__dirname, '..');
const TAG = `__자막서식테스트_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const CH = '__테스트채널_삭제해도됨_서식_' + process.pid;   // 📐 「자막 서식 저장」은 임시 채널에만(로이 채널을 덮지 않는다)
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = [
  '# 자막 서식 테스트 대본',
  '',
  '## 도입부',
  '### 〔첫 장면〕',
  '> 🖼️ 이미지: a quiet room',
  '첫째 문장은 조금 길게 써서 자막 줄이 두 개로 나뉘게 합니다. 둘째 문장입니다. 셋째 문장입니다.',
  '',
].join('\n');

let pass = 0, fail = 0, chMade = false;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const cleanup = () => { for (const f of [MD, SNAP]) { try { if (fs.existsSync(f)) fs.rmSync(f, { force: true }); } catch (_) {} } };

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
    // 임시 채널 — 앞선 실행 잔재를 지우고 새로 만들어 헤더에서 고른다(채널 위치 = 아래·왼쪽·-0.125)
    await win.evaluate(async (name) => {
      const ps = (await window.api.listPresets()) || [];
      for (const p of ps) if (p.name.indexOf('__테스트채널_삭제해도됨_서식_') === 0) { try { await window.api.removePreset({ name: p.name }); } catch (_) {} }
      await window.api.addPreset({ name });
      await window.api.savePreset({ name, patch: { capLong: { size: '100', align: 'start', yAlign: 'bottom', yOffset: -0.125 } } });
    }, CH);
    chMade = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((n) => [...document.querySelectorAll('select option')].some((o) => o.value === n), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await win.waitForTimeout(800);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sblk', { timeout: 20000 });

    const spansOf = async () => win.evaluate(async () => {
      // 화면 DTO 는 main 이 보낸다 — 작업본을 직접 읽지 않고 화면에 보이는 서식 구간으로 센다
      return [...document.querySelectorAll('.cut .capfmt')].map((e) => ({ t: e.textContent, w: getComputedStyle(e).fontWeight, bg: getComputedStyle(e).backgroundColor }));
    });

    // [1] 줄 번호 → 툴바
    const nos = win.locator('.cut .cf-lineno');
    ok(await nos.count() >= 4, `줄 번호(서식 손잡이) ${await nos.count()}개`);
    // 📐 v0.5.41 — 툴바는 늘 떠 있다(고른 게 없으면 안내 + 잠김)
    await menu(win, 'format');   // 🧭 v0.5.42 — 툴바는 「서식」 메뉴 리본에 있다
    ok(await win.locator('[data-testid=cf-bar].idle').count() === 1, '🔑 고르지 않아도 툴바가 떠 있다(작업 화면에 상시)');
    ok((await win.locator('[data-testid=cf-hint]').innerText()).includes('줄 번호'), '고른 게 없으면 「줄 번호를 누르거나 글자를 드래그」 안내');
    ok(await win.locator('.cf-bar button[title="굵게"]').isDisabled(), '고른 게 없으면 칸은 잠겨 있다');
    { const tb = await win.locator('[data-testid=cf-bar]').boundingBox(); const head = await win.locator('.topsticky').boundingBox();
      ok(tb && head && tb.y >= head.y && tb.y + tb.height <= head.y + head.height + 1, `툴바가 고정 헤더 안(가려지지 않음) — 툴바 y ${tb && Math.round(tb.y)} · 헤더 ${head && Math.round(head.y)}~${head && Math.round(head.y + head.height)}`);
      const hit = await win.evaluate(() => { const b = document.querySelector('.cf-bar [data-testid=cf-savedef]'); const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!(el && (el === b || b.contains(el))); });
      ok(hit, '툴바 단추 위에 다른 것이 덮여 있지 않다(elementFromPoint)'); }
    await nos.nth(0).click();
    await win.waitForSelector('[data-testid=cf-bar]:not(.idle)', { timeout: 5000 });
    ok((await win.locator('.cf-bar .cf-sel').innerText()).includes('자막 01'), '줄 번호를 누르면 툴바가 뜨고 「자막 01」을 고른다');
    ok(await win.locator('.sblk.editing').count() === 0, '🔑 줄 번호를 눌러도 문장 편집칸은 열리지 않는다');
    ok(await win.locator('.sent.picked').count() === 1, '고른 줄이 표시된다');

    // [2] 굵게 — 글자색도
    await win.click('.cf-bar button[title="굵게"]');
    await win.waitForFunction(() => document.querySelectorAll('.cut .capfmt').length > 0, null, { timeout: 5000 });
    let sp = await spansOf();
    ok(sp.length >= 1 && Number(sp[0].w) >= 700, `굵게를 누르자 그 줄이 굵은 서식 구간이 됐다 (${sp.length}구간)`);

    // [3] Shift = 범위
    await nos.nth(2).click({ modifiers: ['Shift'] });
    await win.waitForFunction(() => document.querySelectorAll('.sent.picked').length === 3, null, { timeout: 3000 });
    ok((await win.locator('.cf-bar .cf-sel').innerText()).includes('3줄'), 'Shift+클릭 = 줄 범위(3줄)');

    // [4] ⚙ 고급 — 그림자 켜기
    await win.click('.cf-bar button:has-text("⚙ 고급")');
    await win.waitForSelector('[data-testid=cf-side] [data-testid=cf-panel]', { timeout: 3000 });
    ok(true, '⚙ 고급 = 옆 패널(Vrew 고급 창)');
    await win.locator('[data-testid=cf-panel] .cf-sech:has-text("그림자") input[type=checkbox]').check();
    await win.waitForFunction(() => [...document.querySelectorAll('.cut .capfmt')].some((e) => getComputedStyle(e).textShadow !== 'none'), null, { timeout: 5000 });
    ok(true, '그림자를 켜자 고른 줄에 그림자가 생겼다');
    ok(await win.locator('[data-testid=cf-panel] .cf-sech:has-text("저장된 서식")').count() === 1 && await win.locator('[data-testid=cf-panel] .cf-sech:has-text("간격")').count() === 1, '저장된 서식 · 간격 · 테두리 · 배경 · 형광펜 · 그림자 칸');
    await win.click('[data-testid=cf-panel] .cf-tabs button:has-text("글꼴")');
    await win.waitForSelector('[data-testid=cf-fontlist] .cf-font', { timeout: 8000 });
    ok(await win.locator('[data-testid=cf-fontlist] .cf-font').count() >= 1, `글꼴 목록 ${await win.locator('[data-testid=cf-fontlist] .cf-font').count()}종(Vrew 에서 쓴 글꼴 포함)`);

    // [5] ✨ 효과 — 팝
    await win.click('.cf-bar button:has-text("✨ 효과")');
    await win.waitForSelector('[data-testid=cf-side] [data-testid=cf-anim]', { timeout: 3000 });
    ok(await win.locator('[data-testid=cf-anim] .cf-anim').count() >= 9, `효과 카드 ${await win.locator('[data-testid=cf-anim] .cf-anim').count()}개(Vrew 9종)`);
    await win.click('[data-testid=cf-anim] .cf-anim:has-text("팝")');
    await win.waitForFunction(() => document.querySelectorAll('.cut .cf-animbadge').length >= 3, null, { timeout: 5000 });
    ok(true, '팝을 고르자 고른 3줄에 효과 표시(✨)');
    ok(await win.locator('[data-testid=cf-anim] .cf-animopts').count() === 1 && await win.locator('[data-testid=cf-anim] .cf-seg button:has-text("등장")').count() === 1, '타이밍(등장/퇴장)·방향·재생 시간·시작 지연 칸');
    await win.click('[data-testid=cf-anim] .cf-seg button:has-text("퇴장")');
    await win.waitForTimeout(400);
    ok((await win.locator('[data-testid=cf-anim] .cf-cur b').innerText()).includes('퇴장'), '타이밍을 퇴장으로 바꿀 수 있다');

    // [6] Esc — 패널 → 선택 해제
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-testid=cf-side]', { state: 'detached', timeout: 3000 });
    ok(await win.locator('[data-testid=cf-bar]').count() === 1, 'Esc 한 번 = 옆 패널만 닫힌다');
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-testid=cf-bar].idle', { timeout: 3000 });
    ok(true, 'Esc 두 번 = 선택 해제(툴바는 안내 상태로 남는다)');

    // [7] 글자 드래그 → 그 글자만 형광펜
    const lastBlk = win.locator('.cut .sblk').nth(2).locator('.sblk-lines');
    await win.evaluate(() => {
      const blk = document.querySelectorAll('.cut .sblk')[2].querySelector('.sblk-lines');
      const sp_ = [...blk.querySelectorAll('[data-off]')][0];
      const tn = [...sp_.childNodes].find((n) => n.nodeType === 3);
      const r = document.createRange(); r.setStart(tn, 0); r.setEnd(tn, 2);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await lastBlk.dispatchEvent('click');
    await win.waitForSelector('[data-testid=cf-bar]:not(.idle)', { timeout: 3000 });
    ok((await win.locator('.cf-bar .cf-sel').innerText()).includes('글자 2자'), '🔑 글자를 드래그하면 그 글자만 고른다(「글자 2자」) · 편집칸은 열리지 않는다');
    ok(await win.locator('.sblk.editing').count() === 0, '글자 선택 때 문장 편집칸이 열리지 않는다');
    await win.click('.cf-bar button[title^="형광펜"]');
    await win.waitForFunction(() => [...document.querySelectorAll('.cut .sblk')[2].querySelectorAll('.capfmt')].some((e) => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)'), null, { timeout: 5000 });
    sp = await win.evaluate(() => [...document.querySelectorAll('.cut .sblk')[2].querySelectorAll('.capfmt')].map((e) => e.textContent));
    ok(sp.length === 1 && sp[0].length === 2, `형광펜이 고른 두 글자에만 (${JSON.stringify(sp)})`);
    await win.click('.cf-bar button:has-text("서식 지우기")');
    await win.waitForFunction(() => ![...document.querySelectorAll('.cut .sblk')[2].querySelectorAll('.capfmt')].some((e) => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)'), null, { timeout: 5000 });
    ok(true, '서식 지우기 = 채널 기본으로');
    await win.keyboard.press('Escape');

    // [P] 📐 줄별 위치·정렬 — 01 줄만 오른쪽 · 위
    await nos.nth(0).click();
    await win.waitForSelector('[data-testid=cf-bar]:not(.idle)', { timeout: 3000 });
    ok(await win.locator('[data-testid=cf-posh] button[title="가로 왼쪽 정렬"].on').count() === 1, '처음 위치 = 채널 위치(왼쪽 정렬)');
    await win.click('[data-testid=cf-posh] button[title="가로 오른쪽 정렬"]');
    await win.waitForSelector('[data-testid=cf-posh] button[title="가로 오른쪽 정렬"].on', { timeout: 5000 });
    ok(true, '가로 ⇥ 를 누르자 이 줄이 오른쪽 정렬');
    await win.click('[data-testid=cf-posv] button[title="세로 위"]');
    await win.waitForSelector('[data-testid=cf-posv] button[title="세로 위"].on', { timeout: 5000 });
    ok(await win.locator('[data-testid=cf-posv] input').inputValue() === '50', `세로 위를 누르면 위 기본 위치(0.125 = 50칸) — ${await win.locator('[data-testid=cf-posv] input').inputValue()}`);
    await win.locator('[data-testid=cf-posh] input').fill('40');
    await win.waitForTimeout(600);
    ok(await win.locator('[data-testid=cf-posh] input').inputValue() === '40', '가로 미세 40칸(0.1) 입력');
    await nos.nth(1).click();
    await win.waitForSelector('[data-testid=cf-posh] button[title="가로 왼쪽 정렬"].on', { timeout: 3000 });
    ok(true, '🔑 다른 줄(02)은 채널 위치(왼쪽) 그대로');
    await nos.nth(0).click();
    await win.waitForSelector('[data-testid=cf-posh] button[title="가로 오른쪽 정렬"].on', { timeout: 3000 });
    // [S] 💾 자막 서식 저장 → 채널 기본값
    await win.click('[data-testid=cf-savedef]');
    await win.waitForTimeout(900);
    const cap = await win.evaluate(async (n) => ((await window.api.getPresetDetail(n)) || {}).capLong || {}, CH);
    ok(cap.align === 'end' && cap.yAlign === 'top' && Math.abs(cap.yOffset - 0.125) < 1e-6 && Math.abs(cap.xOffset - 0.1) < 1e-6,
      `💾 자막 서식 저장 → 채널 capLong (정렬 ${cap.align} · 세로 ${cap.yAlign} ${cap.yOffset} · 가로 ${cap.xOffset})`);
    ok(!!cap.fontColor && !!cap.font && String(cap.size) === '100', `서식도 함께 저장(글꼴 ${cap.font} · 크기 ${cap.size})`);
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-testid=cf-bar].idle', { timeout: 3000 });
    ok(await win.locator('[data-testid=cf-posh] button[title="가로 오른쪽 정렬"].on').count() === 1, '저장 뒤 헤더(채널 위치)도 새 값 — 고른 게 없어도 오른쪽');

    // [8] 문장을 고쳐도 서식이 남는다(오타 고치기)
    await win.locator('.cut .sblk').nth(1).locator('.sblk-lines').click();
    await win.waitForSelector('.sblk.editing textarea', { timeout: 5000 });
    await win.fill('.sblk.editing textarea', '둘째 문장이에요.');
    await win.locator('.sblk.editing textarea').blur();
    await win.waitForSelector('.sblk.editing', { state: 'detached', timeout: 10000 });
    await win.waitForFunction(() => /둘째 문장이에요/.test(document.body.innerText), null, { timeout: 10000 });
    ok(await win.locator('.cut .sblk').nth(1).locator('.capfmt').count() >= 1, '🔑 문장을 고쳐도 그 문장의 서식이 남는다');

    // [9] 작업본에 저장됐는지(서식은 대본이 아니라 작업본)
    await win.waitForTimeout(2500);
    const snap = fs.existsSync(SNAP) ? JSON.parse(fs.readFileSync(SNAP, 'utf8')) : null;
    const sents = snap ? snap.projects[0].groups.flatMap((g) => g.sentences) : [];
    ok(sents.filter((s) => s.capSpans && s.capSpans.length).length >= 2, `작업본에 문장 서식이 저장됐다 (${sents.filter((s) => s.capSpans).length}문장)`);
    ok(!/capSpans|bold/.test(fs.readFileSync(MD, 'utf8')), '대본(.md)은 서식 때문에 바뀌지 않는다');

    // [10] 미리보기 재생 — 서식 구간으로 그린다
    await win.click('.cut .gprev[title="이 그룹 미리듣기"]');
    await win.waitForSelector('#stageCap .cf-stageline', { timeout: 8000 });
    ok(await win.locator('#stageCap .cf-stageline span').count() >= 1, '미리보기 재생이 서식 구간으로 그린다');
    ok(await win.evaluate(() => getComputedStyle(document.getElementById('stageCap')).textAlign) === 'right', '📐 미리보기도 01 줄을 오른쪽 정렬로 그린다');
    await win.keyboard.press('Escape');

    // [11] 채널 편집 → 📝 자막 → 🎨 서식 창
    await win.click('button[title^="채널(프리셋)"]');
    await win.waitForSelector('.modal-card.tabbed', { timeout: 8000 });
    await win.click('.modal-card.tabbed button:has-text("📝 자막·분할")');
    await win.waitForSelector('[data-testid=ch-capfmt]', { timeout: 3000 });
    ok(true, '📝 자막 탭에 「🎨 글꼴·간격·형광펜·그림자」 버튼');
    const chv = await win.evaluate(() => {
      const sels = [...document.querySelectorAll('.modal-card.tabbed select')];
      const al = sels.find((x) => [...x.options].some((o) => o.value === 'end') && [...x.options].some((o) => o.value === 'start'));
      const ya = sels.find((x) => [...x.options].some((o) => o.value === 'top') && [...x.options].some((o) => o.value === 'middle'));
      const xin = [...document.querySelectorAll('.modal-card.tabbed .crow')].find((r) => /가로/.test(r.textContent) && /정렬/.test(r.textContent));
      const ins = xin ? [...xin.querySelectorAll('input.n')] : [];
      return { align: al && al.value, yAlign: ya && ya.value, x: ins.length ? ins[ins.length - 1].value : null };
    });
    ok(chv.align === 'end' && chv.yAlign === 'top' && chv.x === '40', `🔑 채널 편집을 다시 열면 저장한 값이 남아 있다 (${JSON.stringify(chv)})`);
    await win.click('[data-testid=ch-capfmt]');
    await win.waitForSelector('[data-testid=capdlg] [data-testid=cf-panel]', { timeout: 3000 });
    ok(await win.locator('[data-testid=capdlg] [data-testid=cf-anim]').count() === 1, '채널 서식 창 = 고급 서식 + 애니메이션(모든 줄 기본 효과)');
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-testid=capdlg]', { state: 'detached', timeout: 3000 });
    ok(await win.locator('.modal-card.tabbed').count() === 1, 'Esc 는 서식 창만 닫는다(채널 편집은 남는다)');
    await win.keyboard.press('Escape');

    ok(errors.length === 0, `화면 오류 0건 (${errors.slice(0, 3).join(' | ')})`);
  } catch (e) {
    ok(false, 'E2E 예외: ' + (e && e.stack || e));
  } finally {
    if (chMade) { try { await (await app.firstWindow()).evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    try { await app.close(); } catch (_) {}
    cleanup();
    console.log(`\n${fail ? '❌' : '✅'} 자막 서식 E2E ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
