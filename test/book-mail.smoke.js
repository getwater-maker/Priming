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
    // 📬 원고를 열기 전(출판 첫 화면)에도 회신 단추 — 누르면 main 이 메일의 책 원고를 열고, 결과는 등록·유통 탭에 이어 보인다
    await app.evaluate(({ ipcMain }, p) => {
      for (const n of ['status', 'inbox']) ipcMain.removeHandler('book-mail-' + n);
      ipcMain.handle('book-mail-status', () => ({ configured: true, connected: true, email: 'getwater@gmail.com', job: null }));
      ipcMain.handle('book-mail-inbox', async (_e, a) => {
        global.__inboxArg = a;
        const open = ipcMain._invokeHandlers.get('open-book-path');
        const o = await open({ sender: null }, { scriptPath: p });
        return { results: [{ edition: 'print', label: '메일 시험 종이책', state: 'sent', isbn: '9791112325167', issueDate: '2026년 10월 16일', note: '발송 완료 → info@bookk.co.kr (내지.pdf)', scriptPath: p }, { edition: 'none', label: '', state: 'stop', note: '「[삼국지 9]」 — 원고 폴더에서 이 책 원고를 찾지 못했습니다' },
          { edition: 'print', label: '빨간 머리 앤 종이책', state: 'stop', note: '보내지 못했습니다 — 첨부파일이 18MB를 넘습니다', manual: { threadId: 't9', subject: 's', file: p, name: '내지.pdf', mb: 19.5 } }], dto: o.dto, queue: o.queue };
      });
    }, md);
    await win.click('.modetoggle button:has-text("📖 출판")');
    const first = win.locator('[data-testid=bk-mail-inbox]'); await first.waitFor();
    assert.match(await first.innerText(), /부크크 메일 확인/);
    await first.click();
    const res0 = win.locator('[data-testid=bk-mail-auto-result]'); await res0.waitFor();
    assert.match(await res0.innerText(), /✅ 메일 시험 종이책 ISBN 9791112325167/);
    assert.match(await res0.innerText(), /찾지 못했습니다/);
    // 원고를 열기 전엔 main 이 헤더 채널을 모른다 — 단추가 헤더 채널 이름을 넘겨야 원고 폴더를 찾는다(「원고 폴더가 없습니다」 사고)
    const sentArg = await app.evaluate(() => global.__inboxArg);
    assert.ok(sentArg && typeof sentArg.presetName === 'string' && sentArg.presetName, '헤더 채널 이름이 안 넘어왔다 ' + JSON.stringify(sentArg));
    assert.equal(await win.locator('[data-testid=bk-mail-auto]').count(), 1, '원고가 열린 뒤 등록·유통 탭의 회신 칸');
    console.log('✓ 출판 첫 화면 회신 단추 → 원고 열림 → 결과가 등록·유통 탭에 이어 보임');
    // 📮 직접 보내야 하는 메일 = 팝업(원고가 열린 뒤에도) · 「확인」으로 닫으면 탭을 다시 열어도 또 뜨지 않는다
    const pop = win.locator('[data-testid=bk-mail-manual]'); await pop.waitFor();
    assert.match(await pop.innerText(), /직접 보내야 하는 메일 1통/); assert.match(await pop.innerText(), /빨간 머리 앤 종이책/); assert.match(await pop.innerText(), /19\.5MB/);
    assert.equal(await pop.getByRole('button', { name: /파일 위치 보기/ }).count(), 1);
    await pop.getByRole('button', { name: '확인' }).click();
    assert.equal(await pop.count(), 0);
    await win.click('[data-tab=log]'); await win.click('[data-tab=bookk]');
    await win.locator('[data-testid=bk-mail-auto-result]').waitFor();
    assert.equal(await win.locator('[data-testid=bk-mail-manual]').count(), 0, '탭을 다시 열었더니 팝업이 또 떴다');
    console.log('✓ 📮 직접 보내기 팝업 — 원고 열린 뒤 표시 · 한 번만');
    await app.evaluate(({ ipcMain }) => {
      for (const n of ['auto']) ipcMain.removeHandler('book-mail-' + n);
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
    // 연결 안 된 PC(회원) = 빈칸 — 판매자 Gmail 을 기본값으로 채우지 않는다(로이 2026-10-21)
    await win.click('.st-x');
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('book-mail-status'); ipcMain.handle('book-mail-status', () => ({ configured: true, connected: false, email: '', job: null })); });
    await win.click('button:has-text("⚙ 설정")');
    await win.click('.st-tabs button:has-text("👤 계정")');
    const inp = win.locator('[aria-label="출판 메일 계정"]'); await inp.waitFor();
    assert.equal(await inp.inputValue(), '', '연결 안 된 PC 에 메일 주소가 미리 채워져 있다');
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'renderer/src/BookMail.jsx'), 'utf8'), /@gmail\.com/, 'BookMail.jsx 에 판매자 메일 주소가 박혀 있다');
    console.log('✓ 연결 안 된 PC 의 출판 메일 칸 = 빈칸');
    // 연결 만료(invalid_grant) — 계정 탭에 만료 안내 + 다시 연결 칸(주소 그대로)
    await win.click('.st-x');
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('book-mail-status'); ipcMain.handle('book-mail-status', () => ({ configured: true, connected: false, expired: true, email: 'getwater@gmail.com', job: null })); });
    await win.click('button:has-text("⚙ 설정")');
    await win.click('.st-tabs button:has-text("👤 계정")');
    const exp = win.locator('[data-testid=bk-mail-expired]'); await exp.waitFor();
    assert.match(await exp.innerText(), /만료/);
    assert.equal(await win.locator('[aria-label="출판 메일 계정"]').inputValue(), 'getwater@gmail.com');
    console.log('✓ 연결 만료 → 계정 탭 만료 안내 · 다시 연결 칸');
    console.log('SCREENSHOT=' + path.join(TMP, 'mail-button.png'));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
