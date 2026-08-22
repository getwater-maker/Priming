'use strict';

/**
 * gpu-temp.js — 로컬 GPU(RTX 3060) 온도 기록 + 「몇 주 뒤 알림」 장치 (2026-08-22, 로이 요청)
 *
 * 왜: 장시간 큐(몇 시간) 작업에서 열이 걱정인데, 실측은 2026-07-22 한 번(84°C·150W)뿐이고
 *   그때 만든 온도 로거는 **돌지 않는 옛 서버 파일**에 심어져 한 번도 기록된 적이 없다.
 *   → 앱이 직접 기록한다(앱 코드라 라이트 업데이트로 두 PC 에 배포된다).
 *
 * 기록: 작업(절전 차단 withAwake)이 도는 동안만 60초마다 nvidia-smi 를 읽어
 *   ~/.shots-maker/logs/gpu_YYYY-MM-DD.csv (날짜 = KST) 에 한 줄씩 쌓는다. 90일 보관.
 *   ⚠ 반드시 **비동기 execFile** — execFileSync 는 메인 프로세스를 얼린다(v0.3.18 프리징 사고 계열).
 *   nvidia-smi 가 없는 PC(아내 PC 가 그럴 수 있음)는 첫 실패에서 조용히 멈춘다(로그 1줄).
 *
 * 알림(로이: "몇 주 데이터가 쌓이면 나에게도 알려줘 — 분명 잊어버릴 것 같아"):
 *   앱 시작 때 쌓인 날 수를 세서 **14일 이상이면 요약 팝업**(최고 온도·83°C 이상 비율·대책)을 1번 띄우고,
 *   그 뒤로는 30일마다 반복. 상태는 ~/.shots-maker/gpu-temp-report.json.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const LOG_DIR = () => path.join(os.homedir(), '.shots-maker', 'logs');
const STATE_FILE = () => path.join(os.homedir(), '.shots-maker', 'gpu-temp-report.json');
const KEEP_DAYS = 90;            // CSV 보관 일수
const SAMPLE_MS = 60 * 1000;     // 작업 중 60초마다 1줄
const REPORT_MIN_DAYS = 14;      // 이만큼 쌓이면 첫 리포트
const REPORT_EVERY_DAYS = 30;    // 그 뒤 반복 주기

// KST(UTC+9) — toISOString() 은 UTC 라 밤에 날짜가 하루 밀린다(전역 지침).
function _kst(ts = Date.now()) { return new Date(ts + 9 * 3600 * 1000); }
function kstDate(ts) { return _kst(ts).toISOString().slice(0, 10); }
function kstTime(ts) { return _kst(ts).toISOString().slice(11, 19); }

// nvidia-smi 한 줄 파싱: "68, 100, 148.32, 1770, 10123" → {temp,util,power,clock,mem}
function parseSmiLine(line) {
  const p = String(line || '').trim().split(',').map((x) => parseFloat(x));
  if (p.length < 5 || !Number.isFinite(p[0])) return null;
  return { temp: p[0], util: p[1], power: p[2], clock: p[3], mem: p[4] };
}

// GPU 1회 측정 — 실패하면 null (nvidia-smi 없음·드라이버 문제 등).
function sample(execFileFn = execFile) {
  return new Promise((resolve) => {
    try {
      execFileFn('nvidia-smi',
        ['--query-gpu=temperature.gpu,utilization.gpu,power.draw,clocks.sm,memory.used', '--format=csv,noheader,nounits'],
        { timeout: 8000, windowsHide: true },
        (err, stdout) => resolve(err ? null : parseSmiLine(String(stdout).split(/\r?\n/)[0])));
    } catch (_) { resolve(null); }
  });
}

function _csvPath(ts = Date.now()) { return path.join(LOG_DIR(), `gpu_${kstDate(ts)}.csv`); }

function appendRow(s, ts = Date.now()) {
  try {
    const f = _csvPath(ts);
    fs.mkdirSync(LOG_DIR(), { recursive: true });
    if (!fs.existsSync(f)) fs.writeFileSync(f, 'time,temp_c,util_pct,power_w,clock_mhz,mem_mib\n', 'utf8');
    fs.appendFileSync(f, `${kstTime(ts)},${s.temp},${s.util},${s.power},${s.clock},${s.mem}\n`, 'utf8');
  } catch (_) { /* 기록 실패로 작업을 막지 않는다 */ }
}

// ── 작업 중에만 도는 샘플러 (withAwake 참조 카운트에 연동) ─────────────────────
const ST = { timer: null, unavailable: false };
function startSampling(log = () => {}) {
  if (ST.timer || ST.unavailable) return;
  const tick = async () => {
    const s = await sample();
    if (!s) {
      // nvidia-smi 가 없거나 실패 — 이 실행에서는 다시 시도하지 않는다(헛돌기·로그 소음 방지).
      ST.unavailable = true; stopSampling();
      log('🌡 GPU 온도 기록 불가(nvidia-smi 응답 없음) — 이 PC 에서는 온도 기록을 건너뜁니다.');
      return;
    }
    appendRow(s);
    if (s.temp >= 87) log(`🌡 GPU ${s.temp}°C — 높습니다(스로틀 한계 93°C). 환기·팬 상태를 확인하세요.`);
  };
  ST.timer = setInterval(tick, SAMPLE_MS);
  tick();                                        // 시작 즉시 1회(짧은 작업도 최소 1줄 남게)
}
function stopSampling() { if (ST.timer) { clearInterval(ST.timer); ST.timer = null; } }

// 90일 넘은 gpu_*.csv 정리(앱 시작 때 1회).
function cleanupOld(now = Date.now()) {
  let n = 0;
  try {
    const cut = kstDate(now - KEEP_DAYS * 86400 * 1000);
    for (const f of fs.readdirSync(LOG_DIR())) {
      const m = /^gpu_(\d{4}-\d{2}-\d{2})\.csv$/.exec(f);
      if (m && m[1] < cut) { try { fs.unlinkSync(path.join(LOG_DIR(), f)); n++; } catch (_) {} }
    }
  } catch (_) {}
  return n;
}

// 쌓인 CSV 전체 통계 — {days, samples, maxTemp, maxTempAt, hot83Pct, hot87Pct, avgTemp}
function analyze(dir = LOG_DIR()) {
  const st = { days: 0, samples: 0, maxTemp: 0, maxTempAt: '', hot83: 0, hot87: 0, sum: 0 };
  try {
    for (const f of fs.readdirSync(dir).sort()) {
      const m = /^gpu_(\d{4}-\d{2}-\d{2})\.csv$/.exec(f);
      if (!m) continue;
      let dayHas = false;
      for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).slice(1)) {
        const c = line.split(',');
        const t = parseFloat(c[1]);
        if (!Number.isFinite(t)) continue;
        dayHas = true; st.samples++; st.sum += t;
        if (t > st.maxTemp) { st.maxTemp = t; st.maxTempAt = `${m[1]} ${c[0]}`; }
        if (t >= 83) st.hot83++;
        if (t >= 87) st.hot87++;
      }
      if (dayHas) st.days++;
    }
  } catch (_) {}
  return {
    days: st.days, samples: st.samples, maxTemp: st.maxTemp, maxTempAt: st.maxTempAt,
    avgTemp: st.samples ? Math.round(st.sum / st.samples * 10) / 10 : 0,
    hot83Pct: st.samples ? Math.round(st.hot83 / st.samples * 1000) / 10 : 0,
    hot87Pct: st.samples ? Math.round(st.hot87 / st.samples * 1000) / 10 : 0,
  };
}

// 리포트를 띄울 때가 됐나 — 14일치 이상 + (첫 리포트이거나 지난 리포트에서 30일 경과).
function reportDue(stats, state, now = Date.now()) {
  if (!stats || stats.days < REPORT_MIN_DAYS) return false;
  const last = state && Number(state.lastReportAt);
  if (!last) return true;
  return (now - last) >= REPORT_EVERY_DAYS * 86400 * 1000;
}

// 요약 + 대책(로이: "그때 대책도 준비해야 해") — 수치에 따라 권고가 갈린다.
function buildReportText(stats) {
  const L = [];
  L.push(`작업 중 GPU 온도를 ${stats.days}일 동안 ${stats.samples}회 기록했습니다.`);
  L.push('');
  L.push(`· 최고 온도: ${stats.maxTemp}°C (${stats.maxTempAt} KST)`);
  L.push(`· 평균 온도: ${stats.avgTemp}°C`);
  L.push(`· 83°C 이상(부스트 클럭 감소 시작): ${stats.hot83Pct}%`);
  L.push(`· 87°C 이상(주의 구간): ${stats.hot87Pct}%`);
  L.push('');
  if (stats.maxTemp >= 90 || stats.hot87Pct >= 10) {
    L.push('🔴 대책 필요: 90°C 근접 또는 87°C 이상이 잦습니다 (스로틀 한계 93°C).');
    L.push('  ① GPU 팬이 실제로 도는지 육안 확인(지난 실측에서 팬 0% 표시 — 미확인 상태)');
    L.push('  ② 케이스 옆판 열고 온도 변화 확인 → 차이가 크면 케이스 환기(흡기 팬) 보강');
    L.push('  ③ GPU 방열판 먼지 청소. 그래도 높으면 MSI Afterburner 로 팬 커브를 세게');
  } else if (stats.hot83Pct >= 20) {
    L.push('⚠ 주의: 작업 시간의 20% 이상이 83°C 를 넘습니다 — 성능이 조금씩 깎이는 구간입니다.');
    L.push('  여름철·장시간 큐 전에 케이스 환기와 먼지 상태를 점검해 두세요.');
  } else {
    L.push('✅ 양호: 온도가 안전 구간에 머뭅니다. 지금 환기 상태를 유지하면 됩니다.');
  }
  L.push('');
  L.push(`(기록: ~/.shots-maker/logs/gpu_날짜.csv · ${KEEP_DAYS}일 보관 · 다음 요약은 약 ${REPORT_EVERY_DAYS}일 뒤)`);
  return L.join('\n');
}

function _loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')); } catch (_) { return {}; } }
function _saveState(s) { try { fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true }); fs.writeFileSync(STATE_FILE(), JSON.stringify(s, null, 2), 'utf8'); } catch (_) {} }

/** 앱 시작 때 1회 — 데이터가 충분히 쌓였으면 요약을 팝업+로그로 알린다(로이가 잊어도 앱이 먼저 말한다). */
async function maybeReport({ showDialog, log = () => {}, now = Date.now() } = {}) {
  const stats = analyze();
  const state = _loadState();
  if (!reportDue(stats, state, now)) return { shown: false, stats };
  const text = buildReportText(stats);
  log('🌡 GPU 온도 요약 — ' + `${stats.days}일 · 최고 ${stats.maxTemp}°C · 83°C 이상 ${stats.hot83Pct}%`);
  for (const line of text.split('\n')) if (line.trim()) log('   ' + line);
  try { if (showDialog) await showDialog('🌡 GPU 온도 요약 (자동 알림)', text); } catch (_) {}
  _saveState({ ...state, lastReportAt: now, lastStats: stats });
  return { shown: true, stats };
}

module.exports = {
  sample, parseSmiLine, appendRow, startSampling, stopSampling,
  cleanupOld, analyze, reportDue, buildReportText, maybeReport,
  LOG_DIR, STATE_FILE, KEEP_DAYS, REPORT_MIN_DAYS, REPORT_EVERY_DAYS, _ST: ST,
};
