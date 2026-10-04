'use strict';

/**
 * 유료 TTS provider 공용 — 받은 소리를 **WAV(24kHz 16bit mono)** 결과로 만든다.
 * 🔑 파이프라인(음량 정규화·무음 검사·ffmpeg 배속)은 WAV 를 전제로 한다 → 모든 provider 는 WAV 로 돌려준다.
 */

const { measureWav, MIN_AUDIO_SEC } = require('./omnivoice-provider');

function pcmToWav(pcm, sampleRate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const isWav = (b) => !!(b && b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE');

/** WAV 버퍼 → provider 결과. 소리가 없으면 emptyAudio 오류(파이프라인이 다시 시도한다). */
function wavResult(wav, providerId, label) {
  const { durationSec } = measureWav(wav);
  if (!(durationSec >= MIN_AUDIO_SEC)) {
    const err = new Error(`${label} 가 빈 음성을 돌려줬습니다 (${wav ? wav.length : 0}바이트)`);
    err.emptyAudio = true;
    throw err;
  }
  return { mp3Buffer: wav, durationSec, providerUsed: providerId, format: 'wav' };
}

/** fetch + 시간 제한 + 사람 말 오류 */
async function fetchWithTimeout(url, init, timeoutMs, label) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e && (e.name === 'AbortError' || /aborted/i.test(String(e.message || '')))) {
      throw new Error(`${label} 가 ${Math.round(timeoutMs / 1000)}초 안에 응답하지 않았습니다`);
    }
    throw new Error(`${label} 에 연결하지 못했습니다: ${e.message}`);
  } finally { clearTimeout(t); }
}

/** 실패 응답 → 사람 말 오류 */
async function httpError(res, label) {
  let body = '';
  try { body = await res.text(); } catch {}
  const why = res.status === 401 || res.status === 403 ? 'API 키가 틀렸거나 권한이 없습니다'
    : res.status === 429 ? '요청 한도(또는 잔액)를 넘었습니다'
    : res.status === 402 ? '잔액·크레딧이 부족합니다'
    : res.status >= 500 ? '서비스 쪽 오류입니다(잠시 뒤 다시)' : '요청이 거절됐습니다';
  const err = new Error(`${label} 실패 (${res.status} · ${why}): ${String(body).replace(/\s+/g, ' ').slice(0, 200)}`);
  err.status = res.status;
  return err;
}

module.exports = { pcmToWav, isWav, wavResult, fetchWithTimeout, httpError };
