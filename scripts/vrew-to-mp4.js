#!/usr/bin/env node
/**
 * .vrew → MP4 직접 렌더 CLI — 앱 밖에서 한 편만 굽거나 검증할 때.
 *   node scripts/vrew-to-mp4.js "<작업폴더 또는 .vrew>" [--out <파일>] [--par 6] [--keep]
 * 실제 로직은 core/vrew-render.js 한 곳에 있다(앱의 「🎬 유튜브 MP4」와 같은 코드).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { renderVrewToMp4 } = require('../core/vrew-render');

const argv = process.argv.slice(2);
const opt = {}; const rest = [];
for (let i = 0; i < argv.length; i++) {
  const t = argv[i];
  if (t === '--keep') opt.keep = true;
  else if (t.startsWith('--')) opt[t.slice(2)] = argv[++i];
  else rest.push(t);
}
const input = rest[0];
if (!input) { console.error('쓰는 법: node scripts/vrew-to-mp4.js "<작업폴더 또는 .vrew>" [--out 파일] [--par N]'); process.exit(1); }

let vrew = input;
if (fs.statSync(input).isDirectory()) {
  const f = fs.readdirSync(input).find((x) => x.toLowerCase().endsWith('.vrew'));
  if (!f) { console.error('.vrew 를 찾지 못했습니다: ' + input); process.exit(1); }
  vrew = path.join(input, f);
}
const out = opt.out || vrew.replace(/\.vrew$/i, '.mp4');

renderVrewToMp4({ vrewPath: vrew, outPath: out, par: opt.par, bitrate: opt.bitrate, keepTmp: !!opt.keep, log: (m) => console.log(m) })
  .then((r) => {
    if (!r.ok) { console.error('❌ ' + r.error); process.exit(1); }
    console.log(`✅ ${r.output}`);
    console.log(`   영상 ${(r.durationSec / 60).toFixed(2)}분 · 렌더 ${r.renderSec.toFixed(1)}초 (${r.speed.toFixed(2)}배속 · ${r.encoder})`);
    console.log(`   단계별: ${Object.entries(r.timings).map(([k, v]) => `${k} ${v}s`).join(' · ')}`);
  });
