'use strict';
/**
 * title-lines.js — 📖 표제지·속표지·ePub 표제지의 **도서명 줄 나누기 규칙**(로이 2026-10-02 · 출판 세션과 함께 정함).
 *
 *   배경: 도서명 「삼국지 완역 10 : 천하, 하나로 돌아가다」 를 한 덩어리로 찍으면 폭이 모자랄 때 아무 데서나 줄이 바뀌어
 *         「…하나로 / 돌아가다」 처럼 문장 중간에서 끊겼다. 도서명은 `작품명 + 권` ` : ` `부제목` 구조라 ` : ` 에서 나눈다.
 *
 *   규칙(우선순위):
 *     1) 원고 메타 `> 제목줄바꿈: 삼국지 완역 10 / 천하, 하나로 돌아가다` — 「/」 또는 「|」 로 줄을 지정(2~3줄). 콜론 없는 제목에도 쓴다.
 *     2) 제목 안의 **첫 번째 ` : `**(공백-콜론-공백, 전각 「：」 는 공백이 없어도) 에서 두 줄로 — 나눈 자리의 콜론은 **지운다**.
 *     3) 그 밖에는 한 줄(브라우저 줄바꿈 — 한글은 어절 단위로만 끊는다).
 *   🔑 책 **이름 자체**(부크크 등록 도서명·머리글·목차·판권)는 바꾸지 않는다 — 이 규칙은 표제지류의 **보이는 줄 나눔**뿐이다.
 */
function titleLines(meta, fallbackTitle) {
  const m = meta || {};
  const full = String(m.title || fallbackTitle || '').replace(/\s+/g, ' ').trim();
  const br = String(m.titleBreak || '').trim();
  if (br) {
    const parts = br.split(/\s*[\/|]\s*/).map((x) => x.trim()).filter(Boolean).slice(0, 3);
    if (parts.length >= 2) return parts;
  }
  const hit = /^(.+?)\s+[:：]\s+(.+)$/.exec(full) || /^(.+?)\s*：\s*(.+)$/.exec(full);
  if (hit && hit[1].trim() && hit[2].trim()) return [hit[1].trim(), hit[2].trim()];
  return [full];
}
module.exports = { titleLines };
