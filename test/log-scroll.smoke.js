'use strict';
/**
 * node test/log-scroll.smoke.js — 로그창: 스크롤바 없음 · 긴 줄은 다음 줄로 · 휠로는 스크롤된다 (2026-09-25)
 *   로이: "로그창의 세로 스크롤바는 제거 … 가로 스크롤바도 … 내용을 다음줄로 넘기면 되자나".
 */
const path = require('path');
const { _electron: electron } = require('playwright');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '..')], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('#log', { timeout: 20000 });
    // 공백 없는 긴 경로 + 줄 여러 개로 채운다
    await win.evaluate(() => {
      const L = window.__logline;
      L('G:\\내 드라이브\\## 유튜브채널\\02_한득수\\01_업로드\\01_고전\\01_로이의 고전이야기\\아주긴파일이름_' + 'x'.repeat(160) + '.mp4');
      for (let i = 0; i < 60; i++) L(`줄 ${i} — 로그 스크롤 점검용 문장입니다.`);
    });
    await win.waitForTimeout(300);
    const m = await win.evaluate(() => {
      const el = document.getElementById('log');
      return { sw: el.scrollWidth, cw: el.clientWidth, ow: el.offsetWidth, sh: el.scrollHeight, ch: el.clientHeight, st: el.scrollTop };
    });
    ok(m.sw <= m.cw + 1, `가로로 넘치지 않는다 — 긴 줄은 다음 줄로 (${m.sw} ≤ ${m.cw})`);
    ok(m.ow - m.cw <= 2, `세로 스크롤바 자리 없음 (테두리 포함 차이 ${m.ow - m.cw}px)`);
    ok(m.sh > m.ch, '내용은 창보다 길다(스크롤할 거리가 있다)');
    const box = await win.locator('#log').boundingBox();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.evaluate(() => { document.getElementById('log').scrollTop = 0; });
    await win.mouse.wheel(0, 300);
    await win.waitForTimeout(300);
    ok(await win.evaluate(() => document.getElementById('log').scrollTop) > 0, '마우스 휠로 스크롤된다');
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} 로그창 스크롤 E2E ${pass}/${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 실패:', e); process.exit(1); });
