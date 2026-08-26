import React, { useEffect, useState } from 'react';

const api = window.api;

/**
 * 🎬 리모션 화면 — TSV(`파일명<탭>문장`)를 열어 **그 파일명 그대로** mp3 를 만든다.
 *
 * 이 화면에는 자막·이미지·비디오·.vrew 가 없다. 영상은 리모션이 만들고 이 앱은 음성만 담당한다.
 * 목소리·배속·시드는 **채널(프리셋)** 이 정한다 — 헤더의 ⚙ 에서 바꾼다.
 * ⚠ 목소리·배속·시드·발음사전을 바꾸면 **전량 다시 만들어진다**(그 값들이 캐시 키다).
 */
export default function RemotionView({ presetName, setStatus, logline }) {
  const [tsv, setTsv] = useState(null);        // { path, name, rows, errors }
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);      // { i, n }
  const [result, setResult] = useState(null);
  const [trim, setTrim] = useState(true);
  const [dictPath, setDictPath] = useState('');

  useEffect(() => {
    if (api && api.onRemotionProgress) api.onRemotionProgress((d) => setProg(d));
  }, []);

  async function openTsv() {
    try {
      const r = await api.remotionOpenTsv({ presetName });
      if (r) { setTsv(r); setResult(null); setProg(null); }
    } catch (e) { setStatus && setStatus('TSV 열기 실패: ' + e.message); }
  }

  async function run() {
    if (!tsv || !tsv.rows.length) return;
    setBusy(true); setProg({ i: 0, n: tsv.rows.length }); setResult(null);
    try {
      const r = await api.remotionRunTts({ presetName, trim, dictPath: dictPath || undefined });
      setResult(r);
      setStatus && setStatus(`리모션 mp3 — 만듦 ${r.made} · 실패 ${r.failed.length}`);
    } catch (e) {
      setStatus && setStatus('실패: ' + e.message);
      setResult({ error: e.message });
    } finally { setBusy(false); setProg(null); }
  }

  const rows = (tsv && tsv.rows) || [];
  const errs = (tsv && tsv.errors) || [];
  const chars = rows.reduce((a, r) => a + r.text.replace(/\s/g, '').length, 0);

  return (
    <div style={{ padding: '10px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={openTsv} disabled={busy}>📄 TSV 열기</button>
        <button onClick={run} disabled={busy || !rows.length || errs.length > 0}>
          {busy ? '만드는 중…' : '🎤 mp3 만들기'}
        </button>
        <label className="meta" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={trim} disabled={busy} onChange={(e) => setTrim(e.target.checked)} />
          앞뒤 무음 제거
        </label>
        <span style={{ flex: 1 }} />
        {tsv && <span className="meta">{tsv.name} · {rows.length}행 · {chars.toLocaleString()}자</span>}
      </div>

      <div className="meta" style={{ marginTop: 6 }}>
        목소리·배속·시드는 <b>채널 설정</b>을 따릅니다(헤더 ⚙). 출력은 <b>MP3 출력 폴더 / {tsv ? tsv.name.replace(/\.(tsv|txt)$/i, '') : '&lt;TSV 이름&gt;'}</b> 입니다.
        <br />⚠ 목소리·배속·시드를 바꾸면 <b>전량 다시 만들어집니다</b>. 처음에 정하고 그 뒤로 건드리지 마세요.
      </div>

      {errs.length > 0 && (
        <div style={{ marginTop: 10, padding: 10, border: '1px solid #c0392b', borderRadius: 6, background: '#fdf0ee' }}>
          <b style={{ color: '#c0392b' }}>TSV 오류 {errs.length}건 — 하나라도 있으면 만들지 않습니다</b>
          <ul style={{ margin: '6px 0 0 18px' }}>
            {errs.slice(0, 12).map((e, i) => <li key={i}>{e.line}행: {e.message}</li>)}
          </ul>
        </div>
      )}

      {prog && (
        <div style={{ marginTop: 10 }}>
          <div style={{ height: 8, background: '#eee', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: (prog.n ? (prog.i / prog.n * 100) : 0) + '%', background: 'var(--accent,#c9884a)' }} />
          </div>
          <div className="meta" style={{ marginTop: 4 }}>{prog.i} / {prog.n}</div>
        </div>
      )}

      {result && !result.error && (
        <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--border,#ddd)', borderRadius: 6 }}>
          <b>완료</b> — 만듦 {result.made} · 건너뜀 {result.skipped} · 실패 {result.failed.length} / 전체 {result.total}
          {result.totalTrimmedSec > 0 && <> · 무음 {result.totalTrimmedSec.toFixed(1)}초 제거</>}
          <div className="meta" style={{ marginTop: 4 }}>{result.outDir}</div>
          {result.failed.length > 0 && (
            <ul style={{ margin: '6px 0 0 18px', color: '#c0392b' }}>
              {result.failed.slice(0, 10).map((f, i) => <li key={i}>{f.name} — {f.reason}</li>)}
            </ul>
          )}
        </div>
      )}
      {result && result.error && (
        <div style={{ marginTop: 10, padding: 10, border: '1px solid #c0392b', borderRadius: 6, color: '#c0392b' }}>
          {result.error}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ marginTop: 12, maxHeight: '52vh', overflowY: 'auto', border: '1px solid var(--border,#ddd)', borderRadius: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ position: 'sticky', top: 0, background: 'var(--card,#fff)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', width: 46 }}>#</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', width: 180 }}>파일명</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>문장</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.name} style={{ borderTop: '1px solid var(--border,#eee)' }}>
                  <td style={{ padding: '4px 8px', color: '#999' }}>{i + 1}</td>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{r.name}</td>
                  <td style={{ padding: '4px 8px' }}>{r.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!tsv && (
        <div className="meta" style={{ marginTop: 24, textAlign: 'center', opacity: 0.7 }}>
          「📄 TSV 열기」로 시작하세요.<br />
          형식: 한 줄에 <code>파일명&lt;탭&gt;문장</code> — 예 <code>R-01-1.mp3⇥안녕하세요.</code>
        </div>
      )}
    </div>
  );
}
