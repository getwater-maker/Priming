/**
 * 🌡 GPU 온도 기록·알림 검증 (2026-08-22 신설) — core/gpu-temp.js 원문 함수를 실행한다.
 *   USERPROFILE 을 임시 폴더로 갈아끼워 실제 ~/.shots-maker 를 건드리지 않는다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let ok = 0, fail = 0;
const chk = (c, label, extra) => { if (c) { ok++; console.log('  OK   ' + label); } else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); } };

const REAL_HOME = os.homedir();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gputemp-'));
process.env.USERPROFILE = TMP; process.env.HOME = TMP;
delete require.cache[require.resolve('../core/gpu-temp')];
const GT = require('../core/gpu-temp');

(async () => {
  console.log('\n[1] nvidia-smi 파싱');
  chk(JSON.stringify(GT.parseSmiLine('68, 100, 148.32, 1770, 10123')) === JSON.stringify({ temp: 68, util: 100, power: 148.32, clock: 1770, mem: 10123 }), '정상 줄 파싱');
  chk(GT.parseSmiLine('') === null && GT.parseSmiLine('N/A, x') === null, '깨진 줄 = null');
  const s1 = await GT.sample((cmd, args, opt, cb) => cb(null, '71, 95, 140.0, 1700, 9000\n'));
  chk(s1 && s1.temp === 71, 'sample(주입 exec) — stdout 파싱');
  const s2 = await GT.sample((cmd, args, opt, cb) => cb(new Error('없음')));
  chk(s2 === null, 'sample — 실패는 null(던지지 않음)');

  console.log('\n[2] CSV 기록·통계 (임시 홈 격리)');
  chk(GT.LOG_DIR().startsWith(TMP), '격리 확인 — 임시 홈을 쓴다', GT.LOG_DIR());
  const dir = GT.LOG_DIR();
  fs.mkdirSync(dir, { recursive: true });
  // 3일치 합성 데이터: 온도 70×8 / 84×1 / 91×1 (총 10샘플)
  fs.writeFileSync(path.join(dir, 'gpu_2026-08-01.csv'), 'time,temp_c,util_pct,power_w,clock_mhz,mem_mib\n'
    + '10:00:00,70,100,150,1700,9000\n10:01:00,70,100,150,1700,9000\n10:02:00,70,100,150,1700,9000\n10:03:00,84,100,150,1700,9000\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'gpu_2026-08-02.csv'), 'time,temp_c,util_pct,power_w,clock_mhz,mem_mib\n'
    + '11:00:00,70,100,150,1700,9000\n11:01:00,70,100,150,1700,9000\n11:02:00,91,100,150,1700,9000\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'gpu_2026-08-03.csv'), 'time,temp_c,util_pct,power_w,clock_mhz,mem_mib\n'
    + '12:00:00,70,100,150,1700,9000\n12:01:00,70,100,150,1700,9000\n12:02:00,70,100,150,1700,9000\n', 'utf8');
  let st = GT.analyze();
  chk(st.days === 3 && st.samples === 10, `날 수 3 · 샘플 10 (실제 ${st.days}·${st.samples})`);
  chk(st.maxTemp === 91 && st.maxTempAt === '2026-08-02 11:02:00', '최고 온도와 시각(KST)', st.maxTempAt);
  chk(st.hot83Pct === 20 && st.hot87Pct === 10, '83°C 이상 20% · 87°C 이상 10%', st);
  GT.appendRow({ temp: 75, util: 90, power: 140, clock: 1650, mem: 8800 });
  st = GT.analyze();
  chk(st.samples === 11, 'appendRow 가 오늘 CSV 에 1줄 추가(헤더 자동)', st.samples);

  console.log('\n[3] 보관 정리(90일)');
  const now = Date.parse('2026-10-01T03:00:00Z');   // 기준: 2026-07-01=92일 전(삭제) · 2026-08-03=59일 전(보존)
  fs.writeFileSync(path.join(dir, 'gpu_2026-07-01.csv'), 'time,temp_c\n01:00:00,70\n', 'utf8');
  fs.writeFileSync(path.join(dir, '2026-08-01.log'), 'x', 'utf8');                               // 일반 로그 — 무관
  const n = GT.cleanupOld(now);
  chk(!fs.existsSync(path.join(dir, 'gpu_2026-07-01.csv')), '90일 넘은 gpu CSV 삭제', n);
  chk(fs.existsSync(path.join(dir, 'gpu_2026-08-03.csv')), '90일 안쪽은 보존');
  chk(fs.existsSync(path.join(dir, '2026-08-01.log')), 'gpu_ 접두가 아닌 로그 파일은 건드리지 않는다');

  console.log('\n[4] 알림 판정(14일 축적 · 30일 반복)');
  const mk = (days) => ({ days, samples: days * 10, maxTemp: 80, hot83Pct: 0, hot87Pct: 0 });
  chk(GT.reportDue(mk(13), {}) === false, '13일치 = 아직 조용');
  chk(GT.reportDue(mk(14), {}) === true, '14일치 + 첫 리포트 = 알림');
  const NOW = Date.now();
  chk(GT.reportDue(mk(20), { lastReportAt: NOW - 10 * 86400e3 }, NOW) === false, '지난 알림 10일 전 = 조용');
  chk(GT.reportDue(mk(20), { lastReportAt: NOW - 31 * 86400e3 }, NOW) === true, '지난 알림 31일 전 = 다시 알림');

  console.log('\n[5] 리포트 문구 — 수치에 따라 대책이 갈린다');
  const good = GT.buildReportText({ days: 20, samples: 500, maxTemp: 79, maxTempAt: 'x', avgTemp: 72, hot83Pct: 2, hot87Pct: 0 });
  chk(good.includes('✅ 양호'), '안전 구간 = 양호');
  const warn = GT.buildReportText({ days: 20, samples: 500, maxTemp: 85, maxTempAt: 'x', avgTemp: 80, hot83Pct: 30, hot87Pct: 3 });
  chk(warn.includes('⚠ 주의'), '83°C 이상 20%+ = 주의');
  const bad = GT.buildReportText({ days: 20, samples: 500, maxTemp: 91, maxTempAt: 'x', avgTemp: 82, hot83Pct: 40, hot87Pct: 15 });
  chk(bad.includes('🔴 대책 필요') && bad.includes('팬'), '90°C 근접 = 대책(팬·환기·청소) 안내');

  console.log('\n[6] maybeReport — 팝업 1회 + 상태 기록(30일 잠금)');
  {
    let shown = 0;
    const r1 = await GT.maybeReport({ showDialog: async () => { shown++; }, log: () => {}, now: NOW });
    chk(r1.shown === false && shown === 0, '데이터 3일치뿐 → 알림 없음(14일 미만)');
    // 14일치로 불려서 다시
    for (let d = 4; d <= 15; d++) {
      fs.writeFileSync(path.join(dir, `gpu_2026-08-${String(d).padStart(2, '0')}.csv`), 'time,temp_c\n01:00:00,70\n', 'utf8');
    }
    const r2 = await GT.maybeReport({ showDialog: async () => { shown++; }, log: () => {}, now: NOW });
    chk(r2.shown === true && shown === 1, '14일치 축적 → 팝업 1회');
    const r3 = await GT.maybeReport({ showDialog: async () => { shown++; }, log: () => {}, now: NOW + 86400e3 });
    chk(r3.shown === false && shown === 1, '다음 날엔 반복 안 함(30일 잠금)');
    chk(fs.existsSync(GT.STATE_FILE()), '상태 파일 기록됨');
  }

  console.log('\n[7] 샘플러 수명 + main.js 배선(원문 대조)');
  {
    GT.startSampling(() => {});
    const t1 = GT._ST.timer;
    GT.startSampling(() => {});
    chk(GT._ST.timer === t1, '이중 시작해도 타이머 1개');
    GT.stopSampling();
    chk(GT._ST.timer === null, 'stop 으로 정지');
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
    chk(/if \(_awake\.n === 1\) \{ try \{ require\('\.\/core\/gpu-temp'\)\.startSampling\(log\); \} catch \{\} \}/.test(SRC), '작업 시작(절전 차단 1번째)에 기록 시작');
    chk(/if \(_awake\.n === 0\) \{ try \{ require\('\.\/core\/gpu-temp'\)\.stopSampling\(\); \} catch \{\} \}/.test(SRC), '마지막 작업이 끝나면 기록 정지');
    chk(/GT\.maybeReport\(/.test(SRC) && /GT\.cleanupOld\(\)/.test(SRC), '앱 시작 때 정리 + 알림 판정');
    const GSRC = fs.readFileSync(path.join(__dirname, '..', 'core', 'gpu-temp.js'), 'utf8');
    chk(/const \{ execFile \} = require\('child_process'\)/.test(GSRC) && !/execFileSync\(/.test(GSRC), '비동기 execFile 만 사용(동기 호출 = 프리징 사고 계열)');
  }

  process.env.USERPROFILE = REAL_HOME; process.env.HOME = REAL_HOME;
  console.log(`\n결과: ${ok} OK / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
