'use strict';
/**
 * header-kind.js — 원고 메타 `> 머리글홀수:` · `> 머리글짝수:` 값 → 머리글 종류(순수 · 렌더러도 import).
 *   앱 옵션 이름(title · subtitle · chapter · chapterNo · section · none) 또는 한글(책제목 · 부제 · 장제목/회목 · 제N회 · 소제목/절 · 없음)을 받는다.
 *   모르는 값은 null(= 무시 — 조용히 엉뚱한 머리글이 되지 않게 UI 값을 쓴다).
 */
const KEYS = ['title', 'subtitle', 'chapter', 'chapterNo', 'section', 'none'];
const KO = {
  '책제목': 'title', '제목': 'title', '책 제목': 'title',
  '부제': 'subtitle', '부제목': 'subtitle',
  '장제목': 'chapter', '장 제목': 'chapter', '회목': 'chapter', '회제목': 'chapter', '전체회목': 'chapter',
  '제n회': 'chapterNo', '제n회만': 'chapterNo', '회차': 'chapterNo', '회번호': 'chapterNo',
  '소제목': 'section', '절': 'section', '절제목': 'section',
  '없음': 'none', '표시안함': 'none', '표시 안 함': 'none', '안함': 'none',
};
function headerKindOf(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (KEYS.includes(s)) return s;
  const low = s.replace(/[「」『』"'“”]/g, '').replace(/\s+/g, '').toLowerCase();
  if (KEYS.map((k) => k.toLowerCase()).includes(low)) return KEYS.find((k) => k.toLowerCase() === low);
  return KO[low] || KO[s] || null;
}
module.exports = { KEYS, headerKindOf };
