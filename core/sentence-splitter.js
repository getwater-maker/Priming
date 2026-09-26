/**
 * 한국어 텍스트 → 문장 배열
 *
 * 분할 규칙 (1문장 = 1클립 원칙):
 *   1. 마크다운 헤더 (#, ##, ###, ...) 줄은 통째 제거 (제목·소제목은 본문 아님)
 *   2. 따옴표/특수 인용부호는 모두 제거 (대화체에서 따옴표가 단독 문장이 되는 사고 방지)
 *   3. 빈 줄(\n\s*\n) 은 강제 단락 구분
 *   4. 한 단락 안의 단순 줄바꿈(\n)은 같은 문장의 일부 → 공백으로 변환
 *   5. 종결부호 (. ! ? 。) 기준 분할
 *   6. 종결부호 없이 단락이 끝나면 단락 전체가 한 문장 (긴 문장 → algo-splitter 로 vrewClips 분할)
 *
 * 변경 이력:
 *   - v1: 줄바꿈 우선 → 시·대화체에서 한 문장이 여러 줄로 잘림 (잘못)
 *   - v2: 종결부호 우선, 줄바꿈은 공백
 *   - v3: 마크다운 헤더 제거 + 따옴표 제거 (사용자 요청)
 */

// 다양한 따옴표/인용부호. 한국어 대본에서 자주 나오는 것들.
//   " " ' '  영문 직립
//   " " ' '  유니코드 곡선
//   『 』 「 」  일본·한국 인용
//   ‹ › « »  유럽
const QUOTE_CHARS = /["'""''‘’“”『』「」‹›«»]/g;

// 마크다운 헤더: 줄 시작 # ~ ###### + 공백 + 본문
const MARKDOWN_HEADER_LINE = /^\s{0,3}#{1,6}\s.*$/gm;

// 대괄호 섹션 마커: 줄 전체가 [텍스트] 인 경우만 인식 (인라인 제외)
const BRACKET_SECTION_RE = /^\s*\[([^\]]+?)\]\s*$/;

// 화자 표기: 줄 맨 앞 `[이름] 대사` — 그 줄의 문장을 채널이 그 이름에 연결한 목소리로 읽는다(2026-09-24).
//   🔑 대괄호**만** 있는 줄은 지금처럼 섹션이다(BRACKET_SECTION_RE). 뒤에 공백 + 대사가 있어야 화자다.
//   🔑 이름은 한글·영문(공백·가운뎃점 허용, 12자) — 숫자·콜론을 막아 `[1] 도입`·`[카테고리]: …` 같은 메모를 화자로 오인하지 않는다.
//   🔑 **그 줄에만** 적용한다 — 다음 줄 내레이션을 빈 줄 없이 이어 써도 화자가 새지 않게. 한 대사는 한 줄에.
//   ⚠ 2026-09-24 실측: 채널 대본 폴더의 .md 에 이 모양 줄은 0개(레거시 무영향).
const SPEAKER_LINE_RE = /^\s*\[([가-힣A-Za-z][가-힣A-Za-z ·]{0,11})\]\s+(\S.*)$/;

// TTS 가 발음 어색한 특수문자 제거 — 일반 문장기호는 보존, 이모지/기호 제거.
//   - 이모지 (다양한 유니코드 블록)
//   - 화살표·도형·기호 (★ ※ § © ® ™ ♬ ♪ ◆ ▶ → 등)
const SPECIAL_NONTEXT = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}★☆※§©®™♬♪♫♩♭♯◆◇■□●○▲▼▶◀※❶❷❸❹❺❻❼❽❾❿]/gu;

// TTS 제외 메모 — HTML 주석 `<!-- ... -->` 은 대본에 써도 음성/자막/클립으로 만들지 않음.
//   (연출 메모·안 읽을 부분. 여러 줄 가능. Book Publishing 책에도 안 보임.)
//   분할 직전에 제거하므로 문장 자체가 생성되지 않음.
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
// 화살괄호(>)로 시작하는 줄 = 지침/연출 주석 → 내레이션·자막·그룹에서 제외 (대본 규약).
const BLOCKQUOTE_LINE = /^[ \t]*>.*$/gm;
// 대본 내 이미지/영상 프롬프트 블록쿼트 — '> 🖼️ 이미지: …' / '> 🎬 비디오(I2V): …'.
//   이모지 무관·키워드 기반으로 추출. 나머지 '>' 줄은 일반 지침 주석으로 제외.
const PROMPT_IMG_RE = /^[ \t]*>.*?이미지\s*[:：]\s*(.+)$/;
const PROMPT_VID_RE = /^[ \t]*>.*?(?:비디오|영상)[^:：]*[:：]\s*(.+)$/;
const BLOCKQUOTE_TEST = /^[ \t]*>/;
function _stripNonTts(text) {
  return (typeof text === 'string') ? text.replace(HTML_COMMENT, '').replace(BLOCKQUOTE_LINE, '') : text;
}

/**
 * 단락 텍스트 → 문장 배열 (내부 헬퍼)
 */
function _paragraphsToSentences(text) {
  let cleaned = text
    .replace(HTML_COMMENT, '')        // <!-- 메모 --> = TTS 제외
    .replace(MARKDOWN_HEADER_LINE, '')
    .replace(QUOTE_CHARS, '')
    .replace(SPECIAL_NONTEXT, '');   // 이모지·기호 제거 (TTS 발음 자연스럽게)
  const paragraphs = cleaned
    .split(/\r?\n\s*\r?\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const sentences = [];
  for (const para of paragraphs) {
    const flat = para.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (!flat) continue;
    const matches = flat.match(/[^.!?。]+[.!?。]+|[^.!?。]+$/g);
    if (matches && matches.length > 0) {
      for (const m of matches) {
        const trimmed = m.trim();
        if (trimmed && /[가-힣A-Za-z0-9]/.test(trimmed)) sentences.push(trimmed);
      }
    } else {
      sentences.push(flat);
    }
  }
  return sentences;
}

/**
 * @param {string} text
 * @returns {string[]} 문장 텍스트 배열
 */
function splitIntoSentences(text) {
  if (!text || typeof text !== 'string' || !text.trim()) return [];
  return _paragraphsToSentences(text);
}

/**
 * 대괄호 섹션 마커를 인식하여 섹션별로 분할.
 * 각 문장에 sectionTitle 을 첨부해 반환.
 *
 * @param {string} text
 * @returns {{ items: Array<{text:string, sectionTitle:string|null}>, hasSections: boolean }}
 */
function splitWithSections(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { items: [], hasSections: false };
  }
  text = _stripNonTts(text);   // <!-- 메모 --> 제거 (여러 줄 주석을 라인 스캔 전에)

  const lines = text.split(/\r?\n/);
  const segments = []; // [{title, text}]
  let currentTitle = null;
  let lineBuffer = [];

  for (const line of lines) {
    const m = line.match(BRACKET_SECTION_RE);
    if (m) {
      segments.push({ title: currentTitle, text: lineBuffer.join('\n') });
      lineBuffer = [];
      currentTitle = m[1].trim();
    } else {
      lineBuffer.push(line);
    }
  }
  segments.push({ title: currentTitle, text: lineBuffer.join('\n') });

  const hasSections = segments.some(seg => seg.title !== null);

  const items = [];
  for (const seg of segments) {
    const sentenceTexts = _paragraphsToSentences(seg.text);
    for (const t of sentenceTexts) {
      items.push({ text: t, sectionTitle: seg.title });
    }
  }

  return { items, hasSections };
}

// 마크다운 헤더 — 그룹1=#들(레벨), 그룹2=헤더 텍스트. (도입부 자동 인식 + 레벨 전파용)
const HEADER_LINE_CAPTURE = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/;

/**
 * 마크다운 헤더의 텍스트에 "도입" 이 들어있으면 그 헤더 이후 ~ 다음 헤더 전까지를
 * "도입부" 로 마킹. 헤더 자체는 sentence 에 포함되지 않음 (기존 동작과 동일).
 *
 * 예시:
 *   # 도입부
 *   첫 도입 문장입니다.
 *   두 번째 도입 문장입니다.
 *
 *   ## 1장 시작
 *   본론 첫 문장입니다.
 *
 *   → items: [
 *       { text: "첫 도입 문장입니다.",   isIntro: true },
 *       { text: "두 번째 도입 문장입니다.", isIntro: true },
 *       { text: "본론 첫 문장입니다.",   isIntro: false },
 *     ], hasIntro: true
 *
 * @param {string} text
 * @returns {{ items: Array<{text:string, isIntro:boolean}>, hasIntro: boolean }}
 */
function splitIntoSentencesWithIntro(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { items: [], hasIntro: false };
  }
  text = _stripNonTts(text);   // <!-- 메모 --> 제거 (여러 줄 주석을 라인 스캔 전에)
  const lines = text.split(/\r?\n/);

  // 줄들을 헤더 기준으로 블록 분할 → 각 블록에 isIntro 플래그
  const blocks = [];
  let introRegion = false;
  let curIntro = false;
  let curLines = [];
  const flush = () => {
    if (curLines.length > 0) blocks.push({ isIntro: curIntro, lines: curLines });
  };
  for (const line of lines) {
    const m = line.match(HEADER_LINE_CAPTURE);
    if (m) {
      flush();
      // H1/H2 가 도입 영역을 토글, H3+ 는 상위 영역 유지 → '## 도입부' 아래 '### …' 들도 도입부로 인식.
      if (m[1].length <= 2) introRegion = /도입/.test(m[2]);
      curIntro = introRegion;
      curLines = [];
    } else {
      curLines.push(line);
    }
  }
  flush();

  const items = [];
  let hasIntro = false;
  for (const blk of blocks) {
    const blockText = blk.lines.join('\n');
    const sents = _paragraphsToSentences(blockText);
    for (const t of sents) items.push({ text: t, isIntro: blk.isIntro });
    if (blk.isIntro && sents.length > 0) hasIntro = true;
  }
  return { items, hasIntro };
}

/**
 * 하이브리드 분할 — md 헤더 + 대괄호 마커 동시 인식.
 *
 * 동작:
 *  - 줄 단위 스캔
 *  - 마크다운 헤더 (#, ##, ...) 발견 → md 블록 시작 (도입 키워드 있으면 isIntro=true)
 *  - 대괄호 마커 [제목] 발견 → bracket 블록 시작 (sectionTitle 저장)
 *  - 그 외 줄은 현재 블록 본문에 누적
 *
 *  각 sentence 에 mode/isIntro/sectionTitle 부여. 대괄호 마커 자체는 sentence 에서
 *  제외 (헤더와 동일 처리).
 *
 * @param {string} text
 * @returns {{
 *   items: Array<{text:string, mode:'md'|'bracket', isIntro:boolean, sectionTitle:string|null}>,
 *   hasBrackets: boolean,
 *   hasMdIntro: boolean
 * }}
 */
function splitHybrid(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { items: [], hasBrackets: false, hasMdIntro: false };
  }
  text = String(text).replace(HTML_COMMENT, '');   // HTML 주석만 먼저 제거 (블록쿼트 프롬프트는 라인 루프에서 추출)
  const lines = text.split(/\r?\n/);

  // 블록: { mode, isIntro, sectionTitle, lines, imagePrompt, videoPrompt }
  const blocks = [];
  let introRegion = false;  // H1/H2 '도입' 영역 여부 — H3+ 는 이 값을 상속
  let h2Idx = 0;            // H1/H2 마다 증가 — 'h2' 분할의 섹션 키 (H3+ 는 상위 H2 유지)
  let h2Title = '';         // 가장 최근 H1/H2 제목 — h2 그룹 라벨용
  const newBlock = (o) => ({ mode: 'md', isIntro: false, sectionTitle: null, h2Key: h2Idx, h2Title, lines: [], imagePrompt: null, videoPrompt: null, ...o });
  let cur = newBlock({});
  const flush = () => {
    if (cur.lines.length > 0 || cur.mode === 'bracket') blocks.push(cur);
  };

  for (const line of lines) {
    // 대본 내 이미지/영상 프롬프트 추출 ('> 🖼️ 이미지: …' / '> 🎬 비디오(I2V): …') → 현재 섹션에 부착.
    const imgM = line.match(PROMPT_IMG_RE);
    if (imgM) { cur.imagePrompt = imgM[1].trim(); continue; }
    const vidM = line.match(PROMPT_VID_RE);
    if (vidM) { cur.videoPrompt = vidM[1].trim(); continue; }
    if (BLOCKQUOTE_TEST.test(line)) continue;   // 그 외 '>' 줄 = 일반 지침 주석 → 제외
    const spkM = line.match(SPEAKER_LINE_RE);
    if (spkM) { cur.lines.push({ speaker: spkM[1].trim(), text: spkM[2] }); continue; }
    const bracketM = line.match(BRACKET_SECTION_RE);
    const headerM = line.match(HEADER_LINE_CAPTURE);
    if (bracketM) {
      flush();
      cur = newBlock({ mode: 'bracket', sectionTitle: bracketM[1].trim() });
    } else if (headerM) {
      flush();
      // H1/H2 가 도입 영역 토글 + h2 섹션 키·제목 갱신, H3+ 는 상위 H2 값을 상속.
      // 📏 H1 뒤 글자 수 표기(`# 제목 / 15,761 자`)는 제목이 아니다 — 챕터·배지 이름에서 뺀다.
      const hText = headerM[1].length === 1 ? stripCharCountTail(headerM[2]) : headerM[2].trim();
      if (headerM[1].length <= 2) { introRegion = /도입/.test(headerM[2]); h2Idx++; h2Title = hText; }
      // 마크다운 헤더(섹션명)는 sectionTitle 로 보존 → 그룹 배지에 섹션 내용 표시.
      cur = newBlock({ mode: 'md', isIntro: introRegion, sectionTitle: hText });
    } else {
      cur.lines.push(line);
    }
  }
  flush();

  const items = [];
  let hasBrackets = false;
  let hasMdIntro = false;
  for (const blk of blocks) {
    // 화자 줄은 앞뒤 문단과 섞지 않고 따로 문장화한다(같은 문단으로 이어 붙이면 내레이션과 한 문장이 된다).
    const sents = [];   // [{ t, speaker }]
    let buf = [];
    const flushBuf = () => { for (const t of _paragraphsToSentences(buf.join('\n'))) sents.push({ t, speaker: null }); buf = []; };
    for (const ln of blk.lines) {
      if (ln && typeof ln === 'object') { flushBuf(); for (const t of _paragraphsToSentences(ln.text)) sents.push({ t, speaker: ln.speaker }); }
      else buf.push(ln);
    }
    flushBuf();
    if (sents.length === 0) continue;   // 본문 없는 블록(헤더/프롬프트만)은 그룹 생성 X
    sents.forEach(({ t, speaker }, i) => {
      items.push({
        text: t,
        speaker,
        mode: blk.mode,
        isIntro: blk.isIntro,
        sectionTitle: blk.sectionTitle,
        h2Key: blk.h2Key,       // 상위 H2 섹션 키 (h2 분할용)
        h2Title: blk.h2Title,   // 상위 H2 제목 (h2 그룹 라벨)
        // 섹션 프롬프트는 첫 문장에만 부착(그룹 대표). 그룹화 단계가 그룹별로 흡수.
        imagePrompt: i === 0 ? blk.imagePrompt : null,
        videoPrompt: i === 0 ? blk.videoPrompt : null,
      });
    });
    if (blk.mode === 'bracket' && sents.length > 0) hasBrackets = true;
    if (blk.mode === 'md' && blk.isIntro && sents.length > 0) hasMdIntro = true;
  }
  return { items, hasBrackets, hasMdIntro };
}

// 🔑 인라인 대본 편집(core/script-edit.js)이 **원문에서 문장 위치를 찾을 때** 쓰는 규칙들.
//   여기 정규식이 곧 "파서가 무엇을 버리는가"이므로, 복사해서 쓰면 반드시 어긋난다(두 벌 금지).
//   ⚠ g 플래그가 붙은 것이 있으니 .test() 로 직접 쓰지 말고 .source 로 새 정규식을 만들 것(lastIndex 사고).
const MATCH_PATTERNS = {
  quote: QUOTE_CHARS,                 // 파서가 지우는 따옴표류
  special: SPECIAL_NONTEXT,           // 파서가 지우는 이모지·기호
  htmlComment: HTML_COMMENT,          // <!-- --> = TTS 제외
  headerLine: HEADER_LINE_CAPTURE,    // 마크다운 헤더 줄 (문장 아님)
  bracketLine: BRACKET_SECTION_RE,    // [섹션] 줄 (문장 아님)
  blockquote: BLOCKQUOTE_TEST,        // '>' 줄 = 지침·프롬프트 (문장 아님)
  speakerLine: SPEAKER_LINE_RE,       // [이름] 대사 줄 (접두 [이름] 은 문장 아님)
};

// 📏 대본 H1 뒤 글자 수 표기 — `# 제목 / 15,761 자` (2026-09-26 아도나이로이 로이 지정 · 전 채널).
//   제목 문자열을 쓰는 곳(파일 제목 · 챕터 · 대본 읽기 · 업로드 폴백 제목)은 모두 이것으로 벗긴다.
//   아도나이로이 `대본검사.py` `RE_자수꼬리` 와 같은 식이다 — 한쪽을 바꾸면 둘 다 바꾼다.
const CHAR_COUNT_TAIL_RE = /\s*\/\s*[\d,]+\s*자\s*$/;
function stripCharCountTail(s) { return String(s == null ? '' : s).replace(CHAR_COUNT_TAIL_RE, '').trim(); }

module.exports = { splitIntoSentences, splitWithSections, splitIntoSentencesWithIntro, splitHybrid, MATCH_PATTERNS, stripCharCountTail, CHAR_COUNT_TAIL_RE };
