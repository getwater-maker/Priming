import React, { useEffect, useState } from 'react';

// 📊 🔗 URL 받아 전사 — 진행 상황 패널 (2026-09-23)
//   받기와 전사가 겹쳐 돌면 로그만으로는 「지금 몇 번째를 받고, 몇 번째를 전사하는지」 알 수 없다.
//   main 의 'urldl-progress' 상태(prog)를 그대로 그린다. 계산은 main 이 하고 여기선 표시만 한다.

const PHASE = {
  prepare: '준비 중…',
  listing: '📺 채널 영상 목록 확인 중…',
  running: '받기 · 전사 진행 중',
  'stt-only': '⬇ 받기 끝 — 남은 전사 진행 중',
  aborting: '⏹ 중단 중 — 진행 중인 작업을 마무리합니다',
  aborted: '⏹ 중단됨',
  done: '✅ 끝',
};
const DL_STAGE = { probe: '정보 확인', download: '받는 중', convert: 'mp3 변환', done: '완료' };

function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}시간 ${m}분` : m ? `${m}분 ${ss}초` : `${ss}초`;
}

function Bar({ value, color }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden', marginTop: 3 }}>
      <div style={{ width: v + '%', height: '100%', background: color || 'var(--accent)', transition: 'width .25s' }} />
    </div>
  );
}

export default function UrlProgress({ prog, onAbort, onClose }) {
  const [, tick] = useState(0);
  const live = prog && !['done', 'aborted'].includes(prog.phase);
  useEffect(() => {                       // 경과 시간이 멈춰 보이지 않게 1초마다 다시 그린다
    if (!live) return undefined;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  if (!prog) return null;

  const { total, dl, stt } = prog;
  const elapsed = (prog.endedAt || Date.now()) - prog.startedAt;
  const txtDone = stt.done + prog.sub + prog.skip;          // .txt 가 생긴 영상 수
  const sttTotal = stt.done + stt.pending + (stt.cur ? 1 : 0);
  // 남은 시간 — 받기 평균으로만 어림한다(전사는 영상 길이에 따라 크게 달라 추정이 거짓말이 된다)
  const dlLeft = live && dl.done > 0 && total > dl.done ? (elapsed / dl.done) * (total - dl.done) : 0;
  const curDlPct = dl.idx ? (dl.stage === 'convert' || dl.stage === 'done' ? 100 : dl.pct) : 0;
  const allPct = total ? ((dl.done + (dl.idx ? curDlPct / 100 : 0)) / total) * 100 : 0;
  const chunkPct = stt.cur && stt.cur.chunks ? (stt.cur.chunk / stt.cur.chunks) * 100 : 0;

  return (
    <div data-testid="urldl-progress" style={{
      position: 'fixed', right: 16, bottom: 16, width: 380, zIndex: 60,
      background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10,
      boxShadow: '0 6px 24px rgba(0,0,0,.14)', padding: '12px 14px', fontSize: 13, color: 'var(--base)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <b style={{ color: 'var(--strong)', flex: 1 }}>🔗 {PHASE[prog.phase] || prog.phase}</b>
        <span style={{ color: '#999', fontSize: 12 }}>⏱ {fmtDur(elapsed)}</span>
      </div>

      {total > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>⬇ 받기 <b style={{ color: 'var(--strong)' }}>{dl.done}</b> / {total}</span>
            <span style={{ color: '#999', fontSize: 12 }}>{dlLeft ? `받기 남은 시간 약 ${fmtDur(dlLeft)}` : ''}</span>
          </div>
          <Bar value={allPct} />
          {dl.idx > 0 && (
            <div style={{ marginTop: 4, fontSize: 12 }}>
              <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={dl.title}>
                [{dl.idx}] {dl.title}
              </div>
              <div style={{ color: '#999' }}>{DL_STAGE[dl.stage] || ''}{dl.stage === 'download' ? ` ${Math.floor(dl.pct)}%` : ''}</div>
              <Bar value={curDlPct} color="var(--accent-d)" />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
            <span>🎧 전사 <b style={{ color: 'var(--strong)' }}>{stt.done}</b>{sttTotal ? ` / ${sttTotal}` : ''}</span>
            <span style={{ color: '#999', fontSize: 12 }}>{stt.pending ? `대기 ${stt.pending}건` : ''}</span>
          </div>
          {stt.cur ? (
            <div style={{ marginTop: 4, fontSize: 12 }}>
              <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={stt.cur.title}>
                [{stt.cur.idx}] {stt.cur.title}
              </div>
              <div style={{ color: '#999' }}>
                {stt.cur.chunks > 1 ? `청크 ${stt.cur.chunk}/${stt.cur.chunks}` : '전사 중'} · {fmtDur(Date.now() - stt.cur.startedAt)}
              </div>
              <Bar value={stt.cur.chunks > 1 ? chunkPct : 0} color="var(--ok)" />
            </div>
          ) : (
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>{live ? '전사할 영상을 기다리는 중' : ''}</div>
          )}

          <div style={{ marginTop: 10, fontSize: 12, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            📝 .txt 완료 <b style={{ color: 'var(--strong)' }}>{txtDone}</b>
            {prog.sub ? ` · 자막 사용 ${prog.sub}` : ''}
            {prog.skip ? ` · 이미 완료 ${prog.skip}` : ''}
            {prog.fail ? <span style={{ color: 'var(--danger)' }}> · 실패 {prog.fail}</span> : ''}
          </div>
        </>
      )}

      {prog.fails && prog.fails.length > 0 && (
        <details style={{ marginTop: 6, fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--danger)' }}>실패 목록 ({prog.fails.length})</summary>
          <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 4 }}>
            {prog.fails.map((f, k) => (
              <div key={k} style={{ marginBottom: 3 }}>{f.idx ? `[${f.idx}] ` : ''}{f.title} — {f.error}</div>
            ))}
          </div>
        </details>
      )}

      {!live && prog.outDir && <div style={{ marginTop: 6, fontSize: 12, color: '#999', wordBreak: 'break-all' }}>저장: {prog.outDir}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
        {live
          ? <button className="ghost" disabled={prog.phase === 'aborting'} onClick={onAbort}>⏹ 중단</button>
          : <button className="ghost" onClick={onClose}>닫기</button>}
      </div>
    </div>
  );
}
