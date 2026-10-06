// 🔈🗑🙂 목소리 공유(v0.7.2 · 로이 2026-10-06 「어디서나 동일해야 · 맘에 안 드는 것은 삭제 · 얼굴도 공유」)
//   · asr-client 의 새 서버 호출(원본 받기 · 휴지통 · 얼굴)을 **서버 사본**에 대고 실제로 부른다
//   · main.js 의 syncVoiceFaces 원문을 뽑아 **PC 두 대**(홈 폴더 둘)로 돌린다 — 올리기 · 받기 · 지우기 전파 · 되살아나지 않기
//   서버: 환경변수 VS_BASE(기본 http://127.0.0.1:9899 = 시험용 서버 사본 · 키 없음). 없으면 [1][2] 를 건너뛴다.
//   ⚠ 실제 서버(9881)에 대고 돌리지 말 것 — 라이브러리·얼굴을 쓴다.
//   node test/voice-share.test.js
const fs = require('fs'), os = require('os'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const BASE = process.env.VS_BASE || 'http://127.0.0.1:9899';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const M = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8').replace(/\r\n/g, '\n');

// asr-client 를 시험 서버로(tts-config · secret-store 를 바꿔 끼운다 — 키 없음)
const realLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (/tts-config$/.test(req)) return { getProvider: () => ({ baseUrl: BASE }) };
  if (/secret-store$/.test(req)) return { get: () => null };
  return realLoad.apply(this, arguments);
};
const ASR = require('../tts/asr-client');

function loadSync(home, logs) {
  const a = M.indexOf('const VOICE_FACE_DIR = '), b = M.indexOf('function _sampleIndexPath(engine)');
  const src = M.slice(a, b);
  const fakeOs = { homedir: () => home };
  const fakeRequire = (p) => (p === './tts/asr-client' ? ASR : require(p));
  // eslint-disable-next-line no-new-func
  return new Function('require', 'fs', 'path', 'os', 'log', src.replace(/^const VOICE_FACE_DIR/, 'const VOICE_FACE_DIR') + '\nreturn { syncVoiceFaces, _setFace, _faceIndex, _pushFace, VOICE_FACE_DIR, _voiceFileKey };')(fakeRequire, fs, path, fakeOs, (m) => logs.push(m));
}

(async () => {
  let up = false; try { up = !!(await fetch(BASE + '/ref-voices')).ok; } catch (_) {}
  console.log('[0] 소스 — 연결');
  ok(/if \(!p && \/\^srv:\.\/\.test\(String\(p0 \|\| ''\)\)\)[\s\S]{0,200}getServerVoiceAudio/.test(M), '🔑 이 PC 에 파일이 없는 서버 목소리 = 서버 원본(read-audio)');
  ok(/serverNames && serverNames\.deleted/.test(M), '지운 목소리는 시작 동기화가 다시 올리지 않는다');
  const del = (/ipcMain\.handle\('tts-omni-delete'[\s\S]*?\n}\);/.exec(M) || [''])[0];
  ok(/_channelsUsingVoice\(nm\)[\s\S]*?if \(users\.length\) return \{ ok: false/.test(del) && del.indexOf('_channelsUsingVoice') < del.indexOf('deleteServerVoice'), '🔑 채널(화자 포함)이 쓰는 목소리는 서버에 묻기 전에 거절');
  ok(/renameSync\(src, path\.join\(tdir/.test(del) && !/unlinkSync/.test(del), '이 PC 사본은 지우지 않고 _trash 로 옮긴다');
  ok((M.match(/_pushFace\(engine, voice\);/g) || []).length >= 3 && /_pushFace\(engine, toId\)/.test(M), '얼굴 넣기·그리기·지우기·옮기기 모두 서버로');
  ok(/'tts-engines-get', async \(\) => \{\n\s+try \{ await Promise\.race\(\[syncVoiceFaces\(\)/.test(M) && /await syncVoiceFaces\(\); \} catch \{\}   \/\/ 🙂/.test(M), '음성 설정을 열 때 · 앱 시작 때 얼굴 맞추기');
  const D = fs.readFileSync(path.join(ROOT, 'renderer/src/TtsEngineDialog.jsx'), 'utf8');
  ok(/data-testid="tts-voice-del"/.test(D) && /onDelete=\{tab === 'omnivoice' \?/.test(D), '🗑 버튼은 OmniVoice 카드에만');
  ok(/lang: _voiceTextLang\(v\.text, v\.name\)/.test(M), '🌏 OmniVoice 카드에 언어(참조텍스트) — 기존 언어 고르기 칸이 그대로 쓴다');

  if (!up) { console.log(`  · 시험 서버(${BASE}) 없음 — [1][2] 건너뜀`); }
  else {
    console.log('[1] 서버 호출 — 원본 받기 · 휴지통');
    const wav = Buffer.alloc(400, 1); wav.write('RIFF', 0);
    const nm = 'VS_테스트_' + process.pid;
    await ASR.saveServerVoice({ name: nm, text: 'こんにちは。', wavBuffer: wav });
    const got = await ASR.getServerVoiceAudio(nm);
    ok(got && got.equals(wav), '🔑 원본 wav 를 바이트 그대로 받는다(아내 PC 미리듣기 = 메인 PC 와 같은 소리)');
    ok(await ASR.getServerVoiceAudio('없는목소리_' + process.pid) === null, '없는 목소리 = null');
    const d = await ASR.deleteServerVoice(nm);
    const list = await ASR.listServerVoices();
    ok(d.ok && list && !list.some((v) => v.name === nm) && list.deleted.includes(nm), '지우기 = 목록에서 빠지고 지움 표시(deleted)');
    ok(!(await ASR.deleteServerVoice(nm)).ok, '두 번 지우기 = 실패(없는 목소리)');
    await ASR.saveServerVoice({ name: nm, text: 'こんにちは。', wavBuffer: wav });
    const l2 = await ASR.listServerVoices();
    ok(l2.some((v) => v.name === nm) && !l2.deleted.includes(nm), '같은 이름으로 다시 저장하면 살아 있는 목소리');
    await ASR.deleteServerVoice(nm);

    console.log('[2] 얼굴 — PC 두 대');
    const hA = fs.mkdtempSync(path.join(os.tmpdir(), 'vsA-')), hB = fs.mkdtempSync(path.join(os.tmpdir(), 'vsB-'));
    const la = [], lb = [];
    const A = loadSync(hA, la), B = loadSync(hB, lb);
    const voice = 'srv:VS얼굴_' + process.pid;
    const put = (X, buf, t) => { const dir = path.join(X.VOICE_FACE_DIR(), 'omnivoice'); fs.mkdirSync(dir, { recursive: true }); const f = X._voiceFileKey(voice) + '.png'; fs.writeFileSync(path.join(dir, f), buf); fs.utimesSync(path.join(dir, f), new Date(t), new Date(t)); X._setFace('omnivoice', voice, f); return path.join(dir, f); };
    const img1 = Buffer.alloc(300, 3), img2 = Buffer.alloc(320, 9);
    const now = Date.now();
    put(A, img1, now - 60000);
    const r1 = await A.syncVoiceFaces();
    ok(r1.ok && r1.up >= 1, `A(메인 PC)의 얼굴이 서버로 올라간다 (${JSON.stringify(r1)})`);
    const r2 = await B.syncVoiceFaces();
    const bf = B._faceIndex('omnivoice')[voice]; const bp = bf && path.join(B.VOICE_FACE_DIR(), 'omnivoice', bf);
    ok(r2.down >= 1 && bp && fs.readFileSync(bp).equals(img1), `🔑 B(아내 PC)가 그 얼굴을 받는다 (${JSON.stringify(r2)})`);
    const r3 = await B.syncVoiceFaces();
    ok(r3.down === 0 && r3.up === 0, `다시 맞춰도 오가는 것 없음 (${JSON.stringify(r3)})`);
    put(B, img2, now);                       // B 에서 새 얼굴
    await B._pushFace('omnivoice', voice);
    await A.syncVoiceFaces();
    const ap = path.join(A.VOICE_FACE_DIR(), 'omnivoice', A._faceIndex('omnivoice')[voice]);
    ok(fs.readFileSync(ap).equals(img2), '🔑 B 에서 바꾼 얼굴이 A 에도');
    // A 에서 지움 → B 에서도 사라짐 · A 의 옛 사본이 되살아나지 않음
    for (const f of fs.readdirSync(path.dirname(ap))) if (f !== 'index.json') fs.unlinkSync(path.join(path.dirname(ap), f));
    A._setFace('omnivoice', voice, null); await A._pushFace('omnivoice', voice);
    const r4 = await B.syncVoiceFaces();
    ok(r4.gone >= 1 && !B._faceIndex('omnivoice')[voice], `🔑 A 에서 지운 얼굴이 B 에서도 지워진다 (${JSON.stringify(r4)})`);
    const old = put(B, img1, now - 120000);  // B 에 지움보다 옛날 사본이 남아 있으면
    const r5 = await B.syncVoiceFaces();
    ok(!fs.existsSync(old) && r5.up === 0, '지움보다 오래된 사본은 다시 올리지 않고 치운다(되살아나지 않음)');
    // 서버가 꺼져 있으면 아무것도 지우지 않는다
    put(A, img1, Date.now());
    const prev = process.env.VS_BASE;
    const OFF = loadSync(hA, la);
    Module._load = function (req) { if (/tts-config$/.test(req)) return { getProvider: () => ({ baseUrl: 'http://127.0.0.1:1' }) }; return realLoad.apply(this, arguments); };
    delete require.cache[require.resolve('../tts/asr-client')];
    const ASR2 = require('../tts/asr-client');
    ok(await ASR2.getServerFaces() === null, '서버가 꺼지면 목록 = null(빈 목록과 구분)');
    ok(!!A._faceIndex('omnivoice')[voice], '그때 이 PC 얼굴은 그대로');
    void OFF; void prev;
    await A._pushFace('omnivoice', voice).catch(() => {});
    try { fs.rmSync(hA, { recursive: true, force: true }); fs.rmSync(hB, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(`\n${fail ? '❌' : '✅'} voice-share ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
