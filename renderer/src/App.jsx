import React, { useEffect, useRef, useState, useCallback } from 'react';
import api from './lib/ipc.js';
import { splitLines, mLen } from './lib/captions.js';
import BookView from './BookView.jsx';
import RemotionView from './RemotionView.jsx';

const media = (p) => 'media://' + encodeURIComponent(p);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ComfyUI = 드롭다운에서 **모델(워크플로)까지 직접 고른다** (로이 2026-08-14).
//   예전엔 「ComfyUI 로컬/클라우드」 2개만 두고 모델은 ⚙ 설정 팝업에서 골랐는데, 팝업을 열어야 해서 번거로웠다.
//   이제 로컬/클라우드를 optgroup 으로 묶고 그 아래에 LTX2.5·LTX2.3(이미지는 Krea2·Z-Image)를 나열한다.
//   · select 값 = `comfy::<local|cloud>::<워크플로 경로>` (표시 전용)
//   · **저장되는 엔진 값 = `comfy::<워크플로 경로>`** — 로컬/클라우드(주소)는 설정파일이 단일 진실이라
//     값에 중복해 넣지 않는다. main.js 는 이미 `comfy::<path>` 를 인식한다.
const DEF_LOCAL_URL = 'http://127.0.0.1:8188';
const DEF_CLOUD_URL = 'https://cloud.comfy.org';
const isComfyEngine = (v) => v === 'comfy' || String(v || '').indexOf('comfy::') === 0;
const comfyWfPath = (v) => (String(v || '').indexOf('comfy::') === 0 ? String(v).slice(7) : '');
const mkComfyVal = (cloud, wfPath) => `comfy::${cloud ? 'cloud' : 'local'}::${wfPath || ''}`;
// select 값 → { cloud, path }. 모드가 없는 레거시 `comfy::<path>` 도 받는다(cloud=null).
function parseComfyVal(v) {
  if (String(v || '').indexOf('comfy::') !== 0) return null;
  const rest = String(v).slice(7);
  const m = /^(local|cloud)::([\s\S]*)$/.exec(rest);
  return m ? { cloud: m[1] === 'cloud', path: m[2] } : { cloud: null, path: rest };
}
// 워크플로 목록 — 설정의 workflows[] + (목록에 없는) 현재 활성 워크플로. 활성이 목록에 없으면
//   select 값과 일치하는 option 이 없어 드롭다운이 빈칸으로 보이므로 반드시 채워 넣는다.
function comfyWorkflows(cfg) {
  const list = ((cfg && cfg.workflows) || []).filter((w) => w && w.path);
  const cur = (cfg && cfg.workflowPath) || '';
  if (cur && !list.some((w) => w.path === cur)) list.push({ name: (cur.split(/[\\/]/).pop() || '워크플로').replace(/\.json$/i, ''), path: cur });
  return list;
}
// select 에 표시할 값 — comfy 면 (설정의 cloud 여부) × (항목에 저장된 워크플로 ‖ 설정의 활성 워크플로).
const comfySelectValue = (engine, cfg) => (isComfyEngine(engine)
  ? mkComfyVal(!!(cfg && cfg.cloud), comfyWfPath(engine) || ((cfg && cfg.workflowPath) || ''))
  : engine);

// ⚙ 설정 팝업의 「워크플로」 행 — **선택이 아니라 관리(추가·삭제)** 전용.
//   모델 선택은 헤더 드롭다운이 하므로(2026-08-14), 여기 select 를 두면 "어느 쪽이 진짜인지" 헷갈린다.
function WorkflowManageRow({ cfg, kind, onAdd, onRemove }) {
  const wfs = comfyWorkflows(cfg);
  const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 4px 2px 9px', border: '1px solid var(--line)', borderRadius: 14, fontSize: 12 };
  return (<div className="frow" style={{ alignItems: 'flex-start' }}><label>워크플로</label>
    <div style={{ flex: 1, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {!wfs.length && <span className="meta">— 없음 (＋추가로 등록) —</span>}
      {wfs.map((w) => (
        <span key={w.path} style={chip} title={w.path}>{w.name}
          <button className="ghost" style={{ padding: '0 4px', lineHeight: 1.4 }} title={`"${w.name}" 을 목록에서 제거 (파일은 안 지웁니다)`} onClick={() => onRemove(w.path)}>🗑</button>
        </span>
      ))}
      <button className="ghost" title="ComfyUI '저장(API 포맷)' JSON 추가 (이름 지정)" onClick={onAdd}>＋ 추가</button>
    </div>
  </div>);
}


// ⚙ 설정 — ComfyUI 「어디로 보낼까」 **2분할 패널** (이미지·비디오 공용 1벌).
//   🔑 여기서는 **주소·API 키만** 관리한다. 로컬↔클라우드 전환은 **헤더 드롭다운(☁/🖥 × 모델) 하나로만.**
//     예전엔 이 팝업에도 「클라우드」 체크박스 + 「서버 프로필」 이 있어 헤더와 같은 값을 두 곳에서 만졌다 →
//     실제로 **"서버=comfy.org 인데 주소는 127.0.0.1"** 인 어긋난 상태가 만들어졌다(2026-08-20 로이 지적).
//     v0.3.2 에서 워크플로 select 를 관리 전용으로 바꾼 것과 같은 정리다.
//   설정파일이 로컬·클라우드 주소를 각각 기억하므로(localBaseUrl/cloudBaseUrl) 두 칸을 그대로 보여주면 된다.
//   ⚠ 엔진이 실제로 쓰는 값은 `baseUrl` 이므로, **지금 쓰는 쪽을 고칠 때만** baseUrl 도 같이 갱신한다.
function ComfyTargets({ cfg, setCfg, save, kind, probes, onProbe }) {
  const cloud = !!cfg.cloud;
  // 이름은 comfyWorkflows() 가 만든 목록에서 가져온다 — 활성 경로가 목록에 없어도 보강해 주므로 경로 파싱을 중복하지 않는다.
  const wfName = (comfyWorkflows(cfg).find((w) => w.path === cfg.workflowPath) || {}).name || "";
  const hdr = kind === "video" ? "③ 비디오" : "② 이미지";
  const Lamp = ({ side }) => {
    const st = probes && probes[side];
    if (!st) return <span className="lamp idle">● 미확인</span>;
    if (st.ing) return <span className="lamp ing">● 확인 중…</span>;
    if (st.ok) return <span className="lamp ok" title={st.baseUrl}>● 연결됨{st.version ? <> · <b>{st.version}</b></> : null}</span>;
    return <span className="lamp no" title={(st.baseUrl || "") + " " + (st.error || "")}>● 안 됨 — {st.error || "실패"}</span>;
  };
  // 한 칸(로컬/클라우드) — 주소(+키) 입력과 실측 버튼. 지금 쓰는 쪽은 테두리·배지로 표시.
  const pane = (side) => {
    const isCloud = side === "cloud";
    const on = isCloud === cloud;
    const url = (isCloud ? cfg.cloudBaseUrl : cfg.localBaseUrl) || "";
    return (
      <div className={"tpane" + (on ? " on" : "")}>
        <div className="thead">{isCloud ? "☁ 클라우드(comfy.org)" : "🖥 로컬(내 PC)"}{on && <span className="use">지금 사용</span>}</div>
        <input value={url} placeholder={isCloud ? "https://cloud.comfy.org" : "http://127.0.0.1:8188"}
          title={isCloud ? "comfy.org 클라우드 주소 (보통 그대로 두면 됩니다)" : "내 PC 에서 도는 ComfyUI 주소. 다른 PC 면 그 PC 의 IP:8188"}
          onChange={(e) => setCfg({ ...cfg, [isCloud ? "cloudBaseUrl" : "localBaseUrl"]: e.target.value })}
          onBlur={() => {
            const u = (url || "").trim();
            // 지금 쓰는 쪽을 고쳤으면 엔진이 읽는 baseUrl 까지 함께 갱신(안 하면 화면과 실제가 갈라진다)
            save(isCloud ? { cloudBaseUrl: u, ...(cloud ? { baseUrl: u } : {}) }
                         : { localBaseUrl: u, ...(cloud ? {} : { baseUrl: u }) });
          }} />
        {isCloud && <input type="password" value={cfg.apiKey || ""} placeholder="🔑 X-API-Key (Standard+ 구독)"
          title="cloud.comfy.org 의 API 키. 이 키가 없으면 클라우드로는 생성할 수 없습니다."
          onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
          onBlur={() => save({ apiKey: (cfg.apiKey || "").trim() })} />}
        <div className="tfoot">
          <button className="ghost" title="이 주소에 실제로 요청을 보내 확인합니다(설정은 바뀌지 않습니다)"
            onClick={() => onProbe(side, { baseUrl: (url || "").trim(), apiKey: isCloud ? (cfg.apiKey || "").trim() : "" })}>🔌 테스트</button>
          <Lamp side={side} />
        </div>
      </div>
    );
  };
  // 칸 수는 **COMFY_SIDES 하나로** 결정한다(2026-08-20 오후 — 로이 "비디오에서 로컬 LTX2.5도 추가해줘"로
  //   그날 오전에 없앴던 로컬 칸을 되살렸다). 예전엔 여기와 COMFY_SIDES **두 곳**을 맞춰 고쳐야 해서
  //   한쪽만 고치면 "드롭다운엔 있는데 주소칸이 없다" 같은 어긋남이 생겼다 → 진입점을 하나로 묶었다.
  const localAllowed = (COMFY_SIDES[kind] || [true, false]).includes(false);
  return (<>
    <div className="nowuse">
      <span>지금 보내는 곳 <b>{cloud ? "☁ 클라우드(comfy.org)" : "🖥 로컬(내 PC)"}</b>{wfName ? <> · 모델 <b>{wfName}</b></> : <> · <span className="meta">워크플로 없음</span></>}</span>
      <span className="meta">— 바꾸려면 헤더 「{hdr}」 드롭다운에서 ☁/🖥 × 모델을 고르세요(여기선 주소·키만 관리).</span>
    </div>
    {localAllowed
      ? <div className="split2">{pane("local")}{pane("cloud")}</div>
      : <div className="split2 one">{pane("cloud")}</div>}
  </>);
}

// 렌더 중 예외가 나면 React 는 트리를 통째로 버린다 → 화면이 그대로 멈춘 것처럼 보이고
//   클릭·입력이 전부 안 먹는다(2026-08-14 "대본수정 창에서 아무것도 안 됨" 제보). 원인을 화면에 남긴다.
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    const where = String((info && info.componentStack) || '').trim().split(/\r?\n/)[0] || '';
    try { window.__logline && window.__logline(`🐞 화면 오류: ${(err && err.message) || err} ${where}`); } catch (_) {}
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (<div style={{ padding: 16, margin: 12, border: '1px solid #c0392b', borderRadius: 8, background: '#fff5f5', color: '#c0392b', fontSize: 13 }}>
      <b>🐞 화면 오류로 이 영역을 그릴 수 없습니다.</b>
      <div style={{ margin: '6px 0', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>{String(this.state.err && this.state.err.message)}</div>
      <button className="ghost" onClick={() => this.setState({ err: null })}>다시 시도</button>
    </div>);
  }
}

// 헤더 드롭다운에 어느 쪽(☁ 클라우드 / 🖥 로컬)을 보여줄지 — **이 배열이 유일한 스위치**다.
//   ⚙ 설정의 주소칸(ComfyTargets.localAllowed)도 이걸 읽으므로 여기만 고치면 화면 전체가 따라온다.
//   비디오 로컬: 2026-08-20 오전에 뺐다가(LTX 22B 는 3060 에서 못 돈다) 같은 날 오후 로이 요청으로 복구.
//   ⚠ 로컬로 i2v 를 보내려면 **그 PC ComfyUI 에 워크플로가 요구하는 모델 파일이 있어야** 한다
//     (LTX2.5 = unet ltx-2.5-22b-* · clip gemma4-12b-with-proj-ltx-2.5-* · vae ltx-2.5-*-vae-*).
//     없으면 comfy-models 가 「그 서버에 있는 것: …」 을 붙여 사람 말로 알려 준다.
const COMFY_SIDES = { image: [true, false], video: [true, false] };
function ComfyEngineOptions({ cfg, kind = 'image' }) {
  const suffix = kind === 'video' ? ' i2v' : '';
  const wfs = comfyWorkflows(cfg);
  if (!wfs.length) return <option value={mkComfyVal(true, '')}>ComfyUI{suffix} — 워크플로 없음(⚙ 에서 추가)</option>;
  return (<>
    {(COMFY_SIDES[kind] || [true, false]).map((cloud) => (
      <optgroup key={cloud ? 'c' : 'l'} label={`ComfyUI ${cloud ? '클라우드' : '로컬'}${suffix}`}>
        {/* 접힌 상태에선 optgroup 라벨이 안 보이므로 ☁/🖥 로 어느 쪽인지 드러낸다 */}
        {wfs.map((w) => <option key={(cloud ? 'c' : 'l') + w.path} value={mkComfyVal(cloud, w.path)}>{cloud ? '☁' : '🖥'} {w.name}</option>)}
      </optgroup>
    ))}
  </>);
}
const CAP_POS_OPTIONS = [0.3, 0.15, 0, -0.15, -0.3]; // 상하위치 select 값 (capFine 으로 미세조정)
// yOffset → {pos, fine} (가장 가까운 select 옵션 + 미세조정)
function decomposeYOffset(yOffset) {
  let best = CAP_POS_OPTIONS[0];
  for (const o of CAP_POS_OPTIONS) if (Math.abs(o - yOffset) < Math.abs(best - yOffset)) best = o;
  return { pos: String(best), fine: Math.round((yOffset - best) / 0.0025) };
}
const yOffsetOf = (cap) => (parseFloat(cap.pos) || 0) + (parseFloat(cap.fine) || 0) * 0.0025;

// 초 → 보기 좋은 시간 ('12.3s' 또는 '1:23'). 0 이하는 '–'.
function fmtSec(s) {
  s = Number(s) || 0;
  if (s <= 0) return '–';
  return s < 60 ? s.toFixed(1) + 's' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
}
// 타임스탬프 → "7월 18일 오전 11:08" — 한도 재설정(생성 가능) 시각 표시용.
function fmtKoTime(ts) {
  const d = new Date(ts);
  const ap = d.getHours() < 12 ? '오전' : '오후';
  let h = d.getHours() % 12; if (h === 0) h = 12;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${ap} ${h}:${String(d.getMinutes()).padStart(2, '0')}`;
}
// 초 → "N분 N초" (1시간 이상이면 "N시간 N분 N초"). 합계 표시용.
function fmtMinSec(s) {
  s = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}시간 ${m}분 ${sec}초` : `${m}분 ${sec}초`;
}
// ── 유튜브 설명글 타임스탬프(챕터) ─────────────────────────────────────────
//  .vrew 타임라인은 문장 TTS 를 빈틈 없이 이어 붙인 것이므로(vrew-builder), 챕터 시작시각 =
//  그 앞 그룹들의 TTS 길이 합. 챕터 단위는 **상위 H2 섹션**(cut.h2) — H3 단위로 잘게 쪼갠 그룹을
//  다시 H2 로 묶는다. H2 가 없는 대본은 그룹 섹션명(phase)으로 폴백.
function tsFmt(sec) {
  const t = Math.max(0, Math.floor(Number(sec) || 0)); // 올림하면 챕터가 내용보다 뒤에서 시작한다 → 내림
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
}
// 섹션 제목의 제작 표기 꼬리 제거 — `— 0:00~0:30 · I2V 5샷` / `(0:30~3:50)` / ` ★`
function tsCleanTitle(t) {
  return String(t == null ? '' : t)
    .replace(/\s*[—-]\s*\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}.*$/, '')
    .replace(/\s*\(\s*\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}\s*\)\s*$/, '')
    .replace(/\s*★/g, '')
    .replace(/\s*[〔\[(][^〕\])]*(?:\d+\s*(?:샷|초|자|s)|I2V|콜드오픈|후킹)[^〕\])]*[〕\])]\s*$/, '') // 꼬리 제작메모 〔콜드오픈 · 5샷 · I2V〕
    .replace(/\s+/g, ' ')
    .trim();
}
// 한 편(project) → 챕터 목록 [{start, dur, title}]
function tsChaptersOf(pr) {
  const cuts = (pr && pr.cuts) || [];
  const useH2 = cuts.some((c) => c.h2 && String(c.h2).trim());
  const out = [];
  let t = 0, lastKey = '';
  for (const c of cuts) {
    const key = tsCleanTitle(useH2 ? c.h2 : c.phase) || lastKey; // 제목 없는 그룹은 앞 챕터에 붙인다
    const dur = Number(c.groupDurationSec) || 0;
    if (!out.length || key !== lastKey) out.push({ start: t, dur, title: key || '시작' });
    else out[out.length - 1].dur += dur;
    lastKey = key;
    t += dur;
  }
  return out;
}
// dto → { text(붙여넣기용), total, warns[] }
function tsBuild(dto) {
  const projects = (dto && dto.projects) || [];
  const lines = [], warns = [];
  let total = 0, missing = 0, shortN = 0, chapN = 0;
  for (const pr of projects) {
    for (const c of (pr.cuts || [])) for (const st of (c.sentences || [])) if (!(Number(st.dur) > 0)) missing++;
    const chs = tsChaptersOf(pr);
    chapN += chs.length;
    for (const ch of chs) {
      if (ch.dur < 10) shortN++;
      lines.push(`${tsFmt(ch.start)} ${ch.title}`);
    }
    total += chs.reduce((a, ch) => a + ch.dur, 0);
  }
  if (missing > 0) warns.push(`TTS 가 아직 없는 문장 ${missing}개 — 그만큼 시간이 실제보다 짧습니다. TTS 변환을 끝낸 뒤 다시 여세요.`);
  if (chapN < 3) warns.push('챕터가 3개 미만입니다 — 유튜브는 챕터를 3개 이상일 때만 인식합니다.');
  if (shortN > 0) warns.push(`10초 미만 챕터 ${shortN}개 — 유튜브가 목록 전체를 무시할 수 있습니다(각 챕터 10초 이상 필요).`);
  return { text: lines.join('\n'), total, warns };
}
function phaseBadge(p) {
  if (!p) return ['', '-'];
  return ['', p];   // 섹션 제목 그대로 (키워드 축약 안 함 — '본론 진입'이 '본론'으로 잘못 표시되던 문제)
}

const QSTATUS = { idle: '대기', running: '진행중', done: '완료', failed: '실패' };

// 스타일 편집 모달의 한 행 — 기본 스타일은 읽기전용(복사만), 사용자 스타일은 이름·프롬프트 수정/삭제.
function StyleRow({ s, index, total, onCopy, onSave, onDelete, onMove }) {
  const [name, setName] = useState(s.name);
  const [prompt, setPrompt] = useState(s.prompt);
  useEffect(() => { setName(s.name); setPrompt(s.prompt); }, [s.id]);
  const dirty = name !== s.name || prompt !== s.prompt;
  return (
    <div style={{ border: '1px solid var(--border,#ddd)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <button className="ghost" title="위로" style={{ padding: '0 5px', lineHeight: 1.1 }} disabled={index === 0} onClick={() => onMove(s.id, 'up')}>▲</button>
          <button className="ghost" title="아래로" style={{ padding: '0 5px', lineHeight: 1.1 }} disabled={index === total - 1} onClick={() => onMove(s.id, 'down')}>▼</button>
        </span>
        {s.isBuiltIn
          ? <b style={{ flex: 1 }}>{s.name} <span className="meta" style={{ fontWeight: 400 }}>(기본 · 읽기전용)</span></b>
          : <input style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="스타일 이름" />}
        <button className="ghost" title="이 스타일의 프롬프트 복사" onClick={() => onCopy(prompt)}>📋 복사</button>
        {!s.isBuiltIn && <button title="저장" disabled={!dirty} onClick={() => onSave(s.id, name, prompt)}>저장</button>}
        {!s.isBuiltIn && <button className="ghost" title="삭제" onClick={() => onDelete(s.id, s.name)}>🗑</button>}
      </div>
      {s.isBuiltIn
        ? <textarea readOnly value={prompt} rows={2} style={{ width: '100%', resize: 'vertical', opacity: 0.85 }} />
        : <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical' }} placeholder="영문 스타일 프롬프트" />}
    </div>
  );
}

// 🔒 네이티브 alert/confirm 은 **창을 잠근다**(EnableWindow(false)) — 다른 창(Vrew·크롬) 뒤에 숨으면
//   앱이 클릭·키·ESC 를 전부 거부하는 "입력 잠김"이 된다(로이 2026-08-14 증상).
//   → 띄우기 직전에 창을 앞으로 끌어와 숨지 못하게 한다. main 은 별도 프로세스라 이 요청을 즉시 처리한다.
function uiConfirm(msg) { try { api.focusWindow(); } catch (_) {} return window.confirm(msg); }
function uiAlert(msg) { try { api.focusWindow(); } catch (_) {} return window.alert(msg); }

export default function App() {
  const [mode, setMode] = useState('longform'); // 'longform'(주 사용) | 'book'(출판)
  const isLf = mode === 'longform';
  const isBk = mode === 'book';
  const isRx = mode === 'remotion';   // 🎬 리모션 — 음성(mp3)만 만드는 모드
  // 제작 파이프라인(대본 열기·①음성~④완성·자막 분할바)이 **없는** 모드.
  // 🔑 세 곳을 각각 `!isBk` 로 적으면 모드가 늘 때 반드시 한 곳을 빠뜨린다 → 플래그 하나로 묶는다.
  const noProduction = isBk || isRx;
  const [dto, setDto] = useState(null);
  const [queue, setQueue] = useState(null); // 현재 모드 작업 큐(적재 대본 목록) — main 의 queueDTO
  const [presets, setPresets] = useState([]);
  const [chOrderOpen, setChOrderOpen] = useState(false); // 채널 순서 변경 모달
  const [chOrder, setChOrder] = useState([]);            // 편집 중인 순서 [{name, group}]
  const [styles, setStyles] = useState([]);

  // 헤더 컨트롤
  const [presetName, setPresetName] = useState('');
  const [styleId, setStyleId] = useState('chibi');
  const [imgEngine, setImgEngine] = useState('genspark'); // 'genspark'|'flow'(무료 브라우저 · 한도면 서로 이어받음)|'gemini'|'comfy[::경로]'
  const [videoEngine, setVideoEngine] = useState('grok'); // 'grok' | 'none' — Grok i2v 또는 이미지만
  const [vidFrom, setVidFrom] = useState(1);   // I2V 범위 시작 그룹
  const [vidTo, setVidTo] = useState(1);        // I2V 범위 끝 그룹 (롱폼 기본=도입부 끝)
  // 항목 복원(applySettings) 중엔 기본값 effect 들이 항목별 저장값을 덮어쓰지 않게 하는 가드.
  //   hasStoredRangeRef: 이 항목에 저장된 영상범위가 있으면 범위 기본값 계산을 건너뜀.
  //   restoringItemRef: 항목 복원 중이면 프리셋/모드 기본값(배속·스타일·AI고지) 덮어쓰기를 건너뜀.
  const hasStoredRangeRef = useRef(false);
  const restoringItemRef = useRef(false);
  const [timings, setTimings] = useState({ tts: 0, image: 0, video: 0, make: 0 }); // 작업 소요시간(초)
  const [flowVideoModel, setFlowVideoModel] = useState('Veo 3.1 - Lite');
  const [flowCount, setFlowCount] = useState('1x');
  const [upscale, setUpscale] = useState(false);

  // 자막/음성 — 초기값은 롱폼 기준(주 사용 모드). 마운트 시 mode-profiles 로 재확정.
  const [capSize, setCapSize] = useState('100');
  const [capPos, setCapPos] = useState('-0.15');
  const [capFine, setCapFine] = useState(10);
  const [capAlign, setCapAlign] = useState('start');
  const [capYAlign, setCapYAlign] = useState('bottom'); // 세로 기준 (middle/bottom/top)
  const [ttsSpeed, setTtsSpeed] = useState('1.15');
  const [aiNotice, setAiNotice] = useState(false); // AI 고지 — 작업바 체크박스(기본 ON, 마운트 시 세팅)
  const [openEachVrew, setOpenEachVrew] = useState(true); // 큐 순차제작: 대본 완료 때마다 그 .vrew 자동 열기(ON) / 끝에 폴더만 1번(OFF). 기본 ON
  const [modeProfiles, setModeProfiles] = useState(null); // mode-profiles.js (음성배속 등 모드 기본값 출처)
  // 롱폼 분할옵션(도입부/본론/짧은/긴) — 프리셋에서 초기화, capbar 패널에서 조절 시 재분할.
  const [splitOpts, setSplitOpts] = useState({ intro: 3, main: 10, short: 10, long: 20, mode: 'h3' });

  const [ftitle, setFtitle] = useState('');
  const [status, setStatus] = useState('');
  const [autoSavedAt, setAutoSavedAt] = useState(0); // 마지막 자동저장 시각(ms)
  const [appVersion, setAppVersion] = useState(''); // 앱 버전 (타이틀 표시)
  const [gsCool, setGsCool] = useState(null); // Genspark 한도 쿨다운 {until, label} — 재설정 시각(재시작해도 유지)
  const [grokCool, setGrokCool] = useState(null); // Grok(영상) 한도 쿨다운 {until, label}
  const [gsBatch, setGsBatch] = useState(null); // 나노바나나2 배치 상태 {hasJob, job} — 현재 대본의 미회수 배치
  const [comfyOpen, setComfyOpen] = useState(false);
  const [comfyCfg, setComfyCfg] = useState(null); // ComfyUI(z-image) 설정
  const [cvidOpen, setCvidOpen] = useState(false);
  const [cvidCfg, setCvidCfg] = useState(null); // ComfyUI 비디오(i2v LTX) 설정
  const [settingsOpen, setSettingsOpen] = useState(false); // 통합 설정 팝업(ComfyUI 이미지·비디오 · API키 · TTS서버)
  const [settingsMsg, setSettingsMsg] = useState('');      // 연결테스트 결과 — 로그창이 아니라 팝업 안에서 바로 보이게
  const [settingsTab, setSettingsTab] = useState('img');   // 'img' | 'vid' | 'keys' | 'tts'
  // 👤 계정 탭 — {genspark|flow|grok: {dailyCap, accounts:[{id,label,used,creds,login}]}}
  const [acct, setAcct] = useState(null);
  const [acctEdit, setAcctEdit] = useState({});   // 입력 중인 아이디/비번 (비번은 저장 후 즉시 비움)
  const [credsOk, setCredsOk] = useState(true);   // OS 암호화 가능 여부
  const [findOpen, setFindOpen] = useState(false);       // 화면 내 검색 바(Ctrl+F)
  const [findRes, setFindRes] = useState({ active: 0, total: 0 });
  const findTimerRef = useRef(null);                     // 검색 디바운스 타이머
  // 🔴 큐 순회용 중단 플래그 — main 의 S.abort 는 렌더러가 볼 수 없어서, 큐 루프가 중단을 모른 채
  //    다음 대본을 계속 시작했다(실측 2026-08-21: 0826 중단 → 0827·0828 이 이어서 시작됨).
  //    state 가 아니라 ref 인 이유: setState 는 비동기라 실행 중인 루프에 즉시 보이지 않는다.
  const queueAbortRef = useRef(false);
  const [logText, setLogText] = useState('');
  const [logCollapsed, setLogCollapsed] = useState(true); // 최소화로 시작 — 로그바 클릭 시 펼침

  // 모달/플레이어 상태
  const [chOpen, setChOpen] = useState(false);
  const [chTab, setChTab] = useState('basic'); // 채널편집 탭 (basic·voice·caption·tools·folder)
  // 채널 설정이 저장될 때마다 +1 — 채널 값을 읽어 쓰는 화면이 이걸 보고 다시 읽는다.
  const [presetRev, setPresetRev] = useState(0);
  const [ch, setCh] = useState(null);          // 편집 중 프리셋 폼
  const [newChanOpen, setNewChanOpen] = useState(false); // 새 채널 이름 입력 모달
  const [newChanName, setNewChanName] = useState('');
  const [chStyles, setChStyles] = useState([]);
  const [chRefList, setChRefList] = useState([]); // 참조음성 파일 목록
  const [tsOpen, setTsOpen] = useState(false);   // ⏱ 유튜브 타임스탬프(챕터) 모달
  const [tsData, setTsData] = useState(null);    // { text, total, warns } — 열 때 계산
  const tsRef = useRef(null);                    // 편집 가능한 textarea (복사는 여기서 읽는다)
  const [impOpen, setImpOpen] = useState(false);
  const [impText, setImpText] = useState('');
  const [impProvider, setImpProvider] = useState('ollama');
  const [impBusy, setImpBusy] = useState(false);
  const [preview, setPreview] = useState(null); // { kind, src }
  const [playerOpen, setPlayerOpen] = useState(false);
  const [scriptEditOpen, setScriptEditOpen] = useState(false);
  const impRef = useRef(null);          // 붙여넣기 textarea (비제어)
  const scriptEditRef = useRef(null);   // 대본수정 textarea (비제어 — 재렌더 방지)
  const findTextRef = useRef('');        // 검색어 (비제어)
  const [scriptText, setScriptText] = useState('');
  const [styleEditOpen, setStyleEditOpen] = useState(false); // 이미지 스타일 편집 모달
  const [styleSync, setStyleSync] = useState('');            // ☁ 공용 스타일 동기화 상태/경고
  const [newStyle, setNewStyle] = useState({ name: '', prompt: '' }); // 새 스타일 입력 버퍼
  const [dictOpen, setDictOpen] = useState(false);   // 발음사전 모달
  // 🎨 보이스디자인(Qwen3-TTS) 모달
  const [vdOpen, setVdOpen] = useState(false);
  const [vdInstruct, setVdInstruct] = useState('');
  // 기본 문장을 길게 둔다(약 10초) — 끝의 감쇠 구간을 잘라내고도 참조음성으로 쓸 5초가 남도록.
  const [vdText, setVdText] = useState('안녕하세요. 오늘은 아주 흥미로운 역사 이야기를 들려드리겠습니다. 오래전 이 땅에 살았던 사람들의 이야기를, 차분한 목소리로 하나씩 풀어 보겠습니다.');
  const [vdStatus, setVdStatus] = useState('');
  const [vdBusy, setVdBusy] = useState(false);
  const [vdReady, setVdReady] = useState(false);         // 디자인 서버 준비 완료 여부 — 준비 전엔 '목소리 생성' 잠금
  const [vdSrv, setVdSrv] = useState('');                // 보이스디자인 서버 주소(빈값=이 PC 로컬 실행)
  const [vdWavUrl, setVdWavUrl] = useState('');
  const [vdGenerated, setVdGenerated] = useState(false);
  const [vdFilename, setVdFilename] = useState('');
  // ✂ 슬라이스 — 보이스디자인 음성은 **끝이 서서히 작아진다**(모델 특성). 그 구간이 참조음성에 들어가면
  //   합성한 문장 끝이 계속 끊기는 느낌이 난다 → 길게 만들고 쓸 구간만 잘라 저장한다(로이 2026-08-14).
  const [vdDur, setVdDur] = useState(0);              // 생성된 원본 길이(초)
  const [vdSel, setVdSel] = useState({ s: 0, e: 0 }); // 저장할 구간(초)
  const [vdPeaks, setVdPeaks] = useState(null);       // 파형 그리기용 [{min,max}...]
  const [vdRefText, setVdRefText] = useState('');     // 잘라낸 구간에 실제로 들리는 말 = 저장될 참조텍스트
  const vdCanvasRef = useRef(null);
  const vdAudioRef = useRef(null);
  const [dictRows, setDictRows] = useState([]);       // [{source, pron, enabled}]
  const [ollamaOpen, setOllamaOpen] = useState(false);
  const [ollama, setOllama] = useState(null);           // { baseUrl, model }
  const [ollamaModels, setOllamaModels] = useState([]); // 서버에 설치된 모델 목록
  const [promptView, setPromptView] = useState(null);   // 그룹 프롬프트 보기 { label, image, video, motion }
  const [finalPrompt, setFinalPrompt] = useState(null); // 실제 전송되는 최종 프롬프트(스타일·네거티브 포함) — main 이 계산
  const [imgRot, setImgRot] = useState(null);            // { order:[], enabled:{} } 이미지 순환 설정
  const [upCfg, setUpCfg] = useState(null);              // 영상 업스케일 방식 { mode, slowLimitSec }
  const [giCfg, setGiCfg] = useState(null);              // Nano Banana 2 Lite (Gemini 이미지 API) 설정
  const [giKey, setGiKey] = useState('');                // Gemini API 키(이미지 설정 팝업에서 입력) — secret-store 공용
  const [xaiVal, setXaiVal] = useState('');              // xAI(Grok API) 키 — 통합 설정 팝업 '키' 탭
  const [ttsSrvOpen, setTtsSrvOpen] = useState(false);   // TTS 서버 주소(OmniVoice) 설정 모달
  const [ttsSrv, setTtsSrv] = useState({ omnivoice: { baseUrl: '' } });
  const [nameAsk, setNameAsk] = useState(null);          // 이름 입력 모달 { title, value, resolve } — window.prompt 대체(Electron 미지원)
  const [lora, setLora] = useState(null);                // LoRA 수집 설정 { enabled, dir, trigger, count }

  const logRef = useRef(null);
  const previewAudioRef = useRef(null);   // 미리듣기 오디오 1개만 재생(새로 누르면 이전 것 정지)
  function playPreviewUrl(url) {
    try { if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current.currentTime = 0; } } catch {}
    if (!url) return;
    const a = new Audio(url);
    previewAudioRef.current = a;
    a.play().catch(() => {});
  }
  const loaded = !!(dto && ((dto.projects && dto.projects.length) || dto.kind === 'book'));
  // 통합대본('> 📥 자산출처:' 메타)의 소스 개수 — 0 이면 「📥 이어받기」 버튼을 아예 안 그린다.
  const mergeSources = (dto && dto.mergeSources) || 0;

  // 자막 한 줄 글자수 — 분할옵션의 '긴 n자'(longLen) 기준.
  const effCap = Math.max(2, parseInt(splitOpts.long, 10) || 20);
  // 제작 진행률(완료/전체) — TTS(문장 audio) · 이미지(group imagePath) · 영상(I2V 그룹 videoPath). PrimingFlow 진행률 패널 이식.
  const prog = (() => {
    let ttsD = 0, ttsT = 0, imgD = 0, imgT = 0, vidD = 0, vidT = 0;
    for (const pr of ((dto && dto.projects) || [])) {
      for (const c of (pr.cuts || [])) {
        const sents = c.sentences || [];
        ttsT += sents.length; ttsD += sents.filter((s) => s.audio).length;
        imgT += 1; if (c.imagePath) imgD += 1;
        if (c.isI2V || c.videoPrompt) { vidT += 1; if (c.videoPath) vidD += 1; }
      }
    }
    return { ttsD, ttsT, imgD, imgT, vidD, vidT };
  })();
  const capOverride = useCallback(() => {
    const baseY = parseFloat(capPos) || 0;
    const fine = parseFloat(capFine) || 0;
    return { size: capSize, yOffset: baseY + fine * 0.0025, align: capAlign, yAlign: capYAlign };
  }, [capPos, capFine, capSize, capAlign, capYAlign]);

  // fromMain=true 면 main 이 보낸 줄 — 파일에는 이미 기록돼 있으므로 되보내지 않는다(중복 방지).
  const logline = useCallback((t, fromMain) => {
    setLogText((prev) => prev + t + '\n');
    if (!fromMain) { try { api.appendLog(String(t)); } catch (_) {} }
  }, []);

  useEffect(() => {
    api.onLog((line) => logline(line, true));
    api.onDtoUpdate((d) => { if (d) { setDto(d); if (d.timings) setTimings(d.timings); if (d.queue) setQueue(d.queue); } });
    api.onAutosaved((info) => setAutoSavedAt((info && info.at) || Date.now()));
    api.getAppVersion().then((v) => { if (v) setAppVersion(v); }).catch(() => {});
    loadPresets().then(loadStyles);
    // 시작/재로드 시 큐 복원 — 지난 세션 큐 + 활성 대본 화면 복구
    api.listQueue().then((r) => {
      if (!r) return;
      if (r.queue) setQueue(r.queue);
      if (r.mode) setMode(r.mode === 'book' ? 'book' : 'longform'); // 옛 저장값(shorts/playlist)은 롱폼으로 정규화
      if (r.dto) { setDto(r.dto); setFtitle(r.dto.fileTitle || ''); }
      const m = (r.mode === 'book') ? 'book' : 'longform';
      const it = r.queue && r.queue[m] && r.queue[m].items.find((x) => x.active);
      if (it && it.settings) applySettings(it.settings);
    }).catch(() => {});
    // 모드별 기본 음성배속을 mode-profiles 에서 가져와 현재 모드 기본값으로 세팅
    api.getModeProfiles().then((mp) => {
      if (!mp) return;
      setModeProfiles(mp);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 선택 채널 + 현재 모드의 자막/배속/스타일/분할 설정을 라이브 상태에 로드.
  //   프리셋의 값(capLong, speedLong, styleLong, split) 우선, 없으면 mode-profile 기본.
  useEffect(() => {
    if (!presetName) return;
    let cancelled = false;
    api.getPresetDetail(presetName).then((p) => {
      if (cancelled || !p) return;
      const prof = (modeProfiles && modeProfiles[mode]) || {};
      const cap = p.capLong;
      if (cap) {
        if (cap.size != null) setCapSize(String(cap.size));
        if (cap.align) setCapAlign(cap.align);
        if (cap.yAlign) setCapYAlign(cap.yAlign);
        if (cap.yOffset != null) applyCaptionYOffset(cap.yOffset);
      } else { applyCaptionDefaults(prof); }
      const sp = p.speedLong;
      const st = p.styleLong;
      // 항목 복원 중이면 배속·스타일·AI고지는 항목별 저장값(applySettings)이 우선 — 프리셋 기본값으로 덮지 않음.
      //   (자막·분할은 항목별 저장 대상이 아니라 채널값을 그대로 따르므로 무조건 적용)
      if (!restoringItemRef.current) {
        setTtsSpeed(String(sp != null ? sp : (prof.defaultTtsSpeed != null ? prof.defaultTtsSpeed : 1.0)));
        setStyleId(st || p.styleId || 'chibi');
        setAiNotice(true); // AI 고지 기본값: ON (사용자가 토글로 변경)
        // 채널이 지정한 이미지·비디오 제작 도구를 헤더 기본값으로 (있을 때만). 레거시값은 정규화.
        //   옛 'rotate'(순환) → 'genspark'. 드롭다운이 Flow·Genspark 로 분리됐고(2026-08-26), 고른 쪽을
        //   먼저 쓰고 한도면 다른 쪽이 이어받으므로 동작은 그대로다(activeOrder).
        if (p.imgEngine != null) setImgEngine(p.imgEngine === 'rotate' ? 'genspark' : p.imgEngine);
        if (p.videoEngine != null) setVideoEngine(['flow', 'wan', 'grok10'].includes(p.videoEngine) ? 'grok' : p.videoEngine);
      }
      const sl = p.split || { introSentenceSize: p.introSentenceSize, mainSentenceSize: p.mainSentenceSize, shortLen: p.shortLen, longLen: p.longLen };
      setSplitOpts({ intro: sl.introSentenceSize || 3, main: sl.mainSentenceSize || 10, short: sl.shortLen || 10, long: sl.longLen || 20, mode: sl.splitMode === 'sentence' ? 'sentence' : (sl.splitMode === 'h2' ? 'h2' : 'h3') });
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetName, mode, modeProfiles]);

  // I2V 범위 기본값 — 도입부 그룹 끝까지.
  //   도입부(isIntro)·그룹수가 바뀌면(로드/복원/재분할) 다시 계산 → 도입부 인식이 늦게 채워져도 반영.
  const _cuts0 = (dto && dto.projects && dto.projects[0] && dto.projects[0].cuts) || [];
  const _introSig = _cuts0.filter((c) => c.isIntro).map((c) => c.num).join(',');
  const _lastNum = _cuts0.length ? _cuts0[_cuts0.length - 1].num : 0;
  useEffect(() => {
    if (!_cuts0.length) return;
    if (hasStoredRangeRef.current) return; // 항목에 저장된 영상범위가 있으면 기본값으로 덮어쓰지 않음(항목별 범위 유지)
    const introNums = _cuts0.filter((c) => c.isIntro).map((c) => c.num);
    setVidFrom(1); setVidTo(introNums.length ? Math.max(...introNums) : _lastNum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dto && dto.fileTitle, _introSig, _lastNum]);

  // 분할옵션 변경 → 즉시 롱폼 재분할 (대본 로드 상태에서만).
  async function changeSplit(key, val) {
    const next = { ...splitOpts, [key]: (key === 'mode' ? val : (parseInt(val, 10) || 0)) };
    setSplitOpts(next);
    if (!loaded || !isLf) return;
    try { const d = await api.resplit({ intro: next.intro, main: next.main, short: next.short, long: next.long, splitMode: next.mode }); if (d) setDto(d); setStatus('재분할 완료'); }
    catch (e) { logline('재분할 오류: ' + e.message); }
  }
  async function runIntroVideo() {
    setStatus('도입부 TTS + 10초 재배치…');
    try { const d = await api.introVideoPrep({ presetName: presetName || null, speed: ttsSpeed || null }); if (d) setDto(d); setStatus('도입부 재배치 완료'); }
    catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  // 📥 통합본 자산 이어받기 — 기존 회차의 TTS·이미지·비디오를 이 작업폴더로 복사·연결(재실행 안전).
  async function runMergePrefill() {
    setStatus('📥 자산 이어받기…');
    try { const d = await api.mergePrefill(); if (d) setDto(d); setStatus('이어받기 완료'); }
    catch (e) { logline('이어받기 오류: ' + e.message); setStatus('오류'); }
  }

  // 모드의 기본 음성배속(mode-profiles). 미로딩 시 1.0 폴백.
  const defaultSpeedFor = (m) => {
    const v = modeProfiles && modeProfiles[m] && modeProfiles[m].defaultTtsSpeed;
    return v != null ? v : 1.0;
  };
  // 목표 yOffset 을 상하위치 select(가장 가까운 옵션) + 미세조정으로 정확히 표현.
  function applyCaptionYOffset(target) {
    let best = CAP_POS_OPTIONS[0];
    for (const o of CAP_POS_OPTIONS) if (Math.abs(o - target) < Math.abs(best - target)) best = o;
    setCapPos(String(best));
    setCapFine(Math.round((target - best) / 0.0025));
  }
  // 모드 자막 기본 스타일(위치·정렬·크기)을 UI 컨트롤에 반영.
  function applyCaptionDefaults(prof) {
    if (!prof) return;
    if (prof.captionYOffset != null) applyCaptionYOffset(prof.captionYOffset);
    if (prof.captionYAlign != null) setCapYAlign(prof.captionYAlign);
    if (prof.captionAlign != null) setCapAlign(prof.captionAlign);
    if (prof.captionSize != null) setCapSize(String(prof.captionSize));
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logText, logCollapsed]);


  async function loadPresets() {
    const ps = await api.listPresets();
    setPresets(ps || []);
    // 목록은 **사용자가 ↕ 로 정한 순서** 그대로다(더는 기본채널을 맨 위로 올리지 않는다).
    //   그래서 "처음에 고를 채널"은 순서가 아니라 isDefault 로 찾는다.
    if (ps && ps.length && !presetName) setPresetName((ps.find((p) => p.isDefault) || ps[0]).name);
  }
  async function loadStyles() {
    const ss = await api.listStyles();
    setStyles(ss || []);
  }

  // ── 액션 핸들러 ──────────────────────────────────────────
  // 대본별 생성 설정 묶음(채널·스타일·배속·엔진·영상범위) — 큐 항목마다 개별 저장.
  function currentSettings() {
    return { presetName, styleId, ttsSpeed, imgEngine, videoEngine, vidFrom, vidTo, flowVideoModel, flowCount, aiNotice };
  }
  function applySettings(s) {
    if (!s) return;
    restoringItemRef.current = true; // 이 복원 동안 프리셋 기본값 effect 가 배속·스타일·AI고지를 덮지 않게
    if (s.presetName != null) setPresetName(s.presetName);
    if (s.styleId != null) setStyleId(s.styleId);
    if (s.ttsSpeed != null) setTtsSpeed(s.ttsSpeed);
    // comfy(z-image/Krea2)·gemini·genspark·flow 는 유효 — 보존. 옛 'rotate' 만 genspark 로 이관.
    if (s.imgEngine != null) setImgEngine(s.imgEngine === 'rotate' ? 'genspark' : s.imgEngine);
    // 제거된 영상 엔진(flow/wan)·레거시(grok10) → grok. comfy(::path)·grok-api 는 보존.
    if (s.videoEngine != null) setVideoEngine(['flow', 'wan', 'grok10'].includes(s.videoEngine) ? 'grok' : s.videoEngine);
    if (s.vidFrom != null) setVidFrom(s.vidFrom);
    if (s.vidTo != null) setVidTo(s.vidTo);
    hasStoredRangeRef.current = (s.vidFrom != null || s.vidTo != null); // 저장된 범위 있으면 기본값 effect 억제
    if (s.flowVideoModel != null) setFlowVideoModel(s.flowVideoModel);
    if (s.flowCount != null) setFlowCount(s.flowCount);
    if (s.aiNotice != null) setAiNotice(!!s.aiNotice);
  }
  async function openScript() {
    const r = await api.openScript({ presetName: presetName || null, mode });
    if (!r) return;
    hasStoredRangeRef.current = false; restoringItemRef.current = false; // 새 대본 = 기본 범위·채널 기본값 계산 허용
    if (mode !== 'longform') setMode('longform'); // 영상 대본은 롱폼 단일 모드
    setDto(r.dto); setFtitle(r.dto.fileTitle); if (r.queue) setQueue(r.queue);
    try { await api.setQueueSettings(currentSettings()); } catch (_) {} // 이 대본의 설정을 현재 헤더값으로 캡처
    setStatus(`${r.dto.projects.length}편 로드 · 큐에 추가`);
  }
  // 큐에서 대본 선택 → 활성화 + 그 대본의 설정을 헤더에 로드
  async function selectQueueItem(id) {
    try {
      const r = await api.selectQueueItem(id);
      if (r.queue) setQueue(r.queue);
      setDto(r.dto || null); setFtitle(r.dto ? (r.dto.fileTitle || '') : '');
      const it = r.queue && r.queue[mode] && r.queue[mode].items.find((x) => x.id === id);
      if (it && it.settings) applySettings(it.settings);
    } catch (e) { logline('대본 선택 오류: ' + e.message); }
  }
  // 큐 전체를 파일로 저장 (다중 작업 세트)
  async function saveQueueFile() {
    try {
      const r = await api.saveQueue();
      if (r && r.ok) setStatus(`💾 큐 저장 완료 — ${r.count}개 대본`);
      else if (r && r.reason === 'empty') setStatus('저장할 큐가 없습니다');
    } catch (e) { logline('큐 저장 오류: ' + e.message); }
  }
  // 저장한 큐를 통째로 불러오기 (현재 큐 교체)
  async function loadQueueFile() {
    try {
      const r = await api.loadQueue();
      if (!r || !r.ok) { if (r && r.reason !== 'cancel') logline('큐 불러오기 실패'); return; }
      if (r.queue) setQueue(r.queue);
      if (r.mode) setMode(r.mode === 'book' ? 'book' : 'longform'); // 옛 저장값(shorts/playlist)은 롱폼으로 정규화
      if (r.dto) { setDto(r.dto); setFtitle(r.dto.fileTitle || ''); }
      const m = (r.mode === 'book') ? 'book' : 'longform';
      const it = r.queue && r.queue[m] && r.queue[m].items.find((x) => x.active);
      if (it && it.settings) applySettings(it.settings);
      setStatus(`📂 큐 불러오기 — ${r.count}개 대본 복구`);
    } catch (e) { logline('큐 불러오기 오류: ' + e.message); }
  }
  // 저장 폴더(saves) 전체삭제 — 확인 팝업 필수
  async function deleteSaves() {
    if (!uiConfirm('저장 폴더(saves)의 「작업·큐 저장 파일」을 모두 삭제합니다.\n\n⚠ 되돌릴 수 없습니다.\n(진행 중 대본의 자동 이어받기 데이터는 삭제되지 않습니다.)\n\n정말 모두 삭제할까요?')) return;
    try { const r = await api.clearSaves(); setStatus(`🗑 저장 파일 ${(r && r.count) || 0}개 삭제됨`); }
    catch (e) { logline('전체삭제 오류: ' + e.message); }
  }
  // 큐에서 대본 제거
  async function removeQueueItem(id) {
    try { const r = await api.removeQueueItem(id); if (r.queue) setQueue(r.queue); setDto(r.dto || null); setFtitle(r.dto ? (r.dto.fileTitle || '') : ''); setStatus('대본 제거됨'); }
    catch (e) { logline('대본 제거 오류: ' + e.message); }
  }
  // 작업 소요시간은 백엔드에서 단계별로 측정해 dto-update(d.timings)로 전송 → setTimings 로 표시.
  async function runStt() {
    setStatus('STT 변환 중… (음성·영상 → txt)');
    try {
      const r = await api.sttTranscribe();
      if (!r || r.canceled) { setStatus('STT 취소'); return; }
      const tot = (r.results || []).length;
      const okN = (r.results || []).filter((x) => x.ok).length;
      setStatus(`STT 완료 (${okN}/${tot}) — 원본 폴더에 .txt 생성`);
    } catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  // 🎵 영상 → mp3 추출 (STT 와 별개 · Whisper 서버 불필요)
  async function runExtractMp3() {
    setStatus('mp3 추출 중… (영상 → mp3)');
    try {
      const r = await api.extractMp3();
      if (!r || r.canceled) { setStatus('mp3 추출 취소'); return; }
      const tot = (r.results || []).length;
      const okN = (r.results || []).filter((x) => x.ok).length;
      setStatus(`mp3 추출 완료 (${okN}/${tot}) — 원본 폴더에 .mp3 생성`);
    } catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  async function runTts(shortsNum) {
    setStatus('TTS 생성중…');
    try {
      const d = await api.ttsBuild({ shortsNum, dry: false, presetName: presetName || null, speed: ttsSpeed || null });
      setDto(d); setStatus('오디오 완료');
    } catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  async function deleteTtsAll() {
    if (!uiConfirm('이미 만든 TTS 음성 파일과 재활용 캐시를 모두 삭제하고, 화면의 시간기록도 지웁니다.\n(다음에 변환 버튼을 누르면 전부 새로 합성됩니다.)\n\n진행할까요?')) return;
    setStatus('TTS 삭제 중…');
    try { const d = await api.deleteTts(); if (d) setDto(d); setStatus('TTS 삭제 완료'); }
    catch (e) { logline('TTS 삭제 오류: ' + e.message); setStatus('TTS 삭제 실패'); }
  }
  async function runImg(shortsNum) {
    if (!ensurePromptsFilled(shortsNum, { image: 'all', video: 'none' })) return; // 이미지 버튼=이미지 프롬프트만
    setStatus(`이미지 생성중(${imgEngine})…`);
    try { const d = await api.imageBuild({ shortsNum, engine: imgEngine, styleId: styleId || null }); setDto(d); setStatus('이미지 완료'); }
    catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  async function runVid(shortsNum) {
    if (!ensurePromptsFilled(shortsNum, { image: 'range', video: 'range' })) return; // 영상=범위 그룹 이미지+i2v
    setStatus(`비디오 생성중(G${vidFrom}~${vidTo})…`);
    try { const d = await api.videoBuild({ shortsNum, fromNum: parseInt(vidFrom, 10) || 1, toNum: parseInt(vidTo, 10) || 1, engine: videoEngine, flowVideoModel, flowCount, imgEngine, styleId: styleId || null }); setDto(d); setStatus('비디오 완료'); }
    catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  // 이미지·비디오 일괄 삭제 — TTS 삭제(🗑)와 같은 방식. 파일 + 재활용 캐시까지 지워 다음 생성 때 새로 만든다.
  //   ⚠ 일괄첨부로 넣은 **출력 폴더 밖 원본 파일은 지우지 않고 참조만 해제**한다(main.js 에서 판정).
  async function deleteImagesAll() {
    if (!uiConfirm('이 대본의 이미지 파일과 재활용 캐시를 모두 삭제합니다.\n(비디오는 그대로 남습니다. 다음에 이미지 버튼을 누르면 전부 새로 만듭니다.)\n\n진행할까요?')) return;
    setStatus('이미지 삭제 중…');
    try { const d = await api.deleteImages({ styleId: styleId || null, imgEngine }); if (d) setDto(d); setStatus('이미지 삭제 완료'); }
    catch (e) { logline('이미지 삭제 오류: ' + e.message); setStatus('이미지 삭제 실패'); }
  }
  async function deleteVideosAll() {
    if (!uiConfirm('이 대본의 비디오 파일과 재활용 캐시를 모두 삭제합니다.\n(이미지는 그대로 남아 켄번스로 진행할 수 있습니다.)\n\n진행할까요?')) return;
    setStatus('비디오 삭제 중…');
    try { const d = await api.deleteVideos(); if (d) setDto(d); setStatus('비디오 삭제 완료'); }
    catch (e) { logline('비디오 삭제 오류: ' + e.message); setStatus('비디오 삭제 실패'); }
  }
  async function runBulk(shortsNum) {
    setStatus('일괄첨부 폴더 선택…');
    try { const d = await api.bulkAttach({ shortsNum }); setDto(d); setStatus('일괄첨부 완료'); }
    catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  // ── 상단 버튼 = 큐 전체(현재 모드) ── 그 단계를 큐의 모든 대본에 순차 적용. 기존 단건 핸들러를 항목마다 재사용(안정).
  //   stage: 'tts' | 'image' | 'video' | 'imgvid'(이미지 전부 → 비디오). 대본 위 버튼은 그대로 그 대본만.
  async function runStageQueue(stage) {
    try { await api.setQueueSettings(currentSettings(), true); } catch (_) {} // 헤더값을 활성 항목에 반영
    const items = (queue && queue[mode] && queue[mode].items) || [];
    if (!items.length) { setStatus('대본을 먼저 여세요'); return; }
    const label = { tts: 'TTS', image: '이미지', video: '비디오', imgvid: '이미지→비디오' }[stage] || stage;
    const origId = (queue && queue[mode] && queue[mode].activeId) || (items[0] && items[0].id);
    // 이미지+비디오는 콜드스타트(ComfyUI 이미지↔비디오 모델 스왑) 최소화를 위해 '전 항목 이미지 → 전 항목 비디오' 2패스로.
    // (항목마다 이미지·비디오를 번갈아 하면 모델을 2×N번 다시 로드 → 배치로 묶어 스왑 1번.) 단일 stage 는 기존대로 1패스.
    const phases = stage === 'imgvid' ? ['image', 'video'] : [stage];
    queueAbortRef.current = false;                       // 새 큐 시작 — 지난 중단 기록 초기화
    for (const ph of phases) {
      if (queueAbortRef.current) break;
      const plabel = { tts: 'TTS', image: '이미지', video: '비디오' }[ph] || ph;
      for (let k = 0; k < items.length; k++) {
        if (queueAbortRef.current) { logline(`⏹ 큐 ${plabel} 중단 — 남은 ${items.length - k}편은 건너뜁니다`); break; }
        const it = items[k];
        setStatus(`⚡ 큐 ${plabel} — ${k + 1}/${items.length}편…`);
        try { await api.selectQueueItem(it.id); } catch (_) {}
        try {
          if (ph === 'tts') { const d = await api.ttsBuild({ shortsNum: null, dry: false, presetName: presetName || null, speed: ttsSpeed || null }); if (d) setDto(d); }
          if (ph === 'image') { const d = await api.imageBuild({ shortsNum: null, engine: imgEngine, styleId: styleId || null }); if (d) setDto(d); }
          if (ph === 'video' && videoEngine !== 'none') { const d = await api.videoBuild({ shortsNum: null, fromNum: parseInt(vidFrom, 10) || 1, toNum: parseInt(vidTo, 10) || 1, engine: videoEngine, flowVideoModel, flowCount, imgEngine, styleId: styleId || null }); if (d) setDto(d); }
        } catch (e) { logline(`큐 ${plabel} 오류: ${e.message}`); }
      }
    }
    try { const r = await api.selectQueueItem(origId); if (r && r.dto) { setDto(r.dto); if (r.queue) setQueue(r.queue); } } catch (_) {} // 원래 보던 대본으로 복원
    setStatus(queueAbortRef.current ? `⏹ 큐 ${label} 중단됨` : `⚡ 큐 ${label} 완료`);
  }
  // 대본 위 통합 버튼 — 그 대본만: 이미지 전부 → 비디오.
  async function runImgVid(shortsNum) {
    if (!ensurePromptsFilled(shortsNum, { image: 'all', video: videoEngine === 'none' ? 'none' : 'range' })) return;
    setStatus('이미지→비디오 생성중…');
    try {
      let d = await api.imageBuild({ shortsNum, engine: imgEngine, styleId: styleId || null }); if (d) setDto(d);
      if (videoEngine !== 'none') { d = await api.videoBuild({ shortsNum, fromNum: parseInt(vidFrom, 10) || 1, toNum: parseInt(vidTo, 10) || 1, engine: videoEngine, flowVideoModel, flowCount, imgEngine, styleId: styleId || null }); if (d) setDto(d); }
      setStatus('이미지→비디오 완료');
    } catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  async function runMake(shortsNum) {
    const args = {
      shortsNum, engine: imgEngine, presetName: presetName || null, speed: ttsSpeed || null,
      captionStyle: capOverride(), captionMaxChars: effCap, styleId: styleId || null,
      fromNum: parseInt(vidFrom, 10) || 1, toNum: parseInt(vidTo, 10) || 1,
      dry: false, videoEngine, flowVideoModel, flowCount,
      aiNotice, // 사용자 선택(작업바 토글)
    };
    if (!ensurePromptsFilled(shortsNum, { image: 'all', video: videoEngine === 'none' ? 'none' : 'range' })) return; // 만들기=전체 이미지 + 범위 i2v ('없음'은 i2v 불요)
    setStatus('⚡ 전체 제작중… (TTS+이미지→영상→.vrew)');
    try { const d = await api.makeAll(args); setDto(d); setStatus('전체 제작 완료'); }
    catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  // ⚡ 만들기(통합) — 큐 대본이 1개면 그것만(.vrew 자동열기 등 기존 동작), 여러 개면 큐 전체 순차 제작.
  async function runMakeOrBatch() {
    try { await api.setQueueSettings(currentSettings(), true); } catch (_) {} // 현재 헤더값을 활성 항목에 반영(채널은 열 때 값 유지)
    const L = (queue && queue.longform && queue.longform.items) || [];
    const total = L.length;
    if (total === 0) { setStatus('대본을 먼저 여세요'); return; }
    if (total === 1) return runMake(null);  // 단일 대본 → makeAll(.vrew·폴더 자동열기)
    return runBatchAll();                    // 여러 대본 → 큐 전체 순차
  }
  // ⚡⚡ 큐 전체 순차 제작 — 각 대본은 자기 설정으로.
  async function runBatchAll() {
    const L = (queue && queue.longform && queue.longform.items) || [];
    const plan = [];
    // 이미 완료(done)된 항목은 제외 — 다시 만들지 않고 .vrew 도 다시 열지 않음(vrew 버튼으로 열면 됨).
    for (const it of L) {
      if (it && it.status !== 'done') plan.push({ mode: 'longform', id: it.id, settings: it.settings || null });
    }
    if (!plan.length) { setStatus('만들 대본이 없습니다 (모두 완료됨 — 다시 만들려면 해당 큐를 지우고 다시 여세요)'); return; }
    if (!ensurePromptsFilled(null, { image: 'all', video: videoEngine === 'none' ? 'none' : 'range' })) return; // 현재 표시 대본 기준 빈 프롬프트 검사 ('없음'은 i2v 불요)
    setStatus(`⚡⚡ 큐 순차 제작중… (${plan.length}개)`);
    try {
      // 비디오·이미지 엔진은 헤더값(이번 실행 공통)으로 전달 — 큐 항목별 stale 값 무시(헤더 '없음'이면 전 대본 영상 없음)
      // 영상 범위(vidFrom~vidTo)도 헤더값을 공통으로 전달 — 항목 저장값이 없어도 헤더 범위가 적용된다.
      //   (안 보내면 서버가 '미지정'으로 보고 안전기본 G1 만 만든다 — 전 그룹 생성 사고 방지)
      const r = await api.runBatch({ plan, common: { captionStyle: capOverride(), captionMaxChars: effCap, videoEngine, imgEngine, flowVideoModel, flowCount, vidFrom, vidTo, styleId: styleId || null }, openEach: openEachVrew });
      if (r && r.queue) setQueue(r.queue);
      if (r && r.dto) { setDto(r.dto); setFtitle(r.dto.fileTitle || ''); }
      setStatus('⚡⚡ 큐 제작 완료');
    } catch (e) { logline('큐 제작 오류: ' + e.message); setStatus('큐 제작 오류'); }
  }
  async function runVrew(shortsNum) {
    setStatus('.vrew 내보내는 중…');
    try { const r = await api.exportVrew({ shortsNum, presetName: presetName || null, captionStyle: capOverride(), captionMaxChars: effCap, aiNotice, styleId: styleId || null, engine: imgEngine }); setStatus(`.vrew ${r.outs.length}개`); }
    catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  // Premiere Pro 임포트용 XML(FCP7 xmeml) — 파일 > 가져오기로 시퀀스가 바로 열림.
  async function runPremiere(shortsNum) {
    setStatus('프리미어 XML 내보내는 중…');
    try { const r = await api.exportPremiere({ shortsNum, captionMaxChars: effCap }); setStatus(r && r.outs && r.outs.length ? `프리미어 XML ${r.outs.length}개 — Premiere 에서 파일>가져오기 (자막=.srt)` : '프리미어 XML 실패 — 로그 확인'); }
    catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  async function attachAsset(shortsNum, groupNum) {
    setStatus('이미지/영상 첨부…');
    try { const d = await api.attachAsset({ shortsNum, groupNum }); setDto(d); setStatus('첨부 완료'); }
    catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  async function clearAsset(shortsNum, groupNum) {
    try { const d = await api.clearAsset({ shortsNum, groupNum }); setDto(d); setStatus('자산 삭제'); }
    catch (e) { logline('오류: ' + e.message); }
  }
  async function runRegen(shortsNum, groupNum) {
    setStatus(`G${groupNum} 이미지 재생성…`);
    try { const d = await api.regenGroup({ shortsNum, groupNum, styleId: styleId || null, engine: imgEngine }); setDto(d); setStatus('재생성 완료'); }
    catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  // 그룹 단위 버튼 (PrimingFlow)
  async function runGroupTts(shortsNum, groupNum) {
    setStatus(`G${groupNum} TTS…`);
    try { const d = await api.ttsGroup({ shortsNum, groupNum, presetName: presetName || null, speed: ttsSpeed || null }); setDto(d); setStatus(`G${groupNum} TTS 완료`); }
    catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  async function runGroupVid(shortsNum, groupNum) {
    setStatus(`G${groupNum} 비디오…`);
    try { const d = await api.videoGroup({ shortsNum, groupNum, engine: videoEngine, flowVideoModel, flowCount, imgEngine, styleId: styleId || null }); setDto(d); setStatus(`G${groupNum} 비디오 완료`); }
    catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  function playFrom(shortsNum, groupNum) {
    if (!dto) return;
    const pr = dto.projects.find((p) => p.shortsNum === shortsNum); if (!pr) return;
    const idx = pr.cuts.findIndex((c) => c.num === groupNum); if (idx < 0) return;
    playProjects([{ ...pr, cuts: pr.cuts.slice(idx) }], false); // 이 그룹부터 끝까지
  }
  // ⏱ 유튜브 타임스탬프 — TTS 길이 누적으로 챕터 목록을 만들어 창에 띄운다(편집 가능, 복사는 창에서).
  function openTimestamps() {
    if (!loaded) { setStatus('대본을 먼저 여세요'); return; }
    const d = tsBuild(dto);
    if (!d.text.trim()) { setStatus('타임스탬프를 만들 그룹이 없습니다'); return; }
    setTsData(d); setTsOpen(true);
  }
  async function copyTimestamps() {
    const text = (tsRef.current ? tsRef.current.value : (tsData && tsData.text)) || '';
    try { await navigator.clipboard.writeText(text); setStatus('⏱ 타임스탬프 복사됨 — 유튜브 설명글에 붙여넣으세요'); }
    catch (e) { logline('복사 실패: ' + e.message); setStatus('복사 실패'); }
  }
  const styleName = () => { const s = styles.find((x) => x.id === styleId); return s ? s.name : ''; };
  async function exportPrompts() {
    if (!dto) { setStatus('대본을 먼저 여세요'); return; }
    try {
      const text = await api.exportPrompts({ styleName: styleName() });
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {}
      setStatus(ok ? '📤 요청서 클립보드 복사 완료 — 웹 LLM에 붙여넣으세요' : '복사 실패');
    } catch (e) { logline('내보내기 오류: ' + e.message); }
  }
  // ✍ 프롬프트작성 — 빈 그룹의 이미지+i2v 프롬프트를 GPU(Ollama)로 채움.
  //   GPU 미연결(다른 PC·출장 등)이면 → 요청서를 클립보드에 복사하고 '붙여넣기' 창을 열어
  //   아무 LLM(챗GPT/클로드/제미나이…)에 붙여넣어 답을 받아 등록하는 수동 흐름으로 자동 전환.
  async function runMakePrompts() {
    if (!dto) { setStatus('대본을 먼저 여세요'); return; }
    setImpBusy(true); setStatus('✍ 빈 프롬프트 자동작성 중… (GPU Ollama)');
    try {
      const d = await api.generatePromptsApi({ provider: 'ollama', styleName: styleName(), fromNum: parseInt(vidFrom, 10) || 1, toNum: parseInt(vidTo, 10) || 1 });
      setDto(d); setStatus('✍ 빈 프롬프트 작성 완료');
    } catch (e) {
      logline('프롬프트작성(GPU Ollama) 실패: ' + e.message);
      // GPU 미연결 → 복사·붙여넣기 방식으로 자동 전환 (요청서를 클립보드에 복사 + 붙여넣기 창 열기)
      let copied = false;
      try {
        const text = await api.exportPrompts({ styleName: styleName() });
        try { await navigator.clipboard.writeText(text); copied = true; } catch (_) {}
      } catch (_) {}
      setImpText('');
      setImpOpen(true);
      setStatus('GPU(Ollama) 미연결 — 복사·붙여넣기 방식으로 전환');
      uiAlert(
        'GPU(Ollama)에 연결할 수 없습니다.\n'
        + (copied ? '요청서를 클립보드에 복사해 두었습니다.\n' : '※ 자동 복사 실패 — 붙여넣기 창의 [📤 요청서 복사] 버튼을 누르세요.\n')
        + '\n[복사·붙여넣기로 프롬프트 만들기]\n'
        + '① 챗GPT·클로드·제미나이 등 아무 LLM에 붙여넣어 답을 받으세요.\n'
        + '② 받은 답 전체를 붙여넣기 창에 넣고 [붙여넣은 텍스트 적용]을 누르세요.'
      );
    }
    finally { setImpBusy(false); }
  }
  // 그룹 분할 — 10초 초과 그룹을 2개로(균형). 두 그룹 프롬프트 초기화.
  async function splitGroup(shortsNum, groupNum) {
    try { const d = await api.splitGroup({ shortsNum, groupNum }); setDto(d); setStatus('✂ 그룹 분할 — 두 그룹 프롬프트 초기화됨. ✍프롬프트작성으로 채우세요'); }
    catch (e) { logline('분할 오류: ' + e.message); uiAlert('분할 실패:\n' + e.message); }
  }
  // 제작 전 검사 — 빈 프롬프트 있으면 목록 팝업 + 진행 차단. (shortsNum=null → 전체)
  //   opts.image/video = 'all'|'range'|'none' — 어느 그룹에 그 프롬프트가 필요한지.
  //   i2v 는 '영상 범위(vidFrom~vidTo)' 그룹만 필요(롱폼=도입부만). 범위 밖은 영상 안 만드니 i2v 불요.
  function ensurePromptsFilled(shortsNum, opts = {}) {
    if (!dto) return false;
    const image = opts.image || 'all';
    const video = opts.video || 'range';
    const vf = parseInt(vidFrom, 10) || 1, vt = parseInt(vidTo, 10) || 1;
    const lo = Math.min(vf, vt), hi = Math.max(vf, vt);
    const inRange = (n) => n >= lo && n <= hi;
    const projs = dto.projects.filter((p) => shortsNum == null || p.shortsNum === shortsNum);
    const missing = [];
    for (const p of projs) {
      for (const c of p.cuts) {
        const needImg = image === 'all' || (image === 'range' && inRange(c.num));
        const needVid = video === 'all' || (video === 'range' && inRange(c.num));
        // 이미 이미지/영상이 첨부돼 있으면(hasVisual) 프롬프트가 없어도 생성 불필요 — 실제 생성 로직(hasVisual)과 기준을 맞춤.
        const hasVisual = !!(c.imagePath || c.videoPath);
        const hasImgSource = hasVisual || (c.imagePrompt && c.imagePrompt.trim()); // 이미지 or 이미지프롬프트
        const noImg = needImg && !hasVisual && (!c.imagePrompt || !c.imagePrompt.trim());
        // i2v 는 '이미지→영상'이라 이미지(또는 이미지프롬프트)만 있으면 videoPrompt 없어도 기본 모션으로 생성됨(선택 사항).
        //   → 이미지 소스가 아예 없을 때만 경고(그건 애초에 이미지 경고로 이미 잡힘).
        const noVid = needVid && !c.videoPath && !hasImgSource;
        if (noImg || noVid) missing.push(`${p.title} G${c.num}: ${[noImg ? '이미지' : null, noVid ? 'i2v' : null].filter(Boolean).join('·')} 없음`);
      }
    }
    if (missing.length) {
      uiAlert(`프롬프트가 비어 있어 진행할 수 없습니다.\n✍ 프롬프트작성 버튼으로 채운 뒤 다시 시도하세요.\n\n빈 그룹 ${missing.length}개:\n` + missing.slice(0, 20).join('\n') + (missing.length > 20 ? `\n…외 ${missing.length - 20}개` : ''));
      setStatus(`⛔ 빈 프롬프트 ${missing.length}개 — 진행 안 함`);
      return false;
    }
    return true;
  }
  async function applyImport() {
    const text = (impRef.current && impRef.current.value != null) ? impRef.current.value : impText;
    if (!text.trim()) { setStatus('붙여넣은 텍스트가 없습니다'); return; }
    setStatus('가져오기 적용 중…');
    try { const d = await api.importPrompts({ text }); setDto(d); setImpOpen(false); setStatus('가져오기 완료'); }
    catch (e) { logline('가져오기 오류: ' + e.message); setStatus('가져오기 실패'); }
  }
  async function importViaApi() {
    setStatus(`🤖 ${impProvider} API로 프롬프트 작성 중…`); setImpBusy(true);
    try { const d = await api.generatePromptsApi({ provider: impProvider, styleName: styleName() }); setDto(d); setImpOpen(false); setStatus('API 자동작성 완료'); }
    catch (e) { logline('API 오류: ' + e.message); setStatus('API 실패'); uiAlert('API 호출 실패:\n' + e.message); }
    finally { setImpBusy(false); }
  }
  async function resetProject() {
    const r = await api.resetProject();
    if (r && r.queue) setQueue(r.queue);
    setDto(null); setFtitle(''); setStatus('초기화됨 — 현재 모드 큐 비움');
  }
  async function saveProject() {
    try { const r = await api.saveProject(); setStatus('프로젝트 저장됨'); logline('저장: ' + r.file); }
    catch (e) { logline('오류: ' + e.message); }
  }
  async function loadProject() {
    const r = await api.loadProject(); if (!r) return;
    if (r.mode && r.mode !== mode) setMode(r.mode === 'book' ? 'book' : 'longform');
    setDto(r.dto); setFtitle(r.dto.fileTitle); if (r.queue) setQueue(r.queue);
    try { await api.setQueueSettings(currentSettings()); } catch (_) {} // 불러온 항목 설정 캡처
    setStatus(`${r.dto.projects.length}편 불러옴`);
  }
  // ── 이미지 스타일 편집 ─────────────────────────────
  async function refreshStyles() { try { const ss = await api.listStyles(); setStyles(ss || []); return ss || []; } catch { return []; } }
  async function copyStylePrompt(p) {
    try { await navigator.clipboard.writeText(p || ''); }
    catch (_) { try { const ta = document.createElement('textarea'); ta.value = p || ''; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch (__) {} }
    setStatus('스타일 프롬프트 복사됨');
  }
  async function addStyle() {
    const name = (newStyle.name || '').trim(), prompt = (newStyle.prompt || '').trim();
    if (!name || !prompt) { setStatus('스타일 이름과 프롬프트를 모두 입력하세요'); return; }
    const r = await api.addStyle({ name, prompt });
    if (r) { setNewStyle({ name: '', prompt: '' }); await refreshStyles(); setStatus(`스타일 「${name}」 추가됨`); }
    else setStatus('스타일 추가 실패');
  }
  async function saveStyle(id, name, prompt) {
    const r = await api.updateStyle({ id, name: (name || '').trim(), prompt: (prompt || '').trim() });
    if (r) { await refreshStyles(); setStatus('스타일 저장됨'); } else setStatus('스타일 저장 실패');
  }
  async function deleteStyle(id, name) {
    if (!uiConfirm(`스타일 「${name}」 삭제할까요?`)) return;
    const ok = await api.removeStyle(id);
    if (ok) { if (styleId === id) setStyleId(''); await refreshStyles(); setStatus('스타일 삭제됨'); }
    else setStatus('스타일 삭제 실패');
  }
  async function moveStyle(id, direction) { const ok = await api.moveStyle({ id, direction }); if (ok) await refreshStyles(); }
  // ☁ 공용 스타일 동기화 — 스타일 목록은 **여러 PC 공용**이다(참조음성과 같은 서버).
  //   편집창을 열 때 한 번 맞춘다 → 다른 PC 가 만든 스타일이 바로 보인다. 실패하면 이 PC 것만 쓴다.
  async function syncStyles(showOk) {
    setStyleSync('☁ 공용 스타일 동기화 중…');
    try {
      const r = await api.syncStyles();
      setStyles((r && r.styles) || []);
      if (r && r.note) setStyleSync('⚠ ' + r.note);
      else setStyleSync(showOk ? '☁ 공용 스타일과 맞췄습니다 — 이 목록은 다른 PC 와 함께 씁니다.' : '');
    } catch (e) { setStyleSync('⚠ 동기화 오류: ' + e.message); }
  }
  async function openStyleEditor() { setStyleEditOpen(true); await syncStyles(false); }
  // ── 발음사전(TTS 교정) ─────────────────────────────
  async function openDict() { try { const d = await api.dictList(); setDictRows(Array.isArray(d) ? d : []); setDictOpen(true); } catch (e) { logline('발음사전 읽기 오류: ' + e.message); } }
  async function saveDict() {
    const clean = dictRows.map((r) => ({ source: (r.source || '').trim(), pron: (r.pron || '').trim(), enabled: r.enabled !== false })).filter((r) => r.source && r.pron);
    const r = await api.dictSave(clean);
    if (r) { setDictRows(r); setDictOpen(false); setStatus('발음사전 저장됨 — 다음 TTS 변환부터 적용'); } else setStatus('발음사전 저장 실패');
  }
  function addDictRow() { setDictRows((rs) => [...rs, { source: '', pron: '', enabled: true }]); }
  function setDictRow(i, patch) { setDictRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); }
  function delDictRow(i) { setDictRows((rs) => rs.filter((_, j) => j !== i)); }
  function showPrompt(shortsNum, c, label) {
    // 편집 대상 = 대본 이미지/비디오 프롬프트(raw). 스타일은 생성 시 앞에 자동으로 붙는다(stylePfx 는 안내용).
    const st = styles.find((x) => x.id === styleId);
    const stylePfx = st && st.prompt ? st.prompt + ', ' : '';
    setPromptView({
      label, shortsNum, groupNum: c.num,
      styleName: st ? st.name : '없음', stylePfx,
      image: c.imagePrompt || '',   // 대본 이미지 프롬프트(편집)
      video: c.videoPrompt || '',   // 대본 비디오 프롬프트(편집)
      motion: c.motionNote || '',
    });
  }
  // 📝 팝업이 열려 있는 동안 '실제 전송 프롬프트'를 main 에서 계산해 표시(편집 중에도 300ms 디바운스로 갱신).
  //    편집칸은 **대본 원문(raw)** 그대로 유지 — 저장 시 대본이 오염되지 않게. 최종본은 읽기전용으로만 보여준다.
  useEffect(() => {
    if (!promptView) { setFinalPrompt(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      api.finalPromptPreview({
        styleId: styleId || null,
        imagePrompt: promptView.image || '',
        videoPrompt: promptView.video || '',
        motionNote: promptView.motion || '',
      }).then((r) => { if (!cancelled) setFinalPrompt(r || null); }).catch(() => {});
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptView && promptView.image, promptView && promptView.video, promptView && promptView.motion, styleId, promptView ? 1 : 0]);

  // 수정한 프롬프트 저장(+선택적으로 이미지/비디오 재생성). regen: 'image' | 'video' | null(저장만)
  async function savePromptView(regen) {
    if (!promptView) return;
    const { shortsNum, groupNum, image, video } = promptView;
    try { const d = await api.setGroupPrompt({ shortsNum, groupNum, imagePrompt: image, videoPrompt: video }); if (d) setDto(d); setStatus('프롬프트 저장됨'); }
    catch (e) { logline('프롬프트 저장 오류: ' + e.message); return; }
    if (regen === 'image') { setPromptView(null); await runRegen(shortsNum, groupNum); }
    else if (regen === 'video') { setPromptView(null); await runGroupVid(shortsNum, groupNum); }
  }
  const [browserBusy, setBrowserBusy] = useState(false);   // 폴백 브라우저 설치 중
  async function installBrowser() {
    if (browserBusy) return;
    setBrowserBusy(true);
    setSettingsMsg('⬇ 브라우저(Chromium) 설치 중… 수백 MB 라 몇 분 걸립니다. 로그창에 진행이 나옵니다.');
    try {
      const r = await api.installBrowser();
      setSettingsMsg((r && r.ok ? '✅ ' : '❌ ') + ((r && r.message) || '알 수 없는 결과'));
    } catch (e) { setSettingsMsg('❌ ' + e.message); }
    setBrowserBusy(false);
  }
  async function saveUpCfg(patch) { try { setUpCfg(await api.setUpscaleConfig(patch)); } catch (e) { logline('업스케일 설정 오류: ' + e.message); } }
  async function saveGiCfg(patch) { try { setGiCfg(await api.setGeminiImageConfig(patch)); } catch (e) { logline('나노바나나 설정 오류: ' + e.message); } }
  async function saveGiKey(k) { try { await api.setGeminiKey(k || ''); setGiKey(k || ''); setStatus('Gemini API 키 저장됨'); } catch (e) { logline('Gemini 키 저장 오류: ' + e.message); } }
  async function saveLora(patch) { try { setLora(await api.setLoraCollect(patch)); } catch (e) { logline('LoRA 설정 오류: ' + e.message); } }
  async function pickLoraDir() { try { const r = await api.pickLoraDir(); if (r) setLora(r); } catch (e) { logline(e.message); } }
  async function saveImgRot(next) { setImgRot(next); try { await api.setImageRotation(next); } catch (e) { logline('순환 저장 오류: ' + e.message); } }
  // window.prompt 대체 — Electron 렌더러에서 prompt()가 미지원/예외라, 이름 입력을 모달로 받아 Promise 로 반환.
  function askName(title, def) { return new Promise((resolve) => setNameAsk({ title, value: def || '', resolve })); }
  function nameAskOk() { if (nameAsk) { const r = nameAsk.resolve, v = (nameAsk.value || '').trim(); setNameAsk(null); r(v || null); } }
  function nameAskCancel() { if (nameAsk) { const r = nameAsk.resolve; setNameAsk(null); r(null); } }
  // TTS 서버 주소(OmniVoice) — 다른 PC에서 메인 GPU 서버(LAN/Tailscale)를 가리키게.
  async function openTtsSrv() { return openSettings('tts'); }
  async function saveTtsSrv(id) {
    try { await api.setTtsServer({ id, baseUrl: (ttsSrv[id] && ttsSrv[id].baseUrl) || '' }); setStatus(`TTS 서버(${id}) 저장됨`); } catch (e) { logline('TTS 서버 저장 오류: ' + e.message); }
  }
  async function testTtsSrv(id) {
    const url = (ttsSrv[id] && ttsSrv[id].baseUrl) || '';
    setStatus(`${id} 연결 확인 중…`); setSettingsMsg(`⏳ ${id} 연결 확인 중… (${url || '주소 없음'})`);
    try {
      const r = await api.testTtsServer({ baseUrl: url });
      const msg = r && r.ok ? `✅ ${id} 연결 OK — ${url}`
        : `❌ ${id} 연결 실패 — ${url}${r && (r.error || r.status) ? ` (${r.error || r.status})` : ''}`;
      setStatus(msg); setSettingsMsg(msg);
    } catch (e) { logline(e.message); setSettingsMsg('❌ 오류: ' + e.message); }
  }
  // Grok API(비디오) xAI 키
  async function openOllama() {
    try {
      const c = await api.getOllamaConfig(); setOllama(c || {}); setOllamaOpen(true);
      api.listOllamaModels().then((m) => setOllamaModels(m || [])).catch(() => {});
    } catch (e) { logline('Ollama 설정 읽기 오류: ' + e.message); }
  }
  async function saveOllama() {
    try { await api.setOllamaConfig(ollama); setOllamaOpen(false); setStatus('Ollama 설정 저장됨'); }
    catch (e) { logline('저장 오류: ' + e.message); }
  }
  async function testOllamaConn() {
    setStatus('Ollama 연결 테스트…');
    try {
      await api.setOllamaConfig(ollama); // 입력값으로 테스트
      const r = await api.testOllama();
      setOllamaModels(r.models || []);
      if (!r.ok) { setStatus(`✗ 연결 실패 (${r.baseUrl}) — ${r.error || ''}`); return; }
      setStatus(r.hasModel ? `✓ 연결 OK — '${ollama.model}' 설치됨 (모델 ${r.models.length}개)` : `✓ 연결 OK — ⚠ '${ollama.model}' 미설치 (모델 ${r.models.length}개)`);
    } catch (e) { logline('테스트 오류: ' + e.message); setStatus('테스트 오류'); }
  }
  async function openScriptEdit() {
    if (!loaded) { setStatus('대본을 먼저 여세요'); return; }
    try { const t = await api.getScriptText(); setScriptText(t || ''); setScriptEditOpen(true); }
    catch (e) { logline('대본 읽기 오류: ' + e.message); }
  }
  async function applyScriptEdit() {
    setStatus('대본 수정 적용 중…');
    const text = (scriptEditRef.current && scriptEditRef.current.value != null) ? scriptEditRef.current.value : scriptText;
    try { const d = await api.applyScriptText({ text }); if (d) { setDto(d); setFtitle(d.fileTitle || ftitle); } setScriptEditOpen(false); setStatus('대본 수정 적용 완료'); }
    catch (e) { logline('대본 수정 오류: ' + e.message); setStatus('오류'); }
  }
  function abort() { queueAbortRef.current = true; api.abort(); setStatus('중단 요청됨'); }

  // ── 채널 설정 편집 ──
  // Electron 렌더러는 window.prompt 를 지원하지 않으므로(조용히 null) 이름 입력은 별도 모달로 받는다.
  function addChannel() { setNewChanName(''); setNewChanOpen(true); }
  async function createChannel() {
    const name = (newChanName || '').trim();
    if (!name) { setStatus('채널 이름을 입력하세요'); return; }
    try {
      const ps = await api.addPreset({ name, fromName: presetName || null });
      setPresets(ps || []); setPresetName(name);
      setNewChanOpen(false);
      setStatus(`채널 "${name}" 추가됨 — 세부 설정을 편집하세요`);
      await openChannelEditor(name);   // 바로 편집창 열기
    } catch (e) { uiAlert('채널 추가 실패:\n' + e.message); }
  }
  async function deleteChannel() {
    if (!ch || !ch.name) return;
    if (!uiConfirm(`채널 "${ch.name}" 을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      const ps = await api.removePreset({ name: ch.name });
      setChOpen(false); setPresets(ps || []);
      if (ps && ps.length) setPresetName((ps.find((p) => p.isDefault) || ps[0]).name);
      setStatus(`채널 "${ch.name}" 삭제됨`);
    } catch (e) { uiAlert('채널 삭제 실패:\n' + e.message); }
  }
  // ── 채널 순서 변경 ── 드롭다운에 보이는 순서를 ▲▼ 로 조정 후 저장.
  function openChOrder() {
    setChOrder((presets || []).map((p) => ({ name: p.name, group: p.group || '' })));
    setChOrderOpen(true);
  }
  function moveChOrder(i, dir) {
    setChOrder((cur) => {
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = cur.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  async function saveChOrder() {
    try {
      const ps = await api.reorderPresets(chOrder.map((c) => c.name));
      if (ps) setPresets(ps);
      setChOrderOpen(false); setStatus('채널 순서 저장됨');
    } catch (e) { logline('채널 순서 저장 오류: ' + e.message); }
  }
  async function openChannelEditor(nameArg) {
    // ⚙ 버튼 onClick 은 이벤트 객체를 넘기므로, 문자열일 때만 인자 이름으로 사용.
    const useName = (typeof nameArg === 'string' && nameArg) ? nameArg : presetName;
    if (!useName) { logline('채널을 먼저 선택하세요'); return; }
    const p = await api.getPresetDetail(useName);
    if (!p) { logline('채널 정보를 찾을 수 없습니다'); return; }
    const ss = await api.listStyles();
    setChStyles(ss || []);
    try { setChRefList(await api.listRefAudio() || []); } catch (_) { setChRefList([]); }
    const lf = (modeProfiles && modeProfiles.longform) || {};
    // 저장된 캡션 or mode-profile 기본값 → {size, align, yAlign, pos, fine}
    const mkCap = (saved, prof) => {
      const yOff = saved && saved.yOffset != null ? saved.yOffset : (prof.captionYOffset != null ? prof.captionYOffset : 0);
      const d = decomposeYOffset(yOff);
      return {
        size: String(saved && saved.size != null ? saved.size : (prof.captionSize || 100)),
        align: (saved && saved.align) || prof.captionAlign || 'center',
        yAlign: (saved && saved.yAlign) || prof.captionYAlign || 'middle',
        pos: d.pos, fine: d.fine,
      };
    };
    const sl = p.split || { introSentenceSize: p.introSentenceSize, mainSentenceSize: p.mainSentenceSize, shortLen: p.shortLen, longLen: p.longLen };
    setCh({
      name: p.name || '', group: p.group || '', engine: p.engine || 'omnivoice',
      // 옛 값('shorts'/'playlist')은 여는 순간 정규화 — 안 하면 저장할 때 제거된 값이 파일에 되쓰인다.
      // 🔴 새 모드를 여기 안 넣으면 **고르고 저장해도 다음에 열 때 롱폼으로 되돌아간다**(v0.3.50 과 같은 사고).
      startMode: (p.startMode === 'book' || p.startMode === 'remotion') ? p.startMode : 'longform', voice: p.voice || '',
      voiceCloneRefAudio: p.voiceCloneRefAudio || '', voiceCloneRefText: p.voiceCloneRefText || '',
      scriptFolder: p.scriptFolder || '', seed: p.seed != null ? p.seed : '',
      dictPath: p.dictPath || '',   // 🎬 리모션 발음사전 — 안 실으면 저장할 때 빈 값으로 덮인다
      outImages: p.outImages || '', // 🖼 리모션 그림 출력 뿌리 — 위와 같은 이유로 반드시 싣는다
      imgTsvFolder: p.imgTsvFolder || '', // 🖼 그림목록(TSV) 폴더 — 음성 TSV 의 짝을 여기서 찾는다

      aiNotice: !!(p.aiNotice && p.aiNotice.enabled),
      presetPrompt: p.presetPrompt || '', language: p.language || 'ko',
      silenceSec: p.silenceSec != null ? p.silenceSec : 0,
      cfgValue: p.cfgValue != null ? p.cfgValue : 2,
      capLong: mkCap(p.capLong, lf),
      speedLong: p.speedLong != null ? p.speedLong : (lf.defaultTtsSpeed != null ? lf.defaultTtsSpeed : 1.15),
      styleLong: p.styleLong || p.styleId || 'chibi',
      styleThumb: p.styleThumb || '',   // 🖼 썸네일용 화풍 — 비우면 롱폼 것을 쓴다(대시보드가 그렇게 읽는다)
      imgEngine: p.imgEngine || 'genspark', videoEngine: p.videoEngine || 'grok', // 이미지·비디오 제작 도구 기본값(채널 단위)
      outLong: p.outLong || p.outputFolder || '',
      split: { intro: sl.introSentenceSize || 3, main: sl.mainSentenceSize || 10, short: sl.shortLen || 10, long: sl.longLen || 20, mode: sl.splitMode === 'sentence' ? 'sentence' : (sl.splitMode === 'h2' ? 'h2' : 'h3') },
      _raw: p,
    });
    setChTab('basic'); // 열 때마다 첫 탭부터
    setChOpen(true);
  }
  // 채널(프리셋) 선택 시 그 채널이 지정한 시작 화면(startMode)으로 전환.
  async function switchModeForChannel(name) {
    restoringItemRef.current = false; // 사용자가 채널을 직접 골랐으니 그 채널 기본값(배속·스타일·AI고지)을 적용
    setPresetName(name);
    try {
      const p = await api.getPresetDetail(name);
      // 옛 저장값(startMode:'shorts'|'playlist')은 롱폼으로 정규화 — 제거된 모드 화면에 진입하지 않게.
      const _sm0 = p && p.startMode;
      const sm = (_sm0 === 'book' || _sm0 === 'remotion') ? _sm0 : 'longform';
      setMode(sm);
    } catch {}
  }
  // 모달 내 참조음성 미리듣기
  // 참조음성 표시 이름 — `srv:<이름>`(서버 공용 라이브러리)은 ☁ 를 붙여 구분한다.
  function refLabel(p) {
    const s = String(p || '');
    if (!s) return '';
    return s.startsWith('srv:') ? `☁ ${s.slice(4)}` : s.split(/[\\/]/).pop();
  }
  async function playRef(p) {
    if (!p) return;
    try { const url = await api.readAudio(p); playPreviewUrl(url); }
    catch (e) { logline('미리듣기 실패: ' + e.message); }
  }
  // ── 🎨 보이스디자인 (Qwen3-TTS 온디맨드 서버) ─────────────────────────────
  async function openVoiceDesign() {
    setVdOpen(true); setVdWavUrl(''); setVdGenerated(false); setVdFilename('');
    await vdPrepare();
  }
  // 보이스디자인 서버 주소 저장/테스트 — 빈값이면 이 PC 에서 직접 실행(로컬), 값이 있으면 그 PC 의 서버 사용.
  async function saveVdSrv() {
    try { const c = await api.setQwenDesignConfig({ baseUrl: (vdSrv || '').trim() }); if (c && c.baseUrl != null) setVdSrv(c.baseUrl); }
    catch (e) { logline('보이스디자인 주소 저장 오류: ' + e.message); }
  }
  async function testVdSrv() {
    setSettingsMsg('⏳ 보이스디자인 서버 확인 중…');
    try {
      const st = await api.qwenDesignStatus();
      if (!st) { setSettingsMsg('❌ 상태를 확인할 수 없습니다.'); return; }
      const where = st.remote ? `원격 ${st.target}` : `이 PC (${st.target})`;
      const msg = st.loaded ? `✅ 보이스디자인 준비됨 — ${where}`
        : st.loading ? `⏳ 모델 로딩 중 — ${where} (잠시 후 다시 확인)`
        : st.running ? `⏳ 서버는 떠 있으나 모델 미로드 — ${where}`
        : st.remote ? `❌ 원격 서버에 연결할 수 없습니다 — ${where}\n메인 PC 에서 qwen-design 의 "4_서버_상시실행.bat" 을 실행해 두세요(한 번 켜 두면 계속 대기).`
        : `❌ 서버가 꺼져 있습니다 — ${where}\n${st.installed ? '보이스디자인 창을 열면 자동으로 켜집니다.' : '이 PC 엔 설치돼 있지 않습니다(메인 PC 주소를 넣어 원격으로 쓰세요).'}`;
      setSettingsMsg(msg);
    } catch (e) { setSettingsMsg('❌ 오류: ' + e.message); }
  }
  // 서버 준비(설치 확인 → start). 실패해도 재시도할 수 있게 분리 — 준비 전엔 생성 버튼을 못 누르게 vdReady 로 잠근다.
  async function vdPrepare() {
    setVdReady(false); setVdBusy(true); setVdStatus('설치 확인 중…');
    try {
      const st = await api.qwenDesignStatus();
      if (!st || !st.installed) {
        setVdStatus('⚠ 이 PC 에는 보이스디자인이 설치돼 있지 않습니다.\n⚙ 설정 → 🖧 TTS 서버 의 「보이스디자인」 칸에 메인 PC 주소(예: http://100.112.7.63:9893)를 넣으면 원격으로 쓸 수 있습니다.');
        setVdBusy(false); return;
      }
      setVdStatus(st.remote
        ? `서버 준비 중… (원격 ${st.target})`
        : '서버 준비 중… (첫 실행은 모델 로딩으로 수 분 소요 — 이 창을 닫지 마세요)');
      const r = await api.qwenDesignStart();
      if (r && r.ok) { setVdReady(true); setVdStatus('준비 완료 — 목소리 설명을 입력하고 생성하세요.'); }
      else setVdStatus('⚠ 서버 준비 실패: ' + ((r && r.error) || '알 수 없음') + '\n「🔄 서버 다시 준비」 를 눌러 재시도할 수 있습니다.');
    } catch (e) { setVdStatus('오류: ' + e.message); }
    setVdBusy(false);
  }
  async function vdGenerate() {
    if (!vdInstruct.trim()) { setVdStatus('목소리 설명을 먼저 입력하세요.'); return; }
    setVdBusy(true); setVdStatus('목소리 생성 중… (수 초)');
    try {
      const r = await api.qwenDesignGenerate({ instruct: vdInstruct, text: vdText || undefined });
      if (r && r.ok) {
        const url = await api.readAudio(r.tempPath);
        setVdWavUrl(url || ''); setVdGenerated(true);
        // 슬라이스 초기화 — 기본 구간은 서버가 제안한 "말이 있는 구간"(앞 무음·끝 감쇠 제외)
        const dur = Number(r.durationSec) || 0;
        setVdDur(dur);
        const sg = r.suggest || {};
        setVdSel({ s: Number(sg.start) || 0, e: Number(sg.end) || dur });
        setVdRefText(r.text || vdText || '');
        vdBuildPeaks(url);
        playPreviewUrl(url);
        setVdStatus(`생성 완료 (${dur.toFixed(2)}초) — 들어보고, 쓸 구간을 파형에서 고른 뒤 파일명을 입력해 저장하세요.`);
      } else setVdStatus('⚠ 생성 실패: ' + ((r && r.error) || '알 수 없음'));
    } catch (e) { setVdStatus('오류: ' + e.message); }
    setVdBusy(false);
  }
  // ── ✂ 슬라이스 도우미 ──
  // 파형 봉우리 계산 — Web Audio 로 디코드(추가 의존성 없음). 실패하면 파형만 안 보이고 나머지는 정상 동작.
  async function vdBuildPeaks(url) {
    setVdPeaks(null);
    if (!url) return;
    try {
      const ab = await (await fetch(url)).arrayBuffer();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const audio = await ctx.decodeAudioData(ab);
      const ch = audio.getChannelData(0);
      const N = 900, step = Math.max(1, Math.floor(ch.length / N));
      const peaks = [];
      for (let i = 0; i < N; i++) {
        let mn = 1, mx = -1;
        for (let j = i * step, end = Math.min(ch.length, j + step); j < end; j++) { const v = ch[j]; if (v < mn) mn = v; if (v > mx) mx = v; }
        peaks.push(mn > mx ? { min: 0, max: 0 } : { min: mn, max: mx });
      }
      setVdPeaks(peaks);
      try { ctx.close(); } catch {}
    } catch (e) { logline('파형 표시 실패(기능엔 영향 없음): ' + e.message); }
  }
  const vdClamp = (v) => Math.max(0, Math.min(vdDur || 0, Math.round((Number(v) || 0) * 1000) / 1000));
  // 캔버스 x 좌표 → 초
  function vdSecAt(ev) {
    const c = vdCanvasRef.current; if (!c || !vdDur) return 0;
    const r = c.getBoundingClientRect();
    return vdClamp(((ev.clientX - r.left) / r.width) * vdDur);
  }
  // 드래그: 손잡이 근처를 잡으면 그 쪽을 옮기고, 아니면 새 구간을 그린다
  function vdMouseDown(ev) {
    if (!vdDur) return;
    const t = vdSecAt(ev);
    const near = (vdDur / (vdCanvasRef.current?.clientWidth || 600)) * 8; // 8px 이내
    let mode = 'new';
    if (Math.abs(t - vdSel.s) <= near) mode = 's';
    else if (Math.abs(t - vdSel.e) <= near) mode = 'e';
    let anchor = t;
    if (mode === 'new') setVdSel({ s: t, e: t });
    const move = (e2) => {
      const t2 = vdSecAt(e2);
      if (mode === 's') setVdSel((p) => ({ s: Math.min(t2, p.e - 0.02), e: p.e }));
      else if (mode === 'e') setVdSel((p) => ({ s: p.s, e: Math.max(t2, p.s + 0.02) }));
      else setVdSel({ s: Math.min(anchor, t2), e: Math.max(anchor, t2) });
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  }
  // 「≈N초」 — 시작점부터 약 N초 지점에서, **소리가 아직 살아 있는 마지막 순간**에 끊는다.
  //   🔴 처음엔 "가장 조용한 지점(말이 쉬는 곳)"을 찾게 만들었는데 **정반대였다** — 그 조용한 곳이 바로
  //     우리가 없애려던 문장 끝 감쇠·무음이라, 잘라도 끝이 0%인 참조음성이 나왔다(실측 3.0%·0.1%).
  //     에너지 임계 기준으로 끊으면 20~38% 로 살아난다. 끝맺음이 또렷한 게 목적이므로 이쪽을 택한다.
  //   ⚠ 대신 단어 중간에서 끊길 수 있다 → 참조텍스트에서 마지막 조각 단어를 빼라고 안내한다.
  function vdCutAbout(sec) {
    if (!vdDur) return;
    const target = Math.min(vdDur, vdSel.s + sec);
    if (!vdPeaks || !vdPeaks.length) { setVdSel((p) => ({ ...p, e: Math.max(p.s + 0.02, target) })); return; }
    const secOf = (i) => (i / vdPeaks.length) * vdDur;
    const energy = (i) => Math.abs(vdPeaks[i].max) + Math.abs(vdPeaks[i].min);
    // 임계는 **최대 진폭이 아니라 "말하는 구간의 대표 음량"** 기준. 최대값 기준(peak×0.4)으로 하면
    //   순간적으로 튄 한 지점이 기준을 끌어올려 통과 지점이 드물어지고, 결과가 목표보다 훨씬 짧아졌다
    //   (실측: 5초 요청에 3.50초). 대표음량×0.8 이면 4.93초·끝 27.5% 로 균형이 맞는다.
    const all = vdPeaks.map((p) => Math.abs(p.max) + Math.abs(p.min));
    const peak = Math.max(...all);
    const loud = all.filter((v) => v >= peak * 0.1).sort((a, b) => a - b);
    const th = (loud[Math.floor(loud.length / 2)] || peak) * 0.8;
    // 목표(≈N초) 앞뒤 1.5초 안에서, 소리가 또렷한 지점 중 **목표에 가장 가까운** 곳.
    //   앞쪽만 보면 직전에 긴 쉼이 있을 때 3.5초처럼 많이 짧아진다 → 뒤쪽도 함께 본다.
    let at = -1, bestD = Infinity;
    for (let i = 0; i < vdPeaks.length; i++) {
      const t = secOf(i);
      if (t <= vdSel.s + 0.3 || t > Math.min(vdDur, target + 1.5)) continue;
      if (energy(i) < th) continue;
      const d = Math.abs(t - target);
      if (d < bestD) { bestD = d; at = t; }
    }
    const end = vdClamp(Math.max(vdSel.s + 0.02, (at >= 0 ? at + 0.03 : target)));
    setVdSel((p) => ({ ...p, e: end }));
    setVdStatus(`✂ ${end.toFixed(2)}초에서 끊었습니다 (소리가 살아 있는 지점) — ⚠ 참조텍스트를 여기까지 들리는 말로 맞추세요. 끝이 잘린 단어는 빼는 게 좋습니다.`);
  }
  // 선택 구간만 재생 — 잘라낸 결과가 어떻게 들릴지 확인
  function vdPlaySel() {
    const a = vdAudioRef.current; if (!a) return;
    a.currentTime = vdSel.s; a.play();
    const stop = () => { if (a.currentTime >= vdSel.e) { a.pause(); a.removeEventListener('timeupdate', stop); } };
    a.addEventListener('timeupdate', stop);
  }
  async function vdSave() {
    const fn = (vdFilename || '').trim();
    if (!fn) { setVdStatus('저장할 파일명을 입력하세요.'); return; }
    if (!vdGenerated) { setVdStatus('먼저 목소리를 생성하세요.'); return; }
    if (vdDur && vdSel.e <= vdSel.s) { setVdStatus('⚠ 저장할 구간이 비어 있습니다.'); return; }
    setVdBusy(true); setVdStatus('저장 중…');
    try {
      const r = await api.qwenDesignSave({ filename: fn, startSec: vdSel.s, endSec: vdSel.e, text: vdRefText });
      if (r && r.ok) {
        try { const list = await api.listRefAudio(); setChRefList(Array.isArray(list) ? list : []); } catch {}
        setCh((c) => ({ ...c, voiceCloneRefAudio: r.path, voiceCloneRefText: r.text || vdRefText }));
        setVdFilename('');
        setVdStatus(`✔ 저장됨: ${r.name} (${(r.durationSec || 0).toFixed(2)}초) — 참조음성 목록에 추가 + 이 채널에 지정했습니다. (채널편집 창에서 “저장”을 눌러야 최종 반영)`);
      } else setVdStatus('⚠ 저장 실패: ' + ((r && r.error) || '알 수 없음'));
    } catch (e) { setVdStatus('오류: ' + e.message); }
    setVdBusy(false);
  }
  async function closeVoiceDesign() {
    setVdOpen(false); setVdReady(false); // 서버를 끄므로 준비 상태도 해제(다시 열면 재준비)
    setVdGenerated(false); setVdWavUrl(''); setVdPeaks(null); setVdDur(0); setVdSel({ s: 0, e: 0 }); // 지난 파형·구간이 남지 않게
    try { await api.qwenDesignStop(); } catch {}
  }
  async function saveChannel() {
    if (!ch) return;
    const numOr = (v, d) => (v !== '' && v != null && !isNaN(Number(v)) ? Number(v) : d);
    const capToStyle = (c) => ({ size: String(c.size), align: c.align, yAlign: c.yAlign, yOffset: yOffsetOf(c) });
    const patch = {
      group: (ch.group || '').trim(),                     // 드롭다운 구분(그룹) — 같은 그룹끼리 묶고 ─── 그룹명 ─── 구분선
      engine: ch.engine || 'omnivoice',
      startMode: ch.startMode || 'longform',              // 이 채널 선택 시 시작할 화면(모드)
      dictPath: (ch.dictPath || '').trim(),               // 🎬 리모션 발음사전(.md) — 비우면 사전 없이 합성
      outImages: (ch.outImages || '').trim(),             // 🖼 리모션 그림 출력 뿌리(TSV 1번 칸이 그 아래 경로)
      imgTsvFolder: (ch.imgTsvFolder || '').trim(),       // 🖼 그림목록 TSV 폴더(같은 번호끼리 자동 연결)
      voice: ch.voice || '',                              // 음성 식별자(레거시 값 보존 — 표시용)
      voiceCloneRefAudio: (ch.voiceCloneRefAudio || '').trim(),
      voiceCloneRefText: (ch.voiceCloneRefText || '').trim(),
      scriptFolder: (ch.scriptFolder || '').trim(),       // 대본폴더 공유
      presetPrompt: ch.presetPrompt || '',
      language: ch.language || 'ko',
      silenceSec: numOr(ch.silenceSec, 0),
      cfgValue: numOr(ch.cfgValue, 2),
      // 캡션/배속/스타일/출력 — ⚠ 옛 쇼츠 필드(capShort·speedShort·styleShort·outShort)는 patch 에서 빼기만 한다.
      //   preset-store.update 가 {...old,...patch} 병합이라 기존 저장값은 파일에 무해하게 남는다(마이그레이션 삭제 금지 — v0.3.8 계열).
      capLong: capToStyle(ch.capLong),
      speedLong: numOr(ch.speedLong, 1.15),
      styleLong: ch.styleLong,
      styleThumb: ch.styleThumb || '',
      imgEngine: ch.imgEngine || 'genspark', videoEngine: ch.videoEngine || 'grok', // 이미지·비디오 제작 도구(채널 기본값)
      outLong: (ch.outLong || '').trim(),
      // 분할옵션(롱폼)
      split: { introSentenceSize: numOr(ch.split.intro, 3), mainSentenceSize: numOr(ch.split.main, 10), shortLen: numOr(ch.split.short, 10), longLen: numOr(ch.split.long, 20), splitMode: ch.split.mode === 'h2' ? 'h2' : (ch.split.mode === 'sentence' ? 'sentence' : 'h3') },
      aiNotice: { ...((ch._raw && ch._raw.aiNotice) || {}), enabled: !!ch.aiNotice },
    };
    if (ch.seed !== '' && ch.seed != null) patch.seed = parseInt(ch.seed, 10);
    const origName = (ch._raw && ch._raw.name) || ch.name;
    const newName = (ch.name || '').trim();
    if (!newName) { logline('채널 이름을 입력하세요'); return; }
    try {
      if (newName !== origName) await api.renamePreset({ oldName: origName, newName }); // 이름부터 바꾸고(같은 id) 그 이름으로 설정 저장
      await api.savePreset({ name: newName, patch });
      await loadPresets(); setPresetName(newName); await loadStyles();
      // 🔑 채널 값을 읽어 쓰는 화면(리모션의 발음사전 표시 등)에 **다시 읽으라**고 알린다.
      //   이름이 안 바뀌면 presetName 이 그대로라 화면이 옛 값을 그대로 들고 있는다(2026-08-26 실사고).
      setPresetRev((r) => r + 1);
      setChOpen(false); setStatus(newName !== origName ? `채널 이름 변경·저장됨 ("${origName}" → "${newName}")` : '채널 설정 저장됨');
    } catch (e) { logline('저장 오류: ' + e.message); }
  }
  async function pickRef() { const f = await api.pickFile({ filters: [{ name: '음성', extensions: ['wav', 'mp3', 'flac', 'm4a'] }] }); if (f) setCh((c) => ({ ...c, voiceCloneRefAudio: f })); }
  async function pickOutLong() { const d = await api.pickDir(); if (d) setCh((c) => ({ ...c, outLong: d })); }
  async function pickScript() { const d = await api.pickDir(); if (d) setCh((c) => ({ ...c, scriptFolder: d })); }
  // 🖼 그림 출력 뿌리 — 하위 폴더·파일명은 그림목록 TSV 의 1번 칸이 정한다.
  async function pickOutImages() { const d = await api.pickDir(); if (d) setCh((c) => ({ ...c, outImages: d })); }
  async function pickImgTsvFolder() { const d = await api.pickDir(); if (d) setCh((c) => ({ ...c, imgTsvFolder: d })); }
  // 🎬 리모션 발음사전(.md 표) — 채널에 저장한다. 매번 손으로 고르면 언젠가 한 번 빠지고,
  //   사전 없이 합성된 것은 캐시 키가 달라 나중에 물릴 때 **그 강 전체가 재합성**된다.
  async function pickDict() {
    const f = await api.pickFile({ filters: [{ name: '발음사전', extensions: ['md', 'txt'] }] });
    if (f) setCh((c) => ({ ...c, dictPath: f }));
  }
  function setSplitField(k, v) { setCh((cur) => ({ ...cur, split: { ...cur.split, [k]: v } })); }
  // 모달 본문자막 한 컬럼(모드별). withSplit=true 면 분할옵션도 포함(롱폼).
  function capColumn(key, label, withSplit) {
    const c = ch[key];
    const set = (patch) => setCh((cur) => ({ ...cur, [key]: { ...cur[key], ...patch } }));
    return (
      <div className="col">
        <h4>{label}</h4>
        <div className="crow"><span className="l">크기</span><select value={c.size} onChange={(e) => set({ size: e.target.value })}>{['25', '50', '75', '90', '100', '110', '125', '150', '200', '250', '300'].map((v) => <option key={v}>{v}</option>)}</select>
          <span className="l">정렬</span><select value={c.align} onChange={(e) => set({ align: e.target.value })}><option value="center">가운데</option><option value="start">왼쪽</option></select></div>
        <div className="crow tri"><span className="l">세로</span><select value={c.yAlign} onChange={(e) => set({ yAlign: e.target.value })}><option value="middle">가운데</option><option value="bottom">아래</option><option value="top">위</option></select>
          <span className="l">위치</span><select value={c.pos} onChange={(e) => set({ pos: e.target.value })}><option value="0.3">아래</option><option value="0.15">약간↓</option><option value="0">가운데</option><option value="-0.15">약간↑</option><option value="-0.3">위</option></select>
          <span className="l">미세</span><input className="n" type="number" value={c.fine} step="10" onChange={(e) => set({ fine: e.target.value })} /></div>
        {withSplit && (
          <>
            <div className="crow" style={{ borderTop: '1px solid var(--line)', paddingTop: 6, marginTop: 6 }}><span className="l" style={{ color: 'var(--hook)' }}>✂ 분할</span><span className="meta">대본 분할 기준</span></div>
            <div className="crow"><span className="l">방식</span><select value={ch.split.mode === 'sentence' ? 'sentence' : (ch.split.mode === 'h2' ? 'h2' : 'h3')} onChange={(e) => setSplitField('mode', e.target.value)}><option value="h3">H3 섹션 단위</option><option value="h2">H2 섹션 단위</option><option value="sentence">문장 단위</option></select>
              <span className="meta">{ch.split.mode === 'sentence' ? '도입부/본론을 문장수로' : ch.split.mode === 'h2' ? 'H2 1개=그룹 1개 (H3 모두 묶음)' : 'H3 1개=그룹 1개'}</span></div>
            {ch.split.mode === 'sentence' && (
              <div className="crow"><span className="l">도입부</span><input className="n" type="number" value={ch.split.intro} onChange={(e) => setSplitField('intro', e.target.value)} />
                <span className="l">본론</span><input className="n" type="number" value={ch.split.main} onChange={(e) => setSplitField('main', e.target.value)} /></div>
            )}
            <div className="crow"><span className="l">짧은</span><input className="n" type="number" value={ch.split.short} onChange={(e) => setSplitField('short', e.target.value)} />
              <span className="l">긴</span><input className="n" type="number" value={ch.split.long} onChange={(e) => setSplitField('long', e.target.value)} /></div>
          </>
        )}
      </div>
    );
  }

  // ── 미리보기 재생 플레이어 (imperative, refs) ──
  const stageVisualRef = useRef(null);
  const stageCapRef = useRef(null);
  const playerInfoRef = useRef(null);
  const playAbortRef = useRef(false);
  const curAudioRef = useRef(null);

  function applyCaptionStyle() {
    const cap = capOverride(); const cs = stageCapRef.current; if (!cs) return;
    if (cap.yAlign === 'bottom') {
      // 아래 기준: 하단 여백 8% + 위로 이동(yOffset 음수). 예: -0.125 → 하단 20.5%.
      const bottomPct = Math.max(2, Math.min(90, 8 + (-cap.yOffset) * 100));
      cs.style.bottom = bottomPct + '%'; cs.style.top = 'auto'; cs.style.transform = 'none';
    } else if (cap.yAlign === 'top') {
      const topPct = Math.max(2, Math.min(90, 8 + cap.yOffset * 100));
      cs.style.top = topPct + '%'; cs.style.bottom = 'auto'; cs.style.transform = 'none';
    } else {
      const topPct = Math.max(6, Math.min(94, 50 + cap.yOffset * 50)); // 가운데 기준
      cs.style.top = topPct + '%'; cs.style.bottom = 'auto'; cs.style.transform = 'translateY(-50%)';
    }
    cs.style.textAlign = cap.align === 'center' ? 'center' : 'left';
    cs.style.fontSize = Math.round((parseFloat(cap.size) || 90) / 90 * 18) + 'px';
  }
  function setVisual(c) {
    const v = stageVisualRef.current; if (!v) return;
    if (c.videoPath) v.innerHTML = `<video src="${media(c.videoPath)}" autoplay muted loop playsinline></video>`;
    else if (c.imagePath) {
      // 그룹마다 다른 켄번스 변형(vrew 와 동일 분포: (n*7+3)%12) → 단조롭지 않게.
      const kbIdx = ((Number(c.num) || 0) * 7 + 3) % 12;
      v.innerHTML = `<img class="kb kb${kbIdx}" src="${media(c.imagePath)}">`;
      const im = v.querySelector('img.kb'); if (im) { im.style.animation = 'none'; void im.offsetWidth; im.style.animation = ''; }
    } else v.innerHTML = `<div style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;color:#998">이미지나 비디오가 없음</div>`;
  }
  async function stepCaptions(clips, durMs) {
    const total = clips.reduce((a, c) => a + Math.max(1, mLen(c)), 0) || 1;
    for (const cl of clips) {
      if (playAbortRef.current) return;
      if (stageCapRef.current) stageCapRef.current.textContent = cl;
      await wait(Math.max(250, durMs * (Math.max(1, mLen(cl)) / total)));
    }
  }
  async function playCut(c, info) {
    setVisual(c); if (playerInfoRef.current) playerInfoRef.current.textContent = info;
    const N = effCap;
    const sents = (c.sentences && c.sentences.length) ? c.sentences : [{ text: '', audio: null, dur: c.groupDurationSec || 2.5 }];
    for (const s of sents) {
      if (playAbortRef.current) return;
      if (curAudioRef.current) { try { curAudioRef.current.pause(); } catch (_) {} curAudioRef.current = null; }
      const clips = splitLines(s.text || '', N); const dur = s.dur || 2.5;
      if (s.audio) {
        try {
          const url = await api.readAudio(s.audio);
          if (url) { const a = new Audio(url); curAudioRef.current = a; await a.play(); }
          else logline('미리듣기: 오디오 파일을 읽지 못함 (' + s.audio + ')');
        } catch (e) { logline('미리듣기 오디오 실패: ' + e.message); }
      }
      if (playAbortRef.current) return;
      await stepCaptions(clips.length ? clips : [''], dur * 1000);
    }
  }
  async function playProjects(projs, blackBetween) {
    playAbortRef.current = false; setPlayerOpen(true);
    await wait(0); applyCaptionStyle();
    for (let pi = 0; pi < projs.length; pi++) {
      const pr = projs[pi];
      for (const c of pr.cuts) { if (playAbortRef.current) return; await playCut(c, `${pr.title} · G${c.num} ${c.phase || ''}`); }
      if (blackBetween && pi < projs.length - 1 && !playAbortRef.current) {
        if (stageVisualRef.current) stageVisualRef.current.innerHTML = '';
        if (stageCapRef.current) stageCapRef.current.textContent = '';
        if (playerInfoRef.current) playerInfoRef.current.textContent = '— 다음 영상 —';
        await wait(1000);
      }
    }
    stopStageVideo(); // 마지막 그룹 영상 무한반복 방지 — 시퀀스 끝나면 정지
    if (!playAbortRef.current && playerInfoRef.current) playerInfoRef.current.textContent = '재생 완료';
  }
  // 스테이지의 영상 정지 (loop 무한반복 차단)
  function stopStageVideo() {
    const v = stageVisualRef.current && stageVisualRef.current.querySelector('video');
    if (v) { try { v.pause(); } catch (_) {} }
  }
  function playShorts(shortsNum) {
    if (!dto) return;
    const projs = dto.projects.filter((p) => shortsNum == null || p.shortsNum === shortsNum);
    if (projs.length) playProjects(projs, shortsNum == null);
  }
  function playGroup(shortsNum, groupNum) {
    if (!dto) return;
    const pr = dto.projects.find((p) => p.shortsNum === shortsNum); if (!pr) return;
    const c = pr.cuts.find((x) => x.num === groupNum); if (!c) return;
    playAbortRef.current = false; setPlayerOpen(true);
    (async () => { await wait(0); applyCaptionStyle(); await playCut(c, `${pr.title} · G${c.num}`); stopStageVideo(); if (!playAbortRef.current && playerInfoRef.current) playerInfoRef.current.textContent = '재생 완료'; })();
  }
  function stopPlayer() {
    playAbortRef.current = true;
    if (curAudioRef.current) { try { curAudioRef.current.pause(); } catch (_) {} curAudioRef.current = null; }
    if (stageVisualRef.current) stageVisualRef.current.innerHTML = '';
    if (stageCapRef.current) stageCapRef.current.textContent = '';
    setPlayerOpen(false);
  }
  // 팝업/모달 닫기 = 바깥 클릭이 아니라 ESC 또는 취소·닫기 버튼으로만 (실수 클릭에 입력 유실 방지).
  //   여러 개가 겹쳐 떠 있어도 최상단(가장 나중에 연) 하나만 닫는다.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (preview) { setPreview(null); return; }
      if (playerOpen) { stopPlayer(); return; }
      if (nameAsk) { nameAskCancel(); return; }        // 이름 입력(다른 모달 위에 뜸) — 가장 먼저
      if (promptView) { setPromptView(null); return; }
      if (settingsOpen) { setSettingsOpen(false); return; }
      if (chOrderOpen) { setChOrderOpen(false); return; }
      if (ttsSrvOpen) { setTtsSrvOpen(false); return; }
      if (comfyOpen) { setComfyOpen(false); return; }
      if (cvidOpen) { setCvidOpen(false); return; }
      if (tsOpen) { setTsOpen(false); return; }
      if (impOpen) { setImpOpen(false); return; }
      if (scriptEditOpen) { setScriptEditOpen(false); return; }
      if (ollamaOpen) { setOllamaOpen(false); return; }
      if (vdOpen) { closeVoiceDesign(); return; }
      if (dictOpen) { setDictOpen(false); return; }
      if (styleEditOpen) { setStyleEditOpen(false); return; }
      if (chOpen) { setChOpen(false); return; }
      if (newChanOpen) { setNewChanOpen(false); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, playerOpen, nameAsk, promptView, settingsOpen, chOrderOpen, ttsSrvOpen, comfyOpen, cvidOpen, tsOpen, impOpen, scriptEditOpen, ollamaOpen, vdOpen, dictOpen, styleEditOpen, chOpen, newChanOpen]);
  // 자막 옵션 변경 시 재생 중이면 즉시 반영
  useEffect(() => { if (playerOpen) applyCaptionStyle(); /* eslint-disable-next-line */ }, [capPos, capFine, capAlign, capSize, capYAlign, playerOpen]);
  // Genspark 한도 쿨다운(재설정 시각) — 마운트 시 + 60초마다 조회. 저장값(json)을 읽으므로 앱 재시작해도 유지.
  useEffect(() => {
    let alive = true;
    const tick = () => {
      api.gensparkCooldown().then((r) => { if (alive) setGsCool(r); }).catch(() => {});
      api.grokCooldown().then((r) => { if (alive) setGrokCool(r); }).catch(() => {});
    };
    tick(); const iv = setInterval(tick, 60000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  // 화면 내 검색(Ctrl+F) — 모든 모드 공통. Electron find-in-page 로 렌더 텍스트 찾기·이동.
  useEffect(() => {
    api.onFindResult((r) => setFindRes(r || { active: 0, total: 0 }));
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault(); setFindOpen(true);
        setTimeout(() => { const el = document.getElementById('find-input'); if (el) { el.focus(); el.select(); } }, 30);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // findInPage 는 무거운 DOM(대본 수십 컷+영상)에서 호출당 전체 스캔이라, 타이핑마다 부르면 프리징.
  //   → 타이핑(findNext=false)은 디바운스(280ms)로 멈춘 뒤 1번만, Enter/화살표(findNext=true)는 즉시.
  function runFind(text, findNext, forward) {
    findTextRef.current = text;              // state 로 두면 타이핑마다 전 화면 재렌더 → 입력이 멈춘다
    if (findTimerRef.current) { clearTimeout(findTimerRef.current); findTimerRef.current = null; }
    if (!text) { api.findStop(); setFindRes({ active: 0, total: 0 }); return; }
    const fire = () => api.findInPage({ text, findNext: !!findNext, forward: forward !== false });
    if (findNext) fire();
    else findTimerRef.current = setTimeout(fire, 280);
  }
  function closeFind() { if (findTimerRef.current) { clearTimeout(findTimerRef.current); findTimerRef.current = null; } api.findStop(); setFindOpen(false); setFindRes({ active: 0, total: 0 }); }
  // 보이스디자인 파형 그리기 — 봉우리/선택구간이 바뀔 때마다 다시 그린다.
  useEffect(() => {
    const c = vdCanvasRef.current;
    if (!c || !vdOpen) return;
    const W = c.width = c.clientWidth * (window.devicePixelRatio || 1);
    const H = c.height = 110 * (window.devicePixelRatio || 1);
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#faf6ef'; g.fillRect(0, 0, W, H);
    const x = (sec) => (vdDur ? (sec / vdDur) * W : 0);
    // 선택 구간 강조 + 버리는 구간은 흐리게
    if (vdDur) {
      g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, 0, x(vdSel.s), H); g.fillRect(x(vdSel.e), 0, W - x(vdSel.e), H);
      g.fillStyle = 'rgba(193,138,66,0.13)'; g.fillRect(x(vdSel.s), 0, x(vdSel.e) - x(vdSel.s), H);
    }
    if (vdPeaks && vdPeaks.length) {
      const mid = H / 2;
      for (let i = 0; i < vdPeaks.length; i++) {
        const px = (i / vdPeaks.length) * W, sec = vdDur * (i / vdPeaks.length);
        g.fillStyle = (sec >= vdSel.s && sec <= vdSel.e) ? '#8a6a3a' : '#c9c2b6';   // 선택 밖은 회색
        const y1 = mid - vdPeaks[i].max * mid * 0.92, y2 = mid - vdPeaks[i].min * mid * 0.92;
        g.fillRect(px, y1, Math.max(1, W / vdPeaks.length), Math.max(1, y2 - y1));
      }
    } else {
      g.fillStyle = '#b9b2a6'; g.font = `${12 * (window.devicePixelRatio || 1)}px sans-serif`;
      g.fillText('파형 준비 중…', 10, H / 2);
    }
    // 손잡이
    if (vdDur) for (const [sec, col] of [[vdSel.s, '#c18a42'], [vdSel.e, '#c0392b']]) {
      g.fillStyle = col; g.fillRect(Math.max(0, Math.min(W - 2, x(sec) - 1)), 0, 3, H);
    }
  }, [vdPeaks, vdSel, vdDur, vdOpen]);
  // 렌더러에서 난 예외·거부를 로그창에 남긴다 — 예전엔 조용히 죽어 "아무것도 안 된다"만 남았다.
  useEffect(() => {
    window.__logline = logline;
    const onErr = (e) => {
      const m = (e && e.message) || (e && e.reason && e.reason.message) || String((e && e.reason) || '');
      if (m) logline('🐞 화면 오류: ' + m);
    };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onErr);
    return () => { window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr); };
    /* eslint-disable-next-line */
  }, []);
  // 참조음성 목록이 **서버(☁) 기준**으로 바뀌었으므로, 옛 로컬 경로로 저장된 채널 값을 같은 이름의 ☁ 항목으로 맞춘다.
  //   같은 목소리를 가리키는 값 정규화일 뿐이고, 실제 반영은 사용자가 「저장」을 눌러야 된다.
  useEffect(() => {
    if (!ch || !chRefList.length) return;
    const cur = String(ch.voiceCloneRefAudio || '');
    if (!cur || cur.startsWith('srv:')) return;
    const base = (cur.split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, '');
    const hit = chRefList.find((r) => r.path === `srv:${base}`);
    if (hit) setCh((c) => ({ ...c, voiceCloneRefAudio: hit.path }));
    /* eslint-disable-next-line */
  }, [chRefList, ch && ch.voiceCloneRefAudio]);
  // ComfyUI 설정을 마운트 시 로드 — 헤더 드롭다운이 등록된 워크플로(z-image·Krea2 등) 목록을 알도록.
  useEffect(() => {
    api.getComfyImageConfig().then((c) => {
      if (!c) return;
      if ((!c.workflows || !c.workflows.length) && c.workflowPath) c.workflows = [{ name: (c.workflowPath.split(/[\\/]/).pop() || '워크플로').replace(/\.json$/i, ''), path: c.workflowPath }];
      setComfyCfg(c);
    }).catch(() => {});
    api.getComfyVideoConfig().then((c) => {
      if (!c) return;
      if ((!c.workflows || !c.workflows.length) && c.workflowPath) c.workflows = [{ name: (c.workflowPath.split(/[\\/]/).pop() || '워크플로').replace(/\.json$/i, ''), path: c.workflowPath }];
      setCvidCfg(c);
    }).catch(() => {});
  }, []);
  // 나노바나나2 배치 — 현재 대본에 미회수 배치가 있는지 조회(엔진=gemini·대본 바뀔 때)
  const refreshBatch = () => { api.geminiBatchStatus().then(setGsBatch).catch(() => {}); };
  useEffect(() => { if (imgEngine === 'gemini') refreshBatch(); else setGsBatch(null); /* eslint-disable-next-line */ }, [imgEngine, ftitle]);
  // ── 통합 설정 팝업 — ComfyUI 이미지·비디오 · API키(제미나이/나노바나나·xAI) · TTS서버를 한 곳에서(탭). ──
  // ── 👤 계정 통합 관리 (⚙ 설정 → 계정 탭) — 2026-08-19 ───────────────────────
  // Genspark · Flow · Grok 계정이 서로 다른 모달 3개에 흩어져 있던 것을 한 화면으로 모았다.
  // 🔒 비밀번호는 저장만 하고 되돌려 받지 않는다(hasPassword 플래그만). OS 암호화(safeStorage).
  const ACCT_SVCS = [
    { id: 'genspark', icon: '🖼', name: 'Genspark', note: '이미지 생성 (순환 1번)' },
    { id: 'flow', icon: '🖼', name: 'Google Flow', note: '이미지 생성 (순환 2번)' },
    { id: 'grok', icon: '🎬', name: 'Grok (X)', note: '비디오 생성 (브라우저)' },
  ];
  const ACCT_API = {
    genspark: { add: 'addGensparkAccount', rm: 'removeGensparkAccount', ren: 'renameGensparkAccount', cap: 'setGensparkCap', login: 'gensparkLogin' },
    flow: { add: 'addFlowAccount', rm: 'removeFlowAccount', ren: 'renameFlowAccount', cap: 'setFlowCap', login: 'flowLogin' },
    grok: { add: 'addGrokAccount', rm: 'removeGrokAccount', ren: 'renameGrokAccount', cap: 'setGrokCap', login: 'grokLogin' },
  };
  async function loadAcct() {
    try {
      const out = {};
      for (const s of ACCT_SVCS) out[s.id] = await api.getAccountStatus(s.id);
      setAcct(out);
    } catch (e) { logline('계정 목록 오류: ' + e.message); }
    try { setCredsOk(await api.credsAvailable()); } catch (_) { setCredsOk(false); }
  }
  async function acctDo(svc, fn, ...args) {
    try { await api[ACCT_API[svc][fn]](...args); } catch (e) { logline(`계정 작업 오류: ${e.message}`); }
    await loadAcct();
  }
  async function acctAdd(svc) {
    const label = (await askName('새 계정 이름 (예: 채널A, 부계정)', '')) || '';
    if (!label.trim()) return;
    await acctDo(svc, 'add', label.trim());
  }
  async function acctRemove(svc, id, label) {
    if (!(await uiConfirm(`계정 "${label}" 을 목록에서 지울까요?\n(브라우저 프로필·쿠키는 남습니다)`))) return;
    try { await api.clearAccountCreds(svc, id); } catch (_) {}
    await acctDo(svc, 'rm', id);
  }
  async function acctLogin(svc, id) {
    setStatus(`${svc} 로그인 창 여는 중…`);
    setSettingsMsg('⏳ 로그인 창이 열립니다. 저장된 아이디·비밀번호가 있으면 자동 입력되고, CAPTCHA·2단계 인증이 나오면 직접 마무리하세요.');
    try {
      const r = await api[ACCT_API[svc].login](id);
      const msg = r && r.ok ? '✅ 로그인 완료 — 쿠키가 프로필에 저장됐습니다.' : `❌ 로그인 실패${r && r.error ? ` (${r.error})` : ''}`;
      setStatus(msg); setSettingsMsg(msg);
    } catch (e) { setSettingsMsg('❌ 오류: ' + e.message); }
    await loadAcct();
  }
  async function acctSaveCreds(svc, id) {
    const u = (acctEdit[`${svc}:${id}:u`] || '').trim();
    const p = acctEdit[`${svc}:${id}:p`] || '';
    if (!u && !p) { setSettingsMsg('⏳ 저장할 아이디·비밀번호를 입력하세요.'); return; }
    try {
      const r = await api.setAccountCreds(svc, id, u || undefined, p || undefined);
      setSettingsMsg(r && r.ok ? '✅ 저장했습니다 (OS 암호화). 비밀번호는 화면에 다시 표시되지 않습니다.'
        : `❌ 저장 실패${r && r.error ? ` — ${r.error}` : ''}`);
      // 입력칸의 비밀번호는 즉시 비운다(화면에 남겨두지 않는다)
      setAcctEdit((s) => ({ ...s, [`${svc}:${id}:p`]: '' }));
    } catch (e) { setSettingsMsg('❌ 저장 오류: ' + e.message); }
    await loadAcct();
  }
  async function acctClearCreds(svc, id) {
    if (!(await uiConfirm('저장된 아이디·비밀번호를 지울까요?\n(로그인 쿠키는 그대로 남습니다)'))) return;
    try { await api.clearAccountCreds(svc, id); setSettingsMsg('🔒 자격증명을 지웠습니다.'); } catch (e) { setSettingsMsg('❌ ' + e.message); }
    await loadAcct();
  }
  // 로그인 흔적 표시 — 쿠키 파일 mtime 기준(브라우저를 띄우지 않는다)
  function acctLoginLabel(a) {
    const l = a.login || {};
    if (!l.exists) return { t: '· 로그인 안 함', c: '#a08b6a' };
    if (!l.cookieAt) return { t: '· 로그인 안 함', c: '#a08b6a' };
    if (l.days <= 0) return { t: '· 오늘 사용', c: '#5a8a5a' };
    if (l.days <= 30) return { t: `· ${l.days}일 전 사용`, c: '#5a8a5a' };
    return { t: `· ${l.days}일 전 (만료됐을 수 있음)`, c: '#b0762a' };
  }
  // ⚙ 설정의 로컬/클라우드 램프 — { local:{ing|ok|error}, cloud:{…} }. 실측 결과만 담는다(설정은 안 바뀜).
  const [comfyProbe, setComfyProbe] = useState({});
  const [cvidProbe, setCvidProbe] = useState({});
  //   over = { baseUrl, apiKey } — 화면에서 방금 고친(아직 저장 전일 수 있는) 값. 없으면 저장된 설정으로 실측.
  async function probeComfyTarget(kind, side, over) {
    const set = kind === "video" ? setCvidProbe : setComfyProbe;
    set((p) => ({ ...p, [side]: { ing: true } }));
    const args = { side, ...(over || {}) };
    try {
      const r = kind === "video" ? await api.testComfyVideo(args) : await api.testComfyImage(args);
      set((p) => ({ ...p, [side]: r || { ok: false, error: "응답 없음" } }));
    } catch (e) { set((p) => ({ ...p, [side]: { ok: false, error: e.message } })); }
  }
  // 탭을 열 때 두 쪽을 함께 찔러 본다 — "로컬이 꺼져 있다"를 만들기 전에 알 수 있게.
  function probeBoth(kind) { probeComfyTarget(kind, "local"); probeComfyTarget(kind, "cloud"); }
  async function openSettings(tab) {
    setSettingsTab(tab || 'img');
    // 🆓 무료 이미지 탭이 쓰는 값 — 순환(Flow 모델)·LoRA 수집. 실패해도 나머지 탭은 정상 동작.
    try { setImgRot(await api.getImageRotation()); } catch (_) {}
    try { setLora(await api.getLoraCollect()); } catch (_) {}
    try { setUpCfg(await api.getUpscaleConfig()); } catch (_) {}
    setSettingsMsg(''); // 지난 연결테스트 결과가 남아 오해하지 않게 초기화
    try {
      const ci = (await api.getComfyImageConfig()) || {};
      if ((!ci.workflows || !ci.workflows.length) && ci.workflowPath) ci.workflows = [{ name: (ci.workflowPath.split(/[\\/]/).pop() || '워크플로').replace(/\.json$/i, ''), path: ci.workflowPath }];
      setComfyCfg(ci);
    } catch (_) {}
    try {
      const cv = (await api.getComfyVideoConfig()) || {};
      if ((!cv.workflows || !cv.workflows.length) && cv.workflowPath) cv.workflows = [{ name: (cv.workflowPath.split(/[\\/]/).pop() || '워크플로').replace(/\.json$/i, ''), path: cv.workflowPath }];
      setCvidCfg(cv);
    } catch (_) {}
    try { setGiCfg(await api.getGeminiImageConfig()); } catch (_) {}
    try { setGiKey(await api.getGeminiKey() || ''); } catch (_) {}
    try { setXaiVal(await api.getXaiKey() || ''); } catch (_) {}
    try { const c = await api.getTtsServers(); if (c && !c.error) setTtsSrv({ omnivoice: { baseUrl: (c.omnivoice && c.omnivoice.baseUrl) || '' } }); } catch (_) {}
    try { const q = await api.getQwenDesignConfig(); setVdSrv((q && q.baseUrl) || ''); } catch (_) {}
    // ⚙ 를 열면 로컬·클라우드 양쪽을 바로 찔러 본다 — "로컬이 꺼져 있는데 로컬로 보내고 있었다"를 미리 안다.
    setComfyProbe({}); setCvidProbe({});
    const _t = tab || 'img';
    if (_t === 'img') probeBoth('image');
    if (_t === 'vid') probeBoth('video');
    if ((tab || 'img') === 'acct') { await loadAcct(); }
    setSettingsOpen(true);
  }
  async function openComfy() { return openSettings('img'); }
  async function saveComfyCfg(patch) {
    try { const c = await api.setComfyImageConfig(patch); setComfyCfg(c); } catch (e) { logline('ComfyUI 설정 저장 오류: ' + e.message); }
  }
  async function pickComfyWf() {
    try {
      const r = await api.pickComfyWorkflow();
      if (!r || !r.path) return;
      const guess = (r.path.split(/[\\/]/).pop() || '워크플로').replace(/\.json$/i, '');
      const name = ((await askName('이 워크플로 이름 (예: z-image, Krea2)', guess)) || guess).trim();
      const list = Array.isArray(comfyCfg.workflows) ? comfyCfg.workflows.slice() : [];
      const i = list.findIndex((w) => w.path === r.path);
      if (i >= 0) list[i] = { name, path: r.path }; else list.push({ name, path: r.path });
      await saveComfyCfg({ workflows: list, workflowPath: r.path });
    } catch (e) { logline('워크플로 추가 오류: ' + e.message); }
  }
  async function removeComfyWf(p) { return removeWf(p, comfyCfg, saveComfyCfg); }
  // 워크플로 목록에서 제거 — 지운 게 활성이었으면 남은 것 중 첫 번째로 활성 이동(빈 활성 방지)
  async function removeWf(p, cur, saveCfg) {
    const list = ((cur && cur.workflows) || []).filter((w) => w.path !== p);
    const patch = { workflows: list };
    if ((cur && cur.workflowPath) === p) patch.workflowPath = list[0] ? list[0].path : '';
    await saveCfg(patch);
  }
  // ── ComfyUI 비디오(i2v LTX) ──
  async function openCvid() { return openSettings('vid'); }
  async function saveCvidCfg(patch) {
    try { const c = await api.setComfyVideoConfig(patch); setCvidCfg(c); } catch (e) { logline('ComfyUI 비디오 설정 저장 오류: ' + e.message); }
  }
  async function pickCvidWf() {
    try {
      const r = await api.pickComfyVideoWorkflow();
      if (!r || !r.path) return;
      const guess = (r.path.split(/[\\/]/).pop() || '워크플로').replace(/\.json$/i, '');
      const name = ((await askName('이 i2v 워크플로 이름 (예: LTX2.5)', guess)) || guess).trim();
      const list = Array.isArray(cvidCfg.workflows) ? cvidCfg.workflows.slice() : [];
      const i = list.findIndex((w) => w.path === r.path);
      if (i >= 0) list[i] = { name, path: r.path }; else list.push({ name, path: r.path });
      await saveCvidCfg({ workflows: list, workflowPath: r.path });
    } catch (e) { logline('i2v 워크플로 추가 오류: ' + e.message); }
  }
  async function removeCvidWf(p) { return removeWf(p, cvidCfg, saveCvidCfg); }
  // 헤더 이미지 드롭다운 — ComfyUI 항목은 **모델(워크플로)까지** 고른다.
  //   고르면 그 모드의 주소 + 워크플로를 설정에 저장하고, 엔진 값엔 워크플로 경로만 담는다.
  async function onPickImgEngine(val) { return pickComfy(val, setImgEngine, comfyCfg, saveComfyCfg, 'img'); }
  // 이미지·비디오 공통 처리 (동작이 같아 한 함수로 — 예전엔 두 벌 복사돼 있었다)
  async function pickComfy(val, setEngine, cur, saveCfg, tab) {
    const c = parseComfyVal(val);
    if (!c) { setEngine(val); return; }
    const cloud = (c.cloud == null) ? !!(cur && cur.cloud) : c.cloud;   // 레거시 값이면 현재 모드 유지
    setEngine(c.path ? `comfy::${c.path}` : 'comfy');
    const patch = { cloud, baseUrl: cloud ? ((cur && cur.cloudBaseUrl) || DEF_CLOUD_URL) : ((cur && cur.localBaseUrl) || DEF_LOCAL_URL) };
    if (c.path) patch.workflowPath = c.path;
    await saveCfg(patch);
    if (!c.path) openSettings(tab);                                     // 워크플로가 하나도 없을 때만 설정 안내
  }
  // 비디오 드롭다운 — ComfyUI 항목은 로컬/클라우드 × 모델(LTX2.5·LTX2.3)을 직접 고른다.
  async function onPickVideoEngine(val) { return pickComfy(val, setVideoEngine, cvidCfg, saveCvidCfg, 'vid'); }
  async function submitBatch() {
    setStatus('🌙 배치 제출 중…');
    try {
      const r = await api.geminiBatchSubmit({ styleId: styleId || null });
      if (r && r.ok) { setStatus(`🌙 배치 제출 완료 — ${r.count}장 (몇 시간 뒤 📥 회수)`); refreshBatch(); }
      else setStatus('배치 제출 실패: ' + ((r && r.error) || ''));
    } catch (e) { logline('배치 제출 오류: ' + e.message); }
  }
  async function retrieveBatch() {
    setStatus('📥 배치 회수 확인 중…');
    try {
      const r = await api.geminiBatchRetrieve();
      if (!r || !r.ok) { setStatus('배치 회수: ' + ((r && r.error) || '실패')); return; }
      if (!r.done) { setStatus(`⏳ 배치 진행 중 (${r.state}) — 잠시 뒤 다시 회수`); return; }
      if (r.dto) { setDto(r.dto); setFtitle(r.dto.fileTitle || ''); }
      setStatus(`📥 배치 회수 완료 — ${r.saved || 0}장 저장`); refreshBatch();
    } catch (e) { logline('배치 회수 오류: ' + e.message); }
  }
  // 헤더 생성설정 변경 → 현재 활성 큐 항목에 저장(디바운스). 대본별 개별 설정 보존.
  useEffect(() => {
    const aid = queue && queue[mode] ? queue[mode].activeId : null;
    if (!aid) return;
    const t = setTimeout(() => { api.setQueueSettings(currentSettings(), true).catch(() => {}); }, 300); // keepChannel: 채널은 열 때 값 유지(다음 대본용 채널 선택이 이 항목을 오염시키지 않게)
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetName, styleId, ttsSpeed, imgEngine, videoEngine, vidFrom, vidTo, flowVideoModel, flowCount, aiNotice]);

  async function copyLog() {
    try { await navigator.clipboard.writeText(logText || ''); setStatus('로그 복사됨'); }
    catch (e) { logline('복사 실패: ' + e.message); }
  }

  // 롱폼 분할바 — 카드 헤더(TTS 버튼 앞)로 이동. App 상태(splitOpts/changeSplit)를 쓰므로 여기서 만들어 Cards 로 전달.
  const splitBar = isLf ? (
    <span className="splitbar" title="값 변경 시 자동 재분할 (TTS/이미지 초기화됨)">
      <span className="lab">✂ 분할</span>
      <select title="분할 방식 — H3 섹션 / H2 섹션(그 아래 H3 모두 묶음) / 문장 단위" value={splitOpts.mode} onChange={(e) => changeSplit('mode', e.target.value)}><option value="h3">H3</option><option value="h2">H2</option><option value="sentence">문장</option></select>
      {splitOpts.mode === 'sentence' && (<>
        도입부 <input type="number" value={splitOpts.intro} onChange={(e) => changeSplit('intro', e.target.value)} />
        본론 <input type="number" value={splitOpts.main} onChange={(e) => changeSplit('main', e.target.value)} />
      </>)}
      짧은 <input type="number" value={splitOpts.short} onChange={(e) => changeSplit('short', e.target.value)} />
      긴 <input type="number" value={splitOpts.long} onChange={(e) => changeSplit('long', e.target.value)} />
      {splitOpts.mode === 'sentence' && <button className="ghost introvid" disabled={!loaded} title="도입부 문장만 TTS 후 10초 기준으로 도입부 그룹 재배치" onClick={runIntroVideo}>🎬 도입부 TTS+10초 재배치</button>}
      {/* 📥 통합대본('> 📥 자산출처:' 메타)일 때만 — 각 부의 기존 음성·이미지·비디오를 이어받는다(재생성 0). */}
      {mergeSources > 0 && <button className="ghost" disabled={!loaded} title={`자산출처 ${mergeSources}개에서 기존 TTS·이미지·비디오를 이 작업폴더로 복사해 연결합니다 (대본 열 때 자동 실행 — 이 버튼은 재실행용)`} onClick={runMergePrefill}>📥 이어받기</button>}
    </span>
  ) : null;

  // ── 렌더 ─────────────────────────────────────────────────
  return (
    <>
      {findOpen && (
        <div style={{ position: 'fixed', top: 8, right: 16, zIndex: 9999, display: 'flex', gap: 6, alignItems: 'center', background: 'var(--card, #fff)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px', boxShadow: '0 3px 12px rgba(0,0,0,.18)' }}>
          {/* 비제어 — 검색어를 App state 에 두면 글자마다 전 화면이 다시 그려져 입력이 멈춘다(위 대본수정과 같은 원인) */}
          <input id="find-input" defaultValue={findTextRef.current} placeholder="화면에서 검색… (Enter 다음 / Shift+Enter 이전)" style={{ width: 240 }}
            onChange={(e) => runFind(e.target.value, false)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runFind(findTextRef.current, true, !e.shiftKey); } else if (e.key === 'Escape') { e.preventDefault(); closeFind(); } }} />
          <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 44, textAlign: 'center' }}>{findRes.total ? `${findRes.active}/${findRes.total}` : ''}</span>
          <button className="ghost" title="이전 (Shift+Enter)" style={{ padding: '2px 8px' }} onClick={() => runFind(findTextRef.current, true, false)}>▲</button>
          <button className="ghost" title="다음 (Enter)" style={{ padding: '2px 8px' }} onClick={() => runFind(findTextRef.current, true, true)}>▼</button>
          <button className="ghost" title="닫기 (Esc)" style={{ padding: '2px 8px' }} onClick={closeFind}>✕</button>
        </div>
      )}
      <div className="topsticky">
      <header>
        {/* 상단 행 — 대본·프로젝트 관리 (열기·수정·저장·불러오기·초기화 한 줄로) */}
        <div className="hrow">
          <div className="hleft">
            <h1>🎬 Priming{appVersion ? <span className="ver">v{appVersion}</span> : null}</h1>
            <button className="ghost" title="화면에서 검색 (Ctrl+F) — 대본·문장·곡·원고 등 현재 화면의 글자를 찾아 이동" style={{ padding: '4px 8px' }} onClick={() => { setFindOpen(true); setTimeout(() => { const el = document.getElementById('find-input'); if (el) { el.focus(); el.select(); } }, 30); }}>🔍</button>
            <span className="modetoggle">
              <button className={mode === 'longform' ? 'active' : ''} onClick={() => switchMode('longform')}>롱폼</button>
              <button className={mode === 'remotion' ? 'active' : ''} onClick={() => switchMode('remotion')}>🎬 리모션</button>
              <button className={mode === 'book' ? 'active' : ''} onClick={() => switchMode('book')}>📖 출판</button>
            </span>
            <select title="채널(프리셋) — 고르면 그 채널의 시작 화면으로 전환" value={presetName} onChange={(e) => switchModeForChannel(e.target.value)}>
              {(() => {
                // 그룹별 묶기 + ──── 그룹명 ──── 구분선(선택 불가). 그룹 없는 채널은 위에 먼저.
                const order = []; const byGroup = new Map();
                for (const p of (presets || [])) { const g = p.group || ''; if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); } byGroup.get(g).push(p); }
                order.sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0));
                const out = [];
                for (const g of order) {
                  if (g) out.push(<option key={`__sep_${g}`} value={`__sep_${g}`} disabled style={{ color: '#999' }}>{`──── ${g} ────`}</option>);
                  for (const p of byGroup.get(g)) out.push(<option key={p.name} value={p.name}>{g ? `　${p.name}` : p.name}</option>);
                }
                return out;
              })()}
            </select>
            <button className="ghost" title="채널(프리셋) 설정 편집" style={{ padding: '6px 9px' }} onClick={openChannelEditor}>⚙</button>
            <button className="ghost" title="채널 목록 순서 변경 (드롭다운에 보이는 순서)" style={{ padding: '6px 9px' }} onClick={openChOrder}>↕</button>
            <button className="ghost" title="새 채널 추가 (현재 채널 설정을 복사해서 시작)" style={{ padding: '6px 9px' }} onClick={addChannel}>＋ 채널</button>
            <button className="ghost" title="통합 설정 — ComfyUI 이미지·비디오 연결/워크플로 · API 키(제미나이·나노바나나·Grok) · TTS 서버 주소" style={{ padding: '6px 9px' }} onClick={() => openSettings('img')}>⚙ 설정</button>
            {!noProduction && (<>
              <span className="hgroup">
                <span className="glabel">대본</span>
                <button onClick={openScript}>📂 열기</button>
                <button className="ghost" disabled={!loaded} title="대본 내용 수정 → 재파싱(원본 .md 갱신)" onClick={openScriptEdit}>✏ 수정</button>
                <button className="ghost" title="음성·영상 파일을 텍스트로 변환(STT) → 원본과 같은 폴더에 같은 이름 .txt 생성 (OmniVoice Whisper)" onClick={runStt}>🎧 STT</button>
                <button className="ghost" title="영상에서 오디오만 뽑아 mp3 저장 → 원본과 같은 폴더에 같은 이름 .mp3 (192kbps · Whisper 서버 불필요)" onClick={runExtractMp3}>🎵 mp3</button>
              </span>
              <span className="hgroup">
                <span className="glabel">저장·불러오기</span>
                <button className="ghost" disabled={!loaded} title="현재 대본 작업을 파일로 저장 (saves 폴더에 '작업_제목_날짜.smproj.json'). 자동저장도 항상 켜져 있음" onClick={saveProject}>💾 작업저장</button>
                <button className="ghost" title="저장한 작업 파일 불러오기 (saves 폴더)" onClick={loadProject}>📂 작업열기</button>
                <button className="ghost" title="현재 작업 큐 전체(대본 목록·채널·설정)를 파일로 저장 (saves 폴더에 '큐_날짜.pmqueue.json')" onClick={saveQueueFile}>💾 큐저장</button>
                <button className="ghost" title="저장한 큐를 통째로 불러오기 — 대본 목록 복구 + 각 대본 작업물 이어짐 (saves 폴더)" onClick={loadQueueFile}>📂 큐열기</button>
                <button className="ghost" style={{ color: '#c0392b' }} title="저장 폴더(saves)의 작업·큐 파일을 모두 삭제 (확인 팝업 있음). 진행 중 대본의 자동 이어받기 데이터는 삭제되지 않습니다." onClick={deleteSaves}>🗑 전체삭제</button>
                <button className="ghost" title="새 작업 — 현재 화면 비우기" onClick={resetProject}>🆕 초기화</button>
              </span>
            </>)}
            {isBk && (<>
              <button onClick={openBook}>📖 원고 열기</button>
              <button className="ghost" title="원고를 어떻게 작성하는지 규약 설명이 담긴 샘플 .md 저장 — 복사해서 내용만 바꾸면 바로 책이 됩니다" onClick={async () => { try { const r = await api.bookSaveGuide(); if (r) setStatus('가이드 저장: ' + r.path); } catch (e) { logline(e.message); } }}>📄 작성 가이드</button>
              <button className="ghost" disabled={!loaded} title="원고 내용 수정 → 재파싱(원본 .md 갱신)" onClick={openScriptEdit}>✏ 수정</button>
              <button className="ghost" title="새 작업 — 현재 화면 비우기" onClick={resetProject}>🆕 초기화</button>
            </>)}
            {loaded && (
              <span className="autosave-ind" title="작업은 자동으로 수시 저장됩니다. 같은 대본을 다시 열면 이어서 작업할 수 있어요.">
                {autoSavedAt ? `✓ 자동저장 ${new Date(autoSavedAt).toLocaleTimeString()}` : '자동저장 켜짐'}
              </span>
            )}
          </div>
        </div>
        {/* 제작 파이프라인 행 — 작업 순서대로 ①음성 → ②이미지 → ③비디오 → ④완성 그룹 */}
        {!noProduction && (
        <div className="hrow" style={{ justifyContent: 'flex-start' }}>
          <span className="hgroup">
            <span className="glabel">① 음성</span>
            <span title="음성 배속 (합성 1.0 → atempo 변환)">배속 <input type="number" value={ttsSpeed} step="0.05" min="0.5" max="2" style={{ width: 52 }} onChange={(e) => setTtsSpeed(e.target.value)} /></span>
            <button disabled={!loaded} title="상단 버튼 = 작업큐의 모든 대본 음성 합성 (이미 있는 문장은 건너뜀)" onClick={() => runStageQueue('tts')}>🎤 TTS</button>
            <button className="ghost" disabled={!loaded} title="이미 만든 음성 파일·재활용 캐시를 삭제하고 화면의 시간기록도 지웁니다 (다음 변환은 전부 새로 합성)" onClick={deleteTtsAll}>🗑 삭제</button>
            <button className="ghost" title="발음사전 — TTS가 잘못 읽는 단어를 발음대로 교정(자막은 대본 그대로)" onClick={openDict}>📖 발음사전</button>
          </span>
          <span className="hgroup">
            <span className="glabel">② 이미지</span>
            <button className="ghost" disabled={!loaded || impBusy} title="각 그룹 내용을 분석해 이미지 프롬프트를 자동 작성·적용 (Ollama)" onClick={runMakePrompts}>{impBusy ? '⏳ 작성중…' : '✍ 프롬프트'}</button>
            <button className="ghost" disabled={!loaded} title="Ollama 서버·모델 설정 / 웹 LLM 답변 붙여넣기(고급)" onClick={openOllama}>⚙</button>
            <select title="이미지 스타일" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
              <option value="">스타일 없음</option>
              {styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="ghost" title="이미지 스타일 편집(추가·수정·삭제·프롬프트 복사) — 목록은 다른 PC 와 공유됩니다" onClick={openStyleEditor}>✎</button>
            <select title="이미지 생성 방식 — Flow·Genspark(무료 브라우저, 한도면 서로 이어받음) / 유료(나노바나나2) / ComfyUI 로컬·클라우드 × 모델(Krea2·Z-Image)"
              value={comfySelectValue(imgEngine, comfyCfg)}
              onChange={(e) => onPickImgEngine(e.target.value)}>
              <option value="flow">Flow (무료)</option>
              <option value="genspark">Genspark (무료)</option>
              <option value="gemini">유료(나노바나나2)</option>
              <ComfyEngineOptions cfg={comfyCfg} />
            </select>
            {/* ⚙ 설정 = 버튼 1개(2026-08-26 통합). 지금 고른 엔진에 맞는 탭으로 연다 —
                comfy 면 ComfyUI 탭, Flow·Genspark 면 무료 이미지 탭, 나노바나나면 API 키 탭. */}
            <button className="ghost" title="이미지 설정 — 지금 고른 엔진에 맞는 탭으로 엽니다 (ComfyUI 주소·워크플로 / Flow 모델·LoRA 수집 / API 키)"
              onClick={() => openSettings(isComfyEngine(imgEngine) ? 'img' : (isComfyEngine(videoEngine) ? 'vid' : (imgEngine === 'gemini' ? 'keys' : 'free')))}>⚙</button>
            <button disabled={!loaded} title="상단 버튼 = 작업큐의 모든 대본 이미지 생성 (이미 있는 그룹은 건너뜀)" onClick={() => runStageQueue('image')}>🖼 이미지</button>
            <button className="ghost" disabled={!loaded} title="이미 만든 이미지 파일·재활용 캐시를 삭제합니다 (비디오는 유지 · 다음 생성은 전부 새로 만듭니다)" onClick={deleteImagesAll}>🗑 삭제</button>
            {imgEngine === 'gemini' && (<>
              <button className="ghost" disabled={!loaded} title="나노바나나2 Lite 배치 제출 — 표준가의 50%로 이미지 생성을 예약합니다. 결과는 몇 시간 뒤(최대 24h)에 나오며 「📥 배치회수」로 가져옵니다. 앱을 껐다 켜도 유지됩니다." onClick={submitBatch}>🌙 배치제출</button>
              <button className="ghost" disabled={!loaded} title="제출한 배치 결과를 회수합니다. 완료됐으면 이미지를 가져와 매핑, 아직이면 진행 상태를 알려줍니다." onClick={retrieveBatch}>📥 배치회수{gsBatch && gsBatch.hasJob ? ' ●' : ''}</button>
            </>)}
          </span>
          <span className="hgroup">
            <span className="glabel">③ 비디오</span>
            <select title="i2v 비디오 엔진 — ComfyUI 로컬/클라우드 × 모델(LTX2.5·LTX2.3)" value={comfySelectValue(videoEngine, cvidCfg)} onChange={(e) => onPickVideoEngine(e.target.value)}>
              <option value="grok">Grok (브라우저)</option>
              <option value="grok-api">Grok API (유료)</option>
              <ComfyEngineOptions cfg={cvidCfg} kind="video" />
              <option value="none">없음 (이미지만)</option>
            </select>
            {videoEngine === 'grok' && <button className="ghost" title="Grok(X) 멀티계정 등록·로그인·한도" onClick={() => openSettings('acct')}>⚙ 계정</button>}
            {videoEngine === 'grok-api' && <button className="ghost" title="xAI API 키 입력 (console.x.ai) — 사용량 과금" onClick={() => openSettings('keys')}>⚙ 키</button>}
            {videoEngine === 'none'
              ? <span className="meta" title="비디오 없이 이미지만으로 .vrew 생성 (켄번스)">이미지만(켄번스)</span>
              : (<>
                  <span title="영상으로 만들 그룹 범위 (N번~N번). 롱폼 기본=도입부 그룹만">범위 <input type="number" min="1" style={{ width: 44 }} value={vidFrom} onChange={(e) => setVidFrom(e.target.value)} />~<input type="number" min="1" style={{ width: 44 }} value={vidTo} onChange={(e) => setVidTo(e.target.value)} /></span>
                  <button disabled={!loaded} title={`상단 버튼 = 작업큐의 모든 대본 G${vidFrom}~G${vidTo} 그룹을 i2v 비디오로 변환`} onClick={() => runStageQueue('video')}>🎬 비디오</button>
                  <button disabled={!loaded} title="작업큐 전체 — 모든 대본의 이미지를 먼저 다 만든 뒤, 모든 대본의 비디오 (모델 스왑 1번으로 콜드스타트 최소화)" onClick={() => runStageQueue('imgvid')}>🖼→🎬 이미지+비디오</button>
                </>)}
            <button className="ghost" disabled={!loaded} title="이미 만든 비디오 파일·재활용 캐시를 삭제합니다 (이미지는 유지 → 켄번스로 진행 가능)" onClick={deleteVideosAll}>🗑 삭제</button>
          </span>
          <span className="hgroup" style={{ marginLeft: 'auto' }}>
            <span className="glabel">④ 완성</span>
            <button className="ghost" disabled={!loaded} title="모든 편을 이어서 미리보기 재생" onClick={() => playShorts(null)}>▶ 미리보기</button>
            {(() => { const qc = (queue && queue.longform ? queue.longform.items.length : 0); return (<>
              <button className="cta" disabled={qc < 1} title={qc > 1 ? `큐 ${qc}개 대본을 순서대로 순차 제작` : '현재 대본 TTS+이미지 → 영상 → .vrew → 폴더열기'} onClick={runMakeOrBatch}>⚡ 만들기{qc > 1 ? ` (${qc})` : ''}</button>
              {qc > 1 && <label className="chk" title="체크: 대본이 완료될 때마다 그 .vrew 를 순차적으로 자동 열기(단건과 동일). 해제: 창 폭주 방지를 위해 열지 않고 큐가 끝나면 출력폴더만 1번 열기" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" style={{ width: 'auto' }} checked={openEachVrew} onChange={(e) => setOpenEachVrew(e.target.checked)} />순차 열기</label>}
            </>); })()}
            <button className="ghost stop" title="진행 중인 작업 중단" onClick={abort}>■ 중단</button>
            <button disabled={!loaded} title=".vrew 만 다시 내보내기 (이미 만든 음성·이미지 사용)" onClick={() => runVrew(null)}>💾 .vrew</button>
            <button className="ghost" disabled={!loaded} onClick={() => api.openFolder()}>📁 출력폴더</button>
          </span>
        </div>
        )}
      </header>

      {/* 분할/합치기 바 — 스크롤 내려도 항상 보이도록 topsticky(고정) 안. (출판 모드 제외) */}
      {!noProduction && <div id="capbar">
        {gsCool && gsCool.until > 0 && (
          <span title={`Genspark 이미지가 5시간 한도에 도달했습니다. 이 시각 이후 자동으로 다시 시도합니다. 그 전까지는 순환(무료)이 Genspark 에 접속하지 않고 바로 Flow 로 이미지를 만듭니다. 앱을 껐다 켜도 유지됩니다.`}
            style={{ padding: '3px 9px', borderRadius: 6, background: '#fde8e8', color: '#a3352b', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
            🖼 젠스파크 이미지 생성가능시간: {fmtKoTime(gsCool.until)}
          </span>
        )}
        {grokCool && grokCool.until > 0 && (
          <span title={`Grok 영상이 한도에 도달했습니다. 이 시각 이후 재설정됩니다. 그 전까지는 Grok(브라우저) 영상 생성을 건너뛰고 이미지만 만듭니다(헛되이 브라우저를 띄우지 않음). 앱을 껐다 켜도 유지됩니다.`}
            style={{ padding: '3px 9px', borderRadius: 6, background: '#e8eefd', color: '#2b45a3', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
            🎬 Grok 비디오 생성가능시간: {fmtKoTime(grokCool.until)}
          </span>
        )}
        <span className="grow" />
        <button className="ghost" disabled={!loaded || prog.ttsD === 0}
          title="유튜브 설명글에 넣을 챕터 타임스탬프 — 각 그룹의 TTS 길이를 누적해 만듭니다(상위 H2 섹션 = 챕터 1개). TTS 변환을 끝낸 뒤 누르세요."
          onClick={openTimestamps}>⏱ 타임스탬프</button>
        {splitBar}
        <label className="chk" title="AI 고지 자막 — 체크 시 .vrew 에 삽입 (기본 표시 · 언제든 변경 가능)" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" style={{ width: 'auto' }} checked={aiNotice} onChange={(e) => setAiNotice(e.target.checked)} />AI 고지</label>
        <span className="hdiv" />
        <span className="worktimes" title="진행률(완료/전체) · 괄호=마지막 작업 소요시간">
          ⏱ TTS {prog.ttsD}/{prog.ttsT} ({fmtSec(timings.tts)}) · 이미지 {prog.imgD}/{prog.imgT} ({fmtSec(timings.image)}) · 영상 {prog.vidD}/{prog.vidT} ({fmtSec(timings.video)}) · <b>합계 {fmtSec(timings.tts + timings.image + timings.video)}</b>
          {timings.make > 0 && <> · ⚡전체 {fmtSec(timings.make)}</>}
        </span>
      </div>}
      </div>

      <div id="body">
        <main>
          {isRx ? (
            <RemotionView presetName={presetName} presetRev={presetRev} setStatus={setStatus} logline={logline} />
          ) : isBk ? (
            <BookView dto={dto} setDto={setDto} setStatus={setStatus} logline={logline} />
          ) : (<>
          {queue && queue[mode] && queue[mode].items.length > 0 && (
            <div className="qstrip">
              <span className="qlabel">롱폼 큐 ({queue[mode].items.length})</span>
              {queue[mode].items.map((it) => (
                <div key={it.id}
                  className={'qchip' + (it.active ? ' active' : '') + (it.status && it.status !== 'idle' ? ' s-' + it.status : '')}
                  title={it.file || it.title}
                  onClick={() => { if (!it.active) selectQueueItem(it.id); }}>
                  <span className="qttl">{it.title}</span>
                  <span className="qmeta">{it.projects}편{it.status && it.status !== 'idle' ? ' · ' + (QSTATUS[it.status] || it.status) : ''}</span>
                  <button className="qx" title="큐에서 제거" onClick={(e) => { e.stopPropagation(); removeQueueItem(it.id); }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <ErrorBoundary><Cards dto={dto} isLf={isLf} capCharsN={effCap}
            onTts={runTts} onImg={runImg} onVid={runVid} onImgVid={runImgVid} onBulk={runBulk}
            onPlayShorts={playShorts} onPlayGroup={playGroup} onRegen={runRegen}
            onMake={runMake} onVrew={runVrew} onPremiere={runPremiere} onAttach={attachAsset} onClear={clearAsset}
            onPreview={(kind, src) => setPreview({ kind, src })}
            onPlayFrom={playFrom} onGroupTts={runGroupTts} onGroupVid={runGroupVid} onShowPrompt={showPrompt} onSplit={splitGroup} /></ErrorBoundary>
          </>)}
        </main>
        <aside id="logwrap" className={logCollapsed ? 'collapsed' : ''}>
          <div id="logbar" onClick={(e) => { if (e.target.tagName === 'BUTTON') return; setLogCollapsed((v) => !v); }}>
            <b>로그</b> <span id="status">{status ? '· ' + status : ''}</span>
            <button className="ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={copyLog}>📋 복사</button>
            <button className="ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setLogText('')}>지우기</button>
            <button className="ghost" style={{ padding: '2px 8px', fontSize: 11 }} title="로그 파일 폴더 열기 (하루 1개 · 7일 보관)" onClick={() => { try { api.openLogs(); } catch (_) {} }}>📁 파일</button>
          </div>
          <div id="log" ref={logRef}>{logText}</div>
        </aside>
      </div>

      {preview && (
        <div id="preview" className="show" onClick={(e) => { if (e.target.classList.contains('close')) setPreview(null); }}>
          <div id="previewBody">
            <button className="close" title="닫기">✕</button>
            {preview.kind === 'vid'
              ? <video src={preview.src} controls autoPlay loop />
              : preview.kind === 'audio'
                ? <audio src={preview.src} controls autoPlay style={{ width: 480 }} />
                : <img src={preview.src} alt="" />}
          </div>
        </div>
      )}

      <div id="player" className={playerOpen ? 'show' : ''}>
        <div id="stage" className="lf">
          <div id="stageVisual" ref={stageVisualRef} />
          <div id="stageCap" ref={stageCapRef} />
        </div>
        <div id="playerBar"><span id="playerInfo" ref={playerInfoRef} /><button className="ghost" onClick={stopPlayer}>■ 닫기</button></div>
      </div>

      {newChanOpen && (
        <div className="modal-bg show">
          <div className="modal-card" style={{ maxWidth: 420 }}>
            <h3>＋ 새 채널 추가</h3>
            <div className="meta" style={{ marginBottom: 8 }}>현재 채널 <b>「{presetName || '-'}」</b>의 설정을 복사해 새 채널을 만듭니다. 만든 뒤 편집창에서 세부 설정을 바꾸세요.</div>
            <input autoFocus placeholder="새 채널 이름" style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px' }}
              value={newChanName} onChange={(e) => setNewChanName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createChannel(); }} />
            <div className="mbtns"><button onClick={createChannel}>만들기</button><button className="ghost" onClick={() => setNewChanOpen(false)}>취소</button></div>
          </div>
        </div>
      )}

      {nameAsk && (
        <div className="modal-bg show name-ask-layer">
          <div className="modal-card" style={{ maxWidth: 420 }}>
            <h3>{nameAsk.title || '이름 입력'}</h3>
            <input autoFocus style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px' }} value={nameAsk.value}
              onChange={(e) => setNameAsk({ ...nameAsk, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') nameAskOk(); else if (e.key === 'Escape') nameAskCancel(); }} />
            <div className="mbtns"><button onClick={nameAskOk}>확인</button><button className="ghost" onClick={nameAskCancel}>취소</button></div>
          </div>
        </div>
      )}

      {chOpen && ch && (
        <div className="modal-bg show">
          <div className="modal-card wide tabbed">
            <h3>⚙ 채널(프리셋) 편집 — {(ch._raw && ch._raw.name) || ch.name}</h3>
            {/* 섹션을 세로로 쌓지 않고 탭으로 나눈다 — 스크롤 없이 한 화면에 들어오게 (2026-08-14) */}
            <div className="tabbar">
              {/* 🎬 리모션 채널은 음성만 만든다 — 자막·이미지·비디오가 없으므로 그 두 탭을 감춘다. */}
              {[['basic', '🏠 기본'], ['voice', '🎙 음성'],
                ...(ch.startMode === 'remotion' ? [] : [['caption', '📝 자막·분할'], ['tools', '🖼 제작 도구']]),
                ['folder', '📁 폴더']].map(([id, lbl]) => (
                <button key={id} className={chTab === id ? '' : 'ghost'} style={{ padding: '5px 10px' }} onClick={() => setChTab(id)}>{lbl}</button>
              ))}
            </div>
            <div className="tabbody">

              {chTab === 'basic' && (<div>
                <div className="frow"><label>채널 이름</label>
                  <input style={{ flex: 1, padding: 6, fontWeight: 700 }} value={ch.name || ''} placeholder="채널 이름"
                    onChange={(e) => setCh({ ...ch, name: e.target.value })} title="이름을 바꾸고 저장하면 채널명이 변경됩니다 (설정·큐 참조 유지)" /></div>
                <div className="frow"><label>그룹(구분)</label>
                  <input style={{ flex: 1, padding: 6 }} value={ch.group || ''} placeholder="예: 고전 / 역사 (비우면 구분 없음)" list="ch-group-list"
                    onChange={(e) => setCh({ ...ch, group: e.target.value })} title="같은 그룹 이름끼리 드롭다운에서 묶이고, 그룹마다 ─── 그룹명 ─── 구분선이 자동으로 들어갑니다" />
                  <datalist id="ch-group-list">{[...new Set((presets || []).map((p) => p.group).filter(Boolean))].map((g) => <option key={g} value={g} />)}</datalist></div>
                <div className="frow"><label>시작 화면</label>
                  <select style={{ flex: '0 0 220px', padding: 6 }}
                    value={(ch.startMode === 'book' || ch.startMode === 'remotion') ? ch.startMode : 'longform'}
                    onChange={(e) => setCh({ ...ch, startMode: e.target.value })}>
                    <option value="longform">롱폼 (16:9)</option>
                    <option value="remotion">🎬 리모션 (음성만)</option>
                    <option value="book">📖 출판</option>
                  </select>
                  <span className="meta">{ch.startMode === 'remotion'
                    ? 'TSV(파일명＋문장)를 불러와 그 이름 그대로 mp3 를 만듭니다. 자막·이미지·영상은 리모션이 담당합니다'
                    : '이 채널을 고르면 이 화면으로 시작합니다 (음성 엔진은 OmniVoice 기본)'}</span>
                </div>
                <div className="frow chk"><label>AI 고지</label><input type="checkbox" style={{ flex: '0 0 auto', width: 'auto' }} checked={ch.aiNotice} onChange={(e) => setCh({ ...ch, aiNotice: e.target.checked })} /> <span className="meta">실제 표시는 작업바의 <b>'AI 고지'</b> 토글로 결정 (언제든 변경)</span></div>
              </div>)}

              {/* 음성 = OmniVoice(참조음성 클론) 기준. Supertonic(사전정의 음성) 은 제거됨 — 2026-07-31 */}
              {chTab === 'voice' && (<div>
                <div className="frow"><label>목소리</label><input readOnly title="참조음성 (☁ = 서버 공용 라이브러리 — 이 PC 에 파일이 없어도 됨)" value={refLabel(ch.voiceCloneRefAudio) || ch.voice} style={{ flex: '0 0 170px' }} />
                  <span className="mini">언어</span><select value={ch.language} onChange={(e) => setCh({ ...ch, language: e.target.value })}><option value="ko">한국어</option><option value="en">English</option></select>
                  <span className="mini">시드</span><input className="nbox" type="number" style={{ width: 90, flex: '0 0 auto' }} value={ch.seed} onChange={(e) => setCh({ ...ch, seed: e.target.value })} /></div>
                <div className="frow"><label>참조음성</label>
                  <select style={{ flex: 1, padding: 6 }} value={ch.voiceCloneRefAudio} onChange={(e) => setCh({ ...ch, voiceCloneRefAudio: e.target.value })}>
                    {/* 값이 비면 select 는 **첫 항목을 조용히 가리킨다** — 그 상태로 저장하면 엉뚱한 목소리가 박힌다.
                        (2026-08-14 사고) 명시적 placeholder 를 두어 "선택 안 됨"이 눈에 보이게 한다. */}
                    {!ch.voiceCloneRefAudio ? <option value="">— 선택 안 됨 (목소리를 고르세요) —</option> : null}
                    {chRefList.every((r) => r.path !== ch.voiceCloneRefAudio) && ch.voiceCloneRefAudio ? <option value={ch.voiceCloneRefAudio}>{refLabel(ch.voiceCloneRefAudio)}</option> : null}
                    {chRefList.map((r) => <option key={r.path} value={r.path}>{r.name}</option>)}
                  </select>
                  <button className="ghost" style={{ flex: '0 0 auto' }} title="미리듣기" onClick={() => playRef(ch.voiceCloneRefAudio)}>▶</button>
                  <button className="ghost" style={{ flex: '0 0 auto' }} title="참조음성 폴더 열기 (같은 이름의 .txt 가 참조텍스트로 쓰입니다)" onClick={() => api.openRefFolder(ch.voiceCloneRefAudio || '')}>찾기</button>
                  <button className="ghost" style={{ flex: '0 0 auto' }} title="텍스트 설명으로 새 목소리 만들기 (Qwen3-TTS 보이스디자인)" onClick={openVoiceDesign}>🎨 디자인</button></div>
                <div className="frow"><label>사전설정</label><textarea rows="2" placeholder="예: 30대 한국 남성, 회색 양복, 따뜻한 조명 (모든 이미지 공통)" value={ch.presetPrompt} onChange={(e) => setCh({ ...ch, presetPrompt: e.target.value })} /></div>
                <div className="frow"><label>Clone강도</label><input className="nbox" type="number" step="0.1" value={ch.cfgValue} onChange={(e) => setCh({ ...ch, cfgValue: e.target.value })} />
                  <span className="mini">문장무음</span><input className="nbox" type="number" step="0.1" value={ch.silenceSec} onChange={(e) => setCh({ ...ch, silenceSec: e.target.value })} /><span className="meta">초</span></div>

                <div className="subhead">🔊 음성 배속</div>
                <div className="crow"><span className="l">배속</span><input className="n" style={{ flex: '0 0 62px', width: 62 }} type="number" step="0.05" min="0.5" max="2" value={ch.speedLong} onChange={(e) => setCh({ ...ch, speedLong: e.target.value })} /></div>
              </div>)}

              {chTab === 'caption' && (<div>
                <div className="twocol">{capColumn('capLong', '본문 자막 (16:9)', true)}</div>
              </div>)}

              {chTab === 'tools' && (<div>
                <div className="subhead">🎨 이미지 스타일</div>
                <div className="crow"><span className="l">스타일</span><select value={ch.styleLong} onChange={(e) => setCh({ ...ch, styleLong: e.target.value })}>{chStyles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>

                <div className="crow" style={{ marginTop: 4 }}><span className="l">🖼 썸네일</span>
                  <select value={ch.styleThumb || ''} onChange={(e) => setCh({ ...ch, styleThumb: e.target.value })}>
                    <option value="">— 롱폼과 같게 —</option>
                    {chStyles.map((s2) => <option key={s2.id} value={s2.id}>{s2.name}</option>)}
                  </select></div>
                <div className="meta">☁ 이 채널의 화풍은 <b>~/.flow-app/channel-styles.json</b> 으로 자동 내보내집니다 — 아도나이로이 대시보드가 그 값을 읽어 <b>썸네일 프롬프트</b>를 만듭니다. 썸네일은 인물이 주인공이라 본문과 다른 화풍을 쓸 수 있어 따로 고릅니다(비우면 롱폼과 같게).</div>

                <div className="subhead">🖼 이미지 도구 · 🎬 비디오 도구 (이 채널 기본값)</div>
                <div className="twocol">
                  <div className="col">
                    <div className="crow"><span className="l">이미지</span>
                      {/* 헤더와 같은 구조 — 로컬/클라우드 × 모델을 여기서 바로 고른다(2026-08-14) */}
                      <select value={comfySelectValue(ch.imgEngine || 'genspark', comfyCfg)}
                        onChange={(e) => { const c = parseComfyVal(e.target.value); setCh({ ...ch, imgEngine: c ? (c.path ? `comfy::${c.path}` : 'comfy') : e.target.value }); }}>
                        <option value="flow">Flow (무료)</option>
                        <option value="genspark">Genspark (무료)</option>
                        <option value="gemini">유료(나노바나나2)</option>
                        <ComfyEngineOptions cfg={comfyCfg} />
                      </select></div>
                  </div>
                  <div className="col">
                    <div className="crow"><span className="l">비디오</span>
                      <select value={comfySelectValue(ch.videoEngine || 'grok', cvidCfg)}
                        onChange={(e) => { const c = parseComfyVal(e.target.value); setCh({ ...ch, videoEngine: c ? (c.path ? `comfy::${c.path}` : 'comfy') : e.target.value }); }}>
                        <ComfyEngineOptions cfg={cvidCfg} kind="video" />
                        <option value="grok">Grok (브라우저)</option>
                        <option value="grok-api">Grok API (유료)</option>
                        <option value="none">없음(이미지 고정)</option>
                      </select></div>
                  </div>
                </div>
                <div className="meta" style={{ marginTop: 6 }}>이 채널을 고르면 헤더 이미지·비디오 도구가 이 값으로 세팅됩니다. ComfyUI 는 <b>☁ 클라우드 / 🖥 로컬</b> × 모델(Krea2·Z-Image / LTX2.5·LTX2.3)을 여기서 바로 고르고, 주소·API키는 ⚙ 설정에서 정합니다.</div>
              </div>)}

              {chTab === 'folder' && (<div>
                <div className="frow"><label>{ch.startMode === 'remotion' ? 'TSV 폴더' : '대본 폴더'}</label><input placeholder={ch.startMode === 'remotion' ? 'TSV(.tsv) 폴더' : '대본(.md) 폴더'} value={ch.scriptFolder} onChange={(e) => setCh({ ...ch, scriptFolder: e.target.value })} /><button className="ghost" style={{ flex: '0 0 auto' }} onClick={pickScript}>찾기</button></div>
                {/* 🎬 리모션은 .vrew 를 만들지 않는다 — 나가는 것이 mp3 뿐이라 라벨을 바꿔 오해를 줄인다. */}
                <div className="frow"><label>{ch.startMode === 'remotion' ? 'MP3 출력' : '롱폼 출력'}</label><input placeholder={ch.startMode === 'remotion' ? 'mp3 를 떨어뜨릴 폴더' : '롱폼 .vrew 출력 폴더'} value={ch.outLong} onChange={(e) => setCh({ ...ch, outLong: e.target.value })} /><button className="ghost" style={{ flex: '0 0 auto' }} onClick={pickOutLong}>찾기</button></div>
                {ch.startMode === 'remotion' && (<>
                  <div className="frow"><label>발음사전</label>
                    <input placeholder="발음사전(.md) — 비우면 사전 없이 합성합니다" value={ch.dictPath || ''}
                      onChange={(e) => setCh({ ...ch, dictPath: e.target.value })} />
                    <button className="ghost" style={{ flex: '0 0 auto' }} onClick={pickDict}>찾기</button></div>
                  {/* 🖼 그림목록 TSV 폴더 — 음성 TSV 를 열면 **같은 번호**의 그림목록을 여기서 찾아 자동으로 붙인다. */}
                  <div className="frow"><label>그림목록 폴더</label>
                    <input placeholder="그림목록(.tsv) 폴더 — 음성 TSV 와 같은 번호끼리 자동으로 짝지어집니다" value={ch.imgTsvFolder || ''}
                      onChange={(e) => setCh({ ...ch, imgTsvFolder: e.target.value })} />
                    <button className="ghost" style={{ flex: '0 0 auto' }} onClick={pickImgTsvFolder}>찾기</button></div>
                  {/* 🖼 그림은 뿌리가 다르다 — 하위 폴더·파일명을 **그림목록 TSV 의 1번 칸**이 정한다. */}
                  <div className="frow"><label>이미지 출력</label>
                    <input placeholder="그림을 떨어뜨릴 뿌리 폴더 — 비우면 그림 생성을 쓰지 않습니다" value={ch.outImages || ''}
                      onChange={(e) => setCh({ ...ch, outImages: e.target.value })} />
                    <button className="ghost" style={{ flex: '0 0 auto' }} onClick={pickOutImages}>찾기</button></div>
                  <div className="meta" style={{ marginTop: 6 }}>TSV 한 파일이 폴더 하나가 됩니다 — <b>MP3 출력/&lt;TSV 이름&gt;/</b> 에 파일명 그대로 mp3 가 들어갑니다.
                    <br />🖼 그림은 다릅니다 — <b>이미지 출력 + 그림목록 TSV 의 1번 칸</b>(하위 폴더 포함)에 그대로 만듭니다.
                    <br />🔗 음성 TSV 를 열면 <b>그림목록 폴더</b>에서 <b>같은 번호</b>의 파일을 찾아 자동으로 붙입니다(<code>003_….tsv</code> ↔ <code>003_그림목록.tsv</code>).
                    <br />⚠ <b>발음사전을 나중에 물리면 그 강 전체가 다시 합성됩니다</b>(사전이 캐시 키에 들어갑니다). 처음에 정해 두세요.</div>
                </>)}
              </div>)}

            </div>
            <div className="mbtns"><button onClick={saveChannel}>저장</button><button className="ghost" title="이 채널 삭제" style={{ color: '#c0392b' }} onClick={deleteChannel}>🗑 채널 삭제</button><span style={{ flex: 1 }} /><button className="ghost" onClick={() => setChOpen(false)}>취소</button></div>
          </div>
        </div>
      )}

      {styleEditOpen && (
        <div className="modal-bg show">
          <div className="modal-card wide" style={{ maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}>
            <h3>🎨 이미지 스타일 편집</h3>
            <div className="meta" style={{ marginBottom: 8 }}>기본 스타일은 <b>읽기전용</b>(프롬프트 복사만 가능). 사용자 스타일은 이름·프롬프트 수정·삭제·순서변경 가능. 최종 이미지 프롬프트 = <b>선택한 스타일 + 대본 프롬프트</b>.<br />☁ 사용자 스타일과 순서는 <b>여러 PC 공용</b>입니다(TTS 서버에 보관) — 여기서 고치면 다른 PC 에도 반영됩니다.</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <button className="ghost" style={{ flex: '0 0 auto' }} title="다른 PC 가 바꾼 스타일 받아오기 + 이 PC 것 올리기" onClick={() => syncStyles(true)}>☁ 동기화</button>
              <span className="meta" style={{ flex: 1, color: /^⚠/.test(styleSync) ? '#c0392b' : undefined }}>{styleSync}</span>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, paddingRight: 4 }}>
              {styles.map((s, i) => (
                <StyleRow key={s.id} s={s} index={i} total={styles.length}
                  onCopy={copyStylePrompt} onSave={saveStyle} onDelete={deleteStyle} onMove={moveStyle} />
              ))}
            </div>
            <div style={{ borderTop: '1px solid var(--border,#ddd)', paddingTop: 8, marginTop: 4 }}>
              <div className="subhead">➕ 새 스타일 추가</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <input style={{ flex: '0 0 180px' }} placeholder="이름 (예: 나만의 수묵화)" value={newStyle.name} onChange={(e) => setNewStyle({ ...newStyle, name: e.target.value })} />
                <input style={{ flex: 1 }} placeholder="영문 스타일 프롬프트" value={newStyle.prompt} onChange={(e) => setNewStyle({ ...newStyle, prompt: e.target.value })} />
                <button onClick={addStyle}>추가</button>
              </div>
            </div>
            <div className="mbtns"><button className="ghost" onClick={() => setStyleEditOpen(false)}>닫기</button></div>
          </div>
        </div>
      )}
      {dictOpen && (
        <div className="modal-bg show">
          <div className="modal-card wide" style={{ maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}>
            <h3>📖 발음사전 (TTS 교정)</h3>
            <div className="meta" style={{ marginBottom: 8 }}>TTS가 잘못 읽는 단어를 <b>발음대로</b> 교정합니다. <b>자막·대본은 그대로</b>이고 <b>음성 합성에만</b> 적용됩니다.
              예) 대본표기 <b>정약용</b> → 발음표기 <b>정냐굥</b> 으로 등록하면, 자막엔 "정약용"이 뜨고 음성만 "정냐굥"으로 읽습니다.</div>
            <div style={{ display: 'flex', gap: 6, fontSize: 12, fontWeight: 600, padding: '0 4px 4px' }}>
              <span style={{ flex: '0 0 30px' }}>사용</span><span style={{ flex: 1 }}>대본 표기 (자막에 나오는 말)</span><span style={{ flex: 1 }}>발음 표기 (TTS가 읽을 말)</span><span style={{ flex: '0 0 30px' }} />
            </div>
            <div style={{ overflowY: 'auto', flex: 1, paddingRight: 4 }}>
              {dictRows.length === 0 && <div className="meta" style={{ padding: 8 }}>등록된 단어가 없습니다. 아래 「＋ 추가」로 시작하세요.</div>}
              {dictRows.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                  <input type="checkbox" style={{ flex: '0 0 30px', width: 'auto' }} checked={r.enabled !== false} onChange={(e) => setDictRow(i, { enabled: e.target.checked })} title="이 교정 사용/해제" />
                  <input style={{ flex: 1 }} placeholder="예: 정약용" value={r.source || ''} onChange={(e) => setDictRow(i, { source: e.target.value })} />
                  <span>→</span>
                  <input style={{ flex: 1 }} placeholder="예: 정냐굥" value={r.pron || ''} onChange={(e) => setDictRow(i, { pron: e.target.value })} />
                  <button className="ghost" title="삭제" style={{ flex: '0 0 auto' }} onClick={() => delDictRow(i)}>🗑</button>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid var(--border,#ddd)', paddingTop: 8, marginTop: 4 }}>
              <button className="ghost" onClick={addDictRow}>＋ 추가</button>
              <span className="meta" style={{ marginLeft: 8 }}>저장 후 <b>TTS를 다시 변환</b>해야 반영됩니다.</span>
            </div>
            <div className="mbtns"><button onClick={saveDict}>저장</button><button className="ghost" onClick={() => setDictOpen(false)}>취소</button></div>
          </div>
        </div>
      )}
      {vdOpen && (
        <div className="modal-bg show">
          <div className="modal-card wide">
            <h3>🎨 보이스디자인 — 텍스트 설명으로 새 목소리</h3>
            <p className="meta" style={{ margin: '0 0 12px' }}>목소리를 글로 설명 → <b>생성</b>해서 들어보고 → <b>쓸 구간을 골라</b> 파일명을 입력해 저장하면 참조음성 목록에 추가돼 어느 채널에서든 쓸 수 있습니다. (창을 닫으면 디자인 서버는 자동으로 꺼집니다)<br />
              ✂ <b>끝은 잘라 쓰는 걸 권합니다</b> — 생성된 음성은 문장 끝이 서서히 작아지는데(모델 특성), 그대로 참조음성으로 쓰면 <b>TTS 문장 끝이 계속 끊기는 느낌</b>이 납니다. 길게 만들고 <b>또렷한 5초 남짓</b>만 남기세요.</p>
            <div className="frow" style={{ alignItems: 'flex-start' }}><label>목소리 설명</label>
              <textarea rows="3" placeholder="예: 60대 한국인 남성 내레이터. 중저음이고 차분하며 신뢰감 있는 목소리. 역사 다큐멘터리 톤." value={vdInstruct} onChange={(e) => setVdInstruct(e.target.value)} /></div>
            <div className="frow" style={{ alignItems: 'flex-start' }}><label title="자유롭게 바꿀 수 있습니다. 이 문장이 그대로 저장되는 .txt(참조텍스트)가 됩니다">미리들을 문장</label>
              <textarea rows="2" placeholder="이 문장을 그 목소리로 읽어 미리듣기 합니다 (자유 수정 가능)" value={vdText} onChange={(e) => setVdText(e.target.value)} /></div>
            <div className="frow"><label></label>
              {/* 준비(vdReady) 전엔 잠금 — 안 잠그면 '서버 미기동' 오류가 뜨면서 진짜 원인(설치 안 됨·준비 실패)이 덮인다 */}
              <button onClick={vdGenerate} disabled={vdBusy || !vdReady}
                title={vdReady ? '이 설명으로 목소리 생성' : '서버 준비가 끝나면 활성화됩니다'}>🎨 목소리 생성</button>
              {!vdReady && !vdBusy ? <button className="ghost" title="설치 확인 + 서버 준비를 다시 시도" onClick={vdPrepare}>🔄 서버 다시 준비</button> : null}
              {vdWavUrl ? <button className="ghost" onClick={() => playPreviewUrl(vdWavUrl)}>▶ 다시 듣기</button> : null}
              <button className="ghost" style={{ marginLeft: 'auto' }} title="참조음성이 저장되는 폴더 열기" onClick={() => api.openRefFolder('')}>📂 참조음성 폴더</button>
            </div>
            {vdWavUrl ? <div className="frow"><label></label><audio ref={vdAudioRef} controls src={vdWavUrl} style={{ flex: 1 }} /></div> : null}
            {vdGenerated ? (<>
              {/* ✂ 슬라이스 — 끝의 감쇠(페이드) 구간을 빼고 저장하면 합성 문장 끝이 끊기지 않는다 */}
              <div className="frow" style={{ alignItems: 'flex-start' }}>
                <label title="드래그해서 저장할 구간을 고르세요. 손잡이(주황=시작·빨강=끝)를 잡아 미세 조정할 수 있습니다.">쓸 구간</label>
                <div style={{ flex: 1 }}>
                  <canvas ref={vdCanvasRef} onMouseDown={vdMouseDown}
                    style={{ width: '100%', height: 110, border: '1px solid var(--line)', borderRadius: 6, cursor: 'ew-resize', display: 'block' }} />
                  <div className="frow" style={{ marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
                    <span className="meta">시작</span>
                    <input type="number" step="0.05" min="0" max={vdDur || 0} style={{ width: 84 }} value={vdSel.s.toFixed(2)}
                      onChange={(e) => setVdSel((p) => ({ ...p, s: Math.min(vdClamp(e.target.value), p.e - 0.02) }))} />
                    <span className="meta">끝</span>
                    <input type="number" step="0.05" min="0" max={vdDur || 0} style={{ width: 84 }} value={vdSel.e.toFixed(2)}
                      onChange={(e) => setVdSel((p) => ({ ...p, e: Math.max(vdClamp(e.target.value), p.s + 0.02) }))} />
                    <span className="meta">초 · 길이 <b>{Math.max(0, vdSel.e - vdSel.s).toFixed(2)}초</b> / 원본 {vdDur.toFixed(2)}초</span>
                    <button className="ghost" onClick={vdPlaySel} title="선택한 구간만 재생 — 저장될 소리를 그대로 확인">▶ 구간 듣기</button>
                    <button className="ghost" onClick={() => vdCutAbout(5)} title="시작점부터 약 5초 — 단어가 잘리지 않게 그 부근의 쉬는 지점에서 끊습니다">✂ ≈5초</button>
                    <button className="ghost" onClick={() => setVdSel({ s: 0, e: vdDur })} title="원본 전체로 되돌리기">↺ 전체</button>
                  </div>
                </div>
              </div>
              <div className="frow" style={{ alignItems: 'flex-start' }}>
                <label title="참조음성(.wav)과 짝이 되는 .txt 입니다. 실제로 들리는 말과 다르면 음성 복제 품질이 떨어집니다.">참조텍스트</label>
                <textarea rows="2" value={vdRefText} onChange={(e) => setVdRefText(e.target.value)}
                  placeholder="선택 구간에서 실제로 들리는 말만 남기세요" /></div>
              <div className="meta" style={{ margin: '-6px 0 8px 96px' }}>⚠ 구간을 잘랐으면 <b>이 문장도 들리는 부분만</b> 남겨야 합니다 — 음성과 글이 어긋나면 복제가 흐트러집니다.</div>
              <div className="frow"><label>파일명</label>
                <input placeholder="예: 고전서재_내레이터" value={vdFilename} onChange={(e) => setVdFilename(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') vdSave(); }} style={{ flex: 1 }} />
                <button onClick={vdSave} disabled={vdBusy} title="선택한 구간만 잘라 참조음성 목록에 추가 (.wav + 같은이름.txt 생성)">💾 저장</button>
              </div>
            </>) : null}
            <div className="meta" style={{ minHeight: 22, whiteSpace: 'pre-wrap', color: vdStatus.startsWith('⚠') ? '#c0392b' : undefined }}>{vdBusy ? '⏳ ' : ''}{vdStatus}</div>
            <div className="mbtns"><button className="ghost" onClick={closeVoiceDesign}>닫기</button></div>
          </div>
        </div>
      )}
      {ollamaOpen && ollama && (
        <div className="modal-bg show">
          <div className="modal-card">
            <h3>⚙ Ollama LLM 설정 (프롬프트 자동작성)</h3>
            <div className="meta" style={{ marginBottom: 8 }}>GPU PC 의 Ollama 로 그룹 내용에 맞는 이미지 프롬프트를 <b>무료·자동</b> 생성합니다. 다른 PC/외부에선 <b>서버 주소</b>만 GPU PC 의 LAN/Tailscale IP 로 바꾸세요.</div>
            <div className="frow"><label>서버 주소</label><input placeholder="http://127.0.0.1:11434" value={ollama.baseUrl || ''} onChange={(e) => setOllama({ ...ollama, baseUrl: e.target.value })} /><button className="ghost" style={{ flex: '0 0 auto' }} onClick={testOllamaConn}>연결테스트</button></div>
            <div className="frow"><label>모델</label>
              <input placeholder="gemma4:latest" value={ollama.model || ''} onChange={(e) => setOllama({ ...ollama, model: e.target.value })} list="ollama-models" />
              <datalist id="ollama-models">{ollamaModels.map((m) => <option key={m} value={m} />)}</datalist>
            </div>
            {ollamaModels.length > 0 && <div className="meta">설치된 모델: {ollamaModels.join(', ')}</div>}
            <div className="meta">💡 RTX3060(12GB): <b>gemma4:latest</b>(e4b ≈9.6GB) 권장 — VRAM에 다 올라가 빠름. <b>gemma4:26b</b>(17GB)는 오프로딩되어 느립니다.</div>
            <div className="frow" style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 8 }}>
              <span className="meta" style={{ flex: 1 }}>고급: Ollama 대신 웹 LLM(claude.ai 등) 답변을 직접 붙여넣어 적용</span>
              <button className="ghost" style={{ flex: '0 0 auto' }} disabled={!loaded} onClick={() => { setOllamaOpen(false); setImpText(''); setImpOpen(true); }}>📥 직접 붙여넣기</button>
            </div>
            <div className="mbtns"><button onClick={saveOllama}>저장</button><button className="ghost" onClick={() => setOllamaOpen(false)}>취소</button></div>
          </div>
        </div>
      )}


      {/* 모달은 바깥 클릭으로 닫지 않음(ESC·닫기 버튼만) — 실수 클릭에 입력 유실 방지 */}
      {chOrderOpen && (
        <div className="modal-bg show">
          <div className="modal-card" style={{ maxWidth: 460 }}>
            <h3>↕ 채널 순서</h3>
            <div className="meta" style={{ marginBottom: 8 }}>▲▼ 로 순서를 바꾸고 <b>저장</b>하면 채널 드롭다운에 이 순서로 표시됩니다. (그룹 구분선은 그룹 이름이 같은 채널끼리 자동으로 묶여 표시됩니다)</div>
            <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 6 }}>
              {chOrder.map((c, i) => (
                <div key={c.name} className="frow" style={{ gap: 6, alignItems: 'center', padding: '3px 0' }}>
                  <span className="meta" style={{ width: 26, textAlign: 'right', flex: '0 0 auto' }}>{i + 1}.</span>
                  <span style={{ flex: 1, fontWeight: c.name === presetName ? 700 : 400 }}>{c.name}{c.group ? <span className="meta"> · {c.group}</span> : null}</span>
                  <button className="ghost" style={{ flex: '0 0 auto', padding: '2px 8px' }} title="위로" disabled={i === 0} onClick={() => moveChOrder(i, -1)}>▲</button>
                  <button className="ghost" style={{ flex: '0 0 auto', padding: '2px 8px' }} title="아래로" disabled={i === chOrder.length - 1} onClick={() => moveChOrder(i, 1)}>▼</button>
                </div>
              ))}
            </div>
            <div className="mbtns" style={{ marginTop: 10 }}>
              <button onClick={saveChOrder}>💾 저장</button>
              <span style={{ flex: 1 }} />
              <button className="ghost" onClick={() => setChOrderOpen(false)}>취소</button>
            </div>
          </div>
        </div>
      )}
      {settingsOpen && (
        <div className="modal-bg show">
          <div className="modal-card wide">
            <h3>⚙ 설정</h3>
            <div className="frow" style={{ gap: 6, marginBottom: 10, borderBottom: '1px solid var(--line)', paddingBottom: 8, flexWrap: 'wrap' }}>
              {[['img', '🖼 ComfyUI 이미지'], ['vid', '🎬 ComfyUI 비디오'], ['free', '🆓 무료 이미지'], ['keys', '🔑 API 키'], ['acct', '👤 계정'], ['tts', '🖧 TTS 서버']].map(([id, lbl]) => (
                <button key={id} className={settingsTab === id ? '' : 'ghost'} style={{ padding: '5px 10px' }} onClick={() => { setSettingsTab(id); setSettingsMsg(''); if (id === 'acct') loadAcct(); if (id === 'img') { setComfyProbe({}); probeBoth('image'); } if (id === 'vid') { setCvidProbe({}); probeBoth('video'); } }}>{lbl}</button>
              ))}
            </div>

            {settingsTab === 'img' && comfyCfg && (<div>
              <div className="meta" style={{ marginBottom: 8 }}>여기선 <b>주소·키·등록</b>만 정합니다. <b>어느 모델로 만들지는 헤더 「② 이미지」 드롭다운</b>에서 고르세요(☁클라우드 / 🖥로컬 × Z-Image·Krea2). ComfyUI 에서 <b>「저장(API 포맷)」</b>한 JSON 을 <b>＋추가</b>로 등록하면 그 드롭다운에 나타납니다.</div>
              <ComfyTargets cfg={comfyCfg} setCfg={setComfyCfg} save={saveComfyCfg} kind="image"
                probes={comfyProbe} onProbe={(side, over) => probeComfyTarget("image", side, over)} />
              <WorkflowManageRow cfg={comfyCfg} kind="image" onAdd={pickComfyWf} onRemove={removeComfyWf} />
              <div className="frow"><label>프롬프트 노드</label>
                <input style={{ flex: 1 }} value={comfyCfg.promptNodeId || ''} placeholder="빈값=자동(CLIPTextEncode). 프롬프트가 안 들어가면 노드ID 지정"
                  onChange={(e) => setComfyCfg({ ...comfyCfg, promptNodeId: e.target.value })} onBlur={() => saveComfyCfg({ promptNodeId: (comfyCfg.promptNodeId || '').trim() })} /></div>
              <div className="frow"><label>동시 생성</label>
                <span className="meta" title="앱이 정한 고정값입니다. 3 이상은 검정·노이즈 이미지를 유발해(실측: 동시 4 에서 203장 중 7장) 코드가 상한 2 로 깎습니다. 로컬은 VRAM 때문에 항상 1장씩.">
                  클라우드 <b>2장 동시</b> · 로컬 <b>1장씩</b> — 앱 고정(설정 불필요)</span></div>
              <div className="frow"><label>타임아웃(초)</label>
                <input type="number" style={{ width: 90 }} value={comfyCfg.timeoutSec || 300}
                  onChange={(e) => setComfyCfg({ ...comfyCfg, timeoutSec: e.target.value })} onBlur={() => saveComfyCfg({ timeoutSec: parseInt(comfyCfg.timeoutSec, 10) || 300 })} />
                <label className="chk" style={{ display: 'flex', gap: 4, alignItems: 'center', width: 'auto' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={comfyCfg.sendDims !== false} onChange={(e) => { const v = e.target.checked; setComfyCfg({ ...comfyCfg, sendDims: v }); saveComfyCfg({ sendDims: v }); }} /> 비율에 맞춰 해상도 주입
                </label></div>
              <div className="meta" style={{ marginTop: 4 }}>클라우드는 <b>주소 cloud.comfy.org + API키 + 유료구독(Standard+)</b>이 필요합니다. 로컬은 내 PC ComfyUI에 z-image 모델(z_image·qwen_3_4b·ae)이 설치돼 있어야 합니다.</div>
            </div>)}

            {settingsTab === 'vid' && cvidCfg && (<div>
              <div className="meta" style={{ marginBottom: 8 }}>그룹 이미지를 업로드해 <b>이미지→비디오</b>로 만듭니다. 여기선 <b>주소·키·등록</b>만 정하고, <b>어느 모델로 만들지는 헤더 「③ 비디오」 드롭다운</b>에서 고르세요(☁클라우드 / 🖥로컬 × LTX2.5·LTX2.3). 직접 만든 i2v 워크플로는 <b>「저장(API 포맷)」</b> JSON 을 <b>＋추가</b>로 등록하면 됩니다(<b>Load Image → start_image</b> 연결 필요 — 없으면 앱이 자동 주입을 시도합니다).</div>
              <ComfyTargets cfg={cvidCfg} setCfg={setCvidCfg} save={saveCvidCfg} kind="video"
                probes={cvidProbe} onProbe={(side, over) => probeComfyTarget("video", side, over)} />
              <WorkflowManageRow cfg={cvidCfg} kind="video" onAdd={pickCvidWf} onRemove={removeCvidWf} />
              <div className="frow"><label>최대 길이(초)</label>
                <input type="number" style={{ width: 70 }} value={cvidCfg.videoMaxSec != null ? cvidCfg.videoMaxSec : 8} title="0=제한없음(TTS 길이 그대로). 클라우드 GPU 시간/비용 상한"
                  onChange={(e) => setCvidCfg({ ...cvidCfg, videoMaxSec: e.target.value })} onBlur={() => saveCvidCfg({ videoMaxSec: Math.max(0, parseInt(cvidCfg.videoMaxSec, 10) || 0) })} />
                <label style={{ width: 'auto' }}>fps</label>
                <input type="number" style={{ width: 60 }} value={cvidCfg.fps || 24} title="워크플로 CreateVideo fps 와 맞추기 (초→프레임 변환)"
                  onChange={(e) => setCvidCfg({ ...cvidCfg, fps: e.target.value })} onBlur={() => saveCvidCfg({ fps: parseInt(cvidCfg.fps, 10) || 24 })} />
                <label style={{ width: 'auto' }}>타임아웃(초)</label>
                <input type="number" style={{ width: 80 }} value={cvidCfg.timeoutSec || 600}
                  onChange={(e) => setCvidCfg({ ...cvidCfg, timeoutSec: e.target.value })} onBlur={() => saveCvidCfg({ timeoutSec: parseInt(cvidCfg.timeoutSec, 10) || 600 })} />
                <span className="meta" title="앱이 정한 고정값입니다. i2v 는 건당 수 분이라 동시에 올려야 벽시계 시간이 줄어듭니다(5개×8분 순차 40분 → 동시3 약 14분). 총 크레딧은 동일. 로컬은 VRAM 때문에 항상 1개씩.">
                  클라우드 <b>3개 동시</b> · 로컬 <b>1개씩</b> — 앱 고정</span></div>
              <div className="frow"><label>프롬프트 노드</label>
                <input style={{ flex: 1 }} value={cvidCfg.promptNodeId || ''} placeholder="빈값=자동(Positive CLIPTextEncode)"
                  onChange={(e) => setCvidCfg({ ...cvidCfg, promptNodeId: e.target.value })} onBlur={() => saveCvidCfg({ promptNodeId: (cvidCfg.promptNodeId || '').trim() })} />
                <label className="chk" style={{ display: 'flex', gap: 4, alignItems: 'center', width: 'auto' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={cvidCfg.sendDims !== false} onChange={(e) => { const v = e.target.checked; setCvidCfg({ ...cvidCfg, sendDims: v }); saveCvidCfg({ sendDims: v }); }} /> 비율에 맞춰 해상도
                </label></div>
              {/* ⬆ 영상 업스케일 — Grok(720p) 등 저해상도 결과를 1080p 로. LTX2.5 는 처음부터 1920x1088 이라 자동 생략된다.
                  🔴 2026-08-26 아내 PC: NVIDIA GPU 가 없어 Real-ESRGAN 이 영상 하나에 수십 분 걸렸다. */}
              <div className="frow" style={{ alignItems: "center", marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                <label style={{ flex: "0 0 auto", minWidth: 110 }}>영상 업스케일</label>
                <select style={{ flex: "0 0 auto", width: "auto" }} value={(upCfg && upCfg.mode) || "auto"}
                  title="저해상도 영상(Grok 720p 등)을 1080p 로 키우는 방식. 이미 1080p 이상이면 어느 방식이든 자동으로 건너뜁니다."
                  onChange={(e) => saveUpCfg({ mode: e.target.value })}>
                  <option value="auto">자동 (AI로 시작 · 너무 느리면 빠름으로)</option>
                  <option value="ai">AI 고정 (Real-ESRGAN · 화질 우선 · GPU 필요)</option>
                  <option value="fast">빠름 고정 (ffmpeg · 몇 초 · 화질 낮음)</option>
                  <option value="off">끔 (원본 해상도 그대로)</option>
                </select>
              </div>
              <div className="meta" style={{ marginTop: 4 }}>⬆ <b>이미 1920x1080 이상인 영상은 어느 방식이든 건너뜁니다</b>(☁ LTX2.5 는 1920x1088 로 나옵니다). Grok(720p)처럼 낮을 때만 동작합니다. <b>AI(Real-ESRGAN)는 프레임을 한 장씩 확대</b>해서 15초 영상이 361프레임 — <b>GPU 가 없는 PC 에서는 수십 분</b>이 걸립니다. 「자동」은 한 영상이 5분을 넘으면 남은 영상을 빠른 방식으로 낮춥니다.</div>
              <div className="meta" style={{ marginTop: 4 }}>클라우드 = <b>구독 GPU 시간(정액)</b>으로 실행 — 영상당 추가 과금 없음. 로컬(🖥)은 <b>그 PC ComfyUI 에 LTX2.5 모델 파일</b>(unet <code>ltx-2.5-22b-*</code> · clip <code>gemma4-12b-with-proj-ltx-2.5-*</code> · vae <code>ltx-2.5-*-vae-*</code>)이 설치돼 있어야 합니다. ⚠ LTX2.5 는 <b>22B</b> — RTX 3060(12GB)에서는 시스템 RAM 으로 넘겨 매우 느리거나 실패할 수 있습니다(모델이 없으면 오류에 그 서버의 파일 목록이 함께 나옵니다). i2v는 그룹 이미지가 있어야 동작합니다.</div>
            </div>)}

            {/* 🆓 무료 이미지 — Flow·Genspark(브라우저) 설정 + LoRA 수집.
                2026-08-26: 옛 「⚙ 이미지 순환」 모달을 없애고 이 탭으로 옮겼다. 드롭다운이 Flow·Genspark 로
                분리됐으므로 순서/체크는 필요 없다 — 고른 쪽이 먼저 돌고 한도면 다른 쪽이 이어받는다. */}
            {settingsTab === 'free' && (<div>
              <div className="meta" style={{ marginBottom: 10 }}>
                브라우저로 <b>무료</b> 생성하는 <b>Flow · Genspark</b> 설정입니다. 어느 쪽으로 만들지는 헤더 <b>「② 이미지」</b> 드롭다운에서 고르세요.
                고른 쪽이 <b>한도</b>(Genspark 휴식/한도 메시지 · Flow 계정 한도)에 걸리면 <b>남은 이미지를 다른 쪽이 이어서</b> 만듭니다.
              </div>
              <div className="frow" style={{ alignItems: 'center' }}>
                <label style={{ flex: '0 0 auto', minWidth: 120 }}>Flow 이미지 모델</label>
                <select style={{ flex: '0 0 auto', width: 'auto' }} value={(imgRot && imgRot.flowImageModel) || 'Nano Banana 2'}
                  title="Flow 이미지 생성 모델 — Lite 는 더 빠르고 저렴한 경량 모델. Flow 화면에 그 옵션이 없으면 조용히 기본 모델을 유지합니다(오류 없음)."
                  onChange={(e) => saveImgRot({ ...(imgRot || {}), flowImageModel: e.target.value })}>
                  <option value="Nano Banana 2">Nano Banana 2</option>
                  <option value="Nano Banana 2 Lite">Nano Banana 2 Lite (빠름·저렴)</option>
                </select>
                <button className="ghost" style={{ flex: '0 0 auto' }} title="Genspark·Flow 계정 추가·로그인·일일한도" onClick={() => { setSettingsTab('acct'); setSettingsMsg(''); loadAcct(); }}>👤 계정 관리</button>
              </div>
              <div className="meta" style={{ marginTop: 6 }}>⚠ 여러 계정/엔진으로 한도를 우회하는 것은 각 서비스 약관 위반·정지 위험이 있습니다. 보수적으로.</div>
              {lora && (
                <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 10 }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 700 }}>
                    <input type="checkbox" checked={lora.enabled !== false} onChange={(e) => saveLora({ enabled: e.target.checked })} />
                    📦 LoRA 학습용 이미지 수집 <span className="meta">(Genspark/Flow만 · 누적 {lora.count || 0}장)</span>
                  </label>
                  <div className="meta" style={{ marginTop: 4 }}>한국사 이미지를 모아 → 나중에 LoRA 학습용. ComfyUI 결과는 학습 오염을 막으려고 수집하지 않습니다.</div>
                  <div className="frow" style={{ marginTop: 6, alignItems: 'center' }}>
                    <label style={{ flex: '0 0 auto' }}>트리거</label>
                    <input style={{ flex: '0 0 auto', width: 130 }} value={lora.trigger || 'joseon'} onChange={(e) => setLora({ ...lora, trigger: e.target.value })} onBlur={(e) => saveLora({ trigger: e.target.value })} />
                    <span className="meta" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lora.dir}>📁 {lora.dir}</span>
                  </div>
                  <div className="mbtns" style={{ marginTop: 6 }}>
                    <button className="ghost" onClick={pickLoraDir}>폴더 변경</button>
                    <button className="ghost" onClick={() => api.openLoraFolder()}>📂 데이터셋 열기</button>
                  </div>
                </div>
              )}
            </div>)}

            {settingsTab === 'keys' && (<div>
              <div style={{ background: '#fbf6ee', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', margin: '0 0 10px' }}>
                <div className="frow" style={{ flexWrap: 'wrap' }}>
                  <label style={{ width: 'auto', fontWeight: 700, color: 'var(--hook)' }}>🍌 유료 나노바나나2 (Gemini)</label>
                  <input type="password" placeholder="🔑 Gemini API 키" value={giKey} style={{ flex: 1, minWidth: 180 }}
                    onChange={(e) => setGiKey(e.target.value)} onBlur={() => saveGiKey(giKey.trim())} />
                </div>
                {giCfg && <div className="frow" style={{ flexWrap: 'wrap', marginTop: 4 }}>
                  <label style={{ width: 'auto' }}>모델</label>
                  <input style={{ flex: 1, minWidth: 200 }} value={giCfg.model || ''} placeholder="gemini-3.1-flash-lite-image"
                    onChange={(e) => setGiCfg({ ...giCfg, model: e.target.value })} onBlur={() => saveGiCfg({ model: (giCfg.model || '').trim() })} />
                  <label className="chk" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={giCfg.sendAspect !== false} onChange={(e) => saveGiCfg({ sendAspect: e.target.checked })} />비율 전송
                  </label>
                </div>}
                <div className="meta" style={{ marginTop: 4 }}>헤더에서 <b>「이미지: 유료」</b>를 고르면 이 키로 나노바나나가 이미지를 만듭니다(유료, ~$0.034/장). 모델명이 안 맞으면(404) 여기서 고치고, 비율 오류면 「비율 전송」을 끄세요. (aistudio.google.com 에서 키 발급)</div>
              </div>
              <div style={{ background: '#fbf6ee', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
                <div className="frow" style={{ flexWrap: 'wrap' }}>
                  <label style={{ width: 'auto', fontWeight: 700, color: 'var(--hook)' }}>🎬 Grok API (xAI, 비디오)</label>
                  <input type="password" placeholder="🔑 xAI API 키 (xai-...)" value={xaiVal} style={{ flex: 1, minWidth: 180 }}
                    onChange={(e) => setXaiVal(e.target.value)} onBlur={() => api.setXaiKey((xaiVal || '').trim())} />
                </div>
                <div className="meta" style={{ marginTop: 4 }}>xAI <b>Grok Imagine</b> 비디오 API 키. <b>console.x.ai</b> → API Keys 에서 발급. <b>사용량 과금</b>(영상 1개당) — 브라우저 Grok(구독)과 별개. 헤더 비디오에서 <b>「Grok API」</b> 선택 시 사용. i2v라 그룹 이미지가 있어야 합니다.</div>
              </div>
            </div>)}

            {settingsTab === 'acct' && (<div>
              {/* ⬇ 폴백 브라우저 — Chrome 실행이 실패했을 때 앱이 쓰는 대체 브라우저.
                  🔴 터미널에서 npx playwright install 을 돌리면 **엉뚱한 버전**이 깔린다(앱 playwright 와
                     revision 불일치 — 2026-08-26 아내 PC 실측: 앱은 chromium-1223 인데 1234 가 설치됨).
                     이 버튼은 앱 안의 playwright CLI 로 돌려 버전이 맞는다. */}
              <div className="frow" style={{ alignItems: 'center', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
                <span className="meta" style={{ flex: 1 }}>브라우저 자동화(Genspark·Flow·Grok)는 <b>정식 Chrome</b> 을 씁니다. 실행이 실패하면 앱이 프로필을 정리해 한 번 더 시도하고, 그래도 안 되면 <b>대체 Chromium</b> 으로 넘어갑니다. 그게 없다는 오류가 나오면 아래 버튼을 누르세요.</span>
                <button className="ghost" style={{ flex: '0 0 auto' }} disabled={browserBusy} onClick={installBrowser}
                  title="앱에 맞는 판의 Chromium 을 내려받습니다(수백 MB). ⚠ 터미널에서 npx playwright install 을 돌리면 버전이 어긋나 소용없습니다.">
                  {browserBusy ? '⏳ 설치 중…' : '⬇ 브라우저 설치'}</button>
              </div>
              <div className="meta" style={{ marginBottom: 8, lineHeight: 1.55 }}>
                브라우저 자동화 계정입니다. <b>계정 1개 = 브라우저 프로필 1개</b> — <b>🔑 로그인</b>으로 한 번 로그인하면
                그 프로필에 쿠키가 남아 <b>한동안 다시 로그인하지 않아도</b> 됩니다(X 는 보통 몇 달).
                아이디·비밀번호를 저장해 두면 로그인 창에서 <b>자동 입력</b>됩니다.
              </div>
              <div className="meta" style={{ marginBottom: 8, lineHeight: 1.55, color: '#8a6d3b' }}>
                ⚠ 완전 자동 로그인은 <b>구조적으로 불가능</b>합니다 — 구글은 자동화 브라우저의 비밀번호 로그인을
                차단하고(“이 브라우저 또는 앱은 안전하지 않을 수 있습니다”), X 는 CAPTCHA·2단계 인증을 요구합니다.
                그 화면이 나오면 앱이 <b>거기서 멈추고 창을 열어 둡니다</b> — 직접 마무리한 뒤 [로그인 완료]를 누르세요.
                반복 실패는 계정 잠금으로 이어질 수 있어 <b>재시도하지 않습니다</b>.
              </div>
              {!credsOk && (
                <div className="meta" style={{ marginBottom: 8, color: '#b03a3a' }}>
                  ⚠ 이 PC 에서는 OS 암호화(safeStorage)를 쓸 수 없어 <b>비밀번호를 저장하지 않습니다</b>
                  (평문으로 몰래 남기지 않는 정책). 🔑 로그인에서 직접 입력하세요.
                </div>
              )}
              {!acct && <div className="meta">불러오는 중…</div>}
              {acct && ACCT_SVCS.map((s) => {
                const d = acct[s.id] || { accounts: [] };
                return (
                  <div key={s.id} style={{ background: '#fbf6ee', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
                    <div className="frow" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                      <label style={{ width: 'auto', fontWeight: 700, color: 'var(--hook)' }}>{s.icon} {s.name}</label>
                      <span className="meta" style={{ flex: 1 }}>{s.note}</span>
                      <label style={{ width: 'auto' }}>일일 한도</label>
                      <input className="n" type="number" min="0" style={{ width: 64 }} value={d.dailyCap != null ? d.dailyCap : 0}
                        onChange={(e) => acctDo(s.id, 'cap', e.target.value)} />
                      <span className="meta">0=무제한</span>
                    </div>
                    {(d.accounts || []).map((a) => {
                      const st = acctLoginLabel(a);
                      const ku = `${s.id}:${a.id}:u`;
                      const kp = `${s.id}:${a.id}:p`;
                      const hasPw = !!(a.creds && a.creds.hasPassword);
                      return (
                        <div key={a.id} style={{ borderTop: '1px dashed var(--line)', padding: '6px 0 4px' }}>
                          <div className="frow" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                            <input defaultValue={a.label} onBlur={(e) => acctDo(s.id, 'ren', a.id, e.target.value)}
                              title="이름 수정 후 다른 곳 클릭" style={{ flex: '0 0 110px', fontWeight: 700 }} />
                            <span className="meta">오늘 {a.used}/{d.dailyCap > 0 ? d.dailyCap : '무제한'}</span>
                            <span className="meta" style={{ color: st.c, fontWeight: 600 }}>{st.t}</span>
                            <span style={{ flex: 1 }} />
                            <button className="ghost" style={{ flex: '0 0 auto' }} onClick={() => acctLogin(s.id, a.id)}>🔑 로그인</button>
                            {a.id !== 'default' && (
                              <button className="ghost" style={{ flex: '0 0 auto' }} title="계정 삭제" onClick={() => acctRemove(s.id, a.id, a.label)}>✕</button>
                            )}
                          </div>
                          <div className="frow" style={{ alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
                            <input placeholder="아이디 / 이메일" style={{ flex: 1, minWidth: 140 }}
                              value={acctEdit[ku] !== undefined ? acctEdit[ku] : ((a.creds && a.creds.username) || '')}
                              onChange={(e) => setAcctEdit((v) => ({ ...v, [ku]: e.target.value }))} />
                            <input type="password" placeholder={hasPw ? '비밀번호 (저장됨 — 바꿀 때만)' : '비밀번호'}
                              style={{ flex: 1, minWidth: 140 }} value={acctEdit[kp] || ''}
                              onChange={(e) => setAcctEdit((v) => ({ ...v, [kp]: e.target.value }))} />
                            <button className="ghost" style={{ flex: '0 0 auto' }} disabled={!credsOk}
                              onClick={() => acctSaveCreds(s.id, a.id)}>💾 저장</button>
                            {(hasPw || (a.creds && a.creds.username)) && (
                              <button className="ghost" style={{ flex: '0 0 auto' }} title="저장된 아이디·비밀번호 삭제"
                                onClick={() => acctClearCreds(s.id, a.id)}>🔒 지우기</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div className="frow" style={{ marginTop: 6 }}>
                      <button onClick={() => acctAdd(s.id)}>+ 계정 추가</button>
                      <span className="meta" style={{ flex: 1 }}>계정을 추가하면 <b>별도 브라우저 프로필</b>이 생깁니다 — 그 창에서 로그인한 계정이 곧 그 프로필의 계정입니다.</span>
                    </div>
                  </div>
                );
              })}
              <div className="meta">⚠ 여러 계정으로 한도를 우회하는 것은 각 서비스 약관 위반·정지 위험이 있습니다. 보수적으로 쓰세요.</div>
            </div>)}
            {settingsTab === 'tts' && (<div>
              <div className="meta" style={{ marginBottom: 8, lineHeight: 1.5 }}>
                OmniVoice 는 <b>메인 GPU PC</b>에서 도는 서버입니다. 다른 PC에서 쓰려면 그 주소를 메인 PC의
                <b> LAN IP</b>(예: 192.168.x.x) 또는 <b>Tailscale IP</b>(예: 100.x.x.x)로 바꾸세요. (이 설정은 <b>이 PC에만</b> 저장됩니다)
              </div>
              <div className="frow"><label>OmniVoice</label>
                <input style={{ flex: 1 }} placeholder="http://192.168.219.157:9881" value={ttsSrv.omnivoice.baseUrl}
                  onChange={(e) => setTtsSrv({ ...ttsSrv, omnivoice: { baseUrl: e.target.value } })} onBlur={() => saveTtsSrv('omnivoice')} />
                <button className="ghost" style={{ flex: '0 0 auto' }} onClick={() => testTtsSrv('omnivoice')}>연결테스트</button></div>
              {/* 보이스디자인(Qwen3-TTS) — 비우면 이 PC 에서 직접 실행, 주소를 넣으면 그 PC(메인 GPU)의 서버를 사용 */}
              <div className="frow"><label>보이스디자인</label>
                <input style={{ flex: 1 }} placeholder="비우면 이 PC 에서 실행 · 다른 PC 면 http://100.112.7.63:9893"
                  value={vdSrv} onChange={(e) => setVdSrv(e.target.value)} onBlur={saveVdSrv} />
                <button className="ghost" style={{ flex: '0 0 auto' }} onClick={testVdSrv}>연결테스트</button></div>
              <div className="meta">보이스디자인은 <b>GPU 가 있는 메인 PC</b>에서 서버가 돕니다. 다른 PC 에서 쓰려면 위 칸에 <b>메인 PC 주소(포트 9893)</b>를 넣으세요.
                {' '}메인 PC 에서는 <b>비워 두면</b> 창을 열 때 자동으로 서버가 켜집니다.</div>
              <div className="meta" style={{ marginTop: 4 }}>입력 후 칸 밖을 클릭하면 저장됩니다. 「연결테스트」 = 그 주소의 /health 확인.</div>
            </div>)}

            {/* 연결테스트 결과를 팝업 안에서 바로 보여준다(로그창을 안 봐도 알 수 있게) */}
            {settingsMsg && (
              <div style={{
                marginTop: 10, padding: '7px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.45, wordBreak: 'break-all',
                background: /^✅/.test(settingsMsg) ? '#eef7ee' : /^❌/.test(settingsMsg) ? '#fdeeee' : '#f6f2ea',
                border: '1px solid ' + (/^✅/.test(settingsMsg) ? '#bcd9bc' : /^❌/.test(settingsMsg) ? '#e6bcbc' : 'var(--line)'),
              }}>{settingsMsg}</div>
            )}
            <div className="mbtns" style={{ marginTop: 10 }}>
              <span style={{ flex: 1 }} />
              <button className="ghost" onClick={() => setSettingsOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}
      {scriptEditOpen && (
        <div className="modal-bg show">
          <div className="modal-card" style={{ width: 820, maxWidth: '94vw' }}>
            <h3>✏ 대본 수정</h3>
            <div className="meta" style={{ marginBottom: 8 }}>대본 내용을 수정하고 [적용]하면 재파싱됩니다(원본 .md 파일도 갱신). ⚠ 기존 TTS/이미지는 초기화됩니다.</div>
            {/* 🔴 **비제어(uncontrolled)** — 제어 컴포넌트로 두면 글자 하나마다 App 이 다시 그려지고,
                뒤에 컷 카드 수십 개(영상 포함)가 통째로 재렌더돼 **타이핑·클릭이 먹지 않는다**(2026-08-14 사고).
                값은 [적용] 때 ref 에서 한 번만 읽는다. 모달은 열 때마다 새로 mount 되므로 defaultValue 로 충분. */}
            <textarea ref={scriptEditRef} rows="22" defaultValue={scriptText} spellCheck={false}
              style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12.5, lineHeight: 1.5 }} />
            <div className="mbtns"><button onClick={applyScriptEdit}>적용</button><button className="ghost" onClick={() => setScriptEditOpen(false)}>취소</button></div>
          </div>
        </div>
      )}

      {tsOpen && tsData && (
        <div className="modal-bg show">
          <div className="modal-card" style={{ maxWidth: 620 }}>
            <h3>⏱ 유튜브 타임스탬프(챕터)</h3>
            <div className="meta" style={{ marginBottom: 8 }}>
              각 그룹의 <b>TTS 길이를 누적</b>해 계산한 값입니다(챕터 단위 = 대본의 <b>H2 섹션</b>).
              복사해서 설명글 첫 줄에 붙여넣으세요 — 첫 항목이 <b>0:00</b> 이어야 유튜브가 챕터로 인식합니다.
              제목은 아래에서 바로 고쳐도 됩니다(대본은 바뀌지 않음).
              총 길이 <b>{fmtMinSec(tsData.total)}</b>
            </div>
            {tsData.warns.map((w, i) => (
              <div key={i} className="meta" style={{ marginBottom: 4, color: '#a3352b' }}>⚠ {w}</div>
            ))}
            {/* 비제어(uncontrolled) — 긴 텍스트를 제어 state 로 두면 타이핑마다 전 화면이 재렌더된다(2026-08-14 사고) */}
            <textarea ref={tsRef} rows="14" defaultValue={tsData.text} spellCheck={false}
              style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12.5, lineHeight: 1.5 }} />
            <div className="mbtns">
              <button onClick={copyTimestamps}>📋 복사</button>
              <button className="ghost" onClick={() => setTsOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {impOpen && (
        <div className="modal-bg show">
          <div className="modal-card" style={{ maxWidth: 680 }}>
            <h3>📥 복사·붙여넣기로 프롬프트 만들기</h3>
            <div className="meta" style={{ marginBottom: 8 }}>GPU(Ollama)에 연결되면 <b>✍ 프롬프트작성</b>이 자동으로 처리합니다. <b>GPU가 꺼져 있거나 출장(원격)·다른 PC라 연결이 안 될 때</b>는 이 방법을 쓰세요: ① <b>📤 요청서 복사</b> → 챗GPT·클로드·제미나이 등 <b>아무 LLM</b>에 붙여넣기 → ② 받은 답변 전체를 아래에 붙여넣고 [적용].</div>
            <div style={{ marginBottom: 6 }}><button className="ghost" disabled={!loaded} title="이 대본의 프롬프트 요청서를 클립보드에 복사" onClick={exportPrompts}>📤 요청서 복사</button></div>
            {/* 대본수정과 같은 이유로 비제어 — 긴 텍스트를 제어 state 로 두면 타이핑마다 전 화면이 재렌더된다 */}
            <textarea ref={impRef} rows="12" defaultValue={impText} spellCheck={false} placeholder="여기에 웹 LLM 답변(## [1-1] … 이미지: …)을 붙여넣으세요" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12 }} />
            <div className="mbtns"><button onClick={applyImport}>붙여넣은 텍스트 적용</button><button className="ghost" onClick={() => setImpOpen(false)}>닫기</button></div>
          </div>
        </div>
      )}

      {promptView && (
        <div className="modal-bg show">
          <div className="modal-card" style={{ maxWidth: 620 }}>
            <h3>📝 {promptView.label} — 프롬프트 수정</h3>
            <div className="meta" style={{ marginBottom: 6 }}>대본 프롬프트를 직접 고쳐 이미지·비디오를 다시 만들 수 있습니다. 수정 후 아래 <b>생성</b> 버튼을 누르면 이 그룹만 새로 생성됩니다.</div>
            {/* 🖼 이미지 프롬프트 (편집) */}
            <div className="meta" style={{ marginBottom: 4 }}>🖼️ 이미지 프롬프트 <span style={{ fontWeight: 400 }}>— 생성 시 앞에 <b>스타일 「{promptView.styleName}」</b> 이 자동으로 붙습니다</span></div>
            <textarea rows="6" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12 }} value={promptView.image} onChange={(e) => setPromptView({ ...promptView, image: e.target.value })} placeholder="영문 이미지 프롬프트" />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
              <button disabled={!loaded} title="이 프롬프트를 저장하고 이 그룹 이미지를 새로 생성" onClick={() => savePromptView('image')}>🖼 이미지 생성</button>
            </div>
            {/* ▼ 실제 전송되는 최종 프롬프트(읽기전용) — main 이 생성 코드와 같은 함수로 계산 */}
            <div className="meta" style={{ margin: '8px 0 3px' }}>
              ✅ <b>실제 생성에 전송되는 이미지 프롬프트 전체</b>
              <span style={{ fontWeight: 400 }}> — 스타일 「{(finalPrompt && finalPrompt.styleName) || promptView.styleName}」
                {finalPrompt && !finalPrompt.styleHasPrompt ? ' ⚠(스타일 프롬프트 비어있음)' : ''} + 자동 네거티브 포함</span>
            </div>
            <textarea readOnly rows="7" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 11, background: '#f6f2ea' }}
              value={(finalPrompt && finalPrompt.image) || '(계산 중…)'} />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="ghost" disabled={!finalPrompt} onClick={() => { try { navigator.clipboard.writeText(finalPrompt.image); } catch (_) {} setStatus('최종 이미지 프롬프트 복사됨'); }}>📋 최종 프롬프트 복사</button>
            </div>
            {/* 🎬 비디오 프롬프트 (편집) */}
            <div className="meta" style={{ margin: '10px 0 4px' }}>🎬 영상(I2V) 프롬프트 <span style={{ fontWeight: 400 }}>— 모션만 (스타일은 원본 이미지가 이미 가짐)</span></div>
            <textarea rows="3" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12 }} value={promptView.video} onChange={(e) => setPromptView({ ...promptView, video: e.target.value })} placeholder="영문 모션 프롬프트 (비우면 기본 모션)" />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
              <button disabled={!loaded} title="이 프롬프트를 저장하고 이 그룹 비디오를 새로 생성 (이미지 있어야 함)" onClick={() => savePromptView('video')}>🎬 비디오 생성</button>
            </div>
            {/* ▼ 실제 전송되는 최종 영상 프롬프트(읽기전용) — 비어있으면 모션노트/기본모션이 대신 전송됨 */}
            <div className="meta" style={{ margin: '8px 0 3px' }}>
              ✅ <b>실제 생성에 전송되는 영상 프롬프트 전체</b>
              <span style={{ fontWeight: 400 }}> — 출처: {(finalPrompt && finalPrompt.videoSrc) || '…'} · 영상엔 스타일을 붙이지 않습니다(원본 이미지가 화풍을 가짐)</span>
            </div>
            <textarea readOnly rows="3" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 11, background: '#f6f2ea' }}
              value={(finalPrompt && finalPrompt.video) || '(계산 중…)'} />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="ghost" disabled={!finalPrompt} onClick={() => { try { navigator.clipboard.writeText(finalPrompt.video); } catch (_) {} setStatus('최종 영상 프롬프트 복사됨'); }}>📋 최종 프롬프트 복사</button>
            </div>
            {promptView.motion ? <div className="meta" style={{ marginTop: 6 }}>🎞 모션 노트: {promptView.motion}</div> : null}
            <div className="mbtns"><button onClick={() => savePromptView(null)}>💾 저장만</button><button className="ghost" onClick={() => setPromptView(null)}>닫기</button></div>
          </div>
        </div>
      )}
    </>
  );

  async function switchMode(m) {
    // 🔴 새 모드를 여기 안 넣으면 **버튼을 눌러도 롱폼으로 되돌아간다**(v0.3.50 과 같은 계열의 조용한 되돌림).
    const nm = (m === 'book' || m === 'remotion') ? m : 'longform';
    if (nm === mode) return;
    hasStoredRangeRef.current = false; restoringItemRef.current = false; // 모드 전환 = 그 모드 기본값 계산 허용
    setMode(nm);
    // 모드별 보관된 대본으로 전환 (없으면 빈 화면). 롱폼/출판 대본은 독립.
    try { const r = await api.setMode({ mode: nm }); if (r && r.queue) setQueue(r.queue); setDto(r ? r.dto : null); setFtitle(r && r.dto ? (r.dto.fileTitle || '') : ''); }
    catch (e) { logline('모드 전환 오류: ' + e.message); }
  }

  // 출판 원고(.md) 열기 — book-parser 로 파싱해 출판 큐에 적재.
  async function openBook() {
    try {
      const r = await api.openBookScript({ presetName: presetName || null });
      if (!r) return;
      if (r.mode) setMode(r.mode);
      setDto(r.dto); if (r.queue) setQueue(r.queue);
      setFtitle(r.dto ? (r.dto.fileTitle || '') : '');
      setStatus('출판 원고 로드');
    } catch (e) { logline('원고 열기 오류: ' + e.message); }
  }
}

// ── 카드 목록 (편별 그룹/컷) ──────────────────────────────
function Cards({ dto, isLf, capCharsN, onTts, onImg, onVid, onImgVid, onBulk, onPlayShorts, onPlayGroup, onRegen, onMake, onVrew, onPremiere, onAttach, onClear, onPreview, onPlayFrom, onGroupTts, onGroupVid, onShowPrompt, onSplit }) {
  // dto.projects 부재 가드 — 출판 dto 가 모드 전환 직후 한 프레임 남아 들어올 수 있음(크래시 방지)
  if (!dto || !dto.projects || !dto.projects.length) {
    return <div id="cards"><div className="empty">대본(.md)을 열면 편별 그룹과 컷이 여기에 표시됩니다.</div></div>;
  }
  return (
    <div id="cards">
      {dto.projects.map((pr) => {
        const total = pr.cuts.reduce((s, c) => s + (c.groupDurationSec || 0), 0);
        const totalGen = pr.cuts.reduce((s, c) => s + (c.groupGenSec || 0), 0);
        const rtf = (total > 0 && totalGen > 0) ? (totalGen / total) : null;
        let capN = 0;
        return (
          <div className="card" key={pr.shortsNum}>
            <h2>🎞 {dto.mode === 'longform'
              ? (dto.fileTitle || pr.title)
              : <>{dto.fileTitle ? `${dto.fileTitle} | ` : ''}{pr.title}</>} <span className="meta">({pr.aspect} · {pr.cuts.length}컷)</span>
              {total > 0 && <span className="total">합계 {fmtMinSec(total)}{rtf != null && <span className="rtf" title="RTF = TTS 생성시간 ÷ 음성길이 (낮을수록 빠름)">│ RTF {rtf.toFixed(2)}</span>}</span>}
              <span className="cardbtns">
                <button className="ghost" onClick={() => onTts(pr.shortsNum)}>🎤 TTS</button>
                <button className="ghost" onClick={() => onImg(pr.shortsNum)}>🖼 이미지</button>
                <button className="ghost" title="폴더 선택 → 파일명 숫자로 그룹 자동첨부" onClick={() => onBulk(pr.shortsNum)}>📎 일괄첨부</button>
                <button className="ghost" onClick={() => onVid(pr.shortsNum)}>🎬 비디오</button>
                <button className="ghost" title="이 대본만 — 이미지 전부 만든 뒤 비디오까지 (한 번에)" onClick={() => onImgVid(pr.shortsNum)}>🖼→🎬</button>
                <button className="ghost" onClick={() => onPlayShorts(pr.shortsNum)}>▶ 미리보기</button>
                <button className="ghost" onClick={() => onMake(pr.shortsNum)}>⚡ 만들기</button>
                <button onClick={() => onVrew(pr.shortsNum)}>💾 .vrew</button>
                <button className="ghost" title="Premiere Pro 임포트용 XML 시퀀스 생성 — 파일 > 가져오기로 열면 클립·TTS가 배치된 시퀀스가 바로 열립니다 (자막은 .srt 캡션 가져오기)" onClick={() => onPremiere(pr.shortsNum)}>🎞 프리미어</button>
              </span>
            </h2>
            <div className={'cuts-grid' + (isLf ? ' lf' : '')}>
              {pr.cuts.map((c, ci) => {
                const ph = phaseBadge(c.phase);
                const lineEls = [];
                (c.sentences || []).forEach((s) => {
                  for (const t of splitLines(s.text, capCharsN)) {
                    capN += 1;
                    lineEls.push(<div className="sent" key={capN}><span className="lineno">{String(capN).padStart(2, '0')} |</span>{t}</div>);
                  }
                });
                return (
                  <div className={'cut' + (isLf ? ' lf' : '')} key={c.num}>
                    <Thumb c={c} isLf={isLf} onAttach={() => onAttach(pr.shortsNum, c.num)} onClear={() => onClear(pr.shortsNum, c.num)} onPreview={onPreview} />
                    <div>
                      <div className={'narr' + (c.isIntro ? ' intro' : '')}>
                        <div className="narr-top">
                          <span className="num">G{c.num}</span>
                          <div className="narr-btns">
                            {c.groupDurationSec ? <span className={'dur' + (c.groupDurationSec > 10 ? ' over' : '')}>▶ {c.groupDurationSec.toFixed(1)}s</span> : null}
                            {c.groupDurationSec > 10 && (c.sentences && c.sentences.length >= 2) &&
                              <button className="gprev split" title={`${c.groupDurationSec.toFixed(1)}초 — 10초 초과. 2개 그룹으로 분할(프롬프트 초기화)`} onClick={() => onSplit(pr.shortsNum, c.num)}>✂ 분할</button>}
                            <button className="gprev" title="첨부 이미지 재생성" onClick={() => onRegen(pr.shortsNum, c.num)}>🔄</button>
                            <button className="gprev" title="이 그룹 미리듣기" onClick={() => onPlayGroup(pr.shortsNum, c.num)}>▶</button>
                            <button className="gprev" title="여기부터 재생" onClick={() => onPlayFrom(pr.shortsNum, c.num)}>⏭</button>
                            <button className="gprev" title="이 그룹만 TTS 변환" onClick={() => onGroupTts(pr.shortsNum, c.num)}>🎤</button>
                            <button className="gprev" title="이 그룹만 비디오 변환" onClick={() => onGroupVid(pr.shortsNum, c.num)}>🎬</button>
                            <button className="gprev" title="이 그룹 프롬프트 보기·수정" onClick={() => onShowPrompt(pr.shortsNum, c, `${pr.title} · G${c.num}`)}>📝</button>
                          </div>
                        </div>
                        <div className="narr-text"><span className={'badge ' + ph[0]}>{ph[1]}</span></div>
                      </div>
                      <div className="sents">{lineEls}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Thumb({ c, isLf, onAttach, onClear, onPreview }) {
  const cls = isLf ? ' lf' : '';
  const clearBtn = <button className="thumbx" title="첨부 삭제" onClick={(e) => { e.stopPropagation(); onClear(); }}>✕</button>;
  const genOv = (txt) => <div className="genoverlay"><div className="spin" /><div>{txt}</div></div>;
  if (c.videoPath) {
    return (
      <div className={'thumbwrap' + cls}>
        <video className={'thumb' + cls} src={media(c.videoPath)} muted loop playsInline preload="metadata" />
        <button className="vidplay" title="재생 / 정지" onClick={(e) => { const v = e.currentTarget.parentElement.querySelector('video'); if (!v) return; if (v.paused) { v.play(); e.currentTarget.classList.add('playing'); } else { v.pause(); e.currentTarget.classList.remove('playing'); } }}>▶</button>
        <span className="playbadge">🎬 영상</span>{clearBtn}
        {c.videoStatus === 'upscaling' ? genOv('⬆ 업스케일 중…') : null}
      </div>
    );
  }
  if (c.imagePath) {
    return (
      <div className={'thumbwrap' + cls}>
        <img className={'thumb' + cls} src={media(c.imagePath)} title="클릭: 미리보기" onClick={() => onPreview('img', media(c.imagePath))} alt="" />
        {c.videoStatus === 'generating' ? genOv('🎬 영상 변환 중…') : null}{clearBtn}
      </div>
    );
  }
  if (c.imageStatus === 'generating') {
    return <div className={'thumbwrap' + cls}><div className={'thumb none gen' + cls} />{genOv('🖼 이미지 생성 중…')}</div>;
  }
  return <div className={'thumb none' + cls} title="클릭: 이미지/영상 첨부" onClick={onAttach}>＋</div>;
}

