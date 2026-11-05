'use strict';
// 🖼🎙 같은 PC 의 두 Priming 프로그램(화면 앱 + 무인 제작)이 GPU 를 겹쳐 쓰지 않게(v1.0.42 · 2026-11-05 사고)
//   사고: 무인 제작이 썸네일을 그리려 /busy 를 봤는데 문장 사이 0.2초 틈의 0 을 「음성 끝」으로 읽고 그림을 시작 →
//         화면 앱 음성과 겹쳐 VRAM 이 넘치고 합성 하나가 멈춤 → 그 뒤 음성이 모두 408 → 문장마다 3번 실패 후 건너뜀.
//   [1] 서버 api.py img-owner 원문 실행 — 프로그램 표지로 그림 주인을 가른다
//   [2] api.py 연결(소스)
//   [3] core/gpu-share.waitTtsQuiet — 한 번의 0 이 아니라 연이어 조용해야 「끝」
//   [4] provider — 표지를 싣는다 · 408 은 실패로 세지 않고 기다린다 · 오래면 serverStuck · local-image 미룸 안내
//   [5] main·pipeline·comfy-remote 연결(소스)
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
import time, json, sys
src = open(sys.argv[1], encoding='utf-8').read()
a = src.index('# >>> img-owner'); b = src.index('# <<< img-owner')
ns = {'time': time, '_COMFY_USE': {}, '_REMOTE_IMG_SEC': 90}
exec(src[a:b], ns)
K = ns['_img_key']; A = ns['_img_active_for']; R = ns['_remote_img_active']
out = {}
out['keys'] = [K('local', '127.0.0.1', 'pA'), K('local', '100.1.2.3', ''), K('remote', '100.9.9.9', 'pZ')]
now = 1000.0
u = {'local:pB': now - 10}                       # 무인 제작(B)이 10초 전에 그림 신호
out['b_blocks_a'] = A('local:pA', u, now)         # 화면 앱(A) 음성 → 막힘
out['b_not_self'] = A('local:pB', u, now)         # B 자신의 음성 → 안 막힘
out['b_any'] = A(None, u, now)                    # 「누구든」(모델 내려놓기·/busy 셈)
out['b_not_remote'] = R(u, now)                   # 원격 표시(/gpu-status)엔 안 잡힌다(로컬끼리 양보하면 둘 다 멈춘다)
out['legacy'] = A('local:pA', {'local': now - 5}, now)       # 표지 없는 옛 앱 신호는 막는 데 쓰지 않는다
out['remote'] = [A('local:pA', {'100.9.9.9': now - 5}, now), R({'100.9.9.9': now - 5}, now)]
out['stale'] = A('local:pA', {'local:pB': now - 200}, now)   # 90초 넘게 지난 신호는 끝난 것
print(json.dumps(out))
`;

function wavBuf(sec = 1) {
  const n = Math.round(24000 * sec), wav = Buffer.alloc(44 + n * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(i / 5)), 44 + i * 2);
  return wav;
}

(async () => {
  console.log('[1] api.py img-owner 원문 실행');
  if (!fs.existsSync(API)) console.log('  · 이 PC 에 음성 서버(api.py)가 없어 건너뜀');
  else {
    const f = path.join(os.tmpdir(), 'priming-img-owner-test.py');
    fs.writeFileSync(f, PY_TEST, 'utf8');
    let r = null;
    for (const py of PY) { r = spawnSync(py, [f, API], { encoding: 'utf8', timeout: 60000 }); if (r.status === 0) break; }
    let o = null; try { o = JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch (_) {}
    ok(!!o, '파이썬 실행' + (o ? '' : ': ' + String(r && (r.stderr || r.error) || '').slice(0, 300)));
    if (o) {
      ok(JSON.stringify(o.keys) === '["local:pA","local","100.9.9.9"]', '열쇠 = 로컬 프로그램 표지 · 옛 앱 local · 원격 IP: ' + JSON.stringify(o.keys));
      ok(o.b_blocks_a === true, '다른 프로그램(B)이 그리는 중이면 이 프로그램(A) 음성은 막힌다');
      ok(o.b_not_self === false, '자기 그림은 자기 음성을 막지 않는다');
      ok(o.b_any === true && o.b_not_remote === false, '「누구든」엔 잡히고 원격 표시엔 안 잡힌다');
      ok(o.legacy === false, '표지 없는 옛 앱의 그림 신호는 막는 데 쓰지 않는다(예전과 같다)');
      ok(o.remote[0] === true && o.remote[1] === true, '원격 PC 그림은 예전처럼 막고 원격 표시에도 잡힌다');
      ok(o.stale === false, '90초 넘게 끊긴 신호는 끝난 것으로 본다');
    }
    try { fs.unlinkSync(f); } catch (_) {}
  }

  console.log('[2] api.py 연결(소스)');
  if (fs.existsSync(API)) {
    const A = fs.readFileSync(API, 'utf8');
    ok(/_REQ_PROC\.set\(_proc_of\(request\)\)/.test(A) && /x-priming-proc/.test(A), '요청 머리 X-Priming-Proc 로 보낸 프로그램을 안다');
    ok(/def _comfy_key\(request\):[\s\S]{0,120}_img_key\(kind, ip, _proc_of\(request\)\)/.test(A), '그림 신호(/comfy-touch·wake)의 열쇠도 같은 표지로');
    const W = A.slice(A.indexOf('def _tts_busy'), A.indexOf('@app.get("/busy")'));
    ok(/"X-GPU-Deferred": "local-image"/.test(W), '같은 PC 다른 프로그램 그림 때문이면 503 local-image(앱이 실패로 세지 않는다)');
    ok(/def _busy_effective[\s\S]{0,400}_img_active_for\(None\)/.test(A), '/busy 는 남의 그림 때문에 기다리는 요청을 빼고 센다(서로 막힘 방지)');
    ok(/def _remote_img_guard\(\):[\s\S]{0,80}while _img_active_for\(None\)/.test(A), '남의 그림 중엔 음성 모델을 내려놓는다(VRAM 반환)');
    ok(/st\["remote_image"\] = _remote_img_active\(\)/.test(A), '/gpu-status 원격 표시는 원격 PC 만(로컬끼리 양보 교착 방지)');
  } else console.log('  · 건너뜀');

  console.log('[3] core/gpu-share.waitTtsQuiet');
  const GS = require('../core/gpu-share');
  ok(/^p\d+-[a-z0-9]+$/.test(GS.procId()) && GS.procId() === GS.procId() && GS.procHeaders()['X-Priming-Proc'] === GS.procId(), '프로그램 표지는 한 번 정해 그대로: ' + GS.procId());
  { // 가상 시계 — /busy 응답 열을 1초마다 하나씩
    const run = async (seq, opts = {}) => {
      let t = 0, i = 0; const seen = [];
      const fetchImpl = async () => { const v = seq[Math.min(i++, seq.length - 1)]; if (v === 'x') return { ok: false, json: async () => ({}) }; return { ok: true, json: async () => ({ busy: v > 0, n: v }) }; };
      const r = await GS.waitTtsQuiet({ baseUrl: 'http://fake', fetchImpl, now: () => t, sleep: async (ms) => { t += ms; }, onBusy: (n, sec, first) => seen.push(first), ...opts });
      return { ...r, polls: i, firsts: seen.filter(Boolean).length };
    };
    // 사고 재현: 바쁨 · 틈 0 · 바쁨 · … — 예전 판정이면 두 번째 응답(0)에서 「끝」
    const gaps = [1, 0, 1, 1, 0, 1, 0, 1, 1, 1];
    const r1 = await run([...gaps, ...Array(30).fill(0)]);
    ok(r1.result === 'quiet' && r1.polls >= gaps.length + 15, '문장 사이 틈의 0 은 끝이 아니다 — 15초 연속 조용해야: 응답 ' + r1.polls + '번 · ' + r1.sec + '초');
    ok(r1.firsts === 1, '「기다린다」 안내는 처음 한 번');
    const r2 = await run(Array(10).fill(0));
    ok(r2.result === 'free' && r2.sec <= 4, '처음부터 조용하면 3초만 확인하고 바로: ' + r2.sec + '초');
    const r3 = await run([1, 1, 1, 1, 1, 1], { maxMs: 4000 });
    ok(r3.result === 'timeout', '상한이 있으면 넘을 때 timeout(경고 뒤 진행)');
    const r4 = await run([1, 1, 1], { aborted: () => true });
    ok(r4.result === 'aborted', '중단이면 멈춘다');
    const r5 = await run(['x']);
    ok(r5.result === 'open', '옛 서버·인증 실패는 그냥 진행(fail-open)');
    const r6 = await GS.waitTtsQuiet({ baseUrl: 'http://127.0.0.1:1', pollMs: 5 });
    ok(r6.result === 'open', '서버가 꺼져 있으면 그냥 진행');
  }

  console.log('[4] provider — 표지 · 408 기다림 · serverStuck · local-image');
  {
    const Provider = require('../tts/providers/omnivoice-provider');
    const Cls = Provider.OmniVoiceProvider || Provider.default || Provider;
    const wav = wavBuf(1);
    let mode = '', k = 0; const procs = [];
    const srv = http.createServer((req, res) => {
      if (req.url !== '/tts') { res.writeHead(404); return res.end(); }
      k++; procs.push(req.headers['x-priming-proc'] || '');
      req.resume();
      if (mode === 'held2' && k <= 2) { res.writeHead(408, { 'Content-Type': 'application/json' }); return res.end('{"detail":"앱이 기다리는 시간이 지나 합성하지 않았습니다"}'); }
      if (mode === 'stuck') { res.writeHead(408, { 'Content-Type': 'application/json' }); return res.end('{"detail":"x"}'); }
      if (mode === 'localimg' && k <= 1) { res.writeHead(503, { 'Content-Type': 'application/json', 'X-GPU-Deferred': 'local-image' }); return res.end('{"detail":"local-image"}'); }
      res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(wav);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const p = new Cls({ baseUrl: 'http://127.0.0.1:' + srv.address().port, timeout: 5000 });
    p.ready = true; p.gpuHeldPollMs = 10;
    mode = 'held2'; k = 0; let notes = [];
    const r = await p.synthesize('가나다', { onGpuWait: (s) => notes.push(s) });
    ok(r && r.durationSec > 0.9 && k === 3, '408 두 번 뒤 세 번째에 합성 — 실패로 세지 않는다: 요청 ' + k + '번');
    ok(notes.length === 1 && /다른 합성/.test(notes[0]), '기다린다는 말은 한 번: ' + JSON.stringify(notes));
    ok(procs.every((x) => x && x === require('../core/gpu-share').procId()), '요청마다 X-Priming-Proc 를 싣는다');
    mode = 'stuck'; k = 0; p.gpuHeldWaitMs = 120; let err = null;
    try { await p.synthesize('가나다', {}); } catch (e) { err = e; }
    ok(err && err.serverStuck === true && /다시 시작/.test(err.message), '오래 묶이면 serverStuck(서버 재시작 안내): ' + (err && err.message));
    mode = 'stuck'; k = 0; p.gpuHeldWaitMs = 60000; err = null;
    try { await p.synthesize('가나다', { gpuWaitAborted: () => k >= 1 }); } catch (e) { err = e; }
    ok(err && k === 1 && !err.serverStuck, '중단이면 408 기다림도 멈춘다');
    mode = 'localimg'; k = 0; notes = [];
    const r2 = await p.synthesize('가나다', { onGpuWait: (s) => notes.push(s) });
    ok(r2 && k === 2 && notes.length === 1 && /다른 Priming/.test(notes[0]) && !/아내/.test(notes[0]), 'local-image 미룸 = 「이 PC 의 다른 Priming」 안내: ' + JSON.stringify(notes));
    srv.close();
  }

  console.log('[5] main·pipeline·comfy-remote 연결(소스)');
  {
    const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const af = M.slice(M.indexOf('async function awaitForeignTtsIdle'), M.indexOf('// 🔴 **다른 PC 가 이 PC 의 로컬 ComfyUI'));
    ok(/waitTtsQuiet\(/.test(af) && !/fetch\(base \+ "\/busy"/.test(af), '이미지 시작 전 음성 확인 = waitTtsQuiet 한 곳(한 번의 /busy 판정 없음)');
    const P = fs.readFileSync(path.join(__dirname, '..', 'core', 'pipeline.js'), 'utf8');
    ok(/e && e\.serverStuck\)[\s\S]{0,200}consecFail = MAX_CONSEC_FAIL[\s\S]{0,120}break;/.test(P), 'serverStuck 이면 문장마다 재시도하지 않고 그 대본 음성을 멈춘다');
    const C = fs.readFileSync(path.join(__dirname, '..', 'core', 'comfy-remote.js'), 'utf8');
    ok(/procHeaders\(\)/.test(C), '그림 신호(/comfy-touch)에도 프로그램 표지');
  }

  console.log(`\n${pass} 통과 · ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
