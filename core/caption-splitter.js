/**
 * caption-splitter.js — 한 문장 → Vrew 클립(자막 줄) 배열.  ★ 자막 분할의 정본(단일 진실).
 *
 * 🔑 이 파일이 유일한 구현이다. 렌더러(앱 화면·미리보기)도 renderer/src/lib/captions.js 를 통해
 *    이 파일을 그대로 가져다 쓴다 — 규칙이 두 벌이면 「화면에서 본 줄」과 「.vrew 에 들어간 줄」이
 *    반드시 갈라진다(2026-08-24 이전이 그 상태였다).
 *
 * 규칙:
 *   1. 쉼표(, ， 、)에서 끊는다 (쉼표는 앞 줄에 유지).
 *   2. 어절(띄어쓰기 토큰, 조사 포함)은 절대 쪼개지 않는다. 한 어절이 maxChars 를 넘으면
 *      그 어절만 한 줄(넘쳐도 1줄 유지 — "다." 같은 한 글자 고아 방지).
 *   3. 한 줄은 글자수(공백·문장부호 제외) maxChars(기본 7) 이하.
 *   4. ★ 한국어 「끊어 읽기」 경계를 지킨다 — 아래 ①~④. 길이 균형보다 이것이 우선.
 *   5. 접속부사(그런데/그리고/하지만…)가 첫 어절이면 단독 줄.
 *
 * ⚠ 4번이 왜 필요한가 (2026-08-24, 로이 신고):
 *   예전 알고리즘이 아는 것은 「어절 안 쪼갬」 + 「줄 길이를 고르게」 둘뿐이었다. 그래서
 *   `셈하지 않게 되면 다음부터는 받는` / `것이 아니라 …` 처럼 **14자/14자로 균형이 완벽한** 분할을
 *   최적해로 골랐다. 의존명사 「것」으로 시작하는 줄은 앞말 없이 뜻이 없어 시청자가 읽다 멈춘다.
 *   → 경계마다 금지/점수를 매겨 목적함수에 넣는다. 실측: 사고 138건 → 10건, 줄 수는 +0.7%.
 *
 * 글자수 카운트는 한글·영숫자만 (공백/쉼표/마침표/느낌표/물음표 제외).
 */

const CONNECTIVES = new Set([
  '그런데', '그리고', '하지만', '그러나', '그래서', '그러니', '그러면', '그러므로',
  '한편', '또한', '그래도', '그리하여', '즉', '결국', '따라서', '왜냐하면',
  '그렇지만', '다만', '반면', '오히려', '그러다', '그리고는', '게다가', '하물며',
]);

// ───────────────────────── 한국어 끊어 읽기 경계 ─────────────────────────

// ① 의존명사 — 앞말 없이는 뜻이 없다. 이 어절로 시작하는 줄을 만들지 않는다.
//    ⚠ 「어절 전체」가 의존명사(+조사)일 때만 잡는다 — `^데` 로 하면 '데이터를' 이 걸린다.
//    ⚠ 자립 동형어가 흔한 것은 일부러 뺐다(실측 오탐): 바('바로'), 등('등을' 신체), 판('판을 엎다'),
//      적('적을'), 지, 편, 쪽, 성, 양, 체, 만, 차, 축, 김, 참, 턱, 법.
//      의존 용법이 압도적인 것만 남긴다 — 못 잡는 쪽이 엉뚱한 곳을 묶는 것보다 낫다.
const BOUND_NOUNS = [
  '것', '게', '걸', '데', '수', '줄', '리', '뿐', '만큼', '채', '척', '듯', '터',
  '때', '대로', '무렵', '즈음', '나름', '따름', '뻔',
];
const JOSA_TAIL = [
  '이', '가', '은', '는', '을', '를', '도', '만', '과', '와', '의', '로', '으로', '에',
  '에서', '에게', '부터', '까지', '라도', '나', '이나', '야', '이야', '이다', '입니다',
  '이라', '라', '란', '이란', '처럼', '보다', '조차', '마저', '밖에', '요', '마다', '씩',
  '들', '들이', '들을', '들은', '이고', '이며', '과는', '와는', '이었다', '였다',
];
const RE_BOUND = new RegExp(
  '^(' + BOUND_NOUNS.join('|') + ')(' + JOSA_TAIL.join('|') + ')?[.!?,]*$');

// ② 관형사 — 뒤에 오는 명사와 한 덩어리다("그 | 조건을" 금지).
//    ⚠ '네' 는 뺐다 — 수관형사보다 감탄사("네, 맞아요")가 압도적이다(실측 오탐).
const DETERMINERS = new Set([
  '그', '이', '저', '요', '고', '조', '한', '두', '세', '다섯', '여섯', '일곱',
  '여덟', '아홉', '열', '몇', '모든', '각', '여러', '어떤', '무슨', '어느', '다른',
  '새', '옛', '온갖', '갖은', '전', '총', '약', '첫', '매', '별', '온', '딴', '뭇',
]);

// ③ 보조용언 — 「-아/-어/-게/-지/-고 + 보조용언」은 한 덩어리다("맡아 | 본" 금지).
//    ⚠ 한글은 어간+어미가 한 음절로 합쳐져("보"+"-ㄴ" = "본") 정규식 `^보` 로는 못 잡는다.
//      그렇다고 초성+중성만 비교하면 **'침대'를 「치우다」로, '죽을'을 「주다」로, '말도'를 「말다」로**
//      오판한다(실측). → 활용형을 명시 목록으로 둔다. 못 잡는 쪽이 엉뚱한 곳을 묶는 것보다 낫다.
const AUX_FORMS = new Set([
  '본', '볼', '봐', '봤다', '보는', '보니', '보면', '보자', '보고',
  '준', '줄', '줘', '주는', '주고', '주면',
  '한', '할', '해', '했다', '하는', '하고', '하지', '하면',
  '된', '될', '돼', '되는', '되고',
  '있는', '있고', '있다', '있어', '있으면', '없는', '없고', '없다', '없어',
  '버린', '버릴', '버려', '버렸다', '말고', '말지', '말라',
  '드린', '드릴', '드려', '드리고', '놓고', '놓은', '놨다', '둔', '두고',
  '지는', '진', '질', '온', '올', '간', '갈', '싶은', '싶다', '싶어',
  '치운', '치울', '치워', '내린', '내릴', '내려',
]);
// ⚠ 축약형도 포함해야 한다 — '해'(하+여)·'봐'·'줘'·'돼'·'와' 는 「-아/-어」의 축약이다
//   ("해 주는", "봐 주는", "와 있는"). 이걸 빼면 그 자리를 그대로 갈라 버린다.
const RE_AUX_PREV = /[아어여게지고해봐줘돼와]$/;

// ④ 관형절 + 꾸밈받는 명사 — "맡아 본 | 사람에게서". 금지는 아니고 강한 감점(오탐 여지 때문).
//    관형형 의심 = -는/-던 으로 끝나거나, 종성이 ㄴ·ㄹ 인 1~2음절 어절(본·할·간·볼·지난).
//    ⚠ '을/은' 으로 끝나면 제외 — '조건을'(ㄹ받침)은 목적격이지 관형형이 아니다.
const RE_NOT_ADN_TAIL = /(을|은)$/;
const NOT_ADNOMINAL = new Set(['나는', '너는', '저는', '그는', '이는', '우리는', '저희는',
  '그것은', '이것은', '당신은']);
// 뒤 어절이 「명사+조사」로 보이는지 — 관형형과 헷갈리지 않는 명백한 조사만 본다('는/은' 제외).
const RE_CLEAR_JOSA = /(에게서|한테서|에서부터|으로부터|로부터|에게로|으로서|로서|으로써|로써|에다가|더러|을|를|의|에|에서|에게|으로|로|와|과|부터|까지|처럼|보다|한테|께|이|가)$/;

// 끊기 좋은 자리 (앞 어절의 끝 표면형). 쉼표 > 연결어미·부사격조사 > 주격·목적격.
const RE_GOOD3 = /(면|면서|니까|지만|는데|은데|어서|아서|해서|하고|이고|고|며|거나|든지|도록|려면|기에|므로|더니|길래|텐데|에게서|한테서|에서부터|으로부터|로부터|에게로|으로서|로서|으로써|로써|에다가|더러|에서|에게|에|으로|로|와|과|보다|까지|부터|마다|한테|께|처럼|이랑|랑)$/;
const RE_GOOD1 = /(은|는|이|가|을|를|의|도|만|조차|마저)$/;

// 목적함수 가중치 — 우선순위: 금지 회피 ≫ 관형절 회피 ≫ 줄 수 ≫ 좋은 경계 ≫ 길이 균형.
//   VIOL(250) > LINE(100)   : 금지 자리를 피하려면 줄 하나를 더 쓴다.
//   관형절 8×15 = 120 > 100 : 역시 줄 하나보다 비싸다.
//   TAIL                    : 마지막 줄에도 약한 균형 페널티 — 꼬리 한 어절만 남는 고아 줄 방지.
const W = { VIOL: 250, LINE: 100, GOOD: 8, BAL: 0.5, TAIL: 0.3 };
const ADNOMINAL_SCORE = -15;

function meaningfulLen(s) {
  const m = String(s).match(/[가-힣A-Za-z0-9]/g);
  return m ? m.length : 0;
}

const bareWord = (w) => String(w).replace(/[,，、.!?]+$/, '');

function endsWithNorL(w) {
  const c = String(w).charCodeAt(w.length - 1) - 0xAC00;
  if (c < 0 || c > 11171) return false;
  const t = c % 28;
  return t === 4 /* ㄴ */ || t === 8 /* ㄹ */;
}
const isAuxWord = (w) => AUX_FORMS.has(w);
function looksAdnominal(w) {
  if (NOT_ADNOMINAL.has(w)) return false;
  if (RE_NOT_ADN_TAIL.test(w)) return false;
  if (/(는|던)$/.test(w)) return true;
  return endsWithNorL(w) && meaningfulLen(w) <= 2;
}

/**
 * 어절 i 뒤에서 줄을 끊을 때의 판정.
 *   banned = 절대 끊지 말아야 하는 자리 / score = 클수록 좋은 자리, 음수면 나쁜 자리(관형절)
 *   why    = 사람이 읽을 이유(감사·테스트용)
 */
function boundaryAt(words, i) {
  const cur = words[i], nxt = words[i + 1];
  if (nxt === undefined) return { banned: false, score: 0 };
  const c = bareWord(cur), n = bareWord(nxt);
  // 🔑 쉼표·접속부사 뒤는 언제나 정당한 자리다 — 다른 어떤 판정보다 먼저 본다.
  //    (예전엔 이 검사가 관형사·보조용언보다 뒤라 `네, | 빨간색이에요`·`백여 년 전, | 캐나다`
  //     처럼 쉼표에서 끊은 정상 분할을 사고로 신고했다.)
  if (/[,，、]$/.test(cur)) return { banned: false, score: 4 };
  if (CONNECTIVES.has(c)) return { banned: false, score: 4 };
  if (RE_BOUND.test(n)) return { banned: true, score: 0, why: `의존명사 「${n}」` };
  if (DETERMINERS.has(c)) return { banned: true, score: 0, why: `관형사 「${c}」` };
  if (RE_AUX_PREV.test(c) && isAuxWord(n)) {
    return { banned: true, score: 0, why: `보조용언 「${c} ${n}」` };
  }
  if (looksAdnominal(c) && RE_CLEAR_JOSA.test(n)) {
    return { banned: false, score: ADNOMINAL_SCORE, why: `관형절 「${c} ${n}」` };
  }
  if (RE_GOOD3.test(c)) return { banned: false, score: 3 };
  if (RE_GOOD1.test(c)) return { banned: false, score: 1 };
  return { banned: false, score: 0 };
}

// 어절 배열 → 줄 배열. 어절은 쪼개지 않고, 위 경계 판정을 비용에 넣어 DP 로 최적 분할.
function wrapWords(words, maxChars) {
  const n = words.length;
  if (!n) return [];
  const w = words.map(meaningfulLen);
  const bnd = words.map((_, i) => boundaryAt(words, i));
  const memo = new Array(n + 1);
  memo[n] = { cost: 0, cuts: [] };
  for (let i = n - 1; i >= 0; i--) {
    let best = null, sum = 0;
    for (let j = i; j < n; j++) {
      sum += w[j];
      const single = (j === i);
      if (sum > maxChars && !single) break;      // 여러 어절 줄은 max 초과 불가
      const rest = memo[j + 1];
      if (!rest) continue;
      const slack = maxChars - sum;
      const isLast = (j === n - 1);
      let cost = rest.cost + W.LINE;
      if (!isLast) {
        const b = bnd[j];
        if (b.banned) cost += W.VIOL;
        cost -= W.GOOD * b.score;
        cost += W.BAL * slack * slack;
      } else {
        cost += W.TAIL * slack * slack;
      }
      if (!best || cost < best.cost) best = { cost, cuts: [j + 1, ...rest.cuts] };
      if (single && sum > maxChars) break;        // 긴 단일 어절: 그 어절만 한 줄
    }
    memo[i] = best;
  }
  const lines = []; let start = 0;
  for (const end of memo[0].cuts) { lines.push(words.slice(start, end).join(' ')); start = end; }
  return lines;
}

function splitCaptionLines(text, maxChars = 7) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return [];
  const segs = t.split(/(?<=[,，、])/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const seg of segs) {
    let words = seg.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const first = bareWord(words[0]);
    if (words.length > 1 && CONNECTIVES.has(first)) { out.push(words[0]); words = words.slice(1); }
    out.push(...wrapWords(words, maxChars));
  }
  return out.length ? out : [t];
}

/**
 * 줄 배열을 훑어 「끊으면 안 되는 자리」를 신고한다. 테스트·회귀 측정용.
 *   → [{ i, why, a, b }]  (i = 줄 인덱스, a/b = 갈라진 두 줄)
 */
function auditCaptionLines(lines) {
  const bad = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const cw = String(lines[i]).split(/\s+/).filter(Boolean);
    const nw = String(lines[i + 1]).split(/\s+/).filter(Boolean);
    if (!cw.length || !nw.length) continue;
    const b = boundaryAt([...cw, ...nw], cw.length - 1);
    if (b.banned || b.score < 0) bad.push({ i, why: b.why, a: lines[i], b: lines[i + 1] });
  }
  return bad;
}

module.exports = { splitCaptionLines, meaningfulLen, auditCaptionLines, boundaryAt, CONNECTIVES };

// ⚠ 「스크립트로 직접 실행했을 때만 도는 자기검사」 블록을 여기 두지 않는다.
//   이 파일은 렌더러 번들(Vite)에도 들어가고, commonjs 변환이 그 CJS 런타임 참조를 브라우저로
//   그대로 내보내 `require is not defined` → **화면이 백지가 된다**(2026-08-24 실측).
//   눈으로 확인하려면 test/caption-break.test.js 를 돌릴 것.
