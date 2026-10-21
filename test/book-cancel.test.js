'use strict';
/** node test/book-cancel.test.js — ⏹ 출판 만들기 취소(v0.9.87): 조판 중 cancelAll → 그 단계가 「취소됨」으로 끝나고, 취소 뒤엔 새 조판을 띄우지 않는다 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const PB = require('../core/book/pdf-builder');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bkcancel-'));
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' + Array.from({ length: 400 }, (_, i) => `<p>${i} 문단 — 취소 시험</p>`).join('') + '</body></html>';
  const out = path.join(dir, 'out.pdf');

  // [1] 조판이 도는 중에 취소 → 취소됨으로 끝난다(완성 파일 없음) · 오래 기다리지 않는다
  PB.resetCancel();
  const t0 = Date.now();
  const p = PB.buildInteriorPdf({ html, outPdf: out, workDir: path.join(dir, 'w1') });
  setTimeout(() => PB.cancelAll(), 1500);
  const r = await p;
  const sec = (Date.now() - t0) / 1000;
  ok(r && r.cancelled === true && r.success === false, `조판 중 취소 → cancelled (${JSON.stringify({ success: r.success, cancelled: r.cancelled, error: r.error })})`);
  ok(sec < 20, `취소하면 곧 끝난다 (${sec.toFixed(1)}초)`);
  ok(!fs.existsSync(out), '취소된 PDF 는 남지 않는다');

  // [2] 취소 표시가 남아 있는 동안 새 조판은 띄우지 않는다(표지·다음 권으로 넘어가지 않게)
  const t1 = Date.now();
  const r2 = await PB.buildCoverPdf({ imagePath: null, spread: { widthMm: 300, heightMm: 216, spineMm: 10, parts: [{ name: 'bleed', mm: 3 }, { name: '뒤표지', mm: 142 }, { name: '책등', mm: 10 }, { name: '앞표지', mm: 142 }, { name: 'bleed', mm: 3 }] }, outPdf: path.join(dir, 'c.pdf'), workDir: path.join(dir, 'w2'), compose: { overlay: { title: 'T' } } });
  ok(r2 && r2.cancelled === true && Date.now() - t1 < 3000, '취소 뒤 표지 단계는 바로 「취소됨」(새 조판 안 띄움)');

  // [3] resetCancel 뒤에는 다시 만들 수 있다(판정력 — 취소 표시가 영영 남지 않는다)
  PB.resetCancel();
  ok(PB.isCancelled() === false, 'resetCancel → 다시 만들 수 있는 상태');

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${fail ? '❌' : '✅'} book-cancel — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
