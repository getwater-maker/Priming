'use strict';
/**
 * node test/tts-progress.test.js — 📺 TTS 중 화면 갱신을 몰아서 한다(v0.5.84)
 *   실사고(2026-09-27 19:08 · 19:17): 하이디 통합본 1(3,534문장, 음성 전부 있음)을 ⚡ 만들기 → 1단계에서 「응답 없음」 두 번.
 *   원인: 건너뛸 때마다 onProgress(= main.pushDtoUpdate — 대본 전체 DTO 생성 + 화면 전송)를 **쉬지 않고** 3,534번.
 *   🔑 fillTtsList **원문을 실제로 돌린다**(가짜 TTS 서버 · 임시 폴더 · 임시 HOME).
 */
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

function wav(samples) {
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), 44 + i * 2);
  return b;
}

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsprog-'));
  const realHomedir = os.homedir;
  os.homedir = () => home;
  for (const m of ['core/tts-cache.js', 'core/media-cache.js', 'core/pipeline.js']) { try { delete require.cache[require.resolve(path.join(ROOT, m))]; } catch {} }
  const P = require(path.join(ROOT, 'core/pipeline.js'));
  const preset = { voiceCloneRefAudio: 'srv:테스트', seed: 1, language: 'ko', ttsNormalize: false };
  const GOOD = wav(24000);
  const mgr = { processText: (t) => t, prepareDict: async () => {}, synthesize: async () => { await new Promise((r) => setTimeout(r, 5)); return { mp3Buffer: GOOD, durationSec: 1.0, format: 'wav' }; } };

  console.log('\n[1] 통합본 재현 — 3,000문장 전부 음성 있음');
  {
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsprog-w-'));
    const sents = [];
    for (let i = 1; i <= 3000; i++) { const f = path.join(wd, `${i}.wav`); fs.writeFileSync(f, 'x'); sents.push({ num: i, text: `문장 ${i}.`, ttsAudioPath: f, ttsDurationSec: 1 }); }
    let calls = 0, ticks = 0;
    const iv = setInterval(() => { ticks++; }, 0);   // 루프가 이벤트 루프에 양보하면 돈다
    const t0 = Date.now();
    await P.fillTtsList(sents, preset, mgr, wd, () => {}, null, 1, '테스트', () => { calls++; });
    clearInterval(iv);
    ok(calls === 1, `🔴 화면 갱신 1번(끝에 몰아서) — 예전 3,000번 · 실제 ${calls}번`);
    ok(ticks >= 10, `건너뛰는 동안 이벤트 루프에 양보한다(타이머 ${ticks}번 돔 — 예전 0번)`);
    ok(Date.now() - t0 < 20000, `3,000개 건너뛰기 ${Date.now() - t0}ms`);
  }

  console.log('\n[2] 새로 만드는 문장 — 1초에 한 번까지 · 끝에 남은 것 한 번');
  {
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsprog-n-'));
    const sents = [];
    for (let i = 1; i <= 40; i++) sents.push({ num: i, text: `새 문장 ${i}번입니다.` });
    let calls = 0; const at = [];
    const t0 = Date.now();
    const r = await P.fillTtsList(sents, preset, mgr, wd, () => {}, null, 1, '테스트', () => { calls++; at.push(Date.now()); });
    const dur = Date.now() - t0;
    ok(r.failed.length === 0 && sents.every((s) => s.ttsAudioPath && fs.existsSync(s.ttsAudioPath)), '40문장 모두 만들어짐(동작 불변)');
    ok(calls >= 1 && calls <= Math.ceil(dur / 1000) + 2, `갱신 ${calls}번 / ${dur}ms (1초 간격 상한)`);
    ok(at.slice(1).every((t, k) => t - at[k] >= 900 || k === at.length - 2), '갱신 사이 간격 ≥ 약 1초(마지막 몰아 둔 1번 제외)');
    ok(at.length && at[at.length - 1] >= t0 + dur - 50, '마지막 문장이 끝난 뒤에도 화면이 한 번 갱신된다(마지막 상태가 빠지지 않음)');
  }

  console.log('\n[3] 섞임 — 앞 1,000개 있음 + 뒤 3개 새로');
  {
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsprog-m-'));
    const sents = [];
    for (let i = 1; i <= 1000; i++) { const f = path.join(wd, `${i}.wav`); fs.writeFileSync(f, 'x'); sents.push({ num: i, text: `있음 ${i}.`, ttsAudioPath: f }); }
    for (let i = 1001; i <= 1003; i++) sents.push({ num: i, text: `새것 ${i}.` });
    let calls = 0;
    await P.fillTtsList(sents, preset, mgr, wd, () => {}, null, 1, '테스트', () => { calls++; });
    ok(calls >= 1 && calls <= 4, `갱신 ${calls}번(예전 1,003번)`);
    ok(sents.slice(1000).every((s) => fs.existsSync(s.ttsAudioPath)), '새 문장 3개 만들어짐');
  }

  console.log('\n[4] 원문 배선');
  const src = fs.readFileSync(path.join(ROOT, 'core/pipeline.js'), 'utf8');
  const body = src.slice(src.indexOf('async function fillTtsList('), src.indexOf('function speakerVoiceMap('));
  ok(!/if \(onProgress\) \{ try \{ onProgress\(\); \} catch \{\} \}/.test(body), 'fillTtsList 안에 「매번 바로 onProgress」가 남아 있지 않다');
  ok(/const TTS_PROGRESS_GAP_MS = 1000;/.test(src), '간격 상수 1초');

  os.homedir = realHomedir;
  console.log(`\n${fail ? '❌' : '✅'} tts-progress ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
