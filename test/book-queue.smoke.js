'use strict';
/**
 * node test/book-queue.smoke.js — 📚 출판 「여러 원고 열기 = 권마다 따로 큐」 + 큐 전환 + 큐 전체 만들기 (실제 앱 E2E)
 *   로이 2026-10-02: 원고를 한 번에 여러 개 열면 합쳐지던 것(제1+제2권이 한 책으로 섞임)을 → 완결된 원고들은 권마다 따로 큐에, 큐 전체를 한 번에 만든다.
 *   ⚠ 로이 앱과 같은 출력 폴더에 「큐시험…」 폴더를 만들었다가 끝에 지운다. 큐 전체 만들기는 vivliostyle(node_modules)이 있어야 끝까지 돈다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bkq-'));
const NAME = (n) => `큐시험${n}_${Date.now() % 100000}`;
const nameA = NAME('A'), nameB = NAME('B');
const para = '조선의 밤은 길고 깊었다. 등불 하나에 의지해 역사를 기록하던 사람들이 있었다. '.repeat(4);
const book = (title) => `# ${title}
> 저자: 홍길동
> 출판사: 프라이밍북스
> 발행일: 2026-10-02
> 정가: 10,000원
> 판형: 46판

## [서문]
서문이다.

## [목차]

## 1장. 하나
${para}

## 2장. 둘
${para}

## [판권]
`;
const A = path.join(T, '제1권.md'), B = path.join(T, '제2권.md'), C = path.join(T, '제003회.md');
fs.writeFileSync(A, book(nameA), 'utf8');
fs.writeFileSync(B, book(nameB), 'utf8');
fs.writeFileSync(C, `# 제3회 셋째 회\n\n${para}\n`, 'utf8');   // 회차 파일(chapter 종류)

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let outParent = '';
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });

    console.log('\n[1] 완결된 원고 2개를 한 번에 열면 → 권마다 따로 큐에');
    const r = await win.evaluate((ps) => window.api.openBookPath({ scriptPaths: ps }), [A, B]);
    ok(r && r.dto && r.dto.kind === 'book', '출판 DTO 를 받았다');
    const q = r && r.queue && r.queue.book;
    ok(q && q.items.length === 2, `큐에 2권 (${q && q.items.length})`);
    ok(q && q.items[0].file === '제1권.md' && q.items[1].file === '제2권.md', '파일 이름 순서대로 제1권 → 제2권');
    ok(q && q.items[0].active && !q.items[1].active, '첫 권이 활성');
    ok(r.dto.fileTitle === nameA && r.dto.queueCount === 2, `활성 권 = 첫 권(${r.dto.fileTitle}) · queueCount 2`);
    ok(r.dto.parts.reduce((n, p) => n + p.chapters.length, 0) === 2, '합쳐지지 않았다 — 첫 권의 장 2개(합쳤다면 4개)');
    outParent = path.dirname(r.outRoot || '');

    console.log('\n[2] 큐에서 둘째 권 선택 → 출판 DTO 가 둘째 권');
    const id2 = q.items[1].id;
    const r2 = await win.evaluate((id) => window.api.selectQueueItem(id, 'book'), id2);
    ok(r2 && r2.dto && r2.dto.kind === 'book' && r2.dto.fileTitle === nameB, `둘째 권 DTO(${r2 && r2.dto && r2.dto.fileTitle})`);
    ok(r2.queue.book.items[1].active && !r2.queue.book.items[0].active, '활성 표시가 둘째 권으로');

    console.log('\n[3] 판별: 회차 파일이 섞이면(필수/회차 묶음) 예전처럼 한 권으로 합친다');
    const r3 = await win.evaluate((ps) => window.api.openBookPath({ scriptPaths: ps }), [A, C]);
    const merged = r3 && r3.queue && r3.queue.book.items.find((x) => x.active);
    ok(merged && r3.dto.parts.reduce((n, p) => n + p.chapters.length, 0) >= 3, `제1권+회차 파일 = 한 권으로 합침(장 ${r3 && r3.dto.parts.reduce((n, p) => n + p.chapters.length, 0)}개)`);

    console.log('\n[4] 큐 전체 만들기 (내지·표지 PDF → ePub → 검증) — 두 권 모두');
    // 합쳐 연 제1권(같은 파일 경로라 그 항목을 대체했다)을 되돌리려고 두 권을 다시 연다 — 같은 경로는 항목을 새로 만들지 않고 다시 읽는다
    await win.evaluate((ps) => window.api.openBookPath({ scriptPaths: ps }), [A, B]);
    const qq = (await win.evaluate(() => window.api.selectQueueItem(null, 'book'))).queue.book;
    const only2 = qq.items.filter((x) => /^제[12]권\.md$/.test(x.file));
    ok(only2.length === 2, `큐에 제1·제2권 (${qq.items.map((x) => x.file).join(',')})`);
    await win.evaluate((id) => window.api.selectQueueItem(id, 'book'), only2[1].id);   // 활성 = 둘째 → 끝나면 둘째로 돌아와야
    const br = await win.evaluate(() => window.api.bookBuildQueue({ layout: {}, noOpen: true }));
    const res = (br && br.results) || [];
    ok(res.length === 2, `결과 2권 (${res.length})`);
    for (const x of res) ok(x.pdf && x.epub, `${x.file}: 내지 ${x.pdf ? x.pages + '쪽' : '실패'} · ePub ${x.epub ? '✓' : '✗'}${x.error ? ' · ' + x.error : ''}`);
    ok(br && br.dto && br.dto.fileTitle === nameB, `끝나면 처음 활성이던 둘째 권으로 돌아온다(${br && br.dto && br.dto.fileTitle})`);
    // 권마다 자기 이름의 파일이 만들어졌는지(권이 섞이지 않았는지)
    const outA = path.join(outParent, nameA), outB = path.join(outParent, nameB);
    const ls = (d) => { try { return fs.readdirSync(d); } catch (_) { return []; } };
    ok(ls(outA).some((f) => /\.epub$/.test(f)) && ls(outB).some((f) => /\.epub$/.test(f)), `권마다 자기 폴더에 ePub: ${ls(outA).filter((f) => /\.(epub|pdf)$/.test(f)).join(' ')} | ${ls(outB).filter((f) => /\.(epub|pdf)$/.test(f)).join(' ')}`);
  } finally {
    await app.close();
    // 정리 — 우리가 만든 「큐시험…」 폴더만 지운다
    try {
      if (outParent) for (const d of fs.readdirSync(outParent)) if (d === nameA || d === nameB) fs.rmSync(path.join(outParent, d), { recursive: true, force: true });
    } catch (_) {}
    try { fs.rmSync(T, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(`\n${fail ? '❌' : '✅'} book-queue.smoke — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
