'use strict';
/**
 * node test/tts-audible.test.js — 🔊 「변환 완료인데 소리가 안 들린다」 · 「고쳐서 다시 만들어도 같은 소리」 (로이 2026-09-30 · v0.5.93)
 *   ① 길이는 정상인데 소리가 없는 음성(무음)은 빈 음성으로 보고 시드를 바꿔 다시 만든다 (fillTtsList 원문)
 *   ② 이어받은 작업본의 음성 파일이 실제로 있는지 확인한다(main.js verifyRestoredAudio 원문 · 실제 파일)
 *      · 경로가 달라도 출력 폴더 tts-N 의 같은 이름 파일이 있으면 다시 잇고, 없으면 「변환 안 됨」으로, 폴더째 안 보이면 지우지 않는다
 *   ③ 고친 문장을 다시 만들면 **새 문장을 읽는다**(재생성은 정상) — 같은 시드라 거의 같게 들리는 것이므로 「새로 뽑기」를 눈에 보이게
 */
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsaud-'));
const realHome = os.homedir; os.homedir = () => home;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
for (const m of ['core/tts-cache.js', 'core/media-cache.js', 'core/pipeline.js']) { try { delete require.cache[require.resolve(path.join(ROOT, m))]; } catch {} }
const P = require('../core/pipeline');
const AN = require('../core/audio-normalize');

function wav(sec, amp) {
  const n = Math.round(24000 * sec), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8, 'ascii'); b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36, 'ascii'); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(amp ? Math.round(Math.sin(i / 8) * amp) : 0, 44 + i * 2);
  return b;
}

(async () => {
  console.log('\n[1] 무음 판정(audio-normalize.isSilentWav)');
  {
    ok(AN.isSilentWav(wav(1.0, 0)) === true, '1초짜리 완전 무음 → 무음');
    ok(AN.isSilentWav(wav(1.0, 6000)) === false, '보통 크기의 소리 → 무음 아님');
    ok(AN.isSilentWav(wav(1.0, 200)) === false, '작은 소리(피크 200 ≈ -44dB)도 무음 아님 — 작은 목소리를 잘못 버리지 않는다');
    ok(AN.isSilentWav(wav(0.1, 0)) === false, '0.3초 미만은 판단하지 않는다(fail-open)');
    ok(AN.isSilentWav(Buffer.from('ID3....mp3data....')) === false, 'WAV 가 아니면 판단하지 않는다(fail-open)');
    const tail = wav(2.0, 0); for (let i = 0; i < 400; i++) tail.writeInt16LE(9000, 44 + 60000 + i * 2);
    ok(AN.isSilentWav(tail) === false, '대부분 무음이어도 소리가 조금이라도 있으면 무음 아님');
  }

  console.log('\n[2] 무음이 돌아오면 시드를 바꿔 다시 만든다(fillTtsList 원문)');
  {
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsaud-w-'));
    const seeds = []; let calls = 0;
    const mgr = { processText: (t) => t, prepareDict: async () => {}, synthesize: async (t, o) => { calls++; seeds.push(o && o.seed); return calls <= 2 ? { mp3Buffer: wav(1.0, 0), durationSec: 1.0, format: 'wav' } : { mp3Buffer: wav(1.0, 7000), durationSec: 1.0, format: 'wav' }; } };
    const lines = [];
    const sents = [{ num: 1, text: '소리 없이 돌아오는 문장입니다.' }];
    const r = await P.fillTtsList(sents, { voiceCloneRefAudio: 'srv:t', seed: 100, language: 'ko', ttsNormalize: false }, mgr, wd, (m) => lines.push(m), null, 1, '테스트', null, true);
    ok(r.failed.length === 0 && sents[0].ttsAudioPath && fs.existsSync(sents[0].ttsAudioPath), '결국 소리 있는 음성으로 만들어졌다');
    ok(calls === 3 && new Set(seeds).size === 3, `무음 2번 → 시드를 갈아 3번째에 성공 (시드 ${seeds.join(', ')})`);
    ok(lines.some((m) => /컷1 무음 음성\(1\/6\) — 시드를 \d+ 로 바꿔 다시 만듭니다/.test(m)), '로그에 「무음 음성」으로 남는다');
    ok(!AN.isSilentWav(fs.readFileSync(sents[0].ttsAudioPath)) || /\.mp3$/.test(sents[0].ttsAudioPath), '저장된 파일은 무음이 아니다');
    // 판정력: 가드를 빼면(옛 동작) 무음이 그대로 저장된다
    const src = read('core/pipeline.js').replace('if (AudioNorm.isSilentWav(res.mp3Buffer)) {', 'if (false) {');
    const Module = require('module'); const mod = new Module(path.join(ROOT, 'core', 'pipeline.js'), module);
    mod.filename = path.join(ROOT, 'core', 'pipeline.js'); mod.paths = Module._nodeModulePaths(path.join(ROOT, 'core')); mod._compile(src, mod.filename);
    const wd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsaud-w2-'));
    const s2 = [{ num: 1, text: '옛 동작 확인용 문장입니다.' }];
    const mgr2 = { processText: (t) => t, prepareDict: async () => {}, synthesize: async () => ({ mp3Buffer: wav(1.0, 0), durationSec: 1.0, format: 'wav' }) };
    await mod.exports.fillTtsList(s2, { voiceCloneRefAudio: 'srv:t', seed: 1, language: 'ko', ttsNormalize: false }, mgr2, wd2, () => {}, null, 1, '테스트', null, true);
    ok(s2[0].ttsAudioPath && AN.isSilentWav(fs.readFileSync(s2[0].ttsAudioPath)), '(A/B) 가드를 빼면 무음 파일이 「변환 완료」로 저장된다 — 위 검사는 헛단언이 아니다');
    fs.rmSync(wd, { recursive: true, force: true }); fs.rmSync(wd2, { recursive: true, force: true });
  }

  console.log('\n[3] 이어받은 작업본의 음성 확인(verifyRestoredAudio 원문 · 실제 파일)');
  {
    const M = read('main.js');
    const i0 = M.indexOf('async function verifyRestoredAudio('), i1 = M.indexOf('\n}\n', i0) + 3;
    ok(i0 > 0, 'verifyRestoredAudio 를 찾았다');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsaud-out-'));
    const tts = path.join(out, 'tts-1'); fs.mkdirSync(tts);
    const good = path.join(tts, '1.wav'); fs.writeFileSync(good, wav(1.0, 5000));
    const moved = path.join(tts, '2.wav'); fs.writeFileSync(moved, wav(1.0, 5000));           // 저장된 경로는 다른 드라이브 글자
    const tiny = path.join(tts, '4.wav'); fs.writeFileSync(tiny, Buffer.alloc(44));            // 헤더만(빈 음성)
    const mk = (n, p) => ({ num: n, text: '문장' + n, ttsAudioPath: p, ttsDurationSec: 2 });
    const pr = { shortsNum: 1, sentences: [mk(1, good), mk(2, 'Z:\\옛드라이브\\tts-1\\2.wav'), mk(3, path.join(tts, '3.wav')), mk(4, tiny), { num: 5, text: '음성 없는 문장', ttsAudioPath: null }] };
    const logs = []; let pushed = 0;
    const parsed = { projects: [pr] };
    const ctx = { fs, path, S: { parsed, outRoot: out }, log: (m) => logs.push(m), storeActive: () => {}, pushDtoUpdate: () => { pushed++; }, MIN_TTS_FILE_BYTES: 1200 };
    vm.createContext(ctx); vm.runInContext(M.slice(i0, i1) + '\nthis.fn = verifyRestoredAudio;', ctx);
    const r = await ctx.fn(parsed, out);
    ok(pr.sentences[0].ttsAudioPath === good, '멀쩡한 음성은 그대로');
    ok(pr.sentences[1].ttsAudioPath === moved && r.relinked === 1, '🔑 경로가 달라도(다른 드라이브 글자) 출력 폴더 tts-1 의 같은 이름 파일로 다시 이었다');
    ok(pr.sentences[2].ttsAudioPath === null && pr.sentences[2].ttsDurationSec === null, '🔑 파일이 없으면 「변환 안 됨」으로 되돌렸다(예전엔 「변환됨」으로 보이는데 소리가 안 났다)');
    ok(pr.sentences[3].ttsAudioPath === null, '헤더만 있는 빈 파일도 없는 것으로');
    ok(r.missing === 2 && r.relinked === 1 && pushed === 1, `요약: 없음 ${r.missing} · 다시 이음 ${r.relinked} · 화면 갱신 1번`);
    ok(logs.some((m) => /파일이 없어 「변환 안 됨」으로 되돌렸습니다/.test(m)) && logs.some((m) => /경로가 달라/.test(m)), '로그로 알린다(몇 개 · 예시 경로 · 해야 할 일)');
    // 폴더째 안 보이면(구글드라이브가 안 열림) 지우지 않는다
    const pr2 = { shortsNum: 1, sentences: [mk(1, 'Q:\\닫힌드라이브\\tts-1\\x1.wav'), mk(2, 'Q:\\닫힌드라이브\\tts-1\\x2.wav')] };
    const logs2 = []; ctx.log = (m) => logs2.push(m); ctx.S.parsed = { projects: [pr2] };
    const r2 = await ctx.fn(ctx.S.parsed, path.join(out, '없는폴더'));
    ok(r2.unreachable === 2 && pr2.sentences.every((s) => s.ttsAudioPath), '🔑 폴더째 안 보이면(드라이브 미연결) 음성 연결을 지우지 않는다 — 드라이브가 열린 뒤 다시 열면 된다');
    ok(logs2.some((m) => /접근할 수 없어/.test(m)), '그 경우 이유를 로그로 알린다');
    // 이어받기 경로에서만 호출 · 비동기(열기를 막지 않는다)
    ok(/if \(restoreNote && \/작업본 이어받기\/\.test\(restoreNote\)\) verifyRestoredAudio\(S\.parsed, S\.outRoot\)\.catch/.test(M), '「♻ 작업본 이어받기」로 열 때만, 기다리지 않고 부른다');
    fs.rmSync(out, { recursive: true, force: true });
  }

  console.log('\n[4] 고친 문장 다시 만들기 — 새 문장을 읽고, 「새로 뽑기」가 눈에 보인다');
  {
    const M = read('main.js'), APP = read('renderer/src/App.jsx');
    ok(/data-testid="mn-tts-roll"/.test(APP) && /🎲 이 그룹 새로 뽑기/.test(APP) && /grp\.onGroupTts\(sn, c\.num, true\)/.test(APP), '그룹 메뉴에 「🎲 이 그룹 새로 뽑기 (다른 톤)」이 보인다(예전엔 Shift+클릭뿐이라 숨어 있었다)');
    ok(/그룹 메뉴의 🎲/.test(APP), '🎤 버튼 설명이 🎲 를 알려 준다');
    ok(/if \(!roll\) log\(`ℹ G\$\{groupNum\} 는 채널 시드/.test(M), '같은 시드로 다시 만들면 왜 비슷하게 들리는지·어떻게 바꾸는지 로그로 알린다');
    // 같은 시드 = 같은 소리(결정적) · 시드가 다르면 다른 소리 — 가짜 서버로 확인
    const seen = [];
    const mgr = { processText: (t) => t, prepareDict: async () => {}, synthesize: async (t, o) => { seen.push({ t, seed: o && o.seed }); return { mp3Buffer: wav(1.0, 3000 + (o && o.seed % 7) * 500), durationSec: 1.0, format: 'wav' }; } };
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsaud-r-'));
    const s = [{ num: 1, text: '새로 고친 문장입니다.' }];
    await P.fillTtsList(s, { voiceCloneRefAudio: 'srv:t', seed: 5697, language: 'ko', ttsNormalize: false }, mgr, wd, () => {}, null, 1, 't', null, true);
    ok(seen.length === 1 && seen[0].t === '새로 고친 문장입니다.' && seen[0].seed === 5697, '재생성은 **지금 문장 글**을 채널 시드로 서버에 보낸다(옛 문장이 아니다)');
    fs.rmSync(wd, { recursive: true, force: true });
  }

  os.homedir = realHome;
  try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  console.log(`\n${fail ? '❌' : '✅'} tts-audible ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
