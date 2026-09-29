'use strict';
/**
 * core/clip-join.js — 🧩 클립(자막 줄) 단위 합치기(2026-09-29 로이 · v0.5.88)
 *
 *   로이: "2번 클립 뒤에서 del 키를 눌렀는데, 왜 3번 클립의 「그 방은 가운데가」가 모두 따라 올라오지 않고
 *          「그 방은」만 올라오고 3번 클립이 2개로 나뉘는 거지? … 클립 전체가 따라 올라와야지."
 *   예전: 문장 경계에서 Del/Backspace = **아래 문장 전체**를 위 문장에 붙이고 줄을 자동으로 다시 나눴다
 *         → 줄 경계가 흘러내려 「그 방은」만 올라온 것처럼 보이고, 아래 클립이 둘로 쪼개졌다.
 *   이제: 위 문장 마지막 줄 뒤에 **아래 문장의 첫 줄(클립) 하나만** 붙인다. 나머지 줄은 그 자리(그 그룹·그 그림)에 그대로.
 *         두 문장의 다른 줄 나눔도 그대로 굳힌다(자동 줄바꿈이 흘러내리지 않게).
 *   대본(.md)은 문장을 마침표로 가르므로, 붙인 클립 끝에 마침표가 온다(「…칸입니다 그 방은 가운데가.」 / 「막혀 두 칸으로 나뉩니다.」).
 *   ⚠ 렌더러 번들에 들어간다 — CJS 런타임 참조 금지(require 없음).
 */

const END = /[.!?。]+\s*$/;

/**
 * @param upText   위 문장 글
 * @param upStarts 위 문장의 줄 시작 위치들(0 제외 · 지금 화면에 보이는 대로)
 * @param lowText  아래 문장 글
 * @param lowStarts 아래 문장의 줄 시작 위치들(0 제외)
 * @returns {{ merged, rest, breaksMerged, breaksRest }}
 *   merged = 위 문장 + 아래 첫 줄 · rest = 아래 문장의 남은 줄들('' 이면 아래 문장이 한 줄뿐이라 통째로 올라왔다)
 */
function joinClips(upText, upStarts, lowText, lowStarts) {
  const up = String(upText || '');
  const low = String(lowText || '');
  const upCore = up.replace(END, '').replace(/\s+$/, '');
  const k = (lowStarts || []).map(Number).filter((x) => x > 0 && x < low.length).sort((a, b) => a - b)[0];
  const first = (k ? low.slice(0, k) : low).trim();
  const restRaw = k ? low.slice(k) : '';
  const rest = restRaw.trim();
  const lead = restRaw.length - restRaw.replace(/^\s+/, '').length;
  let merged = (upCore + ' ' + first).trim();
  if (rest && !END.test(merged)) merged += '.';   // 대본에서 문장이 갈리게(남은 줄은 제 문장으로 남는다)
  const breaksMerged = (upStarts || []).map(Number).filter((x) => x > 0 && x < upCore.length).sort((a, b) => a - b);
  const breaksRest = rest ? (lowStarts || []).map(Number).filter((x) => x > k).map((x) => x - k - lead).filter((x) => x > 0 && x < rest.length).sort((a, b) => a - b) : [];
  return { merged, rest, breaksMerged, breaksRest };
}

module.exports = { joinClips };
