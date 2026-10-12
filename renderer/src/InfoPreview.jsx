// 📇 정보 카드 ① 미리보기 — main 이 렌더(MP4)와 같은 계산으로 준 프리미티브(사각형·글자·체크)를 그대로 그린다.
//   🔑 배치를 여기서 다시 계산하지 않는다(두 벌이 되면 MP4 와 어긋난다) — 좌표는 1920x1080 기준 그대로, 화면에선 퍼센트·cqw 로 줄인다.
//   바깥 상자(.stage-info)가 container-type 을 가져서 cqw = 스테이지 폭의 1% — 글자 크기도 같은 비율로 따라 줄어든다.
import React from 'react';

const W = 1920, H = 1080;
const hex = (c) => '#' + String(c || 'FFFFFF');
const rgba = (c, op) => {
  const s = String(c || 'FFFFFF'); const r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, op))})`;
};
const CHECK_POLY = [[0.20, 0.54], [0.31, 0.43], [0.44, 0.56], [0.71, 0.25], [0.82, 0.36], [0.44, 0.78]];
const px = (v) => (v / (W / 100)).toFixed(4) + 'cqw';   // 1920 기준 픽셀 → 스테이지 폭의 퍼센트

export default function InfoPreview({ panels, testid = 'stage-info', onPanelDown, selKey }) {
  if (!panels || !panels.length) return null;
  return (
    <div className="stage-info" data-testid={testid} style={{ position: 'absolute', inset: 0, containerType: 'inline-size', overflow: 'hidden', pointerEvents: 'none' }}>
      {panels.map((p, pi) => (
        <div key={(p.mi != null ? 'm' + p.mi : p.type + pi)} className={'stage-info-panel' + (selKey != null && selKey === p.mi ? ' sel' : '')} data-type={p.type} data-testid={'info-panel-' + p.type}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
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
            return <div key={i} style={{ position: 'absolute', left: (q.x / (W / 100)) + '%', top: (q.y / (H / 100)) + '%', transform: center ? 'translate(-50%,-50%)' : 'translate(0,-50%)', textAlign: center ? 'center' : 'left', whiteSpace: 'pre', fontWeight: 700, lineHeight: 1.22, fontSize: px(q.fs), letterSpacing: q.sp ? px(q.sp) : undefined, color: rgba(q.color, q.op), zIndex: q.layer }}>{(q.lines || []).join('\n')}</div>;
          })}
        </div>
      ))}
    </div>
  );
}
