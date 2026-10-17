'use strict';
/**
 * node test/ribbon-lead.smoke.js — 📐 리본 첫 칸 자리 맞추기(v0.9.67 · 로이 2026-10-17)
 *   「① 대본」의 📂 열기 · 「② 이미지」의 이미지 도구 · 「③ 비디오」의 비디오 도구가 메뉴를 바꿔도 **같은 x 자리**에서 시작한다.
 *   📂 열기 단추 크기는 그대로(옛 크기 = 리본 단추 48px 높이).
 *   그리고 목록에 서비스 이름(kie)·달러 가격이 보이지 않는다.
 *   ⚠ 생성 호출 없음 · 설정 파일을 바꾸지 않는다(고르기만 보고 바꾸지 않는다).
 */
const path = require('path');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 1366, height: 768 }).catch(() => {});
    await win.waitForSelector('[data-testid="ribbon"]', { timeout: 30000 });
    const lead = async (menu, sel) => {
      await win.click(`button[data-menu="${menu}"]`); await win.waitForTimeout(250);
      return win.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
    };
    const open = await lead('script', '[data-testid="ribbon"] > .hgroup:first-child > .glabel + button');
    const img = await lead('image', '[data-testid="img-engine"]');
    const vid = await lead('video', '[data-testid="video-engine"]');
    console.log('  열기', JSON.stringify(open), '· 이미지', JSON.stringify(img), '· 비디오', JSON.stringify(vid));
    ok(open && img && vid, '세 칸이 모두 있다');
    ok(open && img && Math.abs(open.x - img.x) <= 1, `열기 x=${open && open.x} · 이미지 도구 x=${img && img.x} — 같은 자리`);
    ok(open && vid && Math.abs(open.x - vid.x) <= 1, `열기 x=${open && open.x} · 비디오 도구 x=${vid && vid.x} — 같은 자리`);
    ok(open && open.h >= 48 && open.w >= 48 && open.w <= 70, `📂 열기 단추 크기 그대로(${open && open.w}×${open && open.h})`);
    // 첫 칸이 이름표 바로 뒤에 있다(다른 단추가 끼지 않는다)
    const firstAfterLabel = await win.evaluate(() => { const l = document.querySelector('[data-testid="ribbon"] > .hgroup:first-child > .glabel'); return l && l.nextElementSibling ? l.nextElementSibling.getAttribute('data-testid') : null; });
    ok(firstAfterLabel === 'video-engine', '비디오 메뉴: 이름표 다음이 바로 비디오 도구');
    await win.click('button[data-menu="image"]'); await win.waitForTimeout(250);
    const imgTexts = await win.locator('[data-testid="img-engine"] option, [data-testid="img-engine"] optgroup').evaluateAll((os) => os.map((o) => o.label || o.textContent));
    await win.click('button[data-menu="video"]'); await win.waitForTimeout(250);
    const vidTexts = await win.locator('[data-testid="video-engine"] option, [data-testid="video-engine"] optgroup').evaluateAll((os) => os.map((o) => o.label || o.textContent));
    const all = imgTexts.concat(vidTexts).join(' / ');
    ok(!/kie/i.test(all), '목록에 서비스 이름(kie)이 없다');
    ok(!/\$/.test(all), '목록에 달러 가격이 없다');
    ok(/AI 이미지/.test(imgTexts.join('/')) && /AI 영상/.test(vidTexts.join('/')), '묶음 이름 = AI 이미지 · AI 영상');
  } finally { await app.close(); }
  console.log(`\n${fail ? '❌' : '✅'} ribbon-lead ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
