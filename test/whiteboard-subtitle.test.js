'use strict';
/**
 * whiteboard-subtitle.test.js — 화이트보드 MP4 의 **자막**(5단계 나머지 절반, 2026-09-16).
 *
 * 🔑 무엇을 지키나:
 *   ① 시각의 기준이 **장면 영상의 실측 길이**인가 — 명목(TTS 합)으로 쌓으면 장면마다 몇 ms 씩
 *      어긋나 50장면에서 누적된다(음성은 실측에 맞춰 얹히므로 자막만 밀리면 소리와 글자가 갈린다).
 *   ② 자막 줄 나누기가 **core/caption-splitter 와 같은가** — 화이트보드만 다른 데서 끊기면 안 된다.
 *   ③ **실제 ffmpeg 로 구워** 한글이 정말 그려지는지(두부 □□ 가 아닌지) 화소를 세어 확인한다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const MU = require('../core/media-utils');
const WS = require('../core/whiteboard-subtitle');
const { splitCaptionLines, fmtSrtTime } = require('../core/caption-splitter');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ❌ ' + m); } };
const head = (t) => console.log('\n' + t);

const FF = MU.getFfmpegPath();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wbsub-'));
const ff = (args) => execFileSync(FF, args, { stdio: ['ignore', 'pipe', 'pipe'] });
const probe = (args) => { const r = spawnSync(FF, args, { encoding: 'utf8' }); return (r.stderr || '') + (r.stdout || ''); };
/** 영상 1.0초 프레임의 **진한 화소 분포** — 자막이 어디에 얼마나 크게 그려졌는지 픽셀로 잰다.
 *  🔑 「자막이 들어갔나」가 아니라 **「어디에 얼마나 크게」**를 재야 이번 사고(3.75배 확대)를 잡는다. */
function measure(video, W, H) {
  const raw = path.join(TMP, '_m.gray');
  ff(['-y', '-ss', '1.0', '-i', video, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', raw]);
  const b = fs.readFileSync(raw);
  const ys = [];
  for (let y = 0; y < H; y++) {
    let cnt = 0;
    for (let x = 0; x < W; x++) if (b[y * W + x] < 100) cnt++;
    if (cnt) ys.push(y);
  }
  try { fs.rmSync(raw, { force: true }); } catch (_) {}
  if (!ys.length) return { rows: 0, top: -1, bot: -1, h: 0, bottom: -1 };
  const top = ys[0], bot = ys[ys.length - 1];
  return { rows: ys.length, top, bot, h: bot - top + 1, bottom: H - 1 - bot };
}

/** SRT 한 덩어리 → [{start, end, text}] */
const parseSrt = (s) => s.trim().split(/\n\n+/).map((b) => {
  const L = b.split('\n');
  const m = (L[1] || '').split(' --> ');
  return { start: m[0], end: m[1], text: L.slice(2).join('\n') };
});

(async () => {
  head('[1] buildSrt — 장면 시작은 **실측 길이** 누적');
  {
    const scenes = [
      { sentences: [{ text: '복리의 힘은 시간이 만듭니다.', dur: 1.4 }, { text: '작게 시작해도 됩니다.', dur: 1.5 }] },  // 명목 2.9
      { sentences: [{ text: '오늘 한 걸음이 내일을 바꿉니다.', dur: 2.4 }] },                                           // 명목 2.4
    ];
    // 실측은 3.0 / 2.0 — 명목(2.9)과 다르다. 장면2 자막은 **3.000** 에서 시작해야 한다.
    const srt = WS.buildSrt(scenes, { maxChars: 7, sceneDurations: [3.0, 2.0] });
    const cues = parseSrt(srt);
    ok(cues.length >= 4, `자막 조각이 생긴다 (${cues.length}개)`);
    ok(cues[0].start === '00:00:00,000', `첫 자막은 0초에서 시작 (${cues[0].start})`);
    const sceneTwo = cues.find((c) => c.text.indexOf('오늘') === 0 || c.text.indexOf('오늘') > -1);
    ok(sceneTwo && sceneTwo.start === '00:00:03,000',
      `🔑 장면2 는 **실측 3.0초**에서 시작 — 명목 2.9 가 아니다 (${sceneTwo && sceneTwo.start})`);
    // A/B — 실측을 안 주면 명목으로 쌓여 2.9 에서 시작한다(=드리프트). 이 차이가 이 옵션의 존재 이유다.
    const naive = parseSrt(WS.buildSrt(scenes, { maxChars: 7 }));
    const naiveTwo = naive.find((c) => c.text.indexOf('오늘') > -1);
    ok(naiveTwo && naiveTwo.start === '00:00:02,900', `실측을 안 주면 명목으로 쌓인다 (${naiveTwo && naiveTwo.start})`);
    ok(sceneTwo.start !== naiveTwo.start, 'A/B — 두 값이 실제로 다르다(헛단언이 아님)');
  }

  head('[2] 자막 줄 나누기는 core/caption-splitter 와 같다');
  {
    const text = '관계를 깨는 것은 거절이 아니라 지나친 다정입니다.';
    const srt = WS.buildSrt([{ sentences: [{ text, dur: 4 }] }], { maxChars: 7 });
    const got = parseSrt(srt).map((c) => c.text);
    const want = splitCaptionLines(text, 7);
    ok(JSON.stringify(got) === JSON.stringify(want), `같은 규칙으로 끊는다 (${got.length}줄 vs ${want.length}줄)`);
    const wide = parseSrt(WS.buildSrt([{ sentences: [{ text, dur: 4 }] }], { maxChars: 20 })).map((c) => c.text);
    ok(JSON.stringify(wide) === JSON.stringify(splitCaptionLines(text, 20)), '글자수 설정이 그대로 먹는다');
    ok(wide.length < got.length, '글자수를 넓히면 줄이 줄어든다');
  }

  head('[3] 빈 것·이상한 것에 안 죽는다');
  {
    ok(WS.buildSrt([], {}) === '', '장면이 없으면 빈 문자열');
    ok(WS.buildSrt([{ sentences: [] }], {}) === '', '문장이 없으면 빈 문자열');
    ok(WS.buildSrt([{ sentences: [{ text: '  ', dur: 2 }] }], {}) === '', '공백 문장은 건너뛴다');
    ok(WS.buildSrt([{ sentences: [{ text: '길이가 0', dur: 0 }] }], {}) === '', '길이 0 인 문장은 건너뛴다');
    ok(WS.buildSrt(null, {}) === '', 'null 도 빈 문자열');
    // 🔑 ms 반올림 — 옛 pipeline._fmtSrt 는 59.9996 을 `00:00:59,1000` 으로 냈다(자막 파서가 거부한다).
    ok(fmtSrtTime(59.9996) === '00:01:00,000', `ms 가 1000 이 되면 초로 올린다 (${fmtSrtTime(59.9996)})`);
  }

  head('[4] scenesForSubtitle — 지금의 문장 텍스트·TTS 길이를 읽는다');
  {
    const project = {
      groups: [{ num: 1 }, { num: 2 }],
      getSentencesOfGroup: (g) => (g.num === 1
        ? [{ num: 1, text: '첫 문장입니다.', ttsDurationSec: 2 }, { num: 2, text: '둘째 문장입니다.', ttsDurationSec: 3 }]
        : [{ num: 3, text: '셋째 문장입니다.', ttsDurationSec: 4 }]),
    };
    const got = WS.scenesForSubtitle(project, [{ sentenceNums: [1, 2] }, { sentenceNums: [3] }]);
    ok(got.length === 2 && got[0].sentences.length === 2, '장면별 문장 묶음');
    ok(got[0].sentences[1].text === '둘째 문장입니다.' && got[0].sentences[1].dur === 3, '텍스트·길이를 그대로 읽는다');
    const miss = WS.scenesForSubtitle(project, [{ sentenceNums: [1, 99] }]);
    ok(miss[0].sentences.length === 1, '없는 문장 번호는 조용히 빠진다');
  }

  head('[5] buildAss — **PlayRes 를 영상 해상도로 박는다**(이 사고의 핵심)');
  {
    const cues = [{ start: 0, end: 2, text: '같은 기간에 그' }, { start: 2, end: 4, text: '사람이 한 일이라고는' }];
    const a = WS.buildAss(cues, { width: 1920, height: 1080 });
    ok(/PlayResX: 1920/.test(a) && /PlayResY: 1080/.test(a),
      '🔑 PlayResX/Y 가 영상 크기다 — SRT 를 그냥 필터에 물리면 384x288 로 읽혀 글자가 3.75배로 커진다(2026-09-16 실사고)');
    const sty = (t) => t.split('\n').find((l) => l.indexOf('Style: P,') === 0).split(',');
    const style = sty(a);
    ok(style[2] === '56', `FontSize 가 픽셀 그대로다 — 1080 x 5.2% = 56 (${style[2]})`);
    ok(style[21] === '81', `MarginV 도 픽셀 그대로다 — 1080 x 7.5% = 81 (${style[21]})`);
    ok(style[18] === '2', `기본 위치는 아래 가운데(Alignment 2) (${style[18]})`);
    ok(style[3] === '&H00202020' && style[5] === '&H00FFFFFF', '종이색 위라 진한 글자 + 흰 외곽');
    ok(style[7] === '-1', 'ASS 에서 굵게는 -1 이다(1 이 아니다)');
    ok((a.match(/^Dialogue:/gm) || []).length === 2, '큐 수만큼 Dialogue 줄');
    ok(a.indexOf('Dialogue: 0,0:00:00.00,0:00:02.00,P,,0,0,0,,같은 기간에 그') > -1, '시각·본문이 그대로 들어간다');

    const hs = sty(WS.buildAss(cues, { width: 640, height: 360 }));
    ok(hs[2] === '19' && hs[21] === '27', `작은 판에서도 같은 비율 (${hs[2]}px · 여백 ${hs[21]})`);
    ok(Number(hs[16]) >= 1 && Number(hs[17]) === 0, `외곽선은 비례하고(${hs[16]}px) 그림자는 없다(${hs[17]})`);

    ok(sty(WS.buildAss(cues, { width: 1920, height: 1080, style: { pos: 'middle' } }))[18] === '5', "위치 '가운데' → Alignment 5");
    ok(sty(WS.buildAss(cues, { width: 1920, height: 1080, style: { pos: 'top' } }))[18] === '8', "위치 '위' → Alignment 8");
    const big = sty(WS.buildAss(cues, { width: 1920, height: 1080, style: { sizePct: 8, marginPct: 12, font: 'NanumGothic', bold: false } }));
    ok(big[1] === 'NanumGothic' && big[2] === '86' && big[21] === '130' && big[7] === '0',
      `사용자 설정(폰트·크기·여백·굵기)이 그대로 먹는다 (${big[1]} ${big[2]}px 여백${big[21]} 굵기${big[7]})`);
    ok(WS.buildAss([{ start: 0, end: 0, text: '길이 0' }], {}).indexOf('Dialogue:') < 0, '길이 0 인 큐는 안 넣는다');
  }

  head('[5-b] normSubStyle — 이상한 값은 기본값으로(자막이 깨지지 않게)');
  {
    const d = WS.normSubStyle(null);
    ok(d.font === 'Malgun Gothic' && d.sizePct === 5.2 && d.pos === 'bottom' && d.marginPct === 7.5 && d.bold === true, '기본값');
    ok(WS.normSubStyle({ sizePct: 999 }).sizePct === 5.2, '범위 밖 크기는 기본값');
    ok(WS.normSubStyle({ sizePct: 0 }).sizePct === 5.2, '0 도 기본값(글자가 사라진다)');
    ok(WS.normSubStyle({ marginPct: 0 }).marginPct === 0, '여백 0 은 허용(화면 끝에 붙이기)');
    ok(WS.normSubStyle({ pos: '중앙' }).pos === 'bottom', '모르는 위치는 기본값');
    ok(WS.normSubStyle({ pos: 'middle' }).pos === 'middle', '아는 위치는 그대로');
    ok(WS.normSubStyle({ font: '  ' }).font === 'Malgun Gothic', '빈 폰트는 기본값');
    ok(WS.normSubStyle({ bold: false }).bold === false, '굵기 끄기');
    ok(WS.normSubStyle({ sizePct: '7.5' }).sizePct === 7.5, '문자열 숫자도 받는다(입력칸 값)');
  }

  head('[5-c] 이스케이프·시각 변환·SRT 왕복');
  {
    ok(WS.fmtAssTime(0) === '0:00:00.00' && WS.fmtAssTime(3661.239) === '1:01:01.24', `H:MM:SS.cc (${WS.fmtAssTime(3661.239)})`);
    ok(WS.assText('여는 {괄호} 있음').indexOf('\\{') > -1, '중괄호는 이스케이프한다(태그로 먹히면 글자가 사라진다)');
    ok(WS.assText('두\n줄') === '두\\N줄', '개행은 \\N 으로');
    const round = WS.cuesFromSrt(WS.srtFromCues([{ start: 1.5, end: 2.25, text: '왕복' }]));
    ok(round.length === 1 && round[0].text === '왕복' && Math.abs(round[0].start - 1.5) < 0.002, 'SRT → 큐 왕복');
    ok(WS.cuesFromSrt('쓰레기').length === 0, '이상한 SRT 는 빈 배열(안 죽는다)');
    ok(WS.srtFromCues(WS.buildCues([{ sentences: [{ text: '한 문장.', dur: 2 }] }], { maxChars: 7 })) === WS.buildSrt([{ sentences: [{ text: '한 문장.', dur: 2 }] }], { maxChars: 7 }),
      'buildSrt 와 srtFromCues 가 같은 결과 — 파일과 화면 자막이 갈리지 않는다');
  }

  if (!FF) { console.log('⚠ ffmpeg 를 찾을 수 없어 굽기 검증을 건너뜁니다'); }
  else {
    head('[6] burnSubtitle — 실제로 구워 **한글이 그려지는지** 화소로 확인');
    const vid = path.join(TMP, 'v.mp4');
    // 화이트보드 종이색 배경 + 무음 오디오(오디오가 copy 로 살아남는지 함께 본다)
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=0xF5EBD7:s=640x360:r=30', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
      '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vid]);
    const srt = WS.buildSrt([{ sentences: [{ text: '복리의 힘은 시간이 만듭니다.', dur: 1.5 }, { text: '작게 시작해도 됩니다.', dur: 1.5 }] }], { maxChars: 7 });
    const before = await MU.getMediaDuration(vid);
    const r = await WS.burnSubtitle({ videoPath: vid, srtText: srt, tmpDir: TMP, height: 360, log: () => {} });
    ok(r.ok, '구웠다 — ' + (r.error || ''));
    const info = probe(['-hide_banner', '-i', vid]);
    ok(/Video:\s*h264/.test(info), '영상은 h264 로 다시 인코딩된다');
    ok(/Audio:\s*aac/.test(info), '🔑 오디오는 **그대로 복사**된다(음성이 살아 있어야 한다)');
    const after = await MU.getMediaDuration(vid);
    ok(Math.abs(after - before) < 0.25, `길이가 그대로다 (${before} → ${after})`);

    // 1.0초 지점 프레임 — 종이색이 아닌 화소가 곧 글자다.
    const png = path.join(TMP, 'f.png'), raw = path.join(TMP, 'f.rgb');
    ff(['-y', '-ss', '1.0', '-i', vid, '-frames:v', '1', png]);
    ff(['-y', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
    const b = fs.readFileSync(raw);
    let dark = 0, white = 0;
    for (let i = 0; i < b.length; i += 3) {
      if (b[i] < 80 && b[i + 1] < 80 && b[i + 2] < 80) dark++;
      if (b[i] > 240 && b[i + 1] > 240 && b[i + 2] > 240) white++;
    }
    ok(dark > 200, `🔑 한글이 실제로 그려졌다 — 진한 화소 ${dark}개 (두부·미표시면 0 에 가깝다)`);
    ok(white > 60, `흰 외곽선이 그려졌다 — ${white}개 (640 시험본은 글자가 19px 라 개수가 적다)`);

    // 자막이 없는 구간(0.05초, 첫 자막 전은 아니므로 맨 끝 여백 대신 상단 절반)을 본다 — 글자는 하단에만 있어야 한다.
    const top = path.join(TMP, 'top.rgb');
    ff(['-y', '-ss', '1.0', '-i', vid, '-frames:v', '1', '-vf', 'crop=640:180:0:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', top]);
    const tb = fs.readFileSync(top);
    let topDark = 0;
    for (let i = 0; i < tb.length; i += 3) if (tb[i] < 80 && tb[i + 1] < 80 && tb[i + 2] < 80) topDark++;
    ok(topDark < 50, `자막은 **아래쪽에만** 있다 — 위 절반의 진한 화소 ${topDark}개`);

    head('[6-b] 🔴 1080 에서도 **작고 아래에** 있는가 — 이 사고의 회귀');
    // ⚠ 640(=288 의 1.25배)만 재면 이 버그를 못 잡는다. 실사고는 1080(3.75배)·1920(6.67배)에서 터졌다.
    const big = path.join(TMP, 'big.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=0xF5EBD7:s=1920x1080:r=30', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', big]);
    const cues2 = [{ start: 0, end: 2, text: '같은 기간에 그 사람이 한 일이라고는' }];
    const rb = await WS.burnSubtitle({ videoPath: big, cues: cues2, tmpDir: TMP, width: 1920, height: 1080, log: () => {} });
    ok(rb.ok, '1080 도 구웠다 — ' + (rb.error || ''));
    const mm = measure(big, 1920, 1080);
    ok(mm.rows > 0, `글자가 그려졌다 (진한 행 ${mm.rows})`);
    ok(mm.bottom >= 55 && mm.bottom <= 140, `🔑 하단 여백이 요청값(81px) 근처다 — ${mm.bottom}px (옛 SRT 방식은 328px 였다)`);
    ok(mm.h <= 90, `🔑 글자 블록 높이가 한 줄 크기다 — ${mm.h}px (옛 SRT 방식은 359px = 두 줄로 접힌 거대 자막)`);
    ok(mm.top > 700, `자막이 화면 **아래쪽**에 있다 — 첫 진한 행 y=${mm.top} (옛 방식은 393 = 한복판)`);

    // 위치 설정이 실제 화면에서도 먹는지 — '가운데'로 구우면 글자가 화면 중앙에 온다.
    const midv = path.join(TMP, 'mid.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=0xF5EBD7:s=1920x1080:r=30', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', midv]);
    await WS.burnSubtitle({ videoPath: midv, cues: cues2, tmpDir: TMP, width: 1920, height: 1080, style: { pos: 'middle' }, log: () => {} });
    const mc = measure(midv, 1920, 1080);
    ok(mc.top > 450 && mc.bottom > 450, `위치 '가운데' 가 실제로 화면 중앙에 그린다 — y=${mc.top}, 하단여백 ${mc.bottom}`);

    // A/B — 옛 방식(SRT + force_style)을 **같은 조건**으로 구워 실제로 몇 배 컸음을 확인한다(헛단언 방지).
    const oldv = path.join(TMP, 'old.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=0xF5EBD7:s=1920x1080:r=30', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', oldv]);
    fs.writeFileSync(path.join(TMP, '_ab.srt'), WS.srtFromCues(cues2), 'utf8');
    execFileSync(FF, ['-y', '-i', oldv, '-vf', "subtitles=_ab.srt:force_style='FontName=Malgun Gothic,FontSize=56,MarginV=81,Outline=3'",
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(TMP, 'old2.mp4')], { cwd: TMP, stdio: ['ignore', 'pipe', 'pipe'] });
    const mo = measure(path.join(TMP, 'old2.mp4'), 1920, 1080);
    ok(mo.h > mm.h * 2 && mo.bottom > mm.bottom * 2,
      `A/B — 옛 SRT 방식은 글자 ${mo.h}px · 하단 ${mo.bottom}px 로 실제로 몇 배 크다(새 방식 ${mm.h}px · ${mm.bottom}px)`);

    head('[7] 방어 — 던지지 않고 이유를 준다');
    const e1 = await WS.burnSubtitle({ videoPath: path.join(TMP, '없다.mp4'), srtText: srt, tmpDir: TMP });
    ok(!e1.ok && /영상 파일이 없습니다/.test(e1.error), '영상이 없으면 사람 말 오류');
    const e2 = await WS.burnSubtitle({ videoPath: vid, srtText: '   ', tmpDir: TMP });
    ok(!e2.ok && /자막 내용이 없습니다/.test(e2.error), '자막이 비면 사람 말 오류');
    const leftover = fs.readdirSync(TMP).filter((f) => f.indexOf('_wb_') === 0);
    ok(leftover.length === 0, '중간 파일이 남지 않는다 — ' + leftover.join(','));
  }

  head('[8] 배선 — 파이프라인·설정·main 이 실제로 쓰는가');
  {
    const P = fs.readFileSync(path.join(__dirname, '..', 'core', 'whiteboard-pipeline.js'), 'utf8');
    ok(/WS: \(\) => require\('\.\/whiteboard-subtitle'\)/.test(P), 'pipeline 이 자막 모듈을 deps 로 갖는다');
    ok(/_whiteboard\.srt/.test(P), '.srt 파일을 outRoot 에 남긴다');
    ok(/opts\.burnSubtitle !== false/.test(P), '굽기는 스위치로 끌 수 있다(끄면 .srt 만)');
    ok(/opts\.withSubtitle !== false/.test(P), '자막 자체도 끌 수 있다');
    ok(/sceneDurations: \(audio && audio\.durations\)/.test(P), '🔑 음성이 잰 **실측 길이**를 자막이 그대로 쓴다');
    const A = fs.readFileSync(path.join(__dirname, '..', 'core', 'whiteboard-audio.js'), 'utf8');
    ok(/durations\.push\(dur\)/.test(A) && /durationSec: outDur, durations/.test(A), 'attachAudio 가 실측 길이를 돌려준다');
    const C = fs.readFileSync(path.join(__dirname, '..', 'core', 'whiteboard-config.js'), 'utf8');
    ok(/subtitle: true/.test(C), '설정 기본값은 켬');
    ok(/typeof j\.subtitle === 'boolean'/.test(C), '옛 설정 파일(값 없음)은 켠 것으로 본다');
    const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    ok(/burnSubtitle: cfg\.subtitle !== false/.test(M), 'main 이 설정을 파이프라인으로 넘긴다');
    ok(/captionMaxChars, burnSubtitle/.test(M), '자막 글자수도 함께 넘긴다(.vrew 와 같은 값)');
    const S = fs.readFileSync(path.join(__dirname, '..', 'core', 'whiteboard-subtitle.js'), 'utf8');
    ok(!/subtitles=.*[A-Za-z]:/.test(S), '🔑 필터 문자열에 드라이브 경로를 넣지 않는다(cwd + ASCII 파일명)');
    ok(/cwd: tmpDir/.test(S), 'cwd 를 임시 폴더로 둔다 — 한글 경로·콜론 회피');
    ok(S.indexOf(String.fromCharCode(0)) < 0 && !/[\x01-\x08\x0b\x0c\x0e-\x1f]/.test(S), '제어문자 없음');
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log('\nwhiteboard-subtitle: ' + (n - bad) + '/' + n + ' 통과');
  if (bad) process.exit(1);
})().catch((e) => { console.error('💥', e); process.exit(1); });
