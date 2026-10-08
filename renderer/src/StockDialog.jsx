import React, { useEffect, useRef, useState } from 'react';
import api from './lib/ipc.js';

/**
 * 🔎 무료 스톡 대화상자(v0.7.67 · 로이 2026-10-08) — Pexels · Pixabay 를 한 번에 검색해 고른 사진/영상을 이 그룹에 붙인다.
 *   검색·받기는 main(core/free-stock) · 키는 ⚙ 설정 → API 키(이 창엔 상태와 「설정 열기」만).
 *   ⛔ 결과마다 <video> 를 두지 않는다(Chromium 플레이어 한도) — 썸네일 그림만, 고른 영상 하나만 미리보기.
 *   props: target {shortsNum, groupNum, intro, kind?} — kind 가 있으면 그것(리본 무료이미지/무료비디오), 없으면 도입부=영상 · onClose() · onAttached(dto) · onOpenKeys()
 */
export default function StockDialog({ target, onClose, onAttached, onOpenKeys }) {
  const [keys, setKeys] = useState(null);
  const [q, setQ] = useState('');
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState(target && target.kind ? target.kind : (target && target.intro ? 'video' : 'photo'));
  const [srcs, setSrcs] = useState({ pexels: true, pixabay: true });
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState([]);
  const [sel, setSel] = useState(null);
  const [msg, setMsg] = useState('');
  const genRef = useRef(0);   // 번호표 — 늦게 온 옛 검색 결과가 새 결과를 덮지 않게

  const sources = (k = keys, s = srcs) => ['pexels', 'pixabay'].filter((id) => s[id] && k && k[id] && k[id].has);
  async function run(query, kd, pg, append, k, s) {
    const list = sources(k, s); const qq = String(query || '').trim();
    if (!qq || !list.length) return;
    const my = ++genRef.current; setBusy(true); setMsg(''); if (!append) { setSel(null); setErrs([]); }
    let r; try { r = await api.stockSearch({ q: qq, kind: kd, page: pg, sources: list, perPage: 24 }); } catch (e) { r = { items: [], errors: [e.message] }; }
    if (my !== genRef.current) return;
    setBusy(false); setPage(pg); setErrs(r.errors || []);
    setItems((cur) => (append ? [...cur, ...r.items.filter((x) => !cur.some((c) => c.src === x.src && c.id === x.id))] : r.items));
  }
  useEffect(() => {
    let dead = false;
    (async () => {
      let k = null, d = { q: '', prompt: '' };
      try { k = await api.stockKeysGet(); } catch {}
      try { d = await api.stockDefaultQuery({ shortsNum: target.shortsNum, groupNum: target.groupNum }); } catch {}
      if (dead) return;
      setKeys(k || {}); setQ(d.q || ''); setPrompt(d.prompt || '');
      if (d.q) run(d.q, kind, 1, false, k || {}, srcs);
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc = 닫기 — 창 안에 초점이 없어도(키 없음 화면) 듣는다. 🔑 리스너는 한 번만 단다(deps []) — App 의 Esc 처리기가 먼저 상태를 바꾸면
  //   같은 키 이벤트 도중 다시 그려지며, onClose 를 deps 로 두면 그 사이 리스너가 떼였다 다시 붙어 이번 Esc 를 못 듣는다(E2E 가 잡음).
  const busyRef = useRef(false); busyRef.current = busy;
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busyRef.current) { e.preventDefault(); closeRef.current(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  async function attach(it) {
    if (!it || busy) return;
    setBusy(true); setMsg(`⏳ 받는 중… (${it.src === 'pexels' ? 'Pexels' : 'Pixabay'} ${it.kind === 'video' ? '영상' : '사진'})`);
    try { const dto = await api.stockAttach({ shortsNum: target.shortsNum, groupNum: target.groupNum, item: it }); onAttached(dto, it); onClose(); }
    catch (e) { setBusy(false); setMsg('❌ ' + String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  }
  const noKey = keys && !sources(keys, { pexels: true, pixabay: true }).length;
  const flip = (id) => { const s = { ...srcs, [id]: !srcs[id] }; setSrcs(s); run(q, kind, 1, false, keys, s); };
  const setK = (kd) => { setKind(kd); run(q, kd, 1, false, keys, srcs); };
  const lab = (id) => (id === 'pexels' ? 'Pexels' : 'Pixabay');

  return (
    <div className="modal-bg show" style={{ zIndex: 96 }} data-testid="stock-dlg" onMouseDown={(ev) => { if (ev.target === ev.currentTarget && !busy) onClose(); }}>
      <div className="modal-card stock-card">
        <h3>🔎 무료 스톡 — G{target.groupNum} 에 넣기</h3>
        {noKey ? (
          <div className="stock-nokey" data-testid="stock-nokey">
            Pexels 또는 Pixabay API 키가 필요합니다(둘 다 무료). <button onClick={onOpenKeys}>⚙ 설정 → API 키 열기</button>
          </div>
        ) : (<>
          <div className="stock-bar">
            <input data-testid="stock-q" autoFocus value={q} placeholder="검색어(영어가 결과가 많습니다)" onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); run(q, kind, 1, false, keys, srcs); } }} />
            <button data-testid="stock-go" disabled={busy || !q.trim()} onClick={() => run(q, kind, 1, false, keys, srcs)}>검색</button>
            <span className="stock-seg">
              <button className={kind === 'photo' ? 'on' : ''} data-testid="stock-kind-photo" onClick={() => setK('photo')}>🖼 사진</button>
              <button className={kind === 'video' ? 'on' : ''} data-testid="stock-kind-video" onClick={() => setK('video')}>🎬 영상</button>
            </span>
            {['pexels', 'pixabay'].map((id) => (
              <label key={id} className="chk" title={keys && keys[id] && keys[id].has ? '' : '키 없음 — ⚙ 설정 → API 키'}>
                <input type="checkbox" data-testid={'stock-src-' + id} disabled={!(keys && keys[id] && keys[id].has)} checked={!!(srcs[id] && keys && keys[id] && keys[id].has)} onChange={() => flip(id)} />{lab(id)}
              </label>
            ))}
          </div>
          {prompt && <div className="meta stock-prompt" title={prompt}>이 그룹 이미지 프롬프트: {prompt}</div>}
          <div className="stock-grid" data-testid="stock-grid">
            {items.map((it) => {
              const on = sel && sel.src === it.src && sel.id === it.id;
              return (
                <button type="button" key={it.src + it.id} className={'stock-it' + (on ? ' on' : '')} data-testid="stock-item" data-src={it.src}
                  title={`${lab(it.src)} · ${it.author}${it.tags ? ' · ' + it.tags : ''} — 두 번 누르면 바로 넣기`}
                  onClick={() => setSel(it)} onDoubleClick={() => attach(it)}>
                  <img src={it.thumb} alt="" loading="lazy" draggable={false} />
                  <span className={'stock-badge ' + it.src}>{lab(it.src)}</span>
                  {it.kind === 'video' && <span className="stock-dur">▶ {Math.round(it.dur)}초</span>}
                </button>
              );
            })}
            {!items.length && !busy && <div className="meta" style={{ gridColumn: '1 / -1', padding: 20, textAlign: 'center' }}>{q.trim() ? '결과가 없습니다 — 검색어를 짧게·영어로 바꿔 보세요' : '검색어를 넣고 Enter'}</div>}
          </div>
          {items.length > 0 && <div style={{ textAlign: 'center', margin: '6px 0' }}><button className="ghost" data-testid="stock-more" disabled={busy} onClick={() => run(q, kind, page + 1, true, keys, srcs)}>더 보기</button></div>}
          {sel && (
            <div className="stock-sel" data-testid="stock-sel">
              {sel.kind === 'video' ? <video key={sel.dl} src={sel.dl} muted autoPlay loop playsInline /> : <img src={sel.thumb} alt="" />}
              <div className="stock-sel-info">
                <b>{lab(sel.src)} {sel.kind === 'video' ? `영상 · ${Math.round(sel.dur)}초` : '사진'}</b> · {sel.w}×{sel.h}
                <div className="meta">작가 <a href="#" onClick={(e) => { e.preventDefault(); api.stockOpenUrl(sel.authorUrl); }}>{sel.author || '미상'}</a> · <a href="#" onClick={(e) => { e.preventDefault(); api.stockOpenUrl(sel.pageUrl); }}>원본 페이지 ↗</a></div>
                <div className="meta">{sel.kind === 'photo' ? '사진은 화면 비율로 가운데를 잘라 넣습니다. ' : ''}출처는 출력 폴더 「스톡_출처.txt」에 남습니다.</div>
              </div>
              <button data-testid="stock-attach" disabled={busy} onClick={() => attach(sel)}>✅ 이 그룹에 넣기</button>
            </div>
          )}
        </>)}
        {errs.map((e, i) => <div key={i} className="meta" style={{ color: '#b45309', fontWeight: 600 }}>⚠ {e}</div>)}
        {busy && !msg && <div className="meta">⏳ 검색 중…</div>}
        {msg && <div className="meta" data-testid="stock-msg" style={{ fontWeight: 600 }}>{msg}</div>}
        <div className="mbtns">
          <span className="meta" style={{ marginRight: 'auto' }}>
            사진·영상 제공 <a href="#" onClick={(e) => { e.preventDefault(); api.stockOpenUrl('https://www.pexels.com'); }}>Pexels</a> · <a href="#" onClick={(e) => { e.preventDefault(); api.stockOpenUrl('https://pixabay.com'); }}>Pixabay</a> — 상업적 이용 가능 · 출처 표기 권장
          </span>
          <button className="ghost" disabled={busy} onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
