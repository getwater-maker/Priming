// 🔇 문장무음(silenceSec) — UI 값이 실제로 파일에 붙는지 원문 모듈을 그대로 돌려 확인한다.
//   🔴 2026-09-14 이전에는 이 값이 **저장만 되고 읽는 코드가 없어** 아무 효과가 없었다(고전서재 0.7 이 무효).
//   ⚠ 여기서 가장 중요한 단언은 [3] — 무음이 **배속과 독립**이어야 한다는 것.
//      apad 가 atempo 앞에 오면 0.9배속에서 1.5초가 1.67초로 늘어 값이 조용히 어긋난다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const AudioNorm = require('../core/audio-normalize');
const TtsCache = require('../core/tts-cache');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (extra ? ` (${extra})` : '')); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

function ffmpegBin() {
  let p = require('ffmpeg-static');
  if (p && p.includes('app.asar')) p = p.replace('app.asar', 'app.asar.unpacked');
  return (p && fs.existsSync(p)) ? p : null;
}
const FF = ffmpegBin();

function durOf(file) {
  const r = spawnSync(FF, ['-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /time=(\d+):(\d+):(\d+\.\d+)/g;
  let last = null, x;
  while ((x = m.exec(r.stderr || ''))) last = x;
  if (!last) return null;
  return (+last[1]) * 3600 + (+last[2]) * 60 + parseFloat(last[3]);
}

console.log('\n[1] buildFilter — apad 는 맨 끝(atempo 뒤)이어야 한다');
{
  const f = AudioNorm.buildFilter(0.9, 0, 1.5);
  ok(/apad=pad_dur=1\.5/.test(f), 'apad 가 생성된다', f);
  ok(f.indexOf('atempo') < f.indexOf('apad'), '🔑 atempo 가 apad 보다 앞이다', f);
  const f2 = AudioNorm.buildFilter(0.9, 3, 1.5);
  ok(f2.indexOf('volume') < f2.indexOf('apad'), 'volume 도 apad 보다 앞이다', f2);
  ok(AudioNorm.buildFilter(1, 0, 0) === null, 'padSec 0 · 배속 1 · 게인 0 이면 필터 없음(기존 동작)');
  ok(/apad/.test(AudioNorm.buildFilter(1, 0, 2)) === true, '배속·게인이 없어도 무음만으로 필터가 생긴다');
  ok(!/apad/.test(AudioNorm.buildFilter(1.15, 0, 0) || ''), 'padSec 0 이면 apad 가 안 붙는다(회귀)');
}

if (!FF) {
  console.log('\n⚠ ffmpeg 없음 — 실제 왕복 검사를 건너뜁니다');
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'silence-'));
  const src = path.join(tmp, 'src.wav');
  spawnSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '24000', '-ac', '1', '-codec:a', 'pcm_s16le', src], { stdio: 'ignore' });
  const base = durOf(src);
  console.log(`\n[2] 실제 ffmpeg 왕복 — 원본 ${base.toFixed(3)}초`);
  {
    const out = path.join(tmp, 'pad.wav');
    const filt = AudioNorm.buildFilter(1, 0, 1.5);
    spawnSync(FF, ['-y', '-i', src, '-filter:a', filt, '-codec:a', 'pcm_s16le', '-ar', '24000', '-ac', '1', out], { stdio: 'ignore' });
    const d = durOf(out);
    ok(d != null && near(d, base + 1.5, 0.06), `무음 1.5초가 실제로 붙는다 (${base.toFixed(2)} → ${d && d.toFixed(2)})`);
  }
  console.log('\n[3] 🔑 무음은 배속과 독립이어야 한다 (apad 가 atempo 뒤이므로)');
  {
    const out = path.join(tmp, 'slow.wav');
    const filt = AudioNorm.buildFilter(0.9, 0, 1.5);
    spawnSync(FF, ['-y', '-i', src, '-filter:a', filt, '-codec:a', 'pcm_s16le', '-ar', '24000', '-ac', '1', out], { stdio: 'ignore' });
    const d = durOf(out);
    const expectAfter = base / 0.9 + 1.5;        // 올바른 순서(apad 가 뒤)
    const expectBefore = (base + 1.5) / 0.9;     // 틀린 순서(apad 가 앞) — 0.19초 더 길다
    ok(d != null && near(d, expectAfter, 0.08), `0.9배속 + 무음 1.5초 = 원본/0.9 + 1.5 (기대 ${expectAfter.toFixed(2)} · 실제 ${d && d.toFixed(2)})`);
    ok(d != null && !near(d, expectBefore, 0.05), `🔑 배속에 눌린 값(${expectBefore.toFixed(2)})이 아니다 — 순서가 맞다`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n[4] 캐시 키 — 무음이 정체성에 포함돼야 한다');
{
  const b = { provider: 'omnivoice', refName: 'v1', normDb: -15 };
  const k0 = TtsCache.keyFor('안녕하세요', 1, { ...b, padSec: 0 });
  const k7 = TtsCache.keyFor('안녕하세요', 1, { ...b, padSec: 0.7 });
  const k15 = TtsCache.keyFor('안녕하세요', 1, { ...b, padSec: 1.5 });
  ok(k0 !== k7, '🔑 무음 0 과 0.7 은 다른 키다 — 값을 바꾸면 옛 간격이 되살아나지 않는다');
  ok(k7 !== k15, '0.7 과 1.5 도 다른 키다');
  ok(k7 === TtsCache.keyFor('안녕하세요', 1, { ...b, padSec: 0.7 }), '같은 값이면 같은 키다(재활용은 그대로)');
  ok(k0 === TtsCache.keyFor('안녕하세요', 1, b), 'padSec 을 안 넘기면 0 과 같은 키다');
  ok(!/"pd"/.test(JSON.stringify({})) && k0 === TtsCache.keyFor('안녕하세요', 1, { ...b, padSec: null }), 'null 도 0 과 같은 키');
  const CACHE_SRC = fs.readFileSync(path.join(__dirname, '..', 'core', 'tts-cache.js'), 'utf8');
  ok(CACHE_SRC.includes('if (isFinite(pd) && pd > 0) o.pd = pd;'), '🔑 무음 0 이면 키에 필드를 넣지 않는다 — 기존 캐시 2만여 개가 그대로 산다');
}

console.log('\n[5] 배선 — 원문 대조');
{
  const PIPE = fs.readFileSync(path.join(__dirname, '..', 'core', 'pipeline.js'), 'utf8');
  ok(/const padSec = \(\(\) => \{ const v = Number\(preset && preset\.silenceSec\)/.test(PIPE), 'pipeline 이 preset.silenceSec 을 읽는다');
  ok(/needFfmpeg = \(sf !== 1\) \|\| gainDb !== 0 \|\| padSec > 0/.test(PIPE), '배속·게인이 없어도 무음이 있으면 ffmpeg 를 탄다');
  ok(/encodeTts\(wavTmp, out, sf, gainDb, toMp3, padSec\)/.test(PIPE), 'encodeTts 에 padSec 을 넘긴다');
  ok(/res\.durationSec \/ sf \+ padSec/.test(PIPE), '🔑 ttsDurationSec 에 무음이 더해진다(타임라인·챕터·SRT 의 근거)');
  ok(/normDb: normTarget, padSec \}/.test(PIPE), '캐시 키에 padSec 이 들어간다');
  ok(/Math\.min\(v, 5\)/.test(PIPE), '상한 5초 — 오타로 50 을 넣어도 영상이 망가지지 않는다');
  const CACHE = fs.readFileSync(path.join(__dirname, '..', 'core', 'tts-cache.js'), 'utf8');
  ok(CACHE.includes('o.pd = pd'), 'keyFor 가 pd 를 서명에 넣는다(0 이면 생략)');
  const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  ok(/문장무음 \$\{Number\(preset\.silenceSec\)\}초/.test(MAIN), '1단계 로그에 실제 적용값이 찍힌다');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} tts-silence: ${pass}/${pass + fail} 통과`);
process.exit(fail === 0 ? 0 : 1);
