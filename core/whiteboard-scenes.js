'use strict';

/**
 * whiteboard-scenes.js — 롱폼 그룹 모델 → **화이트보드 장면 계획**.
 *
 * 🔑 **「장면 = 그룹」이 불변식이다.** 이걸 깨면 세 가지가 함께 무너진다:
 *   ① `media-cache.imageKey(prompt, …)` 는 **프롬프트가 키**라, 장면 경계가 실행마다 흔들리면
 *      **편당 50장이 전량 재생성**된다(「🗑 삭제 후 그 3장만」이 원리적으로 불가능해진다).
 *   ② `prompt-io` 왕복이 `groups.find(x => x.num === num)` 이라 📤내보내기/📥가져오기가 깨진다.
 *   ③ 게이트(`missingVisualGroups`)·스냅샷·🔄 단건 재생성이 전부 그룹 번호 기준이다.
 *  ⇒ 그래서 **분할·병합은 반드시 결정론**이다. 같은 대본이면 항상 같은 장면이 나온다.
 *     LLM 에게 분할을 맡기지 않는다(맡기면 ①이 매 실행 터진다).
 *
 * 실측 근거(롱폼 스냅샷 320편 · 그룹 11,814개):
 *   그룹 TTS 중앙 31.6초 · 45초 초과 33.5% · 10초 미만 14.0% · p90 103초 · 최대 935초.
 *   → 「장면 = 그룹」이 대부분 그대로 맞고, **긴 쪽을 쪼개는 것**이 실제 일이다.
 */

// ── 정책 상수 (전부 실측에서 나온 값) ───────────────────────────────────────
const SPLIT_OVER_SEC = 45;   // 이보다 길면 쪼갠다 — 103초 장면은 element 하나가 17초(35px/s)라 펜이 기어간다
const SPLIT_TARGET_SEC = 30; // 쪼갤 때 목표
const MERGE_UNDER_SEC = 5;   // 이보다 짧으면 앞 장면에 붙인다 — element 1개짜리는 순차 공개가 없어 화이트보드를 쓸 이유가 없다
const MERGE_MAX_SEC = 35;    // 붙여서 이걸 넘으면 안 붙인다
const ELEM_MIN_SEC = 3.0;    // element 하나의 최소 시간 — 2.5초 밑이면 펜이 미끄러지는 게 아니라 순간이동으로 보인다
const ELEM_LEAD_SEC = 0.8;   // 예산 계산의 여유분
const ELEM_MAX = 6;          // 상한 — 넘으면 영역이 작아져 그릴 먹선이 부족해진다
const ELEM_TARGET_MAX = 5;   // 목표 상한(6은 상한이지 목표가 아니다). 예제도 4개다
const GAP_MS = 300;          // element 사이 숨 돌림 (예제 실측: 전부 정확히 300ms)
const DRAW_MIN_MS = 800;     // 숨 돌림을 빼고도 남겨야 하는 최소 드로잉 시간

const secOf = (s) => Number(s && s.ttsDurationSec) || 0;
const sumSec = (arr) => arr.reduce((a, s) => a + secOf(s), 0);

/** 그 장면에 몇 개의 element 를 둘까 — 시간 예산으로 정한다(문장 수가 아니다). */
function elementBudget(sec) {
  const raw = Math.floor((sec - ELEM_LEAD_SEC) / ELEM_MIN_SEC);
  return Math.max(1, Math.min(ELEM_TARGET_MAX, raw > ELEM_MAX ? ELEM_MAX : raw));
}

/**
 * 문장들을 k 개 묶음으로 — **순서를 지키며** 시간이 고르게. 결정론적 그리디.
 * ⚠ 1문장 = 1element 로 기계 매핑하지 않는다. 1.5초짜리 문장이 오면 그 영역이 최소 시간을 못 채운다.
 */
function bucketSentences(sentences, k) {
  const n = sentences.length;
  if (k <= 1 || n === 0) return n ? [sentences.slice()] : [];
  if (k >= n) return sentences.map((s) => [s]);
  const total = sumSec(sentences) || n;
  const target = total / k;
  const out = [];
  let cur = [], curSec = 0;
  for (let i = 0; i < n; i++) {
    const s = sentences[i];
    const bucketsLeft = k - out.length;        // 지금 채우는 것 포함
    const sentsLeft = n - i;                   // 지금 문장 포함
    // 남은 문장이 남은 묶음보다 적어지면 지금 끊어야 각 묶음이 최소 1문장을 갖는다
    const mustClose = cur.length > 0 && sentsLeft < bucketsLeft;
    // 목표를 이미 채웠고 이 문장을 더 넣으면 목표에서 더 멀어지면 끊는다
    const closeOnTarget = cur.length > 0 && curSec >= target
      && Math.abs(curSec + secOf(s) - target) > Math.abs(curSec - target);
    if (bucketsLeft > 1 && (mustClose || closeOnTarget)) { out.push(cur); cur = []; curSec = 0; }
    cur.push(s); curSec += secOf(s);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * 최소 시간을 못 채운 묶음을 이웃에 붙인다.
 * ⚠ 이게 없으면 길이가 들쭉날쭉한 문장에서 1초짜리 element 가 나온다 — 펜이 순간이동으로 보이고
 *   화이트보드를 쓸 이유가 사라진다. **개수보다 최소 시간이 우선**이다.
 */
function enforceMinDuration(buckets, minSec) {
  const min = minSec != null ? minSec : ELEM_MIN_SEC;
  if (buckets.length <= 1) return buckets;
  const out = buckets.map((b) => b.slice());
  let i = 0;
  while (out.length > 1 && i < out.length) {
    if (sumSec(out[i]) >= min) { i++; continue; }
    // 짧은 쪽을 **더 짧은 이웃**에 붙인다(균형이 덜 깨진다). 앞뒤가 같으면 앞을 고른다(결정론).
    const prev = i > 0 ? sumSec(out[i - 1]) : Infinity;
    const next = i < out.length - 1 ? sumSec(out[i + 1]) : Infinity;
    if (prev <= next) { out[i - 1] = out[i - 1].concat(out[i]); out.splice(i, 1); i = Math.max(0, i - 1); }
    else { out[i] = out[i].concat(out[i + 1]); out.splice(i + 1, 1); }
  }
  return out;
}

/** 긴 그룹을 문장 경계에서 쪼갠다 — 목표 30초, 꼬리가 너무 짧으면 앞에 되돌린다. */
function splitLong(sentences) {
  const chunks = [];
  let cur = [], curSec = 0;
  for (const s of sentences) {
    if (cur.length && curSec + secOf(s) > SPLIT_TARGET_SEC) { chunks.push(cur); cur = []; curSec = 0; }
    cur.push(s); curSec += secOf(s);
  }
  if (cur.length) chunks.push(cur);
  // 마지막 조각이 지나치게 짧으면 앞 조각에 합친다(고아 장면 방지)
  if (chunks.length >= 2 && sumSec(chunks[chunks.length - 1]) < MERGE_UNDER_SEC) {
    const tail = chunks.pop();
    chunks[chunks.length - 1] = chunks[chunks.length - 1].concat(tail);
  }
  return chunks;
}

/** 장면 하나의 element 타이밍 — **낭독 구간이 곧 드로잉 구간**이라 자막 싱크가 자동으로 맞는다. */
function buildElements(buckets) {
  const els = [];
  let cursorMs = 0;
  buckets.forEach((bucket, i) => {
    const winMs = Math.round(sumSec(bucket) * 1000);
    const draw = Math.max(DRAW_MIN_MS, winMs - GAP_MS);   // 다음 element 전에 300ms 쉰다
    els.push({
      seq: i + 1,
      sentenceNums: bucket.map((s) => s.num),
      startMs: cursorMs,
      durationMs: Math.min(draw, winMs),                  // 창을 넘지 않는다
      // ⚠ subtitle 은 렌더러가 쓰지 않는다(자막은 Priming 이 SRT 로 번인).
      //   preview.html 에서 어느 영역인지 사람이 알아보는 용도라 길이 규칙이 없다.
      subtitle: bucket.map((s) => String(s.text || '').trim()).filter(Boolean).join(' '),
    });
    cursorMs += winMs;
  });
  return { elements: els, durationMs: cursorMs };
}

/**
 * 그룹 모델 → 장면 계획.
 * @returns {{scenes:Array, summary:{groups:number, scenes:number, split:number, merged:number, lines:string[]}}}
 */
function planScenes(project, opts = {}) {
  // noSplit — 4단계(2026-09-05) 정책: 3단계(장면별 이미지) 전까지는 **그룹 이미지 1장 = 장면 1개**라
  //   긴 그룹을 쪼개면 같은 그림을 두 번 그리게 된다(되감기처럼 보인다). 그래서 분할을 끈다. 병합은 그대로.
  const noSplit = !!opts.noSplit;
  const splitOver = noSplit ? Infinity : (opts.splitOverSec || SPLIT_OVER_SEC);
  const mergeUnder = opts.mergeUnderSec != null ? opts.mergeUnderSec : MERGE_UNDER_SEC;
  const groups = (project && project.groups) || [];
  const getS = (g) => (project.getSentencesOfGroup ? project.getSentencesOfGroup(g) : []).filter(Boolean);

  // 1) 그룹 → 조각 (긴 것만 쪼갠다)
  const pieces = [];
  let splitCount = 0;
  for (const g of groups) {
    const ss = getS(g);
    if (!ss.length) continue;                             // 문장 없는 그룹은 장면이 아니다
    const sec = sumSec(ss);
    if (sec > splitOver) {
      const chunks = splitLong(ss);
      if (chunks.length > 1) splitCount += chunks.length - 1;
      chunks.forEach((c, i) => pieces.push({ groupNums: [g.num], sentences: c, part: i + 1, parts: chunks.length, title: g.title || g.h2Title || null }));
    } else {
      pieces.push({ groupNums: [g.num], sentences: ss, part: 1, parts: 1, title: g.title || g.h2Title || null });
    }
  }

  // 2) 너무 짧은 조각은 앞에 붙인다
  //   ⚠ 결정론이어야 한다 — 규칙이 흔들리면 프롬프트가 바뀌고 캐시가 통째로 무효가 된다.
  const merged = [];
  let mergeCount = 0;
  for (const p of pieces) {
    const prev = merged[merged.length - 1];
    const sec = sumSec(p.sentences);
    if (prev && sec < mergeUnder && sumSec(prev.sentences) + sec <= MERGE_MAX_SEC) {
      prev.sentences = prev.sentences.concat(p.sentences);
      for (const gn of p.groupNums) if (!prev.groupNums.includes(gn)) prev.groupNums.push(gn);
      prev.parts = 1; prev.part = 1;
      mergeCount++;
    } else merged.push({ ...p });
  }

  // 3) 장면화 — element 묶기 + 타이밍
  const scenes = merged.map((p, i) => {
    const sec = sumSec(p.sentences);
    const k = elementBudget(sec);
    const buckets = enforceMinDuration(bucketSentences(p.sentences, k));
    const { elements, durationMs } = buildElements(buckets);
    return {
      num: i + 1,
      groupNums: p.groupNums.slice(),
      part: p.parts > 1 ? p.part : null,
      parts: p.parts > 1 ? p.parts : null,
      title: p.title,
      sentenceNums: p.sentences.map((s) => s.num),
      durationSec: sec,
      durationMs,
      elements,
      // 화이트보드 전용 프롬프트 슬롯 — 롱폼 imagePrompt(실사 화풍)는 쓸 수 없다.
      text: p.sentences.map((s) => String(s.text || '').trim()).filter(Boolean).join(' '),
    };
  });

  // 4) 관문 A — 사람이 읽을 계획 요약. 잘못된 계획으로 렌더 30분을 태우기 전에 보여준다.
  const lines = [];
  lines.push(`🎬 장면 계획 — 그룹 ${groups.length}개 → 장면 ${scenes.length}개 (분할 ${splitCount} · 병합 ${mergeCount})`);
  for (const s of scenes) {
    const g = s.groupNums.length > 1 ? `G${s.groupNums.join('+G')}` : `G${s.groupNums[0]}`;
    const part = s.parts ? ` (${s.part}/${s.parts})` : '';
    lines.push(`   장면 ${String(s.num).padStart(2, '0')} · ${g}${part} · ${s.durationSec.toFixed(1)}초 · 영역 ${s.elements.length}개`
      + (s.title ? ` · ${s.title}` : ''));
  }
  // 5) 경고 — 막지는 않는다(문장 자체가 짧거나 길면 앱이 할 수 있는 게 없다). 다만 **눈에 보이게** 한다.
  //    v0.3.86 계열 교훈: 조용히 다르게 동작하면 나중에 원인을 못 찾는다.
  const warn = [];
  const solo = scenes.filter((s) => s.elements.length === 1);
  if (solo.length) {
    warn.push(`⚠ 영역이 1개뿐인 장면 ${solo.length}개 (G${solo.slice(0, 6).map((s) => s.groupNums.join('+')).join(', G')}`
      + `${solo.length > 6 ? ' …' : ''}) — 순차 공개가 없어 그냥 그림 한 장으로 보입니다`);
  }
  const slow = [];
  for (const s of scenes) for (const e of s.elements) if (e.durationMs > 20000) slow.push(`장면${s.num}-${e.seq}(${(e.durationMs / 1000).toFixed(0)}초)`);
  if (slow.length) {
    warn.push(`⚠ 20초를 넘는 영역 ${slow.length}개 (${slow.slice(0, 6).join(' · ')}${slow.length > 6 ? ' …' : ''})`
      + ` — 펜이 느리게 보입니다. 대본에서 그 대목의 문장을 나누면 좋아집니다`);
  }
  const longScene = scenes.filter((s) => s.durationSec > SPLIT_OVER_SEC);
  if (longScene.length) {
    warn.push(noSplit
      ? `⚠ ${SPLIT_OVER_SEC}초를 넘는 장면 ${longScene.length}개 — 그룹 이미지 1장으로 그리므로 분할하지 않았습니다(펜이 느리게 보일 수 있음 · 3단계에서 장면별 그림이 들어오면 쪼개집니다)`
      : `⚠ ${SPLIT_OVER_SEC}초를 넘는 장면 ${longScene.length}개 — 문장 하나가 그보다 길어 더 쪼갤 수 없었습니다`);
  }
  lines.push(...warn);

  return { scenes, summary: { groups: groups.length, scenes: scenes.length, split: splitCount, merged: mergeCount, warnings: warn, lines } };
}

module.exports = {
  planScenes, elementBudget, bucketSentences, enforceMinDuration, splitLong, buildElements,
  SPLIT_OVER_SEC, SPLIT_TARGET_SEC, MERGE_UNDER_SEC, MERGE_MAX_SEC, ELEM_MIN_SEC, ELEM_MAX, ELEM_TARGET_MAX, GAP_MS,
};
