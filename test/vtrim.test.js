// ✂ 비디오 시작점 변경(look.vtrim · v1.0.63) — 그룹 영상에서 쓸 구간 [in, out]
//   node test/vtrim.test.js
//   [1] 규칙(visual-look · templates · 지문) [2] video-fit.trimVideo 실측(색·소리) [3] 필름 띠·파형(core/video-strip)
//   [4] 실제 왕복(.vrew → MP4 — 첫 장면 색 · 영상 소리 선택과 함께) [5] 배선
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const FF = require('../core/media-utils').getFfmpegPath();
const VL = require('../core/visual-look');

console.log('\n[1] 규칙 — normVtrim · vtrimSeg · vtrimAt');
ok(VL.normVtrim(null) === null && VL.normVtrim({}) === null && VL.normVtrim({ in: 2, out: 2.1 }) === null && VL.normVtrim({ in: -1, out: 3 }) === null, '없음·너무 짧음(0.3초 미만)·음수는 null');
ok(JSON.stringify(VL.normVtrim({ in: 1.234, out: 5.678, d: 9.001 })) === '{"in":1.23,"out":5.68,"d":9}', '0.01초로 반올림 · 고를 때 길이(d)도 싣는다');
ok(VL.normVtrim({ in: 1, out: 9.5, d: 9 }) === null, '끝이 영상 길이를 넘으면 null');
ok(JSON.stringify(VL.vtrimSeg({ in: 4, out: 6, d: 6 }, 6)) === '{"in":4,"out":6}', 'vtrimSeg — 고른 구간 그대로');
ok(VL.vtrimSeg({ in: 0, out: 6, d: 6 }, 6) === null && VL.vtrimSeg({ in: 0, out: 6, d: 6 }, null) === null, '🔑 처음부터 끝까지 = 자를 것 없음(null)');
ok(VL.vtrimSeg({ in: 2, out: 4, d: 6 }, 8) === null, '🔑 영상 길이가 고를 때와 다르면(다시 만든 영상) 쓰지 않는다');
ok(JSON.stringify(VL.vtrimSeg({ in: 2, out: 4, d: 6 }, 6.1)) === '{"in":2,"out":4}', '길이 차이 0.25초 안(다시 인코딩·업스케일)은 같은 영상으로 본다');
ok(VL.vtrimAt({ in: 2, out: 4, d: 6 }, 6, 0) === 2 && VL.vtrimAt({ in: 2, out: 4, d: 6 }, 6, 1.5) === 3.5 && VL.vtrimAt({ in: 2, out: 4, d: 6 }, 6, 2.5) === 2.5, 'vtrimAt — 구간 처음부터 · 구간을 넘으면 구간 안에서 반복');
ok(VL.vtrimAt(null, 6, 7) === 1 && VL.vtrimAt({ in: 2, out: 4, d: 6 }, 6, 9, true) === 3.95, '구간 없음 = 예전처럼 t % 길이 · once = 끝에서 멈춤');
ok(VL.isDefault({}) && !VL.isDefault({ vtrim: { in: 1, out: 3, d: 6 } }) && VL.normLook({ fill: 'cover', vtrim: { in: 1, out: 3, d: 6 } }).vtrim.in === 1, 'normLook 이 싣고 isDefault 가 본다');
ok(!('vtrim' in VL.normLook({ vtrim: { in: 3, out: 3 } })), '틀린 값은 필드를 두지 않는다');
ok(/✂ 영상 1\.0~3\.0초/.test(VL.describe({ vtrim: { in: 1, out: 3, d: 6 } })), 'describe 한 줄(로그)');
const TP = require('../core/templates');
const kept = TP.applyLook({ vtrim: { in: 1, out: 3, d: 6 }, fill: 'cover' }, { fill: 'contain' });
ok(kept && kept.vtrim && kept.vtrim.in === 1 && !TP.LOOK_KEYS.includes('vtrim'), '효과 템플릿을 입혀도 시작점은 그대로 · 템플릿이 담지 않는다');
const BF = require('../core/build-fingerprint');
const FP_PENDING = (async () => {
  const f0 = await BF.fingerprint({ groups: [{ id: 'g', look: { fill: 'cover' } }] }), f1 = await BF.fingerprint({ groups: [{ id: 'g', look: { fill: 'cover', vtrim: { in: 1, out: 3, d: 6 } } }] });
  ok(f0 && f1 && f0 !== f1, '🔑 시작점을 바꾸면 빌드 지문이 달라진다(.vrew 를 다시 만든다)');
})();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vtrim-'));
const sh = (args) => execFileSync(FF, ['-y', '-loglevel', 'error', ...args]);
// 6초: 0~2 빨강 · 2~4 초록 · 4~6 파랑 — 소리는 2~4초에만 1kHz
function mkColorVideo(name, withAudio = true, size = '640x360') {
  const p = path.join(tmp, name);
  const fc = `color=c=red:s=${size}:r=30:d=2[a];color=c=green:s=${size}:r=30:d=2[b];color=c=blue:s=${size}:r=30:d=2[c];[a][b][c]concat=n=3:v=1:a=0[v]`;
  const fa = 'anullsrc=r=48000:cl=stereo:d=2[s1];sine=f=1000:d=2:sample_rate=48000,aformat=channel_layouts=stereo[t];anullsrc=r=48000:cl=stereo:d=2[s2];[s1][t][s2]concat=n=3:v=0:a=1[au]';
  if (withAudio) sh(['-filter_complex', fc + ';' + fa, '-map', '[v]', '-map', '[au]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', p]);
  else sh(['-filter_complex', fc, '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p]);
  return p;
}
// 그 시각 화면 가운데 위쪽(자막 밖)의 평균 색 → 'r' | 'g' | 'b' | '?'
function colorAt(file, t, crop) {
  const r = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', (crop ? crop + ',' : '') + 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const b = r.stdout || Buffer.alloc(0); if (b.length < 3) return '?';
  const [R, G, B] = [b[0], b[1], b[2]]; const mx = Math.max(R, G, B);
  if (mx < 60) return '?';
  return R === mx && R > G + 60 && R > B + 60 ? 'r' : G === mx && G > R + 40 && G > B + 40 ? 'g' : B === mx && B > R + 60 && B > G + 60 ? 'b' : '?';
}
function durOf(f) { const r = spawnSync(FF, ['-hide_banner', '-i', f], { encoding: 'utf8' }); const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr || ''); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0; }
function bandDb(mp4, f, ss, t) {
  const r = spawnSync(FF, ['-hide_banner', '-ss', String(ss), '-t', String(t), '-i', mp4, '-af', Array(4).fill(`bandpass=f=${f}:width_type=h:w=80`).join(',') + ',volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr || ''); return m ? (m[1] === '-inf' ? -200 : +m[1]) : -200;
}

(async () => {
  await FP_PENDING;
  console.log('\n[2] video-fit.trimVideo — 고른 구간만 자른 사본(실측)');
  const VF = require('../core/video-fit');
  const src = mkColorVideo('src.mp4');
  ok(colorAt(src, 0.3) === 'r' && colorAt(src, 2.5) === 'g' && colorAt(src, 4.5) === 'b', '시험 영상: 빨강 → 초록 → 파랑(색 판정이 실제로 가른다)');
  const tg = await VF.trimVideo(src, { in: 2, out: 4 }, { dir: path.join(tmp, 'c') });
  ok(tg.mode === 'trim' && tg.path !== src && fs.existsSync(tg.path), '사본이 생겼다(원본은 그대로)');
  ok(colorAt(tg.path, 0) === 'g' && colorAt(tg.path, 1.9) === 'g', `🔑 첫 프레임·끝 프레임 모두 초록(2~4초 구간) — ${colorAt(tg.path, 0)}/${colorAt(tg.path, 1.9)}`);
  ok(Math.abs(durOf(tg.path) - 2) < 0.12, `길이 = 고른 구간 2초(${durOf(tg.path).toFixed(2)})`);
  const a1 = bandDb(tg.path, 1000, 0.2, 1.5);
  ok(a1 > -35, `그 구간의 소리가 따라온다(1kHz ${a1} dB)`);
  const tr = await VF.trimVideo(src, { in: 0, out: 2 }, { dir: path.join(tmp, 'c') });
  ok(colorAt(tr.path, 0) === 'r' && bandDb(tr.path, 1000, 0.2, 1.5) < -60, '0~2초 = 빨강 · 소리 없음(구간 밖 소리가 새지 않는다)');
  const tb = await VF.trimVideo(src, { in: 4.5, out: 6 }, { dir: path.join(tmp, 'c') });
  ok(colorAt(tb.path, 0) === 'b' && Math.abs(durOf(tb.path) - 1.5) < 0.12, '4.5~6초 = 파랑 · 1.5초');
  const again = await VF.trimVideo(src, { in: 2, out: 4 }, { dir: path.join(tmp, 'c') });
  ok(again.cached && again.path === tg.path, '같은 구간은 캐시');
  const noA = mkColorVideo('noaud.mp4', false);
  const tn = await VF.trimVideo(noA, { in: 2, out: 4 }, { dir: path.join(tmp, 'c') });
  ok(tn.mode === 'trim' && colorAt(tn.path, 0) === 'g', '소리 없는 영상도 자른다(무음 트랙)');
  const bad = await VF.trimVideo(path.join(tmp, 'none.mp4'), { in: 1, out: 2 }, { dir: path.join(tmp, 'c') });
  ok(bad.mode === 'fail' && /none\.mp4$/.test(bad.path), '원본이 없으면 던지지 않고 원본 경로 그대로(예전 동작)');
  const ta = VF.trimArgs('in.mp4', { in: 1.5, out: 3 }, 'o.mp4', true).join(' ');
  ok(/-ss 1\.500 -i in\.mp4/.test(ta) && /-t 1\.500/.test(ta) && /libx264/.test(ta) && /-map 0:a:0/.test(ta), '인자: -ss 를 입력 앞에 두고 다시 인코딩(프레임 정확) · 소리는 원본 구간');

  console.log('\n[3] 필름 띠 · 소리 파형(core/video-strip)');
  const VS = require('../core/video-strip');
  ok(JSON.stringify(VS.peaksOf(Buffer.alloc(0), 4)) === '[]', '빈 소리 = 빈 파형');
  { const b = Buffer.alloc(8 * 2); b.writeInt16LE(1000, 0); b.writeInt16LE(-16000, 6 * 2); const p = VS.peaksOf(b, 4); ok(p.length === 4 && p[3] === 1 && p[0] > 0.05 && p[1] === 0, `칸마다 최대 크기(가장 큰 칸 = 1) ${JSON.stringify(p)}`); }
  const st = await VS.makeStrip(src, { dir: path.join(tmp, 'strip') });
  ok(st.ok && Math.abs(st.dur - 6) < 0.1 && st.strip && fs.existsSync(st.strip) && st.hasAudio, `필름 띠 JPG · 길이 ${st.dur && st.dur.toFixed(2)}초 · 소리 있음`);
  const wd = spawnSync(FF, ['-hide_banner', '-i', st.strip], { encoding: 'utf8' }); const wm = /, (\d+)x(\d+)/.exec(wd.stderr || '');
  ok(wm && +wm[2] === VS.FRAME_H && +wm[1] > VS.FRAME_H * 8, `띠 크기 ${wm && wm[1]}x${wm && wm[2]}(장 ${VS.FRAMES}개를 가로로)`);
  ok(colorAt(st.strip, 0, 'crop=iw/8:ih:0:0') === 'r' && colorAt(st.strip, 0, 'crop=iw/8:ih:iw*7/8:0') === 'b', '띠 왼쪽 = 처음(빨강) · 오른쪽 = 끝(파랑) — 시간 순서');
  const P3 = st.peaks; const n3 = P3.length;
  const avg = (a, b) => { let s = 0, c = 0; for (let i = Math.floor(a * n3); i < Math.floor(b * n3); i++) { s += P3[i]; c++; } return c ? s / c : 0; };
  ok(n3 === VS.PEAKS && avg(0.4, 0.6) > 0.5 && avg(0.05, 0.3) < 0.05 && avg(0.72, 0.95) < 0.05, `🔑 파형도 같은 시간 기준 — 소리 있는 2~4초 칸만 크다(${avg(0.05, 0.3).toFixed(2)} / ${avg(0.4, 0.6).toFixed(2)} / ${avg(0.72, 0.95).toFixed(2)})`);
  const st2 = await VS.makeStrip(noA, { dir: path.join(tmp, 'strip') });
  ok(st2.ok && !st2.hasAudio && st2.peaks.length === 0, '소리 없는 영상 = 파형 없음(창에서 오디오 띠를 그리지 않는다)');

  console.log('\n[4] 실제 왕복 — 빌더(.vrew) → 렌더러(MP4)');
  const P = require('../core/pipeline');
  const R = require('../core/vrew-render');
  const img = path.join(tmp, 'g.png');
  sh(['-f', 'lavfi', '-i', 'color=c=0x808080:s=1920x1080', '-frames:v', '1', img]);
  const SCRIPT = '# t\n## 장\n### 장면 하나\n첫 문장입니다. 둘째 문장입니다.\n### 장면 둘\n셋째 문장입니다. 넷째 문장입니다.\n';
  const big = mkColorVideo('big.mp4', true, '1280x720');
  async function scenario(name, look) {
    const r = P.parseScriptText(SCRIPT, 'longform', {});
    const pr = r.projects[0];
    P.fillSilent(pr, path.join(tmp, 'tts-' + name));
    for (const s of pr.sentences) {
      const w = path.join(tmp, `tts-${name}`, `${s.num}.wav`);
      sh(['-f', 'lavfi', '-i', `sine=f=440:d=${s.ttsDurationSec}`, '-ar', '24000', '-ac', '1', w]);
      s.ttsAudioPath = w;
    }
    for (const g of pr.groups) g.imagePath = img;
    const g0 = pr.groups[0];
    g0.videoPath = big;
    if (look) g0.look = VL.normLook(look);
    const logs = [];
    const vrew = path.join(tmp, name + '.vrew');
    await P.buildProjectVrew(pr, vrew, {}, (l) => logs.push(l), 20, 1);
    const mp4 = path.join(tmp, name + '.mp4');
    const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
    if (!res || !res.ok) throw new Error('렌더 실패: ' + (res && res.error));
    const span0 = pr.getSentencesOfGroup(g0).reduce((a, s) => a + s.ttsDurationSec, 0);
    const zip = new AdmZip(vrew);
    const pj = JSON.parse(zip.readAsText('project.json'));
    const vt = Object.values(pj.props.tracks).find((t) => t.type === 'video');
    const ent = zip.getEntries().find((e) => vt && e.entryName.includes(vt.mediaId));
    let inner = null; if (ent) { inner = path.join(tmp, name + '_in.mp4'); fs.writeFileSync(inner, ent.getData()); }
    return { pr, vrew, mp4, logs, span0, inner, vt };
  }
  const CROP = 'crop=iw/4:ih/4:iw*3/8:ih/8';
  try {
    const base = await scenario('base');
    ok(colorAt(base.mp4, 0.15, CROP) === 'r', `① 시작점 없음 — MP4 첫 장면은 영상 처음(빨강) · ${colorAt(base.mp4, 0.15, CROP)}`);
    const blue = await scenario('blue', { vtrim: { in: 4, out: 6, d: 6 } });
    ok(colorAt(blue.inner, 0) === 'b', `🔑 .vrew 안의 영상 파일 첫 프레임 = 파랑(4~6초 구간) · ${colorAt(blue.inner, 0)}`);
    ok(colorAt(blue.mp4, 0.15, CROP) === 'b' && colorAt(blue.mp4, Math.max(0.3, blue.span0 - 0.4), CROP) === 'b', `🔑 MP4 도 그 구간 — 첫 장면·그룹 끝까지 파랑(빨강·초록이 나오지 않는다) · ${colorAt(blue.mp4, 0.15, CROP)}`);
    ok(blue.logs.some((l) => /✂ G1 영상 시작점 — 4\.00~6\.00초/.test(l)), '로그에 쓴 구간');
    ok(blue.vt && blue.vt.sourceIn === 0, '.vrew 트랙은 자른 사본 기준(sourceIn 0 — Vrew·렌더러가 다른 계산을 하지 않는다)');
    const green = await scenario('green', { vtrim: { in: 2, out: 4, d: 6 }, vsound: { mode: 'video' } });
    const gdb = bandDb(green.mp4, 1000, 0.3, 1.4);
    ok(colorAt(green.mp4, 0.15, CROP) === 'g' && gdb > -35, `🔑 영상 소리 선택과 함께 — 자른 구간(2~4초)의 소리가 난다(1kHz ${gdb} dB)`);
    const redSnd = await scenario('redsnd', { vtrim: { in: 4, out: 6, d: 6 }, vsound: { mode: 'video' } });
    const rdb = bandDb(redSnd.mp4, 1000, 0.3, 1.4);
    ok(rdb < -60, `   구간 밖 소리는 나지 않는다(4~6초 = 무음 구간 · ${rdb} dB)`);
    const stale = await scenario('stale', { vtrim: { in: 4, out: 6, d: 9 } });
    ok(colorAt(stale.mp4, 0.15, CROP) === 'r' && stale.logs.some((l) => /시작점 설정이 지금 영상과 맞지 않아/.test(l)), '🔑 영상이 바뀐 옛 설정(길이가 다름)은 쓰지 않고 알린다');
  } catch (e) { ok(false, '왕복 실패: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')); }

  console.log('\n[5] 배선');
  const BLD = read('vrew/vrew-builder.js'), MAIN = read('main.js'), APP = read('renderer/src/App.jsx'), MOD = read('renderer/src/VtrimModal.jsx'), PRE = read('preload.js');
  ok(/_VLk\.vtrimSeg\(g\.look && g\.look\.vtrim, _vmeta0 && _vmeta0\.duration\)/.test(BLD) && BLD.indexOf('trimVideo(_vsrc') < BLD.indexOf("fitVideo(_vsrc"), '빌더: 자르기가 길이 맞추기보다 먼저(규칙 한 곳 vtrimSeg)');
  ok((MAIN.match(/_dropVtrim\(/g) || []).length >= 6, 'main: 영상이 새것으로 바뀌는 자리(생성·첨부·스톡·클립 추가)에서 옛 시작점을 버린다');
  ok(/ipcMain\.handle\('video-strip'/.test(MAIN) && /videoStrip:/.test(PRE), 'IPC video-strip(필름 띠·파형)');
  ok(/data-testid="mn-vtrim"/.test(APP) && /비디오 시작점 변경/.test(APP) && /<VtrimModal /.test(APP) && /\{ vtrim: v \}/.test(APP), '② 그룹 메뉴 「[ ] 비디오 시작점 변경」 → 창 → set-group-look { vtrim }');
  ok(APP.indexOf('data-testid="mn-vtrim"') < APP.indexOf('data-testid="mn-vsnd"'), 'Vrew 순서 — 시작점 변경 다음에 볼륨');
  ok(/VLook\.vtrimAt\(vt, d, t, L\.once\)/.test(APP) && /VLook\.vtrimAt\(L\.look\.vtrim, d, t, L\.once\)/.test(APP) && /VLook\.vtrimAt\(L\.vtrim, L\.vtrim\.d/.test(APP), '① 칸 재생·정지 장면·② 썸네일이 같은 vtrimAt');
  ok(/vtrim-wave/.test(MOD) && /hasAudio/.test(MOD) && /down\('l'/.test(MOD) && /down\('r'/.test(MOD) && /down\('move'/.test(MOD) && /stopAtRef/.test(MOD), '창: 파형(소리 있을 때) · 양 끝·상자 끌기 · ▶ 는 주황 선부터');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\n${fail ? '❌' : '✅'} vtrim ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
