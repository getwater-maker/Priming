// 🖼 레이어(아래층으로 이어 깔기) · 📐 옮기고 줄인 자리 · ✂ 자막 줄 나눔 — core → .vrew → 유튜브 MP4 (2026-09-25)
//   node test/visual-layer.test.js
//   🔑 **진짜 빌더로 .vrew 를 만들고 진짜 렌더러로 MP4 를 구워 화소를 잰다**(헛단언 방지).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const CS = require('../core/caption-splitter');

console.log('\n[1] ✂ 자막 줄 나눔 — 사람이 정한 위치');
ok(JSON.stringify(CS.splitCaptionLines('가나다 라마바 사아자', 20, [4])) === '["가나다","라마바 사아자"]', '정한 위치에서 자른다(글자수보다 우선)');
ok(JSON.stringify(CS.splitCaptionLines('가나다 라마바 사아자', 5, null)) === JSON.stringify(CS.splitCaptionLines('가나다 라마바 사아자', 5)), '없으면 예전 자동 줄바꿈 그대로');
ok(CS.normBreaks('가나다', [0, 3, 9]) === null && JSON.stringify(CS.normBreaks('가나다라', [2, 2, 1])) === '[1,2]', '끝·밖·중복 위치는 버린다');
ok(JSON.stringify(CS.remapBreaks('가나다 라마바', '가나다다 라마바', [4])) === '[5]' && JSON.stringify(CS.remapBreaks('가나다 라마바', '가 라마바', [4])) === '[2]', '글을 고치면 위치가 따라간다');
const MAIN = read('main.js'), APP = read('renderer/src/App.jsx');
ok(/ipcMain\.handle\('set-caption-breaks'/.test(MAIN) && /undoPush\(nb \? '자막 줄 나누기' : '자막 줄 자동으로'\)/.test(MAIN), 'IPC set-caption-breaks (+ 되돌리기)');
ok(/capBreaks: \(s\.capBreaks && s\.capBreaks\.length\) \? s\.capBreaks : null/.test(MAIN) && /s\.capBreaks = ss\.capBreaks/.test(MAIN), '작업본 저장·복원');
ok((read('vrew/vrew-builder.js').match(/splitCaptionLines\(s\.text, maxCap, s\.capBreaks\)/g) || []).length === 1 && /s\.breaks\)/.test(read('renderer/src/Workspace.jsx')), '.vrew · 화면이 같은 줄 나눔');
ok(/lineBreakOp\('split', caret\)/.test(APP) && /lineBreakOp\('mergeUp'\)/.test(APP) && /lineBreakOp\('mergeDown'\)/.test(APP), 'Enter = 줄 나누기 · 줄 맨 앞 Backspace / 끝 Del = 줄 합치기');

console.log('\n[2] 🖼 .vrew — 이어 깐 그림은 여러 클립에 · 쌓는 순서 = 그룹 순서');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const GM = require('../core/group-merge');
const FF = require('../core/media-utils').getFfmpegPath();
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vlayer-'));
  try {
    const r = P.parseScriptText('# t\n## 장\n### 하나\n첫째 문장입니다.\n### 둘\n둘째 문장입니다.\n### 셋\n셋째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0];
    ok(pr.groups.length === 3, '그룹 3개');
    const mk = (name, color) => { const f = path.join(tmp, name + '.png'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=1920x1080`, '-frames:v', '1', f]); return f; };
    pr.groups[0].imagePath = mk('red', 'red');
    pr.groups[1].imagePath = mk('blue', 'blue');
    pr.groups[0].look = { box: { x: 0.35, y: 0.35, w: 0.3, h: 0.3 } };   // 📐 G1 빨강을 가운데 작게 — 늘려서 G2 위를 덮는다(v0.5.62)
    P.fillSilent(pr, path.join(tmp, 'tts'));
    pr.sentences[0].capBreaks = [3];   // ✂ 「첫째」 / 「문장입니다.」
    const rr = GM.setVisualRange(pr, 0, 0, 2);   // G1 그림을 끝까지 아래층으로
    ok(rr.ok && pr.groups.length === 3 && pr.groups[0].visSpan, 'G1 을 끝까지 늘려도 그룹 3개 그대로(겹쳐 깐다)');
    const vrew = path.join(tmp, 'x.vrew');
    await P.buildProjectVrew(pr, vrew, { captionStyle: { size: '100', align: 'center', yAlign: 'bottom', yOffset: -0.125 } }, () => {}, 20, 1);   // 자막은 아래(가운데 화소를 가리지 않게)
    const pj = JSON.parse(new AdmZip(vrew).readAsText('project.json'));
    const T = pj.props.tracks, A = pj.props.assets;
    const imgs = Object.values(T).filter((t) => t.type === 'image');
    const aidOf = (tr) => Object.keys(A).find((k) => A[k].trackIds.includes(tr.trackId));
    const red = imgs.find((t) => t.width < 0.5), blue = imgs.find((t) => t.width > 0.9);
    ok(red && blue && red.zIndex > blue.zIndex, `🔑 늘려 끌어온 빨강(G1)이 파랑(G2) 위층 (zIndex ${red && red.zIndex} > ${blue && blue.zIndex}) — v0.5.62 로이`);
    ok(red && Math.abs(red.xPos - 0.35) < 1e-6 && Math.abs(red.width - 0.3) < 1e-6, '📐 옮기고 줄인 자리 = 트랙 박스');
    const clips = pj.transcript.clips;
    const has = (c, tr) => (c.assetIds || []).includes(aidOf(tr));
    ok(clips.length === 4, `클립 4개(첫 문장이 ✂ 로 두 줄) — ${clips.length}`);
    ok(clips.every((c) => has(c, red)), '🔑 빨강(G1)은 모든 클립에 걸린다(아래층으로 이어짐 — 샘플.vrew 와 같은 형식)');
    ok(!has(clips[0], blue) && has(clips[2], blue) && !has(clips[3], blue), '파랑(G2)은 자기 클립에만');

    console.log('\n[3] 🎬 MP4 — 레이어가 실제로 겹쳐 구워진다');
    const mp4 = path.join(tmp, 'x.mp4');
    const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
    ok(res && res.ok, '렌더 성공');
    const s0 = pr.sentences[0].ttsDurationSec, s1 = pr.sentences[1].ttsDurationSec;
    const fr = (t) => execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=96:54', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const px = (raw, x, y) => { const i = (y * 96 + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
    const isRed = (p) => p[0] > 150 && p[2] < 90, isBlue = (p) => p[2] > 150 && p[0] < 90;
    const fA = fr(s0 / 2), fB = fr(s0 + s1 / 2), fC = fr(s0 + s1 + 0.4);
    console.log('   화소', JSON.stringify([px(fA, 48, 27), px(fB, 48, 27), px(fB, 5, 5), px(fC, 48, 27)]), s0, s1);
    ok(isRed(px(fA, 48, 27)) && !isRed(px(fA, 5, 5)), 'G1 구간: 가운데 빨강(작게) · 가장자리는 비어 있다');
    ok(isRed(px(fB, 48, 27)) && isBlue(px(fB, 5, 5)) && isBlue(px(fB, 90, 50)), '🔑 G2 구간: 늘려 끌어온 빨강이 **위** — 가운데 빨강 · 가장자리는 아래층 파랑(G2 자기 그림)');
    ok(isRed(px(fC, 48, 27)), '🔑 G3 구간(그림 없음): 빨강이 이어진다');
  } catch (e) { ok(false, '왕복 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} visual-layer ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
