import React, { useEffect, useRef, useState } from 'react';
import api from './lib/ipc.js';

/**
 * 🖼🎬 이미지 • 비디오 클립 추가하기(v1.0.63 · 로이 2026-11-18 · Vrew 창 그대로)
 *   위 탭 = 내 이미지 · 비디오 / 무료 이미지 · 비디오 · 그 아래 = 전체 · 이미지 · 비디오 · GIF 와 전체 / 즐겨찾기 · 오른쪽 위 = ＋ PC에서 불러오기 ▾
 *   내 것 = 이 대본에 이미 쓴 그림·영상(mine · DTO) + ⚙ 설정 → 📁 「내 미디어」 폴더(main lib-search · 읽기만)
 *   무료 = Pexels · Pixabay(main stock-search → 고르면 stock-fetch 로 받아 그 파일로)
 *   하나를 누르면 그 파일로 새 클립을 만든다(onPick(file, kind)) · 즐겨찾기는 이 PC 만(localStorage — 없어도 동작)
 *   ⛔ 목록마다 <video> 를 두지 않는다(Chromium 플레이어 한도) — 영상은 main video-frame 정지 그림 + 길이
 */
const media = (p, v = '') => 'media://' + encodeURIComponent(p) + (v ? `?v=${encodeURIComponent(v)}` : '');
const extOf = (p) => (String(p || '').match(/\.([a-z0-9]+)$/i) || [])[1] || '';
const kindOf = (p) => { const e = extOf(p).toLowerCase(); return e === 'gif' ? 'gif' : /^(mp4|mov|webm|m4v)$/.test(e) ? 'video' : /^(png|jpe?g|webp)$/.test(e) ? 'image' : ''; };
const FAV_KEY = 'pm-media-fav';
function loadFav() { try { const a = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); return new Set(Array.isArray(a) ? a : []); } catch (_) { return new Set(); } }
function saveFav(set) { try { localStorage.setItem(FAV_KEY, JSON.stringify([...set].slice(-500))); } catch (_) {} }
const mmss = (t) => { const s = Math.max(0, Math.round(Number(t) || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

function VidThumb({ file, version }) {
  const [src, setSrc] = useState(null);
  const [dur, setDur] = useState(null);
  useEffect(() => {
    let dead = false;
    api.videoFrame({ file, t: 0.5 }).then((p) => { if (!dead) setSrc(p ? media(p) : ''); }).catch(() => {});
    return () => { dead = true; };
  }, [file, version]);
  return (<>
    {src ? <img src={src} alt="" draggable={false} /> : <span className="cmp-wait" />}
    <video className="cmp-probe" src={media(file, version)} preload="metadata" muted onLoadedMetadata={(e) => { setDur(e.currentTarget.duration); try { e.currentTarget.removeAttribute('src'); e.currentTarget.load(); } catch (_) {} }} />
    {dur > 0 && <span className="cmp-dur">{mmss(dur)}</span>}
  </>);
}

export default function ClipMediaPick({ kind, sn, mine, onPick, onClose, onOpenKeys }) {
  const [top, setTop] = useState('mine');   // mine | free
  const [sub, setSub] = useState(kind === 'video' ? 'video' : 'image');   // all | image | video | gif
  const [favOnly, setFavOnly] = useState(false);
  const [fav, setFav] = useState(loadFav);
  const [lib, setLib] = useState(null);     // lib-search 결과
  const [busy, setBusy] = useState('');
  const [pcMenu, setPcMenu] = useState(false);
  // 무료
  const [keys, setKeys] = useState(null);
  const [q, setQ] = useState('');
  const [stock, setStock] = useState([]);
  const [serr, setSerr] = useState([]);
  const genRef = useRef(0);

  useEffect(() => { let dead = false; api.libSearch({ lib: 'media', limit: 500 }).then((r) => { if (!dead) setLib(r || null); }).catch(() => { if (!dead) setLib(null); }); return () => { dead = true; }; }, []);
  useEffect(() => {
    if (top !== 'free' || keys) return undefined;
    let dead = false;
    api.stockKeysGet().then((k) => { if (!dead) setKeys(k || {}); }).catch(() => { if (!dead) setKeys({}); });
    return () => { dead = true; };
  }, [top, keys]);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' && !busy) { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  const mineAll = [
    ...(mine || []).map((x) => ({ path: x.path, version: x.version, name: x.name, from: x.from, kind: kindOf(x.path) })),
    ...((lib && lib.ok && lib.items) || []).map((x) => ({ path: x.path, name: x.name, from: '내 미디어', kind: kindOf(x.path) })),
  ].filter((x) => x.kind);
  const seen = new Set();
  const mineList = mineAll.filter((x) => { if (seen.has(x.path)) return false; seen.add(x.path); return true; })
    .filter((x) => sub === 'all' || x.kind === sub)
    .filter((x) => !favOnly || fav.has(x.path));
  const toggleFav = (p, ev) => { ev.stopPropagation(); const n = new Set(fav); if (n.has(p)) n.delete(p); else n.add(p); setFav(n); saveFav(n); };

  async function pick(file, k) {
    if (busy) return;
    setBusy('넣는 중…');
    try { await onPick(file, k === 'video' ? 'video' : 'image'); } finally { setBusy(''); }
  }
  async function pickStock(it) {
    if (busy) return;
    setBusy(`받는 중… (${it.src === 'pexels' ? 'Pexels' : 'Pixabay'})`);
    try {
      const r = await api.stockFetch({ shortsNum: sn, item: it });
      setBusy('');
      if (r && r.ok) await pick(r.path, r.kind);
    } catch (e) { setBusy(''); setSerr([String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')]); }
  }
  const srcs = () => ['pexels', 'pixabay'].filter((id) => keys && keys[id] && keys[id].has);
  async function search(pg = 1) {
    const qq = q.trim(); if (!qq || !srcs().length) return;
    const my = ++genRef.current; setBusy('찾는 중…'); setSerr([]);
    let r; try { r = await api.stockSearch({ q: qq, kind: sub === 'video' ? 'video' : 'photo', page: pg, sources: srcs(), perPage: 24 }); } catch (e) { r = { items: [], errors: [e.message] }; }
    if (my !== genRef.current) return;
    setBusy(''); setSerr(r.errors || []); setStock((cur) => (pg > 1 ? [...cur, ...r.items] : r.items));
  }
  const pcKind = sub === 'video' ? 'video' : sub === 'all' ? 'any' : 'image';
  const SUBS = top === 'free' ? [['image', '이미지'], ['video', '비디오']] : [['all', '전체'], ['image', '이미지'], ['video', '비디오'], ['gif', 'GIF']];

  return (
    <div className="modal-bg show" style={{ zIndex: 96 }} data-testid="clip-media-dlg" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="cmp-card" onMouseDown={() => setPcMenu(false)}>
        <div className="cmp-h"><b>이미지 • 비디오 클립 추가하기</b><button className="cmp-x" data-testid="cmp-close" title="닫기(Esc)" onClick={onClose}>✕</button></div>
        <div className="cmp-top">
          <button className={top === 'mine' ? 'on' : ''} data-testid="cmp-tab-mine" onClick={() => setTop('mine')}>내 이미지 · 비디오</button>
          <button className={top === 'free' ? 'on' : ''} data-testid="cmp-tab-free" onClick={() => { setTop('free'); if (sub === 'all' || sub === 'gif') setSub('image'); }}>무료 이미지 · 비디오</button>
        </div>
        <div className="cmp-bar">
          <span className="cmp-sub">{SUBS.map(([id, lb]) => <button key={id} className={sub === id ? 'on' : ''} data-testid={'cmp-sub-' + id} onClick={() => { setSub(id); if (top === 'free' && stock.length) setStock([]); }}>{lb}</button>)}</span>
          {top === 'mine' && (
            <span className="cmp-pc" onMouseDown={(e) => e.stopPropagation()}>
              <button className="cmp-pc-main" data-testid="cmp-pc" disabled={!!busy} title="PC 의 파일을 골라 넣습니다" onClick={() => pick(null, pcKind)}>＋ PC에서 불러오기</button>
              <button className="cmp-pc-more" data-testid="cmp-pc-more" disabled={!!busy} onClick={() => setPcMenu(!pcMenu)}>▾</button>
              {pcMenu && <span className="cmp-pc-menu">
                <button data-testid="cmp-pc-image" onClick={() => { setPcMenu(false); pick(null, 'image'); }}>🖼 이미지 파일</button>
                <button data-testid="cmp-pc-video" onClick={() => { setPcMenu(false); pick(null, 'video'); }}>🎬 비디오 파일</button>
              </span>}
            </span>
          )}
        </div>
        {top === 'mine' && <div className="cmp-sub2">
          <button className={!favOnly ? 'on' : ''} data-testid="cmp-all" onClick={() => setFavOnly(false)}>전체</button>
          <button className={favOnly ? 'on' : ''} data-testid="cmp-fav" onClick={() => setFavOnly(true)}>즐겨찾기</button>
        </div>}
        {top === 'free' && (keys && !srcs().length ? (
          <div className="meta cmp-nokey" data-testid="cmp-nokey">무료 이미지·비디오(Pexels · Pixabay)는 API 키가 필요합니다(둘 다 무료). <button onClick={onOpenKeys}>⚙ 설정 → API 키 열기</button></div>
        ) : (
          <div className="cmp-search">
            <input data-testid="cmp-q" value={q} placeholder="검색어(영어가 결과가 많습니다)" onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); search(1); } }} />
            <button data-testid="cmp-go" disabled={!!busy || !q.trim()} onClick={() => search(1)}>검색</button>
          </div>
        ))}
        <div className="cmp-grid" data-testid="cmp-grid">
          {top === 'mine' && mineList.map((x) => (
            <button type="button" key={x.path} className="cmp-it" data-testid="cmp-item" data-kind={x.kind} title={`${x.name}${x.from ? ' · ' + x.from : ''} — 누르면 이 파일로 새 클립`} disabled={!!busy} onClick={() => pick(x.path, x.kind)}>
              {x.kind === 'video' ? <VidThumb file={x.path} version={x.version} /> : <img src={media(x.path, x.version)} alt="" loading="lazy" draggable={false} />}
              <span className={'cmp-star' + (fav.has(x.path) ? ' on' : '')} data-testid="cmp-star" title="즐겨찾기" onClick={(e) => toggleFav(x.path, e)}>★</span>
            </button>
          ))}
          {top === 'free' && stock.map((it) => (
            <button type="button" key={it.src + it.id} className="cmp-it" data-testid="cmp-stock" disabled={!!busy} title={`${it.src === 'pexels' ? 'Pexels' : 'Pixabay'} · ${it.author || ''} — 누르면 받아서 새 클립`} onClick={() => pickStock(it)}>
              <img src={it.thumb} alt="" loading="lazy" draggable={false} />
              {it.kind === 'video' && <span className="cmp-dur">{mmss(it.dur)}</span>}
            </button>
          ))}
          {top === 'mine' && !mineList.length && <div className="meta cmp-empty">{favOnly ? '즐겨찾기한 것이 없습니다 — 그림 위 ★ 를 누르세요' : (lib && lib.unset ? '이 대본에 쓴 그림·영상이 없습니다 — 「＋ PC에서 불러오기」 또는 ⚙ 설정 → 📁 폴더 「내 미디어」' : '이 종류의 파일이 없습니다 — 「＋ PC에서 불러오기」')}</div>}
          {top === 'free' && !stock.length && !busy && srcs().length > 0 && <div className="meta cmp-empty">검색어를 넣고 Enter</div>}
        </div>
        {top === 'free' && stock.length > 0 && <div style={{ textAlign: 'center', margin: '4px 0' }}><button className="ghost" disabled={!!busy} onClick={() => search(Math.floor(stock.length / 24) + 1)}>더 보기</button></div>}
        {serr.map((e, i) => <div key={i} className="meta" style={{ color: 'var(--warn)', fontWeight: 600 }}>⚠ {e}</div>)}
        {busy && <div className="meta cmp-busy" data-testid="cmp-busy">⏳ {busy}</div>}
      </div>
    </div>
  );
}
