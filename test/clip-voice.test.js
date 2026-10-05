// 🎙 대본·화자 목소리(v0.6.83~84 · 로이 2026-10-05) — 우선순위 이 대본 화자 > 채널 화자 > 대본(내레이션) > 채널
//   ① 리본 「🔊 음성 설정」 = 열린 대본 모두(pr.ttsVoice) ② 클립 「🗣」 = **지금 대본의 그 화자 클립 모두**(🗣 내레이션 = 이 대본 pr.ttsVoice ·
//   🗣 엄마 = pr.spkVoices.엄마) ③ ⚙ 채널편집 = 채널 기본(preset) ④ 💰 예상 비용 = 문장마다 실제 목소리 · 🎉 기간 할인
//   node test/clip-voice.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// TTS 캐시가 실제 홈에 쓰지 않게
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-home-'));
process.env.HOME = home; process.env.USERPROFILE = home; os.homedir = () => home;
const P = require('../core/pipeline');
const TE = require('../tts/tts-engines');

function wav(sec) {
  const n = Math.round(24000 * sec), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), 44 + i * 2);
  return b;
}

console.log('\n[1] normVoice · applyVoice — 채널 설정은 그대로, 사본만');
const ch = { name: '채널', voiceCloneRefAudio: 'srv:채널목소리', voiceCloneRefText: '', seed: 7, ttsNormalize: false, speakers: [{ name: '엄마', voice: 'srv:엄마목소리' }] };
const omni = { voiceEngine: { id: 'omnivoice' }, ref: 'srv:대본목소리', label: '대본목소리' };
const mai = { voiceEngine: { id: 'mai', model: 'MAI-Voice-2.1', voice: 'ko-KR-Haena' }, label: '해나' };
ok(TE.normVoice(omni) && TE.normVoice(omni).ref === 'srv:대본목소리', 'OmniVoice 서버 목소리 = 받는다');
ok(TE.normVoice({ voiceEngine: { id: 'omnivoice' }, ref: 'D:\\x.wav' }) === null, '🔑 OmniVoice 로컬 파일 경로는 거른다(서버 목소리만 — 아내 PC 에 파일 없음)');
ok(TE.normVoice({ voiceEngine: { id: 'mai' } }) === null, '유료 엔진인데 목소리 없음 = 거른다');
ok(TE.normVoice({ voiceEngine: { id: 'zzz', voice: 'a' } }) === null, '모르는 엔진 = 거른다');
const before = JSON.stringify(ch);
const a1 = TE.applyVoice(ch, omni);
ok(a1.voiceCloneRefAudio === 'srv:대본목소리' && a1.engine === 'omnivoice' && a1.seed === 7, '대본 목소리(OmniVoice) = 참조음성만 바꾸고 시드·나머지는 채널 것');
ok(JSON.stringify(ch) === before, '🔑 채널 preset 객체는 바뀌지 않는다(사본)');
ok(TE.resolveEngine(TE.applyVoice(ch, mai)) === 'mai', '대본 목소리(MAI) = 엔진이 MAI 로');
ok(TE.applyVoice(ch, null) === ch && TE.applyVoice(ch, { voiceEngine: { id: 'mai' } }) === ch, '빈 값·틀린 값은 채널 그대로(조용히 다른 목소리가 되지 않게)');
ok(/☁ 대본목소리/.test(TE.voiceText(omni)) && /MAI-Voice · 해나/.test(TE.voiceText(mai)), 'voiceText = 사람 말 한 줄');

console.log('\n[2] fillTtsList — 이 대본 화자(preset._spkVoices) > 채널 화자 > 대본(=넘긴 preset) > 채널');
(async () => {
  const calls = [];
  const refreshed = [];
  const mgr = {
    processText: (t) => t, prepareDict: async () => {},
    isAvailable: (id) => id === 'omnivoice', refreshProvider: async (id) => { refreshed.push(id); return true; },
    synthesize: async (t, o) => { calls.push({ t, provider: o.provider, refName: o.refName, voice: o.voice, seed: o.seed }); return { mp3Buffer: wav(1), durationSec: 1, format: 'wav' }; },
  };
  const sents = [
    { num: 1, text: '그날 밤이었습니다.' },
    { num: 2, text: '얘야, 밥 먹어라.', speaker: '엄마' },
    { num: 3, text: '조금만 더 놀고요!', speaker: '아이' },
    { num: 4, text: '엄마가 또 부릅니다.', speaker: '엄마' },
  ];
  const lines = [];
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-wd-'));
  const pv = { ...ch, _spkVoices: { 아이: { voiceEngine: { id: 'omnivoice' }, ref: 'srv:아이목소리', label: '아이목소리' }, 엄마: mai } };
  const res = await P.fillTtsList(sents, pv, mgr, wd, (l) => lines.push(l), null, 1, '시험');
  ok(res.failed.length === 0, '4문장 모두 생성');
  ok(calls[0].refName === '채널목소리', '내레이션 = 채널 목소리');
  ok(calls[2].refName === '아이목소리' && calls[2].provider === 'omnivoice' && calls[2].seed === 7, '🔑 이 대본의 [아이] 목소리(채널에 연결 안 된 화자도) · 시드는 채널 것');
  ok(calls[1].provider === 'mai' && calls[3].provider === 'mai' && calls[3].voice === 'ko-KR-Haena', '🔑 이 대본 [엄마] 목소리가 채널 화자 목소리보다 먼저 — 「엄마」 클립 **모두**(유료 엔진도)');
  ok(refreshed.includes('mai'), '채널과 다른 엔진의 화자가 있으면 그 엔진을 연결해 둔다');
  ok(lines.some((l) => /엄마 → MAI-Voice · 해나\(이 대본\)/.test(l) && /아이 → ☁ 아이목소리\(이 대본\)/.test(l)), '시작 로그 화자 표에 「이 대본」 목소리');
  ok(!lines.some((l) => /목소리를 연결하지 않은 화자/.test(l)), '이 대본 목소리가 있는 화자는 「연결 안 됨」 경고가 없다');

  // 대본 목소리 = main 이 applyVoice 로 얹어 넘긴 preset
  const c2 = [];
  const mgr2 = { ...mgr, synthesize: async (t, o) => { c2.push(o.refName); return { mp3Buffer: wav(1), durationSec: 1, format: 'wav' }; } };
  const wd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-wd2-'));
  await P.fillTtsList([{ num: 1, text: '그날 밤이었습니다.' }, { num: 2, text: '얘야, 밥 먹어라.', speaker: '엄마' }], TE.applyVoice(ch, omni), mgr2, wd2, () => {}, null, 1, '시험');
  ok(c2[0] === '대본목소리', '🔑 대본 목소리 = 내레이션 문장이 그 목소리(캐시가 채널 목소리를 되살리지 않는다)');
  ok(c2[1] === '엄마목소리', '대본 목소리여도 [화자] 목소리는 그대로');

  // 캐시 — 기본 경로(채널 목소리)의 키는 그대로 = 1번 호출에서 만든 채널 목소리 캐시를 되살린다
  const c3 = [];
  const mgr3 = { ...mgr, synthesize: async (t, o) => { c3.push(o.refName); return { mp3Buffer: wav(1), durationSec: 1, format: 'wav' }; } };
  const wd3 = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-wd3-'));
  const l3 = [];
  await P.fillTtsList([{ num: 1, text: '그날 밤이었습니다.' }], ch, mgr3, wd3, (l) => l3.push(l), null, 1, '시험');
  ok(c3.length === 0 && l3.some((l) => /재활용\(캐시\)/.test(l)), '같은 채널 목소리·같은 문장 = 캐시 재활용(기본 경로의 캐시 키 불변)');

  console.log('\n[3] main — 저장·복원·TTS 입구 한 곳');
  const M = read('main.js');
  ok(/function scriptVoicePreset\(preset, pr\)/.test(M), 'scriptVoicePreset 한 곳');
  const n = (M.match(/scriptVoicePreset\(/g) || []).length;
  ok(n >= 8, `🔑 롱폼 TTS 입구(전체·만들기·그룹·클립·도입부) 모두 대본 목소리를 거친다 (${n - 1}곳)`);
  // TTS 입구를 새로 만들고 대본 목소리를 빠뜨리면 여기서 잡는다 — fillTts/fillTtsList 의 preset 인자 자리
  const fills = M.match(/P\.fillTts(List)?\([^;]*\);/g) || [];
  const bad = fills.filter((x) => !/scriptVoicePreset|rollPreset|usePreset|preset, mgr, ttsDir, log, \(\) => S\.abort, speed, '도입부'/.test(x));
  ok(bad.length === 0, `fillTts 호출마다 대본 목소리를 얹은 preset (${bad.map((x) => x.slice(0, 60)).join(' | ')})`);
  ok(/ttsVoice: pr\.ttsVoice \|\| null/.test(M) && /spkVoices: \(pr\.spkVoices && Object\.keys\(pr\.spkVoices\)\.length\) \? pr\.spkVoices : null/.test(M), '작업본에 대본·화자 목소리 저장');
  ok(/if \(ps\.ttsVoice\) proj\.ttsVoice = ps\.ttsVoice/.test(M) && /if \(ps\.ttsVoice\) pr\.ttsVoice = ps\.ttsVoice/.test(M), '작업본에서 대본 목소리 복원(두 경로)');
  ok(/if \(ps\.spkVoices\) proj\.spkVoices = ps\.spkVoices/.test(M) && /if \(ps\.spkVoices\) pr\.spkVoices = ps\.spkVoices/.test(M), '화자 목소리 복원(두 경로)');
  ok(/_spkVoices: pr\.spkVoices/.test(M), 'scriptVoicePreset 이 화자 목소리를 preset._spkVoices 로 싣는다');
  ok(/ipcMain\.handle\('set-speaker-voice'/.test(M) && /ipcMain\.handle\('set-script-voice'/.test(M) && !/set-clip-voice/.test(M), 'IPC set-speaker-voice · set-script-voice (클립 1개짜리 set-clip-voice 는 없앴다)');
  ok(!/\bs\.ttsVoice|\bss\.tv\b/.test(M) && !/ttsVoice/.test(read('core/pipeline.js').replace(/pr\.ttsVoice|ttsVoice:|ttsVoiceText/g, '')), '문장 단위 목소리(s.ttsVoice) 흔적 없음 — 기준은 화자');
  ok(/function _readsBaseVoice\(pr, s, chanSpk\)/.test(M), '「내레이션 목소리로 읽는 문장」 판정 한 곳(대본 목소리를 바꿀 때 지울 음성)');
  const pre = read('preload.js');
  ok(/setSpeakerVoice:/.test(pre) && /setScriptVoice:/.test(pre) && !/setClipVoice/.test(pre), 'preload');

  console.log('\n[4] 화면');
  const A = read('renderer/src/App.jsx');
  ok(/data-testid="clip-spk"/.test(A) && /_S\.onClipVoice\(pr\.shortsNum, s\)/.test(A) && /onClipVoice=\{isLf \? openSpeakerVoice : null\}/.test(A), '클립 「🗣」 = 이 대본의 그 화자 목소리(안정 래퍼 _S 로)');
  ok(/JSON\.stringify\(\[pr0\.ttsVoiceText \|\| '', pr0\.spkVoiceText \|\| null\]\)/.test(A), '🗣 배지가 대본 목소리를 따라 다시 그려진다(cutKey)');
  ok(/const effVe = \(pr, se\) =>/.test(A) && /pr\.spkVoices && pr\.spkVoices\[se\.speaker\]/.test(A) && /pr\.ttsVoice && pr\.ttsVoice\.voiceEngine/.test(A), '💰 예상 비용 = 문장마다 실제 목소리(이 대본 화자 > 채널 화자 > 대본 > 채널)');
  ok(/'onInsMark', 'onClipVoice'\]\) o\[k\] = mk\(k\)/.test(A), 'onClipVoice 가 _S 래퍼 목록에(옛 렌더 함수를 부르지 않게)');
  ok(/data-testid="tts-engine-btn" onClick=\{openScriptVoice\}/.test(A), '리본 「🔊 음성 설정」 = 열린 대본 목소리');
  ok(/onClick=\{\(\) => openTtsEngines\(ch\.name\)\}>🔊 음성 설정에서 바꾸기/.test(A), '⚙ 채널편집 → 「음성 설정에서 바꾸기」 = 채널 기본(그대로)');
  const D = read('renderer/src/TtsEngineDialog.jsx');
  ok(/target, onApply \}\) \{/.test(D) && /data-testid="tts-target"/.test(D), '팝업 대본·클립 모드(target)');
  ok(/if \(target\) \{\s*const d = drafts\[TGT\];/.test(D) && /onApply\(\{ voiceEngine: ve/.test(D), '대본·클립 모드는 채널을 저장하지 않고 onApply 만');
  const css = read('renderer/src/styles.css');
  ok(/body:has\(\.modal-bg\.show\) \.clip-tb\{display:none\}/.test(css), '🧩 팝업이 떠 있으면 검은 클립 막대를 숨긴다');

  console.log('\n[5] 🎉 기간 할인 — ElevenLabs v4 (KST 날짜로 10/12 까지)');
  const at = (s) => Date.parse(s);
  ok(Math.abs(TE.unitFor('eleven_v4', at('2026-10-05T03:00:00Z')).usd * 1e3 - 0.022) < 1e-9 && Math.abs(TE.unitFor('eleven_v4_turbo', at('2026-10-05T03:00:00Z')).usd * 1e3 - 0.011) < 1e-9, '할인 중 = v4 $0.022 · Turbo $0.011 (1천 자)');
  ok(Math.abs(TE.unitFor('eleven_v4', at('2026-10-12T14:59:00Z')).usd * 1e3 - 0.022) < 1e-9, '10/12 23:59 KST = 아직 할인');
  ok(Math.abs(TE.unitFor('eleven_v4', at('2026-10-12T15:00:00Z')).usd * 1e3 - 0.08) < 1e-9, '🔑 10/13 00:00 KST = 정가 $0.08(예상 비용을 낮춰 잡지 않는다)');
  ok(Math.abs(TE.unitFor('eleven_v4', at('2026-09-27T14:00:00Z')).usd * 1e3 - 0.08) < 1e-9, '출시(9/28) 전 = 정가');
  ok(TE.unitFor('eleven_v3', at('2026-10-05T03:00:00Z')).usd === TE.PRICING.eleven_v3.usd, '다른 모델은 그대로');
  ok(Math.abs(TE.estimateUsd('elevenlabs', 'eleven_v4', 10000, null) - (Date.now() < at('2026-10-12T15:00:00Z') ? 0.22 : 0.8)) < 1e-9, 'estimateUsd 도 unitFor 를 탄다');
  { const ps = TE.promosOf('elevenlabs', at('2026-10-05T03:00:00Z')); ok(ps.length === 1 && ps[0].active && ps[0].from === '2026-09-28' && ps[0].until === '2026-10-12', '띠 정보 = 9/28 ~ 10/12 · 진행 중');
    ok(TE.promosOf('elevenlabs', at('2026-10-20T03:00:00Z'))[0].ended, '지나면 ended(회색 한 줄)'); }
  ok(/unit: Object\.fromEntries\(\(e\.models \|\| \[\]\)\.map\(\(m\) => \[m\.id, TE\.unitFor\(m\.id\)\]\)\)/.test(M) && /promos: TE\.promosOf\(e\.id\)/.test(M), '화면 단가표도 할인 반영(main → 팝업·💰)');
  ok(/data-testid="tts-promo"/.test(D) && /<PromoBanner key=\{p\.id\} p=\{p\}/.test(D), 'ElevenLabs 탭 할인 띠');
  ok(/gridAutoRows: 'max-content'/.test(D) && /gap: 4, flexShrink: 0 \}\}/.test(D), '🃏 목소리 카드 — 언어 줄·🔈 줄이 눌리거나 잘리지 않게');

  console.log(`\n${fail ? '❌' : '✅'} clip-voice ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
