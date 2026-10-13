'use strict';
/**
 * ebook-overseas.js — 📱 해외 플랫폼(KDP·D2D) 전자책(ePub) 사전 점검 — 2026-10-13 v0.9.3 (해외 플랫폼 R26)
 *   값 출처(2026-10-13 확인):
 *   · KDP 전자책 표지 G6GTK3T3NUHKLEFX ✅ — 권장 2,560×1,600px(높이 2,500 이상 권장) · 가장 짧은 변 500px 미만은 웹사이트에 표시되지 않는다 · JPEG 5MB 이하 · 300dpi 이상 · RGB(CMYK 불가) · 제목·저자가 보이는지 출판 전 확인(권장)
 *   · KDP EPUB G200634390 ✅ — EPUB 지원 · Kindle Previewer 로 검증 권장 · 파일 크기·언어 메타·목차 요건은 그 문서에 없다 ❓
 *   · D2D 전자책(요청서 가이드 ✅/⚠️) — EPUB 은 EPUBCheck 로 검증 · 90MB 초과는 거부될 수 있다 · 표지 JPEG 1600×2400 권장(키 큰 직사각형) · 표지에 책 제목 포함
 *   순수 함수 — 파일·네트워크 없음.
 */

const KDP_COVER = { idealW: 1600, idealH: 2560, minShort: 500, maxBytes: 5 * 1024 * 1024 };
const D2D_COVER = { idealW: 1600, idealH: 2400 };
const D2D_MAX_BYTES = 90 * 1024 * 1024;

/** 이미지 바이트 → {w,h,ext} (PNG · JPEG · GIF · WebP) — 라이브러리 없이 헤더만 읽는다 */
function imgSizeFromBuffer(b) {
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), ext: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1];
      if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if ((mk >= 0xc0 && mk <= 0xcf) && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), ext: 'jpg' };
      i += 2 + len;
    }
    return null;
  }
  if (b.slice(0, 3).toString('latin1') === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8), ext: 'gif' };
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') {
    const t = b.slice(12, 16).toString('latin1');
    if (t === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), ext: 'webp' };
    if (t === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, ext: 'webp' };
    if (t === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, ext: 'webp' }; }
  }
  return null;
}

const ck = (id, level, text, extra) => ({ id, level, text, ...(extra || {}) });

/**
 * @param {{platformId:'kdp'|'d2d', lang:string, dcLanguage?:string, version?:string, bytes?:number, cover?:{w:number,h:number,bytes?:number,ext?:string}|null,
 *          hasNav?:boolean, hasNcx?:boolean, epubcheck?:{missing?:boolean,error?:string,ok?:boolean,nFatal?:number,nError?:number,nWarning?:number,version?:string}|null,
 *          colophonText?:string}} f
 * @returns [{id, level:'ok'|'warn'|'err', text, confirm?:true}]
 */
function overseasEbookChecks(f) {
  const out = []; const p = f.platformId; const label = p === 'kdp' ? 'KDP' : 'D2D';
  // 언어 메타
  if (f.dcLanguage) out.push(f.dcLanguage.toLowerCase() === String(f.lang || 'ko').toLowerCase() ? ck('lang', 'ok', `언어 메타 dc:language = ${f.dcLanguage}`) : ck('lang', 'err', `dc:language ${f.dcLanguage} ≠ 원고 언어 ${f.lang} — 원고 메타 \`> 언어:\` 를 확인하세요`));
  else out.push(ck('lang', 'err', 'ePub 에 dc:language 가 없습니다'));
  if (p === 'kdp' && f.lang !== 'en') out.push(ck('lang-platform', 'err', 'KDP 는 한국어 책을 받지 않습니다 — 영어책으로 만드세요(원고 메타 `> 언어: en`)'));
  // 목차
  const tocOk = f.hasNav || f.hasNcx;
  out.push(tocOk ? ck('toc', 'ok', `목차 ${f.hasNav ? 'nav(EPUB 3)' : 'NCX(EPUB 2)'} 있음`) : ck('toc', 'err', '목차(nav/NCX)가 없습니다'));
  // 버전
  out.push(ck('ver', 'ok', `EPUB ${f.version || '?'} — ${label} 는 EPUB 을 받습니다${p === 'kdp' ? '(Kindle Previewer 로 검증 권장 — 공식)' : ''}`));
  // 크기
  if (f.bytes != null) {
    const mb = f.bytes / 1048576;
    out.push(p === 'd2d' && f.bytes > D2D_MAX_BYTES ? ck('size', 'warn', `${mb.toFixed(1)}MB — D2D 는 90MB 초과 EPUB 을 거부할 수 있습니다`) : ck('size', 'ok', `${mb.toFixed(1)}MB${p === 'd2d' ? ' (≤90MB)' : ''}`));
  }
  // 표지
  const c = f.cover;
  if (!c) out.push(ck('cover-size', 'err', '표지 이미지를 읽지 못했습니다'));
  else if (p === 'kdp') {
    const short = Math.min(c.w, c.h), long = Math.max(c.w, c.h);
    if (short < KDP_COVER.minShort) out.push(ck('cover-size', 'err', `표지 ${c.w}×${c.h}px — 짧은 변이 500px 미만이면 KDP 웹사이트에 표지가 표시되지 않습니다`));
    else if (long < KDP_COVER.idealH) out.push(ck('cover-size', 'warn', `표지 ${c.w}×${c.h}px — KDP 권장은 ${KDP_COVER.idealW}×${KDP_COVER.idealH}px(작아도 올릴 수 있지만 안내가 뜹니다)`));
    else out.push(ck('cover-size', 'ok', `표지 ${c.w}×${c.h}px (권장 ${KDP_COVER.idealW}×${KDP_COVER.idealH} 이상)`));
    if (c.bytes != null) out.push(c.bytes > KDP_COVER.maxBytes ? ck('cover-bytes', 'err', `표지 파일 ${(c.bytes / 1048576).toFixed(1)}MB — KDP 는 5MB 이하`) : ck('cover-bytes', 'ok', `표지 파일 ${(c.bytes / 1048576).toFixed(2)}MB (≤5MB)`));
    if (c.ext && !/^jpe?g$/i.test(c.ext)) out.push(ck('cover-fmt', 'warn', `표지 형식 ${c.ext} — KDP 는 JPEG 를 선호합니다(RGB · 300dpi)`));
  } else {
    if (c.h <= c.w) out.push(ck('cover-size', 'err', `표지 ${c.w}×${c.h}px — D2D 표지는 「키 큰 직사각형」(세로가 가로보다 길게)이어야 합니다`));
    else if (c.w < D2D_COVER.idealW || c.h < D2D_COVER.idealH) out.push(ck('cover-size', 'warn', `표지 ${c.w}×${c.h}px — D2D 권장은 ${D2D_COVER.idealW}×${D2D_COVER.idealH}px 이상`));
    else out.push(ck('cover-size', 'ok', `표지 ${c.w}×${c.h}px (권장 ${D2D_COVER.idealW}×${D2D_COVER.idealH} 이상)`));
    if (c.ext && !/^jpe?g$/i.test(c.ext)) out.push(ck('cover-fmt', 'warn', `표지 형식 ${c.ext} — D2D 는 JPEG 표지를 받습니다`));
  }
  // 표지에 제목 — 이미지라 자동 판정 불가 → 사람이 눈으로 확인(체크)
  out.push(ck('cover-title', 'warn', p === 'd2d' ? '표지 이미지에 책 제목이 들어 있는지 눈으로 확인하세요(D2D 요구 · 자동 판정 불가)' : '표지에 제목과 저자가 보이는지 눈으로 확인하세요(KDP 권장 · 자동 판정 불가)', { confirm: true }));
  // EPUBCheck / 판권
  const e = f.epubcheck;
  if (p === 'd2d') {
    if (!e || e.missing) out.push(ck('epubcheck', 'warn', 'EPUBCheck 도구가 이 PC 에 없어 검증하지 못했습니다 — D2D 는 EPUBCheck 통과를 요구합니다(~/.priming-maker/tools)'));
    else if (e.error) out.push(ck('epubcheck', 'warn', `EPUBCheck 실행 실패 — ${e.error}`));
    else out.push(e.ok ? ck('epubcheck', 'ok', `EPUBCheck 통과 — 오류 0 · 경고 ${e.nWarning || 0} (${e.version || ''})`) : ck('epubcheck', 'err', `EPUBCheck 오류 ${(e.nFatal || 0) + (e.nError || 0)}개 — D2D 는 통과해야 합니다(「ePub 검증」 로그 확인)`));
  } else if (e && !e.missing && !e.error) {
    out.push(e.ok ? ck('epubcheck', 'ok', `EPUBCheck 통과(참고) — 경고 ${e.nWarning || 0}`) : ck('epubcheck', 'warn', `EPUBCheck 오류 ${(e.nFatal || 0) + (e.nError || 0)}개 — KDP 는 Kindle Previewer 로도 확인하세요`));
  }
  if (f.colophonText != null) {
    const t = String(f.colophonText);
    out.push(/©|ⓒ|copyright/i.test(t) ? ck('copyright', 'ok', '판권에 저작권(©) 문구 있음') : ck('copyright', 'warn', '판권에 저작권(©) 문구가 없습니다'));
  }
  return out;
}
module.exports = { overseasEbookChecks, imgSizeFromBuffer, KDP_COVER, D2D_COVER, D2D_MAX_BYTES };
