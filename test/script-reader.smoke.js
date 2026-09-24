'use strict';
/**
 * node test/script-reader.smoke.js — 📄 대본 보기(읽기·고치기·A4 PDF) 실제 앱 E2E (2026-09-24)
 *   임시 대본(.md)을 열어 ④ 완성 「📄 대본 보기」 → 내용만 나오는지 · 문장을 눌러 고치면 .md 가 바뀌는지 ·
 *   A4 PDF(한 장에 1쪽/4쪽)가 실제로 만들어지는지(쪽수·용지 크기)를 본다.
 * ⚠ 사용자 대본은 건드리지 않는다 — 임시 .md · 임시 출력 폴더, 끝나면 지운다. PDF 는 열지 않는다(open:false).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TAG = `__대본보기테스트_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const LONG = '긴 문단을 만들기 위한 문장입니다 여러 쪽이 되도록 충분히 깁니다.';
const SCRIPT = [
  '# 대본 보기 테스트',
  '> 🧭 **[메타]** 이 줄은 지침이라 나오면 안 됩니다.',
  '',
  '## 도입부',
  '### 〔첫 장면 · 5샷 · I2V〕',
  '> 🖼️ 이미지: a quiet room SHOULD_NOT_APPEAR',
  '> 🎬 영상: slow push in SHOULD_NOT_APPEAR',
  '첫째 문장입니다.',
  '둘째 문장입니다.',
  '',
  '## 1장. 본론',
  '### 〔두 번째 장면〕',
  '> 🖼️ 이미지: a bus stop',
  Array.from({ length: 160 }, () => LONG).join(' '),
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
  let outRoot = null;
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sblk', { timeout: 20000 });

    const btn = win.locator('.hgroup:has(.glabel:has-text("완성")) button:has-text("📄 대본 보기")');
    ok(await btn.count() === 1, '④ 완성에 「📄 대본 보기」');
    await btn.click();
    await win.waitForSelector('[data-testid="script-reader"]', { timeout: 5000 });
    const R = win.locator('[data-testid="script-reader"]');
    const txt = await R.innerText();
    ok(/대본 보기 테스트/.test(txt) && /첫째 문장입니다/.test(txt), '제목과 본문이 나온다');
    ok(!/SHOULD_NOT_APPEAR|a quiet room|지침이라/.test(txt), '🔑 이미지·영상 프롬프트·메타는 안 나온다');
    ok(/도입부/.test(txt) && /1장\. 본론/.test(txt) && /두 번째 장면/.test(txt), '섹션 제목(H2·H3)');
    ok(!/첫 장면/.test(txt), '제작메모뿐인 H3(〔… · 5샷 · I2V〕)는 ⏱ 챕터와 같은 규칙으로 뺀다');
    ok(!/5샷|I2V/.test(txt), '제작 표기 꼬리는 지운다');

    // ✏ 문단 편집 — 워드처럼 문단을 눌러 이어서 고친다 · 바뀐 문장만 저장 · 한글 조합 중엔 저장 안 함 (v0.5.34)
    const readMd = () => fs.readFileSync(MD, 'utf8');
    await R.locator('.rd-para').first().click();
    const ta = R.locator('[data-testid="reader-edit"]');
    await ta.waitFor({ timeout: 5000 });
    ok((await ta.inputValue()) === '첫째 문장입니다. 둘째 문장입니다.', '누른 문단 전체가 한 편집칸에(문장을 이어서)');
    ok(await R.locator('[data-testid="reader-edit"]').count() === 1, '편집칸은 하나');
    // 둘째 문장만 고친다 — 조합(IME) 흉내: compositionstart → 값 바꿈 → 오래 기다려도 저장 안 됨 → compositionend → 저장
    const setVal = (v) => ta.evaluate((el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    await ta.evaluate((el) => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await setVal('첫째 문장입니다. 두 번째로 바뀐 문장입니다.');
    await win.waitForTimeout(2600);
    ok(!readMd().includes('두 번째로 바뀐'), '🔑 한글 조합 중에는 2.6초가 지나도 저장하지 않는다');
    await ta.evaluate((el) => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '다' })));
    await win.waitForTimeout(2800);
    let md = readMd();
    ok(md.includes('두 번째로 바뀐 문장입니다.') && !md.includes('둘째 문장입니다.'), '조합이 끝나고 손을 멈추면 저장된다(.md 반영)');
    ok(/^첫째 문장입니다\.$/m.test(md), '🔑 안 고친 첫 문장은 대본의 자기 줄 그대로(다시 쓰지 않았다)');
    ok(await ta.count() === 1, '저장해도 편집칸이 닫히지 않는다 — 이어서 고친다');
    // 이어서 — 맨 끝에 문장을 덧붙이고 Enter(저장 후 닫기)
    await ta.focus();
    await win.keyboard.press('End');
    await win.keyboard.type(' 이어서 쓴 문장입니다.');
    await ta.press('Enter');
    await win.waitForTimeout(1800);
    md = readMd();
    ok(md.includes('이어서 쓴 문장입니다.'), 'Enter = 저장');
    ok(await R.locator('[data-testid="reader-edit"]').count() === 0, 'Enter 뒤 편집칸이 닫힌다');
    ok(/이어서 쓴 문장입니다/.test(await R.innerText()), '화면에도 바로 반영');
    ok(md.includes('SHOULD_NOT_APPEAR'), '지침 줄은 그대로 남는다');
    // Esc = 아직 저장 안 된 고침 취소
    await R.locator('.rd-para').nth(1).click();
    await ta.waitFor({ timeout: 5000 });
    await setVal('이건 저장되면 안 됩니다.');
    await ta.press('Escape');
    await win.waitForTimeout(2000);
    ok(!readMd().includes('이건 저장되면 안 됩니다'), 'Esc = 취소(저장 안 함)');
    ok(await R.count() === 1, 'Esc 한 번은 편집만 닫는다(창은 그대로)');
    // 다른 곳을 누르면(blur) 저장
    await R.locator('.rd-para').first().click();
    await ta.waitFor({ timeout: 5000 });
    await setVal((await ta.inputValue()).replace('첫째 문장입니다.', '맨 처음 문장입니다.'));
    await R.locator('h1').first().click();
    await win.waitForTimeout(1800);
    md = readMd();
    ok(md.includes('맨 처음 문장입니다.') && md.includes('두 번째로 바뀐 문장입니다.'), '다른 곳을 누르면 저장(고친 첫 문장만)');

    // A4 PDF — 1쪽 / 4쪽 (main 을 직접 불러 쪽수·크기를 잰다. 파일은 열지 않는다)
    const { PDFDocument } = require(path.join(ROOT, 'node_modules', 'pdf-lib'));
    const r1 = await win.evaluate(() => window.api.scriptReaderPdf({ perSheet: 1, fontPt: 11, open: false }));
    outRoot = path.dirname(r1.path);
    const dl = await app.evaluate(({ app }) => app.getPath('downloads'));
    ok(path.resolve(outRoot).toLowerCase() === path.resolve(dl).toLowerCase(), `PDF 저장 폴더 기본값 = 윈도우 다운로드 (${outRoot})`);
    const d1 = await PDFDocument.load(fs.readFileSync(r1.path));
    const s1 = d1.getPage(0).getSize();
    ok(d1.getPageCount() >= 3 && Math.abs(s1.width - 595.3) < 2 && Math.abs(s1.height - 841.9) < 2, `1쪽: A4 세로 ${d1.getPageCount()}쪽 (${Math.round(s1.width)}×${Math.round(s1.height)}pt)`);
    const r4 = await win.evaluate(() => window.api.scriptReaderPdf({ perSheet: 4, fontPt: 11, open: false }));
    const d4 = await PDFDocument.load(fs.readFileSync(r4.path));
    const s4 = d4.getPage(0).getSize();
    ok(r4.pages === d1.getPageCount() && d4.getPageCount() === Math.ceil(r4.pages / 4), `4쪽 모아: ${r4.pages}쪽 → ${d4.getPageCount()}장`);
    ok(Math.abs(s4.width - 595.3) < 2, '4쪽 모아 = A4 세로');
    const r2 = await win.evaluate(() => window.api.scriptReaderPdf({ perSheet: 2, fontPt: 11, open: false }));
    const s2 = (await PDFDocument.load(fs.readFileSync(r2.path))).getPage(0).getSize();
    ok(s2.width > s2.height, '2쪽 모아 = A4 가로');
    ok(/_한장에4쪽\.pdf$/.test(r4.path) && /_대본\.pdf$/.test(r1.path), `파일 이름: ${path.basename(r4.path)}`);
    for (const r of [r1, r2, r4]) { try { fs.rmSync(r.path, { force: true }); } catch (_) {} }

    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="script-reader"]').count() === 0, 'Esc 로 닫힌다');
    ok(errs.length === 0, `화면 오류 0건 (${errs.slice(0, 2).join(' / ')})`);
  } finally {
    await app.close();
    cleanup();
    // 이 테스트가 만든 빈 출력 폴더만 치운다(비어 있지 않으면 건드리지 않는다)
    if (outRoot && path.basename(outRoot).includes(TAG)) { try { fs.rmdirSync(outRoot); } catch (_) {} }
  }
  console.log(`\n${fail ? '❌' : '✅'} 대본 보기 E2E ${pass}/${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 실패:', e); cleanup(); process.exit(1); });
