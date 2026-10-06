'use strict';
/**
 * node test/book-ebook-preview.smoke.js — R22 미리보기 [종이책 | 전자책] 전환 + 전자책 사전 점검(E2E · 실제 ePub)
 *   · 전환 단추 · 「문서 n / N」 · spine 순서(표지 → … → 판권) · 점검 목록
 *   · 완전한 원고: 표지·판권 위치·ISBN·발행일·필수 7항목 모두 ✅
 *   · 판별력: 판권 정보(ISBN·발행일·주소…)가 빠진 원고에서는 ❌ 「판권에 ISBN 없음」이 떠야 한다(수정 전 결함을 잡는 점검)
 */
const { _electron: electron } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'output', '_book-ebook-ui');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'c.jpg'), Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'));
const BODY = `
## 제1회 시작

본문 문단입니다.[^1] 한 번 더.

[^1]: 각주 본문입니다.

## [판권]

* 번역·기획: 시험
`;
const FULL = `# 전자책 시험
> 저자: 갑
> 옮긴이: 을
> 발행인: 병
> 출판사: 주식회사 시험
> 출판등록: 2014.07.15.(제2014-16호)
> 주소: 서울시 어딘가 1
> 전화: 1670-0000
> 이메일: a@b.kr
> 발행일: 발행일 2026-10-06
> 전자책ISBN: 979-11-12-31221-1
> 전자책표지: c.jpg
> 판권위치: 앞
${BODY}`;
const THIN = `# 얇은 원고
> 저자: 갑
> 출판사: 주식회사 시험
> 전자책표지: c.jpg
${BODY}`;
const F1 = path.join(OUT, 'full.md'), F2 = path.join(OUT, 'thin.md');
fs.writeFileSync(F1, FULL, 'utf8'); fs.writeFileSync(F2, THIN, 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    const open = async (p) => {
      const r = await win.evaluate((x) => window.api.openBookPath({ scriptPath: x }), p);
      if (!r || !r.dto || r.dto.kind !== 'book') throw new Error('openBookPath 실패');
    };
    await open(F1);
    await win.click('.modetoggle button:has-text("📖 출판")');
    await win.waitForSelector('.bkwrap', { timeout: 10000 });
    ok(await win.locator('[data-testid=bk-view-paper]').count() === 1 && await win.locator('[data-testid=bk-view-ebook]').count() === 1, '[종이책 | 전자책] 전환 단추');
    ok(await win.locator('[data-testid=bk-ebook]').count() === 0, '처음에는 종이책 화면(전자책 패널 없음)');

    await win.click('[data-testid=bk-view-ebook]');
    await win.waitForSelector('[data-testid=bk-eb-checks]', { timeout: 120000 });
    const pos = await win.locator('[data-testid=bk-eb-pos]').innerText();
    ok(/문서 1 \/ \d+/.test(pos), '문서 n / N 표시 — ' + pos);
    const lv = async (id) => win.locator('[data-testid=bk-eb-chk-' + id + ']').getAttribute('data-level');
    for (const id of ['cover', 'colpos', 'isbn', 'date', 'req', 'copyright', 'fn', 'ver']) ok((await lv(id)) === 'ok', `점검 ${id} ✅`);
    ok(/표지 이미지.*c\.jpg/.test(await win.locator('[data-testid=bk-eb-chk-cover]').innerText()), '1쪽 표지 출처(파일 이름) 표시');
    // 판권위치: 앞 → 2번째 문서가 판권
    await win.locator('[data-testid=bk-ebook] .bkbar button[title="다음 문서"]').click();
    await win.waitForFunction(() => /문서 2 \//.test(document.querySelector('[data-testid=bk-eb-pos]').textContent), null, { timeout: 15000 });
    const f = win.frameLocator('[data-testid=bk-eb-frame]');
    ok(/979-11-12-31221-1/.test(await f.locator('body').innerText()), '2번째 문서(판권)에 전자책 ISBN 이 보인다');
    // 종이책으로 돌아가기
    await win.click('[data-testid=bk-view-paper]');
    ok(await win.locator('[data-testid=bk-ebook]').count() === 0, '종이책으로 되돌아온다');

    // ── 판별력: 판권 정보가 빠진 원고 ──
    await open(F2);
    await win.click('[data-testid=bk-view-ebook]');
    await win.waitForFunction(() => { const e = document.querySelector('[data-testid=bk-eb-chk-isbn]'); return e && e.getAttribute('data-level') === 'err'; }, null, { timeout: 120000 }).catch(() => {});
    ok((await lv('isbn')) === 'err' && /ISBN 없음/.test(await win.locator('[data-testid=bk-eb-chk-isbn]').innerText()), '판권에 ISBN 이 없으면 ❌ 「판권에 ISBN 없음」');
    ok((await lv('date')) === 'err', '판권에 발행일이 없으면 ❌');
    ok((await lv('req')) === 'err' && /빠짐/.test(await win.locator('[data-testid=bk-eb-chk-req]').innerText()), '필수 항목이 빠지면 ❌ + 빠진 항목 이름');
    ok((await lv('colpos')) === 'ok', '판권이 마지막 쪽이면 위치는 ✅');
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} book-ebook-preview — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
