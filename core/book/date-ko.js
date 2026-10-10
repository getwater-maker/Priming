'use strict';
/**
 * date-ko.js — 판권 발행일을 「2026년 10월 06일」 모양으로 (2026-10-06 로이 — 부크크 판권지 수정 요청: 「발행 → 2026년 10월 06일」)
 *   · formatKo('2026-10-06') → '2026년 10월 06일' · '2026.10.6' · '2026/10/06' · '2026. 10. 06.' · '2026년 10월 6일' 도 같은 모양(월·일 두 자리)
 *   · 이미 그 모양이거나 날짜가 아닌 글은 그대로(라벨만 있는 글 · 「초판 1쇄 발행 2026년 …」 의 라벨은 건드리지 않는다)
 *   · normalizeMeta('발행일 2026-10-06') → '발행일 2026년 10월 06일' (라벨 + 날짜 · `;` 로 이은 여러 쇄도 하나씩)
 *   ⚠ 순수 함수 — 렌더러 번들에 들어간다.
 */
function formatKo(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^((?:19|20)\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\s*\.?(.*)$/);
  if (!m) m = s.match(/^((?:19|20)\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일(.*)$/);
  if (!m) return s;
  const mo = Number(m[2]), da = Number(m[3]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return s;
  const rest = String(m[4] || '').trim();
  return `${m[1]}년 ${String(mo).padStart(2, '0')}월 ${String(da).padStart(2, '0')}일${rest ? ' ' + rest : ''}`;
}
function normalizeMeta(v) {
  return String(v == null ? '' : v).split(/\s*[;；]\s*/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^(.*?)\s*((?:19|20)\d{2}[\D].*)$/);
    if (!m) return p;
    const label = m[1].trim();
    const val = formatKo(m[2]);
    return label ? `${label} ${val}` : val;
  }).join('; ');
}
// 오늘(KST) → 「2026년 10월 10일」 — ISBN 을 받은 날 = 발행일 기준(부크크)에 쓴다. now = 시험용 주입(ms).
function todayKo(now) {
  const d = new Date((now == null ? Date.now() : now) + 9 * 3600 * 1000);
  return formatKo(d.toISOString().slice(0, 10));
}
module.exports = { formatKo, normalizeMeta, todayKo };
