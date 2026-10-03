'use strict';
// 🎬 영상으로 만들 그룹 고르기(v0.6.60 · 로이 2026-10-03: 홀수만·짝수만 — 비용 절감).
//   기존 「범위(N~M)」는 그대로 두고, 범위 대신 **방식**(vidSel)을 고를 수 있다. 채널에 미리 등록해 두고 헤더가 따른다.
//   🔑 모든 방식은 **1번 그룹을 반드시 포함**한다(로이 지정). 「범위 지정」('' · 'range')만 예외 — 입력한 N~M 그대로.
//   🔑 영상 대상을 정하는 곳은 여기 한 곳(main rangeNums · make-progress · 화면 프롬프트 검사가 모두 이 함수).
//   ⚠ core/*.js 는 렌더러 번들에 들어간다 — CJS 런타임 자기검사 금지.

const MODES = [
  { id: 'intro',      label: '도입부만',                 hint: '도입부 그룹만 (기본)' },
  { id: 'odd',        label: '홀수 그룹',                hint: '1·3·5·7… 번 그룹' },
  { id: 'even',       label: '1번 + 짝수 그룹',          hint: '1번과 2·4·6·8… 번 그룹' },
  { id: 'intro_odd',  label: '도입부 + 본론 홀수',       hint: '도입부 전체 + 본론의 홀수 번 그룹' },
  { id: 'intro_even', label: '도입부 + 본론 짝수',       hint: '도입부 전체 + 본론의 짝수 번 그룹' },
  { id: 'every3',     label: '3개마다 1개 (1·4·7…)',     hint: '1번부터 3칸 간격' },
  { id: 'every4',     label: '4개마다 1개 (1·5·9…)',     hint: '1번부터 4칸 간격' },
];
const IDS = MODES.map((m) => m.id);

// 알려진 방식이면 그 id, 아니면 ''(= 범위 지정/기본). 모르는 값을 조용히 다른 방식으로 바꾸지 않는다.
function normSel(v) { return IDS.includes(v) ? v : ''; }
function labelOf(v) { const m = MODES.find((x) => x.id === v); return m ? m.label : '범위 지정'; }

// groups: [{num, isIntro}] → 영상으로 만들 그룹 번호(오름차순). sel 이 없으면 null(= 호출자가 N~M 범위를 쓴다).
function pick(groups, sel) {
  const s = normSel(sel);
  if (!s) return null;
  const gs = (groups || []).filter((g) => g && g.num != null);
  const first = gs.length ? Math.min(...gs.map((g) => g.num)) : 1;   // 「1번 그룹」= 가장 앞 그룹
  const intro = (g) => !!g.isIntro;
  const keep = (g) => {
    if (g.num === first) return true;                                // 1번은 언제나
    switch (s) {
      case 'intro':      return intro(g);
      case 'odd':        return g.num % 2 === 1;
      case 'even':       return g.num % 2 === 0;
      case 'intro_odd':  return intro(g) || g.num % 2 === 1;
      case 'intro_even': return intro(g) || g.num % 2 === 0;
      case 'every3':     return (g.num - first) % 3 === 0;
      case 'every4':     return (g.num - first) % 4 === 0;
      default:           return false;
    }
  };
  return gs.filter(keep).map((g) => g.num).sort((a, b) => a - b);
}

// 범위/방식 어느 쪽이든 「이 그룹이 영상 대상인가」를 돌려주는 판정기. 미지정(범위 null + 방식 없음) = 전체.
function matcher(groups, sel, fromNum, toNum) {
  const nums = pick(groups, sel);
  if (nums) { const set = new Set(nums); return (n) => set.has(n); }
  if (fromNum == null || toNum == null) return () => true;
  const a = Math.min(Number(fromNum), Number(toNum)), b = Math.max(Number(fromNum), Number(toNum));
  return (n) => n >= a && n <= b;
}

module.exports = { MODES, normSel, labelOf, pick, matcher };
