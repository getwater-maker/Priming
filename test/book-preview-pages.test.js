'use strict';
/** node test/book-preview-pages.test.js — 📖 미리보기 쪽수 보고 판정(옛 뷰어·화면과 다른 쪽수는 보고하지 않는다 · v0.9.88) */
const { pageReport } = require('../core/book/preview-pages');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

let r = pageReport({ isCurrent: true, total: 281, domPages: 281, known: 0 });
ok(r.show && r.report, '지금 뷰어 · 화면과 같은 281쪽 · 서버 모름 → 보고');
r = pageReport({ isCurrent: true, total: 281, domPages: 281, known: 281 });
ok(r.show && !r.report, '서버가 이미 281쪽 → 표시만, 다시 보고 안 함');
r = pageReport({ isCurrent: false, total: 259, domPages: 105, known: 0 });
ok(!r.show && !r.report && r.reason === 'stale-viewer', '삼국지 5권 실측 — 옛 뷰어의 259쪽 → 보고 안 함');
r = pageReport({ isCurrent: true, total: 71, domPages: 281, known: 0 });
ok(!r.show && !r.report && r.reason === 'dom-mismatch', '뷰어 숫자와 화면에 그려진 쪽 수가 다르면 → 보고 안 함');
r = pageReport({ isCurrent: true, total: 0, domPages: 0, known: 0 });
ok(!r.show && r.reason === 'no-pages', '0쪽 → 보고 안 함');
console.log(`\n${fail ? '❌' : '✅'} book-preview-pages — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
