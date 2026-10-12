'use strict';

/**
 * 그룹의 화면 자산은 그 그룹이 담고 있는 대본 문장에 종속된다.
 * 그룹 번호만 비교하면 앞에서 문장이 추가/삭제됐을 때 전혀 다른 장면의 이미지가 붙는다.
 */
function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function sentenceTexts(sentences) {
  return (sentences || []).map((s) => normalizeText(s && s.text));
}

function sameGroupContent(currentSentences, savedSentences) {
  const a = sentenceTexts(currentSentences);
  const b = sentenceTexts(savedSentences);
  if (!a.length || a.length !== b.length) return false;
  return a.every((text, i) => text === b[i]);
}

// 🔢 문장 경계만 달라지고 글은 그대로인가(v0.8.10 — 소수점 3.5 를 더 이상 가르지 않게 되어 옛 작업본의 「3.」/「5배…」가
//   새 파싱에서 「3.5배…」 한 문장이 된다). 공백을 빼고 이어 붙인 글이 같으면 그룹의 그림·프롬프트는 그대로 쓴다.
function sameGroupText(currentSentences, savedSentences) {
  const j = (arr) => sentenceTexts(arr).join('').replace(/\s+/g, '');
  const a = j(currentSentences);
  return !!a && a === j(savedSentences);
}

module.exports = { normalizeText, sentenceTexts, sameGroupContent, sameGroupText };
