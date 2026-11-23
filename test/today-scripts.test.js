'use strict';
// node test/today-scripts.test.js — 📅 오늘 작업할 대본 찾기(core/today-scripts · v0.9.85).
//   규칙: 채널마다 게시일 ≥ 오늘(KST) 중 아직 안 만든 가장 이른 날짜의 대본.
//   + main 의 「만들었다」 판정·IPC·렌더러 버튼이 이 모듈을 실제로 쓰는지 원문 대조.

const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../core/today-scripts');

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; } else { fail++; console.log('✗ ' + msg); } }

// [1] 날짜 읽기
ok(T.dateOf('[고전_1021] 지드의 좁은 문', '2026_10', '2026-10-20') === '2026-10-21', 'MMDD + 연월 폴더');
ok(T.dateOf('[서재_1023] 노생거 사원 4부', '노생거사원', '2026-10-20') === '2026-10-23', 'MMDD · 연월 폴더 없음 → 올해');
ok(T.dateOf('[고전_0105] 새해 대본', '', '2026-12-28') === '2027-01-05', '연말에 1월 대본 → 다음 해');
ok(T.dateOf('[고전_1230] 연말 대본', '', '2027-01-03') === '2026-12-30', '연초에 지난 12월 → 지난해');
ok(T.dateOf('2026-11-02 새 대본', '', '2026-10-20') === '2026-11-02', 'YYYY-MM-DD 꼴');
ok(T.dateOf('[역사_1340] 이상한 번호', '', '2026-10-20') === null, '13월 = 날짜 아님');
ok(T.dateOf('1909년 지드의 좁은 문', '', '2026-10-20') === null, '제목 속 연도 네 자리는 날짜로 보지 않는다');
ok(T.dateOf('대본', '', '2026-10-20') === null, '날짜 없는 이름');
ok(T.kstToday(Date.UTC(2026, 9, 20, 15, 30)) === '2026-10-21', 'KST 자정 넘김(UTC 15:30 = KST 00:30 다음 날)');

// [2] 고르기 — 안 만든 편 전부(v1.0.60 · 로이 「전부 보이게」 · 옛 「가장 이른 한 편」 폐기)
const F = (name, date) => ({ name, date, path: name + '.md' });
const files = [F('a1019', '2026-10-19'), F('a1022', '2026-10-22'), F('a1020', '2026-10-20'), F('a1021', '2026-10-21'), F('a1024', '2026-10-24')];
let r = T.pickNext(files, '2026-10-20', (f) => f.name === 'a1020' || f.name === 'a1021');
ok(r.picks.map((x) => x.name).join() === 'a1022,a1024', '오늘·내일 만들었으면 1022·1024 둘 다(게시일 순) — got ' + r.picks.map((x) => x.name));
ok(r.madeAhead === 2 && r.waiting === undefined, '미리 만듦 2 · 「대기」 칸은 없다');
r = T.pickNext(files, '2026-10-20', () => false);
ok(r.picks.map((x) => x.name).join() === 'a1020,a1021,a1022,a1024', '아무것도 안 만들었으면 오늘 이후 네 편 전부(어제 것은 지나감) — got ' + r.picks.map((x) => x.name));
r = T.pickNext(files, '2026-10-20', () => true);
ok(!r.picks.length && r.madeAhead === 4, '다 만들었으면 없음');
r = T.pickNext([F('b', '2026-10-21'), F('a', '2026-10-21'), F('c', '2026-10-22')], '2026-10-20', () => false);
ok(r.picks.map((x) => x.name).join() === 'a,b,c', '같은 날은 이름순 · 다음 날 것도 함께 — got ' + r.picks.map((x) => x.name));

// [3] 폴더 훑기 — `_폐기`·`.` 폴더 제외 · 하위 폴더 · 채널 여럿
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'today-scripts-'));
try {
  const w = (rel) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '# x\n'); return p; };
  w('고전/2026_10/[고전_1020] 오늘.md');
  w('고전/2026_10/[고전_1021] 내일.md');
  w('고전/2026_10/[고전_1022] 모레.md');
  w('고전/_폐기/[고전_1021] 버린 대본.md');
  w('고전/.git/[고전_1021] 숨김.md');
  w('고전/2026_10/메모.md');
  w('서재/노생거사원/[서재_1023] 4부.md');
  const files2 = T.scanFolder(path.join(root, '고전'), '2026-10-20');
  ok(files2.length === 3, '_폐기·숨김·날짜 없는 파일 제외 — got ' + files2.map((f) => f.name));
  const res = T.findToday([
    { name: '고전', folder: path.join(root, '고전') },
    { name: '서재', folder: path.join(root, '서재') },
    { name: '없는채널', folder: path.join(root, '없음') },
  ], (f) => /오늘/.test(f.name), '2026-10-20');
  const names = res.items.map((x) => x.channel + ':' + x.name);
  ok(names.join() === '고전:[고전_1021] 내일,고전:[고전_1022] 모레,서재:[서재_1023] 4부', '채널마다 안 만든 편 전부 · 게시일 순 — got ' + names);
  // 채널이 섞여도 게시일이 이른 편부터(⚡ 만들기가 큐 순서대로 만든다) · 같은 날은 채널 목록 순서
  w('서재/노생거사원/[서재_1021] 3부.md');
  const res2 = T.findToday([{ name: '고전', folder: path.join(root, '고전') }, { name: '서재', folder: path.join(root, '서재') }], (f) => /오늘/.test(f.name), '2026-10-20');
  ok(res2.items.map((x) => x.name).join() === '[고전_1021] 내일,[서재_1021] 3부,[고전_1022] 모레,[서재_1023] 4부', '채널이 섞여도 게시일 순 · 같은 날은 채널 순서 — got ' + res2.items.map((x) => x.name));
  ok(res2.items.every((x) => !('_ord' in x)), '정렬용 칸은 밖으로 나가지 않는다');
  ok(res.empty.length === 1 && res.empty[0].reason === '대본 폴더 없음', '폴더 없는 채널은 빈 칸 사유');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

// [4] 연결 — main·preload·렌더러 원문
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const PRE = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8');
ok(/ipcMain\.handle\('today-scripts-scan'/.test(MAIN) && /require\('\.\/core\/today-scripts'\)/.test(MAIN), 'main: today-scripts-scan 이 core/today-scripts 를 쓴다');
ok(/ipcMain\.handle\('open-scripts-list'/.test(MAIN), 'main: open-scripts-list');
ok(/function _scriptMade\b[\s\S]{0,600}\.vrew[\s\S]{0,300}uploadMp4Path[\s\S]{0,400}uploaded\.has/.test(MAIN) && /function _uploadedNames\b[\s\S]{0,300}uploadsFile\(\)/.test(MAIN), 'main: 만들었다 = .vrew · MP4 · 업로드 기록');
ok(/todayScriptsScan/.test(PRE) && /openScriptsList/.test(PRE), 'preload 두 입구');
ok(/data-testid="today-scripts"/.test(APP), '렌더러 📅 버튼');
// 여러 채널을 한 번에 여는 경로는 항목마다 자기 채널을 박는다(헤더 채널로 덮지 않는다)
ok(/open-scripts-list[\s\S]{0,1500}_channelItemSettings\(/.test(MAIN), 'open-scripts-list: 항목마다 그 채널 설정');

// [5] 📦 패키징 완료 판정(v1.0.55) — 패키징 파일 + 제목·설명글·태그·고정댓글·썸네일 문구 A + 🖼 썸네일 그림(v1.0.56)
const root5 = fs.mkdtempSync(path.join(os.tmpdir(), 'today-pack-'));
try {
  const ch = path.join(root5, '채널');
  const sp = (n) => { const p = path.join(ch, '대본', '2026_11', n + '.md'); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '# x\n'); return p; };
  const pk = (n, body) => { const p = path.join(ch, '패키징', '2026_11', n + '.md'); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); return p; };
  const TH = path.join(root5, '썸네일');   // ⚙ 썸네일 폴더 — 채널 폴더 한 단계 아래에 그림
  const img = (rel) => { const p = path.join(TH, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); };
  for (const k of ['1120', '1121', '1123', '1124']) img(`01_테스/[테스_${k}] 썸네일_A.png`);
  const O = { thumbRoot: TH };
  const FULL = '# t\n\n## 제목\n좋은 제목\n\n## 썸네일 문구 A\n| 줄 | 색 |\n|---|---|\n| 첫 줄 | 흰색 |\n\n## 설명글\n```\n설명입니다\n```\n\n## 태그\n```\n가, 나\n```\n\n## 고정댓글\n```\n댓글\n```\n';
  const a = sp('[테스_1120] 완료'); pk('[테스_1120] 완료', FULL);
  let s = T.packagingStatus(a, O);
  ok(s.ok && !s.missing.length && /패키징/.test(s.path), '다섯 칸이 다 있으면 완료 — ' + JSON.stringify(s.missing));
  const b = sp('[테스_1121] 앞쪽만'); pk('[테스_1121] 앞쪽만', '# t\n\n## 제목\n제목\n\n## 썸네일 문구 A\n첫 줄\n');
  s = T.packagingStatus(b, O);
  ok(!s.ok && s.missing.join() === '설명글,태그,고정댓글', '대본 전 단계(제목·썸네일만)는 미완 — ' + s.missing);
  const c = sp('[테스_1122] 없음');
  s = T.packagingStatus(c, O);
  ok(!s.ok && s.path === null && s.missing[0] === '패키징 파일', '패키징 파일 없음 = 미완');
  const d = sp('[테스_1123] 빈칸'); pk('[테스_1123] 빈칸', FULL.replace('```\n댓글\n```', '```\n```'));
  ok(T.packagingStatus(d, O).missing.join() === '고정댓글', '빈 고정댓글 = 미완(판정력)');
  const e = sp('[테스_1124] 썸네일없음'); pk('[테스_1124] 썸네일없음', FULL.replace(/## 썸네일 문구 A[\s\S]*?(?=## 설명글)/, ''));
  ok(T.packagingStatus(e, O).missing.join() === '썸네일 문구 A', '썸네일 문구 A 없음 = 미완');
  // 🖼 썸네일 그림
  const WITH_B = FULL + '\n## 썸네일 문구 B\n둘째 안\n';
  img('01_테스/[테스_1125] 썸네일_A.png');
  const f6 = sp('[테스_1125] B그림없음'); pk('[테스_1125] B그림없음', WITH_B);
  ok(T.packagingStatus(f6, O).missing.join() === '썸네일 그림 B', '문구 B 가 있는데 B 그림이 없으면 미완 — ' + T.packagingStatus(f6, O).missing);
  img('_보관/[테스_1125] 썸네일_B.png');
  ok(T.packagingStatus(f6, O).missing.join() === '썸네일 그림 B', '`_` 보관 폴더의 그림은 세지 않는다');
  img('01_테스/[테스_1125] 썸네일_B.jpg');
  ok(T.packagingStatus(f6, O).ok, 'B 그림(jpg)이 생기면 완료');
  const g = sp('[테스_1127] A그림없음'); pk('[테스_1127] A그림없음', FULL);
  ok(T.packagingStatus(g, O).missing.join() === '썸네일 그림 A', '패키징이 다 있어도 A 그림이 없으면 미완(판정력)');
  img('01_테스/[테스_11270] 썸네일_A.png');
  ok(T.packagingStatus(g, O).missing.join() === '썸네일 그림 A', '열쇠가 다른 그림([테스_11270])은 세지 않는다');
  ok(T.packagingStatus(a).missing.join() === '썸네일 폴더(⚙ 설정 → 📁 폴더)', '썸네일 폴더를 안 주면 미완(fail-closed)');
  ok(T.packagingStatus(a, { thumbRoot: path.join(root5, '없는폴더') }).missing.join() === '썸네일 폴더(⚙ 설정 → 📁 폴더)', '없는 썸네일 폴더 = 미완');
  const res = T.findToday([{ name: '테스', folder: path.join(ch, '대본') }], () => false, '2026-11-20', O);
  ok(res.items.length > 1 && res.items.every((x) => x.pack) && res.items[0].name === '[테스_1120] 완료' && res.items[0].pack.ok === true, 'findToday 항목마다 pack 이 실린다(안 만든 편 전부)');
  ok(res.items.some((x) => x.pack.ok) && res.items.some((x) => !x.pack.ok), '완료·미완이 한 목록에 함께 나온다(미완은 화면이 고를 수 없게)');
} finally { fs.rmSync(root5, { recursive: true, force: true }); }
// 연결 — main 이 큐에 넣기 전에 다시 막는다 · 화면은 pack.ok 로만 고르게 한다(다시 판정하지 않음)
ok(/open-scripts-list[\s\S]{0,1100}packagingStatus\(x\.path, \{ thumbRoot: thumbRoot\(\) \}\)[\s\S]{0,200}if \(!pk\.ok && !noPack\)[^\n]*continue/.test(MAIN) && /const noPack = !!args\.noPack;/.test(MAIN), 'main open-scripts-list: 패키징 미완이면 넣지 않는다(「패키징 없이도 넣기」를 켠 때만 넣는다 · v1.0.69)');
ok(/const todayPackOk = \(x\) => !!\(x && x\.pack && x\.pack\.ok\)/.test(APP) && /const todayUsable = \(tp, x\) => todayPackOk\(x\) \|\| !!\(tp && tp\.noPack\)/.test(APP) && /disabled=\{!use\}/.test(APP) && /tp\.sel\[x\.path\] && todayUsable\(tp, x\)/.test(APP) && /noPack: false, sel:/.test(APP), '화면: 미완은 고를 수 없고 넣을 때도 거른다(「패키징 없이도 넣기」 기본 꺼짐 · 켠 때만)');
ok(!/packagingStatus|findPackagingFile/.test(APP), '화면이 패키징을 따로 판정하지 않는다');
ok(/today-scripts-scan[\s\S]{0,900}findToday\([^\n]*\{ thumbRoot: thumbRoot\(\) \}\)/.test(MAIN), 'main 찾기도 썸네일 폴더를 넘긴다');

console.log(`today-scripts: ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
