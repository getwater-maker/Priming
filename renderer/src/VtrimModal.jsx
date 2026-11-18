import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import api from './lib/ipc.js';
import VLook from '../../core/visual-look.js';

/**
 * ✂ 비디오 시작점 변경(v1.0.63 · 로이 2026-11-18 · Vrew 「비디오 시작점 변경」 그대로)
 *   위 = 큰 영상 미리보기 · 아래 = 영상 전체 필름 띠(+ 소리가 있으면 같은 시간 기준의 파형 띠)
 *   파란 상자 = 쓸 구간(처음엔 이 그룹 길이만큼) — 상자를 끌면 옮기고, 양 끝을 끌면 시작·끝을 바꾼다 · 주황 선 = 재생 위치(띠를 눌러 옮긴다)
 *   ▶ = 주황 선부터 재생(상자 안에서 시작하면 상자 끝에서 멈춘다) · ↶ 되돌리기 = 처음부터 그룹 길이 · ✓ 적용 = 그룹 look.vtrim(core/visual-look 한 곳)
 *   props: c(그룹 DTO · videoPath·look) · target(이 그림이 보이는 시간 · 초) · onApply(vtrim|null) · onClose()
 */
const fmt = (t) => { const s = Math.max(0, Math.round(Number(t) || 0));   // 0.999초를 00:00 으로 내리지 않게(반올림)
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const media = (p, v = '') => 'media://' + encodeURIComponent(p) + (v ? `?v=${encodeURIComponent(v)}` : '');

export default function VtrimModal({ c, target, onApply, onClose }) {
  const file = c && c.videoPath;
  const [info, setInfo] = useState(null);   // { dur, strip, hasAudio, peaks }
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);     // { in, out }
  const [head, setHead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [W, setW] = useState(0);
  const vidRef = useRef(null), stripRef = useRef(null), waveRef = useRef(null), rafRef = useRef(0), stopAtRef = useRef(null), dragRef = useRef(null);
  const selRef = useRef(sel); selRef.current = sel;
  const tgt = Number(target) > 0 ? Number(target) : 0;
  const defSel = (dur) => ({ in: 0, out: Math.round(Math.min(dur, tgt > 0 ? tgt : dur) * 100) / 100 });

  useEffect(() => {
    let dead = false;
    (async () => {
      const r = await api.videoStrip({ file }).catch((e) => ({ ok: false, error: e.message }));
      if (dead) return;
      if (!r || !r.ok) { setErr((r && r.error) || '영상 정보를 읽지 못했습니다'); return; }
      setInfo(r);
      const cur = VLook.vtrimSeg(c.look && c.look.vtrim, r.dur);
      const s = cur || defSel(r.dur);
      setSel(s); setHead(s.in);
    })();
    return () => { dead = true; cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  useLayoutEffect(() => {
    const el = stripRef.current; if (!el) return undefined;
    const m = () => setW(el.getBoundingClientRect().width);
    m(); const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(m) : null; if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, [info]);
  // 🎵 파형 그리기 — 상자 안은 밝게
  useEffect(() => {
    const cv = waveRef.current; if (!cv || !info || !info.peaks || !info.peaks.length || !W) return;
    const H = cv.clientHeight || 40; const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const P = info.peaks, n = P.length, bw = W / n, mid = H / 2;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n * info.dur; const on = sel && t >= sel.in && t <= sel.out;
      g.fillStyle = on ? 'rgba(56,189,248,.95)' : 'rgba(148,163,184,.45)';
      const h = Math.max(1, P[i] * (H - 4));
      g.fillRect(i * bw, mid - h / 2, Math.max(1, bw - 0.6), h);
    }
  }, [info, W, sel]);

  const dur = info ? info.dur : 0;
  const pps = dur > 0 && W > 0 ? W / dur : 0;
  const seek = (t) => { const v = vidRef.current; const tt = Math.max(0, Math.min(dur, t)); setHead(tt); if (v) { try { v.currentTime = tt; } catch (_) {} } };
  function stop() { const v = vidRef.current; if (v) try { v.pause(); } catch (_) {} cancelAnimationFrame(rafRef.current); setPlaying(false); }
  function play() {
    const v = vidRef.current; if (!v || !sel) return;
    if (playing) { stop(); return; }
    const from = head >= dur - 0.05 ? sel.in : head;
    stopAtRef.current = from < sel.out - 0.05 ? sel.out : dur;   // 상자 안에서 시작 = 상자 끝에서 멈춤
    try { v.currentTime = from; } catch (_) {}
    v.muted = false; const p = v.play(); if (p && p.catch) p.catch(() => {});
    setPlaying(true);
    const tick = () => {
      const t = v.currentTime; setHead(t);
      if (t >= stopAtRef.current - 0.02 || v.ended) { stop(); setHead(Math.min(t, stopAtRef.current)); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }
  // 끌기 — kind: 'move'(상자) · 'l'·'r'(양 끝) · 'head'(띠 바탕 = 재생 위치)
  function down(kind, ev) {
    if (!sel || !pps) return;
    ev.preventDefault(); ev.stopPropagation(); if (playing) stop();
    const R = stripRef.current.getBoundingClientRect();
    const x0 = ev.clientX, s0 = { ...sel };
    if (kind === 'head') seek((x0 - R.left) / pps);
    const MIN = VLook.VTRIM_MIN;
    const mv = (e) => {
      const dt = (e.clientX - x0) / pps;
      if (kind === 'head') { seek((e.clientX - R.left) / pps); return; }
      let a = s0.in, b = s0.out;
      if (kind === 'move') { const L = b - a; a = Math.max(0, Math.min(dur - L, a + dt)); b = a + L; }
      else if (kind === 'l') a = Math.max(0, Math.min(b - MIN, a + dt));
      else b = Math.min(dur, Math.max(a + MIN, b + dt));
      const n = { in: Math.round(a * 100) / 100, out: Math.round(b * 100) / 100 };
      setSel(n); seek(kind === 'r' ? n.out : n.in);
    };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); dragRef.current = null; };
    dragRef.current = kind;
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  }
  function apply() {
    if (!sel || !dur) return;
    const d0 = defSel(dur);
    const none = sel.in < 0.02 && sel.out >= d0.out - 0.05;   // 처음부터 그룹 길이(이상) = 자를 것 없음
    onApply(none ? null : { in: sel.in, out: sel.out, d: Math.round(dur * 100) / 100 });
  }
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === ' ' && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) { e.preventDefault(); play(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  const L = sel ? sel.out - sel.in : 0;
  const hasWave = !!(info && info.hasAudio && info.peaks && info.peaks.length);
  return (
    <div className="modal-bg show vtrim-bg" style={{ zIndex: 97 }} data-testid="vtrim-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="vtrim-card">
        <div className="vtrim-h"><b>비디오 시작점 변경</b><button className="vtrim-x" data-testid="vtrim-close" title="닫기(Esc)" onClick={onClose}>✕</button></div>
        <div className="vtrim-stage">
          <video ref={vidRef} src={file ? media(file, c.videoVersion) : undefined} data-testid="vtrim-video" preload="auto" playsInline
            onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = head; } catch (_) {} }} />
        </div>
        {err ? <div className="vtrim-err" data-testid="vtrim-err">⚠ {err}</div> : (
          <div className="vtrim-tl">
            <div className="vtrim-strips" ref={stripRef} data-testid="vtrim-strip" onMouseDown={(e) => down('head', e)}>
              <div className="vtrim-film" style={info && info.strip ? { backgroundImage: `url("${media(info.strip)}")` } : undefined} />
              {hasWave && <canvas ref={waveRef} className="vtrim-wave" data-testid="vtrim-wave" />}
              {sel && pps > 0 && <>
                <div className="vtrim-dim" style={{ left: 0, width: sel.in * pps }} />
                <div className="vtrim-dim" style={{ left: sel.out * pps, right: 0 }} />
                <div className="vtrim-box" data-testid="vtrim-box" data-in={sel.in} data-out={sel.out} style={{ left: sel.in * pps, width: L * pps }}
                  onMouseDown={(e) => down('move', e)} title="끌어서 쓸 구간을 옮깁니다 · 양 끝을 끌면 시작·끝을 바꿉니다">
                  <span className="vtrim-h-l" data-testid="vtrim-h-l" onMouseDown={(e) => down('l', e)} />
                  <span className="vtrim-h-r" data-testid="vtrim-h-r" onMouseDown={(e) => down('r', e)} />
                  <span className="vtrim-len" data-testid="vtrim-len">{fmt(L)}</span>
                </div>
                <div className="vtrim-head" data-testid="vtrim-head" style={{ left: head * pps }} />
              </>}
            </div>
            {sel && pps > 0 && <div className="vtrim-marks">
              <span style={{ left: sel.in * pps }}>{fmt(sel.in)}</span>
              <span className="r" style={{ left: sel.out * pps }}>{fmt(sel.out)}</span>
              <span className="vtrim-time" data-testid="vtrim-time" style={{ left: head * pps }}>{fmt(head)} / {fmt(dur)}</span>
            </div>}
            {!info && <div className="meta" style={{ padding: 8 }}>⏳ 필름 띠를 만드는 중…</div>}
            {info && tgt > 0 && <div className="meta vtrim-note">이 그룹은 {tgt.toFixed(1)}초 동안 보입니다{L > 0 && L + 0.05 < tgt ? ' — 고른 구간이 더 짧아 만들 때 느리게(또는 반복해) 길이를 맞춥니다' : ''}{info.hasAudio ? '' : ' · 이 영상에는 소리가 없습니다'}</div>}
          </div>
        )}
        <div className="vtrim-foot">
          <button className="vtrim-play" data-testid="vtrim-play" disabled={!sel} title="주황 선부터 재생(Space)" onClick={play}>{playing ? '■' : '▶'}</button>
          <span className="vtrim-act">
            <button className="ghost" data-testid="vtrim-reset" disabled={!info} title="처음부터 그룹 길이만큼으로 되돌립니다" onClick={() => { if (!info) return; stop(); const s = defSel(info.dur); setSel(s); seek(0); }}>↶ 되돌리기</button>
            <button data-testid="vtrim-apply" disabled={!sel} onClick={apply}>✓ 적용</button>
          </span>
        </div>
      </div>
    </div>
  );
}
