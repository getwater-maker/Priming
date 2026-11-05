'use strict';
/**
 * core/edition.js — 🏠 로이판(studio) / 🛒 판매판(member) 기능 표 한 곳(v1.0.26 · 설계 docs/판나누기-설계.md).
 *
 * - `EDITION` = 설치본 루트의 `edition.json`({ "edition": "member" }) — 없으면 **studio**(개발 실행·E2E·로이 PC 는 지금처럼 전부 열림).
 *   판매판 매니페스트를 받은 PC 는 업데이터(light-updater)가 이 파일을 써 둔다.
 * - `FEATURES` = 기능 id → 들어가는 판 · 관리자 계정만인지(owner) · 딸린 파일(판매판 매니페스트에서 뺀다) · IPC 채널(판매판이면 「이 판에는 없는 기능」).
 * - 판정은 `feat(id, isOwner)` 하나 — 판에 없으면 false, owner 기능이면 관리자 계정일 때만.
 *   🔴 로이판 동작 불변: owner 표시는 **예전에 isOwner() 로 막던 기능에만** 붙였다(그 밖의 로이 전용 기능은 로이판에선 예전처럼 누구나).
 * - ⛔ 렌더러 번들에 넣지 않는다(화면은 licPublic().features 로 받는다).
 * - 새 로이 전용 기능은 여기에 등록한다(파일·채널) — 판매판 매니페스트·IPC 차단·시험(test:edition)이 이 표를 읽는다.
 */
const fs = require('fs');
const path = require('path');

const EDITIONS = ['studio', 'member'];
const ROOT = path.resolve(__dirname, '..');

function readEdition(root = ROOT) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'edition.json'), 'utf8'));
    const e = String((j && j.edition) || '').trim().toLowerCase();
    return EDITIONS.includes(e) ? e : 'studio';
  } catch (_) { return 'studio'; }
}
let EDITION = readEdition();
/**
 * 🏠🛒 한 PC 에 두 판(v1.0.27 · 로이 2026-11-05 「따로 쓰기」) — 로이 PC 의 판매판 미리보기 설치본(dist:member:preview)은
 * edition.json 에 `dataHome`(홈 폴더 아래 이름 하나)을 싣는다 → bootstrap 이 os.homedir() 를 그 폴더로 돌려
 * 설정·채널·키·작업본·로그·로그인(~/.flow-app · ~/.priming-maker · ~/.shots-maker)을 로이판과 나눈다(새 회원처럼 빈 상태).
 * 진짜 회원 설치본엔 없다(null = 예전 그대로). 이름만 받는다(경로·.. 거부).
 */
function readDataHome(root = ROOT) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'edition.json'), 'utf8'));
    const d = String((j && j.dataHome) || '').trim();
    return /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/.test(d) ? d : null;
  } catch (_) { return null; }
}

const S = ['studio'];
// files: 매니페스트 상대경로(슬래시) — '/' 로 끝나면 폴더 통째 · channels: IPC 이름 정규식 · reply: 판매판에서 그 채널이 돌려줄 값(화면이 기대하는 꼴)
const FEATURES = {
  order:        { label: '🤖 2.0 무인 제작', editions: S, files: ['tools/order.js', 'core/order-contract.js', 'core/channel-register.js'] },
  book:         { label: '📖 출판', editions: S, files: ['core/book/'], channels: [/^book-/, /^open-book-/] },
  remotion:     { label: '🎬 리모션', editions: S, files: ['core/tsv-tts.js', 'core/tsv-images.js', 'core/remotion-export.js', 'core/audio-trim.js', 'tsv-tts.js'], channels: [/^remotion-/] },
  // ⚠ core/whiteboard-subtitle.js 는 남긴다 — MP4 렌더러(이중 자막 SRT 읽기)가 같이 쓴다
  whiteboard:   { label: '✏ 화이트보드', editions: S, files: ['core/whiteboard-annotation.js', 'core/whiteboard-audio.js', 'core/whiteboard-config.js', 'core/whiteboard-pipeline.js', 'core/whiteboard-render.js', 'core/whiteboard-scenes.js', 'whiteboard/'], channels: [/^whiteboard-/, /^(get|set)-whiteboard-config$/] },
  // ⚠ core/roy-marks.js 는 남긴다 — 대본 파서(longform-parser)·DTO 가 🟥·🟨 줄을 읽는다
  royBank:      { label: '🟥 경험은행', editions: S, files: ['core/roy-bank.js'], channels: [/^roy-/] },
  thumbEdit:    { label: '🖼 썸네일 편집기', editions: S, files: ['core/thumb-edit.js', 'core/thumb-find.js'], channels: [/^thumb-edit-/, /^list-thumbs$/], reply: { files: [], msg: '' } },
  todayScripts: { label: '📅 오늘 대본', editions: S, files: ['core/today-scripts.js'], channels: [/^today-scripts-/] },
  charSheets:   { label: '👤 캐릭터셋 보기', editions: S, owner: true, files: ['core/char-sheets.js'], channels: [/^list-char-sheets$/], reply: { cards: [], byGroup: {}, msg: '' } },
  ytCookie:     { label: '🔑 유튜브 로그인', editions: S, owner: true, files: ['core/yt-login.js', 'core/yt-cookies.js'], channels: [/^yt-login-/], reply: { allowed: false, connected: false } },
  // ⚠ core/gpu-share.js 는 남긴다 — 음성 서버 GPU 차례(omnivoice-provider)가 같이 쓴다
  localQwen:    { label: '🖥 로컬 Qwen·ComfyUI 서버 관리', editions: S, owner: true, files: ['core/comfy-launch.js', 'comfy/comfy-server.pyw', 'comfy/comfy-open.pyw'] },
  gpuTemp:      { label: '🌡 GPU 온도', editions: S, owner: true, files: ['core/gpu-temp.js'] },
  monitorOff:   { label: '🌙 모니터 끄기', editions: S, files: [], channels: [/^monitor-off$/] },
  qwenDesign:   { label: '🎨 보이스디자인', editions: S, files: ['core/qwen-design.js'], channels: [/qwen-design/] },
  omniServer:   { label: '🖧 메인 PC 음성 서버', editions: S, files: ['core/studio-env.js'] },
  legacyEngines:{ label: '옛 엔진(Genspark·Grok·LoRA·Wan)', editions: S, files: ['genspark-engine.js', 'grok-engine.js', 'core/grok-api.js', 'core/lora-collect.js', 'Wan2.2 I2V/'], channels: [/lora-/] },
};
// 판매판에 보내지 않는 내부 문서·도구(기능과 무관) — 단 앱 화면이 쓰는 「📘 대본 작성 기준」은 보낸다
const MEMBER_DROP = [/^docs\//, /^CLAUDE\.md$/, /^AGENTS\.md$/, /^tools\//, /^test\//];
const MEMBER_KEEP = [/^docs\/대본-작성-가이드\.md$/];

function has(id, ed = EDITION) {
  const f = FEATURES[id];
  if (!f) throw new Error('모르는 기능 id: ' + id);
  return f.editions.includes(ed);
}
function feat(id, isOwner, ed = EDITION) {
  if (!has(id, ed)) return false;
  return FEATURES[id].owner ? !!(typeof isOwner === 'function' ? isOwner() : isOwner) : true;
}
function features(isOwner, ed = EDITION) {
  const o = {};
  for (const id of Object.keys(FEATURES)) o[id] = feat(id, isOwner, ed);
  return o;
}
function channelFeature(ch) {
  for (const [id, f] of Object.entries(FEATURES)) if ((f.channels || []).some((re) => re.test(String(ch)))) return id;
  return null;
}
const MISSING_MSG = '이 판에는 없는 기능입니다';
function missingReply(id) {
  return { ok: false, missing: true, feature: id, error: MISSING_MSG, ...((FEATURES[id] && FEATURES[id].reply) || {}) };
}
/** 그 판에서 빠진 기능의 파일인가(매니페스트 상대경로) */
function fileFeature(rel) {
  const r = String(rel).replace(/\\/g, '/');
  for (const [id, f] of Object.entries(FEATURES)) if ((f.files || []).some((p) => (p.endsWith('/') ? r.startsWith(p) : r === p))) return id;
  return null;
}
function inEditionFile(rel, ed) {
  const r = String(rel).replace(/\\/g, '/');
  if (ed === 'studio') return true;
  const id = fileFeature(r);
  if (id && !has(id, ed)) return false;
  if (MEMBER_KEEP.some((re) => re.test(r))) return true;
  return !MEMBER_DROP.some((re) => re.test(r));
}
/**
 * 판에 따라 모듈을 읽는다 — 판에 있으면 그대로 require(로이판은 예전과 같은 순간에 읽는다),
 * 없으면 쓰는 순간 「이 판에는 없는 기능」 오류를 던지는 대리 객체(파일이 없어도 main 이 켜진다).
 */
function optional(id, load) {
  if (has(id)) return load();
  const err = () => { const e = new Error(MISSING_MSG + ' (' + ((FEATURES[id] && FEATURES[id].label) || id) + ')'); e.code = 'EDITION_MISSING'; throw e; };
  return new Proxy(function () {}, { get: (_t, k) => (k === '__missing' ? true : k === 'then' ? undefined : err()), apply: err, construct: err });
}
/** 시험 전용 */
function _setEdition(e) { EDITION = EDITIONS.includes(e) ? e : 'studio'; }

module.exports = {
  get EDITION() { return EDITION; }, EDITIONS, FEATURES, MEMBER_DROP, MEMBER_KEEP, MISSING_MSG,
  readEdition, readDataHome, has, feat, features, channelFeature, missingReply, fileFeature, inEditionFile, optional, _setEdition,
};
