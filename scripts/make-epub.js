'use strict';
/**
 * scripts/make-epub.js — 📱 앱 UI 없이 원고(.md)에서 **ePub(EPUB 2.0)** 을 만든다(출판 세션·다음 권용 · 2026-10-02).
 *   앱의 「ePub 만들기」와 같은 함수(parseBookFiles → buildEpub)·같은 기본값(한자 글꼴 동봉). 표지는 원고 메타 `> 표지파일:` 의 인쇄용 이미지에서 앞표지를 잘라 쓴다 —
 *   자르는 위치는 **쪽수로 정해지는 책등**에 달려 있어 `--pages` 또는 `--interior <내지.pdf>`(쪽수를 읽는다)가 필요하다.
 *
 * 사용:
 *   node D:\Priming\scripts\make-epub.js <원고.md> --out <책.epub> (--interior <내지.pdf> | --pages 271) [--backup-tag R25] [--no-fonts] [--check] [--json]
 *     · --out 이 이미 있으면 같은 폴더 `_이전/<이름>_<태그>.epub` 로 먼저 옮긴다(태그 없으면 수정 시각).
 *     · --check 이면 끝에 EPUBCheck(~/.priming-maker/tools)로 규격 검증(없으면 건너뜀).
 *     · 전자책 표지 조각은 출력 폴더가 `완성` 이면 `_작업/epub/`, 아니면 출력 옆.
 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const a = { files: [], out: '', tag: '', json: false, check: false, fonts: true, pages: 0, interior: '' };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--out') a.out = argv[++i];
    else if (v === '--backup-tag') a.tag = argv[++i];
    else if (v === '--pages') a.pages = Number(argv[++i]) || 0;
    else if (v === '--interior') a.interior = argv[++i];
    else if (v === '--json') a.json = true;
    else if (v === '--check') a.check = true;
    else if (v === '--no-fonts') a.fonts = false;
    else if (v.startsWith('--')) throw new Error('알 수 없는 옵션: ' + v);
    else a.files.push(v);
  }
  return a;
}
const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 13);

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.files.length || !a.out) { console.error('사용: node scripts/make-epub.js <원고.md> --out <책.epub> (--interior <내지.pdf> | --pages N) [--backup-tag R25] [--no-fonts] [--check] [--json]'); process.exit(2); }
  const { parseBookFiles, detectBookFileKind } = require('../core/parsers/book-parser');
  const { buildEpub, cropFrontCover } = require('../core/book/epub-builder');
  const WF = require('../core/book/work-folder');
  const SC = require('../core/book/spine-calc');
  const PP = require('../core/book/platform-presets');
  const { metaPlatformId } = require('../core/book/html-builder');
  const items = a.files.map((p) => ({ p: path.resolve(p), text: fs.readFileSync(path.resolve(p), 'utf8') }));
  items.forEach((x) => { x.kind = detectBookFileKind(x.text); });
  items.sort((x, y) => (x.kind === 'essential' ? -1 : 0) - (y.kind === 'essential' ? -1 : 0) || path.basename(x.p).localeCompare(path.basename(y.p), 'ko', { numeric: true }));
  const book = parseBookFiles(items.map((x) => ({ path: x.p, text: x.text })), path.basename(items[0].p).replace(/\.md$/i, ''));
  const meta = book.meta || {};
  // 쪽수 → 스프레드(앱의 bookSpec 과 같은 계산)
  let pages = a.pages;
  if (!pages && a.interior) { const { analyzePdf } = require('./make-interior-pdf'); pages = (await analyzePdf(path.resolve(a.interior))).pages; }
  const platformId = metaPlatformId(meta); const pf = PP.getPlatform(platformId);
  const trimId = meta.trim && PP.TRIM_SIZES[meta.trim] ? meta.trim : pf.defaultTrim;
  const paperId = PP.effectivePaper(platformId, meta.paper, pages);
  const flaps = !!(meta.flaps && !/^(없음|no|off|false|x)$/i.test(String(meta.flaps).trim()));
  const spineOverrideMm = Number(String(meta.spineMm || '').replace(/[^0-9.]/g, '')) || 0;
  const spread = SC.coverSpread({ platformId, trimId, paperId, totalPages: pages || 0, flaps, spineOverrideMm });
  // 표지 원본: 메타 > 자동 후보
  const cv = WF.resolveCoverFile({ meta, scriptPath: items[0].p, manual: null });
  if (cv.warn) console.error(cv.warn);
  const out = path.resolve(a.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let backup = '';
  if (fs.existsSync(out)) {
    const dir = path.join(path.dirname(out), '_이전'); fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(out, '.epub');
    backup = path.join(dir, `${base}_${a.tag || kst(fs.statSync(out).mtimeMs)}.epub`);
    if (fs.existsSync(backup)) throw new Error('보관 파일이 이미 있습니다(덮어쓰지 않습니다): ' + backup);
    fs.renameSync(out, backup);
  }
  const logs = [];
  const tmpDir = WF.tmpDir(path.dirname(out), '', 'epub');
  const r = await buildEpub(book, {
    outPath: out, baseDir: path.dirname(items[0].p), tmpDir, embedFonts: a.fonts ? undefined : 'none',
    coverImagePath: pages > 0 && cv.path ? cv.path : null, spread, log: (m) => logs.push(m),
    // 전자책 표지 = 메타 전자책표지 > 표지 도구 산출물 `부속/…_전자책앞표지.jpg`(앱과 같은 규칙 — 업로드 형식 JPG·PDF) > 인쇄 표지 크롭
    ebookCoverPath: (WF.resolveEbookCover({ meta, scriptPath: items[0].p, coverImagePath: cv.path }).path || ''),
  });
  if (!r.success) { if (backup) { try { fs.renameSync(backup, out); } catch (_) {} } console.error('✗ ePub 실패'); process.exit(1); }
  const res = { out, backup, bytes: fs.statSync(out).size, pages, cover: cv.path || '', coverUsed: !!(pages > 0 && cv.path), spineMm: spread.spineMm, logs };
  if (a.check) { res.check = await require('../core/book/epubcheck').runEpubCheck(out); }
  if (a.json) { console.log(JSON.stringify(res)); return; }
  console.log(`✅ ePub — ${(res.bytes / 1048576).toFixed(2)}MB → ${out}`);
  if (backup) console.log(`   기존 파일 보관 → ${backup}`);
  console.log(`   쪽수 ${pages || '(미지정 — 표지 크롭 생략)'} · 책등 ${spread.spineMm}mm · 표지 원본 ${cv.path || '(없음)'}${res.coverUsed ? ' → 앞표지 크롭 포함' : ''}`);
  for (const l of logs) console.log('   ' + l);
  if (res.check) {
    const c = res.check;
    console.log(c.missing ? '   ℹ EPUBCheck 도구 없음 — 검증 건너뜀' : c.error ? `   ✗ EPUBCheck 실패: ${c.error}` : `   ${c.ok ? '✅' : '⚠'} EPUBCheck ${c.version} — EPUB ${c.epubVersion} · 치명 ${c.nFatal} · 오류 ${c.nError} · 경고 ${c.nWarning}`);
    for (const m of (c.messages || []).slice(0, 8)) console.log(`      ${m.severity} ${m.where} — ${m.message}`);
  }
}
if (require.main === module) main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
module.exports = { parseArgs };
