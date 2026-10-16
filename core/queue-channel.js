'use strict';
/**
 * queue-channel.js — 🔀 작업 순서에 여러 채널 대본 섞기(v0.9.41 · 로이 2026-10-16)
 *
 * 규칙(한 곳): **헤더 채널과 같은 채널의 대본 = 헤더 값(예전 그대로) · 다른 채널의 대본 = 그 채널 설정 값.**
 *   다른 채널 대본이 그 채널을 따르는 값 = 그림 스타일 · 자막 모양 · 자막 글자 수 · 완성 종류.
 *   (목소리·배경음악·로고·AI 고지·업로드 채널은 원래 대본 채널을 따른다 · 이미지·비디오 **도구**는 헤더 하나로 통일 — 로이 결정)
 *   같은 채널만 있는 큐는 {} 를 돌려 결과가 예전과 한 글자도 다르지 않다.
 * 키 이름은 렌더러 헤더가 채널을 읽는 곳(App.jsx presetName 효과)과 같다: styleLong · capLong · split.longLen · outTarget.
 * 테스트: test/channel-voice.test.js
 */

const normOutTarget = (v) => (v === 'whiteboard' || v === 'mp4' ? v : 'vrew');

/** 대본 채널 preset · 헤더 채널 이름 → 덮어쓸 값({} = 헤더 값 그대로) */
function channelOverrides(preset, headerName) {
  if (!preset || !preset.name || !headerName || preset.name === headerName) return {};
  const out = {};
  const st = preset.styleLong || preset.styleId;
  if (st) out.styleId = st;
  // 자막 모양 — 채널 capLong(헤더 capOverride 가 만드는 것과 같은 키) · 없으면 null(채널 captionStyle 폴백)
  out.captionStyle = preset.capLong && typeof preset.capLong === 'object' ? { ...preset.capLong } : null;
  const sl = preset.split || { longLen: preset.longLen };
  out.captionMaxChars = Math.max(2, parseInt(sl.longLen, 10) || 20);
  if (preset.outTarget != null) out.outTarget = normOutTarget(preset.outTarget);
  return out;
}

/** 큐 항목들의 채널 분포 → { mixed, counts:[[이름, 편수]] } (항목 채널이 없으면 헤더 채널로 센다) */
function channelMix(items, headerName) {
  const m = new Map();
  for (const it of items || []) {
    const n = (it && it.settings && it.settings.presetName) || headerName || '(채널 없음)';
    m.set(n, (m.get(n) || 0) + 1);
  }
  return { mixed: m.size > 1, counts: [...m.entries()] };
}

module.exports = { channelOverrides, channelMix, normOutTarget };
