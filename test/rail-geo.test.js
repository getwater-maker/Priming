'use strict';
// node test/rail-geo.test.js — 그림 범위 선(RailLayer) 재기 보조(core/rail-geo · v0.9.114) — React #185(끝없는 다시 그리기) 막기
const fs = require('fs');
const path = require('path');
const { sameGeo, frameGuard } = require('../core/rail-geo');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const g = (o = {}) => ({ num: 1, from: 1, to: 3, gs: 1, ge: 3, has: true, live: false, top: 100, bot: 300, ownTop: 100, ownBot: 300, x: 40, ...o });

console.log('[1] sameGeo — 1~2px 흔들림은 같은 값');
ok(sameGeo([g()], [g()]), '같은 값');
ok(sameGeo([g()], [g({ top: 101, bot: 299, x: 41 })]), '1px 흔들림 = 같다(판정이 번갈아 바뀌며 돌던 것)');
ok(sameGeo([g()], [g({ bot: 302 })]) && !sameGeo([g()], [g({ bot: 303 })]), '2px 까지 같다 · 3px 부터 다르다');
ok(!sameGeo([g()], [g({ from: 2 })]) && !sameGeo([g()], [g({ num: 2 })]) && !sameGeo([g()], [g({ has: false })]) && !sameGeo([g()], [g({ live: true })]), '범위·번호·그림 유무·끌기 상태가 다르면 다르다');
ok(!sameGeo([g()], [g(), g({ num: 2 })]) && !sameGeo([g()], []) && sameGeo([], []), '그룹 수가 다르면 다르다');

console.log('[2] frameGuard — 한 프레임에 연달아 재는 횟수 제한');
{ const q = []; const gd = frameGuard((f) => q.push(f), 6);
  let n = 0; for (let i = 0; i < 50; i++) if (gd.allow()) n++;
  ok(n === 6, '한 프레임에 6번까지만 허용(50번 시도 → ' + n + ')');
  ok(q.length === 1, '프레임 끝 예약은 한 번만');
  q.shift()(); let m = 0; for (let i = 0; i < 50; i++) if (gd.allow()) m++;
  ok(m === 6, '다음 프레임이 되면 다시 6번 허용'); }
{ // 시뮬레이션: 잴 때마다 값이 번갈아 바뀌는 최악 — 가드가 없으면 끝없이, 있으면 프레임당 6번에서 멈춘다
  const q = []; const gd = frameGuard((f) => q.push(f), 6); let renders = 0, flip = 0;
  const layout = () => { if (!gd.allow()) return; renders++; flip ^= 1; /* 값이 바뀌었다고 치고 다시 그림 */ if (renders < 1000) layout(); };
  layout();
  ok(renders === 6, '번갈아 바뀌는 최악에도 한 프레임에 ' + renders + '번에서 멈춘다(React 한도 50 아래)'); }

console.log('[3] 소스 — RailLayer 가 두 보호를 쓴다');
{ const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8');
  const rl = app.slice(app.indexOf('function RailLayer('), app.indexOf('// 끌기 중 범위'));
  ok(/sameGeo\(prev, out\)/.test(rl) && /frameGuard\(/.test(rl) && !/useLayoutEffect\(measure\);/.test(rl), 'RailLayer: sameGeo + frameGuard · 가드 없는 useLayoutEffect(measure) 없음');
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'rail-geo.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  ok(!/require\.main|require\(['"](electron|fs|child_process)['"]\)/.test(src), '순수 모듈(렌더러 번들용)'); }

console.log(`\n${fail ? '❌' : '✅'} rail-geo — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
