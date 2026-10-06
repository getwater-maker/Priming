'use strict';
/**
 * roy-bank.js — 로이은행(경험은행 · 해석해설은행)에 「Claude 원문 → 로이 수정」 한 줄 덧붙이기 (2026-10-06, v0.7.3)
 *   표시 읽기는 core/roy-marks.js(순수). 여기는 파일을 쓴다 — main 전용(렌더러 번들에 넣지 않는다).
 *
 * 은행 파일 형식 = 채널사업부 `_본사\로이은행\README.md` 그대로(JSON Lines · UTF-8 · 한 줄 = 한 항목):
 *   {"id","날짜","출처":"프라이밍","채널","편","구분":"경험|해석","원문","수정","확인":"수정|그대로","사실":""}
 *   - id = 경험 `E-` · 해석 `I-` + KST 날짜 + 그날 순번(E-20261006-01). **같은 표시는 같은 id** — 고칠 때마다 덧붙이고 읽는 쪽이 마지막 줄을 쓴다.
 *   - ⛔ 줄을 지우거나 고치지 않는다(덧붙이기만 · fs.appendFileSync).
 *   - 「사실」(경험의 핵심 사실 한 줄)은 앱이 지어내지 않는다 — 비워 두고 Claude 가 은행을 읽을 때 채운다.
 * 🔑 원문 = **처음 본 Claude 초안**. 표시마다 ~/.priming-maker/roy-marks/<대본 파일명>.json 에 기억한다(작업본처럼 파일명이 열쇠).
 *   앱에서 아직 안 고친 표시의 글이 바뀌었으면(Claude 가 대본을 다시 씀) 원문도 새 초안으로 바꾼다. 앱에서 한 번이라도 고쳤으면 원문은 그대로.
 * 📁 은행 폴더 = ~/.priming-maker/roy-bank.json 의 dir(없으면 기본 `D:\## 아도나이로이\_본사\로이은행`).
 *   폴더가 없는 PC(아내 PC 등)는 ~/.priming-maker/roy-bank-pending.jsonl 에 모아 두고 알린다(잃지 않게).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_DIR = 'D:\\## 아도나이로이\\_본사\\로이은행';
const FILES = { exp: '경험은행.jsonl', int: '해석해설은행.jsonl' };
let _home = null;   // 테스트가 바꾼다
// 🧪 E2E 는 PM_ROY_HOME · PM_ROY_BANK_DIR 로 로이의 진짜 은행·기억 파일을 건드리지 않는다
const home = () => _home || process.env.PM_ROY_HOME || path.join(os.homedir(), '.priming-maker');
const kstDate = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);

function bankDir() {
  if (process.env.PM_ROY_BANK_DIR) return process.env.PM_ROY_BANK_DIR;
  try { const c = JSON.parse(fs.readFileSync(path.join(home(), 'roy-bank.json'), 'utf8')); if (c && c.dir) return String(c.dir); } catch (_) {}
  return DEFAULT_DIR;
}
const pendingFile = () => path.join(home(), 'roy-bank-pending.jsonl');
const safe = (s) => String(s || '대본').replace(/[\\/:*?"<>|]/g, '_');
function storeFile(scriptBase) { return path.join(home(), 'roy-marks', safe(scriptBase) + '.json'); }
function loadStore(scriptBase) {
  try { const j = JSON.parse(fs.readFileSync(storeFile(scriptBase), 'utf8')); if (j && j.marks) return j; } catch (_) {}
  return { marks: {} };
}
function saveStore(scriptBase, st) {
  const f = storeFile(scriptBase);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(st, null, 1), 'utf8');
}

/** 표시들의 원문(처음 본 초안)을 기억한다. marks = roy-marks.attachMarks().marks */
function rememberOriginals(scriptBase, marks) {
  const st = loadStore(scriptBase);
  let changed = false;
  for (const m of marks || []) {
    if (!m.found) continue;
    const r = st.marks[m.mid];
    if (!r || r.k !== m.k) { st.marks[m.mid] = { k: m.k, orig: m.text, edited: false }; changed = true; continue; }
    // 앱에서 안 고친 표시의 글이 밖에서 바뀌었다 = Claude 가 초안을 다시 썼다 → 새 초안이 원문(확인된 🟥 는 그대로)
    if (!r.edited && r.orig !== m.text && (m.k === 'int' || m.st !== '확인')) { r.orig = m.text; changed = true; }
  }
  if (changed) { try { saveStore(scriptBase, st); } catch (_) {} }
  return st;
}
function markEdited(scriptBase, mid) {
  const st = loadStore(scriptBase);
  if (st.marks[mid]) { st.marks[mid].edited = true; try { saveStore(scriptBase, st); } catch (_) {} }
}

function _ids(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').map((l) => { try { return JSON.parse(l).id; } catch { return null; } }).filter(Boolean); } catch { return []; }
}
function _newId(k, files, t) {
  const pre = (k === 'exp' ? 'E-' : 'I-') + kstDate(t).replace(/-/g, '') + '-';
  const seen = new Set(); for (const f of files) for (const id of _ids(f)) if (id.startsWith(pre)) seen.add(id);
  let n = seen.size + 1, id;
  do { id = pre + String(n).padStart(2, '0'); n++; } while (seen.has(id));
  return id;
}
/** `[역사_1007] 울산…` → `[역사_1007]` (대괄호 머리가 없으면 파일명 그대로) */
const epOf = (scriptBase) => { const m = String(scriptBase || '').match(/^\s*(\[[^\]]+\])/); return m ? m[1] : String(scriptBase || ''); };

/**
 * 한 줄 덧붙이기.
 * @param {{scriptBase:string, channel?:string, mark:{mid,k,text}, how:'수정'|'그대로'|'교정', source?:string, extra?:object, now?:number}} o
 *   source = 「출처」(기본 프라이밍 · 맞춤법 반영은 '교정') · extra = 뒤에 덧붙일 칸(교정: 「틀림→바름」 목록)
 * @returns {{ok:boolean, id:string, file:string, pending:boolean}}
 */
function append(o) {
  const { scriptBase, channel = '', mark, how, source = '프라이밍', extra = null, now = Date.now() } = o;
  const st = loadStore(scriptBase);
  const rec = st.marks[mark.mid] || (st.marks[mark.mid] = { k: mark.k, orig: mark.text, edited: false });
  const dir = bankDir();
  const okDir = (() => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } })();
  const file = okDir ? path.join(dir, FILES[mark.k]) : pendingFile();
  if (!rec.bankId) rec.bankId = _newId(mark.k, okDir ? [file, pendingFile()] : [pendingFile(), path.join(dir, FILES[mark.k])], now);
  const row = {
    id: rec.bankId, 날짜: kstDate(now), 출처: source, 채널: channel || '', 편: epOf(scriptBase),
    구분: mark.k === 'exp' ? '경험' : '해석', 원문: rec.orig || '', 수정: mark.text || '', 확인: how, 사실: '',
    ...(extra || {}),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf8');
  try { saveStore(scriptBase, st); } catch (_) {}
  return { ok: true, id: rec.bankId, file, pending: !okDir };
}

module.exports = { bankDir, rememberOriginals, markEdited, append, loadStore, storeFile, pendingFile, epOf, kstDate, FILES, DEFAULT_DIR, _setHome: (h) => { _home = h; } };
