'use strict';

/**
 * html-builder.js — BookModel → 조판용 단일 HTML(+CSS).
 *
 * Vivliostyle 이 이 HTML 을 CSS Paged Media 로 조판한다:
 *   - @page :left/:right 미러 여백 + 러닝헤드(짝수쪽=책제목 / 홀수쪽=장제목 string-set)
 *   - 목차 쪽번호 target-counter · 각주 float:footnote(또는 미주 모음) · break-before:recto
 *   - 표제지·판권·백면(:blank)·장 시작 = 폴리오/러닝헤드 없음
 *
 * opts:
 *   trimId/platformId  판형·플랫폼 (meta 값이 우선)
 *   fontSizePt(10) lineHeight(1.8) marginsMm{top,bottom,inner,outer}
 *   chapterStart('recto'|'page')  footnoteMode('footnote'|'endnote')
 *   imageUrl(absPath)→URL  (PDF=file:// / 미리보기=media://)
 *   baseDir  상대 이미지 경로 기준(.md 위치)
 *   fontCss  @font-face 블록(선택 — 동봉 폰트)
 *   sourceMap(true)  data-src-line 속성 부여(클릭-편집용)
 */

const fs = require('fs');
const path = require('path');
const { getTrim, getPlatform, TRIM_SIZES } = require('./platform-presets');

const THEME_CSS_PATH = path.join(__dirname, 'book-theme.css');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 최소 인라인 마크다운: [링크] **굵게** *기울임* `코드` — HTML 이스케이프 후 적용.
//   링크: 종이책이라 클릭할 수 없다 → 주소는 버리고 글자만 남긴다. 외부 주소(http)만,
//   글자와 다를 때 괄호로 병기한다(로컬 파일 경로는 인쇄물에서 무의미하므로 언제나 버린다).
//   ⚠ 주소에 괄호가 들어갈 수 있다(`../개역개정4판(구약+신약).txt`) → 한 겹 중첩까지 허용.
//   `![...](...)` 인라인 이미지는 블록 파서 몫이라 건드리지 않는다(앞의 ! 로 판별).
const LINK_RE = /(!?)\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g;
function stripLinks(t) {
  return t.replace(LINK_RE, (m, bang, label, url) => {
    if (bang) return m;
    const lab = String(label).trim();
    if (!lab) return "";
    const u = String(url).trim();
    if (/^https?:/i.test(u) && u !== lab && !lab.includes(u)) return `${lab} (${u})`;
    return lab;
  });
}
// 작업용 파일 경로 → 파일명만. 종이책에서 `../참고문헌/지도교수/…/오광만_박사논문2008_….pdf` 같은
//   경로는 찾아갈 수도 없고 한 줄을 통째로 잡아먹는다. 폴더만 떼고 파일명은 남긴다(무엇인지는 알 수 있게).
//   ⚠ 슬래시 + 확장자로 끝나는 것만 — 'A/B 실험' 같은 평범한 글자를 자르면 안 된다.
const LOCAL_PATH_RE = /^(?!https?:)[^\s]*[/\\][^\s/\\]+\.[A-Za-z0-9]{1,5}$/;
function shortenPath(t) {
  const bare = t.trim();
  if (!LOCAL_PATH_RE.test(bare)) return t;
  return bare.split(/[/\\]/).pop();
}
function inlineMd(s, opts) {
  const hidePaths = !!(opts && opts.hidePaths);
  // 문단 중간에 낀 HTML 주석도 지운다 — esc 보다 **먼저**(esc 뒤엔 &lt;!-- 가 되어 못 잡는다).
  const src = String(s == null ? '' : s).replace(/<!--[\s\S]*?-->/g, '');
  let t = stripLinks(esc(src));
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  t = t.replace(/`([^`]+)`/g, (m, code) =>
    `<span class="code">${hidePaths ? shortenPath(code) : code}</span>`);
  return t;
}

// 각주 참조 [^id] → 각주(float) 또는 미주(sup) 마크업.
function renderInline(text, book, ctx) {
  const io = { hidePaths: !!(ctx && ctx.hidePaths) };
  const parts = String(text || '').split(/(\[\^[^\]]+\])/);
  let out = '';
  for (const p of parts) {
    const m = p.match(/^\[\^([^\]]+)\]$/);
    if (!m) { out += inlineMd(p, io); continue; }
    const def = book.footnotes[m[1]];
    if (!def) { out += inlineMd(p, io); continue; }
    if (ctx.footnoteMode === 'endnote') {
      ctx.endnotes.push({ id: m[1], text: def.text });
      const n = ctx.endnotes.length;
      out += `<sup class="enref"><a id="enref-${n}" href="#en-${n}">${n}</a></sup>`;
    } else {
      out += `<span class="footnote">${inlineMd(def.text, io)}</span>`;
    }
  }
  return out;
}

// 표 — 머리행 + 본문행. 쪽을 넘으면 머리행을 반복(thead: table-header-group)해
//   33행짜리 계획표가 여러 쪽에 걸쳐도 어느 열인지 읽을 수 있게 한다.
function tableHtml(b, book, ctx, srcAttr) {
  const align = (i) => (b.align && b.align[i]) ? ` style="text-align:${b.align[i]}"` : "";
  const cells = (row, tag) => row.map((c, i) =>
    `<${tag}${align(i)}>${renderInline(c, book, ctx)}</${tag}>`).join("");
  const head = (b.header && b.header.length)
    ? `<thead><tr>${cells(b.header, "th")}</tr></thead>` : "";
  const n = (b.header || []).length;
  const body = (b.rows || []).map((r) => {
    // 셀 수가 머리행과 다른 줄이 실제로 있다 → 머리행 기준으로 맞춘다(빈 칸 채움).
    const row = n ? Array.from({ length: n }, (_, i) => (r[i] == null ? "" : r[i])) : r;
    return `<tr>${cells(row, "td")}</tr>`;
  }).join("\n");
  return `<div class="md-tablewrap"${srcAttr(b)}><table class="md-table">${head}<tbody>${body}</tbody></table></div>`;
}

// 목록 — 항목의 level 로 중첩 <ul>/<ol> 을 만든다. `- [x]` 는 체크박스 글자로.
function listHtml(b, book, ctx, srcAttr) {
  const items = b.items || [];
  if (!items.length) return "";
  let i = 0;
  const build = (level) => {
    const ordered = !!items[i].ordered;
    const tag = ordered ? "ol" : "ul";
    let out = `<${tag}>`;
    while (i < items.length && items[i].level >= level) {
      if (items[i].level > level) { out += build(items[i].level); continue; }
      const it = items[i]; i++;
      const box = it.checked == null ? "" : `<span class="cbox">${it.checked ? "☑" : "☐"}</span> `;
      let inner = box + renderInline(it.text, book, ctx);
      if (i < items.length && items[i].level > level) inner += build(items[i].level);
      out += `<li${it.checked == null ? "" : ' class="task"'}>${inner}</li>`;
    }
    return out + `</${tag}>`;
  };
  return `<div class="md-listwrap"${srcAttr(b)}>${build(items[0].level)}</div>`;
}

function blockHtml(b, book, ctx, srcAttr) {
  const src = srcAttr(b);
  switch (b.type) {
    case 'p': return `<p${src}>${renderInline(b.text, book, ctx)}</p>`;
    case 'lead': return `<p class="chapter-lead noindent"${src}>${renderInline(b.text, book, ctx)}</p>`;
    case 'h3': return `<h3${src}>${renderInline(b.text, book, ctx)}</h3>`;
    case 'h4': return `<h4${src}>${renderInline(b.text, book, ctx)}</h4>`;
    case 'quote': return `<blockquote${src}>${renderInline(b.text, book, ctx)}</blockquote>`;
    case 'verse': return `<div class="verse"${src}>${b.lines.map((l) => esc(l)).join('\n')}</div>`;
    case 'image': {
      const url = ctx.resolveImage(b.src);
      const cap = b.caption ? `<figcaption>${inlineMd(b.caption)}</figcaption>` : '';
      return `<figure${src}><img src="${esc(url)}" alt="${esc(b.caption)}" />${cap}</figure>`;
    }
    case 'table': return tableHtml(b, book, ctx, srcAttr);
    case 'list': return listHtml(b, book, ctx, srcAttr);
    case 'hr': return `<hr class="scene"${src} />`;
    default: return '';
  }
}

// ── 출력 제외 ────────────────────────────────────────────────────────────────
// 구조 패널에서 체크 해제한 **본문 장**. 키는 `ch:<장 제목>` — 장 번호로 잡으면 앞에 장을 하나
//   추가하는 순간 엉뚱한 장이 사라진다. 제목이 바뀌면 제외가 풀려 다시 나오는데, 그건 눈에
//   보이는 실패라 "조용히 다른 장이 사라지는 것"보다 낫다. 원고(.md)는 건드리지 않는다.
function chapterKey(title) { return "ch:" + String(title == null ? "" : title).trim(); }
function chapterExcluded(title, excluded) {
  return Array.isArray(excluded) && excluded.includes(chapterKey(title));
}

// ── 영상 대본 모드 필터 ───────────────────────────────────────────────────────
//  제작용 이모지 마커로 시작하는 인용만 걸러낸다(본문 인용은 마커가 없으므로 안전).
const SCRIPT_NOTE_RE = /^\s*(?:🎯|📝|🎨|🖼️?|🎬|🎞)/;
//  제목 꼬리의 제작 표기 — `— 0:00~0:30 · I2V 5샷` / `(0:30~3:50)` / ` ★`
function stripScriptTitle(t) {
  return String(t || '')
    .replace(/\s*[—-]\s*\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}.*$/, '')
    .replace(/\s*\(\s*\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}\s*\)\s*$/, '')
    .replace(/\s*★/g, '')
    .trim();
}
function scriptFilter(blocks, ctx) {
  if (!ctx || !ctx.scriptMode) return blocks || [];
  const out = [];
  for (const b of blocks || []) {
    if (!b) continue;
    if (b.type === 'quote' && SCRIPT_NOTE_RE.test(String(b.text || ''))) continue;  // 제작메모·프롬프트
    if (b.type === 'hr') continue;                                                  // `---` 구분선
    if (ctx.scriptHideShots && (b.type === 'h4' || b.type === 'h3') && /^샷\s*\d/.test(String(b.text || b.title || ''))) continue;
    if (b.type === 'h3' || b.type === 'h4') {
      const t = stripScriptTitle(b.text || b.title);
      out.push(t === (b.text || b.title) ? b : { ...b, text: t, title: t });
      continue;
    }
    out.push(b);
  }
  return out;
}

function blocksHtml(blocks, book, ctx, srcAttr) {
  return scriptFilter(blocks, ctx).map((b) => blockHtml(b, book, ctx, srcAttr)).join('\n');
}

// 장 본문 렌더 — 특별 섹션 키워드(예: '역사 노트')와 일치하는 소제목 구간을
// 노트 박스(<div class="special-sec">)로 감싸 본문과 다르게 조판. 구간 = 그 소제목부터 다음 소제목(또는 장 끝).
function chapterBlocksHtml(blocks0, book, ctx, srcAttr, specials) {
  const blocks = scriptFilter(blocks0, ctx);   // 영상 대본 모드면 제작용 블록 제거 후 특별섹션 판정
  if (!specials || !specials.length) return blocksHtml(blocks, book, ctx, srcAttr);
  const out = [];
  let buf = [];
  let sbuf = null;
  const flushBuf = () => { if (buf.length) { out.push(blocksHtml(buf, book, ctx, srcAttr)); buf = []; } };
  const flushSpecial = () => { if (sbuf) { out.push(`<div class="special-sec">\n${blocksHtml(sbuf, book, ctx, srcAttr)}\n</div>`); sbuf = null; } };
  for (const b of blocks || []) {
    if (b.type === 'h3' || b.type === 'h4') {
      const hit = specials.some((k) => (b.text || '').trim().includes(k));
      if (hit) { flushBuf(); flushSpecial(); sbuf = [b]; continue; }
      flushSpecial(); buf.push(b); continue;
    }
    if (sbuf) sbuf.push(b); else buf.push(b);
  }
  flushBuf(); flushSpecial();
  return out.join('\n');
}

// ── 자동 생성 페이지 ──
function halfTitleHtml(meta, fallbackTitle) {
  // 제목 폴백 — 메타에 책제목이 없으면 파일 제목으로(반표제지가 빈 페이지로 나오던 문제)
  return `<section class="halftitle"><div class="ht-title">${esc(meta.title || fallbackTitle || '')}</div></section>`;
}
function titlePageHtml(meta, ctx, fallbackTitle) {
  const logo = meta.logo ? `<img class="tp-logo" src="${esc(ctx.resolveImage(meta.logo))}" alt="logo" />` : '';
  return `<section class="titlepage">
  <div class="tp-main">
    <h1 class="tp-title">${esc(meta.title || fallbackTitle || '')}</h1>
    ${meta.subtitle ? `<div class="tp-subtitle">${esc(meta.subtitle)}</div>` : ''}
    <div class="tp-author">${esc(meta.author || '')}${meta.author ? ' 지음' : ''}</div>
    ${meta.translator ? `<div class="tp-translator">${esc(meta.translator)} ${meta.translatorLabel === '편역이' ? '편역' : '옮김'}</div>` : ''}
  </div>
  <div class="tp-publisher">${logo}${esc(meta.publisher || '')}</div>
</section>`;
}
// 판권 자동 생성 항목 정의 — UI 체크박스와 1:1 (key, 라벨, 값 추출)
const COLOPHON_FIELDS = [
  ['issueDate', '초판 1쇄 발행'], ['author', '지은이'], ['translator', '옮긴이'], ['issuer', '펴낸이'],
  ['publisher', '펴낸곳'], ['regNo', '출판등록'], ['address', '주소'], ['phone', '전화'], ['fax', '팩스'],
  ['homepage', '홈페이지'], ['email', '이메일'], ['isbn', 'ISBN'], ['price', '정가'], ['ebookPrice', '전자책'],
  ['copyright', 'ⓒ 저작권 문구'], ['legal', '무단복제 금지 문구'], ['exchange', '파본 교환 안내'],
];

// [판권] 자유문 라벨 → 표(메타) 키 매핑 — 이 라벨로 시작하는 줄은 표에 이미 있으면 '되풀이'로 간주.
const COLOPHON_LABEL_KEYS = [
  [/^(원작|지은이|저자|글)\s+\S/, 'author'],
  [/^(편역|편역자|편역이|옮긴이|역자|엮은이|번역)\s+\S/, 'translator'],
  [/^(펴낸이|발행인)\s+\S/, 'issuer'],
  [/^(펴낸곳|발행처|출판사)\s+\S/, 'publisher'],
  [/^(발행일|초판|발행)\s+.*\d/, 'issueDate'], // \b 는 한글 경계 미인식 → \s+ 사용
  [/^ISBN\b/i, 'isbn'],
  [/^(정가|가격)\s+\S/, 'price'],
  [/^부가기호\s+\S/, 'isbnAddon'],
  [/^판형\s+\S/, 'trim'],
  [/^(주소|주 소)\s+\S/, 'address'],
  [/^(대표전화|전화)\s+\S/, 'phone'],
  [/^팩스\s+\S/, 'fax'],
  [/^홈페이지\s+\S/, 'homepage'],
  [/^(이메일|대표메일|email)\s+\S/i, 'email'],
  [/^(출판등록|등 ?록)\s+\S/, 'regNo'],
  [/^(편집인|편집자|편집)\s+\S/, 'editor'],
  [/^블로그\s+\S/, 'blog'],
  [/^페이스북\s+\S/, 'facebook'],
  [/^(인스타그램|인스타)\s+\S/, 'instagram'],
];
// [판권] 자유문의 한 줄이 '표·제목·ⓒ에 이미 나온 정보를 되풀이한 것'인가?
//   되풀이면 버리고(표가 대신 보여줌), 표에 없는 고유 정보(고지문 등)는 보존 → 무손실.
function colophonLineRedundant(line, meta) {
  const s = String(line || '').trim();
  if (!s) return false;
  const title = (meta.title || '').trim();
  // 제목/부제 재기술 — cp-title 에 이미 있음
  if (title && (s.replace(/\s/g, '') === title.replace(/\s/g, '')
    || (s.includes(title) && s.length <= title.length + 30))) return true;
  // ⓒ/© 저작권 줄 — 하단 cp-legal 이 자동 생성
  if (/^(ⓒ|©|copyright)/i.test(s) && (meta.author || meta.translator || meta.copyright)) return true;
  // 라벨+값 — 해당 메타가 표에 이미 있으면 중복(없으면 고유 정보라 보존)
  for (const [re, key] of COLOPHON_LABEL_KEYS) {
    if (re.test(s) && meta[key] != null && String(meta[key]).trim() !== '') return true;
  }
  return false;
}
// [판권] 섹션에서 되풀이 줄을 걸러 고지문만 남긴 사본을 반환(원본 모델 불변).
function filterColophonSection(section, meta) {
  if (!section || !Array.isArray(section.blocks)) return section;
  const blocks = [];
  for (const b of section.blocks) {
    if (b && b.type === 'p' && typeof b.text === 'string') {
      const kept = b.text.split('\n').filter((ln) => !colophonLineRedundant(ln, meta));
      const txt = kept.join('\n').trim();
      if (txt) blocks.push({ ...b, text: txt });
    } else if (b) {
      blocks.push(b); // 인용·시 등 비문단 블록은 그대로 보존
    }
  }
  return { ...section, blocks };
}
// 판권 라벨 — 2글자 한글(등록·주소·전화·팩스)은 3글자 라벨과 폭을 맞춰 균등 분산한다
//   (실물 판권 관행 「등  록 ｜ …」). flex 로 벌리므로 글꼴·자간에 상관없이 정확히 맞는다.
function cpLabel(label) {
  const bare = String(label == null ? '' : label).replace(/\s+/g, '');
  if (/^[가-힣]{2}$/.test(bare)) return `<span class="k k2"><span>${esc(bare[0])}</span><span>${esc(bare[1])}</span></span>`;
  return `<span class="k">${esc(bare || label || '')}</span>`;
}
// [판권] 자유문 — 별표 고지문은 **한 줄씩** 내어쓰기 문단으로(`* 잘못된 책은 …`),
//   인용(`>`) 블록은 **테두리 박스**로(투고 안내 등). 실물 판권의 두 가지 표기를 그대로 옮긴 것.
//   ⚠ data-src-line 은 바깥 컨테이너에 둔다 — 클릭-편집은 closest() 로 찾으므로 줄을 쪼개도
//     편집 단위는 원래 블록 그대로다(원고의 그 문단 전체가 대상).
function colophonNotesHtml(fsec, book, ctx, srcAttr) {
  if (!fsec || !Array.isArray(fsec.blocks) || !fsec.blocks.length) return '';
  const out = [];
  for (const b of fsec.blocks) {
    if (!b) continue;
    if (b.type === 'p' && typeof b.text === 'string') {
      const ps = b.text.split('\n').map((s) => s.trim()).filter(Boolean)
        .map((ln) => `<p class="cp-note${/^[*※·•]/.test(ln) ? ' bul' : ''}">${renderInline(ln, book, ctx)}</p>`);
      if (ps.length) out.push(`<div class="cp-notes"${srcAttr(b)}>${ps.join('')}</div>`);
    } else if (b.type === 'list') {
      // 판권 안의 목록(`* 잘못된 책은 …`)은 실물 판권의 **별표 고지문**이다 — 불릿 목록으로
      //   조판하면 점(•)이 붙어 판권이 아니라 본문처럼 보인다. 별표를 글자로 찍고 내어쓰기.
      const ps = (b.items || []).map((it) => `<p class="cp-note bul">* ${renderInline(it.text, book, ctx)}</p>`);
      if (ps.length) out.push(`<div class="cp-notes"${srcAttr(b)}>${ps.join('')}</div>`);
    } else if (b.type === 'quote') {
      const ps = String(b.text || '').split('\n').map((s) => s.trim()).filter(Boolean)
        .map((ln) => `<p>${renderInline(ln, book, ctx)}</p>`);
      out.push(`<div class="cp-box"${srcAttr(b)}>${ps.join('')}</div>`);
    } else {
      out.push(blocksHtml([b], book, ctx, srcAttr));
    }
  }
  return out.join('\n');
}
// 판권지 — 실물 단행본 판권(2026-08-24 로이 제시 레퍼런스: 비즈니스북스 『하루 한 장 고전 수업』)과 동일:
//   책제목(볼드) · 발행 이력(라벨+날짜) · 「라벨 ｜ 값」 행(굵은 라벨) · ISBN(구분선 없이 값+부가기호) ·
//   별표 고지문 · 테두리 박스(투고 안내 등) · ⓒ + 재사용 안내. 배치는 조판 옵션(위/아래).
//   Option 1(2026-07-13): 자유문이 표·제목·ⓒ를 되풀이하면 그 줄만 빼고 고지문만 남김(중복 제거·무손실).
function colophonHtml(meta, ctx, isFront, section, book, srcAttr, fields) {
  const only = (Array.isArray(fields) && fields.length) ? new Set(fields) : null;
  const on = (key) => !only || only.has(key);
  const row = (key, label, v, cls) => (v && on(key)
    ? `<div class="cp-row${cls ? ' ' + cls : ''}">${cpLabel(label)}<span class="sep">|</span><span class="v">${esc(v)}</span></div>`
    : '');

  // ── 발행 이력 ── 「1판 1쇄 발행   2026년 8월 24일」. 여러 쇄는 `;` 로 나눠 쓴다.
  //   라벨/값은 **첫 연도(4자리) 앞**에서 가른다 — 라벨을 안 쓰면 「초판 1쇄 발행」.
  const dates = on('issueDate')
    ? String(meta.issueDate || '').split(/\s*[;；]\s*/).map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/^(.*?)\s*((?:19|20)\d{2}[\D].*)$/);
      const k = (m && m[1].trim()) || '초판 1쇄 발행';
      const v = ((m ? m[2] : s) || '').trim();
      return `<div class="cp-date"><span class="dk">${esc(k)}</span><span class="dv">${esc(v)}</span></div>`;
    }).join('') : '';
  const dateBlock = dates ? `<div class="cp-dates">${dates}</div>` : '';

  // ── 라벨 ｜ 값 행 ── 레퍼런스 순서(사람·발행처 → 연락처 → ISBN)
  const rows = [
    row('author', '지은이', meta.author),
    row('translator', meta.translatorLabel || '옮긴이', meta.translator),
    row('issuer', '발행인', meta.issuer),
    row('editor', '편집인', meta.editor),
    row('publisher', '발행처', meta.publisher),
    row('regNo', '등록', meta.regNo),
    row('address', '주소', meta.address),
    row('phone', '전화', meta.phone),
    row('fax', '팩스', meta.fax),
    row('email', '대표메일', meta.email),
    row('homepage', '홈페이지', meta.homepage),
    row('blog', '블로그', meta.blog),
    row('facebook', '페이스북', meta.facebook),
    row('instagram', '인스타그램', meta.instagram),
    ...Object.entries(meta.extra || {}).map(([k, v]) => row('extra', k, v)),
    // ISBN — 실물은 구분선 없이 「ISBN  979-…  03190」(부가기호를 값 뒤에 띄워 붙인다)
    (meta.isbn && on('isbn'))
      ? `<div class="cp-row cp-isbn">${cpLabel('ISBN')}<span class="sep">|</span><span class="v">${esc(meta.isbn)}${meta.isbnAddon ? `<span class="addon">${esc(meta.isbnAddon)}</span>` : ''}</span></div>`
      : '',
    row('price', '정가', meta.price),
    row('ebookPrice', '전자책', meta.ebookPrice),
  ].join('');

  const notes = colophonNotesHtml(filterColophonSection(section, meta), book, ctx, srcAttr);

  const qrIsImg = meta.qr && /\.(png|jpe?g|svg|webp)$/i.test(meta.qr);
  const qrBlock = (qrIsImg || meta.qrLabel || meta.qr)
    ? `<div class="cp-qrbox">
    ${qrIsImg ? `<img class="cp-qr" src="${esc(ctx.resolveImage(meta.qr))}" alt="QR" />` : ''}
    ${meta.qrLabel ? `<div class="cp-qrlabel">${esc(meta.qrLabel)}${!qrIsImg && meta.qr ? ' — ' + esc(meta.qr) : ''}</div>`
      : (!qrIsImg && meta.qr ? `<div class="cp-qrlabel">${esc(meta.qr)}</div>` : '')}
  </div>` : '';

  const year = (String(meta.issueDate || '').match(/\d{4}/) || [new Date().getFullYear()])[0];
  // 편역서는 편집 저작권자 = 편역자(목표 최종본: ⓒ 로이(한득수)) — translator 우선
  const cpName = meta.translator || meta.author;
  const owner = meta.copyright || (cpName ? `ⓒ ${cpName} ${year}. All rights reserved.` : '');
  const legal = owner
    ? `<div class="cp-legal"><p>${esc(owner)}</p><p>이 책의 내용 중 전부 또는 일부를 재사용하려면 반드시 저작권자의 서면 동의를 얻어야 합니다.</p></div>`
    : '';

  // 러닝헤드 억제 — @page display 는 vivliostyle 에서 **조각의 첫 쪽에 한 쪽 늦게** 적용된다
  //   (실측: 판권 둘째 쪽부터만 먹는다 → 첫 쪽에 장제목이 그대로 찍혔다). 그래서 러닝헤드는
  //   문자열 자체를 비워 확실히 지운다. 판권은 책의 맨 뒤라 이후에 쓸 곳이 없다.
  //   ⚠ 앞 판권(속표지 뒷면)은 앞부속(display) 페이지 뒤라 늦은 적용이 문제되지 않고,
  //     여기서 비우면 **본문 러닝헤드가 통째로 사라진다** → isFront 면 넣지 않는다.
  const rhClear = isFront ? '' : '<span class="cp-rhclear"></span>';

  return `<section class="colophon${isFront ? ' cp-front' : ''}">
  ${rhClear}<div class="cp-wrap">
    <div class="cp-title">${esc(meta.title || '')}${meta.subtitle ? ` <span class="cp-subtitle">${esc(meta.subtitle)}</span>` : ''}</div>
    ${dateBlock}
    <div class="cp-rows">${rows}</div>
    ${notes}
    ${qrBlock}
    ${legal}
  </div>
</section>`;
}
// 목차 — 사용자 최종본([POD] 원고_고전의뜰 삼국지_01.pdf p.11)과 동일: **본문 장(제N회)만** 나열
//   (서문·프롤로그 등 부속물 제외), 각 행 = 제목 + 점선 리더 + 우측 쪽번호.
//   점선은 leader() 대신 flex 빈칸의 border-bottom(dotted) — 미리보기(코어)·CLI 양쪽 동일 렌더.
function tocHtml(book, tocTitle, excluded = []) {
  const items = [];
  for (const p of book.parts) {
    const shown = (p.chapters || []).filter((c) => c.title && !chapterExcluded(c.title, excluded));
    if (p.title && shown.length) items.push(`<li class="toc-part"><span class="tt">${esc(p.title)}</span></li>`);
    for (const c of p.chapters) {
      if (!c.title) continue;
      if (chapterExcluded(c.title, excluded)) continue; // 출력에서 뺀 장은 목차에도 안 나온다
      items.push(`<li class="toc-chapter"><a href="#ch-${c.num}"><span class="tt">${esc(c.title)}</span><span class="dots"></span></a></li>`);
    }
  }
  return `<nav class="toc"><h2>${esc(tocTitle || '목차')}</h2><ol>${items.join('\n')}</ol></nav>`;
}
// 표지 안내 페이지 — 미리보기 전용 1쪽(내지 PDF 에는 넣지 않음).
//   스프레드 치수 전부 + 축소 다이어그램(재단선·안전선·책등·날개 구획). 표지 이미지가 첨부돼 있으면
//   다이어그램 배경에 깔아 "치수가 맞게 만들어졌는지"를 눈으로 확인.
function coverInfoHtml(ci, meta, o) {
  const sp = ci.spread;
  if (!sp) return '';
  // 판면 폭에 맞춰 스케일(mm 기준) — 다이어그램이 페이지를 넘지 않게
  const bodyWmm = o.trimW - o.marginsMm.inner - o.marginsMm.outer;
  const scale = Math.min(1, bodyWmm / sp.widthMm);
  const W = sp.widthMm * scale, H = sp.heightMm * scale;
  const bleed = 3 * scale, safe = (3 + (sp.safeMm || 5)) * scale;
  // 구획 상자들
  let x = 0;
  const partDivs = sp.parts.map((p) => {
    const left = x * scale; x += p.mm;
    if (p.name === 'bleed') return '';
    return `<div style="position:absolute; left:${left.toFixed(2)}mm; top:0; width:${(p.mm * scale).toFixed(2)}mm; height:${H.toFixed(2)}mm; border-left:0.3pt dashed #2a6fb0; box-sizing:border-box;">
      <div style="position:absolute; left:0; right:0; top:42%; text-align:center; font-size:6.5pt; color:#2a6fb0; background:rgba(255,255,255,.55);">${esc(p.name)}<br/>${p.mm}mm</div>
    </div>`;
  }).join('');
  const bg = ci.coverImageUrl
    ? `<img src="${esc(ci.coverImageUrl)}" style="position:absolute; left:0; top:0; width:${W.toFixed(2)}mm; height:${H.toFixed(2)}mm; object-fit:fill;" />`
    : '';
  const row = (k, v) => `<tr><td style="padding:1pt 8pt 1pt 0; color:#555; white-space:nowrap;">${esc(k)}</td><td>${esc(v)}</td></tr>`;
  return `<section class="cover-info">
  <h2 style="font-size:12pt; margin:0 0 6pt;">📐 표지 스프레드 안내</h2>
  <p class="noindent" style="font-size:8pt; color:#777; margin:0 0 8pt;">이 페이지는 미리보기 전용입니다 — 내지 PDF 에는 포함되지 않습니다. 표지 이미지를 첨부하면 아래 다이어그램에 겹쳐 표시되어 치수 정합을 확인할 수 있습니다.</p>
  <table style="font-size:8.5pt; border-collapse:collapse; margin-bottom:8pt;">
    ${row('판형(내지)', `${o.trimW} × ${o.trimH} mm`)}
    ${row('스프레드 전체', `${sp.widthMm} × ${sp.heightMm} mm  =  ${sp.widthPx} × ${sp.heightPx} px @${sp.dpi}dpi`)}
    ${row('책등', `${sp.spineMm} mm (총 ${ci.pages || '?'}쪽 · ${esc(ci.paperLabel || '')} 기준)`)}
    ${row('날개', ci.flaps ? '있음 — 앞뒤 각 100 mm' : '없음')}
    ${row('재단여백', '사방 3 mm — 배경을 끝까지 채우세요 (재단 시 잘림)')}
    ${row('안전여백', `재단선 안쪽 ${sp.safeMm || 5} mm — 글자·로고는 이 안에`)}
    ${ci.coverImageUrl ? row('첨부 표지', ci.coverName || '') : row('첨부 표지', '없음 — 우측 패널에서 이미지를 첨부하세요')}
  </table>
  <div style="position:relative; width:${W.toFixed(2)}mm; height:${H.toFixed(2)}mm; background:#eee; outline:0.5pt solid #999; overflow:hidden;">
    ${bg}
    ${partDivs}
    <div style="position:absolute; left:${bleed.toFixed(2)}mm; top:${bleed.toFixed(2)}mm; right:${bleed.toFixed(2)}mm; bottom:${bleed.toFixed(2)}mm; border:0.5pt solid #d32f2f;"></div>
    <div style="position:absolute; left:${safe.toFixed(2)}mm; top:${safe.toFixed(2)}mm; right:${safe.toFixed(2)}mm; bottom:${safe.toFixed(2)}mm; border:0.4pt dotted #2e7d32;"></div>
  </div>
  <p class="noindent" style="font-size:7.5pt; color:#777; margin-top:5pt;">🔴 빨간 실선=재단선 · 🟢 초록 점선=안전선 · 파란 점선=책등/날개 구획 (축척 ${(scale * 100).toFixed(0)}%)</p>
</section>`;
}

function endnotesHtml(ctx) {
  if (!ctx.endnotes.length) return '';
  const lis = ctx.endnotes.map((e, i) =>
    `<li id="en-${i + 1}"><a href="#enref-${i + 1}">${i + 1}</a>. ${inlineMd(e.text)}</li>`).join('\n');
  return `<section class="back-section endnotes" id="sec-endnotes"><h2>미주</h2><ol style="list-style:none">${lis}</ol></section>`;
}

// 폰트 키 → 스택 (전부 동봉 정적 웨이트 — 가변폰트는 PDF 에 Type3 로 구워져 배제)
const FONT_STACKS = {
  kopub: `'KoPubWorld Batang', 'NanumMyeongjo', 'Batang', serif`,
  'kopub-dotum': `'KoPubWorld Dotum', 'NanumGothic', 'Dotum', sans-serif`,
  'nanum-myeongjo': `'NanumMyeongjo', 'KoPubWorld Batang', 'Batang', serif`,
  'nanum-gothic': `'NanumGothic', 'KoPubWorld Dotum', 'Dotum', sans-serif`,
};
const FONT_OPTIONS = [
  { id: 'kopub', label: 'KoPub월드 바탕 (권장)' },
  { id: 'kopub-dotum', label: 'KoPub월드 돋움' },
  { id: 'nanum-myeongjo', label: '나눔명조' },
  { id: 'nanum-gothic', label: '나눔고딕' },
];
const GOTHIC_STACK = FONT_STACKS['kopub-dotum'];

// ── 동적 CSS(@page) ──
function pageCss(o) {
  const m = o.marginsMm;
  // 머리글 — 구 앱 스타일: 고딕 9pt 회색(#595959)
  const rh = `font-family: ${GOTHIC_STACK}; font-size: 9pt; color: #595959;`;
  const fo = `font-family: ${GOTHIC_STACK}; font-size: 9pt; font-weight: 700; color: #000;`;
  // 머리글 내용 — 책제목/부제/장제목(first-except: 장 시작 페이지 생략)/소제목(절)
  // 최종본 스타일: 책제목 헤더는 부제가 있으면 '제목 / 부제' 병기.
  const rhContent = (kind) => kind === 'title' ? (o.hasSubtitle ? 'string(book-title) " / " string(book-subtitle)' : 'string(book-title)')
    : kind === 'subtitle' ? 'string(book-subtitle)'
    : kind === 'chapter' ? 'string(chapter-title, first-except)'
    : kind === 'section' ? 'string(sec-title)' : 'none';
  // 정렬 — vivliostyle 마진 박스는 폭이 내용 기준(@top-left/right 는 세로 쌓임, @top-center 는
  //   width:100% 무시하고 가운데 배치 — 실측). 판면 폭을 mm 로 명시해 text-align 이 작동하게 한다.
  const bodyW = o.trimW - m.inner - m.outer; // 판면(글상자) 폭
  const headerBoxes = (kind, align) => {
    // 밑줄 = 상자 테두리(border-bottom)가 아니라 '글자 밑줄'(text-decoration) — 글자가 있을 때만
    //   그려지므로 장 시작 페이지(first-except 로 러닝헤드 글자가 빔)엔 밑줄도 자동으로 안 나온다.
    //   (border-bottom 은 내용이 비어도 빈 상자에 선을 그려 장 시작 페이지에 '떠 있는 줄'이 생겼음.)
    const line = o.headerLine
      ? ' text-decoration: underline; text-decoration-color: #cccccc; text-decoration-thickness: 0.4pt; text-underline-offset: 5pt; margin-bottom: 7pt;'
      : '';
    if (kind === 'none') return ''; // 러닝헤드 없음 = 상자·밑줄 모두 없음
    const content = rhContent(kind);
    // 단일 @top-center 박스(판면 폭 명시) + text-align — 모든 정렬 공통.
    //   ⚠ @top-left 와 @top-center 를 함께 쓰면 두 박스가 공간을 나눠 가져 왼쪽 글이
    //   중앙으로 밀리는 충돌(실측) → 박스는 하나만 쓴다.
    return `@top-center { content: ${content}; width: ${bodyW}mm; text-align: ${align}; vertical-align: bottom; ${rh}${line} }`;
  };
  const headerEvenBox = headerBoxes(o.headerEven, o.headerEvenAlign);
  const headerOddBox = headerBoxes(o.headerOdd, o.headerOddAlign);
  // 쪽번호 위치 — 바깥 하단 / 하단 가운데 / 숨김
  const numEven = o.pageNum === 'outer' ? `@bottom-left { content: counter(page); ${fo} }`
    : o.pageNum === 'center' ? `@bottom-center { content: counter(page); ${fo} }` : '';
  const numOdd = o.pageNum === 'outer' ? `@bottom-right { content: counter(page); ${fo} }`
    : o.pageNum === 'center' ? `@bottom-center { content: counter(page); ${fo} }` : '';
  return `
:root { --content-h: ${(o.trimH - m.top - m.bottom).toFixed(1)}mm; }  /* 판면(글상자) 높이 — 헌사·제사 세로중앙용 */
@page {
  size: ${o.trimW}mm ${o.trimH}mm;
  margin-top: ${m.top}mm; margin-bottom: ${m.bottom}mm;
}
/* 짝수쪽(왼쪽): 바깥여백=왼쪽 */
@page :left {
  margin-left: ${m.outer}mm; margin-right: ${m.inner}mm;
  ${headerEvenBox}
  ${numEven}
}
/* 홀수쪽(오른쪽): 바깥여백=오른쪽 */
@page :right {
  margin-left: ${m.inner}mm; margin-right: ${m.outer}mm;
  ${headerOddBox}
  ${numOdd}
}
/* 디스플레이 페이지(표제지·부표제지·판권) + 앞부속: 러닝헤드·폴리오 없음
   [주의] 이름만 쓴 @page display 는 @page :left/:right (의사클래스가 특이도를 더한다)에 져서
     러닝헤드·쪽번호가 그대로 찍혔다(실측 — 판권 페이지에 장제목이 나왔다).
     이름+의사클래스(@page display:left)로 함께 적어야 이긴다. */
@page display { @top-left { content: none; } @top-center { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; } }
@page display:left { @top-left { content: none; } @top-center { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; } }
@page display:right { @top-left { content: none; } @top-center { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; } }
@page front { @top-left { content: none; } @top-center { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; } }
@page front:left { @top-left { content: none; } @top-center { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; } }
@page front:right { @top-left { content: none; } @top-center { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; } }
/* recto 강제로 생긴 백면 */
@page :blank { @top-left { content: none; } @top-center { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; } }
/* 러닝헤드 장제목 = 전체 원제(공백 포함) — h2 는 '제N회'를 .ch-no 로 쪼개 공백이 사라지므로
   숨김 앵커(.ch-rh)의 원문에서 문자열을 뽑는다(예: "제16회 여포의 신궁, 전위의 최후"). */
.ch-rh { string-set: chapter-title content(); display: none; }
section.chapter h3 { string-set: sec-title content(); }
.book-title-anchor { string-set: book-title content(); display: none; }
.book-subtitle-anchor { string-set: book-subtitle content(); display: none; }

/* ── 본문 타이포(옵션) — 테마 기본을 덮어씀 ── */
body {
  font-weight: ${o.fontWeight};
  letter-spacing: ${o.letterSpacingPt}pt;
}
p { text-indent: ${o.indentPt}pt; margin-bottom: ${o.paragraphSpacingPt}pt; }
p.noindent, p.chapter-lead { text-indent: 0; }
strong { font-weight: ${Math.min(900, o.fontWeight + 400)}; }
/* 소제목(원고 ## = 절) */
section.chapter h3 {
  font-family: ${o.h2Gothic ? GOTHIC_STACK : o.fontStack};
  font-size: ${o.h2SizePt}pt;
  font-weight: ${o.h2Weight};
  text-align: ${o.h2Align};
  margin: ${o.h2MarginTopPt}pt 0 ${o.h2MarginBottomPt}pt;
  letter-spacing: 0;
}
${o.h2Prefix ? `section.chapter h3::before { content: "${o.h2Prefix.replace(/"/g, '\\"')} "; }` : ''}
/* 특별 섹션(반복 코너 — 예: 역사 노트) — 옅은 배경 노트 박스, 본문보다 한 단계 작게 */
div.special-sec {
  background: #f4f1ea;
  padding: 10pt 12pt;
  margin: 16pt 0 10pt;
  font-size: 0.93em;
  line-height: ${Math.max(1.5, o.lineHeight - 0.15)};
}
div.special-sec h3 { margin: 0 0 8pt !important; }
div.special-sec p { text-indent: 0; margin-bottom: 5pt; }
/* 목차 행 — 제목 + 점선 리더(flex 빈칸의 dotted 밑줄) + 우측 쪽번호(target-counter).
   leader()는 미리보기(코어)와 CLI 렌더가 달라 폐기 — 이 방식은 양쪽 동일(실측). */
nav.toc a { display: flex; align-items: baseline; text-decoration: none; color: inherit; }
nav.toc a .tt { flex: 0 1 auto; }
nav.toc a .dots { flex: 1 1 auto; min-width: 1.5em; margin: 0 0.55em; border-bottom: 1.3px dotted #aaaaaa; transform: translateY(-0.28em); }
nav.toc a::after {
  content: target-counter(attr(href url), page);
  font-weight: 400; font-family: ${GOTHIC_STACK}; font-size: 0.95em;
}
/* 판권 배치 — 위(실물 단행본 다수·기본) / 아래(구 앱 최종본 스타일).
   flex 하단정렬은 vivliostyle 조각화에서 height:100% 미해석 → 고정 마진(판면 폭 기준 %)으로. */
section.colophon .cp-wrap { margin-top: ${o.colophonAlign === 'bottom' ? '44%' : '0'}; }
`;
}

/**
 * BookModel → { html, css } (css 는 html 에 인라인 포함돼 있음 — html 만 쓰면 됨)
 */
function buildBookHtml(book, opts = {}) {
  const meta = book.meta || {};
  const platform = getPlatform(opts.platformId || metaPlatformId(meta));
  // 판형 결정 — main.js(표지·책등 계산)와 동일한 검증식으로 통일. 미등록 판형(오타 등)이면
  // 플랫폼 기본 판형으로 폴백(예전엔 getTrim 이 A5 로 떨어져 내지=A5·표지=신국판 불일치 위험).
  const trimId = (meta.trim && TRIM_SIZES[meta.trim]) ? meta.trim
    : ((opts.trimId && TRIM_SIZES[opts.trimId]) ? opts.trimId : platform.defaultTrim);
  const trim = getTrim(trimId);

  const o = {
    trimW: trim.width, trimH: trim.height,
    // ── 본문 타이포 — 기본값은 구 Book Publishing 앱에서 사용자가 쓰던 값 그대로 ──
    fontKey: FONT_STACKS[opts.fontKey] ? opts.fontKey : 'kopub',
    fontSizePt: num(opts.fontSizePt, 10),
    // 행간 — 한국 단행본 관행 = 글자 크기의 1.7~2.0배(10pt 본문 → 17~20pt 행간, 대표 1.8).
    //   구 앱 값(1.65)은 관행 하한보다 좁아 기본을 1.8 로.
    lineHeight: num(opts.lineHeight, 1.8),
    fontWeight: num(opts.fontWeight, 300),
    letterSpacingPt: numAllowNeg(opts.letterSpacingPt, -0.4),
    indentPt: numAllowZero(opts.indentPt, 15),
    // 문단 간격 — 한국 단행본 관행 = 들여쓰기만 하고 문단 간격 0 (간격은 장면 전환 등 의도적 구분에만).
    paragraphSpacingPt: numAllowZero(opts.paragraphSpacingPt, 5), // 최종본 실측 — 문단 사이 뚜렷한 간격
    // ── 여백(mm) — 구 앱: 위20 / 아래15 / 안쪽20 / 바깥17 ──
    marginsMm: Object.assign({ top: 20, bottom: 15, inner: 20, outer: 17 }, opts.marginsMm || {}),
    chapterStart: opts.chapterStart === 'page' ? 'page' : 'recto',
    footnoteMode: (meta.footnoteMode === '미주' || opts.footnoteMode === 'endnote') ? 'endnote' : 'footnote',
    // ── 머리글/쪽번호 노출 선택 ──
    //   내용: 책제목/부제/장제목/소제목(절)/없음 · 정렬: 왼쪽/가운데/오른쪽 (기본=바깥쪽 정렬 관행)
    headerEven: pick(opts.headerEven, ['title', 'subtitle', 'chapter', 'section', 'none'], 'title'),   // 짝수쪽(왼쪽)
    headerOdd: pick(opts.headerOdd, ['title', 'subtitle', 'chapter', 'section', 'none'], 'chapter'),   // 홀수쪽(오른쪽)
    headerEvenAlign: pick(opts.headerEvenAlign, ['left', 'center', 'right'], 'left'),   // 짝수쪽 바깥=왼쪽
    headerOddAlign: pick(opts.headerOddAlign, ['left', 'center', 'right'], 'right'),    // 홀수쪽 바깥=오른쪽
    headerLine: opts.headerLine !== false,                                       // 머리글 아래 구분선
    pageNum: pick(opts.pageNum, ['outer', 'center', 'none'], 'outer'),
    // ── 소제목(원고의 ## = 절) 스타일 — 구 앱: 고딕 800, ❖ 접두, 위25pt/아래10pt ──
    h2SizePt: num(opts.h2SizePt, 10.5),
    h2Gothic: opts.h2Gothic !== false,
    h2Weight: num(opts.h2Weight, 700),
    h2Align: pick(opts.h2Align, ['left', 'center', 'right'], 'left'),
    h2Prefix: opts.h2Prefix != null ? String(opts.h2Prefix) : '❖',
    // 소제목 여백 관행 — 위(넉넉히) : 아래(본문과 가깝게) ≈ 3:1. 아래를 크게 주지 않는다.
    h2MarginTopPt: numAllowZero(opts.h2MarginTopPt, 25),
    h2MarginBottomPt: numAllowZero(opts.h2MarginBottomPt, 8),
    // ── 판권 자동 항목 선택 (null = 전부) ──
    colophonFields: Array.isArray(opts.colophonFields) ? opts.colophonFields : null,
    // ── 판권 배치 — 판면 위(기본) / 아래 ──
    colophonAlign: opts.colophonAlign === 'bottom' ? 'bottom' : 'top',
    // ── 특별 섹션 키워드(쉼표 구분) — 일치하는 소제목 구간을 노트 박스로 (예: '역사 노트') ──
    specialKeywords: String(opts.specialKeyword || '').split(',').map((s) => s.trim()).filter(Boolean),
    // ── 출력 제외 섹션(구조 패널 체크 해제 — 원고는 보존) ──
    excluded: Array.isArray(opts.excluded) ? opts.excluded : [],
    hidePaths: !!opts.hidePaths,
    // ── 영상 대본 모드 — 영상 제작용 블록을 **조판에서만** 제외(대본 파일은 손대지 않는다) ──
    //   대본은 매일 새로 쓰는 영상 파이프라인의 입력이라 사람이 위치를 옮기는 건 지속 불가능하다.
    //   제작 메모(🎯 단일 아크 · 📝 주석·안전필터 · 🎨 일관성 앵커)와 엔진 프롬프트(🖼️/🎬/🎞)만 걸러내고
    //   **본문 인용(성경 낭독 등)은 그대로 남긴다** — 실측: 이 대본의 인용 9개 중 제작메모는 1개뿐이었다.
    scriptMode: !!opts.scriptMode,
    scriptHideShots: !!opts.scriptHideShots,   // 샷 제목(### 샷N)까지 숨겨 줄글로 읽기
    sourceMap: opts.sourceMap !== false,
  };
  o.fontStack = FONT_STACKS[o.fontKey];
  o.hasSubtitle = !!(meta.subtitle && String(meta.subtitle).trim()); // 헤더 '제목 / 부제' 병기용

  const baseDir = opts.baseDir || process.cwd();
  const imageUrl = typeof opts.imageUrl === 'function' ? opts.imageUrl : (abs) => 'file:///' + abs.replace(/\\/g, '/');
  const ctx = {
    footnoteMode: o.footnoteMode,
    scriptMode: o.scriptMode,               // 영상 대본 모드(제작용 블록 제외)
    scriptHideShots: o.scriptHideShots,
    hidePaths: o.hidePaths,   // 작업용 파일 경로 → 파일명만
    endnotes: [],
    resolveImage(src) {
      if (/^(https?|data|media|file):/i.test(src)) return src;
      const abs = path.isAbsolute(src) ? src : path.join(baseDir, src);
      return imageUrl(abs);
    },
  };
  const srcAttr = (b) => (o.sourceMap && typeof b.lineStart === 'number')
    ? ` data-src-line="${b.lineStart}" data-src-end="${b.lineEnd}"` : '';

  const bodyParts = [];
  bodyParts.push(`<span class="book-title-anchor">${esc(meta.title || book.fileTitle || '')}</span>`);
  bodyParts.push(`<span class="book-subtitle-anchor">${esc(meta.subtitle || meta.title || book.fileTitle || '')}</span>`);

  // 표지 안내 페이지 — 미리보기 전용(opts.coverInfo 전달 시에만). 내지 PDF 빌드에서는 전달 안 함.
  if (opts.coverInfo) bodyParts.push(coverInfoHtml(opts.coverInfo, meta, o));

  // 앞부속 — 반표제지(기본 on) → 속표지 → (앞판권) → 예약섹션들(목차는 자동 생성)
  if (truthyDefault(meta.halfTitle, true)) bodyParts.push(halfTitleHtml(meta, book.fileTitle));
  bodyParts.push(titlePageHtml(meta, ctx, book.fileTitle));
  const colFront = /앞/.test(String(meta.colophonPos || ''));
  const colSection = book.back.find((s) => s.key === 'colophon');
  const colIncluded = colSection && !o.excluded.includes('colophon');
  if (colFront && colIncluded) bodyParts.push(colophonHtml(meta, ctx, true, colSection, book, srcAttr, o.colophonFields));
  for (const s of book.front) {
    if (o.excluded.includes(s.key)) continue; // 구조 패널에서 체크 해제(원고는 보존)
    if (s.key === 'toc') { bodyParts.push(tocHtml(book, s.title, o.excluded)); continue; }
    bodyParts.push(`<section class="front-section sec-${s.key}" id="sec-${s.key}">
<h2${o.sourceMap ? ` data-src-line="${s.lineStart}" data-src-end="${s.lineStart}"` : ''}>${esc(s.title)}</h2>
${blocksHtml(s.blocks, book, ctx, srcAttr)}
</section>`);
  }

  // 목차 자동 생성 — 원고에 [목차] 섹션이 없으면 프로그램이 만들어 제공(원고에 있으면 그 위치가 우선).
  //   구조 패널에서 '목차' 체크 해제(excluded)하면 자동 생성도 생략.
  if (!book.front.some((s) => s.key === 'toc') && !o.excluded.includes('toc')) {
    bodyParts.push(tocHtml(book, '목차', o.excluded));
  }

  // 본문 — 부 표제지 + 장
  for (const p of book.parts) {
    const shownChapters = (p.chapters || []).filter((c) => !chapterExcluded(c.title, o.excluded));
    if (p.title && shownChapters.length) {
      bodyParts.push(`<section class="part-title" id="part-${p.num || p.lineStart}">
<div class="pt-num">${p.num ? `제${p.num}부` : ''}</div><h2>${esc(p.title)}</h2></section>`);
    }
    for (const c of shownChapters) {
      bodyParts.push(`<section class="chapter" id="ch-${c.num}">
${c.title ? (() => {
        // 최종본 스타일: '제N회'와 제목을 2줄로 분리(중앙 정렬). 러닝헤드용 전체 원제는 숨김 앵커(.ch-rh)로.
        const mCh = /^(제\s*\d+\s*회)[.,]?\s*(.+)$/.exec(c.title);
        const inner = mCh ? `<span class="ch-no">${esc(mCh[1])}</span>${esc(mCh[2])}` : esc(c.title);
        return `<span class="ch-rh" aria-hidden="true">${esc(c.title)}</span>`
          + `<h2 class="chapter-title"${o.sourceMap ? ` data-src-line="${c.lineStart}" data-src-end="${c.lineStart}"` : ''}>${inner}</h2>`;
      })() : ''}
${chapterBlocksHtml(c.blocks, book, ctx, srcAttr, o.specialKeywords)}
</section>`);
    }
  }

  // 뒷부속 — 예약섹션들 → (미주) → 판권(뒤 기본)
  for (const s of book.back) {
    if (s.key === 'colophon') continue;
    if (o.excluded.includes(s.key)) continue; // 구조 패널에서 체크 해제(원고는 보존)
    bodyParts.push(`<section class="back-section sec-${s.key}" id="sec-${s.key}">
<h2${o.sourceMap ? ` data-src-line="${s.lineStart}" data-src-end="${s.lineStart}"` : ''}>${esc(s.title)}</h2>
${blocksHtml(s.blocks, book, ctx, srcAttr)}
</section>`);
    // 미주는 참고문헌·저자소개보다 앞(후기 뒤)에 두는 게 관행 — afterword/thanks 뒤 첫 위치에 삽입
    if (o.footnoteMode === 'endnote' && (s.key === 'thanks' || s.key === 'afterword') && ctx.endnotes.length && !ctx._endnotesDone) {
      bodyParts.push(endnotesHtml(ctx)); ctx._endnotesDone = true;
    }
  }
  if (o.footnoteMode === 'endnote' && ctx.endnotes.length && !ctx._endnotesDone) bodyParts.push(endnotesHtml(ctx));
  if (colIncluded && !colFront) bodyParts.push(colophonHtml(meta, ctx, false, colSection, book, srcAttr, o.colophonFields));

  // ⚠ CSS 변수(:root + var()) 를 쓰지 않고 값을 직접 치환 — vivliostyle core(브라우저 미리보기)가
  //   var() 를 CLI 와 다르게 해석해 본문 크기가 16px 로 폴백 → 쪽수가 ~2.5배로 뻥튀기되던 문제.
  const theme = fs.readFileSync(THEME_CSS_PATH, 'utf8')
    .replace(/var\(--font-body\)/g, o.fontStack)
    .replace(/calc\(var\(--font-size\) - 2pt\)/g, `${Math.max(6, o.fontSizePt - 2)}pt`)
    .replace(/var\(--font-size\)/g, `${o.fontSizePt}pt`)
    .replace(/var\(--line-height\)/g, String(o.lineHeight))
    .replace(/var\(--chapter-break\)/g, o.chapterStart === 'page' ? 'page' : 'recto');
  // 순서: 폰트 → 테마(기본) → pageCss(옵션 오버라이드가 마지막에 이기도록)
  const css = (opts.fontCss || '') + '\n' + theme + '\n' + pageCss(o);
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${esc(meta.title || book.fileTitle || '책')}</title>
<style>
${css}
</style>
</head>
<body>
${bodyParts.join('\n\n')}
</body>
</html>`;
  return { html, css, trimId, trim, platform, options: o };
}

function num(v, d) { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : d; }
function numAllowZero(v, d) { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : d; }
function numAllowNeg(v, d) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function pick(v, allowed, d) { return allowed.includes(v) ? v : d; }
function truthyDefault(v, d) {
  if (v == null || v === '') return d;
  return !/^(off|no|없음|아니오|false|0|x)$/i.test(String(v).trim());
}
function metaPlatformId(meta) {
  const p = String(meta.platform || '').toLowerCase();
  if (/교보|kyobo/.test(p)) return 'kyobo';
  if (/작가와|jakkawa/.test(p)) return 'jakkawa';
  return 'bookk';
}

module.exports = {
  chapterKey, chapterExcluded, shortenPath, LOCAL_PATH_RE, scriptFilter, buildBookHtml, metaPlatformId, esc, inlineMd, FONT_OPTIONS, COLOPHON_FIELDS, FONT_STACKS, GOTHIC_STACK };
