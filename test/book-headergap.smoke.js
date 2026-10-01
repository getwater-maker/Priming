'use strict';
/**
 * node test/book-headergap.smoke.js — R17 머리글 ↔ 본문 구분(삼국지): 간격·크기·색을 실조판 PDF(mupdf)로 잰다.
 *   · 머리글 글자 아래끝 ↔ 본문 첫 줄 윗끝 간격이 기본 약 7mm(옛 방식은 한 줄 남짓)
 *   · 머리글은 본문보다 작고 회색(≥ 검정 50%) · 재단선에서 7mm 이상 안쪽
 *   · 본문 영역 높이는 그대로 → 쪽수 불변(옛 방식과 같은 쪽수)
 *   · 원고 메타 `> 머리글간격: 6` 이 이긴다 · 윗여백이 작으면 안전영역 안으로 자동 제한
 */
const fs = require('fs'), path = require('path');
const { pathToFileURL } = require('url');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildBookHtml, headerGapOf } = require('../core/book/html-builder');
const { buildInteriorPdf, prepareWorkAssets } = require('../core/book/pdf-builder');
const OUT = path.join(__dirname, '..', 'output', '_book-hgap');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const MM = 72 / 25.4;
const para = '조식은 붓을 들어 이렇게 적었다. 천하의 일은 합쳐지면 나뉘고 나뉘면 다시 합쳐진다는 말이 있다.';
const md = (extra) => `# 삼국지연의 완역 1\n> 저자: 나관중\n> 출판사: 고전서재\n> 판형: A5\n${extra || ''}\n## [목차]\n\n## 1부. 도원결의\n\n## 제1회 복숭아밭 잔치\n${(para + '\n\n').repeat(60)}\n## 제2회 독우를 매질하다\n${(para + '\n\n').repeat(20)}`;
async function build(name, text, { tweak, opts } = {}) {
  const book = parseBookText(text, name);
  const workDir = path.join(OUT, name + '_work');
  const assets = prepareWorkAssets(workDir);
  let { html } = buildBookHtml(book, { imageUrl: assets.imageUrl, fontCss: assets.fontCss, ...(opts || {}) });
  if (tweak) html = tweak(html);
  const pdf = path.join(OUT, name + '.pdf');
  const r = await buildInteriorPdf({ html, outPdf: pdf, workDir, log: () => {} });
  if (!r.success) throw new Error(name + ' 빌드 실패: ' + r.error);
  const mu = await import(pathToFileURL(path.join(__dirname, '..', 'node_modules', 'mupdf', 'dist', 'mupdf.js')).href);
  const doc = mu.Document.openDocument(fs.readFileSync(pdf), 'application/pdf');
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const st = doc.loadPage(i).toStructuredText('preserve-whitespace');
    const lines = []; let cur = null;
    st.walk({
      beginLine(b) { cur = { y0: b[1], y1: b[3], t: '', size: 0 }; },
      onChar(c, o, font, size) { cur.t += c; cur.size = Math.max(cur.size, size); },
      endLine() { lines.push(cur); cur = null; },
    });
    pages.push({ n: i + 1, lines });
  }
  return { pages, html };
}
// 머리글이 있는 본문 쪽(장 시작 쪽 제외): 위쪽 20mm 안의 줄 = 머리글, 그 아래 첫 줄 = 본문 첫 줄
function measure(pages) {
  for (const p of pages) {
    if (p.n < 4) continue;
    const head = p.lines.find((l) => l.y0 < 20 * MM && /제\s*1\s*회|삼국지연의/.test(l.t));
    const body = head && p.lines.filter((l) => l.y0 >= head.y1 - 1 && l !== head && l.t.trim().length > 8)[0];
    if (head && body) return { page: p.n, head, body, gapMm: (body.y0 - head.y1) / MM, headTopMm: head.y0 / MM };
  }
  return null;
}
(async () => {
  console.log('\n[1] 순수 계산');
  ok(headerGapOf('', 0, 20) === 7, '기본 7mm (R22 — 머리글 윗끝이 재단선에서 8.5mm 이상)');
  ok(headerGapOf('6', 0, 20) === 6 && headerGapOf('6mm', 0, 20) === 6, '메타 6 / 6mm');
  ok(headerGapOf('15', 0, 20) === 7.3, '윗여백 20mm → 최대 7.3mm 로 제한(머리글 윗끝 ≥ 8.5mm)');
  ok(headerGapOf('9', 0, 14) === 1.3, '윗여백이 작으면 더 줄인다');
  console.log('\n[2] 실조판 — 새 방식 vs 옛 방식(padding 제거 + 9pt·#ccc 선, A/B)');
  const nw = await build('new', md());
  const old = await build('old', md(), { tweak: (h) => h.replace(/padding-bottom: [0-9.]+mm;/g, 'margin-bottom: 7pt;') });
  const a = measure(nw.pages), b = measure(old.pages);
  ok(a && b, '머리글·본문 줄을 찾음(새 p' + (a && a.page) + ' · 옛 p' + (b && b.page) + ')');
  if (a && b) {
    console.log(`    새 간격 ${a.gapMm.toFixed(1)}mm · 옛 ${b.gapMm.toFixed(1)}mm · 머리글 윗끝 ${a.headTopMm.toFixed(1)}mm`);
    ok(a.gapMm >= 6.5 && a.gapMm <= 7.5, `새 방식: 머리글 ↔ 본문 첫 줄 ${a.gapMm.toFixed(1)}mm (기본 7 · 글줄 상자 기준)`);
    ok(a.gapMm - b.gapMm >= 4, `판별력: 옛 방식(${b.gapMm.toFixed(1)}mm)보다 4mm 이상 넓다`);
    ok(a.headTopMm >= 8.5, `머리글 윗끝이 재단선에서 ${a.headTopMm.toFixed(1)}mm (≥ 8.5mm — 부크크 규격체크 권장 여백 6.7 + 여유)`);
    ok(a.head.size < a.body.size, `머리글 글자(${a.head.size.toFixed(1)}pt)가 본문(${a.body.size.toFixed(1)}pt)보다 작다`);
  }
  ok(nw.pages.length === old.pages.length, `쪽수 불변: 새 ${nw.pages.length}쪽 = 옛 ${old.pages.length}쪽(본문 영역 높이를 줄이지 않는다)`);
  ok(/color: #595959/.test(nw.html) && new RegExp('font-size: ' + require('../core/book/title-fit').HEADER_PT + 'pt; color: #595959').test(nw.html), '머리글 색 #595959(검정 65%) · 크기는 title-fit 의 HEADER_PT(= 8.5pt)와 같은 값');
  ok(/text-decoration-thickness: 0\.25pt/.test(nw.html) && /text-decoration-color: #666666/.test(nw.html), '머리글 선 0.25pt · #666(흑백에서 사라지지 않는 진하기)');
  console.log('\n[3] 메타 `> 머리글간격:`');
  const m6 = await build('m6', md('> 머리글간격: 6\n'));
  const c = measure(m6.pages);
  ok(c && Math.abs(c.gapMm - (a.gapMm - 1)) < 0.8, `메타 6 → 간격 ${c && c.gapMm.toFixed(1)}mm (기본보다 1mm 좁다)`);
  console.log(`\n${fail ? '❌' : '✅'} book-headergap — ${pass} 통과 / ${fail} 실패  (PDF: output/_book-hgap/*.pdf)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
