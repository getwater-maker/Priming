// 🕘 세대별 백업 (Lab · Vrew 차이표 #3) — 작업본(.smproj.json)과 대본(.md)을 「세대」로 따로 보관한다.
//   왜: 자동저장은 한 파일을 계속 덮어쓴다 → 잘못 고친 대본·오염된 작업본을 되돌릴 곳이 없었다.
//   · 한 세대 = 폴더 하나 `<root>/<대본이름>/<KST 시각>/` 안에 snap.json · script.md · meta.json
//   · 너무 잦지 않게: 마지막 세대보다 minGapMs(기본 10분) 안이면 건너뛴다 · 내용(해시)이 같으면 건너뛴다
//   · 정리: 대본마다 keep(기본 30)세대 · 전체 maxBytes(기본 300MB) — 가장 최근 세대는 절대 지우지 않는다
//   · 쓰기는 `.tmp` 폴더에 다 쓴 뒤 이름 바꾸기(쓰다 만 세대가 목록에 보이지 않게)
//   ⚠ 렌더러 번들에 들어가지 않는다(main 전용) — 그래도 CJS 자기검사는 쓰지 않는다(CLAUDE.md §7 자막 끝 줄).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEF = { minGapMs: 10 * 60 * 1000, keep: 30, maxBytes: 300 * 1024 * 1024 };
const ID_RE = /^\d{8}-\d{6}-\d{3}$/;

function _kstId(ms) {
  const d = new Date(ms + 9 * 3600 * 1000);   // KST(UTC+9) — 전역 지침
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${p(d.getUTCMilliseconds(), 3)}`;
}
function _hash(buf) { return buf ? crypto.createHash('sha1').update(buf).digest('hex') : null; }
function _read(f) { try { return fs.readFileSync(f); } catch { return null; } }
function _dirSize(d) { let n = 0; try { for (const f of fs.readdirSync(d)) { try { n += fs.statSync(path.join(d, f)).size; } catch {} } } catch {} return n; }
function _rmDir(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

function listGens(root, base) {
  const dir = path.join(root, base);
  let ids = [];
  try { ids = fs.readdirSync(dir).filter((n) => ID_RE.test(n)); } catch { return []; }
  ids.sort();   // 이름 = 시각 → 사전순 = 시간순
  return ids.map((id) => {
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, id, 'meta.json'), 'utf8')) || {}; } catch {}
    return { id, dir: path.join(dir, id), ...meta };
  });
}

// 백업할 만하면 한 세대를 만든다 → { made, id?, why? }
function maybeBackup({ root, base, snapFile, scriptPath, reason = 'auto', now = Date.now(), force = false, opts = {} }) {
  const o = { ...DEF, ...opts };
  if (!root || !base) return { made: false, why: 'no-key' };
  const gens = listGens(root, base);
  const last = gens[gens.length - 1];
  if (!force && last && last.at && now - last.at < o.minGapMs) return { made: false, why: 'gap' };
  const snap = snapFile ? _read(snapFile) : null;
  const md = scriptPath ? _read(scriptPath) : null;
  if (!snap && !md) return { made: false, why: 'nothing' };
  const snapHash = _hash(snap), mdHash = _hash(md);
  if (last && last.snapHash === snapHash && last.mdHash === mdHash) return { made: false, why: 'same' };
  let id = _kstId(now);
  const dir = path.join(root, base);
  while (fs.existsSync(path.join(dir, id))) id = _kstId(now += 1);
  const tmp = path.join(dir, '.tmp-' + id);
  try {
    fs.mkdirSync(tmp, { recursive: true });
    if (snap) fs.writeFileSync(path.join(tmp, 'snap.json'), snap);
    if (md) fs.writeFileSync(path.join(tmp, 'script.md'), md);
    let sentences = null;
    try { if (snap) { const j = JSON.parse(snap.toString('utf8')); sentences = (j.projects || []).reduce((n, p) => n + (p.groups || []).reduce((m, g) => m + ((g.sentences || []).length), 0), 0); } } catch {}
    const meta = { at: now, reason, scriptPath: scriptPath || null, snapHash, mdHash, mdSize: md ? md.length : 0, snapSize: snap ? snap.length : 0, sentences };
    fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    fs.renameSync(tmp, path.join(dir, id));
  } catch (e) { _rmDir(tmp); return { made: false, why: 'error', error: e.message }; }
  prune(root, base, o);
  return { made: true, id };
}

// 정리 — 대본마다 keep 세대 · 전체 maxBytes. 가장 최근 세대는 남긴다.
function prune(root, base, opts = {}) {
  const o = { ...DEF, ...opts };
  let removed = 0;
  const gens = listGens(root, base);
  for (const g of gens.slice(0, Math.max(0, gens.length - o.keep))) { _rmDir(g.dir); removed++; }
  // 전체 용량 — 모든 대본의 세대를 시간순으로 모아 오래된 것부터(각 대본의 최신 세대는 제외)
  let all = [];
  try { for (const b of fs.readdirSync(root)) { const gs = listGens(root, b); gs.forEach((g, i) => all.push({ ...g, newest: i === gs.length - 1, size: _dirSize(g.dir) })); } } catch {}
  let total = all.reduce((n, g) => n + g.size, 0);
  all = all.filter((g) => !g.newest).sort((a, b) => (a.at || 0) - (b.at || 0));
  for (const g of all) { if (total <= o.maxBytes) break; _rmDir(g.dir); total -= g.size; removed++; }
  return removed;
}

// 대본마다 세대 목록(최신 먼저) — 화면용
function listAll(root) {
  const out = [];
  let bases = [];
  try { bases = fs.readdirSync(root).filter((b) => { try { return fs.statSync(path.join(root, b)).isDirectory(); } catch { return false; } }); } catch {}
  for (const base of bases) {
    const gens = listGens(root, base).reverse();
    if (!gens.length) continue;
    out.push({ base, scriptPath: (gens.find((g) => g.scriptPath) || {}).scriptPath || null,
      gens: gens.map((g) => ({ id: g.id, at: g.at, reason: g.reason, mdSize: g.mdSize || 0, sentences: g.sentences, hasMd: fs.existsSync(path.join(g.dir, 'script.md')), hasSnap: fs.existsSync(path.join(g.dir, 'snap.json')) })) });
  }
  out.sort((a, b) => ((b.gens[0] && b.gens[0].at) || 0) - ((a.gens[0] && a.gens[0].at) || 0));
  return out;
}

function _writeAtomic(dst, buf) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const tmp = dst + '.restore-tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dst);
}
// 되살리기 — 먼저 지금 상태를 한 세대로 남기고(force · reason 'before-restore'), 그 세대의 파일을 제자리에 쓴다.
function restore({ root, base, id, snapFile, scriptPath, now = Date.now() }) {
  if (!ID_RE.test(String(id || ''))) throw new Error('세대 이름이 올바르지 않습니다');
  const dir = path.join(root, base, id);
  if (!fs.existsSync(dir)) throw new Error('그 백업이 없습니다');
  const snap = _read(path.join(dir, 'snap.json'));
  const md = _read(path.join(dir, 'script.md'));
  if (!snap && !md) throw new Error('그 백업에 파일이 없습니다');
  if (md && !scriptPath) throw new Error('대본 위치를 모릅니다');
  const pre = maybeBackup({ root, base, snapFile, scriptPath, reason: 'before-restore', now, force: true });
  if (md) _writeAtomic(scriptPath, md);
  if (snap && snapFile) _writeAtomic(snapFile, snap);
  return { ok: true, md: !!md, snap: !!snap, before: pre.made ? pre.id : null };
}

module.exports = { DEF, listGens, maybeBackup, prune, listAll, restore, _kstId };
