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

/** 카테고리 문자열 → 후보 목록에서 가장 알맞은 것(정확 일치 > 끝 일치 > 포함). 없으면 '' */
function pickOption(want, options) {
  const w = String(want || '').trim();
  if (!w) return '';
  const ex = options.find((o) => o.trim() === w); if (ex) return ex;
  const end = options.find((o) => o.trim().endsWith(' - ' + w)); if (end) return end;
  const inc = options.find((o) => o.includes(w) && !/^-\s/.test(o.trim())); if (inc) return inc;
  return '';
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
  const step1 = { color, trim, material, wings: false, pages: Number(c.pages) || 0 };
  const hasIsbn = has(m.isbn);
  const step2 = {
    title: cleanTitle(m.title || (book && book.fileTitle) || ''),
    subtitle: cleanTitle(m.subtitle),
    author: m.author || '',
    purpose: 'external',                       // ISBN 출판 판매용 (외부유통 가능)
    isbnMode: hasIsbn ? 'other' : 'bookk',     // 부크크 무료 ISBN / 보유 ISBN
    isbn: hasIsbn ? m.isbn : '',
    genre: m.category || '',                   // 부크크 선택지와 대조는 브라우저에서 (옵션 텍스트가 계층형)
    adult: 'all',
    pages: Number(c.pages) || 0,
    pdf: c.interiorPdf || '',
  };
  const manual = [];
  if (!step1.pages) manual.push('쪽수(내지 PDF 를 먼저 만드세요)');
  if (!step2.title) manual.push('도서명(필수)');
  if (!step2.author) manual.push('저자(필수)');
  if (!step2.pdf) manual.push('내지 PDF 업로드(파일 없음)');
  if (hasIsbn) manual.push('보유 ISBN 입력칸(2단계에서 직접)');
  manual.push('대표 장르(필수 — 카테고리가 목록과 안 맞으면)', '3단계 표지 등록 · 4단계 가격 · 5단계 최종확인·제출');
  return { step1, step2, manual };
}

module.exports = { JAKKAWA_CATEGORIES, BOOKK_MATERIAL, cleanTitle, cleanBody, sectionText, tocText, kstDatePlus, normDate, pickOption, jakkawaPlan, bookkPlan };
