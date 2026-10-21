'use strict';
// node test/book-preview-pages.smoke.js — 📖 조판 도중 미리보기를 새로 만들어도(원고 메타 변경) 옛 뷰어의 중간 쪽수가 보고되지 않는다(v0.9.88)
//   재현 근거: 삼국지 5권 — 조판 중 원고가 바뀌어 미리보기를 다시 만들자 옛 뷰어가 버려진 문서에서 「259쪽」을 보고(실제 281쪽).
const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'output', '_book-preview-pages-smoke');
const SAMPLE = path.join(DIR, 'preview-pages-book.md');
const para = '조선의 밤은 길고 깊었다. 등불 하나에 의지해 역사를 기록하던 사람들이 있었다. 그들은 붓을 들어 하루를 적었고, 그 기록은 오늘까지 남았다. '.repeat(14);
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(SAMPLE, `# 쪽수시험 책\n> 저자: 홍길동\n> 출판사: 프라이밍북스\n> 판형: A5\n\n${Array.from({ length: 60 }, (_, i) => `## ${i + 1}장. 장\n${(para + '\n\n').repeat(4)}`).join('\n')}\n## [판권]\n`, 'utf8');

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
    const snap = () => win.evaluate(() => {
      const d = (document.querySelector('.bkcenter iframe') || {}).contentDocument;
      const vp = d && d.getElementById('vp');
      const m = ((document.querySelector('.bkstatus') || {}).textContent || '').match(/총\s*(\d+)쪽/);
      return { st: vp ? vp.getAttribute('data-vivliostyle-viewer-status') : null, dom: d ? d.querySelectorAll('[data-vivliostyle-page-container]').length : 0, side: m ? Number(m[1]) : 0 };
    });
    // 첫 조판이 한창일 때(아직 쪽수를 모를 때) 원고 메타를 바꿔 미리보기를 새로 만든다 — 삼국지 5권 재현과 같은 모양
    //   (고치기 전: 버려진 첫 뷰어가 버려진 문서에서 마저 돌아 'complete' 를 내고 중간 숫자를 보고했다 · 실측 259쪽 ≠ 281쪽)
    const seen = []; let changes = 0, restarted = 0, last = null;
    for (let i = 0; i < 900; i++) {
      const s = await snap(); last = s;
      if (process.env.DBG && i % 10 === 0) console.log(i, changes, restarted, JSON.stringify(s));
      if (s.side && seen[seen.length - 1] !== s.side) seen.push(s.side);
      if (changes && !restarted && (s.st === 'loading' || s.dom < 20)) restarted = 1;
      if (!changes && s.st === 'interactive' && s.dom >= 100) { await win.evaluate(() => window.api.bookSetMeta({ key: 'subtitle', value: '부제 1' })); changes = 1; continue; }
      if (restarted && s.st === 'complete' && s.side === s.dom) { await win.waitForTimeout(20000); last = await snap(); if (last.side && seen[seen.length - 1] !== last.side) seen.push(last.side); break; }
      await win.waitForTimeout(400);
    }
    const full = last && last.dom;
    ok(changes === 1 && restarted === 1, `첫 조판 도중 미리보기를 새로 만들었다 (바꿈 ${changes} · 새 조판 ${restarted})`);
    ok(last && last.st === 'complete' && last.side === last.dom, `끝 쪽수 = 화면에 그려진 쪽 수 (${JSON.stringify(last)})`);
    ok(full > 0 && seen.every((n) => n === full), `보고된 쪽수는 끝 쪽수(${full}) 하나뿐 — 버려진 뷰어의 중간 숫자 없음 (본 값 순서: ${seen.join(' → ') || '없음'})`);
  } catch (e) { fail++; console.log('❌ ' + e.message); }
  finally { await app.close().catch(() => {}); }
  console.log(`\n${fail ? '❌' : '✅'} book-preview-pages.smoke — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
