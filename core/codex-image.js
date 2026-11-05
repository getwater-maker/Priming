'use strict';
/**
 * codex-image.js — 🎨 그림 엔진 「코덱스」(2.0 덧붙임3 ㉞~㊶ · v1.0.33) — 구독 로그인 + 내장 그림 도구(image_gen.imagegen)만.
 *
 *   한 장 = `codex exec --json --skip-git-repo-check -s read-only -C <빈 작업 폴더> -` 한 번(지시문은 stdin)
 *     → thread.started 의 id → `~\.codex\generated_images\<id>\*.png` 를 **복사**(그 폴더는 읽기만 · 지우거나 옮기지 않는다)
 *     → `~\.codex\sessions\…\*<id>.jsonl` 의 token_count.rate_limits(주간 used_percent · 창 · 초기화 · plan_type · credits)를 읽는다.
 *   🔴 실행 전 확인 셋(preflight) — 하나라도 어긋나면 코덱스 호출 0:
 *     ① auth.json auth_mode = chatgpt ② auth.json 의 API 키 칸이 비어 있음 ③ OPENAI_API_KEY · CODEX_API_KEY 가 프로세스 · 사용자 · 시스템 어디에도 없음
 *     + 최근 기록의 credits.has_credits 가 true 면 멈춤(한도를 넘으면 돈이 나간다) · ⛔ 스킬의 API 폴백 스크립트(그림 API)를 부르지 않는다 · ⛔ 로그인·업데이트·설정 바꾸기 없음
 *   실행 파일 = `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe` 중 **파일이 있고 `--version` 이 답하는 것** · 여럿이면 판이 높은 것(폴더 이름을 박지 않는다).
 *   ⚠ main 전용(렌더러 번들에서 import 하지 않는다).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const ENGINE = 'codex:imagegen';
const CONC_DEFAULT = 4, CONC_MAX = 6;
const CAP_DEFAULT = 60;
const TIMEOUT_MS = 15 * 60 * 1000;
// ㊵ 지시문 꼬리 — 코덱스의 버릇 셋(장식을 더함 · 밤을 밝게 · 개수를 틀림)을 막는다. 지시문 뒤에 붙이기만(바꾸지 않음)
const TAIL = 'Add nothing that the description does not ask for (no extra decorations such as flower vines, oil lamps or distant castles). If the scene is at night, keep it genuinely dark. Draw exactly the number of objects the description states.';

const codexHome = () => process.env.PM_CODEX_HOME || path.join(os.homedir(), '.codex');   // PM_CODEX_HOME = 시험용(가짜 기록)
const binRoot = () => process.env.PM_CODEX_BIN_ROOT || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');

function withTail(prompt) { const p = String(prompt || '').trim().replace(/\s+$/, ''); return /[.!?。]$/.test(p) ? `${p} ${TAIL}` : `${p}. ${TAIL}`; }

/** 판 비교 — "0.166.0-alpha.6" 꼴(숫자 마디 → 꼬리 숫자) */
function verKey(v) {
  const m = /(\d+)\.(\d+)\.(\d+)(?:-[a-z]*\.?(\d+))?/i.exec(String(v || ''));
  if (!m) return [-1];
  return [+m[1], +m[2], +m[3], m[4] == null ? 1e9 : +m[4]];   // 꼬리 없는 정식판이 alpha 보다 높다
}
function cmpVer(a, b) { const x = verKey(a), y = verKey(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; }

function runQuiet(exe, args, ms = 15000) {
  return new Promise((res) => {
    execFile(exe, args, { windowsHide: true, timeout: ms, encoding: 'utf8' }, (e, out, err) => res({ ok: !e, out: String(out || ''), err: String(err || (e && e.message) || '') }));
  });
}

/** 실행 파일 찾기 → { exe, version, tried:[{dir, exe?, version?, why?}] } | { exe:null, tried } */
async function findCodex() {
  // 🧪 시험 전용 — PM_CODEX_FAKE = 가짜 코덱스 스크립트(test/fixtures/fake-codex.js) · 진짜 코덱스·할당량을 쓰지 않는다
  if (process.env.PM_CODEX_FAKE) return { exe: process.env.PM_CODEX_NODE || 'node', prefixArgs: [process.env.PM_CODEX_FAKE], version: '0.0.1-fake', tried: [{ dir: 'fake', version: '0.0.1-fake' }] };
  const root = binRoot(), tried = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (_) { return { exe: null, version: null, tried: [{ dir: root, why: '폴더 없음' }] }; }
  for (const d of dirs) {
    const exe = path.join(root, d, 'codex.exe');
    if (!fs.existsSync(exe)) { tried.push({ dir: d, why: 'codex.exe 없음' }); continue; }
    const r = await runQuiet(exe, ['--version']);
    const m = /codex[-\w]*\s+(\S+)/i.exec(r.out);
    if (!r.ok || !m) { tried.push({ dir: d, exe, why: '--version 이 답하지 않음' }); continue; }
    tried.push({ dir: d, exe, version: m[1] });
  }
  const okL = tried.filter((t) => t.version).sort((a, b) => cmpVer(b.version, a.version));
  return okL.length ? { exe: okL[0].exe, version: okL[0].version, tried } : { exe: null, version: null, tried };
}

/** 윈도우 사용자·시스템 환경 변수(레지스트리)에 그 이름이 있나 — 있으면 값 대신 true(값은 읽어도 내보내지 않는다) */
async function regHas(scope, name) {
  if (process.platform !== 'win32') return false;
  if (process.env.PM_CODEX_REG_FAKE) { try { const f = JSON.parse(process.env.PM_CODEX_REG_FAKE); return !!(f[scope] && f[scope][name]); } catch (_) { return false; } }
  const key = scope === 'user' ? 'HKCU\\Environment' : 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
  const r = await runQuiet('reg', ['query', key, '/v', name], 8000);
  return r.ok && new RegExp('\\b' + name + '\\b\\s+REG_\\w+\\s+\\S').test(r.out);
}

/**
 * 🔴 실행 전 확인 셋 → { ok, why, checks:{ authMode, authKeyEmpty, envEmpty:{process,user,system}, hasCredits } }
 *   env = 검사할 프로세스 환경(기본 process.env — 시험 ㄴ′ 은 가짜 키를 넣은 env 로)
 */
async function preflight({ env = process.env, usageNow = null } = {}) {
  const checks = { authMode: null, authKeyEmpty: null, envEmpty: { process: null, user: null, system: null }, hasCredits: null };
  let auth = null;
  try { auth = JSON.parse(fs.readFileSync(path.join(codexHome(), 'auth.json'), 'utf8')); } catch (_) {}
  checks.authMode = auth ? (auth.auth_mode || null) : null;
  const k = auth ? (auth.OPENAI_API_KEY != null ? auth.OPENAI_API_KEY : auth.api_key) : null;
  checks.authKeyEmpty = !(k != null && String(k).trim());
  const names = ['OPENAI_API_KEY', 'CODEX_API_KEY'];
  checks.envEmpty.process = names.every((n) => !(env[n] && String(env[n]).trim()));
  checks.envEmpty.user = !(await Promise.all(names.map((n) => regHas('user', n)))).some(Boolean);
  checks.envEmpty.system = !(await Promise.all(names.map((n) => regHas('system', n)))).some(Boolean);
  const u = usageNow || latestUsage();
  checks.hasCredits = u ? !!u.hasCredits : null;
  let why = '';
  if (checks.authMode !== 'chatgpt') why = `코덱스 인증이 구독 로그인이 아닙니다(auth_mode = ${checks.authMode || '없음'})`;
  else if (!checks.authKeyEmpty) why = '코덱스 auth.json 에 API 키가 들어 있습니다';
  else if (!checks.envEmpty.process) why = 'OPENAI_API_KEY · CODEX_API_KEY 가 이 프로세스 환경에 있습니다';
  else if (!checks.envEmpty.user) why = 'OPENAI_API_KEY · CODEX_API_KEY 가 사용자 환경 변수에 있습니다';
  else if (!checks.envEmpty.system) why = 'OPENAI_API_KEY · CODEX_API_KEY 가 시스템 환경 변수에 있습니다';
  else if (checks.hasCredits) why = '코덱스 계정에 크레딧이 있습니다(한도를 넘으면 돈이 나갈 수 있음) — 코덱스를 쓰지 않습니다';
  return { ok: !why, why, checks };
}

const kstOf = (sec) => (sec ? new Date(sec * 1000 + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + ' KST' : null);
function usageFrom(rl, at) {
  if (!rl || !rl.primary) return null;
  return { usedPercent: rl.primary.used_percent != null ? +rl.primary.used_percent : null, windowMinutes: rl.primary.window_minutes || null, resetsAt: kstOf(rl.primary.resets_at),
    planType: rl.plan_type || null, hasCredits: !!(rl.credits && rl.credits.has_credits), at: at || null };
}
/** 세션 기록 한 파일 → { usage, toolSec:[…], tokens } */
function readSession(file) {
  const out = { usage: null, toolSec: [], tokens: null };
  let txt = ''; try { txt = fs.readFileSync(file, 'utf8'); } catch (_) { return out; }
  for (const line of txt.split('\n')) {
    if (!line) continue;
    let d; try { d = JSON.parse(line); } catch (_) { continue; }
    const pl = d.payload || {};
    if (pl.type === 'custom_tool_call_output') for (const c of (pl.output || [])) { const m = /Wall time ([\d.]+) seconds/.exec((c && c.text) || ''); if (m) out.toolSec.push(+m[1]); }
    if (pl.type === 'token_count' && pl.rate_limits) { out.usage = usageFrom(pl.rate_limits, d.timestamp); out.tokens = ((pl.info || {}).total_token_usage || {}).total_tokens || null; }
  }
  return out;
}
function sessionFileOf(tid) {
  const base = path.join(codexHome(), 'sessions');
  const days = [];
  try { for (const y of fs.readdirSync(base)) for (const m of fs.readdirSync(path.join(base, y))) for (const dd of fs.readdirSync(path.join(base, y, m))) days.push(path.join(base, y, m, dd)); } catch (_) {}
  days.sort().reverse();
  for (const d of days.slice(0, 7)) { try { const f = fs.readdirSync(d).find((x) => x.endsWith(tid + '.jsonl')); if (f) return path.join(d, f); } catch (_) {} }
  return null;
}
/** 가장 최근 세션 기록의 사용량(편 시작 전 판정용) — 없으면 null */
function latestUsage() {
  const base = path.join(codexHome(), 'sessions');
  const files = [];
  try {
    const ys = fs.readdirSync(base).sort().reverse().slice(0, 2);
    for (const y of ys) for (const m of fs.readdirSync(path.join(base, y)).sort().reverse().slice(0, 2)) for (const dd of fs.readdirSync(path.join(base, y, m)).sort().reverse().slice(0, 3)) {
      const dir = path.join(base, y, m, dd);
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) files.push(path.join(dir, f));
    }
  } catch (_) {}
  files.sort((a, b) => { try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch (_) { return 0; } });
  for (const f of files.slice(0, 40)) { const r = readSession(f); if (r.usage) return r.usage; }
  return null;
}

/** codex exec 에 보내는 지시(2.0 실측 gen.py 와 같은 꼴 — 도구를 정확히 한 번 부르고 끝) */
function instruction({ prompt, refs, transparent }) {
  const call = { prompt, transparent_background: !!transparent };
  if (refs && refs.length) call.referenced_image_paths = refs;
  return 'Call the image generation tool exactly once with exactly these arguments, then finish. '
    + 'Do not read any skill files, do not run shell commands, do not ask questions.\n'
    + 'Use the code-mode directive // @exec: {"yield_time_ms": 180000} and then:\n'
    + 'const r = await tools.image_gen__imagegen(' + JSON.stringify(call) + '); generatedImage(r);';
}

/**
 * 한 장 → { ok, file, sec, toolSec, threadId, usage, error }
 *   prompt 는 꼬리(㊵)까지 붙인 글을 넘긴다 · outPath 에 복사 · workDir = 빈 작업 폴더(읽기 전용 샌드박스)
 */
function generate({ exe, prompt, refs = null, transparent = false, outPath, workDir, timeoutMs, abortSignal = () => false, prefixArgs = null }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    if (!(timeoutMs > 0)) timeoutMs = TIMEOUT_MS;
    fs.mkdirSync(workDir, { recursive: true });
    const env = { ...process.env };
    delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;   // 확인 셋이 이미 막았지만 한 번 더(자식은 구독 로그인만)
    const cp = spawn(exe, [...(prefixArgs || []), 'exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-c', 'model_reasoning_effort="low"', '-C', workDir, '-'], { windowsHide: true, env, cwd: workDir });
    let out = '', err = '', done = false, tid = null;
    const finish = (r) => { if (done) return; done = true; clearInterval(ab); clearTimeout(to); resolve({ sec: Math.round((Date.now() - t0) / 100) / 10, threadId: tid, ...r }); };
    const to = setTimeout(() => { try { cp.kill(); } catch (_) {} finish({ ok: false, error: `시간 초과(${Math.round(timeoutMs / 1000)}초)` }); }, timeoutMs);
    const ab = setInterval(() => { if (abortSignal()) { try { cp.kill(); } catch (_) {} finish({ ok: false, error: '중단', aborted: true }); } }, 500);
    cp.stdout.on('data', (b) => { out += b; if (!tid) { const m = /"type"\s*:\s*"thread\.started"[^}]*"thread_id"\s*:\s*"([^"]+)"/.exec(out); if (m) tid = m[1]; } });
    cp.stderr.on('data', (b) => { err += b; });
    cp.on('error', (e) => finish({ ok: false, error: '코덱스를 실행하지 못했습니다 — ' + e.message }));
    cp.on('close', (code) => {
      if (done) return;
      for (const line of out.split('\n')) { try { const ev = JSON.parse(line); if (ev.type === 'thread.started' && ev.thread_id) tid = ev.thread_id; } catch (_) {} }
      const sf = tid ? sessionFileOf(tid) : null;
      const ss = sf ? readSession(sf) : { usage: null, toolSec: [] };
      let png = null;
      if (tid) { try { const d = path.join(codexHome(), 'generated_images', tid); png = fs.readdirSync(d).filter((f) => /\.png$/i.test(f)).map((f) => path.join(d, f)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs).pop() || null; } catch (_) {} }
      if (!png) return finish({ ok: false, error: `그림이 나오지 않았습니다(종료 ${code}) — ${(err || out).replace(/\s+/g, ' ').slice(-300)}`, usage: ss.usage, toolSec: ss.toolSec });
      try { fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.copyFileSync(png, outPath); }   // 복사만 — 코덱스 폴더는 그대로
      catch (e) { return finish({ ok: false, error: '그림을 복사하지 못했습니다 — ' + e.message, usage: ss.usage }); }
      finish({ ok: true, file: outPath, src: png, usage: ss.usage, toolSec: ss.toolSec });
    });
    cp.stdin.on('error', () => {});
    cp.stdin.end(instruction({ prompt, refs, transparent }), 'utf8');
  });
}

/**
 * ㊴ 1672×941 → 1920×1080 — CPU Lanczos 로 덮어 맞춘 뒤 가운데 자르기(1.15배 · GPU 업스케일 없음) · 원본은 그대로
 */
function fitTo(src, dst, w = 1920, h = 1080) {
  const ff = require('./media-utils').getFfmpegPath();
  return new Promise((res, rej) => execFile(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`, '-frames:v', '1', dst], { windowsHide: true }, (e) => (e ? rej(e) : res(dst))));
}

/** 동시 줄 수 — 주문 값(없으면 4) · 1~6 */
function concOf(v) { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(CONC_MAX, n) : CONC_DEFAULT; }
/** 상한(%) — 주문 값(없으면 60) · 1~100 */
function capOf(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(100, n) : CAP_DEFAULT; }

module.exports = { ENGINE, CONC_DEFAULT, CONC_MAX, CAP_DEFAULT, TAIL, withTail, verKey, cmpVer, findCodex, preflight, latestUsage, readSession, sessionFileOf, usageFrom, instruction, generate, fitTo, concOf, capOf, codexHome };
