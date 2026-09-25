// 🎨 자막 서식 — Vrew 의 자막 서식 창(툴바 · 고급 · 애니메이션)과 같은 기능 (2026-09-25, 로이)
//
// 🔑 서식 규칙은 core/caption-format(모델) · core/caption-anim(효과 움직임)을 그대로 쓴다 —
//   .vrew·MP4·화이트보드와 **같은 코드**라 화면에서 본 것과 결과물이 갈리지 않는다.
//   이 파일은 화면(입력 칸·미리보기)만 담당한다.
import React, { useEffect, useRef, useState, useCallback } from 'react';
import api from './lib/ipc.js';
import CF from '../../core/caption-format.js';
import CA from '../../core/caption-anim.js';

export { CF, CA };

// ── 글꼴(미리보기용 FontFace) ───────────────────────────────────────────────
const _fontFaces = new Map();   // vrewName → 'PRM…' 가족 이름(로딩 끝) | Promise
const _fontListeners = new Set();
let _fontList = null, _fontListP = null;

function loadFontList(force) {
  if (_fontList && !force) return Promise.resolve(_fontList);
  if (_fontListP && !force) return _fontListP;
  _fontListP = api.listCaptionFonts().then((r) => { _fontList = (r && r.fonts) || []; _fontListeners.forEach((f) => f()); return _fontList; })
    .catch(() => { _fontList = []; return _fontList; });
  return _fontListP;
}
function ensureFontFace(vrewName) {
  if (!vrewName || _fontFaces.has(vrewName)) return;
  const p = api.captionFontData(vrewName).then(async (r) => {
    if (!r || !r.ok) { _fontFaces.set(vrewName, null); return; }
    try {
      const bin = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
      const ff = new FontFace(r.family, bin.buffer);
      await ff.load(); document.fonts.add(ff);
      _fontFaces.set(vrewName, r.family);
    } catch (_) { _fontFaces.set(vrewName, null); }
    _fontListeners.forEach((f) => f());
  });
  _fontFaces.set(vrewName, p);
}
/** 미리보기 CSS 글꼴 이름(아직 안 불렀으면 부르기 시작하고 기본 글꼴을 돌려준다). */
export function fontCss(vrewName) {
  const v = _fontFaces.get(vrewName);
  if (v === undefined) ensureFontFace(vrewName);
  const w = CF.parseVrewFont(vrewName || CF.FMT_DEFAULT.font).weight;
  return { family: (typeof v === 'string' ? `"${v}", ` : '') + 'Pretendard, "Malgun Gothic", sans-serif', weight: w };
}
export function useCaptionFonts() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    _fontListeners.add(f); loadFontList();
    return () => { _fontListeners.delete(f); };
  }, []);
  return {
    fonts: _fontList || [],
    reload: () => loadFontList(true),
    add: async () => { const r = await api.addCaptionFont(); await loadFontList(true); return r; },
  };
}
function fontLabel(fonts, vrewName) {
  const f = (fonts || []).find((x) => x.vrewName === vrewName);
  if (f) return `${f.label} ${f.weight}`;
  const p = CF.parseVrewFont(vrewName);
  return `${p.family} ${p.weight} (이 PC 에 없음)`;
}

// ── 서식 → CSS ─────────────────────────────────────────────────────────────
const rgba = (hex, a) => {
  const h = /^#[0-9a-f]{6}$/i.test(String(hex || '')) ? hex : '#000000';
  return `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${a})`;
};
/**
 * 서식 → 글자 CSS. k = 화면 px / Vrew px(테두리·그림자 두께 환산). full=false 면 테두리를 뺀다(목록 화면 — 밝은 바탕).
 */
export function fmtCss(f, k = 0.2, full = true) {
  const fc = fontCss(f.font);
  const st = {
    fontFamily: fc.family, fontWeight: f.bold ? Math.max(700, fc.weight) : fc.weight,
    fontStyle: f.italic ? 'italic' : 'normal', color: f.fontColor || '#fff',
    textDecoration: [f.underline ? 'underline' : '', f.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none',
    letterSpacing: (Number(f.letterSpacing) || 0) + 'em',
  };
  const sh = [];
  if (full && f.outlineOn !== false && Number(f.outlineWidth) > 0) {
    st.WebkitTextStroke = `${Math.max(0.5, Number(f.outlineWidth) * k * 2)}px ${f.outlineColor}`;
    st.paintOrder = 'stroke fill';
  }
  if (full && f.outline2On) {
    const w = Math.max(1, (Number(f.outlineWidth) + Number(f.outline2Width)) * k);
    for (const [x, y] of [[w, 0], [-w, 0], [0, w], [0, -w], [w, w], [-w, -w], [w, -w], [-w, w]]) sh.push(`${x}px ${y}px 0 ${f.outline2Color}`);
  }
  if (f.shadowOn) sh.push(`${(Number(f.shadowX) || 0) * k}px ${(Number(f.shadowY) || 0) * k}px ${(Number(f.shadowBlur) || 0) * k}px ${rgba(f.shadowColor, (Number(f.shadowOpacity) || 0) / 100)}`);
  if (sh.length) st.textShadow = sh.join(', ');
  if (f.hlOn) { st.backgroundColor = rgba(f.hlColor, (Number(f.hlOpacity != null ? f.hlOpacity : 100)) / 100); st.borderRadius = 3; st.padding = '0 2px'; }
  return st;
}

// ── 목록 화면의 한 줄 ─────────────────────────────────────────────────────
/**
 * 줄 글자를 서식 구간으로 그린다. **덮어쓴 구간만** 서식을 보인다(채널 기본 모양을 모든 줄에 입히면 목록이 통째로 바뀐다).
 * 각 구간에 data-off(문장 글자 위치)를 달아 마우스로 고른 글자 범위를 되짚는다.
 */
export function LineRuns({ text, spans, range, base }) {
  if (!spans || !spans.length) return <span data-off={range.from}>{String(text || '').slice(range.from, range.to)}</span>;
  const sp = CF.cleanSpans(spans, String(text || '').length);
  const cuts = new Set([range.from, range.to]);
  for (const s of sp) { if (s.from > range.from && s.from < range.to) cuts.add(s.from); if (s.to > range.from && s.to < range.to) cuts.add(s.to); }
  const pts = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const ov = CF.fmtAt(sp, a);
    const t = String(text).slice(a, b);
    const keys = Object.keys(ov).filter((kk) => !CF.LINE_KEYS.includes(kk));
    if (!keys.length) { out.push(<span key={a} data-off={a}>{t}</span>); continue; }
    const f = { ...CF.normFmt(base), ...ov };
    const css = fmtCss(f, 0.12, false);
    // 🔑 목록(밝은 바탕)에는 **덮어쓴 속성만** 보인다 — 채널 기본(흰 글자·Pretendard 700 …)까지 입히면 글자가 안 보이고 모든 구간이 굵어진다
    if (!('fontColor' in ov)) delete css.color;
    if (!('font' in ov)) delete css.fontFamily;
    if (!('bold' in ov) && !('font' in ov)) delete css.fontWeight;
    if (!('italic' in ov)) delete css.fontStyle;
    if (!('underline' in ov) && !('strike' in ov)) delete css.textDecoration;
    if (!('letterSpacing' in ov)) delete css.letterSpacing;
    // 밝은 글자색은 밝은 목록 바탕에서 안 보이므로 얇은 테두리를 붙인다
    if (ov.fontColor && /^#(f|e|d)[0-9a-f](f|e|d)[0-9a-f](f|e|d)[0-9a-f]$/i.test(ov.fontColor)) { css.WebkitTextStroke = '0.6px #333'; css.paintOrder = 'stroke fill'; }
    if (ov.size && base && base.size) css.fontSize = `${Math.max(60, Math.min(180, Math.round(ov.size / base.size * 100)))}%`;
    out.push(<span key={a} data-off={a} className="capfmt" style={css}>{t}</span>);
  }
  return <>{out}</>;
}

/** 마우스로 고른 글자 범위(문장 글자 위치) — 한 문장 블록 안에서만. 없으면 null. */
export function selectionRange(container) {
  const s = window.getSelection && window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount) return null;
  const pos = (node, off) => {
    let el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== container && !(el.dataset && el.dataset.off != null)) el = el.parentElement;
    if (!el || el === container || !el.dataset || el.dataset.off == null) return null;
    const base = Number(el.dataset.off);
    return node.nodeType === 3 ? base + off : base + (off ? (el.textContent || '').length : 0);
  };
  const r = s.getRangeAt(0);
  if (!container.contains(r.startContainer) || !container.contains(r.endContainer)) return null;
  let a = pos(r.startContainer, r.startOffset), b = pos(r.endContainer, r.endOffset);
  if (a == null || b == null) return null;
  if (b < a) [a, b] = [b, a];
  return b > a ? { from: a, to: b } : null;
}

// ── 저장된 서식 ─────────────────────────────────────────────────────────────
export function useSavedFormats() {
  const [list, setList] = useState([]);
  useEffect(() => { api.getSavedCapFormats().then((l) => setList(Array.isArray(l) ? l : [])).catch(() => {}); }, []);
  const save = useCallback(async (next) => { const r = await api.setSavedCapFormats(next); if (r && r.ok) setList(r.list); }, []);
  return { list, save };
}
/** 서식 → 저장된 서식에 넣을 조각(글꼴·색·테두리 등 글자 서식 + 효과). */
function savable(f) {
  const o = {};
  for (const k of Object.keys(CF.FMT_DEFAULT)) if (k in f) o[k] = f[k];
  if (f.size != null) o.size = f.size;
  return CF.normPatch(o);
}

// ── 작은 입력 부품 ─────────────────────────────────────────────────────────
function Num({ value, min, max, step = 1, onChange, w = 58, title }) {
  return <input className="n" type="number" title={title} style={{ flex: `0 0 ${w}px`, width: w }} min={min} max={max} step={step}
    value={value == null ? '' : value} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
}
function Slider({ value, min, max, step, onChange, lo, hi, unit }) {
  return (
    <div className="cf-slider">
      <div className="cf-srow">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <Num value={+Number(value).toFixed(2)} min={min} max={max} step={step} onChange={(v) => onChange(v == null ? min : v)} />{unit && <span className="meta">{unit}</span>}
      </div>
      {(lo || hi) && <div className="cf-lohi"><span>{lo}</span><span>{hi}</span></div>}
    </div>
  );
}
function Color({ value, onChange, disabled }) {
  return <input type="color" className="cf-color" disabled={disabled} value={/^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />;
}
function Toggle({ on, onChange, children, title }) {
  return <button type="button" title={title} className={'cf-tog' + (on ? ' on' : '')} onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(!on)}>{children}</button>;
}

const SIZES = [25, 50, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300];

// ── 고급 패널(서식 · 글꼴) ────────────────────────────────────────────────
/**
 * @param value     지금 서식(채널: 채널 서식 전체 · 선택: 채널 기본 + 첫 글자의 덮어쓰기)
 * @param onChange  (patch) => void — 바뀐 키만
 * @param title     패널 제목(「채널 기본 서식」 · 「클립 6 서식」)
 */
export function CaptionFormatPanel({ value, onChange, title, onClose, onReset }) {
  const f = value || CF.normFmt({});
  const [tab, setTab] = useState('fmt');
  const { fonts, add } = useCaptionFonts();
  const { list: saved, save } = useSavedFormats();
  const set = (p) => onChange(p);
  return (
    <div className="cf-panel" data-testid="cf-panel">
      <div className="cf-head"><b>{title || '자막 서식'}</b>{onReset && <button className="ghost cf-sm" title="이 범위의 서식을 채널 기본으로 되돌립니다" onClick={onReset}>↺ 초기화</button>}{onClose && <button className="ghost cf-x" onClick={onClose}>✕</button>}</div>
      <div className="cf-body">
        <div className="cf-sec">
          <div className="cf-sech">저장된 서식 <span className="meta">{saved.length} / 18</span></div>
          <div className="cf-saved">
            {saved.map((s) => (
              <div key={s.id} className="cf-savedi" title={`${s.name} — 누르면 적용`}>
                <button className="cf-savedb" onClick={() => set(s.fmt)} style={fmtCss({ ...f, ...s.fmt }, 0.12, true)}>가</button>
                <span className="cf-savedn">{s.name}</span>
                <button className="cf-saveddel" title="지우기" onClick={() => save(saved.filter((x) => x.id !== s.id))}>✕</button>
              </div>
            ))}
            {saved.length < 18 && <button className="cf-savedadd" data-testid="cf-save" onClick={() => {
              const name = `서식 ${saved.length + 1}`;
              save([...saved, { id: 'f' + Date.now(), name, fmt: savable(f) }]);
            }}>＋<br />현재 서식 저장</button>}
          </div>
        </div>
        <div className="cf-tabs"><button className={tab === 'fmt' ? 'on' : ''} onClick={() => setTab('fmt')}>서식</button><button className={tab === 'font' ? 'on' : ''} onClick={() => setTab('font')}>글꼴</button></div>
        {tab === 'font' ? (
          <div className="cf-sec" data-testid="cf-fontlist">
            <div className="cf-fonts">
              {fonts.map((x) => (
                <button key={x.vrewName} className={'cf-font' + (x.vrewName === f.font ? ' on' : '')} title={x.vrewName}
                  style={{ fontFamily: fontCss(x.vrewName).family, fontWeight: x.weight }} onClick={() => set({ font: x.vrewName })}>
                  {x.label} <span className="meta">{x.weight}</span>
                  {x.src === 'user' && <span className="meta" title="직접 추가한 글꼴 — MP4·화이트보드에는 들어가지만, Vrew 글꼴 목록에 없는 글꼴이면 .vrew 를 Vrew 에서 열었을 때 다른 글꼴로 보일 수 있습니다"> · ⚠ Vrew 에 없을 수 있음</span>}
                </button>
              ))}
            </div>
            <div className="cf-note">Vrew 에서 한 번 쓴 글꼴은 여기 자동으로 나타납니다(이 PC 의 Vrew 캐시). 다른 글꼴은 파일로 추가하세요.</div>
            <button className="ghost" onClick={add}>＋ 글꼴 파일 추가 (ttf·otf·woff2)</button>
          </div>
        ) : (
          <>
            <div className="cf-sec">
              <div className="cf-sech">기본 서식</div>
              <div className="cf-row"><span className="l">글자 크기</span>
                <select value={String(f.size || 100)} onChange={(e) => set({ size: Number(e.target.value) })}>{[...new Set([...SIZES, Number(f.size || 100)])].sort((a, b) => a - b).map((v) => <option key={v} value={String(v)}>{v}</option>)}</select>
                <span className="cf-gap" />
                <Toggle on={f.bold} onChange={(v) => set({ bold: v })} title="굵게"><b>B</b></Toggle>
                <Toggle on={f.italic} onChange={(v) => set({ italic: v })} title="기울임"><i>I</i></Toggle>
              </div>
              <div className="cf-row"><span className="l">색</span><Color value={f.fontColor} onChange={(v) => set({ fontColor: v })} />
                <span className="cf-gap" />
                <Toggle on={f.strike} onChange={(v) => set({ strike: v })} title="취소선"><s>S</s></Toggle>
                <Toggle on={f.underline} onChange={(v) => set({ underline: v })} title="밑줄"><u>U</u></Toggle>
              </div>
            </div>
            <div className="cf-sec">
              <div className="cf-sech">간격</div>
              <div className="cf-row"><span className="l">글자 간격</span><Slider value={Number(f.letterSpacing) || 0} min={-0.2} max={0.8} step={0.01} onChange={(v) => set({ letterSpacing: v })} lo="-0.2" hi="0.8" /></div>
              <div className="cf-row"><span className="l">줄 간격</span><Slider value={Number(f.lineHeight) || 1} min={0.5} max={2} step={0.01} onChange={(v) => set({ lineHeight: v })} lo="0.5" hi="2" /></div>
            </div>
            <div className="cf-sec">
              <div className="cf-sech"><label className="cf-chk"><input type="checkbox" checked={f.outlineOn !== false} onChange={(e) => set({ outlineOn: e.target.checked })} />테두리</label></div>
              <div className="cf-row"><span className="l">색</span><Color value={f.outlineColor} disabled={f.outlineOn === false} onChange={(v) => set({ outlineColor: v })} /></div>
              <div className="cf-row"><span className="l">두께</span><Slider value={Number(f.outlineWidth) || 0} min={1} max={20} step={1} onChange={(v) => set({ outlineWidth: v })} lo="1" hi="20" /></div>
              <div className="cf-row"><label className="cf-chk"><input type="checkbox" checked={!!f.outline2On} onChange={(e) => set({ outline2On: e.target.checked })} />이중 테두리</label>
                {f.outline2On && <><Color value={f.outline2Color} onChange={(v) => set({ outline2Color: v })} /><span className="l">두께</span><Num value={f.outline2Width} min={1} max={20} onChange={(v) => set({ outline2Width: v })} /></>}</div>
            </div>
            <div className="cf-sec">
              <div className="cf-sech"><label className="cf-chk"><input type="checkbox" checked={!!f.boxOn} onChange={(e) => set({ boxOn: e.target.checked })} />배경 <span className="meta">(줄 전체 상자)</span></label></div>
              <div className="cf-row"><span className="l">색</span><Color value={f.boxColor} disabled={!f.boxOn} onChange={(v) => set({ boxColor: v })} /><span className="l">불투명</span><Num value={f.boxOpacity} min={0} max={100} step={10} onChange={(v) => set({ boxOpacity: v })} /><span className="meta">%</span></div>
            </div>
            <div className="cf-sec">
              <div className="cf-sech"><label className="cf-chk"><input type="checkbox" checked={!!f.hlOn} onChange={(e) => set({ hlOn: e.target.checked })} />형광펜 <span className="meta">(글자 뒤 칠)</span></label></div>
              <div className="cf-row"><span className="l">색</span><Color value={f.hlColor} disabled={!f.hlOn} onChange={(v) => set({ hlColor: v })} /><span className="l">불투명</span><Num value={f.hlOpacity} min={0} max={100} step={10} onChange={(v) => set({ hlOpacity: v })} /><span className="meta">%</span></div>
            </div>
            <div className="cf-sec">
              <div className="cf-sech"><label className="cf-chk"><input type="checkbox" checked={!!f.shadowOn} onChange={(e) => set({ shadowOn: e.target.checked })} />그림자</label></div>
              {f.shadowOn && <>
                <div className="cf-row"><span className="l">색</span><Color value={f.shadowColor} onChange={(v) => set({ shadowColor: v })} /><span className="l">불투명</span><Num value={f.shadowOpacity} min={0} max={100} step={5} onChange={(v) => set({ shadowOpacity: v })} /><span className="meta">%</span></div>
                <div className="cf-row"><span className="l">흐림</span><Slider value={Number(f.shadowBlur) || 0} min={0} max={60} step={1} onChange={(v) => set({ shadowBlur: v })} lo="선명" hi="흐리게" /></div>
                <div className="cf-row"><span className="l">위치</span><span className="meta">가로</span><Num value={f.shadowX} min={-30} max={30} onChange={(v) => set({ shadowX: v })} /><span className="meta">세로</span><Num value={f.shadowY} min={-30} max={30} onChange={(v) => set({ shadowY: v })} /></div>
              </>}
            </div>
            <div className="cf-sec">
              <div className="cf-sech">글꼴</div>
              <div className="cf-row"><button className="ghost cf-fontcur" style={{ fontFamily: fontCss(f.font).family }} onClick={() => setTab('font')}>{fontLabel(fonts, f.font)} ▸</button></div>
            </div>
          </>
        )}
      </div>
      <div className="cf-foot"><button onClick={() => { const name = `서식 ${saved.length + 1}`; if (saved.length < 18) save([...saved, { id: 'f' + Date.now(), name, fmt: savable(f) }]); }} disabled={saved.length >= 18}>＋ 현재 서식 저장</button></div>
    </div>
  );
}

// ── 효과(애니메이션) 패널 ──────────────────────────────────────────────────
const DIRS = [['NONE', '⃠'], ['UP', '↑'], ['DOWN', '↓'], ['RIGHT', '→'], ['LEFT', '←']];

/** 효과 상태 → CSS transform·opacity(미리보기). box = 요소 크기, frame = 화면 크기, k = 화면 px / Vrew px */
export function stateCss(st, box, frame, k) {
  const dx = CA.lenPx(st.tx, 'x', box, frame, k), dy = CA.lenPx(st.ty, 'y', box, frame, k);
  let t = `translate(${dx}px, ${dy}px) scale(${st.sx}, ${st.sy})`;
  if (st.rz) t += ` rotate(${st.rz}deg)`;
  if (st.rx || st.ry) t = `perspective(400px) ${t} rotateX(${st.rx}deg) rotateY(${st.ry}deg)`;
  if (st.skx) t += ` skewX(${st.skx}deg)`;
  return { transform: t, opacity: Math.max(0, Math.min(1, st.op)) };
}

/** 효과 미리보기 카드 — 마우스를 올리면 움직인다. */
function AnimThumb({ type, label, on, onClick }) {
  const ref = useRef(null);
  const raf = useRef(0);
  const play = () => {
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const loop = (now) => {
      const el = ref.current; if (!el) return;
      const p = ((now - t0) % 1400) / 900;
      if (type === 'typing') {
        const n = Math.min(4, Math.ceil(Math.min(1, p) * 4));
        el.textContent = 'text'.slice(0, n); el.style.transform = 'none'; el.style.opacity = 1;
      } else {
        const st = CA.sampleState(type, Math.min(1, p));
        const css = stateCss(st, { w: 40, h: 20 }, { w: 90, h: 60 }, 0.1);
        el.style.transform = css.transform; el.style.opacity = css.opacity;
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  };
  const stop = () => { cancelAnimationFrame(raf.current); if (ref.current) { ref.current.style.transform = 'none'; ref.current.style.opacity = 1; ref.current.textContent = 'text'; } };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return (
    <button className={'cf-anim' + (on ? ' on' : '')} onMouseEnter={play} onMouseLeave={stop} onClick={onClick} title={label}>
      <span className="cf-animbox"><span ref={ref} className="cf-animtxt">text</span></span>
      <span className="cf-animl">{label}</span>
    </button>
  );
}

/**
 * @param value     지금 효과 {type, duration, delay} | null
 * @param onChange  (anim|null) => void
 * @param onReset   효과 덮어쓰기 지우기(채널 기본 효과로)
 */
export function CaptionAnimPanel({ value, onChange, onReset, onClose, title }) {
  const a = CF.normAnim(value);
  const info = a ? CF.ANIM_INFO[a.type] : null;
  const [tab, setTab] = useState(info && info.highlight ? 'hl' : 'inout');
  const groups = CF.ANIM_LIST.filter((g) => (tab === 'hl' ? g.highlight : !g.highlight));
  const pick = (g) => {
    const def = g.types[0][0];
    onChange({ type: def, duration: a ? a.duration : 900, delay: a ? a.delay : 0 });
  };
  const timings = info ? [...new Set(CF.ANIM_LIST.find((g) => g.preset === info.preset).types.map((t) => t[1]))] : [];
  const tLabel = { IN: '등장', OUT: '퇴장', INOUT: '전체', ONCE: '한 번', LOOP: '반복' };
  const dirsAvail = info ? CF.ANIM_LIST.find((g) => g.preset === info.preset).types.filter((t) => t[1] === info.timing).map((t) => t[2]) : [];
  return (
    <div className="cf-panel" data-testid="cf-anim">
      <div className="cf-head"><b>{title || '애니메이션'}</b>{onClose && <button className="ghost cf-x" onClick={onClose}>✕</button>}</div>
      <div className="cf-body">
        <div className="cf-sec">
          <div className="cf-sech">선택된 효과</div>
          <div className="cf-row cf-cur">
            <span className="cf-animbox big"><span className="cf-animtxt">text</span></span>
            <b>{info ? `${info.label}${info.dir && info.dir !== 'NONE' ? ' ' + (DIRS.find((d) => d[0] === info.dir) || [])[1] : ''} · ${tLabel[info.timing]}` : (value === null ? '애니메이션 없음' : '애니메이션 없음')}</b>
            <span className="cf-gap" />
            <button className="ghost cf-sm" onClick={() => onChange(null)} title="효과를 끕니다">없음</button>
            {onReset && <button className="ghost cf-sm" onClick={onReset} title="이 범위의 효과 덮어쓰기를 지웁니다(채널 기본 효과로)">↺ 초기화</button>}
          </div>
        </div>
        <div className="cf-sec">
          <div className="cf-sech">모든 효과</div>
          <div className="cf-tabs"><button className={tab === 'inout' ? 'on' : ''} onClick={() => setTab('inout')}>등장/퇴장</button><button className={tab === 'hl' ? 'on' : ''} onClick={() => setTab('hl')}>강조</button></div>
          <div className="cf-animgrid">
            {groups.map((g, gi) => {
              const on = info && info.preset === g.preset;
              // Vrew 처럼 고른 효과의 **줄이 끝난 뒤**(3칸 단위)에 옵션을 펼친다 — 카드 바로 뒤에 끼우면 같은 줄의 다음 카드가 밀려난다
              const selIdx = info ? groups.findIndex((x) => x.preset === info.preset) : -1;
              const rowEnd = selIdx >= 0 ? Math.min(groups.length - 1, Math.floor(selIdx / 3) * 3 + 2) : -1;
              return (
                <React.Fragment key={g.preset}>
                  <AnimThumb type={g.types[0][0]} label={g.label} on={on} onClick={() => pick(g)} />
                  {gi === rowEnd && info && (
                    <div className="cf-animopts">
                      <div className="cf-sech">타이밍</div>
                      <div className="cf-seg">{timings.map((tm) => (
                        <button key={tm} className={info.timing === tm ? 'on' : ''} onClick={() => onChange({ ...a, type: CF.animTypeFor(info.preset, tm, info.dir) })}>{tLabel[tm]}</button>
                      ))}</div>
                      <div className="cf-sech">방향</div>
                      <div className="cf-seg">{DIRS.map(([d, lab]) => (
                        <button key={d} disabled={!dirsAvail.includes(d)} className={info.dir === d ? 'on' : ''} onClick={() => onChange({ ...a, type: CF.animTypeFor(info.preset, info.timing, d) })}>{lab}</button>
                      ))}</div>
                      <div className="cf-sech">재생 시간</div>
                      <Slider value={a.duration / 1000} min={0.1} max={5} step={0.1} unit="초" lo="빠르게" hi="길게" onChange={(v) => onChange({ ...a, duration: Math.round(v * 1000) })} />
                      <div className="cf-sech">시작 지연</div>
                      <Slider value={a.delay / 1000} min={0} max={5} step={0.1} unit="초" lo="바로" hi="늦게" onChange={(v) => onChange({ ...a, delay: Math.round(v * 1000) })} />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 상단 툴바 (Vrew 상단 서식 막대) ───────────────────────────────────────
/**
 * @param fmt      지금 서식(첫 글자 기준)
 * @param onPatch  (patch) => void
 * @param onClear  서식 지우기(채널 기본으로)
 * @param onPanel  ('fmt'|'anim') => void — 고급·효과 패널 열기
 * @param label    선택 설명(「3줄」·「글자 5자」)
 */
// 📐 위치 미세조정 단위 — Vrew 슬라이더 1칸 = 0.0025(채널 편집의 「미세」와 같은 단위 · + = 아래/오른쪽)
const POS_STEP = 0.0025;
const posN = (v) => Math.round((Number(v) || 0) / POS_STEP);
/**
 * 🎨 자막 서식 툴바 — 작업 화면에 **늘 떠 있다**(2026-09-25 v0.5.41 · 로이: 「툴바가 안 뜬다 — 항상 꺼내 둘 것」).
 * @param active  고른 줄·글자가 있는가 — 없으면 안내만 보이고 칸은 잠긴다(보이는 값 = 채널 기본)
 * @param pos     지금 위치 {align, yAlign, yOffset, xOffset} — 채널 위치 + 고른 줄의 덮어쓰기
 * @param onSaveDefault  지금 서식·위치를 **채널 기본값**으로 저장(📝 자막 탭과 같은 값)
 */
export function CaptionToolbar({ fmt, pos, active = true, onPatch, onClear, onPanel, onDone, onSaveDefault, label, panel }) {
  const f = fmt || CF.normFmt({});
  const p = pos || { align: 'center', yAlign: 'bottom', yOffset: -0.125, xOffset: 0 };
  const { fonts } = useCaptionFonts();
  const { list: saved } = useSavedFormats();
  const info = f.anim ? CF.ANIM_INFO[f.anim.type] : null;
  const H = [['start', '⇤', '왼쪽 정렬'], ['center', '↔', '가운데 정렬'], ['end', '⇥', '오른쪽 정렬']];
  const V = [['top', '⤒', '위'], ['middle', '↕', '가운데'], ['bottom', '⤓', '아래']];
  return (
    <div className={'cf-bar' + (active ? '' : ' idle')} data-testid="cf-bar" onMouseDown={(e) => { if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') e.preventDefault(); }}>
      <span className="cf-sel" data-testid="cf-sel">{active ? `✏ ${label}` : '🎨 자막 서식'}</span>
      {!active && <span className="cf-hint" data-testid="cf-hint">자막 줄 번호(01 |)를 누르거나 글자를 드래그하세요 · 지금 보이는 값 = 채널 기본</span>}
      <fieldset className="cf-ctrls" disabled={!active}>
        <button className="ghost" title="서식 지우기 — 채널 기본 서식으로 되돌립니다(위치·정렬 포함)" onClick={onClear}>⌫ 서식 지우기</button>
        <select className="cf-savedsel" value="" title="저장된 서식 적용" onChange={(e) => { const s = saved.find((x) => x.id === e.target.value); if (s) onPatch(s.fmt); }}>
          <option value="">저장된 서식 ▾</option>
          {saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="cf-div" />
        <Toggle on={f.bold} onChange={(v) => onPatch({ bold: v })} title="굵게"><b>B</b></Toggle>
        <Toggle on={f.italic} onChange={(v) => onPatch({ italic: v })} title="기울임"><i>I</i></Toggle>
        <Toggle on={f.underline} onChange={(v) => onPatch({ underline: v })} title="밑줄"><u>U</u></Toggle>
        <Toggle on={f.strike} onChange={(v) => onPatch({ strike: v })} title="취소선"><s>S</s></Toggle>
        <select className="cf-fontsel" value={f.font} title="글꼴" style={{ fontFamily: fontCss(f.font).family }} onChange={(e) => onPatch({ font: e.target.value })}>
          {!fonts.some((x) => x.vrewName === f.font) && <option value={f.font}>{fontLabel(fonts, f.font)}</option>}
          {fonts.map((x) => <option key={x.vrewName} value={x.vrewName}>{x.label} {x.weight}</option>)}
        </select>
        <select value={String(f.size || 100)} title="글자 크기" onChange={(e) => onPatch({ size: Number(e.target.value) })}>
          {[...new Set([...SIZES, Number(f.size || 100)])].sort((a, b) => a - b).map((v) => <option key={v} value={String(v)}>{v}</option>)}
        </select>
        <label className="cf-cbtn" title="글자색"><span style={{ color: f.fontColor, WebkitTextStroke: '0.5px #555' }}>A</span><Color value={f.fontColor} onChange={(v) => onPatch({ fontColor: v })} /></label>
        <span className="cf-div" />
        <Toggle on={f.outlineOn !== false} onChange={(v) => onPatch({ outlineOn: v })} title="테두리 켜기/끄기">테두리</Toggle>
        <Color value={f.outlineColor} onChange={(v) => onPatch({ outlineColor: v, outlineOn: true })} />
        <Toggle on={!!f.boxOn} onChange={(v) => onPatch({ boxOn: v })} title="배경 상자(줄 전체)">배경</Toggle>
        <Toggle on={!!f.hlOn} onChange={(v) => onPatch({ hlOn: v })} title="형광펜(글자 뒤 칠)">형광펜</Toggle>
        <Color value={f.hlColor} onChange={(v) => onPatch({ hlColor: v, hlOn: true })} />
        <Toggle on={!!f.shadowOn} onChange={(v) => onPatch({ shadowOn: v })} title="그림자">그림자</Toggle>
        <span className="cf-div" />
        {/* 📐 위치·정렬 — 고른 **줄 전체**에 적용된다(글자 일부를 골라도 그 줄이 움직인다 — Vrew 와 같다) */}
        <span className="cf-grp" data-testid="cf-posh" title="가로 정렬 · 가로 미세(+ = 오른쪽)">
          {H.map(([v, ic, t]) => <Toggle key={v} on={p.align === v} onChange={() => onPatch({ posH: v })} title={`가로 ${t}`}>{ic}</Toggle>)}
          <Num w={52} title="가로 미세 — 1칸 = 0.0025(화면 폭 절반 기준) · + = 오른쪽" value={posN(p.xOffset)} min={-400} max={400} onChange={(v) => onPatch({ posX: (v || 0) * POS_STEP })} />
        </span>
        <span className="cf-grp" data-testid="cf-posv" title="세로 정렬 · 세로 미세(+ = 아래)">
          {V.map(([v, ic, t]) => <Toggle key={v} on={p.yAlign === v} onChange={() => onPatch({ posV: v, posY: null })} title={`세로 ${t}`}>{ic}</Toggle>)}
          <Num w={52} title="세로 위치 — 1칸 = 0.0025(화면 높이 절반 기준) · + = 아래" value={posN(p.yOffset)} min={-400} max={400} onChange={(v) => onPatch({ posV: p.yAlign, posY: (v || 0) * POS_STEP })} />
        </span>
        <span className="cf-div" />
        <button className={'ghost' + (panel === 'fmt' ? ' on' : '')} title="고급 — 간격·이중 테두리·그림자 위치·저장된 서식" onClick={() => onPanel('fmt')}>⚙ 고급</button>
        <button className={'ghost' + (panel === 'anim' ? ' on' : '')} title="효과 — 등장·퇴장·강조 애니메이션" onClick={() => onPanel('anim')}>✨ 효과{info ? `: ${info.label}` : ''}</button>
        {onSaveDefault && <button className="ghost cf-savedef" data-testid="cf-savedef" title="지금 서식·위치를 이 채널의 기본값으로 저장합니다(⚙ 채널편집 → 📝 자막 과 같은 값 — 앞으로 모든 자막에 적용)" onClick={onSaveDefault}>💾 자막 서식 저장</button>}
      </fieldset>
      <span className="cf-gap" />
      {active && <button className="ghost" title="선택 해제 (Esc)" onClick={onDone}>✕</button>}
    </div>
  );
}

// ── 미리보기 재생 — 한 줄을 서식·효과로 그린다 ────────────────────────────
/**
 * @param el     자막 칸(#stageCap)
 * @param runs   [{text, fmt}] — 채널 기본 + 덮어쓰기가 합쳐진 서식
 * @param line   {boxOn, boxColor, boxOpacity, anim}
 * @param durMs  줄 길이 · stageK = 미리보기 px / Vrew px
 * @returns 멈춤 함수
 */
export function renderStageLine(el, runs, line, durMs, stageK, stageBox) {
  if (!el) return () => {};
  el.innerHTML = '';
  const wrap = document.createElement('span');
  wrap.className = 'cf-stageline';
  if (line && line.boxOn) { wrap.style.background = rgba(line.boxColor, (Number(line.boxOpacity) || 0) / 100); wrap.style.padding = '0 0.15em'; }
  const baseSize = runs.length ? (Number(runs[0].fmt.size) || 100) : 100;
  const spans = [];
  for (const r of runs) {
    const s = document.createElement('span');
    Object.assign(s.style, fmtCss(r.fmt, stageK, true));
    if (r.fmt.size && r.fmt.size !== baseSize) s.style.fontSize = `${Math.round(r.fmt.size / baseSize * 100)}%`;
    s.textContent = r.text;
    wrap.appendChild(s); spans.push(s);
  }
  el.appendChild(wrap);
  const anim = line && line.anim;
  if (!anim) return () => {};
  const t0 = performance.now();
  const { windows, hiddenUntil } = CA.animWindows(anim, 0, durMs / 1000);
  const total = runs.reduce((a, r) => a + [...r.text].filter((c) => !/\s/.test(c)).length, 0);
  let raf = 0, stopped = false;
  const frame = { w: (stageBox && stageBox.w) || 360, h: (stageBox && stageBox.h) || 640 };
  const tick = (now) => {
    if (stopped) return;
    const t = (now - t0) / 1000;
    const w = windows.find((x) => t >= x.t0 && t < x.t1);
    let st = null, vis = null;
    if (t < hiddenUntil) st = { ...CA.sampleState(anim.type, 0) };
    else if (w) {
      const p = w.from + (w.to - w.from) * ((t - w.t0) / (w.t1 - w.t0));
      if (w.type === 'typing') vis = CA.typingVisible(p, total);
      else st = CA.sampleState(w.type, p);
    }
    if (st) { const css = stateCss(st, { w: wrap.offsetWidth, h: wrap.offsetHeight }, frame, stageK); wrap.style.transform = css.transform; wrap.style.opacity = css.opacity; }
    else { wrap.style.transform = 'none'; wrap.style.opacity = 1; }
    // 타이핑 — 보이는 글자까지만
    let seen = 0;
    runs.forEach((r, i) => {
      if (vis == null) { spans[i].textContent = r.text; return; }
      let out = '';
      for (const ch of r.text) { const c = !/\s/.test(ch); if (c && seen >= vis) break; out += ch; if (c) seen++; }
      spans[i].textContent = out;
    });
    raf = requestAnimationFrame(tick);
  };
  wrap.style.display = 'inline-block';
  wrap.style.transformOrigin = 'center center';
  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
