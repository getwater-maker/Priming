'use strict';
/**
 * node test/fx-volume.test.js — 🔉 효과 ④ 볼륨 조절(Lab · 굽기 방식)
 *   [1] 순수 규칙 · [2] 소스 배선 · [3] 🔑 실제 왕복: 진짜 빌더(.vrew 의 문장 MP3 에 볼륨 굽기) → ffmpeg volumedetect 로 실측
 *   ⛔ TTS 규칙 「리미터·압축 금지」 — 1 초과는 피크 여유 안에서만 키운다(넘치는 만큼은 깎고 로그)
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const CE = require('../core/clip-effects');

console.log('\n[1] 순수 규칙');
ok(CE.normVol(1) === null && CE.normVol('') === null && CE.normVol(null) === null && CE.normVol('abc') === null && CE.normVol(1.003) === null, '기본(1)·빈 값·못 읽는 값 = null(필드 없음)');
ok(CE.normVol(0) === 0 && CE.normVol(0.5) === 0.5 && CE.normVol(1.5) === 1.5 && CE.normVol(9) === 2 && CE.normVol(-3) === 0, '0(무음)은 유효 · 0~2 로 자른다');
ok(CE.normVol(0.333) === 0.33, '소수 둘째 자리');
ok(CE.volGain(0.5, 0).gain === 0.5 && !CE.volGain(0.5, 0).capped, '줄이는 쪽은 그대로(피크 무관)');
ok(CE.volGain(null, -5).gain === 1 && CE.volGain(1, -5).gain === 1, '기본은 1배');
const g = CE.volGain(2, -12);   // 여유 = −1 −(−12) = 11 dB → 3.55배 허용 → 2배 그대로
ok(g.gain === 2 && !g.capped, '여유가 충분하면 요청한 만큼 키운다');
const g2 = CE.volGain(2, -4);   // 여유 3 dB → 1.41배
ok(Math.abs(g2.gain - Math.pow(10, 3 / 20)) < 1e-6 && g2.capped, '🔑 피크 여유(−1 dBFS)까지만 키운다 · 깎았다고 알린다');
ok(CE.volGain(2, 0).gain === 1 && CE.volGain(2, 0).capped, '이미 꽉 찬 음성은 키우지 않는다(줄이지도 않는다)');
ok(CE.volGain(2, NaN).gain === 1 && CE.volGain(2, NaN).capped, '피크를 못 재면 키우지 않는다(fail-closed)');
ok(!/require\(/.test(read('core/clip-effects.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), '🔑 clip-effects 는 렌더러 번들에 들어간다 — require 없음');

console.log('\n[2] 소스 배선');
const VB = read('vrew/vrew-builder.js'), M = read('main.js'), P = read('core/pipeline.js'), PL = read('preload.js'), APP = read('renderer/src/App.jsx');
ok(/function _mp3Key\(s\)/.test(VB) && /_mp3Cache\.get\(_mp3Key\(s\)\)/.test(VB), '빌더: 사본 열쇠에 볼륨이 들어간다(같은 파일·다른 볼륨 = 다른 사본)');
ok(/`volume=\$\{gain\.toFixed\(4\)\}`/.test(VB) && !/alimiter|acompressor|dynaudnorm/.test(VB.slice(VB.indexOf('async function preConvertWavsToMp3'), VB.indexOf('async function preConvertWavsToMp3') + 3000)), '빌더: volume= 만 얹는다(리미터·압축 없음)');
ok(/vl: \(s\.vol != null && s\.vol !== 1\) \? s\.vol : null/.test(P) && /vl: \(s\.vol != null && s\.vol !== 1\) \? s\.vol : null, ow:/.test(M), 'DTO(pipeline)와 작업본 저장(main)에 vl');
ok((M.match(/s\.vol = ss\.vl;/g) || []).length === 2, '작업본 이어받기 두 곳(무조건 · 같은 문장일 때만)');
ok(/if \(keep\.vol != null\) s\.vol = keep\.vol/.test(M), '글이 같은 문장은 편집 뒤에도 볼륨 유지');
const cv = M.slice(M.indexOf("ipcMain.handle('clip-volume'"), M.indexOf("ipcMain.handle('tts-sentences'"));
ok(cv.length > 300 && cv.indexOf('undoPush(') > 0 && cv.indexOf('undoPush(') < cv.indexOf('s.vol = v') && /storeActive\(\); syncSnapshotNow\(\)/.test(cv), 'IPC clip-volume: 바꾸기 전에 되돌리기 저장 · 작업본 저장');
ok(!/ttsAudioPath|quietPass/.test(cv), '음성 파일은 건드리지 않는다');
ok(/clipVolume: \(args\) => ipcRenderer\.invoke\('clip-volume', args\)/.test(PL), 'preload 연결');
ok(/data-testid="vol-panel"/.test(APP) && /tid="cx-fx-volume"/.test(APP) && /data-testid="rb-volume"/.test(APP) && /data-testid="ctb-volume"/.test(APP) && !/label="볼륨 조절" soon/.test(APP), '화면: 패널 · 우클릭 · 효과 탭 · 막대 — 준비 중 표시 없음');
ok(/a\.volume = Math\.max\(0, Math\.min\(1, s\.vl != null \? s\.vl : 1\)\)/.test(APP), '미리보기 재생: 100% 까지 반영');

console.log('\n[3] 실제 왕복 — 빌더로 .vrew → 문장 MP3 → volumedetect');
const P2 = require('../core/pipeline');
const FF = require('../core/media-utils').getFfmpegPath();
function meanMax(file) {
  let err = '';
  try { execFileSync(FF, ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) { err = String(e.stderr || ''); }
  if (!err) { try { const r = require('child_process').spawnSync(FF, ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }); err = r.stderr || ''; } catch (_) {} }
  const mean = /mean_volume:\s*(-?[\d.]+)/.exec(err), max = /max_volume:\s*(-?[\d.]+)/.exec(err);
  return { mean: mean ? parseFloat(mean[1]) : NaN, max: max ? parseFloat(max[1]) : NaN };
}
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxvol-'));
  try {
    const mkTone = (name, ampDb, ext = 'wav') => {
      const f = path.join(tmp, name + '.' + ext);
      const codec = ext === 'wav' ? ['-codec:a', 'pcm_s16le'] : ['-codec:a', 'libmp3lame', '-b:a', '192k'];
      execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=24000', '-af', `volume=${ampDb}dB`, '-ac', '1', ...codec, f]);
      return f;
    };
    const quiet = mkTone('quiet', -30), loud = mkTone('loud', 17), quietMp3 = mkTone('quietmp3', -30, 'mp3');
    const logs = [];
    async function build(name, src, vol) {
      const r = P2.parseScriptText('# t\n## 장\n### 장면\n가나다라마바사입니다.\n', 'longform', {});
      const pr = r.projects[0];
      P2.fillSilent(pr, path.join(tmp, 'tts_' + name));
      const s = pr.sentences[0]; s.ttsAudioPath = src; s.ttsDurationSec = 3;
      if (vol != null) s.vol = vol;
      const vrew = path.join(tmp, name + '.vrew');
      await P2.buildProjectVrew(pr, vrew, {}, (m) => logs.push(String(m)), 20, 1);
      const z = new AdmZip(vrew); const pj = JSON.parse(z.readAsText('project.json'));
      const af = pj.files.find((x) => /\.mp3$/i.test(x.name || '') || x.type === 'AVMedia');
      const ent = z.getEntries().find((e) => /^media\/.*\.(mp3|wav)$/i.test(e.entryName));
      if (!ent) throw new Error('음성 파일을 .vrew 에서 못 찾음');
      const out = path.join(tmp, name + '.out.' + path.extname(ent.entryName).slice(1)); fs.writeFileSync(out, ent.getData());
      void af; return out;
    }
    const base = meanMax(await build('base', quiet, null));
    ok(isFinite(base.mean) && base.mean < -40 && base.mean > -60, `기준(볼륨 없음) 평균 ${base.mean} dB`);
    const half = meanMax(await build('half', quiet, 0.5));
    ok(Math.abs((half.mean - base.mean) - (-6.02)) < 1.0, `🔑 50% → 약 −6 dB(실측 ${(half.mean - base.mean).toFixed(2)} dB)`);
    const zero = meanMax(await build('zero', quiet, 0));
    ok(zero.max < -80 || !isFinite(zero.mean) || zero.mean < -80, `0% → 무음(최대 ${zero.max} dB)`);
    const dbl = meanMax(await build('dbl', quiet, 2));
    ok(Math.abs((dbl.mean - base.mean) - 6.02) < 1.0, `🔑 여유 있는 음성의 200% → 약 +6 dB(실측 ${(dbl.mean - base.mean).toFixed(2)} dB)`);
    const mp3src = meanMax(await build('mp3half', quietMp3, 0.5));
    const mp3base = meanMax(await build('mp3base', quietMp3, null));
    ok(Math.abs((mp3src.mean - mp3base.mean) - (-6.02)) < 1.0, `mp3 원본에도 볼륨이 구워진다(실측 ${(mp3src.mean - mp3base.mean).toFixed(2)} dB)`);
    logs.length = 0;
    const lb = meanMax(await build('loudbase', loud, null));
    const ld = meanMax(await build('loud2', loud, 2));
    ok(ld.max <= 0.5, `🔑 이미 큰 음성의 200% — 넘치지 않는다(최대 ${ld.max} dB · 기준 ${lb.max} dB)`);
    ok(logs.some((l) => /피크/.test(l)), '깎았다고 로그로 알린다: ' + (logs.find((l) => /피크/.test(l)) || '').slice(0, 80));
    // 원본은 그대로
    const before = fs.statSync(quiet).size;
    await build('again', quiet, 0.5);
    ok(fs.statSync(quiet).size === before, '원본 음성 파일은 한 바이트도 안 바뀐다');
  } catch (e) { ok(false, '왕복 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} fx-volume ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
