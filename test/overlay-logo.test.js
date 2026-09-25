// 🏷 채널 로고 · 🔝 위층 그림·영상 (v0.5.52) — core/overlay-layers 단위 + 실제 왕복(.vrew → MP4 화소)
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const OL = require('../core/overlay-layers');
const FF = require('../core/media-utils').getFfmpegPath();
const pr0 = () => P.parseScriptText('# t\n## 장\n### 하나\n첫째 문장입니다.\n### 둘\n둘째 문장입니다.\n', 'longform', {}).projects[0];

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ovlogo-'));
  try {
    console.log('[1] 로고 자리');
    const r1 = OL.logoBox({ side: 'right', size: 0.12, imgRatio: 2, canvasW: 1920, canvasH: 1080 });
    ok(Math.abs(r1.x + r1.w - 0.975) < 1e-9 && Math.abs(r1.w - 0.12) < 1e-9, '오른쪽 위 — 오른쪽 여백 2.5%');
    ok(Math.abs(r1.h - (0.12 * 1920 / 2 / 1080)) < 1e-9, '높이 = 그림 비율대로(정사각형 가정 없음)');
    ok(Math.abs(r1.y * 1080 - 0.025 * 1920) < 1e-6, '위 여백 = 가로 여백과 같은 픽셀');
    const l1 = OL.logoBox({ side: 'left', size: 0.12, imgRatio: 1 });
    ok(Math.abs(l1.x - 0.025) < 1e-9, '왼쪽 위');
    ok(!OL.logoOptsOf({ logoOn: false, logoPath: 'x.png' }).enabled && !OL.logoOptsOf({ logoOn: true }).enabled, '꺼져 있거나 파일이 없으면 끔');
    const lo = OL.logoOptsOf({ logoOn: true, logoPath: 'x.png', logoSide: 'left', logoSize: 99 });
    ok(lo.enabled && lo.side === 'right' && lo.size === 0.4, '크기 상한 40% · 채널 로고 자리 기본 = 오른쪽 위(자리는 대본마다)');
    ok(OL.idsFromOrds(pr0(), 2, 99).endId && OL.kindOf('x.MP3') === 'audio' && OL.normVol('') === 30 && OL.normVol(0) === 0, '클립 번호 범위 · 오디오 종류 · 음량 기본 30%');
    ok(OL.logoOptsOf({ logoOn: true, logoPath: 'x.png' }, () => false).missing === 'x.png', '파일이 사라졌으면 알린다');

    console.log('\n[2] 범위 — 그룹으로 고르고 문장 id 로 저장');
    const r = P.parseScriptText('# t\n## 장\n### 하나\n첫째 문장입니다.\n### 둘\n둘째 문장입니다.\n### 셋\n셋째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0];
    const ids = OL.idsFromGroups(pr, 2, 3);
    ok(ids && ids.startId === pr.groups[1].sentenceIds[0] && ids.endId === pr.groups[2].sentenceIds[0], 'G2~G3 → 둘째·셋째 문장');
    pr.overlays = [{ id: 'o1', file: path.join(tmp, 'blue.png'), kind: 'image', ...ids, box: { x: 0.35, y: 0.35, w: 0.3, h: 0.3 } }];
    const by = OL.bySentence(pr);
    ok(!by.has(pr.sentences[0].id) && by.get(pr.sentences[1].id)[0] === 0 && by.get(pr.sentences[2].id)[0] === 0, '문장마다 덮는 위층');
    const dto = OL.toDTO(pr)[0];
    ok(dto.fromGroup === 2 && dto.toGroup === 3 && dto.from === 2 && dto.to === 3, `DTO 그룹 G${dto.fromGroup}~G${dto.toGroup}`);
    const snap = OL.toSnap(pr);
    const pr2 = P.parseScriptText('# t\n## 장\n### 하나\n첫째 문장입니다.\n### 둘\n둘째 문장입니다.\n### 셋\n셋째 문장입니다.\n', 'longform', {}).projects[0];
    OL.fromSnap(pr2, snap);
    ok(pr2.overlays && OL.toDTO(pr2)[0].fromGroup === 2 && OL.toDTO(pr2)[0].box.w === 0.3, '작업본 저장 → 다시 열기(순번으로)');
    OL.remapIds(pr, new Map([[ids.startId, 'NEW']]));
    ok(pr.overlays[0].startId === 'NEW', '문장 id 가 바뀌면 따라간다');
    pr.overlays[0].startId = ids.startId;
    ok(OL.kindOf('a.MP4') === 'video' && OL.kindOf('a.webp') === 'image' && OL.kindOf('a.txt') === null, '파일 종류');

    console.log('\n[3] 실제 왕복 — 빨강 그림 3그룹 · 🔝 파랑(G2~G3 가운데 30%) · 🏷 초록 동그라미 로고(투명 PNG · 오른쪽 위)');
    const img = (n, c) => { const f = path.join(tmp, n + '.png'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=1920x1080`, '-frames:v', '1', f]); return f; };
    for (const g of pr.groups) g.imagePath = img('g' + g.num, 'red');
    img('blue', 'blue');
    const logo = path.join(tmp, 'logo.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=200x200,format=rgba', '-vf', "geq=r=0:g=255:b=0:a='if(lt((X-100)*(X-100)+(Y-100)*(Y-100),8100),255,0)'", '-frames:v', '1', logo]);
    P.fillSilent(pr, path.join(tmp, 'tts'));
    const vrew = path.join(tmp, 'x.vrew');
    await P.buildProjectVrew(pr, vrew, { captionStyle: { size: '60', align: 'center', yAlign: 'bottom', yOffset: -0.125 }, logo: OL.logoOptsOf({ logoOn: true, logoPath: logo, logoSide: 'right', logoSize: 12 }) }, () => {}, 20, 1);
    const pj = JSON.parse(new AdmZip(vrew).readAsText('project.json'));
    const T = Object.values(pj.props.tracks), A = pj.props.assets;
    const aidOf = (tr) => Object.keys(A).find((k) => A[k].trackIds.includes(tr.trackId));
    const lg = T.find((t) => t.zIndex === 2000), ov = T.find((t) => t.zIndex === 900);
    ok(lg && lg.type === 'image' && Math.abs(lg.originalWidthHeightRatio - 1) < 1e-6, '🏷 로고 트랙 = 맨 위층(2000)');
    ok(ov && ov.type === 'image' && Math.abs(ov.width - 0.3) < 1e-9, '🔝 위층 트랙(900) · 옮긴 자리');
    const clips = pj.transcript.clips;
    ok(clips.every((c) => c.assetIds.includes(aidOf(lg))), '로고는 모든 클립');
    ok(!clips[0].assetIds.includes(aidOf(ov)) && clips.slice(1).every((c) => c.assetIds.includes(aidOf(ov))), '위층은 G2~G3 클립에만');
    const groupZ = T.filter((t) => t.type === 'image' && t.zIndex < 900).map((t) => t.zIndex);
    ok(groupZ.length === 3 && Math.max(...groupZ) < 900, '그룹 그림은 모두 위층 아래');

    const mp4 = path.join(tmp, 'x.mp4');
    const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
    ok(res && res.ok, '렌더 성공');
    const s0 = pr.sentences[0].ttsDurationSec, s1 = pr.sentences[1].ttsDurationSec;
    const fr = (t) => execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=192:108', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const px = (raw, x, y) => { const i = (y * 192 + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
    const isR = (p) => p[0] > 150 && p[1] < 90 && p[2] < 90, isB = (p) => p[2] > 150 && p[0] < 90, isG = (p) => p[1] > 150 && p[0] < 90 && p[2] < 90;
    const lb = OL.logoBox({ side: 'right', size: 0.12, imgRatio: 1 });
    const lcx = Math.round((lb.x + lb.w / 2) * 192), lcy = Math.round((lb.y + lb.h / 2) * 108);
    const lcorner = [Math.round((lb.x + 0.004) * 192), Math.round((lb.y + 0.006) * 108)];
    const fA = fr(s0 / 2), fB = fr(s0 + s1 / 2);
    console.log('   화소', JSON.stringify({ A_mid: px(fA, 96, 54), A_logo: px(fA, lcx, lcy), A_logoCorner: px(fA, ...lcorner), B_mid: px(fB, 96, 54), B_edge: px(fB, 10, 60), B_logo: px(fB, lcx, lcy) }));
    ok(isR(px(fA, 96, 54)) && isG(px(fA, lcx, lcy)), 'G1: 빨강 + 🏷 오른쪽 위 초록 로고');
    ok(isR(px(fA, ...lcorner)), '🔑 로고 모서리는 투명 — 아래 빨강이 보인다(검은 네모가 아니다)');
    ok(isB(px(fB, 96, 54)) && isR(px(fB, 10, 60)), '🔑 G2: 가운데 🔝 파랑 · 가장자리는 그룹 그림 빨강');
    ok(isG(px(fB, lcx, lcy)), 'G2 에도 로고');

    console.log('\n[4] 🎵 오디오 삽입(클립 2~3 · 음량 100%) · 🏷 이 대본 로고 = 왼쪽 위');
    const tone = path.join(tmp, 'tone.wav');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=1', '-ac', '2', tone]);
    pr.overlays = [{ id: 'a1', file: tone, kind: 'audio', volume: 100, ...OL.idsFromOrds(pr, 2, 3) }];
    pr.logoSide = 'left';
    const vrew2 = path.join(tmp, 'y.vrew');
    await P.buildProjectVrew(pr, vrew2, { captionStyle: { size: '60', align: 'center', yAlign: 'bottom', yOffset: -0.125 }, logo: OL.logoOptsOf({ logoOn: true, logoPath: logo, logoSize: 12 }) }, () => {}, 20, 1);
    const pj2 = JSON.parse(new AdmZip(vrew2).readAsText('project.json'));
    const T2 = Object.values(pj2.props.tracks), A2 = pj2.props.assets;
    const au = T2.find((t) => t.type === 'bgm');
    const auAid = au && Object.keys(A2).find((k) => A2[k].trackIds.includes(au.trackId));
    ok(au && Math.abs(au.volume - 1) < 1e-9 && au.loop === true, '오디오 = 배경음 트랙(type bgm · 음량 100% · 반복)');
    ok(!pj2.transcript.clips[0].assetIds.includes(auAid) && pj2.transcript.clips.slice(1).every((c) => c.assetIds.includes(auAid)), '🔑 오디오는 클립 2~3 에만 걸린다');
    const lg2 = T2.find((t) => t.zIndex === 2000);
    ok(lg2 && Math.abs(lg2.xPos - 0.025) < 1e-9, '🏷 이 대본 로고 = 왼쪽 위');
    const mp42 = path.join(tmp, 'y.mp4');
    const res2 = await R.renderVrewToMp4({ vrewPath: vrew2, outPath: mp42, log: () => {}, par: 1 });
    ok(res2 && res2.ok, '렌더 성공');
    const volOf = (a, b) => { let err = ''; try { const r = require('child_process').spawnSync(FF, ['-hide_banner', '-ss', String(a), '-t', String(b - a), '-i', mp42, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }); err = r.stderr || ''; } catch (_) {} const m = err.match(/mean_volume:\s*(-?[\d.]+|-inf) dB/); return m ? (m[1] === '-inf' ? -200 : +m[1]) : -200; };
    const q0 = volOf(0.1, s0 - 0.2), q1 = volOf(s0 + 0.6, s0 + s1 - 0.2);
    console.log('   음량 dB', { G1: q0, G2: q1 });
    ok(q0 < -60, `G1(오디오 범위 밖) = 조용 (${q0}dB)`);
    ok(q1 > -35, `🔑 G2(범위 안) = 소리가 난다 (${q1}dB)`);
    const fr2 = (t) => execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', mp42, '-frames:v', '1', '-vf', 'scale=192:108', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const lL = OL.logoBox({ side: 'left', size: 0.12, imgRatio: 1 });
    ok(isG(px(fr2(s0 / 2), Math.round((lL.x + lL.w / 2) * 192), Math.round((lL.y + lL.h / 2) * 108))), 'MP4 에도 로고가 왼쪽 위');

    console.log('\n[5] 🔊 삽입 영상의 소리(클립 2~3 · 100%) · 소리 없는 영상도 렌더가 안 깨진다');
    const vs = path.join(tmp, 'vs.mp4'), vn = path.join(tmp, 'vn.mp4');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=1', '-f', 'lavfi', '-i', 'sine=f=660:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vs]);
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=640x360:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', vn]);
    pr.overlays = [
      { id: 'v1', file: vs, kind: 'video', ...OL.idsFromOrds(pr, 2, 3), box: { x: 0.6, y: 0.6, w: 0.3, h: 0.3 } },
      { id: 'v2', file: vn, kind: 'video', ...OL.idsFromOrds(pr, 1, 3), box: { x: 0.05, y: 0.6, w: 0.2, h: 0.2 } },
    ];
    delete pr.logoSide;
    const vrew3 = path.join(tmp, 'z.vrew');
    await P.buildProjectVrew(pr, vrew3, { captionStyle: { size: '60', align: 'center', yAlign: 'bottom', yOffset: -0.125 } }, () => {}, 20, 1);
    const pj3 = JSON.parse(new AdmZip(vrew3).readAsText('project.json'));
    const va = Object.values(pj3.props.tracks).filter((t) => t.type === 'videoAudio');
    ok(va.length === 2 && va.every((t) => Math.abs(t.volume - 1) < 1e-9), '삽입 영상 소리 트랙 = 음량 100%(기본)');
    const mp43 = path.join(tmp, 'z.mp4');
    const res3 = await R.renderVrewToMp4({ vrewPath: vrew3, outPath: mp43, log: () => {}, par: 1 });
    ok(res3 && res3.ok, `🔑 소리 없는 영상이 섞여 있어도 렌더 성공${res3 && res3.error ? ' — ' + res3.error : ''}`);
    const vol3 = (a, b) => { const r = require('child_process').spawnSync(FF, ['-hide_banner', '-ss', String(a), '-t', String(b - a), '-i', mp43, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }); const m = (r.stderr || '').match(/mean_volume:\s*(-?[\d.]+) dB/); return m ? +m[1] : -200; };
    const z0 = vol3(0.1, s0 - 0.2), z1 = vol3(s0 + 0.2, s0 + 0.9);
    console.log('   음량 dB', { G1: z0, G2: z1 });
    ok(z0 < -60, `G1: 영상 소리 없음 (${z0}dB)`);
    ok(z1 > -35, `🔑 G2: 삽입 영상의 소리가 난다 (${z1}dB)`);
  } catch (e) { ok(false, '왕복 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} overlay-logo ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
