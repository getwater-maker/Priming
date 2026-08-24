'use strict';
// node test/book-md.test.js — 출판 조판의 마크다운 처리(표·목록·링크·파일종류 판정) 단언 테스트.
//   배경(2026-08-23): 설교 원고 `서론_고린도전서.md` 를 출판 탭에서 열었더니
//     ① 파일이 '구 앱 회차 파일'로 오판돼 모든 헤딩이 한 단계 밀렸고(책 제목이 장 제목이 됨)
//     ② 표 109줄·목록 98줄이 전부 한 문단으로 뭉개졌으며(원고 317줄 중 65%)
//     ③ 링크가 `[텍스트](주소)` 원문 그대로 인쇄됐다.
//   이 파일은 그 셋이 되돌아오지 않는지 지킨다. 모듈을 직접 require 하므로 앱 원문을 그대로 돌린다.
const assert = require('assert');
const BK = require('../core/parsers/book-parser');
const HB = require('../core/book/html-builder');

let n = 0;
const ok = (cond, msg) => { n++; assert(cond, `#${n} ${msg}`); };

// ── [1] 파일 종류 판정 ──────────────────────────────────────────────────────
// 실사고 원고의 형태: H1 책 제목 + `> 메타아닌 인용` + `## 0.` ~ `## 12.` 섹션들.
const REAL_SHAPE = `# 고린도전서 강해 — 서론

> 작성일: 2026-08-21 / 신학 기준: 개혁신학
> 본문 인용 기준: [\`../개역개정4판(구약+신약).txt\`](../개역개정4판(구약+신약).txt) (CP949)

## 0. 진행 현황 (Progress Tracker)

| 회차 | 본문 | 상태 |
|------|------|------|
| 1 | 1:1-9 | 예정 |
| 2 | 1:10-17 | 예정 |

## 1. 책 이름과 위치

- **정경 안에서의 위치**: 신약 바울서신 13권 중 두 번째.
- **책 이름**: 수신 교회의 소재지에서 온 이름이다.

## 2. 기록 연대와 장소

- **추정 연대**: 주후 53~55년경.
  - 근거 ① 갈리오 비문.
  - 근거 ② 에베소 체류.

## 3. 체크리스트

- [x] 강해할 권 확정
- [ ] 아직 안 한 것
`;
ok(BK.detectBookFileKind(REAL_SHAPE) === 'native', '실사고 원고 형태 = native (chapter 오판 회귀 방지)');
ok(BK.detectBookFileKind('# 제9회 여포의 칼\n## 1\n본문\n## 2\n본문') === 'chapter', '구 앱 회차 파일(# 제N회) = chapter 유지');
ok(BK.detectBookFileKind('책제목: 삼국지\n===앞부속물===\n# 헌사\n어머니께') === 'essential', '필수파일 = essential 유지');
ok(BK.detectBookFileKind('# 조선의 밤\n> 저자: 홍길동\n## [헌사]\n어머니께') === 'native', '우리 형식(## [섹션]) = native 유지');
ok(BK.detectBookFileKind('제9회 여포의 칼\n\n본문이 이어진다.') === 'chapter', 'H1 없는 회차 파일 = chapter 폴백 유지');
ok(BK.detectBookFileKind('# 어떤 제목\n## 하나뿐인 절\n본문') === 'chapter', 'H2 가 하나뿐이면 회차 파일로 본다(폴백 유지)');

// ── [2] 실사고 재현 — 파싱 결과 ─────────────────────────────────────────────
const book = BK.parseBookFiles([{ path: 'D:/x/서론_고린도전서.md', text: REAL_SHAPE }], '서론_고린도전서');
ok(book.fileTitle === '고린도전서 강해 — 서론', 'H1 이 책 제목으로 남는다(파일명 폴백 아님)');
ok(book.meta.title === '고린도전서 강해 — 서론', 'meta.title 설정 — 반표제지·속표지·러닝헤드의 근거');
const chs = book.parts.flatMap((p) => p.chapters);
ok(chs.length === 4, `## 섹션 4개가 각각 장 (실제 ${chs.length})`);
ok(chs[0].title === '0. 진행 현황 (Progress Tracker)', '첫 장 제목');
const allBlocks = chs.flatMap((c) => c.blocks);
ok(!allBlocks.some((b) => b.type === 'p' && /\|/.test(b.text || '')), '표가 문단으로 뭉개지지 않는다');
ok(!allBlocks.some((b) => b.type === 'p' && /^- /.test(b.text || '')), '목록이 문단으로 뭉개지지 않는다');

// ── [3] 표 파싱 ─────────────────────────────────────────────────────────────
const tb = allBlocks.find((b) => b.type === 'table');
ok(tb && tb.header.join('|') === '회차|본문|상태', '표 머리행');
ok(tb.rows.length === 2 && tb.rows[1][1] === '1:10-17', '표 본문행');
ok(JSON.stringify(BK.splitTableRow('| a | b\\|c | d |')) === '["a","b|c","d"]', '이스케이프한 \\| 는 셀 구분이 아니다');
ok(JSON.stringify(BK.parseTableAlign('|:---|:--:|---:|---|')) === '["left","center","right",null]', '정렬행 해석');
ok(BK.TABLE_SEP_RE.test('|------|------|') && !BK.TABLE_SEP_RE.test('| a | b |'), '구분행 판별');
// 구분행이 없으면 표가 아니다 — 파이프 든 평문을 표로 오인하면 본문이 사라진다
const noSep = BK.parseBookText('## 1장\n| 이건 | 표가 아니다 |\n다음 줄.', 'x');
ok(noSep.parts[0].chapters[0].blocks.every((b) => b.type !== 'table'), '구분행 없으면 표로 보지 않는다');
// 셀 수가 머리행과 다른 줄
const ragged = BK.parseBookText('## 1장\n| a | b | c |\n|---|---|---|\n| 1 | 2 |\n', 'x');
const rt = ragged.parts[0].chapters[0].blocks[0];
ok(rt.type === 'table' && rt.rows[0].length === 2, '셀 수가 모자란 행도 표로 받는다(렌더에서 머리행 기준으로 채움)');

// ── [4] 목록 파싱 ───────────────────────────────────────────────────────────
const lists = allBlocks.filter((b) => b.type === 'list');
ok(lists.length === 3, `목록 블록 3개 (실제 ${lists.length})`);
ok(lists[0].items.length === 2 && !lists[0].ordered, '불릿 목록');
const nested = lists[1];
ok(nested.items.length === 3, '중첩 목록이 한 블록으로 묶인다');
ok(nested.items[0].level === 0 && nested.items[1].level === 1, '2칸 들여쓰기 = 한 단계 아래');
const task = lists[2];
ok(task.items[0].checked === true && task.items[1].checked === false, '체크박스 항목');
ok(task.items[0].text === '강해할 권 확정', '체크박스 표시는 텍스트에서 뗀다');
ok(BK.parseListItem('1) 번호 항목').ordered === true, '1) 형식도 번호 목록');
ok(BK.parseListItem('- - -') === null || BK.parseListItem('---') === null, '구분선은 목록 항목이 아니다');
// 들여쓴 이어짐 줄
const cont = BK.parseBookText('## 1장\n- 첫 항목이\n  이어진다.\n- 둘째 항목.\n', 'x');
const cl = cont.parts[0].chapters[0].blocks[0];
ok(cl.type === 'list' && cl.items.length === 2 && cl.items[0].text === '첫 항목이 이어진다.', '들여쓴 줄은 앞 항목에 붙는다');

// ── [5] 인라인 링크 ─────────────────────────────────────────────────────────
//   종이책이라 주소는 버리고 글자만 남긴다. 로컬 경로는 언제나 버린다.
const md = (x) => HB.inlineMd(x);
ok(md('[텍스트](../a/b.pdf) 뒤') === '텍스트 뒤', '로컬 경로 링크 → 글자만');
ok(md('[사이트](https://example.com) 참고') === '사이트 (https://example.com) 참고', '외부 주소는 괄호로 병기');
ok(md('[https://example.com](https://example.com)') === 'https://example.com', '글자와 주소가 같으면 한 번만');
ok(md('![그림](images/x.png)') === '![그림](images/x.png)', '인라인 이미지는 건드리지 않는다');
// 🔴 주소에 괄호가 들어가는 실제 사례 — 한 겹 중첩까지 받아야 뒤가 안 깨진다
ok(md('본문 [`../개역개정4판(구약+신약).txt`](../개역개정4판(구약+신약).txt) 끝')
  === '본문 <span class="code">../개역개정4판(구약+신약).txt</span> 끝', '주소 속 괄호를 넘어 정확히 끊는다');
ok(md('각주 [^1] 유지') === '각주 [^1] 유지', '각주 참조는 링크로 오인하지 않는다');
ok(md('**굵게** *기울임*') === '<strong>굵게</strong> <em>기울임</em>', '기존 인라인 규칙 회귀');

// ── [6] 조판 HTML ───────────────────────────────────────────────────────────
const { html } = HB.buildBookHtml(book, { baseDir: 'D:/x' });
ok(/<table class="md-table">/.test(html), '표가 <table> 로 나간다');
ok(/<thead><tr><th/.test(html), '머리행 <thead> — 쪽을 넘을 때 반복시키는 근거');
ok((html.match(/<tr>/g) || []).length >= 3, '표 행이 <tr> 로 나간다');
ok(/<div class="md-listwrap"/.test(html), '목록이 <ul>/<ol> 로 나간다');
ok(/<li class="task">/.test(html), '체크박스 항목은 task 클래스(불릿 숨김)');
ok(/☑/.test(html) && /☐/.test(html), '체크박스 글자');
ok(/<ul><li>/.test(html) || /<li>[^<]*<ul>/.test(html) || /<\/li><\/ul><\/li>/.test(html) || /<ul>/.test(html), '중첩 목록 마크업');
ok(!/\|\s*-{3,}\s*\|/.test(html), '조판 결과에 표 원문(|---|)이 남지 않는다');
ok(!/\]\([^)]*\)/.test(html), '조판 결과에 링크 원문이 남지 않는다');
ok(/table\.md-table thead \{ display: table-header-group/.test(html), '머리행 반복 CSS 가 실린다');
ok(/div\.md-listwrap li\.task \{ list-style: none/.test(html), '체크박스 불릿 숨김 CSS 가 실린다');
ok(/span\.code \{[^}]*overflow-wrap: anywhere/.test(html), '긴 파일 경로가 줄을 찢지 않게 하는 CSS');

// ── [7] 기존 조판 회귀 — 표·목록을 넣어도 다른 블록이 안 깨진다 ──────────────
const mixed = BK.parseBookText([
  '# 책', '> 저자: 나', '', '## 1장. 섞임', '문단이다.', '', '> 인용이다.', '', '```시', '한 줄', '```', '',
  '![캡션](a.png)', '', '---', '', '- 목록', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '끝 문단.',
].join('\n'), 'x');
const types = mixed.parts[0].chapters[0].blocks.map((b) => b.type).join(',');
ok(types === 'p,quote,verse,image,hr,list,table,p', `블록 순서 유지 (실제: ${types})`);

// ── [8] 출력 제외 — 원고는 그대로 두고 책에서만 뺀다 ────────────────────────
//   §0 진행 현황(33행 트래커)·✅ 체크리스트처럼 원고에는 있어야 하지만 인쇄물에는 없어야 하는 장.
ok(HB.chapterKey(' 0. 진행 현황 ') === 'ch:0. 진행 현황', '장 키는 제목 기준 + 앞뒤 공백 정리');
ok(HB.chapterExcluded('3. 체크리스트', ['ch:3. 체크리스트']) === true, '제외 판정');
ok(HB.chapterExcluded('3. 체크리스트', ['ch:다른 장']) === false, '다른 장은 안 걸린다');
ok(HB.chapterExcluded('3. 체크리스트', []) === false, '빈 목록이면 전부 포함');
const cut = HB.buildBookHtml(book, { baseDir: 'D:/x', excluded: ['ch:0. 진행 현황 (Progress Tracker)'] }).html;
ok((cut.match(/<section class="chapter"/g) || []).length === 3, '제외한 장이 본문에서 빠진다');
ok(!cut.includes('페리코페'), '제외한 장의 표 내용도 함께 사라진다');
ok((cut.match(/toc-chapter/g) || []).length === 3, '제외한 장은 목차에서도 빠진다');
ok(cut.includes('1. 책 이름과 위치'), '남은 장은 그대로');
// 🔑 원고(BookModel)는 불변이어야 한다 — 조판이 원고를 깎으면 다음 조판이 어긋난다
ok(book.parts.flatMap((p) => p.chapters).length === 4, '제외해도 파싱 결과(원고)는 그대로');
// 부(部) 안의 장이 전부 빠지면 부 표제지도 안 나온다
const withPart = BK.parseBookText('# 책\n> 저자: 나\n\n## 1부. 그림자\n\n## 1장. 하나\n본문.\n', 'x');
const pcut = HB.buildBookHtml(withPart, { baseDir: 'D:/x', excluded: ['ch:1장. 하나'] }).html;
ok(!/class="part-title"/.test(pcut), '장이 다 빠진 부는 표제지도 생략');

// ── [9] 작업용 파일 경로 → 파일명만 ────────────────────────────────────────
ok(HB.shortenPath('../참고문헌/지도교수/오광만_박사논문2008.pdf') === '오광만_박사논문2008.pdf', '폴더를 떼고 파일명만');
ok(HB.shortenPath('A/B 실험') === 'A/B 실험', '확장자 없는 평범한 글자는 안 건드린다');
ok(HB.shortenPath('그냥 글자') === '그냥 글자', '경로가 아니면 그대로');
ok(HB.shortenPath('https://a.com/b.pdf') === 'https://a.com/b.pdf', '외부 주소는 그대로');
ok(HB.shortenPath('D:\\작업\\원고.md') === '원고.md', '윈도우 경로도');
ok(HB.inlineMd('본문 `../a/b/c.pdf` 끝') === '본문 <span class="code">../a/b/c.pdf</span> 끝', '기본은 경로 유지(조용히 안 바꾼다)');
ok(HB.inlineMd('본문 `../a/b/c.pdf` 끝', { hidePaths: true }) === '본문 <span class="code">c.pdf</span> 끝', '옵션을 켜야 축약');

// ── [10] ePub 정합 — 내지와 같은 제외·필터가 걸려야 한다 ───────────────────
//   여태 ePub 은 excluded/scriptMode 를 아예 받지 않아 종이책과 내용이 갈렸다(기존 결함).
const EB = require('../core/book/epub-builder');
const ebSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'core', 'book', 'epub-builder.js'), 'utf8');
ok(/chapterExcluded/.test(ebSrc), 'ePub 이 장 제외 판정을 쓴다');
ok(/scriptFilter\(blocks0, ctx\)/.test(ebSrc), 'ePub 이 영상 대본 모드 필터를 쓴다');
ok(/hidePaths: !!a\.hidePaths/.test(ebSrc), 'ePub 이 경로 축약 옵션을 받는다');
const mainSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
ok(/excluded: lo\.excluded, scriptMode: lo\.scriptMode/.test(mainSrc), 'main.js 가 ePub 빌드에 조판 옵션을 넘긴다');
ok(/hidePaths: !!l\.hidePaths/.test(mainSrc), 'main.js layoutOpts 에 hidePaths');
const uiSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'renderer', 'src', 'BookView.jsx'), 'utf8');
ok(/function toggleChapter/.test(uiSrc), '구조 패널에 장 포함/제외 토글');
ok(/L\('hidePaths'/.test(uiSrc), '조판 패널에 경로 축약 체크박스');
ok(/hidePaths: false/.test(uiSrc), '경로 축약 기본 OFF');
ok(typeof EB.buildEpub === 'function', 'epub-builder 로드');

// ── [11] HTML 주석은 조판에서 제외 ─────────────────────────────────────────
//   실사고: 주해_고린도전서.md 의 마지막 줄 `<!-- ↓↓↓ 여기서부터 페리코페 주해를 … ↓↓↓ -->` 가
//   책의 마지막 쪽에 그대로 인쇄됐다. 마크다운 규약상 주석은 출력되지 않는다.
const cm = BK.parseBookText('## 1장\n앞 문단.\n\n<!-- 작업 메모 -->\n\n뒤 문단.\n', 'x');
ok(cm.parts[0].chapters[0].blocks.map((b) => b.text).join('|') === '앞 문단.|뒤 문단.', '한 줄 주석 제거');
const cm2 = BK.parseBookText('## 1장\n앞.\n\n<!-- 여러\n줄\n주석 -->\n\n뒤.\n', 'x');
ok(cm2.parts[0].chapters[0].blocks.map((b) => b.text).join('|') === '앞.|뒤.', '여러 줄 주석 제거');
ok(HB.inlineMd('앞 <!-- 숨김 --> 뒤') === '앞  뒤', '문단 중간의 주석도 제거(esc 전에)');
// 🔑 코드펜스(양식 예시) **안**의 주석은 예시의 일부라 보존한다
const cm3 = BK.parseBookText('## 1장\n```\n<!-- 예시 안 주석 -->\n양식\n```\n', 'x');
const vb = cm3.parts[0].chapters[0].blocks[0];
ok(vb.type === 'verse' && vb.lines.join('\n').includes('<!-- 예시 안 주석 -->'), '코드펜스 안 주석은 보존');
const cmHtml = HB.buildBookHtml(cm, { baseDir: 'D:/x' }).html;
ok(!/작업 메모/.test(cmHtml), '조판 결과에 주석 내용이 남지 않는다');

// ── [12] 판권지 — 실물 단행본 판권(레퍼런스: 비즈니스북스 『하루 한 장 고전 수업』, 2026-08-24) ──
//   로이가 실물 스캔을 주며 "판권을 이 이미지처럼" 요청. 그 판권의 구성 요소를 전부 단언한다.
//   ⚠ 라벨 행·발행 이력·별표 고지문·테두리 박스는 서로 다른 규약(메타/자유문/인용)에서 오므로
//     하나만 고치면 나머지가 조용히 어긋난다 — 한 원고로 전부 함께 확인한다.
const CP_MD = `# 하루 한 장 고전 수업

> 부제: 365일 인생의 내공을 기르는
> 발행일: 1판 1쇄 발행 2022년 11월 22일; 1판 6쇄 발행 2022년 12월 29일
> 지은이: 조윤제
> 발행인: 홍영태
> 편집인: 김미란
> 발행처: (주)비즈니스북스
> 등록: 제2000-000225호(2000년 2월 28일)
> 주소: 03991 서울시 마포구 월드컵북로6길 3
> 전화: (02)338-9449
> 팩스: (02)338-6543
> 대표메일: bb@businessbooks.co.kr
> 홈페이지: http://www.businessbooks.co.kr
> 블로그: http://blog.naver.com/biz_books
> 페이스북: thebizbooks
> ISBN: 979-11-6254-314-6
> 부가기호: 03190

## 1장. 첫 장

본문 문단.

## [판권]

* 잘못된 책은 구입하신 서점에서 바꾸어 드립니다.
* 책값은 뒤표지에 있습니다.

> 비즈니스북스는 독자 여러분의 원고 투고를 기다리고 있습니다.
> 원고가 있으신 분은 ms1@businessbooks.co.kr 로 보내 주세요.
`;
const cpBook = BK.parseBookText(CP_MD, '판권');
// (1) 새 메타 라벨 — 편집인·대표메일·블로그·페이스북이 extra 가 아니라 표준 키로 들어간다
ok(cpBook.meta.editor === '김미란', '편집인 → editor');
ok(cpBook.meta.email === 'bb@businessbooks.co.kr', '대표메일 → email');
ok(cpBook.meta.blog === 'http://blog.naver.com/biz_books', '블로그 → blog');
ok(cpBook.meta.facebook === 'thebizbooks', '페이스북 → facebook');
ok(Object.keys(cpBook.meta.extra || {}).length === 0, '새 라벨은 extra 로 새지 않는다');

const cpHtml = HB.buildBookHtml(cpBook, { baseDir: 'D:/x' }).html;
const cpSec = (cpHtml.match(/<section class="colophon[\s\S]*?<\/section>/) || [''])[0];
ok(cpSec.length > 0, '판권 섹션 생성');
// (2) 발행 이력 — `;` 로 여러 쇄, 라벨/날짜는 첫 연도 앞에서 갈린다
ok(/<span class="dk">1판 1쇄 발행<\/span><span class="dv">2022년 11월 22일<\/span>/.test(cpSec), '발행 이력 1쇄 라벨/날짜 분리');
ok(/<span class="dk">1판 6쇄 발행<\/span><span class="dv">2022년 12월 29일<\/span>/.test(cpSec), '발행 이력 2쇄(;로 두 줄)');
ok((cpSec.match(/class="cp-date"/g) || []).length === 2, '발행 이력이 두 줄');
// 라벨 없이 날짜만 쓰면 기본 라벨
const dOnly = HB.buildBookHtml(BK.parseBookText('# 책\n> 발행일: 2026년 8월 24일\n\n## 1장. ㄱ\n본문.\n\n## [판권]\n\n메모.\n', 'x'), { baseDir: 'D:/x' }).html;
ok(/<span class="dk">초판 1쇄 발행<\/span><span class="dv">2026년 8월 24일<\/span>/.test(dOnly), '라벨 없으면 「초판 1쇄 발행」');
// (3) 라벨 행 — 라벨 굵게(.k) + 구분선(|) + 값, 레퍼런스 순서
ok(/<span class="k">지은이<\/span><span class="sep">\|<\/span><span class="v">조윤제<\/span>/.test(cpSec), '지은이 행');
ok(/<span class="k">편집인<\/span>/.test(cpSec), '편집인 행');
ok(cpSec.indexOf('발행인') < cpSec.indexOf('편집인') && cpSec.indexOf('편집인') < cpSec.indexOf('발행처'), '레퍼런스 순서(발행인→편집인→발행처)');
ok(cpSec.indexOf('대표메일') < cpSec.indexOf('홈페이지') && cpSec.indexOf('홈페이지') < cpSec.indexOf('블로그'), '연락처 순서(대표메일→홈페이지→블로그)');
// (4) 2글자 라벨은 3글자 폭에 균등 분산 — flex 로 쪼갠다(자간·글꼴과 무관하게 정확)
ok(/<span class="k k2"><span>등<\/span><span>록<\/span><\/span>/.test(cpSec), '등 록 = 2글자 라벨 분산');
ok(/<span class="k k2"><span>팩<\/span><span>스<\/span><\/span>/.test(cpSec), '팩 스 = 2글자 라벨 분산');
ok(/<span class="k">홈페이지<\/span>/.test(cpSec), '4글자 라벨은 분산하지 않는다');
// (5) ISBN — 구분선 없이 값 + 부가기호(값 뒤에 띄워 붙인다)
ok(/class="cp-row cp-isbn"/.test(cpSec), 'ISBN 은 별도 클래스(구분선 숨김)');
ok(/979-11-6254-314-6<span class="addon">03190<\/span>/.test(cpSec), '부가기호는 값 뒤 addon');
ok(!/부가기호 03190/.test(cpSec), '옛 「(부가기호 …)」 표기가 아니다');
// (6) 별표 고지문 — 마크다운 목록으로 파싱되지만 불릿 목록이 아니라 별표 문단으로 조판
ok(/<div class="cp-notes"/.test(cpSec), '고지문 컨테이너(cp-notes)');
ok(/<p class="cp-note bul">\* 잘못된 책은 구입하신 서점에서 바꾸어 드립니다\.<\/p>/.test(cpSec), '별표 고지문 한 줄씩');
ok(!/<ul>/.test(cpSec), '판권 안 목록은 불릿(ul)으로 나가지 않는다');
// (7) 인용(>) 블록 = 테두리 박스(투고 안내)
ok(/<div class="cp-box"/.test(cpSec), '인용 블록 → 테두리 박스');
ok(/원고 투고를 기다리고/.test(cpSec) && !/<blockquote/.test(cpSec), '박스 안은 문단(blockquote 아님)');
// (8) 러닝헤드 억제 — @page display 가 조각 첫 쪽에 한 쪽 늦게 적용되는 문제(실측) 우회
ok(/<span class="cp-rhclear"><\/span>/.test(cpSec), '뒤 판권은 러닝헤드 문자열을 비운다');
const cpFront = HB.buildBookHtml(BK.parseBookText('# 책\n> 판권위치: 앞(속표지 뒷면)\n> 저자: 갑\n\n## 1장. ㄱ\n본문.\n\n## [판권]\n\n메모.\n', 'x'), { baseDir: 'D:/x' }).html;
const cpFrontSec = (cpFront.match(/<section class="colophon[\s\S]*?<\/section>/) || [''])[0];
ok(/class="colophon cp-front"/.test(cpFrontSec) && !/cp-rhclear/.test(cpFrontSec), '앞 판권은 비우지 않는다(본문 러닝헤드가 사라진다)');
// (9) 판권 배치 — 기본 위(margin-top 0) / 옵션 아래
ok(/section\.colophon \.cp-wrap \{ margin-top: 0; \}/.test(cpHtml), '판권 배치 기본 = 판면 위');
const cpBottom = HB.buildBookHtml(cpBook, { baseDir: 'D:/x', colophonAlign: 'bottom' }).html;
ok(/section\.colophon \.cp-wrap \{ margin-top: 44%; \}/.test(cpBottom), '판권 배치 아래 옵션');
// (10) display/front 페이지는 러닝헤드·폴리오 없음 — 이름만 쓴 @page 는 :left/:right 에 지므로
//      이름+의사클래스를 함께 적는다(특이도 보정)
ok(/@page display:left \{/.test(cpHtml) && /@page display:right \{/.test(cpHtml), '@page display 에 :left/:right 동반');
// (11) 배선 — 조판 패널·main.js 가 판권 배치를 실제로 넘긴다
ok(/colophonAlign: l\.colophonAlign/.test(mainSrc), 'main.js layoutOpts 에 colophonAlign');
ok(/colophonAlign: 'top'/.test(uiSrc), '조판 기본값 = top');
ok(/L\('colophonAlign'/.test(uiSrc), '조판 패널에 판권 배치 select');
ok(/\['editor', '편집인'\]/.test(uiSrc) && /\['blog', '블로그'\]/.test(uiSrc), '책 정보 폼에 편집인·블로그');
ok(/editor: '편집인'/.test(mainSrc) && /facebook: '페이스북'/.test(mainSrc), 'main.js 메타 라벨에 편집인·페이스북');

console.log(`✅ book-md.test.js — ${n} 단언 전부 통과`);
