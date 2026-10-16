'use strict';
/**
 * node test/youtube-ui.smoke.js — ⬆ 유튜브 업로드 화면 E2E (2026-09-24)
 *   ⚙ 설정 → 📺 채널 연결 탭 · 채널편집 📁 폴더 → ⬆ 자동 업로드 줄을 실제로 연다.
 *   ⚠ 아무것도 저장·연결하지 않는다(ESC 로 닫는다) — 사용자 설정 무변경. 구글에 닿지 않는다.
 */
const path = require('path');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errs = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });

    const st = await win.evaluate(() => window.api.ytStatus());
    ok(st && typeof st.hasClient === 'boolean' && Array.isArray(st.channels), `yt-status 응답 (연결 파일 ${st.hasClient ? '있음' : '없음'} · 채널 ${st.channels.length})`);
    ok(st.available === true, 'Electron 안에서 OS 암호화(safeStorage) 사용 가능');
    ok(!JSON.stringify(st).match(/secret|refresh/i), '상태에 비밀값 없음');

    // ⚙ 설정 → 📺 채널 연결
    await win.locator('button:has-text("⚙ 설정")').first().click();
    await win.waitForTimeout(500);
    await win.locator('.modal-card.wide button:has-text("📺 채널 연결")').first().click();
    await win.waitForTimeout(500);
    ok(await win.locator('[data-testid="yt-client"] [data-testid="yt-source"]').count() === 1 && /Priming 기본 연결|내 구글 프로젝트/.test(await win.locator('[data-testid="yt-source"]').innerText()), '① 「앱 연결」 — Priming 기본 연결이 들어 있어 파일을 가져올 필요가 없다(v0.5.91)');
    ok(await win.locator('[data-testid="yt-client"] [data-testid="yt-import"], [data-testid="yt-client"] [data-testid="yt-use-default"]').count() === 1, '고급: 내 프로젝트 파일… / ↩ 기본으로 버튼 한 개');
    const conn = win.locator('[data-testid="yt-channels"] [data-testid="yt-add-channel"]');
    ok(await conn.count() === 1 && /새 채널 추가/.test(await conn.innerText()), '② 카드 맨 끝 「＋ 새 채널 추가」(v0.9.36 — 위쪽 「🔗 채널 연결」 버튼 대신)');
    ok((await conn.isDisabled()) === !st.hasClient, '연결 파일이 없으면 채널 추가가 잠긴다');
    ok(await win.locator('[data-testid="yt-ch-reconnect"]').count() === st.channels.length, `카드마다 「🔄 다시 연결」(${st.channels.length}개)`);
    ok(await win.locator('[data-testid="yt-channels"] button:has-text("🔗 채널 연결")').count() === 0, '위쪽 공용 「🔗 채널 연결」 버튼은 없다');
    ok(await win.locator('text=비공개').count() > 0 && await win.locator('text=AI 합성 콘텐츠 표시').count() === 1, '안내: 비공개 · AI 합성 표시');
    // 👥 순서 = 구독자 많은 순(v0.9.37 — 끌어서 바꾸기는 뺐다) · 카드마다 구독자 줄
    {
      const rows = win.locator('[data-testid="yt-ch-row"]');
      ok(await rows.count() === st.channels.length && await win.locator('[data-testid="yt-ch-subs"]').count() === st.channels.length, `채널 카드 ${st.channels.length}개 · 카드마다 👥 구독자 줄`);
      const subs = st.channels.map((c) => (c.subs != null ? c.subs : -1));
      ok(subs.every((v, i) => i === 0 || subs[i - 1] >= v), `yt-status 가 구독자 많은 순으로 준다 (${subs.join(" ≥ ")})`);
      const shown = await rows.allInnerTexts();
      ok(st.channels.every((c, i) => shown[i] && shown[i].includes(c.title)), "화면 카드도 같은 순서");
      ok(await win.locator('[data-testid="yt-ch-row"][draggable="true"]').count() === 0, "카드는 끌리지 않는다");
    }
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    // 채널편집 📁 폴더 → ⬆ 자동 업로드
    await win.click('button[title^="채널(프리셋)"]');
    await win.waitForTimeout(700);
    const card = win.locator('.modal-card.tabbed').first();
    const heights = {};
    for (const t of ['🏠', '🎙', '📝', '🖼', '📁']) {
      await card.locator(`button:has-text("${t}")`).first().click();
      await win.waitForTimeout(250);
      heights[t] = await card.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    }
    const row = card.locator('[data-testid="yt-card"]');   // v0.9.18 가로 카드 한 줄(옛 「업로드채널」 줄)
    ok(await row.count() === 1, '📁 폴더 탭에 ⬆ 업로드 카드');
    ok(await row.locator('[data-testid="ch-yt-playlist"]').count() === 1, '🧷 업로드 카드에 재생목록 이름 칸(v0.9.33)');
    const sel = row.locator('select');
    const firstOpt = await sel.locator('option').first().textContent();
    ok(st.channels.length ? /올릴 채널/.test(firstOpt) : /연결 없음/.test(firstOpt), `채널 목록 첫 줄: 「${firstOpt}」`);
    ok(await sel.locator('option').count() >= 1 + st.channels.length, '연결된 채널이 목록에 나온다');
    const vals = Object.values(heights);
    console.log('   탭 높이', JSON.stringify(heights));
    ok(Math.max(...vals) - Math.min(...vals) <= 4, '탭을 바꿔도 창 높이가 그대로(±4px)');
    const vh = await win.evaluate(() => window.innerHeight);
    ok(heights['📁'] <= vh, '📁 탭이 화면 안');
    await win.keyboard.press('Escape');
    ok(errs.length === 0, `화면 오류 0건 (${errs.slice(0, 2).join(' / ')})`);
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} 유튜브 업로드 화면 E2E ${pass}/${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 실패:', e); process.exit(1); });
