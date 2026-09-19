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

module.exports = { normalizeText, sentenceTexts, sameGroupContent };
