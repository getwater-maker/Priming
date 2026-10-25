'use strict';
/**
 * node test/pause-word.test.js — ❄ 정지 워드 · ⋯ 빈 워드 삽입 순수 규칙 + 소리 실측 + 쉼 줄이기 면제(Lab · 설계 ②)
 *   core/word-align.insertSilence · boundaryAt · word-align-pass.insertSilenceAudio · quiet-trim(keepSil) · 소스 배선
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const WA = require('../core/word-align'), QT = require('../core/quiet-trim'), PASS = require('../core/word-align-pass');
const FF = require('../core/media-utils').getFfmpegPath();
const RATE = 24000;
const tone = (sec) => { const p = new Int16Array(Math.round(sec * RATE)); for (let i = 0; i < p.length; i++) p[i] = Math.round(9000 * Math.sin(2 * Math.PI * 220 * i / RATE) + 1000 * ((i * 7919) % 13 - 6) / 6); return p; };   // 소리(0 이 아닌 값만)
const zeros = (pcm, a, b) => { for (let i = Math.round(a * RATE); i < Math.round(b * RATE); i++) if (pcm[i] !== 0) return false; return true; };

console.log('\n[1] insertSilence — 어절 경계에 무음');
const src = tone(3);
{
  const r = WA.insertSilence(src, RATE, [0, 1, 2, 3], 1, 0.5);
  ok(r && r.pcm.length === src.length + 12000, `길이 +0.5초(${(r.pcm.length / RATE).toFixed(3)}초)`);
  ok(zeros(r.pcm, 1.02, 1.48), '경계(1.0초) 뒤 0.5초는 무음');
  ok(r.pcm[Math.round(0.5 * RATE)] === src[Math.round(0.5 * RATE)] && r.pcm[Math.round(2.0 * RATE)] === src[Math.round(1.5 * RATE)], '앞은 그대로 · 뒤는 무음만큼 밀려 같은 소리');
  ok(r.bounds.map((x) => +x.toFixed(3)).join() === '0,1.5,2.5,3.5' && r.at === 1, '경계 시각: 뒤로 +0.5초(자막·단어 정렬이 그대로 유효)');
  ok(Math.abs(r.pcm[Math.round(1 * RATE) - 1]) < Math.abs(src[Math.round(1 * RATE) - 1]) + 1 && r.pcm[Math.round(1 * RATE) - 1] !== undefined, '붙는 자리 페이드(딸깍 방지)');
}
{
  const r0 = WA.insertSilence(src, RATE, [0, 1, 2, 3], 0, 0.5);
  ok(r0 && zeros(r0.pcm, 0, 0.49) && r0.pcm[Math.round(0.6 * RATE)] === src[Math.round(0.1 * RATE)] && r0.bounds.map((x) => +x.toFixed(2)).join() === '0,1.5,2.5,3.5', 'j=0 문장 맨 앞: 앞 무음 · b[0]=0 유지');
  const rn = WA.insertSilence(src, RATE, [0, 1, 2, 3], 3, 0.5);
  ok(rn && zeros(rn.pcm, 3.01, 3.49) && rn.bounds.map((x) => +x.toFixed(2)).join() === '0,1,2,3.5', 'j=n 문장 맨 끝: 끝 무음 · 끝 경계만 +0.5');
  ok(WA.insertSilence(src, RATE, null, 1, 0.5) === null, '경계가 없으면 가운데는 거부(fail-closed)');
  const rf = WA.insertSilence(src, RATE, null, 0, 0.4), re = WA.insertSilence(src, RATE, null, Infinity, 0.4);
  ok(rf && re && rf.bounds === null && re.pcm.length === src.length + 9600 && zeros(re.pcm, 3.02, 3.38), '경계가 없어도 앞·끝은 된다(끝 = Infinity)');
  ok(WA.insertSilence(src, RATE, [0, 1, 2, 3], 4, 0.5) === null && WA.insertSilence(src, RATE, [0, 1, 2, 3], 1, 0) === null, '범위 밖 · 0초는 거부');
}
{
  ok(WA.boundaryAt('가나 다라 마바', 0) === 0 && WA.boundaryAt('가나 다라 마바', 3) === 1 && WA.boundaryAt('가나 다라 마바', 4.5) === 2 && WA.boundaryAt('가나 다라 마바', 99) === 3, '커서 → 가까운 어절 경계(0·1·2·끝)');
  ok(WA.boundaryAt('가나 다라', 'x') === null, '못 읽는 자리는 null');
}

console.log('\n[2] 실제 소리 — insertSilenceAudio → ffmpeg silencedetect');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-'));
  try {
    const wav = path.join(tmp, 'a.wav'); fs.writeFileSync(wav, QT.wavOf(src, RATE));
    const out = path.join(tmp, 'b.wav');
    const r = await PASS.insertSilenceAudio({ src: wav, bounds: [0, 1, 2, 3], j: 1, sec: 0.6, outPath: out, ffmpegPath: FF });
    ok(r.ok && Math.abs(r.dur - 3.6) < 0.01 && fs.existsSync(out), `새 WAV ${r.dur && r.dur.toFixed(3)}초(원본 3.0 + 0.6)`);
    ok(fs.statSync(wav).size === QT.wavOf(src, RATE).length, '원본 WAV 는 그대로');
    let log = ''; try { execFileSync(FF, ['-hide_banner', '-nostats', '-i', out, '-af', 'silencedetect=noise=-50dB:d=0.4', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) { log = String(e.stderr || ''); }
    if (!log) { const q = require('child_process').spawnSync(FF, ['-hide_banner', '-nostats', '-i', out, '-af', 'silencedetect=noise=-50dB:d=0.4', '-f', 'null', '-'], { encoding: 'utf8' }); log = q.stderr || ''; }
    const st = /silence_start: ([\d.]+)/.exec(log), du = /silence_duration: ([\d.]+)/.exec(log);
    ok(st && du && Math.abs(parseFloat(st[1]) - 1.0) < 0.05 && Math.abs(parseFloat(du[1]) - 0.6) < 0.05, `🔑 silencedetect: 1.0초에서 0.6초 무음(시작 ${st && st[1]} · 길이 ${du && du[1]})`);
    ok((await PASS.insertSilenceAudio({ src: wav, bounds: null, j: 1, sec: 0.5, outPath: path.join(tmp, 'c.wav'), ffmpegPath: FF })).ok === false, '경계 없는 가운데는 거부');

    console.log('\n[3] 쉼 줄이기 면제(keepSil)');
    // 소리 0.5초 + 무음 1.0초 + 소리 0.5초
    const seg = new Int16Array(RATE * 2); const t0 = tone(0.5); seg.set(t0, 0); seg.set(t0, Math.round(1.5 * RATE));
    const wq = path.join(tmp, 'q.wav'); fs.writeFileSync(wq, QT.wavOf(seg, RATE));
    const preset = { quietMaxSec: 0.3, quietEdge: false };
    const mk = (keep) => ({ num: 1, ttsAudioPath: wq, ttsDurationSec: 2, text: '가나', ...(keep ? { keepSil: true } : {}) });
    const a = mk(false), b = mk(true);
    await QT.ensureSentences([a, b], preset, tmp, { ffmpegPath: FF });
    ok(a.ttsDurationSec < 1.7, `기준: 쉼 줄이기가 1초 무음을 줄인다(${a.ttsDurationSec.toFixed(2)}초)`);
    ok(Math.abs(b.ttsDurationSec - 2) < 0.01 && b.ttsAudioPath === wq, `🔑 keepSil 문장은 줄이지 않는다(${b.ttsDurationSec.toFixed(2)}초 · 같은 파일)`);
    const c = mk(true); c.clipSpeed = 1.25;
    await QT.ensureSentences([c], preset, tmp, { ffmpegPath: FF });
    ok(Math.abs(c.ttsDurationSec - 2 / 1.25) < 0.08, `배속은 keepSil 이어도 적용된다(${c.ttsDurationSec.toFixed(2)}초 ≈ 1.6)`);
  } catch (e) { ok(false, '실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }

  console.log('\n[4] 소스 배선');
  const M = read('main.js'), PL = read('preload.js'), APP = read('renderer/src/App.jsx'), PP = read('core/pipeline.js'), QTs = read('core/quiet-trim.js');
  const ip = M.slice(M.indexOf("ipcMain.handle('clip-pause-word'"), M.indexOf("ipcMain.handle('clip-pad'"));
  ok(ip.length > 800 && /_jobsBusy\(\)/.test(ip) && ip.indexOf('undoPush(') > 0 && ip.indexOf('undoPush(') < ip.indexOf('s.ttsAudioPath = out') && /storeActive\(\); syncSnapshotNow\(\)/.test(ip), 'IPC: 작업 중 거부 · 바꾸기 전 되돌리기 저장 · 작업본 저장');
  ok(/s\.wt = \{ \.\.\.s\.wt, b: r\.bounds, k: WAl\.keyOf\(s\) \}/.test(ip) && /s\.keepSil = true/.test(ip) && /delete s\.quiet; delete s\.clipSpeed; delete s\.quietOver/.test(ip), '단어 시각은 지우지 않고 뒤로 민다 · keepSil 표시 · 구워진 배속·쉼 줄이기 기록은 비운다');
  ok(!/_editSentences|writeScriptAtomic/.test(ip), '글(.md)은 건드리지 않는다');
  ok(/단어 자리 맞추기/.test(ip) && /문장 맨 앞·맨 끝에는 지금도 넣을 수 있습니다/.test(ip), '가운데 + 정렬 없음 = 이유를 말하고 거부');
  ok(/ks: s\.keepSil \? 1 : null/.test(M) && (M.match(/s\.keepSil = true; if \(ss\.pin\)/g) || []).length === 2 && /keep\.keepSil/.test(M), '작업본 저장 · 이어받기 2곳 · 글 고침 유지');
  ok(/pi: \(s\.pauseIn/.test(PP) && /clipPauseWord: \(args\)/.test(PL), 'DTO pi · preload');
  ok(/s\.keepSil \? null : parseKey/.test(QTs), 'quiet-trim 이 keepSil 을 건너뛴다');
  ok(/data-testid="wp-panel"/.test(APP) && /tid="cx-pause-word"/.test(APP) && /tid="cx-blank-word"/.test(APP) && /data-testid="word-pause"/.test(APP) && !/label="정지 워드 삽입" soon/.test(APP) && !/label="빈 워드 삽입" soon/.test(APP), '화면: 패널 · 우클릭 두 줄 · 칩 곁 ⏸ — 준비 중 표시 없음');
  console.log(`\n${fail ? '❌' : '✅'} pause-word ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
