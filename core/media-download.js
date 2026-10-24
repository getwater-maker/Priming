'use strict';
/**
 * core/media-download.js — URL(유튜브·비메오·틱톡·인스타 …) → 오디오·영상·자막 내려받기
 *
 * 🔑 왜 yt-dlp 인가
 *   4K Video Downloader+ 같은 GUI 는 앱이 부를 수 없다. yt-dlp 는 CLI 라 자식 프로세스로 부른다.
 *   npm 의존성을 늘리지 않는다 — deps 가 바뀌면 라이트 업데이트가 막히고 설치본 재배포가 필요하다.
 *
 * 🔴 실측으로 확인한 것 (2026-09-15)
 *   · **버전이 낡으면 오디오가 403 으로 죽는다.** 이 PC 에 있던 2026.07.04 판은 자막은 받아지는데
 *     오디오만 `HTTP Error 403: Forbidden`. 최신 2026.08.19 판으로 바꾸니 즉시 정상.
 *     → 그래서 「있으면 아무거나 쓴다」가 아니라 **버전을 보고 고른다**(STALE_DAYS).
 *   · **JS 런타임(deno·node)은 없어도 된다.** 최신판은 `--no-js-runtimes` 로도 정상 동작한다
 *     (visionos player API 를 쓴다). 경고는 뜨지만 무시해도 되는 것 — 아내 PC 에 node 를 깔 필요가 없다.
 *   · 유튜브 자동자막은 **롤업**이라 같은 문장이 2~3번 반복되고 단어마다 `<00:00:01.040><c>` 태그가 붙는다.
 *     그대로 .txt 로 만들면 분량이 3배가 된다 → `vttToText` 가 그걸 걷어낸다(단위 테스트가 지킨다).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';
const BIN_DIR = path.join(os.homedir(), '.shots-maker', 'bin');
const EXE_NAME = IS_WIN ? 'yt-dlp.exe' : 'yt-dlp';
const OWN_EXE = path.join(BIN_DIR, EXE_NAME);
const RELEASE_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${EXE_NAME}`;
const NIGHTLY_URL = `https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/${EXE_NAME}`;
const NIGHTLY_RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest';
let activeRuns = 0;
let preparingTool = null;

// 🔑 60일 — 실측에서 **73일 된 판이 이미 403** 이었다. 넉넉히 잡으면 사용자가 원인을 못 찾는다.
const STALE_DAYS = 60;

// ── 버전 ────────────────────────────────────────────────
/** yt-dlp 버전은 `YYYY.MM.DD` (nightly 는 `.YYYYMMDD.NNN` 이 더 붙는다) */
function parseVersionDate(v) {
  const m = String(v || '').trim().match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/** 그 버전이 며칠 됐나. 못 읽으면 null(=판단 불가 → 낡은 것으로 취급하지 않는다) */
function versionAgeDays(v, now = Date.now()) {
  const d = parseVersionDate(v);
  if (!d) return null;
  return Math.floor((now - d.getTime()) / 86400000);
}

function isStale(v, now = Date.now()) {
  const age = versionAgeDays(v, now);
  return age != null && age > STALE_DAYS;
}

// ── 조달 ────────────────────────────────────────────────
function _run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout || 20000, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

/**
 * 쓸 수 있는 yt-dlp 를 찾는다.
 *   ① 앱이 관리하는 exe(~/.shots-maker/bin) ② PATH 의 yt-dlp ③ python -m yt_dlp
 * ⚠ **버전도 함께 돌려준다** — 낡은 판은 오디오가 403 이라 호출부가 그걸 보고 판단해야 한다.
 */
async function findYtDlp() {
  const cands = [];
  if (fs.existsSync(OWN_EXE)) cands.push({ kind: 'own', cmd: OWN_EXE, args: [] });
  cands.push({ kind: 'path', cmd: EXE_NAME, args: [] });
  for (const py of ['python', 'python3', 'py']) cands.push({ kind: 'python', cmd: py, args: ['-m', 'yt_dlp'] });

  for (const c of cands) {
    const r = await _run(c.cmd, [...c.args, '--version'], { timeout: 15000 });
    if (r.err) continue;
    const ver = r.stdout.trim().split('\n').pop().trim();
    if (!/^\d{4}\.\d{2}\.\d{2}/.test(ver)) continue;
    return { ...c, version: ver, stale: isStale(ver), ageDays: versionAgeDays(ver) };
  }
  return null;
}

/** GitHub 공식 릴리스에서 최신 exe 를 받아 ~/.shots-maker/bin 에 둔다(약 17MB). */
async function downloadYtDlp({ onLog, channel = 'stable', expectedVersion } = {}) {
  if (activeRuns) throw new Error('다운로드가 진행 중이므로 도구 교체를 보류합니다');
  const log = onLog || (() => {});
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const repo = channel === 'nightly' ? 'yt-dlp-nightly-builds' : 'yt-dlp';
  if (expectedVersion && !/^\d{4}\.\d{2}\.\d{2}(?:\.\d+)*$/.test(expectedVersion)) throw new Error('올바르지 않은 yt-dlp 릴리스 버전입니다');
  const releaseUrl = expectedVersion ? `https://github.com/yt-dlp/${repo}/releases/download/${expectedVersion}/${EXE_NAME}` : channel === 'nightly' ? NIGHTLY_URL : RELEASE_URL;
  log(`⬇ yt-dlp ${channel === 'nightly' ? 'nightly' : '안정판'}을 내려받습니다 — ${releaseUrl}`);
  const res = await fetch(releaseUrl, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`yt-dlp 내려받기 실패 (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024 * 1024) throw new Error(`받은 파일이 너무 작습니다 (${buf.length} 바이트)`);
  // ⚠ 실행 중인 파일은 덮어쓸 수 없다 → tmp 로 받아 rename(원자적)
  const tmp = path.join(BIN_DIR, `yt-dlp-download-${process.pid}-${Date.now()}${IS_WIN ? '.exe' : ''}`);
  fs.writeFileSync(tmp, buf);
  let ver;
  const backup = OWN_EXE + '.previous';
  let backedUp = false;
  try {
    if (!IS_WIN) fs.chmodSync(tmp, 0o755);
    const r = await _run(tmp, ['--version'], { timeout: 20000 });
    ver = r.stdout.trim().split('\n').pop().trim();
    if (r.err || !parseVersionDate(ver)) throw new Error('받은 yt-dlp의 실행 검증에 실패했습니다');
    if (expectedVersion && ver !== expectedVersion) throw new Error('받은 yt-dlp 버전이 요청한 릴리스와 다릅니다');
    if (activeRuns) throw new Error('다운로드가 시작되어 도구 교체를 보류합니다');
    if (fs.existsSync(OWN_EXE)) { fs.rmSync(backup, { force: true }); fs.renameSync(OWN_EXE, backup); backedUp = true; }
    try { fs.renameSync(tmp, OWN_EXE); }
    catch (error) { if (backedUp) fs.renameSync(backup, OWN_EXE); throw error; }
    if (backedUp) fs.rmSync(backup, { force: true });
  } finally { fs.rmSync(tmp, { force: true }); }
  log(`✓ yt-dlp ${ver} 준비 완료 (${(buf.length / 1048576).toFixed(1)}MB)`);
  return { cmd: OWN_EXE, args: [], kind: 'own', version: ver, stale: isStale(ver), ageDays: versionAgeDays(ver) };
}

/**
 * 사이트 변경은 배포 후 며칠 안에도 발생하므로 경과일 대신 실제 최신 릴리스와 비교한다.
 * 오프라인·업데이트 실패 때문에 이미 설치된 정상 실행 파일까지 잃지 않도록 보존한다.
 */
async function prepareYtDlp({ onLog, forceUpdate = false } = {}) {
  const log = onLog || (() => {});
  const found = await findYtDlp();
  try {
    log('🔎 다운로드 도구 최신 버전 확인 중…');
    const response = await fetch(NIGHTLY_RELEASE_API, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!response.ok) throw new Error(`릴리스 확인 실패 (HTTP ${response.status})`);
    const release = await response.json();
    const version = release.tag_name;
    if (typeof version !== 'string' || !/^\d{4}\.\d{2}\.\d{2}(?:\.\d+)*$/.test(version)) throw new Error('최신 릴리스 버전을 읽지 못했습니다');
    if (found && !forceUpdate && compareToolVersions(found.version, version) >= 0) return found;
    log(`⬇ 다운로드 도구 자동 업데이트${found ? ` (${found.version} → ${version})` : ` (${version})`}`);
    return await downloadYtDlp({ onLog: log, channel: 'nightly', expectedVersion: version });
  } catch (e) {
    if (found) {
      log(`⚠ 자동 업데이트를 마치지 못했습니다 (${e.message}) — 기존 ${found.version}을 보존하고 진행합니다.`);
      return found;
    }
    log(`⚠ 릴리스 확인 후 준비하지 못했습니다 (${e.message}) — 공식 최신 배포 주소로 다시 시도합니다`);
    return downloadYtDlp({ onLog: log, channel: 'nightly' });
  }
}

function compareToolVersions(a, b) {
  const left = String(a).split('.').map(Number), right = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (left[i] || 0) - (right[i] || 0);
    if (delta) return Math.sign(delta);
  }
  return 0;
}

// 같은 시각 시작한 작업끼리 실행 파일을 중복으로 교체하지 않도록 준비 과정을 공유한다.
async function ensureYtDlp(options = {}) {
  // 🧪 E2E 전용 가짜 도구(PM_UI_SMOKE 일 때만) — 진짜 유튜브에 요청하지 않는다
  if (process.env.PM_UI_SMOKE && global.__ytdlpTest) return global.__ytdlpTest;
  if (!preparingTool) preparingTool = prepareYtDlp(options).finally(() => { preparingTool = null; });
  return preparingTool;
}

// ── 자막 ────────────────────────────────────────────────
/**
 * VTT/SRT → 사람이 읽는 줄 배열.
 * 🔴 유튜브 자동자막은 **롤업**이다 — 큐마다 「직전 줄 + 새 줄」이 들어 있어 그대로 두면 2~3배로 불어난다.
 *    게다가 단어마다 `<00:00:01.040><c>…</c>` 타이밍 태그가 박혀 있다.
 *    실측(293초 영상): VTT 35,262자 · 1,161줄 → **145줄 · 2,753자 · 중복 0**.
 * ⚠ 직전 1줄만 비교하면 안 된다 — 큐가 2줄을 싣고 오므로 최근 몇 줄을 함께 본다(LOOKBACK).
 */
function vttToText(vtt) {
  const LOOKBACK = 4;
  const src = String(vtt || '').replace(/\r\n?/g, '\n');
  const out = [];
  const recent = [];
  for (const raw of src.split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    if (/^WEBVTT/.test(t)) continue;
    if (/^(Kind|Language|NOTE|STYLE|REGION|X-TIMESTAMP-MAP)\b/i.test(t)) continue;
    if (t.includes('-->')) continue;          // 타임코드 줄
    if (/^\d+$/.test(t)) continue;            // SRT 의 큐 번호

    let s = t
      .replace(/<(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}>/g, '')   // 단어별 타이밍 태그
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')             // <c> <i> <v …> 등 서식 태그
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')                          // ⚠ &amp; 는 마지막(먼저 풀면 &lt; 가 두 번 풀린다)
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) continue;
    if (recent.includes(s)) continue;                  // 롤업 반복
    out.push(s);
    recent.push(s);
    if (recent.length > LOOKBACK) recent.shift();
  }
  return out;
}

/** 자막 파일 → 한 덩어리 텍스트 */
function subtitleFileToText(file) {
  const lines = vttToText(fs.readFileSync(file, 'utf8'));
  return lines.join(' ').trim();
}

// ── 🧩 유튜브 JS 실행기(v0.9.41) ───────────────────────
//   yt-dlp 2025.11+ 는 유튜브 주소를 풀 때 JS 실행기(deno·node)를 쓴다. 없으면 「JavaScript runtime 없음 — 일부 형식이 빠질 수 있다」
//   경고를 내고 예비 방식으로 받는다(2026-10-16 실측: 경고 그대로 · 403 이 간헐적으로 섞였다).
//   PC 에 **node 22 이상**이 있으면 `--js-runtimes node` 를 붙인다(이 PC node 24 → 「JS runtimes: node-24」 · 경고 사라짐).
//   ⚠ Electron 내장 node(20)는 yt-dlp 가 「unsupported」로 거부한다(실측) · 없으면 예전 그대로(아무것도 안 붙인다).
const JS_RT_MIN_YTDLP = '2025.11.01';   // 이보다 옛 yt-dlp 는 --js-runtimes 를 모른다
let _jsRt = null;
async function jsRuntimeArgs(tool) {
  if (!tool || !tool.version || !(parseVersionDate(tool.version) >= parseVersionDate(JS_RT_MIN_YTDLP))) return [];
  if (!_jsRt) {
    _jsRt = _run('node', ['--version'], { timeout: 5000 }).then((r) => {
      const m = !r.err && /^v(\d+)\./.exec(String(r.stdout || '').trim());
      return m && Number(m[1]) >= 22 ? ['--js-runtimes', 'node'] : [];
    }).catch(() => []);
  }
  return _jsRt;
}

// ── 실행 ────────────────────────────────────────────────
// 🔤 `--encoding utf-8` = 한글 파일 이름·오류를 UTF-8 로(v0.9.115) — yt-dlp 2026.10.23 부터 PYTHONIOENCODING 을 무시하고
//   CP949 로 내보내 `--print` 파일 이름이 깨졌다 → 받은 mp3 를 못 찾고 「결과 파일을 찾지 못했습니다」(2026-10-24 실측)
const YT_ENC_ARGS = ['--encoding', 'utf-8'];
async function _spawnYt(tool, args, opts = {}) {
  const extra = await jsRuntimeArgs(tool);
  return _spawnYtRaw(tool, [...YT_ENC_ARGS, ...extra, ...args], opts);
}
function _spawnYtRaw(tool, args, { onLine, abortSignal, timeoutMs = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(tool.cmd, [...tool.args, ...args], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },   // ⚠ 한글 제목이 CP949 로 깨지지 않게
    });
    activeRuns++;
    let released = false;
    const releaseRun = () => { if (!released) { released = true; activeRuns--; } };
    let out = '';
    let err = '';
    let killed = false;
    const kill = (why) => { killed = why; try { child.kill(); } catch {} };
    const timer = setTimeout(() => kill('timeout'), timeoutMs);
    const poll = abortSignal ? setInterval(() => { if (abortSignal()) kill('abort'); }, 500) : null;

    const feed = (buf, isErr) => {
      const s = buf.toString('utf8');
      if (isErr) err += s; else out += s;
      if (!onLine) return;
      for (const ln of s.split(/\r?\n|\r/)) {
        const t = ln.trim();
        if (t) onLine(t);
      }
    };
    child.stdout.on('data', (b) => feed(b, false));
    child.stderr.on('data', (b) => feed(b, true));
    child.on('error', (e) => { releaseRun(); clearTimeout(timer); if (poll) clearInterval(poll); reject(e); });
    child.on('close', (code) => {
      releaseRun();
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      if (killed === 'abort') return reject(new Error('중단됨'));
      if (killed === 'timeout') return reject(new Error(`시간 초과 (${Math.round(timeoutMs / 60000)}분)`));
      resolve({ code, stdout: out, stderr: err });
    });
  });
}

/** URL 하나의 정보(제목·길이·언어·자막 유무)를 미리 읽는다 — 내려받지 않는다. */
async function probe(url, { tool, abortSignal, onLog, infoJsonFile, paced, _waitScale } = {}) {
  const t = tool || await ensureYtDlp();
  const a = [...(paced ? PACE_ARGS : []), '--no-playlist', '--skip-download', '--dump-single-json', url];
  let r = await _spawnYt(t, a, { abortSignal, timeoutMs: 3 * 60 * 1000 });
  // ⏳ 정보 확인도 일시 차단(429·403)이면 기다렸다 두 번까지 다시(v0.9.116 — 예전엔 받기에만 있어 막히면 4초마다 다음 영상으로 넘어갔다)
  for (const wait of BLOCK_WAITS) {
    if (r.code === 0 || !BLOCK_RE.test(r.stderr || '') || (abortSignal && abortSignal())) break;
    if (onLog) onLog(`  ⏳ 유튜브가 잠시 막았습니다(${blockLabel(r.stderr)}) — ${wait}초 뒤 정보를 다시 읽습니다`);
    await new Promise((res) => setTimeout(res, (_waitScale != null ? _waitScale : 1000) * wait));
    if (abortSignal && abortSignal()) break;
    r = await _spawnYt(t, a, { abortSignal, timeoutMs: 3 * 60 * 1000 });
  }
  // ⚠ 사람 말로 바꾼 메시지만 던지면 호출부가 원인을 못 가린다 → 원문을 `raw` 로 함께 준다(altUrl 판정에 쓴다).
  if (r.code !== 0) {
    const err = new Error(_explain(r.stderr) || `정보를 읽지 못했습니다 (코드 ${r.code})`);
    err.raw = r.stderr;
    throw err;
  }
  const line = r.stdout.split('\n').find((x) => x.trim().startsWith('{'));
  if (!line) throw new Error('정보를 읽지 못했습니다 (응답 없음)');
  const j = JSON.parse(line);
  // 📄 받은 정보를 파일로 남기면 download 가 `--load-info-json` 으로 다시 묻지 않고 받는다(유튜브 요청 절반 · v0.9.116)
  if (infoJsonFile) { try { fs.writeFileSync(infoJsonFile, line, 'utf8'); } catch (_) {} }
  const auto = j.automatic_captions || {};
  const manual = j.subtitles || {};
  return {
    id: j.id, title: j.title || j.id, duration: j.duration || 0,
    channel: j.channel || j.uploader || '', language: j.language || '',
    hasManualSub: Object.keys(manual).length > 0,
    hasAutoSub: Object.keys(auto).length > 0,
    subLangs: Object.keys(manual), autoLangs: Object.keys(auto),
    isPlaylist: !!(j._type === 'playlist' || j.entries),
  };
}

/**
 * probe + **대안 주소 1회 재시도**. 성공한 주소를 함께 돌려주므로 호출부는 그 주소로 내려받으면 된다.
 * 🔑 호출부가 「어느 주소로 받을지」를 따로 계산하지 않게 여기서 한 번에 정한다(두 곳이 각자 판단하면 어긋난다).
 */
async function probeSmart(url, o = {}) {
  try {
    return { url, info: await probe(url, o), switched: false };
  } catch (e) {
    const alt = altUrl(url, e.raw || e.message);
    if (!alt) throw e;
    if (o.onLog) o.onLog('  ↻ 비메오가 로그인을 요구합니다 — 플레이어 주소로 다시 시도합니다.');
    const info = await probe(alt, o);   // 여기서 또 실패하면 그대로 던진다(조용히 삼키지 않는다)
    return { url: alt, info, switched: true };
  }
}

/** 유튜브 채널 첫 화면은 동영상·쇼츠·라이브가 섞일 수 있다. 「채널 전체 영상」은 일반 영상 탭으로 고정한다. */
function normalizeChannelUrl(url) {
  const raw = String(url || '').trim();
  try {
    const u = new URL(raw);
    if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return raw;
    const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (!parts.length) return raw;
    if (/^(videos|shorts|streams|featured)$/i.test(parts[parts.length - 1])) parts.pop();
    if (/^@/.test(parts[0]) || /^(channel|c|user)$/i.test(parts[0])) {
      u.pathname = '/' + parts.join('/') + '/videos';
      u.search = '';
      u.hash = '';
      return u.toString().replace(/\/$/, '');
    }
  } catch {}
  return raw;
}

/** yt-dlp flat-playlist 항목을 다시 받을 수 있는 실제 URL로 바꾼다. */
function channelEntryUrl(e) {
  if (!e) return '';
  if (/^https?:\/\//i.test(String(e.webpage_url || ''))) return String(e.webpage_url);
  if (/^https?:\/\//i.test(String(e.url || ''))) return String(e.url);
  const id = String(e.id || '').trim();
  const extractor = String(e.extractor_key || e.extractor || '').toLowerCase();
  if (id && (extractor.includes('youtube') || /^[\w-]{11}$/.test(id))) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  }
  return '';
}

function safeFolderName(name, fallback = '채널 영상') {
  const s = String(name || '').replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/g, '').trim();
  return (s || fallback).slice(0, 120);
}

/**
 * 채널의 일반 영상 목록만 읽는다(다운로드는 하지 않음). 실제 다운로드는 각 URL을 기존 단일 영상 경로로 보낸다.
 * 이렇게 해야 영상마다 자막 우선 → 필요할 때만 STT 규칙과 중단 처리가 그대로 유지된다.
 */
/**
 * 영상 한 편의 yt-dlp 응답이면 그 영상의 **채널 주소**를 돌려준다(목록 응답이면 '').
 * 🔴 「채널 전체」를 켜고 영상 주소(watch?v=…)를 넣으면 yt-dlp 가 영상 한 편 정보만 돌려줘
 *    목록이 0개 → 「채널에 받을 일반 영상이 없습니다」로 끝났다(2026-09-26 실측 · cXB_H0H2kDc).
 *    그 응답의 channel_url(/channel/UC…) 로 한 번 더 읽는다.
 */
function channelUrlOfVideo(j) {
  if (!j || (Array.isArray(j.entries) && j.entries.length)) return '';
  if (j._type && j._type !== 'video') return '';
  const u = String(j.channel_url || j.uploader_url || '');
  return /^https?:\/\//i.test(u) ? u : '';
}

async function listChannelVideos(url, o = {}) {
  const tool = o.tool || await ensureYtDlp({ onLog: o.onLog });
  const channelUrl = o.playlist ? normalizePlaylistUrl(url) : normalizeChannelUrl(url);
  const r = await _spawnYt(tool, [
    '--flat-playlist', '--skip-download', '--dump-single-json', '--no-warnings', channelUrl,
  ], { abortSignal: o.abortSignal, timeoutMs: o.timeoutMs || 10 * 60 * 1000 });
  if (r.code !== 0) {
    const err = new Error(_explain(r.stderr) || `채널 영상 목록을 읽지 못했습니다 (코드 ${r.code})`);
    err.raw = r.stderr;
    throw err;
  }
  const line = r.stdout.split('\n').find((x) => x.trim().startsWith('{'));
  if (!line) throw new Error('채널 영상 목록 응답이 없습니다');
  const j = JSON.parse(line);
  const ofVideo = !o.playlist && !o._fromVideo && channelUrlOfVideo(j);
  if (ofVideo) {
    if (o.onLog) o.onLog(`  ↳ 영상 주소입니다 — 이 영상의 채널 「${j.channel || j.uploader || ''}」 전체를 읽습니다`);
    return listChannelVideos(ofVideo, { ...o, tool, _fromVideo: true });
  }
  const entries = (j.entries || []).map((e) => ({
    id: String((e && e.id) || ''),
    title: String((e && e.title) || (e && e.id) || '영상'),
    url: channelEntryUrl(e),
  })).filter((e) => e.url);
  return {
    url: channelUrl,
    title: String((o.playlist && j.title) || j.channel || j.uploader || j.title || '채널 영상'),
    entries,
  };
}

function normalizePlaylistUrl(value) {
  const url = new URL(value);
  const id = url.searchParams.get('list');
  if (!/^(www\.|m\.|music\.)?youtube\.com$/i.test(url.hostname) || !id || !/^[\w-]+$/.test(id)) throw new Error('재생목록 ID(list)가 포함된 유튜브 주소를 넣으세요');
  return `https://www.youtube.com/playlist?list=${id}`;
}

function selectSubtitleLanguage(info, language = 'original', track = 'any') {
  const manual = track === 'auto' ? [] : (info.subLangs || []);
  const auto = track === 'manual' ? [] : (info.autoLangs || []);
  if (language && language !== 'original') return language;
  const lang = String(info.language || '').split('-')[0];
  const pick = (items) => items.find((x) => x === `${lang}-orig`) || items.find((x) => x === info.language || x === lang) || items.find((x) => /-orig$/.test(x));
  return pick(manual) || pick(auto) || manual[0] || (lang || 'original');
}

/**
 * 자막 언어 우선순위.
 * 🔑 **원본 언어만 쓴다** — 유튜브는 자동자막을 157개 언어로 기계번역해 준다. `ko` 를 무턱대고 요청하면
 *    일본어 영상의 **번역본**을 받아 STT 보다 나쁜 결과를 조용히 쓰게 된다.
 *    `<lang>-orig` 가 원본이고, 원본이 그 언어면 `<lang>` 도 같은 내용이다(실측: 두 파일 바이트 동일).
 * 🔴 **정확 코드만 요청하면 사이트마다 조용히 놓친다** — 틱톡 자막 코드는 `eng-US` 라 `en` 과 안 맞아
 *    `요청한 언어의 자막이 없습니다` 로 떨어졌다(자막이 있는데도 매번 Whisper 를 돌렸다 · 2026-09-15 실측).
 *    → `<lang>.*` 를 **뒤에** 덧붙인다(유튜브가 아닌 사이트만).
 * 🔴 **유튜브 주소에는 `<lang>.*` 를 붙이지 않는다**(v0.9.38) — 유튜브 기계번역 자막 이름이 `en-ar`·`en-ko` 꼴이라 `en.*` 가
 *    번역본 십수 개를 하나씩 따로 요청했고, 유튜브가 429(Too Many Requests)로 막자 **영상 받기 전체가 실패**했다(2026-10-16 실측).
 *    ⚠ yt-dlp 는 언어 패턴을 **대소문자 구분 없이** 맞춘다(실측: `en[a-z]?-[A-Z]…` 도 en-ar 를 집었다) → 꼬리 패턴으로는 못 가른다.
 *    유튜브 원본은 언제나 `<lang>-orig`·`<lang>` 로 온다.
 */
const YT_URL_RE = /^https?:\/\/(?:[\w-]+\.)?(?:youtube\.com|youtu\.be)\//i;
function subLangPref(language, url = '') {
  const L = String(language || '').split('-')[0].trim();
  const wild = !YT_URL_RE.test(String(url || ''));
  const set = (x) => [`${x}-orig`, x, ...(wild ? [`${x}.*`] : [])];
  if (L) return set(L);
  return [...set('ko'), ...set('en')];
}

// 일시 차단(영상 받기 단계) — 기다렸다 다시(download) · 대기 초
// 「Sign in to confirm you’re not a bot」 = 이 PC(IP)를 잠시 막은 것 — 429 와 같이 쉬었다 이어간다(v0.9.117 · 2026-10-24 실측: 클라이언트 5종 모두 같은 거절 → 클라이언트 바꾸기는 소용없다)
const BLOCK_RE = /HTTP Error (?:403|429)|Too Many Requests|Forbidden|confirm you.re not a bot/i;
const BLOCK_WAITS = [15, 45];
const blockLabel = (s) => (/not a bot/i.test(s) ? '로봇 확인' : /429|Too Many/i.test(s) ? '429' : '403');
const isBlocked = (e) => BLOCK_RE.test(String((e && (e.raw || e.message)) || '')) || /잠시 막았습니다/.test(String((e && e.message) || ''));
// 🐢 여러 편을 연달아 받을 때(채널·재생목록) 요청 사이 쉼 — 몰아치면 유튜브가 429 로 막는다(2026-10-24 · 48편째에 막힘)
const PACE_ARGS = ['--sleep-requests', '1', '--sleep-subtitles', '2'];
// 자막 단계 실패 판정 · 자막 인자(download 의 「자막 없이 다시」가 뺀다)
const SUB_FAIL_RE = /download (?:video )?subtitles|subtitles? for '|Unable to download .*subtitle/i;
const SUB_ARGS = new Set(['--write-subs', '--write-auto-subs', '--sub-format', '--sub-langs']);

/** 파일명에서 자막 언어코드를 뗀다 — `제목.eng-US.vtt` → `eng-us` */
function _subCode(file) {
  const m = String(file || '').match(/\.([A-Za-z0-9_-]+)\.vtt$/i);
  return m ? m[1].toLowerCase() : '';
}

/**
 * 내려온 자막 여러 개 중 하나를 고른다.
 * 🔑 **`-orig`(원본)이 최우선** — 이름 길이로 고르면 `zh-Hant` 같은 긴 코드에서 조용히 번역본을 집는다.
 *    그다음은 **요청한 순서**를 존중한다(정확 일치 → 접두 일치). 마지막에야 첫 파일로 떨어진다.
 */
function pickSubFile(files, prefs) {
  const list = (files || []).filter(Boolean);
  if (!list.length) return null;
  const orig = list.find((f) => /-orig\.vtt$/i.test(f));
  if (orig) return orig;
  const bases = (prefs || []).map((p) => String(p).replace(/\.\*$/, '').toLowerCase()).filter(Boolean);
  for (const b of bases) { const hit = list.find((f) => _subCode(f) === b); if (hit) return hit; }
  for (const b of bases) { const hit = list.find((f) => _subCode(f).startsWith(b)); if (hit) return hit; }
  return list[0];
}

/** 비메오가 「로그인해야 한다」고 거절했나 — 플레이어 주소로 갈아탈 조건이다. */
function needsVimeoPlayer(stderr) {
  return /only works when logged-in|--cookies|account credentials/i.test(String(stderr || ''));
}

// 🔑 `vimeo.com/76979871` · `vimeo.com/channels/staffpicks/76979871` · `/groups/x/videos/N` 등에서 번호만 뽑는다.
const VIMEO_ID_RE = /^https?:\/\/(?:www\.)?vimeo\.com\/(?:channels\/[^/]+\/|groups\/[^/]+\/videos\/|album\/\d+\/video\/|manage\/videos\/)?(\d+)/i;

/**
 * 실패한 주소의 **대안 주소**. 지금은 비메오 하나뿐이다.
 * 🔴 실측(2026-09-15): 비메오는 `vimeo.com/<번호>` 의 로그인 없는 접근을 막았다(공개 영상 4개 전부 · yt-dlp
 *    최신·nightly 동일). 그런데 **`player.vimeo.com/video/<번호>` 는 그대로 된다**(16.6MB mp3 실제 수신 확인).
 *    사용자는 주소창의 `vimeo.com/...` 를 붙여넣으므로 **앱이 바꿔 한 번 더 시도한다.**
 * ⚠ 무조건 바꾸지 않는다 — 로그인 요구 오류일 때만. 쿠키가 있어 원래 주소가 되는 환경을 망치지 않는다.
 */
function altUrl(url, stderr) {
  if (!needsVimeoPlayer(stderr)) return null;
  const m = String(url || '').match(VIMEO_ID_RE);
  return m ? `https://player.vimeo.com/video/${m[1]}` : null;
}

function _explain(stderr) {
  const s = String(stderr || '');
  // ⚠ 「낡은 yt-dlp」로 단정하지 않는다(2026-10-16 — 최신판에서도 유튜브의 일시 차단으로 403 이 났다 · 낡았는지는 버전 줄 「N일 전 판」이 따로 알린다)
  if (/confirm you.re not a bot/i.test(s))
    return '유튜브가 이 PC 의 요청이 많다며 「로봇이 아닌지 확인」을 요구합니다(일시 차단) — 몇 시간 쉬었다 다시 받으세요. 로그인·쿠키로 우회하지 않습니다.';
  if (/HTTP Error 429|Too Many Requests/i.test(s))
    return '유튜브가 요청이 많다며 잠시 막았습니다(429) — 기다렸다 다시 해도 막혀 건너뜁니다. 몇 분 뒤 다시 받아 보세요.';
  if (/HTTP Error 403|Forbidden/i.test(s))
    return '유튜브가 다운로드를 거부했습니다(403) — 재시도 후에도 실패했습니다. 요청 제한·실행 환경·버전을 확인해야 합니다. 자동 업데이트 후에도 계속되면 잠시 뒤 다시 시도하고 오류 로그를 확인하세요.';
  if (/DRM protected/i.test(s))
    return 'DRM 으로 보호된 영상이라 소리를 받을 수 없습니다(비메오 일부 영상 · 자막만 가능). 저작권 보호라 우회하지 않습니다.';
  if (needsVimeoPlayer(s))
    return '비메오가 로그인을 요구합니다 — 이 영상은 로그인 없이 받을 수 없습니다(플레이어 주소로도 실패).';
  if (/player\.vimeo\.com[\s\S]*404|404[\s\S]*player\.vimeo\.com/i.test(s))
    return '이 비메오 영상은 외부 재생(임베드)이 막혀 있어 받을 수 없습니다.';
  if (/Private video|Sign in to confirm your age|members-only/i.test(s))
    return '비공개·연령제한·멤버십 전용 영상이라 받을 수 없습니다.';
  if (/Video unavailable|This video is not available/i.test(s))
    return '영상을 찾을 수 없습니다(삭제·지역제한).';
  if (/Unsupported URL/i.test(s))
    return '지원하지 않는 주소입니다.';
  if (/Unable to download webpage|getaddrinfo|Temporary failure/i.test(s))
    return '네트워크에 연결하지 못했습니다.';
  const line = s.split('\n').map((x) => x.trim()).filter((x) => /^ERROR/i.test(x)).pop();
  return line ? line.replace(/^ERROR:\s*/i, '') : '';
}

/**
 * URL 하나를 내려받는다.
 * @param {object} o
 *   o.mode      'audio' | 'video' | 'both'   받을 것
 *   o.subs      true 면 자막도 함께(원본 언어)
 *   o.outDir    저장 폴더
 *   o.language  probe 로 알아낸 원본 언어(자막 고를 때 씀)
 * @returns {{audio?:string, video?:string, sub?:string}} 실제로 생긴 파일 경로
 */
function requestedSubtitleLanguages(url, o) {
  return o.subtitleLanguage && o.subtitleLanguage !== 'original' ? [o.subtitleLanguage] : subLangPref(o.language, url);
}

function buildDownloadArgs(url, o = {}) {
  const outDir = o.outDir;
  const outputName = o.filenameWithId ? '%(title)s [%(id)s].%(ext)s' : '%(title)s.%(ext)s';
  const args = [
    '--no-playlist',            // 🔑 재생목록 주소 하나가 수백 개를 받는 사고를 막는다
    '--windows-filenames',      // ⚠ --restrict-filenames 를 쓰면 한글 제목이 통째로 사라진다
    '--no-overwrites',
    '--newline',                // 진행률을 줄 단위로 → 로그에 흘릴 수 있다
    '--no-color',
    '-o', path.join(outDir, outputName),
  ];

  const wantAudio = o.mode === 'audio' || o.mode === 'both';
  const wantVideo = o.mode === 'video' || o.mode === 'both';
  const audioFormat = o.audioFormat === 'm4a' ? 'm4a' : 'mp3';
  const quality = ['2160', '1440', '1080', '720', '480'].includes(String(o.quality)) ? String(o.quality) : '';
  args.push('--ignore-config', '--no-cache-dir', '--no-simulate', '--no-quiet', '--progress', '--print', 'before_dl:__PRIMING_BASE__%(filename)s');

  if (o.mode === 'subtitles') {
    args.push('--skip-download');
  } else if (wantVideo) {
    // 🎞 화질 = 늘 최고(해상도·fps 먼저) · **같은 해상도면 H.264 + AAC 우선**(v0.9.17 · 로이 승인 2026-10-14)
    //   정렬 없이 고르면 유튜브는 AV1 + Opus 를 준다(실측: 4K·1080·240p 모두) — Vrew·윈도우 기본 플레이어가 못 열 수 있다.
    //   `vcodec:h264` = 「h264 이하 코덱 중 가장 좋은 것」 우선. 4K·AI 업스케일처럼 H.264 판이 없으면 VP9/AV1 이 그대로 온다.
    args.push('-f', quality ? `bestvideo*[height<=${quality}]+bestaudio/best[height<=${quality}]` : 'bestvideo*+bestaudio/best', '-S', 'res,fps,vcodec:h264,acodec:m4a', '--merge-output-format', 'mp4');
    if (wantAudio) args.push('--extract-audio', '--audio-format', audioFormat, '--audio-quality', '0', '-k');
  } else {
    args.push('-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '--extract-audio', '--audio-format', audioFormat, '--audio-quality', '0');
  }

  if (o.subs || o.mode === 'subtitles') {
    const languages = requestedSubtitleLanguages(url, o);
    if (!languages.every((lang) => /^[a-zA-Z0-9.*_-]+$/.test(lang))) throw new Error('지원하지 않는 자막 언어입니다');
    if (o.subtitleTrack !== 'auto') args.push('--write-subs');
    if (o.subtitleTrack !== 'manual') args.push('--write-auto-subs');
    args.push('--sub-format', 'vtt', '--sub-langs', languages.join(','));
  }
  if (o.ffmpegDir) args.push('--ffmpeg-location', o.ffmpegDir);
  if (o.paced) args.push(...PACE_ARGS);
  // 📄 정보 확인(probe)이 남긴 정보로 받는다 — 같은 영상을 유튜브에 두 번 묻지 않는다
  if (o.infoJsonFile && fs.existsSync(o.infoJsonFile)) args.push('--load-info-json', o.infoJsonFile);
  else args.push(url);
  return args;
}

async function download(url, o = {}) {
  const tool = o.tool || await ensureYtDlp({ onLog: o.onLog });
  const outDir = o.outDir;
  if (!outDir) throw new Error('저장 폴더가 지정되지 않았습니다');
  fs.mkdirSync(outDir, { recursive: true });
  const before = new Set(fs.readdirSync(outDir));
  let args = buildDownloadArgs(url, o);
  const wantAudio = o.mode === 'audio' || o.mode === 'both';
  const wantVideo = o.mode === 'video' || o.mode === 'both';
  const audioFormat = o.audioFormat === 'm4a' ? 'm4a' : 'mp3';
  let resolvedBase = '';

  let lastPct = -1;
  const run = (a) => _spawnYt(tool, a, {
    abortSignal: o.abortSignal,
    timeoutMs: o.timeoutMs || 30 * 60 * 1000,
    onLine: (ln) => {
      if (ln.startsWith('__PRIMING_BASE__')) { resolvedBase = path.basename(ln.slice('__PRIMING_BASE__'.length)); return; }
      const m = ln.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (m) {
        const raw = parseFloat(m[1]);
        // 화면 진행 표시용 — 1% 단위(o.onProgress). 로그는 10% 단위로만(폭주 방지).
        if (o.onProgress) { try { o.onProgress({ pct: raw, stage: 'download' }); } catch {} }
        const p = Math.floor(raw / 10) * 10;
        if (o.onLog && p !== lastPct) { lastPct = p; o.onLog(`  ↓ ${p}%`); }
        return;
      }
      if (/^\[(ExtractAudio|Merger|FixupM4a)\]/.test(ln)) {
        if (o.onProgress) { try { o.onProgress({ pct: 100, stage: 'convert' }); } catch {} }
        if (o.onLog) o.onLog('  ↳ 변환 중…');
      }
    },
  });
  let r = await run(args);
  // ⏳ 유튜브의 일시 차단(403·429)은 잠깐 기다리면 풀린다(2026-10-16 실측: 앱에서 5초 만에 403 → 몇 분 뒤 같은 영상 정상) — 두 번까지 다시
  //   다시 받을 땐 남겨 둔 정보(--load-info-json)를 버리고 주소로 — 받을 주소가 낡아 막혔을 수 있다
  const li = args.indexOf('--load-info-json');
  if (li >= 0) args = [...args.slice(0, li), ...args.slice(li + 2), url];
  for (const wait of BLOCK_WAITS) {
    if (r.code === 0 || !BLOCK_RE.test(r.stderr || '') || SUB_FAIL_RE.test(r.stderr || '') || (o.abortSignal && o.abortSignal())) break;
    if (o.onLog) o.onLog(`  ⏳ 유튜브가 잠시 막았습니다(${blockLabel(r.stderr)}) — ${wait}초 뒤 다시 받습니다`);
    await new Promise((res) => setTimeout(res, (o._waitScale != null ? o._waitScale : 1000) * wait));
    if (o.abortSignal && o.abortSignal()) break;
    r = await run(args);
  }
  // 🔁 자막만 실패(429 등)하면 영상까지 버리지 않는다 — 자막 없이 한 번 더(이미 받은 영상은 --no-overwrites 로 그대로 · 음성은 STT 가 맡는다 · v0.9.38)
  if (r.code !== 0 && o.subs && o.mode !== 'subtitles' && !o.requireSubs && SUB_FAIL_RE.test(r.stderr || '') && !(o.abortSignal && o.abortSignal())) {
    if (o.onLog) o.onLog(`  ⚠ 자막을 못 받았습니다(${(_explain(r.stderr) || '').slice(0, 120)}) — 자막 없이 다시 받습니다(음성은 STT 로)`);
    const noSub = args.filter((x, i) => !SUB_ARGS.has(x) && !(i > 0 && args[i - 1] === '--sub-format') && !(i > 0 && args[i - 1] === '--sub-langs'));
    r = await run(noSub);
  }
  if (r.code !== 0) {
    const err = new Error(_explain(r.stderr) || `다운로드 실패 (코드 ${r.code})`);
    err.raw = r.stderr;
    throw err;
  }

  // 새로 생긴 파일만 집는다(같은 폴더에 예전 파일이 있어도 헷갈리지 않게)
  const after = fs.readdirSync(outDir);
  const made = after.filter((f) => !before.has(f));
  // 채널 재실행은 ID가 붙은 기존 파일도 결과로 돌려준다. 그래야 이미 받은 수백 건을 다시 STT 하지 않는다.
  const idMark = o.mediaId ? `[${String(o.mediaId)}]` : '';
  const stem = resolvedBase ? path.basename(resolvedBase, path.extname(resolvedBase)) : '';
  const candidates = stem ? after.filter((f) => f === resolvedBase || f.startsWith(stem + '.')) : idMark ? after.filter((f) => f.includes(idMark)) : made;
  const pick = (re) => {
    const f = candidates.find((x) => stem && path.basename(x, path.extname(x)) === stem && re.test(x)) || (!stem && candidates.filter((x) => re.test(x)).sort((a, b) => b.length - a.length)[0]);
    return f ? path.join(outDir, f) : null;
  };
  // 🔑 자막 고르기는 `pickSubFile` 한 곳에서만 한다(`-orig` 우선 → 요청 순서 → 첫 파일).
  const languages = requestedSubtitleLanguages(url, o);
  const subFiles = candidates.filter((f) => /\.vtt$/i.test(f) && languages.some((lang) => {
    const pattern = lang.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`\\.${pattern}\\.vtt$`, 'i').test(f);
  }));
  const subMain = pickSubFile(subFiles, subLangPref(o.language, url));
  if (o.mode === 'subtitles' && !subMain) throw new Error('선택한 언어의 자막이 제공되지 않습니다');
  const audio = wantAudio ? pick(new RegExp(`\\.${audioFormat}$`, 'i')) : null;
  const video = wantVideo ? pick(/\.(mp4|mkv|webm)$/i) : null;
  if ((wantAudio && !audio) || (wantVideo && !video)) throw new Error('다운로드 결과 파일을 찾지 못했습니다');
  return {
    audio, video,
    sub: (o.subs || o.mode === 'subtitles') && subMain ? path.join(outDir, subMain) : null,
    subExtras: subFiles.filter((f) => f !== subMain).map((f) => path.join(outDir, f)),
    files: made.map((f) => path.join(outDir, f)),
    reused: !!idMark && candidates.some((f) => before.has(f)),
  };
}

function vttToSrt(value) {
  const cues = [];
  const stamp = (s) => (s.split(':').length === 2 ? '00:' + s : s).replace('.', ',');
  for (const block of String(value || '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((line) => /\d{2}:\d{2}[.,]\d{3}\s*-->/.test(line));
    if (at < 0) continue;
    const time = lines[at].match(/((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})/);
    if (!time) continue;
    const text = lines.slice(at + 1).join('\n').replace(/<[^>]*>/g, '').trim();
    if (text) cues.push(`${cues.length + 1}\n${stamp(time[1])} --> ${stamp(time[2])}\n${text}`);
  }
  if (!cues.length) throw new Error('자막에서 시간 정보를 읽지 못했습니다');
  return cues.join('\n\n') + '\n';
}

function exportSubtitles(files, format = 'srt') {
  if (!['srt', 'vtt', 'txt'].includes(format)) throw new Error('지원하지 않는 자막 형식입니다');
  return files.filter(Boolean).map((file) => {
    if (format === 'vtt') return file;
    const content = fs.readFileSync(file, 'utf8');
    const out = file.replace(/\.vtt$/i, '.' + format);
    const text = format === 'srt' ? vttToSrt(content) : vttToText(content).join('\n');
    if (!text.trim()) throw new Error('자막 내용이 비어 있습니다');
    if (!fs.existsSync(out)) fs.writeFileSync(out, text, { encoding: 'utf8', flag: 'wx' });
    return out;
  });
}

async function fetchSubtitleText(url, o = {}) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('영상 주소를 입력하세요');
  const tool = o.tool || await ensureYtDlp({ onLog: o.onLog });
  const { url: resolvedUrl, info } = await probeSmart(url, { tool, abortSignal: o.abortSignal });
  if (info.isPlaylist) throw new Error('재생목록 대신 영상 한 개의 주소를 입력하세요');
  if (!(o.subtitleTrack === 'auto' ? info.hasAutoSub : o.subtitleTrack === 'manual' ? info.hasManualSub : info.hasManualSub || info.hasAutoSub)) {
    throw new Error('선택한 언어·트랙의 자막이 없습니다');
  }
  const language = selectSubtitleLanguage(info, o.subtitleLanguage, o.subtitleTrack);
  if (!language) throw new Error('선택한 언어·트랙의 자막이 없습니다');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'priming-subtitle-copy-'));
  try {
    const result = await download(resolvedUrl, { tool, outDir: dir, mode: 'subtitles', subs: true, requireSubs: true,
      subtitleLanguage: language, subtitleTrack: o.subtitleTrack || 'any', abortSignal: o.abortSignal, onLog: o.onLog });
    const text = subtitleFileToText(result.sub);
    if (!text.trim()) throw new Error('복사할 자막 내용이 없습니다');
    return { text, title: info.title, language };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = {
  BIN_DIR, OWN_EXE, RELEASE_URL, NIGHTLY_URL, NIGHTLY_RELEASE_API, STALE_DAYS,
  parseVersionDate, versionAgeDays, isStale, compareToolVersions,
  findYtDlp, downloadYtDlp, ensureYtDlp,
  vttToText, subtitleFileToText, subLangPref, pickSubFile,
  probe, probeSmart, download, fetchSubtitleText, listChannelVideos, channelUrlOfVideo,
  normalizeChannelUrl, channelEntryUrl, safeFolderName,
  altUrl, needsVimeoPlayer, VIMEO_ID_RE,
  _explain, isBlocked, PACE_ARGS, jsRuntimeArgs, buildDownloadArgs, vttToSrt, exportSubtitles, normalizePlaylistUrl, selectSubtitleLanguage,
};
