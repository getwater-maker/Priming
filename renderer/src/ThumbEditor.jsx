import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadInfoFont, infoFontFamily } from './InfoPreview.jsx';
import * as TE from '../../core/thumb-edit.js';

// 🖼 썸네일 편집기(v0.9.102 · 로이 2026-10-23 · 설계 docs/썸네일-편집기-설계.md)
//   배경 그림(캔바 「글자 없는 배경」 → 없으면 Codex 바탕) 위에 헤드라인을 얹어 1280×720 PNG 로 내보낸다.
//   규칙: 한 썸네일의 모든 줄은 같은 크기(강조는 색) · 글자는 왼쪽·가운데 6칸만 · 얼굴 가림 경고 · 기존 파일은 _캔바원본 으로 보존 후 같은 이름 저장.
//   미리보기는 내보내기와 같은 그리기 함수 하나(draw)로 — 두 번 계산하지 않는다.
const W = TE.W, H = TE.H, GAP = 1.12;
const fontCss = (size) => `700 ${size}px ${infoFontFamily() || 'Pretendard, "Malgun Gothic", sans-serif'}`;

function draw(ctx, img, st, show) {
  ctx.clearRect(0, 0, W, H);
  if (img) {   // 가로 맞춤 + 가운데(바탕이 16:9 가 아니면 잘린다)
    const k = Math.max(W / img.width, H / img.height), w = img.width * k, h = img.height * k;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  } else { ctx.fillStyle = '#2b2620'; ctx.fillRect(0, 0, W, H); }
  ctx.font = fontCss(st.size); ctx.textBaseline = 'top'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  st.lines.forEach((l, i) => {
    const y = st.pos.y + i * st.size * GAP;
    ctx.lineWidth = Math.max(4, st.size * 0.16); ctx.strokeStyle = '#000'; ctx.strokeText(l.text, st.pos.x, y);
    ctx.fillStyle = TE.lineHex(l); ctx.fillText(l.text, st.pos.x, y);
  });
  if (show) {   // 편집 보조선(내보내기에는 없다)
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1; ctx.setLineDash([6, 6]);
    for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo((W / 3) * i, 0); ctx.lineTo((W / 3) * i, H); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, (H / 3) * i); ctx.lineTo(W, (H / 3) * i); ctx.stroke(); }
    ctx.fillStyle = 'rgba(180,40,30,.18)'; ctx.fillRect((W / 3) * 2, 0, W / 3, H);   // 오른쪽 열 금지
    ctx.restore();
  }
}
const loadImg = (src) => new Promise((res) => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

export default function ThumbEditor({ data, onClose, onSaved }) {
  const api = window.api;
  const cv = useRef(null), imgs = useRef({}), face = useRef({});
  const [an, setAn] = useState('A');
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [sts, setSts] = useState(() => Object.fromEntries(TE.AN.map((a) => {
    const d = data.an[a], lines = (d.lines || []).map((l) => ({ ...l }));
    const cell = TE.CELLS.includes(d.cell) ? d.cell : '왼쪽-가운데';
    return [a, { lines, size: d.size || 0, cell, pos: null, edited: !!d.edited, dirty: false }];   // pos = 끌어서 정한 자리(없으면 칸 기준 자동)
  })));
  const raw = sts[an], d = data.an[an];
  const blockH = Math.round(raw.lines.length * raw.size * GAP);
  const st = { ...raw, pos: raw.pos || (({ x, y }) => ({ x, y }))(TE.cellBox(raw.cell, W, H, blockH)) };
  const patch = (p, dirty = true) => setSts((s) => ({ ...s, [an]: { ...s[an], ...p, dirty: s[an].dirty || dirty } }));

  // 글꼴·그림 읽기 + 안마다 글자 크기가 비었으면 자동 크기
  useEffect(() => { let on = true; (async () => {
    await loadInfoFont();
    for (const a of TE.AN) {
      const p = data.an[a].bg; if (!p) continue;
      imgs.current[a] = await loadImg(await api.thumbEditImage(p));
      const im = imgs.current[a];
      if (im) { const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d', { willReadFrequently: true }); draw(x, im, { lines: [], size: 10, pos: { x: 0, y: 0 } }, false); x.drawImage(c, 0, 0); const px = x.getImageData(0, 0, 64, 36).data, f = new Uint8Array(64 * 36 * 3); for (let i = 0, j = 0; i < px.length; i += 4) { f[j++] = px[i]; f[j++] = px[i + 1]; f[j++] = px[i + 2]; } face.current[a] = f; }
    }
    if (!on) return;
    setSts((s) => { const n = { ...s }; for (const a of TE.AN) if (!n[a].size) n[a] = { ...n[a], size: autoSize(n[a].lines, n[a].cell) }; return n; });
    setReady(true);
  })(); return () => { on = false; }; /* eslint-disable-next-line */ }, []);

  const ctxM = useMemo(() => document.createElement('canvas').getContext('2d'), []);
  const measure = (t, s) => { ctxM.font = fontCss(s); return ctxM.measureText(t).width; };
  function autoSize(lines, cell) { const b = TE.cellBox(cell); return TE.fitSize(lines, measure, b.maxW, H * 0.62); }

  useEffect(() => { if (ready && cv.current) draw(cv.current.getContext('2d'), imgs.current[an], st, true); });

  // 끌어 옮기기(캔버스 표시 크기 ↔ 1280×720 환산)
  const drag = useRef(null);
  const toXY = (e) => { const r = cv.current.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
  const onDown = (e) => { const p = toXY(e); drag.current = { dx: p.x - st.pos.x, dy: p.y - st.pos.y }; cv.current.setPointerCapture(e.pointerId); };
  const onMove = (e) => { if (!drag.current) return; const p = toXY(e); patch({ pos: { x: Math.round(Math.max(0, Math.min(W - 40, p.x - drag.current.dx))), y: Math.round(Math.max(0, Math.min(H - 40, p.y - drag.current.dy))) }, cell: cellAt(p.x - drag.current.dx, p.y - drag.current.dy) }); };
  const onUp = () => { drag.current = null; };
  const cellAt = (x, y) => `${TE.CELLS[Math.min(2, Math.max(0, Math.floor(x / (W / 3)))) * 3 + Math.min(2, Math.max(0, Math.floor((y + 20) / (H / 3))))]}`;

  const rect = TE.textRect(st.pos.x, st.pos.y, st.lines, st.size, measure);
  const covered = TE.cellsCovered(rect);
  const rightHit = covered.some((c) => c.startsWith('오른쪽'));
  const f = face.current[an];
  const faceHit = f ? TE.faceCover(f, rect) : null;
  const diff = d.packLines.length && !TE.sameLines(st.lines, d.packLines);
  const sugg = f ? TE.suggestCells(f, st.lines, st.size, measure) : [];

  const setLine = (i, p) => patch({ lines: st.lines.map((l, k) => (k === i ? { ...l, ...p } : l)), edited: p.text != null ? true : st.edited });
  const setCell = (cell) => patch({ cell, pos: null });

  async function save() {
    setBusy(true); setMsg('');
    try {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      draw(c.getContext('2d'), imgs.current[an], st, false);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const edited = st.edited && !!d.packLines.length && !TE.sameLines(st.lines, d.packLines);
      const r = await api.thumbEditSave({ an, png: bytes, lines: st.lines, size: st.size, cell: st.cell, edited });
      setMsg(`✅ 저장했습니다 — ${(r.bytes / 1024).toFixed(0)}KB${r.preserved ? ' · 이전 파일은 _캔바원본 폴더에 보존' : ''}`);
      setSts((s) => ({ ...s, [an]: { ...s[an], dirty: false } }));
      onSaved && onSaved();
    } catch (e) { setMsg('⚠ ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-bg show" data-testid="thumb-editor">
      <div className="modal-card wide thed">
        <div className="thed-head"><h3>🖼 썸네일 편집 <span className="meta">{data.key}</span></h3>
          <div className="thed-tabs">{TE.AN.map((a) => <button key={a} className={a === an ? 'on' : ''} data-testid={'thed-tab-' + a} onClick={() => { setAn(a); setMsg(''); }}>{a}안{sts[a].dirty ? ' ●' : ''}</button>)}</div></div>
        {!d.bg && <p className="licerr">이 안의 글자 없는 배경 그림을 찾지 못했습니다 — 어두운 바탕에 글자만 얹게 됩니다. (채널사업부 캔바 단계가 `_배경` 그림을 내보내면 자동으로 쓰입니다)</p>}
        {d.bg && d.bgKind === 'codex' && <p className="thed-note">배경 = Codex 원본 바탕입니다(캔바 템플릿의 그라데이션·어둡게 층은 없습니다). 캔바 「글자 없는 배경」이 있으면 그것을 먼저 씁니다.</p>}
        <div className="thed-body">
          <div className="thed-stage"><canvas ref={cv} width={W} height={H} data-testid="thed-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} /></div>
          <div className="thed-side">
            <div className="thed-sec"><b>문구</b> <span className="meta">{d.packLines.length ? '패키징에서 읽음' : d.fromSidecar ? '저장된 값' : '직접 적으세요'}</span>
              {st.lines.map((l, i) => (
                <div key={i} className="thed-line">
                  <input value={l.text} data-testid={'thed-line-' + i} onChange={(e) => setLine(i, { text: e.target.value })} />
                  <button className={'thed-col' + (l.color === 'yellow' ? ' y' : '')} style={l.hex ? { color: l.hex } : undefined} title="흰색 ↔ 노랑(강조)" onClick={() => setLine(i, { color: l.color === 'yellow' ? 'white' : 'yellow', hex: undefined })}>●</button>
                  <button className="ghost thed-x" title="이 줄 지우기" onClick={() => patch({ lines: st.lines.filter((_, k) => k !== i), edited: true })}>✕</button>
                </div>))}
              <button className="ghost thed-add" onClick={() => patch({ lines: [...st.lines, { text: '', color: 'white' }], edited: true })}>＋ 줄 추가</button>
              {d.packLines.length > 0 && <button className="ghost thed-add" title="패키징 문구로 되돌리기" onClick={() => patch({ lines: d.packLines.map((l) => ({ ...l })), edited: false })}>↺ 패키징 문구로</button>}
            </div>
            <div className="thed-sec"><b>글자 크기</b> <span className="meta">모든 줄 같은 크기 · {st.size}px</span>
              <div className="thed-row"><input type="range" min="40" max="200" value={st.size} data-testid="thed-size" onChange={(e) => patch({ size: Number(e.target.value) })} />
                <button className="ghost" onClick={() => patch({ size: autoSize(st.lines, st.cell) })}>자동</button></div></div>
            <div className="thed-sec"><b>자리</b> <span className="meta">{st.cell} · 캔버스에서 끌어도 됩니다</span>
              <div className="thed-grid">{TE.CELLS.map((c) => <button key={c} disabled={!TE.ALLOWED.includes(c)} className={c === st.cell ? 'on' : ''} title={TE.ALLOWED.includes(c) ? c : '오른쪽 열은 쓰지 않습니다(디자인원칙)'} onClick={() => setCell(c)} />)}</div>
              {sugg.length > 0 && <button className="ghost thed-add" data-testid="thed-suggest" onClick={() => setCell(sugg[0].cell)}>🔎 얼굴을 덜 가리는 자리로 ({sugg[0].cell})</button>}</div>
            <div className="thed-warns">
              {rightHit && <div className="thed-w" data-testid="thed-w-right">⚠ 글자가 오른쪽 열을 침범합니다(디자인원칙 위반) — 크기를 줄이거나 왼쪽으로 옮기세요.</div>}
              {faceHit && faceHit.veto && <div className="thed-w" data-testid="thed-w-face">⚠ 사람 얼굴·손을 가릴 수 있습니다(살색 덩어리 {faceHit.cells}칸 · 색 기반이라 틀릴 수 있음).</div>}
              {diff && <div className="thed-w ok" data-testid="thed-w-diff">✎ 패키징 문구와 다릅니다 — 저장하면 「로이 수정」으로 표시되고 채널사업부가 패키징을 맞춥니다.</div>}
              {!st.lines.some((l) => l.text.trim()) && <div className="thed-w">⚠ 문구가 비었습니다.</div>}
            </div>
            {msg && <div className={'thed-msg' + (msg.startsWith('✅') ? ' ok' : '')} data-testid="thed-msg">{msg}</div>}
            <div className="thed-foot">
              <span className="meta">1280×720 · PNG · 2MB 이하 · 저장하면 기존 파일은 _캔바원본 으로 보존</span>
              <button className="ghost" onClick={onClose}>닫기</button>
              <button data-testid="thed-save" disabled={busy || !ready || !st.lines.some((l) => l.text.trim())} onClick={save}>{busy ? '저장 중…' : `${an}안 저장`}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
