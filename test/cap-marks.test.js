'use strict';
// ✂🤖 자막 끊어 읽기(Claude) — core/cap-marks + caption-splitter marks (v0.7.23)
//   진짜 Claude 를 부르지 않는다(test/fixtures/fake-claude.js) · 기억 파일은 임시 폴더.
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'capmarks-'));
process.env.PM_CAPMARKS_FILE = path.join(TMP, 'cap-marks.json');
const FAKE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const CM = require('../core/cap-marks');
const CS = require('../core/caption-splitter');

let pass = 0; const fails = [];
const ok = (c, n) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fails.push(n); console.log('  ✗ ' + n); } };

(async () => {
  // [1] 줄 나누기가 끊어 읽기 자리를 따른다
  const T = '방앗간 마당으로 뛰어든 젊은 짐꾼은 등에 진 빈 지게가 기둥에 부딪혀 덜컹 소리를 내는데도';
  const rule = CS.splitCaptionLines(T, 20);
  const ai = CS.splitCaptionLines(T, 20, null, { t: T, w: [5, 11] });
  ok(rule[0].endsWith('등에'), `(판정력) 규칙만이면 「등에 | 진」으로 가른다 (${rule.join(' / ')})`);
  ok(ai.join(' / ') === '방앗간 마당으로 뛰어든 젊은 짐꾼은 / 등에 진 빈 지게가 기둥에 부딪혀 / 덜컹 소리를 내는데도', `자리를 주면 그 자리에서만 (${ai.join(' / ')})`);
  ok(JSON.stringify(CS.splitCaptionLines(T, 20, null, { t: T + ' 고침', w: [5, 11] })) === JSON.stringify(rule), '글이 다르면(문장을 고쳤으면) 표시를 무시 — 규칙대로');
  ok(JSON.stringify(CS.splitCaptionLines(T, 20, [10], { t: T, w: [5, 11] })) === JSON.stringify(CS.splitCaptionLines(T, 20, [10])), '사람이 ✂ 로 정한 줄이 이긴다');
  ok(CS.splitCaptionLines(T, 20, null, { t: T, w: [5, 11] }).every((l) => CS.meaningfulLen(l.replace(/\s/g, '')) <= 20), '줄 길이(20자)는 코드가 지킨다');
  const two = '짧은 덩어리 하나 / 둘'.replace(' / ', ' ');
  ok(CS.splitCaptionLines(two, 20, null, { t: two, w: [3] }).length === 1, '한 줄에 들어가면 자리가 있어도 붙인다(잘게 쪼개지 않는다)');

  // [2] 답 읽기 — 글자를 바꾼 줄은 버린다
  const B = ['가나 다라 마바', '사아 자차 카타'];
  const g = CM.parseReply('1\t가나 / 다라 마바\n2\t사아 자차 / 카X', B);
  ok(g.get(0) && g.get(0).join() === '1' && !g.has(1), '답 읽기 — 맞는 줄은 어절 번호로 · 글자를 바꾼 줄은 버린다');
  ok(CM.parseReply('그냥 설명입니다', B).size === 0, '목록 모양이 아니면 아무것도 안 쓴다');

  // [3] 고를 문장 — 한국어 · 기준보다 긺 · 기억 없음 · ✂ 없음
  const S = [
    { text: '오래전 이 땅에 살았던 사람들의 이야기를, 차분한 목소리로 하나씩 풀어 보겠습니다.' },
    { text: '짧은 문장입니다.' },
    { text: 'This is an English sentence that is quite long indeed for captions.' },
    { text: '사람이 손으로 줄을 정한 아주 긴 문장은 다시 묻지 않습니다 그대로 둡니다.', capBreaks: [10] },
    { text: '장터 쪽에서 도둑 잡아라 하는 소리가 골목을 타고 점점 가까워졌습니다.' },
    { text: '장터 쪽에서 도둑 잡아라 하는 소리가 골목을 타고 점점 가까워졌습니다.' },
  ];
  const need = CM.needs(S, 20);
  ok(need.length === 2, `물을 문장 2개(짧음·영어·✂·중복 제외) (${need.length})`);

  // [4] 가짜 claude 로 돌리기 → 기억 → 두 번째는 묻지 않는다
  const LOG = path.join(TMP, 'calls.log'); process.env.FAKE_CLAUDE_CAPMARKS_LOG = LOG;
  const r = await CM.run(need, { exe: FAKE });
  ok(r.done === 2 && !r.failed, `가짜 claude → 2문장 받음 (${JSON.stringify(r)})`);
  ok(fs.existsSync(process.env.PM_CAPMARKS_FILE), '기억 파일에 썼다');
  CM._reset();
  const n = CM.attach(S);
  ok(n === 3 && S[0].capMarks && S[0].capMarks.t === S[0].text.trim() && S[0].capMarks.w.length > 0, `다시 읽어도 붙는다(같은 문장 둘 포함 3개) (${n})`);
  ok(CM.needs(S, 20).length === 0, '기억에 있으면 다시 묻지 않는다(다시 열기 = 0 토큰)');
  ok(fs.readFileSync(LOG, 'utf8').trim().split('\n').length === 1, 'claude 를 한 번만 불렀다');
  const L0 = CS.splitCaptionLines(S[0].text, 20, null, S[0].capMarks);
  ok(L0.join(' ').split(' ').length === S[0].text.split(' ').length && L0.every((l) => CS.meaningfulLen(l.replace(/\s/g, '')) <= 20), `붙인 자리로 줄 나누기 (${L0.join(' / ')})`);
  S[0].text = S[0].text.replace('차분한', '조용한');
  CM.attach(S);
  ok(!S[0].capMarks, '문장을 고치면 낡은 표시를 뗀다');

  // [4b] 🧩 2차 — 1차 덩어리가 한 줄보다 길면 그 덩어리만 다시 묻고, 그 안 자리를 합친다(v0.7.25 · 「등에 | 진」 재발)
  {
    const L = '가나다라마 바사아자차 카타파하가 나다라마바 사아자차카 타파하가나 다라마바사 아자차카타';   // 어절 8 · 1차(가짜) = 4어절씩 = 20자 덩어리 둘
    const SS = [{ text: L }];
    await CM.run(CM.needs(SS, 12), { exe: FAKE });
    const base = CM.lookup(L);
    ok(base && base.w.join() === '4' && CM.longChunks(L, base.w, 12).length === 2, `1차 덩어리 2개가 모두 한 줄(12자)보다 길다 (${base && base.w})`);
    const inner = CM.needsInner(SS, 12);
    ok(inner.length === 2, `2차로 물을 덩어리 2개 (${inner.length})`);
    const r4 = await CM.runInner(inner, 12, { exe: FAKE });
    ok(r4.done === 2, `2차 받음 (${JSON.stringify(r4)})`);
    ok(CM.needsInner(SS, 12).length === 0, '2차도 기억 — 다시 묻지 않는다');
    const m = CM.lookup(L, 12);
    ok(m.w.join() === '2,4,6', `1차 + 2차 자리를 합친다 (${m.w})`);
    ok(CM.lookup(L).w.join() === '4' && CM.lookup(L, 20).w.join() === '4', '2차 자리는 그 글자 수(12) 기준일 때만 — 다른 기준이면 1차만');
    const lines = CS.splitCaptionLines(L, 12, null, m);
    ok(lines.length === 4 && lines.every((x) => x.split(' ').length === 2), `줄 = 2차 자리대로 (${lines.join(' / ')})`);
    const ruleOnly = CS.splitCaptionLines(L, 12, null, base);
    ok(ruleOnly.join('|') !== '' && CM.attach(SS, 12) === 1 && SS[0].capMarks.w.join() === '2,4,6', '붙이기도 2차까지(max 를 넘기면)');
  }

  // [5] 글자를 바꾼 답은 버린다(규칙대로)
  process.env.FAKE_CLAUDE_CAPMARKS_BAD = '1';
  const r2 = await CM.run(['첫째 문장은 아주 길어서 줄을 나눠야 하는 문장입니다 정말로.', '둘째 문장도 아주 길어서 줄을 나눠야 하는 문장입니다 정말로.'], { exe: FAKE });
  delete process.env.FAKE_CLAUDE_CAPMARKS_BAD;
  ok(r2.done === 1 && r2.failed === 1, `글자를 바꾼 답 1개는 버림 (${JSON.stringify(r2)})`);

  // [6] claude 가 없는 PC — 오류로 알리고 막지 않는다
  const r3 = await CM.run(['셋째 문장은 아주 길어서 줄을 나눠야 하는 문장입니다 정말로.'], { exe: path.join(TMP, 'no-claude.exe') });
  ok(r3.done === 0 && r3.error, `claude 실행 실패 → 오류 한 줄 (${r3.error})`);

  // [7] 배선 — 줄 나누기 부르는 곳이 모두 표시를 넘긴다 · 출력 두 경로가 기다린다(같은 일 여러 곳 방지)
  const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const coreCalls = [['core/pipeline.js', 2], ['core/remotion-export.js', 1], ['vrew/vrew-builder.js', 1], ['core/whiteboard-subtitle.js', 1]];
  for (const [f, k] of coreCalls) {
    const calls = (src(f).match(/^.*splitCaptionLines\(.*$/gm) || []).filter((l) => !/^\s*(\/\/|\*)/.test(l) && !/function splitCaptionLines|require\(|\{ splitCaptionLines/.test(l));
    ok(calls.length === k && calls.every((c) => /capMarks|marks\)/.test(c)), `${f}: 줄 나누기 ${k}곳 모두 끊어 읽기 표시를 넘긴다`);
  }
  for (const f of ['renderer/src/App.jsx', 'renderer/src/Workspace.jsx']) {
    const calls = src(f).match(/splitLines\([^)]*\)/g) || [];
    ok(calls.length >= 1 && calls.every((c) => /\.marks\)/.test(c)), `${f}: splitLines ${calls.length}곳 모두 marks`);
  }
  const M = src('main.js');
  ok((M.match(/await capMarksEnsure\(parsed\)/g) || []).length === 2, '⚡ 만들기 4단계 · 💾 .vrew 두 경로 모두 끊어 읽기를 기다린다');
  ok(/function scheduleAutoSave\(\) \{\s*if \(!S\.parsed\) return;\s*capMarksKick\(\);/.test(M), '데이터가 바뀌면(열기·고치기) 끊어 읽기를 예약');
  ok(/PM_UI_SMOKE && !process\.env\.PM_CLAUDE_EXE/.test(M), '⛔ E2E 는 가짜 claude 없이 부르지 않는다');
  ok(!/haiku/.test(src('core/cap-marks.js').replace(/⛔ haiku[^\n]*/g, '')), '⛔ haiku 안 씀');

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log(fails.length ? `\n✗ cap-marks: ${pass} 통과 · ${fails.length} 실패` : `\n✓ cap-marks: ${pass} 통과`);
  process.exit(fails.length ? 1 : 0);
})();
