/**
 * .vrew 입력 지문 — 「이미 최신이면 다시 만들지 않는다」(로이 2026-10-01).
 *
 * 4단계(.vrew 생성)는 예전엔 파일이 있어도 매번 WAV→MP3 변환부터 다시 했다.
 * 지문 = .vrew 를 만드는 입력(문장·그룹·오버레이·자막 서식·AI 고지·BGM·로고·출력 방식·앱 버전)을 정규화해 해시한 값.
 * 파일 경로(음성·그림·영상·BGM·로고)는 경로 + 크기 + 수정시각으로 바꿔 넣는다 — 내용이 바뀌면 지문이 달라진다.
 *
 * 🔴 판정은 fail-closed: 읽기·계산이 하나라도 실패하면 null → 호출부가 새로 만든다(옛 파일을 조용히 내보내지 않는다).
 * 🔴 진행 상태 필드(…Status·selected 등)는 지문에서 뺀다 — 앱을 다시 열면 값이 달라지는 값이라 넣으면 영영 건너뛰지 못한다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VOLATILE_KEYS = new Set(['selected', 'ttsStatus', 'imageStatus', 'videoStatus', 'generating', 'progress', 'error', 'ttsPresetId']);
const PATH_RE = /^(?:[A-Za-z]:[\\/]|\\\\)/;

function collectPaths(v, out) {
  if (typeof v === 'string') { if (PATH_RE.test(v)) out.add(v); return; }
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) { for (const x of v) collectPaths(x, out); return; }
  for (const k of Object.keys(v)) { if (!VOLATILE_KEYS.has(k)) collectPaths(v[k], out); }
}

async function statSigs(paths, concurrency = 16) {
  const list = [...paths];
  const sigs = new Map();
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const p = list[i++];
      try {
        const st = await fs.promises.stat(p);
        sigs.set(p, st.isFile() ? `${st.size}:${Math.floor(st.mtimeMs)}` : 'dir');
      } catch { sigs.set(p, 'missing'); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) || 1 }, worker));
  return sigs;
}

function canon(v, sigs) {
  if (typeof v === 'string') return PATH_RE.test(v) ? `${v}|${sigs.get(v)}` : v;
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => canon(x, sigs));
  const o = {};
  for (const k of Object.keys(v).sort()) {
    if (VOLATILE_KEYS.has(k)) continue;
    const x = v[k];
    if (x == null || typeof x === 'function') continue;   // null 과 없음은 같다(작업본 왕복에서 undefined 가 사라진다)
    o[k] = canon(x, sigs);
  }
  return o;
}

/** inputs(임의 객체) → sha256 16진 문자열. 실패하면 null. */
async function fingerprint(inputs) {
  try {
    const paths = new Set();
    collectPaths(inputs, paths);
    const sigs = await statSigs(paths);
    return crypto.createHash('sha256').update(JSON.stringify(canon(inputs, sigs)), 'utf8').digest('hex');
  } catch { return null; }
}

async function fileSig(p) {
  try { const st = await fs.promises.stat(p); return st.isFile() ? { size: st.size, mtimeMs: Math.floor(st.mtimeMs) } : null; }
  catch { return null; }
}
const sameSig = (a, b) => !!a && !!b && a.size === b.size && a.mtimeMs === b.mtimeMs;

function recordPath(outRoot, baseName) {
  const safe = String(baseName).replace(/[\\/:*?"<>|]/g, '_');
  return path.join(outRoot, '.priming-build', `${safe}.json`);
}
function readRecord(outRoot, baseName) {
  try { return JSON.parse(fs.readFileSync(recordPath(outRoot, baseName), 'utf8')); } catch { return null; }
}
function writeRecord(outRoot, baseName, rec) {
  try {
    const f = recordPath(outRoot, baseName);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(rec), 'utf8');
    return true;
  } catch { return false; }
}

/**
 * 이미 최신인지 판정. 돌려주는 값: { vrewOk, mp4Ok, why }
 *  - vrewOk: 지문이 같고 .vrew 가 기록한 그대로(크기·시각)라 다시 만들 필요 없음
 *  - mp4Ok : 위에 더해 MP4 도 기록한 그대로 있음(mp4Path 를 준 경우만 의미)
 */
async function checkUpToDate({ outRoot, baseName, fp, vrewPath, mp4Path = null }) {
  if (!fp) return { vrewOk: false, mp4Ok: false, why: '지문 계산 실패' };
  const rec = readRecord(outRoot, baseName);
  if (!rec || !rec.fp) return { vrewOk: false, mp4Ok: false, why: '이전 기록 없음' };
  if (rec.fp !== fp) return { vrewOk: false, mp4Ok: false, why: '입력이 바뀜' };
  if (!sameSig(await fileSig(vrewPath), rec.vrew)) return { vrewOk: false, mp4Ok: false, why: '.vrew 가 없거나 바뀜' };
  let mp4Ok = false;
  if (mp4Path && rec.mp4 && rec.mp4.path === mp4Path) mp4Ok = sameSig(await fileSig(mp4Path), rec.mp4);
  return { vrewOk: true, mp4Ok, why: '' };
}

/** .vrew(와 MP4)를 만든 직후 기록한다. */
async function recordBuilt({ outRoot, baseName, fp, vrewPath, mp4Path = null }) {
  if (!fp) return false;
  const vrew = await fileSig(vrewPath);
  if (!vrew) return false;
  const mp4 = mp4Path ? await fileSig(mp4Path) : null;
  return writeRecord(outRoot, baseName, { fp, builtAt: Date.now(), vrew, mp4: mp4 ? { path: mp4Path, ...mp4 } : null });
}

/** 같은 .vrew 로 MP4 만 새로 구웠을 때 기록을 갱신한다. */
async function recordMp4({ outRoot, baseName, mp4Path }) {
  const rec = readRecord(outRoot, baseName);
  const mp4 = await fileSig(mp4Path);
  if (!rec || !mp4) return false;
  rec.mp4 = { path: mp4Path, ...mp4 };
  return writeRecord(outRoot, baseName, rec);
}

/**
 * 🔖 기록이 없는 기존 완성물을 「지금 파일 그대로 최신」으로 채택한다(일회용 — 건너뛰기 기능이 생기기 전에 만든 작업).
 *   안전장치: .vrew 의 수정시각이 **모든 입력 파일(음성·그림·영상·삽입·BGM·로고·대본 .md)** 보다 같거나 새로울 때만.
 *   MP4 모드면 MP4 도 있어야 하고 .vrew 이후에 만들어졌어야 한다. 하나라도 어긋나면 채택하지 않는다(= 새로 만든다).
 *   ⚠ 파일로 남지 않는 설정(자막 서식 등)이 완성 뒤에 바뀐 것은 이 검사로 못 잡는다 — 채택은 기록이 없을 때 **한 번뿐**이고,
 *     그 뒤로는 지문이 비교한다.
 * @returns {Promise<boolean>} 채택했으면 true
 */
async function adoptIfFresh({ outRoot, baseName, fp, vrewPath, mp4Path = null, inputs, extraPaths = [], slackMs = 2000 }) {
  try {
    if (!fp || readRecord(outRoot, baseName)) return false;
    const vrew = await fileSig(vrewPath);
    if (!vrew) return false;
    let mp4 = null;
    if (mp4Path) {
      mp4 = await fileSig(mp4Path);
      if (!mp4 || mp4.mtimeMs + slackMs < vrew.mtimeMs) return false;
    }
    const paths = new Set(extraPaths.filter(Boolean));
    collectPaths(inputs, paths);
    for (const p of paths) {
      let st; try { st = await fs.promises.stat(p); } catch { return false; }   // 입력 파일이 하나라도 없으면 채택 안 함
      if (st.isFile() && st.mtimeMs > vrew.mtimeMs + slackMs) return false;
    }
    return writeRecord(outRoot, baseName, { fp, builtAt: Date.now(), adopted: true, vrew, mp4: mp4 ? { path: mp4Path, ...mp4 } : null });
  } catch { return false; }
}

module.exports = { adoptIfFresh, fingerprint, checkUpToDate, recordBuilt, recordMp4, recordPath, readRecord, VOLATILE_KEYS };
