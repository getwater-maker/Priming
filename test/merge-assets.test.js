'use strict';
// node test/merge-assets.test.js — 「📥 자산 이어받기」(통합본) 검증.
//
//   지키려는 것(docs/통합본-자산이어받기-계획.md §6 함정):
//     ① 원본 폴더를 **참조하지 않고 복사**한다 — sweepBadVisuals 가 이상 판정 파일을 실삭제하므로,
//        원본을 가리키면 14부 산출물이 지워진다. → 복사 후 원본 폴더가 **한 바이트도 안 변했는지** 단언.
//     ② ttsDurationSec 를 **반드시** 실어야 한다 — 없으면 빌더가 mp3 를 size/6000 으로 약 4배 과대 추정하고
//        그룹 길이 합산에서 빠져 타임라인이 통째로 왜곡된다.
//     ③ 옛 스냅샷은 이름도 경로도 옛 것이다(회차 대본 개명) → **지문으로 찾고 basename 재기반**.
//     ④ 그룹 매칭은 num 이 아니라 **imagePrompt** (도입부 재배치가 그룹 번호를 재발번호한다).
//     ⑤ 매칭률 게이트가 없으면 오탈자 하나가 조용히 수 시간짜리 재합성이 된다.
//
//   🔑 로직을 복사하지 않는다 — core/merge-assets.js 원문을 그대로 require 해 돌리고,
//      main.js·preload.js·App.jsx 의 배선은 **원문 문자열 대조**로 확인한다.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MA = require(path.join(ROOT, 'core', 'merge-assets'));

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  x ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (기대 ${JSON.stringify(b)} · 실제 ${JSON.stringify(a)})`);
const sect = (t) => console.log('\n' + t);

// ── 픽스처 ──────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mergeassets-'));
const SRC_DIR = path.join(TMP, 'scripts');
const OUT_DIR = path.join(TMP, 'out');
const PROJ_DIR = path.join(TMP, 'projects');   // 스냅샷 폴더(실제 ~/.priming-maker/projects 대체)
for (const d of [SRC_DIR, OUT_DIR, PROJ_DIR]) fs.mkdirSync(d, { recursive: true });

const W = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t, 'utf8'); return p; };

// 소스 1 「문」 — 도입부 1섹션 + 본문 1섹션. 이름이 그대로라 스냅샷을 **이름으로** 찾는다.
const S1_NAME = '[T_0101] 통합 문';
const S1_MD = W(path.join(SRC_DIR, S1_NAME + '.md'), [
  '# 통합 문',
  '',
  '## 도입부',
  '',
  '### 서가의 등불',
  '고전서재입니다.',
  '오늘은 첫 이야기를 읽습니다.',
  '',
  '> 🖼️ 이미지: an oil lamp on a wooden table',
  '> 🎬 비디오: the lamp flame wavers',
  '',
  '### 오늘 듣는 것',
  '그럼 시작하겠습니다.',
  '',
  '> 🖼️ 이미지: an open manuscript page',
  '',
].join('\n'));

// 소스 2 「1부」 — **개명된 대본**(스냅샷은 옛 이름 + 옛 경로) + 통합본이 잘라낼 섹션(도입부·지난 이야기) 포함.
const S2_NAME = '[T_0203] 1부 새이름';
const S2_OLD_NAME = '[T_0115] 1부 옛이름';
const S2_MD = W(path.join(SRC_DIR, S2_NAME + '.md'), [
  '# 1부',
  '',
  '## 도입부',
  '',
  '### 인사',
  '첫 번째 이야기를 시작합니다.',
  '',
  '> 🖼️ 이미지: intro of part one',
  '',
  '## 지난 이야기',
  '',
  '### 되짚기',
  '지난 이야기를 되짚습니다.',
  '',
  '> 🖼️ 이미지: recap of part one',
  '',
  '## 여는 이야기',
  '',
  '### 초록 지붕 집',
  '초록 지붕 집에 사는 사람이 있었습니다.',
  '그 집은 언덕 위에 있었습니다.',
  '',
  '> 🖼️ 이미지: a green gabled house on a hill',
  '',
  '### 브라이트리버 역',
  '역에 도착했습니다.',
  '아무도 없었습니다.',
  '같은 문장이 반복됩니다.',
  '',
  '> 🖼️ 이미지: an empty railway platform',
  '',
  '## 마무리',
  '',
  '### 닫는 말',
  '같은 문장이 반복됩니다.',
  '댓글로 알려 주세요.',
  '',
  '> 🖼️ 이미지: closing of part one',
  '',
].join('\n'));

// ── 소스 출력폴더(기존 산출물) ──
function makeOut(folder, nAudio, images, videos) {
  const root = path.join(OUT_DIR, folder);
  fs.mkdirSync(path.join(root, 'tts-1'), { recursive: true });
  fs.mkdirSync(path.join(root, 'media-1'), { recursive: true });
  for (let i = 1; i <= nAudio; i++) fs.writeFileSync(path.join(root, 'tts-1', `${i}.wav`), `AUDIO-${folder}-${i}`);
  for (const f of images) fs.writeFileSync(path.join(root, 'media-1', f), `IMG-${folder}-${f}`);
  for (const f of videos) fs.writeFileSync(path.join(root, 'media-1', f), `VID-${folder}-${f}`);
  return root;
}
const OUT1 = makeOut(S1_NAME, 3, ['01.png', '02.png'], ['01.mp4', '01_1080.mp4']);
const OUT2 = makeOut(S2_NAME, 9, ['01.png', '03.png', '04.png'], []);

// ── 스냅샷 ──
//   ⚠ 소스2 스냅샷은 **옛 이름 파일 + 옛 절대경로**다(함정 ③ 재현).
function snapGroup(num, prompt, imgPath, vidPath, sents) {
  return { num, phase: 'p' + num, imagePrompt: prompt, imagePath: imgPath, videoPath: vidPath, sentences: sents };
}
function writeSnap(fileBase, scriptPath, groups) {
  const snap = { scriptPath, fileTitle: fileBase, mode: 'longform', savedAt: Date.now(), projects: [{ shortsNum: 1, groups }] };
  fs.writeFileSync(path.join(PROJ_DIR, fileBase + '.smproj.json'), JSON.stringify(snap, null, 2), 'utf8');
  return snap;
}
const A1 = (i) => path.join(OUT1, 'tts-1', i + '.wav');
// 소스1: 경로 정상. 단 **마지막 문장은 경로가 비어 있다**(자동저장이 합성 직전에 찍힌 실제 사례) → 번호 폴백 검증.
writeSnap(S1_NAME, S1_MD, [
  snapGroup(1, 'an oil lamp on a wooden table', path.join(OUT1, 'media-1', '01.png'), path.join(OUT1, 'media-1', '01.mp4'), [
    { text: '고전서재입니다.', ttsAudioPath: A1(1), ttsDurationSec: 1.7 },
    { text: '오늘은 첫 이야기를 읽습니다.', ttsAudioPath: A1(2), ttsDurationSec: 2.5 },
  ]),
  snapGroup(2, 'an open manuscript page', path.join(OUT1, 'media-1', '02.png'), null, [
    { text: '그럼 시작하겠습니다.', ttsAudioPath: null, ttsDurationSec: null },
  ]),
]);
// 소스2: 옛 이름 + 옛 드라이브 경로. 이미지는 3개만 기록(대본 프롬프트는 5개 → 2개는 새로 만들어야 함).
const OLDBASE = 'Z:\\옛경로\\' + S2_OLD_NAME;
const A2 = (i) => OLDBASE + '\\tts-1\\' + i + '.wav';
writeSnap(S2_OLD_NAME, path.join('D:\\옛대본', S2_OLD_NAME + '.md'), [
  snapGroup(1, 'intro of part one', OLDBASE + '\\media-1\\01.png', null, [
    { text: '첫 번째 이야기를 시작합니다.', ttsAudioPath: A2(1), ttsDurationSec: 3.5 },
  ]),
  snapGroup(2, 'recap of part one', OLDBASE + '\\media-1\\02.png', null, [
    { text: '지난 이야기를 되짚습니다.', ttsAudioPath: A2(2), ttsDurationSec: 2.2 },
  ]),
  snapGroup(3, 'a green gabled house on a hill', OLDBASE + '\\media-1\\03.png', null, [
    { text: '초록 지붕 집에 사는 사람이 있었습니다.', ttsAudioPath: A2(3), ttsDurationSec: 4.0 },
    { text: '그 집은 언덕 위에 있었습니다.', ttsAudioPath: A2(4), ttsDurationSec: 3.0 },
  ]),
  snapGroup(4, 'an empty railway platform', OLDBASE + '\\media-1\\04.png', null, [
    { text: '역에 도착했습니다.', ttsAudioPath: A2(5), ttsDurationSec: 2.0 },
    { text: '아무도 없었습니다.', ttsAudioPath: A2(6), ttsDurationSec: 1.8 },
    { text: '같은 문장이 반복됩니다.', ttsAudioPath: A2(7), ttsDurationSec: 2.4 },
  ]),
  snapGroup(5, 'closing of part one', OLDBASE + '\\media-1\\05.png', null, [   // 05.png 는 실재하지 않음 → 미매칭
    { text: '같은 문장이 반복됩니다.', ttsAudioPath: A2(8), ttsDurationSec: 2.6 },
    { text: '댓글로 알려 주세요.', ttsAudioPath: A2(9), ttsDurationSec: 2.1 },
  ]),
]);

// ── 통합대본 — 소스 순서대로, 잘라낼 섹션(1부 도입부·지난 이야기·마무리 끝문장)은 뺀다 ──
function mergedScript({ typo = false } = {}) {
  return [
    '# 통합본 1',
    '',
    `> 📥 자산출처: ${S1_MD} | ${OUT1}`,
    `> 📥 자산출처: ${S2_MD} | ${OUT2}`,
    '',
    '## 도입부',
    '',
    '### 서가의 등불',
    '고전서재입니다.',
    '오늘은 첫 이야기를 읽습니다.',
    '',
    '> 🖼️ 이미지: an oil lamp on a wooden table',
    '> 🎬 비디오: the lamp flame wavers',
    '',
    '### 오늘 듣는 것',
    '그럼 시작하겠습니다.',
    '',
    '> 🖼️ 이미지: an open manuscript page',
    '',
    '## 1부 · 여는 이야기',            // H2 제목은 바꿔도 매칭과 무관
    '',
    '### 초록 지붕 집',
    typo ? '초록 지붕 집에 사는 사람이 있었습니다!' : '초록 지붕 집에 사는 사람이 있었습니다.',
    typo ? '그 집은 언덕 위에 있었습니다!' : '그 집은 언덕 위에 있었습니다.',
    '',
    '> 🖼️ 이미지: a green gabled house on a hill',
    '',
    '### 브라이트리버 역',
    '역에 도착했습니다.',
    '아무도 없었습니다.',
    '같은 문장이 반복됩니다.',
    '',
    '> 🖼️ 이미지: an empty railway platform',
    '',
    '## 1부 · 마무리',
    '',
    '### 닫는 말',
    '같은 문장이 반복됩니다.',           // 앞 그룹과 **같은 문장** — 전방 커서가 서로 다른 음성에 붙여야 한다
    '',
    '> 🖼️ 이미지: closing of part one',
    '',
  ].join('\n');
}
const MERGED_MD = W(path.join(SRC_DIR, '[T_0301] 통합본 1.md'), mergedScript());

// 원본 폴더 지문 — 복사 뒤에도 그대로여야 한다(함정 ①)
function fingerprintDir(root) {
  const out = [];
  const walk = (d, rel) => {
    for (const f of fs.readdirSync(d).sort()) {
      const full = path.join(d, f), st = fs.statSync(full);
      if (st.isDirectory()) walk(full, rel + f + '/');
      else out.push(`${rel}${f}:${st.size}:${fs.readFileSync(full, 'utf8')}`);
    }
  };
  walk(root, '');
  return out.join('|');
}
const FP1 = fingerprintDir(OUT1), FP2 = fingerprintDir(OUT2);

// ── 파서 ──
const P = require(path.join(ROOT, 'core', 'pipeline'));
const TH = { splitMode: 'h3', introSentenceSize: 3, mainSentenceSize: 7, shortLen: 10, longLen: 20 };
const parseSource = (p) => { const q = P.parseScript(p, 'longform', TH).projects[0]; return { sentences: q.sentences, groups: q.groups }; };

// ═══ [1] 자산출처 메타 파싱 ═══════════════════════════════
sect('[1] 「> 📥 자산출처:」 파싱');
{
  const srcs = MA.parseAssetSources(fs.readFileSync(MERGED_MD, 'utf8'));
  eq(srcs.length, 2, '자산출처 2개');
  eq(srcs[0].scriptPath, S1_MD, '첫 소스 대본 경로');
  eq(srcs[0].outDir, OUT1, '첫 소스 출력폴더');
  ok(MA.hasAssetSources(fs.readFileSync(MERGED_MD, 'utf8')), 'hasAssetSources 참');
  ok(!MA.hasAssetSources(fs.readFileSync(S1_MD, 'utf8')), '일반 대본은 자산출처 없음');
  ok(MA.fileHasAssetSources(MERGED_MD), 'fileHasAssetSources 참');
  // 출력폴더를 안 적은 줄도 죽지 않고 outDir=null 로 들어온다
  eq(MA.parseAssetSources('> 📥 자산출처: C:\\a.md')[0].outDir, null, '출력폴더 없는 줄은 outDir=null');
  // 이모지 없이도 인식(사람이 손으로 적는 경우)
  eq(MA.parseAssetSources('> 자산출처: C:\\a.md | C:\\out').length, 1, '이모지 없는 줄도 인식');
  // 일반 인용줄은 자산출처가 아니다
  eq(MA.parseAssetSources('> 🎯 자산출처가 어쩌고').length, 0, '비슷한 인용줄은 걸리지 않는다');
}

// ═══ [2] 스냅샷 찾기 — 이름 / 지문(개명) ═══════════════════
sect('[2] 스냅샷 탐색 (함정 ③ — 개명된 대본)');
{
  const p1 = parseSource(S1_MD);
  const f1 = MA.findSnapshot(S1_MD, p1.sentences.slice(0, 3).map((s) => MA.normText(s.text)), { projDir: PROJ_DIR });
  ok(!!f1, '소스1 스냅샷 발견');
  eq(f1 && f1.matchedBy, 'name', '소스1 은 이름으로 찾는다');

  const p2 = parseSource(S2_MD);
  const probes = [0.05, 0.4, 0.85].map((r) => MA.normText(p2.sentences[Math.floor(p2.sentences.length * r)].text));
  const f2 = MA.findSnapshot(S2_MD, probes, { projDir: PROJ_DIR });
  ok(!!f2, '개명된 소스2 도 스냅샷을 찾는다');
  eq(f2 && f2.matchedBy, 'fingerprint', '소스2 는 지문으로 찾는다');
  eq(f2 && path.basename(f2.file), S2_OLD_NAME + '.smproj.json', '찾은 스냅샷은 옛 이름 파일');

  // 전혀 다른 대본은 남의 스냅샷을 집지 않는다(오폭 방지)
  const f3 = MA.findSnapshot(path.join(SRC_DIR, '없는대본.md'), ['이 문장은 어디에도 없다 12345'], { projDir: PROJ_DIR });
  ok(!f3, '관련 없는 대본은 스냅샷을 찾지 않는다(오폭 금지)');
  // 지문이 없으면 이름 일치만 인정 — 아무 스냅샷이나 집지 않는다
  ok(!MA.findSnapshot(path.join(SRC_DIR, '없는대본.md'), [], { projDir: PROJ_DIR }), '지문 없이 이름도 다르면 null');
}

// ═══ [3] basename 재기반 ═════════════════════════════════
sect('[3] 경로 재기반(rebase) — 옛 경로를 믿지 않는다');
{
  const md = path.join(OUT2, 'media-1');
  eq(MA.rebase(OLDBASE + '\\media-1\\01.png', md), path.join(md, '01.png'), '옛 절대경로 → 현재 폴더로 재기반');
  eq(MA.rebase(OLDBASE + '\\media-1\\99.png', md), null, '실존하지 않으면 null (실존 확인 필수)');
  eq(MA.rebase(null, md), null, '경로 없으면 null');
  const md1 = path.join(OUT1, 'media-1');
  eq(MA.rebaseVideo(OLDBASE + '\\media-1\\01.mp4', md1), path.join(md1, '01_1080.mp4'), '비디오는 업스케일본(_1080) 우선');
  eq(MA.rebaseVideo(OLDBASE + '\\media-1\\01_1080.mp4', md1), path.join(md1, '01_1080.mp4'), '이미 _1080 이면 그대로');
  eq(MA.rebaseVideo(OLDBASE + '\\media-1\\09.mp4', md1), null, '없는 비디오는 null');
}

// ═══ [4] 색인 + 매칭 (정상) ══════════════════════════════
sect('[4] 매칭 — 정상 통합대본');
let idx, pr, sm, gm, rep;
{
  const sources = MA.parseAssetSources(fs.readFileSync(MERGED_MD, 'utf8'));
  idx = MA.buildSourceIndex(sources, parseSource, { projDir: PROJ_DIR });
  eq(idx.srcStats[0].matchedBy, 'name', '소스1 스냅샷: 이름');
  eq(idx.srcStats[1].matchedBy, 'fingerprint', '소스2 스냅샷: 지문');
  eq(idx.srcStats[0].audioByNum, 1, '소스1 의 경로 없는 문장 1개는 번호 폴백으로 찾았다');
  eq(idx.sents.length, 3 + 9, '색인 문장 = 소스1 3 + 소스2 9');
  ok(idx.sents.every((e) => e.file), '색인 문장 전부 음성 파일 확보');
  eq(idx.groups.filter((g) => g.image).length, 2 + 3, '색인 이미지 = 소스1 2 + 소스2 3 (05.png 는 실재 안 함)');

  pr = P.parseScript(MERGED_MD, 'longform', TH).projects[0];
  eq(pr.sentences.length, 9, '통합대본 문장 9개');
  eq(pr.groups.length, 4, '통합대본 그룹 4개 (도입부 3문장이 한 그룹으로 묶인다)');
  sm = MA.matchSentences(pr.sentences, idx);
  gm = MA.matchGroups(pr.groups, idx);
  rep = MA.buildReport(pr, sm, gm, idx);
  eq(rep.sentences.matched, 9, '문장 9/9 매칭 (잘라낸 섹션을 건너뛰어도 이어진다)');
  eq(rep.sentences.rate, 1, '매칭률 100%');
  eq(rep.groups.imageMatched, 3, '이미지 3개 매칭 (closing 은 파일이 없어 새로 생성)');
  eq(rep.groups.withPrompt, 4, '프롬프트 있는 그룹 4개');
  eq(rep.groups.videoMatched, 1, '비디오 1개 매칭');
  eq(rep.missingGroups.length, 1, '새로 만들 이미지 1개');
  ok(sm.every((m) => m && m.dur > 0 || (m && m.file && m.dur === null)), '매칭 항목은 파일을 갖는다');

  // 🔑 전방 커서 — 같은 문장('같은 문장이 반복됩니다.')이 두 번 나오면 **서로 다른** 음성에 순서대로 붙어야 한다.
  const dupIdx = [];
  pr.sentences.forEach((s, i) => { if (MA.normText(s.text) === '같은 문장이 반복됩니다.') dupIdx.push(i); });
  eq(dupIdx.length, 2, '중복 문장 2개');
  ok(sm[dupIdx[0]].file !== sm[dupIdx[1]].file, '중복 문장이 서로 다른 음성에 붙는다(전방 커서)');
  eq(path.basename(sm[dupIdx[0]].file), '7.wav', '첫 중복 → 7.wav');
  eq(path.basename(sm[dupIdx[1]].file), '8.wav', '둘째 중복 → 8.wav');

  // 함정 ④ — 그룹 매칭은 num 이 아니라 프롬프트. 통합본 G3 는 소스2 의 G3 에 붙는다(번호가 밀려도).
  const g2 = pr.groups[1];
  eq(g2.num, 2, '통합본에서는 그룹 번호가 2');
  eq(MA.normPrompt(g2.imagePrompt), 'a green gabled house on a hill', '통합 G2 프롬프트');
  eq(path.basename(gm[1].image), '03.png', '번호는 2인데 소스의 03.png 를 찾았다 — 프롬프트로 매칭(함정 ④)');
}

// ═══ [5] 한 글자 수정 → 미매칭 + 게이트 ══════════════════
sect('[5] 오탈자 → 미매칭 · 게이트 (함정 ⑤)');
let typoRate = 1;
{
  const TYPO_MD = W(path.join(SRC_DIR, '[T_0302] 통합본 오탈자.md'), mergedScript({ typo: true }));
  const tpr = P.parseScript(TYPO_MD, 'longform', TH).projects[0];
  const tsm = MA.matchSentences(tpr.sentences, idx);
  const trep = MA.buildReport(tpr, tsm, MA.matchGroups(tpr.groups, idx), idx);
  eq(trep.sentences.matched, 7, '한 글자 바뀐 문장 2개는 매칭에서 빠진다');
  eq(trep.missingSentences.length, 2, '미매칭 목록에 2개');
  typoRate = trep.sentences.rate;
  ok(typoRate < 0.95, `게이트 기준(95%) 미만 → 멈춰야 한다 (실제 ${(typoRate * 100).toFixed(1)}%)`);
  // 🔑 실패한 문장이 **뒤 문장을 밀어내지 않는다** — 커서를 안 움직이므로 그 뒤는 그대로 매칭된다.
  const after = tsm.slice(5).filter((m) => m && m.file).length;
  eq(after, 4, '오탈자 뒤 문장 4개는 정상 매칭(커서 오염 없음)');
}

// ═══ [6] 복사 + 주입 + 원본 무변경 ═══════════════════════
sect('[6] 복사·주입 (함정 ①②)');
const MERGED_OUT = path.join(OUT_DIR, '[T_0301] 통합본 1');
let copied;
{
  const dirs = { tts: path.join(MERGED_OUT, 'tts-1'), media: path.join(MERGED_OUT, 'media-1'), subtitles: path.join(MERGED_OUT, 'subtitles-1') };
  fs.mkdirSync(dirs.tts, { recursive: true });
  // 부분 합성 상태 재현 — 이어받기 **전에** 새로 합성해 둔 음성이 있으면 무조건 덮어써야 한다(§1-B).
  fs.writeFileSync(path.join(dirs.tts, '1.wav'), 'STALE-NEW-SYNTH');
  fs.writeFileSync(path.join(dirs.tts, '2.mp3'), 'STALE-OTHER-EXT');

  const run = async () => {
    let probes = 0;   // 스냅샷에 길이가 없던 그 1개만 실측돼야 한다
    const r = await MA.copyIntoWorkdirs(pr, sm, gm, dirs, { probeDur: async () => { probes++; return 1.23; } });
    eq(r.audio, 9, '음성 9개 복사·연결');
    eq(r.images, 3, '이미지 3개 복사·연결');
    eq(r.videos, 1, '비디오 1개 복사·연결');
    eq(probes, 1, '길이 없는 1개만 ffprobe 로 실측');
    eq(r.copyFailed.length, 0, '복사 실패 0');
    eq(r.noDuration.length, 0, '길이 미확보 0');

    // 함정 ① — 모든 경로가 **통합본 작업폴더 안**을 가리켜야 한다(원본 참조 금지)
    const inWork = (p) => p && path.resolve(p).toLowerCase().startsWith(path.resolve(MERGED_OUT).toLowerCase() + path.sep);
    ok(pr.sentences.every((s) => inWork(s.ttsAudioPath)), '모든 ttsAudioPath 가 통합본 폴더 안(원본 참조 금지)');
    ok(pr.groups.every((g) => !g.imagePath || inWork(g.imagePath)), '모든 imagePath 가 통합본 폴더 안');
    ok(pr.groups.every((g) => !g.videoPath || inWork(g.videoPath)), '모든 videoPath 가 통합본 폴더 안');

    // 함정 ② — 길이가 반드시 있어야 한다
    ok(pr.sentences.every((s) => s.ttsDurationSec > 0), '모든 문장에 ttsDurationSec 가 있다(빌더 4배 과대추정 방지)');
    eq(pr.sentences[0].ttsDurationSec, 1.7, '스냅샷 길이가 그대로 실린다');
    eq(pr.sentences[2].ttsDurationSec, 1.23, '스냅샷에 없던 길이는 실측값');

    // 파일명 = 새 번호 / 내용 = 원본
    eq(fs.readFileSync(path.join(dirs.tts, '1.wav'), 'utf8'), `AUDIO-${S1_NAME}-1`, '1.wav 가 원본 내용으로 덮어써졌다(부분 합성분 제거)');
    eq(fs.readFileSync(path.join(dirs.tts, '4.wav'), 'utf8'), `AUDIO-${S2_NAME}-3`, '통합 4번 문장 = 소스2 의 3.wav');
    ok(!fs.existsSync(path.join(dirs.tts, '2.mp3')), '확장자가 다른 옛 파일은 정리된다');
    eq(fs.readFileSync(path.join(dirs.media, '01.png'), 'utf8'), `IMG-${S1_NAME}-01.png`, '01.png 복사 내용 일치');
    eq(fs.readFileSync(path.join(dirs.media, '01.mp4'), 'utf8'), `VID-${S1_NAME}-01_1080.mp4`, '비디오는 업스케일본이 01.mp4 로 들어온다');
    eq(fs.readFileSync(path.join(dirs.media, '02.png'), 'utf8'), `IMG-${S2_NAME}-03.png`, '통합 G2 파일명은 02.png · 내용은 소스2 의 03.png');
    ok(!fs.existsSync(path.join(dirs.media, '04.png')), '파일이 없던 그룹(G4)은 비어 있다 — 새로 생성될 것');

    // 함정 ① — 원본 폴더는 한 바이트도 안 변했다
    eq(fingerprintDir(OUT1), FP1, '소스1 출력폴더 무변경');
    eq(fingerprintDir(OUT2), FP2, '소스2 출력폴더 무변경');

    // 게이트 통과 조건(F3) — .vrew 게이트는 절대경로 실존만 본다
    ok(pr.sentences.every((s) => fs.existsSync(s.ttsAudioPath)), '.vrew 음성 게이트 통과(전 문장 파일 실존)');
    const missVisual = pr.groups.filter((g) => g.imagePrompt && !(g.imagePath && fs.existsSync(g.imagePath)) && !(g.videoPath && fs.existsSync(g.videoPath)));
    eq(missVisual.length, 1, '이미지 게이트는 미생성 1개를 정확히 지목한다');

    // 재실행 안전성 — 같은 결과가 나와야 한다(멱등)
    const r2 = await MA.copyIntoWorkdirs(pr, sm, gm, dirs, { probeDur: async () => 1.23 });
    eq(r2.audio, 9, '재실행해도 음성 9개(멱등)');
    eq(fingerprintDir(OUT1), FP1, '재실행 후에도 원본 무변경');
  };
  copied = run();
}

// ═══ [7] 스냅샷 없는 소스 → 번호 폴백 ════════════════════
async function section7() {
  sect('[7] 스냅샷이 없는 소스 — 문장 번호 폴백');
  const NS_NAME = '[T_0404] 스냅샷없음';
  const NS_MD = W(path.join(SRC_DIR, NS_NAME + '.md'), [
    '# 스냅샷없음', '', '## 본문', '', '### 하나', '가나다라입니다.', '마바사아입니다.', '',
    '> 🖼️ 이미지: no snapshot image', '',
  ].join('\n'));
  const NSOUT = makeOut(NS_NAME, 2, ['01.png'], []);
  const merged = W(path.join(SRC_DIR, '[T_0405] 통합 폴백.md'), [
    '# 통합 폴백', '', `> 📥 자산출처: ${NS_MD} | ${NSOUT}`, '',
    '## 본문', '', '### 하나', '가나다라입니다.', '마바사아입니다.', '', '> 🖼️ 이미지: no snapshot image', '',
  ].join('\n'));
  const i2 = MA.buildSourceIndex(MA.parseAssetSources(fs.readFileSync(merged, 'utf8')), parseSource, { projDir: PROJ_DIR });
  eq(i2.srcStats[0].snapshot, null, '스냅샷 없음');
  eq(i2.srcStats[0].audio, 2, '문장 번호로 음성 2개를 찾았다');
  ok(i2.srcStats[0].warnings.some((w) => /스냅샷 없음/.test(w)), '스냅샷 없음을 경고로 알린다');
  const mpr = P.parseScript(merged, 'longform', TH).projects[0];
  const msm = MA.matchSentences(mpr.sentences, i2);
  eq(msm.filter((m) => m && m.file).length, 2, '폴백으로도 2/2 매칭');
  ok(msm.every((m) => m.dur === null), '폴백은 길이를 모른다 → 복사 때 실측');
  // 길이를 못 재면 **연결하지 않는다**(함정 ② — 길이 없이 넘기면 타임라인이 깨진다)
  const dirs = { tts: path.join(TMP, 'fb', 'tts-1'), media: path.join(TMP, 'fb', 'media-1') };
  const r = await MA.copyIntoWorkdirs(mpr, msm, MA.matchGroups(mpr.groups, i2), dirs, { probeDur: async () => null });
  eq(r.audio, 0, '길이를 못 재면 연결 0');
  eq(r.noDuration.length, 2, '길이 미확보 2개를 보고한다');
  ok(mpr.sentences.every((s) => !s.ttsAudioPath), '길이 없는 음성은 경로도 안 붙인다 → 새로 합성된다');

  // 번호 폴백 안전장치 — 합성 뒤 재분할돼 번호가 밀린 스냅샷에서는 폴백을 쓰지 않는다
  sect('[7b] 번호 폴백 안전장치 — 번호가 밀린 스냅샷');
  const SH_NAME = '[T_0501] 번호밀림';
  const SHOUT = makeOut(SH_NAME, 3, [], []);
  const SH_MD = W(path.join(SRC_DIR, SH_NAME + '.md'), ['# 번호밀림', '', '## 본문', '', '### 하나', '첫째 문장입니다.', '둘째 문장입니다.', ''].join('\n'));
  writeSnap(SH_NAME, SH_MD, [
    snapGroup(1, null, null, null, [
      { text: '첫째 문장입니다.', ttsAudioPath: path.join(SHOUT, 'tts-1', '3.wav'), ttsDurationSec: 1 },  // 번호가 밀림(1 이 아니라 3)
      { text: '둘째 문장입니다.', ttsAudioPath: null, ttsDurationSec: null },
    ]),
  ]);
  const i3 = MA.buildSourceIndex([{ scriptPath: SH_MD, outDir: SHOUT }], parseSource, { projDir: PROJ_DIR });
  eq(i3.srcStats[0].audioByNum, 0, '번호가 밀린 스냅샷에서는 번호 폴백을 쓰지 않는다(엉뚱한 음성 방지)');
  eq(i3.srcStats[0].audio, 1, '기록된 경로 1개만 사용');
}

// ═══ [8] 배선 원문 대조 ══════════════════════════════════
function section8() {
  sect('[8] 배선 대조 (main.js · preload.js · App.jsx 원문)');
  const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const PRE = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  const APP = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'App.jsx'), 'utf8');
  const PIPE = fs.readFileSync(path.join(ROOT, 'core', 'pipeline.js'), 'utf8');

  ok(/const MERGE_MIN_RATE = 0\.95/.test(MAIN), 'main.js 에 매칭률 게이트 상수(0.95)');
  // A/B 역검증의 핵심 — 게이트가 사라지면 이 단언이 깨진다.
  ok(/rate < MERGE_MIN_RATE && !o\.confirmed[\s\S]{0,120}needsConfirm: true/.test(MAIN),
    '게이트: 매칭률 미달이면 needsConfirm 으로 멈춘다 (이게 없으면 오탈자가 수 시간 재합성으로 이어진다)');
  ok(/needsConfirm[\s\S]{0,900}showMessageBox/.test(MAIN), '게이트 미달이면 팝업으로 미매칭 목록을 보여준다');
  ok(/ipcMain\.handle\('merge-prefill'/.test(MAIN), 'main.js IPC merge-prefill');
  ok(/withAwake\('자산 이어받기'/.test(MAIN), '이어받기는 절전 차단으로 감싼다(수천 건 복사)');
  ok(/scriptHasAssetSources\(S\.scriptPath\)/.test(MAIN), 'open-script 가 자산출처를 감지한다(자동 실행)');
  ok(/probeDur/.test(MAIN) && /getMediaDuration/.test(MAIN), 'main 이 ffprobe 로 길이를 실측해 넘긴다(함정 ②)');
  ok(/P\.retryFs\(fn, what, log/.test(MAIN), '복사는 retryFs 로 감싼다(G: 일시 언마운트 대비)');
  ok(/parsed\.mergeSources = require\('\.\/core\/merge-assets'\)/.test(MAIN), 'buildParsedForScript 가 mergeSources 를 싣는다');
  ok(/mergeSources: parseResult\.mergeSources \|\| 0/.test(PIPE), 'toDTO 가 mergeSources 를 내보낸다');
  ok(/mergePrefill: \(\) => ipcRenderer\.invoke\('merge-prefill'\)/.test(PRE), 'preload 에 mergePrefill');
  ok(/api\.mergePrefill\(\)/.test(APP), 'App.jsx 가 mergePrefill 을 호출');
  ok(/mergeSources > 0 &&[\s\S]{0,200}📥 이어받기/.test(APP), '📥 이어받기 버튼은 자산출처가 있을 때만 보인다');
  ok(/const mergeSources = \(dto && dto\.mergeSources\) \|\| 0/.test(APP), 'App.jsx 가 DTO 에서 mergeSources 를 읽는다');

  // 이어받기가 기존 경로를 건드리지 않았는지 — fillTtsList 의 '있으면 건너뜀'(F1)이 그대로 있어야 성립한다.
  ok(/if \(!force && s\.ttsAudioPath && fs\.existsSync\(s\.ttsAudioPath\)\)/.test(PIPE),
    'fillTtsList 의 「음성이 있으면 건너뜀」이 유지된다(이어받기가 성립하는 전제 F1)');
}

// ═══ [9] 실데이터 회귀(§7-0) — 있을 때만 ════════════════
function section9() {
  const REAL = 'D:\\## 아도나이로이\\01_고전\\02_고전서재\\대본\\_통합본\\[서재_0822] 빨간머리앤 통합본 1 · 1~5부.md';
  if (!fs.existsSync(REAL)) { console.log('\n[9] 실데이터 회귀 — 통합대본이 없어 건너뜀(다른 PC)'); return; }
  sect('[9] 실데이터 회귀 (§7-0 기대값: 문장 4182/4182 · 이미지 80/150 · 비디오 6)');
  const preset = P.getPreset('06_고전서재');
  if (!preset) { console.log('  (채널 06_고전서재 없음 — 건너뜀)'); return; }
  const th = { introSentenceSize: preset.introSentenceSize, mainSentenceSize: preset.mainSentenceSize,
    shortLen: preset.shortLen, longLen: preset.longLen, splitMode: preset.splitMode };
  const ps = (p) => { const q = P.parseScript(p, 'longform', th).projects[0]; return { sentences: q.sentences, groups: q.groups }; };
  const sources = MA.parseAssetSources(fs.readFileSync(REAL, 'utf8'));
  if (!sources.every((s) => s.outDir && fs.existsSync(s.outDir))) { console.log('  (소스 출력폴더(G:) 미연결 — 건너뜀)'); return; }
  const rp = P.parseScript(REAL, 'longform', th).projects[0];
  const ix = MA.buildSourceIndex(sources, ps, {});
  const s = MA.matchSentences(rp.sentences, ix), g = MA.matchGroups(rp.groups, ix);
  const r = MA.buildReport(rp, s, g, ix);
  eq(r.sentences.total, 4182, '실데이터 통합대본 문장 4182');
  eq(r.sentences.matched, 4182, '실데이터 문장 100% 매칭');
  eq(r.groups.withPrompt, 150, '실데이터 프롬프트 그룹 150');
  eq(r.groups.imageMatched, 80, '실데이터 이미지 80 매칭');
  eq(r.groups.videoMatched, 6, '실데이터 비디오 6 매칭');
  ok(s.every((m) => !m || m.file), '매칭된 항목은 전부 파일을 갖는다');
}

// ── 실행 ────────────────────────────────────────────────
(async () => {
  await copied;
  await section7();
  section8();
  section9();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  console.log(`\n${bad === 0 ? '✅' : '❌'} merge-assets: ${n - bad}/${n} 통과`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
