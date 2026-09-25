// 🎞 긴 범위의 영상 = 파일을 늘리지 않고 Vrew 반복 재생 (v0.5.50 · 실사고: 5초 영상을 편 끝까지 이어 깔자 18분 620MB 파일을 구워 .vrew 가 Vrew 를 멈췄다)
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const GM = require('../core/group-merge');
const { buildVrew } = require('../vrew/vrew-builder');
const FF = require('../core/media-utils').getFfmpegPath();

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vloop-'));
  try {
    console.log('[1] 렌더러 입력 인자');
    const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'vrew-render.js'), 'utf8');
    const a = src.indexOf('function videoInArgs('), b = src.indexOf('\n}\n', a);
    const videoInArgs = new Function(src.slice(a, b + 2) + '\nreturn videoInArgs;')();
    ok(JSON.stringify(videoInArgs({}, 0)) === '[]', '반복 아님 · 처음 = 인자 없음');
    ok(JSON.stringify(videoInArgs({}, 3.5)) === '["-ss","3.500"]', '반복 아님 · 이어서 = -ss');
    ok(JSON.stringify(videoInArgs({ endBehavior: 'loop', sourceOut: 2 }, 5)) === '["-stream_loop","-1","-ss","1.000"]', '반복 · 오프셋은 파일 길이로 나눈 나머지');
    ok(JSON.stringify(videoInArgs({ endBehavior: 'loop', sourceOut: 2 }, 4)) === '["-stream_loop","-1"]', '반복 · 딱 떨어지면 -ss 없음');

    console.log('\n[2] 실제 왕복 — 2초 영상(앞 1초 빨강 · 뒤 1초 파랑)을 세 그룹 끝까지 이어 깔기');
    const r = P.parseScriptText('# t\n## 장\n### 하나\n첫째 문장입니다.\n### 둘\n둘째 문장입니다.\n### 셋\n셋째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0];
    const mkImg = (n, c) => { const f = path.join(tmp, n + '.png'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=1920x1080`, '-frames:v', '1', f]); return f; };
    const vid = path.join(tmp, 'rb.mp4');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=1920x1080:r=30:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080:r=30:d=1',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', vid]);
    pr.groups[0].imagePath = mkImg('g1', 'gray'); pr.groups[0].videoPath = vid;
    P.fillSilent(pr, path.join(tmp, 'tts'));
    const rr = GM.setVisualRange(pr, 0, 0, 2);
    ok(rr.ok && pr.groups[0].visSpan, 'G1 영상을 끝까지 이어 깔았다');
    const total = pr.sentences.reduce((s, x) => s + x.ttsDurationSec, 0);
    const cacheDir = path.join(os.homedir(), '.priming-maker', 'video-fit-cache');
    const before = fs.existsSync(cacheDir) ? new Set(fs.readdirSync(cacheDir)) : new Set();
    const vrew = path.join(tmp, 'x.vrew');
    await buildVrew({ sentences: pr.sentences, groups: pr.groups, vrewPath: vrew, opts: { aspect: '16:9', skipSelfCheck: true, captionMaxChars: 20, fitMaxSec: 3, logger: () => {} } });
    const after = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((x) => !before.has(x)) : [];
    ok(after.length === 0, `🔑 범위 ${total.toFixed(1)}초 > 상한 → 늘린 파일을 새로 굽지 않는다 (새 캐시 ${after.length}개)`);
    const pj = JSON.parse(new AdmZip(vrew).readAsText('project.json'));
    const T = Object.values(pj.props.tracks);
    const v = T.find((t) => t.type === 'video'), va = T.find((t) => t.type === 'videoAudio');
    ok(v && v.endBehavior === 'loop' && Math.abs(v.sourceOut - 2) < 0.1, `🔑 video 트랙 = 파일 길이 + endBehavior loop (샘플.vrew 형식) — sourceOut ${v && v.sourceOut}`);
    ok(va && va.loop === true && Math.abs(va.sourceOut - 2) < 0.1, 'videoAudio 트랙도 파일 길이 + loop');
    const zipBytes = new AdmZip(vrew).getEntries().filter((e) => e.entryName.endsWith('.mp4')).reduce((s, e) => s + e.header.size, 0);
    ok(zipBytes === fs.statSync(vid).size, '.vrew 안의 영상 = 원본 그대로(크기 동일)');

    console.log('\n[3] 🎬 MP4 — 반복 영상이 멈추지 않고 되풀이된다');
    const mp4 = path.join(tmp, 'x.mp4');
    const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
    ok(res && res.ok, '렌더 성공');
    const px = (t) => { const raw = execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=8:8', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); return [raw[108], raw[109], raw[110]]; };
    const isRed = (p) => p[0] > 150 && p[2] < 90, isBlue = (p) => p[2] > 150 && p[0] < 90;
    const p05 = px(0.5), p15 = px(1.5), p25 = px(2.5), p35 = px(3.5);
    console.log('   화소', JSON.stringify([p05, p15, p25, p35]), '총', total.toFixed(2));
    ok(isRed(p05) && isBlue(p15), '처음 2초: 빨강 → 파랑');
    ok(isRed(p25) && isBlue(p35), '🔑 2초 뒤 다시 빨강 → 파랑(반복 — 예전 방식이면 파랑에서 멈춘다)');
  } catch (e) { ok(false, '왕복 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} video-loop ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
