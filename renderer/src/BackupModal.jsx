import React, { useEffect, useState } from 'react';
import api from './lib/ipc.js';

/**
 * 🕘 백업에서 되살리기 (Lab · Vrew 차이표 #3·#5) — 대본마다 남은 세대(작업본 + 대본 .md)를 고르고 되살린다.
 *   세대 만들기·정리·되살리기는 main(core/gen-backup) 한 곳 · 이 창은 목록과 「되살리기」만.
 *   되살리기 직전 상태도 한 세대로 남는다(되살리기를 되돌릴 수 있다).
 *   props: onClose() · onRestored(r) — r = { dto, queue, mode }
 */
const REASON = { auto: '자동', open: '열 때', 'before-restore': '되살리기 전' };
function fmt(ms) {
  if (!ms) return '';
  const d = new Date(ms + 9 * 3600 * 1000);   // KST
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function kb(n) { return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; }

export default function BackupModal({ onClose, onRestored }) {
  const [list, setList] = useState(null);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.backupList().then((r) => setList((r && r.list) || [])).catch(() => setList([])); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function restore(x, g) {
    if (busy) return;
    const warn = x.open ? '\n\n· 이 대본은 지금 큐에 열려 있습니다 — 지금 상태를 한 세대로 남긴 뒤 되살려 다시 엽니다.' : '';
    if (!window.confirm(`「${x.name}」 을(를) ${fmt(g.at)} 상태로 되살립니다.\n\n· 대본(.md)과 작업본(그림·음성 연결)을 그 시각으로 되돌립니다\n· 지금 상태도 「되살리기 전」 백업으로 남습니다${warn}\n\n계속할까요?`)) return;
    setBusy(true); setMsg('');
    try {
      const r = await api.backupRestore({ base: x.base, id: g.id });
      if (!r || !r.ok) { setMsg('되살리지 못했습니다 — ' + ((r && r.error) || '로그를 보세요')); setBusy(false); return; }
      onRestored(r);
    } catch (e) { setMsg('오류: ' + e.message); setBusy(false); }
  }
  const cur = list && list[pick];
  return (
    <div className="modal-bg show" style={{ zIndex: 96 }} data-testid="backup-dlg" onMouseDown={(ev) => { if (ev.target === ev.currentTarget && !busy) onClose(); }}>
      <div className="modal-card wide">
        <h3 style={{ marginTop: 0 }}>🕘 백업에서 되살리기</h3>
        {!list ? <div className="meta">불러오는 중…</div> : !list.length ? <div className="meta">아직 백업이 없습니다 — 대본을 열면 그때부터 10분마다 쌓입니다.</div> : (
          <div style={{ display: 'flex', gap: 12, minHeight: 300 }}>
            <div style={{ width: 240, maxHeight: 420, overflowY: 'auto', borderRight: '1px solid var(--line)', paddingRight: 8 }}>
              {list.map((x, i) => (
                <button key={x.base} className={i === pick ? '' : 'ghost'} data-testid="backup-script" style={{ display: 'block', width: '100%', textAlign: 'left', margin: '2px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  title={x.scriptPath || x.base} onClick={() => setPick(i)}>
                  {x.open ? '📂 ' : ''}{x.name} <span className="meta">· {x.gens.length}</span>
                </button>
              ))}
            </div>
            <div style={{ flex: 1, maxHeight: 420, overflowY: 'auto' }}>
              {cur && !cur.exists && <div className="meta" style={{ color: 'var(--warn, #b45309)' }}>⚠ 원래 대본 파일이 그 자리에 없습니다 — 되살리면 그 자리에 다시 만듭니다.</div>}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr><th style={{ textAlign: 'left' }}>시각(KST)</th><th style={{ textAlign: 'left' }}>언제</th><th style={{ textAlign: 'right' }}>문장</th><th style={{ textAlign: 'right' }}>대본</th><th /></tr></thead>
                <tbody>
                  {cur && cur.gens.map((g, k) => (
                    <tr key={g.id} data-testid="backup-gen" style={{ borderTop: '1px solid var(--line)' }}>
                      <td>{fmt(g.at)}{k === 0 ? <span className="meta"> · 최신</span> : null}</td>
                      <td>{REASON[g.reason] || g.reason || ''}</td>
                      <td style={{ textAlign: 'right' }}>{g.sentences != null ? g.sentences : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{g.hasMd ? kb(g.mdSize) : '—'}</td>
                      <td style={{ textAlign: 'right' }}><button className="ghost" disabled={busy} data-testid="backup-restore" onClick={() => restore(cur, g)}>↩ 되살리기</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {msg && <div className="meta" style={{ marginTop: 8 }}>{msg}</div>}
        <div style={{ textAlign: 'right', marginTop: 12 }}><button className="ghost" disabled={busy} onClick={onClose}>닫기</button></div>
      </div>
    </div>
  );
}
