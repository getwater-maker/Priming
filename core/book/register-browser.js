'use strict';
/**
 * register-browser.js — 📤 등록 도우미 「자동 입력」 브라우저 구동(작가와 · 부크크).
 *
 * 흐름: 전용 크롬 프로필(로그인 유지) 실행 → 사이트 열기 → **로이가 로그인**(우리는 아이디·비밀번호를 다루지 않는다) → 입력·파일 첨부 → **멈춘다**.
 * 🔴 저장 · 제출 · 유통 신청 · 최종 입점 · 승인 버튼은 누르지 않는다(코드에 그런 클릭이 없다 — 테스트가 소스를 검사한다). 5단계 「도서제출」은 로이가 직접(로이 2026-10-02 「자동제출은 금지」).
 *   누르는 이동 버튼은 Step2 원고등록 · Step3 표지디자인 · Step4 가격정책 · Step5 최종확인 뿐이다.
 * 🔑 셀렉터 정책: 클래스(해시)·nth-child 금지. 작가와는 폼 칸 이름(G-…), 부크크는 글자·placeholder·role 로 찾는다.
 *   못 찾으면 화면 상태를 `[DUMP …]` 로 남긴다(다음 수정의 근거).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROFILE_DIR = path.join(os.homedir(), '.priming-maker', 'book-register-profile');
const SITES = {
  // home = 처음 여는 화면 — 부크크는 로그인 화면(로이 2026-10-02: 로그인하면 successReturnUrl=/ 로 첫 화면으로 간다)
  bookk: { label: '부크크', start: 'https://bookk.co.kr/author/make/paperBook', home: 'https://bookk.co.kr/login?successReturnUrl=/' },
  bookkEbook: { label: '부크크 전자책', start: 'https://bookk.co.kr/author/make/electronicBook', home: 'https://bookk.co.kr/login?successReturnUrl=/' },
  jakkawa: { label: '작가와', start: 'https://www.jakkawa.com/making-books1', home: 'https://www.jakkawa.com/' },
};

let _ctx = null;   // 열려 있는 컨텍스트(한 번에 하나)
// 🔔 사이트의 alert/confirm 창 처리(로이 2026-10-02 「3단계에서 다음으로 넘어가려니 팝업이 뜨는데 바로 사라져버리네」).
//   자동화 크롬(Playwright)은 자바스크립트 대화상자를 **자동으로 취소**하고 사용자에게 보이지 않는다 → 사이트의 확인창이 눈 깜빡할 새 사라져 다음 단계로 못 넘어갔다.
//   이제 창 내용을 로그에 남기고, alert 는 확인(내용을 읽을 수 있게 앱에 알림), confirm/prompt 는 **앱 창에서 로이에게 묻는다**(askDialog — main 이 넣는다).
let _dialogAsker = null;
function setDialogAsker(fn) { _dialogAsker = fn; }
let _dlgCount = 0;   // 사이트 대화상자가 뜬 횟수 — 이동 버튼을 눌렀을 때 확인창이 떠서 click 이 시간 초과한 경우를 가려낸다
const AUTO_CONFIRM = /선택하신\s*로고\s*색상\s*\(\s*파랑\s*\)/;   // 「선택하신 로고 색상(파랑)입니다. 현재 설정으로 진행할까요?」 — 이 확인창만 자동 확인
const _hooked = new WeakSet();
function _hookDialogs(page, log) {
  if (_hooked.has(page)) return;
  _hooked.add(page);
  page.on('dialog', async (d) => {
    _dlgCount++;
    const type = d.type(); const msg = String(d.message() || '');
    log(`[등록] 🔔 부크크 ${type} 창: ${msg.replace(/\s+/g, ' ').slice(0, 240)}`);
    let accept = true;
    if (type === 'confirm' && AUTO_CONFIRM.test(msg)) {
      log('[등록] ✓ 로고 색상 확인창 — 우리가 고른 파란색이라 자동으로 「확인」합니다');   // 3단계 → 4단계 이동 때 뜬다(로이 2026-10-02 「팝업에서 멈추네」). 파랑이 아닌 색이면 묻는다
    } else if (type === 'confirm' || type === 'prompt') {
      accept = false;
      try { if (_dialogAsker) accept = !!(await _dialogAsker(type, msg)); } catch (_) { accept = false; }   // 못 물으면 취소(안전한 쪽)
    }   // alert 는 로그에만 남기고 자동 확인(앱 팝업 없음 — 로이 2026-10-02)
    try { if (accept) await d.accept(); else await d.dismiss(); } catch (_) {}
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 단계 이동 버튼 — 「Step3 …」 처럼 **번호로** 찾는다(부크크가 버튼 이름을 바꿔도 따라간다: 종이책 3단계는 「표지디자인」→「표지등록」, 전자책은 「꾸미기」 · 로이 2026-10-02).
 * 🔴 누르는 이동 버튼은 Step2~Step5 뿐(도서제출 아님). 누르자마자 사이트 확인창이 떠서 click 이 시간 초과하면(앱 창에서 답을 기다리는 동안) 실패로 보지 않고 이동한 것으로 이어 간다.
 */
async function _goStep(page, n) {
  const before = _dlgCount;
  try { await page.locator('a, button', { hasText: new RegExp('Step' + n + '(?!\\d)') }).first().click({ timeout: 8000 }); }
  catch (e) { if (_dlgCount > before) { await sleep(500); return; } throw e; }
}

async function _launch(log) {
  const { chromium } = require('playwright');
  const CP = require('../chrome-profile');
  try { if (_ctx) { await _ctx.close(); } } catch (_) {}
  _ctx = null;
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  CP.cleanProfile(PROFILE_DIR);
  const opts = { headless: false, viewport: null, args: ['--start-maximized'], acceptDownloads: false };
  try { _ctx = await chromium.launchPersistentContext(PROFILE_DIR, { ...opts, channel: 'chrome' }); }
  catch (e1) {
    log('[등록] ⚠ Chrome 실행 실패 — 프로필 정리 후 1회 재시도: ' + String(e1.message).slice(0, 90));
    CP.cleanProfile(PROFILE_DIR); await sleep(1200);
    try { _ctx = await chromium.launchPersistentContext(PROFILE_DIR, { ...opts, channel: 'chrome' }); }
    catch (e2) {
      try { _ctx = await chromium.launchPersistentContext(PROFILE_DIR, opts); }
      catch (e3) { throw new Error(CP.explainLaunchError(e3, '등록 도우미')); }
    }
  }
  _ctx.on('close', () => { _ctx = null; });
  for (const p of _ctx.pages()) _hookDialogs(p, log);
  _ctx.on('page', (p) => _hookDialogs(p, log));
  return _ctx;
}

async function _dump(page, log, tag) {
  try {
    // 입력칸·선택·Step 버튼을 앞에(머리말 링크가 60개 한도를 채워 정작 입력칸이 안 보이던 것) + 화면 글자 앞부분(어느 단계 화면인지·문구가 바뀌었는지 보려고)
    const d = await page.evaluate(() => {
      const w = (e) => (e.matches('input,select,textarea') ? 0 : /Step\d/.test(e.textContent) ? 1 : (e.textContent || '').trim() ? 2 : 3);
      const els = [...document.querySelectorAll('input,select,textarea,button,a')].filter((e) => e.offsetParent !== null && !(e.tagName === 'A' && !(e.textContent || '').trim()));
      els.sort((a, b) => w(a) - w(b));
      const main = (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' ');
      return { els: els.slice(0, 50).map((e) => `${e.tagName}|${e.type || ''}|${e.name || ''}|${(e.placeholder || e.value || e.textContent || '').trim().slice(0, 24)}`), text: main.slice(0, 900) };
    });
    log(`[등록] [DUMP ${tag}] ${d.els.join(' ; ').slice(0, 1800)}`);
    log(`[등록] [DUMP ${tag} 글자] ${d.text}`);
  } catch (_) {}
}

// 📸 단계마다 화면 전체 캡처(plan.shotDir 이 있을 때) — 입력이 실제로 들어갔는지 사람이 한눈에 볼 수 있게(R24). 경로를 로그에 남긴다.
async function _shot(page, plan, log, name) {
  try {
    if (!plan || !plan.shotDir) return '';
    fs.mkdirSync(plan.shotDir, { recursive: true });
    const f = path.join(plan.shotDir, `${name}.png`);
    await page.screenshot({ path: f, fullPage: true });
    log(`[등록] 📸 ${name} 캡처 → ${f}`);
    return f;
  } catch (e) { log(`[등록] ⚠ ${name} 캡처 실패: ${String(e.message).split(String.fromCharCode(10))[0].slice(0, 80)}`); return ''; }
}
const _squash = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
/** 입력칸 읽어 되짚기 — 기대값과 같으면 ✓, 다르면 ⚠ + failed */
async function _verifyInput(page, selector, want, label, log, failed) {
  let got = null;
  try { got = await page.locator(selector).first().inputValue(); } catch (_) {}
  if (got == null) { log(`[등록] ❔ ${label}: 값을 읽지 못했습니다`); return; }
  // 부크크는 도서명 등에서 특수문자(「:」 등)를 스스로 지운다(안내문 「특수문자를 가급적 사용하지 않도록」) — 글자·숫자가 같고 기호만 다르면 실패가 아니라 알림으로
  const core = (v) => _squash(v).replace(/[^0-9A-Za-z가-힣ぁ-ヿ一-鿿]/g, '');
  if (_squash(got) !== _squash(want) && core(got) === core(want) && core(want)) { log(`[등록] ✓ ${label}: 「${_squash(got).slice(0, 60)}」 (사이트가 특수문자를 뺐습니다 — 입력 「${_squash(want).slice(0, 40)}」)`); return; }
  if (_squash(got) === _squash(want)) log(`[등록] ✓ ${label}: ${_squash(got).slice(0, 60)}${_squash(got).length > 60 ? ` … (${_squash(got).length}자)` : ''}`);
  else { failed.push(label + ' 확인'); log(`[등록] ⚠ ${label} 값이 다릅니다 — 화면 「${_squash(got).slice(0, 40)}」 ≠ 기대 「${_squash(want).slice(0, 40)}」`); }
}
async function _verifySelect(sel, want, label, log, failed) {
  let got = '';
  try { got = await sel.evaluate((s) => (s.selectedOptions[0] ? s.selectedOptions[0].textContent.trim() : '')); } catch (_) {}
  const plain = (t) => String(t).replace(/^[^가-힣A-Za-z0-9]+/, '').trim();
  if (!got) { log(`[등록] ❔ ${label}: 선택값을 읽지 못했습니다`); return; }
  if (!want || plain(got) === plain(want) || plain(got).includes(plain(want))) log(`[등록] ✓ ${label}: ${plain(got)}`);
  else { failed.push(label + ' 확인'); log(`[등록] ⚠ ${label} 선택이 다릅니다 — 화면 「${plain(got)}」 ≠ 기대 「${plain(want)}」`); }
}

/**
 * 🟢 부크크 로그인 화면의 「NAVER 계정 로그인」 버튼을 눌러 준다(로이 2026-10-02 「네이버 클릭하는 거 추가 — 그럼 바로 로그인이 된다」).
 *   이 프로필에 네이버 로그인 기록이 있으면 클릭만으로 로그인된다. 아이디·비밀번호는 다루지 않는다(없으면 로이가 직접 — 이후 흐름은 기존 로그인 대기 그대로).
 *   로그인 화면이 아니거나(이미 로그인돼 넘어감) 버튼을 못 찾으면 아무것도 하지 않고 로그만 남긴다.
 */
async function _clickNaverLogin(page, log) {
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      if (page.isClosed()) return false;
      const st = await page.evaluate(() => ({ url: location.pathname, out: /로그아웃/.test(document.body ? document.body.innerText : '') })).catch(() => null);
      if (st && (st.out || !/\/login/.test(st.url))) { log('[등록] 이미 로그인된 상태 — 네이버 버튼은 누르지 않습니다'); return false; }
      const cands = [
        () => page.locator('a[href*="naver" i]'),
        () => page.locator('[class*="naver" i], [id*="naver" i]'),
        () => page.locator('a, button, [role=button]').filter({ hasText: /NAVER|네이버/i }),
        () => page.locator('img[alt*="naver" i]'),
        () => page.getByText(/NAVER\s*계정\s*로그인|네이버\s*(계정\s*)?로그인/i),
      ];
      for (const mk of cands) {
        const loc = mk().first();
        if (await loc.count().catch(() => 0)) {
          await loc.click({ timeout: 5000 });
          log('[등록] 🟢 「NAVER 계정 로그인」 버튼을 눌렀습니다 — 네이버 로그인 기록이 있으면 바로 로그인됩니다(아니면 열린 창에서 직접)');
          return true;
        }
      }
      await sleep(500);
    }
    log('[등록] ℹ 로그인 화면에서 네이버 버튼을 찾지 못했습니다 — 열린 창에서 직접 로그인해 주세요');
  } catch (e) { log('[등록] ℹ 네이버 로그인 버튼 클릭 실패: ' + String(e.message).split('\n')[0].slice(0, 80) + ' — 직접 로그인해 주세요'); }
  return false;
}

/** 로그인 대기 — 화면에 「로그아웃」이 보이면 로그인된 것. 최대 10분. */
async function _waitLogin(page, site, log, isAborted) {
  const t0 = Date.now();
  let told = false;
  while (Date.now() - t0 < 10 * 60 * 1000) {
    if (isAborted && isAborted()) throw new Error('중단됨');
    // 🪟 로그인 기다리는 동안 크롬 창을 닫으면 evaluate 가 계속 실패(→ false)해 10분을 헛기다리고 화면은 「진행 중」에 갇혔다(로이 2026-10-02). 닫혔으면 바로 끝낸다.
    if (page.isClosed() || !_ctx) throw new Error(`${site.label} 크롬 창이 닫혔습니다 — 로그인하려면 창을 닫지 말고, 다시 「🤖 자동 입력」을 눌러 주세요`);
    const ok = await page.evaluate(() => /로그아웃/.test(document.body ? document.body.innerText : '')).catch(() => false);
    if (ok) return;
    if (!told) { log(`[등록] 🔑 ${site.label}: 열린 크롬 창에서 로그인해 주세요 (아이디·비밀번호는 직접 — 최대 10분 기다립니다)`); told = true; }
    await sleep(1500);
  }
  throw new Error(`${site.label} 로그인을 10분 안에 확인하지 못했습니다`);
}

/** 작가와 — 도서정보 입력 칸 채우기(저장 버튼은 누르지 않는다) */
async function fillJakkawa(page, plan, log) {
  await page.waitForSelector('[name="G-a94bbc87"]', { timeout: 45000 }).catch(async () => { await _dump(page, log, '작가와 폼'); throw new Error('도서정보 입력 칸을 찾지 못했습니다(화면이 바뀌었을 수 있음)'); });
  const done = []; const failed = [];
  for (const f of plan.fields) {
    if (!f.value) continue;
    try {
      const el = page.locator(`[name="${f.name}"]`).first();
      if (f.kind === 'select') {
        const btn = el.locator('xpath=..').locator('[role=button]').first();
        await btn.scrollIntoViewIfNeeded(); await btn.click();
        await page.getByRole('option', { name: f.value, exact: true }).first().click({ timeout: 5000 });
      } else {
        await el.scrollIntoViewIfNeeded();
        await el.fill(f.value);
        await el.evaluate((n) => n.blur());
      }
      done.push(f.label);
    } catch (e) { failed.push(f.label); log(`[등록] ⚠ ${f.label} 입력 실패: ${String(e.message).split('\n')[0].slice(0, 80)}`); }
    await sleep(120);
  }
  return { done, failed };
}

/** 4단계(가격정책) 화면 대기 — 「정가설정」 한 문구에만 걸지 않는다(띄어쓰기·표현이 달라도 · 외부서점·최종정가 중 하나라도 보이면). 못 찾으면 호출 쪽이 화면을 덤프한다 */
async function _waitPriceScreen(page) {
  await page.waitForFunction(() => /정가\s*설정|최종\s*정가|외부\s*서점/.test(document.body ? document.body.innerText : ''), null, { timeout: 30000 });
}

/**
 * 💰 4단계 정가 입력칸 찾기 — 「화면의 첫 text 입력」으로 잡으면 머리말 검색칸 같은 엉뚱한 칸이 걸려 fill 이 30초 시간 초과했다(로이 2026-10-02: `locator.fill: Timeout 30000ms`).
 *   보이는·편집 가능한 입력 중 **값이 숫자(예: 1000)인 칸**을 우선, 없으면 「정가설정」 카드 안의 입력칸에 표식(data-priming-price)을 달아 그 선택자를 돌려준다. 못 찾으면 옛 선택자.
 */
const PRICE_SEL_FALLBACK = 'input[type=text], input[type=number], input:not([type])';
async function _priceSel(page) {
  const ok = await page.evaluate(() => {
    const okInput = (i) => i.offsetParent !== null && !i.disabled && !i.readOnly && ['', 'text', 'number', 'tel'].includes(i.type || '');
    const all = [...document.querySelectorAll('input')].filter(okInput);
    let pick = all.find((i) => /^\d[\d,]*$/.test(String(i.value || '').trim()));
    if (!pick) {   // 값이 비었으면 「정가설정」 제목 **바로 뒤에 오는 첫 입력칸**(문서 순서) — 머리말 검색칸은 제목 앞이라 걸리지 않는다
      const h = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b,span,div,p,label,header')].find((e) => e.children.length === 0 && /^\s*정가\s*설정\s*$/.test(e.textContent || ''));
      if (h) pick = all.find((i) => (h.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    }
    document.querySelectorAll('[data-priming-price]').forEach((e) => e.removeAttribute('data-priming-price'));
    if (!pick) return false;
    pick.setAttribute('data-priming-price', '1');
    return true;
  }).catch(() => false);
  return ok === true ? '[data-priming-price="1"]' : PRICE_SEL_FALLBACK;
}

/** 5단계(최종확인) 화면 대기 — 「서점소개정보」(종이책) 와 「서점 소개정보」(전자책 — 띄어쓰기가 다르다 · 로이 2026-10-02 실행에서 5단계를 못 찾은 원인)를 모두 받는다. 도서소개 입력칸이 보여도 된다 */
async function _waitFinalScreen(page) {
  await page.waitForFunction(() => { const t = document.body ? document.body.innerText : ''; return /서점\s*소개\s*정보/.test(t) || (/도서\s*소개/.test(t) && /도서\s*목차/.test(t)); }, null, { timeout: 30000 });
}

/** 파일 업로드 끝 대기 — 「업로드 파일 없음」이 사라지고 **「업로드중…」도 사라질 때**까지(최대 5분). 파일 이름이 먼저 보이고 업로드는 계속되는 구간에 다음 단계를 누르면 「원고파일을 올리지 않으면 진행할 수 없습니다」 창이 뜬다(로이 2026-10-02 전자책 2단계). */
async function _waitUploaded(page) {
  await page.waitForFunction(() => { const t = document.body.innerText; return !/업로드 파일 없음/.test(t) && !/업로드\s*중/.test(t); }, null, { timeout: 5 * 60 * 1000 });
  await sleep(800);
}

/** 도서정보 칸(도서명·부제·저자·목적·ISBN·대표장르·성인) — 종이책 2단계와 전자책 1단계가 같은 칸이다. select 목록을 돌려준다 */
async function _fillInfoForm(page, s2, log, step) {
  await step('도서명', () => page.locator('input[placeholder*="도서명 기재"]').fill(s2.title));
  if (s2.subtitle) await step('부제', () => page.locator('input[placeholder*="부제명"]').fill(s2.subtitle));
  await step('저자', () => page.locator('input[placeholder*="저자명 기재"]').fill(s2.author));
  const sel = page.locator('select');
  await step('도서 제작 목적', () => sel.nth(0).selectOption(s2.purpose));
  await step('ISBN', () => sel.nth(1).selectOption(s2.isbnMode));
  if (s2.genre) {
    await step('대표 장르', async () => {
      const opts = await sel.nth(2).locator('option').evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent.trim() })));
      const RF = require('./register-fill');
      const texts = opts.map((o) => o.t);
      const hit = RF.pickOption(s2.genre, texts) || RF.pickOption(s2.genreFallback || RF.BOOKK_DEFAULT_GENRE, texts);   // 원고 카테고리가 안 맞으면 기본 장르
      if (!hit) throw new Error(`「${s2.genre}」에 맞는 장르 없음(기본 「${RF.BOOKK_DEFAULT_GENRE}」도 목록에 없음)`);
      if (hit !== s2.genre) log(`ℹ 대표 장르: 「${hit}」 선택`);
      await sel.nth(2).selectOption(opts.find((o) => o.t === hit).v);
    });
  }
  await step('성인도서 여부', () => sel.nth(6).selectOption(s2.adult));
  return sel;
}

/** 부크크 — 1단계 카드 선택 → Step2(초안 생성) → 2단계 폼 + PDF 업로드. 3단계 이후는 손대지 않는다. */
async function fillBookk(page, plan, log) {
  const s1 = plan.step1; const s2 = plan.step2;
  const done = []; const failed = [];
  const step = async (label, fn) => { try { await fn(); done.push(label); } catch (e) { failed.push(label); log(`[등록] ⚠ ${label} 실패: ${String(e.message).split('\n')[0].slice(0, 90)}`); } };
  await page.waitForSelector('text=책 규격을 선택해주세요', { timeout: 45000 }).catch(async () => { await _dump(page, log, '부크크 1단계'); throw new Error('1단계 화면을 찾지 못했습니다'); });
  await step('내지 색', () => page.locator('strong', { hasText: new RegExp('^' + s1.color + '$') }).first().click({ timeout: 5000 }));
  await step('판형 ' + s1.trim, () => page.locator('strong', { hasText: new RegExp('^' + s1.trim + '$') }).first().click({ timeout: 5000 }));
  await step('표지 재질', () => page.locator('strong', { hasText: s1.material }).first().click({ timeout: 5000 }));
  // 🪽 날개 — 원고 메타 `날개` 를 따른다(plan.step1.wings). 글자가 정확히 같은 「날개 있음/없음」 선택만 누르고, 못 찾으면 **추측 클릭하지 않고** 실패로 남긴다.
  await step(s1.wings ? '날개 있음' : '날개 없음', () => page.locator('a', { hasText: s1.wings ? /^날개 있음$/ : /^날개 없음$/ }).first().click({ timeout: 5000 }));
  if (s1.pages) await step('쪽수', async () => { const n = page.locator('input[type=number]').first(); await n.fill(String(s1.pages)); await n.blur(); });
  await sleep(600);
  // 선택이 화면 요약에 반영됐는지 확인(판형·재질)
  const summary = await page.evaluate(() => document.body.innerText).catch(() => '');
  log(`[등록] 1단계 요약 확인: 판형 ${summary.includes(s1.trim) ? '✓' : '?'} · 쪽수 ${summary.includes(String(s1.pages)) ? '✓' : '?'}`);
  // 오른쪽 요약의 「날개 <있음|없음> 두께」 가 우리가 고른 값인지 — 다르면 실패로 남긴다(화면 문구·구조가 바뀐 경우를 조용히 넘기지 않는다)
  { const wm = /날개\s*(있음|없음)\s*두께/.exec(summary); const got = wm ? wm[1] : '';
    const want = s1.wings ? '있음' : '없음';
    if (got && got !== want) { failed.push('날개 ' + want + '(요약이 ' + got + ')'); log(`[등록] ⚠ 날개: 요약에 「${got}」 로 보입니다(원하는 값 ${want}) — 부크크 화면에서 직접 확인하세요`); }
    else log(`[등록] 날개 ${want}: 요약 ${got ? '✓' : '? (요약 문구를 찾지 못함)'}`); }
  // ▶ Step2 — 임시서재에 초안이 만들어진다(삭제 가능). 제출이 아니다.
  await _goStep(page, 2);
  await page.waitForSelector('input[placeholder*="도서명 기재"]', { timeout: 30000 }).catch(async () => { await _dump(page, log, '부크크 2단계'); throw new Error('2단계(원고등록) 화면으로 넘어가지 못했습니다 — 1단계 필수 선택을 확인하세요'); });
  const sel = await _fillInfoForm(page, s2, log, step);
  if (s2.pages) await step('페이지수', async () => { const n = page.locator('input[type=number]').first(); await n.fill(String(s2.pages)); await n.blur(); });
  if (s2.pdf && fs.existsSync(s2.pdf)) {
    await step('내지 PDF 업로드', async () => {
      await page.locator('input[type=file]').first().setInputFiles(s2.pdf);
      // 업로드 끝 = 「업로드 파일 없음」 문구가 사라짐(최대 5분)
      await _waitUploaded(page);
    });
  }
  // 🔍 2단계 입력 되짚기(R24) — 칸에 실제로 들어간 값을 읽어 확인하고 화면을 캡처한다
  await _verifyInput(page, 'input[placeholder*="도서명 기재"]', s2.title, '도서명', log, failed);
  if (s2.subtitle) await _verifyInput(page, 'input[placeholder*="부제명"]', s2.subtitle, '부제', log, failed);
  await _verifyInput(page, 'input[placeholder*="저자명 기재"]', s2.author, '저자', log, failed);
  await _verifySelect(sel.nth(2), s2.genre, '대표 장르', log, failed);
  await _shot(page, plan, log, '2단계');
  // ▶ Step3 표지디자인(로이 2026-10-02 「3페이지도 자동으로」) — 이동만 한다(저장·제출 아님). 4단계 이후는 손대지 않는다.
  if (plan.step3 && plan.step3.coverPdf) {
    try {
      await _goStep(page, 3);
      await page.waitForSelector('text=표지 주의사항', { timeout: 30000 });
      const r3 = await fillBookkCover(page, plan, log);
      done.push(...r3.done); failed.push(...r3.failed);
      if (!r3.failed.length) { const r45 = await continueFromStep4(page, plan, log); done.push(...r45.done); failed.push(...r45.failed); }
    } catch (e) {
      failed.push('3단계 이동'); log(`[등록] ⚠ 3단계(표지디자인)로 못 넘어갔습니다: ${String(e.message).split('\n')[0].slice(0, 90)} — 3단계는 직접 열고 「🖼 3단계 표지만 채우기」를 누르세요`);
      await _dump(page, log, '부크크 2→3단계');
    }
  }
  return { done, failed };
}

/**
 * 부크크 3단계 「표지디자인」 — 직접 올리기 탭 + 표지 PDF 업로드. 4단계(가격정책) 이후 버튼은 누르지 않는다.
 * 화면 「작업규격」(가로×세로 mm·책등)을 읽어 우리 표지 규격과 대조한다 — 폭이 ±1mm 밖이면 **올리지 않고** 실패로 알린다(틀린 표지를 올리지 않는다).
 */
async function fillBookkCover(page, plan, log) {
  const s3 = plan.step3 || {};
  const done = []; const failed = [];
  const step = async (label, fn) => { try { await fn(); done.push(label); } catch (e) { failed.push(label); log(`[등록] ⚠ ${label} 실패: ${String(e.message).split('\n')[0].slice(0, 90)}`); } };
  await page.waitForSelector('text=표지 주의사항', { timeout: 30000 }).catch(async () => { await _dump(page, log, '부크크 3단계'); throw new Error('3단계(표지디자인) 화면을 찾지 못했습니다'); });
  // 화면의 규격 읽기 → 대조
  const body = await page.evaluate(() => document.body.innerText).catch(() => '');
  const m = /(\d+(?:\.\d+)?)\s*mm\s*\(?\s*가로\s*\)?\s*[*×xX]\s*(\d+(?:\.\d+)?)\s*mm/.exec(body);
  const sm = /책등\s*(\d+(?:\.\d+)?)\s*mm/.exec(body);
  let specOk = true;
  if (m && s3.expect) {
    const w = Number(m[1]), h = Number(m[2]);
    const dw = Math.abs(w - s3.expect.widthMm), dh = Math.abs(h - s3.expect.heightMm);
    log(`[등록] 3단계 작업규격 ${w}×${h}mm${sm ? ` · 책등 ${sm[1]}mm` : ''} — 우리 표지 ${s3.expect.widthMm}×${s3.expect.heightMm}mm (책등 ${s3.expect.spineMm}mm)`);
    if (dw > 1 || dh > 1) { specOk = false; failed.push('표지 규격 불일치'); log(`[등록] ⚠ 표지 규격이 다릅니다(가로 ${dw.toFixed(2)}mm · 세로 ${dh.toFixed(2)}mm 차이) — 쪽수가 바뀌었다면 표지를 새 책등으로 다시 만든 뒤 올리세요. 틀린 표지는 올리지 않습니다`); }
  } else log('[등록] ℹ 3단계 작업규격 문구를 읽지 못해 규격 대조는 건너뜁니다');
  await step('직접 올리기 탭', () => page.locator('a, button, li, div, span').filter({ hasText: /^\s*직접\s*올리기\s*$/ }).first().click({ timeout: 8000 }));
  if (specOk && s3.coverPdf && fs.existsSync(s3.coverPdf)) {
    await step('표지 PDF 업로드', async () => {
      await page.locator('input[type=file]').first().setInputFiles(s3.coverPdf);
      await _waitUploaded(page);
    });
  } else if (!s3.coverPdf || !fs.existsSync(s3.coverPdf)) { failed.push('표지 PDF 없음'); log('[등록] ⚠ 올릴 표지 PDF 가 없습니다 — 「종이책 PDF」로 표지 PDF 를 먼저 만드세요'); }
  if (s3.logo === 'blue') await step('로고 파랑', () => _pickBlueLogo(page));
  return { done, failed };
}

/** 🔵 3단계 로고선택 — 파란색(로이 2026-10-02 · 종이책·전자책 공통). 로고 칸은 `a[href="#blue"]` 이고 고르면 class 에 active 가 붙는다(화면 기록 실측). 눌린 뒤 active 를 확인한다. */
async function _pickBlueLogo(page) {
  await page.locator('a[href="#blue"]').first().click({ timeout: 6000 });
  const active = await page.evaluate(() => { const a = document.querySelector('a[href="#blue"]'); return !!a && /(^|\s)active(\s|$)/.test(a.className); }).catch(() => null);
  if (active === false) throw new Error('파란 로고 선택이 반영되지 않았습니다');
}

/** 라디오/선택 글자를 눌러 고른다 — 라벨 글자로 찾고, 고른 뒤 실제로 체크됐는지 확인한다(아니면 실패) */
async function _pickRadio(page, re, textForLocator) {
  await page.locator('label', { hasText: textForLocator }).first().click({ timeout: 6000 });
  const checked = await page.evaluate((src) => {
    const r = new RegExp(src);
    return [...document.querySelectorAll('input[type=radio]')].some((i) => i.checked && r.test(((i.closest('label') || i.parentElement || {}).innerText || '')));
  }, re.source).catch(() => null);
  if (checked === false) throw new Error('선택이 반영되지 않았습니다');
}

/**
 * 부크크 4단계 「가격정책」 — 정가 · 정가인하 아니요 · 외부서점 입점 네. 「Step5 최종확인」으로 넘어가는 건 호출 쪽(이동만, 제출 아님).
 * 정가는 화면의 「최소가격 N원」 이상 · 최대 3배 · 100원 단위일 때만 넣는다(아니면 화면 기본값 그대로 두고 알린다).
 */
async function fillBookkPrice(page, plan, log) {
  const s4 = plan.step4 || {};
  const done = []; const failed = [];
  const step = async (label, fn) => { try { await fn(); done.push(label); } catch (e) { failed.push(label); log(`[등록] ⚠ ${label} 실패: ${String(e.message).split('\n')[0].slice(0, 90)}`); } };
  await _waitPriceScreen(page).catch(async () => { await _dump(page, log, '부크크 4단계'); throw new Error('4단계(가격정책) 화면을 찾지 못했습니다'); });
  const body = await page.evaluate(() => document.body.innerText).catch(() => '');
  const mm = /최소가격\s*([\d,]+)\s*원/.exec(body);
  const min = mm ? Number(mm[1].replace(/,/g, '')) : 0;
  if (s4.price) {
    const bad = s4.price % 100 !== 0 ? '100원 단위가 아닙니다' : (min && s4.price < min ? `최소가격 ${min.toLocaleString('ko-KR')}원보다 낮습니다` : (min && s4.price > min * 3 ? `최소가격의 3배(${(min * 3).toLocaleString('ko-KR')}원)를 넘습니다` : ''));
    if (bad) { failed.push('정가'); log(`[등록] ⚠ 원고 정가 ${s4.price.toLocaleString('ko-KR')}원: ${bad} — 정가는 화면 기본값 그대로 두었습니다. 직접 정하세요`); }
    else await step('정가 ' + s4.price, async () => {
      const inp = page.locator(await _priceSel(page)).first();   // 종이책 4단계도 같은 방식(엉뚱한 첫 칸 방지)
      await inp.fill(String(s4.price)); await inp.blur();
    });
  } else log(`[등록] ℹ 원고에 정가가 없어 화면의 최소가격${min ? ' ' + min.toLocaleString('ko-KR') + '원' : ''} 그대로 둡니다`);
  await step('정가인하 안 함', () => _pickRadio(page, /인하하지\s*않/, '인하하지 않겠습니다'));
  if (s4.external) await step('외부서점 입점', () => _pickRadio(page, /외부\s*온라인\s*서점/, '입점 원합니다'));
  await sleep(500);
  const after = await page.evaluate(() => document.body.innerText).catch(() => '');
  const fm = /최종\s*정가\s*([\d,]+)\s*원/.exec(after);
  // 💾 종이책 최종정가를 기록한다 — 전자책 정가(종이책의 70%)의 근거(main 이 plan.onPrice 로 저장 · 로이 2026-10-02 「종이책을 먼저 신청하고 그 가격으로 전자책 가격을 산정」)
  if (fm && typeof plan.onPrice === 'function') { try { plan.onPrice(Number(fm[1].replace(/,/g, ''))); } catch (_) {} }
  if (fm) log(`[등록] 4단계 최종정가 ${fm[1]}원${s4.price && Number(fm[1].replace(/,/g, '')) !== s4.price && !failed.includes('정가') ? ' ⚠ 원고 정가와 다릅니다' : ''}`);
  await _shot(page, plan, log, '4단계');
  return { done, failed, min };
}

/** 5단계 화면의 카드 요약을 우리 값과 대조한다(읽기만) */
function checkFinalSummary(body, plan) {
  const out = [];
  const pg = /페이지수\s*([\d,]+)/.exec(body), th = /두께\s*([\d.]+)\s*mm/.exec(body), pr = /판매가(?:격)?\s*([\d,]+)\s*원/.exec(body);
  if (pg && plan.step1 && plan.step1.pages && Number(pg[1].replace(/,/g, '')) !== plan.step1.pages) out.push(`페이지수 화면 ${pg[1]} ≠ 우리 ${plan.step1.pages}`);
  if (th && plan.step3 && plan.step3.expect && Math.abs(Number(th[1]) - plan.step3.expect.spineMm) > 0.05) out.push(`두께 화면 ${th[1]}mm ≠ 우리 ${plan.step3.expect.spineMm}mm`);
  if (pr && plan.step4 && plan.step4.price && Number(pr[1].replace(/,/g, '')) !== plan.step4.price) out.push(`판매가 화면 ${pr[1]}원 ≠ 원고 ${plan.step4.price}원`);
  if (plan.kind === 'ebook' && plan.step2 && plan.step2.epubName) {   // 전자책 카드의 「파일 [전자책] ….epub」
    const fm = /(?:^|\n)파일\s*(.+?\.(?:epub|pdf))/i.exec(body);
    if (fm && fm[1].trim() !== plan.step2.epubName) out.push(`파일 화면 ${fm[1].trim()} ≠ 우리 ${plan.step2.epubName}`);
  }
  return out;
}

/**
 * 부크크 5단계 「최종확인」 — 도서소개·도서목차·저자경력 + AI 사용 · 저작권 보유 선택.
 * 🔴 「도서제출」은 누르지 않는다 — 로이가 화면을 확인하고 직접 누른다.
 */
async function fillBookkFinal(page, plan, log) {
  const s5 = plan.step5 || {};
  const done = []; const failed = [];
  const step = async (label, fn) => { try { await fn(); done.push(label); } catch (e) { failed.push(label); log(`[등록] ⚠ ${label} 실패: ${String(e.message).split('\n')[0].slice(0, 90)}`); } };
  await _waitFinalScreen(page).catch(async () => { await _dump(page, log, '부크크 5단계'); throw new Error('5단계(최종확인) 화면을 찾지 못했습니다'); });
  const text = async (label, key, value) => { if (value) await step(label, async () => { const t = page.locator(`textarea[placeholder*="${key}"]`).first(); await t.fill(value); await t.blur(); }); };
  await text('도서소개', '도서의 설명', s5.intro);
  await text('도서목차', '색인', s5.toc);
  await text('저자경력·소개', '저자를 소개', s5.bio);
  const choose = async (label, selHas, want) => step(label, async () => {
    const sel = page.locator('select').filter({ hasText: selHas }).first();
    const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent.trim() })));
    const hit = opts.find((o) => o.t.replace(/^[^가-힣A-Za-z]+/, '') === want) || opts.find((o) => o.t.includes(want));
    if (!hit) throw new Error(`선택지에 「${want}」 없음`);
    await sel.selectOption(hit.v);
  });
  await choose('AI 사용여부 ' + s5.ai, 'AI 활용 여부', s5.ai);
  await choose('초상/저작권 ' + s5.rights, '초상/저작권 보유여부', s5.rights);
  // 🔍 5단계 입력 되짚기(R24) — 도서소개·도서목차·저자경력이 칸에 그대로 들어갔는지, AI·저작권 선택값
  if (s5.intro) await _verifyInput(page, 'textarea[placeholder*="도서의 설명"]', s5.intro, '도서소개', log, failed);
  if (s5.toc) await _verifyInput(page, 'textarea[placeholder*="색인"]', s5.toc, '도서목차', log, failed);
  if (s5.bio) await _verifyInput(page, 'textarea[placeholder*="저자를 소개"]', s5.bio, '저자경력·소개', log, failed);
  await _verifySelect(page.locator('select').filter({ hasText: 'AI 활용 여부' }).first(), s5.ai, 'AI 활용 여부', log, failed);
  await _verifySelect(page.locator('select').filter({ hasText: '초상/저작권 보유여부' }).first(), s5.rights, '초상/저작권', log, failed);
  await _shot(page, plan, log, '5단계');
  const body = await page.evaluate(() => document.body.innerText).catch(() => '');
  const diffs = checkFinalSummary(body, plan);
  if (diffs.length) { failed.push('최종확인 요약 불일치'); log(`[등록] ⚠ 5단계 요약이 우리 값과 다릅니다: ${diffs.join(' · ')}`); }
  else log('[등록] 5단계 요약(쪽수·두께·판매가) 우리 값과 일치');
  return { done, failed };
}


/**
 * 3단계 → 4단계 → 5단계로 이어서 채운다. 각 단계 사이는 「Step4 가격정책」·「Step5 최종확인」 이동 버튼만 누른다(저장·제출 아님).
 * 앞 단계가 실패하면 거기서 멈춘다(틀린 값으로 다음 화면을 채우지 않는다). 🔴 5단계의 「도서제출」은 누르지 않는다 — 로이가 직접.
 */
async function continueFromStep4(page, plan, log) {
  const done = []; const failed = [];
  try {
    await _goStep(page, 4);
  } catch (e) { failed.push('4단계 이동'); log(`[등록] ⚠ 4단계(가격정책)로 못 넘어갔습니다: ${String(e.message).split('\n')[0].slice(0, 90)} — 직접 넘어간 뒤 「이어서 채우기」를 누르세요`); await _dump(page, log, '부크크 3→4단계'); return { done, failed }; }
  const r4 = await fillBookkPrice(page, plan, log).catch((e) => ({ done: [], failed: ['4단계 화면'], err: e }));
  done.push(...r4.done); failed.push(...r4.failed);
  if (r4.err) { log(`[등록] ⚠ ${r4.err.message}`); return { done, failed }; }
  if (r4.failed.some((f) => f !== '정가')) return { done, failed };   // 정가인하·외부서점 선택이 안 됐으면 멈춘다(정가만 못 넣은 건 알리고 계속)
  try {
    await _goStep(page, 5);
  } catch (e) { failed.push('5단계 이동'); log(`[등록] ⚠ 5단계(최종확인)로 못 넘어갔습니다: ${String(e.message).split('\n')[0].slice(0, 90)}`); await _dump(page, log, '부크크 4→5단계'); return { done, failed }; }
  const r5 = await fillBookkFinal(page, plan, log).catch((e) => ({ done: [], failed: ['5단계 화면'], err: e }));
  done.push(...r5.done); failed.push(...r5.failed);
  if (r5.err) log(`[등록] ⚠ ${r5.err.message}`);
  else log('[등록] 🛑 5단계 입력까지 끝났습니다 — 화면을 확인하고 「도서제출」은 직접 누르세요(자동 제출 없음)');
  await _shot(page, plan, log, '3단계');
  return { done, failed };
}

/** 🖼 3단계 표지만 채우기 — 이미 열려 있는 이 앱의 등록용 크롬에서 3단계 화면(표지 주의사항)이 떠 있는 탭을 찾아 이어서 한다. */
async function runBookkCoverOnly(o) {
  const log = o.log || (() => {});
  if (!_ctx) throw new Error('열려 있는 등록용 크롬 창이 없습니다 — 먼저 「🤖 부크크에 자동 입력」으로 크롬을 열어 3단계 화면까지 가세요(앱을 껐다 켜면 창과 연결이 끊깁니다)');
  // 열려 있는 탭에서 어느 단계 화면인지 찾는다 — 3단계(표지 주의사항) / 4단계(정가설정) / 5단계(서점소개정보). 가장 앞 단계부터 이어서 한다.
  let page = null, at = 0;
  for (const p of _ctx.pages()) {
    const t = await p.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    const n = /표지 주의사항/.test(t) ? 3 : /정가\s*설정/.test(t) ? 4 : /서점\s*소개\s*정보/.test(t) ? 5 : 0;
    if (n && (!page || n < at)) { page = p; at = n; }
  }
  if (!page) throw new Error('등록용 크롬에 3~5단계(표지디자인·가격정책·최종확인) 화면이 열려 있지 않습니다 — 그 화면을 연 뒤 다시 누르세요');
  const r = { done: [], failed: [] };
  if (at === 3) {
    const r3 = await fillBookkCover(page, o.plan, log);
    r.done.push(...r3.done); r.failed.push(...r3.failed);
    log(`[등록] ✅ 3단계 입력 ${r3.done.length}칸 완료${r3.failed.length ? ' · 실패 ' + r3.failed.join(', ') : ''}`);
  }
  if (at === 3 && !r.failed.length) { const r45 = await continueFromStep4(page, o.plan, log); r.done.push(...r45.done); r.failed.push(...r45.failed); }
  else if (at === 4) {
    const r4 = await fillBookkPrice(page, o.plan, log); r.done.push(...r4.done); r.failed.push(...r4.failed);
    if (!r4.failed.some((f) => f !== '정가')) {
      try { await _goStep(page, 5);
        const r5 = await fillBookkFinal(page, o.plan, log); r.done.push(...r5.done); r.failed.push(...r5.failed);
        log('[등록] 🛑 5단계 입력까지 끝났습니다 — 「도서제출」은 직접 누르세요'); }
      catch (e) { r.failed.push('5단계 이동'); log(`[등록] ⚠ 5단계로 못 넘어갔습니다: ${String(e.message).split('\n')[0].slice(0, 90)}`); }
    }
  } else if (at === 5) {
    const r5 = await fillBookkFinal(page, o.plan, log); r.done.push(...r5.done); r.failed.push(...r5.failed);
    log('[등록] 🛑 5단계 입력까지 끝났습니다 — 「도서제출」은 직접 누르세요');
  }
  return { ok: !r.failed.length, done: r.done, failed: r.failed, manual: o.plan.manual || [] };
}

// ───────── 📘 부크크 「새전자책」 (/author/make/electronicBook) — 로이 스크린샷·화면 기록 2026-10-02 실측. 🔴 「도서제출」은 누르지 않는다(이동 버튼 Step2~Step5 뿐).

/** 1단계 기본정보 — 종이책 2단계와 같은 칸(쪽수·PDF 없음) */
async function fillBookkEbookInfo(page, plan, log) {
  const s1 = plan.step1; const done = []; const failed = [];
  const step = async (label, fn) => { try { await fn(); done.push(label); } catch (e) { failed.push(label); log(`[등록] ⚠ ${label} 실패: ${String(e.message).split('\n')[0].slice(0, 90)}`); } };
  await page.waitForSelector('input[placeholder*="도서명 기재"]', { timeout: 45000 }).catch(async () => { await _dump(page, log, '전자책 1단계'); throw new Error('전자책 1단계(기본정보) 화면을 찾지 못했습니다'); });
  const sel = await _fillInfoForm(page, s1, log, step);
  await _verifyInput(page, 'input[placeholder*="도서명 기재"]', s1.title, '도서명', log, failed);
  if (s1.subtitle) await _verifyInput(page, 'input[placeholder*="부제명"]', s1.subtitle, '부제', log, failed);
  await _verifyInput(page, 'input[placeholder*="저자명 기재"]', s1.author, '저자', log, failed);
  await _verifySelect(sel.nth(2), s1.genre, '대표 장르', log, failed);
  await _shot(page, plan, log, '전자책1단계');
  return { done, failed };
}

/** 2단계 원고등록 — ePub 첨부(EPUB2.0만 외부유통 · 20MB). 업로드 끝 = 「업로드 파일 없음」 문구 사라짐 */
async function fillBookkEbookManuscript(page, plan, log) {
  const s2 = plan.step2 || {}; const done = []; const failed = [];
  await page.waitForSelector('text=원고 업로드', { timeout: 30000 }).catch(async () => { await _dump(page, log, '전자책 2단계'); throw new Error('전자책 2단계(원고등록) 화면을 찾지 못했습니다'); });
  if (!s2.epub || !fs.existsSync(s2.epub)) { failed.push('ePub 없음'); log('[등록] ⚠ 올릴 ePub 이 없습니다 — 「📦 한 번에 만들기」로 ePub 을 먼저 만드세요'); return { done, failed }; }
  const mb = fs.statSync(s2.epub).size / 1048576;
  if (mb > 20) { failed.push('ePub 20MB 초과'); log(`[등록] ⚠ ePub ${mb.toFixed(1)}MB — 부크크 한도 20MB 를 넘어 올리지 않습니다`); return { done, failed }; }
  try {
    await page.locator('input[type=file]').first().setInputFiles(s2.epub);
    await _waitUploaded(page);
    done.push('ePub 업로드');
  } catch (e) { failed.push('ePub 업로드'); log(`[등록] ⚠ ePub 업로드 실패: ${String(e.message).split('\n')[0].slice(0, 90)}`); }
  await _shot(page, plan, log, '전자책2단계');
  return { done, failed };
}

/** 3단계 꾸미기 — 「직접 올리기」 탭 + 표지(JPG·PDF 10MB) + 파란 로고 */
async function fillBookkEbookCover(page, plan, log) {
  const s3 = plan.step3 || {}; const done = []; const failed = [];
  const step = async (label, fn) => { try { await fn(); done.push(label); } catch (e) { failed.push(label); log(`[등록] ⚠ ${label} 실패: ${String(e.message).split('\n')[0].slice(0, 90)}`); } };
  await page.waitForSelector('text=구매한', { timeout: 30000 }).catch(async () => { await _dump(page, log, '전자책 3단계'); throw new Error('전자책 3단계(꾸미기) 화면을 찾지 못했습니다'); });
  await step('직접 올리기 탭', () => page.locator('a, button, li, div, span').filter({ hasText: /^\s*직접\s*올리기\s*$/ }).first().click({ timeout: 8000 }));
  if (s3.cover && fs.existsSync(s3.cover)) {
    const ext = path.extname(s3.cover).toLowerCase(); const mb = fs.statSync(s3.cover).size / 1048576;
    if (!/^\.(jpe?g|pdf)$/.test(ext)) { failed.push('표지 형식'); log(`[등록] ⚠ 표지는 JPG·PDF 만 올릴 수 있습니다(${ext}) — 올리지 않습니다`); }
    else if (mb > 10) { failed.push('표지 10MB 초과'); log(`[등록] ⚠ 표지 ${mb.toFixed(1)}MB — 한도 10MB 를 넘어 올리지 않습니다`); }
    else await step('표지 업로드', async () => {
      await page.waitForSelector('text=표지 주의사항', { timeout: 15000 });
      await page.locator('input[type=file]').first().setInputFiles(s3.cover);
      await _waitUploaded(page);
    });
  } else { failed.push('표지 없음'); log('[등록] ⚠ 올릴 전자책 표지(JPG·PDF)가 없습니다 — 원고 `> 전자책표지:` 를 정하거나 ePub 을 다시 만들어 앞표지 크롭본을 만드세요'); }
  if (s3.logo === 'blue') await step('로고 파랑', () => _pickBlueLogo(page));
  await _shot(page, plan, log, '전자책3단계');
  return { done, failed };
}

/**
 * 4단계 가격정책 — 정가(100원 단위 · 화면 기본 1,000원은 예시값) + 「도서 정가를 직접 변경하였습니다」 체크(안 하면 「도서 가격 체크박스를 확인해주세요!」 창) + 외부서점 입점 「네」.
 * 종이책과 달리 정가인하 칸이 없다. 최소·최대 가격은 화면이 알려 주지 않아 100원 단위·양수만 확인한다.
 */
async function fillBookkEbookPrice(page, plan, log) {
  const s4 = plan.step4 || {}; const done = []; const failed = [];
  const step = async (label, fn) => { try { await fn(); done.push(label); } catch (e) { failed.push(label); log(`[등록] ⚠ ${label} 실패: ${String(e.message).split('\n')[0].slice(0, 90)}`); } };
  await _waitPriceScreen(page).catch(async () => { await _dump(page, log, '전자책 4단계'); throw new Error('전자책 4단계(가격정책) 화면을 찾지 못했습니다'); });
  const priceSel = await _priceSel(page);
  if (s4.from === 'paper70' || s4.from === 'paper-registered') log(`[등록] 💰 전자책 정가 = 종이책(${s4.from === 'paper-registered' ? '부크크 신청 때 기록한 최종정가' : '원고 정가'}) ${Number(s4.paper).toLocaleString('ko-KR')}원 × 70% (10원 단위 이하 버림) = ${Number(s4.price).toLocaleString('ko-KR')}원`);
  if (s4.price) {
    if (s4.price % 100 !== 0 || s4.price <= 0) { failed.push('정가'); log(`[등록] ⚠ 전자책 정가 ${s4.price.toLocaleString('ko-KR')}원은 100원 단위가 아닙니다 — 화면 기본값 그대로 두었습니다. 직접 정하세요`); }
    else {
      // 🔑 순서: **「직접 변경」 체크 먼저 → 그다음 가격**. 가격을 먼저 바꾸면 부크크가 그 순간 「도서 가격 체크박스를 확인해주세요!」 알림을 띄우고 가격을 1000 으로 되돌린다(로이 2026-10-02 실행).
      await step('정가 직접 변경 체크', async () => {
        const cb = page.locator('input[type=checkbox]').first();
        try { await cb.check({ timeout: 4000, force: true }); }
        catch (_) { await page.locator('label', { hasText: '직접 변경하였습니다' }).first().click({ timeout: 6000 }); }
        const on = await page.evaluate(() => [...document.querySelectorAll('input[type=checkbox]')].some((i) => i.checked)).catch(() => null);
        if (on === false) throw new Error('체크가 반영되지 않았습니다');
      });
      if (!failed.includes('정가 직접 변경 체크')) {
        await step('정가 ' + s4.price, async () => { const inp = page.locator(priceSel).first(); await inp.fill(String(s4.price), { timeout: 8000 }); await inp.press('Tab').catch(() => {}); await inp.blur(); });
        await sleep(400);
        await _verifyInput(page, priceSel, String(s4.price), '정가 입력칸', log, failed);   // 되돌려졌으면(1000) ⚠ + 실패
      }
    }
  } else {
    // 정가를 모르면 **여기서 멈춘다** — 화면 기본값 1,000원은 예시값이고, 부크크는 5단계로 넘어갈 때 「도서 가격 체크박스를 확인해주세요!」 로 체크를 요구한다(로이 2026-10-02 실행). 1,000원을 확인 처리해 올리면 안 된다.
    failed.push('정가 미정');
    log('[등록] ⛔ 전자책 정가를 알 수 없어 4단계에서 멈춥니다 — 종이책을 먼저 신청(🤖 자동 입력 · 4단계 최종정가를 기록)하거나, 원고에 `> 정가:`(종이책) 또는 `> 전자책:` 를 적은 뒤 「📘 이어 채우기」를 누르세요. 직접 정하려면 화면에서 「정가 직접 변경」 체크 후 가격을 넣으세요');
  }
  if (s4.external) await step('외부서점 입점', () => _pickRadio(page, /외부\s*온라인\s*서점/, '입점 원합니다'));
  await sleep(500);
  const after = await page.evaluate(() => document.body.innerText).catch(() => '');
  const fm = /최종\s*정가\s*([\d,]+)\s*원/.exec(after);
  if (fm) log(`[등록] 전자책 4단계 최종정가 ${fm[1]}원${s4.price && Number(fm[1].replace(/,/g, '')) !== s4.price && !failed.includes('정가') ? ' ⚠ 원고 정가와 다릅니다' : ''}`);
  await _shot(page, plan, log, '전자책4단계');
  return { done, failed };
}

/**
 * 전자책 from 단계부터 5단계까지 이어서 채운다. 단계 사이는 「Step2 원고등록」~「Step5 최종확인」 이동 버튼만 누른다.
 * 앞 단계가 실패하면 거기서 멈춘다(틀린 값으로 다음 화면을 채우지 않는다). 🔴 5단계의 「도서제출」은 누르지 않는다.
 */
async function runEbookFrom(page, plan, log, from) {
  const done = []; const failed = [];
  const fns = { 1: fillBookkEbookInfo, 2: fillBookkEbookManuscript, 3: fillBookkEbookCover, 4: fillBookkEbookPrice, 5: fillBookkFinal };
  for (let n = from; n <= 5; n++) {
    if (n > from) {
      try { await _goStep(page, n); }
      catch (e) { failed.push(`${n}단계 이동`); log(`[등록] ⚠ 전자책 ${n}단계로 못 넘어갔습니다: ${String(e.message).split('\n')[0].slice(0, 90)} — 직접 넘어간 뒤 「이어서 채우기」를 누르세요`); await _dump(page, log, `전자책 ${n - 1}→${n}단계`); return { done, failed }; }
    }
    let r;
    try { r = await fns[n](page, plan, log); } catch (e) { failed.push(`${n}단계 화면`); log(`[등록] ⚠ ${e.message}`); return { done, failed }; }
    done.push(...r.done); failed.push(...r.failed);
    if (r.failed.length) { log(`[등록] ⏸ 전자책 ${n}단계에서 실패가 있어 멈춥니다(${r.failed.join(', ')}) — 고친 뒤 「이어서 채우기」`); return { done, failed }; }
  }
  log('[등록] 🛑 전자책 5단계 입력까지 끝났습니다 — 화면을 확인하고 「도서제출」은 직접 누르세요(자동 제출 없음)');
  return { done, failed };
}
async function fillBookkEbook(page, plan, log) { return runEbookFrom(page, plan, log, 1); }

/**
 * 📚 종이책 → 전자책 한 번에(로이 2026-10-02 「종이책 먼저 등록하고 전자책까지 함께」).
 *   ① 로그인 화면(사람이 로그인) ② 종이책 1~5단계 채우기 ③ 성공하면 **같은 크롬의 새 탭**에서 전자책 1~5단계 — 종이책 탭은 그대로 둔다(로이가 종이책 「도서제출」을 직접 누를 수 있게).
 *   전자책 계획은 종이책 4단계 뒤에 만든다(plan.buildEbookPlan — 종이책 최종정가를 기록한 뒤라야 정가 = 그 70%). 종이책이 하나라도 실패하면 전자책으로 넘어가지 않는다.
 *   🔴 저장·「도서제출」은 두 책 모두 누르지 않는다.
 */
async function runRegisterBoth(o) {
  const log = o.log || (() => {});
  const site = SITES.bookk;
  const ctx = await _launch(log);
  const page = ctx.pages()[0] || await ctx.newPage();
  log(`[등록] 📚 ${site.label} 열기 — ${site.home}`);
  await page.goto(site.home, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  if (/bookk\.co\.kr/.test(site.home)) await _clickNaverLogin(page, log);
  await _waitLogin(page, site, log, o.isAborted);
  await page.goto(site.start, { waitUntil: 'load', timeout: 60000 });
  log('[등록] 📕 1/2 종이책 입력 시작');
  const r1 = await fillBookk(page, o.plan, log);
  const done = [...r1.done.map((x) => '종이책 ' + x)]; const failed = [...r1.failed.map((x) => '종이책 ' + x)];
  const manual = [...(o.plan.manual || []).map((x) => '[종이책] ' + x)];
  if (r1.failed.length) {
    log(`[등록] ⏸ 종이책에서 실패가 있어 전자책으로 넘어가지 않습니다(${r1.failed.join(', ')}) — 종이책 탭을 고친 뒤 「🖼 3단계부터 이어 채우기」를 누르고, 끝나면 전자책을 하세요`);
    return { ok: false, done, failed, manual };
  }
  if (o.isAborted && o.isAborted()) throw new Error('중단됨');
  const eplan = o.plan.buildEbookPlan ? o.plan.buildEbookPlan() : null;
  if (!eplan) throw new Error('전자책 계획을 만들지 못했습니다');
  const epage = await ctx.newPage();
  log('[등록] 📘 2/2 전자책 입력 시작 — 새 탭(종이책 탭은 그대로 둡니다)');
  await epage.goto(SITES.bookkEbook.start, { waitUntil: 'load', timeout: 60000 });
  const r2 = await fillBookkEbook(epage, eplan, log);
  done.push(...r2.done.map((x) => '전자책 ' + x)); failed.push(...r2.failed.map((x) => '전자책 ' + x));
  manual.push(...(eplan.manual || []).map((x) => '[전자책] ' + x));
  log(`[등록] ✅ 📚 종이책 ${r1.done.length}칸 · 전자책 ${r2.done.length}칸 입력${r2.failed.length ? ' · 전자책 실패 ' + r2.failed.join(', ') : ''} — 두 탭에서 확인하고 「도서제출」은 직접 누르세요`);
  return { ok: !failed.length, done, failed, manual };
}

/** 열려 있는 등록용 크롬의 전자책 탭에서 지금 몇 단계인지 읽어 거기서부터 이어서 채운다(로그인·1단계를 이미 한 경우). */
async function runBookkEbookResume(o) {
  const log = o.log || (() => {});
  if (!_ctx) throw new Error('열려 있는 등록용 크롬 창이 없습니다 — 먼저 「🤖 자동 입력」으로 크롬을 열어 전자책 화면까지 가세요(앱을 껐다 켜면 창과 연결이 끊깁니다)');
  let page = null, at = 0;
  for (const p of _ctx.pages()) {
    if (!/electronicBook/.test(p.url())) continue;
    const t = await p.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    const n = /서점\s*소개\s*정보/.test(t) ? 5 : /정가\s*설정/.test(t) ? 4 : /구매한\s*템플릿/.test(t) ? 3 : /원고\s*업로드/.test(t) ? 2 : /도서\s*제작\s*목적/.test(t) ? 1 : 0;
    if (n && (!page || n < at)) { page = p; at = n; }
  }
  if (!page) throw new Error('등록용 크롬에 전자책(새전자책) 1~5단계 화면이 열려 있지 않습니다 — 그 화면을 연 뒤 다시 누르세요');
  log(`[등록] 전자책 ${at}단계 화면에서 이어서 채웁니다`);
  const r = await runEbookFrom(page, o.plan, log, at);
  return { ok: !r.failed.length, done: r.done, failed: r.failed, manual: o.plan.manual || [] };
}

/**
 * @param {{platform:'bookk'|'bookkEbook'|'jakkawa', plan:object, log:Function, isAborted?:Function}} o
 * @returns {Promise<{ok:boolean, done:string[], failed:string[], manual:string[], shot?:string}>}
 */
async function runRegister(o) {
  const site = SITES[o.platform];
  if (!site) throw new Error('알 수 없는 플랫폼');
  const log = o.log || (() => {});
  const ctx = await _launch(log);
  const page = ctx.pages()[0] || await ctx.newPage();
  log(`[등록] ${site.label} 열기 — ${site.start}`);
  await page.goto(site.home, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  if (/bookk\.co\.kr/.test(site.home)) await _clickNaverLogin(page, log);
  await _waitLogin(page, site, log, o.isAborted);
  await page.goto(site.start, { waitUntil: 'load', timeout: 60000 });
  const r = o.platform === 'jakkawa' ? await fillJakkawa(page, o.plan, log) : o.platform === 'bookkEbook' ? await fillBookkEbook(page, o.plan, log) : await fillBookk(page, o.plan, log);
  let shot = '';
  try { shot = path.join(os.tmpdir(), `priming-register-${o.platform}.png`); await page.screenshot({ path: shot, fullPage: false }); } catch (_) { shot = ''; }
  log(`[등록] ✅ ${site.label} 입력 ${r.done.length}칸 완료${r.failed.length ? ' · 실패 ' + r.failed.join(', ') : ''} — 이 창에서 내용을 확인하고 저장·제출은 직접 하세요(창은 그대로 둡니다)`);
  return { ok: !r.failed.length, done: r.done, failed: r.failed, manual: o.plan.manual || [], shot };
}

module.exports = { clickNaverLogin: _clickNaverLogin, goStep: _goStep, verifyInput: _verifyInput, verifySelect: _verifySelect, shot: _shot, fillBookkPrice, fillBookkFinal, checkFinalSummary, continueFromStep4, PROFILE_DIR, SITES, setDialogAsker, hookDialogs: _hookDialogs, runRegister, runRegisterBoth, runBookkCoverOnly, fillJakkawa, fillBookk, fillBookkCover, fillBookkEbook, fillBookkEbookInfo, fillBookkEbookManuscript, fillBookkEbookCover, fillBookkEbookPrice, runBookkEbookResume, runEbookFrom };
