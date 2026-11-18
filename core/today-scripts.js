'use strict';
/**
 * today-scripts.js — 📅 오늘 작업할 대본 찾기(v0.9.85 · 로이 2026-10-20)
 *
 * 규칙(한 곳): **채널마다 「게시일 ≥ 오늘(KST)」인 대본 가운데 아직 안 만든 편 전부**(v1.0.60 · 로이 2026-11-18 「전부 보이게」 — 옛 「가장 이른 한 편」 폐기).
 *   목록·큐 순서 = 게시일이 이른 편부터(채널이 섞인다 · 같은 날은 채널 순서 → 이름순) — ⚡ 만들기가 큐 순서대로 만든다.
 *   - 게시일 = 파일 이름 속 날짜 — `[고전_1021] …` 의 MMDD(_ 또는 [ 뒤 네 자리 + ] 또는 공백) 또는 `2026-10-21` 꼴.
 *     MMDD 의 연도는 경로의 `2026_10` 폴더를 먼저 보고, 없으면 오늘에서 반년 안쪽 연도로 잡는다(연말 → 1월 대본).
 *   - 폴더는 채널 「대본 폴더」(scriptFolder) 아래를 3단계까지 — `_`·`.` 로 시작하는 폴더(`_폐기` 등)는 건너뛴다.
 *   - 「만들었다」 판정은 부르는 쪽(main)이 넘긴다(.vrew · 같은 이름 MP4 · 업로드 기록) — 이 파일은 fs 읽기만.
 *   - 📦 항목마다 `pack`(packagingStatus) — 패키징이 미완이면 화면은 보여만 주고 큐에 넣지 않는다(main open-scripts-list 도 다시 막는다 · v1.0.55).
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
 * 채널 하나의 안 만든 편 — files 중 date ≥ today 이고 isMade 가 거짓인 것 전부(게시일 → 이름순).
 * → { picks:[file], madeAhead: 오늘 이후인데 이미 만든 편 수 }
 */
function pickNext(files, today, isMade) {
  const fut = (files || []).filter((f) => f.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name, 'ko', { numeric: true })));
  const todo = [], made = [];
  for (const f of fut) (isMade(f) ? made : todo).push(f);
  return { picks: todo, madeAhead: made.length };
}

/**
 * 채널들 → 오늘 작업할 대본 목록.
 * channels: [{name, folder}] · isMade(file, channelName) → bool · opts = { thumbRoot }(📦 패키징 판정의 썸네일 폴더)
 * → { today, items:[{channel, path, name, date, madeAhead, pack}](게시일 → 채널 순서 → 이름순), empty:[{channel, reason}] }
 */
function findToday(channels, isMade, today = kstToday(), opts = {}) {
  const thumbIndex = thumbIndexOf(opts.thumbRoot);   // 썸네일 폴더는 한 번만 읽는다
  const items = [], empty = [];
  for (const ch of channels || []) {
    if (!ch || !ch.folder || !fs.existsSync(ch.folder)) { empty.push({ channel: ch && ch.name, reason: '대본 폴더 없음' }); continue; }
    const files = scanFolder(ch.folder, today);
    const r = pickNext(files, today, (f) => !!isMade(f, ch.name));
    if (!r.picks.length) { empty.push({ channel: ch.name, reason: r.madeAhead ? `앞으로 ${r.madeAhead}편 모두 만듦` : '오늘 이후 대본 없음' }); continue; }
    for (const f of r.picks) items.push({ channel: ch.name, path: f.path, name: f.name, date: f.date, madeAhead: r.madeAhead, pack: packagingStatus(f.path, { thumbIndex }), _ord: (channels || []).indexOf(ch) });
  }
  // 게시일이 이른 편부터 — 같은 날은 채널 목록 순서, 그다음 이름순(채널 안 순서는 pickNext 가 이미 정했다)
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a._ord - b._ord || a.name.localeCompare(b.name, 'ko', { numeric: true })));
  for (const it of items) delete it._ord;
  return { today, items, empty };
}

/**
 * 📦 패키징 완료 판정(v1.0.55 · 로이 2026-11-17 「반드시 패키징 작업까지 완료된 것이 작업큐에 들어갈 수 있도록」) — 한 곳.
 *   패키징 파일 = core/yt-packaging.findPackagingFile(업로드가 읽는 그 파일) ·
 *   완료 = 업로드·썸네일이 쓰는 다섯 칸이 모두 채워짐: 제목 · 설명글 · 태그 · 고정댓글 · 썸네일 문구 A.
 *   (채널사업부는 제목·썸네일 문구를 대본 전에, 설명글·태그·고정댓글을 대본 뒤에 쓴다 — 앞쪽만 있으면 미완이다)
 *   fail-closed: 파일을 못 읽으면 미완.
 * 🖼 썸네일 그림까지(v1.0.56 · 로이 2026-11-17 「썸네일 그림까지 있어야 넣을 수 있게」) — 패키징에 문구가 있는 안(A·B·C)마다
 *   썸네일 폴더(⚙ 설정 → 📁 「썸네일」 · core/thumb-find 와 같은 자리: 폴더 바로 아래 + 한 단계 · `_` 폴더 제외)에
 *   `[약칭_MMDD] 썸네일_<안>.png|jpg|jpeg|webp` 가 있어야 한다. 폴더를 지정하지 않았거나 없으면 미완.
 * opts = { thumbRoot, thumbIndex? }(thumbIndex = thumbIndexOf(thumbRoot) — 여러 편을 볼 때 폴더를 한 번만 읽게)
 * → { ok, path|null, missing:[칸 이름] }
 */
const PACK_FIELDS = ['제목', '설명글', '태그', '고정댓글', '썸네일 문구 A'];
const IMG_RE = /\.(png|jpe?g|webp)$/i;
/** 썸네일 폴더 → 그림 파일 이름 Set(폴더 바로 아래 + 한 단계 · `_`·`.` 폴더 제외) | null(폴더 없음) */
function thumbIndexOf(root) {
  if (!root) return null;
  let top;
  try { top = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return null; }
  const set = new Set();
  const add = (ents) => { for (const e of ents) if (e.isFile() && IMG_RE.test(e.name)) set.add(e.name); };
  add(top);
  for (const e of top) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
    try { add(fs.readdirSync(path.join(root, e.name), { withFileTypes: true })); } catch (_) {}
  }
  return set;
}
function packagingStatus(scriptPath, opts = {}) {
  const YP = require('./yt-packaging');
  const pf = YP.findPackagingFile(scriptPath);
  if (!pf) return { ok: false, path: null, missing: ['패키징 파일'] };
  let text;
  try { text = fs.readFileSync(pf, 'utf8'); } catch (_) { return { ok: false, path: pf, missing: ['패키징 파일 읽기'] }; }
  const k = YP.parsePackaging(text);
  const th = require('./thumb-edit').parseThumbText(text);
  const have = { '제목': !!k.title, '설명글': !!k.description, '태그': k.tags.length > 0, '고정댓글': !!k.pinned, '썸네일 문구 A': !!(th.A && th.A.length) };
  const missing = PACK_FIELDS.filter((f) => !have[f]);
  // 🖼 썸네일 그림 — 문구가 있는 안마다(문구 A 가 없어도 A 그림은 본다)
  const idx = opts.thumbIndex !== undefined ? opts.thumbIndex : thumbIndexOf(opts.thumbRoot);
  if (!idx) missing.push('썸네일 폴더(⚙ 설정 → 📁 폴더)');
  else {
    const key = (path.basename(String(scriptPath)).match(/^\[[^\]\r\n]+\]/) || [''])[0];
    const plans = ['A', 'B', 'C'].filter((x) => x === 'A' || (th[x] && th[x].length));
    for (const x of plans) {
      const want = (n) => n.startsWith(key) && new RegExp('^\\s*썸네일_' + x + '\\.(png|jpe?g|webp)$', 'i').test(n.slice(key.length));
      if (!key || ![...idx].some(want)) missing.push('썸네일 그림 ' + x);
    }
  }
  return { ok: !missing.length, path: pf, missing };
}

module.exports = { kstToday, dateOf, scanFolder, pickNext, findToday, packagingStatus, thumbIndexOf, PACK_FIELDS };
