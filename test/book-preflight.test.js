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
ok(by(r, 'pages').state === 'pending' && /실제 쪽수/.test(by(r, 'pages').detail) && r.summary.warn === 0, '쪽수 미확정 → ⏳ 대기(문제로 세지 않음) + 안내');
ok(by(preflight({ ...good, pages: 30 }), 'pages').state === 'error', '30쪽 → 최소 50쪽 error');
ok(by(preflight({ ...good, coverImagePath: 'x/표지_시안.png' }), 'cover').state === 'warn' && !by(preflight({ ...good, meta: { title: 'T' }, coverImagePath: 'x/표지.png' }), 'price'), '「시안」 표지 원본 → 확인(warn — 업로드는 앱이 만든 표지 PDF) · 가격·ISBN 은 점검하지 않는다');
ok(by(preflight({ ...good, coverCheck: { ...good.coverCheck, exact: false, mmW: 514.1 } }), 'cover').state === 'warn' && /다시 만드세요/.test(by(preflight({ ...good, coverCheck: { ...good.coverCheck, exact: false, mmW: 514.1 } }), 'cover').detail), '폭 ±1mm 밖(비율로만 통과) → 책등 다시 안내');
ok(by(preflight({ ...good, coverCheck: { ok: false, flapHint: 'file-has-flaps', expected: {}, } }), 'cover').state === 'error', '날개 힌트 → error');
ok(by(preflight({ ...good, coverImagePath: null, coverCheck: null }), 'cover').state === 'warn', '표지 없음 → 확인');
ok(by(preflight({ ...good, glyph: { missing: [{ ch: '槳' }] } }), 'glyph').state === 'error', '누락 글자 → error');
ok(by(preflight({ ...good, footnotes: { dups: ['1'], undefinedRefs: [], unused: [], refCount: 1, defCount: 1 } }), 'footnotes').state === 'error', '각주 번호 중복 → error');
ok(by(preflight({ ...good, meta: { title: 'T' } }), 'meta').state === 'error' && /저자/.test(by(preflight({ ...good, meta: { title: 'T' } }), 'meta').detail), '필수 정보 비면 error');
ok(by(preflight({ ...good, sourceMtime: 5000 }), 'out-interior').state === 'todo', '원고가 완성 파일보다 새로우면 → 📝 남은 단계(다시 만들기)');
// 📌 v0.9.87 — 미리보기 쪽수(잠정)로는 표지 치수·최소 쪽수를 「고쳐야 할 것」으로 판정하지 않는다(삼국지 5권: 미리보기 71쪽 · 실제 표지는 ~283쪽 책등)
const bad5 = { ...good, pages: 71, spineMm: 5.51, pagesSure: false, coverCheck: { ok: false, exact: false, mmW: 519.2, mmH: 216, expected: { widthMm: 507.51, heightMm: 216 } } };
r = preflight(bad5);
ok(r.ready && r.summary.error === 0 && by(r, 'pages').state === 'pending' && by(r, 'cover').state === 'pending' && /확정된 뒤/.test(by(r, 'cover').detail), '잠정 71쪽 + 치수 다른 표지 → ⛔ 아님 · 쪽수·표지 모두 ⏳');
r = preflight({ ...bad5, pagesSure: true });
ok(!r.ready && by(r, 'cover').state === 'error', '같은 값이 확정 쪽수(내지 PDF)면 → ⛔ 표지 치수 불일치 (판정력)');
ok(by(preflight({ ...good, pages: 30, pagesSure: false }), 'pages').state === 'pending' && by(preflight({ ...good, pages: 30, pagesSure: true }), 'pages').state === 'error', '최소 쪽수 판정은 확정 쪽수에서만');
ok(by(preflight({ ...bad5, coverCheck: { ok: false, flapHint: 'file-has-flaps', expected: {} } }), 'cover').state === 'error', '날개 차이(수백 mm)는 잠정 쪽수여도 ⛔');
ok(by(preflight({ ...good, outputs: [] }), 'out-interior').state === 'todo' && preflight({ ...good, outputs: [] }).summary.todo >= 3 && preflight({ ...good, outputs: [] }).summary.warn === 0, '아직 안 만든 완성 파일 → 📝 남은 단계로 센다(⚠ 아님)');
ok(by(preflight({ ...good, outputs: [{ kind: 'epub', name: 'b.epub', bytes: 21 * 1048576, mtime: 2000 }] }), 'epub-size').state === 'error', 'ePub 21MB → error');
ok(by(preflight({ ...good, missingFonts: ['HanjaSerif-Light.ttf'] }), 'fontfiles').state === 'error', '동봉 글꼴 파일 없음 → error');
console.log(`\n${fail ? '❌' : '✅'} book-preflight — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
