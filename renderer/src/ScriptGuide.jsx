import React, { useEffect, useState } from 'react';

// 📘 대본 작성 기준 — docs/대본-작성-가이드.md 를 보여 주고 파일 경로를 알려 준다 (v0.8.9 · 로이)
//   「누구나 이 파일을 보고 쓰면 프라이밍 기능을 100% 쓰도록」 — 내용의 정본은 그 .md 하나(여기서 고치지 않는다).
//   마크다운은 가볍게만 그린다(제목 · 목록 · 표 · 코드 · 인용 · 굵게 · `코드`) — 새 의존성 없이.

const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(t) {
  return esc(t)
    .replace(/`([^`]+)`/g, '<code style="background:#f1ede6;border-radius:4px;padding:0 4px;font-size:0.92em">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}
function mdToHtml(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (/^\s*```/.test(ln)) {
      const buf = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre style="background:#f7f4ee;border:1px solid #e6dfd3;border-radius:6px;padding:10px 12px;overflow:auto;font-size:0.86em;line-height:1.55;white-space:pre-wrap">${esc(buf.join('\n'))}</pre>`);
      continue;
    }
    const h = ln.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      const lv = h[1].length, sz = [0, 1.5, 1.25, 1.08, 1][lv];
      out.push(`<h${lv} style="font-size:${sz}em;margin:${lv <= 2 ? '1.4em' : '1em'} 0 0.4em;${lv <= 2 ? 'border-bottom:1px solid #e6dfd3;padding-bottom:0.2em' : ''}">${inline(h[2])}</h${lv}>`);
      i++; continue;
    }
    if (/^\s*\|/.test(ln)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|?\s*$/.test(r));
      out.push('<table style="border-collapse:collapse;margin:0.5em 0;font-size:0.92em">' + body.map((r, k) => `<tr>${cells(r).map((c) => `<${k ? 'td' : 'th'} style="border:1px solid #ddd5c8;padding:4px 8px;text-align:left;vertical-align:top${k ? '' : ';background:#f4efe7'}">${inline(c)}</${k ? 'td' : 'th'}>`).join('')}</tr>`).join('') + '</table>');
      continue;
    }
    if (/^\s*>/.test(ln)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<div style="border-left:3px solid #c9b79c;background:#faf7f1;padding:6px 10px;margin:0.5em 0;color:#5a4a36">${buf.map(inline).join('<br>')}</div>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(ln)) {
      const buf = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        const box = m[3].match(/^\[( |x)\]\s+(.*)$/i);
        buf.push(`<li style="margin:0.15em 0;margin-left:${Math.floor(m[1].length / 2) * 1.2}em">${box ? (box[1].trim() ? '☑ ' : '☐ ') + inline(box[2]) : inline(m[3])}</li>`);
        i++;
      }
      out.push(`<ul style="margin:0.3em 0;padding-left:1.3em">${buf.join('')}</ul>`);
      continue;
    }
    if (/^\s*---+\s*$/.test(ln)) { out.push('<hr style="border:0;border-top:1px solid #e6dfd3;margin:1.2em 0">'); i++; continue; }
    if (!ln.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(\s*```|#{1,4}\s|\s*\||\s*>|\s*([-*]|\d+\.)\s+|\s*---+\s*$)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p style="margin:0.4em 0">${buf.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

export default function ScriptGuide({ api, onClose }) {
  const [info, setInfo] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { (async () => { try { setInfo(await api.scriptGuide({ action: 'read' })); } catch (e) { setInfo({ ok: false, error: String(e.message || e) }); } })(); }, []);
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const act = async (action, done) => { try { const r = await api.scriptGuide({ action }); setMsg(r && r.ok ? done : '✗ ' + ((r && r.error) || '실패')); } catch (e) { setMsg('✗ ' + String(e.message || e)); } };
  return (
    <div className="modal-bg show" data-testid="script-guide" style={{ zIndex: 70 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ position: 'fixed', inset: 16, background: 'var(--bg)', borderRadius: 12, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,.2)' }}>
        <div className="frow" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', background: 'var(--card)', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <b style={{ color: 'var(--strong)', fontSize: 15 }}>📘 대본 작성 기준</b>
          <span className="meta">이 파일대로 쓰면 프라이밍 기능을 빠짐없이 씁니다 — 다른 사람·AI 에게 이 파일을 그대로 건네세요</span>
          <span style={{ flex: 1 }} />
          <button className="ghost" data-testid="guide-copy" onClick={() => act('copy', '✓ 경로를 복사했습니다')}>📋 경로 복사</button>
          <button className="ghost" data-testid="guide-reveal" onClick={() => act('reveal', '✓ 탐색기에서 파일을 보여 줍니다')}>📂 폴더 열기</button>
          <button className="ghost" data-testid="guide-open" onClick={() => act('open', '✓ 기본 프로그램으로 열었습니다')}>📝 파일 열기</button>
          <button className="ghost" onClick={onClose}>닫기</button>
        </div>
        <div className="meta" data-testid="guide-path" style={{ padding: '6px 14px', borderBottom: '1px solid var(--line)', background: 'var(--bg-f3f8ef,#f3f8ef)', wordBreak: 'break-all', userSelect: 'text' }}>
          📍 파일 위치: <b>{info ? info.path : '…'}</b>{msg ? <span style={{ marginLeft: 10 }}>{msg}</span> : null}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '22px 16px 60px' }}>
          <div style={{ maxWidth: 880, margin: '0 auto', background: 'var(--bg-ffffff,#fff)', border: '1px solid var(--line)', borderRadius: 6, padding: '28px 40px', fontSize: 15, lineHeight: 1.7, color: 'var(--fg-1d1a16,#1d1a16)', wordBreak: 'keep-all', userSelect: 'text' }}>
            {!info && <div className="meta">읽는 중…</div>}
            {info && !info.ok && <div style={{ color: 'var(--danger)' }}>✗ {info.error}</div>}
            {info && info.ok && <div data-testid="guide-body" dangerouslySetInnerHTML={{ __html: mdToHtml(info.text) }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

export { mdToHtml };
