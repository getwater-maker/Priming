'use strict';
// 💤 OmniVoice 모델 내려놓기·깨우기(v0.9.59) — 앱 쪽 약속을 가짜 서버로 확인한다(진짜 9881 서버는 건드리지 않는다).
//   ① 서버가 released 면 provider.init() 이 /wake 를 부른다 · 아니면 부르지 않는다
//   ② release() 는 서버 답을 그대로 돌려주고, 옛 서버(404)·연결 실패는 조용히 넘어간다(fail-open)
//   ③ main 은 음성 단계 끝·보충 뒤에 omniRelease 를, 보충 앞에 omniWake 를 부른다(소스)
const http = require('http');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); c ? pass++ : fail++; };

function fakeServer(state) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    calls.push(req.method + ' ' + req.url);
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (state.old) return send(req.url === '/health' ? 200 : 404, req.url === '/health' ? { status: 'ok' } : { detail: 'Not Found' });
    if (req.url === '/health') return send(200, state.released ? { status: 'ok', released: true } : { status: 'ok' });
    if (req.url === '/busy') return send(200, { busy: false, n: 0, released: !!state.released });
    if (req.url === '/wake' && req.method === 'POST') { const was = !!state.released; state.released = false; return send(200, { loaded: true, reloaded: was, sec: 0 }); }
    if (req.url === '/release' && req.method === 'POST') {
      if (state.other) return send(200, { released: false, reason: 'other-client', recent: { '100.1.1.1': 5 } });
      state.released = true; return send(200, { released: true });
    }
    send(404, {});
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, calls, url: 'http://127.0.0.1:' + srv.address().port })));
}

(async () => {
  const Provider = require('../tts/providers/omnivoice-provider');
  const Cls = Provider.OmniVoiceProvider || Provider.default || Provider;
  const mk = (url) => (typeof Cls === 'function' ? new Cls({ baseUrl: url }) : null);

  console.log('[1] 내려놓은 서버 → init 이 깨운다');
  { const st = { released: true }; const f = await fakeServer(st); const p = mk(f.url);
    ok(!!p, 'provider 생성');
    const r = await p.init();
    ok(r === true && f.calls.includes('POST /wake') && st.released === false, 'init → /wake 호출, 모델 올라옴: ' + f.calls.join(', '));
    f.srv.close(); }

  console.log('[2] 올라와 있는 서버 → 깨우지 않는다');
  { const st = { released: false }; const f = await fakeServer(st); const p = mk(f.url);
    await p.init();
    ok(!f.calls.includes('POST /wake'), '/wake 안 부름: ' + f.calls.join(', '));
    f.srv.close(); }

  console.log('[3] release — 서버 답 그대로 · 다른 PC 보호는 서버 판정');
  { const st = { released: false }; const f = await fakeServer(st); const p = mk(f.url);
    const r = await p.release();
    ok(r && r.released === true && st.released === true, '내려놓음: ' + JSON.stringify(r));
    st.released = false; st.other = true;
    const r2 = await p.release();
    ok(r2 && r2.released === false && r2.reason === 'other-client' && st.released === false, '다른 PC 가 쓰는 중이면 거절 그대로: ' + JSON.stringify(r2));
    f.srv.close(); }

  console.log('[4] 옛 서버(404) · 꺼진 서버 = 조용히 넘어간다');
  { const st = { old: true }; const f = await fakeServer(st); const p = mk(f.url);
    const i = await p.init(); const r = await p.release(); const w = await p.wake();
    ok(i === true && r && r.released === false && w === null, '옛 서버: init 정상 · release 거절 · wake 없음: ' + JSON.stringify(r));
    f.srv.close();
    const dead = mk('http://127.0.0.1:1');
    const r3 = await dead.release(); const w3 = await dead.wake();
    ok(r3 && r3.released === false && w3 === null, '꺼진 서버: 예외 없이 거절: ' + JSON.stringify(r3)); }

  console.log('[5] main 연결(소스)');
  { const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const stage = M.slice(M.indexOf('const ttsStage = async'), M.indexOf('const imageStage = async'));
    ok(/omniRelease\(ttsMgr\)/.test(stage) && /!dry && !S\.abort/.test(stage), '음성 단계 끝에 omniRelease(무음·중단이면 안 함)');
    const _f0 = M.indexOf('🎤 빠진 음성 한 번 보충'); const fill = M.slice(_f0, M.indexOf('const incomplete = [];', _f0));
    ok(/omniWake\(ttsMgr\);\s*await P\.fillTtsList/.test(fill) && /fillTtsList\([^;]+\);\s*await omniRelease\(ttsMgr\)/.test(fill), '보충 앞 omniWake · 뒤 omniRelease'); }

  console.log('[6] ⏱ 합성 요청에 「앱이 기다리는 초」를 싣는다(v0.9.113 — 서버가 포기된 요청을 버린다)');
  { let hdr = null;
    const srv = http.createServer((req, res) => { if (req.url === '/tts') hdr = req.headers['x-client-timeout']; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"detail":"x"}'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const p = new Cls({ baseUrl: 'http://127.0.0.1:' + srv.address().port, timeout: 45000 });
    p.ready = true;   // init(/health) 없이 바로 합성 요청만 본다
    try { await p.synthesize('가나다', {}); } catch (_) {}
    srv.close();
    ok(hdr === '45', 'X-Client-Timeout = provider 시간초과(45초) — 실제 ' + hdr);
    const api = 'D:\\TTS_Model\\omnivoice\\api.py';
    if (fs.existsSync(api)) {
      const A = fs.readFileSync(api, 'utf8');
      ok(/x-client-timeout/.test(A) && /_GPU_LOCK\.acquire\(timeout=left\)/.test(A) && /status_code=408/.test(A), '이 PC 서버(api.py)가 기다릴 시간이 지난 요청을 408 로 버린다');
    } else console.log('  · 이 PC 에 음성 서버가 없어 api.py 검사는 건너뜀'); }

  console.log(`\n${fail ? '❌' : '✅'} omni-release — ${pass} 통과 / ${fail} 실패`);
  process.exitCode = fail ? 1 : 0;   // process.exit 는 윈도우에서 닫히는 fetch 핸들과 부딪혀 libuv 단언으로 죽는다
})().catch((e) => { console.error(e); process.exitCode = 1; });
