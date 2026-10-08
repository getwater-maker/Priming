'use strict';
/**
 * node test/clip-toolbar-scroll.smoke.js — 고른 클립이 화면 밖으로 스크롤돼도 클립 도구 막대가 사라지지 않는다 (v0.5.99 · 로이 2026-09-30 「또 사라졌네」)
 *   60그룹·360클립 대본에서 클립을 고르고 목록을 스크롤로 멀리 보낸다 → 막대는 화면 가장자리에 남고, 눌러서 동작한다(🗑).
 *   ⚠ 임시 채널·임시 대본만 쓴다.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TAG = `__막대스크롤_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const groups = [];
for (let g = 1; g <= 60; g++) groups.push(`### 〔장면 ${g}〕`, `> 🖼️ 이미지: scene ${g}`, [1, 2, 3].map((k) => `${g}번 장면의 ${k}번째 문장입니다. 조금 더 길게 써서 줄이 나뉘도록 합니다.`).join(' '), '');
fs.writeFileSync(MD, ['# 큰 대본', '', '## 장', ...groups].join('\n'), 'utf8');

(async () => {
  const chan = `__막대스크롤채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctbscroll-'));
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(String(e)));
  try {
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async ({ name, dir }) => { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); }, { name: chan, dir: outDir });
    await win.reload(); await win.waitForSelector('h1'); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(300);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    await win.waitForTimeout(800);
    const total = await win.evaluate(() => document.querySelectorAll('.sent[data-ln]').length);
    ok(total >= 300, `긴 대본: 클립 ${total}개`);

    const el = win.locator('.sent[data-ln="5"] .cf-lineno').first();
    await el.scrollIntoViewIfNeeded(); await el.click(); await win.waitForTimeout(500);
    const near = await win.evaluate(() => ({ tb: !!document.querySelector('[data-testid="clip-tb"]') }));
    ok(near.tb, '고르면 막대가 뜬다');

    // 목록을 멀리 스크롤 — 스크롤되는 칸을 모두 맨 아래로
    await win.evaluate(() => { document.querySelectorAll('*').forEach((e) => { if (e.scrollHeight > e.clientHeight + 200 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) e.scrollTop = e.scrollHeight; }); });
    await win.waitForTimeout(600);
    const far = await win.evaluate(() => {
      const row = [...document.querySelectorAll('.sent[data-ln="5"]')].find((x) => x.offsetParent !== null);
      const rr = row && row.getBoundingClientRect();
      const t = document.querySelector('[data-testid="clip-tb"]'); const r = t && t.getBoundingClientRect();
      const b = document.querySelector('[data-testid="ctb-del"]'); const br = b && b.getBoundingClientRect();
      const hit = br && document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
      let sc = row && row.parentElement;
      while (sc && sc !== document.body) { const oy = getComputedStyle(sc).overflowY; if ((oy === 'auto' || oy === 'scroll') && sc.scrollHeight > sc.clientHeight) break; sc = sc.parentElement; }
      const sr = sc && sc !== document.body ? sc.getBoundingClientRect() : null;
      return { inPane: !!(r && sr && r.top >= sr.top && r.bottom <= sr.bottom), paneTop: sr && sr.top, tbTop: r && r.top, dbg: { picked: [...document.querySelectorAll('.sent.picked')].length, rowExists: !!row, tbAny: !!document.querySelector('.clip-tb'), all5: document.querySelectorAll('.sent[data-ln="5"]').length }, rowOut: !!(rr && (rr.bottom < 0 || rr.top > innerHeight)), tb: !!t, inView: !!(r && r.top >= 0 && r.bottom <= innerHeight), clickable: !!(hit && hit.closest('[data-testid="ctb-del"]')) };
    });
    ok(far.rowOut, '판별력: 고른 5번 클립이 실제로 화면 밖으로 밀려났다');
    ok(!far.tb, '🔑 고른 클립이 목록 칸 밖으로 스크롤되면 막대도 사라진다(v0.7.25)');
    await win.evaluate(() => { const r = [...document.querySelectorAll('.sent[data-ln="5"]')].find((x) => x.offsetParent !== null); if (r) r.scrollIntoView({ block: 'center' }); });
    await win.waitForTimeout(500);
    const back = await win.evaluate(() => { const t = document.querySelector('[data-testid="clip-tb"]'); const r = t && t.getBoundingClientRect(); const row = [...document.querySelectorAll('.sent[data-ln="5"]')].find((x) => x.offsetParent !== null); let sc = row && row.parentElement; while (sc && sc !== document.body) { const oy = getComputedStyle(sc).overflowY; if ((oy === 'auto' || oy === 'scroll') && sc.scrollHeight > sc.clientHeight) break; sc = sc.parentElement; } const sr = sc && sc.getBoundingClientRect(); return { tb: !!t, inPane: !!(r && sr && r.top >= sr.top && r.bottom <= sr.bottom) }; });
    ok(back.tb && back.inPane, '다시 스크롤해 돌아오면 막대가 목록 칸 안에 다시 뜬다');

    // ⌨ Home/End(v0.7.24): 고른 클립이 있으면 그 그룹의 처음·끝 클립, 없으면 대본 처음·끝 — 자막 칸을 열지 않고 클립을 고른다
    const pick = async (n) => { const e = win.locator('.sent[data-ln="' + n + '"] .cf-lineno').first(); await e.scrollIntoViewIfNeeded(); await e.click(); await win.waitForTimeout(300); };
    const state = () => win.evaluate(() => ({ picked: [...document.querySelectorAll('.sent.picked')].map((x) => +x.getAttribute('data-ln')), edit: document.querySelectorAll('textarea:focus').length }));
    const grp = await win.evaluate(() => { const rows = [...document.querySelectorAll('.sent[data-ln]')].filter((x) => x.offsetParent !== null);
      const g = (e) => e.closest('.cut[data-g]') ? e.closest('.cut[data-g]').getAttribute('data-g') : null;
      const by = {}; rows.forEach((e) => { const k = g(e); (by[k] = by[k] || []).push(+e.getAttribute('data-ln')); });
      const k = Object.keys(by).find((x) => by[x].length >= 3 && by[x][0] > 1); return k ? by[k] : null; });
    if (grp) {
      await pick(grp[1]); await win.keyboard.press('End'); await win.waitForTimeout(400);
      let s = await state(); ok(s.picked.length === 1 && s.picked[0] === grp[grp.length - 1] && s.edit === 0, `End = 그룹 마지막 클립 ${grp[grp.length - 1]} 고름(칸 안 열림) — ${JSON.stringify(s)}`);
      await win.keyboard.press('Home'); await win.waitForTimeout(400);
      s = await state(); ok(s.picked.length === 1 && s.picked[0] === grp[0] && s.edit === 0, `Home = 그룹 첫 클립 ${grp[0]} 고름 — ${JSON.stringify(s)}`);
    } else ok(false, '그룹 찾기 실패(.cut[data-g])');
    // 클립 밖을 누르면 선택이 남아 있어도 Home/End = 대본 처음·끝(v0.7.25)
    await pick(grp[1]);
    await win.mouse.click(2, 300); await win.waitForTimeout(200);
    await win.keyboard.press('End'); await win.waitForTimeout(500);
    let so = await state(); ok(so.picked.length === 1 && so.picked[0] === total, `클립 밖 클릭 뒤 End = 마지막 클립 ${total} — ${JSON.stringify(so)}`);
    await win.mouse.click(2, 300); await win.keyboard.press('Home'); await win.waitForTimeout(500);
    so = await state(); ok(so.picked.length === 1 && so.picked[0] === 1, `클립 밖 클릭 뒤 Home = 1번 클립 — ${JSON.stringify(so)}`);
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
    await win.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
    let s2 = await state();
    if (s2.picked.length) { await win.keyboard.press('Escape'); await win.waitForTimeout(300); s2 = await state(); }
    ok(s2.picked.length === 0, `판별력: 고른 클립 없음 ${JSON.stringify(s2)}`);
    await win.keyboard.press('End'); await win.waitForTimeout(500);
    s2 = await state(); ok(s2.picked.length === 1 && s2.picked[0] === total && s2.edit === 0, `선택 없이 End = 마지막 클립 ${total} — ${JSON.stringify(s2)}`);
    // ⏹ TTS 를 안 만든 클립을 만나면 재생이 멈춘다(v0.7.29) — E2E 는 기본으로 끄므로 켜고 본다
    await win.evaluate(() => localStorage.setItem('pm.stopNoTts', '1'));
    await win.keyboard.press('Escape'); await pick(3); await win.keyboard.press('Escape');
    await win.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
    await win.keyboard.press(' '); await win.waitForTimeout(1200);
    const pl = await win.evaluate(() => ({ btn: (document.querySelector('[data-testid=play-btn]') || {}).textContent || '', cur: (document.querySelector('.sent.cur') || { getAttribute: () => null }).getAttribute('data-ln'), st: document.body.innerText.includes('아직 TTS 를 만들지 않아 재생을 멈췄습니다') }));
    ok(!pl.btn.includes('■') && pl.st, `TTS 없는 클립 → 재생이 바로 멈추고 안내가 뜬다 — ${JSON.stringify(pl)}`);
    await win.evaluate(() => localStorage.removeItem('pm.stopNoTts'));
    // 클립 밖(카드 사이 빈 곳)을 누르면 가장 가까운 클립이 골라진다(v0.7.29)
    await win.keyboard.press('Escape'); await win.waitForTimeout(200);
    const gap = await win.evaluate(() => { const rows = [...document.querySelectorAll('main.pane2 .sent[data-ln]')].filter((x) => { const r = x.getBoundingClientRect(); return x.offsetParent !== null && r.top > 200 && r.bottom < innerHeight - 20; }); for (let i = 0; i + 1 < rows.length; i++) { const a = rows[i].getBoundingClientRect(), b = rows[i + 1].getBoundingClientRect(); if (b.top - a.bottom >= 4) { const y = (a.bottom + b.top) / 2; return { x: a.left + 40, y, near: Number(rows[i].dataset.ln), a: a.bottom, b: b.top }; } } return null; });
    if (gap) {
      await win.mouse.click(gap.x, gap.y); await win.waitForTimeout(300);
      const gs = await state(); ok(gs.picked.length === 1 && (gs.picked[0] === gap.near || gs.picked[0] === gap.near + 1), `카드 사이 빈 곳 클릭 → 가까운 클립(${gap.near}/${gap.near + 1}) 선택 — ${JSON.stringify(gs)}`);
    } else ok(false, '카드 사이 빈 곳을 못 찾음');
    // 🎞 가운데 그룹 칸(v0.7.30): 그룹이 나열되고, 누르면 그 그룹의 첫 클립이 골라진다
    const gc = await win.evaluate(() => ({ n: document.querySelectorAll('[data-testid="group-item"]').length, cur: (document.querySelector('[data-testid="group-item"].cur') || {}).dataset && document.querySelector('[data-testid="group-item"].cur').dataset.g }));
    ok(gc.n >= 3, `그룹 칸에 그룹이 나열된다(${gc.n}개 · 지금 G${gc.cur})`);
    const target = await win.evaluate(() => { const its = [...document.querySelectorAll('[data-testid="group-item"]')]; const it = its[Math.min(5, its.length - 1)]; const g = it.dataset.g; const first = [...document.querySelectorAll('.cut[data-g="' + g + '"] .sent[data-ln]')][0]; return { g, ln: first ? Number(first.dataset.ln) : null }; });
    await win.locator('[data-testid="group-item"][data-g="' + target.g + '"]').click(); await win.waitForTimeout(500);
    const gs2 = await state(); ok(gs2.picked.length === 1 && gs2.picked[0] === target.ln && gs2.edit === 0, `그룹 G${target.g} 클릭 → 그 그룹 첫 클립 ${target.ln} 선택 — ${JSON.stringify(gs2)}`);
    ok(await win.evaluate((g) => !!document.querySelector('[data-testid="group-item"].cur[data-g="' + g + '"]'), target.g), '눌린 그룹이 표시된다(.cur)');
    // ⌨ 그룹 칸 방향키(v0.7.66): ↓·→ 다음 그룹 / ↑·← 앞 그룹 — 초점이 그룹 칸에 남아 이어 누를 수 있다
    { const order = await win.evaluate(() => [...document.querySelectorAll('[data-testid="group-item"]')].map((x) => x.dataset.g));
      const i0 = order.indexOf(String(target.g));
      const curG = () => win.evaluate(() => { const c = document.querySelector('[data-testid="group-item"].cur'); return c ? c.dataset.g : null; });
      const firstLn = (g) => win.evaluate((gg) => { const f = document.querySelector('.cut[data-g="' + gg + '"] .sent[data-ln]'); return f ? Number(f.dataset.ln) : null; }, g);
      await win.keyboard.press('ArrowDown'); await win.waitForTimeout(300);
      const s1 = await state(); ok(await curG() === order[i0 + 1] && s1.picked[0] === await firstLn(order[i0 + 1]) && s1.edit === 0, `↓ → 다음 그룹 G${order[i0 + 1]} 첫 클립 — ${JSON.stringify(s1)}`);
      await win.keyboard.press('ArrowRight'); await win.waitForTimeout(300);
      ok(await curG() === order[i0 + 2], `→ → 그다음 그룹 G${order[i0 + 2]}(지금 G${await curG()})`);
      await win.keyboard.press('ArrowUp'); await win.waitForTimeout(300);
      await win.keyboard.press('ArrowLeft'); await win.waitForTimeout(300);
      ok(await curG() === order[i0], `↑·← → 처음 그룹 G${order[i0]} 로 돌아온다(지금 G${await curG()})`);
      ok(await win.evaluate(() => !!(document.activeElement && document.activeElement.closest('.pane-groups'))), '초점이 그룹 칸에 남는다'); }
    // 🎞 그룹 칸 합치기·삭제(v0.7.31) — 체크 → ⤒ 합치기 / 🗑 삭제(확인창)
    const cnt = () => win.evaluate(() => ({ g: document.querySelectorAll('[data-testid="group-item"]').length, c: document.querySelectorAll('main.pane2 .sent[data-ln]').length }));
    const before = await cnt();
    ok(await win.locator('[data-testid="group-merge"]').isDisabled() && await win.locator('[data-testid="group-del"]').isDisabled(), '체크 전엔 합치기·삭제가 꺼져 있다');
    await win.keyboard.press('Escape'); await win.waitForTimeout(200);   // 앞서 고른 클립을 푼다(체크는 지금 선택에 더해진다)
    await win.locator('[data-testid="group-chk"][data-g="10"]').check(); await win.locator('[data-testid="group-chk"][data-g="11"]').check();
    { const pk = await win.evaluate(() => ({ picked: [...document.querySelectorAll('main.pane2 .sent.picked')].length, g10: document.querySelectorAll('.cut[data-g="10"] .sent[data-ln]').length + document.querySelectorAll('.cut[data-g="11"] .sent[data-ln]').length, tb: !!document.querySelector('[data-testid="clip-tb"]') }));
      ok(pk.picked === pk.g10 && pk.g10 > 0, `그룹 체크 = 그 그룹 클립이 모두 골라진다(${pk.picked}/${pk.g10}개)`); }
    await win.locator('[data-testid="group-merge"]').click();
    await win.waitForFunction((n) => document.querySelectorAll('[data-testid="group-item"]').length === n - 1, before.g, { timeout: 8000 }).catch(() => {});
    const afterM = await cnt();
    ok(afterM.g === before.g - 1 && afterM.c === before.c, `G10·G11 체크 → 합치기: 그룹 ${before.g}→${afterM.g} · 클립 ${before.c}→${afterM.c}(그대로)`);
    ok(await win.locator('[data-testid="group-chk"]:checked').count() === 0, '합친 뒤 체크가 풀린다');
    await win.locator('[data-testid="group-chk"][data-g="20"]').check();
    const nG20 = await win.evaluate(() => document.querySelectorAll('.cut[data-g="20"] .sent[data-ln]').length);
    win.once('dialog', (d) => d.accept());
    await win.locator('[data-testid="group-del"]').click();
    await win.waitForFunction((n) => document.querySelectorAll('[data-testid="group-item"]').length === n - 1, afterM.g, { timeout: 8000 }).catch(() => {});
    const afterD = await cnt();
    ok(afterD.g === afterM.g - 1 && afterD.c === afterM.c - nG20, `G20 체크 → 삭제: 그룹 ${afterM.g}→${afterD.g} · 클립 ${afterM.c}→${afterD.c}(−${nG20})`);
    await win.locator('[data-testid="group-all"]').check();
    ok(await win.locator('[data-testid="group-chk"]:checked').count() === afterD.g, '전체 선택 = 모든 그룹 체크');
    await win.locator('[data-testid="group-all"]').uncheck();
    // ☑ 클립 번호 밑 체크박스(v0.7.32) — 누르면 그 클립이 선택에 더해지고, 한 번 더 누르면 빠진다
    await win.keyboard.press('Escape'); await win.waitForTimeout(200);
    const chk = (n) => win.locator('.sent[data-ln="' + n + '"] [data-testid="clip-chk"]').first();
    await chk(40).scrollIntoViewIfNeeded(); await chk(40).check(); await chk(42).check(); await win.waitForTimeout(300);
    let cs = await state(); ok(cs.picked.length === 2 && cs.picked.includes(40) && cs.picked.includes(42), `체크박스 2개 → 클립 40·42 선택 — ${JSON.stringify(cs)}`);
    ok(await chk(40).isChecked() && !(await chk(41).isChecked()), '체크 표시는 고른 클립만');
    await chk(40).uncheck(); await win.waitForTimeout(300);
    cs = await state(); ok(cs.picked.length === 1 && cs.picked[0] === 42, `체크 해제 → 40 빠짐 — ${JSON.stringify(cs)}`);
    ok(await win.evaluate(() => { const e = document.querySelector('.sent[data-ln="42"] .clip-no-n'); return !!e && e.textContent === '42'; }), '번호 글자는 그대로(체크박스가 번호를 지우지 않는다)');
    // 🔲 그룹의 첫 클립을 고르면 막대가 그룹 번호·제목·단추를 가리지 않는다(v0.7.33)
    await win.keyboard.press('Escape'); await win.waitForTimeout(200);
    const firstOf = await win.evaluate(() => { const c = [...document.querySelectorAll('.cut[data-g]')][8]; const f = c && c.querySelector('.sent[data-ln]'); return f ? { g: c.dataset.g, ln: Number(f.dataset.ln) } : null; });
    await win.evaluate((ln) => { const e = document.querySelector('.sent[data-ln="' + ln + '"]'); if (e) e.scrollIntoView({ block: 'center' }); }, firstOf.ln);
    await win.waitForTimeout(300);
    await win.locator('.sent[data-ln="' + firstOf.ln + '"] .clip-no-n').click(); await win.waitForTimeout(500);
    const ov = await win.evaluate((g) => { const tb = document.querySelector('[data-testid="clip-tb"]'); const cut = document.querySelector('.cut[data-g="' + g + '"]'); if (!tb || !cut) return null; const t = tb.getBoundingClientRect(); const heads = [...cut.querySelectorAll('button, .glabel, .gno, .gtitle')].filter((b) => !b.closest('.sents') && b.offsetParent !== null).map((b) => b.getBoundingClientRect()); const hit = heads.filter((r) => !(r.right < t.left || r.left > t.right || r.bottom < t.top || r.top > t.bottom)).length; return { hit, heads: heads.length, tbTop: Math.round(t.top) }; }, firstOf.g);
    ok(ov && ov.heads > 0 && ov.hit === 0, `그룹 첫 클립(${firstOf.ln}) 선택 → 막대가 그룹 머리(번호·제목·단추 ${ov && ov.heads}개)를 가리지 않는다 — ${JSON.stringify(ov)}`);
    ok(errs.length === 0, `화면 오류 0건 ${errs.slice(0, 2).join(' | ')}`);
  } finally {
    try { await win.evaluate(async (n) => { await window.api.removePreset({ name: n }); }, chan); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 클립 막대 스크롤 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 오류:', e); process.exit(1); });
