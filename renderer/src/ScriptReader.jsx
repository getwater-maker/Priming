import React, { useEffect, useMemo, useRef, useState } from 'react';
import sr from '../../core/script-reader.js';

// 📄 대본 읽기 — 대본 내용만 깔끔하게 읽고, 고치고, A4 로 뽑는다 (2026-09-24)
//   내용 = core/script-reader.js(A4 PDF 와 같은 블록). 이미지·영상 프롬프트·메타는 없다.
//   ✏ 워드처럼 **문단을 눌러 그 자리에서 이어서** 고친다(v0.5.34). 문단 = 한 그룹(챕터 표식이 있으면 거기서 나뉜다).
//      저장 = 손을 멈추고 1.2초 뒤 · 다른 곳을 누를 때 · Enter. **한글 조합 중에는 저장하지 않는다**(조합이 끝나면 다시 센다).
//      고친 글과 원래 문장들을 글자 단위로 비교해 **바뀐 문장만** edit-sentences 로 보낸다(core paragraphEdits) —
//      안 고친 문장은 대본(.md)의 그 자리를 건드리지 않고 음성도 그대로 산다. Esc = 아직 저장 안 된 고침 취소.

const fmtMin = (s) => { s = Math.round(Number(s) || 0); const m = Math.floor(s / 60); return m ? `${m}분 ${s % 60}초` : `${s}초`; };
const SAVE_IDLE_MS = 1200;

// 편집 중인 문단 = (편, 그룹, 첫 문장 번호). 챕터 표식으로 나뉜 뒤쪽 문단도 첫 문장 번호로 가린다.
function findPara(dto, shortsNum, groupNum, startI) {
  const pr = ((dto && dto.projects) || []).find((x) => x.shortsNum === shortsNum);
  if (!pr) return null;
  return sr.readerBlocks(pr, { headings: false }).find((b) => b.t === 'p' && b.groupNum === groupNum && b.sents.some((s) => s.i === startI)) || null;
}

// ── 편집면(contentEditable) — 화면 문단과 같은 모양에 **화자 이름은 고칠 수 없는 칩**으로 (v0.5.35) ──
//   🔑 textarea 로는 화자 이름을 보여 줄 수 없다(글만 들어간다). 이름을 글에 섞으면 고친 글과 비교할 때 이름까지 문장으로 간다.
//   그래서 이름은 contenteditable=false 칩으로 두고, 글을 읽을 때 칩을 건너뛴다(readValue). 칩의 뒤 공백도 칩 안에 둔다
//   → 읽은 글 = 문장들을 공백 하나로 이은 글(joinParagraph)과 정확히 같다.
//   ⚠ React 는 이 안을 다시 그리지 않는다(dangerouslySetInnerHTML 문자열을 세션 동안 고정) — 다시 그리면 커서·조합이 깨진다.
const escHtml = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function paraHtml(sents) {
  return sents.map((s, k) => (s.speaker ? `<b data-spk="1" contenteditable="false" style="color:#8a4b1f;user-select:none">${escHtml(s.speaker)} </b>` : '')
    + escHtml(s.text) + (k < sents.length - 1 ? ' ' : '')).join('');
}
const isChip = (n) => !!(n && n.nodeType === 1 && n.dataset && n.dataset.spk);
function readValue(el) {
  let out = '';
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue.replace(/\u00a0/g, ' ');
      else if (isChip(c)) continue;
      else if (c.nodeName === 'BR') out += ' ';
      else { if (/^(DIV|P)$/.test(c.nodeName) && out) out += ' '; walk(c); }
    }
  };
  if (el) walk(el);
  return out;
}
function placeCaret(el, pos) {
  const sel = window.getSelection(), r = document.createRange();
  let left = pos == null ? Infinity : pos, lastText = null;
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (isChip(c)) continue;
      if (c.nodeType === 3) {
        lastText = c;
        if (left <= c.nodeValue.length) { r.setStart(c, left); return true; }
        left -= c.nodeValue.length;
      } else if (walk(c)) return true;
    }
    return false;
  };
  if (!walk(el)) { if (lastText) r.setStart(lastText, lastText.nodeValue.length); else r.selectNodeContents(el); }
  r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
}
// 커서 바로 앞(Backspace)/뒤(Delete)가 이름 칩인가 — 이름은 대본에서 따로 관리되므로 지우지 못하게 한다
function chipAt(el, back) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  let n = sel.anchorNode, off = sel.anchorOffset;
  if (n.nodeType === 3) {
    if (back ? off > 0 : off < n.nodeValue.length) return false;
    n = back ? n.previousSibling : n.nextSibling;
  } else n = n.childNodes[back ? off - 1 : off];
  return isChip(n);
}
// 칩이 섞인 선택을 지우면 이름이 사라진다 — 선택 안에 칩이 있는가
function selHasChip(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  return [...el.querySelectorAll('[data-spk]')].some((c) => r.intersectsNode(c));
}

export default function ScriptReader({ api, dto, onDto, onClose, uiConfirm, log, presetName }) {
  const [fontPx, setFontPx] = useState(17);
  const [headings, setHeadings] = useState(true);
  const [groupNums, setGroupNums] = useState(false);
  const [perSheet, setPerSheet] = useState(1);
  const [fontPt, setFontPt] = useState(11);
  const [edit, setEdit] = useState(null);          // {key, shortsNum, groupNum, startI, caret}
  const [busy, setBusy] = useState(false);
  const [saveSt, setSaveSt] = useState('');        // '' | 'dirty' | 'saving' | 'saved'
  const [msg, setMsg] = useState('');
  const taRef = useRef(null);
  const sessRef = useRef(null);                    // 편집 한 번 = 세션(값·기준 문장·조합 중·저장 중)

  const projects = (dto && dto.projects) || [];
  const view = useMemo(() => projects.map((p) => ({ p, blocks: sr.readerBlocks(p, { headings }), st: sr.readerStats(p) })), [dto, headings]);
  const total = view.reduce((a, v) => ({ chars: a.chars + v.st.chars, sents: a.sents + v.st.sents, dur: a.dur + v.st.dur }), { chars: 0, sents: 0, dur: 0 });

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' && !edit) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [edit, onClose]);
  useEffect(() => {
    const el = taRef.current;
    if (!edit || !el) return;
    el.readerValue = () => readValue(el);   // 테스트가 편집면의 글을 같은 규칙으로 읽는다
    el.focus();
    placeCaret(el, edit.caret);
  }, [edit && edit.key]);

  // 누른 자리(글자)를 문단 글 안의 위치로 — 커서를 그 자리에 둔다
  function caretFromClick(e, b) {
    try {
      const r = document.caretRangeFromPoint && document.caretRangeFromPoint(e.clientX, e.clientY);
      const node = r && r.startContainer;
      const span = node && (node.nodeType === 3 ? node.parentElement : node).closest('.rd-sent');
      if (!span) return null;
      const k = b.sents.findIndex((s) => String(s.i) === span.dataset.i);
      if (k < 0) return null;
      let pos = 0; for (let x = 0; x < k; x++) pos += b.sents[x].text.length + 1;
      const s = b.sents[k];
      const inName = node.parentElement && node.parentElement.tagName === 'B';
      const local = (node.nodeType === 3 && node.nodeValue === s.text) ? r.startOffset : (inName ? 0 : s.text.length);
      return pos + Math.min(local, s.text.length);
    } catch (_) { return null; }
  }
  function startEdit(p, b, e) {
    if (busy) return;
    const key = `${p.shortsNum}:${b.groupNum}:${b.sents[0].i}`;
    if (edit && edit.key === key) return;
    setMsg('');
    sessRef.current = {
      key, shortsNum: p.shortsNum, groupNum: b.groupNum, startI: b.sents[0].i, base: b.sents,
      value: sr.joinParagraph(b.sents.map((s) => s.text)), html: paraHtml(b.sents),
      composing: false, saving: false, pending: false, timer: null, closing: false, cancelled: false,
    };
    setSaveSt('');
    setEdit({ key, shortsNum: p.shortsNum, groupNum: b.groupNum, startI: b.sents[0].i, caret: caretFromClick(e, b) });
  }
  const isCurrent = (sess) => sessRef.current === sess;
  function closeIf(sess) { if (isCurrent(sess)) { sessRef.current = null; setEdit(null); setSaveSt(''); } }
  function schedule(sess) {
    clearTimeout(sess.timer);
    if (sess.cancelled) return;
    setSaveSt('dirty');
    sess.timer = setTimeout(() => flush(sess), SAVE_IDLE_MS);
  }
  // 바뀐 문장만 보낸다 — 조합 중이면 안 보낸다. 저장 중에 또 고치면 끝난 뒤 한 번 더.
  //   🔑 세션 객체로 다룬다 — 다른 문단으로 옮겨 가도 앞 문단의 저장이 새 편집칸의 값·기준을 집지 않게.
  async function flush(sess) {
    clearTimeout(sess.timer);
    if (sess.cancelled || sess.composing) return;
    if (sess.saving) { sess.pending = true; return; }
    const hunks = sr.paragraphEdits(sess.base.map((s) => s.text), sess.value);
    if (!hunks.length) {
      if (isCurrent(sess)) setSaveSt('');
      if (sess.closing) closeIf(sess);
      return;
    }
    sess.saving = true;
    if (isCurrent(sess)) setSaveSt('saving');
    let last = null, err = '', done = 0;
    try {
      // 뒤에서부터 보낸다 — 앞 문장 번호가 흔들리지 않게
      for (const h of hunks.slice().reverse()) {
        const i0 = sess.base[h.from].i, i1 = sess.base[h.from + h.count - 1].i;
        const r = await api.editSentences({ shortsNum: sess.shortsNum, groupNum: sess.groupNum, sentIdx: i0, count: i1 - i0 + 1, text: h.text });
        if (!r || !r.ok) { err = (r && r.error) || '고치지 못했습니다'; break; }
        last = r.dto; done++;
      }
    } catch (e) { err = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
    sess.saving = false;
    if (last) {
      onDto(last);
      const nb = findPara(last, sess.shortsNum, sess.groupNum, sess.startI);
      if (nb && nb.sents[0].i === sess.startI) sess.base = nb.sents;
      else {   // 문단이 앞 문단과 합쳐지는 등 모양이 바뀌면 기준이 어긋난다 — 더 보내지 않고 닫는다
        sess.cancelled = true; closeIf(sess);
        setMsg('ⓘ 문단 구성이 바뀌어 편집을 닫았습니다 — 다시 눌러 이어서 고치세요.');
        return;
      }
    }
    if (err) {
      sess.pending = false;
      if (isCurrent(sess)) { setSaveSt('dirty'); setMsg('✗ ' + err + ' — 그 부분은 대본(.md)에서 직접 고치세요. (Esc = 저장 안 된 고침 취소)'); }
      if (sess.closing) { sess.cancelled = true; closeIf(sess); }
      return;
    }
    if (isCurrent(sess)) { setSaveSt('saved'); setMsg(`✓ 바뀐 문장 ${done}곳을 대본(.md)에 저장했습니다 — 고친 문장의 음성은 🎤 TTS 로 다시 만들면 됩니다.`); }
    if (sess.pending) { sess.pending = false; return flush(sess); }
    if (sess.closing) closeIf(sess);
  }
  async function makePdf() {
    setBusy(true); setMsg('⏳ A4 PDF 만드는 중…');
    try {
      const r = await api.scriptReaderPdf({ perSheet, fontPt, headings, groupNums, presetName: presetName || null });
      setMsg(`✓ A4 ${r.pages}쪽${r.perSheet > 1 ? ` → 한 장에 ${r.perSheet}쪽 · ${r.sheets}장` : ''} — 열린 PDF 에서 인쇄하세요 (${r.path})`);
    } catch (e) { setMsg('✗ ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-bg show" data-testid="script-reader" style={{ zIndex: 70 }}>
      <div style={{ position: 'fixed', inset: 16, background: 'var(--bg)', borderRadius: 12, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,.2)' }}>
        <div className="frow" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', background: 'var(--card)', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <b style={{ color: 'var(--strong)', fontSize: 15 }}>📄 대본 읽기</b>
          {saveSt && <span data-testid="reader-save" className="meta" style={{ color: saveSt === 'saved' ? 'var(--ok)' : 'var(--warn)' }}>{saveSt === 'saving' ? '⏳ 저장 중…' : saveSt === 'saved' ? '✓ 저장됨' : '✏ 고치는 중 — 멈추면 저장'}</span>}
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
          <button disabled={busy} onClick={makePdf} title="A4 PDF 를 채널의 「대본 PDF」 폴더(기본 = 윈도우 다운로드 · ⚙ 채널편집 → 📁 폴더)에 저장하고 엽니다 — 열린 PDF 에서 인쇄하세요">🖨 A4 PDF</button>
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
                  const key = `${p.shortsNum}:${b.groupNum}:${b.sents[0].i}`;
                  const gn = groupNums && <span style={{ display: 'inline-block', minWidth: '2.6em', color: '#a89682', fontSize: '0.75em', fontWeight: 700 }}>G{b.groupNum}</span>;
                  if (edit && edit.key === key) {
                    const sess = sessRef.current;
                    return (
                      <div key={key} style={{ margin: '0 0 0.8em', display: 'flex', alignItems: 'flex-start' }}>
                        {gn}
                        <p ref={taRef} data-testid="reader-edit" contentEditable suppressContentEditableWarning spellCheck={false}
                          dangerouslySetInnerHTML={{ __html: sess ? sess.html : '' }}
                          title="이어서 고치세요 — 손을 멈추거나 다른 곳을 누르면 바뀐 문장만 대본(.md)에 저장됩니다 · 화자 이름은 여기서 못 고칩니다(대본에서) · Enter 저장 후 닫기 · Esc 저장 안 된 고침 취소"
                          onInput={(e) => { const ss = sessRef.current; if (!ss) return; ss.value = readValue(e.currentTarget); if (!ss.composing) schedule(ss); }}
                          onCompositionStart={() => { const ss = sessRef.current; if (ss) { ss.composing = true; clearTimeout(ss.timer); setSaveSt('dirty'); } }}
                          onCompositionEnd={(e) => { const ss = sessRef.current; if (!ss) return; ss.composing = false; ss.value = readValue(e.currentTarget); schedule(ss); }}
                          onPaste={(e) => {   // 서식 없이 글만 — 붙여넣은 HTML 이 칩·구조를 흉내 내지 않게
                            e.preventDefault();
                            const t = (e.clipboardData.getData('text/plain') || '').replace(/\s*\r?\n\s*/g, ' ');
                            if (t) document.execCommand('insertText', false, t);
                          }}
                          onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing || e.keyCode === 229) return;   // 한글 조합 중 Enter 는 조합을 끝내는 키다
                            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                            else if (e.key === 'Escape') {
                              e.preventDefault(); e.stopPropagation();
                              const ss = sessRef.current; if (ss) { ss.cancelled = true; clearTimeout(ss.timer); closeIf(ss); }
                            } else if ((e.key === 'Backspace' || e.key === 'Delete') && (chipAt(e.currentTarget, e.key === 'Backspace') || selHasChip(e.currentTarget))) {
                              e.preventDefault(); setMsg('ⓘ 화자 이름은 여기서 지우거나 고칠 수 없습니다 — 대본(.md)의 [이름] 을 고치세요.');
                            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && selHasChip(e.currentTarget)) {
                              e.preventDefault();   // 이름이 든 선택을 글자로 덮어쓰면 이름이 사라진다
                            }
                          }}
                          onFocus={() => { const ss = sessRef.current; if (ss) ss.closing = false; }}
                          onBlur={() => { const ss = sessRef.current; if (!ss || ss.cancelled) return; ss.closing = true; setTimeout(() => flush(ss), 0); }}
                          style={{ flex: 1, minWidth: 0, margin: 0, padding: '0 2px', outline: '1px solid var(--accent)', borderRadius: 3, background: '#fffaf0', textAlign: 'left', whiteSpace: 'pre-wrap', cursor: 'text' }} />
                      </div>
                    );
                  }
                  return (
                    <div key={key} style={{ margin: '0 0 0.8em' }}>
                      <p className="rd-para" data-g={b.groupNum} title="눌러서 이어서 고치기" onClick={(e) => startEdit(p, b, e)} style={{ margin: 0, textAlign: 'left', cursor: 'text' }}>
                        {gn}
                        {b.sents.map((s) => (
                          <span key={s.i} className="rd-sent" data-g={b.groupNum} data-i={s.i}>
                            {s.speaker && <b style={{ color: '#8a4b1f' }}>{s.speaker} </b>}{s.text}{' '}
                          </span>
                        ))}
                      </p>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="meta" style={{ textAlign: 'center', marginTop: 10 }}>문단을 누르면 그 자리에서 이어서 고칩니다 — 손을 멈추거나 다른 곳을 누르면 <b>바뀐 문장만</b> 대본(.md)에 저장합니다(한글 조합 중에는 저장하지 않음) · Enter 저장 후 닫기 · Esc 저장 안 된 고침 취소. 고친 문장의 음성만 비워집니다.</div>
        </div>
      </div>
    </div>
  );
}
