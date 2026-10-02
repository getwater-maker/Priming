'use strict';
/**
 * preflight.js — 🔎 부크크에 올리기 전 점검(순수). 흩어져 있던 경고(누락 글자·긴 제목·표지 치수·책등·각주·글꼴 파일·필수 정보·낡은 완성 파일)를
 * 한 곳에 모은다. 상태: ok · warn(올려도 되지만 확인) · error(올리면 반려/깨질 가능성) · info.
 * 입력은 main 이 모은 사실만 — 파일·네트워크 없음(test/book-preflight.test.js).
 */
const has = (v) => v != null && String(v).trim() !== '';
const it = (id, label, state, detail, tab) => ({ id, label, state, detail: detail || '', ...(tab ? { tab } : {}) });

/**
 * @param {{ meta, pages, spineMm, coverImagePath, coverCheck, flaps, trimId, titleFit, footnotes, glyph, missingFonts,
 *           outputs, sourceMtime, edition? }} x
 */
function preflight(x) {
  const m = x.meta || {};
  const out = [];
  // 1) 쪽수·책등
  if (!(x.pages > 0)) out.push(it('pages', '쪽수 확정', 'warn', '미리보기 조판이 끝나면 쪽수가 정해지고, 쪽수로 책등 두께가 정해집니다 — 표지는 쪽수가 확정된 뒤에 만드세요', 'layout'));
  else if (x.pages < 50) out.push(it('pages', '쪽수', 'error', `${x.pages}쪽 — 부크크 종이책은 최소 50쪽입니다`, 'layout'));
  else out.push(it('pages', '쪽수', 'ok', `${x.pages}쪽 → 책등 ${x.spineMm}mm`));
  // 2) 표지
  const cc = x.coverCheck;
  if (!x.coverImagePath) out.push(it('cover', '표지 이미지', 'warn', '완성 표지 이미지를 첨부하지 않았습니다(표지 탭) — 앱이 만든 간단한 표지가 나갑니다', 'cover'));
  else if (/시안/.test(String(x.coverImagePath))) out.push(it('cover', '표지 원본 파일', 'warn', '첨부한 표지 원본의 파일 이름에 「시안」이 있습니다 — 최종 표지 파일로 바꿔 첨부하세요. (업로드는 쪽수에 맞춰 앱이 만든 표지 PDF 로 하고, 쪽수가 정해지면 책등 mm 가 맞는지 다시 확인합니다)', 'cover'));
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
  if (!has(m.issueDate)) miss.push('발행일');
  out.push(it('meta', '필수 정보', miss.length ? 'error' : 'ok', miss.length ? `비어 있음: ${miss.join(', ')}` : '제목·저자·출판사·발행일 있음', 'info'));
  // 7) 완성 파일이 원고보다 낡았나
  const find = (k) => (x.outputs || []).filter((o) => o.kind === k).sort((a, b) => b.mtime - a.mtime)[0];
  for (const [kind, label] of [['interior', '내지 PDF'], ['cover', '표지 PDF'], ['epub', 'ePub']]) {
    const o = find(kind);
    if (!o) { out.push(it('out-' + kind, label, 'info', '아직 만들지 않았습니다')); continue; }
    const stale = x.sourceMtime && o.mtime + 1000 < x.sourceMtime;
    out.push(it('out-' + kind, label, stale ? 'warn' : 'ok', stale ? `원고가 ${o.name} 보다 새롭습니다 — 다시 만드세요` : `${o.name} (${(o.bytes / 1048576).toFixed(1)}MB)`));
  }
  const ep = find('epub');
  if (ep && ep.bytes > 20 * 1048576) out.push(it('epub-size', 'ePub 용량', 'error', `${(ep.bytes / 1048576).toFixed(1)}MB — 부크크 20MB 한도 초과`));
  const summary = { error: out.filter((i) => i.state === 'error').length, warn: out.filter((i) => i.state === 'warn').length };
  return { items: out, summary, ready: summary.error === 0 };
}
module.exports = { preflight };
