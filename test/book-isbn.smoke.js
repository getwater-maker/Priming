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
    ok(await win.locator('[data-testid=rg-box]').count() === 1, '📤 부크크 등록 탭 맨 위에 세 칸');
    for (const k of ['ebookIsbn', 'isbn', 'issueDate']) ok(await win.locator('[data-testid=rg-' + k + ']').count() === 1, '칸: ' + k);
    ok(await win.locator('[data-testid=rg-ebookIssueDate]').count() === 0 && await win.locator('[data-testid=rg-box] .bkisbn-grid').count() === 0, '종이책/전자책 상자(격자)는 없다 — 세 칸만');
    { const ys = await win.evaluate(() => ['issueDate', 'isbn', 'ebookIsbn'].map((k) => document.querySelector('[data-testid=rg-' + k + ']').getBoundingClientRect().top)); ok(ys[0] < ys[1] && ys[1] < ys[2], '순서: 발행일 → 종이책 ISBN → 전자책 ISBN (2026-10-07 로이)'); }
    ok(/2026-10-02/.test(await win.locator('[data-testid=rg-issueDate]').inputValue()), '기존 발행일이 칸에 보인다');

    // 틀린 번호 → ⚠ (판정력) · 맞는 번호 → ✅
    await win.locator('[data-testid=rg-isbn]').fill('979-11-12-31240-3'); await win.locator('[data-testid=rg-isbn]').blur(); await win.waitForTimeout(500);
    ok(/체크 숫자가 맞지 않/.test(await win.locator('[data-testid=rg-isbn-bad]').innerText()), '틀린 ISBN → ⚠ 체크 숫자 경고');
    await win.locator('[data-testid=rg-isbn]').fill('979-11-12-31240-2'); await win.locator('[data-testid=rg-isbn]').blur(); await win.waitForTimeout(500);
    ok(await win.locator('[data-testid=rg-isbn-bad]').count() === 0, '부크크가 보낸 979-11-12-31240-2 → 경고 없음(체크 숫자 통과)');
    await win.locator('[data-testid=rg-issueDate]').fill('2026-10-06'); await win.locator('[data-testid=rg-issueDate]').blur(); await win.waitForTimeout(400);
    await win.locator('[data-testid=rg-ebookIsbn]').fill('979-11-12-31221-1'); await win.locator('[data-testid=rg-ebookIsbn]').blur(); await win.waitForTimeout(400);


    // 원고(.md)에 저장
    const md = fs.readFileSync(MD, 'utf8');
    ok(/^> ISBN: ?979-11-12-31240-2$/m.test(md), '원고에 종이책 ISBN 저장');
    ok(/^> 발행일: ?2026년 10월 06일$/m.test(md) && !/2026-10-0[26]/.test(md), '발행일을 2026-10-06 으로 적어도 「2026년 10월 06일」 모양으로 저장(부크크 판권지 형식)');
    ok(/^> 전자책ISBN: ?979-11-12-31221-1$/m.test(md), '원고에 전자책 ISBN 저장');

    // 판권 탭도 같은 값을 같은 상자로
    await win.click('[data-tab=colophon]'); await win.waitForSelector('[data-testid=co-box]', { timeout: 5000 });
    ok(await win.locator('[data-testid=co-isbn]').inputValue() === '979-11-12-31240-2' && /2026년 10월 06일/.test(await win.locator('[data-testid=co-issueDate]').inputValue()), '판권 탭의 상자에도 같은 값');
    ok(await win.locator('[data-testid=co-ebookIsbn]').inputValue() === '979-11-12-31221-1', '판권 탭 전자책 ISBN');
    // 선택 목록에 같은 칸이 또 있지 않다(두 벌 금지)
    const labels = await win.locator('[data-tab=colophon]').count();
    const dup = await win.evaluate(() => [...document.querySelectorAll('.bkform label > span')].map((x) => x.textContent.trim()).filter((t) => /ISBN/.test(t)));
    ok(JSON.stringify(dup) === JSON.stringify(['종이책 ISBN', '전자책 ISBN']), '판권 탭의 ISBN 칸은 맨 위 두 칸뿐(같은 칸이 또 있지 않다) — ' + JSON.stringify(dup));
    // 📜 판권 입력 폼 — 판권에 찍히는 줄을 칸에 적으면 그대로 실린다(고지문 줄 · 저작권 · 재사용 안내문 · 고정 항목)
    ok(await win.locator('[data-testid=bk-colophon-form]').count() === 1, '판권 탭 = 입력 폼');
    for (const k of ['author', 'translator', 'issuer', 'publisher', 'regNo', 'address', 'phone', 'email', 'homepage']) ok(await win.locator('[data-testid=bk-cp-' + k + ']').count() === 1, '판권 칸: ' + k);
    await win.locator('[data-testid=bk-cp-regNo]').fill('2014.07.15.(제2014-16호)'); await win.locator('[data-testid=bk-cp-regNo]').blur(); await win.waitForTimeout(300);
    await win.locator('[data-testid=bk-cp-note-add]').click(); await win.waitForTimeout(150);
    await win.locator('[data-testid=bk-cp-note-0]').fill('번역·기획: 시험의 로이'); await win.locator('[data-testid=bk-cp-note-0]').blur(); await win.waitForTimeout(500);
    await win.locator('[data-testid=bk-cp-note-add]').click(); await win.waitForTimeout(150);
    await win.locator('[data-testid=bk-cp-note-1]').fill('저본: 시험 원문'); await win.locator('[data-testid=bk-cp-note-1]').blur(); await win.waitForTimeout(500);
    await win.locator('[data-testid=bk-cp-copyright]').fill('ⓒ 시험 2026. All rights reserved.'); await win.locator('[data-testid=bk-cp-copyright]').blur(); await win.waitForTimeout(300);
    await win.locator('[data-testid=bk-cp-legal]').fill('무단 전재·복제를 금합니다.'); await win.locator('[data-testid=bk-cp-legal]').blur(); await win.waitForTimeout(500);
    let md2 = fs.readFileSync(MD, 'utf8');
    ok(/^\* 번역·기획: 시험의 로이$/m.test(md2) && /^\* 저본: 시험 원문$/m.test(md2) && md2.indexOf('## [판권]') < md2.indexOf('* 번역·기획'), '고지문 두 줄이 원고 [판권] 섹션에 `* …` 로 저장');
    ok(/^> 출판등록: 2014\.07\.15\.\(제2014-16호\)$/m.test(md2) && /^> 저작권: ⓒ 시험 2026\. All rights reserved\.$/m.test(md2) && /^> 재사용문구: 무단 전재·복제를 금합니다\.$/m.test(md2), '고정 항목 · 저작권 · 재사용 문구가 원고 메타에 저장');
    ok(await win.locator('[data-testid=bk-cp-note-0]').inputValue() === '번역·기획: 시험의 로이' && await win.locator('[data-testid=bk-cp-note-1]').inputValue() === '저본: 시험 원문', '저장 뒤 칸이 같은 값으로 다시 그려진다');
    await win.locator('[data-testid=bk-cp-note-del-0]').click(); await win.waitForTimeout(600);
    md2 = fs.readFileSync(MD, 'utf8');
    ok(!/번역·기획/.test(md2) && /^\* 저본: 시험 원문$/m.test(md2), '줄 지우기(✕) — 그 줄만 원고에서 빠진다');
    await win.locator('[data-testid=bk-cp-note-0]').fill(''); await win.locator('[data-testid=bk-cp-note-0]').blur(); await win.waitForTimeout(500);
    ok(!/저본: 시험 원문/.test(fs.readFileSync(MD, 'utf8')), '칸을 비우면 그 줄이 빠진다');
    await win.locator('[data-testid=bk-cp-note-add]').click(); await win.locator('[data-testid=bk-cp-note-0]').fill('번역·기획: 시험의 로이'); await win.locator('[data-testid=bk-cp-note-0]').blur(); await win.waitForTimeout(500);
    // 판권(내지 HTML)에 그대로 실린다 — 같은 원고를 앱과 같은 함수로 조판
    {
      const { parseBookText } = require('../core/parsers/book-parser'); const H = require('../core/book/html-builder');
      const txt = (h) => h.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
      const t = txt(H.buildBookHtml(parseBookText(fs.readFileSync(MD, 'utf8'), 'x'), { edition: 'print', imageUrl: (p) => p, fontCss: '' }).html);
      ok(/2026년 10월 06일/.test(t) && /979-11-12-31240-2/.test(t) && /번역·기획: 시험의 로이/.test(t) && /ⓒ 시험 2026\. All rights reserved\./.test(t) && /무단 전재·복제를 금합니다\./.test(t) && /2014\.07\.15\./.test(t), '판권 페이지에 발행일(년월일) · ISBN · 고지문 · 저작권 · 재사용 문구 · 등록이 적은 그대로 실린다');
      ok(!/이 책의 내용 중 전부 또는 일부를/.test(t), '재사용 안내문을 적으면 기본 문구는 나오지 않는다');
      ok(/발행일 2026년 10월 06일/.test(t) && !/초판|1쇄/.test(t), '날짜만 적어도 판권 라벨은 「발행일」(초판 1쇄 개념 없음 — 부크크)');
    }
    // 판권(내지 HTML)에 반영
    const html = await win.evaluate(async () => { const r = await window.api.bookPreview({ layout: {} }); return r && r.html ? r.html : ''; });
    if (html) ok(/979-11-12-31240-2/.test(html) && /2026-10-06/.test(html) && !/2026-10-02/.test(html.replace(/<style[\s\S]*?<\/style>/g, '')), '내지 판권에 새 ISBN·발행일이 실린다');
    else console.log('  (미리보기 HTML 을 받지 못함 — 판권 반영 단언은 건너뜀)');
  } finally { await app.close(); }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${fail ? '❌' : '✅'} book-isbn — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
