// 🎙 참조음성 만들기 — core/ref-voice(앱·CLI 공용) + tools/ref-voice.js (v0.6.99 · 채널사업부 요청 · 로이 B 안)
//   서버·GPU 없이: 공용 함수 · 예문(むかしむかし) · 자르기 규칙(합성 WAV) · 인자 · 🔒 키를 직접 다루지 않는다
//   node test/ref-voice.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const RV = require('../core/ref-voice');

console.log('[1] 예문 — 앱 보이스디자인 창과 같다 · 일본어는 가나 「むかしむかし」');
const A = read('renderer/src/App.jsx');
const vd = /const VD_SAMPLE_TEXT = \{([\s\S]*?)\n\};/.exec(A);
const appSample = {};
if (vd) for (const m of vd[1].matchAll(/^\s*(\w+): '([^']*)'/gm)) appSample[m[1]] = m[2];
ok(['Korean', 'Japanese', 'vi'].every((k) => appSample[k] === RV.SAMPLE_TEXT[k]), '앱 VD_SAMPLE_TEXT = core SAMPLE_TEXT (세 언어)');
ok(!/昔々|むかしむかし|むかしばなし|子ども|ひとつ/.test(RV.SAMPLE_TEXT.Japanese + RV.VERIFY_TEXTS.Japanese.join('')), '🔑 일본어 예문·검증문에 昔々(Qwen3 오독)·표기가 갈리는 가나 낱말이 없다(받아쓰기 표기 차이로 점수가 깎인다)');
ok(['Korean', 'Japanese', 'vi'].every((k) => RV.VERIFY_TEXTS[k].length === 3 && RV.VERIFY_TEXTS[k].every((s) => !RV.SAMPLE_TEXT[k].includes(s))), '검증 문장 = 언어마다 3개 · 예문과 다른 새 문장');

console.log('[2] 일치율 — 앱이 쓰던 값 그대로');
ok(RV.textMatchRatio('昔々、ある村に', '昔々ある村に') === 1, '문장부호·공백 무시');
ok(Math.abs(RV.textMatchRatio('abcd', 'abxd') - 0.75) < 1e-9 && RV.textMatchRatio('', 'x') === 0, '글자 편집 거리 · 빈 원문 = 0');
const M = read('main.js');
ok(/const \{ textMatchRatio \} = require\('\.\/core\/ref-voice'\);/.test(M) && !/function textMatchRatio\(/.test(M), '🔑 main 은 core/ref-voice 의 textMatchRatio 를 쓴다(복사본 없음)');
ok(/require\('\.\/core\/ref-voice'\)\.cutRange\(r\.buffer, lang\)/.test(M) && /RV\.saveLocal\(name, outBuf, refText\)/.test(M) && /require\('\.\/core\/ref-voice'\)\.saveToLibrary\(/.test(M), 'main 보이스디자인 생성·저장도 core/ref-voice(cutRange · saveLocal · saveToLibrary)');

console.log('[3] 자르기 규칙 — 외국어는 문장 사이 쉼에서 · 한국어는 끝 감쇠만');
function wav(segs) {   // segs: [[sec, amp]] — 24kHz 16bit mono
  const sr = 24000, n = segs.reduce((a, [s]) => a + Math.round(s * sr), 0), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  let k = 0; for (const [s, amp] of segs) { const m = Math.round(s * sr); for (let i = 0; i < m; i++, k++) b.writeInt16LE(Math.round(Math.sin(k / 6) * amp * 32000), 44 + k * 2); }
  return b;
}
const buf = wav([[0.3, 0], [4.0, 0.6], [0.5, 0], [3.0, 0.6], [0.8, 0]]);   // 말 4초 · 쉼 0.5 · 말 3초 · 끝 무음
const ja = RV.cutRange(buf, 'ja'), ko = RV.cutRange(buf, 'ko');
ok(ja && ja.end > 4.2 && ja.end < 4.9, `외국어 = 첫 문장 끝 쉼에서 자른다 (끝 ${ja && ja.end.toFixed(2)}초)`);
ok(ko && ko.end > 7.5, `한국어 = 둘째 말까지 둔다(끝 감쇠만) (끝 ${ko && ko.end.toFixed(2)}초)`);
{ const WS = require('../core/wav-slice'); ok(RV.cutRange(buf, 'Japanese').end === ja.end && JSON.stringify(RV.cutRange(buf, 'Korean')) === JSON.stringify(WS.suggestRange(buf)), '앱 언어 값(Japanese/Korean)과 짧은 코드가 같은 규칙'); }

console.log('[4] 이 PC 저장 — 같은 이름이면 _2');
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-home-')); const saved = os.homedir; os.homedir = () => home;
  try {
    const a = RV.saveLocal('JA_테스트', buf, 'ref1'), b = RV.saveLocal('JA_테스트', buf, 'ref2');
    ok(a.base === 'JA_테스트' && b.base === 'JA_테스트_2' && fs.readFileSync(path.join(home, '.flow-app', 'ref-audio', 'JA_테스트_2.txt'), 'utf8') === 'ref2', '같은 이름은 덮지 않고 _2 · 참조텍스트 .txt');
  } finally { os.homedir = saved; try { fs.rmSync(home, { recursive: true, force: true }); } catch (_) {} }
}

console.log('[5] CLI — 인자 · 🔒 키를 직접 다루지 않는다');
const CLI = require('../tools/ref-voice');
const a1 = CLI.parseArgs(['--언어', 'ja', '--이름', 'JA_수면_남1', '--설명', '낮고 차분한 남성', '--테이크', '3', '--등록', '--검증만=X']);
ok(a1.lang === 'ja' && a1.name === 'JA_수면_남1' && a1.instruct === '낮고 차분한 남성' && a1.takes === '3' && a1.register === true && a1['verify-only'] === 'X', '한국어 별칭(--언어 --이름 --설명 --테이크 --등록 --검증만=)');
ok(CLI.clean('HTTP 401 X-API-Key: abc123secret') === 'HTTP 401 X-API-Key: ***' && CLI.clean('api_key=zzz') === 'api_key: ***', '오류 문구에 키 모양이 섞이면 가린다');
const T = read('tools/ref-voice.js');
ok(!/tts-secrets|apikey\.txt|secret-store|['"]X-API-Key['"]/.test(T), '🔑 CLI 코드는 키 파일·secret-store·키 헤더를 직접 다루지 않는다(서버 호출 모듈이 안에서)');
ok(/QD\.stop\(/.test(T) && /\/release/.test(read('core/qwen-design.js')), '보이스디자인은 끝나면 VRAM 반납(서버는 끄지 않는다 — QD.stop = /release)');
ok(/if \(!names && !o\.overwrite\)/.test(T) && /names\.includes\(name\) && !o\.overwrite/.test(T), '등록 전 서버 목록 확인 — 같은 이름·목록 확인 불가면 멈춤(--overwrite 로만)');
ok(/scripts/.test(read('scripts/gen-manifest.js')) && !/'tools'/.test(read('scripts/gen-manifest.js')), 'tools/ 는 배포에서 빠지지 않는다(scripts/ 는 빠진다)');

console.log(`\n${fail ? '❌' : '✅'} ref-voice ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
