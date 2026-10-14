'use strict';
// 📁 완성 폴더 하위 구조(로이 2026-10-14) — core/book/out-layout.js
const fs = require('fs'); const os = require('os'); const path = require('path');
const OL = require('../core/book/out-layout');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗ ' + m); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'outlayout-'));
const root = path.join(tmp, '작품', '완성');   // 이름이 「완성」 이어야 새 구조
fs.mkdirSync(root, { recursive: true });
const B = '001_삼국지_제3권';
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

ok(OL.isLayout(root) && !OL.isLayout(path.join(tmp, '출판', '책')), '완성 폴더만 새 구조');
ok(rel(OL.outPath(root, 'print', 'full', B)) === `종이책/01_완성본/[종이책] ${B}_완성.pdf`, '종이책 완성본 = _완성.pdf');
ok(rel(OL.outPath(root, 'print', 'cover', B)) === `종이책/02_표지/[종이책] ${B}_표지.pdf`, '종이책 표지');
ok(rel(OL.outPath(root, 'print', 'interior', B)) === `종이책/03_내지/[종이책] ${B}_내지.pdf`, '종이책 내지');
ok(rel(OL.outPath(root, 'ebook', 'full', B)) === `전자책/01_완성본/[전자책] ${B}_완성.pdf`, '전자책 완성본');
ok(rel(OL.outPath(root, 'ebook', 'cover', B)) === `전자책/02_표지/[전자책] ${B}_표지.pdf`, '전자책 표지');
ok(rel(OL.outPath(root, 'ebook', 'body', B)) === `전자책/03_내지/[전자책] ${B}_본문.pdf`, '전자책 본문 → 03_내지');
ok(rel(OL.outPath(root, 'ebook', 'epub', B)) === `전자책/04_epub/[전자책] ${B}_완성.epub`, 'epub → 04_epub · _완성.epub');
ok(fs.existsSync(path.join(root, '전자책', '04_epub')) && fs.existsSync(path.join(root, '종이책', '03_내지')), '폴더는 만들어 둔다');

// 평면(완성이 아닌 곳)은 옛 이름 그대로
const flat = path.join(tmp, '출판', '책'); fs.mkdirSync(flat, { recursive: true });
ok(path.basename(OL.outPath(flat, 'print', 'full', 'x')) === '[종이책] x_표지+내지.pdf' && path.dirname(OL.outPath(flat, 'ebook', 'epub', 'x')) === flat, '평면은 옛 이름·옛 위치');

// 찾기 — 새 위치 우선, 옛 평면도 찾는다
fs.writeFileSync(OL.outPath(root, 'ebook', 'full', B), 'new');
fs.writeFileSync(path.join(root, `[전자책] ${B}_표지+본문.pdf`), 'old');
ok(fs.readFileSync(OL.findOwn(root, 'ebook', 'full', B), 'utf8') === 'new', '새 위치가 먼저');
ok(OL.findOwn(root, 'print', 'full', B) === '', '없으면 빈 문자열');
fs.writeFileSync(path.join(root, `[종이책] ${B}_내지.pdf`), 'oldint');
ok(OL.findOwn(root, 'print', 'interior', B).endsWith(`[종이책] ${B}_내지.pdf`), '옛 평면 파일도 찾는다');

// 목록 — 새 하위 폴더 + 평면
const names = OL.listAll(root).map((p) => path.basename(p));
ok(names.includes(`[전자책] ${B}_완성.pdf`) && names.includes(`[전자책] ${B}_표지+본문.pdf`), '목록: 새 위치 + 평면 모두');

// 옛 평면 정리 — 방금 만든 종류만, 다른 권은 건드리지 않는다
fs.writeFileSync(path.join(root, `[전자책] ${B}.epub`), 'oldepub');
fs.writeFileSync(path.join(root, `[전자책] 001_삼국지_제4권_표지+본문.pdf`), 'other');
const gone = OL.removeLegacy(root, 'ebook', B, ['body', 'cover', 'full']);
ok(gone.length === 1 && !fs.existsSync(path.join(root, `[전자책] ${B}_표지+본문.pdf`)), '옛 표지+본문 평면 파일 삭제');
ok(fs.existsSync(path.join(root, `[전자책] ${B}.epub`)), 'epub 은 PDF 정리에서 안 지운다');
ok(fs.existsSync(path.join(root, `[전자책] 001_삼국지_제4권_표지+본문.pdf`)), '다른 권은 그대로');
ok(OL.removeLegacy(root, 'ebook', B, ['epub']).length === 1, 'epub 정리');
ok(OL.removeLegacy(flat, 'print', 'x').length === 0, '평면 구조에선 지우지 않는다');
// 두 번째 만들기 = 같은 경로 덮어쓰기 → 첫 번째 파일은 남지 않는다
const p1 = OL.outPath(root, 'print', 'full', B); fs.writeFileSync(p1, 'pass1'); fs.writeFileSync(OL.outPath(root, 'print', 'full', B), 'pass2');
ok(fs.readFileSync(p1, 'utf8') === 'pass2' && fs.readdirSync(path.dirname(p1)).length === 1, '재생성하면 한 파일만 남는다');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`book-outlayout: ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
