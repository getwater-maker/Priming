'use strict';
/**
 * node test/light-updater.test.js — 라이트 업데이터 두 단계(전부 받아 검증 → 그 뒤에만 교체) — 가짜 서버로
 *   2026-10-06 사고 재현: 발행 직후 서버가 **이미 있던 파일은 옛 내용**, 새 파일(렌더러 asset)만 새 내용을 준다.
 *   옛 코드 = 받은 것만 교체 + 옛 asset 삭제 → index.html 이 지워진 asset 을 가리켜 백지. 새 코드 = 하나라도 못 받으면 아무것도 안 바꾼다.
 */
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), Module = require('module');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'lu-'));

// electron 가짜
const fakeApp = { isPackaged: true, getAppPath: () => T, whenReady: () => Promise.resolve() };
const origLoad = Module._load;
Module._load = function (req, ...a) { if (req === 'electron') return { app: fakeApp, dialog: { showMessageBox() {} } }; return origLoad.call(this, req, ...a); };
const LU = require('../light-updater');

const OLD = { 'package.json': JSON.stringify({ version: '0.7.5', dependencies: {} }), 'main.js': 'old main', 'renderer/dist/index.html': '<script src="assets/old.js">', 'renderer/dist/assets/old.js': 'old js' };
const NEW = { 'package.json': JSON.stringify({ version: '0.7.6', dependencies: {} }), 'main.js': 'new main', 'renderer/dist/index.html': '<script src="assets/new.js">', 'renderer/dist/assets/new.js': 'new js' };
const depsHash = sha1(Buffer.from(JSON.stringify({})));
const manifest = { version: '0.7.6', deps: depsHash, files: Object.fromEntries(Object.entries(NEW).map(([k, v]) => [k, sha1(Buffer.from(v))])) };

function reset() {
  fs.rmSync(T, { recursive: true, force: true });
  for (const [k, v] of Object.entries(OLD)) { const f = path.join(T, k); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, v); }
}
// 서버: stale = 「옛 내용으로 보이는 파일들」(이미 있던 파일 = OLD 에 있던 경로)
function serve(staleRels) {
  global.fetch = async (url) => {
    const u = String(url).replace(/\?.*$/, '');
    const rel = u.replace(/^.*\/main\//, '');
    if (rel === 'update-manifest.json') return { ok: true, status: 200, text: async () => JSON.stringify(manifest) };
    const body = staleRels.includes(rel) && OLD[rel] != null ? OLD[rel] : NEW[rel];
    if (body == null) return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } };
  };
}
const read = (rel) => { try { return fs.readFileSync(path.join(T, rel), 'utf8'); } catch { return null; } };
const leftovers = () => { const out = []; (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else if (/\.tmp-update$/.test(e.name)) out.push(p); } })(T); return out; };

(async () => {
  // A) 정상 — 전부 새것
  reset(); serve([]);
  let r = await LU.applyUpdates();
  ok(r.reason === 'applied' && r.updated === 4, 'A: 서버가 일관되면 전부 적용 — ' + JSON.stringify(r));
  ok(read('main.js') === 'new main' && read('renderer/dist/index.html') === NEW['renderer/dist/index.html'] && read('renderer/dist/assets/new.js') === 'new js', 'A: 새 파일들');
  ok(read('renderer/dist/assets/old.js') === null, 'A: 옛 asset 은 교체가 끝난 뒤에 지운다');
  ok(leftovers().length === 0, 'A: 임시 파일이 남지 않는다');

  // B) 사고 재현 — index.html·main.js 가 옛 내용으로 보인다(새 asset 만 새것)
  reset(); serve(['renderer/dist/index.html', 'main.js']);
  r = await LU.applyUpdates();
  ok(r.reason === 'failed' && r.updated === 0, 'B: 일부가 옛 내용이면 업데이트를 보류한다 — ' + JSON.stringify(r));
  ok(read('main.js') === 'old main' && read('renderer/dist/index.html') === OLD['renderer/dist/index.html'] && read('package.json') === OLD['package.json'], 'B: 옛 버전이 그대로 온전하다(아무것도 안 바뀜)');
  ok(read('renderer/dist/assets/old.js') === 'old js', 'B: 옛 asset 을 지우지 않는다 → 화면이 백지가 되지 않는다(사고의 직접 원인)');
  ok(read('renderer/dist/assets/new.js') === null && leftovers().length === 0, 'B: 새 asset 도 임시 파일도 남기지 않는다');
  // 판별력: 옛 방식(받은 것만 교체 + 옛 asset 삭제)이면 어떻게 됐는지 — index.html 이 옛 것인데 옛 asset 은 없다
  ok(/old\.js/.test(read('renderer/dist/index.html')) && read('renderer/dist/assets/old.js') != null, 'B: index.html 이 가리키는 asset 이 실제로 있다(판정력)');

  // C) 서버가 나중에 일관되면 다음 실행이 이어서 적용
  serve([]);
  r = await LU.applyUpdates();
  ok(r.reason === 'applied' && read('package.json') === NEW['package.json'], 'C: 서버가 안정되면 다음 실행에서 적용');

  // D) 교체 순서 — package.json 이 맨 끝, 그 앞이 index.html
  reset(); serve([]);
  const order = []; const ren = fs.renameSync;
  fs.renameSync = (a, b) => { if (/\.tmp-update$/.test(a)) order.push(path.relative(T, b).split(path.sep).join('/')); return ren(a, b); };
  await LU.applyUpdates(); fs.renameSync = ren;
  ok(order[order.length - 1] === 'package.json' && order[order.length - 2] === 'renderer/dist/index.html', 'D: 교체 순서 — asset·코드 → index.html → package.json(맨 끝) — ' + order.join(' → '));

  // E) 이미 최신이면 아무것도 안 한다
  r = await LU.applyUpdates();
  ok(r.reason === 'same', 'E: 이미 최신 → same');

  fs.rmSync(T, { recursive: true, force: true });
  console.log(`\n${fail ? '❌' : '✅'} light-updater — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
