'use strict';
/**
 * node test/title-fit.test.js — 📏 제목 길이 기준(core/book/title-fit.js · 로이 2026-10-01 「제목을 몇 자 이상 안 만든다와 같은 기준」)
 *   글꼴 실제 폭(hmtx)으로 각 회목이 머리글 한 줄 · 목차 2~3줄에 들어가는지 잰다. 실조판 대조(예측 줄 수 = 실제 줄 수)는 test/book-toc.smoke.js.
 */
const fs = require('fs'), path = require('path');
const { parseBookText } = require('../core/parsers/book-parser');
const HB = require('../core/book/html-builder');
const TF = require('../core/book/title-fit');
const FD = path.join(__dirname, '..', 'assets', 'fonts', 'book');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const run = (md, opts) => { const b = parseBookText(md, 't'); const { o } = HB.resolveBookOptions(b, opts || {}); return TF.analyze(b, o, FD, { chapterExcluded: HB.chapterExcluded }); };
const LONG = '복숭아밭 잔치에서 세 호걸이 의형제를 맺고, 황건적을 베어 처음으로 공을 세우다 그리고 이어서 천하의 영웅들이 하나둘 모여들어 큰 뜻을 세우게 되었다';
const MID = '장익덕이 대노하여 독우를 매질하고, 하진이 환관을 죽이려다 도리어 화를 입다';
const mk = (meta, titles) => `# 삼국지연의 완역 1\n> 저자: 나관중\n> 판형: A5\n${meta}\n## 1부. 도원\n\n${titles.map((t, i) => `## 제${i + 1}회 ${t}\n본문\n`).join('\n')}`;

console.log('\n[1] 글자 폭 — 글꼴 실제 폭(hmtx)');
const dot = TF.metricsOf(path.join(FD, 'KoPubWorld-Dotum-Light.ttf'));
ok(dot && dot.adv(0xAC00) > 0.8 && dot.adv(0xAC00) < 1.0, `한글 한 글자 ≈ 0.87em — 1em 이 아니다(KoPub 돋움 Light 실측 ${dot && dot.adv(0xAC00).toFixed(3)}) → 글자 수 어림이 아니라 실제 폭으로 잰다`);
ok(dot.adv(0x20) < 0.5 && dot.adv(0x31) < 0.8, `공백 ${dot.adv(0x20).toFixed(2)}em · 숫자 ${dot.adv(0x31).toFixed(2)}em — 한글보다 좁다(글자 수가 아니라 폭으로 잰다)`);
ok(Math.abs(TF.widthPt('가나다', [dot], 9) - 3 * dot.adv(0xAC00) * 9) < 0.01 && TF.widthPt('가나다', [dot], 9) > 22 && TF.widthPt('가나다', [dot], 9) < 25, `「가나다」 9pt = ${TF.widthPt('가나다', [dot], 9).toFixed(1)}pt`);
ok(TF.countLines('가 '.repeat(40).trim(), [dot], 10, 100) > 1 && TF.countLines('짧은', [dot], 10, 100) === 1, '줄 수: 짧으면 1줄 · 길면 여러 줄(어절 단위)');

console.log('\n[2] 기준 수치(A5 · 기본 여백 20/17) — 머리글 한 줄 · 목차 줄');
const fit = run(mk('> 머리글홀수: 회목\n> 회목최대: 40\n', [LONG, MID, '짧은 회목']));
ok(fit.ok && fit.header.usesFullTitle && fit.header.charsApprox >= 33 && fit.header.charsApprox <= 45, `머리글 한 줄 ≈ ${fit.header.charsApprox}자 (판면 ${fit.header.capacityPt}pt)`);
ok(fit.toc.chars2Approx >= 40 && fit.toc.chars2Approx <= 60 && fit.toc.chars3Approx > fit.toc.chars2Approx, `목차 2줄 ≈ ${fit.toc.chars2Approx}자 · 3줄 ≈ ${fit.toc.chars3Approx}자`);
const [a, b2, c] = fit.items;
ok(a.flags.includes('header') && a.flags.includes('max') && a.tocLines >= 3, `83자 회목: 머리글 잘림 + 회목최대 초과 + 목차 ${a.tocLines}줄`);
ok(!b2.flags.includes('header') && b2.tocLines === 2 && b2.flags.includes('max') && !b2.flags.includes('toc3'), `42자 회목: 머리글에는 들어가고(${b2.headerPt}pt) 목차 2줄 · 회목최대(40) 초과만 걸린다`);
ok(c.flags.length === 0 && c.tocLines === 1, '짧은 회목: 아무 문제 없음');
ok(fit.count.header === 1 && fit.count.max === 2, `집계: 머리글 ${fit.count.header} · 회목최대 ${fit.count.max}`);
const ws = TF.warnings(fit);
ok(ws.length >= 2 && /머리글에서 잘립니다/.test(ws[0]) && /chapterNo/.test(ws[0]) && /회목최대: 40/.test(ws.join('\n')), '경고 문장: 원인 · 해결책(「제N회」 머리글) · 원고 기준');

console.log('\n[3] 판별력 — 머리글이 「제N회」이면 회목 길이와 무관');
const fitNo = run(mk('> 머리글홀수: 제N회\n> 머리글짝수: 없음\n', [LONG, MID]));
ok(!fitNo.header.usesFullTitle && fitNo.count.header === 0, '머리글 = 제N회/없음 → 머리글 잘림 0 (길어도 문제 아님)');
ok(fitNo.items[0].flags.includes('toc2') || fitNo.items[0].flags.includes('toc3'), '…그래도 목차 줄 수는 본다(긴 회목은 목차 3줄)');
ok(TF.warnings(fitNo).every((w) => !/머리글에서 잘립니다/.test(w)), '머리글 경고도 없다');
const fitDef = run(mk('', [LONG]));
ok(fitDef.header.odd === 'chapter' && fitDef.count.header === 1, '메타 없이 기본값(홀수쪽 = 장 제목) — 긴 회목은 기본값에서 잘린다 → 경고 대상');

console.log('\n[4] 책 제목 머리글 · 목차 글자 크기');
const longBook = run('# ' + '아주 긴 책 제목 '.repeat(8) + '\n> 저자: 나\n\n## 1장. 가\n본문\n');
ok(!!longBook.bookTitleOver && longBook.bookTitleOver.kind === 'title', '책 제목이 한 줄에 안 들어가면 책 제목 머리글 경고(짝수쪽 기본)');
const small = run(mk('> 목차글자: 9.5\n', [MID]), {});
const big = run(mk('> 목차글자: 13\n', [MID]), {});
ok(small.toc.chars2Approx > big.toc.chars2Approx, `목차 글자가 작으면 2줄에 더 들어간다(9.5pt ${small.toc.chars2Approx}자 > 13pt ${big.toc.chars2Approx}자)`);

console.log('\n[5] 배선');
const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'), BV = fs.readFileSync(path.join(__dirname, '..', 'renderer/src/BookView.jsx'), 'utf8');
ok(/function warnLongTitles\(/.test(M) && /warnLongTitles\(bookLayoutOpts\(args\), '미리보기'\)/.test(M) && /warnLongTitles\(bookLayoutOpts\(args\), '내지 PDF'\)/.test(M), 'main: 미리보기·내지 PDF 조판 때 경고(같은 목록은 한 번만)');
ok(/ipcMain\.handle\('book-title-fit'/.test(M) && /titleMax: '회목최대'/.test(M), 'main: book-title-fit IPC · 메타 라벨 회목최대');
ok(/bk-titlefit/.test(BV) && /bkfit-badge/.test(BV), '구조 탭: 제목 길이 기준 박스 + 장마다 ⚠ 배지');
ok(parseBookText('# t\n> 회목최대: 40\n', 'x').meta.titleMax === '40', '파서: `> 회목최대:` 키');

console.log(`\n${fail ? '❌' : '✅'} title-fit — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
