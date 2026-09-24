// 🎭 화자별 목소리 — 대본 줄 맨 앞 `[이름] 대사` (2026-09-24 로이 확정 형식)
//   node test/speaker-voice.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// TTS 캐시가 실제 홈에 쓰지 않게 — pipeline 을 부르기 전에 홈을 갈아끼운다
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'spk-home-'));
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, homedir: os.homedir };
process.env.HOME = home; process.env.USERPROFILE = home; os.homedir = () => home;
const P = require('../core/pipeline');
const { splitHybrid, MATCH_PATTERNS } = require('../core/sentence-splitter');
const SE = require('../core/script-edit');

console.log('\n[1] 파서 — [이름] 대사');
const SRC = [
  '# 시험',
  '## 1장',
  '### 저녁',
  '> 🖼️ 이미지: a small house at dusk',
  '그날 밤이었습니다.',
  '[엄마] 얘야, 밥 먹어라. 어서 와!',
  '[아이] 조금만 더 놀고요!',
  '그날 저녁은 유난히 조용했습니다.',
  '[어린 소녀] 엄마, 저 왔어요.',
  '[섹션]',
  '[1] 도입 메모입니다.',
  '[카테고리]: 인간관계입니다.',
].join('\n');
const items = splitHybrid(SRC).items;
const by = (t) => items.find((i) => i.text.startsWith(t)) || {};
ok(by('얘야').speaker === '엄마' && by('어서 와').speaker === '엄마', '한 줄에 문장이 둘이면 둘 다 그 화자');
ok(by('조금만').speaker === '아이', '[아이] 대사');
ok(by('그날 밤').speaker === null && by('그날 저녁').speaker === null, '🔑 빈 줄 없이 이어진 내레이션에 화자가 새지 않는다(그 줄에만)');
ok(by('엄마, 저 왔어요').speaker === '어린 소녀', '이름에 공백 허용');
ok(!items.some((i) => /\[/.test(i.text) && i.speaker), '자막·TTS 텍스트에 [이름] 이 남지 않는다');
ok(by('그날 저녁').text === '그날 저녁은 유난히 조용했습니다.', '🔑 화자 줄과 내레이션이 한 문장으로 합쳐지지 않는다');
ok(by('[1] 도입').speaker == null, '숫자 [1] 은 화자가 아니다(메모)');
ok(by('[카테고리]').speaker == null, '[이름]: (콜론)은 화자가 아니다');
ok(by('[1] 도입').sectionTitle === '섹션', '대괄호만 있는 줄은 그대로 섹션');
ok(MATCH_PATTERNS.speakerLine instanceof RegExp, '문장 편집용 규칙에도 노출');

const r = P.parseScriptText(SRC, 'longform', {});
const pr = r.projects[0];
ok(pr.sentences.find((s) => s.text.startsWith('조금만')).speaker === '아이', 'Sentence.speaker 까지 전달');
const dto = P.toDTO(r);
ok(dto.projects[0].cuts[0].sentences.some((s) => s.speaker === '엄마'), 'DTO sentences[].speaker');

console.log('\n[2] 채널 화자 표');
ok(JSON.stringify(P.speakerVoiceMap({ speakers: [{ name: ' 엄마 ', voice: 'srv:여성1' }, { name: '아이', voice: '' }, { name: '', voice: 'x' }] })) === '{"엄마":"srv:여성1"}', '[{name,voice}] — 빈 이름·빈 목소리는 뺀다');
ok(JSON.stringify(P.speakerVoiceMap({ speakers: { 엄마: 'a.wav' } })) === '{"엄마":"a.wav"}', '옛 객체 형태도 받는다');
ok(JSON.stringify(P.speakerVoiceMap({})) === '{}' && JSON.stringify(P.speakerVoiceMap(null)) === '{}', '없으면 빈 표');

console.log('\n[3] fillTtsList — 화자 목소리로 합성 · 연결 안 된 화자는 기본 목소리 + 경고');
function wav(sec) {
  const n = Math.round(24000 * sec), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), 44 + i * 2);
  return b;
}
(async () => {
  const calls = [];
  const mgr = { processText: (t) => t, prepareDict: async () => {}, synthesize: async (t, o) => { calls.push({ t, refName: o.refName, refAudioPath: o.refAudioPath, refText: o.refText }); return { mp3Buffer: wav(1), durationSec: 1, format: 'wav' }; } };
  const preset = { voiceCloneRefAudio: 'srv:#04_득수_낭독', seed: 7, ttsNormalize: false, speakers: [{ name: '엄마', voice: 'srv:여성_따뜻' }] };
  const sents = [
    { num: 1, text: '그날 밤이었습니다.' },
    { num: 2, text: '얘야, 밥 먹어라.', speaker: '엄마' },
    { num: 3, text: '조금만 더 놀고요!', speaker: '아이' },
  ];
  const lines = [];
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'spk-wd-'));
  const res = await P.fillTtsList(sents, preset, mgr, wd, (l) => lines.push(l), null, 1, '시험');
  ok(res.failed.length === 0, '3문장 모두 생성');
  ok(calls[0].refName === '#04_득수_낭독', '내레이션 = 채널 목소리');
  ok(calls[1].refName === '여성_따뜻', '🔑 [엄마] = 채널에 연결한 목소리');
  ok(calls[2].refName === '#04_득수_낭독', '연결 안 된 [아이] = 채널 목소리(조용히 실패하지 않는다)');
  ok(lines.some((l) => /🎭 화자 2명 — 엄마 → ☁ 여성_따뜻/.test(l)), '시작 로그에 화자 표');
  ok(lines.some((l) => /목소리를 연결하지 않은 화자: 아이/.test(l)), '연결 안 된 화자는 로그로 알린다');
  // 캐시가 목소리를 가르는지 — 같은 문장을 다른 화자로 다시 부르면 캐시 적중이 아니라 새 합성
  const c2 = [];
  const mgr2 = { ...mgr, synthesize: async (t, o) => { c2.push(o.refName); return { mp3Buffer: wav(1), durationSec: 1, format: 'wav' }; } };
  const wd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'spk-wd2-'));
  await P.fillTtsList([{ num: 1, text: '얘야, 밥 먹어라.' }], preset, mgr2, wd2, () => {}, null, 1, '시험');
  ok(c2.length === 1 && c2[0] === '#04_득수_낭독', '🔑 같은 문장이라도 화자가 다르면 캐시가 옛 목소리를 되살리지 않는다');
  const c3 = [];
  const mgr3 = { ...mgr, synthesize: async (t, o) => { c3.push(o.refName); return { mp3Buffer: wav(1), durationSec: 1, format: 'wav' }; } };
  const wd3 = fs.mkdtempSync(path.join(os.tmpdir(), 'spk-wd3-'));
  const l3 = [];
  await P.fillTtsList([{ num: 1, text: '얘야, 밥 먹어라.', speaker: '엄마' }], preset, mgr3, wd3, (l) => l3.push(l), null, 1, '시험');
  ok(c3.length === 0 && l3.some((l) => /재활용\(캐시\)/.test(l)), '같은 화자·같은 문장은 캐시 재활용');
  // 파일 목소리(로컬 경로) — 같은 이름의 .txt 가 참조텍스트, 채널 참조텍스트를 섞지 않는다
  const refDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spk-ref-'));
  const refWav = path.join(refDir, '할머니.wav'); fs.writeFileSync(refWav, wav(0.5)); fs.writeFileSync(path.join(refDir, '할머니.txt'), '할머니 참조 문장');
  const c4 = [];
  const mgr4 = { ...mgr, synthesize: async (t, o) => { c4.push(o); return { mp3Buffer: wav(1), durationSec: 1, format: 'wav' }; } };
  await P.fillTtsList([{ num: 1, text: '옛날 옛적에.', speaker: '할머니' }], { voiceCloneRefAudio: 'D:/none.wav', voiceCloneRefText: '채널 참조', seed: 1, ttsNormalize: false, speakers: [{ name: '할머니', voice: refWav }] },
    mgr4, fs.mkdtempSync(path.join(os.tmpdir(), 'spk-wd4-')), () => {}, null, 1, '시험');
  ok(c4[0].refAudioPath === refWav && c4[0].refText === '할머니 참조 문장' && !c4[0].refName, '로컬 파일 목소리 + 그 .txt 참조텍스트');

  console.log('\n[4] 문장 편집 — 화자 줄의 문장을 고쳐도 [이름] 이 남는다');
  const raw = '### 장면\n그날 밤이었습니다.\n[엄마] 얘야, 밥 먹어라.\n';
  const texts = splitHybrid(raw).items.map((i) => i.text);
  const plan = SE.planEdit({ raw, texts, from: 1, count: 1, newText: '얘야, 어서 와라.' });
  ok(plan.ok && /\[엄마\] 얘야, 어서 와라\./.test(plan.raw), `접두 보존 (${plan.ok ? plan.raw.split('\n')[2] : plan.error})`);
  const again = splitHybrid(plan.raw).items;
  ok(again[1].speaker === '엄마', '다시 파싱해도 같은 화자');

  console.log('\n[5] 배선');
  const MAIN = read('main.js'), APP = read('renderer/src/App.jsx');
  ok(/speaker: s\.speaker \|\| null \}\)\),/.test(MAIN) && /if \(ss\.speaker\) s\.speaker = ss\.speaker/.test(MAIN), '작업본(스냅샷)에 화자 저장·복원');
  ok(/\(ss\.speaker \|\| null\) !== \(s\.speaker \|\| null\)\) return;/.test(MAIN), '🔑 대본에 [이름] 을 붙이면 옛 목소리 음성을 복원하지 않는다');
  ok(/const _spk = old\[Math\.min\(ti, old\.length - 1\)\]\.speaker/.test(MAIN), '문장 편집 뒤에도 화자 유지');
  ok(/speakers: Array\.isArray\(p\.speakers\)/.test(APP), '채널편집 열 때 speakers 를 싣는다(안 실으면 저장 때 지워진다)');
  ok(/speakers: \(ch\.speakers \|\| \[\]\)\.map/.test(APP), '채널 저장 patch 에 speakers');
  ok(/replace\(\/\[\\\[\\\]\]\/g, ''\)/.test(APP), '이름에 적은 대괄호는 떼고 저장');
  ok(/🎭 화자별 목소리/.test(APP) && /＋ 화자 추가/.test(APP), '🎙 음성 탭에 화자 칸');
  ok(/className="sspk"/.test(APP), '문장 목록에 화자 배지');
  ok(/화자가 다른 문장입니다/.test(APP), '화자가 다른 문장끼리는 Backspace/Del 로 합치지 않는다');
  ok(/const sOpts = optsFor\(s\);/.test(read('core/pipeline.js')) && /\{ \.\.\.sOpts, normDb/.test(read('core/pipeline.js')), '캐시 키·합성 모두 문장별 목소리');

  process.env.HOME = saved.HOME; process.env.USERPROFILE = saved.USERPROFILE; os.homedir = saved.homedir;
  console.log(`\n${fail ? '❌' : '✅'} speaker-voice ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
