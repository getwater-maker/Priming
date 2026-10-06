'use strict';
/**
 * node test/roy-marks.smoke.js — 🟥 경험 · 🟨 해석 표시 + 로이은행 실제 앱 E2E (2026-10-06, v0.7.3)
 *   임시 대본(.md)을 열어 📄 대본 보기 → 색·칩·개수 → 「사실 확인」(고치지 않아도 확인 · 은행 「그대로」) →
 *   🟥 문단을 고쳐 저장(자동 확인 · 은행 「수정」 · 원문 = 처음 초안) → 🟨 문단을 고쳐 저장(해석해설은행) → 미확인 남은 편 TTS 관문.
 * ⚠ 은행·기억 파일은 PM_ROY_BANK_DIR · PM_ROY_HOME 임시 폴더 — 로이의 진짜 은행(_본사\로이은행)은 건드리지 않는다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TAG = `__로이표시테스트_${process.pid}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'roy-e2e-'));
const MD = path.join(TMP, `[역사_9999] ${TAG}.md`);
const BANK = path.join(TMP, 'bank'); fs.mkdirSync(BANK);
const RHOME = path.join(TMP, 'home');
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `[역사_9999] ${TAG}.smproj.json`);
const SCRIPT = [
  '# 로이 표시 테스트', '',
  '## 1장 시작', '', '> 🖼️ 이미지: a quiet room.',
  '첫 문장입니다. 둘째 문장입니다.', '',
  '> 📝 🟥 경험·가안',
  '손주 돌잔치 날 사진을 찍던 기억이 납니다. 그날은 비가 왔습니다.', '',
  '> 📝 🟥 경험·은행',
  '병원 대기실에서 한참을 기다렸습니다.', '',
  '> 📝 🟨 해석',
  '저는 이 대목에서 오래 멈춥니다.', '',
].join('\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const readMd = () => fs.readFileSync(MD, 'utf8');
const bankRows = (f) => { try { return fs.readFileSync(path.join(BANK, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

(async () => {
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const errs = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1', PM_ROY_BANK_DIR: BANK, PM_ROY_HOME: RHOME } });
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sblk', { timeout: 20000 });
    await win.locator('[data-testid="reader-open"]').click();
    await win.waitForSelector('[data-testid="script-reader"]', { timeout: 5000 });
    const R = win.locator('[data-testid="script-reader"]');
    const doc = R.locator('[data-testid="reader-doc"]');
    const cnt = () => R.locator('[data-testid="reader-roy"]').innerText().then((t) => t.replace(/\s+/g, ' ').trim());

    console.log('[1] 색 · 칩 · 개수');
    ok(/🟥 미확인 2 · 🟨 1/.test(await cnt()), `머리 개수 「${await cnt()}」`);
    ok(await doc.locator('[data-roy-confirm]').count() === 2, '🟥 미확인 문단마다 「사실 확인」 단추');
    ok(await doc.locator('[data-roy="exp"]').count() === 3 && await doc.locator('[data-roy="int"]').count() === 1, '🟥 문장 3개 · 🟨 문장 1개에 바탕색');
    const txt = await R.innerText();
    ok(!/📝 🟥|경험·가안\n/.test(await R.locator('[data-note]').allInnerTexts().then((a) => a.join('\n'))), '표시 줄은 📝 메모 칸에 안 나온다');
    ok(/🟥 경험·가안/.test(txt) && /🟨 해석/.test(txt), '칩에 표시 이름');
    // 🎯 헤더 숫자를 누르면 그 표시 자리로 — 누를 때마다 다음(끝 다음은 처음으로) (로이 2026-10-06 「노란 곳 클릭 1회 = 첫 번째, 한 번 더 = 다음」)
    {
      const msg = () => R.locator('[data-testid="reader-msg"]').innerText();
      const flashed = () => doc.evaluate((root) => [...root.querySelectorAll('[data-roy]')].filter((n) => n.style.outline).map((n) => n.innerText.slice(0, 14)));
      await R.locator('[data-testid="reader-roy-exp"]').click(); await win.waitForTimeout(250);
      ok(/미확인 경험 1 \/ 2/.test(await msg()), '🟥 한 번 → 첫 번째(1 / 2) — ' + (await msg()));
      const f1 = await flashed();
      ok(f1.length === 2 && /손주 돌잔치/.test(f1[0]) && !f1.some((t) => /첫 문장/.test(t)), '첫 🟥 표시(문장 2개)만 강조 · 같은 문단의 앞 문장은 아님 — ' + JSON.stringify(f1));
      await R.locator('[data-testid="reader-roy-exp"]').click(); await win.waitForTimeout(250);
      ok(/미확인 경험 2 \/ 2/.test(await msg()), '🟥 한 번 더 → 다음(2 / 2)');
      ok((await flashed()).some((t) => /병원 대기실/.test(t)), '둘째 🟥 표시가 강조된다(판정력 — 첫 번째와 다른 곳)');
      await R.locator('[data-testid="reader-roy-exp"]').click(); await win.waitForTimeout(250);
      ok(/미확인 경험 1 \/ 2/.test(await msg()), '🟥 한 번 더 → 끝 다음은 처음으로(1 / 2)');
      await R.locator('[data-testid="reader-roy-int"]').click(); await win.waitForTimeout(250);
      ok(/해석 1 \/ 1/.test(await msg()), '🟨 한 번 → 첫 번째(1 / 1) — ' + (await msg()));
      ok(/저는 이 대목/.test((await flashed()).join('|')), '🟨 문단이 강조된다');
    }
    ok(await doc.evaluate((el) => el.readerValue(0)) === '첫 문장입니다. 둘째 문장입니다. 손주 돌잔치 날 사진을 찍던 기억이 납니다. 그날은 비가 왔습니다. 병원 대기실에서 한참을 기다렸습니다. 저는 이 대목에서 오래 멈춥니다.', '🔑 칩은 글에 섞이지 않는다(문단 글 = 문장만)');

    console.log('[2] 사실 확인 — 고치지 않아도');
    await doc.locator('[data-roy-confirm]').first().click();
    await win.waitForFunction(() => /사실 확인/.test((document.querySelector('[data-testid=reader-msg]') || {}).textContent || ''), null, { timeout: 8000 });
    let md = readMd();
    ok(md.includes('> 📝 🟥 경험·확인\n손주 돌잔치') && md.includes('> 📝 🟥 경험·은행\n병원'), '그 표시 줄만 「확인」(다른 표시는 그대로)');
    ok(/🟥 미확인 1/.test(await cnt()) && await doc.locator('[data-roy-confirm]').count() === 1, '개수·단추가 줄었다');
    let E = bankRows('경험은행.jsonl');
    ok(E.length === 1 && E[0].확인 === '그대로' && E[0].원문 === E[0].수정 && E[0].원문.startsWith('손주 돌잔치') && E[0].편 === '[역사_9999]', `경험은행 한 줄 「그대로」 (${E[0] && E[0].id})`);

    console.log('[3] 🟥 문단을 고쳐 저장 — 자동 확인 · 원문 = 처음 초안');
    const swap = (i, a, b) => doc.evaluate((root, [i, a, b]) => {
      const p = [...root.querySelectorAll('p[data-key]')].find((x) => x.textContent.includes(a));
      const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) { if (t.nodeValue.includes(a) && !t.parentElement.closest('[data-ne]')) break; }
      t.nodeValue = t.nodeValue.replace(a, b); root.focus(); root.dispatchEvent(new Event('input', { bubbles: true }));
    }, [i, a, b]);
    await swap(2, '병원 대기실에서 한참을', '아내와 병원 대기실에서 한참을');
    await win.waitForTimeout(2800);
    md = readMd();
    ok(md.includes('> 📝 🟥 경험·확인\n아내와 병원 대기실에서'), '고친 글이 저장되고 표시가 「확인」으로');
    E = bankRows('경험은행.jsonl');
    const e2 = E[E.length - 1];
    ok(E.length === 2 && e2.확인 === '수정' && e2.원문 === '병원 대기실에서 한참을 기다렸습니다.' && e2.수정 === '아내와 병원 대기실에서 한참을 기다렸습니다.', '경험은행 「Claude 원문 → 로이 수정」 한 쌍');
    ok(e2.id !== E[0].id, '다른 표시는 다른 id');
    await win.waitForTimeout(400);
    ok(/🟥 미확인 0/.test(await cnt()) && await doc.locator('[data-roy-confirm]').count() === 0, '미확인 0 · 단추 없음(칩을 새로 그렸다)');

    console.log('[4] 🟨 문단을 고쳐 저장 — 해석해설은행');
    await swap(3, '오래 멈춥니다', '한참 멈춰 섭니다');
    await win.waitForTimeout(2800);
    const I = bankRows('해석해설은행.jsonl');
    ok(I.length === 1 && I[0].원문 === '저는 이 대목에서 오래 멈춥니다.' && I[0].수정 === '저는 이 대목에서 한참 멈춰 섭니다.' && I[0].구분 === '해석' && /^I-/.test(I[0].id), '해석해설은행 한 쌍');
    ok(readMd().includes('> 📝 🟨 해석\n저는 이 대목에서 한참'), '🟨 표시 줄은 그대로(상태 없음)');

    console.log('[5] 미확인 🟥 이 남은 편 — TTS 관문');
    await R.locator('button:has-text("닫기")').click();
    fs.writeFileSync(MD, readMd().replace('> 📝 🟥 경험·확인\n손주', '> 📝 🟥 경험·가안\n손주'), 'utf8');   // 밖에서 다시 가안으로
    await win.waitForTimeout(3500);   // 밖에서 바뀐 .md 를 다시 읽는다(1.5초 감시)
    await app.evaluate(({ dialog }) => { global.__royAsk = 0; dialog.showMessageBox = async () => { global.__royAsk++; return { response: 0 }; }; });
    const r = await win.evaluate(() => window.api.ttsBuild({ presetName: '__없는채널__', speed: 1 }));
    const asked = await app.evaluate(() => global.__royAsk);
    ok(asked === 1 && r && r.error === 'roy-open', `미확인 1곳 → 묻고(${asked}번) 멈춤 → TTS 안 함`);
    ok(errs.length === 0, `화면 오류 없음${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  } catch (e) { fail++; console.log('  ✗ 예외: ' + (e && e.stack || e)); }
  finally {
    await app.close().catch(() => {});
    for (const f of [SNAP]) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(`\n${fail ? '✗' : '✓'} roy-marks E2E: ${pass} 통과 · ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
