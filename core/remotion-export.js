'use strict';
/**
 * 리모션(Remotion) 내보내기 — 롱폼 대본으로 만든 음성을 영상 도구가 쓸 수 있는 꼴로 낸다.
 *
 *   <출력폴더>/remotion/<대본명>/
 *     audio/0001.mp3 …   문장별 음성 (무음 트림 + 24kHz 모노 mp3)
 *     voice.mp3          전부 이어 붙인 통합 음성 1개
 *     timeline.json      "몇 번 파일이 어느 문장·장면·시각인가" — 화면과 음성을 잇는 목록
 *     media/             그 대본의 이미지·영상 사본
 *
 * 🔑 **왜 타임라인 JSON 이 필요한가**
 *   롱폼 음성 파일 이름은 순번(`1.wav`)이라 그것만으로는 어느 화면에 붙는지 알 수 없다.
 *   JSON 이 문장·자막 줄·장면·챕터의 **시작/끝 시각**을 함께 주므로 순번 이름 그대로 쓸 수 있다.
 *
 * 🔑 **시각은 추정하지 않고 실측한다.** `ttsDurationSec` 합이 아니라 **트림한 뒤의 실제 샘플 수**를
 *   누적한다. 파일을 이어 붙일 때 생기는 오차가 뒤로 갈수록 쌓이는 것을 막는다.
 *
 * 🔑 **원본을 건드리지 않는다.** `tts-N` 폴더의 음성과 .vrew 는 그대로 두고 사본만 가공한다
 *   (로이 결정 2026-08-26: 무음 트림은 내보낼 때만). 마음에 안 들면 내보내기만 다시 하면 된다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const { trimSilence } = require('./audio-trim');
const { parseWav } = require('./wav-slice');
const { splitCaptionLines, meaningfulLen } = require('./caption-splitter');

let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath && ffmpegPath.includes('app.asar') && !ffmpegPath.includes('app.asar.unpacked')) {
    ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  }
} catch {}

const OUT_RATE = 24000, OUT_CH = 1, OUT_BITRATE = '192k';

// ── WAV 조립 (무손실) ────────────────────────────────────
function wavHeader(dataLen, rate, ch, bits) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataLen, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(ch, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * ch * bits / 8, 28); h.writeUInt16LE(ch * bits / 8, 32);
  h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(dataLen, 40);
  return h;
}

/** 어떤 오디오든 WAV 버퍼로. wav 는 그대로 읽고, 그 밖(mp3 등)은 ffmpeg 로 디코딩한다. */
function toWavBuffer(file) {
  if (/\.wav$/i.test(file)) return fs.readFileSync(file);
  if (!ffmpegPath) throw new Error('ffmpeg 가 없어 ' + path.extname(file) + ' 를 읽을 수 없습니다');
  const tmp = path.join(os.tmpdir(), 'rmx_' + process.pid + '_' + Date.now() + '.wav');
  try {
    const r = spawnSync(ffmpegPath, ['-y', '-i', file, '-ar', String(OUT_RATE), '-ac', String(OUT_CH), tmp],
      { stdio: 'ignore' });
    if (r.status !== 0 || !fs.existsSync(tmp)) throw new Error('디코딩 실패: ' + path.basename(file));
    return fs.readFileSync(tmp);
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}

function encodeMp3(wavPath, mp3Path) {
  if (!ffmpegPath) return false;
  const r = spawnSync(ffmpegPath, ['-y', '-i', wavPath, '-codec:a', 'libmp3lame',
    '-b:a', OUT_BITRATE, '-ar', String(OUT_RATE), '-ac', String(OUT_CH), mp3Path], { stdio: 'ignore' });
  return r.status === 0 && fs.existsSync(mp3Path);
}

function pad4(n) { return String(n).padStart(4, '0'); }

// KST(UTC+9) — ⚠ toISOString() 은 UTC 라 밤에 하루가 밀린다.
function nowKst() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().replace('Z', '+09:00');
}

/**
 * 대본 하나를 리모션용으로 내보낸다.
 *
 * @param {object} project  파싱된 Project (문장에 ttsAudioPath 가 채워져 있어야 한다)
 * @param {string} outDir   내보낼 폴더
 * @param {object} [opts]
 *   opts.trim        {boolean}  앞뒤 무음 제거 (기본 true)
 *   opts.padSec      {number}   트림 여백 (기본 0.04)
 *   opts.gapSec      {number}   문장 사이 여백 (기본 0) — 통합 음성과 타임라인에 함께 반영된다
 *   opts.captionMaxChars {number}  자막 줄 글자수 (기본 7)
 *   opts.copyMedia   {boolean}  이미지·영상 사본 (기본 true)
 *   opts.combined    {boolean}  통합 음성 1개 (기본 true)
 *   opts.title       {string}   대본 이름
 *   opts.onLine, opts.abortSignal
 */
function exportRemotion(project, outDir, opts = {}) {
  const onLine = opts.onLine || (() => {});
  const abort = opts.abortSignal || (() => false);
  const doTrim = opts.trim !== false;
  const padSec = opts.padSec != null ? opts.padSec : 0.04;
  const gapSec = Math.max(0, Number(opts.gapSec) || 0);
  const maxChars = opts.captionMaxChars || 7;
  const audioDir = path.join(outDir, 'audio');

  if (!ffmpegPath) throw new Error('ffmpeg 를 찾을 수 없습니다 — mp3 를 만들 수 없습니다.');
  fs.mkdirSync(audioDir, { recursive: true });

  // ── 문장을 그룹 순서대로 평탄화 ──
  const items = [];
  for (const g of project.groups) {
    for (const s of project.getSentencesOfGroup(g)) items.push({ g, s });
  }
  const missing = items.filter((x) => !x.s.ttsAudioPath || !fs.existsSync(x.s.ttsAudioPath));
  if (missing.length) {
    throw new Error('음성이 없는 문장이 ' + missing.length + '개 있습니다 (컷 '
      + missing.slice(0, 5).map((x) => x.s.num).join(', ')
      + (missing.length > 5 ? ' 외' : '') + '). 먼저 🎤 TTS 를 끝내 주세요.');
  }

  // ── 통합 WAV 를 스트리밍으로 쓴다 (5시간짜리도 메모리에 안 올린다) ──
  const combined = opts.combined !== false;
  const comboWav = path.join(outDir, '_voice.wav');
  let fd = null, dataLen = 0, fmt = null;
  if (combined) { fd = fs.openSync(comboWav, 'w'); fs.writeSync(fd, Buffer.alloc(44)); }
  const gapBuf = () => Buffer.alloc(Math.round(gapSec * OUT_RATE) * (OUT_CH * 2));

  const sentences = [];
  const captions = [];
  let t = 0, trimmedTotal = 0;

  try {
    for (let i = 0; i < items.length; i++) {
      if (abort()) throw new Error('중단되었습니다');
      const { g, s } = items[i];
      let buf = toWavBuffer(s.ttsAudioPath);

      if (doTrim) {
        const r = trimSilence(buf, { padSec });
        if (r.changed) { buf = r.buf; trimmedTotal += r.trimmedSec; }
      }
      const info = parseWav(buf);
      if (!fmt) fmt = { rate: info.sampleRate, ch: info.channels, bits: info.bitsPerSample };
      // ⚠ 포맷이 섞이면 이어 붙일 수 없다. 조용히 깨지느니 멈춘다.
      if (combined && (info.sampleRate !== fmt.rate || info.channels !== fmt.ch || info.bitsPerSample !== fmt.bits)) {
        throw new Error('컷' + s.num + ' 의 음성 규격이 다릅니다 ('
          + info.sampleRate + 'Hz/' + info.channels + 'ch/' + info.bitsPerSample + 'bit). 통합 음성을 만들 수 없습니다.');
      }

      // 🔑 시각은 여기서 **실측 샘플 수**로 누적한다(추정값 합이 아니다).
      const dur = info.dataSize / (info.sampleRate * info.channels * (info.bitsPerSample / 8));
      const file = pad4(i + 1) + '.mp3';

      // 문장별 mp3 — 여백은 넣지 않는다(순수 음성). 여백은 타임라인이 표현한다.
      const tmpWav = path.join(audioDir, '_t.wav');
      fs.writeFileSync(tmpWav, buf);
      if (!encodeMp3(tmpWav, path.join(audioDir, file))) throw new Error('컷' + s.num + ' mp3 인코딩 실패');
      try { fs.unlinkSync(tmpWav); } catch {}

      if (combined) {
        if (i > 0 && gapSec > 0) { const gb = gapBuf(); fs.writeSync(fd, gb); dataLen += gb.length; }
        const body = buf.subarray(info.dataOffset, info.dataOffset + info.dataSize);
        fs.writeSync(fd, body); dataLen += body.length;
      }

      const start = t + (i > 0 ? gapSec : 0);
      const end = start + dur;
      sentences.push({ n: i + 1, file: 'audio/' + file, text: s.text, group: g.num,
                       start: +start.toFixed(3), end: +end.toFixed(3), dur: +dur.toFixed(3) });

      // 자막 줄 — TTS 길이를 글자수 비율로 나눈다(.vrew·SRT 와 같은 규칙).
      const lines = splitCaptionLines(s.text, maxChars);
      const totW = lines.reduce((a, c) => a + Math.max(1, meaningfulLen(c)), 0) || 1;
      let acc = start;
      lines.forEach((c, k) => {
        const cd = dur * (Math.max(1, meaningfulLen(c)) / totW);
        const e = (k === lines.length - 1) ? end : acc + cd;
        captions.push({ line: c, sentence: i + 1, start: +acc.toFixed(3), end: +e.toFixed(3) });
        acc = e;
      });

      t = end;
      if ((i + 1) % 25 === 0 || i === items.length - 1) onLine('   음성 ' + (i + 1) + '/' + items.length);
    }

    if (combined) {
      fs.writeSync(fd, wavHeader(dataLen, fmt.rate, fmt.ch, fmt.bits), 0, 44, 0);
      fs.closeSync(fd); fd = null;
      onLine('   통합 음성 인코딩...');
      if (!encodeMp3(comboWav, path.join(outDir, 'voice.mp3'))) throw new Error('통합 음성 인코딩 실패');
      try { fs.unlinkSync(comboWav); } catch {}
    }
  } catch (e) {
    if (fd != null) { try { fs.closeSync(fd); } catch {} }
    try { fs.unlinkSync(comboWav); } catch {}
    throw e;
  }

  // ── 장면(그룹) · 챕터 ──
  const mediaDir = path.join(outDir, 'media');
  const copyMedia = opts.copyMedia !== false;
  if (copyMedia) fs.mkdirSync(mediaDir, { recursive: true });
  const copyOne = (src, tag) => {
    if (!src || !fs.existsSync(src) || !copyMedia) return null;
    const name = tag + path.extname(src);
    try { fs.copyFileSync(src, path.join(mediaDir, name)); return 'media/' + name; } catch { return null; }
  };

  const scenes = project.groups.map((g) => {
    const own = sentences.filter((x) => x.group === g.num);
    if (!own.length) return null;
    return {
      n: g.num,
      start: own[0].start,
      end: own[own.length - 1].end,
      dur: +(own[own.length - 1].end - own[0].start).toFixed(3),
      title: g.title || null,
      chapter: g.h2Title || null,
      image: copyOne(g.imagePath, 'g' + pad4(g.num)),
      video: copyOne(g.videoPath, 'g' + pad4(g.num) + '_v'),
      sentences: own.map((x) => x.n),
    };
  }).filter(Boolean);

  // 연속으로 같은 H2 를 한 챕터로 묶는다(유튜브 챕터와 같은 규칙).
  const chapters = [];
  for (const sc of scenes) {
    const name = sc.chapter || null;
    const last = chapters[chapters.length - 1];
    if (last && last.title === name) { last.end = sc.end; }
    else chapters.push({ title: name, start: sc.start, end: sc.end });
  }

  const timeline = {
    meta: {
      title: opts.title || project.title || null,
      generatedAt: nowKst(),
      sentenceCount: sentences.length,
      sceneCount: scenes.length,
      durationSec: +t.toFixed(3),
      gapSec, trimmed: doTrim,
      sampleRate: OUT_RATE, channels: OUT_CH,
      note: '시각(초)은 트림 후 실측 샘플 수를 누적한 값이다. 파일 경로는 이 폴더 기준 상대경로.',
    },
    audio: { combined: opts.combined !== false ? 'voice.mp3' : null, dir: 'audio' },
    sentences, captions, scenes, chapters,
  };
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(timeline, null, 2), 'utf8');

  return {
    outDir,
    sentenceCount: sentences.length,
    sceneCount: scenes.length,
    durationSec: t,
    trimmedSec: trimmedTotal,
    timelinePath: path.join(outDir, 'timeline.json'),
  };
}

module.exports = { exportRemotion, toWavBuffer, wavHeader, OUT_RATE, OUT_CH };
