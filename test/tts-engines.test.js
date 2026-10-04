'use strict';
/**
 * tts-engines.test.js — 🔊 음성 엔진(헤더 팝업 · v0.6.67) 회귀
 *
 *  [1] 엔진 해석 — OmniVoice 면 채널 엔진 그대로 · 유료를 고르면 그 엔진 · 모르는 값은 omnivoice
 *  [2] 캐시 키 — OmniVoice 는 옛 키 그대로(engineSig 없음) · 유료는 목소리·모델마다 다른 키
 *  [3] 요청 모양 — MAI SSML(이스케이프·locale) · 타입캐스트(ISO 639-3) · ElevenLabs(language_code 는 받는 모델만)
 *  [4] provider 실행(fetch 가짜) — WAV/PCM → WAV 결과 · 오류는 사람 말 · 빈 음성은 emptyAudio · Gemini 3.8 Interactions 파싱
 *  [5] 파이프라인 — 유료 엔진이면 참조음성 대신 엔진 인자 · OmniVoice 면 인자가 옛것과 같다
 *  [6] 화면 — 옛 「출력」·「Vrew 음성」·「다시 연결」 버튼이 사라지고 🔊 버튼이 그 자리에
 *
 * 🔑 사용자 폴더를 임시 폴더로 돌려 로이의 설정·키·캐시를 건드리지 않는다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ttseng-'));
process.env.USERPROFILE = TMP; process.env.HOME = TMP;   // os.homedir() → 임시(require 전에!)
const ROOT = path.join(__dirname, '..');

let pass = 0; const fails = [];
const ok = (c, n) => { if (c) pass++; else { fails.push(n); console.log('  ❌ ' + n); } };
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), `${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

function makeWav(samples, sr = 24000) {
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 8) * 6000), i * 2);
  return require(path.join(ROOT, 'tts/providers/audio-util')).pcmToWav(pcm, sr);
}

(async () => {
  ok(require('os').homedir() === TMP, '사용자 폴더가 임시 폴더로 돌려졌다');
  const TE = require(path.join(ROOT, 'tts/tts-engines'));
  const SecretStore = require(path.join(ROOT, 'tts/secret-store'));
  ok(TE.CFG_PATH.startsWith(TMP), '설정 파일이 임시 폴더 아래');

  console.log('\n[1] 엔진 해석');
  eq(TE.active(), 'omnivoice', '설정 없음 → omnivoice');
  eq(TE.resolveEngine('omnivoice'), 'omnivoice', 'OmniVoice → 채널 엔진 그대로');
  eq(TE.resolveEngine('gemini'), 'gemini', 'OmniVoice 고름 + 옛 gemini 채널 → gemini 그대로');
  eq(TE.synthExtra('omnivoice'), null, 'OmniVoice 는 엔진 인자 없음');
  TE.save({ active: 'typecast', typecast: { voice: 'tc_abc', model: 'ssfm-v30', emotion: 'sad' } });
  eq(TE.resolveEngine('omnivoice'), 'typecast', '유료를 고르면 채널 엔진보다 우선');
  const x = TE.synthExtra('typecast');
  eq([x.model, x.voice, x.emotion], ['ssfm-v30', 'tc_abc', 'sad'], '타입캐스트 인자');
  ok(typeof x.engineSig === 'string' && x.engineSig.includes('tc_abc'), 'engineSig 에 목소리가 들어간다');
  TE.save({ active: 'nope' });
  eq(TE.active(), 'omnivoice', '모르는 엔진 값 → omnivoice 로 저장');
  eq(TE.engineCfg('mai').region, 'eastasia', 'MAI 지역 기본값');
  eq(TE.engineCfg('mai').model, 'MAI-Voice-2.1', 'MAI 모델 기본값 = 2.1');
  eq(TE.engineCfg('gemini').model, 'gemini-3.8-flash-tts', 'Gemini 모델 기본값 = 3.8');
  TE.save({ active: 'omnivoice', elevenlabs: { model: 'eleven_bogus' } });
  eq(TE.engineCfg('elevenlabs').model, 'eleven_v3', '목록에 없는 모델 → 첫 모델');
  SecretStore.set('typecast', { key: 'tc-secret-1234' });
  eq(TE.keyInfo(SecretStore).typecast, { has: true, tail: '1234' }, '키 정보 = 끝 4자리만');
  ok(!JSON.stringify(TE.keyInfo(SecretStore)).includes('tc-secret'), '키 원문은 내보내지 않는다');

  console.log('\n[2] 캐시 키');
  const Cache = require(path.join(ROOT, 'core/tts-cache'));
  const omni = { provider: 'omnivoice', refName: 'A', seed: 1, language: 'ko', normDb: -15 };
  const k0 = Cache.keyFor('안녕', 1.15, omni);
  eq(Cache.keyFor('안녕', 1.15, { ...omni, engineSig: undefined }), k0, 'engineSig 없으면 키 불변(OmniVoice 캐시 보존)');
  const kA = Cache.keyFor('안녕', 1.15, { provider: 'typecast', engineSig: '{"v":"tc_a"}' });
  const kB = Cache.keyFor('안녕', 1.15, { provider: 'typecast', engineSig: '{"v":"tc_b"}' });
  ok(kA !== kB, '목소리가 다르면 키가 다르다');
  ok(kA !== k0, '엔진이 다르면 키가 다르다');

  console.log('\n[3] 요청 모양');
  const MAI = require(path.join(ROOT, 'tts/providers/mai-provider'));
  const ssml = MAI.buildSsml('A & B <c> "d"', { voice: 'ko-KR-Junho', model: 'MAI-Voice-2.1', style: 'narrator' });
  ok(ssml.includes('<voice name="ko-KR-Junho:MAI-Voice-2.1">'), 'SSML 목소리 = id:모델');
  ok(ssml.includes('xml:lang="ko-KR"'), 'SSML locale = 목소리 앞부분');
  ok(ssml.includes('A &amp; B &lt;c&gt; &quot;d&quot;'), 'SSML 본문 이스케이프');
  ok(ssml.includes('<mstts:express-as style="narrator">'), '말투(style) 적용');
  ok(!MAI.buildSsml('x', { voice: 'ko-KR-Junho', model: 'M' }).includes('express-as'), '말투 없으면 express-as 없음');
  eq(MAI.localeOf('vi-VN-Harper'), 'vi-VN', '베트남어 locale');
  const TC = require(path.join(ROOT, 'tts/providers/typecast-provider'));
  const tb = TC.buildBody('안녕', { voice: 'tc_x', model: 'ssfm-v30', language: 'ko', emotion: 'happy' });
  eq([tb.voice_id, tb.language, tb.output.audio_format, tb.prompt.emotion_type, tb.prompt.emotion_preset], ['tc_x', 'kor', 'wav', 'preset', 'happy'], '타입캐스트 본문');
  eq(TC.buildBody('x', { voice: 'tc', model: 'ssfm-v21' }).prompt.emotion_type, undefined, 'v21 은 emotion_type 없음');
  eq(TC.buildBody('x', { voice: 'tc', language: 'ja' }).language, 'jpn', '일본어 = jpn');
  const EL = require(path.join(ROOT, 'tts/providers/elevenlabs-provider'));
  const eb = EL.buildBody('안녕', { model: 'eleven_v3', language: 'ko', seed: 12345, stability: 0.4 });
  eq([eb.model_id, eb.language_code, eb.seed, eb.voice_settings.stability], ['eleven_v3', 'ko', 12345, 0.4], 'ElevenLabs 본문');
  eq(EL.buildBody('x', { model: 'eleven_multilingual_v2', language: 'ko' }).language_code, undefined, 'multilingual_v2 엔 language_code 를 보내지 않는다(400)');
  eq(EL.buildBody('x', { model: 'eleven_v3' }).voice_settings, undefined, '설정 없으면 voice_settings 없음');

  console.log('\n[4] provider 실행 (fetch 가짜)');
  const realFetch = global.fetch;
  let last = null;
  const mockRes = (status, body, json) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => body, text: async () => String(json ? JSON.stringify(json) : body || ''), json: async () => json });
  const setFetch = (fn) => { global.fetch = async (url, init) => { last = { url, init }; return fn(url, init); }; };
  SecretStore.set('mai', { key: 'mai-key' }); SecretStore.set('elevenlabs', { key: 'el-key' }); SecretStore.set('gemini', { key: 'g-key', other: 'keep' });

  const mai = new MAI.MaiProvider(); ok(await mai.init(), 'MAI 키 있으면 준비됨');
  setFetch(() => mockRes(200, makeWav(24000)));
  let r = await mai.synthesize('안녕하세요', { voice: 'ko-KR-Junho', model: 'MAI-Voice-2.1', region: 'japaneast' });
  ok(last.url === 'https://japaneast.tts.speech.microsoft.com/cognitiveservices/v1', 'MAI 주소 = 지역');
  eq(last.init.headers['X-Microsoft-OutputFormat'], 'riff-24khz-16bit-mono-pcm', 'MAI 는 WAV 로 받는다');
  ok(Math.abs(r.durationSec - 1) < 1e-6 && r.format === 'wav', 'MAI 결과 1.0초 WAV');
  setFetch(() => mockRes(401, null, { error: 'bad key' }));
  try { await mai.synthesize('x', { voice: 'ko-KR-Junho' }); ok(false, '401 은 던져야 함'); } catch (e) { ok(/API 키/.test(e.message) && e.status === 401, '401 → 「API 키」 사람 말 오류'); }
  setFetch(() => mockRes(200, makeWav(0)));
  try { await mai.synthesize('x', { voice: 'ko-KR-Junho' }); ok(false, '빈 음성은 던져야 함'); } catch (e) { ok(e.emptyAudio === true, '빈 음성 → emptyAudio(파이프라인이 다시 시도)'); }

  const el = new EL.ElevenLabsProvider(); await el.init();
  const pcm = makeWav(12000).subarray(44);
  setFetch(() => mockRes(200, pcm));
  r = await el.synthesize('x', { voice: 'v123', model: 'eleven_v3' });
  ok(last.url.includes('/v1/text-to-speech/v123?output_format=pcm_24000'), 'ElevenLabs 주소·PCM 출력');
  eq(last.init.headers['xi-api-key'], 'el-key', 'ElevenLabs 키 헤더');
  ok(r.mp3Buffer.toString('ascii', 0, 4) === 'RIFF' && Math.abs(r.durationSec - 0.5) < 1e-6, 'PCM → WAV 로 감싸 0.5초');
  try { await el.synthesize('x', {}); ok(false, '목소리 없으면 던져야 함'); } catch (e) { ok(/목소리/.test(e.message), '목소리 없음 → 사람 말 오류'); }

  const tc = new TC.TypecastProvider(); await tc.init();
  setFetch(() => mockRes(200, makeWav(24000)));
  r = await tc.synthesize('x', { voice: 'tc_1', model: 'ssfm-v30', language: 'ko' });
  eq([last.url, last.init.headers['X-API-KEY'], JSON.parse(last.init.body).voice_id], ['https://api.typecast.ai/v1/text-to-speech', 'tc-secret-1234', 'tc_1'], '타입캐스트 요청');
  setFetch(() => mockRes(200, null, [{ voice_id: 'tc_9', voice_name: { kor: '딜런', eng: 'Dylan' }, gender: 'male', age: 'young_adult' }]));
  eq(await TC.listVoices('k'), [{ id: 'tc_9', name: '딜런', gender: 'male', lang: '청년', desc: '', preview: '' }], '타입캐스트 목소리 목록(카드)');
  { let n = 0; const urls = [];
    setFetch((url) => { urls.push(url); n++; return mockRes(200, null, n === 1
      ? { voices: [{ voice_id: 'e1', name: 'Rachel', labels: { gender: 'female' }, category: 'cloned', preview_url: 'https://x/p.mp3' }], has_more: true, next_page_token: 'T2' }
      : { voices: [{ voice_id: 'e2', name: 'Adam', labels: { gender: 'male' } }], has_more: false }); });
    const L = await EL.listVoices('k');
    eq(L.map((v) => v.id), ['e1', 'e2'], 'ElevenLabs — 다음 쪽까지 전부 불러온다');
    ok(urls[1].includes('next_page_token=T2'), 'ElevenLabs 쪽 넘김 토큰');
    eq([L[0].gender, L[0].desc, L[0].preview], ['female', '내 복제', 'https://x/p.mp3'], 'ElevenLabs 카드(성별·분류·샘플)'); }
  { let n = 0;
    setFetch(() => { n++; return mockRes(200, null, n === 1 ? { voices: [{ id: 'voice_a', display_name: '서윤', gender: 'FEMALE', language_code: 'ko-KR', persona: '내레이터' }], next_page_token: 'P' } : { voices: [{ id: 'voice_b', display_name: 'B' }] }); });
    const { listVoices: gList } = require(path.join(ROOT, 'tts/providers/gemini-provider'));
    const L = await gList('g');
    eq(L.map((v) => v.id), ['voice_a', 'voice_b'], 'Gemini 확장 라이브러리 — 쪽 넘김');
    eq([last.url.includes('page_token=P'), last.init.headers['x-goog-api-key'], L[0].gender, L[0].lang], [true, 'g', 'female', 'ko-KR'], 'Gemini 목록 요청·카드'); }

  const { GeminiProvider } = require(path.join(ROOT, 'tts/providers/gemini-provider'));
  const gm = new GeminiProvider(); await gm.init();
  const wav = makeWav(24000);
  setFetch(() => mockRes(200, null, { steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: 'x' }, { type: 'audio', data: wav.toString('base64') }] }] }));
  r = await gm.synthesize('안녕', { model: 'gemini-3.8-flash-tts', voice: 'Charon', style: '차분하게' });
  eq(last.url, 'https://generativelanguage.googleapis.com/v1beta/interactions', 'Gemini 3.8 = Interactions API');
  const gb = JSON.parse(last.init.body);
  eq([gb.model, gb.generation_config.speech_config[0].voice, gb.input[0].content[0].annotations[0].style], ['gemini-3.8-flash-tts', 'Charon', '차분하게'], 'Gemini 3.8 본문(목소리·말투)');
  ok(Math.abs(r.durationSec - 1) < 1e-6, 'Gemini 3.8 WAV 응답 → 1.0초');
  setFetch(() => mockRes(200, null, { steps: [{ type: 'model_output', content: [{ type: 'audio', data: wav.subarray(44).toString('base64') }] }] }));
  r = await gm.synthesize('안녕', { model: 'gemini-3.8-flash-lite-tts', voice: 'Kore' });
  ok(r.mp3Buffer.toString('ascii', 0, 4) === 'RIFF' && Math.abs(r.durationSec - 1) < 1e-6, 'Gemini 헤더 없는 PCM 도 WAV 로');
  global.fetch = realFetch;

  console.log('\n[4b] 내장 목록');
  const VC = require(path.join(ROOT, 'tts/voice-catalogs'));
  eq(VC.GEMINI.length, 30, 'Gemini 기본 목소리 30개(공식)');
  eq(VC.MAI.length, 97, 'MAI 목소리 97개(공식 표 전체)');
  eq(new Set(VC.MAI.map((v) => v.id)).size, 97, 'MAI id 중복 없음');
  eq(VC.MAI.filter((v) => v.locale === 'ko-KR').map((v) => v.id).sort(), ['ko-KR-Grant', 'ko-KR-Haena', 'ko-KR-Harper', 'ko-KR-Junho'], 'MAI 한국어 4개');
  ok(VC.MAI.every((v) => v.styles.length >= 1 && v.styles.includes('neutral')), 'MAI 모든 목소리에 neutral 말투');
  ok(VC.GEMINI.every((v) => /\(.+\)/.test(v.desc)), 'Gemini 카드에 공식 특징(영문) 병기');
  TE.save({ active: 'mai', mai: { voice: 'ko-KR-Grant', style: 'whispering' } });
  eq(TE.synthExtra('mai').style, undefined, 'MAI — 목소리가 못 하는 말투는 보내지 않는다(Grant 는 whispering 없음)');
  TE.save({ active: 'mai', mai: { voice: 'ko-KR-Grant', style: 'narrator' } });
  eq(TE.synthExtra('mai').style, 'narrator', 'MAI — 되는 말투는 보낸다');
  TE.save({ active: 'omnivoice', omnivoice: { voice: 'srv:공용목소리' } });
  eq(TE.omniVoice(), 'srv:공용목소리', 'OmniVoice 목소리 지정(srv:)');
  ok(/공용목소리\(모든 채널\)/.test(TE.label('omnivoice')), 'OmniVoice 지정 목소리가 로그 표기에');
  TE.save({ active: 'omnivoice', omnivoice: { voice: 'C:/x.wav' } });
  eq(TE.omniVoice(), '', 'srv: 가 아니면 무시(채널 그대로)');

  console.log('\n[5] 파이프라인 — 엔진 인자');
  const P = require(path.join(ROOT, 'core/pipeline'));
  const run = async (preset) => {
    const calls = [];
    const mgr = { processText: (t) => t, prepareDict: async () => {}, synthesize: async (t, o) => { calls.push(o); return { mp3Buffer: makeWav(24000), durationSec: 1 }; } };
    const wd = fs.mkdtempSync(path.join(TMP, 'tts-'));
    const lines = [];
    await P.fillTtsList([{ num: 1, text: '첫 문장입니다.' }, { num: 2, text: '둘째 문장입니다.', speaker: '철수' }], preset, mgr, wd, (l) => lines.push(l), () => false, 1, '', null, true);
    return { calls, lines };
  };
  const preset = { name: 'T', engine: 'omnivoice', voiceCloneRefAudio: 'srv:로이', seed: 7, language: 'ko', ttsNormalize: false, speakers: [{ name: '철수', voice: 'srv:철수' }] };
  TE.save({ active: 'omnivoice' });
  let o = await run(preset);
  eq([o.calls[0].provider, o.calls[0].refName, o.calls[0].engineSig], ['omnivoice', '로이', undefined], 'OmniVoice — 채널 참조음성 · engineSig 없음');
  eq(o.calls[1].refName, '철수', 'OmniVoice — 화자 목소리 그대로');
  TE.save({ active: 'elevenlabs', elevenlabs: { voice: 'v9', model: 'eleven_v3' } });
  o = await run(preset);
  eq([o.calls[0].provider, o.calls[0].voice, o.calls[0].model, o.calls[0].refName, o.calls[0].seed], ['elevenlabs', 'v9', 'eleven_v3', undefined, 7], '유료 — 엔진 인자 + 채널 시드 · 참조음성 없음');
  eq(o.calls[1].voice, 'v9', '유료 — 화자도 같은 목소리');
  ok(o.lines.some((l) => /🔊 음성 엔진 — ElevenLabs/.test(l)), '로그에 엔진·목소리를 남긴다');
  ok(o.lines.some((l) => /화자별 목소리\(참조음성\)를 쓰지 않습니다/.test(l)), '화자 목소리를 못 쓴다고 알린다');
  TE.save({ active: 'omnivoice', omnivoice: { voice: 'srv:공용' } });
  o = await run(preset);
  eq([o.calls[0].provider, o.calls[0].refName, o.calls[0].refText], ['omnivoice', '공용', undefined], 'OmniVoice 목소리 지정 → 채널 대신 그 목소리(참조텍스트는 서버)');
  eq(o.calls[1].refName, '철수', '화자 목소리는 그대로');
  TE.save({ active: 'omnivoice' });

  console.log('\n[6] 화면');
  const app = fs.readFileSync(path.join(ROOT, 'renderer/src/App.jsx'), 'utf8');
  ok(!/<span className="rb-t">Vrew 음성<\/span>/.test(app), '「Vrew 음성」 버튼 없음');
  ok(!/<span className="rb-t">다시 연결<\/span>/.test(app), '「다시 연결」 버튼 없음');
  ok(!/<option value="visual">🖼 화면만<\/option>/.test(app), '「출력」 고르기 없음');
  ok(/data-testid="tts-engine-btn"/.test(app), '🔊 음성 엔진 버튼 있음');
  const dlg = fs.readFileSync(path.join(ROOT, 'renderer/src/TtsEngineDialog.jsx'), 'utf8');
  ok(/height: 'min\(720px, 90vh\)'/.test(dlg) && !/maxHeight: '86vh'/.test(dlg), '팝업 크기 고정(내용에 따라 늘지 않음)');
  ok(/role="tablist"/.test(dlg) && /tts-voice-card/.test(dlg), '엔진 탭 + 목소리 카드');
  ok(!/<datalist/.test(dlg), '목소리 고르기에 선택창(datalist)을 쓰지 않는다');
  ok(!/setOutMode\(\['full', 'audio', 'visual'\]/.test(app), '옛 저장값으로 출력 방식을 되살리지 않는다');
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  for (const ch of ['tts-engines-get', 'tts-engines-save', 'tts-engine-voices', 'tts-engine-test', 'tts-engine-open-key', 'tts-omni-voices']) ok(main.includes(`ipcMain.handle('${ch}'`), `IPC ${ch}`);
  ok(/key: v \}\)/.test(main) && /\.\.\.\(SecretStore\.get\(e\.keyId\) \|\| \{\}\)/.test(main), '키 저장은 같은 칸의 다른 값을 지킨다(gemini 공용 칸)');

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  console.log(`\n${fails.length ? '❌' : '✅'} tts-engines: ${pass} 통과${fails.length ? ` · ${fails.length} 실패` : ''}`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
