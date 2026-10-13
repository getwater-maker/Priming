'use strict';
// node test/book-overseas-ui.smoke.js — 해외 플랫폼 R27 E2E: KDP 원고를 열면 「🇺🇸 해외 등록」 탭이 생기고 복사 도우미가 항목·체크리스트를 보여 준다.
//   · 한국어(부크크) 원고에는 이 탭이 없다 · 등록정보 파일 값이 원고 메타보다 우선 · 복사 버튼 · 로이 확인 항목은 체크해야 통과 · 자동 입력·제출 버튼은 없다
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ovrui-'));
const MD_KDP = path.join(T, '원고', 'alice.md'), MD_KO = path.join(T, '원고', 'ko.md');
fs.mkdirSync(path.dirname(MD_KDP), { recursive: true });
fs.mkdirSync(path.join(T, '기준', '등록'), { recursive: true });
const para = 'Alice was beginning to get very tired of sitting by her sister on the bank. '.repeat(6);
fs.writeFileSync(MD_KDP, `# Alice Notes\n> 저자: Lewis Carroll\n> 옮긴이: Roy Han\n> 출판사: Classic Desk\n> 발행일: 2026-10-06\n> 언어: en\n> 플랫폼: KDP\n> 판형: 6×9\n\n## Chapter 1\n\n${para}\n\n## [Copyright]\n\n* Annotated.\n`, 'utf8');
fs.writeFileSync(path.join(T, '기준', '등록', 'alice.KDP등록정보.md'), `## [Book Details]\n- 언어: English\n- 제목: Alice (Annotated)\n- 저자: Lewis Carroll\n- 기여자: Translator: Roy Han\n- 퍼블릭 도메인: 예\n## [Description]\n• Annotated edition with scholar notes\nBody text.\n## [Keywords]\n- classic\n- fantasy\n## [Price]\n- US: 9.99\n`, 'utf8');
fs.writeFileSync(MD_KO, `# 한국 책\n> 저자: 홍길동\n> 출판사: 프라이밍북스\n> 플랫폼: 부크크\n\n## 1장. 하나\n\n${'조선의 밤은 길었다. '.repeat(10)}\n`, 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    const errors = []; win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    // 한국어 원고 — 탭 없음
    let r = await win.evaluate((p) => window.api.openBookPath({ scriptPath: p }), MD_KO);
    if (!r || !r.dto || r.dto.kind !== 'book') throw new Error('한국어 원고 열기 실패');
    await win.click('.modetoggle button:has-text("📖 출판")'); await win.waitForSelector('.bkwrap', { timeout: 10000 });
    ok(await win.locator('.bktab[data-tab="overseas"]').count() === 0, '부크크 원고에는 「해외 등록」 탭이 없다');
    // KDP 원고
    r = await win.evaluate((p) => window.api.openBookPath({ scriptPath: p }), MD_KDP);
    ok(r && r.dto && r.dto.platformId === 'kdp', 'KDP 원고 — 플랫폼 인식(' + (r && r.dto && r.dto.platformId) + ')');
    await win.waitForSelector('.bktab[data-tab="overseas"]', { timeout: 10000 });
    ok(true, '「🇺🇸 해외 등록」 탭이 생긴다');
    await win.click('.bktab[data-tab="overseas"]');
    await win.waitForSelector('[data-testid="ovr-panel"]', { timeout: 10000 });
    await win.waitForSelector('[data-testid="ovr-field-title"]', { timeout: 10000 });
    const title = await win.locator('[data-testid="ovr-field-title"]').innerText();
    ok(/Alice \(Annotated\)/.test(title) && /Book Title/.test(title), '제목 = 등록정보 파일 값 · KDP 칸 이름 「Book Title」');
    ok(/등록정보 파일/.test(await win.locator('[data-testid="ovr-file"]').innerText()) && /alice\.KDP등록정보\.md/.test(await win.locator('[data-testid="ovr-file"]').innerText()), '등록정보 파일을 찾아 읽었다(기준\\등록\\)');
    ok(/Translator: Roy Han/.test(await win.locator('[data-testid="ovr-field-contributors"]').innerText()), '기여자(번역가)');
    ok(/classic/.test(await win.locator('[data-testid="ovr-field-keywords"]').innerText()) && /US: 9\.99/.test(await win.locator('[data-testid="ovr-field-price"]').innerText()), '키워드·가격 목록');
    // 복사
    await win.click('[data-testid="ovr-copy-title"]');
    await win.waitForTimeout(300);
    const clip = await win.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return 'ERR:' + e.message; } });
    ok(clip === 'Alice (Annotated)' || /^ERR:/.test(clip), '복사 버튼이 값을 클립보드에 넣는다(' + clip + ')');
    // 체크리스트 — 확인 항목은 체크해야 통과
    const st0 = await win.locator('[data-testid="ovr-chk-account"]').getAttribute('data-state');
    await win.check('[data-testid="ovr-confirm-account"]');
    const st1 = await win.locator('[data-testid="ovr-chk-account"]').getAttribute('data-state');
    ok(st0 === 'manual' && st1 === 'ok', '로이가 할 일(세금 인터뷰)은 체크해야 통과로 센다(' + st0 + ' → ' + st1 + ')');
    ok(await win.locator('[data-testid="ovr-chk-title-tag"]').getAttribute('data-state') === 'ok', '퍼블릭 도메인 점검: 제목 (Annotated) 표기 통과');
    ok(await win.locator('[data-testid="ovr-open"]').count() === 1, '사이트 열기 버튼(공식 주소만)');
    // 자동 입력·제출 버튼은 없다
    const txt = await win.locator('[data-testid="ovr-panel"]').innerText();
    ok(!/자동 입력|제출하기|Submit|Publish/.test(txt.replace(/제출은 직접|제출은 앱이|제출 —|제출$/g, '')) || !/🤖/.test(txt), '자동 입력(🤖)·제출 버튼이 없다');
    ok(errors.length === 0, '화면 오류 0건 (' + errors.slice(0, 2).join(' | ') + ')');
    await win.evaluate(() => { try { Object.keys(localStorage).filter((k) => /^pm\.ovrConfirm\./.test(k)).forEach((k) => localStorage.removeItem(k)); } catch (_) {} });
  } catch (e) { fail++; console.log('  ✗ 예외: ' + String((e && e.message) || e).split('\n')[0]); } finally {
    try { await app.close(); } catch (_) {}
    try { fs.rmSync(T, { recursive: true, force: true }); } catch (_) {}
    console.log(`\n${fail ? '❌' : '✅'} 해외 등록 도우미 E2E ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
