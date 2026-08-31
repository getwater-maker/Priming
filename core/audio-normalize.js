'use strict';
/**
 * TTS 결과물 음량 정규화 — 문장마다 음량이 들쭉날쭉한 것을 한 레벨로 맞춘다. (2026-08-31)
 *
 * 왜 필요한가 — OmniVoice 는 문장을 **하나씩 독립 합성**하고 음량을 맞춰 주지 않는다. 그래서
 *   ① **참조음성의 음량이 결과에 거의 1:1로 옮는다**(실측: 참조 -13.9dB → 결과 -14.6dB /
 *      참조 -19.9dB → 결과 -20.2dB). 조용히 녹음한 참조를 쓰면 결과 전체가 작다.
 *   ② **짧은 문장일수록 작게 나온다**(실측 23개 표본, 상관 r=0.675 · 3초 미만이 평균 1.5dB 낮음).
 *      의문문은 특히 낮다(「우리가 그 울새를 볼까?」 -17.9dB vs 다른 문장 -14.1dB = 3.8dB 차이).
 *   롱폼은 문장이 수백 개라 이 편차가 내내 이어진다.
 *
 * 🔑 **참조음성을 증폭하는 것으로는 못 고친다** — 실측으로 확인했다. 참조를 5dB 올려 합성하면
 *   음량은 해결되지만(-20.2 → -15.2dB) **문장 앞 숨이 0/8 → 3/8 로 늘었다**. 리미터가 큰 소리(말)만
 *   누르면서 상대적으로 숨이 올라간 참조를 모델이 그대로 학습하기 때문이다.
 *   결과물을 올리면 말과 숨이 **같은 비율로** 오르므로 그 문제가 없다. 그래서 여기서 한다.
 *
 * 측정 방식 — 「말 구간 RMS」= 20ms 프레임 RMS 중, 피크 대비 -20dB 이상인 프레임들의 **중앙값**.
 *   무음·숨을 빼고 실제 발화의 대표 음량만 본다. 이 프로젝트의 다른 측정과 같은 정의를 쓴다.
 */

const TARGET_DB_DEFAULT = -15;   // 실측 기준선: 기존 참조음성(#01)으로 만든 결과가 -14.6dB 였다
const MAX_GAIN_DB = 12;          // 조용한 녹음의 바닥 잡음까지 끌어올리지 않도록 상한
const MIN_GAIN_DB = -12;
const PEAK_CEIL_DB = -1;         // 출력 피크 상한(dBFS). 게인은 여기까지만 올린다.
// 🔴 **리미터를 쓰지 않는다**(2026-08-31 실사고: 「지지지」 소리).
//   alimiter 의 attack 기본 5ms 는 남성 저음의 한 주기(84Hz ≈ 12ms)보다 짧아 **파형 안에서 게인이
//   변한다** → 고조파 왜곡. 실측: 게인 +5.5dB 인데 대역별로 0.5-1.5k +16dB · 1.5-4k +18dB 로
//   제각각 올랐다(균일하게 올라야 정상). 리미터를 걸지 않고 **피크 여유 안에서만** 올리면
//   왜곡이 원천적으로 없다. 목표에 조금 못 미치는 문장이 생기지만 그게 훨씬 낫다.

/** WAV 버퍼(PCM 16bit) 헤더를 훑어 data 청크 위치를 찾는다. 못 찾으면 null. */
function _findData(buf) {
  if (!buf || buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let p = 12, fmt = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const sz = buf.readUInt32LE(p + 4);
    if (id === 'fmt ' && p + 8 + 16 <= buf.length) {
      fmt = { channels: buf.readUInt16LE(p + 10), sampleRate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    } else if (id === 'data') {
      const end = Math.min(buf.length, p + 8 + sz);
      return fmt ? { ...fmt, offset: p + 8, end } : null;
    }
    p += 8 + sz + (sz & 1);
  }
  return null;
}

/**
 * 말 구간 RMS·피크를 dBFS 로 잰다.
 * @returns {{speechDb:number, peakDb:number}|null}  16bit PCM WAV 가 아니거나 너무 짧으면 null
 */
function measureSpeech(buf) {
  const d = _findData(buf);
  if (!d || d.bits !== 16) return null;
  const n = Math.floor((d.end - d.offset) / 2);
  if (n < d.sampleRate * 0.1) return null;                 // 0.1초 미만은 판단하지 않는다

  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(buf.readInt16LE(d.offset + i * 2));
    if (a > peak) peak = a;
  }
  if (peak < 8) return null;                                // 사실상 무음
  const peakDb = 20 * Math.log10(peak / 32768);

  const N = Math.max(1, Math.round(d.sampleRate * 0.02));   // 20ms 프레임
  const frames = [];
  for (let s = 0; s + N <= n; s += N) {
    let acc = 0;
    for (let k = 0; k < N; k++) { const v = buf.readInt16LE(d.offset + (s + k) * 2) / 32768; acc += v * v; }
    frames.push(20 * Math.log10(Math.sqrt(acc / N) + 1e-12));
  }
  if (!frames.length) return null;
  const loud = frames.filter((v) => v > peakDb - 20).sort((a, b) => a - b);
  if (!loud.length) return null;
  return { speechDb: loud[Math.floor(loud.length / 2)], peakDb };
}

/**
 * 목표 레벨에 맞출 게인(dB)을 정한다. 0 이면 손댈 필요 없음.
 * ⚠ 아주 작은 보정(±0.5dB 미만)은 하지 않는다 — ffmpeg 를 한 번 더 돌릴 값어치가 없다.
 */
function gainForTarget(measured, targetDb = TARGET_DB_DEFAULT) {
  if (!measured || !isFinite(measured.speechDb)) return 0;
  let g = targetDb - measured.speechDb;
  if (g > MAX_GAIN_DB) g = MAX_GAIN_DB;
  if (g < MIN_GAIN_DB) g = MIN_GAIN_DB;
  // 🔴 **피크 여유를 넘겨 올리지 않는다**(2026-08-31 실사고: 기계음).
  //   RMS 만 보고 올리면 피크가 큰 문장에서 리미터가 과하게 물려 소리가 뭉개진다.
  //   리미터가 물어도 되는 건 MAX_LIMITING_DB 까지 — 그 이상 필요하면 목표를 포기하고 덜 올린다.
  //   (문장 하나가 조금 작은 것보다 왜곡이 훨씬 나쁘다.)
  // 🔴 **피크가 상한을 넘지 않는 만큼만 올린다** — 리미터를 쓰지 않으므로 이 제한이 유일한 안전장치다.
  if (g > 0 && isFinite(measured.peakDb)) {
    const maxByPeak = PEAK_CEIL_DB - measured.peakDb;
    if (g > maxByPeak) g = maxByPeak;
    if (g < 0) g = 0;
  }
  return Math.abs(g) < 0.5 ? 0 : Math.round(g * 10) / 10;
}

/**
 * ffmpeg 오디오 필터 문자열을 만든다. tempo·gain 둘 다 없으면 null(= ffmpeg 불필요).
 * 순서는 **배속(atempo) → 증폭(volume)**. 리미터·압축은 쓰지 않는다(위 주석 참조).
 */
function buildFilter(tempo, gainDb) {
  const parts = [];
  if (tempo && Math.abs(tempo - 1) > 1e-6) parts.push(`atempo=${tempo}`);
  // 게인은 순수 볼륨 조절뿐 — 리미터·압축을 걸지 않으므로 파형이 그대로 유지된다(왜곡 0).
  //   피크가 넘지 않는 것은 gainForTarget 이 이미 보장한다.
  if (gainDb) parts.push(`volume=${gainDb}dB`);
  return parts.length ? parts.join(',') : null;
}

/** 채널(프리셋) 설정 → 정규화 목표. 꺼져 있으면 null. */
function targetFromPreset(preset) {
  if (!preset) return null;
  if (preset.ttsNormalize === false) return null;           // 명시적으로 끈 경우만 끈다(기본 켜짐)
  const t = Number(preset.ttsTargetDb);
  if (isFinite(t) && t < 0 && t > -40) return t;
  return TARGET_DB_DEFAULT;
}

module.exports = {
  measureSpeech, gainForTarget, buildFilter, targetFromPreset,
  TARGET_DB_DEFAULT, MAX_GAIN_DB, MIN_GAIN_DB, PEAK_CEIL_DB,
};
