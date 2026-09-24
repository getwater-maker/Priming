// ⤒ 그룹 합치기 · 「> 🖼️ 이미지: 이어서」 (2026-09-24 로이 「어디부터 어디까지 같은 그림」)
//   node test/group-merge.test.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GM = require('../core/group-merge');
const P = require('../core/pipeline');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

console.log('\n[1] 표식 판정');
for (const t of ['이어서', '(이어서)', '（이어서）', ' 앞과 같음 ', '앞 그림', '↑', 'continue', 'SAME', '이어서.', '[계속]'])
  ok(GM.isContinueMarker(t), `「${t}」 = 이어서`);
for (const t of ['a red boat 이어서 흐르는 강', '', null, 'continue the river scene', '이어서 걷는 사람'])
  ok(!GM.isContinueMarker(t), `「${t}」 는 표식이 아니다(진짜 프롬프트)`);

const SRC = [
  '# 테스트 대본',
  '## 1장 시작',
  '### 첫 장면',
  '> 🖼️ 이미지: a red boat on a river',
  '첫 문장입니다. 둘째 문장입니다.',
  '### 둘째 장면',
  '> 🖼️ 이미지: 이어서',
  '셋째 문장입니다.',
  '## 2장 전개',
  '### 셋째 장면',
  '> 🖼️ 이미지: (이어서)',
  '넷째 문장입니다.',
  '### 넷째 장면',
  '> 🖼️ 이미지: a quiet mountain',
  '다섯째 문장입니다.',
].join('\n');

console.log('\n[2] 대본 표식 → 파싱 때 앞 그룹에 합친다');
const r = P.parseScriptText(SRC, 'longform', {});
const pr = r.projects[0];
ok(pr.groups.length === 2, `H3 4개 · 이어서 2곳 → 그룹 2개 (실제 ${pr.groups.length})`);
const g1 = pr.groups[0];
const s1 = pr.getSentencesOfGroup(g1).map((s) => s.text);
ok(s1.length === 4 && s1[0].startsWith('첫') && s1[3].startsWith('넷째'), `G1 = 문장 4개 순서 그대로 (${s1.join(' / ')})`);
ok(g1.imagePrompt === 'a red boat on a river', 'G1 그림 = 첫 장면 프롬프트(표식이 프롬프트로 새지 않는다)');
ok(pr.groups[1].imagePrompt === 'a quiet mountain', 'G2 = 넷째 장면 그대로');
ok(pr.sentences.length === 5, '문장 수 그대로 5');
const sg = pr.getSentencesOfGroup(g1);
ok(!sg[0].chapterMark && sg[2].chapterMark && sg[2].chapterMark.phase === '둘째 장면', '둘째 장면 첫 문장에 챕터 표식');
ok(sg[3].chapterMark && sg[3].chapterMark.h2 && /2장/.test(sg[3].chapterMark.h2), '2장(H2) 경계도 표식에 남는다');
ok(pr.continueInfo && pr.continueInfo.merged === 2 && pr.continueInfo.skipped.length === 0, 'continueInfo merged 2');
ok(pr.groups.map((g) => g.num).join(',') === '1,2', '번호 재발번호');
ok(pr.sentences.every((s) => pr.groups.some((g) => g.id === s.groupId)), 'sentence.groupId 정합(finalizeGroupIds)');

console.log('\n[3] 표식 없는 대본은 그대로(레거시 무영향)');
const r0 = P.parseScriptText(SRC.replace(/> 🖼️ 이미지: \(?이어서\)?/g, '> 🖼️ 이미지: x'), 'longform', {});
ok(r0.projects[0].groups.length === 4, '그룹 4개 그대로');
ok(r0.projects[0].continueInfo.merged === 0, 'merged 0');
const r1 = P.parseScriptText(SRC.replace('> 🖼️ 이미지: a red boat on a river', '> 🖼️ 이미지: 이어서'), 'longform', {});
ok(r1.projects[0].continueInfo.skipped.some((k) => k.reason === 'no-prev'), '첫 그룹의 표식은 적용 못 함(no-prev)');
ok(!r1.projects[0].groups[0].imagePrompt, '적용 못 한 표식은 지운다(「이어서」를 그리지 않게)');

console.log('\n[4] mergeIntoPrev — 앞 그룹이 이긴다 · 없을 때만 가져온다 · 도입부 경계 거부');
const { Group, Sentence, Project, finalizeGroupIds } = require('../core/project-model');
function mk(defs) {
  const sentences = [], groups = [];
  defs.forEach((d, gi) => {
    const g = new Group({ num: gi + 1, sentenceIds: [] });
    Object.assign(g, d.g);
    d.s.forEach((t) => { const s = new Sentence({ id: 's' + sentences.length, num: sentences.length + 1, text: t }); g.sentenceIds.push(s.id); sentences.push(s); });
    groups.push(g);
  });
  finalizeGroupIds(groups, sentences);
  return new Project({ sentences, groups });
}
let p = mk([{ g: { imagePrompt: 'A', imagePath: 'a.png', phase: 'p1' }, s: ['a1'] }, { g: { imagePrompt: 'B', imagePath: 'b.png', videoPrompt: 'V', phase: 'p2' }, s: ['b1', 'b2'] }]);
let m = GM.mergeIntoPrev(p, 1);
ok(m.ok && p.groups.length === 1, '합쳐짐');
ok(p.groups[0].imagePrompt === 'A' && p.groups[0].imagePath === 'a.png', '앞 그림·프롬프트 유지');
ok(p.groups[0].videoPrompt === 'V' && p.groups[0].isI2V, '앞에 영상 프롬프트가 없으면 뒤 것을 가져온다');
p = mk([{ g: { phase: 'p1' }, s: ['a1'] }, { g: { imagePrompt: 'B', imagePath: 'b.png', phase: 'p2' }, s: ['b1'] }]);
GM.mergeIntoPrev(p, 1);
ok(p.groups[0].imagePrompt === 'B' && p.groups[0].imagePath === 'b.png', '앞 그룹에 그림이 없으면 뒤 그림을 쓴다');
p = mk([{ g: { isIntro: true }, s: ['a1'] }, { g: { isIntro: false }, s: ['b1'] }]);
ok(GM.mergeIntoPrev(p, 1).reason === 'cross-intro' && p.groups.length === 2, '도입부↔본론은 거부(아무것도 안 바꾼다)');
ok(GM.mergeIntoPrev(p, 0).reason === 'no-prev', '첫 그룹은 no-prev');

console.log('\n[5] DTO · 타임스탬프 — 합친 그룹 안에서 챕터가 갈린다');
const dto = P.toDTO(r);
const c1 = dto.projects[0].cuts[0];
ok(c1.sentences[2].mark && c1.sentences[2].mark.phase === '둘째 장면', 'DTO sentences[].mark');
// 렌더러 원문에서 타임스탬프 함수를 뽑아 실행
const APP = read('core/yt-chapters.js');   // 정본(App.jsx 가 import 한다 — 2026-09-24)
const pick = (name) => { const i = APP.indexOf('function ' + name + '('); let d = 0, j = APP.indexOf('{', i); for (let k = j; k < APP.length; k++) { if (APP[k] === '{') d++; else if (APP[k] === '}') { d--; if (!d) return APP.slice(i, k + 1); } } return ''; };
const tsChaptersOf = new Function(pick('tsFmt') + pick('tsCleanTitle') + pick('tsChaptersOf') + '; return tsChaptersOf;')();
c1.sentences.forEach((s) => { s.dur = 5; }); c1.groupDurationSec = 20;
const c2 = dto.projects[0].cuts[1]; c2.sentences.forEach((s) => { s.dur = 5; }); c2.groupDurationSec = 5;
const chs = tsChaptersOf(dto.projects[0]);
ok(chs.length === 2 && chs[0].dur === 15 && chs[1].start === 15 && chs[1].dur === 10, `H2 챕터 2개 · 2장이 15초에서 시작 (${JSON.stringify(chs.map((x) => [x.start, x.dur, x.title]))})`);
const noMark = { cuts: [{ h2: 'A', phase: 'x', groupDurationSec: 3, sentences: [{ dur: 3 }] }, { h2: 'B', phase: 'y', groupDurationSec: 4, sentences: [{ dur: 4 }] }] };
ok(JSON.stringify(tsChaptersOf(noMark).map((x) => [x.start, x.dur])) === '[[0,3],[3,4]]', '표식 없는 대본은 옛 계산 그대로');

console.log('\n[6] 배선');
const MAIN = read('main.js'), PRE = read('preload.js');
ok(/ipcMain\.handle\('merge-group'/.test(MAIN) && /require\('\.\/core\/group-merge'\)\.mergeIntoPrev\(pr, idx\)/.test(MAIN), 'IPC merge-group → 공용 mergeIntoPrev');
ok(/mergeGroup: \(args\) => ipcRenderer\.invoke\('merge-group', args\)/.test(PRE), 'preload mergeGroup');
ok(/if \(_inDir\(f, mediaDir\)\)/.test(MAIN), '🔴 버리는 파일은 media-N 안의 것만 지운다(사용자 첨부 원본 보존)');
ok(/applyContinueMarkers\(proj\)/.test(read('core/parsers/longform-parser.js')), '파서가 표식을 적용한다');
ok(/chapterMark: s\.chapterMark \|\| null/.test(MAIN) && /if \(ss\.chapterMark\) s\.chapterMark = ss\.chapterMark/.test(MAIN), '스냅샷에 챕터 표식 저장·복원(재시작해도 챕터 유지)');
ok(/if \(ti === 0 && old\[0\]\.chapterMark\) s\.chapterMark = old\[0\]\.chapterMark/.test(MAIN), '문장 편집 뒤에도 표식이 첫 문장을 따라간다');
const APPJSX = read('renderer/src/App.jsx');   // (APP 는 챕터 정본 core/yt-chapters.js — 화면 단언은 App.jsx 로)
ok(/onMerge=\{mergeGroup\}/.test(APPJSX) && /c\.num > 1 && onMerge/.test(APPJSX), '화면 ⤒ 버튼(첫 그룹엔 없음)');
ok(/mark: s\.chapterMark \|\| null/.test(read('core/pipeline.js')), 'DTO 에 mark');
ok(!/require\(['"]electron['"]\)/.test(read('core/group-merge.js')), 'core 는 Electron 을 모른다');

console.log(`\n${fail ? '❌' : '✅'} group-merge ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
