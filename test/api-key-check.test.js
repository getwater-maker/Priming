'use strict';
/**
 * node test/api-key-check.test.js — 🔑 API 키 검증(core/api-key-check) — 가짜 fetch 로 상태별 해석을 확인한다(네트워크·요금 없음)
 *   · 통과/거부/모델명 오류/권한 부족/한도/서버 오류/연결 실패 · 키 원문이 메시지에 안 새는지 · 읽기 전용 GET 만 쓰는지
 *   · 설정 화면에 키마다 「✔ 검증」과 「🔍 모든 키 검증」이 있고 IPC 가 연결돼 있는지(소스 점검)
 */
const fs = require('fs'), path = require('path');
const V = require('../core/api-key-check');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const fake = (status, body) => async (url, opt) => { fake.calls.push({ url, opt }); return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body || {})) }; };
fake.calls = [];
const KEY = 'SECRET-KEY-12345';

(async () => {
  let r = await V.verify('gemini', '', {}, fake(200));
  ok(!r.ok && r.level === 'bad' && /키가 없습니다/.test(r.message), '빈 키 → 없음');
  r = await V.verify('gemini', KEY, {}, fake(200, { models: [] }));
  ok(r.level === 'ok', 'Gemini 200 → 통과');
  ok(fake.calls.at(-1).opt.headers['x-goog-api-key'] === KEY && !/key=/.test(fake.calls.at(-1).url), 'Gemini 키는 헤더로(주소에 안 싣는다)');
  r = await V.verify('gemini', KEY, {}, fake(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }));
  ok(r.level === 'bad' && /틀렸/.test(r.message), 'Gemini 틀린 키 → 거부');
  r = await V.verify('gemini', KEY, { model: 'nope-model' }, fake(404, { error: { message: 'models/nope-model is not found' } }));
  ok(r.level === 'warn' && /nope-model/.test(r.message), 'Gemini 키 OK + 모델명 없음 → 경고(모델명 안내)');
  ok(/models\/nope-model$/.test(fake.calls.at(-1).url), '모델을 알면 그 모델을 조회');
  r = await V.verify('gemini', KEY, {}, fake(429, {}));
  ok(r.level === 'warn' && r.ok, '한도(429) → 경고(키는 유효)');
  r = await V.verify('gemini', KEY, {}, fake(503, {}));
  ok(r.level === 'warn' && /503/.test(r.message), '서버 오류 → 경고(잠시 뒤 다시)');
  r = await V.verify('xai', KEY, {}, fake(200, { name: 'Default API Key', api_key_blocked: false }));
  ok(r.level === 'ok' && /Default API Key/.test(r.message), 'xAI 통과 · 키 이름 표시');
  r = await V.verify('xai', KEY, {}, fake(200, { api_key_blocked: true }));
  ok(r.level === 'warn' && /차단/.test(r.message), 'xAI 차단된 키 → 경고');
  r = await V.verify('xai', KEY, {}, fake(400, { error: 'Incorrect API key' }));
  ok(r.level === 'bad', 'xAI 틀린 키(400) → 거부');
  r = await V.verify('mai', KEY, { region: 'koreacentral' }, fake(200, []));
  ok(r.level === 'ok' && /koreacentral/.test(fake.calls.at(-1).url) && fake.calls.at(-1).opt.headers['Ocp-Apim-Subscription-Key'] === KEY, 'Azure: 지역 주소로 조회 · 키는 구독 헤더');
  r = await V.verify('mai', KEY, { region: 'eastus' }, fake(401, {}));
  ok(r.level === 'bad' && /지역/.test(r.message), 'Azure 401 → 키 또는 지역 안내');
  r = await V.verify('mai', KEY, { region: 'evil.com/x' }, fake(200, []));
  ok(r.level === 'bad', '이상한 지역 이름은 호출하지 않는다');
  r = await V.verify('typecast', KEY, {}, fake(200, []));
  ok(r.level === 'ok' && fake.calls.at(-1).opt.headers['X-API-KEY'] === KEY, '타입캐스트 통과');
  r = await V.verify('typecast', KEY, {}, fake(401, {}));
  ok(r.level === 'bad', '타입캐스트 거부');
  r = await V.verify('elevenlabs', KEY, {}, fake(200, { voices: [] }));
  ok(r.level === 'ok', 'ElevenLabs 통과');
  r = await V.verify('elevenlabs', KEY, {}, fake(401, { detail: { status: 'missing_permissions', message: 'The API key you used is missing the permission voices_read' } }));
  ok(r.level === 'warn' && /권한/.test(r.message), 'ElevenLabs 권한 부족 → 경고(키는 맞음)');
  r = await V.verify('elevenlabs', KEY, {}, fake(401, { detail: { status: 'invalid_api_key' } }));
  ok(r.level === 'bad', 'ElevenLabs 틀린 키 → 거부');
  r = await V.verify('typecast', KEY, {}, async () => { throw new Error('fetch failed: getaddrinfo ENOTFOUND ' + KEY); });
  ok(r.level === 'bad' && /연결하지 못했습니다/.test(r.message) && !r.message.includes(KEY), '연결 실패 → 거부 · 키 원문이 메시지에 없다');
  r = await V.verify('nope', KEY, {}, fake(200));
  ok(r.level === 'bad', '모르는 종류');
  ok(fake.calls.every((c) => (c.opt.method || 'GET') === 'GET'), '전부 읽기 전용 GET(생성·합성 호출 없음)');

  const App = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8');
  const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const P = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  ok(/keyChkBtn\('gemini'/.test(App) && /keyChkBtn\('xai'/.test(App) && /keyChkBtn\(id === 'gemini' \? 'gemini-tts' : id/.test(App), '화면: 나노바나나·Grok·TTS 4개 키마다 검증 단추');
  ok(/data-testid="keychk-all"/.test(App) && /verifyAllKeys/.test(App), '화면: 모든 키 검증');
  ok(/ipcMain\.handle\('api-key-verify'/.test(M) && /apiKeyVerify/.test(P), 'IPC 연결(main · preload)');
  ok(!/api-key-verify[\s\S]{0,400}log\([^)]*\bk\b[^)]*\)/.test(M), '로그에 키 변수를 싣지 않는다');
  console.log(`\n${fail ? '❌' : '✅'} api-key-check — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
