import React, { useState } from 'react';

// 📊 롱폼 「⚡ 만들기」 진행 팝업 (v0.6.44 · 로이 2026-10-02)
//   main 이 core/make-progress 로 센 상태를 1초마다 'make-progress' 로 보낸다. 여기선 표시만 한다.
//   문장은 문장 단위(n / N 문장 · 지금 #번호), 그림·영상은 개수 단위(n / N 장·개 · 만드는 중 G번호).

function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}시간 ${m}분` : m ? `${m}분 ${ss}초` : `${ss}초`;
}
const pct = (c) => (c && c.total ? Math.min(100, (c.done / c.total) * 100) : 0);
const ICON = { done: '✅', run: '⏳', wait: '·', skip: '—' };

function Row({ icon, label, st, c, unit, sub, ended }) {
  const state = (st && st.state) || 'wait';
  const shown = state === 'run' && ended ? 'wait' : state;   // 중단·실패로 끝났으면 돌던 단계를 ⏳ 로 두지 않는다
  const dim = shown === 'wait' || shown === 'skip';
  const p = pct(c);
  return (
    <div data-testid={`mkp-${label}`} style={{ padding: '5px 0', color: dim && !(c && c.done) ? '#aaa' : 'var(--base)' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
        <span style={{ width: 18, textAlign: 'center' }}>{ended && state === 'run' ? '⏹' : ICON[shown]}</span>
        <span style={{ width: 52, fontWeight: state === 'run' ? 600 : 400 }}>{icon} {label}</span>
        <span style={{ flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {state === 'skip'
            ? <span style={{ color: '#999', fontSize: 12 }}>건너뜀{st.note ? ` · ${st.note}` : ''}</span>
            : c === null
              ? <span style={{ color: '#999', fontSize: 12 }}>{ended && state === 'run' ? '멈춤' : state === 'run' ? '만드는 중' : state === 'done' ? '끝' : '대기'}</span>
            : c && c.total
              ? <><b style={{ color: 'var(--strong)' }}>{c.done}</b> / {c.total} {unit} <span style={{ color: '#999', fontSize: 12 }}>· {Math.floor(p)}%</span></>
              : <span style={{ color: '#999', fontSize: 12 }}>대상 없음</span>}
        </span>
      </div>
      {state !== 'skip' && c && c.total > 0 && (
        <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden', margin: '3px 0 0 24px' }}>
          <div style={{ width: p + '%', height: '100%', background: 'var(--accent)', transition: 'width .3s' }} />
        </div>
      )}
      {sub && <div style={{ fontSize: 12, color: '#999', margin: '3px 0 0 24px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={typeof sub === 'string' ? sub : undefined}>{sub}</div>}
    </div>
  );
}

const gList = (a) => (a && a.length ? a.slice(0, 8).map((n) => 'G' + n).join(', ') + (a.length > 8 ? ` 외 ${a.length - 8}` : '') : '');

export default function MakeProgress({ prog, onAbort, onClose, right = 16 }) {
  const [mini, setMini] = useState(false);
  if (!prog) return null;
  const live = prog.phase === 'running';
  const ended = !live;
  const S = prog.stages || {};
  const sent = prog.sent || {}, image = prog.image || {}, video = prog.video || {};
  const elapsed = (prog.endedAt || prog.now || Date.now()) - prog.startedAt;
  const q = prog.queue ? `[${prog.queue.idx}/${prog.queue.total}] ` : '';
  const head = prog.phase === 'done' ? '✅ 만들기 완료'
    : prog.phase === 'aborted' ? '⏹ 중단됨'
    : prog.phase === 'error' ? '✗ 만들기 실패'
    : '⚡ 만드는 중';

  const box = {
    position: 'fixed', right, bottom: 16, zIndex: 61,
    background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10,
    boxShadow: '0 6px 24px rgba(0,0,0,.14)', fontSize: 13, color: 'var(--base)',
  };

  if (mini) {
    const part = (st, c, u) => (st && st.state === 'skip') ? null : `${u} ${c.done || 0}/${c.total || 0}`;
    const txt = [part(S.tts, sent, '문장'), part(S.image, image, '그림'), part(S.video, video, '영상')].filter(Boolean).join(' · ');
    return (
      <div data-testid="make-progress" data-mini="1" style={{ ...box, padding: '6px 12px', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }}
        onClick={() => setMini(false)} title="눌러서 펼치기">
        <b style={{ color: prog.phase === 'error' ? 'var(--danger)' : 'var(--strong)' }}>{head}</b>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{txt}</span>
        <span style={{ color: '#999', fontSize: 12 }}>⏱ {fmtDur(elapsed)}</span>
      </div>
    );
  }

  const etaOf = (c) => (live && c.eta ? ` · 남은 시간 약 ${fmtDur(c.eta)}` : '');
  const sentSub = S.tts && S.tts.state === 'run' && !ended && sent.cur
    ? `지금 #${sent.cur.num} 「${sent.cur.text}」${etaOf(sent)}` : '';
  const imgSub = S.image && S.image.state === 'run' && !ended
    ? (image.active && image.active.length ? `만드는 중 ${gList(image.active)}` : '준비 중') + etaOf(image) : '';
  const vidSub = S.video && S.video.state === 'run' && !ended
    ? (video.active && video.active.length ? `만드는 중 ${gList(video.active)}` : '그림·음성 준비된 그룹을 기다리는 중') + etaOf(video) : '';

  return (
    <div data-testid="make-progress" style={{ ...box, width: 380, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ color: prog.phase === 'error' ? 'var(--danger)' : 'var(--strong)', flex: 1 }}>{head}</b>
        <span style={{ color: '#999', fontSize: 12 }}>⏱ {fmtDur(elapsed)}</span>
      </div>
      <div style={{ fontSize: 12, color: '#999', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={prog.title}>
        {q}{prog.title || '(제목 없음)'}
      </div>

      <div style={{ marginTop: 8 }}>
        <Row icon="🎙" label="문장" unit="문장" st={S.tts} c={sent} sub={sentSub} ended={ended} />
        <Row icon="🖼" label="그림" unit="장" st={S.image} c={image} sub={imgSub} ended={ended} />
        <Row icon="🎬" label="영상" unit="개" st={S.video} c={video} sub={vidSub} ended={ended} />
        <Row icon="📦" label="출력" st={S.out} c={null} ended={ended}
          sub={prog.outNote || ''} />
      </div>

      {prog.phase === 'error' && prog.error && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)', wordBreak: 'break-all' }}>{prog.error}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
        <button className="ghost" onClick={() => setMini(true)} title="작게 접기(한 줄)">접기</button>
        {live
          ? <button className="ghost" onClick={onAbort}>⏹ 중단</button>
          : <button className="ghost" onClick={onClose}>닫기</button>}
      </div>
    </div>
  );
}
