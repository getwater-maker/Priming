'use strict';
/**
 * node test/clip-voice.smoke.js — 🎙 대본·화자 목소리 실제 앱 E2E (v0.6.83~84 · 로이 2026-10-05)
 *   ① 클립 「🗣」을 누르면 음성 설정 팝업 = **이 대본의 그 화자 클립 모두**(🗣 내레이션 = 이 대본 내레이션 · 🗣 엄마 = 「엄마」 클립 모두)
 *   ② 리본 「🔊 음성 설정」 = 열린 대본 모드(대본 이름이 보인다)
 *   ③ 팝업이 떠 있으면 검은 클립 막대가 숨는다(채널편집 위로 튀어나오던 것)
 *   ④ set-speaker-voice · set-script-voice → 「🗣」 배지·작업본·큐·💰 예상 비용에 반영(합성은 하지 않는다 · 음성 서버 불필요)
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
  '첫째 문장입니다. 둘째 문장입니다.', '[엄마] 얘야, 밥 먹어라.', '셋째 문장입니다.', '[엄마] 어서 들어오너라.', ''].join('\n');

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
    await win.locator('.sent[data-ln="1"] .clip-chk').click(); await win.waitForTimeout(300);   // v0.7.80 — 막대는 체크박스로 고른 클립에만
    ok(await win.locator('[data-testid="clip-tb"]').isVisible(), '클립을 고르면 검은 클립 막대가 보인다');

    // ① 클립 「🗣 내레이션」 → 이 대본의 내레이션(클립 모두)
    const clip = (t) => win.locator('.sent.clip', { hasText: t }).first().locator('[data-testid="clip-spk"]');
    const spk = clip('첫째 문장입니다');
    ok((await spk.innerText()).includes('내레이션') && /내레이션 클립 모두/.test(await spk.getAttribute('title')), '「🗣 내레이션」에 누르기 안내(이 대본 내레이션 클립 모두)');
    await spk.click();
    await win.locator('[data-testid="tts-eng-card"]').waitFor({ timeout: 8000 });
    ok(await win.locator('[data-testid="tts-target"]').count() === 1 && await win.locator('[data-testid="tts-chan-list"]').count() === 0, '🗣 → 음성 설정 = 대상 칸(채널 목록 대신)');
    { const m = await win.locator('[data-testid="tts-mode"]').innerText(); const t = await win.locator('[data-testid="tts-target"]').innerText();
      ok(/이 대본의 내레이션 목소리 — 클립 5개/.test(m) && t.includes(TAG), `🔑 내레이션 = 이 대본의 내레이션 클립 모두(5개 — 「엄마」는 아직 목소리가 없어 내레이션 목소리로 읽는다) (${m.replace(/\s+/g, ' ')})`); }
    ok(/내레이션에 적용/.test(await win.locator('[data-testid="tts-eng-save"]').innerText()), '버튼 = 「내레이션에 적용」');
    ok(!(await win.locator('[data-testid="clip-tb"]').isVisible()), '🔑 팝업이 떠 있으면 검은 클립 막대가 숨는다');
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="tts-eng-card"]').count() === 0, 'Esc 로 닫힌다(아무것도 안 바뀜)');
    // 🗣 엄마 → 「엄마」 클립 모두
    await clip('밥 먹어라').click();
    await win.locator('[data-testid="tts-eng-card"]').waitFor({ timeout: 8000 });
    ok(/이 대본의 화자 「엄마」 목소리 — 클립 2개/.test(await win.locator('[data-testid="tts-mode"]').innerText()) && /화자 「엄마」에 적용/.test(await win.locator('[data-testid="tts-eng-save"]').innerText()), '🔑 🗣 엄마 = 이 대본 「엄마」 클립 2개 모두 · 「화자 「엄마」에 적용」');
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);

    // ② 리본 🔊 → 열린 대본 모드(클립을 고르면 리본이 서식으로 바뀐다 → 대본·음성으로)
    await menu(win, 'script');
    { const info = await win.locator('[data-testid="tts-engine-btn"]').evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { vis: r.width + 'x' + r.height + '@' + Math.round(r.left) + ',' + Math.round(r.top), hit: t ? (t.className || t.tagName) + '' : null, inside: !!t && el.contains(t) }; });
      ok(info.inside, `리본 🔊 버튼이 실제로 눌리는 자리 (${JSON.stringify(info)})`); }
    await win.locator('[data-testid="tts-engine-btn"]').click({ timeout: 5000 });
    await win.locator('[data-testid="tts-eng-card"]').waitFor({ timeout: 8000 });
    ok(/열려 있는 대본 1개/.test(await win.locator('[data-testid="tts-mode"]').innerText()) && (await win.locator('[data-testid="tts-target"]').innerText()).includes(TAG), '리본 🔊 = 열린 대본 모드(대본 이름)');
    ok(/열린 대본에 적용/.test(await win.locator('[data-testid="tts-eng-save"]').innerText()), '버튼 = 「열린 대본에 적용」');
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);

    // ④ 실제 적용(합성 없음)
    const MAI = { voiceEngine: { id: 'mai', model: 'MAI-Voice-2.1', voice: 'ko-KR-Haena' }, label: '해나' };
    const r1 = await win.evaluate(async (v) => window.api.setSpeakerVoice({ speaker: '엄마', voice: v }), MAI);
    ok(r1 && r1.ok && r1.changed && r1.clips === 2, '「엄마」 목소리 적용 — 클립 2개');
    ok(r1.dto.projects[0].spkVoiceText && /MAI-Voice · 해나/.test(r1.dto.projects[0].spkVoiceText['엄마']) && !r1.dto.projects[0].ttsVoiceText, 'DTO = 이 대본 화자 목소리만(내레이션은 그대로)');
    const r0 = await win.evaluate(async () => window.api.setSpeakerVoice({ speaker: '엄마', voice: { voiceEngine: { id: 'omnivoice' }, ref: 'C:\\x.wav' } }));
    ok(r0 && !r0.ok, '틀린 목소리 값(서버 목소리 아님)은 거절');
    const rx = await win.evaluate(async () => window.api.setSpeakerVoice({ speaker: '없는화자', voice: null, dry: true }));
    ok(rx && !rx.ok, '이 대본에 없는 화자 = 거절');
    const rn = await win.evaluate(async () => window.api.setSpeakerVoice({ speaker: null, voice: { voiceEngine: { id: 'omnivoice' }, ref: 'srv:내레목소리', label: '내레목소리' } }));
    ok(rn && rn.ok && rn.clips === 3 && rn.dto.projects[0].ttsVoiceText === '☁ 내레목소리', '🗣 내레이션 적용 = 이 대본 내레이션(클립 3개)');
    const q = await win.evaluate(async () => window.api.listQueue());
    ok(q && q.queue.longform.items[0].ttsVoice && q.queue.longform.items[0].ttsVoice.ref === 'srv:내레목소리', '큐 항목에 대본 목소리');
    const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
    ok(snap.projects[0].ttsVoice && snap.projects[0].ttsVoice.ref === 'srv:내레목소리' && snap.projects[0].spkVoices && snap.projects[0].spkVoices['엄마'].voiceEngine.id === 'mai', '🔑 작업본(.smproj)에 내레이션·화자 목소리가 저장된다');
    // 화면 배지 · 💰
    await win.reload(); await win.waitForSelector('.sent.clip', { timeout: 20000 });
    await win.waitForTimeout(800);
    ok(/own/.test(await clip('밥 먹어라').getAttribute('class')) && /own/.test(await clip('어서 들어오너라').getAttribute('class')) && /MAI-Voice · 해나/.test(await clip('어서 들어오너라').getAttribute('title')), '🗣 엄마 배지 둘 다 = 이 대본 화자 목소리(파랗게)');
    ok(/own/.test(await clip('셋째 문장입니다').getAttribute('class')) && /내레목소리/.test(await clip('셋째 문장입니다').getAttribute('title')), '🗣 내레이션 배지 = 이 대본 내레이션 목소리');
    { const tt = await win.locator('[data-testid="tts-cost"]').getAttribute('title');
      ok(/MAI-Voice · ko-KR-Haena \d+자/.test(tt) && /OmniVoice \d+자/.test(tt), `💰 예상 비용 = 목소리별(엄마 = MAI · 내레이션 = OmniVoice) (${(tt || '').split('\n')[2] || ''})`);
      ok(!/무료/.test(await win.locator('[data-testid="tts-cost"]').innerText()), '💰 유료 목소리(엄마)가 있어 「무료」가 아니다'); }
    await clip('밥 먹어라').click(); await win.locator('[data-testid="tts-eng-card"]').waitFor({ timeout: 8000 });
    ok(/해나|ko-KR-Haena/.test(await win.locator('[data-testid="tts-target"]').innerText()) && await win.locator('[data-testid="tts-target-clear"]').isEnabled(), '다시 열면 지금 목소리 · 「되돌리기」 켜짐');
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
    const r4 = await win.evaluate(async () => window.api.setSpeakerVoice({ speaker: '엄마', voice: null }));
    ok(r4 && r4.ok && r4.changed && !r4.dto.projects[0].spkVoices, '「엄마」 목소리 지우기(null) → 채널 화자/내레이션 목소리로');
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
