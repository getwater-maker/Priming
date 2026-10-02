'use strict';
/**
 * register-guide.js — 📤 등록 도우미: 종이책·전자책 모두 부크크(bookk.co.kr) 점검표·입력값 요약 (2026-10-01 로이 결정 — 작가와 제외, 작가와 점검표는 남아 있지만 화면에서 쓰지 않는다).
 *
 * 근거: D:\## 출판\_공통\삼국지_출판_플랫폼_가이드_작가와_부크크.md (2026-09-30 공식 페이지·뉴스레터 원문 조사).
 *   🔒 = 로그인 뒤 화면이라 아직 못 읽은 항목 → 「확인 필요」로 표시하고 단정하지 않는다.
 *   플랫폼 정책은 자주 바뀐다 — 등록 직전에 다시 확인(REVIEWED 날짜 표시).
 *
 * 순수 함수만 둔다(파일·네트워크 없음) — 렌더러(BookView)가 그대로 import 하고 test/book-register.test.js 가 검증한다.
 * 상태(state): ok(충족) · todo(해야 함) · manual(사람이 직접 확인 — confirmed[id] 로 체크) · info(안내만)
 */

const REVIEWED = '2026-10-01';
const MB50 = 50 * 1024 * 1024;
const MB20 = 20 * 1024 * 1024;   // 부크크 전자책 EPUB 업로드 한도(부크크 고객센터 회신 2026-10-01)
const JB = require('./jakkawa-biblio');

const LINKS = {
  bookk: [
    ['부크크 홈', 'https://bookk.co.kr/'],
    ['자주 묻는 질문(표지 규격·반려·유통)', 'https://bookk.co.kr/community/faq'],
    ['서비스 소개(인세·ISBN)', 'https://bookk.co.kr/introduce'],
  ],
  ebook: [
    ['부크크 홈', 'https://bookk.co.kr/'],
    ['자주 묻는 질문(전자책·인세·ISBN)', 'https://bookk.co.kr/community/faq'],
  ],
  jakkawa: [
    ['작가와 홈', 'https://www.jakkawa.com/'],
    ['사이트맵(출판 단계)', 'https://www.jakkawa.com/sitemap'],
    ['EPUB 만들기(원고 규칙)', 'https://www.jakkawa.com/making-epub-ebook/'],
    ['서지정보 가이드', 'https://www.jakkawa.com/book-info-guide'],
  ],
};

// 부크크 「새종이책」 표지 재질 3종 — 두께·가격·표지 크기에 영향 없음(기록·표시용). 글자 있는 표지는 스노우 권장.
const COVER_MATERIALS = ['스노우 250g 무광코팅', '아르떼 210g 무광코팅', '스노우 250g 유광코팅'];
const DEFAULT_COVER_MATERIAL = COVER_MATERIALS[0];

const has = (v) => v != null && String(v).trim() !== '';
const item = (id, label, state, hint, extra) => ({ id, label, state, hint: hint || '', ...(extra || {}) });
// 사람이 직접 확인하는 항목 — confirmed[id] 가 참이면 ok
const manual = (id, label, hint, confirmed) => item(id, label, (confirmed && confirmed[id]) ? 'ok' : 'manual', hint, { manual: true });

function outputOf(ctx, kind) { return (ctx.outputs || []).find((o) => o.kind === kind) || null; }
function fmtMB(b) { return (b / 1024 / 1024).toFixed(1) + 'MB'; }
function sectionIncluded(ctx, key) {
  return (ctx.presentKeys || []).includes(key) && !(ctx.excluded || []).includes(key);
}

/** 종이책 → 부크크 점검표 */
// 표지 날개 — 자체 제작 표지(PDF/JPG 첨부)는 날개 가능(스프레드 가로 +200mm · A4 만 불가). **무료 표지**만 날개가 없다(부크크 FAQ).
//   날개 없이 승인된 책에는 나중에 날개를 추가할 수 없다 → 어느 쪽이든 등록 전 최종 확인을 안내한다(로이 2026-10-01 · 삼국지 R11).
function flapsItem(ctx) {
  const A4 = ctx.trimId === 'A4';
  if (ctx.flaps && A4) return item('flaps', '표지 날개', 'todo', 'A4 는 날개를 쓸 수 없습니다(부크크) — 날개를 끄세요', { tab: 'cover' });
  if (ctx.flaps) return item('flaps', '표지 날개 있음(자체 제작 표지)', 'ok',
    `표지 스프레드는 날개 포함(가로 +200mm)으로 만들어 첨부해야 합니다 — 부크크 무료 표지는 날개가 없습니다. 날개 없이 승인된 책에는 나중에 날개를 추가할 수 없으니 등록 전 최종 확인하세요`, { tab: 'cover' });
  return item('flaps', '표지 날개 없음', 'ok', '날개 없이 승인되면 나중에 날개를 추가할 수 없습니다 — 날개가 필요하면 등록 전에 켜세요(A4 제외)', { tab: 'cover' });
}
function bookkChecklist(ctx) {
  const m = ctx.meta || {}; const c = ctx.confirmed || {};
  const pages = ctx.pages || 0;
  const BK_TRIMS = ['46판', 'A5', 'B5', 'A4'];
  const cover = ctx.coverCheck;
  const coverOut = outputOf(ctx, 'cover');
  const required = [
    item('title', '책 제목', has(m.title || ctx.fileTitle) ? 'ok' : 'todo', '책 정보 › 책 제목', { tab: 'info' }),
    item('author', '저자(필명)', has(m.author) ? 'ok' : 'todo', '책 정보 › 저자', { tab: 'info' }),
    item('trim', '판형 — 46판 · A5 · B5 · A4 중 하나', BK_TRIMS.includes(ctx.trimId) ? 'ok' : 'todo',
      BK_TRIMS.includes(ctx.trimId) ? `${ctx.trimId}` : `지금 ${ctx.trimId} — 부크크는 4종만 받습니다`, { tab: 'layout' }),
    item('pages', '쪽수 확정(최소 50쪽)', pages >= 50 ? 'ok' : 'todo',
      pages <= 0 ? '미리보기 조판이 끝나면 자동으로 채워집니다' : (pages < 50 ? `현재 ${pages}쪽 — 부크크 최소 50쪽` : `${pages}쪽 → 책등 ${ctx.spineMm}mm`)),
    item('interior', '내지 PDF 생성', outputOf(ctx, 'interior') ? 'ok' : 'todo',
      outputOf(ctx, 'interior') ? `${outputOf(ctx, 'interior').name} (${fmtMB(outputOf(ctx, 'interior').bytes)})` : '아래 「📕 종이책 PDF」를 누르세요 — 내지는 재단여백 없이 판형 그대로'),
    item('cover', '표지 스프레드(앞표지+책등+뒷표지)',
      (cover && cover.ok && !cover.lowDpi) || coverOut ? 'ok' : 'todo',
      !ctx.coverImagePath && !coverOut ? '표지 탭에서 완성 이미지를 첨부 — 300dpi 이상'
        : (cover && !cover.ok ? (cover.flapHint ? `이 표지 파일은 날개 ${cover.flapHint === 'file-has-flaps' ? '포함' : '없는'} 치수입니다 — 날개 설정을 확인하세요(지금: 날개 ${ctx.flaps ? '있음' : '없음'})` : '치수 불일치 — 쪽수가 바뀌면 책등도 바뀝니다. 표지 탭의 치수로 다시 만드세요')
          : (cover && cover.lowDpi ? `해상도 낮음(실효 ${cover.effectiveDpi}dpi) — 반려 사유 1위` : '')), { tab: 'cover' }),
    flapsItem(ctx),
    manual('account', '부크크 회원가입·로그인(직접)', '계정 생성·로그인·최종 「제출」은 사람이 합니다', c),
    manual('nodup', '같은 책이 판매용으로 이미 등록돼 있지 않음', '판매용 도서는 중복 등록 불가 · 개정판은 초판보다 20쪽 이상 늘면 6개월 뒤, 미만이면 1년 뒤', c),
    manual('final', '편집 완성본임을 확인', '승인 뒤에는 수정 제약이 큽니다 — 완성된 파일로 제출(부크크 권고)', c),
  ];
  const optional = [
    item('coverMaterial', '표지 재질', has(m.coverMaterial) ? 'ok' : 'info',
      has(m.coverMaterial) ? m.coverMaterial : `미지정 — 기본 ${DEFAULT_COVER_MATERIAL}. 글자 있는 표지는 스노우 권장(재질 변경은 매주 금요일 무료)`, { tab: 'cover' }),
    item('printColor', '내지 색(흑백/컬러)', has(m.printColor) ? 'ok' : 'info',
      has(m.printColor) ? m.printColor : '미지정 — 흑백 기본. 인세: 부크크 사이트 흑백 35% · 외부유통 흑백 15%', { tab: 'info' }),
    item('category', '카테고리', has(m.category) ? 'ok' : 'info', has(m.category) ? m.category : '등록 화면 입력 항목(목록은 로그인 뒤 확인)', { tab: 'info' }),
    item('keywords', '키워드', has(m.keywords) ? 'ok' : 'info', has(m.keywords) ? m.keywords : '등록 화면 입력 항목', { tab: 'info' }),
    item('tagline', '한줄 소개', has(m.tagline) ? 'ok' : 'info', has(m.tagline) ? m.tagline : '등록 화면 입력 항목', { tab: 'info' }),
    manual('cmyk', '표지 색 모드: RGB 제출(CMYK 권장 · 반려 아님) — 시험 인쇄로 색 확인', '우리 표지 PDF 는 RGB 입니다. 부크크 안내는 CMYK 권장이고 RGB 도 반려되지 않지만 인쇄하면 색이 달라질 수 있습니다(예: 짙은 붉은 책등은 탁해지고 크림 바탕은 약간 노래짐). 인쇄소 프로파일을 모르는 채 변환하면 오히려 어긋날 수 있어 1권을 시험 인쇄(1부)해 실물 색을 본 뒤 필요하면 CMYK 표지 PDF 를 만듭니다', c),
    manual('safe', '표지 글자는 재단선에서 10~15mm 안쪽', '부크크 권고 — 표지 탭의 안전여백(5mm)보다 넓습니다. 풀빼다 이미지는 사방 3mm 추가', c),
    manual('outer', '승인 뒤 「최종 입점」 → (선택) 외부유통 신청', '승인 후 표지·내지 다운로드 검토 → 최종 입점. 외부유통은 나의 서재 › 유통관리에서 클릭으로 신청', c),
  ];
  return { required, optional };
}


/** 전자책 → 부크크 점검표 (2026-10-01 로이 결정: 종이책·전자책 모두 부크크 · 작가와 제외) — EPUB 업로드 20MB 이하.
 *  🔒 부크크 전자책 등록 화면(가격 범위·표지 규격·소개글 한도 등)은 로그인 뒤라 아직 못 읽었다 — 첫 권을 올리며 확인해 채운다. */
function ebookChecklist(ctx) {
  const m = ctx.meta || {}; const c = ctx.confirmed || {};
  const epub = outputOf(ctx, 'epub');
  const chk = ctx.epubCheck;   // { missing } | { ok, nError, nWarning, nFatal, version } | { error } | undefined(안 돌림)
  const required = [
    item('title', '책 제목', has(m.title || ctx.fileTitle) ? 'ok' : 'todo', '책 정보 › 책 제목', { tab: 'info' }),
    item('author', '저자명', has(m.author) ? 'ok' : 'todo', '책 정보 › 저자', { tab: 'info' }),
    item('toc', '목차 포함', (ctx.excluded || []).includes('toc') ? 'todo' : 'ok', '전자책은 목차(toc.ncx)가 길잡이 — 구조 › 목차 체크', { tab: 'structure' }),
    item('cover', '전자책 표지 이미지', (has(m.ebookCover) || ctx.coverImagePath) ? 'ok' : 'todo',
      has(m.ebookCover) || ctx.coverImagePath ? '' : '전자책표지 메타 또는 인쇄 표지(앞면 자동 크롭 — 쪽수 확정 뒤). 부크크 전자책 표지 규격은 로그인 뒤 화면 확인 필요 🔒', { tab: 'cover' }),
    item('file', 'ePub 파일 생성(EPUB 2.0)', epub ? 'ok' : 'todo', epub ? `${epub.name} (${fmtMB(epub.bytes)})` : '아래 「📱 ePub 만들기」를 누르세요'),
    item('size', 'ePub 20MB 이하(부크크 한도)', !epub ? 'todo' : (epub.bytes > MB20 ? 'todo' : 'ok'),
      !epub ? '파일을 먼저 생성하세요' : (epub.bytes > MB20 ? `${epub.name} ${fmtMB(epub.bytes)} — 20MB 초과: 한자 글꼴 동봉을 끄거나 표지 이미지를 줄이세요` : `${fmtMB(epub.bytes)} / 20MB`)),
    item('valid', 'ePub 규격 검증(EPUBCheck)',
      !chk ? (epub ? 'todo' : 'todo') : chk.missing ? 'manual' : chk.error ? 'todo' : (chk.ok ? 'ok' : 'todo'),
      !chk ? '아래 「✔ ePub 검증」을 누르세요 — W3C EPUBCheck 로 EPUB 2.0.1 규격 오류를 찾습니다'
        : chk.missing ? '이 PC 에는 EPUBCheck 도구가 없어 검증을 못 했습니다(메인 PC 에서 검증됨)' : chk.error ? `검증 실패: ${chk.error}`
        : (chk.ok ? `EPUB ${chk.epubVersion} 규격 통과 — 치명 ${chk.nFatal} · 오류 ${chk.nError} · 경고 ${chk.nWarning} (EPUBCheck ${chk.version})` : `오류 ${chk.nFatal + chk.nError}개 · 경고 ${chk.nWarning}개 — 아래 목록 확인`)),
    manual('account', '부크크 로그인(직접)', '계정·로그인·최종 제출은 사람이 합니다', c),
    manual('nodup', '같은 책이 이미 등록돼 있지 않음', '종이책과 전자책을 각각 등록(같은 표지·제목)', c),
    manual('final', '편집 완성본임을 확인', '승인 뒤에는 수정 제약이 큽니다', c),
  ];
  const optional = [
    item('category', '카테고리', has(m.category) ? 'ok' : 'info', has(m.category) ? m.category : '등록 화면 입력 항목(목록은 로그인 뒤 확인)', { tab: 'info' }),
    item('keywords', '키워드', has(m.keywords) ? 'ok' : 'info', has(m.keywords) ? m.keywords : '등록 화면 입력 항목', { tab: 'info' }),
    item('tagline', '한줄 소개', has(m.tagline) ? 'ok' : 'info', has(m.tagline) ? m.tagline : '등록 화면 입력 항목', { tab: 'info' }),
    item('aiDisclosure', 'AI 사용 표기', has(m.aiDisclosure) ? 'ok' : 'info', has(m.aiDisclosure) ? m.aiDisclosure : '부크크 요구 여부는 등록 화면에서 확인(🔒). 저자명에 AI 개입 표기 권고', { tab: 'info' }),
    manual('readers', '실제 리더에서 열어 확인(한자·각주 이동·목차)', 'Calibre · 리디 · 교보 앱 등에서 한 번 열어 보세요 — 앱은 규격만 검증합니다', c),
  ];
  return { required, optional };
}

/** 전자책 → 작가와 점검표 (더는 쓰지 않음 — 2026-10-01 부크크로 일원화 · 코드·테스트는 남김) */
function jakkawaChecklist(ctx) {
  const m = ctx.meta || {}; const c = ctx.confirmed || {};
  const file = outputOf(ctx, 'epub') || outputOf(ctx, 'ebookPdf');
  const big = (ctx.outputs || []).filter((o) => (o.kind === 'epub' || o.kind === 'ebookPdf') && o.bytes >= MB50);
  const required = [
    item('title', '책 제목', has(m.title || ctx.fileTitle) ? 'ok' : 'todo', '책 정보 › 책 제목', { tab: 'info' }),
    item('author', '저자명(작가명)', has(m.author) ? 'ok' : 'todo', 'AI가 집필에 개입했다면 저자명에 「AI」 표기 의무', { tab: 'info' }),
    item('issueDate', '출판일(서지정보)', has(m.issueDate) ? 'ok' : 'todo', 'ISBN 받은 날과 동일하게 — 판권 › 발행일', { tab: 'colophon' }),
    item('publisher', '출판사(서지정보)', has(m.publisher) ? 'ok' : 'todo', has(m.publisher) ? '' : '소속 출판사가 없으면 「작가와」', { tab: 'colophon' }),
    item('ebookPrice', '판매가(서지정보)', has(m.ebookPrice) ? 'ok' : 'todo', '판권 › 전자책 가격 — 저자 몫은 서점 판매가의 약 60%(세전)', { tab: 'colophon' }),
    item('toc', '목차 포함(필수)', (ctx.excluded || []).includes('toc') ? 'todo' : 'ok', '목차가 없으면 서점 업로드 불가 — 구조 › 목차 체크', { tab: 'structure' }),
    item('biblio', '서지정보 페이지(표지 다음 또는 마지막 쪽 한 곳)', sectionIncluded(ctx, 'colophon') ? 'ok' : 'todo',
      '판권이 작가와 서지정보 양식으로 조판됩니다(출판사·플랫폼에 「작가와」 표기 시) — 출판일(ISBN 받은 날)·저자명·출판사·ISBN(작가와 발급 신청 시 빈칸)·판매가 + 저작권 문구. 한 곳에만', { tab: 'structure' }),
    item('cover', '전자책 표지 이미지', (has(m.ebookCover) || ctx.coverImagePath) ? 'ok' : 'todo',
      has(m.ebookCover) || ctx.coverImagePath ? '' : '전자책 표지 메타 또는 인쇄 표지(앞면 자동 크롭). 작가와 표지 규격(px·비율)은 로그인 뒤 화면 확인 필요 🔒', { tab: 'cover' }),
    item('file', '원고 파일 생성(EPUB 권장·PDF 가능)', file ? 'ok' : 'todo',
      file ? `${file.name} (${fmtMB(file.bytes)})` : '아래 「📱 ePub」 — 텍스트 중심 원고는 EPUB 권장'),
    item('size', '파일 50MB 미만', !file ? 'todo' : (big.length ? 'todo' : 'ok'),
      !file ? '파일을 먼저 생성하세요' : (big.length ? `${big[0].name} ${fmtMB(big[0].bytes)} — 서점이 받는 한도 초과` : `${fmtMB(file.bytes)}`)),
    item('aiDisclosure', 'AI 사용 여부 표기', has(m.aiDisclosure) ? 'ok' : 'todo',
      has(m.aiDisclosure) ? m.aiDisclosure : '업로드 2단계 자가 체크리스트(퇴고·AI 표기)에 답해야 합니다 — 책 정보 › AI 사용', { tab: 'info' }),
    manual('email', '작가와 회원가입 + 이메일 인증(직접)', '출판에는 이메일 인증만 필요(휴대폰·계좌 인증은 정산 조회용)', c),
    manual('revised', '퇴고 완료', '퇴고 없는 원고는 예외 없이 반려', c),
    manual('policy', '해설·주석·삽화 등 부가 콘텐츠가 실질적으로 있음', '퍼블릭 도메인 원문·AI 번역본만이면 반려 · 작가 창작 비중이 낮으면 수수료 20% (2025-04-01 정책)', c),
  ];
  const optional = [
    item('ebookIsbn', '전자책 ISBN', has(m.ebookIsbn) ? 'ok' : 'info',
      has(m.ebookIsbn) ? m.ebookIsbn : '종이책 ISBN과 별개. 작가와에 발급을 신청하면 서지정보 ISBN 칸은 빈칸', { tab: 'colophon', optional: true }),
    item('pages', '분량 20쪽 이상', (ctx.pages || 0) >= 20 ? 'ok' : 'info', '공동집필 안내 뉴스레터에 전자책 최소 20쪽 언급 — 일반 규정인지는 미확인', {}),
    item('category', '카테고리', has(m.category) ? 'ok' : 'info', has(m.category) ? m.category : '도서정보 입력 항목(가격 범위·목록은 로그인 뒤 확인 🔒)', { tab: 'info' }),
    item('keywords', '키워드', has(m.keywords) ? 'ok' : 'info', has(m.keywords) ? m.keywords : '도서정보 입력 항목', { tab: 'info' }),
    item('tagline', '한줄 소개', has(m.tagline) ? 'ok' : 'info', has(m.tagline) ? m.tagline : '도서정보 입력 항목(소개글 한도 🔒)', { tab: 'info' }),
    manual('series', '시리즈는 1권 먼저 등록해 검수 결과 확인', '같은 저자의 시리즈를 한꺼번에 등록하면 서점이 저자 전체를 반려한 사례가 공지에 있습니다', c),
    manual('error', '변환 오류 점검(서식 과다·특수문자·이미지 회전)', '서식·특수문자가 많으면 서점에서 반려될 수 있습니다', c),
  ];
  return { required, optional };
}

function checklist(platform, ctx) { return platform === 'jakkawa' ? jakkawaChecklist(ctx) : platform === 'ebook' ? ebookChecklist(ctx) : bookkChecklist(ctx); }

/** 필수 항목 중 아직 안 끝난 수(todo + manual) */
function remaining(list) { return list.required.filter((i) => i.state !== 'ok').length; }
/** 탭 위 숫자 = 앱이 막는(todo) 필수 항목만. 사람이 직접 체크하는 항목(manual)은 「필수」 목록 안에서 확인 — 점검이 다 통과했는데 숫자가 남아 고장으로 보였다(로이 2026-10-02) */
function blocking(list) { return list.required.filter((i) => i.state === 'todo').length; }

/** 작가와 서지정보 페이지 양식(공식 양식 원문 · jakkawa.com/book-info-guide) — 전자책 판권과 같은 함수를 쓴다 */
function ebookBiblio(meta, opts) {
  const { rows, legal } = JB.biblio(meta, { placeholder: true });
  const lines = [...rows.map(([k, v]) => `${k} | ${v}`), '', legal];
  return lines.join('\n') + ((opts && opts.trailingNewline) ? '\n' : '');
}

/** 등록 화면에 옮겨 적을 값(복사용) */
function summary(platform, ctx) {
  const m = ctx.meta || {}; const sp = ctx.spread || {};
  const title = m.title || ctx.fileTitle || '';
  if (platform === 'ebook') {
    return [
      ['책 제목', title], ['저자', m.author || ''], ['출판사', m.publisher || ''],
      ['카테고리', m.category || ''], ['키워드', m.keywords || ''], ['한줄 소개', m.tagline || ''], ['AI 사용', m.aiDisclosure || ''],
    ];
  }
  if (platform === 'jakkawa') {
    return [
      ['책 제목', title], ['저자명', m.author || ''], ['출판사', m.publisher || '작가와'], ['출판일', m.issueDate || ''],
      ['판매가', m.ebookPrice || ''], ['전자책 ISBN', m.ebookIsbn || ''], ['카테고리', m.category || ''],
      ['키워드', m.keywords || ''], ['한줄 소개', m.tagline || ''], ['AI 사용', m.aiDisclosure || ''],
    ].filter(([, v]) => v !== '' || true);
  }
  const wide = sp.widthMm ? `${sp.widthMm} × ${sp.heightMm} mm  (${sp.widthPx} × ${sp.heightPx} px @300dpi)` : '';
  return [
    ['책 제목', title], ['저자', m.author || ''], ['판형', ctx.trimId || ''], ['내지 색', m.printColor || '흑백'],
    ['내지 용지', ctx.paperId || ''], ['쪽수', ctx.pages ? String(ctx.pages) : ''], ['표지 재질', m.coverMaterial || DEFAULT_COVER_MATERIAL],
    ['표지 날개', ctx.flaps ? '있음' : '없음'], ['책등 두께', sp.spineMm ? sp.spineMm + ' mm' : ''], ['표지 스프레드', wide],
    ['카테고리', m.category || ''], ['키워드', m.keywords || ''], ['한줄 소개', m.tagline || ''],
  ];
}

/** 자동 업로드 가능 여부(사실 기록 — 화면 안내 문구의 근거) */
const AUTO_UPLOAD = {
  api: false,
  note: '두 플랫폼 모두 공개 업로드 API 는 없습니다(2026-09-30). 그래서 「자동 입력」은 크롬 창을 열어 입력칸을 채우고 파일을 올린 뒤 멈춥니다 — 로그인 · 저장 · 표지/가격 확정 · 유통 신청/최종 입점 · 제출은 사람이 합니다(판매 등록·ISBN·판권은 로이 몫). 작가와는 도서정보 칸까지, 부크크는 2단계(원고 PDF)까지 자동입니다.',
};

module.exports = {
  REVIEWED, LINKS, COVER_MATERIALS, DEFAULT_COVER_MATERIAL, AUTO_UPLOAD, MB50, MB20,
  checklist, remaining, blocking, ebookBiblio, summary,
};
