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

  head('[5] 스타일 — 글자·외곽·여백이 **영상 높이 비례**');
  {
    const a = WS.styleArg(1080), b = WS.styleArg(360);
    ok(/FontSize=56\b/.test(a) && /FontSize=19\b/.test(b), `높이에 비례한다 (1080→56 · 360→19)`);
    ok(/Outline=3\b/.test(a) && /Outline=1\b/.test(b), '외곽선도 비례한다(고정값이면 작은 판에서 글자를 먹는다)');
    ok(/PrimaryColour=&H00202020/.test(a) && /OutlineColour=&H00FFFFFF/.test(a),
      '🔑 종이색(#F5EBD7) 위라 **진한 글자 + 흰 외곽**이다 — 흰 글자는 안 보인다');
    ok(/FontName=Malgun Gothic/.test(a), '한글 폰트를 지정한다');
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
    ok(white > 200, `흰 외곽선이 그려졌다 — ${white}개`);

    // 자막이 없는 구간(0.05초, 첫 자막 전은 아니므로 맨 끝 여백 대신 상단 절반)을 본다 — 글자는 하단에만 있어야 한다.
    const top = path.join(TMP, 'top.rgb');
    ff(['-y', '-ss', '1.0', '-i', vid, '-frames:v', '1', '-vf', 'crop=640:180:0:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', top]);
    const tb = fs.readFileSync(top);
    let topDark = 0;
    for (let i = 0; i < tb.length; i += 3) if (tb[i] < 80 && tb[i + 1] < 80 && tb[i + 2] < 80) topDark++;
    ok(topDark < 50, `자막은 **아래쪽에만** 있다 — 위 절반의 진한 화소 ${topDark}개`);

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
