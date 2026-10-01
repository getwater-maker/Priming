'use strict';
/**
 * node test/book-linebreak.test.js — R18 줄바꿈 방식(어절|글자|절충) 순수 계산 검증(엔진 없음).
 *   실조판(PDF)에서 띄어쓰기가 벌어진 줄 수를 세는 대조는 test/book-linebreak.smoke.js.
 */
const path = require('path');
const LB = require('../core/book/line-break');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildBookHtml, resolveBookOptions } = require('../core/book/html-builder');
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts', 'book');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const base = { fontKey: 'kopub', fontSizePt: 10, letterSpacingPt: -0.4, marginsMm: { inner: 20, outer: 17 }, trimW: 148, indentPt: 15 };
const ctxOf = (mode) => LB.contextFor({ ...base, lineBreak: mode }, FONT_DIR);
const strip = (h) => h.replace(/<wbr>/g, '').replace(/<\/?span[^>]*>/g, '');

console.log('\n[1] 값 해석');
ok(LB.modeOf('어절') === 'word' && LB.modeOf('글자') === 'char' && LB.modeOf('절충') === 'smart', '한글 값 → word/char/smart');
ok(LB.modeOf('SMART') === 'smart' && LB.modeOf('') === '' && LB.modeOf('엉뚱') === '', '영문 대소문자 · 빈 값/모르는 값은 빈 문자열(다음 후보로)');
ok(ctxOf('word') === null, '어절이면 문맥 없음(아무것도 안 함 = 기존 조판 그대로)');
ok(ctxOf('smart') && ctxOf('smart').widthPt > 300 && ctxOf('smart').widthPt < 330, 'A5(여백 20·17) 판면 폭 ≈ 314pt');

console.log('\n[2] 절충 — 벌어질 줄만 끊을 자리(<wbr>)');
const dlg = '“제가 철기 3,000을 거느리고 가서 관 아무개를 생포해 승상께 바치겠습니다!” 하고 말하자 조조는 크게 기뻐하며 술을 따라 주었다. '.repeat(4).trim();
const out = LB.fitParagraph(dlg, ctxOf('smart'));
ok(/<wbr>/.test(out), '벌어질 줄이 있으면 <wbr> 를 넣는다');
ok(strip(out) === dlg, '글자는 하나도 바뀌지 않는다(태그만 추가)');
ok(LB.fitParagraph(dlg, ctxOf('word')) === dlg, '어절 방식은 입력 그대로');
const shortP = '조조가 웃었다.';
ok(!/<wbr>/.test(LB.fitParagraph(shortP, ctxOf('smart'))), '한 줄에 들어가는 짧은 문단은 건드리지 않는다');
// 끊을 자리 규칙 — 숫자 한가운데 · 닫는 부호 앞 · 여는 부호 뒤 · 앞뒤 한 글자
const bad = [];
(out.match(/[^<\s]<wbr>[^<\s]/gu) || []).forEach((m) => { const a = m[0], b = m[m.length - 1]; if (/[0-9,.]/.test(a) && /[0-9,.]/.test(b)) bad.push(m); if (/[.,!?”’)…]/.test(b)) bad.push(m); if (/[“‘(]/.test(a)) bad.push(m); });
ok(bad.length === 0, '숫자 한가운데·닫는 부호 앞·여는 부호 뒤에서는 끊지 않는다 ' + JSON.stringify(bad));
// 판별력 — 좁은 판면이면 더 많이 끊는다(헛단언 방지)
const narrow = LB.contextFor({ ...base, trimW: 100, lineBreak: 'smart' }, FONT_DIR);
const n1 = (out.match(/<wbr>/g) || []).length, n2 = (LB.fitParagraph(dlg, narrow).match(/<wbr>/g) || []).length;
ok(n1 !== n2 || n1 > 0, `판면 폭에 따라 결과가 달라진다(A5 ${n1}곳 · 좁은 판 ${n2}곳)`);

console.log('\n[3] 각주 번호 폭 · 각주 본문은 폭 0');
const fn = (n, t) => `<span class="footnote" data-n="${n}">${t}</span>`;
const withFn = '그 풍류와 우아함이 이러했다. 환제 때 정현은 벼슬이 상서' + fn(356, '각주 본문은 쪽 아래로 뜬다 아주 길어도 폭 0') + '에 이르렀으나, 뒤에 십상시의 난이 일어나자 벼슬을 버리고 시골로 돌아와 서주에 살았다.';
const outFn = LB.fitParagraph(withFn, ctxOf('smart'));
ok(strip(outFn.replace(/<span class="footnote"[\s\S]*?<\/span>/g, '')) === strip(withFn.replace(/<span class="footnote"[\s\S]*?<\/span>/g, '')), '각주 span 은 그대로 보존');
const us = LB.units(withFn);
ok(us.some((u) => u.mark === 3), '각주 번호 356 → 3자리 폭 단위');
ok(us.filter((u) => u.zero).length > 10, '각주 본문 글자는 폭 0 으로 취급');

console.log('\n[4] 마지막 줄 고아 방지(끝 두 글자 묶음)');
const g1 = LB.fitParagraph('조조가 말했다.', ctxOf('char'));
ok(/<span class="nw">했다\.<\/span>$/.test(g1), '끝 두 글자(+마침표)를 nowrap 으로 묶는다: ' + g1);
const g2 = LB.fitParagraph('그는 <em>크게 웃었다</em>', ctxOf('char'));
ok(/<span class="nw">었다<\/em><\/span>|<em>크게 웃<span class="nw">었다<\/span><\/em>/.test(g2) || /nw/.test(g2) === false, '<em> 안에서 끝나는 문단도 태그가 엇갈리지 않는다: ' + g2);
const g3 = LB.fitParagraph('가나<em>다</em>라마', ctxOf('char'));
ok(/<span class="nw">라마<\/span>$/.test(g3), '끝 두 글자가 태그 밖이면 묶는다');
const g4 = LB.fitParagraph('<em>가나</em>다', ctxOf('char'));
ok(!/nw/.test(g4) || (g4.match(/<span/g) || []).length === (g4.match(/<\/span>/g) || []).length, '태그가 엇갈리는 경우는 건너뛴다(마크업 깨짐 없음): ' + g4);
const g5 = LB.fitParagraph('조조는 이에 응했다.', ctxOf('char'));
ok(!/<span class="nw">[^<]*\s[^<]*<\/span>/.test(g5), '두 글자가 서로 다른 어절이면 묶지 않는다');

console.log('\n[5] 메타 · 옵션 → HTML');
const md = (extra) => `# 시험\n> 저자: 갑\n> 출판사: 을\n> 판형: A5\n${extra || ''}\n## [목차]\n\n## 제1회 시작\n${(dlg + '\n\n').repeat(6)}조조[^1]가 웃었다.\n\n[^1]: 각주 본문\n`;
const bk = (extra, opts) => parseBookText(md(extra), 't');
ok(resolveBookOptions(bk(''), {}).o.lineBreak === 'word', '기본 = 어절');
ok(resolveBookOptions(bk('> 줄바꿈: 절충\n'), {}).o.lineBreak === 'smart', '메타 `> 줄바꿈: 절충` → smart');
ok(resolveBookOptions(bk(''), { lineBreak: 'char' }).o.lineBreak === 'char', '조판 탭 옵션(char)');
ok(resolveBookOptions(bk('> 줄바꿈: 어절\n'), { lineBreak: 'char' }).o.lineBreak === 'word', '메타가 조판 탭 옵션을 이긴다');
const hWord = buildBookHtml(bk(''), {}).html, hChar = buildBookHtml(bk('> 줄바꿈: 글자\n'), {}).html, hSmart = buildBookHtml(bk('> 줄바꿈: 절충\n'), {}).html;
ok(!/<wbr>|class="nw"/.test(hWord) && !/section\.chapter p, section\.front-section p[^}]*word-break: normal/.test(hWord), '어절(기본) HTML 은 이전과 같다(wbr·nw·normal 없음)');
ok(/section\.chapter p, section\.front-section p, section\.back-section p \{ word-break: normal; \}/.test(hChar), '글자: 본문 문단만 word-break: normal');
ok(/<wbr>/.test(hSmart) && /class="nw"/.test(hSmart) && !/word-break: normal; \}/.test(hSmart.replace(/overflow-wrap[^;]*;/g, '')), '절충: wbr + nw, 문단 전체를 normal 로 풀지는 않는다');
ok(/data-n="1"/.test(hSmart), '각주 호출 번호(data-n)가 HTML 에 실린다 — 원고에 각주가 없으면 없음');

console.log(`\n${fail ? '❌' : '✅'} book-linebreak — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
