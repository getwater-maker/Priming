import React, { useEffect, useState } from 'react';

// ⬆ 유튜브 비공개 업로드 — 진행 패널 (2026-09-24)
//   core/youtube-upload.js 의 진행 상태를 main 이 'yt-progress' 로 보낸다. 여기선 표시만 한다.
//   MP4 굽기 패널(우하단)과 겹치지 않게 그 왼쪽에 둔다.

function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}시간 ${m}분` : m ? `${m}분 ${ss}초` : `${ss}초`;
}
const mb = (b) => (Number(b || 0) / 1048576).toFixed(0);

export default function YtProgress({ prog, onAbort, onClose, openUrl }) {
  const [, tick] = useState(0);
  const live = prog && !['done', 'error', 'aborted'].includes(prog.phase);
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  if (!prog) return null;

  const started = prog.startedAt || Date.now();
  const elapsed = (prog.endedAt || Date.now()) - started;
  const pct = prog.phase === 'done' ? 100 : prog.total ? (prog.sent / prog.total) * 100 : 0;
  const left = live && prog.sent > 0 && prog.total ? (elapsed / prog.sent) * (prog.total - prog.sent) : 0;
  const head = prog.phase === 'done' ? '✅ 유튜브 업로드 완료 (비공개)'
    : prog.phase === 'error' ? '✗ 유튜브 업로드 실패'
    : prog.phase === 'aborted' ? '⏹ 업로드 중단됨'
    : prog.phase === 'prepare' ? '⬆ 유튜브 업로드 준비 중'
    : '⬆ 유튜브 업로드 중';

  return (
    <div data-testid="yt-progress" style={{
      position: 'fixed', right: 420, bottom: 16, width: 360, zIndex: 61,
      background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10,
      boxShadow: '0 6px 24px rgba(0,0,0,.14)', padding: '12px 14px', fontSize: 13, color: 'var(--base)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ color: prog.phase === 'error' ? 'var(--danger)' : 'var(--strong)', flex: 1 }}>{head}</b>
        <span style={{ color: '#999', fontSize: 12 }}>⏱ {fmtDur(elapsed)}</span>
      </div>
      <div style={{ fontSize: 12, color: '#999', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={prog.title}>
        {prog.channel ? `「${prog.channel}」 · ` : ''}{prog.title}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
        <span><b style={{ color: 'var(--strong)' }}>{Math.floor(pct)}%</b>{prog.total ? <span style={{ color: '#999', fontSize: 12 }}> · {mb(prog.sent)}/{mb(prog.total)}MB</span> : ''}</span>
        <span style={{ color: '#999', fontSize: 12 }}>{left ? `남은 시간 약 ${fmtDur(left + 2000)}` : ''}{prog.queue ? ` · 대기 ${prog.queue}건` : ''}</span>
      </div>
      <div style={{ height: 8, background: 'var(--line)', borderRadius: 4, overflow: 'hidden', marginTop: 3 }}>
        <div style={{ width: pct + '%', height: '100%', background: prog.phase === 'error' ? 'var(--danger)' : 'var(--accent)', transition: 'width .3s' }} />
      </div>

      {prog.phase === 'done' && (
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6 }}>
          비공개로 올라갔습니다. 공개·예약·썸네일·재생목록은 Studio 에서 정하세요.
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button className="ghost" onClick={() => openUrl(prog.studioUrl)}>✏ Studio 에서 열기</button>
            <button className="ghost" onClick={() => openUrl(prog.url)}>▶ 영상 보기</button>
          </div>
        </div>
      )}
      {prog.phase === 'error' && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)', wordBreak: 'break-all', lineHeight: 1.5 }}>
          {prog.error}<div style={{ color: '#999', marginTop: 4 }}>MP4 는 그대로 있습니다 — 헤더 「⬆ 업로드」로 다시 올릴 수 있습니다.</div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        {live
          ? <button className="ghost" onClick={onAbort}>⏹ 업로드 중단</button>
          : <button className="ghost" onClick={onClose}>닫기</button>}
      </div>
    </div>
  );
}
