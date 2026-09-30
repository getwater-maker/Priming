'use strict';
/**
 * node test/world-ctx.test.js — 롱폼/출판 「세계」 분리(core/world-ctx.js)
 *   핵심 시나리오: 롱폼 제작이 await 를 거치며 도는 중에 화면이 출판으로 바뀌고 출판 호출이 오가도, 제작은 끝까지 롱폼 세계를 본다.
 */
const { createWorlds } = require('../core/world-ctx');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fresh() {
  const S = { parsed: 'L0', scriptPath: 'l.md', outRoot: '/l', preset: 'p', mode: 'longform', abort: false };
  const W = createWorlds(S, { norm: (w) => (w === 'book' ? 'book' : 'longform') });
  S.parsed = 'L0'; S.scriptPath = 'l.md'; S.outRoot = '/l'; S.preset = 'p';   // 롱폼 칸(화면 = 롱폼)
  const handlers = {};
  const ipc = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const VIEW = new Set(['view-ch']);
  W.wrapHandle(ipc, (ch, _a, view) => (/^book-/.test(ch) ? 'book' : VIEW.has(ch) ? view : 'longform'));
  return { S, W, ipc, handlers };
}

console.log('\n[1] 접근자 — 세계마다 자기 칸');
{
  const { S, W } = fresh();
  S.parsed = 'L1'; // view = longform
  ok(S.parsed === 'L1' && S.mode === 'longform', '시작 코드(흐름 없음)는 보는 세계(롱폼)를 쓴다');
  W.run('book', () => { S.parsed = 'B1'; S.scriptPath = 'b.md'; });
  ok(W.run('longform', () => S.scriptPath) === 'l.md' && W.run('book', () => S.scriptPath) === 'b.md', '경로도 세계별');
  ok(W.run('book', () => S.parsed) === 'B1' && W.run('longform', () => S.parsed) === 'L1', '출판 세계에서 쓴 값이 롱폼 칸을 덮지 않는다');
  ok(W.run('book', () => S.mode) === 'book' && W.run('longform', () => S.mode) === 'longform', 'S.mode = 지금 흐름의 세계');
  ok(W.run('book', () => S.abort) === false && Object.keys(S).includes('parsed'), '나머지 필드(abort 등)는 전역 그대로 · 열거 가능');
}

console.log('\n[2] 🔴 롱폼 제작이 도는 중 화면이 출판으로 바뀌어도 제작은 롱폼을 본다');
(async () => {
  const { S, W, handlers } = fresh();
  handlers['make-all'] = undefined;
  const seen = [];
  const ipc2 = { handle: (ch, fn) => { handlers[ch] = fn; } };
  W.wrapHandle(ipc2, (ch, _a, view) => (/^book-/.test(ch) ? 'book' : ch === 'view-ch' ? view : 'longform'));
  ipc2.handle('make-all', async () => {            // 롱폼 제작(긴 await 여러 번)
    const parsed = S.parsed; seen.push(['start', S.mode, S.parsed, S.outRoot]);
    for (let i = 0; i < 4; i++) { await sleep(25); seen.push(['step' + i, S.mode, S.parsed, S.outRoot, S.preset]); S.preset = 'p' + i; }
    return parsed;
  });
  ipc2.handle('book-set-meta', async () => { S.parsed = 'BOOK'; S.outRoot = '/b'; await sleep(10); return [S.mode, S.parsed, S.outRoot]; });
  ipc2.handle('view-ch', async () => [S.mode, S.parsed]);
  const job = handlers['make-all'](null, {});            // 롱폼 제작 시작(화면 = 롱폼)
  await sleep(30);
  W.setView('book');                                // 사용자가 출판 탭을 누름
  const b = await handlers['book-set-meta'](null, {});    // 출판 호출
  const v = await handlers['view-ch'](null, {});          // 화면을 따르는 호출 = 출판
  const v2 = await handlers['view-ch'](null, { __world: 'longform' });  // 명시 = 롱폼(런처 루프 등)
  await job;
  ok(seen.every((s) => s[1] === 'longform' && s[2] === 'L0' && s[3] === '/l'), '제작의 모든 단계가 롱폼 세계(mode·parsed·outRoot)를 봄: ' + seen.map((s) => s[0] + ':' + s[1]).join(' '));
  ok(b[0] === 'book' && b[1] === 'BOOK' && b[2] === '/b', '출판 호출은 출판 세계');
  ok(v[0] === 'book' && v[1] === 'BOOK', '화면을 따르는 채널 = 보는 세계(출판)');
  ok(v2[0] === 'longform' && v2[1] === 'L0', '__world 명시가 이긴다(롱폼 루프가 화면과 무관하게 롱폼으로 간다)');
  ok(W.run('longform', () => S.preset) === 'p3', '제작이 쓴 값은 롱폼 칸에 남는다');
  ok(W.run('book', () => S.parsed) === 'BOOK' && W.run('longform', () => S.parsed) === 'L0', '두 세계가 서로를 덮지 않았다');

  console.log('\n[3] S.mode 대입');
  {
    const { S, W, handlers } = fresh();
    const ipc3 = { handle: (ch, fn) => { handlers[ch] = fn; } };
    W.wrapHandle(ipc3, () => 'longform');
    ipc3.handle('batch', async () => { const t = []; for (let i = 0; i < 3; i++) { S.mode = 'longform'; await sleep(5); t.push(S.mode); } return t; });
    ipc3.handle('open-book', async () => { S.mode = 'book'; await sleep(5); return [S.mode, W.getView()]; });
    const p = handlers.batch(null, {});
    W.setView('book');
    const t = await p;
    ok(t.every((x) => x === 'longform') && W.getView() === 'book', '작업의 S.mode=longform 대입은 화면(view)을 롱폼으로 되돌리지 않는다(같은 세계 대입 = 무동작)');
    const o = await handlers['open-book'](null, {});
    ok(o[0] === 'book' && o[1] === 'book', '원고 열기처럼 다른 세계로 대입하면 그 흐름과 화면이 그 세계로 옮겨간다');
    S.mode = 'longform';
    ok(W.getView() === 'longform', '흐름 밖(시작 코드) 대입은 화면 세계만 바꾼다(이후 비동기를 물들이지 않음)');
  }
  console.log('\n[4] 타이머는 만든 세계를 이어받는다');
  {
    const { S, W } = fresh();
    const got = await new Promise((res) => W.run('longform', () => { setTimeout(() => res(S.mode), 10); W.setView('book'); }));
    ok(got === 'longform', '롱폼 세계에서 만든 타이머는 화면이 바뀐 뒤에도 롱폼 세계로 돈다(자동저장 등)');
    ok(W.isViewed() === false || W.run('book', () => W.isViewed()) === true, 'isViewed: 보는 세계의 흐름만 true');
  }
  console.log(`\n${fail ? '❌' : '✅'} world-ctx — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
