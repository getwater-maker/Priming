// 🔎 역대조 일본어 가나 대조 (v0.9.60) — 표기 흔들림은 통과 · 읽기가 다르면 미달 · 루비 낱말 인식 · 받아쓰기 언어 ja 고정 · 서버 없으면 글자 대조로
const fs = require('fs');
const os = require('os');
const path = require('path');
const BC = require('../core/tts-backcheck');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

// 가짜 읽기 사전(서버 fugashi 대신) — 낱말을 길이 순으로 바꾼 뒤 남은 글자는 그대로
const DICT = {
  '堀辰雄': 'ホリタツオ', '堀達夫': 'ホリタツオ', '節子': 'セツコ', '摂氏': 'セッシ', '押し': 'オシ', '推し': 'オシ',
  '国守': 'コクシュ', '国盛': 'クニモリ', '掟': 'オキテ', '姉': 'アネ', '安寿': 'アンジュ', '厨子王': 'チュウシオウ',
  '国': 'クニ', '神': 'カミ', '七月': 'シチガツ', '百二十万': 'ヒャクニジュウマン', '年': 'ネン', '弟': 'オトウト', '名': 'ナ',
};
const fakeKana = (t) => {
  let s = String(t);
  for (const k of Object.keys(DICT).sort((a, b) => b.length - a.length)) s = s.split(k).join(DICT[k]);
  return s;
};
const mkClient = (heard, { kana = true, kanaThrows = false } = {}) => {
  const calls = { transcribe: [], toKana: [] };
  const c = {
    calls,
    transcribe: async (p, opts) => { calls.transcribe.push(opts || {}); return heard; },
  };
  if (kana) c.toKana = async (texts) => { calls.toKana.push(texts); if (kanaThrows) throw new Error('404'); return texts.map(fakeKana); };
  return c;
};
const WAV = (() => {
  const sr = 24000, n = sr / 2; const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n * 2, 40);
  return Buffer.concat([h, Buffer.alloc(n * 2, 3)]);
})();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-ja-'));

(async () => {
  console.log('[1] 도움 함수');
  ok(BC.numToKanji(7) === '七' && BC.numToKanji(120) === '百二十' && BC.numToKanji(1200000) === '百二十万' && BC.numToKanji(11777) === '一万千七百七十七', `숫자 → 한자 (7·120·1200000·11777 → ${BC.numToKanji(11777)})`);
  ok(BC.jaDigits('7月に120万年') === '七月に百二十万年', '문장 안 숫자도 한자로');
  ok(BC.longVowelNorm(BC.kataToHira('レエノルズ')) === BC.longVowelNorm(BC.kataToHira('レーノルズ')), '장음 표기(レエ/レー)를 같게 본다');
  ok(BC.longVowelNorm('とうきょう') === BC.longVowelNorm('とーきょー') && BC.longVowelNorm('かあ') !== BC.longVowelNorm('かい'), '장음 맞춤 — おう/おー 같음 · 다른 모음은 그대로(판정력)');
  const rp = BC.rubyPairs('姉の安寿と弟の厨子王とは', '姉のあんじゅと弟のずしおうとは');
  ok(JSON.stringify(rp) === JSON.stringify([['安寿', 'あんじゅ'], ['厨子王', 'ずしおう']]), `루비 짝 되살리기 ${JSON.stringify(rp)}`);
  ok(BC.rubyPairs('同じ文', '同じ文').length === 0 && BC.rubyPairs('文', '').length === 0, '루비가 없으면 짝도 없다');
  ok(BC.applyRuby('くにのかみの掟だから', [['掟', 'おきて']]) === 'くにのかみのおきてだから', '받아쓰기의 루비 낱말 한자를 루비 읽기로');

  console.log('[2] 가나 대조 (checkAudio · 일본어)');
  {
    const c = mkClient('堀達夫が書いた');
    const r = await BC.checkAudio(WAV, '堀辰雄が書いた', 'ja', TMP, c);
    ok(c.calls.transcribe[0].language === 'ja', '받아쓰기 언어를 ja 로 못 박는다');
    ok(r.ok && r.score === 1 && r.detail.unit === '가나', `표기만 다른 받아쓰기(堀辰雄→堀達夫)는 통과 (가나 ${r.score})`);
    ok(BC.scoreText('堀辰雄が書いた', '堀達夫が書いた', 'ja').score < 0.85, '같은 경우 옛 글자 대조는 미달이었다(A/B — 고치기 전 동작)');
  }
  {
    const c = mkClient('この頃国盛が旅人に');
    const r = await BC.checkAudio(WAV, 'この頃国守が旅人に', 'ja', TMP, c);
    ok(!r.ok && r.detail.unit === '가나', `읽기가 다르면(国守 コクシュ → 国盛 クニモリ) 미달 (가나 ${r.score.toFixed(2)})`);
  }
  {
    // 루비: 원문 「国守《くにのかみ》の掟《おきて》」 → text·ttsText. 받아쓰기는 「掟」를 한자로 적었다.
    const text = '国守の掟だから仕方がありません', tts = 'くにのかみのおきてだから仕方がありません';
    const c = mkClient('国の神の掟だから仕方がありません');
    const r = await BC.checkAudio(WAV, text, 'ja', TMP, c, tts);
    ok(c.calls.toKana[0][0] === tts, '기준 읽기 = 루비 읽기(ttsText)');
    ok(c.calls.toKana[0][1].includes('おきて'), '받아쓰기의 루비 낱말(掟)은 루비 읽기로 바꿔 대조한다');
    ok(r.score >= 0.85, `루비대로 읽었고 받아쓰기가 한자로 적은 경우 통과 (가나 ${r.score.toFixed(2)})`);
    const c2 = mkClient('国守の掟だから仕方がありません'.replace('国守', '国盛'));
    const r2 = await BC.checkAudio(WAV, text, 'ja', TMP, c2, tts);
    ok(r2.score < r.score, `루비와 다르게 읽으면 점수가 내려간다 (${r2.score.toFixed(2)} < ${r.score.toFixed(2)})`);
  }
  {
    const c = mkClient('7月に百二十万年');
    const r = await BC.checkAudio(WAV, '七月に120万年', 'ja', TMP, c);
    ok(r.score === 1, '숫자 표기(7月↔七月 · 120万↔百二十万)는 같은 읽기');
  }

  console.log('[2b] 🔖 루비 낱말 단위 검사 (v0.9.61)');
  {
    // 긴 문장에서 루비 낱말 하나만 틀림 — 문장 점수는 85% 를 넘지만 미달이어야 한다(실측: 安寿→アジ 88% 통과였다)
    const text = '別れぎわ、母は姉の安寿に守本尊の地蔵様を、大切にするようにと言い残しました';
    const tts = '別れぎわ、母は姉のあんじゅにまもりほんぞんの地蔵様を、大切にするようにと言い残しました';
    const c = mkClient('別れぎわ、母は姉のアジにまもりほんぞんの地蔵様を、大切にするようにと言い残しました');
    const r = await BC.checkAudio(WAV, text, 'ja', TMP, c, tts);
    ok(r.score >= 0.85 && !r.ok && JSON.stringify(r.detail.rubyMiss) === '["安寿"]', `한 낱말만 틀려도 미달 (점수 ${r.score.toFixed(2)} · 루비 틀림 ${JSON.stringify(r.detail.rubyMiss)})`);
    const c2 = mkClient(tts);
    const r2 = await BC.checkAudio(WAV, text, 'ja', TMP, c2, tts);
    ok(r2.ok && r2.detail.rubyMiss.length === 0, '루비대로 읽으면 통과(루비 틀림 없음)');
  }
  ok(BC.rubyMisses([['厨子王', 'ずしおう']], 'スシオウハ').length === 0, '탁음 차이(ずしおう↔寿司王 すしおう)는 받아쓰기 탓으로 보고 통과');
  ok(BC.rubyMisses([['厨子王', 'ずしおう']], 'ちゅしおうは').length === 0 && BC.rubyMisses([['安寿', 'あんじゅ']], 'あずみに').length === 1, '세 글자 이상은 한 글자 차이까지 · 그 이상 다르면 틀림(판정력)');
  ok(BC.rubyMisses([['粟', 'あわ']], 'いわのほ').length === 1 && BC.rubyMisses([['粟', 'あわ']], 'あわのほ').length === 0, '두 글자 이하 읽기는 정확히 있어야 한다');
  {
    const f = path.join(TMP, 'rep.tsv');
    BC.writeReport(f, [{ num: 1, lang: 'ja', score: 0.9, retries: 2, status: '미달', text: 'x', heard: 'y', rubyMiss: ['安寿', '国守'] }]);
    const lines = fs.readFileSync(f, 'utf8').split('\r\n');
    ok(lines[2].endsWith('\t루비틀림') && lines[3].endsWith('\t安寿·国守'), '결과표 마지막 칸 = 루비틀림');
  }
  {
    const PL = fs.readFileSync(path.join(__dirname, '..', 'core', 'pipeline.js'), 'utf8');
    ok(/miss\(c2\) < miss\(best\.chk\)/.test(PL) && /rubyMiss: d\.rubyMiss \|\| \[\]/.test(PL) && /rubyMiss: b\.rubyMiss \|\| \[\]/.test(PL), '합성 루프 — 다시 만든 것 중 루비 틀림이 적은 것을 고르고 결과표에 싣는다');
  }

  console.log('[3] 서버에 읽기 기능이 없으면 예전 글자 대조');
  {
    const c = mkClient('堀達夫が書いた', { kana: false });
    const r = await BC.checkAudio(WAV, '堀辰雄が書いた', 'ja', TMP, c);
    ok(r.detail.unit === '글자' && !r.ok, 'toKana 없음 → 글자 대조');
    const c2 = mkClient('堀達夫が書いた', { kanaThrows: true });
    const r2 = await BC.checkAudio(WAV, '堀辰雄が書いた', 'ja', TMP, c2);
    ok(r2.detail.unit === '글자', '/ja-kana 실패(옛 서버 404) → 던지지 않고 글자 대조');
  }

  console.log('[4] 베트남어·환각은 그대로');
  {
    const c = mkClient('Mỗi sáng anh dậy thật sớm');
    const r = await BC.checkAudio(WAV, 'Mỗi sáng, anh dậy thật sớm.', 'vi', TMP, c);
    ok(!('language' in c.calls.transcribe[0]) && c.calls.toKana.length === 0 && r.score === 1 && r.detail.unit === '음절', '베트남어 — 언어 칸·가나 대조 없이 예전 그대로');
    const c3 = mkClient('ご視聴ありがとうございました');
    const r3 = await BC.checkAudio(WAV, '物語はまだ', 'ja', TMP, c3);
    ok(r3.unknown && c3.calls.toKana.length === 0, '일본어 환각은 여전히 「확인 불가」(가나 대조까지 가지 않는다)');
  }

  console.log('[5] 받아쓰기 클라이언트');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'tts', 'asr-client.js'), 'utf8');
    ok(/if \(opts\.language\) form\.append\('language'/.test(src), 'asr-client.transcribe 가 language 칸을 보낸다');
    ok(/'\/ja-kana'/.test(src) && typeof require('../tts/asr-client').toKana === 'function', 'asr-client.toKana → 서버 /ja-kana');
    const bsrc = fs.readFileSync(path.join(__dirname, '..', 'core', 'tts-backcheck.js'), 'utf8');
    ok(!/require\.main/.test(bsrc) && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(bsrc), 'tts-backcheck — 렌더러 번들 안전 · 제어문자 없음');
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n🔎 backcheck-ja-kana ${pass}/${pass + fail} ${fail ? '실패' : '통과'}`);
  process.exit(fail ? 1 : 0);
})();
