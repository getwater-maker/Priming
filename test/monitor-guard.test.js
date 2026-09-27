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
ok(SRC.MONITOR_GUARD_SEC === 360, '감시 6분');
const S = SRC.MONITOR_OFF_PS;

console.log('\n[1] 판정 규칙(원문)');
ok(/if \(\$c -eq \$c0 -and \$r -eq '32'\) \{ Off;/.test(S), '다시 끄기 = 커서 그대로 AND 이유 InputHid(32) 둘 다');
ok(/-and \$n -lt 3\)/.test(S), '다시 끄기는 최대 3번');
ok(/\$r -ne '12'/.test(S), '끄기 이벤트(12)는 켜진 이유로 치지 않는다');
ok(/catch \{\}; Start-Sleep -Milliseconds 250 \}; return '' \}/.test(S), '이벤트를 못 읽으면 빈 이유 → 다시 끄지 않음(fail-open)');
ok(/Start-Sleep -Milliseconds 800\nOff\n'OFF'/.test(S), '0.8초 뒤 끄고 곧바로 OFF 를 알린다(IPC 는 여기서 끝난다)');
ok(M.includes("if (line === 'OFF') {") && M.includes('finish({ ok: true });'), 'main: OFF 줄에서 버튼 응답(6분 감시를 기다리지 않는다)');
ok(M.includes('try { if (_monGuard) _monGuard.kill(); } catch {}      // 🌙'), '앱 종료 때 감시를 끝낸다');
ok(!/execFileSync\([^)]*MONITOR/.test(M), '🔴 메인에서 동기 실행 안 함');

console.log('\n[2] 실제 PowerShell 실행 — Off 만 비우고 4초 감시');
const dry = S.replace(/^function Off \{.*\}$/m, 'function Off { }').replace('-lt 360 -and', '-lt 4 -and');
ok(dry !== S && /function Off \{ \}/.test(dry) && /-lt 4 -and/.test(dry), '화면을 끄지 않는 판(치환 확인)');
let out = '';
try { out = ps(dry); } catch (e) { out = 'ERR ' + (e.stderr || e.message); }
const lines = out.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
ok(lines[0] === 'OFF', `첫 줄 OFF (실제: ${lines[0]})`);
ok(lines[lines.length - 1] === 'END', `끝 줄 END — 컴파일·루프 정상 (실제: ${lines.slice(-2).join(' / ')})`);
ok(!lines.some((l) => /^REOFF/.test(l)), '가만히 두면(또는 사람이 움직이면) 다시 끄지 않는다');

console.log('\n[3] 함수 원문 — 커서 · 마지막 입력 · 켜진 이유');
const head = S.slice(0, S.indexOf('Start-Sleep -Milliseconds 800'));
const probe = ps(head + "\n\"CUR=$(Cur)\"\n\"LAST=$(Last)\"\n\"WR=$(WakeReason (Get-Date).AddDays(-3))\"\n\"NONE=$(WakeReason (Get-Date).AddMinutes(5))\"");
const cur = /CUR=(-?\d+),(-?\d+)/.exec(probe), last = /LAST=(\d+)/.exec(probe), wr = /WR=(\S*)/.exec(probe), none = /NONE=(\S*)/.exec(probe);
ok(!!cur, `GetCursorPos (${cur && cur[0]})`);
ok(!!last && Number(last[1]) > 0, 'GetLastInputInfo 값');
ok(!!wr && /^\d+$/.test(wr[1]) && wr[1] !== '12', `최근 3일 566 에서 켜진 이유를 읽음 (${wr && wr[1]} — 12 제외)`);
ok(!!none && none[1] === '', '판정력: 이벤트가 없는 구간이면 빈 이유(= 다시 끄지 않음)');

console.log(`\n${fail ? '❌' : '✅'} monitor-guard ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
