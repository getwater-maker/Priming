'use strict';
/**
 * node test/denoise.test.js — 🔇 기본 노이즈 줄이기(Lab · 남은 기능 ②)
 *   [1] 규칙 · [2] 소스 배선 · [3] 🔑 실제 왕복: 잡음 섞인 소리 → 빌더(.vrew 문장 MP3) → 잡음 구간·목소리 구간 실측
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const CE = require('../core/clip-effects');
const P = require('../core/pipeline');
const FF = require('../core/media-utils').getFfmpegPath();

console.log('\n[1] 규칙');
ok(CE.normDenoise(0) === 0 && CE.normDenoise(1) === 1 && CE.normDenoise(3) === 3 && CE.normDenoise(4) === 0 && CE.normDenoise('x') === 0 && CE.normDenoise(-1) === 0, '단계 정규화(1~3 만 · 그 밖 = 없음)');
ok(CE.denoiseFilter(0) === '' && /^afftdn=nr=\d+:nf=-?\d+/.test(CE.denoiseFilter(2)) && CE.DENOISE.length === 4, 'ffmpeg 식(없음 = 빈 문자열)');
ok(Number(/nr=(\d+)/.exec(CE.denoiseFilter(1))[1]) < Number(/nr=(\d+)/.exec(CE.denoiseFilter(3))[1]), '강할수록 더 줄인다');
{
  const R = 24000, mk = (n, f) => { const p = new Int16Array(n); for (let i = 0; i < n; i++) p[i] = f(i); return p; };
  let sd = 5; const rnd = () => (sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  const noise = mk(R * 2, () => Math.round(rnd() * 2 * 1000));
  const nfN = CE.noiseFloorDb(noise, R);
  ok(nfN > -40 && nfN < -30, `잡음만 있으면 그 RMS 가 잡음 바닥(${nfN && nfN.toFixed(1)} dB)`);
  const voiced = mk(R * 3, (i) => ((i / R) % 1 < 0.5 ? Math.round(12000 * Math.sin(2 * Math.PI * 220 * i / R)) : Math.round(rnd() * 2 * 1000)));
  const nfV = CE.noiseFloorDb(voiced, R);
  ok(Math.abs(nfV - nfN) < 3, `말 사이 잡음이 있는 소리도 잡음 바닥을 잡는다(${nfV && nfV.toFixed(1)} ≈ ${nfN.toFixed(1)} dB)`);
  ok(CE.noiseFloorDb(new Int16Array(100), R) === null && CE.noiseFloorDb(new Int16Array(R), R) === null, '너무 짧거나 무음이면 null(기본값으로)');
  ok(/nf=-34:tn=0/.test(CE.denoiseFilter(3, -34.4)) && /nf=-50:/.test(CE.denoiseFilter(1, null)) && /nf=-20:/.test(CE.denoiseFilter(1, -5)) && /nf=-80:/.test(CE.denoiseFilter(1, -120)), 'nf 는 잰 값(−80~−20 으로 자름) · 못 재면 −50');
}
ok(!/require\(/.test(read('core/clip-effects.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), '🔑 렌더러 번들에 들어간다 — require 없음');

console.log('\n[2] 소스 배선');
const VB = read('vrew/vrew-builder.js'), M = read('main.js'), PL = read('preload.js'), APP = read('renderer/src/App.jsx'), PP = read('core/pipeline.js');
ok(/\|d\$\{CE\.normDenoise\(s && s\.denoise\)\}/.test(VB) && /CE\.denoiseFilter\(j\.dn, nf\)/.test(VB) && /CE\.noiseFloorDb\(pcm, 24000\)/.test(VB), '빌더: 사본 열쇠에 노이즈 단계 · 잡음 바닥을 재서 굽기');
const cd = M.slice(M.indexOf("ipcMain.handle('clip-denoise'"), M.indexOf("ipcMain.handle('clip-volume'"));
ok(cd.length > 300 && cd.indexOf('undoPush(') > 0 && cd.indexOf('undoPush(') < cd.indexOf('s.denoise = lv') && !/ttsAudioPath/.test(cd), 'IPC clip-denoise: 바꾸기 전 되돌리기 저장 · 음성 파일 불변');
ok(/dn: s\.denoise > 0 \? s\.denoise : null/.test(PP) && /dn: s\.denoise > 0 \? s\.denoise : null, pa:/.test(M) && (M.match(/s\.denoise = ss\.dn/g) || []).length === 2 && /keep\.denoise > 0/.test(M), 'DTO dn · 작업본 저장·이어받기 2곳 · 글 고침 유지');
ok(/clipDenoise: \(args\)/.test(PL) && /data-testid="dn-panel"/.test(APP) && /tid="cx-fx-denoise"/.test(APP) && /data-testid="rb-denoise"/.test(APP), '화면: 패널 · 우클릭 · 효과 탭');

console.log('\n[3] 실제 왕복 — 잡음 1초 + (목소리+잡음) 2초');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-'));
  try {
    const wav = path.join(tmp, 'noisy.wav');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=3:c=white:a=0.03:r=24000:seed=7', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2:sample_rate=24000', '-filter_complex', '[1:a]volume=0.5,adelay=1000|1000[t];[0:a][t]amix=inputs=2:duration=first:normalize=0,aformat=sample_fmts=s16:channel_layouts=mono', '-ar', '24000', wav]);
    const stat = (f, ss, t) => { const q = spawnSync(FF, ['-hide_banner', '-nostats', '-ss', String(ss), '-t', String(t), '-i', f, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }); const m = /mean_volume:\s*(-?[\d.]+)/.exec(q.stderr || ''); return m ? parseFloat(m[1]) : NaN; };
    const r = P.parseScriptText('# t\n## 장\n### 장면\n가나다라마바사입니다.\n', 'longform', {});
    const pr = r.projects[0];
    async function bake(name, level) {
      P.fillSilent(pr, path.join(tmp, 'tts_' + name));
      const s = pr.sentences[0]; s.ttsAudioPath = wav; s.ttsDurationSec = 3;
      if (level) s.denoise = level; else delete s.denoise;
      const vrew = path.join(tmp, name + '.vrew'); await P.buildProjectVrew(pr, vrew, {}, () => {}, 20, 1);
      const ent = new AdmZip(vrew).getEntries().find((e) => /^media\/.*\.(mp3|wav)$/i.test(e.entryName));
      const out = path.join(tmp, name + '.out.' + path.extname(ent.entryName).slice(1)); fs.writeFileSync(out, ent.getData());
      return { noise: stat(out, 0.1, 0.8), voice: stat(out, 1.2, 1.6) };
    }
    const base = await bake('base', 0);
    const weak = await bake('weak', 1), strong = await bake('strong', 3);
    console.log(`   · 잡음 구간 평균 dB: 없음 ${base.noise} · 약 ${weak.noise} · 강 ${strong.noise} | 목소리 구간: ${base.voice} · ${weak.voice} · ${strong.voice}`);
    ok(isFinite(base.noise) && base.noise < -20 && base.noise > -50, `기준: 잡음 구간 ${base.noise} dB(들린다)`);
    ok(base.noise - strong.noise >= 6, `🔑 강: 잡음 구간이 ${(base.noise - strong.noise).toFixed(1)} dB 줄었다(≥ 6)`);
    ok(weak.noise <= base.noise + 0.3 && strong.noise <= weak.noise + 0.3, '강할수록 더 줄거나 같다(약 ≤ 없음 · 강 ≤ 약)');
    ok(Math.abs(strong.voice - base.voice) <= 4, `목소리 구간은 크게 죽지 않는다(${base.voice} → ${strong.voice} dB · ±4 안)`);
    ok(strong.noise < strong.voice - 6 || base.noise > base.voice - 6, '노이즈 줄인 뒤 목소리와 잡음의 차이가 벌어졌다');
    ok(fs.statSync(wav).size > 100000, '원본 WAV 는 그대로');
    const off = await bake('off', 0);
    ok(Math.abs(off.noise - base.noise) < 0.2 && Math.abs(off.voice - base.voice) < 0.2, '끄면 처음과 같다');
  } catch (e) { ok(false, '왕복 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} denoise ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
