/**
 * tts-backcheck.js — 🔎 역대조 게이트: 만든 음성을 받아쓰기해 원문과 대조한다(일본어·베트남어 전용, 2026-09-26).
 *
 * 왜: 일본·베트남 채널은 원어민 검수자가 없다. 사람 대신 받아쓰기(Whisper, OmniVoice /asr-upload)로
 *   「이 음성이 원문대로 들리는가」를 문장마다 재고, 미달이면 다른 시드로 다시 만든다.
 *   🔑 한국어 문장은 이 게이트를 타지 않는다(pipeline 이 lang 으로 거른다) — 한국어 경로 무변경.
 *
 * 실측으로 정한 것(2026-09-26 · 베트남어 목소리 4개 × 40문장 + 성조 최소쌍 + 판정력 검증):
 *   ① Whisper 는 짧은 베트남어 조각에서 **음성이 멀쩡해도** 「Hãy subscribe cho kênh Ghiền Mì Gõ…」를 지어낸다
 *      (같은 파일에서 매번 · 40문장 중 6개). 앞뒤에 **무음 0.5초**를 덧대면 6/6 원문대로 받아써졌다(1.5초는 1개 재발).
 *      → 받아쓰기 전에 0.5초를 덧대고, 알려진 환각이 나오면 다른 길이로 한 번 더, 그래도면 「확인 불가」(음성 탓이 아님).
 *   ② 채점: 베트남어 = 낱말(음절) 단위 편집 거리 — **성조가 다르면 다른 낱말**(성조 오류를 따로 센다).
 *      일본어·한자 = 글자 단위 편집 거리(문장부호·공백 무시). ⚠ 일본어는 표기 흔들림(漢字↔かな)도 오류로 세므로 기준을 낮게 둔다.
 *
 * ⚠ 어떤 경우에도 던지지 않는다 — 받아쓰기가 안 돼도 합성은 성공이다(확인만 못 한 것).
 */
const fs = require('fs');
const path = require('path');

// 기준 — 이 값 이상이면 통과. 실측 분포는 CLAUDE.md·작업노트 2026-09 「역대조 게이트」.
const PASS = { vi: 0.9, ja: 0.85, cjk: 0.85 };
const MAX_RETRY = 2;          // 미달이면 다른 시드로 최대 2번 더 만든다(가장 좋은 것을 쓴다)

// Whisper 가 무음·짧은 조각에서 지어내는 문장(유튜브 자막으로 학습된 흔적). 음성 판정이 아니라 「받아쓰기 실패」로 본다.
const HALLU = [
  /subscribe/i, /Ghiền Mì Gõ/i, /đăng ký kênh/i, /hãy đăng ký/i, /bỏ lỡ những video/i,
  /ご視聴ありがとうございました/, /チャンネル登録/, /字幕/, /最後までご覧/,
  /Amara\.org/i, /thank you for watching/i,
];
const isHallucination = (t) => HALLU.some((re) => re.test(String(t || '')));

const TONE_MARKS = /[̣̀́̃̉]/g;
const viWords = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
const viBase = (w) => w.normalize('NFD').replace(TONE_MARKS, '').normalize('NFC');
const cjkChars = (s) => [...String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')];

/** 편집 거리 + 정렬(같은 칸끼리 비교). eqBase 가 있으면 「밑글자는 같고 성조만 다름」을 따로 센다. */
function align(a, b, eqBase) {
  const n = a.length, m = b.length;
  const d = Array.from({ length: n + 1 }, (_, i) => { const r = new Array(m + 1); r[0] = i; return r; });
  for (let j = 1; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  let i = n, j = m, tone = 0, other = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      if (a[i - 1] !== b[j - 1]) { if (eqBase && eqBase(a[i - 1]) === eqBase(b[j - 1])) tone++; else other++; }
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { other++; i--; } else { other++; j--; }
  }
  return { dist: d[n][m], tone, other, n };
}

/** 원문 대 받아쓰기 점수 — { score(0~1), unit, n, errors, toneErrors } */
function scoreText(orig, heard, lang) {
  if (lang === 'vi') {
    const r = align(viWords(orig), viWords(heard), viBase);
    return { score: r.n ? Math.max(0, 1 - r.dist / r.n) : 0, unit: '음절', n: r.n, errors: r.dist, toneErrors: r.tone };
  }
  const r = align(cjkChars(orig), cjkChars(heard));
  return { score: r.n ? Math.max(0, 1 - r.dist / r.n) : 0, unit: '글자', n: r.n, errors: r.dist, toneErrors: 0 };
}

// ── 🇯🇵 일본어 = 가나(읽기) 대조 (2026-10-17 · v0.9.60) ──────────────────────────────
//   왜: 글자(한자) 대조는 받아쓰기의 **표기 흔들림**(堀辰雄→堀達夫 · 押し→推し)까지 오류로 세서, 4편 4,817문장 중
//   34% 를 미달로 잡았다 — 그리고 1021 A/B 실험(150문장)에서 **루비를 빼서 읽기가 틀려진 음성도 같은 58% 로** 봤다
//   (= 읽기 오류를 못 가린 채 다시 만들기에 시간만 썼다). 가나로 바꿔 대조하면 미달 12% vs 35% 로 갈린다.
//   읽기 변환(형태소 분석 fugashi+unidic-lite)은 **서버 /ja-kana** 가 한다(⛔ npm 형태소 분석기 금지 · 라이트 업데이트).
//   서버에 그 기능이 없거나 실패하면 예전 글자 대조로 돌아간다(fail-open — 검사일 뿐 합성은 성공이다).
const JA_DIGITS = '〇一二三四五六七八九';
function _kanjiSmall(n) {   // 0 < n < 10000
  let s = '';
  for (const [v, name] of [[1000, '千'], [100, '百'], [10, '十']]) {
    const q = Math.floor(n / v);
    if (q) { s += (q === 1 ? '' : JA_DIGITS[q]) + name; n %= v; }
  }
  return s + (n ? JA_DIGITS[n] : '');
}
/** 아라비아 숫자 → 한자 숫자(七月 ↔ 7月 · 百二十万 ↔ 120万 을 같은 읽기로) */
function numToKanji(n) {
  if (n === 0) return '〇';
  let out = '';
  for (const [unit, name] of [[1e8, '億'], [1e4, '万']]) {
    if (n >= unit) { out += _kanjiSmall(Math.floor(n / unit) % 10000) + name; n %= unit; }
  }
  return out + (n ? _kanjiSmall(n) : '');
}
const jaDigits = (s) => String(s || '').normalize('NFKC').replace(/\d+/g, (m) => (m.length <= 12 ? numToKanji(Number(m)) : m));
const kataToHira = (s) => String(s || '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const _VOWEL = {};
for (const [row, v] of [['あかさたなはまやらわがざだばぱぁゃ', 'a'], ['いきしちにひみりぎじぢびぴぃ', 'i'], ['うくすつぬふむゆるぐずづぶぷぅゅ', 'u'], ['えけせてねへめれげぜでべぺぇ', 'e'], ['おこそとのほもよろをごぞどぼぽぉょ', 'o']]) for (const c of row) _VOWEL[c] = v;
const _BARE = { 'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o' };
/** 장음 표기 맞춤 — ー 와 앞 모음을 늘이는 모음(レエ/レー · おう/おお · えい)을 같게 본다(양쪽에 똑같이 건다) */
function longVowelNorm(s) {
  const out = [];
  for (const c of String(s || '')) {
    if (c === 'ー') continue;
    if (_BARE[c] && out.length) {
      const pv = _VOWEL[out[out.length - 1]], b = _BARE[c];
      if (pv === b || (pv === 'o' && b === 'u') || (pv === 'e' && b === 'i')) continue;
    }
    out.push(c);
  }
  return out.join('');
}
/**
 * 루비 짝 — 본문(한자)과 루비 읽기(ttsText)를 맞대어 달라진 덩어리를 (본문, 읽기) 짝으로 뽑는다.
 *   예) 「姉の安寿と」·「姉のあんじゅと」 → [['安寿','あんじゅ']]. 루비 표식은 문장에 남지 않으므로(project-model) 두 글에서 되살린다.
 */
//   🔴 단순 최장 공통 부분(LCS)은 읽기 속 가나에 본문 가나를 잘못 맞춘다 — 「国守の掟」·「くにのかみのおきて」 를
//     国守→くに · 掟→かみのおきて 로 뽑았다(읽기 속 「の」). 그래서 먼저 **나누기 DP** 로 짝을 고른다:
//     본문의 가나·기호는 읽기에도 그대로 있어야 하고(루비는 본문 한자만 바꾼다), 한자 덩어리 → 읽기 덩어리 짝은
//     「한 글자에 가나 두 개 안팎」에서 멀수록 비싸다. 못 맞추면(본문과 읽기가 루비 말고도 다르면) LCS 로 물러선다.
const _KANJI_RE = /[㐀-鿿豈-﫿々〆ヶ]/;
function rubyPairs(text, alt) {
  const a = [...String(text || '')], b = [...String(alt || '')];
  if (!a.length || !b.length || text === alt) return [];
  const seg = _rubySegDP(a, b);
  if (seg) return seg;
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = [];
  let i = 0, j = 0, ra = '', rb = '';
  const flush = () => { if (ra && rb && /[㐀-鿿豈-﫿々〆ヶ]/.test(ra)) pairs.push([ra, rb]); ra = ''; rb = ''; };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++; }
    else if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) ra += a[i++];
    else rb += b[j++];
  }
  flush();
  return pairs;
}
/** 나누기 DP — 본문 a 를 「그대로 같은 글자」와 「루비 덩어리(한자 포함) → 읽기 덩어리」로 나눈다. 못 나누면 null. */
function _rubySegDP(a, b) {
  const n = a.length, m = b.length;
  if (n > 400 || m > 800) return null;
  const MAXA = 12, MAXB = 30, INF = 1e9;
  const f = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF));
  const back = Array.from({ length: n + 1 }, () => new Array(m + 1));
  f[n][m] = 0;
  for (let i = n; i >= 0; i--) {
    for (let j = m; j >= 0; j--) {
      if (i === n && j === m) continue;
      let best = INF, bp = null;
      if (i < n && j < m && a[i] === b[j] && f[i + 1][j + 1] < best) { best = f[i + 1][j + 1]; bp = [i + 1, j + 1]; }
      if (i < n) {
        let hasKanji = false, kanaIn = 0;
        for (let i2 = i + 1; i2 <= Math.min(n, i + MAXA); i2++) {
          if (_KANJI_RE.test(a[i2 - 1])) hasKanji = true; else kanaIn++;
          const la = i2 - i;
          for (let j2 = j + 1; j2 <= Math.min(m, j + MAXB); j2++) {
            if (f[i2][j2] >= INF) continue;
            // 덩어리 안에 본문 가나를 삼키면 비싸다(그 가나는 읽기에 그대로 있어야 정상) — 「国守の掟だ」 통째 묶기 방지
            const c = 1 + Math.abs((j2 - j) - 2 * la) + 3 * kanaIn + (hasKanji ? 0 : 10) + f[i2][j2];
            if (c < best) { best = c; bp = [i2, j2, true]; }
          }
        }
      }
      f[i][j] = best; back[i][j] = bp;
    }
  }
  if (f[0][0] >= INF) return null;
  const pairs = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    const bp = back[i][j];
    if (!bp) return null;
    if (bp[2]) {
      const base = a.slice(i, bp[0]).join(''), rd = b.slice(j, bp[1]).join('');
      if (_KANJI_RE.test(base) && base !== rd) pairs.push([base, rd]);
    }
    i = bp[0]; j = bp[1];
  }
  return pairs;
}

/** 받아쓰기에 루비 낱말의 본문 한자가 그대로 나오면 루비 읽기로 바꿔 둔다 — 「おきて」를 Whisper 가 「掟」로 적은 것을 오독으로 세지 않게 */
function applyRuby(heard, pairs) {
  let h = String(heard || '');
  for (const [base, rd] of [...pairs].sort((x, y) => y[0].length - x[0].length)) h = h.split(base).join(rd);
  return h;
}
/**
 * 일본어 가나 점수 — 원문 읽기(루비 읽기가 있으면 그것) 대 받아쓰기 읽기. 서버 /ja-kana 로 읽기를 얻는다.
 * @returns {Promise<{score, unit, n, errors, toneErrors}|null>} 읽기 변환을 못 하면 null(호출부가 글자 대조로)
 */
async function scoreJaKana(text, heard, altText, client) {
  if (!client || typeof client.toKana !== 'function') return null;
  const ref = altText && altText !== text ? altText : text;
  const pairs = rubyPairs(text, altText);
  const fixed = applyRuby(heard, pairs);
  const kana = await client.toKana([jaDigits(ref), jaDigits(fixed)]);
  if (!Array.isArray(kana) || kana.length !== 2 || typeof kana[0] !== 'string' || typeof kana[1] !== 'string') return null;
  const r = align(cjkChars(longVowelNorm(kataToHira(kana[0]))), cjkChars(longVowelNorm(kataToHira(kana[1]))));
  if (!r.n) return null;
  return { score: Math.max(0, 1 - r.dist / r.n), unit: '가나', n: r.n, errors: r.dist, toneErrors: 0, rubyMiss: rubyMisses(pairs, kana[1]) };
}

/**
 * 🔖 루비 낱말 단위 검사(v0.9.61 · 로이 「루비 읽기가 받아쓰기에 없으면 미달로」) — 문장 점수만으로는 긴 문장에서 한 낱말을
 *   틀려도 85% 를 넘는다(1021 실험: 安寿→「アジ」·国守→「くにむり」 가 86~90% 로 통과). 그래서 루비 낱말마다 그 읽기가
 *   받아쓰기 읽기 안에 있는지 따로 본다.
 *   허용(2026-10-17 실험 300건으로 정함): **탁음·반탁음은 무시**(받아쓰기가 ずしおう→寿司王(すしおう)·だゆう→太夫(たゆう)로
 *   적는다) + 세 글자 이상 읽기는 한 글자 차이까지. → 루비를 뺀 음성 72/150 문장 · 루비 있는 음성 18/150 문장에서 걸렸다
 *   (루비 있는 쪽에 걸린 것도 받아쓰기가 다른 한자로 적은 것이 섞여 있다 — 결과표의 「루비틀림」 칸을 사람이 본다).
 */
const _rubyNorm = (s) => [...longVowelNorm(kataToHira(String(s || '').normalize('NFKC'))).normalize('NFD')]
  .filter((c) => /[\p{L}\p{N}]/u.test(c)).join('').normalize('NFC');
function _subDist(rd, h) {   // h 안에서 rd 와 가장 가까운 조각의 편집 거리
  const n = rd.length;
  let best = n;
  for (let L = Math.max(1, n - 1); L <= n + 1; L++) {
    for (let i = 0; i + L <= h.length; i++) {
      const d = align([...rd], [...h.slice(i, i + L)]).dist;
      if (d < best) { best = d; if (!best) return 0; }
    }
  }
  return best;
}
function rubyMisses(pairs, heardKana) {
  const H = _rubyNorm(heardKana);
  const miss = [];
  for (const [base, rd] of pairs || []) {
    const R = _rubyNorm(rd);
    if (!R || miss.includes(base)) continue;
    if (_subDist(R, H) > (R.length >= 3 ? 1 : 0)) miss.push(base);
  }
  return miss;
}

/** WAV 앞뒤에 무음을 덧댄다(같은 형식 · 무손실). 실패하면 원본 그대로. */
function padWav(buf, sec) {
  try {
    const WS = require('./wav-slice');
    const w = WS.parseWav(buf);
    const zeros = Buffer.alloc(Math.round(w.sampleRate * sec) * w.frameBytes);
    const data = buf.slice(w.dataOffset, w.dataOffset + w.dataSize);
    const pcm = Buffer.concat([zeros, data, zeros]);
    const head = Buffer.from(buf.slice(0, w.dataOffset));
    head.writeUInt32LE(head.length - 8 + pcm.length, 4);
    head.writeUInt32LE(pcm.length, w.dataOffset - 4);
    return Buffer.concat([head, pcm]);
  } catch (_) { return buf; }
}

/**
 * 한 문장 음성(WAV 버퍼)을 받아쓰기해 채점한다.
 * @param altText  같은 말의 다른 표기(🇯🇵 루비 읽기 = s.ttsText) — 있으면 둘 중 높은 점수
 * @returns {Promise<{ok:boolean, score:number|null, heard:string, unknown?:boolean, detail?}>}
 *   unknown = 받아쓰기가 환각·실패라 판정 못 함(음성 탓이 아니다 → 다시 만들지 않는다)
 */
async function checkAudio(wavBuf, text, lang, tmpDir, asr, altText) {
  const client = asr || require('../tts/asr-client');
  const tmp = path.join(tmpDir, `_bc_${process.pid}_${Math.random().toString(36).slice(2, 8)}.wav`);
  let last = '';
  try {
    for (const pad of [0.5, 0.3, 1.0]) {
      try {
        fs.writeFileSync(tmp, padWav(wavBuf, pad));
        // 🇯🇵 일본어는 받아쓰기 언어를 ja 로 못 박는다 — 안 그러면 Whisper 가 일본어 음성을 **영어로 번역해** 적는다
        //   (4편 결과표 15문장 · 「The story has not yet answered anything.」 → 0점 → 헛된 다시 만들기 두 번)
        const a = await client.transcribe(tmp, lang === 'ja' ? { timeoutMs: 60000, language: 'ja' } : { timeoutMs: 60000 });
        last = String((a && (a.text || a)) || '').trim();
      } catch (e) { last = ''; continue; }
      if (!last || isHallucination(last)) continue;
      if (lang === 'ja') {
        let ks = null;
        try { ks = await scoreJaKana(text, last, altText, client); } catch (_) { ks = null; }
        if (ks) return { ok: ks.score >= (PASS[lang] || 0.85) && !(ks.rubyMiss && ks.rubyMiss.length), score: ks.score, heard: last, detail: ks };
      }
      // 일본어는 받아쓰기가 한자를 가나로(또는 반대로) 적을 수 있다 — 루비 읽기(altText)와도 대조해 높은 쪽을 쓴다
      let sc = scoreText(text, last, lang);
      if (altText && altText !== text) { const s2 = scoreText(altText, last, lang); if (s2.score > sc.score) sc = s2; }
      return { ok: sc.score >= (PASS[lang] || 0.85), score: sc.score, heard: last, detail: sc };
    }
    return { ok: true, score: null, heard: last, unknown: true };
  } finally { try { fs.unlinkSync(tmp); } catch (_) {} }
}

/** 대본 한 편의 결과표(TSV · UTF-8 BOM — 엑셀에서 바로 열린다) */
function writeReport(file, rows, meta = {}) {
  const esc = (v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
  const pass = rows.filter((r) => r.status === '통과').length;
  const flagged = rows.filter((r) => r.status === '미달').length;
  const unknown = rows.filter((r) => r.status === '확인 불가').length;
  const avg = rows.filter((r) => r.score != null);
  const head = [
    `# 역대조 보고 — ${esc(meta.title || '')} · 만든 시각 ${esc(meta.when || '')} · 기준 ${esc(meta.threshold || '')}`,
    `# 문장 ${rows.length} · 통과 ${pass} · 미달 ${flagged} · 확인 불가 ${unknown} · 평균 일치율 ${avg.length ? (avg.reduce((a, r) => a + r.score, 0) / avg.length * 100).toFixed(1) + '%' : '-'}`,
    ['문장번호', '언어', '일치율(%)', '성조오류', '재합성', '상태', '원문', '받아쓰기', '루비틀림'].join('\t'),
  ];
  const body = rows.map((r) => [r.num, r.lang, r.score == null ? '' : (r.score * 100).toFixed(1), r.toneErrors || 0, r.retries || 0, r.status, esc(r.text), esc(r.heard), esc((r.rubyMiss || []).join('·'))].join('\t'));
  fs.writeFileSync(file, '﻿' + [...head, ...body].join('\r\n') + '\r\n', 'utf8');
  return { pass, flagged, unknown };
}

/**
 * 잘라낸 참조음성의 참조텍스트 — 원문 앞부분(문장 단위) 중 받아쓰기와 가장 맞는 것을 **원문 표기 그대로** 쓴다.
 *   받아쓰기를 그대로 쓰면 오인식(昔々→昔向かい)이 참조텍스트에 들어간다. 원문 문장과 85% 넘게 맞으면 원문,
 *   아니면 받아쓰기(끝이 문장 중간에서 끊긴 경우). heard 가 비면 원문 그대로.
 */
function refTextForCut(orig, heard, lang) {
  const o = String(orig || '').trim(), h = String(heard || '').trim();
  if (!h) return o;
  if (lang === 'ko' || lang === 'Korean') {   // 🇰🇷 어절 단위 앞부분 중 받아쓰기와 가장 맞는 것(원문 표기·쉼표 그대로) — 받아쓰기의 오인식(밭→밧)이 참조텍스트에 들어가지 않게
    const words = o.split(/\s+/).filter(Boolean), hu = cjkChars(h);
    let bestK = 0, bestSc = 0;
    for (let k = 1; k <= words.length; k++) {
      const tu = cjkChars(words.slice(0, k).join(' '));
      if (Math.abs(tu.length - hu.length) > 3) continue;
      const sc = 1 - align(tu, hu).dist / Math.max(tu.length, hu.length, 1);
      if (sc > bestSc) { bestSc = sc; bestK = k; }
    }
    return bestSc >= 0.85 ? words.slice(0, bestK).join(' ') : h;
  }
  const parts = o.match(/[^。．！？!?.]+[。．！？!?.]*/g) || [o];
  // 🔑 길이도 맞아야 한다 — 소리에 「彼は前」 같은 조각이 더 있는데 첫 문장만 적으면 그 조각이 또 샌다.
  const units = (s) => (lang === 'vi' ? viWords(s) : cjkChars(s));
  const hu = units(h);
  let best = { t: h, sc: 0 };
  for (let k = 1; k <= parts.length; k++) {
    const t = parts.slice(0, k).join('').trim();
    const tu = units(t);
    const r = align(tu, hu);
    const sc = 1 - r.dist / Math.max(tu.length, hu.length, 1);
    if (Math.abs(tu.length - hu.length) <= 2 && sc > best.sc) best = { t, sc };
  }
  return best.sc >= 0.85 ? best.t : h;
}

module.exports = { refTextForCut, PASS, MAX_RETRY, HALLU, isHallucination, scoreText, padWav, checkAudio, writeReport, align, scoreJaKana, rubyPairs, applyRuby, rubyMisses, numToKanji, jaDigits, kataToHira, longVowelNorm };
