/**
 * timestamps.test.js — ⏱ 유튜브 타임스탬프(챕터) 생성 검증.
 *
 * 🔑 로직을 여기에 복사해 두면 App.jsx 와 갈라져도 통과한다 → **App.jsx 원문에서 함수를 뽑아 실행**한다.
 *   (v0.3.14 의 visual-defect.test.js 와 같은 방식)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ── App.jsx 원문에서 타임스탬프 함수 4개를 뽑아 실행 ──────────────────────
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8');
function pull(name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `App.jsx 에 ${name} 없음`);
  // 함수 시작 '{' 부터 중괄호 균형으로 끝을 찾는다
  let j = src.indexOf('{', i), depth = 0, end = -1;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > 0, `${name} 본문 파싱 실패`);
  return src.slice(i, end);
}
const TS = new Function(`${pull('tsFmt')}\n${pull('tsCleanTitle')}\n${pull('tsChaptersOf')}\n${pull('tsBuild')}\nreturn { tsFmt, tsCleanTitle, tsChaptersOf, tsBuild };`)();

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} — got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); pass++; };

// ── 1. 시간 포맷 ────────────────────────────────────────────────────────
eq(TS.tsFmt(0), '0:00', 'fmt 0');
eq(TS.tsFmt(9.9), '0:09', 'fmt 내림(올림하면 내용보다 뒤에서 시작)');
eq(TS.tsFmt(61), '1:01', 'fmt 분');
eq(TS.tsFmt(3600), '1:00:00', 'fmt 시');
eq(TS.tsFmt(3725.4), '1:02:05', 'fmt 시분초');

// ── 2. 제목 꼬리 정리 ───────────────────────────────────────────────────
eq(TS.tsCleanTitle('훅 — 0:00~0:30 · I2V 5샷'), '훅', '타임코드 꼬리 제거');
eq(TS.tsCleanTitle('본론 (0:30~3:50)'), '본론', '괄호 타임코드 제거');
eq(TS.tsCleanTitle('절정 ★'), '절정', '★ 제거');
eq(TS.tsCleanTitle('강화도의  열아홉 살'), '강화도의 열아홉 살', '공백 정리');
eq(TS.tsCleanTitle(null), '', 'null 안전');
eq(TS.tsCleanTitle('도입부 〔콜드오픈 · 5샷 계단식 · I2V〕'), '도입부', '꼬리 제작메모 괄호 제거');
eq(TS.tsCleanTitle('〔장면·대화형 후킹 · ~48자·8s · 답 봉인〕'), '', '제작메모뿐이면 빈 제목 → 앞 챕터에 흡수');
eq(TS.tsCleanTitle('1장 — 밭에서 나온 사람 (스물일곱)'), '1장 — 밭에서 나온 사람 (스물일곱)', '본문 괄호는 보존');
eq(TS.tsCleanTitle('명량 (전자책)'), '명량 (전자책)', '숫자·제작어 없는 괄호는 보존');

// ── 2-b. 옛 작업본(.smproj) 의 H2 복구 — main.js 원문의 h2MapFromScript 를 그대로 실행 ──
{
  const msrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const i = msrc.indexOf('function h2MapFromScript(');
  ok(i >= 0, 'main.js 에 h2MapFromScript 있음');
  let j = msrc.indexOf('{', i), d = 0, e = -1;
  for (let k = j; k < msrc.length; k++) { if (msrc[k] === '{') d++; else if (msrc[k] === '}') { d--; if (!d) { e = k + 1; break; } } }
  const h2MapFromScript = new Function('fs', msrc.slice(i, e) + '; return h2MapFromScript;')(fs);
  const tmp = path.join(require('os').tmpdir(), 'ts-h2map-test.md');
  fs.writeFileSync(tmp, '# 제목\n## 도입부\n### 훅\n본문\n## 1장. 하나\n### 첫 장면\n본문\n### 둘째 장면\n본문\n', 'utf8');
  const m = h2MapFromScript(tmp);
  eq(m.get('훅'), '도입부', 'H3 → 상위 H2');
  eq(m.get('둘째 장면'), '1장. 하나', 'H3 → 그 위 H2');
  eq(m.get('도입부'), '도입부', 'H2 자신도 매핑');
  eq(h2MapFromScript('없는파일.md').size, 0, '없는 파일이면 빈 맵(앱 안 죽음)');
  fs.unlinkSync(tmp);
}

// ── 3. H2 로 묶기 (H3 그룹 여러 개 → 챕터 1개) ─────────────────────────
{
  const pr = { shortsNum: 1, cuts: [
    { h2: '도입부', phase: '훅', groupDurationSec: 8, sentences: [{ dur: 8 }] },
    { h2: '도입부', phase: '전환', groupDurationSec: 8, sentences: [{ dur: 8 }] },
    { h2: '강화도의 열아홉 살', phase: '밭에서 시작한다', groupDurationSec: 30, sentences: [{ dur: 30 }] },
    { h2: '강화도의 열아홉 살', phase: '그 집이 강화에', groupDurationSec: 25, sentences: [{ dur: 25 }] },
    { h2: '마지막 하루', phase: '실록', groupDurationSec: 40, sentences: [{ dur: 40 }] },
  ] };
  const ch = TS.tsChaptersOf(pr);
  eq(ch.length, 3, 'H2 3개 → 챕터 3개');
  eq(ch[0].start, 0, '첫 챕터 0초');
  eq(ch[1].start, 16, '두 번째 챕터 = 앞 두 그룹 합');
  eq(ch[2].start, 71, '세 번째 챕터 누적');
  eq(ch[0].dur, 16, '챕터 길이 = 속한 그룹 합');
  eq(ch[1].title, '강화도의 열아홉 살', 'H2 제목 사용(H3 아님)');
}

// ── 4. H2 가 없는 대본 → 섹션명(phase) 폴백 · 제목 없는 그룹은 앞 챕터에 흡수 ──
{
  const pr = { shortsNum: 1, cuts: [
    { h2: null, phase: '훅', groupDurationSec: 12, sentences: [{ dur: 12 }] },
    { h2: null, phase: null, groupDurationSec: 10, sentences: [{ dur: 10 }] },
    { h2: null, phase: '본론', groupDurationSec: 20, sentences: [{ dur: 20 }] },
  ] };
  const ch = TS.tsChaptersOf(pr);
  eq(ch.length, 2, 'phase 폴백 — 챕터 2개');
  eq(ch[0].dur, 22, '제목 없는 그룹은 앞 챕터에 붙는다');
  eq(ch[1].start, 22, '다음 챕터 시작');
}
{
  const pr = { shortsNum: 1, cuts: [{ h2: null, phase: null, groupDurationSec: 5, sentences: [{ dur: 5 }] }] };
  eq(TS.tsChaptersOf(pr)[0].title, '시작', '맨 앞 제목이 없으면 「시작」');
}

// ── 5. 붙여넣기 텍스트 · 경고 ───────────────────────────────────────────
{
  const dto = { projects: [{ shortsNum: 1, cuts: [
    { h2: '도입부', groupDurationSec: 20, sentences: [{ dur: 20 }] },
    { h2: '1장', groupDurationSec: 100, sentences: [{ dur: 100 }] },
    { h2: '2장', groupDurationSec: 95.6, sentences: [{ dur: 95.6 }] },
  ] }] };
  const r = TS.tsBuild(dto);
  eq(r.text, '0:00 도입부\n0:20 1장\n2:00 2장', '붙여넣기 텍스트');
  eq(Math.round(r.total), 216, '총 길이');
  eq(r.warns.length, 0, '경고 없음');
  ok(r.text.startsWith('0:00 '), '첫 줄 0:00 — 유튜브 챕터 인식 조건');
}
{
  const dto = { projects: [{ shortsNum: 1, cuts: [
    { h2: 'A', groupDurationSec: 5, sentences: [{ dur: 5 }] },
    { h2: 'B', groupDurationSec: 0, sentences: [{ dur: null }] },
  ] }] };
  const r = TS.tsBuild(dto);
  eq(r.warns.length, 3, 'TTS 미완료 + 3개 미만 + 10초 미만 → 경고 3');
  ok(r.warns.some((w) => w.includes('TTS 가 아직 없는')), 'TTS 미완료 경고');
  ok(r.warns.some((w) => w.includes('3개 미만')), '챕터 수 경고');
  ok(r.warns.some((w) => w.includes('10초 미만')), '짧은 챕터 경고');
}
{ // 쇼츠(여러 편) — 편마다 0:00 부터, 편 머리말
  const dto = { projects: [
    { shortsNum: 1, cuts: [{ h2: null, phase: '훅', groupDurationSec: 12, sentences: [{ dur: 12 }] }] },
    { shortsNum: 2, cuts: [{ h2: null, phase: '훅', groupDurationSec: 15, sentences: [{ dur: 15 }] }] },
  ] };
  const r = TS.tsBuild(dto);
  eq(r.text, '[쇼츠 1]\n0:00 훅\n\n[쇼츠 2]\n0:00 훅', '편별 블록');
}

// ── 6. 실제 롱폼 대본 — 파서 → DTO → 챕터 ───────────────────────────────
const REAL = process.env.TS_TEST_SCRIPT
  || 'D:/## 아도나이로이/02_역사/01_역사이야기/대본/2026_08/[역사_0820] 강화에서 밭을 갈던 철종은 33살에 죽었습니다.md';
if (fs.existsSync(REAL)) {
  const { parseLongformFile } = require('../core/parsers/longform-parser');
  const P = require('../core/pipeline');
  const parsed = parseLongformFile(REAL, {});
  parsed.mode = 'longform';
  const pr = parsed.projects[0];
  pr.sentences.forEach((s, i) => { s.ttsDurationSec = 3 + (i % 4) * 0.5; }); // 가짜 TTS 길이
  const dto = P.toDTO(parsed);
  const cuts = dto.projects[0].cuts;
  ok(cuts.every((c) => c.h2), '모든 그룹이 상위 H2 를 갖는다');
  const chs = TS.tsChaptersOf(dto.projects[0]);
  const h2s = [...new Set(cuts.map((c) => c.h2))];
  eq(chs.length, h2s.length, `실제 대본 H2 ${h2s.length}개 = 챕터 수`);
  eq(chs[0].start, 0, '실제 대본 첫 챕터 0초');
  eq(chs[0].title, '도입부', '첫 챕터 = 도입부');
  // 시작시각 = 앞 그룹 TTS 합
  let acc = 0, gi = 0;
  for (const ch of chs) {
    eq(Math.round(ch.start * 100) / 100, Math.round(acc * 100) / 100, `${ch.title} 시작시각 = 앞 그룹 합`);
    while (gi < cuts.length && cuts[gi].h2 === ch.title) { acc += cuts[gi].groupDurationSec || 0; gi++; }
  }
  // 도입부 재배치(TTS 후 실제로 도는 경로)에서도 제목이 살아남는가
  const { regroupIntroByTtsDuration } = require('../core/group-builder');
  regroupIntroByTtsDuration(pr, { maxSec: 10 });
  const dto2 = P.toDTO(parsed);
  const chs2 = TS.tsChaptersOf(dto2.projects[0]);
  eq(chs2[0].title, '도입부', '도입부 재배치 후에도 첫 챕터 = 도입부');
  eq(chs2.length, h2s.length, '도입부 재배치 후에도 챕터 수 동일');
} else {
  console.log('  (실제 대본 없음 — 6번 건너뜀: ' + REAL + ')');
}

console.log(`✅ timestamps.test.js — ${pass} 단언 통과`);
