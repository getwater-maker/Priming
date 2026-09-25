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
async function downloadYtDlp({ onLog } = {}) {
  const log = onLog || (() => {});
  fs.mkdirSync(BIN_DIR, { recursive: true });
  log(`⬇ yt-dlp 최신판을 내려받습니다 — ${RELEASE_URL}`);
  const res = await fetch(RELEASE_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`yt-dlp 내려받기 실패 (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024 * 1024) throw new Error(`받은 파일이 너무 작습니다 (${buf.length} 바이트)`);
  // ⚠ 실행 중인 파일은 덮어쓸 수 없다 → tmp 로 받아 rename(원자적)
  const tmp = OWN_EXE + '.tmp';
  fs.writeFileSync(tmp, buf);
  try { fs.rmSync(OWN_EXE, { force: true }); } catch {}
  fs.renameSync(tmp, OWN_EXE);
  if (!IS_WIN) { try { fs.chmodSync(OWN_EXE, 0o755); } catch {} }
  const r = await _run(OWN_EXE, ['--version'], { timeout: 20000 });
  const ver = r.stdout.trim().split('\n').pop().trim();
  log(`✓ yt-dlp ${ver} 준비 완료 (${(buf.length / 1048576).toFixed(1)}MB)`);
  return { cmd: OWN_EXE, args: [], kind: 'own', version: ver, stale: isStale(ver), ageDays: versionAgeDays(ver) };
}

/**
 * 쓸 수 있는 yt-dlp 를 보장한다.
 * 🔑 **낡은 판은 조용히 쓰지 않는다** — 오디오가 403 으로 죽는데 사용자는 이유를 알 수 없다.
 *    낡았으면 최신판을 받아 그걸 쓰고, 내려받기에 실패하면 있는 것으로라도 진행한다(fail-open).
 */
async function ensureYtDlp({ onLog, forceUpdate = false } = {}) {
  const log = onLog || (() => {});
  let found = await findYtDlp();

  if (found && !forceUpdate && !found.stale) return found;

  if (found && found.stale) {
    log(`ⓘ yt-dlp ${found.version} 은 ${found.ageDays}일 된 판입니다 — 유튜브가 바뀌어 오디오가 막힐 수 있어 최신판을 받습니다.`);
  } else if (!found) {
    log('ⓘ 이 PC 에 yt-dlp 가 없습니다 — 최신판을 받습니다(약 17MB · 한 번만).');
  }

  try {
    return await downloadYtDlp({ onLog: log });
  } catch (e) {
    if (found) {
      log(`⚠ 최신판을 받지 못했습니다 (${e.message}) — 있는 ${found.version} 으로 진행합니다.`);
      return found;
    }
    throw new Error(`yt-dlp 를 준비하지 못했습니다: ${e.message}`);
  }
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
      .replace(/<\d{2}:\d{2}:\d{2}[.,]\d{3}>/g, '')   // 단어별 타이밍 태그
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

// ── 실행 ────────────────────────────────────────────────
function _spawnYt(tool, args, { onLine, abortSignal, timeoutMs = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(tool.cmd, [...tool.args, ...args], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },   // ⚠ 한글 제목이 CP949 로 깨지지 않게
    });
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
    child.on('error', (e) => { clearTimeout(timer); if (poll) clearInterval(poll); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      if (killed === 'abort') return reject(new Error('중단됨'));
      if (killed === 'timeout') return reject(new Error(`시간 초과 (${Math.round(timeoutMs / 60000)}분)`));
      resolve({ code, stdout: out, stderr: err });
    });
  });
}

/** URL 하나의 정보(제목·길이·언어·자막 유무)를 미리 읽는다 — 내려받지 않는다. */
async function probe(url, { tool, abortSignal } = {}) {
  const t = tool || await ensureYtDlp();
  const r = await _spawnYt(t, ['--no-playlist', '--skip-download', '--dump-single-json', url],
    { abortSignal, timeoutMs: 3 * 60 * 1000 });
  // ⚠ 사람 말로 바꾼 메시지만 던지면 호출부가 원인을 못 가린다 → 원문을 `raw` 로 함께 준다(altUrl 판정에 쓴다).
  if (r.code !== 0) {
    const err = new Error(_explain(r.stderr) || `정보를 읽지 못했습니다 (코드 ${r.code})`);
    err.raw = r.stderr;
    throw err;
  }
  const line = r.stdout.split('\n').find((x) => x.trim().startsWith('{'));
  if (!line) throw new Error('정보를 읽지 못했습니다 (응답 없음)');
  const j = JSON.parse(line);
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
  const channelUrl = normalizeChannelUrl(url);
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
  const ofVideo = !o._fromVideo && channelUrlOfVideo(j);
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
    title: String(j.channel || j.uploader || j.title || '채널 영상'),
    entries,
  };
}

/**
 * 자막 언어 우선순위.
 * 🔑 **원본 언어만 쓴다** — 유튜브는 자동자막을 157개 언어로 기계번역해 준다. `ko` 를 무턱대고 요청하면
 *    일본어 영상의 **번역본**을 받아 STT 보다 나쁜 결과를 조용히 쓰게 된다.
 *    `<lang>-orig` 가 원본이고, 원본이 그 언어면 `<lang>` 도 같은 내용이다(실측: 두 파일 바이트 동일).
 * 🔴 **정확 코드만 요청하면 사이트마다 조용히 놓친다** — 틱톡 자막 코드는 `eng-US` 라 `en` 과 안 맞아
 *    `요청한 언어의 자막이 없습니다` 로 떨어졌다(자막이 있는데도 매번 Whisper 를 돌렸다 · 2026-09-15 실측).
 *    → `<lang>.*` 를 **뒤에** 덧붙인다. 앞의 정확 코드가 먼저 걸리므로 유튜브 동작은 그대로다.
 */
function subLangPref(language) {
  const L = String(language || '').split('-')[0].trim();
  if (L) return [`${L}-orig`, L, `${L}.*`];
  return ['ko-orig', 'ko', 'ko.*', 'en-orig', 'en', 'en.*'];
}

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
  if (/HTTP Error 403|Forbidden/i.test(s))
    return '유튜브가 다운로드를 거부했습니다(403) — yt-dlp 가 낡았을 때 나는 증상입니다. 「⬇ 업데이트」를 눌러 주세요.';
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
async function download(url, o = {}) {
  const tool = o.tool || await ensureYtDlp({ onLog: o.onLog });
  const outDir = o.outDir;
  if (!outDir) throw new Error('저장 폴더가 지정되지 않았습니다');
  fs.mkdirSync(outDir, { recursive: true });

  const before = new Set(fs.readdirSync(outDir));
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

  if (wantVideo) {
    args.push('-f', 'bestvideo*+bestaudio/best', '--merge-output-format', 'mp4');
    if (wantAudio) args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0', '-k');
  } else {
    args.push('-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
  }

  if (o.subs) {
    args.push('--write-subs', '--write-auto-subs', '--sub-format', 'vtt',
      '--sub-langs', subLangPref(o.language).join(','));
  }
  if (o.ffmpegDir) args.push('--ffmpeg-location', o.ffmpegDir);
  args.push(url);

  let lastPct = -1;
  const r = await _spawnYt(tool, args, {
    abortSignal: o.abortSignal,
    timeoutMs: o.timeoutMs || 30 * 60 * 1000,
    onLine: (ln) => {
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
  const candidates = idMark ? after.filter((f) => f.includes(idMark)) : made;
  const pick = (re) => {
    const f = candidates.filter((x) => re.test(x)).sort((a, b) => b.length - a.length)[0];
    return f ? path.join(outDir, f) : null;
  };
  // 🔑 자막 고르기는 `pickSubFile` 한 곳에서만 한다(`-orig` 우선 → 요청 순서 → 첫 파일).
  const subFiles = candidates.filter((f) => /\.vtt$/i.test(f));
  const subMain = pickSubFile(subFiles, subLangPref(o.language));
  return {
    audio: wantAudio ? pick(/\.mp3$/i) : null,
    video: wantVideo ? pick(/\.(mp4|mkv|webm)$/i) : null,
    sub: o.subs && subMain ? path.join(outDir, subMain) : null,
    subExtras: subFiles.filter((f) => f !== subMain).map((f) => path.join(outDir, f)),
    files: made.map((f) => path.join(outDir, f)),
    reused: !!idMark && candidates.some((f) => before.has(f)),
  };
}

module.exports = {
  BIN_DIR, OWN_EXE, RELEASE_URL, STALE_DAYS,
  parseVersionDate, versionAgeDays, isStale,
  findYtDlp, downloadYtDlp, ensureYtDlp,
  vttToText, subtitleFileToText, subLangPref, pickSubFile,
  probe, probeSmart, download, listChannelVideos, channelUrlOfVideo,
  normalizeChannelUrl, channelEntryUrl, safeFolderName,
  altUrl, needsVimeoPlayer, VIMEO_ID_RE,
  _explain,
};
