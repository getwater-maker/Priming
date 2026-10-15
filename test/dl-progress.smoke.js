'use strict';
// node test/dl-progress.smoke.js — 📊 다운로드 창 작업 진행 표시(v0.9.31 · 로이 「진행상황을 볼 수 있는 장치가 전혀 없다」)
//   원인(사실): 받기·STT 패널(z 60·61)이 만들기·MP4 팝업(61·62)과 같은 오른쪽 아래 자리 → 제작 중엔 밑에 가려짐 · mp3 추출은 패널 자체가 없었다.
//   ① mp3 추출 = 진행 패널(n/N · 끝) ② 제작 팝업이 떠 있으면 받기·STT·mp3 패널이 그 위로(겹치지 않음 · 더 위 순서)
//   ③ 제작 팝업이 닫히면 다시 아래로 ④ 다운로드 창을 다시 열면 「진행 중」 한 줄
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-prog-'));
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FF = require(path.join(ROOT, 'core', 'media-utils')).getFfmpegPath() || 'ffmpeg';
// 짧은 영상 2개(소리 있음)
const files = [1, 2].map((i) => { const f = path.join(TMP, `clip${i}.mp4`); execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=2', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', f], { stdio: 'ignore' }); return f; });

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errs = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push(e.message));
    await win.waitForSelector('h1', { timeout: 20000 });
    await app.evaluate(({ shell }) => { shell.openPath = async () => ''; });   // 끝나면 폴더를 여는 것 막기(시험 창이 뜨지 않게)

    // ① mp3 추출 패널
    const job = win.evaluate((fs_) => window.api.extractMp3({ files: fs_ }), files);
    await win.waitForSelector('[data-testid="mp3-progress"]', { timeout: 10000 });
    ok(true, '① mp3 추출을 시작하면 진행 패널이 뜬다');
    const r = await job;
    await win.waitForFunction(() => /끝/.test((document.querySelector('[data-testid="mp3-progress"]') || {}).textContent || ''), null, { timeout: 15000 });
    const t = await win.textContent('[data-testid="mp3-progress"]');
    ok(r.results.filter((x) => x.ok).length === 2 && /2\s*\/\s*2/.test(t) && /✓ 2/.test(t), '① 끝나면 「파일 2/2 · ✓ 2 · 끝」: ' + t.replace(/\s+/g, ' ').slice(0, 80));
    ok(files.every((f) => fs.existsSync(f.replace(/\.mp4$/, '.mp3'))), '① mp3 파일이 실제로 생겼다');

    // ② 제작 팝업(가짜)을 오른쪽 아래에 띄우고 받기·STT 패널을 보낸다
    await win.evaluate(() => { const d = document.createElement('div'); d.setAttribute('data-testid', 'make-progress'); d.style.cssText = 'position:fixed;right:16px;bottom:16px;width:380px;height:220px;z-index:61;background:#eee'; d.id = '__fakeMake'; document.body.appendChild(d); });
    const now = Date.now();
    await app.evaluate(({ BrowserWindow }, t0) => {
      const w = BrowserWindow.getAllWindows()[0].webContents;
      w.send('urldl-progress', { phase: 'running', total: 2, sub: 0, skip: 0, startedAt: t0, dl: { done: 0, idx: 1, stage: 'download', pct: 40, title: '시험 영상' }, stt: { done: 0, pending: 0, cur: null } });
      w.send('stt-progress', { phase: 'running', startedAt: t0, total: 1, done: 0, files: [{ name: 'a.mp3', state: 'transcribe', chunk: 1, chunks: 3 }], cur: { name: 'a.mp3', step: 'transcribe', chunk: 1, chunks: 3 } });
    }, now);
    await win.waitForSelector('[data-testid="urldl-progress"]', { timeout: 5000 });
    await sleep(2300);   // 1초 주기 자리 계산
    const geo = await win.evaluate(() => {
      const R = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bot: Math.round(r.bottom), z: Number(getComputedStyle(e).zIndex) }; };
      return { make: R('#__fakeMake'), url: R('[data-testid="urldl-progress"]'), stt: R('[data-testid="stt-progress"]'), mp3: R('[data-testid="mp3-progress"]') };
    });
    const over = (a, b) => a && b && a.top < b.bot && b.top < a.bot;
    ok(geo.url && geo.url.bot <= geo.make.top && geo.url.z > geo.make.z, '② 받기 패널이 제작 팝업 위로(겹치지 않음 · 순서 더 위): ' + JSON.stringify({ url: geo.url, make: geo.make }));
    ok(geo.stt && geo.mp3 && !over(geo.url, geo.stt) && !over(geo.stt, geo.mp3) && !over(geo.url, geo.mp3) && !over(geo.stt, geo.make) && !over(geo.mp3, geo.make), '② 받기·STT·mp3 패널끼리도 제작 팝업과도 겹치지 않는다');
    // ③ 제작 팝업이 닫히면 내려온다
    await win.evaluate(() => document.getElementById('__fakeMake').remove());
    await sleep(2300);
    const low = await win.evaluate(() => Math.round(window.innerHeight - document.querySelector('[data-testid="urldl-progress"]').getBoundingClientRect().bottom));
    ok(low >= 12 && low <= 20, '③ 제작 팝업이 없으면 맨 아래(16px)로: ' + low + 'px');
    // ④ 다운로드 창을 다시 열면 「진행 중」
    await win.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /다운로드/.test(x.textContent || '') || /다운로드/.test(x.title || '')); if (b) b.click(); });
    await win.waitForSelector('[data-testid="dl-modal"]', { timeout: 5000 });
    const busy = await win.evaluate(() => (document.querySelector('[data-testid="dl-busy"]') || {}).textContent || '');
    ok(/받기/.test(busy) && /전사/.test(busy) && !/mp3/.test(busy), '④ 창 맨 위 「진행 중」 한 줄(끝난 mp3 는 빠짐): ' + busy);
    ok(errs.length === 0, '화면 오류 0건' + (errs.length ? ': ' + errs[0] : ''));
  } finally {
    await app.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 다운로드 진행 표시 E2E ' + n + '/' + n + ' 통과');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('❌ 실패:', e.message); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
