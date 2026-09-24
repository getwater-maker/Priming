'use strict';
/**
 * yt-chapters.js — ⏱ 유튜브 설명글 챕터(타임스탬프) 계산 — **단일 구현**.
 *   렌더러(App.jsx ⏱ 타임스탬프 창)와 main(⬆ 유튜브 업로드 설명글)이 같이 쓴다.
 *   ⚠ 두 벌로 두면 화면에서 본 챕터와 실제 올라간 설명이 조용히 갈라진다(caption-splitter 와 같은 이유).
 *   ⚠ 렌더러 번들에도 들어가므로 CJS 런타임 참조(require 등)를 두지 말 것 — v0.3.40 백지 화면 사고.
 *   입력은 DTO 모양(pr.cuts[].h2/phase/groupDurationSec/sentences[].dur/mark) — main 은 P.toDTO 로 만든다.
 */
// ── 유튜브 설명글 타임스탬프(챕터) ─────────────────────────────────────────
//  .vrew 타임라인은 문장 TTS 를 빈틈 없이 이어 붙인 것이므로(vrew-builder), 챕터 시작시각 =
//  그 앞 그룹들의 TTS 길이 합. 챕터 단위는 **상위 H2 섹션**(cut.h2) — H3 단위로 잘게 쪼갠 그룹을
//  다시 H2 로 묶는다. H2 가 없는 대본은 그룹 섹션명(phase)으로 폴백.
function tsFmt(sec) {
  const t = Math.max(0, Math.floor(Number(sec) || 0)); // 올림하면 챕터가 내용보다 뒤에서 시작한다 → 내림
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
}
// 섹션 제목의 제작 표기 꼬리 제거 — `— 0:00~0:30 · I2V 5샷` / `(0:30~3:50)` / ` ★`
function tsCleanTitle(t) {
  return String(t == null ? '' : t)
    .replace(/\s*[—-]\s*\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}.*$/, '')
    .replace(/\s*\(\s*\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}\s*\)\s*$/, '')
    .replace(/\s*★/g, '')
    .replace(/\s*[〔\[(][^〕\])]*(?:\d+\s*(?:샷|초|자|s)|I2V|콜드오픈|후킹)[^〕\])]*[〕\])]\s*$/, '') // 꼬리 제작메모 〔콜드오픈 · 5샷 · I2V〕
    .replace(/\s+/g, ' ')
    .trim();
}
// 한 편(project) → 챕터 목록 [{start, dur, title}]
function tsChaptersOf(pr) {
  const cuts = (pr && pr.cuts) || [];
  const useH2 = cuts.some((c) => c.h2 && String(c.h2).trim());
  const out = [];
  let t = 0, lastKey = '';
  // 합친 그룹(⤒ · 「이미지: 이어서」)은 안쪽 문장에 챕터 표식(mark)을 품고 있다 → 그 문장에서 가른다.
  const segsOf = (c) => {
    const ss = c.sentences || [];
    if (!ss.some((st) => st.mark)) return [{ h2: c.h2, phase: c.phase, dur: Number(c.groupDurationSec) || 0 }];
    const segs = [{ h2: c.h2, phase: c.phase, dur: 0 }];
    for (const st of ss) {
      if (st.mark) segs.push({ h2: st.mark.h2, phase: st.mark.phase, dur: 0 });
      segs[segs.length - 1].dur += Number(st.dur) || 0;
    }
    return segs;
  };
  for (const c of cuts) {
    for (const sg of segsOf(c)) {
      const key = tsCleanTitle(useH2 ? sg.h2 : sg.phase) || lastKey; // 제목 없는 그룹은 앞 챕터에 붙인다
      const dur = sg.dur;
      if (!out.length || key !== lastKey) out.push({ start: t, dur, title: key || '시작' });
      else out[out.length - 1].dur += dur;
      lastKey = key;
      t += dur;
    }
  }
  return out;
}
// dto → { text(붙여넣기용), total, warns[] }
function tsBuild(dto) {
  const projects = (dto && dto.projects) || [];
  const lines = [], warns = [];
  let total = 0, missing = 0, shortN = 0, chapN = 0;
  for (const pr of projects) {
    for (const c of (pr.cuts || [])) for (const st of (c.sentences || [])) if (!(Number(st.dur) > 0)) missing++;
    const chs = tsChaptersOf(pr);
    chapN += chs.length;
    for (const ch of chs) {
      if (ch.dur < 10) shortN++;
      lines.push(`${tsFmt(ch.start)} ${ch.title}`);
    }
    total += chs.reduce((a, ch) => a + ch.dur, 0);
  }
  if (missing > 0) warns.push(`TTS 가 아직 없는 문장 ${missing}개 — 그만큼 시간이 실제보다 짧습니다. TTS 변환을 끝낸 뒤 다시 여세요.`);
  if (chapN < 3) warns.push('챕터가 3개 미만입니다 — 유튜브는 챕터를 3개 이상일 때만 인식합니다.');
  if (shortN > 0) warns.push(`10초 미만 챕터 ${shortN}개 — 유튜브가 목록 전체를 무시할 수 있습니다(각 챕터 10초 이상 필요).`);
  return { text: lines.join('\n'), total, warns };
}

module.exports = { tsFmt, tsCleanTitle, tsChaptersOf, tsBuild };
