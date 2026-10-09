'use strict';
/**
 * node test/fx.test.js — 🌫 오버레이 모션(삼국지 R1 · v0.7.77) — 규칙 · 질감 · 구간표 · 실제 MP4
 *   (밴딩·깜박임·비용의 30초 측정은 test/fx-proto.js — 수 분 걸려 따로 돌린다)
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const FXO = require('../core/fx-overlay');
const VL = require('../core/visual-look');
const R = require('../core/vrew-render');
const P = require('../core/pipeline');
const FF = require('../core/media-utils').getFfmpegPath();

console.log('[1] 값 규칙 — fx-overlay(main)와 visual-look(화면 번들)이 같다');
{
  const samples = [undefined, null, {}, { fog: 1 }, { fog: 3, dust: 2, firefly: 1, flicker: 3 }, { fog: 4, dust: -1, firefly: 'x', flicker: 2.4 }, { fog: '2' }];
  ok(samples.every((v) => JSON.stringify(FXO.normFx(v)) === JSON.stringify(VL.normFxChan(v))), '채널 값 정규화가 두 곳에서 같다');
  const gs = [undefined, 0, 'off', 1, 2, 3, 4, '2', 'x', -1, 2.6];
  ok(gs.every((v) => FXO.normGroupFx(v) === VL.normFxGroup(v)), '그룹 값 정규화가 두 곳에서 같다');
  ok(JSON.stringify(FXO.KINDS) === JSON.stringify(VL.FX_KINDS.map((k) => k.id)), '종류 목록이 같다');
  ok(VL.normLook({ fx: 'off' }).fx === 'off' && VL.normLook({ fx: 2 }).fx === 2 && VL.normLook({ fx: 0 }).fx === undefined && VL.normLook({ fx: 9 }).fx === undefined, '그룹 look.fx 저장(없음이면 필드 없음)');
  ok(VL.isDefault({}) && !VL.isDefault({ fx: 'off' }) && !VL.isDefault({ fx: 1 }), 'fx 가 있으면 기본 모양이 아니다');
  ok(!FXO.fxIsOff({ fog: 1 }) && FXO.fxIsOff({}) && FXO.fxIsOff(null) && VL.fxChanOn({ dust: 2 }) && !VL.fxChanOn({}), '켜짐 판정');
  const eff = FXO.effFx({ fog: 2, dust: 0, firefly: 1, flicker: 0 }, 3);
  ok(eff.fog === 3 && eff.firefly === 3 && eff.dust === 0 && eff.flicker === 0, '그룹 강도(3)는 채널에서 켠 종류에만 적용된다');
  ok(FXO.fxIsOff(FXO.effFx({ fog: 2 }, 'off')) && FXO.effFx({ fog: 2 }, 0).fog === 2, "그룹 'off' = 끔 · 없음 = 채널 설정대로");
}

console.log('\n[2] 구간표(planOf) — 그룹마다 자기 문장 시각');
{
  const sents = [1, 2, 3, 4, 5, 6].map((n) => ({ id: 's' + n, ttsAudioPath: 'x.mp3', ttsDurationSec: n === 5 ? 0 : 10 }));   // 5번은 음성 없음(빌더도 건너뛴다)
  const groups = [{ sentenceIds: ['s1', 's2'] }, { sentenceIds: ['s3'], look: { fx: 'off' } }, { sentenceIds: ['s4', 's5'], look: { fx: 1 } }, { sentenceIds: ['s6'] }];
  const pl = FXO.planOf({ sentences: sents, groups }, { fog: 2, flicker: 3 });
  ok(JSON.stringify(pl.map((r) => [r.t0, r.t1])) === JSON.stringify([[0, 20], [30, 40], [40, 50]]), '구간: 0~20(채널) · 30~40(강도 1) · 40~50(채널) · 꺼진 그룹(20~30)은 빠진다 ' + JSON.stringify(pl.map((r) => [r.t0, r.t1])));
  ok(pl[1].fx.fog === 1 && pl[1].fx.flicker === 1 && pl[2].fx.fog === 2, '강도 덮어쓰기가 구간에 반영된다');
  ok(FXO.planOf({ sentences: sents, groups }, {}).length === 0, '채널이 전부 꺼져 있으면 빈 구간표(아무것도 안 한다)');
  const same = FXO.planOf({ sentences: sents, groups: [{ sentenceIds: ['s1'] }, { sentenceIds: ['s2'] }] }, { dust: 1 });
  ok(same.length === 1 && same[0].t1 === 20, '이웃한 같은 값은 한 구간으로 합친다');
  ok(FXO.fxAt(pl, 35).fog === 1 && FXO.fxAt(pl, 25) === null && FXO.fxAt(pl, 0).fog === 2, 'fxAt: 시각 → 값(꺼진 곳은 null)');
}

console.log('\n[3] 질감 — 결정적 · 올바른 PNG · 이음새 없음');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxt-'));
  try {
    const a = path.join(tmp, 'a'), b = path.join(tmp, 'b'); fs.mkdirSync(a); fs.mkdirSync(b);
    const t1 = await FXO.prepareTextures(null, a, { fog: 1, dust: 1, firefly: 1 }), t2 = await FXO.prepareTextures(null, b, { fog: 1, dust: 1, firefly: 1 });
    ok(['fog', 'dust', 'firefly'].every((k) => fs.readFileSync(path.join(a, t1[k])).equals(fs.readFileSync(path.join(b, t2[k])))), '같은 설정이면 늘 같은 질감(결정적)');
    ok(Object.keys(await FXO.prepareTextures(null, a, { dust: 1 })).join() === 'dust', '켠 종류만 만든다');
    const dim = (f) => { try { execFileSync(FF, ['-hide_banner', '-i', f], { stdio: 'pipe' }); } catch (e) { const m = /(\d{3,5})x(\d{3,5})/.exec(String(e.stderr)); return m ? [+m[1], +m[2]] : null; } };
    ok(JSON.stringify(dim(path.join(a, 'fx_fog.png'))) === '[3840,1080]' && JSON.stringify(dim(path.join(a, 'fx_dust.png'))) === '[3840,2160]', 'ffmpeg 이 읽는다 — 안개 3840x1080 · 점 3840x2160');
    // 이음새: 같은 타일 두 장이라 왼쪽 반 == 오른쪽 반, 그리고 왼쪽 끝과 오른쪽 끝(한 장 안)이 이어진다(안개 가로 wrap)
    const gray = (f, vf) => execFileSync(FF, ['-loglevel', 'error', '-i', f, '-vf', vf + ',format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
    const L = gray(path.join(a, 'fx_fog.png'), 'crop=1920:1080:0:0'), Rr = gray(path.join(a, 'fx_fog.png'), 'crop=1920:1080:1920:0');
    ok(L.equals(Rr), '안개 질감 = 같은 타일 두 번(crop 으로 흘려 보내도 끊기지 않는다)');
    let seam = 0, inner = 0; for (let y = 0; y < 1080; y += 9) { seam += Math.abs(L[y * 1920] - L[y * 1920 + 1919]); inner += Math.abs(L[y * 1920 + 960] - L[y * 1920 + 961]); }
    ok(seam / 120 < inner / 120 + 4, `가로 이음새 단차 ${(seam / 120).toFixed(2)} (안쪽 이웃 단차 ${(inner / 120).toFixed(2)} 수준)`);
    // 점 질감 이음새 — 2x2 타일: (0,0)==(1920,0)==(0,1080)
    const D0 = gray(path.join(a, 'fx_dust.png'), 'crop=1920:1080:0:0'), D1 = gray(path.join(a, 'fx_dust.png'), 'crop=1920:1080:1920:1080');
    ok(D0.equals(D1), '점 질감 = 2x2 같은 타일(위로 흘려도 끊기지 않는다)');
    let nz = 0; for (const v of D0) if (v > 30) nz++;
    ok(nz > 1000 && nz < 80000, `점이 성기다(밝은 화소 ${nz}개 / 207만 — 별밭처럼 빽빽하지 않다)`);

    console.log('\n[4] 실제 MP4 — 켜진 그룹에만 · 꺼진 그룹은 그대로 · 조각 이음새에서 안 끊긴다 · 길이 불변');
    const img = path.join(tmp, 'g.png');   // 어둡고 결이 있는 그림
    execFileSync(FF, ['-y', '-loglevel', 'error', '-filter_complex', "nullsrc=s=1920x1080,format=gray,geq=lum='random(5)*255',gblur=sigma=2.4,eq=contrast=1.7:brightness=-0.2[n];color=c=0x1c2230:s=1920x1080,format=gray[v];[n][v]blend=all_expr='A*0.2+B*0.9',format=yuv420p[o]", '-map', '[o]', '-frames:v', '1', img]);
    const r = P.parseScriptText('# t\n## 장\n### ① 첫\n첫째 문장입니다. 둘째 문장입니다.\n### ② 둘\n셋째 문장입니다. 넷째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0];
    pr.groups[0].imagePath = img; pr.groups[1].imagePath = img;
    pr.sentences.forEach((s, i) => { const mp3 = path.join(tmp, `s${i}.mp3`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '5', '-c:a', 'libmp3lame', mp3]); s.ttsAudioPath = mp3; s.ttsDurationSec = 5; });
    const vrew = path.join(tmp, 'a.vrew');
    await P.buildProjectVrew(pr, vrew, {}, () => {}, 20, 1);
    const ranges = FXO.planOf(pr, { fog: 3, dust: 3, firefly: 3, flicker: 3 });
    ok(ranges.length === 1 && ranges[0].t0 === 0 && ranges[0].t1 === 20, '대본 → 구간표(두 그룹이 같은 값이라 0~20 한 구간으로 합쳐진다)');
    pr.groups[1].look = { fx: 'off' };
    const only1 = FXO.planOf(pr, { fog: 3, dust: 3, firefly: 3, flicker: 3 });
    ok(only1.length === 1 && only1[0].t1 === 10, '둘째 그룹을 끄면 첫 그룹 구간만');
    const bake = async (name, o) => { const mp4 = path.join(tmp, name + '.mp4'); const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 2, chunkSec: 4, ...o }); if (!res || !res.ok) throw new Error('렌더 실패 ' + (res && res.error)); return mp4; };
    const base = await bake('base', {}), fx = await bake('fx', { fx: { ranges: only1 } }), none = await bake('none', { fx: { ranges: [] } });
    const raw = (f, t, vf = 'scale=192:108') => execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', vf + ',format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
    const mean = (b) => { let s = 0; for (const v of b) s += v; return s / b.length; };
    const dif = (a, b) => { let x = 0; for (let i = 0; i < a.length; i++) x += Math.abs(a[i] - b[i]); return x / a.length; };
    const dur = (f) => { try { execFileSync(FF, ['-hide_banner', '-i', f], { stdio: 'pipe' }); } catch (e) { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(e.stderr)); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0; } return 0; };
    ok(Math.abs(dur(base) - dur(fx)) < 0.08 && Math.abs(dur(base) - 20) < 0.1, `영상 길이 그대로(기본 ${dur(base).toFixed(2)} · 효과 ${dur(fx).toFixed(2)}초)`);
    ok(dif(raw(base, 3), raw(none, 3)) < 0.01 && dif(raw(base, 14), raw(none, 14)) < 0.01, '구간표가 비면 예전 결과와 같다(화소 차 0)');
    ok(dif(raw(base, 15), raw(fx, 15)) < 0.3, `🔑 꺼진 그룹(둘째 · 15초)은 효과 없이 그대로(화소 차 ${dif(raw(base, 15), raw(fx, 15)).toFixed(3)})`);
    const d3 = dif(raw(base, 3), raw(fx, 3));
    ok(d3 > 1.0, `켜진 그룹(첫째 · 3초)은 달라졌다(화소 차 ${d3.toFixed(2)})`);
    ok(mean(raw(fx, 3)) > mean(raw(base, 3)) && mean(raw(fx, 3)) - mean(raw(base, 3)) < 25, `밝기는 약하게만 올랐다(+${(mean(raw(fx, 3)) - mean(raw(base, 3))).toFixed(1)} / 255)`);
    // 조각 이음새(4초마다) — 이웃 프레임 차이가 평소 수준
    const seqOf = (f, t0) => { const o = []; let prev = raw(f, t0, 'scale=192:108'); for (let k = 1; k <= 6; k++) { const c = raw(f, t0 + k * 0.04); o.push(dif(prev, c)); prev = c; } return o; };
    const s4 = seqOf(fx, 3.88), s0 = seqOf(fx, 1.9), b4 = seqOf(base, 3.88);   // 4초 경계 앞뒤 vs 조각 안쪽 vs 효과 없는 같은 경계
    console.log('   경계(4초)', s4.map((x) => x.toFixed(2)).join(' '), '| 안쪽', s0.map((x) => x.toFixed(2)).join(' '), '| 효과 없는 경계', b4.map((x) => x.toFixed(2)).join(' '));
    ok(Math.max(...s4) < Math.max(2.0, Math.max(...b4) + 1.5), `조각 이음새(4초)에서 안개·점이 튀지 않는다(경계 최대 ${Math.max(...s4).toFixed(2)} — 효과 없는 같은 경계 ${Math.max(...b4).toFixed(2)}에 더해 +1.5 이내 · 위치가 어긋나면 수 배)`);
    // 디졸브와 함께
    const both = await bake('both', { fx: { ranges: FXO.planOf(Object.assign({}, pr, { groups: pr.groups.map((g) => ({ ...g, look: undefined })) }), { fog: 2, dust: 1 }) }, dissolveSec: 4 });
    ok(Math.abs(dur(both) - 20) < 0.1, `디졸브 + 오버레이를 함께 켜도 렌더되고 길이가 같다(${dur(both).toFixed(2)}초)`);
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} fx ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 오류:', e); process.exit(1); });
