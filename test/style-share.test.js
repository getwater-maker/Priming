/**
 * 🎨 이미지 스타일 공유(여러 PC) 검증 — core/style-store.js 의 **원문 함수를 그대로 실행**한다.
 *   로직을 복사해 두면 앱과 갈라져도 통과하므로 아무것도 못 지킨다(이 저장소의 규칙).
 *
 * 두 PC 를 어떻게 흉내내나: style-store 는 STORE_DIR 를 **모듈 로드 시** os.homedir() 로 잡는다.
 *   → USERPROFILE/HOME 을 바꾸고 require 캐시를 지우면 "다른 PC" 가 된다.
 *   ⚠ 그래서 이 테스트는 실제 ~/.flow-app/styles.json 을 절대 건드리지 않는다(아래 [10] 에서 단언).
 *
 * 서버는 진짜 HTTP 스텁 — api.py 의 /styles 규약(rev 낙관적 잠금 + 409)을 그대로 구현.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let ok = 0, fail = 0;
const chk = (cond, label, extra) => {
  if (cond) { ok++; console.log('  OK   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const eq = (a, b, label) => chk(JSON.stringify(a) === JSON.stringify(b), label, { got: a, want: b });

const REAL_HOME = os.homedir();
const REAL_STORE = path.join(REAL_HOME, '.flow-app', 'styles.json');
const realBefore = fs.existsSync(REAL_STORE) ? fs.readFileSync(REAL_STORE, 'utf8') : null;

// ── /styles 스텁 서버 (api.py 와 같은 규약) ────────────────────────────────
let DOC = { rev: 0, styles: [], order: [] };
const hits = { get: 0, put: 0, conflicts: 0 };
let mode = 'ok';                                  // 'ok' | '404'
const clean = (arr) => (Array.isArray(arr) ? arr : [])
  .filter((s) => s && s.id && s.name && s.prompt)
  .map((s) => ({ id: String(s.id).trim(), name: String(s.name).trim(), prompt: String(s.prompt).trim() }))
  .filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i);
const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (mode === '404') return send(404, { detail: 'Not Found' });
  if (req.method === 'GET' && req.url === '/styles') { hits.get++; return send(200, Object.assign({}, DOC, { updatedAt: '2026-08-21T00:00:00Z' })); }
  if (req.method === 'PUT' && req.url === '/styles') {
    let body = '';
    req.on('data', (c) => { body += c; });
    return req.on('end', () => {
      hits.put++;
      let j = {};
      try { j = JSON.parse(body); } catch (_) {}
      const baseRev = Number.isFinite(j.baseRev) ? j.baseRev : -1;
      if (baseRev >= 0 && baseRev !== DOC.rev) { hits.conflicts++; return send(409, Object.assign({ error: 'conflict' }, DOC)); }
      DOC = { rev: DOC.rev + 1, styles: clean(j.styles), order: (j.order || []).filter((x) => typeof x === 'string') };
      return send(200, Object.assign({}, DOC, { updatedAt: '2026-08-21T00:00:00Z' }));
    });
  }
  return send(404, { detail: 'Not Found' });
});

// ── "PC" 하나를 만든다: 홈 폴더를 갈아끼우고 style-store 를 새로 로드 ──────
let BASE = '';
const homes = {};
function pc(name) {
  if (!homes[name]) homes[name] = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-' + name + '-'));
  process.env.USERPROFILE = homes[name];
  process.env.HOME = homes[name];
  ['../core/style-store', '../tts/asr-client', '../tts/tts-config', '../tts/secret-store'].forEach((m) => {
    try { delete require.cache[require.resolve(m)]; } catch (_) {}
  });
  const cfg = require('../tts/tts-config');
  cfg.getProvider = (n) => (n === 'omnivoice' ? { baseUrl: BASE } : {});   // 스텁 서버로 보낸다
  const SS = require('../core/style-store');
  if (!SS.STORE_PATH.startsWith(homes[name])) throw new Error('격리 실패 — 실제 홈을 쓰고 있다: ' + SS.STORE_PATH);
  return SS;
}
const userStyles = (SS) => JSON.parse(fs.existsSync(SS.STORE_PATH) ? fs.readFileSync(SS.STORE_PATH, 'utf8') : '[]');
const names = (SS) => userStyles(SS).map((s) => s.name).sort();
const quiet = () => {};

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = 'http://127.0.0.1:' + server.address().port;

  // ── 1. 합치기 로직(순수 함수) ───────────────────────────────────────────
  console.log('\n[1] 합치기 규칙');
  {
    const SS = pc('logic');
    const srv = [{ id: 'a', name: '서버가', prompt: 'p' }, { id: 'x', name: '서버만', prompt: 'p' }];
    const loc = [{ id: 'a', name: '로컬가', prompt: 'p' }, { id: 'y', name: '로컬만', prompt: 'p' }];
    const m1 = SS.mergeStyles(srv, loc, 'server');
    eq(m1.merged.map((s) => s.name), ['서버가', '서버만', '로컬만'], '같은 id 는 서버가 이기고, 양쪽 고유는 모두 남는다');
    eq(m1.added.map((s) => s.name), ['로컬만'], 'added = 이 PC 에만 있던 것');
    const m2 = SS.mergeStyles(srv, loc, 'local');
    eq(m2.merged.map((s) => s.name), ['로컬가', '로컬만', '서버만'], "prefer='local' 이면 방금 편집한 이 PC 가 이긴다");
    eq(SS.mergeStyles([{ id: '', name: 'x', prompt: 'p' }, { id: 'z', name: '', prompt: 'p' }, 'junk', null], [], 'server').merged, [], '빈 id·빈 이름·쓰레기는 버린다');
    eq(SS.mergeOrder(['a', 'b'], ['b', 'c']), ['a', 'b', 'c'], '순서 합치기 = 앞 목록 유지 + 없던 것만 뒤에');
  }

  // ── 2. 첫 동기화 = 양쪽 스타일을 하나도 잃지 않는다 ──────────────────────
  console.log('\n[2] 첫 동기화(서버가 비어 있음)');
  const A = pc('A');
  chk(!!A.add({ name: '내스타일1', prompt: 'watercolor' }) && !!A.add({ name: '내스타일2', prompt: 'ink' }), '메인 PC 에 스타일 2개');
  {
    const r = await A.pullFromServer(quiet);
    chk(r.ok && r.pushed === 2, '첫 동기화 → 이 PC 스타일 2개가 공용 목록으로 올라간다', r);
    eq(DOC.styles.map((s) => s.name), ['내스타일1', '내스타일2'], '서버에 실제로 저장됨');
    chk(DOC.rev === 1, '서버 rev 1', DOC.rev);
    chk(A.loadAll().length === A.BUILT_IN_STYLES.length + 2, '기본 스타일 + 사용자 스타일 = loadAll');
    chk(!DOC.styles.some((s) => A.isBuiltIn(s.id)), '기본 스타일은 서버로 보내지 않는다(코드에 있으니까)');
  }

  // ── 3. 아내 PC 가 앱을 켜기만 해도 목록이 내려온다 ──────────────────────
  console.log('\n[3] 다른 PC 로 전파');
  const B = pc('B');
  {
    const r = await B.pullFromServer(quiet);
    eq(names(B), ['내스타일1', '내스타일2'], '아내 PC 가 메인 PC 의 스타일을 받았다');
    chk(r.ok && r.pushed === 0, '받을 것만 있으면 올리지 않는다', r);
    const w = userStyles(B).find((s) => s.name === '내스타일1');
    chk(B.getPrompt(w.id) === 'watercolor', '프롬프트까지 그대로');
  }

  // ── 4. 아내 PC 에서 추가 → 메인 PC 로 ────────────────────────────────────
  console.log('\n[4] 반대 방향');
  {
    B.add({ name: '아내스타일', prompt: 'gouache' });
    const w = await B.pushToServer(quiet);
    chk(w.ok && DOC.rev === 2 && DOC.styles.length === 3, '아내 PC 추가 → 서버 rev 2 · 3개', { rev: DOC.rev, n: DOC.styles.length });
    const A2 = pc('A');
    await A2.pullFromServer(quiet);
    eq(names(A2), ['내스타일1', '내스타일2', '아내스타일'], '메인 PC 가 아내 스타일을 받았다');
  }

  // ── 5. 삭제도 전파된다(첫 동기화 뒤에는 서버가 정본) ─────────────────────
  console.log('\n[5] 삭제 전파');
  {
    const A3 = pc('A');
    const target = userStyles(A3).find((s) => s.name === '내스타일2');
    chk(A3.remove(target.id), '메인 PC 에서 삭제');
    const w = await A3.pushToServer(quiet);
    chk(w.ok && DOC.styles.length === 2, '서버에서도 사라짐', { n: DOC.styles.length });
    const B2 = pc('B');
    await B2.pullFromServer(quiet);
    eq(names(B2), ['내스타일1', '아내스타일'], '아내 PC 에서도 사라진다(합치기만 하면 삭제가 영원히 안 된다)');
  }

  // ── 6. 동시 편집 — 한쪽이 다른 쪽을 조용히 지우지 않는다 ─────────────────
  console.log('\n[6] 동시 편집(rev 충돌)');
  {
    const B3 = pc('B');
    B3.add({ name: '아내가먼저', prompt: 'p-b' });
    await B3.pushToServer(quiet);             // 서버 rev 4 — A 는 이걸 모른다
    const before = hits.conflicts;
    const A5 = pc('A');                       // A 가 아는 rev 는 3
    A5.add({ name: '내가나중', prompt: 'p-a' });
    const w = await A5.pushToServer(quiet);
    chk(hits.conflicts === before + 1, '낡은 rev 로 보내면 서버가 409 로 막는다');
    chk(w.ok, '409 뒤 합쳐서 다시 저장 성공', w);
    const got = DOC.styles.map((s) => s.name).sort();
    chk(got.indexOf('아내가먼저') >= 0 && got.indexOf('내가나중') >= 0, '양쪽 새 스타일이 모두 살아 있다(덮어쓰기 사고 없음)', got);
    chk(names(A5).indexOf('아내가먼저') >= 0, '이 PC 로컬에도 합쳐진 목록이 저장된다', names(A5));
  }

  // ── 7. 순서도 공유 ──────────────────────────────────────────────────────
  console.log('\n[7] 순서 공유');
  {
    const A6 = pc('A');
    const ids = A6.loadAll().map((s) => s.id);
    const flipped = [ids[1], ids[0]].concat(ids.slice(2));
    chk(A6.setOrder(flipped), '메인 PC 에서 순서 저장');
    await A6.pushToServer(quiet);
    eq(DOC.order.slice(0, 2), flipped.slice(0, 2), '서버에 순서가 올라간다');
    const B4 = pc('B');
    await B4.pullFromServer(quiet);
    eq(B4.loadAll().slice(0, 2).map((s) => s.id), flipped.slice(0, 2), '아내 PC 목록 순서까지 같아진다');
  }

  // ── 8. 서버가 구버전/주소없음 = 조용히 이 PC 것만 쓴다 ───────────────────
  console.log('\n[8] 서버를 못 쓸 때');
  {
    const C = pc('C');
    C.add({ name: '오프라인스타일', prompt: 'p' });
    mode = '404';
    const r = await C.pullFromServer(quiet);
    chk(!r.ok && r.unsupported, '구버전 서버(404) → unsupported', r);
    eq(names(C), ['오프라인스타일'], '로컬 스타일은 그대로 (지워지지 않는다)');
    const w = await C.pushToServer(quiet);
    chk(!w.ok && w.unsupported, '올리기도 unsupported 로 알린다', w);
    mode = 'ok';
    const D = pc('D');
    D.add({ name: '주소없음', prompt: 'p' });
    const cfg = require('../tts/tts-config');
    cfg.getProvider = () => ({ baseUrl: '' });
    const r2 = await D.pullFromServer(quiet);
    chk(!r2.ok && /주소/.test(r2.error || ''), '서버 주소가 없으면 사람 말로 알린다', r2);
    eq(names(D), ['주소없음'], '그래도 로컬은 멀쩡');
    cfg.getProvider = (n) => (n === 'omnivoice' ? { baseUrl: BASE } : {});
  }

  // ── 9. 앱 배선 — main.js 원문 대조(테스트만 통과하고 앱은 안 부르는 것 방지) ─
  console.log('\n[9] 앱 배선(원문 대조)');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    ['add-style', 'update-style', 'remove-style', 'move-style'].forEach((h) => {
      const i = src.indexOf("ipcMain.handle('" + h + "'");
      const body = src.slice(i, i + 420);
      chk(i > 0 && body.indexOf('pushStylesToServer') > 0, h + ' 이 공용 목록에 올린다');
    });
    chk(/ipcMain\.handle\('sync-styles'/.test(src), 'sync-styles IPC 존재');
    chk(/syncStylesFromServer\(true\)/.test(src), '앱 시작 때 조용히 동기화한다');
    const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    chk(/syncStyles: \(\) => ipcRenderer\.invoke\('sync-styles'\)/.test(pre), 'preload 에 syncStyles 노출');
    const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8');
    chk(/api\.syncStyles\(\)/.test(app) && /onClick=\{openStyleEditor\}/.test(app), '🎨 편집창을 열 때 동기화한다');
  }

  // ── 10. 실제 사용자 파일 무영향 ─────────────────────────────────────────
  console.log('\n[10] 프로덕션 무영향');
  {
    const after = fs.existsSync(REAL_STORE) ? fs.readFileSync(REAL_STORE, 'utf8') : null;
    chk(after === realBefore, '실제 ~/.flow-app/styles.json 은 한 글자도 바뀌지 않았다');
  }

  server.close();
  Object.keys(homes).forEach((k) => { try { fs.rmSync(homes[k], { recursive: true, force: true }); } catch (_) {} });
  process.env.USERPROFILE = REAL_HOME;
  process.env.HOME = REAL_HOME;
  console.log('\n결과: ' + ok + ' OK / ' + fail + ' FAIL   (스텁서버 GET ' + hits.get + ' · PUT ' + hits.put + ' · 409 ' + hits.conflicts + ')');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
