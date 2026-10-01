'use strict';
/**
 * node test/book-linebreak.smoke.js — R18 줄바꿈 방식 A/B 를 실조판 PDF(mupdf)로 잰다.
 *   · 어절(기본) : 띄어쓰기가 평소의 2배를 넘게 벌어진 줄이 많다(대사가 많은 글)
 *   · 절충       : 그런 줄이 크게 줄고, 쪽수는 늘지 않는다(삼국지 1·2권 실측은 쪽수 변동 0)
 *   · 글자       : 간격은 가장 고르다 — 단 마지막 줄에 한 글자만 남는 문단이 없다(끝 두 글자 묶음)
 *   「평소 간격」 = 어절 방식 마지막 줄(늘리지 않은 줄)의 단어 사이 간격(실측 2.32pt).
 */
const fs = require('fs'), path = require('path');
const { pathToFileURL } = require('url');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildBookHtml } = require('../core/book/html-builder');
const { buildInteriorPdf, prepareWorkAssets } = require('../core/book/pdf-builder');
const OUT = path.join(__dirname, '..', 'output', '_book-linebreak');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const NATURAL_GAP = 2.32;   // pt — 삼국지 2권 실측(어절 방식 줄 간격 하위 10%)

const sents = [
  '“제가 철기 3,000을 거느리고 가서 관 아무개를 생포해 승상께 바치겠습니다!” 하고 말하자 조조는 크게 기뻐하며 술을 따라 주었다.',
  '여포는 그렇다고 여겨 이에 두 장수를 기도와 낭야 두 곳에 잠시 주둔시키고 사람을 보내 소식을 알아보게 했다.',
  '그러고는 관저로 돌아가 전투 장비를 챙겼다. 때는 마침 한겨울의 추위라, 시종들에게 솜옷을 많이 지니라고 분부했다.',
  '“천자께서 유비를 숙부로 인정하셨으니, 명공께 이로움이 없을까 걱정됩니다. 신이 보건대 이 일은 서두르실 일이 아닙니다.”',
  '조조가 말했다.', '유비가 간했다.',
];
const para = (i) => sents.slice(0, 2 + (i % 3)).concat(sents[3 + (i % 3)] ? [sents[3 + (i % 3)]] : []).join(' ');
const md = `# 줄바꿈 시험\n> 저자: 갑\n> 출판사: 을\n> 판형: A5\n\n## [목차]\n\n## 제1회 시작\n${Array.from({ length: 70 }, (_, i) => para(i)).join('\n\n')}\n`;

async function build(name, mode) {
  const book = parseBookText(md, name);
  const workDir = path.join(OUT, name + '_work');
  const assets = prepareWorkAssets(workDir);
  const { html } = buildBookHtml(book, { imageUrl: assets.imageUrl, fontCss: assets.fontCss, lineBreak: mode });
  const pdf = path.join(OUT, name + '.pdf');
  const r = await buildInteriorPdf({ html, outPdf: pdf, workDir, log: () => {} });
  if (!r.success) throw new Error(name + ' 빌드 실패: ' + r.error);
  const mu = await import(pathToFileURL(path.join(__dirname, '..', 'node_modules', 'mupdf', 'dist', 'mupdf.js')).href);
  const doc = mu.Document.openDocument(fs.readFileSync(pdf), 'application/pdf');
  let wide = 0, orphan = 0, lines = 0;
  for (let i = 0; i < doc.countPages(); i++) {
    const st = doc.loadPage(i).toStructuredText('preserve-whitespace');
    let cur = null; const ls = [];
    st.walk({
      beginLine() { cur = { t: '', gaps: [], size: 0, prev: null, pend: false }; },
      onChar(c, o, f, size, q) {
        cur.t += c; cur.size = Math.max(cur.size, size);
        if (c === ' ') cur.pend = true;
        else { if (cur.pend && cur.prev) cur.gaps.push(q[0] - cur.prev[2]); cur.pend = false; cur.prev = q; }
      },
      endLine() { ls.push(cur); },
    });
    ls.forEach((l, k) => {
      if (l.size < 9.5 || l.size > 10.5) return;
      if (l.t.trim().length >= 1 && l.t.trim().length <= 2 && k > 0 && ls[k - 1].t.length > 15) orphan++;
      if (l.t.length < 22 || !l.gaps.length) return;
      lines++;
      if (l.gaps.reduce((a, b) => a + b, 0) / l.gaps.length > 2 * NATURAL_GAP) wide++;
    });
  }
  return { pages: doc.countPages(), wide, orphan, lines };
}
(async () => {
  const w = await build('word', 'word'), s = await build('smart', 'smart'), c = await build('char', 'char');
  console.log('    어절', JSON.stringify(w), '\n    절충', JSON.stringify(s), '\n    글자', JSON.stringify(c));
  ok(w.wide >= 15, `판별력: 어절 방식에는 벌어진 줄이 실제로 있다(${w.wide}줄)`);
  ok(s.wide <= w.wide * 0.25, `절충: 벌어진 줄 ${w.wide} → ${s.wide}(1/4 이하)`);
  ok(c.wide <= w.wide * 0.1, `글자: 벌어진 줄 ${w.wide} → ${c.wide}`);
  ok(s.pages <= w.pages, `절충: 쪽수는 늘지 않는다(${w.pages} → ${s.pages} — 글자 단위로 채운 줄만큼 줄 수가 줄 수 있다)`);
  ok(s.orphan === 0 && c.orphan === 0, `마지막 줄 한두 글자 고아 없음(절충 ${s.orphan} · 글자 ${c.orphan} · 어절 ${w.orphan})`);
  console.log(`\n${fail ? '❌' : '✅'} book-linebreak.smoke — ${pass} 통과 / ${fail} 실패  (PDF: output/_book-linebreak/*.pdf)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
