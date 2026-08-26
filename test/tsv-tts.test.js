'use strict';
/**
 * TSV 일괄 TTS + 무음 트림 검증.
 *   node test/tsv-tts.test.js   (또는 npm run test:tsv)
 *
 * 🔑 **원문 모듈을 그대로 require 해서 돌린다.** 로직을 복사해 두면 앱과 갈라져도 통과해
 *   아무것도 못 지킨다(이 저장소가 여러 번 밟은 함정).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const T = require('../core/tsv-tts');
const TRIM = require('../core/audio-trim');
const { parseWav } = require('../core/wav-slice');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function section(s) { console.log('\n' + s); }

// ── 합성 WAV 만들기 (24000Hz/1ch/16bit — 실제 OmniVoice 출력과 같은 규격) ──
function makeWav(spec) {
  const rate = 24000, ch = 1, bits = 16;
  const frames = Math.round(spec.durationSec * rate);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const tt = i / rate;
    const loud = tt >= spec.speechStart && tt < spec.speechEnd;
    const v = loud ? Math.round(Math.sin(tt * 2 * Math.PI * 220) * 12000) : 0;
    data.writeInt16LE(v, i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(ch, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * ch * bits / 8, 28); head.writeUInt16LE(ch * bits / 8, 32);
  head.writeUInt16LE(bits, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

// ══════════════════════════════════════════════════════════
section('[1] TSV 파싱');

t('정상 두 줄', () => {
  const r = T.parseTsv('A.mp3\t안녕하세요.\nB.mp3\t반갑습니다.');
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.rows[0].name, 'A.mp3');
  assert.strictEqual(r.rows[0].text, '안녕하세요.');
});

t('빈 줄과 # 주석은 건너뛴다', () => {
  const r = T.parseTsv('# 설명\n\nA.mp3\t문장\n\n');
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.errors.length, 0);
});

t('CRLF 도 읽는다', () => {
  const r = T.parseTsv('A.mp3\t가나다\r\nB.mp3\t라마바\r\n');
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.rows[1].text, '라마바');
});

t('탭이 없으면 오류', () => {
  const r = T.parseTsv('A.mp3 문장입니다');
  assert.strictEqual(r.rows.length, 0);
  assert.ok(/탭/.test(r.errors[0].message));
});

t('🔴 파일명 중복은 오류다 — 조용히 덮어쓰면 그 문장이 영상에서 사라진다', () => {
  const r = T.parseTsv('A.mp3\t첫째\nA.mp3\t둘째');
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.errors.length, 1);
  assert.ok(/중복/.test(r.errors[0].message));
});

t('경로 구분자·상위경로는 막는다', () => {
  for (const bad of ['a/b.mp3', 'a\\b.mp3', '../x.mp3', '..']) {
    const r = T.parseTsv(bad + '\t문장');
    assert.strictEqual(r.rows.length, 0, bad + ' 가 통과했다');
    assert.strictEqual(r.errors.length, 1, bad);
  }
});

t('빈 파일명·빈 문장은 오류', () => {
  assert.strictEqual(T.parseTsv('\t문장').errors.length, 1);
  assert.strictEqual(T.parseTsv('A.mp3\t').errors.length, 1);
});

t('행 번호가 실제 줄 번호와 맞는다', () => {
  const r = T.parseTsv('# 주석\n\nA.mp3\t문장');
  assert.strictEqual(r.rows[0].line, 3);
});

// ══════════════════════════════════════════════════════════
section('[2] 발음사전 파싱 — 표를 가려 읽는다');

const DICT_MD = [
  '## 1. 숫자',
  '| 단위 | 원본 빈도 | 아라비아 표기 | 대본 표기 |',
  '|---|---|---|---|',
  '| 만 | 967 | 50만 | 오십만 |',
  '',
  '## 2. 확정',
  '| 항목 | 확정 시점 |',
  '|---|---|',
  '| **배속** | 시험에서 확정 |',
  '',
  '## 3. 화면',
  '| 화면 표기 | **대본 표기 / 읽기** |',
  '|---|---|',
  '| 세부정보 | 세부 정보 |',
  '| 동영상요소 / 동영상 요소 | 동영상 요소 |',
  '| 시청자층 | 시청자층 (한 단어로 읽는다) |',
  '| 트래픽소스 | (쓰지 않는다) → **들어온 길** |',
  '',
  '### 3-5. 도구',
  '| 표기 | **읽기** |',
  '|---|---|',
  '| Vrew | **브루** |',
  '| 캔바 / Canva | **캔바** |',
].join('\n');

const D = T.parseDictMd(DICT_MD);
const find = (s) => D.find((e) => e.source === s);

t('🔴 숫자 빈도표를 읽지 않는다 — `만` -> `967` 이 되면 "백만 명" 이 "백967 명" 이 된다', () => {
  assert.strictEqual(find('만'), undefined);
  assert.ok(!D.some((e) => /^\d+$/.test(e.pron)), '숫자만인 발음이 들어왔다: ' + JSON.stringify(D));
});

t('확정 시점 표도 읽지 않는다', () => {
  assert.strictEqual(find('배속'), undefined);
  assert.strictEqual(find('항목'), undefined);
});

t('`화면 표기` 표는 읽는다', () => {
  assert.ok(find('세부정보'), '세부정보 없음');
  assert.strictEqual(find('세부정보').pron, '세부 정보');
});

t('`표기 | 읽기` 표(3-5절)도 읽는다 — Vrew', () => {
  assert.ok(find('Vrew'), 'Vrew 없음');
  assert.strictEqual(find('Vrew').pron, '브루');
});

t('좌측 슬래시는 여러 항목으로 나뉜다', () => {
  assert.strictEqual(find('동영상요소').pron, '동영상 요소');
  assert.ok(find('Canva'), 'Canva 없음');
  assert.strictEqual(find('Canva').pron, '캔바');
});

t('좌우가 같으면 버린다 (치환할 게 없다)', () => {
  assert.strictEqual(find('시청자층'), undefined);
  assert.strictEqual(find('캔바'), undefined);
});

t('화살표가 있으면 그 뒤를 택한다', () => {
  assert.strictEqual(find('트래픽소스').pron, '들어온 길');
});

t('한 글자 치환은 넣지 않는다 (문장 아무 데나 걸린다)', () => {
  assert.ok(!D.some((e) => e.source.length < 2), JSON.stringify(D.filter((e) => e.source.length < 2)));
});

// ══════════════════════════════════════════════════════════
section('[3] 무음 트림');

t('앞뒤 무음을 잘라낸다', () => {
  const w = makeWav({ durationSec: 3.0, speechStart: 0.5, speechEnd: 2.5 });
  const r = TRIM.trimSilence(w, { padSec: 0.04 });
  assert.ok(r.changed, '트림되지 않았다: ' + r.reason);
  // 말 구간 2.0초 + 여백 0.08초 언저리
  assert.ok(Math.abs(r.durationSec - 2.08) < 0.06, '길이 ' + r.durationSec);
  assert.ok(Math.abs(r.leadSec - 0.46) < 0.05, '앞 자름 ' + r.leadSec);
});

t('padSec 를 존중한다 — 0 이면 더 많이 잘린다', () => {
  const w = makeWav({ durationSec: 3.0, speechStart: 0.5, speechEnd: 2.5 });
  const a = TRIM.trimSilence(w, { padSec: 0 });
  const b = TRIM.trimSilence(w, { padSec: 0.2 });
  assert.ok(a.durationSec < b.durationSec, 'pad 0 이 더 길다');
});

t('포맷이 보존된다 (24000Hz/1ch/16bit)', () => {
  const w = makeWav({ durationSec: 2.0, speechStart: 0.3, speechEnd: 1.7 });
  const r = TRIM.trimSilence(w);
  const i0 = parseWav(w), i1 = parseWav(r.buf);
  assert.strictEqual(i1.sampleRate, i0.sampleRate);
  assert.strictEqual(i1.channels, i0.channels);
  assert.strictEqual(i1.bitsPerSample, i0.bitsPerSample);
});

t('⚠ 전 구간 무음이면 자르지 않는다 (fail-safe)', () => {
  const w = makeWav({ durationSec: 1.0, speechStart: 9, speechEnd: 9 });
  const r = TRIM.trimSilence(w);
  assert.strictEqual(r.changed, false);
  assert.ok(r.reason, '이유가 없다');
  assert.ok(r.buf.equals(w), '원본이 그대로 나와야 한다');
});

t('⚠ 깨진 버퍼에도 던지지 않는다', () => {
  const r = TRIM.trimSilence(Buffer.from('not a wav at all'));
  assert.strictEqual(r.changed, false);
  assert.ok(r.reason);
});

t('말이 처음부터 끝까지면 거의 안 자른다', () => {
  const w = makeWav({ durationSec: 1.0, speechStart: 0, speechEnd: 1.0 });
  const r = TRIM.trimSilence(w);
  if (r.changed) assert.ok(r.trimmedSec < 0.05, '너무 많이 잘랐다: ' + r.trimmedSec);
});

// ══════════════════════════════════════════════════════════
section('[4] 캐시 키 — 무엇이 바뀌면 다시 만드는가');

const base = { voice: 'V', speed: 0.9, speedMode: 'atempo', trim: true, padSec: 0.04, seed: 1 };
const K = (txt, over) => T.cacheKey(txt, Object.assign({}, base, over || {}));

t('같은 조건이면 키가 같다 (= 재합성하지 않는다)', () => {
  assert.strictEqual(K('안녕'), K('안녕'));
});
t('텍스트가 바뀌면 키가 바뀐다', () => {
  assert.notStrictEqual(K('안녕'), K('안녕하세요'));
});
t('🔑 배속·목소리·시드·배속방식이 바뀌면 전량 재합성된다', () => {
  assert.notStrictEqual(K('안녕'), K('안녕', { speed: 1.0 }));
  assert.notStrictEqual(K('안녕'), K('안녕', { voice: 'W' }));
  assert.notStrictEqual(K('안녕'), K('안녕', { seed: 2 }));
  assert.notStrictEqual(K('안녕'), K('안녕', { speedMode: 'server' }));
});
t('트림 설정이 바뀌면 키가 바뀐다', () => {
  assert.notStrictEqual(K('안녕'), K('안녕', { trim: false }));
  assert.notStrictEqual(K('안녕'), K('안녕', { padSec: 0.08 }));
});
t('🔑 출력 포맷(mp3/wav)이 바뀌면 키가 바뀐다', () => {
  assert.notStrictEqual(K('안녕', { ext: '.mp3' }), K('안녕', { ext: '.wav' }));
  assert.strictEqual(K('안녕', { ext: '.MP3' }), K('안녕', { ext: '.mp3' }), '대소문자는 같게 본다');
});

// ══════════════════════════════════════════════════════════
section('[4-b] 출력 포맷은 TSV 의 확장자가 정한다');

t('🔑 앱 설정이 아니라 파일명이 포맷을 정한다 (이름과 내용이 어긋나지 않게)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'tsv-tts.js'), 'utf8');
  assert.ok(/path\.extname\(outName\)/.test(src), '출력 이름의 확장자를 보지 않는다');
  assert.ok(/wantWav\s*=\s*ext === '\.wav'/.test(src), 'wav 판정이 없다');
});

t('🔑 WAV + 배속 1 이면 ffmpeg 를 부르지 않는다 (문장당 0.06초 절약)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'tsv-tts.js'), 'utf8');
  assert.ok(/if \(wantWav && Math\.abs\(tempo - 1\) <= 0\.001\)/.test(src),
    'wav 지름길이 없다 — 트림한 버퍼를 그대로 쓰면 인코딩이 통째로 빠진다');
});

t('encodeMp3 에 옛 인자 이름이 남아 있지 않다 (미정의 식별자)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'tsv-tts.js'), 'utf8');
  assert.ok(!/mp3Path/.test(src), 'mp3Path 가 남아 있다 — 실제로 mp3 출력이 통째로 실패했다(2026-08-26)');
});

// ══════════════════════════════════════════════════════════
section('[5] 구조 — 공용 TTS 캐시와 섞이지 않는다');

t('🔴 core/tsv-tts.js 가 공용 tts-cache 를 require 하지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'tsv-tts.js'), 'utf8');
  assert.ok(!/require\(['"]\.\/tts-cache['"]\)/.test(src),
    '공용 캐시를 쓰면 트림된 음성이 롱폼으로 새어 나가 기존 .vrew 와 타이밍이 어긋난다');
});

t('전용 캐시 폴더가 공용과 다르다', () => {
  const shared = require('../core/tts-cache').DIR;
  assert.notStrictEqual(T.CACHE_DIR, shared);
  assert.ok(/tsv-tts-cache/.test(T.CACHE_DIR), T.CACHE_DIR);
});

t('출력 규격이 24000Hz 모노로 고정돼 있다', () => {
  assert.strictEqual(T.OUT_RATE, 24000);
  assert.strictEqual(T.OUT_CHANNELS, 1);
});

t('CLI 가 시드를 기본 고정한다 (안 하면 같은 문장도 매번 달라진다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tsv-tts.js'), 'utf8');
  assert.ok(/DEFAULT_SEED\s*=\s*\d+/.test(src), 'DEFAULT_SEED 가 없다');
  assert.ok(/seed:\s*DEFAULT_SEED/.test(src), '기본값으로 쓰이지 않는다');
  assert.ok(/seed:\s*o\.seed/.test(src), 'runTsvBatch 로 전달되지 않는다');
});

t('소스에 NUL 바이트가 없다', () => {
  for (const f of ['core/tsv-tts.js', 'core/audio-trim.js', 'tsv-tts.js']) {
    const b = fs.readFileSync(path.join(__dirname, '..', f));
    assert.ok(!b.includes(0), f + ' 에 NUL 이 있다 (문자열이 조용히 깨진다)');
  }
});

// ══════════════════════════════════════════════════════════
section('[6] mp3 인코딩 (ffmpeg 있을 때만)');

if (!T.hasFfmpeg()) {
  console.log('  skip ffmpeg 없음');
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsvtts-'));
  const wav = path.join(dir, 'a.wav');
  fs.writeFileSync(wav, makeWav({ durationSec: 2.0, speechStart: 0.2, speechEnd: 1.8 }));

  t('mp3 를 만들고 길이를 함께 돌려준다 (ffmpeg 1회)', () => {
    const r = T.encodeMp3(wav, path.join(dir, 'a.mp3'), 1);
    assert.ok(r.ok, '인코딩 실패');
    assert.ok(r.durationSec > 1.8 && r.durationSec < 2.3, '길이 ' + r.durationSec);
  });

  t('🔑 배속 0.9 는 더 길어진다 (atempo 방향 확인)', () => {
    const a = T.encodeMp3(wav, path.join(dir, 'a09.mp3'), 0.9);
    const b = T.encodeMp3(wav, path.join(dir, 'a10.mp3'), 1.0);
    assert.ok(a.ok && b.ok);
    assert.ok(a.durationSec > b.durationSec,
      '0.9 가 1.0 보다 길어야 한다: ' + a.durationSec + ' vs ' + b.durationSec);
    const ratio = a.durationSec / b.durationSec;
    assert.ok(Math.abs(ratio - 1 / 0.9) < 0.05, '비율 ' + ratio);
  });

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ══════════════════════════════════════════════════════════
section('[7] 실제 입력 회귀 (파일이 있을 때만)');

// ⚠ 파일명을 못박지 않는다 — 대본 이름은 바뀐다(2026-08-26 에 003.tsv 가 개명되며
//   이 회귀 2건이 조용히 skip 됐다). 폴더에서 **아무 .tsv 나** 찾아 쓴다.
const REAL_DIR = 'D:/비즈니스PT/lecture-video/tts';
const REAL_TSV = (() => {
  try {
    const f = fs.readdirSync(REAL_DIR).filter((x) => /\.tsv$/i.test(x)).sort()[0];
    return f ? path.join(REAL_DIR, f) : '';
  } catch { return ''; }
})();
const REAL_DICT = 'D:/비즈니스PT/_강의안기획/08_발음사전.md';

if (!REAL_TSV || !fs.existsSync(REAL_TSV)) {
  console.log('  skip 실제 대본이 없는 PC');
} else {
  t(path.basename(REAL_TSV) + ' 가 오류 없이 파싱된다', () => {
    const r = T.parseTsv(fs.readFileSync(REAL_TSV, 'utf8'));
    assert.strictEqual(r.errors.length, 0, JSON.stringify(r.errors.slice(0, 3)));
    assert.ok(r.rows.length > 0);
  });
  if (fs.existsSync(REAL_DICT)) {
    t('실제 발음사전에서 위험 항목이 나오지 않는다', () => {
      const d = T.parseDictMd(fs.readFileSync(REAL_DICT, 'utf8'));
      assert.ok(d.length > 10, '항목이 너무 적다: ' + d.length);
      assert.ok(d.length < 100, '항목이 너무 많다(다른 표를 긁었다): ' + d.length);
      assert.ok(!d.some((e) => /^\d+$/.test(e.pron)), '숫자 발음이 섞였다');
      assert.ok(!d.some((e) => e.source.length < 2), '한 글자 항목이 섞였다');
      assert.ok(d.some((e) => e.source === 'Vrew'), 'Vrew 가 빠졌다');
    });
  }
}

// ══════════════════════════════════════════════════════════
console.log('\n────────────────────────────');
console.log('통과 ' + pass + ' · 실패 ' + fail);
process.exit(fail ? 1 : 0);
