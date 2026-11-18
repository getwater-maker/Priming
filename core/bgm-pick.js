'use strict';
/**
 * 🎵 채널 배경음악 고르기 — 한 곳(v1.0.65 · 로이 2026-11-18 「Pixabay 무료 음악을 AI 가 골라 도입부 또는 전체에」).
 *
 *   - Pixabay 에는 음악 API 가 없다(공식 문서 = 이미지·영상뿐) → 곡은 로이가 받아 배경음악 **폴더**에 모은다.
 *     이 모듈은 그 폴더를 **읽기만** 하고, Claude 가 대본 분위기와 곡 이름(+ 옆 `<곡>.txt` 설명)을 보고 편마다 한 곡을 고른다.
 *   - 고른 곡은 기억 파일에 대본 이름으로 남긴다 → 같은 대본은 다시 만들어도 같은 곡(곡이 폴더에서 사라졌을 때만 다시 고른다).
 *   - AI 를 못 쓰면(키 없음 · 무인 제작 · 오류) 예전 규칙 그대로 = 대본 이름 해시로 한 곡(hashPick).
 *   - 🔎 Pixabay 찾기 = Claude 가 영어 검색어를 정하고 Pixabay 음악 검색 주소를 만든다(받기는 사람 — 자동으로 긁지 않는다).
 *   ⛔ 폴더의 음악 파일을 옮기거나 지우지 않는다 · ⛔ 화면(렌더러)에서 이 모듈을 부르지 않는다(fs).
 */
const fs = require('fs');
const path = require('path');

const BGM_EXT = /\.(mp3|wav|m4a|aac|flac|ogg)$/i;
const SCOPES = ['all', 'intro'];
const normScope = (v) => (v === 'intro' ? 'intro' : 'all');
const MAX_TRACKS = 200;   // 프롬프트에 싣는 곡 수 상한(이름 순 앞쪽)

/** 폴더의 곡 목록 [{name, file, note}] — 이름 순(한국어·숫자) · 옆 `<곡 이름>.txt` 가 있으면 앞 300자를 설명으로 */
function listTracks(dir, fsMod = fs) {
  try {
    if (!dir || !fsMod.existsSync(dir) || !fsMod.statSync(dir).isDirectory()) return [];
    const names = fsMod.readdirSync(dir).filter((f) => BGM_EXT.test(f)).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
    return names.map((name) => {
      let note = '';
      try { const t = path.join(dir, name.replace(BGM_EXT, '') + '.txt'); if (fsMod.existsSync(t)) note = String(fsMod.readFileSync(t, 'utf8')).replace(/\s+/g, ' ').trim().slice(0, 300); } catch (_) {}
      return { name, file: path.join(dir, name), note };
    });
  } catch (_) { return []; }
}

/** 예전 규칙(v0.x · 2026-09-24) — 대본 이름 해시로 한 곡. 같은 대본은 늘 같은 곡 */
function hashPick(tracks, key) {
  if (!tracks || !tracks.length) return null;
  let h = 0; for (const ch of String(key || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return tracks[h % tracks.length];
}

/** 대본 요약 — 파일 이름 + (도입부만이면 도입부 문장 · 전체면 도입부 + 본문 앞쪽) · 글자 상한 */
function scriptBrief({ name = '', sentences = [], scope = 'all', maxChars = 1800 } = {}) {
  const list = (sentences || []).filter((s) => s && String(s.text || '').trim());
  const intro = list.filter((s) => s.isIntro);
  const pick = normScope(scope) === 'intro' && intro.length ? intro : (intro.length ? intro.concat(list.filter((s) => !s.isIntro)) : list);
  let body = '';
  for (const s of pick) { const t = String(s.text).replace(/\s+/g, ' ').trim(); if (body.length + t.length + 1 > maxChars) break; body += (body ? ' ' : '') + t; }
  const title = String(name || '').replace(/\.[^.]+$/, '');
  return { title, text: body, introOnly: normScope(scope) === 'intro' && intro.length > 0 };
}

/** Claude 에 보낼 선곡 요청 — JSON 한 줄로 답하게 한다 */
function buildPickPrompt(brief, tracks) {
  const list = tracks.slice(0, MAX_TRACKS).map((t, i) => `${i + 1}. ${t.name}${t.note ? ` — ${t.note}` : ''}`).join('\n');
  return [
    '유튜브 영상의 배경음악을 고르는 일입니다. 내레이션 아래에 낮게 깔리는 음악입니다.',
    `영상 제목(파일 이름): ${brief.title || '(없음)'}`,
    `${brief.introOnly ? '도입부 내용' : '영상 내용(앞부분)'}: ${brief.text || '(없음)'}`,
    '',
    '후보 곡(파일 이름에 장르·분위기 낱말이 들어 있는 경우가 많습니다):',
    list,
    '',
    '내용의 분위기·시대·감정에 가장 어울리고, 내레이션을 방해하지 않을 곡 하나를 고르세요.',
    '보컬(가사)이 있어 보이는 곡은 피하세요.',
    '답은 JSON 한 줄만: {"file": "후보의 파일 이름 그대로", "why": "한국어 한 문장 이유"}',
  ].join('\n');
}

/** 답 → 후보 곡(정확히 일치 · 대소문자 무시 · 번호 「3」 도 받는다) · 못 찾으면 null */
function parsePick(text, tracks, parseJson) {
  const j = parseJson ? parseJson(text) : (() => { try { return JSON.parse(String(text || '').trim()); } catch (_) { return null; } })();
  if (!j || typeof j !== 'object') return null;
  const want = String(j.file || '').trim();
  if (!want) return null;
  let t = tracks.find((x) => x.name === want) || tracks.find((x) => x.name.toLowerCase() === want.toLowerCase());
  if (!t && /^\d+$/.test(want)) t = tracks[Number(want) - 1] || null;
  if (!t) return null;
  return { track: t, why: String(j.why || '').replace(/\s+/g, ' ').trim().slice(0, 200) };
}

/** 🔎 Pixabay 검색어 요청 — 영어 낱말 2~4개 */
function buildSearchPrompt(brief) {
  return [
    'Pixabay Music 에서 유튜브 영상 배경음악을 찾을 검색어를 정해 주세요. 내레이션 아래에 낮게 깔리는 보컬 없는 음악입니다.',
    `영상 제목(파일 이름): ${brief.title || '(없음)'}`,
    `${brief.introOnly ? '도입부 내용' : '영상 내용(앞부분)'}: ${brief.text || '(없음)'}`,
    '분위기·장르를 나타내는 영어 낱말 2~4개를 고르세요(예: cinematic, calm, piano, documentary).',
    '답은 JSON 한 줄만: {"keywords": ["...", "..."], "why": "한국어 한 문장"}',
  ].join('\n');
}
function parseKeywords(text, parseJson) {
  const j = parseJson ? parseJson(text) : null;
  const arr = j && Array.isArray(j.keywords) ? j.keywords : [];
  const kw = arr.map((k) => String(k || '').toLowerCase().replace(/[^a-z0-9 \-]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4);
  return kw.length ? { keywords: kw, why: String((j && j.why) || '').replace(/\s+/g, ' ').trim().slice(0, 200) } : null;
}
/** Pixabay 음악 검색 주소 — 검색어가 없으면 음악 첫 화면 */
function pixabayUrl(keywords) {
  const q = (keywords || []).map((k) => String(k).trim()).filter(Boolean).join(' ');
  return q ? `https://pixabay.com/music/search/${encodeURIComponent(q)}/` : 'https://pixabay.com/music/';
}

// ── 고른 곡 기억 — { "<폴더>|<대본 이름>": { name, why, at } } ──
function storePath() {
  if (process.env.PM_BGM_PICKS) return process.env.PM_BGM_PICKS;
  return path.join(require('os').homedir(), '.priming-maker', 'bgm-ai-picks.json');
}
const keyOf = (dir, scriptName) => `${path.resolve(String(dir || '')).toLowerCase()}|${String(scriptName || '')}`;
function loadStore(fp = storePath()) { try { const j = JSON.parse(fs.readFileSync(fp, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch (_) { return {}; } }
function saveChoice(dir, scriptName, choice, fp = storePath()) {
  const all = loadStore(fp);
  all[keyOf(dir, scriptName)] = { name: choice.name, why: choice.why || '', at: new Date().toISOString() };
  try { fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, JSON.stringify(all, null, 1), 'utf8'); return true; } catch (_) { return false; }
}
/** 기억된 곡 — 그 곡이 아직 폴더에 있을 때만 */
function storedChoice(dir, scriptName, tracks, fp = storePath()) {
  const c = loadStore(fp)[keyOf(dir, scriptName)];
  if (!c || !c.name) return null;
  const t = (tracks || []).find((x) => x.name === c.name);
  return t ? { track: t, why: c.why || '' } : null;
}

/**
 * 이 편의 곡 정하기(동기 · 빌드 경로) — 기억된 AI 선곡 > 해시. ai 가 꺼져 있으면 해시만.
 * @returns {{track, how:'ai'|'hash', why}|null}
 */
function choose({ dir, scriptName, ai, tracks, fp } = {}) {
  const list = tracks || listTracks(dir);
  if (!list.length) return null;
  if (ai) { const s = storedChoice(dir, scriptName, list, fp); if (s) return { track: s.track, how: 'ai', why: s.why }; }
  return { track: hashPick(list, scriptName), how: 'hash', why: '' };
}

module.exports = {
  BGM_EXT, SCOPES, normScope, MAX_TRACKS,
  listTracks, hashPick, scriptBrief, buildPickPrompt, parsePick, buildSearchPrompt, parseKeywords, pixabayUrl,
  storePath, keyOf, loadStore, saveChoice, storedChoice, choose,
};
