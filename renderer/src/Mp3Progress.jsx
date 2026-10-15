import React, { useEffect, useState } from 'react';
import { useDlDock, DL_Z } from './lib/progDock.js';

// 📊 🎵 mp3 추출 진행 패널(v0.9.31 · 로이 「다운로드 창 작업할 때 진행상황을 볼 수 있는 장치가 전혀 없다」)
//   main 의 'mp3-progress' 상태를 그대로 그린다(계산은 main). ffmpeg 가 변환 중 % 를 주지 않아
//   「파일 n/N + 지금 파일 + 움직이는 띠 + 경과 시간」으로 보여 준다. 자리는 받기·STT 패널과 같은 규칙(lib/progDock).

const PHASE = { running: '🎵 mp3 추출 중', aborting: '⏹ 중단 중 — 지금 파일을 마무리합니다', aborted: '⏹ 중단됨', done: '✅ mp3 추출 끝' };

function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60), ss = s % 60;
  return m ? `${m}분 ${String(ss).padStart(2, '0')}초` : `${ss}초`;
}

export default function Mp3Progress({ prog, onAbort, onClose }) {
  const [, tick] = useState(0);
  const live = prog && (prog.phase === 'running' || prog.phase === 'aborting');
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  const dockBottom = useDlDock(2);
  if (!prog) return null;
  const elapsed = (prog.endedAt || Date.now()) - prog.startedAt;
  const pct = prog.total ? (prog.done / prog.total) * 100 : 0;
  return (
    <div data-testid="mp3-progress" data-dl-dock="2" style={{
      position: 'fixed', right: 16, bottom: dockBottom, width: 380, zIndex: DL_Z, transition: 'bottom .2s',
      background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10,
      boxShadow: '0 6px 24px rgba(0,0,0,.14)', padding: '12px 14px', fontSize: 13, color: 'var(--base)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <b style={{ color: 'var(--strong)', flex: 1 }}>{PHASE[prog.phase] || prog.phase}</b>
        <span style={{ color: '#999', fontSize: 12 }}>⏱ {fmt(elapsed)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>파일 <b style={{ color: 'var(--strong)' }} data-testid="mp3-done">{prog.done}</b> / {prog.total}</span>
        <span style={{ color: '#999', fontSize: 12 }}>✓ {prog.ok}{prog.fail ? ` · ✗ ${prog.fail}` : ''}{prog.skip ? ` · 건너뜀 ${prog.skip}` : ''}</span>
      </div>
      <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden', marginTop: 3 }}>
        <div style={{ width: pct + '%', height: '100%', background: 'var(--accent)', transition: 'width .25s' }} />
      </div>
      {live && prog.file && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: '#7a6c58', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={prog.file} data-testid="mp3-cur">[{prog.idx}/{prog.total}] {prog.file}</div>
          <div className="dl-indet" />
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        {live
          ? <button className="ghost" disabled={prog.phase === 'aborting'} onClick={onAbort}>⏹ 중단</button>
          : <button className="ghost" onClick={onClose}>닫기</button>}
      </div>
    </div>
  );
}
