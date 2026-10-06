// 🔈 OmniVoice 미리듣기 샘플 언어(v0.7.1 · 로이 2026-10-06 「아내 PC 에선 일본 목소리 미리듣기가 한국어로 나온다」)
//   원인: 이 PC 는 참조음성 wav 가 있어 원본(일본어)을 틀었고, wav 가 없는 아내 PC 는 한국어 샘플 문장 + 채널 언어 ko 로 합성했다.
//   main.js 의 _omniVoiceLang 원문을 뽑아 실행 — 아내 PC(로컬 파일 없음) 상황을 스텁으로 만든다. 서버가 켜져 있으면 실제 라이브러리로도 본다.
//   node test/omni-sample-lang.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const M = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const src = /\nasync function _omniVoiceLang\([\s\S]*?\n}\n/.exec(M);
ok(!!src, 'main.js 에 _omniVoiceLang 이 있다');

function make({ localFile = null, serverList = null }) {
  const fakeRequire = (p) => {
    if (p === './core/lang') return require('../core/lang');
    if (p === './tts/asr-client') return { listServerVoices: async () => serverList };
    throw new Error('unexpected require ' + p);
  };
  // eslint-disable-next-line no-new-func
  return new Function('require', 'fs', 'resolveRefPath', src[0] + '\nreturn _omniVoiceLang;')(fakeRequire, fs, () => localFile);
}

(async () => {
  console.log('[1] 아내 PC — 로컬 wav 없음 · 서버 라이브러리 참조텍스트로');
  const srv = [{ name: 'JA_남성_중년', text: 'ある村に、貧しいけれど心の優しい若者が住んでいました。' }, { name: '수면_여', text: '안녕하세요. 오늘은' }, { name: 'Lan', text: 'Ngày xửa ngày xưa, ở một ngôi làng nhỏ' }, { name: '漢文', text: '學而時習之' }];
  const wife = make({ serverList: srv });
  ok(await wife('srv:JA_남성_중년', { language: 'ko' }) === 'ja', '🔑 일본 목소리 = ja (채널 언어가 ko 여도)');
  ok(await wife('srv:Lan', { language: 'ko' }) === 'vi', '베트남어 참조텍스트 = vi (이름에 VI_ 없어도)');
  ok(await wife('srv:수면_여', { language: 'ko' }) === 'ko', '한국어 목소리 = ko');
  ok(await wife('srv:漢文', {}) === 'ja', '한자만(cjk) = ja');
  console.log('[2] 서버 목록을 못 읽을 때 — 이름 앞머리 → 채널 언어');
  const off = make({ serverList: null });
  ok(await off('srv:JA_수면_남1', { language: 'ko' }) === 'ja' && await off('srv:VI_여성_청년', {}) === 'vi', '이름 JA_·VI_ 로 판별');
  ok(await off('srv:모르는목소리', { language: 'ja' }) === 'ja' && await off('srv:모르는목소리', {}) === 'ko', '그 밖 = 채널 언어 → 없으면 ko');
  console.log('[3] 이 PC — 로컬 wav 옆 .txt');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osl-'));
  const wav = path.join(dir, 'X.wav'); fs.writeFileSync(wav, 'x'); fs.writeFileSync(path.join(dir, 'X.txt'), 'こんにちは。', 'utf8');
  ok(await make({ localFile: wav, serverList: [] })('srv:X', { language: 'ko' }) === 'ja', '로컬 참조텍스트(.txt)가 일본어 = ja');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('[4] 연결 — 샘플 만들기가 이 언어로 문장·language 를 고르고, 옛 한국어 샘플을 다시 쓰지 않는다');
  const h = /ipcMain\.handle\('tts-engine-test'[\s\S]*?\n}\);/.exec(M); const H = h ? h[0] : '';
  ok(/await _omniVoiceLang\(/.test(H) && /const text = SAMPLE_TEXT\[lang\]/.test(H) && /language: lang, seed/.test(H), '🔑 OmniVoice 샘플 = 판별한 언어의 문장 + language');
  ok(/langOk\(idx\[sk\]\)/.test(H) && /\(ent\.lang \|\| 'ko'\) === lang/.test(H) && /at: Date\.now\(\), lang \}/.test(H), '저장 샘플은 언어가 같을 때만 재사용(기록 없는 옛 샘플 = ko)');
  ok(!/language: pr\.language \|\| 'ko'/.test(H), 'A/B: 옛 코드(채널 언어 고정)는 없다');
  console.log('[5] 실서버(켜져 있으면) — 아내 PC 처럼 로컬 파일 없이');
  let list = null; try { list = await require('../tts/asr-client').listServerVoices(); } catch (_) {}
  const ja = (list || []).find((v) => /^JA_/.test(v.name) && v.text);
  if (ja) ok(await make({ serverList: list })('srv:' + ja.name, { language: 'ko' }) === 'ja', `실제 라이브러리 ${ja.name} = ja`);
  else console.log('  · 서버 목록 없음 — 건너뜀');
  console.log(`\n${fail ? '❌' : '✅'} omni-sample-lang ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
