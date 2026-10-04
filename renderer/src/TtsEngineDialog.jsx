// 🔊 음성 엔진 팝업 (v0.6.68 — 고정 크기 · 엔진별 상단 탭 · 목소리 카드)
//   한 탭 = 한 엔진이 화면 전체를 쓴다: 「이 엔진으로 만들기」 · 키 · 모델 · 말투 · 목소리 카드(검색·성별·언어 거르기 · 🔈 미리듣기).
//   목소리 = 내장(Gemini 30 · MAI 97) + API(Gemini 확장 라이브러리 · 타입캐스트 · ElevenLabs) + OmniVoice 서버 공용 목소리.
//   🔑 저장은 main(tts-engines-save) 한 곳 · 키 원문은 받지 않는다(끝 4자리만).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from './lib/ipc.js';

const media = (p, version = '') => 'media://' + encodeURIComponent(p) + (version ? `?v=${encodeURIComponent(version)}` : '');
const G_ICON = { male: '♂', female: '♀', neutral: '⚲' };
const BLUE = '#2563eb';

export default function TtsEngineDialog({ onClose, onSaved }) {
  const [data, setData] = useState(null);          // { active, engines, keys }
  const [draft, setDraft] = useState(null);        // { active, cfg:{id:{…}}, keys:{id:{key|clear}} }
  const [voices, setVoices] = useState({});        // id → [카드]
  const [tab, setTab] = useState('omnivoice');
  const [q, setQ] = useState('');
  const [fg, setFg] = useState('');                // 성별 거르기
  const [fl, setFl] = useState({});                // 엔진별 언어 거르기
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [omniUsed, setOmniUsed] = useState({});
  const audioRef = useRef(null);
  const triedRef = useRef({});                     // 자동 불러오기는 탭마다 한 번

  async function load() {
    const r = await api.ttsEnginesGet();
    if (!r) { setMsg('설정을 읽지 못했습니다'); return null; }
    setData(r);
    return r;
  }
  useEffect(() => {
    (async () => {
      const r = await load(); if (!r) return;
      const cfg = {}; const vs = {};
      for (const e of r.engines) { cfg[e.id] = { ...(e.cfg || {}) }; if (e.voices) vs[e.id] = e.voices; }
      setDraft({ active: r.active, cfg, keys: {} });
      setVoices(vs);
      setTab(r.active);
    })();
    return () => { try { audioRef.current && audioRef.current.pause(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eng = data && data.engines.find((e) => e.id === tab);
  const c = (draft && draft.cfg[tab]) || {};
  const k = (data && data.keys[tab]) || {};
  const kd = (draft && draft.keys[tab]) || {};
  const setCfg = (patch) => setDraft((d) => ({ ...d, cfg: { ...d.cfg, [tab]: { ...(d.cfg[tab] || {}), ...patch } } }));
  const setKey = (patch) => setDraft((d) => ({ ...d, keys: { ...d.keys, [tab]: patch } }));
  const hasKey = (id) => {
    const kk = (data && data.keys[id]) || {}; const dd = (draft && draft.keys[id]) || {};
    return (kk.has && !dd.clear) || !!String(dd.key || '').trim();
  };

  // 탭을 열면 목록을 자동으로(OmniVoice = 서버 · 타입캐스트·ElevenLabs = 키가 있고 아직 없을 때)
  useEffect(() => {
    if (!data || !draft || triedRef.current[tab]) return;
    triedRef.current[tab] = true;
    setQ(''); setFg('');
    if (tab === 'omnivoice') loadOmni();
    else if ((tab === 'typecast' || tab === 'elevenlabs') && hasKey(tab) && !(voices[tab] || []).length) loadVoices(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, data, draft]);

  async function loadOmni() {
    setBusy('voices'); setMsg('');
    const r = await api.ttsOmniVoices();
    setBusy('');
    if (r && r.used) setOmniUsed(r.used);
    if (!r || !r.ok) { setMsg('❌ ' + ((r && r.error) || 'OmniVoice 목록 실패')); return; }
    setVoices((v) => ({ ...v, omnivoice: r.voices }));
  }
  async function loadVoices(id) {
    if (id === 'omnivoice') return loadOmni();
    setBusy('voices'); setMsg('');
    const r = await api.ttsEngineVoices({ id, key: (draft.keys[id] && draft.keys[id].key) || '', model: draft.cfg[id] && draft.cfg[id].model });
    setBusy('');
    if (r && r.ok) { setVoices((v) => ({ ...v, [id]: r.voices })); setMsg(`✅ 목소리 ${r.voices.length}개를 불러왔습니다`); }
    else setMsg('❌ ' + ((r && r.error) || '불러오기 실패'));
  }

  // 저장 — withActive=false 면 「만들 엔진」은 저장된 값 그대로(미리듣기 전에 키·값만 저장)
  async function save(close, withActive = true) {
    if (!draft) return false;
    const sel = data.engines.find((e) => e.id === draft.active);
    if (withActive && sel && sel.paid) {
      if (!hasKey(sel.id)) { setTab(sel.id); setMsg(`⚠ ${sel.label} 의 API 키를 넣어야 이 엔진으로 만들 수 있습니다`); return false; }
      if (!String((draft.cfg[sel.id] || {}).voice || '').trim()) { setTab(sel.id); setMsg(`⚠ ${sel.label} 의 목소리 카드를 하나 고르세요`); return false; }
    }
    const r = await api.ttsEnginesSave({ active: withActive ? draft.active : data.active, cfg: draft.cfg, keys: draft.keys });
    if (!r || !r.ok) { setMsg('❌ 저장 실패: ' + ((r && r.error) || '')); return false; }
    if (close) { onSaved && onSaved(sel); onClose(); return true; }
    const fresh = await load();
    if (fresh) setDraft((d) => ({ ...d, keys: {} }));
    return true;
  }

  // 🔈 미리듣기 — 제공 샘플(preview_url · 이 PC 의 참조음성 파일)이 있으면 그것, 없으면 그 목소리로 한 문장 합성(유료는 소액 과금)
  async function preview(v) {
    try { audioRef.current && audioRef.current.pause(); } catch {}
    setBusy('play:' + v.id); setMsg('');
    try {
      let src = v.preview || '';
      if (!src && tab === 'omnivoice') { try { src = (await api.readAudio(v.id)) || ''; } catch {} }
      if (!src) {
        if (Object.keys(draft.keys).length && !(await save(false, false))) { setBusy(''); return; }
        const r = await api.ttsEngineTest({ id: tab, voice: v.id });
        if (!r || !r.ok) { setMsg('❌ ' + ((r && r.error) || '미리듣기 실패')); setBusy(''); return; }
        src = media(r.path, String(Date.now()));
      }
      const a = new Audio(src); audioRef.current = a;
      a.onended = () => setBusy((b) => (b === 'play:' + v.id ? '' : b));
      await a.play();
    } catch (e) { setMsg('❌ 재생 실패: ' + e.message); setBusy(''); }
  }

  const list = voices[tab] || [];
  const langs = useMemo(() => [...new Set(list.map((v) => v.lang).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')), [list]);
  const lang = fl[tab] != null ? fl[tab] : (tab === 'mai' && langs.includes('한국어') ? '한국어' : '');
  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return list.filter((v) => (!fg || v.gender === fg) && (!lang || v.lang === lang)
      && (!qq || [v.id, v.name, v.desc, v.lang].join(' ').toLowerCase().includes(qq)));
  }, [list, q, fg, lang]);
  const selVoice = list.find((v) => v.id === c.voice);
  const maiStyles = tab === 'mai' && selVoice ? ['', ...selVoice.styles] : null;

  if (!data || !draft) {
    return (<div className="modal-bg show" data-testid="tts-engine-dlg"><div className="modal-card" style={{ width: 300 }}>불러오는 중…</div></div>);
  }
  const isOn = draft.active === tab;
  return (
    <div className="modal-bg show" data-testid="tts-engine-dlg">
      {/* 🔒 크기 고정 — 탭·목록 길이와 상관없이 같은 크기(안쪽만 스크롤) */}
      <div className="modal-card" data-testid="tts-eng-card" style={{ width: 'min(1000px, 94vw)', maxWidth: 'none', height: 'min(720px, 90vh)', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px 0' }}>
          <h3 style={{ margin: '0 0 8px' }}>🔊 음성 엔진 — TTS 를 무엇으로 만들까</h3>
          <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)' }}>
            {data.engines.map((e) => {
              const on = draft.active === e.id; const cur = tab === e.id;
              return (
                <button key={e.id} role="tab" data-testid={'tts-tab-' + e.id} className={cur ? '' : 'ghost'} onClick={() => { setTab(e.id); setMsg(''); }}
                  style={{ borderRadius: '8px 8px 0 0', padding: '7px 14px', marginBottom: -1, borderBottom: cur ? '2px solid ' + BLUE : '1px solid transparent', fontWeight: cur ? 700 : 500 }}>
                  {on ? '✅ ' : ''}{e.label.replace(/ TTS$/, '')}{e.paid ? <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.8 }}>{hasKey(e.id) ? '🔑' : '·'}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div data-testid={'tts-eng-' + tab} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 16px' }}>
          <div className="frow" style={{ alignItems: 'center', gap: 10, margin: '0 0 6px' }}>
            <button data-testid="tts-use" className={isOn ? '' : 'ghost'} style={{ flex: '0 0 auto', fontWeight: 700, ...(isOn ? { background: BLUE, color: '#fff' } : {}) }}
              onClick={() => { setDraft((d) => ({ ...d, active: tab })); setMsg(''); }}>{isOn ? '✅ 이 엔진으로 만듭니다' : '이 엔진으로 만들기'}</button>
            <span className="meta" style={{ flex: 1 }}>{eng.sub}{eng.paid ? <> · <b style={{ color: hasKey(tab) ? '#16a34a' : '#b45309' }}>{kd.clear ? '🔑 지울 예정' : k.has ? `🔑 키 있음(…${k.tail})` : '🔑 키 없음'}</b></> : null}</span>
          </div>
          {eng.note && <div className="meta" style={{ marginBottom: 6 }}>{eng.note}</div>}

          {/* 설정 줄 — 키 · 지역 · 모델 · 말투/감정 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center', marginBottom: 8 }}>
            {eng.paid && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{eng.keyLabel}
              <input type="password" autoComplete="off" style={{ width: 220 }} placeholder={k.has ? `저장됨(…${k.tail}) — 바꿀 때만` : 'API 키 붙여넣기'} value={kd.key || ''} onChange={(ev) => setKey({ key: ev.target.value })} />
              {k.has && <button className="ghost" title="저장된 키를 지웁니다(저장하면 반영)" onClick={() => setKey({ clear: true })}>지우기</button>}
              {eng.keyUrl && <button className="ghost" title={'키 발급 페이지 — ' + eng.keyUrl} onClick={() => api.ttsEngineOpenKey(tab)}>발급 ↗</button>}
            </span>)}
            {eng.regions && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>지역
              <select value={c.region || eng.defaultRegion} onChange={(ev) => setCfg({ region: ev.target.value })}>{eng.regions.map((r) => <option key={r} value={r}>{r}</option>)}</select></span>)}
            {eng.models && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>모델
              <select value={c.model || eng.models[0].id} onChange={(ev) => setCfg({ model: ev.target.value })}>{eng.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></span>)}
            {maiStyles && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>말투
              <select value={maiStyles.includes(c.style || '') ? (c.style || '') : ''} onChange={(ev) => setCfg({ style: ev.target.value })}>{maiStyles.map((x) => <option key={x} value={x}>{x || '기본'}</option>)}</select>
              <span className="meta">({selVoice.styles.length}가지 — 이 목소리가 되는 것만)</span></span>)}
            {eng.hasStyle && (<span style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, minWidth: 260 }}>말투 지시
              <input style={{ flex: 1 }} placeholder="예: 차분하고 따뜻한 다큐멘터리 내레이션 (3.8 모델만)" value={c.style || ''} onChange={(ev) => setCfg({ style: ev.target.value })} /></span>)}
            {eng.emotions && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>감정
              <select value={c.emotion || 'normal'} onChange={(ev) => setCfg({ emotion: ev.target.value })}>{eng.emotions.map((x) => <option key={x} value={x}>{x}</option>)}</select></span>)}
            {tab === 'elevenlabs' && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>안정성
              <input type="number" min="0" max="1" step="0.05" style={{ width: 64 }} placeholder="0.5" value={c.stability != null ? c.stability : ''} onChange={(ev) => setCfg({ stability: ev.target.value })} />
              유사도 <input type="number" min="0" max="1" step="0.05" style={{ width: 64 }} placeholder="0.75" value={c.similarity != null ? c.similarity : ''} onChange={(ev) => setCfg({ similarity: ev.target.value })} /></span>)}
          </div>

          {/* 목소리 거르기 줄 */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <b>목소리</b>
            <span className="meta">{shown.length}/{list.length}개{c.voice ? ` · 고른 것: ${selVoice ? selVoice.name : c.voice}` : (tab === 'omnivoice' ? ' · 채널 목소리 그대로' : ' · ⚠ 아직 안 고름')}</span>
            <span style={{ flex: 1 }} />
            <input data-testid="tts-voice-q" placeholder="🔍 이름·특징 검색" style={{ width: 180 }} value={q} onChange={(ev) => setQ(ev.target.value)} />
            {tab !== 'omnivoice' && (<select value={fg} onChange={(ev) => setFg(ev.target.value)}><option value="">성별 전체</option><option value="male">♂ 남성</option><option value="female">♀ 여성</option></select>)}
            {langs.length > 1 && (<select data-testid="tts-voice-lang" value={lang} onChange={(ev) => setFl((x) => ({ ...x, [tab]: ev.target.value }))}><option value="">{tab === 'typecast' ? '나이 전체' : '언어 전체'}</option>{langs.map((l) => <option key={l} value={l}>{l}</option>)}</select>)}
            {(eng.listVoices || tab === 'omnivoice') && (
              <button className="ghost" disabled={!!busy || (eng.paid && !hasKey(tab))} onClick={() => loadVoices(tab)}
                title={tab === 'gemini' ? '확장 라이브러리(수백 개 · 3.8 모델용)를 API 로 불러옵니다' : '목록을 다시 불러옵니다'}>
                {busy === 'voices' ? '⏳ 불러오는 중' : tab === 'gemini' ? '⬇ 확장 라이브러리 불러오기' : '↻ 다시 불러오기'}</button>)}
          </div>

          {/* 목소리 카드 — 이 칸만 스크롤 */}
          <div data-testid="tts-voice-grid" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8, alignContent: 'start', paddingRight: 4 }}>
            {tab === 'omnivoice' && (
              <VoiceCard v={{ id: '', name: '📺 채널 목소리 그대로', desc: '채널마다 정한 참조음성(기본)' }} sel={!c.voice} onPick={() => setCfg({ voice: '' })} />
            )}
            {shown.map((v) => (
              <VoiceCard key={v.id} v={v} sel={c.voice === v.id} busy={busy === 'play:' + v.id}
                badge={tab === 'omnivoice' && (omniUsed[v.name] || []).length ? '채널: ' + omniUsed[v.name].join(', ') : ''}
                onPick={() => setCfg({ voice: v.id })} onPlay={() => preview(v)} />
            ))}
            {!list.length && (
              <div className="meta" style={{ gridColumn: '1 / -1', padding: 20, textAlign: 'center' }}>
                {busy === 'voices' ? '⏳ 목소리 목록을 불러오는 중…'
                  : eng.paid && !hasKey(tab) ? '🔑 API 키를 넣으면 이 계정에서 쓸 수 있는 목소리를 모두 불러옵니다.'
                  : '목소리가 없습니다 — 「↻ 다시 불러오기」를 눌러 보세요.'}
              </div>
            )}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="meta" data-testid="tts-eng-msg" style={{ flex: 1, fontWeight: msg ? 600 : 400 }}>
            {msg || '💡 유료 엔진은 문장마다 요금이 듭니다(🔈 미리듣기도 샘플이 없으면 한 문장 합성). 캐시는 엔진·모델·목소리별로 따로라 같은 문장은 다시 내지 않습니다.'}
          </span>
          <span className="meta">만들 엔진: <b>{(data.engines.find((e) => e.id === draft.active) || {}).label}</b></span>
          <button data-testid="tts-eng-save" onClick={() => save(true)}>저장</button>
          <button className="ghost" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

function VoiceCard({ v, sel, busy, badge, onPick, onPlay }) {
  return (
    <div role="button" tabIndex={0} data-testid="tts-voice-card" data-voice={v.id} onClick={onPick} onKeyDown={(e) => { if (e.key === 'Enter') onPick(); }}
      style={{ border: '1.5px solid ' + (sel ? BLUE : 'var(--line)'), background: sel ? 'rgba(37,99,235,0.08)' : 'var(--bg2, transparent)', borderRadius: 8, padding: '8px 9px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3, minHeight: 88 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.id}>{sel ? '✔ ' : ''}{v.name}</span>
        {G_ICON[v.gender] && <span title={v.gender}>{G_ICON[v.gender]}</span>}
        {onPlay && <button className="ghost" style={{ padding: '1px 6px', flex: '0 0 auto' }} title="미리듣기" onClick={(e) => { e.stopPropagation(); onPlay(); }}>{busy ? '⏳' : '🔈'}</button>}
      </div>
      {v.lang && <div className="meta" style={{ fontSize: 11 }}>{v.lang}</div>}
      {v.desc && <div className="meta" style={{ fontSize: 11, lineHeight: '15px', maxHeight: 30, flexShrink: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }} title={v.desc}>{v.desc}</div>}
      {badge && <div style={{ fontSize: 10, color: BLUE, flexShrink: 0, marginTop: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={badge}>{badge}</div>}
    </div>
  );
}
