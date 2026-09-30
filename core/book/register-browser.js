'use strict';
/**
 * register-browser.js — 📤 등록 도우미 「자동 입력」 브라우저 구동(작가와 · 부크크).
 *
 * 흐름: 전용 크롬 프로필(로그인 유지) 실행 → 사이트 열기 → **로이가 로그인**(우리는 아이디·비밀번호를 다루지 않는다) → 입력·파일 첨부 → **멈춘다**.
 * 🔴 저장 · 제출 · 유통 신청 · 최종 입점 · 승인 버튼은 누르지 않는다(코드에 그런 클릭이 없다 — 테스트가 소스를 검사한다).
 * 🔑 셀렉터 정책: 클래스(해시)·nth-child 금지. 작가와는 폼 칸 이름(G-…), 부크크는 글자·placeholder·role 로 찾는다.
 *   못 찾으면 화면 상태를 `[DUMP …]` 로 남긴다(다음 수정의 근거).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROFILE_DIR = path.join(os.homedir(), '.priming-maker', 'book-register-profile');
const SITES = {
  bookk: { label: '부크크', start: 'https://bookk.co.kr/author/make/paperBook', home: 'https://bookk.co.kr/' },
  jakkawa: { label: '작가와', start: 'https://www.jakkawa.com/making-books1', home: 'https://www.jakkawa.com/' },
};

let _ctx = null;   // 열려 있는 컨텍스트(한 번에 하나)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  return _ctx;
}

async function _dump(page, log, tag) {
  try {
    const d = await page.evaluate(() => [...document.querySelectorAll('input,select,textarea,button,a')]
      .filter((e) => e.offsetParent !== null).slice(0, 60)
      .map((e) => `${e.tagName}|${e.type || ''}|${e.name || ''}|${(e.placeholder || e.textContent || '').trim().slice(0, 24)}`));
    log(`[등록] [DUMP ${tag}] ${d.join(' ; ').slice(0, 1800)}`);
  } catch (_) {}
}

/** 로그인 대기 — 화면에 「로그아웃」이 보이면 로그인된 것. 최대 10분. */
async function _waitLogin(page, site, log, isAborted) {
  const t0 = Date.now();
  let told = false;
  while (Date.now() - t0 < 10 * 60 * 1000) {
    if (isAborted && isAborted()) throw new Error('중단됨');
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

/** 부크크 — 1단계 카드 선택 → Step2(초안 생성) → 2단계 폼 + PDF 업로드. 3단계 이후는 손대지 않는다. */
async function fillBookk(page, plan, log) {
  const s1 = plan.step1; const s2 = plan.step2;
  const done = []; const failed = [];
  const step = async (label, fn) => { try { await fn(); done.push(label); } catch (e) { failed.push(label); log(`[등록] ⚠ ${label} 실패: ${String(e.message).split('\n')[0].slice(0, 90)}`); } };
  await page.waitForSelector('text=책 규격을 선택해주세요', { timeout: 45000 }).catch(async () => { await _dump(page, log, '부크크 1단계'); throw new Error('1단계 화면을 찾지 못했습니다'); });
  await step('내지 색', () => page.locator('strong', { hasText: new RegExp('^' + s1.color + '$') }).first().click({ timeout: 5000 }));
  await step('판형 ' + s1.trim, () => page.locator('strong', { hasText: new RegExp('^' + s1.trim + '$') }).first().click({ timeout: 5000 }));
  await step('표지 재질', () => page.locator('strong', { hasText: s1.material }).first().click({ timeout: 5000 }));
  await step('날개 없음', () => page.locator('a', { hasText: /^날개 없음$/ }).first().click({ timeout: 5000 }));
  if (s1.pages) await step('쪽수', async () => { const n = page.locator('input[type=number]').first(); await n.fill(String(s1.pages)); await n.blur(); });
  await sleep(600);
  // 선택이 화면 요약에 반영됐는지 확인(판형·재질)
  const summary = await page.evaluate(() => document.body.innerText).catch(() => '');
  log(`[등록] 1단계 요약 확인: 판형 ${summary.includes(s1.trim) ? '✓' : '?'} · 쪽수 ${summary.includes(String(s1.pages)) ? '✓' : '?'}`);
  // ▶ Step2 — 임시서재에 초안이 만들어진다(삭제 가능). 제출이 아니다.
  await page.locator('a', { hasText: 'Step2 원고등록' }).first().click({ timeout: 8000 });
  await page.waitForSelector('input[placeholder*="도서명 기재"]', { timeout: 30000 }).catch(async () => { await _dump(page, log, '부크크 2단계'); throw new Error('2단계(원고등록) 화면으로 넘어가지 못했습니다 — 1단계 필수 선택을 확인하세요'); });
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
      const hit = RF.pickOption(s2.genre, opts.map((o) => o.t));
      if (!hit) throw new Error(`「${s2.genre}」에 맞는 장르 없음`);
      await sel.nth(2).selectOption(opts.find((o) => o.t === hit).v);
    });
  }
  await step('성인도서 여부', () => sel.nth(6).selectOption(s2.adult));
  if (s2.pages) await step('페이지수', async () => { const n = page.locator('input[type=number]').first(); await n.fill(String(s2.pages)); await n.blur(); });
  if (s2.pdf && fs.existsSync(s2.pdf)) {
    await step('내지 PDF 업로드', async () => {
      await page.locator('input[type=file]').first().setInputFiles(s2.pdf);
      // 업로드 끝 = 「업로드 파일 없음」 문구가 사라짐(최대 5분)
      await page.waitForFunction(() => !/업로드 파일 없음/.test(document.body.innerText), null, { timeout: 5 * 60 * 1000 });
    });
  }
  return { done, failed };
}

/**
 * @param {{platform:'bookk'|'jakkawa', plan:object, log:Function, isAborted?:Function}} o
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
  await _waitLogin(page, site, log, o.isAborted);
  await page.goto(site.start, { waitUntil: 'load', timeout: 60000 });
  const r = o.platform === 'jakkawa' ? await fillJakkawa(page, o.plan, log) : await fillBookk(page, o.plan, log);
  let shot = '';
  try { shot = path.join(os.tmpdir(), `priming-register-${o.platform}.png`); await page.screenshot({ path: shot, fullPage: false }); } catch (_) { shot = ''; }
  log(`[등록] ✅ ${site.label} 입력 ${r.done.length}칸 완료${r.failed.length ? ' · 실패 ' + r.failed.join(', ') : ''} — 이 창에서 내용을 확인하고 저장·제출은 직접 하세요(창은 그대로 둡니다)`);
  return { ok: !r.failed.length, done: r.done, failed: r.failed, manual: o.plan.manual || [], shot };
}

module.exports = { PROFILE_DIR, SITES, runRegister, fillJakkawa, fillBookk };
