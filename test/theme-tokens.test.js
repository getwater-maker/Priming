'use strict';
/**
 * node test/theme-tokens.test.js — 라이트/다크 토큰 짝 검사(Lab · Vrew 동일화 0·B단계)
 *   ① styles.css 가 쓰는 var(--bg|fg|bd-xxxxxx) 가 라이트(:root)·다크([data-theme=dark]) 양쪽에 정의돼 있다
 *   ② 라이트 토큰 값 = 이름의 16진 그대로(원래 색 보존 = 라이트로 되돌리면 예전 화면)
 *   ③ 기본 토큰(--bg·--card…)이 다크에도 모두 있다
 *   ④ 색 속성(background·color·border)에 16진을 다시 직접 쓰지 않는다(예외 = 영상 위 글자 등 아래 허용표)
 *   ⑤ index.html 은 data-theme 를 정하고 localStorage 'priming-theme' 로 바꿀 수 있다
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const css = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

const blocks = [...css.matchAll(/(^|\n)(:root(?:\[data-theme="dark"\](?:,:root\[data-theme="purple"\])?)?)\{([^}]*)\}/g)].map((m) => ({ sel: m[2], body: m[3] }));
const light = blocks.filter((b) => b.sel === ':root').map((b) => b.body).join('\n');
const dark = blocks.filter((b) => b.sel !== ':root').map((b) => b.body).join('\n');
const defs = (s) => new Map([...s.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const L = defs(light), D = defs(dark);

const used = new Set([...css.matchAll(/var\(--((?:bg|fg|bd)-[0-9a-f]{6})\b/g)].map((m) => m[1]));
const missL = [...used].filter((k) => !L.has(k)), missD = [...used].filter((k) => !D.has(k));
ok(used.size > 150, `사용 중인 색 토큰 ${used.size}개`);
ok(!missL.length, `① 라이트 정의 빠짐 0 ${missL.slice(0, 5)}`);
ok(!missD.length, `① 다크 정의 빠짐 0 ${missD.slice(0, 5)}`);
const bad = [...L].filter(([k, v]) => /^(bg|fg|bd)-[0-9a-f]{6}$/.test(k) && v.toLowerCase() !== '#' + k.slice(3));
ok(!bad.length, `② 라이트 값 = 원래 색 ${bad.slice(0, 3)}`);
const base = ['bg', 'card', 'accent', 'accent-d', 'strong', 'base', 'line', 'ok', 'warn', 'danger', 'hook', 'paper', 'paper-2', 'paper-3', 'line-2', 'muted', 'sky', 'sky-l', 'crimson', 'brown', 'gold', 'ok-d', 'blue'];
ok(base.every((k) => L.has(k) && D.has(k)), '③ 기본 토큰 라이트·다크 모두 정의');
ok(D.get('bg') !== L.get('bg') && D.get('card') !== L.get('card'), '③ 다크 값이 라이트와 실제로 다르다(판정력)');
// ④ :root 블록 밖의 색 속성 16진 — 허용표(영상 위 자막 흉내·검정 바탕 등)
const body = css.replace(/(^|\n):root(?:\[data-theme="(?:dark|purple)"\](?:,:root\[data-theme="purple"\])?)?\{[^}]*\}/g, '');
const left = [...body.matchAll(/(background[a-z-]*|color|border[a-z-]*|outline[a-z-]*|fill|stroke)\s*:\s*([^;{}]*#[0-9a-fA-F]{3,6}\b[^;{}]*)/g)].map((m) => m[0]);
console.log(`  · 남은 직접 색(속성 안) ${left.length}건`);
ok(left.length <= 10, '④ 색 속성의 직접 16진은 거의 없다(≤10)');
ok(/data-theme="light"/.test(html) && /localStorage\.getItem\('priming-theme'\)/.test(html) && (html.match(/priming-theme/g) || []).length === 1, '⑤ index.html 테마 속성 + 되돌리기 스위치 한 벌');
const pm = /:root\[data-theme="purple"\]\{([^}]*)\}/.exec(css.replace(/:root\[data-theme="dark"\],:root\[data-theme="purple"\]\{/g, ''));
const PU = pm ? defs(pm[1]) : new Map();
ok(PU.has('accent') && PU.get('accent') !== D.get('accent') && PU.get('bg') !== D.get('bg') && /purple/.test(html) && /purple: 'light'/.test(fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'App.jsx'), 'utf8')), '⑥ 보라 테마 — 다크 토큰 위에 색조만 덮고(accent·bg 가 다크와 다르다) index.html·화면 스위치가 안다');
console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
