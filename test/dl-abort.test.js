'use strict';
/**
 * node test/dl-abort.test.js — 📥 대본다운·STT 는 제작과 **중단 플래그·GPU 를 따로** 쓴다(v0.5.104 · 로이 2026-10-01 「작업 도중 대본다운로드도 되나」)
 *   예전엔 S.abort 를 같이 써서 ① 받기를 시작하면 제작에 걸어 둔 중단 요청이 풀렸고 ② 받기 패널 ⏹ 가 돌고 있는 제작까지 멈췄고
 *   ③ 전사가 제작(TTS)과 같은 서버 GPU 를 동시에 써 TTS 문장이 시간초과로 빠질 수 있었다.
 *   이 저장소 관례대로 main.js·preload·화면의 **원문**을 읽어 배선을 단언한다(핸들러 본문 추출).
 */
const fs = require('fs'), path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const M = R('main.js'), PRE = R('preload.js'), APP = R('renderer/src/App.jsx');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const body = (marker) => { const a = M.indexOf(marker); if (a < 0) return ''; const b = M.indexOf('\n});\n', a); return M.slice(a, b + 5); };

console.log('\n[1] 받기·전사 핸들러는 제작의 S.abort 를 읽지도 쓰지도 않는다');
for (const [ch, mk] of [['stt-from-url', "ipcMain.handle('stt-from-url'"], ['stt-transcribe', "ipcMain.handle('stt-transcribe'"], ['extract-mp3', "ipcMain.handle('extract-mp3'"]]) {
  const b = body(mk);
  ok(b.length > 200 && !/S\.abort/.test(b) && /_dlAbort/.test(b), `${ch}: S.abort 없음 · _dlAbort 사용 (${(b.match(/_dlAbort/g) || []).length}곳)`);
}
const tt = M.slice(M.indexOf('async function transcribeToTxt'), M.indexOf('/** Whisper 서버 상태를'));
ok(!/S\.abort/.test(tt) && /abortSignal: \(\) => _dlAbort/.test(tt), 'transcribeToTxt: 중단 = _dlAbort');

console.log('\n[2] 전사는 제작(TTS)과 같은 GPU 레인 — 겹치지 않는다');
ok(/_runOnLanes\(\['localGpu'\], 'STT 전사'/.test(tt), 'transcribeToTxt 의 전사 호출이 localGpu 레인(TTS 와 직렬)');
ok(/tts', 'localGpu'\]/.test(M), '기준: TTS 작업도 localGpu 레인을 잡는다(이 레인에 줄을 서면 겹치지 않는다)');
ok(tt.indexOf('extractAudioMp3') < tt.indexOf("_runOnLanes(['localGpu']"), '오디오 추출(CPU)은 레인 밖 — 받기·추출은 제작과 겹쳐 진행, 전사만 줄을 선다');

console.log('\n[3] 중단 버튼');
const dlAt = M.indexOf("ipcMain.handle('dl-abort'");
const dl = dlAt < 0 ? '' : M.slice(dlAt, M.indexOf('\n', dlAt));   // 한 줄 핸들러
ok(dl.length > 20 && !/S\.abort/.test(dl) && /_dlAbort = true/.test(dl), 'dl-abort: _dlAbort 만 켠다(제작 무관)');
const ab = body("ipcMain.handle('abort'");
ok(/S\.abort = true;/.test(ab) && /if \(_awake\.n - _dlActive <= 0\) _dlAbort = true;/.test(ab), 'abort(헤더 ■): 제작 중단 + 제작이 없을 때만 받기도 중단');
ok(/_dlActive\+\+;/.test(body("ipcMain.handle('stt-from-url'")) && /finally \{ _dlActive--; \}/.test(body("ipcMain.handle('stt-from-url'")), '받기 중 카운터(_dlActive)가 finally 로 풀린다');
ok(/dlAbort: \(\) => ipcRenderer\.invoke\('dl-abort'\)/.test(PRE), 'preload: dlAbort');
ok(/onAbort=\{\(\) => \{ api\.dlAbort\(\); setUrlProg/.test(APP), '받기 패널 ⏹ → api.dlAbort (제작을 멈추지 않는다)');
ok(!/onAbort=\{\(\) => \{ abort\(\); setUrlProg/.test(APP), '옛 배선(abort()) 제거');

console.log('\n[4] 버전 표시 — 소수 둘째 자리까지');
ok(/const shortVer = /.test(APP) && /v\{shortVer\(appVersion\)\}/.test(APP), '헤더 버전은 shortVer(appVersion)');
const sv = new Function(APP.match(/const shortVer = [^\n]*/)[0] + '; return shortVer;')();
ok(sv('0.5.103') === '5.10' && sv('0.5.99') === '5.99' && sv('0.5.9') === '5.9' && sv('0.6.0') === '6.0' && sv('') === '', `0.5.103→${sv('0.5.103')} · 0.5.99→${sv('0.5.99')} · 0.5.9→${sv('0.5.9')} · 0.6.0→${sv('0.6.0')}`);

console.log(`\n${fail ? '❌' : '✅'} dl-abort — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
