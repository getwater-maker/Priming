'use strict';
/**
 * node test/pane1-gutter.smoke.js — ① 칸(미리보기) 떨림 회귀(v0.9.89 · 로이 2026-10-21 「만들기 중 비디오 탭에서 미리보기 칸이 커졌다 작아졌다」)
 *   원인: ① 칸(.pane1.auto-size, overflow-y:auto) 내용이 칸 높이를 조금(8~24px) 넘으면 스크롤바가 생겨 폭이 줄고 → 16:9 미리보기가 낮아져 넘침이 사라지고
 *   → 스크롤바가 없어져 다시 넘친다. 제작 중 1초마다 다시 그릴 때마다 뒤집혔다. 고침: scrollbar-gutter:stable(스크롤바 자리를 늘 비워 둔다).
 *   판정: 내용을 2px 씩 늘려도 미리보기 높이가 하나로 머문다(고치기 전: 268·278 이 번갈아 나왔다).
 */
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const { _electron: electron } = require('playwright');
const TAG = '__shake_probe5_' + process.pid;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shake-'));
const MD = path.join(TMP, TAG + '.md');
const lines = ['# 떨림 시험', '', '## 도입부'];
for (let i = 1; i <= 30; i++) lines.push(`### 〔장면 ${i}〕`, `> 🖼️ 이미지: room ${i}`, `> 🎬 영상: camera slowly pushes in ${i}`, `${i}번째 그룹 첫 문장입니다. 둘째 문장입니다. 셋째 문장도 있습니다.`, '');
fs.writeFileSync(MD, lines.join('\n'), 'utf8');

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sblk', { timeout: 20000 });
    await win.click('button[data-menu="video"]'); await win.waitForTimeout(500);
    const now = Date.now();
    const prog = (k) => ({ operationId: 'probe', title: '떨림', itemId: null, phase: 'running', startedAt: now, endedAt: null, queue: { i: 1, n: 2 },
      stages: { tts: { state: 'done' }, image: { state: 'done' }, video: { state: 'run', startedAt: now, doneAtStart: 0 }, out: { state: 'wait' } },
      sent: { done: 90, total: 90, cur: null }, image: { done: 30, total: 30, active: [], sn: 1 }, video: { done: 0, total: 3, active: [1, 2, 3], sn: 1 }, counts: {} });

    await app.evaluate(({ BrowserWindow }, p) => { const w = BrowserWindow.getAllWindows()[0]; global.__probeT = setInterval(() => w.webContents.send('make-progress', { ...p, tick: Date.now() }), 1000); }, prog(0));

    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1536, 864); });
    await win.waitForTimeout(800);
    const res = await win.evaluate(async () => {
      const p = document.querySelector('#body .pane1'), st = document.getElementById('stage'), lw = document.getElementById('logwrap');
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const out = [];
      const slack0 = p.clientHeight - p.scrollHeight;
      const pad = document.createElement('div'); pad.id = '__pad'; pad.style.flex = '0 0 auto'; lw.parentElement.insertBefore(pad, lw);
      for (let extra = -6; extra <= 40; extra += 2) {
        pad.style.height = Math.max(0, slack0 + extra) + 'px';
        await raf(); await raf();
        const hs = [], sbs = [];
        for (let i = 0; i < 30; i++) { hs.push(Math.round(st.getBoundingClientRect().height)); sbs.push(p.offsetWidth - p.clientWidth); await raf(); }
        out.push({ extra, stage: [...new Set(hs)], sb: [...new Set(sbs)] });
      }
      pad.remove();
      return { slack0, auto: p.classList.contains('auto-size'), out };
    });
    console.log('auto-size', res.auto, '여유', res.slack0);
    const hs = new Set(res.out.flatMap((o) => o.stage));
    const ok = res.auto && hs.size === 1 && res.out.every((o) => o.stage.length === 1);
    console.log(ok ? '✅ pane1-gutter — 내용 높이를 바꿔도 미리보기 높이 ' + [...hs] + 'px 하나' : '❌ pane1-gutter — 미리보기 높이가 흔들린다 ' + JSON.stringify(res.out.map((o) => [o.extra, o.stage])));
    process.exitCode = ok ? 0 : 1;
    await app.evaluate(() => clearInterval(global.__probeT));
    
  } finally {
    await app.close().catch(() => {});
    try { const kst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); const lg = fs.readFileSync(path.join(os.homedir(), '.shots-maker', 'logs', kst + '.log'), 'utf8'); const m = lg.match(new RegExp('출력 (.*' + TAG + ')')); if (m) { const d = m[1].trim(); const files = []; const walk = (x) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else files.push(p); } }; walk(d); if (!files.length) { fs.rmSync(d, { recursive: true, force: true }); console.log('출력 폴더 정리'); } else console.log('⚠ 파일 있음', files.slice(0, 3)); } } catch (e) { console.log('정리 실패', e.message); }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(path.join(os.homedir(), '.priming-maker', 'projects', TAG + '.smproj.json'), { force: true }); } catch (_) {}
  }
})().catch((e) => { console.error(e); process.exit(1); });
