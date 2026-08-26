'use strict';
/**
 * TSV 일괄 TTS — `파일명<탭>문장` 을 받아 **그 파일명 그대로** mp3 를 떨군다.
 *
 * 용도: 리모션(Remotion)처럼 **오디오 파일 길이로 화면 길이를 정하는** 파이프라인.
 *   파일명이 화면과 음성을 잇는 유일한 키라 이름이 바뀌거나 접미사가 붙으면 파이프라인이 깨진다.
 *   그래서 이 모듈은 이름을 **절대 바꾸지 않는다**(중복이면 만들지 않고 에러로 세운다).
 *
 * 🔑 **공용 TTS 캐시(core/tts-cache.js)를 쓰지 않는다 — 일부러다.**
 *   이 경로는 앞뒤 무음을 잘라내는데, 공용 캐시에 그 파일을 넣으면 **로이의 롱폼이 트림된 음성을
 *   재활용**해 기존 .vrew 와 타이밍이 어긋난다. "무음 트림은 신규 기능에만"(로이, 2026-08-26)을
 *   주석이 아니라 **구조로** 지키려고 전용 캐시(`~/.shots-maker/tsv-tts-cache`)를 따로 둔다.
 *   ⛔ 여기서 공용 TtsCache 를 require 하지 말 것.
 *
 * 🔑 **증분 재변환** — 캐시 키는 (가공된 최종 텍스트 + 목소리 + 배속·배속방식 + 트림 설정 + 합성
 *   파라미터)다. 대본에서 **텍스트가 바뀐 문장만** 다시 합성된다. 그 외에는 바이트가 같은 파일이
 *   나오므로 톤이 튀지 않는다.
 *   ⚠ 반대로 **목소리·배속·발음사전을 바꾸면 전량 재합성**된다. 16,000문장 규모에서 제일 비싼
 *     실수이므로 시험 단계에서 확정하고 그 뒤로 건드리지 말 것.
 *
 * 🔑 **처리 순서: 합성 → 트림 → 배속 → mp3.**
 *   배속을 먼저 걸면 무음도 함께 늘어나 트림 임계 판정이 흔들린다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const { trimSilence } = require('./audio-trim');
// 🔑 TTS 로 실제 보내지는 문자열은 **이 함수 하나로만** 만든다(발음사전 → 물결표 정규화).
//   호출부가 넘기는 것을 잊으면 사전이 조용히 무시되므로 여기서 기본값으로 묶는다.
const { processForTTS } = require('../tts/text-pronouncer');

let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
  // Electron asar 패키징 시 app.asar 안 경로는 실행 불가 → app.asar.unpacked 로 보정
  if (ffmpegPath && ffmpegPath.includes('app.asar') && !ffmpegPath.includes('app.asar.unpacked')) {
    ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  }
} catch {}

const CACHE_DIR = path.join(os.homedir(), '.shots-maker', 'tsv-tts-cache');

// 출력 규격 — 2026-08-26 확정: OmniVoice 원본이 24000Hz 라 업샘플은 정보를 늘리지 않는다.
//   (리모션은 ffprobe 로 길이만 재므로 표본율과 무관하다.)
const OUT_RATE = 24000;
const OUT_CHANNELS = 1;
const OUT_BITRATE = '192k';

/**
 * 발음사전 표인지 헤더로 판정한다. **두 칸이고 · 좌측이 「표기」로 끝나고 · 우측에 「읽기」가 있는** 표만.
 *   실제 헤더 2종: `| 화면 표기 | 대본 표기 / 읽기 |` · `| 표기 | 읽기 |`
 * ⛔ 이 문서의 다른 두 칸 표는 일부러 열지 않는다:
 *   · `| 항목 | 확정 시점 |` — 사전이 아니다.
 *   · `| 금지 | 대신 |`(약어표) — 좌측 `A/B 테스트` 가 슬래시로 쪼개져 `A` 와 `B 테스트` 가 된다.
 */
function _isDictHeader(left, right) {
  return /표기$/.test(left) && right.indexOf('읽기') >= 0;
}

// ── TSV 파싱 ─────────────────────────────────────────────
/**
 * `파일명<탭>문장` 을 파싱한다. 빈 줄과 `#` 주석은 건너뛴다.
 * @returns {{rows: Array<{name:string,text:string,line:number}>, errors: Array<{line:number,message:string}>}}
 */
function parseTsv(text) {
  const rows = [];
  const errors = [];
  const seen = new Map();
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.replace(/^﻿/, '');
    if (!line.trim()) return;
    if (line.trim().startsWith('#')) return;
    const tab = line.indexOf('\t');
    if (tab < 0) {
      errors.push({ line: lineNo, message: '탭이 없습니다 (형식: 파일명<탭>문장)' });
      return;
    }
    const name = line.slice(0, tab).trim();
    const sentence = line.slice(tab + 1).trim();
    if (!name) { errors.push({ line: lineNo, message: '파일명이 비었습니다' }); return; }
    if (!sentence) { errors.push({ line: lineNo, message: '문장이 비었습니다 (' + name + ')' }); return; }
    const bad = _nameProblem(name);
    if (bad) { errors.push({ line: lineNo, message: bad + ' (' + name + ')' }); return; }
    if (seen.has(name)) {
      // 조용히 덮어쓰면 **그 문장이 영상에서 사라진다.** 렌더 단계에서는 알아채기 어렵다.
      errors.push({ line: lineNo, message: '파일명이 중복입니다 — ' + seen.get(name) + '행과 ' + lineNo + '행 (' + name + ')' });
      return;
    }
    seen.set(name, lineNo);
    rows.push({ name, text: sentence, line: lineNo });
  });
  return { rows, errors };
}

// 경로 탈출·이상한 이름 차단. 문제가 없으면 null.
function _nameProblem(name) {
  if (name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) return '파일명에 경로 구분자를 쓸 수 없습니다';
  if (name === '.' || name === '..' || name.indexOf('..') >= 0) return '파일명에 ".." 를 쓸 수 없습니다';
  if (/[<>:"|?*]/.test(name)) return '파일명에 쓸 수 없는 문자가 있습니다';
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) < 32) return '파일명에 제어문자가 있습니다';
  }
  if (path.isAbsolute(name)) return '파일명에 절대경로를 쓸 수 없습니다';
  if (name.length > 150) return '파일명이 너무 깁니다';
  return null;
}

// ── 발음사전(.md 표) 파싱 ────────────────────────────────
/**
 * `| 화면 표기 | 대본 표기 |` 꼴의 마크다운 표에서 치환 목록을 만든다.
 * ⚠ 왼쪽 셀의 `A / B` 는 둘 다 같은 발음으로 치환한다. 오른쪽 셀의 `**굵게**`·`(주석)` 은 벗긴다.
 *   오른쪽에 화살표가 있으면 그 뒤를 택한다 — `(쓰지 않는다) → **들어온 길**`.
 * ⚠ 좌우가 같으면 버린다(치환할 게 없다). 이미 띄어 쓴 대본에는 아무것도 걸리지 않는 것이 정상이다.
 * @returns {Array<{source:string, pron:string}>}
 */
function parseDictMd(md) {
  const out = [];
  const seen = new Set();
  // 🔴 **표를 가려 읽지 않으면 대본이 파괴된다.** 이 문서에는 사전 표 말고도 숫자 빈도표
  //   (`| 만 | 967 | ... |`)·원칙표·시험 구성표가 있다. 전부 긁으면 `만` -> `967` 같은 항목이
  //   생겨 "백만 명" 이 "백967 명" 이 된다(2026-08-26 실측: 167개가 잡혔고 대부분 쓰레기였다).
  //   → **헤더가 정확히 두 칸이고 좌측이 `화면 표기` 인 표만** 사전으로 연다.
  let inDict = false;
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    if (line.charAt(0) !== '|') { inDict = false; continue; }   // 표가 끝났다
    const cells = line.split('|').map((c) => c.trim());
    while (cells.length && cells[0] === '') cells.shift();
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    if (cells.length < 2) { inDict = false; continue; }
    if (/^:?-{2,}:?$/.test(cells[0])) continue;            // 구분행 — 표 상태를 유지한다
    const left = _stripMd(cells[0]);
    let right = _stripMd(cells[1]);
    // 헤더행이면 이 표가 사전 표인지 판정한다. 다른 표(빈도·시험 구성)는 열지 않는다.
    if (cells.length === 2 && _isDictHeader(left, right)) { inDict = true; continue; }
    if (!inDict) continue;
    if (!left || !right) continue;
    const arrow = right.lastIndexOf('→');
    if (arrow >= 0) right = _stripMd(right.slice(arrow + 1));
    if (!right) continue;
    for (const src of left.split('/').map((s) => s.trim()).filter(Boolean)) {
      if (src === right) continue;                          // 치환할 게 없다
      // ⚠ 한 글자 치환은 문장 아무 데나 걸려 위험하다. 실제 사전 항목은 모두 두 글자 이상이다.
      if (src.length < 2) continue;
      const key = src + ' ' + right;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ source: src, pron: right });
    }
  }
  return out;
}

function _stripMd(s) {
  return String(s || '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\([^)]*\)/g, '')     // (주석) 제거
    .replace(/\s+/g, ' ')
    .trim();
}

// ── 캐시 ────────────────────────────────────────────────
/** 캐시 키 — 결과 파일을 바꾸는 모든 값이 들어간다. 하나라도 바뀌면 재합성이다. */
function cacheKey(finalText, cfg) {
  cfg = cfg || {};
  const sig = JSON.stringify({
    t: String(finalText || ''),
    v: cfg.voice || '',
    sp: Number(cfg.speed) || 1,
    sm: cfg.speedMode || 'atempo',
    tr: cfg.trim ? { th: cfg.trimThreshold, pad: cfg.padSec } : false,
    sd: cfg.seed != null ? cfg.seed : '',
    cfgv: cfg.cfgValue != null ? cfg.cfgValue : '',
    it: cfg.inferenceTimesteps != null ? cfg.inferenceTimesteps : '',
    lang: cfg.language || '',
    rate: OUT_RATE, ch: OUT_CHANNELS, br: OUT_BITRATE,
  });
  return crypto.createHash('sha1').update(sig).digest('hex');
}

function cacheGet(key) {
  const f = path.join(CACHE_DIR, key + '.mp3');
  const m = path.join(CACHE_DIR, key + '.json');
  try {
    if (!fs.existsSync(f) || !fs.existsSync(m)) return null;
    const meta = JSON.parse(fs.readFileSync(m, 'utf8'));
    return { file: f, dur: meta.dur, trimmedSec: meta.trimmedSec || 0 };
  } catch { return null; }
}

function cachePut(key, file, meta) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.copyFileSync(file, path.join(CACHE_DIR, key + '.mp3'));
    fs.writeFileSync(path.join(CACHE_DIR, key + '.json'), JSON.stringify(meta || {}), 'utf8');
  } catch {}
}

// ── mp3 인코딩 ───────────────────────────────────────────
/**
 * WAV 파일 → mp3. tempo 가 1 이 아니면 atempo 로 배속(피치 유지). 성공 시 true.
 * ⚠ atempo 는 0.5~2.0 만 받는다. 그 밖이면 ffmpeg 가 실패하므로 호출부가 미리 막아야 한다.
 */
function encodeMp3(wavPath, mp3Path, tempo) {
  if (!ffmpegPath) return { ok: false, durationSec: null };
  const args = ['-y', '-i', wavPath];
  if (tempo && Math.abs(tempo - 1) > 0.001) args.push('-filter:a', 'atempo=' + tempo);
  args.push('-codec:a', 'libmp3lame', '-b:a', OUT_BITRATE,
            '-ar', String(OUT_RATE), '-ac', String(OUT_CHANNELS), mp3Path);
  // 🔑 stderr 를 받아 **인코딩하면서 길이까지 읽는다.** 따로 재면 ffmpeg 를 한 번 더 띄우게 되는데,
  //   16,000문장 규모에서 그 왕복이 약 1.8시간이다(2026-08-26 실측: 문장당 3.54초 → 2.0초대).
  const r = spawnSync(ffmpegPath, args, { encoding: 'utf8' });
  const ok = r.status === 0 && fs.existsSync(mp3Path);
  return { ok, durationSec: ok ? _lastTime(r.stderr) : null };
}

// ffmpeg 진행 로그의 마지막 `time=HH:MM:SS.ms` → 초. 못 찾으면 null.
function _lastTime(stderr) {
  const m = String(stderr || '').match(/time=(\d+):(\d+):(\d+\.\d+)/g);
  if (!m || !m.length) return null;
  const p = m[m.length - 1].slice(5).split(':');
  const sec = (+p[0]) * 3600 + (+p[1]) * 60 + (+p[2]);
  return Number.isFinite(sec) && sec > 0 ? sec : null;
}

/** mp3 실제 길이(초). ffprobe 대신 ffmpeg 로 잰다(ffprobe 는 번들에 없다). */
function mp3DurationSec(file) {
  if (!ffmpegPath) return null;
  const r = spawnSync(ffmpegPath, ['-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  const out = String(r.stderr || '');
  const m = out.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
  if (!m || !m.length) return null;
  const last = m[m.length - 1].slice(5).split(':');
  return (+last[0]) * 3600 + (+last[1]) * 60 + (+last[2]);
}

// ── 실행 ────────────────────────────────────────────────
const ATEMPO_MIN = 0.5, ATEMPO_MAX = 2.0;   // ffmpeg atempo 가 받는 범위
const MAX_CONSEC_FAIL = 5;                   // 연속 이만큼 실패하면 서버 문제로 보고 멈춘다

function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 일시적 디스크 오류(구글드라이브 언마운트 등)를 견딘다. core/pipeline.retryFs 와 같은 취지의 최소판.
async function _retryFs(fn, label, onLine) {
  const delays = [500, 1500, 4000];
  for (let i = 0; ; i++) {
    try { return fn(); }
    catch (e) {
      if (i >= delays.length) throw e;
      if (onLine) onLine('   디스크 오류(' + (e.code || '') + ') — ' + (delays[i] / 1000) + '초 후 재시도: ' + label);
      await _sleep(delays[i]);
    }
  }
}

/**
 * TSV 행들을 mp3 로 변환한다.
 *
 * @param {object} o
 *   o.rows      {Array<{name,text}>}  parseTsv 결과
 *   o.outDir    {string}   출력 폴더 (파일명 그대로 떨군다)
 *   o.ttsMgr    {object}   TTSManager — 호출부가 연결까지 마친 것을 넘긴다
 *   o.voice     {string}   서버 공용 목소리 이름 (예: '#01_득수_noBreath')
 *   o.speed     {number}   배속 (1=원래 속도, 0.9=조금 느리게)
 *   o.speedMode {'atempo'|'server'}  느리게 만드는 방식. 아래 주석 참조.
 *   o.trim      {boolean}  앞뒤 무음 제거 (기본 true)
 *   o.dict      {Array}    발음사전 항목
 *   o.prefix    {string}   파일명 앞에 붙일 접두(시험용). 기본 '' — 평소엔 이름을 바꾸지 않는다.
 *   o.force     {boolean}  캐시·기존 파일을 무시하고 전부 다시 만든다
 *   o.onLine, o.onProgress, o.abortSignal
 *
 * 🔑 **speedMode 는 결과가 다르다.**
 *   · `server` — OmniVoice 에 `speed` 를 넘겨 **모델이 실제로 천천히 발화**한다(운율이 살아 있다).
 *   · `atempo` — 1.0 으로 합성한 뒤 ffmpeg 로 **파형을 늘린다**(피치는 유지되지만 늘어진 느낌이 날 수 있다).
 *   앱의 롱폼은 예부터 atempo 를 써 왔지만 **어느 쪽이 나은지는 들어 봐야 안다**(내가 판정할 수 없는 영역).
 *   그래서 둘 다 지원하고 기본은 검증된 atempo 로 둔다.
 */
async function runTsvBatch(o) {
  const onLine = o.onLine || (() => {});
  const abort = o.abortSignal || (() => false);
  const rows = o.rows || [];
  const outDir = o.outDir;
  const prefix = o.prefix || '';
  const speed = Number(o.speed) || 1;
  const speedMode = o.speedMode === 'server' ? 'server' : 'atempo';
  const doTrim = o.trim !== false;
  const padSec = o.padSec != null ? o.padSec : undefined;
  const trimThreshold = o.trimThreshold != null ? o.trimThreshold : undefined;

  if (!ffmpegPath) throw new Error('ffmpeg 를 찾을 수 없습니다 — mp3 를 만들 수 없습니다.');
  if (speedMode === 'atempo' && (speed < ATEMPO_MIN || speed > ATEMPO_MAX)) {
    throw new Error('배속 ' + speed + ' 는 atempo 범위(' + ATEMPO_MIN + '~' + ATEMPO_MAX + ') 밖입니다.');
  }
  await _retryFs(() => fs.mkdirSync(outDir, { recursive: true }), '출력 폴더 만들기', onLine);

  const cfg = {
    voice: o.voice, speed, speedMode,
    trim: doTrim, trimThreshold, padSec,
    seed: o.seed, cfgValue: o.cfgValue, inferenceTimesteps: o.inferenceTimesteps, language: o.language,
  };
  const synthOpts = {
    provider: 'omnivoice',
    refName: o.voice || undefined,
    seed: o.seed, cfgValue: o.cfgValue, inferenceTimesteps: o.inferenceTimesteps,
    language: o.language,
    // server 모드에서만 서버에 배속을 넘긴다. atempo 모드는 1.0 으로 합성하고 나중에 늘린다.
    speed: speedMode === 'server' ? speed : 1,
  };

  const manPath = path.join(outDir, '_manifest.json');
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(manPath, 'utf8')); } catch {}

  const made = [], skipped = [], failed = [];
  let consecFail = 0, totalDur = 0, totalTrimmed = 0;
  const t0 = Date.now();

  for (let i = 0; i < rows.length; i++) {
    if (abort()) { onLine('중단되었습니다 — ' + i + '/' + rows.length + ' 까지 처리했습니다.'); break; }
    const row = rows[i];
    const outName = prefix + row.name;
    const outPath = path.join(outDir, outName);
    const tag = '[' + (i + 1) + '/' + rows.length + '] ' + outName;

    const finalText = o.dictApply ? o.dictApply(row.text) : processForTTS(row.text, o.dict || []);
    const key = cacheKey(finalText, cfg);

    // ── 이어받기: 파일이 그대로 있고 키가 같으면 건드리지 않는다 ──
    if (!o.force && manifest[outName] && manifest[outName].key === key && fs.existsSync(outPath)) {
      skipped.push(outName);
      totalDur += manifest[outName].dur || 0;
      if (o.onProgress) o.onProgress(i + 1, rows.length);
      continue;
    }

    // ── 전용 캐시 ──
    if (!o.force) {
      const hit = cacheGet(key);
      if (hit) {
        try {
          await _retryFs(() => fs.copyFileSync(hit.file, outPath), tag + ' 캐시 복사', onLine);
          manifest[outName] = { key, dur: hit.dur, text: finalText, trimmedSec: hit.trimmedSec };
          made.push(outName);
          totalDur += hit.dur || 0;
          onLine(tag + '  재활용 ' + (hit.dur || 0).toFixed(2) + '초');
          if (o.onProgress) o.onProgress(i + 1, rows.length);
          continue;
        } catch (e) { /* 복사 실패면 아래에서 새로 만든다 */ }
      }
    }

    // ── 합성 ──
    let res = null, lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (abort()) break;
      try { res = await o.ttsMgr.synthesize(finalText, synthOpts); break; }
      catch (e) {
        lastErr = e;
        if (attempt < 3) {
          onLine(tag + '  TTS 실패(' + attempt + '/3) — 재시도: ' + e.message);
          await _sleep(1500 * attempt);
        }
      }
    }
    if (!res) {
      failed.push({ name: outName, text: row.text, reason: lastErr ? lastErr.message : '중단' });
      consecFail++;
      onLine(tag + '  실패: ' + (lastErr ? lastErr.message : '중단'));
      if (consecFail >= MAX_CONSEC_FAIL) {
        onLine('연속 ' + consecFail + '개 실패 — 서버 문제로 보고 멈춥니다. 남은 항목은 시도하지 않습니다.');
        break;
      }
      continue;
    }
    consecFail = 0;

    // ── 트림 → 배속 → mp3 ──
    const tmpWav = path.join(outDir, '_tmp_' + process.pid + '.wav');
    try {
      let buf = res.mp3Buffer;      // ⚠ 이름은 mp3 지만 실제 내용은 WAV 다(OmniVoice 출력).
      let trimmedSec = 0;
      if (doTrim) {
        const t = trimSilence(buf, { padSec, threshold: trimThreshold });
        if (t.changed) { buf = t.buf; trimmedSec = t.trimmedSec; }
        else if (t.reason) onLine(tag + '  트림 안 함: ' + t.reason);
      }
      await _retryFs(() => fs.writeFileSync(tmpWav, buf), tag + ' 임시 WAV', onLine);
      const tempo = speedMode === 'atempo' ? speed : 1;
      const enc = encodeMp3(tmpWav, outPath, tempo);
      if (!enc.ok) throw new Error('mp3 인코딩 실패(ffmpeg)');
      // 길이는 인코딩 로그에서 함께 얻는다. 못 읽었을 때만 따로 잰다(드문 경우).
      const dur = enc.durationSec || mp3DurationSec(outPath) || (res.durationSec ? res.durationSec / tempo : 0);
      cachePut(key, outPath, { dur, trimmedSec, text: finalText });
      manifest[outName] = { key, dur, text: finalText, trimmedSec };
      made.push(outName);
      totalDur += dur;
      totalTrimmed += trimmedSec;
      onLine(tag + '  ' + dur.toFixed(2) + '초'
        + (trimmedSec ? ' (무음 ' + trimmedSec.toFixed(2) + '초 제거)' : ''));
    } catch (e) {
      failed.push({ name: outName, text: row.text, reason: e.message });
      consecFail++;
      onLine(tag + '  저장 실패: ' + e.message);
      if (consecFail >= MAX_CONSEC_FAIL) {
        onLine('연속 ' + consecFail + '개 저장 실패 — 멈춥니다.');
        break;
      }
    } finally {
      try { fs.unlinkSync(tmpWav); } catch {}
    }
    if (o.onProgress) o.onProgress(i + 1, rows.length);
  }

  // ── 매니페스트 · 실패 리포트 ──
  try { fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2), 'utf8'); } catch {}
  const failPath = path.join(outDir, '_failed.txt');
  try {
    if (failed.length) {
      fs.writeFileSync(failPath,
        failed.map((f) => f.name + '\t' + f.reason + '\t' + f.text).join('\n') + '\n', 'utf8');
    } else if (fs.existsSync(failPath)) {
      fs.unlinkSync(failPath);   // 지난 실행의 실패 목록이 남아 오해를 부르지 않게
    }
  } catch {}

  return {
    total: rows.length,
    made: made.length,
    skipped: skipped.length,
    failed,
    totalDurationSec: totalDur,
    totalTrimmedSec: totalTrimmed,
    elapsedSec: (Date.now() - t0) / 1000,
    manifestPath: manPath,
    failedPath: failed.length ? failPath : null,
  };
}

module.exports = {
  parseTsv,
  parseDictMd,
  runTsvBatch,
  cacheKey,
  cacheGet,
  cachePut,
  encodeMp3,
  mp3DurationSec,
  trimSilence,
  hasFfmpeg: () => !!ffmpegPath,
  CACHE_DIR,
  OUT_RATE,
  OUT_CHANNELS,
  OUT_BITRATE,
};
