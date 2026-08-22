/**
 * merge-assets.js — 「📥 자산 이어받기」 (통합본/합본 대본이 기존 회차의 TTS·이미지·비디오를 물려받는다)
 *
 * 왜 필요한가 (2026-08-22, docs/통합본-자산이어받기-계획.md):
 *   고전서재 오디오북은 회차 14부를 만든 뒤 **통합본**(1~5부 등)을 따로 낸다. 통합대본은 각 부의 본문을
 *   **글자 그대로** 이어붙인 것이라 문장이 100% 같은데, 앱은 그 음성 파일이 **어디 있는지 알 방법이 없다**.
 *   그냥 「만들기」를 누르면 12시간 분량(GPU 5.6시간)을 통째로 재합성한다.
 *     🔴 TTS 캐시로는 안 된다 — v0.3.29 가 캐시 키에 refName(rn)을 넣어 08-21 이전 캐시가 전부 무효화됐고,
 *        애초에 「🗑 TTS 삭제」 한 번에 clearAll 되는 저장소라 정본이 될 수 없다.
 *   → 이 모듈이 **기존 출력폴더의 파일을 통합본 작업폴더로 복사하고 경로·길이를 주입**한다.
 *     그 다음은 기존 코드가 무수정으로 다 한다(fillTtsList 는 파일이 있으면 건너뛰고, 이미지·비디오 엔진도
 *     hasVisual 이면 건너뛰고, .vrew 게이트는 절대경로 실존만 본다).
 *
 * 함정(계획서 §6 — 전부 실제 사고/실측에서 나온 것):
 *   ① 🔴 **원본 폴더를 참조하지 않고 복사한다.** sweepBadVisuals 가 이상 판정 시 파일을 fs.rmSync 로
 *      실제로 지운다(main.js) → 원본을 가리키면 14부 산출물이 삭제된다.
 *   ② 🔴 **ttsDurationSec 를 반드시 함께 주입한다.** 없으면 vrew-builder 가 mp3 를 size/6000 으로 추정해
 *      약 4배 과대 계산하고, 그룹 길이 합산에서는 아예 빠진다 → 타임라인이 통째로 왜곡된다.
 *   ③ 🔴 **옛 스냅샷은 이름도 경로도 옛 것이다**(회차 대본이 개명됐다) → 스냅샷은 **지문(문장 텍스트)** 으로 찾고,
 *      경로는 **basename 만 취해 현재 출력폴더로 재기반(rebase) + 실존 확인**한다.
 *   ④ **그룹 num 은 안정 키가 아니다**(도입부 재배치가 재발번호한다) → 그룹 매칭은 반드시 imagePrompt 텍스트로.
 *   ⑤ 매칭률이 낮으면 **멈춘다** — 통합대본의 사소한 오탈자가 조용히 수 시간짜리 재합성으로 이어지지 않게.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── 정규화 ──────────────────────────────────────────────
//   매칭 키는 '공백 접기 + trim' 만 한다. 그 이상 관대하게 만들면(문장부호 제거 등) 서로 다른 문장이
//   같은 키가 되어 **엉뚱한 음성이 붙는다** — 조용히 틀리는 쪽이 새로 합성하는 것보다 나쁘다.
function normText(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }
function normPrompt(p) { return String(p == null ? '' : p).replace(/\s+/g, ' ').trim().toLowerCase(); }

// ── 1. '> 📥 자산출처: <대본.md> | <출력폴더>' 메타 파싱 ──────────────
//   '>' 인용이라 기존 파서는 조용히 버린다(하위호환) — 이 기능만 이 줄을 읽는다.
const SRC_RE = /^\s*>\s*(?:📥\s*)?자산출처\s*[:：]\s*(.+)$/;
function parseAssetSources(scriptText) {
  const out = [];
  for (const line of String(scriptText || '').split(/\r?\n/)) {
    const m = SRC_RE.exec(line);
    if (!m) continue;
    const parts = m[1].split('|').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) continue;
    // 출력폴더를 생략하면 대본만으로는 자산을 찾을 수 없다 → outDir=null 로 두고 리포트가 경고한다.
    out.push({ scriptPath: parts[0], outDir: parts[1] || null });
  }
  return out;
}
function hasAssetSources(scriptText) { return parseAssetSources(scriptText).length > 0; }
function fileHasAssetSources(scriptPath) {
  try { return hasAssetSources(fs.readFileSync(scriptPath, 'utf8')); } catch { return false; }
}

// ── 2. 스냅샷 찾기 ──────────────────────────────────────
function snapshotsDir() { return path.join(os.homedir(), '.priming-maker', 'projects'); }
function _sanitize(name) { return String(name).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim(); }

/** 스냅샷 JSON → 그룹을 저장 순서 그대로 평탄화 */
function _flattenSnapshot(snap) {
  const groups = [];
  for (const ps of (snap && snap.projects) || []) for (const gs of ps.groups || []) groups.push(gs);
  return groups;
}
function _snapshotSentenceTexts(snap) {
  const out = [];
  for (const gs of _flattenSnapshot(snap)) for (const ss of gs.sentences || []) out.push(normText(ss.text));
  return out;
}

/**
 * 소스 대본의 스냅샷(.smproj.json)을 찾는다.
 *   ① basename 일치 파일 우선(정상 경로)
 *   ② 없거나 지문이 안 맞으면 **지문 검색** — 대본이 개명되면 스냅샷 이름·안의 경로가 전부 옛 것이다(함정 ③).
 *      probe 문장을 raw 텍스트에서 싸게 찾아 후보를 좁힌 뒤에만 JSON.parse 한다(스냅샷이 수백 개다).
 * @param {string[]} probeTexts 소스 대본에서 뽑은 정규화된 문장 표본
 */
function findSnapshot(scriptPath, probeTexts, opts = {}) {
  const dir = opts.projDir || snapshotsDir();
  const base = _sanitize(path.basename(String(scriptPath || '')).replace(/\.md$/i, ''));
  const readSnap = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const probes = (probeTexts || []).filter(Boolean);
  const MIN = 0.6;  // probe 과반 이상 일치해야 같은 대본으로 본다
  const scoreOf = (snap) => {
    if (!snap) return -1;
    if (!probes.length) return 0;
    const set = new Set(_snapshotSentenceTexts(snap));
    let hit = 0; for (const p of probes) if (set.has(p)) hit++;
    return hit / probes.length;
  };

  const direct = path.join(dir, base + '.smproj.json');
  if (fs.existsSync(direct)) {
    const s = readSnap(direct);
    if (s && scoreOf(s) >= MIN) return { snap: s, file: direct, matchedBy: 'name', score: scoreOf(s) };
  }
  if (!probes.length) return null;

  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.smproj.json')); } catch { return null; }
  let best = null;
  for (const f of files) {
    const full = path.join(dir, f);
    if (full === direct) continue;
    let raw = '';
    try { raw = fs.readFileSync(full, 'utf8'); } catch { continue; }
    // 싼 1차 거르기 — probe 문장이 raw JSON 안에 문자열로 들어 있는지만 본다(JSON.parse 회피).
    let rough = 0;
    for (const p of probes) if (raw.includes(JSON.stringify(p).slice(1, -1))) rough++;
    if (rough / probes.length < MIN) continue;
    const s = readSnap(full);
    const sc = scoreOf(s);
    if (sc >= MIN && (!best || sc > best.score)) best = { snap: s, file: full, matchedBy: 'fingerprint', score: sc };
  }
  return best;
}

// ── 3. 소스 색인 ────────────────────────────────────────
const IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const AUD_EXT = ['.mp3', '.wav'];

/** 옛 절대경로 → basename 만 취해 현재 폴더로 재기반 + 실존 확인 (함정 ③) */
function rebase(oldPath, dir) {
  if (!oldPath || !dir) return null;
  const f = path.join(dir, path.basename(String(oldPath)));
  try { return fs.existsSync(f) ? f : null; } catch { return null; }
}
/** 비디오는 업스케일본(NN_1080.mp4)이 있으면 그쪽을 쓴다 */
function rebaseVideo(oldPath, dir) {
  if (!oldPath || !dir) return null;
  const b = path.basename(String(oldPath));
  const ext = path.extname(b), stem = b.slice(0, b.length - ext.length);
  const cands = /_1080$/.test(stem) ? [b] : [stem + '_1080' + ext, b];
  for (const c of cands) {
    const f = path.join(dir, c);
    try { if (fs.existsSync(f)) return f; } catch {}
  }
  return null;
}
/**
 * 스냅샷의 「문장 순번 ↔ 음성 파일명」이 일치하는가.
 *   fillTtsList 는 `<s.num>.wav` 로 쓰고 s.num 은 문장 순번이므로 정상 스냅샷은 항상 일치한다.
 *   합성 뒤 재분할된(번호가 밀린) 스냅샷을 걸러내기 위한 검사 — 번호 폴백의 안전 조건이다.
 *   기록된 경로가 하나도 없으면 확인할 방법이 없으므로 false(폴백 금지).
 */
function _ordinalMatchesFilename(snapGroups) {
  let ord = 0, checked = 0;
  for (const gs of snapGroups) {
    for (const ss of gs.sentences || []) {
      ord++;
      if (!ss.ttsAudioPath) continue;
      const b = path.basename(String(ss.ttsAudioPath));
      const stem = b.slice(0, b.length - path.extname(b).length);
      if (stem !== String(ord)) return false;
      checked++;
    }
  }
  return checked > 0;
}
function _firstExisting(dir, stem, exts) {
  for (const e of exts) { const f = path.join(dir, stem + e); try { if (fs.existsSync(f)) return f; } catch {} }
  return null;
}

/**
 * 자산출처 목록 → 매칭용 색인.
 *   sents[]  : { key, file, dur, srcIdx }  (소스 순서대로 평탄화)
 *   groups[] : { key, image, video, srcIdx }
 * @param {(p:string)=>{sentences:{text:string,num:number}[], groups:{imagePrompt:string,num:number}[]}} parseSource
 *        소스 .md 파서(스냅샷이 없을 때의 폴백 + 지문 추출용). main 은 P.parseScript 를 감싸 넘긴다.
 */
function buildSourceIndex(sources, parseSource, opts = {}) {
  const log = opts.log || (() => {});
  const sents = [], groups = [], srcStats = [];
  const projDir = opts.projDir;

  sources.forEach((src, srcIdx) => {
    const stat = { scriptPath: src.scriptPath, outDir: src.outDir, snapshot: null, matchedBy: null,
      sentences: 0, audio: 0, audioByNum: 0, images: 0, videos: 0, warnings: [] };
    srcStats.push(stat);
    if (!src.outDir) { stat.warnings.push('출력폴더가 지정되지 않았습니다(자산출처 줄에 " | 출력폴더" 가 필요합니다)'); log(`     ⚠ ${stat.warnings[0]}`); return; }
    const ttsDir = path.join(src.outDir, 'tts-1');
    const mediaDir = path.join(src.outDir, 'media-1');
    if (!fs.existsSync(src.outDir)) { stat.warnings.push(`출력폴더 없음: ${src.outDir}`); log(`     ⚠ ${stat.warnings[0]}`); return; }

    // 소스 대본 파싱 — 지문(스냅샷 탐색용) + 스냅샷이 없을 때의 폴백
    let parsedSrc = null;
    try { parsedSrc = parseSource ? parseSource(src.scriptPath) : null; }
    catch (e) { stat.warnings.push(`소스 대본 파싱 실패: ${(e && e.message) || e}`); }

    const probes = [];
    if (parsedSrc && parsedSrc.sentences && parsedSrc.sentences.length) {
      const N = parsedSrc.sentences.length;
      for (const r of [0.05, 0.2, 0.4, 0.6, 0.85]) {
        const t = normText(parsedSrc.sentences[Math.min(N - 1, Math.floor(N * r))].text);
        if (t && !probes.includes(t)) probes.push(t);
      }
    }
    const found = findSnapshot(src.scriptPath, probes, { projDir });
    if (found) { stat.snapshot = found.file; stat.matchedBy = found.matchedBy; }

    if (found) {
      // ── 정본 경로: 스냅샷이 문장 텍스트·길이·자산 basename 을 모두 갖고 있다 ──
      //   ⚠ 스냅샷에 경로가 **비어 있는 문장이 있다**(자동저장이 마지막 문장 합성 직전에 찍힌 경우 —
      //     실측: 「통합본 1 문」 6번째 문장. 파일 6.wav 는 디스크에 있는데 스냅샷만 비었다).
      //     그럴 때만 **번호 폴백**(tts-1/<순번>)을 쓴다. 단 번호가 실제로 순번과 일치하는 스냅샷에서만 —
      //     합성 뒤 재분할된 스냅샷이면 번호가 밀려 **엉뚱한 음성**이 붙기 때문이다.
      const snapGroups = _flattenSnapshot(found.snap);
      const numMapOk = _ordinalMatchesFilename(snapGroups);
      let ord = 0;
      for (const gs of snapGroups) {
        const image = rebase(gs.imagePath, mediaDir);
        const video = rebaseVideo(gs.videoPath, mediaDir);
        const gkey = normPrompt(gs.imagePrompt);
        if (gkey) { groups.push({ key: gkey, image, video, srcIdx }); if (image) stat.images++; if (video) stat.videos++; }
        for (const ss of gs.sentences || []) {
          ord++;
          const key = normText(ss.text);
          if (!key) continue;
          let file = rebase(ss.ttsAudioPath, ttsDir);
          if (!file && numMapOk) { file = _firstExisting(ttsDir, String(ord), AUD_EXT); if (file) stat.audioByNum++; }
          const dur = (typeof ss.ttsDurationSec === 'number' && ss.ttsDurationSec > 0) ? ss.ttsDurationSec : null;
          sents.push({ key, file, dur, srcIdx });
          stat.sentences++; if (file) stat.audio++;
        }
      }
      if (stat.audioByNum) stat.warnings.push(`스냅샷에 경로가 비어 음성 ${stat.audioByNum}개를 문장번호로 찾았습니다(길이는 실측).`);
    } else if (parsedSrc) {
      // ── 폴백: 스냅샷이 없다 → 파서 결정성(같은 .md → 같은 num)에 기대 tts-1/<num>.(mp3|wav) 로 찾는다.
      //    길이는 파일에 없으므로 복사 단계에서 ffprobe 로 채운다(dur=null 표시).
      stat.warnings.push('스냅샷 없음 — 문장 번호로 음성을 찾습니다(길이는 실측). 대본이 수정됐다면 어긋날 수 있습니다.');
      for (const s of parsedSrc.sentences) {
        const key = normText(s.text); if (!key) continue;
        const file = _firstExisting(ttsDir, String(s.num), AUD_EXT);
        sents.push({ key, file, dur: null, srcIdx });
        stat.sentences++; if (file) stat.audio++;
      }
      for (const g of parsedSrc.groups) {
        const gkey = normPrompt(g.imagePrompt); if (!gkey) continue;
        const stem = String(g.num).padStart(2, '0');
        const image = _firstExisting(mediaDir, stem, IMG_EXT);
        const video = _firstExisting(mediaDir, stem + '_1080', ['.mp4']) || _firstExisting(mediaDir, stem, ['.mp4']);
        groups.push({ key: gkey, image, video, srcIdx });
        if (image) stat.images++; if (video) stat.videos++;
      }
    } else {
      stat.warnings.push('스냅샷도 대본도 읽지 못해 이 소스는 건너뜁니다.');
    }
    log(`   · ${path.basename(src.scriptPath)} — 문장 ${stat.sentences}(음성 ${stat.audio}) · 이미지 ${stat.images} · 비디오 ${stat.videos}`
      + (stat.matchedBy === 'fingerprint' ? ` [스냅샷 지문매칭: ${path.basename(stat.snapshot)}]` : ''));
    for (const w of stat.warnings) log(`     ⚠ ${w}`);
  });

  return { sents, groups, srcStats, byText: _posIndex(sents), byPrompt: _posIndex(groups) };
}

/** key → 등장 위치(오름차순) 색인 */
function _posIndex(entries) {
  const m = new Map();
  entries.forEach((e, i) => { let a = m.get(e.key); if (!a) { a = []; m.set(e.key, a); } a.push(i); });
  return m;
}
/** positions(오름차순)에서 cursor 이상인 첫 위치 — 없으면 -1 (이진탐색) */
function _firstAtLeast(positions, cursor) {
  let lo = 0, hi = positions.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (positions[mid] < cursor) lo = mid + 1; else hi = mid; }
  return lo < positions.length ? positions[lo] : -1;
}

/**
 * 전방 커서 매칭 — 소스를 순서대로 이어붙인 평탄 배열 위에서 **앞으로만** 나아간다.
 *   통합대본은 소스 순서를 따르고 중간 섹션만 빠지므로 선형·비모호하다.
 *   같은 문장이 여러 번 나와도(각 부의 상투어) 커서 덕에 서로 다른 자산에 순서대로 붙는다.
 *   ⚠ 매칭 실패한 항목은 **커서를 움직이지 않는다** — 실패 하나가 뒤 전체를 밀어내지 않게.
 */
function forwardMatch(keys, entries, posIndex) {
  const out = new Array(keys.length).fill(null);
  let cursor = 0;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!k) continue;
    const pos = posIndex.get(k);
    if (!pos) continue;
    const at = _firstAtLeast(pos, cursor);
    if (at < 0) continue;
    out[i] = entries[at];
    cursor = at + 1;
  }
  return out;
}

function matchSentences(sentences, index) {
  return forwardMatch(sentences.map((s) => normText(s.text)), index.sents, index.byText);
}
function matchGroups(groups, index) {
  return forwardMatch(groups.map((g) => normPrompt(g.imagePrompt)), index.groups, index.byPrompt);
}

// ── 4. 복사 + 주입 ──────────────────────────────────────
/**
 * 매칭 결과를 작업폴더로 **복사**하고 모델에 경로·길이를 주입한다.
 *   🔴 원본을 그대로 가리키지 않는다(함정 ①).
 *   🔴 대상 파일이 이미 있어도 **무조건 덮어쓴다** — 이어받기 전에 새로 합성해 둔 음성이 있으면
 *      그것이 영원히 남는다(fillTtsList 는 파일이 있으면 건너뛴다).
 * @param {(fn:Function,what:string)=>Promise<any>} opts.retryFs G:(구글드라이브) 일시 언마운트 대비
 * @param {(f:string)=>Promise<number|null>} opts.probeDur 스냅샷에 길이가 없을 때만 호출(ffprobe)
 */
async function copyIntoWorkdirs(project, sentMatches, groupMatches, dirs, opts = {}) {
  const log = opts.log || (() => {});
  const retry = opts.retryFs || (async (fn) => fn());
  const probeDur = opts.probeDur || (async () => null);
  const abort = opts.abortSignal || (() => false);
  const onProgress = opts.onProgress || null;
  const r = { audio: 0, images: 0, videos: 0, probed: 0, copyFailed: [], noDuration: [], aborted: false };

  try { fs.mkdirSync(dirs.tts, { recursive: true }); fs.mkdirSync(dirs.media, { recursive: true }); } catch {}
  const samePath = (a, b) => { try { return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(); } catch { return false; } };

  // ── 문장(TTS) ──
  const sents = project.sentences;
  for (let i = 0; i < sents.length; i++) {
    if (abort()) { r.aborted = true; log('⏹ 자산 이어받기 중단'); break; }
    const m = sentMatches[i], s = sents[i];
    if (!m || !m.file) continue;
    const ext = path.extname(m.file).toLowerCase() || '.wav';
    const dest = path.join(dirs.tts, `${s.num}${ext}`);
    try {
      if (!samePath(m.file, dest)) await retry(() => fs.copyFileSync(m.file, dest), `문장${s.num} 음성 복사`);
    } catch (e) { r.copyFailed.push(s.num); continue; }
    // 확장자가 다른 옛 파일(이어받기 전에 새로 합성해 둔 것)이 남으면 폴더가 더러워진다 → 정리.
    for (const e2 of AUD_EXT) {
      if (e2 === ext) continue;
      const stale = path.join(dirs.tts, `${s.num}${e2}`);
      try { if (fs.existsSync(stale)) fs.unlinkSync(stale); } catch {}
    }
    let dur = m.dur;
    if (!(dur > 0)) { dur = await probeDur(dest); r.probed++; }        // 함정 ② — 길이 없이 넘기면 안 된다
    if (!(dur > 0)) { r.noDuration.push(s.num); continue; }            // 길이를 못 구하면 연결하지 않는다(재합성 유도)
    s.ttsAudioPath = dest; s.ttsDurationSec = dur; s.ttsStatus = 'done';
    r.audio++;
    if (onProgress && (r.audio % 200 === 0)) { try { onProgress(r.audio, sents.length); } catch {} }
  }

  // ── 그룹(이미지·비디오) ──
  const groups = project.groups;
  for (let i = 0; i < groups.length; i++) {
    if (abort()) { r.aborted = true; break; }
    const m = groupMatches[i], g = groups[i];
    if (!m) continue;
    const stem = String(g.num).padStart(2, '0');
    if (m.image) {
      const ext = path.extname(m.image).toLowerCase() || '.png';
      const dest = path.join(dirs.media, `${stem}${ext}`);
      try {
        if (!samePath(m.image, dest)) await retry(() => fs.copyFileSync(m.image, dest), `G${g.num} 이미지 복사`);
        g.imagePath = dest; g.imageStatus = 'done'; g.imageCleared = false; r.images++;
      } catch (e) { log(`   ⚠ G${g.num} 이미지 복사 실패: ${(e && e.message) || e}`); }
    }
    if (m.video) {
      const dest = path.join(dirs.media, `${stem}.mp4`);
      try {
        if (!samePath(m.video, dest)) await retry(() => fs.copyFileSync(m.video, dest), `G${g.num} 비디오 복사`);
        g.videoPath = dest; g.videoStatus = 'done'; r.videos++;
      } catch (e) { log(`   ⚠ G${g.num} 비디오 복사 실패: ${(e && e.message) || e}`); }
    }
  }
  return r;
}

// ── 5. 리포트 ───────────────────────────────────────────
function buildReport(project, sentMatches, groupMatches, index, extra = {}) {
  const sents = project.sentences, groups = project.groups;
  const sTotal = sents.length;
  const sMatched = sentMatches.filter((m) => m && m.file).length;
  const withPrompt = groups.filter((g) => normPrompt(g.imagePrompt)).length;
  let gImg = 0, gVid = 0;
  const missingGroups = [];
  for (let i = 0; i < groups.length; i++) {
    const m = groupMatches[i];
    if (m && m.image) gImg++;
    if (m && m.video) gVid++;
    if (!normPrompt(groups[i].imagePrompt)) continue;
    if (m && m.image) continue;
    missingGroups.push({ num: groups[i].num, prompt: String(groups[i].imagePrompt || '').slice(0, 40) });
  }
  const missingSentences = [];
  for (let i = 0; i < sents.length; i++) {
    if (sentMatches[i] && sentMatches[i].file) continue;
    missingSentences.push({ num: sents[i].num, text: String(sents[i].text || '').slice(0, 30) });
  }
  return {
    sentences: { matched: sMatched, total: sTotal, rate: sTotal ? sMatched / sTotal : 1 },
    groups: { imageMatched: gImg, withPrompt, total: groups.length, videoMatched: gVid },
    missingSentences, missingGroups,
    sources: index.srcStats,
    ...extra,
  };
}

/** 리포트 → 사람이 읽는 여러 줄 문자열 */
function formatReport(rep) {
  const L = [];
  L.push(`문장(TTS) ${rep.sentences.matched}/${rep.sentences.total} (${(rep.sentences.rate * 100).toFixed(1)}%)`);
  L.push(`그룹 이미지 ${rep.groups.imageMatched}/${rep.groups.withPrompt} · 비디오 ${rep.groups.videoMatched}`);
  if (rep.missingSentences.length) {
    const head = rep.missingSentences.slice(0, 8).map((m) => `${m.num}) ${m.text}…`);
    L.push(`새로 합성될 문장 ${rep.missingSentences.length}개 — ${head.join(' / ')}${rep.missingSentences.length > 8 ? ' …' : ''}`);
  }
  if (rep.missingGroups.length) {
    L.push(`새로 생성될 이미지 ${rep.missingGroups.length}개 — 그룹 ${rep.missingGroups.slice(0, 15).map((m) => 'G' + m.num).join(', ')}${rep.missingGroups.length > 15 ? ' …' : ''}`);
  }
  return L.join('\n');
}

module.exports = {
  parseAssetSources, hasAssetSources, fileHasAssetSources,
  normText, normPrompt,
  snapshotsDir, findSnapshot,
  rebase, rebaseVideo,
  buildSourceIndex, forwardMatch, matchSentences, matchGroups,
  copyIntoWorkdirs, buildReport, formatReport,
};
