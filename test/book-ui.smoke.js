'use strict';
// node test/book-ui.smoke.js — Electron 앱을 Playwright 로 구동해 출판 모드 E2E 스모크.
//   흐름: 부팅 → 원고 로드(open-book-path) → 📖 출판 탭 → BookView → vivliostyle 미리보기 페이지 수.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SAMPLE = path.join(ROOT, 'output', '_book-smoke', 'sample-book.md');

const para = '조선의 밤은 길고 깊었다. 등불 하나에 의지해 역사를 기록하던 사람들이 있었다. '.repeat(5);
fs.mkdirSync(path.dirname(SAMPLE), { recursive: true });
fs.writeFileSync(SAMPLE, `# UI스모크 책
> 저자: 홍길동
> 출판사: 프라이밍북스
> 발행인: 김대표
> 발행일: 2026-08-01
> ISBN: 979-11-0000-000-0
> 정가: 10,000원
> 판형: 46판

## [서문]
서문이다.

## [목차]

## 1장. 하나
${para}

## 2장. 둘
${para}

## [판권]
`, 'utf8');

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => { if (m.type() === 'error') console.log('[renderer:error]', m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });
    console.log('· 부팅 OK:', await win.locator('h1').first().innerText());

    // 원고를 main 에 직접 로드(파일 대화상자 우회) 후 출판 탭 클릭
    const r = await win.evaluate((p) => window.api.openBookPath({ scriptPath: p }), SAMPLE);
    if (!r || !r.dto || r.dto.kind !== 'book') throw new Error('openBookPath 실패: ' + JSON.stringify(r && r.mode));
    console.log('· 원고 로드 OK — 장', r.dto.parts.reduce((n, p) => n + p.chapters.length, 0), '개');

    await win.click('.modetoggle button:has-text("📖 출판")');
    await win.waitForSelector('.bkwrap', { timeout: 10000 });
    console.log('· BookView 렌더 OK');

    // vivliostyle 조판 완료 대기 — .bkpage 에 "N / M쪽"
    await win.waitForFunction(() => {
      const el = document.querySelector('.bkpage');
      return el && /\/\s*\d+쪽/.test(el.textContent);
    }, null, { timeout: 60000 });
    const pageTxt = await win.locator('.bkpage').innerText();
    console.log('· 미리보기 조판 OK —', pageTxt.trim());

    // ── 본문 장 출력 제외(v0.3.33) — 원고는 그대로 두고 책에서만 뺀다 ──
    //   §0 진행 현황·체크리스트처럼 원고엔 있어야 하지만 인쇄물엔 없어야 하는 장을 클릭 한 번으로.
    await win.click('[data-tab=structure]');   // 탭 선택은 localStorage(bk-tab)에 남는다 — 늘 구조 탭에서 시작
    await win.waitForSelector('[data-testid=bk-titlefit]', { timeout: 15000 });   // 📏 제목 길이 기준(구조 탭)
    const fitTxt = await win.locator('[data-testid=bk-titlefit]').innerText();
    if (!/제목 길이 기준/.test(fitTxt) || !/머리글 한 줄 ≈ \d+자/.test(fitTxt) || !/목차 2줄 ≈ \d+자/.test(fitTxt)) throw new Error('제목 길이 기준 상자 내용이 이상함: ' + fitTxt);
    console.log('· 구조 탭 제목 길이 기준 OK —', fitTxt.replace(/\s+/g, ' ').slice(0, 70));
    const chBoxes = win.locator('.bkch input[type=checkbox]');
    const chCount = await chBoxes.count();
    if (chCount !== 2) throw new Error(`장 체크박스 ${chCount}개 ≠ 2`);
    if (!(await chBoxes.nth(0).isChecked())) throw new Error('장이 기본 제외 상태 — 기본은 전부 포함이어야 한다');
    const pagesBefore = Number((await win.locator('.bkpage').innerText()).match(/(\d+)쪽/)[1]);
    await chBoxes.nth(1).uncheck();
    // 재조판 대기 — 장 하나가 빠졌으니 쪽수가 줄어야 한다
    await win.waitForFunction((before) => {
      const el = document.querySelector('.bkpage');
      const m = el && el.textContent.match(/(\d+)쪽/);
      return m && Number(m[1]) < before;
    }, pagesBefore, { timeout: 60000 });
    const pagesAfter = Number((await win.locator('.bkpage').innerText()).match(/(\d+)쪽/)[1]);
    console.log(`· 장 제외 OK — ${pagesBefore}쪽 → ${pagesAfter}쪽 (원고 불변)`);
    // 원고(.md)는 안 건드렸는지 — 제외는 조판 옵션일 뿐이다
    const mdAfter = fs.readFileSync(SAMPLE, 'utf8');
    if (!mdAfter.includes('## 2장. 둘')) throw new Error('장 제외가 원고를 지웠다(비파괴 위반)');
    await chBoxes.nth(1).check(); // 되돌리기 — 복원되는지
    await win.waitForFunction((after) => {
      const el = document.querySelector('.bkpage');
      const m = el && el.textContent.match(/(\d+)쪽/);
      return m && Number(m[1]) > after;
    }, pagesAfter, { timeout: 60000 });
    console.log('· 장 복원 OK — 다시 체크하면 되돌아온다');

    // 🌙 모니터 끄기 버튼이 출판 탭 메뉴 줄에도 있다(로이 2026-10-01) — 눌러 보진 않는다(진짜 모니터가 꺼진다). 보이고 · 실제로 눌리고 · 메뉴 줄이 한 줄.
    {
      const bb = await win.locator('[data-testid="monitor-off"]').boundingBox();
      if (!bb) throw new Error('출판 탭에 🌙 모니터 끄기 버튼이 없음');
      const hit = await win.evaluate(({ x, y }) => !!((document.elementFromPoint(x, y) || {}).closest || (() => null)).call(document.elementFromPoint(x, y), '[data-testid="monitor-off"]'), { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
      if (!hit) throw new Error('🌙 모니터 끄기 버튼이 가려져 눌리지 않음');
      const mbh = (await win.locator('.menubar').boundingBox()).height;
      if (mbh >= 56) throw new Error('버튼을 더하자 메뉴 줄이 두 줄이 됨: ' + Math.round(mbh) + 'px');
      console.log('· 출판 탭 🌙 모니터 끄기 버튼 OK — 보임·눌림·메뉴 줄 한 줄');
    }

    // 왼쪽 메뉴 — 7개 탭 + 로그가 왼쪽 맨 아래 + 표지 안내 쪽 없음(미리보기 1쪽 = 반표제지)
    const tabs = await win.locator('[data-testid=bk-nav] .bktab').count();
    if (tabs !== 6) throw new Error('왼쪽 메뉴 탭 ' + tabs + '개 ≠ 6 (구조·책 정보·판권·표지·조판·부크크 등록 — 종이책·전자책 통합)');
    const geo = await win.evaluate(() => {
      const side = document.querySelector('[data-testid=bk-side]').getBoundingClientRect();
      const log = document.querySelector('#logwrap').getBoundingClientRect();
      const nav = document.querySelector('[data-testid=bk-nav]').getBoundingClientRect();
      return { sideL: side.left, sideR: side.right, sideB: side.bottom, logL: log.left, logR: log.right, logB: log.bottom, logT: log.top, navB: nav.bottom };
    });
    if (!(geo.logL >= geo.sideL - 1 && geo.logR <= geo.sideR + 1 && Math.abs(geo.logB - geo.sideB) < 14 && geo.logT > geo.navB)) throw new Error('로그가 왼쪽 패널 맨 아래가 아님 ' + JSON.stringify(geo));
    console.log('· 왼쪽 메뉴 7탭 + 로그 왼쪽 하단 OK');
    // 화면 아래 끝까지 채운다(빈 공간 없음) · 내용과 로그 사이 간격 · 「원고 열기」는 출판 탭 바로 다음 · 출판 채널 자동 선택
    const fill = await win.evaluate(() => {
      const w = document.querySelector('.bkwrap').getBoundingClientRect();
      const body = document.querySelector('.bkbody').getBoundingClientRect();
      const log = document.querySelector('#logwrap').getBoundingClientRect();
      const tog = document.querySelector('.modetoggle');
      const nxt = tog && tog.nextElementSibling;
      const sel = [...document.querySelectorAll('header select')].find((s) => /채널/.test(s.title || ''));
      return { gapBottom: window.innerHeight - w.bottom, gap: log.top - body.bottom, nextTxt: nxt ? nxt.textContent : '', chan: sel ? sel.value : null };
    });
    if (fill.gapBottom > 24) throw new Error('화면 아래 빈 공간 ' + Math.round(fill.gapBottom) + 'px');
    if (fill.gap < 6) throw new Error('내용과 로그 사이 간격 없음 ' + fill.gap);
    if (!/원고 열기/.test(fill.nextTxt)) throw new Error('원고 열기 버튼이 출판 탭 다음이 아님: ' + fill.nextTxt);
    const pres = await win.evaluate(() => window.api.listPresets());
    const bkCh = (pres || []).find((p) => p.startMode === 'book');
    if (bkCh && fill.chan !== bkCh.name && fill.chan !== '출판') throw new Error('출판 탭인데 채널이 ' + fill.chan + ' (기대 출판 채널)');
    console.log('· 하단 빈 공간 0 · 로그 간격 OK · 원고 열기 위치 OK · 채널 =', fill.chan);
    const firstPage = await win.evaluate(() => { const f = document.querySelector('.bkviewport'); return f && f.contentDocument ? f.contentDocument.body.innerText : ''; });
    if (/표지 스프레드 안내/.test(firstPage)) throw new Error('표지 스프레드 안내 쪽이 아직 있음');
    await win.click('[data-tab=layout]');
    // 「📁 작업용 파일 경로 → 파일명만」 옵션이 조판 패널에 있는지
    const hidePathsBox = win.locator('label:has-text("작업용 파일 경로") input[type=checkbox]');
    if (await hidePathsBox.count() !== 1) throw new Error('경로 축약 체크박스 없음');
    if (await hidePathsBox.isChecked()) throw new Error('경로 축약은 기본 OFF 여야 한다');
    console.log('· 경로 축약 옵션 OK (기본 OFF)');

    // 📤 부크크 등록(종이책·전자책 통합 탭, 2026-10-03): 자동 입력(맨 위) · 만들기 · 점검표 2개 · 복사값
    {
      await win.click('[data-tab=bookk]');
      await win.waitForSelector('[data-testid=bk-reg]', { timeout: 5000 });
      if (await win.locator('[data-tab=ebook]').count() !== 0) throw new Error('전자책 탭이 따로 남아 있다(통합됐어야 한다)');
      if (await win.locator('[data-tab=bookk]').innerText().then((t) => !/부크크 등록/.test(t))) throw new Error('통합 탭 이름이 「부크크 등록」이 아니다');
      for (const [pid, label, minChk, minSum] of [['bookk', '종이책', 10, 8], ['ebook', '전자책', 10, 6]]) {
        const nChk = await win.locator(`[data-testid=bk-reg-${pid}] .bkchk`).count();
        if (nChk < minChk) throw new Error(`${label} 점검표 항목 ${nChk}개 — 너무 적다`);
        if (await win.locator(`[data-testid=bk-reg-${pid}] .bksum-row`).count() < minSum) throw new Error(`${label} 복사값 부족`);
        console.log(`· ${label} 점검표 ${nChk}항목`);
      }
      const one = async (tid, what) => { const n = await win.locator(`[data-testid=${tid}]`).count(); if (n !== 1) throw new Error(`${what} 개수 ${n}`); };
      await one('bk-register-bookk', '종이책 자동 입력 버튼'); await one('bk-register-ebook', '전자책 자동 입력 버튼');
      await one('bk-register-cover', '종이책 이어 채우기'); await one('bk-register-ebook-resume', '전자책 이어 채우기');
      await one('bk-paper-price-row', '종이책 정가 줄');
      await one('bk-build-all', '한 번에 만들기'); await one('bk-pdf-print', '종이책 PDF'); await one('bk-epub', 'ePub 만들기'); await one('bk-epubcheck', 'ePub 검증'); await one('bk-pdf-ebook', '전자책 PDF');
      if (await win.locator('[data-testid=bk-register-both]').count() !== 0) throw new Error('「종이책 → 전자책 한 번에 등록」 버튼이 남아 있다(제거됐어야 한다)');
      await win.waitForSelector('[data-testid=bk-reg] [data-testid=bk-preflight]', { timeout: 8000 }).catch(() => {});
      if (await win.locator('[data-testid=bk-reg] [data-testid=bk-preflight]').count() !== 1) throw new Error('출고 전 점검 패널이 1개가 아니다');
      // 🔑 자동 입력이 패널 맨 위 — 만들기·점검표·점검 패널보다 위에 있다
      const ys = await win.evaluate(() => { const y = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top + window.scrollY : -1; }; return { auto: y('[data-testid=bk-auto]'), build: y('[data-testid=bk-build-all]'), pf: y('[data-testid=bk-preflight]'), chk: y('[data-testid=bk-reg-bookk]') }; });
      if (!(ys.auto >= 0 && ys.auto < ys.build && ys.auto < ys.pf && ys.auto < ys.chk)) throw new Error('자동 입력이 맨 위가 아니다 ' + JSON.stringify(ys));
      if (await win.locator('[data-testid=bk-reg]').locator('text=작가와').count() > 0) throw new Error('부크크 등록 탭에 작가와 문구가 남아 있음');
      await win.screenshot({ path: path.join(ROOT, 'output', '_book-smoke', 'ui-bookk.png') });
      console.log('· 부크크 등록(통합) OK — 자동 입력 맨 위 · 점검표 2개 · 만들기 한 곳');
    }
    // 🪽 표지 날개 — 첨부한 표지 판정이 **날개 설정을 따라 그때그때** 바뀌고, 반대 설정 치수면 「날개 설정을 확인하세요」(R11)
    {
      const specNow = await win.evaluate(() => window.api.bookSetMeta({ key: 'flaps', value: '' }).then((d) => d && d.spread));   // 날개 메타 비움 = 없음
      const mkPng = (w, h) => { const b = Buffer.alloc(64); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
      const png = path.join(os.tmpdir(), 'flap-cover-test.png');
      fs.writeFileSync(png, mkPng(specNow.widthPx, specNow.heightPx));   // 날개 없는 스프레드 치수(헤더만 있는 PNG — 치수 판정만 본다)
      await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, png);
      const a1 = await win.evaluate(() => window.api.bookAttachCover().then((d) => d && d.coverCheck));
      if (!a1 || !a1.ok) throw new Error('날개 없는 설정 + 날개 없는 치수 파일이 통과하지 못함: ' + JSON.stringify(a1));
      const a2 = await win.evaluate(() => window.api.bookSetMeta({ key: 'flaps', value: '있음' }).then((d) => d && { flaps: d.flaps, cc: d.coverCheck, w: d.spread && d.spread.widthMm }));
      if (!a2 || !a2.flaps || a2.cc.ok || a2.cc.flapHint !== 'file-has-no-flaps') throw new Error('날개를 켜면 같은 파일이 「날개 없는 파일」 힌트와 함께 불일치여야 한다: ' + JSON.stringify(a2));
      if (!(a2.w - specNow.widthMm > 199 && a2.w - specNow.widthMm < 201)) throw new Error('날개를 켜면 스프레드가 +200mm 여야 한다: ' + a2.w + ' vs ' + specNow.widthMm);
      // 화면 — API 로 바꾼 값은 React 상태에 안 실리니, 실제 체크박스로 날개를 켜서 화면의 경고를 본다
      await win.evaluate(() => window.api.bookSetMeta({ key: 'flaps', value: '' }));
      await win.click('[data-tab=cover]');
      await win.locator('label.chk:has-text("표지 날개") input[type=checkbox]').check();
      await win.waitForFunction(() => [...document.querySelectorAll('.bkwarn')].some((e) => /날개 설정을 확인하세요/.test(e.textContent)), null, { timeout: 15000 })
        .catch(async () => { throw new Error('표지 탭에 「날개 설정을 확인하세요」 경고가 없음: ' + (await win.locator('.bkwarn').allInnerTexts()).join(' | ')); });
      await win.evaluate(() => window.api.bookSetMeta({ key: 'flaps', value: '' }));   // 되돌림
      await win.evaluate(() => window.api.bookClearCover());
      fs.rmSync(png, { force: true });
      console.log('· 표지 날개 판정 OK — 없음 통과 → 날개 켬 +200mm·불일치+힌트 → 화면 경고 → 되돌림');
    }
    // 🖼 R13 — 미리보기 첫 화면 = 표지 펼침면(미리보기 전용): 첨부 표지 → 표지 화면 · ▶ 1쪽 · ⏮ 표지 · 「시안」·날개 경고 · 쪽번호는 내지 그대로
    {
      const pageNow = async () => { const t = (await win.locator('.bkpage').innerText()).trim(); return { label: t.split('/')[0].trim(), total: Number((t.match(/(\d+)쪽/) || [])[1]) }; };
      // 앞 블록이 API 로 바꾼 값은 화면 상태에 안 실려 있다 — 화면 버튼으로 깨끗이 되돌린 뒤 시작한다
      await win.click('[data-tab=cover]');
      const rm = win.locator('button:has-text("제거")');
      if (await rm.count()) await rm.first().click();
      const fl = win.locator('label.chk:has-text("표지 날개") input[type=checkbox]');
      if (await fl.isChecked()) await fl.uncheck();
      await win.waitForSelector('button:has-text("표지 이미지 첨부")', { timeout: 15000 });
      await win.waitForFunction(() => !document.querySelector('[data-testid=bk-cover]') || true);
      const before = await pageNow();
      const spec = await win.evaluate(() => window.api.bookSetMeta({ key: 'flaps', value: '' }).then((d) => d && d.spread));
      const mkPng = (w, h) => { const b = Buffer.alloc(64); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
      const png = path.join(os.tmpdir(), '삼국지연의_제1권_표지_시안.png');
      fs.writeFileSync(png, mkPng(spec.widthPx, spec.heightPx));
      await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, png);
      await win.click('button:has-text("표지 이미지 첨부")');
      await win.waitForSelector('[data-testid=bk-cover]', { timeout: 15000 });
      let st = await pageNow();
      if (st.label !== '표지') throw new Error('표지 화면의 쪽 표시가 「표지」가 아님: ' + JSON.stringify(st));
      if (st.total !== before.total) throw new Error(`표지 화면이 내지 쪽수를 바꿨다(쪽번호가 PDF 와 어긋남): ${before.total} → ${st.total}`);
      const warns = await win.locator('[data-testid=bk-cover-warn]').allInnerTexts();
      if (!warns.some((t) => /시안/.test(t) && /인쇄용이 아닙니다/.test(t))) throw new Error('「시안」 파일 경고가 없음: ' + warns.join(' | '));
      const srcdoc = await win.locator('iframe.bkcover-frame').getAttribute('srcdoc');
      if (!/<img class="bg" src="media:\/\//.test(srcdoc || '') || !/width:\d+(\.\d+)?mm/.test(srcdoc || '')) throw new Error('표지 펼침면 iframe 에 첨부 이미지(media://)·스프레드 치수가 없음');
      const svgTxt = await win.locator('.bkcover-lines').innerHTML();
      if (!/책등|뒤표지|앞표지/.test(svgTxt) || !new RegExp(String(spec.spineMm)).test(svgTxt)) throw new Error('책등 mm·구획 표시가 없음');
      // ▶ = 내지 1쪽(표지는 사라진다) · ⏮ = 표지 · 1쪽에서 ◀ = 표지
      await win.click('.bkbar button[title="다음 펼침면"]');
      await win.waitForFunction(() => !document.querySelector('[data-testid=bk-cover]'), null, { timeout: 8000 });
      st = await pageNow();
      if (!/^1$/.test(st.label)) throw new Error('▶ 뒤 쪽 표시가 1 이 아님: ' + JSON.stringify(st));
      await win.click('.bkbar button[title="이전 펼침면"]');
      await win.waitForSelector('[data-testid=bk-cover]', { timeout: 8000 });
      await win.click('.bkbar button[title="다음 펼침면"]');
      await win.waitForFunction(() => !document.querySelector('[data-testid=bk-cover]'), null, { timeout: 8000 });
      await win.click('.bkbar button[title="첫 페이지"]');
      await win.waitForSelector('[data-testid=bk-cover]', { timeout: 8000 });
      // ‹ › 화면 양쪽 끝 화살표(로이 2026-10-01): 표지 → 1쪽 → 다음 → 이전 → 표지
      await win.locator('[data-testid=bk-next]').click();
      await win.waitForFunction(() => !document.querySelector('[data-testid=bk-cover]'), null, { timeout: 8000 });
      const a1 = await pageNow();
      await win.locator('[data-testid=bk-next]').click();
      // 고정 600ms 는 뷰어 재배치가 늦을 때 흔들렸다 — 쪽 표시가 바뀔 때까지 최대 4초 기다린다(안 바뀌면 아래 단언이 잡는다)
      await win.waitForFunction((l) => { const t = (document.querySelector('.bkpage') || {}).textContent || ''; return t.split('/')[0].trim() !== l; }, a1.label, { timeout: 4000 }).catch(() => {});
      const a2 = await pageNow();
      if (!/^1$/.test(a1.label) || a2.label === a1.label) throw new Error(`화살표 › 로 쪽이 안 넘어감: ${a1.label} → ${a2.label}`);
      await win.locator('[data-testid=bk-prev]').click(); await win.waitForTimeout(600);
      if ((await pageNow()).label !== a1.label) throw new Error('화살표 ‹ 로 이전 쪽으로 못 돌아옴');
      // 책 밖(회색) 클릭: 오른쪽 = 다음 · 왼쪽 = 이전. 쪽 안 클릭은 넘기지 않는다(판별)
      const outClick = (x) => win.evaluate((cx) => { const d = document.querySelector('iframe.bkviewport').contentDocument; d.body.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: 300, bubbles: true, view: d.defaultView })); return d.defaultView.innerWidth; }, x);
      const W = await outClick(5);   // 왼쪽 끝 = 이전 → a1 의 앞(표지 또는 1쪽 앞)
      await win.waitForTimeout(500);
      const b1 = await pageNow();
      await outClick(W - 5); await win.waitForTimeout(600);
      const b2 = await pageNow();
      if (b1.label !== '표지') throw new Error(`책 밖 왼쪽 클릭으로 이전(표지)으로 안 감: ${a1.label} → ${b1.label}`);
      if (b2.label !== a1.label) throw new Error(`책 밖 오른쪽 클릭으로 다음 쪽으로 안 감: ${b1.label} → ${b2.label}`);
      await win.evaluate(() => { const d = document.querySelector('iframe.bkviewport').contentDocument; const pg = d.querySelector('[data-vivliostyle-page-container]'); if (pg) pg.dispatchEvent(new MouseEvent('click', { clientX: 5, clientY: 300, bubbles: true, view: d.defaultView })); });
      await win.waitForTimeout(400);
      if ((await pageNow()).label !== b2.label) throw new Error('쪽 안을 눌렀는데 쪽이 넘어감');
      while (!(await win.locator('[data-testid=bk-cover]').count())) { await win.locator('[data-testid=bk-prev]').click(); await win.waitForTimeout(500); }
      // 날개를 켜면 같은 파일이 날개 없는 치수 → 경고
      await win.locator('label.chk:has-text("표지 날개") input[type=checkbox]').check().catch(async () => { await win.click('[data-tab=cover]'); await win.locator('label.chk:has-text("표지 날개") input[type=checkbox]').check(); });
      await win.waitForFunction(() => [...document.querySelectorAll('[data-testid=bk-cover-warn]')].some((e) => /날개 설정을 확인하세요/.test(e.textContent)), null, { timeout: 15000 });
      // 첨부를 지우면 표지 화면이 사라진다(문구 섹션도 없을 때)
      await win.evaluate(() => window.api.bookSetMeta({ key: 'flaps', value: '' }));
      await win.click('[data-tab=cover]');
      await win.locator('button:has-text("제거")').first().click();
      await win.waitForFunction(() => !document.querySelector('[data-testid=bk-cover]'), null, { timeout: 15000 });
      st = await pageNow();
      if (st.label === '표지') throw new Error('표지가 없는데 표지 표시가 남음');
      fs.rmSync(png, { force: true });
      console.log('· 표지 펼침면 OK — 표지 화면(쪽번호 불변) · 시안 경고 · 책등 mm 표시 · ▶/◀/⏮ 이동 · 날개 경고 · 제거하면 사라짐');
    }
    await win.click('[data-tab=info]');
    if (await win.locator('.bkbadge.req').count() < 3 || await win.locator('.bkbadge.opt').count() < 3) throw new Error('필수/선택 배지 없음');
    await win.screenshot({ path: path.join(ROOT, 'output', '_book-smoke', 'ui-info.png') });
    await win.click('[data-tab=layout]');

    // 목차 쪽번호 — target-counter 가 해석돼 숫자가 나와야 한다('??' = anchor 불일치 회귀).
    //   (미리보기 URL 에 쿼리 캐시버스터를 붙이면 vivliostyle 같은문서 판정이 깨져 '??' 가 남)
    const tocTxt = await win.evaluate(() => {
      const f = document.querySelector('.bkviewport');
      const toc = f && f.contentDocument && f.contentDocument.querySelector('nav.toc');
      return toc ? toc.innerText : '';
    });
    if (tocTxt) {
      if (/\?\?/.test(tocTxt)) throw new Error('목차 쪽번호 미해석(??) — target-counter 회귀');
      if (!/\d/.test(tocTxt.replace(/목차/g, ''))) throw new Error('목차에 쪽번호 숫자가 없음');
      console.log('· 목차 쪽번호 해석 OK (?? 없음)');
      // 🔖 R14 — 미리보기(뷰어)에서도 목차 행이 새 구조: 점선+쪽번호는 마지막 줄(last baseline) · 왼쪽 정렬
      const tocCss = await win.evaluate(() => {
        const f = document.querySelector('.bkviewport'); const d = f && f.contentDocument;
        const a = d && d.querySelector('nav.toc a'); const t = d && d.querySelector('nav.toc');
        return a ? { ai: getComputedStyle(a).alignItems, ta: getComputedStyle(t).textAlign } : null;
      });
      if (tocCss && !(/last baseline/.test(tocCss.ai) && /left|start/.test(tocCss.ta))) throw new Error('미리보기 목차 행이 새 구조가 아님: ' + JSON.stringify(tocCss));
      console.log('· 미리보기 목차 행: last baseline · 왼쪽 정렬', JSON.stringify(tocCss));
    }

    // 안정성 — 조판 완료 후 재조판 루프(깜빡임)가 없어야 한다.
    //   busy 표시("조판 중…")가 3초 동안 다시 켜지지 않는지 샘플링.
    let relayouts = 0;
    for (let i = 0; i < 12; i++) {
      const busy = await win.evaluate(() => {
        const el = document.querySelector('.bkbar .meta');
        return el ? /조판 중/.test(el.textContent) : false;
      });
      if (busy) relayouts++;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (relayouts > 0) throw new Error(`재조판 루프 감지 — 3초간 "조판 중" ${relayouts}회 (깜빡임 버그)`);
    console.log('· 안정성 OK — 3초간 재조판 없음(루프 해소)');

    // 미리보기(iframe 격리) 안에 실제 페이지 DOM + 소스매핑 존재?
    const nSrc = await win.evaluate(() => {
      const f = document.querySelector('iframe.bkviewport');
      return f && f.contentDocument ? f.contentDocument.querySelectorAll('[data-src-line]').length : -1;
    });
    console.log('· 소스매핑 블록(iframe):', nSrc, '개');
    if (nSrc < 1) throw new Error('data-src-line 블록 없음 — 클릭-편집 불가');

    // 클릭-편집 왕복 — 본문 문단 클릭(iframe 내부) → 편집창 → 저장 → 원본 .md 반영 확인
    await win.evaluate(() => {
      const f = document.querySelector('iframe.bkviewport');
      const els = f.contentDocument.querySelectorAll('p[data-src-line]');
      for (const el of els) { if (el.textContent.includes('조선의 밤')) { el.click(); return; } }
      throw new Error('본문 문단을 못 찾음');
    });
    await win.waitForSelector('.bkedit textarea', { timeout: 5000 });
    await win.fill('.bkedit textarea', '오타를 고친 새 문장이다.');
    await win.click('.bkedit button:has-text("저장")');
    await win.waitForFunction(() => !document.querySelector('.bkedit'), null, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 800)); // 파일 쓰기 여유
    const saved = fs.readFileSync(SAMPLE, 'utf8');
    if (!saved.includes('오타를 고친 새 문장이다.')) throw new Error('편집이 원본 .md 에 저장되지 않음');
    console.log('· 클릭-편집 → 원본 .md 저장 OK');

    // 재조판 완료 대기(편집 반영)
    await win.waitForFunction(() => {
      const el = document.querySelector('.bkpage');
      return el && /\/\s*\d+쪽/.test(el.textContent);
    }, null, { timeout: 60000 });

    // ── 다중 파일 원고 (삼국지 필수파일+회차) — 원고가 있을 때만 ──
    const DATA = 'D:/PrimingBook/book-publishing/data';
    if (fs.existsSync(path.join(DATA, '삼국지연의_1권_필수파일.md'))) {
      const multi = [path.join(DATA, '삼국지연의_1권_필수파일.md')];
      for (let i = 1; i <= 15; i++) multi.push(path.join(DATA, `출판_삼국지_제${String(i).padStart(3, '0')}회.md`));
      const rm = await win.evaluate((ps) => window.api.openBookPath({ scriptPaths: ps }), multi);
      if (!rm || !rm.dto || rm.dto.kind !== 'book') throw new Error('다중 파일 열기 실패');
      const chN = rm.dto.parts.reduce((n, p) => n + p.chapters.length, 0);
      if (chN !== 15) throw new Error(`다중 파일 장 수 ${chN} ≠ 15`);
      console.log('· 다중 파일(삼국지 16개) 로드 OK — 장', chN, '개, 제목:', rm.dto.fileTitle);
      // IPC 직접 호출은 React dto 를 안 바꾸므로 실사용처럼 모드 토글로 재로드
      await win.click('.modetoggle button:has-text("롱폼")');
      await win.waitForTimeout(800);
      try {
        await win.click('.modetoggle button:has-text("📖 출판")', { timeout: 15000 });
      } catch (e) {
        await win.screenshot({ path: path.join(ROOT, 'output', '_book-multi', 'ui-fail.png') });
        console.log('[debug] 출판 탭 클릭 실패 — 화면:', await win.evaluate(() => ({
          buttons: [...document.querySelectorAll('.modetoggle button')].map((b) => b.textContent),
          hasBody: !!document.querySelector('#body'),
        })).catch(() => 'evaluate 실패'));
        throw e;
      }
      // 조판 완료 대기 — 대작(200쪽+)이 실제 조판됐는지 (이전 14쪽 잔상 배제)
      await win.waitForFunction(() => {
        const el = document.querySelector('.bkpage');
        const m = el && el.textContent.match(/\/\s*(\d+)쪽/);
        return m && parseInt(m[1], 10) > 100;
      }, null, { timeout: 180000 });
      console.log('· 삼국지 미리보기 조판 OK —', (await win.locator('.bkpage').innerText()).trim());
      await win.screenshot({ path: path.join(ROOT, 'output', '_book-multi', 'ui-samgukji.png') });
    } else console.log('⏭ 삼국지 원고 없음 — 다중 파일 케이스 스킵');

    // 스크린샷 (로이 앱과 같은 localStorage — 끝나면 기본 탭(구조)으로 되돌린다)
    await win.screenshot({ path: path.join(ROOT, 'output', '_book-smoke', 'ui-bookview.png') });
    await win.click('[data-tab=structure]').catch(() => {});
    console.log('✅ book-ui.smoke — 전체 통과 (스크린샷: output/_book-smoke/ui-bookview.png)');
  } finally {
    await app.close().catch(() => {});
  }
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
