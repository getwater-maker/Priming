'use strict';
/** node test/book-register-step3.test.js — 부크크 3단계(표지디자인) 자동 입력: 가짜 페이지로 흐름 검증(실제 사이트는 로이 로그인 화면에서 확인) */
const fs = require('fs'), path = require('path'), os = require('os');
const RB = require('../core/book/register-browser');
const RF = require('../core/book/register-fill');
const { parseBookText } = require('../core/parsers/book-parser');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
// 로이가 보낸 3단계 화면(2026-10-02)의 글: A5 · 날개 있음 · 책등 16.505mm · 518.50×216mm
const BODY = '표지디자인 표지 주의사항 표지 파일은 100MB까지 업로드가 가능합니다. 첨부 가능한 파일형식은 JPG, PDF 2가지로 업로드 파일 없음 0 Kb 판형정보 판형 A5 날개 있음 책등 16.505 mm 작업규격 518.50mm(가로)*216mm(세로) 100(앞날개)+151(뒷표지)+16.505(책등)+151(앞표지)+100(앞날개)';
function fakePage(body) {
  const calls = [];
  const loc = (sel) => { const o = { sel, _f: null };
    o.filter = (f) => { o._f = f; return o; }; o.first = () => o;
    o.click = async () => { calls.push('click:' + sel + (o._f ? ':' + String(o._f.hasText) : '')); };
    o.setInputFiles = async (f) => { calls.push('upload:' + path.basename(f)); };
    return o; };
  return { calls,
    waitForSelector: async () => {}, evaluate: async () => body,
    locator: (sel) => loc(sel), waitForFunction: async () => { calls.push('waitUploaded'); }, on() {} };
}
(async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 's3-'));
  const pdf = path.join(T, 'a_표지.pdf'); fs.writeFileSync(pdf, '%PDF');
  const book = parseBookText('# t\n> 저자: a\n> 날개: 있음\n', 'x');
  const spread = { widthMm: 518.5, heightMm: 216, spineMm: 16.505 };
  console.log('\n[1] 계획');
  const plan = RF.bookkPlan(book, { trimId: 'A5', pages: 271, interiorPdf: 'a_내지.pdf', coverPdf: pdf, spread });
  ok(plan.step3.coverPdf === pdf && plan.step3.expect.widthMm === 518.5 && plan.step3.tab === '직접 올리기', '3단계 계획: 표지 PDF·기대 규격·탭');
  ok(!plan.manual.some((s) => /3단계 표지 등록/.test(s)) && plan.manual.some((s) => /로고/.test(s)) && plan.manual.some((s) => /도서제출/.test(s)), '직접 목록: 로고 선택·도서제출(3~5단계 입력은 자동으로 옮김)');
  ok(RF.bookkPlan(book, { trimId: 'A5', pages: 271, interiorPdf: 'x' }).manual.some((s) => /표지 PDF\(없음/.test(s)), '표지 PDF 가 없으면 직접 목록에 이유');
  console.log('\n[2] 흐름 (가짜 페이지)');
  let pg = fakePage(BODY); const logs = [];
  let r = await RB.fillBookkCover(pg, plan, (m) => logs.push(m));
  ok(r.failed.length === 0 && r.done.join() === '직접 올리기 탭,표지 PDF 업로드', `직접 올리기 탭 → PDF 업로드 (${r.done.join(' → ')})`);
  ok(pg.calls.some((c) => /^click:a, button.*직접/.test(c)) && pg.calls.includes('upload:a_표지.pdf') && pg.calls.includes('waitUploaded'), '탭 클릭 · 파일 첨부 · 업로드 완료 대기');
  ok(logs.some((l) => /518\.5×216mm · 책등 16\.505mm/.test(l)), '화면 작업규격을 읽어 로그에 남긴다: ' + (logs.find((l) => /작업규격/.test(l)) || '').slice(0, 70));
  ok(!pg.calls.some((c) => /Step4|가격정책|저장|제출/.test(c)), '4단계·저장·제출은 누르지 않는다');
  // 판별력: 책등이 다른 표지(14.3mm → 516.3mm)는 올리지 않는다
  pg = fakePage(BODY); const logs2 = [];
  r = await RB.fillBookkCover(pg, { ...plan, step3: { ...plan.step3, expect: { widthMm: 516.3, heightMm: 216, spineMm: 14.3 } } }, (m) => logs2.push(m));
  ok(r.failed.includes('표지 규격 불일치') && !pg.calls.some((c) => c.startsWith('upload')), '판별: 화면 규격과 표지 규격이 ±1mm 밖이면 올리지 않는다');
  ok(logs2.some((l) => /다시 만든 뒤 올리세요/.test(l)), '이유 안내: 새 책등으로 표지를 다시 만들라');
  pg = fakePage(BODY); r = await RB.fillBookkCover(pg, { ...plan, step3: { ...plan.step3, coverPdf: path.join(T, 'none.pdf') } }, () => {});
  ok(r.failed.includes('표지 PDF 없음') && !pg.calls.some((c) => c.startsWith('upload')), '표지 PDF 파일이 없으면 올리지 않고 알린다');
  pg = fakePage('작업규격 문구 없음'); r = await RB.fillBookkCover(pg, plan, () => {});
  ok(pg.calls.some((c) => c.startsWith('upload')), '규격 문구를 못 읽으면 대조만 건너뛰고 올린다(fail-open — 화면에서 사람이 확인)');
  fs.rmSync(T, { recursive: true, force: true });
  console.log('\n[2b] 🔔 사이트 확인창(alert/confirm) — 자동 취소로 사라지던 문제');
  {
    const mk = (type, message) => { const r = { acc: 0, dis: 0 }; return { type: () => type, message: () => message, accept: async () => { r.acc++; }, dismiss: async () => { r.dis++; }, r }; };
    const hook = async (asker) => { let h; RB.setDialogAsker(asker); RB.hookDialogs({ on: (ev, fn) => { h = fn; } }, () => {}); return h; };
    let asked = [];
    let h = await hook(async (t, m) => { asked.push(t + ':' + m); return true; });
    let d = mk('confirm', '표지를 이대로 진행할까요?'); await h(d);
    ok(d.r.acc === 1 && d.r.dis === 0 && asked[0] === 'confirm:표지를 이대로 진행할까요?', 'confirm → 앱 창에서 묻고 「확인」이면 accept');
    h = await hook(async () => false); d = mk('confirm', 'x'); await h(d);
    ok(d.r.dis === 1 && d.r.acc === 0, '판별: 「취소」면 dismiss');
    h = await hook(async () => { throw new Error('창 없음'); }); d = mk('confirm', 'x'); await h(d);
    ok(d.r.dis === 1, '못 물으면 취소(안전한 쪽)');
    asked = []; h = await hook(async (t, m) => { asked.push(t); return true; }); d = mk('alert', '파일 형식이 맞지 않습니다'); await h(d);
    ok(d.r.acc === 1 && asked[0] === 'alert', 'alert → 내용을 앱 창에 보여 주고 accept(읽을 새 없이 사라지지 않게)');
    h = await hook(null); d = mk('confirm', 'x'); await h(d);
    ok(d.r.dis === 1, '앱이 질문 함수를 못 넣은 경우에도 멈추지 않는다(취소)');
  }
  console.log('\n[3] 안전');
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'book', 'register-browser.js'), 'utf8');
  const clicks = src.split(String.fromCharCode(10)).filter((l) => /\.click\(/.test(l));
  ok(!clicks.some((l) => /제출|저장|승인|유통\s*신청|최종(?!확인)/.test(l)), '저장·제출·승인 클릭 코드 없음(Step4·Step5 이동만 허용 — book-register-step45 가 검사)');
  console.log(`\n${fail ? '❌' : '✅'} book-register-step3 — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
