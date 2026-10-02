'use strict';
// node test/book-extwatch.smoke.js — 📖 출판 원고(.md)가 밖에서 바뀌면 앱이 자동으로 다시 읽는다(로이 2026-10-02: 출판 세션이 제1권.md 를 늘리는 동안
//   앱은 옛 판을 쥐고 「59쪽·책등 4.85mm」로 표시했다 — 롱폼 감시는 book 을 빼 뒀고 출판용이 없었다).
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron: electron } = require('playwright');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };
const para = '조식은 붓을 들어 이렇게 적었다. 천하의 일은 합쳐지면 나뉘고 나뉘면 다시 합쳐진다는 말이 있다.';
const NL = String.fromCharCode(10);
const md = (k) => ['# 감시 시험', '> 저자: 나', '', ...Array.from({ length: k }, (_, i) => ['## 제' + (i + 1) + '회 가' + (i + 1), para, '']).flat()].join(NL);
(async () => {
  const f = path.join(os.tmpdir(), 'extwatch-book-' + process.pid + '.md');
  fs.writeFileSync(f, md(1), 'utf8');
  const app = await electron.launch({ args: [path.join(__dirname, '..')], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    const chapters = (dto) => dto.parts.reduce((s, p) => s + p.chapters.length, 0);
    const r = await win.evaluate((p) => window.api.openBookPath({ scriptPath: p }), f);
    ok(r && r.dto && chapters(r.dto) === 1, '처음 연 원고: 장 1개');
    await win.waitForTimeout(2500);   // 감시가 기준을 잡는다
    fs.writeFileSync(f, md(3), 'utf8');   // 밖(다른 세션)에서 원고를 늘린다
    let got = 0;
    for (let i = 0; i < 12 && got !== 3; i++) { await win.waitForTimeout(700); const d = await win.evaluate(() => window.api.bookReportPages({ pages: 0 })); got = d && d.parts ? chapters(d) : 0; }
    ok(got === 3, `밖에서 늘린 원고(3회)를 자동으로 다시 읽었다 (장 ${got}개)`);
    fs.writeFileSync(f, md(2), 'utf8');   // 줄이기도 따라간다(판별)
    for (let i = 0; i < 12 && got !== 2; i++) { await win.waitForTimeout(700); const d = await win.evaluate(() => window.api.bookReportPages({ pages: 0 })); got = d && d.parts ? chapters(d) : 0; }
    ok(got === 2, `다시 줄인 원고(2회)도 따라간다 (장 ${got}개)`);
  } finally { await app.close(); try { fs.unlinkSync(f); } catch (_) {} }
  console.log(`${bad ? '❌' : '✅'} book-extwatch — ${n - bad}/${n} 통과`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
