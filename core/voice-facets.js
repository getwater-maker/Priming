'use strict';
/**
 * voice-facets.js — 🔊 목소리 카드의 **성별 · 연령대** 판별(음성 설정 팝업의 거르기용 · 2026-10-06 로이 「언어·성별·연령대로 구분해서」)
 *   엔진마다 주는 정보가 달라(타입캐스트 age/gender · ElevenLabs labels · Gemini/MAI 설명 · OmniVoice 는 참조음성 이름뿐) 한 곳에서 같은 말로 맞춘다.
 *   · 성별 genderOf(v) → 'male' | 'female' | ''  (칸 값 → 이름·설명의 낱말 순. 「female」이 「male」을 품으니 여성부터 본다)
 *   · 연령대 ageOf(v) → 'child'(어린이·청소년) | 'young'(청년) | 'middle'(중년) | 'old'(노년) | ''(표시 없음)
 *   ⚠ 순수 함수 — 렌더러 번들에 들어간다(fs·CJS 런타임 참조 금지).
 */
const AGE_LABEL = { child: '어린이·청소년', young: '청년', middle: '중년', old: '노년' };
const AGE_ORDER = ['child', 'young', 'middle', 'old'];

function genderOf(v) {
  const g = String((v && v.gender) || '').trim().toLowerCase();
  if (g === 'male' || g === 'm' || g === '남' || g === '남성') return 'male';
  if (g === 'female' || g === 'f' || g === '여' || g === '여성') return 'female';
  const t = [v && v.name, v && v.desc].filter(Boolean).join(' ').toLowerCase();
  if (/여성|여자|\bfemale\b|\bwoman\b|\bgirl\b|(^|[_\s-])여([_\s-]|$)/.test(t)) return 'female';
  if (/남성|남자|\bmale\b|\bman\b|\bboy\b|(^|[_\s-])남([_\s-]|$)/.test(t)) return 'male';
  return '';
}

function ageOf(v) {
  if (!v) return '';
  if (AGE_LABEL[v.age]) return v.age;   // 사람이 분류해 둔 값(OmniVoice 분류 저장소)은 그대로
  const t = [v.age, v.name, v.desc].filter(Boolean).join(' ').toLowerCase().replace(/[_-]/g, ' ');
  if (/어린이|아이|유아|소년|소녀|청소년|10대|십대|\bchild(ren)?\b|\bkid\b|\bteen(ager)?s?\b|\byouth\b(?! ?ful)/.test(t)) return 'child';
  if (/중년|장년|40대|50대|사십|오십|middle ?aged?|\bmature\b|성숙/.test(t)) return 'middle';   // 「middle aged」가 「aged」로 노년이 되지 않게 노년보다 먼저
  if (/노년|노인|할아버지|할머니|60대|70대|\bold\b|\belder(ly)?\b|\bsenior\b/.test(t)) return 'old';
  if (/청년|젊|20대|30대|이십|삼십|\byoung\b|\byoung ?adult\b|\byouthful\b/.test(t)) return 'young';
  return '';
}

/** 목록에서 성별·연령대별 개수(선택지에 「(n)」으로 보여 주기) */
function facetCounts(list) {
  const out = { gender: { male: 0, female: 0, none: 0 }, age: { child: 0, young: 0, middle: 0, old: 0, none: 0 } };
  for (const v of list || []) {
    const g = genderOf(v), a = ageOf(v);
    out.gender[g || 'none']++; out.age[a || 'none']++;
  }
  return out;
}

/** 거르기 판정 — fg: ''|male|female|none · fa: ''|child|young|middle|old|none */
function matchFacets(v, fg, fa) {
  if (fg) { const g = genderOf(v); if (fg === 'none' ? g : g !== fg) return false; }
  if (fa) { const a = ageOf(v); if (fa === 'none' ? a : a !== fa) return false; }
  return true;
}

module.exports = { genderOf, ageOf, facetCounts, matchFacets, AGE_LABEL, AGE_ORDER };
