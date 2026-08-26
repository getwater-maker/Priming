import React, { useEffect, useRef, useState } from 'react';

const api = window.api;

// 초 → "3분 20초" / "1시간 5분". 남은 시간 표시용(대략치라 초 단위까지는 안 쓴다).
function fmtLeft(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return s + '초';
  const m = Math.round(s / 60);
  if (m < 60) return m + '분';
  return Math.floor(m / 60) + '시간 ' + (m % 60) + '분';
}

/**
 * 🎬 리모션 화면 — TSV(`파일명<탭>문장`)를 열어 **그 파일명 그대로** mp3 를 만든다.
 *
 * 이 화면에는 자막·이미지·비디오·.vrew 가 없다. 영상은 리모션이 만들고 이 앱은 음성만 담당한다.
 * 목소리·배속·시드는 **채널(프리셋)** 이 정한다 — 헤더의 ⚙ 에서 바꾼다.
 * ⚠ 목소리·배속·시드·발음사전을 바꾸면 **전량 다시 만들어진다**(그 값들이 캐시 키다).
 */
export default function RemotionView({ presetName, presetRev, setStatus, logline }) {
  const [tsv, setTsv] = useState(null);        // { path, name, rows, errors }
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);      // { i, n }
  const [result, setResult] = useState(null);
  const [trim, setTrim] = useState(true);
  // 🔑 발음사전은 **채널에 저장된 것**을 쓴다. 여기서 고르게 하면 언젠가 한 번 빠지고,
  //   사전 없이 합성된 것은 캐시 키가 달라 나중에 물릴 때 그 TSV 전체가 재합성된다.
  const [dict, setDict] = useState(null);   // { path, name } | null
  // 🎧 미리듣기 — 몇 문장만 먼저 만들어 듣는다(전체를 15분 돌리기 전에 목소리·배속·사전 확인).
  const [picked, setPicked] = useState([]);      // 고른 파일명들(TSV 순서 유지)
  const [previews, setPreviews] = useState({});  // { 파일명: { path, dur } }
  const [playing, setPlaying] = useState('');    // 지금 재생 중인 파일명
  const [pvBusy, setPvBusy] = useState(false);
  const audioRef = useRef(null);
  const lastPickRef = useRef(-1);   // Shift 범위 선택의 기준점
  // 🔴 Shift 여부는 **click 에서 받아 두고 change 에서 쓴다.**
  //   checkbox 는 click → (checked 토글) → change 순서라 이 방법이 안전하다.
  //   ⛔ onClick 에서 preventDefault 를 하면 안 된다 — 제어 checkbox 의 기본 토글을 막으면
  //     React 가 다음 렌더에서 DOM 에 새 값을 쓰지 않고 넘어가, **한 박자 늦게 체크가 나타난다**
  //     (로이 2026-08-27: "클릭해도 체크가 안 되다가 다른 곳을 클릭하면 그때 체크된다").
  const shiftRef = useRef(false);
  const queueRef = useRef([]);      // 이어 듣기 대기열

  useEffect(() => {
    if (api && api.onRemotionProgress) api.onRemotionProgress((d) => setProg(d));
  }, []);

  // 채널이 바뀌거나 **채널 설정이 저장되면**(presetRev) 물려 있는 사전을 다시 읽는다.
  //   ⚠ presetRev 가 없으면, 채널 편집에서 사전을 지정해 저장해도 이름이 그대로라
  //     화면이 「물려 있지 않습니다」를 계속 띄운다(2026-08-26 실사고 — 저장은 정상이었다).
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const p = presetName ? await api.getPresetDetail(presetName) : null;
        if (dead) return;
        const dp = (p && p.dictPath) || '';
        setDict(dp ? { path: dp, name: dp.split(/[\\/]/).pop() } : null);
      } catch { if (!dead) setDict(null); }
    })();
    return () => { dead = true; };
  }, [presetName, presetRev]);

  // 채널에 물린 사전을 다시 읽는다. 열기 직전에도 부른다 — 그 사이 채널을 고쳤을 수 있다.
  async function refreshDict() {
    try {
      const p = presetName ? await api.getPresetDetail(presetName) : null;
      const dp = (p && p.dictPath) || '';
      setDict(dp ? { path: dp, name: dp.split(/[\\/]/).pop() } : null);
    } catch { setDict(null); }
  }

  // ── 재생 ──
  //   🔑 media:// 가 아니라 **read-audio(base64)** 를 쓴다 — 렌더러에서 media:// fetch 가 막히는
  //     문제를 이미 이 앱의 다른 미리듣기들이 이 방식으로 우회하고 있다(App.jsx 와 같은 경로).
  function ensureAudio() {
    if (!audioRef.current) {
      const a = new Audio();
      a.onended = () => { const q = queueRef.current; if (q.length) playOne(q.shift()); else setPlaying(''); };
      a.onerror = () => { queueRef.current = []; setPlaying(''); };
      audioRef.current = a;
    }
    return audioRef.current;
  }
  async function playOne(name) {
    const f = previews[name];
    if (!f) return;
    try {
      const url = await api.readAudio(f.path);
      if (!url) { setStatus && setStatus('음성 파일을 읽지 못했습니다 — ' + name); return; }
      const a = ensureAudio();
      a.src = url; setPlaying(name); a.play();
    } catch (e) { setStatus && setStatus('재생 실패: ' + e.message); }
  }
  function playSeq(names) {
    const list = names.filter((x) => previews[x]);
    if (!list.length) return;
    queueRef.current = list.slice(1);
    playOne(list[0]);
  }
  function stopPlay() {
    queueRef.current = [];
    if (audioRef.current) { try { audioRef.current.pause(); } catch {} }
    setPlaying('');
  }
  useEffect(() => () => { try { if (audioRef.current) audioRef.current.pause(); } catch {} }, []);

  // ── 고르기 ── Shift 클릭이면 마지막 클릭부터 범위로.
  function togglePick(i, shift) {
    const all = (tsv && tsv.rows) || [];
    const name = all[i] && all[i].name;
    if (!name) return;
    setPicked((prev) => {
      const set = new Set(prev);
      if (shift && lastPickRef.current >= 0) {
        const [a, b] = [Math.min(lastPickRef.current, i), Math.max(lastPickRef.current, i)];
        const add = !set.has(name);
        for (let k = a; k <= b; k++) { const nm = all[k] && all[k].name; if (!nm) continue; if (add) set.add(nm); else set.delete(nm); }
      } else if (set.has(name)) set.delete(name);
      else set.add(name);
      lastPickRef.current = i;
      return all.map((r) => r.name).filter((nm) => set.has(nm));   // TSV 순서 유지
    });
  }

  async function previewPicked() {
    if (!picked.length) return;
    stopPlay();
    setPvBusy(true); setProg({ i: 0, n: picked.length, preview: true });
    try {
      const r = await api.remotionPreviewTts({ presetName, names: picked, trim });
      const map = {};
      (r.files || []).forEach((f) => { map[f.name] = f; });
      setPreviews((prev) => Object.assign({}, prev, map));
      const order = (r.files || []).map((f) => f.name);
      if (order.length) { queueRef.current = order.slice(1); playOne(order[0]); }
      const fail = (r.failed || []).length;
      setStatus && setStatus(`🎧 미리듣기 ${order.length}개 준비` + (fail ? ` · 실패 ${fail}` : ''));
    } catch (e) {
      setStatus && setStatus('미리듣기 실패: ' + e.message);
    } finally { setPvBusy(false); setProg(null); }
  }

  // 📁 출력 폴더 — 작업이 끝날 때 탐색기를 **자동으로 열지 않는다**(큐를 돌리면 창이 쌓인다 — v0.2.99
  //   에서 롱폼이 이미 폐지한 것). 대신 필요할 때 이 버튼으로 연다.
  async function openOut() {
    try { await api.remotionOpenOut({ presetName }); }
    catch (e) { setStatus && setStatus('폴더 열기 실패: ' + e.message); }
  }

  async function openTsv() {
    try {
      await refreshDict();
      const r = await api.remotionOpenTsv({ presetName });
      if (r) { setTsv(r); setResult(null); setProg(null); stopPlay(); setPicked([]); setPreviews({}); lastPickRef.current = -1; }
    } catch (e) { setStatus && setStatus('TSV 열기 실패: ' + e.message); }
  }

  async function run() {
    if (!tsv || !tsv.rows.length) return;
    // ⚠ 사전 없이 돌리면 나중에 물릴 때 전량 재합성이다. 한 번 물어본다.
    if (!dict && !window.confirm(
      '발음사전이 물려 있지 않습니다.\n\n'
      + '이대로 만들면 나중에 사전을 지정할 때 이 TSV 전체가 다시 합성됩니다.\n'
      + '(채널 편집 → 📁 폴더 → 「발음사전」 에서 지정할 수 있습니다)\n\n'
      + '사전 없이 진행할까요?')) return;
    setBusy(true); setProg({ i: 0, n: tsv.rows.length }); setResult(null);
    try {
      const r = await api.remotionRunTts({ presetName, trim });
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
  const pickedSet = new Set(picked);
  const pvNames = rows.map((r) => r.name).filter((nm) => previews[nm]);

  return (
    <div style={{ padding: '10px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={openTsv} disabled={busy || pvBusy}>📄 TSV 열기</button>
        <button onClick={run} disabled={busy || pvBusy || !rows.length || errs.length > 0}>
          {busy ? '만드는 중…' : '🎤 mp3 만들기'}
        </button>
        <button onClick={previewPicked} disabled={busy || pvBusy || !picked.length}
          title="고른 문장만 먼저 만들어 들어봅니다. 여기서 만든 음성은 전체 만들기에서 그대로 재활용됩니다(다시 합성하지 않습니다).">
          {pvBusy ? '만드는 중…' : `🎧 미리듣기${picked.length ? ' (' + picked.length + ')' : ''}`}
        </button>
        {picked.length > 0 && !pvBusy && (
          <button className="ghost" onClick={() => { setPicked([]); lastPickRef.current = -1; }} disabled={busy}>선택 해제</button>
        )}
        {playing && <button className="ghost" onClick={stopPlay}>⏹ 정지</button>}
        <button className="ghost" onClick={openOut} disabled={busy}
          title="만들어진 mp3 가 있는 폴더를 엽니다">📁 출력 폴더</button>
        <label className="meta" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={trim} disabled={busy || pvBusy} onChange={(e) => setTrim(e.target.checked)} />
          앞뒤 무음 제거
        </label>
        <span style={{ flex: 1 }} />
        {tsv && <span className="meta">{tsv.name} · {rows.length}행 · {chars.toLocaleString()}자</span>}
      </div>

      <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 6,
        border: '1px solid ' + (dict ? 'var(--border,#ddd)' : '#e8a33d'),
        background: dict ? 'transparent' : '#fdf6e8' }}>
        <b>📖 발음사전</b>{' '}
        {dict
          ? <span title={dict.path}>{dict.name}</span>
          : <span style={{ color: '#b8791a' }}>물려 있지 않습니다 — 채널 편집 → 📁 폴더 → 「발음사전」 에서 지정하세요</span>}
      </div>

      <div className="meta" style={{ marginTop: 6 }}>
        목소리·배속·시드·발음사전은 <b>채널 설정</b>을 따릅니다(헤더 ⚙). 출력은 <b>MP3 출력 폴더 / {tsv ? tsv.name.replace(/\.(tsv|txt)$/i, '') : '<TSV 이름>'}</b> 입니다.
        <br />⚠ 이 넷 중 하나라도 바꾸면 <b>전량 다시 만들어집니다</b>. 처음에 정하고 그 뒤로 건드리지 마세요.
        <br />🎧 표에서 문장을 골라 <b>미리듣기</b>로 먼저 들어보세요(Shift 클릭 = 범위 선택 · 한 번에 12개까지).
        여기서 만든 음성은 전체 만들기에서 <b>그대로 재활용</b>되므로 헛수고가 아니고, 들은 소리가 결과물에 그대로 들어갑니다.
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
          <div className="meta" style={{ marginTop: 4 }}>
            {prog.preview ? '🎧 미리듣기 ' : ''}{prog.i} / {prog.n}
            {prog.rtf != null && (
              <span title="RTF = 생성시간 ÷ 음성길이 (낮을수록 빠름). 합성은 문장 길이와 거의 무관하게 문장당 2.4~2.7초가 걸리므로, 짧은 문장이 많을수록 RTF 는 나빠집니다 — 총 시간은 문장 수로 정해집니다.">
                {' · '}⏱ RTF {prog.rtf.toFixed(2)}
              </span>
            )}
            {prog.perSentenceSec > 0 && <>{' · '}문장당 {prog.perSentenceSec.toFixed(2)}초</>}
            {prog.perSentenceSec > 0 && prog.n > prog.i && (
              <>{' · '}남은 시간 약 {fmtLeft((prog.n - prog.i) * prog.perSentenceSec)}</>
            )}
          </div>
        </div>
      )}

      {pvNames.length > 0 && (
        <div style={{ marginTop: 10, padding: '6px 10px', border: '1px solid var(--border,#ddd)', borderRadius: 6,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b>🎧 미리듣기 {pvNames.length}개</b>
          <button className="ghost" onClick={() => playSeq(pvNames)} disabled={busy}>▶ 이어 듣기</button>
          {playing && <span className="meta">재생 중 — {playing}</span>}
          <span style={{ flex: 1 }} />
          <span className="meta">이 음성은 전체 만들기에서 그대로 재활용됩니다</span>
        </div>
      )}

      {result && !result.error && (
        <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--border,#ddd)', borderRadius: 6 }}>
          <b>완료</b> — 만듦 {result.made} · 건너뜀 {result.skipped} · 실패 {result.failed.length} / 전체 {result.total}
          {result.totalTrimmedSec > 0 && <> · 무음 {result.totalTrimmedSec.toFixed(1)}초 제거</>}
          {result.rtf != null && (
            <div className="meta" style={{ marginTop: 4 }}
              title="RTF = 생성시간 ÷ 음성길이 (낮을수록 빠름). 합성은 문장 길이와 거의 무관하게 문장당 2.4~2.7초가 걸리므로, 짧은 문장이 많을수록 RTF 는 나빠집니다 — 총 시간은 문장 수로 정해집니다.">
              ⏱ <b>RTF {result.rtf.toFixed(2)}</b> · 문장당 {result.perSentenceSec.toFixed(2)}초
              {result.stageSec && <> (합성 {result.stageSec.tts.toFixed(2)} · 트림 {result.stageSec.trim.toFixed(2)} · mp3 {result.stageSec.mp3.toFixed(2)})</>}
            </div>
          )}
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
              <th style={{ textAlign: 'center', padding: '6px 4px', width: 30 }} title="미리듣기로 들어볼 문장을 고릅니다 (Shift 클릭 = 범위)">🎧</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', width: 46 }}>#</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', width: 180 }}>파일명</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>문장</th>
              <th style={{ textAlign: 'center', padding: '6px 4px', width: 64 }}>듣기</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const isPicked = pickedSet.has(r.name);
                const pv = previews[r.name];
                const isPlaying = playing === r.name;
                return (
                <tr key={r.name} style={{ borderTop: '1px solid var(--border,#eee)',
                  background: isPlaying ? '#fdf1e0' : (isPicked ? '#f6f1ea' : 'transparent') }}>
                  <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                    <input type="checkbox" checked={isPicked} disabled={busy || pvBusy}
                      onClick={(e) => { shiftRef.current = e.shiftKey; }}
                      onChange={() => togglePick(i, shiftRef.current)} />
                  </td>
                  <td style={{ padding: '4px 8px', color: '#999' }}>{i + 1}</td>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{r.name}</td>
                  <td style={{ padding: '4px 8px' }}>{r.text}</td>
                  <td style={{ padding: '4px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {pv
                      ? <button className="ghost" style={{ padding: '0 6px' }} onClick={() => (isPlaying ? stopPlay() : playSeq([r.name]))}
                          title={pv.dur ? pv.dur.toFixed(2) + '초' : ''}>{isPlaying ? '⏹' : '▶'}</button>
                      : <span className="meta" style={{ opacity: 0.35 }}>—</span>}
                  </td>
                </tr>);
              })}
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
