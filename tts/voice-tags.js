'use strict';
/**
 * voice-tags.js — 🏷 OmniVoice 참조음성 **분류**(언어·성별·연령대) 저장소 (2026-10-06 로이 「옴니보이스의 음성 구분하여 관리」)
 *   참조음성은 이름·참조텍스트만 있어서 성별·연령대를 알 수 없다(이름에 「남성_중년」 같은 낱말이 있을 때만 추정). 사람이 한 번 분류해 두면
 *   음성 설정의 거르기(언어·성별·연령대)가 그것을 먼저 따른다.
 *   · 파일 = ~/.flow-app/omni-voice-tags.json  { "<참조음성 이름>": { gender, age, lang } }  — 이 PC 에만(목소리 파일은 서버 공용이지만 분류는 PC 별)
 *   · gender = male|female · age = child|young|middle|old · lang = ko|ja|vi|en|zh … 빈 값은 저장하지 않는다(= 이름으로 추정에 맡김)
 *   · 이름이 바뀌거나 지워진 목소리의 분류는 목록에 안 나올 뿐 남겨 둔다(되살리면 이어진다)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const GENDERS = ['male', 'female'];
const AGES = ['child', 'young', 'middle', 'old'];
const LANGS = ['ko', 'ja', 'vi', 'en', 'zh', 'es', 'fr', 'de'];

const FILE = () => process.env.PRIMING_VOICE_TAGS_FILE || path.join(os.homedir(), '.flow-app', 'omni-voice-tags.json');   // 환경변수는 시험용(로이의 분류 파일을 건드리지 않게)

function load() {
  try { const j = JSON.parse(fs.readFileSync(FILE(), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}
function save(all) {
  const f = FILE();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), 'utf8');
  fs.renameSync(tmp, f);
}
/** 입력을 정리 — 모르는 값·빈 값은 버린다. 아무것도 안 남으면 null(= 분류 지움) */
function normalize(t) {
  if (!t || typeof t !== 'object') return null;
  const out = {};
  if (GENDERS.includes(t.gender)) out.gender = t.gender;
  if (AGES.includes(t.age)) out.age = t.age;
  if (LANGS.includes(t.lang)) out.lang = t.lang;
  return Object.keys(out).length ? out : null;
}
/** 한 목소리의 분류를 바꾼다. patch 에 값이 '' 인 칸은 그 칸만 지운다 · tags=null 이면 분류 전체 지움 */
function set(name, tags) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('이름이 없습니다');
  const all = load();
  const cur = { ...(all[nm] || {}) };
  if (tags != null) {
    for (const [k, vv] of Object.entries(tags)) {
      if (vv === '') delete cur[k];                                   // 빈 값 = 그 칸만 지움
      else if (normalize({ [k]: vv })) cur[k] = vv;                   // 알려진 값만 — 모르는 값은 무시(기존 값 유지)
    }
  }
  const next = tags == null ? null : normalize(cur);
  if (next) all[nm] = next; else delete all[nm];
  save(all);
  return all;
}
/** 여러 목소리에 같은 분류를 한꺼번에 — 빈 값('')인 칸은 건드리지 않는다(있던 값 유지) */
function setMany(names, tags) {
  const all = load();
  const add = normalize(tags);
  if (!add) return all;
  for (const n of names || []) {
    const nm = String(n || '').trim(); if (!nm) continue;
    all[nm] = normalize({ ...(all[nm] || {}), ...add });
  }
  save(all);
  return all;
}
/** 서버 목록의 한 카드에 분류를 얹는다(칸 값이 이름 추정보다 앞서도록 gender·age·lang 에 직접) */
function apply(card, all) {
  const t = all && all[card.name];
  if (!t) return card;
  return { ...card, ...(t.gender ? { gender: t.gender } : {}), ...(t.age ? { age: t.age } : {}), ...(t.lang ? { lang: t.lang } : {}), tags: t };
}

module.exports = { load, save, set, setMany, normalize, apply, GENDERS, AGES, LANGS, FILE };
