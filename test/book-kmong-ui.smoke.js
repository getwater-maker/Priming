'use strict';
// node test/book-kmong-ui.smoke.js — 🛒 출판 「등록·유통」 탭의 크몽판 카드(2026-11-11): 버튼이 실제로 눌린다 → 크몽판 PDF 생성 → 점검 결과가 카드에 · 다시 점검
//   E2E 는 renderer/dist 를 읽는다(화면 코드를 고치면 npm run build:renderer 뒤에) · PM_UI_SMOKE=1(shell.openPath 막힘)
const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'output', '_book-kmong-ui');
const SAMPLE = path.join(DIR, 'kmong-ui-book.md');
const para = '조선의 밤은 길고 깊었다. 등불 하나에 의지해 역사를 기록하던 사람들이 있었다. '.repeat(30);
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(SAMPLE, `# 크몽시험 책\n> 저자: 홍길동\n> 출판사: 부크크\n> ISBN: 979-11-0000-000-1\n> 판형: A5\n\n## [목차]\n\n${Array.from({ length: 24 }, (_, i) => `## ${i + 1}장. 장 ${i + 1}\n${para}\n\n${para}\n`).join('\n')}\n## [판권]\n`, 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let made = '';
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    const r = await win.evaluate((p) => window.api.openBookPath({ scriptPath: p }), SAMPLE);
    if (!r || !r.dto || r.dto.kind !== 'book') throw new Error('openBookPath 실패');
    await win.click('.modetoggle button:has-text("📖 출판")');
    await win.waitForSelector('.bkwrap', { timeout: 10000 });
    await win.click('[data-tab=bookk]');
    await win.waitForSelector('[data-testid=bk-kmong-build]', { timeout: 10000 });

    // [1] 카드 버튼이 실제로 눌리는 자리에 있다(가려지지 않음 · 글자 잘림 없음)
    const hit = await win.evaluate(() => ['bk-kmong-build', 'bk-kmong-check'].map((id) => {
      const b = document.querySelector(`[data-testid=${id}]`); b.scrollIntoView({ block: 'center' });
      const rc = b.getBoundingClientRect(); const at = document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2);
      return { id, hit: !!at && (at === b || b.contains(at)), sw: b.scrollWidth, cw: b.clientWidth };
    }));
    ok(hit.every((h) => h.hit && h.sw <= h.cw + 1), '크몽판 버튼 2개가 눌린다 · 글자 잘림 없음 ' + JSON.stringify(hit));

    // [2] 만들기 → 점검 결과
    await win.click('[data-testid=bk-kmong-build]');
    await win.waitForSelector('[data-testid=bk-kmong-sum]', { timeout: 180000 });
    const sum = await win.locator('[data-testid=bk-kmong-sum]').innerText();
    ok(/점검 통과/.test(sum), '카드 요약: ' + sum);
    const items = await win.$$eval('[data-testid=bk-kmong-items] > div', (ds) => ds.map((d) => ({ st: d.getAttribute('data-st'), t: d.textContent })));
    ok(items.length >= 8 && items.some((i) => /부크크·ISBN/.test(i.t) && i.st === 'ok'), '점검표: 부크크·ISBN 글자 0개 ✅ (원고 메타에 출판사 부크크·ISBN 이 있어도)');
    ok(items.some((i) => /수정 제한/.test(i.t) && (i.st === 'manual' || i.st === 'ok')), '점검표: 수정 제한 ✋ 또는 ✅');
    const outs = await win.evaluate(() => window.api.bookOutputs());
    const k = (outs || []).find((o) => o.kind === 'kmongPdf');
    made = k ? k.path : '';
    ok(!!k && /^\[크몽\] .*_완성\.pdf$/.test(k.name), '출력 목록에 [크몽] …_완성.pdf (종류 kmongPdf) ' + (k ? k.name : ''));
    ok(!(outs || []).some((o) => /^\[크몽\]/.test(o.name) && o.kind !== 'kmongPdf'), '[크몽] 파일이 종이책·전자책 종류로 잡히지 않는다');

    // [3] 다시 점검
    await win.evaluate(() => { const s = document.querySelector('[data-testid=bk-kmong-sum]'); if (s) s.setAttribute('data-old', '1'); });
    await win.click('[data-testid=bk-kmong-check]');
    await win.waitForTimeout(3000);
    const sum2 = await win.locator('[data-testid=bk-kmong-sum]').innerText();
    ok(/점검 통과/.test(sum2), '다시 점검: ' + sum2);
    await win.screenshot({ path: path.join(DIR, 'kmong-card.png') });
  } catch (e) { fail++; console.log('  ✗ 오류: ' + e.message); }
  finally {
    await app.close().catch(() => {});
    // 시험이 만든 크몽판만 지운다(그 권의 출력 폴더 — 원고 이름 폴더)
    if (made && /kmong-ui-book/.test(made)) { try { fs.unlinkSync(made); } catch (_) {} }
  }
  console.log(`\n${fail ? '❌' : '✅'} 크몽판 화면 ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
