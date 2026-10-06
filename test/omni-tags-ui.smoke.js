'use strict';
/**
 * node test/omni-tags-ui.smoke.js — 🏷 OmniVoice 목소리 분류(언어·성별·연령대) 화면 E2E
 *   · 카드의 🏷 → 분류 창 → 저장하면 카드가 그 성별·연령대·언어로 거른다(서버 목소리 목록 필요 — 서버가 꺼져 있으면 건너뜀)
 *   · ⋯ → 「보이는 N개 한꺼번에 분류」
 *   · 분류 파일은 **임시 파일**(PRIMING_VOICE_TAGS_FILE) — 로이의 ~/.flow-app/omni-voice-tags.json 은 건드리지 않는다
 */
const { _electron: electron } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const TAGS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omnitags-ui-')), 'tags.json');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1', PRIMING_VOICE_TAGS_FILE: TAGS } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('[data-testid="tts-engine-btn"]', { timeout: 20000 });
    await win.locator('[data-testid="tts-engine-btn"]').click();
    await win.locator('[data-testid="tts-eng-card"]').waitFor({ timeout: 8000 });
    await win.locator('[data-testid="tts-tab-omnivoice"]').click(); await win.waitForTimeout(3000);
    await win.locator('[data-testid="tts-voice-lang"]').selectOption('').catch(() => {});
    const cards = win.locator('[data-testid="tts-voice-card"]');
    const n = await cards.count();
    if (!n) { console.log('  (OmniVoice 서버 목록이 비어 있음 — 화면 단언은 건너뜀)'); }
    else {
      ok(await win.locator('[data-testid="tts-voice-tag"]').count() === n, `OmniVoice 카드마다 🏷 단추 (${n}개)`);
      const first = cards.first(); const vid = await first.getAttribute('data-voice');
      await first.hover(); await first.locator('[data-testid="tts-voice-tag"]').click();
      await win.waitForSelector('[data-testid="tts-tag-dlg"]', { timeout: 5000 });
      await win.locator('[data-testid="tts-tag-gender"]').selectOption('female');
      await win.locator('[data-testid="tts-tag-age"]').selectOption('old');
      await win.locator('[data-testid="tts-tag-lang"]').selectOption('ja');
      await win.locator('[data-testid="tts-tag-save"]').click(); await win.waitForTimeout(2500);
      const saved = JSON.parse(fs.readFileSync(TAGS, 'utf8'));
      const nm = String(vid).replace(/^srv:/, '');
      ok(saved[nm] && saved[nm].gender === 'female' && saved[nm].age === 'old' && saved[nm].lang === 'ja', '분류가 저장된다 — ' + JSON.stringify(saved[nm]));
      // 거르기가 분류를 따른다
      await win.locator('[data-testid="tts-voice-lang"]').selectOption('').catch(() => {});
      await win.locator('[data-testid="tts-voice-age"]').selectOption('old'); await win.waitForTimeout(250);
      ok(await win.locator('[data-testid="tts-voice-card"][data-voice="' + vid + '"]').count() === 1, '연령대 「노년」으로 거르면 분류한 목소리가 나온다');
      ok(await cards.count() < n || n === 1, `다른 목소리는 걸러진다(${await cards.count()} / ${n})`);
      await win.locator('[data-testid="tts-voice-gender"]').selectOption('male'); await win.waitForTimeout(250);
      ok(await win.locator('[data-testid="tts-voice-card"][data-voice="' + vid + '"]').count() === 0, '성별 남성으로 거르면 여성으로 분류한 목소리는 빠진다(판정력)');
      await win.locator('[data-testid="tts-voice-gender"]').selectOption(''); await win.locator('[data-testid="tts-voice-age"]').selectOption(''); await win.waitForTimeout(200);
      // 한꺼번에 — 창만 확인(저장하지 않는다)
      await win.locator('[data-testid="tts-more"]').click(); await win.waitForTimeout(150);
      ok(await win.locator('[data-testid="tts-tag-many"]').count() === 1, '⋯ → 「보이는 N개 한꺼번에 분류」');
      await win.locator('[data-testid="tts-tag-many"]').click();
      await win.waitForSelector('[data-testid="tts-tag-dlg"]');
      ok(await win.locator('[data-testid="tts-tag-save"]').isDisabled(), '한꺼번에: 칸을 하나도 안 정하면 저장 단추가 막힌다');
      await win.keyboard.press('Escape'); await win.waitForTimeout(200);
      // 지우기
      await win.locator('[data-testid="tts-voice-card"][data-voice="' + vid + '"] [data-testid="tts-voice-tag"]').click();
      await win.locator('[data-testid="tts-tag-clear"]').click(); await win.waitForTimeout(2500);
      ok(!JSON.parse(fs.readFileSync(TAGS, 'utf8'))[nm], '분류 지우기');
    }
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} omni-tags-ui — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
