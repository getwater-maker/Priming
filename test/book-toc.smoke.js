'use strict';
/**
 * node test/book-toc.smoke.js — 삼국지 R12(글꼴 폴백 · 머리글) · R14(목차) 실조판 검증 (v0.5.109)
 *   같은 원고를 실제 PDF 로 굽고 **mupdf 로 줄·글자 위치·글꼴 이름을 읽어** 확인한다(CSS 문자열 검사만으로는 줄바꿈·정렬을 못 본다).
 *   ① R14 목차: 「제N회」 라벨 칸 + 회목 칸(내어쓰기) · 점선+쪽번호는 마지막 줄 · 양쪽 정렬로 벌어지지 않음 · 항목이 쪽 경계에서 안 쪼개짐 · 쪽번호 = 실제 쪽
 *   ② R12 머리글: 어떤 회목 길이에서도 한 줄(nowrap+말줄임) · 원고 메타 `> 머리글홀수:`/`> 머리글짝수:` 가 UI 값을 이김
 *   ③ R12 글꼴: 龔·劭·褚·隗 은 동봉 Noto Serif KR(Light)로 · 누락 글리프(槳·傕·慎)는 목록에서 찾아 경고
 *   🔎 판별력: 옛 방식(양쪽 정렬 · baseline · nowrap 없음)으로 되돌린 A/B 빌드에서는 같은 단언이 실패해야 한다.
 * mupdf 는 @vivliostyle/cli 의 하위 의존성(dev 검증 전용). 임시 폴더만 쓴다(output/_book-toc).
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { parseBookText } = require('../core/parsers/book-parser');
const { buildBookHtml } = require('../core/book/html-builder');
const { buildInteriorPdf, prepareWorkAssets } = require('../core/book/pdf-builder');
const G = require('../core/book/glyph-check');
const HB = require('../core/book/html-builder');
const FD = path.join(__dirname, '..', 'assets', 'fonts', 'book');

const OUT = path.join(__dirname, '..', 'output', '_book-toc');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const TITLES = ['복숭아밭 잔치에서 세 호걸이 의형제를 맺고, 황건적을 베어 처음으로 공을 세우다',
  '장익덕이 대노하여 독우를 매질하고, 하진이 환관을 죽이려다 도리어 화를 입다',
  '동탁이 황제를 폐하고 진류왕을 세우며, 조조는 칼을 바쳐 동탁을 찌르려다 도망하다',
  '조조가 격문을 천하에 돌려 제후들을 모으고, 세 영웅이 힘을 합쳐 여포와 싸우다',
  '금궐을 불태우고 옥새를 숨긴 손견이 맹세를 저버리고, 원소는 군사를 물려 돌아가다',
  '왕윤이 연환계를 쓰고 동탁을 도모하니, 여포가 봉의정에서 노하여 창을 던지다',
  '이각과 곽사가 장안을 어지럽히고, 천자는 동쪽으로 옮겨 가며 갖은 고초를 겪다',
  '짧은 회목',
  '조맹덕이 서주를 쳐서 부친의 원수를 갚고, 유현덕은 북해 공융의 구원을 받다',
  '여봉선이 복양에서 조조를 크게 무찌르고 진궁이 계책을 올려 세력을 넓히다',
  '제갈량이 초가집에서 나와 세 번째 방문에 응하며 천하삼분의 계책을 내놓다',
  '관운장이 홀로 천 리를 달려 다섯 관문을 지나며 여섯 장수를 베다',
  '적벽에서 불길이 하늘을 덮으니 조조의 백만 대군이 장강 위에서 재가 되어 사라지다'];
// 1회는 일부러 아주 길게(80자 넘게) — 머리글 한 줄 안전망을 본다
TITLES[0] = TITLES[0] + ' 그리고 이어서 천하의 영웅들이 하나둘 모여들어 큰 뜻을 세우게 되었다';
const para = '조식은 붓을 들어 이렇게 적었다. 천하의 일은 합쳐지면 나뉘고 나뉘면 다시 합쳐진다는 말이 있다.';
const chapters = TITLES.map((t, i) => `## 제${i + 1}회 ${t}\n${(para + '\n\n').repeat(i < 3 ? 30 : 6)}각주가 있는 문장[^${i + 1}]입니다.\n\n[^${i + 1}]: 오기를 보이는 각주의 槳 한 글자와 傕 그리고 龔·劭·褚·隗·慎 이다.\n`).join('\n');
const mdOf = (extraMeta) => `# 삼국지연의 완역 1\n> 저자: 나관중\n> 출판사: 고전서재\n> 판형: A5\n${extraMeta || ''}\n## [목차]\n\n## 1부. 도원결의\n\n${chapters}\n`;

async function build(name, md, { tweak, opts } = {}) {
  const book = parseBookText(md, name);
  const workDir = path.join(OUT, name + '_work');
  const assets = prepareWorkAssets(workDir);
  let { html } = buildBookHtml(book, { imageUrl: assets.imageUrl, fontCss: assets.fontCss, ...(opts || {}) });
  if (tweak) html = tweak(html);
  const pdf = path.join(OUT, name + '.pdf');
  const r = await buildInteriorPdf({ html, outPdf: pdf, workDir, log: () => {} });
  if (!r.success) throw new Error(name + ' 빌드 실패: ' + r.error);
  const mu = await import(pathToFileURL(path.join(__dirname, '..', 'node_modules', 'mupdf', 'dist', 'mupdf.js')).href);
  const doc = mu.Document.openDocument(fs.readFileSync(pdf), 'application/pdf');
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const p = doc.loadPage(i);
    const st = p.toStructuredText('preserve-whitespace');
    const lines = []; let cur = null;
    st.walk({
      beginLine(bbox) { cur = { y0: bbox[1], y1: bbox[3], x0: bbox[0], x1: bbox[2], t: '', chars: [] }; },
      onChar(c, origin, font, size, quad) { cur.t += c; cur.chars.push({ c, x: origin[0], size, font: font.getName(), q: quad }); },
      endLine() { lines.push(cur); cur = null; },
    });
    pages.push({ n: i + 1, lines, text: lines.map((l) => l.t).join(' ').replace(/\s+/g, ' ').trim() });
  }
  return { pages, html };
}
const squash = (s) => s.replace(/\s+/g, '');

// 목차 쪽 = 「목차」 제목이 있는 쪽부터 「제1부」 표제지 앞까지
function tocPages(pages) {
  const a = pages.findIndex((p) => /^목차/.test(p.text));
  let b = pages.findIndex((p, i) => i > a && /^제\s*1\s*부/.test(p.text));
  if (b < 0) b = a + 3;
  return pages.slice(a, b);
}
// 목차 항목 분석 — 각 「제N회」 줄에서 시작해 같은 쪽의 다음 「제M회」 앞까지가 한 항목
function tocEntries(tp) {
  const out = [];
  for (const p of tp) {
    const idx = [];
    p.lines.forEach((l, i) => { if (/^제\d+회$/.test(l.t.trim())) idx.push(i); });
    idx.forEach((s, k) => {
      const e = k + 1 < idx.length ? idx[k + 1] : p.lines.length;
      const ls = p.lines.slice(s, e);
      const label = ls[0];
      const num = ls.filter((l) => /^\d+$/.test(l.t.trim())).pop();
      const body = ls.filter((l) => l !== label && l !== num);
      out.push({ page: p.n, no: Number(label.t.replace(/\D/g, '')), label, num, body, all: ls });
    });
  }
  return out;
}

(async () => {
  console.log('\n[1] 글꼴 사슬 · 동봉 파일');
  ok(fs.existsSync(path.join(FD, 'NotoSerifKR-Light.ttf')) && fs.existsSync(path.join(FD, 'NotoSerifKR-OFL.txt')), 'Noto Serif KR Light 부분집합 + OFL 라이선스 파일 동봉');
  ok(fs.existsSync(path.join(FD, 'HanjaSerif-Light.ttf')) && fs.existsSync(path.join(FD, 'HanjaSerif-OFL.txt')) && /OFL|Open Font License/.test(fs.readFileSync(path.join(FD, 'HanjaSerif-OFL.txt'), 'utf8')), '한자 보강 명조(Noto Serif CJK KR 한자 부분집합) + OFL 라이선스 파일 동봉(로이 승인 10-01)');
  const css = require('../core/book/pdf-builder').bundledFontCss((p) => 'x/' + path.basename(p));
  ok(/font-family: 'Noto Serif KR'[^}]*NotoSerifKR-Light\.ttf[^}]*font-weight: 300/.test(css), '@font-face Noto Serif KR = Light(300)');
  ok(/font-family: 'Priming Hanja Serif'[^}]*HanjaSerif-Light\.ttf[^}]*font-weight: 300/.test(css), '@font-face Priming Hanja Serif = Light(300)');
  const stack = HB.FONT_STACKS.kopub;
  ok(stack.startsWith("'KoPubWorld Batang', 'Noto Serif KR', 'NanumMyeongjo', 'Batang', 'Priming Hanja Serif'") && /serif$/.test(stack), '본문 글꼴 목록: KoPub(맨 앞 유지) → Noto Serif KR → 나눔명조 → 바탕 → 한자 보강 자리 → serif');

  console.log('\n[2] 누락 글리프 판정(순수) — 판별력 포함');
  const SAMPLE = '槳 傕 愼 慎 龔 劭 褚 隗 삼국지 abc';
  const full = G.missingGlyphs(SAMPLE, G.defaultChain(FD, false));   // Windows 바탕 없이 — 어느 PC 에서나 같은 결과
  ok(full.missing.length === 0, `한자 보강 명조까지 사슬에 넣으면 槳·傕·慎 도 해결 — 누락 ${full.missing.length}종`);
  const noHanja = G.missingGlyphs(SAMPLE, G.defaultChain(FD, false, { hanja: false }));
  const miss = noHanja.missing.map((m) => m.ch).join('');
  ok(miss.includes('槳') && miss.includes('傕') && miss.includes('慎') && !/[龔劭褚隗愼]/.test(miss), `판별력: 한자 보강 칸이 없으면 槳 傕 慎 이 누락으로 잡힌다 (실제: ${miss})`);
  const onlyKopub = G.missingGlyphs(SAMPLE, [['KoPub', [path.join(FD, 'KoPubWorld-Batang-Light.ttf')]]]);
  ok(onlyKopub.missing.length > noHanja.missing.length && onlyKopub.missing.some((m) => m.ch === '龔'), '판별력: Noto Serif KR 도 없으면 龔 등이 더 누락으로 잡힌다');
  const warn = G.formatWarning(noHanja);
  ok(/글꼴에 없는 글자 3종/.test(warn) && /槳\(U\+69F3\)/.test(warn) && /傕\(U\+5095\)/.test(warn), '경고 문구: ' + warn.slice(0, 70) + '…');
  ok(G.missingGlyphs('삼국지 abc 123', G.defaultChain(FD, false)).missing.length === 0, '누락 없으면 빈 목록');
  const rare = G.missingGlyphs('㐀', G.defaultChain(FD, false));   // 확장 A — 일부러 뺀 희귀 한자
  ok(rare.missing.length === 1 && /희귀 한자/.test(G.formatWarning(rare)), '확장 A 희귀 한자는 경고로 알린다(동봉 부분집합에서 뺐다)');
  const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  ok(/warnMissingGlyphs\(html, '미리보기'\)/.test(M) && /warnMissingGlyphs\(html, '내지 PDF'\)/.test(M), 'main: 미리보기·내지 PDF 조판 때 경고');
  const py = path.join('D:/## 출판/삼국지/기준/작품사전/글리프검사.py');
  if (fs.existsSync(py)) {
    try {
      const tf = path.join(OUT, 'sample.md'); fs.writeFileSync(tf, SAMPLE + '\n');
      const { spawnSync } = require('child_process');
      const r = spawnSync('python', [py, tf, '--체인', '권장'], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      const outTxt = r.stdout || '';
      const pyMiss = (outTxt.match(/⛔ 튀는 글자: ([^\s]+(?: [^\s—]+)*)/) || [,''])[1].replace(/\s/g, '');
      // 출판 세션 도구는 한자 보강 칸을 알게 됐을 수도(R15 이후) 모를 수도 있다 — 어느 쪽 사슬과든 같으면 통과
      const chainMiss = (o) => G.missingGlyphs(SAMPLE, G.defaultChain(FD, false, o)).missing.map((m) => m.ch).sort().join('');
      const ours = chainMiss({ hanja: false }), oursFull = chainMiss({});
      const pm = pyMiss.split('').sort().join('');
      ok(pm === ours || pm === oursFull, `출판 세션 글리프검사.py(--체인 권장)와 같은 누락 글자: 파이썬 [${pyMiss}] · 앱 [${ours}|보강 ${oursFull}]`);
    } catch (e) { console.log('  (파이썬 대조 건너뜀: ' + e.message + ')'); }
  } else console.log('  (글리프검사.py 없음 — 대조 건너뜀)');

  console.log('\n[3] R14 목차 · R12 머리글 — 실조판(새 방식)');
  const MDmain = mdOf('> 머리글홀수: 회목\n');
  const A = await build('new', MDmain);
  const tp = tocPages(A.pages);
  const ents = tocEntries(tp);
  ok(ents.length === 13, `목차 항목 13개(쪽 ${tp.map((p) => p.n).join('·')}) — 실제 ${ents.length}`);
  ok(tp.length >= 1 && tp.length <= 2, `목차 ${tp.length}쪽(1~2쪽 허용)`);
  // (a) 항목이 쪽 경계에서 쪼개지지 않는다 — 각 회목 전체가 한 쪽 안에 이어서 있다
  const split = TITLES.filter((t, i) => { const e = ents.find((x) => x.no === i + 1); return !e || !squash(e.body.map((l) => l.t).join('')).includes(squash(t).slice(0, 12)) || !squash(e.body.map((l) => l.t).join('')).endsWith(squash(t).slice(-8)); });
  ok(split.length === 0, '항목이 쪽 경계에서 쪼개지지 않는다(회목이 한 쪽에 처음부터 끝까지)' + (split.length ? ' — 문제: ' + split.join(' | ').slice(0, 80) : ''));
  // (b) 쪽번호 = 실제 장 시작 쪽
  const chStart = (i) => A.pages.find((p) => p.n > tp[tp.length - 1].n + 1 && p.text.startsWith(`제${i}회`));
  const badNum = ents.filter((e) => { const cs = chStart(e.no); return !cs || !e.num || Number(e.num.t.trim()) !== cs.n; });
  ok(badNum.length === 0, '목차 쪽번호가 본문 장 시작 쪽과 일치(13개)' + (badNum.length ? ' — 불일치 제N회: ' + badNum.map((e) => e.no).join(',') : ''));
  // (c) 점선+쪽번호는 마지막 줄 — 쪽번호 줄이 회목의 마지막 줄과 같은 높이
  const multi = ents.filter((e) => e.body.length >= 2);
  ok(multi.length >= 8, `회목이 2줄 이상인 항목 ${multi.length}개(내어쓰기 검증 대상)`);
  const numOnLast = multi.filter((e) => Math.abs(e.num.y0 - e.body[e.body.length - 1].y0) < 2);
  ok(multi.length > 0 && numOnLast.length === multi.length, `쪽번호가 회목 **마지막 줄**에 붙는다 (${numOnLast.length}/${multi.length})`);
  const labelOnFirst = ents.filter((e) => Math.abs(e.label.y0 - e.body[0].y0) < 2);
  ok(labelOnFirst.length === ents.length, `「제N회」 라벨이 회목 **첫 줄** 높이 (${labelOnFirst.length}/${ents.length})`);
  // (d) 내어쓰기 — 둘째 줄 이후도 같은 왼쪽 칸(회목 칸)에서 시작
  const hang = multi.filter((e) => e.body.every((l) => Math.abs(l.x0 - e.body[0].x0) < 1.5) && e.body[0].x0 > e.label.x1 - 0.5);
  ok(hang.length === multi.length, `회목 둘째 줄부터 첫 줄과 같은 칸에서 시작(내어쓰기) (${hang.length}/${multi.length})`);
  // (e) 양쪽 정렬로 벌어지지 않음 — 양쪽 정렬이면 둘째 줄이 있는 항목의 첫 줄이 모두 같은 오른쪽 끝에 닿는다(단어 사이만 늘려서). 왼쪽 정렬은 들쭉날쭉하다.
  //     (PDF 의 공백 폭은 글자 간격 보정으로 들어가 글자 위치로는 안 보인다 → 줄 오른쪽 끝의 흩어짐으로 잰다)
  const sd = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
  const rag = sd(multi.map((e) => e.body[0].x1));
  ok(rag > 8, `회목 첫 줄의 오른쪽 끝이 들쭉날쭉하다 = 왼쪽 정렬(양쪽 정렬 아님) — 표준편차 ${rag.toFixed(1)}pt > 8`);
  // (f) 머리글 한 줄 — 1회(80자+)의 홀수쪽 머리글. 1회는 9쪽 시작, 11쪽이 홀수쪽
  const hdrLines = (pg) => pg.lines.filter((l) => l.y1 < 62);
  const oddHdr = hdrLines(A.pages.find((p) => p.n === chStart(1).n + 2));
  ok(oddHdr.length === 1, `긴 회목(80자+)의 홀수쪽 머리글이 한 줄(말줄임) — 줄 수 ${oddHdr.length}: 「${oddHdr.map((l) => l.t).join(' / ').slice(0, 50)}」`);
  const evenHdr = hdrLines(A.pages.find((p) => p.n === chStart(1).n + 1));
  ok(evenHdr.length === 1 && /삼국지연의 완역 1/.test(evenHdr[0].t), '짝수쪽 머리글 = 책 제목 한 줄: ' + (evenHdr[0] && evenHdr[0].t));
  // (f2) 📏 제목 길이 기준(title-fit)의 예측 = 실제 조판 — 목차 줄 수·머리글 잘림
  const TFm = require('../core/book/title-fit');
  const bookA = parseBookText(MDmain, 'x'); const oA = HB.resolveBookOptions(bookA, {}).o;
  const fitA = TFm.analyze(bookA, oA, FD, { chapterExcluded: HB.chapterExcluded });
  const lineMatch = fitA.items.filter((it) => { const e = ents.find((x) => x.no === it.num); return e && e.body.length === it.tocLines; });
  ok(lineMatch.length >= 12, `title-fit 가 예측한 목차 줄 수 = 실제 조판 줄 수 (${lineMatch.length}/13${lineMatch.length < 13 ? ' — 어긋난 회: ' + fitA.items.filter((it) => !lineMatch.includes(it)).map((it) => `제${it.num}회 예측 ${it.tocLines} 실제 ${(ents.find((x) => x.no === it.num) || { body: [] }).body.length}`).join(', ') : ''})`);
  ok(fitA.items[0].flags.includes('header') && /…$/.test(oddHdr[0].t.trim()), `예측대로 1회(80자+)의 머리글이 실제로 …로 잘린다: 「${oddHdr[0].t.trim().slice(-14)}」`);
  // 1~3회는 3쪽 넘게 만들어 홀수쪽 머리글을 실제로 본다 — 예측(잘림 여부)과 실제(…)가 회마다 같다
  const realCut = [1, 2, 3].map((n) => { const cs = chStart(n); const pg = A.pages.find((p) => p.n === cs.n + 2); const l = pg ? hdrLines(pg) : []; return l.length === 1 && /…$/.test(l[0].t.trim()); });
  const predCut = [0, 1, 2].map((i) => fitA.items[i].flags.includes('header'));
  ok(JSON.stringify(realCut) === JSON.stringify(predCut) && predCut.some((x) => x) && predCut.some((x) => !x), `회마다 예측(잘림 ${predCut.join('/')}) = 실제 조판(…로 잘림 ${realCut.join('/')}) — 판별력: 잘리는 회와 안 잘리는 회가 둘 다 있다`);
  // (g) 글꼴 — 각주의 龔 은 동봉 Noto Serif KR(Light)
  const fnPage = A.pages.find((p) => p.n >= chStart(2).n && /槳/.test(p.text));   // 2회의 각주가 놓인 쪽(장 끝)
  const fontOf = (pg, ch) => { for (const l of pg.lines) for (const c of l.chars) if (c.c === ch) return c.font; return ''; };
  ok(/NotoSerifKR/.test(fontOf(fnPage, '龔')) && /NotoSerifKR/.test(fontOf(fnPage, '劭')), `각주의 龔·劭 → 동봉 Noto Serif KR: ${fontOf(fnPage, '龔')}`);
  ok(/KoPub/.test(fontOf(fnPage, '각')), '본문 글자는 그대로 KoPub월드 바탕(맨 앞 순서 유지): ' + fontOf(fnPage, '각'));
  ok(/NotoSerifCJK/.test(fontOf(fnPage, '槳')) && /NotoSerifCJK/.test(fontOf(fnPage, '傕')) && /NotoSerifCJK/.test(fontOf(fnPage, '慎')), `槳·傕·慎 → 한자 보강 명조(고딕으로 튀지 않는다): ${fontOf(fnPage, '槳')} / ${fontOf(fnPage, '傕')} / ${fontOf(fnPage, '慎')}`);

  console.log('\n[4] 🔎 판별력 — 옛 방식으로 되돌리면 같은 단언이 실패한다');
  const OLD = (html) => html.replace('</style>', 'nav.toc .tt { text-align: justify !important; } nav.toc a { align-items: baseline !important; } nav.toc li { break-inside: auto !important; }\n@page :right { @top-center { white-space: normal !important; text-overflow: clip !important; max-width: none !important; } }</style>');
  const B = await build('old', MDmain, { tweak: (h) => OLD(h.replace(/white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/g, '')) });
  const entsB = tocEntries(tocPages(B.pages));
  const multiB = entsB.filter((e) => e.body.length >= 2);
  const numOnLastB = multiB.filter((e) => Math.abs(e.num.y0 - e.body[e.body.length - 1].y0) < 2);
  ok(multiB.length > 0 && numOnLastB.length < multiB.length, `옛 방식(baseline)에서는 쪽번호가 첫 줄에 붙는다 — 마지막 줄 ${numOnLastB.length}/${multiB.length}`);
  const ragB = sd(multiB.map((e) => e.body[0].x1));
  ok(ragB < rag / 2, `옛 방식(양쪽 정렬)에서는 첫 줄 오른쪽 끝이 가지런히 닿는다: 표준편차 ${ragB.toFixed(1)}pt < ${(rag / 2).toFixed(1)}pt`);
  const oddHdrB = hdrLines(B.pages.find((p) => p.n === chStart(1).n + 2));
  ok(oddHdrB.length >= 2, `옛 방식(nowrap 없음)에서는 긴 회목 머리글이 두 줄로 꺾인다 — 줄 수 ${oddHdrB.length}`);

  console.log('\n[5] R12 머리글 메타 · R14 목차 글자/행간 메타 — 원고가 UI 값을 이긴다');
  const C = await build('meta', mdOf('> 머리글홀수: 제N회\n> 머리글짝수: 책제목\n> 목차글자: 9.5\n> 목차행간: 1.45\n'), { opts: { headerOdd: 'title', headerEven: 'none', tocSizePt: 12, tocLineHeight: 2 } });   // UI 값은 일부러 반대로
  const c1 = C.pages.find((p) => p.n === chStart(1).n || /^제1회/.test(p.text) && p.n > 8);
  const cOdd = hdrLines(C.pages.find((p) => p.n === (c1 ? c1.n : 9) + 2));
  ok(cOdd.length === 1 && /^제\s*1\s*회$/.test(cOdd[0].t.trim()), `메타 머리글홀수: 제N회 → 홀수쪽 머리글 = 「제1회」만 (UI 값 title 을 이김): 「${cOdd.map((l) => l.t).join('/')}」`);
  const cEven = hdrLines(C.pages.find((p) => p.n === (c1 ? c1.n : 9) + 1));
  ok(cEven.length === 1 && /삼국지연의 완역 1/.test(cEven[0].t), `메타 머리글짝수: 책제목 → 짝수쪽 머리글 = 책 제목 (UI 값 none 을 이김): 「${cEven.map((l) => l.t).join('/')}」`);
  const cT = tocEntries(tocPages(C.pages));
  const sz = cT[0] && cT[0].body[0].chars[0].size;
  ok(cT.length === 13 && Math.abs(sz - 9.5) < 0.2, `메타 목차글자 9.5pt 가 UI 값(12pt)을 이김 — 실제 ${sz && sz.toFixed(2)}pt`);
  const lh = cT[0] && cT[0].body.length >= 2 ? (cT[0].body[1].y0 - cT[0].body[0].y0) : 0;
  ok(lh > 0 && lh / sz > 1.3 && lh / sz < 1.6, `메타 목차행간 1.45 — 줄 간격/글자 ${(lh / sz).toFixed(2)}`);
  const cB = await build('nometa', mdOf(''), { opts: { headerOdd: 'chapterNo', tocSizePt: 0 } });
  const nOdd = hdrLines(cB.pages.find((p) => p.n === chStart(1).n + 2));
  ok(nOdd.length === 1 && /^제\s*1\s*회$/.test(nOdd[0].t.trim()), '메타가 없으면 UI 옵션(chapterNo)을 쓴다');

  console.log(`\n${fail ? '❌' : '✅'} book-toc — ${pass} 통과 / ${fail} 실패  (확인용 PNG: output/_book-toc/*.pdf)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
