'use strict';
/**
 * node test/book-kmong.smoke.js — 🛒 크몽판 PDF(edition 'kmong' · 2026-11-11) 실조판 + 점검(kmong-check) 판정력.
 *   ① 시험 원고 → 크몽판 PDF: A4 · 1쪽 표지 · 2쪽/맨 끝 저작권 안내 · 목차 쪽 번호 = PDF 쪽 · 워터마크 · 점검 통과
 *   ② 🔴 부크크 판권 정보(ISBN·부가기호·발행일·펴낸곳·정가·출판등록·[판권] 고지문)가 원고에 있어도 크몽판 글자에는 0개
 *   ③ 판정력: 본문에 「부크크」·ISBN 꼴을 일부러 넣은 원고 → 점검이 막는다 · 19쪽 원고 → 20쪽 점검이 막는다
 *   ④ 판권 허용 목록(kmongColophonMeta) · 파일 종류([크몽] 은 종이책·전자책이 아니다) · 출력 경로 · 규격 값 한 곳
 *   ⑤ 수정 제한 — qpdf 없으면 ✋(막지 않음) · 가짜 qpdf 로 잠금 경로(종료 코드·rename)
 *   ⑥ 종이책·전자책 HTML 은 크몽 코드가 들어와도 그대로(크몽 문구·워터마크가 새지 않는다)
 * mupdf 는 @vivliostyle/cli 의 하위 의존성(package.json 에 더하지 않는다). 임시 폴더만 쓴다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseBookText } = require('../core/parsers/book-parser');
const HB = require('../core/book/html-builder');
const KB = require('../core/book/kmong-build');
const KC = require('../core/book/kmong-check');
const OL = require('../core/book/out-layout');
const PP = require('../core/book/platform-presets');

const OUT = path.join(os.tmpdir(), 'priming-book-kmong');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const para = '조식은 붓을 들어 이렇게 적었다. 천하의 일은 합쳐지면 나뉘고 나뉘면 다시 합쳐진다는 말이 있다. 도원의 복사꽃 아래에서 세 사람은 하늘에 맹세하였다. '.repeat(7);
const md = (nCh, { body = '', extraMeta = '' } = {}) => {
  const ch = [];
  for (let i = 1; i <= nCh; i++) ch.push(`## 제${i}회 도원결의 ${i}\n${(para + '\n\n').repeat(9)}${i === 1 ? body + '\n' : ''}`);
  return `# 삼국지연의
> 저자: 나관중
> 옮긴이: 로이
> 해설: 로이
> 출판사: 부크크
> 펴낸이: 한부크
> 출판등록: 제2014-16호
> 주소: 서울 금천구 가산디지털1로
> 전화: 1600-3577
> 홈페이지: www.bookk.co.kr
> 발행일: 2026-10-01
> 전자책발행일: 2026-10-05
> ISBN: 979-11-0000-000-1
> 부가기호: 03820
> 전자책ISBN: 979-11-0000-000-2
> 정가: 15,000원
> 전자책: 8,000원
> 판형: A5
${extraMeta}
## [서문]
서문입니다. ${para}

## [목차]

${ch.join('\n')}

## [판권]
* 잘못된 책은 부크크에서 바꿔 드립니다.
`;
};
const cover = path.join(__dirname, '..', 'assets', 'icon-source.png');
const build = (name, text, extra = {}) => KB.buildKmongPdf({
  book: parseBookText(text, '삼국지'), layoutOpts: {}, coverPath: cover,
  outPdf: path.join(OUT, name + '.pdf'), workDir: path.join(OUT, '_w_' + name), kmongDate: '2026-11-11',
  home: path.join(OUT, '_home'), ...extra,
});
const st = (r, id) => ((r.check.items.find((i) => i.id === id)) || {}).status;

(async () => {
  console.log('[1] 시험 원고 → 크몽판 PDF');
  const A = await build('kmong', md(6));
  ok(A.success, `만들기 (${A.pages}쪽)${A.error ? ' — ' + A.error : ''}`);
  if (!A.success) process.exit(1);
  const P = (await KC.readPdf(A.outPdf)).pages;
  ok(P.every((p) => Math.abs(p.wMm - 210) < 1 && Math.abs(p.hMm - 297) < 1), '모든 쪽 A4(210×297mm)');
  ok(P[0].text === '', '1쪽 = 표지(글자 없는 그림 쪽)');
  ok(P[1].text.startsWith(HB.KMONG_NOTICE_TITLE) && P[P.length - 1].text.startsWith(HB.KMONG_NOTICE_TITLE), '2쪽과 맨 끝 쪽 = 저작권 안내');
  ok(/저작권법 제136조/.test(P[1].text) && /민법 제750조/.test(P[1].text), '기본 안내 문안에 저작권법 136조·민법 750조');
  const toc = P.find((p) => p.text.startsWith('목차'));
  const m1 = toc && toc.text.match(/제1회 도원결의 1 (\d+)/);
  const ch1 = P.find((p) => /^제1회 도원결의 1/.test(p.text));
  ok(!!(m1 && ch1 && Number(m1[1]) === ch1.n), `목차 쪽 번호 = PDF 쪽 번호(제1회 ${m1 && m1[1]} · 실제 ${ch1 && ch1.n}쪽)`);
  ok(A.check.ok, '점검 통과(🔴 0개)');
  ok(st(A, 'body') === 'ok' && A.check.bodyPages >= 20, `본문 ${A.check.bodyPages}쪽 ≥ 20`);
  ok(st(A, 'watermark') === 'ok' && P.slice(1).every((p) => p.text.includes('무단 복제·배포 금지')), '워터마크 = 표지 빼고 모든 쪽');
  // 워터마크는 아래 여백(판면 밖) — HTML 의 @bottom-center 칸에만 있다
  ok(/@page main:left \{ @bottom-center \{ content: "ⓒ 로이 · 무단 복제·배포 금지"/.test(A.html), '워터마크 = @page 아래 여백 칸(본문 글상자 밖)');
  ok(/font-size: 12pt/.test(A.html) || /12pt/.test(A.html), '본문 12pt');

  console.log('\n[2] 🔴 크몽판에는 부크크 판권 정보가 없다');
  const all = P.map((p) => p.text).join(' ');
  for (const [w, label] of [['부크크', '펴낸곳·고지문'], ['한부크', '펴낸이'], ['979-11', 'ISBN'], ['03820', '부가기호'], ['15,000', '정가'], ['8,000', '전자책 가격'], ['2014-16', '출판등록'], ['1600-3577', '전화'], ['bookk.co.kr', '홈페이지'], ['2026년 10월 01일', '부크크 발행일'], ['2026년 10월 05일', '전자책 발행일']]) {
    ok(!all.includes(w), `없음: ${label}(${w})`);
  }
  const col = P[P.length - 2].text;
  ok(/삼국지연의/.test(col) && /크몽판 2026년 11월 11일/.test(col) && /지은이 \| 나관중/.test(col) && /옮긴이 \| 로이/.test(col) && /해\s*설\s*\|\s*로이/.test(col) && /ⓒ 로이 2026/.test(col), '판권 = 제목 · 크몽판 날짜 · 지은이 · 옮긴이 · 해설 · ⓒ');

  console.log('\n[3] 판정력 — 막아야 할 원고는 막는다');
  const B = await build('kmong-bookk', md(6, { body: '이 책은 부크크에서 처음 펴냈다(ISBN 979-11-0000-000-1).' }), { lock: false });
  ok(B.success && !B.check.ok && st(B, 'bookk') === 'fail', '본문에 「부크크」·ISBN 이 있으면 막는다');
  ok(B.check.hits.some((h) => h.id === 'bookk-ko') && B.check.hits.some((h) => h.id === 'isbn-form'), '어디서 걸렸는지 알린다(「부크크」 · ISBN 꼴)');
  const C = await build('kmong-19', md(3));
  ok(C.success && C.check.bodyPages < 20 && st(C, 'body') === 'fail' && !C.check.ok, `본문 ${C.check.bodyPages}쪽 원고는 20쪽 점검이 막는다`);
  ok(KC.bookkHits([{ n: 1, text: 'BOOKK Publishing' }, { n: 2, text: '부 크 크' }, { n: 3, text: '9791100000001' }]).length === 3, 'BOOKK · 띄어 쓴 부 크 크 · 하이픈 없는 ISBN 도 잡는다');
  ok(KC.bookkHits([{ n: 1, text: '1597년 12월 9일에 978명이 모였다. 전화 010-1234-5678' }]).length === 0, '연도·숫자·전화번호는 ISBN 으로 잡지 않는다');
  const D = await build('kmong-custom', md(6, { extraMeta: '> 크몽안내: 첫째 문단입니다. | 둘째 문단입니다.\n> 크몽워터마크: 로이서재 전용\n' }), { lock: false });
  const DP = (await KC.readPdf(D.outPdf)).pages;
  ok(/첫째 문단입니다\. 둘째 문단입니다\./.test(DP[1].text) && !/제136조/.test(DP[1].text), '원고 `> 크몽안내:` 가 기본 문안을 이긴다(` | ` = 문단)');
  ok(D.check.ok && DP.slice(1).every((p) => p.text.includes('로이서재 전용')), '원고 `> 크몽워터마크:` 문구가 모든 쪽에');
  const Dmeta = parseBookText(md(1, { extraMeta: '> 크몽안내: x\n' }), 'x').meta;
  ok(Dmeta.kmongNotice === 'x' && !('크몽안내' in Dmeta.extra), '크몽 메타는 표준 키(판권 「그 밖의 줄」로 새지 않는다)');

  console.log('\n[4] 판권 허용 목록 · 파일 종류 · 경로 · 규격');
  const km = HB.kmongColophonMeta({ title: 'T', author: 'A', isbn: '979', isbnAddon: '03820', ebookIsbn: '979', issueDate: '2026-10-01', ebookIssueDate: '2026-10-05', publisher: '부크크', issuer: 'X', regNo: 'R', price: '1', ebookPrice: '2', logo: 'l.png', qr: 'q.png', address: 'a', phone: 'p', email: 'e', homepage: 'h', extra: { '해설': 'H', '기타': 'z' }, newField: '부크크' }, '2026-11-11');
  ok(Object.keys(km).sort().join(',') === 'author,copyright,extra,issueDate,legalText,subtitle,title,translator,translatorLabel' && km.issueDate === '크몽판 2026-11-11' && JSON.stringify(km.extra) === '{"해설":"H"}', '판권 메타 = 허용 목록만(새 메타 칸이 생겨도 새지 않는다)');
  ok(OL.outputKind('[크몽] 삼국지_제1권_완성.pdf') === 'kmongPdf', '[크몽] _완성.pdf = 크몽판');
  ok(OL.outputKind('[전자책] 삼국지_제1권_완성.pdf') === 'ebookPdf' && OL.outputKind('[종이책] 삼국지_제1권_완성.pdf') === 'full' && OL.outputKind('[크몽] x_표지.pdf') === null, '전자책·종이책 판정은 그대로 · [크몽] 은 다른 종류로 잡히지 않는다');
  const root = path.join(OUT, '작품', '완성'); fs.mkdirSync(root, { recursive: true });
  ok(path.relative(root, OL.outPath(root, 'kmong', 'full', '삼국지_제1권')).split(path.sep).join('/') === '크몽/01_완성본/[크몽] 삼국지_제1권_완성.pdf', '출력 = 완성/크몽/01_완성본/[크몽] …_완성.pdf');
  const K = PP.PLATFORMS.kmong;
  ok(K.fontPt === 12 && K.lineHeight === 1.5 && K.minBodyPages === 20 && K.maxImageRatio === 0.3 && K.maxBytes === 200 * 1024 * 1024 && K.trims.join() === 'A4', '규격 값 = PLATFORMS.kmong 한 곳(12pt · 1.5 · 20쪽 · 30% · 200MB · A4)');
  ok(HB.metaPlatformId({ platform: '크몽' }) === 'bookk', '크몽은 원고 `> 플랫폼:` 이 아니다(부크크 판 규격은 그대로)');
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'book', 'html-builder.js'), 'utf8');
  ok((src.match(/kmongColophonMeta\(/g) || []).length === 2, '크몽 판권 값 고르기는 판권 함수 한 곳');
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  ok(/function bookOutputKind\(f\) \{ return OL\.outputKind\(f\); \}/.test(mainSrc), 'main bookOutputKind = out-layout.outputKind 한 곳');

  console.log('\n[5] 수정 제한(qpdf)');
  ok(st(A, 'lock') === 'manual' && A.lock && A.lock.status === 'missing', 'qpdf 없으면 ✋(막지 않는다)');
  const re = await KC.checkKmongPdf(A.outPdf, { watermark: A.watermark });
  ok(re.ok && re.bodyPages === A.check.bodyPages && (re.items.find((i) => i.id === 'notice') || {}).status === 'ok', '다시 점검(표지 여부 모름) — 1쪽이 글자 없는 쪽이면 표지로 본다');
  const fake = path.join(OUT, 'fake.pdf'); fs.copyFileSync(A.outPdf, fake);
  const L = await KC.lockEdit(fake, { qpdf: 'qpdf.exe', run: async (cmd, a) => { fs.writeFileSync(a[a.length - 1], 'LOCKED'); return { code: 3 }; } });
  ok(L.status === 'locked' && fs.readFileSync(fake, 'utf8') === 'LOCKED' && !fs.existsSync(fake + '.lock.tmp'), '잠금 = 임시 파일 → 원래 이름(종료 코드 3 = 경고만도 성공)');
  const L2 = await KC.lockEdit(fake, { qpdf: 'qpdf.exe', run: async () => ({ code: 2, out: 'bad' }) });
  ok(L2.status === 'error' && fs.readFileSync(fake, 'utf8') === 'LOCKED', '실패하면 원본을 건드리지 않는다');
  ok(L.status && /--modify=none/.test(fs.readFileSync(path.join(__dirname, '..', 'core', 'book', 'kmong-check.js'), 'utf8')) && !/--print=none|--extract=n/.test(fs.readFileSync(path.join(__dirname, '..', 'core', 'book', 'kmong-check.js'), 'utf8')), '편집 권한만 잠근다(인쇄·복사는 그대로)');
  const qh = path.join(OUT, '_qhome'); fs.mkdirSync(path.join(qh, '.priming-maker', 'tools', 'qpdf-12.0.0', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(qh, '.priming-maker', 'tools', 'qpdf-12.0.0', 'bin', process.platform === 'win32' ? 'qpdf.exe' : 'qpdf'), '');
  ok(/qpdf-12\.0\.0/.test(KC.findQpdf(qh)) && KC.findQpdf(path.join(OUT, '_none')) === '', 'qpdf 는 저장소 밖 ~/.priming-maker/tools/qpdf-*/bin 에서만 찾는다');

  console.log('\n[6] 종이책·전자책은 그대로');
  const book = parseBookText(md(2), '삼국지');
  for (const ed of ['print', 'ebook']) {
    const h = HB.buildBookHtml(book, { edition: ed, sourceMap: false }).html;
    ok(!h.includes(HB.KMONG_NOTICE_TITLE) && !h.includes('무단 복제·배포 금지') && !h.includes('크몽') && h.includes('979-11-0000-000') && h.includes('부크크'), `${ed}: 크몽 문구·워터마크 없음 · ISBN·펴낸곳 그대로`);
  }

  console.log(`\n${fail ? '❌' : '✅'} 크몽판 PDF ${pass}/${pass + fail} → ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('오류:', e); process.exit(1); });
