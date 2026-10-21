'use strict';
/**
 * node test/quiet-trim.test.js — ✂ 쉼 줄이기(core/quiet-trim · Lab 차이표 #9)
 *   · 문장 안 긴 쉼 → 정한 길이로 · 짧은 쉼·말소리는 그대로(말 샘플을 한 개도 안 지운다)
 *   · 앞뒤 여백은 「앞뒤 여백도」일 때만 · 끝은 문장무음(apad)만큼 남긴다
 *   · 사본을 쓰고 원본은 그대로 · 설정을 끄면 원본 경로·길이로 · 같은 설정이면 다시 하지 않음
 *   · 배선: fillTtsList 끝 · main 4단계·export-vrew · 작업본(q) · 채널 편집 읽기·저장 두 곳
 */
const fs = require('fs'), path = require('path'), os = require('os');
const QT = require('../core/quiet-trim');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const R = 24000;
// 말소리 = 220Hz 사인 (진폭 12000) · 쉼 = 아주 작은 잡음(진폭 3)
function sig(spec) {
  const parts = spec.map(([kind, sec]) => {
    const n = Math.round(sec * R), a = new Int16Array(n);
    for (let i = 0; i < n; i++) a[i] = kind === 'v' ? Math.round(12000 * Math.sin(2 * Math.PI * 220 * i / R)) : Math.round((Math.random() - 0.5) * 6);
    return a;
  });
  const out = new Int16Array(parts.reduce((m, p) => m + p.length, 0)); let w = 0;
  for (const p of parts) { out.set(p, w); w += p.length; }
  return out;
}
const loudCount = (pcm) => { let n = 0; for (const v of pcm) if (Math.abs(v) > 3000) n++; return n; };

console.log('[1] 줄이기 판정');
const A = sig([['s', 0.2], ['v', 0.6], ['s', 1.2], ['v', 0.6], ['s', 0.15 + 0.5]]);   // 앞 0.2 · 안 1.2 · 뒤 0.15 + 문장무음 0.5
let c = QT.compactPcm(A, R, { maxGap: 0.4, edge: false, pad: 0.5 });
const dA = A.length / R;
ok(c && Math.abs(c.removedSec - 0.8) < 0.04, `문장 안 1.2초 쉼 → 0.4초 (줄인 ${c && c.removedSec.toFixed(3)}초)`);
ok(c && loudCount(c.pcm) >= loudCount(A) - 2 * 240, `말소리는 그대로 (큰 샘플 ${loudCount(A)} → ${c && loudCount(c.pcm)} · 이은 자리 10ms 경사만)`);
ok(c && c.cuts === 1, '앞뒤 여백은 건드리지 않음(끄면)');
c = QT.compactPcm(A, R, { maxGap: 0.4, edge: true, pad: 0.5 });
ok(c && Math.abs(c.removedSec - (0.8 + 0.15 + 0.1)) < 0.05, `앞뒤 여백도 — 앞 0.2→0.05 · 끝 0.65→0.55(문장무음 0.5 남김) (줄인 ${c && c.removedSec.toFixed(3)}초)`);
ok(QT.compactPcm(sig([['s', 0.1], ['v', 0.5], ['s', 0.3], ['v', 0.5], ['s', 0.1]]), R, { maxGap: 0.4, edge: false }) === null, '짧은 쉼만 있으면 바꾸지 않음(판정력: 위와 같은 함수가 null)');
ok(QT.compactPcm(sig([['s', 2]]), R, { maxGap: 0.4, edge: true }) === null, '전부 정적이면 판단하지 않음');
ok(QT.keyOf({ quietMaxSec: 0 }) === '' && QT.keyOf({}) === '', '0·없음 = 끔');
ok(QT.keyOf({ quietMaxSec: 0.4, quietEdge: true, silenceSec: 0.8 }) === 'v1m0.40e1p0.80', '설정 열쇠에 최대·여백·문장무음');

console.log('[2] 문장에 적용 · 끄면 원본');
const ff = require('ffmpeg-static');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-'));
const raw = path.join(T, '3.wav');
fs.writeFileSync(raw, QT.wavOf(A, R));
const rawBytes = fs.readFileSync(raw);
const s = { num: 3, ttsAudioPath: raw, ttsDurationSec: dA };
(async () => {
  const pre = { quietMaxSec: 0.4, silenceSec: 0.5 };
  let r = await QT.ensureSentences([s], pre, T, { ffmpegPath: ff });
  ok(r.changed === 1 && /^3_q[0-9a-f]{8}\.wav$/.test(path.basename(s.ttsAudioPath)) && fs.existsSync(s.ttsAudioPath), `사본 3_q<지문>.wav 를 가리킨다 (${path.basename(s.ttsAudioPath)})`);
  ok(Math.abs(s.ttsDurationSec - (dA - 0.8)) < 0.05, `길이 = 사본 실측 (${dA.toFixed(2)} → ${s.ttsDurationSec.toFixed(2)})`);
  ok(Buffer.compare(fs.readFileSync(raw), rawBytes) === 0, '원본 음성 파일은 그대로');
  ok(s.quiet && s.quiet.src === raw && Math.abs(s.quiet.srcDur - dA) < 1e-9, '원본 경로·길이를 기억');
  const m1 = fs.statSync(s.ttsAudioPath).mtimeMs;
  r = await QT.ensureSentences([s], pre, T, { ffmpegPath: ff });
  ok(r.changed === 0 && fs.statSync(s.ttsAudioPath).mtimeMs === m1, '같은 설정이면 다시 하지 않음');
  r = await QT.ensureSentences([s], { quietMaxSec: 0.4, quietEdge: true, silenceSec: 0.5 }, T, { ffmpegPath: ff });
  ok(r.changed === 1 && s.ttsDurationSec < dA - 0.9, `설정이 바뀌면 원본에서 다시 (${s.ttsDurationSec.toFixed(2)}초)`);
  r = await QT.ensureSentences([s], { quietMaxSec: 0 }, T, { ffmpegPath: ff });
  ok(r.restored === 1 && s.ttsAudioPath === raw && s.ttsDurationSec === dA && !s.quiet, '끄면 원래 음성 경로·길이로');
  // 다시 만든 음성(경로가 바뀜) → 옛 기억을 버리고 새 음성을 원본으로
  await QT.ensureSentences([s], pre, T, { ffmpegPath: ff });
  const raw2 = path.join(T, '3b.wav'); fs.writeFileSync(raw2, QT.wavOf(sig([['v', 0.5], ['s', 1.0], ['v', 0.5]]), R));
  s.ttsAudioPath = raw2; s.ttsDurationSec = 2.0;
  await QT.ensureSentences([s], pre, T, { ffmpegPath: ff });
  ok(s.quiet && s.quiet.src === raw2, '음성을 다시 만들면(경로 바뀜) 새 음성을 원본으로 본다');

  console.log('[2b] ⏩ 클립 배속');
  {
    const rawS = path.join(T, '7.wav');
    const V = sig([['s', 0.2], ['v', 1.2], ['s', 0.15]]);
    const padN = Math.round(0.5 * R);
    const withPad = new Int16Array(V.length + padN); withPad.set(V, 0);   // 끝 0.5초 = 문장무음(정확한 0)
    fs.writeFileSync(rawS, QT.wavOf(withPad, R));
    const d0 = withPad.length / R;
    const t = { num: 7, ttsAudioPath: rawS, ttsDurationSec: d0, clipSpeed: 1.25 };
    let rr = await QT.ensureSentences([t], {}, T, { ffmpegPath: ff });
    const want = (d0 - 0.5) / 1.25 + 0.5;
    ok(rr.sped === 1 && Math.abs(t.ttsDurationSec - want) < 0.03, `1.25× — 말 부분만 빨라지고 문장무음 0.5초는 그대로 (${d0.toFixed(2)} → ${t.ttsDurationSec.toFixed(2)} · 기대 ${want.toFixed(2)})`);
    const p125 = t.ttsAudioPath, dur125 = t.ttsDurationSec;
    t.clipSpeed = 1.5; await QT.ensureSentences([t], {}, T, { ffmpegPath: ff });
    ok(t.ttsAudioPath !== p125 && fs.existsSync(p125), '배속을 바꾸면 새 사본 — 옛 사본은 덮지 않는다(Ctrl+Z 가 옛 경로로 돌아가도 옛 소리)');
    ok(Math.abs(t.ttsDurationSec - ((d0 - 0.5) / 1.5 + 0.5)) < 0.03, `1.5× 는 원본에서 다시(배속이 겹쳐 걸리지 않음) (${t.ttsDurationSec.toFixed(2)})`);
    const p15 = t.ttsAudioPath;
    // Ctrl+Z 흉내 — 문장 객체를 1.25× 때 상태로 되돌리면 다시 만들지 않고 그 사본을 그대로 쓴다
    Object.assign(t, { ttsAudioPath: p125, ttsDurationSec: dur125, clipSpeed: 1.25, quiet: { ...t.quiet, key: QT.sentKey({}, { clipSpeed: 1.25 }), out: p125 } });
    const m = fs.statSync(p125).mtimeMs; rr = await QT.ensureSentences([t], {}, T, { ffmpegPath: ff });
    ok(rr.changed === 0 && fs.statSync(p125).mtimeMs === m && fs.existsSync(p15), '되돌린 상태 그대로 — 다시 만들지 않음');
    t.clipSpeed = 1; await QT.ensureSentences([t], {}, T, { ffmpegPath: ff });
    ok(t.ttsAudioPath === rawS && t.ttsDurationSec === d0, '1× = 원래 음성으로');
    t.clipSpeed = 1.2; await QT.ensureSentences([t], { quietMaxSec: 0.4, quietEdge: true }, T, { ffmpegPath: ff });
    ok(t.quiet && /\|s1\.20$/.test(t.quiet.key) && t.ttsDurationSec < d0 / 1.1, `쉼 줄이기와 함께 — 한 사본에 둘 다 (${t.quiet && t.quiet.key})`);
    ok(QT.normSpeed(3) === 1 && QT.normSpeed('1.234') === 1.23 && QT.normSpeed(0.4) === 1, '배속 범위 0.5~2 밖은 1');
  }

  console.log('[3] 배선');
  const Rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const PL = Rd('core/pipeline.js'), M = Rd('main.js'), APP = Rd('renderer/src/App.jsx');
  const fl = PL.slice(PL.indexOf('async function fillTtsList'), PL.indexOf('async function quietPass'));
  ok(/await quietPass\(sentences, preset, workDir, onLine, abortSignal\)/.test(fl), 'fillTtsList 끝에서 쉼 줄이기(모든 TTS 입구)');
  ok(fl.indexOf('TtsCache.put') < fl.indexOf('await quietPass('), '캐시에는 원본이 들어간다(쉼 줄이기는 캐시 뒤)');
  const st4 = M.slice(M.indexOf('// ✂ 쉼 줄이기 — TTS 뒤에 채널 설정을 바꿨어도'));
  ok(st4.indexOf('P.quietPass') < st4.indexOf('BF.fingerprint'), '4단계: 지문 계산보다 먼저');
  ok((M.match(/await P\.quietPass\(/g) || []).length === 3, 'main: 4단계 · export-vrew · ⏩ clip-speed 세 곳');
  ok(/q: s\.quiet \|\| null/.test(M) && (M.match(/s\.quiet = ss\.q/g) || []).length === 2, '작업본에 저장 · 이어받기 두 곳');
  ok(/cs: \(s\.clipSpeed && s\.clipSpeed !== 1\)/.test(M) && (M.match(/s\.clipSpeed = ss\.cs/g) || []).length === 2, '⏩ 작업본에 배속 저장 · 이어받기 두 곳');
  const ed = M.slice(M.indexOf('const keep = old.find((o) => SE.sigOf(o.text) === SE.sigOf(t));'));
  ok(ed.indexOf('s.quiet = { ...keep.quiet }') > 0 && ed.indexOf('s.quiet = { ...keep.quiet }') < ed.indexOf('return s;'), '⏩ 글을 고쳐도 음성을 물려받으면 사본 기록도 함께(배속 두 번 방지)');
  const cs = M.slice(M.indexOf("ipcMain.handle('clip-speed'"), M.indexOf("ipcMain.handle('tts-sentences'"));
  ok(cs.indexOf("undoPush('클립 배속')") > 0 && cs.indexOf("undoPush('클립 배속')") < cs.indexOf('s.clipSpeed = sp'), '⏩ clip-speed: 바꾸기 전에 되돌리기 기억');
  ok(/cs: \(s\.clipSpeed && s\.clipSpeed !== 1\) \? s\.clipSpeed : null,   \/\/ ⏩/.test(PL), '⏩ 화면 DTO 에 cs');
  ok(/quietMaxSec: p\.quietMaxSec != null/.test(APP) && /quietMaxSec: Math\.max\(0, Math\.min\(3, numOr\(ch\.quietMaxSec/.test(APP), '채널 편집 읽기·저장 두 곳');
  try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} 통과 · ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
