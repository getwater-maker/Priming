/**
 * core/vrew-render.js — .vrew → 유튜브 업로드용 MP4 직접 렌더 (Vrew 「내보내기」 대체)
 * ---------------------------------------------------------------------------
 * 🔑 왜 .vrew 를 입력으로 쓰나
 *   .vrew 는 결과물이 아니라 **설계도**다. vrew-builder 가 이미 문장별 길이·자막 줄별 시간
 *   슬라이스·켄번스 패턴·자산 배정·AI 고지를 계산해 넣어 두었다. Vrew 는 그걸 픽셀로 굽는
 *   렌더러일 뿐이다. 같은 .vrew 를 읽으면 **Vrew 와 똑같은 입력**으로 렌더할 수 있고, 자산이
 *   zip 안에 있으니 경로가 어긋날 여지도 없다(렌더 규칙을 앱 모델에서 다시 계산하면 두 벌이 된다).
 *
 * 실측 대조([고전_0926] 17분 16초 · Vrew 내보내기 결과와 비교 · 2026-09-22):
 *   길이 1036.0초 일치 · 자막 픽셀 단위 일치 · 장면 전환 1프레임 이내 · 음성 싱크 전 구간 0.0초 ·
 *   화면 오차 평균 5.81(0~255, 리샘플링 수준).
 *
 * 🔴 밟은 함정(다음 사람도 밟는다)
 *   ① 🔴 켄번스에 zoompan 을 쓰면 **화면이 흔들린다**(정수 픽셀 반올림) → perspective 로 소수점 보간
 *      — kenBurnsFilter 주석. (정지 프레임만 비교하면 이 결함이 안 보인다 — 이웃 프레임 이동량을 잴 것)
 *   ② mp3 실제 길이 합 ≠ .vrew 선언 길이 합(1030.3 vs 1036.0) — 그냥 붙이면 최대 3초 어긋난다.
 *   ③ ffmpeg 필터에 경로를 넣지 않는다(드라이브 콜론·한글) — cwd 를 작업 폴더로 두고 ASCII 파일명만.
 *   ④ SRT 를 subtitles 필터에 물리면 384x288 좌표계로 읽혀 3.75배 커진다 → ASS 를 직접 만든다.
 *
 * 어떤 경우에도 던지지 않는다 — {ok:false, error} 를 돌려준다(.vrew 는 이미 만들어져 있으므로
 * MP4 가 실패해도 작업 전체가 실패한 것은 아니다).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const FPS = 30;
const W = 1920;
const H = 1080;
const A_RATE = 48000;
const AUDIO_CHUNK = 40;          // 한 ffmpeg 호출에 넣는 최대 음성 입력 수(윈도우 명령줄 한계)
const DEFAULT_CHUNK_SEC = 20;    // 긴 이미지 구간을 나누는 단위(병렬 렌더 효율)

// ── Vrew 좌표 → 픽셀 (실측 보정값) ──────────────────────────────────────────
//   글자 크기: Vrew size × 0.72 (기준점 둘로 확인 — 자막 100→72, AI 고지 75→54)
//   텍스트박스 안쪽 여백: 가로 약 24.6px (자막 박스 왼끝 38.4 + 24.6 = 63 · AI 고지 38.4 + 23.6 = 62)
//   하단 자막: yOffset -0.125 에서 MarginV 173 (yOffset 1 단위 = 화면 높이의 절반 = 540px)
//   ⚠ 하단·왼쪽정렬·yOffset -0.125 **한 가지 스타일만** 실측으로 맞췄다(로이 채널 5개가 전부 이 스타일).
//     다른 위치·정렬은 같은 공식을 쓰지만 검증되지 않았다 → 로그로 알린다.
const SIZE_K = 0.72;
const BOX_PAD_X = 24.6;
const WEB_PAD_X = 23.6;
const WEB_PAD_Y = 12.2;
const CAP_BOTTOM_BASE = 105.5;   // yOffset 0 일 때의 하단 여백(= 173 − 0.125×540)
const HALF_H = H / 2;

function getFfmpeg() {
  try { return require('./media-utils').getFfmpegPath(); } catch (_) { return require('ffmpeg-static'); }
}

function ff(args, { cwd, signal, low = false } = {}) {
  return new Promise((res, rej) => {
    const cp = execFile(getFfmpeg(), args, { cwd, maxBuffer: 1 << 26, windowsHide: true }, (err, so, se) => {
      if (err) rej(new Error(String(se || err.message || err).split('\n').filter(Boolean).slice(-3).join(' / ')));
      else res(String(se || ''));
    });
    // 🔑 화면 조각은 우선순위를 낮춘다 — 동시에 도는 음성 AAC 인코딩이 CPU 를 먼저 쓰게.
    //   실측: 둘이 같은 순위면 음성이 128초로 늘어 전체가 음성을 기다렸다(화면은 94초).
    //   ⚠ 음성 코더를 'fast' 로 바꾸면 4배 빠르지만 **음질을 깎는 선택이라 하지 않는다**.
    //   덤으로 렌더 중에도 앱 화면이 덜 굼뜨다.
    if (low && cp.pid) { try { os.setPriority(cp.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) {} }
    if (signal) signal.push(cp);
  });
}

// ── 인코더: NVENC 가 있으면 쓰고, 없으면 CPU(libx264) ─────────────────────────
//   🔑 아내 PC 는 NVIDIA 가 없다(nvidia-smi 응답 없음) — NVENC 만 가정하면 그 PC 에서는 전부 실패한다.
let _encCache = null;
async function pickEncoder(tmpDir, log) {
  if (_encCache) return _encCache;
  try {
    const probe = path.join(tmpDir, '_nvenc_probe.mp4');
    await ff(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=30',
      '-frames:v', '5', '-c:v', 'h264_nvenc', '-preset', 'p4', probe]);
    try { fs.unlinkSync(probe); } catch (_) {}
    _encCache = 'nvenc';
  } catch (e) {
    _encCache = 'x264';
    if (log) log(`   ⓘ NVENC(그래픽카드 인코더)를 쓸 수 없어 CPU 인코딩으로 굽습니다 — 느려집니다`);
  }
  return _encCache;
}
/**
 * 🔴 **B-프레임을 끈다(`-bf 0`)** — 로이 2026-09-23 「켄번스에서 화면이 흔들린다」(perspective 로 고친 뒤에도 남았다).
 *   950k 같은 낮은 비트레이트에서 B-프레임을 쓰면 **4프레임마다 기준 프레임이 바뀌며** 느린 켄번스가
 *   앞뒤로 미세하게 떤다(이웃 프레임 이동량이 0.24 −0.22 −0.04 −0.58 로 반복). 실측(같은 20초 켄번스 · 가로 가속도):
 *     무손실 0.003 · nvenc 950k(기본 B) **0.484** · nvenc 950k bf0 0.032(단 2.4Mbps 로 넘친다)
 *     · **nvenc bf0 + maxrate 1000k 0.056 · 크기는 기본과 같음(2487KB vs 2525KB)** ← 채택
 *     · x264 medium 950k(기본 B) 0.183 · x264 veryfast bf0 0.066
 *   ⚠ bf0 만 주면 NVENC 가 목표를 2.5배 넘긴다 → **maxrate 로 묶는다**(목표 × 1.05, 버퍼 × 2).
 *   ⚠ 정지 프레임·raw 필터 출력만 재면 이 결함이 안 보인다 — **인코딩한 파일을 디코딩해** 잴 것.
 */
function encArgs(enc, bitrate) {
  const kb = parseFloat(bitrate) * (/m$/i.test(String(bitrate)) ? 1000 : 1) || 950;
  const rc = ['-b:v', bitrate, '-maxrate', `${Math.round(kb * 1.05)}k`, '-bufsize', `${Math.round(kb * 2)}k`, '-bf', '0'];
  return enc === 'nvenc'
    ? ['-c:v', 'h264_nvenc', '-preset', 'p4', ...rc]
    : ['-c:v', 'libx264', '-preset', 'veryfast', ...rc];
}

// ── .vrew 읽기 ──────────────────────────────────────────────────────────────
function loadVrew(vrewPath, workDir) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(vrewPath);
  const project = JSON.parse(zip.readAsText('project.json'));
  const mediaDir = path.join(workDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  let n = 0;
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith('media/')) continue;
    fs.writeFileSync(path.join(mediaDir, path.basename(e.entryName)), e.getData());
    n++;
  }
  return { project, mediaDir, mediaCount: n };
}

// ── 타임라인 ────────────────────────────────────────────────────────────────
/**
 * clips 를 훑어 ① 시각자산 구간 ② 자막 큐 ③ 문장 음성(목표 길이 포함) ④ 오버레이(web)를 뽑는다.
 * 전부 .vrew 안의 값 그대로 — 다시 계산하지 않는다.
 */
function buildTimeline(project, mediaDir) {
  const tracks = (project.props && project.props.tracks) || {};
  const assets = (project.props && project.props.assets) || {};
  const byMediaId = new Map();
  for (const f of (project.files || [])) byMediaId.set(f.mediaId, f);
  const trackOf = (aid) => {
    const a = assets[aid];
    return a && a.trackIds && a.trackIds.length ? (tracks[a.trackIds[0]] || null) : null;
  };
  const fileOf = (tr) => {
    if (!tr || !tr.mediaId || !mediaDir) return null;
    const f = byMediaId.get(tr.mediaId);
    if (!f || !f.name) return null;
    const p = path.join(mediaDir, f.name);
    return fs.existsSync(p) ? p : null;
  };

  const clips = (project.transcript && project.transcript.clips) || [];
  const segments = [], cues = [], audio = [];
  const webSpans = new Map();   // trackId → {start, end}
  let t = 0, curKey = null, curSeg = null, lastTts = null;
  let capStyle = null;

  for (const c of clips) {
    const dur = (c.words || []).reduce((s, w) => s + (+w.duration || 0), 0);
    if (!(dur > 0)) continue;
    const start = t, end = t + dur;
    t = end;

    // ① 시각 자산 — 같은 asset 이 이어지면 한 구간
    let vTr = null, vAid = null;
    for (const aid of (c.assetIds || [])) {
      const tr = trackOf(aid);
      if (tr && (tr.type === 'image' || tr.type === 'video')) { vTr = tr; vAid = aid; break; }
    }
    const key = vAid || 'none';
    if (key !== curKey) {
      curSeg = { start, end, type: vTr ? vTr.type : 'none', track: vTr, file: fileOf(vTr) };
      segments.push(curSeg);
      curKey = key;
    } else curSeg.end = end;

    // ④ 오버레이(web 텍스트박스) — 연결된 clip 구간이 곧 노출 구간이다(vrew-builder 규약)
    for (const aid of (c.assetIds || [])) {
      const tr = trackOf(aid);
      if (!tr || tr.type !== 'web') continue;
      const sp = webSpans.get(tr.trackId);
      if (!sp) webSpans.set(tr.trackId, { start, end, track: tr });
      else sp.end = end;
    }

    // ② 자막
    const cap = (c.captions || [])[0];
    if (cap && Array.isArray(cap.text)) {
      const txt = cap.text.map((x) => String(x.insert || '')).join('').replace(/\r?\n/g, ' ').trim();
      if (txt) {
        cues.push({ start, end, text: txt });
        if (!capStyle) capStyle = { style: cap.style || {}, attrs: (cap.text[0] && cap.text[0].attributes) || {} };
      }
    }

    // ③ 음성 — 문장(mp3) 당 한 번, **선언 길이를 함께 모은다**(함정 ②)
    let mid = null, mfile = null;
    for (const w of (c.words || [])) {
      for (const aid of (w.assetIds || [])) {
        const tr = trackOf(aid);
        if (tr && tr.type === 'ttsClip' && tr.mediaId) { mid = tr.mediaId; mfile = fileOf(tr); break; }
      }
      if (mid) break;
    }
    if (mid && mid !== lastTts) {
      audio.push({ file: mfile, dur: 0 });
      lastTts = mid;
    }
    if (mid && audio.length) audio[audio.length - 1].dur += dur;
  }

  // 오버레이 이벤트
  const overlays = [];
  for (const sp of webSpans.values()) {
    const ov = webOverlay(sp.track, sp.start, sp.end);
    if (ov) overlays.push(ov);
  }
  return { segments, cues, audio, overlays, capStyle, totalSec: t };
}

// ── 색 ─────────────────────────────────────────────────────────────────────
/** '#rrggbb' / 'rgba(r,g,b,a)' → ASS '&HAABBGGRR' (ASS 알파는 00=불투명). 못 읽으면 fallback. */
function assColor(v, fallback = '&H00FFFFFF') {
  const s = String(v || '').trim();
  let r, g, b, a = 1;
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) {
    r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4, 6), 16);
    if (m[2]) a = parseInt(m[2], 16) / 255;
  } else if ((m = /^rgba?\(([^)]+)\)$/i.exec(s))) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    [r, g, b] = p; if (p.length > 3 && isFinite(p[3])) a = p[3];
  } else return fallback;
  const hx = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  return `&H${hx((1 - a) * 255)}${hx(b)}${hx(g)}${hx(r)}`;
}

// ── 자막 스타일 (Vrew caption style → ASS) ──────────────────────────────────
const ALIGN_BOTTOM = { start: 1, center: 2, end: 3 };
const ALIGN_MIDDLE = { start: 4, center: 5, end: 6 };
const ALIGN_TOP = { start: 7, center: 8, end: 9 };

/**
 * @returns {{font, size, color, outlineColor, outline, align, marginL, marginR, marginV, calibrated}}
 *   calibrated=false 면 실측으로 맞춘 스타일이 아니다(공식은 같지만 검증 안 됨).
 */
function captionAssStyle(capStyle, fontName) {
  const st = (capStyle && capStyle.style) || {};
  const at = (capStyle && capStyle.attrs) || {};
  const ca = Array.isArray(st.customAttributes) ? st.customAttributes : [];
  const alignV = ((ca.find((x) => x.attributeName === '--textbox-align') || {}).value) || 'center';
  const hAlign = ['start', 'center', 'end'].includes(alignV) ? alignV : 'center';
  const yAlign = ['top', 'middle', 'bottom'].includes(st.yAlign) ? st.yAlign : 'bottom';
  const yOff = isFinite(+st.yOffset) ? +st.yOffset : 0;
  const width = isFinite(+st.width) && +st.width > 0 ? +st.width : 0.96;
  const xOff = isFinite(+st.xOffset) ? +st.xOffset : 0;
  const size = Math.max(8, Math.round((+at.size || 100) * SIZE_K));
  const boxLeft = (1 - width) / 2 * W + xOff * (W / 2);
  const marginL = Math.max(0, Math.round(boxLeft + BOX_PAD_X));
  const marginR = Math.max(0, Math.round(W - (boxLeft + width * W) + BOX_PAD_X));
  let align, marginV;
  if (yAlign === 'bottom') { align = ALIGN_BOTTOM[hAlign]; marginV = Math.round(CAP_BOTTOM_BASE + (-yOff) * HALF_H); }
  else if (yAlign === 'top') { align = ALIGN_TOP[hAlign]; marginV = Math.round(CAP_BOTTOM_BASE + yOff * HALF_H); }
  else { align = ALIGN_MIDDLE[hAlign]; marginV = 0; }
  const outlineOn = String(at['outline-on'] ?? 'true') !== 'false';
  // 🎨 배경 상자(--textbox-color) — Vrew 는 .textarea 에 background + width: fit-content 로 그린다(글자 폭 상자).
  //   투명(알파 0)이면 없음. 여백은 그 CSS 의 padding(가로 5px·세로 약 2px @ 25px 글꼴)을 글자 크기에 비례해 옮긴다.
  const boxRaw = (ca.find((x) => x.attributeName === '--textbox-color') || {}).value;
  const boxAss = assColor(boxRaw, null);
  const boxOn = !!boxAss && boxAss.slice(2, 4) !== 'FF';
  const calibrated = yAlign === 'bottom' && hAlign === 'start' && Math.abs(yOff + 0.125) < 1e-6
    && Math.abs(width - 0.96) < 1e-6 && Math.abs(xOff) < 1e-6;
  return {
    font: fontName,
    size,
    color: assColor(at.color, '&H00FFFFFF'),
    outlineColor: assColor(at['outline-color'], '&H00000000'),
    outline: outlineOn ? Math.max(0, +at['outline-width'] || 6) : 0,
    bold: /_(6|7|8|9)00$|bold/i.test(String(at.font || 'Pretendard-Vrew_700')) || !!at.bold,
    align, marginL, marginR, marginV, calibrated,
    yAlign, hAlign,
    box: boxOn ? boxAss : null,
    boxPad: Math.max(2, Math.round(size * 0.14)),
  };
}

/** web 텍스트박스 트랙 → 오버레이 이벤트(없거나 빈 글이면 null). */
function webOverlay(tr, spanStart, spanEnd) {
  const ops = tr && tr.deltas && tr.deltas.textarea && tr.deltas.textarea.ops;
  if (!Array.isArray(ops)) return null;
  const text = ops.map((o) => String(o.insert || '')).join('').replace(/\n+$/, '').trim();
  if (!text) return null;
  const at = (ops[0] && ops[0].attributes) || {};
  const eff = tr.assetEffectInfo || null;
  // 🔑 startDelay 는 영상 0초 기준 절대시간이다(vrew-builder 가 asset 을 0번 clip 부터 연결한다)
  const delay = eff && isFinite(+eff.startDelay) ? +eff.startDelay / 1000 : 0;
  const start = Math.max(spanStart, spanStart + delay);
  const end = spanEnd;
  if (!(end > start)) return null;
  const outlineOn = String(at['outline-on'] ?? 'true') !== 'false';
  return {
    text,
    start, end,
    fadeMs: eff && eff.type === 'fade-in' ? Math.max(0, +eff.duration || 0) : 0,
    x: Math.round((+tr.xPos || 0) * W + WEB_PAD_X),
    y: Math.round((+tr.yPos || 0) * H + WEB_PAD_Y),
    size: Math.max(8, Math.round((+at.size || 75) * SIZE_K)),
    color: assColor(at.color, '&H00FFFFFF'),
    outlineColor: assColor(at['outline-color'], '&H00000000'),
    outline: outlineOn ? Math.max(0, +at['outline-width'] || 6) : 0,
  };
}

// ── ASS ────────────────────────────────────────────────────────────────────
function fmtAss(sec) {
  const cs = Math.max(0, Math.round((+sec || 0) * 100));   // 전체를 1/100초로 한 번에 반올림(롤오버 방지)
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}
const assEsc = (t) => String(t).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\N');

/**
 * 🔑 PlayResX/Y 를 영상 해상도로 박아야 FontSize·Margin 이 픽셀 그대로 먹는다(함정 ④).
 * @param cues      이 조각에 걸리는 자막(시각은 조각 기준으로 옮겨 둔 것)
 * @param overlays  이 조각에 걸리는 오버레이(같은 기준)
 */
function buildAss(cues, overlays, cs) {
  const b = cs.bold ? -1 : 0;
  const head = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`,
    'WrapStyle: 0', 'ScaledBorderAndShadow: yes', 'YCbCr Matrix: None', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: C,${cs.font},${cs.size},${cs.color},${cs.color},${cs.outlineColor},&H00000000,${b},0,0,0,100,100,0,0,1,${cs.outline},0,${cs.align},${cs.marginL},${cs.marginR},${cs.marginV},1`,
    // 배경 상자 전용 스타일 — BorderStyle 3(불투명 상자, 색 = OutlineColour) · 글자는 완전 투명. 글자는 위 층(C)이 그린다.
    ...(cs.box ? [`Style: B,${cs.font},${cs.size},&HFF000000,&HFF000000,${cs.box},&HFF000000,${b},0,0,0,100,100,0,0,3,${cs.boxPad},0,${cs.align},${cs.marginL},${cs.marginR},${cs.marginV},1`] : []),
    `Style: N,${cs.font},54,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,6,0,7,0,0,0,1`,
    '', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const ev = [];
  for (const c of cues) {
    if (!c.text || !(c.end > c.start)) continue;
    // 🔑 층을 나눈다 — 같은 층의 동시 이벤트는 libass 가 겹치지 않게 **위아래로 밀어 버린다**(상자와 글자가 따로 놀게 된다).
    if (cs.box) ev.push(`Dialogue: 0,${fmtAss(c.start)},${fmtAss(c.end)},B,,0,0,0,,${assEsc(c.text)}`);
    ev.push(`Dialogue: 1,${fmtAss(c.start)},${fmtAss(c.end)},C,,0,0,0,,${assEsc(c.text)}`);
  }
  const bgr = (c) => `&H${String(c).replace(/^&H/, '').slice(-6)}&`;   // '&HAABBGGRR' → '&HBBGGRR&'
  for (const o of overlays) {
    if (!(o.end > o.start)) continue;
    // 페이드: 오버레이가 이 조각 안에서 시작하면 \fad, 앞 조각에서 이미 시작했으면
    //   남은 페이드만 \alpha + \t 로 이어 준다(조각 경계에서 글자가 번쩍이지 않게).
    let tagFade = '';
    const from = o.fadeFrom == null ? 0 : o.fadeFrom;
    if (o.fadeMs > 0) {
      if (from >= 0) tagFade = `\\fad(${Math.round(o.fadeMs)},0)`;
      else {
        const done = -from * 1000;
        if (done < o.fadeMs) {
          const a0 = Math.round(255 * (1 - done / o.fadeMs));
          tagFade = `\\alpha&H${a0.toString(16).padStart(2, '0').toUpperCase()}&\\t(0,${Math.round(o.fadeMs - done)},\\alpha&H00&)`;
        }
      }
    }
    ev.push(`Dialogue: 2,${fmtAss(o.start)},${fmtAss(o.end)},N,,0,0,0,,{\\an7\\pos(${o.x},${o.y})\\fs${o.size}\\1c${bgr(o.color)}\\3c${bgr(o.outlineColor)}\\bord${o.outline}${tagFade}}${assEsc(o.text)}`);
  }
  return head.join('\n') + '\n' + ev.join('\n') + '\n';
}

// ── 켄번스 ─────────────────────────────────────────────────────────────────
/**
 * Vrew 이미지 트랙(켄번스) → ffmpeg 필터. **입력은 이미 캔버스(1920x1080)로 cover 된 그림**이다
 * (coverImage 가 구간마다 한 번 만든다 — 매 프레임 lanczos 로 다시 키우면 그만큼 느리다).
 *
 * 🔑 Vrew 의 `scale` 은 확대배율이 아니라 **"이미지에서 보이는 영역의 비율"**(1.0=전체).
 *   보이는 사각형 = 가운데 (cx, cy) · 폭 scale·W · 높이 scale·H → 그걸 화면 전체로 늘린다.
 *
 * 🔴 **zoompan 을 쓰지 않는다 — 화면이 흔들린다**(로이 2026-09-23: "완료된 영상이 흔들려").
 *   zoompan 은 매 프레임 창 위치를 **정수 픽셀로 반올림**한다. 켄번스는 프레임당 0.5~0.8px 쯤
 *   움직이므로 실제로는 0·1·1·0·1px 로 멈췄다 튀었다 한다. 실측(같은 구간, 이웃 프레임 이동량의 변화):
 *     Vrew 가로 0.015 / 세로 0.112 · zoompan 0.124 / **1.020** · 4배 키운 zoompan 0.077 / 0.170(4배 느림)
 *     · **perspective(linear) 0.025~0.028 / 0.12~0.15 ← Vrew 수준**
 *   ✅ `perspective` 는 원본의 **소수점 좌표** 사각형을 보간해 화면으로 옮긴다(반올림 없음).
 *   linear 를 고른 이유: Vrew 와의 오차가 가장 작고 선명도도 Vrew 에 가장 가깝다(cubic 은 오히려 더 날카롭다).
 *   (예전 zoompan 판에서는 x/y 가 문서와 달리 '확대 전 좌표'라서 한 번 더 헤맸다 — 이제 무관하다.)
 * ⚠ 트랙 박스(width 1.008 등)는 반영하지 않는다 — 반영하면 오히려 오차가 커졌다(실측).
 * ⚠ 보간은 선형(실측 확인). 긴 구간을 조각으로 나누면 진행률은 **구간 전체** 기준이어야 이어진다.
 */
function kenBurnsFilter(kb, frames, off = 0, total = 0) {
  if (!kb || !kb.from) return 'null';
  const f = kb.from, to = kb.to || kb.from;
  const n = Math.max(1, (total > 0 ? total : frames) - 1);
  const prog = off > 0 ? `(on+${off})/${n}` : `on/${n}`;
  const num = (v, d) => (v == null || !isFinite(+v) ? d : +v);
  const lerp = (a, b) => `(${a}+(${b}-${a})*${prog})`;
  const sc = lerp(Math.min(1, num(f.scale, 1)), Math.min(1, num(to.scale, num(f.scale, 1))));
  const cx = lerp(num(f.centerX, 0.5), num(to.centerX, 0.5));
  const cy = lerp(num(f.centerY, 0.5), num(to.centerY, 0.5));
  const X0 = `(${cx}-${sc}/2)*W`, X1 = `(${cx}+${sc}/2)*W`;
  const Y0 = `(${cy}-${sc}/2)*H`, Y1 = `(${cy}+${sc}/2)*H`;
  return `perspective=x0='${X0}':y0='${Y0}':x1='${X1}':y1='${Y0}':x2='${X0}':y2='${Y1}':x3='${X1}':y3='${Y1}'`
    + ':sense=source:interpolation=linear:eval=frame';
}

/** 구간 그림을 캔버스로 한 번만 cover 해 둔다(같은 구간의 조각들이 함께 쓴다). */
function coverImage(file, ctx) {
  ctx.covers = ctx.covers || new Map();
  if (!ctx.covers.has(file)) {
    const name = `cov_${ctx.covers.size}.png`;
    ctx.covers.set(file, ff(['-y', '-hide_banner', '-loglevel', 'error', '-i', file,
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}`,
      '-frames:v', '1', name], { cwd: ctx.tmpDir, signal: ctx.children }).then(() => name));
  }
  return ctx.covers.get(file);
}

/**
 * 앞 N초만 남긴다(검증·벤치마크용). ⚠ 잘린 구간의 켄번스는 **원래 구간 길이 기준**으로 진행해야
 * 전체 렌더와 같은 그림이 나온다 → kbTotalSec 에 원래 길이를 적어 둔다.
 */
function limitTimeline(tl, sec) {
  if (!(sec > 0) || sec >= tl.totalSec) return tl;
  tl.segments = tl.segments.filter((s) => s.start < sec).map((s) => ({ ...s, kbTotalSec: s.end - s.start, end: Math.min(s.end, sec) }));
  tl.cues = tl.cues.filter((c) => c.start < sec).map((c) => ({ ...c, end: Math.min(c.end, sec) }));
  tl.overlays = tl.overlays.filter((o) => o.start < sec).map((o) => ({ ...o, end: Math.min(o.end, sec) }));
  let acc = 0; const au = [];
  for (const a of tl.audio) { if (acc >= sec) break; const d = Math.min(a.dur, sec - acc); au.push({ ...a, dur: d }); acc += a.dur; }
  tl.audio = au;
  tl.totalSec = sec;
  return tl;
}

// ── 조각 계획 ──────────────────────────────────────────────────────────────
/**
 * 구간 → 렌더 조각. 🔑 프레임은 **끝 시각 기준 누적 반올림**(오차가 쌓이지 않는다).
 * 긴 이미지 구간은 chunkSec 단위로 나눈다(한 구간이 75초씩 되면 병렬이 그 하나를 기다린다).
 */
function planChunks(segments, chunkSec = DEFAULT_CHUNK_SEC) {
  const CH = Math.max(120, Math.round(chunkSec * FPS));
  const out = [];
  for (const s of segments) {
    const f0 = Math.round(s.start * FPS), f1 = Math.round(s.end * FPS);
    const n = f1 - f0;
    if (n <= 0) continue;
    const tot = s.kbTotalSec > 0 ? Math.max(n, Math.round(s.kbTotalSec * FPS)) : n;   // limitSec 로 잘린 구간
    if (s.type !== 'image' || n <= CH) { out.push({ ...s, f0, f1, kbOff: 0, kbTotal: tot }); continue; }
    for (let o = 0; o < n; o += CH) {
      const len = Math.min(CH, n - o);
      out.push({ ...s, f0: f0 + o, f1: f0 + o + len, kbOff: o, kbTotal: tot });
    }
  }
  return out;
}

// ── 조각 렌더 ──────────────────────────────────────────────────────────────
async function renderChunk(ch, i, ctx) {
  const { tmpDir, cs, cues, overlays, enc, bitrate, fontsDirName } = ctx;
  const frames = ch.f1 - ch.f0;
  const t0 = ch.f0 / FPS, dur = frames / FPS;
  const id = String(i).padStart(4, '0');
  const out = `seg_${id}.mp4`, assName = `seg_${id}.ass`;

  const segCues = cues.filter((c) => c.end > t0 && c.start < t0 + dur)
    .map((c) => ({ start: Math.max(0, c.start - t0), end: Math.min(dur, c.end - t0), text: c.text }));
  const segOv = overlays.filter((o) => o.end > t0 && o.start < t0 + dur)
    .map((o) => ({ ...o, start: Math.max(0, o.start - t0), end: Math.min(dur, o.end - t0), fadeFrom: o.start - t0 }));
  fs.writeFileSync(path.join(tmpDir, assName), buildAss(segCues, segOv, cs), 'utf8');
  const assFilter = `ass=${assName}:fontsdir=${fontsDirName}`;

  let args;
  const common = [...encArgs(enc, bitrate), '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an', out];
  const pre = ctx.filterThreads > 0 ? ['-filter_threads', String(ctx.filterThreads)] : [];
  if (ch.type === 'image' && ch.file) {
    const tr = ch.track || {};
    const cov = await coverImage(ch.file, ctx);
    // 🔑 그림을 **한 번만 디코딩**해 메모리에서 반복하고(loop 필터), YUV 로 켄번스를 돌린다.
    //   `-loop 1 -i x.png` 는 **매 프레임 PNG 를 다시 디코딩**하고 perspective 가 RGB 전체 해상도에서 돈다
    //   (실측 600프레임: 9.2초 → 5.3초 · 옛 zoompan 7.0초보다도 빠르다).
    const vf = [`format=yuv420p,loop=loop=${Math.max(0, frames - 1)}:size=1:start=0,setpts=N/${FPS}/TB`,
      kenBurnsFilter(tr.kenburnsAnimationInfo, frames, ch.kbOff, ch.kbTotal), assFilter].join(',');
    args = [...pre, '-y', '-hide_banner', '-loglevel', 'error', '-i', cov,
      '-frames:v', String(frames), '-vf', vf, ...common];
  } else if (ch.type === 'video' && ch.file) {
    // 영상이 구간보다 짧으면 마지막 프레임을 이어 붙여 길이를 맞춘다.
    const vf = [`scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${W}:${H}`, `fps=${FPS}`,
      'tpad=stop_mode=clone:stop_duration=3600', assFilter].join(',');
    args = [...pre, '-y', '-hide_banner', '-loglevel', 'error', '-i', ch.file, '-frames:v', String(frames), '-vf', vf, ...common];
  } else {
    args = [...pre, '-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}`,
      '-frames:v', String(frames), '-vf', assFilter, ...common];
  }
  try { await ff(args, { cwd: tmpDir, signal: ctx.children, low: true }); }
  catch (e) { throw new Error(`조각 ${i + 1}(${ch.type}, ${t0.toFixed(1)}초~): ${e.message}`); }
  return out;
}

// ── 음성 ───────────────────────────────────────────────────────────────────
/**
 * 문장 음성을 이어붙인다.
 * ⚠ concat 데무서를 쓰지 않는다 — wav/mp3 가 섞이고 표본율도 제각각이라 조용히 이상한 소리가 난다.
 * 🔑 문장마다 **선언 길이에 정확히 맞춘다**(apad 로 덧대고 atrim 으로 자른다 — 함정 ②).
 *   음성 파일이 없는 문장은 그 길이만큼 무음으로 채운다(자리가 비면 뒤가 전부 당겨진다).
 */
async function concatAudioOnce(inputs, out, tmpDir, ctx) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const labels = [];
  let k = 0;
  const parts = [];
  for (const it of inputs) {
    if (it.file) { args.push('-i', it.file); parts.push({ it, idx: k++ }); }
    else parts.push({ it, idx: -1 });
  }
  const fl = parts.map((p, i) => {
    const d = it_dur(p.it);
    if (p.idx < 0) {
      labels.push(`[a${i}]`);
      return `anullsrc=r=${A_RATE}:cl=stereo,atrim=0:${d}[a${i}]`;
    }
    const base = `[${p.idx}:a]aresample=${A_RATE},aformat=sample_fmts=s16:channel_layouts=stereo`;
    labels.push(`[a${i}]`);
    if (!(p.it.dur > 0)) return `${base}[a${i}]`;
    return `${base},apad=whole_dur=${d},atrim=0:${d},asetpts=N/SR/TB[a${i}]`;
  });
  args.push('-filter_complex', `${fl.join(';')};${labels.join('')}concat=n=${parts.length}:v=0:a=1[out]`,
    '-map', '[out]', '-c:a', 'pcm_s16le', out);
  await ff(args, { cwd: tmpDir, signal: ctx.children });
}
const it_dur = (it) => (it.dur > 0 ? it.dur : 0.001).toFixed(4);

async function concatAudio(inputs, out, tmpDir, ctx, depth = 0) {
  if (inputs.length <= AUDIO_CHUNK) return concatAudioOnce(inputs, out, tmpDir, ctx);
  const parts = [];
  for (let i = 0; i < inputs.length; i += AUDIO_CHUNK) {
    const p = path.join(tmpDir, `ac_${depth}_${i}.wav`);
    await concatAudioOnce(inputs.slice(i, i + AUDIO_CHUNK), p, tmpDir, ctx);
    parts.push({ file: p });   // 중간 결과는 이미 길이가 맞춰져 있다
  }
  return concatAudio(parts, out, tmpDir, ctx, depth + 1);
}

// ── 폰트 ───────────────────────────────────────────────────────────────────
const FONT_FILE = path.join(__dirname, '..', 'assets', 'fonts', 'Pretendard-Bold.ttf');

// ── 메인 ───────────────────────────────────────────────────────────────────
/**
 * @param opts.vrewPath   입력 .vrew
 * @param opts.outPath    출력 MP4
 * @param opts.log        (msg) => void
 * @param opts.isAborted  () => bool — true 면 새 조각을 시작하지 않고 멈춘다
 * @param opts.par        동시 렌더 수(기본 CPU 코어 − 2, 2~6)
 * @param opts.bitrate    비디오 비트레이트(기본 950k = Vrew 실측 949kbps)
 * @returns {Promise<{ok:true, output, durationSec, renderSec, timings} | {ok:false, error, cancelled?}>}
 */
async function renderVrewToMp4(opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const isAborted = typeof opts.isAborted === 'function' ? opts.isAborted : () => false;
  const bitrate = opts.bitrate || '950k';
  const par = Math.max(1, Math.min(8, +opts.par || Math.max(2, Math.min(6, os.cpus().length - 2))));
  const T0 = Date.now();
  const timings = {};
  const lap = (k, t) => { timings[k] = +((Date.now() - t) / 1000).toFixed(1); };
  let tmpDir = null;
  const ctx = { children: [] };
  // 📊 진행 상태(2026-09-23 로이 「진행과정을 눈으로 확인할 수 있게」) — 화면(main → 렌더러)이 그대로 그린다.
  //   단계: read → video(조각 병렬) ∥ audio(동시) → concat → mux → done. 계산은 여기서, 표시는 화면에서.
  const st = {
    phase: 'read', startedAt: T0, outPath: opts.outPath || '', durationSec: 0, encoder: '', par,
    video: { done: 0, total: 0, framesDone: 0, framesTotal: 0, active: [], startedAt: 0 },
    audio: 'wait',   // wait → run → done · none(음성 없음)
  };
  const emit = () => { if (typeof opts.onProgress === 'function') { try { opts.onProgress(JSON.parse(JSON.stringify(st))); } catch (_) {} } };
  emit();
  try {
    if (!opts.vrewPath || !fs.existsSync(opts.vrewPath)) return { ok: false, error: '.vrew 파일이 없습니다: ' + opts.vrewPath };
    if (!opts.outPath) return { ok: false, error: '출력 경로가 없습니다' };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'priming-mp4-'));

    let t = Date.now();
    const { project, mediaDir } = loadVrew(opts.vrewPath, tmpDir);
    const tl = buildTimeline(project, mediaDir);
    if (opts.limitSec > 0) limitTimeline(tl, +opts.limitSec);   // 검증·벤치마크용(앞 N초만)
    lap('read', t);
    st.durationSec = tl.totalSec; emit();
    if (!tl.segments.length || !(tl.totalSec > 0)) return { ok: false, error: '.vrew 에 타임라인이 없습니다' };

    // 폰트 — 앱에 들어 있는 Pretendard Bold(Vrew 자막 폰트). 없으면 맑은 고딕으로(글자 모양이 달라진다).
    const fontsDir = path.join(tmpDir, 'fonts');
    fs.mkdirSync(fontsDir, { recursive: true });
    let fontName = 'Pretendard';
    if (fs.existsSync(FONT_FILE)) fs.copyFileSync(FONT_FILE, path.join(fontsDir, 'Pretendard-Bold.ttf'));
    else { fontName = 'Malgun Gothic'; log('   ⚠ Pretendard 폰트가 없어 맑은 고딕으로 굽습니다 — 앱을 최신으로 업데이트하세요'); }

    const cs = captionAssStyle(tl.capStyle, fontName);
    if (tl.capStyle && !cs.calibrated) log(`   ⓘ 자막 위치(${cs.yAlign}·${cs.hAlign})는 실측으로 맞춘 스타일이 아닙니다 — 첫 편은 Vrew 결과와 비교해 보세요`);
    const missAudio = tl.audio.filter((a) => !a.file).length;
    if (missAudio) log(`   ⚠ 음성 파일이 없는 문장 ${missAudio}개 — 그 자리는 무음으로 채웁니다`);

    const chunks = planChunks(tl.segments, opts.chunkSec || DEFAULT_CHUNK_SEC);
    const totalFrames = chunks.length ? chunks[chunks.length - 1].f1 : 0;
    const enc = await pickEncoder(tmpDir, log);
    Object.assign(st.video, { total: chunks.length, framesTotal: totalFrames, startedAt: Date.now() });
    st.encoder = enc; st.phase = 'video'; st.audio = tl.audio.some((a) => a.file) ? 'run' : 'none'; emit();
    log(`🎬 MP4 렌더 — ${(tl.totalSec / 60).toFixed(1)}분 · 조각 ${chunks.length}개 · 자막 ${tl.cues.length}줄${tl.overlays.length ? ` · 오버레이 ${tl.overlays.length}개` : ''} · 동시 ${par} · ${enc === 'nvenc' ? 'NVENC' : 'CPU'}`);

    // 🔑 음성은 화면과 무관하다 → **조각 렌더와 동시에** 이어붙이고 AAC 로 인코딩해 둔다.
    //   실측: 끝에 몰아서 하면 mux 가 56초(17분 음성 AAC 인코딩)였다 — 화면 94초 뒤에 그대로 붙었다.
    const tA = Date.now();
    const audioJob = (async () => {
      if (!tl.audio.some((a) => a.file)) return null;
      const wav = path.join(tmpDir, 'voice.wav');
      await concatAudio(tl.audio, wav, tmpDir, ctx);
      await ff(['-y', '-hide_banner', '-loglevel', 'error', '-i', 'voice.wav', '-c:a', 'aac', '-b:a', '96k',
        '-ar', String(A_RATE), '-ac', '2', 'voice.m4a'], { cwd: tmpDir, signal: ctx.children });
      try { fs.unlinkSync(wav); } catch (_) {}
      st.audio = 'done'; emit();
      return path.join(tmpDir, 'voice.m4a');
    })();
    audioJob.catch(() => {});   // 결과는 아래에서 await — 처리 안 된 거부 경고 방지

    // 조각 병렬 렌더
    t = Date.now();
    Object.assign(ctx, { tmpDir, cs, cues: tl.cues, overlays: tl.overlays, enc, bitrate, fontsDirName: 'fonts', filterThreads: opts.filterThreads != null ? +opts.filterThreads : 0 });
    const files = new Array(chunks.length);
    const queue = chunks.map((c, i) => i);
    let done = 0, nextPct = 10, firstErr = null;
    const worker = async () => {
      while (queue.length && !firstErr) {
        if (isAborted()) return;
        const i = queue.shift();
        const c = chunks[i];
        st.video.active.push({ i: i + 1, start: c.f0 / FPS, end: c.f1 / FPS, type: c.type });
        emit();
        try { files[i] = await renderChunk(c, i, ctx); }
        catch (e) { firstErr = firstErr || e; return; }
        finally { st.video.active = st.video.active.filter((a) => a.i !== i + 1); }
        done++;
        st.video.done = done; st.video.framesDone += c.f1 - c.f0; emit();
        const pct = Math.floor(done / chunks.length * 100);
        if (pct >= nextPct) { log(`   🎬 MP4 ${pct}% (${done}/${chunks.length})`); nextPct = Math.floor(pct / 10) * 10 + 10; }
      }
    };
    await Promise.all(Array.from({ length: par }, worker));
    if (firstErr) return { ok: false, error: firstErr.message };
    if (isAborted()) return { ok: false, cancelled: true, error: '중단됨' };
    lap('video', t);

    // 이어붙이기(무손실)
    t = Date.now();
    st.phase = 'concat'; emit();
    fs.writeFileSync(path.join(tmpDir, 'list.txt'), files.map((f) => `file '${f}'`).join('\n'), 'utf8');
    await ff(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'silent.mp4'],
      { cwd: tmpDir, signal: ctx.children });
    lap('concat', t);

    // 음성(동시에 돌던 것을 기다린다)
    if (st.audio === 'run') { st.phase = 'audio'; emit(); }
    const voice = await audioJob;
    timings.audio = +((Date.now() - tA) / 1000).toFixed(1);   // 화면과 겹쳐 돈 시간(벽시계 합계가 아니다)

    // mux — 비디오는 다시 인코딩하지 않는다(자막은 이미 구워져 있다)
    t = Date.now();
    st.phase = 'mux'; emit();
    fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
    const tmpOut = path.join(tmpDir, 'final.mp4');
    if (voice) {
      await ff(['-y', '-hide_banner', '-loglevel', 'error', '-i', 'silent.mp4', '-i', voice,
        '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy',   // 둘 다 이미 인코딩돼 있다 — 복사만
        '-shortest', '-movflags', '+faststart', 'final.mp4'], { cwd: tmpDir, signal: ctx.children });
    } else {
      await ff(['-y', '-hide_banner', '-loglevel', 'error', '-i', 'silent.mp4', '-c', 'copy', '-movflags', '+faststart', 'final.mp4'],
        { cwd: tmpDir, signal: ctx.children });
    }
    // 🔑 반쯤 쓰인 파일이 업로드 폴더에 보이지 않게 — 다 만든 뒤 한 번에 옮긴다.
    //   renameSync 는 드라이브가 다르면 EXDEV 로 실패한다(C:\Temp → G:) → 복사로 넘긴다.
    try { fs.renameSync(tmpOut, opts.outPath); }
    catch (_) { fs.copyFileSync(tmpOut, opts.outPath); }
    lap('mux', t);

    const renderSec = (Date.now() - T0) / 1000;
    const durationSec = totalFrames / FPS;
    Object.assign(st, { phase: 'done', endedAt: Date.now(), speed: durationSec / renderSec }); emit();
    return { ok: true, output: opts.outPath, durationSec, renderSec, timings, speed: durationSec / renderSec, encoder: enc };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  } finally {
    for (const cp of ctx.children) { try { if (cp.exitCode == null) cp.kill(); } catch (_) {} }
    if (tmpDir && !opts.keepTmp) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} }
  }
}

module.exports = {
  renderVrewToMp4,
  // 테스트·도구용
  buildTimeline, buildAss, captionAssStyle, webOverlay, kenBurnsFilter, planChunks, fmtAss, assColor, encArgs,
  FONT_FILE, FPS, W, H,
};
