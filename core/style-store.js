/**
 * 이미지 스타일 프리셋 스토어
 * 위치: ~/.flow-app/styles.json (모든 스타일)
 *
 * 정책(2026-09-16 로이: "모두 동일한 기준으로 — 기본도 수정·삭제가 되게"):
 *  - **기본/사용자 구분이 없다.** 스타일은 전부 같은 파일에 있고 전부 수정·삭제·순서변경이 된다.
 *  - 코드의 `BUILT_IN_STYLES` 는 이제 **최초 1회 씨앗**일 뿐이다 — `_ensureSeeded()` 가 그 목록을
 *    styles.json 에 한 번 옮겨 심고(`styles-seeded.json` 플래그), 그 뒤로는 아무도 강제로 되살리지 않는다.
 *    🔑 그래서 **지운 스타일이 다음 실행에 되살아나지 않는다** — 씨앗을 매번 합치면 삭제가 무의미해진다.
 *  - ⚠ 씨앗 심기는 **dirty 표시를 남긴다**(아래 `_markDirty`). 안 그러면 앱 시작 때 도는 서버 pull 이
 *    「서버가 정본」 분기로 들어가 방금 심은 목록을 통째로 지운다 → 합치기 경로로 유도해 서버에도 올린다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const STORE_DIR = path.join(os.homedir(), '.flow-app');
const STORE_PATH = path.join(STORE_DIR, 'styles.json');
const ORDER_PATH = path.join(STORE_DIR, 'style-order.json');

// 씨앗 스타일 28개 — flow-engine.js 의 옛 STYLE_PROMPTS 객체에서 이관.
//   ⚠ 이 목록은 **처음 한 번만** styles.json 으로 옮겨 심는다(그 뒤엔 사용자가 자유롭게 고치고 지운다).
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

const SEED_PATH = path.join(STORE_DIR, 'styles-seeded.json');   // { seeded:true } — 씨앗을 한 번 심었다는 표시
let _seedChecked = false;   // 이 프로세스에서 이미 확인함(파일 존재 검사도 한 번이면 족하다)
let _seedOk = false;        // 심기(또는 이미 심어져 있음)가 확인됐다 → 아래 '보충' 안전망을 끈다

/** 파일을 읽기만 한다(씨앗 심기를 거치지 않는 원시 읽기 — `_ensureSeeded` 안에서 쓴다). */
function _readStylesFile() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.error('[style-store] 스타일 로드 실패:', e.message);
  }
  return [];
}

/**
 * 씨앗 스타일을 **최초 1회만** styles.json 에 옮겨 심는다.
 * 🔑 여기(파일 읽기)에서 하는 이유: loadAll 뿐 아니라 **서버 pull/push 도** 같은 상태를 봐야 한다.
 *   한쪽만 심으면 「화면엔 있는데 서버엔 없다」가 되어 다른 PC 에서 스타일이 사라진다.
 */
function _ensureSeeded() {
  if (_seedChecked) return;
  _seedChecked = true;
  try {
    if (fs.existsSync(SEED_PATH)) { _seedOk = true; return; }
    const cur = _readStylesFile();
    const have = new Set(cur.map((s) => s && s.id).filter(Boolean));
    const seeds = BUILT_IN_STYLES.filter((s) => !have.has(s.id)).map((s) => ({ id: s.id, name: s.name, prompt: s.prompt }));
    fs.mkdirSync(STORE_DIR, { recursive: true });
    if (seeds.length) {
      fs.writeFileSync(STORE_PATH, JSON.stringify([...seeds, ...cur], null, 2), 'utf-8');
      _markDirty();   // ⚠ 서버 pull 이 이 목록을 통째로 지우지 않게 — 합치기 경로로 유도한다
    }
    fs.writeFileSync(SEED_PATH, JSON.stringify({ seeded: true, count: seeds.length, at: new Date().toISOString() }, null, 2), 'utf-8');
    _seedOk = true;
  } catch (e) {
    console.error('[style-store] 기본 스타일 이관 실패:', e.message);   // _seedOk=false → loadAll 이 보충한다
  }
}

function _loadUserStyles() {
  _ensureSeeded();
  return _readStylesFile();
}

function _saveUserStyles(userStyles) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(userStyles, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[style-store] 스타일 저장 실패:', e.message);
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

/** 모든 스타일 반환(전부 수정·삭제 가능).
 *  ~/.flow-app/style-order.json 이 있으면 그 순서대로, 없는 항목은 파일에 있는 순서 그대로 뒤에.
 *  ⚠ `isBuiltIn` 필드는 **호환을 위해 남겨 둔 표시**일 뿐 권한과 무관하다(채널 화풍 내보내기·대시보드가 읽는다).
 *    씨앗 심기가 실패한 PC(홈 폴더 쓰기 불가)에서만 true 인 항목이 보인다. */
function loadAll() {
  const user = _loadUserStyles();
  const all = [], seen = new Set();
  for (const u of user) {
    if (!u || !u.id || seen.has(u.id)) continue;   // 같은 id 가 두 번 있으면 앞엣것만(서버 합치기 잔재 방어)
    seen.add(u.id);
    all.push({ ...u, isBuiltIn: false });
  }
  // 안전망 — 씨앗을 못 심은 경우(파일 쓰기 실패)에만 코드의 목록으로 보충한다.
  //   🔑 심기에 성공했으면 **보충하지 않는다** — 안 그러면 사용자가 지운 스타일이 매번 되살아난다.
  if (!_seedOk) {
    for (const b of BUILT_IN_STYLES) if (!seen.has(b.id)) { seen.add(b.id); all.push({ ...b, isBuiltIn: true }); }
  }
  const order = _loadOrder();
  const indexOf = id => {
    const i = order.indexOf(id);
    return i < 0 ? Infinity : i;
  };
  const pos = new Map(all.map((s, i) => [s.id, i]));
  all.sort((a, b) => {
    const ia = indexOf(a.id), ib = indexOf(b.id);
    if (ia !== ib) return ia - ib;
    return pos.get(a.id) - pos.get(b.id);        // 순서 파일에 없으면 파일에 적힌 순서 그대로(안정 정렬)
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

/** 코드의 씨앗 목록에 있는 id 인가 — **권한 판정이 아니다**(수정·삭제는 누구나 된다).
 *  씨앗 심기 전(또는 실패)에 그 항목을 고치면 `update` 가 파일로 승격시키는 데만 쓴다. */
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

/** 스타일 수정 — **기본·사용자 구분 없이** 전부 된다(로이 2026-09-16).
 *  ⚠ 씨앗 심기가 실패한 PC 에서는 그 항목이 파일에 없다 → 그때만 파일로 **승격**해 고친다
 *    (안 그러면 그 PC 에서는 기본 스타일 수정이 조용히 실패한다). */
function update(id, patch) {
  const user = _loadUserStyles();
  let idx = user.findIndex(s => s.id === id);
  if (idx < 0) {
    const seed = BUILT_IN_STYLES.find(s => s.id === id);
    if (!seed) return null;
    user.push({ id: seed.id, name: seed.name, prompt: seed.prompt });
    idx = user.length - 1;
  }
  const updated = {
    ...user[idx],
    ...(patch.name != null ? { name: String(patch.name).trim() } : {}),
    ...(patch.prompt != null ? { prompt: String(patch.prompt).trim() } : {}),
  };
  user[idx] = updated;
  _saveUserStyles(user);
  return { ...updated, isBuiltIn: false };
}

/** 스타일 삭제 — **기본·사용자 구분 없이** 전부 된다. 씨앗은 다시 심지 않으므로 되살아나지 않는다. */
function remove(id) {
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
      if (d && Number.isFinite(Number(d.rev))) return { rev: Number(d.rev), dirty: !!d.dirty };
    }
  } catch (_) {}
  return { rev: null, dirty: false };                         // null = 이 PC 는 아직 한 번도 안 맞췄다
}

// dirty = 서버로 아직 못 올라간 로컬 편집이 있다(push 실패). 이 표시가 있으면 pull 이
//   서버본으로 **통째 교체하지 않고** 합쳐서 다시 올린다 — 오프라인 편집이 소리 없이 사라지는 것 방지(2026-08-22).
function _saveSyncState(rev, dirty = false) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(SYNC_PATH, JSON.stringify({ rev: Number(rev) || 0, dirty: !!dirty, at: new Date().toISOString() }, null, 2), 'utf-8');
  } catch (e) { console.error('[style-store] 동기화 상태 저장 실패:', e.message); }
}

// push 실패 표시만 세운다(rev 는 그대로) — 다음 pull/push 기회에 로컬 편집을 되살려 올리기 위한 기억.
function _markDirty() {
  const st = _loadSyncState();
  _saveSyncState(st.rev == null ? 0 : st.rev, true);
  // ⚠ rev=null 이던 PC 는 0 으로 기록되지만, 0 은 pull 의 union 분기(r.rev===0 아님 → 정본 교체)로 가지 않고
  //   dirty 가드가 합치기로 이끈다 — 어느 쪽이든 로컬 편집은 살아남는다.
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

  const st = _loadSyncState();
  if (r.rev === known) {
    // 밀린 로컬 편집(dirty = 지난 push 실패)이 있으면 이번 기회에 올린다 —
    //   ☁ 동기화가 안내문대로 「받기 + 올리기」 둘 다 하게(예전엔 받기만 해서 실패분이 영영 안 올라갔다).
    if (st.dirty) {
      const w = await pushToServer(log);
      if (w.ok) { log('☁ 지난번에 못 올린 이미지 스타일 편집을 서버에 올렸습니다.'); return { ok: true, count: _loadUserStyles().length, rev: w.rev, pushedDirty: true }; }
    }
    return { ok: true, unchanged: true, count: local.length, rev: r.rev };
  }
  if (st.dirty) {
    // 🔴 서버가 앞섰는데 이 PC 에도 못 올린 편집이 있다 — 통째 교체하면 그 편집이 소리 없이 사라진다
    //   (실사고 경로: 서버 꺼짐 → 편집(push 실패) → 다른 PC 가 편집 → 이 PC pull 이 통째 교체).
    //   → 합쳐서(로컬 우선 = 충돌 정책과 동일) 서버로 되올린다.
    const { merged } = mergeStyles(r.styles, local, 'local');
    const order2 = mergeOrder(localOrder, r.order);
    _saveUserStyles(merged); if (order2.length) _saveOrder(order2);
    const w = await ASR.putSharedStyles({ styles: merged, order: order2, baseRev: r.rev });
    if (w.ok) { _saveSyncState(w.rev, false); log('☁ 서버 변경분과 이 PC 의 못 올린 편집을 합쳐 저장했습니다.'); return { ok: true, count: merged.length, rev: w.rev, mergedDirty: true }; }
    _saveSyncState(r.rev, true);   // rev 는 맞추되 dirty 유지 — 다음 기회에 다시 올린다(로컬엔 이미 합쳐 둠)
    return { ok: true, count: merged.length, rev: r.rev, warn: w.error };
  }
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
  let known = _loadSyncState().rev;
  // 🔴 rev 를 모르는 PC(첫 동기화 전·style-sync.json 소실)가 baseRev -1(무검사 덮어쓰기)로 밀면
  //   서버의 남의 스타일이 통째로 지워질 수 있다(2026-08-22) → 먼저 pull(union)로 rev 를 확보한 뒤 올린다.
  if (known == null) {
    const p = await pullFromServer(log);
    if (!p.ok) { _markDirty(); return { ok: false, error: p.error, unsupported: !!p.unsupported }; }
    known = _loadSyncState().rev;
    if (known == null) { _markDirty(); return { ok: false, error: 'rev 확보 실패' }; }
  }
  const styles = _loadUserStyles(), order = _loadOrder();
  let w = await ASR.putSharedStyles({ styles, order, baseRev: known });
  if (w.conflict) {
    const { merged } = mergeStyles(w.styles, styles, 'local');
    const order2 = mergeOrder(order, w.order);
    _saveUserStyles(merged); _saveOrder(order2);
    w = await ASR.putSharedStyles({ styles: merged, order: order2, baseRev: w.rev });
    if (w.ok) log('☁ 다른 PC 가 그 사이 바꾼 이미지 스타일과 합쳐서 저장했습니다.');
  }
  if (w.ok) { _saveSyncState(w.rev, false); return { ok: true, rev: w.rev, count: (w.styles || []).length }; }
  _markDirty();   // 못 올렸다 — pull 이 통째 교체로 이 편집을 지우지 않도록 기억해 둔다
  return { ok: false, error: w.error, unsupported: w.error === 'unsupported' };
}

module.exports = { loadAll, getById, getPrompt, isBuiltIn, add, update, remove, setOrder, moveStyle, STORE_PATH, SEED_PATH, BUILT_IN_STYLES,
  pullFromServer, pushToServer, mergeStyles, mergeOrder, SYNC_PATH };
