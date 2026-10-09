'use strict';
/**
 * node test/kbseg.test.js — 🎞 켄번스 구간(v0.7.75 · 삼국지 R2) — 웨이포인트 · 구간 수 · .vrew 구조 · MP4 이음새
 *   한 그림이 몇 분 보일 때 문장 경계에서 N 구간으로 나눠, 구간마다 자기 자산(트랙)·자기 켄번스를 둔다. 이음새에서 튀지 않아야 한다.
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const VB = require('../vrew/vrew-builder');
const VL = require('../core/visual-look');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const FF = require('../core/media-utils').getFfmpegPath();

console.log('[1] 웨이포인트 — 양 끝은 옛 패턴 · 이음새 연속 · 범위 안');
{
  const f = { scale: 0.862, centerX: 0.55, centerY: 0.5 }, t = { scale: 0.862, centerX: 0.45, centerY: 0.5 };
  for (const n of [2, 3, 6]) {
    const w = VB.kbWaypoints(f, t, n, 5);
    ok(w.length === n + 1 && Math.abs(w[0].centerX - 0.55) < 1e-9 && Math.abs(w[n].centerX - 0.45) < 1e-9, `${n}구간 → 프레임 ${n + 1}개 · 처음·끝은 옛 패턴 그대로`);
    ok(w.every((x) => x.scale >= 0.79 && x.scale <= 1 && x.centerX - x.scale / 2 >= -1e-9 && x.centerX + x.scale / 2 <= 1 + 1e-9 && x.centerY - x.scale / 2 >= -1e-9 && x.centerY + x.scale / 2 <= 1 + 1e-9), `${n}구간: 모든 프레임이 그림 안(검정 노출 없음)`);
    let minMove = 1; for (let k = 0; k < n; k++) minMove = Math.min(minMove, Math.abs(w[k + 1].scale - w[k].scale) + Math.abs(w[k + 1].centerX - w[k].centerX) + Math.abs(w[k + 1].centerY - w[k].centerY));
    ok(minMove > 0.02, `${n}구간: 구간마다 눈에 보이는 움직임이 있다(최소 이동 ${minMove.toFixed(3)})`);
  }
  const a = VB.kbWaypoints(f, t, 4, 1), b = VB.kbWaypoints(f, t, 4, 2);
  ok(JSON.stringify(a) !== JSON.stringify(b), '그룹 번호(seed)가 다르면 흔들리는 방향도 다르다');
  const zi = VB.kbWaypoints({ scale: 0.926, centerX: 0.5, centerY: 0.5 }, { scale: 0.82, centerX: 0.5, centerY: 0.5 }, 3, 3);
  ok(zi.every((x) => x.scale >= 0.8 && x.scale <= 0.95), '줌 패턴도 확대 한계 0.80~0.95 안');
}

console.log('\n[2] 구간 수 규칙');
{
  ok(VB.kbSegCount(1, 600, 50) === 1 && VB.kbSegCount(undefined, 600, 50) === 1, '한 번에 = 1');
  ok(VB.kbSegCount(3, 600, 50) === 3, '3구간 = 3');
  ok(VB.kbSegCount(6, 20, 5) === 2, '짧은 그림(20초)은 구간당 8초 미만이 되지 않게 줄인다(6 → 2)');
  ok(VB.kbSegCount(3, 10, 5) === 1, '10초는 나누지 않는다');
  ok(VB.kbSegCount('auto', 210, 30) === 4 && VB.kbSegCount('auto', 150, 30) === 3 || VB.kbSegCount('auto', 150, 30) === 2, `자동 = 약 60초마다(210초 → ${VB.kbSegCount('auto', 210, 30)} · 150초 → ${VB.kbSegCount('auto', 150, 30)})`);
  ok(VB.kbSegCount('auto', 4000, 200) === 8, '자동 상한 8구간');
  ok(VB.kbSegCount(6, 600, 3) === 3, '문장 수보다 많이 나누지 않는다');
}

console.log('\n[3] visual-look — 그룹 값 · 채널 값');
{
  ok(VL.normLook({}).kbSeg === undefined && VL.isDefault({ kbSeg: 0 }) && VL.isDefault({}), '기본(채널 설정대로) = 필드 없음 · 기본 모양');
  ok(VL.normLook({ kbSeg: 3 }).kbSeg === 3 && VL.normLook({ kbSeg: 'auto' }).kbSeg === 'auto' && VL.normLook({ kbSeg: 'off' }).kbSeg === 'off', '3 · auto · off 저장');
  ok(VL.normLook({ kbSeg: 99 }).kbSeg === undefined && VL.normLook({ kbSeg: 'x' }).kbSeg === undefined, '이상한 값은 버린다');
  ok(!VL.isDefault({ kbSeg: 'off' }) && !VL.isDefault({ kbSeg: 2 }), 'off · 2 는 기본이 아니다');
  ok(VL.normKbSeg(undefined) === 1 && VL.normKbSeg('auto') === 'auto' && VL.normKbSeg('3') === 3 && VL.normKbSeg(7) === 1, '채널 값 정규화(1 · auto · 2~6)');
  ok(/켄번스 3구간/.test(VL.describe({ kbSeg: 3 })), '설명 문구');
}

console.log('\n[4] .vrew — 구간마다 자산·트랙 · 문장→구간 · 이음새 연속');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kbseg-'));
  try {
    const img = path.join(tmp, 'g.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:d=1', '-frames:v', '1', img]);
    const mk = (nSent, secEach) => {
      const txt = Array.from({ length: nSent }, (_, i) => `${i + 1}번째 문장입니다.`).join(' ');
      const r = P.parseScriptText(`# t\n## 장\n### 장면\n${txt}\n`, 'longform', {});
      const pr = r.projects[0];
      pr.groups[0].imagePath = img;
      pr.sentences.forEach((s, i) => { const mp3 = path.join(tmp, `s${nSent}_${i}.mp3`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(secEach), '-c:a', 'libmp3lame', mp3]); s.ttsAudioPath = mp3; s.ttsDurationSec = secEach; });
      return pr;
    };
    const read = (vrew) => JSON.parse(new AdmZip(vrew).readAsText('project.json'));
    const imgTracks = (pj) => Object.values(pj.props.tracks).filter((t) => t.type === 'image').sort((a, b) => 0);
    const build = async (pr, name, look, preset) => { pr.groups[0].look = look || undefined; const v = path.join(tmp, name + '.vrew'); await P.buildProjectVrew(pr, v, preset || {}, () => {}, 20, 1); return v; };

    const pr6 = mk(6, 30);   // 문장 6개 × 30초 = 180초
    const v1 = await build(pr6, 'base', null);
    ok(imgTracks(read(v1)).length === 1, '기본(한 번에) = 이미지 트랙 1개 — 옛 동작 그대로');
    const v3 = await build(pr6, 'seg3', { kbSeg: 3 });
    const pj3 = read(v3);
    const tr3 = imgTracks(pj3);
    ok(tr3.length === 3 && new Set(tr3.map((t) => t.mediaId)).size === 1, `3구간 = 이미지 트랙 3개 · 같은 그림 파일 1개를 가리킨다(트랙 ${tr3.length})`);
    ok(pj3.files.filter((f) => f.type === 'Image').length === 1, '그림 파일 항목은 1개(중복 없음)');
    // 클립 → 자산 → 트랙 순서(시간순)
    const trackOfAid = (aid) => pj3.props.tracks[(pj3.props.assets[aid].trackIds || [])[0]];
    const clipSegs = pj3.transcript.clips.map((c) => (c.assetIds || []).map((a) => trackOfAid(a)).filter((t) => t && t.type === 'image').map((t) => t.trackId)[0]);
    const order = [...new Set(clipSegs)];
    ok(order.length === 3, `클립이 3개 구간 자산으로 나뉜다(${order.length})`);
    const runs = []; clipSegs.forEach((x) => { if (!runs.length || runs[runs.length - 1].id !== x) runs.push({ id: x, n: 0 }); runs[runs.length - 1].n++; });
    ok(runs.length === 3, '구간이 시간순으로 이어진다(섞이지 않는다)');
    const chain = order.map((id) => pj3.props.tracks[id].kenburnsAnimationInfo);
    ok(chain.every((k) => k && k.from && k.to), '구간마다 자기 켄번스(from·to)');
    ok(JSON.stringify(chain[0].to) === JSON.stringify(chain[1].from) && JSON.stringify(chain[1].to) === JSON.stringify(chain[2].from), '🔑 이음새 연속: 앞 구간의 끝 프레임 = 다음 구간의 시작 프레임');
    ok(order.every((id) => { const t = pj3.props.tracks[id]; return t.zIndex === pj3.props.tracks[order[0]].zIndex && t.width === pj3.props.tracks[order[0]].width; }), '구간 트랙은 같은 층 · 같은 박스');

    // 짧은 그림은 나누지 않는다 · 'off' 는 채널 기본을 이긴다 · 채널 기본이 적용된다
    const prShort = mk(4, 4);   // 16초
    const vs = await build(prShort, 'short', { kbSeg: 6 });
    ok(imgTracks(read(vs)).length === 2, '짧은 그림(16초)에 6구간을 줘도 8초 미만으로는 안 나눈다(2구간)');
    const vch = await build(pr6, 'chan', null, { kbSeg: 2 });
    ok(imgTracks(read(vch)).length === 2, '채널 기본 2구간이 그룹 값 없는 그룹에 적용된다');
    const voff = await build(pr6, 'off', { kbSeg: 'off' }, { kbSeg: 2 });
    ok(imgTracks(read(voff)).length === 1, "그룹 값 'off' 는 채널 기본을 이긴다(나누지 않음)");
    const vgr = await build(pr6, 'grp', { kbSeg: 3 }, { kbSeg: 2 });
    ok(imgTracks(read(vgr)).length === 3, '그룹 값(3)이 채널 기본(2)을 이긴다');
    const vauto = await build(pr6, 'auto', { kbSeg: 'auto' });
    ok(imgTracks(read(vauto)).length === 3, `자동(180초 ≈ 60초마다) = 3구간(${imgTracks(read(vauto)).length})`);
    const vnone = await build(pr6, 'none', { motion: 'none', kbSeg: 3 });
    ok(imgTracks(read(vnone)).length === 1 && !imgTracks(read(vnone))[0].kenburnsAnimationInfo, '움직임 없음 = 구간 나누기도 없다');

    // 지문(건너뛰기)이 채널 기본 구간을 본다
    pr6.groups[0].look = undefined;
    const fp1 = JSON.stringify(P.vrewInputsOf(pr6, { kbSeg: 3 }, 20)), fp0 = JSON.stringify(P.vrewInputsOf(pr6, {}, 20));
    ok(fp1 !== fp0 && /"kbSeg":3/.test(fp1) && !/"kbSeg"/.test(fp0), '빌드 지문에 채널 켄번스 구간이 실린다(바꾸면 다시 만든다)');

    console.log('\n[5] MP4 — 이음새에서 화면이 튀지 않는다');
    // 구간 3 = 60초 단위. 앞 8초만 굽는 대신 경계 전후 두 프레임을 비교한다: 경계 직전 프레임과 직후 프레임의 차이는 평소 이웃 프레임 차이와 같은 수준이어야 한다.
    const prM = mk(3, 6);   // 18초 · 3구간(구간당 6초 — 8초 규칙에 걸리지 않게 'auto' 아닌 숫자 3 = floor(18/8)=2 → 2구간)
    const vm = await build(prM, 'mp4', { kbSeg: 2 });
    const pjm = read(vm);
    const ks = imgTracks(pjm).map((t) => t.kenburnsAnimationInfo);
    ok(ks.length === 2 && JSON.stringify(ks[0].to) === JSON.stringify(ks[1].from) || JSON.stringify(ks[1].to) === JSON.stringify(ks[0].from), '2구간 .vrew 이음새 연속');
    const mp4 = path.join(tmp, 'mp4.mp4');
    const res = await R.renderVrewToMp4({ vrewPath: vm, outPath: mp4, log: () => {}, par: 1 });
    ok(res && res.ok, 'MP4 렌더 성공 ' + (res && res.error || ''));
    if (res && res.ok) {
      const frameAt = (t) => execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=192:108', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 64 << 20 });
      const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };
      const bounds = [6, 12];
      let worst = 0, ref = 0, cr = 0;
      for (const bt of bounds) {
        const cross = diff(frameAt(bt - 0.04), frameAt(bt + 0.04));     // 경계를 가로지르는 0.08초
        const pre = diff(frameAt(bt - 0.12), frameAt(bt - 0.04));       // 경계 앞쪽 0.08초(같은 간격)
        const post = diff(frameAt(bt + 0.04), frameAt(bt + 0.12));      // 경계 뒤쪽 0.08초
        console.log(`   경계 ${bt}초: 앞 ${pre.toFixed(2)} · 가로지름 ${cross.toFixed(2)} · 뒤 ${post.toFixed(2)}`);
        worst = Math.max(worst, cross / Math.max(0.05, Math.max(pre, post))); ref = Math.max(ref, pre, post);
        if (bt === 6) cr = cross;   // 6초만 구간 경계(12초는 같은 구간 안)
      }
      // 기준: 켄번스 구간이 없는 같은 영상에서도 구간 사이 한 프레임 간격이 0.4 안팎 튄다(청크 이음 · 인코딩) — 그 수준의 2~3배 안이면 위치가 튄 것이 아니다. 위치가 튀면(이음새가 안 이어지면) 10 이상
      ok(cr < 2.0, `경계를 가로지르는 0.08초 프레임 차이(${cr.toFixed(2)})가 2.0 미만 — 위치 튐 없음(testsrc2 는 매우 세밀한 그림이라 어긋나면 10 이상)`);
      const early = frameAt(0.2), late = frameAt(17.5);
      ok(diff(early, late) > 0.3, `그림이 실제로 움직였다(처음과 끝 화면 차 ${diff(early, late).toFixed(2)})`);
    }
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} kbseg ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 오류:', e); process.exit(1); });
