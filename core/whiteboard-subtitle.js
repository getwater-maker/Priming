'use strict';

/**
 * whiteboard-subtitle.js — 화이트보드 MP4 에 **자막을 얹는다** (5단계의 나머지 절반, 2026-09-16).
 *
 * 🔑 **왜 구워 넣나(하드번)** — 화이트보드 MP4 는 Vrew 를 거치지 않는 **최종 결과물**이다.
 *   소프트 자막(mov_text)으로 넣으면 플레이어가 켜야 보이고 유튜브도 따로 올려야 한다 →
 *   「자막이 안 보인다」가 된다. 그래서 화면에 굽고, **`.srt` 파일도 옆에 함께 남긴다**
 *   (유튜브에 올릴 때는 그쪽이 검색·번역에 유리하다).
 *   ⚠ 대가: 굽는 순간 **영상을 다시 인코딩**한다(음성 얹기는 `-c:v copy` 였다). 1920 22분이면 수 분.
 *     그래서 ⚙ 에서 끌 수 있고, 꺼도 `.srt` 는 그대로 나온다.
 *
 * 🔴 **SRT 를 필터에 직접 물리면 글자가 3~7배로 커진다 (2026-09-16 실사고, 로이: "자막이 중앙에 너무 크게").**
 *   ffmpeg 의 `subtitles` 필터는 SRT 를 ASS 로 바꿀 때 **PlayResX=384 · PlayResY=288** 을 기본으로 박는다
 *   (libavcodec 의 ASS 기본 헤더). `force_style` 의 FontSize·MarginV 는 **그 좌표계** 값이므로
 *   실제 영상에서는 `height/288` 배로 확대된다 — 1080 이면 **3.75배**, 1920 이면 **6.67배**.
 *   실측(1920x1080 · FontSize 56 · MarginV 81 요청): 글자 블록 높이 **359px** · 하단 여백 **328px** ·
 *   가로가 모자라 **두 줄**로 접힘 = 화면 한복판의 거대한 자막.
 *   ⚠ 640 시험본은 360/288 = 1.25배라 티가 안 나서 **테스트가 통과했다** — 그래서 아래 [6]·[9] 는
 *     **1080 으로도** 굽고 화소 위치를 잰다. 작은 판에서만 재면 이 사고를 다시 놓친다.
 *   ✅ 해법: **ASS 를 직접 만들어** PlayResX/Y 를 영상 해상도로 박는다 → FontSize·MarginV 가 픽셀 그대로다.
 *     덤으로 위치(하단·중앙·상단)·폰트·크기를 사용자가 고를 수 있게 됐다.
 *
 * 🔑 **시각의 기준은 「장면 영상의 실측 길이」다.** 장면 안에서는 문장 TTS 길이를 누적하지만,
 *   장면의 시작점은 실측 누적으로 잡는다 — 렌더러가 길이를 프레임 단위로 반올림해 장면마다
 *   몇 ms 씩 어긋나는데(whiteboard-audio 의 그 이유), 명목 길이로 쌓으면 50장면에서 누적된다.
 *   음성은 그 실측에 맞춰 얹히므로, 자막도 같은 기준을 써야 **소리와 글자가 함께** 간다.
 *
 * 🔑 자막 줄 나누기는 **core/caption-splitter 하나만 쓴다**(.vrew·SRT·프리미어와 같은 규칙).
 *   여기서 다시 구현하면 화이트보드만 다른 데서 끊긴다.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const MU = require('./media-utils');
const { splitCaptionLines, meaningfulLen, fmtSrtTime } = require('./caption-splitter');
const CF = require('./caption-format');
const CAS = require('./caption-ass');
const FONTS = require('./font-store');

// 글자 크기·가장자리 여백은 **영상 높이 비례**다(640 시험본과 1920 최종본이 같아 보이도록).
const FONT_RATIO = 0.052;   // 1080 → 56px
const MARGIN_RATIO = 0.075; // 1080 → 81px
// 🔑 화이트보드 종이는 **미색(#F5EBD7)** 이다 — 흰 글자는 안 보인다. 그래서 진한 글자 + 흰 테두리.
//   ASS 색은 BGR 순서(&HAABBGGRR)다. 검정 글자 · 흰 외곽 · 그림자 없음.
const PRIMARY = '&H00202020', OUTLINE_COLOUR = '&H00FFFFFF';
const FONT_CANDIDATES = ['Malgun Gothic', 'Noto Sans KR', 'NanumGothic', 'Gulim', 'Batang'];

// 사용자가 채널편집에서 고르는 값 — 없으면 이 기본값(= 예전 모양).
const SUB_DEFAULTS = { font: FONT_CANDIDATES[0], sizePct: +(FONT_RATIO * 100).toFixed(1), pos: 'bottom', marginPct: +(MARGIN_RATIO * 100).toFixed(1), bold: true };
const POSITIONS = { bottom: 2, middle: 5, top: 8 };   // ASS Alignment(숫자키패드 배치) — 전부 가운데 정렬

/** 설정 값 정리 — 범위를 벗어난 값은 기본값으로(잘못 입력해도 자막이 깨지지 않게). */
function normSubStyle(v) {
  const o = v && typeof v === 'object' ? v : {};
  const num = (x, d, lo, hi) => { const n = Number(x); return (Number.isFinite(n) && n >= lo && n <= hi) ? n : d; };
  return {
    font: String(o.font || '').trim() || SUB_DEFAULTS.font,
    sizePct: num(o.sizePct, SUB_DEFAULTS.sizePct, 1, 20),
    pos: POSITIONS[String(o.pos || '')] ? String(o.pos) : SUB_DEFAULTS.pos,
    marginPct: num(o.marginPct, SUB_DEFAULTS.marginPct, 0, 45),
    bold: o.bold === undefined ? SUB_DEFAULTS.bold : !!o.bold,
  };
}

function _ff(args, { abortSignal = null, cwd = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const exe = MU.getFfmpegPath();
    if (!exe) return reject(new Error('ffmpeg 를 찾을 수 없습니다'));
    const cp = spawn(exe, args, { windowsHide: true, cwd });
    let err = '';
    cp.stderr.on('data', (b) => { err += b.toString(); if (err.length > 8000) err = err.slice(-8000); });
    const onAbort = () => { try { cp.kill('SIGKILL'); } catch (_) {} };
    if (abortSignal) { if (abortSignal.aborted) onAbort(); else abortSignal.addEventListener('abort', onAbort, { once: true }); }
    cp.on('error', (e) => reject(e));
    cp.on('close', (code) => {
      if (abortSignal) { try { abortSignal.removeEventListener('abort', onAbort); } catch (_) {} }
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 종료 ${code}: ${err.split('\n').filter(Boolean).slice(-3).join(' / ')}`));
    });
  });
}

/**
 * 장면 목록 → 자막 큐 배열 `[{start, end, text}]` (초 단위).
 * 🔑 SRT 도 ASS 도 **이 한 함수**에서 나온다 — 두 벌로 만들면 파일과 화면의 자막이 갈린다.
 * @param scenes [{ sentences: [{ text, dur }] }]  — 장면 순서대로
 * @param opts.sceneDurations  장면별 **실측** 길이(초) 배열. 없으면 문장 길이 합을 쓴다.
 * @param opts.maxChars        자막 한 줄 글자수(앱 설정과 같은 값)
 */
function buildCues(scenes, opts = {}) {
  const maxChars = opts.maxChars || 7;
  const meas = opts.sceneDurations || [];
  const cues = [];
  let base = 0;
  (scenes || []).forEach((sc, si) => {
    const sents = (sc && sc.sentences) || [];
    const nominal = sents.reduce((a, s) => a + (Number(s && s.dur) || 0), 0);
    let t = base;
    for (const s of sents) {
      const dur = Number(s && s.dur) || 0;
      const text = String((s && s.text) || '').trim();
      if (!text || dur <= 0) { t += dur; continue; }
      const clips = splitCaptionLines(String((s && s.text) || ''), maxChars, s && s.breaks);
      const totW = clips.reduce((a, c) => a + Math.max(1, meaningfulLen(c)), 0) || 1;
      // 🎨 문장별 서식·효과(s.capSpans) — 있으면 줄 범위와 함께 싣는다(없으면 예전과 똑같은 큐)
      const spans = CF.cleanSpans(s && s.spans, text.length);
      const ranges = spans.length ? CF.lineRanges(text, clips) : null;
      let acc = t;
      clips.forEach((c, i) => {
        const cd = dur * (Math.max(1, meaningfulLen(c)) / totW);
        const start = acc;
        const end = (i === clips.length - 1) ? t + dur : acc + cd;
        const cue = { start, end, text: c };
        if (spans.length) { cue.sentText = text; cue.spans = spans; cue.range = ranges[i]; }
        cues.push(cue);
        acc = end;
      });
      t += dur;
    }
    // 🔑 다음 장면은 **실측 길이**만큼 뒤에서 시작한다(명목 합이 아니라) — 드리프트 방지.
    const real = Number(meas[si]);
    base += (Number.isFinite(real) && real > 0) ? real : nominal;
  });
  return cues;
}

/** 큐 → SRT 문자열(유튜브 업로드용 파일). ⚠ 화면에 굽는 자막과 **같은 큐**에서 나온다. */
function srtFromCues(cues) {
  return (cues || [])
    .map((c, i) => `${i + 1}\n${fmtSrtTime(c.start)} --> ${fmtSrtTime(c.end)}\n${c.text}\n\n`)
    .join('');
}

/** 장면 목록 → SRT 문자열. */
function buildSrt(scenes, opts = {}) { return srtFromCues(buildCues(scenes, opts)); }

/** 프로젝트 + 장면 계획 → buildSrt 가 먹는 모양. 문장 텍스트·TTS 길이는 **지금 값**을 읽는다. */
function scenesForSubtitle(project, scenes) {
  const byNum = new Map();
  for (const g of (project.groups || [])) {
    const ss = project.getSentencesOfGroup ? project.getSentencesOfGroup(g) : [];
    for (const s of ss) if (s) byNum.set(s.num, s);
  }
  return (scenes || []).map((sc) => ({
    sentences: (sc.sentenceNums || []).map((n) => {
      const s = byNum.get(n);
      return s ? { text: s.text || '', dur: Number(s.ttsDurationSec) || 0, spans: Array.isArray(s.capSpans) && s.capSpans.length ? s.capSpans : null, breaks: Array.isArray(s.capBreaks) && s.capBreaks.length ? s.capBreaks : null } : null;
    }).filter(Boolean),
  }));
}

/** ASS 시각 — `H:MM:SS.cc`(센티초). */
function fmtAssTime(sec) {
  const cs = Math.max(0, Math.round((Number(sec) || 0) * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** ASS 본문 이스케이프 — `{`·`}` 는 오버라이드 태그 시작이라 그대로 두면 글자가 사라진다. */
function assText(t) {
  return String(t || '').replace(/[{}]/g, (m) => '\\' + m).replace(/\r?\n/g, '\\N');
}

/**
 * 큐 → **ASS 자막 파일 내용**.
 * 🔑 `PlayResX/Y` 를 영상 해상도로 박는 것이 이 함수의 존재 이유다 — 그래야 FontSize·MarginV 가
 *   픽셀 그대로 먹는다(SRT 를 그냥 물리면 288 기준으로 읽혀 몇 배로 커진다).
 */
function buildAss(cues, { width = 1920, height = 1080, style = null, fontMap = null } = {}) {
  const st = normSubStyle(style);
  const W = Math.max(16, Math.round(width)), H = Math.max(16, Math.round(height));
  const px = Math.max(12, Math.round(H * st.sizePct / 100));
  const mv = Math.max(0, Math.round(H * st.marginPct / 100));
  // ⚠ 외곽선도 글자 크기 비례 — 고정값(3)으로 두면 640 시험본에서 글자가 테두리에 먹힌다.
  const outline = Math.max(1, Math.round(px * 0.06));
  const mh = Math.max(10, Math.round(W * 0.05));            // 좌우 여백 — 긴 줄이 화면 끝에 붙지 않게
  const align = POSITIONS[st.pos] || POSITIONS.bottom;
  const bold = st.bold ? -1 : 0;                             // ASS 는 -1 = 굵게
  // 🎨 문장별 서식·효과가 든 줄은 core/caption-ass(유튜브 MP4 와 같은 생성기)로 그린다.
  //   화이트보드의 기본 모양(진한 글자·흰 외곽·이 설정의 글꼴·크기)을 바탕으로 덮어쓰기만 얹는다 — 채널 자막 서식은 쓰지 않는다
  //   (종이 위 화면이라 모양이 따로다). 서식이 없는 줄은 예전과 **한 글자도 다르지 않게** 낸다.
  const fancy = (cues || []).some((c) => c && c.spans && c.spans.length);
  const pxK = H / 1080;
  const WB_FONT = '__whiteboard__';
  const L = CAS.makeLayout({ W, H, hAlign: 'center', yAlign: { 2: 'bottom', 5: 'middle', 8: 'top' }[align] || 'bottom',
    marginL: mh, marginR: mh, marginV: mv, sizeK: 1, pxK, fontMap: { ...(fontMap || {}), [WB_FONT]: st.font }, fallbackFamily: st.font, fps: 30 });
  const base = CF.normFmt({ font: WB_FONT, fontColor: '#202020', outlineColor: '#ffffff', outlineWidth: outline / pxK, bold: st.bold });
  base.size = px;
  // 📐 줄별 위치(v0.5.41) — 덮어쓴 줄만 정렬을 바꾸고, 미세 위치는 그 정렬의 기본값(CF.POS_Y_DEFAULT)과의 차이만큼 옮긴다
  //   → 정렬만 바꾼 줄은 이 화이트보드 설정의 여백 그대로 선다(종이 위 모양 유지).
  const posMemo = new Map();
  const posLayout = (line) => {
    if (!line || !CF.POS_KEYS.some((k) => line[k] != null)) return L;
    const hA = line.posH || L.hAlign, vA = line.posV || L.yAlign;
    const dy = line.posY != null ? (line.posY - CF.POS_Y_DEFAULT[vA]) * H / 2 : 0;
    const dx = line.posX != null ? line.posX * W / 2 : 0;
    const key = [hA, vA, dx, dy].join('|');
    if (!posMemo.has(key)) posMemo.set(key, CAS.makeLayout({ W, H, hAlign: hA, yAlign: vA, marginL: mh, marginR: mh, marginV: mv, dx, dy,
      sizeK: 1, pxK, fontMap: L.fontMap, fallbackFamily: st.font, fps: 30 }));
    return posMemo.get(key);
  };
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: P,${st.font},${px},${PRIMARY},${PRIMARY},${OUTLINE_COLOUR},&H00000000,${bold},0,0,0,100,100,0,0,1,${outline},0,${align},${mh},${mh},${mv},1`,
    ...(fancy ? CAS.assStyles(L) : []),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
  const body = (cues || [])
    .filter((c) => c && String(c.text || '').trim() && Number(c.end) > Number(c.start))
    .map((c) => {
      if (!(c.spans && c.spans.length)) return `Dialogue: 0,${fmtAssTime(c.start)},${fmtAssTime(c.end)},P,,0,0,0,,${assText(c.text)}`;
      const rg = c.range || { from: 0, to: String(c.sentText || c.text).length };
      const runs = CF.lineRuns(c.sentText || c.text, c.spans, rg, base);
      const line = CF.lineProps(c.spans, rg, base, String(c.sentText || c.text).length);
      return CAS.formatEvents(CAS.cueEvents({ start: c.start, end: c.end, runs, line }, posLayout(line))).join('\n');
    })
    .filter(Boolean)
    .join('\n');
  return head + '\n' + body + '\n';
}

/** SRT 문자열 → 큐 배열(호출부가 큐 대신 SRT 만 갖고 있을 때). */
function cuesFromSrt(srtText) {
  const out = [];
  const toSec = (s) => {
    const m = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(s || '');
    if (!m) return null;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000;
  };
  for (const block of String(srtText || '').split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) continue;
    const ti = lines.findIndex((l) => l.indexOf('-->') >= 0);
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const start = toSec(a), end = toSec(b);
    if (start == null || end == null) continue;
    const text = lines.slice(ti + 1).join('\n').trim();
    if (text) out.push({ start, end, text });
  }
  return out;
}

/**
 * 자막을 **영상에 굽는다**. 어떤 경우에도 던지지 않는다.
 * @param opts.videoPath  최종 MP4(제자리 교체)
 * @param opts.cues       자막 큐 배열(권장). 없으면 `srtText` 를 파싱해 쓴다.
 * @param opts.tmpDir     중간 파일 폴더
 * @param opts.width/height  영상 픽셀 크기 — **ASS PlayRes 의 근거**(틀리면 글자 크기가 어긋난다)
 * @param opts.style      { font, sizePct, pos, marginPct, bold } — 채널 설정
 * @returns {{ok:true, output}} | {{ok:false, error}}
 */
async function burnSubtitle({ videoPath, cues = null, srtText = '', tmpDir, width = 0, height = 1080, style = null, log = () => {}, abortSignal = null } = {}) {
  if (!videoPath || !fs.existsSync(videoPath)) return { ok: false, error: '영상 파일이 없습니다' };
  const list = (cues && cues.length) ? cues : cuesFromSrt(srtText);
  if (!list.length) return { ok: false, error: '자막 내용이 없습니다' };
  // 🔑 필터 문자열에 **경로를 넣지 않는다** — 윈도우의 드라이브 콜론(`D:`)과 한글 폴더명이
  //   ffmpeg 필터 문법과 충돌한다. 임시 폴더를 cwd 로 두고 **ASCII 파일명 하나**만 가리킨다.
  const subName = '_wb_sub.ass';
  const subPath = path.join(tmpDir, subName);
  const outPath = path.join(tmpDir, '_wb_subbed.mp4');
  try {
    // 크기를 못 받았으면 실제 영상에서 읽는다 — PlayRes 가 어긋나면 글자 크기가 통째로 틀어진다.
    let W = Math.round(Number(width) || 0), H = Math.round(Number(height) || 0);
    if (!W || !H) {
      try {
        const info = await MU.getMediaInfo(videoPath);
        if (info && info.width && info.height) { W = info.width; H = info.height; }
      } catch (_) {}
    }
    if (!H) H = 1080;
    if (!W) W = Math.round(H * 16 / 9);
    // 🎨 문장 덮어쓰기에 글꼴이 있으면 그 글꼴 파일을 준비한다(core/font-store — Vrew 캐시·앱·사용자 글꼴)
    const usedFonts = [...new Set(list.flatMap((c) => (c.spans || []).map((x) => x && x.fmt && x.fmt.font).filter(Boolean)))];
    let fontMap = null, fontsArg = '';
    if (usedFonts.length) {
      const fr = FONTS.prepareFontsDir(usedFonts, path.join(tmpDir, '_wb_fonts'));
      fontMap = fr.map; fontsArg = ':fontsdir=_wb_fonts';
      if (fr.missing.length) log(`   ⚠ 이 PC 에 없는 글꼴 ${fr.missing.length}개 — 기본 글꼴로 굽습니다: ${fr.missing.join(', ')}`);
    }
    fs.writeFileSync(subPath, buildAss(list, { width: W, height: H, style, fontMap }), 'utf8');
    const t0 = Date.now();
    await _ff(['-y', '-i', videoPath,
      '-vf', `subtitles=${subName}${fontsArg}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy', '-movflags', '+faststart', outPath], { abortSignal, cwd: tmpDir });
    if (!fs.existsSync(outPath)) return { ok: false, error: '자막을 구운 결과가 없습니다' };
    fs.rmSync(videoPath, { force: true });
    fs.renameSync(outPath, videoPath);
    const st = normSubStyle(style);
    log(`💬 자막 굽기 완료 — ${((Date.now() - t0) / 1000).toFixed(1)}초 · ${W}x${H} · ${st.font} ${Math.round(H * st.sizePct / 100)}px · ${{ bottom: '하단', middle: '중앙', top: '상단' }[st.pos]}`);
    return { ok: true, output: videoPath };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    for (const f of [subPath, outPath, path.join(tmpDir, '_wb_fonts')]) { try { fs.rmSync(f, { force: true, recursive: true }); } catch (_) {} }
  }
}

module.exports = {
  buildSrt, buildCues, srtFromCues, cuesFromSrt, buildAss, fmtAssTime, assText,
  scenesForSubtitle, burnSubtitle, normSubStyle,
  SUB_DEFAULTS, POSITIONS, FONT_RATIO, MARGIN_RATIO, FONT_CANDIDATES,
};
