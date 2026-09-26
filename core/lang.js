/**
 * lang.js — 글자로 언어를 가른다(일본어·베트남어 지원, 2026-09-26).
 *
 * 🔑 한국어 경로를 한 글자도 바꾸지 않기 위한 문지기다.
 *   한글이 한 글자라도 있으면 언제나 'ko' 이고, 새 규칙(일본어 자막 줄 나누기·전각 부호 분리·
 *   베트남어 글자 세기 등)은 이 함수가 'ja'·'cjk'·'vi' 를 돌려줄 때만 탄다.
 *   그 밖(영어·숫자만·알 수 없음)은 null — 호출하는 쪽은 옛 동작을 그대로 쓴다.
 *
 * ⚠ 렌더러 번들에도 들어간다 — 「직접 실행 시 자기검사」 같은 CJS 런타임 참조를 두지 말 것.
 */

const RE_HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/;
const RE_KANA = /[぀-ゟ゠-ヿㇰ-ㇿｦ-ﾟ]/;
const RE_HAN = /[㐀-䶿一-鿿豈-﫿]/;
// 베트남어에만 쓰이는 글자 — 프랑스어 등과 겹치는 à·é 같은 글자는 넣지 않는다(오판 방지).
const RE_VI = /[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/;

/** 'ko' | 'ja'(가나 있음) | 'cjk'(한자만) | 'vi' | null */
function detectLang(text) {
  const s = String(text == null ? '' : text);
  if (!s) return null;
  if (RE_HANGUL.test(s)) return 'ko';
  if (RE_KANA.test(s)) return 'ja';
  if (RE_HAN.test(s)) return 'cjk';
  if (RE_VI.test(s)) return 'vi';
  return null;
}

/** 띄어쓰기 없이 글자 단위로 줄을 나눠야 하는 언어인가(일본어·한자) */
const isCjkLang = (l) => l === 'ja' || l === 'cjk';
/** 새 규칙을 타는 언어인가 — 한국어·영어·알 수 없음은 false(옛 동작) */
const isForeignLang = (l) => l === 'ja' || l === 'cjk' || l === 'vi';

/**
 * TTS 로 보낼 language 값.
 *   채널이 ko 가 아닌 언어를 지정했으면 그 값. 아니면(ko·미지정) 문장이 일본어·베트남어로 보일 때만 그 언어.
 *   🔑 한국어 문장은 언제나 채널 값 그대로 → 캐시 키가 바뀌지 않는다.
 *   ⚠ 베트남어는 language 를 안 주면 한국어처럼 뭉개진다(2026-09-26 실측) — 그래서 문장 판별도 쓴다.
 */
function ttsLangFor(text, channelLang) {
  if (channelLang && channelLang !== 'ko') return channelLang;
  const l = detectLang(text);
  if (l === 'ja' || l === 'vi') return l;
  return channelLang;   // 🔑 받은 값 그대로(undefined 면 undefined) — 합성 인자가 한 글자도 안 바뀐다
}

/** 채널 언어 선택지 — 채널편집·업로드 언어가 같은 목록을 쓴다 */
const CHANNEL_LANGS = [
  { id: 'ko', label: '한국어' },
  { id: 'ja', label: '日本語 (일본어)' },
  { id: 'vi', label: 'Tiếng Việt (베트남어)' },
  { id: 'en', label: 'English' },
];

module.exports = { detectLang, isCjkLang, isForeignLang, ttsLangFor, CHANNEL_LANGS, RE_HANGUL, RE_KANA, RE_HAN, RE_VI };
