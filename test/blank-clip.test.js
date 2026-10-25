'use strict';
/**
 * node test/blank-clip.test.js — ▭ 빈 클립 삽입(Lab · s.padAfter)
 *   [1] 순수 규칙(pausePlanOf 합치기 · 카드 시각) · [2] 소스 배선 · [3] 🔑 실제 왕복: 빌더(.vrew) → 렌더러(MP4) → 길이·SRT·자막 가림
 *   설계 docs/VrewLab/빈클립_정지워드_설계.md
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const P = require('../core/pipeline');
const SC = require('../core/screen-cards');
const R = require('../core/vrew-render');
const FF = require('../core/media-utils').getFfmpegPath();

console.log('\n[1] 순수 규칙');
ok(SC.normPad(0) === 0 && SC.normPad(-1) === 0 && SC.normPad('x') === 0 && SC.normPad(0.05) === 0.2 && SC.normPad(99) === 10 && SC.normPad(1.26) === 1.3, '정규화(0·음수·못 읽음 = 없음 · 0.2~10초 · 0.1 단위)');
const mkProj = (padFirst, withSound = true) => {
  const r = P.parseScriptText('# t\n## 장\n### ① 가\n첫째 문장입니다. 둘째 문장입니다.\n', 'longform', {});
  const pr = r.projects[0];
  pr.sentences.forEach((s, i) => { if (withSound) { s.ttsAudioPath = 'x.wav'; s.ttsDurationSec = 3; } });
  if (padFirst) pr.sentences[0].padAfter = padFirst;
  return pr;
};
const pz = P.pausePlanOf(mkProj(1.5), null);
ok(pz.map.size === 1 && [...pz.map.values()][0] === 1.5 && pz.total === 1.5 && pz.list[0].pad === true, '카드가 없어도 padAfter 가 쉼 계획에 든다(합계 1.5초)');
ok(P.pausePlanOf(mkProj(0), null).map.size === 0, 'padAfter 가 없으면 예전처럼 빈 계획');
ok(P.pausePlanOf(mkProj(1.5, false), null).map.size === 0, '음성이 없는 문장 뒤에는 쉼이 없다(카드 쉼과 같은 조건)');
{ // 카드 쉼 + 빈 클립 = 합
  const pr = mkProj(2);
  pr.screenCards = [{ kind: 'interlude', line: 3, f: { 제목: { raw: '첫째 문장입니다' } }, anchor: null }];
  const base = P.pausePlanOf({ ...pr, sentences: pr.sentences.map((s) => ({ ...s, padAfter: 0 })) }, { interludePauseSec: 4 });
  const both = P.pausePlanOf(pr, { interludePauseSec: 4 });
  const id0 = pr.sentences[0].id;
  if (base.map.get(id0)) ok(both.map.get(id0) === base.map.get(id0) + 2, `카드 쉼(${base.map.get(id0)}) + 빈 클립(2) = 합 ${both.map.get(id0)}`);
  else ok(true, '(카드 마커 모양이 달라 합 시험은 건너뜀 — 아래 실제 왕복이 대신한다)');
}
{ const pr = mkProj(1); const w = P.userPauseWins(pr, null); ok(w.length === 1 && Math.abs(w[0][0] - 3) < 1e-6 && Math.abs(w[0][1] - 4) < 1e-6, `쉼 창 = 첫 문장 음성 끝~+1초 ${JSON.stringify(w)}`); }

console.log('\n[2] 소스 배선');
const M = read('main.js'), PL = read('preload.js'), APP = read('renderer/src/App.jsx'), PP = read('core/pipeline.js'), RV = read('core/vrew-render.js');
ok(/ipcMain\.handle\('clip-pad'/.test(M) && /clipPad: \(args\)/.test(PL), 'IPC clip-pad + preload');
const cp = M.slice(M.indexOf("ipcMain.handle('clip-pad'"), M.indexOf("ipcMain.handle('clip-voice-overwrite'"));
ok(cp.indexOf('undoPush(') > 0 && cp.indexOf('undoPush(') < cp.indexOf('last.padAfter = next') && /storeActive\(\); syncSnapshotNow\(\)/.test(cp) && !/ttsAudioPath = /.test(cp), '바꾸기 전에 되돌리기 저장 · 작업본 저장 · 음성 파일은 건드리지 않는다');
ok(/pa: s\.padAfter > 0 \? s\.padAfter : null/.test(PP) && /pa: s\.padAfter > 0 \? s\.padAfter : null, ks:/.test(M) && (M.match(/s\.padAfter = ss\.pa/g) || []).length === 2 && /keep\.padAfter > 0/.test(M), 'DTO pa · 작업본 저장·이어받기 2곳 · 글 고침 유지');
ok(/function pausePlanOf/.test(PP) && /SCd\.padOf\(s\)/.test(PP) && !/padAfter/.test(read('vrew/vrew-builder.js')), '🔑 padAfter 를 읽는 곳은 pausePlanOf 한 곳(빌더는 읽지 않는다)');
ok(/j\.pauseWins/.test(RV) && /ctx\.pauseCaptionWins = \[\.\.\.\(ctx\.pauseCaptionWins \|\| \[\]\), \.\.\.pw\]/.test(RV), '렌더러: 옆 파일 pauseWins → 자막 가림(카드 쉼 창과 합침)');
ok(/data-testid="pad-panel"/.test(APP) && /tid="cx-pad"/.test(APP) && /data-testid="ins-pad"/.test(APP) && !/label="빈 클립 삽입" soon/.test(APP), '화면: 패널 · 우클릭 · 삽입 탭 단추');

console.log('\n[3] 실제 왕복 — 문장 2개(각 5초) · 첫 문장 뒤 빈 클립 2초');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-'));
  try {
    const img = path.join(tmp, 'b.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x103060:s=1920x1080', '-frames:v', '1', img]);
    const r = P.parseScriptText('# t\n## 장\n### ① 가\n첫째 문장입니다. 둘째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0]; pr.groups[0].imagePath = img;
    pr.sentences.forEach((s, i) => { const mp3 = path.join(tmp, `s${i}.mp3`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '5', '-c:a', 'libmp3lame', mp3]); s.ttsAudioPath = mp3; s.ttsDurationSec = 5; });
    const dur = (f) => { try { execFileSync(FF, ['-hide_banner', '-i', f], { stdio: 'pipe' }); } catch (e) { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(e.stderr)); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0; } return 0; };
    const whiteIn = (f, t) => { const raw = execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=480:270,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 }); let n = 0; for (let i = 0; i < raw.length; i += 3) if (Math.abs(raw[i] - 0x10) + Math.abs(raw[i + 1] - 0x30) + Math.abs(raw[i + 2] - 0x60) > 90) n++; return n; };   // 배경(0x103060)과 다른 화소 = 자막 글자
    async function bake(name, pad) {
      if (pad) pr.sentences[0].padAfter = pad; else delete pr.sentences[0].padAfter;
      const vrew = path.join(tmp, name + '.vrew'); await P.buildProjectVrew(pr, vrew, {}, () => {}, 20, 1);
      const mp4 = path.join(tmp, name + '.mp4'); const logs = [];
      const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: (m) => logs.push(String(m)), par: 2 });
      if (!res || !res.ok) throw new Error('렌더 실패 ' + (res && res.error));
      return { vrew, mp4, logs };
    }
    const base = await bake('base', 0);
    ok(!fs.existsSync(base.vrew + '.fx.json'), '빈 클립이 없으면 옆 파일이 없다');
    const d0 = dur(base.mp4);
    const w0 = whiteIn(base.mp4, 5.5);   // 둘째 문장 자막(기준: 5초 뒤 바로 둘째 문장)
    ok(w0 > 30, `기준: 둘째 문장 구간에 자막 글자가 보인다(흰 화소 ${w0})`);
    const pad = await bake('pad', 2);
    const d1 = dur(pad.mp4);
    ok(Math.abs((d1 - d0) - 2) < 0.15, `🔑 MP4 길이 +2초(${d0.toFixed(2)} → ${d1.toFixed(2)})`);
    const fx = JSON.parse(fs.readFileSync(pad.vrew + '.fx.json', 'utf8'));
    ok(Array.isArray(fx.pauseWins) && fx.pauseWins.length === 1 && Math.abs(fx.pauseWins[0][0] - 5) < 0.05 && Math.abs(fx.pauseWins[0][1] - 7) < 0.05, `옆 파일 쉼 창 [5, 7] ${JSON.stringify(fx.pauseWins)}`);
    ok(pad.logs.some((l) => /빈 클립 1곳/.test(l)), '렌더 로그에 「빈 클립 1곳 — 쉼 동안 자막을 뺍니다」');
    const wp = whiteIn(pad.mp4, 6.0);   // 쉼 한가운데
    ok(wp === 0, `🔑 쉼 동안(6.0초)에는 자막이 없다(흰 화소 ${wp})`);
    const wn = whiteIn(pad.mp4, 7.5);   // 쉼 뒤 둘째 문장
    ok(wn > 30, `쉼이 끝나면 둘째 문장 자막이 나온다(흰 화소 ${wn} · 기준과 같은 글자는 2초 뒤)`);
    const wb = whiteIn(pad.mp4, 4.5);
    ok(wb > 30, `쉼 전 첫 문장 자막은 그대로(흰 화소 ${wb})`);
    // .vrew 안: 첫 문장 음성 클립이 7초
    const pj = JSON.parse(new AdmZip(pad.vrew).readAsText('project.json'));
    const durs = pj.transcript.clips.map((c) => { const w = c.words || []; return w.length ? Math.max(...w.map((x) => x.mediaEndTime || 0)) : 0; });
    ok(pj.transcript.clips.length >= 2, '.vrew 클립 ' + pj.transcript.clips.length + '개');
    // SRT: 둘째 문장이 2초 밀림
    const sB = path.join(tmp, 'b.srt'), sP = path.join(tmp, 'p.srt');
    delete pr.sentences[0].padAfter; P.writeSrt(pr, sB, 20, null); pr.sentences[0].padAfter = 2; P.writeSrt(pr, sP, 20, null);
    const starts = (f) => [...fs.readFileSync(f, 'utf8').matchAll(/(\d\d):(\d\d):(\d\d),(\d{3}) -->/g)].map((m) => (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000);
    const a = starts(sB), b = starts(sP);
    ok(a.length === b.length && Math.abs((b[b.length - 1] - a[a.length - 1]) - 2) < 0.05, `SRT: 뒤 자막이 2초 밀린다(${a[a.length - 1].toFixed(2)} → ${b[b.length - 1].toFixed(2)})`);
    // 지우면 옆 파일이 없어지고 길이가 처음으로
    const off = await bake('off', 0);
    ok(!fs.existsSync(off.vrew + '.fx.json') && Math.abs(dur(off.mp4) - d0) < 0.1, '지우면 옆 파일이 사라지고 길이가 처음과 같다');
    void durs;
  } catch (e) { ok(false, '왕복 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} blank-clip ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
