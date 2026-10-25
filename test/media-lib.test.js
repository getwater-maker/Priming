'use strict';
/**
 * node test/media-lib.test.js — 🗂 내 미디어 보관함 · 🔊 효과음 패널(Lab · 남은 기능 ③④)
 *   [1] core/media-lib(폴더 훑기 · 키워드 거르기 · 한도) · [2] 소스 배선 · [3] 실제 앱: 폴더 지정 → 찾기 → 넣기(기존 삽입) · 미리 듣기 · 이유 있는 안내
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const ML = require('../core/media-lib');
const FF = require('../core/media-utils').getFfmpegPath();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlib-'));
const mk = (rel, data = 'x') => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; };

console.log('\n[1] 폴더 훑기 · 거르기');
mk('고양이.png'); mk('풍경/산.JPG'); mk('풍경/바다 일몰.webp'); mk('영상/고양이 점프.mp4'); mk('메모.txt'); mk('.숨김/비밀.png'); mk('node_modules/x.png');
mk('a/b/c/d/e/너무깊다.png'); mk('a/b/c/d/네번째.png');
const sc = ML.scan(tmp, 'media');
const names = sc.items.map((x) => x.rel.replace(/\\/g, '/')).sort();
ok(names.includes('고양이.png') && names.includes('풍경/산.JPG') && names.includes('영상/고양이 점프.mp4') && !names.some((n) => /메모\.txt|숨김|node_modules/.test(n)), `그림·영상만 · 숨김·node_modules 제외(${names.length}개)`);
ok(names.includes('a/b/c/d/네번째.png') && !names.some((n) => /너무깊다/.test(n)), '깊이 4단계까지(5단계는 안 읽는다)');
ok(sc.items.find((x) => x.name === '산.JPG').kind === 'image' && sc.items.find((x) => x.name === '고양이 점프.mp4').kind === 'video', '종류 판정(대소문자 무시)');
ok(ML.filter(sc.items, '고양이').length === 2 && ML.filter(sc.items, '고양이 점프').length === 1 && ML.filter(sc.items, '풍경 산').length === 1 && ML.filter(sc.items, '').length === sc.items.length, '키워드 = 모든 낱말이 폴더·파일 이름에 든다(「풍경 산」은 폴더+파일)');
ok(ML.filter(sc.items, 'ＡＢＣ').length === 0 && ML.filter(sc.items, '없는말').length === 0, '없는 낱말은 0개');
mk('효과음/박수.wav'); mk('효과음/웃음_짧게.MP3'); mk('효과음/동물/고양이 야옹.ogg'); mk('효과음/그림.png');
const sx = ML.scan(path.join(tmp, '효과음'), 'sfx');
ok(sx.items.length === 3 && sx.items.every((x) => x.kind === 'audio') && ML.filter(sx.items, '야옹').length === 1, '효과음은 오디오만(그림 제외) · 하위 폴더 포함');
const big = path.join(tmp, 'big'); for (let i = 0; i < 30; i++) mk('big/f' + i + '.png');
const lim = ML.scan(big, 'media', { files: 10 });
ok(lim.items.length === 10 && lim.truncated === true, '한도(파일 수)를 넘으면 잘렸다고 알린다');
ok(ML.scan(path.join(tmp, '없는폴더'), 'media').error && ML.scan('', 'media').error && ML.scan(path.join(tmp, '고양이.png'), 'media').error, '없는 폴더·빈 값·파일은 이유를 말한다(던지지 않는다)');
ok(ML.page(Array.from({ length: 10 }, (_, i) => i), 8, 5).join() === '8,9' && ML.page([1, 2], 0, 5).length === 2, '쪽 나누기');
ok(fs.existsSync(path.join(tmp, '고양이.png')), '읽기만 한다(파일이 그대로)');

console.log('\n[2] 소스 배선');
const M = read('main.js'), PL = read('preload.js'), APP = read('renderer/src/App.jsx');
ok(/ipcMain\.handle\('lib-search'/.test(M) && /libSearch: \(args\)/.test(PL), 'IPC lib-search + preload');
const ls = M.slice(M.indexOf("ipcMain.handle('lib-search'"), M.indexOf("ipcMain.handle('get-app-folders'"));
ok(!/writeFileSync|rmSync|unlinkSync|mkdirSync|renameSync/.test(ls), '🔑 lib-search 는 파일을 쓰거나 지우지 않는다(읽기만)');
ok(/media: String\(j\.media \|\| ''\), sfx: String\(j\.sfx \|\| ''\)/.test(M) && /\['reader', 'download', 'thumbs', 'media', 'sfx'\]/.test(M), '폴더 설정에 media·sfx');
ok(/data-testid="lib-panel"/.test(APP) && /data-testid="ctb-ins-lib"/.test(APP) && /data-testid="ctb-ins-sfx"/.test(APP) && /data-testid="ins-lib"/.test(APP) && /data-testid="ins-sfx"/.test(APP) && !/soon\('🗂'/.test(APP), '화면: 패널 · 클립 막대 · 삽입 탭 — 준비 중 표시 없음');
ok(/overlayOp\(\{ shortsNum: p\.sn, op: 'add', file: it\.path \}\)/.test(APP), '넣기는 기존 삽입(overlay-op add) 한 길');

console.log('\n[3] 실제 앱');
(async () => {
  const TAG = `보관함시험_${process.pid}`;
  const MD = path.join(os.tmpdir(), `${TAG}.md`);
  const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
  fs.writeFileSync(MD, ['# 시험', '', '## 장', '### ① 첫', '> 🖼️ 이미지: a', '', '첫 문장입니다. 둘째 문장입니다.', '', '### ② 둘', '> 🖼️ 이미지: b', '', '셋째 문장입니다.', ''].join('\n'), 'utf8');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:d=1', '-frames:v', '1', path.join(tmp, '진짜그림.png')]);
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', path.join(tmp, '효과음', '삑소리.wav')]);
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow(); win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await win.evaluate(async () => window.api.saveAppFolders({ media: '', sfx: '' }));
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const ovs = () => win.evaluate(async () => { const r = await window.api.listQueue(); return (r.dto.projects[0].overlays || []).map((o) => ({ kind: o.kind, name: o.name })); });
    const sel1 = async () => { await win.keyboard.press('Escape'); await win.locator('.sent[data-ln="1"] .clip-chk').first().click(); await win.waitForTimeout(250); };
    const openIns = async () => { await win.click('.menus button[data-menu="insert"]'); await win.waitForTimeout(250); };

    console.log('   · 폴더를 정하기 전');
    await sel1(); await openIns();
    await win.click('[data-testid="ins-lib"]'); await win.waitForSelector('[data-testid="lib-err"]', { timeout: 4000 });
    ok(/설정 → 📁 폴더/.test(await win.locator('[data-testid="lib-err"]').innerText()), '폴더가 없으면 어디서 정하는지 알려 준다');
    await win.click('[data-testid="lib-close"]');

    console.log('   · 내 미디어');
    await win.evaluate(async (d) => window.api.saveAppFolders({ media: d, sfx: d + '\\효과음' }), tmp);
    await sel1(); await openIns();
    await win.click('[data-testid="ins-lib"]'); await win.waitForSelector('[data-testid="lib-item"]', { timeout: 5000 });
    ok(await win.locator('[data-testid="lib-item"]').count() >= 5 && /개/.test(await win.locator('[data-testid="lib-count"]').innerText()), '목록이 뜬다: ' + (await win.locator('[data-testid="lib-count"]').innerText()).slice(-30));
    await win.fill('[data-testid="lib-q"]', '진짜그림'); await win.waitForTimeout(700);
    ok(await win.locator('[data-testid="lib-item"]').count() === 1 && await win.locator('[data-testid="lib-item"] img').count() === 1, '키워드로 좁힌다(그림 썸네일)');
    await win.click('[data-testid="lib-add"]'); await win.waitForTimeout(2500);
    let o = await ovs();
    ok(o.length === 1 && o[0].kind === 'image' && /진짜그림/.test(o[0].name), `고른 그림이 위층으로 들어갔다 ${JSON.stringify(o)}`);
    ok(await win.locator('[data-testid="lib-panel"]').count() === 0, '넣은 뒤 패널이 닫힌다');

    console.log('   · 효과음');
    await sel1(); await openIns();
    await win.click('[data-testid="ins-sfx"]'); await win.waitForSelector('[data-testid="lib-item"]', { timeout: 5000 });
    ok(await win.locator('[data-testid="lib-item"]').count() === 4 && await win.locator('[data-testid="lib-item"] img').count() === 0, '효과음 폴더의 오디오만(박수·웃음·야옹·삑소리)');
    await win.fill('[data-testid="lib-q"]', '야옹'); await win.waitForTimeout(700);
    ok(await win.locator('[data-testid="lib-item"]').count() === 1, '「야옹」 → 하위 폴더의 파일');
    await win.click('[data-testid="lib-play"]'); await win.waitForTimeout(200);
    ok((await win.locator('[data-testid="lib-play"]').innerText()) === '■', '▶ → ■ (미리 듣는 중)');
    await win.fill('[data-testid="lib-q"]', '삑소리'); await win.waitForTimeout(700);
    await win.click('[data-testid="lib-add"]'); await win.waitForTimeout(2500);
    o = await ovs();
    ok(o.length === 2 && o[1].kind === 'audio' && /삑소리/.test(o[1].name), `효과음이 오디오 위층으로 ${JSON.stringify(o[1])}`);
    await win.evaluate(async () => { await window.api.undo({}); await window.api.undo({}); await window.api.undo({}); await window.api.undo({}); });
    await win.waitForTimeout(600);
    ok((await ovs()).length === 0, '되돌리기 → 삽입 전으로(삽입 두 번 = 되돌리기 네 번)');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally {
    try { const w = await app.firstWindow(); await w.evaluate(async () => window.api.saveAppFolders({ media: '', sfx: '' })); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} media-lib ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
