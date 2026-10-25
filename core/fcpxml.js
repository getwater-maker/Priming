'use strict';
/**
 * fcpxml.js — 🎬 외부 편집기 내보내기(Lab · 남은 기능 ⑧ · Final Cut Pro X 의 FCPXML 1.9 — DaVinci Resolve·Premiere 도 읽는다)
 *   **읽기만 한다**(앱 상태 불변) · 순수(파일을 쓰지 않는다 — 문자열을 돌려준다 · main 이 저장).
 *   타임라인 = 문장 음성을 빈틈 없이 이어 붙인 시간(막간 쉼·빈 클립 포함 = .vrew 와 같은 누적) 위에:
 *     · 그룹 그림·영상 = 그 그룹 문장 구간(레인 1) · 삽입 그림·영상(레인 2+) · 삽입 오디오(레인 -2-) · 문장 음성 = 레인 -1
 *   뼈대는 「빈 갭 하나 + 연결 클립(lane)」 — 가장 널리 읽히는 단순한 꼴(스토리라인에 직접 붙인 클립보다 호환이 좋다).
 *   ⛔ 효과(켄번스·확대·필터·전환·자막)는 담지 않는다 — 소재와 길이·자리만(편집기에서 다시 입힌다).
 */
const path = require('path');

const FPS = 30;
const frames = (sec) => Math.max(0, Math.round((+sec || 0) * FPS));
const rt = (sec) => (frames(sec) === 0 ? '0s' : `${frames(sec)}/${FPS}s`);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 윈도우 경로 → file:/// URL (한글·공백은 퍼센트 인코딩 · 드라이브 문자 유지) */
function fileUrl(p) {
  const s = String(p || '').replace(/\\/g, '/');
  const m = /^([A-Za-z]):\/(.*)$/.exec(s);
  const enc = (x) => x.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return m ? `file:///${m[1]}:/${enc(m[2])}` : `file://${s.startsWith('/') ? '' : '/'}${enc(s)}`;
}

/**
 * @param pr 프로젝트(groups · sentences · overlays · getSentencesOfGroup)
 * @param o { name, pauses: Map(sentenceId → 쉼 초), canvas:{w,h}, exists:(file)=>boolean }
 * @returns { xml, totalSec, assets, clips }
 */
function build(pr, o = {}) {
  const canvas = o.canvas || { w: 1920, h: 1080 };
  const exists = o.exists || (() => true);
  const pauses = o.pauses || new Map();
  // ① 시간표 — 문장마다 시작·길이(음성 + 쉼 전체) · 음성이 없는 문장은 길이 0(건너뛴다 = .vrew 와 같다)
  const order = []; const start = new Map(); let t = 0;
  for (const g of pr.groups || []) for (const s of pr.getSentencesOfGroup(g)) {
    const sound = !!(s.ttsAudioPath && s.ttsDurationSec > 0);
    const dur = sound ? s.ttsDurationSec + (pauses.get(s.id) || 0) : 0;
    order.push({ s, g, sound, t0: t, dur, audioDur: sound ? s.ttsDurationSec : 0 }); start.set(s.id, order.length - 1); t += dur;
  }
  const total = t;
  const assets = new Map(); let aid = 0;
  const asset = (file, kind, dur) => {
    const key = file + '|' + kind;
    if (!assets.has(key)) assets.set(key, { id: 'a' + (++aid), file, kind, dur: dur || 0, name: path.basename(file) });
    const a = assets.get(key); if (dur > a.dur) a.dur = dur; return a;
  };
  const clips = [];   // { assetId, lane, offset, dur, start(소스 시작), name }
  // ② 문장 음성(레인 -1)
  for (const x of order) if (x.sound && exists(x.s.ttsAudioPath)) { const a = asset(x.s.ttsAudioPath, 'audio', x.audioDur); clips.push({ a, lane: -1, offset: x.t0, dur: x.audioDur, start: 0, name: `컷${x.s.num}` }); }
  // ③ 그룹 그림·영상(레인 1) — 그 그룹의 문장 구간(음성이 있는 문장만 이어진 시간)
  for (const g of pr.groups || []) {
    const idx = pr.getSentencesOfGroup(g).map((s) => start.get(s.id)).filter((i) => i != null && order[i].dur > 0);
    if (!idx.length) continue;
    const t0 = order[idx[0]].t0, t1 = order[idx[idx.length - 1]].t0 + order[idx[idx.length - 1]].dur;
    const vid = g.videoPath && exists(g.videoPath), img = !vid && g.imagePath && exists(g.imagePath);
    if (!vid && !img) continue;
    const a = asset(vid ? g.videoPath : g.imagePath, vid ? 'video' : 'image', vid ? Math.min(t1 - t0, 3600) : 0);
    clips.push({ a, lane: 1, offset: t0, dur: t1 - t0, start: 0, name: `G${g.num}` });
  }
  // ④ 삽입(그림·영상 = 레인 2+ · 오디오 = 레인 -2-)
  let vl = 2, al = -2;
  const OL = require('./overlay-layers');
  for (const ov of pr.overlays || []) {
    if (!ov || !ov.file || !exists(ov.file)) continue;
    const r = OL.rangeOf(pr, ov); if (!r) continue;
    const a0 = order[r.a], b0 = order[r.b]; if (!a0 || !b0) continue;
    const t0 = a0.t0, t1 = b0.t0 + b0.dur; if (!(t1 > t0)) continue;
    const kind = ov.kind === 'audio' ? 'audio' : ov.kind === 'video' ? 'video' : 'image';
    const a = asset(ov.file, kind, kind === 'image' ? 0 : t1 - t0);
    clips.push({ a, lane: kind === 'audio' ? al-- : vl++, offset: t0, dur: t1 - t0, start: 0, name: ov.name || path.basename(ov.file) });
  }
  // ⑤ 직렬화
  const fmt = 'r1';
  const L = [];
  L.push('<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE fcpxml>', '<fcpxml version="1.9">', '  <resources>');
  L.push(`    <format id="${fmt}" name="FFVideoFormat${canvas.h}p${FPS}" frameDuration="1/${FPS}s" width="${canvas.w}" height="${canvas.h}" colorSpace="1-1-1 (Rec. 709)"/>`);
  for (const a of assets.values()) {
    const hasV = a.kind !== 'audio' ? 1 : 0, hasA = a.kind !== 'image' ? 1 : 0;
    L.push(`    <asset id="${a.id}" name="${esc(a.name)}" src="${esc(fileUrl(a.file))}" start="0s" duration="${rt(Math.max(a.dur, a.kind === 'image' ? 0 : 0.04))}" hasVideo="${hasV}" hasAudio="${hasA}"${hasV ? ` format="${fmt}"` : ''}${hasA ? ' audioSources="1" audioChannels="1" audioRate="48000"' : ''}/>`);
  }
  L.push('  </resources>', '  <library>', `    <event name="${esc(o.name || 'Priming')}">`, `      <project name="${esc(o.name || 'Priming')}">`);
  L.push(`        <sequence format="${fmt}" duration="${rt(total)}" tcStart="0s" tcFormat="NDF" audioLayout="mono" audioRate="48k">`, '          <spine>', `            <gap name="Priming" offset="0s" start="0s" duration="${rt(total)}">`);
  for (const c of clips.sort((x, y) => (x.lane - y.lane) || (x.offset - y.offset))) {
    L.push(`              <asset-clip ref="${c.a.id}" lane="${c.lane}" offset="${rt(c.offset)}" name="${esc(c.name)}" start="${rt(c.start)}" duration="${rt(c.dur)}"${c.a.kind !== 'audio' ? ` format="${fmt}"` : ''}/>`);
  }
  L.push('            </gap>', '          </spine>', '        </sequence>', '      </project>', '    </event>', '  </library>', '</fcpxml>');
  return { xml: L.join('\n') + '\n', totalSec: total, assets: assets.size, clips: clips.length };
}

module.exports = { FPS, rt, esc, fileUrl, build };
