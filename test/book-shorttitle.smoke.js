'use strict';
/**
 * node test/book-shorttitle.smoke.js — R18 회 짧은 제목: `> 짧은제목:` → 홀수쪽 머리글 「제N회 짧은제목」 · 목차 · 본문 표제는 전체 회목 그대로.
 *   실조판 PDF 를 mupdf 로 읽어 확인한다. 짧은 제목이 없는 회는 「제N회」만(현재 동작 유지). 쪽수 A/B(짧은 제목 없이 같은 원고)도 잰다.
 */
const fs = require('fs'), path = require('path');
const { pathToFileURL } = require('url');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildBookHtml } = require('../core/book/html-builder');
const { headerKindOf } = require('../core/book/header-kind');
const TF = require('../core/book/title-fit');
const HB = require('../core/book/html-builder');
const { buildInteriorPdf, prepareWorkAssets } = require('../core/book/pdf-builder');
const OUT = path.join(__dirname, '..', 'output', '_book-short');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const para = '조식은 붓을 들어 이렇게 적었다. 천하의 일은 합쳐지면 나뉘고 나뉘면 다시 합쳐진다는 말이 있다.';
const FULL = ['복숭아밭 잔치에서 세 호걸이 의형제를 맺고, 황건적을 베어 영웅이 처음으로 공을 세우다',
  '장익덕이 대노하여 독우를 매질하고, 하진이 환관을 죽이려다 도리어 화를 입다',
  '동탁이 황제를 폐하고 진류왕을 세우며, 조조는 칼을 바쳐 동탁을 찌르려다 도망하다'];
const SHORT = ['도원결의', '독우 매질', null];   // 3회는 짧은 제목 없음
const md = (withShort, extra) => `# 삼국지연의 완역 1\n> 저자: 나관중\n> 판형: A5\n> 머리글짝수: 책제목\n> 머리글홀수: 제N회 짧은제목\n${extra || ''}\n## [목차]\n\n## 1부. 도원결의\n\n${FULL.map((t, i) => `## 제${i + 1}회 ${t}\n${withShort && SHORT[i] ? `> 짧은제목: ${SHORT[i]}\n` : ''}\n${(para + '\n\n').repeat(40)}`).join('\n')}`;
async function build(name, text, opts) {
  const book = parseBookText(text, name);
  const workDir = path.join(OUT, name + '_work');
  const assets = prepareWorkAssets(workDir);
  const { html } = buildBookHtml(book, { imageUrl: assets.imageUrl, fontCss: assets.fontCss, ...(opts || {}) });
  const pdf = path.join(OUT, name + '.pdf');
  const r = await buildInteriorPdf({ html, outPdf: pdf, workDir, log: () => {} });
  if (!r.success) throw new Error(name + ' 빌드 실패: ' + r.error);
  const mu = await import(pathToFileURL(path.join(__dirname, '..', 'node_modules', 'mupdf', 'dist', 'mupdf.js')).href);
  const doc = mu.Document.openDocument(fs.readFileSync(pdf), 'application/pdf');
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const st = doc.loadPage(i).toStructuredText('preserve-whitespace');
    const lines = []; let cur = null;
    st.walk({ beginLine(b) { cur = { y0: b[1], t: '' }; }, onChar(c) { cur.t += c; }, endLine() { lines.push(cur); cur = null; } });
    pages.push({ n: i + 1, lines, text: lines.map((l) => l.t).join(' ').replace(/\s+/g, ' ').trim() });
  }
  return { book, html, pages };
}
const MM = 72 / 25.4;
const headerOf = (p) => (p.lines.find((l) => l.y0 < 20 * MM && /^제\s*\d+\s*회/.test(l.t.trim())) || {}).t;
(async () => {
  console.log('\n[1] 문법·파서');
  const b = parseBookText(md(true), 'x');
  const chs = b.parts.flatMap((p) => p.chapters);
  ok(chs.length === 3 && chs[0].shortTitle === '도원결의' && chs[1].shortTitle === '독우 매질' && !chs[2].shortTitle, '회마다 shortTitle: 도원결의 · 독우 매질 · (없음)');
  ok(chs[0].blocks.every((x) => !/짧은제목/.test(x.text || '')), '「> 짧은제목:」 줄은 본문 블록에 안 들어간다');
  ok(parseBookText('# t\n## 제1회 가\n> 짧은 제목: 나\n본문\n', 'x').parts[0].chapters[0].shortTitle === '나', '띄어쓴 「짧은 제목」도');
  ok(!parseBookText('# t\n## 제1회 가\n본문입니다\n> 짧은제목: 나\n', 'x').parts[0].chapters[0].shortTitle, '본문이 시작된 뒤의 줄은 짧은 제목이 아니다(인용문 보호)');
  ok(['제N회 짧은제목', '제N회+짧은제목', '짧은제목', 'chapterShort', '「제N회 + 짧은 제목」'].every((v) => headerKindOf(v) === 'chapterShort'), '머리글홀수 값 → chapterShort');
  ok(headerKindOf('제N회') === 'chapterNo', '판별: 「제N회」는 여전히 chapterNo');
  console.log('\n[2] 실조판');
  const A = await build('short', md(true));
  const N = await build('noshort', md(false));
  ok(/<span class="ch-rh-short"[^>]*>제1회 도원결의<\/span>/.test(A.html) && /<span class="ch-rh-short"[^>]*>제3회<\/span>/.test(A.html), '앵커: 제1회 도원결의 · 짧은 제목 없는 3회는 「제3회」만');
  const odd = A.pages.filter((p) => p.n % 2 === 1).map(headerOf).filter(Boolean);
  ok(odd.some((t) => /제1회\s*도원결의/.test(t)) && odd.some((t) => /제2회\s*독우 매질/.test(t)), `홀수쪽 머리글: ${[...new Set(odd)].slice(0, 4).join(' | ')}`);
  ok(odd.some((t) => /^제3회$/.test(t.trim())), '짧은 제목 없는 3회는 「제3회」만(현재 동작 유지)');
  ok(!odd.some((t) => /복숭아밭/.test(t)), '머리글에 전체 회목이 나오지 않는다');
  const tp = A.pages.find((p) => /^목차/.test(p.text));
  ok(tp && /제1회\s*도원결의/.test(tp.text) && /제2회\s*독우 매질/.test(tp.text) && !/복숭아밭/.test(tp.text) && /동탁이 황제를 폐하고/.test(tp.text), '목차: 짧은 제목 · 짧은 제목 없는 3회는 전체 회목');
  ok(A.pages.some((p) => /복숭아밭 잔치에서 세 호걸이/.test(p.text) && /^제\s*1\s*회/.test(p.text.replace(/^[^제]*/, ''))), '본문 회 첫머리는 전체 회목 표제 그대로');
  console.log(`    쪽수: 짧은 제목 ${A.pages.length}쪽 · 없이 ${N.pages.length}쪽`);
  ok(Math.abs(A.pages.length - N.pages.length) <= 1, '쪽수 영향 ±1쪽 이내(목차가 짧아질 뿐 본문은 그대로)');
  const nTocA = A.pages.filter((p) => /^목차/.test(p.text)).length;
  ok(nTocA >= 1, '목차 쪽 있음');
  console.log('\n[3] 목차제목 모드·제목 길이 기준');
  const F = await build('tocfull', md(true, '> 목차제목: 전체\n'));
  const tpf = F.pages.find((p) => /^목차/.test(p.text));
  ok(tpf && /복숭아밭/.test(tpf.text), '`> 목차제목: 전체` → 목차는 전체 회목');
  const o = HB.resolveBookOptions(A.book, {}).o;
  const fit = TF.analyze(A.book, o, path.join(__dirname, '..', 'assets', 'fonts', 'book'));
  ok(fit.items[0].shortTitle === '도원결의' && fit.items[0].chars === 4 && !fit.items[0].flags.includes('header'), '제목 길이 기준: 짧은 제목으로 잰다(머리글 넘침 아님)');
  const o2 = HB.resolveBookOptions(parseBookText(md(true).replace('제N회 짧은제목', '회목'), 'x'), {}).o;
  const fit2 = TF.analyze(parseBookText(md(true).replace('제N회 짧은제목', '회목'), 'x'), o2, path.join(__dirname, '..', 'assets', 'fonts', 'book'));
  ok(fit2.items[0].headerPt > fit.items[0].headerPt, '판별: 전체 회목을 머리글에 쓰면 폭이 훨씬 크다');
  const lim = TF.analyze(parseBookText(md(true, '> 회목최대: 3\n'), 'x'), o, path.join(__dirname, '..', 'assets', 'fonts', 'book'));
  ok(lim.items[0].flags.includes('max'), '회목최대 = 짧은 제목 상한으로도 쓴다(도원결의 4자 > 3)');
  console.log(`\n${fail ? '❌' : '✅'} book-shorttitle — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
