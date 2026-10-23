import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCaptionFonts, fontCss as capFontCss } from './CaptionFormat.jsx';
import * as TE from '../../core/thumb-edit.js';

// 🖼 썸네일 편집기(v0.9.102 · 로이 2026-10-23 · 설계 docs/썸네일-편집기-설계.md)
//   배경 그림(캔바 「글자 없는 배경」 → 없으면 Codex 바탕) 위에 헤드라인을 얹어 1280×720 PNG 로 내보낸다.
//   v0.9.105: 글 = 한 줄 입력(`/` 가 줄바꿈) + 글자 범위 색 · 글꼴 고르기(+굵게 보강) · 칸별 정렬 · 되돌리기(편집 되돌리기 + 이전 버전 되돌리기).
//   규칙: 한 썸네일의 모든 줄은 같은 크기 · 글자는 왼쪽·가운데 6칸만(경고) · 얼굴 가림 경고 · 기존 파일은 _캔바원본 으로 보존 후 같은 이름 저장.
//   미리보기는 내보내기와 같은 그리기 함수 하나(draw)로 — 두 번 계산하지 않는다.
const W = TE.W, H = TE.H, GAP = 1.12;
const PALETTE = [['#ffffff', '흰색'], ['#ffd600', '노랑'], ['#ff4d4d', '빨강'], ['#7cf2ff', '하늘'], ['#8dff6a', '연두']];
const SNAP = (s) => ({ text: s.text, spans: s.spans.map((x) => ({ ...x })), size: s.size, cell: s.cell, pos: s.pos ? { ...s.pos } : null, align: s.align, font: s.font, bold: s.bold, edited: s.edited });

// 한 안을 화면 크기(1280×720)로 배치한 결과 — 미리보기·내보내기·경고가 모두 이것 하나를 쓴다
function layout(st, measureAt) {
  const lines = TE.lineModels(st.text, st.spans);
  const m = (t) => measureAt(st, t);
  const blockW = Math.round(Math.max(0, ...lines.map((l) => m(l.text))));
  const blockH = Math.round(lines.length * st.size * GAP);
  const pos = st.pos || (({ x, y }) => ({ x, y }))(TE.cellBox(st.cell, W, H, blockH, blockW));
  return { lines, blockW, blockH, pos, align: st.align || TE.alignOf(st.cell), rect: { x: pos.x, y: pos.y, w: blockW, h: blockH } };
}

function draw(ctx, img, st, L, fontSpec, show) {
  ctx.clearRect(0, 0, W, H);
  if (img) {   // 가로 맞춤 + 가운데(바탕이 16:9 가 아니면 잘린다)
    const k = Math.max(W / img.width, H / img.height), w = img.width * k, h = img.height * k;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  } else { ctx.fillStyle = '#2b2620'; ctx.fillRect(0, 0, W, H); }
  ctx.font = fontSpec(st.size); ctx.textBaseline = 'top'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  const boldW = st.size * (st.bold || 0) * 0.01, fac = L.align === 'center' ? 0.5 : L.align === 'right' ? 1 : 0;
  L.lines.forEach((l, i) => {
    const y = L.pos.y + i * st.size * GAP, lw = ctx.measureText(l.text).width, x0 = L.pos.x + (L.blockW - lw) * fac;
    ctx.lineWidth = Math.max(4, st.size * 0.16) + boldW; ctx.strokeStyle = '#000'; ctx.strokeText(l.text, x0, y);   // 바깥 검은 테두리(굵게 보강만큼 더 두껍게)
    let off = 0;
    for (const r of l.runs) {
      const x = x0 + ctx.measureText(l.text.slice(0, off)).width;
      if (boldW > 0) { ctx.lineWidth = boldW; ctx.strokeStyle = r.hex; ctx.strokeText(r.text, x, y); }   // 글자색 테두리 = 글씨를 두껍게
      ctx.fillStyle = r.hex; ctx.fillText(r.text, x, y);
      off += r.text.length;
    }
  });
  if (show) {   // 편집 보조선(내보내기에는 없다)
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1; ctx.setLineDash([6, 6]);
    for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo((W / 3) * i, 0); ctx.lineTo((W / 3) * i, H); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, (H / 3) * i); ctx.lineTo(W, (H / 3) * i); ctx.stroke(); }
    ctx.fillStyle = 'rgba(180,40,30,.18)'; ctx.fillRect((W / 3) * 2, 0, W / 3, H);   // 오른쪽 열 금지
    ctx.restore();
  }
}
const loadImg = (src) => new Promise((res) => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const kst = (ms) => new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function initState(d) {
  const t = TE.textFromLines(d.lines || []);
  return { text: t.raw, spans: t.spans, size: d.size || 0, cell: TE.CELLS.includes(d.cell) ? d.cell : '왼쪽-가운데', pos: null, align: null, font: d.font || '', bold: d.bold != null && Number.isFinite(d.bold) ? d.bold : 3, edited: !!d.edited, dirty: false };
}

export default function ThumbEditor({ data, onClose, onSaved }) {
  const api = window.api;
  const cv = useRef(null), imgs = useRef({}), face = useRef({}), inp = useRef(null), selR = useRef({ a: 0, b: 0 });
  const [dat, setDat] = useState(data);
  const [an, setAn] = useState('A');
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [sts, setSts] = useState(() => Object.fromEntries(TE.AN.map((a) => [a, initState(data.an[a])])));
  const [ver, setVer] = useState(null);   // 이전 버전 패널 {items, sel, img}
  const hist = useRef({ A: { past: [], future: [] }, B: { past: [], future: [] }, C: { past: [], future: [] } }), lastPush = useRef({ key: '', at: 0 }), [, tick] = useState(0);
  const { fonts, add: addFont } = useCaptionFonts();
  const bestFont = useMemo(() => {
    const p = (fonts || []).filter((f) => /pretendard/i.test(f.family || '') && !f.jaOnly).sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
    return p ? p.vrewName : 'Pretendard-Vrew_700';
  }, [fonts]);
  const raw = sts[an], d = dat.an[an];
  const effFont = raw.font || bestFont;
  const fontSpec = (vrew) => (size) => { const f = capFontCss(vrew); return `${f.weight || 700} ${size}px ${f.family}`; };
  const ctxM = useMemo(() => document.createElement('canvas').getContext('2d'), []);
  const measureAt = (s, t) => { ctxM.font = fontSpec(s.font || bestFont)(s.size); return ctxM.measureText(t).width; };
  const st = raw, L = layout(raw, measureAt);

  // 편집 기록(되돌리기·다시 하기) — 같은 종류의 잇따른 입력(글자 치기·슬라이더)은 한 번으로
  const patch = (p, key = '') => setSts((s) => {
    const cur = s[an], h = hist.current[an], now = Date.now();
    if (!(key && lastPush.current.key === an + key && now - lastPush.current.at < 800)) { h.past.push(SNAP(cur)); if (h.past.length > 100) h.past.shift(); h.future = []; }
    lastPush.current = { key: an + key, at: now };
    return { ...s, [an]: { ...cur, ...p, dirty: true } };
  });
  const undo = () => setSts((s) => { const h = hist.current[an]; if (!h.past.length) return s; h.future.push(SNAP(s[an])); const b = h.past.pop(); lastPush.current = { key: '', at: 0 }; return { ...s, [an]: { ...s[an], ...b, dirty: true } }; });
  const redo = () => setSts((s) => { const h = hist.current[an]; if (!h.future.length) return s; h.past.push(SNAP(s[an])); const b = h.future.pop(); lastPush.current = { key: '', at: 0 }; return { ...s, [an]: { ...s[an], ...b, dirty: true } }; });
  useEffect(() => { tick((n) => n + 1); }, [sts, an]);
  const onKey = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = String(e.key).toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  };

  // 그림 읽기 + 안마다 글자 크기가 비었으면 자동 크기
  useEffect(() => { let on = true; (async () => {
    for (const a of TE.AN) {
      const p = dat.an[a].bg; if (!p) continue;
      imgs.current[a] = await loadImg(await api.thumbEditImage(p));
      const im = imgs.current[a];
      if (im) { const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d', { willReadFrequently: true }); const k = Math.max(64 / im.width, 36 / im.height); x.drawImage(im, (64 - im.width * k) / 2, (36 - im.height * k) / 2, im.width * k, im.height * k); const px = x.getImageData(0, 0, 64, 36).data, f = new Uint8Array(64 * 36 * 3); for (let i = 0, j = 0; i < px.length; i += 4) { f[j++] = px[i]; f[j++] = px[i + 1]; f[j++] = px[i + 2]; } face.current[a] = f; }
    }
    if (!on) return;
    setSts((s) => { const n = { ...s }; for (const a of TE.AN) if (!n[a].size) n[a] = { ...n[a], size: autoSize(n[a], TE.lineModels(n[a].text, n[a].spans)) }; return n; });
    setReady(true);
  })(); return () => { on = false; }; /* eslint-disable-next-line */ }, []);
  function autoSize(s, lines) { const b = TE.cellBox(s.cell); const m = (t, sz) => { ctxM.font = fontSpec(s.font || bestFont)(sz); return ctxM.measureText(t).width; }; return TE.fitSize(lines, m, b.maxW, H * 0.62); }

  useEffect(() => { if (ready && cv.current) draw(cv.current.getContext('2d'), imgs.current[an], st, L, fontSpec(effFont), true); });

  // 끌어 옮기기(캔버스 표시 크기 ↔ 1280×720 환산) — 정렬(align)은 놓은 칸 기준 그대로
  const drag = useRef(null);
  const toXY = (e) => { const r = cv.current.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
  const cellAt = (x, y) => `${TE.CELLS[Math.min(2, Math.max(0, Math.floor((x + L.blockW / 2) / (W / 3)))) * 3 + Math.min(2, Math.max(0, Math.floor((y + L.blockH / 2) / (H / 3))))]}`;
  const onDown = (e) => { const p = toXY(e); drag.current = { dx: p.x - L.pos.x, dy: p.y - L.pos.y, moved: false }; cv.current.setPointerCapture(e.pointerId); };
  const onMove = (e) => { if (!drag.current) return; const p = toXY(e), x = Math.round(Math.max(0, Math.min(W - 40, p.x - drag.current.dx))), y = Math.round(Math.max(0, Math.min(H - 40, p.y - drag.current.dy))); drag.current.moved = true; patch({ pos: { x, y }, align: L.align, cell: cellAt(x, y) }, 'drag'); };
  const onUp = () => { drag.current = null; };

  const covered = TE.cellsCovered(L.rect);
  const rightHit = covered.some((c) => c.startsWith('오른쪽'));
  const f = face.current[an];
  const faceHit = f ? TE.faceCover(f, L.rect) : null;
  const diff = d.packLines.length && !TE.sameLines(L.lines, d.packLines);
  const sugg = f ? TE.suggestCells(f, L.lines, st.size, (t, sz) => { ctxM.font = fontSpec(effFont)(sz); return ctxM.measureText(t).width; }) : [];

  const setCell = (cell) => patch({ cell, pos: null, align: null });
  const onText = (e) => { const t = e.target.value; patch({ text: t, spans: TE.shiftSpans(st.spans, st.text, t), edited: true }, 'type'); };
  const rememberSel = () => { const el = inp.current; if (el) selR.current = { a: el.selectionStart || 0, b: el.selectionEnd || 0 }; };
  // 선택한 글(블록)에 색을 칠한다 — 선택이 없으면 커서가 있는 줄 전체
  const paint = (hex) => {
    let { a, b } = selR.current;
    if (a === b) { const ln = TE.splitLines(st.text).find((x) => a >= x.start && a <= x.end) || TE.splitLines(st.text)[0]; if (!ln) return; a = ln.start; b = ln.end; }
    patch({ spans: TE.applySpan(st.spans, Math.min(a, b), Math.max(a, b), hex, st.text.length), edited: true });
  };
  const hasSel = selR.current.a !== selR.current.b;

  async function openVer() {
    setMsg('');
    if (ver) { setVer(null); return; }
    const r = await api.thumbEditVersions({ an });
    const items = (r && r.versions) || [];
    setVer({ items, sel: items[0] ? items[0].name : '', img: null });
    if (items[0]) pickVer(items[0], items);
  }
  async function pickVer(v, items) { const src = await api.thumbEditImage(v.path); setVer((x) => (x ? { ...x, items: items || x.items, sel: v.name, img: src } : x)); }
  async function restore() {
    if (!ver || !ver.sel) return;
    const v = ver.items.find((x) => x.name === ver.sel);
    if (!window.confirm(`${an}안을 「${kst(v.mtimeMs)}」 버전으로 되돌립니다.\n지금 파일은 _캔바원본 폴더에 보존되어 다시 돌아올 수 있습니다.`)) return;
    setBusy(true); setMsg('');
    try {
      await api.thumbEditRestore({ an, name: ver.sel });
      const nd = await api.thumbEditOpen();
      if (nd && nd.ok) { setDat(nd); setSts((s) => ({ ...s, [an]: initState(nd.an[an]) })); hist.current[an] = { past: [], future: [] }; }
      setMsg('✅ 이전 버전으로 되돌렸습니다 — 되돌리기 전 파일은 _캔바원본 폴더에 보존');
      setVer(null); onSaved && onSaved();
    } catch (e) { setMsg('⚠ ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setMsg('');
    try {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      draw(c.getContext('2d'), imgs.current[an], st, L, fontSpec(effFont), false);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const edited = st.edited && !!d.packLines.length && !TE.sameLines(L.lines, d.packLines);
      const r = await api.thumbEditSave({ an, png: bytes, lines: L.lines, size: st.size, cell: st.cell, font: effFont, bold: st.bold, edited });
      setMsg(`✅ 저장했습니다 — ${(r.bytes / 1024).toFixed(0)}KB${r.preserved ? ' · 이전 파일은 _캔바원본 폴더에 보존' : ''}`);
      setSts((s) => ({ ...s, [an]: { ...s[an], dirty: false } }));
      onSaved && onSaved();
    } catch (e) { setMsg('⚠ ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { setBusy(false); }
  }

  const h = hist.current[an];
  return (
    <div className="modal-bg show" data-testid="thumb-editor" onKeyDown={onKey}>
      <div className="modal-card wide thed">
        <div className="thed-head"><h3>🖼 썸네일 편집 <span className="meta">{dat.key}</span></h3>
          <div className="thed-hbtns">
            <button className="ghost" data-testid="thed-undo" disabled={!h.past.length} title="편집 되돌리기 (Ctrl+Z)" onClick={undo}>↶</button>
            <button className="ghost" data-testid="thed-redo" disabled={!h.future.length} title="다시 하기 (Ctrl+Y)" onClick={redo}>↷</button>
            <div className="thed-tabs">{TE.AN.map((a) => <button key={a} className={a === an ? 'on' : ''} data-testid={'thed-tab-' + a} onClick={() => { setAn(a); setMsg(''); setVer(null); }}>{a}안{sts[a].dirty ? ' ●' : ''}</button>)}</div></div></div>
        {!d.bg && <p className="licerr">이 안의 글자 없는 배경 그림을 찾지 못했습니다 — 어두운 바탕에 글자만 얹게 됩니다. (채널사업부 캔바 단계가 `_배경` 그림을 내보내면 자동으로 쓰입니다)</p>}
        {d.bg && d.bgKind === 'codex' && <p className="thed-note">배경 = Codex 원본 바탕입니다(캔바 템플릿의 그라데이션·어둡게 층은 없습니다). 캔바 「글자 없는 배경」이 있으면 그것을 먼저 씁니다.</p>}
        <div className="thed-body">
          <div className="thed-stage"><canvas ref={cv} width={W} height={H} data-testid="thed-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} /></div>
          <div className="thed-side">
            <div className="thed-sec"><b>문구</b> <span className="meta">{d.packLines.length ? '패키징에서 읽음' : d.fromSidecar ? '저장된 값' : '직접 적으세요'} · <b>/</b> 로 줄바꿈</span>
              <input ref={inp} className="thed-text" value={st.text} data-testid="thed-text" placeholder="첫 줄/둘째 줄/셋째 줄" onChange={onText} onSelect={rememberSel} onKeyUp={rememberSel} onMouseUp={rememberSel} onBlur={rememberSel} />
              <div className="thed-colors" data-testid="thed-colors">
                <span className="meta">{hasSel ? '선택한 글에' : '커서가 있는 줄에'} 색 →</span>
                {PALETTE.map(([hex, nm]) => <button key={hex} className="thed-sw" title={nm} style={{ background: hex }} data-testid={'thed-sw-' + hex.slice(1)} onMouseDown={(e) => e.preventDefault()} onClick={() => paint(hex)} />)}
                <input type="color" className="thed-pick" title="직접 고르기" onMouseDown={() => rememberSel()} onChange={(e) => paint(e.target.value)} />
              </div>
              <div className="thed-prev" data-testid="thed-prev">{L.lines.length ? L.lines.map((l, i) => <div key={i}>{l.runs.map((r, k) => <span key={k} style={{ color: r.hex === '#ffffff' ? '#e9e2d6' : r.hex, textShadow: '0 0 2px #000, 0 0 2px #000' }}>{r.text}</span>)}</div>) : <span className="meta">문구를 적으세요</span>}</div>
              {d.packLines.length > 0 && <button className="ghost thed-add" title="패키징 문구로 되돌리기" onClick={() => { const t = TE.textFromLines(d.packLines); patch({ text: t.raw, spans: t.spans, edited: false }); }}>↺ 패키징 문구로</button>}
            </div>
            <div className="thed-sec"><b>글꼴</b>
              <div className="thed-row">
                <select className="thed-font" data-testid="thed-font" value={effFont} onChange={(e) => patch({ font: e.target.value })}>
                  {(fonts || []).filter((x) => !x.jaOnly).map((x) => <option key={x.vrewName} value={x.vrewName}>{x.label}</option>)}
                  {!(fonts || []).some((x) => x.vrewName === effFont) && <option value={effFont}>{effFont}</option>}
                </select>
                <button className="ghost" title="내 글꼴 파일 추가" onClick={async () => { await addFont(); }}>＋</button>
              </div>
              <div className="thed-row"><span className="meta">굵게 보강</span><input type="range" min="0" max="10" value={st.bold} data-testid="thed-bold" onChange={(e) => patch({ bold: Number(e.target.value) }, 'bold')} /><span className="meta">{st.bold}</span></div></div>
            <div className="thed-sec"><b>글자 크기</b> <span className="meta">모든 줄 같은 크기 · {st.size}px</span>
              <div className="thed-row"><input type="range" min="40" max="200" value={st.size} data-testid="thed-size" onChange={(e) => patch({ size: Number(e.target.value) }, 'size')} />
                <button className="ghost" onClick={() => patch({ size: autoSize(st, L.lines) })}>자동</button></div></div>
            <div className="thed-sec"><b>자리</b> <span className="meta">{st.cell} · {L.align === 'center' ? '가운데' : L.align === 'right' ? '오른쪽' : '왼쪽'} 정렬 · 캔버스에서 끌어도 됩니다</span>
              <div className="thed-grid">{TE.CELLS.map((c) => <button key={c} data-testid={'thed-cell-' + c} disabled={!TE.ALLOWED.includes(c)} className={c === st.cell ? 'on' : ''} title={TE.ALLOWED.includes(c) ? c : '오른쪽 열은 쓰지 않습니다(디자인원칙)'} onClick={() => setCell(c)} />)}</div>
              {sugg.length > 0 && <button className="ghost thed-add" data-testid="thed-suggest" onClick={() => setCell(sugg[0].cell)}>🔎 얼굴을 덜 가리는 자리로 ({sugg[0].cell})</button>}</div>
            <div className="thed-warns">
              {rightHit && <div className="thed-w" data-testid="thed-w-right">⚠ 글자가 오른쪽 열을 침범합니다(디자인원칙 위반) — 크기를 줄이거나 왼쪽으로 옮기세요.</div>}
              {faceHit && faceHit.veto && <div className="thed-w" data-testid="thed-w-face">⚠ 사람 얼굴·손을 가릴 수 있습니다(살색 덩어리 {faceHit.cells}칸 · 색 기반이라 틀릴 수 있음).</div>}
              {diff && <div className="thed-w ok" data-testid="thed-w-diff">✎ 패키징 문구와 다릅니다 — 저장하면 「로이 수정」으로 표시되고 채널사업부가 패키징을 맞춥니다.</div>}
              {!L.lines.length && <div className="thed-w">⚠ 문구가 비었습니다.</div>}
            </div>
            {ver && (<div className="thed-ver" data-testid="thed-ver">
              {!ver.items.length ? <span className="meta">되돌릴 이전 버전이 없습니다(처음 저장하면 이전 파일이 쌓입니다).</span> : (<>
                <select value={ver.sel} data-testid="thed-ver-sel" onChange={(e) => pickVer(ver.items.find((x) => x.name === e.target.value))}>
                  {ver.items.map((v) => <option key={v.name} value={v.name}>{kst(v.mtimeMs)} · {(v.size / 1024).toFixed(0)}KB{v.first ? ' · 캔바 원본(처음)' : ''}</option>)}
                </select>
                {ver.img && <img className="thed-vimg" src={ver.img} alt="" />}
                <button data-testid="thed-ver-go" disabled={busy} onClick={restore}>이 버전으로 되돌리기</button></>)}
            </div>)}
            {msg && <div className={'thed-msg' + (msg.startsWith('✅') ? ' ok' : '')} data-testid="thed-msg">{msg}</div>}
            <div className="thed-foot">
              <span className="meta">1280×720 · PNG · 2MB 이하 · 저장하면 기존 파일은 _캔바원본 으로 보존</span>
              <button className="ghost" data-testid="thed-ver-open" onClick={openVer}>↶ 이전 버전</button>
              <button className="ghost" onClick={onClose}>닫기</button>
              <button data-testid="thed-save" disabled={busy || !ready || !L.lines.length} onClick={save}>{busy ? '저장 중…' : `${an}안 저장`}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
