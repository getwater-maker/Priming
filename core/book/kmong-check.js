'use strict';
/**
 * kmong-check.js — 🛒 크몽판 PDF 점검(2026-11-11 · 설계 docs/크몽-상세페이지-main분리-설계.md §A-3 ②).
 *
 *   규격 값은 platform-presets.PLATFORMS.kmong 한 곳 — 여기서는 「완성 PDF 가 그 값을 지키나」만 잰다.
 *   PDF 는 mupdf 로 읽는다(@vivliostyle/cli 를 따라 이미 깔려 있다 — ⛔ npm 의존성을 늘리지 않는다).
 *
 *   점검(🔴 = 막음 · fail-closed: 잴 수 없으면 막는다):
 *     🔴 쪽 크기 A4 · 🔴 본문 20쪽 이상(첫 장 ~ 판권 앞 · 표지·안내·표제지·목차·판권 제외) · 🔴 200MB 이하
 *     🔴 「부크크」·「BOOKK」·「ISBN」·ISBN 꼴(97[89]-…) 글자 0개(판권만이 아니라 표지·본문까지 — 로이 2026-11-11)
 *     🔴 목차(쪽 번호) · 🔴 저작권 안내 쪽 = 표지 다음 쪽과 맨 끝 쪽 · 🔴 워터마크 = 표지 빼고 모든 쪽
 *     ⚠ 이미지·여백 30% 미만(근사 — 글이 거의 없는 본문 쪽 비율) · ✋ 수정 제한(qpdf 가 있으면 잠그고 확인 · 없으면 사람이)
 *   수정 제한 = PDF **편집 권한만** 잠근다(열기 암호 없음 · 인쇄·글자 복사는 그대로 — 판단 · 실측 문서 §4).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const PP = require('./platform-presets');
const HB = require('./html-builder');

const KMONG = PP.getPlatform('kmong');
// 부크크 판권 정보의 흔적 — 하나라도 있으면 막는다. 글자 사이 공백(조판이 낱자로 끊어 읽히는 경우)도 잡도록 공백을 뺀 글로도 본다.
const BOOKK_RES = [
  { id: 'bookk-ko', label: '「부크크」', re: /부\s*크\s*크/ },
  { id: 'bookk-en', label: '「BOOKK」', re: /b\s*o\s*o\s*k\s*k/i },
  { id: 'isbn-word', label: '「ISBN」', re: /I\s*S\s*B\s*N/i },
  { id: 'isbn-form', label: 'ISBN 꼴(97[89]-…)', re: /97[89][\s\-‐‑–]*\d[\d\s\-‐‑–]{7,14}[\dXx]/ },
];

let _mupdf = null;
async function mupdf() {
  if (_mupdf) return _mupdf;
  const cands = [path.join(__dirname, '..', '..', 'node_modules', 'mupdf', 'dist', 'mupdf.js')];
  try { cands.push(path.join(path.dirname(require.resolve('@vivliostyle/cli/package.json')), 'node_modules', 'mupdf', 'dist', 'mupdf.js')); } catch (_) {}
  const f = cands.find((p) => fs.existsSync(p));
  if (!f) throw new Error('PDF 읽기 도구(mupdf)를 찾지 못했습니다');
  _mupdf = await import(pathToFileURL(f).href);
  return _mupdf;
}

/** PDF 쪽마다 { n(1부터), wMm, hMm, text, chars, links:[{to}] } — links = 문서 안 링크의 목적지 쪽(1부터) */
async function readPdf(pdfPath) {
  const M = await mupdf();
  const doc = M.Document.openDocument(fs.readFileSync(pdfPath), 'application/pdf');
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const p = doc.loadPage(i); const b = p.getBounds();
    const text = p.toStructuredText('preserve-whitespace').asText().replace(/\s+/g, ' ').trim();
    const links = [];
    try {
      for (const l of p.getLinks()) {
        if (l.isExternal && l.isExternal()) continue;
        let to = -1;
        try { const loc = doc.resolveLink(l); to = (typeof loc === 'number') ? loc : (loc && typeof loc.page === 'number' ? doc.pageNumberFromLocation(loc) : -1); } catch (_) {}
        if (to >= 0) links.push({ to: to + 1 });
      }
    } catch (_) {}
    pages.push({ n: i + 1, wMm: (b[2] - b[0]) / 72 * 25.4, hMm: (b[3] - b[1]) / 72 * 25.4, text, chars: text.replace(/\s/g, '').length, links });
  }
  let editable = null;
  try { editable = typeof doc.hasPermission === 'function' ? !!doc.hasPermission('edit') : null; } catch (_) {}
  const encrypted = (() => { try { return !!(doc.asPDF && doc.asPDF().getTrailer().get('Encrypt') && !doc.asPDF().getTrailer().get('Encrypt').isNull()); } catch (_) { return null; } })();
  return { pages, editable, encrypted };
}

/**
 * 본문 쪽 찾기 — 첫 장 = 목차 링크가 가리키는 가장 앞 쪽(목차는 장만 싣는다) · 끝 = 크몽판 판권(「크몽판 2026…」) 앞 쪽.
 *   반환 { start, end, count, tocPages[] } · 못 찾으면 null(→ 점검이 막는다).
 */
function bodyRange(pages, { hasCover = true } = {}) {
  const fwd = [];
  for (const p of pages) for (const l of p.links) if (l.to > p.n) fwd.push({ from: p.n, to: l.to });
  if (!fwd.length) return null;
  const start = Math.min(...fwd.map((x) => x.to));
  const tocPages = [...new Set(fwd.filter((x) => x.from < start).map((x) => x.from))].sort((a, b) => a - b);
  if (!tocPages.length) return null;
  const colRe = new RegExp(HB.KMONG_DATE_LABEL + '\\s*(?:19|20)\\d{2}');
  let col = pages.findIndex((p) => p.n >= start && colRe.test(p.text));
  let endPage = col >= 0 ? pages[col].n - 1 : -1;
  if (endPage < 0) {   // 판권 표지가 없으면 맨 끝 안내 쪽 앞까지
    const last = pages[pages.length - 1];
    endPage = last && last.text.includes(HB.KMONG_NOTICE_TITLE) ? last.n - 1 : -1;
  }
  if (endPage < start) return null;
  void hasCover;
  return { start, end: endPage, count: endPage - start + 1, tocPages };
}

function bookkHits(pages) {
  const hits = [];
  for (const p of pages) {
    for (const r of BOOKK_RES) {
      const m = p.text.match(r.re);
      if (m) {
        const at = Math.max(0, m.index - 12);
        hits.push({ page: p.n, id: r.id, label: r.label, snippet: p.text.slice(at, m.index + m[0].length + 12) });
      }
    }
  }
  return hits;
}

// ── 수정 제한(qpdf · 저장소 밖 ~/.priming-maker/tools/qpdf…) ──
function toolsDir(home) { return path.join(home || os.homedir(), '.priming-maker', 'tools'); }
/** qpdf 실행 파일 — tools 아래 `qpdf*` 폴더의 bin/qpdf(.exe) · 없으면 '' */
function findQpdf(home) {
  const exe = process.platform === 'win32' ? 'qpdf.exe' : 'qpdf';
  const dir = toolsDir(home);
  let subs = [];
  try { subs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^qpdf/i.test(d.name)).map((d) => path.join(dir, d.name)); } catch (_) {}
  for (const s of subs) for (const c of [path.join(s, 'bin', exe), path.join(s, exe)]) if (fs.existsSync(c)) return c;
  return '';
}
/**
 * 편집 권한만 잠근다(AES-256 · 열기 암호 없음 · 인쇄·글자 복사 허용). 반환 { status:'locked'|'missing'|'error', detail }.
 *   주인 암호는 무작위(남기지 않는다 — 고칠 땐 크몽판을 다시 만든다). 원본 자리에 덮어쓴다(임시 파일 → rename).
 */
function lockEdit(pdfPath, { home, qpdf, run } = {}) {
  const exe = qpdf || findQpdf(home);
  if (!exe) return Promise.resolve({ status: 'missing', detail: `qpdf 가 없습니다 — ${toolsDir(home)}\\qpdf-…\\bin\\qpdf.exe 에 두면 자동으로 잠급니다. 지금은 사람이 잠가 주세요(편집 권한 잠금 · 열기 암호 없음).` });
  const tmp = pdfPath + '.lock.tmp';
  const owner = crypto.randomBytes(18).toString('base64url');
  const args = ['--encrypt', '', owner, '256', '--modify=none', '--', pdfPath, tmp];
  const runner = run || ((cmd, a) => new Promise((res) => execFile(cmd, a, { windowsHide: true, timeout: 120000 }, (e, so, se) => res({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out: String(so || '') + String(se || '') }))));
  return runner(exe, args).then((r) => {
    // qpdf 종료 코드 3 = 경고만(파일은 만들어짐)
    if ((r.code === 0 || r.code === 3) && fs.existsSync(tmp)) {
      try { fs.renameSync(tmp, pdfPath); } catch (e) { try { fs.copyFileSync(tmp, pdfPath); fs.unlinkSync(tmp); } catch (e2) { return { status: 'error', detail: '잠근 파일을 옮기지 못했습니다: ' + e2.message }; } }
      return { status: 'locked', detail: 'qpdf — 편집 권한 잠금(AES-256 · 열기 암호 없음)' };
    }
    try { fs.unlinkSync(tmp); } catch (_) {}
    return { status: 'error', detail: `qpdf 실패(코드 ${r.code}) ${String(r.out || '').slice(0, 200)}` };
  });
}

/**
 * 완성 크몽판 PDF 점검. opts: { hasCover(모르면 1쪽이 글자 없는 쪽인지로) · watermark(문구 — 없으면 원고 메타로 만들 수 없으니 검사 생략=✋) · lock({status,detail}) }
 * 반환 { ok, items:[{id,label,status:'ok'|'fail'|'warn'|'manual',detail}], bodyPages, totalPages, bytes, hits }
 *   ok = 🔴 항목이 하나도 fail 이 아니다(⚠·✋ 는 막지 않는다).
 */
async function checkKmongPdf(pdfPath, opts = {}) {
  const items = [];
  const add = (id, label, status, detail) => items.push({ id, label, status, detail: detail || '' });
  let hasCover = opts.hasCover;   // 모르면(다시 점검) 1쪽이 글자 없는 쪽인지로 판단 — 아래에서 정한다
  let bytes = 0;
  try { bytes = fs.statSync(pdfPath).size; } catch (e) {
    add('file', 'PDF 파일', 'fail', '파일이 없습니다: ' + pdfPath);
    return { ok: false, items, bodyPages: 0, totalPages: 0, bytes: 0, hits: [] };
  }
  let R;
  try { R = await readPdf(pdfPath); } catch (e) {
    add('read', 'PDF 읽기', 'fail', '읽지 못해 점검할 수 없습니다(막음): ' + e.message);
    return { ok: false, items, bodyPages: 0, totalPages: 0, bytes, hits: [] };
  }
  const pages = R.pages;
  if (hasCover == null) hasCover = !!(pages[0] && pages[0].chars === 0);
  hasCover = !!hasCover;
  const inner = hasCover ? pages.slice(1) : pages;
  const A4 = PP.TRIM_SIZES.A4;

  // 쪽 크기
  const off = inner.filter((p) => Math.abs(p.wMm - A4.width) > 1 || Math.abs(p.hMm - A4.height) > 1);
  add('a4', 'A4 세로 쪽', off.length ? 'fail' : 'ok', off.length ? `A4 가 아닌 쪽 ${off.length}개(${off.slice(0, 5).map((p) => p.n).join(',')}쪽…)` : `${inner.length}쪽 모두 210×297mm`);

  // 본문 쪽수
  const br = bodyRange(pages, { hasCover });
  const minBody = KMONG.minBodyPages;
  if (!br) add('body', `본문 ${minBody}쪽 이상`, 'fail', '목차·본문 위치를 찾지 못해 셀 수 없습니다(막음 — 목차 링크가 없거나 장이 없다)');
  else add('body', `본문 ${minBody}쪽 이상`, br.count >= minBody ? 'ok' : 'fail', `본문 ${br.count}쪽(${br.start}~${br.end}쪽 · 표지·안내·표제지·목차·판권 제외 · 전체 ${pages.length}쪽)`);

  // 용량
  const mb = Math.round(bytes / 1048576 * 10) / 10;
  add('size', '200MB 이하', bytes <= KMONG.maxBytes ? 'ok' : 'fail', `${mb}MB`);

  // 🔴 부크크 판권 정보 흔적
  const hits = bookkHits(pages);
  add('bookk', '부크크·ISBN 글자 0개', hits.length ? 'fail' : 'ok',
    hits.length ? hits.slice(0, 6).map((h) => `${h.page}쪽 ${h.label} 「…${h.snippet}…」`).join(' / ') + (hits.length > 6 ? ` 외 ${hits.length - 6}곳` : '') : '「부크크」·「BOOKK」·「ISBN」·ISBN 꼴 없음');

  // 목차 쪽 번호
  if (!br) add('toc', '목차(쪽 번호)', 'fail', '목차를 찾지 못했습니다');
  else {
    const tp = pages.find((p) => p.n === br.tocPages[0]);
    const nums = (tp && tp.text.match(/\d+/g)) || [];
    add('toc', '목차(쪽 번호)', nums.length ? 'ok' : 'fail', `${br.tocPages.join(',')}쪽 · 쪽 번호 ${nums.length}개`);
  }

  // 저작권 안내 쪽 — 표지 다음 쪽 · 맨 끝 쪽
  const firstIn = inner[0], last = pages[pages.length - 1];
  const nFront = !!(firstIn && firstIn.text.includes(HB.KMONG_NOTICE_TITLE));
  const nBack = !!(last && last !== firstIn && last.text.includes(HB.KMONG_NOTICE_TITLE));
  add('notice', '저작권 안내 쪽(처음·끝)', nFront && nBack ? 'ok' : 'fail', `${hasCover ? '표지 다음' : '첫'} 쪽 ${nFront ? '있음' : '없음'} · 맨 끝 쪽 ${nBack ? '있음' : '없음'}`);

  // 워터마크
  const wm = String(opts.watermark || '').trim();
  if (!wm) add('watermark', '워터마크(모든 쪽)', 'manual', '워터마크 문구를 몰라 확인하지 않았습니다');
  else {
    const key = wm.replace(/\s/g, '');
    const miss = inner.filter((p) => !p.text.replace(/\s/g, '').includes(key));
    add('watermark', '워터마크(모든 쪽)', miss.length ? 'fail' : 'ok', miss.length ? `없는 쪽 ${miss.length}개(${miss.slice(0, 6).map((p) => p.n).join(',')}…)` : `표지 빼고 ${inner.length}쪽 모두 「${wm}」${hasCover ? ' · 표지 쪽은 그림이라 넣지 않는다' : ''}`);
  }

  // ⚠ 이미지·여백 30% — 근사: 본문 가운데 글자가 아주 적은 쪽(그림·빈 쪽)의 비율
  if (br) {
    const body = pages.filter((p) => p.n >= br.start && p.n <= br.end);
    const sparse = body.filter((p) => p.chars < 150).length;
    const ratio = body.length ? sparse / body.length : 0;
    add('imgratio', `이미지·여백 ${Math.round(KMONG.maxImageRatio * 100)}% 미만(근사)`, ratio < KMONG.maxImageRatio ? 'ok' : 'warn', `글이 거의 없는 본문 쪽 ${sparse}/${body.length}(${Math.round(ratio * 100)}%) — 크몽 심사 기준은 사람 판단이라 참고값`);
  }

  // 수정 제한
  const lk = opts.lock || null;
  if (R.encrypted && R.editable === false) add('lock', '수정 제한(편집 잠금)', 'ok', (lk && lk.detail) || '편집 권한이 잠겨 있습니다');
  else if (lk && lk.status === 'locked') add('lock', '수정 제한(편집 잠금)', 'fail', '잠갔다는데 PDF 에 편집 잠금이 없습니다');
  else add('lock', '수정 제한(편집 잠금)', 'manual', (lk && lk.detail) || '잠기지 않았습니다 — qpdf 를 두거나 사람이 편집 권한을 잠가 주세요(열기 암호 없이 편집만)');

  const ok = !items.some((i) => i.status === 'fail');
  return { ok, items, bodyPages: br ? br.count : 0, totalPages: pages.length, bytes, hits };
}

module.exports = { mupdf, checkKmongPdf, readPdf, bodyRange, bookkHits, BOOKK_RES, findQpdf, lockEdit, toolsDir };
