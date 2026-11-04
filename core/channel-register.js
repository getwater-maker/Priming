'use strict';
/**
 * channel-register.js — 🤖 2.0 새 채널 등록 입구(v1.0.19 · 요청서_2.0무인제작_덧붙임_2026-11-04 ⑭)
 *   2.0 이 등록 파일 한 장을 두면 Priming 이 **2.0 용 새 채널 설정(새 이름)** 으로 들이고 등록 결과서 한 장을 쓴다.
 *     <root>\주문\등록\<이름>.json ← 2.0 이 씀  ·  <root>\결과\등록\<이름>.json ← Priming 이 씀(한 번만 · 다시 = _2 …)
 *   입구 = tools/order.js register <파일> → bootstrap(PM_HEADLESS) → main `_headlessRegister` → 여기 `register`.
 *   🔑 판정·꼴·새 채널 값은 여기 한 곳 · 저장(채널·그림체·목소리 서버)은 main 이 넘겨준 함수로만 한다(test:chreg 가 가짜로 돈다).
 *   ⛔ 기존 채널 설정은 지우거나 덮어쓰지 않는다(넘김 뒤 4주 되돌림 대비) — 같은 이름이 있으면 거절(같은 값의 다시 등록만 「됨」).
 *   ⛔ 같은 이름의 다른 목소리·그림체도 덮지 않는다 · 빈 칸을 기본값으로 메우지 않는다(목소리·그림체·배속은 꼭 적는다).
 */
const fs = require('fs');
const path = require('path');

const VERSION = 1;
const STATUS = { ok: '됨', fail: '실패', reject: '거절' };
const EXIT = { '됨': 0, '실패': 1, '거절': 2 };
const LANGS = ['ko', 'ja', 'vi'];
const BAD_NAME = /[\\/:*?"<>|]/;                 // 서버 `_safe_voice_name` 이 지우는 글자 — 미리 거절해 이름이 몰래 바뀌지 않게
const ID_OK = /^[\p{L}\p{N}_.-]{1,60}$/u;
const REF_SEC = { min: 2, max: 40 };              // 참조 음성 길이(초) — 앱 보이스디자인 저장분은 5~20초
const AI_NOTICE_TEXT = '본 영상의 음성과 이미지는 AI 도구를 활용하여 제작되었습니다.';

// 복사 원본(from)에서 **가져오지 않는** 칸 — 그 채널의 정체(유튜브 채널·로고·배경 음악·화자·폴더)가 새 채널로 새지 않게.
//   ytChannelId 를 그대로 두면 2.0 주문이 upload.channelId 를 비웠을 때 **원본 채널로 올라간다**.
const IDENTITY_KEYS = ['id', 'isDefault', 'outputFolder', 'outLong', 'outShort', 'outUpload', 'outWhiteboard', 'outReader', 'outImages',
  'scriptFolder', 'downloadFolder', 'imgTsvFolder', 'logoPath', 'logoX', 'logoY', 'ytChannelId', 'ytPlaylist', 'bgmPath', 'order20'];
// 복사 원본이 없을 때의 틀 — 음성·그림 기본 품질 값과 화면 AI 고지만(자막 모양·글자 수는 Priming 기본)
const BASE_TEMPLATE = {
  engine: 'omnivoice', voice: 'clone', speed: 1, silenceSec: 0, cfgValue: 2, inferenceTimesteps: 32, language: 'ko', seed: 12345,
  ttsNormalize: true, ttsTargetDb: -15, startMode: 'longform', outTarget: 'mp4', speakers: [],
  aiNotice: { enabled: true, text: AI_NOTICE_TEXT, unit: 'time', fromSec: 5, toSec: 10 },
};

function _str(v) { return v == null ? '' : String(v).trim(); }
function regName(file) { return path.basename(String(file || '')).replace(/\.json$/i, ''); }

/**
 * 등록 파일 읽기 + 꼴 검사(파일·빈 칸·범위). Priming 에 **있는지**는 plan 이 본다.
 * 돌려줌 { ok, reg, errors[] }
 *   voice: "<서버 목소리 이름>" | { name, file, text, lang? }(새 등록 · file 상대 경로 = 등록 파일 폴더 기준)
 *   style: "<그림체 id 또는 이름>" | { name, prompt(=tail), id? }(새 그림체)
 */
function readRegistration(file) {
  const errors = [];
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (e) { return { ok: false, reg: null, errors: [`등록 파일을 읽을 수 없습니다 — ${e.message}`] }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reg: null, errors: ['등록 파일이 JSON 객체가 아닙니다'] };
  const dir = path.dirname(file);
  const channelId = _str(raw.channelId);
  const reg = {
    v: Number(raw.v) || VERSION,
    name: regName(file),
    channelId,
    primingChannel: _str(raw.primingChannel) || (channelId ? `2.0_${channelId}` : ''),
    from: _str(raw.from),
    voice: null,
    style: null,
    speed: raw.speed == null || raw.speed === '' ? null : Number(raw.speed),
  };
  if (!channelId) errors.push('채널 ID(channelId)가 비었습니다');
  else if (!ID_OK.test(channelId)) errors.push(`채널 ID 「${channelId}」 에 쓸 수 없는 글자가 있습니다(글자·숫자·_ . - 만 · 60자까지)`);
  if (reg.primingChannel && (BAD_NAME.test(reg.primingChannel) || reg.primingChannel.length > 60)) errors.push(`Priming 채널 이름 「${reg.primingChannel}」 에 쓸 수 없는 글자가 있습니다(\\ / : * ? " < > | · 60자까지)`);

  const v = raw.voice;
  if (typeof v === 'string' || (v && typeof v === 'object' && !_str(v.file))) {
    const nm = _str(typeof v === 'string' ? v : v.name).replace(/^srv:/, '');
    if (!nm) errors.push('목소리(voice)가 비었습니다');
    reg.voice = { mode: 'existing', name: nm };
  } else if (v && typeof v === 'object') {
    let f = _str(v.file);
    if (!path.isAbsolute(f)) f = path.join(dir, f);
    const nv = { mode: 'new', name: _str(v.name).replace(/^srv:/, ''), file: f, text: _str(v.text), lang: _str(v.lang) || 'ko' };
    if (!nv.name) errors.push('새 목소리 이름(voice.name)이 비었습니다');
    else if (BAD_NAME.test(nv.name) || /\.\./.test(nv.name) || /\.wav$/i.test(nv.name)) errors.push(`새 목소리 이름 「${nv.name}」 에 쓸 수 없는 글자가 있습니다`);
    if (!/\.wav$/i.test(f)) errors.push(`참조 음성은 .wav 만 받습니다 — ${f}`);
    else if (!fs.existsSync(f)) errors.push(`참조 음성 파일이 없습니다 — ${f}`);
    if (!nv.text) errors.push('참조 텍스트(voice.text)가 비었습니다 — 비면 그 목소리로 합성할 때 엉뚱한 목소리가 납니다');
    if (!LANGS.includes(nv.lang)) errors.push(`참조 음성 언어 「${nv.lang}」 — ${LANGS.join(' · ')} 만 받습니다`);
    reg.voice = nv;
  } else errors.push('목소리(voice)가 비었습니다');

  const s = raw.style;
  if (typeof s === 'string' || (s && typeof s === 'object' && !_str(s.prompt || s.tail))) {
    const key = _str(typeof s === 'string' ? s : (s.id || s.name));
    if (!key) errors.push('그림체(style)가 비었습니다');
    reg.style = { mode: 'existing', key };
  } else if (s && typeof s === 'object') {
    const ns = { mode: 'new', id: _str(s.id) || (channelId ? `2.0-${channelId}` : ''), name: _str(s.name), prompt: _str(s.prompt || s.tail) };
    if (!ns.name) errors.push('새 그림체 이름(style.name)이 비었습니다');
    if (ns.id && !ID_OK.test(ns.id)) errors.push(`새 그림체 id 「${ns.id}」 에 쓸 수 없는 글자가 있습니다(글자·숫자·_ . - 만)`);
    reg.style = ns;
  } else errors.push('그림체(style)가 비었습니다');

  if (reg.speed == null) errors.push('낭독 배속(speed)이 비었습니다');
  else if (!(reg.speed >= 0.5 && reg.speed <= 2)) errors.push(`낭독 배속 ${raw.speed} 가 범위(0.5~2) 밖입니다`);
  return { ok: !errors.length, reg, errors };
}

/** 같은 목소리·그림체를 쓰는 다른 채널 이름(시험 채널 `__…` 와 자기 자신은 뺀다) */
function sameUse(presets, { voice, styleId, except }) {
  const keep = (p) => p && p.name && p.name !== except && !String(p.name).startsWith('__');
  const vOf = (p) => { const rv = String(p.voiceCloneRefAudio || ''); return rv.startsWith('srv:') ? rv.slice(4) : ''; };
  return {
    sameVoice: (presets || []).filter((p) => keep(p) && voice && vOf(p) === voice).map((p) => p.name),
    sameStyle: (presets || []).filter((p) => keep(p) && styleId && (p.styleLong || p.styleId) === styleId).map((p) => p.name),
  };
}

/** 이 등록이 이미 들어간 채널인가(같은 채널 ID · 목소리 · 그림체 · 배속) — 같으면 다시 등록해도 「됨」(아무것도 바꾸지 않음) */
function sameAsRegistered(p, reg, voiceName, styleId) {
  return !!(p && p.order20 && p.order20.channelId === reg.channelId && p.voiceCloneRefAudio === 'srv:' + voiceName
    && (p.styleLong || p.styleId) === styleId && Number(p.speedLong) === Number(reg.speed));
}

/**
 * 있는지 확인 → 할 일. known = { presets:[채널], voices:[이름]|null(서버 목록 못 읽음), deleted:[이름], styles:[{id,name,prompt}] }
 * 돌려줌 { errors[], voice:{name, how, clash?}, style:{id, name, prompt, how}, channel:{how}, from }
 */
function plan(reg, known) {
  const errors = [];
  const presets = known.presets || [];
  const styles = known.styles || [];
  const from = reg.from ? presets.find((p) => p.name === reg.from) || null : null;
  if (reg.from && !from) errors.push(`복사 원본 채널이 Priming 에 없습니다 — 「${reg.from}」`);

  const voice = { name: reg.voice.name, how: '기존' };
  if (known.voices == null) errors.push('음성 서버의 목소리 목록을 읽지 못했습니다 — 목소리를 확인할 수 없어 등록하지 않습니다');
  else if (reg.voice.mode === 'existing') {
    if (!known.voices.includes(voice.name)) errors.push(`음성 서버에 없는 목소리입니다 — 「${voice.name}」`);
  } else {
    voice.how = '새로 등록';
    if ((known.deleted || []).includes(voice.name)) errors.push(`「${voice.name}」 은 음성 서버 휴지통에 있는 이름입니다 — 다른 이름으로 등록해 주세요`);
    else if (known.voices.includes(voice.name)) voice.clash = true;   // 바이트가 같으면 다시 등록(멱등) · 다르면 거절 — register 가 서버 음성을 받아 본다
  }

  let style = null;
  if (reg.style.mode === 'existing') {
    const byId = styles.find((x) => x.id === reg.style.key);
    const byName = byId ? [] : styles.filter((x) => _str(x.name) === reg.style.key);
    if (byId) style = { id: byId.id, name: byId.name || '', how: '기존' };
    else if (byName.length === 1) style = { id: byName[0].id, name: byName[0].name, how: '기존' };
    else if (byName.length > 1) errors.push(`이름이 「${reg.style.key}」 인 그림체가 ${byName.length}개입니다 — id 로 불러 주세요(${byName.map((x) => x.id).join(', ')})`);
    else errors.push(`Priming 에 없는 그림체입니다 — 「${reg.style.key}」`);
  } else {
    const ns = reg.style;
    const same = styles.find((x) => x.id === ns.id);
    if (!ns.prompt) errors.push('새 그림체 지시문(style.prompt)이 비었습니다');
    else if (same) {
      if (_str(same.name) === ns.name && _str(same.prompt) === ns.prompt) style = { id: ns.id, name: ns.name, prompt: ns.prompt, how: '이미 있는 같은 그림체' };
      else errors.push(`그림체 id 「${ns.id}」 가 이미 있고 내용이 다릅니다 — 덮어쓰지 않습니다(다른 id 로 등록해 주세요)`);
    } else if (styles.some((x) => _str(x.name) === ns.name)) errors.push(`이름이 「${ns.name}」 인 그림체가 이미 있습니다 — 다른 이름으로 등록해 주세요`);
    else style = { id: ns.id, name: ns.name, prompt: ns.prompt, how: '새로 등록' };
  }

  const channel = { how: '새로 만듦' };
  const ex = presets.find((p) => p.name === reg.primingChannel);
  if (ex) {
    if (style && sameAsRegistered(ex, reg, voice.name, style.id)) channel.how = '이미 같은 값으로 있음';
    else errors.push(`Priming 에 「${reg.primingChannel}」 채널이 이미 있습니다 — 기존 채널 설정은 덮어쓰지 않습니다(primingChannel 에 새 이름을 적어 주세요)`);
  }
  return { errors, voice, style, channel, from };
}

/** 새 채널 값 — 복사 원본(없으면 틀)에서 정체 칸을 빼고 목소리·그림체·배속·2.0 표시를 얹는다(순수) */
function buildPreset(reg, p, { at = '' } = {}) {
  const src = p.from ? JSON.parse(JSON.stringify(p.from)) : JSON.parse(JSON.stringify(BASE_TEMPLATE));
  for (const k of IDENTITY_KEYS) delete src[k];
  const lang = reg.voice.mode === 'new' ? reg.voice.lang : (src.language || 'ko');
  return {
    ...src,
    name: reg.primingChannel,
    group: '2.0',
    engine: 'omnivoice', voice: 'clone', voiceEngine: { id: 'omnivoice' }, voiceCloneRefAudio: 'srv:' + p.voice.name, voiceCloneRefText: '',
    language: lang, speakers: [], instruct: '', presetPrompt: '',
    styleId: p.style.id, styleLong: p.style.id, styleShort: p.style.id, styleThumb: '',
    speedLong: Number(reg.speed),
    imgEngine: 'local:qwen-2-1', videoEngine: 'none',                       // 2.0 주문은 로컬 그림만 · 영상 없음(화면에서 열어도 유료 영상이 켜지지 않게)
    outputFolder: '', outLong: '', outShort: '', outUpload: '', outWhiteboard: '', outReader: '', outImages: '', scriptFolder: '', downloadFolder: '', imgTsvFolder: '',
    logoOn: false, logoPath: '', bgmOn: false, bgmPath: '', ytAuto: false, ytChannelId: '', ytPlaylist: '', ytSchedule: { on: false },
    profileId: 'default',
    order20: { channelId: reg.channelId, from: p.from ? p.from.name : null, file: reg.name, at },
  };
}

function blankResult(reg, info = {}) {
  return {
    v: VERSION,
    file: reg ? reg.name : (info.name || ''),
    channelId: reg ? reg.channelId : '',
    status: null,
    reason: '',
    primingChannel: reg ? reg.primingChannel : '',
    from: reg && reg.from ? reg.from : null,
    voice: null,
    style: null,
    speed: reg ? reg.speed : null,
    channel: null,
    sameVoice: [],
    sameStyle: [],
    forOrder: null,
    notes: [],
    at: info.at || '',
    priming: info.version || '',
  };
}

function _reason(e) {
  const msg = String((e && e.message) || e || '').split(/\r?\n/)[0];
  let s = msg;
  try { s = require('./log-scrub').scrub(msg); } catch (_) {}
  return s.slice(0, 300);
}

/**
 * 등록 한 번(읽기 → 확인 → 목소리 → 그림체 → 채널). 결과서 객체를 돌려준다(쓰기는 부르는 쪽).
 * deps = {
 *   presets: { loadAll, add }, styles: { loadAll, add },
 *   listVoices(): Promise<[이름|{name}] & {deleted}|null>, voiceAudio(name): Promise<Buffer|null>, localVoice(name): Buffer|null,
 *   checkAudio(buf, text, lang): Promise<{ok, score, heard, unknown}>, saveVoice({name, text, wavBuffer}): Promise<{ok, name, error}>,
 *   pushStyles(): Promise, afterPreset(): void, wavSec(buf): number, log(m), at: 'KST 시각', version }
 */
async function register(file, deps) {
  const log = deps.log || (() => {});
  const r0 = readRegistration(file);
  const res = blankResult(r0.reg, { name: regName(file), at: deps.at, version: deps.version });
  const done = (status, reason = '') => Object.assign(res, { status, reason: reason ? _reason(reason) : '' });
  if (!r0.ok) return done(STATUS.reject, r0.errors.join(' / '));
  const reg = r0.reg;

  let voices = null, deleted = [];
  try {
    const v = await deps.listVoices();
    if (Array.isArray(v)) { voices = v.map((x) => (typeof x === 'string' ? x : (x && x.name) || '')).filter(Boolean); deleted = (v.deleted || []).map(String); }
  } catch (_) {}
  const known = { presets: deps.presets.loadAll(), voices, deleted, styles: deps.styles.loadAll() };
  const p = plan(reg, known);
  if (p.errors.length) return done(STATUS.reject, p.errors.join(' / '));

  // 🎙 새 목소리 — 길이 · 받아쓰기 대조(참조 텍스트가 음성과 같은가) → 기존 저장 길(이 PC 폴더 + 서버 공용 라이브러리) → 서버 목록으로 다시 확인
  if (reg.voice.mode === 'new') {
    const buf = fs.readFileSync(reg.voice.file);
    let sec = 0;
    try { sec = deps.wavSec(buf); } catch (e) { return done(STATUS.reject, `참조 음성을 읽을 수 없습니다 — ${e.message}`); }
    if (!(sec >= REF_SEC.min && sec <= REF_SEC.max)) return done(STATUS.reject, `참조 음성 길이 ${Math.round(sec * 10) / 10}초 — ${REF_SEC.min}~${REF_SEC.max}초만 받습니다`);
    if (p.voice.clash) {
      const srv = await deps.voiceAudio(reg.voice.name).catch(() => null);
      if (!srv) return done(STATUS.reject, `음성 서버에 「${reg.voice.name}」 이 이미 있는데 그 음성을 받아 비교하지 못했습니다 — 덮어쓰지 않습니다`);
      if (!Buffer.from(srv).equals(buf)) return done(STATUS.reject, `음성 서버에 이름이 같은 다른 목소리 「${reg.voice.name}」 가 있습니다 — 덮어쓰지 않습니다(다른 이름으로 등록해 주세요)`);
      p.voice.how = '이미 등록된 같은 음성';
      res.notes.push('같은 음성이 이미 서버에 있어 다시 올리지 않았습니다(참조 텍스트는 서버 것 그대로)');
    } else {
      const loc = deps.localVoice(reg.voice.name);
      if (loc && !Buffer.from(loc).equals(buf)) return done(STATUS.reject, `이 PC 참조음성 폴더에 이름이 같은 다른 음성 「${reg.voice.name}」 가 있습니다 — 덮어쓰지 않습니다`);
      let c = null;
      try { c = await deps.checkAudio(buf, reg.voice.text, reg.voice.lang); } catch (_) { c = null; }
      if (c && !c.unknown && !c.ok) return done(STATUS.reject, `참조 텍스트가 음성과 다릅니다(받아쓰기 일치 ${Math.round((c.score || 0) * 100)}%) — 들린 글: ${String(c.heard || '').slice(0, 120)}`);
      if (!c || c.unknown) res.notes.push('참조 음성을 받아써 확인하지 못했습니다 — 참조 텍스트가 음성과 같은지 사람이 들어 볼 것');
      else res.notes.push(`참조 텍스트 받아쓰기 일치 ${Math.round((c.score || 0) * 100)}%`);
      const sv = await deps.saveVoice({ name: reg.voice.name, text: reg.voice.text, wavBuffer: buf }).catch((e) => ({ ok: false, error: _reason(e) }));
      if (!sv || !sv.ok) return done(STATUS.fail, `목소리를 음성 서버에 등록하지 못했습니다 — ${(sv && sv.error) || '알 수 없음'}`);
      if (sv.name && sv.name !== reg.voice.name) return done(STATUS.fail, `음성 서버가 다른 이름 「${sv.name}」 으로 저장했습니다 — 이 채널은 만들지 않았습니다(서버 라이브러리를 사람이 확인할 것)`);
      const again = await deps.listVoices().catch(() => null);
      const names = Array.isArray(again) ? again.map((x) => (typeof x === 'string' ? x : (x && x.name) || '')) : null;
      if (!names || !names.includes(reg.voice.name)) return done(STATUS.fail, `등록한 목소리 「${reg.voice.name}」 가 음성 서버 목록에 보이지 않습니다 — 채널은 만들지 않았습니다`);
      log(`🎙 목소리 「${reg.voice.name}」 등록 — ${Math.round(sec * 10) / 10}초`);
    }
  }
  res.voice = { name: p.voice.name, how: p.voice.how };

  // 🎨 새 그림체 — 그림체 목록에 더하고 공용 목록(서버)에 올린다
  if (p.style.how === '새로 등록') {
    const st = deps.styles.add({ id: p.style.id, name: p.style.name, prompt: p.style.prompt });
    if (!st || st.id !== p.style.id) return done(STATUS.fail, `그림체 「${p.style.name}」 를 더하지 못했습니다${res.voice.how === '새로 등록' ? ' (목소리는 이미 등록됐습니다 — 같은 파일로 다시 등록하면 이어 갑니다)' : ''}`);
    try { await deps.pushStyles(); } catch (_) {}
    log(`🎨 그림체 「${p.style.name}」(${p.style.id}) 등록`);
  }
  res.style = { id: p.style.id, name: p.style.name, how: p.style.how };

  // 📺 채널 — 새 이름으로만(기존 채널은 손대지 않는다)
  if (p.channel.how === '새로 만듦') {
    const preset = buildPreset(reg, p, { at: deps.at });
    deps.presets.add(preset);
    const back = deps.presets.loadAll().find((x) => x.name === reg.primingChannel);
    if (!back || back.voiceCloneRefAudio !== 'srv:' + p.voice.name) return done(STATUS.fail, `채널 「${reg.primingChannel}」 을 저장하지 못했습니다`);
    try { deps.afterPreset && deps.afterPreset(); } catch (_) {}
    log(`📺 채널 「${reg.primingChannel}」 만듦 — 목소리 ${p.voice.name} · 그림체 ${p.style.id} · 배속 ${reg.speed}${p.from ? ` · 원본 ${p.from.name}` : ' · 기본 틀'}`);
  } else res.notes.push('같은 값으로 이미 등록된 채널입니다 — 아무것도 바꾸지 않았습니다');
  res.channel = p.channel.how;
  Object.assign(res, sameUse(deps.presets.loadAll(), { voice: p.voice.name, styleId: p.style.id, except: reg.primingChannel }));
  res.forOrder = { primingChannel: reg.primingChannel, voice: p.voice.name, style: p.style.id, speed: reg.speed };
  return done(STATUS.ok);
}

module.exports = { VERSION, STATUS, EXIT, LANGS, REF_SEC, IDENTITY_KEYS, BASE_TEMPLATE, regName, readRegistration, sameUse, sameAsRegistered, plan, buildPreset, blankResult, register };
