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

  console.log('\n[1] 엔진 해석 — 채널마다(preset.voiceEngine · v0.6.69)');
  eq(TE.resolveEngine({ engine: 'omnivoice' }), 'omnivoice', 'voiceEngine 없는 채널 → OmniVoice(옛 채널 그대로)');
  eq(TE.resolveEngine({ engine: 'gemini' }), 'gemini', '옛 gemini 채널 → gemini 그대로');
  eq(TE.resolveEngine('omnivoice'), 'omnivoice', '문자열(리모션 등) → 그 엔진');
  eq(TE.synthExtra('omnivoice', { engine: 'omnivoice' }), null, 'OmniVoice 는 엔진 인자 없음');
  const chA = { name: 'A', engine: 'omnivoice', voiceEngine: { id: 'typecast', voice: 'tc_abc', model: 'ssfm-v30', emotion: 'sad' } };
  const chB = { name: 'B', engine: 'omnivoice', voiceEngine: { id: 'mai', voice: 'ko-KR-Haena' } };
  eq([TE.resolveEngine(chA), TE.resolveEngine(chB)], ['typecast', 'mai'], '🔑 채널마다 다른 엔진');
  const x = TE.synthExtra('typecast', chA);
  eq([x.model, x.voice, x.emotion], ['ssfm-v30', 'tc_abc', 'sad'], '타입캐스트 인자 = 그 채널 값');
  ok(typeof x.engineSig === 'string' && x.engineSig.includes('tc_abc'), 'engineSig 에 목소리가 들어간다');
  eq(TE.synthExtra('typecast', chB), null, '다른 채널의 엔진 인자는 섞이지 않는다');
  eq(TE.resolveEngine({ engine: 'omnivoice', voiceEngine: { id: 'nope' } }), 'omnivoice', '모르는 엔진 id → OmniVoice');
  eq(TE.channelVoice({ voiceEngine: { id: 'mai' } }).model, 'MAI-Voice-2.1', 'MAI 모델 기본값 = 2.1');
  eq(TE.channelVoice({ voiceEngine: { id: 'gemini' } }).model, 'gemini-3.8-flash-tts', 'Gemini 모델 기본값 = 3.8');
  eq(TE.channelVoice({ voiceEngine: { id: 'elevenlabs', model: 'eleven_bogus' } }).model, 'eleven_v4', '목록에 없는 모델 → 첫 모델(v4)');
  eq(TE.region(), 'eastus', 'MAI 지역 기본값(전역) = East US');
  TE.save({ mai: { region: 'japaneast' }, krw: 1350 });
  eq([TE.region(), TE.krw()], ['japaneast', 1350], '전역 = 지역·환율만 저장');
  eq(TE.synthExtra('mai', chB).region, 'japaneast', 'MAI 인자에 전역 지역');
  console.log('\n[1b] 💲 요금');
  ok(Math.abs(TE.estimateUsd('mai', 'MAI-Voice-2.1', 1e6) - 22) < 1e-9, 'MAI 2.1 = 1백만 자 $22');
  ok(Math.abs(TE.estimateUsd('mai', 'MAI-Voice-2.1-Flash', 1e6) - 15) < 1e-9, 'MAI Flash = $15');
  ok(Math.abs(TE.estimateUsd('elevenlabs', 'eleven_v4', 1000) - 0.08) < 1e-9, 'ElevenLabs v4 = 1천 자 $0.08');
  ok(Math.abs(TE.estimateUsd('typecast', 'ssfm-v30', 1000) - 0.075) < 1e-9, '타입캐스트 = 1천 자 $0.075');
  ok(Math.abs(TE.estimateUsd('gemini', 'gemini-3.8-flash-tts', 0, 60) - 60 * 25 * 9 / 1e6) < 1e-12, 'Gemini 3.8 = 초당 음성 토큰 25 × $9/1M');
  ok(Math.abs(TE.estimateUsd('gemini', 'gemini-3.8-flash-tts', 700) - 100 * 25 * 9 / 1e6) < 1e-12, 'Gemini — 길이 모르면 한국어 초당 7자로 추정');
  eq(TE.estimateUsd('omnivoice', '', 1e6), 0, 'OmniVoice = 무료');
  eq(TE.estimateUsd('mai', 'nope', 10), null, '모르는 모델 = null(지어내지 않는다)');
  ok(TE.ENGINES.every((e) => !e.paid || e.models.every((m) => TE.PRICING[m.id])), '모든 유료 모델에 단가가 있다');
  ok(/상업 이용 불가/.test(TE.priceLine('typecast', 'ssfm-v30')), '타입캐스트 무료 등급 상업 이용 불가를 알린다');
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
  eq(await TC.listVoices('k'), [{ id: 'tc_9', name: '딜런', gender: 'male', lang: '', desc: '청년', preview: '', image: '' }], '타입캐스트 목소리 목록(카드)');
  setFetch(() => mockRes(200, null, [{ voice_id: 'tc_8', voice_name: 'A', thumbnail_url: 'https://x/t.png' }]));
  eq((await TC.listVoices('k'))[0].image, 'https://x/t.png', '타입캐스트 — 응답에 그림 주소가 있으면 카드 얼굴로');
  { let n = 0; const urls = [];
    setFetch((url) => { urls.push(url); n++; return mockRes(200, null, n === 1
      ? { voices: [{ voice_id: 'e1', name: 'Rachel', labels: { gender: 'female' }, category: 'cloned', preview_url: 'https://x/p.mp3' }], has_more: true, next_page_token: 'T2' }
      : { voices: [{ voice_id: 'e2', name: 'Adam', labels: { gender: 'male' } }], has_more: false }); });
    const L = await EL.listVoices('k');
    eq(L.map((v) => v.id), ['e1', 'e2'], 'ElevenLabs — 다음 쪽까지 전부 불러온다');
    ok(urls[1].includes('next_page_token=T2'), 'ElevenLabs 쪽 넘김 토큰');
    eq([L[0].gender, L[0].badge, L[0].desc, L[0].preview], ['female', '내 복제', '', 'https://x/p.mp3'], 'ElevenLabs 카드(성별 · 분류는 badge · 설명은 영어만 · 샘플)'); }
  { let n = 0;
    setFetch(() => { n++; return mockRes(200, null, n === 1 ? { voices: [{ id: 'voice_a', display_name: '서윤', gender: 'FEMALE', language_code: 'ko-KR', persona: '내레이터' }], next_page_token: 'P' } : { voices: [{ id: 'voice_b', display_name: 'B' }] }); });
    const { listVoices: gList } = require(path.join(ROOT, 'tts/providers/gemini-provider'));
    const L = await gList('g');
    eq(L.map((v) => v.id), ['voice_a', 'voice_b'], 'Gemini 확장 라이브러리 — 쪽 넘김');
    eq([last.url.includes('page_token=P'), last.init.headers['x-goog-api-key'], L[0].gender, L[0].lang], [true, 'g', 'female', 'ko-KR'], 'Gemini 목록 요청·카드');
    ok(last.url.includes('language_code=ko-KR'), '🇰🇷 Gemini 확장 라이브러리 기본 = 한국어'); }

  { // 📚 보이스 라이브러리(한국어) — 찾기 · 추가
    const urls = [];
    setFetch((url, init) => { urls.push(url); return mockRes(200, null, urls.length === 1
      ? { voices: [{ voice_id: 's1', public_owner_id: 'o1', name: '민준', gender: 'male', language: 'ko', accent: 'seoul', age: 'middle_aged', descriptive: 'calm', preview_url: 'https://x/s1.mp3', image_url: 'https://x/s1.jpg' }, { voice_id: 's2', name: '주인 없음' }], has_more: true }
      : { voices: [{ voice_id: 's3', public_owner_id: 'o3', name: '서연', gender: 'female', language: 'ko' }], has_more: false }); });
    const L = await EL.listShared('k', { language: 'ko' });
    ok(urls[0].includes('/v1/shared-voices?') && urls[0].includes('language=ko') && urls[0].includes('page_size=100'), '라이브러리 요청 = shared-voices · language=ko');
    ok(urls[1].includes('page=1'), '라이브러리 다음 쪽');
    eq(L.map((v) => [v.id, v.ownerId]), [['s1', 'o1'], ['s3', 'o3']], '주인(public_owner_id) 없는 것은 뺀다(추가할 수 없다)');
    eq([L[0].lang, L[0].preview, L[0].shared, L[0].image], ['ko · seoul', 'https://x/s1.mp3', true, 'https://x/s1.jpg'], '라이브러리 카드(언어·무료 샘플·그림 주소)');
    setFetch((url, init) => mockRes(200, null, { voice_id: 'newid' }));
    eq(await EL.addShared('k', 'o1', 's1', '민준'), 'newid', '추가 → 새 voice_id');
    ok(last.url.endsWith('/v1/voices/add/o1/s1') && last.init.method === 'POST' && JSON.parse(last.init.body).new_name === '민준', '추가 요청 = POST /v1/voices/add/{owner}/{voice}');
    setFetch(() => mockRes(403, null, { detail: 'missing permission' }));
    try { await EL.addShared('k', 'o1', 's1', 'x'); ok(false, '403 은 던져야 함'); } catch (e) { ok(/Voices – Write/.test(e.message), '권한 없음 → 「Voices – Write」 가 필요하다고 알린다'); }
  }
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
  eq(TE.synthExtra('mai', { voiceEngine: { id: 'mai', voice: 'ko-KR-Grant', style: 'whispering' } }).style, undefined, 'MAI — 목소리가 못 하는 말투는 보내지 않는다(Grant 는 whispering 없음)');
  eq(TE.synthExtra('mai', { voiceEngine: { id: 'mai', voice: 'ko-KR-Grant', style: 'narrator' } }).style, 'narrator', 'MAI — 되는 말투는 보낸다');
  ok(/MAI-Voice · MAI-Voice-2\.1 · 목소리 ko-KR-Haena/.test(TE.label('mai', chB)), '로그 표기 = 그 채널의 모델·목소리');

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
  let o = await run(preset);
  eq([o.calls[0].provider, o.calls[0].refName, o.calls[0].engineSig], ['omnivoice', '로이', undefined], 'OmniVoice 채널 — 채널 참조음성 · engineSig 없음');
  eq(o.calls[1].refName, '철수', 'OmniVoice — 화자 목소리 그대로');
  const presetEL = { ...preset, name: 'EL', voiceEngine: { id: 'elevenlabs', voice: 'v9', model: 'eleven_v3' } };
  o = await run(presetEL);
  eq([o.calls[0].provider, o.calls[0].voice, o.calls[0].model, o.calls[0].refName, o.calls[0].seed], ['elevenlabs', 'v9', 'eleven_v3', undefined, 7], '유료 채널 — 그 채널의 엔진·목소리 + 채널 시드 · 참조음성 없음');
  eq(o.calls[1].voice, 'v9', '유료 — 화자도 같은 목소리');
  ok(o.lines.some((l) => /🔊 음성 엔진 — ElevenLabs/.test(l)), '로그에 엔진·목소리를 남긴다');
  ok(o.lines.some((l) => /화자별 목소리\(참조음성\)를 쓰지 않습니다/.test(l)), '화자 목소리를 못 쓴다고 알린다');
  o = await run(preset);
  eq(o.calls[0].provider, 'omnivoice', '🔑 다른 채널을 유료로 바꿔도 이 채널은 OmniVoice 그대로(전역이 아니다)');
  const mm = await P.makeTtsManager(() => {}, { engine: 'omnivoice', voiceEngine: { id: 'typecast', voice: 'tc_1' } }, { retries: 0 });
  ok(mm && mm.mgr, 'makeTtsManager 가 채널(preset)을 받는다');

  console.log('\n[6] 화면');
  const app = fs.readFileSync(path.join(ROOT, 'renderer/src/App.jsx'), 'utf8');
  ok(!/<span className="rb-t">Vrew 음성<\/span>/.test(app), '「Vrew 음성」 버튼 없음');
  ok(!/<span className="rb-t">다시 연결<\/span>/.test(app), '「다시 연결」 버튼 없음');
  ok(!/<option value="visual">🖼 화면만<\/option>/.test(app), '「출력」 고르기 없음');
  ok(/data-testid="tts-engine-btn"/.test(app), '🔊 음성 엔진 버튼 있음');
  const dlg = fs.readFileSync(path.join(ROOT, 'renderer/src/TtsEngineDialog.jsx'), 'utf8');
  ok(/height: 'min\(760px, 92vh\)'/.test(dlg) && !/maxHeight: '86vh'/.test(dlg), '팝업 크기 고정(내용에 따라 늘지 않음)');
  ok(/data-testid="tts-chan-list"/.test(dlg) && /channels/.test(dlg), '채널 목록(채널마다 목소리)');
  ok(/tts-face-img/.test(dlg) && /ttsFaceAi/.test(dlg) && /ttsFacePick/.test(dlg), '목소리 얼굴(그림·AI)');
  ok(/data-testid="tts-price"/.test(dlg), '요금 표시');
  { const MJ = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8'); const i = MJ.indexOf("ipcMain.handle('tts-face-ai'"); const blk = MJ.slice(i, MJ.indexOf("ipcMain.handle('tts-face-clear'", i));
    ok(i > 0 && /comfy-image/.test(blk) && !/gemini-image/.test(blk), '🎨 얼굴 = 로컬 ComfyUI(Gemini 아님 · v0.6.70)');
    // 📺 채널 얼굴 · 성별 추정 · 💱 환율(v0.6.71)
    ok(/engine === 'channel'/.test(blk) && /_channelFaceInfo/.test(blk), '채널 얼굴(engine channel) = 채널 성격 + 목소리 성별');
    const pa = MJ.indexOf('const _CHANNEL_PERSONA'); const pb = MJ.indexOf('// 채널 얼굴(engine', pa);
    const personaOf = new Function(MJ.slice(pa, pb) + '\nreturn _personaOf;')();
    ok(/hanbok/.test(personaOf('08_다산의뜰')) && /Bible/.test(personaOf('05_로이의성경이야기')) && /headphones/.test(personaOf('플레이리스트')), '채널 이름 → 캐릭터 모습(다산=한복 · 성경 · 플레이리스트=헤드폰)');
    ok(/library/.test(personaOf('06_고전서재')) && /classic/.test(personaOf('06_고전서재')), '키워드 둘(서재+고전)을 잇는다');
    ok(/YouTube narrator/.test(personaOf('아무이름')), '모르는 채널 = 기본 내레이터');
    { const ga = MJ.indexOf('function _estimateGender(file) {'); const gb = MJ.indexOf('\n}\n', ga) + 2;
      const est = new Function('require', 'fs', MJ.slice(ga, gb) + '\nreturn _estimateGender;')((m) => require(m.startsWith('./') ? path.join(ROOT, m.slice(2)) : m), fs);
      const REF = 'D:/TTS_Model/ref-audio';
      if (fs.existsSync(REF + '/1nd_고전_남성.wav') && fs.existsSync(REF + '/1nd_고전_여성.wav')) {
        const m = await est(REF + '/1nd_고전_남성.wav'); const f = await est(REF + '/1nd_고전_여성.wav');
        eq([m.gender, f.gender], ['male', 'female'], `목소리 높이로 성별 추정 — 남 ${m.f0}Hz · 여 ${f.f0}Hz(판정력: 둘이 갈린다)`);
      } else console.log('  (참조음성 폴더 없음 — 성별 추정 실물 확인 건너뜀)');
      eq((await est(path.join(TMP, 'nope.wav'))).gender, '', '파일 없으면 성별 모름(지어내지 않는다)'); }
    ok(/ipcMain\.handle\('fx-usd-krw'/.test(MJ) && /open\.er-api\.com/.test(MJ), '💱 환율 = 공개 API(시장 환율)');
    ok(/cardFee: args\.cardFee/.test(MJ), '💳 카드 수수료 저장');
    ok(/data-testid="tts-face-all"/.test(dlg) && /data-testid="tts-chlogo"/.test(dlg) && /data-testid="tts-fx"/.test(dlg) && !/tts-chface/.test(dlg), '화면: 목소리 얼굴 모두 그리기 · 채널 = 로고(사람 얼굴 아님) · 환율 표시');
    ok(MJ.includes("ipcMain.handle('tts-channel-logo'") && MJ.includes('logoPath: r.filePaths[0]'), '채널 로고 = 채널편집 로고와 같은 칸(logoPath)');
    ok(blk.includes("engine === 'omnivoice'") && blk.includes('_estimateGender(resolveRefPath(voice))'), 'OmniVoice 목소리 얼굴 = 이름·목소리 높이로 성별');
    { const m = /const enOnly = (\(t\) => [^\n]+);/.exec(blk); const enOnly = m && new Function('return ' + m[1])();
      eq(enOnly && enOnly('단단한 (Firm)'), 'Firm', 'Gemini 카드 설명 → 그림 프롬프트엔 영어만(「단단한」 뺌)');
      eq(enOnly && enOnly('내 복제 · middle_aged · calm'), 'middle_aged calm', 'ElevenLabs 설명도 영어만'); }
    { // 🇰🇷 언어 묶음(화면 함수 원문 실행)
      const la = dlg.indexOf('const LANG_KO = '); const lb = dlg.indexOf('// 💰 금액은 원화로', la);
      const langOf = new Function(dlg.slice(la, lb) + '\nreturn langOf;')();
      eq(['ko', 'ko-KR', 'ko · seoul', '한국어', '영어(미국)', 'en · american', '', '다국어'].map((x) => langOf({ lang: x })), ['한국어', '한국어', '한국어', '한국어', '영어', '영어', '다국어', '다국어'], '언어 이름 묶기(코드·억양 → 한국어 이름)');
      ok(/langs\.includes\('한국어'\) \? '한국어'/.test(dlg), '모든 탭 언어 기본 = 한국어');
      ok(/langOf\(v\) === '다국어'/.test(dlg), '다국어 목소리(Gemini 기본 30 등)는 한국어 거르기에도 보인다');
      ok(/setElSrc\('library'\)/.test(dlg) && /some\(\(v\) => langOf\(v\) === '한국어'\)/.test(dlg), 'ElevenLabs — 내 목록에 한국어가 없으면 한국어 라이브러리부터'); }
    { // 💰 원화 표시 · 대본 예상 비용 · 🇰🇷 카드 번역(v0.6.76)
      const wa = dlg.indexOf('const wonTxt = '); const wonTxt = new Function('return ' + dlg.slice(wa + 'const wonTxt = '.length, dlg.indexOf(';\n', wa)))();
      eq([wonTxt(0.22, 1366), wonTxt(0.001, 1366), wonTxt(0, 1366), wonTxt(null, 1366), wonTxt(0.00001, 1366)], ['301원', '1.4원', '무료', '?', '0.1원 미만'], '원화 표기(반올림·소수 한 자리·무료·모름)');
      ok(!/usdTxt/.test(dlg) && !/\$\$\{/.test(dlg), '팝업에 달러 표시가 남지 않는다');
      const APP = fs.readFileSync(path.join(ROOT, 'renderer/src/App.jsx'), 'utf8');
      ok(/data-testid="tts-cost"/.test(APP) && /if \(!se\.audio\) \{ need\+\+; chars \+= n; \}/.test(APP), '대본 TTS 예상 비용 — 음성 없는 문장만 센다');
      ok(MJ.includes("ipcMain.handle('tts-translate'") && /koView/.test(dlg) && /원문:/.test(dlg), '카드 글 한국어 번역(원문은 마우스 올리면)');
      const ta = MJ.indexOf('const _needsTr = '); const needsTr = new Function('return ' + MJ.slice(ta + 'const _needsTr = '.length, MJ.indexOf(';\n', ta)))();
      eq([needsTr('Warm calm narrator'), needsTr('따뜻한 목소리'), needsTr('ko'), needsTr(''), needsTr('내 복제 · middle_aged · calm narrator')], [true, false, false, false, true], '번역할 글 고르기(영어가 한글보다 많으면 · 「내 복제」 섞인 옛 목록도)');
      ok(/badge: v.cloned_by_count/.test(fs.readFileSync(path.join(ROOT, 'tts/providers/elevenlabs-provider.js'), 'utf8')), '「복제 N회」는 설명이 아니라 badge(설명은 영어만 → 번역)');
      ok(!dlg.includes('shown.slice(0, 80)') && dlg.includes('need.length >= 120'), '보이는 카드 전부 번역(120개씩)');
      ok(/gemini: 'gemini-3\.8-flash'/.test(fs.readFileSync(path.join(ROOT, 'core/prompt-io.js'), 'utf8')), 'Gemini 글 모델 = 3.8-flash(2.5-flash 는 신규 사용자 404)'); }
    { // 🔑 키는 ⚙ 설정 → 🔑 API 키 한 곳에서(v0.6.78)
      const APP2 = fs.readFileSync(path.join(ROOT, 'renderer/src/App.jsx'), 'utf8');
      ok(/data-testid="tts-keys"/.test(APP2) && ['gemini', 'mai', 'typecast', 'elevenlabs'].every((id) => APP2.includes(`['${id}', `)), '⚙ 설정 → 🔑 API 키에 TTS API 4개(Gemini·MAI·타입캐스트·ElevenLabs)');
      ok(!/type="password"/.test(dlg), '음성 설정 팝업에는 키 입력칸이 없다(설정으로 안내만)');
      ok(/data-testid="tts-key-goto"/.test(dlg) && /onOpenKeys=\{openTtsKeySettings\}/.test(APP2), '키 없으면 「🔑 키 넣기 → ⚙ 설정」 버튼이 설정 키 탭을 연다'); }
    { // 🎙 채널편집 음성 탭 정리 · 🔈 아이콘 버튼 · 채널 그림(v0.6.80)
      const APP3 = fs.readFileSync(path.join(ROOT, 'renderer/src/App.jsx'), 'utf8');
      ok(/data-testid="ch-voice-sum"/.test(APP3) && /openTtsEngines\(ch\.name\)/.test(APP3), '음성 탭 맨 위 = 이 채널 목소리 요약 + 「🔊 음성 설정에서 바꾸기」(그 채널로 연다)');
      ok(/isOmni \? \(<>/.test(APP3), '참조음성·Clone강도·화자 목소리 = OmniVoice 일 때만');
      { const vt = APP3.indexOf("{chTab === 'voice' && (() => {"); const tt = APP3.indexOf("{chTab === 'tools' && (<div>");
        const bt = APP3.indexOf("{chTab === 'basic' && (<div>");
        ok(vt > 0 && tt > 0 && bt > 0 && !APP3.slice(vt, APP3.indexOf("{chTab === 'caption'", vt)).includes('presetPrompt') && APP3.slice(bt, vt).includes('<label>이미지 사전설정</label>') && !APP3.slice(tt, tt + 600).includes('presetPrompt'), '이미지 사전설정은 🏠 기본 탭으로(🎨 제작 도구는 높이가 넘친다)'); }
      ok(/api\.getPresetDetail\(ch\.name\)\.then\(\(p\) => \{ if \(p\) setCh\(\(c\) => \(c \? \{ \.\.\.c, voiceCloneRefAudio/.test(APP3), '음성 설정 저장 뒤 열린 채널편집의 참조음성을 새로(옛 값으로 덮어쓰지 않게)');
      ok(/aria-label="샘플 듣기"/.test(dlg) && !/\{playing \? '⏳' : '🔈'\} 듣기/.test(dlg), '카드 🔈 = 아이콘만(「듣기」 글자 없음)');
      ok(MJ.includes("'_ch_' + _voiceFileKey(p.name) + '.png'"), '유튜브 연결 없는 채널 = 이름 그림(_ch_<이름>.png)'); }
    { const BS = fs.readFileSync(path.join(ROOT, 'bootstrap.js'), 'utf8');
      ok(/process\.env\.PM_UI_SMOKE \? path\.join\(os\.tmpdir\(\), 'priming-smoke-electron'\)/.test(BS) && /setPath\('userData', electronDir\)/.test(BS), '🧪 E2E 는 자기 전용 Electron 저장 공간(로이 앱이 켜져 있어도 테스트 가능 · v0.6.81)'); }
    ok(MJ.includes("ipcMain.handle('tts-channel-avatars'") && MJ.includes('ytChannelId') && MJ.includes('/youtube/v3/channels?part=snippet&id='), '🏷 채널 로고 = 연결된 유튜브 채널 그림(ytChannelId · 이름 짐작 없음)');
    { const ia = MJ.indexOf("ipcMain.handle('tts-channel-avatars'"); ok(!/logoPath\s*:/.test(MJ.slice(ia, ia + 1200)), '유튜브 그림은 logoPath(영상 로고)를 건드리지 않는다'); }
    ok(MJ.includes("ipcMain.handle('el-shared-voices'") && MJ.includes("ipcMain.handle('el-add-shared'"), 'IPC — 라이브러리 찾기·추가');
    ok(/data-testid="el-lib"/.test(dlg) && /addFromLibrary/.test(dlg), '화면: 「🇰🇷 한국어 라이브러리」 → 고르면 추가');
    ok(/cfg\.cloud = false/.test(blk) && /\['image', 'localGpu'\]/.test(blk) && /awaitForeignTtsIdle/.test(blk) && /freeMemory/.test(blk), '로컬 강제 · GPU 레인 · TTS 대기 · VRAM 반납'); }
  ok(/role="tablist"/.test(dlg) && /tts-voice-card/.test(dlg), '엔진 탭 + 목소리 카드');
  ok(!/<datalist/.test(dlg), '목소리 고르기에 선택창(datalist)을 쓰지 않는다');
  ok(!/setOutMode\(\['full', 'audio', 'visual'\]/.test(app), '옛 저장값으로 출력 방식을 되살리지 않는다');
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  for (const ch of ['tts-engines-get', 'tts-engines-save', 'tts-engine-voices', 'tts-engine-test', 'tts-engine-open-key', 'tts-omni-voices', 'tts-face-pick', 'tts-face-ai', 'tts-face-clear']) ok(main.includes(`ipcMain.handle('${ch}'`), `IPC ${ch}`);
  ok(/key: v \}\)/.test(main) && /\.\.\.\(SecretStore\.get\(e\.keyId\) \|\| \{\}\)/.test(main), '키 저장은 같은 칸의 다른 값을 지킨다(gemini 공용 칸)');

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  console.log(`\n${fails.length ? '❌' : '✅'} tts-engines: ${pass} 통과${fails.length ? ` · ${fails.length} 실패` : ''}`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
