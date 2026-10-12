/**
 * v0.8.10 — 🔢 소수점은 문장을 끝내지 않는다
 *
 *   예전: `splitHybrid('보험료가 3.5배였습니다.')` → ['보험료가 3.', '5배였습니다.'] (문장 분할 식이 `[.!?。]+` 뒤에서 무조건 잘랐다)
 *   이제: 숫자 사이의 마침표 하나(3.5 · 1.25% · 0.8)는 문장 안에 남는다. 숫자로 끝나는 문장(「1592년.」·「3. 다음」)은 예전처럼 끝난다.
 *   함께 지키는 것:
 *     ① 화면 편집(core/script-edit)은 같은 분할기로 검증 재파싱한다 → 소수점이 든 대본도 편집이 거부되지 않는다.
 *     ② 옛 작업본(「3.」/「5배…」로 갈린 문장)은 SNAP_HASH_VER 4 로 한 번 다시 가리고, 새로 파싱할 때
 *        **글은 같고 경계만 다른 그룹**은 그림·프롬프트를 이어받는다(소수점 때문에 그림을 새로 뽑지 않는다).
 *   🔑 원문 함수를 그대로 실행한다(복사본 금지).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SS = require(path.join(ROOT, 'core/sentence-splitter'));
const SE = require(path.join(ROOT, 'core/script-edit'));
const GF = require(path.join(ROOT, 'core/group-freshness'));
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label} (기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)})`);
const hy = (t) => SS.splitHybrid(t).items.map((i) => i.text);

console.log('\n[1] 분할 — 소수점은 붙이고, 문장 끝은 그대로');
eq(hy('보험료가 3.5배였습니다.'), ['보험료가 3.5배였습니다.'], '🔴 3.5배 = 한 문장(실사고)');
eq(SS.splitIntoSentences('보험료가 3.5배였습니다.'), ['보험료가 3.5배였습니다.'], 'splitIntoSentences 도 같다');
eq(hy('금리는 1.25%입니다. 0.8배 줄었다.'), ['금리는 1.25%입니다.', '0.8배 줄었다.'], '1.25% · 0.8 — 소수점은 붙이고 문장 끝에서 나눈다');
eq(hy('그해는 1592년. 다음 해였다.'), ['그해는 1592년.', '다음 해였다.'], '「1592년.」 은 문장 끝');
eq(hy('항목은 3. 다음은 4.'), ['항목은 3.', '다음은 4.'], '숫자로 끝나는 문장(3. 뒤 공백)은 끝난다');
eq(hy('합계가 3.5'), ['합계가 3.5'], '문단 끝 소수(부호 없음)도 한 문장');
eq(hy('합계는 3.5. 끝이다.'), ['합계는 3.5.', '끝이다.'], '소수 바로 뒤 마침표는 문장 끝');
eq(hy('숫자 3...5 이다.'), ['숫자 3...', '5 이다.'], '말줄임(...)은 예전처럼 끝난다');
eq(hy('정말 3.5배? 그렇다!'), ['정말 3.5배?', '그렇다!'], '? ! 는 그대로');
eq(hy('버전 1.2.3 입니다.'), ['버전 1.2.3 입니다.'], '숫자.숫자.숫자 도 붙는다');
eq(hy('円は3.5倍だった。次だ。'), ['円は3.5倍だった。', '次だ。'], '🇯🇵 일본어 경로도 같다');
// 판정력 — 예전 식이면 실제로 갈렸는가(헛단언 방지)
eq('보험료가 3.5배였습니다.'.match(/[^.!?。]+[.!?。]+|[^.!?。]+$/g), ['보험료가 3.', '5배였습니다.'], 'A/B: 예전 식은 이 문장을 둘로 갈랐다');
const src = fs.readFileSync(path.join(ROOT, 'core/sentence-splitter.js'), 'utf8');
ok(!/flat\.match\(\/\[\^\.!\?。\]\+\[\.!\?。\]\+/.test(src), '예전 분할 식이 코드에 남아 있지 않다');

console.log('\n[2] 화면 편집 — 소수점 대본도 위치를 찾고 검증 재파싱이 맞는다');
{
  const raw = '# 제목\n\n## 본론\n\n보험료가 3.5배였습니다. 금리는 1.25%입니다.\n\n그해는 1592년. 다음 해였다.\n';
  const texts = SS.splitIntoSentences(raw);
  eq(texts.length, 4, '4문장');
  const locs = SE.locateSentences(raw, texts);
  ok(locs.every(Boolean), '모든 문장의 자리를 찾는다');
  eq(raw.slice(locs[0].start, locs[0].end), '보험료가 3.5배였습니다.', '첫 문장 자리 = 소수 포함 전체');
  for (const [from, nt] of [[0, '보험료가 2.8배로 줄었습니다.'], [1, '금리는 0.75%입니다.'], [3, '다음 해는 1593.5년이었다.']]) {
    const p = SE.planEdit({ raw, texts, from, count: 1, newText: nt });
    ok(p.ok, `편집 계획 성공 (문장 ${from + 1} → 「${nt}」)`);
    if (!p.ok) continue;
    eq(p.newTexts, [nt], '새 글 = 한 문장(소수점에서 갈리지 않는다)');
    ok(SE.sameSequence(SS.splitIntoSentences(p.raw), SE.expectedTexts(texts, from, 1, p.newTexts)), '검증 재파싱 = 기대 시퀀스');
  }
}

console.log('\n[3] 옛 작업본 — 글은 같고 경계만 다른 그룹');
ok(GF.sameGroupText([{ text: '보험료가 3.5배였습니다.' }], [{ text: '보험료가 3.' }, { text: '5배였습니다.' }]), '경계만 다르면 같은 글');
ok(!GF.sameGroupText([{ text: '보험료가 3.6배였습니다.' }], [{ text: '보험료가 3.' }, { text: '5배였습니다.' }]), '글이 바뀌면 다른 글');
ok(!GF.sameGroupText([], []), '빈 그룹은 같다고 보지 않는다');
ok(/const SNAP_HASH_VER = 4;/.test(MAIN), 'SNAP_HASH_VER = 4 (해시가 같아도 옛 작업본을 한 번 다시 가린다)');
{
  const m = MAIN.match(/function overlaySnapshot\(parsed, snap\) \{[\s\S]*?\n\}/);
  ok(!!m, 'overlaySnapshot 원문 추출');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decimal-split-'));
  const f = (n) => { const p = path.join(tmp, n); fs.writeFileSync(p, 'x'); return p; };
  const img = f('01.png'), a1 = f('1.wav'), a2 = f('2.wav'), a3 = f('3.wav'), img2 = f('02.png');
  const req = (x) => require(x.startsWith('./') ? path.join(ROOT, x) : x);
  const overlay = new Function('require', 'fs', 'log', `${m[0]}; return overlaySnapshot;`)(req, fs, () => {});
  const mkPr = (groups) => {
    const all = groups.flat().map((t) => ({ text: t }));
    let k = 0;
    const gs = groups.map((g, i) => { const ss = all.slice(k, k + g.length); k += g.length; return { num: i + 1, imagePrompt: '', _s: ss }; });
    return { shortsNum: 1, sentences: all, groups: gs, getSentencesOfGroup: (g) => g._s };
  };
  const pr = mkPr([['보험료가 3.5배였습니다.', '끝입니다.'], ['둘째 그룹.']]);
  const snap = { projects: [{ shortsNum: 1, groups: [
    { num: 1, imagePrompt: 'old prompt', imagePath: img, sentences: [
      { text: '보험료가 3.', ttsAudioPath: a1 }, { text: '5배였습니다.', ttsAudioPath: a2 }, { text: '끝입니다.', ttsAudioPath: a3 }] },
    { num: 2, imagePrompt: 'p2', imagePath: img2, sentences: [{ text: '둘째 그룹.', ttsAudioPath: a3 }] },
  ] }] };
  const r = overlay({ projects: [pr] }, snap);
  eq(r.invalidated, 0, '🔴 소수점 그룹의 그림을 버리지 않는다');
  eq(r.resplit, 1, '경계만 바뀐 그룹 1개');
  const g1 = pr.groups[0];
  eq(g1.imagePath, img, '그림 이어받기');
  eq(g1.imagePrompt, 'old prompt', '프롬프트 이어받기');
  ok(!g1.imageStale && !g1.imageCleared, '새 이미지 대상이 아니다');
  eq(g1._s[0].ttsAudioPath, undefined, '합쳐진 문장(3.5배)은 음성을 새로 만든다(옛 「3.」 음성을 붙이지 않는다)');
  eq(g1._s[1].ttsAudioPath, a3, '같은 글의 문장(끝입니다.)은 음성 이어받기 — 순번이 밀려도 글로 짝짓는다');
  eq(pr.groups[1].imagePath, img2, '다른 그룹은 예전처럼');
  // A/B — 글이 바뀐 그룹은 예전처럼 새 이미지 대상
  const pr2 = mkPr([['보험료가 4.5배였습니다.', '끝입니다.'], ['둘째 그룹.']]);
  const r2 = overlay({ projects: [pr2] }, snap);
  eq(r2.invalidated, 1, 'A/B: 글이 바뀌면 예전처럼 새 이미지 대상');
  ok(pr2.groups[0].imageStale === true, 'A/B: imageStale');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${fail ? '❌' : '✅'} decimal-split: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
