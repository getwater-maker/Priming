// ➕ 삽입 범위를 클립(자막 줄) 단위로 (v0.5.65) — core/visual-span.clipIn · overlay-layers sc/ec · 실제 왕복(.vrew 클립 · MP4 화소)
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const OL = require('../core/overlay-layers');
const VS = require('../core/visual-span');
const CS = require('../core/caption-splitter');
const CF = require('../core/caption-format');
const FF = require('../core/media-utils').getFfmpegPath();

// 첫 문장은 자막 두 줄이 되게 길게 · 둘째 문장도 두 줄
const S1 = '오늘은 아주 오래된 마을 이야기를 들려드리겠습니다.';
const S2 = '그 마을에는 늙은 느티나무 한 그루가 서 있었습니다.';
const S3 = '셋째 문장입니다.';
const TXT = `# t\n## 장\n### 하나\n${S1}\n### 둘\n${S2}\n### 셋\n${S3}\n`;
const MAXC = 12;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ovclip-'));
  try {
    console.log('[1] clipIn — 문장 a~b + 첫 문장 글자 sc · 끝 문장 글자 ec');
    ok(VS.clipIn(1, 0, 3, null, 2, 0, 5), '가운데 문장은 늘 안');
    ok(!VS.clipIn(1, 0, 3, null, 4, 0, 5) && !VS.clipIn(2, 0, 3, null, 1, 0, 5), '범위 밖 문장');
    ok(!VS.clipIn(1, 10, 3, null, 1, 0, 10) && VS.clipIn(1, 10, 3, null, 1, 10, 20), '첫 문장 — sc 앞에서 끝나는 줄은 밖 · sc 가 든 줄부터');
    ok(VS.clipIn(1, 10, 3, null, 1, 5, 12), '첫 문장 — sc 가 줄 한가운데여도 그 줄은 안');
    ok(VS.clipIn(1, 0, 3, 8, 3, 8, 15) && !VS.clipIn(1, 0, 3, 8, 3, 9, 15), '끝 문장 — ec 가 든 줄까지');
    ok(VS.clipIn(1, 0, 3, null, 3, 20, 30), 'ec 없음 = 끝 문장 끝까지');
    ok(VS.clipIn(2, 10, 2, 10, 2, 10, 20) && !VS.clipIn(2, 10, 2, 10, 2, 0, 10) && !VS.clipIn(2, 10, 2, 10, 2, 20, 30), '한 문장 안 한 줄만');

    console.log('\n[2] 저장 — idsFromOrds · DTO · 작업본 · 문장이 바뀌면 문장 통째로');
    const pr = P.parseScriptText(TXT, 'longform', {}).projects[0];
    const L1 = CS.splitCaptionLines(S1, MAXC), L2 = CS.splitCaptionLines(S2, MAXC);
    const R1 = CF.lineRanges(S1, L1), R2 = CF.lineRanges(S2, L2);
    ok(L1.length >= 2 && L2.length >= 2, `두 문장 모두 자막 두 줄 이상(${L1.length}·${L2.length})`);
    const ids = OL.idsFromOrds(pr, 1, 2, R1[1].from, R2[0].from);
    ok(ids.sc === R1[1].from && ids.ec === 0, `sc = 둘째 줄 첫 글자(${ids.sc}) · ec = 0`);
    const ids0 = OL.idsFromOrds(pr, 1, 3, 0, null);
    ok(ids0.sc == null && ids0.ec == null, '처음부터·끝까지는 글자 위치를 저장하지 않는다(옛 형식과 같다)');
    const idsR = OL.idsFromOrds(pr, 2, 1, 5, 7);
    ok(idsR.sc == null && idsR.ec == null, '거꾸로 받은 범위는 글자 위치를 버린다(엉뚱한 줄 방지)');
    const ov = { id: 'o1', file: path.join(tmp, 'blue.png'), kind: 'image', box: null };
    OL.applyIds(ov, ids); pr.overlays = [ov];
    const d = OL.toDTO(pr)[0];
    ok(d.from === 1 && d.to === 2 && d.sc === R1[1].from && d.ec === 0, 'DTO 에 sc·ec');
    const snap = OL.toSnap(pr);
    const pr2 = P.parseScriptText(TXT, 'longform', {}).projects[0];
    OL.fromSnap(pr2, snap);
    ok(pr2.overlays[0].sc === ids.sc && pr2.overlays[0].ec === 0, '작업본 왕복 — sc·ec 유지');
    const r = OL.rangeOf(pr, ov);
    ok(!OL.coversLine(ov, r, 0, R1[0].from, R1[0].to) && OL.coversLine(ov, r, 0, R1[1].from, R1[1].to), 'coversLine — 첫 문장 첫 줄 밖 · 둘째 줄 안');
    ok(OL.coversLine(ov, r, 1, R2[0].from, R2[0].to) && !OL.coversLine(ov, r, 1, R2[1].from, R2[1].to), 'coversLine — 둘째 문장 첫 줄 안 · 둘째 줄 밖');
    const pr3 = P.parseScriptText(TXT, 'longform', {}).projects[0];
    const ov3 = { ...ov }; OL.applyIds(ov3, OL.idsFromOrds(pr3, 1, 2, R1[1].from, 0)); pr3.overlays = [ov3];
    OL.remapIds(pr3, new Map([[ov3.startId, 'NEW1']]));
    ok(ov3.startId === 'NEW1' && ov3.sc == null && ov3.ec === 0, '시작 문장을 고치면 시작만 문장 통째로(끝은 그대로)');
    OL.applyIds(ov3, { startId: 'a', endId: 'b' });
    ok(!('sc' in ov3) && !('ec' in ov3), 'applyIds — 글자 위치가 없으면 지운다');

    console.log('\n[3] 실제 왕복 — 빨강 그룹 그림 3 · ➕ 파랑(문장1 둘째 줄 ~ 문장2 첫 줄)');
    const img = (n, c) => { const f = path.join(tmp, n + '.png'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=1920x1080`, '-frames:v', '1', f]); return f; };
    for (const g of pr.groups) g.imagePath = img('g' + g.num, 'red');
    img('blue', 'blue');
    P.fillSilent(pr, path.join(tmp, 'tts'));
    const vrew = path.join(tmp, 'x.vrew');
    await P.buildProjectVrew(pr, vrew, { captionStyle: { size: '60', align: 'center', yAlign: 'bottom', yOffset: -0.125 } }, () => {}, MAXC, 1);
    const pj = JSON.parse(new AdmZip(vrew).readAsText('project.json'));
    const T = Object.values(pj.props.tracks), A = pj.props.assets;
    const ovT = T.find((t) => t.zIndex === 900);
    const oa = ovT && Object.keys(A).find((k) => A[k].trackIds.includes(ovT.trackId));
    const clips = pj.transcript.clips;
    const has = clips.map((c) => c.assetIds.includes(oa));
    const n1 = L1.length, n2 = L2.length;
    ok(clips.length === n1 + n2 + CS.splitCaptionLines(S3, MAXC).length, `클립 수 = 줄 수(${clips.length})`);
    const want = [...L1.map((_, i) => i >= 1), ...L2.map((_, i) => i === 0), ...CS.splitCaptionLines(S3, MAXC).map(() => false)];
    ok(JSON.stringify(has) === JSON.stringify(want), `삽입은 그 클립에만 — ${has.map((x) => (x ? '■' : '□')).join('')}`);
    ok(clips.every((c) => c.assetIds.length >= 1 + (0)), '모든 클립에 그룹 그림은 그대로');

    const mp4 = path.join(tmp, 'x.mp4');
    const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
    ok(res && res.ok, '렌더 성공');
    const durOf = (c) => c.words.reduce((a, w) => a + (w.duration || 0), 0);
    const starts = []; let t = 0; for (const c of clips) { starts.push(t); t += durOf(c); }
    const fr = (tt) => execFileSync(FF, ['-loglevel', 'error', '-ss', String(tt), '-i', mp4, '-frames:v', '1', '-vf', 'scale=192:108', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const px = (raw) => { const i = (30 * 192 + 96) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
    const isR = (p) => p[0] > 150 && p[1] < 90 && p[2] < 90, isB = (p) => p[2] > 150 && p[0] < 90;
    const mid = (i) => starts[i] + durOf(clips[i]) / 2;
    const p0 = px(fr(mid(0))), p1 = px(fr(mid(n1))), p2 = px(fr(mid(n1 + n2 - 1)));
    const pb = px(fr(mid(1)));
    console.log('   화소', JSON.stringify({ s1l1: p0, s1l2: pb, s2l1: p1, s2last: p2 }));
    ok(isR(p0), 'MP4 — 문장1 첫 줄 = 빨강(삽입 전)');
    ok(isB(pb), 'MP4 — 문장1 둘째 줄 = 파랑(삽입 시작)');
    ok(isB(p1), 'MP4 — 문장2 첫 줄 = 파랑');
    ok(isR(p2), 'MP4 — 문장2 마지막 줄 = 빨강(삽입 끝난 뒤)');
  } catch (e) { fail++; console.log('  ✗ 예외: ' + (e.stack || e.message)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
  console.log(`\n${fail ? '❌' : '✅'} overlay-clip ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
