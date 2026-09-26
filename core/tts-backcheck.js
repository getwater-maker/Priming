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
        const a = await client.transcribe(tmp, { timeoutMs: 60000 });
        last = String((a && (a.text || a)) || '').trim();
      } catch (e) { last = ''; continue; }
      if (!last || isHallucination(last)) continue;
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
    ['문장번호', '언어', '일치율(%)', '성조오류', '재합성', '상태', '원문', '받아쓰기'].join('\t'),
  ];
  const body = rows.map((r) => [r.num, r.lang, r.score == null ? '' : (r.score * 100).toFixed(1), r.toneErrors || 0, r.retries || 0, r.status, esc(r.text), esc(r.heard)].join('\t'));
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

module.exports = { refTextForCut, PASS, MAX_RETRY, HALLU, isHallucination, scoreText, padWav, checkAudio, writeReport, align };
