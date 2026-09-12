'use strict';
/**
 * tts-empty-audio.test.js — 「빈 음성(헤더만)이 .vrew 까지 흘러가 Vrew 렌더링을 멈춘 것」 회귀 방지
 *
 * 실사고(2026-09-06 · [서재_0920] 비밀의 화원 11부 컷857):
 *   OmniVoice 가 HTTP 200 으로 **44바이트 wav(샘플 0개)** 를 돌려줬는데
 *   provider 의 `Math.max(0.5, …)` 바닥값이 그걸 **0.50초짜리 정상 음성으로 위장**시켰다.
 *   → 파일 저장 → 캐시 저장 → .vrew 에 525바이트 깨진 mp3 로 embed(ffprobe 도 거부)
 *   → Vrew 렌더링이 **1339번 클립**에서 `C166/E01`(오디오 디코딩 실패)로 멈췄다.
 *
 * 🔑 테스트는 **앱 원문에서 함수를 뽑아 실제로 실행**한다. 로직을 복사해 두면 앱과 갈라져도 통과한다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

let pass = 0;
const fails = [];
function ok(cond, name) {
  if (cond) { pass++; }
  else { fails.push(name); console.log('  ❌ ' + name); }
}
function eq(a, b, name) { ok(a === b, name + ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

const ROOT = path.join(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── 테스트용 WAV 만들기 ────────────────────────────────────────────
function makeWav(samples, { sampleRate = 24000, channels = 1, bits = 16, extraChunk = null, truncateTo = null } = {}) {
  const dataSize = samples * channels * (bits / 8);
  const extra = extraChunk ? extraChunk.length : 0;
  const buf = Buffer.alloc(44 + extra + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + extra + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  let p = 12;
  if (extraChunk) { extraChunk.copy(buf, p); p += extra; }
  buf.write('fmt ', p, 'ascii');
  buf.writeUInt32LE(16, p + 4);
  buf.writeUInt16LE(1, p + 8);
  buf.writeUInt16LE(channels, p + 10);
  buf.writeUInt32LE(sampleRate, p + 12);
  buf.writeUInt32LE(sampleRate * channels * (bits / 8), p + 16);
  buf.writeUInt16LE(channels * (bits / 8), p + 20);
  buf.writeUInt16LE(bits, p + 22);
  p += 24;
  buf.write('data', p, 'ascii');
  buf.writeUInt32LE(dataSize, p + 4);
  return truncateTo == null ? buf : buf.subarray(0, truncateTo);
}
// 실사고 파일과 같은 것: RIFF 헤더 44바이트, data 크기 0
const EMPTY_44 = makeWav(0);

console.log('\n[1] measureWav — provider 원문 실행');
{
  const { measureWav, MIN_AUDIO_SEC } = require(path.join(ROOT, 'tts/providers/omnivoice-provider.js'));
  eq(EMPTY_44.length, 44, '실사고 재현 버퍼가 44바이트');
  eq(measureWav(EMPTY_44).durationSec, 0, '🔴 실사고: 헤더만(44B) → 0초');
  ok(!(measureWav(EMPTY_44).durationSec >= MIN_AUDIO_SEC), '🔴 실사고: 게이트에 걸린다');

  const one = makeWav(24000); // 1.0초
  ok(Math.abs(measureWav(one).durationSec - 1) < 1e-9, '정상 1.0초 wav → 1.0초');
  eq(measureWav(one).sampleRate, 24000, '샘플레이트 판독');

  // LIST 청크가 앞에 붙어도 data 를 찾아 정확히 잰다 (length-44 고정이면 과대 추정된다)
  const listChunk = Buffer.alloc(8 + 20);
  listChunk.write('LIST', 0, 'ascii');
  listChunk.writeUInt32LE(20, 4);
  const withList = makeWav(24000, { extraChunk: listChunk });
  ok(Math.abs(measureWav(withList).durationSec - 1) < 1e-9, 'LIST 청크가 있어도 1.0초 (length-44 고정이면 틀린다)');

  // 전송이 끊겨 헤더가 적은 크기보다 파일이 짧으면 **실제 바이트**로 잰다
  const cut = makeWav(24000, { truncateTo: 44 + 2400 }); // 0.05초분만 도착
  ok(Math.abs(measureWav(cut).durationSec - 0.05) < 1e-6, '잘린 wav → 실제 도착 바이트로 잰다');

  eq(measureWav(Buffer.from('not a wav at all!!!!')).durationSec, 0, 'WAV 가 아니면 0');
  eq(measureWav(Buffer.alloc(0)).durationSec, 0, '빈 버퍼도 안 던진다');
  eq(measureWav(null).durationSec, 0, 'null 도 안 던진다');

  const src = readSrc('tts/providers/omnivoice-provider.js');
  ok(!/Math\.max\(0\.5,\s*dataSize/.test(src), '🔴 옛 바닥값 Math.max(0.5, dataSize…) 가 사라졌다');
  ok(/빈 음성을 돌려줬습니다/.test(src) && /throw new Error/.test(src), '빈 음성이면 던진다(= 재시도가 받는다)');
  ok(/measureWav\(wavBuffer\)/.test(src), '응답 길이를 measureWav 로 잰다');
}

console.log('[2] assertRealAudio — pipeline.js 원문 실행');
{
  const src = readSrc('core/pipeline.js');
  const m = src.match(/const MIN_TTS_BYTES[\s\S]*?\nfunction assertRealAudio\(res, num\) \{[\s\S]*?\n\}/);
  ok(!!m, 'pipeline.js 에서 assertRealAudio 블록을 찾았다');
  const fn = vm.runInNewContext(m[0] + '; assertRealAudio');

  let threw = false;
  try { fn({ mp3Buffer: EMPTY_44, durationSec: 0.5 }, 857); } catch { threw = true; }
  ok(threw, '🔴 실사고 그대로(44B + 서버가 말한 0.5초) → 실패로 본다');

  threw = false;
  try { fn({ mp3Buffer: Buffer.alloc(48000), durationSec: 1.0 }, 1); } catch { threw = true; }
  ok(!threw, '정상 음성은 통과');

  threw = false;
  try { fn({ mp3Buffer: Buffer.alloc(28000), durationSec: 0.58 }, 1); } catch { threw = true; }
  ok(!threw, '실제로 가장 짧았던 0.58초 문장도 통과(오탐 없음)');

  threw = false;
  try { fn(null, 5); } catch { threw = true; }
  ok(threw, 'res 자체가 없으면 실패로 본다');

  ok(/assertRealAudio\(res, s\.num\)/.test(src), '재시도 루프 안에서 호출한다(= 3회 재시도가 받는다)');
  const loop = src.match(/for \(let attempt = 1; attempt <= 3; attempt\+\+\) \{[\s\S]*?\n    \}/);
  ok(!!loop && /assertRealAudio/.test(loop[0]), '🔑 호출 위치가 try 안(재시도 루프)이다');
}

console.log('[3] .vrew 게이트 — main.js 원문 실행');
{
  const src = readSrc('main.js');
  const m = src.match(/const MIN_TTS_FILE_BYTES[\s\S]*?\nfunction missingTtsNums\(project\) \{[\s\S]*?\n\}/);
  ok(!!m, 'main.js 에서 missingTtsNums 블록을 찾았다');
  const ctx = { fs, console };
  const fn = vm.runInNewContext(m[0] + '; missingTtsNums', ctx);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsgate-'));
  const emptyP = path.join(tmp, '857.wav');
  const goodP = path.join(tmp, '858.wav');
  fs.writeFileSync(emptyP, EMPTY_44);
  fs.writeFileSync(goodP, makeWav(24000));

  const got = fn({ sentences: [
    { num: 856, ttsAudioPath: goodP },
    { num: 857, ttsAudioPath: emptyP },        // 실사고
    { num: 858, ttsAudioPath: path.join(tmp, 'nope.wav') },  // 아예 없음
    { num: 859, ttsAudioPath: null },
  ] });
  ok(got.includes(857), '🔴 실사고: 44바이트 파일이 "있어도" 누락으로 잡힌다(= .vrew 가 막힌다)');
  ok(got.includes(858) && got.includes(859), '기존 동작(파일 없음)도 그대로 잡는다');
  ok(!got.includes(856), '정상 문장은 통과(오탐 없음)');
  fs.rmSync(tmp, { recursive: true, force: true });

  ok(/ttsFileOk\(s\.ttsAudioPath\)/.test(src), '게이트가 ttsFileOk 를 쓴다');
  ok(!/!\(s\.ttsAudioPath && fs\.existsSync\(s\.ttsAudioPath\)\)/.test(src), '옛 존재검사-only 판정이 사라졌다');
}

console.log('[4] 캐시가 빈 음성을 담지 않는다 — 실제 파일 왕복(격리 HOME)');
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ttscache-'));
  const savedHome = process.env.HOME, savedUp = process.env.USERPROFILE;
  process.env.HOME = home; process.env.USERPROFILE = home;
  const realHomedir = os.homedir;
  os.homedir = () => home;
  const cachePath = require.resolve(path.join(ROOT, 'core/tts-cache.js'));
  delete require.cache[cachePath];
  const Cache = require(cachePath);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ttssrc-'));
  const emptyP = path.join(tmp, 'empty.wav');
  const goodP = path.join(tmp, 'good.wav');
  fs.writeFileSync(emptyP, EMPTY_44);
  fs.writeFileSync(goodP, makeWav(24000));

  Cache.put('k_empty', emptyP, 0.5, 'wav');
  Cache.put('k_good', goodP, 1.0, 'wav');
  eq(Cache.get('k_empty'), null, '🔴 실사고: 빈 음성은 캐시에 안 들어간다(= 되살아나지 않는다)');
  ok(!!Cache.get('k_good'), '정상 음성은 캐시된다(회귀)');

  os.homedir = realHomedir;
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
  if (savedUp === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedUp;
  delete require.cache[cachePath];
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('[5] 소스 위생');
{
  for (const rel of ['tts/providers/omnivoice-provider.js', 'core/pipeline.js', 'main.js', 'core/tts-cache.js']) {
    const s = readSrc(rel);
    const ctrl = s.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g);
    ok(!ctrl, `${rel}: 제어문자 없음`);
  }
  ok(!/\r\n/.test(readSrc('main.js')), 'main.js 는 LF 유지(테스트가 원문을 LF 로 자른다)');
}

console.log(`\n${fails.length ? '❌' : '✅'} tts-empty-audio: ${pass}/${pass + fails.length}`);
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
