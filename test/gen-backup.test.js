'use strict';
/**
 * node test/gen-backup.test.js — 🕘 세대별 백업(core/gen-backup) · 🩹 비정상 종료 감지(core/session-lock) · main 배선.
 *   · 10분 간격 · 같은 내용 건너뜀 · keep·용량 정리(최신 세대는 남김) · 쓰다 만 세대(.tmp)는 목록에 없음
 *   · 되살리기 = 지금 상태를 먼저 한 세대로 남기고 .md·작업본을 그 세대로 · 세대 이름 검사(경로 탈출 금지)
 *   · 잠금: 죽은 pid 가 남긴 잠금 = crashed · 살아 있는 pid = 아님 · end 는 자기 잠금만 지운다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const GB = require('../core/gen-backup');
const SL = require('../core/session-lock');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'genbk-'));
const root = path.join(T, 'history');
const sp = path.join(T, '대본_1021.md'), snap = path.join(T, '대본_1021.smproj.json');
const snapOf = (n) => JSON.stringify({ projects: [{ groups: [{ sentences: Array.from({ length: n }, (_, i) => ({ text: 's' + i })) }] }] });
fs.writeFileSync(sp, '# 첫판\n문장 하나.\n'); fs.writeFileSync(snap, snapOf(1));
const base = '대본_1021';
const t0 = Date.UTC(2026, 9, 21, 1, 0, 0);   // KST 10:00

console.log('[1] 세대 만들기 · 간격 · 같은 내용');
let r = GB.maybeBackup({ root, base, snapFile: snap, scriptPath: sp, reason: 'open', now: t0 });
ok(r.made && r.id === '20261021-100000-000', `첫 세대 이름 = KST 시각 (${r.id})`);
r = GB.maybeBackup({ root, base, snapFile: snap, scriptPath: sp, now: t0 + 60e3 });
ok(!r.made && r.why === 'gap', '10분 안 = 건너뜀');
r = GB.maybeBackup({ root, base, snapFile: snap, scriptPath: sp, now: t0 + 11 * 60e3 });
ok(!r.made && r.why === 'same', '내용이 같으면 10분이 지나도 건너뜀');
fs.writeFileSync(sp, '# 둘째판\n문장 둘.\n'); fs.writeFileSync(snap, snapOf(2));
r = GB.maybeBackup({ root, base, snapFile: snap, scriptPath: sp, now: t0 + 12 * 60e3 });
ok(r.made, '내용이 바뀌고 10분 지나면 새 세대');
let gens = GB.listGens(root, base);
ok(gens.length === 2 && gens[1].sentences === 2 && gens[0].reason === 'open', `목록 2세대 · 문장 수 · 이유 (${gens.map((g) => g.sentences).join(',')})`);
fs.mkdirSync(path.join(root, base, '.tmp-20261021-120000-000'), { recursive: true });
ok(GB.listGens(root, base).length === 2, '쓰다 만 .tmp 세대는 목록에 없다');

console.log('[2] 되살리기');
fs.writeFileSync(sp, '# 망가진 판\n'); fs.writeFileSync(snap, '{"broken":true}');
r = GB.restore({ root, base, id: gens[0].id, snapFile: snap, scriptPath: sp, now: t0 + 13 * 60e3 });
ok(fs.readFileSync(sp, 'utf8') === '# 첫판\n문장 하나.\n', '대본 .md 가 그 세대로 돌아왔다');
ok(JSON.parse(fs.readFileSync(snap, 'utf8')).projects[0].groups[0].sentences.length === 1, '작업본도 그 세대로');
gens = GB.listGens(root, base);
const pre = gens.find((g) => g.id === r.before);
ok(pre && pre.reason === 'before-restore' && fs.readFileSync(path.join(pre.dir, 'script.md'), 'utf8') === '# 망가진 판\n', '되살리기 전 상태가 한 세대로 남았다(간격 무시)');
let threw = false; try { GB.restore({ root, base, id: '../../etc', snapFile: snap, scriptPath: sp }); } catch { threw = true; }
ok(threw, '세대 이름이 이상하면 거부(경로 탈출 금지)');
ok(!fs.existsSync(sp + '.restore-tmp'), '임시 파일이 남지 않는다');

console.log('[3] 정리');
const b2 = '다른대본';
const sp2 = path.join(T, b2 + '.md');
for (let i = 0; i < 8; i++) { fs.writeFileSync(sp2, 'v' + i); GB.maybeBackup({ root, base: b2, scriptPath: sp2, now: t0 + i * 11 * 60e3, opts: { keep: 5 } }); }
gens = GB.listGens(root, b2);
ok(gens.length === 5 && fs.readFileSync(path.join(gens[4].dir, 'script.md'), 'utf8') === 'v7', `keep 5 — 오래된 것부터 지움 (${gens.length})`);
GB.prune(root, b2, { keep: 30, maxBytes: 1 });
ok(GB.listGens(root, b2).length === 1 && GB.listGens(root, base).length >= 1, '용량 넘침 — 대본마다 최신 세대만 남는다');
const all = GB.listAll(root);
ok(all.length === 2 && all[0].gens[0].at >= all[1].gens[0].at && all.every((x) => x.scriptPath), '화면 목록: 대본마다 · 최근 대본 먼저 · 대본 위치 포함');

console.log('[4] 비정상 종료 감지');
const lock = path.join(T, 'session.lock');
let b = SL.begin(lock, { version: '0.9.88' });
ok(!b.crashed, '잠금 없음 = 정상');
fs.writeFileSync(lock, JSON.stringify({ pid: 999999, version: '0.9.87' }));   // 죽은 pid
b = SL.begin(lock);
ok(b.crashed && b.prev.version === '0.9.87', '죽은 pid 의 잠금이 남았으면 = 비정상 종료');
ok(JSON.parse(fs.readFileSync(lock, 'utf8')).pid === process.pid, '새 잠금은 지금 pid');
fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid }));   // 살아 있는 다른 프로세스
ok(!SL.begin(lock).crashed, '살아 있는 pid = 비정상 아님(앱이 켜져 있다)');
fs.writeFileSync(lock, JSON.stringify({ pid: 999999 })); SL.end(lock);
ok(fs.existsSync(lock), 'end 는 남의 잠금을 지우지 않는다');
SL.begin(lock); SL.end(lock);
ok(!fs.existsSync(lock), 'end 는 자기 잠금을 지운다');

console.log('[5] main 배선');
const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const ws = M.slice(M.indexOf('function writeSnapshotSync'), M.indexOf('function writeSnapshotSync') + 900);
ok(ws.indexOf('_genBackup(') > ws.indexOf('fs.renameSync(tmp, file)'), '작업본 저장(rename) 뒤에 백업');
ok(/_genBackup\(scriptPath, null, 'open', \{ minGapMs: 0 \}\)/.test(M), '대본을 열 때 한 세대');
ok(/function historyRoot\(\) \{ return path\.join\(workspaceDir\(\), 'history'\); \}/.test(M), '백업 위치 = workspaceDir(E2E 는 TEMP)');
ok(/session-lock'\)\.begin\(sessionLockFile\(\)/.test(M) && /session-lock'\)\.end\(sessionLockFile\(\)\)/.test(M), '시작 잠금 · before-quit 해제');
const rh = M.slice(M.indexOf("ipcMain.handle('backup-restore'"), M.indexOf("ipcMain.handle('select-queue-item'"));
ok(rh.indexOf('_awake.n > 0') > 0 && rh.indexOf('_awake.n > 0') < rh.indexOf('GB.restore'), '되살리기: 작업 중이면 거부');
ok(rh.indexOf('clearTimeout(A.t)') > 0 && rh.indexOf('clearTimeout(A.t)') < rh.indexOf('GB.restore'), '되살리기: 밀린 자동저장을 먼저 끈다(되살린 작업본을 덮지 않게)');
ok(rh.indexOf('_openScriptEntries') > rh.indexOf('GB.restore'), '되살린 뒤 같은 열기 길로 다시 연다');

try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
