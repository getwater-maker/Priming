'use strict';
/**
 * book-lang.js — 📖 책 언어(ko · en) · 영어 조판 문구 · 플랫폼×언어 조합 검사 — 2026-10-13 v0.9.0 (해외 플랫폼 R23-0·R23)
 *   원고 메타 `> 언어: en`(기본 ko)이면 조판이 영어 기준이 된다: `lang=en` · 하이픈 · 영어 목차어(Contents)·표제지(by / Translated by)·판권(Published·©)·전자책 문구.
 *   한국어 전용 설정(KoPub 한자 보강·`keep-all`·「제N장」·어절 줄바꿈)은 영어 원고에서 꺼진다.
 *   순수 함수 — fs 없음(렌더러 번들에 들어갈 수 있다).
 */

/** 원고 메타 `언어` 값 → 'ko' | 'en' (없거나 모르면 ko) */
function langOf(meta) {
  const v = String((meta && (meta.lang || meta.language)) || '').trim().toLowerCase();
  if (/^(en|eng|english|영어|영문|영어판)/.test(v)) return 'en';
  return 'ko';
}

// 화면·ePub·판권에 찍히는 문구
const STR = {
  ko: { contents: '목차', endnotes: '미주', coverAlt: '표지', cover: '표지', titlePage: '표제지', colophon: '판권', part: (n) => `제${n}부 `, backToText: '↩ 본문', fnTitle: '각주', legal: '이 책의 내용 중 전부 또는 일부를 재사용하려면 반드시 저작권자의 서면 동의를 얻어야 합니다.' },
  en: { contents: 'Contents', endnotes: 'Notes', coverAlt: 'Cover', cover: 'Cover', titlePage: 'Title Page', colophon: 'Copyright', part: (n) => `Part ${n} `, backToText: '↩ Back to text', fnTitle: 'Notes', legal: 'No part of this book may be reproduced without the written permission of the copyright holder, except for brief quotations in reviews or scholarly works.' },
};
const str = (lang, key) => (STR[lang] || STR.ko)[key];

/** 표제지 — 지은이·옮긴이 줄. ko: 「저자 지음」「역자 옮김」 · en: 「by Author」「Translated by X」 */
function byLine(lang, author) {
  if (!author) return '';
  return lang === 'en' ? `by ${author}` : `${author} 지음`;
}
function translatorLine(lang, translator, label) {
  if (!translator) return '';
  if (lang === 'en') return label === '편역이' ? `Edited and translated by ${translator}` : `Translated by ${translator}`;
  return `${translator} ${label === '편역이' ? '편역' : '옮김'}`;
}

// 판권 행 라벨(한국어 → 영어). 한국 서식 전용 칸(발행인·출판등록·팩스·교환 안내)은 영어판에선 값이 있을 때만 나온다.
const COL_EN = {
  '지은이': 'Author', '옮긴이': 'Translator', '편역': 'Edited and translated by', '편역자': 'Translator', '편역이': 'Edited and translated by', '역자': 'Translator', '엮은이': 'Edited by',
  '발행인': 'Publisher', '편집인': 'Editor', '발행처': 'Publisher', '등록': 'Registration', '주소': 'Address', '전화': 'Phone', '팩스': 'Fax',
  '대표메일': 'Email', '홈페이지': 'Website', '블로그': 'Blog', '페이스북': 'Facebook', '인스타그램': 'Instagram', '정가': 'Price', '전자책': 'E-book', '발행일': 'Published',
  'ISBN': 'ISBN',
};
function colLabel(lang, ko) { return lang === 'en' ? (COL_EN[ko] || ko) : ko; }

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** 발행일 → 영어 「October 6, 2026」 (모르는 모양은 그대로 · 이미 영어 날짜면 그대로) */
function formatEn(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^((?:19|20)\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\s*\.?(.*)$/);
  if (!m) m = s.match(/^((?:19|20)\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일(.*)$/);
  if (!m) return s;
  const mo = Number(m[2]), da = Number(m[3]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return s;
  const rest = String(m[4] || '').trim();
  return `${MONTHS_EN[mo - 1]} ${da}, ${m[1]}${rest ? ' ' + rest : ''}`;
}
const formatDate = (lang, v, koFmt) => (lang === 'en' ? formatEn(v) : koFmt(v));

// ── 플랫폼 × 언어 ─────────────────────────────────────────────────────────────
//   값은 이 한 곳(해외플랫폼_가이드 §0 · 2026-10-13 공식 확인). 출처: https://kdp.amazon.com/en_US/help/topic/G200673300 (KDP 지원 언어 — 한국어 행 없음)
//   langs = 받는 언어 · null = 확인 못 함(❓ — 막지 않고 알린다).
const PLATFORM_LANGS = {
  kdp: { langs: ['en'], label: 'Amazon KDP', note: 'KDP는 한국어 책을 받지 않습니다(지원 언어 목록에 한국어가 없습니다) — 영어책으로 만드세요(원고 메타 `> 언어: en`)' },
  d2d: { langs: null, label: 'Draft2Digital', note: 'D2D 가 한국어를 받는지는 공식 문서에서 확인하지 못했습니다 — 계정의 책 정보 화면 언어 목록에서 확인하세요' },
};
/**
 * 플랫폼 × 언어 조합 점검 → [{state:'error'|'warn', text}] (문제가 없으면 [])
 *   KDP + ko = error(반려 · 언어를 영어로 속여 올리지 않는다) · D2D + ko = warn(미확인).
 */
function platformLangIssues(platformId, lang) {
  const p = PLATFORM_LANGS[platformId];
  if (!p) return [];
  if (p.langs && !p.langs.includes(lang)) return [{ state: 'error', text: `${p.label}: ${p.note}` }];
  if (!p.langs && lang !== 'en') return [{ state: 'warn', text: `${p.label}: ${p.note}` }];
  return [];
}

/** 원고 메타 `판형` 글 → 인치 판형 키(「6×9」「6 x 9」「6"x9"」「5.5 x 8.5 in」 → 「6x9」「5.5x8.5」). 인치 꼴이 아니면 null */
function normInchTrim(v) {
  const s = String(v == null ? '' : v).toLowerCase().replace(/inches|inch|in\b|["”″″']/g, '').replace(/[×✕*]/g, 'x').replace(/\s+/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = (x) => String(Number(x));
  return `${n(m[1])}x${n(m[2])}`;
}

module.exports = { langOf, STR, str, byLine, translatorLine, colLabel, formatEn, formatDate, PLATFORM_LANGS, platformLangIssues, normInchTrim };
