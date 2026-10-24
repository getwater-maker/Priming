'use strict';
/**
 * node test/api-key-ui.smoke.js — ⚙ 설정 → 🔑 API 키 탭의 「✔ 검증」(E2E)
 *   · 키마다 검증 단추 + 「🔍 모든 키 검증」
 *   · 나노바나나(Gemini) 칸에 **엉터리 키**를 붙여넣고 ✔ 검증 → ❌ 결과 줄(통과로 나오면 안 된다 — 판별력). 네트워크가 없어도 ❌(연결 실패)라 결과는 같다.
 *   ⚠ 엉터리 키는 저장하지 않는다(입력만 하고 blur 하지 않는다 — 로이의 저장된 키를 덮지 않게).
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.click('button[title^="통합 설정"]');
    await win.click('button:has-text("🔑 API 키")');
    await win.waitForSelector('[data-testid=keychk-all]', { timeout: 10000 });
    for (const id of ['gemini-image', 'gemini', 'mai', 'typecast', 'elevenlabs']) ok(await win.locator('[data-testid=keychk-btn-' + id + ']').count() === 1, `「✔ 검증」 단추: ${id}`);
    ok(await win.locator('[data-testid=keychk-btn-xai]').count() === 0, '🎬 Grok API 키 칸은 없다(v0.7.40 제거)');
    ok(await win.locator('[data-testid=claude-key-in]').count() === 1 && await win.locator('[data-testid=keychk-btn-claude]').count() === 1, '🤖 Claude API 키 칸 · 「✔ 검증」 단추(v0.7.93)');
    try { await win.locator('[data-testid=claude-key]').screenshot({ path: process.env.PM_SHOT || require('path').join(require('os').tmpdir(), 'claude-key-card.png') }); } catch {}
    // 엉터리 키 → 거부 (저장은 blur 에서만 — 입력 뒤 바로 검증 단추를 눌러 blur 가 저장하지 않게 mousedown 대신 evaluate 클릭)
    const box = win.locator('input[placeholder="🔑 Gemini API 키 (이미지 전용)"]');
    const had = await box.inputValue();
    await box.fill('bogus-key-for-test-0000');
    await win.evaluate(() => document.querySelector('[data-testid=keychk-btn-gemini-image]').click());
    await win.waitForSelector('[data-testid=keychk-gemini-image]', { timeout: 30000 });
    const lv = await win.locator('[data-testid=keychk-gemini-image]').getAttribute('data-level');
    ok(lv === 'bad', '엉터리 키 → ❌ 거부로 표시 — ' + (await win.locator('[data-testid=keychk-gemini-image]').innerText()));
    await box.fill(had);   // 되돌림(저장 안 됨)

    // ── v0.9.92 판매자/회원 화면(로이 2026-10-21) — 판매자 = 개발 실행(회원 확인 없음 = owner) ──
    const tabs = async () => (await win.locator('.st-tabs button').allInnerTexts()).map((t) => t.trim());
    let t = await tabs();
    ok(JSON.stringify(t) === JSON.stringify(['🔑 API 키', '🖧 서버', '📺 채널 연결', '📁 폴더', '👤 계정']), '판매자 탭 = API 키·서버·채널 연결·폴더·계정 — ' + t.join(' · '));
    ok(await win.locator('[data-testid=member-ai-card]').count() === 0, '판매자 화면엔 회원 포인트 안내가 없다');
    await win.click('.st-tabs button[data-tab=server]');
    const srv = win.locator('[data-testid=server-tab]'); await srv.waitFor({ timeout: 5000 });
    const st = await srv.innerText();
    ok(/OmniVoice/.test(st) && /영상 업스케일/.test(st) && !/ComfyUI|LTX2\.5|워크플로/.test(st), '🖧 서버 탭 = TTS 서버 + 영상 업스케일만(ComfyUI 칸 없음)');
    await win.click('.st-x');

    // ── 회원 = license-state 를 회원 응답으로 바꾸고 다시 읽기 ──
    await app.evaluate(({ ipcMain }) => {
      const m = { ok: true, enforced: true, owner: false, admin: false, email: 'member@example.com', points: { granted: 100, remaining: 40 } };
      for (const n of ['license-state', 'license-recheck']) { ipcMain.removeHandler(n); ipcMain.handle(n, () => m); }
    });
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.click('button[title^="통합 설정"]');
    await win.waitForSelector('[data-testid=keychk-all]', { timeout: 10000 });
    t = await tabs();
    ok(JSON.stringify(t) === JSON.stringify(['🔑 API 키', '📺 채널 연결', '📁 폴더', '👤 계정']), '회원 탭 = API 키·채널 연결·폴더·계정 — ' + t.join(' · '));
    ok(await win.locator('[data-testid=member-ai-card]').count() === 1 && /남은 40 크레딧/.test(await win.locator('[data-testid=member-ai-card]').innerText()), '회원 🔑 맨 위 = 🪙 크레딧 안내(남은 40 크레딧)');
    ok(/내 kie\.ai 키/.test(await win.locator('[data-testid=kie-key]').innerText()), '회원 kie 칸 = 「내 키 (선택)」');
    ok(await win.locator('[data-testid=gemini-image-key]').count() === 0, '회원에겐 나노바나나 칸이 없다');
    ok(await win.locator('[data-testid=claude-key]').count() === 1 && await win.locator('[data-testid=tts-keys]').count() === 1, '회원도 Claude·TTS 키 칸은 있다');
    await win.click('.st-x');
    // 💳 헤더 크레딧 칸(v0.9.93) — 회원 = 「🪙 크레딧 남은 40 / 지급 100」 · ⛔ kie 이름 없음
    await require('./_menu')(win, 'help');
    { const h = await win.locator('[data-testid=member-points]').innerText();
      ok(/크레딧 남은 40/.test(h) && /지급 100/.test(h) && !/kie|포인트/i.test(h + (await win.locator('[data-testid=member-points]').getAttribute('title'))), '회원 헤더 = 크레딧 남은 40 / 지급 100 (kie·포인트 낱말 없음) — ' + h); }
    // 관리자 = 우리 kie 계정 잔액 「🧩 kie크레딧 남은 786」(지급 칸 없음)
    await app.evaluate(({ ipcMain }) => {
      const m = { ok: true, enforced: true, owner: true, admin: true, email: 'admin@example.com', points: null, kie: 786 };
      for (const n of ['license-state', 'license-recheck']) { ipcMain.removeHandler(n); ipcMain.handle(n, () => m); }
    });
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await require('./_menu')(win, 'help'); await win.waitForSelector('[data-testid=member-points]', { timeout: 20000 });
    { const h = await win.locator('[data-testid=member-points]').innerText();
      ok(/kie크레딧 남은 786/.test(h) && !/지급/.test(h), '관리자 헤더 = kie크레딧 남은 786 — ' + h); }
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} api-key-ui — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
