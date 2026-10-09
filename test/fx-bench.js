'use strict';
/**
 * node test/fx-bench.js — 🌫 켄번스 구간 · 디졸브 · 오버레이 모션의 **렌더 시간·메모리**(삼국지 3~4시간 환산용) — 수 분 걸린다(수동 · 다른 렌더와 동시에 돌리지 말 것)
 *   환경변수: FXB_MIN(기본 6 · 영상 분) · FXB_GROUPS(기본 3 · 그림 수) · FXB_ONLY=이름,이름
 *   같은 .vrew(켄번스만) 위에서 설정만 바꿔 연달아 굽는다 — 각 설정의 **추가 시간**은 첫 줄(없음) 대비다. 켄번스 구간은 .vrew 가 다르므로 따로 비교한다.
 *   ⚠ 이 PC 는 NVENC 로 굽는다(인코딩이 거의 공짜 → 필터 비용이 그대로 드러난다) · 아내 PC(CPU 인코딩)는 더 걸린다.
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const P = require('../core/pipeline'), R = require('../core/vrew-render'), FXO = require('../core/fx-overlay');
const FF = require('../core/media-utils').getFfmpegPath();
const MIN = Number(process.env.FXB_MIN || 6), NG = Number(process.env.FXB_GROUPS || 3);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxbench-'));
  try {
    const imgs = [];
    for (let i = 0; i < NG; i++) {
      const f = path.join(tmp, `g${i}.png`);
      execFileSync(FF, ['-y', '-loglevel', 'error', '-filter_complex', `nullsrc=s=1920x1080,format=gray,geq=lum='random(${i + 5})*255',gblur=sigma=2.4,eq=contrast=1.7:brightness=-0.2[n];color=c=0x${(0x1c2230 + i * 0x040302).toString(16)}:s=1920x1080,format=gray[v];[n][v]blend=all_expr='A*0.2+B*0.9',format=yuv420p[o]`, '-map', '[o]', '-frames:v', '1', f]);
      imgs.push(f);
    }
    const perGroup = Math.max(2, Math.round((MIN * 60) / NG / 20));   // 문장 20초씩
    let md = '# 벤치\n\n## 장\n';
    for (let g = 0; g < NG; g++) { md += `### 장면 ${g + 1}\n` + Array.from({ length: perGroup }, (_, k) => `${g + 1}-${k + 1}번째 문장입니다.`).join(' ') + '\n'; }
    const pr = P.parseScriptText(md, 'longform', {}).projects[0];
    pr.groups.forEach((g, i) => { g.imagePath = imgs[i % imgs.length]; });
    const mp3 = path.join(tmp, 's.mp3'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '20', '-c:a', 'libmp3lame', mp3]);
    pr.sentences.forEach((s) => { s.ttsAudioPath = mp3; s.ttsDurationSec = 20; });
    const vmin = pr.sentences.length * 20 / 60;
    console.log(`영상 ${vmin.toFixed(0)}분 · 그림 ${NG}장 · 그림당 ${(perGroup * 20 / 60).toFixed(1)}분`);
    const vrew1 = path.join(tmp, 'plain.vrew'), vrew2 = path.join(tmp, 'seg.vrew');
    await P.buildProjectVrew(pr, vrew1, {}, () => {}, 20, 1);
    pr.groups.forEach((g) => { g.look = { kbSeg: 'auto' }; });
    await P.buildProjectVrew(pr, vrew2, {}, () => {}, 20, 1);
    pr.groups.forEach((g) => { g.look = undefined; });
    const plan = (set) => ({ ranges: FXO.planOf(pr, set) });
    const ALL = { fog: 2, dust: 2, firefly: 2, flicker: 2 };
    const matrix = [
      ['없음(켄번스만)', vrew1, {}], ['안개 2', vrew1, { fx: plan({ fog: 2 }) }], ['먼지 2', vrew1, { fx: plan({ dust: 2 }) }], ['반딧불 2', vrew1, { fx: plan({ firefly: 2 }) }],
      ['깜박임 2', vrew1, { fx: plan({ flicker: 2 }) }], ['안개1+깜박임1', vrew1, { fx: plan({ fog: 1, flicker: 1 }) }], ['전부 2', vrew1, { fx: plan(ALL) }],
      ['디졸브 4초', vrew1, { dissolveSec: 4 }], ['켄번스 구간 자동', vrew2, {}], ['전부(구간+디졸브+효과2)', vrew2, { fx: plan(ALL), dissolveSec: 4 }],
    ];
    const only = process.env.FXB_ONLY ? process.env.FXB_ONLY.split(',') : null;
    let base = 0, baseSeg = 0;
    for (const [name, vrew, o] of matrix) {
      if (only && !only.includes(name) && name !== '없음(켄번스만)' && name !== '켄번스 구간 자동') continue;
      let minFree = os.freemem(); const free0 = minFree;
      const iv = setInterval(() => { minFree = Math.min(minFree, os.freemem()); }, 500);
      const mp4 = path.join(tmp, 'o.mp4'); const t0 = Date.now();
      const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, ...o });
      clearInterval(iv);
      if (!res || !res.ok) throw new Error(name + ' 렌더 실패 ' + (res && res.error));
      const sec = (Date.now() - t0) / 1000; if (name === '없음(켄번스만)') base = sec; if (name === '켄번스 구간 자동') baseSeg = sec;
      const ref = vrew === vrew2 && name !== '켄번스 구간 자동' ? baseSeg : base;
      console.log(`  ${name.padEnd(22)} ${sec.toFixed(1).padStart(6)}초 · 영상 1분당 ${(sec / vmin).toFixed(2)}초${ref && sec !== ref ? ` (${sec > ref ? '+' : ''}${((sec - ref) / vmin).toFixed(2)}초/분 · ${((sec / ref - 1) * 100).toFixed(0)}%)` : ''} · 메모리 +${((free0 - minFree) / 1048576).toFixed(0)}MB · ${(fs.statSync(mp4).size / 1048576).toFixed(1)}MB`);
      fs.rmSync(mp4, { force: true });
    }
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
})().catch((e) => { console.error('벤치 오류:', e); process.exit(1); });
