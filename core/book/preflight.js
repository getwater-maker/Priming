'use strict';
/**
 * preflight.js — 🔎 부크크에 올리기 전 점검(순수). 흩어져 있던 경고(누락 글자·긴 제목·표지 치수·책등·각주·글꼴 파일·필수 정보·낡은 완성 파일)를
 * 한 곳에 모은다. 상태: ok · warn(올려도 되지만 확인) · error(올리면 반려/깨질 가능성) · info.
 * 입력은 main 이 모은 사실만 — 파일·네트워크 없음(test/book-preflight.test.js).
 */
const BL = require('./book-lang');
const SC = require('./spine-calc');
const ICK = require('./interior-check');
const has = (v) => v != null && String(v).trim() !== '';
const it = (id, label, state, detail, tab) => ({ id, label, state, detail: detail || '', ...(tab ? { tab } : {}) });

/**
 * @param {{ meta, pages, spineMm, coverImagePath, coverCheck, flaps, trimId, titleFit, footnotes, glyph, missingFonts,
 *           outputs, sourceMtime, edition? }} x
 */
function preflight(x) {
  const m = x.meta || {};
  const out = [];
  // 0) 책 언어 × 플랫폼 — KDP 는 한국어 불가(영어책으로) · D2D 는 한국어 허용 미확인(해외 플랫폼 R23-0)
  {
    const lang = BL.langOf(m);
    for (const iss of BL.platformLangIssues(x.platformId, lang)) out.push(it('lang', '책 언어 × 플랫폼', iss.state, iss.text));
    if (x.platformId === 'kdp' || x.platformId === 'd2d') { if (!BL.platformLangIssues(x.platformId, lang).length) out.push(it('lang', '책 언어', 'ok', lang === 'en' ? 'English — 영어 조판(lang=en · 하이픈 · 영어 판권)' : lang)); }
  }
  // 1) 쪽수·책등 — 📌 확정(내지 PDF 의 실제 쪽수)일 때만 판정한다. 미리보기 숫자는 잠정(⏳ pending) — 쪽 나누기 도중의 숫자를 보고한 사고(31·71쪽)가 있었다.
  //   pagesSure 를 안 넘기면(옛 호출) 확정으로 본다.
  const sure = x.pagesSure !== false;
  if (!(x.pages > 0)) out.push(it('pages', '쪽수 확정', 'pending', '종이책을 만들면 실제 쪽수가 정해지고, 쪽수로 책등 두께가 정해집니다', 'layout'));
  else if (!sure) out.push(it('pages', '쪽수', 'pending', `미리보기 ${x.pages}쪽(잠정) — 종이책을 만들면 실제 쪽수로 확정됩니다`, 'layout'));
  else if (x.pages < (x.minPages || 50)) out.push(it('pages', '쪽수', 'error', `${x.pages}쪽 — ${x.platformLabel || '부크크'} 종이책은 최소 ${x.minPages || 50}쪽입니다`, 'layout'));
  else out.push(it('pages', '쪽수', 'ok', `${x.pages}쪽 → 책등 ${x.spineMm}mm`));
  // 1b) 🇺🇸 KDP·D2D 표지 — 책등 글자(79쪽 초과만) · 바코드 자리 · 공식 표지 계산기 값 대조
  if ((x.platformId === 'kdp' || x.platformId === 'd2d') && x.spread) {
    const sp = x.spread;
    if (x.pages > 0) {
      out.push(it('spine-text', '책등 글자', 'info', sp.spineTextOk ? `${sp.pagesUsed}쪽 — 책등 글자를 넣을 수 있습니다(글자와 책등 가장자리 사이 0.0625″ 이상)` : `${sp.pagesUsed}쪽 — 79쪽 이하는 책등에 글자를 넣지 않습니다(KDP 가 인쇄하지 않는 두께)`));
    }
    if (sp.barcodeKeepout) out.push(it('barcode-keepout', '바코드 자리', 'info', `뒤표지 오른쪽 아래 ${(sp.barcodeKeepout.w / 25.4).toFixed(1)}″×${(sp.barcodeKeepout.h / 25.4).toFixed(1)}″ 는 비워 두세요 — KDP 가 ISBN 바코드를 넣습니다(그 자리의 글·그림은 가려집니다)`));
    const td = SC.kdpTemplateDiff(sp, x.kdpTemplate);
    if (td.given) out.push(it('kdp-template', 'KDP 표지 계산기 대조', td.ok ? 'ok' : 'warn', td.ok ? 'KDP 공식 표지 계산기 값과 앱 계산이 같습니다(±0.01″)' : `KDP 계산기와 어긋남 — ${td.diffs.map((d) => `${d.name} 앱 ${d.appIn}″ · KDP ${d.kdpIn}″`).join(' / ')} (쪽수·용지·판형을 확인하세요)`, 'cover'));
    else out.push(it('kdp-template', 'KDP 표지 계산기 대조', 'info', 'kdp.amazon.com/cover-calculator 의 폭·높이·책등(인치)을 원고 메타 `> KDP표지폭:` `> KDP표지높이:` `> KDP책등:` 로 적으면 앱 계산과 대조합니다'));
  }
  // 1c) 🇺🇸 KDP·D2D 내지 — 쪽수·여백·글자 크기·PDF(글꼴 임베드·투명·주석·북마크)·이미지 해상도
  if (x.interior) out.push(...ICK.interiorItems(x.interior));
  // 2) 표지
  const cc = x.coverCheck;
  if (!x.coverImagePath) out.push(it('cover', '표지 이미지', 'warn', '완성 표지 이미지를 첨부하지 않았습니다(표지 탭) — 앱이 만든 간단한 표지가 나갑니다', 'cover'));
  else if (/시안/.test(String(x.coverImagePath))) out.push(it('cover', '표지 원본 파일', 'warn', '첨부한 표지 원본의 파일 이름에 「시안」이 있습니다 — 최종 표지 파일로 바꿔 첨부하세요. (업로드는 쪽수에 맞춰 앱이 만든 표지 PDF 로 하고, 쪽수가 정해지면 책등 mm 가 맞는지 다시 확인합니다)', 'cover'));
  else if (cc && !cc.flapHint && (!cc.ok || !cc.exact) && !(sure && x.pages > 0)) out.push(it('cover', '표지 치수', 'pending', `쪽수가 확정된 뒤 점검합니다 — 파일 폭 ${cc.mmW}mm${x.pages > 0 ? ` · 미리보기 ${x.pages}쪽으로 셈한 폭 ${cc.expected.widthMm}mm` : ''}`, 'cover'));
  else if (cc && !cc.ok) out.push(it('cover', '표지 치수', 'error', cc.flapHint ? `이 표지 파일은 날개 ${cc.flapHint === 'file-has-flaps' ? '포함' : '없는'} 치수입니다 — 날개 설정을 확인하세요` : `치수 불일치 — 기대 ${cc.expected.widthMm}×${cc.expected.heightMm}mm, 파일 ${cc.mmW}×${cc.mmH}mm`, 'cover'));
  else if (cc && !cc.exact && x.pages > 0) out.push(it('cover', '표지 폭', 'warn', `기대 ${cc.expected.widthMm}mm · 파일 ${cc.mmW}mm (허용 ±1mm 밖) — 쪽수 ${x.pages}쪽 기준 책등 ${x.spineMm}mm 로 표지를 다시 만드세요`, 'cover'));
  else if (cc && cc.lowDpi) out.push(it('cover', '표지 해상도', 'warn', `실효 ${cc.effectiveDpi}dpi < 300 — 반려 사유 1위`, 'cover'));
  else out.push(it('cover', '표지', 'ok', cc ? `${cc.mmW}×${cc.mmH}mm 확인` : '첨부됨'));
  // 3) 글자·글꼴
  if (x.missingFonts && x.missingFonts.length) out.push(it('fontfiles', '동봉 글꼴 파일', 'error', `설치 폴더에 없음: ${x.missingFonts.join(', ')} — 앱을 껐다 켜서 업데이트를 받으세요`));
  if (x.glyph == null) out.push(it('glyph', '글꼴에 없는 글자', 'info', '미리보기 조판을 한 번 하면 검사됩니다'));
  else if (x.glyph.missing && x.glyph.missing.length) out.push(it('glyph', '글꼴에 없는 글자', 'error', `${x.glyph.missing.length}종: ${x.glyph.missing.slice(0, 8).map((g) => g.ch).join(' ')} — 다른 글꼴로 대체돼 보입니다`));
  else out.push(it('glyph', '글꼴에 없는 글자', x.glyph.unreadable && x.glyph.unreadable.length ? 'warn' : 'ok', x.glyph.unreadable && x.glyph.unreadable.length ? `읽지 못한 글꼴: ${x.glyph.unreadable.join(', ')}` : '없음'));
  // 4) 제목 길이
  const tf = x.titleFit;
  if (tf && tf.count) {
    const bad = tf.count.header + tf.count.toc3 + tf.count.max;
    out.push(it('titlefit', '제목 길이', bad ? 'warn' : 'ok', bad ? `머리글에서 잘림 ${tf.count.header} · 목차 4줄↑ ${tf.count.toc3} · 기준 초과 ${tf.count.max} — 구조 탭의 목록 확인` : '모든 회목이 기준 안', 'structure'));
  }
  // 5) 각주
  const fx = x.footnotes;
  if (fx) {
    if (fx.dups.length || fx.undefinedRefs.length) out.push(it('footnotes', '각주', 'error', `${fx.dups.length ? `번호 중복 정의 ${fx.dups.length}개(${fx.dups.slice(0, 4).join(' ')}) ` : ''}${fx.undefinedRefs.length ? `정의 없는 참조 ${fx.undefinedRefs.length}개(${fx.undefinedRefs.slice(0, 4).join(' ')})` : ''} — 본문과 각주 설명이 어긋납니다`));
    else out.push(it('footnotes', '각주', fx.unused.length ? 'info' : 'ok', `참조 ${fx.refCount} · 정의 ${fx.defCount}${fx.unused.length ? ` · 쓰이지 않는 정의 ${fx.unused.length}개` : ' · 1:1'}`));
  }
  // 6) 필수 정보
  const miss = [];
  if (!has(m.title)) miss.push('책 제목'); if (!has(m.author)) miss.push('저자'); if (!has(m.publisher)) miss.push('출판사');
  // 발행일 = ISBN 받은 날(부크크) — ISBN 을 받기 전(신청 단계)엔 비어 있어도 오류가 아니다(ISBN 을 넣으면 오늘로 채워진다)
  const waitIsbn = !has(m.issueDate) && !has(m.isbn) && !has(m.ebookIsbn);
  if (!has(m.issueDate) && !waitIsbn) miss.push('발행일');
  out.push(it('meta', '필수 정보', miss.length ? 'error' : 'ok', miss.length ? `비어 있음: ${miss.join(', ')}` : waitIsbn ? '제목·저자·출판사 있음 — 발행일은 ISBN 을 받은 뒤 입력(ISBN 을 넣으면 오늘로 채워집니다)' : '제목·저자·출판사·발행일 있음', 'info'));
  // 7) 완성 파일이 원고보다 낡았나
  const find = (k) => (x.outputs || []).filter((o) => o.kind === k).sort((a, b) => b.mtime - a.mtime)[0];
  // 📄 전자책은 PDF(표지+본문)를 올린다(2026-10-12) — ePub 은 선택 산출물이라 만들었을 때만 본다
  for (const [kind, label] of [['interior', '내지 PDF'], ['cover', '표지 PDF'], ['ebookPdf', '전자책 PDF(표지+본문)'], ['epub', 'ePub(선택)']]) {
    const o = find(kind);
    // 📝 아직 안 만들었거나 원고보다 낡은 완성 파일 = 「남은 단계」(todo) — 문제(⚠)가 아니라 할 일이다(v0.9.87)
    if (!o) { if (kind !== 'epub') out.push(it('out-' + kind, label, 'todo', '아직 만들지 않았습니다')); continue; }
    const stale = x.sourceMtime && o.mtime + 1000 < x.sourceMtime;
    out.push(it('out-' + kind, label, stale ? 'todo' : 'ok', stale ? `원고가 ${o.name} 보다 새롭습니다 — 다시 만드세요` : `${o.name} (${(o.bytes / 1048576).toFixed(1)}MB)`));
  }
  const ebp = find('ebookPdf');
  if (ebp && ebp.bytes > 20 * 1048576) out.push(it('ebookpdf-size', '전자책 PDF 용량', 'error', `${(ebp.bytes / 1048576).toFixed(1)}MB — 부크크 20MB 한도 초과`));
  const ep = find('epub');
  if (ep && ep.bytes > 20 * 1048576) out.push(it('epub-size', 'ePub 용량', 'error', `${(ep.bytes / 1048576).toFixed(1)}MB — 부크크 20MB 한도 초과`));
  const cnt = (s) => out.filter((i) => i.state === s).length;
  const summary = { error: cnt('error'), warn: cnt('warn'), pending: cnt('pending'), todo: cnt('todo') };
  return { items: out, summary, ready: summary.error === 0 };
}
module.exports = { preflight };
