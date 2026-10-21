'use strict';
// node test/book-cancel-ui.smoke.js — ⏹ 출판 만들기 팝업(v0.9.87): 경과 시간 · 「취소」로 조판을 멈춘다 · 등록 카드 「이어 채우기」 글자가 잘리지 않는다
const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'output', '_book-cancel-smoke');
const SAMPLE = path.join(DIR, 'cancel-book.md');
const para = '조선의 밤은 길고 깊었다. 등불 하나에 의지해 역사를 기록하던 사람들이 있었다. '.repeat(30);
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(SAMPLE, `# 취소시험 책\n> 저자: 홍길동\n> 출판사: 프라이밍북스\n> 판형: 46판\n\n${Array.from({ length: 40 }, (_, i) => `## ${i + 1}장. 장\n${para}\n`).join('\n')}\n## [판권]\n`, 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    const r = await win.evaluate((p) => window.api.openBookPath({ scriptPath: p }), SAMPLE);
    if (!r || !r.dto || r.dto.kind !== 'book') throw new Error('openBookPath 실패');
    await win.click('.modetoggle button:has-text("📖 출판")');
    await win.waitForSelector('.bkwrap', { timeout: 10000 });
    await win.waitForFunction(() => { const el = document.querySelector('.bkpage'); return el && /\/\s*\d+쪽/.test(el.textContent); }, null, { timeout: 90000 });
    await win.click('[data-tab=bookk]');
    await win.waitForSelector('[data-testid=bk-pdf-print]', { timeout: 10000 });

    // [1] 이어 채우기 — 버튼 글자가 잘리지 않는다(좁은 카드면 두 줄로 내려간다)
    const clip = await win.evaluate(() => ['bk-register-bookk', 'bk-register-cover', 'bk-register-ebook', 'bk-register-ebook-resume'].map((id) => {
      const b = document.querySelector(`[data-testid=${id}]`); return b ? { id, sw: b.scrollWidth, cw: b.clientWidth } : { id, missing: true };
    }));
    ok(clip.every((c) => !c.missing && c.sw <= c.cw + 1), '등록 버튼 4개 글자 잘림 없음 ' + JSON.stringify(clip));

    // [2] 종이책 만들기 → 팝업에 경과 시간 · 취소 버튼
    await win.click('[data-testid=bk-pdf-print]');
    await win.waitForSelector('[data-testid=bk-build-cancel]', { timeout: 8000 });
    await win.waitForTimeout(2200);
    const el = await win.locator('[data-testid=bk-build-elapsed]').innerText();
    ok(/경과\s*[1-9]\d*초|분/.test(el), '경과 시간이 흐른다: ' + el);
    await win.screenshot({ path: path.join(DIR, 'build-modal.png') });

    // [3] 취소 → 팝업이 닫히고 「취소」 상태 · 내지 PDF 가 생기지 않는다
    const t0 = Date.now();
    await win.click('[data-testid=bk-build-cancel]');
    await win.waitForFunction(() => !document.querySelector('[data-testid=bk-build-elapsed]'), null, { timeout: 30000 });
    ok(Date.now() - t0 < 30000, `취소 뒤 팝업이 닫힌다 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
    const st = await win.evaluate(() => (document.getElementById('status') || {}).textContent || '');
    void st;   // (출판 화면에선 앱 상태 줄을 쓰지 않는다 — 판정은 로그 파일로)
    await win.waitForTimeout(800);
    const kst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    let logTxt = ''; try { logTxt = fs.readFileSync(path.join(require('os').homedir(), '.shots-maker', 'logs', kst + '.log'), 'utf8').slice(-20000); } catch (_) {}
    ok(/만들기 취소 — 종이책 (내지|표지) PDF 단계에서 멈췄습니다/.test(logTxt), '로그: 「만들기 취소 — 종이책 … 단계에서 멈췄습니다」(조판 중에 실제로 멈췄다)');
    const pdfs = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/내지\.pdf$/.test(e.name) && fs.statSync(p).mtimeMs > t0 - 60000) pdfs.push(p); } };
    try { walk(r.dto.outRoot || path.join(ROOT, 'output')); } catch (_) {}
    ok(pdfs.length === 0, '취소한 내지 PDF 가 새로 생기지 않았다 ' + JSON.stringify(pdfs));

    // [4] 취소 뒤 다시 만들 수 있다(취소 표시가 남아 다음 만들기를 막지 않는다) — 바로 다시 취소
    await win.click('[data-testid=bk-pdf-print]');
    await win.waitForSelector('[data-testid=bk-build-cancel]', { timeout: 8000 });
    await win.waitForTimeout(1500);
    await win.click('[data-testid=bk-build-cancel]');
    await win.waitForFunction(() => !document.querySelector('[data-testid=bk-build-elapsed]'), null, { timeout: 30000 });
    ok(true, '두 번째 만들기도 시작·취소됨');
  } catch (e) { fail++; console.log('❌ ' + e.message); }
  finally { await app.close().catch(() => {}); }
  console.log(`\n${fail ? '❌' : '✅'} book-cancel-ui — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
