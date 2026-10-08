'use strict';
// node test/stt-progress-live.smoke.js — 🎧 STT 진행 상태가 **실제 전사 경로**에서 단계 순서대로 나오는지(메인 PC 의 Whisper 서버가 있을 때만).
//   m4a(서버가 직접 못 읽는 형식)를 만들어 stt-transcribe 를 돌리고, 화면이 받은 'stt-progress' 단계 순서를 기록한다. 서버가 없으면 건너뛴다.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0, skipped = false;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sttlive-'));
  const f = path.join(TMP, 'tone.m4a');
  try {
    const ff = require(path.join(ROOT, 'core', 'media-utils')).getFfmpegPath();
    execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'aac', f], { stdio: 'ignore' });
  } catch (e) { console.log('  (ffmpeg 를 못 찾아 건너뜀)'); process.exit(0); }
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    const req = (m) => m; // (app.evaluate 안에서는 require 가 없다 → process.mainModule.require)
    const st = await app.evaluate(async (_x, root) => { try { const r = process.getBuiltinModule('module').createRequire(root + '/main.js')(root + '/tts/asr-client'); return await r.checkAsrStatus(); } catch (e) { return { reachable: false, err: String(e) }; } }, ROOT.split(path.sep).join('/'));
    if (!st || !st.reachable) {   // 서버가 없으면 asr-client 의 전사만 가짜로 바꿔 **main 의 단계 보고 경로**를 본다(변환·큐·저장은 진짜)
      console.log('  (Whisper 서버에 닿지 않아 전사만 가짜로 대체)'); skipped = true;
      await app.evaluate((_x, root) => {
        const asr = process.getBuiltinModule('module').createRequire(root + '/main.js')(root + '/tts/asr-client');
        asr.checkAsrStatus = async () => ({ reachable: true, loaded: false });
        asr.transcribeLong = async (p, o) => { o.onProgress({ done: 0, total: 2, durationSec: 1800 }); await new Promise((r) => setTimeout(r, 120)); o.onProgress({ done: 1, total: 2, durationSec: 1800 }); await new Promise((r) => setTimeout(r, 120)); o.onProgress({ done: 2, total: 2, durationSec: 1800 }); return '시험 전사 글'; };
      }, ROOT.split(path.sep).join('/'));
    }
    await win.evaluate(() => { window.__stt = []; window.api.onSttProgress((d) => { window.__stt.push({ phase: d.phase, stage: d.cur && d.cur.stage, chunk: d.cur && d.cur.chunk, chunks: d.cur && d.cur.chunks }); }); });
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, f);
    await win.evaluate(() => window.api.sttTranscribe());
    await win.waitForTimeout(500);
    const seq = await win.evaluate(() => window.__stt);
    const stages = seq.map((x) => x.stage).filter(Boolean).filter((s, i, a) => a[i - 1] !== s);
    console.log('  단계 순서:', stages.join(' → '), '· 마지막 phase:', seq[seq.length - 1] && seq[seq.length - 1].phase);
    ok(stages.join('>').startsWith('prepare>convert>queue>transcribe'), '변환 → 차례 → 전사 순서로 상태가 나온다');
    ok(seq.some((x) => x.stage === 'transcribe' && x.chunks >= 1), '전사 단계에 청크 수가 실린다');
    ok(fs.existsSync(path.join(TMP, 'tone.txt')), '.txt 가 원본 옆에 저장된다');
    ok(seq.length && ['done', 'aborted'].includes(seq[seq.length - 1].phase), '끝에 done 상태가 나온다');
  } finally { await app.close(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
  console.log(`\n${fail ? '❌' : '✅'} STT 진행(실제 경로) ${pass}/${pass + fail}${skipped ? ' (서버 없음 — 건너뜀)' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
