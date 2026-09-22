#!/usr/bin/env node
/**
 * .vrew → MP4 직접 렌더 (Vrew 「내보내기」 대체) — 1단계 실물 검증용
 * ---------------------------------------------------------------------------
 * 쓰는 법:
 *   node scripts/vrew-to-mp4.js "<작업폴더 또는 .vrew 경로>" [옵션]
 *     --out <경로>       출력 MP4 (기본: 작업폴더/<이름>_direct.mp4)
 *     --par <N>          동시 렌더 개수 (기본 4)
 *     --limit <초>       앞 N초만 렌더 (검증용 — 전체 17분을 기다리지 않게)
 *     --fontsize <px>    자막 글자 크기 (기본 74)
 *     --marginv <px>     자막 하단 여백 (기본 176)
 *     --marginl <px>     자막 좌 여백 (기본 65)
 *     --outline <px>     자막 외곽선 (기본 6)
 *     --bitrate <k>      비디오 비트레이트 (기본 950k = Vrew 실측 949kbps)
 *     --cpu              NVENC 대신 libx264
 *     --keep             임시 폴더 유지(디버깅)
 *
 * 🔑 왜 .vrew 를 입력으로 쓰나
 *   .vrew 는 결과물이 아니라 **설계도**다. vrew-builder 가 이미 문장별 길이·자막 줄별
 *   시간 슬라이스·켄번스 패턴·자산 배정을 전부 계산해 넣어 두었다. Vrew 는 그걸 받아
 *   픽셀로 굽는 렌더러 역할만 한다. 그래서 같은 .vrew 를 읽으면 **Vrew 와 완전히 같은
 *   입력**으로 렌더할 수 있다(자산도 zip 안에 들어 있어 경로가 어긋날 여지가 없다).
 *
 * 🔑 프레임 반올림 누적 오차 방지
 *   세그먼트마다 길이를 프레임으로 반올림하면 오차가 쌓여 뒤로 갈수록 음성과 어긋난다
 *   (화이트보드 v0.5.12 에서 겪은 그 문제). 그래서 **끝 시각 기준 누적 반올림**으로
 *   frames_i = round(end_i*fps) - round(start_i*fps) 를 쓴다 → 총합이 정확히 맞는다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const AdmZip = require('adm-zip');

const FF = require('ffmpeg-static');
const FPS = 30;
const CANVAS_W = 1920;
const CANVAS_H = 1080;

// ─────────────────────────── 인자 ───────────────────────────
function parseArgs(argv) {
  const a = { par: 4, fontsize: 74, marginv: 176, marginl: 65, outline: 6, bitrate: '950k' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--cpu') a.cpu = true;
    else if (t === '--keep') a.keep = true;
    else if (t.startsWith('--')) a[t.slice(2)] = argv[++i];
    else rest.push(t);
  }
  a.input = rest[0];
  a.par = Math.max(1, Math.min(8, +a.par || 4));
  a.fontsize = +a.fontsize || 74;
  a.marginv = +a.marginv || 176;
  a.marginl = +a.marginl || 65;
  a.outline = +a.outline || 6;
  if (a.limit != null) a.limit = +a.limit;
  return a;
}

// ─────────────────────────── ffmpeg 실행 ───────────────────────────
function ff(args, { quiet = true } = {}) {
  return new Promise((res, rej) => {
    execFile(FF, args, { maxBuffer: 1 << 26 }, (err, so, se) => {
      if (err) rej(new Error(String(se || err).split('\n').filter(Boolean).slice(-3).join(' / ')));
      else res(String(se || ''));
    });
  });
}

/** ffprobe 없이 ffmpeg stderr 로 길이 재기(앱의 media-utils 와 같은 방식). */
async function mediaDuration(file) {
  try {
    const out = await ff(['-hide_banner', '-i', file, '-f', 'null', '-']);
    const m = /time=(\d+):(\d{2}):(\d{2})\.(\d+)/g;
    let last = null, r;
    while ((r = m.exec(out))) last = r;
    if (last) return (+last[1]) * 3600 + (+last[2]) * 60 + (+last[3]) + (+last[4]) / 100;
  } catch { /* 무시 */ }
  return null;
}

// ─────────────────────────── .vrew 읽기 ───────────────────────────
function findVrew(input) {
  const st = fs.statSync(input);
  if (st.isFile() && input.toLowerCase().endsWith('.vrew')) return input;
  if (!st.isDirectory()) throw new Error('입력이 .vrew 파일도 폴더도 아닙니다: ' + input);
  const f = fs.readdirSync(input).find((x) => x.toLowerCase().endsWith('.vrew'));
  if (!f) throw new Error('.vrew 를 찾지 못했습니다: ' + input);
  return path.join(input, f);
}

function loadVrew(vrewPath, workDir) {
  const zip = new AdmZip(vrewPath);
  const project = JSON.parse(zip.readAsText('project.json'));
  const mediaDir = path.join(workDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  let n = 0;
  for (const e of zip.getEntries()) {
    if (!e.entryName.startsWith('media/') || e.isDirectory) continue;
    fs.writeFileSync(path.join(mediaDir, path.basename(e.entryName)), e.getData());
    n++;
  }
  return { project, mediaDir, mediaCount: n };
}

// ─────────────────────────── 타임라인 ───────────────────────────
/**
 * clips 를 훑어 ① 시각 ② 시각자산 세그먼트 ③ 자막 큐 ④ 음성 파일 순서를 뽑는다.
 * 모두 .vrew 안의 값 그대로 — 재계산하지 않는다.
 */
function buildTimeline(project, mediaDir) {
  const tracks = project.props.tracks || {};
  const assets = project.props.assets || {};
  const files = project.files || [];
  const byMediaId = new Map();
  for (const f of files) byMediaId.set(f.mediaId, f);

  const trackOf = (aid) => {
    const a = assets[aid];
    if (!a || !a.trackIds || !a.trackIds.length) return null;
    return tracks[a.trackIds[0]] || null;
  };
  const fileOf = (tr) => {
    if (!tr || !tr.mediaId) return null;
    const f = byMediaId.get(tr.mediaId);
    if (!f || !f.name) return null;
    const p = path.join(mediaDir, f.name);
    return fs.existsSync(p) ? p : null;
  };

  const clips = (project.transcript && project.transcript.clips) || [];
  const segments = [];   // 시각 자산 구간
  const cues = [];       // 자막
  const audio = [];      // 문장 음성(순서대로, 중복 제거)
  let t = 0;
  let curKey = null, curSeg = null;
  let lastTtsMediaId = null;

  for (const c of clips) {
    const dur = (c.words || []).reduce((s, w) => s + (+w.duration || 0), 0);
    if (!(dur > 0)) continue;
    const start = t, end = t + dur;
    t = end;

    // ① 시각 자산 — 같은 asset 이 이어지면 한 세그먼트
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
    } else {
      curSeg.end = end;
    }

    // ② 자막 — captions[0] 의 insert 를 이어붙인다(빈 줄 캡션은 건너뜀)
    const cap = (c.captions || [])[0];
    if (cap && Array.isArray(cap.text)) {
      const txt = cap.text.map((x) => String(x.insert || '')).join('').replace(/\r?\n/g, ' ').trim();
      if (txt) cues.push({ start, end, text: txt });
    }

    // ③ 음성 — word 의 ttsClip 트랙에서 mediaId 를 얻는다. 한 문장(mp3) 당 한 번만.
    // 🔑 **목표 길이를 함께 모은다.** mp3 실제 길이 합(1030.3초)과 .vrew 가 선언한 길이
    //   합(1036.0초)이 다르기 때문이다(인코더 지연·패딩). 그냥 이어붙이면 뒤로 갈수록
    //   음성이 자막보다 앞서 **최대 3초까지 어긋난다**(첫 대조에서 실측). 문장마다
    //   선언 길이에 맞춰(짧으면 무음 덧대고 길면 자름) 붙이면 드리프트가 0 이 된다.
    let mid = null;
    for (const w of (c.words || [])) {
      for (const aid of (w.assetIds || [])) {
        const tr = trackOf(aid);
        if (tr && tr.type === 'ttsClip' && tr.mediaId) { mid = tr.mediaId; break; }
      }
      if (mid) break;
    }
    if (mid && mid !== lastTtsMediaId) {
      let p = null;
      for (const w of (c.words || [])) {
        for (const aid of (w.assetIds || [])) {
          const tr = trackOf(aid);
          if (tr && tr.mediaId === mid) { p = fileOf(tr); break; }
        }
        if (p) break;
      }
      if (p) audio.push({ file: p, dur: 0 });
      lastTtsMediaId = mid;
    }
    if (audio.length && mid) audio[audio.length - 1].dur += dur;
  }
  return { segments, cues, audio, totalSec: t };
}

// ─────────────────────────── 켄번스 → zoompan ───────────────────────────
/**
 * Vrew 이미지 트랙(박스 + 켄번스) → ffmpeg 필터 체인.
 *
 * 🔑 Vrew 의 `scale` 은 확대배율이 아니라 **"이미지에서 보이는 영역의 비율"** 이다
 *   (1.0 = 전체, 작을수록 줌인). vrew-builder 주석에 명시돼 있다.
 *
 * 🔑 그리고 **트랙 박스(width/height/xPos/yPos)를 반드시 반영해야 한다.**
 *   실측 사례: `width:1.008` — 이미지 1344x768(1.75)을 캔버스 1920x1080(1.778)에
 *   cover 하면 Vrew 는 폭 1935.4px 로 그린다. 이걸 무시하고 1920 으로 그리면
 *   **켄번스가 약 1% 더 확대**되어 같은 시점에 더 줌인된 그림이 나온다
 *   (첫 대조에서 실제로 그렇게 어긋났다).
 *
 *   박스 폭 BW 로 cover 한 뒤 보이는 영역(BW*scale)을 캔버스 폭으로 늘리므로
 *     z = CANVAS_W / (BW * scale)
 *
 * 🔴 **zoompan 의 x/y 는 문서와 다르게 동작한다 — 반드시 실측으로 확인할 것.**
 *   문서는 "확대된 이미지 안에서의 좌상단 좌표"라고 하지만, 실제로는 **확대 전(원본)
 *   좌표**로 해석하고 zoompan 이 내부에서 z 를 곱한다.
 *   실측(z=1.2195): 요청 x=100 → 실제 창 x=122.2 · 요청 200 → 244.2 (정확히 ×z).
 *   이걸 모르고 문서대로 `cx*BW*z - W/2` 를 주면 그 값에 z 가 또 곱해져 화면이
 *   옆으로 밀리고, 스윕으로 재면 "scale 이 틀린 것처럼" 보인다(첫 대조에서 이렇게 헤맸다).
 *     x = centerX*BW - CANVAS_W/(2*z)
 *     y = centerY*BH - CANVAS_H/(2*z)
 *
 * ⚠ 보간은 **선형**이다(실측으로 확인 — 세그먼트 시작·중간·끝 모두 선형 예측과 일치).
 * ⚠ z 는 1 미만이면 zoompan 이 깨지므로 하한을 둔다(scale=1.0 인 트랙 대비).
 */
function kenBurnsFilter(kb, frames, box, off = 0, total = 0) {
  // ⚠ 트랙 박스(width/height)는 **반영하지 않는다** — 실측에서 1920x1080 cover 가
  //   Vrew 와 더 잘 맞았다(박스 1.008 을 반영하면 오히려 오차가 커졌다).
  //   box 는 나중에 레터박스(fit) 트랙을 다룰 때를 위해 받아만 둔다.
  const BW = CANVAS_W;
  const BH = CANVAS_H;
  const cover = `scale=${BW}:${BH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${BW}:${BH}`;
  if (!kb || !kb.from) {
    // 켄번스가 없으면 박스를 캔버스로 맞추기만 한다(중앙).
    return `${cover},scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${CANVAS_W}:${CANVAS_H}`;
  }
  const f = kb.from, to = kb.to || kb.from;
  // 🔑 긴 구간은 여러 조각으로 나눠 병렬 렌더한다 — 그때 진행률은 **조각이 아니라
  //   원래 구간 전체** 기준이어야 켄번스가 이어진다(off = 조각 시작 프레임).
  const n = Math.max(1, (total > 0 ? total : frames) - 1);
  const prog = off > 0 ? `(on+${off})/${n}` : `on/${n}`;
  const lerp = (a, b) => `(${a}+(${b}-${a})*${prog})`;
  const sc = lerp(+f.scale || 1, +to.scale || 1);
  const cx = lerp(f.centerX == null ? 0.5 : +f.centerX, to.centerX == null ? 0.5 : +to.centerX);
  const cy = lerp(f.centerY == null ? 0.5 : +f.centerY, to.centerY == null ? 0.5 : +to.centerY);
  const z = `max(1.0001,${CANVAS_W}/(${BW}*${sc}))`;
  // 🔴 x/y 는 **원본 좌표**로 준다(zoompan 이 내부에서 z 를 곱한다 — 위 주석 참조).
  const x = `(${cx}*${BW}-${CANVAS_W}/(2*(${z})))`;
  const y = `(${cy}*${BH}-${CANVAS_H}/(2*(${z})))`;
  const zp = `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${CANVAS_W}x${CANVAS_H}:fps=${FPS}`;
  return `${cover},${zp}`;
}

// ─────────────────────────── 자막 ASS ───────────────────────────
function fmtAss(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  const c2 = cs === 100 ? 99 : cs;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(c2).padStart(2, '0')}`;
}
const assEsc = (t) => String(t).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\N');

/**
 * Vrew 자막을 ASS 로. 실측값(1920x1080 · Pretendard Bold · 왼쪽 정렬 · 하단)에 맞춘다.
 * 🔑 PlayResX/Y 를 영상 해상도로 박아야 FontSize·Margin 이 픽셀 그대로 먹는다
 *   (SRT 를 subtitles 필터에 그냥 물리면 384x288 로 읽혀 3.75배로 커진다 — v0.5.13).
 */
function buildAss(cues, opt) {
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${CANVAS_W}`,
    `PlayResY: ${CANVAS_H}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Alignment 1 = 좌하단(Vrew 실측: --textbox-align start · x 시작 65px)
    `Style: P,${opt.font},${opt.fontsize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,${opt.outline},0,1,${opt.marginl},${opt.marginl},${opt.marginv},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
  const body = cues
    .filter((c) => c.text && c.end > c.start)
    .map((c) => `Dialogue: 0,${fmtAss(c.start)},${fmtAss(c.end)},P,,0,0,0,,${assEsc(c.text)}`)
    .join('\n');
  return head + '\n' + body + '\n';
}

// ─────────────────────────── 세그먼트 렌더 ───────────────────────────
async function renderSegment(seg, i, ctx) {
  const { tmpDir, args, fontsDir } = ctx;
  const frames = seg.f1 - seg.f0;
  const dur = frames / FPS;
  const out = path.join(tmpDir, `seg_${String(i).padStart(4, '0')}.mp4`);
  const assName = `seg_${String(i).padStart(4, '0')}.ass`;

  // 이 세그먼트에 걸리는 자막만, 시각을 세그먼트 기준으로 옮겨 담는다.
  const segCues = ctx.cues
    .filter((c) => c.end > seg.tStart && c.start < seg.tStart + dur)
    .map((c) => ({
      start: Math.max(0, c.start - seg.tStart),
      end: Math.min(dur, c.end - seg.tStart),
      text: c.text,
    }));
  fs.writeFileSync(path.join(tmpDir, assName), buildAss(segCues, args), 'utf8');

  // ⚠ ffmpeg 필터에 경로를 넣지 않는다 — 윈도우 드라이브 콜론(D:)과 한글 폴더명이
  //   필터 문법과 충돌한다. cwd 를 tmpDir 로 두고 ASCII 파일명만 가리킨다(v0.5.12).
  const assFilter = `ass=${assName}:fontsdir=${path.basename(fontsDir)}`;

  const enc = args.cpu
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', args.bitrate]
    : ['-c:v', 'h264_nvenc', '-preset', 'p4', '-b:v', args.bitrate];

  let cmd;
  if (seg.type === 'image' && seg.file) {
    const tr = seg.track || {};
    const box = { w: tr.width, h: tr.height };
    const vf = [kenBurnsFilter(tr.kenburnsAnimationInfo, frames, box, seg.kbOff || 0, seg.kbTotal || frames), assFilter].join(',');
    cmd = ['-y', '-hide_banner', '-loglevel', 'error',
      '-loop', '1', '-framerate', String(FPS), '-i', seg.file,
      '-frames:v', String(frames), '-vf', vf, ...enc,
      '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an', out];
  } else if (seg.type === 'video' && seg.file) {
    // 영상이 세그먼트보다 짧으면 마지막 프레임을 이어 붙여 길이를 정확히 맞춘다.
    const vf = [
      `scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=increase:flags=lanczos`,
      `crop=${CANVAS_W}:${CANVAS_H}`,
      `fps=${FPS}`,
      'tpad=stop_mode=clone:stop_duration=600',
      assFilter,
    ].join(',');
    cmd = ['-y', '-hide_banner', '-loglevel', 'error', '-i', seg.file,
      '-frames:v', String(frames), '-vf', vf, ...enc,
      '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an', out];
  } else {
    // 자산이 없는 구간 — 검은 화면(자막은 유지)
    const vf = [assFilter].join(',');
    cmd = ['-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=black:s=${CANVAS_W}x${CANVAS_H}:r=${FPS}`,
      '-frames:v', String(frames), '-vf', vf, ...enc,
      '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an', out];
  }

  await new Promise((res, rej) => {
    execFile(FF, cmd, { cwd: tmpDir, maxBuffer: 1 << 26 }, (err, so, se) => {
      if (err) rej(new Error(`세그 ${i}(${seg.type}): ` + String(se || err).split('\n').filter(Boolean).slice(-2).join(' / ')));
      else res();
    });
  });
  return out;
}

// ─────────────────────────── 오디오 ───────────────────────────
/**
 * 문장 음성들을 이어붙인다.
 * ⚠ concat 데무서를 쓰지 않는다 — tts 폴더는 wav/mp3 가 섞이고 표본율도 제각각이라
 *   규격이 어긋나면 조용히 이상한 소리가 난다(화이트보드 v0.5.11 과 같은 이유).
 *   입력마다 aresample 로 맞춘 뒤 concat 필터로 붙인다.
 */
const A_RATE = 48000;
const CHUNK = 40;

async function concatAudioOnce(inputs, out, tmpDir) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const it of inputs) args.push('-i', it.file);
  // 🔑 문장마다 **선언 길이에 정확히 맞춘다** — apad 로 덧대고 atrim 으로 자른다.
  //   (dur 이 없는 중간 결과물은 그대로 이어붙인다)
  const norm = inputs.map((it, i) => {
    const base = `[${i}:a]aresample=${A_RATE},aformat=sample_fmts=s16:channel_layouts=stereo`;
    if (!(it.dur > 0)) return `${base}[a${i}]`;
    const d = it.dur.toFixed(4);
    return `${base},apad=whole_dur=${d},atrim=0:${d},asetpts=N/SR/TB[a${i}]`;
  }).join(';');
  const chain = inputs.map((_, i) => `[a${i}]`).join('');
  args.push('-filter_complex', `${norm};${chain}concat=n=${inputs.length}:v=0:a=1[out]`,
    '-map', '[out]', '-c:a', 'pcm_s16le', out);
  await new Promise((res, rej) => {
    execFile(FF, args, { cwd: tmpDir, maxBuffer: 1 << 26 }, (e, so, se) => {
      e ? rej(new Error('오디오 concat: ' + String(se || e).split('\n').slice(-2).join(' '))) : res();
    });
  });
}

async function concatAudio(inputs, out, tmpDir, depth = 0) {
  if (inputs.length <= CHUNK) return concatAudioOnce(inputs, out, tmpDir);
  const parts = [];
  for (let i = 0; i < inputs.length; i += CHUNK) {
    const p = path.join(tmpDir, `ac_${depth}_${i}.wav`);
    await concatAudioOnce(inputs.slice(i, i + CHUNK), p, tmpDir);
    parts.push({ file: p });   // 중간 결과는 길이 보정 없이(이미 맞춰져 있다)
  }
  return concatAudio(parts, out, tmpDir, depth + 1);
}

// ─────────────────────────── 메인 ───────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('쓰는 법: node scripts/vrew-to-mp4.js "<작업폴더 또는 .vrew>" [--limit 60] [--par 4]');
    process.exit(1);
  }
  const t0 = Date.now();
  const vrewPath = findVrew(args.input);
  const baseDir = fs.statSync(args.input).isDirectory() ? args.input : path.dirname(vrewPath);
  const name = path.basename(vrewPath, '.vrew');
  const outPath = args.out || path.join(baseDir, `${name}_direct.mp4`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrew2mp4-'));
  console.log(`📦 .vrew 읽는 중 — ${path.basename(vrewPath)}`);
  const { project, mediaDir, mediaCount } = loadVrew(vrewPath, tmpDir);
  console.log(`   자산 ${mediaCount}개 추출`);

  // 폰트: Pretendard Bold (Vrew 자막 폰트). 없으면 시스템 폰트로 폴백.
  const fontsDir = path.join(tmpDir, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });
  const fontSrc = args.font || path.join(__dirname, '..', 'assets', 'fonts', 'Pretendard-Bold.ttf');
  let fontName = 'Pretendard';
  if (fs.existsSync(fontSrc)) {
    fs.copyFileSync(fontSrc, path.join(fontsDir, 'Pretendard-Bold.ttf'));
  } else {
    fontName = 'Malgun Gothic';
    console.log(`   ⚠ Pretendard 를 못 찾아 "${fontName}" 로 대체합니다 (${fontSrc})`);
  }
  args.font = fontName;

  const tl = buildTimeline(project, mediaDir);
  console.log(`🗺 타임라인 — ${(tl.totalSec / 60).toFixed(2)}분 · 세그먼트 ${tl.segments.length}개 · 자막 ${tl.cues.length}줄 · 음성 ${tl.audio.length}개`);

  // --limit: 앞 N초만
  let segs = tl.segments, cues = tl.cues, total = tl.totalSec;
  if (args.limit > 0 && args.limit < total) {
    total = args.limit;
    segs = tl.segments.filter((s) => s.start < total).map((s) => ({ ...s, end: Math.min(s.end, total) }));
    cues = tl.cues.filter((c) => c.start < total).map((c) => ({ ...c, end: Math.min(c.end, total) }));
    console.log(`   ✂ 검증 모드 — 앞 ${total}초만 렌더 (세그먼트 ${segs.length}개)`);
  }

  // 🔑 프레임 누적 반올림 — 오차가 쌓이지 않게 끝 시각 기준으로 계산
  for (const s of segs) {
    s.f0 = Math.round(s.start * FPS);
    s.f1 = Math.round(s.end * FPS);
    s.tStart = s.start;
  }
  const totalFrames = segs.length ? segs[segs.length - 1].f1 : 0;

  // 🔑 긴 이미지 구간은 조각으로 나눈다 — 한 구간이 75초씩 되면 병렬 렌더가
  //   그 하나를 기다리느라 효율이 떨어진다(실측: 24구간 4병렬에 6.28배속뿐).
  //   켄번스는 kbOff/kbTotal 로 이어 붙이므로 결과는 나누지 않은 것과 같다.
  const CHUNK_FRAMES = Math.max(120, Math.round((+args.chunk || 20) * FPS));
  const parts = [];
  for (const s of segs) {
    const n = s.f1 - s.f0;
    if (s.type !== 'image' || n <= CHUNK_FRAMES) { parts.push(s); continue; }
    for (let o = 0; o < n; o += CHUNK_FRAMES) {
      const len = Math.min(CHUNK_FRAMES, n - o);
      parts.push({ ...s, f0: s.f0 + o, f1: s.f0 + o + len, tStart: s.start + o / FPS, kbOff: o, kbTotal: n });
    }
  }
  if (parts.length !== segs.length) console.log(`   ✂ 긴 구간 분할 — 렌더 조각 ${parts.length}개 (구간 ${segs.length}개)`);
  segs = parts;

  // 세그먼트 병렬 렌더
  const ctx = { tmpDir, args, cues, fontsDir };
  const files = new Array(segs.length);
  let done = 0;
  const queue = segs.map((s, i) => [s, i]);
  const worker = async () => {
    while (queue.length) {
      const [s, i] = queue.shift();
      files[i] = await renderSegment(s, i, ctx);
      done++;
      if (done % 5 === 0 || done === segs.length) {
        process.stdout.write(`\r🎬 세그먼트 ${done}/${segs.length}   `);
      }
    }
  };
  console.log(`🎬 렌더 시작 — 동시 ${args.par} · ${args.cpu ? 'libx264' : 'NVENC'} · ${args.bitrate}`);
  await Promise.all(Array.from({ length: args.par }, worker));
  console.log('');

  // 이어붙이기 (무손실)
  const listPath = path.join(tmpDir, 'list.txt');
  fs.writeFileSync(listPath, files.map((f) => `file '${path.basename(f)}'`).join('\n'), 'utf8');
  const silent = path.join(tmpDir, 'silent.mp4');
  await new Promise((res, rej) => {
    execFile(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
      '-i', 'list.txt', '-c', 'copy', 'silent.mp4'], { cwd: tmpDir }, (e, so, se) => {
      e ? rej(new Error('concat: ' + String(se || e).slice(0, 200))) : res();
    });
  });
  console.log(`🔗 이어붙이기 완료 (${files.length}개)`);

  // 오디오
  let audioPath = null;
  const audios = tl.audio;
  if (audios.length) {
    try {
      const raw = path.join(tmpDir, 'voice.wav');
      await concatAudio(audios, raw, tmpDir);
      audioPath = raw;
      const ad = await mediaDuration(raw);
      console.log(`🔊 음성 이어붙이기 — ${audios.length}개 · ${ad ? ad.toFixed(1) + '초' : '?'} (영상 ${(totalFrames / FPS).toFixed(1)}초)`);
    } catch (e) {
      console.log(`   ⚠ 음성 실패 — 무음으로 진행: ${e.message}`);
    }
  }

  // mux — 비디오는 재인코딩하지 않는다(자막은 이미 구워져 있다)
  if (audioPath) {
    await ff(['-y', '-hide_banner', '-loglevel', 'error', '-i', silent, '-i', audioPath,
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-ac', '2',
      '-shortest', outPath]);
  } else {
    fs.copyFileSync(silent, outPath);
  }

  const sec = (Date.now() - t0) / 1000;
  const outSec = totalFrames / FPS;
  const sz = fs.statSync(outPath).size;
  console.log('');
  console.log(`✅ 완료 — ${outPath}`);
  console.log(`   영상 ${outSec.toFixed(1)}초 (${(outSec / 60).toFixed(2)}분) · ${(sz / 1048576).toFixed(1)}MB`);
  console.log(`   렌더 ${sec.toFixed(1)}초 → ${(outSec / sec).toFixed(2)}배속`);

  if (!args.keep) fs.rmSync(tmpDir, { recursive: true, force: true });
  else console.log(`   (임시 폴더 유지: ${tmpDir})`);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
