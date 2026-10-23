'use strict';
// node test/charge-link.test.js — 💳 크레딧 칸을 누르면 충전 페이지(v0.9.107) — 소스 검사
//   판매자(관리자) = kie 결제 페이지 · 회원 = primingwave.com 크레딧 충전 페이지 · 주소는 main 에 고정(렌더러가 정하지 않는다)
//   충전한 뒤 잔액이 안 바뀌던 것 = kie 잔액 1분 기억(licWithKie)이 새로고침을 막았다 → 돌아오면 force 로 기억을 건너뛴다.
const fs = require('fs');
const path = require('path');
const { SITE_CHARGE, isSiteUrl } = require('../core/license');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const R = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const main = R('main.js'), app = R('renderer', 'src', 'App.jsx'), pre = R('preload.js');

ok(/const KIE_BILLING_URL = 'https:\/\/kie\.ai\/billing';/.test(main), '판매자 충전 주소 = https://kie.ai/billing');
ok(isSiteUrl(SITE_CHARGE) && /^https:\/\/www\.primingwave\.com\//.test(SITE_CHARGE), '회원 충전 주소는 primingwave.com(https): ' + SITE_CHARGE);
{ const h = main.slice(main.indexOf("ipcMain.handle('open-charge-page'"), main.indexOf("ipcMain.handle('license-open-site'"));
  ok(/isOwner\(\)\) \{ shell\.openExternal\(KIE_BILLING_URL\)/.test(h) && /shell\.openExternal\(require\('\.\/core\/license'\)\.SITE_CHARGE\)/.test(h), '관리자만 kie · 그 밖은 사이트 충전 페이지');
  ok(!/\(_e, \w+/.test(h.split('\n')[1] || ''), '주소를 렌더러에서 받지 않는다(인자 없음)'); }
ok(/openChargePage: \(\) => ipcRenderer\.invoke\('open-charge-page'\)/.test(pre), 'preload 연결');
ok(!/'open-charge-page'/.test(main.slice(main.indexOf('const LIC_OPEN'), main.indexOf('const LIC_OPEN') + 600)), '로그인 전에는 열리지 않는다(LIC_OPEN 밖)');
ok((app.match(/data-testid="member-points"[^\n]*onClick=\{openCharge\}/g) || []).length === 4, '크레딧 칸 4가지 모양(관리자 키 없음·관리자·회원 0·회원)이 모두 충전 페이지를 연다');
ok(/chargeRef\.current = false;[\s\S]{0,200}refreshPoints\(false, true\)[\s\S]{0,200}setTimeout\(\(\) => refreshPoints\(true, true\), 8000\)[\s\S]{0,120}25000/.test(app), '돌아오면 바로 + 8초·25초 뒤 force 로 다시 읽는다(15초 제한 건너뜀)');
ok(/async function licWithKie\(s, force\) \{[\s\S]{0,120}if \(force\) _kieBal\.at = 0;/.test(main) && /licWithKie\(LIC\.state, !!\(o && o\.force\)\)/.test(main), 'force 면 kie 잔액 1분 기억을 건너뛴다');
ok(!/kie/i.test((app.match(/title=\{`내 크레딧[^\n]*/) || [''])[0]), '회원 크레딧 칸 글에 kie 낱말이 없다');

console.log(`\n${fail ? '❌' : '✅'} charge-link — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
