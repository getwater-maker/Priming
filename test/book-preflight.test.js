'use strict';
/** node test/book-preflight.test.js — 🔎 부크크 올리기 전 점검(순수) */
const { preflight } = require('../core/book/preflight');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const by = (r, id) => r.items.find((i) => i.id === id);
const good = {
  meta: { title: 'T', author: 'A', publisher: 'P', issueDate: '2026-10-01', price: '15000', ebookPrice: '3000', isbn: '979' },
  pages: 232, spineMm: 14.36, coverImagePath: 'D:/표지/삼국지_표지.png',
  coverCheck: { ok: true, exact: true, lowDpi: false, mmW: 516.4, mmH: 216, expected: { widthMm: 516.36, heightMm: 216 } },
  titleFit: { count: { header: 0, toc3: 0, max: 0 } }, footnotes: { dups: [], undefinedRefs: [], unused: [], refCount: 10, defCount: 10 },
  glyph: { missing: [], unreadable: [] }, missingFonts: [], sourceMtime: 1000,
  outputs: [{ kind: 'interior', name: 'a_내지.pdf', bytes: 5e6, mtime: 2000 }, { kind: 'cover', name: 'a_표지.pdf', bytes: 2e6, mtime: 2000 }, { kind: 'epub', name: 'a.epub', bytes: 7e6, mtime: 2000 }],
};
let r = preflight(good);
ok(r.ready && r.summary.error === 0 && r.summary.warn === 0, `모든 것이 갖춰지면 막힘 0 · 확인 0 (${JSON.stringify(r.summary)})`);
r = preflight({ ...good, pages: 0 });
ok(by(r, 'pages').state === 'warn' && /쪽수가 확정/.test(by(r, 'pages').detail), '쪽수 미확정 → 확인 + 안내');
ok(by(preflight({ ...good, pages: 30 }), 'pages').state === 'error', '30쪽 → 최소 50쪽 error');
ok(by(preflight({ ...good, coverImagePath: 'x/표지_시안.png' }), 'cover').state === 'error', '「시안」 표지 → error');
ok(by(preflight({ ...good, coverCheck: { ...good.coverCheck, exact: false, mmW: 514.1 } }), 'cover').state === 'warn' && /다시 만드세요/.test(by(preflight({ ...good, coverCheck: { ...good.coverCheck, exact: false, mmW: 514.1 } }), 'cover').detail), '폭 ±1mm 밖(비율로만 통과) → 책등 다시 안내');
ok(by(preflight({ ...good, coverCheck: { ok: false, flapHint: 'file-has-flaps', expected: {}, } }), 'cover').state === 'error', '날개 힌트 → error');
ok(by(preflight({ ...good, coverImagePath: null, coverCheck: null }), 'cover').state === 'warn', '표지 없음 → 확인');
ok(by(preflight({ ...good, glyph: { missing: [{ ch: '槳' }] } }), 'glyph').state === 'error', '누락 글자 → error');
ok(by(preflight({ ...good, footnotes: { dups: ['1'], undefinedRefs: [], unused: [], refCount: 1, defCount: 1 } }), 'footnotes').state === 'error', '각주 번호 중복 → error');
ok(by(preflight({ ...good, meta: { title: 'T' } }), 'meta').state === 'error' && /저자/.test(by(preflight({ ...good, meta: { title: 'T' } }), 'meta').detail), '필수 정보 비면 error');
ok(by(preflight({ ...good, sourceMtime: 5000 }), 'out-interior').state === 'warn', '원고가 완성 파일보다 새로우면 → 다시 만들기');
ok(by(preflight({ ...good, outputs: [{ kind: 'epub', name: 'b.epub', bytes: 21 * 1048576, mtime: 2000 }] }), 'epub-size').state === 'error', 'ePub 21MB → error');
ok(by(preflight({ ...good, missingFonts: ['HanjaSerif-Light.ttf'] }), 'fontfiles').state === 'error', '동봉 글꼴 파일 없음 → error');
console.log(`\n${fail ? '❌' : '✅'} book-preflight — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
