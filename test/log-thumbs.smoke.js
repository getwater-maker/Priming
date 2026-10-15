'use strict';
// node test/log-thumbs.smoke.js — 🖼 로그 상자 썸네일 탭(v0.9.24 · 로이 2026-10-15 「4등분 · 클릭하면 크게 · 기본 탭은 썸네일」).
//   실제 앱: 임시 썸네일 폴더(채널 하위 폴더에 [테스트_1019] 썸네일_A/B/C.png)를 ⚙ 공통 폴더로 고르고 [테스트_1019] 대본을 연다 →
//   ① 기본 탭 = 썸네일 ② 3장이 이름순으로 2×2 칸에 그려진다(그림이 실제로 디코딩됨) ③ 클릭 = 크게 보기 ④ 📜 로그 탭 = 로그 글
//   ⑤ 썸네일이 없는 대본이면 안내 글. 안전: 로이의 app-folders.json 은 전후 그대로 되돌린다 · 임시 채널·폴더만.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'log-thumbs-'));
const CH = '__테스트채널_삭제해도됨_lt' + process.pid;
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AF = path.join(os.homedir(), '.priming-maker', 'app-folders.json');
const afBak = fs.existsSync(AF) ? fs.readFileSync(AF) : null;
const restoreAf = () => { try { if (afBak) fs.writeFileSync(AF, afBak); else fs.rmSync(AF, { force: true }); } catch (_) {} };

const THUMBS = path.join(TMP, '썸네일');
const PNG = fs.readFileSync(path.join(ROOT, 'assets', 'icon-source.png'));
fs.mkdirSync(path.join(THUMBS, '01_테스트채널'), { recursive: true });
for (const s of ['C', 'A', 'B']) fs.writeFileSync(path.join(THUMBS, '01_테스트채널', `[테스트_1019] 썸네일_${s}.png`), PNG);
fs.writeFileSync(path.join(THUMBS, '01_테스트채널', '[테스트_1020] 썸네일_A.png'), PNG);   // 다른 편
const md = (t) => ['# ' + t, '', '## 마당', '', '### 절 1', '> 🖼️ 이미지: a room', '', '첫 문장이다. 둘째 문장이다.', ''].join('\n');
const P1 = path.join(TMP, '[테스트_1019] 썸네일 있는 대본.md'); fs.writeFileSync(P1, md('썸네일 있는 대본'), 'utf8');
const P2 = path.join(TMP, '[테스트_1099] 썸네일 없는 대본.md'); fs.writeFileSync(P2, md('썸네일 없는 대본'), 'utf8');

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false;
  const errs = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await win.waitForSelector('h1', { timeout: 20000 });
    const add = await win.evaluate(async ({ name, dir }) => {
      try { try { await window.api.addPreset({ name }); } catch (_) {} await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); return 'ok'; } catch (e) { return e.message; }
    }, { name: CH, dir: TMP });
    chMade = add === 'ok';
    ok(chMade, '임시 채널 생성: ' + add);
    const saved = await win.evaluate(async (d) => (await window.api.saveAppFolders({ thumbs: d })).thumbs, THUMBS);
    ok(saved === THUMBS, '⚙ 공통 폴더에 썸네일 폴더 저장');

    // 대본 전: 기본 탭 = 썸네일 · 안내 글
    await win.waitForSelector('[data-testid="logtab-thumb"]', { timeout: 10000 });
    const t0 = await win.evaluate(() => ({ on: document.querySelector('[data-testid="logtab-thumb"]').className, log: getComputedStyle(document.querySelector('#log')).display }));
    ok(/\bon\b/.test(t0.on) && t0.log === 'none', '① 기본 탭 = 🖼 썸네일(로그 글은 숨김): ' + JSON.stringify(t0));

    const open = async (p) => {
      await app.evaluate(({ dialog }, fp) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] }); }, p);
      // api 로 직접 열면 화면 상태(dto)는 그대로다 → main 이 보내는 것과 같은 dto-update 로 화면에 알린다(화면이 대본 바뀜에 반응하는지 본다)
      const dto = await win.evaluate(async (name) => { const r = await window.api.openScript({ presetName: name }); return r && r.dto; }, CH);
      await app.evaluate(({ BrowserWindow }, d) => { BrowserWindow.getAllWindows()[0].webContents.send('dto-update', d); }, dto);
      return dto && dto.fileTitle;
    };
    await open(P1);
    await win.waitForFunction(() => document.querySelectorAll('[data-testid="thumbcell"] img').length === 3, null, { timeout: 15000 });
    const cells = await win.evaluate(async () => {
      const imgs = [...document.querySelectorAll('[data-testid="thumbcell"] img')];
      await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
      const g = document.querySelector('[data-testid="thumbgrid"]').getBoundingClientRect();
      return { n: imgs.length, decoded: imgs.filter((i) => i.naturalWidth > 0).length, lbl: [...document.querySelectorAll('.thumblbl')].map((x) => x.textContent), cells: document.querySelectorAll('.thumbgrid > .thumbcell').length, gw: Math.round(g.width), gh: Math.round(g.height) };
    });
    ok(cells.n === 3 && cells.decoded === 3, '② 썸네일 3장이 그려졌다(그림 디코딩 ' + cells.decoded + '/3)');
    ok(cells.lbl.join(',') === '썸네일_A,썸네일_B,썸네일_C', '이름순 A·B·C · 다른 편(1020)은 없다: ' + cells.lbl.join(','));
    ok(cells.cells === 4 && cells.gw > 0 && cells.gh > 0, '2×2 = 4칸(빈 칸 1): ' + JSON.stringify(cells));
    // 2×2 배치 — 첫째와 둘째는 같은 줄, 셋째는 아래 줄
    const pos = await win.evaluate(() => [...document.querySelectorAll('.thumbgrid > .thumbcell')].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }));
    ok(pos[0][1] === pos[1][1] && pos[2][1] > pos[0][1] && pos[0][0] === pos[2][0] && pos[1][0] > pos[0][0], '화면 4등분(2×2) 배치: ' + JSON.stringify(pos));

    // ③ 클릭 → 크게 보기 (실제로 눌리는지 elementFromPoint 로)
    const hit = await win.evaluate(() => { const c = document.querySelectorAll('[data-testid="thumbcell"]')[1]; const r = c.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(el && c.contains(el)); });
    ok(hit, '썸네일 칸이 실제로 눌리는 자리다(elementFromPoint)');
    await win.locator('[data-testid="thumbcell"]').nth(1).click();
    await win.waitForSelector('[data-testid="preview"] img', { timeout: 5000 });
    const pv = await win.evaluate(() => decodeURIComponent(document.querySelector('[data-testid="preview"] img').getAttribute('src') || ''));
    ok(/썸네일_B\.png/.test(pv), '③ 클릭 = 크게 보기(B): ' + pv.split(/[\\/]/).pop());
    await win.keyboard.press('Escape');
    await sleep(300);

    // ④ 📜 로그 탭
    await win.click('[data-testid="logtab-log"]');
    const t1 = await win.evaluate(() => ({ log: getComputedStyle(document.querySelector('#log')).display, grid: !!document.querySelector('[data-testid="thumbgrid"]'), text: (document.querySelector('#log').textContent || '').length }));
    ok(t1.log !== 'none' && !t1.grid && t1.text > 0, '④ 📜 로그 탭 = 로그 글(썸네일 칸 없음): ' + JSON.stringify(t1));
    await win.click('[data-testid="logtab-thumb"]');

    // ⑤ 썸네일 없는 대본 → 안내
    await open(P2);
    await win.waitForSelector('[data-testid="thumbmsg"]', { timeout: 10000 });
    const msg = await win.evaluate(() => document.querySelector('[data-testid="thumbmsg"]').textContent);
    ok(/\[테스트_1099\].*아직 없습니다/.test(msg), '⑤ 썸네일 없는 대본 → 안내: ' + msg);
    ok(errs.length === 0, '화면 오류 0건' + (errs.length ? ': ' + errs[0] : ''));
  } finally {
    try {
      if (chMade) { const w2 = await app.firstWindow(); await w2.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, CH); }
    } catch (_) {}
    await app.close();
    restoreAf();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 로그 썸네일 탭 E2E ' + n + '/' + n + ' 통과');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('❌ 실패:', e.message); restoreAf(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
