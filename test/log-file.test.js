'use strict';
/**
 * test/log-file.test.js — 로그 파일 기록·보관(7일) 회귀 테스트
 *
 * 🔑 판정 로직을 main.js 원문에서 그대로 뽑아 실행한다(복사해 두면 앱과 갈라져도 통과해 버린다).
 * ⚠ 이 기능은 **파일을 지운다** — 날짜 경계(7일 보관/8일 삭제)와 KST 계산을 반드시 확인할 것.
 *   `toISOString()` 은 UTC 라 밤 시간대에 하루가 밀린다(전역 지침: 모든 날짜는 KST).
 *
 * 실행: node test/log-file.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const a = src.indexOf('const LOG_DIR = path.join(');
const b = src.indexOf('\n}\n', src.indexOf('function logToFile(line)', a)) + 3;
if (a < 0 || b < 3) { console.error('❌ main.js 에서 로그 블록을 못 찾음'); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logtest-'));
// LOG_DIR 만 테스트용으로 갈아끼운다(홈 폴더의 진짜 로그를 건드리면 안 된다).
const block = src.slice(a, b).replace(
  "const LOG_DIR = path.join(os.homedir(), '.shots-maker', 'logs');",
  'const LOG_DIR = TEST_DIR;');
const mod = { exports: {} };
new Function('fs', 'os', 'path', 'TEST_DIR', 'module',
  block + '\nmodule.exports={logToFile,_kstDayStr,_pruneOldLogs,LOG_DIR,LOG_KEEP_DAYS};')(fs, os, path, tmp, mod);
const M = mod.exports;

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };

// ① KST 날짜 — UTC 22:00(=KST 다음날 07:00)이면 '다음 날' 이 나와야 한다.
const utcNight = new Date(Date.UTC(2026, 7, 19, 22, 0, 0)); // 2026-08-19 22:00Z = KST 08-20 07:00
check('KST 환산 — UTC 밤은 다음 날짜', M._kstDayStr(utcNight) === '2026-08-20');
const utcMorning = new Date(Date.UTC(2026, 7, 19, 1, 0, 0)); // KST 같은 날 10:00
check('KST 환산 — UTC 새벽은 같은 날짜', M._kstDayStr(utcMorning) === '2026-08-19');

// ② 기록 — 오늘 파일이 생기고 줄이 들어간다.
M.logToFile('첫 줄 테스트');
M.logToFile('둘째 줄');
const today = M._kstDayStr();
const f = path.join(tmp, `${today}.log`);
// ⚠ createWriteStream 은 비동기다 — 바로 existsSync 하면 아직 없다(테스트 함정). 잠시 뒤 확인한다.
setTimeout(() => {
  check('오늘(KST) 날짜 파일 생성', fs.existsSync(f));
  const txt = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  check('두 줄 모두 기록', txt.includes('첫 줄 테스트') && txt.includes('둘째 줄'));
  check('시각(KST) 접두 붙음', /^\[\d{2}:\d{2}:\d{2}\] /m.test(txt));

  // ③ 보관 경계 — 7일 전은 남고, 8일 전은 지워진다.
  const day = (n) => M._kstDayStr(new Date(Date.now() - n * 86400 * 1000));
  const keep = path.join(tmp, `${day(6)}.log`);
  const edge = path.join(tmp, `${day(7)}.log`);
  const gone = path.join(tmp, `${day(8)}.log`);
  const other = path.join(tmp, 'not-a-log.txt');            // 날짜 형식이 아닌 파일은 건드리면 안 된다
  for (const x of [keep, edge, gone, other]) fs.writeFileSync(x, 'x');
  M._pruneOldLogs();
  check('6일 전 로그 보존', fs.existsSync(keep));
  check('7일 전 로그 보존(경계 포함)', fs.existsSync(edge));
  check('8일 전 로그 삭제', !fs.existsSync(gone));
  check('로그 아닌 파일은 그대로', fs.existsSync(other));
  check('오늘 로그는 그대로', fs.existsSync(f));

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exit(fail ? 1 : 0);
}, 300);
