'use strict';
/**
 * yt-finish.js — 🧷 업로드 마무리: 썸네일 A · 재생목록을 API 로 넣고, 다시 읽어 확인표를 낸다 (v0.9.33)
 *   로이 2026-10-16 「예약 마무리를 맡기면 느리고, 썸네일·재생목록·고정댓글을 빼먹고, 채널마다 계정이 달라 엉뚱한 브라우저로 간다」.
 *   → API 로 되는 것은 앱이 채널별 업로드 토큰으로 처리한다(브라우저·계정 혼동 없음).
 *
 *   앱이 하는 것: ① 썸네일 A(`<썸네일 폴더>\<채널>\[약칭_MMDD] 썸네일_A.png`) → thumbnails.set
 *                ② 재생목록에 담기 → playlistItems.insert (이미 들어 있으면 그대로) → 다시 읽어 들어갔는지 확인
 *   API 가 없어 Studio 몫으로 남는 것(확인표에 「✋ Studio」로 적는다): 고정댓글(고정 API 없음) · 썸네일 B·C A/B 테스트 ·
 *                종료화면 · 예약(미심사 프로젝트라 비공개 강제).
 *
 *   재생목록을 정하는 순서(먼저 찾은 것): 패키징 「## 재생목록」(이름·주소·ID) → 고정댓글의 `list=` 링크 → 설명글의 `list=` 링크
 *                → 채널 설정 `ytPlaylist`(이름). 이름은 그 채널의 재생목록 제목과 **똑같아야** 한다(비슷한 이름 자동 매칭 금지).
 *   🔑 같은 영상에 같은 썸네일 파일(경로·크기·수정시각)을 두 번 보내지 않는다 — youtube-finish.json(할당량 50단위 아끼기).
 *   ⛔ 결과 줄에 ✗·❌ 를 쓰지 않는다(빠진 것은 ⚠ — 오류 자동 전송이 콘텐츠 빈칸을 앱 오류로 잡지 않게).
 * 테스트: test/yt-finish.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const EP = {
  api: 'https://www.googleapis.com/youtube/v3',
  thumb: 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set',
};
function _setEndpoints(p) { Object.assign(EP, p || {}); }

const THUMB_MAX = 2 * 1024 * 1024;   // 유튜브 맞춤 썸네일 한도 2MB
const LIST_RE = /[?&]list=([A-Za-z0-9_-]{10,})/;
const PL_ID_RE = /^(PL|UU|FL|OL)[A-Za-z0-9_-]{10,}$/;

function storeFile() { return path.join(os.homedir(), '.priming-maker', 'youtube-finish.json'); }
function _store() { try { return JSON.parse(fs.readFileSync(storeFile(), 'utf8')) || {}; } catch (_) { return {}; } }
function _storeSet(videoId, patch) {
  const all = _store();
  all[videoId] = { ...(all[videoId] || {}), ...patch };
  try { fs.mkdirSync(path.dirname(storeFile()), { recursive: true }); fs.writeFileSync(storeFile(), JSON.stringify(all, null, 2), 'utf8'); } catch (_) {}
}
function _fileSig(p) { try { const st = fs.statSync(p); return `${p}|${st.size}|${Math.round(st.mtimeMs)}`; } catch (_) { return ''; } }

/** 재생목록 지정 문자열 → {id} | {name} | null (주소·ID 는 id, 그 밖은 이름) */
function parsePlaylistRef(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  const m = LIST_RE.exec(t);
  if (m) return { id: m[1] };
  if (PL_ID_RE.test(t)) return { id: t };
  return { name: t };
}

/**
 * 마무리 계획 — 무엇을 어디서 가져오나(파일만 읽는다 · 네트워크 없음).
 * @param {{pack?:object, packagingPath?:string|null, preset?:object, thumbs?:{name:string,path:string}[]}} a
 *   pack = yt-packaging.parsePackaging 결과 · thumbs = thumb-find.findThumbs 결과
 */
function planFinish(a = {}) {
  const pk = a.pack || {};
  const thumbs = a.thumbs || [];
  const pick = (L) => thumbs.find((t) => new RegExp(`썸네일_${L}\\.(png|jpe?g|webp)$`, 'i').test(t.name));
  const thumbA = pick('A') || null;
  const others = ['B', 'C'].map(pick).filter(Boolean);
  let playlist = null;
  const tries = [
    [pk.playlist, '패키징 「## 재생목록」'],
    [(LIST_RE.exec(pk.pinned || '') || [])[0], '고정댓글 링크'],
    [(LIST_RE.exec(pk.description || '') || [])[0], '설명글 링크'],
    [a.preset && a.preset.ytPlaylist, '채널 설정 「재생목록」'],
  ];
  for (const [v, src] of tries) { const r = parsePlaylistRef(v); if (r) { playlist = { ...r, source: src }; break; } }
  return { thumbA, thumbOthers: others, playlist, pinned: String(pk.pinned || '').trim(), packagingPath: a.packagingPath || null };
}

async function _json(res) { try { return await res.json(); } catch (_) { return {}; } }
function _reason(j) { const e = (j && j.error) || {}; return (e.errors && e.errors[0] && e.errors[0].reason) || e.status || ''; }
function _apiMsg(st, j) {
  const r = _reason(j), m = (j && j.error && j.error.message) || '';
  if (st === 403 && /insufficient|SCOPE/i.test(r + m)) return '권한이 없습니다 — ⚙ 설정 → 📺 채널 연결에서 이 채널을 「다시 연결」하세요(재생목록 권한이 새로 생겼습니다)';
  if (r === 'quotaExceeded') return '오늘 구글 API 할당량을 다 썼습니다 — 한국 시간 오후 4~5시에 초기화됩니다';
  return `유튜브 오류 ${st}${r ? ` (${r})` : ''}${m ? ` — ${m}` : ''}`;
}

/** 2MB 넘는 썸네일 → 1280x720 JPEG 임시 파일(ffmpeg · 비동기). 실패하면 던진다. */
async function shrinkThumb(file) {
  const MU = require('./media-utils');
  const ff = MU.getFfmpegPath();
  if (!ff) throw new Error('ffmpeg 가 없어 큰 썸네일을 줄이지 못했습니다');
  const { spawn } = require('child_process');
  for (const q of [3, 6, 10]) {
    const out = MU.tmpFile('.jpg');
    await new Promise((res, rej) => {
      const c = spawn(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease', '-q:v', String(q), out], { stdio: 'ignore' });
      c.on('error', rej); c.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg 종료 코드 ${code}`))));
    });
    if (fs.statSync(out).size <= THUMB_MAX) return out;
    try { fs.rmSync(out, { force: true }); } catch (_) {}
  }
  throw new Error('썸네일을 2MB 아래로 줄이지 못했습니다');
}

/** 이 채널의 재생목록(제목 → id 목록) — 50개씩 최대 20쪽 */
async function _myPlaylists(H) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${EP.api}/playlists?part=snippet&mine=true&maxResults=50${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`, H);
    const j = await _json(r);
    if (r.status !== 200) throw new Error(`재생목록 목록 조회 실패 — ${_apiMsg(r.status, j)}`);
    for (const it of (j.items || [])) out.push({ id: it.id, title: (it.snippet && it.snippet.title) || '' });
    pageToken = j.nextPageToken || '';
    if (!pageToken) break;
  }
  return out;
}
const _norm = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();

/** 재생목록 지정 → {id, title} (이 채널 것만) */
async function resolvePlaylist(ref, channelId, H) {
  if (ref.id) {
    const r = await fetch(`${EP.api}/playlists?part=snippet&id=${encodeURIComponent(ref.id)}`, H);
    const j = await _json(r);
    if (r.status !== 200) throw new Error(`재생목록 조회 실패 — ${_apiMsg(r.status, j)}`);
    const it = (j.items || [])[0];
    if (!it) throw new Error(`재생목록 ${ref.id} 를 찾지 못했습니다 — 링크가 잘렸거나 지워진 목록입니다`);
    const owner = (it.snippet && it.snippet.channelId) || '';
    if (owner && channelId && owner !== channelId) throw new Error(`재생목록 「${it.snippet.title}」은 다른 채널 것이라 담을 수 없습니다`);
    return { id: it.id, title: (it.snippet && it.snippet.title) || it.id };
  }
  const all = await _myPlaylists(H);
  const hit = all.filter((p) => _norm(p.title) === _norm(ref.name));
  if (!hit.length) throw new Error(`이 채널에 「${ref.name}」 재생목록이 없습니다 — 이름이 똑같아야 합니다(있는 목록: ${all.slice(0, 8).map((p) => p.title).join(' · ') || '없음'})`);
  if (hit.length > 1) throw new Error(`「${ref.name}」 이름의 재생목록이 ${hit.length}개라 고를 수 없습니다 — 패키징 「## 재생목록」에 주소를 적어 주세요`);
  return hit[0];
}
async function _inPlaylist(plId, videoId, H) {
  const r = await fetch(`${EP.api}/playlistItems?part=id&maxResults=5&playlistId=${encodeURIComponent(plId)}&videoId=${encodeURIComponent(videoId)}`, H);
  const j = await _json(r);
  if (r.status !== 200) throw new Error(`재생목록 확인 실패 — ${_apiMsg(r.status, j)}`);
  return (j.items || []).length > 0;
}

/**
 * 한 영상 마무리 → { items:[{key,label,status:'ok'|'fail'|'skip'|'manual',detail}], done, failed, manual }
 * @param {{channelId:string, videoId:string, plan:object, token:(force?:boolean)=>Promise<string>, log?:Function, shrink?:Function}} o
 */
async function finishVideo(o) {
  const log = o.log || (() => {});
  const { videoId, plan } = o;
  const items = [];
  const add = (key, label, status, detail) => items.push({ key, label, status, detail });
  let token = await o.token(false);
  const H = () => ({ headers: { Authorization: `Bearer ${token}` } });
  const rec = _store()[videoId] || {};

  // ① 썸네일 A
  if (!plan.thumbA) add('thumb', '썸네일 A', 'fail', '썸네일_A 파일이 없습니다(썸네일 폴더 · [약칭_MMDD] 썸네일_A.png)');
  else {
    const sig = _fileSig(plan.thumbA.path);
    if (sig && rec.thumbSig === sig) add('thumb', '썸네일 A', 'ok', `이미 넣음 (${plan.thumbA.name})`);
    else {
      let tmp = null;
      try {
        let file = plan.thumbA.path;
        if (fs.statSync(file).size > THUMB_MAX) { tmp = await (o.shrink || shrinkThumb)(file); file = tmp; }
        const buf = fs.readFileSync(file);
        const type = /\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.webp$/i.test(file) ? 'image/webp' : 'image/png';
        const send = () => fetch(`${EP.thumb}?videoId=${encodeURIComponent(videoId)}&uploadType=media`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': type, 'Content-Length': String(buf.length) }, body: buf });
        let r = await send();
        if (r.status === 401) { token = await o.token(true); r = await send(); }
        const j = await _json(r);
        if (r.status === 200) { _storeSet(videoId, { thumbSig: sig, thumbAt: Date.now() }); add('thumb', '썸네일 A', 'ok', plan.thumbA.name); }
        else if (r.status === 403 && !/insufficient|SCOPE/i.test(JSON.stringify(j))) add('thumb', '썸네일 A', 'fail', '구글이 맞춤 썸네일을 거부했습니다 — 채널 휴대폰 인증(맞춤 썸네일 권한)을 확인하세요');
        else add('thumb', '썸네일 A', 'fail', _apiMsg(r.status, j));
      } catch (e) { add('thumb', '썸네일 A', 'fail', e.message); }
      finally { if (tmp) { try { fs.rmSync(tmp, { force: true }); } catch (_) {} } }
    }
  }

  // ② 재생목록 — 넣고 **다시 읽어** 들어갔는지 확인
  if (!plan.playlist) add('playlist', '재생목록', 'fail', '정해진 재생목록이 없습니다 — 패키징 「## 재생목록」 또는 채널편집 → ⬆ 업로드 → 재생목록 이름');
  else {
    try {
      const pl = await resolvePlaylist(plan.playlist, o.channelId, H());
      if (await _inPlaylist(pl.id, videoId, H())) add('playlist', '재생목록', 'ok', `「${pl.title}」 이미 들어 있음 (${plan.playlist.source})`);
      else {
        const r = await fetch(`${EP.api}/playlistItems?part=snippet`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ snippet: { playlistId: pl.id, resourceId: { kind: 'youtube#video', videoId } } }),
        });
        const j = await _json(r);
        if (r.status !== 200) add('playlist', '재생목록', 'fail', `「${pl.title}」에 담지 못함 — ${_apiMsg(r.status, j)}`);
        else if (await _inPlaylist(pl.id, videoId, H())) { _storeSet(videoId, { playlistId: pl.id }); add('playlist', '재생목록', 'ok', `「${pl.title}」에 담음 (${plan.playlist.source})`); }
        else add('playlist', '재생목록', 'fail', `「${pl.title}」에 담았다는 답은 왔는데 다시 읽으니 없습니다 — Studio 에서 확인하세요`);
      }
    } catch (e) { add('playlist', '재생목록', 'fail', e.message); }
  }

  // ③ Studio 몫(API 없음) — 무엇이 준비돼 있는지까지 적는다
  add('pinned', '고정댓글', plan.pinned ? 'manual' : 'fail', plan.pinned ? `문구 준비됨(${Array.from(plan.pinned).length}자) — 일부 공개 → 댓글 → 고정` : '패키징에 「## 고정댓글」이 없습니다');
  add('abtest', '썸네일 A/B', plan.thumbOthers.length ? 'manual' : 'skip', plan.thumbOthers.length ? `${plan.thumbOthers.map((t) => t.name.replace(/^.*썸네일_/, '')).join('·')} — 편집 화면 「A/B 테스팅」` : 'B·C 파일 없음');
  add('endscreen', '종료화면', 'manual', 'Studio 편집 화면');
  add('schedule', '예약', 'manual', 'Studio 공개 상태 → 예약(고정댓글을 단 뒤에)');

  const failed = items.filter((x) => x.status === 'fail').length;
  const manual = items.filter((x) => x.status === 'manual').length;
  return { items, done: items.filter((x) => x.status === 'ok').length, failed, manual };
}

const ICON = { ok: '✅', fail: '⚠', skip: '·', manual: '✋' };
/** 확인표 → 로그 줄들 */
function reportLines(title, res) {
  const head = `🧷 업로드 마무리 — 「${title}」 · 앱 처리 ${res.done}${res.failed ? ` · ⚠ 빠짐 ${res.failed}` : ''} · ✋ Studio ${res.manual}`;
  return [head, ...res.items.map((x) => `   ${ICON[x.status] || '·'} ${x.label} — ${x.detail}`)];
}

module.exports = { planFinish, finishVideo, reportLines, parsePlaylistRef, resolvePlaylist, shrinkThumb, storeFile, THUMB_MAX, _setEndpoints };
