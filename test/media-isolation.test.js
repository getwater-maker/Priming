'use strict';
/**
 * node test/media-isolation.test.js — 🔒 합치기·나누기를 해도 **다른 그룹·문장의 그림·영상·음성은 그대로**(v0.5.86)
 *   로이 2026-09-29: "클립을 통합하고 나눈다 하여도 그것 이외의 것들의 이미지 비디오 TTS 는 변화가 없어야지."
 *   · 음성: 문장을 나누면 뒤 문장 번호가 밀리지만 파일 이름(<번호>.wav)은 그대로다 → 새 문장이 그 번호로 쓰면 이웃 음성을 덮었다.
 *     🔑 fillTtsList **원문을 실제로 돌린다**(가짜 TTS 서버 · 임시 폴더 · 임시 HOME).
 *   · 그림·영상: 새로 쓰는 모든 자리(엔진·캐시·Flow 매핑)가 claimPath 를 거치고, 번호로 다시 잇기(relink)는 남의 파일을 집지 않는다.
 *   · 📥 Flow 는 %TEMP% 가 아니라 대본 폴더 안 _받기 에 받고, 못 옮긴 파일은 지우지 않는다.
 */
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function wav(samples, amp) {
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * amp), 44 + i * 2);
  return b;
}

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-home-'));
  const realHomedir = os.homedir;
  os.homedir = () => home;
  for (const m of ['core/tts-cache.js', 'core/media-cache.js', 'core/pipeline.js']) { try { delete require.cache[require.resolve(path.join(ROOT, m))]; } catch {} }
  const P = require(path.join(ROOT, 'core/pipeline.js'));

  console.log('\n[1] claimPath — 남의 파일 위에 쓰지 않는다');
  {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-claim-'));
    const f = (n) => path.join(d, n);
    ok(P.claimPath(f('05.png'), null) === f('05.png'), '빈 자리면 그 이름');
    fs.writeFileSync(f('05.png'), 'x');
    ok(P.claimPath(f('05.png'), f('05.png')) === f('05.png'), '자기 파일이면 그대로(다시 만들기)');
    ok(P.claimPath(f('05.png'), null) === f('05_2.png'), '남의 파일이면 05_2.png');
    ok(P.claimPath(f('05.jpg'), null, P.IMG_EXTS) === f('05_2.jpg'), '확장자가 달라도(05.png 가 있으면 05.jpg 도) 비켜 쓴다');
    fs.writeFileSync(f('05_2.png'), 'x');
    ok(P.claimPath(f('05.png'), null) === f('05_3.png'), '05_2 도 차 있으면 05_3');
    fs.rmSync(d, { recursive: true, force: true });
  }

  console.log('\n[2] 🔴 문장 나누기 뒤 새 음성 — 이웃 문장 음성이 덮이지 않는다(fillTtsList 원문)');
  {
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-tts-'));
    const OLD = wav(24000, 3000), NEW = wav(12000, 9000);
    // 문장 1~5 에 음성 1~5.wav → 문장 2 를 둘로 나눔: 새 2·3(음성 없음) · 옛 3·4·5 는 번호 4·5·6 이 되지만 파일은 3·4·5.wav
    const sents = [];
    for (let i = 1; i <= 5; i++) { const fp = path.join(wd, `${i}.wav`); fs.writeFileSync(fp, OLD); sents.push({ num: i, text: `옛 문장 ${i}.`, ttsAudioPath: fp, ttsDurationSec: 1 }); }
    const [s1, , s3, s4, s5] = sents;
    const list = [s1, { num: 2, text: '새 앞 조각.' }, { num: 3, text: '새 뒤 조각.' }, s3, s4, s5];
    list.forEach((s, i) => { s.num = i + 1; });
    const before = new Map(list.filter((s) => s.ttsAudioPath).map((s) => [s, fs.readFileSync(s.ttsAudioPath)]));
    const mgr = { processText: (t) => t, prepareDict: async () => {}, synthesize: async () => ({ mp3Buffer: NEW, durationSec: 0.5, format: 'wav' }) };
    const preset = { voiceCloneRefAudio: 'srv:테스트', seed: 1, language: 'ko', ttsNormalize: false };
    const r = await P.fillTtsList(list, preset, mgr, wd, () => {}, null, 1, '테스트', null);
    ok(r.failed.length === 0 && list.every((s) => s.ttsAudioPath && fs.existsSync(s.ttsAudioPath)), '6문장 모두 음성 있음');
    const same = [...before].every(([s, buf]) => fs.readFileSync(s.ttsAudioPath).equals(buf));
    ok(same, '🔑 나누지 않은 문장 1·4·5·6 의 음성 파일 내용이 **그대로**');
    ok(path.basename(list[2].ttsAudioPath) === '3_2.wav' && path.basename(s3.ttsAudioPath) === '3.wav', `새 문장 3 은 3_2.wav 에 (옛 3번 = 지금 4번은 3.wav 그대로) — ${path.basename(list[2].ttsAudioPath)}`);
    ok(new Set(list.map((s) => path.resolve(s.ttsAudioPath).toLowerCase())).size === list.length, '두 문장이 한 파일을 가리키지 않는다');
    // 판정력(A/B): 같은 원문에서 claimPath 만 「그 이름 그대로」로 바꿔 돌리면 옛 4번(3.wav) 음성이 덮인다
    const Module = require('module');
    const src = read('core/pipeline.js').replace('function claimPath(want, own, exts) {', 'function claimPath(want) { return want; }\nfunction _claimOff(want, own, exts) {');
    const mod = new Module(path.join(ROOT, 'core', 'pipeline.js'), module);
    mod.filename = path.join(ROOT, 'core', 'pipeline.js'); mod.paths = Module._nodeModulePaths(path.join(ROOT, 'core'));
    mod._compile(src, mod.filename);
    const wd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-tts-old-'));
    const s2 = [];
    for (let i = 1; i <= 5; i++) { const fp = path.join(wd2, `${i}.wav`); fs.writeFileSync(fp, OLD); s2.push({ num: i, text: `옛 문장 ${i}.`, ttsAudioPath: fp, ttsDurationSec: 1 }); }
    const l2 = [s2[0], { num: 2, text: '새 앞 조각 둘.' }, { num: 3, text: '새 뒤 조각 둘.' }, s2[2], s2[3], s2[4]];
    l2.forEach((s, i) => { s.num = i + 1; });
    await mod.exports.fillTtsList(l2, preset, mgr, wd2, () => {}, null, 1, '테스트', null);
    ok(!fs.readFileSync(s2[2].ttsAudioPath).equals(OLD), '(A/B) 가드를 빼면 옛 3번(지금 4번) 음성이 새 문장 음성으로 덮인다 — 위 검사는 헛단언이 아니다');
    fs.rmSync(wd, { recursive: true, force: true }); fs.rmSync(wd2, { recursive: true, force: true });
  }

  console.log('\n[3] 그림·영상 쓰기 자리 — 전부 claimPath 를 거친다(소스 전수)');
  {
    const M = read('main.js'), PL = read('core/pipeline.js');
    // 그룹 번호로 이름을 지어 **새로 쓰는** 자리: out/dest/base = path.join(<폴더>, …padStart…)
    const bare = (src) => src.split('\n').filter((l) => /\b(out|dest|base|outputPath)\s*=\s*path\.join\([^;]*padStart\(2, '0'\)/.test(l) && !/claimPath/.test(l));
    ok(bare(M).length === 0, `main.js — 번호 이름으로 바로 쓰는 자리 0 (${bare(M).map((l) => l.trim().slice(0, 60)).join(' | ') || '없음'})`);
    ok(bare(PL).length === 0 && /outputPaths = idx\.map\(\(i\) => claimPath\(/.test(PL), 'pipeline.js — Genspark 이미지 · Grok 영상도 claimPath');
    const ttsBare = PL.split('\n').filter((l) => /path\.join\(workDir, `\$\{s\.num\}\./.test(l) && !/claimPath/.test(l) && !/fillSilent|_raw_/.test(l));
    const silentLines = PL.slice(PL.indexOf('function fillSilent('), PL.indexOf('function fillSilent(') + 400);
    ok(ttsBare.filter((l) => !silentLines.includes(l.trim())).length === 0, 'TTS 저장 자리(캐시 복사·배속·정속·폴백) 전부 claimPath');
    const nClaim = (M.match(/P\.claimPath\(/g) || []).length;
    ok(nClaim >= 10, `main.js claimPath 호출 ${nClaim}곳(배치 수거·Flow 이미지·Flow 영상·나노바나나·ComfyUI 이미지·Grok API·ComfyUI 영상·Genspark 영상·Flow 매핑·캐시 프리필)`);
    ok((M.match(/!_usedByOther\(pr, g, x\)/g) || []).length === 3, '번호로 다시 잇기 3곳(그림·영상 relink · autoRelinkVideos)이 남의 파일을 집지 않는다');
    ok(/if \(_usedByOther\(project, g, out\)\)/.test(M), '업스케일본(NN_1080.mp4)도 이웃 것 위에 쓰지 않는다');
  }

  console.log('\n[4] 번호 다시 잇기 — 이웃 그룹이 쓰는 파일은 집지 않는다(원문 실행)');
  {
    const M = read('main.js');
    const grab = (name) => { const i = M.indexOf('function ' + name + '('); const j = M.indexOf('\n}\n', i) + 3; return M.slice(i, j); };
    const ctx = { fs, path, console };
    vm.createContext(ctx);
    vm.runInContext(grab('_usedByOther') + grab('autoRelinkVideos') + '\nthis.api = { autoRelinkVideos, _usedByOther };', ctx);
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-relink-'));
    const f = (n) => { const p = path.join(d, n); fs.writeFileSync(p, 'x' + n); return p; };
    // G4 는 영상이 없고 폴더엔 04.mp4 가 있지만 그건 G5 가 쓰는 파일(번호가 밀린 뒤)
    const pr = { groups: [{ num: 4, imagePath: f('04.png') }, { num: 5, imagePath: f('05.png'), videoPath: f('04.mp4') }] };
    const n = ctx.api.autoRelinkVideos(pr, d);
    ok(n === 0 && !pr.groups[0].videoPath, 'G5 가 쓰는 04.mp4 를 G4 에 잇지 않는다');
    f('06.mp4'); const pr2 = { groups: [{ num: 6, imagePath: f('06.png') }] };
    ok(ctx.api.autoRelinkVideos(pr2, d) === 1, '아무도 안 쓰는 06.mp4 는 예전처럼 다시 잇는다(동작 유지)');
    fs.rmSync(d, { recursive: true, force: true });
  }

  console.log('\n[5] 📥 Flow 받기 폴더 — %TEMP% 가 아니라 대본(.vrew) 폴더 안 · 못 옮긴 파일은 남긴다');
  {
    const M = read('main.js'), FE = read('flow-engine.js');
    const body = (name) => { const i = M.indexOf('async function ' + name + '('); return M.slice(i, M.indexOf('\n}\n', i)); };
    ok(!/os\.tmpdir\(\)/.test(body('runFlowImages')) && /_flowStageDir\(imagesDir,/.test(body('runFlowImages')), 'Flow 이미지 — 임시폴더 안 씀');
    ok(!/os\.tmpdir\(\)/.test(body('runFlowVideos')) && /_flowStageDir\(mediaDir,/.test(body('runFlowVideos')), 'Flow 영상 — 임시폴더 안 씀');
    ok(!/rmSync\(workDir/.test(body('runFlowImages') + body('runFlowVideos')), '받기 폴더를 무조건 지우지 않는다(_flowUnstage 만)');
    ok(/this\._dlDir = \(config && config\.outputDir\)/.test(FE) && (FE.match(/path\.join\(this\._dlDir \|\| os\.tmpdir\(\)/g) || []).length === 2, 'Flow 엔진 내부 다운로드도 받기 폴더에');
    const grab = (name) => { const i = M.indexOf('function ' + name + '('); const j = M.indexOf('\n}\n', i) + 3; return M.slice(i, j); };
    const ctx = { fs, path, console }; vm.createContext(ctx);
    vm.runInContext(grab('_flowStageDir') + grab('_flowUnstage') + '\nthis.api = { _flowStageDir, _flowUnstage };', ctx);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-stage-'));
    const media = path.join(root, 'media-1'); fs.mkdirSync(media);
    const w = ctx.api._flowStageDir(media, 'flow_a_1');
    ok(path.dirname(path.dirname(w)) === root && fs.existsSync(path.join(w, 'images')), '받기 폴더 = <대본 폴더>/_받기/<실행>/images (media-1 옆)');
    fs.writeFileSync(path.join(w, 'images', '01_a.png'), 'x'); fs.writeFileSync(path.join(w, 'images', '02_b.png'), 'x');
    const logs = [];
    ok(ctx.api._flowUnstage(w, path.join(w, 'images'), /\.png$/i, 1, (m) => logs.push(m)) === false && fs.existsSync(path.join(w, 'images', '02_b.png')), '🔑 2장 받아 1장만 옮겼으면 받기 폴더를 **남긴다**(크레딧 쓴 결과물)');
    ok(/지우지 않고 남겨 둡니다/.test(logs.join('')), '어디 남겼는지 로그로 알린다');
    ok(ctx.api._flowUnstage(w, path.join(w, 'images'), /\.png$/i, 2, null) === true && !fs.existsSync(path.join(root, '_받기')), '다 옮겼으면 받기 폴더(빈 _받기 까지) 치운다');
    fs.rmSync(root, { recursive: true, force: true });
  }

  os.homedir = realHomedir;
  try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  console.log(`\n${fail ? '❌' : '✅'} media-isolation ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
