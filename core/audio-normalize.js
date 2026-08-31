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
const LIMIT_PEAK = 0.89;         // alimiter 상한 ≈ -1dBFS. 게인을 올려도 클리핑이 안 생기게.

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
  return Math.abs(g) < 0.5 ? 0 : Math.round(g * 10) / 10;
}

/**
 * ffmpeg 오디오 필터 문자열을 만든다. tempo·gain 둘 다 없으면 null(= ffmpeg 불필요).
 * 🔑 순서가 중요하다 — **배속(atempo) → 증폭(volume) → 리미터** 순.
 *   리미터를 마지막에 두어야 어떤 경우에도 클리핑이 남지 않는다.
 * ⚠ 리미터는 게인을 **올릴 때만** 붙인다. 낮추는 쪽엔 필요 없고, 괜히 걸면 다이내믹만 건드린다.
 */
function buildFilter(tempo, gainDb) {
  const parts = [];
  if (tempo && Math.abs(tempo - 1) > 1e-6) parts.push(`atempo=${tempo}`);
  if (gainDb) {
    parts.push(`volume=${gainDb}dB`);
    if (gainDb > 0) parts.push(`alimiter=limit=${LIMIT_PEAK}`);
  }
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
  TARGET_DB_DEFAULT, MAX_GAIN_DB, MIN_GAIN_DB, LIMIT_PEAK,
};
