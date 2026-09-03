'use strict';
// node test/stt-format.test.js — 「서버가 읽지 못하는 오디오 포맷을 그대로 올리는 것」 차단 검증.
//   2026-09-03 실사고: m4a 7개를 STT 하니 전부 HTTP 500.
//     {"detail":"ASR 오류: Soundfile is either not in the correct format or is malformed …"}
//   원인: main.js 가 **영상 확장자 블랙리스트**로만 변환을 판정해, 파일 선택 필터에는 들어 있는
//     m4a·aac·ogg·wma 가 변환 없이 업로드됐다. 서버 soundfile(libsndfile)은 wav/flac/mp3 만 읽는다.
//     같은 큐 이력이 이걸 그대로 보여준다 — **m4a 14건 전부 실패 · mp3 7건 전부 성공**.
//   지키려는 것: ① 판정은 화이트리스트 하나(asr.needsAudioConvert)로 ② 그 게이트가 /asr-upload 로
//     나가는 유일한 문(transcribeLong)에 있어 호출부가 늘어도 다시 안 밟는다 ③ mp3·wav 는 헛변환 없음.
//   🔑 로직을 복사하지 않는다 — **원문 모듈·원문 소스**를 그대로 쓴다.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const ASRSRC = fs.readFileSync(path.join(ROOT, 'tts', 'asr-client.js'), 'utf8');
const asr = require(path.join(ROOT, 'tts', 'asr-client'));
const media = require(path.join(ROOT, 'core', 'media-utils'));

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };

// ── [1] 판정 함수 — 원문 그대로 실행 ──
ok(typeof asr.needsAudioConvert === 'function', 'needsAudioConvert 를 export 한다');
for (const p of ['a.mp3', 'a.wav', 'a.flac', 'A.MP3', 'A.WaV', 'C:/x y/이름.mp3']) {
  ok(asr.needsAudioConvert(p) === false, '그대로 올려도 되는 포맷: ' + p);
}
// 🔴 실사고 확장자 + 파일 선택 필터에 있으면서 변환이 안 되던 것들
for (const p of ['a.m4a', 'A.M4A', 'a.aac', 'a.ogg', 'a.wma', 'a.opus', 'a.mp4', 'a.mov', 'a.mkv', 'a.webm', 'a.avi', 'a.m4v', 'a.ts', 'a.wmv']) {
  ok(asr.needsAudioConvert(p) === true, '🔴 변환해야 하는 포맷: ' + p);
}
ok(asr.needsAudioConvert('확장자없음') === true, '확장자가 없으면 변환한다(fail-safe)');
ok(asr.needsAudioConvert('') === true, '빈 경로도 변환 대상으로 본다(안 죽는다)');
ok(asr.needsAudioConvert(null) === true, 'null 에도 안 죽는다');

// ── [2] 화이트리스트를 함부로 넓히지 않았는지 ──
ok(asr.ASR_DIRECT_EXT instanceof Set, 'ASR_DIRECT_EXT 는 Set');
ok(asr.ASR_DIRECT_EXT.size === 3, '서버가 읽는다고 확증된 3종만 (실제 ' + asr.ASR_DIRECT_EXT.size + '종: ' + [...asr.ASR_DIRECT_EXT].join(',') + ')');
ok(!asr.ASR_DIRECT_EXT.has('.m4a'), '🔴 m4a 를 직접 포맷으로 넣지 않았다');

// ── [3] 게이트가 유일한 문(transcribeLong)에 있는지 — 원문 대조 ──
ok(/async function transcribeLong[\s\S]{0,900}needsAudioConvert\(audioPath\)/.test(ASRSRC), 'transcribeLong 진입에서 변환을 판정한다');
ok(/_transcribeLongDirect/.test(ASRSRC), '본체는 _transcribeLongDirect 로 분리(들여쓰기 보존)');
ok(/extractAudioMp3\(audioPath, tmpConv\)/.test(ASRSRC), '변환은 ffmpeg mp3 추출로 한다');
ok(/finally \{ try \{ fs\.rmSync\(tmpConv/.test(ASRSRC), '임시 변환본을 finally 로 정리한다(예외에도 누수 없음)');
{
  // 본체는 이미 보장된 포맷만 받으므로 여기서 또 판정하지 않는다(중복 변환 방지)
  //   ⚠ 파일 끝 module.exports 에도 이름이 나오므로 **함수 본문만** 잘라서 본다.
  const i = ASRSRC.indexOf('async function _transcribeLongDirect');
  ok(i > 0, '_transcribeLongDirect 를 찾았다');
  let d = 0, started = false, j = i;
  for (; j < ASRSRC.length; j++) {
    const c = ASRSRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  const body = ASRSRC.slice(i, j);
  ok(!body.includes('needsAudioConvert'), '본체에서 재판정하지 않는다(이중 변환 없음)');
}

// ── [4] main.js — 옛 블랙리스트 판정이 되살아나지 않았는지 ──
ok(/asr\.needsAudioConvert\(file\)/.test(MAIN), 'STT 핸들러가 asr.needsAudioConvert 로 판정한다');
{
  const i = MAIN.indexOf("ipcMain.handle('stt-transcribe'");
  ok(i > 0, 'STT 핸들러를 찾았다');
  const blk = MAIN.slice(i, i + 3000);
  ok(!/if \(STT_VIDEO_EXT\.has\(ext\)\) \{/.test(blk), '🔴 옛 "영상 확장자면 변환" 판정이 사라졌다');
  ok(/STT_VIDEO_EXT\.has\(ext\)[\s\S]{0,140}동영상에서 오디오 추출/.test(blk), 'STT_VIDEO_EXT 는 로그 문구 구분에만 쓴다');
  ok(/mp3 로 변환 중/.test(blk), '오디오 포맷 변환도 로그로 알린다(조용히 넘어가지 않는다)');
  ok(/extractAudioMp3\(file, tmpAudio\)/.test(blk), '변환은 ffmpeg mp3 추출');
}
// 선택 필터에 있는 확장자가 모두 처리되는지 — 「고를 수는 있는데 늘 실패」 방지
{
  const m = MAIN.match(/name: '음성·영상', extensions: \[([^\]]+)\]/);
  ok(!!m, '파일 선택 필터를 찾았다');
  if (m) {
    const exts = m[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
    const miss = exts.filter((e) => asr.needsAudioConvert('x.' + e) === false && !asr.ASR_DIRECT_EXT.has('.' + e));
    ok(miss.length === 0, '필터의 모든 확장자가 변환 또는 직접 업로드로 처리된다 — 미처리: ' + miss.join(','));
    ok(exts.includes('m4a'), '필터에 m4a 가 있다(실사고 입력)');
  }
}

// ── [5] 소스 위생 ──
for (const pair of [['tts/asr-client.js', ASRSRC], ['main.js', MAIN]]) {
  ok((pair[1].match(/\r\n/g) || []).length === 0, pair[0] + ' 줄끝 LF 유지');
  ok(pair[1].indexOf('\u0000') < 0, pair[0] + ' NUL 바이트 없음');
}

// ── [6] 청크 분할이 **쓸 수 없는 꼬리 조각**을 내보내지 않는지 (별건 버그, 서버 불필요) ──
//   실측: 15초 mp3 를 5초로 자르면 청크가 4개 나오고 마지막 1KB 는 ffprobe 조차 거부한다.
//   그걸 STT 서버에 올리면 HTTP 500 → 앞 청크가 다 성공했어도 전사 전체가 실패했다.
const MEDIASRC = fs.readFileSync(path.join(ROOT, 'core', 'media-utils.js'), 'utf8');
ok(/MIN_SEGMENT_SEC/.test(MEDIASRC), 'segmentAudio 에 꼬리 조각 판정선이 있다');
ok((MEDIASRC.match(/\r\n/g) || []).length === 0, 'core/media-utils.js 줄끝 LF 유지');
const segTail = (async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sttseg-'));
  try {
    const ff = media.getFfmpegPath();
    const src = path.join(tmp, 'src.mp3');
    execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=15', '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', src], { stdio: 'ignore' });
    const chunks = await media.segmentAudio(src, path.join(tmp, 'seg'), 5);
    ok(chunks.length === 3, '🔴 15초를 5초로 자르면 3개 — 꼬리 조각이 걸러진다 (실제 ' + chunks.length + ')');
    let allReadable = true;
    for (const c of chunks) {
      const d = await media.getMediaDuration(c);
      if (!(d >= 0.3)) allReadable = false;
    }
    ok(allReadable, '남은 청크는 전부 읽을 수 있다(길이 측정 가능)');
    // 정상 마지막 조각(짧지만 내용 있는 것)은 버리지 않는다
    const src2 = path.join(tmp, 'src2.mp3');
    execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=12', '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', src2], { stdio: 'ignore' });
    const c2 = await media.segmentAudio(src2, path.join(tmp, 'seg2'), 5);
    ok(c2.length === 3, '12초/5초 = 3개 — 2초 남는 마지막 조각은 살린다 (실제 ' + c2.length + ')');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();

// ── [7] 실제 왕복 — 합성 m4a 를 실제 OmniVoice 로 전사 (서버 없으면 건너뜀) ──
(async () => {
  await segTail;
  let reachable = false;
  try { const st = await asr.checkAsrStatus(); reachable = !!st.reachable; } catch (_) {}
  if (!reachable) {
    console.log('  ⏭ [7] 실제 왕복 건너뜀 — OmniVoice 서버에 닿지 않음');
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sttfmt-'));
    try {
      const ff = media.getFfmpegPath();
      // 🔴 **길이가 중요하다** — 3초짜리 m4a 는 서버가 우연히 받아 준다(실측). 그걸 fixture 로
      //   쓰면 게이트를 무력화해도 테스트가 통과해 아무것도 못 지킨다(A/B 로 실제로 겪었다).
      //   실측 임계: 3초 성공 / **10·20·25·29·31·35초 전부 HTTP 500** → 임계 위 길이를 쓴다.
      const m4a = path.join(tmp, 'probe.m4a');
      execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=12', '-ac', '2', '-ar', '44100', '-c:a', 'aac', m4a], { stdio: 'ignore' });
      ok(fs.existsSync(m4a) && fs.statSync(m4a).size > 50000, '검증용 m4a 생성(임계 위 길이)');

      // 🔴 이게 이번 사고의 핵심 — 예전엔 여기서 HTTP 500 이 났다
      let err = null;
      try { await asr.transcribeLong(m4a, { timeoutMsPerChunk: 120000 }); } catch (e) { err = e; }
      ok(!err, '🔴 m4a 를 전사해도 오류가 없다' + (err ? ' — ' + String(err.message).split('\n')[0] : ''));
      if (err) ok(!/HTTP 500/.test(String(err.message)), '🔴 Soundfile 500 이 나지 않는다');

      // 청크 분할 경로도 확인(실사고 로그에 "전사 0/2 청크" 가 있었다)
      const long = path.join(tmp, 'long.m4a');
      execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=15', '-ac', '2', '-ar', '44100', '-c:a', 'aac', long], { stdio: 'ignore' });
      let err2 = null, seen = 0;
      try {
        await asr.transcribeLong(long, { chunkSec: 5, timeoutMsPerChunk: 120000, onProgress: (p) => { if (p && p.total > 1) seen = p.total; } });
      } catch (e) { err2 = e; }
      ok(!err2, '청크 분할 경로도 오류 없음' + (err2 ? ' — ' + String(err2.message).split('\n')[0] : ''));
      ok(seen >= 2, '실제로 여러 청크로 나뉘어 전사됐다 (청크 ' + seen + ')');

      // mp3 는 헛변환하지 않는다 — 임시 변환본이 생기지 않아야
      const mp3 = path.join(tmp, 'plain.mp3');
      execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=12', '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', mp3], { stdio: 'ignore' });
      const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('pf-asr-')).length;
      let err3 = null;
      try { await asr.transcribeLong(mp3, { timeoutMsPerChunk: 120000 }); } catch (e) { err3 = e; }
      const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('pf-asr-')).length;
      ok(!err3, 'mp3 회귀 — 그대로 전사된다' + (err3 ? ' — ' + String(err3.message).split('\n')[0] : ''));
      ok(after <= before, 'mp3 는 변환 임시파일을 만들지 않는다(헛변환 없음)');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  console.log('\nstt-format: ' + (n - bad) + '/' + n + ' 통과');
  if (bad) process.exit(1);
})();
