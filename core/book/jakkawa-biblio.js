'use strict';
/**
 * jakkawa-biblio.js — 작가와 「서지정보 페이지」 공식 양식 (jakkawa.com/book-info-guide, 2026-10-01 원문 확인).
 *
 *   출판일 | 2000.00.00            ← ISBN 받은 날과 같게
 *   저자명 | OOO
 *   편집   | OOO   (선택 · 상세 서지정보)
 *   디자인 | OOO   (선택 · 상세 서지정보)
 *   출판사 | 작가와 (계약한 출판사가 있으면 그 출판사)
 *   ISBN   | 작가와에 발급을 신청했다면 빈칸
 *   판매가 | 0,000 원
 *   이 책 내용의 전부 또는 일부를 재사용하려면 반드시 저작권자의 서면 동의를 받아야 합니다.
 *
 * 전자책 판(ePub · 전자책 PDF)의 판권이 이 양식을 그대로 따르게 하는 순수 함수 — 파일·네트워크 없음.
 * register-guide.ebookBiblio(복사용) · html-builder 전자책 판권 · epub-builder 판권이 함께 쓴다.
 */

const has = (v) => v != null && String(v).trim() !== '';

const LEGAL = '이 책 내용의 전부 또는 일부를 재사용하려면 반드시 저작권자의 서면 동의를 받아야 합니다.';

/** 「2026년 10월 1일」·「2026-10-01」 → 「2026.10.01」 (날짜를 못 읽으면 '') */
function normDate(s) {
  const m = String(s || '').match(/((?:19|20)\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}.${m[2].padStart(2, '0')}.${m[3].padStart(2, '0')}` : '';
}

/** 「8000」·「8,000원」 → 「8,000 원」 (양식의 표기) */
function fmtPrice(s) {
  const d = String(s || '').replace(/[^0-9]/g, '');
  return d ? `${Number(d).toLocaleString('en-US')} 원` : '';
}

/** 이 책의 전자책 판이 작가와 서지정보 양식을 따라야 하는가 — 출판사나 플랫폼에 「작가와」가 적힌 경우 */
function isJakkawaMeta(meta) {
  const m = meta || {};
  return /작가와|jakkawa/i.test(`${m.publisher || ''} ${m.platform || ''}`);
}

/**
 * 서지정보 행. opts.placeholder=true 면 빈 칸을 양식의 자리표시(0000.00.00 · OOO · 0,000 원)로 채운다(복사용).
 * 책 안에서는 값이 없는 행을 빼되 ISBN 은 (작가와가 발급하면 빈칸이 정답이라) 항상 둔다.
 * @returns {{rows:Array<[string,string]>, legal:string}}
 */
function biblio(meta, opts) {
  const m = meta || {};
  const ph = !!(opts && opts.placeholder);
  const extra = m.extra || {};
  // 종이책 원고를 그대로 쓴 경우 출판사가 부크크일 수 있다 — 작가와 서지정보의 출판사는 작가와(또는 계약 출판사)
  const publisher = has(m.publisher) && !/부크크|bookk/i.test(m.publisher) ? String(m.publisher).trim() : '작가와';
  const rows = [];
  const add = (label, value, placeholder, always) => {
    const v = has(value) ? String(value).trim() : (ph ? placeholder : '');
    if (v || always) rows.push([label, v]);
  };
  add('출판일', normDate(m.issueDate) || (has(m.issueDate) && ph ? String(m.issueDate).trim() : ''), '0000.00.00');
  add('저자명', m.author, 'OOO');
  if (m.translator) add('옮긴이', m.translator, '');
  add('편집', m.editor, '');
  add('디자인', extra['디자인'] || extra['디자이너'], '');
  add('출판사', publisher, '작가와');
  add('ISBN', m.ebookIsbn, '', true);
  add('판매가', fmtPrice(m.ebookPrice), '0,000 원');
  return { rows, legal: LEGAL };
}

module.exports = { LEGAL, normDate, fmtPrice, isJakkawaMeta, biblio };
