'use strict';
/**
 * core/lecture-render.js — 🎓 강의 화면표 + 리모션 mp3 → 강의 MP4 (v1.0.34 · 2.0 덧붙임4 ㊿)
 *
 * 길: 화면표(core/lecture-html) → 낭독 mp3 를 풀어 길이를 잰다 → 시간표 → HTML 한 장 → HyperFrames 로 소리 없는 MP4
 *     → 낭독을 시간표 자리에 놓은 WAV 한 개 → ffmpeg 로 합친다(영상은 다시 인코딩하지 않음).
 *
 * 🔴 관리자·개발 PC 전용(core/edition FEATURES.lecture · 판매판에서 이 파일째 빠진다).
 * 🔴 HyperFrames 는 저장소 밖 폴더(`~/.priming-maker/hyperframes`)에 깐다 — ⛔ package.json 에 넣지 않는다
 *    (dependencies 가 바뀌면 라이트 업데이트가 막히고 회원 PC 재설치가 따라온다).
 *    판은 HF_VERSION 하나로 고정(2026-10-21 판 · ㊻ 실측 판) · ⛔ GSAP 를 깔지 않는다.
 * 🔴 HyperFrames 는 Node 22 이상이 필요하다 — Electron 33 의 node(20)로는 돌리지 않고 PC 에 깔린 node 를 찾는다.
 * 🔴 사용 통계 전송은 늘 끈다(HYPERFRAMES_NO_TELEMETRY · DO_NOT_TRACK) · `publish` 명령은 쓰지 않는다.
 * 🔴 낭독은 mp3 를 풀어 **표본 단위로** 제자리에 놓는다 — mp3 이어 붙이기(concat)는 파일마다 인코더 지연이 쌓여 뒤로 갈수록 어긋난다.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const LH = require('./lecture-html');

const HF_VERSION = '0.8.185';
const HF_DIR = process.env.PRIMING_HYPERFRAMES_DIR || path.join(os.homedir(), '.priming-maker', 'hyperframes');
const RATE = 48000;
const HF_ENV = { HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_SKIP_SKILLS: '1' };
const FONT = path.join(__dirname, '..', 'assets', 'fonts', 'Pretendard-Bold.ttf');

function ffmpegBin() {
  let p = require('ffmpeg-static');
  if (p && p.includes('app.asar') && !p.includes('app.asar.unpacked')) p = p.replace('app.asar', 'app.asar.unpacked');
  return p;
}
function hfBin() { return path.join(HF_DIR, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs'); }
function hfInstalledVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(HF_DIR, 'node_modules', 'hyperframes', 'package.json'), 'utf8')).version || null; } catch (_) { return null; }
}

/** PC 에 깔린 node(22+) 찾기 — PRIMING_NODE > PATH 의 node */
function findNode() {
  return new Promise((resolve) => {
    const ver = (bin) => new Promise((r) => execFile(bin, ['-v'], { windowsHide: true, timeout: 8000 }, (e, out) => r(e ? null : String(out).trim())));
    const pick = async (cands) => {
      for (const c of cands) {
        const v = await ver(c);
        const m = v && /^v(\d+)/.exec(v);
        if (m && Number(m[1]) >= 22) return { bin: c, version: v };
      }
      return null;
    };
    if (process.env.PRIMING_NODE) return pick([process.env.PRIMING_NODE]).then(resolve);
    const finder = process.platform === 'win32' ? 'where' : 'which';
    execFile(finder, ['node'], { windowsHide: true, timeout: 8000 }, (e, out) => {
      const cands = e ? [] : String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      // Electron 실행 파일 자신(node 로 흉내)은 node 20 이라 쓰지 않는다
      pick(cands.filter((c) => !/electron/i.test(c))).then(resolve);
    });
  });
}

async function status() {
  const node = await findNode();
  const v = hfInstalledVersion();
  return { installed: !!v && fs.existsSync(hfBin()), version: v, want: HF_VERSION, dir: HF_DIR, node: node && node.version, nodeOk: !!node };
}

/** HyperFrames 를 저장소 밖 폴더에 깐다(개발 PC · npm 필요) */
function setup({ onLine = () => {} } = {}) {
  fs.mkdirSync(HF_DIR, { recursive: true });
  const pj = path.join(HF_DIR, 'package.json');
  if (!fs.existsSync(pj)) fs.writeFileSync(pj, JSON.stringify({ name: 'priming-hyperframes', private: true }, null, 2));
  return new Promise((resolve, reject) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const p = spawn(npm, ['i', 'hyperframes@' + HF_VERSION, '--no-fund', '--no-audit', '--save-exact'], { cwd: HF_DIR, env: { ...process.env, ...HF_ENV }, windowsHide: true, shell: process.platform === 'win32' });
    let tail = '';
    const on = (b) => { tail = (tail + b).slice(-4000); String(b).split(/\r?\n/).filter(Boolean).forEach((l) => onLine('   ' + l)); };
    p.stdout.on('data', on); p.stderr.on('data', on);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 && hfInstalledVersion() === HF_VERSION ? resolve(status()) : reject(new Error('HyperFrames 설치 실패(코드 ' + code + ') ' + tail.slice(-400)))));
  });
}

/** mp3·wav → 48k 모노 16비트 표본 */
function decodePcm(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegBin(), ['-v', 'error', '-i', file, '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', String(RATE), '-'], { windowsHide: true });
    const chunks = []; let err = '';
    p.stdout.on('data', (b) => chunks.push(b));
    p.stderr.on('data', (b) => { err += b; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('소리를 풀지 못했습니다 — ' + path.basename(file) + ' ' + err.slice(-200)));
      const buf = Buffer.concat(chunks);
      resolve(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)));
    });
  });
}

function wavBuffer(samples) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.length * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** 화면표 파일명 → 실제 소리 파일(확장자가 없으면 .mp3 → .wav) */
function resolveAudio(audioDir, name) {
  const c = /\.(mp3|wav|m4a|flac)$/i.test(name) ? [name] : [name + '.mp3', name + '.wav'];
  for (const n of c) { const p = path.join(audioDir, n); if (fs.existsSync(p)) return p; }
  return null;
}

/** 화면표 + 소리 폴더 → 시간표·HTML·소리(파일은 쓰지 않음) */
async function prepare({ screenText, audioDir, pad }) {
  const { slides, errors } = LH.parseScreenTsv(screenText);
  if (errors.length) { const e = new Error('화면표 오류 ' + errors.length + '건 — ' + errors.slice(0, 3).map((x) => x.line + '행: ' + x.message).join(' · ')); e.errors = errors; throw e; }
  if (!slides.length) throw new Error('화면표에 화면이 없습니다');
  const names = [...new Set(slides.flatMap((s) => s.files))];
  const missing = names.filter((n) => !resolveAudio(audioDir, n));
  if (missing.length) throw new Error('낭독 파일이 없습니다(' + missing.length + '개) — ' + missing.slice(0, 5).join(', ') + ' · 먼저 🎤 mp3 만들기');
  const pcm = new Map();
  const q = [...names];
  await Promise.all(Array.from({ length: Math.min(4, q.length) }, async () => {
    while (q.length) { const n = q.shift(); pcm.set(n, await decodePcm(resolveAudio(audioDir, n))); }
  }));
  const plan = LH.planTimeline(slides, (n) => pcm.get(n).length / RATE, { pad });
  const total = Math.round(plan.total * RATE);
  const mix = new Int16Array(total);
  for (const sl of plan.slides) {
    sl.files.forEach((f, i) => {
      const src = pcm.get(f), at = Math.round(sl.steps[i] * RATE);
      mix.set(src.subarray(0, Math.max(0, Math.min(src.length, total - at))), at);
    });
  }
  return { plan, html: LH.buildHtml(plan), wav: wavBuffer(mix) };
}

function runHf({ nodeBin, projDir, outFile, onProgress, abortSignal }) {
  return new Promise((resolve, reject) => {
    const p = spawn(nodeBin, [hfBin(), 'render', projDir, '-o', outFile, '--fps', '30', '--quiet'], { cwd: projDir, env: { ...process.env, ...HF_ENV }, windowsHide: true });
    let tail = '';
    const on = (b) => {
      const s = String(b); tail = (tail + s).slice(-6000);
      for (const m of s.matchAll(/@hf-progress (\{[^\n]*\})/g)) { try { onProgress(JSON.parse(m[1])); } catch (_) {} }
    };
    p.stdout.on('data', on); p.stderr.on('data', on);
    const iv = setInterval(() => { if (abortSignal && abortSignal()) { try { p.kill(); } catch (_) {} } }, 500);
    p.on('error', (e) => { clearInterval(iv); reject(e); });
    p.on('close', (code) => {
      clearInterval(iv);
      if (abortSignal && abortSignal()) return reject(new Error('중단됨'));
      if (code !== 0 || !fs.existsSync(outFile)) return reject(new Error('HyperFrames 굽기 실패(코드 ' + code + ') ' + tail.slice(-600)));
      resolve();
    });
  });
}

function mux(video, wav, out, total) {
  return new Promise((resolve, reject) => {
    const tmp = out + '.part.mp4';
    const p = spawn(ffmpegBin(), ['-y', '-v', 'error', '-i', video, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', String(RATE), '-t', String(total), '-movflags', '+faststart', tmp], { windowsHide: true });
    let err = ''; p.stderr.on('data', (b) => { err += b; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('소리 합치기 실패 ' + err.slice(-300)));
      try { fs.renameSync(tmp, out); resolve(); } catch (e) { reject(e); }
    });
  });
}

/**
 * 굽기 — screenPath(화면표) · audioDir(리모션 mp3 폴더) · outFile(.mp4) · workDir(HTML 작업 폴더 · 기본 outFile 옆 `_강의html/<이름>`)
 * @returns {{ out, total, slides, renderSec, html }}
 */
async function render({ screenPath, screenText, audioDir, outFile, workDir, pad, onLine = () => {}, onProgress = () => {}, abortSignal }) {
  const st = await status();
  if (!st.installed) throw new Error('HyperFrames 가 깔려 있지 않습니다 — 「⬇ HyperFrames 설치」(개발 PC · ' + HF_DIR + ')');
  if (st.version !== HF_VERSION) onLine(`   ⚠ HyperFrames 판이 다릅니다(깔린 ${st.version} · 맞춘 판 ${HF_VERSION})`);
  const node = await findNode();
  if (!node) throw new Error('Node 22 이상이 없습니다 — HyperFrames 는 PC 에 깔린 node(22+)로 돕니다');
  const text = screenText != null ? screenText : fs.readFileSync(screenPath, 'utf8');
  const t0 = Date.now();
  const { plan, html, wav } = await prepare({ screenText: text, audioDir, pad });
  onLine(`🎓 강의 화면 ${plan.slides.length}장 · ${plan.total.toFixed(1)}초`);
  const base = path.basename(outFile).replace(/\.mp4$/i, '');
  const proj = workDir || path.join(path.dirname(outFile), '_강의html', base);
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'index.html'), html);
  fs.writeFileSync(path.join(proj, 'hyperframes.json'), JSON.stringify({ paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' } }));
  fs.copyFileSync(FONT, path.join(proj, 'Pretendard-Bold.ttf'));
  const wavPath = path.join(proj, 'narration.wav');
  fs.writeFileSync(wavPath, wav);
  const silent = path.join(proj, 'video.mp4');
  try { fs.unlinkSync(silent); } catch (_) {}
  await runHf({ nodeBin: node.bin, projDir: proj, outFile: silent, onProgress, abortSignal });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await mux(silent, wavPath, outFile, plan.total);
  const renderSec = (Date.now() - t0) / 1000;
  onLine(`✅ 강의 MP4 — ${path.basename(outFile)} · ${plan.total.toFixed(1)}초 영상 · 굽기 ${renderSec.toFixed(1)}초`);
  return { out: outFile, total: plan.total, slides: plan.slides.length, renderSec, html: path.join(proj, 'index.html') };
}

module.exports = { HF_VERSION, HF_DIR, RATE, status, setup, findNode, prepare, render, resolveAudio, wavBuffer, decodePcm };
