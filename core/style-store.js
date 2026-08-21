/**
 * 이미지 스타일 프리셋 스토어
 * 위치: ~/.flow-app/styles.json (사용자 추가/수정 스타일만 저장)
 *
 * 정책:
 *  - 기본 스타일은 코드에 시드 (BUILT_IN_STYLES) — 항상 존재, 수정/삭제 불가.
 *  - 사용자 스타일만 ~/.flow-app/styles.json 에 저장 — 자유롭게 추가/수정/삭제.
 *  - loadAll() 은 기본 + 사용자 합쳐서 반환 (기본 먼저, 사용자 다음).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const STORE_DIR = path.join(os.homedir(), '.flow-app');
const STORE_PATH = path.join(STORE_DIR, 'styles.json');
const ORDER_PATH = path.join(STORE_DIR, 'style-order.json');

// 기본 28개 스타일 — flow-engine.js 의 옛 STYLE_PROMPTS 객체에서 이관
const _RAW_STYLES = [
  { id: 'k-webtoon',         name: '한국 웹툰',           prompt: 'beautiful Korean webtoon style, manhwa art, soft shading, detailed characters, emotional expressions, Korean comic illustration, clean lineart, pastel colors' },
  { id: 'webtoon-illust',    name: '웹툰 일러스트',       prompt: 'webtoon illustration style, digital painting, semi-realistic, vivid colors, detailed background, Korean manhwa inspired, clean composition' },
  { id: 'dramatic-webtoon',  name: '극적웹툰',            prompt: 'Dramatic Korean webtoon/manhwa illustration, semi-realistic, bold clean confident ink linework, rich cel-style shading, dramatic cinematic lighting (warm key light, deep shadows), high contrast, muted palette with a bold red-and-gold focal point, highly readable, consistent with the reference image, realistic adult body proportions and mature detailed faces — NOT chibi, NOT super-deformed, NOT big-head, NOT small-body, NOT cute, NOT kawaii, NOT pastel, NOT 3D Pixar, NOT photorealistic' },
  { id: 'cinematic',         name: '시네마틱 (영화풍)',   prompt: 'cinematic film still, dramatic lighting, movie scene' },
  { id: 'photorealistic',    name: '포토리얼 (실사)',     prompt: 'photorealistic photography, high detail, natural lighting, 8K' },
  { id: 'illustration',      name: '일러스트',            prompt: 'digital illustration, clean lines, warm colors, detailed' },
  { id: 'anime',             name: '애니메이션',          prompt: 'anime style illustration, vibrant colors, expressive characters, Japanese animation' },
  { id: 'watercolor',        name: '수채화',              prompt: 'traditional watercolor painting, aquarelle, wet-on-wet technique, visible paper texture, soft pastel color washes, flowing translucent pigments, hand-painted on cotton paper, loose brush strokes, bleeding colors, artistic fine art, NOT digital illustration, NOT line art, NOT webtoon, NOT manhwa, NOT anime' },
  { id: 'biblical-watercolor', name: '수채화 (성경시대)', prompt: 'traditional watercolor painting of ancient biblical era, aquarelle, wet-on-wet technique, visible paper texture, soft earth-tone washes (ochre, sand, olive, terracotta), flowing translucent pigments, hand-painted on cotton paper, loose brush strokes, ancient Middle Eastern setting, biblical figures in flowing robes and tunics, head coverings, sandals, bearded elders, Holy Land landscape with olive trees and stone buildings, reverent atmosphere, sacred scripture illustration, fine art, NOT digital illustration, NOT line art, NOT webtoon, NOT manhwa, NOT anime, NOT modern clothing, NOT Korean historical drama' },
  { id: 'ink',               name: '수묵화',              prompt: 'ink wash painting, traditional, minimalist, elegant brush strokes' },
  { id: 'oil',               name: '유화',                prompt: 'oil painting, classical, rich colors, elegant brushwork, fine art' },
  { id: 'fantasy',           name: '판타지 아트',         prompt: 'fantasy art, epic scene, magical atmosphere, detailed environment, concept art' },
  { id: 'noir',              name: '필름 누아르',         prompt: 'film noir, black and white, high contrast, shadows, dramatic mood, vintage' },
  { id: 'pixel',             name: '픽셀 아트',           prompt: 'pixel art, retro game style, 16-bit, vibrant colors, detailed sprites' },
  { id: 'comic',             name: '만화/코믹',           prompt: 'comic book style, bold outlines, dynamic composition, vivid colors, action panels' },
  { id: '3d',                name: '3D 렌더링',           prompt: '3D rendered scene, ray tracing, realistic materials, cinematic lighting, Unreal Engine' },
  { id: 'stickman',          name: '졸라맨 (스틱맨)',     prompt: 'simple stick figure drawing, black lines on white background, minimalist doodle, hand-drawn sketch style, funny stick characters' },
  { id: 'ghibli',            name: '수채 감성 애니',       prompt: 'hand-painted anime style, soft watercolor backgrounds, warm natural lighting, lush detailed nature, gentle nostalgic atmosphere, cel-shaded illustration' },
  { id: 'disney',            name: '말랑 3D 애니',         prompt: 'cute warm 3D-animated illustration, big expressive eyes, soft rounded features, smooth shading, friendly heartwarming character design, glossy render' },
  { id: 'chibi',             name: '치비 (귀여운)',       prompt: 'chibi anime style, cute super-deformed characters, big eyes, small body, kawaii, pastel colors' },
  { id: 'retro',             name: '레트로 80s',          prompt: 'retro 80s synthwave, neon colors, grid landscape, sunset, VHS aesthetic, vaporwave' },
  { id: 'sketch',            name: '연필 스케치',         prompt: 'pencil sketch drawing, graphite on paper, detailed cross-hatching, artistic hand-drawn' },
  { id: 'pop',               name: '팝아트',              prompt: 'pop art style, bold flat colors, thick black outlines, halftone dot shading, comic book aesthetic, high contrast, retro print look' },
  { id: 'monochrome',        name: '모노크롬',            prompt: 'monochrome digital painting, smooth grayscale shading, black and white, strong contrast, dramatic cinematic lighting, realistic idealized llustration, detailed rendering, 4K' },
  { id: 'infographic-3d',    name: '인포그래픽 3D',       prompt: '아래 내용의 대표이미지 한컷을 3D인포그래픽 작성, 한글로 작성, 어른들이 보기 편하게 작성, no watermark' },
  { id: 'infographic-2d',    name: '인포그래픽 2D',       prompt: '아래 내용의 대표이미지 한컷을 2D인포그래픽 작성, 한글로 작성, 어른들이 보기 편하게 작성, no watermark' },
  { id: 'biblical-chibi',    name: '치비 (성경시대)',     prompt: 'chibi anime style, cute super-deformed characters with big sparkling eyes and small bodies, kawaii, soft pastel earth tones (ochre, sand, olive, terracotta), ancient biblical era setting, characters wearing flowing robes and tunics, simple head coverings, leather sandals, bearded elders, Holy Land scenery with olive trees and stone buildings, gentle reverent atmosphere, hand-drawn anime illustration, NOT modern clothing, NOT Korean historical drama, NOT photorealistic' },
  { id: 'three-kingdoms',    name: '흑백 수묵화',          prompt: 'monochrome ink-wash painting style, traditional brush and ink art, smooth grayscale shading, black and white, fine ink rendering, realistic idealized rendering, strong contrast, cinematic lighting, detailed, 4K' },
];

// 모든 스타일 공통 보정 — ① 인물은 미남·미녀(호감형 얼굴) ② 기본은 밝게(단 '어두워야 하는 장면'은 예외 → 내용 프롬프트가 어둡게 지정하면 그대로).
//   인포그래픽·졸라맨(스틱맨)은 얼굴/조명 개념이 없어 제외.
const BEAUTY_BRIGHT = ', attractive good-looking characters (beautiful women and handsome men) with pleasant appealing faces, prefer bright and well-lit imagery with clear luminous atmosphere unless the scene must be dark';
const _NO_ENHANCE = new Set(['infographic-3d', 'infographic-2d', 'stickman']);
const BUILT_IN_STYLES = _RAW_STYLES.map((s) => (_NO_ENHANCE.has(s.id) ? s : { ...s, prompt: s.prompt + BEAUTY_BRIGHT }));

function _loadUserStyles() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.error('[style-store] 사용자 스타일 로드 실패:', e.message);
  }
  return [];
}

function _saveUserStyles(userStyles) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(userStyles, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[style-store] 사용자 스타일 저장 실패:', e.message);
    return false;
  }
}

function _loadOrder() {
  try {
    if (fs.existsSync(ORDER_PATH)) {
      const data = JSON.parse(fs.readFileSync(ORDER_PATH, 'utf-8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.error('[style-store] 순서 로드 실패:', e.message);
  }
  return [];
}

function _saveOrder(orderIds) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(ORDER_PATH, JSON.stringify(orderIds, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[style-store] 순서 저장 실패:', e.message);
    return false;
  }
}

/** 기본 + 사용자 모든 스타일 반환. 각 항목에 isBuiltIn 플래그 포함.
 *  ~/.flow-app/style-order.json 이 있으면 그 순서대로, 없는 항목은 뒤에 (기본 → 사용자). */
function loadAll() {
  const user = _loadUserStyles();
  const all = [
    ...BUILT_IN_STYLES.map(s => ({ ...s, isBuiltIn: true })),
    ...user.map(u => ({ ...u, isBuiltIn: false })),
  ];
  const order = _loadOrder();
  const indexOf = id => {
    const i = order.indexOf(id);
    return i < 0 ? Infinity : i;
  };
  all.sort((a, b) => {
    const ia = indexOf(a.id), ib = indexOf(b.id);
    if (ia !== ib) return ia - ib;
    if (a.isBuiltIn !== b.isBuiltIn) return a.isBuiltIn ? -1 : 1;
    return 0;
  });
  return all;
}

function getById(id) {
  return loadAll().find(s => s.id === id) || null;
}

/** style id → 영문 prompt. 없으면 null. */
function getPrompt(id) {
  const s = getById(id);
  return s ? s.prompt : null;
}

function isBuiltIn(id) {
  return BUILT_IN_STYLES.some(s => s.id === id);
}

/** 사용자 스타일 추가. style = { name, prompt }. 성공 시 새 스타일 객체 반환. */
function add(style) {
  const name = String(style.name || '').trim();
  const prompt = String(style.prompt || '').trim();
  if (!name || !prompt) return null;
  const id = style.id || ('user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  const newStyle = { id, name, prompt };
  const user = _loadUserStyles();
  user.push(newStyle);
  _saveUserStyles(user);
  return { ...newStyle, isBuiltIn: false };
}

/** 사용자 스타일 수정 (기본 스타일은 수정 불가). */
function update(id, patch) {
  if (isBuiltIn(id)) return null;
  const user = _loadUserStyles();
  const idx = user.findIndex(s => s.id === id);
  if (idx < 0) return null;
  const updated = {
    ...user[idx],
    ...(patch.name != null ? { name: String(patch.name).trim() } : {}),
    ...(patch.prompt != null ? { prompt: String(patch.prompt).trim() } : {}),
  };
  user[idx] = updated;
  _saveUserStyles(user);
  return { ...updated, isBuiltIn: false };
}

/** 사용자 스타일 삭제 (기본 스타일은 삭제 불가). */
function remove(id) {
  if (isBuiltIn(id)) return false;
  const user = _loadUserStyles();
  const filtered = user.filter(s => s.id !== id);
  if (filtered.length === user.length) return false;   // 존재 안 함
  _saveUserStyles(filtered);
  return true;
}

/** 전체 순서를 한 번에 저장. orderIds 는 스타일 ID 문자열 배열. */
function setOrder(orderIds) {
  if (!Array.isArray(orderIds)) return false;
  return _saveOrder(orderIds.filter(x => typeof x === 'string'));
}

/** id 한 개를 'up' / 'down' 으로 한 칸 이동. 현재 loadAll() 결과 순서 기준. */
function moveStyle(id, direction) {
  const all = loadAll();
  const idx = all.findIndex(s => s.id === id);
  if (idx < 0) return false;
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= all.length) return false;
  const ids = all.map(s => s.id);
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  return _saveOrder(ids);
}

// ── ☁ 여러 PC 공유 (OmniVoice 서버의 /styles) ────────────────────────────────
//  왜: 목소리(참조음성)는 이미 서버 공용 라이브러리를 쓰는데 **스타일은 PC 마다 갈렸다**.
//    나와 아내가 같은 채널을 쓰는데 스타일 목록이 다르면 같은 대본이 다른 화풍으로 나온다.
//  어디에: 구글드라이브(G:)가 아니라 **상시 실행 서버**. G: 는 동기화 지연이 있고 실제로
//    언마운트되어 작업이 죽은 적이 있다(2026-08-21). 스타일은 몇 KB 라 서버가 가볍다.
//  정책: **로컬 파일이 작업 사본**이다 — loadAll() 은 그대로 동기·오프라인 동작.
//    동기화는 ① 앱 시작 ② 🎨 편집창 열기 ③ 추가·수정·삭제·순서변경 직후에만 오간다.
//    서버가 꺼져 있거나 구버전이면 조용히 이 PC 것만 쓴다(작업이 막히지 않는다).
const SYNC_PATH = path.join(STORE_DIR, 'style-sync.json');   // { rev } — 마지막으로 맞춘 개정번호

function _loadSyncState() {
  try {
    if (fs.existsSync(SYNC_PATH)) {
      const d = JSON.parse(fs.readFileSync(SYNC_PATH, 'utf-8'));
      if (d && Number.isFinite(Number(d.rev))) return { rev: Number(d.rev) };
    }
  } catch (_) {}
  return { rev: null };                                       // null = 이 PC 는 아직 한 번도 안 맞췄다
}

function _saveSyncState(rev) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(SYNC_PATH, JSON.stringify({ rev: Number(rev) || 0, at: new Date().toISOString() }, null, 2), 'utf-8');
  } catch (e) { console.error('[style-store] 동기화 상태 저장 실패:', e.message); }
}

function _cleanList(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter((s) => s && typeof s === 'object' && String(s.id || '').trim() && String(s.name || '').trim() && String(s.prompt || '').trim())
    .map((s) => ({ id: String(s.id).trim(), name: String(s.name).trim(), prompt: String(s.prompt).trim() }));
}

/** 두 목록을 id 기준으로 합친다(어느 쪽도 잃지 않는다). prefer = 같은 id 일 때 이기는 쪽. */
function mergeStyles(serverList, localList, prefer = 'server') {
  const srv = _cleanList(serverList), loc = _cleanList(localList);
  const [first, second] = prefer === 'local' ? [loc, srv] : [srv, loc];
  const out = [], seen = new Set(), added = [];
  for (const s of first) if (!seen.has(s.id)) { seen.add(s.id); out.push(s); }
  for (const s of second) if (!seen.has(s.id)) { seen.add(s.id); out.push(s); added.push(s); }
  return { merged: out, added };
}

/** 순서 목록 합치기 — 앞 목록을 그대로 두고, 뒤 목록에만 있는 id 를 뒤에 붙인다. */
function mergeOrder(firstOrder, secondOrder) {
  const a = (Array.isArray(firstOrder) ? firstOrder : []).filter((x) => typeof x === 'string' && x.trim());
  const b = (Array.isArray(secondOrder) ? secondOrder : []).filter((x) => typeof x === 'string' && x.trim());
  const seen = new Set(a);
  return [...a, ...b.filter((x) => !seen.has(x))];
}

/** 서버 → 이 PC. 첫 동기화는 **합치고**(양쪽 스타일 보존) 그 뒤부터는 서버가 정본(삭제도 전파). */
async function pullFromServer(log = () => {}) {
  const ASR = require('../tts/asr-client');
  const r = await ASR.getSharedStyles();
  if (!r.ok) return { ok: false, error: r.error, unsupported: r.error === 'unsupported' };
  const local = _loadUserStyles(), localOrder = _loadOrder();
  const known = _loadSyncState().rev;

  if (known == null || r.rev === 0) {
    // 처음 맞추는 것(또는 서버가 아직 빈 상태) = 합집합. 여기서 서버를 그냥 덮어쓰면 아내 PC 의
    //   스타일이 사라지고, 서버로 그냥 덮어쓰면 내 스타일이 사라진다 → 합치고 올린다.
    const { merged, added } = mergeStyles(r.styles, local, 'server');
    const order = mergeOrder(r.order, localOrder);
    _saveUserStyles(merged); _saveOrder(order);
    if (added.length || r.rev === 0) {
      const w = await ASR.putSharedStyles({ styles: merged, order, baseRev: r.rev });
      if (w.ok) {
        _saveSyncState(w.rev);
        if (added.length) log(`☁ 이 PC 에만 있던 이미지 스타일 ${added.length}개를 공용 목록에 올렸습니다 — 이제 다른 PC 에서도 보입니다.`);
        return { ok: true, count: merged.length, pushed: added.length, rev: w.rev };
      }
      return { ok: true, count: merged.length, pushed: 0, warn: w.error };   // 로컬은 이미 합쳐 뒀다
    }
    _saveSyncState(r.rev);
    return { ok: true, count: merged.length, pushed: 0, rev: r.rev };
  }

  if (r.rev === known) return { ok: true, unchanged: true, count: local.length, rev: r.rev };
  const next = _cleanList(r.styles);
  _saveUserStyles(next);
  // 서버에 순서가 없으면 이 PC 순서를 유지한다(빈 값으로 멀쩡한 순서를 지우지 않게).
  if ((r.order || []).length) _saveOrder(r.order);
  _saveSyncState(r.rev);
  log(`☁ 공용 이미지 스타일을 받았습니다 — 사용자 스타일 ${next.length}개 (rev ${r.rev})`);
  return { ok: true, count: next.length, rev: r.rev, replaced: true };
}

/** 이 PC → 서버. 충돌(다른 PC 가 그 사이 저장)이면 합쳐서 한 번만 다시 시도한다.
 *  ⚠ 충돌 합치기에서는 **방금 이 PC 가 한 편집이 이긴다**. 대신 그 사이 다른 PC 가 추가한
 *    스타일도 함께 남는다(= 삭제한 것이 되살아날 수는 있다 — 잃는 것보다 낫다). */
async function pushToServer(log = () => {}) {
  const ASR = require('../tts/asr-client');
  const styles = _loadUserStyles(), order = _loadOrder();
  const known = _loadSyncState().rev;
  let w = await ASR.putSharedStyles({ styles, order, baseRev: known == null ? -1 : known });
  if (w.conflict) {
    const { merged } = mergeStyles(w.styles, styles, 'local');
    const order2 = mergeOrder(order, w.order);
    _saveUserStyles(merged); _saveOrder(order2);
    w = await ASR.putSharedStyles({ styles: merged, order: order2, baseRev: w.rev });
    if (w.ok) log('☁ 다른 PC 가 그 사이 바꾼 이미지 스타일과 합쳐서 저장했습니다.');
  }
  if (w.ok) { _saveSyncState(w.rev); return { ok: true, rev: w.rev, count: (w.styles || []).length }; }
  return { ok: false, error: w.error, unsupported: w.error === 'unsupported' };
}

module.exports = { loadAll, getById, getPrompt, isBuiltIn, add, update, remove, setOrder, moveStyle, STORE_PATH, BUILT_IN_STYLES,
  pullFromServer, pushToServer, mergeStyles, mergeOrder, SYNC_PATH };
