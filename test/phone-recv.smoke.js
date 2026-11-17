'use strict';
/**
 * node test/phone-recv.smoke.js — 📱 핸드폰에서 받기(v1.0.53)
 *   [0] QR(core/qr) — zbar 로 실제 해독(파이썬 pyzbar 가 없으면 건너뜀 · 판정력: 한 칸 뒤집으면 못 읽거나 다르게 읽힌다)
 *   [1] 받기 서버(core/phone-recv) — 열쇠 없는 주소 404 · 페이지 · 상태 · 올리기 · 크기 상한 · 임시 파일 정리 · 주소 고르기
 *   [2] 실제 앱 — AI 목소리 탭 📱 → QR 창 → (시험이 핸드폰 대신) 주소로 m4a 올리기 → 그 클립 내 녹음 · 앞뒤 무음 자름 · 다음 클립으로 · ◀ ▶ · 자동 끄기 · 닫으면 서버도 닫힘
 *   ⚠ PM_UI_SMOKE 에서는 127.0.0.1 에만 연다(방화벽 창이 뜨지 않게)
 */
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { execFileSync, spawnSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const Q = require('../core/qr');
const PR = require('../core/phone-recv');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const TAG = `핸드폰받기시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 핸드폰 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-'));

function req(url, { method = 'GET', body = null } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: body ? { 'Content-Length': body.length } : {} }, (res) => {
      const bufs = []; res.on('data', (d) => bufs.push(d)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(bufs).toString('utf8') }));
    });
    r.on('error', (e) => resolve({ status: 0, error: e.code || e.message }));
    if (body) r.end(body); else r.end();
  });
}
const js = (r) => { try { return JSON.parse(r.text); } catch { return {}; } };

function writePgm(q, file) {
  const sc = 6, mg = 4, n = (q.size + mg * 2) * sc; const buf = Buffer.alloc(n * n, 255);
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.mods[y][x]) for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) buf[((y + mg) * sc + a) * n + (x + mg) * sc + b] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`P5\n${n} ${n}\n255\n`), buf]));
}

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');

  console.log('\n[0] QR 만들기');
  const texts = ['A', 'http://192.168.0.12:51234/r/0123456789abcdef0123456789abcdef', 'http://100.101.102.103:65535/r/ffffffffffffffffffffffffffffffff', '한글 주소 시험 ✓'];
  for (let L = 5; L <= 205; L += 10) texts.push(('http://10.0.0.' + L + ':' + (30000 + L) + '/r/' + 'abcdef0123456789'.repeat(14)).slice(0, L));
  const qdir = path.join(WORK, 'qr'); fs.mkdirSync(qdir);
  texts.forEach((t, i) => { writePgm(Q.qrMatrix(t), path.join(qdir, `q${i}.pgm`)); fs.writeFileSync(path.join(qdir, `q${i}.txt`), t, 'utf8'); });
  // 판정력: 데이터 칸 256개(9~24 줄·칸)를 뒤집은 QR — 오류 정정 한도를 넘으니 같은 글로 읽히면 안 된다(헛단언 방지 · 40칸은 정정돼 버렸다)
  const broken = Q.qrMatrix(texts[1]); for (let y = 9; y <= 24; y++) for (let x = 9; x <= 24; x++) broken.mods[y][x] = !broken.mods[y][x];
  writePgm(broken, path.join(qdir, 'broken.pgm'));
  const py = `
import sys,os
try:
  from pyzbar.pyzbar import decode
  import cv2
except Exception as e:
  print('SKIP', e); sys.exit(0)
d=sys.argv[1]; n=int(sys.argv[2]); bad=[]
for i in range(n):
  r=decode(cv2.imread(os.path.join(d,'q%d.pgm'%i),0)); v=r[0].data.decode('utf8') if r else ''
  if v!=open(os.path.join(d,'q%d.txt'%i),encoding='utf8').read(): bad.append(i)
r=decode(cv2.imread(os.path.join(d,'broken.pgm'),0)); b=r[0].data.decode('utf8') if r else ''
print('BAD', bad); print('BROKEN', 'same' if b==open(os.path.join(d,'q1.txt'),encoding='utf8').read() else 'diff')
`;
  const pr = spawnSync('python', ['-c', py, qdir, String(texts.length)], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const pout = (pr.stdout || '') + (pr.stderr || '');
  if (/SKIP/.test(pr.stdout || '') || pr.status == null) console.log('  · 건너뜀 — 파이썬 pyzbar·cv2 가 없습니다');
  else {
    ok(/BAD \[\]/.test(pout), `zbar 가 QR ${texts.length}개를 모두 같은 글로 읽는다 ${(pout.match(/BAD .*/) || [''])[0]}`);
    ok(/BROKEN diff/.test(pout), '판정력: 칸 256개를 뒤집은 QR 은 같은 글로 읽히지 않는다');
  }
  ok(/<svg[^>]*viewBox="0 0 41 41"/.test(Q.qrSvg(texts[1])), 'SVG(주소 한 줄 = 버전 4 · 33칸 + 둘레 8)');

  console.log('\n[1] 받기 서버');
  const got = [];
  const srv = PR.createPhoneRecv({ host: '127.0.0.1', maxBytes: 2 * 1048576, tmpDir: path.join(WORK, 'tmp'),
    getState: () => ({ ok: true, num: 7, text: '시험 문장', done: [] }),
    onFile: async (f) => { got.push({ ...f, exists: fs.existsSync(f.path), size: fs.statSync(f.path).size }); return { ok: true, msg: '넣음' }; } });
  await srv.start();
  const base = srv.url('127.0.0.1');
  ok(/^[0-9a-f]{32}$/.test(srv.token), '열쇠는 무작위 32자');
  ok((await req(`http://127.0.0.1:${srv.port}/`)).status === 404 && (await req(`http://127.0.0.1:${srv.port}/r/${'0'.repeat(32)}`)).status === 404, '열쇠 없는·틀린 주소는 404');
  const page = await req(base);
  ok(page.status === 200 && /내 목소리 보내기/.test(page.text) && /capture/.test(page.text) && !/https?:\/\/(?!x)[a-z]/i.test(page.text.replace(/http:\/\/www\.w3\.org[^"]*/g, '')), '페이지 200 · 녹음/파일 단추 · 바깥 자원 없음');
  const st0 = js(await req(base + '/state'));
  ok(st0.ok && st0.num === 7 && st0.text === '시험 문장', '상태 = 지금 받을 클립');
  const body = Buffer.alloc(5000, 7);
  const up = js(await req(base + '/up?name=' + encodeURIComponent('내 녹음.m4a'), { method: 'POST', body }));
  ok(up.ok && got.length === 1 && got[0].exists && got[0].size === 5000 && got[0].name === '내 녹음.m4a' && /\.m4a$/.test(got[0].path), '올리기 → onFile 에 같은 크기 파일 · 이름 · 확장자');
  ok(!fs.existsSync(got[0].path), '처리한 임시 파일은 지운다');
  const big = await req(base + '/up?name=a.mp3', { method: 'POST', body: Buffer.alloc(3 * 1048576, 1) });
  ok(big.status === 413 && got.length === 1, '크기 상한을 넘으면 413 · onFile 을 부르지 않는다');
  const tiny = await req(base + '/up?name=a.mp3', { method: 'POST', body: Buffer.alloc(10, 1) });
  ok(tiny.status === 400, '빈 파일은 400');
  ok(PR.extOf('x.EXE') === 'bin' && PR.extOf('a.M4A') === 'm4a', '모르는 확장자는 bin');
  const la = PR.lanAddrs({ 'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.1.1', internal: false }], Tailscale: [{ family: 'IPv4', address: '100.70.1.2', internal: false }], 'Wi-Fi': [{ family: 'IPv4', address: '192.168.0.5', internal: false }], lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], 이더넷: [{ family: 'IPv4', address: '169.254.3.3', internal: false }] });
  ok(la.length === 2 && la[0].ip === '192.168.0.5' && la[1].kind === 'tailscale', `주소 고르기: Wi-Fi 먼저 · Tailscale · 가상·자동사설 주소 뺌 ${JSON.stringify(la.map((x) => x.ip))}`);
  srv.stop();
  ok((await req(base + '/state')).status === 0, '닫으면 연결되지 않는다');

  console.log('\n[2] 실제 앱');
  const M = read('main.js');
  ok(/_phoneOnFile[\s\S]{0,400}_ownVoiceFromFile\(/.test(M) && (M.match(/_ownVoiceFromFile\(/g) || []).length === 3, '받은 파일도 덮어쓰기 한 길(_ownVoiceFromFile · 정의 + 고르기 + 핸드폰)');
  const rec = path.join(WORK, 'phone.m4a');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2:sample_rate=44100', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1.5', '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1', '-c:a', 'aac', rec]);
  const recBuf = fs.readFileSync(rec);
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow(); win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const sents = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts.flatMap((c) => c.sentences || []).map((s) => ({ ow: s.ow ? 1 : 0, dur: s.dur })); });
    const pick = async (ln) => { await win.keyboard.press('Escape'); await win.locator(`.sent[data-ln="${ln}"] .clip-r1`).first().click({ position: { x: 4, y: 4 } }); await win.waitForTimeout(250); };

    await pick(1);
    await win.click('.menus button[data-menu="voice"]'); await win.waitForSelector('.ribbon[data-menu-on="voice"]');
    const over = await win.evaluate(() => { const r = document.querySelector('.ribbon'); return r ? r.scrollWidth - r.clientWidth : -1; });
    ok(over <= 1, `1366px 에서 AI 목소리 리본이 넘치지 않는다 (넘침 ${over}px)`);
    await win.click('[data-testid="rb-v-phone"]');
    await win.waitForSelector('[data-testid="phone-qr"] svg', { timeout: 8000 });
    const url = await win.getAttribute('[data-testid="phone-panel"]', 'data-url');
    ok(/^http:\/\/127\.0\.0\.1:\d+\/r\/[0-9a-f]{32}$/.test(url || ''), '창에 QR · 주소(시험은 127.0.0.1) ' + url);
    ok((await win.locator('[data-testid="phone-text"]').innerText()).includes('첫 문장은 조금 길게'), '창에 지금 넣을 클립 글');
    ok(/첫 문장은/.test(js(await req(url + '/state')).text || ''), '핸드폰 페이지 상태도 같은 클립');

    // 핸드폰 대신 시험이 올린다
    const r1 = js(await req(url + '/up?name=' + encodeURIComponent('음성 001.m4a'), { method: 'POST', body: recBuf }));
    await win.waitForTimeout(800);
    let s = await sents();
    ok(r1.ok && s[0].ow === 1 && s[1].ow === 0 && s[2].ow === 0, `올리기 → 1번 문장만 내 녹음 ${JSON.stringify(s.map((x) => x.ow))} · ${r1.msg || r1.error}`);
    ok(s[0].dur && Math.abs(s[0].dur - 2.4) < 0.15, `앞뒤 무음 자름: 말 2초 → ${s[0].dur && s[0].dur.toFixed(2)}초`);
    ok((await win.locator('[data-testid="phone-text"]').innerText()).includes('둘째 문장입니다') && r1.state && /둘째/.test(r1.state.text || ''), '받으면 다음 클립(둘째 문장)으로 — PC 창 · 핸드폰 응답 둘 다');
    ok(await win.locator('[data-testid="phone-got"]').count() === 1, '받은 것 목록');

    // 자동 끄기 → 같은 클립에 두 번 받으면 그 클립만 바뀐다
    await win.click('[data-testid="phone-auto"]'); await win.waitForTimeout(300);
    const r2 = js(await req(url + '/up?name=b.m4a', { method: 'POST', body: recBuf }));
    await win.waitForTimeout(600);
    s = await sents();
    ok(r2.ok && s[1].ow === 1 && (await win.locator('[data-testid="phone-text"]').innerText()).includes('둘째 문장입니다'), '「받으면 다음 클립으로」를 끄면 그 클립에 머문다');
    // ▶ ◀
    await win.click('[data-testid="phone-next"]'); await win.waitForTimeout(400);
    ok((await win.locator('[data-testid="phone-text"]').innerText()).includes('셋째 문장입니다') && /셋째/.test(js(await req(url + '/state')).text || ''), '다음 클립 ▶ → 셋째(핸드폰 상태도)');
    await win.click('[data-testid="phone-prev"]'); await win.waitForTimeout(400);
    ok((await win.locator('[data-testid="phone-text"]').innerText()).includes('둘째 문장입니다'), '◀ 이전 클립 → 둘째');
    ok(!fs.existsSync(path.join(os.tmpdir(), 'priming-rec')) || fs.readdirSync(path.join(os.tmpdir(), 'priming-rec')).filter((f) => /^phone_/.test(f)).length === 0, '받은 임시 파일은 남지 않는다');

    await win.evaluate(async () => window.api.undo({})); await win.waitForTimeout(600);
    ok((await sents())[1].ow === 0, 'Ctrl+Z(되돌리기) → 마지막으로 받은 녹음 전');

    await win.click('[data-testid="phone-close"]'); await win.waitForTimeout(500);
    ok(await win.locator('[data-testid="phone-panel"]').count() === 0 && (await req(url + '/state')).status === 0, '닫기 → 창 · 서버 모두 닫힘');

    // 다른 입구
    await pick(3);
    await win.locator('.sent[data-ln="3"] .clip-r1').first().click({ button: 'right', position: { x: 4, y: 4 } }); await win.waitForSelector('[data-testid="clip-ctx"]');
    ok(await win.locator('[data-testid="cx-phone"]').count() === 1, '우클릭 ▸ 핸드폰에서 받기');
    await win.keyboard.press('Escape');
    ok(/data-testid="ctb-voice-phone"/.test(read('renderer/src/App.jsx')), '☰ 목소리 수정 ▸ 📱 핸드폰에서 받기');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally { await app.close().catch(() => {}); for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} } try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {} }
  console.log(fail ? `\n❌ phone-recv ${pass}/${pass + fail}` : `\n✅ phone-recv ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
