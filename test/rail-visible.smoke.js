'use strict';
// node test/rail-visible.smoke.js — ⚡ 큰 대본 큐 전환 지연(v0.9.29 · 로이 2026-10-15 「롱폼큐 클릭할 때 딜레이가 심하다」)
//   원인(실측): 삼국지 5부(문장 ~1,800) 전환 2.8초 중 대부분이 화면 밖 그룹까지의 배치(레일 measure · 자막 칸 clientWidth 가 억지로 일으킴).
//   고침: .cut 에 content-visibility:auto + 레일은 화면 근처 그룹만 잰다 + 스크롤하면 새로 보이는 그룹을 잰다.
//   확인: ① 화면 밖 그룹엔 레일이 없다(재지 않았다) ② 맨 아래로 스크롤하면 마지막 그룹 레일이 생긴다 ③ CSS·소스 규칙.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rail-vis-'));
const CH = '__테스트채널_삭제해도됨_rv' + process.pid;
const NAME = `[테스트_rv${process.pid}] 큰 대본`;
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = 80;
const sec = (i) => ['### 절 ' + i, '> 🖼️ 이미지: a quiet room number ' + i, '', Array.from({ length: 6 }, (_, k) => `${i}번째 절의 ${k + 1}번째 문장이다.`).join(' '), '', ''].join('\n');
const MD = path.join(TMP, NAME + '.md');
fs.writeFileSync(MD, ['# 큰 대본', '', '## 마당', '', ...Array.from({ length: N }, (_, i) => sec(i + 1))].join('\n'), 'utf8');

(async () => {
  // ③ 소스 — CSS 와 레일 규칙
  const CSS = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'styles.css'), 'utf8');
  const APP = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'App.jsx'), 'utf8');
  ok(/\.cut\{content-visibility:auto;contain-intrinsic-(?:block-)?size:auto \d+px\}/.test(CSS), '③ .cut = content-visibility:auto(화면 밖 배치 건너뛰기)');
  ok(/if \(!near\(cutEl\.get\(String\(c\.num\)\)\)\) continue;/.test(APP) && /addEventListener\('scroll', onScroll/.test(APP) && /measureRef\.current\(\)/.test(APP), '③ 레일은 화면 근처만 · 스크롤에 다시 잼 · 늘 최신 measure');

  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false;
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    chMade = await win.evaluate(async ({ name, dir }) => { try { try { await window.api.addPreset({ name }); } catch (_) {} await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); return true; } catch (_) { return false; } }, { name: CH, dir: TMP });
    await app.evaluate(({ dialog }, fp) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] }); }, MD);
    await win.evaluate(async (name) => { await window.api.openScript({ presetName: name }); }, CH);
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async () => { const r = await window.api.selectQueueItem('__x__', 'longform'); return r; });
    // 큐 칩을 눌러 화면에 그 대본을 띄운다(앱 버튼과 같은 경로)
    await win.waitForSelector('[data-testid="q-row"]', { timeout: 10000 });   // v0.9.42 세로 목록(옛 .qchip)
    await win.click('[data-testid="q-row"]');
    await win.waitForSelector('[data-testid="rail"]', { timeout: 15000 });
    await sleep(600);
    const s1 = await win.evaluate(() => ({ rails: [...document.querySelectorAll('[data-testid="rail"]')].map((r) => +r.getAttribute('data-g')), cuts: document.querySelectorAll('.cut').length }));
    ok(s1.cuts >= N && s1.rails.length > 0 && s1.rails.length < s1.cuts, `① 처음엔 화면 근처 그룹만 레일(${s1.rails.length}개 / 그룹 ${s1.cuts}개)`);
    ok(!s1.rails.includes(N), '① 화면 밖 마지막 그룹(G' + N + ')은 아직 재지 않았다');
    // ② 맨 아래로
    await win.evaluate(() => { const last = [...document.querySelectorAll('.cut')].pop(); last.scrollIntoView({ block: 'center' }); });
    let got = false;
    for (let i = 0; i < 30 && !got; i++) { await sleep(150); got = await win.evaluate((g) => !!document.querySelector(`[data-testid="rail"][data-g="${g}"]`), N); }
    ok(got, '② 스크롤하면 마지막 그룹(G' + N + ') 레일이 생긴다');
    const pos = await win.evaluate((g) => { const r = document.querySelector(`[data-testid="rail"][data-g="${g}"]`).getBoundingClientRect(); const c = document.querySelector(`.cut[data-g="${g}"] .sents`).getBoundingClientRect(); return { rTop: Math.round(r.top), rBot: Math.round(r.bottom), cTop: Math.round(c.top), cBot: Math.round(c.bottom) }; }, N);
    ok(Math.abs(pos.rTop - pos.cTop) < 40 && Math.abs(pos.rBot - pos.cBot) < 60, '② 그 레일이 그 그룹 문장 옆에 맞게 선다: ' + JSON.stringify(pos));
  } finally {
    try { if (chMade) { const w = await app.firstWindow(); await w.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, CH); } } catch (_) {}
    await app.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(path.join(os.homedir(), '.priming-maker', 'projects', NAME + '.smproj.json'), { force: true }); } catch (_) {}
  }
  console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 레일(화면 근처만) E2E ' + n + '/' + n + ' 통과');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
