'use strict';
/**
 * node test/fx-proto.js — 🌫 오버레이 모션 30초 시험 렌더(삼국지 R1) — 밴딩·깜박임·비용을 **측정**한다.
 *   환경변수: FX_KEEP=<폴더> 이면 결과 프레임 PNG 를 그 폴더에 남긴다(눈으로 볼 때) · FX_SEC(기본 30) · FX_ONLY=이름,이름 · FX_BASES=smooth,texture
 *   실제 렌더러와 같은 조건 — 그림은 **켄번스로 움직이는 중**(움직임이 없는 정지 영상은 인코더가 거의 공짜라 비교가 안 된다) · libx264 veryfast · 950k · -bf 0 · yuv420p · 30fps.
 *   측정:
 *     · 비용 — 30초(900프레임) 인코딩 벽시계 → 프레임당 ms (꺼짐 대비 추가분 × 3.7시간 환산)
 *     · 밴딩 — 어둡고 매끈한(smooth) / 결이 있는(texture) 그림에서 가로로 같은 값이 24px 이상 이어지는 화소 비율 — 효과를 켰을 때 **꺼짐보다 늘면 안 된다**(비트가 점·안개에 팔려 바탕이 뭉개지면 늘어난다)
 *     · 깜박임 — 프레임 평균 밝기의 흔들림(편차)과 이웃 프레임 최대 변화
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFile, execFileSync } = require('child_process');
const FF = require('../core/media-utils').getFfmpegPath();
const FX = require('../core/fx-overlay');
const R = require('../core/vrew-render');
const SEC = Number(process.env.FX_SEC || 30), FPS = 30;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const ffAsync = (args, cwd) => new Promise((res, rej) => execFile(FF, args, { cwd, maxBuffer: 1 << 26, windowsHide: true }, (e, so, se) => (e ? rej(new Error(String(se || e.message).split('\n').slice(-3).join(' / '))) : res(String(se || '')))));
const ff = (args, { cwd } = {}) => ffAsync(args, cwd);
const KB = { from: { scale: 0.926, centerX: 0.5, centerY: 0.5 }, to: { scale: 0.82, centerX: 0.5, centerY: 0.5 } };   // 느린 줌인(실제 켄번스 패턴 0번)

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxproto-'));
  const keep = process.env.FX_KEEP ? (fs.mkdirSync(process.env.FX_KEEP, { recursive: true }), process.env.FX_KEEP) : null;
  const bases = (process.env.FX_BASES || 'smooth,texture').split(',');
  try {
    // 어둡고 매끈한 그림(밴딩이 가장 잘 보이는 경우: 가운데가 밝은 비네트) · 어둡지만 결이 있는 그림(붓 결 비슷한 잡음 + 큰 명암)
    await ff(['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x2c2f3d:s=1920x1080,vignette=angle=PI/3.4,format=yuv420p', '-frames:v', '1', 'smooth.png'], { cwd: tmp });
    await ff(['-y', '-loglevel', 'error', '-filter_complex', "nullsrc=s=1920x1080,format=gray,geq=lum='random(7)*255',gblur=sigma=2.2,eq=contrast=1.8:brightness=-0.15[n];color=c=0x1d2330:s=1920x1080,vignette=angle=PI/3.2,format=gray[v];[n][v]blend=all_expr='A*0.18+B*0.9',format=yuv420p[o]", '-map', '[o]', '-frames:v', '1', 'texture.png'], { cwd: tmp });
    const tex = await FX.prepareTextures(ff, tmp, { fog: 1, dust: 1, firefly: 1 });

    async function bake(baseName, name, fx) {
      const g = FX.fxGraph({ base: '[b]', idx0: 1, t0: 0, dur: SEC, fx, tex, fps: FPS, id: `${baseName}_${name}` });
      if (g) for (const f of g.files) fs.writeFileSync(path.join(tmp, f.name), f.content);
      const frames = SEC * FPS;
      const base = `[0:v]format=yuv420p,loop=loop=${frames - 1}:size=1:start=0,setpts=N/${FPS}/TB,${R.kenBurnsFilter(KB, frames, 0, frames)}[b]`;
      const out = path.join(tmp, `${baseName}_${name}.mp4`);
      const common = ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '950k', '-maxrate', '998k', '-bufsize', '1900k', '-bf', '0', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an', '-frames:v', String(frames), out];
      const args = !g ? ['-y', '-hide_banner', '-loglevel', 'error', '-i', baseName + '.png', '-filter_complex', `${base};[b]null[vout]`, '-map', '[vout]', ...common]
        : ['-y', '-hide_banner', '-loglevel', 'error', '-i', baseName + '.png', ...g.ins, '-filter_complex', [base, ...g.parts, `${g.out}null[vout]`].join(';'), '-map', '[vout]', ...common];
      const t = Date.now();
      await ffAsync(args, tmp);
      const ms = Date.now() - t;
      return { out, ms, perFrame: ms / frames };
    }
    const luma = (file, t) => execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
    // 밴딩 — 가운데 ROI(가로 1200 × 세로 400) 에서 같은 값이 가로로 24px 이상 이어지는 화소 비율
    const banding = (file) => {
      let tot = 0, flat = 0;
      for (const t of [6, 14, 22]) {
        const y = luma(file, t);
        for (let r = 340; r < 740; r += 4) {
          let run = 1;
          for (let x = 360; x < 1560; x++) {
            const a = y[r * 1920 + x], b = y[r * 1920 + x + 1];
            if (a === b) run++; else { if (run >= 24) flat += run; tot += run; run = 1; }
          }
          if (run >= 24) flat += run; tot += run;
        }
      }
      return flat / tot;
    };
    const meanSeries = (file) => {
      const raw = execFileSync(FF, ['-loglevel', 'error', '-i', file, '-vf', 'scale=64:36,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
      const fsz = 64 * 36, out = [];
      for (let f = 0; f * fsz < raw.length; f++) { let s = 0; for (let i = 0; i < fsz; i++) s += raw[f * fsz + i]; out.push(s / fsz / 255); }
      return out;
    };
    const stat = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length); let mx = 0; for (let i = 1; i < a.length; i++) mx = Math.max(mx, Math.abs(a[i] - a[i - 1])); return { m, sd, mx }; };
    // 켄번스만 있는 영상의 평균 밝기 변화(기준선) — 효과의 변화는 이것을 빼고 본다
    const cfgAll = [
      ['off', {}], ['fog1', { fog: 1 }], ['fog3', { fog: 3 }], ['dust1', { dust: 1 }], ['dust3', { dust: 3 }], ['firefly1', { firefly: 1 }], ['firefly3', { firefly: 3 }],
      ['flicker1', { flicker: 1 }], ['flicker3', { flicker: 3 }], ['all1', { fog: 1, dust: 1, firefly: 1, flicker: 1 }], ['all3', { fog: 3, dust: 3, firefly: 3, flicker: 3 }],
    ];
    const only = process.env.FX_ONLY ? process.env.FX_ONLY.split(',') : null;
    const cfgs = cfgAll.filter(([n]) => !only || n === 'off' || only.includes(n));
    const RES = {};
    for (const bn of bases) {
      console.log(`\n── 바탕 그림: ${bn} ──`);
      const Rr = {};
      for (const [name, fx] of cfgs) {
        const r = await bake(bn, name, FX.normFx(fx));
        r.band = banding(r.out); r.mean = stat(meanSeries(r.out));
        Rr[name] = r;
        console.log(`  ${name.padEnd(9)} ${r.perFrame.toFixed(1)}ms/프레임 · 평탄(밴딩) ${(r.band * 100).toFixed(1)}% · 밝기 평균 ${r.mean.m.toFixed(3)} 편차 ${r.mean.sd.toFixed(4)} 이웃 최대 변화 ${r.mean.mx.toFixed(4)}`);
        if (keep && ['off', 'fog3', 'dust3', 'firefly3', 'all3'].includes(name)) execFileSync(FF, ['-y', '-loglevel', 'error', '-ss', '15', '-i', r.out, '-frames:v', '1', path.join(keep, `${bn}_${name}.png`)]);
      }
      RES[bn] = Rr;
    }
    for (const bn of bases) {
      const Rr = RES[bn], off = Rr.off;
      const strict = bn !== 'smooth';   // smooth = 합성 그라데이션(실제 그림보다 훨씬 가혹 · 밝기 오프셋만 바뀌어도 평탄 길이가 변한다) → 참고용, 크게 늘 때만 실패
      console.log(`\n── 판정: ${bn}${strict ? '' : ' (참고 — 가혹한 합성 그라데이션)'} ──`);
      for (const k of Object.keys(Rr)) if (k !== 'off') ok(Rr[k].band <= off.band + (strict ? 0.04 : 0.15), `밴딩: ${k} 평탄 ${(Rr[k].band * 100).toFixed(1)}% ≤ 켄번스만 ${(off.band * 100).toFixed(1)}% + ${strict ? 4 : 15}%p`);
      for (const k of ['fog1', 'fog3', 'dust1', 'dust3', 'firefly1', 'firefly3'].filter((x) => Rr[x])) ok(Math.abs(Rr[k].mean.m - off.mean.m) < (k.startsWith('fog') ? 0.03 : 0.012), `${k}: 평균 밝기 상승 ${(Rr[k].mean.m - off.mean.m).toFixed(4)} (화면이 허옇게 뜨지 않는다 · 안개 ≤ 0.03, 점 ≤ 0.012)`);
      for (const k of ['fog3', 'dust3', 'firefly1', 'firefly3'].filter((x) => Rr[x])) ok(Rr[k].mean.sd < 0.006, `${k}: 프레임 평균 밝기의 흔들림 ${Rr[k].mean.sd.toFixed(4)} < 0.006 (화면 전체가 숨 쉬지 않는다)`);
      for (const k of ['flicker1', 'flicker3'].filter((x) => Rr[x])) ok(Rr[k].mean.mx < 0.0065, `${k}: 이웃 프레임 최대 변화 ${Rr[k].mean.mx.toFixed(4)} < 0.0065 (≈ 1.6 단계 · 번쩍임 없음)`);
      if (Rr.flicker1 && Rr.flicker3) ok(Rr.flicker1.mean.sd < Rr.flicker3.mean.sd, '깜박임: 강도가 낮을수록 약하다');
      if (Rr.flicker3) ok(Rr.flicker3.mean.sd > 0.003, `깜박임 3단계 편차 ${Rr.flicker3.mean.sd.toFixed(4)} > 0.003 (보이긴 한다)`);
      if (Rr.all3) console.log(`  전부 켬(3단계) 추가 비용 ${(Rr.all3.perFrame - off.perFrame).toFixed(1)}ms/프레임 → 3.7시간(${3.7 * 3600 * FPS}프레임) CPU ${(((Rr.all3.perFrame - off.perFrame) * 3.7 * 3600 * FPS) / 60000).toFixed(0)}분 추가(조각 병렬 6개면 약 ${(((Rr.all3.perFrame - off.perFrame) * 3.7 * 3600 * FPS) / 60000 / 6).toFixed(0)}분)`);
    }
  } finally { if (!process.env.FX_NOCLEAN) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} } }
  console.log(`\n${fail ? '❌' : '✅'} fx-proto ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('시험 오류:', e); process.exit(1); });
