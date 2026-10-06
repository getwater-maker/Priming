'use strict';
/**
 * spell-check.js — 로이가 고친 🟥·🟨 문단 맞춤법 검사 (2026-10-06, v0.7.13 · 채널사업부 요청 · 화자 규약 §4-1)
 *   엔진 = 로이의 Claude 구독(`claude -p --model sonnet`) · 별도 API 키 없음. **제안만** 한다(고치는 것은 로이의 「반영」).
 *   main 전용(자식 프로세스) — 렌더러 번들에 넣지 않는다.
 *
 * 호출 = 채널사업부 실측 그대로(2026-10-06 · 1007 문단: 느겼습니다→느꼈습니다 · 부인 할수록→부인할수록 · 틀린 지적 0 · 5~7초):
 *   빈 임시 폴더에서 문단을 stdin 으로
 *   claude -p --model sonnet --system-prompt <SYSTEM> --tools "" --strict-mcp-config --no-session-persistence --setting-sources local --output-format json
 *   - 🔑 옵션을 빼면 Claude Code 기본 지침·도구·전역 CLAUDE.md 가 실려 같은 문단에 30배 가까이 든다 · `--setting-sources local` = 전역 훅도 안 돈다.
 *   - ⛔ `--model haiku`(진짜 오타를 놓치고 복수 표준어를 틀렸다고 했다) · ⛔ `--bare`(구독 OAuth 를 안 받는다).
 * 🔑 claude.cmd(npm 껍데기)를 거치지 않고 claude.exe 를 직접 부른다 — 따옴표·한글이 든 지시문이 cmd 를 지나며 깨지지 않게.
 * 실패(이 PC 에 claude 없음 · 로그인 만료 · 30초 초과)는 사람 말 한 줄로 돌려준다 — 렌더를 막지 않는다(fail-open · 제안 기능이다).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');

const SYSTEM = '너는 한국어 교정자다. 받은 문단에서 표준국어대사전·한글 맞춤법 기준의 확실한 오류(없는 낱말·맞춤법·명백한 띄어쓰기)만 찾는다. 복수 표준어와 허용 규정(보조용언 붙여 쓰기·띄어 쓰기)은 오류가 아니다. 말투·표현·내용은 고치지 않는다. 확실하지 않으면 넣지 않는다. JSON 배열로만 답한다: [{"틀림":"...","바름":"..."}] 없으면 []';
const MODEL = 'sonnet';
const TIMEOUT_MS = 30000;
const argsFor = () => ['-p', '--model', MODEL, '--system-prompt', SYSTEM, '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--setting-sources', 'local', '--output-format', 'json'];

let _exe;   // undefined = 아직 안 찾음 · null = 없음
const exists = (p) => { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } };
/** npm 껍데기(claude.cmd)가 가리키는 claude.exe — `"%dp0%\node_modules\…\claude.exe"` */
function exeFromCmd(cmdPath) {
  try {
    const t = fs.readFileSync(cmdPath, 'utf8');
    const m = t.match(/"%dp0%\\?([^"]+?\.exe)"/i);
    if (m) { const p = path.join(path.dirname(cmdPath), m[1]); if (exists(p)) return p; }
  } catch (_) {}
  return null;
}
function _where() {
  return new Promise((res) => {
    if (process.platform !== 'win32') return execFile('which', ['claude'], { windowsHide: true }, (e, out) => res(e ? [] : String(out).split(/\r?\n/).filter(Boolean)));
    execFile('where', ['claude'], { windowsHide: true }, (e, out) => res(e ? [] : String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)));
  });
}
/** claude 실행 파일 — PM_CLAUDE_EXE > 기본 설치 자리 > PATH(where) · 없으면 null */
async function findClaude(force = false) {
  if (_exe !== undefined && !force) return _exe;
  const env = process.env.PM_CLAUDE_EXE;
  if (env) return (_exe = exists(env) ? env : null);
  const home = os.homedir(), appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const cands = [
    path.join(home, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
    path.join(appdata, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
  ];
  for (const c of cands) if (exists(c)) return (_exe = c);
  for (const w of await _where()) {
    if (/\.exe$/i.test(w) && exists(w)) return (_exe = w);
    if (/\.cmd$/i.test(w)) { const e = exeFromCmd(w); if (e) return (_exe = e); }
    if (process.platform !== 'win32' && exists(w)) return (_exe = w);
  }
  return (_exe = null);
}

/** 모델 답 → [{틀림, 바름}] — ```json 펜스를 벗기고 첫 [ ~ 끝 ] 만 읽는다. 원문에 없는 「틀림」·같은 짝은 버린다(지어낸 지적 방지). */
function parseItems(resultText, text) {
  let r = String(resultText == null ? '' : resultText).trim();
  const f = r.match(/```(?:json)?\s*([\s\S]*?)```/i); if (f) r = f[1].trim();
  const a = r.indexOf('['), b = r.lastIndexOf(']');
  if (a < 0 || b < a) return null;
  let arr; try { arr = JSON.parse(r.slice(a, b + 1)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const out = [], seen = new Set();
  for (const x of arr) {
    const w = x && String(x['틀림'] == null ? '' : x['틀림']), c = x && String(x['바름'] == null ? '' : x['바름']);
    if (!w || !c || w === c || seen.has(w)) continue;
    if (text != null && !String(text).includes(w)) continue;
    seen.add(w); out.push({ 틀림: w, 바름: c });
  }
  return out;
}

/** claude 의 JSON 출력 한 덩어리 → {ok, items} | {ok:false, error} */
function readOutput(stdout, text) {
  let j; try { j = JSON.parse(String(stdout || '').trim()); } catch { return { ok: false, error: '맞춤법 검사 답을 읽지 못했습니다' }; }
  if (j.is_error || j.subtype !== 'success') {
    const msg = String(j.result || j.subtype || '');
    if (/log ?in|auth|401|403|credential|oauth|token/i.test(msg)) return { ok: false, error: 'claude 로그인이 필요합니다(터미널에서 claude 를 한 번 실행해 로그인)' };
    return { ok: false, error: 'claude 오류 — ' + msg.slice(0, 80) };
  }
  const items = parseItems(j.result, text);
  if (!items) return { ok: false, error: '맞춤법 검사 답이 목록 형식이 아닙니다' };
  return { ok: true, items, costUsd: Number(j.total_cost_usd) || 0 };
}

/**
 * 문단 하나 검사.
 * @param {string} text
 * @param {{exe?:string, preArgs?:string[], timeoutMs?:number}} o  exe·preArgs 는 테스트용(가짜 claude)
 * @returns {Promise<{ok:true, items, ms, costUsd} | {ok:false, error, ms}>}
 */
async function check(text, o = {}) {
  const t0 = Date.now();
  const body = String(text || '').trim();
  if (!body) return { ok: true, items: [], ms: 0, costUsd: 0 };
  let exe = o.exe || await findClaude();
  let pre = o.preArgs || [], env = process.env;
  // 🧪 PM_CLAUDE_EXE 가 .js 면 가짜 claude(테스트) — node 로 돌린다(Electron 안이면 ELECTRON_RUN_AS_NODE)
  if (exe && /\.js$/i.test(exe)) { pre = [exe, ...pre]; exe = process.execPath; env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }; }
  if (!exe) return { ok: false, error: '이 PC 에 claude 가 없습니다(맞춤법 검사는 Claude Code 가 설치·로그인된 PC 에서만)', ms: 0 };
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'priming-spell-'));   // 빈 폴더 — 프로젝트 CLAUDE.md 가 안 실리게
  const timeoutMs = o.timeoutMs || TIMEOUT_MS;
  try {
    return await new Promise((res) => {
      let out = '', err = '', done = false, tm = null;
      const fin = (r) => { if (done) return; done = true; clearTimeout(tm); res({ ...r, ms: Date.now() - t0 }); };
      let ch;
      try { ch = spawn(exe, [...pre, ...argsFor()], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
      catch (e) { return fin({ ok: false, error: 'claude 를 실행하지 못했습니다 — ' + e.message }); }
      tm = setTimeout(() => { try { ch.kill(); } catch (_) {} fin({ ok: false, error: `${Math.round(timeoutMs / 1000)}초 안에 답이 없습니다` }); }, timeoutMs);
      ch.stdout.on('data', (d) => { out += d; });
      ch.stderr.on('data', (d) => { err += d; });
      ch.on('error', (e) => fin({ ok: false, error: e.code === 'ENOENT' ? '이 PC 에 claude 가 없습니다' : 'claude 를 실행하지 못했습니다 — ' + e.message }));
      ch.on('close', (code) => {
        if (!out.trim()) return fin({ ok: false, error: /log ?in|auth/i.test(err) ? 'claude 로그인이 필요합니다(터미널에서 claude 를 한 번 실행해 로그인)' : `claude 가 답 없이 끝났습니다(코드 ${code}) ${err.slice(0, 80)}`.trim() });
        fin(readOutput(out, body));
      });
      ch.stdin.on('error', () => {});
      ch.stdin.end(body, 'utf8');
    });
  } finally { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch (_) {} }
}

/** 고친 글 — 고른 짝마다 **첫 자리 하나만** 바꾼다(없는 짝은 건너뛰고 skipped 로 알린다) */
function applyItems(text, items) {
  let t = String(text || '');
  const applied = [], skipped = [];
  for (const it of items || []) {
    const i = t.indexOf(it['틀림']);
    if (i < 0) { skipped.push(it); continue; }
    t = t.slice(0, i) + it['바름'] + t.slice(i + it['틀림'].length);
    applied.push(it);
  }
  return { text: t, applied, skipped };
}
/** 은행 「교정」 칸 글 — 손으로 넣은 1007 줄과 같은 꼴 */
const correctionNote = (items) => `맞춤법만 — ${(items || []).map((x) => `${x['틀림']}→${x['바름']}`).join(' · ')} (claude -p ${MODEL} 검사 · 로이 「반영」)`;

module.exports = { check, findClaude, parseItems, readOutput, applyItems, correctionNote, exeFromCmd, SYSTEM, MODEL, argsFor, _resetExe: () => { _exe = undefined; } };
