'use strict';
/**
 * ai-notice-ui.smoke.js — 채널 편집 「📝 자막·분할」 탭의 AI 고지(E2E · 2026-10-06 로이 「AI 고지 모든 설정을 여기서 · 스크롤 없이 한 화면」)
 *   · AI 고지의 모든 설정(사용·문구·시간 단위/범위·서식·자리)이 자막·분할 탭에 있고, 🏠 기본 탭에는 없다
 *   · 본문 자막 + 분할 + AI 고지가 **스크롤 없이** 한 화면(탭 본문 scrollHeight ≤ clientHeight)
 *   · 값이 저장되고 다시 열어도 남는다(임시 채널 — 로이의 채널은 건드리지 않는다)
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const CH = '__테스트채널_삭제해도됨_AI' + process.pid;

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errs = [];
  let made = false; let win;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async () => { const ps = (await window.api.listPresets()) || []; for (const p of ps) if (String(p.name).indexOf('__테스트채널_삭제해도됨_AI') === 0) { try { await window.api.removePreset({ name: p.name }); } catch (_) {} } });
    await win.evaluate(async (name) => { await window.api.addPreset({ name }); }, CH); made = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });   // 목록을 다시 읽게

    await win.click('button[title^="채널(프리셋)"]');
    await win.waitForTimeout(700);
    const card = win.locator('.modal-card.tabbed').first();
    await card.locator('button:has-text("📋")').first().click();
    await card.locator('button:has-text("' + CH + '")').first().click();
    await win.waitForTimeout(500);

    // 🏠 기본 탭에는 이제 AI 고지가 없다
    await card.locator('button:has-text("🏠")').first().click(); await win.waitForTimeout(250);
    ok(await card.locator('[data-testid=ai-text]').count() === 0, '🏠 기본 탭에는 AI 고지 칸이 없다(자막·분할 탭으로 옮김)');

    await card.locator('button:has-text("📝")').first().click(); await win.waitForTimeout(300);
    for (const id of ['ai-text', 'ai-unit', 'ai-from', 'ai-to', 'ai-fmt-btn', 'ai-pos-x', 'ai-pos-y', 'ai-reset']) ok(await card.locator('[data-testid=' + id + ']').count() === 1, 'AI 고지 설정이 이 탭에 있다: ' + id);
    ok(await card.locator('[data-testid=ch-capfmt]').count() === 1 && await card.locator('[data-testid=ch-capanim]').count() === 1, '본문 자막 서식·효과 단추도 그대로');
    // 한 화면 — 스크롤이 생기지 않는다
    const sc = await card.locator('.tabbody').evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    ok(sc.sh <= sc.ch + 1, `자막·분할 탭이 스크롤 없이 한 화면 (내용 ${sc.sh} ≤ 칸 ${sc.ch})`);
    const vh = await win.evaluate(() => window.innerHeight);
    const h = await card.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    ok(h <= vh, `팝업이 화면 안(${h} / ${vh})`);
    // 문장 단위 분할로 바꿔도(도입부·본론 칸이 늘어남) 스크롤이 없다
    await card.locator('select:has(option[value=sentence])').first().selectOption('sentence'); await win.waitForTimeout(150);
    const sc2 = await card.locator('.tabbody').evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    ok(sc2.sh <= sc2.ch + 1, `문장 단위 분할(칸 2개 추가)에서도 스크롤 없음 (${sc2.sh} ≤ ${sc2.ch})`);
    await card.locator('select:has(option[value=sentence])').first().selectOption('h3');

    // 입력 · 칸이 실제로 눌린다
    await card.locator('[data-testid=ai-text]').fill('이 영상은 AI 로 만들었습니다');
    await card.locator('[data-testid=ai-unit]').selectOption('clip'); await win.waitForTimeout(150);
    ok(await card.locator('text=번 클립부터').count() === 1 && await card.locator('text=번 클립까지').count() === 1, '클립 단위로 바꾸면 클립 번호 칸');
    const hit = await card.locator('[data-testid=ai-to]').evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t === el; });
    ok(hit, '끝 칸이 실제로 눌린다(elementFromPoint)');
    await card.locator('[data-testid=ai-from]').fill('2'); await card.locator('[data-testid=ai-to]').fill('4');
    await card.locator('[data-testid=ai-pos-x]').fill('10'); await card.locator('[data-testid=ai-pos-y]').fill('80');
    // 서식 창
    await card.locator('[data-testid=ai-fmt-btn]').click(); await win.waitForSelector('[data-testid=aifmtdlg]', { timeout: 5000 });
    ok(true, '🎨 서식 창이 열린다');
    // 넓은 두 칸 배치 — 스크롤 없이 한 화면 · 글꼴 목록이 같은 화면에(탭 없음)
    const dl = await win.locator('[data-testid=aifmtdlg] .cf-body').evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, cols: getComputedStyle(el.firstElementChild.nextElementSibling || el.firstElementChild).columnCount, font: !!el.querySelector('[data-testid=cf-fontlist]'), tabs: !!document.querySelector('[data-testid=aifmtdlg] .cf-tabs') }));
    ok(dl.sh <= dl.ch + 1, `AI 고지 서식 창이 스크롤 없이 한 화면 (${dl.sh} ≤ ${dl.ch})`);
    ok(dl.font && !dl.tabs, 'AI 고지 서식 창: 글꼴 목록이 같은 화면(서식/글꼴 탭 없음)');
    ok(await win.locator('[data-testid=aifmtdlg] .cf-cols').count() === 1, 'AI 고지 서식 창: 서식 구역이 두 칸(cf-cols)');
    await win.keyboard.press('Escape'); await win.waitForTimeout(200);
    ok(await win.locator('[data-testid=aifmtdlg]').count() === 0 && await card.count() === 1, 'Esc 로 서식 창만 닫힌다(채널 편집은 그대로)');

    // 저장 → 다시 읽기
    await card.locator('button:has-text("저장")').first().click(); await win.waitForTimeout(900);
    const saved = await win.evaluate(async (name) => { const p = await window.api.getPresetDetail(name); return p && p.aiNotice; }, CH);
    ok(saved && saved.text === '이 영상은 AI 로 만들었습니다' && saved.unit === 'clip' && saved.fromClip === 2 && saved.toClip === 4, '문구·단위·범위가 저장된다 — ' + JSON.stringify(saved && { t: saved.text, u: saved.unit, f: saved.fromClip, to: saved.toClip }));
    ok(saved && saved.pos && Math.abs(saved.pos.x - 0.10) < 1e-6 && Math.abs(saved.pos.y - 0.80) < 1e-6, '자리(가로 10% · 세로 80%)가 저장된다 — ' + JSON.stringify(saved && saved.pos));
    if (process.env.AI_SHOT) { await win.click('button[title^="채널(프리셋)"]').catch(() => {}); }
    ok(errs.length === 0, `화면 오류 0건 (${errs.slice(0, 2).join(' / ')})`);
  } finally {
    try { if (made && win) await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, CH); } catch (_) {}
    await app.close();
  }
  console.log(`\n${fail ? '❌' : '✅'} AI 고지 화면 E2E ${pass}/${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 실패:', e); process.exit(1); });
