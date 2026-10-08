'use strict';
// 💰 이미지·비디오 예상 비용 단가표 — 화면(리본 「💰 예상」)이 쓴다. 순수 계산만(⚠ core/*.js 는 렌더러 번들에 들어간다 — CJS 런타임 자기검사 금지).
//   단가는 2026-10-08 기준: 구글 공식 가격표 · 이 계정 Comfy Cloud 청구 기록(GPU 초 × 시간당 $4.54) 실측.
//   바뀌면 여기 한 곳만 고친다(근거는 작업노트 2026-10 「이미지 3방식 비교」).
const IMAGE_USD = {
  gemini: 0.0336,          // 나노바나나 2.1 즉시 · 1K
  'gemini-batch': 0.0168,  // 나노바나나 2.1 배치(50%)
  comfyCloud: 0.014,       // 클라우드 Krea2 Turbo — 실측 GPU 11.15초/장 × $4.54/시간
};
const VIDEO_USD = {
  comfyCloud: 0.11,        // 클라우드 ComfyUI 영상 — GPU 약 90초/편(이 계정 청구 기록) × $4.54/시간 · 추정(모델마다 다름)
};
const isComfy = (v) => v === 'comfy' || String(v || '').indexOf('comfy::') === 0;

// 이미지 한 장 단가 → { kind: 'paid'|'local'|'sub'|'unknown', usd, label }
function imageUnit(engine, comfyCloud) {
  const e = String(engine || '');
  if (e === 'gemini') return { kind: 'paid', usd: IMAGE_USD.gemini, label: '나노바나나 2.1 즉시 · 장당 $0.0336' };
  if (e === 'gemini-batch') return { kind: 'paid', usd: IMAGE_USD['gemini-batch'], label: '나노바나나 2.1 배치 · 장당 $0.0168(즉시의 절반)' };
  if (isComfy(e)) return comfyCloud
    ? { kind: 'paid', usd: IMAGE_USD.comfyCloud, label: '클라우드 ComfyUI · 장당 약 $0.014(GPU 11초 실측 · 구독 크레딧에서 차감)' }
    : { kind: 'local', usd: 0, label: '로컬 ComfyUI · 전기료 외 무료' };
  if (e === 'flow' || e === 'genspark') return { kind: 'sub', usd: 0, label: (e === 'flow' ? 'Flow' : 'Genspark') + ' 구독 요금제 안(장당 추가 비용 없음 · 일일 한도 있음)' };
  return { kind: 'unknown', usd: null, label: '요금 정보 없음' };
}
// 영상 한 편 단가
function videoUnit(engine, comfyCloud) {
  const e = String(engine || '');
  if (!e || e === 'none') return null;
  if (isComfy(e)) return comfyCloud
    ? { kind: 'paid', usd: VIDEO_USD.comfyCloud, label: '클라우드 ComfyUI · 편당 약 $0.11(GPU 90초 기준 추정 · 모델마다 다름)' }
    : { kind: 'local', usd: 0, label: '로컬 ComfyUI · 전기료 외 무료(편당 수십 분)' };
  if (e === 'flow' || e === 'genspark') return { kind: 'sub', usd: 0, label: (e === 'flow' ? 'Flow(Veo)' : 'Genspark') + ' 구독 크레딧 소진(원화 비용 없음)' };
  return { kind: 'unknown', usd: null, label: '요금 정보 없음' };
}
// 개수 × 단가 → 화면 글자. krw = 1달러의 원화.
function fmtKrw(w) { return w == null ? '' : w === 0 ? '무료' : w < 10 ? `${w.toFixed(1)}원` : `${Math.round(w).toLocaleString()}원`; }
function costText(unit, n, krw) {
  if (!unit) return '';
  if (!n) return '남은 것 없음';
  if (unit.kind === 'sub') return `구독 · ${n}개`;
  if (unit.kind === 'local') return `무료(로컬) · ${n}개`;
  if (unit.kind === 'unknown' || unit.usd == null) return `${n}개 · 요금 정보 없음`;
  return `${fmtKrw(unit.usd * n * (krw || 1400))} · ${n}개`;
}

module.exports = { IMAGE_USD, VIDEO_USD, imageUnit, videoUnit, costText, fmtKrw };
