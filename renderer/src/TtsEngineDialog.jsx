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
// 🇰🇷 목소리 언어 → 한국어 이름(거르기 묶음). 'ko' · 'ko-KR' · 'ko · seoul' · '한국어' → '한국어' · 표시 없음/다국어 → '다국어'
const LANG_KO = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', vi: '베트남어', es: '스페인어', fr: '프랑스어', de: '독일어', it: '이탈리아어', pt: '포르투갈어', ru: '러시아어', hi: '힌디어', id: '인도네시아어', th: '태국어', tr: '튀르키예어', pl: '폴란드어', nl: '네덜란드어', ar: '아랍어' };
function langOf(v) {
  const raw = String((v && v.lang) || '').split(' · ')[0].trim();
  if (!raw || raw === '다국어') return '다국어';
  const m = /^([a-z]{2})([-_][A-Za-z]{2})?$/.exec(raw);
  if (m) return LANG_KO[m[1]] || raw;
  return raw.replace(/\(.*\)$/, '');   // 「영어(미국)」 → 「영어」
}
// 🇰🇷 번역 대상 — 영어 글자가 한글보다 많은 글(main _needsTr 와 같은 규칙)
const needsTr = (t) => { const s = String(t || ''); return /[A-Za-z]{3,}/.test(s) && (s.match(/[A-Za-z]/g) || []).length > (s.match(/[가-힣]/g) || []).length; };
// 🇰🇷 언어 줄(「ko · seoul」) → 「한국어 · 서울」 — 낱말 사전(번역기 없이)
const ACCENT_KO = { standard: '표준어', seoul: '서울', busan: '부산', gyeongsang: '경상도', jeolla: '전라도', chungcheong: '충청도', jeju: '제주', american: '미국', british: '영국', australian: '호주', indian: '인도', canadian: '캐나다', irish: '아일랜드', scottish: '스코틀랜드' };
function langLabel(t) {
  const parts = String(t || '').split(' · ').filter(Boolean);
  return parts.map((x, i) => { const k = x.trim(); if (i === 0) { const m = /^([a-z]{2})([-_][A-Za-z]{2})?$/.exec(k); if (m) return LANG_KO[m[1]] || k; } return ACCENT_KO[k.toLowerCase()] || k; }).join(' · ');
}
// 💰 금액은 원화로(로이 2026-10-05) — 달러 단가 × 환율(카드 청구 예상). 10원 미만은 소수 한 자리 · 0.1원 미만은 「0.1원 미만」
const wonTxt = (usd, rate) => { if (usd == null) return '?'; if (usd === 0) return '무료'; const w = usd * (rate || 1400); return w < 0.1 ? '0.1원 미만' : w < 10 ? `${w.toFixed(1)}원` : `${Math.round(w).toLocaleString()}원`; };

// 요금 추정 — main tts-engines.estimateUsd 와 같은 식(단가표는 main 이 내려준다)
function estUsd(engId, unit, chars, koCps) {
  if (engId === 'omnivoice') return 0;
  if (!unit) return null;
  const n = Math.max(0, Number(chars) || 0);
  return unit.kind === 'char' ? n * unit.usd : (n / (koCps || 7)) * unit.usd;
}

// 🎙 target(v0.6.83) — 없으면 **채널 기본 목소리**(⚙ 채널편집 → 「음성 설정에서 바꾸기」 · 대본이 없을 때의 리본 버튼).
//   { kind: 'script', names:[대본…], channel, current } = 리본 「🔊 음성 설정」 → 열려 있는 대본 모두의 목소리
//   { kind: 'speaker', speaker|null, script, clips, channel, current } = 클립의 「🗣」 → 지금 대본의 그 화자(내레이션) 클립 모두(v0.6.84)
//   target 이면 채널 설정은 저장하지 않고 onApply({ voiceEngine, ref, label } | null) 만 부른다(null = 덮어쓴 목소리 지우기).
const TGT = '__target__';
// 대상 이름(사람 말) — 「열린 대본」 · 「내레이션」 · 「화자 「엄마」」
const tgtWho = (t) => (!t ? '' : t.kind === 'speaker' ? (t.speaker ? `화자 「${t.speaker}」` : '내레이션') : '열린 대본');
export default function TtsEngineDialog({ initialChannel, scriptChars, onClose, onSaved, confirm, onOpenKeys, target, onApply }) {
  const [data, setData] = useState(null);          // { engines, keys, channels, region, krw, koCps }
  const [drafts, setDrafts] = useState({});        // 채널 → { id, ref, cfg:{엔진:{model,voice,style,…}} }
  const [dirty, setDirty] = useState({});          // 바뀐 채널
  const [chan, setChan] = useState('');
  const [tab, setTab] = useState('omnivoice');
  const [keys, setKeys] = useState({});            // 엔진 → { key | clear }
  const [region, setRegion] = useState('eastus');
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
  const [playing, setPlaying] = useState('');      // 🔈 지금 소리 나는 목소리 id(다시 누르면 멈춤)
  // 📚 ElevenLabs — 'mine' = 내 목소리 · 'library' = 보이스 라이브러리(한국어 원어민 등 · 고르면 내 목록에 추가)
  const [elSrc, setElSrc] = useState('mine');
  const [libVoices, setLibVoices] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);  // ⋯ 메뉴(한꺼번에 하기)
  const [keyEdit, setKeyEdit] = useState(false);    // 🔑 저장된 키 바꾸기 칸 열기
  const [feeOpen, setFeeOpen] = useState(false);    // 💳 카드 수수료 칸 열기
  const [tr, setTr] = useState({});                 // 🇰🇷 번역 { 원문: 한국어 }
  const trBusyRef = useRef(false);
  const trTriedRef = useRef(new Set());
  const trFailRef = useRef({});                    // 글 → 번역 실패 횟수
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
      api.ttsChannelAvatars({}).then((a) => {
        if (!a || !a.avatars) return;
        setChLogos((cur) => { const m = { ...cur }; for (const [n, v] of Object.entries(a.avatars)) if (!v.own) m[n] = v; return m; });
      }).catch(() => {});
      api.fxUsdKrw({}).then((f) => { if (f && f.ok) setFx(f); }).catch(() => {});
      const vs = {}, fs = {}, ss = {};
      for (const e of r.engines) { if (e.voices) vs[e.id] = e.voices; fs[e.id] = e.faces || {}; ss[e.id] = e.samples || {}; }
      setVoices(vs); setFaces(fs); setSamples(ss);
      const d = {};
      for (const c of r.channels) d[c.name] = { id: c.voiceEngine.id, ref: c.ref, cfg: { [c.voiceEngine.id]: { ...c.voiceEngine } } };
      if (target) {
        // 처음 고른 카드 = 지금 덮어쓴 목소리 → 없으면 채널 목소리(그대로 「적용」하면 바뀌는 것 없음)
        const cur = target.current && target.current.voiceEngine ? target.current : null;
        const base = d[target.channel] || { id: 'omnivoice', ref: '', cfg: {} };
        d[TGT] = cur ? { id: cur.voiceEngine.id, ref: cur.ref || '', cfg: { ...base.cfg, [cur.voiceEngine.id]: { ...cur.voiceEngine } } } : { ...base, cfg: { ...base.cfg } };
        setDrafts(d); setChan(TGT); setTab(d[TGT].id || 'omnivoice');
        return;
      }
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
    if (tab === 'elevenlabs' && hasKey(tab) && !(voices.elevenlabs || []).some((v) => langOf(v) === '한국어')) { setElSrc('library'); if (!libVoices) loadLibrary(); }
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
    if (target) {
      const d = drafts[TGT];
      if (!dirty[TGT]) { onClose(); return; }
      if (d.id !== 'omnivoice' && !hasKey(d.id)) { setMsg(`⚠ ${data.engines.find((x) => x.id === d.id).label} 의 API 키를 넣어야 이 목소리로 만들 수 있습니다`); return; }
      if (d.id !== 'omnivoice' && !String((d.cfg[d.id] || {}).voice || '').trim()) { setMsg('⚠ 목소리 카드를 하나 고르세요'); return; }
      if (d.id === 'omnivoice' && !/^srv:./.test(String(d.ref || ''))) { setMsg('⚠ OmniVoice 서버 목소리 카드를 하나 고르세요'); return; }
      const e = data.engines.find((x) => x.id === d.id);
      const cc = d.cfg[d.id] || {};
      const ve = d.id === 'omnivoice' ? { id: 'omnivoice' } : { id: d.id, ...cc, model: cc.model && e.models.some((m) => m.id === cc.model) ? cc.model : e.models[0].id };
      const vid = d.id === 'omnivoice' ? d.ref : ve.voice;
      const vv = (voices[d.id] || []).find((x) => x.id === vid);
      const label = vv ? String(vv.name || '').split(' - ')[0] : String(vid || '').replace(/^srv:/, '');
      setBusy('apply');
      const ok = await onApply({ voiceEngine: ve, ref: d.id === 'omnivoice' ? d.ref : '', label });
      setBusy('');
      if (ok !== false) onClose();
      return;
    }
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
    // 🔈 듣는 중에 같은 카드를 또 누르면 멈춘다(v0.6.85 · 로이 「다시 처음부터 나온다」) — Shift(다시 만들기)는 예외
    if (!force && playing === v.id && audioRef.current && !audioRef.current.paused) { try { audioRef.current.pause(); } catch {} setPlaying(''); setBusy((b) => (b === 'play:' + v.id ? '' : b)); return; }
    try { audioRef.current && audioRef.current.pause(); } catch {}
    setPlaying('');
    setBusy('play:' + v.id); setMsg('');
    try {
      let src = force ? '' : (v.preview || '');
      if (!src && !force && tab === 'omnivoice') { try { src = (await api.readAudio(v.id)) || ''; } catch {} }
      if (!src) {
        if (!(await saveKeysIfAny())) { setBusy(''); return; }
        const st = tab === 'typecast' ? (c.emotion || '') : (c.style || '');
        const r = await api.ttsEngineTest({ id: tab, voice: v.id, model, style: tab === 'typecast' ? '' : c.style, emotion: tab === 'typecast' ? c.emotion : '', stability: c.stability, similarity: c.similarity, channel: target ? target.channel : chan, force: !!force });
        if (!r || !r.ok) { setMsg('❌ ' + ((r && r.error) || '샘플 실패')); setBusy(''); return; }
        if (!r.cached) {
          setSamples((s) => ({ ...s, [tab]: { ...(s[tab] || {}), [[model, v.id, st].join('|')]: { sec: r.sec } } }));
          if (r.usd) setMsg(`🔈 샘플을 만들어 저장했습니다(약 ${wonTxt(r.usd, krw)}) — 다음부터는 무료로 들립니다`);
        }
        src = media(r.path, String(r.sec));
      }
      const a = new Audio(src); audioRef.current = a;
      a.onended = () => { setBusy((b) => (b === 'play:' + v.id ? '' : b)); setPlaying((p) => (p === v.id && audioRef.current === a ? '' : p)); };
      await a.play();
      setPlaying(v.id); setBusy((b) => (b === 'play:' + v.id ? '' : b));   // 소리가 나기 시작하면 ⏳ → ⏹
    } catch (e) { setMsg('❌ 재생 실패: ' + e.message); setBusy(''); }
  }
  const sampleKeyOf = (v) => [model, v.id, tab === 'typecast' ? (c.emotion || '') : (c.style || '')].join('|');
  const hasSample = (v) => !!v.preview || !!(samples[tab] || {})[sampleKeyOf(v)];

  // 📦 보이는 목소리 샘플 한꺼번에 만들기(이미 있는 것은 건너뜀 · 중간에 멈춤 가능)
  async function makeAllSamples(list) {
    const todo = list.filter((v) => !hasSample(v));
    if (!todo.length) { setMsg('보이는 목소리는 샘플이 모두 있습니다'); return; }
    const each = estUsd(tab, eng.unit && eng.unit[model], SAMPLE_CHARS, data.koCps) || 0;
    const ok = await (confirm || window.confirm)(`보이는 목소리 ${todo.length}개의 샘플을 만듭니다.\n예상 요금: 약 ${wonTxt(each * todo.length, krw)}\n만든 샘플은 저장되어 다음부터 무료로 들립니다. 계속할까요?`);
    if (!ok) return;
    if (!(await saveKeysIfAny())) return;
    stopRef.current = false;
    let n = 0, fail = 0;
    for (const v of todo) {
      if (stopRef.current) break;
      setBusy('batch'); setMsg(`📦 샘플 만드는 중 ${n + 1}/${todo.length} — ${v.name}`);
      const r = await api.ttsEngineTest({ id: tab, voice: v.id, model, style: tab === 'typecast' ? '' : c.style, emotion: tab === 'typecast' ? c.emotion : '', channel: target ? target.channel : chan });
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
  // 📚 보이스 라이브러리(한국어) 불러오기 · 고르면 내 목록에 추가하고 이 채널 목소리로
  async function loadLibrary() {
    if (!(await saveKeysIfAny())) return;
    setBusy('voices'); setMsg('📚 한국어 목소리를 찾는 중…');
    const r = await api.elSharedVoices({ language: 'ko' });
    setBusy('');
    if (r && r.ok) { setLibVoices(r.voices); setMsg(`📚 한국어 목소리 ${r.voices.length}개 — 🔈 로 들어 보고(무료) 카드를 누르면 내 목록에 추가해 이 채널 목소리로 씁니다`); }
    else setMsg('❌ ' + ((r && r.error) || '라이브러리 실패'));
  }
  async function addFromLibrary(v) {
    const mine = (voices.elevenlabs || []).find((x) => x.name === v.name);
    if (mine) { pickVoice(mine); setMsg(`「${v.name}」 은 이미 내 목록에 있습니다 — 이 채널 목소리로 골랐습니다`); return; }
    const ok = await (confirm || window.confirm)(`「${v.name}」(${v.lang}) 목소리를 ElevenLabs 내 목록에 추가하고 「${target ? tgtWho(target) : chan + ' 채널'}」 목소리로 고를까요?\n(요금제마다 추가할 수 있는 목소리 개수에 제한이 있습니다)`);
    if (!ok) return;
    setBusy('add:' + v.id); setMsg(`📚 「${v.name}」 추가하는 중…`);
    const r = await api.elAddShared({ ownerId: v.ownerId, voiceId: v.id, name: v.name });
    setBusy('');
    if (!r || !r.ok) { setMsg('❌ ' + ((r && r.error) || '추가 실패')); return; }
    setVoices((x) => ({ ...x, elevenlabs: r.voices }));
    patchDraft((d) => ({ ...d, id: 'elevenlabs', cfg: { ...d.cfg, elevenlabs: { ...(d.cfg.elevenlabs || {}), model, voice: r.voiceId } } }));
    setElSrc('mine');
    setMsg(`✅ 「${v.name}」 을 내 목록에 추가하고 「${target ? tgtWho(target) : chan + ' 채널'}」 목소리로 골랐습니다 — 저장을 누르세요`);
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

  const isLib = tab === 'elevenlabs' && elSrc === 'library';
  const list = isLib ? (libVoices || []) : (voices[tab] || []);
  const langs = useMemo(() => [...new Set(list.map(langOf).filter((x) => x && x !== '다국어'))].sort((a, b) => (a === '한국어' ? -1 : b === '한국어' ? 1 : a.localeCompare(b, 'ko'))), [list]);
  const lang = fl[tab] != null ? fl[tab] : (langs.includes('한국어') ? '한국어' : '');   // 🇰🇷 기본 = 한국어(모든 탭)
  // 🇰🇷 카드 글 한국어로 — 이름 뒤 소개(「Victor - Engaged…」의 「Engaged…」)·설명은 번역(main 저장), 언어 줄은 낱말 사전.
  //   원문은 카드에 마우스를 올리면 보인다. 번역 전엔 원문 그대로.
  const trName = (v) => { const i = String(v.name || '').indexOf(' - '); if (i < 0) return v.name; const tg = v.name.slice(i + 3); return v.name.slice(0, i) + ' - ' + (tr[tg] || tg); };
  const koView = (v) => ({ ...v, base: String(v.name || '').split(' - ')[0], name: trName(v), desc: tr[v.desc] || v.desc, lang: langLabel(v.lang), orig: [v.name, v.desc, v.lang].filter(Boolean).join('\n') });
  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return list.filter((v) => (!fg || v.gender === fg) && (!lang || langOf(v) === lang || langOf(v) === '다국어')
      && (!qq || [v.id, v.name, v.desc, v.lang, tr[v.desc] || '', trName(v)].join(' ').toLowerCase().includes(qq)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, q, fg, lang, tr]);
  // 보이는 카드의 영어 글을 120개씩 모아 번역을 부탁한다 — 한 번에 하나 · 돌아오면 나머지 · 실패한 글은 다시 묻지 않는다
  useEffect(() => {
    if (trBusyRef.current) return;
    const need = [];
    for (const v of shown) {
      if (need.length >= 120) break;   // 한 번에 120개 — 돌아오면 이 효과가 다시 돌아 나머지를 묻는다
      const i = String(v.name || '').indexOf(' - ');
      for (const t of [v.desc, i >= 0 ? v.name.slice(i + 3) : '']) if (t && needsTr(t) && !tr[t] && !trTriedRef.current.has(t)) need.push(t);
    }
    if (!need.length) return;
    trBusyRef.current = true;
    for (const t of need) trTriedRef.current.add(t);
    api.ttsTranslate({ texts: need }).then((r) => {
      trBusyRef.current = false;
      if (r && r.map) setTr((m) => ({ ...m, ...r.map }));
      // 실패(붐빔 등)한 글은 20초 뒤 다시 묻는다(최대 3번) — 안 그러면 그 카드들이 영어로 남는다
      if (r && !r.ok) {
        const left = need.filter((t) => !(r.map || {})[t]);
        const retry = left.filter((t) => (trFailRef.current[t] = (trFailRef.current[t] || 0) + 1) < 3);
        if (retry.length) setTimeout(() => { for (const t of retry) trTriedRef.current.delete(t); setTr((m) => ({ ...m })); }, 20000);
        if (r.error) setMsg('🇰🇷 번역 잠시 실패 — ' + (retry.length ? '20초 뒤 다시 합니다' : r.error));
      }
    }).catch(() => { trBusyRef.current = false; });
  }, [shown, tr]);
  // 이 목소리를 쓰는 채널(지금 고친 값 기준) — 채널끼리 목소리가 겹치는지 보이게
  const usersOf = (v) => Object.entries(drafts).filter(([n]) => n !== TGT).filter(([, d]) => d.id === tab && (tab === 'omnivoice' ? d.ref === v.id : ((d.cfg[tab] || {}).voice || '') === v.id)).map(([n]) => n);

  if (!data) return (<div className="modal-bg show" data-testid="tts-engine-dlg"><div className="modal-card" style={{ width: 300 }}>불러오는 중…</div></div>);

  const selVoice = tab === 'omnivoice' ? list.find((v) => v.id === dr.ref) : list.find((v) => v.id === c.voice);
  const maiStyles = tab === 'mai' && selVoice ? ['', ...selVoice.styles] : null;
  const unit = eng.unit && eng.unit[model];
  const perScript = estUsd(tab, unit, scriptChars, data.koCps);
  const per10k = estUsd(tab, unit, 10000, data.koCps);
  const sampleUsd = estUsd(tab, unit, SAMPLE_CHARS, data.koCps);

  // 채널 목록 한 줄 = 그 채널 목소리의 얼굴·이름
  const chanVoice = (name) => {
    const d = drafts[name] || {}; const id = d.id || 'omnivoice';
    const vid = id === 'omnivoice' ? d.ref : ((d.cfg || {})[id] || {}).voice;
    const vv = (voices[id] || []).find((x) => x.id === vid);
    const e = data.engines.find((x) => x.id === id);
    return { id, vid, name: vv ? vv.name : (id === 'omnivoice' ? String(vid || '').replace(/^srv:/, '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '') || '참조음성 없음' : vid || '목소리 없음'), logo: chLogos[name] || null, gender: vv && vv.gender, eng: e ? e.label.replace(/ TTS$/, '').replace('Microsoft ', '').replace('Google ', '') : id };
  };

  const isOnTab = dr.id === tab;
  const busyBatch = busy === 'facebatch' || busy === 'batch';
  return (
    <div className="modal-bg show" data-testid="tts-engine-dlg">
      {/* 🧹 카드 위 얼굴 버튼은 마우스를 올렸을 때만(v0.6.77 정리) */}
      <style>{`.vc .vc-tools{opacity:0;transition:opacity .12s}.vc:hover .vc-tools,.vc:focus-within .vc-tools{opacity:1}.tts-more button{display:block;width:100%;text-align:left;margin:2px 0}`}</style>
      {/* 🔒 크기 고정 — 채널·탭·목록과 상관없이 같은 크기(안쪽만 스크롤) */}
      <div className="modal-card" data-testid="tts-eng-card" style={{ width: 'min(1180px, 96vw)', maxWidth: 'none', height: 'min(760px, 92vh)', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, flex: 1 }}>🔊 음성 설정 <span className="meta" data-testid="tts-mode" style={{ fontWeight: 400, fontSize: 12 }}>{!target ? '채널 기본 목소리 — 채널마다 고르세요(대본·클립이 따로 고르지 않으면 이 목소리)' : target.kind === 'speaker' ? `이 대본의 ${tgtWho(target)} 목소리${target.clips != null ? ` — 클립 ${target.clips}개` : ''}` : `열려 있는 대본 ${target.names.length}개의 목소리 — 채널 기본은 그대로`}</span></h3>
          {/* 💱 환율 = 공개 API 시장 환율 + 카드 해외결제 수수료(카드사·결제망 환율 페이지는 자동 조회를 막는다) — 수수료는 눌러서 고친다 */}
          <span data-testid="tts-fx" className="meta" style={{ cursor: 'pointer' }} onClick={() => setFeeOpen((x) => !x)}
            title={(fx ? `시장 환율 1달러 = ${fx.rate.toLocaleString()}원 (${fx.source} · 기준 ${fx.asOf}${fx.stale ? ' · ⚠ 지난 값' : ''})\n` : '환율을 받지 못해 지난 값으로 계산합니다\n') + `+ 카드 해외결제 수수료 ${cardFee}% = 카드 청구 예상 환율\n눌러서 수수료를 고칩니다`}>
            💱 1달러 ≈ <b>{Math.round(krw).toLocaleString()}원</b>{fx ? '' : '(지난 값)'}
          </span>
          {feeOpen && (<>
            <span className="meta">카드 수수료</span>
            <input type="number" min="0" max="5" step="0.05" style={{ width: 56 }} value={cardFee} onChange={(ev) => setCardFee(ev.target.value)} title="카드 해외결제 수수료(%) — 내 카드에 맞게" />
            <span className="meta">%</span>
            <button className="ghost" style={{ padding: '1px 6px' }} title="환율 새로 받기" onClick={async () => { const f = await api.fxUsdKrw({ force: true }); if (f && f.ok) setFx(f); else setMsg('❌ ' + ((f && f.error) || '환율 실패')); }}>↻</button>
          </>)}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {/* ── 왼쪽: 채널 ── */}
          {target ? (<TargetPane target={target} chanVoice={target.channel && drafts[target.channel] ? chanVoice(target.channel) : null} chosen={chanVoice(TGT)} dirty={!!dirty[TGT]} busy={busy}
            onClear={async () => { if (!target.current) { onClose(); return; } setBusy('apply'); const ok = await onApply(null); setBusy(''); if (ok !== false) onClose(); }} />) : (
          <div data-testid="tts-chan-list" style={{ width: 230, flex: '0 0 230px', borderRight: '1px solid var(--line)', overflowY: 'auto', padding: 8 }}>
            {data.channels.map((ch) => {
              const cv = chanVoice(ch.name); const on = chan === ch.name;
              return (
                <div key={ch.name} role="button" tabIndex={0} data-testid="tts-chan" data-chan={ch.name}
                  onClick={() => { setChan(ch.name); setTab((drafts[ch.name] && drafts[ch.name].id) || 'omnivoice'); setMsg(''); }}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 8, cursor: 'pointer', marginBottom: 4, border: '1.5px solid ' + (on ? BLUE : 'transparent'), background: on ? 'rgba(37,99,235,0.08)' : 'transparent' }}>
                  <Face face={cv.logo} name={ch.name.replace(/^\d+_/, '')} size={40} square />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dirty[ch.name] ? '● ' : ''}{ch.name}</div>
                    <div className="meta" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cv.eng} · {cv.name}</div>
                  </div>
                  {on && <button className="ghost" data-testid="tts-chlogo" style={{ padding: '0 5px', fontSize: 11, flex: '0 0 auto' }} title="채널 로고 넣기(그림 파일) — 채널편집 🏷 로고와 같은 값 · 영상에 얹기는 채널편집에서" onClick={(e) => { e.stopPropagation(); chLogoPick(ch.name); }}>🏷</button>}
                </div>
              );
            })}
          </div>)}

          {/* ── 오른쪽: 이 채널의 엔진 탭 ── */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', padding: '8px 12px 0' }}>
              {data.engines.map((e) => {
                const cur = tab === e.id; const used = dr.id === e.id;
                return (
                  <button key={e.id} role="tab" data-testid={'tts-tab-' + e.id} className={cur ? '' : 'ghost'} onClick={() => { setTab(e.id); setMsg(''); setQ(''); setFg(''); setMoreOpen(false); setKeyEdit(false); }}
                    title={e.paid ? (hasKey(e.id) ? 'API 키 있음' : 'API 키 없음') : '내 GPU 서버 · 무료'}
                    style={{ borderRadius: '8px 8px 0 0', padding: '7px 13px', marginBottom: -1, borderBottom: cur ? '2px solid ' + BLUE : '1px solid transparent', fontWeight: cur ? 700 : 500 }}>
                    {used ? '✅ ' : ''}{e.label.replace(/ TTS$/, '').replace(/^(Microsoft|Google) /, '')}{e.paid ? <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.8 }}>{hasKey(e.id) ? '🔑' : '·'}</span> : null}
                  </button>
                );
              })}
            </div>

            <div data-testid={'tts-eng-' + tab} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '8px 12px', gap: 6 }}>
              {/* ① 설정 한 줄 — 상태 · 키 · 모델 · 지역 (설명은 ⓘ 에) */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'center' }}>
                <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: isOnTab ? 'rgba(37,99,235,0.12)' : 'rgba(0,0,0,0.05)', color: isOnTab ? BLUE : 'inherit', fontWeight: 600 }}
                  title={eng.note}>{isOnTab ? `✅ 「${target ? tgtWho(target) : chan}」이 이 엔진으로 읽습니다` : '카드를 고르면 이 엔진으로 바뀝니다'} ⓘ</span>
                <span style={{ flex: 1 }} />
                {/* 🔑 키는 ⚙ 설정 → 🔑 API 키 한 곳에서(v0.6.78) — 여기는 상태와 그리로 가는 버튼만 */}
                {eng.paid && (k.has
                  ? <span className="meta" style={{ color: '#16a34a', fontWeight: 600 }} title={`${eng.keyLabel} 저장됨(…${k.tail}) — 바꾸기·지우기는 ⚙ 설정 → 🔑 API 키`}>🔑 키 저장됨</span>
                  : <button data-testid="tts-key-goto" className="ghost" style={{ padding: '2px 8px', color: '#b45309' }} title="⚙ 설정 → 🔑 API 키 에서 넣습니다" onClick={() => (onOpenKeys ? onOpenKeys() : null)}>🔑 키 넣기 → ⚙ 설정</button>)}
                {eng.models && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>모델
                  <select value={model} onChange={(ev) => setCfg({ model: ev.target.value })}>{eng.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></span>)}
                {eng.regions && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>지역
                  <select value={region} onChange={(ev) => setRegion(ev.target.value)} title="모든 채널 공통(Speech 리소스 지역)">{eng.regions.map((r) => <option key={r} value={r}>{r}</option>)}</select></span>)}
              </div>
              {/* 🎉 기간 한정 할인 띠(v0.6.84 · 로이 「이벤트 기간을 눈에 잘 띄게」) — 날짜·단가는 main tts-engines.PROMOS 한 곳 */}
              {(eng.promos || []).map((p) => <PromoBanner key={p.id} p={p} krw={krw} unit={eng.unit} />)}
              {/* ② 말투·감정(있는 엔진만) */}
              {(maiStyles || eng.hasStyle || eng.emotions || tab === 'elevenlabs') && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'center' }}>
                  {maiStyles && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>말투
                    <select value={maiStyles.includes(c.style || '') ? (c.style || '') : ''} onChange={(ev) => setCfg({ style: ev.target.value })}>{maiStyles.map((x) => <option key={x} value={x}>{x || '기본'}</option>)}</select></span>)}
                  {eng.hasStyle && (<span style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, minWidth: 240 }}>말투 지시
                    <input style={{ flex: 1 }} placeholder="예: 차분하고 따뜻한 다큐멘터리 내레이션 (3.8 모델만)" value={c.style || ''} onChange={(ev) => setCfg({ style: ev.target.value })} /></span>)}
                  {eng.emotions && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>감정
                    <select value={c.emotion || 'normal'} onChange={(ev) => setCfg({ emotion: ev.target.value })}>{eng.emotions.map((x) => <option key={x} value={x}>{x}</option>)}</select></span>)}
                  {tab === 'elevenlabs' && (<span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>안정성
                    <input type="number" min="0" max="1" step="0.05" style={{ width: 56 }} placeholder="0.5" value={c.stability != null ? c.stability : ''} onChange={(ev) => setCfg({ stability: ev.target.value })} />
                    유사도 <input type="number" min="0" max="1" step="0.05" style={{ width: 56 }} placeholder="0.75" value={c.similarity != null ? c.similarity : ''} onChange={(ev) => setCfg({ similarity: ev.target.value })} /></span>)}
                </div>
              )}

              {/* ③ 요금 한 줄(자세한 것은 마우스) */}
              <div data-testid="tts-price" style={{ fontSize: 12 }}
                title={tab === 'omnivoice' ? '' : [`샘플 1개 ≈ ${wonTxt(sampleUsd, krw)}`, unit && unit.kind === 'sec' ? '음성 길이로 추정(한국어 초당 약 7자)' : '글자 수 기준', unit && unit.free, unit && unit.note, `1달러 ≈ ${Math.round(krw).toLocaleString()}원`].filter(Boolean).join('\n')}>
                {tab === 'omnivoice'
                  ? <>💰 <b>무료</b> <span className="meta">(내 GPU 서버)</span></>
                  : <>💰 1만 자 ≈ <b>{wonTxt(per10k, krw)}</b>{scriptChars > 0 && <> · 지금 대본 {scriptChars.toLocaleString()}자 ≈ <b>{wonTxt(perScript, krw)}</b></>}{unit && unit.free ? <span className="meta"> · {unit.free}</span> : null}</>}
              </div>

              {/* ④ 목소리 찾기 — 검색·성별·언어 · 자주 안 쓰는 일은 ⋯ 안에 */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', position: 'relative' }}>
                {tab === 'elevenlabs' && (<span style={{ display: 'flex', gap: 2 }}>
                  <button className={elSrc === 'mine' ? '' : 'ghost'} style={{ padding: '2px 8px' }} onClick={() => setElSrc('mine')}>내 목소리</button>
                  <button data-testid="el-lib" className={elSrc === 'library' ? '' : 'ghost'} style={{ padding: '2px 8px' }} disabled={!hasKey('elevenlabs') || (!!busy && busy !== 'voices')}
                    title="ElevenLabs 보이스 라이브러리의 한국어 원어민 목소리(🔈 무료 샘플 · 고르면 내 목록에 추가)"
                    onClick={() => { setElSrc('library'); if (!libVoices) loadLibrary(); }}>🇰🇷 한국어 라이브러리</button>
                </span>)}
                <b>목소리</b><span className="meta">{shown.length}개{selVoice ? ` · ✔ ${koView(selVoice).name}` : ''}</span>
                <span style={{ flex: 1 }} />
                <input data-testid="tts-voice-q" placeholder="🔍 검색" style={{ width: 140 }} value={q} onChange={(ev) => setQ(ev.target.value)} />
                {tab !== 'omnivoice' && (<select value={fg} onChange={(ev) => setFg(ev.target.value)}><option value="">성별 전체</option><option value="male">♂ 남성</option><option value="female">♀ 여성</option></select>)}
                {langs.length > 1 && (<select data-testid="tts-voice-lang" value={lang} onChange={(ev) => setFl((x) => ({ ...x, [tab]: ev.target.value }))}><option value="">언어 전체</option>{langs.map((l) => <option key={l} value={l}>{l}</option>)}</select>)}
                {busyBatch
                  ? <button className="ghost" onClick={() => { stopRef.current = true; }}>⏹ 멈춤</button>
                  : <button className="ghost" data-testid="tts-more" title="한꺼번에 하기 · 목록 다시 받기" onClick={() => setMoreOpen((x) => !x)}>⋯</button>}
                {moreOpen && !busyBatch && (
                  <div className="tts-more" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 5, background: 'var(--bg, #fff)', border: '1px solid var(--line)', borderRadius: 8, padding: 6, boxShadow: '0 6px 18px rgba(0,0,0,0.12)', minWidth: 210 }} onClick={() => setMoreOpen(false)}>
                    {shown.length > 0 && !isLib && <button className="ghost" data-testid="tts-face-all" disabled={!!busy} title="보이는 목소리 중 얼굴이 없는 것을 🖥 로컬 ComfyUI 로(무료)" onClick={() => drawAllFaces(shown)}>🎨 얼굴 모두 그리기</button>}
                    {tab !== 'omnivoice' && shown.length > 0 && <button className="ghost" disabled={!!busy || (eng.paid && !hasKey(tab))} title="보이는 목소리 중 샘플이 없는 것을 한 번에(요금 확인 후)" onClick={() => makeAllSamples(shown)}>📦 샘플 모두 만들기</button>}
                    {(eng.listVoices || tab === 'omnivoice') && <button className="ghost" disabled={!!busy || (eng.paid && !hasKey(tab))} onClick={() => (isLib ? loadLibrary() : loadVoices(tab))}
                      title={tab === 'gemini' ? 'Google 확장 라이브러리(한국어 목소리 · 3.8 모델용)를 받습니다' : '목록을 다시 받습니다'}>{tab === 'gemini' && !isLib ? '⬇ 확장 라이브러리 받기' : '↻ 목록 다시 받기'}</button>}
                  </div>
                )}
              </div>

              {/* ⑤ 목소리 카드 — 이 칸만 스크롤 · 🔑 gridAutoRows max-content: 높이가 정해진 스크롤 격자에서 auto 행은 카드 최소 높이(92)까지만 커져 🔈 줄이 잘렸다(v0.6.84) */}
              <div data-testid="tts-voice-grid" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gridAutoRows: 'max-content', gap: 8, alignContent: 'start', paddingRight: 4 }}>
                {shown.map((v0) => { const v = koView(v0); return (
                  <VoiceCard key={v.id} v={v} sel={isSel(v)} playingNow={playing === v.id} face={(faces[tab] || {})[v.id] || (v.image ? { path: v.image } : null)} busy={busy}
                    sampled={hasSample(v)} sampleCost={tab === 'omnivoice' ? 0 : sampleUsd} krw={krw}
                    users={tab === 'omnivoice' ? [...new Set([...usersOf(v), ...(omniUsed[v.name] || []).filter((n) => !drafts[n] || drafts[n].ref === v.id)])] : usersOf(v)}
                    onPick={() => (isLib ? addFromLibrary(v0) : pickVoice(v0))} onPlay={(force) => preview(v0, force)}
                    onFacePick={() => facePick(v0)} onFaceAi={() => faceAi(v0)} onFaceClear={() => faceClear(v0)} />
                ); })}
                {!list.length && (
                  <div className="meta" style={{ gridColumn: '1 / -1', padding: 20, textAlign: 'center' }}>
                    {busy === 'voices' ? '⏳ 목소리 목록을 불러오는 중…'
                      : eng.paid && !hasKey(tab) ? '🔑 ⚙ 설정 → 🔑 API 키 에서 키를 넣으면 이 계정에서 쓸 수 있는 목소리를 모두 불러옵니다.'
                      : '목소리가 없습니다 — ⋯ → 「목록 다시 받기」를 눌러 보세요.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="meta" data-testid="tts-eng-msg" style={{ flex: 1, fontWeight: msg ? 600 : 400 }}>
            {msg || '카드를 눌러 목소리를 고르고 저장하세요 · 🔈 듣기 · 카드에 마우스를 올리면 얼굴 넣기(🖼 그림 · 🎨 그리기)'}
          </span>
          <span className="meta">{target ? (dirty[TGT] ? '● 바뀜 — 「적용」을 누르세요' : '') : Object.keys(dirty).length ? `바뀐 채널 ${Object.keys(dirty).length}개` : ''}</span>
          <button data-testid="tts-eng-save" disabled={busy === 'apply'} onClick={save}>{target ? (target.kind === 'speaker' ? `${tgtWho(target)}에 적용` : '열린 대본에 적용') : '저장'}</button>
          <button className="ghost" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

// 🎉 할인 띠 — 기간·남은 날·모델별 할인가(정가) · 지난 할인은 회색 한 줄
function PromoBanner({ p, krw, unit }) {
  const md = (d) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
  const left = Math.round((Date.parse(p.until) - Date.parse(p.today)) / 86400e3);
  const NAMES = { eleven_v4: 'v4', eleven_v4_turbo: 'v4 Turbo' };
  if (p.ended) return <div data-testid="tts-promo" className="meta" style={{ fontSize: 12, padding: '3px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.05)' }}>🎉 {p.label} — {md(p.until)}에 끝났습니다(지금은 정가로 계산)</div>;
  return (
    <div data-testid="tts-promo" title={[p.extra, p.caveat, '출처: ' + p.src].filter(Boolean).join('\n')}
      style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '7px 12px', borderRadius: 10, background: 'linear-gradient(90deg, #fff1e6, #ffe4ec)', border: '1.5px solid #f97316', color: '#9a3412' }}>
      <span style={{ fontSize: 15, fontWeight: 800 }}>🎉 {p.label}</span>
      <span style={{ fontSize: 15, fontWeight: 800, color: '#c2410c' }}>{md(p.from)} ~ {md(p.until)}</span>
      <span data-testid="tts-promo-dday" style={{ fontSize: 13, fontWeight: 800, color: '#fff', background: left <= 2 ? '#dc2626' : '#f97316', borderRadius: 12, padding: '1px 9px' }}>{left > 0 ? `D-${left}` : '오늘까지'}</span>
      <span style={{ fontSize: 12 }}>{Object.entries(p.models).map(([m, u]) => `${NAMES[m] || m} 1만 자 ${wonTxt(u * 1e4, krw)}${unit && unit[m] && unit[m].listUsd ? `(정가 ${wonTxt(unit[m].listUsd * 1e4, krw)})` : ''}`).join(' · ')}</span>
      <span className="meta" style={{ fontSize: 11 }}>ⓘ 끝나는 시각은 공지에 없음</span>
    </div>
  );
}

// 🎙 대본·클립 모드의 왼쪽 칸 — 무엇에 적용하는지 · 채널 기본 목소리 · 「채널 목소리로 되돌리기」
function TargetPane({ target, chanVoice, chosen, dirty, busy, onClear }) {
  const isSpk = target.kind === 'speaker';
  const who = tgtWho(target);
  return (
    <div data-testid="tts-target" style={{ width: 230, flex: '0 0 230px', borderRight: '1px solid var(--line)', overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontWeight: 700 }}>{isSpk ? `🗣 ${who}` : `📄 열린 대본 ${target.names.length}개에`}</div>
      {isSpk
        ? <div className="meta" style={{ fontSize: 12, lineHeight: 1.45, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: '6px 8px' }}>
            📄 {target.script}<br />{target.speaker ? `「${target.speaker}」 줄` : '내레이션'} 클립 {target.clips != null ? <b>{target.clips}개</b> : '모두'}에 적용합니다{target.speaker ? '' : '(화자 목소리가 있는 줄은 빼고)'}.
          </div>
        : <div style={{ fontSize: 12, lineHeight: 1.5 }}>{target.names.map((n) => <div key={n} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n}>· {n}</div>)}</div>}
      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        <div className="meta" style={{ fontSize: 11 }}>고른 목소리</div>
        <div data-testid="tts-target-chosen" style={{ fontWeight: 700, color: dirty ? BLUE : 'inherit' }}>{chosen.eng} · {chosen.name}{dirty ? ' ●' : ''}</div>
      </div>
      {chanVoice && <div>
        <div className="meta" style={{ fontSize: 11 }}>채널 「{target.channel}」 기본</div>
        <div style={{ fontSize: 12 }}>{chanVoice.eng} · {chanVoice.name}</div>
      </div>}
      {target.current && <div className="meta" style={{ fontSize: 11 }}>지금 {isSpk ? `이 대본의 ${who}` : '열린 대본'}은 따로 고른 목소리(<b>{target.currentText || target.current.label}</b>)로 읽습니다.</div>}
      <button className="ghost" data-testid="tts-target-clear" disabled={!target.current || busy === 'apply'} style={{ marginTop: 'auto' }}
        title={isSpk ? (target.speaker ? '이 대본의 이 화자 목소리를 지웁니다 — 채널 화자 목소리(없으면 내레이션 목소리)로 읽습니다' : '이 대본의 내레이션 목소리를 지우고 채널 기본 목소리로 읽습니다') : '열린 대본의 목소리를 지우고 채널 기본 목소리로 읽습니다'}
        onClick={onClear}>↺ {isSpk && target.speaker ? '기본 목소리로 되돌리기' : '채널 목소리로 되돌리기'}</button>
      <div className="meta" style={{ fontSize: 11, lineHeight: 1.45 }}>적용하면 이미 만든 음성 중 이 목소리로 읽을 클립은 지우고, 다음 🎤 TTS·⚡ 만들기 때 새 목소리로 만듭니다. 채널 기본은 ⚙ 채널편집 → 🎙 음성에서.</div>
    </div>
  );
}

// 얼굴 — 그림이 있으면 그것, 없으면 이름 첫 글자(성별 색)
export function Face({ face, name, gender, size = 44, square }) {
  const bg = gender === 'male' ? '#dbeafe' : gender === 'female' ? '#fce7f3' : '#e5e7eb';
  const fgc = gender === 'male' ? '#1d4ed8' : gender === 'female' ? '#be185d' : '#374151';
  const st = { width: size, height: size, flex: `0 0 ${size}px`, borderRadius: square ? 10 : '50%', objectFit: 'cover', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' };
  // 회사가 준 그림(https 주소)은 그대로, 내 PC 파일은 media://
  if (face && face.path) return <img data-testid="tts-face-img" src={/^https?:\/\//.test(face.path) ? face.path : media(face.path, face.v)} alt="" style={{ ...st, border: '1px solid var(--line)' }} />;
  // 앞 번호·기호(「02_」「#05_」)는 건너뛰고 첫 글자 — 한글을 먼저(「1nd_고전」 → 「고」)
  const nm = String(name || '');
  const ch = (nm.match(/[가-힣]/) || nm.match(/[A-Za-zぁ-んァ-ン一-龥]/) || [nm.slice(0, 1) || '?'])[0];
  return <div style={{ ...st, background: bg, color: fgc, fontWeight: 800, fontSize: Math.round(size * 0.42) }}>{ch}</div>;
}

// 카드 — 얼굴 · 이름(성별) · 언어 · 설명 2줄 · 듣기. 얼굴 버튼(🖼 🎨 ✕)은 마우스를 올렸을 때만.
function VoiceCard({ v, sel, playingNow, face, busy, sampled, sampleCost, krw, users, onPick, onPlay, onFacePick, onFaceAi, onFaceClear }) {
  const playing = busy === 'play:' + v.id;
  const meta = [v.lang, v.badge].filter(Boolean).join(' · ');
  return (
    <div role="button" tabIndex={0} className="vc" data-testid="tts-voice-card" data-voice={v.id} onClick={onPick} onKeyDown={(e) => { if (e.key === 'Enter') onPick(); }}
      style={{ border: '1.5px solid ' + (sel ? BLUE : 'var(--line)'), background: sel ? 'rgba(37,99,235,0.08)' : 'var(--bg2, transparent)', borderRadius: 10, padding: 8, cursor: 'pointer', display: 'flex', gap: 8, minHeight: 92 }}>
      <div style={{ position: 'relative', flex: '0 0 auto' }}>
        <Face face={face} name={v.base || v.name} gender={v.gender} size={48} />   {/* 첫 글자는 이름에서(번역된 소개가 아니라) */}
        <div className="vc-tools" style={{ display: 'flex', gap: 1, justifyContent: 'center', marginTop: 3 }} onClick={(e) => e.stopPropagation()}>
          <button className="ghost" style={{ padding: '0 3px', fontSize: 10 }} title="얼굴 그림 넣기(파일)" onClick={onFacePick}>🖼</button>
          <button className="ghost" style={{ padding: '0 3px', fontSize: 10 }} disabled={!!busy && busy !== 'play:' + v.id} title="AI 로 얼굴 그리기(🖥 로컬 ComfyUI · 무료)" onClick={onFaceAi}>{busy === 'face:' + v.id ? '⏳' : '🎨'}</button>
          {face && <button className="ghost" style={{ padding: '0 3px', fontSize: 10 }} title="얼굴 지우기" onClick={onFaceClear}>✕</button>}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* 🔑 줄마다 flexShrink 0 — 줄이 줄어들 수 있으면 카드가 최소 높이(92)에 머물고 언어 줄이 0px 로 눌렸다(v0.6.84 · 로이 캡처) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span style={{ fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.orig ? v.name + '\n\n원문:\n' + v.orig : v.id}>{sel ? '✔ ' : ''}{v.name}</span>
          {G_ICON[v.gender] && <span title={v.gender} style={{ opacity: 0.7 }}>{G_ICON[v.gender]}</span>}
        </div>
        {meta && <div className="meta" style={{ fontSize: 11, lineHeight: '15px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</div>}
        {/* 설명은 첫 줄만(v0.6.85 · 로이 「글자가 너무 많다」) — 전체는 마우스를 올리면 */}
        {v.desc && <div className="meta" data-testid="tts-voice-desc" style={{ fontSize: 11, lineHeight: '15px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'help' }} title={v.orig ? v.desc + '\n\n원문:\n' + v.orig : v.desc}>{v.desc}</div>}
        <div style={{ marginTop: 'auto', paddingTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          {/* 🔈 아이콘 버튼(글자 없음 — 좁은 카드에서 「듣기」가 두 줄로 깨졌다 · 로이 2026-10-05) · 요금은 옆에 작게 */}
          <button className="ghost" data-testid="tts-voice-play" aria-label="샘플 듣기"
            style={{ flex: '0 0 auto', width: 34, height: 28, padding: 0, fontSize: 16, lineHeight: '26px', borderRadius: 14, whiteSpace: 'nowrap' }}
            title={playingNow ? '멈춤' : sampled ? '샘플 듣기(저장됨 · 무료) — 듣는 중에 다시 누르면 멈춤 · Shift+클릭 = 다시 만들기' : `샘플 만들어 듣기(약 ${wonTxt(sampleCost, krw)} · 한 번 만들면 저장)`}
            onClick={(e) => onPlay(e.shiftKey)}>{playingNow ? '⏹' : playing ? '⏳' : '🔈'}</button>
          {!sampled && sampleCost > 0 && <span className="meta" style={{ fontSize: 10, whiteSpace: 'nowrap', flex: '0 0 auto' }}>{wonTxt(sampleCost, krw)}</span>}
          {users && users.length > 0 && <span style={{ fontSize: 10, color: BLUE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 auto' }} title={'이 목소리를 쓰는 채널: ' + users.join(', ')}>📺 {users.length > 1 ? `${users[0]} 외 ${users.length - 1}` : users[0]}</span>}
        </div>
      </div>
    </div>
  );
}
