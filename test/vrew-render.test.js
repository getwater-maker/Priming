/**
 * test/vrew-render.test.js — 🎬 .vrew → 유튜브 MP4 직접 렌더
 *   node test/vrew-render.test.js
 * 순수 함수(원문 모듈을 require) + **실제 ffmpeg 왕복**(합성 .vrew → MP4 → 화소·길이 측정) + 배선 원문 대조.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const R = require('../core/vrew-render');
const FF = require('ffmpeg-static');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

(async () => {
  console.log('[1] 자막 스타일 — 실측 보정값 재현');
  const calib = { style: { yAlign: 'bottom', yOffset: -0.125, width: 0.96, xOffset: 0, customAttributes: [{ attributeName: '--textbox-align', value: 'start' }] },
    attrs: { size: '100', color: '#ffffff', 'outline-color': '#000000', 'outline-width': '6', font: 'Pretendard-Vrew_700' } };
  const cs = R.captionAssStyle(calib, 'Pretendard');
  ok(cs.size === 72, `글자 크기 100 → 72 (${cs.size})`);
  ok(cs.marginL === 63 && cs.marginV === 173, `여백 L63·V173 (${cs.marginL}·${cs.marginV})`);
  ok(cs.align === 1, '왼쪽 아래 정렬(Alignment 1)');
  ok(cs.calibrated === true, '로이 채널 스타일 = 실측 보정 스타일');
  ok(cs.outline === 6 && cs.bold === true, '외곽선 6 · 굵게');
  const cs2 = R.captionAssStyle({ style: { yAlign: 'middle', customAttributes: [{ attributeName: '--textbox-align', value: 'center' }] }, attrs: { size: '75' } }, 'X');
  ok(cs2.calibrated === false && cs2.align === 5, '다른 스타일은 calibrated=false 로 알린다');
  ok(cs2.size === 54, 'size 75 → 54 (AI 고지 실측과 같은 공식)');

  console.log('[2] 색·시각');
  ok(R.assColor('#ffffff') === '&H00FFFFFF' && R.assColor('#ff8000') === '&H000080FF', '#rrggbb → &HAABBGGRR (BGR 순서)');
  ok(R.assColor('rgba(0, 0, 0, 0)') === '&HFF000000', 'rgba 투명 → 알파 FF');
  ok(R.assColor('없음', '&H00FFFFFF') === '&H00FFFFFF', '못 읽으면 폴백');
  ok(R.fmtAss(59.996) === '0:01:00.00', '1/100초 롤오버(59.996 → 1:00.00)');
  ok(R.fmtAss(3661.5) === '1:01:01.50', '시·분·초');

  console.log('[3] 켄번스 — 🔴 zoompan x/y 는 원본 좌표');
  const kb = { from: { scale: 0.926, centerX: 0.5, centerY: 0.5 }, to: { scale: 0.82, centerX: 0.45, centerY: 0.55 } };
  const f = R.kenBurnsFilter(kb, 100);
  ok(/x='\(\(0\.5\+\(0\.45-0\.5\)\*on\/99\)\*1920-1920\/\(2\*/.test(f), 'x = cx*W − W/(2z) (문서식 cx*W*z − W/2 가 아니다)');
  ok(!/\*zoom/.test(f), 'x/y 에 zoom 변수를 곱하지 않는다');
  const f2 = R.kenBurnsFilter(kb, 100, 200, 400);
  ok(f2.includes('(on+200)/399'), '조각이면 진행률 = (on+off)/(전체−1)');
  ok(R.kenBurnsFilter(null, 10).indexOf('zoompan') < 0, '켄번스 없으면 cover 만');

  console.log('[4] 조각 계획 — 누적 반올림');
  const segs = [{ start: 0, end: 6.9, type: 'image' }, { start: 6.9, end: 11.433, type: 'video' }, { start: 11.433, end: 86.7, type: 'image' }];
  const ch = R.planChunks(segs, 20);
  const frames = ch.reduce((s, c) => s + (c.f1 - c.f0), 0);
  ok(frames === Math.round(86.7 * 30), `프레임 합 = round(총길이×30) (${frames})`);
  ok(ch.every((c, i) => i === 0 || c.f0 === ch[i - 1].f1), '조각이 빈틈 없이 이어진다');
  const long = ch.filter((c) => c.kbTotal === Math.round(86.7 * 30) - Math.round(11.433 * 30));
  ok(long.length === 4 && long[0].kbOff === 0 && long[1].kbOff === 600, '긴 이미지 구간은 20초(600프레임) 단위로 나눈다');
  ok(ch.filter((c) => c.type === 'video').length === 1, '영상 구간은 나누지 않는다');

  console.log('[5] 타임라인 — 합성 project');
  const proj = synthProject();
  const tl = R.buildTimeline(proj, null);
  ok(tl.segments.length === 2 && tl.segments[0].type === 'image', '구간 2개(이미지 → 이미지)');
  ok(tl.cues.length === 3 && tl.cues[0].text === '첫 줄 자막', '자막 3줄');
  ok(tl.audio.length === 2, '음성 = 문장 2개(같은 mp3 를 쓰는 clip 은 한 번)');
  const sumA = tl.audio.reduce((s, a) => s + a.dur, 0);
  ok(Math.abs(sumA - tl.totalSec) < 1e-9, '🔑 음성 목표 길이 합 = 영상 길이(드리프트 0 의 근거)');
  ok(tl.overlays.length === 1 && Math.abs(tl.overlays[0].start - 1) < 1e-9, 'AI 고지 = startDelay 1초 뒤 시작');
  ok(Math.abs(tl.overlays[0].end - 2) < 1e-9, 'AI 고지 = 연결된 clip 끝(2초)에서 사라진다');
  ok(tl.overlays[0].x === Math.round(0.02 * 1920 + 23.6) && tl.overlays[0].y === Math.round(0.047 * 1080 + 12.2), 'AI 고지 위치 = 실측 보정(62, 63)');

  console.log('[6] ASS — 오버레이 페이드');
  const ov5 = { ...tl.overlays[0], fadeMs: 500 };
  const a1 = R.buildAss([], [{ ...ov5, fadeFrom: 0.5 }], cs);
  ok(/\\fad\(500,0\)/.test(a1), '조각 안에서 시작 → \\fad');
  const a2 = R.buildAss([], [{ ...ov5, start: 0, fadeFrom: -0.25 }], cs);
  ok(/\\alpha&H80&\\t\(0,250,\\alpha&H00&\)/.test(a2), '앞 조각에서 시작 → 남은 페이드만 \\alpha+\\t');
  ok(/PlayResX: 1920/.test(a1) && /PlayResY: 1080/.test(a1), 'PlayRes = 영상 해상도(3.75배 확대 함정 방지)');
  ok(/\\1c&HFFFFFF&/.test(a1), '\\1c 태그 형식(&HBBGGRR&)');

  console.log('[7] zoompan 좌표 — 실제 ffmpeg 로 확인(문서와 다른 동작의 회귀 방지)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vrt-'));
  try {
    const pat = path.join(tmp, 'pat.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1920x1080', '-vf', 'drawbox=x=860:y=440:w=200:h=200:color=white@1:t=fill', '-frames:v', '1', pat]);
    const kbc = { from: { scale: 0.82, centerX: 0.5, centerY: 0.5 }, to: { scale: 0.82, centerX: 0.5, centerY: 0.5 } };
    const out = path.join(tmp, 'z.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', '30', '-i', pat, '-frames:v', '1', '-vf', R.kenBurnsFilter(kbc, 10), out]);
    const b = rgb(out);
    let x0 = 1e9, x1 = -1;
    for (let x = 0; x < 1920; x++) { const i = (540 * 1920 + x) * 3; if (b[i] > 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; } }
    const cx = (x0 + x1) / 2, w = x1 - x0 + 1;
    ok(Math.abs(cx - 959.5) <= 2, `중심(0.5)이 화면 가운데에 남는다 (x ${cx})`);
    ok(Math.abs(w / 200 - 1 / 0.82) < 0.02, `확대율 = 1/scale (${(w / 200).toFixed(3)} ≈ ${(1 / 0.82).toFixed(3)})`);

    console.log('[8] 실제 왕복 — 합성 .vrew → MP4');
    const vrew = path.join(tmp, 't.vrew');
    makeVrew(vrew, tmp);
    const mp4 = path.join(tmp, 'out', 't.mp4');
    const logs = [];
    const r = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: (m) => logs.push(m), par: 2 });
    ok(r.ok, `성공 (${r.ok ? r.renderSec.toFixed(1) + '초 · ' + r.encoder : r.error})`);
    if (r.ok) {
      const info = probe(mp4);
      ok(/1920x1080/.test(info), '1920x1080');
      ok(/Audio: aac/.test(info), '음성 aac 포함');
      const dur = +(/Duration: (\d+):(\d+):([\d.]+)/.exec(info) || []).slice(1).reduce((s, v, i) => s + (+v) * [3600, 60, 1][i], 0);
      ok(Math.abs(dur - 3) < 0.1, `길이 3초 (${dur.toFixed(2)})`);
      const f05 = path.join(tmp, 'f05.png'), f15 = path.join(tmp, 'f15.png');
      execFileSync(FF, ['-y', '-loglevel', 'error', '-i', mp4, '-ss', '0.5', '-frames:v', '1', f05]);
      execFileSync(FF, ['-y', '-loglevel', 'error', '-i', mp4, '-ss', '1.8', '-frames:v', '1', f15]);
      const c05 = countWhite(rgb(f05), 700, 1080), top05 = countWhite(rgb(f05), 40, 140);
      const top15 = countWhite(rgb(f15), 40, 140);
      ok(c05 > 300, `자막이 아래쪽에 구워졌다 (흰 화소 ${c05})`);
      ok(top05 < 50 && top15 > 300, `AI 고지는 1초 뒤에 위쪽에 나타난다 (0.5초 ${top05} → 1.8초 ${top15})`);
      ok(!fs.readdirSync(path.dirname(mp4)).some((f) => f !== 't.mp4'), '출력 폴더에 중간 파일이 남지 않는다');
      ok(logs.some((m) => /MP4 렌더/.test(m)), '진행 로그');
    }
    const bad = await R.renderVrewToMp4({ vrewPath: path.join(tmp, 'none.vrew'), outPath: mp4 });
    ok(bad.ok === false && /없습니다/.test(bad.error), '없는 .vrew → 던지지 않고 {ok:false}');
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }

  console.log('[9] 배선 원문 대조');
  const main = read('main.js'), app = read('renderer/src/App.jsx'), man = read('scripts/gen-manifest.js');
  ok(/OUT_TARGETS = new Set\(\['vrew', 'whiteboard', 'mp4'\]\)/.test(main), 'main: 출력 대상에 mp4');
  ok(/async function renderUploadMp4\(/.test(main) && /preset\.outUpload/.test(main), 'main: 업로드 폴더 = 채널 outUpload');
  ok(/withAwake\('유튜브 MP4'/.test(main), 'main: 렌더 중 절전 차단');
  ok(/const mp4Go = mp4Here && outMode === 'full'/.test(main), 'main: ⚡ 만들기 4단계 — 「전체」일 때만');
  ok(/const mp4Go = !!args\.mp4 && outMode === 'full'/.test(main), 'main: 💾 export-vrew — mp4 옵션');
  ok(/outUpload: p\.outUpload \|\| defaultDownloadDir\(\)/.test(main), 'main: 채널편집에 기본값(다운로드) 표시');
  ok((app.match(/<option value="mp4">🎬 유튜브 MP4<\/option>/g) || []).length === 2, 'App: 선택지 2곳(헤더 + 채널편집 — v0.3.76 교훈)');
  const codeOnly = app.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  ok(!/=== 'whiteboard' \? 'whiteboard' : 'vrew'/.test(codeOnly), 'App: 옛 정규화(mp4 를 vrew 로 되돌림) 잔존 0');
  ok((app.match(/normOutTargetUi\(/g) || []).length >= 6, 'App: 정규화는 normOutTargetUi 하나로');
  ok(/outUpload: p\.outUpload \|\| ''/.test(app) && /outUpload: \(ch\.outUpload \|\| ''\)\.trim\(\)/.test(app), 'App: outUpload 읽기·저장 둘 다');
  ok(/runVrew\(null, true\)/.test(app) && /mp4 \}\)/.test(app), 'App: 🎬 MP4 굽기 → exportVrew({mp4})');
  ok(/\^assets\\\/fonts\\\/book\\\//.test(man) && !/\^assets\\\/fonts\\\/,/.test(man), '매니페스트: 출판 폰트만 제외(Pretendard 는 배포)');
  ok(fs.existsSync(R.FONT_FILE), 'Pretendard-Bold.ttf 가 앱에 있다');
  const vr = read('core/vrew-render.js');
  ok(!/require\(['"]electron['"]\)/.test(vr), 'core 는 Electron 을 모른다');
  ok(/low: true/.test(vr) && /PRIORITY_BELOW_NORMAL/.test(vr), '화면 조각은 낮은 우선순위(음성이 먼저)');
  ok(!/'-aac_coder'/.test(vr), '음성 코더는 기본값(음질을 깎는 fast 코더 금지)');

  console.log(`\n${fail ? '❌' : '✅'} ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();

// ── 도우미 ──────────────────────────────────────────────────────────────────
function rgb(file) { return execFileSync(FF, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 }); }
function countWhite(b, y0, y1) { let n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < 1920; x += 2) { const i = (y * 1920 + x) * 3; if (b[i] > 245 && b[i + 1] > 245 && b[i + 2] > 245) n++; } return n; }
function probe(file) { try { execFileSync(FF, ['-hide_banner', '-i', file], { stdio: ['ignore', 'pipe', 'pipe'] }); return ''; } catch (e) { return String(e.stderr || ''); } }

/** 이미지 2장 · 문장 2개(clip 3개) · AI 고지 1개 — 3초. */
function synthProject() {
  const tr = {
    I1: { trackId: 'I1', type: 'image', mediaId: 'img1', kenburnsAnimationInfo: { type: 'custom', from: { scale: 0.926, centerX: 0.5, centerY: 0.5 }, to: { scale: 0.82, centerX: 0.5, centerY: 0.5 } } },
    I2: { trackId: 'I2', type: 'image', mediaId: 'img2', kenburnsAnimationInfo: { type: 'custom', from: { scale: 0.862, centerX: 0.55, centerY: 0.5 }, to: { scale: 0.862, centerX: 0.45, centerY: 0.5 } } },
    T1: { trackId: 'T1', type: 'ttsClip', mediaId: 'tts1' }, T2: { trackId: 'T2', type: 'ttsClip', mediaId: 'tts1' }, T3: { trackId: 'T3', type: 'ttsClip', mediaId: 'tts2' },
    WB: { trackId: 'WB', type: 'web', xPos: 0.02, yPos: 0.047, width: 0.6, height: 0,
      deltas: { textarea: { ops: [{ insert: '본 영상은 AI 로 만들었습니다', attributes: { size: '75', color: '#ffffff', 'outline-color': '#000000', 'outline-width': '6' } }, { insert: '\n' }] } },
      assetEffectInfo: { type: 'fade-in', duration: 300, startDelay: 1000 } },
  };
  const assets = { aI1: { trackIds: ['I1'] }, aI2: { trackIds: ['I2'] }, aT1: { trackIds: ['T1'] }, aT2: { trackIds: ['T2'] }, aT3: { trackIds: ['T3'] }, aW: { trackIds: ['WB'] } };
  const cap = (t) => [{ text: [{ insert: t + '\n', attributes: { size: '100', color: '#ffffff', 'outline-color': '#000000', 'outline-width': '6', font: 'Pretendard-Vrew_700' } }],
    style: { yAlign: 'bottom', yOffset: -0.125, width: 0.96, xOffset: 0, customAttributes: [{ attributeName: '--textbox-align', value: 'start' }] } }];
  return {
    files: [{ mediaId: 'img1', name: 'img1.png' }, { mediaId: 'img2', name: 'img2.png' }, { mediaId: 'tts1', name: 'tts1.mp3' }, { mediaId: 'tts2', name: 'tts2.mp3' }],
    props: { tracks: tr, assets },
    transcript: { clips: [
      { assetIds: ['aI1', 'aW'], words: [{ duration: 1.0, assetIds: ['aT1'] }], captions: cap('첫 줄 자막') },
      { assetIds: ['aI1', 'aW'], words: [{ duration: 0.8, assetIds: ['aT2'] }, { duration: 0.2, assetIds: ['aT2'] }], captions: cap('둘째 줄') },
      { assetIds: ['aI2'], words: [{ duration: 1.0, assetIds: ['aT3'] }], captions: cap('셋째 줄') },
    ] },
  };
}
function makeVrew(vrewPath, tmp) {
  const zip = new AdmZip();
  zip.addFile('project.json', Buffer.from(JSON.stringify(synthProject())));
  const gen = (name, args) => { const p = path.join(tmp, name); execFileSync(FF, ['-y', '-loglevel', 'error', ...args, p]); zip.addFile('media/' + name, fs.readFileSync(p)); };
  gen('img1.png', ['-f', 'lavfi', '-i', 'color=c=0x3060a0:s=1344x768', '-frames:v', '1']);
  gen('img2.png', ['-f', 'lavfi', '-i', 'color=c=0x806030:s=1344x768', '-frames:v', '1']);
  // 🔑 실제 길이를 선언 길이와 **다르게** 둔다(2.1초 vs 2.0 · 0.8초 vs 1.0) — 길이 맞춤이 일하는지 본다
  gen('tts1.mp3', ['-f', 'lavfi', '-i', 'sine=f=440:d=2.1', '-ac', '1', '-ar', '24000']);
  gen('tts2.mp3', ['-f', 'lavfi', '-i', 'sine=f=660:d=0.8', '-ac', '1', '-ar', '24000']);
  zip.writeZip(vrewPath);
}
