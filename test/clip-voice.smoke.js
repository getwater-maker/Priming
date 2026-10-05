'use strict';
/**
 * node test/clip-voice.smoke.js — 🎙 대본·클립 목소리 실제 앱 E2E (v0.6.83 · 로이 2026-10-05)
 *   ① 클립 「🗣 내레이션」을 누르면 음성 설정 팝업(이 클립 모드)
 *   ② 리본 「🔊 음성 설정」 = 열린 대본 모드(대본 이름이 보인다)
 *   ③ 팝업이 떠 있으면 검은 클립 막대가 숨는다(채널편집 위로 튀어나오던 것)
 *   ④ set-clip-voice · set-script-voice → 「🗣」 배지·작업본·큐에 반영(합성은 하지 않는다 · 음성 서버 불필요)
 * ⚠ 사용자 작업물 보호 — 임시 채널 + 임시 대본 · 끝나면 지운다. 채널 목록 파일은 전후 비교.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const menu = require('./_menu');

const ROOT = path.join(__dirname, '..');
const TAG = `__클립목소리테스트_${process.pid}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'));
const MD = path.join(TMP, `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const CH = '__테스트채널_삭제해도됨_클립목소리_' + process.pid;
const PRESETS = path.join(os.homedir(), '.flow-app', 'tts-presets.json');
const SCRIPT = ['# 클립 목소리 테스트', '', '## 도입부', '### 〔첫 장면〕', '> 🖼️ 이미지: a red room',
  '첫째 문장입니다. 둘째 문장입니다.', ''].join('\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

(async () => {
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const presetsBefore = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS, 'utf8') : null;
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false;
  try {
    const win = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 820); });
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async ({ name, dir }) => {
      await window.api.addPreset({ name });
      await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, voiceCloneRefAudio: 'srv:채널목소리' } });
    }, { name: CH, dir: TMP });
    chMade = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((n) => [...document.querySelectorAll('select option')].some((o) => o.value === n), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await win.waitForTimeout(600);

    // ⓪ 대본 없이 리본 버튼 = 채널 기본(채널 목록)
    await win.locator('[data-testid="tts-engine-btn"]').click();
    await win.locator('[data-testid="tts-eng-card"]').waitFor({ timeout: 8000 });
    ok(await win.locator('[data-testid="tts-chan-list"]').count() === 1 && /채널 기본/.test(await win.locator('[data-testid="tts-mode"]').innerText()), '대본이 없으면 리본 🔊 = 채널 기본 목소리(채널 목록)');
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);

    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent.clip', { timeout: 20000 });

    // ③ 클립을 고르면 검은 막대 → 팝업이 뜨면 숨는다
    await win.locator('.sent[data-ln="1"] .clip-no').click(); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="clip-tb"]').isVisible(), '클립을 고르면 검은 클립 막대가 보인다');

    // ① 클립 「🗣」 → 이 클립 모드
    const spk = win.locator('.sent[data-ln="1"] [data-testid="clip-spk"]');
    ok((await spk.innerText()).includes('내레이션') && /누르면 🔊 음성 설정/.test(await spk.getAttribute('title')), '「🗣 내레이션」에 누르기 안내');
    await spk.click();
    await win.locator('[data-testid="tts-eng-card"]').waitFor({ timeout: 8000 });
    ok(await win.locator('[data-testid="tts-target"]').count() === 1 && await win.locator('[data-testid="tts-chan-list"]').count() === 0, '🗣 → 음성 설정 = 이 클립 모드(채널 목록 대신 대상 칸)');
    ok(/이 클립만/.test(await win.locator('[data-testid="tts-mode"]').innerText()) && /첫째 문장입니다/.test(await win.locator('[data-testid="tts-target"]').innerText()), '대상 칸에 그 클립 문장');
    ok(/이 클립에 적용/.test(await win.locator('[data-testid="tts-eng-save"]').innerText()), '버튼 = 「이 클립에 적용」');
    ok(!(await win.locator('[data-testid="clip-tb"]').isVisible()), '🔑 팝업이 떠 있으면 검은 클립 막대가 숨는다');
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="tts-eng-card"]').count() === 0, 'Esc 로 닫힌다(아무것도 안 바뀜)');

    // ② 리본 🔊 → 열린 대본 모드(클립을 고르면 리본이 서식으로 바뀐다 → 대본·음성으로)
    await menu(win, 'script');
    { const info = await win.locator('[data-testid="tts-engine-btn"]').evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { vis: r.width + 'x' + r.height + '@' + Math.round(r.left) + ',' + Math.round(r.top), hit: t ? (t.className || t.tagName) + '' : null, inside: !!t && el.contains(t) }; });
      ok(info.inside, `리본 🔊 버튼이 실제로 눌리는 자리 (${JSON.stringify(info)})`); }
    await win.locator('[data-testid="tts-engine-btn"]').click({ timeout: 5000 });
    await win.locator('[data-testid="tts-eng-card"]').waitFor({ timeout: 8000 });
    ok(/열려 있는 대본 1개/.test(await win.locator('[data-testid="tts-mode"]').innerText()) && (await win.locator('[data-testid="tts-target"]').innerText()).includes(TAG), '리본 🔊 = 열린 대본 모드(대본 이름)');
    ok(/열린 대본에 적용/.test(await win.locator('[data-testid="tts-eng-save"]').innerText()), '버튼 = 「열린 대본에 적용」');
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);

    // ④ 실제 적용(합성 없음) — 클립 목소리
    const r1 = await win.evaluate(async () => window.api.setClipVoice({ shortsNum: 1, items: [{ groupNum: 1, sentIdx: 0 }], voice: { voiceEngine: { id: 'omnivoice' }, ref: 'srv:클립목소리', label: '클립목소리' } }));
    ok(r1 && r1.ok && r1.changed === 1, '클립 목소리 적용');
    ok(r1.dto.projects[0].cuts[0].sentences[0].tv === '☁ 클립목소리' && !r1.dto.projects[0].cuts[0].sentences[1].tv, 'DTO = 그 문장만');
    const r0 = await win.evaluate(async () => window.api.setClipVoice({ shortsNum: 1, items: [{ groupNum: 1, sentIdx: 0 }], voice: { voiceEngine: { id: 'omnivoice' }, ref: 'C:\\x.wav' } }));
    ok(r0 && !r0.ok, '틀린 목소리 값(서버 목소리 아님)은 거절');
    // 화면 배지 — 대본을 다시 고르면 DTO 를 다시 받는다
    await win.locator('.sent[data-ln="2"] .clip-no').click(); await win.waitForTimeout(200);
    const r2 = await win.evaluate(async () => window.api.setScriptVoice({ voice: { voiceEngine: { id: 'omnivoice' }, ref: 'srv:대본목소리', label: '대본목소리' }, dry: true }));
    ok(r2 && r2.ok && r2.rows.length === 1 && r2.rows[0].changed && r2.rows[0].audio === 0, '대본 목소리 미리 세기(dry · 음성 0개)');
    const r3 = await win.evaluate(async () => window.api.setScriptVoice({ voice: { voiceEngine: { id: 'omnivoice' }, ref: 'srv:대본목소리', label: '대본목소리' } }));
    ok(r3 && r3.ok && r3.dto && r3.dto.projects[0].ttsVoiceText === '☁ 대본목소리', '대본 목소리 적용 → DTO');
    const q = await win.evaluate(async () => window.api.listQueue());
    ok(q && q.queue.longform.items[0].ttsVoice && q.queue.longform.items[0].ttsVoice.ref === 'srv:대본목소리', '큐 항목에 대본 목소리');
    const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
    ok(snap.projects[0].ttsVoice && snap.projects[0].ttsVoice.ref === 'srv:대본목소리' && snap.projects[0].groups[0].sentences[0].tv && snap.projects[0].groups[0].sentences[0].tv.ref === 'srv:클립목소리', '🔑 작업본(.smproj)에 대본·클립 목소리가 저장된다');
    // 화면 배지 갱신 — 클립 「🗣」 다시 열기 = 지금 목소리 표시
    await win.reload(); await win.waitForSelector('.sent.clip', { timeout: 20000 });
    const spk1 = win.locator('.sent[data-ln="1"] [data-testid="clip-spk"]');
    ok((await spk1.innerText()).includes('클립목소리') && /own/.test(await spk1.getAttribute('class')), '🗣 배지 = 클립 목소리 이름(파랗게)');
    ok(/대본 목소리: ☁ 대본목소리/.test(await win.locator('.sent[data-ln="2"] [data-testid="clip-spk"]').getAttribute('title')), '다른 클립 = 대본 목소리 안내');
    await spk1.click(); await win.locator('[data-testid="tts-eng-card"]').waitFor({ timeout: 8000 });
    ok(/클립목소리/.test(await win.locator('[data-testid="tts-target"]').innerText()) && await win.locator('[data-testid="tts-target-clear"]').isEnabled(), '다시 열면 지금 목소리 · 「되돌리기」 켜짐');
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);   // 「되돌리기」는 누르지 않는다(그 클립 음성을 실제로 다시 만든다 — 음성 서버를 쓴다)
    const r4 = await win.evaluate(async () => window.api.setClipVoice({ shortsNum: 1, items: [{ groupNum: 1, sentIdx: 0 }], voice: null }));
    ok(r4 && r4.ok && r4.changed === 1 && !r4.dto.projects[0].cuts[0].sentences[0].tv, '클립 목소리 지우기(null) → 대본/채널 목소리로');
    ok(errors.length === 0, `화면 오류 0건 (${errors.join(' | ')})`);
  } catch (e) { fail++; console.log('  ✗ 예외: ' + String((e && e.message) || e).split('\n')[0]); } finally {
    if (chMade) { try { await (await app.firstWindow()).evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    try { await app.close(); } catch (_) {}
    for (const f of [SNAP]) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    const after = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS, 'utf8') : null;
    ok(after === presetsBefore, '로이 채널 설정(tts-presets.json) 전후 동일');
    console.log(`\n${fail ? '❌' : '✅'} 클립 목소리 E2E ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
