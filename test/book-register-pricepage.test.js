'use strict';
/**
 * node test/book-register-pricepage.test.js — 부크크 전자책 4단계를 **실제 Chromium 으로** 흉내 낸 페이지에서 검증(가짜 객체가 아니라 진짜 DOM·이벤트).
 *   로이 2026-10-02 실행: ① 가격을 체크박스보다 먼저 바꾸면 사이트가 alert 를 띄우고 1000 으로 되돌렸다 ② 「첫 text 입력」 선택자가 머리말 검색칸 같은 엉뚱한 칸에 걸려 fill 이 30초 시간 초과했다.
 *   이 페이지는 두 동작을 그대로 재현한다(체크 없이 가격을 바꾸면 alert + 1000 복구).
 */
const RB = require('../core/book/register-browser');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const HTML = (opts = {}) => `<!doctype html><html><body>
<header><input type="text" id="q" placeholder="검색" ${opts.hiddenSearch ? 'style="display:none"' : ''}></header>
<div class="tabs"><a href="#">Step3 꾸미기</a><a href="#">Step5 최종확인</a></div>
<div class="card"><h3>정가설정</h3>
  <input id="price" ${opts.noTypeAttr ? '' : 'type="text"'} value="${opts.emptyValue ? '' : '1000'}"> 원/권
  <div class="warn"><label><input type="checkbox" id="chg"> 도서 정가를 직접 변경하였습니다.</label></div>
</div>
<div class="card"><h3>외부서점 입점</h3>
  <label><input type="radio" name="ext" checked> 네, 외부 온라인 서점(교보문고, YES24, 알라딘 등) 입점 원합니다.</label>
  <label><input type="radio" name="ext"> 아니요, 부크크에서만 판매하며, 다른 서점은 원치 않습니다.</label>
</div>
<aside>최종 정가 <b id="final">1000</b> 원</aside>
<script>
  const price = document.getElementById('price'), chg = document.getElementById('chg'), fin = document.getElementById('final');
  // 부크크 동작 재현: 체크 없이 가격을 바꾸면 alert 후 1000 으로 복구
  price.addEventListener('change', () => {
    if (price.value !== '1000' && !chg.checked) { alert('도서 가격 체크박스를 확인해주세요!'); price.value = '1000'; }
    fin.textContent = price.value;
  });
</script></body></html>`;

(async () => {
  const { chromium } = require('playwright');
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome', headless: true }); } catch (_) { browser = await chromium.launch({ headless: true }); }
  const run = async (opts, plan4) => {
    const page = await browser.newPage();
    const alerts = []; page.on('dialog', async (d) => { alerts.push(d.message()); await d.accept(); });
    await page.setContent(HTML(opts));
    const logs = [];
    const r = await RB.fillBookkEbookPrice(page, { step4: plan4 }, (m) => logs.push(m));
    const state = await page.evaluate(() => ({ price: document.getElementById('price').value, checked: document.getElementById('chg').checked, fin: document.getElementById('final').textContent }));
    await page.close();
    return { r, alerts, state, logs };
  };
  const plan = { price: 12500, external: true, from: 'paper-registered', paper: 17900 };

  console.log('\n[1] 정상: 머리말 검색칸이 앞에 있어도 가격칸을 찾고, 체크 → 가격 순서라 알림 없이 12,500');
  let o = await run({}, plan);
  ok(o.r.failed.length === 0, '실패 없음 ' + o.r.failed.join());
  ok(o.state.price === '12500' && o.state.fin === '12500', `가격 12500 입력됨(${o.state.price}) · 최종정가 ${o.state.fin}`);
  ok(o.state.checked === true, '「직접 변경하였습니다」 체크됨');
  ok(o.alerts.length === 0, '사이트 알림 없음(체크를 먼저 했으므로) ' + o.alerts.join('|'));

  console.log('\n[2] 판별: 머리말 검색칸이 보이고 비어 있어도(옛 「첫 text 입력」 선택자가 걸리던 경우) 정확한 칸에 입력');
  const oldSel = 'input[type=text], input[type=number], input:not([type])';
  { const page = await browser.newPage(); await page.setContent(HTML({})); const firstId = await page.locator(oldSel).first().getAttribute('id'); await page.close();
    ok(firstId === 'q', `옛 선택자는 실제로 엉뚱한 칸(#${firstId})을 잡는다 — 이 테스트가 그 버그를 재현한다`); }

  console.log('\n[3] type 속성이 없는 입력칸 · 값이 비어 있는 칸(정가설정 카드 안 위치로 찾기)');
  o = await run({ noTypeAttr: true }, plan);
  ok(o.state.price === '12500' && o.alerts.length === 0, 'type 속성 없는 가격칸도 입력');
  o = await run({ emptyValue: true }, plan);
  ok(o.state.price === '12500' && o.state.checked, '값이 빈 가격칸도 「정가설정」 카드 안에서 찾아 입력');

  console.log('\n[4] 판별: 순서를 거꾸로(가격 먼저)면 이 페이지는 알림을 띄우고 1000 으로 되돌린다 — 앱은 그 순서를 쓰지 않는다');
  { const page = await browser.newPage(); const al = []; page.on('dialog', async (d) => { al.push(d.message()); await d.accept(); });
    await page.setContent(HTML({})); await page.locator('#price').fill('12500'); await page.locator('#price').blur(); await page.waitForTimeout(100);
    const v = await page.evaluate(() => document.getElementById('price').value); await page.close();
    ok(al.length === 1 && v === '1000', '(재현) 가격을 먼저 바꾸면 알림 1회 + 1000 복구 — 옛 순서가 실패한 이유'); }

  console.log('\n[5] 정가 미정(0)이면 가격·체크를 건드리지 않고 멈춘다');
  o = await run({}, { price: 0, external: true });
  ok(o.r.failed.includes('정가 미정') && o.state.price === '1000' && o.state.checked === false && o.alerts.length === 0, '가격 1000 그대로 · 체크 안 함 · 알림 없음');

  await browser.close();
  console.log(`\n${fail ? '❌' : '✅'} book-register-pricepage — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
