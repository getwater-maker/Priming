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

// [2] 고르기
const F = (name, date) => ({ name, date, path: name + '.md' });
const files = [F('a1019', '2026-10-19'), F('a1020', '2026-10-20'), F('a1021', '2026-10-21'), F('a1022', '2026-10-22'), F('a1024', '2026-10-24')];
let r = T.pickNext(files, '2026-10-20', (f) => f.name === 'a1020' || f.name === 'a1021');
ok(r.picks.length === 1 && r.picks[0].name === 'a1022', '오늘·내일 만들었으면 1022 — got ' + r.picks.map((x) => x.name));
ok(r.waiting === 1 && r.madeAhead === 2, '대기 1 · 미리 만듦 2');
r = T.pickNext(files, '2026-10-20', () => false);
ok(r.picks[0].name === 'a1020', '아무것도 안 만들었으면 오늘 것(어제 것은 지나감)');
r = T.pickNext(files, '2026-10-20', () => true);
ok(!r.picks.length && r.madeAhead === 4, '다 만들었으면 없음');
r = T.pickNext([F('b', '2026-10-21'), F('a', '2026-10-21'), F('c', '2026-10-22')], '2026-10-20', () => false);
ok(r.picks.length === 2 && r.picks[0].name === 'a', '같은 날 두 편이면 둘 다(이름순)');

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
  ok(names.length === 2 && names.includes('고전:[고전_1021] 내일') && names.includes('서재:[서재_1023] 4부'), '채널마다 다음 편 — got ' + names);
  ok(res.items.find((x) => x.channel === '고전').waiting === 1, '고전 대기 1편');
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

console.log(`today-scripts: ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
