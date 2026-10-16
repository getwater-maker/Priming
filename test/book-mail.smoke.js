'use strict';
// node test/book-mail.smoke.js — 📖 출판 「📬 판권 수정해서 부크크에 회신」 버튼 하나 + ⚙ 설정 → 👤 계정 탭의 Gmail 연결 칸(E2E · 가짜 IPC · 실제 발송 없음)
const { _electron: electron } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const ROOT = path.resolve(__dirname, '..'), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-ui-'));
const md = path.join(TMP, '메일 시험.md'); fs.writeFileSync(md, '# 메일 시험\n> 저자: 갑\n\n## 1장\n본문\n');
(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow(); await win.waitForSelector('h1');
    await win.evaluate(p => window.api.openBookPath({ scriptPath: p }), md);
    await app.evaluate(({ ipcMain }) => {
      for (const n of ['status', 'auto']) ipcMain.removeHandler('book-mail-' + n);
      ipcMain.handle('book-mail-status', () => ({ configured: true, connected: true, email: 'getwater@gmail.com', job: null }));
      ipcMain.handle('book-mail-auto', () => ({ results: [{ edition: 'print', label: '종이책', state: 'sent', isbn: '9791112325167', issueDate: '2026년 10월 16일', note: '발송 완료 → info@bookk.co.kr (4_내지.pdf)' }, { edition: 'ebook', label: '전자책', state: 'stop', note: '추가 요청이 있습니다: 앞표지 로고 — Gmail에서 직접 회신하세요' }] }));
    });
    await win.click('.modetoggle button:has-text("📖 출판")'); await win.click('[data-tab=bookk]');
    const panel = win.locator('[data-testid=bk-mail]');
    // 버튼 하나뿐 — 옛 수동 단계(메일 찾기·ISBN 칸·초안 버튼)와 연결 입력 칸이 출판 패널에 없어야 한다
    for (const sel of ['text=심사 메일 찾기', '[aria-label="재제출 ISBN"]', '[data-testid=bk-mail-prepare]', '[aria-label="출판 메일 계정"]']) assert.equal(await panel.locator(sel).count(), 0, sel);
    await panel.locator('[data-testid=bk-mail-auto]').click();
    const res = panel.locator('[data-testid=bk-mail-auto-result]'); await res.waitFor();
    assert.match(await res.innerText(), /✅ 종이책 ISBN 9791112325167 · 2026년 10월 16일 — 발송 완료 → info@bookk\.co\.kr/);
    assert.match(await res.innerText(), /⚠ 전자책 추가 요청/);
    await win.screenshot({ path: path.join(TMP, 'mail-button.png') });
    console.log('✓ 출판 패널 = 버튼 하나 → 판별 결과 표시');
    // 📜 로그 = 위쪽 탭 — 다른 탭에선 패널 안에 로그가 없고, 로그 탭을 누르면 패널 전체가 로그
    assert.equal(await win.locator('[data-testid=bk-side] #logwrap').count(), 0, '등록 탭 아래 고정 로그가 남아 있다');
    await win.click('[data-tab=log]');
    await win.locator('[data-testid=bk-log-tab] #logwrap').waitFor();
    const lh = await win.evaluate(() => [document.querySelector('[data-testid=bk-log-tab]').getBoundingClientRect().height, document.querySelector('[data-testid=bk-side]').getBoundingClientRect().height]);
    assert.ok(lh[0] > lh[1] * 0.6, '로그 탭이 패널 높이 대부분을 쓴다 ' + lh);
    await win.click('[data-tab=bookk]');
    console.log('✓ 📜 로그 탭');
    await win.click('button:has-text("⚙ 설정")');
    await win.click('.st-tabs button:has-text("👤 계정")');
    const conn = win.locator('[data-testid=bk-mail-connect]'); await conn.waitFor();
    assert.match(await conn.innerText(), /getwater@gmail\.com · Gmail 연결됨/);
    assert.equal(await conn.getByRole('button', { name: '연결 해제' }).count(), 1);
    console.log('✓ ⚙ 설정 → 👤 계정 탭에 Gmail 연결 칸');
    console.log('SCREENSHOT=' + path.join(TMP, 'mail-button.png'));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
