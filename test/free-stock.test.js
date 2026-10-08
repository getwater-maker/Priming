'use strict';
/**
 * node test/free-stock.test.js — 🔎 무료 스톡(core/free-stock · v0.7.67) 단위 시험. 네트워크 없이 가짜 fetch 로.
 *   [1] Pexels·Pixabay 응답 → 같은 모양 · 받을 파일 고르기(영상 1920 근처 · 세로 영상 제외)
 *   [2] 두 곳 번갈아 섞기 · 한 곳 실패는 errors 로(다른 곳 결과는 남는다)
 *   [3] 같은 검색은 캐시(두 번째는 fetch 안 함) · 키 원문이 오류 문구에 안 실린다
 *   [4] 기본 검색어 · 파일 이름 · 출처 줄 · api-key-check 의 pexels/pixabay
 */
const FS = require('../core/free-stock');
const AK = require('../core/api-key-check');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const PEX_PHOTOS = { total_results: 2, photos: [
  { id: 11, width: 6000, height: 4000, url: 'https://www.pexels.com/photo/11/', photographer: 'Kim', photographer_url: 'https://www.pexels.com/@kim', alt: 'stone pile', src: { original: 'https://images.pexels.com/photos/11/a.jpeg', medium: 'https://images.pexels.com/photos/11/a.jpeg?h=350' } },
  { id: 12, width: 5000, height: 3000, url: 'https://www.pexels.com/photo/12/', photographer: 'Lee', photographer_url: '', alt: '', src: { original: 'https://images.pexels.com/photos/12/b.jpeg', medium: 'https://images.pexels.com/photos/12/b.jpeg?h=350' } },
] };
const PEX_VIDEOS = { total_results: 2, videos: [
  { id: 21, width: 3840, height: 2160, url: 'https://www.pexels.com/video/21/', image: 'https://images.pexels.com/videos/21/t.jpg', duration: 14, user: { name: 'Park', url: 'https://www.pexels.com/@park' }, video_files: [
    { file_type: 'video/mp4', width: 3840, height: 2160, link: 'https://v/21-4k.mp4' }, { file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://v/21-hd.mp4' }, { file_type: 'video/mp4', width: 1280, height: 720, link: 'https://v/21-720.mp4' }] },
  { id: 22, width: 1080, height: 1920, url: 'https://www.pexels.com/video/22/', image: 'https://i/22.jpg', duration: 9, user: { name: 'V' }, video_files: [{ file_type: 'video/mp4', width: 1080, height: 1920, link: 'https://v/22.mp4' }] },
] };
const PIX_PHOTOS = { totalHits: 1, hits: [{ id: 31, pageURL: 'https://pixabay.com/photos/31/', tags: 'stone, pile', webformatURL: 'https://pixabay.com/get/31_640.jpg', largeImageURL: 'https://pixabay.com/get/31_1280.jpg', imageWidth: 4000, imageHeight: 3000, user: 'choi', user_id: 9 }] };
const PIX_VIDEOS = { totalHits: 2, hits: [
  { id: 41, pageURL: 'https://pixabay.com/videos/41/', tags: 'sea', duration: 20, user: 'han', user_id: 7, videos: { large: { url: 'https://cdn.pixabay.com/41-l.mp4', width: 1920, height: 1080, thumbnail: 'https://cdn.pixabay.com/41-l.jpg' }, medium: { url: 'https://cdn.pixabay.com/41-m.mp4', width: 1280, height: 720 } } },
  { id: 42, pageURL: 'https://pixabay.com/videos/42/', tags: 'tall', duration: 8, user: 'x', user_id: 1, videos: { large: { url: 'https://cdn.pixabay.com/42.mp4', width: 1080, height: 1920, thumbnail: 'https://cdn.pixabay.com/42.jpg' } } },
] };

function fakeFetch(calls, opts = {}) {
  return async (url, init) => {
    calls.push({ url, headers: (init && init.headers) || {} });
    const u = String(url);
    const body = (s, j) => ({ status: s, text: async () => (typeof j === 'string' ? j : JSON.stringify(j)) });
    if (u.includes('api.pexels.com')) {
      if (opts.pexelsDown) return body(401, { error: 'bad key' });
      return body(200, u.includes('/videos/') ? PEX_VIDEOS : PEX_PHOTOS);
    }
    if (u.includes('pixabay.com/api')) {
      if (opts.pixabayBad) return body(400, '[ERROR 400] Invalid or missing API key');
      return body(200, u.includes('/videos/') ? PIX_VIDEOS : PIX_PHOTOS);
    }
    return body(404, '');
  };
}

(async () => {
  console.log('[1] 응답 → 같은 모양');
  {
    FS._cache.clear(); const calls = [];
    const r = await FS.search({ q: 'stone pile', kind: 'photo' }, { pexels: 'PEXKEY', pixabay: 'PIXKEY' }, fakeFetch(calls));
    ok(r.ok && r.items.length === 3, `사진 3개(Pexels 2 + Pixabay 1) — ${r.items.length}`);
    const p = r.items.find((x) => x.src === 'pexels' && x.id === '11');
    ok(p && p.dl === 'https://images.pexels.com/photos/11/a.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=1920&h=1080', 'Pexels 사진 = 1920x1080 로 잘라 받는 주소');
    ok(p && p.author === 'Kim' && p.pageUrl === 'https://www.pexels.com/photo/11/' && p.thumb.includes('h=350'), 'Pexels 작가·원본·썸네일');
    const x = r.items.find((y) => y.src === 'pixabay');
    ok(x && x.dl.endsWith('31_1280.jpg') && x.authorUrl === 'https://pixabay.com/users/choi-9/', 'Pixabay 사진 = largeImageURL · 작가 페이지');
    ok(calls.some((c) => c.headers.Authorization === 'PEXKEY') && calls.some((c) => /[?&]key=PIXKEY/.test(c.url)), '키 전달: Pexels 헤더 · Pixabay 주소');
    ok(calls.every((c) => !/locale=|lang=/.test(c.url)), '영어 검색어엔 언어 지정 없음');
    const v = await FS.search({ q: 'sea', kind: 'video' }, { pexels: 'PEXKEY', pixabay: 'PIXKEY' }, fakeFetch(calls));
    const pv = v.items.find((y) => y.src === 'pexels');
    ok(pv && pv.dl === 'https://v/21-hd.mp4' && pv.dur === 14, 'Pexels 영상 = 4K 대신 1920 파일');
    ok(!v.items.some((y) => y.id === '22' || y.id === '42'), '세로 영상(Pexels 22 · Pixabay 42)은 뺀다');
    const xv = v.items.find((y) => y.src === 'pixabay');
    ok(xv && xv.dl.endsWith('41-l.mp4') && xv.thumb.endsWith('41-l.jpg'), 'Pixabay 영상 = large · 썸네일');
    ok(FS.pickPexelsVideoFile([{ file_type: 'video/mp4', width: 1280, height: 720, link: 'a' }, { file_type: 'video/mp4', width: 960, height: 540, link: 'b' }]).link === 'a', '1920 이상이 없으면 가장 큰 것');
    const ko = []; FS._cache.clear(); await FS.search({ q: '돌무더기', kind: 'photo' }, { pexels: 'K', pixabay: 'K' }, fakeFetch(ko));
    ok(ko.some((c) => c.url.includes('locale=ko-KR')) && ko.some((c) => c.url.includes('lang=ko')), '한글 검색어 → Pexels locale=ko-KR · Pixabay lang=ko');
  }
  console.log('[2] 섞기 · 한 곳 실패');
  {
    FS._cache.clear(); const calls = [];
    const r = await FS.search({ q: 'stone', kind: 'photo' }, { pexels: 'A', pixabay: 'B' }, fakeFetch(calls));
    ok(r.items.map((x) => x.src).join(',') === 'pexels,pixabay,pexels', `번갈아 섞는다 — ${r.items.map((x) => x.src).join(',')}`);
    FS._cache.clear();
    const r2 = await FS.search({ q: 'stone', kind: 'photo' }, { pexels: 'SECRETPEXELSKEY', pixabay: 'B' }, fakeFetch([], { pexelsDown: true }));
    ok(r2.ok && r2.items.length === 1 && r2.errors.length === 1 && /Pexels 키가 거부/.test(r2.errors[0]), `Pexels 401 → 오류 1 · Pixabay 결과는 남는다 — ${r2.errors[0]}`);
    FS._cache.clear();
    const r3 = await FS.search({ q: 'stone', kind: 'photo' }, { pexels: '', pixabay: 'SECRETPIXKEY' }, fakeFetch([], { pixabayBad: true }));
    ok(!r3.ok && r3.errors.length === 2 && r3.errors.some((e) => /Pexels 키가 없습니다/.test(e)) && r3.errors.some((e) => /Pixabay 키가 거부/.test(e)), '키 없음 · Pixabay 잘못된 키 → 둘 다 사람 말 오류');
    ok(!JSON.stringify([r2, r3]).includes('SECRET'), '키 원문이 결과·오류에 실리지 않는다');
    const r4 = await FS.search({ q: 'x', kind: 'photo', sources: ['pixabay'] }, { pexels: 'A', pixabay: 'B' }, async () => { throw new Error('getaddrinfo ENOTFOUND B'); });
    ok(r4.errors.length === 1 && /연결 실패/.test(r4.errors[0]) && !/ENOTFOUND B\b/.test(r4.errors[0]), `연결 실패 문구에서 키를 가린다 — ${r4.errors[0]}`);
  }
  console.log('[3] 캐시');
  {
    FS._cache.clear(); const calls = [];
    await FS.search({ q: 'stone', kind: 'photo' }, { pexels: 'A', pixabay: 'B' }, fakeFetch(calls));
    const n1 = calls.length;
    await FS.search({ q: 'stone', kind: 'photo' }, { pexels: 'A', pixabay: 'B' }, fakeFetch(calls));
    ok(n1 === 2 && calls.length === 2, `같은 검색 두 번 → 요청 ${calls.length}번(두 번째는 캐시)`);
    await FS.search({ q: 'stone', kind: 'photo', page: 2 }, { pexels: 'A', pixabay: 'B' }, fakeFetch(calls));
    ok(calls.length === 4, '다른 쪽(page 2)은 새로 묻는다(판별력)');
    FS._cache.clear(); const c2 = [];
    await FS.search({ q: 'stone', kind: 'photo' }, { pexels: 'A' }, fakeFetch(c2, { pexelsDown: true }));
    await FS.search({ q: 'stone', kind: 'photo' }, { pexels: 'A' }, fakeFetch(c2));
    ok(c2.filter((c) => c.url.includes('pexels')).length === 2, '실패한 검색은 캐시하지 않는다');
  }
  console.log('[4] 도우미 · 키 검증');
  {
    ok(FS.defaultQuery('An old woman stacking stones beside a path, autumn light, oil painting.') === 'An old woman stacking stones beside a path', '기본 검색어 = 첫 마디');
    ok(FS.defaultQuery('', '이름을 대시오') === '이름을 대시오', '프롬프트 없으면 그룹 제목');
    ok(FS.fileNameFor({ src: 'pexels', kind: 'photo', id: '11', dl: 'https://x/a.jpeg?w=1' }) === 'pexels_photo_11.jpg' && FS.fileNameFor({ src: 'pixabay', kind: 'video', id: '4/1', dl: 'x' }) === 'pixabay_video_41.mp4', '파일 이름 = ASCII · 번호 이름 아님');
    ok(!/^\d+\./.test(FS.fileNameFor({ src: 'pexels', kind: 'photo', id: '7', dl: '' })), '그룹 번호 파일(NN.png)과 섞이지 않는다');
    ok(FS.creditLine({ src: 'pexels', kind: 'photo', author: 'Kim', authorUrl: 'https://a', pageUrl: 'https://p' }, 'G3') === 'G3 · Pexels 사진 · Kim (https://a) · https://p', '출처 줄');
    ok(AK.ids.includes('pexels') && AK.ids.includes('pixabay'), 'api-key-check 에 pexels·pixabay');
    const g = await AK.verify('pexels', 'K', {}, fakeFetch([]));
    const b = await AK.verify('pixabay', 'K', {}, fakeFetch([], { pixabayBad: true }));
    const d = await AK.verify('pexels', 'K', {}, fakeFetch([], { pexelsDown: true }));
    ok(g.level === 'ok' && b.level === 'bad' && /Invalid/.test(b.message) && d.level === 'bad', `키 검증: 통과 / Pixabay 틀림 / Pexels 거부 — ${g.message} · ${b.message} · ${d.message}`);
  }
  console.log(`\n${fail ? '❌' : '✅'} 무료 스톡 ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
