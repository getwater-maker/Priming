'use strict';
// core/engine-migrate.js — 🔁 ComfyUI·Genspark 를 쓰지 않게 된 뒤(로이 2026-10-21 「이제 더이상 컴피유아이와 브라우저는 사용하지 않아」 · v0.9.92)
//   옛 이미지·비디오 도구 값을 AI 이미지·AI 영상으로 바꾸는 **한 곳**. 채널 저장소(preset-store) · 헤더(App.jsx) · 제작 입구(main)가 모두 이것을 부른다.
//   ⚠ 순수 계산만 — 렌더러 번들에도 들어간다(CJS 런타임 참조 금지).
//   바꾸는 값: ComfyUI(`comfy` · `comfy::<경로>`) · Genspark(`genspark` · 옛 순환 `rotate`) · 이미지 빈 값(옛 기본 = ComfyUI).
//   그대로 두는 값: AI(`kie:…`) · 「없음」 · 나노바나나(`gemini`·`gemini-batch`) · 그 밖의 옛 값(각자 기존 처리 — Flow 는 「삭제됐다」 로그).
//   바꿀 모델 = 지금 쓰던 것과 같은 계열(이미지 Qwen-Image 2.1 · 비디오 MiniMax H3) — ⛔ id 를 바꾸면 core/kie-models 표와 어긋난다.

const IMG_DEFAULT = 'kie:qwen-2-1';
const VID_DEFAULT = 'kie:minimax-h3';

const isComfy = (v) => v === 'comfy' || String(v || '').indexOf('comfy::') === 0;
function retiredName(v) {
  if (isComfy(v)) return 'ComfyUI';
  if (v === 'genspark' || v === 'rotate') return 'Genspark';
  return '';
}
// → { v: 쓸 값, from: 바꾼 옛 도구 이름('' = 그대로) }
function migrateImage(v) {
  const s = v == null ? '' : String(v);
  if (!s) return { v: IMG_DEFAULT, from: '빈 값' };
  const n = retiredName(s);
  return n ? { v: IMG_DEFAULT, from: n } : { v: s, from: '' };
}
function migrateVideo(v) {
  const s = v == null ? '' : String(v);
  const n = retiredName(s);
  return n ? { v: VID_DEFAULT, from: n } : { v: s, from: '' };
}
// 채널(프리셋) 하나 — 바꿨으면 [{kind, from, to}] 를 돌려준다(제자리 수정)
function migratePreset(p) {
  const out = [];
  if (!p || typeof p !== 'object') return out;
  if (Object.prototype.hasOwnProperty.call(p, 'imgEngine')) {
    const m = migrateImage(p.imgEngine);
    if (m.from) { out.push({ kind: '이미지', from: m.from, to: m.v }); p.imgEngine = m.v; }
  }
  if (Object.prototype.hasOwnProperty.call(p, 'videoEngine')) {
    const m = migrateVideo(p.videoEngine);
    if (m.from) { out.push({ kind: '비디오', from: m.from, to: m.v }); p.videoEngine = m.v; }
  }
  return out;
}
const toLabel = (v) => (v === IMG_DEFAULT ? 'AI 이미지 · Qwen-Image 2.1' : v === VID_DEFAULT ? 'AI 영상 · MiniMax H3' : v);

module.exports = { IMG_DEFAULT, VID_DEFAULT, isComfy, retiredName, migrateImage, migrateVideo, migratePreset, toLabel };
