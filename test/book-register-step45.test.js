'use strict';
/**
 * node test/book-register-step45.test.js — 부크크 4단계(가격정책)·5단계(최종확인) 자동 입력: 가짜 페이지로 흐름 검증
 *   (실제 사이트는 로이 로그인 화면에서 확인 — 화면 글은 로이가 보낸 스크린샷 2026-10-02 에서 옮겼다).
 *   🔴 「도서제출」은 어떤 경우에도 누르지 않는다.
 */
const fs = require('fs'), path = require('path');
const RB = require('../core/book/register-browser');
const RF = require('../core/book/register-fill');
const { parseBookText } = require('../core/parsers/book-parser');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const BODY4 = '가격정책 정가설정 19500 원/권 * 최소가격 19,500원입니다. * 최대 기본정가의 3배까지 설정할 수 있습니다. * 100원대 단위로 설정해야합니다. 정가인하 네, 작가 수익을 낮추고 소비자가격을 인하 하겠습니다. 아니요, 소비자가격을 인하하지 않겠습니다. 외부서점 입점 최종정가 19,500 원';
const BODY5 = '서점소개정보 도서소개 도서목차 저자경력·소개 Ai사용여부 및 기여정도 도서명 21312 페이지수 271 Pages 두께 16.505 mm 판매가 19,500 원 도서제출';
const AI_OPTS = ['AI 활용 여부 및 기여정도', '🟡 본문 전체 작성에 사용', '🔵 표지 및 본문 일부 작성에 사용', '🟣 본문 일부 작성에 사용', '🟤 표지 이미지에만 사용', '⚪ 사용하지 않음'];
const RIGHT_OPTS = ['초상/저작권 보유여부', '🟢 모든 콘텐츠 초상/저작권 보유중', '🔴 초상/저작권 보유하지 않음'];

function fakePage(body, { radioChecked = true } = {}) {
  const calls = []; const state = {};
  const mk = (sel, opt) => {
    const o = { sel, opt, _filter: null };
    o.filter = (f) => { o._filter = f; return o; };
    o.first = () => o;
    o.click = async () => { calls.push('click:' + sel + ':' + String((opt && opt.hasText) || '')); };
    o.fill = async (v) => { calls.push('fill:' + sel + '=' + v); state[sel] = v; };
    o.blur = async () => {};
    o.selectOption = async (v) => { calls.push('select:' + (o._filter && o._filter.hasText) + '=' + v); };
    o.locator = (s2) => ({ evaluateAll: async () => ((o._filter && String(o._filter.hasText).includes('AI')) ? AI_OPTS : RIGHT_OPTS).map((t, i) => ({ v: 'v' + i, t })) });
    return o;
  };
  return { calls, state,
    waitForSelector: async () => {},
    evaluate: async (fn, arg) => (arg !== undefined ? radioChecked : body),
    locator: mk, waitForFunction: async () => {}, on() {} };
}
const book = parseBookText('# 삼국지\n> 저자: 나관중\n> 정가: 19,500원\n> 날개: 있음\n> 한줄소개: 소개 한 줄\n\n## [저자소개]\n나관중은 원말명초의 소설가다.\n\n## 제1회 시작\n본문\n', 'x');
const spread = { widthMm: 518.5, heightMm: 216, spineMm: 16.505 };
const plan = RF.bookkPlan(book, { trimId: 'A5', pages: 271, interiorPdf: 'a_내지.pdf', coverPdf: 'a_표지.pdf', spread });

(async () => {
  console.log('\n[1] 계획');
  ok(plan.step4.price === 19500 && plan.step4.cut === false && plan.step4.external === true, '4단계: 정가 19,500 · 정가인하 안 함 · 외부서점 입점');
  ok(plan.step5.ai === '표지 및 본문 일부 작성에 사용' && plan.step5.rights === '모든 콘텐츠 초상/저작권 보유중', '5단계: AI = 표지 및 본문 일부 작성에 사용 · 저작권 = 보유중(로이 지정)');
  ok(plan.step5.intro === '소개 한 줄' && /나관중/.test(plan.step5.bio) && /시작/.test(plan.step5.toc), '5단계 텍스트: 한줄소개 · 저자소개 · 목차(회목)');
  ok(plan.manual.some((s) => /도서제출/.test(s)) && !plan.manual.some((s) => /5단계 도서소개/.test(s)), '직접 목록: 도서제출만(소개가 있으면 안 올라온다)');
  ok(RF.bookkAiOption('없음') === '사용하지 않음' && RF.bookkAiOption('표지만') === '표지 이미지에만 사용' && RF.bookkAiOption('본문 전체') === '본문 전체 작성에 사용' && RF.bookkAiOption('') === RF.BOOKK_AI_DEFAULT, 'AI 메타 해석(판별력 — 값마다 다른 선택지)');

  console.log('\n[2] 4단계');
  let pg = fakePage(BODY4); const logs = [];
  let r = await RB.fillBookkPrice(pg, plan, (m) => logs.push(m));
  ok(r.failed.length === 0 && r.min === 19500, `최소가격을 화면에서 읽는다(${r.min}) · 실패 없음`);
  ok(pg.calls.some((c) => c === 'fill:input[type=text], input[type=number], input:not([type])=19500'), '정가 19500 입력');
  ok(pg.calls.some((c) => /인하하지 않겠습니다/.test(c)) && pg.calls.some((c) => /입점 원합니다/.test(c)), '정가인하 「아니요」 · 외부서점 「네」 선택');
  ok(!pg.calls.some((c) => /Step|제출|저장/.test(c)), '4단계 함수는 이동·제출·저장을 누르지 않는다(이동은 continueFromStep4)');
  // 판별력: 최소가격보다 낮은 정가 · 100원 단위 아님 · 3배 초과 → 입력하지 않고 알린다
  for (const [price, why] of [[15000, '최소가격'], [19550, '100원 단위'], [70000, '3배']]) {
    pg = fakePage(BODY4); const lg = [];
    r = await RB.fillBookkPrice(pg, { ...plan, step4: { ...plan.step4, price } }, (m) => lg.push(m));
    ok(r.failed.includes('정가') && !pg.calls.some((c) => c.startsWith('fill:')) && lg.some((l) => l.includes(why)), `정가 ${price} → 올리지 않고 알림(${why})`);
  }
  pg = fakePage(BODY4); r = await RB.fillBookkPrice(pg, { ...plan, step4: { ...plan.step4, price: 0 } }, () => {});
  ok(r.failed.length === 0 && !pg.calls.some((c) => c.startsWith('fill:')), '원고에 정가가 없으면 화면 기본값(최소가격) 그대로');
  pg = fakePage(BODY4, { radioChecked: false }); r = await RB.fillBookkPrice(pg, plan, () => {});
  ok(r.failed.includes('정가인하 안 함') && r.failed.includes('외부서점 입점'), '판별: 클릭했는데 체크가 안 되면 실패로 남긴다');

  console.log('\n[3] 5단계');
  pg = fakePage(BODY5); const l5 = [];
  r = await RB.fillBookkFinal(pg, plan, (m) => l5.push(m));
  ok(r.failed.length === 0, '실패 없음 ' + r.failed.join());
  ok(pg.calls.some((c) => c.startsWith('fill:textarea[placeholder*="도서의 설명"]=소개 한 줄')) && pg.calls.some((c) => c.startsWith('fill:textarea[placeholder*="저자를 소개"]')) && pg.calls.some((c) => c.startsWith('fill:textarea[placeholder*="색인"]')), '도서소개·도서목차·저자경력 3칸 입력');
  ok(pg.calls.includes('select:AI 활용 여부=v2') && pg.calls.includes('select:초상/저작권 보유여부=v1'), 'AI = 「표지 및 본문 일부 작성에 사용」(이모지 뗀 글자로 일치) · 저작권 = 「보유중」');
  ok(l5.some((m) => /요약.*일치/.test(m)), '오른쪽 카드(쪽수 271·두께 16.505·판매가 19,500)가 우리 값과 일치');
  ok(!pg.calls.some((c) => /제출|Step|저장/.test(c)) && !pg.calls.some((c) => c.startsWith('click:')), '🔴 5단계에서는 아무것도 클릭하지 않는다(도서제출 포함)');
  // 판별력: 화면 쪽수·판매가가 다르면 불일치로 알린다
  pg = fakePage(BODY5.replace('271 Pages', '300 Pages').replace('판매가 19,500', '판매가 21,000')); const l5b = [];
  r = await RB.fillBookkFinal(pg, plan, (m) => l5b.push(m));
  ok(r.failed.includes('최종확인 요약 불일치') && l5b.some((m) => /페이지수 화면 300/.test(m) && /판매가 화면 21,000/.test(m)), '판별: 쪽수·판매가가 다르면 불일치 보고');
  // 빈 소개는 칸을 건드리지 않는다
  pg = fakePage(BODY5); await RB.fillBookkFinal(pg, { ...plan, step5: { ...plan.step5, intro: '', bio: '' } }, () => {});
  ok(!pg.calls.some((c) => c.includes('도서의 설명')) && !pg.calls.some((c) => c.includes('저자를 소개')), '원고에 없는 소개·저자경력은 빈 칸으로 둔다(직접 목록에 올림)');
  // 선택지에 없는 값이면 실패(추측 선택 금지)
  pg = fakePage(BODY5); r = await RB.fillBookkFinal(pg, { ...plan, step5: { ...plan.step5, ai: '없는 선택지' } }, () => {});
  ok(r.failed.some((f) => /AI 사용여부/.test(f)) && !pg.calls.some((c) => /^select:AI/.test(c)), '선택지에 없으면 추측하지 않고 실패');

  console.log('\n[4] 이동 · 중단 규칙 (continueFromStep4)');
  pg = fakePage(BODY4);
  let bodyNow = BODY4;
  pg.evaluate = async (fn, arg) => (arg !== undefined ? true : bodyNow);
  const origClick = pg.locator;
  pg.locator = (sel, opt) => { const o = origClick(sel, opt); const c0 = o.click; o.click = async () => { await c0(); const t = String((opt && opt.hasText) || ''); if (/Step4/.test(t)) bodyNow = BODY4; if (/Step5/.test(t)) bodyNow = BODY5; }; return o; };
  r = await RB.continueFromStep4(pg, plan, () => {});
  const order = pg.calls.filter((c) => /Step4|Step5|^fill:|^select:/.test(c)).map((c) => (c.match(/Step\d/) || [c.split(':')[0] + ':' + c.split(':')[1].slice(0, 12)])[0]);
  ok(order[0] === 'Step4' && order.indexOf('Step5') > order.indexOf('Step4') && order.some((o) => o.startsWith('select')), '순서: Step4 이동 → 4단계 입력 → Step5 이동 → 5단계 입력 ' + order.join('>'));
  ok(!pg.calls.some((c) => /제출/.test(c)), '🔴 도서제출 클릭 없음');
  // 정가인하 선택이 실패하면 Step5 로 넘어가지 않는다
  pg = fakePage(BODY4, { radioChecked: false }); r = await RB.continueFromStep4(pg, plan, () => {});
  ok(!pg.calls.some((c) => /Step5/.test(c)) && r.failed.includes('정가인하 안 함'), '4단계 선택이 실패하면 5단계로 넘어가지 않는다(틀린 값으로 진행 금지)');

  console.log('\n[5] 안전(소스)');
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'book', 'register-browser.js'), 'utf8');
  const code = src.split(String.fromCharCode(10)).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  const clicks = code.filter((l) => /\.click\(/.test(l));
  ok(/_goStep\(page, 4\)/.test(src) && /_goStep\(page, 5\)/.test(src), '이동 버튼 Step4·Step5 클릭 코드가 있다(번호로 찾는 _goStep)');
  ok(!clicks.some((l) => /제출|저장|승인|유통\s*신청|결제|삭제/.test(l)) && !code.some((l) => /hasText:[^)]*도서\s*제출/.test(l)), '제출·저장·승인·결제·삭제 클릭/선택자 없음');
  console.log(`\n${fail ? '❌' : '✅'} book-register-step45 — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
