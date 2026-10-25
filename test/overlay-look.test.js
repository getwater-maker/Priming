// ➕ 삽입 그림·영상 「모양」(v0.9.104 · 세로 도구 막대) — core/visual-look(채우기·자르기·불투명도 계산) · overlay-layers(DTO·작업본) · .vrew editInfo · MP4 화소
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const OL = require('../core/overlay-layers');
const VL = require('../core/visual-look');
const FF = require('../core/media-utils').getFfmpegPath();

const TXT = '# t\n## 장\n### 하나\n오늘은 아주 오래된 마을 이야기를 들려드리겠습니다.\n### 둘\n그 마을에는 늙은 느티나무가 서 있었습니다.\n';
const near = (a, b, t = 0.001) => Math.abs(a - b) < t;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ovlook-'));
  try {
    console.log('[1] 계산 — 자르기 · 채우기 · 불투명도');
    ok(VL.normCrop({ t: 0, r: 0, b: 0, l: 0 }) === null, '자르기 0 = 없음');
    ok(VL.normCrop({ l: 0.6, r: 0.5 }) === null, '합이 90% 를 넘으면 버린다(전부 잘리는 것 방지)');
    ok(VL.cropInset({ t: 0.1, r: 0, b: 0.2, l: 0.25 }) === 'inset(10% 0% 20% 25%)', 'Vrew 형식 inset(위 오른쪽 아래 왼쪽)');
    const pc = VL.parseInset('inset(10% 0% 20% 25%)');
    ok(pc && near(pc.t, 0.1) && near(pc.b, 0.2) && near(pc.l, 0.25) && pc.r === 0, 'inset 문자열 왕복');
    ok(VL.parseInset('circle(50%)') === null && VL.parseInset('') === null, '모르는 모양은 자르기 없음');
    const bc = VL.ovBox({}, 1000, 1000, 1920, 1080), bv = VL.ovBox({ fill: 'cover' }, 1000, 1000, 1920, 1080);
    ok(near(bc.h, 1) && near(bc.w, 0.5625), '맞추기 — 정사각은 세로 가득 · 가로 56.25%');
    ok(near(bv.w, 1) && near(bv.h, 1.7778, 0.001) && near(bv.y, -0.3889, 0.001), '꽉 채우기 — 가로 가득 · 세로 넘침(가운데 맞춤)');
    const bk = VL.ovBox({ crop: { t: 0, r: 0, b: 0, l: 0.5 }, fill: 'cover' }, 1000, 1000, 1920, 1080);
    ok(near(bk.w, 1) && near(bk.h, 3.5556, 0.001), '잘린 뒤 비율(500×1000)로 꽉 채운다');
    ok(VL.normOpacity(undefined) === 100 && VL.normOpacity(0) === 0 && VL.normOpacity(150) === 100 && VL.normOpacity(55.4) === 55, '불투명도 기본 100 · 범위 0~100');
    ok(VL.normOvMotion('in') === 'in' && VL.normOvMotion('auto') === '' && VL.normOvMotion('x') === '', '삽입 움직임은 줌·팬 6종만(auto 없음)');

    console.log('\n[2] 저장 — DTO · 작업본 · 복제 · 기본값이면 필드 없음');
    const pr = P.parseScriptText(TXT, 'longform', {}).projects[0];
    const ov = { id: 'o1', file: path.join(tmp, 'a.png'), kind: 'image', box: null };
    OL.applyIds(ov, OL.idsFromOrds(pr, 1, 2)); pr.overlays = [ov];
    const base = OL.toSnap(pr)[0];
    ok(!('fill' in base) && !('opacity' in base) && !('crop' in base) && !('flipH' in base) && !('motion' in base), '기본값 삽입은 새 필드가 없다(옛 작업본과 같다)');
    Object.assign(ov, { fill: 'cover', flipH: true, motion: 'lr', opacity: 40, crop: { t: 0, r: 0, b: 0, l: 0.5 }, dim: { w: 1000, h: 500 } });
    const d = OL.toDTO(pr)[0];
    ok(d.fill === 'cover' && d.flipH && d.motion === 'lr' && d.opacity === 40 && d.crop.l === 0.5 && d.dim.w === 1000, 'DTO 에 모양');
    const pr2 = P.parseScriptText(TXT, 'longform', {}).projects[0];
    OL.fromSnap(pr2, OL.toSnap(pr));
    const o2 = pr2.overlays[0];
    ok(o2.fill === 'cover' && o2.flipH && o2.motion === 'lr' && o2.opacity === 40 && o2.crop.l === 0.5 && o2.dim.h === 500, '작업본 왕복');
    const cl = OL.cloneOv(ov); cl.crop.l = 0.9; cl.dim.w = 1;
    ok(ov.crop.l === 0.5 && ov.dim.w === 1000, '되돌리기 복제는 안쪽 객체까지 새로(원본이 안 바뀐다)');

    console.log('\n[3] 실제 왕복 — 빨강 그룹 그림 위에 ➕ 초록|파랑(2:1) 그림');
    const mk = (name, args) => { const f = path.join(tmp, name); execFileSync(FF, ['-y', '-loglevel', 'error', ...args, '-frames:v', '1', f]); return f; };
    const red = mk('red.png', ['-f', 'lavfi', '-i', 'color=c=red:s=1920x1080']);
    const gb = mk('gb.png', ['-f', 'lavfi', '-i', 'color=c=0x00ff00:s=1000x500', '-vf', 'drawbox=x=500:y=0:w=500:h=500:color=0x0000ff:t=fill']);   // 왼쪽 초록 · 오른쪽 파랑
    for (const g of pr.groups) g.imagePath = red;
    P.fillSilent(pr, path.join(tmp, 'tts'));
    const MAXC = 12;
    const render = async (tag, patch) => {
      pr.overlays = [{ id: 'o1', file: gb, kind: 'image', box: null, dim: { w: 1000, h: 500 }, ...patch }];
      OL.applyIds(pr.overlays[0], OL.idsFromOrds(pr, 1, 2));
      const vrew = path.join(tmp, tag + '.vrew');
      await P.buildProjectVrew(pr, vrew, { captionStyle: { size: '60', align: 'center', yAlign: 'bottom', yOffset: -0.125 } }, () => {}, MAXC, 1);
      const pj = JSON.parse(new AdmZip(vrew).readAsText('project.json'));
      const tr = Object.values(pj.props.tracks).find((t) => t.zIndex === 900);
      const mp4 = path.join(tmp, tag + '.mp4');
      const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
      const px = (xf, yf, tt = 0.3) => { const raw = execFileSync(FF, ['-loglevel', 'error', '-ss', String(tt), '-i', mp4, '-frames:v', '1', '-vf', 'scale=192:108', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); const i = (Math.round(yf * 107) * 192 + Math.round(xf * 191)) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
      return { tr, res, px };
    };
    const isR = (p) => p[0] > 150 && p[1] < 90 && p[2] < 90, isB = (p) => p[2] > 150 && p[0] < 90 && p[1] < 90, isG = (p) => p[1] > 150 && p[0] < 90 && p[2] < 90;

    // 기본 — 맞추기: 2:1 은 가로 가득 · 세로 가운데 띠(위아래는 빨강 그룹 그림)
    const A = await render('base', {});
    ok(A.res && A.res.ok, '기본 렌더 성공');
    ok(isG(A.px(0.2, 0.5)) && isB(A.px(0.8, 0.5)) && isR(A.px(0.5, 0.05)), '기본(맞추기) — 가운데 띠에 초록|파랑 · 위는 빨강');

    // 채우기(cover) — 화면 전체가 초록|파랑 (위아래 빨강이 없다)
    const B = await render('cover', { fill: 'cover' });
    ok(B.res && B.res.ok && isG(B.px(0.2, 0.05)) && isB(B.px(0.8, 0.95)), '채우기 — 빈 곳 없이 화면 전체(위아래도 초록|파랑)');
    const bb = VL.ovBox({ fill: 'cover' }, 1000, 500, 1920, 1080);
    ok(near(B.tr.xPos, bb.x) && near(B.tr.width, bb.w) && near(B.tr.height, bb.h), '.vrew 트랙 박스 = 계산식 그대로');

    // 반전 — 좌우: 초록|파랑 → 파랑|초록
    const C = await render('flip', { flipH: true });
    ok(C.tr.editInfo && C.tr.editInfo.flip && C.tr.editInfo.flip.horizontal === true && C.tr.editInfo.flip.vertical === false, '.vrew editInfo.flip (Vrew 형식)');
    ok(isB(C.px(0.2, 0.5)) && isG(C.px(0.8, 0.5)), 'MP4 — 좌우 반전(파랑|초록)');

    // 불투명도 50% — 빨강 위에 파랑 절반 → 보라
    const D = await render('opac', { fill: 'cover', opacity: 50 });
    ok(D.tr.editInfo && near(D.tr.editInfo.opacity, 0.5), '.vrew editInfo.opacity = 0.5');
    const dp = D.px(0.8, 0.5);
    console.log('   불투명도 화소', JSON.stringify(dp));
    ok(dp[0] > 90 && dp[0] < 170 && dp[2] > 90 && dp[2] < 170 && dp[1] < 60, 'MP4 — 빨강 + 파랑 반반(보라)');
    const dg = D.px(0.2, 0.5);
    ok(dg[0] > 90 && dg[0] < 170 && dg[1] > 90 && dg[1] < 170, 'MP4 — 빨강 + 초록 반반(노랑 계열)');

    // 자르기 — 왼쪽 50% 자르면 파랑만 남는다(1:1 → 맞추기)
    const E = await render('crop', { crop: { t: 0, r: 0, b: 0, l: 0.5 }, fill: 'cover' });
    ok(E.tr.editInfo && E.tr.editInfo.crop === 'inset(0% 0% 0% 50%)', '.vrew editInfo.crop = inset(0% 0% 0% 50%)');
    ok(near(E.tr.originalWidthHeightRatio, 1, 0.001), '.vrew 비율 = 잘린 뒤 비율(500×500 → 1)');
    ok(E.res && E.res.ok && isB(E.px(0.2, 0.5)) && isB(E.px(0.8, 0.5)) && isB(E.px(0.5, 0.05)), 'MP4 — 파랑만 화면 전체(초록은 잘렸다)');

    // 움직임 — 켄번스 필드(그림만) · 렌더 성공
    const F = await render('motion', { fill: 'cover', motion: 'in' });
    ok(F.tr.kenburnsAnimationInfo && F.tr.kenburnsAnimationInfo.from && F.tr.kenburnsAnimationInfo.to, '.vrew kenburnsAnimationInfo(그룹 그림과 같은 형식)');
    ok(F.res && F.res.ok, '움직임 있는 삽입 MP4 렌더 성공');
    const G0 = await render('nomotion', {});
    ok(!G0.tr.kenburnsAnimationInfo && !(G0.tr.editInfo && Object.keys(G0.tr.editInfo).length), '기본 삽입은 .vrew 에 모양 필드가 없다(예전과 같다)');

    // 영상 삽입 — 불투명도 + 자르기(영상 경로) · 반전
    { const vid = path.join(tmp, 'v.mp4');
      execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=1000x500:r=24:d=3', '-vf', 'drawbox=x=500:y=0:w=500:h=500:color=0x0000ff:t=fill', '-pix_fmt', 'yuv420p', vid]);
      pr.overlays = [{ id: 'v1', file: vid, kind: 'video', box: null, dim: { w: 1000, h: 500 }, fill: 'cover', opacity: 50, crop: { t: 0, r: 0, b: 0, l: 0.5 }, volume: 0 }];
      OL.applyIds(pr.overlays[0], OL.idsFromOrds(pr, 1, 2));
      const vv = path.join(tmp, 'vid.vrew');
      await P.buildProjectVrew(pr, vv, { captionStyle: { size: '60', align: 'center', yAlign: 'bottom', yOffset: -0.125 } }, () => {}, MAXC, 1);
      const pjv = JSON.parse(new AdmZip(vv).readAsText('project.json'));
      const tv = Object.values(pjv.props.tracks).find((t) => t.zIndex === 900);
      ok(tv && tv.type === 'video' && tv.editInfo.crop === 'inset(0% 0% 0% 50%)' && near(tv.editInfo.opacity, 0.5), '영상 .vrew — editInfo 에 자르기·불투명도');
      const mp = path.join(tmp, 'vid.mp4');
      const rr = await R.renderVrewToMp4({ vrewPath: vv, outPath: mp, log: () => {}, par: 1 });
      const raw = execFileSync(FF, ['-loglevel', 'error', '-ss', '0.3', '-i', mp, '-frames:v', '1', '-vf', 'scale=192:108', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const q = (x, y) => { const i = (y * 192 + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
      const v1 = q(40, 54), v2 = q(150, 5);
      console.log('   영상 화소', JSON.stringify([v1, v2]));
      ok(rr && rr.ok && v1[0] > 90 && v1[0] < 170 && v1[2] > 90 && v1[2] < 170 && v1[1] < 60 && v2[2] > 90 && v2[2] < 170, '영상 MP4 — 파랑만(초록 잘림) · 빨강과 반반(보라)'); }

    // 순서 — zIndex = 목록 순서
    pr.overlays = [{ id: 'a', file: gb, kind: 'image', box: null }, { id: 'b', file: red, kind: 'image', box: null }];
    OL.applyIds(pr.overlays[0], OL.idsFromOrds(pr, 1, 2)); OL.applyIds(pr.overlays[1], OL.idsFromOrds(pr, 1, 2));
    const vrew2 = path.join(tmp, 'ord.vrew');
    await P.buildProjectVrew(pr, vrew2, { captionStyle: { size: '60', align: 'center', yAlign: 'bottom', yOffset: -0.125 } }, () => {}, MAXC, 1);
    const pj2 = JSON.parse(new AdmZip(vrew2).readAsText('project.json'));
    const zs = Object.values(pj2.props.tracks).filter((t) => t.zIndex >= 900 && t.zIndex < 1000).map((t) => t.zIndex).sort();
    ok(zs.join() === '900,901', '순서 = 목록 순서대로 zIndex 900·901');
  } catch (e) { fail++; console.log('  ✗ 예외: ' + (e.stack || e.message)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
  console.log(`\n${fail ? '❌' : '✅'} overlay-look ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
