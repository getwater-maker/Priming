'use strict';
/**
 * node test/book-colophon.smoke.js — R19 판권지: `> 판권위치: 앞|뒤` · `> 판권정렬: 하단|상단` 을 실조판(mupdf)으로 잰다.
 *   · 앞: 속표지 뒷면(둘째 비는 쪽) · 뒤: 책 맨 끝 · 하단 정렬: 마지막 줄이 판면 아래끝에 붙는다 · 상단: 판면 위에서 시작
 *   · 판권 쪽에는 머리글·쪽번호가 없다 · 앞으로 옮겨도 본문 첫 쪽·목차 쪽번호는 그대로(총 쪽수는 뒤 판권 때문에 생기던 빈 쪽만큼 줄 수 있다)
 */
const fs = require('fs'), path = require('path');
const { pathToFileURL } = require('url');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildBookHtml } = require('../core/book/html-builder');
const { buildInteriorPdf, prepareWorkAssets } = require('../core/book/pdf-builder');
const OUT = path.join(__dirname, '..', 'output', '_book-colophon');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const MM = 72 / 25.4;
const para = '조식은 붓을 들어 이렇게 적었다. 천하의 일은 합쳐지면 나뉘고 나뉘면 다시 합쳐진다는 말이 있다.';
const md = (extra) => `# 삼국지연의 완역 1\n> 저자: 나관중\n> 출판사: 고전서재\n> 판형: A5\n> 발행일: 2026-10-01\n> ISBN: 979-11-000-0000-0\n> 머리글홀수: 제N회\n${extra || ''}\n## [목차]\n\n## 제1회 첫째\n${(para + '\n\n').repeat(20)}\n## 제2회 둘째\n${(para + '\n\n').repeat(20)}\n## [판권]\n\n이 책의 내용 중 전부 또는 일부를 허락 없이 복제할 수 없습니다.\n`;
async function build(name, text) {
  const book = parseBookText(text, name);
  const workDir = path.join(OUT, name + '_work'); const as = prepareWorkAssets(workDir);
  const { html } = buildBookHtml(book, { imageUrl: as.imageUrl, fontCss: as.fontCss });
  const pdf = path.join(OUT, name + '.pdf');
  const r = await buildInteriorPdf({ html, outPdf: pdf, workDir, log: () => {} });
  if (!r.success) throw new Error(name + ' 빌드 실패: ' + r.error);
  const mu = await import(pathToFileURL(path.join(__dirname, '..', 'node_modules', 'mupdf', 'dist', 'mupdf.js')).href);
  const doc = mu.Document.openDocument(fs.readFileSync(pdf), 'application/pdf');
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const p = doc.loadPage(i); const st = p.toStructuredText('preserve-whitespace');
    const lines = []; let c;
    st.walk({ beginLine(b) { c = { y0: b[1] / MM, y1: b[3] / MM, t: '' }; }, onChar(ch) { c.t += ch; }, endLine() { lines.push(c); } });
    pages.push({ n: i + 1, lines, text: lines.map((l) => l.t).join(' ') });
  }
  return pages;
}
const isCp = (p) => /이 책의 내용 중 전부 또는 일부를/.test(p.text);
(async () => {
  const T = await build('top_back', md('> 판권정렬: 상단\n'));
  const DD = await build('default_back', md(''));
  const BB = await build('bottom_back', md('> 판권정렬: 하단\n'));
  const FB = await build('bottom_front', md('> 판권위치: 앞\n> 판권정렬: 하단\n'));
  const FT = await build('top_front', md('> 판권위치: 앞\n> 판권정렬: 상단\n'));
  const cp = (P) => P.find(isCp);
  console.log('\n[1] 위치');
  ok(cp(T).n === T.length, `뒤(기본): 판권이 마지막 쪽(p${cp(T).n}/${T.length})`);
  ok(cp(FB).n <= 5 && cp(FB).n < FB.length - 5, `앞: 판권이 책 앞쪽(p${cp(FB).n})`);
  ok(/삼국지연의 완역 1/.test(FB[2].text) && cp(FB).n === 4, '앞: 속표지(p3) 뒷면 p4');
  console.log('\n[2] 정렬(판면 아래끝 = 쪽 높이 210 − 아래 여백 15 = 195mm)');
  const lastY = (p) => p.lines[p.lines.length - 1].y1;
  ok(cp(T).lines[0].y0 < 25, `상단: 첫 줄이 판면 위(${cp(T).lines[0].y0.toFixed(0)}mm)`);
  ok(lastY(cp(DD)) > 188 && lastY(cp(DD)) <= 196, `기본(메타 없음) = 하단: 마지막 줄 ${lastY(cp(DD)).toFixed(0)}mm`);
  ok(lastY(cp(BB)) > 188 && lastY(cp(BB)) <= 196, `하단(뒤): 마지막 줄 ${lastY(cp(BB)).toFixed(0)}mm ≈ 판면 아래끝 195mm`);
  ok(lastY(cp(FB)) > 188 && lastY(cp(FB)) <= 196, `하단(앞): 마지막 줄 ${lastY(cp(FB)).toFixed(0)}mm ≈ 195mm`);
  ok(lastY(cp(T)) < 150, `판별: 상단 정렬의 마지막 줄은 한참 위(${lastY(cp(T)).toFixed(0)}mm)`);
  ok(cp(FT).lines[0].y0 < 25 && lastY(cp(FT)) < 150, '앞+상단: 위에서 시작');
  console.log('\n[3] 머리글·쪽번호 없음 · 본문 쪽 유지');
  for (const [nm, P] of [['뒤·하단', BB], ['앞·하단', FB], ['앞·상단', FT]]) {
    const q = cp(P);
    ok(!q.lines.some((l) => l.y0 < 18) && !q.lines.some((l) => l.y0 > 197), `${nm}: 판권 쪽에 머리글(위)·쪽번호(아래) 줄이 없다`);
  }
  const chPage = (P, re) => P.find((p) => re.test(p.text) && /제\s*1\s*회/.test(p.text) && p.n > 4);
  const first1 = (P) => P.findIndex((p, i) => i > 3 && /^제\s*1\s*회/.test(p.lines[0] ? p.lines[0].t.trim() : '') || (i > 3 && /제1회/.test(p.text) && !/목차/.test(p.text) && p.lines.length > 5));
  console.log(`    쪽수: 뒤 ${T.length} · 앞 ${FB.length}  /  본문 1회 시작쪽: 뒤 p${first1(T) + 1} · 앞 p${first1(FB) + 1}`);
  ok(Math.abs((first1(T)) - (first1(FB))) <= 1, '앞으로 옮겨도 본문 시작 쪽은 ±1쪽(홀짝 규칙으로 빈 쪽이 하나 줄 수 있음)');
  ok(FB.length <= T.length, `총 쪽수는 늘지 않는다(뒤 ${T.length} → 앞 ${FB.length})`);
  console.log('\n[4] 메타');
  ok(parseBookText(md('> 판권정렬: 하단\n'), 'x').meta.colophonAlignMeta === '하단', '메타 판권정렬');
  console.log(`\n${fail ? '❌' : '✅'} book-colophon — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
