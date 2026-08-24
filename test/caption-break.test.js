'use strict';
// node test/caption-break.test.js — 자막 「끊어 읽기」 경계 검증.
//   2026-08-24 실사고(로이 신고): Vrew 자막이 `셈하지 않게 되면 다음부터는 받는` / `것이 아니라 …` 로
//   끊겨 **의존명사 「것」으로 시작하는 줄**이 나왔다. `맡아 본` / `사람에게서` 도 관형절을 갈랐다.
//   원인: 옛 알고리즘이 아는 것은 「어절 안 쪼갬」 + 「줄 길이 고르게」 둘뿐. 14자/14자로 균형이
//   완벽한 분할을 최적해로 골랐다(길이 균형과 의미 경계는 서로 다른 목표다).
//
//   지키려는 것:
//     ① 절대 끊지 않는다 — 의존명사 앞 · 관형사 뒤 · 보조용언 사이
//     ② 관형절+머리명사는 강한 감점(줄 하나 늘리는 것보다 비싸다)
//     ③ 오탐을 만들지 않는다 — 실측에서 밟은 함정들이 회귀로 남아 있다
//     ④ 기존 규칙은 그대로 — 어절 안 쪼갬 · 글자수 상한 · 쉼표 · 접속부사 단독
//     ⑤ 구현은 한 벌 — 렌더러가 core 를 그대로 쓴다(두 벌이면 화면과 .vrew 가 갈라진다)
//   🔑 로직을 복사하지 않는다 — core 원문을 require 해서 실행한다.
const fs = require('fs');
const path = require('path');

const R = (...p) => path.join(__dirname, '..', ...p);
const C = require(R('core', 'caption-splitter.js'));
const { splitCaptionLines, auditCaptionLines, boundaryAt, meaningfulLen } = C;

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };
const startsWithWord = (lines, w) => lines.some((l) => l.split(/\s+/)[0] === w);

// ─────────────────── [1] 실사고 회귀 — 로이가 신고한 그 두 문장 ───────────────────
console.log('[1] 실사고 회귀 (자막 14자)');
{
  const A = '그 조건을 고을 하나를 맡아 본 사람에게서 찾아보겠습니다.';
  const B = '셈하지 않게 되면 다음부터는 받는 것이 아니라 가져가는 것이 됩니다.';
  const la = splitCaptionLines(A, 14), lb = splitCaptionLines(B, 14);

  ok(!startsWithWord(lb, '것이'), '85번 사고 — 「것이」로 시작하는 줄이 없다');
  ok(auditCaptionLines(lb).length === 0, 'B 문장에 끊어읽기 사고가 없다');
  ok(auditCaptionLines(la).length === 0, 'A 문장에 끊어읽기 사고가 없다');
  // 「맡아 본 사람에게서」는 한 줄에 붙어 있어야 한다(관형절+머리명사, 보조용언 둘 다)
  ok(la.some((l) => /맡아 본 사람에게서/.test(l)), 'A 문장 — 「맡아 본 사람에게서」가 한 줄로 붙는다');
  ok(!la.some((l) => /맡아 본$/.test(l)), 'A 문장 — 「…맡아 본」에서 줄이 끝나지 않는다');

  // 옛 동작(균형만 최적화)이 실제로 사고를 냈는지 — 이 테스트가 헛단언이 아님을 확인
  ok(meaningfulLen('셈하지 않게 되면 다음부터는 받는') === 14
    && meaningfulLen('것이 아니라 가져가는 것이 됩니다.') === 14,
    '그 사고 분할이 14자/14자로 「균형 완벽」이었다 = 길이 균형만으로는 못 막는다');
}

// ─────────────────── [2] 금지 경계 — 절대 끊지 않아야 하는 자리 ───────────────────
console.log('[2] 금지 경계');
{
  const banned = [
    [['받는', '것이'], '의존명사'],
    [['할', '수가'], '의존명사'],
    [['먹는', '데'], '의존명사'],
    [['갈', '때'], '의존명사'],
    [['그', '조건을'], '관형사'],
    [['두', '낱말을'], '관형사'],
    [['모든', '사람이'], '관형사'],
    [['맡아', '본'], '보조용언'],
    [['해', '주는'], '보조용언'],
    [['잊어', '버린'], '보조용언'],
  ];
  for (const [w, kind] of banned) {
    const b = boundaryAt(w, 0);
    ok(b.banned && b.why.startsWith(kind), `「${w[0]} | ${w[1]}」 금지 (${kind})`);
  }
  // 관형절은 금지가 아니라 강한 감점 — 줄 하나 늘리는 비용(100)보다 비싸야 한다
  const adn = boundaryAt(['본', '사람에게서'], 0);
  ok(!adn.banned && adn.score <= -13, '관형절 「본 사람에게서」는 강한 감점(금지 아님)');
  ok(/관형절/.test(adn.why || ''), '관형절 사유가 사람 말로 붙는다');
}

// ─────────────────── [3] 오탐 방지 — 실측에서 밟은 함정들 ───────────────────
console.log('[3] 오탐 방지 (실측 회귀)');
{
  const fine = [
    [['그리고', '침대'], '침대를 「치우다」로 오판하던 것'],
    [['않으셨고', '말도'], '말도를 「말다」로 오판하던 것'],
    [['드리고', '죽을'], '죽을을 「주다」로 오판하던 것'],
    [['책인지', '이름만'], '이름만을 「있다」로 오판하던 것'],
    [['하겠다고', '한마디'], '한마디를 「하다」로 오판하던 것'],
    [['조건을', '고을'], '조건을(ㄹ받침)을 관형형으로 오판하던 것'],
    [['사람은', '돈을'], '사람은(주제조사)을 관형형으로 오판하던 것'],
    [['데이터를', '받는'], '데이터를을 의존명사 「데」로 오판하던 것'],
    [['그러니', '바로'], '바로(부사)를 의존명사 「바」로 오판하던 것'],
    [['하나하나', '등을'], '등을(신체)을 의존명사 「등」으로 오판하던 것'],
    [['방법은', '판을'], '판을(자립명사)을 의존명사로 오판하던 것'],
    [['나는', '돈을'], '나는(대명사+조사)을 관형형으로 오판하던 것'],
  ];
  for (const [w, why] of fine) {
    const b = boundaryAt(w, 0);
    ok(!b.banned && b.score >= 0, `「${w[0]} | ${w[1]}」 정상 — ${why}`);
  }
  // 쉼표·접속부사 뒤는 어떤 판정보다 먼저 「정당」이어야 한다
  for (const w of [['네,', '빨간색이에요'], ['전,', '캐나다'], ['한,', '진짜']]) {
    const b = boundaryAt(w, 0);
    ok(!b.banned && b.score >= 4, `쉼표 뒤 「${w[0]} | ${w[1]}」 는 항상 좋은 자리`);
  }
  for (const w of [['다만', '시간이'], ['그런데', '사람은']]) {
    const b = boundaryAt(w, 0);
    ok(!b.banned && b.score >= 4, `접속부사 뒤 「${w[0]} | ${w[1]}」 는 항상 좋은 자리`);
  }
}

// ─────────────────── [4] 기존 규칙 보존 ───────────────────
console.log('[4] 기존 규칙 보존');
{
  ok(splitCaptionLines('', 7).length === 0, '빈 문자열 → 빈 배열');
  ok(splitCaptionLines(null, 7).length === 0, 'null → 빈 배열');
  ok(splitCaptionLines('   ', 7).length === 0, '공백만 → 빈 배열');

  // 어절은 절대 쪼개지 않는다 — 원문 어절이 그대로 보존되는지
  const long = '그 조건을 고을 하나를 맡아 본 사람에게서 찾아보겠습니다.';
  for (const N of [5, 7, 10, 12, 14, 20]) {
    const lines = splitCaptionLines(long, N);
    ok(lines.join(' ') === long, `자막 ${N}자 — 어절을 쪼개지 않고 원문이 그대로 보존된다`);
  }

  // 글자수 상한 — 어절이 여러 개인 줄은 상한을 넘지 않는다(단일 어절은 넘쳐도 1줄 유지)
  const many = ['셈하지 않게 되면 다음부터는 받는 것이 아니라 가져가는 것이 됩니다.',
    '억울함을 적어 보내는 데 쓸 수도 있었고, 등을 돌린 사람들을 헤아리는 데 쓸 수도 있었습니다.'];
  let over = 0;
  for (const t of many) for (const N of [7, 10, 14]) {
    for (const l of splitCaptionLines(t, N)) {
      if (meaningfulLen(l) > N && l.split(/\s+/).length > 1) over++;
    }
  }
  ok(over === 0, '어절이 둘 이상인 줄은 글자수 상한을 넘지 않는다');

  // 긴 단일 어절은 넘쳐도 한 줄
  const one = splitCaptionLines('찾아보겠습니다', 3);
  ok(one.length === 1 && one[0] === '찾아보겠습니다', '한 어절이 상한을 넘으면 그 어절만 한 줄');

  // 쉼표에서 끊고 쉼표는 앞 줄에 남는다
  const cm = splitCaptionLines('초저녁엔 가볍게, 깊은 밤엔 더 무겁게 다스렸지요.', 14);
  ok(cm.some((l) => /가볍게,$/.test(l)), '쉼표에서 끊고 쉼표는 앞 줄에 유지');

  // 접속부사 단독 줄
  ok(splitCaptionLines('그런데 사람은 받는 데 익숙해지면 고마움을 셈하지 않게 됩니다.', 14)[0] === '그런데',
    '접속부사가 첫 어절이면 단독 줄');

  // 기본값 유지(하위호환) — maxChars 생략 = 7
  ok(JSON.stringify(splitCaptionLines('초저녁엔 가볍게, 깊은 밤엔 더 무겁게 다스렸지요.'))
    === JSON.stringify(splitCaptionLines('초저녁엔 가볍게, 깊은 밤엔 더 무겁게 다스렸지요.', 7)),
    'maxChars 기본값은 7 (하위호환)');
}

// ─────────────────── [5] 구현은 한 벌 — 렌더러가 core 를 쓴다 ───────────────────
console.log('[5] 단일 구현 배선');
{
  const REN = fs.readFileSync(R('renderer', 'src', 'lib', 'captions.js'), 'utf8');
  ok(/from '\.\.\/\.\.\/\.\.\/core\/caption-splitter\.js'/.test(REN),
    '렌더러 captions.js 가 core/caption-splitter.js 를 import 한다');
  ok(/export const splitLines\s*=/.test(REN) && /export const mLen\s*=/.test(REN),
    '렌더러가 splitLines·mLen 을 그대로 재수출한다(App.jsx 호출부 무변경)');
  // 옛 복사본의 흔적이 남아 있으면 두 벌로 되돌아간 것
  ok(!/function wrapWords/.test(REN), '렌더러에 자체 wrapWords(복사본 DP)가 없다');
  ok(!/maxLen/.test(REN), '렌더러에 옛 균형-only 목적함수(maxLen)가 없다');
  ok(!/new Set\(\['그런데'/.test(REN), '렌더러가 접속부사 목록을 따로 갖지 않는다');

  // 빌드가 CJS core 를 렌더러 번들에 넣을 수 있게 vite 설정이 되어 있어야 한다
  const VITE = fs.readFileSync(R('vite.config.mjs'), 'utf8');
  ok(/commonjsOptions/.test(VITE) && /core/.test(VITE),
    'vite.config 이 core/ 를 commonjs 변환 대상에 넣는다(없으면 빌드가 깨진다)');
  ok(/fs:\s*\{\s*allow/.test(VITE), 'vite dev 서버가 root 밖 core/ 를 읽을 수 있다');

  // core 를 쓰는 곳들이 그대로 동작하는지(호출 시그니처 유지)
  const PIPE = fs.readFileSync(R('core', 'pipeline.js'), 'utf8');
  const VREW = fs.readFileSync(R('vrew', 'vrew-builder.js'), 'utf8');
  ok(/splitCaptionLines/.test(PIPE), 'pipeline.js 이 splitCaptionLines 를 쓴다');
  ok(/splitCaptionLines/.test(VREW), 'vrew-builder.js 이 splitCaptionLines 를 쓴다');

  // 렌더러 번들에 새 규칙이 실제로 들어갔는지 (빌드 산출물이 있을 때만)
  const dir = R('renderer', 'dist', 'assets');
  if (fs.existsSync(dir)) {
    const js = fs.readdirSync(dir).filter((f) => /^index-.*\.js$/.test(f));
    if (js.length) {
      const b = fs.readFileSync(path.join(dir, js[0]), 'utf8');
      ok(/의존명사/.test(b) && /관형절/.test(b), '빌드된 렌더러 번들에 새 경계 규칙이 들어 있다');
      // 🔴 실사고: core 끝의 자기검사 블록(require.main)이 번들에 실려 브라우저에서
      //   `require is not defined` → **화면 백지**. core 를 렌더러가 쓰는 한 이 단언이 방어선이다.
      ok(!/require\.main/.test(b),
        '번들에 require.main 이 없다 (있으면 앱 화면이 백지가 된다)');
    }
  }
  // core 파일 자체에도 CJS 런타임 참조가 없어야 한다(위 사고의 근원)
  {
    const CORE = fs.readFileSync(R('core', 'caption-splitter.js'), 'utf8');
    ok(!/require\.main/.test(CORE), 'core/caption-splitter.js 에 require.main 자기검사가 없다');
  }
}

// ─────────────────── [6] 실제 대본 전량 회귀 (없으면 건너뜀) ───────────────────
console.log('[6] 실제 대본 회귀');
{
  const roots = [
    'D:/## 아도나이로이/01_고전/01_로이의 고전이야기/대본/2026_08',
    'D:/## 아도나이로이/03_인간관계/02_다산의 뜰/대본/2026_08',
    'D:/## 아도나이로이/02_역사/01_역사이야기/대본/2026_08',
    'D:/## 아도나이로이/05_성경/01_로이의 성경이야기/대본/2026_08',
    'D:/## 아도나이로이/01_고전/02_고전서재/대본/2026_08',
  ].filter((p) => fs.existsSync(p));

  if (!roots.length) {
    console.log('  ⏭ 대본 폴더가 없는 PC — 건너뜀 (아내 PC·CI 에서 정상)');
  } else {
    const P = require(R('core', 'pipeline.js'));
    const texts = [];
    for (const r of roots) {
      for (const f of fs.readdirSync(r).filter((x) => x.endsWith('.md'))) {
        let pr; try { pr = P.parseScript(path.join(r, f), 'longform'); } catch (e) { continue; }
        for (const p of pr.projects) {
          for (const g of p.groups) {
            for (const s of p.getSentencesOfGroup(g)) if (s.text) texts.push(s.text);
          }
        }
      }
    }
    ok(texts.length > 1000, `대본 문장을 충분히 읽었다 (${texts.length}개)`);

    for (const N of [7, 14]) {
      let lines = 0, viol = 0, over = 0, lost = 0;
      for (const t of texts) {
        const ls = splitCaptionLines(t, N);
        lines += ls.length;
        viol += auditCaptionLines(ls).length;
        if (ls.join(' ') !== t.trim().replace(/\s+/g, ' ')) lost++;
        for (const l of ls) if (meaningfulLen(l) > N && l.split(/\s+/).length > 1) over++;
      }
      const rate = viol / lines * 1000;
      console.log(`     ${N}자: 줄 ${lines} · 사고 ${viol} (${rate.toFixed(2)}‰)`);
      ok(lost === 0, `${N}자 — 어절 손실·변형 없이 원문이 보존된다`);
      ok(over === 0, `${N}자 — 글자수 상한 위반 0`);
      // 실측 기준선(2026-08-24): 14자 = 0.54‰ · 7자 = 13.2‰. 여유를 두고 상한을 건다.
      ok(rate < (N >= 14 ? 3 : 20), `${N}자 — 끊어읽기 사고가 기준선 아래 (${rate.toFixed(2)}‰)`);
    }
  }
}

console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 자막 끊어읽기 ' + n + '/' + n + ' 통과');
process.exit(bad ? 1 : 0);
