'use strict';
/**
 * node test/stock-ui.smoke.js — 🔎 무료 스톡 대화상자 E2E(v0.7.67). 네트워크는 main 의 fetch 를 가짜로 바꿔 막는다(진짜 키·진짜 API 안 씀).
 *   키 없음 안내 → (키 있음) 그룹 칸 「🔎 스톡」 → 기본 검색어·결과 → 사진 넣기(1920x1080 으로 잘림 · 사람이 고른 자산 · 출처 기록)
 *   → ① 칸 🔎 → 영상 넣기. ⚠ 임시 채널·임시 대본·임시 출력폴더만 쓴다 · 키 저장소(~/.flow-app/tts-secrets.json)는 건드리지 않는다.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TAG = `__스톡_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const groups = [];
for (let g = 1; g <= 4; g++) groups.push(`### 〔장면 ${g}〕`, `> 🖼️ 이미지: An old woman stacking stones ${g}, autumn light, oil painting.`, `${g}번 장면 문장입니다.`, '');
fs.writeFileSync(MD, ['# 스톡 대본', '', '## 장', ...groups].join('\n'), 'utf8');
const ff = require('ffmpeg-static');
const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'stockfix-'));
const JPG = path.join(fix, 'a.jpg'), MP4 = path.join(fix, 'a.mp4');
execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=1200x900', '-frames:v', '1', JPG], { stdio: 'ignore' });
execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-t', '1', '-pix_fmt', 'yuv420p', MP4], { stdio: 'ignore' });

const files = (d) => { const o = []; const walk = (p) => { for (const n of fs.readdirSync(p)) { const f = path.join(p, n); if (fs.statSync(f).isDirectory()) walk(f); else o.push(f); } }; try { walk(d); } catch (_) {} return o; };

(async () => {
  const chan = `__스톡채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockui-'));
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(String(e)));
  try {
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async ({ name, dir }) => { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); }, { name: chan, dir: outDir });
    await win.reload(); await win.waitForSelector('h1'); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(300);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }); await win.waitForTimeout(600);

    // 가짜 네트워크 + 키 상태(키 저장소는 안 건드린다) — 처음엔 키 없음
    await app.evaluate(({ }, { jpg, mp4 }) => {
      const thumb = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      const J = (j) => ({ ok: true, status: 200, text: async () => JSON.stringify(j), arrayBuffer: async () => new ArrayBuffer(0) });
      const B = (b64) => { const b = Buffer.from(b64, 'base64'); return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; };
      global.__stockCalls = [];
      global.fetch = async (url) => {
        const u = String(url); global.__stockCalls.push(u);
        if (u.includes('api.pexels.com/v1/search')) return J({ total_results: 1, photos: [{ id: 501, width: 1200, height: 900, url: 'https://www.pexels.com/photo/501/', photographer: 'Kim', photographer_url: 'https://www.pexels.com/@kim', alt: 'stones', src: { original: 'https://images.pexels.com/photos/501/a.jpeg', medium: thumb } }] });
        if (u.includes('api.pexels.com/videos/search')) return J({ total_results: 1, videos: [{ id: 601, width: 640, height: 360, url: 'https://www.pexels.com/video/601/', image: thumb, duration: 7, user: { name: 'Park', url: 'https://www.pexels.com/@park' }, video_files: [{ file_type: 'video/mp4', width: 640, height: 360, link: 'https://videos.pexels.com/601.mp4' }] }] });
        if (u.includes('pixabay.com/api/videos')) return J({ totalHits: 0, hits: [] });
        if (u.includes('pixabay.com/api')) return J({ totalHits: 1, hits: [{ id: 701, pageURL: 'https://pixabay.com/photos/701/', tags: 'stone', webformatURL: thumb, largeImageURL: 'https://pixabay.com/get/701.jpg', imageWidth: 1200, imageHeight: 900, user: 'choi', user_id: 3 }] });
        if (u.startsWith('https://images.pexels.com/') || u.startsWith('https://pixabay.com/get/')) return B(jpg);
        if (u.startsWith('https://videos.pexels.com/')) return B(mp4);
        return { ok: false, status: 404, text: async () => '' };
      };
      global.__stockKeysTest = { pexels: '', pixabay: '' };   // 처음엔 키 없음
    }, { jpg: fs.readFileSync(JPG).toString('base64'), mp4: fs.readFileSync(MP4).toString('base64') });

    await win.locator('[data-testid="group-item"][data-g="2"]').click(); await win.waitForTimeout(300);
    await win.locator('.menubar button:text-is("이미지")').first().click(); await win.waitForTimeout(200);   // 스톡 단추는 리본 이미지·비디오 탭에 있다(v0.7.71 — 그룹 칸 단추는 없앴다)
    await win.locator('[data-testid="rb-stock-image"]').click();
    await win.waitForSelector('[data-testid="stock-dlg"]', { timeout: 5000 });
    ok(await win.locator('[data-testid="stock-nokey"]').isVisible(), '키 없음 → 「⚙ 설정 → API 키」 안내');
    await win.keyboard.press('Escape'); await win.waitForTimeout(200);
    ok(!(await win.locator('[data-testid="stock-dlg"]').count()), 'Esc 로 닫힌다');

    await app.evaluate(() => { global.__stockKeysTest = { pexels: 'FAKEKEY1', pixabay: 'FAKEKEY2' }; });
    await win.locator('[data-testid="rb-stock-image"]').click();
    await win.waitForSelector('[data-testid="stock-item"]', { timeout: 8000 });
    ok(await win.locator('[data-testid="stock-q"]').inputValue() === 'An old woman stacking stones 2', '기본 검색어 = 그룹 이미지 프롬프트 첫 마디');
    const srcs = await win.evaluate(() => [...document.querySelectorAll('[data-testid="stock-item"]')].map((x) => x.dataset.src).join(','));
    ok(srcs === 'pexels,pixabay', `사진 결과 = Pexels·Pixabay 섞여 나온다(${srcs})`);
    ok(await win.locator('[data-testid="stock-kind-photo"].on').count() === 1, '도입부 아닌 그룹 → 사진이 기본');
    await win.locator('[data-testid="stock-item"][data-src="pexels"]').click();
    ok(await win.locator('[data-testid="stock-sel"]').isVisible(), '누르면 아래에 고른 것(작가·원본) 표시');
    await win.locator('[data-testid="stock-attach"]').click();
    await win.waitForSelector('[data-testid="stock-dlg"]', { state: 'detached', timeout: 15000 }).catch(() => {});
    ok(!(await win.locator('[data-testid="stock-dlg"]').count()), '넣으면 창이 닫힌다');
    await win.waitForTimeout(400);
    const all = files(outDir);
    const img = all.find((f) => /[\\/]_stock[\\/]pexels_photo_501_1920x1080\.jpg$/.test(f));
    ok(!!img, `사진이 <출력>/_stock/ 에 1920x1080 으로 잘려 저장된다(${img ? path.basename(img) : all.map((f) => path.basename(f)).join(',')})`);
    if (img) { const z = require(path.join(ROOT, 'vrew', 'vrew-builder')).readImageSize(img); ok(z && z.w === 1920 && z.h === 1080, `잘린 크기 실측 ${z && z.w}x${z && z.h}(원본 1200x900)`); }
    ok(await win.evaluate(() => { const i = document.querySelector('[data-testid="group-item"][data-g="2"] .pg-thumb img'); return !!(i && /_stock/.test(decodeURIComponent(i.src))); }), '그룹 칸 G2 썸네일이 스톡 사진으로 바뀐다');
    const credit = all.find((f) => /스톡_출처\.txt$/.test(f));
    const ct = credit ? fs.readFileSync(credit, 'utf8') : '';
    ok(/G2 · Pexels 사진 · Kim \(https:\/\/www\.pexels\.com\/@kim\) · https:\/\/www\.pexels\.com\/photo\/501\//.test(ct), '출처가 스톡_출처.txt 에 남는다');

    // ① 칸 🔎 → 영상
    await win.locator('[data-testid="group-item"][data-g="3"]').click(); await win.waitForTimeout(300);
    await win.locator('[data-testid="stock-open"]').click();
    await win.waitForSelector('[data-testid="stock-item"]', { timeout: 8000 });
    await win.locator('[data-testid="stock-kind-video"]').click();
    await win.waitForFunction(() => document.querySelectorAll('[data-testid="stock-item"]').length === 1, null, { timeout: 8000 }).catch(() => {});
    ok(await win.locator('[data-testid="stock-item"]').count() === 1, '영상으로 바꾸면 영상 결과(Pexels 1개)');
    const y0 = await win.evaluate(() => document.querySelector('[data-testid="stock-item"]').getBoundingClientRect().top);
    await win.locator('[data-testid="stock-item"]').first().click(); await win.waitForTimeout(200);
    const y1 = await win.evaluate(() => document.querySelector('[data-testid="stock-item"]').getBoundingClientRect().top);
    ok(Math.abs(y1 - y0) < 1, `고르면 아래 칸이 생겨도 결과 칸이 움직이지 않는다(${Math.round(y0)} → ${Math.round(y1)}) — 두 번 누르기가 빗나가지 않게`);
    await win.locator('[data-testid="stock-item"]').first().dblclick();
    await win.waitForSelector('[data-testid="stock-dlg"]', { state: 'detached', timeout: 15000 }).catch(() => {});
    const vid = files(outDir).find((f) => /[\\/]_stock[\\/]pexels_video_601\.mp4$/.test(f));
    ok(!!vid && fs.statSync(vid).size > 1024, '두 번 누르면 바로 넣기 — 영상이 _stock 에 받아진다');
    ok(/G3 · Pexels 영상 · Park/.test(fs.readFileSync(credit || path.join(outDir, 'x'), 'utf8')), '영상 출처도 기록');
    // 🎛 리본(v0.7.68): 이미지 탭 「무료이미지」 = 사진 · 비디오 탭 「무료비디오」 = 영상 — 지금 커서 그룹
    for (const [menu, tid, kd, lab] of [['image', 'rb-stock-image', 'photo', '무료이미지'], ['video', 'rb-stock-video', 'video', '무료비디오']]) {
      await win.click(`.menus button[data-menu="${menu}"]`); await win.waitForTimeout(300);
      const b = win.locator(`[data-testid="${tid}"]`);
      ok(await b.isVisible() && (await b.innerText()).includes(lab), `${menu} 탭에 「${lab}」 단추`);
      const one = await b.evaluate((e) => { const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { y: r.height, hit: !!(h && h.closest('[data-testid="' + e.dataset.testid + '"]')) }; });
      ok(one.hit && one.y < 60, `「${lab}」 이 실제로 눌린다(가려지지 않음 · 높이 ${Math.round(one.y)})`);
      await b.click();
      await win.waitForSelector('[data-testid="stock-dlg"]', { timeout: 5000 });
      ok(await win.locator(`[data-testid="stock-kind-${kd}"].on`).count() === 1, `「${lab}」 → ${kd === 'photo' ? '사진' : '영상'}으로 열린다`);
      ok(/G3 에 넣기/.test(await win.locator('[data-testid="stock-dlg"] h3').innerText()), '대상 = 지금 커서 그룹(G3)');
      await win.keyboard.press('Escape'); await win.waitForTimeout(200);
    }
    const calls = await app.evaluate(() => global.__stockCalls.length);
    ok(calls >= 5, `가짜 네트워크만 썼다(요청 ${calls}번)`);
    ok(errs.length === 0, `화면 오류 0건 ${errs.slice(0, 2).join(' | ')}`);
  } finally {
    try { await win.evaluate(async (n) => { await window.api.removePreset({ name: n }); }, chan); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
    for (const d of [outDir, fix]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }
  }
  console.log(`\n${fail ? '❌' : '✅'} 무료 스톡 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 오류:', e); process.exit(1); });
