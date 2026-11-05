#!/usr/bin/env node
'use strict';
/**
 * 🎓 강의 HTML 굽기 — 앱 없이(개발 PC · 2.0 덧붙임4 ㊿ · v1.0.34)
 *   node tools/lecture.js status
 *   node tools/lecture.js setup                                   (HyperFrames 를 저장소 밖 폴더에 설치)
 *   node tools/lecture.js render <화면표.tsv> <mp3 폴더> [출력.mp4]   (기본 출력 = mp3 폴더/<화면표 이름>_강의.mp4)
 * 화면표 꼴: 한 줄 = 「파일명[+파일명]<탭>틀<탭>내용」 · 틀 = 제목·글머리·도식·코드·인용 (docs/규칙/출판.md 「🎓 강의 HTML 굽기」)
 */
const path = require('path');
const R = require('../core/lecture-render');

(async () => {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'status') { console.log(JSON.stringify(await R.status(), null, 2)); return; }
  if (cmd === 'setup') { const s = await R.setup({ onLine: console.log }); console.log(JSON.stringify(s, null, 2)); return; }
  if (cmd === 'render' && a && b) {
    const out = c || path.join(b, path.basename(a).replace(/\.(tsv|txt)$/i, '') + '_강의.mp4');
    let last = -1;
    const r = await R.render({ screenPath: a, audioDir: b, outFile: out, onLine: console.log,
      onProgress: (p) => { if (p && p.pct != null && p.pct >= last + 10) { last = p.pct; console.log('   ' + p.pct + '%'); } } });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  console.log('쓰는 법: node tools/lecture.js status | setup | render <화면표.tsv> <mp3 폴더> [출력.mp4]');
  process.exitCode = 2;
})().catch((e) => { console.error('❌ ' + e.message); process.exitCode = 1; });
