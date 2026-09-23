import React, { useEffect, useState } from 'react';

// 📊 🎬 유튜브 MP4 굽기 — 진행 상황 패널 (2026-09-23)
//   core/vrew-render.js 가 만든 상태(st)를 main 이 'mp4-progress' 로 보낸다. 여기선 표시만 한다.
//   단계: 준비(.vrew 읽기) → 화면 굽기(조각 병렬) ∥ 음성 인코딩(동시) → 이어붙이기 → 음성 합치기·저장 → 끝

const STEPS = [
  { key: 'read', label: '준비 (.vrew 읽기)' },
  { key: 'video', label: '화면 굽기' },
  { key: 'audio', label: '음성 인코딩' },
  { key: 'concat', label: '이어붙이기' },
  { key: 'mux', label: '음성 합치기 · 저장' },
];
const ORDER = { read: 0, video: 1, audio: 2, concat: 3, mux: 4, done: 5 };

function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}시간 ${m}분` : m ? `${m}분 ${ss}초` : `${ss}초`;
}
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export default function Mp4Progress({ prog, onAbort, onClose }) {
  const [, tick] = useState(0);
  const live = prog && !['done', 'error', 'aborted'].includes(prog.phase);
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  if (!prog) return null;

  const v = prog.video || { done: 0, total: 0, framesDone: 0, framesTotal: 0, active: [] };
  const elapsed = (prog.endedAt || Date.now()) - prog.startedAt;
  const vPct = v.framesTotal ? (v.framesDone / v.framesTotal) * 100 : 0;
  const vElapsed = v.startedAt ? Date.now() - v.startedAt : 0;
  const vLeft = live && prog.phase === 'video' && v.framesDone > 0 ? (vElapsed / v.framesDone) * (v.framesTotal - v.framesDone) : 0;
  // 전체 진행률 — 화면 굽기가 시간의 대부분이라 그 비중을 90%로 둔다(나머지 단계는 수 초)
  const allPct = prog.phase === 'done' ? 100
    : prog.phase === 'read' ? 2
    : prog.phase === 'video' ? 3 + vPct * 0.87
    : prog.phase === 'audio' ? 91 : prog.phase === 'concat' ? 93 : prog.phase === 'mux' ? 97 : vPct * 0.9;
  const cur = ORDER[prog.phase] != null ? ORDER[prog.phase] : -1;

  const stepState = (k) => {
    if (k === 'audio') {
      if (prog.audio === 'none') return 'skip';
      if (prog.audio === 'done') return 'done';
      if (prog.audio === 'run') return 'run';
      return 'wait';
    }
    if (prog.phase === 'error' || prog.phase === 'aborted') return ORDER[k] < 1 || (k === 'video' && v.done === v.total && v.total) ? 'done' : 'wait';
    if (cur > ORDER[k]) return 'done';
    if (cur === ORDER[k]) return 'run';
    return 'wait';
  };
  const icon = { done: '✅', run: '⏳', wait: '·', skip: '—' };

  const head = prog.phase === 'done' ? '✅ 유튜브 MP4 완료'
    : prog.phase === 'error' ? '✗ 유튜브 MP4 실패'
    : prog.phase === 'aborted' ? '⏹ 중단됨'
    : '🎬 유튜브 MP4 굽는 중';

  return (
    <div data-testid="mp4-progress" style={{
      position: 'fixed', right: 16, bottom: 16, width: 390, zIndex: 61,
      background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10,
      boxShadow: '0 6px 24px rgba(0,0,0,.14)', padding: '12px 14px', fontSize: 13, color: 'var(--base)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ color: prog.phase === 'error' ? 'var(--danger)' : 'var(--strong)', flex: 1 }}>{head}</b>
        <span style={{ color: '#999', fontSize: 12 }}>⏱ {fmtDur(elapsed)}</span>
      </div>
      <div style={{ fontSize: 12, color: '#999', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={prog.title}>
        {prog.title}{prog.durationSec ? ` · ${mmss(prog.durationSec)} 영상` : ''}{prog.encoder ? ` · ${prog.encoder === 'nvenc' ? 'NVENC' : 'CPU'}` : ''}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
        <span>전체 <b style={{ color: 'var(--strong)' }}>{Math.floor(allPct)}%</b></span>
        <span style={{ color: '#999', fontSize: 12 }}>{vLeft ? `남은 시간 약 ${fmtDur(vLeft + 3000)}` : ''}</span>
      </div>
      <div style={{ height: 8, background: 'var(--line)', borderRadius: 4, overflow: 'hidden', marginTop: 3 }}>
        <div style={{ width: allPct + '%', height: '100%', background: prog.phase === 'error' ? 'var(--danger)' : 'var(--accent)', transition: 'width .3s' }} />
      </div>

      <div style={{ marginTop: 10 }}>
        {STEPS.map((s) => {
          const ss = stepState(s.key);
          return (
            <div key={s.key} style={{ display: 'flex', gap: 6, alignItems: 'baseline', padding: '2px 0', color: ss === 'wait' || ss === 'skip' ? '#aaa' : 'var(--base)' }}>
              <span style={{ width: 18, textAlign: 'center' }}>{icon[ss]}</span>
              <span style={{ flex: 1, fontWeight: ss === 'run' ? 600 : 400 }}>{s.label}</span>
              <span style={{ fontSize: 12, color: '#999' }}>
                {s.key === 'video' && v.total ? `조각 ${v.done}/${v.total} · ${Math.floor(vPct)}%` : ''}
                {s.key === 'audio' && ss === 'skip' ? '음성 없음' : ''}
                {s.key === 'audio' && ss === 'run' ? '화면과 동시에' : ''}
              </span>
            </div>
          );
        })}
      </div>

      {prog.phase === 'video' && v.active && v.active.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#999' }}>
          지금 굽는 구간(동시 {v.active.length}):{' '}
          {v.active.slice().sort((a, b) => a.start - b.start).map((a) => `${mmss(a.start)}~${mmss(a.end)}${a.type === 'image' ? '' : a.type === 'video' ? '🎞' : ''}`).join(' · ')}
        </div>
      )}

      {prog.phase === 'done' && (
        <div style={{ marginTop: 8, fontSize: 12, wordBreak: 'break-all' }}>
          저장: {prog.outPath}{prog.speed ? <span style={{ color: '#999' }}> · {prog.speed.toFixed(1)}배속</span> : ''}
        </div>
      )}
      {prog.phase === 'error' && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)', wordBreak: 'break-all' }}>
          {prog.error} — .vrew 는 남아 있으니 Vrew 에서 내보낼 수 있습니다
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        {live
          ? <button className="ghost" onClick={onAbort}>⏹ 중단</button>
          : <button className="ghost" onClick={onClose}>닫기</button>}
      </div>
    </div>
  );
}
