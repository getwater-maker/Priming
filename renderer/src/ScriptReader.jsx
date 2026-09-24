import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import sr from '../../core/script-reader.js';

// 📄 대본 읽기 — 대본 내용만 깔끔하게 읽고, 고치고, A4 로 뽑는다 (2026-09-24)
//   내용 = core/script-reader.js(A4 PDF 와 같은 블록). 이미지·영상 프롬프트·메타는 없다.
//   ✏ **대본 전체가 하나의 편집면**(v0.5.36) — 워드처럼 어디든 눌러 쓰고, 방향키로 문단을 넘나든다.
//      저장 = 손을 멈추고 1.2초 뒤 · 편집면 밖을 누를 때 · Enter. **한글 조합 중에는 저장하지 않는다**.
//      문단마다 고친 글과 원래 문장들을 글자 단위로 비교해 **바뀐 문장만** edit-sentences 로 보낸다(core paragraphEdits).
//   🔒 **잠근 경계 셋** — 문단 = 그룹(그림 한 장)이라 아래는 글 수정이 아니라 대본 구조 변경이다:
//      ① Enter 로 새 문단 만들기(= 새 그룹) ② 두 문단 잇기(문단 맨 앞 Backspace · 맨 끝 Delete · 문단을 걸친 선택 지우기)
//      ③ 섹션 제목 고치기. 화자 이름도 고칠 수 없는 칩이다. 막을 때는 이유를 알린다.
//      잠금은 브라우저 beforeinput(입력 종류 + 대상 범위)에서 한 곳으로 판정한다 — 키마다 따로 막으면 반드시 새는 길이 생긴다.
//      그래도 구조가 깨지면(취소할 수 없는 한글 조합 입력 등) 저장된 대본 기준으로 화면을 다시 그린다(저장 안 된 고침만 사라진다).
//   ⚠ React 는 편집면 안을 다시 그리지 않는다(docHtml 을 명시적으로 rebuild 할 때만) — 다시 그리면 커서·조합이 깨진다.

const fmtMin = (s) => { s = Math.round(Number(s) || 0); const m = Math.floor(s / 60); return m ? `${m}분 ${s % 60}초` : `${s}초`; };
const SAVE_IDLE_MS = 1200;
const escHtml = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const H_STYLE = {
  h1: 'font-size:1.55em;line-height:1.35;margin:0 0 0.9em;padding-bottom:0.4em;border-bottom:2px solid #333',
  h2: 'font-size:1.22em;margin:1.6em 0 0.4em',
  h3: 'font-size:1em;color:#6b5a47;margin:1.1em 0 0.25em',
};
// 고칠 수 없는 조각(제목·화자 이름·그룹 번호) = data-ne. 글을 읽을 때 건너뛴다. 이름 칩의 뒤 공백도 칩 안에 둔다
//   → 읽은 글 = 문장들을 공백 하나로 이은 글(joinParagraph)과 정확히 같다.
const NE = 'data-ne="1" contenteditable="false"';
function paraInner(sents, groupNum, groupNums) {
  return (groupNums ? `<span ${NE} style="display:inline-block;min-width:2.6em;color:#a89682;font-size:0.75em;font-weight:700;user-select:none">G${groupNum}</span>` : '')
    + sents.map((s, k) => (s.speaker ? `<b ${NE} data-spk="1" style="color:#8a4b1f;user-select:none">${escHtml(s.speaker)} </b>` : '')
      + escHtml(s.text) + (k < sents.length - 1 ? ' ' : '')).join('');
}
function docModel(dto, headings, groupNums) {
  const paras = [];
  let html = '';
  for (const pr of ((dto && dto.projects) || [])) {
    for (const b of sr.readerBlocks(pr, { headings })) {
      if (b.t !== 'p') { html += `<${b.t} ${NE} style="${H_STYLE[b.t]}">${escHtml(b.text)}</${b.t}>`; continue; }
      const key = 'p' + paras.length;
      paras.push({ key, shortsNum: pr.shortsNum, groupNum: b.groupNum, base: b.sents, last: sr.joinParagraph(b.sents.map((s) => s.text)), dirty: false });
      html += `<p class="rd-para" data-key="${key}" data-g="${b.groupNum}" style="margin:0 0 0.8em;text-align:left">${paraInner(b.sents, b.groupNum, groupNums)}</p>`;
    }
  }
  return { html, paras };
}
const isNE = (n) => !!(n && n.nodeType === 1 && n.hasAttribute && n.hasAttribute('data-ne'));
function readValue(el) {
  let out = '';
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue.replace(/ /g, ' ');
      else if (isNE(c)) continue;
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
      if (isNE(c)) continue;
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
const paraOf = (root, node) => {
  const el = node && (node.nodeType === 3 ? node.parentElement : node);
  const p = el && el.closest && el.closest('p[data-key]');
  return p && root.contains(p) ? p : null;
};
// 이 범위를 바꿔도 되는가 — 한 문단 안이고, 고칠 수 없는 조각(제목·이름·번호)을 덮지 않을 때만
function rangeOk(root, r) {
  const pa = paraOf(root, r.startContainer), pb = paraOf(root, r.endContainer);
  if (!pa || pa !== pb) return false;
  if (r.collapsed) return !isNE(r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer);
  const rr = document.createRange();
  rr.setStart(r.startContainer, r.startOffset); rr.setEnd(r.endContainer, r.endOffset);
  return ![...pa.querySelectorAll('[data-ne]')].some((c) => rr.intersectsNode(c));
}
// 커서 위치 = (문단 번호, 문단 글 안 글자 위치) — 화면을 다시 그린 뒤 그 자리로 돌아오게
function caretOf(root) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const p = paraOf(root, sel.anchorNode);
  if (!p) return null;
  const r = document.createRange(); r.selectNodeContents(p); r.setEnd(sel.anchorNode, sel.anchorOffset);
  const box = document.createElement('div'); box.appendChild(r.cloneContents());
  return { idx: [...root.querySelectorAll('p[data-key]')].indexOf(p), off: readValue(box).length };
}

export default function ScriptReader({ api, dto, onDto, onClose, uiConfirm, log, presetName }) {
  const [fontPx, setFontPx] = useState(17);
  const [headings, setHeadings] = useState(false);   // 섹션 제목(###) — 기본 끔. ## 장 제목은 언제나 보인다
  const [groupNums, setGroupNums] = useState(false);
  const [perSheet, setPerSheet] = useState(1);
  const [fontPt, setFontPt] = useState(11);
  const [busy, setBusy] = useState(false);
  const [saveSt, setSaveSt] = useState('');        // '' | 'dirty' | 'saving' | 'saved'
  const [msg, setMsg] = useState('');
  const [docHtml, setDocHtml] = useState('');
  const docRef = useRef(null);
  const parasRef = useRef(new Map());              // key → {shortsNum, groupNum, base, last, dirty}
  const neCountRef = useRef(0);
  const dtoRef = useRef(dto); dtoRef.current = dto;
  const optRef = useRef({ headings, groupNums }); optRef.current = { headings, groupNums };
  const st = useRef({ composing: false, saving: false, pending: false, timer: null, needRebuild: false, caret: null, lastErr: false });

  const projects = (dto && dto.projects) || [];
  const stats = useMemo(() => projects.reduce((a, p) => { const x = sr.readerStats(p); return { chars: a.chars + x.chars, sents: a.sents + x.sents, dur: a.dur + x.dur }; }, { chars: 0, sents: 0, dur: 0 }), [dto]);
  const anyDirty = () => [...parasRef.current.values()].some((p) => p.dirty);
  const busyNow = () => st.current.composing || st.current.saving || anyDirty();

  // 저장된 대본 기준으로 편집면을 다시 그린다 — 커서는 (문단 번호, 글자 위치)로 되돌린다
  function rebuild(d = dtoRef.current) {
    const root = docRef.current;
    st.current.caret = root && document.activeElement === root ? caretOf(root) : null;
    const m = docModel(d, optRef.current.headings, optRef.current.groupNums);
    parasRef.current = new Map(m.paras.map((p) => [p.key, p]));
    st.current.needRebuild = false;
    setDocHtml(m.html);
  }
  useLayoutEffect(() => {
    const root = docRef.current; if (!root) return;
    neCountRef.current = root.querySelectorAll('[data-ne]').length;
    root.readerValue = (i) => readValue(root.querySelectorAll('p[data-key]')[i]);   // 테스트가 같은 규칙으로 읽는다
    const c = st.current.caret; st.current.caret = null;
    if (c && c.idx >= 0) { const p = root.querySelectorAll('p[data-key]')[c.idx]; if (p) { root.focus(); placeCaret(p, c.off); } }
  }, [docHtml]);
  // 처음 · 섹션 제목/그룹 번호 토글 → 저장을 끝낸 뒤 다시 그린다
  useEffect(() => { (async () => { await settle(); rebuild(); })(); }, [headings, groupNums]);
  // 바깥에서 대본이 바뀌면(음성 생성 등) 편집 중이 아닐 때만 새로 그린다
  useEffect(() => { if (docHtml && !busyNow() && document.activeElement !== docRef.current) rebuild(); }, [dto]);

  // ── 저장 ──────────────────────────────────────────────────────────────
  function schedule() {
    clearTimeout(st.current.timer);
    setSaveSt('dirty');
    st.current.timer = setTimeout(flushAll, SAVE_IDLE_MS);
  }
  // 편집면을 훑어 글이 바뀐 문단을 표시한다. 구조가 깨졌으면(문단·잠긴 조각 수가 달라짐) 되돌린다.
  function scan() {
    const root = docRef.current; if (!root) return;
    const els = root.querySelectorAll('p[data-key]');
    if (els.length !== parasRef.current.size || root.querySelectorAll('[data-ne]').length !== neCountRef.current) {
      clearTimeout(st.current.timer);
      setMsg('↩ 문단 경계·제목·이름이 바뀌는 입력이라 되돌렸습니다(저장 안 된 고침은 사라졌습니다) — 문단 경계는 대본(.md)에서 바꾸세요.');
      rebuild(); return;
    }
    for (const el of els) {
      const p = parasRef.current.get(el.dataset.key);
      const v = readValue(el);
      if (p && v !== p.last) { p.last = v; p.dirty = true; }
    }
  }
  // 바뀐 문단만, 문단 안에서도 바뀐 문장만 보낸다. **뒤 문단부터**(같은 그룹 앞 문단의 문장 번호가 안 흔들리게).
  async function flushAll() {
    clearTimeout(st.current.timer);
    const S = st.current;
    if (S.composing) return;
    if (S.saving) { S.pending = true; return; }
    const dirty = [...parasRef.current.values()].filter((p) => p.dirty).reverse();
    if (!dirty.length) { setSaveSt((x) => (x === 'dirty' ? '' : x)); return; }
    S.saving = true; S.pending = false; setSaveSt('saving');
    let last = null, sent = 0;
    const errs = [];
    for (const p of dirty) {
      const v = p.last;
      const hunks = sr.paragraphEdits(p.base.map((s) => s.text), v);
      if (!hunks.length) { if (p.last === v) p.dirty = false; continue; }
      let err = '';
      try {
        for (const h of hunks.slice().reverse()) {
          const i0 = p.base[h.from].i, i1 = p.base[h.from + h.count - 1].i;
          const r = await api.editSentences({ shortsNum: p.shortsNum, groupNum: p.groupNum, sentIdx: i0, count: i1 - i0 + 1, text: h.text });
          if (!r || !r.ok) { err = (r && r.error) || '고치지 못했습니다'; break; }
          last = r.dto; sent++;
          refreshGroup(last, p.shortsNum, p.groupNum);
        }
      } catch (e) { err = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
      if (err) errs.push(`G${p.groupNum}: ${err}`);
      if (p.last === v) p.dirty = false;   // 저장하는 사이 또 고쳤으면 다음 차례에 한 번 더
    }
    S.saving = false; S.lastErr = errs.length > 0;
    if (last) onDto(last);
    if (errs.length) { setSaveSt(''); setMsg('✗ ' + errs.join(' / ') + ' — 그 부분은 대본(.md)에서 직접 고치세요.'); }
    else if (sent) { setSaveSt('saved'); setMsg(`✓ 바뀐 문장 ${sent}곳을 대본(.md)에 저장했습니다 — 고친 문장의 음성은 🎤 TTS 로 다시 만들면 됩니다.`); }
    else setSaveSt('');
    if ((S.pending || anyDirty()) && !S.composing) return flushAll();
    if (S.needRebuild && !S.composing) rebuild(last || dtoRef.current);
  }
  // 저장 뒤 그 그룹 문단들의 기준 문장을 새 대본으로 — 문단 수가 달라졌으면(합쳐짐 등) 다시 그려야 한다
  function refreshGroup(d, shortsNum, groupNum) {
    const pr = ((d && d.projects) || []).find((x) => x.shortsNum === shortsNum);
    const blocks = pr ? sr.readerBlocks(pr, { headings: false }).filter((b) => b.t === 'p' && b.groupNum === groupNum) : [];
    const mine = [...parasRef.current.values()].filter((p) => p.shortsNum === shortsNum && p.groupNum === groupNum);
    if (blocks.length !== mine.length) { st.current.needRebuild = true; return; }
    mine.forEach((p, k) => { p.base = blocks[k].sents; });
  }
  // 저장이 끝날 때까지 기다린다(닫기·PDF·토글 전에)
  async function settle() {
    for (let k = 0; k < 400; k++) {
      if (st.current.saving) { await new Promise((r) => setTimeout(r, 50)); continue; }
      if (!anyDirty() || st.current.composing) return;
      await flushAll();
      if (st.current.lastErr) return;
    }
  }
  function revertDirty() {
    const root = docRef.current; if (!root) return;
    for (const p of parasRef.current.values()) {
      if (!p.dirty) continue;
      const el = root.querySelector(`p[data-key="${p.key}"]`);
      if (el) el.innerHTML = paraInner(p.base, p.groupNum, optRef.current.groupNums);
      p.last = sr.joinParagraph(p.base.map((s) => s.text)); p.dirty = false;
    }
    clearTimeout(st.current.timer); setSaveSt(''); setMsg('↩ 저장 안 된 고침을 되돌렸습니다.');
  }
  async function close() { await settle(); onClose(); }

  // ── 🔒 잠금 — beforeinput 한 곳에서 판정 ──────────────────────────────
  useEffect(() => {
    const root = docRef.current; if (!root) return undefined;
    const onBI = (e) => {
      const t = e.inputType || '';
      if (t === 'insertParagraph' || t === 'insertLineBreak') {
        e.preventDefault(); flushAll();
        setMsg('ⓘ 새 문단은 만들 수 없습니다 — 문단 하나가 그룹(그림 한 장)이라, 새 문단은 대본(.md)에서 만드세요. (Enter = 지금 저장)');
        return;
      }
      if (t === 'insertFromDrop' || t === 'deleteByDrag') { e.preventDefault(); return; }
      if (t.startsWith('history')) return;   // 되돌리기는 허용 — 구조가 깨지면 scan 이 되돌린다
      const sel = window.getSelection();
      const tr = e.getTargetRanges ? e.getTargetRanges() : [];
      const ranges = tr.length ? tr : (sel.rangeCount ? [sel.getRangeAt(0)] : []);
      if (ranges.every((r) => rangeOk(root, r))) return;
      if (e.cancelable) e.preventDefault();
      setMsg(t.startsWith('delete')
        ? 'ⓘ 문단을 잇거나 제목·화자 이름을 지울 수는 없습니다 — 문단 합치기는 메인 화면의 ⤒ 그룹 합치기, 제목·이름은 대본(.md)에서.'
        : 'ⓘ 문단을 걸친 선택에는 쓸 수 없습니다 — 한 문단 안에서 고쳐 주세요.');
    };
    root.addEventListener('beforeinput', onBI);
    return () => root.removeEventListener('beforeinput', onBI);
  }, []);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  async function makePdf() {
    await settle();
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
          <span className="meta">{stats.sents}문장 · {stats.chars.toLocaleString()}자(공백 제외){stats.dur ? ` · 음성 ${fmtMin(stats.dur)}` : ''}</span>
          <span style={{ flex: 1 }} />
          <span className="meta">화면 글자</span>
          <button className="ghost" style={{ padding: '3px 9px' }} onClick={() => setFontPx((f) => Math.max(12, f - 1))}>−</button>
          <span className="meta" style={{ width: 28, textAlign: 'center' }}>{fontPx}</span>
          <button className="ghost" style={{ padding: '3px 9px' }} onClick={() => setFontPx((f) => Math.min(28, f + 1))}>＋</button>
          <label className="chk" data-testid="reader-headings" title="섹션 제목(### 소제목)을 보입니다 — ## 장 제목은 언제나 보입니다. A4 PDF 에도 같이 적용됩니다" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" style={{ width: 'auto' }} checked={headings} onChange={(e) => setHeadings(e.target.checked)} />섹션 제목</label>
          <label className="chk" title="문단 앞에 그룹 번호(G3)를 작게 표시 — 앱 화면과 대조할 때" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" style={{ width: 'auto' }} checked={groupNums} onChange={(e) => setGroupNums(e.target.checked)} />그룹 번호</label>
          <span className="hdiv" />
          <span className="meta">A4 · 한 장에</span>
          <select value={perSheet} style={{ flex: '0 0 auto', width: 'auto' }} onChange={(e) => setPerSheet(Number(e.target.value))} title="한 장(A4)에 몇 쪽을 모아 찍을지 — 2·6쪽은 가로, 4·9쪽은 세로 용지">
            {sr.PER_SHEET.map((n) => <option key={n} value={n}>{n}쪽</option>)}
          </select>
          <span className="meta">글자</span>
          {/* ⚠ 전역 input 규칙이 이 칸을 한 줄 끝까지 늘렸다 — 폭을 못박는다(로이 2026-09-24) */}
          <input data-testid="reader-fontpt" type="number" min="8" max="16" step="0.5" value={fontPt}
            style={{ flex: '0 0 58px', width: 58, minWidth: 0, padding: '3px 6px' }}
            title="인쇄 글자 크기(pt) — 쪽 기준. 한 장에 여러 쪽이면 그만큼 작아집니다" onChange={(e) => setFontPt(Number(e.target.value) || 11)} />
          <span className="meta">pt</span>
          <button disabled={busy} onClick={makePdf} title="A4 PDF 를 채널의 「대본 PDF」 폴더(기본 = 윈도우 다운로드 · ⚙ 채널편집 → 📁 폴더)에 저장하고 엽니다 — 열린 PDF 에서 인쇄하세요">🖨 A4 PDF</button>
          <button className="ghost" onClick={close}>닫기</button>
        </div>
        {msg && <div className="meta" data-testid="reader-msg" style={{ padding: '6px 14px', background: msg.startsWith('✗') ? '#fbeaea' : '#f3f8ef', borderBottom: '1px solid var(--line)', color: msg.startsWith('✗') ? 'var(--danger)' : 'var(--base)' }}>{msg}</div>}
        <div style={{ flex: 1, overflow: 'auto', padding: '26px 16px 60px' }}>
          <div style={{ maxWidth: 760, margin: '0 auto', background: '#fff', border: '1px solid var(--line)', borderRadius: 6, padding: '40px 52px', fontSize: fontPx, lineHeight: 1.85, color: '#1d1a16', wordBreak: 'keep-all', fontFamily: "'Malgun Gothic', sans-serif" }}>
            {!projects.length && <div className="meta">대본을 먼저 여세요.</div>}
            <div ref={docRef} data-testid="reader-doc" contentEditable suppressContentEditableWarning spellCheck={false}
              style={{ outline: 'none', whiteSpace: 'pre-wrap', cursor: 'text' }}
              dangerouslySetInnerHTML={{ __html: docHtml }}
              onInput={() => { scan(); if (anyDirty() && !st.current.composing) schedule(); }}
              onCompositionStart={() => { st.current.composing = true; clearTimeout(st.current.timer); setSaveSt('dirty'); }}
              onCompositionEnd={() => { st.current.composing = false; scan(); if (anyDirty()) schedule(); }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (anyDirty()) { e.preventDefault(); e.stopPropagation(); revertDirty(); }
                  return;
                }
                // 문단을 걸친 선택에서 글자를 치면(한글 조합 포함) 선택을 지우지 말고 그 자리에 쓴다
                const sel = window.getSelection();
                if (sel.rangeCount && !sel.isCollapsed && (e.key.length === 1 || e.keyCode === 229) && !e.ctrlKey && !e.metaKey
                  && !rangeOk(docRef.current, sel.getRangeAt(0))) sel.collapseToEnd();
              }}
              onPaste={(e) => {   // 서식 없이 글만 — 붙여넣은 HTML 이 문단·칩을 흉내 내지 않게
                e.preventDefault();
                const t = (e.clipboardData.getData('text/plain') || '').replace(/\s*\r?\n\s*/g, ' ');
                if (t) document.execCommand('insertText', false, t);
              }}
              onCut={(e) => { const s = window.getSelection(); if (s.rangeCount && !rangeOk(docRef.current, s.getRangeAt(0))) { e.preventDefault(); setMsg('ⓘ 문단을 걸친 잘라내기는 할 수 없습니다.'); } }}
              onDrop={(e) => e.preventDefault()}
              onBlur={() => { if (!st.current.composing) flushAll(); }} />
          </div>
          <div className="meta" style={{ textAlign: 'center', marginTop: 10 }}>대본 전체를 워드처럼 고칩니다 — 손을 멈추거나 편집면 밖을 누르면 <b>바뀐 문장만</b> 대본(.md)에 저장합니다(한글 조합 중에는 저장하지 않음) · Enter = 지금 저장 · Esc = 저장 안 된 고침 되돌리기.
            새 문단 · 문단 잇기 · 제목/화자 이름 고치기는 막혀 있습니다(대본 구조라서). 고친 문장의 음성만 비워집니다.</div>
        </div>
      </div>
    </div>
  );
}
