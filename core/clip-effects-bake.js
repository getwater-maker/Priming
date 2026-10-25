'use strict';
/**
 * clip-effects-bake.js — 🔥 효과 「굽기」(Lab · docs/VrewLab/효과_규칙_설계.md §2-3) — **Node 전용**(ffmpeg · 렌더러 번들에 넣지 않는다).
 *   효과 ② 클립 배경색 = 그림을 캔버스 크기 사본에 배경색 위로 얹어 구운 파일을 `.vrew` 가 가리킨다(Vrew 가 아는 형식 = 그림 파일만 쓴다).
 *   · 원본은 건드리지 않는다 · 사본은 **내용 지문 이름**(`<sha1>.png`)이라 같은 입력이면 다시 굽지 않고, 설정을 바꿔도 옛 사본을 덮지 않는다.
 *   · 사본 위치 = os.tmpdir()/priming-fx — `.vrew` 에는 사본이 **들어가므로**(zip) 나중에 지워져도 완성물은 그대로.
 *   · 메인 프로세스에서 동기 자식 프로세스 금지(CLAUDE.md §6) → 비동기 spawn.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CACHE_DIR = path.join(os.tmpdir(), 'priming-fx');

/** 사본 이름 지문 — 원본 신원(경로·크기·수정시각) + 효과 값 + 캔버스 + 박스 */
function bakeKey({ src, bg, W, H, box }) {
  let id = src;
  try { const st = fs.statSync(src); id += '|' + st.size + '|' + Math.round(st.mtimeMs); } catch (_) {}
  const r = (v) => Math.round(Number(v) * 10000) / 10000;
  return crypto.createHash('sha1').update([id, bg, W, H, r(box.x), r(box.y), r(box.w), r(box.h), 'bg1'].join('|')).digest('hex').slice(0, 16);
}

/**
 * 배경색 사본을 만든다 → 사본 경로(실패하면 null — 호출한 쪽이 원본으로 계속한다).
 * @param {{src:string, bg:string('#rrggbb'), W:number, H:number, box:{x,y,w,h}(캔버스 0..1 · 넘쳐도 된다), ffmpegPath:string, dir?:string}} o
 */
function bakeBackground(o) {
  const { src, bg, W, H, box, ffmpegPath } = o;
  return new Promise((resolve) => {
    try {
      if (!ffmpegPath || !fs.existsSync(ffmpegPath) || !fs.existsSync(src) || !/^#[0-9a-f]{6}$/.test(bg || '')) return resolve(null);
      const dir = o.dir || CACHE_DIR;
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, bakeKey({ src, bg, W, H, box }) + '.png');
      if (fs.existsSync(out) && fs.statSync(out).size > 64) return resolve(out);   // 같은 입력 = 다시 굽지 않는다
      const bw = Math.max(2, Math.round(box.w * W)), bh = Math.max(2, Math.round(box.h * H));
      const bx = Math.round(box.x * W), by = Math.round(box.y * H);
      const tmp = out + '.tmp.png';
      const g = `[1:v]scale=${bw}:${bh}:flags=lanczos,format=rgba[i];[0:v][i]overlay=x=${bx}:y=${by}:format=auto,format=rgb24`;
      const p = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `color=c=0x${bg.slice(1)}:s=${W}x${H}`, '-i', src, '-filter_complex', g, '-frames:v', '1', tmp], { windowsHide: true, stdio: 'ignore' });
      p.on('error', () => resolve(null));
      p.on('close', (code) => {
        try { if (code === 0 && fs.existsSync(tmp)) { fs.renameSync(tmp, out); return resolve(out); } } catch (_) {}
        try { fs.rmSync(tmp, { force: true }); } catch (_) {}
        resolve(null);
      });
    } catch (_) { resolve(null); }
  });
}

/**
 * 필터 사본(그림) — 원본(또는 배경색 사본) 크기 그대로 PNG. 같은 입력은 다시 굽지 않는다 → 경로(실패하면 null).
 * @param {{src:string, filter:string(id), ffmpegPath:string, dir?:string}} o
 */
function bakeFilter(o) {
  const CE = require('./clip-effects');
  const { src, filter, ffmpegPath } = o;
  return new Promise((resolve) => {
    try {
      const vf = CE.ffmpegFilter(filter);
      if (!vf || !ffmpegPath || !fs.existsSync(ffmpegPath) || !fs.existsSync(src)) return resolve(null);
      const dir = o.dir || CACHE_DIR;
      fs.mkdirSync(dir, { recursive: true });
      let id = src; try { const st = fs.statSync(src); id += '|' + st.size + '|' + Math.round(st.mtimeMs); } catch (_) {}
      const key = crypto.createHash('sha1').update([id, filter, vf, 'fl1'].join('|')).digest('hex').slice(0, 16);
      const out = path.join(dir, key + '.png');
      if (fs.existsSync(out) && fs.statSync(out).size > 64) return resolve(out);
      const tmp = out + '.tmp.png';
      const p = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-vf', vf + ',format=rgba', '-frames:v', '1', tmp], { windowsHide: true, stdio: 'ignore' });
      p.on('error', () => resolve(null));
      p.on('close', (code) => {
        try { if (code === 0 && fs.existsSync(tmp)) { fs.renameSync(tmp, out); return resolve(out); } } catch (_) {}
        try { fs.rmSync(tmp, { force: true }); } catch (_) {}
        resolve(null);
      });
    } catch (_) { resolve(null); }
  });
}

module.exports = { CACHE_DIR, bakeKey, bakeBackground, bakeFilter };
