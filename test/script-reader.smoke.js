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
const menu = require('./_menu');

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
  '### 〔세 번째 장면〕',
  '> 🖼️ 이미지: a kitchen',
  '[엄마] 엄마의 대사입니다.',
  '내레이션 문장입니다.',
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

    await menu(win, 'finish');
    const btn = win.locator('.hgroup:has(.glabel:has-text("완성")) button:has-text("📄 대본 보기")');
    ok(await btn.count() === 1, '④ 완성에 「📄 대본 보기」');
    await btn.click();
    await win.waitForSelector('[data-testid="script-reader"]', { timeout: 5000 });
    const R = win.locator('[data-testid="script-reader"]');
    const txt = await R.innerText();
    ok(/대본 보기 테스트/.test(txt) && /첫째 문장입니다/.test(txt), '제목과 본문이 나온다');
    ok(!/SHOULD_NOT_APPEAR|a quiet room|지침이라/.test(txt), '🔑 이미지·영상 프롬프트·메타는 안 나온다');
    ok(/도입부/.test(txt) && /1장\. 본론/.test(txt) && !/두 번째 장면/.test(txt), '기본 = ## 장 제목만 보이고 ### 섹션 제목은 숨김');
    ok(!(await R.locator('[data-testid="reader-headings"] input').isChecked()), '「섹션 제목」 체크는 기본 꺼짐');
    await R.locator('[data-testid="reader-headings"] input').check();
    await win.waitForTimeout(400);
    ok(/두 번째 장면/.test(await R.innerText()) && /1장\. 본론/.test(await R.innerText()), '「섹션 제목」을 켜면 ### 도 보인다');
    ok(await win.locator('.hgroup:has(.glabel:has-text("완성")) button:has-text("미리보기")').count() === 0, '④ 완성에 ▶ 미리보기 버튼 없음(카드 아래에 있다)');
    ok(!/첫 장면/.test(txt), '제작메모뿐인 H3(〔… · 5샷 · I2V〕)는 ⏱ 챕터와 같은 규칙으로 뺀다');
    ok(!/5샷|I2V/.test(txt), '제작 표기 꼬리는 지운다');

    // ✏ 대본 전체 = 하나의 편집면 (v0.5.36) — 바뀐 문장만 저장 · 한글 조합 중엔 저장 안 함 · 경계 셋은 잠금
    const readMd = () => fs.readFileSync(MD, 'utf8');
    const doc = R.locator('[data-testid="reader-doc"]');
    ok(await doc.getAttribute('contenteditable') === 'true' && await R.locator('textarea').count() === 0, '대본 전체가 하나의 편집면(누를 필요 없이 어디든 커서)');
    const paraN = () => doc.locator('p[data-key]').count();
    const N0 = await paraN();
    const val = (i) => doc.evaluate((el, i) => el.readerValue(i), i);
    // 문단 i 의 글자 위치 off 에 커서(이름 칩은 건너뛰고 센다)
    const caret = (i, off) => doc.evaluate((root, [i, off]) => {
      const p = root.querySelectorAll('p[data-key]')[i]; let left = off, hit = null, last = null;
      const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 1 && c.hasAttribute('data-ne')) continue; if (c.nodeType === 3) { last = c; if (left <= c.nodeValue.length) { hit = [c, left]; return true; } left -= c.nodeValue.length; } else if (walk(c)) return true; } return false; };
      walk(p); if (!hit) hit = [last, last.nodeValue.length];
      root.focus(); const r = document.createRange(); r.setStart(hit[0], hit[1]); r.collapse(true);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }, [i, off]);
    // 문단 i 의 글에서 a → b 로 바꾸고 input 을 알린다(사람이 친 것과 같은 경로)
    const swap = (i, a, b) => doc.evaluate((root, [i, a, b]) => {
      const p = root.querySelectorAll('p[data-key]')[i];
      const t = [...p.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.includes(a));
      t.nodeValue = t.nodeValue.replace(a, b); root.dispatchEvent(new Event('input', { bubbles: true }));
    }, [i, a, b]);
    ok((await val(0)) === '첫째 문장입니다. 둘째 문장입니다.', '문단 글 = 문장들을 이은 글');

    // 🖼 첫 그룹에 그림을 붙여 둔다 — 문장을 고쳐도 그림이 남아야 한다(로이 2026-09-25)
    const g1 = Number(await doc.locator('p[data-key]').first().getAttribute('data-g'));
    const PNG = path.join(ROOT, 'whiteboard', 'assets', 'drawing-hand.png');
    const pickFile = (fp) => app.evaluate(({ dialog }, fp) => { dialog.showOpenDialog = async () => (fp ? { canceled: false, filePaths: [fp] } : { canceled: true, filePaths: [] }); }, fp);
    await pickFile(PNG);
    await win.evaluate((g) => window.api.attachAsset({ shortsNum: 1, groupNum: g }), g1);
    const cutOf = async () => { await pickFile(null); const d = await win.evaluate((g) => window.api.attachAsset({ shortsNum: 1, groupNum: g }), g1); return d.projects[0].cuts.find((c) => c.num === g1); };
    ok(/drawing-hand\.png$/.test(String((await cutOf()).imagePath || '')), '(준비) 첫 그룹에 그림 첨부');
    await win.waitForTimeout(300);

    // 🔑 한글 조합 — compositionstart 뒤로는 오래 기다려도 저장 안 함 → compositionend 뒤 멈추면 저장
    await caret(0, 12);
    await doc.evaluate((el) => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await swap(0, '둘째 문장입니다.', '두 번째로 바뀐 문장입니다.');
    await win.waitForTimeout(2600);
    ok(!readMd().includes('두 번째로 바뀐'), '🔑 한글 조합 중에는 2.6초가 지나도 저장하지 않는다');
    await doc.evaluate((el) => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '다' })));
    await win.waitForTimeout(2800);
    let md = readMd();
    ok(md.includes('두 번째로 바뀐 문장입니다.') && !md.includes('둘째 문장입니다.'), '조합이 끝나고 손을 멈추면 저장된다(.md 반영)');
    ok(/^첫째 문장입니다\.$/m.test(md), '🔑 안 고친 첫 문장은 대본의 자기 줄 그대로(다시 쓰지 않았다)');
    { const c = await cutOf();
      ok(/drawing-hand\.png$/.test(String(c.imagePath || '')) && !c.imageStale, '🔑 문장을 고쳐도 그 그룹 그림은 그대로(「새 이미지 필요」 아님)'); }

    // 실제 키보드로 이어서 쓰기(문단 끝에 커서 → 타이핑 → 멈춤)
    await caret(0, 9999);
    await win.keyboard.type(' 이어서 쓴 문장입니다.');
    await win.waitForTimeout(2600);
    md = readMd();
    ok(md.includes('이어서 쓴 문장입니다.'), '키보드로 이어서 쓴 글이 저장된다');

    // 🔒 ① Enter = 새 문단 금지(지금 저장만)
    await caret(0, 5);
    await win.keyboard.press('Enter');
    await win.waitForTimeout(500);
    ok(await paraN() === N0 && (await val(0)).startsWith('첫째 문장입니다.'), '🔒 Enter 로 새 문단이 생기지 않는다');
    ok(/새 문단은 만들 수 없습니다/.test(await R.locator('[data-testid="reader-msg"]').innerText()), 'Enter 를 막은 이유를 알린다');
    // 🔒 ② 문단 잇기 — 둘째 문단 맨 앞 Backspace · 첫 문단 맨 끝 Delete
    const v1 = await val(1);
    await caret(1, 0);
    await win.keyboard.press('Backspace');
    await caret(0, 9999);
    await win.keyboard.press('Delete');
    await win.waitForTimeout(400);
    ok(await paraN() === N0 && (await val(1)) === v1, '🔒 문단 맨 앞 Backspace · 맨 끝 Delete 로 문단이 이어지지 않는다');
    ok(/문단을 잇거나/.test(await R.locator('[data-testid="reader-msg"]').innerText()), '문단 잇기를 막은 이유를 알린다');
    // 🔒 문단을 걸친 선택 지우기
    await doc.evaluate((root) => {
      const ps = root.querySelectorAll('p[data-key]'); const a = ps[0].lastChild, b = ps[1].firstChild;
      const r = document.createRange(); r.setStart(a, Math.max(0, a.nodeValue.length - 3)); r.setEnd(b, 3);
      root.focus(); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await win.keyboard.press('Backspace');
    await win.waitForTimeout(400);
    ok(await paraN() === N0 && (await val(1)) === v1, '🔒 문단을 걸친 선택을 지워도 두 문단이 그대로');
    ok(!/되돌렸습니다/.test(await R.locator('[data-testid="reader-msg"]').innerText()), '입력 전에 막았다(깨진 뒤 되돌린 것이 아니다)');
    // 🔒 ③ 제목은 못 고친다
    const h3 = doc.locator('h3').first();
    const h3t = await h3.innerText();
    await h3.click();
    await win.keyboard.type('XYZ');
    await win.waitForTimeout(300);
    ok((await h3.innerText()) === h3t && await h3.getAttribute('contenteditable') === 'false', '🔒 섹션 제목은 고쳐지지 않는다');

    // 🎭 화자 이름 — 칩으로 보이고, Backspace 로 안 지워지고, 대사를 고쳐도 .md 의 [엄마] 는 그대로
    const pi = await doc.evaluate((root) => [...root.querySelectorAll('p[data-key]')].findIndex((p) => p.textContent.includes('엄마의 대사')));
    const sp = doc.locator('p[data-key]').nth(pi);
    ok(await sp.locator('[data-spk]').count() === 1 && (await sp.locator('[data-spk]').innerText()).trim() === '엄마', '🔑 편집면에 화자 이름(엄마)이 보인다');
    ok((await val(pi)) === '엄마의 대사입니다. 내레이션 문장입니다.', '이름은 글에 섞이지 않는다(비교·저장은 문장 글만)');
    await caret(pi, 0);
    await win.keyboard.press('Backspace');
    ok(await sp.locator('[data-spk]').count() === 1, 'Backspace 로 이름이 지워지지 않는다');
    await swap(pi, '대사', '말');
    await R.locator('.meta').last().click();   // 편집면 밖을 누르면 저장
    await win.waitForTimeout(1800);
    md = readMd();
    ok(/^\[엄마\] 엄마의 말입니다\.\r?\n내레이션 문장입니다\.$/m.test(md), '편집면 밖을 누르면 저장 — .md 의 [엄마] 접두 · 다음 줄 그대로');
    ok(md.includes('SHOULD_NOT_APPEAR'), '지침 줄은 그대로 남는다');

    // Esc = 저장 안 된 고침 되돌리기(창은 그대로)
    await caret(0, 0);
    await swap(0, '첫째', '이건저장되면안됨');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(2000);
    ok(!readMd().includes('이건저장되면안됨') && (await val(0)).startsWith('첫째'), 'Esc = 저장 안 된 고침 되돌리기');
    ok(await R.count() === 1, 'Esc 한 번은 되돌리기만(창은 그대로)');
    const fw = await R.locator('[data-testid="reader-fontpt"]').evaluate((el) => el.getBoundingClientRect().width);
    ok(fw > 30 && fw < 90, `인쇄 글자(pt) 칸 폭이 적당하다 (${Math.round(fw)}px)`);

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
