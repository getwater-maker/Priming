'use strict';
/**
 * retail-status.js — 📊 유통 현황(로이 2026-10-14) — 어디에 등록됐고 어디는 시도했으나 못 됐는지, 내 책 링크.
 *   · 부크크 `https://bookk.co.kr/author/reviews/bookRetail`(외부유통 판매시작) 화면을 크롬으로 **읽어** 카드(도서번호·도서명·구분·유통처·상태·신청일·안내문)로 만든다 — 읽기만(아무것도 누르지 않는다).
 *   · 아마존 KDP·D2D 는 자동 조회 없음 → 권마다 수동 상태(미신청/시도중/등록됨/실패)·링크·메모.
 *   · 저장: ~/.priming-maker/book-distribution.json (시험은 PRIMING_DIST_FILE). 순수 함수 + 파일 입출력만(전자 의존 없음).
 * ⚠ 부크크 화면 글자 배열은 로이 스크린샷(2026-10-14) 기준 — 실제 화면과 다르면 `_등록캡처/유통현황_*.txt` 로 원문을 남겨 다음 수정의 근거로 쓴다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const RETAIL_URL = 'https://bookk.co.kr/author/reviews/bookRetail';
const STATUS_RE = /(확인중|처리중|처리완료|반려|취소)/;
const STATUS_KIND = { 확인중: 'progress', 처리중: 'progress', 처리완료: 'done', 반려: 'rejected', 취소: 'canceled' };
const MANUAL_STATES = [['none', '미신청'], ['trying', '시도중'], ['done', '등록됨'], ['failed', '등록 실패']];

function distFile() { return process.env.PRIMING_DIST_FILE || path.join(os.homedir(), '.priming-maker', 'book-distribution.json'); }

/** 카드 하나의 글자 → 항목. 도서번호가 없으면 null(카드가 아니다). */
function parseCard(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const no = (/도서번호\s*(\d+)/.exec(t) || [])[1];
  if (!no) return null;
  const head = t.slice(0, t.indexOf('도서정보') > 0 ? t.indexOf('도서정보') : 80);
  const st = (STATUS_RE.exec(head) || [])[1] || '';
  let retailer = '';
  const rm = /(?:확인중|처리중|처리완료|반려|취소)?\s*(.+?)\s*(?:서점\s*)?판매\s*및\s*유통\s*신청/.exec(head);
  if (rm) retailer = rm[1].replace(STATUS_RE, '').replace(/서점$/, '').trim();
  const pick = (re) => ((re.exec(t) || [])[1] || '').trim();
  return {
    no, status: st, kind: STATUS_KIND[st] || '', retailer,
    title: pick(/표지\s+(.+?)\s+구분\s/), type: pick(/구분\s+(.+?)\s+카테고리\s/),
    category: pick(/카테고리\s+(.+?)\s+(?:저자명|신청\s)/), author: pick(/저자명\s+(.+?)\s+신청\s/),
    applied: pick(/신청\s*(\d{4}\.\d{2}\.\d{2})/), final: pick(/최종\s*(\d{4}\.\d{2}\.\d{2})/),
    message: pick(/최종\s*\d{4}\.\d{2}\.\d{2}\s+(.+?)(?:\s+제출취소|\s+재신청|$)/),
  };
}

/** 화면에서 읽은 카드들({text, links}) → 항목들(같은 도서번호+유통처 중복 제거) */
function parseCards(cards) {
  const out = []; const seen = new Set();
  for (const c of cards || []) {
    const it = parseCard(c && c.text);
    if (!it) continue;
    const k = it.no + '|' + it.retailer + '|' + it.status;
    if (seen.has(k)) continue; seen.add(k);
    it.links = ((c && c.links) || []).filter((l) => l && /^https?:/.test(l.href)).slice(0, 6);
    out.push(it);
  }
  return out;
}

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
/** 현재 원고의 도서명 후보(메타 제목 · 등록정보 도서명)가 항목 도서명과 같은가 — 「삼국지 1 : 천하대란」 ↔ 「삼국지 1」 */
function isMine(item, titles) {
  const it = norm(item.title);
  if (!it) return false;
  return (titles || []).some((t) => { const full = norm(t); const head = norm(String(t || '').split(/\s[:：]\s|[:：]/)[0]); return full === it || head === it; });
}

/** 항목 요약 — 상태별 개수 */
function summarize(items) {
  const s = { done: 0, progress: 0, rejected: 0, canceled: 0, total: 0 };
  for (const it of items || []) { s.total++; if (s[it.kind] != null) s[it.kind]++; }
  return s;
}

function load() {
  try { const j = JSON.parse(fs.readFileSync(distFile(), 'utf8')); return { fetchedAt: j.fetchedAt || '', items: Array.isArray(j.items) ? j.items : [], manual: j.manual && typeof j.manual === 'object' ? j.manual : {} }; }
  catch (_) { return { fetchedAt: '', items: [], manual: {} }; }
}
function save(db) {
  const f = distFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1), 'utf8'); fs.renameSync(tmp, f);
}
function saveItems(items, at) { const db = load(); db.items = items; db.fetchedAt = at || new Date().toISOString(); save(db); return db; }

/** 권별 수동 기록 — channel: kdp|d2d|bookk(링크만)  */
function setManual(key, channel, patch) {
  if (!key || !/^(kdp|d2d|bookk)$/.test(channel)) throw new Error('알 수 없는 유통처');
  const db = load();
  const cur = (db.manual[key] = db.manual[key] || {});
  const c = (cur[channel] = cur[channel] || { state: 'none', link: '', note: '' });
  if (patch.state != null) { if (!MANUAL_STATES.some(([k]) => k === patch.state)) throw new Error('알 수 없는 상태'); c.state = patch.state; }
  if (patch.link != null) { const l = String(patch.link).trim(); if (l && !/^https?:\/\//i.test(l)) throw new Error('링크는 http(s):// 로 시작해야 합니다'); c.link = l; }
  if (patch.note != null) c.note = String(patch.note).slice(0, 300);
  c.at = new Date().toISOString();
  save(db); return db;
}

module.exports = { RETAIL_URL, MANUAL_STATES, parseCard, parseCards, isMine, summarize, load, save, saveItems, setManual, distFile, STATUS_KIND };
