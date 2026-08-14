'use strict';
/**
 * core/wav-slice.js — WAV 를 구간(초)으로 잘라내기 + 말구간 자동 탐지.
 *
 * 왜 필요한가(2026-08-14 로이): 보이스디자인(Qwen3-TTS)이 만든 음성은 **문장 끝이 서서히 작아진다**
 *   (실측: 마지막 0.7~0.9초가 최대 대비 40%→0% 로 단조 감쇠). 우리 서버는 페이드를 걸지 않으므로
 *   **모델 출력 자체의 특성**이다. 이 감쇠 구간이 참조음성에 들어가면 OmniVoice 가 그 "잦아드는" 끝을
 *   함께 흉내 내, 합성한 모든 문장의 끝이 끊기는 느낌이 된다.
 *   → 길게(10초쯤) 만들고 **끝을 잘라내어** 감쇠 없는 부분만 참조음성으로 쓴다.
 *
 * ffmpeg 을 쓰지 않고 직접 자른다: PCM 은 프레임 경계로 자르면 되고, 외부 프로세스 없이 정확하며
 *   샘플 단위로 결정적이다(재인코딩 없음 = 무손실).
 */

/** WAV 헤더 파싱 → { fmtChunk, audioFormat, channels, sampleRate, bitsPerSample, dataOffset, dataSize } */
function parseWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('WAV 파일이 아닙니다 (RIFF/WAVE 헤더 없음)');
  }
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        chunkStart: off, chunkSize: size,
        audioFormat: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bitsPerSample: buf.readUInt16LE(off + 22),
      };
    } else if (id === 'data') {
      // 일부 인코더는 data 크기를 0xFFFFFFFF 로 두거나 실제보다 크게 적는다 → 파일 끝으로 보정
      data = { offset: off + 8, size: Math.min(size, buf.length - off - 8) };
      break;
    }
    off += 8 + size + (size % 2);   // 청크는 짝수 바이트 정렬
  }
  if (!fmt || !data) throw new Error('WAV 청크(fmt/data)를 찾지 못했습니다');
  const frameBytes = Math.max(1, (fmt.bitsPerSample / 8) * fmt.channels);
  const frames = Math.floor(data.size / frameBytes);
  return { ...fmt, dataOffset: data.offset, dataSize: data.size, frameBytes, frames, durationSec: frames / fmt.sampleRate };
}

/** 초 → 프레임(범위 보정) */
function _frameAt(sec, info) {
  const f = Math.round(Number(sec) * info.sampleRate);
  return Math.max(0, Math.min(info.frames, isFinite(f) ? f : 0));
}

/**
 * buf 를 [startSec, endSec) 구간으로 자른 새 WAV Buffer 반환.
 *   - 원본 fmt 청크를 그대로 복사(포맷 유지, 재인코딩 없음)
 *   - 범위가 비었거나 전체와 같으면 원본을 그대로 돌려준다(불필요한 재작성 방지)
 */
function sliceWav(buf, startSec, endSec) {
  const info = parseWav(buf);
  let s = _frameAt(startSec == null ? 0 : startSec, info);
  let e = _frameAt(endSec == null ? info.durationSec : endSec, info);
  if (e <= s) throw new Error('구간이 비어 있습니다 (끝이 시작보다 앞)');
  if (s === 0 && e === info.frames) return buf;

  const body = buf.subarray(info.dataOffset + s * info.frameBytes, info.dataOffset + e * info.frameBytes);
  const fmtChunk = buf.subarray(info.chunkStart, info.chunkStart + 8 + info.chunkSize + (info.chunkSize % 2));
  const out = Buffer.alloc(12 + fmtChunk.length + 8 + body.length);
  let p = 0;
  out.write('RIFF', p, 'ascii'); p += 4;
  out.writeUInt32LE(out.length - 8, p); p += 4;
  out.write('WAVE', p, 'ascii'); p += 4;
  fmtChunk.copy(out, p); p += fmtChunk.length;
  out.write('data', p, 'ascii'); p += 4;
  out.writeUInt32LE(body.length, p); p += 4;
  body.copy(out, p);
  return out;
}

/** 프레임 단위 진폭(0..1) — 16/24/32bit 정수 + 32bit float 지원. 채널은 평균. */
function _sampleAt(buf, info, frame) {
  const base = info.dataOffset + frame * info.frameBytes;
  const bytes = info.bitsPerSample / 8;
  let sum = 0;
  for (let c = 0; c < info.channels; c++) {
    const o = base + c * bytes;
    if (o + bytes > buf.length) return 0;
    let v = 0;
    if (info.audioFormat === 3 && info.bitsPerSample === 32) v = buf.readFloatLE(o);
    else if (info.bitsPerSample === 16) v = buf.readInt16LE(o) / 32768;
    else if (info.bitsPerSample === 32) v = buf.readInt32LE(o) / 2147483648;
    else if (info.bitsPerSample === 24) v = ((buf.readUInt8(o) | (buf.readUInt8(o + 1) << 8) | (buf.readInt8(o + 2) << 16)) / 8388608);
    else if (info.bitsPerSample === 8) v = (buf.readUInt8(o) - 128) / 128;
    sum += v;
  }
  return sum / info.channels;
}

/** 20ms 프레임 RMS 배열 → { rms[], hop(초), peak } */
function envelope(buf, hopSec = 0.02) {
  const info = parseWav(buf);
  const hop = Math.max(1, Math.round(info.sampleRate * hopSec));
  const rms = [];
  for (let s = 0; s + hop <= info.frames; s += hop) {
    let acc = 0;
    for (let i = 0; i < hop; i++) { const v = _sampleAt(buf, info, s + i); acc += v * v; }
    rms.push(Math.sqrt(acc / hop));
  }
  return { rms, hop: hop / info.sampleRate, peak: rms.length ? Math.max(...rms) : 0, info };
}

/**
 * 말이 실제로 들어 있는 구간을 추정 → { start, end }(초).
 *   앞의 무음과 **뒤의 감쇠(페이드) 구간**을 잘라낸다. 임계값은 최대 RMS 대비 비율.
 *   ⚠ 자음 끝이 잘리지 않도록 뒤에 pad 를 붙이고, 실패하면 전체 구간을 돌려준다(안전).
 */
//   임계 0.35 / pad 0.04 는 실측으로 고른 값 — 0.2/0.08 은 꼬리에 감쇠가 남아 잘라도 끝이 약했다
//   (같은 파일 기준 끝 에너지 20.3% → 26.2%). 더 올리면(0.5) 끝은 세지지만 말을 많이 버린다.
function suggestRange(buf, { threshold = 0.35, padSec = 0.04 } = {}) {
  const { rms, hop, peak, info } = envelope(buf);
  if (!rms.length || peak <= 0) return { start: 0, end: info.durationSec };
  const th = peak * threshold;
  let first = rms.findIndex((v) => v >= th);
  let last = -1;
  for (let i = rms.length - 1; i >= 0; i--) { if (rms[i] >= th) { last = i; break; } }
  if (first < 0 || last < 0) return { start: 0, end: info.durationSec };
  const start = Math.max(0, first * hop - padSec);
  const end = Math.min(info.durationSec, (last + 1) * hop + padSec);
  return { start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 };
}

module.exports = { parseWav, sliceWav, envelope, suggestRange };
