import React, { useEffect, useState } from 'react';

// 📊 🎧 STT(파일 전사) 진행 패널 (v0.7.64 · 로이 「전사 진행과정을 눈으로 볼 수 있게」)
//   main 의 'stt-progress' 상태를 그대로 그린다(계산은 main · 여기선 표시와 1초 시계만).
//   ⚠ Whisper 서버는 한 덩어리(최대 15분 분량)가 끝나야 응답한다 — 덩어리 안의 % 는 알 수 없어
//     「청크 n/N 칸 + 지금 덩어리가 돌고 있다는 움직이는 띠 + 경과 시간」으로 보여 준다.

const STEPS = [['convert', '① 변환'], ['queue', '② 차례'], ['transcribe', '③ 전사'], ['save', '④ 저장']];
const ORDER = { prepare: 0, convert: 1, queue: 2, transcribe: 3, save: 4 };
const PHASE = { running: '🎧 전사 진행 중', aborting: '⏹ 중단 중 — 진행 중인 덩어리를 마무리합니다', aborted: '⏹ 중단됨', done: '✅ 전사 끝' };

function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}시간 ${m}분 ${ss}초` : m ? `${m}분 ${String(ss).padStart(2, '0')}초` : `${ss}초`;
}
function fmtLen(sec) { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; }

export default function SttProgress({ prog, onAbort, onClose }) {
  const [, tick] = useState(0);
  const live = prog && (prog.phase === 'running' || prog.phase === 'aborting');
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  if (!prog) return null;
  const c = prog.cur;
  const elapsed = (prog.endedAt || Date.now()) - prog.startedAt;
  const si = c ? (ORDER[c.stage] || 0) : 0;
  const chunks = c && c.chunks > 0 ? c.chunks : 0;
  const donePct = chunks ? (c.chunk / chunks) * 100 : 0;
  const slice = chunks ? 100 / chunks : 0;
  const chunkMs = c ? Date.now() - (c.chunkAt || c.stageAt || c.startedAt) : 0;
  // 남은 시간 어림 — 끝낸 덩어리의 평균으로(덩어리 길이가 같으니 가장 정직한 추정 · 첫 덩어리는 모델 로딩이 섞여 어림하지 않는다)
  const fileMs = c ? Date.now() - c.startedAt : 0;
  const eta = c && chunks > 1 && c.chunk >= 1 ? Math.max(0, (fileMs / c.chunk) * (chunks - c.chunk) - chunkMs) : 0;
  const firstWait = c && c.stage === 'transcribe' && c.chunk === 0 && prog.modelLoaded === false;

  return (
    <div data-testid="stt-progress" style={{
      position: 'fixed', right: 16, bottom: 16, width: 380, zIndex: 61,
      background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10,
      boxShadow: '0 6px 24px rgba(0,0,0,.14)', padding: '12px 14px', fontSize: 13, color: 'var(--base)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <b style={{ color: 'var(--strong)', flex: 1 }}>{PHASE[prog.phase] || prog.phase}</b>
        <span style={{ color: '#999', fontSize: 12 }}>⏱ {fmt(elapsed)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>파일 <b style={{ color: 'var(--strong)' }}>{prog.done + prog.fail}</b> / {prog.total}</span>
        <span style={{ color: '#999', fontSize: 12 }}>{prog.fail ? <span style={{ color: 'var(--danger)' }}>실패 {prog.fail}</span> : ''}</span>
      </div>
      <div className="stt-bar"><i style={{ width: ((prog.done + prog.fail) / Math.max(1, prog.total)) * 100 + '%' }} /></div>

      {c && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.name}>[{c.idx}] {c.name}</div>
          <div className="stt-steps">
            {STEPS.map(([k, label]) => <span key={k} className={ORDER[k] < si ? 'done' : ORDER[k] === si ? 'cur' : ''}>{label}</span>)}
          </div>
          {c.stage === 'convert' && <div style={{ color: '#999' }}>mp3 로 바꾸는 중 — 서버가 읽는 형식으로 맞춥니다 ({fmt(Date.now() - c.stageAt)})</div>}
          {c.stage === 'queue' && <div style={{ color: '#999' }}>GPU 순서를 기다리는 중 — 음성 변환 등 다른 GPU 작업이 끝나면 시작합니다 ({fmt(Date.now() - c.stageAt)})</div>}
          {c.stage === 'transcribe' && (
            <>
              <div style={{ color: '#999' }}>
                {chunks > 1 ? `청크 ${Math.min(chunks, c.chunk + 1)}/${chunks} 전사 중` : '전사 중'}
                {c.durationSec ? ` · 음성 ${fmtLen(c.durationSec)} 분량` : ''} · 이 구간 {fmt(chunkMs)}
                {eta ? ` · 남은 시간 약 ${fmt(eta)}` : ''}
              </div>
              <div className="stt-bar big">
                <i style={{ width: donePct + '%' }} />
                {live && <b className="stt-run" style={{ left: donePct + '%', width: (chunks ? slice : 100) + '%' }} />}
              </div>
              {firstWait && <div style={{ color: '#b9772f', marginTop: 3 }}>⏳ Whisper 모델을 불러오는 중일 수 있습니다 — 처음이면 5분 넘게 걸립니다. 멈춘 게 아닙니다.</div>}
              <div style={{ color: '#999', marginTop: 3 }}>서버가 한 덩어리를 끝낼 때까지 중간 % 를 알려 주지 않아, 끝난 덩어리 수로 진행을 보여 드립니다.</div>
            </>
          )}
          {c.stage === 'save' && <div style={{ color: '#999' }}>.txt 로 저장하는 중…</div>}
        </div>
      )}

      {prog.fails && prog.fails.length > 0 && (
        <details style={{ marginTop: 6, fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--danger)' }}>실패 {prog.fails.length}건</summary>
          {prog.fails.map((f, k) => <div key={k} style={{ marginTop: 3 }}>{f.name} — {f.error}</div>)}
        </details>
      )}
      {!live && <div style={{ marginTop: 6, fontSize: 12, color: '#999' }}>성공 {prog.okN != null ? prog.okN : prog.done} / {prog.total} · 원본과 같은 폴더에 .txt 로 저장</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
        {live
          ? <button className="ghost" disabled={prog.phase === 'aborting'} onClick={onAbort}>⏹ 중단</button>
          : <button className="ghost" onClick={onClose}>닫기</button>}
      </div>
    </div>
  );
}
