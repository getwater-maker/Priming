'use strict';
/** node test/book-ebook-guide.test.js — 부크크 전자책 점검표 · 각주 점검 · EPUBCheck(도구가 있는 PC 만) */
const fs = require('fs'), path = require('path'), os = require('os');
const RG = require('../core/book/register-guide');
const F = require('../core/book/footnote-check');
const EC = require('../core/book/epubcheck');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildEpub } = require('../core/book/epub-builder');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const st = (l, id) => [...l.required, ...l.optional].find((i) => i.id === id);
(async () => {
  console.log('\n[1] 전자책·부크크 점검표');
  const base = { meta: { title: 'T', author: 'A', ebookPrice: '3000' }, outputs: [], excluded: [], confirmed: {} };
  let l = RG.checklist('ebook', base);
  ok(st(l, 'file').state === 'todo' && st(l, 'size').state === 'todo' && st(l, 'valid').state === 'todo', 'ePub 이 없으면 파일·용량·검증이 todo');
  ok(st(RG.checklist('ebook', { ...base, outputs: [{ kind: 'epub', name: 'a.epub', bytes: 1e6 }] }), 'valid').state === 'info', 'ePub 은 있고 검증 전 → info(배지에 세지 않는다)');
  l = RG.checklist('ebook', { ...base, outputs: [{ kind: 'epub', name: 'a.epub', bytes: 7 * 1048576 }] });
  ok(st(l, 'file').state === 'ok' && st(l, 'size').state === 'ok' && /7\.0MB \/ 20MB/.test(st(l, 'size').hint), '7MB ePub → 파일 ok · 20MB 한도 ok');
  l = RG.checklist('ebook', { ...base, outputs: [{ kind: 'epub', name: 'big.epub', bytes: 21 * 1048576 }] });
  ok(st(l, 'size').state === 'todo' && /20MB 초과/.test(st(l, 'size').hint), '판별: 21MB → 한도 초과 todo');
  const ep = [{ kind: 'epub', name: 'a.epub', bytes: 1e6 }];
  ok(st(RG.checklist('ebook', { ...base, outputs: ep, epubCheck: { ok: true, nFatal: 0, nError: 0, nWarning: 0, epubVersion: '2.0.1', version: '5.4' } }), 'valid').state === 'ok', 'EPUBCheck 통과 → ok');
  ok(st(RG.checklist('ebook', { ...base, outputs: ep, epubCheck: { ok: false, nFatal: 0, nError: 2, nWarning: 0 } }), 'valid').state === 'todo', '오류 있음 → todo');
  ok(st(RG.checklist('ebook', { ...base, outputs: ep, epubCheck: { missing: true } }), 'valid').state === 'manual', '도구 없는 PC → manual(막지 않는다)');
  ok(![...l.required, ...l.optional].some((i) => /작가와/.test(i.label + i.hint)), '전자책 점검표에 작가와 문구 없음');
  ok(!RG.summary('ebook', { meta: { title: 'T', ebookPrice: '3000' } }).some(([k]) => /판매가|ISBN/.test(k)) && !['price', 'ebookIsbn'].some((id) => RG.checklist('ebook', base).required.concat(RG.checklist('ebook', base).optional).some((i) => i.id === id)), '가격·ISBN 은 부크크 업로드 과정에서 정하므로 점검표·복사값에 없다');
  ok(RG.LINKS.ebook.every(([, u]) => /bookk\.co\.kr/.test(u)), '링크는 부크크');
  console.log('\n[2] 각주 점검');
  const b = parseBookText('# t\n## 제1회 a\n본문[^1] 또[^2] 또[^9]\n\n[^1]: 하나\n[^1]: 둘\n[^2]: 셋\n[^7]: 안씀\n', 'x');
  const fx = F.footnoteIssues(b);
  ok(fx.dups.join() === '1' && fx.undefinedRefs.join() === '9' && fx.unused.join() === '7', `중복 1 · 정의 없는 참조 9 · 미사용 7 (${JSON.stringify([fx.dups, fx.undefinedRefs, fx.unused])})`);
  ok(F.warnings(fx).length === 3, '경고 문장 3개');
  const clean = F.footnoteIssues(parseBookText('# t\n## 제1회 a\n본문[^1][^2]\n\n[^1]: 하나\n[^2]: 둘\n', 'x'));
  ok(!clean.dups.length && !clean.undefinedRefs.length && !clean.unused.length, '판별: 깨끗한 원고는 경고 없음');
  console.log('\n[3] EPUBCheck (도구가 있는 PC 만)');
  const tools = EC.findTools();
  if (!tools) console.log('  (EPUBCheck 도구 없음 — 건너뜀)');
  else {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-'));
    const o = path.join(T, 'x.epub');
    await buildEpub(parseBookText('# 시험\n> 저자: 나\n\n## 제1회 가\n본문[^1]입니다.\n\n> 인용\n\n[^1]: 각주\n', 'x'), { outPath: o, embedFonts: 'none' });
    const r = await EC.runEpubCheck(o);
    ok(r.ok && r.epubVersion === '2.0.1' && r.nError === 0 && r.nFatal === 0, `우리 ePub: EPUB ${r.epubVersion} 오류 ${r.nError} 치명 ${r.nFatal} 경고 ${r.nWarning}`);
    // 판별력: 일부러 망가뜨린 ePub 은 오류로 잡힌다(OPF 의 매니페스트 항목 파일을 지움)
    const AdmZip = require('adm-zip'); const z = new AdmZip(o); z.deleteFile('OEBPS/style.css'); const bad = path.join(T, 'bad.epub');
    // adm-zip 재기록은 mimetype 순서를 못 지키니 판별용 파일로만 쓴다
    z.writeZip(bad);
    const rb = await EC.runEpubCheck(bad);
    ok(!rb.ok || rb.nError + rb.nFatal > 0, `판별: 망가뜨린 ePub 은 오류로 잡힌다 (오류 ${rb.nError} · 치명 ${rb.nFatal})`);
    fs.rmSync(T, { recursive: true, force: true });
  }
  console.log(`\n${fail ? '❌' : '✅'} book-ebook-guide — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
