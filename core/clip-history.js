'use strict';
/**
 * 🕘 클립(문장) 수정 이력 — 클립마다 「고치기 전」 글로 돌아갈 수 있게 한다(로이 2026-10-03).
 *
 *   한 문장을 고칠 때마다 그 문장의 이력(versions)에 새 글을 쌓는다. 처음 글이 versions[0] 이고 idx 가 지금 글이다.
 *   3번 고쳤으면 versions 는 4개(원본 + 3) — 그 안 어디로든(idx 이동) 갈 수 있다. 되돌린 뒤 새로 고치면 끝에 이어 붙인다(옛 것을 버리지 않는다).
 *   🔑 문장 id 는 글 해시라 고칠 때마다 바뀐다 → 이력 객체를 옛 id·새 id 둘 다에 걸어 둔다(전체 되돌리기(↶)로 옛 id 가 돌아와도 이어진다).
 *   🔑 찾을 때는 **지금 글이 이력 안에 있는지** 로 검증한다(밖에서 .md 를 고쳤으면 이력을 쓰지 않는다 — 엉뚱한 글로 덮지 않게).
 *   한 문장 → 한 문장 고치기만 이력으로 잇는다(나누기·합치기·삭제는 새 이력).
 *   파일: ~/.priming-maker/clip-history.json (최근 300개 이력만 · 읽기·쓰기 실패는 조용히 무시).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_VERSIONS = 60, MAX_CHAINS = 300;
const FILE = () => path.join(process.env.PM_UI_SMOKE ? os.tmpdir() : os.homedir(), process.env.PM_UI_SMOKE ? 'priming-smoke-clip-history.json' : path.join('.priming-maker', 'clip-history.json'));

const sig = (t) => String(t == null ? '' : t).replace(/\s+/g, '').replace(/["'“”‘’「」『』]/g, '');
let _loaded = false;
let _scopeFn = () => '';   // 어느 대본의 이력인가 — main 이 대본 파일명을 돌려주는 함수를 꽂는다(같은 글이 다른 대본에 있어도 이력이 안 섞이게)
function setScopeFn(fn) { _scopeFn = typeof fn === 'function' ? fn : () => ''; }
const scopeNow = () => { try { return String(_scopeFn() || ''); } catch { return ''; } };
const byId = new Map();   // 열쇠 = 대본범위 + 문장 id
const K = (scope, id) => scope + '|' + id;
const chains = [];        // 최근 순서 유지(저장용)

function load() {
  if (_loaded) return; _loaded = true;
  try {
    const arr = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    for (const c of (Array.isArray(arr) ? arr : [])) {
      if (!c || !Array.isArray(c.versions) || !c.versions.length || !Array.isArray(c.ids)) continue;
      const ch = { versions: c.versions.map((v) => ({ text: String(v.text), at: +v.at || 0 })), idx: Math.min(Math.max(0, c.idx | 0), c.versions.length - 1), ids: new Set(c.ids), scope: String(c.scope || '') };
      chains.push(ch); for (const id of ch.ids) byId.set(K(ch.scope, id), ch);
    }
  } catch { /* 없으면 빈 이력 */ }
}
let _timer = null;
function save() {
  if (_timer) return;
  _timer = setTimeout(() => {
    _timer = null;
    try {
      const out = chains.slice(-MAX_CHAINS).map((c) => ({ versions: c.versions, idx: c.idx, ids: [...c.ids], scope: c.scope }));
      fs.mkdirSync(path.dirname(FILE()), { recursive: true });
      fs.writeFileSync(FILE(), JSON.stringify(out), 'utf8');
    } catch { /* 이력 저장 실패가 편집을 막으면 안 된다 */ }
  }, 500);
  if (_timer.unref) _timer.unref();
}
function _prune() {
  while (chains.length > MAX_CHAINS) { const c = chains.shift(); for (const id of c.ids) if (byId.get(K(c.scope, id)) === c) byId.delete(K(c.scope, id)); }
}

/** 지금 문장({id, text})의 이력. 글이 이력과 안 맞으면 null. 맞으면 idx 를 지금 글 자리로 맞춘다. */
function chainOf(sen) {
  load();
  const ch = sen && byId.get(K(scopeNow(), sen.id));
  if (!ch) return null;
  const s = sig(sen.text);
  let i = (sig(ch.versions[ch.idx].text) === s) ? ch.idx : -1;
  if (i < 0) for (let k = ch.versions.length - 1; k >= 0; k--) if (sig(ch.versions[k].text) === s) { i = k; break; }
  if (i < 0) return null;
  ch.idx = i;
  return ch;
}
/** 화면에 보일 수정 횟수(이력 개수 − 1). 이력이 없으면 0. */
function countOf(sen) { const ch = chainOf(sen); return ch ? ch.versions.length - 1 : 0; }
function listOf(sen) {
  const ch = chainOf(sen);
  if (!ch) return { versions: [{ text: String(sen.text || ''), at: 0 }], idx: 0 };
  return { versions: ch.versions.map((v) => ({ text: v.text, at: v.at })), idx: ch.idx };
}
/**
 * 한 문장 → 한 문장 고치기 기록. oldSen → newSen.
 * @param restoreIdx  이력으로 되돌린 것이면 그 번호(새 글을 쌓지 않고 idx 만 옮긴다)
 */
function record(oldSen, newSen, restoreIdx) {
  load();
  let ch = chainOf(oldSen);
  if (!ch) { ch = { versions: [{ text: String(oldSen.text || ''), at: 0 }], idx: 0, ids: new Set(), scope: scopeNow() }; chains.push(ch); }
  else { const k = chains.indexOf(ch); if (k >= 0 && k !== chains.length - 1) { chains.splice(k, 1); chains.push(ch); } }
  if (restoreIdx != null && ch.versions[restoreIdx]) ch.idx = restoreIdx;
  else if (sig(newSen.text) !== sig(oldSen.text)) {
    ch.versions.push({ text: String(newSen.text || ''), at: Date.now() });
    if (ch.versions.length > MAX_VERSIONS) { ch.versions.splice(1, 1); }   // 원본(0)은 지키고 가장 오래된 중간 것부터 버린다
    ch.idx = ch.versions.length - 1;
  }
  ch.ids.add(oldSen.id); ch.ids.add(newSen.id);
  byId.set(K(ch.scope, oldSen.id), ch); byId.set(K(ch.scope, newSen.id), ch);
  _prune(); save();
  return ch;
}
function _resetForTest() { _loaded = true; byId.clear(); chains.length = 0; }

module.exports = { setScopeFn, chainOf, countOf, listOf, record, sig, _resetForTest };
