'use strict';
/**
 * node test/book-safearea.smoke.js — R22 부크크 「규격체크」 권장 여백(실측: 위 6.4 · 아래 6.0 · 바깥 6.7 · 제본쪽 11.3mm) 안전영역.
 *   머리글·쪽번호가 재단선에서 8.5mm 이상 안쪽에 놓이는지 실조판 PDF(mupdf)로 잰다 · 본문 영역·쪽수는 그대로 · 옛 방식 A/B.
 */
const fs = require('fs'), path = require('path');
const { pathToFileURL } = require('url');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildBookHtml, pageNumSafeOf, HEADER_SAFE_MM } = require('../core/book/html-builder');
const { buildInteriorPdf, prepareWorkAssets } = require('../core/book/pdf-builder');
const OUT = path.join(__dirname, '..', 'output', '_book-safe');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const MM = 72 / 25.4;
const para = '조식은 붓을 들어 이렇게 적었다. 천하의 일은 합쳐지면 나뉘고 나뉘면 다시 합쳐진다는 말이 있다.[^1]';
const md = (extra) => `# 책\n> 저자: 나\n> 판형: A5\n> 머리글홀수: 제N회\n${extra || ''}\n## [목차]\n\n## 제1회 가\n${(para + '\n\n').repeat(50)}[^1]: 각주입니다.\n`;
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
    const p = doc.loadPage(i); const [x0, y0, x1, y1] = p.getBounds();
    const ls = []; let c;
    p.toStructuredText('preserve-whitespace').walk({ beginLine(b) { c = { b, t: '' }; }, onChar(ch) { c.t += ch; }, endLine() { ls.push(c); } });
    pages.push({ n: i + 1, W: (x1 - x0) / MM, H: (y1 - y0) / MM, ls });
  }
  return pages;
}
function metrics(P) {
  const out = [];
  for (const p of P) {
    if (p.n < 7) continue;
    const head = p.ls.find((l) => l.b[1] / MM < 20 && l.t.trim().length > 0);
    const num = p.ls.filter((l) => /^\s*\d+\s*$/.test(l.t) && l.b[1] / MM > 190).pop();
    if (num) out.push({ n: p.n, headTop: head ? head.b[1] / MM : null, numBottom: p.H - num.b[3] / MM, numOuter: p.n % 2 ? p.W - num.b[2] / MM : num.b[0] / MM, bodyInner: null });
  }
  return out;
}
(async () => {
  console.log('\n[1] 순수 계산');
  ok(HEADER_SAFE_MM === 8.5 && pageNumSafeOf('', 0, 15) === 8.5, '쪽번호 기본 8.5mm');
  ok(pageNumSafeOf('10', 0, 15) === 10 && pageNumSafeOf('12', 0, 15) === 10.2, '메타 10 · 아래 여백 15mm 에서는 최대 10.2mm(본문과 겹치지 않게)');
  console.log('\n[2] 실조판');
  const nw = await build('new', md());
  const old = await build('old', md(), (h) => h.replace(/vertical-align: bottom; padding-bottom: [0-9.]+mm;(?=[^}]*font-weight: 700)/g, '').replace(/ vertical-align: bottom; padding-bottom: 9\.0mm;/g, ''));
  const a = metrics(nw), b = metrics(old);
  ok(a.length >= 4, `측정한 쪽 ${a.length}개`);
  const minHead = Math.min(...a.filter((x) => x.headTop != null).map((x) => x.headTop));
  const minNum = Math.min(...a.map((x) => x.numBottom));
  const minOuter = Math.min(...a.map((x) => x.numOuter));
  console.log(`    머리글 윗끝 최소 ${minHead.toFixed(1)}mm · 쪽번호 바닥 최소 ${minNum.toFixed(1)}mm · 쪽번호 바깥 ${minOuter.toFixed(1)}mm  (옛 방식 쪽번호 바닥 ${Math.min(...b.map((x) => x.numBottom)).toFixed(1)}mm)`);
  ok(minHead >= 8.5, `머리글 윗끝 ≥ 8.5mm (${minHead.toFixed(1)})`);
  ok(minNum >= 8.5, `쪽번호 바닥 ≥ 8.5mm (${minNum.toFixed(1)})`);
  ok(minOuter >= 8.5, `쪽번호 바깥쪽 ≥ 8.5mm (${minOuter.toFixed(1)})`);
  ok(Math.min(...b.map((x) => x.numBottom)) < 6, `판별: 옛 방식 쪽번호는 권장 여백(6mm) 안 — ${Math.min(...b.map((x) => x.numBottom)).toFixed(1)}mm`);
  ok(nw.length === old.length, `쪽수 불변: ${nw.length}쪽 = ${old.length}쪽(본문 영역을 줄이지 않는다)`);
  // 본문·각주가 쪽번호와 겹치지 않는다: 본문(번호가 아닌 줄)의 바닥이 쪽번호 윗끝보다 위
  const p9 = nw.find((p) => p.n === 9);
  const num9 = p9.ls.filter((l) => /^\s*\d+\s*$/.test(l.t) && l.b[1] / MM > 190).pop();
  const bodyBottom = Math.max(...p9.ls.filter((l) => l !== num9).map((l) => l.b[3] / MM));
  ok(num9 && bodyBottom < num9.b[1] / MM, `쪽번호와 본문·각주가 겹치지 않는다(본문 바닥 ${bodyBottom.toFixed(1)}mm < 쪽번호 윗끝 ${(num9.b[1] / MM).toFixed(1)}mm)`);
  console.log('\n[3] 메타 `> 쪽번호안전:`');
  const m10 = metrics(await build('m10', md('> 쪽번호안전: 10\n')));
  ok(Math.abs(Math.min(...m10.map((x) => x.numBottom)) - 10.1) < 0.4, `메타 10 → 쪽번호 바닥 ${Math.min(...m10.map((x) => x.numBottom)).toFixed(1)}mm`);
  console.log(`\n${fail ? '❌' : '✅'} book-safearea — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
