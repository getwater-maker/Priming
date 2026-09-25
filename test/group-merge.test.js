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

console.log('\n[7] 🖼 적용 범위 — 그림 범위 = 그룹 경계 (Vrew 「적용 범위 변경」 · 막대 끌기)');
{
  const { Group } = require('../core/project-model');
  const mk = () => {
    const sentences = [], groups = []; let k = 0;
    [[3, 'A'], [2, 'B'], [4, 'C'], [2, 'D']].forEach(([cnt, t], gi) => {
      const ids = []; for (let i = 0; i < cnt; i++) { const id = 's' + (k++); sentences.push({ id, text: id }); ids.push(id); }
      const g = new Group({ num: gi + 1, sentenceIds: ids }); g.phase = t; g.title = t; g.h2Title = 'H' + t; g.imagePath = 'img' + t; g.imagePrompt = 'p' + t; g.isIntro = gi === 0; groups.push(g);
    });
    return { groups, sentences };
  };
  const ids = (p) => p.groups.map((g) => g.sentenceIds.join(','));
  const mark = (p, id) => { const s = p.sentences.find((x) => x.id === id); return s.chapterMark ? s.chapterMark.phase : null; };
  const chap = (p) => require('../core/yt-chapters').tsChaptersOf({ cuts: p.groups.map((g) => ({ h2: g.h2Title, phase: g.phase, groupDurationSec: g.sentenceIds.length, sentences: g.sentenceIds.map((id) => { const s = p.sentences.find((x) => x.id === id); return { dur: 1, mark: s.chapterMark || null }; }) })) }).map((c) => `${c.title}@${c.start}`).join(' ');
  const CH0 = 'HA@0 HB@3 HC@5 HD@9';

  let p = mk(); let r = GM.setVisualRange(p, 0, 0, 10);
  ok(r.ok && p.groups.length === 1 && p.groups[0].imagePath === 'imgA', '「전체 클립으로」 = 그룹 1개 · 그림은 범위 주인(A) 것');
  ok(r.removed.length === 3, '통째로 덮인 그룹 3개를 돌려준다(main 이 그 그림 파일을 정리)');
  ok(p.groups[0].isIntro === true, '🔑 도입부·본론 경계를 넘는다(결정 2ⓐ) — 도입부 여부는 범위 주인을 따른다');
  ok(chap(p) === CH0, `🔑 챕터 그대로 (${chap(p)})`);

  p = mk(); GM.setVisualRange(p, 1, 3, 6);
  ok(ids(p).join(' | ') === 's0,s1,s2 | s3,s4,s5,s6 | s7,s8 | s9,s10', `끝을 아래로 끌기 — 다음 그룹 앞 두 문장을 덮는다 (${ids(p).join(' | ')})`);
  ok(p.groups[2].imagePath === 'imgC' && p.groups[2].imagePrompt === 'pC', '앞부분을 잃은 이웃 그룹은 자기 그림·프롬프트를 그대로 쓴다(Vrew 처럼 이웃 범위가 줄어든다)');
  ok(mark(p, 's5') === 'C' && chap(p) === CH0, '덮인 섹션 머리에 챕터 표식 · 챕터 시각 그대로');

  p = mk(); GM.setVisualRange(p, 2, 6, 6);
  ok(ids(p).join(' | ') === 's0,s1,s2 | s3,s4 | s5 | s6 | s7,s8 | s9,s10', '범위를 가운데 한 문장으로 줄이기 — 앞뒤가 새 그룹');
  ok(!p.groups[2].imagePath && p.groups[2].imageStale && !p.groups[2].imagePrompt && !p.groups[4].imagePath && p.groups[4].imageStale, '🔑 떨어져 나간 문장 = 새 이미지 필요 그룹(결정 1ⓐ · 그림·프롬프트 없음)');
  ok(p.groups[3].imagePath === 'imgC', '범위 안(s6)은 원래 그림');
  ok(chap(p) === CH0, '줄여도 챕터 그대로');

  p = mk(); GM.setVisualRange(p, 2, 1, 7);
  ok(ids(p).join(' | ') === 's0 | s1,s2,s3,s4,s5,s6,s7 | s8 | s9,s10', '시작을 위로 끌기 + 끝 줄이기 동시(직접 입력)');
  ok(p.groups[0].imagePath === 'imgA' && p.groups[1].imagePath === 'imgC' && p.groups[1].phase === 'A', '머리를 넓히면 그 머리의 섹션 제목을 물려받는다');
  ok(chap(p) === CH0, `넓혀도 챕터 그대로 (${chap(p)})`);

  p = mk(); GM.setVisualRange(p, 0, 0, 10); GM.setVisualRange(p, 0, 0, 4);
  ok(ids(p).join(' | ') === 's0,s1,s2,s3,s4 | s5,s6,s7,s8,s9,s10' && p.groups[1].imageStale, '넓혔다 다시 줄이기 — 떨어진 뒤쪽은 새 이미지 필요');
  ok(chap(p) === CH0, '넓혔다 줄여도 챕터 그대로');

  p = mk();
  ok(GM.setVisualRange(p, 0, 5, 8).reason === 'no-overlap', '원래 문장과 겹치지 않는 범위는 거부(이웃이 둘로 쪼개지는 것 방지)');
  ok(GM.setVisualRange(p, 0, 0, 99).reason === 'bad-range' && GM.setVisualRange(p, 0, 3, 1).reason === 'bad-range', '범위 밖·뒤집힌 범위 거부');
  ok(GM.setVisualRange(p, 1, 3, 4).unchanged === true && p.groups.length === 4, '그대로면 아무것도 안 바꾼다');
  ok(p.groups.every((g, i) => g.num === i + 1), '그룹 번호 다시 매김');

  const MAIN7 = read('main.js'), PRE7 = read('preload.js'), APP7 = read('renderer/src/App.jsx');
  ok(/ipcMain\.handle\('set-visual-range'/.test(MAIN7) && /setVisualRange\(pr, idx, Number\(args\.from\) - 1, Number\(args\.to\) - 1\)/.test(MAIN7), 'IPC set-visual-range → 공용 setVisualRange(1부터 → 0부터)');
  ok(/for \(const g of r\.removed\)[\s\S]{0,200}_inDir\(f, mediaDir\)/.test(MAIN7), '🔴 덮여 사라진 그룹 파일은 media-N 안의 것만 지운다');
  ok(/!\(g\.imagePrompt && String\(g\.imagePrompt\)\.trim\(\)\) && !g\.imageStale\) return false/.test(MAIN7), '🔑 떨어져 나온 그룹(프롬프트 없음)도 그림이 없으면 .vrew 게이트가 막는다');
  ok(/setVisualRange: \(args\) => ipcRenderer\.invoke\('set-visual-range', args\)/.test(PRE7), 'preload setVisualRange');
  ok(/onRange=\{isLf \? setVisualRange : null\}/.test(APP7) && /className="vr-h top"/.test(APP7) && /className="vr-h bot"/.test(APP7), '화면: 범위 막대 손잡이 위·아래');
  ok(/전체 클립으로/.test(APP7) && /처음부터 이 그림 끝까지/.test(APP7) && /이 그림부터 끝까지/.test(APP7) && /직접 입력/.test(APP7), '썸네일 메뉴 — 적용 범위 4가지');
  ok(/통째로 덮여 사라집니다/.test(APP7), '그림이 있는 그룹을 통째로 덮으면 먼저 묻는다');
}

console.log('\n[8] ↶ 되돌리기 — 그림 파일이 제자리로(번호 정리로 이름이 바뀌고 · 합치며 치워진 파일까지)');
{
  // main.js 원문에서 되돌리기 엔진과 번호 정리를 뽑아 **실제 임시 파일로** 돌린다(복사본을 두면 앱과 갈라져도 통과한다)
  const os = require('os'), vm = require('vm');
  const M = read('main.js');
  const a = M.indexOf('const UNDO = {'), b = M.indexOf("ipcMain.handle('undo'");
  const c = M.indexOf('function renumberMediaFiles('), d = M.indexOf('\n}\n', c) + 3;
  ok(a > 0 && b > a && c > b && d > c, '되돌리기 엔진·번호 정리 코드를 찾았다');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-'));
  const media = path.join(tmp, 'media-1'); fs.mkdirSync(media);
  const mk = (n, body) => { const f = path.join(media, n); fs.writeFileSync(f, body); return f; };
  const f1 = mk('01.png', 'AAAA-first'), f2 = mk('02.png', 'BB-second-longer'), f3 = mk('03.png', 'C-third-image-longest');
  const { Group } = require('../core/project-model');
  const gs = [f1, f2, f3].map((f, i) => { const g = new Group({ num: i + 1, sentenceIds: ['s' + i] }); g.imagePath = f; return g; });
  const S = { scriptPath: path.join(tmp, 'x.md'), outRoot: tmp, parsed: { kind: 'longform', projects: [{ shortsNum: 1, groups: gs, sentences: [{ id: 's0' }, { id: 's1' }, { id: 's2' }] }] } };
  const ctx = {
    S, fs, path, structuredClone, console, Date, Math, JSON, Object, Set, Map,
    shortsDirs: () => ({ media }),
    _inDir: (f, dir) => path.resolve(f).toLowerCase().startsWith(path.resolve(dir).toLowerCase() + path.sep),
    scriptHash: () => 'h', log: () => {}, storeActive: () => {}, pushDtoUpdate: () => {},
    ipcMain: { handle: () => {} }, app: { on: () => {} }, P: { toDTO: () => null },
  };
  vm.createContext(ctx);
  vm.runInContext(M.slice(a, b) + M.slice(c, d) + '\nthis.api = { UNDO, undoPush, _toTrash, _restoreState, _captureState, renumberMediaFiles, _undoCheck };', ctx);
  const U = ctx.api;
  const pr = S.parsed.projects[0];
  const st = U.undoPush('그룹 합치기');
  ok(!!st && st.media.length === 3, '바꾸기 직전 — 그림 3개의 신원(크기·수정시각)을 기억');
  // 합치기 흉내: G2 를 G1 에 합치고(G2 그림은 휴지통) → 번호 정리로 03.png 가 02.png 가 된다
  U._toTrash(pr.groups[1].imagePath);
  pr.groups.splice(1, 1); pr.groups.forEach((g, i) => { g.num = i + 1; });
  U.renumberMediaFiles(pr, media);
  ok(fs.readFileSync(path.join(media, '02.png'), 'utf8') === 'C-third-image-longest' && pr.groups[1].imagePath.endsWith('02.png'), '(합친 뒤) 옛 03 그림이 02.png 로 이름이 바뀌었다');
  ok(fs.readdirSync(path.join(tmp, '.priming-undo')).length === 1, '치운 그림은 지우지 않고 휴지통(.priming-undo)으로');
  const back = U._restoreState(st);
  const txt = (n) => fs.readFileSync(path.join(media, n), 'utf8');
  ok(txt('01.png') === 'AAAA-first' && txt('02.png') === 'BB-second-longer' && txt('03.png') === 'C-third-image-longest', `🔑 되돌리면 01·02·03 이 **제 그림**으로 (${back}개 옮김)`);
  ok(pr.groups.length === 3 && pr.groups.map((g) => path.basename(g.imagePath)).join(',') === '01.png,02.png,03.png', '그룹 3개 · 각자 제 파일을 가리킨다');
  ok(Object.getPrototypeOf(pr.groups[0]) === Group.prototype, '되살린 그룹은 Group 그대로(메서드 유지)');
  fs.rmSync(tmp, { recursive: true, force: true });
  const APP8 = read('renderer/src/App.jsx');
  ok(/t\.tagName === 'INPUT' \|\| t\.tagName === 'TEXTAREA'/.test(APP8) && /runUndo\(k === 'y' \|\| \(k === 'z' && ev\.shiftKey\)\)/.test(APP8), 'Ctrl+Z / Ctrl+Y(Ctrl+Shift+Z) — 글자칸 안에서는 그 칸의 되돌리기');
  ok(/undoPush\('문장 고치기', \{ md: true \}\)/.test(M) && /undoPush\('클립 합치기', \{ md: true \}\)/.test(M) && /undoPush\('그림 적용 범위'\)/.test(M) && /undoPush\('그룹 합치기'\)/.test(M) && /undoPush\('그룹 분할'\)/.test(M) && /undoPush\('자막 서식', \{ coalesce: true \}\)/.test(M), '되돌리기가 기억하는 동작 6가지(문장·클립 합치기는 .md 까지)');
  ok(!/fs\.rmSync\(want/.test(M), '번호 정리가 덮이는 파일을 지우지 않고 휴지통으로');
}

console.log(`\n${fail ? '❌' : '✅'} group-merge ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
