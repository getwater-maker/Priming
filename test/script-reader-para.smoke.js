'use strict';
/**
 * node test/script-reader-para.smoke.js — 📄 대본 보기 v0.8.9 실제 앱 E2E
 *   ① 문단 = 대본(.md)의 빈 줄 문단 — 그룹을 나눠도(✂ 그룹 나누기 = 도입부 영상 맞춤과 같은 모양) 한 문단으로 이어 보이고,
 *      이어진 두 번째 조각을 고쳐도 .md 의 그 문장만 바뀐다 ② 🎬 도입부만 ③ 🖨 바로 인쇄(인쇄 창은 가짜) ④ 📘 작성 기준 창.
 * ⚠ 사용자 대본은 건드리지 않는다 — 임시 .md, 끝나면 지운다. 진짜 프린터·인쇄 창은 쓰지 않는다(global.__readerPrintTest).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TAG = `__대본문단테스트_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = [
  '# 문단 테스트',
  '',
  '## 도입부',
  '### 장면 하나',
  '> 🖼️ 이미지: a room',
  '어머님이 식탁 위에 봉투를 내려놓으십니다.',
  '퇴직하고 처음 맞는 겨울이었습니다.',
  '아버님이 고개를 갸웃하십니다.',
  '',
  '오늘은 그 이유를 짚어 보겠습니다.',
  '',
  '## 1장. 본론',
  '### 장면 둘',
  '> 🖼️ 이미지: a bus stop',
  '본론 첫 문장입니다. 본론 둘째 문장입니다.',
  '',
].join('\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const cleanup = () => { for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch (_) {} } };

(async () => {
  cleanup();
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const errs = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sblk', { timeout: 20000 });

    // ✂ 도입부 그룹을 「퇴직하고…」 뒤에서 나눈다 — 대본 문단은 그대로(.md 불변)
    const d0 = await win.evaluate(() => window.api.getDto ? window.api.getDto() : null);
    const before = fs.readFileSync(MD, 'utf8');
    const s1 = '퇴직하고 처음 맞는 겨울이었습니다.';
    const r = await win.evaluate((t) => window.api.splitGroupAt({ shortsNum: 1, at: { groupNum: 1, sentIdx: 1, lines: [{ from: 0, to: t.length }], after: 0 } }), s1);
    ok(r && r.ok !== false, '(준비) 도입부 그룹을 두 문장 뒤에서 나눴다' + (r && r.error ? ' — ' + r.error : ''));
    ok(fs.readFileSync(MD, 'utf8') === before, '(준비) 문장 사이 나누기는 .md 를 바꾸지 않는다');
    void d0;
    // 화면 DTO 를 새로 받게 같은 대본을 다시 연다 — 작업본 이어받기(재파싱 없음) 경로에서도 대본 문단을 싣는지까지 본다
    await win.waitForTimeout(800);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForTimeout(2500);

    await require('./_menu')(win, 'caption');
    await win.click('[data-testid="reader-open"]');
    await win.waitForSelector('[data-testid="script-reader"]', { timeout: 5000 });
    const R = win.locator('[data-testid="script-reader"]');
    const doc = R.locator('[data-testid="reader-doc"]');
    const lay = await doc.evaluate((root) => {
      const ps = [...root.querySelectorAll('p[data-key]')];
      return ps.map((p) => ({ g: p.dataset.g, t: p.textContent, inline: getComputedStyle(p).display === 'inline', run: !!p.closest('.rd-pg'), top: Math.round(p.getClientRects()[0].top), lastTop: Math.round(p.getClientRects()[p.getClientRects().length - 1].top), lh: parseFloat(getComputedStyle(p).lineHeight) }));
    });
    ok(lay.length >= 4 && lay[0].g !== lay[1].g, `도입부 첫 문단이 그룹 둘로 나뉘어 있다 (${lay.map((x) => 'G' + x.g).join(' ')})`);
    ok(lay[0].inline && lay[1].inline && lay[0].run && lay[1].run, '같은 대본 문단의 두 조각 = 한 문단 안에 이어 쓴다(inline)');
    ok(lay[1].top - lay[0].lastTop <= lay[0].lh + 1, `두 조각 사이에 문단 간격이 없다(같은 줄이거나 바로 다음 줄 · 차이 ${lay[1].top - lay[0].lastTop}px ≤ 줄 높이 ${lay[0].lh}px)`);
    ok(!lay[2].inline && /오늘은/.test(lay[2].t), '빈 줄 뒤 「오늘은…」은 새 문단');
    ok(!/  /.test(await doc.evaluate((root) => root.querySelector('.rd-pg').textContent)), '조각 사이 공백은 하나');
    // 머리 글자 수 — 「공백 포함」 표기
    ok(/\/ [\d,]+ 자 \(공백 포함\)/.test(await R.locator('[data-cc]').innerText()), '제목 옆 「/ n 자 (공백 포함)」');

    // ✏ 이어진 두 번째 조각을 고친다 → .md 의 그 문장만 바뀐다
    await doc.evaluate((root) => {
      const p = root.querySelectorAll('p[data-key]')[1];
      const t = [...p.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.includes('갸웃'));
      t.nodeValue = t.nodeValue.replace('갸웃', '끄덕'); root.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await win.waitForTimeout(2200);
    const md1 = fs.readFileSync(MD, 'utf8');
    ok(/^아버님이 고개를 끄덕하십니다\.$/m.test(md1) && /^퇴직하고 처음 맞는 겨울이었습니다\.$/m.test(md1) && md1.split('\n').length === before.split('\n').length, '이어진 조각을 고치면 .md 의 그 문장만 바뀐다(줄·문단 그대로)');
    const lay2 = await doc.evaluate((root) => [...root.querySelectorAll('p[data-key]')].slice(0, 2).map((p) => getComputedStyle(p).display));
    ok(lay2.every((d) => d === 'inline'), '고친 뒤에도 한 문단으로 이어진다');

    // 🎬 도입부만
    await R.locator('[data-testid="reader-intro"] input').check();
    await win.waitForTimeout(500);
    const ti = await R.innerText();
    ok(/어머님이/.test(ti) && !/본론 첫 문장/.test(ti) && !/1장\. 본론/.test(ti), '도입부만 — 본론은 안 나온다');
    ok(/\/ 도입부 [\d,]+ 자 \(공백 포함\)/.test(await R.locator('[data-cc]').innerText()), '도입부만 — 제목 옆 글자 수도 도입부');

    // 🖨 바로 인쇄 — 인쇄 창은 가짜로 받아 옵션·내용만 본다
    await app.evaluate(() => { global.__readerPrintTest = (opts, bw) => { const rq = (m) => process.getBuiltinModule(m); let text = ''; try { text = rq('fs').readFileSync(rq('url').fileURLToPath(bw.webContents.getURL()), 'utf8'); } catch (e) { text = 'ERR ' + e.message; } global.__printed = { opts, text }; return { ok: true }; }; });   // 숨은 창은 JS 꺼짐 — 띄운 A4 HTML 파일을 읽는다
    await R.locator('select').first().selectOption('4');
    await R.locator('[data-testid="reader-print"]').click();
    await win.waitForTimeout(1500);
    const pr = await app.evaluate(() => global.__printed || null);
    ok(pr && pr.opts.silent === false && pr.opts.pagesPerSheet === 4 && pr.opts.pageSize === 'A4', `🖨 인쇄 창 옵션 — 윈도우 인쇄 창 · A4 · 한 장에 4쪽 (${pr && JSON.stringify(pr.opts)})`);
    ok(pr && /어머님이/.test(pr.text || '') && !/본론 첫 문장/.test(pr.text || ''), '🖨 인쇄 내용 = 화면과 같은 블록(도입부만)' + (pr ? '' : ''));
    ok(/프린터로 보냈습니다/.test(await R.locator('[data-testid="reader-msg"]').innerText()), '인쇄 뒤 안내');
    await app.evaluate(() => { delete global.__readerPrintTest; });
    await R.locator('button:has-text("닫기")').click();
    await win.waitForTimeout(300);

    // 📘 작성 기준 — 대본 보기 바로 옆 · 내용과 파일 위치
    await require('./_menu')(win, 'help');
    await win.click('[data-testid="guide-open-btn"]');
    await win.waitForSelector('[data-testid="guide-body"]', { timeout: 5000 });
    const gp = await win.locator('[data-testid="guide-path"]').innerText();
    ok(/docs[\\/]+대본-작성-가이드\.md/.test(gp), `📘 파일 위치가 보인다 (${gp.replace(/\s+/g, ' ').slice(0, 120)})`);
    const gb = await win.locator('[data-testid="guide-body"]').innerText();
    ok(/대본 작성 기준/.test(gb) && /최종 체크리스트/.test(gb) && /정보 카드/.test(gb), '📘 가이드 내용이 보인다');
    ok(await win.locator('[data-testid="guide-body"] table').count() > 0 && await win.locator('[data-testid="guide-body"] pre').count() > 0, '표·예시 칸이 그려진다');
    const oldClip = await app.evaluate(({ clipboard }) => clipboard.readText());   // 로이 클립보드는 되돌려 둔다
    await win.click('[data-testid="guide-copy"]');
    await win.waitForTimeout(300);
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), oldClip);
    ok(/대본-작성-가이드\.md$/.test(clip) && fs.existsSync(clip), '📋 경로 복사 = 실제 있는 파일 경로');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="script-guide"]').count() === 0, 'Esc 로 닫힌다');
    ok(!errs.length, '화면 오류 없음' + (errs.length ? ' — ' + errs.join(' | ') : ''));
  } catch (e) {
    fail++; console.log('  ✗ 예외: ' + (e && e.stack || e));
  } finally {
    try { await app.close(); } catch (_) {}
    cleanup();
  }
  console.log(`\n${fail ? '❌' : '✅'} 대본 보기 문단·도입부·인쇄·작성기준 E2E ${pass}/${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})();
