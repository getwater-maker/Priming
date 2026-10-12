// 📇 정보 카드 ① 미리보기 — main 이 렌더(MP4)와 같은 계산으로 준 프리미티브(사각형·글자·체크)를 그대로 그린다.
//   🔑 배치를 여기서 다시 계산하지 않는다(두 벌이 되면 MP4 와 어긋난다) — 좌표는 1920x1080 기준 그대로, 화면에선 퍼센트·cqw 로 줄인다.
//   바깥 상자(.stage-info)가 container-type 을 가져서 cqw = 스테이지 폭의 1% — 글자 크기도 같은 비율로 따라 줄어든다.
import React, { useEffect, useState } from 'react';

const W = 1920, H = 1080;
const hex = (c) => '#' + String(c || 'FFFFFF');
const rgba = (c, op) => {
  const s = String(c || 'FFFFFF'); const r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, op))})`;
};
const CHECK_POLY = [[0.20, 0.54], [0.31, 0.43], [0.44, 0.56], [0.71, 0.25], [0.82, 0.36], [0.44, 0.78]];
// 🔤 판 크기를 잰 글꼴(Pretendard Bold · core/info-ass FONT_FILE)을 그대로 쓴다 — 다른 글꼴(맑은 고딕 등)로 그리면 글자가 판 밖으로 나간다(v0.8.13 · 로이 화면)
//   앱 전체에서 한 번만 부른다. 부르기 전·실패하면 예전 글꼴로 그린다(미리보기일 뿐 — MP4 는 늘 같은 글꼴).
export const INFO_FONT = 'PrimingInfoPretendard';
let _fontP = null, _fontOk = false;
export function loadInfoFont() {
  if (_fontP) return _fontP;
  _fontP = (async () => {
    try {
      const r = window.api && window.api.infoFont ? await window.api.infoFont() : null;
      if (!r || !r.ok) return false;
      const bin = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
      const ff = new FontFace(INFO_FONT, bin.buffer, { weight: '700' });
      await ff.load(); document.fonts.add(ff); _fontOk = true; return true;
    } catch (_) { return false; }
  })();
  return _fontP;
}
export const infoFontFamily = () => (_fontOk ? `"${INFO_FONT}", Pretendard, "Malgun Gothic", sans-serif` : undefined);
const px = (v) => (v / (W / 100)).toFixed(4) + 'cqw';   // 1920 기준 픽셀 → 스테이지 폭의 퍼센트

export default function InfoPreview({ panels, testid = 'stage-info', onPanelDown, onPanelDbl, drag }) {
  const [, setFontTick] = useState(0);
  useEffect(() => { if (!_fontOk) loadInfoFont().then((ok) => { if (ok) setFontTick((v) => v + 1); }); }, []);
  if (!panels || !panels.length) return null;
  return (
    <div className="stage-info" data-testid={testid} style={{ position: 'absolute', inset: 0, containerType: 'inline-size', overflow: 'hidden', pointerEvents: 'none' }}>
      {panels.map((p, pi) => (
        <div key={(p.mi != null ? 'm' + p.mi : p.type + pi)} className={'stage-info-panel' + (drag && drag.mi === p.mi ? ' dragging' : '')} data-type={p.type} data-testid={'info-panel-' + p.type}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...(drag && drag.mi === p.mi && p.mi != null ? { transform: `translate(${(drag.dx * 100).toFixed(3)}%, ${(drag.dy * 100).toFixed(3)}%)` } : {}) }}>
          {onPanelDown && p.box && p.mi != null && (
            <div data-testid="info-hit" title={'📇 끌어서 자리 옮기기(대본에 @자리 꼬리표로 저장) · 두 번 누르면 글자 고치기'}
              onMouseDown={(ev) => onPanelDown(ev, p)} onDoubleClick={(ev) => onPanelDbl && onPanelDbl(ev, p)}
              style={{ position: 'absolute', left: (p.box.x / (W / 100)) + '%', top: (p.box.y / (H / 100)) + '%', width: (p.box.w / (W / 100)) + '%', height: (p.box.h / (H / 100)) + '%', pointerEvents: 'auto', cursor: drag && drag.mi === p.mi ? 'grabbing' : 'grab', zIndex: 40 }} />
          )}
          {(p.prims || []).map((q, i) => {
            if (q.k === 'rect') {
              return <div key={i} style={{ position: 'absolute', left: (q.x / (W / 100)) + '%', top: (q.y / (H / 100)) + '%', width: (q.w / (W / 100)) + '%', height: (q.h / (H / 100)) + '%', background: rgba(q.color, q.op), borderRadius: q.r ? px(q.r) : 0, zIndex: q.layer }} />;
            }
            if (q.k === 'check') {
              const pts = CHECK_POLY.map(([x, y]) => `${(x * q.size).toFixed(1)},${(y * q.size).toFixed(1)}`).join(' ');
              return <svg key={i} viewBox={`0 0 ${q.size} ${q.size}`} style={{ position: 'absolute', left: (q.x / (W / 100)) + '%', top: (q.y / (H / 100)) + '%', width: (q.size / (W / 100)) + '%', height: (q.size / (H / 100)) + '%', zIndex: q.layer, opacity: q.op }}><polygon points={pts} fill={hex(q.color)} /></svg>;
            }
            // 글자 — an4 = 왼쪽 가운데 기준 · an5 = 가운데 기준
            const center = q.an === 5;
            return <div key={i} style={{ position: 'absolute', left: (q.x / (W / 100)) + '%', top: (q.y / (H / 100)) + '%', transform: center ? 'translate(-50%,-50%)' : 'translate(0,-50%)', textAlign: center ? 'center' : 'left', whiteSpace: 'pre', fontWeight: 700, fontFamily: infoFontFamily(), lineHeight: 1.22, fontSize: px(q.fs), letterSpacing: q.sp ? px(q.sp) : undefined, color: rgba(q.color, q.op), zIndex: q.layer }}>{(q.lines || []).join('\n')}</div>;
          })}
        </div>
      ))}
    </div>
  );
}
