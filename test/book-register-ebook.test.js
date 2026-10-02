'use strict';
/**
 * node test/book-register-ebook.test.js — 부크크 「새전자책」 자동 입력(1~5단계): 가짜 페이지로 흐름 검증
 *   (화면 글·칸은 로이가 보낸 스크린샷 + 화면 기록 2026-10-02 에서 옮겼다 — 실제 사이트는 로이가 로그인해 같이 확인).
 *   🔴 「도서제출」은 어떤 경우에도 누르지 않는다.
 */
const fs = require('fs'), path = require('path'), os = require('os');
const RB = require('../core/book/register-browser');
const RF = require('../core/book/register-fill');
const { parseBookText } = require('../core/parsers/book-parser');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const BODY4 = '가격정책 정가설정 1000 원/권 도서 정가를 직접 변경하였습니다. 외부서점 입점 최종 정가 1000 원';
const BODY5 = '서점소개정보 도서소개 도서목차 저자경력·소개 Ai사용여부 및 기여정도\n도서명 2435\n종류 전자도서\n파일 [전자책] 삼국지_제1권.epub\n용량 6.55 MB\n외부유통 사용\n판매가격 9,900 원 도서제출';
const AI_OPTS = ['AI 활용 여부 및 기여정도', '🟡 본문 전체 작성에 사용', '🔵 표지 및 본문 일부 작성에 사용', '🟣 본문 일부 작성에 사용', '🟤 표지 이미지에만 사용', '⚪ 사용하지 않음'];
const RIGHT_OPTS = ['초상/저작권 보유여부', '🟢 모든 콘텐츠 초상/저작권 보유중', '🔴 초상/저작권 보유하지 않음'];
const GENRES = ['선택', '- 소설', '소설 - 소설 일반', '소설 - 고전 문학'];

function fakePage(body, { checked = true, blueActive = true, strip = false, mangle = false } = {}) {
  const calls = []; const state = {};
  const mk = (sel, opt) => {
    const o = { sel, opt, _filter: null };
    o.filter = (f) => { o._filter = f; return o; };
    o.first = () => o; o.nth = (n) => { const x = mk(sel + '#' + n, opt); return x; };
    o.click = async () => { calls.push('click:' + sel + ':' + String((opt && (opt.hasText || '')) || '')); };
    o.fill = async (v) => { calls.push('fill:' + sel + '=' + v); state[sel] = mangle ? 'xx' : strip ? String(v).replace(/[:]/g, '') : v; };
    o.blur = async () => {};
    o.inputValue = async () => state[sel] || '';
    o.setInputFiles = async (f) => { calls.push('upload:' + path.basename(f)); };
    o.selectOption = async (v) => { const list = sel.endsWith('#2') ? GENRES : (o._filter && String(o._filter.hasText).includes('AI')) ? AI_OPTS : (o._filter ? RIGHT_OPTS : null); if (list && typeof v === 'string') o._chosen = (list[Number(v.replace(/^v/, ''))] || ''); state['chosen:' + sel + (o._filter ? String(o._filter.hasText) : '')] = o._chosen; calls.push('select:' + (sel.startsWith('select#') ? sel : (o._filter && o._filter.hasText)) + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)); };
    o.evaluate = async () => (state['chosen:' + sel + (o._filter ? String(o._filter.hasText) : '')] || '');
    o.locator = () => ({ evaluateAll: async () => ((sel.endsWith('#2')) ? GENRES : (o._filter && String(o._filter.hasText).includes('AI')) ? AI_OPTS : RIGHT_OPTS).map((t, i) => ({ v: 'v' + i, t })) });
    return o;
  };
  const urlFn = () => 'https://bookk.co.kr/author/make/electronicBook/abc';
  return { calls, state, url: urlFn,
    waitForSelector: async () => {},
    evaluate: async (fn, arg) => { const src = String(fn);
      if (/#blue/.test(src)) return blueActive;
      if (/checkbox/.test(src)) return checked;
      if (arg !== undefined) return checked;
      return body; },
    locator: mk, waitForFunction: async () => { calls.push('waitUploaded'); }, on() {} };
}

(async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ebk-'));
  const epub = path.join(T, '[전자책] 삼국지_제1권.epub'); fs.writeFileSync(epub, 'PK');
  const cover = path.join(T, '_ebook-cover.jpg'); fs.writeFileSync(cover, 'jpg');
  const book = parseBookText('# 삼국지\n> 저자: 나관중\n> 전자책: 9,900원\n> 한줄소개: 소개 한 줄\n> ISBN: 979-11-000-0000-0\n\n## [저자소개]\n나관중은 원말명초의 소설가다.\n\n## 제1회 시작\n본문\n', 'x');
  const plan = RF.ebookPlan(book, { epub, cover });

  console.log('\n[1] 계획');
  ok(plan.kind === 'ebook' && plan.step2.epub === epub && plan.step2.epubName === '[전자책] 삼국지_제1권.epub' && plan.step3.cover === cover, 'ePub·표지 경로');
  ok(plan.step3.logo === 'blue', '로고 = 파란색');
  ok(plan.step4.price === 9900 && plan.step4.external === true, '4단계: 전자책 정가 9,900 · 외부서점 입점');
  ok(plan.step1.isbnMode === 'bookk' && plan.step1.isbn === '', '🔑 종이책 ISBN(원고 `ISBN`)은 전자책에 쓰지 않는다(전자책 ISBN 없으면 부크크 무료 발급)');
  ok(RF.ebookPlan(parseBookText('# t\n> 저자: a\n> 전자책 ISBN: 979-11-111-1111-1\n', 'x'), {}).step1.isbnMode === 'other', '전자책 ISBN 이 있으면 「이미 보유한 ISBN」');
  ok(plan.step5.ai === '표지 및 본문 일부 작성에 사용' && /나관중/.test(plan.step5.bio) && plan.step5.intro === '소개 한 줄', '5단계 값(AI·저자경력·소개)');
  ok(plan.manual.some((s) => /도서제출/.test(s)) && !plan.manual.some((s) => /ePub\(없음|표지\(JPG/.test(s)), '직접 목록: 도서제출만');
  const none = RF.ebookPlan(parseBookText('# t\n> 저자: a\n', 'x'), {});
  ok(none.manual.some((s) => /ePub\(없음/.test(s)) && none.manual.some((s) => /3단계 표지/.test(s)) && none.manual.some((s) => /정가/.test(s)), '판별: 파일·표지·정가가 없으면 직접 목록에 이유');
  // 💰 정가 = 종이책의 70%, 10원 단위 이하 버림
  ok(RF.ebookPriceFromPaper(19500) === 13600 && RF.ebookPriceFromPaper(15000) === 10500 && RF.ebookPriceFromPaper(12800) === 8900 && RF.ebookPriceFromPaper(10000) === 7000, '19,500→13,600 · 15,000→10,500 · 12,800→8,900(8,960 내림) · 10,000→7,000');
  ok(RF.ebookPriceFromPaper(0) === 0 && RF.ebookPriceFromPaper('') === 0 && RF.ebookPriceFromPaper(100) === 0, '종이책 정가 없음/너무 낮음 → 0(계산 안 함)');
  const pp = RF.ebookPlan(parseBookText(['# t', '> 저자: a', '> 정가: 19,500원', ''].join(String.fromCharCode(10)), 'x'), {});
  ok(pp.step4.price === 13600 && pp.step4.from === 'paper70' && pp.step4.paper === 19500, '🔑 원고 정가 19,500원 → 전자책 13,600원(종이책 70% 내림)');
  ok(plan.step4.from === 'ebook' && plan.step4.price === 9900, '`> 전자책:` 가격을 따로 적으면 그 값이 이긴다(판권지와 같게)');
  ok(!pp.manual.some((s) => /4단계 정가/.test(s)) && none.manual.some((s) => /종이책 `> 정가:`/.test(s)), '정가를 계산했으면 직접 목록에 안 올린다 · 종이책 정가도 없으면 이유와 함께 올린다');
  const withRi = RF.ebookPlan(book, { epub, cover, registerInfo: { title: '삼국지 완역 1 : 천하대란', subtitle: '1-15', author: '나관중', genre: '', isbnText: '979-11-999-9999-9', intro: '', toc: '', bio: '', ai: '', rights: '' } });
  ok(withRi.step1.title === '삼국지 완역 1 : 천하대란' && withRi.step1.subtitle === '1-15' && withRi.step1.isbnMode === 'bookk', '등록정보 파일이 원고 메타보다 우선(제목) · 종이책 ISBN 은 무시');

  console.log('\n[2] 1단계 기본정보');
  let pg = fakePage(BODY4); const logs = [];
  let r = await RB.fillBookkEbookInfo(pg, plan, (m) => logs.push(m));
  ok(r.done.includes('도서명') && r.done.includes('저자') && r.done.includes('대표 장르') && r.done.includes('성인도서 여부'), '도서명·저자·장르·성인 입력 ' + r.done.join(','));
  ok(pg.calls.includes('fill:input[placeholder*="도서명 기재"]=삼국지') && pg.calls.includes('fill:input[placeholder*="저자명 기재"]=나관중'), '도서명·저자 칸 값');
  ok(pg.calls.some((c) => c.startsWith('select:select#6')), '성인도서 여부는 일곱 번째 select');
  ok(!pg.calls.some((c) => /input\[type=number\]|upload/.test(c)), '전자책 1단계에는 쪽수·파일 칸이 없다');

  // 🔑 부크크가 도서명의 특수문자(:)를 지워도 실패가 아니다(2026-10-02 로이 실행: 「삼국지 완역 2 : 조조…」 → 「삼국지 완역 2 조조…」 때문에 1단계에서 멈췄다)
  const colon = { ...plan, step1: { ...plan.step1, title: '삼국지 완역 2 : 조조 천하를 노리다' } };
  pg = fakePage(BODY4, { strip: true }); r = await RB.fillBookkEbookInfo(pg, colon, () => {});
  ok(r.failed.length === 0, '사이트가 「:」 를 지워도 도서명 되짚기는 통과 ' + r.failed.join());
  pg = fakePage(BODY4, { mangle: true }); r = await RB.fillBookkEbookInfo(pg, colon, () => {});
  ok(r.failed.includes('도서명 확인'), '판별: 글자가 달라진 진짜 불일치는 여전히 실패');

  console.log('\n[3] 2단계 ePub');
  pg = fakePage(BODY4); r = await RB.fillBookkEbookManuscript(pg, plan, () => {});
  ok(r.failed.length === 0 && pg.calls.includes('upload:[전자책] 삼국지_제1권.epub') && pg.calls.includes('waitUploaded'), 'ePub 첨부 · 업로드 완료 대기');
  pg = fakePage(BODY4); r = await RB.fillBookkEbookManuscript(pg, { ...plan, step2: { epub: path.join(T, 'none.epub') } }, () => {});
  ok(r.failed.includes('ePub 없음') && !pg.calls.some((c) => c.startsWith('upload')), '판별: ePub 파일이 없으면 올리지 않고 알린다');
  const big = path.join(T, 'big.epub'); fs.closeSync(fs.openSync(big, 'w')); fs.truncateSync(big, 21 * 1048576);
  pg = fakePage(BODY4); r = await RB.fillBookkEbookManuscript(pg, { ...plan, step2: { epub: big } }, () => {});
  ok(r.failed.includes('ePub 20MB 초과') && !pg.calls.some((c) => c.startsWith('upload')), '판별: 20MB 초과는 올리지 않는다');

  console.log('\n[4] 3단계 표지 + 파란 로고');
  pg = fakePage(BODY4); r = await RB.fillBookkEbookCover(pg, plan, () => {});
  ok(r.failed.length === 0 && r.done.join() === '직접 올리기 탭,표지 업로드,로고 파랑', `탭 → 표지 → 로고 (${r.done.join(' → ')})`);
  ok(pg.calls.includes('upload:_ebook-cover.jpg') && pg.calls.some((c) => c.startsWith('click:a[href="#blue"]')), '표지 JPG 첨부 · 파란 로고 클릭');
  pg = fakePage(BODY4, { blueActive: false }); r = await RB.fillBookkEbookCover(pg, plan, () => {});
  ok(r.failed.includes('로고 파랑'), '판별: 눌렀는데 active 가 안 붙으면 실패로 남긴다');
  const png = path.join(T, 'c.png'); fs.writeFileSync(png, 'png');
  pg = fakePage(BODY4); r = await RB.fillBookkEbookCover(pg, { ...plan, step3: { ...plan.step3, cover: png } }, () => {});
  ok(r.failed.includes('표지 형식') && !pg.calls.some((c) => c.startsWith('upload')), '판별: PNG 는 올리지 않는다(JPG·PDF 만)');
  pg = fakePage(BODY4); r = await RB.fillBookkEbookCover(pg, { ...plan, step3: { ...plan.step3, cover: '' } }, () => {});
  ok(r.failed.includes('표지 없음'), '표지가 없으면 알린다');

  console.log('\n[5] 4단계 정가');
  pg = fakePage(BODY4); r = await RB.fillBookkEbookPrice(pg, plan, () => {});
  ok(r.failed.length === 0 && pg.calls.includes('fill:input[type=text], input[type=number], input:not([type])=9900'), '정가 9900 입력');
  const iFill = pg.calls.findIndex((c) => c.startsWith('fill:')); const iChk = pg.calls.findIndex((c) => /직접 변경하였습니다/.test(c));
  ok(iChk > iFill && iFill >= 0, '🔑 정가를 바꾼 뒤 「직접 변경하였습니다」 체크(안 하면 사이트가 막는다)');
  ok(pg.calls.some((c) => /입점 원합니다/.test(c)) && !pg.calls.some((c) => /인하하지/.test(c)), '외부서점 「네」 · 정가인하 칸은 없다');
  pg = fakePage(BODY4, { checked: false }); r = await RB.fillBookkEbookPrice(pg, plan, () => {});
  ok(r.failed.includes('정가 직접 변경 체크'), '판별: 체크가 안 되면 실패');
  pg = fakePage(BODY4); r = await RB.fillBookkEbookPrice(pg, { ...plan, step4: { ...plan.step4, price: 9950 } }, () => {});
  ok(r.failed.includes('정가') && !pg.calls.some((c) => c.startsWith('fill:')), '판별: 100원 단위가 아니면 입력하지 않는다');
  pg = fakePage(BODY4); const l4 = []; r = await RB.fillBookkEbookPrice(pg, { ...plan, step4: { ...plan.step4, price: 0 } }, (m) => l4.push(m));
  ok(!pg.calls.some((c) => c.startsWith('fill:')) && !pg.calls.some((c) => /직접 변경/.test(c)) && l4.some((m) => /1,000원/.test(m)), '원고에 정가가 없으면 화면 기본값 그대로 + 경고(체크도 안 함)');

  console.log('\n[6] 5단계 요약(전자책 카드)');
  pg = fakePage(BODY5); const l5 = [];
  r = await RB.fillBookkFinal(pg, plan, (m) => l5.push(m));
  ok(r.failed.length === 0 && l5.some((m) => /요약.*일치/.test(m)), '판매가격·파일이 우리 값과 일치 ' + r.failed.join());
  pg = fakePage(BODY5.replace('9,900', '1,000')); r = await RB.fillBookkFinal(pg, plan, () => {});
  ok(r.failed.includes('최종확인 요약 불일치'), '판별: 판매가격이 다르면(기본 1,000원이 남은 경우) 불일치');
  pg = fakePage(BODY5.replace('삼국지_제1권.epub', '다른책.epub')); r = await RB.fillBookkFinal(pg, plan, () => {});
  ok(r.failed.includes('최종확인 요약 불일치'), '판별: 올라간 파일 이름이 다르면 불일치');

  console.log('\n[7] 전체 흐름 · 이동 · 중단');
  let bodyNow = '도서 제작 목적'; const pgF = fakePage(bodyNow);
  const orig = pgF.locator; const stepOf = { 'Step2 원고등록': '원고 업로드', 'Step3 꾸미기': '구매한 템플릿', 'Step4 가격정책': BODY4, 'Step5 최종확인': BODY5 };
  pgF.locator = (sel, opt) => { const o = orig(sel, opt); const c0 = o.click; o.click = async () => { await c0(); const t = String((opt && opt.hasText) || ''); if (stepOf[t]) bodyNow = stepOf[t]; }; return o; };
  const ev0 = pgF.evaluate;
  pgF.evaluate = async (fn, arg) => { const src = String(fn); if (/#blue|checkbox/.test(src) || arg !== undefined) return ev0(fn, arg); return bodyNow; };
  r = await RB.fillBookkEbook(pgF, plan, () => {});
  const nav = pgF.calls.filter((c) => /Step\d/.test(c)).map((c) => c.match(/Step\d/)[0]);
  ok(r.failed.length === 0 && nav.join() === 'Step2,Step3,Step4,Step5', '이동 순서 Step2 → Step3 → Step4 → Step5 · 실패 없음 ' + r.failed.join());
  ok(!pgF.calls.some((c) => /제출|저장/.test(c)), '🔴 도서제출·저장 클릭 없음');
  // 앞 단계 실패 → 멈춘다
  const pgS = fakePage('도서 제작 목적');
  r = await RB.runEbookFrom(pgS, { ...plan, step2: { epub: '' } }, () => {}, 2);
  ok(!pgS.calls.some((c) => /Step3/.test(c)) && r.failed.includes('ePub 없음'), '2단계(ePub 없음) 실패 → 3단계로 넘어가지 않는다');

  console.log('\n[8] 안전(소스)');
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'book', 'register-browser.js'), 'utf8');
  const code = src.split(String.fromCharCode(10)).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  const clicks = code.filter((l) => /\.click\(/.test(l));
  ok(!clicks.some((l) => /제출|저장|승인|유통\s*신청|결제|삭제/.test(l)) && !code.some((l) => /hasText:[^)]*도서\s*제출/.test(l)), '제출·저장·승인·결제·삭제 클릭/선택자 없음');
  ok(/EBOOK_NAV\s*=\s*\{[^}]*Step2 원고등록[^}]*Step3 꾸미기[^}]*Step4 가격정책[^}]*Step5 최종확인[^}]*\}/.test(src), '전자책 이동 버튼은 Step2~Step5 네 개뿐');
  fs.rmSync(T, { recursive: true, force: true });
  console.log(`\n${fail ? '❌' : '✅'} book-register-ebook — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
