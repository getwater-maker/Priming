'use strict';
/**
 * scripts/make-interior-pdf.js — 📕 앱 UI 없이 원고(.md)에서 **부크크 내지 PDF** 를 만든다(출판 세션·다음 권 2~10권용 · 2026-10-02).
 *   앱의 「종이책 PDF」 와 **같은 함수**(parseBookFiles → buildBookHtml → buildInteriorPdf)를 같은 기본 설정으로 부른다 —
 *   조판 설정은 원고 메타(판형·머리글·판권위치·쪽번호안전 …)가 정한다. (앱 화면에서 따로 바꾼 조판 탭 값은 원고 폴더에 저장되지 않으니 여기엔 없다 — 필요하면 원고 메타로.)
 *
 * 사용:
 *   node D:\Priming\scripts\make-interior-pdf.js <원고.md> [<원고2.md> …] --out <내지.pdf> [--backup-tag R21] [--json]
 *     · 원고가 여러 개면 필수파일 → 회차 순(앱 열기와 같은 정렬: 필수 먼저, 나머지 파일명 숫자순).
 *     · --out 이 이미 있으면 같은 폴더 `_이전/<이름>_<태그>.pdf` 로 먼저 옮긴다(--backup-tag 없으면 수정 시각 KST 를 태그로).
 *     · 끝에 쪽수 · 회 시작 쪽 · 판권 쪽 · 목차 쪽을 알려 준다(--json 이면 JSON 한 줄).
 *   node scripts/make-interior-pdf.js --analyze <내지.pdf>   (이미 만든 PDF 의 쪽수·회 시작 쪽·판권 쪽만 본다)
 *   작업 폴더(_work)는 출력 파일 옆 `_work_내지/` — 끝나면 지운다(--keep-work 으로 남김).
 * ⚠ 개발 도구라 설치본(라이트 업데이트)에는 들어가지 않는다(scripts/ 폴더) — 메인 PC 의 D:\Priming 에서 돈다.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function parseArgs(argv) {
  const a = { files: [], out: '', tag: '', json: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--out') a.out = argv[++i];
    else if (v === '--backup-tag') a.tag = argv[++i];
    else if (v === '--json') a.json = true;
    else if (v === '--keep-work') a.keep = true;
    else if (v === '--analyze') a.analyze = argv[++i];
    else if (v.startsWith('--')) throw new Error('알 수 없는 옵션: ' + v);
    else a.files.push(v);
  }
  return a;
}
const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 13);

/** PDF 쪽별 글줄 → 회 시작 쪽 · 판권 쪽 · 목차 쪽 */
async function analyzePdf(pdfPath) {
  const mu = await import(pathToFileURL(path.join(__dirname, '..', 'node_modules', 'mupdf', 'dist', 'mupdf.js')).href);
  const doc = mu.Document.openDocument(fs.readFileSync(pdfPath), 'application/pdf');
  const n = doc.countPages();
  const pages = [];
  for (let i = 0; i < n; i++) {
    const lines = []; let cur;
    doc.loadPage(i).toStructuredText('preserve-whitespace').walk({ beginLine() { cur = ''; }, onChar(c) { cur += c; }, endLine() { lines.push(cur.trim()); } });
    pages.push(lines.filter(Boolean));
  }
  const chapters = {};
  pages.forEach((ls, i) => { const m = ls[0] && /^제\s*(\d+)\s*회$/.exec(ls[0]); if (m) chapters[Number(m[1])] = i + 1; });   // 같은 회가 목차에도 있으니 **마지막** 쪽이 본문 시작
  const tocPages = []; pages.forEach((ls, i) => { if (ls[0] === '목차') tocPages.push(i + 1); });   // 목차 시작 쪽(이어지는 쪽은 첫 글줄이 항목이라 구분 안 함)
  const colophon = []; pages.forEach((ls, i) => { const t = ls.join(' '); if (/(초판\s*\d*\s*쇄\s*발행|발행일)/.test(t) && /(All rights|저작권자|복제|ISBN)/.test(t)) colophon.push(i + 1); });   // ISBN 이 아직 없는 책도 잡는다
  const lastIdx = pages.length;
  return { pages: n, chapters, toc: tocPages, colophon, lastBlank: !(pages[lastIdx - 1] || []).length };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.analyze) { const an = await analyzePdf(path.resolve(a.analyze)); console.log(JSON.stringify(an)); return; }   // 이미 만든 PDF 의 쪽 정보만
  if (!a.files.length || !a.out) { console.error('사용: node scripts/make-interior-pdf.js <원고.md> [원고2.md …] --out <내지.pdf> [--backup-tag R21] [--json] [--keep-work]'); process.exit(2); }
  const { parseBookFiles, detectBookFileKind } = require('../core/parsers/book-parser');
  const { buildBookHtml } = require('../core/book/html-builder');
  const PB = require('../core/book/pdf-builder');
  const items = a.files.map((p) => ({ p: path.resolve(p), text: fs.readFileSync(path.resolve(p), 'utf8') }));
  items.forEach((x) => { x.kind = detectBookFileKind(x.text); });
  items.sort((x, y) => (x.kind === 'essential' ? -1 : 0) - (y.kind === 'essential' ? -1 : 0) || path.basename(x.p).localeCompare(path.basename(y.p), 'ko', { numeric: true }));
  const book = parseBookFiles(items.map((x) => ({ path: x.p, text: x.text })), path.basename(items[0].p).replace(/\.md$/i, ''));
  const out = path.resolve(a.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // 기존 파일 보관
  let backup = '';
  if (fs.existsSync(out)) {
    const dir = path.join(path.dirname(out), '_이전'); fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(out, '.pdf');
    const tag = a.tag || kst(fs.statSync(out).mtimeMs);
    backup = path.join(dir, `${base}_${tag}.pdf`);
    if (fs.existsSync(backup)) throw new Error('보관 파일이 이미 있습니다(덮어쓰지 않습니다): ' + backup);
    fs.renameSync(out, backup);
  }
  const workDir = path.join(path.dirname(out), '_work_내지');
  const assets = PB.prepareWorkAssets(workDir);
  const { html } = buildBookHtml(book, { baseDir: path.dirname(items[0].p), imageUrl: assets.imageUrl, fontCss: assets.fontCss, sourceMap: false });
  // 경고(글꼴 파일·각주·누락 글자)도 같이 알린다
  const warns = [];
  try { const miss = PB.missingBundledFonts(); if (miss.length) warns.push('동봉 글꼴 파일 없음: ' + miss.join(', ')); } catch (_) {}
  try { const F = require('../core/book/footnote-check'); warns.push(...F.warnings(F.footnoteIssues(book)).filter((w) => !w.startsWith('ℹ'))); } catch (_) {}
  try { const G = require('../core/book/glyph-check'); const r = G.missingGlyphs(G.visibleText(html), G.defaultChain(path.join(__dirname, '..', 'assets', 'fonts', 'book'))); if (r.missing.length) warns.push(G.formatWarning(r)); } catch (_) {}
  const logs = [];
  const r = await PB.buildInteriorPdf({ html, outPdf: out, workDir, log: (m) => logs.push(m) });
  if (!r.success) { if (backup) { try { fs.renameSync(backup, out); } catch (_) {} } console.error('✗ 내지 PDF 실패: ' + r.error + (backup ? ' (기존 파일을 되돌렸습니다)' : '')); process.exit(1); }
  const an = await analyzePdf(out);
  if (!a.keep) { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {} }
  const res = { out, backup, bytes: fs.statSync(out).size, ...an, warnings: warns, spineMmFormula: '1.6+0.055×쪽수(부크크, 400쪽부터 0.045)' };
  if (a.json) { console.log(JSON.stringify(res)); return; }
  console.log(`✅ 내지 PDF — ${an.pages}쪽 (${(res.bytes / 1048576).toFixed(2)}MB) → ${out}`);
  if (backup) console.log(`   기존 파일 보관 → ${backup}`);
  console.log(`   회 시작 쪽: ${Object.entries(an.chapters).map(([k, v]) => `${k}회 p${v}`).join(' · ') || '(찾지 못함)'}`);
  console.log(`   목차 쪽: ${an.toc.join(', ') || '-'} · 판권 쪽: ${an.colophon.join(', ') || '-'}${an.lastBlank ? ' · ⚠ 마지막 쪽이 빈 쪽' : ''}`);
  for (const w of warns) console.log('   ' + w);
}
if (require.main === module) main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
module.exports = { analyzePdf, parseArgs };
