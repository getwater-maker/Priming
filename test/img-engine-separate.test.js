'use strict';
// Flow ↔ Genspark 완전 분리(로이 2026-10-02) — activeOrder 는 고른 엔진 하나만 돌려준다.
const fs = require('fs');
const path = require('path');
const Rot = require('../core/image-rotation');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

ok(eq(Rot.activeOrder('flow'), ['flow']), 'flow 를 고르면 flow 만');
ok(eq(Rot.activeOrder('genspark'), ['genspark']), 'genspark 를 고르면 genspark 만');
ok(eq(Rot.activeOrder('rotate'), ['genspark']), '옛 rotate 는 genspark 하나(헤더 이관 규칙과 같다)');
ok(eq(Rot.activeOrder(undefined), ['genspark']), '미지정도 genspark 하나');
// 판정력: 옛 코드는 두 엔진을 돌려줬다
ok(Rot.activeOrder('flow').length === 1 && Rot.activeOrder('genspark').length === 1, '어느 쪽이든 길이 1 — 이어받을 다음 엔진이 없다');
// main.js 가 순환 순서를 activeOrder 로만 정한다(다른 곳에서 두 엔진을 직접 잇지 않는다)
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
ok(/Rot\.activeOrder\(startEngine\)/.test(MAIN), 'runRotatingImages 가 activeOrder 를 쓴다');
ok(!/order\s*=\s*\[\s*'genspark'\s*,\s*'flow'\s*\]/.test(MAIN), "main.js 에 ['genspark','flow'] 직접 순서가 없다");
console.log(`\n${bad === 0 ? '✅' : '❌'} 이미지 엔진 분리: ${n - bad}/${n}`);
process.exit(bad ? 1 : 0);
