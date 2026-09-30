'use strict';
/**
 * node test/monitor-guard.test.js — 🌙 모니터 끄기 + 저절로 켜짐 감시(v0.5.83)
 *   main.js 의 MONITOR_OFF_PS **원문**을 꺼내 실제 PowerShell 로 돌린다. 🔑 화면을 끄지 않게 `Off` 만 빈 함수로 바꾸고
 *   감시 시간을 4초로 줄인다(나머지 — Add-Type · 커서 · 마지막 입력 · 566 이벤트 읽기 · 판정 — 는 원문 그대로).
 */
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const ps = (script) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 60000, windowsHide: true });

// 원문 추출 — const MONITOR_GUARD_SEC … MONITOR_OFF_PS = [ … ].join('\n');
const a = M.indexOf('const MONITOR_GUARD_SEC');
const b = M.indexOf("].join('\\n');", a) + "].join('\\n');".length;
ok(a > 0 && b > a, 'main.js 에서 MONITOR_OFF_PS 원문을 찾음');
const SRC = new Function(M.slice(a, b) + '\nreturn { MONITOR_OFF_PS, MONITOR_GUARD_SEC };')();
ok(SRC.MONITOR_GUARD_SEC >= 4 * 3600, '감시는 자는 동안 내내(6분 아님 — 137초·315초 뒤 켜짐이 실측)');
const S = SRC.MONITOR_OFF_PS;

console.log('\n[1] 판정 규칙(원문) — v0.5.102: 전원 기록(566) 새 켜짐을 본다');
ok(/-Id=566|Id=566/.test(S) && /RecordId/.test(S), '켜짐 감지 = Kernel-Power 566 의 RecordId(입력 시각 GetLastInputInfo 아님 — 137초 HID 켜짐은 입력 시각을 안 바꾼다)');
ok(!/GetLastInputInfo/.test(S), '입력 시각 API 를 더는 쓰지 않는다');
ok(/-ne '12'/.test(S), '끄기 기록(12)은 켜짐으로 치지 않는다');
ok(/if \(\$r -eq '31' -or \$c -ne \$c0\) \{ "WAKE/.test(S), '사람 = 키보드(31) 또는 커서 이동 → 그대로 둔다');
ok(/Off; \$n\+\+; "REOFF/.test(S), '그 밖(장치 신호 32 · 이유 불명 · 커서 그대로)은 다시 끈다 — 이유를 못 읽어도 사람으로 보지 않는다');
ok(/-lt 400\)/.test(S), '다시 끄기 상한 400회(무한 루프 방지)');
ok(/Start-Sleep -Milliseconds 800\nOff\n'OFF'/.test(S), '0.8초 뒤 끄고 곧바로 OFF 를 알린다(IPC 는 여기서 끝난다)');
ok(M.includes("if (line === 'OFF') {") && M.includes('finish({ ok: true });'), 'main: OFF 줄에서 버튼 응답(감시를 기다리지 않는다)');
ok(M.includes('try { if (_monGuard) _monGuard.kill(); } catch {}      // 🌙'), '앱 종료 때 감시를 끝낸다');
ok(!/execFileSync\([^)]*MONITOR/.test(M), '🔴 메인에서 동기 실행 안 함');

console.log('\n[2] 실제 PowerShell 실행 — Off 만 비우고 5초 감시');
const dry = S.replace(/^function Off \{.*\}$/m, 'function Off { }').replace(/-lt \d+ -and \$n/, '-lt 5 -and $n');
ok(dry !== S && /function Off \{ \}/.test(dry) && /-lt 5 -and/.test(dry), '화면을 끄지 않는 판(치환 확인)');
let out = '';
try { out = ps(dry); } catch (e) { out = 'ERR ' + (e.stderr || e.message); }
const lines = out.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
ok(lines[0] === 'OFF', `첫 줄 OFF (실제: ${lines[0]})`);
ok(lines[lines.length - 1] === 'END', `끝 줄 END — 컴파일·루프 정상 (실제: ${lines.slice(-2).join(' / ')})`);
ok(!lines.some((l) => /^REOFF/.test(l)), '가만히 두면 다시 끄지 않는다(새 켜짐 기록이 없다)');

console.log('\n[3] 함수 원문 — 커서 · 새 켜짐 기록 판정');
const head = S.slice(0, S.indexOf("$script:t0 = (Get-Date).AddSeconds(-5)"));
const probe = ps(head + [
  '',
  '$script:t0 = (Get-Date).AddDays(-3)',
  '"CUR=$(Cur)"',
  '"W0=$(NewWake 0)"',
  '$mx = [int64](MaxId)',
  '"MAX=$mx"',
  '"AFTER=$(NewWake $mx)"',
  '$script:t0 = (Get-Date).AddMinutes(1)',
  '"NONE=$(NewWake 0)"',
].join('\n'));
const cur = /CUR=(-?\d+),(-?\d+)/.exec(probe), w0 = /W0=(\d+),(\d+)/.exec(probe), mx = /MAX=(\d+)/.exec(probe), aft = /AFTER=(.*)/.exec(probe), none = /NONE=(.*)/.exec(probe);
ok(!!cur, `GetCursorPos (${cur && cur[0]})`);
ok(!!w0 && w0[2] !== '12', `최근 3일 566 에서 새 켜짐 기록을 읽음 (id ${w0 && w0[1]} · 이유 ${w0 && w0[2]} — 12 제외)`);
ok(!!mx && Number(mx[1]) >= Number(w0 && w0[1]), 'MaxId 는 가장 최근 기록 번호');
ok(!!aft && aft[1].trim() === '', '판정력: 이미 본 번호 이후엔 새 켜짐이 없다(같은 기록으로 다시 끄지 않는다)');
ok(!!none && none[1].trim() === '', '판정력: 기록이 없는 구간이면 빈 값(= 다시 끄지 않는다)');

console.log(`\n${fail ? '❌' : '✅'} monitor-guard ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
