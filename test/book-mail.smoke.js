'use strict';
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
      let job = null;
      const original = { id: 'test', subject: '제1권 판권 수정 요청', from: 'editor@example.test', text: '발행일 2026-10-16\nISBN 979-11-12-31240-2' };
      for (const n of ['status', 'search', 'link', 'prepare', 'send', 'auto']) ipcMain.removeHandler('book-mail-' + n);
      ipcMain.handle('book-mail-auto', () => ({ results: [{ edition: 'print', label: '종이책', state: 'sent', isbn: '9791112325167', issueDate: '2026년 10월 16일', note: '발송 완료' }, { edition: 'ebook', label: '전자책', state: 'stop', note: '추가 요청이 있습니다: 앞표지 로고 — 아래 수동 단계로 진행하세요' }] }));
      ipcMain.handle('book-mail-status', () => ({ configured: true, connected: true, email: 'getwater@gmail.com', job }));
      ipcMain.handle('book-mail-search', () => ({ messages: [original] }));
      ipcMain.handle('book-mail-link', () => ({ job: job = { original, values: { isbn: '9791112312402', issueDate: '2026년 10월 16일' }, state: 'linked' } }));
      ipcMain.handle('book-mail-prepare', () => ({ job: job = { ...job, state: 'draft', draftId: 'fake', to: 'editor@example.test', body: '수정본입니다.', files: [{ name: '제1권_내지.pdf', bytes: 10 }] } }));
      ipcMain.handle('book-mail-send', () => ({ job: job = { ...job, state: 'sent' } }));
    });
    await win.click('.modetoggle button:has-text("📖 출판")'); await win.click('[data-tab=bookk]');
    const panel = win.locator('[data-testid=bk-mail]'); await panel.locator('summary').first().click();
    await panel.locator('[data-testid=bk-mail-auto]').click();
    const autoRes = panel.locator('[data-testid=bk-mail-auto-result]'); await autoRes.waitFor();
    assert.match(await autoRes.innerText(), /종이책 ISBN 9791112325167 · 2026년 10월 16일 — 발송 완료/);
    assert.match(await autoRes.innerText(), /⚠ 전자책 추가 요청/);
    console.log('✓ 📬 자동 처리 버튼 → 판별 결과 표시');
    await panel.getByText('수동으로 진행', { exact: true }).click();
    await panel.getByRole('button', { name: '심사 메일 찾기', exact: true }).click();
    await panel.getByRole('button', { name: /제1권 판권 수정 요청/ }).click();
    assert.equal(await panel.getByLabel('재제출 ISBN', { exact: true }).inputValue(), '9791112312402');
    assert.equal(await panel.locator('[data-testid=bk-mail-prepare]').isEnabled(), false);
    await panel.getByLabel('이 메일의 책·권·종이책/전자책과 추가 수정 요청을 확인했습니다.', { exact: true }).check();
    await panel.locator('[data-testid=bk-mail-prepare]').click();
    await panel.locator('[data-testid=bk-mail-review]').waitFor();
    assert.match(await panel.locator('[data-testid=bk-mail-review]').innerText(), /editor@example.test/);
    assert.match(await panel.locator('[data-testid=bk-mail-review]').innerText(), /제1권_내지.pdf/);
    await panel.locator('[data-testid=bk-mail-send]').click();
    await win.waitForFunction(() => document.querySelector('[data-testid=bk-mail-send]').disabled);
    assert.match(await panel.innerText(), /발송 완료/);
    await win.screenshot({ path: path.join(TMP, 'mail-review.png') });
    console.log('✓ 메일 연결 → 값 확인 → 요청 파일 선택 → 초안 확인 → 발송 완료 UI (가짜 IPC, 실제 발송 없음)');
    console.log('SCREENSHOT=' + path.join(TMP, 'mail-review.png'));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
