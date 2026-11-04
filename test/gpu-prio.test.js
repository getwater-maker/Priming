'use strict';
// 🚦 GPU 우선순위(v1.0.15 · 로이 2026-11-04 「아내분 → 로이 → 자동 렌더」)
//   [1] 서버 api.py 의 GpuGate 원문을 뽑아 파이썬 스레드로 실제로 돌린다(원격 우선 · 틈 · 시간초과 이유 · 기록 콜백)
//   [2] api.py 연결(소스) — 누가 보냈나 판정 · 미룸 머리 · /gpu-status
//   [3] core/gpu-share — 로컬 주소 판정 · 원격 활동 판정 · 양보 대기(가짜 서버)
//   [4] provider — 「미룸」 답은 실패로 세지 않고 다시 보낸다 · 중단이면 멈춘다
//   [5] main 연결(소스) — 로컬 그림 장마다 양보 · 원격 PC 앱은 이 PC 의 ComfyUI 큐를 기다리지 않는다
//   ⛔ 진짜 9881 서버는 건드리지 않는다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); c ? pass++ : fail++; };
const API = 'D:\\TTS_Model\\omnivoice\\api.py';
const PY = ['D:\\TTS_Model\\omnivoice\\env\\python.exe', 'python'];

const PY_TEST = `
import threading, time, json, sys
src = open(sys.argv[1], encoding='utf-8').read()
a = src.index('# >>> gpu-gate'); b = src.index('# <<< gpu-gate')
ns = {'threading': threading, 'time': time}
exec(src[a:b], ns)
G = ns['GpuGate']
out = {}

# ① 로컬이 쥔 동안 로컬 B 가 먼저 줄 서고 원격 R 이 뒤에 와도 R 이 먼저 들어간다
order = []; ev = []
g = G(grace=0.3, on_overtake=lambda ip, n: ev.append((ip, n)))
g.take('local', 'L0')
def run(kind, ip):
    g.take(kind, ip); order.append(ip); time.sleep(0.05); g.release()
tb = threading.Thread(target=run, args=('local', 'B')); tb.start(); time.sleep(0.1)
tr = threading.Thread(target=run, args=('remote', 'R')); tr.start(); time.sleep(0.1)
g.release(); tb.join(); tr.join()
out['order'] = order; out['ev'] = ev

# ② 원격이 끝난 뒤 grace 안에는 로컬이 못 들어가고, 그 안에 온 원격이 먼저
g = G(grace=0.4)
g.take('remote', 'R1'); g.release()
t0 = time.time(); g.take('local', 'B'); out['grace_wait'] = round(time.time() - t0, 2); g.release()
g2 = G(grace=0.4); order2 = []
g2.take('remote', 'R1'); g2.release()
def loc():
    g2.take('local', 'B'); order2.append('B'); g2.release()
tl = threading.Thread(target=loc); tl.start(); time.sleep(0.15)
g2.take('remote', 'R2'); order2.append('R2'); time.sleep(0.05); g2.release(); tl.join()
out['order2'] = order2

# ③ 원격이 없으면 로컬은 기다리지 않는다
g = G(grace=2.0); t0 = time.time(); g.take('local', 'B'); out['free_wait'] = round(time.time() - t0, 3); g.release()

# ④ 시간초과 이유 — 원격 때문이면 by_remote True · 로컬끼리면 False
g = G(grace=0.1); g.take('remote', 'R')
out['to_remote'] = list(g.take('local', 'B', timeout=0.2)); g.release()
g = G(grace=0.1); g.take('local', 'A')
out['to_local'] = list(g.take('local', 'B', timeout=0.2)); g.release()

# ⑤ admin(/release) 은 순서 규칙 없이 비었을 때만 · 상태
g = G(grace=5.0); g.take('remote', 'R'); out['admin_busy'] = g.acquire(timeout=0.1)
st = g.status(); out['st_holder'] = st['holder']; g.release()
out['admin_free'] = g.acquire(timeout=0.1); g.release()
out['st_after'] = g.status()
print(json.dumps(out))
`;

(async () => {
  console.log('[1] GpuGate 원문 실행');
  if (!fs.existsSync(API)) console.log('  · 이 PC 에 음성 서버(api.py)가 없어 건너뜀');
  else {
    const f = path.join(os.tmpdir(), 'priming-gpu-gate-test.py');
    fs.writeFileSync(f, PY_TEST, 'utf8');
    let r = null;
    for (const py of PY) { r = spawnSync(py, [f, API], { encoding: 'utf8', timeout: 60000 }); if (r.status === 0) break; }
    let o = null; try { o = JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch (_) {}
    ok(!!o, '파이썬 실행' + (o ? '' : ': ' + String(r && (r.stderr || r.error) || '').slice(0, 300)));
    if (o) {
      ok(JSON.stringify(o.order) === '["R","B"]', '먼저 줄 선 로컬보다 원격이 먼저: ' + JSON.stringify(o.order));
      ok(o.ev.length === 1 && o.ev[0][0] === 'R' && o.ev[0][1] === 1, '앞지를 때 기록 콜백(누구 · 미뤄진 수): ' + JSON.stringify(o.ev));
      ok(o.grace_wait >= 0.3 && o.grace_wait < 1.0, '원격이 끝난 뒤 틈(0.4초)만큼 로컬이 기다린다: ' + o.grace_wait);
      ok(JSON.stringify(o.order2) === '["R2","B"]', '틈 안에 온 원격이 먼저: ' + JSON.stringify(o.order2));
      ok(o.free_wait < 0.05, '원격이 없으면 로컬은 바로: ' + o.free_wait);
      ok(o.to_remote[0] === false && o.to_remote[1] === true, '원격 때문에 시간초과 → by_remote: ' + JSON.stringify(o.to_remote));
      ok(o.to_local[0] === false && o.to_local[1] === false, '로컬끼리 시간초과 → 원격 아님: ' + JSON.stringify(o.to_local));
      ok(o.admin_busy === false && o.st_holder === 'remote' && o.admin_free === true, 'admin(/release) 은 비었을 때만');
      ok(o.st_after.holder === null && o.st_after.last_remote_ip === 'R' && o.st_after.wait_local === 0 && o.st_after.wait_remote === 0, '상태: ' + JSON.stringify(o.st_after));
    }
    try { fs.unlinkSync(f); } catch (_) {}
  }

  console.log('[2] api.py 연결(소스)');
  if (fs.existsSync(API)) {
    const A = fs.readFileSync(API, 'utf8');
    ok(/_GPU_LOCK = GpuGate\(on_overtake=_log_overtake\)/.test(A), '잠금 = GpuGate + 기록');
    ok(/ip == server/.test(A) && /_own_ips\(\)/.test(A), '로컬 판정 = 이 PC 주소 · 접속받은 주소와 같으면 로컬(100.x 로 자기 자신에 접속)');
    ok(/_REQ_CLIENT\.set\(_client_kind\(request\)\)/.test(A) && /_GPU_LOCK\.take\(kind, ip, timeout=left\)/.test(A), '합성 입구가 누가 보냈나로 차례를 잡는다');
    ok(/"X-GPU-Deferred": "remote"/.test(A) && /status_code=503/.test(A) && /status_code=408/.test(A), '원격 때문이면 503 + X-GPU-Deferred · 아니면 408');
    ok(/@app\.get\("\/gpu-status"\)/.test(A) && /remote_active/.test(A), '/gpu-status');
    ok(/KST · %s\(%s\) 우선 · 미뤄진 이 PC 요청 %d건/.test(A), '기록 한 줄 = 시각 · 누구 · 미뤄진 수');
  } else console.log('  · 건너뜀');

  console.log('[3] core/gpu-share');
  const GS = require('../core/gpu-share');
  ok(GS.isLocalBaseUrl('http://127.0.0.1:8188') && GS.isLocalBaseUrl('http://localhost:9881'), '루프백 = 로컬');
  ok(GS.isLocalBaseUrl('http://DESKTOP-ABC:8188', { hostname: 'desktop-abc', addrs: [] }), '이 PC 이름 = 로컬(대소문자 무시)');
  ok(GS.isLocalBaseUrl('http://100.112.7.63:8188', { hostname: 'x', addrs: ['100.112.7.63'] }), '이 PC 주소 = 로컬');
  ok(!GS.isLocalBaseUrl('http://desktop-cbqlolj:8188', { hostname: 'desktop-c4knmhu', addrs: ['100.90.175.26'] }), '다른 PC 이름 = 원격');
  ok(GS.remoteActive({ holder: 'remote' }) && GS.remoteActive({ wait_remote: 1 }) && GS.remoteActive({ last_remote_ago: 3 }), '원격 쥠·기다림·방금 끝남 = 활동');
  ok(!GS.remoteActive({ holder: 'local', wait_remote: 0, last_remote_ago: 60 }) && !GS.remoteActive(null), '그 밖 = 쉼');
  { // 양보 대기 — 원격 활동이 두 번 보이다 끝나면 돌아온다 · 옛 서버(404)는 바로
    let n = 0;
    const srv = http.createServer((req, res) => {
      if (req.url === '/gpu-status') { n++; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(n <= 2 ? { holder: 'remote', remote_name: '아내분' } : { holder: null, last_remote_ago: 30 })); }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + srv.address().port;
    const lines = [];
    const w = await GS.waitRemoteIdle({ baseUrl: base, label: '시험', log: (s) => lines.push(s), pollMs: 20 });
    ok(w.waited === true && n === 3 && lines.length === 2 && /아내분/.test(lines[0]), '원격이 끝날 때까지 기다림 · 시작·끝 두 줄: ' + JSON.stringify(lines));
    let m = 0;
    const w2 = await GS.waitRemoteIdle({ baseUrl: base, label: '시험', log: () => {}, pollMs: 20, aborted: () => ++m > 1 });
    n = 0;
    const w3 = await GS.waitRemoteIdle({ baseUrl: base, label: '시험', log: () => {}, pollMs: 20, aborted: () => true });
    ok(w2.waited === false && w3.aborted === true, '중단이면 기다리지 않는다');
    srv.close();
    const w4 = await GS.waitRemoteIdle({ baseUrl: 'http://127.0.0.1:1', label: '시험', log: () => {}, pollMs: 20 });
    ok(w4.waited === false, '서버가 꺼져 있으면 그냥 진행(fail-open)');
  }

  console.log('[4] provider — 미룸 답은 실패가 아니다');
  {
    const Provider = require('../tts/providers/omnivoice-provider');
    const Cls = Provider.OmniVoiceProvider || Provider.default || Provider;
    const wav = Buffer.alloc(44 + 24000 * 2);   // 1초짜리(소리는 없어도 길이만 본다)
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + 48000, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(48000, 40);
    for (let i = 0; i < 24000; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(i / 5)), 44 + i * 2);
    let k = 0;
    const srv = http.createServer((req, res) => {
      if (req.url !== '/tts') { res.writeHead(404); return res.end(); }
      k++;
      if (k <= 2) { res.writeHead(503, { 'Content-Type': 'application/json', 'X-GPU-Deferred': 'remote' }); return res.end('{"detail":"remote-priority"}'); }
      res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(wav);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const p = new Cls({ baseUrl: 'http://127.0.0.1:' + srv.address().port, timeout: 5000 });
    p.ready = true;
    const notes = [];
    const r = await p.synthesize('가나다', { onGpuWait: (s) => notes.push(s) });
    ok(r && r.durationSec > 0.9 && k === 3, '미룸 두 번 뒤 세 번째에 합성(실패로 세지 않음): ' + k);
    ok(notes.length === 1 && /원격|아내/.test(notes[0]), '기다린다는 말은 한 번만: ' + JSON.stringify(notes));
    k = 0;
    let err = null;
    try { await p.synthesize('가나다', { gpuWaitAborted: () => k >= 1 }); } catch (e) { err = e; }
    ok(err && k === 1, '중단이면 다시 보내지 않고 멈춘다: ' + (err && err.message));
    srv.close();
  }

  console.log('[5] main 연결(소스)');
  {
    const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const rc = M.slice(M.indexOf('async function runComfyImages'), M.indexOf('function _dur(sec)'));
    ok(/const worker = async \(\) => \{[\s\S]{0,400}_yieldGpuToRemote\(/.test(rc), '로컬 그림은 장마다 원격에 양보');
    const af = M.slice(M.indexOf('async function awaitForeignComfyIdle'), M.indexOf('function enqueueTtsJob'));
    ok(/isLocalBaseUrl\(base\)/.test(af), '원격 PC 앱은 이 PC 의 ComfyUI 큐를 기다리지 않는다(원격이 먼저)');
    ok(/setAbortCheck\(\(\) => S\.abort\)/.test(M), '중단 버튼이 미룸 대기를 멈춘다');
    const P = fs.readFileSync(path.join(__dirname, '..', 'core', 'pipeline.js'), 'utf8');
    ok(/onGpuWait: onLine/.test(P) && /gpuWaitAborted: abortSignal/.test(P), 'fillTts 가 기다림 안내·중단을 넘긴다');
  }

  console.log(`\n${pass} 통과 · ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
