'use strict';
/**
 * node test/word-delete.test.js — 🗑 단어 지우기(Lab · 차이표 #11): 글에서 어절 빼기 · 음성에서 소리 들어내기 · 파일 자르기
 *   [1] tokenRange · textWithout — 가운데·처음·끝 어절 · 문장 끝 부호 지키기 · 문장 전체는 거부
 *   [2] cutWords — 지운 만큼만 짧아짐 · 남는 소리는 그대로(페이드 구간만 다름) · 이은 자리가 조용함 · 앞뒤 여백(문장무음)은 남김
 *   [3] deleteWordsAudio — 새 파일 · 원본은 그대로 · mp3 도 읽음
 *   [4] 정렬 → 지우기 → 다시 정렬: 남은 어절의 경계가 지운 길이만큼 당겨져 있다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const WA = require('../core/word-align');
const PASS = require('../core/word-align-pass');
const QT = require('../core/quiet-trim');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

console.log('[1] 글에서 어절 빼기');
const T = '집 명의나 이사 계획은, 가족이 함께 알아야 하는 일이라, 자녀분과 이야기해 보세요.';
const toks = WA.tokenize(T);
ok(JSON.stringify(WA.tokenRange(T, 3, 6)) === JSON.stringify({ j0: 1, j1: 2, n: toks.length }), '글 범위 → 어절 번호 (「명의나」 = 1)');
ok(WA.tokenRange(T, 3, 7).j0 === 1 && WA.tokenRange(T, 3, 7).j1 === 3 && WA.tokenRange(T, 3, 12).j1 === 4, '범위가 여러 어절에 걸치면 전부(명의나·이사 · 명의나·이사·계획은,)');
ok(WA.tokenRange(T, 1, 2) === null || WA.tokenRange(T, 1, 2).j0 === 0, '공백만 고르면 앞 어절에 걸친다(또는 없음)');
ok(WA.textWithout(T, 1, 2) === '집 이사 계획은, 가족이 함께 알아야 하는 일이라, 자녀분과 이야기해 보세요.', '가운데 어절: 공백 하나로 이어진다');
ok(WA.textWithout(T, 0, 2) === '이사 계획은, 가족이 함께 알아야 하는 일이라, 자녀분과 이야기해 보세요.', '처음 어절들: 앞 공백이 남지 않는다');
ok(WA.textWithout(T, toks.length - 1, toks.length) === '집 명의나 이사 계획은, 가족이 함께 알아야 하는 일이라, 자녀분과 이야기해.', '마지막 어절을 지워도 문장 끝 부호(.)는 남는다 — 안 그러면 .md 에서 다음 문장과 합쳐진다');
ok(WA.textWithout('하나 둘 "셋."', 2, 3) === '하나 둘.' || WA.textWithout('하나 둘 "셋."', 2, 3) === '하나 둘."', '따옴표로 닫힌 끝 어절도 부호를 지킨다 (' + WA.textWithout('하나 둘 "셋."', 2, 3) + ')');
ok(WA.textWithout(T, 0, toks.length) === null && WA.textWithout('하나 둘.', 0, 2) === null, '문장 전체는 지우지 않는다(null)');
ok(WA.textWithout(T, 5, 5) === null && WA.textWithout(T, -1, 2) === null && WA.textWithout(T, 2, 99) === null, '범위 오류는 null');
{ const t2 = WA.textWithout(T, 4, 6); ok(WA.tokenize(t2).length === toks.length - 2 && !/\s{2,}/.test(t2), '두 어절 지우기: 어절 수가 둘 줄고 공백이 겹치지 않는다'); }

console.log('\n[2] 음성에서 소리 들어내기');
const R = 24000;
let _seed = 4242; const _rnd = () => (_seed = (_seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
function synth(bursts, gaps, lead, tail) {
  _seed = 4242;
  const sil = (sec) => { const a = new Int16Array(Math.round(sec * R)); for (let i = 0; i < a.length; i++) a[i] = Math.round((_rnd() - 0.5) * 4); return a; };
  const burst = (sec, f) => { const a = new Int16Array(Math.round(sec * R)); for (let i = 0; i < a.length; i++) { const e = Math.min(1, i / 120, (a.length - i) / 120); a[i] = Math.round(12000 * e * Math.sin(2 * Math.PI * f * i / R)); } return a; };
  const parts = [sil(lead)];
  bursts.forEach((b, i) => { parts.push(burst(b, 200 + i * 40)); if (i < bursts.length - 1) parts.push(sil(gaps[i])); });
  parts.push(sil(tail));
  const out = new Int16Array(parts.reduce((m, p) => m + p.length, 0)); let w = 0; for (const p of parts) { out.set(p, w); w += p.length; }
  return out;
}
const text = '하나둘 셋넷다섯, 여섯일곱 여덟아홉열 열하나둘.';
const tk = WA.tokenize(text);
const bursts = [0.30, 0.55, 0.40, 0.45, 0.50], gaps = [0.04, 0.40, 0.04, 0.04];
const pcm = synth(bursts, gaps, 0.20, 0.95);   // 앞 0.2 · 끝 0.95(문장무음 0.8 + 0.15)
const dur = pcm.length / R;
const b = WA.alignBounds(pcm, R, tk, dur);
ok(!!b && b.length === 6, '정렬 먼저');
const energy = (a, s0, s1) => { let m = 0; for (let i = s0; i < s1; i++) m = Math.max(m, Math.abs(a[i])); return m; };
// 가운데 어절(2번 = 「여섯일곱」) 지우기
{
  const c = WA.cutWords(pcm, R, b, 2, 3);
  ok(c && Math.abs(c.removedSec - (b[3] - b[2])) < 0.002 && c.pcm.length === pcm.length - Math.round(c.removedSec * R), `지운 만큼만 짧아진다 (${c.removedSec.toFixed(3)}초 = 경계 ${b[2].toFixed(3)}~${b[3].toFixed(3)})`);
  const s0 = Math.round(c.cut[0] * R), s1 = Math.round(c.cut[1] * R), xf = Math.round(R * 0.008);
  let same = true; for (let i = 0; i < s0 - xf; i += 7) if (c.pcm[i] !== pcm[i]) { same = false; break; }
  for (let i = s0 + xf; i < c.pcm.length; i += 7) if (c.pcm[i] !== pcm[i + (s1 - s0)]) { same = false; break; }
  ok(same, '남는 소리는 한 샘플도 안 바뀐다(이은 자리 8ms 페이드 밖)');
  ok(energy(c.pcm, s0 - 40, s0 + 40) < 3000, `이은 자리가 조용하다 (최대 진폭 ${energy(c.pcm, s0 - 40, s0 + 40)} — 말 12000 의 1/4 미만)`);
  ok(energy(pcm, Math.round(b[2] * R) + 200, Math.round(b[3] * R) - 200) > 8000, '판정력: 지운 구간 안에는 실제로 말소리가 있었다');
  // 지운 뒤 다시 정렬 — 쉼표 뒤 0.40초 쉼의 절반(1.09~1.29)과 틈 조각만 남아 경계는 그 남은 쉼 안(≈1.20)에 놓이고, 그 뒤 경계는 지운 길이만큼 당겨진다
  const rb = WA.alignBounds(c.pcm, R, WA.tokenize(WA.textWithout(text, 2, 3)), c.pcm.length / R);
  ok(rb && rb.length === 5 && Math.abs(rb[1] - b[1]) < 0.03 && rb[2] >= 1.09 && rb[2] <= 1.32 && Math.abs(rb[3] - (b[4] - c.removedSec)) < 0.06, `지운 뒤 다시 정렬: 앞 경계는 그대로 · 이은 자리는 남은 쉼 안 · 뒤 경계는 지운 길이만큼 당겨진다 (${rb && rb.slice(1, 4).map((x) => x.toFixed(2)).join(' · ')} ← 기대 ${b[1].toFixed(2)} · 1.09~1.32 · ${(b[4] - c.removedSec).toFixed(2)})`);
}
// 처음 어절 지우기 — 앞 여백(0.2초)은 남긴다
{
  const c = WA.cutWords(pcm, R, b, 0, 1);
  ok(c && c.cut[0] >= 0.15 && c.cut[0] <= 0.25, `처음 어절: 앞 여백을 남긴다 (자른 시작 ${c && c.cut[0].toFixed(3)}초 ≈ 소리 시작 0.20)`);
  ok(c && energy(c.pcm, 0, Math.round(0.15 * R)) < 100, '지운 뒤 처음 0.15초는 여전히 조용하다');
}
// 마지막 어절 지우기 — 끝 여백(문장무음 포함)은 남긴다
{
  const c = WA.cutWords(pcm, R, b, 4, 5);
  const tailOrig = dur - (0.20 + bursts.reduce((a, x) => a + x, 0) + gaps.reduce((a, x) => a + x, 0));
  const tailNew = c.pcm.length / R - (c.cut[0]);
  ok(c && Math.abs(tailNew - tailOrig) < 0.06, `마지막 어절: 끝 여백(문장무음 0.8 포함 ${tailOrig.toFixed(2)}초)을 그대로 남긴다 (${tailNew.toFixed(2)}초)`);
}
ok(WA.cutWords(pcm, R, b, 0, 5) === null && WA.cutWords(pcm, R, b, 2, 2) === null && WA.cutWords(pcm, R, b, 3, 9) === null, '문장 전체 · 빈 범위 · 범위 오류는 null');

console.log('\n[3] 파일 자르기');
const D = fs.mkdtempSync(path.join(os.tmpdir(), 'wdel-'));
(async () => {
  const src = path.join(D, '7.wav'); fs.writeFileSync(src, QT.wavOf(pcm, R));
  const before = fs.readFileSync(src);
  const out = path.join(D, '7_dabc.wav');
  const r = await PASS.deleteWordsAudio({ src, bounds: b, j0: 2, j1: 3, outPath: out });
  const wr = PASS.readWavPcm(out);
  ok(r.ok && fs.existsSync(out) && wr && Math.abs(wr.pcm.length / R - r.dur) < 1e-6 && Math.abs(r.dur - (dur - (b[3] - b[2]))) < 0.002, `새 파일에 지운 소리가 빠졌다 (${dur.toFixed(2)} → ${r.dur.toFixed(2)}초)`);
  ok(Buffer.compare(fs.readFileSync(src), before) === 0 && !fs.existsSync(out + '.tmp'), '원본 음성은 그대로 · 임시 파일 안 남음(Ctrl+Z 가 옛 소리로)');
  const FF = require('../core/media-utils').getFfmpegPath();
  const mp3 = path.join(D, '8.mp3'); execFileSync(FF, ['-y', '-loglevel', 'error', '-i', src, '-c:a', 'libmp3lame', mp3]);
  const out2 = path.join(D, '8_dxyz.wav');
  const r2 = await PASS.deleteWordsAudio({ src: mp3, bounds: b, j0: 1, j1: 2, outPath: out2, ffmpegPath: FF });
  ok(r2.ok && Math.abs(r2.dur - (dur - (b[2] - b[1]))) < 0.1, `mp3(배속 사본)도 ffmpeg 로 읽어 자른다 (${r2.dur && r2.dur.toFixed(2)}초)`);
  const bad = await PASS.deleteWordsAudio({ src: path.join(D, 'none.wav'), bounds: b, j0: 1, j1: 2, outPath: path.join(D, 'x.wav') });
  ok(!bad.ok && /읽지 못/.test(bad.error), '음성 파일이 없으면 이유를 말하고 멈춘다');
  const all = await PASS.deleteWordsAudio({ src, bounds: b, j0: 0, j1: 5, outPath: path.join(D, 'y.wav') });
  ok(!all.ok && !fs.existsSync(path.join(D, 'y.wav')), '문장 전체는 파일을 만들지 않는다');
  try { fs.rmSync(D, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} 통과 · ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
