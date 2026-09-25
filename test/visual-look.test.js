// 🖼 그림 모양(채우기 · 반전 · 움직임) + 🏷 AI 고지 문장 범위 — core/visual-look → .vrew → 유튜브 MP4 (2026-09-25)
//   node test/visual-look.test.js
//   🔑 끝의 왕복은 **진짜 빌더로 .vrew 를 만들고 진짜 렌더러로 MP4 를 구워 화소를 잰다**(헛단언 방지).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const VL = require('../core/visual-look');

console.log('\n[1] 모양 값');
ok(JSON.stringify(VL.normLook(null)) === JSON.stringify({ fill: 'auto', flipH: false, flipV: false, motion: 'auto' }), '없으면 기본(지금까지의 동작)');
ok(VL.isDefault({}) && !VL.isDefault({ flipH: true }) && !VL.isDefault({ motion: 'none' }), '기본인지 판정(기본이면 그룹에 필드를 두지 않는다)');
ok(VL.normLook({ fill: 'weird', motion: 'spin' }).fill === 'auto' && VL.normLook({ motion: 'spin' }).motion === 'auto', '모르는 값은 기본으로');
ok(/좌우 반전/.test(VL.describe({ flipH: true })) && /맞추기/.test(VL.describe({ fill: 'contain' })), '로그용 설명');
ok(!/require\(/.test(read('core/visual-look.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), '🔑 렌더러 번들에 들어간다 — CJS 런타임 참조 없음');

console.log('\n[2] AI 고지 범위 → 시각');
const mkPr = (durs) => {
  const sentences = durs.map((d, i) => ({ id: 's' + i, ttsDurationSec: d }));
  return { sentences, groups: [{ sentenceIds: ['s0', 's1'] }, { sentenceIds: durs.slice(2).map((_, i) => 's' + (i + 2)) }] };
};
const base = { enabled: true, text: 'AI', startMode: 'seconds', startSeconds: 5, durationSeconds: 5 };
const pr1 = mkPr([2, 3, 4, 5]);
ok(VL.aiNoticeForRange(base, pr1) === base, '범위가 없으면 채널 기본 그대로(5초 뒤 5초)');
pr1.aiNoticeRange = { from: 2, to: 3 };
const r1 = VL.aiNoticeForRange(base, pr1);
ok(r1.startSeconds === 2 && r1.durationSeconds === 7 && r1.startMode === 'seconds', `문장 2~3 → 2초부터 7초 동안 (${r1.startSeconds}·${r1.durationSeconds})`);
pr1.aiNoticeRange = { from: 1, to: 99 };
ok(VL.aiNoticeForRange(base, pr1).durationSeconds === 14, '범위가 넘치면 끝 문장까지');
let warned = ''; const pr2 = mkPr([2, 0, 4]); pr2.aiNoticeRange = { from: 1, to: 3 };
VL.aiNoticeForRange(base, pr2, (m) => { warned = m; });
ok(/음성이 없는 문장/.test(warned), '음성이 없는 문장이 있으면 알린다');

console.log('\n[3] 배선');
const MAIN = read('main.js'), APP = read('renderer/src/App.jsx'), VB = read('vrew/vrew-builder.js'), VR = read('core/vrew-render.js'), PIPE = read('core/pipeline.js');
ok(/ipcMain\.handle\('set-group-look'/.test(MAIN) && /undoPush\('그림 모양'\)/.test(MAIN), 'IPC set-group-look (+ 되돌리기)');
ok(/ipcMain\.handle\('set-ai-notice-range'/.test(MAIN) && /undoPush\('AI 고지 범위'\)/.test(MAIN), 'IPC set-ai-notice-range (+ 되돌리기)');
ok(/look: g\.look \|\| null/.test(MAIN) && /if \(gs\.look\) g\.look = gs\.look/.test(MAIN), '작업본 저장·복원에 모양');
ok(/aiNoticeRange: pr\.aiNoticeRange \|\| null/.test(MAIN) && /if \(ps\.aiNoticeRange\) proj\.aiNoticeRange = ps\.aiNoticeRange/.test(MAIN), '작업본 저장·복원에 AI 고지 범위');
ok(/aiNoticeForRange\(preset\.aiNotice, project, logger\)/.test(PIPE), '🔑 .vrew 한 곳(buildProjectVrew)에서 범위를 시각으로 — 💾·⚡·MP4 가 같은 길');
ok(/editInfo: _editInfoForLook\(g\)/.test(VB) && (VB.match(/_editInfoForLook\(g\)/g) || []).length >= 4, '빌더: 영상·이미지 세 분기 모두 반전(editInfo.flip)');
ok(/placeFilters\(ch\.track\)/.test(VR) && /coverImage\(ch\.file, ctx, tr\)/.test(VR), '렌더러: 영상·이미지 모두 트랙 박스·반전을 읽는다');
ok(/채우기/.test(APP) && /반전/.test(APP) && /움직임/.test(APP) && /data-testid="ai-tag"/.test(APP), '화면: 그림 메뉴 채우기·반전·움직임 · AI 고지 꼬리표');
ok(/ev\.code === 'KeyZ'/.test(APP), '🔑 Ctrl+Z 는 키 자리(ev.code)로 — 한글 입력 상태에서도 먹는다');

console.log('\n[4] 실제 왕복 — 빌더로 .vrew → 렌더러로 MP4 → 화소 측정');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const FF = require('../core/media-utils').getFfmpegPath();
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vlook-'));
  try {
    const r = P.parseScriptText('# t\n## 장\n### 장면\n가나다라마바사입니다. 둘째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0];
    // 왼쪽 빨강 · 오른쪽 파랑 4:3 그림 — 반전·채우기가 눈에 보인다
    const img = path.join(tmp, 'g.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=600x900', '-f', 'lavfi', '-i', 'color=c=blue:s=600x900', '-filter_complex', 'hstack', '-frames:v', '1', img]);
    pr.groups[0].imagePath = img;
    P.fillSilent(pr, path.join(tmp, 'tts'));
    const tracksOf = (vrew) => { const pj = JSON.parse(new AdmZip(vrew).readAsText('project.json')); return Object.values(pj.props.tracks); };
    async function build(name, look, opts = {}) {
      pr.groups[0].look = look || undefined;
      const vrew = path.join(tmp, name + '.vrew');
      await P.buildProjectVrew(pr, vrew, opts.preset || {}, () => {}, 20, 1);
      return vrew;
    }
    async function frame(vrew, t, name) {
      const mp4 = path.join(tmp, name + '.mp4');
      const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
      if (!res || !res.ok) throw new Error('렌더 실패: ' + (res && res.error));
      return execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=96:54', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
    }
    const px = (raw, x, y) => { const i = (y * 96 + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
    const isRed = (p) => p[0] > 150 && p[2] < 90, isBlue = (p) => p[2] > 150 && p[0] < 90, isBlack = (p) => p[0] < 30 && p[1] < 30 && p[2] < 30;

    // (a) 기본 = 비율이 다르니 가운데 맞추기(레터박스) — 이제 MP4 도 .vrew 처럼 검은 띠
    const v0 = await build('base', null);
    const t0 = tracksOf(v0).find((t) => t.type === 'image');
    ok(t0.width < 1 && !t0.editInfo.flip && t0.kenburnsAnimationInfo, `기본 .vrew: 맞추기 박스(너비 ${t0.width.toFixed(2)}) · 반전 없음 · 켄번스 있음`);
    const f0 = await frame(v0, 0.5, 'base');
    ok(isBlack(px(f0, 3, 27)) && isRed(px(f0, 35, 27)) && isBlue(px(f0, 60, 27)), '🔑 기본 MP4: 양옆 검은 띠 · 왼쪽 빨강 · 오른쪽 파랑(.vrew 와 같은 배치 — 옛 판은 잘렸다)');

    // (b) 좌우 반전 + 꽉 채우기 + 움직임 없음
    const v1 = await build('flip', { flipH: true, fill: 'cover', motion: 'none' });
    const t1 = tracksOf(v1).find((t) => t.type === 'image');
    ok(t1.editInfo.flip && t1.editInfo.flip.horizontal === true && t1.editInfo.flip.vertical === false, '반전 .vrew: editInfo.flip = {horizontal:true, vertical:false}(Vrew 형식)');
    ok(t1.width >= 1 && t1.height > 1 && !t1.kenburnsAnimationInfo, `꽉 채우기 박스(${t1.width.toFixed(2)}×${t1.height.toFixed(2)}) · 움직임 없음 = 켄번스 필드 없음`);
    const f1a = await frame(v1, 0.3, 'flip');
    const f1b = execFileSync(FF, ['-loglevel', 'error', '-ss', '2.5', '-i', path.join(tmp, 'flip.mp4'), '-frames:v', '1', '-vf', 'scale=96:54', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    ok(isBlue(px(f1a, 10, 27)) && isRed(px(f1a, 85, 27)), '🔑 반전 MP4: 왼쪽이 파랑 · 오른쪽이 빨강(실제로 뒤집혔다)');
    ok(!isBlack(px(f1a, 3, 27)), '꽉 채우기 MP4: 검은 띠 없음');
    let diff = 0; for (let i = 0; i < f1a.length; i++) diff += Math.abs(f1a[i] - f1b[i]);
    ok(diff / f1a.length < 1.5, `움직임 없음 MP4: 0.3초와 2.5초 화면이 같다(평균 차 ${(diff / f1a.length).toFixed(2)})`);

    // (c) AI 고지 범위 — 둘째 문장부터
    pr.aiNoticeRange = { from: 2, to: 2 };
    const s1 = pr.sentences[0].ttsDurationSec;
    const v2 = await build('ai', null, { preset: { aiNotice: { enabled: true, text: 'AI 고지 시험', startMode: 'seconds', startSeconds: 5, durationSeconds: 5 } } });
    const web = tracksOf(v2).find((t) => t.type === 'web');
    ok(web && Math.abs(web.assetEffectInfo.startDelay - Math.round(s1 * 1000)) <= 1, `🏷 AI 고지가 둘째 문장 시작(${s1.toFixed(2)}초)에 나온다 (startDelay ${web && web.assetEffectInfo.startDelay}ms)`);
    ok(web && Math.abs(web.durationSeconds - pr.sentences[1].ttsDurationSec) < 0.01, 'AI 고지 길이 = 둘째 문장 길이');
    pr.aiNoticeRange = undefined;
  } catch (e) { ok(false, '왕복 실패: ' + e.message); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} visual-look ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
