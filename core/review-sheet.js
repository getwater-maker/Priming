'use strict';
/**
 * review-sheet.js — 🔍 검수 판(2.0 덧붙임4 ㊽ · v1.0.30) — 구운 MP4 에서 장면마다 대표 프레임 하나를 뽑아 한 장에 4×4 칸으로 묶는다.
 *   2.0 은 렌더 뒤 Claude 세션이 이 판(편당 몇 장)을 보고 얼굴 · 결함 · 카드 가독을 판정한다 — **여기는 만들기만 · 판정 없음**.
 *   · 프레임은 **굽힌 MP4** 에서 ffmpeg 로 뽑는다(렌더러를 두 벌로 만들지 않는다 — 판에 보이는 것 = 올라갈 영상).
 *   · 칸 = 480×270 그림 + 아래 글 줄(`G번호 · 영상 안 시각 mm:ss · 요약`) · 판 = 4×4 = 16칸 · 마지막 판의 빈칸은 검정.
 *   · 대표 시각: 대사 카드 = 글자가 다 찬 뒤(카드 시작 + lead + type + 0.3초) · 그 밖 = 장면 가운데(층 장면은 ㊸ 이 들어오면 움직임 끝).
 *   · 정지 구간 = ffmpeg freezedetect(작게 줄여 · 2초 이상 같은 화면) → `정지구간.tsv`(시작 · 끝 · 길이 · 장면).
 *   ffmpeg 필터에 경로를 넣지 않는다(드라이브 콜론·한글) — 작업 폴더를 cwd 로, 글꼴·프레임은 ASCII 이름으로 복사해 쓴다.
 *   Node 전용(main · 시험) — 렌더러 번들에 넣지 않는다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const CELL = { w: 480, h: 270, label: 40 };
const GRID = { cols: 4, rows: 4 };
const STILL_MIN_SEC = 2;

function ffmpeg() { return require('./media-utils').getFfmpegPath(); }
function run(args, cwd, timeout = 120000) {
  return new Promise((res) => execFile(ffmpeg(), args, { cwd, windowsHide: true, timeout, maxBuffer: 1 << 26 }, (e, so, se) => res({ ok: !e, out: String(so || ''), err: String(se || (e && e.message) || '') })));
}
const mmss = (t) => { const s = Math.max(0, Math.floor(t)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/**
 * 장면 시각표 — 그룹 순서대로 문장 음성 + 쉼(pausePlan) + 빈 클립을 이어 붙인다(.vrew 타임라인과 같은 규칙).
 *   mp4Sec 를 주면 합계를 MP4 실제 길이에 비례로 맞춘다(_orderMakeLog 와 같은 방식).
 * @returns [{ num, t0, t1 }]
 */
function sceneSpans(project, pauseMap, mp4Sec) {
  const SC = require('./screen-cards');
  const byId = new Map((project.sentences || []).map((s) => [s.id, s]));
  let t = 0; const out = [];
  for (const g of (project.groups || [])) {
    const t0 = t;
    for (const id of (g.sentenceIds || [])) {
      const s = byId.get(id); if (!s) continue;
      const d = (s.ttsAudioPath && s.ttsDurationSec > 0) ? s.ttsDurationSec : 0;
      t += d + (d > 0 ? ((pauseMap && pauseMap.get(s.id)) || 0) : 0) + SC.padOf(s);
    }
    out.push({ num: g.num, t0, t1: t });
  }
  const f = mp4Sec > 0 && t > 0 ? Math.min(2, Math.max(0.5, mp4Sec / t)) : 1;
  return out.map((x) => ({ num: x.num, t0: x.t0 * f, t1: x.t1 * f }));
}

/**
 * 칸 목록 — 장면마다 하나 + 대사 카드마다 하나(카드 칸은 글자가 다 찬 프레임).
 *   summaryOf(g) = 칸 글 줄의 요약(지시 줄 요약 — 판 · 움직임 · 인물 등 · 없으면 빈 글)
 * @returns [{ kind:'scene'|'quote', num, t, label }]
 */
function cellsOf(project, spans, cards, summaryOf) {
  const SC = require('./screen-cards'); const Q = SC.QUOTE;
  const cells = [];
  const byNum = new Map((project.groups || []).map((g) => [g.num, g]));
  for (const sp of spans) {
    const g = byNum.get(sp.num);
    const sum = summaryOf ? String(summaryOf(g) || '') : '';
    const qs = (cards || []).filter((c) => c.kind === 'quote' && c.t0 >= sp.t0 - 0.05 && c.t0 < sp.t1 + 0.05);
    const end = qs.length ? Math.min(...qs.map((c) => c.t0)) : sp.t1;   // 장면 그림이 보이는 끝(대사 카드 전까지)
    const t = sp.t0 + Math.max(0, end - sp.t0) / 2;
    cells.push({ kind: 'scene', num: sp.num, t, label: `G${sp.num} · ${mmss(sp.t0)}${sum ? ' · ' + sum : ''}` });
    for (const c of qs) {
      const tq = Math.min(c.t1 - 0.1, c.t0 + Q.lead + Math.min(Q.type, (c.t1 - c.t0) * 0.5) + 0.3);
      cells.push({ kind: 'quote', num: sp.num, t: tq, label: `G${sp.num} 대사카드 ·${mmss(c.t0)} · ${c.speaker || '대사'}` });
    }
  }
  return cells;
}

/** 정지 구간(같은 화면 STILL_MIN_SEC 초 이상) — [{ t0, t1, sec }] */
async function stillSpans(mp4, minSec = STILL_MIN_SEC) {
  const r = await run(['-hide_banner', '-nostdin', '-i', mp4, '-an', '-vf', `scale=320:-2,freezedetect=n=0.003:d=${minSec}`, '-f', 'null', '-'], path.dirname(mp4), 30 * 60 * 1000);
  const out = []; let cur = null;
  for (const ln of r.err.split(/\r?\n/)) {
    let m = /freeze_start:\s*([\d.]+)/.exec(ln); if (m) { cur = { t0: Number(m[1]) }; continue; }
    m = /freeze_end:\s*([\d.]+)/.exec(ln); if (m && cur) { cur.t1 = Number(m[1]); cur.sec = Math.round((cur.t1 - cur.t0) * 100) / 100; out.push(cur); cur = null; }
  }
  if (cur) {   // 끝까지 멈춘 채로 끝남 — 길이는 영상 끝까지
    const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(r.err);
    const end = d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : cur.t0;
    cur.t1 = end; cur.sec = Math.round((end - cur.t0) * 100) / 100; if (cur.sec >= minSec) out.push(cur);
  }
  return out;
}

/**
 * 검수 판 만들기.
 * @param {object} a { mp4, outDir, project, pauseMap, cards, summaryOf, mp4Sec, fontFile }
 * @returns {Promise<{ ok, sheets: string[], cells: number, stillTsv: string|null, still: Array, error? }>}
 */
async function makeReviewSheets(a) {
  const { mp4, outDir } = a;
  if (!mp4 || !fs.existsSync(mp4)) return { ok: false, sheets: [], cells: 0, stillTsv: null, still: [], error: 'MP4 가 없습니다' };
  const spans = sceneSpans(a.project, a.pauseMap, a.mp4Sec);
  const cells = cellsOf(a.project, spans, a.cards, a.summaryOf);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-'));
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const font = a.fontFile || path.join(__dirname, '..', 'assets', 'fonts', 'Pretendard-Bold.ttf');
    try { fs.copyFileSync(font, path.join(tmp, 'f.ttf')); } catch (_) {}
    fs.copyFileSync(mp4, path.join(tmp, 'v.mp4'));   // 경로를 인자로만 넘기면 되지만 cwd 를 하나로 두려고 — 큰 파일이면 아래에서 원본 경로로
    const per = GRID.cols * GRID.rows;
    // ① 칸 그림 — 프레임 + 아래 글 줄(drawtext · 글꼴은 cwd 의 f.ttf)
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const lf = `l_${String(i).padStart(4, '0')}.txt`;   // 글은 파일로(필터 글자 이스케이프 없이 · 시각의 「:」 그대로)
      fs.writeFileSync(path.join(tmp, lf), String(c.label).replace(/\s+/g, ' ').trim().slice(0, 60), 'utf8');
      const vf = `scale=${CELL.w}:${CELL.h}:force_original_aspect_ratio=decrease,pad=${CELL.w}:${CELL.h}:(ow-iw)/2:(oh-ih)/2,pad=${CELL.w}:${CELL.h + CELL.label}:0:0:color=0x111111,`
        + `drawtext=fontfile=f.ttf:textfile=${lf}:fontsize=20:fontcolor=0xF0F0F0:x=10:y=${CELL.h + 10}`;
      const r = await run(['-y', '-v', 'error', '-nostdin', '-ss', String(Math.max(0, c.t).toFixed(3)), '-i', 'v.mp4', '-frames:v', '1', '-vf', vf, `c_${String(i).padStart(4, '0')}.png`], tmp);
      if (!r.ok) {   // 끝 너머 시각 등 — 검정 칸 + 글
        await run(['-y', '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `color=c=black:s=${CELL.w}x${CELL.h + CELL.label}`, '-frames:v', '1', '-vf', `drawtext=fontfile=f.ttf:textfile=${lf}:fontsize=20:fontcolor=0xF0F0F0:x=10:y=${CELL.h + 10}`, `c_${String(i).padStart(4, '0')}.png`], tmp);
      }
    }
    // ② 빈칸 채우기(마지막 판) → tile
    const nSheets = Math.max(1, Math.ceil(cells.length / per));
    for (let i = cells.length; i < nSheets * per; i++) await run(['-y', '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `color=c=black:s=${CELL.w}x${CELL.h + CELL.label}`, '-frames:v', '1', `c_${String(i).padStart(4, '0')}.png`], tmp);
    const r = await run(['-y', '-v', 'error', '-nostdin', '-framerate', '1', '-i', 'c_%04d.png', '-vf', `tile=${GRID.cols}x${GRID.rows}:padding=4:margin=4:color=0x000000`, '-q:v', '3', '-frames:v', String(nSheets), 's_%02d.jpg'], tmp);
    if (!r.ok) return { ok: false, sheets: [], cells: cells.length, stillTsv: null, still: [], error: '판 묶기 실패: ' + r.err.slice(0, 200) };
    // 옛 판 정리(같은 주문을 다시 만들면 장 수가 줄 수 있다) → 새 판 복사
    for (const f of fs.readdirSync(outDir)) if (/^판_\d+\.jpg$/.test(f)) { try { fs.rmSync(path.join(outDir, f), { force: true }); } catch (_) {} }
    const sheets = [];
    for (let k = 1; k <= nSheets; k++) {
      const src = path.join(tmp, `s_${String(k).padStart(2, '0')}.jpg`); if (!fs.existsSync(src)) continue;
      const dst = path.join(outDir, `판_${String(k).padStart(2, '0')}.jpg`); fs.copyFileSync(src, dst); sheets.push(dst);
    }
    // ③ 정지 구간
    const still = await stillSpans(path.join(tmp, 'v.mp4'));
    const sceneAt = (t) => { const s = spans.find((x) => t >= x.t0 - 1e-6 && t < x.t1); return s ? `G${s.num}` : ''; };
    const tsv = ['시작\t끝\t길이(초)\t장면', ...still.map((x) => `${mmss(x.t0)}\t${mmss(x.t1)}\t${x.sec}\t${sceneAt(x.t0)}`)].join('\n') + '\n';
    const stillTsv = path.join(outDir, '정지구간.tsv');
    fs.writeFileSync(stillTsv, '﻿' + tsv, 'utf8');
    return { ok: true, sheets, cells: cells.length, stillTsv, still };
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
}

module.exports = { CELL, GRID, STILL_MIN_SEC, sceneSpans, cellsOf, stillSpans, makeReviewSheets, mmss };
