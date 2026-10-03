'use strict';
/**
 * node test/smoke-isolation.test.js — E2E(PM_UI_SMOKE=1)가 로이의 큐 파일(~/.priming-maker/workspace*.json)을 덮지 않게 한 배선이 있는지.
 *   · main.js 가 큐·지난 큐·저장 폴더 경로를 workspaceDir() 한 곳에서 계산한다
 *   · PM_UI_SMOKE 일 때 임시 폴더, 아니면 ~/.priming-maker
 *   · 큐 파일 경로를 homedir 로 직접 쓰는 곳이 main.js 에 남아 있지 않다
 *   · 모든 Electron E2E 가 PM_UI_SMOKE 를 켠다(안 켠 E2E 는 로이 큐를 덮는다)
 */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
ok(/function workspaceDir\(\) \{ return process\.env\.PM_UI_SMOKE \? SMOKE_WS_DIR : path\.join\(os\.homedir\(\), '\.priming-maker'\); \}/.test(M), 'workspaceDir: 스모크면 임시 폴더');
ok(/function workspaceFile\(\) \{ return path\.join\(workspaceDir\(\), 'workspace\.json'\)/.test(M), 'workspace.json 은 workspaceDir');
ok(/function lastWorkspaceFile\(\) \{ return path\.join\(workspaceDir\(\), 'workspace\.last\.json'\)/.test(M), 'workspace.last.json 은 workspaceDir');
ok(/path\.join\(workspaceDir\(\), 'saves'\)/.test(M), '큐 저장 폴더도 workspaceDir');
ok(!/homedir\(\), '\.priming-maker', 'workspace/.test(M), "main.js 에 큐 파일 경로 직접 계산이 없다");
const bad = fs.readdirSync(__dirname).filter((f) => /\.js$/.test(f)).filter((f) => { const s = fs.readFileSync(path.join(__dirname, f), 'utf8'); return /_electron/.test(s) && !/PM_UI_SMOKE/.test(s); });
ok(bad.length === 0, 'PM_UI_SMOKE 를 켜지 않는 E2E 없음' + (bad.length ? ' — ' + bad.join(', ') : ''));
console.log(`\n${fail ? '❌' : '✅'} smoke-isolation — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
