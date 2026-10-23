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

  console.log('\n[2] 설치 위치 후보 (Comfy Desktop = 폴백 전용)');
  {
    const c = CL.candidates();
    chk(c.length >= 2 && c.every((x) => /Comfy Desktop\.exe$/i.test(x)), '전역·사용자 설치 두 곳을 본다', c);
    chk(CL.candidates('D:/내가지정.exe')[0] === 'D:/내가지정.exe', '지정 경로가 있으면 그걸 먼저 본다');
  }

  console.log('\n[2b] 무엇을 띄울지 = installations.json 이 정본 (하드코딩 안 함)');
  {
    // 가짜 설치 2개를 만든다: 클라우드(무시돼야 함) · 로컬 2개(최근 실행한 쪽이 이겨야 함)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cdfake-'));
    const mk = (name, withVenv) => {
      const root = path.join(tmp, name);
      fs.mkdirSync(path.join(root, 'ComfyUI'), { recursive: true });
      fs.writeFileSync(path.join(root, 'ComfyUI', 'main.py'), '# fake');
      if (withVenv) {
        fs.mkdirSync(path.join(root, 'ComfyUI', '.venv', 'Scripts'), { recursive: true });
        fs.writeFileSync(path.join(root, 'ComfyUI', '.venv', 'Scripts', 'pythonw.exe'), 'x');
      }
      fs.mkdirSync(path.join(root, 'standalone-env'), { recursive: true });
      fs.writeFileSync(path.join(root, 'standalone-env', 'pythonw.exe'), 'x');
      return root;
    };
    const oldRoot = mk('old', true);
    const newRoot = mk('new', true);
    const noMain = path.join(tmp, 'broken');
    fs.mkdirSync(noMain, { recursive: true });                       // main.py 없음 → 후보 아님
    fs.writeFileSync(path.join(tmp, 'installations.json'), JSON.stringify([
      { id: 'cloudy', sourceId: 'cloud', remoteUrl: 'https://cloud.comfy.org/', lastLaunchedAt: 9e12 },
      { id: 'inst-old', installPath: oldRoot, lastLaunchedAt: 1000 },
      { id: 'inst-broken', installPath: noMain, lastLaunchedAt: 8e12 },
      { id: 'inst-new', installPath: newRoot, lastLaunchedAt: 2000 },
    ]));
    const got = CL.findInstance(tmp);
    chk(got && got.id === 'inst-new', '클라우드·main.py 없는 것을 걸러 최근 실행한 로컬을 고른다', got);

    // 🔑 실행 파이썬은 .venv — standalone-env 가 아니다(실측: 후자는 torch 가 없어 즉사).
    const py = CL.instancePython(newRoot);
    chk(/\.venv[\\/]Scripts[\\/]pythonw\.exe$/i.test(py || ''), '.venv 의 pythonw 를 고른다 → ' + py);
    const bare = mk('novenv', false);
    chk(/standalone-env/i.test(CL.instancePython(bare) || ''), '.venv 가 없으면 기반 파이썬으로 폴백(런처가 재실행해 바로잡는다)');

    const plan = CL.resolveLaunch({ appDataDir: tmp });
    chk(plan && plan.kind === 'server', '서버 런처를 띄우는 계획이 나온다', plan && plan.kind);
    chk(plan && /comfy-server\.pyw$/i.test(plan.args[plan.args.length - 1]), '인수 마지막이 런처 스크립트다', plan && plan.args);
    chk(plan && plan.args.includes('-s'), '-s (사용자 site-packages 차단) 를 붙인다');

    // 인스턴스를 못 찾으면 옛 Comfy Desktop 으로 폴백한다(옛 버전 PC 대비)
    const plan2 = CL.resolveLaunch({ appDataDir: path.join(tmp, '없음'), exePath: __filename });
    chk(plan2 && plan2.kind === 'desktop', '인스턴스가 없으면 Comfy Desktop 폴백', plan2 && plan2.kind);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('\n[2c] 런처 스크립트 원문 — 실측으로 얻은 함정 3개가 살아 있는지');
  {
    const p = path.join(__dirname, '..', 'comfy', 'comfy-server.pyw');
    chk(fs.existsSync(p), '런처가 저장소에 있다(매니페스트 포함 → 아내 PC 에도 내려간다)');
    const src = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    const iRedirect = src.indexOf('sys.stdout = _log');
    const iRun = src.indexOf('runpy.run_path');
    chk(iRedirect > 0 && iRun > iRedirect,
      '출력 리다이렉트가 main.py 실행보다 **먼저** (pythonw 는 stdout 이 무효 → tqdm 이 서버를 죽인다)');
    chk(/--disable-auto-launch/.test(src), '--disable-auto-launch (없으면 뜰 때마다 브라우저가 열린다)');
    chk(/\.venv/.test(src) && /standalone-env/.test(src), '.venv 를 쓰고 기반 환경 문제를 기록해 뒀다');
    chk(/--extra-model-paths-config/.test(src), '모델 경로 yaml 을 넘긴다(안 넘기면 모델 목록이 빈다)');
    // 🔑 --enable-manager 가 없으면 웹 UI 에 커스텀 노드 매니저가 안 보여, 노드를 깔려면 Comfy Desktop 앱을
    //   열 수밖에 없다 → Desktop 이 8188 을 가져가고 우리 서버(0.0.0.0)가 사라져 **아내 PC 원격 생성이 죽는다**
    //   (2026-08-28 실측). Desktop 도 같은 플래그로 서버를 띄운다.
    chk(/--enable-manager/.test(src), '--enable-manager (웹 UI 만으로 커스텀 노드·모델을 설치할 수 있게)');
    chk(src.includes("'--listen', '0.0.0.0'"), '--listen 0.0.0.0 (아내 PC 원격 생성 — Desktop 서버는 127.0.0.1 이라 이게 죽는다)');
    chk(/port_busy/.test(src), '이미 떠 있으면 두 번 띄우지 않는다(포트가 다른 곳으로 밀리는 것 방지)');
    // 셸을 거치지 않는다 — cmd.exe 를 끼우면 서버가 사는 내내 검은 창이 남는다(v0.2.94 실측).
    // runpy 로 **같은 프로세스에서** main.py 를 돌리므로 자식 프로세스가 아예 없다.
    chk(!/\bos\.system\(|\bsubprocess\./.test(src), '셸·자식 프로세스를 쓰지 않는다(runpy 로 같은 프로세스에서 실행)');

    // 웹 UI 진입 도구(바탕화면 바로가기가 부른다) — Desktop 앱을 열지 않고 같은 서버를 브라우저로 쓴다.
    const op = path.join(__dirname, '..', 'comfy', 'comfy-open.pyw');
    chk(fs.existsSync(op), 'comfy-open.pyw 가 저장소에 있다');
    const osrc = fs.readFileSync(op, 'utf8');
    chk(osrc.includes('--restart'), '--restart 로 8188 을 쥔 서버를 우리 런처로 되돌릴 수 있다');
    chk(osrc.includes('comfy-server.pyw'), '같은 런처를 쓴다(진입점이 갈리면 다음 사람이 엉뚱한 쪽을 고친다)');
    chk(osrc.split('print(').length === 1, 'pythonw 라 print 를 쓰지 않는다(파일 로그) — v0.2.95 와 같은 함정');
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
      // appDataDir·appDir 도 빈 곳으로 돌린다 — 안 하면 이 PC 의 진짜 설치를 찾아내 성공해 버린다.
      const r = await CL.ensureLocalComfy({
        baseUrl: 'http://127.0.0.1:34998', log: quiet, timeoutSec: 1, pollMs: 200,
        appDataDir: tmp, appDir: tmp,
      });
      chk(!r.ok && r.reason === 'not-installed', '설치를 못 찾으면 그렇게 말한다', r);
      chk(/클라우드/.test(r.message || '') && /찾아본 곳/.test(r.message || ''), '대안(☁ 클라우드)과 찾아본 경로를 알려준다');
      chk(/installations\.json/.test(r.message || ''), '어디를 봤는지(installations.json)까지 알려준다');
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

  console.log('\n[11] 부팅 자동 실행 — 시작프로그램 바로가기가 **서버 런처**를 가리키는지');
  {
    const dir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    let names = [];
    try { names = fs.readdirSync(dir).filter((f) => /\.lnk$/i.test(f) && /comfy/i.test(f)); } catch (_) {}
    chk(names.length === 1, `ComfyUI 바로가기가 정확히 1개 (실제 ${names.length}개: ${names.join(', ')})`);
    if (names.length) {
      const buf = fs.readFileSync(path.join(dir, names[0]));
      // .lnk 는 경로·인수를 UTF-16LE 로 담는다.
      const txt = buf.toString('utf16le') + '\n' + buf.toString('latin1');
      chk(/comfy-server\.pyw/i.test(txt), '런처 스크립트를 인수로 넘긴다');
      chk(/pythonw\.exe/i.test(txt), 'pythonw.exe 로 띄운다(검은 콘솔 창 없음)');
      chk(!/Comfy Desktop\.exe/i.test(txt),
        '옛 대상(Comfy Desktop.exe)이 아니다 — v1.0.39 는 대시보드만 뜨고 서버가 안 뜬다');
    }
  }

  console.log('\n[12] 🛑 로컬 Qwen 그림 뒤 ComfyUI 끄기(v0.9.111) — 가짜 서버 + 가짜 execFile');
  {
    const http = require('http');
    const mkServer = (queue) => new Promise((res) => {
      const srv = http.createServer((req, rsp) => { rsp.setHeader('Content-Type', 'application/json'); rsp.end(req.url.startsWith('/queue') ? JSON.stringify(queue) : '{}'); });
      srv.listen(0, '127.0.0.1', () => res(srv));
    });
    const L = 'C:\\x\\pythonw.exe -s "D:\\Priming\\comfy\\comfy-server.pyw"';
    chk(CL.pickKillTarget({ pid: 20, cmd: L, ppid: 10, pcmd: L }) === 10, '런처 부모가 있으면 부모(자식까지 /T)를 끈다');
    chk(CL.pickKillTarget({ pid: 20, cmd: L, ppid: 10, pcmd: 'explorer.exe' }) === 20, '부모가 런처가 아니면 그 프로세스만');
    chk(CL.pickKillTarget({ pid: 20, cmd: 'python main.py', ppid: 10, pcmd: 'cmd.exe' }) === 0, '우리 런처가 아니면 끄지 않는다(판정력)');
    // 끄는 경우 — taskkill 을 부모 PID 로 부르고, 서버가 내려간 걸 확인한다
    let srv = await mkServer({ queue_running: [], queue_pending: [] });
    let base = 'http://127.0.0.1:' + srv.address().port;
    const calls = [];
    const fakeExec = (s) => (cmd, args, _o, cb) => {
      calls.push([cmd, args]);
      if (/powershell/i.test(cmd)) return cb(null, JSON.stringify({ pid: 20, cmd: L, ppid: 10, pcmd: L }));
      if (s) s.close();
      cb(null, 'SUCCESS');
    };
    let r = await CL.stopLocalComfy({ baseUrl: base, execFileFn: fakeExec(srv), waitMs: 5000 });
    const tk = calls.find((c) => /taskkill/i.test(c[0]));
    chk(r.stopped === true && tk && tk[1].join(' ') === '/PID 10 /T /F', `부모 PID 로 taskkill /T /F (실제 ${tk ? tk[1].join(' ') : '없음'})`);
    chk(!(await CL.ping(base, 1000)), '끈 뒤 서버가 응답하지 않는다');
    // 큐에 남의 작업이 있으면 끄지 않는다
    srv = await mkServer({ queue_running: [[1]], queue_pending: [] });
    base = 'http://127.0.0.1:' + srv.address().port; calls.length = 0;
    r = await CL.stopLocalComfy({ baseUrl: base, execFileFn: fakeExec(null) });
    chk(r.skipped === 'busy' && !calls.length, '큐에 작업이 있으면 끄지 않는다(명령 0개)');
    srv.close();
    // 원격 주소·꺼진 서버는 손대지 않는다
    calls.length = 0;
    r = await CL.stopLocalComfy({ baseUrl: 'http://100.1.2.3:8188', execFileFn: fakeExec(null) });
    chk(r.skipped === 'remote' && !calls.length, '원격 주소는 손대지 않는다');
    r = await CL.stopLocalComfy({ baseUrl: base, execFileFn: fakeExec(null) });
    chk(r.skipped === 'not-running' && !calls.length, '꺼져 있으면 아무것도 안 한다');
    // main 연결(소스 검사)
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    chk(/return _withLocalQwenStop\(onlyNums, logger, \(\) => runComfyImages\(/.test(src), '로컬 Qwen 입구가 끄기 래퍼를 거친다');
    chk(/try \{ return await fn\(\); \} finally \{\n    _localQwenActive--;/.test(src), '중단·실패여도 끈다(finally)');
    chk(/awaitForeignTtsIdle\('로컬 이미지 생성', logger, \{ untilDone: forceLocal \}\)/.test(src), '로컬 Qwen 은 음성이 끝날 때까지 기다린다');
    chk(/while \(untilDone \|\| Date\.now\(\) - t0 < FOREIGN_TTS_WAIT_MS\)/.test(src) && /untilDone && S\.abort/.test(src), '끝까지 대기 · ⏹ 중단이면 멈춘다');
    chk(!/execFileSync/.test(fs.readFileSync(path.join(__dirname, '..', 'core', 'comfy-launch.js'), 'utf8')), '동기 자식 프로세스 없음(메인 프로세스가 얼지 않게)');
  }

  console.log('\n[13] ⏹ 중단 — 멈춤 신호 + 대기열 비우기 + 로컬 Qwen 이면 끄기(v0.9.112)');
  {
    const http = require('http');
    const hits = [];
    const srv = await new Promise((res) => {
      const s = http.createServer((req, rsp) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { hits.push(req.method + ' ' + req.url + (b ? ' ' + b : '')); rsp.setHeader('Content-Type', 'application/json'); rsp.end(req.url.startsWith('/queue') ? JSON.stringify({ queue_running: [[1]], queue_pending: [[2]] }) : '{}'); }); });
      s.listen(0, '127.0.0.1', () => res(s));
    });
    const base = 'http://127.0.0.1:' + srv.address().port;
    const r = await CL.interruptLocalComfy({ baseUrl: base });
    const qi = hits.indexOf('POST /queue {"clear":true}'), ii = hits.indexOf('POST /interrupt');
    chk(r.interrupted && qi >= 0 && ii > qi, `대기열 비우기 → 멈춤 신호 순서 (${hits.filter((h) => h.startsWith('POST')).join(' · ')})`);
    // force — 큐에 작업이 있어도(우리 것) 끈다 / force 없으면 안 끈다(판정력)
    const L = 'x\\comfy-server.pyw'; const calls = [];
    const ex = (cmd, args, _o, cb) => { calls.push(cmd); if (/powershell/i.test(cmd)) return cb(null, JSON.stringify({ pid: 2, cmd: L, ppid: 1, pcmd: L })); srv.close(); cb(null, 'ok'); };
    let s1 = await CL.stopLocalComfy({ baseUrl: base, execFileFn: ex });
    chk(s1.skipped === 'busy' && !calls.length, 'force 없으면 큐에 작업이 있을 때 안 끈다');
    s1 = await CL.stopLocalComfy({ baseUrl: base, execFileFn: ex, force: true, waitMs: 3000 });
    chk(s1.stopped && calls.some((c) => /taskkill/i.test(c)), 'force(⏹ 중단)면 큐가 차 있어도 끈다');
    chk((await CL.interruptLocalComfy({ baseUrl: 'http://10.0.0.5:8188' })).skipped === 'remote', '원격 주소엔 멈춤 신호를 보내지 않는다');
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    chk(/log\('⏹ 중단 요청 — 현재 단계 마치는 대로 멈춥니다'\);\n  if \(_localQwenActive\) _abortLocalQwenComfy\(\);/.test(src), '헤더 ⏹ 가 로컬 Qwen 중일 때만 ComfyUI 를 멈춘다');
    chk(/interruptLocalComfy\(\{ baseUrl \}\)[\s\S]{0,200}stopLocalComfy\(\{ baseUrl, log, force: true \}\)/.test(src), '멈춤 신호 → 서버 끄기(force)');
  }

  console.log('\n결과: ' + ok + ' OK / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
