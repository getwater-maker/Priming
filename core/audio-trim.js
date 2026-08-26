'use strict';
/**
 * 앞뒤 무음 트림 — core/wav-slice.js 위에 얹은 **무손실** 절단.
 *
 * 🔑 **왜 ffmpeg silenceremove 가 아닌가**
 *   ① **재인코딩이 없다** — PCM 프레임 경계로 잘라 헤더만 다시 쓴다. 소리가 그대로다.
 *   ② **임계 근처에서 흔들리지 않는다** — 포락선을 한 번 만들고 앞/뒤 끝만 찾는다.
 *      silenceremove 는 스트리밍 필터라 중간의 조용한 구간에도 반응할 여지가 있다.
 *   ③ **자식 프로세스가 없다** — 16,000문장을 도는 배치에서 프로세스 기동 비용이 사라진다.
 *
 * 🔑 **실측 근거 (2026-08-26, 로컬 TTS 캐시 300개 · 24000Hz/1ch/16bit · 길이 중앙 3.24초)**
 *   | 임계 | 앞 무음(중앙/평균/p90/최대) | 뒤 무음 | 문장당 합 |
 *   |---|---|---|---|
 *   | -34dB(0.02) | 0.200 / 0.198 / 0.210 / 0.410 | 0.150 / 0.164 / 0.220 / 0.240 | 0.362초 |
 *   | -40dB(0.01) | 0.200 / 0.193 / 0.200 / 0.330 | 0.140 / 0.152 / 0.200 / 0.230 | 0.345초 |
 *   앞 무음이 **거의 항상 정확히 0.200초**(p90=0.20)다 — 모델이 붙이는 고정 패딩이다.
 *   16,000문장이면 **약 92분**이 무음이고, 리모션처럼 오디오 길이로 화면 길이를 정하는
 *   파이프라인에서는 그만큼 화면이 늘어진다.
 *
 * ⚠ **padSec 를 0 으로 두지 말 것** — 말 첫 음절의 파열음(ㅍ·ㅌ·ㅋ)이 잘린다. 기본 40ms.
 * ⚠ **트림을 배속보다 먼저** 하라 — 배속을 먼저 걸면 무음도 함께 늘어나 임계 판정이 흔들린다.
 * ⚠ 이 모듈은 **어떤 경우에도 던지지 않는다.** 트림은 부가 작업이라, 실패하면 원본을 그대로
 *   돌려주고 `changed:false` + `reason` 으로 알린다(조용히 성공한 척하지는 않는다).
 */

const { parseWav, sliceWav, envelope } = require('./wav-slice');

// peak 대비 비율. 절대 임계가 아니라 **상대 임계**인 이유: 문장마다 녹음 레벨이 달라도
// 같은 기준으로 잘리기 때문이다(위 실측의 일관성이 그 근거).
const DEFAULT_THRESHOLD = 0.01;   // ≈ -40dB
const DEFAULT_PAD_SEC   = 0.04;   // 40ms — 파열음 보호
const DEFAULT_HOP_SEC   = 0.01;   // 10ms 해상도
const DEFAULT_MIN_KEEP  = 0.05;   // 남는 구간이 이보다 짧으면 자르지 않는다(안전)

/**
 * 말이 있는 구간을 찾는다. 자르지는 않는다.
 * @returns {{speech:boolean, startSec:number, endSec:number, leadSec:number, tailSec:number, durationSec:number}}
 */
function analyze(buf, opts = {}) {
  const threshold = opts.threshold != null ? opts.threshold : DEFAULT_THRESHOLD;
  const hopSec = opts.hopSec != null ? opts.hopSec : DEFAULT_HOP_SEC;
  const { rms, hop, peak, info } = envelope(buf, hopSec);
  const dur = info.durationSec;
  if (!rms.length || !(peak > 0)) {
    return { speech: false, startSec: 0, endSec: dur, leadSec: 0, tailSec: 0, durationSec: dur };
  }
  const th = peak * threshold;
  let first = 0;
  while (first < rms.length && rms[first] < th) first++;
  let last = rms.length - 1;
  while (last >= 0 && rms[last] < th) last--;
  if (first > last) {
    return { speech: false, startSec: 0, endSec: dur, leadSec: 0, tailSec: 0, durationSec: dur };
  }
  const startSec = first * hop;
  const endSec = Math.min(dur, (last + 1) * hop);
  return { speech: true, startSec, endSec, leadSec: startSec, tailSec: dur - endSec, durationSec: dur };
}

/**
 * 앞뒤 무음을 잘라낸 WAV 버퍼를 돌려준다.
 * @param {Buffer} buf  WAV 버퍼
 * @param {object} [opts]  threshold · padSec · hopSec · minKeepSec
 * @returns {{buf:Buffer, changed:boolean, leadSec:number, tailSec:number, trimmedSec:number, durationSec:number, reason?:string}}
 *   leadSec/tailSec = **실제로 잘라낸** 앞/뒤 길이(패딩을 남긴 뒤의 값).
 */
function trimSilence(buf, opts = {}) {
  const padSec = opts.padSec != null ? opts.padSec : DEFAULT_PAD_SEC;
  const minKeep = opts.minKeepSec != null ? opts.minKeepSec : DEFAULT_MIN_KEEP;
  const nop = (reason, dur) => ({ buf, changed: false, leadSec: 0, tailSec: 0, trimmedSec: 0, durationSec: dur || 0, reason });

  let a;
  try { a = analyze(buf, opts); }
  catch (e) { return nop('WAV 분석 실패: ' + e.message); }

  if (!a.speech) return nop('소리가 없는 파일입니다(전 구간이 임계 미만)', a.durationSec);

  const start = Math.max(0, a.startSec - padSec);
  const end = Math.min(a.durationSec, a.endSec + padSec);
  if (end - start < minKeep) return nop('남는 구간이 너무 짧습니다', a.durationSec);

  const trimmedSec = a.durationSec - (end - start);
  if (trimmedSec <= 0.001) return nop('잘라낼 무음이 없습니다', a.durationSec);

  try {
    const out = sliceWav(buf, start, end);
    return {
      buf: out,
      changed: true,
      leadSec: start,
      tailSec: a.durationSec - end,
      trimmedSec,
      durationSec: end - start,
    };
  } catch (e) {
    return nop('자르기 실패: ' + e.message, a.durationSec);
  }
}

module.exports = {
  analyze,
  trimSilence,
  DEFAULT_THRESHOLD,
  DEFAULT_PAD_SEC,
  DEFAULT_HOP_SEC,
};
