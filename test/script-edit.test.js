/**
 * v0.5.0 — ✏ 화면에서 문장을 바로 고치기 (대본수정 모달 대체)
 *
 * 무엇을 지키는 테스트인가
 *   화면의 문장을 고치면 .md 의 **그 문장 자리만** 바뀌어야 한다. 그런데 파서는 원문을 그대로 쓰지 않는다 —
 *   따옴표·이모지를 지우고, 여러 줄을 공백으로 합치고, 종결부호로 자른다. 그래서 문장 텍스트로 .md 를
 *   단순 검색하면 **엉뚱한 자리를 고친다.**
 *
 * 🔴 이 저장소 대본의 실제 함정 두 가지(둘 다 실측):
 *   ① **한 줄에 문장이 여러 개**다 — `오늘의 답을 먼저 드리겠습니다. 관계를 깨는 것은 거절이 아닙니다. 지나친 다정입니다.`
 *      (그래서 줄 단위 치환으로는 안 되고 문자 범위를 잡아야 한다)
 *   ② **머리말 블록쿼트에 본문과 거의 같은 문장이 있다** — `> 🎯 … 관계를 깨는 것은 거절이 아니라 지나친 다정과 …`
 *      마스킹을 빼면 전방 매칭이 **여기에 먼저 걸려 머리말을 고친다.** [3-b] 가 이걸 단언한다.
 *
 * 🔑 원문(core/script-edit.js)을 그대로 require 해서 돌린다 — 로직을 복사해 두면 앱과 갈라져도 통과한다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SE = require(path.join(ROOT, 'core', 'script-edit.js'));
const P = require(path.join(ROOT, 'core', 'pipeline.js'));

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}
const eq = (a, b, label) => ok(a === b, `${label} (기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)})`);

const parseTexts = (raw) => {
  const pr = P.parseScriptText(raw, 'longform', {}).projects[0];
  return pr ? pr.sentences.map((s) => s.text) : [];
};

// 실제 대본을 본뜬 픽스처 — 위 함정 ①②를 그대로 담았다.
const FIX = [
  '# 지나치게 다정한 것이 왜 관계를 망치는지',
  '> 🧭 **[메타 · 내레이션 제외]**',
  '> 🎯 **[단일 아크]** 관계를 깨는 것은 거절이 아니라 지나친 다정과 앞질러 챙김이다.',
  '',
  '## 도입부',
  '### 〔장면·한 동작 후킹〕',
  '> 🖼️ 이미지: an elderly Korean man lifting a parcel',
  '> 🎬 비디오(I2V): A medium shot holds the corridor.',
  '구 선생님이 남의 상자를 안아 올려 문 안에 들여놓습니다. 십 년째 하는 일입니다.',
  '',
  '### 〔결론 한 줄〕',
  '> 🖼️ 이미지: an elderly Korean woman at a bus stop',
  '오늘의 답을 먼저 드리겠습니다. 관계를 깨는 것은 거절이 아닙니다. 지나친 다정입니다.',
  '',
].join('\n');

console.log('\n[1] 지문(sig) — 파서가 버리는 문자는 매칭에서도 무시한다');
{
  eq(SE.sigOf('안녕 하세요'), '안녕하세요', '공백 제거');
  eq(SE.sigOf('그는 "안녕"이라고'), '그는안녕이라고', '따옴표 제거');
  eq(SE.sigOf('첫 줄\n둘째 줄'), '첫줄둘째줄', '줄바꿈 제거(파서가 공백으로 합친다)');
  eq(SE.sigOf('별★표 ※주의'), '별표주의', '이모지·기호 제거');
  eq(SE.sigOf('끝입니다.'), '끝입니다.', '종결부호는 남긴다(문장 경계라 지우면 안 된다)');
  eq(SE.sigOf(''), '', '빈 문자열');
  eq(SE.sigOf(null), '', 'null 도 안전');
}

console.log('\n[2] 마스킹 — 문장이 될 수 없는 영역');
{
  const raw = FIX;
  const mask = SE.buildMask(raw);
  const at = (needle) => mask[raw.indexOf(needle)];
  eq(at('# 지나치게'), 1, 'H1 헤더 줄은 마스킹');
  eq(at('### 〔결론'), 1, 'H3 헤더 줄은 마스킹');
  eq(at('> 🎯'), 1, "'>' 지침 줄은 마스킹");
  eq(at('> 🖼️ 이미지'), 1, '이미지 프롬프트 줄은 마스킹');
  eq(at('오늘의 답을'), 0, '본문은 마스킹하지 않는다');
  ok(SE.buildMask('<!-- 메모 -->본문')[3] === 1, 'HTML 주석은 마스킹');
  ok(SE.buildMask('[섹션]\n본문')[1] === 1, '[섹션] 줄은 마스킹');
}

console.log('\n[3] 문장 위치 찾기 (전방 커서)');
{
  const texts = parseTexts(FIX);
  const locs = SE.locateSentences(FIX, texts);
  eq(locs.filter((l) => !l).length, 0, `문장 ${texts.length}개 전부 위치를 찾는다`);
  locs.forEach((l, i) => {
    if (l && SE.sigOf(FIX.slice(l.start, l.end)) !== SE.sigOf(texts[i])) fail++;
  });
  ok(true, '찾은 범위를 되읽으면 그 문장과 같다');

  // [3-b] 🔴 실사고 재현 — 머리말에 거의 같은 문장이 있다. 마스킹이 없으면 여기에 먼저 걸린다.
  const i = texts.findIndex((t) => /관계를 깨는 것은 거절이 아닙니다/.test(t));
  ok(i >= 0, '본문에 「관계를 깨는 것은 거절이 아닙니다」가 있다');
  const headStart = FIX.indexOf('> 🎯');
  const headEnd = FIX.indexOf('\n', headStart);
  ok(locs[i].start > headEnd, '🔴 머리말(> 🎯 …)의 비슷한 문장이 아니라 **본문** 자리를 잡았다');

  // [3-c] 한 줄에 문장 3개 — 각각 자기 범위만 잡는다
  const j = texts.findIndex((t) => /오늘의 답을/.test(t));
  eq(FIX.slice(locs[j].start, locs[j].end), '오늘의 답을 먼저 드리겠습니다.', '한 줄 안 첫 문장');
  eq(FIX.slice(locs[j + 1].start, locs[j + 1].end), '관계를 깨는 것은 거절이 아닙니다.', '한 줄 안 둘째 문장');
  eq(FIX.slice(locs[j + 2].start, locs[j + 2].end), '지나친 다정입니다.', '한 줄 안 셋째 문장');
}

console.log('\n[4] 편집 왕복 — 고친 .md 를 다시 파싱하면 기대한 문장이 나온다');
{
  const texts = parseTexts(FIX);
  const j = texts.findIndex((t) => /관계를 깨는 것은 거절이 아닙니다/.test(t));

  const roundtrip = (from, count, newText, label, expectLen) => {
    const r = SE.planEdit({ raw: FIX, texts, from, count, newText });
    ok(r.ok, `${label}: 계획 성공` + (r.ok ? '' : ` — ${r.error}`));
    if (!r.ok) return null;
    const expect = SE.expectedTexts(texts, from, count, r.newTexts);
    const after = parseTexts(r.raw);
    ok(SE.sameSequence(expect, after), `${label}: 재파싱 결과가 기대 시퀀스와 정확히 일치`);
    if (expectLen != null) eq(after.length, expectLen, `${label}: 문장 수 ${texts.length} → ${expectLen}`);
    return r;
  };

  // 수정
  const r1 = roundtrip(j, 1, '관계를 깨는 것은 거절이 아닙니다 정말로.', '수정', texts.length);
  ok(r1 && /거절이 아닙니다 정말로/.test(r1.raw), '수정: .md 에 새 문장이 들어갔다');
  ok(r1 && r1.raw.includes('오늘의 답을 먼저 드리겠습니다.'), '수정: 같은 줄의 앞 문장은 그대로');
  ok(r1 && r1.raw.includes('지나친 다정입니다.'), '수정: 같은 줄의 뒤 문장도 그대로');
  ok(r1 && r1.raw.includes('> 🎯 **[단일 아크]** 관계를 깨는 것은 거절이 아니라'), '🔴 수정: 머리말은 건드리지 않았다');

  // 병합 (사용자 요청: 9번+10번 합치기)
  const r2 = roundtrip(j, 2, '관계를 깨는 것은 거절이 아니라 지나친 다정입니다.', '병합', texts.length - 1);
  ok(r2 && r2.newTexts.length === 1, '병합: 두 문장이 하나가 된다');

  // 분할 (사용자 요청: 한 문장을 2개 이상으로)
  const r3 = roundtrip(j, 1, '관계를 깨는 것은 거절이 아닙니다. 그것은 다정입니다.', '분할', texts.length + 1);
  ok(r3 && r3.newTexts.length === 2, '분할: 마침표를 넣으면 두 문장이 된다');

  // 3개로 나누기
  const r4 = roundtrip(j, 1, '하나입니다. 둘입니다. 셋입니다.', '3분할', texts.length + 2);
  ok(r4 && r4.newTexts.length === 3, '3분할: 2개 이상으로도 나뉜다');

  // 삭제
  const r5 = roundtrip(j, 1, '', '삭제', texts.length - 1);
  ok(r5 && r5.newTexts.length === 0, '삭제: 문장이 사라진다');
  ok(r5 && !/관계를 깨는 것은 거절이 아닙니다\./.test(r5.raw.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n')),
    '삭제: 본문에서 그 문장이 없어졌다(머리말의 비슷한 문장은 남는다)');
}

console.log('\n[5] 안전장치 — 조용히 틀리지 않는다');
{
  const texts = parseTexts(FIX);
  // 범위 밖
  ok(!SE.planEdit({ raw: FIX, texts, from: 999, count: 1, newText: 'x' }).ok, '범위를 벗어난 번호는 거부');
  ok(!SE.planEdit({ raw: FIX, texts, from: -1, count: 1, newText: 'x' }).ok, '음수 번호는 거부');
  // 대본에 없는 문장(앱 밖에서 .md 가 바뀐 상황)
  const bogus = texts.slice(); bogus[0] = '이 문장은 대본에 없습니다.';
  const rb = SE.planEdit({ raw: FIX, texts: bogus, from: 0, count: 1, newText: 'x' });
  ok(!rb.ok && /자리를 찾지 못했습니다/.test(rb.error), '대본에서 못 찾으면 거부(사람 말 오류)');

  // 🔴 마스킹을 가로지르는 문장은 거부 — 치환하면 그 지침 줄이 함께 지워진다.
  //   실측 사례: `…너희가 당하라` / `> 【낭독 끝】` / `손을 씻는 몸짓은…` (종결부호가 없어 파서가 이어 붙인다)
  const cross = ['# 제목', '', '빌라도가 손을 씻으며 가로되 나는 무죄하니', '> 【낭독 끝】', '손을 씻는 몸짓은 로마 관습이 아니었습니다.', ''].join('\n');
  const ct = parseTexts(cross);
  eq(ct.length, 1, '지침 줄을 사이에 둔 앞뒤가 한 문장으로 이어진다(전제 확인)');
  const rc = SE.planEdit({ raw: cross, texts: ct, from: 0, count: 1, newText: '바꾼 문장입니다.' });
  ok(!rc.ok && /지침 줄/.test(rc.error), '🔴 마스킹을 가로지르는 문장은 거부(그 줄이 지워지는 것을 막는다)');
}

console.log('\n[6] 편집 텍스트 정리');
{
  eq(SE.normalizeEditText('  앞뒤 공백  '), '앞뒤 공백', '앞뒤 공백 제거');
  eq(SE.normalizeEditText('첫 줄\n둘째 줄'), '첫 줄 둘째 줄', '줄바꿈 → 공백(단락이 갈려 그룹이 흔들리는 것 방지)');
  eq(SE.normalizeEditText('> 지침처럼 보이는 글'), '지침처럼 보이는 글', "줄머리 '>' 제거(그 줄이 통째로 주석이 된다)");
  eq(SE.normalizeEditText('## 헤더처럼'), '헤더처럼', "줄머리 '#' 제거");
  eq(SE.normalizeEditText('여러    공백'), '여러 공백', '연속 공백 접기');
}

console.log('\n[7] 배선 — 화면·main·preload 가 실제로 이어져 있는가');
{
  const MAIN = read('main.js');
  const PRE = read('preload.js');
  const APP = read('renderer/src/App.jsx');
  const BUNDLE = (() => {
    try {
      const d = path.join(ROOT, 'renderer', 'dist', 'assets');
      return fs.readdirSync(d).filter((f) => /\.js$/.test(f)).map((f) => fs.readFileSync(path.join(d, f), 'utf8')).join('\n');
    } catch { return ''; }
  })();

  ok(/ipcMain\.handle\('edit-sentences'/.test(MAIN), 'main: edit-sentences 핸들러');
  ok(/editSentences: \(args\) => ipcRenderer\.invoke\('edit-sentences'/.test(PRE), 'preload: editSentences');
  ok(/api\.editSentences\(/.test(APP), 'App: api.editSentences 호출');

  // 🔑 검증 재파싱이 실제로 있는가 — 이게 없으면 .md 와 화면이 갈린 채 조용히 진행된다.
  const H = MAIN.slice(MAIN.indexOf("ipcMain.handle('edit-sentences'"));
  const BODY = H.slice(0, H.indexOf("ipcMain.handle('split-group'"));
  ok(/SE\.sameSequence\(expect/.test(BODY), '🔑 main: 검증 재파싱으로 기대 시퀀스와 대조한다');
  ok(BODY.indexOf('sameSequence') < BODY.indexOf('fs.writeFileSync'), '🔑 main: 검증이 .md 쓰기보다 **먼저** 온다');
  ok(/_srcHash/.test(BODY), '🔑 main: 새 대본 해시를 심는다(안 하면 다음에 열 때 그룹 구조가 초기화된다)');
  ok(/finalizeGroupIds\(pr\.groups/.test(BODY), 'main: groupId 재지정');
  ok(/pr\.sentences\.forEach\(\(s, i\) => \{ s\.num = i \+ 1; \}\)/.test(BODY), 'main: 문장 번호 재부여');
  ok(!/parseScript\(S\.scriptPath/.test(BODY), '🔑 main: 파싱본을 통째로 재파싱하지 않는다(그룹 분할·프롬프트 보존)');
  ok(/그룹의 마지막 문장은 지울 수 없습니다/.test(BODY), 'main: 빈 그룹이 되는 삭제는 거부');
  ok(/ttsAudioPath = keep\.ttsAudioPath/.test(BODY), 'main: 텍스트가 그대로인 조각은 음성을 물려받는다');

  // 화면: 옛 ✏ 수정 버튼(롱폼)은 사라지고 인라인 편집 UI 가 있다
  ok(/✏ 수정 버튼은 없앴다 — 문장을 클릭해/.test(APP), 'App: 롱폼 헤더의 ✏ 수정 버튼 제거(주석으로 사유 기록)');
  eq((APP.match(/onClick=\{openScriptEdit\}/g) || []).length, 1,
    '🔑 App: openScriptEdit 진입점은 출판 탭 1곳만 남았다(롱폼에서는 문장 편집이 대체)');
  ok(/sblk editing/.test(APP), 'App: 문장 편집 블록');
  ok(/defaultValue=\{ed\.text\}/.test(APP), '🔑 App: 편집칸이 **비제어**(제어면 타이핑마다 전 화면 재렌더 — 2026-08-14 사고)');
  ok(/splitSentAtCursor/.test(APP), 'App: 커서 자리에서 나누기');

  // 🔑 키보드 편집기 — 버튼이 아니라 키가 동작을 정한다(2026-09-15 로이 요청).
  //   ⚠ 버튼을 없앴으므로 이 배선이 깨지면 **나누기·합치기·저장을 할 방법이 아예 사라진다**.
  ok(/ev\.key === 'Enter' && !ev\.shiftKey.*edit\.splitAt\(\)/s.test(APP.slice(APP.indexOf('sblk editing'), APP.indexOf('sblk editing') + 2600)),
    '🔑 App: Enter = 나누기 (저장이 아니다)');
  ok(/ev\.key === 'Backspace' && caret === 0 && sel === 0/.test(APP), '🔑 App: 맨 앞 Backspace = 윗줄과 합치기');
  ok(/edit\.mergeUp\(si, sents\[si - 1\]\.text\)/.test(APP), 'App: 합칠 윗문장 텍스트를 함께 넘긴다');
  ok(/ev\.key === 'Delete' && caret === el\.value\.length && sel === el\.value\.length/.test(APP), '🔑 App: 맨 끝 Del = 아랫줄 올려 합치기');
  ok(/edit\.mergeNext\(si, sents\[si \+ 1\]\.text\)/.test(APP), 'App: 합칠 아랫문장 텍스트를 함께 넘긴다');
  ok(/onBlur=\{\(\) => edit\.commit\(\)\}/.test(APP), '🔑 App: 저장 버튼이 없으므로 **칸을 벗어나면 저장**한다');
  ok(/sentDoneRef\.current/.test(APP), '🔑 App: 키로 처리한 뒤 blur 가 또 저장하지 않게 막는다(이중 전송 방지)');
  ok(/setSentEdit\(\(cur\) => \(cur === e \? null : cur\)\)/.test(APP),
    '🔑 App: 저장이 도는 사이 다른 문장을 열었으면 그건 닫지 않는다');
  // 버튼·호버 도구는 사라졌다 — 남아 있으면 「버튼 없는 편집기」라는 이번 설계가 반쪽이 된다.
  ok(!/sblk-edit-btns/.test(APP), 'App: 저장·취소·✂나누기·🗑 버튼 줄 제거');
  ok(!/sblk-tools/.test(APP), 'App: 호버 ✎·⤋ 버튼 제거');
  ok(!/sblk-edit-btns|sblk-tools/.test(read('renderer/src/styles.css')), 'App: 그 CSS 도 함께 제거');
  ok(/uiConfirm\(msg \+ '\\n\\n대본\(\.md\) 편집창을 열까요\?'\)/.test(APP), '🔑 App: 화면에서 못 고칠 때 대본 편집창으로 빠져나갈 길');
  ok(BUNDLE ? /sblk/.test(BUNDLE) : true, 'App: 번들에 반영됨(소스만 고치고 빌드를 잊으면 화면은 옛것)');
}

console.log('\n[8] 실제 대본 회귀 — 이 PC 에 대본이 있으면 전수로 확인');
{
  const dirs = new Set();
  try {
    const d = path.join(os.homedir(), '.priming-maker', 'projects');
    for (const f of fs.readdirSync(d)) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
        if (j.scriptPath && fs.existsSync(j.scriptPath)) dirs.add(path.dirname(j.scriptPath));
      } catch {}
    }
  } catch {}
  let files = [];
  for (const dir of dirs) { try { for (const f of fs.readdirSync(dir)) if (/\.md$/i.test(f)) files.push(path.join(dir, f)); } catch {} }

  if (!files.length) { ok(true, '(이 PC 에 대본 폴더가 없어 건너뜀)'); }
  else {
    let nfile = 0, nsent = 0, miss = 0, bad = 0, edOk = 0, edBad = 0, cross = 0, crossLeak = 0;
    for (const f of files) {
      let raw, pr;
      try { raw = fs.readFileSync(f, 'utf8'); pr = P.parseScriptText(raw, 'longform', {}).projects[0]; } catch { continue; }
      if (!pr || pr.sentences.length < 6) continue;
      nfile++;
      const texts = pr.sentences.map((s) => s.text);
      const locs = SE.locateSentences(raw, texts);
      const mask = SE.buildMask(raw);
      nsent += texts.length;
      locs.forEach((l, i) => {
        if (!l) { miss++; return; }
        // 범위가 마스킹(지침 줄·헤더)을 가로지르면 되읽기가 다를 수 있다 — 그건 planEdit 이 **거부**하므로 안전하다.
        //   (실측: 전 대본 128,462 문장 중 1건 — `…너희가 당하라` / `> 【낭독 끝】` / `손을 씻는 몸짓은…`)
        let crosses = false;
        for (let k = l.start; k < l.end; k++) if (mask[k]) { crosses = true; break; }
        if (crosses) {
          cross++;
          const rj = SE.planEdit({ raw, texts, from: i, count: 1, newText: '바꾼 문장입니다.' });
          if (rj.ok) crossLeak++;   // 🔴 거부되지 않으면 그 지침 줄이 지워진다 = 사고
          return;
        }
        if (SE.sigOf(raw.slice(l.start, l.end)) !== SE.sigOf(texts[i])) bad++;
      });
      // 문장 2개 이상인 첫 그룹에서 같은 그룹 안 병합·수정·분할·삭제를 실제로 돌려 본다
      for (const g of pr.groups) {
        const gs = pr.getSentencesOfGroup(g);
        if (gs.length < 2) continue;
        const from = pr.sentences.indexOf(gs[0]);
        if (from < 0) break;
        const cases = [
          [from, 2, texts[from].replace(/[.!?。]+\s*$/, '') + ' ' + texts[from + 1]],
          [from, 1, '고친 문장입니다.'],
          [from, 1, '앞 조각입니다. ' + texts[from]],
          [from + 1, 1, ''],
        ];
        for (const [fr, cnt, t] of cases) {
          if (fr + cnt > texts.length) continue;
          const r = SE.planEdit({ raw, texts, from: fr, count: cnt, newText: t });
          if (!r.ok) continue;   // 거부는 안전한 실패(마스킹 가로지름·표)
          const expect = SE.expectedTexts(texts, fr, cnt, r.newTexts);
          let after; try { after = parseTexts(r.raw); } catch { edBad++; continue; }
          if (SE.sameSequence(expect, after)) edOk++; else edBad++;
        }
        break;
      }
    }
    console.log(`     대본 ${nfile}개 · 문장 ${nsent}개 · 위치 못찾음 ${miss} · 되읽기 불일치 ${bad}`
      + ` · 지침줄 가로지름 ${cross}(전부 거부됨 ${cross - crossLeak}) · 편집 왕복 ${edOk}건`);
    eq(bad, 0, '실제 대본: 찾은 범위는 전부 그 문장과 일치(가로지름 제외)');
    eq(crossLeak, 0, '🔴 실제 대본: 지침 줄을 가로지르는 문장은 **하나도 빠짐없이 거부**된다(그 줄이 지워지는 사고 차단)');
    eq(edBad, 0, '실제 대본: 편집 왕복이 전부 기대 시퀀스와 일치');
    ok(miss / Math.max(1, nsent) < 0.01, `실제 대본: 위치를 못 찾는 문장이 1% 미만 (${miss}/${nsent})`);
    ok(edOk > 100, `실제 대본 편집 왕복 표본이 충분 (${edOk}건)`);
  }
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
