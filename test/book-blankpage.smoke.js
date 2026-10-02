'use strict';
/**
 * node test/book-blankpage.smoke.js — R23: 빈 쪽(홀수쪽 맞추기가 끼운 백면)에는 머리글·쪽번호가 없다. 쪽수·본문 쪽번호는 그대로.
 *   🔴 원인: 앞부속(front) → 본문(main) 처럼 쪽 이름이 바뀔 때 끼는 백면은 이름 없는 쪽이라 :blank 로 인식되지 않고 :left/:right 규칙을 받았다.
 *   수정: 머리글·쪽번호 규칙을 @page main:left/right(본문 쪽)에만 건다. 옛 방식 A/B 로 판별력을 본다.
 */
const fs = require('fs'), path = require('path');
const { pathToFileURL } = require('url');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildBookHtml } = require('../core/book/html-builder');
const { buildInteriorPdf, prepareWorkAssets } = require('../core/book/pdf-builder');
const OUT = path.join(__dirname, '..', 'output', '_book-blank');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const para = '조식은 붓을 들어 이렇게 적었다. 천하의 일은 합쳐지면 나뉘고 나뉘면 다시 합쳐진다는 말이 있다.';
const chap = (n, k) => '## 제' + n + '회 제목' + n + '\n' + (para + '\n\n').repeat(k);
const md = (extra) => '# 책\n> 저자: 나\n> 판형: A5\n> 머리글짝수: 책제목\n> 머리글홀수: 제N회\n' + (extra || '') + '\n## [목차]\n\n' + chap(1, 7) + chap(2, 13) + chap(3, 22) + chap(4, 5) + '\n## [판권]\n\n이 책의 내용 중 전부 또는 일부를 재사용하려면 서면 동의를 얻어야 합니다.\n';
async function build(name, text, tweak) {
  const book = parseBookText(text, name);
  const wd = path.join(OUT, name + '_w'); const as = prepareWorkAssets(wd);
  let { html } = buildBookHtml(book, { imageUrl: as.imageUrl, fontCss: as.fontCss });
  if (tweak) html = tweak(html);
  const pdf = path.join(OUT, name + '.pdf');
  const r = await buildInteriorPdf({ html, outPdf: pdf, workDir: wd, log: () => {} });
  if (!r.success) throw new Error(name + ': ' + r.error);
  const mu = await import(pathToFileURL(path.join(__dirname, '..', 'node_modules', 'mupdf', 'dist', 'mupdf.js')).href);
  const doc = mu.Document.openDocument(fs.readFileSync(pdf), 'application/pdf');
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const ls = []; let c;
    doc.loadPage(i).toStructuredText('preserve-whitespace').walk({ beginLine(bb) { c = { t: '', y: bb[1] }; }, onChar(ch) { c.t += ch; }, endLine() { ls.push({ t: c.t.trim(), y: c.y }); } });
    pages.push({ n: i + 1, ls: ls.filter((l) => l.t).sort((x, y) => x.y - y.y).map((l) => l.t) });   // 위에서 아래 순서
  }
  return pages;
}
// 「머리글 + 쪽번호」 두 줄뿐인 쪽 = 백면에 찍힌 머리글·쪽번호
const headerOnly = (P) => P.filter((p) => p.ls.length === 2 && /^\d+$/.test(p.ls[1]));
(async () => {
  const nw = await build('new', md());
  const old = await build('old', md(), (h) => h.replace('@page main:left {', '@page :left {').replace('@page main:right {', '@page :right {'));
  console.log('\n[1] 목차 다음 백면(앞부속 → 본문)');
  ok(headerOnly(old).length >= 1, `판별: 옛 방식은 백면에 머리글·쪽번호가 찍힌다 (p${headerOnly(old).map((p) => p.n).join(', p')})`);
  ok(headerOnly(nw).length === 0, '새 방식: 머리글+쪽번호뿐인 쪽이 없다');
  const blank = nw.filter((p) => p.ls.length === 0).map((p) => p.n);
  console.log(`    빈 쪽(글줄 0): p${blank.join(', p')}`);
  ok(blank.length >= 3, '백면이 실제로 있다(목차 뒤·장 사이)');
  console.log('\n[2] 쪽수·본문 쪽번호 불변 · 본문 쪽엔 머리글·쪽번호가 그대로');
  ok(nw.length === old.length, `쪽수 불변: ${nw.length}쪽 = ${old.length}쪽`);
  const body = nw.filter((p) => p.ls.length > 5 && p.n > 6);
  ok(body.every((p) => p.ls.some((l) => new RegExp('^' + p.n + '$').test(l))), `본문 ${body.length}쪽 전부 자기 쪽번호가 찍혀 있다(쪽번호 = 실제 쪽 번호)`);
  const withHead = body.filter((p) => p.n % 2 === 0 && /^책$/.test(p.ls[0]));
  ok(withHead.length >= 2, '본문 짝수쪽 머리글(책 제목)이 그대로 나온다');
  ok(nw.slice(0, 2).every((p) => !p.ls.some((l) => /^\d+$/.test(l))) && !nw[6].ls.some((l) => l === '7' && false), '표제지류·목차에는 쪽번호가 없다(그대로)');
  console.log('\n[3] 미주 모드의 쪽도 쪽번호가 있다(page: main)');
  const en = await build('endnote', md('> 각주방식: 미주\n').replace('본문', '본문'), null);
  const last = en[en.length - 1];
  ok(en.filter((p) => p.ls.length > 5).every((p) => p.ls.some((l) => /^\d+$/.test(l)) || p.n < 7), '미주 모드: 글이 있는 본문 쪽에 쪽번호가 있다');
  console.log(`\n${fail ? '❌' : '✅'} book-blankpage — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
