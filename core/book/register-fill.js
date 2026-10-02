'use strict';
/**
 * register-fill.js — 📤 등록 도우미 「자동 입력」의 **입력 계획**(순수 함수).
 *   무엇을 어느 칸에 넣을지만 정한다 — 브라우저는 register-browser.js 가 돌린다.
 *
 * 근거: 2026-09-30 로이가 로그인한 화면에서 실측한 입력칸.
 *   - 작가와 「도서정보 입력」(making-books1, Softr+MUI): 칸 이름 G-xxxx 는 폼에 묶인 고정 ID, MUI 선택 상자는 role=button → role=option.
 *   - 부크크 「새종이책」(/author/make/paperBook): 1단계 = 카드 클릭 + 쪽수 → 「Step2 원고등록」(= 임시서재에 초안 생성) → 2단계 폼 + PDF 업로드.
 *     3~5단계(표지·가격·최종확인)는 원고 파일을 올려야 열려서 아직 실측하지 못했다 → 자동화는 2단계 업로드까지만.
 * 🔴 저장·제출·유통 신청·최종 입점 버튼은 절대 누르지 않는다(로이 몫). 못 채운 칸은 「직접」 목록으로 돌려준다.
 */

const has = (v) => v != null && String(v).trim() !== '';

// 작가와 카테고리(실측 15개) — 로그인 화면의 선택지
const JAKKAWA_CATEGORIES = ['건강', '경제, 경영', '그림/동화', '기술, 공학', '사진/예술', '사회과학', '생활/취미', '소설', '시', '에세이', '인문', '자기계발', '자연과학', 'IT/프로그래밍'];

/** 도서명 정리 — 작가와 안내: 쉼표·! ? '' 와 『 』[ ] 같은 특수 기호는 피한다, 끝 공백·연속 공백 금지 */
function cleanTitle(s) {
  return String(s || '').replace(/[『』「」\[\]<>《》,!?'"‘’“”]/g, ' ').replace(/\s+/g, ' ').trim();
}
/** 작가와 「모든 정보 란」: 『 』[ ] 특수 기호 제거 */
function cleanBody(s) {
  return String(s || '').replace(/[『』\[\]]/g, '').replace(/[ \t]+\n/g, '\n').trim();
}
/** 섹션 블록 → 평문(문단 사이 빈 줄) */
function sectionText(sec) {
  if (!sec) return '';
  return (sec.blocks || []).map((b) => (b && (b.text || (b.items && b.items.map((i) => i.text || i).join('\n')))) || '').filter(Boolean).join('\n\n');
}
function findSection(book, key) {
  return [...(book.front || []), ...(book.back || []), ...(book.covers || [])].find((s) => s.key === key) || null;
}
/** 작가와 목차 입력 규칙 — 더블 스페이스(서점에서 「?」로 보임)·꺾쇠·대괄호 같은 특수문자(「&」로 보임) 금지 */
function cleanTocLine(t) {
  return String(t || '').replace(/[『』「」\[\]<>《》]/g, '').replace(/\s+/g, ' ').trim();
}
function tocText(book) {
  return (book.parts || []).flatMap((p) => p.chapters).map((c) => cleanTocLine(c.title)).filter(Boolean).join('\n');
}
function digits(s) { return String(s || '').replace(/[^0-9]/g, ''); }
/** KST 오늘 + n일 → YYYY.MM.DD */
function kstDatePlus(n, now) {
  const t = new Date((now ? now.getTime() : Date.now()) + 9 * 3600e3 + n * 86400e3);
  const p = (x) => String(x).padStart(2, '0');
  return `${t.getUTCFullYear()}.${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())}`;
}
function normDate(s) {
  const m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}.${m[2].padStart(2, '0')}.${m[3].padStart(2, '0')}` : '';
}

// 부크크 2단계 「대표 장르(필수)」 기본값 — 로이가 지정(2026-10-02, 화면: 「소설 - 고전 문학」). 원고 `> 카테고리:` 가 있고 목록에 맞으면 그것이 이긴다.
const BOOKK_DEFAULT_GENRE = '소설 - 고전 문학';
/** 카테고리 문자열 → 후보 목록에서 가장 알맞은 것(정확 일치 > 끝 일치 > 포함). 없으면 '' */
function pickOption(want, options) {
  const w = String(want || '').trim();
  if (!w) return '';
  const ex = options.find((o) => o.trim() === w); if (ex) return ex;
  const end = options.find((o) => o.trim().endsWith(' - ' + w)); if (end) return end;
  const inc = options.find((o) => o.includes(w) && !/^-\s/.test(o.trim())); if (inc) return inc;
  return '';
}

// 부크크 5단계 「최종확인」 — 로이가 실측 화면(2026-10-02)과 함께 정한 값.
//   AI 사용여부(선택지: 본문 전체 / 표지 및 본문 일부 / 본문 일부 / 표지 이미지에만 / 사용하지 않음) = 「표지 및 본문 일부 작성에 사용」,
//   초상/저작권 보유여부(보유중 / 보유하지 않음) = 「모든 콘텐츠 초상/저작권 보유중」(직접 만든 책이라는 로이의 판단 — 코드가 임의로 바꾸지 않는다).
const BOOKK_AI_DEFAULT = '표지 및 본문 일부 작성에 사용';
const BOOKK_RIGHTS = '모든 콘텐츠 초상/저작권 보유중';
/** 원고 메타 `> AI사용:` → 부크크 AI 선택지(없거나 「있음」이면 기본). 선택지 글자는 앞 이모지를 뺀 부분 */
function bookkAiOption(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return BOOKK_AI_DEFAULT;
  if (/^(없음|no|false|x|off)$/i.test(t) || /사용하지\s*않/.test(t)) return '사용하지 않음';
  if (/표지.*본문|본문.*표지/.test(t)) return BOOKK_AI_DEFAULT;
  if (/표지/.test(t)) return '표지 이미지에만 사용';
  if (/전체/.test(t)) return '본문 전체 작성에 사용';
  if (/일부/.test(t)) return '본문 일부 작성에 사용';
  return BOOKK_AI_DEFAULT;
}

/**
 * 작가와 「도서정보 입력」 계획.
 *  book = parseBookText 결과(meta·parts·back·covers) · ctx = { fileType:'EPUB'|'PDF', now? }
 * @returns {{fields:Array, manual:string[]}}  fields[].kind: text|textarea|select
 */
function jakkawaPlan(book, ctx) {
  const m = (book && book.meta) || {};
  const c = ctx || {};
  const ai = /^(있음|yes|true|ai)/i.test(String(m.aiDisclosure || ''));
  const fields = [];
  const add = (name, label, kind, value, note) => fields.push({ name, label, kind, value: value == null ? '' : String(value), note: note || '' });
  const titleRaw = m.title || (book && book.fileTitle) || '';
  const title = cleanTitle(titleRaw);
  add('G-a94bbc87', '도서명', 'text', title, title !== titleRaw.trim() ? '특수기호·쉼표를 뺐습니다' : '');
  add('G-9e6b8f43', '도서 부제', 'text', cleanTitle(m.subtitle));
  add('G-dfb377a7', '출판예정일', 'text', normDate(m.issueDate) || kstDatePlus(3, c.now), normDate(m.issueDate) ? '' : '발행일이 없어 오늘+3일(KST)로 넣었습니다 — 「최종 유통신청」 3일 뒤로 맞추세요');
  const cat = pickOption(m.category, JAKKAWA_CATEGORIES);
  add('G-04409f96', '도서 카테고리', 'select', cat, cat ? '' : (has(m.category) ? `「${m.category}」는 작가와 목록에 없습니다` : ''));
  add('G-06715b3d', '세부 카테고리', 'text', has(m.category) && !cat ? m.category : (has(m.keywords) ? String(m.keywords).split(',')[0].trim() : ''));
  add('G-c5e7c7b5', '파일 유형', 'select', c.fileType === 'PDF' ? 'PDF' : 'EPUB');
  add('G-9abd07fd', '저자 구분', 'select', '개인 저자');
  add('G-eb7ac081', '저자명(필명)', 'text', has(m.author) ? (ai ? `${m.author}, AI` : m.author) : '', ai ? 'AI 활용 표기(작가와 정책)' : '');
  add('G-de7cf940', '가격', 'text', digits(m.ebookPrice), '추후 변경 불가 — 원 단위 숫자만');
  add('G-0bf9a6df', '연령제한', 'select', '제한없음');
  add('G-b76769d1', 'ISBN', 'text', m.ebookIsbn || '', has(m.ebookIsbn) ? '' : '비워 두면 작가와가 발급(2~3일)');
  add('G-bb792321', '출판사', 'text', has(m.ebookIsbn) ? (m.publisher || '') : '', 'ISBN을 받은 출판사일 때만');
  add('G-2ff02152', '저자소개', 'textarea', cleanBody(sectionText(findSection(book, 'authorBio'))));
  add('G-cd280027', '목차', 'textarea', cleanBody(tocText(book)));
  const back = cleanBody(sectionText(findSection(book, 'backCover'))) || cleanBody(m.tagline || '');
  const intro = (ai ? '본 도서는 AI를 활용했으니 구매 전에 참고해주세요.\n' : '') + back;
  add('G-7a571d59', '책 소개', 'textarea', intro.trim(), ai ? '첫 줄에 AI 활용 안내를 넣었습니다' : '');
  const manual = fields.filter((f) => !f.value && /^(G-a94bbc87|G-dfb377a7|G-eb7ac081|G-de7cf940|G-2ff02152|G-cd280027|G-7a571d59)$/.test(f.name)).map((f) => f.label + '(필수)');
  if (!fields.find((f) => f.name === 'G-04409f96').value) manual.push('도서 카테고리');
  return { fields, manual };
}

const BOOKK_MATERIAL = {
  '스노우 250g 무광코팅': '스노우(대중적인)', '아르떼 210g 무광코팅': '아르떼(감성적인)', '스노우 250g 유광코팅': '스노우(광택있는)',
};
/** 부크크 「새종이책」 계획 — 1단계 카드 + 2단계 폼 */
function bookkPlan(book, ctx) {
  const m = (book && book.meta) || {};
  const c = ctx || {};
  const color = /컬러/.test(String(m.printColor || '')) ? '컬러' : '흑백';
  const material = BOOKK_MATERIAL[m.coverMaterial] || BOOKK_MATERIAL['스노우 250g 무광코팅'];
  const trim = c.trimId || 'A5';
  // 날개 = 원고 메타 `날개`(bookSpec 과 같은 판정 — 없음·no·off·false·x 가 아니면 켬). 부크크 A4 는 날개 불가 → 켜져 있어도 누르지 않고 알린다.
  const flapsOn = has(m.flaps) && !/^(없음|no|off|false|x)$/i.test(String(m.flaps).trim());
  const wings = flapsOn && trim !== 'A4';
  const step1 = { color, trim, material, wings, pages: Number(c.pages) || 0 };
  const hasIsbn = has(m.isbn);
  const step2 = {
    title: cleanTitle(m.title || (book && book.fileTitle) || ''),
    subtitle: cleanTitle(m.subtitle),
    author: m.author || '',
    purpose: 'external',                       // ISBN 출판 판매용 (외부유통 가능)
    isbnMode: hasIsbn ? 'other' : 'bookk',     // 부크크 무료 ISBN / 보유 ISBN
    isbn: hasIsbn ? m.isbn : '',
    genre: m.category || BOOKK_DEFAULT_GENRE,  // 부크크 선택지와 대조는 브라우저에서 (옵션 텍스트가 계층형) · 원고에 카테고리가 없으면 기본 「소설 - 고전 문학」(로이 2026-10-02)
    genreFallback: BOOKK_DEFAULT_GENRE,        // 원고 카테고리가 부크크 목록과 안 맞으면 이것
    adult: 'all',
    pages: Number(c.pages) || 0,
    pdf: c.interiorPdf || '',
  };
  // 3단계 「표지디자인」(로이 2026-10-02 실측 화면): 탭 무료 표지 / **직접 올리기** / 구매한 템플릿 · 파일 JPG·PDF 만(PNG 불가) · 100MB 이하 · 300dpi ·
  //   화면 「작업규격」 = 가로 518.50mm(앞날개100+뒷표지151+책등16.505+앞표지151+앞날개100) × 세로 216mm(사방 3mm 재단 포함). 우리 표지 PDF 를 올린다(PNG 시안은 올리지 않는다).
  const sp = c.spread || null;
  const step3 = { coverPdf: c.coverPdf || '', expect: sp ? { widthMm: sp.widthMm, heightMm: sp.heightMm, spineMm: sp.spineMm } : null, tab: '직접 올리기', logo: 'blue' };   // 로고 = 파란색(로이 2026-10-02 · 화면 `a[href="#blue"]`)
  // 4단계 「가격정책」(실측 2026-10-02): 정가 입력(최소가격 이상 · 최대 3배 · 100원 단위) · 정가인하 「아니요」 · 외부서점 입점 「네」. 정가는 원고 `> 정가:` — 화면의 최소가격보다 낮으면 올리지 않고 알린다.
  const price = Number(digits(m.price)) || 0;
  const step4 = { price, cut: false, external: true };
  // 5단계 「최종확인」: 도서소개·도서목차·저자경력 + AI 사용·저작권 선택. 🔴 「도서제출」은 누르지 않는다(로이가 직접).
  const intro = cleanBody(sectionText(findSection(book, 'backCover'))) || cleanBody(m.tagline || '');
  const step5 = { intro, toc: cleanBody(tocText(book)), bio: cleanBody(sectionText(findSection(book, 'authorBio'))), ai: bookkAiOption(m.aiDisclosure), rights: BOOKK_RIGHTS };
  // 📋 등록정보 파일(`기준/등록/<권>.등록정보.md`)이 있으면 **원고 메타보다 우선**(R24 · 로이 2026-10-02 — 원고 제목 「삼국지 완역 1 : 천하대란」이 cleanTitle 로 「삼국지」·부제 「1-15」가 된 사고). 값은 파일 그대로(제목 정리 없음).
  const ri = c.registerInfo || null;
  if (ri) {
    const one = (v) => String(v || '').replace(/\s+/g, ' ').trim();
    if (ri.title) { step2.title = one(ri.title); step2.subtitle = one(ri.subtitle); }
    if (ri.author) step2.author = one(ri.author);
    if (ri.genre) step2.genre = one(ri.genre);
    if (ri.purposeText && /ISBN.*판매|출판.*판매/.test(ri.purposeText)) step2.purpose = 'external';
    if (ri.isbnText) {
      const digitsOnly = String(ri.isbnText).replace(/[^0-9Xx]/g, '');
      if (/무료|부크크/.test(ri.isbnText) || digitsOnly.length < 10) { step2.isbnMode = 'bookk'; step2.isbn = ''; }
      else { step2.isbnMode = 'other'; step2.isbn = one(ri.isbnText); }
    }
    if (ri.intro) step5.intro = ri.intro;
    if (ri.toc) step5.toc = ri.toc;
    if (ri.bio) step5.bio = ri.bio;
    if (ri.ai) step5.ai = bookkAiOption(ri.ai);
    if (ri.rights) step5.rights = /보유하지\s*않/.test(ri.rights) ? '초상/저작권 보유하지 않음' : BOOKK_RIGHTS;
  }
  const manual = [];
  if (!step3.coverPdf) manual.push('3단계 표지 PDF(없음 — 먼저 「종이책 PDF」로 표지 PDF 를 만드세요)');
  manual.push('3단계 로고 — 파란색을 자동 선택합니다(안 눌렸으면 직접 · 표지에 로고를 직접 넣었다면 불필요)');
  if (!step1.pages) manual.push('쪽수(내지 PDF 를 먼저 만드세요)');
  if (!step2.title) manual.push('도서명(필수)');
  if (!step2.author) manual.push('저자(필수)');
  if (!step2.pdf) manual.push('내지 PDF 업로드(파일 없음)');
  if (step2.isbnMode === 'other') manual.push('보유 ISBN 입력칸(2단계에서 직접)');
  if (flapsOn && trim === 'A4') manual.push('날개(원고는 날개 있음이지만 부크크 A4 는 날개 불가 — 날개 없이 진행)');
  if (!price) manual.push('4단계 정가(원고 `> 정가:` 없음 — 화면의 최소가격 그대로 둡니다)');
  if (!step5.intro) manual.push('5단계 도서소개(원고 뒤표지 소개·한줄소개 없음)');
  if (!step5.bio) manual.push('5단계 저자경력·소개(원고 저자 소개 없음)');
  manual.push('🔴 5단계 「도서제출」 — 반드시 직접 클릭(자동 제출 금지)');
  return { step1, step2, step3, step4, step5, manual, registerInfoFile: (ri && ri.file) || '', shotDir: c.shotDir || '' };
}

/**
 * 부크크 「새전자책」(/author/make/electronicBook) 계획 — 로이 스크린샷·화면 기록 2026-10-02 실측.
 *   단계: 1 기본정보(종이책 2단계와 같은 칸 · 쪽수·PDF 없음) → 2 원고등록(ePub 첨부 · EPUB2.0만 외부유통 · 20MB) → 3 꾸미기(직접 올리기 = JPG·PDF 10MB · 로고 파랑)
 *   → 4 가격정책(정가 + 「직접 변경」 체크박스 · 외부서점) → 5 최종확인(종이책과 같은 칸). 🔴 「도서제출」은 누르지 않는다.
 *  ctx = { epub, cover(JPG/PDF 경로), registerInfo, shotDir }
 */
function ebookPlan(book, ctx) {
  const m = (book && book.meta) || {};
  const c = ctx || {};
  const hasIsbn = has(m.ebookIsbn);     // 종이책 ISBN 과 별개 — 전자책 ISBN 만 쓴다(없으면 부크크 무료 발급)
  const step1 = {
    title: cleanTitle(m.title || (book && book.fileTitle) || ''),
    subtitle: cleanTitle(m.subtitle),
    author: m.author || '',
    purpose: 'external',
    isbnMode: hasIsbn ? 'other' : 'bookk',
    isbn: hasIsbn ? m.ebookIsbn : '',
    genre: m.category || BOOKK_DEFAULT_GENRE,
    genreFallback: BOOKK_DEFAULT_GENRE,
    adult: 'all',
  };
  const step2 = { epub: c.epub || '', epubName: c.epub ? require('path').basename(c.epub) : '' };
  const step3 = { cover: c.cover || '', logo: 'blue' };
  const price = Number(digits(m.ebookPrice)) || 0;
  const step4 = { price, external: true };
  const intro = cleanBody(sectionText(findSection(book, 'backCover'))) || cleanBody(m.tagline || '');
  const step5 = { intro, toc: cleanBody(tocText(book)), bio: cleanBody(sectionText(findSection(book, 'authorBio'))), ai: bookkAiOption(m.aiDisclosure), rights: BOOKK_RIGHTS };
  const ri = c.registerInfo || null;
  if (ri) {
    const one = (v) => String(v || '').replace(/\s+/g, ' ').trim();
    if (ri.title) { step1.title = one(ri.title); step1.subtitle = one(ri.subtitle); }
    if (ri.author) step1.author = one(ri.author);
    if (ri.genre) step1.genre = one(ri.genre);
    if (ri.intro) step5.intro = ri.intro;
    if (ri.toc) step5.toc = ri.toc;
    if (ri.bio) step5.bio = ri.bio;
    if (ri.ai) step5.ai = bookkAiOption(ri.ai);
    if (ri.rights) step5.rights = /보유하지\s*않/.test(ri.rights) ? '초상/저작권 보유하지 않음' : BOOKK_RIGHTS;
    // ⚠ ISBN(ri.isbnText)은 종이책 값이라 쓰지 않는다
  }
  const manual = [];
  if (!step2.epub) manual.push('2단계 ePub(없음 — 「📦 한 번에 만들기」로 ePub 을 먼저 만드세요)');
  if (!step3.cover) manual.push('3단계 표지(JPG·PDF 10MB 이하 — 원고 `> 전자책표지:` 또는 인쇄 표지에서 앞표지를 크롭한 `_ebook-cover.jpg` 가 없음 · 화면 무료 표지로 직접)');
  if (!step1.title) manual.push('도서명(필수)');
  if (!step1.author) manual.push('저자(필수)');
  if (step1.isbnMode === 'other') manual.push('보유 ISBN 입력칸(1단계에서 직접)');
  if (!price) manual.push('⚠ 4단계 정가 — 원고 `> 전자책:` 가 없어 화면 기본값 1,000원(예시값) 그대로 둡니다. 직접 정하세요');
  if (!step5.intro) manual.push('5단계 도서소개');
  if (!step5.bio) manual.push('5단계 저자경력·소개');
  manual.push('🔴 5단계 「도서제출」 — 반드시 직접 클릭(자동 제출 금지)');
  return { kind: 'ebook', step1, step2, step3, step4, step5, manual, registerInfoFile: (ri && ri.file) || '', shotDir: c.shotDir || '' };
}

module.exports = { ebookPlan, BOOKK_AI_DEFAULT, BOOKK_RIGHTS, bookkAiOption, JAKKAWA_CATEGORIES, BOOKK_MATERIAL, BOOKK_DEFAULT_GENRE, cleanTitle, cleanBody, sectionText, tocText, kstDatePlus, normDate, pickOption, jakkawaPlan, bookkPlan };
