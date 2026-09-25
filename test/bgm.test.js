// 🎵 배경음악 — 내 음악 파일(또는 폴더) → .vrew 배경음 트랙 + 유튜브 MP4 에 섞기 (2026-09-24)
//   node test/bgm.test.js
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

// main.js 원문에서 곡 고르기를 뽑아 실행
const i0 = MAIN.indexOf('const BGM_EXT'); const i1 = MAIN.indexOf('// 로컬 이미지/영상 미리보기용 커스텀 프로토콜', i0);
const { pickBgmFile, resolveBgm } = new Function('fs', 'path', 'require', MAIN.slice(i0, i1) + '; return { pickBgmFile, resolveBgm };')(fs, path, (m) => require(m.startsWith('./') ? path.join(ROOT, m) : m));   // withLogo 가 core/overlay-layers 를 부른다(v0.5.52)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-'));
const tone = (name, sec, f = 220) => { const p = path.join(tmp, name); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=f=${f}:d=${sec}`, '-ac', '2', '-ar', '44100', p]); return p; };

console.log('\n[1] 곡 고르기');
const dir = path.join(tmp, 'music'); fs.mkdirSync(dir);
['a.mp3', 'b.mp3', 'c.wav'].forEach((n) => fs.copyFileSync(tone('_' + n.replace(/\.\w+$/, '') + '.wav', 0.3), path.join(dir, n)));
fs.writeFileSync(path.join(dir, 'memo.txt'), 'x');
const one = path.join(dir, 'a.mp3');
ok(pickBgmFile(one, 'x') === one, '파일이면 그 파일');
const k1 = pickBgmFile(dir, '[고전_0901] 제목.md');
ok(k1 && /\.(mp3|wav)$/.test(k1), '폴더면 음악 파일 하나(메모 파일은 무시)');
ok(pickBgmFile(dir, '[고전_0901] 제목.md') === k1, '🔑 같은 대본은 다시 만들어도 같은 곡');
const picks = new Set(['1.md', '2.md', '3.md', '4.md', '5.md', '6.md', '7.md', '8.md'].map((k) => pickBgmFile(dir, k)));
ok(picks.size >= 2, `대본이 다르면 곡이 돌아간다 (${picks.size}곡)`);
ok(pickBgmFile(path.join(tmp, 'none'), 'x') === null && pickBgmFile(path.join(dir, 'memo.txt'), 'x') === null, '없는 경로·음악 아닌 파일은 null');
const logs = [];
ok(resolveBgm({ bgmOn: false, bgmPath: one }, 'a.md').bgm.enabled === false, '꺼 두면 없음');
const rb = resolveBgm({ bgmOn: true, bgmPath: one, bgmVolume: 30 }, 'a.md', (l) => logs.push(l));
ok(rb.bgm.enabled && rb.bgm.audioPath === one && rb.bgm.volume === 0.3 && rb.bgm.loop === true, '켜면 곡·음량(30% → 0.3)·반복');
ok(logs.some((l) => /🎵 배경음악: a\.mp3 · 음량 30%/.test(l)), '어느 곡인지 로그');
ok(resolveBgm({ bgmOn: true, bgmPath: one, bgmVolume: 500 }, 'a.md').bgm.volume === 1, '음량은 100% 까지');
const l2 = [];
ok(resolveBgm({ bgmOn: true, bgmPath: path.join(tmp, 'gone') }, 'a.md', (l) => l2.push(l)).bgm.enabled === false && l2.some((l) => /찾지 못했습니다/.test(l)), '🔑 곡이 없어도 막지 않는다 — 알리고 BGM 없이');

console.log('\n[2] MP4 섞기 인자');
const R = require('../core/vrew-render');
ok(R.bgmMixArgs(null, 10).length === 0, 'BGM 없으면 인자 없음(지금까지와 같다)');
const a = R.bgmMixArgs({ file: 'm.mp3', volume: 0.15, loop: true }, 60).join(' ');
ok(/-stream_loop -1 -i m\.mp3/.test(a) && /volume=0\.150/.test(a), '반복 + 음량');
ok(/normalize=0/.test(a) && /duration=first/.test(a), '🔑 amix normalize=0(음성이 작아지지 않게) · duration=first(영상보다 길어지지 않게)');
ok(/afade=t=in/.test(a) && /afade=t=out:st=57\.000/.test(a), '앞뒤 페이드(끝 3초)');
ok(!/-stream_loop/.test(R.bgmMixArgs({ file: 'm.mp3', loop: false }, 60).join(' ')), '반복 끄면 stream_loop 없음');

console.log('\n[3] 배선');
ok((MAIN.match(/resolveBgm\((ep|preset), S\.scriptPath, log\)/g) || []).length === 2, 'export-vrew · ⚡ 만들기 두 경로 모두');
ok(/if \(preset\.bgm && preset\.bgm\.enabled && preset\.bgm\.audioPath\) opts\.bgm = preset\.bgm/.test(read('core/pipeline.js')), 'pipeline → 빌더');
const APP = read('renderer/src/App.jsx');
ok(/bgmOn: !!p\.bgmOn, bgmPath: p\.bgmPath/.test(APP) && /bgmOn: !!ch\.bgmOn, bgmPath: \(ch\.bgmPath/.test(APP), '채널편집 싣기·저장');
ok(/<label>🎵 배경음악<\/label>/.test(APP), '📁 폴더 탭에 🎵 배경음악');

console.log('\n[4] 실제 왕복 — 빌더로 .vrew(BGM 트랙) → 렌더러로 MP4 → 소리 측정');
const P = require('../core/pipeline');
function meanDbSafe(mp4, ss, t) {
  const r = require('child_process').spawnSync(FF, ['-hide_banner', '-ss', String(ss), '-t', String(t), '-i', mp4, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr || ''); return m ? (m[1] === '-inf' ? -200 : +m[1]) : -200;
}
(async () => {
  try {
    const r = P.parseScriptText('# t\n## 장\n### 장면\n첫 문장입니다. 둘째 문장입니다. 셋째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0];
    const img = path.join(tmp, 'g.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x808080:s=1920x1080', '-frames:v', '1', img]);
    pr.groups[0].imagePath = img;
    P.fillSilent(pr, path.join(tmp, 'tts'));   // 음성은 무음 → 들리는 것은 BGM 뿐
    const song = tone('song.mp3', 1.5, 330);    // 영상(약 7초)보다 짧다 → 반복돼야 한다
    const total = pr.sentences.reduce((s, x) => s + x.ttsDurationSec, 0);
    async function build(name, preset) {
      const vrew = path.join(tmp, name + '.vrew');
      await P.buildProjectVrew(pr, vrew, preset, () => {}, 20, 1);
      const mp4 = path.join(tmp, name + '.mp4');
      const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
      if (!res || !res.ok) throw new Error('렌더 실패: ' + (res && res.error));
      return { vrew, mp4 };
    }
    const off = await build('off', {});
    const on = await build('on', resolveBgm({ bgmOn: true, bgmPath: song, bgmVolume: 50 }, 'x.md'));
    const pj = JSON.parse(new AdmZip(on.vrew).readAsText('project.json'));
    const f = pj.files.find((x) => x.sourceFileType === 'BGM');
    const tr = Object.values(pj.props.tracks).find((x) => x.type === 'bgm');
    const aid = Object.keys(pj.props.assets).find((k) => pj.props.assets[k].trackIds.includes(tr && tr.trackId));
    ok(!!f && !!tr && tr.loop === true && Math.abs(tr.volume - 0.5) < 1e-9, '.vrew 에 BGM 파일 + type:bgm 트랙(반복 · 음량 0.5)');
    ok(!!aid && pj.transcript.clips.every((c) => (c.assetIds || []).includes(aid)), '🔑 전 clip 이 BGM asset 을 참조(없으면 Vrew 가 안 튼다)');
    ok(!!new AdmZip(on.vrew).getEntry('media/' + f.name), 'zip 에 곡 파일');
    const offDb = meanDbSafe(off.mp4, 2, 1), midDb = meanDbSafe(on.mp4, 2, 1), lateDb = meanDbSafe(on.mp4, Math.max(3, total - 2.5), 0.8), headDb = meanDbSafe(on.mp4, 0, 0.25);
    console.log('   mean dB', JSON.stringify({ total: +total.toFixed(2), offDb, headDb, midDb, lateDb }));
    ok(offDb < -80, 'BGM 끄면 무음(음성도 무음) — 지금까지와 같다');
    ok(midDb > -40, `BGM 이 MP4 에 섞였다 (${midDb} dB)`);
    ok(lateDb > -40, `🔑 곡(1.5초)이 끝난 뒤에도 소리가 난다 = 반복 (${lateDb} dB)`);
    ok(headDb < midDb - 3, `시작은 페이드인으로 작다 (${headDb} < ${midDb})`);
  } catch (e) { ok(false, '왕복 실패: ' + e.message); }

  console.log('\n[5] ✏ 화이트보드 MP4 — attachAudio 에 배경음악');
  try {
    const WA = require('../core/whiteboard-audio');
    const wdir = path.join(tmp, 'wb'); fs.mkdirSync(wdir);
    const mkVid = (name, sec) => { const p = path.join(wdir, name); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0xF5EBD7:s=320x180:r=30:d=${sec}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p]); return p; };
    const silent = (name, sec) => { const p = path.join(wdir, name); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono`, '-t', String(sec), p]); return p; };
    const s1 = mkVid('s1.mp4', 3), s2 = mkVid('s2.mp4', 3);
    const song = tone('wbsong.mp3', 1.5, 330);
    async function wb(name, bgm) {
      const merged = path.join(wdir, name + '.mp4');
      execFileSync(FF, ['-y', '-loglevel', 'error', '-i', s1, '-i', s2, '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', merged]);
      const r = await WA.attachAudio({ videoPath: merged, tmpDir: wdir, bgm, log: () => {},
        scenes: [{ video: s1, audios: [silent(name + 'a.wav', 3)] }, { video: s2, audios: [silent(name + 'b.wav', 3)] }] });
      return { r, mp4: merged };
    }
    const off = await wb('wboff', null);
    const on = await wb('wbon', { file: song, volume: 0.5, loop: true });
    ok(off.r.ok && on.r.ok, '두 경우 모두 음성 얹기 성공');
    ok(on.r.bgm === true && !off.r.bgm, '결과에 배경음악 여부가 남는다');
    const offDb = meanDbSafe(off.mp4, 2, 1), midDb = meanDbSafe(on.mp4, 2, 1), lateDb = meanDbSafe(on.mp4, 4, 0.8);
    console.log('   mean dB', JSON.stringify({ offDb, midDb, lateDb }));
    ok(offDb < -80, 'BGM 없으면 무음 그대로');
    ok(midDb > -40 && lateDb > -40, `🔑 화이트보드 MP4 에 BGM 이 섞이고 반복된다 (${midDb} / ${lateDb} dB)`);
    const bad = await wb('wbbad', { file: path.join(tmp, 'gone.mp3'), volume: 0.5 });
    ok(bad.r.ok && !bad.r.bgm, '곡 파일이 없어도 음성만으로 성공(막지 않는다)');
    ok(/bgm: opts\.bgm/.test(read('core/whiteboard-pipeline.js')) && /bgm,\n\s+onProgress/.test(MAIN), '배선: main → pipeline → attachAudio');
  } catch (e) { ok(false, '화이트보드 왕복 실패: ' + e.message); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} bgm ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
