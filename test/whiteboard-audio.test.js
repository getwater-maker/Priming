'use strict';
/**
 * whiteboard-audio.test.js — 화이트보드 MP4 **음성 얹기(5단계)** 를 실제 ffmpeg 로 왕복 검증.
 *
 * 🔑 스텁으로는 "음성이 정말 들어갔는가"를 못 지킨다. 그래서 여기서는
 *   ① 진짜 장면 영상(무음) 2개 ② 진짜 문장 음성(**.wav 와 .mp3 를 섞고 표본율도 다르게**)
 *   을 만들어 attachAudio 를 돌리고, 결과에서 **소리를 다시 재서** 확인한다.
 *
 * 🔑 무엇을 지키나 — 장면별 길이 맞춤(apad/-t)이 실제로 작동하는지:
 *   장면1 음성(2.9초)이 장면1 영상(3.0초)보다 짧으면 **그 0.1초는 무음**이어야 하고,
 *   장면2 음성은 **정확히 3.0초 지점부터** 시작해야 한다. 이게 어긋나면 A/V 싱크가 밀린다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const MU = require('../core/media-utils');
const WA = require('../core/whiteboard-audio');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ❌ ' + m); } };
const head = (t) => console.log('\n' + t);

const FF = MU.getFfmpegPath();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wbaudio-'));
const ff = (args) => execFileSync(FF, args, { stdio: ['ignore', 'pipe', 'pipe'] });
// ffmpeg 는 진단을 stderr 로 낸다 — 성공해도 거기서 읽어야 한다.
const probe = (args) => { const r = spawnSync(FF, args, { encoding: 'utf8' }); return (r.stderr || '') + (r.stdout || ''); };

/** 구간 [ss, ss+t] 의 평균 음량(dB). 무음이면 -91 근처. */
function meanVolume(file, ss, t) {
  const out = probe(['-hide_banner', '-ss', String(ss), '-t', String(t), '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = out.match(/mean_volume:\s*(-?[\d.]+) dB/);
  return m ? parseFloat(m[1]) : null;
}

(async () => {
  if (!FF) { console.log('⚠ ffmpeg 를 찾을 수 없어 건너뜁니다'); return; }

  head('[1] 준비 — 무음 장면 영상 2개 + 형식이 섞인 문장 음성');
  const vid1 = path.join(TMP, 'scene-01.mp4');
  const vid2 = path.join(TMP, 'scene-02.mp4');
  // 무음 영상(화이트보드 렌더러 산출물과 같은 성질: 비디오만 있고 오디오 트랙이 없다)
  ff(['-y', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=30', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', vid1]);
  ff(['-y', '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=30', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', vid2]);

  // 문장 음성 — 🔑 wav/mp3 를 섞고 표본율도 다르게(실제 tts-N 폴더에서 일어나는 일)
  const a1 = path.join(TMP, '1.wav'), a2 = path.join(TMP, '2.wav'), a3 = path.join(TMP, '3.mp3');
  ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000', '-t', '1.5', '-ac', '1', '-c:a', 'pcm_s16le', a1]);
  ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=520:sample_rate=44100', '-t', '1.4', '-ac', '1', '-c:a', 'pcm_s16le', a2]);
  ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=22050', '-t', '2.4', '-ac', '2', '-c:a', 'libmp3lame', a3]);
  ok(fs.existsSync(a1) && fs.existsSync(a2) && fs.existsSync(a3), '문장 음성 3개 생성(wav 24k · wav 44.1k · mp3 22.05k 스테레오)');

  // 무음 영상 이어붙이기 (mergeScenes 가 하는 일)
  const listPath = path.join(TMP, 'list.txt');
  const toLine = (p) => "file '" + p.split(path.sep).join("/") + "'";
  fs.writeFileSync(listPath, [vid1, vid2].map(toLine).join('\n'), 'utf8');
  const merged = path.join(TMP, 'out_whiteboard.mp4');
  ff(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', merged]);
  const silentDur = await MU.getMediaDuration(merged);
  ok(Math.abs(silentDur - 5) < 0.2, '무음 영상 5초 (실제 ' + silentDur + ')');
  ok(!/Audio:/.test(probe(['-hide_banner', '-i', merged])), '얹기 전에는 오디오 트랙이 없다');

  head('[2] attachAudio — 장면마다 길이를 맞춰 얹는다');
  const r = await WA.attachAudio({
    videoPath: merged, tmpDir: TMP, log: () => {},
    scenes: [{ video: vid1, audios: [a1, a2] }, { video: vid2, audios: [a3] }],
  });
  ok(r.ok, '성공 — ' + (r.error || ''));
  const info = probe(['-hide_banner', '-i', merged]);
  ok(/Audio:\s*aac/.test(info), '오디오 트랙(aac)이 생겼다 — ' + ((info.match(/Audio:[^\n]*/) || [''])[0] || '').trim());
  const dur = await MU.getMediaDuration(merged);
  ok(Math.abs(dur - 5) < 0.25, '길이가 그대로 5초 (실제 ' + dur + ') — 음성 때문에 늘어나지 않는다');
  ok(/Video:\s*h264/.test(info), '영상은 재인코딩 없이 그대로(h264 복사)');

  head('[3] 싱크 — 장면1 의 남는 0.1초는 무음, 장면2 는 3.0초에서 시작');
  const vSpeech1 = meanVolume(merged, 0.2, 1.0);      // 장면1 문장 한가운데
  const vPad = meanVolume(merged, 2.93, 0.05);        // 장면1 음성(2.9초) 뒤 남는 자리 = apad
  const vScene2 = meanVolume(merged, 3.1, 0.5);       // 장면2 문장
  const vTail = meanVolume(merged, 4.85, 0.1);        // 장면2 음성은 2.4초라 2.0초로 **잘려야** 한다
  ok(vSpeech1 != null && vSpeech1 > -30, '장면1 에 소리가 있다 (' + vSpeech1 + ' dB)');
  ok(vPad != null && vPad < -50, '🔑 장면1 의 남는 0.1초는 무음 — apad 가 실제로 들어갔다 (' + vPad + ' dB)');
  ok(vScene2 != null && vScene2 > -30, '🔑 장면2 소리가 3.0초 지점부터 들린다 = 드리프트 없음 (' + vScene2 + ' dB)');
  ok(vTail != null && vTail > -30, '장면2 끝까지 소리가 채워져 있다 (' + vTail + ' dB)');

  head('[4] 방어 — 입력이 없거나 잘못되면 던지지 않고 이유를 준다');
  const e1 = await WA.attachAudio({ videoPath: path.join(TMP, '없는파일.mp4'), scenes: [{ video: vid1, audios: [a1] }], tmpDir: TMP });
  ok(!e1.ok && /영상 파일이 없습니다/.test(e1.error), '영상이 없으면 사람 말 오류');
  const e2 = await WA.attachAudio({ videoPath: merged, scenes: [], tmpDir: TMP });
  ok(!e2.ok && /장면이 없습니다/.test(e2.error), '장면이 없으면 사람 말 오류');
  const e3 = await WA.attachAudio({ videoPath: merged, scenes: [{ video: vid1, audios: [path.join(TMP, 'nope.wav')] }], tmpDir: TMP });
  ok(!e3.ok && /🎤 TTS/.test(e3.error), '음성 파일이 없으면 무엇을 하면 되는지 알려 준다');

  head('[5] 많은 문장 — CHUNK(40) 를 넘겨도 순서대로 붙는다');
  {
    const many = [];
    for (let i = 0; i < 45; i++) {
      const f = path.join(TMP, 'm' + i + '.wav');
      ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000', '-t', '0.1', '-ac', '1', '-c:a', 'pcm_s16le', f]);
      many.push(f);
    }
    const out = path.join(TMP, 'many.wav');
    await WA.buildSceneAudio({ inputs: many, durationSec: 4.5, outPath: out, tmpDir: TMP });
    const d = await MU.getMediaDuration(out);
    ok(Math.abs(d - 4.5) < 0.05, '45개(=CHUNK 40 초과)를 붙여 4.5초로 맞춘다 (실제 ' + d + ')');
    const leftover = fs.readdirSync(TMP).filter((f) => f.indexOf('_wa_') === 0);
    ok(leftover.length === 0, '중간 파일이 남지 않는다 — ' + leftover.join(','));
  }

  head('[6] 소스 위생');
  {
    const s = fs.readFileSync(path.join(__dirname, '..', 'core', 'whiteboard-audio.js'), 'utf8');
    ok(/aresample/.test(s), '입력마다 aresample 로 규격을 맞춘다(형식이 섞일 수 있다)');
    ok(/'-c:v', 'copy'/.test(s), 'mux 는 영상을 복사한다(재인코딩 금지)');
    ok(/apad/.test(s) && /'-t'/.test(s), '장면 길이에 맞춰 무음을 덧대거나 자른다');
    ok(s.indexOf(String.fromCharCode(0)) < 0 && !/[\x01-\x08\x0b\x0c\x0e-\x1f]/.test(s), '제어문자 없음');
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log('\nwhiteboard-audio: ' + (n - bad) + '/' + n + ' 통과');
  if (bad) process.exit(1);
})().catch((e) => { console.error('💥', e); process.exit(1); });
