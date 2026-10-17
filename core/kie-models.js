'use strict';
// core/kie-models.js — 🧩 kie.ai 이미지·비디오 모델 표(v0.9.66 · 로이 2026-10-17 「장기적으로 kie 하나로 운영」)
//   엔진 값 = `kie:<id>` (헤더 ② 이미지 · ③ 비디오 · 채널 편집 · 큐 설정에 그대로 저장된다).
//   ⚠ 순수 데이터·계산만 — 렌더러 번들에도 들어간다(드롭다운·💰 예상 비용). 네트워크는 core/kie-api.
//   모델 문자열·입력 칸은 docs.kie.ai 의 각 모델 OpenAPI 원문, 가격은 kie.ai/pricing 표(2026-10-17 · 1크레딧 = $0.005).
//   바뀌면 이 표 한 곳만 고친다.
//   id      = 엔진 값 꼬리(⛔ 바꾸지 말 것 — 저장된 채널·큐 값이 「(옛 설정)」이 된다)
//   model   = createTask 의 model 문자열 · in(o) = 그 모델의 input 을 만든다
//   usd     = 이미지 장당 · usdSec = 영상 초당 · usdByDur = 영상 편당(길이별)
//   durs    = 비디오가 받는 길이(초) — MAX_SEC 를 넘는 길이는 쓰지 않는다(그보다 긴 그룹은 video-fit 이 늘리거나 반복)
//   🔇 그룹 영상은 내레이션과 겹쳐 음소거하므로(로이 확정) 소리를 끌 수 있는 모델은 끈다(값도 싸다).

const PREFIX = 'kie:';
const MAX_SEC = 8;   // 영상 한 편 최대 길이 — ComfyUI 영상(videoMaxSec 8)과 같다 · 길이가 요금을 정한다(메모: 8→5초가 최대 절감)
const CR = 0.005;    // 1크레딧 = $0.005
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// 화면 비율 → 모델이 받는 값(없으면 16:9)
const ar = (aspect, ok) => (ok.includes(aspect) ? aspect : (ok.includes('16:9') ? '16:9' : ok[0]));
const AR_STD = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];

const IMAGE = [
  { id: 'gpt-image-2', label: 'GPT Image 2', model: 'gpt-image-2-text-to-image', usd: 6 * CR,
    in: (o) => ({ prompt: o.prompt, aspect_ratio: ar(o.aspect, AR_STD), resolution: '1K' }) },
  { id: 'gpt-image-2-5', label: 'GPT Image 2.5 (Flare)', model: 'gpt-image-2-5-flare-text-to-image', usd: 6 * CR,
    in: (o) => ({ prompt: o.prompt, aspect_ratio: ar(o.aspect, AR_STD), resolution: '1K' }) },
  { id: 'nano-banana-2', label: 'Nano Banana 2', model: 'nano-banana-2', usd: 8 * CR,
    in: (o) => ({ prompt: o.prompt, aspect_ratio: ar(o.aspect, AR_STD), resolution: '1K', output_format: 'png' }) },
  { id: 'nano-banana-2-1', label: 'Nano Banana 2.1', model: 'nano-banana-2-1', usd: 4 * CR,
    in: (o) => ({ prompt: o.prompt, aspect_ratio: ar(o.aspect, AR_STD), resolution: '1K', output_format: 'png' }) },
  { id: 'nano-banana-pro', label: 'Nano Banana Pro', model: 'nano-banana-pro', usd: 18 * CR,
    in: (o) => ({ prompt: o.prompt, aspect_ratio: ar(o.aspect, AR_STD), resolution: '1K', output_format: 'png' }) },
  { id: 'seedream-5-pro', label: 'Seedream 5.0 Pro', model: 'seedream/5-pro-text-to-image', usd: 7 * CR,
    in: (o) => ({ prompt: o.prompt, aspect_ratio: ar(o.aspect, AR_STD), quality: 'basic', output_format: 'png' }) },
  { id: 'seedream-5-flash', label: 'Seedream 5.0 Flash', model: 'seedream/5-flash-text-to-image', usd: 3.24 * CR,
    in: (o) => ({ prompt: o.prompt, aspect_ratio: ar(o.aspect, AR_STD), size: '1K', output_format: 'png' }) },
  { id: 'seedream-4-5', label: 'Seedream 4.5', model: 'seedream/4.5-text-to-image', usd: 6.5 * CR,
    in: (o) => ({ prompt: o.prompt, aspect_ratio: ar(o.aspect, AR_STD), quality: 'basic' }) },
  { id: 'qwen-2-1', label: 'Qwen-Image 2.1', model: 'qwen2-1/text-to-image', usd: 4 * CR,
    in: (o) => ({ prompt: o.prompt, aspect_ratio: ar(o.aspect, ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9']), resolution: '1K', output_format: 'png', enhance_prompt: false }) },
  { id: 'z-image', label: 'Z-Image', model: 'z-image', usd: 0.8 * CR,
    in: (o) => ({ prompt: String(o.prompt).slice(0, 1000), aspect_ratio: ar(o.aspect, ['1:1', '4:3', '3:4', '16:9', '9:16']) }) },
  { id: 'imagen4-fast', label: 'Imagen 4 Fast', model: 'google/imagen4-fast', usd: 4 * CR,
    in: (o) => ({ prompt: String(o.prompt).slice(0, 5000), aspect_ratio: ar(o.aspect, ['1:1', '16:9', '9:16', '3:4', '4:3']) }) },
  { id: 'flux-2-pro', label: 'Flux-2 Pro', model: 'flux-2/pro-text-to-image', usd: 5 * CR,
    in: (o) => ({ prompt: String(o.prompt).slice(0, 5000), aspect_ratio: ar(o.aspect, ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']), resolution: '1K' }) },
  { id: 'grok-image-2', label: 'Grok Imagine Image 2.0', model: 'grok-imagine-image-2-0/text-to-image', usd: 4 * CR,
    in: (o) => ({ prompt: String(o.prompt).slice(0, 8000), aspect_ratio: ar(o.aspect, ['1:1', '2:3', '3:2', '16:9', '9:16']) }) },
];

const AR_V = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
const VIDEO = [
  { id: 'seedance-2-5', label: 'Seedance 2.5 · 720p', model: 'bytedance/seedance-2-5', usdSec: 63 * CR, durs: range(4, 30),
    note: '소리 끔으로 요청 — 표의 값은 소리 포함 가격이라 실제는 이보다 낮을 수 있음',
    in: (o) => ({ prompt: o.prompt, first_frame_url: o.imageUrl, resolution: '720p', aspect_ratio: ar(o.aspect, AR_V), duration: o.durationSec, generate_audio: false }) },
  { id: 'seedance-2-fast', label: 'Seedance 2.0 Fast · 720p', model: 'bytedance/seedance-2-fast', usdSec: 24.8 * CR, durs: range(4, 15),
    in: (o) => ({ prompt: o.prompt, first_frame_url: o.imageUrl, resolution: '720p', aspect_ratio: ar(o.aspect, AR_V), duration: o.durationSec, generate_audio: false }) },
  { id: 'seedance-2-mini', label: 'Seedance 2.0 Mini · 720p', model: 'bytedance/seedance-2-mini', usdSec: 8.2 * CR, durs: range(4, 15),
    in: (o) => ({ prompt: o.prompt, first_frame_url: o.imageUrl, resolution: '720p', aspect_ratio: ar(o.aspect, AR_V), duration: o.durationSec, generate_audio: false }) },
  { id: 'grok-video-1-5', label: 'Grok Imagine Video 1.5 · 720p', model: 'grok-imagine-video-1-5-preview', usdSec: 4.5 * CR, durs: range(1, 15),
    in: (o) => ({ prompt: String(o.prompt).slice(0, 4096), image_urls: [o.imageUrl], aspect_ratio: ar(o.aspect, ['1:1', '16:9', '9:16', '3:2', '2:3']), resolution: '720p', duration: o.durationSec }) },
  { id: 'kling-3', label: 'Kling 3.0 · 720p', model: 'kling-3.0/video', usdSec: 14 * CR, durs: range(3, 15),
    in: (o) => ({ prompt: o.prompt, image_urls: [o.imageUrl], sound: false, duration: String(o.durationSec), aspect_ratio: ar(o.aspect, ['16:9', '9:16', '1:1']), mode: 'std', multi_shots: false }) },
  { id: 'kling-3-turbo', label: 'Kling 3.0 Turbo · 720p', model: 'kling/v3-turbo-image-to-video', usdSec: 18 * CR, durs: range(3, 15),
    in: (o) => ({ prompt: o.prompt, image_urls: [o.imageUrl], duration: String(o.durationSec), resolution: '720p' }) },
  { id: 'wan-3', label: 'Wan 3.0 · 720p', model: 'wan/3-0-video', usdSec: 16 * CR, durs: range(2, 30),
    in: (o) => ({ prompt: o.prompt, first_frame_url: o.imageUrl, resolution: '720P', aspect_ratio: ar(o.aspect, ['16:9', '4:3', '1:1', '3:4', '9:16']), duration: o.durationSec, audio: false }) },
  { id: 'wan-3-prime', label: 'Wan 3.0 Prime · 720p', model: 'wan/3-0-video-prime', usdSec: 25.2 * CR, durs: range(2, 30),
    in: (o) => ({ prompt: o.prompt, first_frame_url: o.imageUrl, resolution: '720P', aspect_ratio: ar(o.aspect, ['16:9', '4:3', '1:1', '3:4', '9:16']), duration: o.durationSec, audio: false }) },
  { id: 'minimax-h3', label: 'MiniMax H3 · 768P', model: 'minimax-h3/image-to-video', usdSec: 8 * CR, usdPlus: 4 * CR, durs: range(4, 15),
    note: '그림 한 장마다 4크레딧($0.02) 추가 · 비율은 그림을 따른다',
    in: (o) => ({ prompt: String(o.prompt).slice(0, 7000), first_frame_url: o.imageUrl, duration: o.durationSec, resolution: '768P' }) },
  { id: 'happyhorse-1-1', label: 'HappyHorse 1.1 · 720p', model: 'happyhorse-1-1/image-to-video', usdSec: 22.5 * CR, durs: range(3, 15),
    in: (o) => ({ prompt: o.prompt, image_urls: [o.imageUrl], resolution: '720p', duration: o.durationSec }) },
  { id: 'veo-3-1-lite', label: 'Veo 3.1 Lite · 720p', model: 'veo-3-1', usdByDur: { 4: 30 * CR, 6: 30 * CR, 8: 30 * CR }, durs: [4, 6, 8],
    in: (o) => ({ model: 'veo3_lite', prompt: o.prompt, image_urls: [o.imageUrl], generation_type: 'FIRST_AND_LAST_FRAMES_2_VIDEO', aspect_ratio: ar(o.aspect, ['16:9', '9:16']), resolution: '720p', duration: o.durationSec }) },
  { id: 'veo-3-1-fast', label: 'Veo 3.1 Fast · 720p', model: 'veo-3-1', usdByDur: { 4: 60 * CR, 6: 60 * CR, 8: 60 * CR }, durs: [4, 6, 8],
    in: (o) => ({ model: 'veo3_fast', prompt: o.prompt, image_urls: [o.imageUrl], generation_type: 'FIRST_AND_LAST_FRAMES_2_VIDEO', aspect_ratio: ar(o.aspect, ['16:9', '9:16']), resolution: '720p', duration: o.durationSec }) },
  { id: 'vidu-q4', label: 'Vidu Q4 · 720p', model: 'vidu-q4/image-to-video', usdSec: 15.2 * CR, durs: range(3, 16),
    in: (o) => ({ prompt: o.prompt, image_url: o.imageUrl, duration: o.durationSec, resolution: '720p', audio: false }) },
  { id: 'gemini-omni-1-1', label: 'Gemini Omni 1.1 Flash · 720p', model: 'google/gemini-omni-flash-1-1', usdByDur: { 4: 63 * CR, 6: 84 * CR, 8: 105 * CR, 10: 126 * CR }, durs: [4, 6, 8, 10],
    in: (o) => ({ prompt: o.prompt, first_frame_url: o.imageUrl, duration: String(o.durationSec), aspect_ratio: ar(o.aspect, ['16:9', '9:16']), resolution: '720p' }) },
];

const isKieVal = (v) => String(v || '').indexOf(PREFIX) === 0;
const idOf = (v) => (isKieVal(v) ? String(v).slice(PREFIX.length) : '');
const valOf = (m) => PREFIX + m.id;
function byVal(v, kind) {
  const id = idOf(v); if (!id) return null;
  const list = kind === 'video' ? VIDEO : kind === 'image' ? IMAGE : IMAGE.concat(VIDEO);
  return list.find((m) => m.id === id) || null;
}
// 음성 길이(초) → 모델이 받는 길이(MAX_SEC 이하) 중 음성보다 길거나 같은 가장 짧은 것 · 없으면 그 안에서 가장 긴 것(모자라는 만큼은 video-fit 이 늘린다)
function pickDuration(m, wantSec) {
  const all = ((m && m.durs) || [5]).slice().sort((a, b) => a - b);
  const ds = all.filter((d) => d <= MAX_SEC); if (!ds.length) ds.push(all[0]);
  const w = Math.max(1, Math.ceil(Number(wantSec) || 0));
  return ds.find((d) => d >= w) || ds[ds.length - 1];
}
// 영상 한 편 요금(달러)
function videoUsd(m, sec) {
  if (!m) return 0;
  const d = sec || pickDuration(m, 0);
  if (m.usdByDur) return m.usdByDur[d] != null ? m.usdByDur[d] : Math.max(...Object.values(m.usdByDur));
  return (m.usdSec || 0) * d + (m.usdPlus || 0);
}
// 드롭다운 꼬리 글자 — 「$0.023/초」·「$0.15/편」·「$0.03/장」
const fmtUsd = (u) => '$' + String(Number(u.toFixed(4)));
function priceTag(m) {
  if (!m) return '';
  if (m.usd != null) return `${fmtUsd(m.usd)}/장`;
  if (m.usdByDur) return `${fmtUsd(videoUsd(m, pickDuration(m, 0)))}/편~`;
  return `${fmtUsd(m.usdSec)}/초`;
}
const buildImageInput = (m, o) => m.in({ ...o, prompt: String(o.prompt || '') });
const buildVideoInput = (m, o) => m.in({ ...o, prompt: String(o.prompt || '') });

module.exports = { PREFIX, MAX_SEC, IMAGE, VIDEO, isKieVal, idOf, valOf, byVal, pickDuration, videoUsd, priceTag, buildImageInput, buildVideoInput };
