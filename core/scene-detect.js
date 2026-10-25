'use strict';
/**
 * scene-detect.js — 🎞 영상 장면 전환 찾기(Lab · 남은 기능 ⑥ · Vrew 「영상 분석」의 읽기 쪽)
 *   ffmpeg 내장 `select='gt(scene,T)'`(장면 점수) — 새 모델·의존성 없음. **찾기만 한다** — 영상·대본을 바꾸지 않는다(마커 달기는 main 이 따로·되돌릴 수 있게).
 *   main 전용(ffmpeg 를 부른다) · 파싱·시각→문장 규칙은 순수(시험이 직접 부른다).
 */
const { spawn } = require('child_process');

const TH = { min: 0.1, max: 0.9, def: 0.35 };
const normTh = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(Math.max(TH.min, Math.min(TH.max, n)) * 100) / 100 : TH.def; };

/** ffmpeg 메타데이터 출력 → [{t(초), score}] — 「pts_time:12.5」 줄 뒤에 「lavfi.scene_score=0.62」 */
function parseScenes(text) {
  const out = []; let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const a = /pts_time:([\d.]+)/.exec(line);
    if (a) { cur = { t: parseFloat(a[1]), score: 0 }; out.push(cur); continue; }
    const b = /lavfi\.scene_score=([\d.]+)/.exec(line);
    if (b && cur) cur.score = parseFloat(b[1]);
  }
  return out.filter((x) => Number.isFinite(x.t) && x.t > 0.05);   // 맨 앞(0초)은 전환이 아니다
}

/** 너무 가까운 전환(minGap 초 안)은 점수가 높은 하나만 */
function thin(scenes, minGap = 0.5) {
  const out = [];
  for (const s of scenes.slice().sort((x, y) => x.t - y.t)) {
    const last = out[out.length - 1];
    if (last && s.t - last.t < minGap) { if (s.score > last.score) out[out.length - 1] = s; } else out.push(s);
  }
  return out;
}

/**
 * 영상 안의 장면 전환 시각을 찾는다 → { ok, scenes:[{t,score}] } | { ok:false, error }
 * @param {{src:string, threshold?:number, ffmpegPath:string, timeoutMs?:number}} o
 */
function detect(o) {
  return new Promise((resolve) => {
    const { src, ffmpegPath } = o || {};
    if (!src || !ffmpegPath) return resolve({ ok: false, error: '영상 또는 ffmpeg 를 찾지 못했습니다' });
    const th = normTh(o.threshold);
    let out = '', err = '', done = false;
    let p;
    try {
      p = spawn(ffmpegPath, ['-hide_banner', '-nostats', '-i', src, '-an', '-vf', `select='gt(scene,${th})',metadata=print:file=-`, '-f', 'null', '-'], { windowsHide: true });
    } catch (e) { return resolve({ ok: false, error: e.message }); }
    const tm = setTimeout(() => { if (done) return; done = true; try { p.kill(); } catch (_) {} resolve({ ok: false, error: '장면 분석이 너무 오래 걸려 멈췄습니다' }); }, o.timeoutMs || 300000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { if (done) return; done = true; clearTimeout(tm); resolve({ ok: false, error: e.message }); });
    p.on('close', (code) => {
      if (done) return; done = true; clearTimeout(tm);
      if (code !== 0 && !out) return resolve({ ok: false, error: '영상을 분석하지 못했습니다(' + (err.split('\n').filter(Boolean).pop() || code) + ')' });
      resolve({ ok: true, threshold: th, scenes: thin(parseScenes(out)) });
    });
  });
}

/**
 * 영상 시각(초) → 그 그룹의 몇 번째 문장인가 — 문장 길이(음성 + 막간 쉼)를 이어 붙인 시간표에서. 범위 밖이면 -1
 * @param {number[]} durs 문장마다 길이(초 · 음성이 없으면 0 — 건너뛴다)
 */
function sentenceAt(durs, t) {
  let acc = 0;
  for (let i = 0; i < durs.length; i++) { const d = durs[i] > 0 ? durs[i] : 0; if (d > 0 && t >= acc && t < acc + d) return i; acc += d; }
  return -1;
}

module.exports = { TH, normTh, parseScenes, thin, detect, sentenceAt };
