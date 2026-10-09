'use strict';
/**
 * node test/dissolve.test.js — 🌫 디졸브(삼국지 R3 · v0.7.76) — 조각 계획 · 실제 MP4 화소(섞임 · 길이 불변 · 컷 유지)
 *   그림이 바뀌는 자리에 D 초 디졸브(경계 앞뒤 D/2 씩). 타임라인(음성·자막·전체 길이)은 그대로. 기본(0)은 예전 결과와 같다.
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const R = require('../core/vrew-render');
const P = require('../core/pipeline');
const VL = require('../core/visual-look');
const FF = require('../core/media-utils').getFfmpegPath();
const FPS = R.FPS;

console.log('[1] 조각 계획 — 길이 보존 · 경계에만 · 대상 아닌 곳은 컷');
{
  const std = { width: 1, height: 1, xPos: 0, yPos: 0 };
  const img = (file, s, e) => ({ type: 'image', file, track: { ...std, kenburnsAnimationInfo: { from: { scale: 1, centerX: 0.5, centerY: 0.5 }, to: { scale: 0.9, centerX: 0.5, centerY: 0.5 } } }, layers: [{ file, type: 'image', track: std, t0: s, tAll: e - s }], start: s, end: e });
  const segs = [img('a.png', 0, 100), img('b.png', 100, 200), img('c.png', 200, 230)];
  const base = R.planChunks(segs);
  const none = R.planDissolves(base, 0);
  ok(none === base || JSON.stringify(none) === JSON.stringify(base), 'D=0 → 조각 그대로(옛 결과와 같다)');
  const withTail = R.planChunks(segs, 20, { minTailFrames: Math.round(4 * FPS) });
  const dd = R.planDissolves(withTail, 4);
  const total = (c) => c.reduce((a, x) => a + (x.f1 - x.f0), 0);
  ok(total(dd) === total(base) && dd[dd.length - 1].f1 === base[base.length - 1].f1 && dd[0].f0 === 0, '전체 프레임 수 · 처음·끝이 그대로(디졸브는 길이를 바꾸지 않는다)');
  ok(dd.every((c, i) => i === 0 || c.f0 === dd[i - 1].f1), '조각이 빈틈·겹침 없이 이어진다');
  const ds = dd.filter((c) => c.type === 'dissolve');
  ok(ds.length === 2 && dd.dissolves === 2, `경계 2곳(a→b · b→c)에만 디졸브(${ds.length})`);
  ok(ds.every((c) => c.f1 - c.f0 === Math.round(4 * FPS)), `창 길이 = 4초(${Math.round(4 * FPS)}프레임) — 앞뒤 2초씩`);
  const w = ds[0]; const T = 100 * FPS;
  ok(w.f0 === T - Math.round(2 * FPS) && w.f1 === T + Math.round(2 * FPS), '창이 경계(100초) 앞뒤 2초');
  const after = dd[dd.indexOf(w) + 1];
  ok(after.f0 === w.f1 && after.kbOff === (withTail.find((c) => c.file === 'b.png') || {}).kbOff + Math.round(2 * FPS), '뒤 그림은 창이 끝난 자리에서 이어서 움직인다(kbOff 가 창 절반만큼 앞서 있다)');
  // 대상이 아닌 경계
  const same = R.planDissolves(R.planChunks([img('a.png', 0, 60), img('a.png', 60, 120)], 20, { minTailFrames: 100 }), 4);
  ok(!same.some((c) => c.type === 'dissolve'), '같은 그림 파일 사이(켄번스 구간 경계)는 섞지 않는다');
  const vid = { ...img('b.png', 60, 120), type: 'video' };
  ok(!R.planDissolves(R.planChunks([img('a.png', 0, 60), vid], 20, { minTailFrames: 100 }), 4).some((c) => c.type === 'dissolve'), '영상이 낀 경계는 컷');
  const stacked = { ...img('b.png', 60, 120), layers: [img('x.png', 0, 120).layers[0], img('b.png', 60, 120).layers[0]] };
  ok(!R.planDissolves(R.planChunks([img('a.png', 0, 60), stacked], 20, { minTailFrames: 100 }), 4).some((c) => c.type === 'dissolve'), '겹친 그림 경계는 컷');
  const tiny = R.planDissolves(R.planChunks([img('a.png', 0, 3), img('b.png', 3, 6)], 20, { minTailFrames: 100 }), 6);
  const tw = tiny.find((c) => c.type === 'dissolve');
  ok(!tw || (tw.f1 - tw.f0) <= Math.floor(0.45 * 3 * FPS) * 2, '아주 짧은 구간은 창이 구간의 45% 를 넘지 않는다(통째로 섞이지 않게)');
}

console.log('\n[2] 설정 값');
{
  ok(VL.normDissolve(undefined) === 0 && VL.normDissolve('4') === 4 && VL.normDissolve(99) === 0 && VL.normDissolve(-1) === 0 && VL.normDissolve(0.2) === 0, 'normDissolve: 0 · 0.5~10 만(기본 0 = 컷)');
  const g = P.parseScriptText('# t\n## 장\n### 장면\n가나다라마바사입니다.\n', 'longform', {});
  ok(/"dissolveSec":4/.test(JSON.stringify(P.vrewInputsOf(g.projects[0], { dissolveSec: 4 }, 20))) && !/dissolveSec/.test(JSON.stringify(P.vrewInputsOf(g.projects[0], {}, 20))), '빌드 지문에 채널 디졸브가 실린다(바꾸면 다시 굽는다)');
}

console.log('\n[3] 실제 MP4 — 빨강 10초 → 파랑 10초');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diss-'));
  try {
    const red = path.join(tmp, 'r.png'), blue = path.join(tmp, 'b.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=1920x1080', '-frames:v', '1', red]);
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080', '-frames:v', '1', blue]);
    const r = P.parseScriptText('# t\n## 장\n### ① 첫\n첫째 문장입니다. 둘째 문장입니다.\n### ② 둘\n셋째 문장입니다. 넷째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0];
    pr.groups[0].imagePath = red; pr.groups[1].imagePath = blue;
    pr.sentences.forEach((s, i) => { const mp3 = path.join(tmp, `s${i}.mp3`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '5', '-c:a', 'libmp3lame', mp3]); s.ttsAudioPath = mp3; s.ttsDurationSec = 5; });
    const vrew = path.join(tmp, 'a.vrew');
    await P.buildProjectVrew(pr, vrew, {}, () => {}, 20, 1);
    const bake = async (name, d) => { const mp4 = path.join(tmp, name + '.mp4'); const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 2, dissolveSec: d }); if (!res || !res.ok) throw new Error('렌더 실패 ' + (res && res.error)); return mp4; };
    const dur = (f) => parseFloat(execFileSync(FF, ['-hide_banner', '-i', f], { stdio: ['ignore', 'pipe', 'pipe'] }) + '') || 0;
    const info = (f) => { try { execFileSync(FF, ['-hide_banner', '-i', f], { stdio: 'pipe' }); } catch (e) { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(e.stderr)); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0; } return 0; };
    const px = (f, t) => { const raw = execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=16:9', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 }); const i = (4 * 16 + 8) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
    const cut = await bake('cut', 0), dis = await bake('dis', 4);
    const dc = info(cut), dd = info(dis);
    ok(Math.abs(dc - dd) < 0.08 && dc > 19.5, `영상 길이는 그대로(컷 ${dc.toFixed(2)}초 · 디졸브 ${dd.toFixed(2)}초)`);
    const c0 = px(cut, 9.9), c1 = px(cut, 10.1);
    ok(c0[0] > 200 && c0[2] < 60 && c1[2] > 200 && c1[0] < 60, `컷(0초): 경계에서 빨강 → 파랑 단번에(${c0} → ${c1})`);
    const seq = [7.0, 8.3, 9.0, 9.6, 10.0, 10.4, 11.0, 11.7, 13.0].map((t) => ({ t, p: px(dis, t) }));
    console.log('   ', seq.map((x) => `${x.t}s=${x.p.join(',')}`).join(' | '));
    ok(seq[0].p[0] > 200 && seq[0].p[2] < 60, '창 앞(7초)은 순수 빨강');
    ok(seq[8].p[2] > 200 && seq[8].p[0] < 60, '창 뒤(13초)는 순수 파랑');
    const mid = seq[4].p;
    ok(mid[0] > 80 && mid[0] < 175 && mid[2] > 80 && mid[2] < 175, `🔑 경계(10초)는 반반 섞였다(${mid})`);
    let mono = true; for (let i = 1; i < seq.length; i++) if (seq[i].p[0] > seq[i - 1].p[0] + 6 || seq[i].p[2] < seq[i - 1].p[2] - 6) mono = false;
    ok(mono, '빨강은 줄고 파랑은 느는 단조(되돌아가거나 튀지 않는다)');
    ok(!seq.some((x) => x.p[0] + x.p[2] < 150), '섞이는 동안 어두워지지 않는다(검정으로 빠지지 않음)');
    // 같은 길이 · 같은 조각 계획으로 두 번 굽기 — 컷은 예전과 같다(D=0 은 planChunks 가 예전 그대로)
    const cut2 = await bake('cut2', 0);
    ok(px(cut2, 9.9)[0] > 200 && Math.abs(info(cut2) - dc) < 0.05, 'D=0 은 몇 번 구워도 같다');
    console.log('\n[4] 켄번스가 있는 그림 — 창 시작·끝에서 화면이 튀지 않는다(켄번스가 창 안팎에서 이어진다)');
    const ta = path.join(tmp, 'ta.png'), tb = path.join(tmp, 'tb.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:d=1', '-frames:v', '1', ta]);
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=1920x1080:d=1', '-frames:v', '1', tb]);
    pr.groups[0].imagePath = ta; pr.groups[1].imagePath = tb;
    const vrew2 = path.join(tmp, 'k.vrew');
    await P.buildProjectVrew(pr, vrew2, {}, () => {}, 20, 1);
    const mk = path.join(tmp, 'k.mp4');
    const rr = await R.renderVrewToMp4({ vrewPath: vrew2, outPath: mk, log: () => {}, par: 2, dissolveSec: 4 });
    ok(rr && rr.ok, 'MP4 렌더 성공');
    const gray = (t) => execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', mk, '-frames:v', '1', '-vf', 'scale=192:108', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 });
    const df = (a, b) => { let x = 0; for (let i = 0; i < a.length; i++) x += Math.abs(a[i] - b[i]); return x / a.length; };
    // 창 = 8.0 ~ 12.0 초. 시작(8.0)·끝(12.0) 전후 한 프레임씩과 같은 간격의 평소 차이를 비교
    const s0 = df(gray(7.96), gray(8.04)), s0n = df(gray(7.88), gray(7.96));
    const e0 = df(gray(11.96), gray(12.04)), e0n = df(gray(12.04), gray(12.12));
    console.log(`   창 시작 가로지름 ${s0.toFixed(2)} (평소 ${s0n.toFixed(2)}) · 창 끝 가로지름 ${e0.toFixed(2)} (평소 ${e0n.toFixed(2)})`);
    ok(s0 < Math.max(2.0, s0n * 4), '창 시작(앞 그림 → 섞기 시작)에서 화면이 튀지 않는다');
    ok(e0 < Math.max(2.0, e0n * 4), '창 끝(섞기 끝 → 뒤 그림)에서 화면이 튀지 않는다');
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} dissolve ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 오류:', e); process.exit(1); });
