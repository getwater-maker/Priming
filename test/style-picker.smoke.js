'use strict';
// node test/style-picker.smoke.js — 🎨 스타일 고르개 · 샘플 그림(v0.9.30 · 로이 「선택된 스타일이 어떤 이미지인지 미리 보게」 · 「qwen-image 로만」)
//   ① 헤더 ② 이미지의 고르개 = 그림 목록(샘플 있음 = 그림 · 없음 = 「샘플 없음」) ② 마우스를 올리면 크게 ③ 누르면 고르고 닫힘 · Esc
//   ④ ✎ 편집창: 줄마다 샘플 · 📎 직접 지정 → 생김 · ✕ → 지움 ⑤ 소스: 그리기는 🖥 로컬 + Qwen-Image 2.1 만 · 저장소 종류 'style'
//   안전: PM_FACE_DIR = 임시 폴더(진짜 얼굴·샘플 폴더와 서버 공유를 건드리지 않는다) · 실제 그리기(GPU)는 하지 않는다.
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const FACE = fs.mkdtempSync(path.join(os.tmpdir(), 'style-pick-'));
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = path.join(ROOT, 'assets', 'icon-source.png');
// main 과 같은 파일 이름 규칙(_voiceFileKey)
const key = (v) => String(v || '').replace(/[^A-Za-z0-9가-힣_.-]/g, '_').slice(0, 60) + '_' + crypto.createHash('sha1').update(String(v || '')).digest('hex').slice(0, 8);

(async () => {
  // ⑤ 소스
  const M = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const blk = M.slice(M.indexOf("ipcMain.handle('style-sample-make'"), M.indexOf("ipcMain.handle('tts-face-clear'"));
  ok(/cfg\.cloud = false;/.test(blk) && /image_qwen21_turbo\\\.json/.test(blk) && /_runOnLanes\(\['image', 'localGpu'\]/.test(blk), '⑤ 샘플 그리기 = 🖥 로컬 ComfyUI + Qwen-Image 2.1 워크플로만 · 로컬 GPU 레인');
  ok(/const STYLE_SAMPLE_ENGINE = 'style';/.test(M) && /P\.buildImagePrompt\(/.test(blk) && /aspect: '16:9'/.test(blk), '⑤ 저장 종류 style · 실제 이미지와 같은 프롬프트 조립 · 16:9');
  ok(/if \(process\.env\.PM_FACE_DIR\) return \{ ok: false, test: true \};/.test(M), '⑤ 시험 폴더는 서버로 올리지 않는다');

  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1', PM_FACE_DIR: FACE } });
  const errs = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push(e.message));
    await win.waitForSelector('h1', { timeout: 20000 });
    // 스타일 2개를 고른다 — 하나에만 샘플(파일 + index.json)을 미리 넣는다
    const styles = await win.evaluate(async () => (await window.api.listStyles()) || []);
    ok(styles.length >= 2, '스타일 목록 ' + styles.length + '개');
    const withS = styles[0], noS = styles[1];
    const d = path.join(FACE, 'style'); fs.mkdirSync(d, { recursive: true });
    fs.copyFileSync(PNG, path.join(d, key(withS.id) + '.png'));
    fs.writeFileSync(path.join(d, 'index.json'), JSON.stringify({ [withS.id]: key(withS.id) + '.png' }));
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });

    // ② 이미지 메뉴 → 고르개
    await win.click('button[data-menu="image"]');
    await win.waitForSelector('[data-testid="style-picker-btn"]', { timeout: 10000 });
    ok(await win.getAttribute('[data-testid="style-picker-btn"]', 'title') === '이미지 스타일', '① 고르개 버튼(title 「이미지 스타일」)');
    await win.click('[data-testid="style-picker-btn"]');
    await win.waitForSelector('[data-testid="style-picker-pop"]', { timeout: 5000 });
    const it = await win.evaluate(({ a, b }) => {
      const items = [...document.querySelectorAll('[data-testid="style-picker-item"]')];
      const ia = items.find((x) => x.getAttribute('data-id') === a), ib = items.find((x) => x.getAttribute('data-id') === b);
      const img = ia && ia.querySelector('img');
      return { n: items.length, aImg: !!img, aDecoded: img ? img.naturalWidth > 0 || !img.complete : false, bNone: !!(ib && /샘플 없음/.test(ib.textContent)), names: items.slice(0, 3).map((x) => x.textContent) };
    }, { a: withS.id, b: noS.id });
    ok(it.n === styles.length + 2, `① 목록 = 스타일 없음 · 📜 대본스타일 · 스타일 ${styles.length}개`);
    ok(it.aImg && it.bNone, '① 샘플 있는 스타일 = 그림 · 없는 스타일 = 「샘플 없음」');
    await sleep(300);
    const dec = await win.evaluate((a) => { const i = document.querySelector(`[data-testid="style-picker-item"][data-id="${a}"] img`); return i ? i.naturalWidth : 0; }, withS.id);
    ok(dec > 0, '① 샘플 그림이 실제로 그려졌다(디코딩 ' + dec + 'px)');
    // ② 마우스를 올리면 크게
    await win.hover(`[data-testid="style-picker-item"][data-id="${withS.id}"]`);
    await win.waitForSelector('[data-testid="style-picker-peek"] img', { timeout: 3000 });
    const pk = await win.evaluate(() => { const r = document.querySelector('[data-testid="style-picker-peek"]').getBoundingClientRect(); const p = document.querySelector('[data-testid="style-picker-pop"]').getBoundingClientRect(); return { w: Math.round(r.width), right: r.left >= p.right - 2, inView: r.right <= window.innerWidth + 1 }; });
    ok(pk.w >= 300 && pk.right, '② 올리면 목록 옆에 크게(폭 ' + pk.w + 'px)');
    await win.hover(`[data-testid="style-picker-item"][data-id="${noS.id}"]`); await sleep(150);
    ok(!(await win.$('[data-testid="style-picker-peek"]')), '② 샘플 없는 스타일엔 큰 그림이 없다');
    // ③ 고르기
    await win.click(`[data-testid="style-picker-item"][data-id="${noS.id}"]`);
    await sleep(200);
    const btn = await win.textContent('[data-testid="style-picker-btn"]');
    ok(btn.includes(noS.name) && !(await win.$('[data-testid="style-picker-pop"]')), '③ 누르면 그 스타일로 바뀌고 닫힌다: ' + btn.trim());
    await win.click('[data-testid="style-picker-btn"]'); await win.waitForSelector('[data-testid="style-picker-pop"]');
    await win.keyboard.press('Escape'); await sleep(150);
    ok(!(await win.$('[data-testid="style-picker-pop"]')), '③ Esc = 닫기');

    // ④ 편집창
    await win.click('button[title*="이미지 스타일 편집"]');
    await win.waitForSelector('[data-testid="style-sample"]', { timeout: 10000 });
    const rows = await win.evaluate(({ a, b }) => ({ aImg: !!document.querySelector(`[data-testid="style-sample"][data-id="${a}"] img`), bNone: /샘플 없음/.test((document.querySelector(`[data-testid="style-sample"][data-id="${b}"]`) || {}).textContent || '') }), { a: withS.id, b: noS.id });
    ok(rows.aImg && rows.bNone, '④ 편집창 줄마다 샘플(있음 = 그림 · 없음 = 「샘플 없음」)');
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, PNG);
    await win.click(`[data-testid="style-sample"][data-id="${noS.id}"] button[title="샘플 그림을 직접 고르기"]`);
    await win.waitForSelector(`[data-testid="style-sample"][data-id="${noS.id}"] img`, { timeout: 5000 });
    const ix = JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8'));
    ok(!!ix[noS.id] && fs.existsSync(path.join(d, ix[noS.id])), '④ 📎 직접 지정 → 샘플 생김(시험 폴더 · 종류 style)');
    await win.click(`[data-testid="style-sample"][data-id="${noS.id}"] button[title="샘플 지우기"]`);
    await win.waitForFunction((b) => /샘플 없음/.test((document.querySelector(`[data-testid="style-sample"][data-id="${b}"]`) || {}).textContent || ''), noS.id, { timeout: 5000 });
    ok(true, '④ ✕ → 샘플 지움');
    // 그리기 버튼 — 이미 샘플이 다 있으면 GPU 를 쓰지 않고 끝난다(실제 그리기는 하지 않는다)
    const none = await win.evaluate(async (a) => window.api.styleSampleMake({ ids: [a], force: false }), withS.id);
    ok(none && none.ok && none.made === 0 && /이미 샘플/.test(none.note || ''), '「샘플 없는 것만」 = 이미 있으면 그리지 않는다: ' + (none && none.note));
    ok(errs.length === 0, '화면 오류 0건' + (errs.length ? ': ' + errs[0] : ''));
  } finally {
    await app.close();
    try { fs.rmSync(FACE, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 스타일 고르개 E2E ' + n + '/' + n + ' 통과');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('❌ 실패:', e.message); try { fs.rmSync(FACE, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
