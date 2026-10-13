'use strict';
/**
 * interior-check.js — 📄 해외 플랫폼(KDP·D2D) 내지 PDF 점검 — 2026-10-13 v0.9.2 (해외 플랫폼 R24)
 *   · KDP 안쪽(제본쪽) 여백 구간표 ✅(공식 G201857950): 24~150쪽 0.375″ · 151~300 0.5″ · 301~500 0.625″ · 501~700 0.75″ · 701~828 0.875″ · 바깥 ≥ 0.25″(블리드 있으면 0.375″)
 *   · KDP 쪽수 24 이상 · 홀수는 짝수로 올림 · 최대 828(백색)/776(미색 · 5×8″ 기준 — 판형별 표는 KDP 확인 ⚠️) · 650MB 이하 · 글자 7pt 이상 · 이미지 300dpi 이상
 *   · D2D Print: 쪽수 32~1,050 ✅(FAQ · 옛 블로그는 64~740 ⚠️) · 판형 6종 ✅ · 그레이스케일 내지 ✅ · 여백·글꼴 규정은 문서에 없다 ❓(KDP 값을 보수적 기준으로)
 *   · PDF 검사(`scanPdf`) — 글꼴 임베드 · 투명도 · 주석(링크) · 북마크 · 암호화 — PDF 라이브러리 없이 오브젝트·스트림을 풀어 읽는다
 *   순수 함수 — fs 없음(PDF 바이트·사실은 main 이 모아 넘긴다). ⚠️ 값은 이 한 곳.
 */
const zlib = require('zlib');
const IN = 25.4;

/** KDP 안쪽(제본쪽) 여백(인치) — 쪽수 구간표 ✅ */
function kdpInsideIn(pages) {
  const n = Number(pages) || 0;
  if (n <= 150) return 0.375;
  if (n <= 300) return 0.5;
  if (n <= 500) return 0.625;
  if (n <= 700) return 0.75;
  return 0.875;
}
const KDP_OUTSIDE_IN = 0.25, KDP_OUTSIDE_BLEED_IN = 0.375, KDP_MAX_PAGES = { white: 828, cream: 776 }, KDP_MAX_BYTES = 650 * 1024 * 1024;
const D2D_PAGES = { min: 32, max: 1050 };

/** 조판 기본 여백(mm) — KDP·D2D: 위·아래 0.75″ · 바깥 0.5″ · 안쪽 = 구간표(쪽수 힌트가 없으면 가장 넓은 쪽 아닌 0.5″) */
function overseasMarginsMm(pagesHint) {
  const inside = pagesHint > 0 ? kdpInsideIn(pagesHint) : 0.5;
  return { top: 0.75 * IN, bottom: 0.75 * IN, inner: inside * IN, outer: 0.5 * IN };
}

/** PDF 바이트 → 글꼴·투명·주석·북마크·암호화 사실 */
function scanPdf(buf) {
  const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '');
  let text = raw.toString('latin1');
  // 압축된 오브젝트 스트림(글꼴 디스크립터·ExtGState 가 들어 있다) — 이미지 스트림·너무 큰 스트림은 건너뛴다
  let i = 0, n = 0;
  while ((i = raw.indexOf('stream', i)) >= 0 && n < 20000) {
    const dictStart = Math.max(0, i - 500); const before = raw.subarray(dictStart, i).toString('latin1');
    const isEnd = /end$/.test(before.slice(-3)); if (isEnd) { i += 6; continue; }   // 「endstream」 의 stream
    let st = i + 6; if (raw[st] === 13) st++; if (raw[st] === 10) st++;
    const en = raw.indexOf('endstream', st); if (en < 0) break;
    if (!/\/Subtype\s*\/Image/.test(before) && en - st < 8 * 1024 * 1024 && /FlateDecode/.test(before)) { try { text += '\n' + zlib.inflateSync(raw.subarray(st, en)).toString('latin1'); } catch (_) {} }
    i = en + 9; n++;
  }
  // 글꼴 디스크립터 — FontFile/FontFile2/FontFile3 이 있으면 임베드
  const descs = []; const re = /<<[^<>]*\/Type\s*\/FontDescriptor[^<>]*(?:<<[^<>]*>>[^<>]*)*>>/g; let m;
  while ((m = re.exec(text))) descs.push(m[0]);
  const named = descs.map((d) => ({ name: ((d.match(/\/FontName\s*\/([^\s/>\]]+)/) || [])[1] || '?').replace(/^[A-Z]{6}\+/, ''), embedded: /\/FontFile[23]?\b/.test(d) }));
  const type3 = (text.match(/\/Subtype\s*\/Type3/g) || []).length;
  const notEmbedded = [...new Set(named.filter((x) => !x.embedded).map((x) => x.name))];
  const smask = /\/SMask\s+\d+\s+\d+\s+R/.test(text);
  const lessThanOne = (text.match(/\/(?:ca|CA)\s+(0?\.\d+|0)(?![\d.])/g) || []).length;
  return {
    fonts: { total: named.length + type3, descriptors: named.length, type3, notEmbedded, names: [...new Set(named.map((x) => x.name))].slice(0, 12) },
    transparency: smask || lessThanOne > 0, smask, alphaStates: lessThanOne,
    links: (text.match(/\/Subtype\s*\/Link/g) || []).length,
    uriLinks: (text.match(/\/URI\s*[(<]/g) || []).length,   // 바깥 주소 링크(내부 이동 링크 = 목차 쪽번호 따위와 구분)
    annots: (text.match(/\/Annots\b/g) || []).length,
    outlines: /\/Outlines\s+\d+\s+\d+\s+R/.test(text),
    encrypted: /\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(text),
    bytes: raw.length,
  };
}

const it = (id, label, state, detail, tab) => ({ id, label, state, detail: detail || '', ...(tab ? { tab } : {}) });
const inch = (mm) => Math.round(mm / IN * 1000) / 1000;

/**
 * 점검 항목 만들기.
 * @param {{platformId, pages, paper?, marginsMm?, trim?, fontSizePt?, hasBleed?, pdf?:object, images?:[{src,pxW,pxH,missing?,color?}], textWidthMm?}} f
 * @returns [{id,label,state,detail,tab?}]
 */
function interiorItems(f) {
  const out = []; const p = f.platformId;
  if (p !== 'kdp' && p !== 'd2d') return out;
  const pages = Number(f.pages) || 0;
  const cream = /미색|cream/i.test(String(f.paper || ''));
  // 쪽수
  if (pages > 0) {
    if (p === 'kdp') {
      const even = pages % 2 ? pages + 1 : pages; const max = cream ? KDP_MAX_PAGES.cream : KDP_MAX_PAGES.white;
      if (pages < 24) out.push(it('kdp-pages', '쪽수(KDP)', 'error', `${pages}쪽 — KDP 종이책은 최소 24쪽입니다`, 'layout'));
      else if (even > max) out.push(it('kdp-pages', '쪽수(KDP)', 'error', `${even}쪽 — 흑백 ${cream ? '미색' : '백색'}지 최대 ${max}쪽(5×8″ 기준 ⚠️ 판형별 최대는 KDP 표 확인)`, 'layout'));
      else out.push(it('kdp-pages', '쪽수(KDP)', pages % 2 ? 'info' : 'ok', pages % 2 ? `${pages}쪽 → KDP 가 ${even}쪽으로 올립니다(홀수는 짝수로)` : `${pages}쪽(24~${max})`));
    } else {
      if (pages < D2D_PAGES.min || pages > D2D_PAGES.max) out.push(it('d2d-pages', '쪽수(D2D)', 'error', `${pages}쪽 — D2D Print 는 ${D2D_PAGES.min}~${D2D_PAGES.max}쪽(FAQ ✅ · 옛 블로그는 64~740 ⚠️ — 등록 화면에서 확인)`, 'layout'));
      else out.push(it('d2d-pages', '쪽수(D2D)', 'ok', `${pages}쪽(${D2D_PAGES.min}~${D2D_PAGES.max})`));
    }
  }
  // 여백
  const m = f.marginsMm;
  if (m && pages > 0) {
    const needIn = kdpInsideIn(pages % 2 ? pages + 1 : pages), needOut = f.hasBleed ? KDP_OUTSIDE_BLEED_IN : KDP_OUTSIDE_IN;
    const inner = inch(m.inner), outer = inch(m.outer);
    const label = p === 'kdp' ? '안쪽 여백(KDP)' : '안쪽 여백(D2D)';
    const basis = p === 'kdp' ? '' : ' — D2D 는 여백 규정을 공개하지 않아 KDP 표를 보수적 기준으로 씁니다 ❓';
    if (inner + 0.0005 < needIn) out.push(it('inside-margin', label, p === 'kdp' ? 'error' : 'warn', `${inner}″ — ${pages}쪽은 최소 ${needIn}″ 가 필요합니다${basis} (조판 설정의 안쪽 여백을 키우거나 다시 조판하세요 — 쪽수가 바뀌면 구간이 달라집니다)`, 'layout'));
    else out.push(it('inside-margin', label, 'ok', `${inner}″ ≥ ${needIn}″ (${pages}쪽 구간)${basis}`));
    if (outer + 0.0005 < needOut) out.push(it('outside-margin', '바깥 여백', p === 'kdp' ? 'error' : 'warn', `${outer}″ — 최소 ${needOut}″${f.hasBleed ? '(블리드 있음)' : ''}`, 'layout'));
    else out.push(it('outside-margin', '바깥 여백', 'ok', `${outer}″ ≥ ${needOut}″`));
    const tb = Math.min(inch(m.top), inch(m.bottom));
    if (tb < 0.25) out.push(it('tb-margin', '위·아래 여백', 'warn', `${tb}″ — 0.25″ 이상을 권합니다(KDP 는 위·아래 값을 따로 공개하지 않습니다 ⚠️)`, 'layout'));
  }
  // 글자 크기
  if (f.fontSizePt) {
    const fn = f.fontSizePt - 2;
    if (f.fontSizePt < 7) out.push(it('font-size', '글자 크기', 'error', `본문 ${f.fontSizePt}pt — KDP 는 7pt 이상`, 'layout'));
    else if (fn < 7) out.push(it('font-size', '글자 크기', 'warn', `각주 ${fn}pt — 7pt 미만(본문 ${f.fontSizePt}pt − 2pt)`, 'layout'));
    else out.push(it('font-size', '글자 크기', 'ok', `본문 ${f.fontSizePt}pt · 각주 ${fn}pt (≥7pt)`));
  }
  // PDF
  const s = f.pdf;
  if (!s) out.push(it('pdf-scan', '내지 PDF 검사', 'info', '내지 PDF 를 만든 뒤에 글꼴 임베드·투명도·링크·북마크를 검사합니다'));
  else {
    if (s.encrypted) out.push(it('pdf-encrypted', 'PDF 암호화', 'error', '암호화된 PDF — KDP 는 보안이 걸린 PDF 를 받지 않습니다'));
    if (s.fonts.notEmbedded.length) out.push(it('pdf-fonts', '글꼴 임베드', 'error', `임베드되지 않은 글꼴: ${s.fonts.notEmbedded.slice(0, 6).join(', ')} — KDP·D2D 는 모든 글꼴 임베드가 필요합니다`));
    else if (s.fonts.total) out.push(it('pdf-fonts', '글꼴 임베드', 'ok', `글꼴 ${s.fonts.total}종 모두 임베드(${s.fonts.names.slice(0, 4).join(', ')}${s.fonts.type3 ? ` · Type3 ${s.fonts.type3}` : ''})`));
    else out.push(it('pdf-fonts', '글꼴 임베드', 'info', 'PDF 에서 글꼴 정보를 읽지 못했습니다(압축 방식) — 업로드 전에 KDP 미리보기로 확인'));
    out.push(s.transparency ? it('pdf-transparency', '투명도·레이어', 'warn', `투명 효과가 있습니다(${s.smask ? '이미지 마스크 ' : ''}${s.alphaStates ? `투명도 ${s.alphaStates}곳` : ''}) — KDP 는 평탄화된 PDF 를 요구합니다`) : it('pdf-transparency', '투명도·레이어', 'ok', '투명 효과 없음'));
    if (s.uriLinks || s.outlines) out.push(it('pdf-annots', '주석·북마크', 'warn', `${s.uriLinks ? `바깥 주소 링크 ${s.uriLinks}개 ` : ''}${s.outlines ? '북마크 있음 ' : ''}— KDP 는 주석·북마크를 금지합니다(종이책 내지에서는 빼세요)`));
    else if (s.links) out.push(it('pdf-annots', '주석·북마크', 'info', `내부 이동 링크 ${s.links}개(목차 쪽번호 등) — 보통 통과하지만 KDP 문서는 주석을 금지로 적습니다. 업로드 뒤 KDP 미리보기에서 확인하세요`));
    else out.push(it('pdf-annots', '주석·북마크', 'ok', '없음'));
    const mb = s.bytes / 1048576;
    out.push(s.bytes > KDP_MAX_BYTES ? it('pdf-size', '파일 크기', 'error', `${mb.toFixed(0)}MB — 650MB 초과`) : it('pdf-size', '파일 크기', 'ok', `${mb.toFixed(1)}MB (≤650MB)`));
  }
  // 이미지
  const imgs = f.images || [];
  if (imgs.length) {
    const tw = (Number(f.textWidthMm) || 0) / IN;
    const missing = imgs.filter((x) => x.missing), low = imgs.filter((x) => !x.missing && tw > 0 && x.pxW / tw < 300);
    if (missing.length) out.push(it('img-missing', '이미지 파일', 'error', `찾을 수 없음 ${missing.length}개: ${missing.slice(0, 3).map((x) => x.src).join(', ')}`));
    if (low.length) out.push(it('img-dpi', '이미지 해상도', 'warn', `${low.length}개가 본문 폭 기준 300dpi 미만: ${low.slice(0, 3).map((x) => `${x.src}(${x.pxW}px → ${Math.round(x.pxW / tw)}dpi)`).join(', ')} — 작게 넣으면 실효 해상도는 올라갑니다`));
    else if (!missing.length) out.push(it('img-dpi', '이미지 해상도', 'ok', `이미지 ${imgs.length}개 — 본문 폭에 넣어도 300dpi 이상`));
    if (p === 'd2d') { const col = imgs.filter((x) => x.color); if (col.length) out.push(it('img-gray', '그레이스케일(D2D)', 'warn', `컬러 이미지 ${col.length}개 — D2D Print 는 흑백(그레이스케일) 내지만 인쇄합니다(자동 변환되지만 결과를 확인하세요)`)); }
  }
  return out;
}

module.exports = { kdpInsideIn, overseasMarginsMm, scanPdf, interiorItems, KDP_MAX_PAGES, KDP_MAX_BYTES, KDP_OUTSIDE_IN, KDP_OUTSIDE_BLEED_IN, D2D_PAGES };
