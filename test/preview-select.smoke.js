'use strict';
const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-select-'));
  const name = '__preview_select_' + process.pid;
  const md = path.join(dir, name + '.md');
  fs.writeFileSync(md, '# 화면 점검\n\n## 도입부\n### 〔첫 장면〕\n> 🖼️ 이미지: quiet room\n첫 번째 문장입니다. 두 번째 문장입니다.\n\n## 본론\n' + Array.from({length:30}, (_,i) => `\n### 〔장면 ${i+2}〕\n> 🖼️ 이미지: room\n次の場面で物語が続きます。\n`).join(''));
  const app = await electron.launch({ args: [path.join(__dirname, '..')], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win, folders;
  try {
    win = await app.firstWindow();
    win.setDefaultTimeout(15000);
    await win.waitForSelector('h1');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1080));
    folders = await win.evaluate(() => window.api.getAppFolders());
    await win.evaluate(async ({name, dir}) => {
      await window.api.addPreset({name});
      await window.api.savePreset({name, patch: {outputFolder: dir, outLong: dir, scriptFolder: dir}});
      localStorage.setItem('pm.clipDetail', '1');
      localStorage.removeItem('pm.pane1R.v2');
    }, {name, dir});
    await win.reload(); await win.waitForSelector('h1');
    await win.selectOption('select[title^="채널(프리셋)"]', name);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({canceled:false, filePaths:[p]}); }, md);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    const cap = win.locator('.clip-cap').first();
    await cap.waitFor();
    await cap.click();
    assert.equal(await win.locator('.clip-edit, .sblk.editing textarea').count(), 0, 'single click must not edit');
    await win.keyboard.press('Space');
    await win.waitForFunction(() => document.querySelector('[data-testid="play-btn"]')?.textContent.includes('멈춤'));
    await win.keyboard.press('Space');
    await win.waitForFunction(() => document.querySelector('[data-testid="play-btn"]')?.textContent.includes('재생'));
    await cap.dblclick();
    await win.waitForSelector('.clip-edit');
    await win.keyboard.press('Escape');
    await cap.click(); await win.keyboard.press('Enter');
    await win.waitForSelector('.clip-edit');
    await win.keyboard.press('Escape');
    await cap.click(); await win.keyboard.press('ArrowDown');
    assert.equal(await win.locator('.clip-edit').count(), 0, 'arrow selects without editing');
    assert.equal(await win.locator('.thumbgrid > .thumbcell').count(), 4);
    assert.equal(await win.locator('.thumbgrid > :first-child').getAttribute('data-testid'), 'style-preview');
    const ratio = await win.evaluate(() => {
      const b = document.querySelector('#body').getBoundingClientRect();
      const m = document.querySelector('main.pane2').getBoundingClientRect();
      return (m.left - b.left) / b.width;
    });
    assert(ratio > 0.2 && ratio < 0.65, 'responsive left ratio: ' + ratio);
    await win.click('button:has-text("서식")');
    const rows = await win.evaluate(() => ({shadow:document.querySelector('.ribbon [title="그림자"]').getBoundingClientRect().top, position:document.querySelector('.ribbon [data-testid="cf-posh"]').getBoundingClientRect().top}));
    assert(rows.position > rows.shadow + 10, 'format controls break after shadow');
    await win.click('button:has-text("이미지") >> nth=0');
    assert.equal(await win.locator('[data-testid="style-picker-btn"] img').count(),0);
    // Cache offscreen group geometry, then resize: headers and clips must still align.
    await win.evaluate(() => { const m = document.querySelector('main.pane2'); m.scrollTop = m.scrollHeight; });
    await win.waitForTimeout(150);
    const sticky = await win.evaluate(() => {
      const m=document.querySelector('main.pane2').getBoundingClientRect();
      const t=document.querySelector('.work-top').getBoundingClientRect();
      const h=document.querySelector('main.pane2 .card h2').getBoundingClientRect();
      return {main:m.top,top:t.top,bottom:t.bottom,header:h.top};
    });
    assert(Math.abs(sticky.main-sticky.top)<2,'queue stays at top: '+JSON.stringify(sticky));
    assert(sticky.header>=sticky.bottom-2,'project header below pinned controls');
    for (const width of [1920, 1366, 1200, 1920]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 1000), width);
      await win.evaluate(() => { document.querySelector('main.pane2').scrollTop = 0; });
      await win.waitForTimeout(150);
      const bounds = await win.evaluate(() => {
        document.querySelector('.clip-chips .chip').textContent = 'LongCaption'.repeat(50);
        document.querySelector('.clip-cap').textContent = 'LongCaption'.repeat(50);
        const main = document.querySelector('main.pane2');
        const card = main.querySelector('.card').getBoundingClientRect();
        return { client: main.clientWidth, scroll: main.scrollWidth, cardRight: card.right,
          clipRight: main.querySelector('.sent.clip').getBoundingClientRect().right,
          capRight: main.querySelector('.clip-cap').getBoundingClientRect().right,
          capWidth: main.querySelector('.clip-cap').clientWidth, capScroll: main.querySelector('.clip-cap').scrollWidth };
      });
      assert(bounds.scroll <= bounds.client + 1, `horizontal overflow at ${width}: ${JSON.stringify(bounds)}`);
      assert(bounds.clipRight <= bounds.cardRight, `clip outside card at ${width}`);
      assert(bounds.capRight <= bounds.cardRight, `caption outside card at ${width}: ${JSON.stringify(bounds)}`);
      assert(bounds.capScroll <= bounds.capWidth + 1, `caption overflow at ${width}: ${JSON.stringify(bounds)}`);
    }
    // User-selected plain folder, without bracketed script filename.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
    for (const n of ['A', 'B', 'C']) fs.writeFileSync(path.join(dir, n + '.png'), png);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({canceled:false, filePaths:[p]}); }, dir);
    await win.click('[data-testid="thumb-folder"]');
    await win.waitForFunction(() => document.querySelectorAll('[data-testid="thumbcell"]').length === 3);
    assert.equal((await win.evaluate(() => window.api.getAppFolders())).thumbs, dir);
    await win.screenshot({ path: path.join(os.tmpdir(), 'priming-preview-layout.png') });
    console.log('PASS: playback/editing, responsive layout, sticky controls, format rows, style picker, thumbnail folder');
  } finally {
    if (win) {
      if (folders) await win.evaluate((f) => window.api.saveAppFolders({thumbs: f.thumbs || ''}), folders).catch(() => {});
      await win.evaluate((name) => window.api.removePreset({name}), name).catch(() => {});
    }
    await app.close();
    fs.rmSync(dir, {recursive:true, force:true});
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
