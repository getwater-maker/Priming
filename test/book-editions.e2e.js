'use strict';
/**
 * node test/book-editions.e2e.js — 실제 앱(IPC)으로 종이책 PDF / 전자책 PDF / ePub 를 굽는다 (v0.5.96)
 *   book-build-pdf {edition:'print'|'ebook'} · book-build-epub · 책등 두께(부크크 공식 · 손입력 우선)
 *   ⚠ 로이 앱과 같은 workspace 를 덮는다 → 로이 큐가 도는 중엔 돌리지 말 것. 임시 채널·임시 출력폴더만 쓴다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TAG = `__책판_${process.pid}`;
const OUTDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bookeds-'));
const MD = path.join(OUTDIR, `${TAG}.md`);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const para = '조식은 붓을 들어 이렇게 적었다. 천하의 일은 합쳐지면 나뉘고 나뉘면 다시 합쳐진다는 말이 있다. '.repeat(8);
fs.writeFileSync(MD, `# ${TAG}
> 저자: 나관중
> 출판사: 고전서재
> 발행일: 2026-10-01
> ISBN: 9791100000001
> 전자책ISBN: 9791100000002
> 정가: 15,000원
> 전자책: 8,000원
> 판형: A5
> 특별섹션: 역사 노트

## [서문]
서문. ${para}

## [목차]

## 제1회 도원에서 의형제를 맺고 황건적을 무찔러 처음 공을 세우다
${(para + '\n\n').repeat(5)}
### 역사 노트
노트 문단. ${para}

## 제2회 장익덕이 독우를 매질하고 하진이 환관을 죽이려 하다
${(para + '\n\n').repeat(5)}

## [판권]
`, 'utf8');

(async () => {
  const chan = `__책판채널_${process.pid}`;
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win;
  try {
    win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    await app.evaluate(({ shell }) => { shell.openPath = async () => ''; });   // 탐색기 자동 열기 막기
    await win.evaluate(async ({ name, dir }) => { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); }, { name: chan, dir: OUTDIR });
    const opened = await win.evaluate(async ({ p, name }) => window.api.openBookPath({ scriptPaths: [p], presetName: name }), { p: MD, name: chan });
    ok(opened && opened.dto && opened.dto.kind === 'book', '출판 원고 열기');
    const dto0 = opened.dto;
    ok(dto0.platformId === 'bookk' && dto0.paperId === '미색모조 100g' && dto0.paperLocked === true, `DTO: 부크크 · 용지 잠금 · ${dto0.paperId}`);
    ok(dto0.meta.specialSections === '역사 노트', 'DTO: 특별섹션 메타');

    console.log('\n[1] 📕 종이책 PDF');
    const rp = await win.evaluate(async () => window.api.bookBuildPdf({ layout: { headerOdd: 'chapterNo' }, edition: 'print' }));
    ok(rp && !rp.error && rp.interiorPdf && fs.existsSync(rp.interiorPdf), `내지.pdf 생성 (${rp && rp.pages}쪽) — ${rp && rp.error || ''}`);
    ok(rp && rp.interiorPdf && /_내지\.pdf$/.test(rp.interiorPdf), '파일명 _내지.pdf');
    const dtoP = rp && rp.dto;
    ok(dtoP && dtoP.lastPages === rp.pages, `종이책 쪽수가 책등 계산 근거로 기록된다(${dtoP && dtoP.lastPages})`);
    const expSpine = Math.round((1.6 + 0.055 * rp.pages) * 100) / 100;
    ok(dtoP && dtoP.spread.spineMm === expSpine, `책등 = 1.6 + 0.055×${rp.pages} = ${expSpine}mm (앱 ${dtoP && dtoP.spread.spineMm})`);
    const pagesP = rp.pages;

    console.log('\n[2] 📱 전자책 PDF');
    const re = await win.evaluate(async () => window.api.bookBuildPdf({ layout: { headerOdd: 'chapterNo' }, edition: 'ebook' }));
    ok(re && !re.error && re.ebookPdf && fs.existsSync(re.ebookPdf), `전자책 PDF 생성 (${re && re.pages}쪽) — ${re && re.error || ''}`);
    ok(re && /_전자책\.pdf$/.test(re.ebookPdf || ''), '파일명 _전자책.pdf');
    ok(re && re.coverPdf == null && re.interiorPdf == null, '전자책은 표지 PDF·내지 PDF 를 따로 만들지 않는다');
    ok(re && re.dto && re.dto.lastPages === pagesP, `🔑 전자책을 구워도 종이책 쪽수(책등 근거)는 그대로 ${pagesP} (앱 ${re && re.dto && re.dto.lastPages})`);
    ok(re && re.pages < pagesP, `전자책 ${re && re.pages}쪽 < 종이책 ${pagesP}쪽(백면 없음)`);
    ok(fs.existsSync(rp.interiorPdf), '종이책 내지.pdf 는 전자책 생성으로 지워지지 않는다');

    console.log('\n[3] 책등 두께 손입력이 계산을 이긴다');
    const d3 = await win.evaluate(async () => window.api.bookSetMeta({ key: 'spineMm', value: '14.5' }));
    ok(d3 && d3.spread.spineMm === 14.5 && d3.spineManual === '14.5', `책등 14.5 (앱 ${d3 && d3.spread.spineMm})`);
    const d4 = await win.evaluate(async () => window.api.bookSetMeta({ key: 'spineMm', value: '' }));
    ok(d4 && d4.spread.spineMm === expSpine && !d4.spread.spineManual, '비우면 다시 자동 계산');

    console.log('\n[4] ePub — 역사 노트 상자 · 전자책 ISBN');
    const rE = await win.evaluate(async () => window.api.bookBuildEpub({}));
    ok(rE && rE.epubPath && fs.existsSync(rE.epubPath), 'ePub 생성' + (rE && rE.error ? ' — ' + rE.error : ''));
    if (rE && rE.epubPath) {
      const AdmZip = require('adm-zip'); const z = new AdmZip(rE.epubPath);
      const ch = z.getEntry('OEBPS/ch-001.xhtml'); const opf = z.getEntry('OEBPS/content.opf');
      ok(ch && /class="special-sec"/.test(ch.getData().toString('utf8')), 'ePub 1회: 역사 노트가 special-sec 상자(설정 비어도 원고 메타로)');
      ok(opf && /9791100000002/.test(opf.getData().toString('utf8')), 'ePub 식별자 = 전자책 ISBN');
    }
    const logs = await win.evaluate(() => (window.__logs || []).length).catch(() => 0);
  } finally {
    try { await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, chan); } catch (_) {}
    await app.close().catch(() => {});
    try { fs.rmSync(OUTDIR, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.md.smproj.json`), { force: true }); } catch (_) {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 책 판(종이책/전자책) E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 오류:', e); process.exit(1); });
