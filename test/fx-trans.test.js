'use strict';
/**
 * node test/fx-trans.test.js — 🎬 효과 ⑥ 화면 전환(Lab · MP4 만)
 *   [1] 순수 규칙 · [2] 소스 배선 · [3] 🔑 실제 왕복: 빌더(.vrew + 옆 파일) → 렌더러(MP4) → 경계 화면 화소
 *   .vrew 는 전환을 담지 못한다 — 옆 파일(<이름>.vrew.fx.json)로만 렌더러에 넘긴다(.vrew 자체는 전환 없이 그대로)
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const CE = require('../core/clip-effects');
const VL = require('../core/visual-look');

console.log('\n[1] 순수 규칙');
ok(CE.TRANS.length >= 6 && CE.TRANS.every((x) => x.id && x.label), `전환 ${CE.TRANS.length}종(id = xfade 이름)`);
ok(CE.normTrans({ type: 'wipeleft', sec: 2 }).type === 'wipeleft' && CE.normTrans({ type: 'wipeleft' }).sec === 1, '정규화(길이 없으면 1초)');
ok(CE.normTrans({ type: 'nope', sec: 1 }) === null && CE.normTrans(null) === null && CE.normTrans('x') === null, '모르는 종류 = 없음');
ok(CE.normTrans({ type: 'dissolve', sec: 99 }).sec === 4 && CE.normTrans({ type: 'dissolve', sec: 0 }).sec === 0.2, '길이는 0.2~4초로 자른다');
ok(VL.normLook({ trans: { type: 'slideleft', sec: 1.5 } }).trans.sec === 1.5 && !('trans' in VL.normLook({ trans: { type: 'zz' } })) && VL.isDefault({ trans: null }) && !VL.isDefault({ trans: { type: 'dissolve', sec: 1 } }), 'look 정규화 · 기본이면 필드 없음');
ok(/전환 왼쪽으로 닦아내기 2초\(MP4\)/.test(VL.describe({ trans: { type: 'wipeleft', sec: 2 } })), '로그용 설명');
ok(!/require\(/.test(read('core/clip-effects.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), '🔑 clip-effects 는 렌더러 번들에 들어간다 — require 없음');

console.log('\n[2] 소스 배선');
const VB = read('vrew/vrew-builder.js'), RV = read('core/vrew-render.js'), APP = read('renderer/src/App.jsx');
ok(/_transByTrack\[tid\] = CE\.normTrans/.test(VB) && /_transByTrack\[videoTid\] = CE\.normTrans/.test(VB) && /\.fx\.json/.test(VB), '빌더: 그림·영상 그룹의 전환을 옆 파일로');
ok(/perTrack\[q\.track\.trackId\]/.test(RV) && /xfade=transition=\$\{ch\.trans\}/.test(RV) && /\.vrew\.fx\.json|'\.fx\.json'/.test(RV), '렌더러: 옆 파일을 읽고 경계마다 그룹별 전환(xfade)');
ok(/data-testid="tr-panel"/.test(APP) && /tid="cx-fx-trans"/.test(APP) && /data-testid="rb-trans"/.test(APP) && /data-testid="ctb-trans"/.test(APP) && !/label="화면 전환" soon/.test(APP) && !/soon\('◐'/.test(APP), '화면: 패널 · 우클릭 · 효과 탭 · 막대 — 준비 중 표시 없음');

console.log('\n[3] 실제 왕복 — 빨강 10초 → 파랑 10초');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const FF = require('../core/media-utils').getFfmpegPath();
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxtr-'));
  try {
    const red = path.join(tmp, 'r.png'), blue = path.join(tmp, 'b.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=1920x1080', '-frames:v', '1', red]);
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080', '-frames:v', '1', blue]);
    const r = P.parseScriptText('# t\n## 장\n### ① 첫\n첫째 문장입니다. 둘째 문장입니다.\n### ② 둘\n셋째 문장입니다. 넷째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0];
    pr.groups[0].imagePath = red; pr.groups[1].imagePath = blue;
    pr.sentences.forEach((s, i) => { const mp3 = path.join(tmp, `s${i}.mp3`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '5', '-c:a', 'libmp3lame', mp3]); s.ttsAudioPath = mp3; s.ttsDurationSec = 5; });
    const info = (f) => { try { execFileSync(FF, ['-hide_banner', '-i', f], { stdio: 'pipe' }); } catch (e) { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(e.stderr)); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0; } return 0; };
    const frame = (f, t) => execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=96:54', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 });
    const px = (raw, x, y) => { const i = (y * 96 + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
    async function bake(name, trans) {
      pr.groups[1].look = trans ? { trans } : undefined;
      const vrew = path.join(tmp, name + '.vrew'); await P.buildProjectVrew(pr, vrew, {}, () => {}, 20, 1);
      const mp4 = path.join(tmp, name + '.mp4');
      const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 2 });
      if (!res || !res.ok) throw new Error('렌더 실패 ' + (res && res.error));
      return { vrew, mp4 };
    }
    const cut = await bake('cut', null);
    ok(!fs.existsSync(cut.vrew + '.fx.json'), '전환이 없으면 옆 파일을 만들지 않는다');
    const c0 = px(frame(cut.mp4, 9.9), 10, 27), c1 = px(frame(cut.mp4, 10.1), 10, 27);
    ok(c0[0] > 200 && c0[2] < 60 && c1[2] > 200 && c1[0] < 60, `전환 없음: 경계에서 빨강 → 파랑 단번에(${c0} → ${c1})`);
    const dcut = info(cut.mp4);

    const dis = await bake('dis', { type: 'dissolve', sec: 4 });
    ok(fs.existsSync(dis.vrew + '.fx.json') && Object.keys(JSON.parse(fs.readFileSync(dis.vrew + '.fx.json', 'utf8')).trans).length === 1, '옆 파일 = 전환이 있는 그룹 한 곳');
    const m = px(frame(dis.mp4, 10.0), 10, 27);
    ok(m[0] > 80 && m[0] < 175 && m[2] > 80 && m[2] < 175, `🔑 디졸브 4초: 경계(10초)는 반반 섞였다(${m})`);
    ok(Math.abs(info(dis.mp4) - dcut) < 0.1, `길이는 그대로(컷 ${dcut.toFixed(2)}초 · 전환 ${info(dis.mp4).toFixed(2)}초)`);
    ok(px(frame(dis.mp4, 7.0), 10, 27)[0] > 200 && px(frame(dis.mp4, 13.0), 10, 27)[2] > 200, '창 밖은 순수 빨강 / 순수 파랑');

    const wipe = await bake('wipe', { type: 'wipeleft', sec: 4 });
    const wl = px(frame(wipe.mp4, 10.0), 10, 27), wr = px(frame(wipe.mp4, 10.0), 86, 27);
    const isR = (p) => p[0] > 200 && p[2] < 60, isB = (p) => p[2] > 200 && p[0] < 60;
    ok((isR(wl) && isB(wr)) || (isB(wl) && isR(wr)), `🔑 왼쪽 닦아내기: 경계(10초)에 화면 한쪽은 빨강 · 다른 쪽은 파랑(왼 ${wl} · 오른 ${wr}) — 디졸브와 다른 모양`);
    ok(isR(px(frame(wipe.mp4, 7.0), 10, 27)) && isB(px(frame(wipe.mp4, 13.0), 10, 27)) && Math.abs(info(wipe.mp4) - dcut) < 0.1, '닦아내기: 창 밖은 순수 · 길이 그대로');
    const wm = px(frame(wipe.mp4, 10.0), 10, 27);
    ok(!(wm[0] > 80 && wm[0] < 175 && wm[2] > 80 && wm[2] < 175) || isR(wl) || isB(wl), '닦아내기는 섞이지 않는다(경계가 칼처럼 갈린다)');

    const fb = await bake('fb', { type: 'fadeblack', sec: 4 });
    const fbm = px(frame(fb.mp4, 10.0), 10, 27);
    ok(fbm[0] + fbm[2] < 120, `검정으로 사라졌다 나오기: 경계(10초)는 어둡다(${fbm})`);

    // .vrew 자체는 전환을 모른다 — 같은 입력이면 같은 모양(전환 필드가 .vrew 에 새지 않는다)
    const pj = JSON.parse(new AdmZip(dis.vrew).readAsText('project.json'));
    ok(!/wipeleft|fadeblack|"trans"|xfade/.test(JSON.stringify(pj)), '.vrew 의 project.json 에는 전환이 들어가지 않는다');
    // 전환을 끄면 옆 파일이 지워진다
    const off = await bake('dis', null);
    ok(!fs.existsSync(off.vrew + '.fx.json') && px(frame(off.mp4, 9.9), 10, 27)[0] > 200 && px(frame(off.mp4, 10.1), 10, 27)[2] > 200, '전환을 끄면 옆 파일이 지워지고 다시 컷');
  } catch (e) { ok(false, '왕복 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} fx-trans ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
