'use strict';
/**
 * ebook-preview.js — 📱 전자책(ePub) 미리보기 + 사전 점검 (R22 · 2026-10-06 로이)
 *   · 부크크에 올라가는 **실제 ePub** 을 열어 spine 순서 그대로 문서를 보여 준다(전자책 PDF 가 아니다 — 리플로우라 쪽번호 대신 「문서 n / N」).
 *   · 부크크 「판권지 수정 요청」 항목을 앱 안에서 점검한다: 1쪽 = 표지 이미지(출처) · 판권이 2쪽 또는 마지막 쪽인지 ·
 *     판권에 ISBN·발행일·부크크 필수 항목 · 각주 연결 수 · EPUB 버전. (이번 결함 — 판권에 ISBN·발행일이 빠짐 — 은 제출한 뒤에야 보였다.)
 *   ⚠ 이 파일은 메인 프로세스 전용(AdmZip) — 렌더러 번들에 넣지 말 것.
 */
const path = require('path');

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
const plain = (h) => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const unesc = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** 부크크 판권지가 싣는 필수 항목 — 판권 글자에서 「라벨 | 값」 행을 찾는다 */
const REQUIRED_ROWS = [
  ['발행인', /발행인\s*\|\s*\S/], ['발행처', /발행처\s*\|\s*\S/], ['출판등록', /등록\s*\|\s*\S/],
  ['주소', /주소\s*\|\s*\S/], ['전화', /전화\s*\|\s*\S/], ['이메일', /(대표메일|이메일)\s*\|\s*\S/], ['ISBN', /ISBN\s*\|?\s*[\d-]{10,}/],
];

/** 판권 문서 글자 → 점검 항목들 (순수 함수 — 단위 시험용) */
function checkColophon(colText, opts = {}) {
  const t = String(colText || '');
  const out = [];
  const digits = (s) => String(s || '').replace(/[^0-9Xx]/g, '');
  const isbn = digits(opts.ebookIsbn || opts.isbn);
  if (/ISBN/.test(t) && /ISBN\s*\|?\s*[\d-]{10,}/.test(t)) {
    const shown = digits((t.match(/ISBN\s*\|?\s*([\d-]{10,})/) || [])[1]);
    out.push(isbn && shown && shown !== isbn
      ? { id: 'isbn', level: 'warn', text: `판권의 ISBN(${(t.match(/ISBN\s*\|?\s*([\d-]{10,})/) || [])[1]})이 원고의 전자책 ISBN 과 다릅니다` }
      : { id: 'isbn', level: 'ok', text: `판권에 ISBN 있음 — ${(t.match(/ISBN\s*\|?\s*([\d-]{10,})/) || [])[1]}` });
  } else out.push({ id: 'isbn', level: 'err', text: '판권에 ISBN 없음 — 부크크는 판권지에 전자책 ISBN 을 요구합니다(원고 `> 전자책ISBN:`)' });
  if (/발행일?\s+(19|20)\d{2}|(19|20)\d{2}[-.년]\s*\d{1,2}/.test(t)) out.push({ id: 'date', level: 'ok', text: '판권에 발행일 있음 — ' + ((t.match(/((?:19|20)\d{2}[-.년]\s*\d{1,2}[-.월]?\s*\d{0,2}[일]?)/) || [])[1] || '').trim() });
  else out.push({ id: 'date', level: 'err', text: '판권에 발행일 없음(원고 `> 발행일:` / `> 전자책발행일:`)' });
  const miss = REQUIRED_ROWS.filter(([, re]) => !re.test(t)).map(([k]) => k);
  out.push(miss.length ? { id: 'req', level: 'err', text: `판권 필수 항목 ${REQUIRED_ROWS.length - miss.length}/${REQUIRED_ROWS.length} — 빠짐: ${miss.join('·')}` }
    : { id: 'req', level: 'ok', text: `판권 필수 항목 ${REQUIRED_ROWS.length}/${REQUIRED_ROWS.length} (발행인·발행처·출판등록·주소·전화·이메일·ISBN)` });
  out.push(/ⓒ|©/.test(t) ? { id: 'copyright', level: 'ok', text: '판권에 ⓒ·재사용 문구 있음' } : { id: 'copyright', level: 'warn', text: '판권에 ⓒ(저작권) 문구 없음' });
  return out;
}

/**
 * ePub 파일을 열어 spine 문서 목록 + 사전 점검을 만든다.
 * @param {string} epubPath
 * @param {{meta?:object, logs?:string[], footnoteCount?:number}} o
 * @returns {{ version:string, docs:{n:number,id:string,href:string,title:string}[], checks:{id:string,level:'ok'|'warn'|'err',text:string}[], coverLabel:string }}
 */
function inspectEpub(epubPath, o = {}) {
  const AdmZip = require('adm-zip');
  const z = new AdmZip(epubPath);
  const txt = (n) => { const e = z.getEntry(n); return e ? e.getData().toString('utf8') : ''; };
  const opf = txt('OEBPS/content.opf');
  const version = (opf.match(/<package[^>]*\sversion="([^"]+)"/) || [])[1] || '?';
  const manifest = {};
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = (m[0].match(/\bid="([^"]+)"/) || [])[1]; const href = (m[0].match(/\bhref="([^"]+)"/) || [])[1];
    if (id && href) manifest[id] = href;
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map((m) => m[1]);
  const docs = spine.map((id, i) => {
    const href = manifest[id] || '';
    const x = txt('OEBPS/' + href);
    const t = (x.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const h1 = (x.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
    return { n: i + 1, id, href, title: unesc(plain(h1 || t || id)).slice(0, 60) };
  });
  const N = docs.length;
  const checks = [];

  // 1) 1쪽 = 표지 이미지
  const cover = docs[0];
  const coverLog = (o.logs || []).slice().reverse().find((l) => /🖼 전자책 표지:|인쇄 표지에서 앞표지 자동 크롭/.test(l)) || '';
  const coverLabel = (coverLog.match(/전자책 표지:\s*(.+)$/) || [])[1] || (/크롭/.test(coverLog) ? '인쇄 표지에서 앞표지 크롭' : '');
  if (cover && cover.id === 'cover' && /<img\b/.test(txt('OEBPS/' + cover.href))) {
    checks.push({ id: 'cover', level: 'ok', text: `1쪽 = 표지 이미지${coverLabel ? ' — ' + coverLabel : ''}` });
  } else checks.push({ id: 'cover', level: 'err', text: '1쪽이 표지 이미지가 아닙니다 — 부크크는 「앞표지 = 1쪽」을 요구합니다(원고 `> 전자책표지:` 또는 인쇄 표지 첨부)' });

  // 2) 판권 위치 — 2쪽 또는 마지막 쪽
  const ci = docs.findIndex((d) => d.id === 'colophon');
  if (ci < 0) checks.push({ id: 'colpos', level: 'err', text: '판권 문서가 없습니다' });
  else if (ci === 1 || ci === N - 1) checks.push({ id: 'colpos', level: 'ok', text: `판권 위치 = ${ci === 1 ? '2쪽(표지 다음)' : '마지막 쪽'} (문서 ${ci + 1} / ${N})` });
  else checks.push({ id: 'colpos', level: 'warn', text: `판권이 문서 ${ci + 1} / ${N} 에 있습니다 — 부크크는 2쪽 또는 마지막 쪽만 받습니다(원고 \`> 판권위치: 앞\`)` });

  // 3) 판권 내용
  if (ci >= 0) {
    const m = o.meta || {};
    checks.push(...checkColophon(plain(txt('OEBPS/' + docs[ci].href)), { ebookIsbn: m.ebookIsbn, isbn: m.isbn }));
  }

  // 4) 각주 — 본문 번호(noteref)와 장 끝 각주 수가 맞는지
  let refs = 0, notes = 0;
  for (const d of docs) { const x = txt('OEBPS/' + d.href); refs += (x.match(/href="#fn-\d+"/g) || []).length; notes += (x.match(/\bid="fn-\d+"/g) || []).length; }
  const want = o.footnoteCount;
  checks.push(refs === notes
    ? { id: 'fn', level: 'ok', text: `각주 ${refs}개 연결${want != null && want !== refs ? ` (원고 정의 ${want}개 — 본문에서 쓰이지 않은 정의는 싣지 않음)` : ''}` }
    : { id: 'fn', level: 'warn', text: `각주 번호 ${refs}개 · 각주 본문 ${notes}개 — 짝이 맞지 않습니다` });

  // 5) EPUB 버전
  checks.push(version === '2.0' ? { id: 'ver', level: 'ok', text: 'EPUB 2.0 (부크크 전자책 규격)' } : { id: 'ver', level: 'warn', text: `EPUB ${version} — 부크크 전자책은 2.0 을 권장합니다` });
  return { version, docs, checks, coverLabel };
}

/** 문서 하나를 미리보기용 완결 HTML 로 — style.css 를 박고 이미지는 data URL 로(iframe srcdoc 에서 그대로 보이게) */
function readDoc(epubPath, href) {
  const AdmZip = require('adm-zip');
  const z = new AdmZip(epubPath);
  const txt = (n) => { const e = z.getEntry(n); return e ? e.getData().toString('utf8') : ''; };
  let x = txt('OEBPS/' + href);
  if (!x) return { error: '문서를 찾을 수 없습니다: ' + href };
  const css = txt('OEBPS/style.css').replace(/url\(fonts\/[^)]*\)/g, 'url()');   // 글꼴은 미리보기에 싣지 않는다(시스템 글꼴로 대체)
  x = x.replace(/<link\b[^>]*stylesheet[^>]*>/gi, `<style>${css}\nbody{max-width:34em;margin:0 auto;padding:1.2em;background:#fff;color:#000}</style>`);
  x = x.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi, (all, a, src, b) => {
    const e = z.getEntry('OEBPS/' + path.posix.normalize(src));
    if (!e) return all;
    const ext = path.extname(src).slice(1).toLowerCase();
    return a + `data:${MIME[ext] || 'application/octet-stream'};base64,` + e.getData().toString('base64') + b;
  });
  return { html: x };
}

module.exports = { inspectEpub, readDoc, checkColophon, REQUIRED_ROWS };
