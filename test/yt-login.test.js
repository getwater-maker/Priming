'use strict';
/**
 * test/yt-login.test.js — 🔑 진짜 크롬/엣지로 유튜브 로그인 쿠키 받기(v1.0.24)
 * 실제 크롬(헤드리스 · 임시 프로필)을 띄워 CDP 로 쿠키를 읽는 배관을 시험한다. 구글에 접속하지 않는다(시작 주소 = about:blank).
 * 로그인은 가짜 쿠키를 CDP 로 넣어 흉내 낸다. 크롬·엣지가 없으면 그 부분은 건너뛴다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const YL = require('../core/yt-login');
const YC = require('../core/yt-cookies');
const LO = require('../core/link-opener');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

(async () => {
  console.log('\n[1] 변환·고르기');
  {
    const c = YL.fromPlaywright([{ name: 'SAPISID', value: 'v', domain: '.youtube.com', path: '/', expires: 2000000000, httpOnly: false, secure: true }, { name: 'S', value: 'x', domain: '.google.com', expires: -1 }]);
    ok(c[0].expirationDate === 2000000000 && c[1].expirationDate === undefined, 'expires → expirationDate(세션 쿠키는 없음)');
    ok(YC.isLoggedIn(c), '변환 뒤 로그인 판정');
    ok(YL.pickBrowser([{ id: 'edge' }, { id: 'chrome' }]).id === 'chrome', '크롬 우선');
    ok(YL.pickBrowser([{ id: 'edge' }]).id === 'edge', '크롬이 없으면 엣지');
    ok(YL.pickBrowser([]) === null, '둘 다 없으면 null');
    ok(YL.START_URL.startsWith('https://accounts.google.com/ServiceLogin'), '시작 주소는 구글 로그인 페이지');
  }

  console.log('\n[2] 진짜 브라우저 + CDP (헤드리스 · 임시 프로필)');
  const br = YL.pickBrowser(LO.detect());
  if (!br) { console.log('  · 크롬·엣지 없음 — 건너뜀'); }
  else {
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('priming-ytlogin-')).length;
    const pw = require('playwright').chromium;
    // 로그인 흉내 — 연결 직후 CDP 로 가짜 로그인 쿠키(+ 다른 사이트 쿠키)를 넣는다
    const fake = {
      connectOverCDP: async (url) => {
        const b = await pw.connectOverCDP(url);
        const ctx = b.contexts()[0];
        const exp = Math.floor(Date.now() / 1000) + 86400;
        await ctx.addCookies([
          { name: 'SAPISID', value: 'TESTVALUE', domain: '.youtube.com', path: '/', expires: exp, secure: true },
          { name: 'LOGIN_INFO', value: 'x', domain: '.youtube.com', path: '/', expires: exp, secure: true, httpOnly: true },
          { name: 'unrelated', value: 'no', domain: '.example.com', path: '/', expires: exp },
        ]);
        return b;
      },
    };
    const logs = [];
    const r = await YL.login({ exe: br.exe, spawn, chromium: fake, tmpRoot: os.tmpdir(), fsApi: fs, log: (m) => logs.push(m), headless: true, startUrl: 'about:blank', settleMs: 300, pollMs: 300 });
    ok(r.ok && Array.isArray(r.cookies), `로그인 쿠키를 받았다 (${br.label})`);
    ok(r.cookies && r.cookies.some((c) => c.name === 'SAPISID' && c.value === 'TESTVALUE'), 'SAPISID 값이 CDP 로 읽힌다');
    ok(r.cookies && !r.cookies.some((c) => c.name === 'unrelated'), '다른 사이트 쿠키는 거른다');
    ok(r.cookies && YC.isLoggedIn(r.cookies), '받은 쿠키가 로그인으로 판정');
    ok(!logs.join('').includes('TESTVALUE'), '로그에 쿠키 값이 없다');
    await new Promise((res) => setTimeout(res, 1500));
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('priming-ytlogin-')).length;
    ok(after <= before, `임시 프로필 폴더를 지웠다 (전 ${before} → 후 ${after})`);

    // 판정력 — 로그인 쿠키가 없으면 끝내 못 받는다(짧은 제한 시간)
    const t0 = Date.now();
    const r2 = await YL.login({ exe: br.exe, spawn, chromium: pw, tmpRoot: os.tmpdir(), fsApi: fs, headless: true, startUrl: 'about:blank', timeoutMs: 2500, pollMs: 300 });
    ok(!r2.ok && /시간 초과/.test(r2.error || ''), '로그인 쿠키가 없으면 시간 초과로 끝난다(판정력)');
    ok(Date.now() - t0 < 20000, '제한 시간 안에 정리됐다');

    // 사용자가 창을 닫으면 취소
    const closer = { connectOverCDP: async (url) => { const b = await pw.connectOverCDP(url); setTimeout(() => { try { b.close(); } catch (_) {} }, 10); return b; } };
    const r3 = await YL.login({ exe: br.exe, spawn, chromium: closer, tmpRoot: os.tmpdir(), fsApi: fs, headless: true, startUrl: 'about:blank', timeoutMs: 4000, pollMs: 300, isCanceled: () => true });
    ok(r3.canceled === true, '취소 신호면 canceled');
  }

  console.log('\n[3] main 연결');
  {
    const m = read('main.js');
    ok(/require\('\.\/core\/yt-login'\)/.test(m) && /YL\.login\(/.test(m), 'main 이 core/yt-login 으로 로그인');
    ok(!/session\.fromPartition\(part\)/.test(m) && !/ses\.setUserAgent/.test(m), '앱 안(Electron) 로그인 창·UA 꾸미기는 없다');
    ok(/ipcMain\.handle\('yt-login-open', async \(\) => \{\s*if \(!isOwner\(\)\)/.test(m), '관리자 전용');
  }

  console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
