// 🙂 ElevenLabs 라이브러리 목소리를 「내 목소리」로 추가할 때 얼굴·샘플이 새 id 로 따라온다(v0.6.86 · 로이)
//   main.js 의 원문 함수(_carryVoiceAssets 와 그 도우미)를 뽑아 임시 폴더에서 실행한다(복사본 금지 원칙).
//   node test/library-face.test.js
const fs = require('fs'), os = require('os'), path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re, name) => { const m = M.match(re); if (!m) throw new Error('main.js 에서 못 찾음: ' + name); return m[0]; };
const src = [
  grab(/const _voiceFileKey = [^\n]+\n/, '_voiceFileKey'),
  grab(/const _faceIndexPath = [^\n]+\n/, '_faceIndexPath'),
  grab(/function _faceIndex\(engine\) [^\n]+\n/, '_faceIndex'),
  grab(/function _setFace\(engine, voice, file\) \{[\s\S]*?\n\}\n/, '_setFace'),
  grab(/function _sampleIndexPath\(engine\) [^\n]+\n/, '_sampleIndexPath'),
  grab(/function _sampleIndex\(engine\) [^\n]+\n/, '_sampleIndex'),
  grab(/const _sampleKey = [^\n]+\n/, '_sampleKey'),
  grab(/function _carryVoiceAssets\(engine, fromId, toId\) \{[\s\S]*?\n\}\n/, '_carryVoiceAssets'),
].join('');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'libface-'));
const VOICE_FACE_DIR = () => path.join(root, 'faces'), TTS_SAMPLE_DIR = () => path.join(root, 'samples');
const logs = []; const log = (l) => logs.push(l);
// eslint-disable-next-line no-new-func
const api = new Function('fs', 'path', 'require', 'VOICE_FACE_DIR', 'TTS_SAMPLE_DIR', 'log', src + '\nreturn { _carryVoiceAssets, _faceIndex, _setFace, _voiceFileKey, _sampleIndex };')(fs, path, require, VOICE_FACE_DIR, TTS_SAMPLE_DIR, log);

console.log('[1] 얼굴 — 라이브러리 id → 새 내 목록 id');
const E = 'elevenlabs', dir = path.join(VOICE_FACE_DIR(), E); fs.mkdirSync(dir, { recursive: true });
const libFile = api._voiceFileKey('LIB123') + '.png'; fs.writeFileSync(path.join(dir, libFile), 'PNGDATA');
api._setFace(E, 'LIB123', libFile);
const sd = path.join(TTS_SAMPLE_DIR(), E); fs.mkdirSync(sd, { recursive: true });
fs.writeFileSync(path.join(sd, 's1.wav'), 'WAV');
fs.writeFileSync(path.join(sd, 'index.json'), JSON.stringify({ 'eleven_v4|LIB123|': { file: 's1.wav', sec: 3 }, 'eleven_v4|OTHER|': { file: 's1.wav', sec: 3 } }));
const r = api._carryVoiceAssets(E, 'LIB123', 'NEW999');
const ix = api._faceIndex(E);
ok(ix.NEW999 && fs.readFileSync(path.join(dir, ix.NEW999), 'utf8') === 'PNGDATA', '🔑 새 id 에 같은 얼굴 그림');
ok(ix.LIB123 === libFile, '라이브러리 쪽 얼굴도 그대로 남는다');
ok(r.face && r.face.path === path.join(dir, ix.NEW999), '화면에 돌려줄 얼굴 정보');
const si = api._sampleIndex(E);
ok(si['eleven_v4|NEW999|'] && si['eleven_v4|NEW999|'].file === 's1.wav' && r.samples === 1, '🔈 만든 샘플도 새 id 로(다시 만들지 않는다 · 요금 0)');
console.log('[2] 이미 새 id 에 얼굴이 있으면 덮어쓰지 않는다 · 같은 id 면 아무것도 안 함');
fs.writeFileSync(path.join(dir, 'mine.png'), 'MINE'); api._setFace(E, 'NEW2', 'mine.png');
api._carryVoiceAssets(E, 'LIB123', 'NEW2');
ok(api._faceIndex(E).NEW2 === 'mine.png', '내가 넣은 얼굴은 그대로');
const r0 = api._carryVoiceAssets(E, 'LIB123', 'LIB123');
ok(!r0.face && r0.samples === 0, '같은 id = 아무것도 안 함');
ok(/const carried = _carryVoiceAssets\('elevenlabs', voiceId, newId\);/.test(M) && /face: carried\.face/.test(M), 'el-add-shared 가 추가 직후 부른다');
ok(/if \(r\.face\) setFaces/.test(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'TtsEngineDialog.jsx'), 'utf8')), '화면도 새 id 얼굴을 바로 보인다');
try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
console.log(`\n${fail ? '❌' : '✅'} library-face ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
