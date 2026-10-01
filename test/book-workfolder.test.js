'use strict';
/** node test/book-workfolder.test.js — 📁 작품 단위 폴더: 표지파일 메타·자동 후보·완성 폴더 출력 */
const fs = require('fs'), path = require('path'), os = require('os');
const WF = require('../core/book/work-folder');
const { parseBookText } = require('../core/parsers/book-parser');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-'));
const W = path.join(root, '삼국지');
for (const d of ['원고', '표지', '완성']) fs.mkdirSync(path.join(W, d), { recursive: true });
const ms = path.join(W, '원고', '제001회.md'); fs.writeFileSync(ms, '# t\n');
const touch = (f) => { fs.writeFileSync(path.join(W, '표지', f), 'x'); return path.join(W, '표지', f); };

console.log('\n[1] 메타 `> 표지파일:` 파싱');
ok(parseBookText('# t\n> 표지파일: ../표지/a.png\n', 'x').meta.coverFile === '../표지/a.png', '메타 표지파일 → meta.coverFile');
ok(parseBookText('# t\n> 표지 파일: ../표지/a.png\n', 'x').meta.coverFile === '../표지/a.png', '띄어쓴 「표지 파일」도');

console.log('\n[2] 표지 해석 우선순위');
const a = touch('삼국지_제1권_표지.png');
let r = WF.resolveCoverFile({ meta: { coverFile: '../표지/삼국지_제1권_표지.png' }, scriptPath: ms });
ok(r.source === 'meta' && r.path === a, '메타 상대경로 = 원고 파일 기준으로 해석');
r = WF.resolveCoverFile({ meta: { coverFile: a }, scriptPath: ms });
ok(r.source === 'meta' && r.path === a, '절대경로도 허용');
r = WF.resolveCoverFile({ meta: { coverFile: '../표지/없음.png' }, scriptPath: ms });
ok(!r.path && /찾을 수 없/.test(r.warn), '메타 파일이 없으면 다른 걸 몰래 쓰지 않고 경고(자동 후보가 있어도)');
r = WF.resolveCoverFile({ meta: { coverFile: '../표지/없음.png' }, scriptPath: ms, manual: a });
ok(r.source === 'manual' && r.path === a && r.warn, '메타가 깨졌어도 수동 첨부는 살린다 + 경고');
r = WF.resolveCoverFile({ meta: {}, scriptPath: ms });
ok(!r.path, '자동 후보는 「표지」로 시작하는 파일만 — 삼국지_제1권_표지.png 는 후보 아님(판별)');
const b = touch('표지.png');
r = WF.resolveCoverFile({ meta: {}, scriptPath: ms });
ok(r.source === 'auto' && r.path === b, '표지*.png 정확히 하나 → 자동 후보');
touch('표지_시안.png');
r = WF.resolveCoverFile({ meta: {}, scriptPath: ms });
ok(r.source === 'auto' && r.path === b, '「시안」 파일은 후보에서 제외');
touch('표지_본.jpg');
r = WF.resolveCoverFile({ meta: {}, scriptPath: ms });
ok(!r.path && /후보가 2개/.test(r.warn), '후보 둘 이상 → 고르지 않고 알림');
touch('표지.pdf');   // pdf 는 후보 아님 — 위 2개 그대로
ok(/2개/.test(WF.resolveCoverFile({ meta: {}, scriptPath: ms }).warn), 'pdf 는 후보에서 제외');
r = WF.resolveCoverFile({ meta: {}, scriptPath: ms, manual: a });
ok(r.source === 'manual' && r.path === a, '메타 없으면 수동 첨부가 자동 후보보다 먼저');
const other = path.join(root, '다른', 'x.md'); fs.mkdirSync(path.dirname(other), { recursive: true }); fs.writeFileSync(other, '# t');
ok(!WF.resolveCoverFile({ meta: {}, scriptPath: other }).path, '「원고」 폴더 밖 원고는 자동 후보를 쓰지 않는다');

console.log('\n[3] 완성 폴더');
ok(WF.finishedDirFor(ms) === path.join(W, '완성'), '작품/원고/x.md → 작품/완성');
ok(WF.finishedDirFor(other) === null && WF.finishedDirFor('') === null, '「원고」 폴더가 아니면 null(기존 outputFolder 규칙)');
ok(WF.finishedDirFor(path.join(W, '원고', '하위', 'x.md')) === null, '원고 바로 아래 파일만(하위 폴더는 아님)');

console.log('\n[4] main 배선');
const M = R('main.js');
ok(/function bookOutRoot\(scriptPath, preset, realScriptPath\)/.test(M) && /finishedDirFor\(realScriptPath\)/.test(M), 'bookOutRoot: 실제 원고 경로로 완성 폴더 판정');
ok((M.match(/bookOutRoot\(folderKey \+ '\.md', [^)]*, (sorted\[0\]|paths\[0\])\)/g) || []).length === 2, '열기·작업 이력 복원 두 곳 모두 실제 경로를 넘긴다');
ok((M.match(/attachWorkCover\(/g) || []).length === 3, 'attachWorkCover: 정의 1 + 열기·복원 호출 2');
ok(/coverCheckFor\(parsed, dim\.w/.test(M), '자동 첨부도 같은 coverCheckFor(R11 날개 판정)');
fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${fail ? '❌' : '✅'} book-workfolder — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
