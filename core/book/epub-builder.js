'use strict';

/**
 * epub-builder.js — BookModel → ePub (전자책). 기본 **EPUB 2.0**(부크크 전자책 업로드 · 로이 결정 2026-10-01) / 옵션 epubVersion:'3' = EPUB 3.0.
 *   2.0 = OPF 2.0 + toc.ncx + XHTML 1.1(section/aside/nav/figure 없음·epub:type 없음·blockquote 안에 p). 신규 의존성 없음.
 *
 * 구성: mimetype(무압축·첫 엔트리) + META-INF/container.xml + OEBPS/(content.opf ·
 *   nav.xhtml · style.css · titlepage · 부속물 · 장별 xhtml · 판권).
 * 각주는 epub:type="noteref/footnote" (지원 리더에서 팝업, 그 외 장 끝 미주).
 * 전자책 표지: meta.ebookCover(전자책표지) 지정 시 그 이미지, 없으면 인쇄 표지
 *   스프레드에서 앞표지 영역을 ffmpeg 로 자동 크롭.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { esc, inlineMd, chapterExcluded, scriptFilter, specialKeywordsOf, splitSpecialBlocks, filterColophonSection } = require('./html-builder');
const JB = require('./jakkawa-biblio');

// ── 미니 ZIP 라이터 ──
// adm-zip 은 writeZip 때 엔트리를 이름순 정렬해 ePub 규격(mimetype=첫 엔트리·무압축)을
// 못 지킨다 → 로컬헤더+센트럴디렉터리를 직접 조립(추가 순서 보존, mimetype 만 STORED).
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
class MiniZip {
  constructor() { this.items = []; }
  // store=true → 무압축(STORED). 그 외 DEFLATE.
  add(name, data, store = false) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const comp = store ? raw : zlib.deflateRawSync(raw, { level: 9 });
    this.items.push({ name: Buffer.from(name, 'utf8'), raw, comp, method: store ? 0 : 8, crc: crc32(raw) });
  }
  toBuffer() {
    const parts = []; const central = [];
    let offset = 0;
    for (const it of this.items) {
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); // UTF-8 플래그
      lh.writeUInt16LE(it.method, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); // 시간/날짜 고정
      lh.writeUInt32LE(it.crc, 14); lh.writeUInt32LE(it.comp.length, 18); lh.writeUInt32LE(it.raw.length, 22);
      lh.writeUInt16LE(it.name.length, 26); lh.writeUInt16LE(0, 28);
      parts.push(lh, it.name, it.comp);
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
      cd.writeUInt16LE(it.method, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0x21, 14);
      cd.writeUInt32LE(it.crc, 16); cd.writeUInt32LE(it.comp.length, 20); cd.writeUInt32LE(it.raw.length, 24);
      cd.writeUInt16LE(it.name.length, 28);
      cd.writeUInt32LE(offset, 42);
      central.push(Buffer.concat([cd, it.name]));
      offset += 30 + it.name.length + it.comp.length;
    }
    const cdBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(this.items.length, 8); eocd.writeUInt16LE(this.items.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, cdBuf, eocd]);
  }
}

// 📘 EPUB 2.0 — 내용 문서는 XHTML 1.1: HTML5 요소(section·aside·nav·figure)와 epub:type 이 없다. 3.0 용 마크업을 이 한 곳에서 2.0 으로 바꾼다.
function toXhtml11(html) {
  return String(html)
    .replace(/ epub:type="[^"]*"/g, '')
    .replace(/<(\/?)(section|aside)(?![a-z])/g, '<$1div')
    .replace(/<figure[^>]*>/g, '<div class="figure">').replace(/<\/figure>/g, '</div>')
    .replace(/<figcaption[^>]*>/g, '<p class="figcaption">').replace(/<\/figcaption>/g, '</p>')
    .replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, '<blockquote><p>$1</p></blockquote>');
}
function wrapXhtml(title, body, cssHref = 'style.css', v2 = false) {
  if (v2) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ko">
<head><meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="${cssHref}"/></head>
<body>
${toXhtml11(body)}
</body>
</html>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ko" lang="ko">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="${cssHref}"/></head>
<body>
${body}
</body>
</html>`;
}

const EPUB_CSS = `
body { font-family: serif; line-height: 1.7; word-break: keep-all; margin: 0 4%; }
p { margin: 0; text-indent: 1em; }
p.noindent, p.chapter-lead { text-indent: 0; }
p.chapter-lead { font-style: italic; color: #444; margin: 0 0 2em; }
h1.chapter-title { font-size: 1.4em; line-height: 1.5; margin: 2.5em 0 2em; }
h2.sec { font-size: 1.1em; margin: 2em 0 0.8em; }
h3.sec { font-size: 1em; margin: 1.6em 0 0.6em; }
blockquote { margin: 1.2em 1.4em; white-space: pre-line; font-size: 0.95em; }
blockquote p { text-indent: 0; }
div.verse { margin: 1.4em auto; text-align: center; white-space: pre-wrap; line-height: 2; }
.figure { margin: 1.5em 0; text-align: center; }
.figure img { max-width: 100%; }
.figcaption { text-indent: 0; text-align: center; font-size: 0.85em; color: #555; margin-top: 0.5em; }
hr.scene { border: none; text-align: center; margin: 1.6em 0; }
hr.scene:after { content: "✻"; color: #777; }
.front h1, .back h1 { font-size: 1.25em; text-align: center; margin: 3em 0 2.5em; }
.dedication, .epigraph { text-align: center; }
div.special-sec { background: #f4f1ea; padding: 0.7em 0.9em; margin: 1.4em 0 1em; font-size: 0.93em; }
div.special-sec h2.sec, div.special-sec h3.sec { margin: 0 0 0.6em; }
div.special-sec p { text-indent: 0; margin-bottom: 0.4em; }
.dedication p, .epigraph p { text-indent: 0; margin-top: 30%; }
.titlepage { text-align: center; }
.titlepage .t { font-size: 1.7em; font-weight: bold; margin-top: 30%; }
.titlepage .t2 { font-size: 1.25em; font-weight: bold; margin-top: 0.6em; }
.titlepage .s { color: #555; margin-top: 1em; }
.titlepage .a { margin-top: 3em; }
.titlepage .pub { margin-top: 4em; color: #666; }
.fnback { font-size: 0.85em; margin-left: 0.4em; text-decoration: none; }
.fn { font-size: 0.88em; color: #333; margin: 1.5em 0 0; padding-top: 0.6em; border-top: 1px solid #ccc; }
.colophon p { text-indent: 0; margin: 0.25em 0; font-size: 0.9em; }
.colophon .cp-title { font-size: 1.05em; margin: 0 0 0.8em; }
.colophon .cp-row, .colophon .cp-date { margin: 0.15em 0; }
.colophon .cp-note { margin: 0.2em 0; padding-left: 1em; text-indent: -1em; }
.colophon .cp-legal { margin: 0.6em 0 0; }
table.md-table { width: 100%; border-collapse: collapse; font-size: 0.86em; text-indent: 0; text-align: left; margin: 1.2em 0; }
table.md-table th, table.md-table td { border: 1px solid #8a8a8a; padding: 0.34em 0.5em; vertical-align: top; text-indent: 0; text-align: left; }
table.md-table th { font-weight: bold; background: #efeeeb; }
ul.md-list, ol.md-list { margin: 1em 0; padding-left: 1.45em; }
ul.md-list li, ol.md-list li { margin: 0.3em 0; text-indent: 0; text-align: left; }
ul.md-list li.task, ol.md-list li.task { list-style: none; }
span.code { font-size: 0.94em; overflow-wrap: anywhere; }
`;

// 표·목록 — 내지(html-builder)와 같은 구조. ePub 은 페이지 개념이 없어 머리행 반복은 불필요.
function tableXhtml(b, book, ctx) {
  const cells = (row, tag) => row.map((c) => `<${tag}>${inline(c, book, ctx)}</${tag}>`).join("");
  const head = (b.header && b.header.length) ? `<thead><tr>${cells(b.header, "th")}</tr></thead>` : "";
  const n = (b.header || []).length;
  const body = (b.rows || []).map((r) => {
    const row = n ? Array.from({ length: n }, (_, i) => (r[i] == null ? "" : r[i])) : r;
    return `<tr>${cells(row, "td")}</tr>`;
  }).join("\n");
  return `<table class="md-table">${head}<tbody>${body}</tbody></table>`;
}
function listXhtml(b, book, ctx) {
  const items = b.items || [];
  if (!items.length) return "";
  let i = 0;
  const build = (level) => {
    const tag = items[i].ordered ? "ol" : "ul";
    let out = `<${tag} class="md-list">`;
    while (i < items.length && items[i].level >= level) {
      if (items[i].level > level) { out += build(items[i].level); continue; }
      const it = items[i]; i++;
      const box = it.checked == null ? "" : (it.checked ? "☑ " : "☐ ");
      let inner = box + inline(it.text, book, ctx);
      if (i < items.length && items[i].level > level) inner += build(items[i].level);
      out += `<li${it.checked == null ? "" : ' class="task"'}>${inner}</li>`;
    }
    return out + `</${tag}>`;
  };
  return build(items[0].level);
}

// 블록 → xhtml (ePub 전용 — 각주는 noteref + 장 끝 aside)
// 📱 전자책(ePub) 판권 — PDF 전자책판 `colophonHtml` 과 같은 내용을 XHTML 글자로(R20 · 2026-10-06).
//   제목 · 발행 이력 · 「라벨 | 값」 행(ISBN = 전자책 ISBN · 종이책 정가 제외 · 발행일 = 전자책발행일 우선) · [판권] 노트(별표 줄은 글머리표 없이 문단) · ⓒ + 재사용 문구.
//   ⚠ 예전엔 [판권] 섹션이 있으면 그 별표 목록만 글머리표로 나와 ISBN·ⓒ 가 빠졌다(부크크 판권지 수정 요청).
function colophonXhtml(meta0, col, book, ctx) {
  const meta = { ...meta0, isbn: meta0.ebookIsbn || meta0.isbn, isbnAddon: meta0.ebookIsbn ? '' : meta0.isbnAddon, price: '', issueDate: meta0.ebookIssueDate || meta0.issueDate };
  const out = [];
  out.push(`<p class="cp-title"><strong>${esc(meta.title || '')}</strong>${meta.subtitle ? ' ' + esc(meta.subtitle) : ''}</p>`);
  for (const s of String(meta.issueDate || '').split(/\s*[;；]\s*/).map((x) => x.trim()).filter(Boolean)) {
    const m = s.match(/^(.*?)\s*((?:19|20)\d{2}[\D].*)$/);
    out.push(`<p class="cp-date"><strong>${esc((m && m[1].trim()) || '초판 1쇄 발행')}</strong> ${esc(((m ? m[2] : s) || '').trim())}</p>`);
  }
  const row = (label, v) => (v ? `<p class="cp-row"><strong>${esc(label)}</strong> | ${esc(v)}</p>` : '');
  out.push(
    row('지은이', meta.author), row(meta.translatorLabel || '옮긴이', meta.translator), row('발행인', meta.issuer), row('편집인', meta.editor),
    row('발행처', meta.publisher), row('등록', meta.regNo), row('주소', meta.address), row('전화', meta.phone), row('팩스', meta.fax),
    row('대표메일', meta.email), row('홈페이지', meta.homepage), row('블로그', meta.blog), row('페이스북', meta.facebook), row('인스타그램', meta.instagram),
    ...Object.entries(meta.extra || {}).map(([k, v]) => row(k, v)),
    meta.isbn ? `<p class="cp-row cp-isbn"><strong>ISBN</strong> | ${esc(meta.isbn)}${meta.isbnAddon ? ' ' + esc(meta.isbnAddon) : ''}</p>` : '',
    row('전자책', meta.ebookPrice),
  );
  // [판권] 노트 — 표·제목·ⓒ 를 되풀이한 줄은 빼고(filterColophonSection) 고지문만. 별표 줄은 글머리표(목록) 아닌 문단.
  const kept = col && col.blocks && col.blocks.length ? filterColophonSection(col, meta).blocks : [];
  for (const b of kept) {
    if (!b) continue;
    if (b.type === 'p' && typeof b.text === 'string') {
      for (const ln of b.text.split('\n').map((x) => x.trim()).filter(Boolean)) out.push(`<p class="cp-note">${inline(ln, book, ctx)}</p>`);
    } else if (b.type === 'list') {
      for (const it of (b.items || [])) out.push(`<p class="cp-note">* ${inline(it.text, book, ctx)}</p>`);
    } else if (b.type === 'quote') {
      out.push(`<blockquote class="cp-box">${inline(b.text, book, ctx)}</blockquote>`);
    } else out.push(blocksXhtml([b], book, ctx));
  }
  const year = (String(meta.issueDate || '').match(/\d{4}/) || [new Date().getFullYear()])[0];
  const cpName = meta.translator || meta.author;
  const owner = meta.copyright || (cpName ? `ⓒ ${cpName} ${year}. All rights reserved.` : '');
  if (owner) out.push(`<p class="cp-legal">${esc(owner)}</p>`, '<p class="cp-legal">이 책의 내용 중 전부 또는 일부를 재사용하려면 반드시 저작권자의 서면 동의를 얻어야 합니다.</p>');
  return out.filter(Boolean).join('\n');
}
function blocksXhtml(blocks0, book, ctx, specials) {
  if (specials && specials.length) {
    // 특별 섹션(역사 노트 등) — 종이책처럼 상자로(R5①). 각주 모으기는 아래 한 번만.
    const filtered = scriptFilter(blocks0, ctx);
    const parts = splitSpecialBlocks(filtered, specials).map((p) => {
      const inner = blocksXhtml(p.blocks, book, { ...ctx, __noFlush: true, __sharedNotes: true }, null);
      return p.special ? `<div class="special-sec">${inner}</div>` : inner;
    });
    return parts.join('\n') + flushNotes(ctx);
  }
  const out = [];
  // 영상 대본 모드 필터를 내지와 똑같이 태운다 — 안 맞추면 종이책과 전자책 내용이 갈린다.
  for (const b of scriptFilter(blocks0, ctx)) {
    switch (b.type) {
      case 'p': out.push(`<p>${inline(b.text, book, ctx)}</p>`); break;
      case 'lead': out.push(`<p class="chapter-lead">${inline(b.text, book, ctx)}</p>`); break;
      case 'h3': out.push(`<h2 class="sec">${inline(b.text, book, ctx)}</h2>`); break;
      case 'h4': out.push(`<h3 class="sec">${inline(b.text, book, ctx)}</h3>`); break;
      case 'quote': out.push(`<blockquote>${inline(b.text, book, ctx)}</blockquote>`); break;
      case 'verse': out.push(`<div class="verse">${(b.lines || []).map(esc).join('\n')}</div>`); break;
      case 'image': {
        const img = ctx.addImage(b.src);
        if (img) out.push(`<figure class="figure"><img src="${img}" alt="${esc(b.caption || '')}"/>${b.caption ? `<figcaption class="figcaption">${inlineMd(b.caption)}</figcaption>` : ''}</figure>`);
        break;
      }
      case 'table': out.push(tableXhtml(b, book, ctx)); break;
      case 'list': out.push(listXhtml(b, book, ctx)); break;
      case 'hr': out.push('<hr class="scene"/>'); break;
      default: break;
    }
  }
  // 이 문서에서 나온 각주들 — 장/섹션 끝에 aside(epub:type footnote). 특별 섹션 조각 안에서는 미루고 바깥이 한 번에.
  if (!ctx.__noFlush) out.push(flushNotes(ctx));
  return out.filter(Boolean).join('\n');
}
function flushNotes(ctx) {
  if (!ctx.notes.length) return '';
  const h = ctx.notes.map((n) => `<aside epub:type="footnote" class="fn" id="${n.id}"><p>${n.num}) ${inlineMd(n.text)} <a class="fnback" href="#fnref-${n.num}">↩ 본문</a></p></aside>`).join('\n');
  ctx.notes.length = 0;
  return h;
}
function inline(text, book, ctx) {
  const io = { hidePaths: !!(ctx && ctx.hidePaths) };
  const parts = String(text || '').split(/(\[\^[^\]]+\])/);
  let out = '';
  for (const p of parts) {
    const m = p.match(/^\[\^([^\]]+)\]$/);
    if (!m) { out += inlineMd(p, io); continue; }
    const def = book.footnotes[m[1]];
    if (!def) { out += inlineMd(p, io); continue; }
    // 🔢 각주 번호는 **문서(장)마다 1번부터**(R21 · 로이 2026-10-02) — 순번은 ctx.fn 객체(참조)에 둔다: 특별 섹션 조각은 ctx 를 복사해 쓰는데 숫자를 복사하면 조각마다 번호가 되풀이돼 id 가 겹쳤다.
    const n = ++ctx.fn.seq;
    const id = `fn-${n}`;
    ctx.notes.push({ id, num: n, text: def.text });
    out += `<sup><a epub:type="noteref" id="fnref-${n}" href="#${id}">${n}</a></sup>`;
  }
  return out;
}

// 인쇄 표지 스프레드에서 앞표지 영역 크롭 (ffmpeg) → jpg. 실패 시 null.
async function cropFrontCover(spreadImage, spread, outJpg) {
  try {
    const { readImageSize } = require('../../vrew/vrew-builder');
    const dim = readImageSize(spreadImage);   // {w,h} 반환 (width/height 아님)
    if (!dim || !dim.w) return null;
    const pxPerMm = dim.w / spread.widthMm;
    // 앞표지 x = bleed + [날개] + 뒤표지 + 책등, 폭 = 판형폭 (parts 에서 계산)
    let x = 0, w = 0;
    let acc = 0;
    for (const part of spread.parts) {
      if (part.name === '앞표지') { x = acc; w = part.mm; break; }
      acc += part.mm;
    }
    if (!w) return null;
    const cx = Math.round(x * pxPerMm), cw = Math.round(w * pxPerMm);
    const cy = Math.round(3 * pxPerMm), ch = Math.round((spread.heightMm - 6) * pxPerMm);
    const { getFfmpegPath } = require('../media-utils');
    const ff = getFfmpegPath();
    if (!ff) return null;
    const { execFile } = require('child_process');
    await new Promise((res, rej) => execFile(ff, ['-y', '-i', spreadImage, '-vf', `crop=${cw}:${ch}:${cx}:${cy}`, '-q:v', '3', outJpg], { windowsHide: true }, (e) => (e ? rej(e) : res())));
    return fs.existsSync(outJpg) ? outJpg : null;
  } catch (_) { return null; }
}

/**
 * BookModel → .epub 파일.
 * @param {object} book  parseBookText/parseBookFiles 결과
 * @param {{ outPath, baseDir, spread?, coverImagePath?, log? }} a
 */
async function buildEpub(book, a) {
  const log = a.log || (() => {});
  const meta = book.meta || {};
  const V2 = String(a.epubVersion == null ? '2' : a.epubVersion).replace(/\D.*$/, '') !== '3';   // 기본 EPUB 2.0
  const zip = new MiniZip();
  zip.addFile = (name, data) => zip.add(name, data); // 기존 호출부 호환
  const manifest = [];
  const spine = [];
  const navItems = [];
  let imgSeq = 0;

  const excluded = Array.isArray(a.excluded) ? a.excluded : [];
  const specials = specialKeywordsOf(meta, { specialKeyword: a.specialKeyword });   // 설정 + 원고 메타 `> 특별섹션:`
  const ctx = {
    fn: { seq: 0 }, notes: [],
    hidePaths: !!a.hidePaths,
    scriptMode: !!a.scriptMode, scriptHideShots: !!a.scriptHideShots,
    addImage(src) {
      try {
        const abs = path.isAbsolute(src) ? src : path.join(a.baseDir || '.', src);
        if (!fs.existsSync(abs)) return null;
        const ext = path.extname(abs).toLowerCase().replace('.', '') || 'png';
        const name = `img/${String(++imgSeq).padStart(2, '0')}.${ext}`;
        zip.addFile(`OEBPS/${name}`, fs.readFileSync(abs));
        manifest.push(`<item id="img${imgSeq}" href="${name}" media-type="image/${ext === 'jpg' ? 'jpeg' : ext}"/>`);
        return name;
      } catch (_) { return null; }
    },
  };

  // 1) mimetype — 반드시 첫 엔트리 + 무압축(STORED)
  zip.add('mimetype', 'application/epub+zip', true);
  // 2) container
  zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`));
  // 🔤 한자 글꼴 동봉 — 기본 켬(embedFonts !== 'none'): HanjaSerif-Light(한자 12,421자) + Noto Serif KR Light(한자·기호). 한글은 글꼴에 없어 리더 글꼴로 나온다(글자 단위 폴백).
  //   부크크 전자책 EPUB 업로드 한도 20MB — 실측 크기는 작업노트 2026-10(v0.6.4). 'none' = 글꼴 미동봉(≈ 본문 크기 + 표지만).
  let fontCss = '';
  if (a.embedFonts !== 'none') {
    const FD = path.join(__dirname, '..', '..', 'assets', 'fonts', 'book');
    const faces = [['Priming Hanja Serif', 'HanjaSerif-Light.ttf', 'hanja'], ['Noto Serif KR', 'NotoSerifKR-Light.ttf', 'noto']];
    const used = [];
    for (const [fam, file, id] of faces) {
      const fp = path.join(FD, file);
      if (!fs.existsSync(fp)) continue;
      zip.addFile(`OEBPS/fonts/${file}`, fs.readFileSync(fp));
      manifest.push(`<item id="font-${id}" href="fonts/${file}" media-type="application/x-font-ttf"/>`);
      fontCss += `@font-face { font-family: "${fam}"; src: url(fonts/${file}); font-weight: normal; font-style: normal; }
`;
      used.push(`"${fam}"`);
    }
    if (used.length) fontCss += `body { font-family: ${used.join(', ')}, serif; }
`;
  }
  zip.addFile('OEBPS/style.css', Buffer.from(EPUB_CSS + fontCss));
  manifest.push('<item id="css" href="style.css" media-type="text/css"/>');

  const addDoc = (id, name, title, bodyHtml, opts = {}) => {
    zip.addFile(`OEBPS/${name}`, Buffer.from(wrapXhtml(title, bodyHtml, 'style.css', V2)));
    manifest.push(`<item id="${id}" href="${name}" media-type="application/xhtml+xml"${opts.nav ? ' properties="nav"' : ''}/>`);
    if (!opts.skipSpine) spine.push(`<itemref idref="${id}"${opts.linear === false ? ' linear="no"' : ''}/>`);
    if (opts.toc) navItems.push({ href: name, title: opts.toc });
  };

  // 3) 표지 — 전자책표지(meta.ebookCover) > 인쇄 스프레드 앞표지 크롭
  let coverAdded = false;
  let coverSrc = a.ebookCoverPath && /\.(jpe?g|png)$/i.test(a.ebookCoverPath) && fs.existsSync(a.ebookCoverPath) ? a.ebookCoverPath   // 표지 도구의 전자책앞표지.jpg 등(호출 쪽이 찾아 둔 것)
    : meta.ebookCover && /\.(jpe?g|png)$/i.test(meta.ebookCover) && fs.existsSync(path.isAbsolute(meta.ebookCover) ? meta.ebookCover : path.join(a.baseDir || '.', meta.ebookCover))
    ? (path.isAbsolute(meta.ebookCover) ? meta.ebookCover : path.join(a.baseDir || '.', meta.ebookCover)) : null;
  if (!coverSrc && a.coverImagePath && a.spread && fs.existsSync(a.coverImagePath)) {
    const tdir = a.tmpDir || path.dirname(a.outPath);
    try { fs.mkdirSync(tdir, { recursive: true }); } catch (_) {}
    const tmp = path.join(tdir, a.coverTmpName || '_ebook-cover.jpg');   // 권마다 다른 이름(완성 폴더에 여러 권 — 같은 이름이면 다른 권 표지가 남는다)
    coverSrc = await cropFrontCover(a.coverImagePath, a.spread, tmp);
    if (coverSrc) log('🖼 인쇄 표지에서 앞표지 자동 크롭 → 전자책 표지');
  }
  if (coverSrc) {
    // 🖼 어느 파일이 1쪽(표지)이 됐는지 — 부크크 「앞표지 = 1쪽」 점검(R21 · 로그에서 확인)
    const fromMeta = !!meta.ebookCover && path.basename(String(meta.ebookCover)).toLowerCase() === path.basename(coverSrc).toLowerCase();
    log(`🖼 전자책 표지: ${path.basename(coverSrc)} (${fromMeta ? '원고 메타' : (a.ebookCoverPath && coverSrc === a.ebookCoverPath ? '표지 도구' : '인쇄 표지 크롭')})`);
    const ext = path.extname(coverSrc).toLowerCase().replace('.', '') || 'jpg';
    zip.addFile(`OEBPS/cover.${ext}`, fs.readFileSync(coverSrc));
    manifest.push(`<item id="cover-img" href="cover.${ext}" media-type="image/${ext === 'jpg' ? 'jpeg' : ext}"${V2 ? '' : ' properties="cover-image"'}/>`);
    addDoc('cover', 'cover.xhtml', '표지', `<div style="text-align:center"><img src="cover.${ext}" alt="표지" style="max-width:100%"/></div>`);
    coverAdded = true;
  }
  if (/앞/.test(String(meta.colophonPos || ''))) addColophon();   // 판권위치: 앞 — 표지(1쪽) 바로 다음(2쪽)

  // 4) 표제지
  addDoc('titlepage', 'titlepage.xhtml', '표제지', `<div class="titlepage">
${(() => { const ls = require('./title-lines').titleLines(meta, book.fileTitle); return ls.map((l, i) => (i === 0 ? `<p class="t">${esc(l)}</p>` : `<p class="t2">${esc(l)}</p>`)).join('\n'); })()}
${meta.subtitle ? `<p class="s">${esc(meta.subtitle)}</p>` : ''}
<p class="a">${esc(meta.author || '')}</p>
${meta.translator ? `<p class="s">${esc(meta.translator)}</p>` : ''}
<p class="pub">${esc(meta.publisher || '')}</p>
</div>`);

  // 5) 앞부속 (목차 마커는 스킵 — ePub 은 nav 가 목차)
  for (const s of book.front) {
    if (s.key === 'toc') continue;
    if (excluded.includes(s.key)) continue; // 구조 패널에서 체크 해제(원고 보존)
    ctx.fn.seq = 0;   // 각주 번호는 문서마다 1번부터
    addDoc(`front-${s.key}`, `front-${s.key}.xhtml`, s.title,
      `<section class="front ${s.key === 'dedication' ? 'dedication' : ''}" epub:type="frontmatter"><h1>${esc(s.title)}</h1>\n${blocksXhtml(s.blocks, book, ctx)}</section>`,
      { toc: s.title });
  }

  // 6) 본문 — 부/장
  for (const p of book.parts) {
    const shownChapters = (p.chapters || []).filter((c) => !chapterExcluded(c.title, excluded));
    if (p.title && shownChapters.length) {
      addDoc(`part-${p.num || 'x'}`, `part-${p.num || 'x'}.xhtml`, p.title,
        `<section epub:type="part" style="text-align:center"><h1 style="margin-top:35%">${p.num ? `제${p.num}부 ` : ''}${esc(p.title)}</h1></section>`,
        { toc: `${p.num ? `제${p.num}부 ` : ''}${p.title}` });
    }
    for (const c of shownChapters) {
      ctx.fn.seq = 0;   // 각주 번호는 장마다 1번부터
      addDoc(`ch-${c.num}`, `ch-${String(c.num).padStart(3, '0')}.xhtml`, c.title,
        `<section epub:type="chapter"><h1 class="chapter-title">${esc(c.title)}</h1>\n${blocksXhtml(c.blocks, book, ctx, specials)}</section>`,
        { toc: c.title });
    }
  }

  // 7) 뒷부속 + 판권
  for (const s of book.back) {
    if (s.key === 'colophon') continue;
    if (excluded.includes(s.key)) continue;
    ctx.fn.seq = 0;
    addDoc(`back-${s.key}`, `back-${s.key}.xhtml`, s.title,
      `<section class="back" epub:type="backmatter"><h1>${esc(s.title)}</h1>\n${blocksXhtml(s.blocks, book, ctx)}</section>`, { toc: s.title });
  }
  // 판권 문서 — `> 판권위치: 앞` 이면 표지 바로 다음(2쪽), 아니면 맨 뒤. 부크크: 「앞표지 = 1쪽 · 판권지 = 2쪽 또는 마지막 쪽」.
  function addColophon() {
    const col = excluded.includes('colophon') ? null : book.back.find((s) => s.key === 'colophon');
    // 📱 작가와 전자책 — 작가와 「서지정보 페이지」 공식 양식(판권 자리 · 마지막 쪽 한 곳) + [판권]의 고지문
    ctx.fn.seq = 0;   // 판권 문서도 1번부터
    let jwBody = '';
    if (JB.isJakkawaMeta(meta)) {
      const jb = JB.biblio(meta);
      const year = (String(meta.issueDate || '').match(/\d{4}/) || [new Date().getFullYear()])[0];
      const cpName = meta.translator || meta.author;
      const owner = meta.copyright || (cpName ? `ⓒ ${cpName} ${year}. All rights reserved.` : '');
      const kept = col && col.blocks && col.blocks.length ? blocksXhtml(filterColophonSection(col, meta).blocks, book, ctx) : '';
      jwBody = jb.rows.map(([k, v]) => `<p>${esc(k)} | ${esc(v)}</p>`).join('\n')
        + (kept ? `\n${kept}` : '') + (owner ? `\n<p>${esc(owner)}</p>` : '') + `\n<p>${esc(jb.legal)}</p>`;
    }
    const colBody = jwBody ? jwBody : colophonXhtml(meta, col, book, ctx);   // 📱 PDF 전자책판과 같은 내용(R20)
    addDoc('colophon', 'colophon.xhtml', '판권', `<section class="colophon" epub:type="colophon"><h1 style="font-size:1.1em">판권</h1>\n${colBody}</section>`, { toc: '판권' });
  }
  const colFront = /앞/.test(String(meta.colophonPos || ''));
  if (!colFront) addColophon();

  // 8) nav
  const uid = 'urn:isbn:' + (String(meta.ebookIsbn || meta.isbn || '').replace(/[^0-9Xx]/g, '') || 'priming-' + Buffer.from(meta.title || 'book').toString('hex').slice(0, 12));
  if (V2) {
    // 📘 EPUB 2.0 — 목차는 toc.ncx (nav.xhtml 없음). 모든 navPoint 는 spine 문서를 가리킨다.
    const pts = navItems.map((n, i) => `    <navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(n.title)}</text></navLabel><content src="${n.href}"/></navPoint>`).join('\n');
    zip.addFile('OEBPS/toc.ncx', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="ko">
  <head>
    <meta name="dtb:uid" content="${esc(uid)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${esc(meta.title || book.fileTitle || '책')}</text></docTitle>
  <navMap>
${pts}
  </navMap>
</ncx>`));
    manifest.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
  } else {
    const navLis = navItems.map((n) => `<li><a href="${n.href}">${esc(n.title)}</a></li>`).join('\n');
    addDoc('nav', 'nav.xhtml', '목차', `<nav epub:type="toc" id="toc"><h1>목차</h1><ol>
${navLis}
</ol></nav>`, { nav: true, skipSpine: true });
  }

  // 9) opf
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${V2 ? '2.0' : '3.0'}" unique-identifier="uid"${V2 ? '' : ' xml:lang="ko"'}>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"${V2 ? ' xmlns:opf="http://www.idpf.org/2007/opf"' : ''}>
    <dc:identifier id="uid">${esc(uid)}</dc:identifier>
    <dc:title>${esc(meta.title || book.fileTitle || '책')}</dc:title>
    ${meta.subtitle ? `<dc:description>${esc(meta.subtitle)}</dc:description>` : ''}
    <dc:creator>${esc(meta.author || '')}</dc:creator>
    ${meta.translator ? `<dc:contributor>${esc(meta.translator)}</dc:contributor>` : ''}
    ${meta.publisher ? `<dc:publisher>${esc(meta.publisher)}</dc:publisher>` : ''}
    <dc:language>ko</dc:language>
    ${V2 ? '' : `<meta property="dcterms:modified">${modified}</meta>`}
    ${coverAdded ? '<meta name="cover" content="cover-img"/>' : ''}
  </metadata>
  <manifest>
${manifest.join('\n')}
  </manifest>
  <spine${V2 ? ' toc="ncx"' : ''}>
${spine.join('\n')}
  </spine>${V2 && coverAdded ? '\n  <guide><reference type="cover" title="표지" href="cover.xhtml"/></guide>' : ''}
</package>`));

  fs.mkdirSync(path.dirname(a.outPath), { recursive: true });
  fs.writeFileSync(a.outPath, zip.toBuffer());
  const chapters = book.parts.reduce((n, p) =>
    n + p.chapters.filter((c) => !chapterExcluded(c.title, excluded)).length, 0);
  log(`📱 ePub 완료 — 장 ${chapters}개${coverAdded ? ' + 표지' : ''} · ${(fs.statSync(a.outPath).size / 1024 / 1024).toFixed(1)}MB → ${path.basename(a.outPath)}`);
  return { success: true, epubPath: a.outPath };
}

module.exports = { buildEpub, cropFrontCover };
