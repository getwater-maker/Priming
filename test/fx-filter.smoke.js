'use strict';
/**
 * node test/fx-filter.smoke.js — ✳ 효과 ③ 필터 **CSS ↔ ffmpeg 일치 시험**(Lab · 설계 §3-2 · 실제 Chromium 캔버스 vs 실제 ffmpeg 굽기)
 *   미리보기는 CSS filter(Chromium) · 출력은 ffmpeg 사본 — 같은 표에서 만든 두 식이 **같은 색**을 내는지 단색 여러 장으로 잰다(허용 ±6/255).
 *   「식이 같다」가 아니라 「결과가 같다」를 본다. 표를 바꾸면 이 시험이 먼저 깨진다.
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const CE = require('../core/clip-effects');
const BK = require('../core/clip-effects-bake');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#808080', '#c08040', '#204060', '#f0e0d0'];
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxflt-'));
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    console.log('\n[1] 표 점검');
    ok(CE.FILTERS.length >= 8 && CE.FILTERS.every((f) => CE.cssFilter(f.id) && CE.ffmpegFilter(f.id)), `필터 ${CE.FILTERS.length}종 모두 CSS 식 · ffmpeg 식이 있다`);
    ok(CE.cssFilter('bw') === 'grayscale(1)' && CE.cssFilter('nope') === '' && CE.ffmpegFilter('nope') === '', 'CSS 문자열 · 모르는 id 는 빈 값');

    console.log('\n[2] 단색 일치 — Chromium 캔버스(ctx.filter) vs ffmpeg 사본');
    let worstAll = 0, worstWhere = '';
    for (const f of CE.FILTERS) {
      const css = CE.cssFilter(f.id);
      const browser = await win.evaluate(({ css, colors }) => colors.map((c) => {
        const cv = document.createElement('canvas'); cv.width = 4; cv.height = 4;
        const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.filter = css; ctx.fillStyle = c; ctx.fillRect(0, 0, 4, 4);
        const d = ctx.getImageData(1, 1, 1, 1).data; return [d[0], d[1], d[2]];
      }), { css, colors: COLORS });
      let worst = 0, where = '';
      for (let i = 0; i < COLORS.length; i++) {
        const src = path.join(tmp, `c${i}.png`);
        if (!fs.existsSync(src)) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x${COLORS[i].slice(1)}:s=4x4`, '-frames:v', '1', src]);
        const out = await BK.bakeFilter({ src, filter: f.id, ffmpegPath: FF, dir: tmp });
        if (!out) { ok(false, `${f.id} 굽기 실패`); continue; }
        const raw = execFileSync(FF, ['-loglevel', 'error', '-i', out, '-frames:v', '1', '-vf', 'crop=1:1:1:1,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
        const ffc = [raw[0], raw[1], raw[2]];
        const d = Math.max(...ffc.map((v, k) => Math.abs(v - browser[i][k])));
        if (d > worst) { worst = d; where = `${COLORS[i]} 브라우저 ${browser[i]} ↔ ffmpeg ${ffc}`; }
      }
      if (worst > worstAll) { worstAll = worst; worstWhere = f.id + ' ' + where; }
      ok(worst <= 6, `${f.label}(${f.id}) — 가장 큰 차 ${worst}/255 ${worst > 6 ? where : ''}`);
    }
    console.log(`  · 전체 최대 차 ${worstAll}/255 (${worstWhere})`);

    console.log('\n[3] 판정력 — 일부러 틀린 식은 이 시험이 잡는다');
    const wrong = await win.evaluate(({ colors }) => colors.map((c) => {
      const cv = document.createElement('canvas'); cv.width = 4; cv.height = 4;
      const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.filter = 'sepia(0.8)'; ctx.fillStyle = c; ctx.fillRect(0, 0, 4, 4);
      const d = ctx.getImageData(1, 1, 1, 1).data; return [d[0], d[1], d[2]];
    }), { colors: COLORS });
    const bwSrc = path.join(tmp, 'c0.png');
    const bwOut = await BK.bakeFilter({ src: bwSrc, filter: 'bw', ffmpegPath: FF, dir: tmp });
    const rawBw = execFileSync(FF, ['-loglevel', 'error', '-i', bwOut, '-frames:v', '1', '-vf', 'crop=1:1:1:1,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
    const dd = Math.max(...[rawBw[0], rawBw[1], rawBw[2]].map((v, k) => Math.abs(v - wrong[0][k])));
    ok(dd > 20, `흑백 사본과 세피아 CSS 는 크게 다르다(차 ${dd}) — 허용 오차가 아무거나 통과시키지 않는다`);
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally { await app.close().catch(() => {}); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(fail ? `\n❌ fx-filter ${pass}/${pass + fail}` : `\n✅ fx-filter ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
