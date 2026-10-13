'use strict';
/**
 * node test/book-ebook-overseas.test.js — 해외 플랫폼 R26: KDP·D2D 전자책(ePub) 사전 점검
 *   · 표지 크기(KDP 짧은 변 500px · 권장 2560×1600 · 5MB · JPEG / D2D 1600×2400 · 키 큰 직사각형) · dc:language · 목차 · 90MB · EPUBCheck(D2D 필수)
 *   · 표지 제목은 이미지라 자동 판정 불가 → 사람이 확인(confirm) · 실제 영어 ePub 을 만들어 inspectEpub 에 통과시킨다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const OV = require('../core/book/ebook-overseas');
const EP = require('../core/book/ebook-preview');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildEpub } = require('../core/book/epub-builder');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ebov-'));
const img = (name, w, h, ext = 'jpg') => { const f = path.join(T, name + '.' + ext); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x3a5a8a:s=${w}x${h}`, '-frames:v', '1', f]); return f; };
const by = (items, id) => items.find((x) => x.id === id);

console.log('[1] 이미지 크기 읽기');
{
  const j = img('a', 1600, 2400), p = img('b', 800, 1200, 'png'), w = img('c', 640, 960, 'webp');
  const sj = OV.imgSizeFromBuffer(fs.readFileSync(j)), sp = OV.imgSizeFromBuffer(fs.readFileSync(p)), sw = OV.imgSizeFromBuffer(fs.readFileSync(w));
  ok(sj && sj.w === 1600 && sj.h === 2400 && sj.ext === 'jpg', 'JPEG 1600×2400');
  ok(sp && sp.w === 800 && sp.h === 1200 && sp.ext === 'png', 'PNG 800×1200');
  ok(sw && sw.w === 640 && sw.h === 960, 'WebP 640×960');
  ok(OV.imgSizeFromBuffer(Buffer.from('not an image at all, just text here....')) === null, '이미지가 아니면 null');
}

console.log('\n[2] 점검 규칙');
{
  const base = { lang: 'en', dcLanguage: 'en', version: '3.0', bytes: 5e6, hasNav: true, hasNcx: false, colophonText: 'Copyright © 2026 Roy' };
  const k = (cover, extra) => OV.overseasEbookChecks({ ...base, platformId: 'kdp', cover, ...extra });
  ok(by(k({ w: 1600, h: 2560, bytes: 1e6, ext: 'jpg' }), 'cover-size').level === 'ok', 'KDP 표지 1600×2560 = 권장 충족');
  ok(by(k({ w: 1000, h: 1600, bytes: 1e6, ext: 'jpg' }), 'cover-size').level === 'warn', 'KDP 표지 1000×1600 = 권장 미달 경고');
  ok(by(k({ w: 400, h: 640, bytes: 1e5, ext: 'jpg' }), 'cover-size').level === 'err', 'KDP 짧은 변 500px 미만 = 오류(사이트에 표시 안 됨)');
  ok(by(k({ w: 1600, h: 2560, bytes: 6 * 1048576, ext: 'jpg' }), 'cover-bytes').level === 'err' && by(k({ w: 1600, h: 2560, bytes: 1e6, ext: 'png' }), 'cover-fmt').level === 'warn', 'KDP 표지 5MB 초과 오류 · PNG 는 JPEG 선호 경고');
  ok(by(k({ w: 1600, h: 2560, bytes: 1e6, ext: 'jpg' }), 'cover-title').confirm === true && by(k(null), 'cover-size').level === 'err', '표지 제목은 사람이 확인(confirm) · 표지를 못 읽으면 오류');
  ok(by(k({ w: 1600, h: 2560, bytes: 1e6, ext: 'jpg' }, { lang: 'ko', dcLanguage: 'ko' }), 'lang-platform').level === 'err', 'KDP + 한국어 ePub = 오류');
  ok(by(k({ w: 1600, h: 2560, bytes: 1e6, ext: 'jpg' }, { dcLanguage: 'ko' }), 'lang').level === 'err' && by(k({ w: 1600, h: 2560, bytes: 1e6, ext: 'jpg' }, { dcLanguage: '' }), 'lang').level === 'err', 'dc:language 가 원고 언어와 다르거나 없으면 오류');
  ok(by(k({ w: 1600, h: 2560, bytes: 1e6, ext: 'jpg' }, { hasNav: false, hasNcx: false }), 'toc').level === 'err', '목차(nav/NCX) 없음 = 오류');
  const d = (cover, extra) => OV.overseasEbookChecks({ ...base, platformId: 'd2d', cover, ...extra });
  ok(by(d({ w: 1600, h: 2400, bytes: 1e6, ext: 'jpg' }), 'cover-size').level === 'ok' && by(d({ w: 800, h: 1200, bytes: 1e6, ext: 'jpg' }), 'cover-size').level === 'warn' && by(d({ w: 2400, h: 1600, bytes: 1e6, ext: 'jpg' }), 'cover-size').level === 'err', 'D2D 표지: 1600×2400 통과 · 작으면 경고 · 가로로 길면 오류(키 큰 직사각형)');
  ok(by(d({ w: 1600, h: 2400, ext: 'jpg' }, { bytes: 91 * 1048576 }), 'size').level === 'warn' && by(d({ w: 1600, h: 2400, ext: 'jpg' }), 'size').level === 'ok', 'D2D 90MB 초과 경고');
  ok(by(d({ w: 1600, h: 2400, ext: 'jpg' }), 'epubcheck').level === 'warn', 'D2D: EPUBCheck 도구가 없으면 경고(필수 요건이라)');
  ok(by(d({ w: 1600, h: 2400, ext: 'jpg' }, { epubcheck: { ok: true, nWarning: 2, version: '5.1' } }), 'epubcheck').level === 'ok' && by(d({ w: 1600, h: 2400, ext: 'jpg' }, { epubcheck: { ok: false, nError: 3 } }), 'epubcheck').level === 'err', 'D2D: EPUBCheck 통과 ok · 오류 err');
  ok(!by(k({ w: 1600, h: 2560, ext: 'jpg' }), 'epubcheck') && by(k({ w: 1600, h: 2560, ext: 'jpg' }, { epubcheck: { ok: true, nWarning: 0 } }), 'epubcheck').level === 'ok', 'KDP: EPUBCheck 는 참고(없으면 항목 없음)');
  ok(by(k({ w: 1600, h: 2560, ext: 'jpg' }, { colophonText: 'no notice' }), 'copyright').level === 'warn', '판권에 ©·copyright 없으면 경고');
}

(async () => {
  console.log('\n[3] 실제 영어 ePub → inspectEpub');
  const cov = img('cover', 1600, 2560);
  const md = (extra) => `# Test Book\n> 저자: Jane Doe\n> 옮긴이: Roy Han\n> 출판사: Classic Desk\n> 발행일: 2026-10-06\n> 언어: en\n> 플랫폼: KDP\n> 전자책표지: ${path.basename(cov)}\n${extra || ''}\n## [Copyright]\n\n* Annotated.\n\n## Chapter 1\n\nHello world.[^1]\n\n[^1]: A note.\n`;
  const build = async (name, text) => {
    const book = parseBookText(text, name); const out = path.join(T, name + '.epub');
    await buildEpub(book, { outPath: out, baseDir: T, tmpDir: T, embedFonts: 'none', epubVersion: 3, log: () => {} });
    return { out, meta: book.meta };
  };
  const a = await build('kdp', md());
  const info = EP.inspectEpub(a.out, { meta: a.meta, platformId: 'kdp', lang: 'en', bytes: fs.statSync(a.out).size, logs: [] });
  ok(info.platformLabel === 'Amazon KDP' && info.checks.length >= 8, 'KDP 점검 목록 + 플랫폼 이름');
  ok(by(info.checks, 'lang').level === 'ok' && by(info.checks, 'toc').level === 'ok' && by(info.checks, 'cover').level === 'ok' && by(info.checks, 'cover-size').level === 'ok' && by(info.checks, 'copyright').level === 'ok' && by(info.checks, 'fn').level === 'ok', '실제 ePub: 언어 en · 목차 nav · 1쪽 표지 · 표지 1600×2560 · 판권 © · 각주 연결');
  ok(!info.checks.some((c) => /발행인|출판등록|부크크/.test(c.text)), '부크크 판권 규칙(발행인·출판등록)은 해외 플랫폼에 적용하지 않는다');
  const ko = EP.inspectEpub(a.out, { meta: a.meta, logs: [] });
  ok(!ko.platformLabel && ko.checks.some((c) => c.id === 'req'), '플랫폼 인자가 없으면 예전(부크크) 점검 그대로');
  const d = EP.inspectEpub(a.out, { meta: a.meta, platformId: 'd2d', lang: 'en', bytes: 95 * 1048576, epubcheck: { ok: true, nWarning: 0, version: '5' } });
  ok(by(d.checks, 'size').level === 'warn' && by(d.checks, 'epubcheck').level === 'ok' && d.platformLabel === 'Draft2Digital', 'D2D: 90MB 초과 경고 · EPUBCheck 결과 반영');
  try { fs.rmSync(T, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${fail ? '❌' : '✅'} book-ebook-overseas ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 오류:', e); process.exit(1); });
