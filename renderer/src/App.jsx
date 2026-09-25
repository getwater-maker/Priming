import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import api from './lib/ipc.js';
import { splitLines, mLen } from './lib/captions.js';
import ytChapters from '../../core/yt-chapters.js';
import VLook from '../../core/visual-look.js';
import BookView from './BookView.jsx';
import RemotionView from './RemotionView.jsx';
import UrlProgress from './UrlProgress.jsx';
import Mp4Progress from './Mp4Progress.jsx';
import YtProgress from './YtProgress.jsx';
import ScriptReader from './ScriptReader.jsx';
import { CF, CaptionToolbar, CaptionMiniBar, CaptionFormatPanel, CaptionAnimPanel, LineRuns, selectionRange, renderStageLine, fmtCss } from './CaptionFormat.jsx';
import { MENUS, lsGet, lsSet, buildProjLines, stageCapGeom, applyStageGeom, fmtClipTime, lineWords } from './Workspace.jsx';

// 같은 01.png 경로를 새 이미지로 덮어써도 Chromium 메모리 캐시가 옛 그림을 보여주지 않게
// main 이 준 파일 수정 버전을 URL query 로 붙인다(media 프로토콜은 query 를 제거한 뒤 파일을 읽는다).
// 긴 파일 이름 → 앞 몇 글자 + … + 확장자(메뉴·목록 폭이 파일 이름 때문에 늘지 않게)
function shortName(n, max = 14) {
  const s = String(n || ''); const m = s.match(/(\.[A-Za-z0-9]{2,5})$/); const ext = m ? m[1] : '';
  const body = ext ? s.slice(0, -ext.length) : s;
  return [...body].length > max ? [...body].slice(0, max).join('') + '…' + ext : s;
}
const media = (p, version = '') => 'media://' + encodeURIComponent(p) + (version ? `?v=${encodeURIComponent(version)}` : '');
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
// 워크플로 이름 끝의 「(로컬)」·「(클라우드)」 = **그 모델이 반대쪽에는 없다**는 표시다.
//   · Krea2 int4 (로컬) — comfy.org 에 그 모델이 없다(v0.3.45)
//   · MiniMax H3 레퍼런스 (클라우드) — 클라우드는 ComfyUI 네이티브 노드, 로컬판은 Deno 커스텀 노드라 서로 안 돈다(v0.3.85)
//   그런데 optgroup 이 이미 로컬/클라우드를 가르므로 이름에 또 쓰면 「ComfyUI 로컬 > 🖥 Krea2 int4 Turbo (로컬)」 처럼
//   **같은 말이 두 번** 보인다(로이 2026-09-16 지적). → 표시에선 접미사를 떼고, **반대쪽 그룹에서는 아예 감춘다.**
//   🔑 라벨로 경고하던 것을 **구조로** 바꾼 것이다 — 고르면 반드시 실패하는 항목을 애초에 보여주지 않는다.
//   ⚠ 판정 근거는 설정의 이름 하나뿐이다(＋추가할 때 사용자가 붙인다). 한쪽에서만 도는 워크플로를 새로 등록할 땐
//     이름 끝에 「(로컬)」 또는 「(클라우드)」 를 붙일 것 — 그러면 자동으로 그쪽 그룹에만 나온다.
const WF_SIDE_RE = /\s*\((로컬|local|클라우드|cloud)\)\s*$/i;
const wfSide = (w) => { const m = WF_SIDE_RE.exec((w && w.name) || ''); return m ? (/로컬|local/i.test(m[1]) ? 'local' : 'cloud') : null; };
const wfLabel = (w) => String((w && w.name) || '').replace(WF_SIDE_RE, '').trim() || '워크플로';
function ComfyEngineOptions({ cfg, kind = 'image', value = '' }) {
  const suffix = kind === 'video' ? ' i2v' : '';
  const wfs = comfyWorkflows(cfg);
  if (!wfs.length) return <option value={mkComfyVal(true, '')}>ComfyUI{suffix} — 워크플로 없음(⚙ 에서 추가)</option>;
  return (<>
    {(COMFY_SIDES[kind] || [true, false]).map((cloud) => (
      <optgroup key={cloud ? 'c' : 'l'} label={`ComfyUI ${cloud ? '클라우드' : '로컬'}${suffix}`}>
        {/* 접힌 상태에선 optgroup 라벨이 안 보이므로 ☁/🖥 로 어느 쪽인지 드러낸다 */}
        {/* ⚠ 지금 선택된 값이면 감추지 않는다 — 일치하는 option 이 없으면 드롭다운이 **빈칸**으로 보인다(v0.3.1 함정) */}
        {wfs.filter((w) => !wfSide(w) || wfSide(w) === (cloud ? 'cloud' : 'local') || value === mkComfyVal(cloud, w.path))
            .map((w) => <option key={(cloud ? 'c' : 'l') + w.path} value={mkComfyVal(cloud, w.path)}>{cloud ? '☁' : '🖥'} {wfLabel(w)}</option>)}
      </optgroup>
    ))}
  </>);
}
const CAP_POS_OPTIONS = [0.3, 0.15, 0, -0.15, -0.3]; // 상하위치 select 값 (capFine 으로 미세조정)
// yOffset → {pos, fine} (가장 가까운 select 옵션 + 미세조정)
// 🎨 자막 모양(2026-09-24 로이 「자막 형태를 변경하는 기능」) — 채널 capLong 에 함께 저장한다.
//   기본값 = 지금까지의 모양(흰 글자 · 검정 테두리 6 · 배경 없음) → 안 건드린 채널은 결과가 그대로다.
//   🎨 2026-09-25 — 채널 기본 **자막 서식** 전체(글꼴·기울임·밑줄·취소선·간격·이중 테두리·형광펜·그림자·효과)로 넓혔다.
//   정리 규칙은 core/caption-format 하나(.vrew·MP4·화이트보드와 같은 코드). 키 이름이 옛 모양과 같아 옛 채널도 그대로 읽힌다.
//   ⚠ capLookOf 가 채널 편집의 **읽기(mkCap)·저장(capToStyle) 두 곳**에서 쓰인다 — 여기서 키를 빠뜨리면 저장할 때 사라진다(v0.3.8 계열).
const CAP_LOOK_DEFAULT = { ...CF.FMT_DEFAULT };
function capLookOf(c) {
  const o = CF.normFmt(c);
  delete o.size;   // 크기는 채널 자막 칸(size)이 따로 가진다
  return o;
}
// 모양 → vrew-builder 의 captionStyle 필드. fmt = 서식 전체(빌더가 이것을 쓴다) · 옛 낱값(fontColor·boxColor rgba …)도 함께 둔다.
function capLookToStyle(c) {
  const l = capLookOf(c);
  const h = l.boxColor;
  const rgba = 'rgba(' + parseInt(h.slice(1, 3), 16) + ', ' + parseInt(h.slice(3, 5), 16) + ', ' + parseInt(h.slice(5, 7), 16) + ', ' + (l.boxOpacity / 100) + ')';
  return { fontColor: l.fontColor, bold: l.bold, outlineOn: l.outlineOn, outlineColor: l.outlineColor, outlineWidth: l.outlineWidth, boxColor: l.boxOn ? rgba : null, fmt: l };
}

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
// ⏱ 유튜브 챕터(타임스탬프) 계산 = core/yt-chapters.js (⬆ 유튜브 업로드 설명글과 같은 함수)
const { tsFmt, tsCleanTitle, tsChaptersOf, tsBuild } = ytChapters;
function phaseBadge(p) {
  if (!p) return ['', '-'];
  return ['', p];   // 섹션 제목 그대로 (키워드 축약 안 함 — '본론 진입'이 '본론'으로 잘못 표시되던 문제)
}

// 🎬 Genspark 비디오 모델 — genspark-engine.js 의 GENSPARK_VIDEO_MODELS 와 **같아야 한다**
//   (렌더러는 require 를 못 쓴다. 테스트가 두 목록의 이름을 대조해 어긋남을 막는다.)
const GS_VIDEO_MODELS = [
  { name: '모델 자동 선택', note: 'Genspark 이 고름 — 참조 이미지를 쓸지 알 수 없음', imgRef: null },
  { name: 'Seedance 2.5', note: '4~30초 · 1080p · 이미지 30장', imgRef: true },
  { name: 'Seedance v2', note: '4~15초 · 1080p · 이미지 9장', imgRef: true },
  { name: 'MiniMax H3', note: '2K · 이미지 9장', imgRef: true },
  { name: 'MiniMax H3 Max', note: '2K · 더 빠름 · 이미지 9장', imgRef: true },
  { name: 'Wan 3.0', note: '2~30초 · 1080p · 이미지 10장', imgRef: true },
  { name: 'Gemini Omni Flash', note: '3~10초 · 720p · ❌ 참조 이미지 안 받음(실사로 나옴)', imgRef: false },
  { name: 'Grok Imagine Video', note: '1~15초 · 1080p · 이미지 7장', imgRef: true },
  { name: 'FLUX 3 Video', note: '5~20초 · 1080p · 이미지 10장', imgRef: true },
  { name: 'PixVerse C1', note: '1~15초 · 1080p · 이미지 7장', imgRef: true },
  { name: 'Kling V3', note: '3~15초 · 720p · 첫/마지막 프레임', imgRef: true },
  { name: 'Happy Horse', note: '3~15초 · 720p/1080p · 이미지 9장', imgRef: true },
  { name: 'Gemini Veo 3.1', note: '4·6·8초 · 최대 4K · 이미지 3장', imgRef: true },
  { name: 'Gemini Veo 3', note: '4·6·8초 · 720p · ❌ 참조 이미지 안 받음', imgRef: false },
  { name: 'Kling O3', note: '3~15초 · 720p · 이미지 1~4장 필요', imgRef: true },
  { name: 'PixVerse V6', note: '5·8초 · 720p/1080p · ❌ 참조 이미지 안 받음', imgRef: false },
  { name: 'Seedance Pro Fast', note: '5·10초 · 1080p · 첫/마지막 프레임', imgRef: true },
  { name: 'Wan V2.7', note: '5초 · 480p/720p · ❌ 참조 이미지 안 받음', imgRef: false },
  { name: 'Vidu Q3', note: '1~16초 · 1080p · 이미지 1~4장', imgRef: true },
  { name: 'Runway', note: '5·10초 · 720p · 이미지 필요', imgRef: true },
];
const QSTATUS = { idle: '대기', running: '진행중', done: '완료', failed: '실패' };

// ✏ 화이트보드 자막 기본값 — ⚠ core/whiteboard-subtitle.js 의 SUB_DEFAULTS·FONT_CANDIDATES 와 **같은 값**이어야 한다.
//   렌더러는 core 를 require 할 수 없어 두 벌이다 → test/whiteboard-subtitle.test.js 가 어긋나면 실패시킨다.
const WB_SUB_DEFAULT = { font: 'Malgun Gothic', sizePct: 5.2, pos: 'bottom', marginPct: 7.5, bold: true };
const WB_SUB_FONTS = ['Malgun Gothic', 'Noto Sans KR', 'NanumGothic', 'Gulim', 'Batang'];
const WB_SUB_POS = [['bottom', '아래'], ['middle', '가운데'], ['top', '위']];

// 스타일 편집 모달의 한 행 — **모든 스타일이 같다**(이름·프롬프트 수정 · 삭제 · 순서변경).
//   🔑 옛 「기본 · 읽기전용」 구분은 폐기했다(로이 2026-09-16) — 기본이라고 고칠 수 없을 이유가 없고,
//     두 종류가 섞여 있으면 「왜 이건 안 고쳐지지」를 매번 다시 배워야 한다.
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
        <input style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="스타일 이름" />
        <button className="ghost" title="이 스타일의 프롬프트 복사" onClick={() => onCopy(prompt)}>📋 복사</button>
        <button title="저장" disabled={!dirty} onClick={() => onSave(s.id, name, prompt)}>저장</button>
        <button className="ghost" title="삭제" onClick={() => onDelete(s.id, s.name)}>🗑</button>
      </div>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical' }} placeholder="영문 스타일 프롬프트" />
    </div>
  );
}

// 🔒 네이티브 alert/confirm 은 **창을 잠근다**(EnableWindow(false)) — 다른 창(Vrew·크롬) 뒤에 숨으면
//   앱이 클릭·키·ESC 를 전부 거부하는 "입력 잠김"이 된다(로이 2026-08-14 증상).
//   → 띄우기 직전에 창을 앞으로 끌어와 숨지 못하게 한다. main 은 별도 프로세스라 이 요청을 즉시 처리한다.
function uiConfirm(msg) { try { api.focusWindow(); } catch (_) {} return window.confirm(msg); }
function uiAlert(msg) { try { api.focusWindow(); } catch (_) {} return window.alert(msg); }

function normOutTargetUi(v) { return v === 'whiteboard' || v === 'mp4' ? v : 'vrew'; }

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
  // (채널 순서는 이제 편집창 「📋 채널」 탭에서 ▲▼ 로 바꾸고 **즉시 저장**한다 — 버퍼도 모달도 없다)
  const [styles, setStyles] = useState([]);

  // 헤더 컨트롤
  const [presetName, setPresetName] = useState('');
  const [reloadTick, setReloadTick] = useState(0);   // 🔁 밖에서 바뀐 대본을 자동으로 다시 읽은 횟수
  const [styleId, setStyleId] = useState('chibi');
  const [imgEngine, setImgEngine] = useState('genspark'); // 'genspark'|'flow'(브라우저 · 각 서비스 구독제 · 한도면 서로 이어받고 재설정 후 되돌아옴)|'gemini'|'comfy[::경로]'
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
  const [capLook, setCapLook] = useState(CAP_LOOK_DEFAULT);   // 🎨 자막 모양(채널 capLong 에서 읽는다)
  const [capPos, setCapPos] = useState('-0.15');
  const [capFine, setCapFine] = useState(10);
  const [capAlign, setCapAlign] = useState('start');
  const [capYAlign, setCapYAlign] = useState('bottom'); // 세로 기준 (middle/bottom/top)
  const [capXOff, setCapXOff] = useState(0);            // 📐 가로 미세(Vrew xOffset — 1 = 화면 폭 절반, + = 오른쪽) · 채널 capLong.xOffset
  const [ttsSpeed, setTtsSpeed] = useState('1.15');
  const [aiNotice, setAiNotice] = useState(false); // AI 고지 — 작업바 체크박스(기본 ON, 마운트 시 세팅)
  // 🔴 .vrew 출력 방식 — 'full'(전체) / 'audio'(음성만, 이미지 없이) / 'visual'(화면만, TTS 없이).
  //   'visual' 은 음성을 **Vrew 에서** 만들 때 쓴다 → 완성 후 「📥 Vrew 음성」으로 되가져온다.
  //   ⚠ 고르는 곳은 여기 하나뿐이다(채널 기본값을 두지 않는다 — 작업마다 달라지는 선택이라
  //     채널에 박으면 오히려 헷갈리고, 진입점이 둘이면 반드시 어긋난다).
  const [outMode, setOutMode] = useState('full');
  // ✏ 완성물 종류 — 'vrew'(Vrew 에서 마무리) | 'whiteboard'(손그림 MP4 · 4단계 2026-09-05). 헤더 「④ 완성」에서 고른다.
  // 🎬 'mp4' = .vrew 를 만든 뒤 Vrew 없이 유튜브 업로드용 MP4 로 굽는다(core/vrew-render.js).
  //   ⚠ 정규화는 반드시 이 함수 하나로 — 예전엔 4곳에 `=== 'whiteboard' ? 'whiteboard' : 'vrew'` 가 박혀 있어
  //     새 값을 고르면 저장·복원 때 조용히 .vrew 로 되돌아갔다(v0.3.50 「골라도 되돌아가던 것」과 같은 계열).
  const [outTarget, setOutTarget] = useState('vrew');
  const [wbCfg, setWbCfg] = useState(null);   // 화이트보드 렌더 설정(출력 긴변·동시 개수) — PC 별 파일
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
  const [findRes, setFindRes] = useState({ active: 0, total: 0 });
  const findTimerRef = useRef(null);                     // 검색 디바운스 타이머
  // 🔴 큐 순회용 중단 플래그 — main 의 S.abort 는 렌더러가 볼 수 없어서, 큐 루프가 중단을 모른 채
  //    다음 대본을 계속 시작했다(실측 2026-08-21: 0826 중단 → 0827·0828 이 이어서 시작됨).
  //    state 가 아니라 ref 인 이유: setState 는 비동기라 실행 중인 루프에 즉시 보이지 않는다.
  const queueAbortRef = useRef(false);
  const [logText, setLogText] = useState('');

  // 모달/플레이어 상태
  const [chOpen, setChOpen] = useState(false);
  const [chTab, setChTab] = useState('basic'); // 채널편집 탭 (basic·voice·caption·tools·folder)
  // 채널 설정이 저장될 때마다 +1 — 채널 값을 읽어 쓰는 화면이 이걸 보고 다시 읽는다.
  const [presetRev, setPresetRev] = useState(0);
  const [ch, setCh] = useState(null);          // 편집 중 프리셋 폼
  // (새 채널 이름 칸도 「📋 채널」 탭 안에 있다)
  const [newChanName, setNewChanName] = useState('');
  const [chStyles, setChStyles] = useState([]);
  const [chRefList, setChRefList] = useState([]); // 참조음성 파일 목록
  const [tsOpen, setTsOpen] = useState(false);   // ⏱ 유튜브 타임스탬프(챕터) 모달
  // 🔗 URL 다운로드 → STT
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlProg, setUrlProg] = useState(null);
  const [readerOpen, setReaderOpen] = useState(false);   // 📄 대본 읽기(점검·수정 · A4 PDF)
  const [ytProg, setYtProg] = useState(null);     // ⬆ 유튜브 비공개 업로드 진행 패널(main 의 yt-progress)
  const [ytSt, setYtSt] = useState(null);         // ⬆ 유튜브 연결 상태 {hasClient, projectId, channels[]}
  const [mp4Prog, setMp4Prog] = useState(null);   // 📊 🎬 유튜브 MP4 굽기 진행 패널(main 의 mp4-progress)   // 📊 URL 받아 전사 진행 패널(main 의 urldl-progress)
  const [urlMode, setUrlMode] = useState('audio');       // 기본은 mp3(로이 확정) — 영상은 크고 STT 엔 불필요
  const [urlForceStt, setUrlForceStt] = useState(false); // 켜면 자막이 있어도 Whisper 로 전사
  const [urlChannelAll, setUrlChannelAll] = useState(false); // 채널 /videos 전체를 기존 단일영상 경로로 순회
  const [ytInfo, setYtInfo] = useState(null);            // yt-dlp 유무·버전
  const urlTextRef = useRef(null);                       // 비제어 — 글자마다 재렌더하지 않는다(v0.3.9)
  const [tsData, setTsData] = useState(null);    // { text, total, warns } — 열 때 계산
  const tsRef = useRef(null);                    // 편집 가능한 textarea (복사는 여기서 읽는다)
  const [impOpen, setImpOpen] = useState(false);
  const [impText, setImpText] = useState('');
  const [impProvider, setImpProvider] = useState('ollama');
  const [impBusy, setImpBusy] = useState(false);
  const [preview, setPreview] = useState(null); // { kind, src }
  // ⏳ 그림·영상 불러오기 진행 — 작업했던 대본을 열면 썸네일이 한동안 검게 비어 있다(구글드라이브에서 받아 오는 중).
  //   화면의 그림·영상 칸이 **실제로 다 그려질 때까지** 가운데 창으로 보여 준다(0.4초 안에 끝나면 띄우지 않는다).
  const [mediaLoad, setMediaLoad] = useState(null);   // { done, total, img, imgT, vid, vidT, sec }
  const mediaLoadKeyRef = useRef('');
  const mediaLoadHiddenRef = useRef(false);   // 「숨기기」 — 이 대본이 다 뜰 때까지 다시 띄우지 않는다(세기·로그는 계속)
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playKey, setPlayKey] = useState(null);   // ▶ → ■ — 지금 재생 중인 미리보기(shorts:N · group:N:G · from:N:G · all)
  const playingRef = useRef(false);               // 재생 중(삽입 영상 소리를 켠다)
  // 🔑 재생 번호표 — 멈춘 뒤 새로 재생하면 옛 재생의 타이머가 깨어나 「끝났다」며 새 재생을 닫아 버렸다(v0.5.58).
  //   각 재생은 자기 번호를 들고, 번호가 바뀌었으면(= 멈췄거나 새 재생) 조용히 빠진다.
  const playGenRef = useRef(0);
  const stale = (g) => playAbortRef.current || playGenRef.current !== g;
  const [scriptEditOpen, setScriptEditOpen] = useState(false);
  const impRef = useRef(null);          // 붙여넣기 textarea (비제어)
  const scriptEditRef = useRef(null);   // 대본수정 textarea (비제어 — 재렌더 방지)
  // ✏ 문장 인라인 편집 — 한 번에 한 문장만 열린다. 값은 ref 로만 읽는다(타이핑마다 재렌더 금지).
  const sentEditRef = useRef(null);
  const [sentEdit, setSentEdit] = useState(null);   // { shortsNum, groupNum, sentIdx, count, text }
  // 🎨 자막 서식(2026-09-25) — 채널 편집의 서식 창 · 목록에서 고른 자막 줄/글자 · 열린 옆 패널
  const [capDlg, setCapDlg] = useState(null);       // { key: 'capLong', panel: 'fmt'|'anim' }
  const [capSel, setCapSel] = useState(null);       // { shortsNum, mode: 'lines'|'chars', items: [{ groupNum, sentIdx, from, to, n }] }
  const [capPanel, setCapPanel] = useState(null);   // 'fmt' | 'anim'
  // 🧭 Vrew 식 작업 화면(v0.5.42) — 메뉴(리본) · 보기(클립/카드) · ① 칸 폭 · 커서(자막 줄)
  // 메뉴는 켤 때마다 「대본·음성」부터(Vrew 도 홈부터) — 기억해 두면 다음 실행이 엉뚱한 메뉴로 열려 「열기」가 안 보인다
  const [menu, setMenu] = useState('script');
  const pickMenu = (id) => { if (MENUS.some((x) => x[0] === id)) setMenu(id); };
  const [view, setView] = useState(() => (lsGet('pm.view', 'clips') === 'cards' ? 'cards' : 'clips'));
  const pickView = (v) => { setView(v); lsSet('pm.view', v); };
  // 🧩 클립 보기의 개요/상세(Vrew 오른쪽 위 토글) — 상세 = 클립마다 화자·시각 머리줄 + 어절 칩 + 자막 줄
  const [clipDetail, setClipDetail] = useState(() => lsGet('pm.clipDetail', '1') !== '0');
  const pickClipDetail = (on) => { setClipDetail(on); lsSet('pm.clipDetail', on ? '1' : '0'); };
  // ① 칸 폭 = **비율**(기본 40% — Vrew 와 비슷). 🔴 px 로 두면 창이 처음 뜰 때의 너비로 계산돼, 창을 줄인 뒤 ① 이 화면을 다 먹었다(실측).
  const [pane1W, setPane1W] = useState(() => { const r = Number(lsGet('pm.pane1R', 0.4)); return r >= 0.2 && r <= 0.7 ? r : 0.4; });
  const [cursor, setCursor] = useState(null);       // { shortsNum, n } — ② 에서 지금 가리키는 자막 줄
  const lastVisRef = useRef(null);                   // ① 에 지금 깔린 그림/영상(같으면 다시 깔지 않는다 — 영상이 처음부터 다시 돈다)
  const stopLineRef = useRef(null);                 // 미리보기 재생 — 지금 도는 자막 효과 멈춤
  // 🎨 옆 패널은 고정 헤더(topsticky) 바로 아래에서 시작해야 툴바를 가리지 않는다 — 헤더 높이는 창 폭·툴바 유무로 바뀌므로 재서 넘긴다
  useEffect(() => {
    const el = document.querySelector('.topsticky');
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const put = () => document.documentElement.style.setProperty('--tophead', Math.round(el.getBoundingClientRect().height) + 'px');
    const ro = new ResizeObserver(put); ro.observe(el); put();
    return () => ro.disconnect();
  }, []);
  const [sentBusy, setSentBusy] = useState(false);
  // 🔑 이 편집 세션이 이미 끝났는가(키로 저장/나누기/합치기/취소했는가).
  //   저장 버튼이 없어 **칸을 벗어나면 저장**하는데, 키로 처리한 뒤 편집칸이 사라질 때도 blur 가 뜬다
  //   → 이 표시가 없으면 같은 편집이 두 번 전송된다.
  const sentDoneRef = useRef(false);
  const findTextRef = useRef('');        // 검색어 (비제어)
  const findSessionRef = useRef('');                      // 지금 열려 있는 검색 세션의 문자열(Electron findNext 판정용)
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
  // 🎛 Genspark 비디오 모델 — 헤더 select 와 ⚙ 설정 select 가 **같은 저장값**(imgRot.gensparkVideoModel)을 쓴다.
  //   두 곳이 각자 값을 들면 어긋난다(v0.3.50·v0.3.76 계열). 실행 IPC 에도 이 값을 실어 보낸다(헤더 우선).
  const gsVideoModel = (imgRot && imgRot.gensparkVideoModel) || 'MiniMax H3 Max';
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
  const [prevKey, setPrevKey] = useState(null);   // ▶ → ■ — 지금 울리는 미리듣기(참조음성·화자·보이스디자인)
  function stopPreviewAudio() {
    try { if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current.currentTime = 0; } } catch {}
    previewAudioRef.current = null; setPrevKey(null);
  }
  function playPreviewUrl(url, key) {
    stopPreviewAudio();
    if (!url) return;
    const a = new Audio(url);
    previewAudioRef.current = a; setPrevKey(key || 'x');
    a.onended = () => { if (previewAudioRef.current === a) { previewAudioRef.current = null; setPrevKey(null); } };
    a.play().catch(() => { if (previewAudioRef.current === a) { previewAudioRef.current = null; setPrevKey(null); } });
  }
  const pvBtn = (key) => (prevKey === key ? '■' : '▶');
  const loaded = !!(dto && ((dto.projects && dto.projects.length) || dto.kind === 'book'));
  // 통합대본('> 📥 자산출처:' 메타)의 소스 개수 — 0 이면 「📥 이어받기」 버튼을 아예 안 그린다.
  const mergeSources = (dto && dto.mergeSources) || 0;

  // 자막 한 줄 글자수 — 분할옵션의 '긴 n자'(longLen) 기준.
  const effCap = Math.max(2, parseInt(splitOpts.long, 10) || 20);
  // 🧭 편마다 자막 줄 목록 — ① 미리보기·② 목록(Cards)·키보드가 **같은 번호**를 쓴다(Workspace.buildProjLines 한 곳)
  const linesMap = useMemo(() => {
    const m = new Map();
    for (const pr of ((dto && Array.isArray(dto.projects)) ? dto.projects : [])) if (pr && pr.cuts) m.set(pr.shortsNum, buildProjLines(pr, effCap));
    return m;
  }, [dto, effCap]);
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
    return { size: capSize, yOffset: baseY + fine * 0.0025, xOffset: Number(capXOff) || 0, align: capAlign, yAlign: capYAlign, ...capLookToStyle(capLook) };
  }, [capPos, capFine, capSize, capAlign, capYAlign, capXOff, capLook]);

  // fromMain=true 면 main 이 보낸 줄 — 파일에는 이미 기록돼 있으므로 되보내지 않는다(중복 방지).
  const logline = useCallback((t, fromMain) => {
    setLogText((prev) => prev + t + '\n');
    if (!fromMain) { try { api.appendLog(String(t)); } catch (_) {} }
  }, []);

  useEffect(() => {
    api.onLog((line) => logline(line, true));
    if (api.onUrldlProgress) api.onUrldlProgress((d) => { if (d) setUrlProg(d); });
    if (api.onMp4Progress) api.onMp4Progress((d) => { if (d) setMp4Prog(d); });
    if (api.onYtProgress) api.onYtProgress((d) => { if (d) setYtProg(d); });
    api.onDtoUpdate((d) => { if (d) { setDto(d); if (d.timings) setTimings(d.timings); if (d.queue) setQueue(d.queue); } });
    if (api.onScriptReloaded) api.onScriptReloaded(() => setReloadTick((t) => t + 1));   // 📄 대본 보기가 새로 그리게
    api.onAutosaved((info) => setAutoSavedAt((info && info.at) || Date.now()));
    api.getAppVersion().then((v) => { if (v) setAppVersion(v); }).catch(() => {});
    loadPresets().then(loadStyles);
    // 🎛 브라우저 이미지·비디오 설정(Flow 모델·Genspark 비디오 모델)을 부팅 때 읽는다 — 헤더 select 가 쓴다.
    api.getImageRotation().then((r) => { if (r) setImgRot(r); }).catch(() => {});
    api.getWhiteboardConfig().then((c) => { if (c) setWbCfg(c); }).catch(() => {});
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
      setBgmCfg({ on: !!p.bgmOn, path: p.bgmPath || '', volume: p.bgmVolume != null ? Number(p.bgmVolume) : 15 });   // 🎵 채널 배경음악(➕ 삽입 메뉴)
      setLogoCfg({ on: !!p.logoOn, path: p.logoPath || '', size: Math.max(4, Math.min(40, Number(p.logoSize) || 12)) });   // 🏷 채널 로고(➕ 삽입 메뉴 · ① 칸 미리보기)
      const prof = (modeProfiles && modeProfiles[mode]) || {};
      const cap = p.capLong;
      if (cap) {
        if (cap.size != null) setCapSize(String(cap.size));
        if (cap.align) setCapAlign(cap.align);
        if (cap.yAlign) setCapYAlign(cap.yAlign);
        if (cap.yOffset != null) applyCaptionYOffset(cap.yOffset);
        setCapXOff(Number(cap.xOffset) || 0);
      } else { applyCaptionDefaults(prof); setCapXOff(0); }
      setCapLook(capLookOf(cap));   // 없으면 기본 모양(지금까지와 같다)
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
        if (p.videoEngine != null) setVideoEngine(['wan', 'grok10'].includes(p.videoEngine) ? 'grok' : p.videoEngine);
        if (p.outTarget != null) setOutTarget(normOutTargetUi(p.outTarget));
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
    setStatus('도입부 TTS + 영상 길이 기준 재배치…');
    try { const d = await api.introVideoPrep({ presetName: presetName || null, speed: ttsSpeed || null }); if (d) setDto(d); setStatus('도입부 재배치 완료'); }
    catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  // 📥 통합본 자산 이어받기 — 기존 회차의 TTS·이미지·비디오를 이 작업폴더로 복사·연결(재실행 안전).
  // 🔁 밖에서 .md 가 바뀌면 main 이 자동으로 다시 읽는다(v0.5.39) — 옛 「🔄 대본 다시 읽기」 버튼은 뺐다(IPC 는 남김).

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
  }, [logText]);


  // 처음에 고를 채널 = **드롭다운 맨 위에 보이는 채널** (로이 2026-09-16).
  //   ⚠ 배열 첫 항목이 아니라 **화면 순서**를 따른다 — 드롭다운은 그룹 없는 채널을 먼저 묶어 보여준다.
  //   (예전엔 isDefault 채널을 골랐다 → 목록 순서를 바꿔도 04_역사이야기가 계속 뜨는 이유였다)
  function firstChannelName(ps) {
    const list = ps || [];
    if (!list.length) return '';
    const noGroup = list.find((p) => !p.group);
    return (noGroup || list[0]).name;
  }
  async function loadPresets() {
    const ps = await api.listPresets();
    setPresets(ps || []);
    // 목록은 **사용자가 ↕ 로 정한 순서** 그대로다(더는 기본채널을 맨 위로 올리지 않는다).
    //   그래서 "처음에 고를 채널"은 순서가 아니라 isDefault 로 찾는다.
    if (ps && ps.length && !presetName) setPresetName(firstChannelName(ps));
  }
  async function loadStyles() {
    const ss = await api.listStyles();
    setStyles(ss || []);
  }

  // ── 액션 핸들러 ──────────────────────────────────────────
  // 대본별 생성 설정 묶음(채널·스타일·배속·엔진·영상범위) — 큐 항목마다 개별 저장.
  function currentSettings() {
    return { presetName, styleId, ttsSpeed, imgEngine, videoEngine, vidFrom, vidTo, flowVideoModel, flowCount, aiNotice, outMode, outTarget };
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
    if (s.videoEngine != null) setVideoEngine(['wan', 'grok10'].includes(s.videoEngine) ? 'grok' : s.videoEngine);
    if (s.vidFrom != null) setVidFrom(s.vidFrom);
    if (s.vidTo != null) setVidTo(s.vidTo);
    hasStoredRangeRef.current = (s.vidFrom != null || s.vidTo != null); // 저장된 범위 있으면 기본값 effect 억제
    if (s.flowVideoModel != null) setFlowVideoModel(s.flowVideoModel);
    if (s.flowCount != null) setFlowCount(s.flowCount);
    if (s.aiNotice != null) setAiNotice(!!s.aiNotice);
    if (s.outMode != null) setOutMode(['full', 'audio', 'visual'].includes(s.outMode) ? s.outMode : 'full');
    if (s.outTarget != null) setOutTarget(normOutTargetUi(s.outTarget));
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
  // 🔗 URL(유튜브·비메오·틱톡·인스타 …) → 받아서 바로 STT
  //   🔑 **자막이 있으면 STT 를 건너뛴다** — 유튜브 자동자막을 그대로 쓰면 GPU 를 0초 쓰고 수 초에 끝난다.
  async function openUrlDl() {
    setUrlOpen(true);
    try { setYtInfo(await api.ytdlpStatus()); } catch { setYtInfo(null); }
  }
  async function runUrlDl() {
    const urls = String(urlTextRef.current?.value || '')
      .split(/[\n\r]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
    if (!urls.length) { logline('주소를 한 줄에 하나씩 붙여넣으세요 (http… 로 시작)'); return; }
    setUrlOpen(false);
    setUrlBusy(true);
    setStatus(urlChannelAll ? '📺 채널 영상 목록 확인 중…' : `🔗 ${urls.length}개 받는 중…`);
    try {
      const r = await api.sttFromUrl({ urls, mode: urlMode, forceStt: urlForceStt, channel: urlChannelAll, presetName: presetName || null });
      if (!r || r.canceled) { setStatus('취소'); return; }
      if (!r.ok) { logline('오류: ' + (r.error || '알 수 없음')); setStatus('오류'); return; }
      const okN = (r.results || []).filter((x) => x.ok).length;
      const subN = (r.results || []).filter((x) => x.from === 'subtitle').length;
      setStatus(`🔗 완료 (${okN}/${(r.results || []).length})${subN ? ` · 자막 ${subN}건은 STT 생략` : ''}`);
    } catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
    finally { setUrlBusy(false); }
  }
  async function updateYtdlp() {
    setUrlBusy(true);
    try {
      const r = await api.ytdlpUpdate();
      if (r && r.ok) logline(`✓ yt-dlp ${r.version} 으로 업데이트했습니다`);
      setYtInfo(await api.ytdlpStatus());
    } catch (e) { logline('오류: ' + e.message); }
    finally { setUrlBusy(false); }
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
    try { const d = await api.videoBuild({ shortsNum, fromNum: parseInt(vidFrom, 10) || 1, toNum: parseInt(vidTo, 10) || 1, engine: videoEngine, flowVideoModel, flowCount, gensparkVideoModel: gsVideoModel, imgEngine, styleId: styleId || null }); setDto(d); setStatus('비디오 완료'); }
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
          if (ph === 'video' && videoEngine !== 'none') { const d = await api.videoBuild({ shortsNum: null, fromNum: parseInt(vidFrom, 10) || 1, toNum: parseInt(vidTo, 10) || 1, engine: videoEngine, flowVideoModel, flowCount, gensparkVideoModel: gsVideoModel, imgEngine, styleId: styleId || null }); if (d) setDto(d); }
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
      if (videoEngine !== 'none') { d = await api.videoBuild({ shortsNum, fromNum: parseInt(vidFrom, 10) || 1, toNum: parseInt(vidTo, 10) || 1, engine: videoEngine, flowVideoModel, flowCount, gensparkVideoModel: gsVideoModel, imgEngine, styleId: styleId || null }); if (d) setDto(d); }
      setStatus('이미지→비디오 완료');
    } catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  // ⚡ 만들기·✏ 렌더가 **같은 인자**를 쓴다 — 두 벌로 두면 한쪽만 고쳐져 조용히 갈라진다.
  function makeArgs(shortsNum) {
    return {
      shortsNum, engine: imgEngine, presetName: presetName || null, speed: ttsSpeed || null,
      captionStyle: capOverride(), captionMaxChars: effCap, styleId: styleId || null,
      fromNum: parseInt(vidFrom, 10) || 1, toNum: parseInt(vidTo, 10) || 1,
      dry: false, videoEngine, flowVideoModel, flowCount, gensparkVideoModel: gsVideoModel,
      aiNotice, // 사용자 선택(작업바 토글)
      outMode: effOutMode(),  // 전체 / 음성만 / 화면만 (화이트보드는 늘 전체)
      outTarget, // .vrew / ✏ 화이트보드 MP4
    };
  }
  // ✏ 화이트보드는 음성·그림이 **둘 다** 있어야 만들어진다 → 출력 방식을 늘 「전체」로 본다
  //   (옛 ✏ 렌더 버튼이 서버에서 outMode:'full' 로 강제하던 것을 ⚡ 만들기로 옮겼다 — 2026-09-24 버튼 통일).
  function effOutMode() { return outTarget === 'whiteboard' ? 'full' : outMode; }
  // 이 완성 종류에 비디오 프롬프트가 필요한가 — 화이트보드는 그룹 이미지만 쓴다(비디오 단계를 건너뛴다).
  function needVideoPrompts() { return (outTarget === 'whiteboard' || videoEngine === 'none') ? 'none' : 'range'; }
  async function runMake(shortsNum) {
    const args = makeArgs(shortsNum);
    // ⚠ 「🎤 음성만」은 이미지를 만들지 않으므로 이미지 프롬프트를 요구하지 않는다(요구하면 못 만든다).
    const om = effOutMode();
    const _needImg = (om === 'audio') ? 'none' : 'all';
    const _needVid = (om === 'audio') ? 'none' : needVideoPrompts();
    if (!ensurePromptsFilled(shortsNum, { image: _needImg, video: _needVid })) return; // 만들기=전체 이미지 + 범위 i2v
    const tgt = outTarget === 'whiteboard' ? '✏ 화이트보드 MP4' : outTarget === 'mp4' ? '.vrew → 🎬 유튜브 MP4' : '.vrew';
    setStatus(om === 'audio' ? '⚡ 음성만 제작중… (TTS→.vrew)'
      : om === 'visual' ? '⚡ 화면만 제작중… (이미지→.vrew · 음성은 Vrew 에서)'
      : outTarget === 'whiteboard' ? '⚡ 제작중… (TTS+이미지 → ✏ 화이트보드 렌더)'
      : `⚡ 전체 제작중… (TTS+이미지→영상→${tgt})`);
    try { const d = await api.makeAll(args); setDto(d); setStatus(`⚡ 완료 — ${tgt}`); }
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
    if (!ensurePromptsFilled(null, { image: effOutMode() === 'audio' ? 'none' : 'all', video: effOutMode() === 'audio' ? 'none' : needVideoPrompts() })) return; // 현재 표시 대본 기준 빈 프롬프트 검사 ('없음'·화이트보드는 i2v 불요)
    setStatus(`⚡⚡ 큐 순차 제작중… (${plan.length}개)`);
    try {
      // 비디오·이미지 엔진은 헤더값(이번 실행 공통)으로 전달 — 큐 항목별 stale 값 무시(헤더 '없음'이면 전 대본 영상 없음)
      // 채널(presetName)·배속·AI고지도 함께 보낸다 — 항목에 저장된 값이 우선이고, **없을 때만** 이 헤더값이
      //   폴백으로 쓰인다. 안 보내면 서버가 getPreset(null)=기본 채널로 떨어져 **엉뚱한 목소리**로 합성된다
      //   (2026-08-31 실사고: 대본 4개를 한 번에 열면 마지막 1개만 presetName 이 저장돼 있었다).
      // 영상 범위(vidFrom~vidTo)도 헤더값을 공통으로 전달 — 항목 저장값이 없어도 헤더 범위가 적용된다.
      //   (안 보내면 서버가 '미지정'으로 보고 안전기본 G1 만 만든다 — 전 그룹 생성 사고 방지)
      const r = await api.runBatch({ plan, common: { captionStyle: capOverride(), captionMaxChars: effCap, videoEngine, imgEngine, flowVideoModel, flowCount, gensparkVideoModel: gsVideoModel, vidFrom, vidTo, styleId: styleId || null, presetName: presetName || null, ttsSpeed: ttsSpeed != null ? ttsSpeed : null, outTarget, aiNotice, outMode: effOutMode() }, openEach: openEachVrew });
      if (r && r.queue) setQueue(r.queue);
      if (r && r.dto) { setDto(r.dto); setFtitle(r.dto.fileTitle || ''); }
      setStatus('⚡⚡ 큐 제작 완료');
    } catch (e) { logline('큐 제작 오류: ' + e.message); setStatus('큐 제작 오류'); }
  }
  // 📥 Vrew 에서 음성을 입혀 저장한 .vrew → 그 음성만 대본에 물려준다(.vrew 는 읽기만 한다).
  async function runImportVrewAudio() {
    if (!loaded) return;
    setStatus('📥 Vrew 음성 가져오는 중…');
    try {
      const r = await api.importVrewAudio({ shortsNum: null });
      if (!r || r.canceled) { setStatus(''); return; }
      if (r.dto) setDto(r.dto);
      const oks = (r.results || []).filter((x) => !x.error);
      const n = oks.reduce((a, x) => a + (x.injected || 0), 0);
      setStatus(oks.length ? `📥 문장 ${n}개에 Vrew 음성 연결` : '가져오기 실패 — 로그를 보세요');
    } catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  // 🔗 작업물 다시 연결 — 출력 폴더에 파일은 있는데 그룹·문장이 가리키지 않을 때(그림 media-N/NN · 음성은 .vrew 에서 글자로 맞춰)
  async function runRelinkWork() {
    if (!loaded) return;
    if (!(await uiConfirm('출력 폴더에 남아 있는 그림·영상·음성을 이 대본에 다시 연결합니다.\n\n· 그림·영상: 그룹 번호(media-N/01.png …)로 찾습니다\n· 음성: 음성이 없는 문장만, 출력 폴더의 .vrew 에서 글자로 맞춰 가져옵니다\n\n이미 연결된 것은 건드리지 않습니다. 계속할까요?'))) return;
    setStatus('🔗 작업물 다시 연결하는 중…');
    try {
      const r = await api.relinkWork();
      if (r && r.dto) setDto(r.dto);
      setStatus(r && r.ok ? `🔗 그림 ${r.images} · 영상 ${r.videos} · 음성 ${r.voices} 연결${r.voiceMissing ? ` · 음성 못 찾음 ${r.voiceMissing}` : ''} (Ctrl+Z 되돌리기)` : '다시 연결 실패 — 로그를 보세요');
    } catch (e) { logline('다시 연결 오류: ' + e.message); setStatus('다시 연결 오류'); }
  }
  // 💾 .vrew · 🎬 MP4 굽기 · ✏ 렌더 버튼은 **⚡ 만들기 하나로 통일**했다(로이 2026-09-24).
  //   ⚡ 만들기가 이미 만든 음성·이미지·영상은 건너뛰고(이어받기) ④ 완성의 선택(.vrew / ✏ 화이트보드 / 🎬 유튜브 MP4)대로
  //   끝을 낸다 → 세 버튼은 결과가 사실상 같았다. IPC(export-vrew · whiteboard-build)는 테스트·CLI 용으로 남긴다.
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
  // roll(Shift+클릭) 일 때만 시드를 갈아끼워 '다른 take' 를 뽑는다. 평소엔 **채널 시드 고정** —
  //   시드가 매번 달라지면 그 그룹만 톤이 달라져 한 영상 안에서 목소리가 바뀐 것처럼 들린다.
  async function runGroupTts(shortsNum, groupNum, roll = false) {
    setStatus(`G${groupNum} TTS…`);
    try { const d = await api.ttsGroup({ shortsNum, groupNum, presetName: presetName || null, speed: ttsSpeed || null, roll: !!roll }); setDto(d); setStatus(`G${groupNum} TTS 완료`); }
    catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  async function runGroupVid(shortsNum, groupNum) {
    setStatus(`G${groupNum} 비디오…`);
    try { const d = await api.videoGroup({ shortsNum, groupNum, engine: videoEngine, flowVideoModel, flowCount, gensparkVideoModel: gsVideoModel, imgEngine, styleId: styleId || null }); setDto(d); setStatus(`G${groupNum} 비디오 완료`); }
    catch (e) { logline('오류: ' + e.message); setStatus('오류'); }
  }
  function playFrom(shortsNum, groupNum, start, tag) {
    if (!dto) return;
    const key = (tag === 'cursor' ? 'cursor:' : 'from:') + shortsNum + ':' + groupNum;
    if (playerOpen && playKey === key) { stopPlayer(); return; }   // ■
    const pr = dto.projects.find((p) => p.shortsNum === shortsNum); if (!pr) return;
    const idx = pr.cuts.findIndex((c) => c.num === groupNum); if (idx < 0) return;
    playProjects([{ ...pr, cuts: pr.cuts.slice(idx) }], false, key, start || null); // 이 그룹(start 가 있으면 그 클립)부터 끝까지
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
  // ⤒ 앞 그룹과 합치기 — 앞 그림을 이 그룹 끝까지 이어 쓴다(로이 2026-09-24 「어디부터 어디까지 같은 그림」).
  async function mergeGroup(shortsNum, groupNum) {
    try { const d = await api.mergeGroup({ shortsNum, groupNum }); setDto(d); setStatus(`⤒ G${groupNum} 을 G${groupNum - 1} 에 합쳤습니다 — G${groupNum - 1} 그림을 이어 씁니다`); }
    catch (e) { const m = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); logline('⤒ 합치기: ' + m); setStatus(m); }
  }
  // ⏳ 대본이 바뀌면(열기·큐 선택) 화면의 그림·영상이 다 뜰 때까지 센다
  const _mlKey = dto && dto.projects && !isBk && !isRx ? (dto.fileTitle || '') + '|' + ((queue && queue[mode] && queue[mode].activeId) || '') : '';
  useEffect(() => {
    if (!_mlKey) { mediaLoadKeyRef.current = ''; return undefined; }   // 화면을 비우면 다음에 같은 대본을 열어도 다시 센다
    if (_mlKey === mediaLoadKeyRef.current) return undefined;
    mediaLoadKeyRef.current = _mlKey;
    mediaLoadHiddenRef.current = false;
    const t0 = performance.now();
    let shown = false, stop = false, timer = null;
    const scan = () => {
      const imgs = [...document.querySelectorAll('.cut img.thumb, #stageVisual img')];
      const vids = [...document.querySelectorAll('.cut video.thumb, #stageVisual video')];
      // 영상 = 첫 장면이 그려질 때(readyState 2) · 오류가 나도 끝난 것으로 센다(창이 영원히 안 닫히면 안 된다)
      const iDone = imgs.filter((e) => e.complete).length;
      const vDone = vids.filter((e) => e.readyState >= 2 || e.error || e.networkState === 3).length;
      const total = imgs.length + vids.length, done = iDone + vDone;
      const sec = (performance.now() - t0) / 1000;
      const st = { done, total, img: iDone, imgT: imgs.length, vid: vDone, vidT: vids.length, sec };
      if (total === 0 && sec < 1.5) return false;   // 아직 목록이 안 그려졌을 수 있다
      if (done >= total || sec > 90) {
        if (total > 0) { try { api.appendLog(`⏳ 그림·영상 불러오기 ${done}/${total}개 — ${sec.toFixed(1)}초${done < total ? ' (시간 초과 — 나머지는 뒤에서 계속 받습니다)' : ''}`); } catch (_) {} }
        setMediaLoad(null); return true;
      }
      if (!mediaLoadHiddenRef.current && (shown || sec > 0.4)) { shown = true; setMediaLoad(st); }
      return false;
    };
    const tick = () => { if (stop) return; if (!scan()) timer = setTimeout(tick, 250); };
    timer = setTimeout(tick, 120);
    return () => { stop = true; clearTimeout(timer); };
  }, [_mlKey]);
  // 🖼 그림 모양(채우기·반전·움직임) · 🏷 AI 고지 범위
  async function setGroupLook(shortsNum, groupNum, patch) {
    try { const d = await api.setGroupLook({ shortsNum, groupNum, patch }); if (d) setDto(d); setStatus(`🖼 G${groupNum} 그림 모양을 바꿨습니다 (Ctrl+Z 되돌리기)`); }
    catch (e) { logline('그림 모양 오류: ' + e.message); }
  }
  async function setAiRange(shortsNum, from, to, ask) {
    try {
      if (ask) {
        const v = await askName(`AI 고지를 보일 문장 범위 (1~${ask.n}, 예: 1-3)`, ask.cur || '1-3');
        if (v == null) return;
        const mm = String(v).match(/(\d+)\s*[-~–]\s*(\d+)/) || String(v).match(/^\s*(\d+)\s*$/);
        if (!mm) { setStatus('범위는 「1-3」처럼 적습니다'); return; }
        from = Number(mm[1]); to = Number(mm[2] || mm[1]);
      }
      const d = await api.setAiNoticeRange(from == null ? { shortsNum, clear: true } : { shortsNum, from, to });
      if (d) setDto(d);
      setStatus(from == null ? '🏷 AI 고지 — 채널 기본(5초 뒤 5초)' : `🏷 AI 고지 → 문장 ${from}~${to}`);
    } catch (e) { logline('AI 고지 범위 오류: ' + e.message); }
  }
  // 🖼 그림 적용 범위 — 막대 끌기·썸네일 메뉴 공통. 통째로 덮여 사라지는 그룹의 그림이 있으면 먼저 묻는다.
  async function setVisualRange(shortsNum, groupNum, from, to, ask) {
    try {
      if (ask) {
        const v = await askName(`G${groupNum} 그림을 쓸 문장 범위 (1~${ask.n}, 예: ${ask.gs}-${ask.ge})`, `${ask.gs}-${ask.ge}`);
        if (v == null) return;
        const mm = String(v).match(/(\d+)\s*[-~–]\s*(\d+)/) || String(v).match(/^\s*(\d+)\s*$/);
        if (!mm) { setStatus('범위는 「5-20」처럼 적습니다'); return; }
        from = Number(mm[1]); to = Number(mm[2] || mm[1]);
      }
      // 🖼 v0.5.47 — 늘려도 지우지 않는다(겹쳐 깐다) → 확인창이 필요 없다
      const d = await api.setVisualRange({ shortsNum, groupNum, from, to });
      if (d) setDto(d);
      setStatus(`🖼 G${groupNum} 그림 범위 → 문장 ${from}~${to}`);
    } catch (e) { logline('범위 변경 오류: ' + e.message); setStatus('⚠ ' + e.message); }
  }
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
  // ✏ 화이트보드 — 설정 저장 · 장면 계획(관문 A 만) · 렌더(관문 A→B→렌더)
  async function saveWbCfg(patch) {
    const next = { ...(wbCfg || {}), ...patch }; setWbCfg(next);
    try { const saved = await api.setWhiteboardConfig(patch); if (saved) setWbCfg(saved); } catch (e) { logline('화이트보드 설정 저장 오류: ' + e.message); }
  }
  async function showWhiteboardPlan() {
    try { await api.whiteboardPlan({ shortsNum: null }); } catch (e) { logline('장면 계획 오류: ' + e.message); }
  }
  // window.prompt 대체 — Electron 렌더러에서 prompt()가 미지원/예외라, 이름 입력을 모달로 받아 Promise 로 반환.
  // ➕ 삽입 — 그림·영상·오디오를 정한 클립(문장) 범위 동안(v0.5.54) · 🏷 채널 로고
  const [logoCfg, setLogoCfg] = useState({ on: false, path: '', size: 12 });
  const curLogoSide = () => { const pj = curProject(); return (pj && pj.logoSide) === 'left' ? 'left' : 'right'; };
  const stageLogo = logoCfg.on && logoCfg.path ? { ...logoCfg, side: curLogoSide() } : null;
  async function setLogoSide(side) {
    const pj = curProject(); if (!pj) return;
    try { const d = await api.setLogoSide({ shortsNum: pj.shortsNum, side }); if (d) setDto(d); setStatus(`🏷 이 대본 로고 → ${side === 'left' ? '↖ 왼쪽 위' : '↗ 오른쪽 위'} (Ctrl+Z 되돌리기)`); }
    catch (e) { logline('로고 위치 오류: ' + e.message); }
  }
  const [insMenu, setInsMenu] = useState(null);   // { sn, id, x, y } — 적용 범위 메뉴
  // 🎵 채널 배경음악 — 영상 전체(채널의 모든 영상). 구간만 넣을 땐 🎵 오디오 삽입
  const [bgmCfg, setBgmCfg] = useState({ on: false, path: '', volume: 15 });
  async function saveBgm(patch) {
    const next = { ...bgmCfg, ...patch };
    setBgmCfg(next);
    if (!presetName) return;
    try {
      const vol = Math.max(0, Math.min(100, Number(next.volume) || 0));
      await api.savePreset({ name: presetName, patch: { bgmOn: !!next.on, bgmPath: next.path || '', bgmVolume: vol } });
      setStatus(next.on && next.path ? `🎵 채널 「${presetName}」 배경음악 — ${String(next.path).split(/[\\/]/).pop()} · 음량 ${vol}% (이 채널의 모든 영상)` : `🎵 채널 「${presetName}」 배경음악 끔`);
    } catch (e) { logline('배경음악 저장 오류: ' + e.message); }
  }
  async function pickBgm(dir) {
    const f = dir ? await api.pickDir() : await api.pickFile({ filters: [{ name: '음악', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] }] });
    if (f) saveBgm({ path: f, on: true });
  }
  function openInsMenu(sn, id, el) { const r = el.getBoundingClientRect(); setInsMenu({ sn, id, x: r.left, y: r.bottom + 4 }); }
  async function overlayOp(args) {
    try {
      const r = await api.overlayOp(args);
      if (r && r.dto) setDto(r.dto);
      if (r && r.error) setStatus('⚠ ' + r.error);
      return r;
    } catch (e) { logline('삽입 오류: ' + e.message); setStatus('⚠ ' + e.message); return null; }
  }
  // 지금 커서가 있는 클립의 문장 번호(편 전체 1부터) — 「현재 클립」
  function curOrd(sn) {
    const pj = dto && dto.projects ? dto.projects.find((x) => x.shortsNum === sn) : null;
    const PL = linesMap.get(sn);
    const ln = PL && cursor && cursor.shortsNum === sn ? PL.list.find((x) => x.n === cursor.n) : null;
    if (!pj || !ln) return 1;
    let o = 0;
    for (const c of pj.cuts) { if (c.num === ln.groupNum) return o + (ln.sentIdx || 0) + 1; o += (c.sentences || []).length; }
    return 1;
  }
  function curProject() { return dto && dto.projects && (dto.projects.find((x) => cursor && x.shortsNum === cursor.shortsNum) || dto.projects[0]); }
  async function insertMedia(kind, ev) {
    const pj = curProject(); if (!pj) return;
    const rect = ev && ev.currentTarget ? ev.currentTarget.getBoundingClientRect() : null;
    const r = await overlayOp({ shortsNum: pj.shortsNum, op: 'add', kind });   // 기본 = 전체 클립
    if (r && r.ok && r.id) {
      setStatus(`➕ ${({ image: '그림', video: '영상', audio: '오디오' })[kind]}을 전체 클립에 넣었습니다 — 적용 범위를 고르세요${kind === 'audio' ? '' : ' · ① 칸에서 끌어 옮기고 모서리로 크기'} (Ctrl+Z 되돌리기)`);
      setInsMenu({ sn: pj.shortsNum, id: r.id, x: rect ? rect.left : 200, y: rect ? rect.bottom + 4 : 120 });
    }
  }
  async function insRange(sn, id, from, to, ask) {
    if (ask) {
      const n = ask.n;
      const v = await askName(`적용 범위 — 클립(문장) 번호 (1~${n}, 예: 5-20)`, ask.cur);
      if (v == null) return;
      const mm = String(v).match(/(\d+)\s*[-~–]\s*(\d+)/) || String(v).match(/^\s*(\d+)\s*$/);
      if (!mm) { setStatus('범위는 「5-20」처럼 적습니다'); return; }
      from = Number(mm[1]); to = Number(mm[2] || mm[1]);
    }
    const r = await overlayOp({ shortsNum: sn, op: 'range', id, from, to });
    if (r && r.ok) setStatus(`➕ 적용 범위 → 클립(문장) ${Math.min(from, to)}~${Math.max(from, to)}`);
  }
  // 🎵 오디오 1회 재생까지 — 시작 클립부터 소리 길이만큼 흐른 클립까지 · 반복 안 함(main 이 길이를 재서 정한다)
  async function insOnce(sn, id) {
    const r = await overlayOp({ shortsNum: sn, op: 'once', id });
    if (r && r.ok) {
      const d = r.dur || 0;
      setStatus(`🎵 1회 재생 — ${Math.floor(d / 60)}분 ${Math.round(d % 60)}초 → 클립 ${r.from}~${r.to}${r.short ? ' (편 끝까지 가도 소리가 남습니다)' : ''}${r.est ? ` · 음성 없는 문장 ${r.est}개는 글자수로 어림` : ''} (Ctrl+Z 되돌리기)`);
    }
  }
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

  // ── ✏ 문장 인라인 편집 — 버튼 없이 키보드로 ──────────────────────
  //   문장을 클릭하면 그 자리가 편집칸이 된다. 저장·나누기·합치기 버튼은 없다 — 글쓰기는 도구 조작이 아니라서다.
  //     · Enter              → 커서 자리에서 **나눈다**(마침표를 넣어 두 문장으로)
  //     · 맨 앞에서 Backspace → **윗줄과 합친다**
  //     · 맨 끝에서 Delete    → **아랫줄을 끌어올려 합친다**
  //     · 칸을 벗어나면(blur) 저장 · Esc 취소 · 글을 다 지우면 그 문장을 삭제
  //   ⚠ 편집칸은 **비제어(ref)** 다 — 제어 state 로 두면 글자마다 컷 카드 수십 개가 다시 그려져
  //     타이핑이 멈춘다(2026-08-14 사고, 위 대본수정 textarea 와 같은 이유).
  // ── 🎨 자막 서식 — 목록에서 고른 줄·글자에 서식을 얹는다(2026-09-25) ──────────────
  //   저장 단위는 **문장 글자 위치**(core/caption-format) — 자막 줄은 글자수 설정에 따라 다시 계산되므로 줄 번호로 저장하지 않는다.
  const capBase = { ...capLook, size: Number(capSize) || 100 };
  function capSentence(shortsNum, groupNum, sentIdx) {
    const pr = dto && dto.projects ? dto.projects.find((p) => p.shortsNum === shortsNum) : null;
    const c = pr ? pr.cuts.find((x) => x.num === groupNum) : null;
    return c && c.sentences ? c.sentences[sentIdx] : null;
  }
  // 지금 서식 = 채널 기본 + 첫 고른 글자의 덮어쓰기(툴바·패널이 보여 줄 값)
  function capSelFmt() {
    if (!capSel || !capSel.items.length) return CF.normFmt(capBase);
    const it = capSel.items[0];
    const s = capSentence(capSel.shortsNum, it.groupNum, it.sentIdx);
    const base = CF.normFmt(capBase); base.size = capBase.size;
    if (!s) return base;
    return { ...base, ...CF.fmtAt(CF.cleanSpans(s.spans, String(s.text || '').length), it.from) };
  }
  // 📐 채널 위치(헤더 상태) — 줄별 위치 덮어쓰기의 바탕
  function capChanPos() {
    return { align: capAlign === 'random' ? 'center' : capAlign, yAlign: capYAlign, yOffset: (parseFloat(capPos) || 0) + (parseFloat(capFine) || 0) * 0.0025, xOffset: Number(capXOff) || 0 };
  }
  // 📐 지금 위치 = 채널 위치 + 첫 고른 줄의 덮어쓰기(core/caption-format linePos — .vrew·MP4 와 같은 규칙)
  function capSelPos() {
    const chan = capChanPos();
    if (!capSel || !capSel.items.length) return chan;
    const it = capSel.items[0];
    const s = capSentence(capSel.shortsNum, it.groupNum, it.sentIdx);
    if (!s || !s.spans) return chan;
    return CF.linePos(chan, CF.lineProps(s.spans, { from: it.from, to: it.to }, {}, String(s.text || '').length));
  }
  function capSelLabel() {
    if (!capSel) return '';
    if (capSel.mode === 'chars') return `글자 ${capSel.items.reduce((a, it) => a + (it.to - it.from), 0)}자`;
    const ns = capSel.items.map((x) => x.n).sort((a, b) => a - b);
    return ns.length === 1 ? `자막 ${String(ns[0]).padStart(2, '0')}` : `자막 ${ns.length}줄`;
  }
  /** 줄 번호 클릭 — 그 줄만 · Shift = 앞서 고른 줄부터 범위 · Ctrl = 더하기/빼기. allLines = 이 편의 모든 줄(화면 순서). */
  function pickCapLine(shortsNum, info, ev, allLines) {
    if (sentEdit) return;
    setCursor({ shortsNum, n: info.n }); pickMenu('format');   // 🧭 커서 + 서식 메뉴
    setCapSel((cur) => {
      const same = cur && cur.shortsNum === shortsNum && cur.mode === 'lines';
      if (ev && ev.shiftKey && same && cur.anchorN != null) {
        const a = Math.min(cur.anchorN, info.n), b = Math.max(cur.anchorN, info.n);
        return { ...cur, items: allLines.filter((l) => l.n >= a && l.n <= b) };
      }
      if (ev && (ev.ctrlKey || ev.metaKey) && same) {
        const has = cur.items.some((x) => x.n === info.n);
        const items = has ? cur.items.filter((x) => x.n !== info.n) : [...cur.items, info].sort((x, y) => x.n - y.n);
        return items.length ? { ...cur, items, anchorN: info.n } : null;
      }
      if (same && cur.items.length === 1 && cur.items[0].n === info.n) return null;   // 한 번 더 누르면 해제
      return { shortsNum, mode: 'lines', items: [info], anchorN: info.n };
    });
  }
  /** 글자 드래그 — 한 문장 안의 글자 범위. */
  function pickCapChars(shortsNum, groupNum, sentIdx, range) {
    if (sentEdit) return;
    { const PL = linesMap.get(shortsNum); const l = PL && (PL.bySent.get(groupNum + ':' + sentIdx) || []).find((x) => range.from >= x.from && range.from < x.to);
      if (l) setCursor({ shortsNum, n: l.n }); pickMenu('format'); }
    setCapSel({ shortsNum, mode: 'chars', items: [{ groupNum, sentIdx, from: range.from, to: range.to, n: -1 }] });
  }
  async function applyCapFmt(patch) {
    if (!capSel) return;
    // 📐 세로 정렬만 바꿨으면 그 정렬의 세로 위치도 함께 정한다(채널이 같은 정렬이면 채널 위치 · 아니면 기본값) — 옛 세로 위치가 남아 엉뚱한 곳에 서지 않게
    if (patch && patch.posV && !('posY' in patch)) {
      const chan = capChanPos();
      patch = { ...patch, posY: chan.yAlign === patch.posV ? chan.yOffset : CF.POS_Y_DEFAULT[patch.posV] };
    }
    try {
      const r = await api.setCaptionFormat({ targets: capSel.items.map((x) => ({ shortsNum: capSel.shortsNum, groupNum: x.groupNum, sentIdx: x.sentIdx, from: x.from, to: x.to })), patch });
      if (r && r.ok) { if (r.dto) setDto(r.dto); }
      else setStatus('⚠ ' + ((r && r.error) || '서식을 바꾸지 못했습니다'));
    } catch (e) { logline('자막 서식 오류: ' + e.message); }
  }
  // ⤢ 고른 줄(첫 글자)의 덮어쓴 서식을 대본 전체 자막에
  async function applyCapFmtAll() {
    if (!capSel || !capSel.items.length) return;
    const it = capSel.items[0];
    const s = capSentence(capSel.shortsNum, it.groupNum, it.sentIdx);
    const patch = s ? CF.fmtAt(CF.cleanSpans(s.spans, String(s.text || '').length), it.from) : {};
    if (!patch || !Object.keys(patch).length) { setStatus('⚠ 고른 줄에 따로 준 서식이 없습니다 — 먼저 이 줄을 꾸민 뒤 누르세요'); return; }
    if (!uiConfirm(`${capSelLabel()} 의 서식을 이 대본의 모든 자막에 적용합니다.\n다른 줄에 따로 준 서식은 이 서식으로 바뀝니다(Ctrl+Z 로 되돌릴 수 있습니다).\n\n계속할까요?`)) return;
    try {
      const r = await api.applyCaptionFormatAll({ patch });
      if (r && r.ok) { if (r.dto) setDto(r.dto); setStatus(`⤢ 자막 ${r.count}문장에 적용했습니다 (Ctrl+Z 되돌리기)`); }
      else setStatus('⚠ ' + ((r && r.error) || '적용하지 못했습니다'));
    } catch (e) { logline('자막 서식 오류: ' + e.message); }
  }
  // ↶ 되돌리기 / ↷ 다시 하기 — main 이 바꾸기 직전 상태를 기억한다(문장·서식·그림 범위·그룹 합치기/분할)
  async function runUndo(redo) {
    if (sentEdit) return;   // 고치는 중엔 편집칸 자체의 되돌리기
    try {
      const r = await api.undo({ redo: !!redo });
      if (r && r.ok) { if (r.dto) setDto(r.dto); setCapSel(null); setCapPanel(null); setStatus((redo ? '↷ 다시 하기 — ' : '↶ 되돌리기 — ') + r.label); }
      else setStatus((r && r.error) || '되돌릴 것이 없습니다');
    } catch (e) { logline('되돌리기 오류: ' + e.message); }
  }
  useEffect(() => {
    const onKey = (ev) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
      // 🔑 글자가 아니라 **키 자리**(ev.code)로 본다 — 한글 입력 상태에선 ev.key 가 'ㅋ'·'ㅛ' 가 되어 Ctrl+Z 가 안 먹는다
      const k = ev.code === 'KeyZ' ? 'z' : ev.code === 'KeyY' ? 'y' : String(ev.key || '').toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      const t = ev.target;
      // 글자칸·대본 보기 편집면 안에서는 그 칸의 되돌리기(타이핑 취소)를 쓴다
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (isBk || isRx) return;
      ev.preventDefault();
      runUndo(k === 'y' || (k === 'z' && ev.shiftKey));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // 🧩 그룹 경계를 넘는 합치기 — 그룹 마지막 문장 끝 Del / 첫 문장 맨 앞 Backspace
  async function mergeAcross(dir, text) {
    const e = sentEdit; if (!e || sentBusy) return;
    const pr = dto && dto.projects ? dto.projects.find((p) => p.shortsNum === e.shortsNum) : null;
    const gi = pr ? pr.cuts.findIndex((c) => c.num === e.groupNum) : -1;
    const other = pr ? pr.cuts[dir === 'prev' ? gi - 1 : gi + 1] : null;
    if (!other) { setStatus(dir === 'prev' ? '맨 앞 클립입니다' : '맨 끝 클립입니다'); return; }
    const gone = dir === 'prev' ? pr.cuts[gi] : other;   // 문장이 하나뿐이면 사라지는 그룹
    if ((gone.sentences || []).length === 1 && (gone.imagePath || gone.videoPath)
      && !uiConfirm(`G${gone.num} 은 이 문장 하나뿐이라 합치면 그룹이 사라집니다.\nG${gone.num} 의 그림·영상은 쓰지 않게 됩니다(Ctrl+Z 로 되돌릴 수 있습니다).\n\n계속할까요?`)) return;
    sentDoneRef.current = true; setSentBusy(true);
    try {
      const r = await api.mergeSentenceAcross({ shortsNum: e.shortsNum, groupNum: e.groupNum, dir, text });
      if (r && r.ok) { setDto(r.dto); closeSentEdit(e); setStatus('🧩 클립을 합쳤습니다 — 음성은 🎤 로 다시 만드세요 (Ctrl+Z 되돌리기)'); }
      else { sentDoneRef.current = false; setStatus('⚠ ' + ((r && r.error) || '합치지 못했습니다')); }
    } catch (err) { sentDoneRef.current = false; logline('클립 합치기 오류: ' + err.message); }
    finally { setSentBusy(false); }
  }
  async function clearCapFmt(keys) {
    if (!capSel) return;
    try {
      const r = await api.setCaptionFormat({ targets: capSel.items.map((x) => ({ shortsNum: capSel.shortsNum, groupNum: x.groupNum, sentIdx: x.sentIdx, from: x.from, to: x.to })), clear: keys || true });
      if (r && r.ok && r.dto) setDto(r.dto);
    } catch (e) { logline('자막 서식 오류: ' + e.message); }
  }

  /** 💾 자막 서식 저장 — 툴바의 지금 서식·위치를 **채널 기본값**(capLong)으로. 📝 자막 탭과 같은 값이라 채널 편집을 다시 열면 그대로 보인다.
   *  ⚠ capLong 은 통째로 바뀌므로 옛 값 위에 얹는다(빠진 키가 사라지지 않게 — v0.3.8 계열). */
  async function saveCapDefault() {
    if (!presetName) { setStatus('⚠ 채널을 먼저 고르세요'); return; }
    const f = capSelFmt(), p = capSelPos();
    try {
      const det = await api.getPresetDetail(presetName);
      const old = (det && det.capLong) || {};
      const capLong = { ...old, size: String(f.size || capSize), align: p.align, yAlign: p.yAlign, yOffset: +(+p.yOffset).toFixed(4), xOffset: +(+p.xOffset || 0).toFixed(4), ...capLookOf(f) };
      await api.savePreset({ name: presetName, patch: { capLong } });
      setCapSize(String(capLong.size)); setCapAlign(capLong.align); setCapYAlign(capLong.yAlign); applyCaptionYOffset(capLong.yOffset);
      setCapXOff(capLong.xOffset); setCapLook(capLookOf(capLong));
      setPresetRev((n) => n + 1);
      setStatus(`💾 자막 서식을 채널 「${presetName}」 기본값으로 저장했습니다 — 앞으로 모든 자막에 적용됩니다`);
      logline(`💾 자막 서식 저장 → 채널 「${presetName}」 (크기 ${capLong.size} · 정렬 ${capLong.align} · 세로 ${capLong.yAlign} ${capLong.yOffset})`);
    } catch (e) { setStatus('⚠ 자막 서식 저장 실패: ' + e.message); }
  }

  /**
   * @param line   🧩 줄 단위 편집(상세 클립 · ① 칸 팝업) — { n, from, to }. 편집칸엔 그 줄 글자만 보이고, 저장할 땐 문장 앞뒤를 이어 붙인다.
   * @param where  'stage' = ① 칸 팝업에서 고친다(② 목록은 평소 모양 그대로 · 서식 선택은 유지)
   */
  function startSentEdit(shortsNum, groupNum, sentIdx, text, count = 1, line = null, where = null) {
    if (where !== 'stage') { setCapSel(null); setCapPanel(null); }   // 🎨 글을 고치는 동안은 서식 선택을 푼다(글자 위치가 바뀐다) — 팝업은 서식을 함께 고치므로 둔다
    sentDoneRef.current = false;
    setSentEdit({ shortsNum, groupNum, sentIdx, count, text, line: line || null, where: where || null });
  }
  function cancelSentEdit() { sentDoneRef.current = true; setSentEdit(null); }
  /** 편집칸의 현재 글 (비제어라 ref 에서 읽는다) */
  function sentEditValue(fallback) {
    const el = sentEditRef.current;
    if (!(el && el.value != null)) return String(fallback == null ? '' : fallback);
    const e = sentEdit;
    if (e && e.line) { const t = String(e.text || ''); return t.slice(0, e.line.from) + el.value + t.slice(e.line.to); }   // 🧩 줄만 고쳤다 → 문장으로
    return el.value;
  }
  // Enter — 커서 자리에서 나누기. 파서는 종결부호로 문장을 가르므로 그 자리에 마침표를 넣고 바로 저장한다.
  function splitSentAtCursor() {
    const el = sentEditRef.current; if (!el) return;
    let p = (el.selectionStart != null) ? el.selectionStart : el.value.length;
    if (sentEdit && sentEdit.line) p += sentEdit.line.from;   // 🧩 줄 안 커서 → 문장 안 위치
    const full = sentEditValue('');
    const a = full.slice(0, p).trim(), b = full.slice(p).trim();
    if (!a || !b) { setStatus('커서를 문장 가운데 두고 Enter 를 누르세요'); return; }
    commitSentEdit(a.replace(/[.!?。]+$/, '') + '. ' + b);
  }
  // Backspace(맨 앞) — 윗문장과 합치기. 두 문장 범위(sentIdx-1, 2개)를 한 문장으로 치환한다.
  function mergeSentUp(sentIdx, prevText) {
    const merged = String(prevText || '').replace(/[.!?。]+\s*$/, '') + ' ' + sentEditValue('').trim();
    commitSentEdit(merged, { sentIdx: sentIdx - 1, count: 2 });
  }
  // Delete(맨 끝) — 아랫문장을 끌어올려 합치기.
  function mergeSentNext(sentIdx, nextText) {
    const merged = sentEditValue('').replace(/[.!?。]+\s*$/, '').trim() + ' ' + String(nextText || '').trim();
    commitSentEdit(merged, { sentIdx, count: 2 });
  }
  /**
   * 편집 한 건을 보낸다.
   * @param override  보낼 글(생략하면 편집칸 값). '' 이면 삭제.
   * @param range     다른 범위를 치환할 때(합치기) { sentIdx, count }
   */
  async function commitSentEdit(override, range) {
    const e = sentEdit; if (!e || sentBusy || sentDoneRef.current) return;
    const text = (override != null) ? override : sentEditValue(e.text);
    // 글자를 하나도 안 고쳤으면 서버에 보낼 것이 없다(칸을 벗어나기만 한 흔한 경우).
    if (override == null && !range && String(text).trim() === String(e.text).trim()) { closeSentEdit(e); return; }
    if (!String(text).trim() && !uiConfirm('이 문장을 대본에서 지울까요?\n(음성 파일은 남지만 이 문장은 영상에서 빠집니다)')) return;
    sentDoneRef.current = true;
    setSentBusy(true);
    try {
      const r = await api.editSentences({
        shortsNum: e.shortsNum, groupNum: e.groupNum,
        sentIdx: range ? range.sentIdx : e.sentIdx,
        count: range ? range.count : e.count,
        text,
      });
      if (!r || !r.ok) {
        // 🔑 여기가 「✏ 대본 수정」의 탈출구다 — 지침 줄을 사이에 둔 문장·표처럼 화면에서 못 고치는 경우.
        const msg = (r && r.error) || '문장을 고치지 못했습니다.';
        logline('✏ ' + msg.replace(/\n/g, ' '));
        if (uiConfirm(msg + '\n\n대본(.md) 편집창을 열까요?')) openScriptEdit();
        return;
      }
      setDto(r.dto); closeSentEdit(e);
    } catch (err) { logline('문장 수정 오류: ' + err.message); }
    finally { setSentBusy(false); }
  }
  // 🧩 ↑↓ 로 클립 이동 — 고치는 채로 다음 클립을 연다(Vrew 처럼). 저장이 끝난 뒤(대본이 바뀌었으면 새 줄 번호로) 연다.
  const pendingEditRef = useRef(null);
  function openLineEdit(sn, n, where) {
    const PL = linesMap.get(sn); const l = PL && PL.list.find((x) => x.n === n);
    const pr = dto && dto.projects ? dto.projects.find((p) => p.shortsNum === sn) : null;
    if (!l || !pr) return false;
    const cut = pr.cuts[l.ci]; const sen = cut && cut.sentences ? cut.sentences[l.sentIdx] : null;
    if (!sen) return false;
    setCursor({ shortsNum: sn, n });
    if (where === 'stage') setCapSel({ shortsNum: sn, mode: 'lines', items: [{ n, groupNum: cut.num, sentIdx: l.sentIdx, from: l.from, to: l.to }], anchorN: n });
    startSentEdit(sn, cut.num, l.sentIdx, sen.text, 1, { n, from: l.from, to: l.to }, where);
    setTimeout(() => { const e = document.querySelector('.sent[data-ln="' + n + '"]'); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'nearest' }); }, 0);
    return true;
  }
  async function navEdit(delta) {
    const e = sentEdit; if (!e || !e.line) return;
    const PL = linesMap.get(e.shortsNum); if (!PL) return;
    const n = e.line.n + delta;
    if (n < 1 || n > PL.list.length) return;
    pendingEditRef.current = { sn: e.shortsNum, n, where: e.where };
    await commitSentEdit();
  }
  useEffect(() => {
    if (sentEdit || !pendingEditRef.current) return;
    const p = pendingEditRef.current; pendingEditRef.current = null;
    openLineEdit(p.sn, p.n, p.where);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentEdit, linesMap]);
  // 개요 보기의 문장 편집칸 — 맨 앞 ↑ / 맨 끝 ↓ = 저장하고 윗/아랫 클립으로 커서만 옮긴다
  function navOutOfSentence(delta) {
    const e = sentEdit; if (!e) return;
    const PL = linesMap.get(e.shortsNum); const sl = PL && PL.bySent.get(e.groupNum + ':' + e.sentIdx);
    if (!sl || !sl.length) return;
    const n = delta < 0 ? sl[0].n - 1 : sl[sl.length - 1].n + 1;
    if (n >= 1 && n <= PL.list.length) setCursor({ shortsNum: e.shortsNum, n });
    commitSentEdit();
  }
  /** 🧩 줄 편집칸 키 — Enter 나누기 · ↑↓ 클립 이동 · 맨 앞 Backspace / 맨 끝 Del = 문장 합치기(문장 첫·끝 줄일 때) · Esc 취소 */
  function lineEditKey(ev, ctx) {
    const el = ev.currentTarget; const e = sentEdit; if (!e || !e.line) return;
    const caret = el.selectionStart, sel = el.selectionEnd;
    const PL = linesMap.get(e.shortsNum); const sl = (PL && PL.bySent.get(e.groupNum + ':' + e.sentIdx)) || [];
    const firstLine = !sl.length || sl[0].n === e.line.n, lastLine = !sl.length || sl[sl.length - 1].n === e.line.n;
    const oneRow = el.scrollHeight <= (parseFloat(getComputedStyle(el).lineHeight) || 20) * 1.6;
    let { si, sents, s } = ctx || {};
    if (!sents) {   // ① 칸 팝업은 문맥을 안 넘긴다 — 지금 편집 중인 문장에서 찾는다
      const pr = dto && dto.projects ? dto.projects.find((p) => p.shortsNum === e.shortsNum) : null;
      const cut = pr ? pr.cuts.find((c) => c.num === e.groupNum) : null;
      if (cut) { sents = cut.sentences || []; si = e.sentIdx; s = sents[si]; }
    }
    // ✂ 줄(클립) 단위: Enter = 이 줄을 커서 자리에서 둘로(음성 그대로) · Ctrl+Enter = 문장 나누기(마침표 — 예전 Enter)
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); splitSentAtCursor(); }
    else if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      if (e.where === 'stage') commitSentEdit();
      else if (caret > 0 && caret < el.value.length && caret === sel) lineBreakOp('split', caret);
      else commitSentEdit();
    }
    else if (ev.key === 'Escape') { ev.preventDefault(); cancelSentEdit(); }
    else if (ev.key === 'ArrowUp' && (oneRow || (caret === 0 && sel === 0))) { ev.preventDefault(); navEdit(-1); }
    else if (ev.key === 'ArrowDown' && (oneRow || (caret === el.value.length && sel === el.value.length))) { ev.preventDefault(); navEdit(1); }
    else if (ev.key === 'Backspace' && caret === 0 && sel === 0) {
      ev.preventDefault();
      if (!firstLine) { lineBreakOp('mergeUp'); return; }
      if (!sents) return;
      if (si === 0) mergeAcross('prev', String(prevCutLastText(e) || '').replace(/[.!?。]+\s*$/, '') + ' ' + sentEditValue('').trim());
      else if (s && s.mark) setStatus('합친 그룹 안의 섹션 경계입니다 — 여기서는 합칠 수 없습니다');
      else if ((s.speaker || null) !== (sents[si - 1].speaker || null)) setStatus('화자가 다른 문장입니다 — 합칠 수 없습니다');
      else mergeSentUp(si, sents[si - 1].text);
    } else if (ev.key === 'Delete' && caret === el.value.length && sel === el.value.length) {
      ev.preventDefault();
      if (!lastLine) { lineBreakOp('mergeDown'); return; }
      if (!sents) return;
      if (si >= sents.length - 1) mergeAcross('next', sentEditValue('').replace(/[.!?。]+\s*$/, '').trim() + ' ' + String(nextCutFirstText(e) || '').trim());
      else if (sents[si + 1].mark) setStatus('합친 그룹 안의 섹션 경계입니다 — 여기서는 합칠 수 없습니다');
      else if ((s.speaker || null) !== (sents[si + 1].speaker || null)) setStatus('화자가 다른 문장입니다 — 합칠 수 없습니다');
      else mergeSentNext(si, sents[si + 1].text);
    }
  }
  /**
   * ✂ 자막 줄 나누기·합치기 — 한 문장 안에서. 지금 보이는 줄 시작 위치들을 사람이 정한 줄 나눔으로 굳힌 뒤 하나를 더하거나 뺀다.
   *   편집칸에서 글자도 고쳤으면 그 글(문장 전체)을 함께 보낸다 — 뒤쪽 줄 위치는 글 길이 차이만큼 민다.
   */
  async function lineBreakOp(kind, caret) {
    const e = sentEdit; if (!e || !e.line || sentBusy) return;
    const PL = linesMap.get(e.shortsNum); const sl = (PL && PL.bySent.get(e.groupNum + ':' + e.sentIdx)) || [];
    if (!sl.length) return;
    const full = sentEditValue('');
    const d = full.length - String(e.text || '').length;
    const starts = sl.slice(1).map((l) => (l.range.from > e.line.from ? l.range.from + d : l.range.from));
    const me = sl.findIndex((l) => l.n === e.line.n);
    let breaks = starts, focusN = e.line.n;
    if (kind === 'split') { breaks = [...starts, e.line.from + caret].sort((a, b) => a - b); focusN = e.line.n + 1; }
    else if (kind === 'mergeUp') { if (me <= 0) return; breaks = starts.filter((_, i) => i !== me - 1); focusN = e.line.n - 1; }
    else if (kind === 'mergeDown') { if (me < 0 || me >= sl.length - 1) return; breaks = starts.filter((_, i) => i !== me); }
    sentDoneRef.current = true; setSentBusy(true);
    try {
      const r = await api.setCaptionBreaks({ shortsNum: e.shortsNum, groupNum: e.groupNum, sentIdx: e.sentIdx, text: full, breaks });
      if (r && r.ok) {
        setDto(r.dto); closeSentEdit(e); setCursor({ shortsNum: e.shortsNum, n: focusN });
        setStatus(r.note || (kind === 'split' ? '✂ 자막 줄을 나눴습니다 — 음성은 그대로 (Ctrl+Z 되돌리기)' : '✂ 자막 줄을 합쳤습니다 — 음성은 그대로 (Ctrl+Z 되돌리기)'));
      } else { sentDoneRef.current = false; setStatus('⚠ ' + ((r && r.error) || '줄을 바꾸지 못했습니다')); }
    } catch (err) { sentDoneRef.current = false; logline('자막 줄 오류: ' + err.message); }
    finally { setSentBusy(false); }
  }
  function prevCutLastText(e) {
    const pr = dto && dto.projects ? dto.projects.find((p) => p.shortsNum === e.shortsNum) : null;
    const gi = pr ? pr.cuts.findIndex((c) => c.num === e.groupNum) : -1;
    const c = pr && gi > 0 ? pr.cuts[gi - 1] : null; const ss = c ? c.sentences || [] : [];
    return ss.length ? ss[ss.length - 1].text : '';
  }
  function nextCutFirstText(e) {
    const pr = dto && dto.projects ? dto.projects.find((p) => p.shortsNum === e.shortsNum) : null;
    const gi = pr ? pr.cuts.findIndex((c) => c.num === e.groupNum) : -1;
    const c = pr && gi >= 0 ? pr.cuts[gi + 1] : null; const ss = c ? c.sentences || [] : [];
    return ss.length ? ss[0].text : '';
  }
  /** 「가」 — 이 클립 하나를 고르고 ⚙ 고급(③ 칸)을 연다 */
  function fmtClip(sn, info) {
    setCursor({ shortsNum: sn, n: info.n });
    setCapSel({ shortsNum: sn, mode: 'lines', items: [info], anchorN: info.n });
    pickMenu('format'); setCapPanel('fmt');
  }
  /** Ctrl+A — 이 편의 모든 클립 선택 */
  function selectAllClips() {
    const sn = (cursor && cursor.shortsNum) || (dto && dto.projects && dto.projects[0] && dto.projects[0].shortsNum);
    const PL = sn != null ? linesMap.get(sn) : null; if (!PL || !PL.list.length) return;
    setCapSel({ shortsNum: sn, mode: 'lines', items: PL.list.map((x) => ({ n: x.n, groupNum: x.groupNum, sentIdx: x.sentIdx, from: x.from, to: x.to })), anchorN: PL.list[0].n });
    pickMenu('format');
    setStatus(`클립 ${PL.list.length}개를 모두 골랐습니다 — 서식을 바꾸면 전부에 적용됩니다 (Esc 해제)`);
  }
  /** ① 칸 자막을 누르면 — 그 자리에서 글자·서식을 고치는 팝업(Vrew). */
  const [stageEditBox, setStageEditBox] = useState(null);   // { left, top, width, height } — 열 때 잰 자막 자리(스테이지 기준 px)
  function openStageEdit() {
    if (playerOpen || sentEdit) return;
    const cap = stageCapRef.current, st = cap && cap.parentElement; if (!cap || !st) return;
    const ln = cap.querySelector('.cf-stageline') || cap;
    const r = ln.getBoundingClientRect(), sr = st.getBoundingClientRect();
    setStageEditBox({ left: r.left - sr.left, top: r.top - sr.top, width: r.width, height: r.height, stageW: sr.width, stageH: sr.height });
    if (cursor) openLineEdit(cursor.shortsNum, cursor.n, 'stage');
  }
  // 팝업 밖을 누르면 저장하고 닫는다(글자칸 blur 로 저장하지 않는다 — 막대의 색·글꼴 칸을 누를 때마다 닫히면 안 된다)
  useEffect(() => {
    if (!(sentEdit && sentEdit.where === 'stage')) return undefined;
    const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.stage-edit'))) commitSentEdit(); };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  });
  // ⚠ 그사이 사용자가 **다른 문장을 클릭해 열었으면** 그건 닫지 않는다(blur 저장과 클릭이 연달아 일어난다).
  function closeSentEdit(e) { setSentEdit((cur) => (cur === e ? null : cur)); }
  async function applyScriptEdit() {
    setStatus('대본 수정 적용 중…');
    const text = (scriptEditRef.current && scriptEditRef.current.value != null) ? scriptEditRef.current.value : scriptText;
    try { const d = await api.applyScriptText({ text }); if (d) { setDto(d); setFtitle(d.fileTitle || ftitle); } setScriptEditOpen(false); setStatus('대본 수정 적용 완료'); }
    catch (e) { logline('대본 수정 오류: ' + e.message); setStatus('오류'); }
  }
  function abort() { queueAbortRef.current = true; api.abort(); setStatus('중단 요청됨'); }

  // ── 채널 설정 편집 ──
  // Electron 렌더러는 window.prompt 를 지원하지 않으므로(조용히 null) 이름 입력은 별도 모달로 받는다.
  // 🔑 **만드는 기준은 「지금 편집창에서 보고 있는 채널」**이다(헤더 선택이 아니라) — 창 안에서 보고 있는
  //   설정을 복사하는 것이 눈에 보이는 대로의 동작이다. 이름을 고치는 중일 수 있으므로 **원본 이름**(_raw)을 쓴다.
  async function createChannel() {
    const name = (newChanName || '').trim();
    if (!name) { setStatus('채널 이름을 입력하세요'); return; }
    const from = (ch && ch._raw && ch._raw.name) || presetName || null;
    try {
      const ps = await api.addPreset({ name, fromName: from });
      setPresets(ps || []); setPresetName(name); setNewChanName('');
      setStatus(`채널 "${name}" 추가됨 — 세부 설정을 편집하세요`);
      await openChannelEditor(name);   // 만든 채널을 바로 편집 대상으로
      setChTab('basic');
    } catch (e) { uiAlert('채널 추가 실패:\n' + e.message); }
  }
  async function deleteChannel() {
    if (!ch || !ch.name) return;
    if (!uiConfirm(`채널 "${ch.name}" 을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      const ps = await api.removePreset({ name: ch.name });
      setChOpen(false); setPresets(ps || []);
      if (ps && ps.length) setPresetName(firstChannelName(ps));
      setStatus(`채널 "${ch.name}" 삭제됨`);
    } catch (e) { uiAlert('채널 삭제 실패:\n' + e.message); }
  }
  // ── 채널 순서 ── 드롭다운에 보이는 순서. **▲▼ 를 누르면 그 자리에서 저장**한다.
  //   🔑 따로 「저장」을 두면 누르지 않고 창을 닫아 순서가 조용히 사라진다 — 이 저장소가 반복해 겪은 유형이라
  //     아예 버퍼를 두지 않았다. reorderPresets 는 작은 파일 쓰기라 즉시 저장이 싸다.
  async function moveChannel(i, dir) {
    const cur = (presets || []).map((p) => p.name);
    const j = i + dir;
    if (j < 0 || j >= cur.length) return;
    const next = cur.slice();
    [next[i], next[j]] = [next[j], next[i]];
    try {
      const ps = await api.reorderPresets(next);
      if (ps) setPresets(ps);
      setStatus('채널 순서 저장됨');
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
        xFine: Math.round((saved && Number(saved.xOffset) || 0) / 0.0025),   // 📐 가로 미세 — ⚠ 안 실으면 저장할 때 0 으로 덮인다
        ...capLookOf(saved),   // 🎨 모양 — ⚠ 안 실으면 저장할 때 기본값으로 덮인다
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
      downloadFolder: p.downloadFolder || '', // 🔗 URL 로 받은 영상·음성·전사본을 떨어뜨릴 폴더

      aiNotice: !!(p.aiNotice && p.aiNotice.enabled),
      presetPrompt: p.presetPrompt || '', language: p.language || 'ko',
      silenceSec: p.silenceSec != null ? p.silenceSec : 0,
      // 🎭 화자별 목소리 [{name, voice}] — ⚠ 안 실으면 저장할 때 빈 값으로 덮인다(v0.3.8 계열)
      speakers: Array.isArray(p.speakers) ? p.speakers.map((r) => ({ name: r.name || '', voice: r.voice || '' }))
        : (p.speakers && typeof p.speakers === 'object' ? Object.keys(p.speakers).map((k) => ({ name: k, voice: p.speakers[k] })) : []),
      cfgValue: p.cfgValue != null ? p.cfgValue : 2,
      capLong: mkCap(p.capLong, lf),
      speedLong: p.speedLong != null ? p.speedLong : (lf.defaultTtsSpeed != null ? lf.defaultTtsSpeed : 1.15),
      ttsNormalize: p.ttsNormalize !== false,
      // 🎵 배경음악 — ⚠ 안 실으면 저장할 때 빈 값으로 덮인다
      bgmOn: !!p.bgmOn, bgmPath: p.bgmPath || '', bgmVolume: p.bgmVolume != null ? p.bgmVolume : 15,
      logoOn: !!p.logoOn, logoPath: p.logoPath || '', logoSize: p.logoSize != null ? p.logoSize : 12,   // 🏷 채널 로고
      ttsTargetDb: p.ttsTargetDb != null ? p.ttsTargetDb : -15,
      styleLong: p.styleLong || p.styleId || 'chibi',
      styleThumb: p.styleThumb || '',   // 🖼 썸네일용 화풍 — 비우면 롱폼 것을 쓴다(대시보드가 그렇게 읽는다)
      imgEngine: p.imgEngine || 'genspark', videoEngine: p.videoEngine || 'grok', // 이미지·비디오 제작 도구 기본값(채널 단위)
      outTarget: normOutTargetUi(p.outTarget), // ✏ 완성물 종류(채널 기본값)
      outLong: p.outLong || p.outputFolder || '',
      // ✏ 화이트보드 완성물이 떨어질 폴더 — 비어 있으면 main 이 윈도우 다운로드 폴더를 채워 보낸다.
      outWhiteboard: p.outWhiteboard || '',
      outUpload: p.outUpload || '',
      outReader: p.outReader || '',   // 📄 대본 보기 → 🖨 A4 PDF 가 떨어질 폴더(비어 있으면 main 이 다운로드 폴더를 채워 보낸다)
      // ⬆ 유튜브 자동 업로드 — ⚠ 안 실으면 저장할 때 빈 값으로 덮인다(v0.3.8 계열)
      ytAuto: !!p.ytAuto, ytChannelId: p.ytChannelId || '',
      // 💬 화이트보드 자막 모양(글자·위치·폰트) — 저장된 값이 없으면 기본값으로 시작한다.
      wbSub: { ...WB_SUB_DEFAULT, ...(p.wbSub || {}) },
      split: { intro: sl.introSentenceSize || 3, main: sl.mainSentenceSize || 10, short: sl.shortLen || 10, long: sl.longLen || 20, mode: sl.splitMode === 'sentence' ? 'sentence' : (sl.splitMode === 'h2' ? 'h2' : 'h3') },
      _raw: p,
    });
    setChTab('basic'); // 열 때마다 첫 탭부터
    api.ytStatus().then((st) => { if (st) setYtSt(st); }).catch(() => {});
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
    if (prevKey === 'ref:' + p) { stopPreviewAudio(); return; }   // ■ — 다시 누르면 멈춤
    try { const url = await api.readAudio(p); playPreviewUrl(url, 'ref:' + p); }
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
  const [vdSelPlaying, setVdSelPlaying] = useState(false);
  function vdPlaySel() {
    const a = vdAudioRef.current; if (!a) return;
    if (vdSelPlaying) { a.pause(); setVdSelPlaying(false); return; }   // ■ — 다시 누르면 멈춤
    a.currentTime = vdSel.s; a.play(); setVdSelPlaying(true);
    const stop = () => { if (a.currentTime >= vdSel.e || a.paused) { a.pause(); a.removeEventListener('timeupdate', stop); setVdSelPlaying(false); } };
    a.addEventListener('timeupdate', stop);
    a.onpause = () => setVdSelPlaying(false);
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
    const capToStyle = (c) => ({ size: String(c.size), align: c.align, yAlign: c.yAlign, yOffset: yOffsetOf(c), xOffset: (parseFloat(c.xFine) || 0) * 0.0025, ...capLookOf(c) });
    const patch = {
      group: (ch.group || '').trim(),                     // 드롭다운 구분(그룹) — 같은 그룹끼리 묶고 ─── 그룹명 ─── 구분선
      engine: ch.engine || 'omnivoice',
      startMode: ch.startMode || 'longform',              // 이 채널 선택 시 시작할 화면(모드)
      dictPath: (ch.dictPath || '').trim(),               // 🎬 리모션 발음사전(.md) — 비우면 사전 없이 합성
      outImages: (ch.outImages || '').trim(),             // 🖼 리모션 그림 출력 뿌리(TSV 1번 칸이 그 아래 경로)
      imgTsvFolder: (ch.imgTsvFolder || '').trim(),       // 🖼 그림목록 TSV 폴더(같은 번호끼리 자동 연결)
      downloadFolder: (ch.downloadFolder || '').trim(),   // 🔗 URL 다운로드 폴더(비우면 받을 때 물어본다)
      voice: ch.voice || '',                              // 음성 식별자(레거시 값 보존 — 표시용)
      voiceCloneRefAudio: (ch.voiceCloneRefAudio || '').trim(),
      voiceCloneRefText: (ch.voiceCloneRefText || '').trim(),
      scriptFolder: (ch.scriptFolder || '').trim(),       // 대본폴더 공유
      presetPrompt: ch.presetPrompt || '',
      language: ch.language || 'ko',
      silenceSec: numOr(ch.silenceSec, 0),
      bgmOn: !!ch.bgmOn, bgmPath: (ch.bgmPath || '').trim(), bgmVolume: Math.max(0, Math.min(100, numOr(ch.bgmVolume, 15))),   // 🎵 배경음악
      logoOn: !!ch.logoOn, logoPath: (ch.logoPath || '').trim(), logoSize: Math.max(4, Math.min(40, numOr(ch.logoSize, 12))),   // 🏷 채널 로고
      // 🎭 이름이 빈 줄은 버린다(목소리가 빈 줄은 남긴다 — 나중에 고를 수 있게. TTS 는 빈 목소리를 기본 목소리로 읽는다)
      speakers: (ch.speakers || []).map((r) => ({ name: String(r.name || '').replace(/[\[\]]/g, '').trim(), voice: String(r.voice || '').trim() })).filter((r) => r.name),
      cfgValue: numOr(ch.cfgValue, 2),
      // 캡션/배속/스타일/출력 — ⚠ 옛 쇼츠 필드(capShort·speedShort·styleShort·outShort)는 patch 에서 빼기만 한다.
      //   preset-store.update 가 {...old,...patch} 병합이라 기존 저장값은 파일에 무해하게 남는다(마이그레이션 삭제 금지 — v0.3.8 계열).
      capLong: capToStyle(ch.capLong),
      speedLong: numOr(ch.speedLong, 1.15),
      // 🔊 음량 정규화 — ⚠ patch 에 안 실으면 저장할 때 빈 값으로 덮인다(v0.3.8 계열 사고).
      ttsNormalize: ch.ttsNormalize !== false,
      ttsTargetDb: numOr(ch.ttsTargetDb, -15),
      styleLong: ch.styleLong,
      styleThumb: ch.styleThumb || '',
      imgEngine: ch.imgEngine || 'genspark', videoEngine: ch.videoEngine || 'grok', // 이미지·비디오 제작 도구(채널 기본값)
      outTarget: normOutTargetUi(ch.outTarget), // ⚠ patch 에 안 실으면 저장할 때 빈 값으로 덮인다(v0.3.8 계열)
      outLong: (ch.outLong || '').trim(),
      outWhiteboard: (ch.outWhiteboard || '').trim(),    // ✏ 화이트보드 MP4·자막이 떨어질 폴더
      outUpload: (ch.outUpload || '').trim(),            // 🎬 유튜브 업로드용 MP4 가 떨어질 폴더 — ⚠ patch 에 안 실으면 저장 때 빈 값으로 덮인다
      outReader: (ch.outReader || '').trim(),            // 📄 대본 A4 PDF 폴더 — ⚠ 마찬가지(안 실으면 덮인다)
      ytAuto: !!ch.ytAuto && !!ch.ytChannelId, ytChannelId: ch.ytChannelId || '',   // ⬆ 유튜브 자동 업로드(비공개) — ⚠ patch 에 안 실으면 덮인다
      // 💬 화이트보드 자막 모양 — ⚠ patch 에 안 실으면 저장할 때 빈 값으로 덮인다(v0.3.8 계열)
      wbSub: {
        font: (ch.wbSub && ch.wbSub.font) || WB_SUB_DEFAULT.font,
        sizePct: numOr(ch.wbSub && ch.wbSub.sizePct, WB_SUB_DEFAULT.sizePct),
        pos: (ch.wbSub && ch.wbSub.pos) || WB_SUB_DEFAULT.pos,
        marginPct: numOr(ch.wbSub && ch.wbSub.marginPct, WB_SUB_DEFAULT.marginPct),
        bold: !(ch.wbSub && ch.wbSub.bold === false),
      },
      // 분할옵션(롱폼)
      split: { introSentenceSize: numOr(ch.split.intro, 3), mainSentenceSize: numOr(ch.split.main, 10), shortLen: numOr(ch.split.short, 10), longLen: numOr(ch.split.long, 20), splitMode: ch.split.mode === 'h2' ? 'h2' : (ch.split.mode === 'sentence' ? 'sentence' : 'h3') },
      aiNotice: { ...((ch._raw && ch._raw.aiNotice) || {}), enabled: !!ch.aiNotice },
    };
    // 🔑 시드는 **목소리 고정의 핵심**이다 — 비거나 숫자가 아니면 서버가 매번 다른 시드를 써서
    //   같은 채널인데 편마다 톤이 달라진다. 값이 이상하면 **저장하지 않고**(기존 시드 보존) 알린다.
    if (ch.seed !== '' && ch.seed != null) {
      const sd = parseInt(ch.seed, 10);
      if (Number.isFinite(sd)) patch.seed = sd;
      else logline(`⚠ 시드 "${ch.seed}" 를 숫자로 읽을 수 없어 기존 시드를 그대로 둡니다.`);
    }
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
  async function pickDownloadFolder() { const d = await api.pickDir(); if (d) setCh((c) => ({ ...c, downloadFolder: d })); }
  async function pickOutUpload() { const d = await api.pickDir(); if (d) setCh((c) => ({ ...c, outUpload: d })); }
  async function pickOutReader() { const d = await api.pickDir(); if (d) setCh((c) => ({ ...c, outReader: d })); }
  // ⬆ 유튜브 — 연결 파일 가져오기 · 채널 연결/해제 · 지금 대본 올리기
  async function ytLoad() { try { setYtSt(await api.ytStatus()); } catch (_) {} }
  async function ytImport() {
    const r = await api.ytImportClient();
    if (r && r.ok) setSettingsMsg(`✅ 연결 파일을 가져왔습니다 (프로젝트 ${r.projectId || '?'})${r.cleared ? ` — 다른 프로젝트라 기존 채널 연결 ${r.cleared}개를 지웠습니다. 다시 연결하세요.` : ' — 이제 「🔗 채널 연결」을 누르세요.'}`);
    else if (r && !r.cancelled) setSettingsMsg(`❌ ${r.error}`);
    ytLoad();
  }
  async function ytConnect() {
    setSettingsMsg('⏳ 브라우저에서 구글 로그인 → 올릴 채널 선택 → 「확인되지 않은 앱」이면 고급 → Priming(으)로 이동 → 허용을 눌러 주세요 (5분 안에)');
    const r = await api.ytConnect();
    setSettingsMsg(r && r.ok ? `✅ 「${r.channel.title}」 연결됨 — ⚙ 채널편집 → 📁 폴더 → ⬆ 자동 업로드에서 이 채널을 고르세요.` : `❌ ${(r && r.error) || '연결 실패'}`);
    ytLoad();
  }
  async function ytDisconnect(c) {
    if (!uiConfirm(`「${c.title}」 연결을 해제할까요?\n이 PC 에서 이 채널로 자동 업로드가 멈춥니다(다시 연결하면 됩니다).`)) return;
    await api.ytDisconnect(c.id); ytLoad();
  }
  async function runYtUpload() {
    try { const r = await api.ytUploadCurrent({ presetName }); if (r && r.queued) setStatus(`⬆ 유튜브 업로드 ${r.queued}건 시작 (비공개)`); }
    catch (e) { uiAlert(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  }
  async function pickOutWhiteboard() { const d = await api.pickDir(); if (d) setCh((c) => ({ ...c, outWhiteboard: d })); }
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
          <span className="l">정렬</span><select value={c.align} onChange={(e) => set({ align: e.target.value })}><option value="center">가운데</option><option value="start">왼쪽</option><option value="end">오른쪽</option></select>
          <span className="l" title="가로 미세 — 1칸 = 0.0025(화면 폭 절반 기준) · + = 오른쪽">가로</span><input className="n" type="number" value={c.xFine || 0} step="10" onChange={(e) => set({ xFine: e.target.value })} /></div>
        <div className="crow tri"><span className="l">세로</span><select value={c.yAlign} onChange={(e) => set({ yAlign: e.target.value })}><option value="middle">가운데</option><option value="bottom">아래</option><option value="top">위</option></select>
          <span className="l">위치</span><select value={c.pos} onChange={(e) => set({ pos: e.target.value })}><option value="0.3">아래</option><option value="0.15">약간↓</option><option value="0">가운데</option><option value="-0.15">약간↑</option><option value="-0.3">위</option></select>
          <span className="l">미세</span><input className="n" type="number" value={c.fine} step="10" onChange={(e) => set({ fine: e.target.value })} /></div>
        <div className="crow" title="자막 글자색 · 굵게(기본 폰트가 이미 굵은 글꼴이라 더 두꺼워집니다)"><span className="l">글자색</span><input type="color" style={{ flex: '0 0 42px', height: 24, padding: 0 }} value={capLookOf(c).fontColor} onChange={(e) => set({ fontColor: e.target.value })} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={!!c.bold} onChange={(e) => set({ bold: e.target.checked })} /><span className="meta">굵게</span></label></div>
        <div className="crow" title="글자 테두리 — 두께는 px(1080 화면 기준)"><span className="l">테두리</span><label style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={c.outlineOn !== false} onChange={(e) => set({ outlineOn: e.target.checked })} /><span className="meta">켜기</span></label>
          <input type="color" style={{ flex: '0 0 42px', height: 24, padding: 0 }} disabled={c.outlineOn === false} value={capLookOf(c).outlineColor} onChange={(e) => set({ outlineColor: e.target.value })} />
          <span className="l">두께</span><input className="n" type="number" min="0" max="20" disabled={c.outlineOn === false} value={capLookOf(c).outlineWidth} onChange={(e) => set({ outlineWidth: e.target.value })} /></div>
        <div className="crow" title="글자 뒤 배경 상자 — 글자 폭에 맞춰 그려집니다(Vrew 자막 상자와 같은 방식)"><span className="l">배경</span><label style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={!!c.boxOn} onChange={(e) => set({ boxOn: e.target.checked })} /><span className="meta">상자</span></label>
          <input type="color" style={{ flex: '0 0 42px', height: 24, padding: 0 }} disabled={!c.boxOn} value={capLookOf(c).boxColor} onChange={(e) => set({ boxColor: e.target.value })} />
          <span className="l">불투명</span><input className="n" type="number" min="0" max="100" step="10" disabled={!c.boxOn} value={capLookOf(c).boxOpacity} onChange={(e) => set({ boxOpacity: e.target.value })} /><span className="meta">%</span></div>
        {/* 🎨 나머지 서식(글꼴·기울임·밑줄·간격·이중 테두리·형광펜·그림자)과 효과는 창으로 — 탭 높이를 늘리지 않는다(탭마다 창 크기가 튀지 않게) */}
        <div className="crow" title="Vrew 자막 서식 창과 같은 항목 — 이 채널 모든 자막의 기본 서식. 줄마다 따로 바꾸려면 메인 화면에서 자막 줄 번호를 누르세요"><span className="l">서식</span>
          <button className="ghost" data-testid="ch-capfmt" style={{ flex: '1 1 auto' }} onClick={() => setCapDlg({ key, panel: 'fmt' })}>🎨 글꼴·간격·형광펜·그림자…</button>
          <button className="ghost" data-testid="ch-capanim" style={{ flex: '0 0 auto' }} onClick={() => setCapDlg({ key, panel: 'anim' })}>✨ 효과{capLookOf(c).anim ? ': ' + ((CF.ANIM_INFO[capLookOf(c).anim.type] || {}).label || '') : ''}</button></div>
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

  /** 미리보기 자막 위치 — lp(줄 단위 속성)를 주면 그 줄의 위치 덮어쓰기(posH/posV/posX/posY)를 따른다(core/caption-format linePos). */
  /** 미리보기 자막 크기·위치 — **유튜브 MP4 와 같은 공식**(Workspace.stageCapGeom = core/vrew-render captionAssStyle 의 수치).
   *  lp(줄 단위 속성)를 주면 그 줄의 위치 덮어쓰기(posH/posV/posX/posY)를 따른다(core/caption-format linePos). */
  function stageBoxW() { const cs = stageCapRef.current; const st = cs && cs.parentElement; return st ? st.clientWidth : 0; }
  function applyCaptionStyle(lp) {
    const cap0 = capOverride(); const cs = stageCapRef.current; if (!cs) return 0.28;
    const pos = CF.linePos({ align: cap0.align, yAlign: cap0.yAlign, yOffset: cap0.yOffset, xOffset: cap0.xOffset }, lp || null);
    const g = stageCapGeom(pos, parseFloat(cap0.size) || 100, stageBoxW());
    applyStageGeom(cs, g);
    return g.s;
  }
  const visKey = (c) => (c ? [c.num, c.imagePath, c.videoPath, c.imageVersion, c.videoVersion, JSON.stringify(c.look || null)].join('|') : '');
  // 🖼 한 그림(레이어) — 반전은 바깥 칸에(켄번스가 그림 자체의 transform 을 쓰므로) · 채우기 = object-fit · 움직임 = 켄번스 종류
  //   📐 사람이 옮기고 줄인 자리(look.box)가 있으면 그 자리 · 크기로(그림 비율 그대로 — object-fit:fill)
  function layerHtml(c) {
    const lk = VLook.normLook(c.look);
    const flipT = (lk.flipH || lk.flipV) ? ` style="transform:scale(${lk.flipH ? -1 : 1},${lk.flipV ? -1 : 1})"` : '';
    const fit = lk.box ? 'fill' : (lk.fill === 'auto' ? '' : lk.fill);
    const fitS = fit ? ` style="object-fit:${fit}"` : '';
    const bx = lk.box;
    const pos = bx ? `left:${(bx.x * 100).toFixed(3)}%;top:${(bx.y * 100).toFixed(3)}%;width:${(bx.w * 100).toFixed(3)}%;height:${(bx.h * 100).toFixed(3)}%` : 'left:0;top:0;width:100%;height:100%';
    let inner;
    if (c.videoPath) inner = `<video src="${media(c.videoPath, c.videoVersion)}" autoplay muted${c.once ? '' : ' loop'} playsinline${fitS}></video>`;
    else {
      // 그룹마다 다른 켄번스 변형(vrew 와 동일 분포: (n*7+3)%12) · 움직임을 정했으면 그 종류(vrew-builder _kenBurnsForLook 과 같은 번호)
      const kbIdx = lk.motion === 'auto' ? ((Number(c.num) || 0) * 7 + 3) % 12 : ({ in: 0, out: 1, lr: 2, rl: 3, bt: 4, tb: 5 }[lk.motion]);
      const kbCls = lk.motion === 'none' ? 'kbnone' : `kb kb${kbIdx}`;
      inner = `<img class="${kbCls}" src="${media(c.imagePath, c.imageVersion)}"${fitS}>`;
    }
    return `<div class="vlayer" data-num="${c.num}" style="${pos}"><div class="vlook"${flipT}>${inner}</div></div>`;
  }
  // 🖼 이 문장을 덮는 그림(아래 → 위) — 자기 그룹 그림 + 앞 그룹에서 아래층으로 이어진 그림(core/visual-span 과 같은 규칙: 그룹 순서 = 쌓는 순서)
  function visLayersAt(pr, cut, sentIdx) {
    if (!pr || !cut) return cut && (cut.imagePath || cut.videoPath) ? [cut] : [];
    let o = 0, ord = 0; const out = [];
    for (const c of pr.cuts) { if (c === cut) { ord = o + 1 + (sentIdx || 0); break; } o += (c.sentences || []).length; }
    o = 0;
    for (const c of pr.cuts) {
      const a = o + 1, b = o + (c.sentences || []).length; o = b;
      if (!(c.imagePath || c.videoPath)) continue;
      const r = c.span || { from: a, to: b };
      if (ord >= r.from && ord <= r.to) out.push(c);
    }
    for (const o of (pr.overlays || [])) if (!o.broken && o.kind !== 'audio' && ord >= o.from && ord <= o.to) out.push(ovAsLayer(o));   // ➕ 삽입 그림·영상 — 늘 맨 위
    return out;
  }
  function setVisual(c, pr, sentIdx, extraSec) {
    const v = stageVisualRef.current; if (!v) return;
    const layers = pr ? visLayersAt(pr, c, sentIdx) : (c && (c.imagePath || c.videoPath) ? [c] : []);
    const key = layers.map(visKey).join('/') || ('none|' + (c ? c.num : ''));
    lastVisRef.current = key;
    stageLayersRef.current = { pr, layers };
    if (!layers.length) { v.innerHTML = `<div style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;color:#998">이미지나 비디오가 없음</div>`; return; }
    v.innerHTML = layers.map(layerHtml).join('');
    // 🔊 재생 중이면 삽입 영상의 소리를 켠다(그룹 영상은 늘 음소거 — 내레이션과 겹친다)
    if (playingRef.current) for (const c of layers) if (c.ovId && c.videoPath) {
      const vv = v.querySelector('.vlayer[data-num="' + c.num + '"] video');
      if (vv && c.ovVol > 0) { vv.muted = false; vv.volume = Math.min(1, c.ovVol / 100); }
    }
    // 🎬 재생 중엔 영상을 **흐른 시간만큼 건너뛴 자리**에서 튼다 — 중간 클립부터 재생하거나 그룹이 바뀌어 화면을 다시 깔아도
    //   삽입 영상·이어 깐 영상이 처음으로 되돌아가지 않게(v0.5.59 · .vrew 는 원래 이어진다)
    if (playingRef.current && pr) {
      const ord = ordOf(pr, c, sentIdx || 0);
      for (const L of layers) if (L.videoPath) {
        const vv = v.querySelector('.vlayer[data-num="' + L.num + '"] video'); if (!vv) continue;
        const so = L.ovId ? L.ovFrom : (L.span ? L.span.from : ordOf(pr, L, 0));
        const t = secBetween(pr, so, ord) + (Number(extraSec) || 0);
        if (!(t > 0.05)) continue;
        const seek = () => { const d = vv.duration; if (!(d > 0)) return; if (L.once && t >= d) { try { vv.currentTime = Math.max(0, d - 0.05); vv.pause(); } catch (_) {} } else { try { vv.currentTime = t % d; } catch (_) {} } };
        if (vv.readyState >= 1) seek(); else vv.addEventListener('loadedmetadata', seek, { once: true });
      }
    }
    for (const im of v.querySelectorAll('img.kb')) { im.style.animation = 'none'; void im.offsetWidth; im.style.animation = ''; }
  }
  const visKeyAt = (c, pr, sentIdx) => (pr ? visLayersAt(pr, c, sentIdx) : [c]).map(visKey).join('/') || ('none|' + (c ? c.num : ''));

  // 📐 ① 칸에서 그림 옮기기·크기 바꾸기(Vrew) — 누르면 맨 위 그림을 고르고 끌면 옮긴다 · 모서리 = 크기(비율 유지) · 가운데 선에 붙는다
  const [stageSel, setStageSel] = useState(null);   // { sn, num, box:{x,y,w,h}, guides:{v,h} }
  const stageLayersRef = useRef({ pr: null, layers: [] });
  const stageDragRef = useRef(null);
  function defaultBoxOf(c, el) {
    const lk = VLook.normLook(c.look);
    if (lk.box) return { ...lk.box };
    const m = el && (el.querySelector('img') || el.querySelector('video'));
    const nw = m ? (m.naturalWidth || m.videoWidth || 0) : 0, nh = m ? (m.naturalHeight || m.videoHeight || 0) : 0;
    const st = stageVisualRef.current; const sw = st ? st.clientWidth : 16, sh = st ? st.clientHeight : 9;
    if (!(nw > 0 && nh > 0)) return { x: 0, y: 0, w: 1, h: 1 };
    const rImg = nw / nh, rSt = sw / sh;
    const mode = lk.fill === 'auto' ? (Math.abs(rImg - rSt) > 0.06 ? 'contain' : 'full') : lk.fill;
    if (mode === 'full') return { x: 0, y: 0, w: 1, h: 1 };
    const sc = mode === 'cover' ? Math.max(sw / nw, sh / nh) : Math.min(sw / nw, sh / nh);
    const w = (nw * sc) / sw, h = (nh * sc) / sh;
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }
  function onStageDown(ev) {
    if (!wsOn || playerOpen || sentEdit || ev.button !== 0) return;
    if (ev.target.closest && (ev.target.closest('.cf-stageline') || ev.target.closest('.stage-edit'))) return;
    const st = stageVisualRef.current; if (!st) return;
    const R = st.getBoundingClientRect();
    const px = (ev.clientX - R.left) / R.width, py = (ev.clientY - R.top) / R.height;
    const handle = ev.target.closest && ev.target.closest('.ssel-h');
    const { pr, layers } = stageLayersRef.current || {};
    if (!pr || !layers || !layers.length) return;
    let pick = null;
    if (handle && stageSel) pick = layers.find((c) => c.num === stageSel.num) || null;
    else {
      // 맨 위부터 — 누른 점을 덮는 그림
      for (let i = layers.length - 1; i >= 0 && !pick; i--) {
        const el = st.querySelector('.vlayer[data-num="' + layers[i].num + '"]');
        const b = stageSel && stageSel.num === layers[i].num ? stageSel.box : defaultBoxOf(layers[i], el);
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) pick = layers[i];
      }
    }
    if (!pick) { setStageSel(null); return; }
    ev.preventDefault();
    const el = st.querySelector('.vlayer[data-num="' + pick.num + '"]');
    const box = stageSel && stageSel.num === pick.num ? { ...stageSel.box } : defaultBoxOf(pick, el);
    stageDragRef.current = { sn: pr.shortsNum, num: pick.num, start: box, px, py, corner: handle ? handle.dataset.c : null, moved: false, R, el };
    setStageSel({ sn: pr.shortsNum, num: pick.num, box, guides: {} });
  }
  useEffect(() => {
    const move = (ev) => {
      const d = stageDragRef.current; if (!d) return;
      const px = (ev.clientX - d.R.left) / d.R.width, py = (ev.clientY - d.R.top) / d.R.height;
      const dx = px - d.px, dy = py - d.py;
      if (!d.moved && Math.abs(dx) < 0.004 && Math.abs(dy) < 0.004) return;
      d.moved = true;
      let b = { ...d.start };
      const SNAP = 0.012, g = { v: false, h: false };
      if (!d.corner) {
        b.x = d.start.x + dx; b.y = d.start.y + dy;
        // 가운데 · 가장자리에 붙기 — 붙으면 선을 보인다(Vrew)
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        if (Math.abs(cx - 0.5) < SNAP) { b.x = 0.5 - b.w / 2; g.v = true; }
        else if (Math.abs(b.x) < SNAP) { b.x = 0; g.l = true; } else if (Math.abs(b.x + b.w - 1) < SNAP) { b.x = 1 - b.w; g.r = true; }
        if (Math.abs(cy - 0.5) < SNAP) { b.y = 0.5 - b.h / 2; g.h = true; }
        else if (Math.abs(b.y) < SNAP) { b.y = 0; g.t = true; } else if (Math.abs(b.y + b.h - 1) < SNAP) { b.y = 1 - b.h; g.b = true; }
      } else {
        // 모서리 — 맞은편 모서리를 고정하고 비율을 지킨다(화면 비율 보정: 가로 1 = 세로 H/W)
        const ar = d.start.w / d.start.h;
        const ax = d.corner.includes('l') ? d.start.x + d.start.w : d.start.x;
        const ay = d.corner.includes('t') ? d.start.y + d.start.h : d.start.y;
        let w = Math.max(0.05, Math.abs(px - ax));
        let h = w / ar;
        const hh = Math.max(0.05, Math.abs(py - ay));
        if (hh > h) { h = hh; w = h * ar; }
        b = { x: d.corner.includes('l') ? ax - w : ax, y: d.corner.includes('t') ? ay - h : ay, w, h };
        if (Math.abs(b.x + b.w / 2 - 0.5) < SNAP) g.v = true;
        if (Math.abs(b.y + b.h / 2 - 0.5) < SNAP) g.h = true;
      }
      d.box = b;
      if (d.el) Object.assign(d.el.style, { left: (b.x * 100) + '%', top: (b.y * 100) + '%', width: (b.w * 100) + '%', height: (b.h * 100) + '%' });
      const m = d.el && (d.el.querySelector('img') || d.el.querySelector('video')); if (m) m.style.objectFit = 'fill';
      setStageSel({ sn: d.sn, num: d.num, box: b, guides: g });
    };
    const up = () => {
      const d = stageDragRef.current; stageDragRef.current = null;
      if (!d) return;
      setStageSel((cur) => (cur ? { ...cur, guides: {} } : cur));
      if (d.moved && d.box) {
        if (String(d.num)[0] === 'O') overlayOp({ shortsNum: d.sn, op: 'box', id: String(d.num).slice(1), box: d.box });
        else setGroupLook(d.sn, d.num, { box: d.box });
      }
    };
    const esc = (ev) => { if (ev.key === 'Escape' && !stageDragRef.current) setStageSel(null); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.removeEventListener('keydown', esc); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ↶ 되돌리기·다른 곳에서 그림 자리가 바뀌면 선택 틀도 지금 자리로 맞춘다(옛 틀이 남아 있었다 — 로이 2026-09-25)
  useEffect(() => {
    if (!stageSel || stageDragRef.current) return;
    const pj = dto && dto.projects ? dto.projects.find((x) => x.shortsNum === stageSel.sn) : null;
    const lay = String(stageSel.num)[0] === 'O'
      ? ((pj && pj.overlays) || []).map(ovAsLayer).find((c) => c.num === stageSel.num) || null
      : (pj && pj.cuts ? pj.cuts.find((c) => c.num === stageSel.num) : null);
    if (!lay) return;
    const st = stageVisualRef.current;
    const el = st ? st.querySelector('.vlayer[data-num="' + lay.num + '"]') : null;
    const b = defaultBoxOf(lay, el), o = stageSel.box;
    if (Math.abs(b.x - o.x) + Math.abs(b.y - o.y) + Math.abs(b.w - o.w) + Math.abs(b.h - o.h) > 1e-4) setStageSel({ ...stageSel, box: b, guides: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dto]);
  // 커서가 다른 그룹으로 가면 선택을 푼다(그 그림이 안 보일 수 있다)
  useEffect(() => { if (stageSel && !(stageLayersRef.current.layers || []).some((c) => c.num === stageSel.num)) setStageSel(null); });

  async function stepCaptions(clips, durMs, s, where, startLi) {
    const _g = playGenRef.current;
    // 🧭 재생 중에도 ② 커서가 따라간다 — where = { shortsNum, groupNum, sentIdx }
    const PLw = where ? linesMap.get(where.shortsNum) : null;
    const wLines = PLw ? (PLw.bySent.get(where.groupNum + ':' + where.sentIdx) || []) : [];
    const total = clips.reduce((a, c) => a + Math.max(1, mLen(c)), 0) || 1;
    // 🎨 서식·효과 — 채널 기본 + 문장 덮어쓰기(core/caption-format)를 그대로 그리고, 효과는 core/caption-anim 로 움직인다(MP4 와 같은 키프레임)
    const text = s ? String(s.text || '') : '';
    const ranges = s ? CF.lineRanges(text, clips) : null;
    const base = CF.normFmt(capBase); base.size = capBase.size;
    for (let i = Math.max(0, startLi || 0); i < clips.length; i++) {
      const cl = clips[i];
      if (stale(_g)) return;
      const d = Math.max(250, durMs * (Math.max(1, mLen(cl)) / total));
      if (stopLineRef.current) { stopLineRef.current(); stopLineRef.current = null; }
      if (where && wLines[i]) setCursor({ shortsNum: where.shortsNum, n: wLines[i].n });
      const el = stageCapRef.current;
      if (el) {
        if (s && cl) {
          const runs = CF.lineRuns(text, s.spans, ranges[i], base);
          const lp = CF.lineProps(s.spans, ranges[i], base, text.length);
          const k = applyCaptionStyle(lp);   // 📐 줄별 위치 · k = 미리보기 px / 1080 화면 px(테두리·그림자 두께 환산)
          const box = el.parentElement ? { w: el.parentElement.clientWidth, h: el.parentElement.clientHeight } : null;
          stopLineRef.current = renderStageLine(el, runs, lp, d, k, box);
        } else { applyCaptionStyle(); el.textContent = cl; }
      }
      await wait(d);
    }
  }
  // 🎵 미리보기 소리 — 문장마다 「지금 들려야 할 것」(오디오 삽입 · 채널 배경음악)을 맞춘다. 파일은 한 번만 읽는다.
  const insAudRef = useRef(new Map());   // key → Audio
  const audUrlRef = useRef(new Map());   // file → data URL
  const insAudStartRef = useRef({ ord: -1, sec: 0 });   // 재생을 문장 중간(클립)에서 시작했을 때 그 문장 안에서 흐른 초
  function stopInsAudio() { for (const a of insAudRef.current.values()) { try { a.pause(); } catch (_) {} } insAudRef.current.clear(); }
  async function audUrl(file) {
    if (audUrlRef.current.has(file)) return audUrlRef.current.get(file);
    const u = await api.readAudio(file); if (u) audUrlRef.current.set(file, u); return u;
  }
  async function syncInsAudio(pr, ord) {
    const _g = playGenRef.current;
    const want = [];
    for (const o of (pr && pr.overlays) || []) if (o.kind === 'audio' && !o.broken && ord >= o.from && ord <= o.to) want.push({ key: 'ov:' + o.id, file: o.file, vol: (o.volume == null ? 30 : o.volume) / 100, from: o.from, once: !!o.once });
    if (bgmCfg.on && bgmCfg.path) {
      if (!audUrlRef.current.has('__bgm:' + presetName)) { try { audUrlRef.current.set('__bgm:' + presetName, await api.bgmPreviewFile({ presetName })); } catch (_) {} }
      const b = audUrlRef.current.get('__bgm:' + presetName);
      if (b && b.file) want.push({ key: 'bgm', file: b.file, vol: b.volume != null ? b.volume : 0.15, from: 1 });
    }
    const keys = new Set(want.map((w) => w.key));
    try { window.__pmInsAudio = () => [...insAudRef.current].map(([k, x]) => ({ key: k, paused: x.paused, vol: x.volume, t: x.currentTime })); } catch (_) {}   // 🧪 E2E 확인용(지금 울리는 삽입 소리)
    for (const [k, a] of insAudRef.current) if (!keys.has(k)) { try { a.pause(); } catch (_) {} insAudRef.current.delete(k); }
    for (const w of want) {
      if (insAudRef.current.has(w.key)) { insAudRef.current.get(w.key).volume = Math.min(1, w.vol); continue; }
      const u = await audUrl(w.file);
      if (!u || stale(_g)) continue;
      const a = new Audio(u); a.loop = !w.once; a.volume = Math.min(1, Math.max(0, w.vol));   // once = 1회 재생(끝나면 멈춘다)
      // 🔑 구간 시작(from)부터 지금 문장(ord) 앞까지 흐른 시간만큼 건너뛴다 — 중간 그룹에서 재생을 시작해도 음악이 이어진다
      //   (클립 중간에서 시작했으면 그 문장 안에서 흐른 몫까지)
      const off = secBetween(pr, w.from, ord) + (ord === insAudStartRef.current.ord ? insAudStartRef.current.sec : 0);
      if (off > 0.05) a.addEventListener('loadedmetadata', () => { try { if (w.once && a.duration > 0 && off >= a.duration) { a.pause(); return; } a.currentTime = a.duration > 0 ? (w.once ? off : off % a.duration) : off; } catch (_) {} }, { once: true });
      insAudRef.current.set(w.key, a);
      a.play().catch((e) => logline('🎵 미리보기 소리 실패: ' + (w.file.split(/[\\/]/).pop()) + ' — ' + e.message));
    }
  }
  // 편 문장 번호 a 부터 b 앞까지 음성 길이 합(초) — 미리보기에서 삽입 소리의 이어 틀 위치
  function secBetween(pr, a, b) { let o = 0, t = 0; for (const x of pr.cuts) for (const se of (x.sentences || [])) { o++; if (o >= a && o < b) t += se.dur || 2.5; } return t; }
  function ordOf(pr, cut, si) { let o = 0; for (const x of pr.cuts) { if (x.num === cut.num) return o + si + 1; o += (x.sentences || []).length; } return 0; }
  // start = { si, li } — 이 그룹의 si 번째 문장 · li 번째 자막 줄(클립)부터(🧭 Space = 커서 클립부터 · v0.5.59)
  async function playCut(c, info, sn, start) {
    const _g = playGenRef.current;
    const _prP = dto && dto.projects ? dto.projects.find((p) => p.shortsNum === sn) : null;
    const N = effCap;
    const sents = (c.sentences && c.sentences.length) ? c.sentences : [{ text: '', audio: null, dur: c.groupDurationSec || 2.5 }];
    const si0 = start && start.si > 0 && start.si < sents.length ? start.si : 0;
    // 첫 문장 안에서 건너뛸 몫(글자수 비례 — .vrew · 자막 줄 시간과 같은 규칙)
    const clips0 = splitLines(sents[si0].text || '', N, sents[si0].breaks);
    const li0 = start && start.li > 0 && start.li < clips0.length ? start.li : 0;
    const tot0 = clips0.reduce((a, x) => a + Math.max(1, mLen(x)), 0) || 1;
    const frac0 = li0 ? clips0.slice(0, li0).reduce((a, x) => a + Math.max(1, mLen(x)), 0) / tot0 : 0;
    const skip0 = frac0 * (sents[si0].dur || 2.5);
    insAudStartRef.current = { ord: _prP ? ordOf(_prP, c, si0) : -1, sec: skip0 };
    setVisual(c, _prP, si0, skip0); if (playerInfoRef.current) playerInfoRef.current.textContent = info;
    for (let si = si0; si < sents.length; si++) {
      const s = sents[si];
      if (stale(_g)) return;
      if (_prP && lastVisRef.current !== visKeyAt(c, _prP, si)) setVisual(c, _prP, si);
      if (_prP) syncInsAudio(_prP, ordOf(_prP, c, si));   // 🎵 삽입 오디오 · 배경음악
      if (curAudioRef.current) { try { curAudioRef.current.pause(); } catch (_) {} curAudioRef.current = null; }
      const clips = splitLines(s.text || '', N, s.breaks); const dur = s.dur || 2.5;
      const first = si === si0 && li0 > 0;
      if (s.audio) {
        try {
          const url = await api.readAudio(s.audio);
          if (url) {
            const a = new Audio(url); curAudioRef.current = a;
            if (first) {
              await new Promise((r) => { if (a.readyState >= 1) r(); else { a.addEventListener('loadedmetadata', r, { once: true }); a.addEventListener('error', r, { once: true }); } });
              try { a.currentTime = frac0 * (a.duration || dur); } catch (_) {}
            }
            await a.play();
          }
          else logline('미리듣기: 오디오 파일을 읽지 못함 (' + s.audio + ')');
        } catch (e) { logline('미리듣기 오디오 실패: ' + e.message); }
      }
      if (stale(_g)) return;
      await stepCaptions(clips.length ? clips : [''], dur * 1000, s, sn != null && c.sentences && c.sentences.length ? { shortsNum: sn, groupNum: c.num, sentIdx: si } : null, first ? li0 : 0);
    }
  }
  async function playProjects(projs, blackBetween, key, start) {
    stopInsAudio(); playAbortRef.current = false; const _g = ++playGenRef.current; playingRef.current = true; setPlayerOpen(true); setPlayKey(key || 'all');
    await wait(0); applyCaptionStyle();
    for (let pi = 0; pi < projs.length; pi++) {
      const pr = projs[pi];
      for (let ci = 0; ci < pr.cuts.length; ci++) { const c = pr.cuts[ci]; if (stale(_g)) return; await playCut(c, `${pr.title} · G${c.num} ${c.phase || ''}`, pr.shortsNum, pi === 0 && ci === 0 ? start : null); }
      if (blackBetween && pi < projs.length - 1 && !stale(_g)) {
        if (stageVisualRef.current) stageVisualRef.current.innerHTML = '';
        if (stageCapRef.current) stageCapRef.current.textContent = '';
        if (playerInfoRef.current) playerInfoRef.current.textContent = '— 다음 영상 —';
        await wait(1000);
      }
    }
    stopStageVideo(); // 마지막 그룹 영상 무한반복 방지 — 시퀀스 끝나면 정지
    if (!stale(_g)) { stopInsAudio(); playingRef.current = false; setPlayKey(null); }
    if (!stale(_g) && playerInfoRef.current) playerInfoRef.current.textContent = '재생 완료';
    if (!stale(_g) && view === 'clips') setPlayerOpen(false);   // 🧭 클립 보기: 끝나면 커서 자리의 정지 화면으로
  }
  // 스테이지의 영상 정지 (loop 무한반복 차단)
  function stopStageVideo() {
    const v = stageVisualRef.current && stageVisualRef.current.querySelector('video');
    if (v) { try { v.pause(); } catch (_) {} }
  }
  function playShorts(shortsNum) {
    if (!dto) return;
    const key = shortsNum == null ? 'all' : 'shorts:' + shortsNum;
    if (playerOpen && playKey === key) { stopPlayer(); return; }   // ■
    const projs = dto.projects.filter((p) => shortsNum == null || p.shortsNum === shortsNum);
    if (projs.length) playProjects(projs, shortsNum == null, key);
  }
  function playGroup(shortsNum, groupNum) {
    if (!dto) return;
    const pr = dto.projects.find((p) => p.shortsNum === shortsNum); if (!pr) return;
    const c = pr.cuts.find((x) => x.num === groupNum); if (!c) return;
    const key = 'group:' + shortsNum + ':' + groupNum;
    if (playerOpen && playKey === key) { stopPlayer(); return; }   // ■
    stopInsAudio(); playAbortRef.current = false; const _g = ++playGenRef.current; playingRef.current = true; setPlayerOpen(true); setPlayKey(key);
    (async () => { await wait(0); applyCaptionStyle(); await playCut(c, `${pr.title} · G${c.num}`, shortsNum); stopStageVideo(); if (!stale(_g)) { stopInsAudio(); playingRef.current = false; setPlayKey(null); } if (!stale(_g) && playerInfoRef.current) playerInfoRef.current.textContent = '재생 완료'; if (!stale(_g) && view === 'clips') setPlayerOpen(false); })();
  }
  function stopPlayer() {
    playAbortRef.current = true; playGenRef.current++; playingRef.current = false; setPlayKey(null); stopInsAudio();
    if (stopLineRef.current) { stopLineRef.current(); stopLineRef.current = null; }   // 🎨 도는 자막 효과 멈춤
    if (curAudioRef.current) { try { curAudioRef.current.pause(); } catch (_) {} curAudioRef.current = null; }
    if (stageVisualRef.current) stageVisualRef.current.innerHTML = '';
    if (stageCapRef.current) stageCapRef.current.textContent = '';
    lastVisRef.current = null;   // 🧭 비웠으니 커서 화면을 다시 깐다
    setPlayerOpen(false);
  }
  /** 🧭 커서 줄부터 재생(클립 보기 · Space) — 그 줄이 든 그룹부터 끝까지. */
  function playFromCursor() {
    if (!dto || !cursor) return;
    const PL = linesMap.get(cursor.shortsNum); const l = PL && PL.list.find((x) => x.n === cursor.n);
    if (!l) return;
    // 🔑 그룹 처음이 아니라 **그 클립(자막 줄)부터** — 문장 안 몇 번째 줄인지까지(로이 2026-09-25)
    const same = PL.bySent.get(l.groupNum + ':' + l.sentIdx) || [];
    const li = Math.max(0, same.findIndex((x) => x.n === l.n));
    playFrom(cursor.shortsNum, l.groupNum, { si: l.sentIdx || 0, li }, 'cursor');
  }
  // 팝업/모달 닫기 = 바깥 클릭이 아니라 ESC 또는 취소·닫기 버튼으로만 (실수 클릭에 입력 유실 방지).
  //   여러 개가 겹쳐 떠 있어도 최상단(가장 나중에 연) 하나만 닫는다.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (preview) { setPreview(null); return; }
      if (playerOpen) { stopPlayer(); return; }
      if (nameAsk) { nameAskCancel(); return; }        // 이름 입력(다른 모달 위에 뜸) — 가장 먼저
      if (capDlg) { setCapDlg(null); return; }          // 🎨 채널 편집 위의 자막 서식 창
      if (promptView) { setPromptView(null); return; }
      if (settingsOpen) { setSettingsOpen(false); return; }
      if (ttsSrvOpen) { setTtsSrvOpen(false); return; }
      if (comfyOpen) { setComfyOpen(false); return; }
      if (cvidOpen) { setCvidOpen(false); return; }
      if (urlOpen) { setUrlOpen(false); return; }
      if (tsOpen) { setTsOpen(false); return; }
      if (impOpen) { setImpOpen(false); return; }
      if (scriptEditOpen) { setScriptEditOpen(false); return; }
      if (ollamaOpen) { setOllamaOpen(false); return; }
      if (vdOpen) { closeVoiceDesign(); return; }
      if (dictOpen) { setDictOpen(false); return; }
      if (styleEditOpen) { setStyleEditOpen(false); return; }
      if (chOpen) { setChOpen(false); return; }
      if (capPanel) { setCapPanel(null); return; }      // 🎨 옆 패널 → 한 번 더 누르면 선택 해제
      if (capSel && !sentEdit) { setCapSel(null); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, playerOpen, nameAsk, promptView, settingsOpen, ttsSrvOpen, comfyOpen, cvidOpen, urlOpen, tsOpen, impOpen, scriptEditOpen, ollamaOpen, vdOpen, dictOpen, styleEditOpen, chOpen, capDlg, capPanel, capSel, sentEdit]);
  // 🧭 ① 칸 = 커서 줄의 그림/영상 + **그 줄 자막**(효과 없이 최종 모양). 재생 중엔 재생이 그린다.
  const wsOn = !noProduction && view === 'clips';
  function cursorInfo() {
    if (!cursor || !dto || !dto.projects) return null;
    const pr = dto.projects.find((p) => p.shortsNum === cursor.shortsNum); const PL = linesMap.get(cursor.shortsNum);
    const l = PL && PL.list.find((x) => x.n === cursor.n);
    if (!pr || !l) return null;
    const cut = pr.cuts[l.ci]; const sen = cut && cut.sentences ? cut.sentences[l.sentIdx] : null;
    return { pr, cut, s: sen, l, total: PL.list.length };
  }
  useEffect(() => {
    if (!wsOn || playerOpen) return;
    const el = stageCapRef.current; if (!el) return;
    const ci = cursorInfo();
    if (stopLineRef.current) { stopLineRef.current(); stopLineRef.current = null; }
    if (!ci || !ci.s) { el.textContent = ''; if (stageVisualRef.current && !ci) { stageVisualRef.current.innerHTML = ''; lastVisRef.current = null; } return; }
    if (lastVisRef.current !== visKeyAt(ci.cut, ci.pr, ci.l.sentIdx)) setVisual(ci.cut, ci.pr, ci.l.sentIdx);
    const text = String(ci.s.text || '');
    const base = CF.normFmt(capBase); base.size = capBase.size;
    const runs = CF.lineRuns(text, ci.s.spans, ci.l.range, base);
    const lp = CF.lineProps(ci.s.spans, ci.l.range, base, text.length);
    const k = applyCaptionStyle(lp);
    const box = el.parentElement ? { w: el.parentElement.clientWidth, h: el.parentElement.clientHeight } : null;
    renderStageLine(el, runs, { ...lp, anim: null }, 0, k, box);
    if (playerInfoRef.current) playerInfoRef.current.textContent = `G${ci.cut.num} · 자막 ${ci.l.n} / ${ci.total}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsOn, playerOpen, cursor, linesMap, capLook, capSize, capPos, capFine, capAlign, capYAlign, capXOff, pane1W]);
  // 커서가 없거나 사라진 줄이면 첫 줄로(대본을 열었을 때 · 문장을 합쳐 줄이 줄었을 때)
  useEffect(() => {
    if (!dto || !dto.projects || !dto.projects.length) { if (cursor) setCursor(null); return; }
    const ok = cursor && linesMap.get(cursor.shortsNum) && linesMap.get(cursor.shortsNum).list.some((x) => x.n === cursor.n);
    if (ok) return;
    const pr = dto.projects[0]; const PL = linesMap.get(pr.shortsNum);
    if (PL && PL.list.length) setCursor({ shortsNum: pr.shortsNum, n: Math.min(PL.list.length, cursor && cursor.shortsNum === pr.shortsNum ? cursor.n : 1) });
    else if (cursor) setCursor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesMap]);
  // ① 칸 폭이 바뀌면(창 크기·경계 끌기) 자막 배율을 다시 잰다
  useEffect(() => {
    if (!wsOn) return undefined;
    const st = stageCapRef.current && stageCapRef.current.parentElement;
    if (!st || typeof ResizeObserver === 'undefined') return undefined;
    let w0 = st.clientWidth;
    const ro = new ResizeObserver(() => { if (st.clientWidth !== w0) { w0 = st.clientWidth; setPane1W((x) => x); if (!playerOpen) setCursor((c) => (c ? { ...c } : c)); } });
    ro.observe(st);
    return () => ro.disconnect();
  }, [wsOn, playerOpen]);
  /** 🧭 키보드로 줄 이동(클립 보기) — ↑↓ 한 줄 · Shift 범위 · PageUp/Down 10줄 · Home/End · Enter 고치기 · Space 재생/멈춤.
   *  입력칸·편집칸·열린 창이 있으면 손대지 않는다. */
  function moveCursor(delta, extend, abs) {
    const PL = cursor && linesMap.get(cursor.shortsNum); if (!PL || !PL.list.length) return;
    const idx = Math.max(0, PL.list.findIndex((x) => x.n === cursor.n));
    const ni = abs === 'home' ? 0 : abs === 'end' ? PL.list.length - 1 : Math.max(0, Math.min(PL.list.length - 1, idx + delta));
    const l = PL.list[ni];
    const info = { n: l.n, groupNum: l.groupNum, sentIdx: l.sentIdx, from: l.from, to: l.to };
    setCursor({ shortsNum: cursor.shortsNum, n: l.n });
    setCapSel((cur) => {
      if (extend && cur && cur.mode === 'lines' && cur.shortsNum === cursor.shortsNum && cur.anchorN != null) {
        const a = Math.min(cur.anchorN, l.n), b = Math.max(cur.anchorN, l.n);
        return { ...cur, items: PL.list.filter((x) => x.n >= a && x.n <= b).map((x) => ({ n: x.n, groupNum: x.groupNum, sentIdx: x.sentIdx, from: x.from, to: x.to })) };
      }
      return { shortsNum: cursor.shortsNum, mode: 'lines', items: [info], anchorN: extend ? cursor.n : l.n };
    });
    setTimeout(() => { const e = document.querySelector('.sent[data-ln="' + l.n + '"]'); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'nearest' }); }, 0);
  }
  const anyModal = !!(preview || nameAsk || capDlg || promptView || settingsOpen || ttsSrvOpen || comfyOpen || cvidOpen || urlOpen || tsOpen || impOpen || scriptEditOpen || ollamaOpen || vdOpen || dictOpen || styleEditOpen || chOpen || readerOpen);
  useEffect(() => {
    if (!wsOn) return undefined;
    const onKey = (e) => {
      if (anyModal || sentEdit || e.altKey) return;
      const t = e.target; const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectAllClips(); return; }   // 🧩 Ctrl+A = 모든 클립
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1, e.shiftKey); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1, e.shiftKey); }
      else if (e.key === 'PageDown') { e.preventDefault(); moveCursor(10, e.shiftKey); }
      else if (e.key === 'PageUp') { e.preventDefault(); moveCursor(-10, e.shiftKey); }
      else if (e.key === 'Home') { e.preventDefault(); moveCursor(0, e.shiftKey, 'home'); }
      else if (e.key === 'End') { e.preventDefault(); moveCursor(0, e.shiftKey, 'end'); }
      else if (e.key === 'Enter') {
        const ci = cursorInfo(); if (!ci || !ci.s) return;
        e.preventDefault();
        if (clipDetail) openLineEdit(ci.pr.shortsNum, ci.l.n, null);
        else startSentEdit(ci.pr.shortsNum, ci.cut.num, ci.l.sentIdx, ci.s.text);
      } else if (e.key === ' ') { e.preventDefault(); if (tag === 'BUTTON' && t.blur) t.blur(); if (playerOpen) stopPlayer(); else playFromCursor(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });
  /** ① ↔ ② 경계 끌기 — 폭을 기억한다. */
  function startPaneDrag(e) {
    e.preventDefault();
    const body = document.getElementById('body'); const BW = body ? body.clientWidth : window.innerWidth;
    const x0 = e.clientX, w0 = pane1W * BW;
    const mv = (ev) => setPane1W(Math.max(0.2, Math.min(0.7, (w0 + ev.clientX - x0) / BW)));
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); setPane1W((w) => { lsSet('pm.pane1R', w.toFixed(3)); return w; }); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  }
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
        // 검색창은 늘 떠 있으므로 **포커스만** 옮긴다(2026-09-16).
        e.preventDefault();
        const el = document.getElementById('find-input'); if (el) { el.focus(); el.select(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // findInPage 는 무거운 DOM(대본 수십 컷+영상)에서 호출당 전체 스캔이라, 타이핑마다 부르면 프리징.
  //   → 타이핑은 디바운스(280ms)로 멈춘 뒤 1번만, Enter/▲▼(move)는 즉시.
  // 🔴 **Electron 의 findNext 는 「다음으로 이동」이 아니라 「새 세션을 시작하는가」다**(2026-09-16 실측).
  //   옛 코드는 반대로 써서 **타이핑만으로는 검색이 아예 안 됐다**(found-in-page 이벤트 0건 — 실측 확인).
  //   그래서 문자열이 바뀌면 새 세션(true), 같은 문자열에서 이동이면 follow-up(false) 으로 보낸다.
  function runFind(text, move, forward) {
    findTextRef.current = text;              // state 로 두면 타이핑마다 전 화면 재렌더 → 입력이 멈춘다
    if (findTimerRef.current) { clearTimeout(findTimerRef.current); findTimerRef.current = null; }
    if (!text) { api.findStop(); findSessionRef.current = ''; setFindRes({ active: 0, total: 0 }); return; }
    const fire = () => {
      const fresh = findSessionRef.current !== text;   // 세션이 잡고 있는 문자열과 다르면 새로 시작해야 한다
      findSessionRef.current = text;
      api.findInPage({ text, findNext: fresh, forward: forward !== false });
    };
    if (move) fire(); else findTimerRef.current = setTimeout(fire, 280);
  }
  // 검색창은 상시 표시라 「닫기」가 없다 — Esc·✕ 는 **검색어를 지우고 강조를 푼다**.
  //   ⚠ 비제어 입력이라 DOM 값을 직접 비운다(state 로 두면 타이핑마다 전 화면이 재렌더된다).
  function clearFind() {
    if (findTimerRef.current) { clearTimeout(findTimerRef.current); findTimerRef.current = null; }
    findTextRef.current = ''; findSessionRef.current = '';
    const el = document.getElementById('find-input'); if (el) el.value = '';
    api.findStop(); setFindRes({ active: 0, total: 0 });
  }
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
  // 지금 고른 엔진에 맞는 설정 탭 — 옛 「② 이미지」 줄 ⚙ 가 쓰던 판정을 그대로 가져왔다(그 버튼은 제거).
  function settingsTabForEngine() {
    if (isComfyEngine(imgEngine)) return 'img';
    if (isComfyEngine(videoEngine)) return 'vid';
    if (imgEngine === 'gemini') return 'keys';
    return 'free';
  }
  async function openSettings(tab) {
    setSettingsTab(tab || 'img');
    // 🌐 브라우저 이미지 탭이 쓰는 값 — 순환(Flow 모델)·LoRA 수집. 실패해도 나머지 탭은 정상 동작.
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
      {splitOpts.mode === 'sentence' && <button className="ghost introvid" disabled={!loaded} title="도입부 문장만 TTS 후 영상 한 개 길이(⚙ 설정의 비디오 최대 길이 · 기본 8초) 기준으로 도입부 그룹 재배치 — 그래도 남는 차이는 .vrew 를 만들 때 느리게·반복으로 채웁니다" onClick={runIntroVideo}>🎬 도입부 TTS+재배치</button>}
      {/* 📥 통합대본('> 📥 자산출처:' 메타)일 때만 — 각 부의 기존 음성·이미지·비디오를 이어받는다(재생성 0). */}
      {mergeSources > 0 && <button className="ghost" disabled={!loaded} title={`자산출처 ${mergeSources}개에서 기존 TTS·이미지·비디오를 이 작업폴더로 복사해 연결합니다 (대본 열 때 자동 실행 — 이 버튼은 재실행용)`} onClick={runMergePrefill}>📥 이어받기</button>}
    </span>
  ) : null;

  // 🎞 스테이지(① 칸 · 카드 보기에선 덮는 창) — 하나만 그린다(ref 가 같아야 재생 코드가 그대로 돈다)
  const stageEl = (<>
    <div id="stage" className={'lf' + (sentEdit && sentEdit.where === 'stage' ? ' capediting' : '')} data-testid="stage" onMouseDown={onStageDown}>
      <div id="stageVisual" ref={stageVisualRef} />
      {stageLogo && <img className="stage-logo" data-testid="stage-logo" alt="" src={media(stageLogo.path)}
        style={{ width: stageLogo.size + '%', top: (2.5 * 16 / 9).toFixed(3) + '%', [stageLogo.side]: '2.5%' }} />}
      {wsOn && stageSel && !playerOpen && (
        <div className="ssel" data-testid="stage-sel" style={{ left: (stageSel.box.x * 100) + '%', top: (stageSel.box.y * 100) + '%', width: (stageSel.box.w * 100) + '%', height: (stageSel.box.h * 100) + '%' }}
          title="끌어서 옮기기 · 모서리를 끌어 크기(비율 유지) · 가운데에 가까우면 붙는다 · Esc 해제">
          {['tl', 'tr', 'bl', 'br'].map((k) => <span key={k} className={'ssel-h ' + k} data-c={k} />)}
          <span className="ssel-tag">{String(stageSel.num)[0] === 'O' ? '➕ 삽입' : 'G' + stageSel.num}</span>
        </div>
      )}
      {wsOn && stageSel && stageSel.guides && stageSel.guides.v && <div className="sguide v" data-testid="guide-v" />}
      {wsOn && stageSel && stageSel.guides && stageSel.guides.h && <div className="sguide h" data-testid="guide-h" />}
      <div id="stageCap" ref={stageCapRef} title={wsOn ? '누르면 이 자리에서 글자·서식 고치기' : undefined}
        onClick={(ev) => { if (wsOn && ev.target.closest && ev.target.closest('.cf-stageline')) openStageEdit(); }} />
      {wsOn && sentEdit && sentEdit.where === 'stage' && stageEditBox && (() => {
        // 🧩 Vrew 팝업 — 위: 작은 서식 막대 · 아래: 자막 자리 그대로의 글자칸(초록 테두리). Enter/밖 누르기 = 저장 · ↑↓ 다음 클립 · Esc 취소
        const f = capSelFmt(); const k = stageEditBox.stageW / 1920;
        const css = fmtCss(f, k, true);
        const w = Math.max(220, stageEditBox.width + 24);
        const left = Math.max(4, Math.min(stageEditBox.stageW - w - 4, stageEditBox.left - 12));
        return (
          <div className="stage-edit" data-testid="stage-edit">
            <div className="stage-mini" style={{ left, bottom: stageEditBox.stageH - stageEditBox.top + 10 }}>
              <CaptionMiniBar fmt={f} pos={capSelPos()} onPatch={applyCapFmt} onPanel={(p) => setCapPanel((cur) => (cur === p ? null : p))} panel={capPanel} />
            </div>
            <textarea className="stage-ta" rows={1} spellCheck={false} autoFocus data-testid="stage-ta"
              defaultValue={String(sentEdit.text || '').slice(sentEdit.line.from, sentEdit.line.to)}
              style={{ ...css, left, top: stageEditBox.top - 6, width: w, fontSize: (Number(f.size) || 100) * 0.72 * k, textAlign: capSelPos().align === 'end' ? 'right' : capSelPos().align === 'center' ? 'center' : 'left' }}
              ref={(el) => { sentEditRef.current = el; fitSentBox(el); }}
              onInput={(ev) => fitSentBox(ev.currentTarget)}
              onKeyDown={(ev) => lineEditKey(ev, null)} />
          </div>
        );
      })()}
    </div>
    <div id="playerBar">
      {wsOn && <button className={playerOpen ? 'ghost' : ''} data-testid="play-btn" title="커서 줄부터 재생 / 멈춤 (Space)" onClick={() => (playerOpen ? stopPlayer() : playFromCursor())}>{playerOpen ? '■ 멈춤' : '▶ 재생'}</button>}
      <span id="playerInfo" ref={playerInfoRef} />
      {!wsOn && <button className="ghost" onClick={stopPlayer}>■ 닫기</button>}
    </div>
  </>);
  // 🧭 클립 정보 상자(① 아래) — 커서 줄의 그룹 · 그림/영상 · 자주 쓰는 그룹 단추
  const clipInfo = (() => {
    if (!wsOn) return null;
    const ci = cursorInfo();
    if (!ci) return <div className="clipinfo" data-testid="clipinfo"><span className="meta">대본을 열면 커서 자리의 그림·자막이 여기에 보입니다</span></div>;
    const c = ci.cut; const base = (p) => (p ? String(p).split(/[\\/]/).pop() : '');
    return (
      <div className="clipinfo" data-testid="clipinfo">
        <b>G{c.num}</b> <span className="meta">{c.phase || ''} · 자막 {ci.l.n}/{ci.total}</span>
        <span className="meta clipfile" title={c.videoPath || c.imagePath || ''}>{c.videoPath ? '🎬 ' + base(c.videoPath) : c.imagePath ? '🖼 ' + base(c.imagePath) : '그림 없음'}</span>
        <span className="grow" />
        <button className="gprev" title="이 그룹 그림/영상 첨부" onClick={() => attachAsset(ci.pr.shortsNum, c.num)}>📎</button>
        {(c.imagePath || c.videoPath) && <button className="gprev" title="첨부 지우기" onClick={() => clearAsset(ci.pr.shortsNum, c.num)}>✕</button>}
        <button className="gprev" title="이미지 재생성" onClick={() => runRegen(ci.pr.shortsNum, c.num)}>🔄</button>
        <button className="gprev" title="이 그룹 미리듣기" onClick={() => playGroup(ci.pr.shortsNum, c.num)}>{playerOpen && playKey === 'group:' + ci.pr.shortsNum + ':' + c.num ? '■' : '▶'}</button>
      </div>
    );
  })();
  // 📜 로그 상자 — 클립 보기에선 ① 칸 아래(docked), 카드 보기·출판·리모션에선 예전의 떠 있는 창(.docked 를 떼면 그 모양).
  const logDocked = !noProduction && view === 'clips';
  const logBox = (
        <aside id="logwrap" className={logDocked ? 'docked' : ''}>
            <div id="logbar">
              <b>로그</b> <span id="status">{status ? '· ' + status : ''}</span>
              <button className="ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={copyLog}>📋 복사</button>
              <button className="ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setLogText('')}>지우기</button>
              <button className="ghost" style={{ padding: '2px 8px', fontSize: 11 }} title="로그 파일 폴더 열기 (하루 1개 · 7일 보관)" onClick={() => { try { api.openLogs(); } catch (_) {} }}>📁 파일</button>
            </div>
            <div id="log" ref={logRef}>{logText}</div>
        </aside>
  );
  const workTimes = (
        <span className="worktimes" title="진행률(완료/전체) · 괄호=마지막 작업 소요시간">
          ⏱ TTS {prog.ttsD}/{prog.ttsT} ({fmtSec(timings.tts)}) · 이미지 {prog.imgD}/{prog.imgT} ({fmtSec(timings.image)}) · 영상 {prog.vidD}/{prog.vidT} ({fmtSec(timings.video)}) · <b>합계 {fmtSec(timings.tts + timings.image + timings.video)}</b>
          {timings.make > 0 && <> · ⚡전체 {fmtSec(timings.make)}</>}
        </span>
  );
  // ── 렌더 ─────────────────────────────────────────────────
  return (
    <>
      <div className="topsticky">
      {/* 🧭 v0.5.42 — Vrew 처럼 **메뉴 줄 + 리본**(로이 2026-09-25: 「메뉴를 누르면 그 메뉴에 관련된 항목이 나오게」).
          예전엔 ①~④ 네 줄 + 로그가 한꺼번에 보여 헤더만 약 400px 이었다. 핸들러·버튼은 그대로 옮겼다. */}
      <header className="vhead">
        <div className="menubar">
            <h1>🎬 Priming{appVersion ? <span className="ver">v{appVersion}</span> : null}</h1>
            <span className="modetoggle">
              <button className={mode === 'longform' ? 'active' : ''} onClick={() => switchMode('longform')}>롱폼</button>
              <button className={mode === 'remotion' ? 'active' : ''} onClick={() => switchMode('remotion')}>🎬 리모션</button>
              <button className={mode === 'book' ? 'active' : ''} onClick={() => switchMode('book')}>📖 출판</button>
            </span>
          {!noProduction && (
            <nav className="menus" data-testid="menus">
              {MENUS.map(([id, label]) => (
                <button key={id} data-menu={id} className={'menu' + (menu === id ? ' on' : '')} onClick={() => pickMenu(id)}>{label}</button>
              ))}
            </nav>
          )}
          <span className="grow" />
        {gsCool && gsCool.until > 0 && (
          <span title={`Genspark 이미지가 구독 한도에 도달했습니다. 그 전까지는 Genspark 에 접속하지 않고 바로 Flow 로 만들고, 이 시각이 지나면 만들던 대본 도중이라도 자동으로 Genspark 로 되돌아가 남은 이미지를 이어서 만듭니다. 앱을 껐다 켜도 유지됩니다.`}
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
            {loaded && (
              <span className="autosave-ind" title="작업은 자동으로 수시 저장됩니다. 같은 대본을 다시 열면 이어서 작업할 수 있어요.">
                {autoSavedAt ? `✓ 자동저장 ${new Date(autoSavedAt).toLocaleTimeString()}` : '자동저장 켜짐'}
              </span>
            )}
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
            {/* 채널 관리 = 이 버튼 하나. 추가·순서·편집·삭제가 전부 그 창의 탭에 있다(로이 2026-09-16 통합). */}
            <button className="ghost" title="채널(프리셋) — 추가·순서·설정 편집·삭제" style={{ padding: '6px 9px' }} onClick={openChannelEditor}>⚙</button>
          <div className="findbar">
            <span title="화면에서 검색 (Ctrl+F) — 대본·문장·곡·원고 등 현재 화면의 글자를 찾아 이동">🔍</span>
            {/* 비제어 — 검색어를 App state 에 두면 글자마다 전 화면이 다시 그려져 입력이 멈춘다(대본수정과 같은 원인) */}
            <input id="find-input" defaultValue={findTextRef.current} placeholder="🔍 검색" title="화면에서 검색 — Enter 다음 · Shift+Enter 이전"
              onChange={(e) => runFind(e.target.value, false)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runFind(findTextRef.current, true, !e.shiftKey); } else if (e.key === 'Escape') { e.preventDefault(); clearFind(); } }} />
            <span className="fcnt">{findRes.total ? `${findRes.active}/${findRes.total}` : ''}</span>
            <button className="ghost" title="이전 (Shift+Enter)" onClick={() => runFind(findTextRef.current, true, false)}>▲</button>
            <button className="ghost" title="다음 (Enter)" onClick={() => runFind(findTextRef.current, true, true)}>▼</button>
            <button className="ghost" title="검색어 지우기 (Esc)" onClick={clearFind}>✕</button>
          </div>
            <button className="ghost" title="통합 설정 — ComfyUI 이미지·비디오 연결/워크플로 · API 키(제미나이·나노바나나·Grok) · TTS 서버 주소 · 계정"
              style={{ padding: '6px 9px' }} onClick={() => openSettings(settingsTabForEngine())}>⚙ 설정</button>
            {isBk && (<>
              <button onClick={openBook}>📖 원고 열기</button>
              <button className="ghost" title="원고를 어떻게 작성하는지 규약 설명이 담긴 샘플 .md 저장 — 복사해서 내용만 바꾸면 바로 책이 됩니다" onClick={async () => { try { const r = await api.bookSaveGuide(); if (r) setStatus('가이드 저장: ' + r.path); } catch (e) { logline(e.message); } }}>📄 작성 가이드</button>
              <button className="ghost" disabled={!loaded} title="원고 내용 수정 → 재파싱(원본 .md 갱신)" onClick={openScriptEdit}>✏ 수정</button>
              <button className="ghost" title="새 작업 — 현재 화면 비우기" onClick={resetProject}>🆕 초기화</button>
            </>)}
          {!isBk && (
            <button className="ghost reset-btn" title="새 작업 — 현재 화면 비우기 (작업물은 자동저장돼 있어 대본을 다시 열면 이어집니다)" onClick={resetProject}>🆕 초기화</button>
          )}
          {!noProduction && (<>
            {(() => { const qc = (queue && queue.longform ? queue.longform.items.length : 0); return (<>
              <button className="cta" disabled={qc < 1} title={`${qc > 1 ? `큐 ${qc}개 대본을 순서대로` : '이 대본을'} 음성 → 이미지 → 비디오 → 「④ 완성」에서 고른 형태(.vrew / ✏ 화이트보드 MP4 / 🎬 유튜브 MP4)까지 만듭니다. 이미 만든 것은 건너뜁니다(이어받기) — 음성·이미지가 다 있으면 .vrew·MP4 만 다시 나옵니다.`} onClick={runMakeOrBatch}>⚡ 만들기{qc > 1 ? ` (${qc})` : ''}</button>
              {qc > 1 && <label className="chk" title="체크: 대본이 완료될 때마다 그 .vrew 를 순차적으로 자동 열기(단건과 동일). 해제: 창 폭주 방지를 위해 열지 않고 큐가 끝나면 출력폴더만 1번 열기" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" style={{ width: 'auto' }} checked={openEachVrew} onChange={(e) => setOpenEachVrew(e.target.checked)} />순차 열기</label>}
            </>); })()}
            <button className="ghost stop" title="진행 중인 작업 중단" onClick={abort}>■ 중단</button>
          </>)}
        </div>
        {!noProduction && (
          <div className="ribbon" data-testid="ribbon" data-menu-on={menu}>
            {menu === 'script' && (<>
          <span className="hgroup">
            <span className="glabel">① 대본·음성</span>
            <button onClick={openScript}><span className="rb-ic">📂</span> <span className="rb-t">열기</span></button>
            {/* ✏ 수정 버튼은 없앴다 — 문장을 클릭해 화면에서 바로 고친다(Enter 나누기 · Backspace/Del 합치기).
                화면에서 못 고치는 예외(지침 줄을 사이에 둔 문장·표)는 그때 편집창을 열어 준다. */}
            <button className="ghost" title="음성·영상 파일을 텍스트로 변환(STT) → 원본과 같은 폴더에 같은 이름 .txt 생성 (OmniVoice Whisper)" onClick={runStt}><span className="rb-ic">🎧</span> <span className="rb-t">STT</span></button>
            <button className="ghost" title="영상에서 오디오만 뽑아 mp3 저장 → 원본과 같은 폴더에 같은 이름 .mp3 (192kbps · Whisper 서버 불필요)" onClick={runExtractMp3}><span className="rb-ic">🎵</span> <span className="rb-t">mp3</span></button>
            <button className="ghost" disabled={urlBusy} title="유튜브·비메오·틱톡·인스타 주소에서 mp3(또는 영상)를 받아 바로 전사합니다 — 자막이 있으면 STT 없이 자막을 씁니다" onClick={openUrlDl}><span className="rb-ic">🔗</span> <span className="rb-t">URL</span></button>
            <span className="hdiv" />
            {/* 「저장·불러오기」 버튼들(작업저장·작업열기·큐저장·큐열기·전체삭제)은 화면에서만 뺐다 (2026-09-16).
                근거: ~/.priming-maker/saves 가 0개 = 한 번도 쓴 적이 없다. 작업물은 자동저장이 늘 이어받는다
                (대본마다 projects/<대본>.smproj.json + 큐 구성 workspace.json → 대본을 다시 열면 그대로 이어짐).
                ⚠ 기능은 그대로다 — IPC 5개와 렌더러 함수 5개 무수정. 되살리려면 옛 hgroup 블록을 되돌리면 된다. */}
            {/* 🆕 초기화는 상단 첫 줄 끝으로 옮겼다(로이 2026-09-24 — 눈에 잘 띄게, 남은 폭을 꽉 채워서).
                대본 + 음성을 **한 섹션으로** 합쳤다 (로이 2026-09-16) — 대본을 열고 바로 음성을 만드는 한 호흡이다.
                그래서 이미지·비디오·완성의 번호가 다시 한 칸씩 당겨졌다(②③④). */}
            <span title="음성 배속 (합성 1.0 → atempo 변환)">배속 <input type="number" value={ttsSpeed} step="0.05" min="0.5" max="2" style={{ width: 52 }} onChange={(e) => setTtsSpeed(e.target.value)} /></span>
            <button disabled={!loaded} title="상단 버튼 = 작업큐의 모든 대본 음성 합성 (이미 있는 문장은 건너뜀)" onClick={() => runStageQueue('tts')}><span className="rb-ic">🎤</span> <span className="rb-t">TTS</span></button>
            <button className="ghost" disabled={!loaded} title="이미 만든 음성 파일·재활용 캐시를 삭제하고 화면의 시간기록도 지웁니다 (다음 변환은 전부 새로 합성)" onClick={deleteTtsAll}><span className="rb-ic">🗑</span> <span className="rb-t">삭제</span></button>
            <button className="ghost" title="발음사전 — TTS가 잘못 읽는 단어를 발음대로 교정(자막은 대본 그대로)" onClick={openDict}><span className="rb-ic">📖</span> <span className="rb-t">발음사전</span></button>
          </span>
              <span className="hgroup rb-extra">
        <label className="chk" title="무엇을 넣어 .vrew 를 만들지 정합니다.&#10;· 전체 — 음성 + 화면 (기본)&#10;· 🎤 음성만 — 이미지·비디오를 만들지 않습니다(그 단계를 건너뜁니다)&#10;· 🖼 화면만 — 음성을 만들지 않습니다(TTS 단계를 건너뛰고, 음성 자리는 무음). Vrew 에서 AI 목소리를 입힌 뒤 「📥 Vrew 음성」으로 되가져오세요."
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          출력
          <select style={{ width: 'auto' }} value={outMode} onChange={(e) => setOutMode(e.target.value)}>
            <option value="full">전체</option>
            <option value="audio">🎤 음성만</option>
            <option value="visual">🖼 화면만</option>
          </select>
        </label>
        <button className="ghost" disabled={!loaded}
          title="Vrew 에서 AI 목소리를 입혀 저장한 .vrew 를 골라, 그 음성만 이 대본에 물려줍니다.&#10;(.vrew 는 읽기만 하고 고치지 않습니다. 자막이 대본과 맞지 않으면 아무것도 바꾸지 않고 멈춥니다.)"
          onClick={runImportVrewAudio}><span className="rb-ic">📥</span> <span className="rb-t">Vrew 음성</span></button>
        <button className="ghost" disabled={!loaded} data-testid="relink-work"
          title="출력 폴더에 파일은 남아 있는데 화면에 그림·영상·음성이 비어 있을 때 — 다시 연결합니다.&#10;(그림·영상 = 그룹 번호 · 음성 = 출력 폴더 .vrew 의 자막 글자로 맞춤 · 이미 연결된 것은 그대로)"
          onClick={runRelinkWork}><span className="rb-ic">🔗</span> <span className="rb-t">다시 연결</span></button>
              </span>
              {splitBar}
            </>)}
            {menu === 'image' && (<>
          <span className="hgroup">
            <span className="glabel">② 이미지</span>
            <button className="ghost" disabled={!loaded || impBusy} title="각 그룹 내용을 분석해 이미지 프롬프트를 자동 작성·적용 (Ollama)" onClick={runMakePrompts}>{impBusy ? '⏳ 작성중…' : '✍ 프롬프트'}</button>
            <button className="ghost" disabled={!loaded} title="Ollama 서버·모델 설정 / 웹 LLM 답변 붙여넣기(고급)" onClick={openOllama}>⚙</button>
            <select title="이미지 스타일" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
              <option value="">스타일 없음</option>
              {styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="ghost" title="이미지 스타일 편집(추가·수정·삭제·프롬프트 복사) — 목록은 다른 PC 와 공유됩니다" onClick={openStyleEditor}>✎</button>
            <select title="이미지 생성 방식 — Flow·Genspark(브라우저 · 각 서비스 구독 요금제. 한도면 서로 이어받고, 한도 재설정 시각이 지나면 같은 대본 도중에도 원래 엔진으로 되돌아옵니다) / 나노바나나2(API 사용량 과금) / ComfyUI 로컬·클라우드 × 모델(Krea2·Z-Image)"
              value={comfySelectValue(imgEngine, comfyCfg)}
              onChange={(e) => onPickImgEngine(e.target.value)}>
              <option value="flow">Flow (구독)</option>
              <option value="genspark">Genspark (구독)</option>
              <option value="gemini">유료(나노바나나2)</option>
              <ComfyEngineOptions cfg={comfyCfg} value={comfySelectValue(imgEngine, comfyCfg)} />
            </select>
            {/* ⚙ 는 없앴다 (로이 2026-09-16) — 첫 줄의 「⚙ 설정」과 **같은 팝업**이었다.
                대신 그 버튼이 지금 고른 엔진에 맞는 탭을 연다(settingsTabForEngine). */}
            <button disabled={!loaded} title="상단 버튼 = 작업큐의 모든 대본 이미지 생성 (이미 있는 그룹은 건너뜀)" onClick={() => runStageQueue('image')}><span className="rb-ic">🖼</span> <span className="rb-t">이미지</span></button>
            <button className="ghost" disabled={!loaded} title="이미 만든 이미지 파일·재활용 캐시를 삭제합니다 (비디오는 유지 · 다음 생성은 전부 새로 만듭니다)" onClick={deleteImagesAll}><span className="rb-ic">🗑</span> <span className="rb-t">삭제</span></button>
            {imgEngine === 'gemini' && (<>
              <button className="ghost" disabled={!loaded} title="나노바나나2 Lite 배치 제출 — 표준가의 50%로 이미지 생성을 예약합니다. 결과는 몇 시간 뒤(최대 24h)에 나오며 「📥 배치회수」로 가져옵니다. 앱을 껐다 켜도 유지됩니다." onClick={submitBatch}><span className="rb-ic">🌙</span> <span className="rb-t">배치제출</span></button>
              <button className="ghost" disabled={!loaded} title="제출한 배치 결과를 회수합니다. 완료됐으면 이미지를 가져와 매핑, 아직이면 진행 상태를 알려줍니다." onClick={retrieveBatch}>📥 배치회수{gsBatch && gsBatch.hasJob ? ' ●' : ''}</button>
            </>)}
          </span>
            </>)}
            {menu === 'video' && (<>
          <span className="hgroup">
            <span className="glabel">③ 비디오</span>
            <select title="i2v 비디오 엔진 — ComfyUI 로컬/클라우드 × 모델(LTX2.5·LTX2.3)" value={comfySelectValue(videoEngine, cvidCfg)} onChange={(e) => onPickVideoEngine(e.target.value)}>
              <option value="grok">Grok (브라우저)</option>
              <option value="flow">Flow · Veo (구독)</option>
                <option value="genspark">Genspark (구독)</option>
              <option value="grok-api">Grok API (유료)</option>
              <ComfyEngineOptions cfg={cvidCfg} kind="video" value={comfySelectValue(videoEngine, cvidCfg)} />
              <option value="none">없음 (이미지만)</option>
            </select>
            {videoEngine === 'grok' && <button className="ghost" title="Grok(X) 멀티계정 등록·로그인·한도" onClick={() => openSettings('acct')}><span className="rb-ic">⚙</span> <span className="rb-t">계정</span></button>}
            {videoEngine === 'grok-api' && <button className="ghost" title="xAI API 키 입력 (console.x.ai) — 사용량 과금" onClick={() => openSettings('keys')}><span className="rb-ic">⚙</span> <span className="rb-t">키</span></button>}
            {videoEngine === 'flow' && <button className="ghost" title="Flow 비디오 모델(Veo) · 계정 — 그룹 이미지를 시작 프레임으로 i2v. 생성당 크레딧을 씁니다" onClick={() => openSettings('free')}><span className="rb-ic">⚙</span> <span className="rb-t">Veo</span></button>}
            {videoEngine === 'genspark' && (
              <select style={{ maxWidth: 190 }} value={gsVideoModel}
                title={`Genspark 비디오 모델 — 이 모델로 비디오를 만듭니다 (⚙ 설정의 값과 같은 것). ${((GS_VIDEO_MODELS.find((m) => m.name === gsVideoModel) || {}).note) || ''}`}
                onChange={(e) => saveImgRot({ ...(imgRot || {}), gensparkVideoModel: e.target.value })}>
                {GS_VIDEO_MODELS.map((m) => <option key={m.name} value={m.name} title={m.note}>{m.imgRef === false ? '❌ ' : ''}{m.name}</option>)}
              </select>
            )}
            {videoEngine === 'none'
              ? <span className="meta" title="비디오 없이 이미지만으로 .vrew 생성 (켄번스)">이미지만(켄번스)</span>
              : (<>
                  <span title="영상으로 만들 그룹 범위 (N번~N번). 롱폼 기본=도입부 그룹만">범위 <input type="number" min="1" style={{ width: 44 }} value={vidFrom} onChange={(e) => setVidFrom(e.target.value)} />~<input type="number" min="1" style={{ width: 44 }} value={vidTo} onChange={(e) => setVidTo(e.target.value)} /></span>
                  <button disabled={!loaded} title={`상단 버튼 = 작업큐의 모든 대본 G${vidFrom}~G${vidTo} 그룹을 i2v 비디오로 변환`} onClick={() => runStageQueue('video')}><span className="rb-ic">🎬</span> <span className="rb-t">비디오</span></button>
                  <button disabled={!loaded} title="작업큐 전체 — 모든 대본의 이미지를 먼저 다 만든 뒤, 모든 대본의 비디오 (모델 스왑 1번으로 콜드스타트 최소화)" onClick={() => runStageQueue('imgvid')}><span className="rb-ic">🖼→🎬</span> <span className="rb-t">이미지+비디오</span></button>
                </>)}
            <button className="ghost" disabled={!loaded} title="이미 만든 비디오 파일·재활용 캐시를 삭제합니다 (이미지는 유지 → 켄번스로 진행 가능)" onClick={deleteVideosAll}><span className="rb-ic">🗑</span> <span className="rb-t">삭제</span></button>
          </span>
            </>)}
            {menu === 'finish' && (<>
          <span className="hgroup">
            <span className="glabel">④ 완성</span>
            <select title="완성물 종류 — .vrew(Vrew 에서 마무리) 또는 ✏ 화이트보드 MP4(손그림 애니메이션 · 이미지가 종이 위에 그려지듯 드러남). 화이트보드는 음성·자막까지 얹혀 그대로 올릴 수 있습니다." value={outTarget} onChange={(e) => setOutTarget(e.target.value)}>
              <option value="vrew">.vrew (Vrew)</option>
              <option value="whiteboard">✏ 화이트보드 MP4</option>
              <option value="mp4">🎬 유튜브 MP4</option>
            </select>
            {outTarget === 'whiteboard' && (<>
              <select title="출력 긴변(px) — 렌더 시간은 픽셀 수에 비례합니다. 1920 은 22분 편에 약 30분. 확인·튜닝 중엔 1080·640 으로 낮춰 돌리세요." value={String((wbCfg && wbCfg.capLongEdge) || 1920)} onChange={(e) => saveWbCfg({ capLongEdge: parseInt(e.target.value, 10) })}>
                <option value="1920">1920 (최종)</option>
                <option value="1080">1080 (빠름)</option>
                <option value="640">640 (시험)</option>
              </select>
              <label className="chk" title="자막을 영상에 굽습니다(하드번) — 화이트보드는 Vrew 를 거치지 않는 최종물이라 굽지 않으면 화면에 글자가 안 보입니다. ⚠ 구우면 영상을 다시 인코딩하므로 길이에 비례해 몇 분 더 걸립니다. 꺼도 .srt 파일은 옆에 남습니다." style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={!wbCfg || wbCfg.subtitle !== false} onChange={(e) => saveWbCfg({ subtitle: e.target.checked })} />💬 자막
              </label>
              <button className="ghost" disabled={!loaded} title="관문 A — 장면 계획만 봅니다(그룹→장면 · 영역 수 · 예상 렌더 시간). 파이썬을 부르지 않아 즉시 뜹니다." onClick={showWhiteboardPlan}><span className="rb-ic">📋</span> <span className="rb-t">장면 계획</span></button>
            </>)}
            <span className="hdiv" />
            <button className="ghost" disabled={!loaded} title="대본 내용만 깔끔하게 읽기 — 문장을 눌러 바로 고치고, A4 PDF(한 장에 1·2·4·6·9쪽)로 뽑습니다" onClick={() => setReaderOpen(true)}><span className="rb-ic">📄</span> <span className="rb-t">대본 보기</span></button>
            {/* ▶ 미리보기는 대본 카드 아래 버튼 줄에 있다 — ④ 완성의 중복 버튼은 뺐다(로이 2026-09-25) */}
            {outTarget === 'mp4' && <button className="ghost" disabled={!loaded} title="이 대본의 🎬 유튜브 MP4 를 채널에 비공개로 올립니다(자동 업로드를 끈 채널 · 실패 뒤 다시). 채널은 ⚙ 채널편집 → 📁 폴더 → ⬆ 자동 업로드에서 고릅니다." onClick={runYtUpload}><span className="rb-ic">⬆</span> <span className="rb-t">업로드</span></button>}
            <button className="ghost" disabled={!loaded} onClick={() => api.openFolder()}><span className="rb-ic">📁</span> <span className="rb-t">출력폴더</span></button>
          </span>
              <span className="hgroup rb-extra" id="capbar">
        <button className="ghost" disabled={!loaded || prog.ttsD === 0}
          title="유튜브 설명글에 넣을 챕터 타임스탬프 — 각 그룹의 TTS 길이를 누적해 만듭니다(상위 H2 섹션 = 챕터 1개). TTS 변환을 끝낸 뒤 누르세요."
          onClick={openTimestamps}><span className="rb-ic">⏱</span> <span className="rb-t">타임스탬프</span></button>
        <label className="chk" title="AI 고지 자막 — 체크 시 .vrew 에 삽입 (기본 표시 · 언제든 변경 가능)" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" style={{ width: 'auto' }} checked={aiNotice} onChange={(e) => setAiNotice(e.target.checked)} />AI 고지</label>
              </span>
            </>)}
            {menu === 'insert' && (
              <span className="hgroup" data-testid="ins-ribbon">
                <span className="glabel">➕ 삽입</span>
                <button className="ghost" data-testid="ins-image" disabled={!loaded || !isLf} title="그림 삽입 — 정한 클립 범위 동안 모든 그림·영상 위층에(인물 사진·지도·글 카드 등). 배경 투명 PNG 도 됩니다." onClick={(e) => insertMedia('image', e)}><span className="rb-ic">🖼</span> <span className="rb-t">이미지</span></button>
                <button className="ghost" data-testid="ins-video" disabled={!loaded || !isLf} title="영상 삽입 — 정한 클립 범위 동안 위층에서 반복 재생" onClick={(e) => insertMedia('video', e)}><span className="rb-ic">🎬</span> <span className="rb-t">비디오</span></button>
                <button className="ghost" data-testid="ins-audio" disabled={!loaded || !isLf} title="오디오 삽입 — 정한 클립 범위 동안 음악·효과음(반복 · 앞뒤 부드럽게). 영상 전체 배경음악은 ⚙ 채널편집 → 📁 폴더 → 🎵 배경음악" onClick={(e) => insertMedia('audio', e)}><span className="rb-ic">🎵</span> <span className="rb-t">오디오</span></button>
                <span className="hdiv" />
                <span className="ins-logo" data-testid="ins-bgm" title={`🎵 채널 배경음악 — 채널 「${presetName || ''}」의 모든 영상 전체에 낮게 깝니다(폴더면 대본마다 한 곡). 구간만 넣으려면 🎵 오디오`}>
                  <label className="chk"><input type="checkbox" data-testid="bgm-on" checked={!!bgmCfg.on} disabled={!presetName} onChange={(e) => (e.target.checked && !bgmCfg.path ? pickBgm(false) : saveBgm({ on: e.target.checked }))} />🎵 배경음악</label>
                  <button className="ghost" data-testid="bgm-file" disabled={!presetName} title={bgmCfg.path || '음악 파일 고르기'} onClick={() => pickBgm(false)}>{bgmCfg.path ? String(bgmCfg.path).split(/[\\/]/).pop() : '파일…'}</button>
                  <button className="ghost" data-testid="bgm-dir" disabled={!presetName} title="폴더 — 대본마다 그 안의 한 곡" onClick={() => pickBgm(true)}>폴더</button>
                  <input className="nbox" data-testid="bgm-vol" type="number" min="0" max="100" step="5" disabled={!bgmCfg.on} value={bgmCfg.volume} title="음량 % (기본 15)" onChange={(e) => saveBgm({ volume: e.target.value })} /><span className="meta">%</span>
                </span>
                <span className="hdiv" />
                <span className="ins-logo" data-testid="ins-logo" title={stageLogo ? '🏷 이 대본의 로고 자리 — 로고 그림·크기·켜기는 ⚙ 채널편집 → 📁 폴더' : '이 채널은 로고가 꺼져 있습니다 — ⚙ 채널편집 → 📁 폴더 → 🏷 채널 로고'}>
                  <span className="meta">🏷 로고 위치</span>
                  <select data-testid="logo-side" disabled={!loaded || !isLf} value={curLogoSide()} onChange={(e) => setLogoSide(e.target.value)}>
                    <option value="right">↗ 오른쪽 위</option><option value="left">↖ 왼쪽 위</option></select>
                  {!stageLogo && <span className="meta" data-testid="logo-off">(이 채널 로고 꺼짐)</span>}
                </span>
              </span>
            )}
            {menu === 'format' && (
              <CaptionToolbar fmt={capSelFmt()} pos={capSelPos()} active={!!capSel} label={capSelLabel()} panel={capSel ? capPanel : null}
                onPatch={applyCapFmt} onClear={() => clearCapFmt(null)} onApplyAll={applyCapFmtAll}
                onPanel={(p) => setCapPanel((cur) => (cur === p ? null : p))}
                onDone={() => { setCapSel(null); setCapPanel(null); }}
                onSaveDefault={saveCapDefault} />
            )}
          </div>
        )}
      </header>
      </div>
      {/* 🧭 가로 3칸(Vrew) — ① 영상·이미지(커서 줄 자막) ② 자막 클립 목록 ③ 자세한 설정(열릴 때만) */}
      <div id="body" className={wsOn ? 'ws' : ''}>
        {wsOn && (<>
          <section className="pane1" data-testid="pane1" style={{ width: (pane1W * 100).toFixed(1) + '%' }}>
            {stageEl}
            {clipInfo}
            {logBox}
          </section>
          <div className="pane-split" data-testid="pane-split" title="끌어서 폭 조절" onMouseDown={startPaneDrag} />
        </>)}
        <main className={wsOn ? 'pane2' : ''}>
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
          {insMenu && (() => {
        const pj = dto && dto.projects ? dto.projects.find((x) => x.shortsNum === insMenu.sn) : null;
        const o = pj && (pj.overlays || []).find((x) => x.id === insMenu.id);
        if (!o) return null;
        const n = o.total || 1, cur = curOrd(insMenu.sn);
        const go = (fn) => () => { setInsMenu(null); fn(); };
        return (<>
          <div className="vr-menu-bg" onMouseDown={() => setInsMenu(null)} />
          <div className="vr-menu" data-testid="ins-menu" style={{ left: Math.min(insMenu.x, window.innerWidth - 260), top: Math.min(insMenu.y, window.innerHeight - 260) }}>
            {/* 🔑 파일 이름은 앞 몇 글자만 — 긴 이름이 메뉴 폭을 늘렸다(로이 2026-09-25) · 전체 이름은 툴팁 */}
            <div className="vr-cur" title={o.name || ''}>{o.kind === 'audio' ? '🎵' : o.kind === 'video' ? '🎬' : '🖼'} {shortName(o.name)} — 지금: {o.from === 1 && o.to === n ? '전체' : `클립 ${o.from}~${o.to}`}{o.once ? ' · 1회' : ''} · 현재 클립 {cur}</div>
            <button onClick={go(() => insRange(insMenu.sn, o.id, 1, n))}>전체 클립으로</button>
            <button onClick={go(() => insRange(insMenu.sn, o.id, 1, cur))}>처음부터 현재 클립까지</button>
            <button onClick={go(() => insRange(insMenu.sn, o.id, cur, n))}>현재 클립부터 끝까지</button>
            {(o.kind === 'audio' || o.kind === 'video') && (
              <button data-testid="ins-once" title={`시작 클립(${o.from})부터 ${o.kind === 'video' ? '영상' : '오디오'} 길이만큼만 — 한 번 재생하고 멈춥니다(반복 안 함)`}
                onClick={go(() => insOnce(insMenu.sn, o.id))}>{o.once ? '✓ ' : ''}{o.kind === 'video' ? '영상(소리) 1회 재생까지' : '오디오 1회 재생까지'}</button>
            )}
            <button onClick={go(() => insRange(insMenu.sn, o.id, null, null, { n, cur: `${o.from}-${o.to}` }))}>직접 입력…</button>
            <div className="vr-sep" />
            <button className="vr-del" data-testid="ins-del" onClick={go(async () => { const r = await overlayOp({ shortsNum: insMenu.sn, op: 'remove', id: o.id }); if (r && r.ok) setStatus(`🗑 「${o.name || '삽입'}」을 지웠습니다 (Ctrl+Z 되돌리기)`); })}>🗑 삭제</button>
          </div>
        </>);
      })()}
      {/* ② 위 얇은 막대 — 진행 통계 + 보기 전환(Vrew 「개요/상세」 자리) */}
          <div className="clipbar" data-testid="clipbar">
            {workTimes}
            <span className="grow" />
            <span className="seg" title="되돌리기 Ctrl+Z · 다시 하기 Ctrl+Y — 문장 고치기·클립 합치기·자막 서식·그림 적용 범위·그룹 합치기/분할">
              <button data-testid="undo-btn" disabled={!loaded} onClick={() => runUndo(false)}>↶</button>
              <button data-testid="redo-btn" disabled={!loaded} onClick={() => runUndo(true)}>↷</button>
            </span>
            {view === 'clips' && (
              <span className="seg" title="개요 = 줄만 촘촘히 · 상세 = 클립마다 화자·시각 + 어절 칩(누르면 그 단어만 서식)">
                <button className={!clipDetail ? 'on' : ''} data-detail="0" onClick={() => pickClipDetail(false)}>개요</button>
                <button className={clipDetail ? 'on' : ''} data-detail="1" onClick={() => pickClipDetail(true)}>상세</button>
              </span>
            )}
            <span className="seg" title="보기 — 클립(Vrew 식 3칸) / 카드(옛 3열 그룹 카드)">
              <button className={view === 'clips' ? 'on' : ''} data-view="clips" onClick={() => { if (playerOpen) stopPlayer(); pickView('clips'); }}>클립</button>
              <button className={view === 'cards' ? 'on' : ''} data-view="cards" onClick={() => { if (playerOpen) stopPlayer(); pickView('cards'); }}>카드</button>
            </span>
          </div>
          {isLf && dto && dto.projects && dto.projects.some((pj) => (pj.overlays || []).length) && (
            <div className="ovbar" data-testid="ovbar">
              {dto.projects.map((pj) => (pj.overlays || []).map((o, i, arr) => (
                <span key={o.id} className={'ovchip' + (o.broken ? ' broken' : '')} data-testid="ovchip" title={o.file}>
                  {o.kind === 'video' ? '🎬' : o.kind === 'audio' ? '🎵' : '🖼'} <b title={o.name || ''}>{shortName(o.name || String(o.file || '').split(/[\/]/).pop())}</b>{o.once ? <span className="meta"> · 1회</span> : null}
                  <button className="ghost" data-testid="ov-range" title="적용 범위 변경 · 삭제" onClick={(e) => openInsMenu(pj.shortsNum, o.id, e.currentTarget)}>
                    {o.broken ? '범위 잃음' : (o.from === 1 && o.to === o.total ? '전체' : `클립 ${o.from}~${o.to}`)} ▾</button>
                  {(o.kind === 'audio' || o.kind === 'video') && <><span className="meta">{o.kind === 'video' ? '🔊' : ''}</span><input className="nbox" data-testid="ov-vol" type="number" min="0" max="200" step="5" style={{ width: 44 }} title={o.kind === 'video' ? '영상 소리 음량 % (0 = 소리 끔)' : '음량 %'} value={o.volume}
                    onChange={(e) => overlayOp({ shortsNum: pj.shortsNum, op: 'vol', id: o.id, volume: e.target.value })} /><span className="meta">%</span></>}
                  {o.box && o.kind !== 'audio' && <button className="ghost" title="화면 가득으로(자리·크기 원래대로)" onClick={() => overlayOp({ shortsNum: pj.shortsNum, op: 'box', id: o.id, box: null })}>⛶</button>}
                  {arr.length > 1 && <button className="ghost" title="한 층 위로(그림·영상)" disabled={i === arr.length - 1} onClick={() => overlayOp({ shortsNum: pj.shortsNum, op: 'order', id: o.id, dir: 'up' })}>▲</button>}
                  {arr.length > 1 && <button className="ghost" title="한 층 아래로" disabled={i === 0} onClick={() => overlayOp({ shortsNum: pj.shortsNum, op: 'order', id: o.id, dir: 'down' })}>▼</button>}
                  <button className="ghost" title="삭제(파일은 남습니다 · Ctrl+Z 되돌리기)" data-testid="ov-del" onClick={() => overlayOp({ shortsNum: pj.shortsNum, op: 'remove', id: o.id })}>🗑</button>
                </span>
              )))}
            </div>
          )}
          <ErrorBoundary><Cards dto={dto} isLf={isLf} capCharsN={effCap} layout={view} detail={view === 'clips' && clipDetail} linesMap={linesMap}
            cursor={cursor} onCursor={(sn, n) => setCursor({ shortsNum: sn, n })}
            capBase={capBase} capSel={capSel} onPickCapLine={pickCapLine} onPickCapChars={pickCapChars}
            onTts={runTts} onImg={runImg} onVid={runVid} onImgVid={runImgVid} onBulk={runBulk}
            onPlayShorts={playShorts} onPlayGroup={playGroup} onRegen={runRegen}
            onMake={runMake} onPremiere={runPremiere} onAttach={attachAsset} onClear={clearAsset}
            onPreview={(kind, src) => setPreview({ kind, src })}
            onPlayFrom={playFrom} onGroupTts={runGroupTts} onGroupVid={runGroupVid} onShowPrompt={showPrompt} onSplit={splitGroup} onMerge={mergeGroup} onRange={isLf ? setVisualRange : null} onLook={isLf ? setGroupLook : null} aiNotice={isLf && aiNotice} onAiRange={isLf ? setAiRange : null} onInsMark={isLf ? openInsMenu : null} onInsRange={isLf ? insRange : null} playing={playerOpen ? { key: playKey } : null}
            edit={{
              cur: sentEdit, ref: sentEditRef, busy: sentBusy,
              start: startSentEdit, commit: commitSentEdit, cancel: cancelSentEdit,
              splitAt: splitSentAtCursor, mergeUp: mergeSentUp, mergeNext: mergeSentNext,
              note: setStatus, lineKey: lineEditKey, navOut: navOutOfSentence, fmtClip,
              across: (d) => { const e = sentEdit; if (!e) return; mergeAcross(d, d === 'prev' ? String(prevCutLastText(e) || '').replace(/[.!?。]+\s*$/, '') + ' ' + sentEditValue('').trim() : sentEditValue('').replace(/[.!?。]+\s*$/, '').trim() + ' ' + String(nextCutFirstText(e) || '').trim()); },
            }} /></ErrorBoundary>
          </>)}
        </main>
        {/* ③ 자세한 설정 — ⚙ 고급·✨ 효과를 열 때만(예전엔 화면 위에 떠 있는 창이었다) */}
        {capSel && capPanel && !noProduction && (
          <aside className="cf-side pane3" data-testid="cf-side">
            {capPanel === 'fmt'
              ? <CaptionFormatPanel value={capSelFmt()} onChange={applyCapFmt} title={capSelLabel() + ' 서식'} onClose={() => setCapPanel(null)} onReset={() => clearCapFmt(null)} />
              : <CaptionAnimPanel value={capSelFmt().anim} onChange={(a) => applyCapFmt({ anim: a })} title={capSelLabel() + ' 애니메이션'} onClose={() => setCapPanel(null)} onReset={() => clearCapFmt(['anim'])} />}
          </aside>
        )}
      </div>
      {!logDocked && logBox}

      {mediaLoad && (
        <div className="mload" data-testid="media-load">
          <div className="mload-card">
            <div className="mload-t"><span className="spin" /> 그림·영상을 불러오는 중… <b>{mediaLoad.done}/{mediaLoad.total}</b></div>
            <div className="mload-bar"><i style={{ width: (mediaLoad.total ? (mediaLoad.done / mediaLoad.total) * 100 : 0).toFixed(1) + '%' }} /></div>
            <div className="mload-d">이미지 {mediaLoad.img}/{mediaLoad.imgT} · 영상 {mediaLoad.vid}/{mediaLoad.vidT} · {mediaLoad.sec.toFixed(0)}초
              <span className="mload-h">구글 드라이브에서 받아 오는 중이라 처음 열 때 오래 걸립니다 — 작업은 그대로 할 수 있습니다</span></div>
            <button className="ghost" onClick={() => { mediaLoadHiddenRef.current = true; setMediaLoad(null); }}>숨기기</button>
          </div>
        </div>
      )}
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

      {/* 카드 보기·출판·리모션 — 미리보기 재생은 예전처럼 화면을 덮는 창(스테이지 DOM 은 하나 — 클립 보기에선 ① 칸 안에 있다) */}
      {!wsOn && (
        <div id="player" className={playerOpen ? 'show' : ''}>{stageEl}</div>
      )}

      {/* 🎨 채널 기본 자막 서식 — 채널 편집 창 위에 뜬다. 바꾸는 즉시 채널 편집 값(ch.capLong)에 들어가고, 채널 「저장」으로 저장된다 */}
      {capDlg && ch && ch[capDlg.key] && (() => {
        const key = capDlg.key;
        const val = { ...capLookOf(ch[key]), size: Number(ch[key].size) || 100 };
        const onChange = (p) => setCh((cur) => {
          const next = { ...cur[key], ...p };
          if (p.size != null) next.size = String(p.size);
          return { ...cur, [key]: next };
        });
        return (
          <div className="modal-bg show" style={{ zIndex: 95 }} data-testid="capdlg">
            <div className="modal-card cf-dlg">
              <div className="cf-dlgh"><h3>🎨 채널 기본 자막 서식</h3><span className="meta">이 채널의 모든 자막에 적용 · 줄마다 다르게 하려면 메인 화면에서 자막 줄 번호를 누르세요 · 「저장」을 눌러야 채널에 저장됩니다</span><button className="ghost" onClick={() => setCapDlg(null)}>닫기</button></div>
              <div className="cf-dlgb">
                <CaptionFormatPanel value={val} onChange={onChange} title="서식" />
                <CaptionAnimPanel value={val.anim} onChange={(a) => onChange({ anim: a })} title="애니메이션(모든 줄)" />
              </div>
            </div>
          </div>
        );
      })()}
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
              {[['list', '📋 채널'], ['basic', '🏠 기본'], ['voice', '🎙 음성'],
                ...(ch.startMode === 'remotion' ? [] : [['caption', '📝 자막·분할'], ['tools', '🖼 제작 도구']]),
                ['folder', '📁 폴더']].map(([id, lbl]) => (
                <button key={id} className={chTab === id ? '' : 'ghost'} style={{ padding: '5px 10px' }} onClick={() => setChTab(id)}>{lbl}</button>
              ))}
            </div>
            <div className="tabbody">

              {chTab === 'list' && (<div>
                <div className="meta" style={{ marginBottom: 8 }}>
                  <b>✎ = 지금 편집 중</b> · <b>★ = 헤더에서 고른 작업 채널</b>.
                  <b>▲▼</b> 로 순서를 바꾸면 <b>바로 저장</b>됩니다(헤더 드롭다운에 이 순서로 보입니다).
                  이름을 누르면 그 채널로 <b>편집 대상이 바뀝니다</b> —
                  <b style={{ color: 'var(--danger)' }}>저장하지 않은 변경은 사라집니다.</b>
                </div>
                <div style={{ maxHeight: 250, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 6 }}>
                  {(presets || []).map((p, i) => {
                    const editing = p.name === ((ch._raw && ch._raw.name) || ch.name);
                    return (
                      <div key={p.name} className="frow" style={{ gap: 6, alignItems: 'center', padding: '2px 0' }}>
                        <span className="meta" style={{ width: 24, textAlign: 'right', flex: '0 0 auto' }}>{i + 1}.</span>
                        {/* 🔑 테두리를 주면 입력칸처럼 보인다 — 목록은 글자만, 편집 중인 줄만 배경으로 드러낸다. */}
                        <button style={{ flex: 1, textAlign: 'left', padding: '4px 8px', cursor: editing ? 'default' : 'pointer',
                          border: 0, borderRadius: 6, fontSize: 13, color: 'var(--strong)',
                          background: editing ? '#f3ead9' : 'transparent',
                          fontWeight: editing ? 700 : 400 }}
                          title={editing ? '지금 편집 중인 채널입니다' : '이 채널 설정으로 바꿔 편집합니다'}
                          onClick={() => { if (!editing) openChannelEditor(p.name); }}>
                          {editing ? '✎ ' : ''}{p.name}{p.group ? <span className="meta"> · {p.group}</span> : null}
                          {p.name === presetName ? <span className="meta" title="헤더 드롭다운에서 선택된 작업 채널"> ★</span> : null}
                        </button>
                        <button className="ghost" style={{ flex: '0 0 auto', padding: '2px 8px' }} title="위로" disabled={i === 0} onClick={() => moveChannel(i, -1)}>▲</button>
                        <button className="ghost" style={{ flex: '0 0 auto', padding: '2px 8px' }} title="아래로" disabled={i === (presets || []).length - 1} onClick={() => moveChannel(i, 1)}>▼</button>
                      </div>
                    );
                  })}
                </div>
                <div className="subhead" style={{ marginTop: 12 }}>＋ 새 채널</div>
                <div className="meta" style={{ marginBottom: 6 }}>지금 편집 중인 <b>「{(ch._raw && ch._raw.name) || ch.name || '-'}」</b>의 설정을 복사해 만듭니다.</div>
                <div className="frow" style={{ gap: 6 }}>
                  <input style={{ flex: 1, padding: '6px 9px' }} placeholder="새 채널 이름"
                    value={newChanName} onChange={(e) => setNewChanName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') createChannel(); }} />
                  <button style={{ flex: '0 0 auto' }} onClick={createChannel}>만들기</button>
                </div>
              </div>)}

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
                  <button className="ghost" style={{ flex: '0 0 auto' }} title="미리듣기 / 멈춤" onClick={() => playRef(ch.voiceCloneRefAudio)}>{pvBtn('ref:' + ch.voiceCloneRefAudio)}</button>
                  <button className="ghost" style={{ flex: '0 0 auto' }} title="참조음성 폴더 열기 (같은 이름의 .txt 가 참조텍스트로 쓰입니다)" onClick={() => api.openRefFolder(ch.voiceCloneRefAudio || '')}>찾기</button>
                  <button className="ghost" style={{ flex: '0 0 auto' }} title="텍스트 설명으로 새 목소리 만들기 (Qwen3-TTS 보이스디자인)" onClick={openVoiceDesign}>🎨 디자인</button></div>
                <div className="frow"><label>사전설정</label><textarea rows="2" placeholder="예: 30대 한국 남성, 회색 양복, 따뜻한 조명 (모든 이미지 공통)" value={ch.presetPrompt} onChange={(e) => setCh({ ...ch, presetPrompt: e.target.value })} /></div>
                <div className="frow"><label>Clone강도</label><input className="nbox" type="number" step="0.1" value={ch.cfgValue} onChange={(e) => setCh({ ...ch, cfgValue: e.target.value })} />
                  <span className="mini" title="문장을 읽고 난 뒤 넣는 무음(초). 모델이 이미 문장마다 0.35초를 붙이므로 실제 문장 간격은 여기에 0.35초가 더해집니다. 배속과 무관하게 넣은 값 그대로 붙습니다. ⚠ 값을 바꾸면 그 채널 음성이 전량 다시 만들어집니다.">문장무음</span><input className="nbox" type="number" step="0.1" min="0" max="5" title="0 = 사용 안 함. 권장 0.5~1.5초." value={ch.silenceSec} onChange={(e) => setCh({ ...ch, silenceSec: e.target.value })} /><span className="meta">초</span></div>

                <div className="subhead" title="대본에서 줄 맨 앞에 [이름] 을 쓰면(예: [엄마] 얘야, 밥 먹어라.) 그 줄을 여기서 고른 목소리로 읽습니다. 자막에는 이름이 나오지 않습니다. 연결하지 않은 이름은 위의 채널 목소리로 읽습니다.">🎭 화자별 목소리 <span className="meta" style={{ fontWeight: 400 }}>— 대본 줄 맨 앞 [이름] 대사</span></div>
                <div style={{ maxHeight: 92, overflowY: 'auto' }}>
                  {(ch.speakers || []).map((r, i) => (
                    <div className="crow" key={i} style={{ gap: 6 }}>
                      <input style={{ flex: '0 0 90px', width: 90 }} placeholder="이름" value={r.name}
                        onChange={(e) => { const a = [...ch.speakers]; a[i] = { ...a[i], name: e.target.value }; setCh({ ...ch, speakers: a }); }} />
                      <select style={{ flex: 1, padding: 4 }} value={r.voice}
                        onChange={(e) => { const a = [...ch.speakers]; a[i] = { ...a[i], voice: e.target.value }; setCh({ ...ch, speakers: a }); }}>
                        {!r.voice ? <option value="">— 목소리 선택 —</option> : null}
                        {r.voice && chRefList.every((x) => x.path !== r.voice) ? <option value={r.voice}>{refLabel(r.voice)}</option> : null}
                        {chRefList.map((x) => <option key={x.path} value={x.path}>{x.name}</option>)}
                      </select>
                      <button className="ghost" style={{ flex: '0 0 auto' }} title="미리듣기 / 멈춤" disabled={!r.voice} onClick={() => playRef(r.voice)}>{pvBtn('ref:' + r.voice)}</button>
                      <button className="ghost" style={{ flex: '0 0 auto' }} title="이 화자 지우기" onClick={() => setCh({ ...ch, speakers: ch.speakers.filter((_, j) => j !== i) })}>✕</button>
                    </div>
                  ))}
                </div>
                <div className="crow"><button className="ghost" style={{ flex: '0 0 auto' }} onClick={() => setCh({ ...ch, speakers: [...(ch.speakers || []), { name: '', voice: '' }] })}>＋ 화자 추가</button></div>
                <div className="subhead">🔊 음성 배속</div>
                <div className="crow"><span className="l">배속</span><input className="n" style={{ flex: '0 0 62px', width: 62 }} type="number" step="0.05" min="0.5" max="2" value={ch.speedLong} onChange={(e) => setCh({ ...ch, speedLong: e.target.value })} /></div>
                <div className="subhead">🔊 음량 맞추기</div>
                <div className="crow">
                  <span className="l">문장마다 같은 음량으로</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={ch.ttsNormalize !== false}
                      onChange={(e) => setCh({ ...ch, ttsNormalize: e.target.checked })} />
                    <span className="meta">켜기</span>
                  </label>
                  <span className="meta" style={{ marginLeft: 10 }}>목표</span>
                  <input className="n" style={{ flex: '0 0 62px', width: 62 }} type="number" step="1" min="-30" max="-6"
                    disabled={ch.ttsNormalize === false}
                    value={ch.ttsTargetDb != null && ch.ttsTargetDb !== '' ? ch.ttsTargetDb : -15}
                    onChange={(e) => setCh({ ...ch, ttsTargetDb: e.target.value })} />
                  <span className="meta">dB</span>
                </div>
                <div className="meta" style={{ marginTop: 4, lineHeight: 1.5 }}>
                  문장마다 들쭉날쭉한 음량을 한 레벨로 맞춥니다. 짧은 문장·의문문이 작게 나오는 것과,
                  참조음성이 조용해 결과 전체가 작아지는 것을 함께 잡습니다.
                  ⚠ 바꾸면 그 채널 음성이 다음 변환 때 새로 만들어집니다.
                </div>
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
                    <div className="crow stack"><span className="l">이미지</span>
                      {/* 헤더와 같은 구조 — 로컬/클라우드 × 모델을 여기서 바로 고른다(2026-08-14) */}
                      <select value={comfySelectValue(ch.imgEngine || 'genspark', comfyCfg)}
                        onChange={(e) => { const c = parseComfyVal(e.target.value); setCh({ ...ch, imgEngine: c ? (c.path ? `comfy::${c.path}` : 'comfy') : e.target.value }); }}>
                        <option value="flow">Flow (구독)</option>
                        <option value="genspark">Genspark (구독)</option>
                        <option value="gemini">유료(나노바나나2)</option>
                        <ComfyEngineOptions cfg={comfyCfg} value={comfySelectValue(ch.imgEngine || 'genspark', comfyCfg)} />
                      </select></div>
                  </div>
                  <div className="col">
                    <div className="crow stack"><span className="l">비디오</span>
                      <select value={comfySelectValue(ch.videoEngine || 'grok', cvidCfg)}
                        onChange={(e) => { const c = parseComfyVal(e.target.value); setCh({ ...ch, videoEngine: c ? (c.path ? `comfy::${c.path}` : 'comfy') : e.target.value }); }}>
                        <ComfyEngineOptions cfg={cvidCfg} kind="video" value={comfySelectValue(ch.videoEngine || 'grok', cvidCfg)} />
                        <option value="grok">Grok (브라우저)</option>
                        <option value="flow">Flow · Veo (구독)</option>
                <option value="genspark">Genspark (구독)</option>
                        <option value="grok-api">Grok API (유료)</option>
                        <option value="none">없음(이미지 고정)</option>
                      </select></div>
                  </div>
                  <div className="col">
                    <div className="crow stack"><span className="l">출력</span>
                      <select value={normOutTargetUi(ch.outTarget)}
                        onChange={(e) => setCh({ ...ch, outTarget: e.target.value })}>
                        <option value="vrew">.vrew (Vrew)</option>
                        <option value="whiteboard">✏ 화이트보드 MP4</option>
                        <option value="mp4">🎬 유튜브 MP4</option>
                      </select></div>
                  </div>
                </div>
                {/* 💬 화이트보드 자막 — 굽는 자막의 모양. 켜고 끄는 스위치는 헤더 ④ 완성의 「💬 자막」이다. */}
                <div className="subhead">💬 화이트보드 자막 (구워 넣는 글자)</div>
                <div className="twocol">
                  <div className="col">
                    <div className="crow stack"><span className="l">글자 크기</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="number" min="1" max="20" step="0.1" style={{ width: 70 }}
                          value={(ch.wbSub && ch.wbSub.sizePct) != null ? ch.wbSub.sizePct : WB_SUB_DEFAULT.sizePct}
                          onChange={(e) => setCh({ ...ch, wbSub: { ...(ch.wbSub || WB_SUB_DEFAULT), sizePct: e.target.value } })} />
                        <span className="meta">% (1080 기준 {Math.round(1080 * (Number((ch.wbSub && ch.wbSub.sizePct) ?? WB_SUB_DEFAULT.sizePct) || WB_SUB_DEFAULT.sizePct) / 100)}px)</span>
                      </span></div>
                    <div className="crow stack"><span className="l">가장자리 여백</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="number" min="0" max="45" step="0.5" style={{ width: 70 }}
                          value={(ch.wbSub && ch.wbSub.marginPct) != null ? ch.wbSub.marginPct : WB_SUB_DEFAULT.marginPct}
                          onChange={(e) => setCh({ ...ch, wbSub: { ...(ch.wbSub || WB_SUB_DEFAULT), marginPct: e.target.value } })} />
                        <span className="meta">% (가운데일 땐 무시)</span>
                      </span></div>
                  </div>
                  <div className="col">
                    <div className="crow stack"><span className="l">위치</span>
                      <select value={(ch.wbSub && ch.wbSub.pos) || WB_SUB_DEFAULT.pos}
                        onChange={(e) => setCh({ ...ch, wbSub: { ...(ch.wbSub || WB_SUB_DEFAULT), pos: e.target.value } })}>
                        {WB_SUB_POS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select></div>
                    <div className="crow stack"><span className="l">폰트</span>
                      <select value={(ch.wbSub && ch.wbSub.font) || WB_SUB_DEFAULT.font}
                        onChange={(e) => setCh({ ...ch, wbSub: { ...(ch.wbSub || WB_SUB_DEFAULT), font: e.target.value } })}>
                        {WB_SUB_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select></div>
                  </div>
                  <div className="col">
                    <div className="crow stack"><span className="l">굵게</span>
                      <input type="checkbox" style={{ width: 'auto' }} checked={!(ch.wbSub && ch.wbSub.bold === false)}
                        onChange={(e) => setCh({ ...ch, wbSub: { ...(ch.wbSub || WB_SUB_DEFAULT), bold: e.target.checked } })} /></div>
                  </div>
                </div>
                <div className="meta">글자는 <b>검정 + 흰 외곽선</b>입니다(화이트보드 종이색이 미색이라 흰 글자는 안 보입니다). 자막을 <b>구울지 말지</b>는 헤더 「④ 완성」의 <b>💬 자막</b> 체크박스가 정합니다 — 끄면 영상에 글자가 안 들어가고 <b>.srt 파일만</b> 옆에 남습니다.</div>

                <div className="meta" style={{ marginTop: 6 }}>이 채널을 고르면 헤더 이미지·비디오 도구가 이 값으로 세팅됩니다. ComfyUI 는 <b>☁ 클라우드 / 🖥 로컬</b> × 모델(Krea2·Z-Image / LTX2.5·LTX2.3)을 여기서 바로 고르고, 주소·API키는 ⚙ 설정에서 정합니다. <b>Flow · Veo</b> 는 그룹 이미지를 시작 프레임으로 i2v 하며 모델·첨부방식·다운로드 해상도는 ⚙ 설정 → 🌐 브라우저 이미지·비디오 에서 정합니다. <b>출력</b>은 완성물 종류 — .vrew 또는 ✏ 화이트보드 MP4(손그림 애니메이션 · 음성·자막 포함).</div>
              </div>)}

              {chTab === 'folder' && (<div>
                <div className="frow"><label>{ch.startMode === 'remotion' ? 'TSV 폴더' : '대본 폴더'}</label><input placeholder={ch.startMode === 'remotion' ? 'TSV(.tsv) 폴더' : '대본(.md) 폴더'} value={ch.scriptFolder} onChange={(e) => setCh({ ...ch, scriptFolder: e.target.value })} /><button className="ghost" style={{ flex: '0 0 auto' }} onClick={pickScript}>찾기</button></div>
                {/* 🎬 리모션은 .vrew 를 만들지 않는다 — 나가는 것이 mp3 뿐이라 라벨을 바꿔 오해를 줄인다. */}
                <div className="frow"><label>{ch.startMode === 'remotion' ? 'MP3 출력' : '롱폼 출력'}</label><input placeholder={ch.startMode === 'remotion' ? 'mp3 를 떨어뜨릴 폴더' : '롱폼 .vrew 출력 폴더'} value={ch.outLong} onChange={(e) => setCh({ ...ch, outLong: e.target.value })} /><button className="ghost" style={{ flex: '0 0 auto' }} onClick={pickOutLong}>찾기</button></div>
                {/* ✏ 화이트보드 완성물(MP4 + 자막)이 떨어질 폴더 — 비우면 윈도우 「다운로드」 폴더.
                    ⚠ 장면·중간 파일은 여기가 아니라 작업 폴더(롱폼 출력/대본이름/whiteboard-N)에 남는다. */}
                {ch.startMode !== 'remotion' && (
                  <div className="frow"><label>화이트보드 출력</label>
                    <input placeholder="✏ 화이트보드 MP4 와 자막(.srt)을 떨어뜨릴 폴더 — 기본값은 윈도우 「다운로드」 폴더입니다" value={ch.outWhiteboard || ''}
                      onChange={(e) => setCh({ ...ch, outWhiteboard: e.target.value })} />
                    <button className="ghost" style={{ flex: '0 0 auto' }} onClick={pickOutWhiteboard}>찾기</button></div>
                )}
                {ch.startMode !== 'remotion' && (
                  <div className="frow"><label>유튜브 업로드</label>
                    <input placeholder="🎬 유튜브 MP4(④ 완성 → 🎬 유튜브 MP4)가 떨어질 폴더 — 기본값은 윈도우 「다운로드」 폴더입니다" value={ch.outUpload || ''}
                      onChange={(e) => setCh({ ...ch, outUpload: e.target.value })} />
                    <button className="ghost" style={{ flex: '0 0 auto' }} onClick={pickOutUpload}>찾기</button></div>
                )}
                {/* 📄 대본 보기 → 🖨 A4 PDF 저장 폴더 — 비우면 윈도우 「다운로드」 폴더 */}
                {ch.startMode !== 'remotion' && (
                  <div className="frow"><label>대본 PDF</label>
                    <input placeholder="📄 대본 보기 → 🖨 A4 PDF 를 저장할 폴더 — 기본값은 윈도우 「다운로드」 폴더입니다" value={ch.outReader || ''}
                      onChange={(e) => setCh({ ...ch, outReader: e.target.value })} />
                    <button className="ghost" style={{ flex: '0 0 auto' }} onClick={pickOutReader}>찾기</button></div>
                )}
                {/* ⬆ 유튜브 자동 업로드 — MP4 를 구운 뒤 이 채널에 **비공개**로 올린다(제목·설명·AI 표시까지). 공개·예약은 Studio 에서. */}
                {ch.startMode !== 'remotion' && (
                  <div className="frow" title="🎬 유튜브 MP4 를 구우면 고른 채널에 비공개로 올립니다. 제목·설명·태그는 패키징 파일에서, 설명 끝에 ⏱ 챕터를 붙이고 「AI 합성 콘텐츠」를 표시합니다. 공개·예약·썸네일은 Studio 에서 직접 하세요."><label>⬆ 자동 업로드</label>
                    <input type="checkbox" style={{ flex: '0 0 auto' }} title="켜기" disabled={!ch.ytChannelId} checked={!!ch.ytAuto && !!ch.ytChannelId} onChange={(e) => setCh({ ...ch, ytAuto: e.target.checked })} />
                    <select value={ch.ytChannelId || ''} onChange={(e) => setCh({ ...ch, ytChannelId: e.target.value, ytAuto: !!e.target.value && (ch.ytChannelId ? !!ch.ytAuto : true) })}>
                      <option value="">{ytSt && ytSt.channels && ytSt.channels.length ? '— 올릴 유튜브 채널 —' : '— 연결된 채널 없음 (⚙ 설정 → ▶ 유튜브) —'}</option>
                      {((ytSt && ytSt.channels) || []).map((c) => <option key={c.id} value={c.id}>{c.title}{c.broken ? ' (⚠ 다시 연결 필요)' : ''}</option>)}
                      {ch.ytChannelId && !((ytSt && ytSt.channels) || []).some((c) => c.id === ch.ytChannelId) && <option value={ch.ytChannelId}>⚠ 이 PC 에서 연결 안 된 채널</option>}
                    </select>
                    <span className="meta" style={{ flex: '0 0 auto' }}>비공개</span></div>
                )}
                {/* 🎵 배경음악은 ➕ 삽입 메뉴로 옮겼다(v0.5.55) — 값(bgmOn·bgmPath·bgmVolume)은 채널에 그대로 저장되고 이 창도 불러와 되돌려 쓴다 */}
                {/* 🏷 채널 로고 — 켠 채널만 · 영상 전체 · .vrew·유튜브 MP4 공통. 투명 PNG 권장. 자리(↗ 오른쪽 위 기본 / ↖ 왼쪽 위)는 대본마다 ➕ 삽입 메뉴에서. */}
                {ch.startMode !== 'remotion' && (
                  <div className="frow" data-testid="logo-row" title="이 채널의 모든 영상에 로고를 올립니다(맨 위층 · 기본 오른쪽 위 — 자리는 ➕ 삽입 메뉴에서 대본마다 바꿉니다). 배경이 투명한 PNG 가 좋습니다. 크기 = 화면 너비 대비 %."><label>🏷 채널 로고</label>
                    <input type="checkbox" style={{ flex: '0 0 auto' }} title="켜기" checked={!!ch.logoOn} onChange={(e) => setCh({ ...ch, logoOn: e.target.checked })} />
                    <input readOnly placeholder="로고 그림(png·jpg·webp) — 비우면 로고 없음" title={ch.logoPath || ''} value={ch.logoPath || ''} />
                    <button className="ghost" style={{ flex: '0 0 auto' }} onClick={async () => { const f = await api.pickFile({ filters: [{ name: '그림', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }); if (f) setCh((c) => ({ ...c, logoPath: f, logoOn: true })); }}>파일</button>
                    <input className="nbox" type="number" min="4" max="40" step="1" style={{ width: 48, flex: '0 0 auto' }} title="크기 — 화면 너비 대비 % (기본 12)" disabled={!ch.logoOn} value={ch.logoSize} onChange={(e) => setCh({ ...ch, logoSize: e.target.value })} /><span className="meta">%</span></div>
                )}
                {/* 🔗 URL 다운로드 폴더 — 모드와 무관하다(롱폼에서도 참고 영상을 받아 전사한다). */}
                <div className="frow"><label>다운로드 폴더</label>
                  <input placeholder="🔗 URL 로 받은 mp3·영상·전사본(.txt)을 떨어뜨릴 폴더 — 기본값은 윈도우 「다운로드」 폴더입니다" value={ch.downloadFolder || ''}
                    onChange={(e) => setCh({ ...ch, downloadFolder: e.target.value })} />
                  <button className="ghost" style={{ flex: '0 0 auto' }} onClick={pickDownloadFolder}>찾기</button></div>
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
            <div className="meta" style={{ marginBottom: 8 }}><b>모든 스타일을 똑같이</b> 고치고 지울 수 있습니다(이름·프롬프트·순서). 최종 이미지 프롬프트 = <b>선택한 스타일 + 대본 프롬프트</b>.<br />☁ 목록과 순서는 <b>여러 PC 공용</b>입니다(TTS 서버에 보관) — 여기서 고치면 다른 PC 에도 반영됩니다. ⚠ 지운 스타일은 되살아나지 않습니다(그 스타일을 쓰던 채널은 다시 골라 주세요).</div>
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
              {vdWavUrl ? <button className="ghost" onClick={() => (prevKey === 'vd' ? stopPreviewAudio() : playPreviewUrl(vdWavUrl, 'vd'))}>{prevKey === 'vd' ? '■ 멈춤' : '▶ 다시 듣기'}</button> : null}
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
                    <button className="ghost" onClick={vdPlaySel} title="선택한 구간만 재생 / 멈춤 — 저장될 소리를 그대로 확인">{vdSelPlaying ? '■ 멈춤' : '▶ 구간 듣기'}</button>
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
      {settingsOpen && (
        <div className="modal-bg show">
          <div className="modal-card wide">
            <h3>⚙ 설정</h3>
            <div className="frow" style={{ gap: 6, marginBottom: 10, borderBottom: '1px solid var(--line)', paddingBottom: 8, flexWrap: 'wrap' }}>
              {[['img', '🖼 ComfyUI 이미지'], ['vid', '🎬 ComfyUI 비디오'], ['free', '🌐 브라우저 이미지·비디오'], ['keys', '🔑 API 키'], ['acct', '👤 계정'], ['yt', '▶ 유튜브'], ['tts', '🖧 TTS 서버']].map(([id, lbl]) => (
                <button key={id} className={settingsTab === id ? '' : 'ghost'} style={{ padding: '5px 10px' }} onClick={() => { setSettingsTab(id); setSettingsMsg(''); if (id === 'acct') loadAcct(); if (id === 'yt') ytLoad(); if (id === 'img') { setComfyProbe({}); probeBoth('image'); } if (id === 'vid') { setCvidProbe({}); probeBoth('video'); } }}>{lbl}</button>
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

            {/* 🌐 브라우저 이미지 — Flow·Genspark(브라우저) 설정 + LoRA 수집.
                2026-08-26: 옛 「⚙ 이미지 순환」 모달을 없애고 이 탭으로 옮겼다. 드롭다운이 Flow·Genspark 로
                분리됐으므로 순서/체크는 필요 없다 — 고른 쪽이 먼저 돌고 한도면 다른 쪽이 이어받는다. */}
            {settingsTab === 'free' && (<div>
              <div className="meta" style={{ marginBottom: 10 }}>
                브라우저로 생성하는 <b>Flow · Genspark</b> 설정입니다 — 둘 다 <b>각 서비스의 구독 요금제</b>로 만듭니다(Genspark 구독 · Flow 는 Google AI Pro/Ultra 구독). 어느 쪽으로 만들지는 헤더 <b>「② 이미지」</b> 드롭다운에서 고르세요.
                고른 쪽이 <b>한도</b>(Genspark 휴식/한도 메시지 · Flow 계정 한도)에 걸리면 <b>남은 이미지를 다른 쪽이 이어서</b> 만들고, <b>한도 재설정 시각이 지나면 같은 대본 도중이라도 원래 엔진으로 되돌아가</b> 이어서 만듭니다.
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
              <div className="frow" style={{ alignItems: 'center', marginTop: 6 }}>
                <label style={{ flex: '0 0 auto', minWidth: 120 }}>Flow 비디오 모델</label>
                <select style={{ flex: '0 0 auto', width: 'auto' }} value={(imgRot && imgRot.flowVideoModel) || 'Veo 3.1 - Lite'}
                  title="Flow i2v 비디오 모델(Veo). 그룹 이미지를 시작 프레임으로 넣어 만듭니다. 생성당 크레딧을 씁니다 — Lite x1 = 10크레딧."
                  onChange={(e) => saveImgRot({ ...(imgRot || {}), flowVideoModel: e.target.value })}>
                  <option value="Veo 3.1 - Lite">Veo 3.1 - Lite (기본 · 10크레딧)</option>
                  <option value="Veo 3.1 - Fast">Veo 3.1 - Fast</option>
                  <option value="Veo 3.1 - Quality">Veo 3.1 - Quality (고화질 · 크레딧↑)</option>
                </select>
              </div>
              <div className="frow" style={{ alignItems: 'center', marginTop: 6 }}>
                <label style={{ flex: '0 0 auto', minWidth: 120 }}>Flow 첨부 방식</label>
                <select style={{ flex: '0 0 auto', width: 'auto' }} value={(imgRot && imgRot.flowVideoAttach) || 'frame'}
                  title="그룹 이미지를 어떻게 붙일지. 프레임 = 첫 프레임이 그 그림으로 고정(원본을 그대로 움직인다) · 애셋 = 참조로만 전달(구도·인물이 달라질 수 있다)."
                  onChange={(e) => saveImgRot({ ...(imgRot || {}), flowVideoAttach: e.target.value })}>
                  <option value="frame">프레임 — 첫 프레임 고정 (권장)</option>
                  <option value="asset">애셋 — 참조 이미지</option>
                </select>
              </div>
              <div className="frow" style={{ alignItems: 'center', marginTop: 6 }}>
                <label style={{ flex: '0 0 auto', minWidth: 120 }}>Flow 다운로드</label>
                <select style={{ flex: '0 0 auto', width: 'auto' }} value={(imgRot && imgRot.flowVideoDownload) || '1080p'}
                  title="완성된 영상을 어느 해상도로 받을지. 1080p 로 받으면 이 PC 의 GPU 업스케일(장당 수 분)이 생략됩니다."
                  onChange={(e) => saveImgRot({ ...(imgRot || {}), flowVideoDownload: e.target.value })}>
                  <option value="1080p">1080p — 업스케일본 (권장)</option>
                  <option value="720p">720p — 원본 크기</option>
                  <option value="off">다운로드 안 함 — 재생 소스(720p)</option>
                </select>
              </div>
              <div className="frow" style={{ alignItems: 'center', marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                <label style={{ flex: '0 0 auto', minWidth: 120 }}>Genspark 비디오 모델</label>
                <select style={{ flex: '1 1 auto', width: 'auto' }} value={(imgRot && imgRot.gensparkVideoModel) || 'MiniMax H3 Max'}
                  title="Genspark 비디오를 어느 모델로 만들지. 모델마다 길이·해상도·비용이 다릅니다. 괄호 안이 그 모델의 규격입니다."
                  onChange={(e) => saveImgRot({ ...(imgRot || {}), gensparkVideoModel: e.target.value })}>
                  {GS_VIDEO_MODELS.map((m) => <option key={m.name} value={m.name}>{m.name} — {m.note}</option>)}
                </select>
              </div>
              {(() => {
                const cur = (imgRot && imgRot.gensparkVideoModel) || 'MiniMax H3 Max';
                const m = GS_VIDEO_MODELS.find((x) => x.name === cur);
                if (!m || m.imgRef === true) return null;
                return (
                  <div className="meta" style={{ marginTop: 6, padding: '6px 9px', borderRadius: 6, background: '#fde8e8', color: '#a3352b', fontWeight: 700 }}>
                    {m.imgRef === false
                      ? <>⛔ 「{cur}」 은 <b>참조 이미지를 받지 않습니다</b> — 그룹 이미지를 첨부해도 무시되고 <b>화풍과 무관한 영상(실사)</b>이 나옵니다. 이 모델로는 <b>비디오를 만들지 않습니다</b>(크레딧 낭비 방지). 위에서 <b>이미지 장수가 적힌 모델</b>을 고르세요.</>
                      : <>⚠ 「{cur}」 이 참조 이미지를 쓰는지 알 수 없습니다 — 결과 화풍을 확인하세요.</>}
                  </div>
                );
              })()}
              <div className="frow" style={{ alignItems: 'center', marginTop: 6 }}>
                <label style={{ flex: '0 0 auto', minWidth: 120 }}>Genspark 품질 등급</label>
                <select style={{ flex: '0 0 auto', width: 'auto' }} value={(imgRot && imgRot.gensparkVideoTier) || 'Standard'}
                  title="Standard / Ultra. Ultra 는 더 강한 모델 조합이지만 크레딧을 더 씁니다."
                  onChange={(e) => saveImgRot({ ...(imgRot || {}), gensparkVideoTier: e.target.value })}>
                  <option value="Standard">Standard</option>
                  <option value="Ultra">Ultra — 더 강함(크레딧 더 씀)</option>
                </select>
              </div>
              <div className="meta" style={{ marginTop: 6 }}>🎬 <b>Genspark 비디오</b>는 헤더 「③ 비디오」에서 <b>Genspark</b>를 고르면 씁니다. 그룹 이미지를 <b>시작 프레임</b>으로 넣어 만듭니다(i2v). 첨부가 실패하면 <b>그 컷을 만들지 않습니다</b> — 원본과 무관한 영상에 크레딧을 쓰지 않기 위해서입니다.<br />🔑 <b>어느 모델이 좋은지는 써 보고 정하세요.</b> 길이는 그룹 TTS 길이로 요청하고, <b>모델이 받아 주는 범위로 앱이 맞춥니다</b>(예: Omni Flash 3~10초 · Seedance 2.5 4~30초 · Veo 3.1 은 4·6·8초만). ⚠ <b>720p 모델</b>(Omni Flash·Kling V3 등)은 이 PC GPU 업스케일이 붙어 영상당 수 분이 더 걸립니다 — 1080p 모델을 고르면 그 단계가 생략됩니다.<br />⚠ Genspark 비디오는 <b>이미지 순환과 같은 크롬</b>을 쓰므로 둘이 동시에 돌지 않습니다(순서대로 처리됩니다).</div>
              <div className="meta" style={{ marginTop: 6 }}>🎬 <b>Flow 비디오</b>는 헤더 「③ 비디오」에서 <b>Flow · Veo</b>를 고르면 씁니다. 그룹 이미지를 <b>시작 프레임</b>으로 넣어 만들므로 화풍이 유지됩니다(t2v 가 아닙니다). ⚠ Flow 화면에 <b>길이 옵션이 없어</b> Veo 가 정하는 길이(약 8초)로 나옵니다 — 그룹 TTS 가 더 길면 .vrew 에서 뒷부분은 이미지가 채웁니다.<br />🔑 <b>프레임</b>은 그 그림이 <b>첫 프레임으로 고정</b>돼 원본을 그대로 움직입니다(화풍 유지에 안전). <b>애셋</b>은 <b>참조</b>로만 전달돼 Veo 가 새로 그리므로 <b>구도·인물이 달라질 수 있습니다</b> — 캐릭터나 분위기만 참고시키고 싶을 때 쓰세요.<br />🔑 <b>다운로드 1080p</b>: Flow 는 재생 소스로 <b>720p 원본</b>만 주고, 1080p 는 카드 메뉴의 <b>다운로드 → 1080p(업스케일)</b> 로만 받을 수 있습니다. 이걸로 받으면 이 PC 의 <b>GPU 업스케일(장당 수 분)이 통째로 생략</b>됩니다.</div>
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
            {settingsTab === 'yt' && (<div>
              <div className="meta" style={{ marginBottom: 8, lineHeight: 1.6 }}>
                🎬 유튜브 MP4 를 구우면 채널에 <b>비공개</b>로 올립니다 — 제목·설명·태그(패키징 파일) · ⏱ 챕터 · <b>AI 합성 콘텐츠 표시</b>까지.
                <b>공개·예약·썸네일·재생목록</b>은 Studio 에서 직접 하세요. 연결 정보는 <b>이 PC 에만</b> 암호화돼 저장됩니다(PC·계정마다 따로 연결).
              </div>
              {ytSt && !ytSt.available && <div className="meta" style={{ color: '#b03a3a', marginBottom: 8 }}>⚠ 이 PC 에서는 OS 암호화(safeStorage)를 쓸 수 없어 유튜브 연결을 저장할 수 없습니다.</div>}
              <div data-testid="yt-client" style={{ background: '#fbf6ee', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
                <div className="frow" style={{ alignItems: 'center' }}>
                  <label style={{ width: 'auto', fontWeight: 700, color: 'var(--hook)' }}>① 연결 파일</label>
                  <span className="meta" style={{ flex: 1 }}>{ytSt && ytSt.hasClient ? <>✅ 가져옴 · 프로젝트 <b>{ytSt.projectId || '?'}</b></> : <>구글 클라우드에서 받은 <b>client_secret_….json</b> 파일을 한 번만 고르세요(다운로드 폴더에 있습니다).</>}</span>
                  <button className={ytSt && ytSt.hasClient ? 'ghost' : ''} style={{ flex: '0 0 auto' }} onClick={ytImport}>📥 파일 가져오기</button>
                </div>
              </div>
              <div data-testid="yt-channels" style={{ background: '#fbf6ee', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
                <div className="frow" style={{ alignItems: 'center' }}>
                  <label style={{ width: 'auto', fontWeight: 700, color: 'var(--hook)' }}>② 채널 연결</label>
                  <span className="meta" style={{ flex: 1 }}>채널마다 한 번. 브라우저에서 로그인 → <b>올릴 채널 선택</b> → 「확인되지 않은 앱」이 뜨면 <b>고급 → Priming(으)로 이동</b> → 허용.</span>
                  <button style={{ flex: '0 0 auto' }} disabled={!ytSt || !ytSt.hasClient} onClick={ytConnect}>🔗 채널 연결</button>
                </div>
                {(!ytSt || !ytSt.channels || !ytSt.channels.length) && <div className="meta" style={{ marginTop: 6 }}>연결된 채널이 없습니다.</div>}
                {((ytSt && ytSt.channels) || []).map((c) => (
                  <div key={c.id} className="frow" style={{ alignItems: 'center', borderTop: '1px dashed var(--line)', paddingTop: 5, marginTop: 5 }}>
                    <b style={{ flex: '0 0 auto' }}>▶ {c.title}</b>
                    <span className="meta" style={{ flex: 1 }}>{c.handle ? `${c.handle} · ` : ''}{c.connectedAt ? `${c.connectedAt} 연결` : ''}{c.broken ? ' · ⚠ 연결이 끊겼습니다 — 다시 연결하세요' : ''}</span>
                    <button className="ghost" style={{ flex: '0 0 auto' }} title="연결 해제" onClick={() => ytDisconnect(c)}>✕</button>
                  </div>
                ))}
              </div>
              <div className="meta" style={{ lineHeight: 1.6 }}>③ ⚙ 채널편집 → 📁 폴더 → <b>⬆ 자동 업로드</b>에서 Priming 채널마다 올릴 유튜브 채널을 고르세요. 이미 올린 파일은 다시 올리지 않습니다.</div>
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

      {/* 🔗 URL → 다운로드 → STT. 자막이 있으면 STT 를 건너뛴다(GPU 0초). */}
      {readerOpen && (
        <ScriptReader api={api} dto={dto} onDto={setDto} uiConfirm={uiConfirm} log={logline} presetName={presetName} reloadTick={reloadTick}
          onClose={() => setReaderOpen(false)} />
      )}
      {ytProg && (
        <YtProgress prog={ytProg}
          onAbort={() => { api.ytAbort(); }}
          onClose={() => setYtProg(null)}
          openUrl={(u) => api.ytOpenUrl(u)} />
      )}
      {mp4Prog && (
        <Mp4Progress prog={mp4Prog}
          onAbort={() => { abort(); }}
          onClose={() => setMp4Prog(null)} />
      )}
      {urlProg && (
        <UrlProgress prog={urlProg}
          onAbort={() => { abort(); setUrlProg((p) => (p ? { ...p, phase: 'aborting' } : p)); }}
          onClose={() => setUrlProg(null)} />
      )}
      {urlOpen && (
        <div className="modal-bg show">
          <div className="modal-card" style={{ maxWidth: 640 }}>
            <h3>🔗 URL 에서 받아 전사</h3>
            <div className="meta" style={{ marginBottom: 8 }}>
              유튜브·비메오·틱톡·인스타 등의 <b>주소를 한 줄에 하나씩</b> 붙여넣으세요(여러 개 가능).
              <br />저장 위치 = 채널의 <b>다운로드 폴더</b>(⚙ 채널편집 → 📁 폴더). 비어 있으면 받을 때 물어봅니다.
            </div>
            <textarea ref={urlTextRef} rows={5} spellCheck={false} autoFocus
              placeholder={urlChannelAll ? 'https://www.youtube.com/@채널주소' : 'https://www.youtube.com/watch?v=...\nhttps://youtu.be/...'}
              style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'Consolas,monospace', fontSize: 13 }} />
            <label className="chk" style={{ marginTop: 8, display: 'block' }}>
              <input type="checkbox" checked={urlChannelAll} onChange={(e) => setUrlChannelAll(e.target.checked)} />
              {' '}<b>유튜브 채널의 일반 영상 전체</b> 받기(채널별 폴더 · 이미 완료한 영상은 건너뜀)
            </label>
            <div className="frow" style={{ marginTop: 10 }}>
              <label>받을 것</label>
              <select value={urlMode} onChange={(e) => setUrlMode(e.target.value)}>
                <option value="audio">🎵 MP3 (음성만 · 빠르고 작습니다)</option>
                <option value="video">🎬 영상 (mp4)</option>
                <option value="both">🎵+🎬 둘 다</option>
              </select>
            </div>
            <label className="chk" style={{ marginTop: 8, display: 'block' }}>
              <input type="checkbox" checked={urlForceStt} onChange={(e) => setUrlForceStt(e.target.checked)} />
              {' '}자막이 있어도 <b>Whisper 로 전사</b>(자막보다 정확하지만 GPU 를 오래 씁니다)
            </label>
            <div className="meta" style={{ marginTop: 8 }}>
              기본 동작: <b>자막이 있으면 그대로 .txt</b> 로 만들고 STT 를 건너뜁니다(수 초 · GPU 0). 자막이 없는 영상만 Whisper 로 전사합니다.
              {/* 🔑 조회가 비동기라 처음엔 값이 없다 — 그렇다고 통째로 숨기면 조회에 실패했을 때
                  화면에 아무 단서도 안 남는다(「⬇ 업데이트」 버튼도 사라진다). 항상 그리고 내용만 바꾼다. */}
              <div style={{ marginTop: 6 }}>
                {!ytInfo
                  ? <>yt-dlp 확인 중…</>
                  : ytInfo.found
                    ? <>yt-dlp <b>{ytInfo.version}</b>{ytInfo.stale
                        ? <span style={{ color: 'var(--bad, #c0392b)' }}> · {ytInfo.ageDays}일 된 판이라 오디오가 막힐 수 있습니다 — 받을 때 자동으로 최신판을 내려받습니다</span>
                        : ` · ${ytInfo.ageDays}일 전 판`}</>
                    : <>이 PC 에 yt-dlp 가 없습니다 — 처음 받을 때 <b>자동으로 내려받습니다</b>(약 17MB · 한 번만).</>}
                {' '}<button className="ghost" disabled={urlBusy} style={{ padding: '1px 8px', marginLeft: 4 }} onClick={updateYtdlp}>⬇ 업데이트</button>
              </div>
            </div>
            <div className="mbtns">
              <button disabled={urlBusy} onClick={runUrlDl}>{urlChannelAll ? '채널 전체 받아서 전사' : '받아서 전사'}</button>
              <button className="ghost" onClick={() => setUrlOpen(false)}>취소</button>
            </div>
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

// ✏ 편집칸을 글 높이에 딱 맞춘다 — 그 줄 자리에서 고치는 느낌이 나도록(빈 줄·스크롤 없음).
// 🖱 자막을 눌러 고치기 시작할 때 커서 자리 — 글자 위 = 맨 앞 · 글자 뒤 빈 곳 = 맨 끝(로이 2026-09-25)
let _caretSide = null;
function caretSideFromClick(ev, box) {
  try {
    if (!box) return 'start';
    const r = document.createRange(); r.selectNodeContents(box);
    const rs = [...r.getClientRects()].filter((q) => q.width > 0);
    if (!rs.length) return 'end';
    const last = rs[rs.length - 1];
    if (ev.clientY > last.bottom + 1) return 'end';
    if (ev.clientY >= last.top - 1 && ev.clientX > last.right + 1) return 'end';
    return 'start';
  } catch (_) { return 'start'; }
}
function applyCaretSide(el) {
  if (!el || !_caretSide || el.dataset.caretSet) return;
  el.dataset.caretSet = '1';
  const side = _caretSide; _caretSide = null;
  const put = () => { try { const n = side === 'end' ? el.value.length : 0; el.setSelectionRange(n, n); } catch (_) {} };
  // 🔴 한 프레임 뒤에 한 번 더 놓는 건 autoFocus 가 커서를 옮기는 경우 대비 — 그 사이 사람이 키·마우스로 커서를 옮겼으면
  //   덮지 않는다(v0.5.51 · 누르자마자 → 를 치면 커서가 맨 앞으로 되돌아가 Enter 가 엉뚱한 자리에서 줄을 나눴다).
  let touched = false;
  const mark = () => { touched = true; };
  el.addEventListener('keydown', mark, { once: true });
  el.addEventListener('mousedown', mark, { once: true });
  put();
  requestAnimationFrame(() => { el.removeEventListener('keydown', mark); el.removeEventListener('mousedown', mark); if (!touched) put(); });
}
function fitSentBox(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// ── 카드 목록 (편별 그룹/컷) ──────────────────────────────
function Cards({ dto, isLf, capCharsN, layout, detail, linesMap, cursor, onCursor, capBase, capSel, onPickCapLine, onPickCapChars, edit, onOverlay, onInsMark, playing, onTts, onImg, onVid, onImgVid, onBulk, onPlayShorts, onPlayGroup, onRegen, onMake, onPremiere, onAttach, onClear, onPreview, onPlayFrom, onGroupTts, onGroupVid, onShowPrompt, onSplit, onMerge, onRange, onLook, aiNotice, onAiRange, onInsRange }) {
  // 🎬 Vrew 식 화면(클립 · 상세 보기 · 롱폼) — 오른쪽 = 클립마다 작은 그림 + 시각 · 왼쪽 = ➕ 삽입 범위 막대(v0.5.57)
  const vrewLay = layout === 'clips' && !!detail && !!isLf;
  // 🖼 그림 적용 범위 — 막대 끌기 상태와 썸네일 메뉴(Vrew 방식)
  const [vrDrag, setVrDrag] = useState(null);   // {shortsNum, groupNum, edge:'start'|'end', gs, ge, ord}
  const [vrMenu, setVrMenu] = useState(null);   // {shortsNum, c, gs, ge, n, x, y, sub}
  // 🎬 그룹(Vrew 의 씬) 접기 — 'sn:num'
  const [folded, setFolded] = useState(() => new Set());
  const toggleFold = (k) => setFolded((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const vrDragRef = useRef(null); vrDragRef.current = vrDrag;
  // 🖼 놓은 뒤 main 이 돌려줄 때까지 새 범위로 그려 둔다(v0.5.61 — 삽입 막대와 같다) · dto 가 바뀌면 · 4초 뒤 푼다
  const [vrPending, setVrPending] = useState(null);   // {shortsNum, groupNum, from, to}
  useEffect(() => { if (vrPending) setVrPending(null); /* eslint-disable-next-line */ }, [dto]);
  useEffect(() => { if (!vrPending) return undefined; const t = setTimeout(() => setVrPending(null), 4000); return () => clearTimeout(t); }, [vrPending]);
  const grabRail = (sn, c, edge, r) => setVrDrag({ shortsNum: sn, groupNum: c.num, edge, gs: r.from, ge: r.to, ord: edge === 'start' ? r.from : r.to });
  useEffect(() => {
    if (!vrDrag) return undefined;
    let lastY = null;
    const pick = () => {
      const d = vrDragRef.current; if (!d || lastY == null) return;
      const o = ordAtY(d.shortsNum, lastY, d.edge === 'start' ? 's' : 'e');
      if (o != null && o !== d.ord) { vrDragRef.current = { ...d, ord: o }; setVrDrag(vrDragRef.current); }
    };
    const move = (ev) => { lastY = ev.clientY; pick(); };
    const stopScroll = dragAutoScroll(() => lastY);
    const pane = document.querySelector('main.pane2');
    if (pane) pane.addEventListener('scroll', pick);
    const up = () => {
      const d = vrDragRef.current; setVrDrag(null);
      if (!d || !onRange) return;
      const r = vrRangeOf(d);
      if (r.from !== d.gs || r.to !== d.ge) { setVrPending({ shortsNum: d.shortsNum, groupNum: d.groupNum, from: r.from, to: r.to }); onRange(d.shortsNum, d.groupNum, r.from, r.to); }
    };
    const esc = (ev) => { if (ev.key === 'Escape') { vrDragRef.current = null; setVrDrag(null); } };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); document.addEventListener('keydown', esc);
    document.body.classList.add('vr-dragging');
    return () => { stopScroll(); if (pane) pane.removeEventListener('scroll', pick); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.removeEventListener('keydown', esc); document.body.classList.remove('vr-dragging'); };
  }, [!!vrDrag]);
  useEffect(() => {
    if (!vrMenu) return undefined;
    const close = (ev) => { if (ev.type === 'keydown' ? ev.key === 'Escape' : !(ev.target.closest && ev.target.closest('.vr-menu'))) setVrMenu(null); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [vrMenu]);
  // 🏷 AI 고지가 보이는 문장 — 범위를 정했으면 그 문장들, 아니면 표시하지 않는다(기본 5초는 첫 문장 위 꼬리표로만)
  const aiIn = (pr, ord) => !!(aiNotice && pr.aiNoticeRange && ord >= pr.aiNoticeRange.from && ord <= pr.aiNoticeRange.to);
  const aiFirst = (pr) => (pr.aiNoticeRange ? pr.aiNoticeRange.from : 1);
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
        let ordN = 0;   // 🖼 편 전체 문장 번호(1부터) — 그림 적용 범위의 단위
        const nSent = pr.cuts.reduce((a, c) => a + ((c.sentences || []).length), 0);
        const projLines = [];   // 🎨 이 편의 모든 자막 줄(화면 순서) — Shift 로 범위를 고를 때
        // ⏱ 편 문장 번호(1부터) → 시작 초(음성 길이 누적 — .vrew 와 같다) · 없으면 2.5초로 어림
        const sStart = [0, 0];
        for (const c0 of pr.cuts) for (const se of (c0.sentences || [])) sStart.push(sStart[sStart.length - 1] + (se.dur || 2.5));
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
                <button className="ghost" data-testid="play-shorts" onClick={() => onPlayShorts(pr.shortsNum)}>{playing && playing.key === 'shorts:' + pr.shortsNum ? '■ 멈춤' : '▶ 미리보기'}</button>
                <button className="ghost" onClick={() => onMake(pr.shortsNum)}>⚡ 만들기</button>
                <button className="ghost" title="Premiere Pro 임포트용 XML 시퀀스 생성 — 파일 > 가져오기로 열면 클립·TTS가 배치된 시퀀스가 바로 열립니다 (자막은 .srt 캡션 가져오기)" onClick={() => onPremiere(pr.shortsNum)}>🎞 프리미어</button>
              </span>
            </h2>
            <div className={'cuts-grid' + (isLf ? ' lf' : '') + (layout === 'clips' ? ' clips' : '') + (detail ? ' detail' : '') + (vrewLay ? ' vrew' : '')}
              style={vrewLay ? { '--lanes': Math.max(1, (pr.overlays || []).length) } : undefined}>
              {pr.cuts.map((c, ci) => {
                const ph = phaseBadge(c.phase);
                // ✏ 문장 단위 블록 — 화면 번호(01|02|…)는 **자막 줄** 번호이고, 편집 단위는 **문장**이다.
                //   한 문장이 자막 두 줄이 되기도 하므로(글자수 설정에 따라) 문장 경계를 블록으로 드러낸다.
                const sents = c.sentences || [];
                const gs = ordN + 1, ge = ordN + sents.length; ordN = ge;
                const vrR = vrDrag && vrDrag.shortsNum === pr.shortsNum ? vrRangeOf(vrDrag) : null;
                const ed = edit.cur;
                const edHere = ed && ed.shortsNum === pr.shortsNum && ed.groupNum === c.num;
                const thumbEl = (
                  <Thumb c={c} isLf={isLf} onAttach={() => onAttach(pr.shortsNum, c.num)} onClear={() => onClear(pr.shortsNum, c.num)} onPreview={onPreview}
                    onMenu={onRange ? (ev) => setVrMenu({ shortsNum: pr.shortsNum, c, gs: c.span ? c.span.from : gs, ge: c.span ? c.span.to : ge, n: nSent, x: ev.clientX, y: ev.clientY, sub: null }) : null} />
                );
                const lineEls = sents.map((s, si) => {
                  // 🧭 줄 번호는 App 의 linesMap(Workspace.buildProjLines)이 정본 — ①·키보드와 같은 번호
                  const _pl = linesMap && linesMap.get(pr.shortsNum);
                  const _got = _pl && _pl.bySent.get(c.num + ':' + si);
                  let lines;
                  if (_got) { lines = _got.map((x) => ({ n: x.n, t: x.t, range: x.range, start: x.start, dur: x.dur })); capN = lines.length ? lines[lines.length - 1].n : capN; }
                  else {
                    const _lt = splitLines(s.text, capCharsN, s.breaks);
                    const _rg = CF.lineRanges(s.text || '', _lt);
                    lines = _lt.map((t, li) => ({ n: ++capN, t, range: _rg[li] }));
                  }
                  for (const l of lines) projLines.push({ n: l.n, groupNum: c.num, sentIdx: si, from: l.range.from, to: l.range.to });
                  if (edHere && si === ed.sentIdx && !ed.line && ed.where !== 'stage') {
                    return (
                      <div className="sblk editing" key={'e' + si} data-ord={gs + si} data-sn={pr.shortsNum}>
                        {/* 🔑 줄 번호는 편집 중에도 그대로 둔다 — 고치는 동안에도 몇 번째 자막인지 보이게(로이 2026-09-15).
                            번호는 원문 기준이라 글자를 고쳐도 그 자리에서 움직이지 않는다(나누면 그때 다시 매겨진다). */}
                        <span className="lineno">{String(lines.length ? lines[0].n : capN).padStart(2, '0')} |</span>
                        {/* 비제어 — 값은 저장할 때 ref 에서 한 번만 읽는다.
                            🔑 그 줄 자리에서 그대로 고친다 — 글 높이에 맞춰 늘어나므로 화면이 튀지 않는다. */}
                        <textarea defaultValue={ed.text} rows={1} spellCheck={false} autoFocus
                          disabled={edit.busy}
                          title="Enter 나누기 · 맨 앞 ←Backspace 윗줄과 합치기 · 맨 끝 Del 아랫줄 올리기 · Esc 취소"
                          ref={(el) => { edit.ref.current = el; fitSentBox(el); applyCaretSide(el); }}
                          onInput={(ev) => fitSentBox(ev.currentTarget)}
                          onBlur={() => edit.commit()}
                          onKeyDown={(ev) => {
                            const el = ev.currentTarget;
                            const caret = el.selectionStart, sel = el.selectionEnd;
                            if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); edit.splitAt(); }
                            else if (ev.key === 'Escape') { ev.preventDefault(); edit.cancel(); }
                            // 🧩 맨 앞 ↑ / 맨 끝 ↓ = 저장하고 윗·아랫 클립으로(키보드로 클립 이동)
                            else if (ev.key === 'ArrowUp' && caret === 0 && sel === 0 && edit.navOut) { ev.preventDefault(); edit.navOut(-1); }
                            else if (ev.key === 'ArrowDown' && caret === el.value.length && sel === el.value.length && edit.navOut) { ev.preventDefault(); edit.navOut(1); }
                            // 🔑 맨 앞에서 ←Backspace = 윗줄과 합치기. 지울 글자가 없을 때만이라 평소 지우기를 가로채지 않는다.
                            else if (ev.key === 'Backspace' && caret === 0 && sel === 0) {
                              ev.preventDefault();
                              if (si === 0) edit.across('prev');
                              else if (s.mark) edit.note('합친 그룹 안의 섹션 경계입니다(대본에선 제목 줄이 사이에 있습니다) — 여기서는 합칠 수 없습니다');
                              else if ((s.speaker || null) !== (sents[si - 1].speaker || null)) edit.note('화자가 다른 문장입니다 — 합칠 수 없습니다(대본의 [이름] 이 다릅니다)');
                              else edit.mergeUp(si, sents[si - 1].text);
                            }
                            // 🔑 맨 끝에서 Del = 아랫줄을 끌어올려 합치기.
                            else if (ev.key === 'Delete' && caret === el.value.length && sel === el.value.length) {
                              ev.preventDefault();
                              if (si >= sents.length - 1) edit.across('next');
                              else if (sents[si + 1].mark) edit.note('합친 그룹 안의 섹션 경계입니다(대본에선 제목 줄이 사이에 있습니다) — 여기서는 합칠 수 없습니다');
                              else if ((s.speaker || null) !== (sents[si + 1].speaker || null)) edit.note('화자가 다른 문장입니다 — 합칠 수 없습니다(대본의 [이름] 이 다릅니다)');
                              else edit.mergeNext(si, sents[si + 1].text);
                            }
                          }} />
                      </div>
                    );
                  }
                  return (
                    <React.Fragment key={si}>
                    {aiNotice && onAiRange && gs + si === aiFirst(pr) && (
                      <button className="ai-tag" data-testid="ai-tag" title="AI 고지 문구가 보이는 범위 — 눌러서 바꾸기(Vrew 텍스트의 적용 범위)"
                        onClick={(ev) => { ev.stopPropagation(); setVrMenu({ kind: 'ai', shortsNum: pr.shortsNum, n: nSent, cur: pr.aiNoticeRange, ord: gs + si, x: ev.clientX, y: ev.clientY }); }}>
                        🏷 AI 고지 {pr.aiNoticeRange ? `${pr.aiNoticeRange.from}~${pr.aiNoticeRange.to}` : '· 5초 뒤 5초(기본)'}
                      </button>
                    )}
                    <div className={'sblk' + (vrR && gs + si >= vrR.from && gs + si <= vrR.to ? ' vr-hit' : '') + (aiIn(pr, gs + si) ? ' ai-in' : '')} key={si} data-ord={gs + si} data-sn={pr.shortsNum}>
                      {/* 합친 그룹 안의 옛 섹션 경계 — 그림은 앞 그림을 이어 쓰지만 챕터(타임스탬프)는 여기서 갈린다 */}
                      {s.mark && <div className="smark" title="앞 그룹 그림을 이어 쓰는 구간 — 유튜브 챕터는 여기서 새로 시작합니다">⤒ {s.mark.h2 && s.mark.phase && s.mark.h2 !== s.mark.phase ? `${s.mark.h2} · ${s.mark.phase}` : (s.mark.phase || s.mark.h2)}</div>}
                      <div className={'sblk-lines' + (capSel && capSel.mode === 'chars' && capSel.shortsNum === pr.shortsNum && capSel.items.some((x) => x.groupNum === c.num && x.sentIdx === si) ? ' capsel' : '')}
                        title="클릭해서 이 문장 고치기 · 글자를 드래그하면 그 글자만 서식 · 줄 번호를 누르면 그 줄 서식"
                        onClick={(ev) => {
                          // 🎨 글자를 드래그해 골랐으면 고치기 대신 서식 선택(Vrew 처럼 단어 하나만 굵게·색…)
                          const rg = onPickCapChars ? selectionRange(ev.currentTarget) : null;
                          if (rg) { onPickCapChars(pr.shortsNum, c.num, si, rg); return; }
                          // 🧭 누른 줄로 커서 이동 + 바로 고치기(로이 확정)
                          const lnEl = ev.target && ev.target.closest ? ev.target.closest('[data-ln]') : null;
                          const clickN = lnEl ? Number(lnEl.getAttribute('data-ln')) : (lines.length ? lines[0].n : 1);
                          if (onCursor) onCursor(pr.shortsNum, clickN);
                          const cl = detail ? lines.find((x) => x.n === clickN) : null;
                          _caretSide = caretSideFromClick(ev, lnEl ? (lnEl.querySelector('.clip-cap') || lnEl) : ev.currentTarget);
                          edit.start(pr.shortsNum, c.num, si, s.text, 1, cl ? { n: cl.n, from: cl.range.from, to: cl.range.to } : null);
                        }}>
                        {lines.map((l, li) => {
                          const info = { n: l.n, groupNum: c.num, sentIdx: si, from: l.range.from, to: l.range.to };
                          const picked = capSel && capSel.mode === 'lines' && capSel.shortsNum === pr.shortsNum && capSel.items.some((x) => x.n === l.n);
                          // ✨ 표시는 **이 줄에 따로 준 효과**만(채널 기본 효과까지 표시하면 모든 줄에 붙는다)
                          const lp = s.spans ? CF.lineProps(s.spans, l.range, {}, String(s.text || '').length) : null;
                          const ai = lp && lp.anim ? CF.ANIM_INFO[lp.anim.type] : null;
                          const isCur = cursor && cursor.shortsNum === pr.shortsNum && cursor.n === l.n;
                          const lineNo = (
                            <span className="lineno cf-lineno" title="이 자막 줄 서식 고르기 — Shift 범위 · Ctrl 더하기"
                              onMouseDown={(ev) => { if (ev.shiftKey || ev.ctrlKey || ev.metaKey) ev.preventDefault(); }}
                              onClick={(ev) => { ev.stopPropagation(); if (onPickCapLine) onPickCapLine(pr.shortsNum, info, ev, projLines); }}>{String(l.n).padStart(2, '0')} |</span>
                          );
                          const ord = gs + si;
                          // ➕ (개요 보기) 이 줄이 삽입의 시작이면 표시(문장 첫 줄에만) — 🎵 오디오 · 그림 썸네일 · 🎬 영상
                          const insHere = !vrewLay && li === 0 && onInsMark ? insMarksAt(pr, c, si) : [];
                          const insMarks = insHere.length ? (
                            <span className="ins-marks" data-testid="ins-marks">
                              {insHere.map((o) => (
                                <button key={o.id} className={'ins-mark ' + o.kind} data-testid="ins-mark" data-kind={o.kind}
                                  title={`${o.kind === 'audio' ? '🎵 오디오' : o.kind === 'video' ? '🎬 영상' : '🖼 그림'} 「${o.name || ''}」 · ${o.from === 1 && o.to === o.total ? '전체' : `클립 ${o.from}~${o.to}`} — 누르면 적용 범위 · 삭제`}
                                  onMouseDown={(ev) => ev.stopPropagation()}
                                  onClick={(ev) => { ev.stopPropagation(); onInsMark(pr.shortsNum, o.id, ev.currentTarget); }}>
                                  {o.kind === 'image' ? <img src={media(o.file, o.version)} alt="" /> : (o.kind === 'video' ? '🎬' : '🎵')}
                                </button>
                              ))}
                            </span>
                          ) : null;
                          if (detail) {
                            // 🧩 Vrew 클립 모양(로이 2026-09-25 캡처) — 왼쪽 번호 칸(누르면 이 클립 선택 · Shift 범위 · Ctrl 더하기) |
                            //   1행 = 화자 · 시각 · 어절 칩(누르면 그 단어만 서식) / 2행 = 🗨 자막(누르면 **그 줄 글자만** 같은 모양 그대로 고치기) + 가(이 클립 서식)
                            const selChars = capSel && capSel.mode === 'chars' && capSel.shortsNum === pr.shortsNum ? capSel.items.filter((x) => x.groupNum === c.num && x.sentIdx === si) : [];
                            const tm = fmtClipTime(l.start, l.dur);
                            const lineEd = ed && ed.line && ed.where !== 'stage' && edHere && ed.sentIdx === si && ed.line.n === l.n;
                            return (
                              <div className={'sent clip' + (vrewLay ? ' vside' : '') + (picked ? ' picked' : '') + (isCur ? ' cur' : '') + (lineEd ? ' editing' : '')} key={l.n} data-ln={l.n}>
                                {vrewLay ? null : insMarks}
                                <div className="clip-no cf-lineno" title="이 클립 선택 — Shift 범위 · Ctrl 더하기/빼기 · Ctrl+A 전체"
                                  onMouseDown={(ev) => { if (ev.shiftKey || ev.ctrlKey || ev.metaKey) ev.preventDefault(); }}
                                  onClick={(ev) => { ev.stopPropagation(); if (onPickCapLine) onPickCapLine(pr.shortsNum, info, ev, projLines); }}>{l.n}</div>
                                <div className="clip-body">
                                  <div className="clip-r1" onClick={(ev) => { if (ev.target === ev.currentTarget) { ev.stopPropagation(); if (onPickCapLine) onPickCapLine(pr.shortsNum, info, ev, projLines); } }}>
                                    <span className={'clip-spk' + (s.speaker ? '' : ' narr')} title={s.speaker ? `화자 「${s.speaker}」 — ⚙ 채널편집 → 🎙 음성 → 화자별 목소리` : '채널 기본 목소리'}>🗣 {s.speaker || '내레이션'}</span>
                                    {!vrewLay && tm && <span className="clip-time" title="이 줄의 시작 시각 + 길이(문장 음성 길이를 글자수 비례로 나눈 값 — .vrew 와 같다)">{tm}</span>}
                                    <span className="clip-chips">
                                      {lineWords(s.text, l.range).map((w) => (
                                        <span key={w.from} className={'chip' + (selChars.some((x) => x.from < w.to && x.to > w.from) ? ' on' : '')}
                                          title="이 단어만 서식 고르기 — Shift = 같은 문장 안에서 범위"
                                          onMouseDown={(ev) => { if (ev.shiftKey) ev.preventDefault(); }}
                                          onClick={(ev) => {
                                            ev.stopPropagation();
                                            if (!onPickCapChars) return;
                                            let from = w.from, to = w.to;
                                            if (ev.shiftKey && selChars.length) { from = Math.min(from, ...selChars.map((x) => x.from)); to = Math.max(to, ...selChars.map((x) => x.to)); }
                                            onPickCapChars(pr.shortsNum, c.num, si, { from, to });
                                          }}>{w.w}</span>
                                      ))}
                                    </span>
                                    {ai && <span className="cf-animbadge" title={`효과: ${ai.label} (${lp.anim.duration / 1000}초)`}>✨</span>}
                                  </div>
                                  <div className="clip-r2">
                                    <span className="clip-ic" aria-hidden="true">🗨</span>
                                    {lineEd ? (
                                      // 🔑 줄 글자만 고친다 — 모양(글꼴·크기·칸)은 평소 줄과 같게. 저장은 문장 앞뒤를 이어 붙여 기존 문장 저장 경로로.
                                      <textarea className="clip-edit" defaultValue={String(s.text || '').slice(ed.line.from, ed.line.to)} rows={1} spellCheck={false} autoFocus
                                        disabled={edit.busy}
                                        title="Enter 나누기 · ↑↓ 다음 클립으로(고치는 채로) · 맨 앞 ←Backspace 윗문장과 합치기 · 맨 끝 Del 아랫문장 올리기 · Esc 취소"
                                        ref={(el) => { edit.ref.current = el; fitSentBox(el); applyCaretSide(el); }}
                                        onInput={(ev) => fitSentBox(ev.currentTarget)}
                                        onBlur={() => edit.commit()}
                                        onClick={(ev) => ev.stopPropagation()}
                                        onKeyDown={(ev) => edit.lineKey(ev, { si, sents, s, l })} />
                                    ) : (
                                      <div className="clip-cap"><LineRuns text={s.text || ''} spans={s.spans} range={l.range} base={capBase} /></div>
                                    )}
                                    <button className="clip-fmt" title="이 클립 서식(⚙ 고급)" onClick={(ev) => { ev.stopPropagation(); if (edit.fmtClip) edit.fmtClip(pr.shortsNum, info); }}>가</button>
                                  </div>
                                </div>
                                {vrewLay && (
                                  <div className="clip-side" data-testid="clip-side" onClick={(ev) => ev.stopPropagation()} onMouseDown={(ev) => ev.stopPropagation()}>
                                    {(() => {
                                      // 🖼 ① 칸처럼 겹쳐 그린다 — 영상은 이 클립이 보일 때의 장면(정지 그림 · v0.5.59)
                                      const lays = layersAtOrd(pr, ord);
                                      const at = l.start != null ? l.start : sStart[ord];
                                      return (
                                        <div className={'cthumb' + (lays.length ? '' : ' empty')} title={lays.length ? '이 클립에 보이는 그림 — 누르면 이 클립으로' : '그림 없음'} data-testid="cthumb" onClick={(ev) => { ev.stopPropagation(); if (onCursor) onCursor(pr.shortsNum, l.n); }}>
                                          {lays.length ? <ClipThumb layers={lays} tAt={(so) => Math.max(0, at - (sStart[so] || 0))} /> : <span className="cthumb-none">그림 없음</span>}
                                        </div>
                                      );
                                    })()}
                                    {tm && <span className="clip-time" title="이 줄의 시작 시각 + 길이(문장 음성 길이를 글자수 비례로 나눈 값 — .vrew 와 같다)">{tm}</span>}
                                  </div>
                                )}
                              </div>
                            );
                          }
                          return (
                            <div className={'sent' + (picked ? ' picked' : '') + (cursor && cursor.shortsNum === pr.shortsNum && cursor.n === l.n ? ' cur' : '')} key={l.n} data-ln={l.n}>
                              <span className="lineno cf-lineno" title="이 자막 줄 서식 고르기 — Shift 범위 · Ctrl 더하기"
                                onMouseDown={(ev) => { if (ev.shiftKey || ev.ctrlKey || ev.metaKey) ev.preventDefault(); }}   // Shift+클릭이 브라우저 글자 선택을 만들지 않게
                                onClick={(ev) => { ev.stopPropagation(); if (onPickCapLine) onPickCapLine(pr.shortsNum, info, ev, projLines); }}>{String(l.n).padStart(2, '0')} |</span>
                              {insMarks}
                              {li === 0 && s.speaker ? <span className="sspk" title={`화자 「${s.speaker}」 — ⚙ 채널편집 → 🎙 음성 → 화자별 목소리 로 읽습니다(자막에는 안 나옵니다)`}>{s.speaker}</span> : null}
                              <LineRuns text={s.text || ''} spans={s.spans} range={l.range} base={capBase} />
                              {ai && <span className="cf-animbadge" title={`효과: ${ai.label} (${lp.anim.duration / 1000}초)`}>✨</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    </React.Fragment>
                  );
                });
                return (
                  <div className={'cut' + (isLf ? ' lf' : '') + (vrewLay ? ' vrewlay' : '') + (vrewLay && folded.has(pr.shortsNum + ':' + c.num) ? ' folded' : '')} key={c.num} data-sn={pr.shortsNum} data-g={c.num}>
                    {vrewLay ? <div className="vgutter" /> : thumbEl}
                    <div>
                      {vrewLay && (() => {
                        // 🎬 그룹 머리줄 = Vrew 의 「씬」 머리줄(v0.5.59 · 로이) — ⌄ 접기 · G번호 · 제목 · 그룹 단추 · 시작 시각 + 길이
                        const fk = pr.shortsNum + ':' + c.num, fo = folded.has(fk);
                        const t0 = sStart[gs] || 0, dur = c.groupDurationSec || 0;
                        const head = fmtClipTime(t0, 1).replace(/ \+ .*$/, '');
                        return (
                          <div className={'scene-h' + (c.isIntro ? ' intro' : '')} data-testid="scene-h">
                            <button className="sc-fold" data-testid="scene-fold" title={fo ? '이 그룹 펼치기' : '이 그룹 접기'} onClick={() => toggleFold(fk)}>{fo ? '▸' : '▾'}</button>
                            <span className="sc-num">G{c.num}</span>
                            <span className="sc-title" title={c.phase || ''}>{c.phase || ''}</span>
                            <span className="sc-btns">
                              {c.groupDurationSec > 10 && (c.sentences && c.sentences.length >= 2) &&
                                <button className="gprev split" title={`${c.groupDurationSec.toFixed(1)}초 — 10초 초과. 2개 그룹으로 분할(프롬프트 초기화)`} onClick={() => onSplit(pr.shortsNum, c.num)}>✂</button>}
                              {c.num > 1 && onMerge && <button className="gprev" title={`앞 그룹(G${c.num - 1})과 합치기 — G${c.num - 1} 그림을 이 그룹 끝까지 이어 씁니다(이 그룹의 그림은 쓰지 않습니다 · 음성은 그대로)`} onClick={() => onMerge(pr.shortsNum, c.num)}>⤒</button>}
                              <button className="gprev" title="첨부 이미지 재생성" onClick={() => onRegen(pr.shortsNum, c.num)}>🔄</button>
                              <button className="gprev" data-testid="play-group" title="이 그룹 미리듣기" onClick={() => onPlayGroup(pr.shortsNum, c.num)}>{playing && playing.key === 'group:' + pr.shortsNum + ':' + c.num ? '■' : '▶'}</button>
                              <button className="gprev" data-testid="play-from" title="여기부터 재생" onClick={() => onPlayFrom(pr.shortsNum, c.num)}>{playing && playing.key === 'from:' + pr.shortsNum + ':' + c.num ? '■' : '⏭'}</button>
                              <button className="gprev" title="이 그룹만 TTS 변환 — 채널 목소리·시드 그대로(같은 소리). Shift+클릭 = 시드를 바꿔 다른 take 로 새로 뽑기" onClick={(e) => onGroupTts(pr.shortsNum, c.num, e.shiftKey)}>🎤</button>
                              <button className="gprev" title="이 그룹만 비디오 변환" onClick={() => onGroupVid(pr.shortsNum, c.num)}>🎬</button>
                              <button className="gprev" title="이 그룹 프롬프트 보기·수정" onClick={() => onShowPrompt(pr.shortsNum, c, `${pr.title} · G${c.num}`)}>📝</button>
                            </span>
                            <span className="grow" />
                            {dur > 0 && <span className={'sc-time' + (dur > 10 ? ' over' : '')} title="그룹 시작 시각 + 길이">{head} + {dur < 10 ? dur.toFixed(1) : Math.round(dur)}초</span>}
                          </div>
                        );
                      })()}
                      {!vrewLay && <div className={'narr' + (c.isIntro ? ' intro' : '')}>
                        <div className="narr-top">
                          <span className="num">G{c.num}</span>
                          <div className="narr-btns">
                            {c.groupDurationSec ? <span className={'dur' + (c.groupDurationSec > 10 ? ' over' : '')}>▶ {c.groupDurationSec.toFixed(1)}s</span> : null}
                            {c.groupDurationSec > 10 && (c.sentences && c.sentences.length >= 2) &&
                              <button className="gprev split" title={`${c.groupDurationSec.toFixed(1)}초 — 10초 초과. 2개 그룹으로 분할(프롬프트 초기화)`} onClick={() => onSplit(pr.shortsNum, c.num)}>✂ 분할</button>}
                            {c.num > 1 && onMerge && <button className="gprev" title={`앞 그룹(G${c.num - 1})과 합치기 — G${c.num - 1} 그림을 이 그룹 끝까지 이어 씁니다(이 그룹의 그림은 쓰지 않습니다 · 음성은 그대로). 대본에 영구히 두려면 H3 아래에 「> 🖼️ 이미지: 이어서」`} onClick={() => onMerge(pr.shortsNum, c.num)}>⤒</button>}
                            <button className="gprev" title="첨부 이미지 재생성" onClick={() => onRegen(pr.shortsNum, c.num)}>🔄</button>
                            <button className="gprev" data-testid="play-group" title="이 그룹 미리듣기" onClick={() => onPlayGroup(pr.shortsNum, c.num)}>{playing && playing.key === 'group:' + pr.shortsNum + ':' + c.num ? '■' : '▶'}</button>
                            <button className="gprev" data-testid="play-from" title="여기부터 재생" onClick={() => onPlayFrom(pr.shortsNum, c.num)}>{playing && playing.key === 'from:' + pr.shortsNum + ':' + c.num ? '■' : '⏭'}</button>
                            <button className="gprev" title="이 그룹만 TTS 변환 — 채널 목소리·시드 그대로(같은 소리). Shift+클릭 = 시드를 바꿔 다른 take 로 새로 뽑기(그 그룹만 톤이 달라집니다)" onClick={(e) => onGroupTts(pr.shortsNum, c.num, e.shiftKey)}>🎤</button>
                            <button className="gprev" title="이 그룹만 비디오 변환" onClick={() => onGroupVid(pr.shortsNum, c.num)}>🎬</button>
                            <button className="gprev" title="이 그룹 프롬프트 보기·수정" onClick={() => onShowPrompt(pr.shortsNum, c, `${pr.title} · G${c.num}`)}>📝</button>
                          </div>
                        </div>
                        <div className="narr-text"><span className={'badge ' + ph[0]}>{ph[1]}</span></div>
                      </div>}
                      <div className={'sents' + (onRange && sents.length ? ' vr' : '') + (vrDrag && vrDrag.shortsNum === pr.shortsNum && vrDrag.groupNum === c.num ? ' vr-own' : '')}>
                        {vrewLay && (
                          <div className="gicon" data-testid="gicon" title={`G${c.num} · ${c.phase || ''}${c.groupDurationSec ? ' · ' + c.groupDurationSec.toFixed(1) + '초' : ''} — 누르면 그림 메뉴(미리듣기 · TTS · 프롬프트 · 합치기 …)`}>{thumbEl}</div>
                        )}
                        {onRange && sents.length && !vrewLay ? <>
                          <span className="vr-h top" title={`그림 시작 — 끌어서 이 그림(G${c.num})이 어느 문장부터 보일지 정합니다`}
                            onMouseDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); setVrDrag({ shortsNum: pr.shortsNum, groupNum: c.num, edge: 'start', gs: c.span ? c.span.from : gs, ge: c.span ? c.span.to : ge, ord: c.span ? c.span.from : gs }); }} />
                          <span className="vr-h bot" title={`그림 끝 — 끌어서 이 그림(G${c.num})을 어느 문장까지 쓸지 정합니다(다른 그룹 문장 위로 끌면 그 문장까지 이 그림이 덮습니다)`}
                            onMouseDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); setVrDrag({ shortsNum: pr.shortsNum, groupNum: c.num, edge: 'end', gs: c.span ? c.span.from : gs, ge: c.span ? c.span.to : ge, ord: c.span ? c.span.to : ge }); }} />
                        </> : null}
                        {c.span && <div className="vr-span" data-testid="vr-span" title="이 그림은 자기 그룹 밖까지 아래층으로 이어집니다 — 그 사이 그룹의 그림은 그 위에 보입니다">🖼 그림 범위 문장 {c.span.from}~{c.span.to} (아래층으로 이어 깔림)</div>}
                        {lineEls}
                      </div>
                    </div>
                  </div>
                );
              })}
              {vrewLay && onRange ? <RailLayer pr={pr} drag={vrDrag && vrDrag.shortsNum === pr.shortsNum ? vrDrag : null} pending={vrPending && vrPending.shortsNum === pr.shortsNum ? vrPending : null} onGrab={(c, edge, r) => grabRail(pr.shortsNum, c, edge, r)} /> : null}
              {vrewLay && onInsMark && (pr.overlays || []).length ? <LaneLayer pr={pr} onInsMark={onInsMark} onInsRange={onInsRange} /> : null}
            </div>
          </div>
        );
      })}
      {vrMenu && <VrMenu m={vrMenu} close={() => setVrMenu(null)} setSub={(v) => setVrMenu((cur) => (cur ? { ...cur, sub: v } : cur))}
        onPreview={onPreview} onAttach={onAttach} onClear={onClear} onRegen={onRegen} onGroupVid={onGroupVid} onRange={onRange} onLook={onLook} onAiRange={onAiRange} onOverlay={onOverlay}
        grp={vrewLay ? { onPlayGroup, onPlayFrom, onGroupTts, onShowPrompt, onMerge, onSplit, playing } : null} />}
      {vrDrag && <div className="vr-tip">🖼 G{vrDrag.groupNum} 그림 → 문장 {vrRangeOf(vrDrag).from}~{vrRangeOf(vrDrag).to} · 놓으면 적용 · Esc 취소</div>}
    </div>
  );
}

// 🧭 끌기 — **마우스 높이로** 문장(클립)을 고른다(v0.5.60). 🔴 예전엔 마우스 밑의 요소(elementFromPoint)로 찾아서,
//   손잡이를 곧장 아래로 끌면 마우스가 왼쪽 막대 칸에 머물러 클립을 못 찾았다 → 늘리기가 「반응 없음」(로이 2026-09-25).
//   끝 손잡이는 마우스가 그 클립 윗변을 넘으면 · 시작 손잡이는 아랫변 위면 그 클립. 접힌 그룹(높이 0)은 건너뛴다.
function ordAtY(sn, clientY, edge) {
  const bl = [...document.querySelectorAll('.sblk[data-sn="' + sn + '"][data-ord]')];
  let best = null;
  if (edge === 's') {
    for (const b of bl) { const r = b.getBoundingClientRect(); if (!r.height) continue; if (clientY <= r.bottom) return Number(b.dataset.ord); best = Number(b.dataset.ord); }
  } else {
    for (const b of bl) { const r = b.getBoundingClientRect(); if (!r.height) continue; if (clientY >= r.top || best == null) best = Number(b.dataset.ord); else break; }
  }
  return best;
}
// 끌기 중 마우스가 목록 위·아래 끝에 가면 저절로 스크롤(긴 편에서도 끝까지 늘릴 수 있게)
function dragAutoScroll(getY) {
  let on = true;
  const pane = document.querySelector('main.pane2') || document.scrollingElement;
  const tick = () => {
    if (!on) return;
    const y = getY();
    if (y != null && pane) {
      const r = pane === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : pane.getBoundingClientRect();
      const d = y < r.top + 50 ? -(r.top + 50 - y) : (y > r.bottom - 50 ? y - (r.bottom - 50) : 0);
      if (d) pane.scrollTop += Math.max(-30, Math.min(30, d / 2));
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => { on = false; };
}
// 🖼 편 문장 번호 ord 에 보이는 그림들(아래 → 위) — ① 칸 visLayersAt 과 같은 규칙(앞 그룹 이어 깔기 < 뒤 그룹 < ➕ 삽입).
//   startOrd = 그 그림이 처음 보이는 문장(영상이면 거기서부터 흐른 시간으로 장면을 고른다 · v0.5.59)
function layersAtOrd(pr, ord) {
  const out = [];
  let o = 0;
  for (const c of (pr && pr.cuts) || []) {
    const a = o + 1, b = o + (c.sentences || []).length; o = b;
    if (!(c.imagePath || c.videoPath)) continue;
    const r = c.span || { from: a, to: b };
    if (ord >= r.from && ord <= r.to) {
      const lk = c.look || null;
      out.push({ key: 'g' + c.num, video: !!c.videoPath, file: c.videoPath || c.imagePath, version: c.videoPath ? c.videoVersion : c.imageVersion, box: lk && lk.box ? lk.box : null, flipH: !!(lk && lk.flipH), flipV: !!(lk && lk.flipV), startOrd: r.from });
    }
  }
  for (const v of ((pr && pr.overlays) || [])) {
    if (v.broken || v.kind === 'audio' || ord < v.from || ord > v.to) continue;
    out.push({ key: 'o' + v.id, video: v.kind === 'video', file: v.file, version: v.version, box: v.box || null, fit: 'contain', startOrd: v.from });
  }
  return out;
}
// 🖼 영상 한 장면(정지 그림) — 클립마다 <video> 를 두면 영상 플레이어 수 한도(약 75개)를 넘어 검은 화면이 된다.
//   main 이 ffmpeg 로 뽑아 캐시해 둔 jpg 를 보여 준다. 화면에 보일 때만 요청한다.
const _frameCache = new Map();
function FrameImg({ file, version, t, fit }) {
  const key = file + '|' + (version || '') + '|' + (Math.round(Math.max(0, t || 0) * 2) / 2);
  const [src, setSrc] = useState(() => _frameCache.get(key) || null);
  const ref = useRef(null);
  useEffect(() => {
    if (_frameCache.has(key)) { setSrc(_frameCache.get(key)); return undefined; }
    setSrc(null);
    let dead = false;
    const go = () => { api.videoFrame({ file, t }).then((p) => { if (p) _frameCache.set(key, media(p)); if (!dead) setSrc(p ? media(p) : ''); }).catch(() => {}); };
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { go(); return () => { dead = true; }; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => { dead = true; io.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return src ? <img ref={ref} src={src} alt="" data-testid="frame-img" style={fit ? { objectFit: fit } : undefined} /> : <span ref={ref} className="frame-wait" data-testid="frame-wait" />;
}
// 🖼 클립 오른쪽 작은 그림 — ① 칸처럼 그림들을 겹쳐 그린다(삽입 그림·영상은 제 자리 · 크기로). tAt(startOrd) = 그 그림이 흐른 시간
function ClipThumb({ layers, tAt }) {
  return (
    <>
      {layers.slice(-3).map((L) => {
        const st = L.box ? { left: L.box.x * 100 + '%', top: L.box.y * 100 + '%', width: L.box.w * 100 + '%', height: L.box.h * 100 + '%' } : null;
        const flip = (L.flipH || L.flipV) ? { transform: `scale(${L.flipH ? -1 : 1},${L.flipV ? -1 : 1})` } : null;
        const fit = L.box ? 'fill' : (L.fit || null);
        return (
          <span key={L.key} className={'cl-layer' + (L.box ? ' bx' : '')} style={{ ...(st || {}), ...(flip || {}) }}>
            {L.video ? <FrameImg file={L.file} version={L.version} t={tAt(L.startOrd)} fit={fit} /> : <img src={media(L.file, L.version)} alt="" style={fit ? { objectFit: fit } : undefined} />}
          </span>
        );
      })}
    </>
  );
}
// ➕ 삽입 범위 막대(Vrew 왼쪽 칸) — 시작 클립 윗변부터 끝 클립 아랫변까지 **한 줄로 이어진** 선(그룹 머리줄·틈을 건너도 끊기지 않는다).
//   위치는 화면에서 잰다(클립 높이·접힌 그룹이 달라도 맞다). 양 끝의 손잡이 = 시작점·끝점 — 끌면 범위를 바꾼다(Vrew).
function LaneLayer({ pr, onInsMark, onInsRange }) {
  const ref = useRef(null);
  const [geo, setGeo] = useState([]);
  const [drag, setDrag] = useState(null);   // { id, edge:'s'|'e', from, to }
  const dragRef = useRef(null); dragRef.current = drag;
  // 놓은 뒤 main 이 새 범위를 돌려줄 때까지 **새 범위로** 그려 둔다(예전엔 옛 범위로 튀었다가 한참 뒤 바뀌었다)
  const [pending, setPending] = useState(null);   // { id, from, to, at }
  const pendRef = useRef(null); pendRef.current = pending;
  useEffect(() => {
    if (!pending) return undefined;
    const o = (pr.overlays || []).find((x) => x.id === pending.id);
    if (!o || (o.from === pending.from && o.to === pending.to)) { setPending(null); return undefined; }
    const t = setTimeout(() => setPending(null), 4000);
    return () => clearTimeout(t);
  }, [pending, pr]);
  const measure = () => {
    const layer = ref.current; if (!layer) return;
    const grid = layer.parentElement; if (!grid) return;
    const G = grid.getBoundingClientRect();
    const sn = pr.shortsNum;
    const rectOf = (ord, end) => {
      const b = grid.querySelector(`.sblk[data-sn="${sn}"][data-ord="${ord}"]`);
      if (!b) return null;
      if (b.offsetParent) {
        const cl = b.querySelectorAll('.sent.clip');
        const t = cl.length ? cl[end ? cl.length - 1 : 0] : b;
        return t.getBoundingClientRect();
      }
      // 접힌 그룹 — 그 그룹 머리줄
      const cut = b.closest('.cut'); const h = cut && cut.querySelector('.scene-h');
      return (h || cut || b).getBoundingClientRect();
    };
    const any = grid.querySelector(`.sblk[data-sn="${sn}"] .sent.clip`);
    const x0 = any ? any.getBoundingClientRect().left - G.left : 120;
    const out = [];
    (pr.overlays || []).forEach((o, oi) => {
      if (o.broken) return;
      const d = dragRef.current && dragRef.current.id === o.id ? dragRef.current : (pendRef.current && pendRef.current.id === o.id ? pendRef.current : null);
      const f = d ? Math.min(d.from, d.to) : o.from, t = d ? Math.max(d.from, d.to) : o.to;
      const a = rectOf(f, false), b = rectOf(t, true);
      if (!a || !b) return;
      out.push({ id: o.id, oi, top: Math.round(a.top - G.top), bot: Math.round(b.bottom - G.top), left: Math.round(x0 - 58 - 28 * (oi + 1)) });
    });
    setGeo((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const layer = ref.current; const grid = layer && layer.parentElement;
    if (!grid || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(grid);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 끝점 끌기 — 놓은 자리의 문장까지
  useEffect(() => {
    if (!drag) return undefined;
    let lastY = null;
    const pick = () => {
      const d = dragRef.current; if (!d || lastY == null) return;
      const o = ordAtY(pr.shortsNum, lastY, d.edge); if (o == null) return;
      // 시작점이 끝점을 넘거나 끝점이 시작점보다 앞으로 가지 않게(범위는 최소 한 클립)
      const nd = d.edge === 's' ? { ...d, from: Math.min(o, d.to) } : { ...d, to: Math.max(o, d.from) };
      if (nd.from !== d.from || nd.to !== d.to) { dragRef.current = nd; setDrag(nd); }
    };
    const move = (ev) => { lastY = ev.clientY; pick(); };
    const stopScroll = dragAutoScroll(() => lastY);
    const onScroll = () => pick();
    const pane = document.querySelector('main.pane2');
    if (pane) pane.addEventListener('scroll', onScroll);
    const up = () => {
      const d = dragRef.current; setDrag(null);
      const ov = d && (pr.overlays || []).find((x) => x.id === d.id);
      if (d && ov && onInsRange) {
        const f = Math.min(d.from, d.to), t = Math.max(d.from, d.to);
        if (f !== ov.from || t !== ov.to) { setPending({ id: d.id, from: f, to: t }); onInsRange(pr.shortsNum, d.id, f, t); }
      }
    };
    const esc = (ev) => { if (ev.key === 'Escape') { dragRef.current = null; setDrag(null); } };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); document.addEventListener('keydown', esc);
    document.body.classList.add('vr-dragging');
    return () => { stopScroll(); if (pane) pane.removeEventListener('scroll', onScroll); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.removeEventListener('keydown', esc); document.body.classList.remove('vr-dragging'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag]);
  return (
    <div className="lane-layer" ref={ref} data-testid="lane-layer">
      {geo.map((g) => {
        const o = (pr.overlays || []).find((x) => x.id === g.id); if (!o) return null;
        const d = drag && drag.id === o.id ? drag : null;
        const dp = d || (pending && pending.id === o.id ? pending : null);
        const f = dp ? Math.min(dp.from, dp.to) : o.from, t = dp ? Math.max(dp.from, dp.to) : o.to;
        const label = `${o.kind === 'audio' ? '🎵 오디오' : o.kind === 'video' ? '🎬 영상' : '🖼 그림'} 「${o.name || ''}」 · ${f === 1 && t === o.total ? '전체' : `클립 ${f}~${t}`}${o.once ? ' · 1회 재생' : ''}`;
        const cap = (edge) => (
          <span className={'lcap ' + edge} data-testid={'lane-cap-' + edge}
            title={(edge === 's' ? `시작점 — 클립 ${f}` : `끝점 — 클립 ${t}`) + ' · 끌어서 범위 바꾸기'}
            onMouseDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); setDrag({ id: o.id, edge, from: o.from, to: o.to }); }} />
        );
        return (
          <div key={o.id} className={'lanev ' + o.kind + (d ? ' drag' : '')} data-testid="ins-lane" data-id={o.id} data-from={f} data-to={t}
            style={{ left: g.left, top: g.top, height: Math.max(8, g.bot - g.top) }} title={label}>
            <span className="lline" />
            {cap('s')}{cap('e')}
            <button className={'ins-mark ' + o.kind} data-testid="ins-mark" data-kind={o.kind} title={label + ' — 누르면 적용 범위 · 삭제'}
              onMouseDown={(ev) => ev.stopPropagation()}
              onClick={(ev) => { ev.stopPropagation(); onInsMark(pr.shortsNum, o.id, ev.currentTarget); }}>
              {o.kind === 'image' ? <img src={media(o.file, o.version)} alt="" /> : (o.kind === 'video' ? '🎬' : '🎵')}
            </button>
          </div>
        );
      })}
      {drag && (() => { const f = Math.min(drag.from, drag.to), t = Math.max(drag.from, drag.to); return <div className="vr-tip">➕ 삽입 범위 → 클립 {f}~{t} · 놓으면 적용 · Esc 취소</div>; })()}
    </div>
  );
}
// 🖼 그룹 그림 범위 선(Vrew 그림의 파란 선 · v0.5.61) — 시작 클립 윗변 ~ 끝 클립 아랫변을 화면에서 재서 **그룹을 넘어 한 줄로**.
//   자기 그룹 안 = 실선 · 밖(다음 그룹 밑으로 이어 깔린 곳 = 아래층) = 조금 왼쪽의 점선(다음 그룹 선에 가려지지 않게).
//   양 끝 손잡이 = 시작점·끝점 — 끌면 Cards 의 vrDrag 가 범위를 바꾸고, 선은 끄는 동안 · 놓은 직후(pending)에도 따라온다.
function blockRect(grid, sn, ord, end) {
  const b = grid.querySelector(`.sblk[data-sn="${sn}"][data-ord="${ord}"]`);
  if (!b) return null;
  if (b.offsetParent) {
    const cl = b.querySelectorAll('.sent.clip');
    const t = cl.length ? cl[end ? cl.length - 1 : 0] : b;
    return t.getBoundingClientRect();
  }
  const cut = b.closest('.cut'); const h = cut && cut.querySelector('.scene-h');
  return (h || cut || b).getBoundingClientRect();
}
function RailLayer({ pr, drag, pending, onGrab }) {
  const ref = useRef(null);
  const [geo, setGeo] = useState([]);
  const measure = () => {
    const layer = ref.current; if (!layer) return;
    const grid = layer.parentElement; if (!grid) return;
    const G = grid.getBoundingClientRect(); const sn = pr.shortsNum;
    const out = []; let o = 0;
    for (const c of pr.cuts) {
      const n = (c.sentences || []).length; const gs = o + 1, ge = o + n; o = ge;
      if (!n) continue;
      const d = drag && drag.groupNum === c.num ? vrRangeOf(drag) : (pending && pending.groupNum === c.num ? pending : null);
      const r = d || c.span || { from: gs, to: ge };
      const a = blockRect(grid, sn, r.from, false), b = blockRect(grid, sn, r.to, true);
      const a2 = blockRect(grid, sn, gs, false), b2 = blockRect(grid, sn, ge, true);
      const cut = grid.querySelector(`.cut[data-sn="${sn}"][data-g="${c.num}"] .sents`);
      if (!a || !b || !a2 || !b2 || !cut) continue;
      out.push({ num: c.num, from: r.from, to: r.to, gs, ge, has: !!(c.imagePath || c.videoPath), live: !!d,
        top: Math.round(a.top - G.top), bot: Math.round(b.bottom - G.top), ownTop: Math.round(a2.top - G.top), ownBot: Math.round(b2.bottom - G.top), x: Math.round(cut.getBoundingClientRect().left - G.left) });
    }
    setGeo((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const grid = ref.current && ref.current.parentElement;
    if (!grid || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure()); ro.observe(grid);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="rail-layer" ref={ref} data-testid="rail-layer">
      {geo.map((g) => {
        const c = pr.cuts.find((x) => x.num === g.num); if (!c) return null;
        const segs = [];
        const iT = Math.max(g.top, g.ownTop), iB = Math.min(g.bot, g.ownBot);
        if (iB > iT) segs.push({ k: 'own', t: iT, b: iB, ext: false });
        if (g.top < g.ownTop) segs.push({ k: 'up', t: g.top, b: Math.min(g.bot, g.ownTop), ext: true });
        if (g.bot > g.ownBot) segs.push({ k: 'dn', t: Math.max(g.top, g.ownBot), b: g.bot, ext: true });
        const topExt = g.top < g.ownTop, botExt = g.bot > g.ownBot;
        const L = g.x - 10;   // 층 안 기준 — 실선 = +12 · 점선 = +5
        const grab = (edge) => (ev) => { ev.preventDefault(); ev.stopPropagation(); onGrab(c, edge, { from: g.from, to: g.to }); };
        const tip = `G${c.num} 그림 범위 — 문장 ${g.from}~${g.to}${g.to > g.ge || g.from < g.gs ? ' (자기 그룹 밖은 아래층으로 이어 깔림 — 점선)' : ''}`;
        return (
          <div key={g.num} className={'rail' + (g.live ? ' live' : '') + (g.has ? '' : ' noimg')} data-testid="rail" data-g={g.num} data-from={g.from} data-to={g.to}
            style={{ left: L, top: g.top, height: Math.max(8, g.bot - g.top) }} title={tip}>
            {segs.map((sg) => <span key={sg.k} className={'rseg' + (sg.ext ? ' ext' : '')} data-testid={sg.ext ? 'rail-ext' : 'rail-own'} style={{ top: sg.t - g.top, height: Math.max(2, sg.b - sg.t) }} />)}
            <span className={'vr-h top' + (topExt ? ' ext' : '')} data-testid="rail-h-s" title={`그림 시작점 — 문장 ${g.from} · 끌어서 이 그림(G${c.num})이 어느 클립부터 보일지`} onMouseDown={grab('start')} />
            <span className={'vr-h bot' + (botExt ? ' ext' : '')} data-testid="rail-h-e" title={`그림 끝점 — 문장 ${g.to} · 끌어서 이 그림(G${c.num})을 어느 클립까지 쓸지(다른 그룹 위로 끌면 그 밑에 이어 깔린다)`} onMouseDown={grab('end')} />
          </div>
        );
      })}
    </div>
  );
}
// 끌기 중 범위 — 시작 손잡이는 끝을, 끝 손잡이는 시작을 고정한다
function vrRangeOf(d) {
  if (d.edge === 'start') return { from: Math.min(d.ord, d.ge), to: d.ge };
  return { from: d.gs, to: Math.max(d.ord, d.gs) };
}

// ➕ 이 문장에서 시작하는 삽입(편 문장 번호 from 과 같을 때)
function insMarksAt(pr, cut, si) {
  const L = (pr && pr.overlays) || []; if (!L.length) return [];
  let o = 0;
  for (const c of pr.cuts) { if (c === cut) { o += si + 1; break; } o += (c.sentences || []).length; }
  return L.filter((x) => !x.broken && x.from === o);
}
function ovAsLayer(o) {
  return { num: 'O' + o.id, ovId: o.id, once: !!o.once, ovFrom: o.from, ovVol: o.kind === 'video' ? (o.volume == null ? 100 : o.volume) : 0, imagePath: o.kind === 'image' ? o.file : null, videoPath: o.kind === 'video' ? o.file : null,
    imageVersion: o.version, videoVersion: o.version, look: o.box ? { motion: 'none', box: o.box } : { motion: 'none', fill: 'contain' } };   // 자리가 없으면 화면 가득(비율이 다르면 맞추기 — vrew-builder 와 같다)
}
// 🖼 썸네일 메뉴(Vrew 의 그림 메뉴) — 흩어져 있던 기능 + 채우기 · 반전 · 움직임 · 적용 범위 변경. kind 'ai' = AI 고지 꼬리표 메뉴
function VrMenu({ m, close, setSub, onPreview, onAttach, onClear, onRegen, onGroupVid, onRange, onLook, onAiRange, onOverlay, grp }) {
  const sn = m.shortsNum;
  const go = (fn) => () => { close(); fn(); };
  const style = { left: Math.min(m.x, window.innerWidth - 260), top: Math.min(m.y, window.innerHeight - 320) };
  const chk = (on) => <span className="vr-chk">{on ? '✓' : ''}</span>;
  if (m.kind === 'ai') {
    const cur = m.cur;
    return (
      <div className="vr-menu" style={style} data-testid="vr-menu">
        <div className="vr-cur">🏷 AI 고지 — 지금: {cur ? `문장 ${cur.from}~${cur.to}` : '5초 뒤 5초 동안(채널 기본)'}</div>
        <button onClick={go(() => onAiRange(sn, 1, m.n))}>전체 클립으로</button>
        <button onClick={go(() => onAiRange(sn, 1, m.ord))}>처음부터 이 클립까지</button>
        <button onClick={go(() => onAiRange(sn, m.ord, m.n))}>이 클립부터 끝까지</button>
        <button onClick={go(() => onAiRange(sn, null, null, { n: m.n, cur: cur ? `${cur.from}-${cur.to}` : '1-3' }))}>직접 입력…</button>
        {cur && <><div className="vr-sep" /><button onClick={go(() => onAiRange(sn, null, null))}>채널 기본으로(5초 뒤 5초)</button></>}
      </div>
    );
  }
  const c = m.c;
  const has = !!(c.imagePath || c.videoPath);
  const lk = VLook.normLook(c.look);
  const look = (patch) => go(() => onLook(sn, c.num, patch));
  const back = <button className="vr-back" onClick={() => setSub(null)}>‹ {({ range: '적용 범위 변경', fill: '채우기', flip: '반전', motion: '움직임(애니메이션)' })[m.sub]}</button>;
  if (m.sub === 'range') {
    return (
      <div className="vr-menu" style={style} data-testid="vr-menu">
        {back}
        <div className="vr-cur">지금: 문장 {m.gs}~{m.ge} (편 전체 {m.n}문장)</div>
        <button onClick={go(() => onRange(sn, c.num, 1, m.n))}>전체 클립으로</button>
        <button onClick={go(() => onRange(sn, c.num, 1, m.ge))}>처음부터 이 그림 끝까지</button>
        <button onClick={go(() => onRange(sn, c.num, m.gs, m.n))}>이 그림부터 끝까지</button>
        <button onClick={go(() => onRange(sn, c.num, null, null, { gs: m.gs, ge: m.ge, n: m.n }))}>직접 입력…</button>
      </div>
    );
  }
  if (m.sub === 'fill') {
    return (
      <div className="vr-menu" style={style} data-testid="vr-menu">
        {back}
        {VLook.FILLS.map((f) => <button key={f.id} title={f.hint} onClick={look({ fill: f.id })}>{chk(lk.fill === f.id)}{f.label}</button>)}
      </div>
    );
  }
  if (m.sub === 'flip') {
    return (
      <div className="vr-menu" style={style} data-testid="vr-menu">
        {back}
        <button onClick={look({ flipH: !lk.flipH })}>{chk(lk.flipH)}좌우 반전</button>
        <button onClick={look({ flipV: !lk.flipV })}>{chk(lk.flipV)}상하 반전</button>
        {(lk.flipH || lk.flipV) && <><div className="vr-sep" /><button onClick={look({ flipH: false, flipV: false })}>반전 없애기</button></>}
      </div>
    );
  }
  if (m.sub === 'motion') {
    return (
      <div className="vr-menu" style={style} data-testid="vr-menu">
        {back}
        {VLook.MOTIONS.map((x) => <button key={x.id} onClick={look({ motion: x.id })}>{chk(lk.motion === x.id)}{x.label}</button>)}
      </div>
    );
  }
  const pk = grp && grp.playing ? grp.playing.key : null;
  return (
    <div className="vr-menu" style={style} data-testid="vr-menu">
      {grp && <div className="vr-cur" data-testid="vr-grp">G{c.num} · {c.phase || ''}{c.groupDurationSec ? ` · ${c.groupDurationSec.toFixed(1)}초` : ''}</div>}
      {grp && <>
        <button data-testid="mn-play-group" title="이 그룹 미리듣기" onClick={go(() => grp.onPlayGroup(sn, c.num))}>{pk === 'group:' + sn + ':' + c.num ? '■ 멈춤' : '▶ 이 그룹 미리듣기'}</button>
        <button data-testid="mn-play-from" title="여기부터 재생" onClick={go(() => grp.onPlayFrom(sn, c.num))}>{pk === 'from:' + sn + ':' + c.num ? '■ 멈춤' : '⏭ 여기부터 재생'}</button>
        <button title="이 그룹만 TTS 변환 — Shift+클릭 = 시드를 바꿔 다른 take" onClick={(e) => { close(); grp.onGroupTts(sn, c.num, e.shiftKey); }}>🎤 이 그룹 TTS</button>
        <button title="이 그룹 프롬프트 보기·수정" onClick={go(() => grp.onShowPrompt(sn, c, `G${c.num}`))}>📝 프롬프트</button>
        {(c.num > 1 && grp.onMerge) && <button title={`앞 그룹(G${c.num - 1})과 합치기 — 앞 그룹 그림을 이 그룹 끝까지 이어 씁니다`} onClick={go(() => grp.onMerge(sn, c.num))}>⤒ 앞 그룹과 합치기</button>}
        {c.groupDurationSec > 10 && (c.sentences && c.sentences.length >= 2) && <button title="10초 초과 — 2개 그룹으로 분할(프롬프트 초기화)" onClick={go(() => grp.onSplit(sn, c.num))}>✂ 그룹 분할</button>}
        <div className="vr-sep" />
      </>}
      {c.videoPath ? <button onClick={go(() => onPreview('vid', media(c.videoPath, c.videoVersion)))}>🔍 크게 보기</button>
        : c.imagePath ? <button onClick={go(() => onPreview('img', media(c.imagePath, c.imageVersion)))}>🔍 크게 보기</button> : null}
      {has && onLook && <>
        <button onClick={() => setSub('fill')}>⛶ 채우기 <span className="vr-val">{VLook.FILLS.find((f) => f.id === lk.fill).label}</span> ›</button>
        <button onClick={() => setSub('flip')}>⇋ 반전 <span className="vr-val">{lk.flipH || lk.flipV ? [lk.flipH ? '좌우' : '', lk.flipV ? '상하' : ''].filter(Boolean).join('·') : '없음'}</span> ›</button>
        {lk.box && <button onClick={look({ box: null })}>📐 자리·크기 원래대로</button>}
        {c.imagePath && !c.videoPath && <button onClick={() => setSub('motion')}>🎞 움직임 <span className="vr-val">{VLook.MOTIONS.find((x) => x.id === lk.motion).label.replace(/\(.*\)/, '')}</span> ›</button>}
        <div className="vr-sep" />
      </>}
      <button onClick={go(() => onAttach(sn, c.num))}>🔁 {has ? '교체' : '첨부'} (파일)</button>
      <button onClick={go(() => onRegen(sn, c.num))}>🖼 AI로 이미지 생성</button>
      <button onClick={go(() => onGroupVid(sn, c.num))}>🎬 AI로 비디오 생성</button>
      <div className="vr-sep" />
      <button onClick={() => setSub('range')}>↕ 적용 범위 변경 ›</button>
      {has && <><div className="vr-sep" /><button className="vr-del" onClick={go(() => onClear(sn, c.num))}>🗑 삭제</button></>}
    </div>
  );
}

function Thumb({ c, isLf, onAttach, onClear, onPreview, onMenu }) {
  const cls = isLf ? ' lf' : '';
  // 🖼 메뉴가 있으면 썸네일을 누르면 메뉴(Vrew 방식) — 크게 보기·교체는 메뉴 안에
  const onImgClick = onMenu || (() => onPreview('img', media(c.imagePath, c.imageVersion)));
  const onEmpty = onMenu || onAttach;
  const clearBtn = <button className="thumbx" title="첨부 삭제" onClick={(e) => { e.stopPropagation(); onClear(); }}>✕</button>;
  const genOv = (txt) => <div className="genoverlay"><div className="spin" /><div>{txt}</div></div>;
  if (c.videoPath) {
    return (
      <div className={'thumbwrap' + cls}>
        <video className={'thumb' + cls} src={media(c.videoPath, c.videoVersion)} muted loop playsInline preload="metadata" onClick={onMenu || undefined} />
        <button className="vidplay" title="재생 / 정지" onClick={(e) => { e.stopPropagation(); const v = e.currentTarget.parentElement.querySelector('video'); if (!v) return; if (v.paused) { v.play(); e.currentTarget.classList.add('playing'); } else { v.pause(); e.currentTarget.classList.remove('playing'); } }}>▶</button>
        <span className="playbadge">🎬 영상</span>{clearBtn}
        {c.videoStatus === 'upscaling' ? genOv('⬆ 업스케일 중…') : null}
      </div>
    );
  }
  if (c.imagePath) {
    return (
      <div className={'thumbwrap' + cls}>
        <img className={'thumb' + cls} src={media(c.imagePath, c.imageVersion)} title={onMenu ? '클릭: 메뉴(크게 보기 · 교체 · AI 생성 · 적용 범위)' : '클릭: 미리보기'} onClick={onImgClick} alt="" />
        {c.videoStatus === 'generating' ? genOv('🎬 영상 변환 중…') : null}{clearBtn}
      </div>
    );
  }
  if (c.imageStatus === 'generating') {
    return <div className={'thumbwrap' + cls}><div className={'thumb none gen' + cls} />{genOv('🖼 이미지 생성 중…')}</div>;
  }
  if (c.imageStale) {
    return <div className={'thumbwrap' + cls} title="새 이미지가 필요합니다 — 클릭: 메뉴" onClick={onEmpty}>
      <div className={'thumb none gen' + cls} />
      <div className="genoverlay"><div>📝 새 이미지 필요</div></div>
    </div>;
  }
  if (c.covered) {
    return <div className={'thumb none covered' + cls} data-testid="thumb-covered" title={`G${c.covered} 그림이 아래층으로 이어져 이 그룹에도 보입니다 — 따로 그림을 넣으면 그 위에 얹힙니다 · 클릭: 메뉴`} onClick={onEmpty}><span>⤓ G{c.covered} 그림</span></div>;
  }
  return <div className={'thumb none' + cls} title={onMenu ? '클릭: 메뉴(첨부 · AI 생성 · 적용 범위)' : '클릭: 이미지/영상 첨부'} onClick={onEmpty}>＋</div>;
}
