// 🎵🤖 배경음악 AI 선곡 · 도입부만 깔기 · 🔎 Pixabay 찾기 (v1.0.65 · 로이 2026-11-18)
//   node test/bgm-ai.test.js
//   ⛔ 진짜 Claude 를 부르지 않는다 — PM_UI_SMOKE + global.__claudeApiTest 가짜 fetch 만(로이 충전금)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const MAIN = read('main.js');
const FF = require('../core/media-utils').getFfmpegPath();

process.env.PM_UI_SMOKE = '1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bgmai-'));
process.env.PM_BGM_PICKS = path.join(tmp, 'picks.json');   // ⛔ 로이의 진짜 기억 파일을 쓰지 않는다
const BP = require('../core/bgm-pick');
const CA = require('../core/claude-api');

console.log('\n[1] core/bgm-pick — 순수 규칙');
const dir = path.join(tmp, 'music'); fs.mkdirSync(dir);
for (const n of ['epic-cinematic-battle.mp3', 'calm-piano-memories.mp3', 'happy-ukulele.wav', '10-sad-strings.m4a']) fs.writeFileSync(path.join(dir, n), 'x');
fs.writeFileSync(path.join(dir, 'calm-piano-memories.txt'), '잔잔한 피아노 · 회상\n여운');
fs.writeFileSync(path.join(dir, 'readme.txt'), '목록 아님');
const tracks = BP.listTracks(dir);
ok(tracks.length === 4 && tracks.every((t) => fs.existsSync(t.file)), '음악 파일만 목록(옆 .txt 는 곡이 아니다)');
ok((tracks.find((t) => t.name === 'calm-piano-memories.mp3') || {}).note === '잔잔한 피아노 · 회상 여운', '옆 「곡이름.txt」 = 설명(한 줄로)');
ok(BP.listTracks(path.join(tmp, 'none')).length === 0 && BP.listTracks(path.join(dir, 'happy-ukulele.wav')).length === 0, '없는 폴더·파일은 빈 목록');
//   예전 해시 규칙과 같은 곡 — 옛 대본의 곡이 바뀌지 않게(main.js v1.0.64 의 계산을 그대로 다시 한다)
const old = (key) => { const list = fs.readdirSync(dir).filter((f) => BP.BGM_EXT.test(f)).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })); let h = 0; for (const ch of String(key)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return list[h % list.length]; };
ok(['a.md', '[고전_0901] 제목.md', 'x'].every((k) => BP.hashPick(tracks, k).name === old(k)), '🔑 AI 를 끄면 예전과 같은 곡(대본 이름 해시)');
const sents = [{ text: '도입 하나.', isIntro: true }, { text: '도입 둘.', isIntro: true }, { text: '본문 셋.', isIntro: false }];
const bi = BP.scriptBrief({ name: '[역사_1118] 전쟁.md', sentences: sents, scope: 'intro' });
ok(bi.title === '[역사_1118] 전쟁' && bi.text === '도입 하나. 도입 둘.' && bi.introOnly, '도입부만 = 도입부 문장만');
const ba = BP.scriptBrief({ name: 'a.md', sentences: sents, scope: 'all' });
ok(ba.text === '도입 하나. 도입 둘. 본문 셋.' && !ba.introOnly, '전체 = 도입부 + 본문 앞쪽');
ok(BP.scriptBrief({ sentences: sents.map((s) => ({ ...s, isIntro: false })), scope: 'intro' }).introOnly === false, '도입부 없는 대본은 「도입부만」이어도 앞쪽 글');
ok(BP.scriptBrief({ sentences: [{ text: 'ㄱ'.repeat(3000) }], maxChars: 100 }).text === '', '글자 상한');
const prm = BP.buildPickPrompt(bi, tracks);
ok(tracks.every((t) => prm.includes(t.name)) && prm.includes('잔잔한 피아노') && /JSON/.test(prm), '선곡 요청에 곡 이름·설명·답 형식');
ok(BP.parsePick('{"file":"calm-piano-memories.mp3","why":"회상"}', tracks, CA.parseJson).track.name === 'calm-piano-memories.mp3', '답 → 곡');
ok(BP.parsePick('```json\n{"file":"EPIC-CINEMATIC-BATTLE.MP3"}\n```', tracks, CA.parseJson).track.name === 'epic-cinematic-battle.mp3', '대소문자·펜스 허용');
ok(BP.parsePick('{"file":"2"}', tracks, CA.parseJson).track === tracks[1], '번호로 답해도 받는다');
ok(BP.parsePick('{"file":"없는곡.mp3"}', tracks, CA.parseJson) === null && BP.parsePick('모르겠습니다', tracks, CA.parseJson) === null, '🔑 후보에 없는 곡·이상한 답 = null(지어낸 파일을 쓰지 않는다)');
const kw = BP.parseKeywords('{"keywords":["Cinematic","calm piano","<script>","dark","x","y"],"why":"이유"}', CA.parseJson);
ok(kw.keywords.join('|') === 'cinematic|calm piano|script|dark', '검색어 = 영어 소문자 · 4개까지 · 기호 제거');
ok(BP.pixabayUrl(['calm', 'piano']) === 'https://pixabay.com/music/search/calm%20piano/' && BP.pixabayUrl([]) === 'https://pixabay.com/music/', 'Pixabay 음악 검색 주소');
ok(BP.normScope('intro') === 'intro' && BP.normScope('x') === 'all' && BP.normScope() === 'all', '범위 정규화(기본 전체)');
ok(BP.choose({ dir, scriptName: 'a.md', ai: true }).how === 'hash', '기억된 곡이 없으면 해시');
BP.saveChoice(dir, 'a.md', { name: 'happy-ukulele.wav', why: 'w' });
ok(BP.choose({ dir, scriptName: 'a.md', ai: true }).track.name === 'happy-ukulele.wav', 'AI 켜면 기억된 곡');
ok(BP.choose({ dir, scriptName: 'a.md', ai: false }).how === 'hash', 'AI 끄면 기억이 있어도 해시');
BP.saveChoice(dir, 'b.md', { name: 'gone.mp3' });
ok(BP.choose({ dir, scriptName: 'b.md', ai: true }).how === 'hash', '🔑 기억된 곡이 폴더에서 사라지면 해시로(빈 배경음악 금지)');
fs.rmSync(process.env.PM_BGM_PICKS);

console.log('\n[2] main.ensureBgmAiPick — 가짜 Claude');
const i0 = MAIN.indexOf('const BGM_EXT'); const i1 = MAIN.indexOf('// 로컬 이미지/영상 미리보기용 커스텀 프로토콜', i0);
const { ensureBgmAiPick, resolveBgm } = new Function('fs', 'path', 'require', MAIN.slice(i0, i1) + '; return { ensureBgmAiPick, resolveBgm };')(fs, path, (m) => require(m.startsWith('./') ? path.join(ROOT, m) : m));
let calls = 0, answer = '{"file":"calm-piano-memories.mp3","why":"잔잔한 회상"}', lastBody = null;
const fakeFetch = async (_u, o) => { calls++; lastBody = JSON.parse(o.body); return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ model: 'x', content: [{ type: 'text', text: answer }], usage: {} }) }; };
global.__claudeApiTest = { cfg: { key: 'test-key' }, fetch: fakeFetch };
const preset = { bgmOn: true, bgmAi: true, bgmPath: dir, bgmScope: 'intro', bgmVolume: 20 };
const project = { sentences: sents };
(async () => {
  try {
    const logs = []; const L = (l) => logs.push(l);
    const r1 = await ensureBgmAiPick(preset, 'C:/x/[역사_1118] 전쟁.md', project, L);
    ok(r1 && r1.how === 'ai' && r1.name === 'calm-piano-memories.mp3' && calls === 1, 'AI 가 고른 곡');
    ok(lastBody && /도입 하나\. 도입 둘\./.test(lastBody.messages[0].content) && !/본문 셋/.test(lastBody.messages[0].content), '도입부만이면 도입부 글로 묻는다');
    ok(logs.some((l) => /🎵🤖 배경음악 AI 선곡: calm-piano-memories\.mp3 — 잔잔한 회상/.test(l)), '고른 곡·이유 로그');
    const rb = resolveBgm(preset, 'C:/x/[역사_1118] 전쟁.md', L);
    ok(rb.bgm.enabled && path.basename(rb.bgm.audioPath) === 'calm-piano-memories.mp3' && rb.bgm.scope === 'intro', '빌드 경로(resolveBgm)가 기억된 곡 + 도입부만');
    ok(logs.some((l) => /🎵 배경음악: calm-piano-memories\.mp3 \(🤖 AI 선곡\) · 음량 20% · 도입부만/.test(l)), '빌드 로그에 AI 선곡·도입부만');
    const r2 = await ensureBgmAiPick(preset, 'C:/x/[역사_1118] 전쟁.md', project, L);
    ok(r2.how === 'stored' && calls === 1, '🔑 같은 대본은 다시 묻지 않는다(같은 곡 · 비용 0)');
    answer = '{"file":"epic-cinematic-battle.mp3","why":"전투"}';
    const r3 = await ensureBgmAiPick(preset, 'C:/x/[역사_1118] 전쟁.md', project, L, { force: true });
    ok(r3.name === 'epic-cinematic-battle.mp3' && calls === 2, '🔄 다시 고르기 = 기억을 덮는다');
    answer = '{"file":"지어낸곡.mp3"}'; const lg2 = [];
    const r4 = await ensureBgmAiPick(preset, 'C:/x/다른.md', project, (l) => lg2.push(l));
    ok(r4 === null && lg2.some((l) => /AI 선곡 실패/.test(l)), '후보 밖 답 = 실패 로그');
    ok(path.basename(resolveBgm(preset, 'C:/x/다른.md', () => {}).bgm.audioPath) === BP.hashPick(tracks, '다른.md').name, '🔑 실패하면 해시 곡으로(음악 때문에 막지 않는다)');
    const c0 = calls;
    ok(await ensureBgmAiPick({ ...preset, bgmAi: false }, 'C:/x/z.md', project, L) === null && calls === c0, 'AI 끈 채널은 묻지 않는다');
    ok(await ensureBgmAiPick({ ...preset, bgmPath: path.join(dir, 'happy-ukulele.wav') }, 'C:/x/z.md', project, L) === null && calls === c0, '파일 하나를 고른 채널은 묻지 않는다');
    process.env.PM_NO_PAID = '1';
    ok(await ensureBgmAiPick(preset, 'C:/x/z.md', project, L) === null && calls === c0, '🤖 무인 제작(PM_NO_PAID)은 Claude 를 부르지 않는다');
    delete process.env.PM_NO_PAID;
    global.__claudeApiTest = { cfg: { key: '' }, fetch: fakeFetch };
    ok(await ensureBgmAiPick(preset, 'C:/x/z.md', project, L) === null && calls === c0, '키 없으면 묻지 않는다');
    const one = path.join(tmp, 'one'); fs.mkdirSync(one); fs.writeFileSync(path.join(one, 's.mp3'), 'x');
    ok((await ensureBgmAiPick({ ...preset, bgmPath: one }, 'C:/x/z.md', project, L)).how === 'only' && calls === c0, '곡이 하나뿐이면 묻지 않고 그 곡');
  } catch (e) { ok(false, 'ensureBgmAiPick 실패: ' + e.stack); }

  console.log('\n[3] 배선');
  const APP = read('renderer/src/App.jsx');
  ok(/bgmAi: !!next\.ai, bgmScope: next\.scope === 'intro' \? 'intro' : 'all'/.test(APP), '리본이 채널에 bgmAi·bgmScope 저장');
  ok((APP.match(/ai: !!p\.bgmAi, scope: p\.bgmScope === 'intro'/g) || []).length === 2, '채널을 불러올 때 두 곳 모두 싣는다');
  ok(['bgm-scope', 'bgm-ai', 'bgm-ai-pick', 'bgm-pixabay'].every((t) => APP.includes(`data-testid="${t}"`)), '리본 칸: 범위 · 🤖 · 🔄 · 🔎');
  ok(/'파일'\}<\/button>/.test(APP) && !/'파일…'\}<\/button>/.test(APP), '「파일…」 → 「파일」');
  ok(/ipcMain\.handle\('bgm-ai-pick'/.test(MAIN) && /ipcMain\.handle\('bgm-pixabay-search'/.test(MAIN) && /bgmAiPick:/.test(read('preload.js')) && /bgmPixabaySearch:/.test(read('preload.js')), 'IPC · preload');
  ok(/await openLink\(url\)/.test(MAIN.slice(MAIN.indexOf("'bgm-pixabay-search'"))), '🔎 는 openLink 한 곳으로 연다');
  ok(CA.USES.bgm && /use: 'bgm'/.test(MAIN), 'Claude 쓰임 이름 bgm');

  console.log('\n[4] 실제 왕복 — 도입부만 → .vrew 링크 · MP4 소리 구간');
  try {
    const P = require('../core/pipeline');
    const R = require('../core/vrew-render');
    const r = P.parseScriptText('# t\n## 도입\n### 장면 하나\n도입부 첫 문장입니다. 도입부 둘째 문장입니다.\n## 1장\n### 장면 둘\n본문 첫 문장입니다. 본문 둘째 문장입니다. 본문 셋째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0];
    const nIntro = pr.sentences.filter((s) => s.isIntro).length;
    ok(nIntro > 0 && nIntro < pr.sentences.length, `도입부 문장 ${nIntro}/${pr.sentences.length}`);
    const img = path.join(tmp, 'g.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x808080:s=1920x1080', '-frames:v', '1', img]);
    for (const g of pr.groups) g.imagePath = img;
    P.fillSilent(pr, path.join(tmp, 'tts'));
    const song = path.join(tmp, 'song.mp3'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=f=330:d=1.5', '-ac', '2', '-ar', '44100', song]);
    const introSec = pr.sentences.filter((s) => s.isIntro).reduce((a, s) => a + s.ttsDurationSec, 0);
    const total = pr.sentences.reduce((a, s) => a + s.ttsDurationSec, 0);
    const vrew = path.join(tmp, 'intro.vrew');
    const lg = [];
    await P.buildProjectVrew(pr, vrew, resolveBgm({ bgmOn: true, bgmPath: song, bgmVolume: 50, bgmScope: 'intro' }, 'x.md'), (l) => lg.push(l), 20, 1);
    const pj = JSON.parse(new AdmZip(vrew).readAsText('project.json'));
    const tr = Object.values(pj.props.tracks).find((x) => x.type === 'bgm');
    const aid = Object.keys(pj.props.assets).find((k) => pj.props.assets[k].trackIds.includes(tr && tr.trackId));
    const linked = pj.transcript.clips.filter((c) => (c.assetIds || []).includes(aid)).length;
    ok(!!tr && linked > 0 && linked < pj.transcript.clips.length, `🔑 도입부 clip 에만 링크 (${linked}/${pj.transcript.clips.length})`);
    ok(pj.transcript.clips.slice(0, linked).every((c) => (c.assetIds || []).includes(aid)), '링크된 clip 은 앞쪽(도입부)부터 이어진다');
    const fx = JSON.parse(fs.readFileSync(vrew + '.fx.json', 'utf8'));
    ok(fx.bgmIntro === tr.trackId, '옆 파일에 도입부 배경음 트랙 id(MP4 페이드용)');
    const mp4 = path.join(tmp, 'intro.mp4');
    const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
    ok(res && res.ok, 'MP4 렌더 성공');
    const db = (ss, t) => { const o = require('child_process').spawnSync(FF, ['-hide_banner', '-ss', String(ss), '-t', String(t), '-i', mp4, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }); const m = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(o.stderr || ''); return m ? (m[1] === '-inf' ? -200 : +m[1]) : -200; };
    const inDb = db(Math.max(0.3, introSec / 2 - 0.3), 0.5), afterDb = db(introSec + 1, Math.max(0.5, total - introSec - 1.5));
    console.log('   mean dB', JSON.stringify({ introSec: +introSec.toFixed(2), total: +total.toFixed(2), inDb, afterDb }));
    ok(inDb > -45, `도입부 동안 배경음 (${inDb} dB)`);
    ok(afterDb < -80, `🔑 도입부가 끝나면 조용 (${afterDb} dB)`);
    //   도입부가 없는 대본 = 넣지 않는다(전체로 바꾸지 않는다)
    const r2 = P.parseScriptText('# t\n## 1장\n### 장면\n본문 첫 문장입니다. 본문 둘째 문장입니다.\n', 'longform', {});
    const p2 = r2.projects[0]; for (const g of p2.groups) g.imagePath = img; P.fillSilent(p2, path.join(tmp, 'tts2'));
    const v2 = path.join(tmp, 'nointro.vrew'); const lg2 = [];
    await P.buildProjectVrew(p2, v2, resolveBgm({ bgmOn: true, bgmPath: song, bgmScope: 'intro' }, 'y.md'), (l) => lg2.push(l), 20, 1);
    const pj2 = JSON.parse(new AdmZip(v2).readAsText('project.json'));
    ok(!Object.values(pj2.props.tracks).some((x) => x.type === 'bgm') && !pj2.files.some((f) => f.sourceFileType === 'BGM') && lg2.some((l) => /도입부가 없어 배경음악을 넣지 않습니다/.test(l)), '도입부 없는 대본 = 배경음 없음 + 로그');
    //   MP4 페이드 — 도입부 배경음(soft)은 끝 3초, ➕ 오디오 삽입은 예전 그대로 1초
    const ma = R.mixArgs({ totalSec: 30, inserts: [{ file: 'a.mp3', t0: 0, t1: 12, volume: 0.2, soft: true }, { file: 'b.mp3', t0: 0, t1: 12, volume: 0.2 }] }).join(' ');
    ok(/\[1:a\][^;]*afade=t=in:d=2\.00,afade=t=out:st=9\.000:d=3\.00/.test(ma) && /\[2:a\][^;]*afade=t=in:d=0\.50,afade=t=out:st=11\.000:d=1\.00/.test(ma), '페이드: 도입부 배경음 2초/3초 · 오디오 삽입은 0.5초/1초 그대로');
  } catch (e) { ok(false, '왕복 실패: ' + e.stack); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} bgm-ai ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
