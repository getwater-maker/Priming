'use strict';
/**
 * overseas-register.js — 🇺🇸 KDP·D2D 등록 「복사 도우미」(R27 · 2026-10-13 v0.9.4) — 순수 파싱 + 항목·체크리스트 계산.
 *   부크크 도우미와 달리 **자동 입력·제출은 만들지 않는다**(로이 지시 · 계정·세금·ISBN·가격·제출은 로이). 앱은 항목별 값을 보여 주고 복사 버튼을 주고,
 *   사이트 화면의 해당 칸 이름을 안내한다. 사이트 화면 이름은 공식 도움말 기준(⚠️ 로그인한 화면 확인 전) — 바뀌면 이 표 한 곳만 고친다.
 *   입력값 파일: `<작품>/기준/등록/<원고이름>.KDP등록정보.md` · `.D2D등록정보.md`(출판 세션이 작성) — `## [섹션]`(또는 `## 섹션`) 안의 `- 키: 값` 목록 / 설명·가격은 본문.
 *   원고 메타가 폴백(제목·부제·저자·옮긴이·키워드·카테고리·가격·AI).
 */
const fs = require('fs');
const path = require('path');

const PLATFORM_FILE = { kdp: 'KDP등록정보.md', d2d: 'D2D등록정보.md' };

// ── 파일 읽기 ────────────────────────────────────────────────────────────────
// 키 별칭(공백·대소문자 무시) → 표준 키
const ALIAS = {
  language: ['언어', 'language', '책언어'],
  title: ['제목', '도서명', '책제목', 'title', 'booktitle'],
  subtitle: ['부제', 'subtitle'],
  series: ['시리즈', 'series'],
  edition: ['판', '판차', 'edition', 'editionnumber'],
  author: ['저자', '지은이', 'author', 'authors'],
  contributors: ['기여자', '기여자들', 'contributors', 'contributor'],
  rights: ['출판권', 'publishingrights', 'rights', '저작권상태'],
  publicDomain: ['퍼블릭도메인', 'publicdomain', 'pd', '퍼블릭도메인선언'],
  keywords: ['키워드', 'keywords', '검색어', 'searchterms'],
  categories: ['카테고리', 'categories', '분류'],
  bisac: ['bisac', 'bisac분류'],
  age: ['연령', 'agerange', 'age', '독자연령'],
  ai: ['ai', 'ai신고', 'ai공개', 'aicontent', 'aigeneratedcontent', 'ai사용'],
  publisher: ['출판사', 'publisher', '발행처'],
  isbn: ['isbn', 'isbn방식'],
  price: ['가격', '정가', 'price', 'pricing'],
  description: ['설명', 'description', '도서소개', '책소개'],
  illustrations: ['삽화수', '삽화', 'illustrations', 'illustrationcount'],
};
const normKey = (s) => String(s || '').toLowerCase().replace(/[\s_\-·]+/g, '');
const aliasToKey = (() => { const m = {}; for (const [k, arr] of Object.entries(ALIAS)) for (const a of arr) m[normKey(a)] = k; return m; })();
const BLOCK_KEYS = new Set(['description', 'price']);   // 본문(여러 줄)로 쓰는 섹션

function parseOverseasInfo(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = { fields: {}, lists: {}, sections: [] }; let cur = null; let curKey = null;
  const push = (key, val) => { if (!(key in out.fields)) out.fields[key] = val; };
  for (const raw of lines) {
    const hm = /^#{1,3}\s*\[?([^\]\n]+?)\]?\s*$/.exec(raw);
    if (hm && /^#/.test(raw)) { cur = { name: hm[1].trim(), body: [] }; out.sections.push(cur); curKey = aliasToKey[normKey(cur.name)] || null; continue; }
    if (!cur) { const kv0 = /^\s*[-*]?\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/.exec(raw); if (kv0 && aliasToKey[normKey(kv0[1])]) push(aliasToKey[normKey(kv0[1])], kv0[2]); continue; }
    cur.body.push(raw);
    const kv = /^\s*[-*]\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/.exec(raw);
    if (kv) {
      const key = aliasToKey[normKey(kv[1])];
      if (key) push(key, kv[2]);
      else if (curKey && !BLOCK_KEYS.has(curKey)) { (out.lists[curKey] = out.lists[curKey] || []).push(kv[1].trim() + ': ' + kv[2].trim()); }
      else if (curKey === 'price') (out.lists.price = out.lists.price || []).push(kv[1].trim() + ': ' + kv[2].trim());
    } else if (curKey && !BLOCK_KEYS.has(curKey)) {
      const li = /^\s*[-*]\s+(.*\S)\s*$/.exec(raw); if (li) (out.lists[curKey] = out.lists[curKey] || []).push(li[1]);
    }
  }
  const clean = (arr) => arr.join('\n').replace(/<!--[\s\S]*?-->/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  for (const s of out.sections) { const k = aliasToKey[normKey(s.name)]; if (k === 'description' && !out.fields.description) out.fields.description = clean(s.body); if (k === 'price' && !(out.lists.price || []).length) { const body = clean(s.body); if (body) out.lists.price = body.split('\n').map((x) => x.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean); } }
  return out;
}
/** 원고 → 등록정보 파일 경로 */
function findOverseasInfoFile(scriptPath, platformId) {
  if (!scriptPath || !PLATFORM_FILE[platformId]) return '';
  const dir = path.dirname(path.resolve(scriptPath)), base = path.basename(scriptPath).replace(/\.md$/i, '');
  const name = base + '.' + PLATFORM_FILE[platformId];
  const cands = [];
  if (path.basename(dir) === '원고') cands.push(path.join(path.dirname(dir), '기준', '등록', name));
  cands.push(path.join(dir, name));
  return cands.find((p) => fs.existsSync(p)) || '';
}
function loadOverseasInfo(scriptPath, platformId) {
  const p = findOverseasInfoFile(scriptPath, platformId);
  if (!p) return null;
  const info = parseOverseasInfo(fs.readFileSync(p, 'utf8')); info.file = p; return info;
}

// ── 항목 표(사이트 칸 이름) ──────────────────────────────────────────────────
//   [키, 라벨, 사이트 칸 이름, 단계, 설명]
const SITE = {
  kdp: [
    ['language', '언어', 'Language', '① Kindle eBook/Paperback Details', 'English 만(한국어 불가)'],
    ['title', '책 제목', 'Book Title', '① Details', '퍼블릭 도메인 파생판은 제목 끝에 (Translated)·(Annotated)·(Illustrated) 필수'],
    ['subtitle', '부제', 'Subtitle', '① Details', '선택'],
    ['series', '시리즈', 'Series', '① Details', '선택'],
    ['edition', '판 번호', 'Edition number', '① Details', '선택'],
    ['author', '저자', 'Author — First name / Last name', '① Details', '성·이름 칸이 따로입니다'],
    ['contributors', '기여자(번역가 등)', 'Contributors — Add contributor (Role · name)', '① Details', '번역서는 번역가와 원저자 둘 다 기여자로'],
    ['description', '설명', 'Description', '① Details', '퍼블릭 도메인 책은 80자 이내 글머리 요약으로 시작'],
    ['rights', '출판권', 'Publishing Rights', '① Details', '내가 저작권자 / 퍼블릭 도메인(증명 요구 가능)'],
    ['keywords', '키워드(7)', 'Keywords (7 boxes)', '① Details', '7칸 · 칸마다 한 개'],
    ['categories', '카테고리', 'Categories — Choose categories', '① Details', '최대 3개 ⚠️'],
    ['age', '연령 범위', 'Age and grade range', '① Details', '선택'],
    ['ai', 'AI 생성 콘텐츠', 'AI-Generated Content', '② Content', '텍스트·이미지·번역을 AI 가 「생성」했다면 신고'],
    ['isbn', 'ISBN', 'ISBN (Get a free KDP ISBN / Use my own)', '② Content', '🔏 로이'],
    ['price', '가격', 'Pricing — Primary marketplace · price · royalty', '③ Pricing', '🔏 로이'],
  ],
  d2d: [
    ['language', '언어', 'Language', 'Book Details', '한국어 허용은 미확인 ❓'],
    ['title', '책 제목', 'Title', 'Book Details', ''],
    ['subtitle', '부제', 'Subtitle', 'Book Details', '선택'],
    ['series', '시리즈', 'Series', 'Book Details', '선택'],
    ['edition', '판 번호', 'Edition', 'Book Details', '선택'],
    ['author', '저자', 'Author(s) / Pen name', 'Book Details', ''],
    ['contributors', '기여자(번역가 등)', 'Contributors', 'Book Details', '번역가 포함'],
    ['publisher', '출판사', 'Publisher name', 'Book Details', ''],
    ['description', '설명', 'Description', 'Book Details', ''],
    ['keywords', '검색어', 'Search keywords', 'Book Details', '7개 ⚠️'],
    ['bisac', 'BISAC 분류', 'BISAC categories', 'Book Details', '종이책과 공유'],
    ['age', '연령', 'Age range', 'Book Details', '선택'],
    ['rights', '출판권', 'Rights / Public domain', 'Book Details', ''],
    ['ai', 'AI 신고', 'AI disclosure', 'Book Details', '화면 확인 ❓'],
    ['isbn', 'ISBN', 'ISBN (D2D free ISBN / my own)', 'Print / Ebook', '🔏 로이 · D2D 무료 ISBN 은 D2D 밖에서 쓸 수 없다'],
    ['price', '가격', 'Pricing', 'Pricing', '🔏 로이 · 인쇄판은 무료 가격 불가'],
  ],
};

const splitList = (v) => String(v == null ? '' : v).split(/[;；\n]|,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
const yes = (v) => /^(y|yes|true|1|예|네|있음|퍼블릭|public)/i.test(String(v || '').trim());

/**
 * 항목·체크리스트 계산.
 * @param {{platformId:'kdp'|'d2d', meta:object, info:object|null, facts?:{illustrations?:number, hasInterior?:boolean, hasCoverPdf?:boolean, hasEpub?:boolean, pages?:number}}} x
 * @returns {{platformId, file, fields:[{key,label,site,step,hint,value,list?:string[],from:'file'|'meta'|'',missing:boolean}], checklist:[{id,label,state:'ok'|'warn'|'error'|'info'|'manual',detail}]}}
 */
function buildPlan(x) {
  const pid = x.platformId === 'd2d' ? 'd2d' : 'kdp', meta = x.meta || {}, info = x.info || null, facts = x.facts || {};
  const f = info ? info.fields : {}, L = info ? info.lists : {};
  const lang = String(f.language || meta.lang || '').trim() || (String(meta.lang || '') ? meta.lang : '');
  const val = {};
  const take = (key, fileV, metaV) => { if (fileV != null && String(fileV).trim() !== '') val[key] = { v: String(fileV).trim(), from: 'file' }; else if (metaV != null && String(metaV).trim() !== '') val[key] = { v: String(metaV).trim(), from: 'meta' }; };
  take('language', f.language, meta.lang === 'en' ? 'English' : meta.lang);
  take('title', f.title, meta.title);
  take('subtitle', f.subtitle, meta.subtitle);
  take('series', f.series, '');
  take('edition', f.edition, '');
  take('author', f.author, meta.author);
  take('publisher', f.publisher, meta.publisher);
  take('description', f.description, meta.tagline);
  take('rights', f.rights || (f.publicDomain != null ? (yes(f.publicDomain) ? 'Public domain' : 'I own the copyright') : ''), '');
  take('age', f.age, '');
  take('ai', f.ai, meta.aiDisclosure);
  take('isbn', f.isbn, meta.isbn);
  const contributors = (L.contributors || []).slice(); if (!contributors.length && f.contributors) contributors.push(...splitList(f.contributors));
  if (!contributors.length && meta.translator) contributors.push(`Translator: ${meta.translator}`);
  const keywords = (L.keywords && L.keywords.length ? L.keywords : splitList(f.keywords || meta.keywords));
  const categories = (L.categories && L.categories.length ? L.categories : splitList(f.categories || meta.category));
  const bisac = (L.bisac && L.bisac.length ? L.bisac : splitList(f.bisac));
  const prices = (L.price && L.price.length ? L.price : splitList(f.price || meta.price));
  const lists = { contributors, keywords, categories, bisac, price: prices };
  const fromList = (k) => (info && (L[k] || []).length) || (info && f[k]) ? 'file' : (lists[k].length ? 'meta' : '');
  const fields = SITE[pid].map(([key, label, site, step, hint]) => {
    const isList = key in lists;
    const value = isList ? lists[key].join(key === 'keywords' ? '\n' : '\n') : (val[key] ? val[key].v : '');
    const from = isList ? fromList(key) : (val[key] ? val[key].from : '');
    return { key, label, site, step, hint, value, list: isList ? lists[key] : undefined, from, missing: !value };
  });

  // ── 체크리스트 ──
  const cl = []; const add = (id, label, state, detail) => cl.push({ id, label, state, detail: detail || '' });
  const isEn = /^(en|english|영어)/i.test(lang) || (val.language && /english|en/i.test(val.language.v)) || String(meta.lang || '') === 'en';
  add('account', `${pid === 'kdp' ? 'KDP' : 'D2D'} 계정 · 세금 인터뷰`, 'manual', '🔏 로이 — 세금 인터뷰(W-8BEN 등)가 끝났는지 직접 확인하세요');
  add('file', '등록정보 파일', info ? 'ok' : 'warn', info ? `${path.basename(info.file || '')} 읽음` : `기준\\등록\\<작품>.${PLATFORM_FILE[pid]} 가 없습니다 — 원고 메타로 채웠습니다(출판 세션이 파일을 만들어 주세요)`);
  add('lang', '책 언어', isEn ? 'ok' : (pid === 'kdp' ? 'error' : 'warn'), isEn ? 'English' : (pid === 'kdp' ? 'KDP 는 한국어 책을 받지 않습니다 — 영어책으로' : 'D2D 한국어 허용은 미확인 ❓'));
  const pd = /public/i.test(val.rights ? val.rights.v : '') || (f.publicDomain != null && yes(f.publicDomain));
  const title = val.title ? val.title.v : '';
  add('title', '제목', title ? 'ok' : 'error', title || '제목이 없습니다');
  if (pd) {
    add('title-tag', '제목 괄호 표기', /\((translated|annotated|illustrated|abridged|adapted)[^)]*\)\s*$/i.test(title) ? 'ok' : 'error', /\((translated|annotated|illustrated)/i.test(title) ? '(Translated)·(Annotated)·(Illustrated) 표기가 있습니다' : '퍼블릭 도메인 파생판은 제목 끝에 (Translated)·(Annotated)·(Illustrated) 표기가 필수입니다(KDP 공식)');
    const d = val.description ? val.description.v : '';
    const first = d.split('\n').map((s) => s.trim()).find(Boolean) || '';
    const bullet = /^[•\-*·▪●]\s*/.test(first), body = first.replace(/^[•\-*·▪●]\s*/, '');
    add('desc-first', '설명 첫 줄(80자 이내 요약)', !first ? 'error' : (bullet && body.length <= 80 ? 'ok' : 'warn'), !first ? '설명이 없습니다' : `${body.length}자${bullet ? '' : ' · 글머리(•)로 시작하지 않음'}${body.length > 80 ? ' · 80자 초과' : ''} — 어떻게 독창적인지 한 줄 요약`);
    const nIll = Number(f.illustrations) || Number(facts.illustrations) || 0;
    add('illustrations', '삽화 수(차별판 10점 이상)', nIll >= 10 ? 'ok' : 'warn', `삽화 ${nIll}/10 — 무료판이 이미 있는 퍼블릭 도메인 책은 번역·주석·삽화 10점 이상의 차별판만 허용됩니다`);
    add('ks-select', 'KDP Select', 'info', '퍼블릭 도메인 책은 KDP Select 대상이 아닙니다');
  }
  const hasTranslator = !!(meta.translator || contributors.some((c) => /translat|번역|옮/i.test(c)));
  if (hasTranslator) add('contributors', '기여자(번역가+원저자)', contributors.some((c) => /translat|번역|옮/i.test(c)) && (val.author && val.author.v) ? 'ok' : 'warn', contributors.length ? `기여자 ${contributors.length}명 — 번역가와 원저자를 둘 다 기여자로 넣으세요` : '번역가를 기여자로 적으세요');
  add('keywords', '키워드', !keywords.length ? 'warn' : (keywords.length > 7 ? 'warn' : 'ok'), keywords.length ? `${keywords.length}개${keywords.length > 7 ? ' — 7개를 넘으면 사이트가 받지 않습니다' : keywords.length < 7 ? ' — 7칸을 다 채우면 노출에 유리합니다' : ''}` : '키워드가 없습니다');
  if (pid === 'kdp') add('categories', '카테고리', !categories.length ? 'warn' : (categories.length > 3 ? 'warn' : 'ok'), categories.length ? `${categories.length}개(최대 3 ⚠️)` : '카테고리가 없습니다');
  else add('bisac', 'BISAC 분류', bisac.length ? 'ok' : 'warn', bisac.length ? `${bisac.length}개` : 'BISAC 분류가 없습니다');
  add('ai', 'AI 신고', val.ai ? 'ok' : 'warn', val.ai ? val.ai.v.slice(0, 80) : '텍스트·이미지·번역을 AI 가 「생성」했다면 신고합니다 — 문구를 등록정보에 적어 두세요(KDP 는 공개가 아마존에만 보임 ⚠️)');
  add('price', '가격표', prices.length ? 'ok' : 'warn', prices.length ? `${prices.length}줄` : '가격은 로이가 정합니다 — 마켓별 가격표를 등록정보에 적어 두세요');
  add('isbn', 'ISBN', 'manual', '🔏 로이 — ' + (pid === 'kdp' ? 'KDP 무료 ISBN 은 그 판형·판본에 고정됩니다. 자기 ISBN 을 쓰면 판매처가 자유롭습니다 ⚠️' : 'D2D 무료 ISBN 은 D2D 밖에서 쓸 수 없고 판형마다 ISBN 이 하나입니다'));
  if (pid === 'kdp') {
    add('interior', '내지 PDF', facts.hasInterior ? 'ok' : 'warn', facts.hasInterior ? '내지 PDF 있음 — 「등록 전 점검」 패널의 KDP 항목을 확인하세요' : '내지 PDF 를 먼저 만드세요(조판 탭)');
    add('cover', '표지 PDF(스프레드)', facts.hasCoverPdf ? 'ok' : 'warn', facts.hasCoverPdf ? '표지 PDF 있음 — 바코드 자리는 비워 둡니다' : '표지 PDF 를 만드세요(쪽수 확정 뒤)');
    add('ebook', '전자책 ePub(선택)', facts.hasEpub ? 'ok' : 'info', facts.hasEpub ? 'ePub 있음' : 'Kindle 전자책도 낼 때만');
    add('proof', '교정본(Proof) 주문', 'manual', '🔏 로이 — 제출 뒤 교정본을 주문해 인쇄 상태를 확인하세요');
  } else {
    add('interior', '내지 PDF(그레이스케일)', facts.hasInterior ? 'ok' : 'warn', facts.hasInterior ? '내지 PDF 있음 — D2D 점검 항목을 확인하세요' : '내지 PDF 를 먼저 만드세요');
    add('epub', '전자책 ePub', facts.hasEpub ? 'ok' : 'warn', facts.hasEpub ? 'ePub 있음 — EPUBCheck 통과가 필요합니다' : '전자책 ePub 를 만드세요');
    add('dup', '아마존 중복 유통', 'manual', '🔴 같은 판본을 KDP 로 이미 올렸다면 D2D 의 아마존 유통과 겹칩니다 — 한 판본은 한 경로로만');
  }
  add('submit', '제출', 'manual', '🔏 로이 — 계정 · 세금 · ISBN · 가격 · 제출은 앱이 대신하지 않습니다');
  return { platformId: pid, file: info ? info.file || '' : '', fields, checklist: cl, publicDomain: !!pd };
}

module.exports = { parseOverseasInfo, findOverseasInfoFile, loadOverseasInfo, buildPlan, SITE, PLATFORM_FILE, ALIAS };
