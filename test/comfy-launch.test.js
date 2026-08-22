/**
 * 🖥 로컬 ComfyUI 자동 실행 검증 — `core/comfy-launch.js` 원문을 그대로 실행한다.
 *   "켜는 걸 깜빡해서 왜 안 되지" 를 없애는 장치라, **꺼져 있을 때의 동작**이 핵심이다.
 *   진짜 Comfy Desktop 을 띄우지 않는다 — spawnFn 을 갈아끼워 기다림·단일실행·타임아웃만 검증.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CL = require('../core/comfy-launch');

let ok = 0, fail = 0;
const chk = (c, label, extra) => {
  if (c) { ok++; console.log('  OK   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const quiet = () => {};

// /system_stats 만 흉내내는 스텁(실제 ComfyUI 는 이 경로로 살아 있는지 판정한다)
function stubServer() {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ system: { comfyui_version: '0.0.0-stub' }, devices: [{ vram_free: 1 }] }));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: 'http://127.0.0.1:' + srv.address().port })));
}

(async () => {
  console.log('\n[1] 어느 주소를 우리가 켤 수 있는가');
  for (const [u, want] of [
    ['http://127.0.0.1:8188', true], ['http://localhost:8188', true], ['http://[::1]:8188', true],
    ['https://cloud.comfy.org', false], ['http://192.168.219.145:8188', false], ['http://100.90.175.26:8188', false], ['', false],
  ]) chk(CL.isLocalUrl(u) === want, `isLocalUrl(${u || '빈값'}) = ${want}`);

  console.log('\n[2] 설치 위치 후보');
  {
    const c = CL.candidates();
    chk(c.length >= 2 && c.every((x) => /Comfy Desktop\.exe$/i.test(x)), '전역·사용자 설치 두 곳을 본다', c);
    chk(CL.candidates('D:/내가지정.exe')[0] === 'D:/내가지정.exe', '지정 경로가 있으면 그걸 먼저 본다');
  }

  console.log('\n[3] 살아 있는지 판정(ping)');
  {
    const { srv, url } = await stubServer();
    chk(await CL.ping(url) === true, '응답하면 살아 있다');
    const dead = 'http://127.0.0.1:' + (srv.address().port + 1);
    chk(await CL.ping(dead, 700) === false, '아무도 없으면 false (연결거부)');
    srv.close();
  }

  console.log('\n[4] 이미 켜져 있으면 아무것도 하지 않는다');
  {
    const { srv, url } = await stubServer();
    let spawned = 0;
    const r = await CL.ensureLocalComfy({ baseUrl: url, log: quiet, spawnFn: () => { spawned++; return {}; } });
    chk(r.ok && r.already === true && spawned === 0, '켜져 있으면 실행하지 않는다', r);
    srv.close();
  }

  console.log('\n[5] 원격·클라우드는 손대지 않는다');
  {
    let spawned = 0;
    const r = await CL.ensureLocalComfy({ baseUrl: 'https://cloud.comfy.org', log: quiet, spawnFn: () => { spawned++; return {}; } });
    chk(r.ok && r.skipped === 'remote' && spawned === 0, '남의 서버를 켜려 하지 않는다', r);
  }

  console.log('\n[6] 꺼져 있으면 켜고 **떠오를 때까지 기다린다**');
  {
    const port = 34567 + (process.pid % 200);
    const url = 'http://127.0.0.1:' + port;
    let spawned = 0, srv = null;
    const spawnFn = () => {                       // 1.2초 뒤에 뜨는 "가짜 ComfyUI"
      spawned++;
      setTimeout(() => {
        srv = http.createServer((q, s) => { s.writeHead(200); s.end('{}'); });
        srv.listen(port, '127.0.0.1');
      }, 1200);
      return { unref() {} };
    };
    const t0 = Date.now();
    const r = await CL.ensureLocalComfy({ baseUrl: url, log: quiet, spawnFn, timeoutSec: 10, pollMs: 200, exePath: __filename });
    const el = Date.now() - t0;
    chk(r.ok && r.launched === true && spawned === 1, '켜고 → 준비되면 성공', r);
    chk(el >= 1200 && el < 4000, `준비될 때까지 기다렸다(${el}ms)`);
    chk(typeof r.waitedSec === 'number', '기다린 시간을 보고한다 → ' + r.waitedSec + '초');
    if (srv) srv.close();
  }

  console.log('\n[7] 안 뜨면 시간제한으로 끊고 무엇을 볼지 알려준다');
  {
    const r = await CL.ensureLocalComfy({
      baseUrl: 'http://127.0.0.1:34999', log: quiet, spawnFn: () => ({ unref() {} }),
      timeoutSec: 1, pollMs: 200, exePath: __filename,
    });
    chk(!r.ok && r.reason === 'timeout' && /응답하지 않/.test(r.message || ''), '타임아웃 + 사람 말 안내', r);
  }

  console.log('\n[8] 실행파일이 없으면 조용히 실패하지 않는다');
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nocomfy-'));
    const pf = process.env['ProgramFiles'], la = process.env.LOCALAPPDATA;
    process.env['ProgramFiles'] = tmp; process.env.LOCALAPPDATA = tmp;
    try {
      const r = await CL.ensureLocalComfy({ baseUrl: 'http://127.0.0.1:34998', log: quiet, timeoutSec: 1, pollMs: 200 });
      chk(!r.ok && r.reason === 'not-installed', '설치를 못 찾으면 그렇게 말한다', r);
      chk(/클라우드/.test(r.message || '') && /찾아본 곳/.test(r.message || ''), '대안(☁ 클라우드)과 찾아본 경로를 알려준다');
    } finally {
      process.env['ProgramFiles'] = pf; process.env.LOCALAPPDATA = la;
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
    }
  }

  console.log('\n[9] 동시에 여러 장이 들어와도 한 번만 띄운다(single-flight)');
  {
    const port = 35100 + (process.pid % 200);
    const url = 'http://127.0.0.1:' + port;
    let spawned = 0, srv = null;
    const spawnFn = () => {
      spawned++;
      setTimeout(() => { srv = http.createServer((q, s) => { s.writeHead(200); s.end('{}'); }); srv.listen(port, '127.0.0.1'); }, 800);
      return { unref() {} };
    };
    const rs = await Promise.all([1, 2, 3, 4].map(() => CL.ensureLocalComfy({ baseUrl: url, log: quiet, spawnFn, timeoutSec: 10, pollMs: 200, exePath: __filename })));
    chk(spawned === 1, `동시 4건 요청 → 실행 1회 (실제 ${spawned}회)`);
    chk(rs.every((r) => r.ok), '네 요청 모두 성공으로 끝난다');
    if (srv) srv.close();
  }

  console.log('\n[10] 앱 배선 — main.js 원문 대조');
  {
    // ⚠ 줄끝 정규화 — main.js 가 CRLF 로 저장돼도 헛실패하지 않게(2026-08-21 사고).
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
    const img = src.slice(src.indexOf('async function runComfyImages'), src.indexOf('function parseLimitResetTime'));
    const vid = src.slice(src.indexOf('async function runComfyVideos'));
    chk(/ensureLocalComfy\(\{ baseUrl: eng\.baseUrl/.test(img), '이미지 경로가 자동 실행을 부른다');
    chk(/if \(!r\.ok\) throw new Error/.test(img), '이미지: 못 켰으면 한 번만 명확히 실패한다(40장 헛시도 방지)');
    chk(/ensureLocalComfy\(\{ baseUrl: eng\.baseUrl/.test(vid), '비디오 경로도 자동 실행을 부른다');
    chk(/이 편 영상은 건너뜁니다/.test(vid), '비디오: 던지지 않고 그 편만 건너뛴다(이미지+켄번스로 진행)');
    const freeAfter = (src.match(/로컬 VRAM 반납\(모델 언로드\)/g) || []).length;
    chk(freeAfter === 2, `생성이 끝난 뒤 VRAM 을 반납한다(이미지·비디오 2곳, 실제 ${freeAfter}곳)`);
    const idxLaunch = img.indexOf('ensureLocalComfy'), idxFree = img.indexOf('VRAM 정리');
    chk(idxLaunch > 0 && idxFree > idxLaunch, '순서: 켜기 → VRAM 정리 → 생성 (꺼져 있는 서버에 /free 를 보내지 않는다)');
  }

  console.log('\n[11] 부팅 자동 실행 — 시작프로그램 바로가기');
  {
    const lnk = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'ComfyUI (Priming 이미지용).lnk');
    const exists = fs.existsSync(lnk);
    chk(exists, '바로가기 존재 → ' + lnk);
    if (exists) chk(fs.statSync(lnk).size > 200, '바로가기 내용이 있다(' + fs.statSync(lnk).size + ' bytes)');
  }

  console.log('\n결과: ' + ok + ' OK / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
