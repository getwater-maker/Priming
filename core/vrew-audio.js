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
const { normText, forwardMatch } = require('./merge-assets');

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

  const clips = clipsRaw.map((c, index) => {
    // 🔑 words[] 쪽 assetIds 가 본류다. clip.assetIds 도 함께 훑되(구조가 바뀔 수 있으니) 음성만 고른다.
    const aids = [...((c.assetIds) || []), ...(((c.words) || []).flatMap((w) => (w && w.assetIds) || []))];
    const hits = new Map();   // mediaName → { count, maxOut }
    for (const aid of aids) {
      const a = assets[aid];
      if (!a) continue;
      for (const tid of ((a.trackIds) || [])) {
        const t = tracks[tid];
        if (!t) continue;
        const f = byMedia.get(t.mediaId);
        if (!f || !f.name) continue;
        const isAudio = AUDIO_TRACK_TYPES.has(t.type) || (f.type === 'AVMedia' && AUDIO_EXT.test(f.name));
        if (!isAudio) continue;
        const cur = hits.get(f.name) || { count: 0, maxOut: 0 };
        cur.count++;
        if (typeof t.sourceOut === 'number' && t.sourceOut > cur.maxOut) cur.maxOut = t.sourceOut;
        hits.set(f.name, cur);
      }
    }
    // 같은 clip 에 여러 파일이 걸리면(BGM 등이 섞이면) **가장 많이 참조된 것**을 그 문장 음성으로 본다.
    let mediaName = null, trackDurSec = null;
    if (hits.size) {
      const best = [...hits.entries()].sort((x, y) => y[1].count - x[1].count)[0];
      mediaName = best[0];
      trackDurSec = best[1].maxOut > 0 ? best[1].maxOut : null;
      if (hits.size > 1) warn.push(`clip ${index + 1}: 음성 후보가 ${hits.size}개 — 가장 많이 쓰인 것을 골랐습니다(${mediaName})`);
    }
    return { index, caption: clipCaption(c), mediaName, trackDurSec };
  });

  return { clips, zip, warn };
}

/**
 * clip 의 음성을 outDir 로 꺼낸다. 이름은 호출자가 정한다(문장 번호로 저장하기 위해).
 * @returns {string|null} 저장된 경로 (음성이 없으면 null)
 */
function extractClipAudio(zip, clip, outPath) {
  if (!clip || !clip.mediaName) return null;
  const e = zip.getEntry('media/' + clip.mediaName);
  if (!e) return null;
  const buf = e.getData();
  if (!buf || !buf.length) return null;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return outPath;
}

/**
 * 대본 문장 ↔ .vrew clip 을 **자막 텍스트로** 잇는다.
 *   🔑 merge-assets 의 전방 커서(forwardMatch)를 그대로 쓴다 — 같은 문장이 여러 번 나와도
 *     순서대로 서로 다른 clip 에 붙고, 실패한 항목은 커서를 움직이지 않는다.
 *   ⚠ 정규화는 **공백 접기 + trim 까지만**(normText). 더 관대하게 하면 서로 다른 문장이 같은 키가
 *     되어 **엉뚱한 음성이 붙는다** — 조용히 틀리는 쪽이 새로 만드는 것보다 나쁘다(v0.3.31 정책).
 * @returns {Array<clip|null>} sentences 와 같은 길이
 */
function matchClipsToSentences(sentences, clips) {
  const entries = clips.map((c) => ({ ...c, key: c.caption }));
  const posIndex = new Map();
  entries.forEach((e, i) => { let a = posIndex.get(e.key); if (!a) { a = []; posIndex.set(e.key, a); } a.push(i); });
  return forwardMatch((sentences || []).map((s) => normText(s.text)), entries, posIndex);
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

  // 🔴 **주입 전에 매칭률 게이트** — 낮으면 아무것도 건드리지 않고 멈춘다.
  //   Vrew 에서 클립을 나누거나 자막을 고쳤으면 문장과 어긋나는데, 그 상태로 주입하면
  //   **엉뚱한 문장에 남의 음성이 붙은 영상**이 나온다(v0.3.31 이 95% 게이트를 둔 그 이유).
  //   ⚠ 주입 뒤에 검사하면 되돌릴 수 없다 — 그래서 여기서 먼저 센다.
  const minRate = (opts.minRate != null) ? Number(opts.minRate) : 0.95;
  const preMissing = matches.map((m, i) => (m ? null : sentences[i].num)).filter((x) => x != null);
  const preRate = sentences.length ? (sentences.length - preMissing.length) / sentences.length : 0;
  if (preRate < minRate) {
    const head = preMissing.slice(0, 10).join(', ');
    throw new Error(
      `자막이 대본과 맞지 않습니다 — 문장 ${sentences.length}개 중 ${preMissing.length}개를 .vrew 에서 찾지 못했습니다`
      + ` (일치율 ${(preRate * 100).toFixed(1)}%, 기준 ${(minRate * 100).toFixed(0)}%).\n`
      + `못 찾은 문장: ${head}${preMissing.length > 10 ? ' …' : ''}\n\n`
      + '이 상태로 가져오면 엉뚱한 문장에 남의 음성이 붙습니다. 아무것도 바꾸지 않았습니다.\n'
      + 'Vrew 에서 클립을 나누거나 자막을 고쳤다면, 그 .vrew 대신 Priming 이 만든 원본으로 다시 시작하세요.'
    );
  }

  const missing = [];
  const noAudio = [];
  let injected = 0;

  fs.mkdirSync(ttsDir, { recursive: true });
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const m = matches[i];
    if (!m) { missing.push(s.num); continue; }
    if (!m.mediaName) { noAudio.push(s.num); continue; }
    const ext = (path.extname(m.mediaName) || '.mp3').toLowerCase();
    const out = path.join(ttsDir, `${s.num}${ext}`);
    const saved = extractClipAudio(zip, m, out);
    if (!saved) { noAudio.push(s.num); continue; }
    // 길이는 **실측 우선** — 트랙의 sourceOut 은 어절 구간이라 파일 전체 길이와 다를 수 있다.
    let dur = await probeDur(saved);
    if (!(dur > 0)) dur = (m.trackDurSec > 0) ? m.trackDurSec : null;
    if (!(dur > 0)) {
      // 길이를 모르면 연결하지 않는다 — 빌더가 파일 크기로 4배 과대 추정해 타임라인이 통째로 왜곡된다(v0.3.31 함정 ②).
      try { fs.rmSync(saved, { force: true }); } catch (_) {}
      noAudio.push(s.num);
      continue;
    }
    s.ttsAudioPath = saved;
    s.ttsDurationSec = dur;
    // 확장자가 다른 옛 음성이 남아 있으면 치운다(2.mp3 옆의 2.wav → 나중에 어느 것이 쓰였는지 알 수 없다).
    for (const other of ['.mp3', '.wav']) {
      if (other === ext) continue;
      const p = path.join(ttsDir, `${s.num}${other}`);
      if (fs.existsSync(p)) { try { fs.rmSync(p, { force: true }); } catch (_) {} }
    }
    injected++;
  }

  const matched = sentences.length - missing.length;
  const rate = sentences.length ? matched / sentences.length : 0;
  return { total: sentences.length, matched, injected, missing, noAudio, rate, warn };
}

module.exports = {
  readVrewClips,
  extractClipAudio,
  matchClipsToSentences,
  importVrewAudio,
  clipCaption,
  AUDIO_TRACK_TYPES,
};
