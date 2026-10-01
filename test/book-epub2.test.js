'use strict';
/**
 * node test/book-epub2.test.js — 부크크 전자책: EPUB 2.0 구조 검증(EPUBCheck 가 없는 PC 용 자체 점검) + 용량(글꼴 동봉 유무).
 *   ① 컨테이너: mimetype 첫 엔트리·무압축 ② OPF 2.0 + toc.ncx(nav.xhtml·dcterms 없음) ③ 매니페스트↔파일↔spine↔NCX 일치
 *   ④ 내용 문서: XML 잘 짜임(python minidom) · HTML5 요소(section·aside·nav·figure·header…)·epub:type 없음 · blockquote 는 p 만 품음
 *   ⑤ 글꼴 동봉(기본) / 'none' · 3.0 옵션은 예전 구조. ⚠ 진짜 EPUBCheck(Java)는 이 PC 에 없다 — 아래 점검은 그 일부(구조·요소)만 대신한다.
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildEpub } = require('../core/book/epub-builder');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ep2-'));
const MD = `# 시험 책
> 저자: 나관중
> 출판사: 고전서재
> 특별섹션: 역사 노트

## [서문]

서문 글입니다.

## 1부. 도원결의

## 제1회 복숭아밭 잔치에서
> 짧은제목: 도원결의

본문 첫 문단입니다.[^1] 두 번째 문장 **굵게** 와 *기울임* 그리고 \`code\`.

> 인용문 한 줄

### 역사 노트

노트 안의 글입니다.

| 칸A | 칸B |
|---|---|
| 1 | 2 |

- 목록 하나
- 목록 둘

---

槳 傕 慎 한자 문장.

[^1]: 각주 본문입니다.

## 제2회 두 번째

둘째 회 본문.

## [판권]

판권 글.
`;
const book = () => parseBookText(MD, 'x');
const py = (file) => {
  const code = 'import sys,xml.dom.minidom as m\ntry:\n  m.parse(sys.argv[1]);print("OK")\nexcept Exception as e:\n  print("ERR",e)';
  return spawnSync('python', ['-c', code, file], { encoding: 'utf8' }).stdout.trim();
};
(async () => {
  console.log('\n[1] EPUB 2.0 (기본 · 글꼴 동봉)');
  const o2 = path.join(T, 'v2.epub');
  const r = await buildEpub(book(), { outPath: o2 });
  ok(r.success, '빌드 성공');
  const z = new AdmZip(o2); const ents = z.getEntries(); const names = ents.map((e) => e.entryName);
  ok(ents[0].entryName === 'mimetype' && ents[0].header.method === 0 && z.readAsText('mimetype') === 'application/epub+zip', 'mimetype 첫 엔트리 · 무압축 · 내용 정확');
  const opf = z.readAsText('OEBPS/content.opf');
  ok(/<package [^>]*version="2\.0"/.test(opf), 'OPF version 2.0');
  ok(!/dcterms|properties=|xml:lang="ko">\s*\n\s*<metadata/.test(opf), 'OPF 에 3.0 전용(dcterms·properties) 없음');
  ok(/<spine toc="ncx">/.test(opf) && /<item id="ncx" href="toc\.ncx" media-type="application\/x-dtbncx\+xml"\/>/.test(opf), 'spine toc="ncx" + NCX 항목');
  ok(!names.includes('OEBPS/nav.xhtml'), 'nav.xhtml 없음');
  const hrefs = [...opf.matchAll(/<item id="([^"]+)" href="([^"]+)"/g)].map((m) => ({ id: m[1], href: m[2] }));
  ok(hrefs.every((h) => names.includes('OEBPS/' + h.href)), `매니페스트 ${hrefs.length}개 항목이 전부 압축 안에 있다`);
  const ids = hrefs.map((h) => h.id);
  ok(new Set(ids).size === ids.length, '매니페스트 id 중복 없음');
  const idrefs = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1]);
  ok(idrefs.length > 3 && idrefs.every((i) => ids.includes(i)), `spine ${idrefs.length}개 idref 가 전부 매니페스트에 있다`);
  const ncx = z.readAsText('OEBPS/toc.ncx');
  const srcs = [...ncx.matchAll(/<content src="([^"]+)"/g)].map((m) => m[1]);
  ok(srcs.length >= 4 && srcs.every((s) => hrefs.some((h) => h.href === s)), `NCX navPoint ${srcs.length}개가 전부 매니페스트 문서를 가리킨다`);
  const po = [...ncx.matchAll(/playOrder="(\d+)"/g)].map((m) => Number(m[1]));
  ok(po.every((n, i) => n === i + 1), 'playOrder 1..N 연속');
  ok(/<meta name="dtb:uid" content="([^"]+)"/.exec(ncx)[1] === /<dc:identifier id="uid">([^<]+)</.exec(opf)[1], 'NCX dtb:uid = OPF identifier');
  console.log('\n[2] 내용 문서 — XML·XHTML 1.1 요소');
  const xh = names.filter((n) => /\.xhtml$/.test(n));
  let badXml = 0, badEl = 0, badBq = 0, badType = 0;
  for (const n of xh) {
    const f = path.join(T, path.basename(n)); fs.writeFileSync(f, z.readAsText(n));
    if (py(f) !== 'OK') { badXml++; console.log('    XML 오류', n, py(f)); }
    const t = z.readAsText(n);
    if (/<(section|aside|nav|figure|figcaption|header|footer|article|mark|time)\b/.test(t)) badEl++;
    if (/epub:type|xmlns:epub/.test(t)) badType++;
    for (const m of t.matchAll(/<blockquote>([\s\S]*?)<\/blockquote>/g)) if (!/^<p>[\s\S]*<\/p>$/.test(m[1])) badBq++;
  }
  ok(xh.length >= 6 && badXml === 0, `내용 문서 ${xh.length}개 모두 XML 잘 짜임`);
  ok(badEl === 0, 'HTML5 요소(section·aside·nav·figure…) 없음');
  ok(badType === 0, 'epub:type·epub 네임스페이스 없음');
  ok(badBq === 0, 'blockquote 는 p 로 감싼다');
  ok(xh.every((n) => /DTD XHTML 1\.1/.test(z.readAsText(n)) && !/<meta charset/.test(z.readAsText(n))), 'XHTML 1.1 DOCTYPE · meta http-equiv(meta charset 아님)');
  const ch1 = z.readAsText('OEBPS/ch-001.xhtml');
  ok(/class="fn" id="fn-1"/.test(ch1) && /href="#fn-1"/.test(ch1), '각주: 본문 링크 ↔ 장 끝 div#fn-1');
  ok(/class="special-sec"/.test(ch1) && /<table class="md-table">/.test(ch1) && /class="md-list"/.test(ch1) && /槳 傕 慎/.test(ch1), '특별 섹션 · 표 · 목록 · 한자 보존');
  console.log('\n[3] 글꼴 동봉 · 용량');
  ok(names.includes('OEBPS/fonts/HanjaSerif-Light.ttf') && names.includes('OEBPS/fonts/NotoSerifKR-Light.ttf'), '기본: 한자 글꼴 2종 동봉');
  const css = z.readAsText('OEBPS/style.css');
  ok(/@font-face \{ font-family: "Priming Hanja Serif"; src: url\(fonts\/HanjaSerif-Light\.ttf\)/.test(css) && /body \{ font-family: "Priming Hanja Serif", "Noto Serif KR", serif; \}/.test(css), 'CSS: @font-face + 본문 글꼴 목록(글자 단위 폴백)');
  const sizeMB = fs.statSync(o2).size / 1048576;
  console.log(`    글꼴 동봉 EPUB ${sizeMB.toFixed(2)}MB`);
  ok(sizeMB < 20, `20MB 한도 안(글꼴 포함 ${sizeMB.toFixed(2)}MB — 본문 13회 + 표지 ≈1MB 를 더해도 여유)`);
  const oN = path.join(T, 'none.epub');
  await buildEpub(book(), { outPath: oN, embedFonts: 'none' });
  const zN = new AdmZip(oN);
  ok(!zN.getEntries().some((e) => /fonts\//.test(e.entryName)) && !/@font-face/.test(zN.readAsText('OEBPS/style.css')), "embedFonts:'none' → 글꼴·@font-face 없음");
  ok(fs.statSync(oN).size < fs.statSync(o2).size / 10, '판별: 글꼴 미동봉은 훨씬 작다');
  console.log('\n[4] EPUB 3.0 옵션은 예전 구조');
  const o3 = path.join(T, 'v3.epub');
  await buildEpub(book(), { outPath: o3, epubVersion: '3' });
  const z3 = new AdmZip(o3);
  ok(/version="3\.0"/.test(z3.readAsText('OEBPS/content.opf')) && z3.getEntry('OEBPS/nav.xhtml') && !z3.getEntry('OEBPS/toc.ncx') && /<section/.test(z3.readAsText('OEBPS/ch-001.xhtml')), "epubVersion:'3' → OPF 3.0 · nav.xhtml · section");
  fs.rmSync(T, { recursive: true, force: true });
  console.log(`\n${fail ? '❌' : '✅'} book-epub2 — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
