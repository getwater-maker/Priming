// 🔊 음성 엔진 팝업 (v0.6.69 — **채널마다 목소리** · 목소리 얼굴 · 저장되는 샘플 · 요금)
//   왼쪽 = 채널 목록(얼굴·목소리) · 오른쪽 = 엔진 탭(고정 크기) → 목소리 카드를 누르면 **그 채널의 목소리**가 된다.
//   목소리 = 내장(Gemini 30 · MAI 97) + API(Gemini 확장 · 타입캐스트 · ElevenLabs) + OmniVoice 서버 공용 목소리.
//   🔈 샘플 = 회사 샘플(무료) → 이 PC 참조음성 파일(OmniVoice) → 한 번 만들어 **저장**(다음부터 무료).
//   🔑 저장은 main(tts-engines-save) 한 곳 — 채널 = preset.voiceEngine(+OmniVoice 면 참조음성) · 키 원문은 받지 않는다.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from './lib/ipc.js';

const media = (p, version = '') => 'media://' + encodeURIComponent(p) + (version ? `?v=${encodeURIComponent(version)}` : '');
const G_ICON = { male: '♂', female: '♀', neutral: '⚲' };
const BLUE = '#2563eb';
const SAMPLE_CHARS = 45;   // 샘플 문장 길이(요금 추정용 — main SAMPLE_TEXT 한국어와 같은 분량)
const usdTxt = (u) => (u == null ? '?' : u === 0 ? '무료' : u < 0.01 ? `$${u.toFixed(4)}` : `$${u.toFixed(2)}`);

// 요금 추정 — main tts-engines.estimateUsd 와 같은 식(단가표는 main 이 내려준다)
function estUsd(engId, unit, chars, koCps) {
  if (engId === 'omnivoice') return 0;
  if (!unit) return null;
  const n = Math.max(0, Number(chars) || 0);
  return unit.kind === 'char' ? n * unit.usd : (n / (koCps || 7)) * unit.usd;
}

export default function TtsEngineDialog({ initialChannel, scriptChars, onClose, onSaved, confirm }) {
  const [data, setData] = useState(null);          // { engines, keys, channels, region, krw, koCps }
  const [drafts, setDrafts] = useState({});        // 채널 → { id, ref, cfg:{엔진:{model,voice,style,…}} }
  const [dirty, setDirty] = useState({});          // 바뀐 채널
  const [chan, setChan] = useState('');
  const [tab, setTab] = useState('omnivoice');
  const [keys, setKeys] = useState({});            // 엔진 → { key | clear }
  const [region, setRegion] = useState('eastasia');
  const [krwSaved, setKrwSaved] = useState(1400);   // 환율을 못 받았을 때만 쓰는 지난 값
  const [fx, setFx] = useState(null);              // 💱 { rate, asOf, source, stale } — 시장 환율(main 이 공개 API 에서)
  const [cardFee, setCardFee] = useState(1.3);     // 💳 카드 해외결제 수수료(%)
  const [chLogos, setChLogos] = useState({});      // 🏷 채널 로고 { 채널: {path, v} } — 채널편집 로고와 같은 값
  const [voices, setVoices] = useState({});
  const [faces, setFaces] = useState({});          // 엔진 → { 목소리: {path, v} }
  const [samples, setSamples] = useState({});      // 엔진 → { 'model|voice|style': {file, sec} }
  const [q, setQ] = useState('');
  const [fg, setFg] = useState('');
  const [fl, setFl] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [omniUsed, setOmniUsed] = useState({});
  const audioRef = useRef(null);
  const triedRef = useRef({});
  const stopRef = useRef(false);
  // 💳 카드 청구 예상 환율 = 시장 환율 × (1 + 수수료%) — 환율을 못 받으면 지난 값
  const krw = fx && fx.rate ? fx.rate * (1 + (Number(cardFee) || 0) / 100) : krwSaved;

  useEffect(() => {
    (async () => {
      const r = await api.ttsEnginesGet();
      if (!r) { setMsg('설정을 읽지 못했습니다'); return; }
      setData(r); setRegion(r.region); setKrwSaved(r.krw); setCardFee(r.cardFee != null ? r.cardFee : 1.3); { const lg = {}; for (const c of r.channels) if (c.logo) lg[c.name] = c.logo; setChLogos(lg); }
      if (r.fx && r.fx.rate) setFx(r.fx);
      api.fxUsdKrw({}).then((f) => { if (f && f.ok) setFx(f); }).catch(() => {});
      const vs = {}, fs = {}, ss = {};
      for (const e of r.engines) { if (e.voices) vs[e.id] = e.voices; fs[e.id] = e.faces || {}; ss[e.id] = e.samples || {}; }
      setVoices(vs); setFaces(fs); setSamples(ss);
      const d = {};
      for (const c of r.channels) d[c.name] = { id: c.voiceEngine.id, ref: c.ref, cfg: { [c.voiceEngine.id]: { ...c.voiceEngine } } };
      setDrafts(d);
      const first = (r.channels.find((c) => c.name === initialChannel) || r.channels[0] || {}).name || '';
      setChan(first);
      setTab((d[first] && d[first].id) || 'omnivoice');
    })();
    return () => { stopRef.current = true; try { audioRef.current && audioRef.current.pause(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eng = data && data.engines.find((e) => e.id === tab);
  const dr = drafts[chan] || { id: 'omnivoice', ref: '', cfg: {} };
  const c = dr.cfg[tab] || {};
  const model = eng && eng.paid ? (c.model && eng.models.some((m) => m.id === c.model) ? c.model : eng.models[0].id) : '';
  const k = (data && data.keys[tab]) || {};
  const kd = keys[tab] || {};
  const hasKey = (id) => { const kk = (data && data.keys[id]) || {}; const dd = keys[id] || {}; return (kk.has && !dd.clear) || !!String(dd.key || '').trim(); };
  const patchDraft = (fn) => { setDrafts((all) => ({ ...all, [chan]: fn(all[chan] || { id: 'omnivoice', ref: '', cfg: {} }) })); setDirty((x) => ({ ...x, [chan]: true })); };
  const setCfg = (patch) => patchDraft((d) => ({ ...d, cfg: { ...d.cfg, [tab]: { ...(d.cfg[tab] || {}), ...patch } } }));
  const pickVoice = (v) => patchDraft((d) => (tab === 'omnivoice'
    ? { ...d, id: 'omnivoice', ref: v.id }
    : { ...d, id: tab, cfg: { ...d.cfg, [tab]: { ...(d.cfg[tab] || {}), model, voice: v.id } } }));
  const isSel = (v) => dr.id === tab && (tab === 'omnivoice' ? dr.ref === v.id : (c.voice || '') === v.id);

  // 탭을 열면 목록을 자동으로(OmniVoice = 서버 · 타입캐스트·ElevenLabs = 키가 있고 아직 없을 때)
  useEffect(() => {
    if (!data || triedRef.current[tab]) return;
    triedRef.current[tab] = true;
    if (tab === 'omnivoice') loadVoices('omnivoice');
    else if ((tab === 'typecast' || tab === 'elevenlabs') && hasKey(tab) && !(voices[tab] || []).length) loadVoices(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, data]);

  async function loadVoices(id) {
    setBusy('voices'); setMsg('');
    if (id === 'omnivoice') {
      const r = await api.ttsOmniVoices();
      setBusy('');
      if (r && r.used) setOmniUsed(r.used);
      if (!r || !r.ok) { setMsg('❌ ' + ((r && r.error) || 'OmniVoice 목록 실패')); return; }
      setVoices((v) => ({ ...v, omnivoice: r.voices })); return;
    }
    const r = await api.ttsEngineVoices({ id, key: (keys[id] && keys[id].key) || '', model: (dr.cfg[id] || {}).model });
    setBusy('');
    if (r && r.ok) { setVoices((v) => ({ ...v, [id]: r.voices })); setMsg(`✅ 목소리 ${r.voices.length}개를 불러왔습니다`); }
    else setMsg('❌ ' + ((r && r.error) || '불러오기 실패'));
  }

  // 키만 먼저 저장(샘플·AI 얼굴 전에 — 방금 넣은 키를 main 이 쓰게)
  async function saveKeysIfAny() {
    if (!Object.keys(keys).length) return true;
    const r = await api.ttsEnginesSave({ region, krw, cardFee, keys, channels: [] });
    if (!r || !r.ok) { setMsg('❌ 키 저장 실패'); return false; }
    const fresh = await api.ttsEnginesGet();
    if (fresh) setData((d) => ({ ...d, keys: fresh.keys }));
    setKeys({});
    return true;
  }

  async function save() {
    const bad = Object.entries(drafts).find(([n, d]) => dirty[n] && d.id !== 'omnivoice' && (!hasKey(d.id) || !String((d.cfg[d.id] || {}).voice || '').trim()));
    if (bad) {
      const e = data.engines.find((x) => x.id === bad[1].id);
      setChan(bad[0]); setTab(bad[1].id);
      setMsg(!hasKey(bad[1].id) ? `⚠ 「${bad[0]}」 — ${e.label} 의 API 키를 넣어야 이 목소리로 만들 수 있습니다` : `⚠ 「${bad[0]}」 — 목소리 카드를 하나 고르세요`);
      return;
    }
    const channels = Object.entries(drafts).filter(([n]) => dirty[n]).map(([name, d]) => {
      const e = data.engines.find((x) => x.id === d.id);
      const cc = d.cfg[d.id] || {};
      const ve = d.id === 'omnivoice' ? { id: 'omnivoice' } : { id: d.id, ...cc, model: cc.model && e.models.some((m) => m.id === cc.model) ? cc.model : e.models[0].id };
      return { name, voiceEngine: ve, ref: d.ref };
    });
    const r = await api.ttsEnginesSave({ region, krw, cardFee, keys, channels });
    if (!r || !r.ok) { setMsg('❌ 저장 실패: ' + ((r && r.error) || '')); return; }
    onSaved && onSaved(channels.length); onClose();
  }

  // 🔈 샘플 — 회사 샘플(무료) → 이 PC 참조음성 파일 → 저장된 샘플 → 새로 만들어 저장(Shift = 다시 만들기)
  async function preview(v, force) {
    try { audioRef.current && audioRef.current.pause(); } catch {}
    setBusy('play:' + v.id); setMsg('');
    try {
      let src = force ? '' : (v.preview || '');
      if (!src && !force && tab === 'omnivoice') { try { src = (await api.readAudio(v.id)) || ''; } catch {} }
      if (!src) {
        if (!(await saveKeysIfAny())) { setBusy(''); return; }
        const st = tab === 'typecast' ? (c.emotion || '') : (c.style || '');
        const r = await api.ttsEngineTest({ id: tab, voice: v.id, model, style: tab === 'typecast' ? '' : c.style, emotion: tab === 'typecast' ? c.emotion : '', stability: c.stability, similarity: c.similarity, channel: chan, force: !!force });
        if (!r || !r.ok) { setMsg('❌ ' + ((r && r.error) || '샘플 실패')); setBusy(''); return; }
        if (!r.cached) {
          setSamples((s) => ({ ...s, [tab]: { ...(s[tab] || {}), [[model, v.id, st].join('|')]: { sec: r.sec } } }));
          if (r.usd) setMsg(`🔈 샘플을 만들어 저장했습니다(약 ${usdTxt(r.usd)}) — 다음부터는 무료로 들립니다`);
        }
        src = media(r.path, String(r.sec));
      }
      const a = new Audio(src); audioRef.current = a;
      a.onended = () => setBusy((b) => (b === 'play:' + v.id ? '' : b));
      await a.play();
    } catch (e) { setMsg('❌ 재생 실패: ' + e.message); setBusy(''); }
  }
  const sampleKeyOf = (v) => [model, v.id, tab === 'typecast' ? (c.emotion || '') : (c.style || '')].join('|');
  const hasSample = (v) => !!v.preview || !!(samples[tab] || {})[sampleKeyOf(v)];

  // 📦 보이는 목소리 샘플 한꺼번에 만들기(이미 있는 것은 건너뜀 · 중간에 멈춤 가능)
  async function makeAllSamples(list) {
    const todo = list.filter((v) => !hasSample(v));
    if (!todo.length) { setMsg('보이는 목소리는 샘플이 모두 있습니다'); return; }
    const each = estUsd(tab, eng.unit && eng.unit[model], SAMPLE_CHARS, data.koCps) || 0;
    const ok = await (confirm || window.confirm)(`보이는 목소리 ${todo.length}개의 샘플을 만듭니다.\n예상 요금: 약 ${usdTxt(each * todo.length)} (≈ ${Math.round(each * todo.length * krw).toLocaleString()}원)\n만든 샘플은 저장되어 다음부터 무료로 들립니다. 계속할까요?`);
    if (!ok) return;
    if (!(await saveKeysIfAny())) return;
    stopRef.current = false;
    let n = 0, fail = 0;
    for (const v of todo) {
      if (stopRef.current) break;
      setBusy('batch'); setMsg(`📦 샘플 만드는 중 ${n + 1}/${todo.length} — ${v.name}`);
      const r = await api.ttsEngineTest({ id: tab, voice: v.id, model, style: tab === 'typecast' ? '' : c.style, emotion: tab === 'typecast' ? c.emotion : '', channel: chan });
      if (r && r.ok) { n++; setSamples((s) => ({ ...s, [tab]: { ...(s[tab] || {}), [sampleKeyOf(v)]: { sec: r.sec } } })); }
      else { fail++; if (fail >= 3) { setMsg('❌ 연속 실패 — 멈춥니다: ' + ((r && r.error) || '')); break; } }
    }
    setBusy('');
    if (!(fail >= 3)) setMsg(`📦 샘플 ${n}개 만듦${fail ? ` · 실패 ${fail}` : ''}${stopRef.current ? ' (멈춤)' : ''}`);
  }

  // 🙂 얼굴
  async function facePick(v) {
    const r = await api.ttsFacePick({ engine: tab, voice: v.id });
    if (r && r.ok) setFaces((f) => ({ ...f, [tab]: { ...(f[tab] || {}), [v.id]: { path: r.path, v: r.v } } }));
    else if (r && r.error) setMsg('❌ ' + r.error);
  }
  async function faceAi(v) {
    setBusy('face:' + v.id); setMsg(`🎨 「${v.name}」 얼굴 그리는 중… (🖥 로컬 ComfyUI · 무료 — 모델을 올리느라 첫 장은 1분쯤 걸릴 수 있습니다)`);
    const r = await api.ttsFaceAi({ engine: tab, voice: v.id, name: v.name, gender: v.gender, desc: v.desc, lang: v.lang, hint: '' });
    setBusy('');
    if (r && r.ok) { setFaces((f) => ({ ...f, [tab]: { ...(f[tab] || {}), [v.id]: { path: r.path, v: r.v } } })); setMsg(`🎨 「${v.name}」 얼굴을 넣었습니다`); }
    else setMsg('❌ ' + ((r && r.error) || '그리기 실패'));
  }
  // 🏷 채널 로고 — 채널편집 🏷 로고와 같은 칸(영상에 얹기는 채널편집에서 켠다)
  async function chLogoPick(name) {
    const r = await api.ttsChannelLogo({ name });
    if (r && r.ok) { setChLogos((f) => ({ ...f, [name]: { path: r.path, v: r.v } })); setMsg(`🏷 「${name}」 채널 로고를 넣었습니다`); }
    else if (r && r.error) setMsg('❌ ' + r.error);
  }
  // 🎨 보이는 목소리 얼굴 한꺼번에 그리기(얼굴 없는 것만 · 🖥 로컬 ComfyUI · 무료 · 멈춤 가능)
  async function drawAllFaces(list) {
    const todo = list.filter((v) => !(faces[tab] || {})[v.id]);
    if (!todo.length) { setMsg('보이는 목소리는 얼굴이 모두 있습니다(다시 그리려면 카드의 🎨)'); return; }
    const ok = await (confirm || window.confirm)(`보이는 목소리 ${todo.length}개의 얼굴을 🖥 로컬 ComfyUI 로 그립니다(무료).\n한 장에 20초 안팎 — 모두 약 ${Math.ceil(todo.length * 22 / 60)}분 걸립니다. 계속할까요?`);
    if (!ok) return;
    stopRef.current = false;
    let n = 0, fail = 0;
    for (const v of todo) {
      if (stopRef.current) break;
      setBusy('facebatch'); setMsg(`🎨 얼굴 ${n + fail + 1}/${todo.length} — 「${v.name}」 그리는 중… (⏹ 로 멈춤)`);
      const r = await api.ttsFaceAi({ engine: tab, voice: v.id, name: v.name, gender: v.gender, desc: v.desc, lang: v.lang, hint: '' });
      if (r && r.ok) { n++; setFaces((f) => ({ ...f, [tab]: { ...(f[tab] || {}), [v.id]: { path: r.path, v: r.v } } })); }
      else { fail++; if (fail >= 3) { setBusy(''); setMsg('❌ 연속 실패 — 멈춥니다: ' + ((r && r.error) || '')); return; } }
    }
    setBusy(''); setMsg(`🎨 얼굴 ${n}개를 그렸습니다${fail ? ` · 실패 ${fail}` : ''}${stopRef.current ? ' (멈춤)' : ''} — 마음에 안 들면 카드의 🎨 로 다시`);
  }
  async function faceClear(v) {
    await api.ttsFaceClear({ engine: tab, voice: v.id });
    setFaces((f) => { const m = { ...(f[tab] || {}) }; delete m[v.id]; return { ...f, [tab]: m }; });
  }

  const list = voices[tab] || [];
  const langs = useMemo(() => [...new Set(list.map((v) => v.lang).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')), [list]);
  const lang = fl[tab] != null ? fl[tab] : (tab === 'mai' && langs.includes('한국어') ? '한국어' : '');
  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return list.filter((v) => (!fg || v.gender === fg) && (!lang || v.lang === lang)
      && (!qq || [v.id, v.name, v.desc, v.lang].join(' ').toLowerCase().includes(qq)));
  }, [list, q, fg, lang]);
  // 이 목소리를 쓰는 채널(지금 고친 값 기준) — 채널끼리 목소리가 겹치는지 보이게
  const usersOf = (v) => Object.entries(drafts).filter(([, d]) => d.id === tab && (tab === 'omnivoice' ? d.ref === v.id : ((d.cfg[tab] || {}).voice || '') === v.id)).map(([n]) => n);

  if (!data) return (<div className="modal-bg show" data-testid="tts-engine-dlg"><div className="modal-card" style={{ width: 300 }}>불러오는 중…</div></div>);

  const selVoice = tab === 'omnivoice' ? list.find((v) => v.id === dr.ref) : list.find((v) => v.id === c.voice);
  const maiStyles = tab === 'mai' && selVoice ? ['', ...selVoice.styles] : null;
  const unit = eng.unit && eng.unit[model];
  const perScript = estUsd(tab, unit, scriptChars, data.koCps);
  const per10k = estUsd(tab, unit, 10000, data.koCps);
  const sampleUsd = estUsd(tab, unit, SAMPLE_CHARS, data.koCps);
  const won = (u) => (u == null ? '' : ` ≈ ${Math.round(u * krw).toLocaleString()}원`);

  // 채널 목록 한 줄 = 그 채널 목소리의 얼굴·이름
  const chanVoice = (name) => {
    const d = drafts[name] || {}; const id = d.id || 'omnivoice';
    const vid = id === 'omnivoice' ? d.ref : ((d.cfg || {})[id] || {}).voice;
    const vv = (voices[id] || []).find((x) => x.id === vid);
    const e = data.engines.find((x) => x.id === id);
    return { id, vid, name: vv ? vv.name : (id === 'omnivoice' ? String(vid || '').replace(/^srv:/, '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '') || '참조음성 없음' : vid || '목소리 없음'), logo: chLogos[name] || null, gender: vv && vv.gender, eng: e ? e.label.replace(/ TTS$/, '').replace('Microsoft ', '').replace('Google ', '') : id };
  };

  return (
    <div className="modal-bg show" data-testid="tts-engine-dlg">
      {/* 🔒 크기 고정 — 채널·탭·목록과 상관없이 같은 크기(안쪽만 스크롤) */}
      <div className="modal-card" data-testid="tts-eng-card" style={{ width: 'min(1180px, 96vw)', maxWidth: 'none', height: 'min(760px, 92vh)', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ margin: 0, flex: 1 }}>🔊 채널 목소리 — 채널마다 개성 있는 목소리를 고르세요</h3>
          {/* 💱 환율 = 공개 API 시장 환율 + 카드 해외결제 수수료(카드사·결제망 환율 페이지는 자동 조회를 막는다) */}
          <span data-testid="tts-fx" className="meta" title={fx ? `출처: ${fx.source} · 기준 ${fx.asOf}${fx.stale ? ' · ⚠ 새로 받지 못해 지난 값' : ''}\n카드 청구 예상 = 시장 환율 × (1 + 해외결제 수수료). 수수료는 카드마다 다릅니다(브랜드 약 1~1.1% + 카드사 약 0.2%).` : '환율을 받지 못했습니다 — 지난 값으로 계산합니다'}>
            💱 1달러 = {fx ? <><b>{fx.rate.toLocaleString()}</b>원(시장{fx.stale ? '·지난 값' : ''})</> : '—'} + 카드 수수료
          </span>
          <input type="number" min="0" max="5" step="0.05" style={{ width: 58 }} value={cardFee} onChange={(ev) => setCardFee(ev.target.value)} title="카드 해외결제 수수료(%) — 내 카드에 맞게" />
          <span className="meta">% → <b>{Math.round(krw).toLocaleString()}원</b></span>
          <button className="ghost" style={{ padding: '1px 6px' }} title="환율 새로 받기" onClick={async () => { const f = await api.fxUsdKrw({ force: true }); if (f && f.ok) setFx(f); else setMsg('❌ ' + ((f && f.error) || '환율 실패')); }}>↻</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {/* ── 왼쪽: 채널 ── */}
          <div data-testid="tts-chan-list" style={{ width: 240, flex: '0 0 240px', borderRight: '1px solid var(--line)', overflowY: 'auto', padding: 8 }}>
            {data.channels.map((ch) => {
              const cv = chanVoice(ch.name); const on = chan === ch.name;
              return (
                <div key={ch.name} role="button" tabIndex={0} data-testid="tts-chan" data-chan={ch.name}
                  onClick={() => { setChan(ch.name); setTab((drafts[ch.name] && drafts[ch.name].id) || 'omnivoice'); setMsg(''); }}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 8, cursor: 'pointer', marginBottom: 4, border: '1.5px solid ' + (on ? BLUE : 'transparent'), background: on ? 'rgba(37,99,235,0.08)' : 'transparent' }}>
                  <Face face={cv.logo} name={ch.name.replace(/^\d+_/, '')} size={on ? 48 : 40} square />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dirty[ch.name] ? '● ' : ''}{ch.name}</div>
                    <div className="meta" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cv.eng} · {cv.name}</div>
                    {on && (
                      <div style={{ display: 'flex', gap: 2, marginTop: 2 }} onClick={(e) => e.stopPropagation()}>
                        <button className="ghost" data-testid="tts-chlogo" style={{ padding: '0 6px', fontSize: 11 }} title="채널 로고 넣기(그림 파일) — 채널편집 🏷 로고와 같은 값 · 영상에 얹기는 채널편집에서" onClick={() => chLogoPick(ch.name)}>🏷 로고</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── 오른쪽: 이 채널의 엔진 탭 ── */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', padding: '8px 12px 0' }}>
              {data.engines.map((e) => {
                const cur = tab === e.id; const used = dr.id === e.id;
                return (
                  <button key={e.id} role="tab" data-testid={'tts-tab-' + e.id} className={cur ? '' : 'ghost'} onClick={() => { setTab(e.id); setMsg(''); setQ(''); setFg(''); }}
                    style={{ borderRadius: '8px 8px 0 0', padding: '7px 13px', marginBottom: -1, borderBottom: cur ? '2px solid ' + BLUE : '1px solid transparent', fontWeight: cur ? 700 : 500 }}>
                    {used ? '✅ ' : ''}{e.label.replace(/ TTS$/, '')}{e.paid ? <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.8 }}>{hasKey(e.id) ? '🔑' : '·'}</span> : null}
                  </button>
                );
              })}
            </div>

            <div data-testid={'tts-eng-' + tab} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '8px 12px' }}>
              <div className="meta" style={{ marginBottom: 6 }}>
                <b style={{ color: 'var(--fg)' }}>「{chan}」</b> 채널 — {dr.id === tab ? <b style={{ color: BLUE }}>이 엔진으로 읽습니다</b> : '카드를 고르면 이 엔진으로 바뀝니다'} · {eng.note}
              </div>

              {/* 설정 줄 */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center', marginBottom: 6 }}>
                {eng.paid && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{eng.keyLabel}
                  <input type="password" autoComplete="off" style={{ width: 200 }} placeholder={k.has ? `저장됨(…${k.tail}) — 바꿀 때만` : 'API 키 붙여넣기'} value={kd.key || ''} onChange={(ev) => setKeys((x) => ({ ...x, [tab]: { key: ev.target.value } }))} />
                  {k.has && <button className="ghost" title="저장된 키를 지웁니다(저장하면 반영)" onClick={() => setKeys((x) => ({ ...x, [tab]: { clear: true } }))}>{kd.clear ? '지울 예정' : '지우기'}</button>}
                  {eng.keyUrl && <button className="ghost" title={'키 발급 페이지 — ' + eng.keyUrl} onClick={() => api.ttsEngineOpenKey(tab)}>발급 ↗</button>}
                </span>)}
                {eng.regions && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>지역
                  <select value={region} onChange={(ev) => setRegion(ev.target.value)} title="모든 채널 공통(Speech 리소스 지역)">{eng.regions.map((r) => <option key={r} value={r}>{r}</option>)}</select></span>)}
                {eng.models && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>모델
                  <select value={model} onChange={(ev) => setCfg({ model: ev.target.value })}>{eng.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></span>)}
                {maiStyles && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>말투
                  <select value={maiStyles.includes(c.style || '') ? (c.style || '') : ''} onChange={(ev) => setCfg({ style: ev.target.value })}>{maiStyles.map((x) => <option key={x} value={x}>{x || '기본'}</option>)}</select>
                  <span className="meta">({selVoice.styles.length}가지)</span></span>)}
                {eng.hasStyle && (<span style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, minWidth: 240 }}>말투 지시
                  <input style={{ flex: 1 }} placeholder="예: 차분하고 따뜻한 다큐멘터리 내레이션 (3.8 모델만)" value={c.style || ''} onChange={(ev) => setCfg({ style: ev.target.value })} /></span>)}
                {eng.emotions && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>감정
                  <select value={c.emotion || 'normal'} onChange={(ev) => setCfg({ emotion: ev.target.value })}>{eng.emotions.map((x) => <option key={x} value={x}>{x}</option>)}</select></span>)}
                {tab === 'elevenlabs' && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>안정성
                  <input type="number" min="0" max="1" step="0.05" style={{ width: 60 }} placeholder="0.5" value={c.stability != null ? c.stability : ''} onChange={(ev) => setCfg({ stability: ev.target.value })} />
                  유사도 <input type="number" min="0" max="1" step="0.05" style={{ width: 60 }} placeholder="0.75" value={c.similarity != null ? c.similarity : ''} onChange={(ev) => setCfg({ similarity: ev.target.value })} /></span>)}
              </div>

              {/* 💲 요금 */}
              <div data-testid="tts-price" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, padding: '5px 8px', borderRadius: 6, background: 'rgba(22,163,74,0.08)', marginBottom: 6 }}>
                <span>💲 <b>{eng.prices[model || '_']}</b></span>
                {tab !== 'omnivoice' && <span>1만 자 ≈ <b>{usdTxt(per10k)}</b>{won(per10k)}</span>}
                {tab !== 'omnivoice' && scriptChars > 0 && <span>지금 대본 {scriptChars.toLocaleString()}자 ≈ <b>{usdTxt(perScript)}</b>{won(perScript)}</span>}
                {tab !== 'omnivoice' && <span className="meta">샘플 1개 ≈ {usdTxt(sampleUsd)}</span>}
              </div>

              {/* 목소리 거르기 */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                <b>목소리</b>
                <span className="meta">{shown.length}/{list.length}개{selVoice ? ` · 고른 것: ${selVoice.name}` : ''}</span>
                <span style={{ flex: 1 }} />
                <input data-testid="tts-voice-q" placeholder="🔍 이름·특징 검색" style={{ width: 160 }} value={q} onChange={(ev) => setQ(ev.target.value)} />
                {tab !== 'omnivoice' && (<select value={fg} onChange={(ev) => setFg(ev.target.value)}><option value="">성별 전체</option><option value="male">♂ 남성</option><option value="female">♀ 여성</option></select>)}
                {langs.length > 1 && (<select data-testid="tts-voice-lang" value={lang} onChange={(ev) => setFl((x) => ({ ...x, [tab]: ev.target.value }))}><option value="">{tab === 'typecast' ? '나이 전체' : '언어 전체'}</option>{langs.map((l) => <option key={l} value={l}>{l}</option>)}</select>)}
                {shown.length > 0 && (busy === 'facebatch'
                  ? <button className="ghost" onClick={() => { stopRef.current = true; }}>⏹ 얼굴 그리기 멈춤</button>
                  : <button className="ghost" data-testid="tts-face-all" disabled={!!busy} title="보이는 목소리 중 얼굴이 없는 것을 🖥 로컬 ComfyUI 로 한꺼번에 그립니다(무료)" onClick={() => drawAllFaces(shown)}>🎨 얼굴 모두 그리기</button>)}
                {tab !== 'omnivoice' && shown.length > 0 && (busy === 'batch'
                  ? <button className="ghost" onClick={() => { stopRef.current = true; }}>⏹ 샘플 만들기 멈춤</button>
                  : <button className="ghost" disabled={!!busy || (eng.paid && !hasKey(tab))} title="보이는 목소리 중 샘플이 없는 것을 한 번에 만들어 저장합니다(요금 확인 후 진행)" onClick={() => makeAllSamples(shown)}>📦 샘플 모두 만들기</button>)}
                {(eng.listVoices || tab === 'omnivoice') && (
                  <button className="ghost" disabled={!!busy || (eng.paid && !hasKey(tab))} onClick={() => loadVoices(tab)}
                    title={tab === 'gemini' ? '확장 라이브러리(수백 개 · 3.8 모델용)를 API 로 불러옵니다' : '목록을 다시 불러옵니다'}>
                    {busy === 'voices' ? '⏳' : tab === 'gemini' ? '⬇ 확장 라이브러리' : '↻ 다시 불러오기'}</button>)}
              </div>

              {/* 목소리 카드 — 이 칸만 스크롤 */}
              <div data-testid="tts-voice-grid" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8, alignContent: 'start', paddingRight: 4 }}>
                {shown.map((v) => (
                  <VoiceCard key={v.id} v={v} sel={isSel(v)} face={(faces[tab] || {})[v.id]} busy={busy}
                    sampled={hasSample(v)} sampleCost={tab === 'omnivoice' ? 0 : sampleUsd}
                    users={tab === 'omnivoice' ? [...new Set([...usersOf(v), ...(omniUsed[v.name] || []).filter((n) => !drafts[n] || drafts[n].ref === v.id)])] : usersOf(v)}
                    onPick={() => pickVoice(v)} onPlay={(force) => preview(v, force)}
                    onFacePick={() => facePick(v)} onFaceAi={() => faceAi(v)} onFaceClear={() => faceClear(v)} />
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
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="meta" data-testid="tts-eng-msg" style={{ flex: 1, fontWeight: msg ? 600 : 400 }}>
            {msg || '💡 🔈 = 샘플 듣기(회사 샘플·저장된 샘플은 무료 · 없으면 한 문장 만들어 저장 · Shift+클릭 = 다시 만들기). 🖼 = 얼굴 그림 넣기 · 🎨 = 로컬 ComfyUI 로 얼굴 그리기(무료).'}
          </span>
          <span className="meta">{Object.keys(dirty).length ? `바뀐 채널 ${Object.keys(dirty).length}개` : ''}</span>
          <button data-testid="tts-eng-save" onClick={save}>저장</button>
          <button className="ghost" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

// 얼굴 — 그림이 있으면 그것, 없으면 이름 첫 글자(성별 색)
export function Face({ face, name, gender, size = 44, square }) {
  const bg = gender === 'male' ? '#dbeafe' : gender === 'female' ? '#fce7f3' : '#e5e7eb';
  const fgc = gender === 'male' ? '#1d4ed8' : gender === 'female' ? '#be185d' : '#374151';
  const st = { width: size, height: size, flex: `0 0 ${size}px`, borderRadius: square ? 10 : '50%', objectFit: 'cover', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' };
  if (face && face.path) return <img data-testid="tts-face-img" src={media(face.path, face.v)} alt="" style={{ ...st, border: '1px solid var(--line)' }} />;
  // 앞 번호·기호(「02_」「#05_」)는 건너뛰고 첫 글자 — 「02_저음」 → 「저」
  const nm = String(name || '');
  const ch = (nm.match(/[가-힣]/) || nm.match(/[A-Za-zぁ-んァ-ン一-龥]/) || [nm.slice(0, 1) || '?'])[0];   // 한글을 먼저(「1nd_고전」 → 「고」)
  return <div style={{ ...st, background: bg, color: fgc, fontWeight: 800, fontSize: Math.round(size * 0.42) }}>{ch}</div>;
}

function VoiceCard({ v, sel, face, busy, sampled, sampleCost, users, onPick, onPlay, onFacePick, onFaceAi, onFaceClear }) {
  const playing = busy === 'play:' + v.id;
  return (
    <div role="button" tabIndex={0} data-testid="tts-voice-card" data-voice={v.id} onClick={onPick} onKeyDown={(e) => { if (e.key === 'Enter') onPick(); }}
      style={{ border: '1.5px solid ' + (sel ? BLUE : 'var(--line)'), background: sel ? 'rgba(37,99,235,0.08)' : 'var(--bg2, transparent)', borderRadius: 10, padding: 8, cursor: 'pointer', display: 'flex', gap: 8, minHeight: 116 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <Face face={face} name={v.name} gender={v.gender} size={52} />
        <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
          <button className="ghost" style={{ padding: '0 4px', fontSize: 11 }} title="얼굴 그림 넣기(파일)" onClick={onFacePick}>🖼</button>
          <button className="ghost" style={{ padding: '0 4px', fontSize: 11 }} disabled={!!busy && busy !== 'play:' + v.id} title="AI 로 얼굴 그리기(🖥 로컬 ComfyUI · 무료)" onClick={onFaceAi}>{busy === 'face:' + v.id ? '⏳' : '🎨'}</button>
          {face && <button className="ghost" style={{ padding: '0 4px', fontSize: 11 }} title="얼굴 지우기" onClick={onFaceClear}>✕</button>}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.id}>{sel ? '✔ ' : ''}{v.name}</span>
          {G_ICON[v.gender] && <span title={v.gender}>{G_ICON[v.gender]}</span>}
        </div>
        {v.lang && <div className="meta" style={{ fontSize: 11 }}>{v.lang}</div>}
        {v.desc && <div className="meta" style={{ fontSize: 11, lineHeight: '15px', maxHeight: 30, flexShrink: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }} title={v.desc}>{v.desc}</div>}
        {users && users.length > 0 && <div style={{ fontSize: 10, color: BLUE, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={users.join(', ')}>채널: {users.join(', ')}</div>}
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <button className="ghost" data-testid="tts-voice-play" style={{ padding: '1px 8px', fontSize: 11 }}
            title={sampled ? '샘플 듣기(저장됨 · 무료) — Shift+클릭 = 다시 만들기' : `샘플 만들어 듣기(약 ${usdTxt(sampleCost)} · 한 번 만들면 저장)`}
            onClick={(e) => onPlay(e.shiftKey)}>{playing ? '⏳' : '🔈'} {sampled || !sampleCost ? '듣기' : `듣기 ${usdTxt(sampleCost)}`}</button>
          {sampled && <span style={{ fontSize: 10, color: '#16a34a' }}>무료</span>}
        </div>
      </div>
    </div>
  );
}
