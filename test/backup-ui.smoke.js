'use strict';
/**
 * node test/backup-ui.smoke.js — 🕘 백업에서 되살리기 · 🩹 비정상 종료 안내 (Lab) 실제 화면 E2E
 *   ① 죽은 pid 잠금을 남겨 두고 켜면 빈 화면에 「🩹 지난번에 비정상 종료」 + 「🕘 백업에서 되살리기」가 보인다(큐는 비어 있다 — 빈 화면 시작 그대로)
 *   ② 대본을 열면 「열 때」 세대가 생긴다 → 밖에서 대본을 망가뜨린 뒤 🕘 백업 → ↩ 되살리기 → .md 가 돌아오고 큐에 다시 열린다
 *   ③ 되살리기 전 상태도 한 세대로 남는다 · 좁은 창(1075px)에서 리본이 넘치지 않는다
 *   ⚠ PM_UI_SMOKE → 큐·백업·잠금은 %TEMP%\priming-smoke-workspace · 대본은 임시 폴더
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const WS = path.join(os.tmpdir(), 'priming-smoke-workspace');
const HIST = path.join(WS, 'history');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bkui-'));
const NAME = '백업시험_' + Date.now();
const MD = path.join(T, NAME + '.md');
const GOOD = '# 백업 시험\n\n### 장면 하나\n\n첫 문장입니다. 둘째 문장입니다.\n\n### 장면 둘\n\n셋째 문장입니다.\n';
fs.writeFileSync(MD, GOOD, 'utf8');
fs.mkdirSync(WS, { recursive: true });
try { fs.rmSync(path.join(WS, 'workspace.json'), { force: true }); } catch {}
fs.writeFileSync(path.join(WS, 'session.lock'), JSON.stringify({ pid: 999999, version: '0.0.1' }));   // 지난번 비정상 종료 흉내

const outRootOf = async () => (() => { try { const lg = fs.readdirSync(path.join(os.homedir(), '.shots-maker', 'logs')).filter((n) => /^\d{4}-\d\d-\d\d\.log$/.test(n)).sort().pop(); const t = fs.readFileSync(path.join(os.homedir(), '.shots-maker', 'logs', lg), 'utf8'); const m = new RegExp('출력 (.+' + NAME + ')').exec(t); return m ? m[1].trim() : null; } catch { return null; } })();
(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('dialog', (d) => d.accept().catch(() => {}));
    await win.setViewportSize({ width: 1366, height: 768 }).catch(() => {});
    await win.waitForSelector('[data-testid="ribbon"]', { timeout: 30000 });
    await win.waitForSelector('[data-testid="crash-note"]', { timeout: 8000 }).catch(() => {});
    ok(await win.locator('[data-testid="crash-note"]').count() === 1, '① 빈 화면에 「🩹 지난번에 비정상 종료」 안내');
    ok(await win.locator('[data-testid="backup-open-strip"]').count() === 1, '① 안내 줄에 「🕘 백업에서 되살리기」');

    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('button[data-menu="home"]').catch(() => {});
    await win.locator('[data-testid="ribbon"] button', { hasText: '열기' }).first().click();
    await win.waitForFunction(() => document.querySelectorAll('.cut').length >= 2, null, { timeout: 20000 });
    const baseDir = () => { try { return fs.readdirSync(HIST).find((b) => b.startsWith(NAME)); } catch { return null; } };
    const gensOf = () => { const b = baseDir(); try { return b ? fs.readdirSync(path.join(HIST, b)).filter((n) => /^\d{8}-\d{6}-\d{3}$/.test(n)).sort() : []; } catch { return []; } };
    ok(gensOf().length === 1, `② 열 때 한 세대 (${gensOf().length})`);
    ok(await win.locator('[data-testid="crash-note"]').count() === 0, '② 대본을 열면 안내 줄은 사라진다(큐가 비지 않음)');

    // 밖에서 대본을 망가뜨린다(외부 감시가 다시 읽는다)
    fs.writeFileSync(MD, '# 망가진 대본\n\n### 남은 장면\n\n하나만 남았습니다.\n', 'utf8');
    await win.waitForFunction(() => document.querySelectorAll('.cut').length === 1, null, { timeout: 15000 }).catch(() => {});
    ok(await win.locator('.cut').count() === 1, '망가진 대본이 화면에 읽혔다(그룹 1개)');

    // 좁은 창에서 리본이 넘치지 않는다(🕘 백업 단추가 더해져도)
    await win.setViewportSize({ width: 1075, height: 768 }).catch(() => {});
    await win.waitForTimeout(300);
    const ov = await win.evaluate(() => {
      const r = document.querySelector('[data-testid="ribbon"]'); const b = document.querySelector('[data-testid="backup-open"]');
      const with_ = r.scrollWidth - r.clientWidth; b.style.display = 'none'; const without = r.scrollWidth - r.clientWidth; b.style.display = '';
      return { with_, without };
    });
    ok(ov.with_ <= Math.max(0, ov.without), `③ 1075px — 🕘 백업 단추가 리본 넘침을 늘리지 않는다 (있을 때 ${ov.with_}px · 없을 때 ${ov.without}px)`);
    await win.setViewportSize({ width: 1366, height: 768 }).catch(() => {});

    await win.click('[data-testid="backup-open"]');
    await win.waitForSelector('[data-testid="backup-dlg"]', { timeout: 5000 });
    await win.locator('[data-testid="backup-script"]', { hasText: NAME }).first().click();
    const rows = await win.locator('[data-testid="backup-gen"]').count();
    ok(rows >= 1, `대화상자에 세대 목록 (${rows}줄)`);
    await win.locator('[data-testid="backup-restore"]').last().click();   // 가장 오래된 = 열 때
    await win.waitForSelector('[data-testid="backup-dlg"]', { state: 'detached', timeout: 15000 }).catch(() => {});
    await win.waitForFunction(() => document.querySelectorAll('.cut').length >= 2, null, { timeout: 15000 }).catch(() => {});
    ok(fs.readFileSync(MD, 'utf8') === GOOD, '② 되살리기 — 대본 .md 가 열 때 그대로');
    ok(await win.locator('.cut').count() === 2, '② 화면도 되살린 대본(그룹 2개)');
    const items = await win.locator('[data-testid="q-row"]').count();
    ok(items === 1, `큐에 그 대본 하나만 — 두 번 열리지 않았다 (${items})`);
    const gs = gensOf();
    const metas = gs.map((g) => { try { return JSON.parse(fs.readFileSync(path.join(HIST, baseDir(), g, 'meta.json'), 'utf8')); } catch { return {}; } });
    const pre = metas.find((m) => m.reason === 'before-restore');
    ok(!!pre, `③ 되살리기 전 상태가 한 세대로 남았다 (${metas.map((m) => m.reason).join(',')})`);
    ok(pre && fs.readFileSync(path.join(HIST, baseDir(), gs[metas.indexOf(pre)], 'script.md'), 'utf8').includes('망가진'), '③ 그 세대에 망가진 대본이 들어 있다(되살리기를 되돌릴 수 있다)');
    const errs = await win.evaluate(() => (window.__uiErrors || []).length).catch(() => 0);
    ok(!errs, `화면 오류 0건 (${errs})`);
  } finally {
    await app.close();
    try { const b = fs.readdirSync(HIST).filter((x) => x.startsWith('백업시험_')); for (const x of b) fs.rmSync(path.join(HIST, x), { recursive: true, force: true }); } catch {}
    try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
    try { const pd = path.join(os.homedir(), '.priming-maker', 'projects'); for (const f of fs.readdirSync(pd)) if (f.startsWith(NAME)) fs.rmSync(path.join(pd, f), { force: true }); } catch {}
    try { const out = await outRootOf(); if (out && path.basename(out).startsWith('백업시험_')) fs.rmSync(out, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} backup-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
