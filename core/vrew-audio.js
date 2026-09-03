'use strict';
/**
 * vrew-audio — **완성된 .vrew 에서 문장별 음성을 꺼내 온다**(읽기 전용).
 *
 * 왜 필요한가: 로이가 TTS 를 Vrew 의 AI 목소리로 만들고 싶어 한다(2026-09-03).
 *   그러면 순서가 이렇게 된다 — ① Priming 이 「🖼 화면만」 .vrew 를 만든다(음성 자리는 무음)
 *   ② Vrew 에서 음성을 입혀 저장 ③ **여기서 그 음성만 가져온다** ④ 이후는 기존 파이프라인 그대로.
 *
 * 🔑 **.vrew 를 고쳐 쓰지 않는다 — 읽기만 한다.**
 *   이미지·자막·AI고지·BGM·켄번스·레터박스를 .vrew 에 직접 배선하려면 files↔tracks↔assets↔clips
 *   네 곳 + zIndex 재발번호 + 40bit id 충돌 검사를 손으로 재구현해야 하는데, 그 코드가 이미
 *   vrew-builder 에 있다. 두 벌이 되면 반드시 어긋난다(v0.3.76 드롭다운 2곳 · v0.3.50 정규화 3곳 ·
 *   v0.3.80 저장 3곳). v0.3.31 통합본에서도 같은 이유로 .vrew 수술을 기각하고 **자산만 물려받아
 *   기존 빌더에 넘기는** 방식을 택했다 — 이 모듈은 그 패턴을 그대로 따른다.
 *
 * 🔑 .vrew 안에서 음성을 찾는 경로(실측 2026-09-03):
 *     clip.words[].assetIds → props.assets[aid].trackIds → props.tracks[tid].mediaId
 *       → files[].name → zip 의 `media/<name>`
 *   ⚠ **`clip.assetIds` 만 보면 못 찾는다** — 거기 걸리는 건 AI고지 같은 web 트랙이고,
 *     음성은 **`words[]` 쪽**에 붙는다(처음에 clip.assetIds 만 봐서 0/6 을 얻었다).
 *   한 문장 = 한 clip = 한 mp3 이고, 어절마다 그 파일의 구간(sourceIn~sourceOut)을 참조한다.
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { normText } = require('./merge-assets');
const { concatAudio } = require('./media-utils');

/** 음성으로 볼 트랙 타입 — 우리 빌더는 ttsClip 을 쓰고, Vrew 가 만든 것도 audio 계열일 수 있다. */
const AUDIO_TRACK_TYPES = new Set(['ttsClip', 'audio', 'videoAudio', 'bgm']);
/** 음성으로 볼 파일 확장자 */
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg)$/i;

/** clip.captions[] → 사람이 읽는 한 줄(자막 줄들을 이어붙인 문장). */
function clipCaption(clip) {
  const caps = (clip && clip.captions) || [];
  let out = '';
  for (const c of caps) {
    const t = c && c.text;
    if (Array.isArray(t)) out += t.map((x) => (x && x.insert) || '').join('');
    else if (typeof t === 'string') out += t;
  }
  return normText(out.replace(/\n/g, ' '));
}

/**
 * clip.words[] → 그 clip 이 **실제로 말하는** 텍스트.
 * 🔴 **captions 보다 이걸 믿는다.** 실측(2026-09-03): Vrew 가 저장한 파일의 clip[0] 은
 *   captions 가 **남의 대본 문장**("지난 추석, 한 선생님 댁에 오랜만에")이었는데 words 는 정확했다
 *   ("이른 새벽, 한 관리가 옥의 마당에 꿇려 있었습니다"). words 는 어절마다 오디오 구간을
 *   참조하므로 **음성과 한 몸**이고, captions 는 표시용이라 편집·재사용으로 어긋날 수 있다.
 */
function clipWords(clip) {
  const ws = (clip && clip.words) || [];
  return normText(ws.map((w) => (w && w.text) || '').join(' '));
}

/** 그 clip 의 텍스트 — words 우선, 없으면 captions 폴백. */
function clipText(clip) {
  return clipWords(clip) || clipCaption(clip);
}

/**
 * 매칭용 정규화 — 공백 접기 + **문장부호 제거**.
 * 🔴 Vrew 자막에는 **문장 끝 마침표가 없다**(실측: 대본 "…있었습니다." ↔ Vrew "…있었습니다").
 *   쉼표도 빠지는 경우가 있어 문장부호를 통째로 무시한다.
 *   ⚠ **내용 글자는 건드리지 않는다** — 더 관대하게(예: 조사·공백까지 무시) 하면 서로 다른 문장이
 *     같은 키가 되어 **엉뚱한 음성이 붙는다**. 문장부호만 빼는 선이 안전선이다.
 */
function normLoose(t) {
  return normText(String(t == null ? '' : t)
    .replace(/[.,!?;:…·"'“”‘’()\[\]{}~\-—–]/g, ' '))
    .toLowerCase();
}

/**
 * .vrew 를 열어 **clip 별 { 자막, 음성 파일명, 길이 }** 를 뽑는다.
 * @param {string} vrewPath
 * @returns {{ clips: Array<{index:number, caption:string, mediaName:string|null, trackDurSec:number|null}>,
 *             zip: AdmZip, warn: string[] }}
 */
function readVrewClips(vrewPath) {
  if (!vrewPath || !fs.existsSync(vrewPath)) throw new Error('.vrew 파일이 없습니다: ' + vrewPath);
  const zip = new AdmZip(vrewPath);
  const raw = zip.readAsText('project.json');
  if (!raw) throw new Error('.vrew 안에 project.json 이 없습니다 — Vrew 프로젝트 파일이 아닙니다.');
  let pj;
  try { pj = JSON.parse(raw); } catch (e) { throw new Error('project.json 을 읽을 수 없습니다: ' + e.message); }

  const clipsRaw = ((pj.transcript || {}).clips) || [];
  const tracks = ((pj.props || {}).tracks) || {};
  const assets = ((pj.props || {}).assets) || {};
  const byMedia = new Map(((pj.files) || []).map((f) => [f.mediaId, f]));
  const warn = [];

  // 🔴 **zip 엔트리 이름 ≠ files[].name** (실측 2026-09-03, Vrew 저장본):
  //     zip:  media/IZALvjsPaT.mpga        ← <mediaId>.<확장자>
  //     name: "이른 새벽, 한 관리가 옥의 마당에 .mp3"  ← 사람이 읽는 이름(자막에서 지어진다)
  //   우리 빌더는 name 을 `<mediaId>.<ext>` 로 만들어서 **우연히 일치**했고, 그 때문에 우리 파일로는
  //   되는데 Vrew 저장본에서는 **음성을 하나도 못 꺼냈다**(매칭 5/5 인데 주입 0개).
  //   ⇒ **mediaId(확장자 제외 stem)로 찾는다.** name 으로도 찾을 수 있게 둘 다 색인한다.
  const entryOf = new Map();
  for (const e of zip.getEntries()) {
    const n = e.entryName;
    if (n.indexOf('media/') !== 0) continue;
    const base = n.slice('media/'.length);
    entryOf.set(base, n);                              // 이름 전체(우리 빌더 산출물)
    entryOf.set(base.replace(/\.[^.]*$/, ''), n);       // 확장자 뗀 stem = mediaId
  }

  const clips = clipsRaw.map((c, index) => {
    // 🔑 words[] 쪽 assetIds 가 본류다. clip.assetIds 도 함께 훑되(구조가 바뀔 수 있으니) 음성만 고른다.
    const aids = [...((c.assetIds) || []), ...(((c.words) || []).flatMap((w) => (w && w.assetIds) || []))];
    const hits = new Map();   // mediaId → { count, maxOut, file }
    for (const aid of aids) {
      const a = assets[aid];
      if (!a) continue;
      for (const tid of ((a.trackIds) || [])) {
        const t = tracks[tid];
        if (!t) continue;
        const f = byMedia.get(t.mediaId);
        if (!f) continue;
        // 🔑 Vrew 는 TTS 음성에 `sourceFileType: 'TTS'` 를 박아 준다 — 가장 확실한 신호다.
        //   (같은 파일 목록에 1초짜리 더미 `VIDEO_AUDIO` 리소스가 섞여 있다.)
        const isAudio = f.sourceFileType === 'TTS'
          || AUDIO_TRACK_TYPES.has(t.type)
          || (f.type === 'AVMedia' && AUDIO_EXT.test(f.name || ''));
        if (!isAudio) continue;
        const cur = hits.get(t.mediaId) || { count: 0, maxOut: 0, file: f };
        cur.count++;
        if (typeof t.sourceOut === 'number' && t.sourceOut > cur.maxOut) cur.maxOut = t.sourceOut;
        hits.set(t.mediaId, cur);
      }
    }
    // 같은 clip 에 여러 파일이 걸리면(BGM 등이 섞이면) **가장 많이 참조된 것**을 그 문장 음성으로 본다.
    let mediaId = null, mediaName = null, entryName = null, trackDurSec = null, metaDurSec = null;
    if (hits.size) {
      const best = [...hits.entries()].sort((x, y) => y[1].count - x[1].count)[0];
      mediaId = best[0];
      const f = best[1].file;
      mediaName = f.name || null;
      // zip 엔트리는 mediaId 로 찾는다(이름은 사람이 읽는 것일 수 있다 — 위 주석 참조).
      entryName = entryOf.get(mediaId) || (mediaName ? entryOf.get(mediaName) : null) || null;
      trackDurSec = best[1].maxOut > 0 ? best[1].maxOut : null;
      // Vrew 가 파일 메타에 정확한 길이를 넣어 준다 — ffprobe 를 못 쓸 때의 좋은 폴백.
      const md = ((f.videoAudioMetaInfo) || {}).duration;
      metaDurSec = (typeof md === 'number' && md > 0) ? md : null;
      if (!entryName) warn.push(`clip ${index + 1}: 음성 파일을 zip 에서 못 찾았습니다 (mediaId ${mediaId})`);
      if (hits.size > 1) warn.push(`clip ${index + 1}: 음성 후보가 ${hits.size}개 — 가장 많이 쓰인 것을 골랐습니다`);
    }
    return { index, caption: clipCaption(c), text: clipText(c), mediaId, mediaName, entryName, trackDurSec, metaDurSec };
  });

  return { clips, zip, warn };
}

/** 한 문장이 자막 줄 몇 개까지 쪼개질 수 있나 — 20자 자막 × 10 = 200자면 어떤 문장도 덮는다. */
const MAX_MERGE = 10;

/**
 * 대본 문장 ↔ Vrew clip 을 잇는다. **한 문장이 clip 여러 개일 수 있다.**
 *
 * 🔴 왜 1:1 이 아닌가(실측 2026-09-03): Vrew 는 **자막 줄마다 clip 을 나눈다**. 우리 자막은
 *   20자 안팎으로 쪼개져 있으므로 긴 문장 하나가 clip 2~3개가 된다.
 *     대본 #4 "그의 죄는 임금의 사위를 잡아 문초한 것이었습니다."
 *       → clip4 "그의 죄는 임금의 사위를" + clip5 "잡아 문초한 것이었습니다"
 *   그래서 clip 을 **순서대로 이어붙이며** 문장과 맞는 지점을 찾고, 여러 개면 음성도 이어붙인다.
 *
 * 🔑 **clip 을 소비하는 방향으로 훑는다** — 문장 쪽은 건너뛸 수 있다(로이처럼 앞 몇 그룹만
 *   음성을 만든 경우 나머지 문장은 .vrew 에 아예 없다). 대신 clip 은 하나도 버리지 않는 것이 목표다.
 *
 * @returns {Array<Array<clip>|null>} sentences 와 같은 길이. 각 항목은 그 문장을 이루는 clip 배열.
 */
function matchClipsToSentences(sentences, clips) {
  const out = new Array((sentences || []).length).fill(null);
  let ci = 0, si = 0;
  while (ci < clips.length && si < sentences.length) {
    const target = normLoose(sentences[si].text);
    let buf = '';
    let take = -1;
    for (let j = 0; j < MAX_MERGE && ci + j < clips.length; j++) {
      const piece = normLoose(clips[ci + j].text);
      buf = buf ? (buf + ' ' + piece) : piece;
      if (buf === target) { take = j; break; }
      if (!target.startsWith(buf)) break;   // 더 붙여도 이 문장은 안 된다
    }
    if (take >= 0) {
      out[si] = clips.slice(ci, ci + take + 1);
      ci += take + 1;
      si++;
    } else {
      si++;   // 이 문장은 .vrew 에 없다(일부만 만든 경우) — clip 커서는 그대로 둔다
    }
  }
  return out;
}

/**
 * clip 의 음성을 outDir 로 꺼낸다. 이름은 호출자가 정한다(문장 번호로 저장하기 위해).
 * @returns {string|null} 저장된 경로 (음성이 없으면 null)
 */
function extractClipAudio(zip, clip, outPath) {
  if (!clip) return null;
  // 🔑 zip 엔트리는 readVrewClips 가 mediaId 로 미리 찾아 둔다(이름으로 찾으면 Vrew 저장본에서 실패).
  const name = clip.entryName || (clip.mediaName ? 'media/' + clip.mediaName : null);
  if (!name) return null;
  const e = zip.getEntry(name);
  if (!e) return null;
  const buf = e.getData();
  if (!buf || !buf.length) return null;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return outPath;
}

/**
 * .vrew 의 음성을 대본에 물려준다 — **작업폴더로 복사하고 모델에 경로·길이를 주입**한다.
 *   ⚠ 원본 .vrew 를 가리키지 않는다. 이후 단계(sweepBadVisuals 등)가 작업폴더 파일을 지울 수 있고,
 *     .vrew 를 옮기면 참조가 끊긴다(v0.3.31 함정 ①과 같은 이유).
 *   ⚠ **이미 음성이 있어도 덮어쓴다** — 「Vrew 음성으로 바꾼다」는 명시적 행위이고,
 *     남겨 두면 fillTts 가 그것을 건너뛰어 옛 음성이 영원히 남는다.
 *
 * @param {object} project           파싱된 편(sentences 를 가진다)
 * @param {string} vrewPath          Vrew 가 저장한 .vrew
 * @param {string} ttsDir            그 편의 tts-N 폴더
 * @param {{ log?:Function, probeDur?:(f:string)=>Promise<number|null>, minRate?:number }} [opts]
 * @returns {Promise<{ total:number, matched:number, injected:number, missing:number[],
 *                     noAudio:number[], rate:number, warn:string[] }>}
 */
async function importVrewAudio(project, vrewPath, ttsDir, opts = {}) {
  const log = opts.log || (() => {});
  const probeDur = opts.probeDur || (async () => null);
  const sentences = (project && project.sentences) || [];
  if (!sentences.length) throw new Error('대본에 문장이 없습니다.');

  const { clips, zip, warn } = readVrewClips(vrewPath);
  const withAudio = clips.filter((c) => c.mediaName).length;
  log(`📥 ${path.basename(vrewPath)} — clip ${clips.length}개 · 음성 있는 clip ${withAudio}개`);
  if (!withAudio) {
    throw new Error(
      'Vrew 파일 안에 음성이 없습니다. Vrew 에서 AI 목소리를 만든 뒤 **저장**했는지 확인하세요.\n'
      + '(음성을 만들었는데도 이 메시지가 나오면 .vrew 안에 음성이 다른 방식으로 담긴 것이므로 알려 주세요.)'
    );
  }

  const matches = matchClipsToSentences(sentences, clips);
  const usedClips = matches.reduce((a, m) => a + (m ? m.length : 0), 0);

  // 🔴 **주입 전에 게이트** — 낮으면 아무것도 건드리지 않고 멈춘다.
  //   ⚠ 주입 뒤에 검사하면 되돌릴 수 없다 — 그래서 여기서 먼저 센다.
  //
  // 🔑 **기준은 「문장」이 아니라 「clip」이다**(2026-09-03 정정). 로이가 앞 3그룹만 음성을 만들어
  //   가져왔을 때, 문장 기준으로는 247개 중 4개만 맞아 1.6% → 게이트가 **정상 작업을 막았다**.
  //   그건 어긋난 게 아니라 **일부만 만든 것**이다. 반대로 자막이 진짜 어긋나면 clip 이 하나도
  //   매칭되지 않는다. 그래서 「.vrew 의 clip 중 몇 %를 썼나」가 옳은 잣대다:
  //     · 일부만 만들었다  → clip 5/5 사용 = 100% → 통과(문장 4개만 채워지고 나머지는 그대로)
  //     · 자막이 어긋났다  → clip 0/5 사용 = 0%   → 막는다
  const minRate = (opts.minRate != null) ? Number(opts.minRate) : 0.8;
  const clipRate = clips.length ? usedClips / clips.length : 0;
  if (clipRate < minRate) {
    const sample = clips.slice(0, 3).map((c, i) => `  clip${i + 1}: "${String(c.text).slice(0, 40)}"`).join('\n');
    throw new Error(
      `자막이 대본과 맞지 않습니다 — .vrew 의 clip ${clips.length}개 중 ${usedClips}개만 대본 문장에 이어붙일 수 있었습니다`
      + ` (${(clipRate * 100).toFixed(1)}%, 기준 ${(minRate * 100).toFixed(0)}%).\n\n`
      + `.vrew 안의 자막(앞 3개):\n${sample}\n\n`
      + '이 상태로 가져오면 엉뚱한 문장에 남의 음성이 붙습니다. 아무것도 바꾸지 않았습니다.\n'
      + '이 .vrew 가 **이 대본으로 만든 것인지** 확인하세요. Vrew 에서 자막 글자를 고쳤다면 그 부분은 맞출 수 없습니다.'
    );
  }

  const missing = [];
  const noAudio = [];
  const mergedNums = [];   // clip 여러 개를 이어붙인 문장
  let injected = 0;

  fs.mkdirSync(ttsDir, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pf-vrewaud-'));
  try {
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      const m = matches[i];
      if (!m || !m.length) { missing.push(s.num); continue; }
      const parts = m.filter((c) => c.entryName || c.mediaName);
      if (!parts.length) { noAudio.push(s.num); continue; }

      // 이 문장을 이루는 clip 들의 음성을 임시로 꺼낸다.
      const chunkFiles = [];
      for (const [k, c] of parts.entries()) {
        const ext0 = (path.extname(c.entryName || c.mediaName || '') || '.mp3').toLowerCase();
        const p = path.join(tmpDir, `${s.num}_${k}${ext0}`);
        if (extractClipAudio(zip, c, p)) chunkFiles.push(p);
      }
      if (!chunkFiles.length) { noAudio.push(s.num); continue; }

      // 🔑 한 문장이 clip 여러 개면 **음성을 이어붙인다**(Vrew 는 자막 줄마다 clip 을 나눈다).
      const out = path.join(ttsDir, `${s.num}.mp3`);
      try {
        if (chunkFiles.length === 1) fs.copyFileSync(chunkFiles[0], out);
        else { await concatAudio(chunkFiles, out); mergedNums.push(s.num); }
      } catch (e) {
        log(`  ⚠ 컷 ${s.num} 음성 이어붙이기 실패: ${e.message}`);
        noAudio.push(s.num);
        continue;
      }

      // 길이는 **실측 우선** — 트랙의 sourceOut 은 어절 구간이라 파일 전체 길이와 다르다.
      let dur = await probeDur(out);
      // 폴백 순서: 파일 메타(Vrew 가 정확히 적어 준다) → 트랙 구간 합
      if (!(dur > 0)) dur = parts.reduce((a, c) => a + (c.metaDurSec > 0 ? c.metaDurSec : 0), 0) || null;
      if (!(dur > 0)) dur = parts.reduce((a, c) => a + (c.trackDurSec > 0 ? c.trackDurSec : 0), 0) || null;
      if (!(dur > 0)) {
        // 길이를 모르면 연결하지 않는다 — 빌더가 파일 크기로 4배 과대 추정해 타임라인이 통째로 왜곡된다.
        try { fs.rmSync(out, { force: true }); } catch (_) {}
        noAudio.push(s.num);
        continue;
      }
      s.ttsAudioPath = out;
      s.ttsDurationSec = dur;
      // 확장자가 다른 옛 음성이 남아 있으면 치운다(2.mp3 옆의 2.wav → 어느 것이 쓰였는지 알 수 없다).
      const stale = path.join(ttsDir, `${s.num}.wav`);
      if (fs.existsSync(stale)) { try { fs.rmSync(stale, { force: true }); } catch (_) {} }
      injected++;
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }

  const matched = sentences.length - missing.length;
  const rate = sentences.length ? matched / sentences.length : 0;
  return {
    total: sentences.length, matched, injected, missing, noAudio, rate, warn,
    clipTotal: clips.length, clipUsed: usedClips, clipRate, merged: mergedNums,
  };
}

module.exports = {
  readVrewClips,
  extractClipAudio,
  matchClipsToSentences,
  importVrewAudio,
  clipCaption,
  clipWords,
  clipText,
  normLoose,
  AUDIO_TRACK_TYPES,
};
