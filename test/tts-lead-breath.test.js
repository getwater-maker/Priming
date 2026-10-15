'use strict';
// node test/tts-lead-breath.test.js — 「문장 맨 앞 들숨 지우기」 검증 (2026-10-15 · v0.9.20).
//
// 배경: 로이 — "옴니보이스의 희동으로 영상제작을 했어. 문장 읽을 때 첫 시작점에서 숨소리가 들어간다."
//   실측(희동 · 카프카 대본 24문장 + ㅅ·ㅎ·ㅊ 로 시작하는 문장 56개): 참조음성 앞부분은 -65dB 로 깨끗한데
//   결과의 약 2/3 가 **0.2초 여백 → 숨(말보다 18~38dB 낮음, 0.1~0.38초) → 정적(40ms~) → 첫 낱말** 꼴이었다.
//   숨 없는 문장의 ㅅ·ㅎ·ㅊ 진입부는 첫 낱말에 **붙어**(정적 없이 10~40ms) 있었다.
//   지운 50개를 원본과 받아쓰기(whisper)로 비교 → 앞 4글자 50/50 같음(첫 글자를 먹지 않는다).
//
// 지키는 것:
//   ① 숨 → 정적 → 말 : 숨만 0 이 되고 말은 샘플 단위로 같다 · 길이 불변
//   ② 숨 없는 문장 : 그대로(null)
//   ③ 첫 낱말에 붙은 자음 진입부(정적 없이) : 그대로
//   ④ 정적이 아주 짧은(20ms) 것 = 낱말 안의 막힘일 수 있다 : 그대로
//   ⑤ 판정력 — 숨 크기를 바꿔도(작게·크게) 잡는다 / 숨이 없으면 안 잡는다
//   ⑥ 배선 — provider 가 부르고, 캐시 키(롱폼·리모션)에 lb 가 있다(옛 숨 캐시가 되살아나지 않게) · 유료 엔진 키는 그대로

const fs = require('fs');
const path = require('path');
const AN = require('../core/audio-normalize');
const TtsCache = require('../core/tts-cache');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  x ' + m); } };

const SR = 24000;
function makeWav(samples) {
  const nS = samples.length, buf = Buffer.alloc(44 + nS * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + nS * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(nS * 2, 40);
  for (let i = 0; i < nS; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
const sil = (sec) => new Array(Math.round(SR * sec)).fill(0);
const noise = (sec, db) => { const a = Math.pow(10, db / 20) * Math.sqrt(3); return Array.from({ length: Math.round(SR * sec) }, () => rnd() * a); };
// 말 = 140Hz 기본음 + 배음(-14dB 근처 RMS)
const speech = (sec) => Array.from({ length: Math.round(SR * sec) }, (_, i) => 0.22 * Math.sin(2 * Math.PI * 140 * i / SR) + 0.12 * Math.sin(2 * Math.PI * 420 * i / SR));
const dataOf = (b) => b.slice(44);
const regionMax = (b, s0, s1) => { let m = 0; for (let i = Math.round(s0 * SR); i < Math.round(s1 * SR); i++) m = Math.max(m, Math.abs(b.readInt16LE(44 + i * 2))); return m; };

// ① 숨 → 정적 → 말
{
  const src = makeWav([...sil(0.16), ...noise(0.28, -45), ...sil(0.10), ...speech(1.5), ...sil(0.15)]);
  const r = AN.muteLeadBreath(src);
  ok(r, '① 숨이 지워져야 한다');
  if (r) {
    ok(r.buf.length === src.length, '① 길이 불변');
    ok(regionMax(r.buf, 0, 0.44) === 0, '① 숨 구간 = 0');
    ok(dataOf(r.buf).slice((0.54 * SR) * 2).equals(dataOf(src).slice((0.54 * SR) * 2)), '① 말 구간은 샘플 단위로 같다');
    ok(r.mutedSec > 0.4 && r.mutedSec < 0.54, '① 지운 길이는 숨 끝~정적 안 (' + r.mutedSec + ')');
    ok(r.levelDb < -18, '① 보고된 숨 크기는 말보다 낮다 (' + r.levelDb + ')');
  }
}
// ② 숨 없는 문장
ok(AN.muteLeadBreath(makeWav([...sil(0.2), ...speech(1.5), ...sil(0.15)])) === null, '② 숨 없으면 그대로');
// ③ 첫 낱말에 붙은 자음 진입부(ㅅ 30ms · 정적 없음)
ok(AN.muteLeadBreath(makeWav([...sil(0.19), ...noise(0.03, -36), ...speech(1.5), ...sil(0.15)])) === null, '③ 붙은 ㅅ 진입부는 그대로');
// ③-ⓑ 진입부가 숨 뒤에 있어도 진입부는 살린다
{
  const src = makeWav([...sil(0.15), ...noise(0.25, -42), ...sil(0.08), ...noise(0.03, -36), ...speech(1.2)]);
  const r = AN.muteLeadBreath(src);
  ok(r && regionMax(r.buf, 0.48, 0.51) === regionMax(src, 0.48, 0.51) && regionMax(src, 0.48, 0.51) > 0, '③-ⓑ 숨은 지우고 ㅅ 진입부는 그대로');
}
// ③-ⓒ 숨 끝에 목소리가 10ms 튀어도(「허~」 꼬리 · v0.9.21 아내 PC 컷4) 숨으로 본다
{
  const src = makeWav([...sil(0.10), ...noise(0.26, -44), ...noise(0.01, -16), ...noise(0.03, -46), ...sil(0.06), ...speech(1.5)]);
  const r = AN.muteLeadBreath(src);
  ok(r && regionMax(r.buf, 0, 0.40) === 0, '③-ⓒ 튄 꼬리까지 숨으로 지운다');
  ok(r && dataOf(r.buf).slice(Math.round(0.47 * SR) * 2).equals(dataOf(src).slice(Math.round(0.47 * SR) * 2)), '③-ⓒ 말은 그대로');
}
// ③-ⓓ 짧은 첫 음절이라도 정적 없이 이어지면 첫 낱말이다(앞 숨 없음 → 그대로)
ok(AN.muteLeadBreath(makeWav([...sil(0.2), ...speech(0.05), ...sil(0.02), ...speech(1.4)])) === null, '③-ⓓ 짧은 첫 음절 + 짧은 막힘은 그대로');
// ④ 정적 20ms(낱말 안 막힘일 수 있다)
ok(AN.muteLeadBreath(makeWav([...sil(0.2), ...noise(0.10, -38), ...sil(0.02), ...speech(1.5)])) === null, '④ 20ms 막힘 앞은 건드리지 않는다');
// ⑤ 판정력 — 숨 크기
for (const db of [-55, -48, -38, -34]) {
  const r = AN.muteLeadBreath(makeWav([...sil(0.15), ...noise(0.25, db), ...sil(0.06), ...speech(1.5)]));
  ok(r, '⑤ 숨 ' + db + 'dB 도 잡는다');
}
ok(AN.muteLeadBreath(makeWav([...sil(0.15), ...sil(0.25), ...sil(0.06), ...speech(1.5)])) === null, '⑤ 같은 꼴이라도 숨이 없으면 안 잡는다');
// 판단할 수 없는 입력은 null(fail-open)
ok(AN.muteLeadBreath(Buffer.alloc(10)) === null, '깨진 입력 = null');
ok(AN.muteLeadBreath(makeWav(sil(1))) === null, '무음 = null');

// ⑥ 배선
const prov = fs.readFileSync(path.join(__dirname, '../tts/providers/omnivoice-provider.js'), 'utf8');
ok(/muteLeadBreath\(wavBuffer\)/.test(prov), '⑥ OmniVoice provider 가 지운다');
const hasLb = (() => { const src = fs.readFileSync(path.join(__dirname, '../core/tts-cache.js'), 'utf8'); return /o\.lb = [1-9]/.test(src); })();
ok(hasLb, '⑥ 롱폼 캐시 키에 lb');
ok(TtsCache.keyFor('가', 1, { provider: 'elevenlabs', engineSig: 'x' }) !== TtsCache.keyFor('가', 1, { provider: 'elevenlabs', engineSig: 'y' }), '⑥ 유료 키 정체성 유지');
const tsv = fs.readFileSync(path.join(__dirname, '../core/tsv-tts.js'), 'utf8');
ok(/lb: [1-9]/.test(tsv), '⑥ 리모션 캐시 키에 lb');

console.log(bad ? `✗ ${bad}/${n} 실패` : `✓ 문장 앞 숨 지우기 ${n}/${n}`);
process.exit(bad ? 1 : 0);
