// 🔊 그룹 영상 소리 선택(look.vsound · v1.0.61) — 영상 그룹마다 TTS 내레이션 / 영상 자체의 소리 / 섞기를 고른다
//   node test/vsound.test.js
//   [1] 규칙(visual-look · templates) [2] kie 모델 소리 인자 [3] video-fit 소리 지키기 [4] 실제 왕복(.vrew → MP4 → 주파수 대역 측정) [5] 배선
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

console.log('\n[1] 규칙 — normVsound · normLook · 템플릿');
ok(VL.normVsound(null) === null && VL.normVsound({}) === null && VL.normVsound('x') === null, '없음·모르는 값은 null(= 채널 기본값 · 그것도 없으면 내레이션만)');
ok(JSON.stringify(VL.normVsound({ mode: 'tts' })) === '{"mode":"tts"}' && VL.normChanVsound({ mode: 'tts' }) === null, '명시 「내레이션만」은 그룹에 남는다(채널 기본값을 이긴다) · 채널 값으로는 null');
ok(JSON.stringify(VL.normVsound('video')) === '{"mode":"video","vol":100}', '문자열만 줘도 되고 「영상 소리만」 기본 음량 100%');
ok(JSON.stringify(VL.normVsound({ mode: 'mix' })) === '{"mode":"mix","vol":100,"nar":50}', '「섞기」 기본 = 영상 100% · 내레이션 50%(로이: TTS 는 줄이고 영상 소리는 올려서)');
ok(VL.normVsound({ mode: 'mix', nar: 999 }).nar === 200 && VL.normVsound({ mode: 'mix', nar: 0 }).nar === 0 && !('nar' in VL.normVsound({ mode: 'video', nar: 30 })), '내레이션 음량은 0~200 · 「영상 소리만」에는 없다');
// 🔑 effVsound — 그룹 값 > 채널 기본값 · 명시 tts 는 채널을 이긴다
const CH = { mode: 'mix', vol: 80, nar: 40 };
ok(VL.effVsound({}, CH).nar === 40 && VL.effVsound({ look: { vsound: { mode: 'tts' } } }, CH) === null && VL.effVsound({ look: { vsound: { mode: 'video' } } }, CH).mode === 'video' && VL.effVsound({}, null) === null && VL.effVsound({}, { mode: 'tts' }) === null, '🔑 effVsound — 그룹 값 > 채널 기본값 · 그룹의 「내레이션만」이 채널을 이긴다');
ok(VL.vsoundLabel(CH) === '내레이션 40% + 영상 80%' && VL.vsoundLabel({ mode: 'video' }) === '영상 소리만 100%' && VL.vsoundLabel(null) === '내레이션만', 'vsoundLabel');
ok(VL.normVsound({ mode: 'mix', vol: 999 }).vol === 200 && VL.normVsound({ mode: 'mix', vol: -5 }).vol === 0 && VL.normVsound({ mode: 'video', vol: '55.4' }).vol === 55, '음량은 0~200 으로 자른다 · 0 은 유효');
ok(VL.isDefault({}) && VL.isDefault({ vsound: null }) && !VL.isDefault({ vsound: { mode: 'video' } }), '🔑 isDefault — 소리 선택이 있으면 기본이 아니다(저장된다)');
const nl = VL.normLook({ fill: 'cover', vsound: { mode: 'mix', vol: 40 } });
ok(nl.vsound && nl.vsound.mode === 'mix' && nl.vsound.vol === 40 && nl.fill === 'cover', 'normLook 이 다른 필드와 함께 싣는다');
ok(!('vsound' in VL.normLook({ fill: 'cover' })) && !('vsound' in VL.normLook({ vsound: { mode: 'zzz' } })), '기본이면 필드를 두지 않는다(옛 작업본·옛 동작 그대로)');
ok(/영상 소리만 100%/.test(VL.describe({ vsound: { mode: 'video' } })) && /내레이션 50% \+ 영상 100%/.test(VL.describe({ vsound: { mode: 'mix' } })) && /내레이션만\(채널 기본값 무시\)/.test(VL.describe({ vsound: { mode: 'tts' } })), 'describe 에 소리 설정이 로그로 보인다');
ok(VL.vsoundOf({ look: { vsound: { mode: 'video', vol: 80 } } }).vol === 80 && VL.vsoundOf({}) === null && VL.vsoundOf(null) === null, 'vsoundOf(그룹)');
const TP = require('../core/templates');
const kept = TP.applyLook({ vsound: { mode: 'video', vol: 70 }, fill: 'cover' }, { fill: 'contain' });
ok(kept && kept.vsound && kept.vsound.mode === 'video' && kept.fill === 'contain', '🔑 효과 템플릿을 입혀도 소리 선택은 그대로(KEEP_KEYS)');
ok(!TP.LOOK_KEYS.includes('vsound'), '템플릿이 소리 선택을 담지는 않는다(그림 효과 한 벌이 아니다)');
// 효과 상태가 아니라 내용(영상 소리)이므로 .vrew 지문에 들어가야 한다 — 그룹 객체가 통째로 들어간다
const BF = require('../core/build-fingerprint');
const g0 = { id: 'g1', look: { fill: 'cover' } }, g1 = { id: 'g1', look: { fill: 'cover', vsound: { mode: 'video', vol: 100 } } };
const FP_PENDING = (async () => {
  const f0 = await BF.fingerprint({ groups: [g0] }), f1 = await BF.fingerprint({ groups: [g1] }), f0b = await BF.fingerprint({ groups: [{ id: 'g1', look: { fill: 'cover' } }] });
  ok(f0 && f1 && f0 !== f1 && f0 === f0b, '소리 선택을 바꾸면 빌드 지문이 달라진다(.vrew 를 다시 만든다) · 같으면 같다');
})();

console.log('\n[2] kie 모델 — 소리 켜기 인자');
const KM = require('../core/kie-models');
const FLAG_KEYS = { 'seedance-2-5': 'generate_audio', 'seedance-2-fast': 'generate_audio', 'seedance-2-mini': 'generate_audio', 'kling-3': 'sound', 'wan-3': 'audio', 'wan-3-prime': 'audio', 'vidu-q4': 'audio' };
for (const id of Object.keys(FLAG_KEYS)) {
  const m = KM.VIDEO.find((x) => x.id === id);
  const on = KM.buildVideoInput(m, { prompt: 'p', aspect: '16:9', durationSec: 6, imageUrl: 'http://x/a.png', sound: true });
  const off = KM.buildVideoInput(m, { prompt: 'p', aspect: '16:9', durationSec: 6, imageUrl: 'http://x/a.png' });
  ok(on[FLAG_KEYS[id]] === true && off[FLAG_KEYS[id]] === false && KM.soundOf(m) === 'flag', `${id} — sound:true → ${FLAG_KEYS[id]}=true · 안 주면 false(기본은 끈다)`);
}
ok(['minimax-h3', 'veo-3-1-lite', 'veo-3-1-fast'].every((id) => KM.soundOf(KM.VIDEO.find((x) => x.id === id)) === 'always'), 'MiniMax H3 · Veo 3.1 은 끌 수 없음(always)');
ok(KM.VIDEO.every((m) => ['flag', 'always', 'unknown'].includes(KM.soundOf(m))) && KM.soundOf(null) === 'unknown', '모든 영상 모델이 분류된다(새 모델은 unknown 으로 시작 — 확인 뒤 표에 올린다)');
// 소리 인자가 없는 모델에 sound:true 를 줘도 입력이 깨지지 않는다
const hh = KM.buildVideoInput(KM.VIDEO.find((x) => x.id === 'happyhorse-1-1'), { prompt: 'p', aspect: '16:9', durationSec: 6, imageUrl: 'u', sound: true });
ok(hh && hh.prompt === 'p' && !('sound' in hh) && !('audio' in hh), '인자 없는 모델은 입력을 그대로(소리를 지어내 보내지 않는다)');

console.log('\n[3] video-fit — 소리 지키기 인자');
const VF = require('../core/video-fit');
const pSlow = VF.plan(6, 7), pLoop = VF.plan(3, 7);
const sArgs = VF.buildArgs('in.mp4', 6, 7, 'out.mp4', pSlow).join(' ');
ok(/anullsrc/.test(sArgs) && /-map 1:a/.test(sArgs) && !/atempo/.test(sArgs), 'keepAudio 없으면 예전과 같다 — 무음 오디오 트랙을 입힌다');
const kSlow = VF.buildArgs('in.mp4', 6, 7, 'out.mp4', pSlow, true).join(' ');
ok(/\[0:a\]atempo=0\.857\d+/.test(kSlow) && /-map \[a\]/.test(kSlow) && !/-map 1:a/.test(kSlow), '느리게(slow) — 소리도 같은 비율로 늘인다(atempo 1/비율)');
const kLoop = VF.buildArgs('in.mp4', 3, 7, 'out.mp4', pLoop, true).join(' ');
ok(/\[0:a\]atrim=0:3\.000/.test(kLoop) && /apad\[a\]/.test(kLoop) && /-map \[a\]/.test(kLoop), '반복(loop) — 소리는 처음 한 번만(대사가 되풀이되지 않게) 뒤는 무음');
const kLoop2 = VF.buildArgs('in.mp4', 0.4, 60, 'out.mp4', VF.plan(0.4, 60), true).join(' ');
ok(/-stream_loop/.test(kLoop2) || /xfade/.test(kLoop2), '아주 짧은 영상도 인자가 만들어진다');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vsound-'));
const sh = (args) => execFileSync(FF, ['-y', '-loglevel', 'error', ...args]);
function bandDb(mp4, f, ss, t) {
  const r = spawnSync(FF, ['-hide_banner', '-ss', String(ss), '-t', String(t), '-i', mp4, '-af', Array(4).fill(`bandpass=f=${f}:width_type=h:w=80`).join(",") + ",volumedetect", '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr || ''); return m ? (m[1] === '-inf' ? -200 : +m[1]) : -200;
}
const mkVideo = (name, sec, withAudio) => {
  const p = path.join(tmp, name);
  if (withAudio) sh(['-f', 'lavfi', '-i', `color=c=0x336699:s=640x360:r=24:d=${sec}`, '-f', 'lavfi', '-i', `sine=f=1000:d=${sec}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p]);
  else sh(['-f', 'lavfi', '-i', `color=c=0x336699:s=640x360:r=24:d=${sec}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p]);
  return p;
};
(async () => {
  await FP_PENDING;
  const VFm = require('../core/video-fit');
  try {
    // 실제 파일: 3초 영상(1kHz)을 7초로 — 반복 모드에서 소리는 처음 3초만, 뒤는 무음
    const src = mkVideo('src3.mp4', 3, true);
    const outL = await VFm.fitVideo(src, 3, 7, { dir: path.join(tmp, 'fitc'), keepAudio: true });
    ok(outL.mode === 'loop' && outL.path !== src, '반복 모드로 맞춰졌다(keepAudio)');
    const e1 = bandDb(outL.path, 1000, 0.2, 2.2), e2 = bandDb(outL.path, 1000, 4.0, 2.5);
    console.log('   fit loop 1kHz dB', JSON.stringify({ first3s: e1, after3s: e2 }));
    ok(e1 > -35 && e2 < -60, `🔑 처음 한 번만 소리(${e1} dB) · 뒤는 무음(${e2} dB) — 대사가 되풀이되지 않는다`);
    const outS = await VFm.fitVideo(mkVideo('src6.mp4', 6, true), 6, 7, { dir: path.join(tmp, 'fitc'), keepAudio: true });
    ok(outS.mode === 'slow', '느리게 모드로 맞춰졌다(keepAudio)');
    const s1 = bandDb(outS.path, 1000, 0.5, 5.5);
    ok(s1 > -35, `느리게 해도 소리가 이어진다(1kHz 유지 — atempo 는 음높이를 지킨다 · ${s1} dB)`);
    const outN = await VFm.fitVideo(mkVideo('src3b.mp4', 3, true), 3, 7, { dir: path.join(tmp, 'fitn') });
    ok(bandDb(outN.path, 1000, 0.2, 2.2) < -60, '🔑 keepAudio 를 안 주면 예전처럼 무음(기본 동작 불변)');
    const noSrc = mkVideo('noaud.mp4', 3, false);
    const noA = await VFm.fitVideo(noSrc, 3, 7, { dir: path.join(tmp, 'fita'), keepAudio: true });
    ok(noA.mode === 'loop' && noA.path !== noSrc, '원본에 소리가 없어도 keepAudio 가 실패하지 않는다(무음 트랙으로)');
  } catch (e) { ok(false, 'video-fit 실제 파일 실패: ' + e.message); }

  console.log('\n[4] 실제 왕복 — 빌더(.vrew) → 렌더러(MP4) → 주파수 대역으로 어느 소리가 나는지 측정');
  const P = require('../core/pipeline');
  const R = require('../core/vrew-render');
  const img = path.join(tmp, 'g.png');
  sh(['-f', 'lavfi', '-i', 'color=c=0x808080:s=1920x1080', '-frames:v', '1', img]);
  const SCRIPT = '# t\n## 장\n### 장면 하나\n첫 문장입니다. 둘째 문장입니다. 셋째 문장입니다.\n### 장면 둘\n넷째 문장입니다. 다섯째 문장입니다. 여섯째 문장입니다.\n';
  async function scenario(name, { vsound, video, vsec, preset } = {}) {
    const r = P.parseScriptText(SCRIPT, 'longform', {});
    const pr = r.projects[0];
    P.fillSilent(pr, path.join(tmp, 'tts-' + name));
    for (const s of pr.sentences) {   // 내레이션 = 440Hz 톤(영상 소리 = 1000Hz) — 대역으로 어느 쪽이 나는지 가른다
      const w = path.join(tmp, `tts-${name}`, `${s.num}.wav`);
      sh(['-f', 'lavfi', '-i', `sine=f=440:d=${s.ttsDurationSec}`, '-ar', '24000', '-ac', '1', w]);
      s.ttsAudioPath = w;
    }
    for (const g of pr.groups) g.imagePath = img;
    const g0 = pr.groups[0];
    const span0 = pr.getSentencesOfGroup(g0).reduce((a, s) => a + s.ttsDurationSec, 0);
    const vlen = vsec != null ? vsec : span0 + 3;
    g0.videoPath = mkVideo(`v-${name}.mp4`, vlen, video !== 'none');
    if (vsound) g0.look = VL.normLook({ vsound });
    const logs = [];
    const vrew = path.join(tmp, name + '.vrew');
    await P.buildProjectVrew(pr, vrew, preset || {}, (l) => logs.push(l), 20, 1);
    const mp4 = path.join(tmp, name + '.mp4');
    const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
    if (!res || !res.ok) throw new Error('렌더 실패: ' + (res && res.error));
    const span1 = pr.getSentencesOfGroup(pr.groups[1]).reduce((a, s) => a + s.ttsDurationSec, 0);
    const w0 = [0.5, Math.max(1, span0 - 1.2)], w1 = [span0 + 0.5, Math.max(1, span1 - 1.2)];
    const lv = {
      nar0: bandDb(mp4, 440, w0[0], w0[1] - w0[0] > 0.5 ? w0[1] - w0[0] : 0.5), vid0: bandDb(mp4, 1000, w0[0], w0[1] - w0[0] > 0.5 ? w0[1] - w0[0] : 0.5),
      nar1: bandDb(mp4, 440, w1[0], w1[1]), vid1: bandDb(mp4, 1000, w1[0], w1[1]),
    };
    console.log(`   [${name}] 그룹 ${pr.groups.length}개 · G1 ${span0.toFixed(1)}초 · dB`, JSON.stringify(lv));
    return { pr, vrew, mp4, logs, lv, span0 };
  }
  try {
    const none = await scenario('none');
    ok(none.pr.groups.length >= 2, `시험 대본이 그룹 둘 이상(${none.pr.groups.length})`);
    ok(none.lv.nar0 > -35 && none.lv.vid0 < -60 && none.lv.nar1 > -35, '① 선택 없음 — 내레이션만(영상 소리는 음소거 · 지금까지의 동작)');
    const pj0 = JSON.parse(new AdmZip(none.vrew).readAsText('project.json'));
    ok(Object.values(pj0.props.tracks).filter((t) => t.type === 'videoAudio').every((t) => t.volume === 0 && t.loop === true), '   .vrew: 영상 소리 트랙 volume 0 · loop(예전과 같다)');

    const vid = await scenario('video', { vsound: { mode: 'video' } });
    ok(vid.lv.nar0 < -60 && vid.lv.vid0 > -35, `② 영상 소리만 — G1 은 영상 소리만(내레이션 ${vid.lv.nar0} dB · 영상 ${vid.lv.vid0} dB)`);
    ok(vid.lv.nar1 > -35 && vid.lv.vid1 < -60, '   다른 그룹은 그대로 내레이션(영상 소리가 새지 않는다)');
    const pjv = JSON.parse(new AdmZip(vid.vrew).readAsText('project.json'));
    const vtr = Object.values(pjv.props.tracks).filter((t) => t.type === 'videoAudio' && t.volume > 0);
    ok(vtr.length === 1 && Math.abs(vtr[0].volume - 1) < 1e-9 && vtr[0].loop === false, '   .vrew: 그 그룹 소리 트랙만 volume 1 · 반복 끔(대사 되풀이 방지)');
    ok(vid.logs.some((l) => /🔊 G1 영상 소리 만\(내레이션 3문장 무음\) · 음량 100%/.test(l)), '   로그에 어떤 문장이 무음인지');

    const mix = await scenario('mix', { vsound: { mode: 'mix', vol: 30, nar: 100 } });
    ok(mix.lv.nar0 > -35 && mix.lv.vid0 > -45 && mix.lv.vid0 < mix.lv.nar0 - 5, `③ 섞기 30% — 내레이션 그대로 + 영상 소리가 낮게(${mix.lv.nar0} / ${mix.lv.vid0} dB)`);

    const mixN = await scenario('mixnar', { vsound: { mode: 'mix', vol: 100, nar: 50 } });
    ok(Math.abs((mix.lv.nar0 - mixN.lv.nar0) - 6.02) < 1.5 && mixN.lv.vid0 > mix.lv.vid0 + 8 && Math.abs(mixN.lv.nar1 - none.lv.nar1) < 0.5, `🔑 섞기 내레이션 50% — 내레이션이 약 6 dB 줄고(${mix.lv.nar0} → ${mixN.lv.nar0}) 영상 소리는 올라간다(${mixN.lv.vid0}) · 다른 그룹 내레이션은 그대로`);
    const chan = await scenario('chan', { preset: { videoSound: { mode: 'video' } } });
    ok(chan.lv.nar0 < -60 && chan.lv.vid0 > -35 && chan.lv.nar1 > -35, `🔑 채널 기본값(영상 소리만) — 그룹 값이 없어도 영상 소리만(${chan.lv.nar0} / ${chan.lv.vid0} dB)`);
    const chanTts = await scenario('chantts', { preset: { videoSound: { mode: 'video' } }, vsound: { mode: 'tts' } });
    ok(chanTts.lv.nar0 > -35 && chanTts.lv.vid0 < -60, '🔑 그룹의 「내레이션만」이 채널 기본값을 이긴다');
    const fpA = P.vrewInputsOf(chan.pr, {}, 20), fpB = P.vrewInputsOf(chan.pr, { videoSound: { mode: 'video' } }, 20), fpC = P.vrewInputsOf(chan.pr, { videoSound: { mode: 'tts' } }, 20);
    ok(!('videoSound' in fpA) && !('videoSound' in fpC) && fpB.videoSound && fpB.videoSound.mode === 'video', '채널 기본값이 빌드 지문 입력에 들어간다(내레이션만이면 넣지 않는다 — 옛 지문 그대로)');
    const noAud = await scenario('noaud', { vsound: { mode: 'video' }, video: 'none' });
    ok(noAud.lv.nar0 > -35 && noAud.lv.vid0 < -60, '🔑 ④ 영상에 소리가 없으면 내레이션을 끄지 않는다(말이 사라지지 않게)');
    ok(noAud.logs.some((l) => /G1 영상에 소리가 없어/.test(l)), '   그 사실을 로그로 알린다');

    const fitL = await scenario('fitloop', { vsound: { mode: 'video' }, vsec: 3 });
    ok(fitL.lv.nar0 < -60, '⑤ 영상이 짧아 반복으로 맞춘 그룹도 내레이션 무음');
    const early = bandDb(fitL.mp4, 1000, 0.3, 2.2), late = bandDb(fitL.mp4, 1000, 4, Math.max(0.5, fitL.span0 - 5));
    console.log('   fitloop 1kHz', JSON.stringify({ early, late }));
    ok(early > -35 && late < -60, `   영상 소리는 처음 한 번만(${early} dB) · 반복된 뒤는 무음(${late} dB) — 대사가 두 번 나오지 않는다`);
  } catch (e) { ok(false, '왕복 실패: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')); }

  console.log('\n[5] 배선');
  const BLD = read('vrew/vrew-builder.js'), MAIN = read('main.js'), APP = read('renderer/src/App.jsx'), KAPI = read('core/kie-api.js'), REND = read('core/vrew-render.js');
  ok(/_narVol/.test(BLD) && /_sentsA/.test(BLD) && /hasAudioStream\(_vsrc\)/.test(BLD), '빌더: 소리 있을 때만 켜고 · 문장 무음은 복사본으로');
  ok(/keepAudio: !!_vsnd/.test(BLD), '빌더 → 길이 맞추기가 영상 소리를 지킨다');
  ok(/_wantSound/.test(MAIN) && /sound: _wantSound/.test(MAIN) && /sound = false/.test(KAPI) && /sound: !!sound/.test(KAPI), 'main → kie-api → 모델 입력(소리를 고른 그룹만 켜고 만든다)');
  ok(/vtb-vsnd/.test(APP) && /tp="sx-vsnd"/.test(APP) && /tp="mn-vsnd"/.test(APP) && /function VsndMenu/.test(APP) && ['-chan', '-tts', '-video', '-mix'].every((k) => APP.includes("tp + '" + k + "'")), '화면: ① 칸 막대 🔊 · ② 그룹 메뉴 「🔊 볼륨」이 같은 VsndMenu(채널 기본값 / 내레이션만 / 영상 소리만 / 섞기 + 두 음량)');
  ok(/data-testid="mn-vsnd"/.test(APP) && /data-testid="mn-upscale"/.test(APP) && /onUpscale=\{runUpscale\}/.test(APP), '② 그룹 메뉴: 🔊 볼륨 · ⬆ 업스케일');
  ok(/data-testid="ch-vsnd"/.test(APP) && (APP.match(/videoSound: VLook\.normChanVsound\((p|ch)\.videoSound\)/g) || []).length === 2, '채널 편집 ▸ 제작 도구 「🔊 영상 소리」 — 읽기·저장 두 곳에 실린다');
  ok(/ipcMain\.handle\('upscale-group'/.test(MAIN) && /upscaleGroup:/.test(read('preload.js')) && /effVsound\(g, S\.preset && S\.preset\.videoSound\)/.test(MAIN), 'main: upscale-group IPC · AI 영상 소리 켜기는 채널 기본값까지 본다');
  ok(/x\.video \? Math\.min\(0\.04/.test(REND), '렌더러: 영상 소리는 앞 페이드를 짧게(대사 첫 마디가 먹히지 않게)');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\n${fail ? '❌' : '✅'} vsound ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
