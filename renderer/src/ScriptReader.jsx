import React, { useEffect, useMemo, useRef, useState } from 'react';
import sr from '../../core/script-reader.js';

// 📄 대본 읽기 — 대본 내용만 깔끔하게 읽고, 고치고, A4 로 뽑는다 (2026-09-24)
//   내용 = core/script-reader.js(A4 PDF 와 같은 블록). 이미지·영상 프롬프트·메타는 없다.
//   ✏ 문장을 누르면 그 자리에서 고친다 — 저장은 메인 화면과 같은 edit-sentences(대본 .md 가 함께 바뀐다).
//      Enter 저장 · Esc 취소 · 글을 다 지우면 그 문장 삭제(확인). 고친 문장은 음성이 비워져 🎤 로 다시 만든다.

const fmtMin = (s) => { s = Math.round(Number(s) || 0); const m = Math.floor(s / 60); return m ? `${m}분 ${s % 60}초` : `${s}초`; };

export default function ScriptReader({ api, dto, onDto, onClose, uiConfirm, log }) {
  const [fontPx, setFontPx] = useState(17);
  const [headings, setHeadings] = useState(true);
  const [groupNums, setGroupNums] = useState(false);
  const [perSheet, setPerSheet] = useState(1);
  const [fontPt, setFontPt] = useState(11);
  const [edit, setEdit] = useState(null);          // {shortsNum, groupNum, i, text}
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const taRef = useRef(null);
  const doneRef = useRef(false);

  const projects = (dto && dto.projects) || [];
  const view = useMemo(() => projects.map((p) => ({ p, blocks: sr.readerBlocks(p, { headings }), st: sr.readerStats(p) })), [dto, headings]);
  const total = view.reduce((a, v) => ({ chars: a.chars + v.st.chars, sents: a.sents + v.st.sents, dur: a.dur + v.st.dur }), { chars: 0, sents: 0, dur: 0 });

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' && !edit) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [edit, onClose]);
  useEffect(() => { if (edit && taRef.current) { taRef.current.focus(); const n = taRef.current.value.length; taRef.current.setSelectionRange(n, n); } }, [edit]);

  function startEdit(shortsNum, groupNum, s) {
    if (busy) return;
    doneRef.current = false;
    setMsg('');
    setEdit({ shortsNum, groupNum, i: s.i, text: s.text });
  }
  async function commit() {
    const e = edit; if (!e || doneRef.current) return;
    const text = taRef.current ? taRef.current.value.replace(/\s*\n\s*/g, ' ').trim() : e.text;
    if (text === String(e.text).trim()) { setEdit(null); return; }
    if (!text && !uiConfirm('이 문장을 대본에서 지울까요?')) return;
    doneRef.current = true; setBusy(true);
    try {
      const r = await api.editSentences({ shortsNum: e.shortsNum, groupNum: e.groupNum, sentIdx: e.i, count: 1, text });
      if (!r || !r.ok) { setMsg('✗ ' + ((r && r.error) || '고치지 못했습니다') + ' — 이 문장은 대본(.md)에서 직접 고치세요.'); doneRef.current = false; return; }
      onDto(r.dto); setEdit(null); setMsg('✓ 고쳤습니다 — 대본(.md)에 저장됐고, 그 문장 음성은 🎤 TTS 로 다시 만들면 됩니다.');
    } catch (err) { setMsg('✗ ' + err.message); doneRef.current = false; }
    finally { setBusy(false); }
  }
  async function makePdf() {
    setBusy(true); setMsg('⏳ A4 PDF 만드는 중…');
    try {
      const r = await api.scriptReaderPdf({ perSheet, fontPt, headings, groupNums });
      setMsg(`✓ A4 ${r.pages}쪽${r.perSheet > 1 ? ` → 한 장에 ${r.perSheet}쪽 · ${r.sheets}장` : ''} — 열린 PDF 에서 인쇄하세요 (${r.path})`);
    } catch (e) { setMsg('✗ ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-bg show" data-testid="script-reader" style={{ zIndex: 70 }}>
      <div style={{ position: 'fixed', inset: 16, background: 'var(--bg)', borderRadius: 12, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,.2)' }}>
        <div className="frow" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', background: 'var(--card)', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <b style={{ color: 'var(--strong)', fontSize: 15 }}>📄 대본 읽기</b>
          <span className="meta">{total.sents}문장 · {total.chars.toLocaleString()}자(공백 제외){total.dur ? ` · 음성 ${fmtMin(total.dur)}` : ''}</span>
          <span style={{ flex: 1 }} />
          <span className="meta">화면 글자</span>
          <button className="ghost" style={{ padding: '3px 9px' }} onClick={() => setFontPx((f) => Math.max(12, f - 1))}>−</button>
          <span className="meta" style={{ width: 28, textAlign: 'center' }}>{fontPx}</span>
          <button className="ghost" style={{ padding: '3px 9px' }} onClick={() => setFontPx((f) => Math.min(28, f + 1))}>＋</button>
          <label className="chk" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" style={{ width: 'auto' }} checked={headings} onChange={(e) => setHeadings(e.target.checked)} />섹션 제목</label>
          <label className="chk" title="문단 앞에 그룹 번호(G3)를 작게 표시 — 앱 화면과 대조할 때" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" style={{ width: 'auto' }} checked={groupNums} onChange={(e) => setGroupNums(e.target.checked)} />그룹 번호</label>
          <span className="hdiv" />
          <span className="meta">A4 · 한 장에</span>
          <select value={perSheet} onChange={(e) => setPerSheet(Number(e.target.value))} title="한 장(A4)에 몇 쪽을 모아 찍을지 — 2·6쪽은 가로, 4·9쪽은 세로 용지">
            {sr.PER_SHEET.map((n) => <option key={n} value={n}>{n}쪽</option>)}
          </select>
          <span className="meta">글자</span>
          <input type="number" min="8" max="16" step="0.5" value={fontPt} style={{ width: 54 }} title="인쇄 글자 크기(pt) — 쪽 기준. 한 장에 여러 쪽이면 그만큼 작아집니다" onChange={(e) => setFontPt(Number(e.target.value) || 11)} />
          <span className="meta">pt</span>
          <button disabled={busy} onClick={makePdf} title="A4 PDF 를 출력 폴더에 저장하고 엽니다 — 열린 PDF 에서 인쇄하세요">🖨 A4 PDF</button>
          <button className="ghost" onClick={onClose}>닫기</button>
        </div>
        {msg && <div className="meta" style={{ padding: '6px 14px', background: msg.startsWith('✗') ? '#fbeaea' : '#f3f8ef', borderBottom: '1px solid var(--line)', color: msg.startsWith('✗') ? 'var(--danger)' : 'var(--base)' }}>{msg}</div>}
        <div style={{ flex: 1, overflow: 'auto', padding: '26px 16px 60px' }}>
          <div style={{ maxWidth: 760, margin: '0 auto', background: '#fff', border: '1px solid var(--line)', borderRadius: 6, padding: '40px 52px', fontSize: fontPx, lineHeight: 1.85, color: '#1d1a16', wordBreak: 'keep-all', fontFamily: "'Malgun Gothic', sans-serif" }}>
            {!view.length && <div className="meta">대본을 먼저 여세요.</div>}
            {view.map(({ p, blocks }, pi) => (
              <div key={pi}>
                {blocks.map((b, bi) => {
                  if (b.t === 'h1') return <h1 key={bi} style={{ fontSize: '1.55em', lineHeight: 1.35, margin: '0 0 0.9em', paddingBottom: '0.4em', borderBottom: '2px solid #333' }}>{b.text}</h1>;
                  if (b.t === 'h2') return <h2 key={bi} style={{ fontSize: '1.22em', margin: '1.6em 0 0.4em' }}>{b.text}</h2>;
                  if (b.t === 'h3') return <h3 key={bi} style={{ fontSize: '1em', color: '#6b5a47', margin: '1.1em 0 0.25em' }}>{b.text}</h3>;
                  const editingHere = edit && edit.shortsNum === p.shortsNum && edit.groupNum === b.groupNum && b.sents.some((s) => s.i === edit.i);
                  return (
                    <div key={bi} style={{ margin: '0 0 0.8em' }}>
                      <p style={{ margin: 0, textAlign: 'left' }}>
                        {groupNums && <span style={{ display: 'inline-block', minWidth: '2.6em', color: '#a89682', fontSize: '0.75em', fontWeight: 700 }}>G{b.groupNum}</span>}
                        {b.sents.map((s) => {
                          const on = editingHere && edit.i === s.i;
                          return (
                            <span key={s.i} className="rd-sent" data-g={b.groupNum} data-i={s.i}
                              title="눌러서 고치기" onClick={() => startEdit(p.shortsNum, b.groupNum, s)}
                              style={{ cursor: 'text', borderRadius: 3, background: on ? '#fbeed9' : undefined, outline: on ? '1px solid var(--accent)' : undefined }}>
                              {s.speaker && <b style={{ color: '#8a4b1f' }}>{s.speaker} </b>}{s.text}{' '}
                            </span>
                          );
                        })}
                      </p>
                      {editingHere && (
                        <textarea ref={taRef} data-testid="reader-edit" defaultValue={edit.text} rows={2} disabled={busy}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
                            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); doneRef.current = true; setEdit(null); }
                          }}
                          onBlur={() => commit()}
                          style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, fontSize: '0.95em', lineHeight: 1.6, padding: '6px 8px', border: '1px solid var(--accent)', borderRadius: 6, fontFamily: 'inherit' }} />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="meta" style={{ textAlign: 'center', marginTop: 10 }}>문장을 누르면 고칠 수 있습니다 — Enter 저장 · Esc 취소. 대본(.md)이 함께 바뀌고, 고친 문장의 음성만 비워집니다.</div>
        </div>
      </div>
    </div>
  );
}
