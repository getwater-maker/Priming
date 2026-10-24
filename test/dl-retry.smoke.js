'use strict';
// node test/dl-retry.smoke.js — 📥 채널 받기 보강(v0.9.117 · 4K Video Downloader+ 분석 참고)
//   가짜 yt-dlp 로 채널 3편: 1편 정상 · 2편 「로봇 확인」 차단 · 3편 이미 받아 둠
//   ① 「로봇 확인」 = 막힘으로 보고 쉬었다 같은 영상부터(정보 확인 3번 × 4차례) → 그래도 막히면 멈춤
//   ② 이미 받은 3편은 유튜브(가짜)에 한 번도 묻지 않는다(받기만 모드 pre-check)
//   ③ 멈춘 뒤 「🔁 실패한 영상만 다시 (2)」 → 2편만 받고 3편은 건너뜀 · 1편은 다시 묻지 않음
//   ④ 같은 영상을 두 번 묻지 않는다(받기는 --load-info-json)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-retry-'));
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };

const ID = ['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3'];
const fake = path.join(TMP, 'fake-ytdlp.js');
const callLog = path.join(TMP, 'calls.txt');
const blockFile = path.join(TMP, 'block.txt');
fs.writeFileSync(fake, [
  "const fs = require('fs'), path = require('path'); const a = process.argv.slice(2);",
  "fs.appendFileSync(process.env.FAKE_LOG, a.join(' ') + '\\n');",
  "if (a.includes('--flat-playlist')) { process.stdout.write(JSON.stringify({ _type: 'playlist', channel: '시험채널', entries: " + JSON.stringify(ID.map((id, k) => ({ id, title: '제목' + (k + 1) }))) + " }) + '\\n'); process.exit(0); }",
  "const li = a.indexOf('--load-info-json');",
  "const info = li >= 0 ? JSON.parse(fs.readFileSync(a[li + 1], 'utf8')) : null;",
  "const url = a[a.length - 1]; const id = info ? info.id : (/v=([\\w-]{11})/.exec(url) || [])[1];",
  "if (fs.readFileSync(process.env.FAKE_BLOCK, 'utf8').includes(id)) { process.stderr.write('ERROR: [youtube] ' + id + ': Sign in to confirm you’re not a bot. This helps protect our community.\\n'); process.exit(1); }",
  "const title = '제목' + id.slice(-1);",
  "if (a.includes('--dump-single-json')) { process.stdout.write(JSON.stringify({ _type: 'video', id, title, duration: 5 }) + '\\n'); process.exit(0); }",
  "const o = a[a.indexOf('-o') + 1].replace('%(title)s', title).replace('%(id)s', id).replace('%(ext)s', 'mp3');",
  "fs.writeFileSync(o, 'audio'); process.stdout.write('__PRIMING_BASE__' + path.basename(o).replace(/mp3$/, 'webm') + '\\n'); process.exit(0);",
].join('\n'));
fs.writeFileSync(callLog, '');
fs.writeFileSync(blockFile, ID[1]);
const chDir = path.join(TMP, 'out', '시험채널');
fs.mkdirSync(chDir, { recursive: true });
fs.writeFileSync(path.join(chDir, `제목3 [${ID[2]}].mp3`), 'audio');


(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1', FAKE_LOG: callLog, FAKE_BLOCK: blockFile, FAKE_NODE: process.execPath } });
  const errs = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push(e.message));
    await win.waitForSelector('h1', { timeout: 20000 });
    await app.evaluate(({ shell }, f) => {
      shell.openPath = async () => '';
      global.__ytdlpTest = { cmd: process.env.FAKE_NODE, args: [f], kind: 'test', version: '' };
      global.__dlWaitScale = 0;
    }, fake);
    // 📥 창을 열고 STT 를 끈다(받기만)
    await win.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /다운로드/.test(x.textContent || '') || /다운로드/.test(x.title || '')); if (b) b.click(); });
    await win.waitForSelector('[data-testid="dl-modal"]', { timeout: 5000 });
    if (await win.getAttribute('[data-testid="dl-stt"]', 'aria-pressed') === 'true') await win.click('[data-testid="dl-stt"]');

    // ① 첫 실행 — 채널 전체
    const r1 = await win.evaluate((out) => window.api.sttFromUrl({ urls: ['https://www.youtube.com/@시험'], channel: true, mode: 'audio', stt: false, outDir: out }), path.join(TMP, 'out'));
    const calls1 = fs.readFileSync(callLog, 'utf8').trim().split('\n');
    const probe2 = calls1.filter((l) => l.includes('--dump-single-json') && l.includes(ID[1])).length;
    ok(r1 && r1.ok && fs.existsSync(path.join(chDir, `제목1 [${ID[0]}].mp3`)), '① 1편은 받았다');
    ok(probe2 === 12, `① 「로봇 확인」 = 막힘 — 정보 확인 3번(15·45초 재시도) × 4차례(처음 + 3·10·20분 쉰 뒤) = 12번 뒤 멈춤 (실제 ${probe2})`);
    ok(!calls1.some((l) => l.includes(ID[2])), '② 이미 받은 3편은 유튜브에 묻지 않는다(그리고 멈춘 뒤라 시도도 없다)');
    const dl1 = calls1.filter((l) => !l.includes('--dump-single-json') && !l.includes('--flat-playlist'));
    ok(dl1.length === 1 && dl1[0].includes('--load-info-json') && !dl1[0].includes(`v=${ID[0]}`), '④ 1편 받기는 정보 파일로(같은 영상을 두 번 묻지 않음)');
    const probes = calls1.filter((l) => l.includes('--dump-single-json') && !l.includes('--flat-playlist'));
    ok(probes.length > 0 && probes.every((l) => l.includes('--sleep-requests 1')) && dl1[0].includes('--sleep-subtitles 2'), '여러 편이면 정보 확인·받기 모두 요청 사이 쉼 인자');
    const retryBtn = win.locator('[data-testid="dl-modal"] [data-testid="urldl-retry"]');
    await retryBtn.waitFor({ timeout: 5000 });
    ok(/실패한 영상만 다시 \(2\)/.test(await retryBtn.textContent()), '③ 멈춘 뒤 「🔁 실패한 영상만 다시 (2)」(막힌 2편 + 남은 3편): ' + (await retryBtn.textContent()));

    // ③ 막힘이 풀린 뒤 다시
    fs.writeFileSync(blockFile, '');
    fs.writeFileSync(callLog, '');
    await retryBtn.click();
    await win.waitForFunction(() => !document.querySelector('[data-testid="dl-modal"] [data-testid="dl-run"]')?.disabled, null, { timeout: 15000 });
    await new Promise((res) => setTimeout(res, 500));
    const calls2 = fs.readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean);
    ok(fs.existsSync(path.join(chDir, `제목2 [${ID[1]}].mp3`)), '③ 다시 받기로 2편이 채널 폴더에 [ID] 이름으로 생겼다');
    ok(!calls2.some((l) => l.includes(ID[2])) && !calls2.some((l) => l.includes(ID[0])) && !calls2.some((l) => l.includes('--flat-playlist')), '③ 3편은 건너뛰고 1편·채널 목록은 다시 묻지 않는다: ' + calls2.length + '줄');
    ok(fs.readdirSync(path.join(TMP, 'out')).length === 1, '③ 저장 폴더 밖·바깥 다운로드 폴더에 쓰지 않았다');
    ok(errs.length === 0, '화면 오류 0건' + (errs.length ? ': ' + errs[0] : ''));
  } finally {
    await app.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 채널 받기 보강 E2E ' + n + '/' + n + ' 통과');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('❌ 실패:', e.message); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
