'use strict';
/**
 * today-scripts.js — 📅 오늘 작업할 대본 찾기(v0.9.85 · 로이 2026-10-20)
 *
 * 규칙(한 곳): **채널마다 「게시일 ≥ 오늘(KST)」인 대본 가운데 아직 안 만든 가장 이른 날짜의 대본.**
 *   - 게시일 = 파일 이름 속 날짜 — `[고전_1021] …` 의 MMDD(_ 또는 [ 뒤 네 자리 + ] 또는 공백) 또는 `2026-10-21` 꼴.
 *     MMDD 의 연도는 경로의 `2026_10` 폴더를 먼저 보고, 없으면 오늘에서 반년 안쪽 연도로 잡는다(연말 → 1월 대본).
 *   - 폴더는 채널 「대본 폴더」(scriptFolder) 아래를 3단계까지 — `_`·`.` 로 시작하는 폴더(`_폐기` 등)는 건너뛴다.
 *   - 「만들었다」 판정은 부르는 쪽(main)이 넘긴다(.vrew · 같은 이름 MP4 · 업로드 기록) — 이 파일은 fs 읽기만.
 *   - 같은 채널에 가장 이른 날짜 대본이 여럿이면 그날 것은 모두 고른다.
 * 테스트: test/today-scripts.test.js
 */
const fs = require('fs');
const path = require('path');

const MAX_DEPTH = 3;

/** KST 오늘 → 'YYYY-MM-DD' */
function kstToday(now = Date.now()) {
  return new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
}

const pad = (n) => String(n).padStart(2, '0');
function _valid(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const _dayNum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400e3;

/** 파일 이름(+경로) → 'YYYY-MM-DD' | null */
function dateOf(fileName, relDir = '', today = kstToday()) {
  const name = String(fileName || '');
  const full = name.match(/(?:^|[^0-9])(20\d{2})[-.](\d{2})[-.](\d{2})(?![0-9])/);
  if (full && _valid(+full[1], +full[2], +full[3])) return `${full[1]}-${full[2]}-${full[3]}`;
  const md = name.match(/[_\[](\d{2})(\d{2})(?=[\]\s_])/);
  if (!md) return null;
  const m = +md[1], d = +md[2];
  // 경로의 `2026_10` · `2026-10` 폴더가 같은 달이면 그 연도
  const yf = String(relDir || '').match(/(?:^|[\\/])(20\d{2})[_-](\d{2})(?:[\\/]|$)/);
  if (yf && +yf[2] === m && _valid(+yf[1], m, d)) return `${yf[1]}-${pad(m)}-${pad(d)}`;
  const ty = +today.slice(0, 4);
  for (const y of [ty, ty + 1, ty - 1]) {
    if (!_valid(y, m, d)) continue;
    const s = `${y}-${pad(m)}-${pad(d)}`;
    if (Math.abs(_dayNum(s) - _dayNum(today)) <= 183) return s;
  }
  return null;
}

/** 폴더 아래 .md(날짜 있는 것만) → [{path, name, rel, date}] */
function scanFolder(root, today = kstToday()) {
  const out = [];
  const walk = (dir, rel, depth) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name.startsWith('_')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < MAX_DEPTH) walk(p, rel ? rel + '/' + e.name : e.name, depth + 1); continue; }
      if (!/\.md$/i.test(e.name)) continue;
      const date = dateOf(e.name, rel, today);
      if (date) out.push({ path: p, name: e.name.replace(/\.md$/i, ''), rel, date });
    }
  };
  if (root) walk(root, '', 0);
  return out;
}

/**
 * 채널 하나의 다음 대본 — files 중 date ≥ today 이고 isMade 가 거짓인 가장 이른 날짜의 것(여럿이면 그날 전부).
 * → { picks:[file], waiting: 그 뒤로 남은 안 만든 편 수, madeAhead: 오늘 이후인데 이미 만든 편 수 }
 */
function pickNext(files, today, isMade) {
  const fut = (files || []).filter((f) => f.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name, 'ko', { numeric: true })));
  const todo = [], made = [];
  for (const f of fut) (isMade(f) ? made : todo).push(f);
  if (!todo.length) return { picks: [], waiting: 0, madeAhead: made.length };
  const d0 = todo[0].date;
  const picks = todo.filter((f) => f.date === d0);
  return { picks, waiting: todo.length - picks.length, madeAhead: made.length };
}

/**
 * 채널들 → 오늘 작업할 대본 목록.
 * channels: [{name, folder}] · isMade(file, channelName) → bool
 * → { today, items:[{channel, path, name, date, waiting, madeAhead}], empty:[{channel, reason}] }
 */
function findToday(channels, isMade, today = kstToday()) {
  const items = [], empty = [];
  for (const ch of channels || []) {
    if (!ch || !ch.folder || !fs.existsSync(ch.folder)) { empty.push({ channel: ch && ch.name, reason: '대본 폴더 없음' }); continue; }
    const files = scanFolder(ch.folder, today);
    const r = pickNext(files, today, (f) => !!isMade(f, ch.name));
    if (!r.picks.length) { empty.push({ channel: ch.name, reason: r.madeAhead ? `앞으로 ${r.madeAhead}편 모두 만듦` : '오늘 이후 대본 없음' }); continue; }
    for (const f of r.picks) items.push({ channel: ch.name, path: f.path, name: f.name, date: f.date, waiting: r.waiting, madeAhead: r.madeAhead });
  }
  return { today, items, empty };
}

module.exports = { kstToday, dateOf, scanFolder, pickNext, findToday };
