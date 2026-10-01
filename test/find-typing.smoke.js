'use strict';
// node test/find-typing.smoke.js — 화면 검색창(Ctrl+F) 타이핑 E2E.
//   🔴 로이 2026-10-01: 「검색기능이 타이핑이 제대로 되지가 않네」 — find-in-page 가 검색창 자기 글자를 찾아(1/1) 입력창 글자를 통째로 선택하고
//   포커스를 가져가, 다음 글자가 선택된 글을 덮어써서 타이핑이 끊기고 검색이 안 됐다.
//   → 디바운스(280ms)보다 느리게 한 글자씩 치면서 입력값이 온전한지, 개수(검색창 자신 제외)가 나오는지 본다.
//   ⚠ renderer/dist 번들을 읽는다 — 화면 코드를 고쳤으면 npm run build:renderer 뒤에 돌린다.
const path = require('path');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };
(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('#find-input', { timeout: 30000 });
    await win.waitForTimeout(1500);
    const inp = win.locator('#find-input');
    await inp.click();
    for (const ch of '설정') { await win.keyboard.type(ch); await win.waitForTimeout(450); }   // 디바운스보다 느리게 — 글자 사이에 검색이 실제로 돈다
    await win.waitForTimeout(800);
    const v = await inp.inputValue();
    ok(v === '설정', `타이핑이 온전하다: 입력값 「${v}」 (기대 「설정」)`);
    const focused = await win.evaluate(() => document.activeElement && document.activeElement.id);
    ok(focused === 'find-input', `검색 뒤에도 포커스가 검색창에 있다 (${focused})`);
    const cnt = (await win.locator('.fcnt').innerText()).trim();
    const m = /^(\d+)\/(\d+)$/.exec(cnt);
    ok(!!m && Number(m[2]) >= 1 && Number(m[1]) >= 1, `일치 개수 표시 「${cnt}」 (검색창 자신은 뺀 값, 헤더의 「설정」 버튼이 있다)`);
    // 이어 쓰기 — 한 글자 더 쳐도 앞 글자가 안 사라진다
    await win.keyboard.type('창'); await win.waitForTimeout(700);
    ok((await inp.inputValue()) === '설정창', `이어 쓰기: 「${await inp.inputValue()}」`);
    // 없는 글자 — 「없음」(검색창 자신만 일치)
    await inp.fill(''); await win.waitForTimeout(300);
    for (const ch of 'zqxjwv') { await win.keyboard.type(ch); await win.waitForTimeout(100); }
    await win.waitForTimeout(900);
    const none = (await win.locator('.fcnt').innerText()).trim();
    ok((await inp.inputValue()) === 'zqxjwv' && none === '없음', `없는 글자: 입력 온전 + 표시 「${none}」`);
    // Esc — 지움
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
    ok((await inp.inputValue()) === '', 'Esc 로 검색어 지움');
  } finally { await app.close(); }
  console.log(`\n${bad ? '❌' : '✅'} find-typing — ${n - bad}/${n} 통과`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
