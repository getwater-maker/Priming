'use strict';
// node test/vrew-audio.test.js — 「출력 방식 3가지」 + 「Vrew 음성 가져오기」 검증.
//   로이 요청(2026-09-03): ① TTS 를 Vrew 에서 만들고 싶다 → 이미지만 든 .vrew 를 내보내고
//   Vrew 에서 음성을 입힌 뒤 되가져온다  ② 이미지를 안 쓰는 편은 음성만 든 .vrew 를 내보낸다.
//   지키려는 것:
//     ① 게이트 판정을 **한 곳**(gateVisual/gateTts)에서만 한다 — 두 경로가 각자 판단하면 어긋난다
//     ② 「음성만/화면만」은 게이트만 푸는 게 아니라 **그 단계를 실제로 건너뛴다**(쓰지도 않을 것을
//        수십 분 만들고 버리지 않게)
//     ③ 「화면만」의 무음은 **tts-N 을 오염시키지 않는다** — 남으면 나중에 「전체」가 그것을
//        「이미 있음」으로 건너뛰어 **무음 영상이 조용히 나간다**
//     ④ 가져오기는 자막이 어긋나면 **아무것도 바꾸지 않고 멈춘다**(엉뚱한 음성이 붙는 것보다 낫다)
//   🔑 로직을 복사하지 않는다 — **원문 모듈·원문 소스**를 그대로 쓴다.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'App.jsx'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const VASRC = fs.readFileSync(path.join(ROOT, 'core', 'vrew-audio.js'), 'utf8');
const VA = require(path.join(ROOT, 'core', 'vrew-audio'));
const P = require(path.join(ROOT, 'core', 'pipeline'));
const media = require(path.join(ROOT, 'core', 'media-utils'));

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };

/** main.js 원문에서 함수를 뽑아 실행 — 복사본을 두면 앱과 갈라져도 통과한다. */
function extract(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' 를 찾을 수 없습니다');
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

// ── [1] 판정 헬퍼 — main.js 원문 실행 ──
const helpers = new Function(
  'const OUT_MODES = new Set([\'full\',\'audio\',\'visual\']);\n'
  + extract(MAIN, 'normOutMode') + '\n' + extract(MAIN, 'gateVisual') + '\n' + extract(MAIN, 'gateTts') + '\n'
  + extract(MAIN, 'outModeLabel') + '\n'
  + 'return { normOutMode, gateVisual, gateTts, outModeLabel };')();

ok(helpers.normOutMode('full') === 'full', 'full 통과');
ok(helpers.normOutMode('audio') === 'audio', 'audio 통과');
ok(helpers.normOutMode('visual') === 'visual', 'visual 통과');
ok(helpers.normOutMode(undefined) === 'full', '값이 없으면 전체(기본값이 안전한 쪽)');
ok(helpers.normOutMode('이상한값') === 'full', '모르는 값이면 전체');
ok(helpers.normOutMode(null) === 'full', 'null 이면 전체');
// 🔴 게이트 방향 — 뒤집히면 반쪽 .vrew 가 나간다
ok(helpers.gateVisual('full') === true && helpers.gateTts('full') === true, '전체 = 두 게이트 다 본다');
ok(helpers.gateVisual('audio') === false, '🎤 음성만 = 이미지 게이트를 보지 않는다');
ok(helpers.gateTts('audio') === true, '🎤 음성만 = **음성 게이트는 그대로 본다**(반쪽 음성 방지)');
ok(helpers.gateTts('visual') === false, '🖼 화면만 = 음성 게이트를 보지 않는다');
ok(helpers.gateVisual('visual') === true, '🖼 화면만 = **이미지 게이트는 그대로 본다**(반쪽 화면 방지)');
ok(helpers.gateVisual('이상한값') === true && helpers.gateTts('이상한값') === true, '모르는 값이면 둘 다 검사(fail-safe)');
ok(/음성만/.test(helpers.outModeLabel('audio')) && /화면만/.test(helpers.outModeLabel('visual')), '라벨이 사람 말');

// ── [2] 배선 — 게이트가 두 경로에서 모두 헬퍼를 쓰는지(원문 대조) ──
ok((MAIN.match(/gateVisual\(outMode\) \? missingVisualGroups\(pr\)/g) || []).length === 2, '이미지 게이트 2곳(💾·⚡) 모두 gateVisual 경유');
ok((MAIN.match(/gateTts\(outMode\) \? missingTtsNums\(pr\)/g) || []).length === 2, '음성 게이트 2곳 모두 gateTts 경유');
ok(!/\n\s+const miss = missingVisualGroups\(pr\);/.test(MAIN), '🔴 게이트를 직접 부르는 옛 코드가 남지 않았다');
ok(!/\n\s+const mtts4? = missingTtsNums\(pr\);/.test(MAIN), '🔴 음성 게이트도 직접 호출이 남지 않았다');
ok((MAIN.match(/await buildForMode\(outMode, pr, build\)/g) || []).length === 2, '빌드 2곳 모두 buildForMode 를 거친다(판정 한 곳)');
ok(/if \(m === 'visual'\) return withSilentTts/.test(MAIN), '🖼 화면만 → 음성 자리를 무음으로 감싼다');
ok(/if \(m === 'audio'\) return withoutVisuals/.test(MAIN), '🔴 🎤 음성만 → 이미지·비디오를 .vrew 에 넣지 않는다');
ok(/outMode: \(common\.outMode != null \? common\.outMode/.test(MAIN), '큐(run-batch)는 헤더 우선으로 outMode 를 넘긴다');
ok(/const skipTts = \(outMode === 'visual'\)/.test(MAIN) && /const skipVisual = \(outMode === 'audio'\)/.test(MAIN), '단계 스킵 플래그가 있다');
ok(/if \(skipTts\) \{[\s\S]{0,400}음성 건너뜀/.test(MAIN), '🖼 화면만 = TTS 단계를 건너뛴다(로그로 알린다)');
ok(/\} else if \(skipVisual\) \{[\s\S]{0,300}이미지 건너뜀/.test(MAIN), '🎤 음성만 = 이미지 단계를 건너뛴다');
ok(/if \(skipVisual\) \{\s*\n\s*log\('🎬 3단계 — 비디오 건너뜀/.test(MAIN), '🎤 음성만 = 비디오 단계도 건너뛴다');
ok(/if \(!dry && !skipTts && preset\)/.test(MAIN), '🖼 화면만이면 TTS 서버에 연결하지 않는다(꺼져 있어도 진행)');

// ── [3] 무음이 tts-N 을 오염시키지 않는지 — withSilentTts 원문 실행 ──
{
  // ⚠ extract 는 `function 이름(` 부터 자르므로 `async` 가 빠진다 — 다시 붙여야 await 가 유효하다.
  ok(/async function withSilentTts\(/.test(MAIN), 'withSilentTts 는 async 함수');
  const fn = new Function('fs', 'path', 'os', 'P', 'async ' + extract(MAIN, 'withSilentTts') + '\nreturn withSilentTts;')(fs, path, os, P);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'silent-'));
  const ttsDir = path.join(tmp, 'tts-1');
  fs.mkdirSync(ttsDir, { recursive: true });
  const real = path.join(ttsDir, '1.mp3');
  fs.writeFileSync(real, 'REAL-AUDIO');
  const pr = { sentences: [{ num: 1, text: '가', charCount: 1, ttsAudioPath: real, ttsDurationSec: 9.9 }, { num: 2, text: '나', charCount: 1, ttsAudioPath: null, ttsDurationSec: null }] };
  let insidePaths = null;
  const r = fn(pr, async () => {
    insidePaths = pr.sentences.map((s) => s.ttsAudioPath);
    ok(pr.sentences.every((s) => s.ttsAudioPath && fs.existsSync(s.ttsAudioPath)), '빌드 중에는 모든 문장에 음성이 있다(무음)');
    ok(pr.sentences.every((s) => s.ttsDurationSec > 0), '무음도 길이를 갖는다(빌더가 타임라인을 만들 수 있게)');
    return 'BUILT';
  });
  r.then(() => {
    ok(insidePaths && insidePaths.every((p) => !p.startsWith(ttsDir)), '🔴 무음은 tts-N **밖**(임시 폴더)에 만든다');
    ok(pr.sentences[0].ttsAudioPath === real && pr.sentences[0].ttsDurationSec === 9.9, '🔴 끝나면 원래 음성 경로·길이로 되돌아온다');
    ok(pr.sentences[1].ttsAudioPath === null, '없던 문장은 다시 없음으로 되돌아온다');
    ok(fs.readFileSync(real, 'utf8') === 'REAL-AUDIO', '🔴 기존 음성 파일을 덮어쓰지 않았다');
    ok(fs.readdirSync(ttsDir).length === 1, '🔴 tts-N 에 무음이 남지 않았다 (실제 ' + fs.readdirSync(ttsDir).join(',') + ')');
    ok(insidePaths && !fs.existsSync(insidePaths[1]), '임시 무음 폴더는 정리됐다');
    fs.rmSync(tmp, { recursive: true, force: true });
    stage2();
  });
}

// ── [4]~[6] 은 비동기 왕복이라 순서를 지켜 실행 ──
function stage2() {
  // ── [4] vrew-audio 모듈 위생 ──
  ok(typeof VA.readVrewClips === 'function' && typeof VA.importVrewAudio === 'function', '모듈이 필요한 함수를 export');
  ok(/words \|\| \[\]\)\.flatMap/.test(VASRC) || /\(\(c\.words\) \|\| \[\]\)\.flatMap/.test(VASRC), '🔴 clip.words[].assetIds 를 훑는다 (여기가 음성이 붙는 자리)');
  ok(!/writeZip|addFile|addLocalFile/.test(VASRC), '🔴 .vrew 를 쓰지 않는다 — 읽기 전용');
  ok(/normText/.test(VASRC) && /normLoose/.test(VASRC), '정규화가 문장부호를 무시한다(Vrew 자막엔 마침표가 없다)');
  ok(/minRate/.test(VASRC) && /게이트/.test(VASRC) && /주입 전에/.test(VASRC), '주입 전에 게이트를 검사한다');
  ok(/clipRate = clips\.length \? usedClips \/ clips\.length/.test(VASRC), '🔴 게이트 기준이 「문장」이 아니라 「clip」이다(일부만 만든 경우를 막지 않게)');
  ok(/entryOf\.get\(mediaId\)/.test(VASRC), '🔴 zip 엔트리를 mediaId 로 찾는다(files[].name 은 사람이 읽는 이름일 수 있다)');
  ok(/sourceFileType === 'TTS'/.test(VASRC), 'Vrew 의 TTS 표시를 음성 판정에 쓴다');
  ok(/clipWords/.test(VASRC) && /captions 보다 이걸 믿는다/.test(VASRC), '🔴 자막 텍스트를 words 에서 읽는다(captions 는 어긋날 수 있다)');
  ok(/concatAudio/.test(VASRC), '한 문장이 clip 여러 개면 음성을 이어붙인다');
  ok((VASRC.match(/\r\n/g) || []).length === 0, 'core/vrew-audio.js 줄끝 LF');
  ok(VASRC.indexOf(String.fromCharCode(0)) < 0, 'NUL 바이트 없음');

  // 배선
  ok(/importVrewAudio: \(args\) => ipcRenderer\.invoke\('import-vrew-audio', args\)/.test(PRELOAD), 'preload 배선');
  ok(/ipcMain\.handle\('import-vrew-audio'/.test(MAIN), 'main IPC 존재');
  ok(/probeDur: \(f\) => media\.getMediaDuration\(f\)/.test(MAIN), '🔴 길이를 실측한다(파일 크기 추정은 4배까지 틀린다)');
  ok(/const \[outMode, setOutMode\] = useState\('full'\)/.test(APP), '렌더러 state 기본값 = 전체');
  ok((APP.match(/outMode/g) || []).length >= 8, '렌더러가 outMode 를 실제로 배선한다');
  ok(/aiNotice, outMode \}/.test(APP), '큐(common)에 outMode 를 실어 보낸다');
  ok(/engine: imgEngine, outMode \}/.test(APP), '💾 .vrew 에도 outMode 를 넘긴다');
  ok(/outMode,  \/\/ 전체 \/ 음성만 \/ 화면만/.test(APP), '⚡ 만들기에도 넘긴다');
  ok(/_needImg = \(outMode === 'audio'\) \? 'none' : 'all'/.test(APP), '🎤 음성만은 이미지 프롬프트를 요구하지 않는다');
  ok(/📥 Vrew 음성<\/button>/.test(APP), '작업바에 「📥 Vrew 음성」 버튼');
  ok(/<option value="audio">🎤 음성만<\/option>/.test(APP) && /<option value="visual">🖼 화면만<\/option>/.test(APP), '출력 select 3항목');
  ok((APP.match(/<option value="visual">/g) || []).length === 1, '출력 select 는 **한 곳**만(진입점 이중화 금지)');

  // 번들 반영 — 소스만 고치고 빌드를 잊으면 화면은 옛것이다
  try {
    const dist = path.join(ROOT, 'renderer', 'dist', 'assets');
    const js = fs.readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dist, f), 'utf8')).join('');
    ok(/Vrew 음성/.test(js), '빌드된 번들에 새 UI 가 들어있다(vite build 를 돌렸다)');
  } catch (_) { ok(false, '번들을 읽을 수 없다'); }

  stage3();
}

// ── [5]·[6] 실제 왕복 ──
function stage3() {
  const SCRIPT = [
    '# 왕복 테스트 대본', '', '## 첫째 마당', '', '### 도입부', '',
    '어떤 사람은 말을 아낀다. 그 침묵이 오히려 힘이 된다.', '', '### 본론 하나', '',
    '급하게 말하면 속이 다 보인다. 한 박자만 늦추면 상대가 먼저 움직인다.', '',
    '## 둘째 마당', '', '### 마무리', '', '오늘 배운 것을 한 문장으로 남긴다. 그 한 줄이 다음을 바꾼다.', '',
  ].join('\n');

  (async () => {
    const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vatest-'));
    try {
      const sp = path.join(TMP, '[왕복_0000] 테스트.md');
      fs.writeFileSync(sp, SCRIPT, 'utf8');
      const preset = P.getPreset(null);

      // ① 「화면만」이 만들 .vrew 와 같은 것 — 무음 + 이미지 없음
      const pr1 = P.parseScript(sp, 'longform').projects[0];
      P.fillSilent(pr1, path.join(TMP, '_silent'));
      const vrew = path.join(TMP, 'stage1.vrew');
      const r1 = await P.buildProjectVrew(pr1, vrew, preset, () => {}, 20);
      ok(r1.clipCount === pr1.sentences.length, `무음만으로도 clip 이 문장 수만큼 생긴다 (${r1.clipCount}/${pr1.sentences.length})`);
      ok(r1.imageCount === 0, '이미지 없이도 .vrew 가 만들어진다');

      // ② 읽기 — clip 별 자막·음성을 뽑는다
      const { clips, warn } = VA.readVrewClips(vrew);
      ok(clips.length === pr1.sentences.length, `clip 을 다 읽었다 (${clips.length})`);
      ok(clips.every((c) => c.mediaName), '모든 clip 에서 음성 파일을 찾았다');
      ok(clips.every((c) => c.caption), '모든 clip 에서 자막을 읽었다');
      ok(warn.length === 0, '경고 없음 (음성 후보가 하나씩만 걸렸다)');
      ok(VA.clipCaption({ captions: [{ text: [{ insert: '가 나' }] }, { text: [{ insert: '다\n' }] }] }) === '가 나다', '자막 줄들을 이어붙여 문장으로 만든다');

      // ③ 가져오기 — 새로 파싱한(음성 없는) 대본에 물려준다
      const pr2 = P.parseScript(sp, 'longform').projects[0];
      const ttsDir = path.join(TMP, 'tts-1');
      const rep = await VA.importVrewAudio(pr2, vrew, ttsDir, { probeDur: (f) => media.getMediaDuration(f) });
      ok(rep.injected === pr2.sentences.length, `🔴 문장 전부에 음성이 연결됐다 (${rep.injected}/${rep.total})`);
      ok(rep.rate === 1, `일치율 100% (실제 ${(rep.rate * 100).toFixed(1)}%)`);
      ok(rep.missing.length === 0 && rep.noAudio.length === 0, '못 찾은 문장 없음');
      ok(pr2.sentences.every((s) => s.ttsAudioPath && fs.existsSync(s.ttsAudioPath)), '주입된 경로에 파일이 실제로 있다');
      ok(pr2.sentences.every((s) => s.ttsDurationSec > 0), '길이가 주입됐다(빌더가 타임라인을 만들 수 있다)');
      ok(pr2.sentences.every((s) => s.ttsAudioPath.startsWith(ttsDir)), '🔴 작업폴더로 **복사**했다(원본 .vrew 를 가리키지 않는다)');
      // 순서가 뒤섞이지 않았는지 — 자막과 문장이 1:1 로 맞아야 한다
      const order = pr2.sentences.map((s) => path.basename(s.ttsAudioPath));
      ok(new Set(order).size === order.length, '🔴 서로 다른 문장에 같은 파일이 붙지 않았다');

      // ④ 그 상태로 다시 빌드 — 이후 기존 파이프라인이 그대로 도는가
      const vrew2 = path.join(TMP, 'stage2.vrew');
      const r2 = await P.buildProjectVrew(pr2, vrew2, preset, () => {}, 20);
      ok(r2.clipCount === r1.clipCount, `재빌드 clip 수 일치 (${r2.clipCount})`);

      // ⑤ 추출이 음성을 손상시키지 않았는지 — 바이트 비교
      const z = VA.readVrewClips(vrew);
      const orig = z.zip.getEntry('media/' + z.clips[0].mediaName).getData();
      ok(Buffer.compare(orig, fs.readFileSync(pr2.sentences[0].ttsAudioPath)) === 0, '🔴 추출 음성이 원본과 바이트 동일');

      // ⑥ 🔴 매칭률 게이트 — 자막이 어긋나면 아무것도 바꾸지 않고 멈춘다
      const pr3 = P.parseScript(sp, 'longform').projects[0];
      for (const s of pr3.sentences) s.text = '전혀 다른 문장 ' + s.num;   // 대본이 바뀐 상황
      const before = pr3.sentences.map((s) => s.ttsAudioPath);
      let threw = null;
      try { await VA.importVrewAudio(pr3, vrew, path.join(TMP, 'tts-x'), { probeDur: (f) => media.getMediaDuration(f) }); }
      catch (e) { threw = e; }
      ok(!!threw, '🔴 자막이 맞지 않으면 던진다');
      ok(threw && /맞지 않습니다/.test(threw.message) && /아무것도 바꾸지 않았습니다/.test(threw.message), '사람 말로 알리고 「안 바꿨다」를 명시한다');
      ok(pr3.sentences.every((s, i) => s.ttsAudioPath === before[i]), '🔴 실패 시 문장을 하나도 건드리지 않았다');
      ok(!fs.existsSync(path.join(TMP, 'tts-x')) || fs.readdirSync(path.join(TMP, 'tts-x')).length === 0, '실패 시 파일도 만들지 않았다');

      // ⑦ 음성이 없는 .vrew 를 주면 사람 말로 알린다
      const pr4 = P.parseScript(sp, 'longform').projects[0];
      const noAudioVrew = path.join(TMP, 'noaudio.vrew');
      {
        const AdmZip = require(path.join(ROOT, 'node_modules', 'adm-zip'));
        const zz = new AdmZip(vrew);
        const pj = JSON.parse(zz.readAsText('project.json'));
        pj.files = (pj.files || []).filter((f) => f.type !== 'AVMedia');   // 음성을 빼 버린다
        const out = new AdmZip();
        out.addFile('project.json', Buffer.from(JSON.stringify(pj), 'utf8'));
        out.writeZip(noAudioVrew);
      }
      let threw2 = null;
      try { await VA.importVrewAudio(pr4, noAudioVrew, path.join(TMP, 'tts-y'), {}); } catch (e) { threw2 = e; }
      ok(!!threw2 && /음성이 없습니다/.test(threw2.message), '음성이 없는 .vrew 는 무엇을 해야 하는지 알려준다');

      // ⑧ .vrew 가 아닌 파일
      let threw3 = null;
      const junk = path.join(TMP, 'junk.vrew');
      fs.writeFileSync(junk, 'not a zip');
      try { VA.readVrewClips(junk); } catch (e) { threw3 = e; }
      ok(!!threw3, '망가진 파일에 안 죽고 오류를 낸다');

      // ⑨ 🔴 **일부만 만든 .vrew** — 문장 기준으로는 일치율이 낮지만 통과해야 한다
      //    (2026-09-03 실사고: 로이가 앞 3그룹만 음성을 만들었더니 247문장 중 4개만 맞아 1.6% →
      //     옛 문장 기준 게이트가 정상 작업을 막았다. clip 기준이면 5/5=100% 로 통과한다.)
      {
        const prPart = P.parseScript(sp, 'longform').projects[0];
        // stage1.vrew 의 clip 6개 중 앞 2개만 남긴 .vrew 를 만든다
        const AdmZip = require(path.join(ROOT, 'node_modules', 'adm-zip'));
        const zz = new AdmZip(vrew);
        const pj = JSON.parse(zz.readAsText('project.json'));
        const keep = pj.transcript.clips.slice(0, 2);
        const keptMedia = new Set();
        for (const c of keep) {
          for (const aid of (c.words || []).flatMap((w) => w.assetIds || [])) {
            for (const tid of ((pj.props.assets[aid] || {}).trackIds || [])) {
              const t = pj.props.tracks[tid];
              if (t) keptMedia.add(t.mediaId);
            }
          }
        }
        pj.transcript.clips = keep;
        const partial = path.join(TMP, 'partial.vrew');
        const out = new AdmZip();
        out.addFile('project.json', Buffer.from(JSON.stringify(pj), 'utf8'));
        for (const e of zz.getEntries()) {
          if (e.entryName === 'project.json') continue;
          const stem = e.entryName.replace(/^media\//, '').replace(/\.[^.]*$/, '');
          if (keptMedia.has(stem)) out.addFile(e.entryName, e.getData());
        }
        out.writeZip(partial);

        const rp = await VA.importVrewAudio(prPart, partial, path.join(TMP, 'tts-part'), { probeDur: (f) => media.getMediaDuration(f) });
        ok(rp.injected === 2, `🔴 앞 2문장만 든 .vrew 도 막히지 않고 가져온다 (주입 ${rp.injected})`);
        ok(rp.clipRate === 1, `clip 기준 일치율 100% (실제 ${(rp.clipRate * 100).toFixed(0)}%)`);
        ok(rp.rate < 0.5, `문장 기준으로는 낮다 — 그래도 통과해야 한다 (${(rp.rate * 100).toFixed(0)}%)`);
        ok(prPart.sentences.slice(2).every((s) => !s.ttsAudioPath), '가져오지 않은 문장은 건드리지 않았다');
      }

      // ⑩ 🔴 문장부호가 달라도 매칭된다 (Vrew 자막엔 마침표가 없다)
      ok(VA.normLoose('있었습니다.') === VA.normLoose('있었습니다'), '마침표를 무시한다');
      ok(VA.normLoose('이른 새벽, 한 관리가') === VA.normLoose('이른 새벽 한 관리가'), '쉼표를 무시한다');
      ok(VA.normLoose('가나다') !== VA.normLoose('가나라'), '내용 글자는 구별한다(엉뚱한 매칭 방지)');
      // 여러 clip → 한 문장 매칭
      {
        const sents = [{ num: 1, text: '그의 죄는 임금의 사위를 잡아 문초한 것이었습니다.' }];
        const cs = [
          { index: 0, text: '그의 죄는 임금의 사위를', mediaId: 'a', entryName: 'media/a.mp3' },
          { index: 1, text: '잡아 문초한 것이었습니다', mediaId: 'b', entryName: 'media/b.mp3' },
        ];
        const mm = VA.matchClipsToSentences(sents, cs);
        ok(mm[0] && mm[0].length === 2, '🔴 자막 줄 2개가 한 문장으로 합쳐진다 (실사고 케이스)');
      }
      // words 를 captions 보다 믿는다 (실사고: clip[0] captions 가 남의 문장이었다)
      ok(VA.clipText({ words: [{ text: '진짜' }, { text: '내용' }], captions: [{ text: [{ insert: '남의 자막' }] }] }) === '진짜 내용',
        '🔴 words 를 우선한다');
      ok(VA.clipText({ captions: [{ text: [{ insert: '폴백 자막' }] }] }) === '폴백 자막', 'words 가 없으면 captions 폴백');

      // ⑪ 🎤 음성만 — 이미지·비디오를 .vrew 에 넣지 않는지 (withoutVisuals 원문 실행)
      {
        const fn2 = new Function('async ' + extract(MAIN, 'withoutVisuals') + '\nreturn withoutVisuals;')();
        const prV = { groups: [{ num: 1, imagePath: 'C:/img1.png', videoPath: 'C:/v1.mp4' }, { num: 2, imagePath: 'C:/img2.png', videoPath: null }] };
        let inside = null;
        await fn2(prV, async () => { inside = prV.groups.map((g) => [g.imagePath, g.videoPath]); return 1; });
        ok(inside && inside.every((x) => x[0] === null && x[1] === null), '🔴 빌드 중에는 이미지·비디오가 비워진다');
        ok(prV.groups[0].imagePath === 'C:/img1.png' && prV.groups[0].videoPath === 'C:/v1.mp4', '🔴 끝나면 원래대로 되돌아온다');
        ok(prV.groups[1].imagePath === 'C:/img2.png', '두 번째 그룹도 복원된다');
      }
      // 실제로 「음성만」 빌드를 하면 image 0 인가
      {
        const prA = P.parseScript(sp, 'longform').projects[0];
        P.fillSilent(prA, path.join(TMP, '_s2'));
        // 이미지가 있는 상황을 만든다(실사고 조건: 이미 만들어 둔 이미지가 남아 있다)
        const imgDir = path.join(TMP, 'media-a');
        fs.mkdirSync(imgDir, { recursive: true });
        const ff = media.getFfmpegPath();
        const img = path.join(imgDir, '01.png');
        execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180', '-frames:v', '1', img], { stdio: 'ignore' });
        for (const g of prA.groups) g.imagePath = img;
        const withImg = path.join(TMP, 'withimg.vrew');
        const rA = await P.buildProjectVrew(prA, withImg, preset, () => {}, 20);
        ok(rA.imageCount > 0, '(대조) 평소에는 이미지가 들어간다 — image ' + rA.imageCount);

        const fn2 = new Function('async ' + extract(MAIN, 'withoutVisuals') + '\nreturn withoutVisuals;')();
        const noImg = path.join(TMP, 'noimg2.vrew');
        const rB = await fn2(prA, () => P.buildProjectVrew(prA, noImg, preset, () => {}, 20));
        ok(rB.imageCount === 0, '🔴 「음성만」이면 이미지가 0개 — image ' + rB.imageCount);
        ok(rB.clipCount === rA.clipCount, '음성·자막은 그대로 (clip ' + rB.clipCount + ')');
        ok(prA.groups.every((g) => g.imagePath === img), '빌드 뒤 이미지 경로가 복원됐다');
      }
    } finally {
      fs.rmSync(TMP, { recursive: true, force: true });
    }
    console.log('\nvrew-audio: ' + (n - bad) + '/' + n + ' 통과');
    if (bad) process.exit(1);
  })().catch((e) => { console.log('  ✗ 예외: ' + e.message + '\n' + e.stack); process.exit(1); });
}
