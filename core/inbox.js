'use strict';
/**
 * inbox.js — 📥 받은 편지함 = 1.0 자동 넘김(v1.0.56 · 요청서 docs/요청서_1.0자동넘김_렌더큐_2026-11-17.md ①②⑤ · 로이 2026-11-17 승인·밤 개정)
 *
 *   채널사업부가 대본 + 패키징 + 썸네일 3장이 끝난 편마다 쪽지(JSON) 하나를 `<홈>\.priming-maker\inbox\` 에 놓는다(임시 이름 → rename).
 *   화면 앱(main)이 5초마다 훑어 받은 편을 **로이가 쓰는 작업큐**에 넣고, 큐가 놀면 그 편들을 run-batch 로 이어 만든다.
 *   이 파일 = 쪽지 읽기·꼴 검사·받기 판정(거절 사유)·쪽지 옮기기·「자동 제작 멈춤」 상태·progress.json 쓰기 · 채널 값으로 만들 도구 고르기.
 *   큐에 넣기·제작·화면 알림은 main(_inbox*) 이 한다(이 파일은 fs 와 순수 계산만).
 *
 *   폴더: inbox\(새 쪽지) → inbox\진행중\(큐에 넣음 — 앱이 꺼졌다 켜지면 여기서 다시 큐에 넣는다) → inbox\처리됨\ · 못 받으면 inbox\거절\(reason 을 더해)
 *   시각은 모두 KST(전역 규칙). ⛔ 쪽지의 publishAt 은 1단계에서 읽기만 한다(⑦ 예약은 2단계).
 *   🔴 채널은 쪽지가 정하지 않는다 — 대본 경로가 들어 있는 채널 「대본 폴더」(scriptFolder · 가장 깊은 폴더 하나)로 고른다.
 * 테스트: test/inbox.test.js · test/inbox.smoke.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const SUB = { doing: '진행중', done: '처리됨', reject: '거절' };
// 거절 사유(채널사업부 확인판이 그대로 읽는다 — 글자를 바꾸면 회신 절도 고칠 것)
const REASON = {
  form: '꼴 오류',
  noScript: '대본 파일 없음',
  noPack: '패키징 미완',
  noChannel: '채널 없음',
  manyChannel: '채널 둘 이상',
  inQueue: '이미 큐에 있음',
  made: '이미 만들었음',
  roy: '🟥 미확인 경험',
  notPilot: '시범 채널 아님',
  fail: '제작 실패',
  noUploadCh: '업로드채널 없음',   // ⬆ kind "upload"
  noMp4: 'MP4 없음',
  upFail: '업로드 준비 실패',
};
const YOUNG_MS = 15000;   // 막 놓인(쓰는 중일 수 있는) 쪽지를 읽지 못하면 다음 번에 다시 본다

// 🧪 시험만 다른 폴더(PM_UI_SMOKE 일 때만 · 로이 앱 데이터를 건드리지 않게) — 그 밖에는 언제나 os.homedir() 아래
function baseDir() {
  if (process.env.PM_UI_SMOKE && process.env.PM_INBOX_HOME) return process.env.PM_INBOX_HOME;
  return path.join(os.homedir(), '.priming-maker');
}
const inboxDir = () => path.join(baseDir(), 'inbox');
const progressFile = () => path.join(baseDir(), 'progress.json');
const stateFile = () => path.join(baseDir(), 'auto-make.json');

/** KST 'YYYY-MM-DD HH:MM:SS' */
function kst(t = Date.now()) { return new Date(t + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 19); }

/** 원자적 쓰기(임시 → rename) — 읽는 쪽(대시보드)이 반쪽 파일을 보지 않게. rename 이 막히면(읽는 중 잠김) 몇 번 다시 */
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  for (let k = 0; ; k++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (k >= 4) { try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (k + 1)); } catch (_) {}   // 잠깐(읽는 쪽이 파일을 놓을 때까지)
    }
  }
}

// ── ⏸ 자동 제작 멈춤 · 🧪 받을 채널(시범) — 이 PC 의 auto-make.json 한 곳 ──
//   paused = 「⏸ 자동 멈춤」(기본 거짓) · allowChannels = 쪽지를 받을 채널 프리셋 이름 목록(로이 2026-11-17 밤 재개정 「고전 시범 단계를 먼저」 ·
//   기본 = 고전 하나 · ["*"] = 전 채널). 넓힐 때는 이 칸만 바꾼다(앱을 다시 켜지 않아도 5초 안에 읽는다).
const DEFAULT_ALLOW = ['01_로이의고전이야기'];
function _readStateFile() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8').replace(/^\uFEFF/, '')) || {}; } catch (_) { return null; } }
function _normAllow(v) { return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : DEFAULT_ALLOW.slice(); }
function loadState() {
  const j = _readStateFile() || {};
  return { paused: j.paused === true, allowChannels: _normAllow(j.allowChannels) };
}
/** 바꾼 칸만 덮는다(다른 칸 — 받을 채널 목록 — 은 그대로) */
function saveState(patch) {
  const j = _readStateFile() || {};
  const cur = { paused: j.paused === true, allowChannels: _normAllow(j.allowChannels) };
  const next = { ...cur, ...(patch || {}) };
  writeJsonAtomic(stateFile(), { paused: !!next.paused, allowChannels: _normAllow(next.allowChannels), at: kst() });
}
/** 이 채널의 쪽지를 받나 — 목록에 이름이 있거나 "*" */
function channelAllowed(name, allow) { const L = _normAllow(allow); return L.includes('*') || L.includes(String(name || '')); }

// ── 쪽지 ──
/** 쪽지 꼴 검사 → '' = 통과 | 무엇이 틀렸는지 */
function validateNote(n) {
  if (!n || typeof n !== 'object' || Array.isArray(n)) return 'JSON 객체가 아닙니다';
  if (n.ver !== 1) return `ver 가 1 이 아닙니다(${JSON.stringify(n.ver)})`;
  if (n.kind !== 'render' && n.kind !== 'upload') return `kind 가 "render"·"upload" 가 아닙니다(${JSON.stringify(n.kind)})`;
  if (typeof n.script !== 'string' || !n.script.trim()) return 'script(대본 경로)가 없습니다';
  if (!/\.md$/i.test(n.script.trim())) return 'script 가 .md 파일이 아닙니다';
  if (!path.isAbsolute(n.script.trim())) return 'script 가 절대 경로가 아닙니다';
  if (n.packaging != null && typeof n.packaging !== 'string') return 'packaging 은 문자열(경로)이어야 합니다';
  if (n.thumbnails != null && !(Array.isArray(n.thumbnails) && n.thumbnails.every((x) => typeof x === 'string'))) return 'thumbnails 는 경로 문자열 목록이어야 합니다';
  if (n.publishAt != null && typeof n.publishAt !== 'string') return 'publishAt 은 문자열(KST "YYYY-MM-DD HH:MM")이어야 합니다';
  return '';
}

/** 파일 하나 → { ok, note } | { ok:false, reason, detail, young } (young = 막 놓여 아직 쓰는 중일 수 있음 → 다음에 다시) */
function readNote(file, now = Date.now()) {
  let text = '', mtimeMs = 0;
  try { text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); mtimeMs = fs.statSync(file).mtimeMs; } catch (e) { return { ok: false, reason: REASON.form, detail: '읽을 수 없습니다: ' + e.message, young: true }; }
  let note;
  try { note = JSON.parse(text); } catch (e) { return { ok: false, reason: REASON.form, detail: 'JSON 이 아닙니다: ' + e.message, young: now - mtimeMs < YOUNG_MS, text }; }
  const bad = validateNote(note);
  if (bad) return { ok: false, reason: REASON.form, detail: bad, text };
  note.script = note.script.trim();
  return { ok: true, note, mtimeMs };
}

/** 폴더 바로 아래 *.json(이름이 . · ~ 로 시작하면 쓰는 중인 임시 파일로 보고 건너뜀) → 오래된 것부터 [{file, name, at}] */
function listNotes(dir = inboxDir()) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
  const out = [];
  for (const e of ents) {
    if (!e.isFile() || !/\.json$/i.test(e.name) || /^[.~]/.test(e.name)) continue;
    const file = path.join(dir, e.name);
    let at = '';
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); if (j && typeof j.at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(j.at)) at = j.at.trim().replace('T', ' '); } catch (_) {}
    if (!at) { try { at = kst(fs.statSync(file).mtimeMs); } catch (_) { at = '9999'; } }
    out.push({ file, name: e.name, at });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.name.localeCompare(b.name, 'ko', { numeric: true })));
}

/** 쪽지의 편 열쇠 — key 칸 → 대본 이름 앞 [약칭_MMDD] 의 안쪽 */
function noteKey(note) {
  if (note && typeof note.key === 'string' && note.key.trim()) return note.key.trim();
  const m = path.basename(String((note && note.script) || '')).match(/^\[([^\]\r\n]+)\]/);
  return m ? m[1] : path.basename(String((note && note.script) || '')).replace(/\.md$/i, '');
}

const _norm = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();
/**
 * 대본 경로 → 채널(대본 폴더가 이 대본을 품는 채널 중 가장 깊은 것 하나). 같은 폴더를 둘 이상이 쓰면 거절.
 * channels = [{ name, scriptFolder, … }] → { ok, preset } | { ok:false, reason, detail }
 */
function pickChannel(scriptPath, channels) {
  const sp = _norm(scriptPath);
  const hits = [];
  for (const c of channels || []) {
    if (!c || !c.name || !c.scriptFolder) continue;
    const f = _norm(c.scriptFolder);
    if (sp === f || sp.startsWith(f + path.sep) || sp.startsWith(f + '/')) hits.push({ c, f });
  }
  if (!hits.length) return { ok: false, reason: REASON.noChannel, detail: '이 대본을 품는 「대본 폴더」를 가진 채널이 없습니다' };
  hits.sort((a, b) => b.f.length - a.f.length);
  const top = hits.filter((h) => h.f === hits[0].f);
  if (top.length > 1) return { ok: false, reason: REASON.manyChannel, detail: `같은 대본 폴더를 쓰는 채널: ${top.map((h) => h.c.name).join(' · ')}` };
  return { ok: true, preset: hits[0].c };
}

/** 쪽지의 썸네일 A 경로 — 이름 끝이 A(…_A.png · ….A.png)인 것, 없으면 첫 번째 */
function thumbAOf(note) {
  const L = (note && Array.isArray(note.thumbnails)) ? note.thumbnails.filter((x) => typeof x === 'string' && x.trim()) : [];
  return L.find((x) => /(?:^|[^A-Za-z0-9])A\.(png|jpe?g|webp)$/i.test(x.trim())) || L[0] || null;
}

const _isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };

/**
 * 받을 수 있나 — 🔴 패키징 완료를 한 번 더 본다(대본 · 패키징 · 썸네일 A 가 실제로 있어야 · 밤 개정).
 * d = { channels, allow?(받을 채널 목록), inQueue(sp)→bool, isMade(sp, preset)→bool, packStatus(sp)→{ok,missing}(today-scripts.packagingStatus + 썸네일 폴더) }
 * → { ok:true, preset, key, thumbA } | { ok:false, reason, detail }
 */
function checkNote(note, d) {
  const sp = note.script;
  if (!_isFile(sp)) return { ok: false, reason: REASON.noScript, detail: sp };
  const ch = pickChannel(sp, d.channels);
  if (!ch.ok) return ch;
  if (d.allow && !channelAllowed(ch.preset.name, d.allow)) return { ok: false, reason: REASON.notPilot, detail: `채널 「${ch.preset.name}」 — 받을 채널: ${_normAllow(d.allow).join(' · ')}` };
  if (note.packaging && !_isFile(note.packaging)) return { ok: false, reason: REASON.noPack, detail: '패키징 파일 없음: ' + note.packaging };
  const thumbA = thumbAOf(note);
  if (thumbA && !_isFile(thumbA)) return { ok: false, reason: REASON.noPack, detail: '썸네일 A 없음: ' + thumbA };
  // 판정 한 곳 = today-scripts.packagingStatus(다섯 칸 + 썸네일 폴더의 A·B·C 그림 — 업로드가 읽는 그 자리)
  const ps = d.packStatus(sp) || { ok: false, missing: ['패키징 파일'] };
  if (!ps.ok) return { ok: false, reason: REASON.noPack, detail: '빠진 것: ' + (ps.missing || []).join('·') };
  if (d.inQueue(sp)) return { ok: false, reason: REASON.inQueue, detail: '' };
  if (d.isMade(sp, ch.preset)) return { ok: false, reason: REASON.made, detail: '.vrew · 같은 이름 MP4 · 업로드 기록 중 하나가 있습니다' };
  return { ok: true, preset: ch.preset, key: noteKey(note), thumbA };
}

/**
 * ⬆ kind "upload" — 이미 만든 MP4 를 올려 달라(다시 만들지 않는다 · v1.0.66 · 11-19 업로드 없이 끝난 네 편).
 *   패키징·「이미 만들었음」은 보지 않는다(만든 편이 대상이다). 올릴 MP4 가 있어야 하고 채널에 업로드채널이 있어야 한다.
 *   이미 올린 영상이면 업로드 관문(runYtUpload 중복 검사)이 다시 올리지 않고 마무리만 한다.
 * d = { channels, allow?, busy(sp)→bool(지금 만들거나 올리는 중), mp4Of(sp, preset)→경로 }
 * → { ok:true, preset, key, mp4 } | { ok:false, reason, detail }
 */
function checkUploadNote(note, d) {
  const sp = note.script;
  if (!_isFile(sp)) return { ok: false, reason: REASON.noScript, detail: sp };
  const ch = pickChannel(sp, d.channels);
  if (!ch.ok) return ch;
  if (d.allow && !channelAllowed(ch.preset.name, d.allow)) return { ok: false, reason: REASON.notPilot, detail: `채널 「${ch.preset.name}」 — 받을 채널: ${_normAllow(d.allow).join(' · ')}` };
  if (!(typeof ch.preset.ytChannelId === 'string' && ch.preset.ytChannelId.trim())) return { ok: false, reason: REASON.noUploadCh, detail: `채널 「${ch.preset.name}」 — 채널 편집 → 📁 폴더 → ⬆ 업로드에서 고르세요` };
  if (d.busy(sp)) return { ok: false, reason: REASON.inQueue, detail: '지금 만들거나 올리는 중' };
  const mp4 = d.mp4Of(sp, ch.preset);
  if (!mp4 || !_isFile(mp4)) return { ok: false, reason: REASON.noMp4, detail: mp4 || '' };
  return { ok: true, preset: ch.preset, key: noteKey(note), mp4 };
}

/** 쪽지를 하위 폴더로 옮긴다(내용에 patch 를 더해) → 새 경로. 같은 이름이 있으면 _2, _3 … */
function moveNote(file, sub, patch = {}, rawText = null, root = null) {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (_) { obj = null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { let t = rawText; if (t == null) { try { t = fs.readFileSync(file, 'utf8'); } catch (_) { t = ''; } } obj = { 원문: t }; }
  const dir = path.join(root || path.dirname(file), sub);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(file), stem = path.basename(file, ext);
  let dst = path.join(dir, stem + ext);
  for (let k = 2; fs.existsSync(dst); k++) dst = path.join(dir, `${stem}_${k}${ext}`);
  writeJsonAtomic(dst, { ...obj, ...patch });
  try { fs.unlinkSync(file); } catch (_) {}
  return dst;
}
/** 진행중 쪽지 하나를 처리됨·거절로(같은 폴더 구조 — inbox\진행중\x.json → inbox\처리됨\x.json) */
function finishNote(doingFile, sub, patch = {}) {
  return moveNote(doingFile, sub, patch, null, path.dirname(path.dirname(doingFile)));
}

// ── 🧰 자동 제작이 쓸 값 = 그 채널 설정(로이가 헤더에서 그 채널을 고른 것과 같은 값 · 「프라이밍에 미리 설정해 둔 값으로」) ──
//   이미지·비디오 도구는 채널 imgEngine·videoEngine(옛 값은 engine-migrate) · 비디오가 비었으면 「없음」(⛔ 유료 영상을 조용히 켜지 않는다)
//   스타일·자막 모양·자막 글자 수·완성 종류는 queue-channel.channelOverrides(다른 채널 대본과 같은 규칙)
function autoItemOpts(preset) {
  const EM = require('./engine-migrate');
  const QC = require('./queue-channel');
  const p = preset || {};
  const imgEngine = EM.migrateImage(p.imgEngine).v;
  const vv = p.videoEngine == null || p.videoEngine === '' ? 'none' : EM.migrateVideo(p.videoEngine).v;
  const videoEngine = vv && vv !== 'flow' ? vv : 'none';
  const ov = p.name ? QC.channelOverrides(p, '\u0000자동') : {};
  // ⬆ 업로드 = 채널 편집 → 📁 폴더 → ⬆ 업로드 칸에 업로드채널(ytChannelId)이 골라져 있으면 올린다 — 자동 제작에는 헤더 체크박스가 없다(요청서 128줄 · v1.0.66)
  //   ⛔ 옛 값 ytAuto 는 보지 않는다(채널 편집 창에 켬/끔 칸이 없다 — 로이가 볼 수도 바꿀 수도 없다 · 일본 채널이 false 로 남아 있었다)
  //   ⛔ 화면 큐는 이 값을 쓰지 않는다(헤더 체크박스 하나만 · 2026-10-14 로이) · 공개 상태는 yt-schedule.privacyFor(일부공개·비공개만)
  const uploadAfter = typeof p.ytChannelId === 'string' && p.ytChannelId.trim() ? 'on' : 'off';
  return { imgEngine, videoEngine, ov, uploadAfter };
}

// ── ⑤ progress.json(화면 밖 사본 — 정본은 화면) ──
const STAGE_KO = { tts: '음성', image: '그림', video: '영상', out: '조립' };
/** make-progress 스냅샷 → { stage, done, total } (지금 도는 단계 · 없으면 마지막으로 끝난 단계) */
function stageOf(snap) {
  const st = (snap && snap.stages) || {};
  const order = ['tts', 'image', 'video', 'out'];
  let k = order.find((x) => st[x] && st[x].state === 'run');
  if (!k) k = [...order].reverse().find((x) => st[x] && st[x].state === 'done') || null;
  if (!k) return { stage: '준비', done: null, total: null };
  const c = k === 'tts' ? snap.sent : k === 'image' ? snap.image : k === 'video' ? snap.video : null;
  return { stage: STAGE_KO[k], done: c ? c.done : null, total: c ? c.total : null };
}
function writeProgress(doc) { try { writeJsonAtomic(progressFile(), { ver: 1, at: kst(), ...doc }); return true; } catch (_) { return false; } }

module.exports = {
  SUB, REASON, YOUNG_MS, baseDir, inboxDir, progressFile, stateFile, kst, writeJsonAtomic,
  loadState, saveState, channelAllowed, DEFAULT_ALLOW, validateNote, readNote, listNotes, noteKey, pickChannel, thumbAOf, checkNote, checkUploadNote, moveNote, finishNote,
  autoItemOpts, stageOf, writeProgress, STAGE_KO,
};
