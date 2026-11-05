'use strict';
// 🖥 원격 ComfyUI 켜고 끄기(v1.0.39 · core/comfy-remote) — 아내 PC 가 메인 PC 음성 서버를 거쳐 ComfyUI 를 켠다
//   진짜 서버·예약 작업을 건드리지 않는다: 가짜 fetch · 가짜 ping 만.
const CR = require('../core/comfy-remote');
const CL = require('../core/comfy-launch');

let fails = 0;
const chk = (ok, name, extra) => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || extra === undefined ? '' : ' — ' + JSON.stringify(extra))); if (!ok) fails++; };
const quiet = () => {};
const BASE = 'http://voice.test:9881';

function fakeFetch(routes, calls) {
  return async (url, opt = {}) => {
    const p = url.replace(BASE, '');
    calls.push((opt.method || 'GET') + ' ' + p);
    const h = routes[p];
    if (!h) return { status: 404, json: async () => ({}) };
    const [status, body] = typeof h === 'function' ? h() : h;
    return { status, json: async () => body };
  };
}

(async () => {
  console.log('[1] 켜져 있으면 깨우지 않고 「쓰는 중」만 알린다');
  {
    const calls = [];
    const r = await CR.wake({ baseUrl: 'http://10.0.0.5:8188', base: BASE, ping: async () => true, fetchFn: fakeFetch({ '/comfy-touch': [200, { ok: true }] }, calls) });
    await new Promise((res) => setTimeout(res, 10));
    chk(r.ok && r.already, '이미 켜짐', r);
    chk(calls.includes('POST /comfy-touch') && !calls.some((c) => /comfy-wake/.test(c)), 'touch 만 · wake 없음', calls);
  }

  console.log('\n[2] 꺼져 있으면 음성 서버에 켜 달라고 하고 뜰 때까지 기다린다');
  {
    const calls = []; let n = 0;
    const r = await CR.wake({ baseUrl: 'http://10.0.0.5:8188', base: BASE, pollMs: 5, log: quiet, ping: async () => (++n >= 3), fetchFn: fakeFetch({ '/comfy-wake': [200, { ok: true, launched: true }] }, calls) });
    chk(r.ok && r.launched, '켜짐', r);
    chk(calls.filter((c) => c === 'POST /comfy-wake').length === 1, 'wake 한 번', calls);
  }

  console.log('\n[3] 실패는 까닭을 사람 말로 — 옛 서버 · 예약 작업 없음 · 서버 없음 · 시간 초과');
  {
    const off = async () => false;
    const r404 = await CR.wake({ baseUrl: 'http://10.0.0.5:8188', base: BASE, ping: off, fetchFn: fakeFetch({}, []) });
    chk(!r404.ok && r404.reason === 'old-server' && /옛 판/.test(r404.message), '404 = 옛 판 음성 서버', r404);
    const rTask = await CR.wake({ baseUrl: 'http://10.0.0.5:8188', base: BASE, ping: off, fetchFn: fakeFetch({ '/comfy-wake': [200, { ok: false, reason: 'no-task' }] }, []) });
    chk(!rTask.ok && /Priming_ComfyUI/.test(rTask.message), '예약 작업 없음 안내', rTask);
    const rNo = await CR.wake({ baseUrl: 'http://10.0.0.5:8188', base: BASE, ping: off, fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
    chk(!rNo.ok && rNo.reason === 'no-voice-server', '음성 서버도 안 닿음', rNo);
    const rT = await CR.wake({ baseUrl: 'http://10.0.0.5:8188', base: BASE, ping: off, pollMs: 5, timeoutSec: 0.03, fetchFn: fakeFetch({ '/comfy-wake': [200, { ok: true }] }, []) });
    chk(!rT.ok && rT.reason === 'timeout', '시간 초과', rT);
    const rNoBase = await CR.wake({ baseUrl: 'http://10.0.0.5:8188', base: '', ping: off });
    chk(!rNoBase.ok && rNoBase.reason === 'no-voice-server', '음성 서버 주소 없음', rNoBase);
  }

  console.log('\n[4] ensureLocalComfy — 원격 주소는 깨우기로 넘긴다 · 클라우드·remoteWake:false 는 손대지 않는다');
  {
    let got = null;
    const r = await CL.ensureLocalComfy({ baseUrl: 'http://100.1.2.3:8188', log: quiet, remoteWake: async (o) => { got = o.baseUrl; return { ok: false, message: 'x' }; } });
    chk(got === 'http://100.1.2.3:8188' && r.ok === false, '원격 → remoteWake', { got, r });
    let called = 0;
    const c = await CL.ensureLocalComfy({ baseUrl: 'https://cloud.comfy.org', log: quiet, remoteWake: async () => { called++; return { ok: true }; } });
    chk(c.skipped === 'remote' && !called, '클라우드는 깨우지 않는다', c);
    const off = await CL.ensureLocalComfy({ baseUrl: 'http://100.1.2.3:8188', log: quiet, remoteWake: false });
    chk(off.skipped === 'remote', 'remoteWake:false = 예전 그대로', off);
  }

  console.log('\n[5] 끄기 전 다른 PC 사용 묻기 · 원격 끄기 부탁');
  {
    const rec = await CR.othersRecent({ base: BASE, fetchFn: fakeFetch({ '/comfy-recent': [200, { recent: { '100.9.9.9': 30 } }] }, []) });
    chk(rec['100.9.9.9'] === 30, '다른 PC 기록을 돌려준다', rec);
    const old = await CR.othersRecent({ base: BASE, fetchFn: fakeFetch({}, []) });
    chk(Object.keys(old).length === 0, '옛 서버 = {} (예전처럼 끈다)', old);
    const s1 = await CR.stopRemote({ base: BASE, fetchFn: fakeFetch({ '/comfy-stop': [200, { stopped: true }] }, []) });
    chk(s1.stopped, '원격 끄기 성공', s1);
    const s2 = await CR.stopRemote({ base: BASE, fetchFn: fakeFetch({ '/comfy-stop': [200, { stopped: false, reason: 'other-client' }] }, []) });
    chk(!s2.stopped && s2.reason === 'other-client', '다른 PC 사용 중이면 안 끈다', s2);
  }

  console.log('\n[6] 「쓰는 중」 알림은 멈출 수 있다');
  {
    const calls = [];
    const stop = CR.startTouch({ base: BASE, everyMs: 10, fetchFn: fakeFetch({ '/comfy-touch': [200, {}] }, calls) });
    await new Promise((res) => setTimeout(res, 35));
    stop(); const n = calls.length;
    await new Promise((res) => setTimeout(res, 30));
    chk(n >= 2 && calls.length === n, '주기적으로 보내고 멈추면 끝', { n, after: calls.length });
  }

  console.log('\n[7] 예약 작업 XML — 사용자 화면 세션 · 시간 제한 없음 · 경로 그대로');
  {
    const x = CR.taskXml({ cmd: 'C:\\A B\\pythonw.exe', args: ['-s', 'D:\\P&Q\\comfy\\comfy-server.pyw'], workDir: 'D:\\P&Q\\comfy', userId: 'PC\\me' });
    chk(/<LogonType>InteractiveToken<\/LogonType>/.test(x) && /<ExecutionTimeLimit>PT0S</.test(x) && /<MultipleInstancesPolicy>IgnoreNew</.test(x), '설정', x);
    chk(x.includes('<Command>C:\\A B\\pythonw.exe</Command>') && x.includes('-s D:\\P&amp;Q\\comfy\\comfy-server.pyw') && x.includes('<UserId>PC\\me</UserId>'), '경로·이스케이프');
  }

  console.log('\n[8] main.js — 로컬 Qwen 작업이 「쓰는 중」을 알리고, 끄기 전에 다른 PC 를 묻고, 원격이면 서버에 부탁한다');
  {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
    const body = src.slice(src.indexOf('async function _stopLocalQwenComfy'), src.indexOf('async function runComfyImages'));
    chk(/othersRecent\(\)/.test(body) && /stopRemote\(/.test(body) && /startTouch\(\)/.test(body), '세 길이 모두 있다');
    chk(/ensureWakeTask\(/.test(src) && /isServerHost\(\)/.test(src), '메인 PC 에서 예약 작업 등록');
  }

  console.log(fails ? `\n❌ ${fails}개 실패` : '\n✅ comfy-remote 모두 통과');
  process.exit(fails ? 1 : 0);
})();
