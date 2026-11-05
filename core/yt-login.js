'use strict';
/**
 * yt-login.js — 유튜브 로그인 쿠키를 **진짜 크롬/엣지**에서 받아 온다(v1.0.24 · 로이 2026-11-05).
 *
 * 왜 이렇게: 앱 안(Electron) 로그인 창은 구글이 「이 브라우저 또는 앱이 안전하지 않을 수 있습니다」로 막는다(v1.0.23 실물 확인 ·
 *   UA 를 바꿔 피하려 하지 않는다 — 구글이 일부러 막는 곳이고 계정에 위험). 그래서:
 *   ① 설치된 크롬(없으면 엣지)을 **새 임시 프로필 + 원격 디버깅 포트**로 띄운다 — 로이의 평소 프로필은 건드리지 않는다
 *   ② 사람이 그 창에서 **전용 구글 계정**으로 로그인한다(비밀번호는 앱이 보지 않는다)
 *   ③ 로그인 쿠키(SAPISID 류)가 생기면 CDP(playwright connectOverCDP)로 쿠키만 읽는다
 *   ④ 브라우저를 닫고 임시 프로필을 지운다 — 남은 브라우저가 쿠키를 돌려 유튜브가 무효화하는 일이 없게
 * 저장은 호출한 쪽(main)이 `core/yt-cookies.save` 로 한다. 이 모듈은 쿠키를 디스크에 쓰지 않는다.
 * 부수 효과(실행·네트워크·파일)는 모두 주입 — 시험이 가짜로 돈다.
 */
const YC = require('./yt-cookies');

const START_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&hl=ko&continue=' + encodeURIComponent('https://www.youtube.com/');

/** Playwright 쿠키 → yt-cookies 모양 */
function fromPlaywright(list) {
  return (Array.isArray(list) ? list : []).map((c) => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
    secure: !!c.secure, httpOnly: !!c.httpOnly,
    expirationDate: c.expires && c.expires > 0 ? c.expires : undefined,
  }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} o
 *   o.exe        크롬·엣지 실행 파일
 *   o.spawn      child_process.spawn
 *   o.chromium   playwright.chromium
 *   o.tmpRoot    임시 프로필을 만들 폴더
 *   o.fsApi      { mkdtempSync, rmSync }
 *   o.fetch      전역 fetch(디버깅 포트 확인)
 *   o.log        (msg) => void
 *   o.headless   시험용 — 창 없이
 *   o.startUrl   시험용 — 시작 주소
 * @returns {Promise<{ok:boolean, cookies?:object[], error?:string, canceled?:boolean}>}
 */
async function login(o) {
  const { exe, spawn, chromium, tmpRoot, fsApi, log = () => {} } = o;
  const fetchFn = o.fetch || globalThis.fetch;
  const timeoutMs = o.timeoutMs || 10 * 60 * 1000;
  const pollMs = o.pollMs || 2000;
  const settleMs = o.settleMs == null ? 3500 : o.settleMs;
  if (!exe) return { ok: false, error: '크롬 또는 엣지가 설치돼 있지 않습니다' };

  const dir = fsApi.mkdtempSync(require('path').join(tmpRoot, 'priming-ytlogin-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const args = [
    `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, '--remote-allow-origins=*',
    '--no-first-run', '--no-default-browser-check', '--disable-features=Translate',
    ...(o.headless ? ['--headless=new'] : []),
    o.startUrl || START_URL,
  ];
  const child = spawn(exe, args, { stdio: 'ignore', windowsHide: false });
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.on('error', () => { exited = true; });
  let browser = null;

  const cleanup = async () => {
    try { if (browser) await browser.close(); } catch (_) {}
    try { if (!exited) child.kill(); } catch (_) {}
    await sleep(600);
    // 임시 프로필 삭제(크롬이 파일을 놓는 데 시간이 걸려 몇 번 시도)
    for (let i = 0; i < 6; i++) {
      try { fsApi.rmSync(dir, { recursive: true, force: true }); break; } catch (_) { await sleep(500); }
    }
  };

  try {
    // 디버깅 포트가 열릴 때까지
    let up = false;
    for (let i = 0; i < 40 && !exited; i++) {
      try { const r = await fetchFn(`http://127.0.0.1:${port}/json/version`); if (r.ok) { up = true; break; } } catch (_) {}
      await sleep(500);
    }
    if (!up) return { ok: false, error: exited ? '브라우저가 바로 닫혔습니다' : '브라우저에 연결하지 못했습니다(디버깅 포트)' };
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    log('🔑 로그인 창을 열었습니다 — 열린 크롬 창에서 전용 구글 계정으로 로그인하세요(비밀번호는 앱이 보지 않습니다)');

    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (o.isCanceled && o.isCanceled()) return { ok: false, canceled: true };
      if (exited) return { ok: false, canceled: true };
      let cks = [];
      try { const ctx = browser.contexts()[0]; cks = ctx ? fromPlaywright(await ctx.cookies()) : []; } catch (_) {}
      if (YC.isLoggedIn(cks)) {
        await sleep(settleMs);       // 유튜브 쪽 쿠키(LOGIN_INFO · VISITOR_INFO1_LIVE …)가 채워질 시간
        try { const ctx = browser.contexts()[0]; cks = fromPlaywright(await ctx.cookies()); } catch (_) {}
        return { ok: true, cookies: YC.filterCookies(cks) };
      }
      await sleep(pollMs);
    }
    return { ok: false, error: '시간 초과(10분)' };
  } catch (e) {
    return { ok: false, error: '로그인 처리 실패: ' + e.message };
  } finally { await cleanup(); }
}

/** 크롬 → 엣지 순으로 고른다(`core/link-opener.detect` 결과를 받는다) */
function pickBrowser(detected) {
  const list = Array.isArray(detected) ? detected : [];
  return list.find((b) => b.id === 'chrome') || list.find((b) => b.id === 'edge') || null;
}

module.exports = { login, fromPlaywright, pickBrowser, START_URL };
