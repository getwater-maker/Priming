// BookView.jsx — 출판(POD) 모드 화면: 구조 패널 / 실제 페이지 미리보기(vivliostyle) / 설정 패널.
//   미리보기 = main 이 조판 HTML 을 media:// 로 서빙 → @vivliostyle/core 가 브라우저에서
//   PDF 와 동일한 CSS Paged Media 조판으로 펼침면 렌더. 문단 클릭 → 원고(.md) 해당 줄 수정.
import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import api from './lib/ipc.js';
import { CoreViewer, Navigation, PageViewMode } from '@vivliostyle/core';
import RG from '../../core/book/register-guide.js';
import HK from '../../core/book/header-kind.js';
import DK from '../../core/book/date-ko.js';   // 발행일 「2026년 10월 06일」 모양
import ISBNC from '../../core/book/isbn-barcode.js';   // normalizeIsbn13 — ISBN 체크 숫자 확인(순수 함수)

// 메뉴(왼쪽) — 필수/선택은 플랫폼(작가와·부크크) 조사 기준. 파일 구조: [키, 아이콘, 이름]
const TABS = [
  ['structure', '📚', '구조'], ['info', '📋', '책 정보'], ['colophon', '©', '판권'], ['cover', '🎨', '표지'],
  ['layout', '📐', '조판'], ['bookk', '📤', '부크크 등록'],
];
// 책 정보 탭 — [키, 이름, 필수?, 도움말]
const INFO_FIELDS = [
  ['title', '책 제목', true, ''], ['author', '저자(필명)', true, 'AI가 집필에 개입했다면 저자명에 「AI」 표기(부크크 권고)'],
  ['subtitle', '부제', false, ''], ['translator', '옮긴이', false, ''], ['editor', '편집인', false, ''],
];
// 플랫폼 등록 화면에 입력하는 정보(조판에는 안 들어간다) — 로그인 뒤 화면의 실제 항목·한도는 등록 때 확인
const DEFAULT_LEGAL_TEXT = '이 책의 내용 중 전부 또는 일부를 재사용하려면 반드시 저작권자의 서면 동의를 얻어야 합니다.';
const REG_FIELDS = [
  ['category', '카테고리', '부크크 등록 화면 항목(목록은 로그인 뒤 확인)'],
  ['keywords', '키워드(쉼표)', ''], ['tagline', '한줄 소개', ''],
];
// 판권 탭 — 법정 필수 5필드(제목·저자는 책 정보) + 선택
const COLO_REQ = [['issuer', '발행인'], ['publisher', '출판사'], ['issueDate', '발행일']];   // ISBN·정가는 필수 아님 — 부크크 등록 과정(2단계 ISBN 발급·4단계 가격정책)에서 입력·확인(로이 2026-10-02)
const COLO_OPT = [
  ['price', '정가(종이책)'],
  ['ebookPrice', '전자책 가격'], ['isbnAddon', '부가기호(5자리)'], ['regNo', '출판등록'],
  ['copyright', '저작권(ⓒ)'], ['address', '주소'], ['phone', '대표전화'], ['fax', '팩스'], ['homepage', '홈페이지'], ['email', '대표메일'],
  ['blog', '블로그'], ['facebook', '페이스북'], ['instagram', '인스타그램'],
  ['logo', '출판사 로고(이미지 경로)'], ['qr', 'QR(주소/이미지)'], ['qrLabel', 'QR 라벨'],
];
// 판권 법정 필수 7필드 — 미입력 경고
const REQUIRED_KEYS = [['title', '제목'], ['author', '저자'], ['issuer', '발행인'], ['issueDate', '발행일'], ['publisher', '출판사']];

// SVG 문자열 → PNG dataURL (렌더러 캔버스 사용)
function svgToPngDataUrl(svg, w, h) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/png'));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(new Error('SVG 렌더 실패')); };
    img.src = url;
  });
}

// 조판 옵션 기본값 — 구 Book Publishing 앱에서 사용자가 쓰던 값 그대로
const LAYOUT_DEFAULTS = {
  fontKey: 'kopub', fontSizePt: 10, lineHeight: 1.8, fontWeight: 300,
  letterSpacingPt: -0.4, indentPt: 15, paragraphSpacingPt: 5, // 최종본([POD] 삼국지 1권) 실측 — 들여쓰기 + 문단 간격 5pt
  marginsMm: { top: 20, bottom: 15, inner: 20, outer: 17 },
  chapterStart: 'recto',
  headerEven: 'title', headerOdd: 'chapter', headerEvenAlign: 'left', headerOddAlign: 'right',
  headerLine: true, pageNum: 'outer',
  h2SizePt: 10.5, h2Gothic: true, h2Weight: 700, h2Align: 'left', h2Prefix: '❖',
  h2MarginTopPt: 25, h2MarginBottomPt: 8,
  colophonFields: null, colophonAlign: 'bottom', coverOverlay: false, coverBarcode: true, coverTextColor: '#111111',
  lineBreak: 'word',   // 줄바꿈 방식 — word(어절·기본) / char(글자) / smart(절충) · 원고 메타 `> 줄바꿈:` 이 이긴다
  tocSizePt: 0, tocLineHeight: 0,   // 목차 글자(pt)·행간 — 0 = 본문과 같음(원고 메타 `> 목차글자:` `> 목차행간:` 이 이긴다)
  specialKeyword: '', // 반복 코너(예: '역사 노트') — 일치하는 소제목 구간을 노트 박스로
  // 영상 대본 모드 — 제작용 블록(제작메모·엔진 프롬프트)을 **출력에서만** 제외. 대본 파일은 불변.
  //   출판 탭의 2순위 목적(영상 대본을 깔끔히 정독)을 위한 스위치. 책 원고는 기본 OFF 로 영향 없음.
  scriptMode: false,
  scriptHideShots: false,
  excluded: [],       // 출력 제외 key 목록 — 예약 섹션은 key, 본문 장은 `ch:<제목>` (원고는 보존)
  // 작업용 파일 경로(`../참고문헌/…/x.pdf`) → 파일명만. 종이에선 경로를 찾아갈 수 없고 한 줄을
  //   통째로 잡아먹는다. 기본 OFF — 켜고 끄는 건 사용자가 정한다(조용히 내용을 바꾸지 않는다).
  hidePaths: false,
};

// 구조 패널 체크박스 한 줄 — 원고에 있으면 포함/제외 토글(비파괴), 없으면 체크 시 템플릿 삽입.
function SectionChk({ r, presentKeys, layout, toggleSection, cover }) {
  const present = presentKeys.has(r.key);
  // 목차는 원고에 없어도 프로그램이 자동 생성 — 체크 상태로 보여주고, 해제하면 자동 생성도 끔.
  const autoGen = r.key === 'toc' && !present;
  const checked = (present || autoGen) && !(layout.excluded || []).includes(r.key);
  return (
    <label className="chk" style={(present || autoGen) ? undefined : { opacity: 0.55 }}
      title={present
        ? (cover ? '체크 해제 = 표지 PDF 에서 제외 (원고 보존)' : '체크 해제 = 책에서 제외 (원고 보존 — 다시 체크하면 복원)')
        : (autoGen ? '원고에 [목차]가 없어 프로그램이 자동 생성합니다 — 체크 해제 = 목차 없이' : '체크 = 원고에 이 섹션 템플릿을 추가')}>
      <input type="checkbox" checked={checked} onChange={(e) => toggleSection(r.key, e.target.checked, present || autoGen)} /> {r.label}
      {autoGen ? <span className="meta"> (자동 생성)</span> : (!present && <span className="meta"> (원고에 없음)</span>)}
    </label>
  );
}

export default function BookView({ dto, setDto, setStatus, logline, logBox, queue, setQueue, onSelectQueue, onRemoveQueue }) {
  const [layout, setLayout] = useState(LAYOUT_DEFAULTS);
  // 원고 전환 시 저장된 조판 설정 복원(없으면 기본값)
  const layoutLoadedFor = useRef('');
  useEffect(() => {
    if (!dto || dto.kind !== 'book' || layoutLoadedFor.current === dto.scriptPath) return;
    layoutLoadedFor.current = dto.scriptPath;
    lastPagesRef.current = 0; // 원고 전환 — 이전 원고와 새 조판 쪽수가 우연히 같아도 쪽수 보고가 스킵되지 않게 리셋
    const saved = dto.layoutSaved || {};
    setLayout({ ...LAYOUT_DEFAULTS, ...saved, marginsMm: { ...LAYOUT_DEFAULTS.marginsMm, ...(saved.marginsMm || {}) } });
  }, [dto && dto.scriptPath]);
  const L = (k, v) => setLayout((s) => ({ ...s, [k]: v }));
  const Lm = (k, v) => setLayout((s) => ({ ...s, marginsMm: { ...s.marginsMm, [k]: Number(v) || 0 } }));
  const [previewUrl, setPreviewUrl] = useState(null);
  // 📱 미리보기 전환(R22) — 종이책(내지 조판) | 전자책(실제 ePub 의 spine 문서를 차례로 + 사전 점검)
  const [viewMode, setViewMode] = useState('paper');
  const [eb, setEb] = useState({ busy: false, error: '', docs: [], checks: [], n: 1, html: '', version: '', bytes: 0, forPath: '' });
  // 📜 판권 고지문 입력 — 비어 있는 새 칸 개수(저장 전). ⚠ 훅이라 `if (!loaded) return` 보다 앞에 둔다(뒤에 두면 React #310 — 화면이 백지)
  const [noteExtra, setNoteExtra] = useState(0);
  // ⚡ 입력하는 대로 저장(로이 2026-10-07) — 글자를 칠 때마다(0.4초 쉬면) 원고 메타에 저장한다. 입력칸 key 에 값이 들어 있으면
  //   저장 직후 칸이 새로 만들어져 초점을 잃으므로, key 는 `fieldRev`(칸을 벗어날 때만 올림 — 다듬어진 값을 다시 보이게)만 쓴다.
  const [fieldRev, setFieldRev] = useState(0);
  const [noteRev, setNoteRev] = useState(0);   // 고지문 줄을 지우거나 더할 때만 올림(칸 다시 만들기)
  const liveTimers = useRef({});
  const _cpNotesKey = ((dto && dto.colophonNotes) || []).join('\u0001');
  useEffect(() => { setNoteExtra(0); }, [dto && dto.scriptPath, _cpNotesKey]);
  const [previewBusy, setPreviewBusy] = useState(false);
  // ⏱ 미리보기 조판 진행 표시 — 단계(html 만들기 → 조판) · 경과 초 · 지금까지 배치된 쪽 수(iframe 의 vivliostyle 쪽 컨테이너를 센다)
  const [previewPhase, setPreviewPhase] = useState('');
  const [prog, setProg] = useState({ sec: 0, pages: 0 });
  const busyStartRef = useRef(0);
  useEffect(() => {
    if (!previewBusy) { busyStartRef.current = 0; return undefined; }
    busyStartRef.current = Date.now();
    setProg({ sec: 0, pages: 0 });
    const id = setInterval(() => {
      let pages = 0;
      try { const d = viewportRef.current && viewportRef.current.contentDocument; if (d) pages = d.querySelectorAll('[data-vivliostyle-page-container]').length; } catch (_) {}
      setProg((p) => ({ sec: Math.floor((Date.now() - busyStartRef.current) / 1000), pages: Math.max(p.pages, pages) }));
    }, 1000);
    return () => clearInterval(id);
  }, [previewBusy]);
  const [building, setBuilding] = useState(false);
  const [pageInfo, setPageInfo] = useState({ cur: 0, total: 0 });
  const [edit, setEdit] = useState(null); // { lineStart, lineEnd, text, file }
  // 문단 수정창은 ESC 로도 닫는다(취소 버튼과 동일) — 앱 전체 팝업 닫기 규칙과 일관.
  useEffect(() => {
    if (!edit) return;
    const onKey = (e) => { if (e.key === 'Escape') setEdit(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [edit]);
  const viewerRef = useRef(null);   // CoreViewer 인스턴스
  const viewportRef = useRef(null); // 뷰포트 DOM
  const loadedForRef = useRef('');  // 마지막으로 로드한 url (중복 로드 방지)
  const lastPagesRef = useRef(0);   // 마지막 보고 쪽수
  const dtoPagesRef = useRef(0);    // 서버(main)가 지금 아는 쪽수 — 보고 여부는 이것과 비교한다

  // 🖥 화면 아래 끝까지 채운다 — 위쪽(헤더) 높이를 재서 남은 만큼(고정 130px 는 아래 빈 공간을 남겼다)
  const wrapRef = useRef(null);
  useLayoutEffect(() => {
    const fit = () => { const el = wrapRef.current; if (!el) return; const top = el.getBoundingClientRect().top; el.style.height = Math.max(480, window.innerHeight - top - 10) + 'px'; };
    fit(); window.addEventListener('resize', fit);
    const t = setTimeout(fit, 400);   // 헤더가 늦게 자리 잡는 경우
    return () => { window.removeEventListener('resize', fit); clearTimeout(t); };
  });

  const meta = (dto && dto.meta) || {};
  const loaded = !!(dto && dto.kind === 'book');

  // ── 왼쪽 메뉴 · 등록 점검(개인 편의값은 이 PC 브라우저에만 — 실패해도 화면은 정상) ──
  const [tab, setTabRaw] = useState(() => { try { const t = localStorage.getItem('bk-tab') || 'structure'; return (t === 'jakkawa' || t === 'ebook') ? 'bookk' : t; } catch (_) { return 'structure'; } });   // 옛 「전자책·작가와」 탭 → 부크크 전자책
  const setTab = (t) => { setTabRaw(t); try { localStorage.setItem('bk-tab', t); } catch (_) {} };
  const confirmKey = 'bk-confirm:' + ((dto && dto.scriptPath) || '');
  const [confirmed, setConfirmed] = useState({});
  useEffect(() => {
    try { setConfirmed(JSON.parse(localStorage.getItem(confirmKey) || '{}') || {}); } catch (_) { setConfirmed({}); }
  }, [confirmKey]);
  const setConfirm = (id, on) => setConfirmed((c) => {
    const n = { ...c, [id]: !!on };
    try { localStorage.setItem(confirmKey, JSON.stringify(n)); } catch (_) {}
    return n;
  });
  // 🖼 미리보기 첫 화면 = 표지 펼침면(삼국지 R13) — 미리보기 전용. Vivliostyle 문서에는 넣지 않고(쪽번호가 PDF 와 어긋나지 않게) 화면이 맨 앞 한 화면으로 얹는다.
  const [cover, setCover] = useState(null);          // main 의 book-cover-preview: { kind, html, spread, warnings, fileName, flaps } | null
  const [showCover, setShowCover] = useState(true);  // 지금 표지 화면을 보고 있나
  const [coverLines, setCoverLines] = useState(true); // 책등 mm · 접힘선 · 재단선 표시
  const [coverFit, setCoverFit] = useState(0.4);     // 표지 펼침면 배율(mm → 화면 맞춤)
  const coverRef = useRef(null), showCoverRef = useRef(true), curRef = useRef(0), navRef = useRef(null), navBusyRef = useRef(false), navPendRef = useRef(null), navTimerRef = useRef(null), navFlushRef = useRef(null);
  const coverBoxRef = useRef(null), coverCanvasRef = useRef(null);
  coverRef.current = cover; showCoverRef.current = showCover;
  const [regBusy, setRegBusy] = useState(false);
  const [paperPrice, setPaperPrice] = useState(null);       // 💾 종이책 정가 기록 {price, source, paper, ebook}
  const [paperPriceIn, setPaperPriceIn] = useState('');
  useEffect(() => { if (!loaded || !api.bookRegisterPaperPrice) return; api.bookRegisterPaperPrice({}).then((r) => { if (r && r.ok) setPaperPrice(r); }).catch(() => {}); }, [loaded, dto && dto.fileTitle]);
  const [outputs, setOutputs] = useState([]);
  const refreshOutputs = useCallback(() => { api.bookOutputs().then((o) => setOutputs(Array.isArray(o) ? o : [])).catch(() => {}); }, []);
  useEffect(() => { if (loaded) refreshOutputs(); }, [loaded, dto && dto.scriptPath, tab]);
  const [titleFit, setTitleFit] = useState(null);
  useEffect(() => { setShowCover(true); }, [dto && dto.scriptPath]);   // 원고를 열면 표지부터
  useEffect(() => { if (!cover && showCover) setShowCover(false); }, [cover]);
  // 표지 배율 — 칸 크기에 맞춘다(펼침면 가로·세로 모두 들어가게)
  useEffect(() => {
    const el = coverCanvasRef.current;
    if (!el || !cover || !showCover) return undefined;
    const fit = () => {
      const w = el.clientWidth - 28, h = el.clientHeight - 28;
      const Wpx = cover.spread.widthMm * 3.7795, Hpx = cover.spread.heightMm * 3.7795;
      if (w > 20 && h > 20) setCoverFit(Math.max(0.1, Math.min(w / Wpx, h / Hpx)));
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, [cover, showCover]);
  useEffect(() => { if (showCover && cover && coverBoxRef.current) { try { coverBoxRef.current.focus(); } catch (_) {} } }, [showCover, cover]);

  // ── 미리보기 조판 ──
  const refreshPreview = useCallback(async () => {
    if (!loaded) return;
    setPreviewBusy(true); setStatus('조판 중…'); setPreviewPhase('html');
    try {
      const r = await api.bookPreview({ layout });
      if (r && r.url) setPreviewPhase('layout');
      // 캐시 무효화 = main 이 조판마다 새 파일명(book-<ts>.html)을 반환 — URL 에 쿼리(?t=)나
      // 프래그먼트(#t=)를 붙이면 vivliostyle 의 같은문서 판정이 깨져 목차 target-counter
      // 쪽번호가 '??' 로 나온다(로드 URL 은 쿼리 포함, anchor 절대화는 쿼리 없음 → 불일치).
      if (r && r.url) setPreviewUrl(r.url);
      else { setPreviewBusy(false); setStatus('⚠ 미리보기 조판 실패 — 로그를 확인하세요'); } // 실패 시 '조판 중…' 고착 방지
    } catch (e) { logline('미리보기 오류: ' + e.message); setPreviewBusy(false); setStatus('⚠ 미리보기 오류 — 로그 확인'); }
  }, [loaded, layout]);

  // 조판에 영향을 주는 "내용"만 뽑은 문자열 시그니처.
  //   ⚠ dto.meta/front/back/parts 를 직접 의존성에 넣으면, 조판 완료 후 bookReportPages 가
  //   돌려주는 새 dto(내용 동일·참조만 다름) 때문에 effect 가 재실행 → 무한 재조판(깜빡임)이 된다.
  //   값 기반 문자열이면 쪽수 보고로 dto 가 새로 와도 시그니처가 같아 재조판을 트리거하지 않는다.
  //   (dto.spread·lastPages 는 조판 결과라 여기서 제외)
  const contentSig = loaded ? JSON.stringify({
    path: dto.scriptPath, meta: dto.meta, front: dto.front, back: dto.back, parts: dto.parts,
    covers: dto.covers, cover: dto.coverImagePath, layout,
  }) : '';

  // 내용이 바뀌면 자동 재조판 — 디바운스 600ms
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(refreshPreview, 600);
    return () => clearTimeout(t);
  }, [contentSig]);
  // 표지 펼침면 정보 — 가볍다(조판 없음). 내용·쪽수(책등)·날개·첨부 표지가 바뀌면 다시 받는다.
  useEffect(() => {
    if (!loaded) { setCover(null); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      try { const r = await api.bookCoverPreview({ layout }); if (live) setCover(r && r.kind ? r : null); }
      catch (_) { if (live) setCover(null); }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [loaded, contentSig, dto && dto.lastPages, dto && dto.flaps, dto && dto.coverImagePath, dto && dto.coverCheck && dto.coverCheck.ok]);
  // 📏 제목 길이 기준 — 머리글(전체 회목 사용 시)·목차에 안 들어가는 회목을 구조 탭이 미리 알린다(조판 없이 글꼴 폭으로 계산)
  useEffect(() => {
    if (!loaded) { setTitleFit(null); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      try { const r = await api.bookTitleFit({ layout }); if (live) setTitleFit(r && r.ok ? r : null); } catch (_) { if (live) setTitleFit(null); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [loaded, contentSig]);
  // 🔎 출고 전 점검 — 부크크 탭(종이책·전자책)을 열 때·완성 파일이 바뀔 때·쪽수가 정해질 때 다시 본다
  dtoPagesRef.current = (dto && dto.lastPages) || 0;
  const [pfx, setPfx] = useState(null);
  const loadPf = useCallback(() => { api.bookPreflight({ layout }).then((r) => setPfx(r || null)).catch(() => setPfx(null)); }, [layout]);
  useEffect(() => {
    if (!loaded || tab !== 'bookk') return undefined;
    const t = setTimeout(loadPf, 300);
    return () => clearTimeout(t);
  }, [loaded, tab, outputs, dto && dto.lastPages, dto && dto.coverImagePath, contentSig]);

  // ── vivliostyle 로드 ──
  //   ⚠ 반드시 iframe 안에 렌더 — 같은 document 에 렌더하면 앱 전역 CSS(p 마진·폰트 14px 등)가
  //   조판 DOM 에 캐스케이드돼 실측 기반 페이지 분할이 왜곡됨(삼국지 255쪽 → 660쪽으로 부풀던 원인).
  useEffect(() => {
    if (!previewUrl || !viewportRef.current) return;
    if (loadedForRef.current === previewUrl) return;
    loadedForRef.current = previewUrl;
    const iframe = viewportRef.current;
    const fdoc = iframe.contentDocument;
    fdoc.open();
    fdoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#aaa}   /* 뷰어 작업 영역(#aaa)과 같은 색 — 한 펼침면만 그려 아래가 남을 때 갈색 띠로 보이던 것(로이 2026-10-02) */
body{overflow-y:scroll;display:flex;flex-direction:column}
#vp{margin-top:auto;margin-bottom:auto;width:100%}   /* 펼침면이 창보다 작으면 세로 가운데(가로는 뷰어가 가운데) · 크면 맨 위부터 스크롤(auto 마진은 잘리지 않는다) */
::-webkit-scrollbar{width:14px}
::-webkit-scrollbar-track{background:#6f675e}
::-webkit-scrollbar-thumb{background:#c9b48a;border-radius:7px;border:3px solid #6f675e}
::-webkit-scrollbar-thumb:hover{background:#d4a574}
[data-src-line]:hover{outline:2px solid rgba(212,165,116,.9);outline-offset:1px;cursor:pointer}
</style></head><body><div id="vp"></div></body></html>`);
    fdoc.close();
    fdoc.addEventListener('click', (e) => onPreviewClickRef.current(e));
    // 🖱 휠 = 적응형 — 문서가 실제로 스크롤 가능하면(확대 상태 등) 네이티브 스크롤에 맡기고,
    //   스크롤할 게 없으면(맞춤 보기) 펼침면 넘기기로 동작. (스로틀 250ms)
    let lastWheel = 0;
    fdoc.addEventListener('wheel', (e) => {
      const de = fdoc.documentElement, bd = fdoc.body;
      const scrollable = (de && de.scrollHeight > de.clientHeight + 8) || (bd && bd.scrollHeight > bd.clientHeight + 8);
      if (scrollable) return; // 확대로 내용이 화면보다 크면 네이티브 스크롤(+스크롤바)
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheel < 250 || Math.abs(e.deltaY) < 4) return;
      lastWheel = now;
      try { navRef.current && navRef.current(e.deltaY > 0 ? Navigation.NEXT : Navigation.PREVIOUS); } catch (_) {}
    }, { passive: false });
    // ⌨ 키보드 페이지 이동 — ←→/PgUp·PgDn/Space = 펼침면 넘기기, Home/End = 처음/끝.
    fdoc.addEventListener('keydown', (e) => {
      if (!viewerRef.current) return;
      const k = e.key;
      const go = (d) => { e.preventDefault(); try { navRef.current && navRef.current(d); } catch (_) {} };
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') go(Navigation.NEXT);
      else if (k === 'ArrowLeft' || k === 'PageUp') go(Navigation.PREVIOUS);
      else if (k === 'Home') go(Navigation.FIRST);
      else if (k === 'End') go(Navigation.LAST);
    });
    // iframe 이 포커스를 받아야 키가 먹음 — 클릭 시 body 포커스
    try { fdoc.body.tabIndex = -1; fdoc.addEventListener('mousedown', () => { try { fdoc.body.focus(); } catch (_) {} }); } catch (_) {}
    try { iframe.contentWindow.addEventListener('resize', () => syncBodyMin(fdoc, zoomRef.current)); } catch (_) {}
    const vp = fdoc.getElementById('vp');
    const viewer = new CoreViewer({ viewportElement: vp, window: iframe.contentWindow }, {
      renderAllPages: true, pageViewMode: PageViewMode.SPREAD, fitToScreen: true, autoResize: true,
    });
    viewerRef.current = viewer;
    viewer.addListener('nav', (p) => {
      try { navFlushRef.current && navFlushRef.current(); } catch (_) {}   // 앞 이동이 끝났다 — 기다리던 이동이 있으면 이어서
      if (p && typeof p.epage === 'number') { curRef.current = Math.round(p.epage) + 1; setPageInfo((pi) => ({ ...pi, cur: Math.round(p.epage) + 1 })); }
    });
    viewer.addListener('readystatechange', () => {
      if (viewer.readyState === 'complete') {
        const total = Math.max(0, (viewer.getPageSizes() || []).length);
        setPageInfo((pi) => ({ ...pi, total }));
        setPreviewBusy(false); setStatus(`조판 완료 — 내지 ${total}쪽`);
        try { fdoc.body.style.zoom = zoomRef.current; syncBodyMin(fdoc, zoomRef.current); } catch (_) {}
        alignSingleSpreads(fdoc); // 홀로 있는 페이지(첫 쪽·마지막 홀수쪽)를 펼침면과 같은 위치(오른쪽/왼쪽)에 고정
        // 쪽수가 **서버가 아는 값과 다를 때만** 보고한다(책등·규격 재계산 · 같은 값이면 재렌더 회피).
        //   예전엔 「이전에 보고한 값」과 비교해서, 🆕 초기화 뒤 같은 원고를 다시 열면(조판 쪽수가 똑같아) 보고가 건너뛰어져 서버 쪽수가 0 으로 남았다 →
        //   「총 ?쪽 · 책등 0mm · 쪽수 미확정 · 표지 치수 불일치」 가 조판이 끝나도 사라지지 않았다(로이 2026-10-03 빨간머리앤 369쪽).
        if (total > 0 && total !== dtoPagesRef.current) {
          lastPagesRef.current = total;
          api.bookReportPages({ pages: total }).then((d) => { if (d) setDto(d); }).catch(() => {});
        }
      }
    });
    viewer.loadDocument(previewUrl, {}, {});
  }, [previewUrl]);

  // 🎯 가운데 정렬용 — body 가 줌 배율만큼 줄어 보이므로 최소 높이를 (창 높이 ÷ 배율)로 두어 #vp 의 auto 마진이 세로 가운데를 만든다(-2px: 반올림으로 생기는 가짜 스크롤 방지)
  function syncBodyMin(fdoc, z) {
    try { const w = fdoc.defaultView; fdoc.body.style.minHeight = Math.max(0, w.innerHeight / (z || 1) - 2) + 'px'; } catch (_) {}
  }
  // 홀로 놓인 페이지를 펼침면 좌/우 자리에 정렬 — recto(홀수쪽)는 오른쪽 자리, verso 는 왼쪽 자리.
  function alignSingleSpreads(fdoc) {
    try {
      fdoc.querySelectorAll('[data-vivliostyle-spread-container]').forEach((sc) => {
        const pages = sc.querySelectorAll('[data-vivliostyle-page-container]');
        if (pages.length !== 1) return;
        const p = pages[0];
        const side = p.getAttribute('data-vivliostyle-page-side');
        const w = p.offsetWidth;
        if (side === 'right') { p.style.marginLeft = w + 'px'; p.style.marginRight = ''; }
        else if (side === 'left') { p.style.marginRight = w + 'px'; p.style.marginLeft = ''; }
      });
    } catch (_) {}
  }
  // 🔍 돋보기(줌) — CSS zoom 은 스크롤 크기까지 함께 조정됨(Chromium)
  const zoomRef = useRef(1);
  const [zoomPct, setZoomPct] = useState(100);
  function applyZoom(z) {
    z = Math.min(4, Math.max(0.3, z));
    zoomRef.current = z; setZoomPct(Math.round(z * 100));
    try {
      const fdoc = viewportRef.current && viewportRef.current.contentDocument;
      if (fdoc && fdoc.body) { fdoc.body.style.zoom = z; syncBodyMin(fdoc, z); alignSingleSpreads(fdoc); }
    } catch (_) {}
  }
  // ⛶ 맞춤 — 펼침면 높이를 뷰포트 높이에 맞춤
  function fitZoom() {
    try {
      const iframe = viewportRef.current; const fdoc = iframe.contentDocument;
      const page = fdoc.querySelector('[data-vivliostyle-page-container]');
      if (!page) return;
      const cur = zoomRef.current || 1;
      const pageH = page.getBoundingClientRect().height / cur;
      if (pageH > 10) applyZoom((iframe.clientHeight - 28) / pageH);
    } catch (_) {}
  }

  // ── 문단 클릭 → 편집 ── (iframe 내부 click 리스너가 ref 를 통해 항상 최신 핸들러 호출)
  const onPreviewClick = useCallback(async (e) => {
    // 📖 책 밖(회색 바탕) 클릭 = 쪽 넘기기 — 왼쪽 절반 = 이전 · 오른쪽 절반 = 다음 (로이 2026-10-01). 쪽(page container) 안을 누른 클릭·글자 드래그 뒤의 클릭은 제외.
    {
      const t = e.target;
      const inPage = !!(t && t.closest && t.closest('[data-vivliostyle-page-container], [data-src-line]'));
      const sel = e.view && e.view.getSelection && e.view.getSelection();
      if (!inPage && !(sel && !sel.isCollapsed)) {
        const w = (e.view && e.view.innerWidth) || 1;
        try { navRef.current && navRef.current(e.clientX < w / 2 ? Navigation.PREVIOUS : Navigation.NEXT); } catch (_) {}
        return;
      }
    }
    const el = e.target && e.target.closest && e.target.closest('[data-src-line]');
    if (!el) return;
    const lineStart = parseInt(el.getAttribute('data-src-line'), 10);
    const lineEnd = parseInt(el.getAttribute('data-src-end') || el.getAttribute('data-src-line'), 10);
    if (isNaN(lineStart)) return;
    try {
      // 원본 파일 기준 줄 텍스트 — 다중 파일 원고(필수파일+회차)에서도 정확한 파일·줄로 역매핑
      const r = await api.bookGetLines({ lineStart, lineEnd });
      if (!r) return;
      setEdit({ lineStart, lineEnd, text: r.text, file: r.file });
    } catch (err) { logline('원고 읽기 오류: ' + err.message); }
  }, []);
  const onPreviewClickRef = useRef(onPreviewClick);
  onPreviewClickRef.current = onPreviewClick;

  async function saveEdit() {
    if (!edit) return;
    try {
      const d = await api.bookApplyEdit(edit);
      if (d) setDto(d);
      setEdit(null); setStatus('수정 저장됨 — 재조판 중…');
    } catch (e) { logline('수정 저장 오류: ' + e.message); }
  }

  // 생성(빌드) 중 경과 시간 — 중앙 진행 모달 표시용
  const [buildMsg, setBuildMsg] = useState('');
  const [buildElapsed, setBuildElapsed] = useState(0);
  useEffect(() => {
    if (!building) { setBuildElapsed(0); return; }
    const t0 = Date.now();
    const t = setInterval(() => setBuildElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, [building]);

  // ── 액션 ──
  // 📕 종이책(POD 입고: 내지+표지 PDF) / 📱 전자책(화면 읽기용 PDF 한 파일) — 같은 원고, 판만 다르다
  async function buildPdf(edition, quiet) {
    const ebook = edition === 'ebook';
    setBuilding(true);
    setBuildMsg(ebook ? '📱 전자책 PDF 생성 중 — 표지 1쪽 + 본문' : '📕 종이책 PDF 생성 중 — 내지 조판 + 표지');
    setStatus(ebook ? '전자책 PDF 생성 중…' : 'PDF 생성 중… (내지 조판 + 표지)');
    try {
      const r = await api.bookBuildPdf({ layout, edition: ebook ? 'ebook' : 'print', noOpen: !!quiet });
      if (r && r.dto) setDto(r.dto);
      setStatus(r && !r.error
        ? (ebook ? `전자책 PDF 완료 — ${r.pages || '?'}쪽`
          : (r.coverError ? `⚠ 내지 ${r.pages}쪽 완료 · 표지 실패 — 로그 확인` : `종이책 PDF 완료 — 내지 ${r.pages}쪽${r.coverPdf ? ' + 표지' : ''}`))
        : 'PDF 실패 — 로그 확인');
    } catch (e) { logline('PDF 오류: ' + e.message); }
    setBuilding(false); refreshOutputs();
  }
  // 🤖 사이트 자동 입력 — 열린 크롬에서 로그인(직접) → 입력·파일 첨부까지 → 멈춤(저장·제출은 직접)
  async function runRegister(platform, only) {
    const eb = platform === 'ebook';   // 📘 부크크 새전자책(화면 탭 id 'ebook' → IPC 'bookk-ebook')
    const bk = platform === 'bookk' || eb;
    // (시작 확인창은 없앴다 — 로이 2026-10-02 「자동 입력 눌렀을 때 나오는 프라이밍 자체 팝업은 제거」)
    setRegBusy(true); setStatus('🤖 ' + (bk ? '부크크' : '작가와') + ' 자동 입력 중 — 열린 크롬 창에서 로그인해 주세요');
    try {
      const r = await api.bookRegisterRun({ platform: eb ? 'bookk-ebook' : platform, only });
      if (!r || r.error) { setStatus('⚠ 자동 입력 실패: ' + ((r && r.error) || '알 수 없음')); }
      else {
        setStatus(r.ok ? '✅ 자동 입력 완료 — 크롬 창에서 확인하고 저장·제출은 직접 하세요' : '⚠ 일부 칸 실패: ' + (r.failed || []).join(', '));
        if ((r.manual || []).length) logline('📤 직접 해야 할 것: ' + r.manual.join(' · '));
      }
    } catch (e) { logline('자동 입력 오류: ' + e.message); setStatus('⚠ 자동 입력 오류 — 로그 확인'); }
    setRegBusy(false);
    try { const pr = await api.bookRegisterPaperPrice({}); if (pr && pr.ok) setPaperPrice(pr); } catch (_) {}   // 종이책 4단계가 정가를 기록했을 수 있다
  }
  // ✔ ePub 규격 검증(EPUBCheck) — 결과는 점검표(전자책)에 반영. ePub 을 다시 만들면 지운다.
  const [epubChk, setEpubChk] = useState(null);
  const [epubChkBusy, setEpubChkBusy] = useState(false);
  async function runEpubCheckUi() {
    setEpubChkBusy(true); setStatus('✔ ePub 검증 중…');
    try {
      const r = await api.bookEpubCheck({});
      setEpubChk(r || { error: '응답 없음' });
      setStatus(!r || r.error ? '⚠ ePub 검증 실패: ' + ((r && r.error) || '') : r.missing ? 'ℹ 이 PC 에는 EPUBCheck 도구가 없습니다' : (r.ok ? `✅ ePub 규격 통과 (EPUB ${r.epubVersion})` : `⚠ ePub 오류 ${r.nFatal + r.nError}개 — 점검표 아래 목록 확인`));
    } catch (e) { setEpubChk({ error: e.message }); }
    setEpubChkBusy(false);
  }
  async function buildEpubFile(quiet) {
    setEpubChk(null);
    setBuilding(true); setBuildMsg('📱 ePub 생성 중'); setStatus('ePub 생성 중…');
    try {
      const r = await api.bookBuildEpub({ noOpen: quiet === true });
      if (r && r.dto) setDto(r.dto);
      setStatus(r && !r.error ? 'ePub 완료 — 출력폴더 확인' : 'ePub 실패 — 로그 확인');
      if (r && !r.error) { setBuilding(false); await runEpubCheckUi(); }   // 만든 직후 규격 검증까지가 한 세트(도구 없는 PC 는 건너뜀)
    } catch (e) { logline('ePub 오류: ' + e.message); }
    setBuilding(false); refreshOutputs();
  }
  // 📱 전자책 미리보기 — 부크크에 올라가는 실제 ePub 을 임시로 만들어 문서(spine)를 차례로 보여 주고 사전 점검을 돌린다
  async function loadEbookDoc(docs, n) {
    const d = docs[n - 1]; if (!d) return;
    const r = await api.bookEbookDoc({ href: d.href });
    setEb((s) => ({ ...s, n, html: r && r.html ? r.html : '', error: r && r.error ? r.error : '' }));
  }
  async function refreshEbook() {
    setEb((s) => ({ ...s, busy: true, error: '' }));
    try {
      const r = await api.bookEbookPreview({});
      if (!r || r.error) { setEb((s) => ({ ...s, busy: false, error: (r && r.error) || '응답 없음' })); return; }
      setEb({ busy: false, error: '', docs: r.docs, checks: r.checks, n: 1, html: '', version: r.version, bytes: r.bytes, forPath: (dto && dto.scriptPath) || '' });
      await loadEbookDoc(r.docs, 1);
    } catch (e) { setEb((s) => ({ ...s, busy: false, error: e.message })); }
  }
  useEffect(() => {
    if (viewMode === 'ebook' && dto && dto.kind === 'book' && !eb.busy && eb.forPath !== dto.scriptPath) refreshEbook();
  }, [viewMode, dto && dto.scriptPath]);
  // 📚 큐 전체 만들기 — 큐의 권마다 종이책(내지·표지 PDF) 또는 전자책(ePub → 검증) 중 고른 한 판만 차례로(한 권이 실패해도 다음 권으로). 각 권의 결과는 로그에도 남는다.
  async function buildQueue(edition) {   // 'print' = 종이책만 · 'ebook' = 전자책만 (ISBN 이 달라 따로)
    if (building) return;
    const n = queue && queue.items ? queue.items.length : 0;
    const what = edition === 'ebook' ? '전자책(ePub → 검증)' : '종이책(내지·표지 PDF)';
    setBuilding(true); setBuildMsg(`📚 큐 ${n}권 ${what} 만드는 중 (시간이 걸립니다)`);
    setStatus(`📚 큐 ${n}권 ${what} 만드는 중… (진행은 로그 확인)`);
    try {
      const r = await api.bookBuildQueue({ layout, edition });
      if (r && r.queue && setQueue) setQueue(r.queue);
      if (r && r.dto) setDto(r.dto);
      const res = (r && r.results) || [];
      const ok = res.filter((x) => (edition === 'ebook' ? x.epub : x.pdf)).length;
      const fitBad = res.filter((x) => x.coverFit && !x.coverFit.ok);
      setStatus(r && r.error ? '⚠ ' + r.error : `📚 큐 ${ok}/${res.length}권 완료${ok < res.length ? ' — 실패한 권은 로그 확인' : ''}${fitBad.length ? ` · ⚠ 표지 치수 불일치 ${fitBad.length}권(${fitBad.map((x) => x.file.replace(/\.md$/i, '')).join(', ')})` : ''}`);
      const coverLabel = (x) => (!x.cover ? '✗' : !x.coverFit ? '✓(이미지 없음·치수 미확인)' : x.coverFit.ok ? '✓' : `⚠치수(${x.coverFit.imgW}×${x.coverFit.imgH}px ≠ 기대 ${x.coverFit.expW}×${x.coverFit.expH}px${x.coverFit.flapHint ? ' · 날개 ' + (x.coverFit.flapHint === 'file-has-flaps' ? '포함 파일' : '없는 파일') : ''})`);
      res.forEach((x) => logline(edition === 'ebook'
        ? `${x.epub ? '✅' : '⚠'} ${x.file} — ePub ${x.epub ? '✓' : '✗'}${x.check ? ' · 검증 ' + x.check : ''}${x.error ? ' · ' + x.error : ''}`
        : `${x.pdf && !(x.coverFit && !x.coverFit.ok) ? '✅' : '⚠'} ${x.file} — 내지 ${x.pdf ? x.pages + '쪽' : '실패'} · 표지 ${coverLabel(x)}${x.error ? ' · ' + x.error : ''}`));
    } catch (e) { logline('큐 만들기 오류: ' + e.message); setStatus('⚠ 큐 만들기 오류 — 로그 확인'); }
    setBuilding(false); refreshOutputs();
  }
  // 구조 패널 체크박스 — 원고에 있는 섹션은 "포함/제외"만 토글(원고 보존),
  //   원고에 없는 섹션을 체크하면 템플릿을 원고에 삽입.
  async function toggleSection(key, on, present) {
    if (present) {
      const ex = new Set(layout.excluded || []);
      if (on) ex.delete(key); else ex.add(key);
      L('excluded', [...ex]); // layout 변경 → contentSig 로 자동 재조판
      setStatus(on ? '섹션 포함' : '섹션 제외 (원고에는 남아 있음 — 다시 체크하면 복원)');
      return;
    }
    if (on) {
      const d = await api.bookToggleSection({ key, on: true });
      if (d) setDto(d);
    }
  }
  // 본문 장 포함/제외 — 원고(.md)는 그대로 두고 출력에서만 뺀다. 키는 `ch:<제목>`.
  //   §0 진행 현황·체크리스트처럼 원고에는 있어야 하지만 인쇄물에는 없어야 하는 장에 쓴다.
  function toggleChapter(title, on) {
    const key = 'ch:' + String(title || '').trim();
    const ex = new Set(layout.excluded || []);
    if (on) ex.delete(key); else ex.add(key);
    L('excluded', [...ex]);
    setStatus(on ? '장 포함' : '장 제외 (원고에는 남아 있음 — 다시 체크하면 복원)');
  }
  async function setMeta(key, value) {
    if ((meta[key] || '') === value) return;
    const d = await api.bookSetMeta({ key, value });
    if (d) setDto(d);
  }
  // 입력칸용 처리기 — 치는 중엔 0.4초 쉴 때 저장, 칸을 벗어나면 바로 저장(+ 다듬은 값 다시 표시). fix = 저장 전 값 다듬기(기본 trim)
  //   타이머 안의 setMeta 는 옛 렌더의 meta 를 보므로 「이미 저장한 값」은 따로 기억한다(liveSaved).
  const liveSaved = useRef({});
  const liveSave = async (k, v) => {
    const prev = k in liveSaved.current ? liveSaved.current[k] : (meta[k] || '');
    if (prev === v) return;
    liveSaved.current[k] = v;
    const d = await api.bookSetMeta({ key: k, value: v });
    if (d) setDto(d);
  };
  const liveMeta = (k, fix, fixOnBlur) => ({
    onChange: (e) => {
      const v = e.target.value; clearTimeout(liveTimers.current[k]);
      liveTimers.current[k] = setTimeout(() => liveSave(k, fix ? fix(v) : v.trim()), 400);
    },
    onBlur: async (e) => {
      const v = e.target.value; clearTimeout(liveTimers.current[k]);
      await liveSave(k, (fixOnBlur || fix) ? (fixOnBlur || fix)(v) : v.trim());
      delete liveSaved.current[k];
      setFieldRev((r) => r + 1);
    },
  });
  async function attachCover() { const d = await api.bookAttachCover(); if (d) setDto(d); }
  async function clearCover() { const d = await api.bookClearCover(); if (d) setDto(d); }

  // ISBN 바코드 — main 이 SVG 저장, 렌더러가 PNG(300dpi 상당)로도 변환 저장.
  async function exportBarcode() {
    try {
      const r = await api.bookExportBarcode();
      if (!r || r.error) { setStatus(r ? r.error : '바코드 생성 실패'); return; }
      const png = await svgToPngDataUrl(r.svg, r.widthPx * 2, r.heightPx * 2); // 2배(≈600px 폭) 고해상
      const sv = await api.bookSaveAsset({ name: `ISBN바코드_${r.isbn13}.png`, dataUrl: png });
      if (sv && sv.error) { setStatus('⚠ 바코드 PNG 저장 실패: ' + sv.error); return; }
      setStatus('ISBN 바코드 저장 (SVG+PNG) — 표지 뒷면 오른쪽 하단에 배치하세요');
    } catch (e) { logline('바코드 오류: ' + e.message); }
  }
  // 표지 가이드 PNG — 300dpi 실치수 캔버스에 재단선/책등/날개 구분선 + 치수 라벨.
  async function exportCoverGuide() {
    try {
      const sp = dto.spread;
      if (!sp || !sp.parts) { setStatus('⚠ 스프레드 정보 없음 — 미리보기 조판을 먼저 해주세요'); return; }
      if (!(dto.lastPages > 0)) { setStatus('⚠ 쪽수 미확정(책등 0mm) — 미리보기/PDF 로 쪽수를 확정한 뒤 가이드를 만드세요'); return; }
      const mmToPx = (mm) => Math.round((mm / 25.4) * 300);
      const W = mmToPx(sp.widthMm), H = mmToPx(sp.heightMm);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, W, H); // 투명 배경 — 캔바 등에서 레이어로 얹기
      const font = (px) => { ctx.font = `${px}px sans-serif`; };
      // 구분선(파란 점선) + 라벨
      ctx.strokeStyle = '#1976d2'; ctx.fillStyle = '#1976d2'; ctx.lineWidth = 3;
      ctx.setLineDash([18, 14]);
      let xMm = 0;
      for (let i = 0; i < sp.parts.length; i++) {
        const part = sp.parts[i];
        const x0 = mmToPx(xMm);
        if (i > 0) { ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, H); ctx.stroke(); }
        font(54); ctx.textAlign = 'center';
        const cx = mmToPx(xMm + part.mm / 2);
        if (part.name !== 'bleed') {
          ctx.fillText(part.name, cx, Math.round(H * 0.5));
          font(40); ctx.fillText(`${part.mm}mm`, cx, Math.round(H * 0.5) + 56);
        }
        xMm += part.mm;
      }
      // 재단선(빨강 실선) — 사방 bleed 안쪽
      const bl = mmToPx(3);
      ctx.setLineDash([]); ctx.strokeStyle = '#d32f2f'; ctx.lineWidth = 3;
      ctx.strokeRect(bl, bl, W - bl * 2, H - bl * 2);
      // 안전선(초록 점선) — 재단선 안쪽 5mm
      const sf = mmToPx(3 + (sp.safeMm || 5));
      ctx.setLineDash([12, 10]); ctx.strokeStyle = '#2e7d32'; ctx.lineWidth = 2;
      ctx.strokeRect(sf, sf, W - sf * 2, H - sf * 2);
      // 상단 안내
      ctx.setLineDash([]); ctx.fillStyle = '#d32f2f'; ctx.textAlign = 'left'; font(44);
      ctx.fillText(`표지 스프레드 ${sp.widthMm}×${sp.heightMm}mm = ${W}×${H}px @300dpi · 빨강=재단선 · 초록=안전선(글자 금지 바깥)`, sf + 10, sf + 60);
      const sv = await api.bookSaveAsset({ name: '표지가이드.png', dataUrl: cv.toDataURL('image/png') });
      if (sv && sv.error) { setStatus('⚠ 표지 가이드 저장 실패: ' + sv.error); return; }
      setStatus(`표지 가이드 저장 — ${W}×${H}px. 이 위에 디자인하고 가이드 레이어는 지우세요`);
    } catch (e) { logline('표지 가이드 오류: ' + e.message); }
  }
  // ⏮ ◀ ▶ ⏭ — 표지 화면이 맨 앞이다: ⏮ = 표지 · 표지에서 ▶ = 1쪽 · 1쪽에서 ◀ = 표지
  // 🧭 뷰어 이동은 **한 번에 하나씩** — 앞 이동(표지에서 ▶ = 1쪽으로 FIRST)이 끝나기 전에 NEXT 를 부르면 Vivliostyle 가 아직 위치가 없어
  //   `moveTo … Cannot read properties of null (reading 'spineIndex')` 를 던지고 그 이동이 사라졌다(빌드 직후 첫 실행·빠른 연타에서 화살표가 안 넘어가던 원인).
  //   'nav' 이벤트가 오면 다음 이동을 이어서 실행하고, 이벤트가 안 오는 이동(맨 끝 등)은 1.2초 뒤 풀어 준다. 대기는 마지막 요청 하나만.
  const goNav = (dir) => {
    const v = viewerRef.current; if (!v) return;
    if (navBusyRef.current) { navPendRef.current = dir; return; }
    navBusyRef.current = true;
    clearTimeout(navTimerRef.current); navTimerRef.current = setTimeout(() => { if (navFlushRef.current) navFlushRef.current(); }, 1200);
    try { v.navigateToPage(dir); } catch (_) { navBusyRef.current = false; }
  };
  navFlushRef.current = () => {
    navBusyRef.current = false; clearTimeout(navTimerRef.current);
    const d = navPendRef.current; navPendRef.current = null;
    if (d != null) setTimeout(() => goNav(d), 0);
  };
  const nav = (dir) => {
    const hasCover = !!coverRef.current;
    try {
      if (dir === Navigation.FIRST) { if (hasCover) { setShowCover(true); return; } goNav(dir); return; }
      if (showCoverRef.current) {
        if (dir === Navigation.NEXT) { setShowCover(false); goNav(Navigation.FIRST); }
        else if (dir === Navigation.LAST) { setShowCover(false); goNav(Navigation.LAST); }
        return;
      }
      if (dir === Navigation.PREVIOUS && hasCover && curRef.current <= 1) { setShowCover(true); return; }
      goNav(dir);
    } catch {}
  };
  navRef.current = nav;

  if (!loaded) {
    return (
      <div className="bkwrap" ref={wrapRef}>
        <div className="bkside"><div className="bkbody"><div className="meta">원고를 열면 메뉴(구조 · 책 정보 · 판권 · 표지 · 조판 · 종이책 · 전자책)가 나타납니다.</div></div><div className="bklog">{logBox}</div></div>
        <div className="bkcenter"><div className="bkempty">
          <h2>📖 출판 — MD 원고 → 종이책 · 전자책</h2>
          <p>상단 <b>「📖 원고 열기」</b>로 원고(.md)를 불러오세요 (여러 파일 선택 가능).</p>
          <p>처음이라면 <b>「📄 작성 가이드」</b>로 샘플 원고를 저장하세요 — 규약 설명이 주석으로 들어 있는 살아있는 예시라, 복사해서 내용만 바꾸면 바로 책이 됩니다.</p>
          <p className="meta">
            핵심 규칙: <code># 책제목</code>(맨 위 한 번) + <code>&gt; 저자: …</code> 책 정보 + <code>## [서문]</code> 같은 대괄호 = 부속물(헌사·목차·판권·뒷표지 글…) +
            대괄호 없는 <code>## 1장. 제목</code> = 본문 장. 종이책은 규격에 맞는 내지/표지 PDF, 전자책은 ePub(EPUB 2.0)을 만듭니다.
          </p>
        </div></div>
      </div>
    );
  }

  const presentKeys = new Set([...(dto.front || []), ...(dto.back || []), ...(dto.covers || [])].map((s) => s.key));
  const missing = REQUIRED_KEYS.filter(([k]) => !(k === 'title' ? (meta.title || dto.fileTitle) : meta[k]));
  const missSet = new Set(missing.map(([k]) => k));
  const spread = dto.spread || {};
  const cpAlignMeta = /하단|아래|bottom/i.test(String(meta.colophonAlignMeta || '')) ? 'bottom' : /상단|위|top/i.test(String(meta.colophonAlignMeta || '')) ? 'top' : '';   // 원고 메타 「판권정렬」 이 화면 값을 이긴다(안 비추면 실제와 다르게 보인다 — 로이 2026-10-02)
  const hdrEvenMeta = HK.headerKindOf(meta.headerEven), hdrOddMeta = HK.headerKindOf(meta.headerOdd);   // 원고 메타가 UI 값을 이긴다(삼국지 R12)
  const chapters = (dto.parts || []).flatMap((p) => p.chapters);
  const pf = (dto.platforms || []).find((p) => p.id === dto.platformId);

  // 📤 점검표 입력 — 두 플랫폼 공통 컨텍스트
  const rgCtx = {
    meta, fileTitle: dto.fileTitle, pages: dto.lastPages || 0, trimId: dto.trimId, paperId: dto.paperId, flaps: dto.flaps,
    spread, spineMm: spread.spineMm, coverImagePath: dto.coverImagePath, coverCheck: dto.coverCheck,
    outputs, excluded: layout.excluded || [], presentKeys: [...presentKeys], confirmed, epubCheck: epubChk,
  };
  const lists = { bookk: RG.checklist('bookk', rgCtx), ebook: RG.checklist('ebook', rgCtx) };
  const badge = {
    info: ['title', 'author'].filter((k) => missSet.has(k)).length,
    colophon: COLO_REQ.filter(([k]) => missSet.has(k)).length,
    bookk: RG.blocking(lists.bookk) + RG.blocking(lists.ebook),   // 종이책 + 전자책 막히는 필수 항목 합
  };

  // ── 작은 부품(함수로 호출 — 컴포넌트로 만들면 렌더마다 새로 마운트돼 입력칸 초점을 잃는다) ──
  // 🔢 ISBN · 발행일 상자(2026-10-06 로이 — 부크크 「판권지 수정 요청: 발행일·ISBN 을 고쳐 원고를 다시 보내라」) — 종이책·전자책 따로.
  //   판권 탭과 📤 부크크 등록 탭이 **같은 상자**를 쓴다(칸이 두 벌이 되지 않게). 칸을 벗어나면 원고(.md) 메타에 바로 저장 → 판권에 반영.
  //   ISBN 은 체크 숫자까지 확인한다(틀린 번호를 판권·바코드에 싣지 않게) · 발행일은 판권 라벨 그대로(예: 발행일 2026-10-06).
  const isbnBox = (idp) => {
    // 🔢 ISBN·발행일 칸은 회색 자리표시를 두지 않는다 — 값이 들어 있는 것으로 착각한다(로이 2026-10-06)
    // 🔢 맨 위 세 칸(로이 2026-10-06 — 「전자책 ISBN · 종이책 ISBN · 발행일」 을 다른 칸과 같은 모양으로) — 칸을 벗어나면 원고 메타에 저장.
    //   ISBN 은 체크 숫자가 틀릴 때만 빨간 경고 · 발행일은 「2026년 10월 06일」 모양으로 바로잡아 저장(2026-10-06 으로 적어도 됨).
    //   전자책 발행일(`> 전자책발행일:`)은 원고 메타로만 — 부크크는 종이책·전자책 발행일을 따로 묻지 않는다.
    const bad = (v) => { const t = String(v || '').trim(); return t && !ISBNC.normalizeIsbn13(t); };
    const one = (k, label, ph, isDate) => (
      <label key={k}>
        <span>{label}</span>
        <input type="text" data-testid={idp + '-' + k} placeholder={ph || ''} defaultValue={meta[k] || ''}
          key={dto.scriptPath + ':' + idp + ':' + k + ':' + fieldRev} {...(isDate ? liveMeta(k, null, (v) => DK.normalizeMeta(v)) : liveMeta(k))} />
        {!isDate && bad(meta[k]) ? <span className="bkisbn-bad" data-testid={idp + '-' + k + '-bad'}>⚠ ISBN 체크 숫자가 맞지 않습니다 — 번호를 다시 확인하세요</span> : null}
      </label>
    );
    return (
      <div className="bkisbn" data-testid={idp + '-box'}>
        {one('ebookIsbn', '전자책 ISBN')}
        {one('isbn', '종이책 ISBN')}
        {one('issueDate', '발행일', '', true)}
      </div>
    );
  };
  // 판권 탭 입력칸 — 라벨 + 칸만(필수/선택 배지 없음). 칸을 벗어나면 원고 메타에 저장.
  const cpField = (k, label) => (
    <label key={k}>
      <span>{label}</span>
      <input type="text" data-testid={'bk-cp-' + k} defaultValue={meta[k] || ''} key={dto.scriptPath + ':cp:' + k + ':' + fieldRev} {...liveMeta(k)} />
    </label>
  );
  // 고지문(`[판권]` 섹션의 `* …` 줄) — 칸마다 저장(빈 칸은 줄이 사라진다) · 줄 추가/삭제
  const cpNotes = (dto && dto.colophonNotes) || [];
  const noteDraft = [...cpNotes, ...Array.from({ length: noteExtra }, () => '')];
  const saveNotes = async (list) => { const d = await api.bookColophonNotes({ notes: list }); if (d) setDto(d); };
  const saveNote = (i, v) => { const list = noteDraft.slice(); list[i] = String(v || ''); if (list.filter(Boolean).join('\u0001') !== cpNotes.join('\u0001')) saveNotes(list); };
  const delNote = (i) => { setNoteRev((r) => r + 1); if (i >= cpNotes.length) { setNoteExtra((n) => Math.max(0, n - 1)); return; } const list = cpNotes.slice(); list.splice(i, 1); saveNotes(list); };
  const addNote = () => setNoteExtra((n) => n + 1);
  const field = (k, label, req, help) => (
    <label key={k} className={req && missSet.has(k) ? 'bkmiss' : ''} title={help || ''}>
      <span>{label} <em className={'bkbadge ' + (req ? 'req' : 'opt')}>{req ? '필수' : '선택'}</em></span>
      <input type="text" defaultValue={k === 'title' ? (meta.title || dto.fileTitle || '') : (meta[k] || '')}
        key={dto.scriptPath + ':' + k + ':' + fieldRev} {...liveMeta(k)} />
      {help ? <span className="meta">{help}</span> : null}
    </label>
  );
  const select = (k, label, opts, req, help) => (
    <label key={k} title={help || ''}>
      <span>{label} <em className={'bkbadge ' + (req ? 'req' : 'opt')}>{req ? '필수' : '선택'}</em></span>
      <select value={meta[k] || ''} onChange={(e) => setMeta(k, e.target.value)}>
        {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
      {help ? <span className="meta">{help}</span> : null}
    </label>
  );
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(String(text)); setStatus(`📋 복사됨 — ${what}`); }
    catch (_) { setStatus('⚠ 복사 실패 — 직접 선택해서 복사하세요'); }
  };

  // 📤 부크크 등록 패널 — 종이책·전자책 통합(로이 2026-10-03): 자동 입력(맨 위) → 만들기 → 완성 파일 → 올리기 전 점검 → 종이책/전자책 점검표·옮겨 적을 값
  const registerPanel = () => {
    const stIcon = { ok: '✅', todo: '⬜', manual: '☐', info: '·' };
    const row = (it) => (
      <div className={'bkchk st-' + it.state} key={it.id}>
        {it.manual
          ? <input type="checkbox" checked={it.state === 'ok'} onChange={(e) => setConfirm(it.id, e.target.checked)} />
          : <span className="bkic">{stIcon[it.state]}</span>}
        <div className="bkchk-body">
          <div className="bkchk-t">{it.label}{it.tab && it.state !== 'ok' && !it.manual
            ? <button className="bklink" onClick={() => setTab(it.tab)}>이동 ›</button> : null}</div>
          {it.hint ? <div className="meta">{it.hint}</div> : null}
        </div>
      </div>
    );
    const doneOf = (l) => l.required.filter((i) => i.state === 'ok').length;
    const outs = (outputs || []).filter((o) => o.kind === 'interior' || o.kind === 'cover' || o.kind === 'epub');
    const checklistBlock = (platform, title) => {
      const list = lists[platform];
      const rows = RG.summary(platform, rgCtx);
      const d = doneOf(list), n = list.required.length;
      return (
        <details className="bkplat" data-testid={'bk-reg-' + platform} open={d < n}>
          <summary><b>{title}</b> <span className={d === n ? 'bkok' : ''}>필수 {d}/{n}</span></summary>
          <div className="bkzone">필수</div>
          {list.required.map(row)}
          <div className="bkzone">선택 · 참고</div>
          {list.optional.map(row)}
          <div className="bkzone">등록 화면에 옮겨 적을 값 <span className="meta">(클릭 = 복사)</span></div>
          <div className="bksum">
            {rows.map(([k, v]) => (
              <button key={k} className="bksum-row" disabled={!v} title={v ? '클릭하면 복사' : '아직 값이 없습니다'} onClick={() => copy(v, k)}>
                <span>{k}</span><b>{v || '—'}</b>
              </button>
            ))}
          </div>
        </details>
      );
    };
    const links = []; const seen = new Set();
    [...(RG.LINKS.bookk || []), ...(RG.LINKS.ebook || [])].forEach(([t, u]) => { if (!seen.has(u)) { seen.add(u); links.push([t, u]); } });
    return (
      <div className="bkreg" data-testid="bk-reg">
        {isbnBox('rg')}
        {/* 1) 🤖 자동 입력 — 맨 위(로이 2026-10-03). 저장·「도서제출」은 직접 */}
        <div className="bkzone">🤖 자동 입력 <span className="meta">(로그인·「도서제출」은 직접)</span></div>
        <div className="bkauto" data-testid="bk-auto">
          <div className="bkauto-row">
            <b>📕 종이책</b>
            <button disabled={regBusy || building} data-testid="bk-register-bookk"
              title="크롬을 열어 부크크 종이책 1~5단계(책형태·원고·표지·가격·최종확인)를 채웁니다 — 로그인·도서제출은 직접. 4단계 최종정가는 기록해 전자책 정가에 씁니다"
              onClick={() => runRegister('bookk')}>{regBusy ? '⏳ 진행 중…' : '🤖 자동 입력'}</button>
            <button className="ghost" disabled={regBusy || building} data-testid="bk-register-cover"
              title="이미 열려 있는 등록용 크롬에서 3단계(표지) 화면을 찾아(3·4·5단계 어디든) 거기서부터 5단계 최종확인까지 이어서 채웁니다 — 마지막 「도서제출」은 직접 누르세요"
              onClick={() => runRegister('bookk', 'cover')}>🖼 이어 채우기</button>
          </div>
          <div className="bkauto-row">
            <b>📘 전자책</b>
            <button disabled={regBusy || building} data-testid="bk-register-ebook"
              title="크롬을 열어 부크크 새전자책 1~5단계(기본정보·ePub·표지·정가·소개)를 채웁니다 — 로그인·도서제출은 직접"
              onClick={() => runRegister('ebook')}>{regBusy ? '⏳ 진행 중…' : '🤖 자동 입력'}</button>
            <button className="ghost" disabled={regBusy || building} data-testid="bk-register-ebook-resume"
              title="이미 열려 있는 등록용 크롬의 전자책 화면(1~5단계 어디든)에서 지금 단계부터 5단계 최종확인까지 이어서 채웁니다 — 「도서제출」은 직접 누르세요"
              onClick={() => runRegister('ebook', 'cover')}>📘 이어 채우기</button>
          </div>
          <div className="meta bknote">항상 <b>종이책을 먼저</b> 등록하세요 — 4단계에서 읽은 종이책 최종정가의 70%(10원 단위 버림)가 전자책 정가가 됩니다.</div>
        </div>
        <div className="bkprice" data-testid="bk-paper-price-row">
          <div className="bkprice-head">💰 종이책 정가 <span className="meta">전자책 정가 = 이 값의 70%(10원 단위 버림)</span></div>
          <div className="bkprice-row">
            <input type="number" step="100" min="0" placeholder={paperPrice && paperPrice.paper ? String(paperPrice.paper) : '예) 17900'} value={paperPriceIn} onChange={(e) => setPaperPriceIn(e.target.value)} data-testid="bk-paper-price-in" title="종이책을 앱 자동 입력으로 신청했다면 4단계 최종정가가 자동 기록됩니다 — 그렇지 않은 경우 여기에 종이책 정가를 적어 두세요" />
            <span className="meta">원</span>
            <button className="ghost" disabled={!paperPriceIn} data-testid="bk-paper-price-save" onClick={async () => { const r = await api.bookRegisterPaperPrice({ set: paperPriceIn }); if (r && r.ok) { setPaperPrice(r); setPaperPriceIn(''); setStatus(`💾 종이책 정가 기록 — 전자책 정가 ${r.ebook.toLocaleString('ko-KR')}원`); } else setStatus('⚠ ' + ((r && r.error) || '저장 실패')); }}>저장</button>
          </div>
          <div className="meta bkprice-info" data-testid="bk-paper-price-info">{paperPrice && paperPrice.paper ? `종이책 ${paperPrice.paper.toLocaleString('ko-KR')}원(${paperPrice.source === 'record' ? '기록' : '원고'}) → 전자책 ${paperPrice.ebook.toLocaleString('ko-KR')}원` : '종이책 정가를 모르면 전자책 4단계에서 멈춥니다'}</div>
          {paperPrice && !paperPrice.price && (paperPrice.others || []).length > 0 && (
            <div className="bkprice-others" data-testid="bk-paper-price-others">
              <span className="meta">이 권은 기록이 없습니다 · 다른 권 기록 →</span>
              {paperPrice.others.map((o) => (
                <button key={o.key} className="ghost" title={`${o.key} 에 기록된 종이책 정가를 이 권에도 씁니다(권마다 쪽수가 다르면 정가가 다를 수 있으니 확인하세요)`}
                  onClick={async () => { const r = await api.bookRegisterPaperPrice({ set: o.price }); if (r && r.ok) { setPaperPrice(r); setStatus(`💾 종이책 정가 ${o.price.toLocaleString('ko-KR')}원 기록 — 전자책 ${r.ebook.toLocaleString('ko-KR')}원`); } }}>
                  {o.key.replace(/^.*_/, '')} {o.price.toLocaleString('ko-KR')}원 쓰기
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 2) 📦 만들기 — 종이책과 전자책은 ISBN·판권·정가가 달라 따로 만든다(로이 2026-10-07: 「한 번에 만들기」 폐기) */}
        <div className="bkzone">📦 만들기</div>
        <div className="bkactions">
          <button disabled={building || epubChkBusy} data-testid="bk-pdf-print" title="종이책(POD) 입고용 — 내지.pdf + 표지.pdf (책등·재단여백 포함, 판권은 종이책 ISBN·정가)" onClick={() => buildPdf('print')}>{building ? '⏳ 생성 중…' : '📕 종이책 만들기'}</button>
          <button disabled={building || epubChkBusy} data-testid="bk-epub" title="부크크 전자책용 ePub(EPUB 2.0 · 한자 글꼴 동봉) 생성 + 규격 검증 — 판권은 전자책 ISBN. 표지는 전자책표지 메타·표지 도구의 전자책앞표지.jpg·인쇄 표지 앞면 순" onClick={() => buildEpubFile()}>{building ? '⏳ 생성 중…' : '📱 전자책 만들기'}</button>
        </div>
        <div className="bkactions bkbuild">
          <button className="ghost" disabled={building || epubChkBusy} data-testid="bk-epubcheck" title="W3C EPUBCheck 로 EPUB 2.0.1 규격 오류를 찾습니다 — 도구가 있는 PC 에서만" onClick={runEpubCheckUi}>{epubChkBusy ? '⏳ 검증 중…' : '✔ ePub 검증'}</button>
          <button className="ghost" disabled={building} data-testid="bk-pdf-ebook" title="참고용 — 전자책 PDF 한 파일(1쪽 앞표지 + 본문). 부크크 전자책은 ePub 을 올립니다" onClick={() => buildPdf('ebook')}>📄 전자책 PDF</button>
        </div>
        {epubChk && epubChk.messages && epubChk.messages.length > 0 && (
          <div className="bkfit warn" data-testid="bk-epubcheck-msgs">
            <b>EPUBCheck 메시지 {epubChk.messages.length}개</b>
            {epubChk.messages.slice(0, 8).map((m, i) => <div className="meta" key={i}>{m.severity} {m.where} — {m.message}</div>)}
          </div>
        )}
        <div className="bkzone">완성 파일</div>
        {outs.length ? outs.map((o) => (
          <div className="bkfile" key={o.name}>
            <span title={o.path}>📄 {o.name}</span>
            <span className="meta">{(o.bytes / 1024 / 1024).toFixed(1)}MB</span>
            <button className="ghost" onClick={() => api.bookRevealFile(o.path)}>위치</button>
          </div>
        )) : <div className="meta">아직 없습니다 — 위 버튼으로 만드세요</div>}

        {/* 3) 🔎 올리기 전 점검(한 번) */}
        <div className="bkzone">🔎 올리기 전 점검 <button className="bklink" onClick={loadPf} title="다시 점검">↻</button></div>
        {pfx ? (
          <div className="bkpf" data-testid="bk-preflight">
            <div className={'bkpf-sum ' + (pfx.ready ? 'ok' : 'bad')}>
              {pfx.ready ? '✅ 막히는 항목 없음' : `⛔ 고쳐야 할 것 ${pfx.summary.error}개`}{pfx.summary.warn ? ` · ⚠ 확인 ${pfx.summary.warn}개` : ''}
            </div>
            {pfx.items.filter((i) => i.state !== 'ok' || i.id === 'pages' || i.id === 'cover').map((i) => (
              <div className={'bkpf-row st-' + i.state} key={i.id}>
                <span className="bkic">{{ ok: '✅', warn: '⚠', error: '⛔', info: 'ℹ' }[i.state]}</span>
                <div className="bkchk-body">
                  <div className="bkchk-t">{i.label}{i.tab && i.state !== 'ok' ? <button className="bklink" onClick={() => setTab(i.tab)}>이동 ›</button> : null}</div>
                  <div className="meta">{i.detail}</div>
                </div>
              </div>
            ))}
            <details className="meta"><summary>통과한 항목 {pfx.items.filter((i) => i.state === 'ok').length}개</summary>
              {pfx.items.filter((i) => i.state === 'ok').map((i) => <div key={i.id}>✅ {i.label} — {i.detail}</div>)}
            </details>
          </div>
        ) : <div className="meta">점검 중…</div>}

        {/* 4) 종이책·전자책 점검표 + 옮겨 적을 값(펼치고 접기) */}
        {checklistBlock('bookk', '📕 종이책 점검표')}
        {checklistBlock('ebook', '📱 전자책 점검표')}

        <div className="bklinks">
          {links.map(([t, u]) => <button key={u} className="ghost" title={u} onClick={() => api.bookOpenPlatform(u)}>🌐 {t}</button>)}
          <button className="ghost" onClick={() => api.openFolder()}>📁 출력폴더</button>
        </div>
        <div className="meta bknote">
          종이책: 심사 2~3일 · 승인 후 「승인확인」→ 표지·내지 다운로드 검토 → 「최종 입점」. 이때부터 수정 제약이 큽니다(개정판: 20쪽↑ 6개월 · 미만 1년). 전자책: 승인·유통 절차와 소요 기간은 첫 권을 올리며 확인해 채웁니다 🔒.
          {' '}조사 {RG.REVIEWED} · 정책은 자주 바뀌니 등록 직전에 공식 페이지를 다시 확인하세요.
        </div>
      </div>
    );
  };

  // ── 왼쪽 탭 내용 ──
  const sideBody = (() => {
    switch (tab) {
      case 'structure': return (<>
        <div className="bkzone">앞부속</div>
        <label className="chk"><input type="checkbox" checked={!/^(off|no|없음|아니오|false|0|x)$/i.test(String(meta.halfTitle || 'on'))}
          onChange={(e) => setMeta('halfTitle', e.target.checked ? '' : '없음')} /> 반표제지 <span className="meta">(자동)</span></label>
        <label className="chk"><input type="checkbox" checked disabled /> 속표지 <span className="meta">(자동)</span></label>
        {(dto.reserved || []).filter((r) => r.zone === 'front').map((r) => <SectionChk key={r.key} r={r} presentKeys={presentKeys} layout={layout} toggleSection={toggleSection} />)}
        <div className="bkzone">본문 — 장 {chapters.length}개</div>
        {titleFit && (() => {
          const f = titleFit, bad = f.count.header + f.count.toc3 + f.count.max;
          return (
            <div className={'bkfit' + (bad ? ' warn' : '')} data-testid="bk-titlefit" title="글꼴의 실제 글자 폭으로 잰 값입니다 — 머리글은 한 줄만 쓸 수 있어 넘치면 …로 줄어듭니다">
              📏 <b>제목 길이 기준</b>
              <div className="meta">머리글 한 줄 ≈ <b>{f.header.charsApprox}자</b>{f.header.usesFullTitle ? ' (지금 전체 회목을 머리글에 씁니다)' : ' — 지금 머리글은 전체 회목이 아니라 회목 길이와 무관'} · 목차 2줄 ≈ <b>{f.toc.chars2Approx}자</b> · 3줄 ≈ {f.toc.chars3Approx}자{f.limitChars ? <> · 원고 기준 <b>회목최대 {f.limitChars}자</b></> : null}</div>
              {bad > 0
                ? <div className="bkfit-bad">⚠ {f.count.header ? `머리글에서 잘리는 제목 ${f.count.header}개 · ` : ''}{f.count.toc3 ? `목차 4줄 이상 ${f.count.toc3}개 · ` : ''}{f.count.max ? `기준 초과 ${f.count.max}개 · ` : ''}아래 ⚠ 표시 — {f.count.header ? '머리글을 「제N회」로 바꾸거나 ' : ''}회목을 줄이세요</div>
                : <div className="bkfit-ok">✓ 모든 회목이 기준 안에 들어갑니다</div>}
              {bad === 0 && f.count.toc2 > 0 ? <div className="meta">(목차 3줄이 되는 회목 {f.count.toc2}개 — 허용 범위)</div> : null}
            </div>
          );
        })()}
        <div className="bkchapters">
          {(dto.parts || []).map((p, pi) => (
            <React.Fragment key={pi}>
              {p.title ? <div className="bkpart">{p.num ? `제${p.num}부 ` : ''}{p.title}</div> : null}
              {p.chapters.map((c) => {
                const chOn = !(layout.excluded || []).includes('ch:' + String(c.title || '').trim());
                return (
                  <label key={c.num} className="bkch chk" style={chOn ? undefined : { opacity: 0.5, textDecoration: 'line-through' }}
                    title={`문단 ${c.blocks}개 — 미리보기에서 클릭해 수정 · 체크 해제 = 책에서 제외(원고 보존)`}>
                    <input type="checkbox" checked={chOn} disabled={!c.title}
                      onChange={(e) => toggleChapter(c.title, e.target.checked)} />
                    {(() => {
                      const it = titleFit && (titleFit.items || []).find((x) => x.title === c.title);
                      const why = it && it.flags.filter((x) => x !== 'toc2').map((x) => (x === 'header' ? '머리글에서 잘림' : x === 'toc3' ? `목차 ${it.tocLines}줄` : '회목최대 초과'));
                      return why && why.length ? <span className="bkfit-badge" title={`${it.chars}자 — ${why.join(' · ')}`}>⚠ {why[0]}</span> : null;
                    })()} {c.title || `(제목 없음)`}
                  </label>
                );
              })}
            </React.Fragment>
          ))}
          {!chapters.length && <div className="meta">본문 장이 없습니다 — 원고에 <code>## 1장. 제목</code>을 추가하세요.</div>}
        </div>
        <div className="bkzone">뒷부속</div>
        {(dto.reserved || []).filter((r) => r.zone === 'back').map((r) => <SectionChk key={r.key} r={r} presentKeys={presentKeys} layout={layout} toggleSection={toggleSection} />)}
        <div className="bkzone">표지 구성 (표지 PDF)</div>
        {(dto.reserved || []).filter((r) => r.zone === 'cover').map((r) => <SectionChk key={r.key} r={r} presentKeys={presentKeys} layout={layout} toggleSection={toggleSection} cover />)}
        <div className="meta" style={{ marginTop: 8 }}>원고에 쓴 섹션·본문 장은 자동으로 체크됩니다. 체크를 해제하면 <b>원고는 그대로 두고 책에서만 제외</b>합니다 — 진행표·체크리스트 같은 작업용 장을 인쇄물에서 뺄 때 쓰세요.</div>
        {dto.footnoteCount > 0 && <div className="meta" style={{ marginTop: 8 }}>각주 {dto.footnoteCount}개 — {meta.footnoteMode === '미주' ? '미주(책 끝 모음)' : '각주(페이지 하단)'}</div>}
      </>);
      case 'info': return (<div className="bkform">
        <div className="bkzone">책의 기본 정보</div>
        {INFO_FIELDS.map(([k, l, req, help]) => field(k, l, req, help))}
        <div className="bkzone">플랫폼 등록 정보 <span className="meta">(책에는 인쇄되지 않음)</span></div>
        {REG_FIELDS.map(([k, l, help]) => field(k, l, false, help))}
        {select('printColor', '내지 색(종이책)', [['', '흑백 (기본)'], ['컬러', '컬러']], false, '부크크 인세: 사이트 흑백 35% · 컬러 15% / 외부유통 흑백 15% · 컬러 10%')}
        {select('aiDisclosure', 'AI 사용 표기(전자책)',
          [['', '— 선택 안 됨 —'], ['없음', '없음(직접 집필·번역)'], ['있음', '있음(AI 활용 — 저자명에 「AI」 표기)']], true,
          '등록 화면의 AI 사용 표기 항목(부크크 요구 여부는 로그인 뒤 확인). 정직한 표기가 안전합니다')}
        <div className="meta">값은 원고 상단 <code>&gt; 라벨: 값</code> 메타 줄로 저장됩니다.</div>
      </div>);
      case 'colophon': return (<div className="bkform" data-testid="bk-colophon-form">
        {missing.length > 0 && (
          <div className="bkwarn" title="출판문화산업진흥법상 간행물 필수 기재사항">
            ⚠ 판권 필수 미입력: {missing.map(([, l]) => l).join(' · ')}
          </div>
        )}
        {/* 📜 판권 페이지 = 아래 칸에 적은 그대로(2026-10-06 로이 「판권 내용을 이 칸들에 적으면 그대로 실리게」) — 비운 칸은 그 줄이 판권에 나오지 않는다.
            책 제목 줄(제목·부제·회차)만 책 정보에서 자동. 칸 이름은 판권에 찍히는 라벨과 같다. */}
        <div className="bkzone">📜 판권 페이지 <span className="meta">— 적은 그대로 판권에 실립니다 · 비우면 그 줄은 빠집니다</span></div>
        {isbnBox('co')}
        <div className="bkzone">책마다 달라지는 항목 <span className="meta">(책 정보와 같은 값)</span></div>
        {[['author', '지은이'], ['translator', '옮긴이'], ['editor', '편집인']].map(([k, l]) => cpField(k, l))}
        <div className="bkzone">항상 같은 항목 <span className="meta">(출판사 고정 정보)</span></div>
        {[['issuer', '발행인'], ['publisher', '발행처'], ['regNo', '등록'], ['address', '주소'], ['phone', '전화'], ['fax', '팩스'], ['email', '대표메일'], ['homepage', '홈페이지'], ['blog', '블로그'], ['facebook', '페이스북'], ['instagram', '인스타그램']].map(([k, l]) => cpField(k, l))}
        <div className="bkzone">고지문 <span className="meta">— 줄마다 한 칸 · 판권에 한 줄씩 「* …」 로 실립니다</span></div>
        <div data-testid="bk-cp-notes">
          {noteDraft.map((t, i) => (
            <div className="bknote" key={i + ':' + fieldRev + ':' + noteRev}>
              <input type="text" data-testid={'bk-cp-note-' + i} defaultValue={t} placeholder="예: 번역·기획: 고전서재의 로이"
                onChange={(e) => { const v = e.target.value; clearTimeout(liveTimers.current['note' + i]); liveTimers.current['note' + i] = setTimeout(() => saveNote(i, v), 400); }}
                onBlur={(e) => { clearTimeout(liveTimers.current['note' + i]); saveNote(i, e.target.value); setFieldRev((r) => r + 1); }} />
              <button className="ghost" title="이 줄 지우기" data-testid={'bk-cp-note-del-' + i} onClick={() => delNote(i)}>✕</button>
            </div>
          ))}
          <button className="ghost" data-testid="bk-cp-note-add" onClick={addNote}>＋ 고지문 줄 추가</button>
        </div>
        <div className="bkzone">저작권 · 안내문</div>
        <label><span>저작권(ⓒ)</span>
          <input type="text" data-testid="bk-cp-copyright" placeholder="비우면 자동 — ⓒ 이름 연도. All rights reserved." defaultValue={meta.copyright || ''}
            key={dto.scriptPath + ':copyright:' + fieldRev} {...liveMeta('copyright')} /></label>
        <label><span>재사용 안내문</span>
          <input type="text" data-testid="bk-cp-legal" placeholder={DEFAULT_LEGAL_TEXT} defaultValue={meta.legalText || ''}
            key={dto.scriptPath + ':legalText:' + fieldRev} {...liveMeta('legalText')} /></label>
        <details className="bkmore">
          <summary>그 밖의 항목 (정가 · 전자책 가격 · 부가기호 · QR · 로고)</summary>
          {COLO_OPT.filter(([k]) => ['price', 'ebookPrice', 'isbnAddon', 'logo', 'qr', 'qrLabel'].includes(k)).map(([k, l]) => field(k, l, false))}
        </details>
        <div className="bkzone">판권 페이지</div>
        <label title="판권 내용은 위 칸에 적은 줄로 조판됩니다">판권 위치
          <select value={/앞/.test(String(meta.colophonPos || '')) ? '앞' : '뒤'} onChange={(e) => setMeta('colophonPos', e.target.value === '앞' ? '앞(속표지 뒷면)' : '')}>
            <option value="뒤">맨 뒤 (한국 관행)</option><option value="앞">앞 (속표지 뒷면)</option>
          </select>
        </label>
        <label title={cpAlignMeta ? '원고 메타 `> 판권정렬:` 이 정합니다 — 바꾸려면 원고의 그 줄을 고치세요' : '판권 내용을 판면 아래쪽에 붙일지(기본), 위에서 시작할지'}>판권 배치{cpAlignMeta ? ' 🔒' : ''}
          <select value={cpAlignMeta || (layout.colophonAlign === 'top' ? 'top' : 'bottom')} disabled={!!cpAlignMeta} onChange={(e) => L('colophonAlign', e.target.value)}>
            <option value="bottom">아래 (판면 하단 · 기본)</option><option value="top">위 (판면 상단)</option>
          </select>
        </label>
      </div>);
      case 'cover': return (<div className="bkform">
        <div className="bkzone">종이책 표지 스프레드</div>
        <div className="meta bkcoverspec">
          책등 <b>{spread.spineMm}mm</b> (총 {dto.lastPages || '?'}쪽 기준)<br />
          스프레드 <b>{spread.widthMm}×{spread.heightMm}mm</b><br />
          = <b>{spread.widthPx}×{spread.heightPx}px</b> @300dpi{dto.flaps ? ' · 날개 포함' : ''}<br />
          <span title="재단 시 잘리는 영역 — 배경을 끝까지 채우세요">재단여백 3mm · 안전여백 5mm</span>
        </div>
        {dto.coverImagePath
          ? (<>
              <div className="meta" style={{ wordBreak: 'break-all' }}>🖼 {dto.coverImagePath.split(/[\\/]/).pop()}</div>
              {dto.coverCheck && !dto.coverCheck.ok && <div className="bkwarn">⚠ 치수 불일치 — 기대 {dto.coverCheck.expected.widthPx}×{dto.coverCheck.expected.heightPx}px{dto.coverCheck.flapHint ? <><br />이 파일은 날개 {dto.coverCheck.flapHint === 'file-has-flaps' ? '포함' : '없는'} 치수입니다 — <b>날개 설정을 확인하세요</b>(지금: 날개 {dto.flaps ? '있음' : '없음'})</> : null}</div>}
              {dto.coverCheck && dto.coverCheck.ok && dto.coverCheck.lowDpi && <div className="bkwarn">⚠ 해상도 낮음 (실효 {dto.coverCheck.effectiveDpi}dpi &lt; 300)</div>}
              <div className="mbtns"><button className="ghost" onClick={attachCover}>교체</button><button className="ghost" onClick={clearCover}>제거</button></div>
            </>)
          : <button onClick={attachCover}>🖼 표지 이미지 첨부 (배경)</button>}
        <label className="chk" title="배경 이미지 위에 제목·부제·저자·출판사 글자를 얹어 조판 — 완성 이미지에 글자가 이미 있으면 끄세요">
          <input type="checkbox" checked={!!layout.coverOverlay} onChange={(e) => L('coverOverlay', e.target.checked)} /> 앞표지에 제목·저자 얹기
        </label>
        <label className="chk" title="뒷표지 오른쪽 하단에 ISBN 바코드+정가 자동 배치">
          <input type="checkbox" checked={layout.coverBarcode !== false} onChange={(e) => L('coverBarcode', e.target.checked)} disabled={!meta.isbn} /> 뒷표지 바코드·정가 {!meta.isbn && <span className="meta">(ISBN 필요)</span>}
        </label>
        {(layout.coverOverlay || (dto.covers || []).length > 0) && (
          <label>표지 글자색 <input type="color" value={layout.coverTextColor || '#111111'} onChange={(e) => L('coverTextColor', e.target.value)} style={{ width: 60, padding: 0, height: 26 }} /></label>
        )}
        <label className="chk" title="부크크 무료 표지는 날개가 없고, 날개 없이 승인된 도서에 나중에 날개를 추가할 수 없습니다">
          <input type="checkbox" checked={dto.flaps} onChange={(e) => setMeta('flaps', e.target.checked ? '있음' : '없음')} /> 표지 날개 (100mm)
        </label>
        {select('coverMaterial', '표지 재질(부크크)',
          [['', RG.DEFAULT_COVER_MATERIAL + ' (기본)'], ...RG.COVER_MATERIALS.slice(1).map((m) => [m, m])], false,
          '두께·가격·표지 크기에 영향 없음(기록용). 글자가 있는 표지는 스노우 권장 · 재질 변경은 매주 금요일 무료')}
        <div className="meta">뒷표지 소개글·날개 글·책등 문구는 「구조」 탭의 「표지 구성」에 쓰면 표지 PDF 에 조판됩니다.</div>
        <div className="mbtns">
          <button className="ghost" title="재단선·책등·날개 구분선이 그려진 투명 PNG(300dpi) — 캔바 등에서 밑그림 레이어로" onClick={exportCoverGuide}>📐 표지 가이드</button>
          <button className="ghost" title="ISBN(EAN-13)+부가기호 바코드를 SVG·PNG 로 생성 — 표지 뒷면 오른쪽 하단에 배치" onClick={exportBarcode} disabled={!meta.isbn}>🏷 바코드</button>
        </div>
        <div className="bkzone">전자책 표지</div>
        {field('ebookCover', '전자책 표지 이미지 경로', false, '비우면 종이책 표지의 앞면을 자동으로 잘라 씁니다. 부크크 전자책 표지 규격(px·비율)은 로그인 뒤 화면에서 확인 필요')}
      </div>);
      case 'layout': return (<>
        <details open>
          <summary>규격 (플랫폼·판형·용지)</summary>
          <div className="bkform">
            <label>플랫폼
              <select value={dto.platformId} onChange={(e) => setMeta('platform', e.target.value === 'kyobo' ? '교보' : e.target.value === 'jakkawa' ? '작가와' : '부크크')}>
                {(dto.platforms || []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label>판형
              <select value={dto.trimId} onChange={(e) => setMeta('trim', e.target.value)}>
                {(dto.trims || []).filter((t) => !pf || pf.trims.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <label title={dto.paperLocked ? '부크크는 쪽수가 용지를 정합니다 — 399쪽까지 미색모조 100g, 400쪽부터 미색모조 80g (부크크 화면 실측)' : ''}>내지 용지
              <select value={dto.paperId} disabled={!!dto.paperLocked} data-testid="bk-paper" onChange={(e) => setMeta('paper', e.target.value)}>
                {(dto.papers || []).map((p) => <option key={p} value={p}>{p}</option>)}
                {!(dto.papers || []).includes(dto.paperId) && <option value={dto.paperId}>{dto.paperId}</option>}
              </select>
            </label>
            <label title="부크크 「새종이책」 화면이 알려 주는 책등 두께(mm)를 적으면 계산보다 이 값을 씁니다. 비우면 자동 계산(부크크: 1.6 + 0.055×쪽수, 400쪽부터 0.045)">책등 두께(mm)
              <input type="text" data-testid="bk-spine" defaultValue={dto.spineManual || ''} key={'sp:' + fieldRev + ':' + dto.paperId}
                placeholder={`자동 ${dto.spread && dto.spread.spineMm}`}
                {...liveMeta('spineMm')} />
            </label>
          </div>
        </details>
        <details open>
          <summary>본문 조판</summary>
          <div className="bkform">
            <label>본문 폰트
              <select value={layout.fontKey} onChange={(e) => L('fontKey', e.target.value)}>
                {(dto.fontOptions || []).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
            <div className="bkrow">
              <label>크기(pt) <input type="number" step="0.5" min="7" max="14" value={layout.fontSizePt} onChange={(e) => L('fontSizePt', Number(e.target.value) || 10)} /></label>
              <label title="한국 단행본 관행 = 글자 크기의 1.7~2.0배 (대표 1.8)">행간 <input type="number" step="0.05" min="1.2" max="2.5" value={layout.lineHeight} onChange={(e) => L('lineHeight', Number(e.target.value) || 1.8)} /></label>
            </div>
            <div className="bkrow">
              <label>굵기
                <select value={layout.fontWeight} onChange={(e) => L('fontWeight', Number(e.target.value))}>
                  <option value={300}>가늘게(300) — 단행본 관행</option><option value={400}>보통(400)</option><option value={700}>굵게(700)</option>
                </select>
              </label>
              <label>자간(pt) <input type="number" step="0.1" min="-2" max="2" value={layout.letterSpacingPt} onChange={(e) => L('letterSpacingPt', Number(e.target.value) || 0)} /></label>
            </div>
            <div className="bkrow">
              <label title="문단 첫 줄 들여쓰기">들여쓰기(pt) <input type="number" step="1" min="0" max="40" value={layout.indentPt} onChange={(e) => L('indentPt', Math.max(0, Number(e.target.value) || 0))} /></label>
              <label title="문단과 문단 사이 간격 — 한국 단행본 관행은 0 (들여쓰기로만 문단 구분)">문단 간격(pt) <input type="number" step="1" min="0" max="40" value={layout.paragraphSpacingPt} onChange={(e) => L('paragraphSpacingPt', Math.max(0, Number(e.target.value) || 0))} /></label>
            </div>
            <label>장 시작
              <select value={layout.chapterStart} onChange={(e) => L('chapterStart', e.target.value)}>
                <option value="recto">홀수쪽(오른쪽) — 관행</option><option value="page">다음 쪽 (분량 절약)</option>
              </select>
            </label>
            <label>각주 방식
              <select value={meta.footnoteMode === '미주' ? '미주' : '각주'} onChange={(e) => setMeta('footnoteMode', e.target.value === '미주' ? '미주' : '')}>
                <option value="각주">각주 (페이지 하단)</option><option value="미주">미주 (책 끝 모음)</option>
              </select>
            </label>
            <label title="장마다 반복되는 코너의 소제목을 쉼표로 구분해 입력하면 그 구간을 옅은 배경 노트 박스로 본문과 다르게 조판합니다">
              특별 섹션 (예: 역사 노트)
              <input type="text" value={layout.specialKeyword || ''} placeholder="반복 코너 소제목 (쉼표로 여러 개)"
                onChange={(e) => L('specialKeyword', e.target.value)} />
            </label>
            <label title="양쪽 정렬 줄의 띄어쓰기가 크게 벌어지는 것을 줄입니다. 어절 = 지금 방식(어절 단위로만 줄바꿈) · 글자 = 어절 중간에서도 끊음(간격은 고르지만 낱말이 쪼개짐) · 절충 = 어절 단위를 지키되 많이 벌어질 줄만 다음 낱말을 글자 단위로 넘김(권장 시험). 마지막 줄에 한 글자만 남지 않게 끝 두 글자를 묶습니다. 원고 메타 `> 줄바꿈: 어절|글자|절충` 이 있으면 메타가 이깁니다">
              줄바꿈{meta.lineBreak ? ' 🔒' : ''}
              <select value={({ 어절: 'word', 글자: 'char', 절충: 'smart' })[String(meta.lineBreak || '').trim()] || layout.lineBreak || 'word'} disabled={!!meta.lineBreak}
                onChange={(e) => L('lineBreak', e.target.value)}>
                <option value="word">어절 (기본)</option>
                <option value="smart">절충 — 벌어질 줄만 글자 단위</option>
                <option value="char">글자 단위</option>
              </select>
            </label>
            <div className="bkrow" title="목차 항목의 글자 크기·행간 — 비우면 본문과 같습니다. 원고 메타 `> 목차글자:` `> 목차행간:` 이 있으면 메타가 이깁니다(삼국지: 9.5pt · 1.45)">
              <label>목차 글자(pt){(meta.tocSize) ? ' 🔒' : ''} <input type="number" step="0.5" min="7" max="14" placeholder="본문과 같음" value={meta.tocSize ? meta.tocSize : (layout.tocSizePt || '')} disabled={!!meta.tocSize}
                onChange={(e) => L('tocSizePt', Number(e.target.value) || 0)} /></label>
              <label>목차 행간{(meta.tocLine) ? ' 🔒' : ''} <input type="number" step="0.05" min="1.1" max="2.5" placeholder="본문과 같음" value={meta.tocLine ? meta.tocLine : (layout.tocLineHeight || '')} disabled={!!meta.tocLine}
                onChange={(e) => L('tocLineHeight', Number(e.target.value) || 0)} /></label>
            </div>
          </div>
          <div className="bkform">
            <label className="chk" title="영상 제작용 블록(🎯 단일 아크 · 📝 주석·안전필터 · 🎨 일관성 앵커 · 🖼️ 이미지/🎬 영상 프롬프트)과 `---` 구분선을 조판에서 제외하고, 제목의 타임코드(— 0:00~0:30 · I2V 5샷)를 지웁니다. 본문 인용(성경 낭독 등)은 그대로 남습니다. 대본 파일은 수정되지 않습니다.">
              <input type="checkbox" checked={!!layout.scriptMode} onChange={(e) => L('scriptMode', e.target.checked)} />
              🎬 영상 대본 모드 (제작용 블록 숨기고 읽기)
            </label>
            {layout.scriptMode ? (
              <label className="chk" title="샷 제목(### 샷1 — …)까지 숨겨 나레이션만 줄글로 읽습니다">
                <input type="checkbox" checked={!!layout.scriptHideShots} onChange={(e) => L('scriptHideShots', e.target.checked)} />
                샷 제목도 숨기기
              </label>
            ) : null}
            <label className="chk" title="본문의 ../참고문헌/지도교수/오광만_박사논문2008_….pdf 같은 파일 경로에서 폴더를 떼고 파일명만 남깁니다. 원고는 수정되지 않습니다.">
              <input type="checkbox" checked={!!layout.hidePaths} onChange={(e) => L('hidePaths', e.target.checked)} />
              📁 작업용 파일 경로 → 파일명만
            </label>
          </div>
        </details>
        <details>
          <summary>여백 (mm)</summary>
          <div className="bkform">
            <div className="bkrow">
              <label>위 <input type="number" step="1" min="5" max="40" value={layout.marginsMm.top} onChange={(e) => Lm('top', e.target.value)} /></label>
              <label>아래 <input type="number" step="1" min="5" max="40" value={layout.marginsMm.bottom} onChange={(e) => Lm('bottom', e.target.value)} /></label>
            </div>
            <div className="bkrow">
              <label title="제본되는 안쪽(책등 쪽) — 무선제본은 파묻히므로 바깥보다 넓게">안쪽 <input type="number" step="1" min="5" max="40" value={layout.marginsMm.inner} onChange={(e) => Lm('inner', e.target.value)} /></label>
              <label>바깥 <input type="number" step="1" min="5" max="40" value={layout.marginsMm.outer} onChange={(e) => Lm('outer', e.target.value)} /></label>
            </div>
            <div className="meta">기본 20/15/20/17 — 안쪽≥바깥이 무선제본 관행입니다. 부크크 권고: 중요한 내용은 끝선에서 10~15mm 안쪽.</div>
          </div>
        </details>
        <details>
          <summary>머리글 · 쪽번호</summary>
          <div className="bkform">
            <div className="bkrow">
              <label title={hdrEvenMeta ? '원고 메타 `> 머리글짝수:` 가 정합니다 — 바꾸려면 원고의 그 줄을 고치세요' : ''}>짝수쪽 머리글{hdrEvenMeta ? ' 🔒' : ''}
                <select value={hdrEvenMeta || layout.headerEven} disabled={!!hdrEvenMeta} onChange={(e) => L('headerEven', e.target.value)}>
                  <option value="title">책 제목 (관행)</option><option value="subtitle">책 부제</option>
                  <option value="chapter">장 제목</option><option value="section">소제목(절)</option>
                  <option value="none">표시 안 함</option>
                </select>
              </label>
              <label>정렬
                <select value={layout.headerEvenAlign} onChange={(e) => L('headerEvenAlign', e.target.value)}>
                  <option value="left">왼쪽(바깥) — 관행</option><option value="center">가운데</option><option value="right">오른쪽</option>
                </select>
              </label>
            </div>
            <div className="bkrow">
              <label title={hdrOddMeta ? '원고 메타 `> 머리글홀수:` 가 정합니다 — 바꾸려면 원고의 그 줄을 고치세요' : ''}>홀수쪽 머리글{hdrOddMeta ? ' 🔒' : ''}
                <select value={hdrOddMeta || layout.headerOdd} disabled={!!hdrOddMeta} onChange={(e) => L('headerOdd', e.target.value)}>
                  <option value="chapter">장 제목 (관행)</option><option value="chapterShort">「제N회 + 짧은 제목」(원고 `> 짧은제목:`)</option><option value="chapterNo">「제N회」만 (긴 회목용)</option><option value="section">소제목(절)</option>
                  <option value="title">책 제목</option><option value="subtitle">책 부제</option>
                  <option value="none">표시 안 함</option>
                </select>
              </label>
              <label>정렬
                <select value={layout.headerOddAlign} onChange={(e) => L('headerOddAlign', e.target.value)}>
                  <option value="right">오른쪽(바깥) — 관행</option><option value="center">가운데</option><option value="left">왼쪽</option>
                </select>
              </label>
            </div>
            <label className="chk"><input type="checkbox" checked={layout.headerLine} onChange={(e) => L('headerLine', e.target.checked)} /> 머리글 아래 구분선</label>
            <label>쪽번호
              <select value={layout.pageNum} onChange={(e) => L('pageNum', e.target.value)}>
                <option value="outer">바깥 하단 (관행)</option><option value="center">하단 가운데</option><option value="none">표시 안 함</option>
              </select>
            </label>
            <div className="meta">표제지·판권·백면·장 시작 페이지에는 자동으로 표시되지 않습니다.</div>
          </div>
        </details>
        <details>
          <summary>소제목(##) 스타일</summary>
          <div className="bkform">
            <div className="bkrow">
              <label>크기(pt) <input type="number" step="0.5" min="8" max="18" value={layout.h2SizePt} onChange={(e) => L('h2SizePt', Number(e.target.value) || 10.5)} /></label>
              <label>굵기
                <select value={layout.h2Weight} onChange={(e) => L('h2Weight', Number(e.target.value))}>
                  <option value={500}>중간(500)</option><option value={700}>굵게(700)</option>
                </select>
              </label>
            </div>
            <div className="bkrow">
              <label>정렬
                <select value={layout.h2Align} onChange={(e) => L('h2Align', e.target.value)}>
                  <option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option>
                </select>
              </label>
              <label title="소제목 앞에 붙는 장식 문자 — 비우면 없음">장식 <input type="text" value={layout.h2Prefix} style={{ width: 50 }} onChange={(e) => L('h2Prefix', e.target.value)} /></label>
            </div>
            <div className="bkrow">
              <label>위 여백(pt) <input type="number" step="1" min="0" max="60" value={layout.h2MarginTopPt} onChange={(e) => L('h2MarginTopPt', Math.max(0, Number(e.target.value) || 0))} /></label>
              <label>아래 여백(pt) <input type="number" step="1" min="0" max="40" value={layout.h2MarginBottomPt} onChange={(e) => L('h2MarginBottomPt', Math.max(0, Number(e.target.value) || 0))} /></label>
            </div>
            <label className="chk"><input type="checkbox" checked={layout.h2Gothic} onChange={(e) => L('h2Gothic', e.target.checked)} /> 고딕체 사용 (해제 시 본문 폰트)</label>
          </div>
        </details>
      </>);
      case 'bookk': return registerPanel();
      default: return null;
    }
  })();

  return (
    <div className="bkwrap" ref={wrapRef}>
      {/* 생성 진행 모달 — 화면 중앙, 경과 시간 표시 */}
      {building && (
        <div className="modal-bg show" style={{ zIndex: 90 }}>
          <div className="modal-card" style={{ width: 400, textAlign: 'center' }}>
            <div className="spin" style={{ width: 38, height: 38, border: '4px solid #eee', borderTopColor: 'var(--accent)', borderRadius: '50%', margin: '0 auto 14px', animation: 'spin 1s linear infinite' }} />
            <div style={{ fontWeight: 700, color: 'var(--strong)', marginBottom: 6 }}>{buildMsg || '생성 중…'}</div>
            <div className="meta">내지 조판(Vivliostyle)은 원고 길이에 따라 수 분 걸릴 수 있습니다 · 경과 {buildElapsed}초</div>
          </div>
        </div>
      )}
      {/* ── 왼쪽: 메뉴 + 내용 + (맨 아래) 로그 ── */}
      <div className="bkside" data-testid="bk-side">
        {queue && queue.items && queue.items.length >= 2 && (
          <div className="bkqueue" data-testid="bk-queue">
            <div className="bkqueue-head">
              <b>📚 큐 {queue.items.length}권</b>
              <button disabled={building || epubChkBusy} data-testid="bk-build-queue-print" title="큐의 모든 권을 차례로 종이책(내지·표지 PDF)만 만듭니다 — 한 권이 실패해도 다음 권으로 넘어가고, 끝나면 지금 보던 권으로 돌아옵니다" onClick={() => buildQueue('print')}>📕 큐 종이책 만들기</button>
              <button disabled={building || epubChkBusy} data-testid="bk-build-queue-ebook" title="큐의 모든 권을 차례로 전자책(ePub → 규격 검증)만 만듭니다 — 한 권이 실패해도 다음 권으로 넘어가고, 끝나면 지금 보던 권으로 돌아옵니다" onClick={() => buildQueue('ebook')}>📱 큐 전자책 만들기</button>
            </div>
            <div className="bkqueue-chips">
              {queue.items.map((it) => (
                <span key={it.id} className={'bkq' + (it.active ? ' on' : '')} data-testid="bk-queue-chip" title={it.file || it.title} onClick={() => { if (!it.active && !building && onSelectQueue) onSelectQueue(it.id); }}>
                  {(it.file || it.title || '').replace(/\.md$/i, '')}
                  <i title="큐에서 빼기(파일은 그대로)" onClick={(e) => { e.stopPropagation(); if (!building && onRemoveQueue) onRemoveQueue(it.id); }}>✕</i>
                </span>
              ))}
            </div>
          </div>
        )}
        <nav className="bknav" data-testid="bk-nav">
          {TABS.map(([id, ic, name]) => (
            <button key={id} data-tab={id} className={'bktab' + (tab === id ? ' on' : '')} onClick={() => setTab(id)} title={name}>
              <span className="bkti">{ic}</span><span>{name}</span>
              {badge[id] > 0 ? <em className="bkcnt" title={`아직 끝나지 않은 필수 항목 ${badge[id]}개 — 탭을 열어 확인하세요`}>{badge[id]}</em> : null}
            </button>
          ))}
        </nav>
        <div className="bkstatus">
          총 <b>{dto.lastPages || '?'}쪽</b> · 책등 <b>{spread.spineMm}mm</b> · {dto.trimId}
          {pf && dto.lastPages > 0 && dto.lastPages < pf.minPages ? <span className="bkwarn"> ⚠ 최소 {pf.minPages}쪽</span> : null}
        </div>
        <div className="bkbody" key={tab}>{sideBody}</div>
        <div className="bklog">{logBox}</div>
      </div>

      {/* ── 오른쪽: 실제 페이지 미리보기 ── */}
      <div className="bkcenter">
        <div className="bkmode" data-testid="bk-viewmode">
          <button className={'bkmodebtn' + (viewMode === 'paper' ? ' on' : '')} data-testid="bk-view-paper" onClick={() => setViewMode('paper')} title="종이책 내지(조판) 미리보기">📕 종이책</button>
          <button className={'bkmodebtn' + (viewMode === 'ebook' ? ' on' : '')} data-testid="bk-view-ebook" onClick={() => setViewMode('ebook')} title="부크크에 올라가는 실제 ePub 을 만들어 문서 순서대로 보여 주고 부크크 점검 항목을 확인합니다">📱 전자책</button>
          {viewMode === 'ebook' && <span className="meta">리플로우 ePub — 쪽번호 대신 「문서 n / N」</span>}
        </div>
        {viewMode === 'ebook' && (
          <div className="bkebook" data-testid="bk-ebook">
            <div className="bkbar">
              <button className="ghost" disabled={eb.n <= 1 || eb.busy} onClick={() => loadEbookDoc(eb.docs, 1)} title="첫 문서(표지)">⏮</button>
              <button className="ghost" disabled={eb.n <= 1 || eb.busy} onClick={() => loadEbookDoc(eb.docs, eb.n - 1)} title="이전 문서">◀</button>
              <span className="bkpage" data-testid="bk-eb-pos">{eb.docs.length ? `문서 ${eb.n} / ${eb.docs.length}` : '—'}</span>
              <button className="ghost" disabled={eb.n >= eb.docs.length || eb.busy} onClick={() => loadEbookDoc(eb.docs, eb.n + 1)} title="다음 문서">▶</button>
              <button className="ghost" disabled={eb.n >= eb.docs.length || eb.busy} onClick={() => loadEbookDoc(eb.docs, eb.docs.length)} title="마지막 문서">⏭</button>
              <select value={eb.n} disabled={eb.busy || !eb.docs.length} onChange={(e) => loadEbookDoc(eb.docs, Number(e.target.value))} style={{ maxWidth: 260 }}>
                {eb.docs.map((d) => <option key={d.n} value={d.n}>{d.n}. {d.title}</option>)}
              </select>
              <span className="grow" />
              <span className="meta">{eb.busy ? '⏳ ePub 만드는 중…' : (eb.docs.length ? `EPUB ${eb.version} · ${(eb.bytes / 1048576).toFixed(1)}MB` : '')}</span>
              <button className="ghost" disabled={eb.busy} onClick={refreshEbook} title="원고를 다시 읽어 ePub 을 새로 만듭니다">🔄 전자책 갱신</button>
            </div>
            {eb.error && <div className="bkwarn" style={{ padding: '6px 10px' }}>⚠ {eb.error}</div>}
            {eb.checks.length > 0 && (() => {
              const bad = eb.checks.filter((c) => c.level !== 'ok');
              return (
                <details className="bkeb-checks" data-testid="bk-eb-checks" open={bad.length > 0} key={eb.forPath + ':' + bad.length}>
                  <summary data-testid="bk-eb-sum">{bad.length ? `⚠ 부크크 전자책 점검 — 확인할 것 ${bad.length}개` : `✅ 부크크 전자책 점검 ${eb.checks.length}/${eb.checks.length} 통과`}</summary>
                  {eb.checks.map((c) => (
                    <div key={c.id} className={'bkeb-chk ' + c.level} data-testid={'bk-eb-chk-' + c.id} data-level={c.level}>{c.level === 'ok' ? '✅' : c.level === 'warn' ? '⚠' : '❌'} {c.text}</div>
                  ))}
                </details>
              );
            })()}
            <iframe className="bkeb-frame" title="전자책 미리보기" data-testid="bk-eb-frame" sandbox="" srcDoc={eb.html} />
          </div>
        )}
        <div style={{ display: viewMode === 'paper' ? 'contents' : 'none' }}>
        <div className="bkbar">
          <button className="ghost" onClick={() => nav(Navigation.FIRST)} title="첫 페이지">⏮</button>
          <button className="ghost" onClick={() => nav(Navigation.PREVIOUS)} title="이전 펼침면">◀</button>
          <span className="bkpage" title={cover ? '맨 앞 화면 = 표지 펼침면(미리보기 전용 — 내지 PDF 에는 들어가지 않습니다)' : ''}>{showCover && cover ? '표지' : (pageInfo.cur > 0 ? pageInfo.cur : '–')} / {pageInfo.total || '–'}쪽</span>
          <button className="ghost" onClick={() => nav(Navigation.NEXT)} title="다음 펼침면">▶</button>
          <button className="ghost" onClick={() => nav(Navigation.LAST)} title="마지막 페이지">⏭</button>
          <input type="range" title="페이지 빠른 이동(드래그)" min={cover ? 0 : 1} max={Math.max(1, pageInfo.total || 0)} value={cover && showCover ? 0 : Math.max(1, pageInfo.cur || 1)}
            style={{ width: 150 }} onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (cover && v <= 0) { setShowCover(true); return; }
              setShowCover(false);
              try { viewerRef.current && viewerRef.current.navigateToPage(Navigation.EPAGE, Math.max(1, v) - 1); } catch (_) {}
            }} />
          <span className="hdiv" />
          <button className="ghost" onClick={() => applyZoom(zoomRef.current / 1.2)} title="축소">🔍−</button>
          <span className="meta" style={{ minWidth: 42, textAlign: 'center' }}>{zoomPct}%</span>
          <button className="ghost" onClick={() => applyZoom(zoomRef.current * 1.2)} title="확대">🔍＋</button>
          <button className="ghost" onClick={() => applyZoom(1)} title="원래 크기">1:1</button>
          <button className="ghost" onClick={fitZoom} title="펼침면 높이를 화면에 맞춤">⛶ 맞춤</button>
          <span className="grow" />
          <span className="meta">{previewBusy ? '⏳ 조판 중…' : '글 클릭=수정 · 책 밖 좌/우 클릭·‹ ›·휠/←→=넘기기 · 확대 시 휠=스크롤'}</span>
          <button className="ghost" onClick={refreshPreview} title="원고를 다시 조판">🔄 미리보기 갱신</button>
        </div>
        <div className="bkstage">
          <iframe className="bkviewport" ref={viewportRef} title="페이지 미리보기" />
          {previewBusy && (() => {
            const prev = lastPagesRef.current || pageInfo.total || 0;   // 지난 조판 쪽수 = 대략의 목표
            const pct = prev > 0 && prog.pages > 0 ? Math.min(99, Math.round(prog.pages / prev * 100)) : 0;
            const slow = prog.sec >= 120;
            const label = previewPhase === 'html' ? '① 원고를 조판 문서로 만드는 중' : '② 페이지 나누는 중 (글꼴·줄바꿈·목차 계산)';
            return (
              <div className={'bkprog' + (slow ? ' slow' : '')} data-testid="bk-prog">
                <div className="bkprog-top">
                  <b>⏳ 조판 중</b>
                  <span>{label}</span>
                  <span className="grow" />
                  <span>경과 {Math.floor(prog.sec / 60)}분 {String(prog.sec % 60).padStart(2, '0')}초</span>
                </div>
                <div className={'bkprog-bar' + (pct ? '' : ' indet')}><i style={pct ? { width: pct + '%' } : undefined} /></div>
                <div className="bkprog-sub">
                  {previewPhase === 'layout' && (prog.pages > 0 ? `지금까지 ${prog.pages}쪽 배치됨${prev ? ` / 지난 조판 ${prev}쪽 (${pct}%)` : ''}` : '첫 쪽을 기다리는 중…')}
                  {slow && <> · <b>오래 걸립니다</b> — 원고가 길거나 멈췄을 수 있어요. <button className="ghost" onClick={refreshPreview}>🔄 다시 조판</button> · 계속 안 되면 로그창을 확인하세요</>}
                </div>
              </div>
            );
          })()}
          {/* 화면 양쪽 끝 넘기기 화살표(로이 2026-10-01) — 표지 화면에서도 같은 nav(표지 ↔ 1쪽) */}
          <button className="bknavarrow left" data-testid="bk-prev" title="이전 쪽 (←) — 책 밖 왼쪽을 눌러도 됩니다" onClick={() => nav(Navigation.PREVIOUS)}>‹</button>
          <button className="bknavarrow right" data-testid="bk-next" title="다음 쪽 (→) — 책 밖 오른쪽을 눌러도 됩니다" onClick={() => nav(Navigation.NEXT)}>›</button>
          {cover && showCover && (() => {
            const sp = cover.spread, k = coverFit, Wpx = sp.widthMm * 3.7795, Hpx = sp.heightMm * 3.7795;
            let x = 0; const bounds = []; const regions = [];
            for (const part of sp.parts) { regions.push({ ...part, x }); x += part.mm; if (part.name !== 'bleed') bounds.push(x); }
            bounds.pop();   // 맨 끝(재단 안쪽)은 재단선이 따로 그린다
            const flapFolds = regions.filter((r) => r.name === '뒷날개' || r.name === '앞날개');
            const spine = regions.find((r) => r.name === '책등');
            return (
              <div className="bkcover" ref={coverBoxRef} tabIndex={0} data-testid="bk-cover"
                onKeyDown={(e) => { if (['ArrowRight', 'PageDown', ' ', 'End', 'ArrowDown'].includes(e.key)) { e.preventDefault(); nav(e.key === 'End' ? Navigation.LAST : Navigation.NEXT); } }}
                onWheel={(e) => { if (e.deltaY > 0) nav(Navigation.NEXT); }}>
                <div className="bkcover-top">
                  <b>🖼 표지 펼침면</b>
                  <span className="meta">{cover.kind === 'composed' ? '원고 [뒷표지]·[앞날개]… 로 조판한 표지' : `첨부 표지${cover.fileName ? ' — ' + cover.fileName : ''}${cover.kind === 'image+text' ? ' + 원고 표지 문구' : ''}`} · {sp.widthMm}×{sp.heightMm}mm · 책등 {sp.spineMm}mm · 날개 {cover.flaps ? '있음' : '없음'}</span>
                  <span className="grow" />
                  <label className="chk"><input type="checkbox" checked={coverLines} onChange={(e) => setCoverLines(e.target.checked)} /> 책등·접힘선·재단선</label>
                  <button className="ghost" onClick={() => nav(Navigation.NEXT)} title="내지 1쪽으로">내지 보기 ▶</button>
                </div>
                {cover.warnings && cover.warnings.length > 0 && (
                  <div className="bkcover-warns">{cover.warnings.map((w, i) => <div key={i} className="bkwarn" data-testid="bk-cover-warn">⚠ {w}</div>)}</div>
                )}
                <div className="bkcover-canvas" ref={coverCanvasRef}>
                  <div className="bkcover-sheet" style={{ width: Wpx * k, height: Hpx * k }}>
                    <iframe className="bkcover-frame" title="표지 펼침면" srcDoc={cover.html} scrolling="no"
                      style={{ width: Wpx, height: Hpx, transform: `scale(${k})`, transformOrigin: '0 0' }} />
                    {coverLines && (
                      <svg className="bkcover-lines" viewBox={`0 0 ${sp.widthMm} ${sp.heightMm}`} preserveAspectRatio="none">
                        <rect x="3" y="3" width={sp.widthMm - 6} height={sp.heightMm - 6} fill="none" stroke="#d32f2f" strokeWidth="0.35" strokeDasharray="2 1.5" opacity="0.7" />
                        {spine && <rect x={spine.x} y="0" width={spine.mm} height={sp.heightMm} fill="#2a6fb0" opacity="0.10" />}
                        {bounds.map((bx, i) => <line key={i} x1={bx} y1="0" x2={bx} y2={sp.heightMm} stroke="#2a6fb0" strokeWidth="0.3" strokeDasharray="3 2" opacity="0.65" />)}
                        {regions.filter((r) => r.name !== 'bleed').map((r) => (
                          <text key={r.name} x={r.x + r.mm / 2} y={sp.heightMm - 4} fontSize="3.6" textAnchor="middle" fill="#2a6fb0" opacity="0.8">{r.name}</text>
                        ))}
                        {spine && <text x={spine.x + spine.mm / 2} y="9" fontSize="3.4" textAnchor="middle" fill="#2a6fb0" fontWeight="700">{spine.mm}mm</text>}
                        {flapFolds.map((r) => <text key={'f' + r.name} x={r.x + r.mm / 2} y="9" fontSize="3.2" textAnchor="middle" fill="#2a6fb0" opacity="0.85">{r.name} 접힘 {r.mm}mm</text>)}
                      </svg>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
        </div>
        {edit && (
          <div className="bkedit">
            <div className="meta">{edit.file ? `${edit.file} — ` : '원고 '}수정 후 저장하면 원본 .md 에 반영되고 재조판됩니다</div>
            <textarea value={edit.text} rows={Math.min(8, edit.text.split('\n').length + 1)}
              onChange={(e) => setEdit({ ...edit, text: e.target.value })} autoFocus />
            <div className="mbtns">
              <button onClick={saveEdit}>저장</button>
              <button className="ghost" onClick={() => setEdit(null)}>취소</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
