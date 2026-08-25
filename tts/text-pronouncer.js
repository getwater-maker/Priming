/**
 * text-pronouncer.js — OmniVoice 합성 직전 텍스트 가공
 *
 * 🔑 자막과 TTS 는 같은 대본 문장(sentence.text)에서 갈라진다.
 *      자막 : 원문 그대로              (vrew-builder → splitCaptionLines(s.text))
 *      TTS  : processForTTS() 결과     (tts-manager.synthesize · TTS 캐시 키)
 *   그래서 "읽는 법"만 여기서 바꾸면 자막은 손대지 않고 발음만 교정된다.
 *
 * 🔴 2026-08-25 — **아라비아 숫자를 한글로 바꾸지 않는다** (옛 동작 제거).
 *   예전엔 한자어 단위(년/월/일/회/…) 앞 숫자를 "십이년" 처럼 한글로 바꿨다. 그 근거는
 *   "OmniVoice 가 숫자를 못 읽는다" 였는데, 현재 서버로 실측하니 **거짓**이었다.
 *   방법 = 합성 → ASR 전사 비교 (23조 · 약 50클립 · 목소리 02_저음 2단계):
 *     · 화이트리스트 단위 11개(회·차·등·호·위·도·분·초·세기·세대·세) 전수 —
 *       숫자 입력과 정답 한글 입력의 전사가 **11/11 일치**.
 *     · 모델이 고유어/한자어를 문맥으로 스스로 가린다: "5개"→「다섯 개」 · "23살"→「스물세 살」
 *       · "2시 30분"→「두 시 삼십 분」 · "1000명"→「천 명」 · "1592년 4월 13일" 정확.
 *     · 🔑 판정력 검증(이게 없으면 위 표는 헛단언) — ASR 은 자리읽기를 구분해 낸다:
 *       "일영영영"→`1-0-0-0…` · "일이년"→`1, 2년` · "이삼 살"→`2, 3살`.
 *       그런데 숫자 입력은 정답 한글과 **같은 전사**가 나왔다 = 정확히 읽는다는 뜻.
 *     · 🔴 강제 변환은 오히려 해롭다: "오개를 받았다" → 들림 **「옥외를 받았다」**.
 *       "3번"→"삼번" 으로 고정하면 모델이 문맥상 「세 번」을 고를 여지까지 없앤다.
 *   ⇒ 대본에는 숫자를 **아라비아 숫자로** 쓴다(자막이 자연스러워지고 TTS 도 정확하다).
 *     「세 번」처럼 고유어로 읽혀야 하는 예외만 대본에 한글로 쓴다. → docs/대본-작성-가이드.md
 *   ⚠ 다시 넣고 싶으면 **먼저 실측할 것**(위 방법 그대로). 목소리·서버가 바뀌면 결론도 바뀐다.
 *
 * 🟠 남긴 정규화는 딱 하나 — 물결표. 실측: "50~60명" 그대로는 「50, 60명」으로 끊어 읽어
 *   오독이고, "50에서 60명" 은 정확했다. 이건 모델이 못 하므로 앱이 해 준다.
 */

'use strict';

/**
 * 사용자 발음사전 치환 — 자막은 그대로 두고 TTS 만 교정.
 * - source 길이가 긴 항목 먼저 매칭 (substring 치환 순서 보장)
 * @param {string} text        원본 텍스트
 * @param {Array}  globalDict  [{source, pron, enabled}]  글로벌 사전
 * @returns {string}
 */
function applyOmniVoiceDict(text, globalDict) {
  const entries = (globalDict || []).filter(e => e.source && e.pron && e.enabled !== false);
  // 긴 source 먼저 매칭
  entries.sort((a, b) => b.source.length - a.source.length);
  let out = String(text || '');
  for (const { source, pron } of entries) {
    out = out.split(source).join(pron);
  }
  return out;
}

/**
 * TTS 합성 직전 일반 정규화 — 사전 적용 다음에 호출 (사용자 명시 사전이 항상 우선).
 * - 숫자 ~ 숫자  →  숫자에서 숫자   (반각 ~ / wave dash 〜 / 전각 ～ 모두 처리)
 *   예: "50~60명" → "50에서 60명"
 * ⛔ 숫자→한글 변환은 하지 않는다(파일 머리 실측 참조). 여기에 추가하기 전에 반드시 실측할 것.
 */
function normalizeForTTS(text) {
  let out = String(text || '');
  out = out.replace(/(\d+)\s*[~〜～]\s*(\d+)/g, '$1에서 $2');
  return out;
}

/**
 * 🔑 TTS 로 실제 보내지는 최종 문자열. **가공은 이 함수 하나로만 한다.**
 *   tts-manager.synthesize 와 TTS 캐시 키(core/pipeline)가 같은 함수를 쓰기 때문에
 *   "캐시가 옛 발음을 되살리는" 사고가 원리적으로 안 난다. 두 곳에서 각자 가공하면 반드시 어긋난다.
 * 순서: 사용자 사전 먼저 → 일반 정규화 (사용자 명시 발음이 자동 규칙에 덮이지 않게).
 */
function processForTTS(text, globalDict) {
  return normalizeForTTS(applyOmniVoiceDict(text, globalDict));
}

/**
 * 0 ~ 9999 정수를 한자어 한국어 숫자로 변환. 예: 12 → "십이", 2024 → "이천이십사"
 * ⚠ **현재 합성 경로에서 쓰지 않는다** — 파일 머리의 실측(숫자를 그대로 보내는 것이 더 정확)
 *   때문이다. 순수 유틸이라 남겨 두었을 뿐이고, 테스트가 normalizeForTTS 에 다시 배선되지
 *   않았는지 단언한다. 되살리려면 실측이 먼저다.
 */
function numToHangulSino(n) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '영';
  if (n < 0 || n > 9999) return String(n);
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const units  = ['', '십', '백', '천'];
  const str = String(n);
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const d = +str[i];
    if (d === 0) continue;
    const unit = units[str.length - 1 - i];
    if (d === 1 && unit) {
      // 일+단위 는 단위 단독으로 (예: 100→"백", 10→"십")
      result += unit;
    } else {
      result += digits[d] + unit;
    }
  }
  return result;
}

module.exports = { applyOmniVoiceDict, normalizeForTTS, processForTTS, numToHangulSino };
