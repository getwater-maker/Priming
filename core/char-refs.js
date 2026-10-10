// core/char-refs.js
// ─────────────────────────────────────────────────────────────────────────────
// 👤 인물 일관성 — 나노바나나(Gemini 이미지 API) 전용. 대본의 인물 카드 → 인물 시트 그림 → 장면마다 참조로 첨부.
//   근거: 2026-10-05 다된다윤 오토 분석 + [고전_1021] 실험(작업노트 2026-10 「인물 참조 실험」).
//   · 인물 카드 = 대본 메타 `> 🎨 〔일관성 앵커〕 … 알리사 카드: <영어 묘사> (한국어 메모). 제롬 카드: …`
//     (아도나이로이 대본 167편이 이미 이 형식 — 대본을 새로 고칠 필요 없음)
//   · 시트 = <출력>/characters/<이름>.png (사람이 같은 이름의 jpg/png/webp 로 바꿔 넣으면 그 그림을 쓴다)
//   · 장면 배역 = 그룹 낭독에 카드 이름이 나오고, 그림 프롬프트에 같은 성별의 사람 낱말이 있을 때.
//     같은 이름 카드가 여럿(젊은 파스칼·만년 파스칼)이면 그림 프롬프트와 낱말이 가장 많이 겹치는 카드.
//   ⛔ Krea2·Flow 등 다른 엔진에는 쓰지 않는다(참조 그림을 받지 않거나 실험상 품질이 떨어졌다).
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const MAX_REFS = 3;
// 그림 프롬프트에서 「그 성별의 사람이 있나·몇 명인가」를 보는 낱말
const FEMALE = /\b(woman|women|girl|lady|wife|mother|queen|princess|empress|nun|widow|daughter|sister|maid|bride|grandmother|laundress)\b/i;
const MALE = /\b(man|men|boy|king|husband|father|nobleman|prince|emperor|monk|priest|pastor|son|brother|gentleman|lord|grandfather|soldier|writer|officer|official|merchant|farmer|peasant|scholar|poet|painter|doctor|judge|general|duke|count|baron|clerk|knight|sailor|fisherman|assassin)\b/i;
const PERSON = new RegExp(FEMALE.source + '|' + MALE.source + '|\\b(person|people|figure|child|children)\\b', 'i');
// 카드 묘사의 성별 단서(옷·수염 · 한국어 묘사 카드도 있다)
const F_CUE = /\b(dress|gown|skirt|bonnet)\b|여자|여인|여성|소녀|아내|어머니|부인|왕비|공주|딸|누이|할머니/i;
const M_CUE = /\b(beard|bearded|moustache|mustache|whiskers)\b|남자|사내|남성|소년|아버지|아들|국왕|임금|선비|할아버지/i;
const STOP = new Set('a an the of and with in on at to by for his her its their about years old year very young'.split(' '));

function _genderOf(desc) {
  const f = FEMALE.test(desc), m = MALE.test(desc);
  if (f !== m) return f ? 'f' : 'm';
  const fc = F_CUE.test(desc), mc = M_CUE.test(desc);
  return fc && !mc ? 'f' : (mc && !fc ? 'm' : '');
}
// 카드 이름 속 꾸밈말 — 「젊은 파스칼」「멜빌 만년」「러시아 장군」에서 사람을 가리키지 않는 낱말(낭독에서 이것만으로 찾지 않는다)
const NAME_STOP = new Set('젊은 어린 늙은 만년 말년 말년의 만년의 청년 청년기 소년 소년기 소녀기 노년 노년기 장년 장년기 중년 젊은날 어린시절 러시아 프랑스 영국 독일 중국 일본 조선 미국 이탈리아 스페인 그리스 로마 사람 남자 여자 이야기 노인 여인 청년 아이 시절 무렵 당시'.split(' '));
function _nameTokens(name) { return String(name).split(/[ ·]+/).filter((t) => t.length >= 2 && !NAME_STOP.has(t)); }
function _coreOf(name) { return _nameTokens(name)[0] || String(name).trim(); }
function _words(s) {
  return String(s || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !STOP.has(w));
}
function _overlap(desc, prompt) {
  const dw = [...new Set(_words(desc))]; if (!dw.length) return 0;
  const pw = new Set(_words(prompt));
  return dw.filter((w) => pw.has(w)).length / dw.length;
}

/**
 * 대본 원문에서 인물 카드를 뽑는다.
 * @returns {{name:string, core:string, desc:string, gender:'f'|'m'|''}[]}
 */
function parseCards(mdText) {
  const out = [];
  const seen = new Set();
  for (const raw of String(mdText || '').split(/\r?\n/)) {
    if (!/^\s*>/.test(raw) || !/카드/.test(raw)) continue;
    let line = raw.replace(/^\s*>\s*/, '');
    // 2026-08 형식: 「**인물카드** — 〔표도르 도스토옙스키〕 **male**, 41세→59세, …; 〔안나〕 **female**, …」
    const aug = line.match(/인물\s*카드\**\s*[—\-:：]\s*(.*)$/);
    if (aug && /〔[^〕]+〕\s*\**\s*(?:male|female)/i.test(aug[1])) {
      const re3 = /〔([^〕]{1,20})〕\s*\**\s*(male|female)\s*\**\s*[,，]?\s*([^〔]*)/gi; let m3;
      while ((m3 = re3.exec(aug[1]))) {
        const name = m3[1].trim();
        let desc = m3[3].split(/\s⛔|\s\*\*복식|\s\*\*소품/)[0].replace(/\*\*/g, '').replace(/\s+/g, ' ').replace(/[\s.,;·]+$/, '').trim().slice(0, 400);
        if (!name || !desc || seen.has(name)) continue;
        seen.add(name);
        out.push({ name, core: _coreOf(name), desc, gender: /^f/i.test(m3[2]) ? 'f' : 'm' });
      }
      continue;
    }
    // 2026-08 중순 형식: 「인물 카드 5명 고정 = 소포클레스(`an elderly Greek man …`) / …」·「인물 카드 = 멜빌 만년(한국어 묘사) · …」
    const eq = line.match(/인물\s*카드[^=]{0,12}=\s*(.*)$/);
    const before4 = out.length;
    if (eq && /\(/.test(eq[1])) {
      const re4 = /([^()·/=;]{1,20}?)\s*\(\s*`?([^()]+?)`?\s*\)/g; let m4;
      while ((m4 = re4.exec(eq[1]))) {
        const name = m4[1].replace(/[`*]/g, '').trim(), desc = m4[2].replace(/\s+/g, ' ').trim();
        if (!name || !/^[가-힣A-Za-z0-9 ]+$/.test(name) || !desc || seen.has(name)) continue;
        seen.add(name);
        out.push({ name, core: _coreOf(name), desc, gender: _genderOf(desc) });
      }
      if (out.length > before4) continue;
    }
    // 옛 형식(2026-09 초): 「인물 카드 — **히스클리프**: 한국어 묘사. **말년의 히스클리프**: …」
    const old = line.match(/인물\s*카드\s*[—\-:：]?\s*(.*)$/);
    if (old && /\*\*/.test(old[1])) {
      const re2 = /\*\*([^*]{1,15})\*\*\s*[:：]\s*([^*]+?)(?=\s*\*\*|$)/g; let m2;
      while ((m2 = re2.exec(old[1]))) {
        const name = m2[1].trim(), desc = m2[2].replace(/\s+/g, ' ').replace(/[\s.,;·]+$/, '').trim();
        if (!name || !desc || seen.has(name)) continue;
        seen.add(name);
        out.push({ name, core: _coreOf(name), desc, gender: _genderOf(desc) });
      }
      if (out.length > before4) continue;
    }
    for (let i = 0; i < 3; i++) line = line.replace(/[(（][^()（）]*[)）]/g, ' ');   // 한국어 메모 괄호 제거(중첩 대비 3번)
    const re = /카드\s*:/g; let m;
    const hits = [];
    while ((m = re.exec(line))) hits.push({ at: m.index, end: re.lastIndex });
    hits.forEach((h, i) => {
      const before = line.slice(0, h.at);
      const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf(': '), before.lastIndexOf('〕'), before.lastIndexOf('·'));
      const name = before.slice(cut + 1).replace(/^[\s.:〕·]+/, '').trim();
      if (!name || name.length > 15 || !/^[가-힣A-Za-z0-9 ]+$/.test(name)) return;
      let desc = line.slice(h.end, i + 1 < hits.length ? hits[i + 1].at : undefined);
      const ko = desc.search(/[가-힣]/);                       // 영어 묘사는 다음 한국어 문장 앞에서 끝난다
      if (ko >= 0) desc = desc.slice(0, ko);
      desc = desc.replace(/\s+/g, ' ').replace(/[\s.,;·]+$/, '').trim();
      if (!/[a-z]{3}/i.test(desc) || seen.has(name)) return;
      seen.add(name);
      out.push({ name, core: _coreOf(name), desc, gender: _genderOf(desc) });
    });
  }
  return out;
}

/**
 * 이 장면에 보이는 인물 카드(최대 3).
 * @param {string} narration 그룹 낭독 글
 * @param {string} imagePrompt 그룹 그림 프롬프트(영어)
 */
function castFor(narration, imagePrompt, cards) {
  const text = String(narration || '');
  const prompt = String(imagePrompt || '');
  const byCore = new Map();
  for (const c of cards || []) {
    const full = text.includes(c.name);
    const tokens = _nameTokens(c.name);   // 「안나 그리고리예브나」는 낭독에서 「안나」로도 불린다 · 꾸밈말(만년·젊은)로는 찾지 않는다
    if (!full && !tokens.some((t) => text.includes(t))) continue;
    if (c.gender === 'f' && !FEMALE.test(prompt)) continue;   // 그림에 여자가 없으면 여자 인물은 붙이지 않는다
    if (c.gender === 'm' && !MALE.test(prompt)) continue;
    if (!c.gender && !PERSON.test(prompt)) continue;            // 성별 모르는 카드는 그림에 사람이 있을 때만
    const score = (full ? 1 : 0) + _overlap(c.desc, prompt);
    const cur = byCore.get(c.core);
    if (!cur || score > cur.score) byCore.set(c.core, { card: c, score });
  }
  // 그림에 여자가 한 명이면 여자 카드도 하나만 — 낭독에 이름만 나온 다른 여자를 붙이지 않는다(묘사가 가장 잘 맞는 쪽)
  const room = { f: _count(FEMALE, prompt), m: _count(MALE, prompt) };
  const used = { f: 0, m: 0 };
  return [...byCore.values()].sort((a, b) => b.score - a.score).filter(({ card }) => {
    const g = card.gender; if (!g) return true;
    if (used[g] >= Math.max(1, room[g])) return false;
    used[g]++; return true;
  }).slice(0, MAX_REFS).map((x) => x.card);
}
function _count(re, s) { return (String(s).match(new RegExp(re.source, 'gi')) || []).length; }

function _safe(name) { return String(name).replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 40); }
function sheetDir(outRoot) { return path.join(outRoot, 'characters'); }
/** 있는 시트 경로(사람이 바꿔 넣은 jpg/webp 포함) 또는 null */
function findSheet(outRoot, card) {
  const base = path.join(sheetDir(outRoot), _safe(card.name));
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) { if (fs.existsSync(base + ext)) return base + ext; }
  return null;
}
function sheetBase(outRoot, card) { return path.join(sheetDir(outRoot), _safe(card.name)); }

// 시트는 얼굴을 크게 · 옷은 단순하게 — 실험에서 시트 옷이 장면으로 새는 일이 있었다(21번 잠옷 → 깃 셔츠).
function sheetPrompt(stylePrompt, card) {
  const style = stylePrompt ? String(stylePrompt).trim().replace(/[,\s]+$/, '') + ', ' : '';
  return `${style}character reference sheet of ${card.desc}. `
    + 'One person shown twice on a plain neutral light background: on the left a large head-and-shoulders portrait facing the viewer, '
    + 'on the right a small full-length standing figure of the same person. Plain simple clothing of the era implied by the description, '
    + 'neutral calm expression, even soft light. One person only, no other figures, no text, no labels, no letters, no watermark.';
}

/** 장면 프롬프트 끝에 붙이는 지시(나이·옷·머리는 장면을 따른다 — 이야기 속에서 나이가 바뀌기 때문) */
function directive(cast) {
  if (!cast || !cast.length) return '';
  const names = cast.map((c) => c.name).join(', ');
  return ` The attached reference images show ${names}. `
    + cast.map((c) => `${c.name} is ${c.desc}.`).join(' ') + ' '
    + 'Keep each referenced person\'s face, eyebrows, eye shape, hair colour and body build the same as their reference image so they are clearly the same person. '
    + 'Draw them at the age stated in this scene, and follow this scene for clothing, hairstyle, pose and expression — do not copy the clothing or plain background of the reference sheet. '
    + 'Use the art style described above. Do not redesign their faces.';
}

/** Gemini parts 앞에 붙는 참조 쌍(이름 글 → 그림) */
function refParts(cast, sheetOf) {
  const parts = [];
  for (const c of cast) {
    const p = sheetOf(c); if (!p) continue;
    const ext = path.extname(p).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : (ext === '.webp' ? 'image/webp' : 'image/png');
    parts.push({ text: `Reference image of "${c.name}" — this is what ${c.name} looks like:` });
    parts.push({ inlineData: { mimeType: mime, data: fs.readFileSync(p).toString('base64') } });
  }
  return parts;
}

// ─────────────────────────────────────────────────────────────────────────────
// 👤 Qwen-Image 2.1 참조(ComfyUI 로컬) — 2026-10-10 P0 시험(`docs/인물일관성-Qwen-설계.md` §8) 결과로 정한 규칙.
//   · 시트 = **얼굴만**(`<이름>.face.png`) — 얼굴+전신 시트는 흰 배경 초상이 장면에 그대로 붙었다(10장 중 4장).
//   · 🔴 **게이트가 핵심**: 참조는 얼굴이 보이는 샷(close-up·medium)에만 · 어린 인물(18세 미만)·카드 나이와 10살 이상
//     차이·3명 이상·군중이면 붙이지 않는다. 지시문으로는 이 사고(구도 쏠림·나이 무시·인원 늘어남)가 안 막혔다.
//   · **샷 크기 낱말이 없으면 붙이지 않는다(fail-closed)** — 옛 대본은 지금과 똑같이 글 카드만으로 그린다.
// ─────────────────────────────────────────────────────────────────────────────
const QWEN_MAX_REFS = 2;
const _NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function _ageWord(w) {
  const s = String(w || '').trim().toLowerCase();
  if (/^\d{1,2}$/.test(s)) return Number(s);
  let tot = 0;
  for (const t of s.split(/[\s-]+/)) { if (!(t in _NUM)) return tot || null; tot += _NUM[t]; }
  return tot || null;
}
// 「woman of sixty three」·「girl of about sixteen」·「man of 41」 — 사람 낱말 바로 뒤의 나이
const _AGE_RE = new RegExp('(' + FEMALE.source + '|' + MALE.source + ')\\s+of\\s+(?:about\\s+|around\\s+|roughly\\s+)?(\\d{1,2}|[a-z]+(?:[\\s-][a-z]+)?)', 'gi');
/** 글에서 [{gender:'f'|'m', age}] (나이를 못 읽은 사람은 빠진다) */
function agesIn(text) {
  const out = [];
  _AGE_RE.lastIndex = 0; let m;
  while ((m = _AGE_RE.exec(String(text || '')))) {
    const age = _ageWord(m[m.length - 1]);   // FEMALE/MALE 안에도 묶음이 있어 나이는 마지막 묶음이다
    if (age && age < 120) out.push({ gender: FEMALE.test(m[1]) ? 'f' : 'm', age });
  }
  return out;
}
function cardAge(card) { const a = agesIn(card && card.desc)[0]; return a ? a.age : null; }
/**
 * 장면에서 **이 카드 인물의** 나이 — 나이 낱말 주변 구간(앞 80·뒤 200자) 중 카드 묘사와 가장 많이 겹치는 곳.
 *   🔴 성별만 보고 첫 나이를 집으면 「동탁(50) + 조조(30)」 장면에서 조조를 50 으로 읽는다(채널사업부 제보 2026-10-10 · 삼국지 1부 G41).
 *   겹침이 약하거나(0.35 미만) 두 구간이 비기면 모른다(null — 나이로 막지 않는다).
 */
function sceneAgeOf(prompt, card) {
  const text = String(prompt || '');
  const cands = [];
  _AGE_RE.lastIndex = 0; let m;
  while ((m = _AGE_RE.exec(text))) {
    const g = FEMALE.test(m[1]) ? 'f' : 'm';
    if (card.gender && g !== card.gender) continue;
    const age = _ageWord(m[m.length - 1]);
    if (!age) continue;
    const win = text.slice(Math.max(0, m.index - 80), m.index + 200);
    cands.push({ age, score: _overlap(card.desc, win) });
  }
  cands.sort((a, b) => b.score - a.score);
  if (!cands.length || cands[0].score < 0.35) return null;
  if (cands[1] && cands[1].score === cands[0].score && cands[1].age !== cands[0].age) return null;
  return cands[0].age;
}
/**
 * Qwen 참조 배역 = castFor 중 **그림 프롬프트에 카드 묘사가 실제로 들어 있는** 인물만(겹침 0.6 이상) · 최대 2명.
 *   🔴 castFor 는 낭독에 이름이 나오고 그림에 그 성별이 있으면 넣는다 — 낭독에만 나오는 인물(조조)이 그림 속 다른 남자(동탁)
 *   자리에 참조로 붙어 얼굴을 바꾸거나 사람을 늘린다(채널사업부 제보 · 삼국지 1부 G26·G58). 대본은 카드 묘사를 컷마다 되풀이한다(§1-5).
 */
function qwenCast(narration, imagePrompt, cards) {
  return castFor(narration, imagePrompt, cards).filter((c) => _overlap(c.desc, imagePrompt) >= 0.6).slice(0, QWEN_MAX_REFS);
}
/** 그림 프롬프트의 샷 크기 — 'close' | 'medium' | 'wide' | null(낱말 없음) */
function shotOf(prompt) {
  const p = String(prompt || '').toLowerCase();
  if (/\b(wide shot|long shot|extreme wide|establishing shot|aerial|bird'?s[- ]eye|panoramic)\b/.test(p)) return 'wide';
  if (/\b(close[- ]up|portrait shot|head[- ]and[- ]shoulders)\b/.test(p)) return 'close';
  if (/\b(medium shot|medium close|mid shot|half[- ]length|waist[- ]up|medium[- ]wide)\b/.test(p)) return /medium[- ]wide/.test(p) ? 'wide' : 'medium';
  return null;
}
const CROWD = /\b(crowd|crowds|rows of|townspeople|villagers|soldiers|officials|courtiers|army|audience|onlookers|people)\b/i;
/**
 * 이 장면에 참조를 붙일지.  @returns {{ok:boolean, reason:string}}
 *   reason: 'no-shot'(샷 크기 낱말 없음) · 'wide' · 'crowd' · 'many'(3명 이상) · 'child' · 'age-gap'
 */
function refGate(prompt, cast) {
  const shot = shotOf(prompt);
  if (!shot) return { ok: false, reason: 'no-shot' };
  if (shot === 'wide') return { ok: false, reason: 'wide' };
  if (CROWD.test(prompt)) return { ok: false, reason: 'crowd' };
  if (_count(FEMALE, prompt) + _count(MALE, prompt) >= 3) return { ok: false, reason: 'many' };
  // 어린 사람이 그림에 하나라도 있으면 붙이지 않는다(P0: 참조가 아이 얼굴을 성인 쪽으로 끌었다 · 누구의 나이든)
  if (agesIn(prompt).some((a) => a.age < 18)) return { ok: false, reason: 'child' };
  for (const c of cast || []) {
    const sa = sceneAgeOf(prompt, c);                   // 이 인물의 장면 나이(모르면 카드 나이대로 본다)
    const ca = cardAge(c);
    if (sa && ca && Math.abs(ca - sa) >= 10) return { ok: false, reason: 'age-gap' };
  }
  return { ok: true, reason: shot };
}
function faceSheetBase(outRoot, card) { return path.join(sheetDir(outRoot), _safe(card.name) + '.face'); }
/** 얼굴 시트(사람이 바꿔 넣은 jpg/webp 포함) 또는 null */
function findFaceSheet(outRoot, card) {
  const base = faceSheetBase(outRoot, card);
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) { if (fs.existsSync(base + ext)) return base + ext; }
  return null;
}
// 얼굴만 — 옷·배경이 장면으로 새지 않게(P0: 전신 시트는 흰 배경 초상이 장면에 붙었다)
function faceSheetPrompt(stylePrompt, card) {
  const style = stylePrompt ? String(stylePrompt).trim().replace(/[,\s]+$/, '') + ', ' : '';
  return `${style}character reference portrait of ${card.desc}. A large head-and-shoulders portrait facing the viewer `
    + 'on a plain neutral light background, neutral calm expression, even soft light, a bare simple collar only. '
    + 'One person only, no other figures, no text, no letters, no watermark.';
}
/** Qwen 장면 프롬프트 끝 지시 — 참조 그림은 순서로만 구별된다(이름-그림 쌍을 못 붙인다) */
function qwenDirective(cast) {
  if (!cast || !cast.length) return '';
  return ' ' + cast.map((c, i) => `Reference image ${i + 1} is ${c.name}.`).join(' ') + ' '
    + cast.map((c) => `${c.name} is ${c.desc}.`).join(' ') + ' '
    + 'Keep each referenced person\'s face, eyebrows, eye shape, hair colour and body build the same as in their reference image so they are clearly the same person. '
    + 'Draw them at the age stated in this scene, and follow this scene for clothing, hairstyle, pose, gaze and expression - do not copy the clothing, pose or plain background of the reference. '
    + 'Use the art style described above. Do not redesign their faces.';
}

module.exports = { parseCards, castFor, sheetDir, findSheet, sheetBase, sheetPrompt, directive, refParts, MAX_REFS,
  QWEN_MAX_REFS, agesIn, cardAge, sceneAgeOf, qwenCast, shotOf, refGate, faceSheetBase, findFaceSheet, faceSheetPrompt, qwenDirective };
