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

    // 왼쪽 메뉴 — 7개 탭 + 로그가 왼쪽 맨 아래 + 표지 안내 쪽 없음(미리보기 1쪽 = 반표제지)
    const tabs = await win.locator('[data-testid=bk-nav] .bktab').count();
    if (tabs !== 7) throw new Error('왼쪽 메뉴 탭 ' + tabs + '개 ≠ 7');
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

    // 📤 등록 도우미 — 부크크(종이책)·작가와(전자책) 탭: 점검표 · 복사값 · 빌드 버튼
    for (const [tabId, label, btn] of [['bookk', '부크크', 'bk-pdf-print'], ['jakkawa', '작가와', 'bk-pdf-ebook']]) {
      await win.click(`[data-tab=${tabId}]`);
      await win.waitForSelector(`[data-testid=bk-reg-${tabId}]`, { timeout: 5000 });
      const nChk = await win.locator(`[data-testid=bk-reg-${tabId}] .bkchk`).count();
      if (nChk < 10) throw new Error(`${label} 점검표 항목 ${nChk}개 — 너무 적다`);
      if (await win.locator(`[data-testid=bk-reg-${tabId}] .bksum-row`).count() < 8) throw new Error(`${label} 복사값 부족`);
      if (await win.locator(`[data-testid=${btn}]`).count() !== 1) throw new Error(`${label} 빌드 버튼 없음`);
      if (await win.locator(`[data-testid=bk-register-${tabId}]`).count() !== 1) throw new Error(`${label} 자동 입력 버튼 없음`);
      await win.screenshot({ path: path.join(ROOT, 'output', '_book-smoke', `ui-${tabId}.png`) });
      console.log(`· ${label} 등록 도우미 OK — 점검 ${nChk}항목`);
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
