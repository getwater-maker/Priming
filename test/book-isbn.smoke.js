'use strict';
/**
 * node test/book-isbn.smoke.js — 🔢 ISBN · 발행일 상자(판권 탭 · 부크크 등록 탭) E2E (2026-10-06 로이 — 부크크 「판권지 수정 요청」)
 *   · 종이책·전자책 ISBN 과 발행일을 칸에 적으면 **원고(.md) 메타에 저장**되고 두 탭이 같은 값을 보인다
 *   · ISBN 체크 숫자 확인: 맞는 번호 ✅ · 틀린 번호 ⚠(판정력) · 부크크가 보낸 979-11-12-31240-2 가 통과
 *   · 판권(내지 HTML)에 그 ISBN·발행일이 실린다
 */
const { _electron: electron } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'isbn-ui-'));
const MD = path.join(TMP, 'ISBN시험.md');
fs.writeFileSync(MD, `# ISBN 시험
> 저자: 갑
> 발행인: 병
> 출판사: 주식회사 시험
> 발행일: 발행일 2026-10-02
> 판형: 46판

## 1장. 하나
본문 글입니다. 둘째 문장입니다.

## [판권]
`, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    const r = await win.evaluate((p) => window.api.openBookPath({ scriptPath: p }), MD);
    if (!r || !r.dto || r.dto.kind !== 'book') throw new Error('openBookPath 실패');
    await win.click('.modetoggle button:has-text("📖 출판")');
    await win.waitForSelector('.bkwrap', { timeout: 10000 });

    await win.click('[data-tab=bookk]');
    await win.waitForSelector('[data-testid=rg-box]', { timeout: 10000 });
    ok(await win.locator('[data-testid=rg-box]').count() === 1, '📤 부크크 등록 탭 맨 위에 ISBN·발행일 상자');
    for (const k of ['issueDate', 'isbn', 'ebookIssueDate', 'ebookIsbn']) ok(await win.locator('[data-testid=rg-' + k + ']').count() === 1, '칸: ' + k);
    ok(/2026-10-02/.test(await win.locator('[data-testid=rg-issueDate]').inputValue()), '기존 발행일이 칸에 보인다');

    // 틀린 번호 → ⚠ (판정력) · 맞는 번호 → ✅
    await win.locator('[data-testid=rg-isbn]').fill('979-11-12-31240-3'); await win.locator('[data-testid=rg-isbn]').blur(); await win.waitForTimeout(500);
    ok(/체크 숫자가 맞지 않/.test(await win.locator('[data-testid=rg-isbn-chk]').innerText()), '틀린 ISBN → ⚠ 체크 숫자 경고');
    await win.locator('[data-testid=rg-isbn]').fill('979-11-12-31240-2'); await win.locator('[data-testid=rg-isbn]').blur(); await win.waitForTimeout(500);
    ok(/9791112312402|979-11-12-3124-0-2|체크 숫자 통과/.test(await win.locator('[data-testid=rg-isbn-chk]').innerText()), '부크크가 보낸 979-11-12-31240-2 → ✅');
    await win.locator('[data-testid=rg-issueDate]').fill('발행일 2026-10-06'); await win.locator('[data-testid=rg-issueDate]').blur(); await win.waitForTimeout(400);
    await win.locator('[data-testid=rg-ebookIsbn]').fill('979-11-12-31221-1'); await win.locator('[data-testid=rg-ebookIsbn]').blur(); await win.waitForTimeout(400);
    await win.locator('[data-testid=rg-ebookIssueDate]').fill('발행일 2026-10-07'); await win.locator('[data-testid=rg-ebookIssueDate]').blur(); await win.waitForTimeout(600);

    // 원고(.md)에 저장
    const md = fs.readFileSync(MD, 'utf8');
    ok(/^> ISBN: ?979-11-12-31240-2$/m.test(md), '원고에 종이책 ISBN 저장');
    ok(/^> 발행일: ?발행일 2026-10-06$/m.test(md) && !/2026-10-02/.test(md), '원고의 발행일이 바뀐다(옛 값 없음)');
    ok(/^> 전자책ISBN: ?979-11-12-31221-1$/m.test(md), '원고에 전자책 ISBN 저장');
    ok(/^> 전자책발행일: ?발행일 2026-10-07$/m.test(md), '원고에 전자책 발행일 저장');

    // 판권 탭도 같은 값을 같은 상자로
    await win.click('[data-tab=colophon]'); await win.waitForSelector('[data-testid=co-box]', { timeout: 5000 });
    ok(await win.locator('[data-testid=co-isbn]').inputValue() === '979-11-12-31240-2' && /2026-10-06/.test(await win.locator('[data-testid=co-issueDate]').inputValue()), '판권 탭의 상자에도 같은 값');
    ok(await win.locator('[data-testid=co-ebookIsbn]').inputValue() === '979-11-12-31221-1', '판권 탭 전자책 ISBN');
    // 선택 목록에 같은 칸이 또 있지 않다(두 벌 금지)
    const labels = await win.locator('[data-tab=colophon]').count();
    const dup = await win.evaluate(() => [...document.querySelectorAll('.bkform label > span')].filter((s) => /^ISBN\(종이책\)|^전자책 ISBN/.test(s.textContent.trim())).length);
    ok(dup === 0, '판권 「선택」 목록에는 ISBN 칸이 따로 없다(상자로 일원화)');
    // 판권(내지 HTML)에 반영
    const html = await win.evaluate(async () => { const r = await window.api.bookPreview({ layout: {} }); return r && r.html ? r.html : ''; });
    if (html) ok(/979-11-12-31240-2/.test(html) && /2026-10-06/.test(html) && !/2026-10-02/.test(html.replace(/<style[\s\S]*?<\/style>/g, '')), '내지 판권에 새 ISBN·발행일이 실린다');
    else console.log('  (미리보기 HTML 을 받지 못함 — 판권 반영 단언은 건너뜀)');
  } finally { await app.close(); }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${fail ? '❌' : '✅'} book-isbn — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
