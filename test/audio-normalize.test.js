'use strict';
// node test/audio-normalize.test.js — 「TTS 결과물 음량 정규화」 검증.
//
// 배경(2026-08-31): 로이 — "결과_X1_001조립 파일의 목소리가 작지 않아?"
//   실측으로 두 가지가 확인됐다:
//     ① **참조음성 음량이 결과에 거의 1:1 로 옮는다** — 참조 -13.9dB → 결과 -14.6dB /
//        참조 -19.9dB → 결과 -20.2dB. 조용히 녹음한 참조를 쓰면 결과 전체가 작다.
//     ② **짧은 문장일수록 작다** — 23개 표본 상관 r=0.675. 「우리가 그 울새를 볼까?」(2.1초)가
//        -17.9dB 로 다른 문장(-14.1dB)보다 3.8dB 낮았다.
//
// 🔑 **참조음성을 증폭하는 것으로는 못 고친다**(실측). 참조를 5dB 올리면 음량은 해결되지만
//   (-20.2 → -15.2dB) **문장 앞 숨이 0/8 → 3/8 로 늘었다** — 리미터가 말만 누르며 상대적으로
//   숨이 올라간 참조를 모델이 학습하기 때문. 그래서 **결과물 쪽에서** 맞춘다.
//
// 지키는 것:
//   ① 말 구간 RMS 를 정확히 잰다(무음·숨 제외)
//   ② 목표 게인 계산 — 상한/하한, 미세 보정은 안 함
//   ③ 필터 순서 배속→증폭→리미터 · 리미터는 **올릴 때만**
//   ④ 채널 설정(기본 켜짐, 명시적으로 끌 수 있음)
//   ⑤ 캐시 키에 목표가 들어간다 — 안 넣으면 옛 음량이 되살아난다
//   ⑥ pipeline·App.jsx 배선 (넣어도 안 쓰이면 무의미)
//   ⑦ **실제 WAV 로 돌려 음량이 맞고 억양이 안 깎이는지** — 이게 이 기능의 존재 이유다

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const AN = require('../core/audio-normalize');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  x ' + m); } };
const eq = (a, b, m) => ok(a === b, m + '  (기대 ' + JSON.stringify(b) + ' / 실제 ' + JSON.stringify(a) + ')');
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, m + '  (기대 ' + b + '±' + tol + ' / 실제 ' + (typeof a === 'number' ? a.toFixed(2) : a) + ')');

// ── 합성 WAV 만들기(16bit PCM 24kHz 모노) ──
function makeWav(samples, sr) {
  sr = sr || 24000;
  const nS = samples.length, buf = Buffer.alloc(44 + nS * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + nS * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(nS * 2, 40);
  for (let i = 0; i < nS; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
// 앞뒤 무음 + 가운데 톤 — 실제 문장(무음이 섞인)을 흉내낸다
function toneWav(ampDb, sec, sr) {
  sr = sr || 24000; sec = sec || 2;
  const amp = Math.pow(10, ampDb / 20);
  const total = Math.round(sr * (sec + 1));      // 앞뒤 0.5초씩 무음
  const x = new Float32Array(total);
  const s0 = Math.round(sr * 0.5), s1 = s0 + Math.round(sr * sec);
  for (let i = s0; i < s1; i++) x[i] = amp * Math.sin(2 * Math.PI * 120 * (i / sr)) * 1.414;  // RMS=amp
  return makeWav(x, sr);
}

console.log('\n[1] 말 구간 RMS 측정 — 무음을 빼고 발화만 본다');
{
  for (const db of [-10, -15, -20, -25]) {
    const m = AN.measureSpeech(toneWav(db, 2));
    ok(m != null, 'ⓐ ' + db + 'dB 톤을 측정했다');
    if (m) near(m.speechDb, db, 1.0, '  → 말 구간 RMS 가 ' + db + 'dB 로 나온다 (무음 0.5초씩이 섞여도)');
  }
  // 무음·너무 짧은 것은 판단하지 않는다(잘못된 게인 방지)
  eq(AN.measureSpeech(makeWav(new Float32Array(24000))), null, 'ⓑ 무음은 null (게인을 계산하지 않는다)');
  eq(AN.measureSpeech(makeWav(new Float32Array(100))), null, 'ⓒ 0.1초 미만은 null');
  eq(AN.measureSpeech(Buffer.from('not a wav')), null, 'ⓓ WAV 가 아니면 null');
  eq(AN.measureSpeech(null), null, 'ⓔ null 입력에도 안 던진다');
}

console.log('[2] 게인 계산 — 상한/하한과 미세 보정');
{
  // ⚠ 피크 여유가 넉넉할 때의 기본 계산. 여유가 좁으면 아래 ⓖ 처럼 덜 올린다.
  eq(AN.gainForTarget({ speechDb: -20, peakDb: -10 }, -15), 5, 'ⓐ -20dB → 목표 -15dB 면 +5dB');
  eq(AN.gainForTarget({ speechDb: -10, peakDb: -1 }, -15), -5, 'ⓑ 큰 소리는 낮춘다');
  eq(AN.gainForTarget({ speechDb: -15.2, peakDb: -3 }, -15), 0, 'ⓒ 0.5dB 미만 차이는 손대지 않는다 (ffmpeg 헛돌기 방지)');
  eq(AN.gainForTarget({ speechDb: -40, peakDb: -20 }, -15), AN.MAX_GAIN_DB, 'ⓓ 상한 — 바닥 잡음까지 끌어올리지 않는다');
  eq(AN.gainForTarget({ speechDb: 0, peakDb: 0 }, -15), AN.MIN_GAIN_DB, 'ⓔ 하한');
  eq(AN.gainForTarget(null, -15), 0, 'ⓕ 측정 실패면 0 (조용히 원본 유지)');
  // 🔴 **피크가 상한(-1dBFS)을 넘지 않는 만큼만 올린다** — 리미터를 안 쓰므로 이게 유일한 안전장치다.
  //   (2026-08-31 「지지지」 사고: 리미터로 밀어 넣었더니 파형이 왜곡됐다.)
  eq(AN.gainForTarget({ speechDb: -20, peakDb: -2 }, -15), 1,
    'ⓖ 피크 여유가 1dB 뿐이면 +1dB 만 올린다 (목표 +5dB 를 포기한다)');
  eq(AN.gainForTarget({ speechDb: -20.5, peakDb: -5.97 }, -15), 5,
    'ⓗ 여유 안이면 그만큼 올린다 (실제 TTS 결과물 값)');
  eq(AN.gainForTarget({ speechDb: -25, peakDb: -12 }, -15), 10,
    'ⓘ 여유가 크면 목표까지 올린다');
  ok(AN.gainForTarget({ speechDb: -14, peakDb: -0.2 }, -15) <= 0,
    'ⓙ 낮추는 쪽은 피크 제한과 무관하다');
  // 어떤 입력이든 결과 피크가 상한을 넘지 않는다
  for (const [r, p] of [[-30, -20], [-20, -5], [-18, -1.5], [-25, -0.5]]) {
    const g = AN.gainForTarget({ speechDb: r, peakDb: p }, -15);
    // 상한을 넘지 않거나, 원본이 이미 그보다 크면 **더 키우지는 않는다**(그대로 둔다).
    ok(p + g <= Math.max(AN.PEAK_CEIL_DB, p) + 0.05,
      'ⓚ 결과 피크가 상한 이하이거나 원본보다 커지지 않는다 (RMS ' + r + ' 피크 ' + p + ' → +' + g + 'dB)');
  }
}

console.log('[3] 필터 문자열 — 순서와 리미터 조건');
{
  eq(AN.buildFilter(1, 0), null, 'ⓐ 배속·게인 둘 다 없으면 null (ffmpeg 를 안 부른다)');
  eq(AN.buildFilter(1.15, 0), 'atempo=1.15', 'ⓑ 배속만');
  eq(AN.buildFilter(1, 5), 'volume=5dB', 'ⓒ 게인만 — 순수 볼륨 조절뿐');
  eq(AN.buildFilter(1, -5), 'volume=-5dB', 'ⓓ 낮출 때도 마찬가지');
  eq(AN.buildFilter(1.15, 5), 'atempo=1.15,volume=5dB', 'ⓔ 배속이 증폭보다 앞');
  // 🔴 2026-08-31 「지지지」 사고: alimiter 의 attack 5ms 가 남성 저음 한 주기(84Hz≈12ms)보다
  //   짧아 **파형 안에서 게인이 변했다** → 고조파 왜곡. 게인 +5.5dB 인데 대역별로 +7~+18dB 로
  //   제각각 올랐다. 리미터를 빼고 피크 여유 안에서만 올리니 전 대역이 균일하게 +5dB 올랐다.
  ok(!/alimiter/.test(AN.buildFilter(1, 5) || ''), 'ⓕ 리미터를 쓰지 않는다 (파형 왜곡의 원인)');
  ok(!/acompressor|compand/.test(AN.buildFilter(1, 10) || ''), 'ⓖ 압축기도 쓰지 않는다');
}

console.log('[4] 채널 설정 — 기본 켜짐, 명시적으로만 끈다');
{
  eq(AN.targetFromPreset({}), AN.TARGET_DB_DEFAULT, 'ⓐ 설정이 없으면 기본값으로 켜진다');
  eq(AN.targetFromPreset({ ttsNormalize: false }), null, 'ⓑ 끄면 null');
  eq(AN.targetFromPreset({ ttsNormalize: true, ttsTargetDb: -18 }), -18, 'ⓒ 목표를 지정할 수 있다');
  eq(AN.targetFromPreset({ ttsTargetDb: 5 }), AN.TARGET_DB_DEFAULT, 'ⓓ 양수 같은 이상값은 기본값으로');
  eq(AN.targetFromPreset({ ttsTargetDb: -99 }), AN.TARGET_DB_DEFAULT, 'ⓔ 범위 밖도 기본값으로');
  eq(AN.targetFromPreset(null), null, 'ⓕ preset 이 없으면 null');
}

console.log('[5] 캐시 키 — 목표가 바뀌면 그 문장만 다시 만든다');
{
  const C = require('../core/tts-cache');
  const base = { refName: 'v', seed: 1 };
  const a = C.keyFor('안녕', 1, base);
  const b = C.keyFor('안녕', 1, { ...base, normDb: -15 });
  const c = C.keyFor('안녕', 1, { ...base, normDb: -18 });
  ok(a !== b, 'ⓐ 정규화를 켜면 키가 달라진다');
  ok(b !== c, 'ⓑ 목표를 바꾸면 키가 달라진다 (안 그러면 옛 음량이 되살아난다)');
  eq(C.keyFor('안녕', 1, { ...base, normDb: -15 }), b, 'ⓒ 같은 목표면 같은 키 (재활용은 그대로)');
}

console.log('[6] 배선 — 실제로 쓰이는지 원문 대조');
{
  const P = fs.readFileSync(path.join(__dirname, '..', 'core', 'pipeline.js'), 'utf8');
  const A = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8');
  ok(/require\('\.\/audio-normalize'\)/.test(P), 'ⓐ pipeline 이 모듈을 쓴다');
  ok(/AudioNorm\.targetFromPreset\(preset\)/.test(P), 'ⓑ 채널 설정에서 목표를 읽는다');
  ok(/AudioNorm\.gainForTarget\(AudioNorm\.measureSpeech\(res\.mp3Buffer\)/.test(P),
    'ⓒ 합성 결과 버퍼를 재서 게인을 정한다');
  ok(/normDb: normTarget/.test(P), 'ⓓ 캐시 키에 목표를 넘긴다');
  ok(/function encodeTts\(/.test(P), 'ⓔ 인코딩이 배속·게인을 함께 처리한다 (ffmpeg 호출 1회)');
  ok(!/function atempoWavToMp3\(/.test(P), 'ⓕ 옛 함수가 남아 있지 않다');
  ok(/음량 정규화/.test(P), 'ⓖ 켜졌다는 사실이 로그에 남는다 (조용히 바뀌지 않게)');
  ok(/음량 \$\{s\.ttsGainDb/.test(P), 'ⓗ 문장마다 적용된 게인이 로그에 남는다');
  ok(/ttsNormalize: ch\.ttsNormalize !== false/.test(A), 'ⓘ 저장 patch 에 실린다 (안 실으면 빈 값으로 덮인다)');
  ok(/ttsTargetDb: numOr\(ch\.ttsTargetDb, -15\)/.test(A), 'ⓙ 목표도 patch 에 실린다');
  ok(/ttsNormalize: p\.ttsNormalize !== false/.test(A), 'ⓚ 편집창을 열 때 저장값을 싣는다');
  ok(/음량 맞추기/.test(A), 'ⓛ 채널편집에 UI 가 있다');
  // 어떤 게인에서도 리미터·압축이 붙지 않는다 (소스 문자열 대신 실제 출력으로 확인)
  let hasLim = false;
  for (let g = -12; g <= 12; g += 0.5) {
    const ff = AN.buildFilter(1, AN.gainForTarget({ speechDb: -15 - g, peakDb: -10 }, -15));
    if (ff && /alimiter|acompressor|compand/.test(ff)) hasLim = true;
  }
  ok(!hasLim, 'ⓜ 어떤 게인에서도 리미터·압축이 붙지 않는다');
}

console.log('[7] 실제 ffmpeg 로 돌려본다 — 음량이 맞고 억양이 안 깎이는지');
{
  let ff = null;
  try {
    ff = require('ffmpeg-static');
    if (ff && ff.includes('app.asar') && !ff.includes('app.asar.unpacked')) ff = ff.replace('app.asar', 'app.asar.unpacked');
  } catch (_) { ff = null; }
  if (!ff || !fs.existsSync(ff)) {
    console.log('  (ffmpeg 없음 — 이 절은 건너뜁니다)');
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-'));
    // 억양을 흉내낸 신호: 100Hz ↔ 140Hz 를 오가고 음량도 오르내린다
    const sr = 24000, sec = 3, total = sr * sec;
    const x = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const t = i / sr;
      const f = 100 + 40 * Math.sin(2 * Math.PI * 0.5 * t);
      const env = 0.5 + 0.4 * Math.sin(2 * Math.PI * 0.33 * t);
      x[i] = 0.28 * env * Math.sin(2 * Math.PI * f * t);   // 실제 TTS 결과물 수준(약 -20dB)
    }
    const src = path.join(dir, 'in.wav');
    fs.writeFileSync(src, makeWav(x, sr));

    const before = AN.measureSpeech(fs.readFileSync(src));
    ok(before != null, 'ⓐ 원본을 측정했다');
    const gain = AN.gainForTarget(before, -15);
    ok(gain > 0, 'ⓑ 조용한 원본이라 올려야 한다고 판단한다 (' + gain + 'dB)');

    const out = path.join(dir, 'out.wav');
    const filt = AN.buildFilter(1, gain);
    const r = spawnSync(ff, ['-y', '-i', src, '-filter:a', filt, '-codec:a', 'pcm_s16le', '-ar', '24000', '-ac', '1', out], { stdio: 'ignore' });
    eq(r.status, 0, 'ⓒ ffmpeg 가 성공한다  (filter: ' + filt + ')');

    if (fs.existsSync(out)) {
      const after = AN.measureSpeech(fs.readFileSync(out));
      near(after.speechDb, -15, 1.5, 'ⓓ 목표 -15dB 에 맞았다');
      ok(after.peakDb <= -0.3, 'ⓔ 클리핑이 없다 (피크 ' + after.peakDb.toFixed(2) + 'dBFS)');

      // 억양(다이내믹)이 살아 있는지 — 정규화가 소리를 납작하게 만들면 안 된다
      const dyn = (buf) => {
        const b = buf, F = [];
        const N = Math.round(sr * 0.02);
        for (let s = 44; s + N * 2 <= b.length; s += N * 2) {
          let acc = 0;
          for (let k = 0; k < N; k++) { const v = b.readInt16LE(s + k * 2) / 32768; acc += v * v; }
          F.push(20 * Math.log10(Math.sqrt(acc / N) + 1e-12));
        }
        F.sort((a, c) => a - c);
        return F[Math.floor(F.length * 0.95)] - F[Math.floor(F.length * 0.55)];
      };
      const d0 = dyn(fs.readFileSync(src)), d1 = dyn(fs.readFileSync(out));
      ok(d1 > d0 - 1.5, 'ⓕ 다이내믹이 유지된다 — 정규화가 억양을 깎지 않는다 (' + d0.toFixed(1) + ' → ' + d1.toFixed(1) + 'dB)');

      // 🔴 클리핑 샘플 실측 — 기계음은 여기서 드러난다(옛 코드는 88개였다)
      const clipCount = (file) => {
        const b = fs.readFileSync(file); let c = 0;
        for (let p = 44; p + 1 < b.length; p += 2) if (Math.abs(b.readInt16LE(p)) >= 32766) c++;
        return c;
      };
      eq(clipCount(out), 0, 'ⓖ 클리핑 샘플이 0 개다 (auto level 이 켜져 있으면 여기서 터진다)');
    }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

console.log('[8] 소스 위생');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'audio-normalize.js'), 'utf8');
  ok(!/\r\n/.test(src), 'ⓐ 줄끝 LF');
  ok(src.indexOf(String.fromCharCode(0)) < 0, 'ⓑ NUL 없음');
  const P = fs.readFileSync(path.join(__dirname, '..', 'core', 'pipeline.js'), 'utf8');
  ok(!/\r\n/.test(P), 'ⓒ pipeline.js 줄끝 LF');
}

console.log('\n' + (bad ? 'X ' + bad + '/' + n + ' 실패' : 'OK ' + n + '/' + n + ' 통과'));
process.exit(bad ? 1 : 0);
