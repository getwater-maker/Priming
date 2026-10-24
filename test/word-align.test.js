'use strict';
/**
 * node test/word-align.test.js — 🔤 단어 시각 정렬(core/word-align · core/word-align-pass · Lab 차이표 #10)
 *   [1] 순수 계산: 문장무음에 안 흔들림 · 쉼표 뒤 경계 = 실제 쉼 안 · 골짜기 붙임 · 순서·최소 길이 · 소리 없음 = null
 *   [2] 열쇠(음성 경로·길이·글) · 줄 시작 시각 · 막간 쉼 복제본(_wtB)
 *   [3] 패스: 꺼짐 = wt 지움 · 켬 = 맞춤 · 같은 음성은 다시 읽지 않음 · 비한국어·한 어절·소리 없음
 *   [4] .vrew 빌더: wt 없음 = 글자 비례(예전) · wt 있음 = 줄·단어 경계가 lineOffsets · 합계 = 문장 길이 · SRT·DTO 가 같은 경계
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const WA = require('../core/word-align');
const PASS = require('../core/word-align-pass');
const QT = require('../core/quiet-trim');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const R = 24000;
// 합성 음성: 앞 여백 · 어절마다 말 덩어리(220Hz) · 어절 사이 gaps[i](초 · 아주 작은 잡음) · 끝 여백(문장무음 흉내)
let _seed = 12345; const _rnd = () => (_seed = (_seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;   // 결정적 잡음 — 시험이 흔들리지 않게
function synth(bursts, gaps, lead, tail) {
  _seed = 12345;
  const parts = []; const sil = (sec) => { const a = new Int16Array(Math.round(sec * R)); for (let i = 0; i < a.length; i++) a[i] = Math.round((_rnd() - 0.5) * 4); return a; };
  const burst = (sec) => { const a = new Int16Array(Math.round(sec * R)); for (let i = 0; i < a.length; i++) { const env = Math.min(1, i / 120, (a.length - i) / 120); a[i] = Math.round(12000 * env * Math.sin(2 * Math.PI * 220 * i / R)); } return a; };
  parts.push(sil(lead));
  bursts.forEach((b, i) => { parts.push(burst(b)); if (i < bursts.length - 1) parts.push(sil(gaps[i])); });
  parts.push(sil(tail));
  const out = new Int16Array(parts.reduce((m, p) => m + p.length, 0)); let w = 0; for (const p of parts) { out.set(p, w); w += p.length; }
  return out;
}

console.log('[1] 순수 계산');
const text = '하나둘 셋넷다섯, 여섯일곱 여덟아홉열 열하나둘.';
const toks = WA.tokenize(text);
ok(toks.length === 5 && toks.map((t) => t.pause).join() === 'false,true,false,false,true', `어절 5개 · 쉼표·마침표로 끝나는 어절 표시 (${toks.length})`);
ok(WA.tokenize('가 나다 123 AI.')[2].rw === 4.5 && WA.tokenize('가 나다 123 AI.')[3].rw === 1.6, '소리 무게: 숫자 1.5 · 영문 0.8 · 부호 0');
// 어절 소리 길이 0.30·0.55·0.40·0.45·0.50 초 · 어절 사이 0.04초 · 쉼표 뒤 쉼 0.40초 · 앞 여백 0.20 · 끝 여백 0.15
const bursts = [0.30, 0.55, 0.40, 0.45, 0.50], gaps = [0.04, 0.40, 0.04, 0.04];
const a0 = synth(bursts, gaps, 0.20, 0.15);
const b0 = WA.alignBounds(a0, R, toks, a0.length / R);
const trueBound = []; { let t = 0.20; for (let i = 0; i < 4; i++) { t += bursts[i]; trueBound.push([t, t + gaps[i]]); t += gaps[i]; } }
ok(b0 && b0.length === 6 && b0[0] === 0 && Math.abs(b0[5] - a0.length / R) < 1e-9, '경계 n+1 개 · 처음 0 · 끝 = 파일 길이');
ok(b0 && trueBound.every(([lo, hi], i) => b0[i + 1] >= lo - 0.03 && b0[i + 1] <= hi + 0.03), `경계가 실제 말 사이(쉼·골짜기)에 놓인다 (${b0 && b0.slice(1, 5).map((x) => x.toFixed(2)).join(' · ')} ← 정답 ${trueBound.map(([l, h]) => l.toFixed(2) + '~' + h.toFixed(2)).join(' · ')})`);
ok(b0 && b0[2] >= trueBound[1][0] && b0[2] <= trueBound[1][1], `쉼표 뒤 경계는 0.40초 쉼 안 (${b0 && b0[2].toFixed(3)})`);
// 문장무음 0.8 초가 붙어도 안쪽 경계는 그대로 — 지금 방식(글자 비례 · 전체 길이)은 밀린다
const a1 = synth(bursts, gaps, 0.20, 0.15 + 0.8);
const b1 = WA.alignBounds(a1, R, toks, a1.length / R);
ok(b1 && b0.slice(1, 5).every((x, i) => Math.abs(x - b1[i + 1]) < 0.011), `문장무음 0.8초가 붙어도 경계가 안 밀린다 (최대 ${b1 && Math.max(...b0.slice(1, 5).map((x, i) => Math.abs(x - b1[i + 1]))).toFixed(3)}초)`);
{ const tot = toks.reduce((q, t) => q + (t.to - t.from), 0); let acc = 0; const old = []; for (let k = 0; k < 4; k++) { acc += toks[k].to - toks[k].from; old.push(acc / tot * (a1.length / R)); }
  const err = Math.max(...old.map((x, i) => Math.abs(x - (trueBound[i][0] + trueBound[i][1]) / 2)));
  const errNew = Math.max(...b1.slice(1, 5).map((x, i) => Math.abs(x - (trueBound[i][0] + trueBound[i][1]) / 2)));
  ok(err > 0.15 && errNew < 0.06, `판정력: 지금 방식은 정답에서 최대 ${err.toFixed(2)}초 · 새 방식 ${errNew.toFixed(2)}초`); }
ok(b0.every((x, i) => i === 0 || x - b0[i - 1] >= 0.04 - 1e-9), '어절 최소 길이 40ms · 순서대로');
ok(WA.alignBounds(new Int16Array(R * 2), R, toks, 2) === null, '소리가 없으면 null(= 예전 글자 비례)');
ok(WA.alignBounds(synth([0.1], [], 0.05, 0.05), R, toks, 0.2) === null, '말이 0.3초보다 짧으면 null');
ok(WA.alignBounds(a0, R, WA.tokenize('하나'), 2.5)[1] === 2.5, '어절 하나 = 경계는 [0, 길이]뿐');

console.log('\n[2] 열쇠 · 줄 시작 시각');
const s = { text, ttsAudioPath: 'D:/x/1.wav', ttsDurationSec: a0.length / R, wt: { k: null, b: b0 } };
s.wt.k = WA.keyOf(s);
ok(WA.validBounds(s) === b0, '열쇠가 맞으면 쓴다');
ok(WA.validBounds({ ...s, ttsAudioPath: 'D:/x/2.wav' }) === null && WA.validBounds({ ...s, ttsDurationSec: s.ttsDurationSec + 0.01 }) === null && WA.validBounds({ ...s, text: text + ' 더' }) === null, '음성 경로·길이·글이 바뀌면 쓰지 않는다(= 예전 글자 비례)');
ok(WA.validBounds({ ...s, wt: { k: s.wt.k, f: 1 } }) === null, '실패 표시(f:1)는 쓰지 않는다');
ok(WA.validBounds({ ...s, ttsAudioPath: 'tmp/p0.wav', ttsDurationSec: s.ttsDurationSec + 2, _wtB: b0 }) === b0, '막간 쉼 복제본은 미리 뽑은 _wtB 를 쓴다');
const lines = ['하나둘 셋넷다섯,', '여섯일곱 여덟아홉열', '열하나둘.'];
const CF = require('../core/caption-format');
const rng = CF.lineRanges(text, lines);
const lo = WA.lineOffsets(s, rng, s.ttsDurationSec);
ok(lo && lo.length === 4 && lo[0] === 0 && lo[3] === s.ttsDurationSec && lo[1] === b0[2] && lo[2] === b0[4], `줄 시작 = 어절 경계 그대로 (${lo && lo.map((x) => x.toFixed(2)).join(' · ')})`);
const pad2 = s.ttsDurationSec + 2;
const lo2 = WA.lineOffsets(s, rng, pad2);
ok(lo2 && lo2[1] === lo[1] && lo2[3] === pad2, '막간 쉼으로 파일이 길어져도 줄 시작은 그대로 · 끝만 늘어난다');
ok(WA.lineOffsets({ ...s, wt: null }, rng, s.ttsDurationSec) === null, '정렬이 없으면 null');

console.log('\n[3] 패스(파일)');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'walign-'));
const FF = require('../core/media-utils').getFfmpegPath();
const wavOf = (pcm) => QT.wavOf(pcm, R);
const f1 = path.join(T, '1.wav'); fs.writeFileSync(f1, wavOf(a1));
const mk = (over = {}) => ({ id: 's1', text, ttsAudioPath: f1, ttsDurationSec: a1.length / R, ...over });
(async () => {
  const wr = PASS.readWavPcm(f1);
  ok(wr && wr.rate === R && wr.pcm.length === a1.length && wr.pcm[1000] === a1[1000], 'WAV 직접 읽기(ffmpeg 없이)');
  let x = mk(); let r = await PASS.ensureSentences([x], { wordAlign: false });
  ok(r.aligned === 0 && !x.wt, '꺼짐 = 아무것도 안 한다');
  r = await PASS.ensureSentences([x], { wordAlign: true });
  ok(r.aligned === 1 && x.wt && WA.validBounds(x) && PASS.needs(x) === false, '켬 = 맞춤 · 열쇠 저장 · 더 맞출 것 없음');
  const before = JSON.stringify(x.wt); fs.writeFileSync(f1, 'broken');   // 파일이 깨져도 같은 열쇠면 다시 읽지 않는다
  r = await PASS.ensureSentences([x], { wordAlign: true });
  ok(r.aligned === 0 && JSON.stringify(x.wt) === before, '같은 음성·글은 다시 읽지 않는다');
  fs.writeFileSync(f1, wavOf(a1));
  x.ttsDurationSec += 0.5;   // 음성이 바뀜(쉼 줄이기·배속·다시 만들기)
  ok(PASS.needs(x) === true && WA.validBounds(x) === null, '음성 길이가 바뀌면 어긋남 → 다시 맞출 필요');
  r = await PASS.ensureSentences([x], { wordAlign: true });
  ok(r.aligned === 1 && WA.validBounds(x), '다시 맞춤');
  r = await PASS.ensureSentences([x], { wordAlign: false });
  ok(r.cleared === 1 && !x.wt, '끄면 지운다(= 예전 글자 비례로 돌아간다)');
  const jp = mk({ text: '今日は天気がいいです ね' }); r = await PASS.ensureSentences([jp], { wordAlign: true });
  ok(!jp.wt && !PASS.needs(jp), '한국어가 아니면 건드리지 않는다');
  const one = mk({ text: '하나' }); await PASS.ensureSentences([one], { wordAlign: true });
  ok(!one.wt && !PASS.needs(one), '어절 하나는 맞출 경계가 없다');
  const fs0 = path.join(T, 'silent.wav'); fs.writeFileSync(fs0, wavOf(new Int16Array(R * 3)));
  const sil = mk({ ttsAudioPath: fs0, ttsDurationSec: 3 }); r = await PASS.ensureSentences([sil], { wordAlign: true });
  ok(r.failed === 1 && sil.wt && sil.wt.f === 1 && WA.validBounds(sil) === null && PASS.needs(sil) === false, '소리가 없으면 실패 표시(f:1) — 다시 읽지 않고 예전 글자 비례');
  const mp3 = path.join(T, 'a.mp3'); execFileSync(FF, ['-y', '-loglevel', 'error', '-i', f1, '-c:a', 'libmp3lame', mp3]);
  const dm = (await QT.decodePcm(mp3, FF)).length / R;
  const m3 = mk({ ttsAudioPath: mp3, ttsDurationSec: dm }); r = await PASS.ensureSentences([m3], { wordAlign: true }, { });
  r = await PASS.ensureSentences([m3], { wordAlign: true }, {});
  const m4 = mk({ ttsAudioPath: mp3, ttsDurationSec: dm }); r = await PASS.ensureSentences([m4], { wordAlign: true }, { ffmpegPath: FF });
  ok(r.aligned === 1 && WA.validBounds(m4), 'mp3(배속 사본)는 ffmpeg 로 읽어 맞춘다');

  console.log('\n[4] .vrew 빌더 · SRT · DTO');
  const P = require('../core/pipeline');
  const CAPN = require('../core/mode-profiles').getModeProfile('longform').captionMaxChars;   // toDTO 가 쓰는 줄 글자 수(18 → 2줄)
  const CAP9 = 9;   // 빌더·SRT 는 9자(3줄) — 줄 경계가 둘이라 판정력이 있다
  const img = path.join(T, 'g.png'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:d=1', '-frames:v', '1', img]);
  const wavMain = path.join(T, 'main.wav'); fs.writeFileSync(wavMain, wavOf(a1));
  const build = async (withWt) => {
    const pr = P.parseScriptText(`# t\n## 장\n### 장면\n${text}\n`, 'longform', {}).projects[0];
    pr.groups[0].imagePath = img;
    const sn = pr.sentences[0]; sn.ttsAudioPath = wavMain; sn.ttsDurationSec = a1.length / R;
    if (withWt) await PASS.ensureSentences([sn], { wordAlign: true });
    const v = path.join(T, (withWt ? 'on' : 'off') + '.vrew');
    await P.buildProjectVrew(pr, v, {}, () => {}, CAP9, 1);
    const pj = JSON.parse(new AdmZip(v).readAsText('project.json'));
    const tr = pj.props.tracks, as = pj.props.assets;
    const clips = pj.transcript.clips.map((c) => { const ws = c.words.filter((w) => w.type === 0); return { dur: ws.reduce((q, w) => q + w.duration, 0), words: ws.map((w) => ({ t: w.text, d: w.duration, in: tr[as[w.assetIds[0]].trackIds[0]].sourceIn, out: tr[as[w.assetIds[0]].trackIds[0]].sourceOut })) }; });
    return { pr, sn, clips, v };
  };
  const off = await build(false), on = await build(true);
  const total = a1.length / R;
  ok(off.clips.length >= 2 && Math.abs(off.clips.reduce((q, c) => q + c.dur, 0) - total) < 1e-6, `정렬 없음: 글자 비례(예전) — 클립 ${off.clips.length}개 · 합 = 문장 길이`);
  ok(Math.abs(on.clips.reduce((q, c) => q + c.dur, 0) - total) < 1e-6, '정렬 있음: 클립 합 = 문장 길이(어긋남 없음)');
  const lines2 = on.clips.length; let startsOn = [], t0 = 0; for (const c of on.clips) { startsOn.push(t0); t0 += c.dur; }
  ok(on.clips.every((c) => c.words.every((w, i) => i === 0 || Math.abs(w.in - c.words[i - 1].out) < 1e-9)) && on.clips.every((c) => Math.abs(c.words.reduce((q, w) => q + w.d, 0) - c.dur) < 1e-9), '클립 안 단어가 빈틈·겹침 없이 이어지고 합 = 클립 길이');
  const bT = WA.validBounds(on.sn);
  const allWordsStart = []; { let t = 0; for (const c of on.clips) for (const w of c.words) { allWordsStart.push(w.in); } }
  const tokStarts = bT.slice(0, -1);
  ok(allWordsStart.length === tokStarts.length && allWordsStart.every((x, i) => Math.abs(x - tokStarts[i]) < 1e-6), `단어 시작 시각 = 정렬한 어절 경계 (${allWordsStart.map((x) => x.toFixed(2)).join(' · ')})`);
  ok(on.clips.length === off.clips.length && startsOn.slice(1).some((x, i) => Math.abs(x - (() => { let q = 0; for (let k = 0; k <= i; k++) q += off.clips[k].dur; return q; })()) > 0.1), '판정력: 정렬 있음/없음에서 줄(클립) 경계가 실제로 다르다(0.1초 넘게)');
  const srtP = path.join(T, 'x.srt'); P.writeSrt(on.pr, srtP, CAP9, {});
  const srt = fs.readFileSync(srtP, 'utf8');
  const tm = [...srt.matchAll(/(\d\d):(\d\d):(\d\d),(\d{3}) --> (\d\d):(\d\d):(\d\d),(\d{3})/g)].map((m) => [+m[2] * 60 + +m[3] + +m[4] / 1000, +m[6] * 60 + +m[7] + +m[8] / 1000]);
  ok(tm.length === on.clips.length && tm.every((q, i) => Math.abs(q[0] - startsOn[i]) < 0.002), `SRT 줄 시작 = .vrew 클립 시작 (최대 차이 ${Math.max(...tm.map((q, i) => Math.abs(q[0] - startsOn[i]))).toFixed(4)}초)`);
  const dto = P.toDTO({ kind: 'longform', projects: [on.pr] }); const ds = dto.projects[0].cuts[0].sentences[0];
  const { splitCaptionLines } = require('../core/caption-splitter');
  ok(Array.isArray(ds.wb) && ds.wb.length === bT.length && ds.wb.every((x, i) => Math.abs(x - bT[i]) < 0.0006), `DTO wb = 정렬한 어절 경계 (${ds.wb && ds.wb.map((x) => x.toFixed(2)).join(' · ')})`);
  // 🔑 줄 구분은 쓰는 쪽마다 다르다(.vrew 9자 · 화면 설정 · 모드 프로필 ${CAPN}자) — 화면이 자기 줄 구분으로 같은 함수를 돌리면 .vrew 와 같은 자리가 나온다
  for (const cap of [CAP9, CAPN, 14]) {
    const rngC = CF.lineRanges(text, splitCaptionLines(text, cap));
    const loScreen = WA.offsetsFor(text, ds.wb, rngC, a1.length / R), loMain = WA.lineOffsets(on.sn, rngC, a1.length / R);
    ok(loScreen && loMain && loScreen.length === rngC.length + 1 && loScreen.every((x, i) => Math.abs(x - loMain[i]) < 1e-9), `줄 글자 수 ${cap}자 — 화면 계산(DTO wb) = main 계산 (${loScreen && loScreen.slice(0, -1).map((x) => x.toFixed(2)).join(' · ')})`);
    if (cap === CAP9) ok(loScreen.slice(0, -1).every((x, i) => Math.abs(x - startsOn[i]) < 0.002), '9자: 화면 계산 = .vrew 클립 시작');
  }
  const dto0 = P.toDTO({ kind: 'longform', projects: [off.pr] }).projects[0].cuts[0].sentences[0];
  ok(dto0.wb === null, '정렬 없으면 DTO wb = null');
  // 막간 쉼 복제본 — 파일 경로가 바뀌어도 정렬을 쓴다
  const prP = P.parseScriptText(`# t\n## 장\n### 장면\n> 📜 화면카드: 막간 | 때=하나둘셋넷 | 제목=다음 | 쉼=1\n${text}\n`, 'longform', {}).projects[0];
  prP.groups[0].imagePath = img; prP.sentences[0].ttsAudioPath = wavMain; prP.sentences[0].ttsDurationSec = a1.length / R;
  await PASS.ensureSentences([prP.sentences[0]], { wordAlign: true });
  const vP = path.join(T, 'pz.vrew'); await P.buildProjectVrew(prP, vP, { interludePauseSec: 1 }, () => {}, CAP9, 1);
  const pjP = JSON.parse(new AdmZip(vP).readAsText('project.json'));
  const wsP = pjP.transcript.clips.flatMap((c) => c.words.filter((w) => w.type === 0).map((w) => w.originalStartTime + 0));
  const durP = pjP.transcript.clips.reduce((q, c) => q + c.words.filter((w) => w.type === 0).reduce((z, w) => z + w.duration, 0), 0);
  const rng9 = CF.lineRanges(text, splitCaptionLines(text, CAP9));
  const expP = WA.lineOffsets(on.sn, rng9, total + 1);   // 파일 끝은 쉼 1초가 더해진 길이
  let tp = 0; const startsP = pjP.transcript.clips.map((c) => { const q = tp; tp += c.words.filter((w) => w.type === 0).reduce((z, w) => z + w.duration, 0); return q; });
  ok(expP && startsP.every((x, i) => Math.abs(x - expP[i]) < 1e-6) && startsP.slice(1).some((x, i) => Math.abs(x - startsOn[i + 1]) < 1e-6), `막간 쉼 복제본의 줄 시작 = 정렬 경계(글자 비례 폴백 아님) (${startsP.map((x) => x.toFixed(2)).join(' · ')})`);
  ok(Math.abs(durP - (total + 1)) < 0.01 && pjP.transcript.clips.length === on.clips.length, `막간 쉼 1초 복제본도 정렬을 쓴다(클립 ${pjP.transcript.clips.length}개 · 합 ${durP.toFixed(2)} = ${total.toFixed(2)} + 1)`);

  try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} 통과 · ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
