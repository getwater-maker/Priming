'use strict';
/**
 * free-stock.js — 🔎 무료 스톡 검색(Pexels · Pixabay) · v0.7.67 (로이 2026-10-08 — uhb.kr/freestock 같은 기능을 앱 안에)
 *   두 곳을 한 번에 검색해 **같은 모양**으로 돌려준다. 고른 것은 main 이 받아 그룹 그림/영상으로 붙인다(사람이 고른 자산).
 *     Pexels   GET https://api.pexels.com/v1/search · /videos/search   (헤더 Authorization: <키> · 시간당 200회)
 *     Pixabay  GET https://pixabay.com/api/ · /api/videos/              (?key= · 분당 100회 · 🔑 같은 검색은 24시간 캐시 — 약관)
 *   항목 = { src, id, kind:'photo'|'video', thumb, w, h, dur, author, authorUrl, pageUrl, tags, dl }
 *     dl = 받을 파일 주소(가로 1920 근처 · 사진은 Pexels 가 16:9 로 잘라 준다 · Pixabay 사진은 main 이 ffmpeg 로 자른다)
 *   라이선스: 둘 다 상업적 이용 가능 · 출처 표기 권장 — main 이 <출력>/스톡_출처.txt 에 남긴다.
 *   ⚠ 메인 프로세스 전용(전역 fetch) — 렌더러 번들에 넣지 말 것. ⛔ 키 원문을 메시지·로그에 싣지 않는다.
 */

const TIMEOUT_MS = 15000;
const CACHE_MS = 24 * 3600 * 1000;
const _cache = new Map();   // 같은 검색 = 24시간 다시 묻지 않는다(Pixabay 약관 · 한도 아끼기)

async function _get(url, headers, fetchImpl) {
  const f = fetchImpl || fetch;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await f(url, { method: 'GET', headers: headers || {}, signal: ac.signal });
    let text = ''; try { text = await res.text(); } catch (_) {}
    let json = null; try { json = JSON.parse(text); } catch (_) {}
    return { status: res.status, text, json };
  } finally { clearTimeout(t); }
}

function _err(label, r) {
  if (r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test(r.text))) return `${label} 키가 거부됐습니다(${r.status}) — ⚙ 설정 → API 키에서 확인하세요`;
  if (r.status === 429) return `${label} 검색 한도에 걸렸습니다(429) — 잠시 뒤 다시`;
  return `${label} 응답 오류(${r.status})`;
}

/** Pexels 영상 파일 고르기 — mp4 · 가로 영상 · 1920 에 가장 가까운 것(4K 는 너무 크다) */
function pickPexelsVideoFile(files) {
  const mp4 = (files || []).filter((f) => f && f.link && /mp4/i.test(f.file_type || 'mp4') && (f.width || 0) >= (f.height || 0));
  if (!mp4.length) return null;
  const score = (f) => { const w = f.width || 0; return w >= 1920 ? w - 1920 : (1920 - w) * 3; };   // 1920 이상 중 가장 작은 것 우선, 없으면 가장 큰 것
  return mp4.slice().sort((a, b) => score(a) - score(b))[0];
}

function normPexelsPhoto(p) {
  const base = String((p.src && p.src.original) || '').split('?')[0];
  return {
    src: 'pexels', id: String(p.id), kind: 'photo',
    thumb: (p.src && (p.src.medium || p.src.landscape || p.src.small)) || '',
    w: p.width || 0, h: p.height || 0, dur: 0,
    author: p.photographer || '', authorUrl: p.photographer_url || '', pageUrl: p.url || '', tags: p.alt || '',
    dl: base ? base + '?auto=compress&cs=tinysrgb&fit=crop&w=1920&h=1080' : '',
  };
}
function normPexelsVideo(v) {
  const f = pickPexelsVideoFile(v.video_files);
  return f && {
    src: 'pexels', id: String(v.id), kind: 'video',
    thumb: v.image || '', w: f.width || v.width || 0, h: f.height || v.height || 0, dur: v.duration || 0,
    author: (v.user && v.user.name) || '', authorUrl: (v.user && v.user.url) || '', pageUrl: v.url || '', tags: '',
    dl: f.link,
  };
}
function normPixabayPhoto(h) {
  return {
    src: 'pixabay', id: String(h.id), kind: 'photo',
    thumb: h.webformatURL || h.previewURL || '', w: h.imageWidth || 0, h: h.imageHeight || 0, dur: 0,
    author: h.user || '', authorUrl: h.user_id ? `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/` : '', pageUrl: h.pageURL || '', tags: h.tags || '',
    dl: h.largeImageURL || h.webformatURL || '',
  };
}
function normPixabayVideo(h) {
  const v = h.videos || {};
  const f = (v.large && v.large.url) ? v.large : (v.medium && v.medium.url) ? v.medium : (v.small && v.small.url) ? v.small : null;
  if (!f || (f.width || 0) < (f.height || 0)) return null;   // 세로 영상은 뺀다(롱폼 16:9)
  const th = f.thumbnail || (v.medium && v.medium.thumbnail) || (v.small && v.small.thumbnail) || (h.picture_id ? `https://i.vimeocdn.com/video/${h.picture_id}_640x360.jpg` : '');
  return {
    src: 'pixabay', id: String(h.id), kind: 'video',
    thumb: th, w: f.width || 0, h: f.height || 0, dur: h.duration || 0,
    author: h.user || '', authorUrl: h.user_id ? `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/` : '', pageUrl: h.pageURL || '', tags: h.tags || '',
    dl: f.url,
  };
}

/** 한 곳 검색 — { ok, items, total, error } */
async function searchOne(src, { q, kind, page, perPage }, key, fetchImpl) {
  const k = String(key || '').trim();
  const label = src === 'pexels' ? 'Pexels' : 'Pixabay';
  if (!k) return { ok: false, items: [], total: 0, error: `${label} 키가 없습니다 — ⚙ 설정 → API 키` };
  const query = String(q || '').trim().slice(0, 100);
  if (!query) return { ok: false, items: [], total: 0, error: '검색어가 없습니다' };
  const pg = Math.max(1, Number(page) || 1), n = Math.max(3, Math.min(40, Number(perPage) || 24));
  const isVid = kind === 'video';
  const ko = /[가-힣]/.test(query);
  let url, headers;
  if (src === 'pexels') {
    url = `https://api.pexels.com/${isVid ? 'videos/search' : 'v1/search'}?query=${encodeURIComponent(query)}&orientation=landscape&per_page=${n}&page=${pg}${ko ? '&locale=ko-KR' : ''}`;
    headers = { Authorization: k };
  } else {
    url = `https://pixabay.com/api/${isVid ? 'videos/' : ''}?key=${encodeURIComponent(k)}&q=${encodeURIComponent(query)}&safesearch=true&per_page=${n}&page=${pg}${isVid ? '' : '&image_type=photo&orientation=horizontal'}${ko ? '&lang=ko' : ''}`;
  }
  const ck = `${src}|${isVid ? 'v' : 'p'}|${query}|${pg}|${n}|${k.slice(-6)}`;
  const hit = _cache.get(ck);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
  try {
    const r = await _get(url, headers, fetchImpl);
    if (r.status !== 200 || !r.json) return { ok: false, items: [], total: 0, error: _err(label, r) };
    let items, total;
    if (src === 'pexels') {
      items = isVid ? (r.json.videos || []).map(normPexelsVideo) : (r.json.photos || []).map(normPexelsPhoto);
      total = r.json.total_results || 0;
    } else {
      items = (r.json.hits || []).map(isVid ? normPixabayVideo : normPixabayPhoto);
      total = r.json.totalHits || 0;
    }
    const v = { ok: true, items: items.filter((x) => x && x.dl && x.thumb), total };
    _cache.set(ck, { t: Date.now(), v });
    return v;
  } catch (e) {
    const m = String((e && e.message) || e);
    return { ok: false, items: [], total: 0, error: /abort/i.test(m) ? `${label}: ${TIMEOUT_MS / 1000}초 안에 응답 없음` : `${label} 연결 실패(${m.split(k).join('***').slice(0, 80)})` };
  }
}

/** 여러 곳 함께 — 결과를 번갈아 섞는다(한 곳이 위를 다 차지하지 않게) · 실패한 곳은 errors 에 */
async function search(opts, keys, fetchImpl) {
  const srcs = (opts.sources && opts.sources.length ? opts.sources : ['pexels', 'pixabay']).filter((s) => s === 'pexels' || s === 'pixabay');
  const rs = await Promise.all(srcs.map((s) => searchOne(s, opts, (keys || {})[s], fetchImpl)));
  const lists = rs.map((r) => r.items);
  const items = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) items.push(l[i]);
  const errors = rs.map((r, i) => (r.ok ? null : r.error)).filter(Boolean);
  const total = {}; srcs.forEach((s, i) => { total[s] = rs[i].total; });
  return { ok: items.length > 0 || !errors.length, items, errors, total };
}

/** 그룹 이미지 프롬프트 → 기본 검색어(첫 마디 · 8낱말) — 사람이 고쳐 쓴다 */
function defaultQuery(prompt, title) {
  const p = String(prompt || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').split(/[,.;:\n]/).map((x) => x.trim()).find((x) => x.length >= 3) || '';
  const w = p.split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
  return w || String(title || '').trim().slice(0, 40);
}

/** 받은 파일 이름(ASCII · 번호 이름이 아니다 — 그룹 번호 파일과 섞이지 않게) */
function fileNameFor(it) {
  const ext = it.kind === 'video' ? 'mp4' : (/\.png(\?|$)/i.test(it.dl) ? 'png' : 'jpg');
  return `${it.src}_${it.kind}_${String(it.id).replace(/[^0-9A-Za-z_-]/g, '')}.${ext}`;
}

function creditLine(it, where) {
  const name = it.src === 'pexels' ? 'Pexels' : 'Pixabay';
  return `${where} · ${name} ${it.kind === 'video' ? '영상' : '사진'} · ${it.author || '작가 미상'}${it.authorUrl ? ' (' + it.authorUrl + ')' : ''} · ${it.pageUrl}`;
}

module.exports = { search, searchOne, defaultQuery, fileNameFor, creditLine, pickPexelsVideoFile, normPexelsPhoto, normPexelsVideo, normPixabayPhoto, normPixabayVideo, _cache };
