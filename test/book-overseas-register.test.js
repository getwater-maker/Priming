'use strict';
/**
 * node test/book-overseas-register.test.js — 해외 플랫폼 R27: KDP·D2D 등록 「복사 도우미」(항목 · 사이트 칸 이름 · 체크리스트)
 *   · 등록정보 파일(`<작품>.KDP등록정보.md`) 파싱 · 원고 메타 폴백 · 퍼블릭 도메인 점검(제목 괄호 · 설명 첫 줄 80자 · 삽화 10점) · 자동 입력·제출은 만들지 않는다(소스 검사)
 */
const fs = require('fs'), path = require('path'), os = require('os');
const OR = require('../core/book/overseas-register');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const by = (a, id) => a.find((x) => x.id === id);

const INFO = `# Alice — KDP 등록정보
## [Book Details]
- 언어: English
- 제목: Alice's Adventures in Wonderland (Annotated)
- 부제: With Scholar Notes
- 저자: Lewis Carroll
- 기여자: Translator: Roy Han
- 퍼블릭 도메인: 예
## [Description]
• New annotated edition with 12 illustrations and scholar notes
Alice falls down the rabbit hole into a world of nonsense.
## [Keywords]
- classic literature
- victorian fantasy
- annotated alice
## [Categories]
- Fiction > Classics
- Fiction > Fantasy
## [AI]
- AI 신고: AI-assisted translation (text), reviewed by a human editor
## [Price]
- US: 9.99
- UK: 8.99
`;
const META = { title: 'Alice Meta', author: 'Lewis Carroll', translator: 'Roy Han', lang: 'en', keywords: 'a, b, c' };

console.log('[1] 등록정보 파일 읽기');
{
  const p = OR.parseOverseasInfo(INFO);
  ok(p.fields.language === 'English' && p.fields.title === "Alice's Adventures in Wonderland (Annotated)" && p.fields.author === 'Lewis Carroll' && p.fields.subtitle === 'With Scholar Notes', '키 값(언어·제목·부제·저자)');
  ok(/^• New annotated edition/.test(p.fields.description) && /rabbit hole/.test(p.fields.description), '설명 = 본문 그대로(첫 줄 글머리)');
  ok(p.lists.keywords.join('|') === 'classic literature|victorian fantasy|annotated alice' && p.lists.categories.length === 2 && p.lists.price.join('|') === 'US: 9.99|UK: 8.99', '키워드·카테고리·가격 목록');
  ok(p.fields.ai && /AI-assisted/.test(p.fields.ai) && p.fields.contributors === 'Translator: Roy Han', 'AI 신고 · 기여자');
  ok(p.fields.publicDomain === '예', '퍼블릭 도메인 선언');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ovr-')); const md = path.join(T, '원고', 'alice.md'); fs.mkdirSync(path.dirname(md), { recursive: true }); fs.writeFileSync(md, '# a\n');
  fs.mkdirSync(path.join(T, '기준', '등록'), { recursive: true }); fs.writeFileSync(path.join(T, '기준', '등록', 'alice.KDP등록정보.md'), INFO);
  ok(OR.findOverseasInfoFile(md, 'kdp').endsWith('alice.KDP등록정보.md') && OR.findOverseasInfoFile(md, 'd2d') === '' && OR.loadOverseasInfo(md, 'kdp').fields.title.startsWith("Alice's"), '파일 찾기(원고\ → 기준\등록\) · 플랫폼별 이름');
  try { fs.rmSync(T, { recursive: true, force: true }); } catch (_) {}
}

console.log('\n[2] 항목 · 사이트 칸 이름');
{
  const plan = OR.buildPlan({ platformId: 'kdp', meta: META, info: OR.parseOverseasInfo(INFO), facts: { illustrations: 12, hasInterior: true, hasCoverPdf: true } });
  const f = (k) => plan.fields.find((x) => x.key === k);
  ok(f('title').value.endsWith('(Annotated)') && f('title').from === 'file' && f('title').site === 'Book Title', '제목 = 파일 값 · KDP 칸 이름 「Book Title」');
  ok(f('keywords').list.length === 3 && f('keywords').site.includes('7 boxes') && f('categories').list.length === 2 && f('price').list.length === 2, '키워드·카테고리·가격은 목록');
  ok(f('contributors').value.includes('Translator: Roy Han') && f('author').site.includes('First name'), '기여자(번역가) · 저자 칸 안내');
  const meta = OR.buildPlan({ platformId: 'kdp', meta: META, info: null });
  ok(meta.fields.find((x) => x.key === 'title').from === 'meta' && meta.fields.find((x) => x.key === 'title').value === 'Alice Meta' && meta.fields.find((x) => x.key === 'keywords').list.length === 3 && meta.fields.find((x) => x.key === 'contributors').value === 'Translator: Roy Han', '파일이 없으면 원고 메타로 채운다(제목·키워드·번역가)');
  ok(by(meta.checklist, 'file').state === 'warn', '파일이 없으면 알린다');
  const d = OR.buildPlan({ platformId: 'd2d', meta: META, info: null });
  ok(d.fields.some((x) => x.key === 'bisac') && d.fields.find((x) => x.key === 'title').site === 'Title' && !d.fields.some((x) => x.key === 'categories'), 'D2D 는 BISAC · 칸 이름이 다르다');
}

console.log('\n[3] 체크리스트');
{
  const info = OR.parseOverseasInfo(INFO);
  const plan = OR.buildPlan({ platformId: 'kdp', meta: META, info, facts: { illustrations: 12, hasInterior: true, hasCoverPdf: true } });
  const c = plan.checklist;
  ok(by(c, 'title-tag').state === 'ok' && by(c, 'desc-first').state === 'ok' && by(c, 'illustrations').state === 'ok' && by(c, 'contributors').state === 'ok', '퍼블릭 도메인: 제목 (Annotated) · 설명 첫 줄 글머리 80자 이내 · 삽화 12/10 · 번역가 기여자');
  const bad = OR.buildPlan({ platformId: 'kdp', meta: META, info: OR.parseOverseasInfo(INFO.replace(' (Annotated)', '').replace('• New annotated edition with 12 illustrations and scholar notes', 'x'.repeat(120))), facts: { illustrations: 4 } }).checklist;
  ok(by(bad, 'title-tag').state === 'error' && by(bad, 'desc-first').state === 'warn' && by(bad, 'illustrations').state === 'warn' && /4\/10/.test(by(bad, 'illustrations').detail), '제목 표기 없음 = 오류 · 설명 첫 줄 길면 경고 · 삽화 4/10 경고');
  ok(by(c, 'account').state === 'manual' && by(c, 'submit').state === 'manual' && by(c, 'isbn').state === 'manual' && by(c, 'proof').state === 'manual', '계정·세금·ISBN·교정본·제출은 로이(manual) — 앱이 대신하지 않는다');
  const ko = OR.buildPlan({ platformId: 'kdp', meta: { ...META, lang: 'ko' }, info: OR.parseOverseasInfo(INFO.replace('English', '한국어')) });
  ok(by(ko.checklist, 'lang').state === 'error', 'KDP + 한국어 = 오류');
  const kw = OR.buildPlan({ platformId: 'kdp', meta: META, info: OR.parseOverseasInfo(INFO.replace('- annotated alice', '- annotated alice\n- k4\n- k5\n- k6\n- k7\n- k8')) }).checklist;
  ok(by(kw, 'keywords').state === 'warn' && /7개를 넘으면/.test(by(kw, 'keywords').detail), '키워드 7개 초과 경고');
  ok(!OR.buildPlan({ platformId: 'kdp', meta: META, info: OR.parseOverseasInfo(INFO.replace('퍼블릭 도메인: 예', '퍼블릭 도메인: 아니오')) }).checklist.some((x) => x.id === 'title-tag'), '퍼블릭 도메인이 아니면 파생판 점검은 건너뛴다');
  const dd = OR.buildPlan({ platformId: 'd2d', meta: META, info: null, facts: {} }).checklist;
  ok(by(dd, 'dup').state === 'manual' && by(dd, 'epub').state === 'warn' && by(dd, 'bisac'), 'D2D: 아마존 중복 유통 경고 · ePub · BISAC');
}

console.log('\n[3b] 양식 파일(docs/양식 — 출판 세션이 이 꼴로 작품별 파일을 쓴다)');
{
  const dir = path.join(__dirname, '..', 'docs', '양식');
  const meta = { lang: 'en', translator: 'Roy Han' };
  for (const [pid, file] of [['kdp', 'KDP등록정보_양식.md'], ['d2d', 'D2D등록정보_양식.md']]) {
    const info = OR.parseOverseasInfo(fs.readFileSync(path.join(dir, file), 'utf8')); info.file = file;
    const plan = OR.buildPlan({ platformId: pid, meta, info, facts: {} });
    const c = plan.checklist, f = (k) => plan.fields.find((x) => x.key === k);
    ok(/\(Annotated\)$/.test(f('title').value) && f('title').from === 'file' && f('author').value === 'L. M. Montgomery' && f('contributors').list.length === 2, `${pid} 양식: 제목·저자·기여자 2명(번역가·삽화가)`);
    ok(by(c, 'title-tag').state === 'ok' && by(c, 'desc-first').state === 'ok' && by(c, 'illustrations').state === 'ok' && /12\/10/.test(by(c, 'illustrations').detail), `${pid} 양식: 퍼블릭 도메인 점검 통과(제목 표기 · 설명 첫 줄 · 삽화수 12/10 — 파일의 「삽화수」)`);
    ok(by(c, 'keywords').state === 'ok' && by(c, 'ai').state === 'ok' && by(c, 'price').state === 'ok' && by(c, pid === 'kdp' ? 'categories' : 'bisac').state === 'ok' && f('isbn').value, `${pid} 양식: 키워드·AI 신고·가격·${pid === 'kdp' ? '카테고리' : 'BISAC'}·ISBN 방식`);
  }
}

console.log('\n[4] 하지 않는 것(소스 검사)');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'book', 'overseas-register.js'), 'utf8');
  ok(!/page\.(click|fill|type)|playwright|chromium|puppeteer|\.submit\(|require\('\.\/register-browser'\)/.test(src), '자동 입력·클릭·제출 코드가 없다(복사 도우미만)');
}
console.log(`\n${fail ? '❌' : '✅'} book-overseas-register ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
