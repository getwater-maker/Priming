'use strict';
/**
 * order-contract.js — 🤖 2.0 무인 제작의 주문서 · 결과서 계약(v1.0.18 · 요청서_2.0무인제작_2026-11-04 ② ⑬)
 *   머리(아도나이로이 2.0)와 손(Priming)은 서로 부르지 않고 **파일로만** 주고받는다.
 *     <root>\주문\제작\<주문>.json(+ .md 제작본)  ← 2.0 이 씀
 *     <root>\결과\제작\<주문>.받음 · <주문>.진행 · <주문>.json ← Priming 이 씀(결과서는 덮어쓰지 않고 한 번만 · 다시 = _2 …)
 *     <root>\운영\운영상태.json                     ← 2.0 이 씀 · Priming 은 시작 전·업로드 직전에 읽기만(못 읽으면 멈춤)
 *     <root>\주문\등록\<이름>.json → <root>\결과\등록\<이름>.json ← ⑭ 새 채널 등록(꼴·판정은 core/channel-register)
 *   🔑 이 파일은 순수(fs 만) — 판정·꼴은 여기 한 곳, 제작·업로드는 main.js `runOrderHeadless` 가 한다(test:order).
 *   ⛔ 주문서에 없는 값을 기본값으로 메우지 않는다(다른 채널 목소리·그림체 = 「같은 공장」 표지 · 빈 지시문 = 유료 호출) → 거절.
 */
const fs = require('fs');
const path = require('path');

const VERSION = 1;
const DEFAULT_ROOT = 'D:\\## 아도나이로이 2.0';
const DEFAULT_OUT = 'D:\\Priming_무인제작';
// 2.0 주문이 쓸 수 있는 엔진 — 로컬만(로이 결정 11-03 「2.0 주문의 기본은 로컬 엔진만 · 유료 호출 0」)
const VOICE_ENGINES = ['omnivoice'];
const IMAGE_ENGINES = ['local:qwen-2-1'];
const STATUS = { ok: '성공', fail: '실패', abort: '중단됨', reject: '거절' };
const STAGES = ['주문 읽기', '음성', '그림', '렌더', '썸네일 배경', '업로드', '끝'];
// 켄번스 패턴 번호(core/ken-burns KEN_BURNS_PATTERNS 순서) → 사람이 읽는 이름
const MOTION_NAMES = ['줌인', '줌아웃', '좌→우 팬', '우→좌 팬', '하→상 팬', '상→하 팬', '좌상 대각', '우상 대각', '좌하 대각', '우하 대각', '우상 코너', '좌하 코너'];
const RUN_WORDS = new Set(['운영', '운영중', '켬', 'run', 'running', 'on', 'go']);

function configFile() { return process.env.PM_ORDER_CONFIG || path.join(require('os').homedir(), '.priming-maker', 'order-config.json'); }   // PM_ORDER_CONFIG = 시험용
/** 설정 — 폴더 자리는 root 하나(요청서 C). 나머지는 root 아래 정해진 자리 · outDir(완성 파일)은 통로 밖. */
function loadConfig(file = configFile()) {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (_) {}
  const root = String(c.root || DEFAULT_ROOT);
  return {
    root,
    ordersDir: path.join(root, '주문', '제작'),
    resultsDir: path.join(root, '결과', '제작'),
    opsFile: path.join(root, '운영', '운영상태.json'),
    regDir: path.join(root, '주문', '등록'),           // ⑭ 새 채널 등록 파일(2.0 이 씀) — core/channel-register
    regResultsDir: path.join(root, '결과', '등록'),    // ⑭ 등록 결과서(Priming 이 씀 · 한 번만)
    outDir: String(c.outDir || DEFAULT_OUT),
    uploadApps: (c.uploadApps && typeof c.uploadApps === 'object') ? c.uploadApps : {},   // { "<앱 이름>": "<youtube 인증 프로필>" } — 비면 이름 그대로 프로필
  };
}

function kst(ts = Date.now()) {
  return new Date(ts + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 19) + ' KST';
}
function orderName(orderPath) { return path.basename(String(orderPath || '')).replace(/\.json$/i, ''); }
/** 「<채널 ID>_<예정 MMDD>」 의 MMDD(묶음 = 같은 예정일) */
function mmddOf(name) { const m = /_(\d{4})(?:_\d+)?$/.exec(String(name || '')); return m ? m[1] : ''; }

function _str(v) { return v == null ? '' : String(v).trim(); }
/**
 * 주문서 읽기 + 꼴 검사(파일 존재·엔진·빈 칸). 채널·목소리·그림체가 Priming 에 **있는지**는 호출하는 쪽이 본다(checkKnown).
 * 돌려줌 { ok, order, errors[] } — errors 가 있으면 거절.
 */
function readOrder(orderPath) {
  const errors = [];
  let raw;
  try { raw = JSON.parse(fs.readFileSync(orderPath, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { return { ok: false, order: null, errors: [`주문서를 읽을 수 없습니다 — ${e.message}`] }; }
  if (!raw || typeof raw !== 'object') return { ok: false, order: null, errors: ['주문서가 JSON 객체가 아닙니다'] };
  const dir = path.dirname(orderPath);
  const name = orderName(orderPath);
  let script = _str(raw.script);
  if (script && !path.isAbsolute(script)) script = path.join(dir, script);
  const up = raw.upload && typeof raw.upload === 'object' ? raw.upload : {};
  const order = {
    v: Number(raw.v) || VERSION,
    name,
    orderId: _str(raw.orderId) || name,
    script,
    channelId: _str(raw.channelId),
    primingChannel: _str(raw.primingChannel),
    voice: _str(raw.voice).replace(/^srv:/, ''),
    voiceEngine: _str(raw.voiceEngine) || 'omnivoice',
    style: _str(raw.style),
    imageEngine: _str(raw.imageEngine) || 'local:qwen-2-1',
    speed: raw.speed == null || raw.speed === '' ? null : Number(raw.speed),
    thumbPrompt: _str(raw.thumbPrompt),
    lengthMin: raw.lengthMin == null ? null : Number(raw.lengthMin),
    noPaid: raw.noPaid !== false,
    upload: {
      enabled: up.enabled !== false,
      title: _str(up.title),
      app: _str(up.app),
      channelId: _str(up.channelId),
    },
  };
  if (!order.script) errors.push('제작본 경로(script)가 비었습니다');
  else if (!fs.existsSync(order.script)) errors.push(`제작본이 없습니다 — ${order.script}`);
  if (!order.channelId) errors.push('채널 ID(channelId)가 비었습니다');
  if (!order.primingChannel) errors.push('Priming 채널 이름(primingChannel)이 비었습니다');
  if (!order.voice) errors.push('목소리(voice)가 비었습니다');
  if (!order.style) errors.push('그림체(style)가 비었습니다');
  if (!VOICE_ENGINES.includes(order.voiceEngine)) errors.push(`음성 엔진 「${order.voiceEngine}」 은 2.0 주문에서 쓸 수 없습니다(로컬만: ${VOICE_ENGINES.join(', ')})`);
  if (!IMAGE_ENGINES.includes(order.imageEngine)) errors.push(`그림 엔진 「${order.imageEngine}」 은 2.0 주문에서 쓸 수 없습니다(로컬만: ${IMAGE_ENGINES.join(', ')})`);
  if (!order.noPaid) errors.push('「바깥 유료 엔진 끔」(noPaid)이 꺼진 주문은 받지 않습니다 — 2.0 주문은 로컬 엔진만');
  if (order.speed != null && !(order.speed >= 0.5 && order.speed <= 2)) errors.push(`낭독 배속 ${raw.speed} 가 범위(0.5~2) 밖입니다`);
  if (order.upload.enabled) {
    if (!order.upload.title) errors.push('업로드 임시 제목(upload.title)이 비었습니다');
    if (!order.upload.app) errors.push('업로드 앱(upload.app)이 비었습니다 — 어느 OAuth 앱으로 올릴지 주문이 정합니다');
  }
  return { ok: !errors.length, order, errors };
}

/**
 * Priming 에 있는 값인가 — known = { channels:[이름], voices:[이름]|null(서버 목록을 못 읽음), styles:[id] }.
 * 서버 목록을 못 읽으면(null) 목소리를 확인할 수 없으니 거절한다(fail-closed — 엉뚱한 목소리로 만들지 않는다).
 */
function checkKnown(order, known) {
  const errors = [];
  if (!(known.channels || []).includes(order.primingChannel)) errors.push(`Priming 에 없는 채널입니다 — 「${order.primingChannel}」`);
  if (known.voices == null) errors.push('음성 서버의 목소리 목록을 읽지 못했습니다 — 목소리를 확인할 수 없어 만들지 않습니다');
  else if (!known.voices.includes(order.voice)) errors.push(`음성 서버에 없는 목소리입니다 — 「${order.voice}」`);
  if (!(known.styles || []).includes(order.style)) errors.push(`Priming 에 없는 그림체입니다 — 「${order.style}」`);
  return errors;
}

/** 제작본의 그룹 가운데 그림 지시문이 빈 것(번호) — 비면 거절(Priming 이 유료 호출로 채우지 않게) */
function emptyPromptGroups(parsed) {
  const out = [];
  for (const pr of (parsed && parsed.projects) || []) for (const g of pr.groups || []) if (!_str(g.imagePrompt)) out.push(g.num);
  return out;
}

/** 운영상태.json — 「운영」류가 아니면 멈춤 · 못 읽으면 멈춤(안전 쪽). 칸 이름은 `상태`(또는 `state`). */
function readOps(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { return { run: false, why: `운영 상태를 읽지 못했습니다(멈춤으로 봅니다) — ${e.code === 'ENOENT' ? '파일 없음' : e.message}` }; }
  const v = _str(j && (j['상태'] != null ? j['상태'] : j.state)).toLowerCase();
  if (RUN_WORDS.has(v)) return { run: true, why: '' };
  return { run: false, why: `운영 상태가 「${v || '(비어 있음)'}」 입니다 — 멈춤` };
}

/** 이번 결과서 자리 — 처음은 <주문>.json, 이미 있으면 <주문>_2.json, _3 … (덮어쓰지 않는다) */
function nextResultPath(resultsDir, name) {
  for (let k = 1; k < 1000; k++) {
    const p = path.join(resultsDir, k === 1 ? `${name}.json` : `${name}_${k}.json`);
    if (!fs.existsSync(p)) return p;
  }
  throw new Error('결과서 자리가 1000개를 넘었습니다');
}
/** 한 번만 쓰기 — 있으면 다음 번호로(경쟁 대비 wx) */
function writeResultOnce(resultsDir, name, obj) {
  fs.mkdirSync(resultsDir, { recursive: true });
  for (let i = 0; i < 20; i++) {
    const p = nextResultPath(resultsDir, name);
    try { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }); return p; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('결과서를 쓰지 못했습니다(자리 경쟁)');
}
function receiptPath(resultsDir, name) { return path.join(resultsDir, `${name}.받음`); }
function beatPath(resultsDir, name) { return path.join(resultsDir, `${name}.진행`); }
/** 중단 요청 — 이 주문만(<주문>.중단요청) 또는 전부(_중단요청) */
function stopPaths(resultsDir, name) { return [path.join(resultsDir, `${name}.중단요청`), path.join(resultsDir, '_중단요청')]; }
function stopRequested(resultsDir, name) { return stopPaths(resultsDir, name).some((p) => fs.existsSync(p)); }

function _writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}
function writeReceipt(resultsDir, name, info) { _writeJson(receiptPath(resultsDir, name), { at: kst(), ...info }); }
function writeBeat(resultsDir, name, info) { _writeJson(beatPath(resultsDir, name), { at: kst(), ms: Date.now(), ...info }); }

/** 같은 예정일 묶음 안에서 같은 목소리를 쓰는 **다른 채널** 주문(⑦) — 주문 폴더를 읽기만 */
function sameVoiceInBatch(ordersDir, order) {
  const mm = mmddOf(order.name);
  if (!mm) return [];
  const out = [];
  let files = [];
  try { files = fs.readdirSync(ordersDir).filter((f) => /\.json$/i.test(f)); } catch (_) { return []; }
  for (const f of files) {
    const nm = orderName(f);
    if (nm === order.name || mmddOf(nm) !== mm) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ordersDir, f), 'utf8').replace(/^\uFEFF/, ''));
      if (_str(j.voice).replace(/^srv:/, '') === order.voice && _str(j.channelId) !== order.channelId) out.push({ order: nm, channelId: _str(j.channelId) });
    } catch (_) {}
  }
  return out;
}

/** 화면 측정(⑨) — 장면 [{sec, motion}] → 평균·최장 초 · 움직임 종류별 개수 */
function sceneStats(scenes) {
  const secs = scenes.map((s) => Number(s.sec) || 0).filter((x) => x > 0);
  const motions = {};
  for (const s of scenes) { const k = s.motion || '없음'; motions[k] = (motions[k] || 0) + 1; }
  const round1 = (x) => Math.round(x * 10) / 10;
  return {
    scenes: scenes.length,
    sceneAvgSec: secs.length ? round1(secs.reduce((a, b) => a + b, 0) / secs.length) : null,
    sceneMaxSec: secs.length ? round1(Math.max(...secs)) : null,
    motions,
  };
}
function motionName(idx) { return idx < 0 ? '없음' : (MOTION_NAMES[idx] || `패턴 ${idx}`); }
/** 낭독 속도 = 공백 제외 글자 ÷ 낭독 분 */
function charsPerMin(texts, speechSec) {
  const n = texts.reduce((a, t) => a + String(t || '').replace(/\s+/g, '').length, 0);
  return speechSec > 0 ? Math.round(n / (speechSec / 60)) : null;
}

// 🧾 주문 업로드 장부(④ 멱등) — 주문 열쇠(orderId) → 영상 ID. 같은 주문이 다시 오면 만들지도 올리지도 않고 이 ID 를 돌려준다.
//   (유튜브 업로드 관문 runYtUpload 의 같은 파일·같은 제목·채널 목록 확인은 그 아래에서 따로 돈다)
function ledgerFile() { return process.env.PM_ORDER_LEDGER || path.join(require('os').homedir(), '.priming-maker', 'order-uploads.json'); }   // PM_ORDER_LEDGER = 시험용
function _ledger(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (_) { return {}; } }
function ledgerGet(orderId, file = ledgerFile()) { const r = _ledger(file)[orderId]; return r && r.videoId ? r : null; }
function ledgerSet(orderId, rec, file = ledgerFile()) {
  const all = _ledger(file);
  all[orderId] = { ...rec, at: kst() };
  _writeJson(file, all);
  return all[orderId];
}

/** ComfyUI 워크플로(API 꼴)의 모델 파일 이름 — 로더 노드의 *_name 입력(⑥ 모델 이름 · ⑩ 권리 정리) */
function workflowModels(wfPath) {
  const out = [];
  try {
    const j = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
    for (const n of Object.values(j || {})) {
      if (!n || !/Loader/i.test(String(n.class_type || ''))) continue;
      for (const [k, v] of Object.entries(n.inputs || {})) if (/_name$/.test(k) && typeof v === 'string' && !out.includes(v)) out.push(v);
    }
  } catch (_) {}
  return out;
}

/** 까닭 한 줄 — 비밀 값 없이(log-scrub) · 한 줄 · 300자 */
function reasonLine(e) {
  const msg = String((e && e.message) || e || '').split(/\r?\n/)[0];
  let s = msg;
  try { s = require('./log-scrub').scrub(msg); } catch (_) {}
  return s.slice(0, 300);
}

/** 결과서 뼈대 — 칸이 늘 같은 자리에 있게(빈 값 = null · 「모름」은 note 에) */
function blankResult(order, info = {}) {
  return {
    v: VERSION,
    order: order ? order.name : (info.name || ''),
    orderId: order ? order.orderId : '',
    channelId: order ? order.channelId : '',
    status: null,
    stage: null,
    reason: '',
    uploaded: '안 함',
    videoId: null,
    resumable: false,
    files: { mp4: null, thumbBg: null, vrew: null, srt: null, outDir: null },
    log: null,
    sameVoice: [],
    startedAt: info.startedAt || kst(),
    endedAt: null,
    priming: info.version || '',
  };
}

module.exports = {
  VERSION, DEFAULT_ROOT, DEFAULT_OUT, VOICE_ENGINES, IMAGE_ENGINES, STATUS, STAGES, MOTION_NAMES,
  configFile, loadConfig, kst, orderName, mmddOf, readOrder, checkKnown, emptyPromptGroups, readOps,
  nextResultPath, writeResultOnce, receiptPath, beatPath, stopPaths, stopRequested, writeReceipt, writeBeat,
  sameVoiceInBatch, sceneStats, motionName, charsPerMin, reasonLine, blankResult,
  ledgerFile, ledgerGet, ledgerSet, workflowModels,
};
